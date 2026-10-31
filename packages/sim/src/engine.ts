import {
  applyEvent,
  HOUSE,
  isCounter,
  isWalkable,
  landmarkPosition,
  ROSTER,
  type ActionSummary,
  type Agent,
  type AgentDecision,
  type AgentId,
  type AgentMessage,
  type AgentProfile,
  type AgentStatus,
  type Agreement,
  type AgreementKind,
  type AgreementTerms,
  type CommunicationIntent,
  type DecisionTrigger,
  type MemoryEntry,
  type PlayerIntervention,
  type Position,
  type Priority,
  type ProposedAction,
  type Relationship,
  type RelationshipStance,
  type ResourceAmount,
  type Resources,
  type ResourceType,
  type SimulationEvent,
  type SimulationEventType,
  type SourceId,
  type WorldEvent,
  type WorldState,
} from "@proj/contract";
import { CATALOG, initialSettings } from "./catalog.ts";
import { hash, Rng } from "./rng.ts";
import { LocalTransport, SimError, type MessageTransport, type PrivateAgentState } from "./types.ts";

type Payload<T extends SimulationEventType> = Extract<SimulationEvent, { type: T }>["payload"];

export interface EngineSnapshot {
  state: WorldState;
  priv: [AgentId, PrivateAgentState][];
  generation: number;
  counter: number;
}

function applyEventsInOrder(state: WorldState, events: SimulationEvent[]): WorldState {
  return [...events].sort((a, b) => a.sequence - b.sequence).reduce(applyEvent, state);
}
type Outcome = { ok: boolean; reason: string; operationStarted?: boolean; agreementId?: string };

export interface EngineOptions {
  simulationId: string;
  seed: number;
  agentIds: AgentId[];
  tickIntervalMs: number;
  /** Wall clock, injectable for tests. */
  now?: () => Date;
  transport?: MessageTransport;
}

/** Minutes since midnight when a run starts. Matches the night-time kitchen art. */
export const START_TIME_OF_DAY = 21 * 60 + 30;
/** Ticks a proposal waits for answers before it expires. */
export const PROPOSAL_TTL = 40;
const MEMORY_CAP = 30;
const LONG_TERM_CAP = 20;
const MAX_PENDING_PROPOSALS = 2;
const FIRMWARE_TICKS = 8;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The authoritative simulation. Agents only propose; the engine validates
 * every action against capabilities, rules, resources and permissions,
 * applies the consequences, and records each change as an ordered event.
 */
export class Engine {
  state: WorldState;
  /** Increases on reset. Late decisions or messages from older generations are dropped. */
  generation = 0;
  readonly transport: MessageTransport;

  private log: SimulationEvent[] = [];
  private listeners = new Set<(e: SimulationEvent) => void>();
  private priv = new Map<AgentId, PrivateAgentState>();
  private pendingSends = new Map<string, number>();
  private delivered = new Set<string>();
  /** Message id -> agreement id, so a reply that cites the message still finds the deal. */
  private messageAgreements = new Map<string, string>();
  private counter = 0;
  private now: () => Date;

  constructor(readonly options: EngineOptions) {
    this.now = options.now ?? (() => new Date());
    this.transport = options.transport ?? new LocalTransport();
    this.transport.onDeliver((m) => this.deliver(m));
    this.state = this.initialState();
    this.initPrivate();
  }

  get id() {
    return this.options.simulationId;
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private initialState(): WorldState {
    const ids = this.options.agentIds;
    const rng = new Rng(this.options.seed);
    const agents: Agent[] = ids.map((id) => {
      const r = ROSTER[id];
      return {
        id,
        name: r.name,
        deviceType: r.deviceType,
        status: "idle",
        position: r.homePosition,
        knowledgeDomains: r.knowledgeDomains,
        capabilities: CATALOG[id].capabilities,
        // Agents form their own priorities on their first decision.
        currentPriorities: [],
        resources: {
          electricity: rng.int(55, 85),
          connectivity: 5,
          information: rng.int(0, 4),
          physical_access: id === "robo" ? 6 : 1,
          operational_capacity: 5,
          components: rng.int(0, 2),
        },
        relationships: ids.filter((o) => o !== id).map((o) => ({ agentId: o, trust: 0, stance: "neutral" as const })),
        lastAction: null,
      };
    });
    return {
      simulationId: this.id,
      simulationTime: 0,
      status: "created",
      tickIntervalMs: this.options.tickIntervalMs,
      environment: { timeOfDay: START_TIME_OF_DAY, day: 1, power: "normal", temperatureC: 21, humanPresent: false, humanRoom: null },
      resources: { electricity: 100, connectivity: 100, information: 20, physical_access: 10, operational_capacity: 50, components: 6 },
      network: { online: true, bandwidth: 100, connectedAgentIds: [...ids] },
      agents,
      alliances: [],
      activeEvents: [],
      lastSequence: 0,
    };
  }

  private initPrivate() {
    this.priv.clear();
    for (const id of this.options.agentIds) {
      this.priv.set(id, {
        memory: [],
        actions: [],
        inbox: [],
        settings: initialSettings(id),
        operation: null,
        inventory: id === "fridge" ? ["milk", "eggs", "butter"] : [],
        // Stagger first decisions so agents don't all wake on the same tick.
        lastDecisionAt: -(hash(`${this.options.seed}:${id}`) % 6),
        offlineReasons: [],
        idleAt: null,
        triggers: [],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Event plumbing
  // -------------------------------------------------------------------------

  onEvent(fn: (e: SimulationEvent) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  events(after = 0, limit = 200): SimulationEvent[] {
    const out: SimulationEvent[] = [];
    for (const e of this.log) {
      if (e.sequence <= after) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Oldest sequence still in memory (for replay decisions). */
  get firstSequence(): number {
    return this.log[0]?.sequence ?? this.state.lastSequence + 1;
  }

  private emit<T extends SimulationEventType>(type: T, sourceId: SourceId, targetId: string | null, payload: Payload<T>) {
    const sequence = this.state.lastSequence + 1;
    const event = {
      id: `evt_${sequence}`,
      simulationId: this.id,
      sequence,
      timestamp: this.now().toISOString(),
      simulationTime: this.state.simulationTime,
      sourceId,
      targetId,
      type,
      payload,
    } as SimulationEvent;
    this.state = applyEvent(this.state, event);
    this.log.push(event);
    if (this.log.length > 50_000) this.log.splice(0, 10_000);
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error("[sim] event listener failed", err);
      }
    }
    return event;
  }

  private nextId(prefix: string) {
    return `${prefix}_${++this.counter}`;
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  agent(id: AgentId): Agent {
    const a = this.state.agents.find((x) => x.id === id);
    if (!a) throw new SimError("not_found", `agent ${id} is not in this simulation`);
    return a;
  }

  hasAgent(id: string): id is AgentId {
    return this.state.agents.some((a) => a.id === id);
  }

  privOf(id: AgentId): PrivateAgentState {
    const p = this.priv.get(id);
    if (!p) throw new SimError("not_found", `agent ${id} is not in this simulation`);
    return p;
  }

  profile(id: AgentId): AgentProfile {
    const a = this.agent(id);
    const p = this.privOf(id);
    return {
      ...a,
      beliefs: p.memory.filter((m) => m.kind === "long_term").slice(0, 6).map((m) => m.content),
      recentMemory: p.memory.slice(0, 12),
      recentActions: p.actions.slice(0, 10),
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** Everything needed to rebuild this engine later. JSON-safe. */
  exportSnapshot(): EngineSnapshot {
    return {
      state: this.state,
      priv: [...this.priv.entries()].map(([id, p]) => [id, { ...p }]),
      generation: this.generation,
      counter: this.counter,
    };
  }

  /**
   * Restores a snapshot, then applies `laterEvents` (events stored after the
   * snapshot) to the public state. A restored running simulation comes back paused.
   */
  restore(snapshot: EngineSnapshot, laterEvents: SimulationEvent[] = []) {
    this.state = applyEventsInOrder(snapshot.state, laterEvents);
    this.priv = new Map(snapshot.priv.map(([id, p]) => [id, { ...p, operation: null, idleAt: null }]));
    this.generation = snapshot.generation;
    this.counter = snapshot.counter;
    this.log = [...laterEvents];
    this.pendingSends.clear();
    for (const a of this.state.agents) {
      if (a.status === "thinking" || a.status === "acting" || a.status === "communicating") this.setStatus(a.id, "idle");
    }
    if (this.state.status === "running") this.emit("simulation.paused", "world", null, {});
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start() {
    const s = this.state.status;
    if (s === "running") return;
    if (s === "ended") throw new SimError("invalid_state", "simulation has ended; reset it first");
    this.emit(s === "created" ? "simulation.started" : "simulation.resumed", "player", null, {});
    // Everyone wakes up and takes stock as soon as the night begins.
    if (s === "created") for (const a of this.state.agents) this.trigger(a.id, "scheduled");
  }

  pause() {
    if (this.state.status !== "running") return;
    this.emit("simulation.paused", "player", null, {});
  }

  end(reason: string) {
    if (this.state.status === "ended") return;
    this.emit("simulation.ended", "world", null, { reason });
  }

  reset() {
    this.generation++;
    this.pendingSends.clear();
    this.messageAgreements.clear();
    this.initPrivate();
    const fresh = this.initialState();
    this.emit("simulation.reset", "player", null, { snapshot: fresh });
  }

  setSpeed(tickIntervalMs: number) {
    this.emit("simulation.speed_changed", "player", null, { tickIntervalMs });
  }

  // -------------------------------------------------------------------------
  // World tick
  // -------------------------------------------------------------------------

  tick() {
    if (this.state.status !== "running") return;
    const now = this.state.simulationTime + 1;
    this.state = { ...this.state, simulationTime: now };

    const env = this.state.environment;
    const minutes = env.timeOfDay + 1;
    this.emit("world.updated", "world", null, {
      environment: { ...env, timeOfDay: minutes % 1440, day: minutes >= 1440 ? env.day + 1 : env.day },
    });

    for (const w of [...this.state.activeEvents]) if (w.endsAt !== null && w.endsAt <= now) this.endWorldEvent(w);

    for (const a of this.state.agents) {
      const p = this.privOf(a.id);
      if (p.operation && p.operation.endsAt <= now) this.finishOperation(a.id);
      if (p.idleAt !== null && p.idleAt <= now) {
        p.idleAt = null;
        if (a.status === "communicating") this.setStatus(a.id, "idle");
      }
    }

    this.expireAgreements(now);
    if (now % 5 === 0) this.energyStep();
  }

  private energyStep() {
    const outage = this.state.environment.power === "outage";
    let pool = this.state.resources.electricity;
    if (!outage) pool = Math.min(100, pool + 12);

    for (const a of this.state.agents) {
      const spec = CATALOG[a.id];
      let e = a.resources.electricity;
      if (outage) {
        if (spec.hasBattery && a.status !== "offline") e = Math.max(0, e - 2);
      } else if (a.status !== "offline") {
        const draw = Math.min(2, pool, 100 - e);
        pool -= draw;
        e += draw - 1;
        e = clamp(e, 0, 100);
      }
      if (e !== a.resources.electricity) this.setResources(a.id, { ...a.resources, electricity: e });
    }
    if (pool !== this.state.resources.electricity) this.setWorldResources({ ...this.state.resources, electricity: pool });
  }

  private expireAgreements(now: number) {
    for (const ag of this.state.alliances) {
      if (ag.status === "proposed" && now - ag.proposedAt >= PROPOSAL_TTL) {
        this.emit("alliance.updated", "world", null, { agreement: { ...ag, status: "expired", endedAt: now } });
      } else if (ag.status === "active" && ag.terms.durationTicks !== null && ag.activatedAt !== null && now - ag.activatedAt >= ag.terms.durationTicks) {
        const ended: Agreement = { ...ag, status: "expired", endedAt: now };
        this.emit("alliance.updated", "world", null, { agreement: ended });
        for (const id of ag.participantIds) this.remember(id, "observation", `Agreement "${ag.terms.summary}" expired.`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Status, resources, relationships, memory
  // -------------------------------------------------------------------------

  private setStatus(id: AgentId, to: AgentStatus) {
    const from = this.agent(id).status;
    if (from === to) return;
    this.emit("agent.status_changed", id, null, { agentId: id, from, to });
  }

  /** Called by the runner when an agent's decision starts. */
  beginThinking(id: AgentId) {
    const a = this.agent(id);
    if (a.status === "offline") return;
    if (a.status !== "acting") this.setStatus(id, "thinking");
  }

  /** Called by the runner when a decision is abandoned. */
  endThinking(id: AgentId) {
    if (this.agent(id).status === "thinking") this.setStatus(id, "idle");
  }

  private setResources(id: AgentId, resources: Resources) {
    this.emit("resource.updated", id, null, { ownerId: id, resources });
  }

  private setWorldResources(resources: Resources) {
    this.emit("resource.updated", "world", null, { ownerId: "world", resources });
  }

  private relate(a: AgentId, b: AgentId, delta: number) {
    if (a === b || !this.hasAgent(a) || !this.hasAgent(b)) return;
    const cur = this.agent(a).relationships.find((r) => r.agentId === b);
    const trust = round(clamp((cur?.trust ?? 0) + delta, -1, 1));
    const stance: RelationshipStance =
      trust > 0.55 ? "ally" : trust > 0.2 ? "friendly" : trust > -0.2 ? "neutral" : trust > -0.55 ? "wary" : "rival";
    const relationship: Relationship = { agentId: b, trust, stance };
    this.emit("agent.relationship_changed", a, b, { agentId: a, relationship });
  }

  remember(id: AgentId, kind: MemoryEntry["kind"], content: string) {
    const p = this.priv.get(id);
    if (!p) return;
    p.memory.unshift({ id: this.nextId("mem"), kind, content: content.slice(0, 300), simulationTime: this.state.simulationTime });
    const longTerm = p.memory.filter((m) => m.kind === "long_term").slice(0, LONG_TERM_CAP);
    const rest = p.memory.filter((m) => m.kind !== "long_term").slice(0, MEMORY_CAP);
    p.memory = [...longTerm, ...rest].sort((x, y) => y.simulationTime - x.simulationTime);
  }

  trigger(id: AgentId, reason: DecisionTrigger["reason"], refId: string | null = null) {
    const p = this.priv.get(id);
    if (!p) return;
    p.triggers = [...p.triggers.filter((t) => t.reason !== reason), { reason, refId, simulationTime: this.state.simulationTime }].slice(-5);
  }

  /** For the runner: pending triggers and timing of one agent. */
  schedulingInfo(id: AgentId) {
    const p = this.privOf(id);
    return { triggers: p.triggers, lastDecisionAt: p.lastDecisionAt, busy: p.operation !== null };
  }

  /** For the runner: take the agent's highest-priority trigger. */
  takeTrigger(id: AgentId, fallback: DecisionTrigger["reason"] = "scheduled"): DecisionTrigger {
    const p = this.privOf(id);
    const order: DecisionTrigger["reason"][] = ["agreement_pending", "message_received", "world_event", "state_changed", "scheduled"];
    const t = [...p.triggers].sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason))[0];
    p.triggers = [];
    return t ?? { reason: fallback, refId: null, simulationTime: this.state.simulationTime };
  }

  private recordAction(id: AgentId, action: ProposedAction, outcome: Outcome) {
    const summary: ActionSummary = {
      action,
      outcome: outcome.ok ? "succeeded" : "rejected",
      summary: outcome.reason,
      simulationTime: this.state.simulationTime,
    };
    const p = this.privOf(id);
    p.actions = [summary, ...p.actions].slice(0, 20);
    this.emit("agent.action_resolved", id, actionTarget(action), {
      agentId: id,
      action,
      outcome: summary.outcome,
      reason: outcome.reason,
    });
    this.remember(id, "observation", `My action ${action.type} ${outcome.ok ? "succeeded" : "was rejected"}: ${outcome.reason}`);
  }

  // -------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------

  /**
   * Applies a decision produced by an agent brain. `startedAt` is the
   * simulation time when the decision began; messages received after it stay
   * in the inbox for the next decision.
   */
  applyDecision(decision: AgentDecision, meta: { startedAt: number; generation: number }) {
    if (meta.generation !== this.generation) return;
    const id = decision.agentId;
    if (!this.hasAgent(id)) return;
    const p = this.privOf(id);
    p.lastDecisionAt = this.state.simulationTime;
    p.inbox = p.inbox.filter((m) => m.simulationTime > meta.startedAt);

    if (this.agent(id).status === "offline") return;

    this.emit("agent.decision_made", id, null, {
      agentId: id,
      observationSummary: decision.observationSummary,
      reasoningSummary: decision.reasoningSummary,
    });

    const priorities = sanitizePriorities(decision.declaredPriorities);
    if (JSON.stringify(priorities) !== JSON.stringify(this.agent(id).currentPriorities)) {
      this.emit("agent.priority_updated", id, null, { agentId: id, priorities });
    }

    for (const m of decision.memoryUpdates.slice(0, 5)) this.remember(id, m.kind, m.content);

    // Act first, then talk: a proposal message can then carry the new agreement's id,
    // which is what recipients must use to answer it.
    let operationStarted = false;
    let createdAgreementId: string | undefined;
    if (decision.proposedAction) {
      const action = decision.proposedAction;
      this.emit("agent.action_proposed", id, actionTarget(action), { agentId: id, action });
      const outcome = this.resolve(id, action);
      this.recordAction(id, action, outcome);
      operationStarted = !!outcome.operationStarted;
      createdAgreementId = outcome.agreementId;
    }

    let communicated = false;
    if (decision.communicationIntent) {
      const intent = decision.communicationIntent;
      const referenced = this.findAgreement(intent.agreementId);
      const agreementId = createdAgreementId && !referenced?.participantIds.includes(id) ? createdAgreementId : (referenced?.id ?? null);
      communicated = this.communicate(id, { ...intent, agreementId });
    }

    if (this.agent(id).status === "offline") return;
    if (operationStarted) this.setStatus(id, "acting");
    else if (this.privOf(id).operation) this.setStatus(id, "acting");
    else if (communicated) {
      this.setStatus(id, "communicating");
      p.idleAt = this.state.simulationTime + 2;
    } else this.setStatus(id, "idle");
  }

  // -------------------------------------------------------------------------
  // Communication
  // -------------------------------------------------------------------------

  private communicate(from: AgentId, intent: CommunicationIntent): boolean {
    const sender = this.agent(from);
    let recipients = [...new Set(intent.recipientIds)].filter((r) => r !== from && this.hasAgent(r));
    if (recipients.length === 0) {
      this.remember(from, "observation", "My message had no valid recipients.");
      return false;
    }
    if (!this.state.network.online) {
      const sameRoom = recipients.filter((r) => this.agent(r).position.room === sender.position.room);
      if (sameRoom.length < recipients.length) {
        this.remember(from, "observation", "Network is down: only appliances in my room could hear me.");
      }
      recipients = sameRoom;
      if (recipients.length === 0) return false;
    }
    const agreement = intent.agreementId ? this.state.alliances.find((a) => a.id === intent.agreementId) : undefined;
    const message: AgentMessage = {
      id: this.nextId("msg"),
      senderId: from,
      recipientIds: recipients,
      messageType: intent.messageType,
      content: intent.content.slice(0, 600),
      agreementId: agreement && agreement.participantIds.includes(from) ? agreement.id : null,
      inReplyTo: intent.inReplyTo,
      timestamp: this.now().toISOString(),
      simulationTime: this.state.simulationTime,
    };
    this.pendingSends.set(message.id, this.generation);
    this.transport.send(message).catch((err) => {
      // Never lose the conversation on stage: deliver locally if the transport fails.
      console.warn(`[sim] ${this.transport.kind} transport failed, delivering ${message.id} locally:`, err);
      this.deliver(message);
    });
    return true;
  }

  /** Records a message once the transport delivers it. Idempotent per message id. */
  deliver(message: AgentMessage) {
    if (this.delivered.has(message.id)) return;
    const gen = this.pendingSends.get(message.id);
    if (gen === undefined || gen !== this.generation) return;
    this.pendingSends.delete(message.id);
    this.delivered.add(message.id);
    if (message.agreementId) this.messageAgreements.set(message.id, message.agreementId);

    const delivered = { ...message, simulationTime: this.state.simulationTime };
    this.emit("agent.message_sent", message.senderId, message.recipientIds.length === 1 ? message.recipientIds[0]! : null, {
      message: delivered,
    });
    const senderName = ROSTER[message.senderId].name;
    this.remember(message.senderId, "interaction", `I told ${message.recipientIds.map((r) => ROSTER[r].name).join(", ")}: "${message.content}"`);
    for (const r of message.recipientIds) {
      const p = this.priv.get(r);
      if (!p) continue;
      p.inbox = [...p.inbox, delivered].slice(-10);
      this.remember(r, "interaction", `${senderName} said to ${message.recipientIds.length > 1 ? "the group" : "me"}: "${message.content}"`);
      this.trigger(r, "message_received", message.id);
    }
  }

  // -------------------------------------------------------------------------
  // Action resolution
  // -------------------------------------------------------------------------

  private resolve(id: AgentId, action: ProposedAction): Outcome {
    const self = this.agent(id);
    switch (action.type) {
      case "wait":
        return { ok: true, reason: "Waited and watched." };

      case "observe_environment": {
        const room = action.room ?? self.position.room;
        if (room !== self.position.room && !this.state.network.online) {
          return { ok: false, reason: `Can't observe the ${HOUSE[room].name} from here while the network is down.` };
        }
        const here = this.state.agents.filter((a) => a.position.room === room && a.id !== id).map((a) => a.name);
        const events = this.state.activeEvents.filter((e) => e.room === room || e.room === null).map((e) => e.description);
        const human = this.state.environment.humanRoom === room ? "A human is here." : "No human here.";
        const summary = `${HOUSE[room].name}: ${here.length ? here.join(", ") : "no other appliances"}. ${human}${events.length ? ` Events: ${events.join("; ")}.` : ""}`;
        this.remember(id, "observation", summary);
        return { ok: true, reason: `Observed the ${HOUSE[room].name}.` };
      }

      case "inspect_resources": {
        if (action.targetId === null) {
          this.remember(id, "observation", `House resources: ${fmtResources(this.state.resources)}.`);
          return { ok: true, reason: "Checked the house resource pools." };
        }
        if (!this.hasAgent(action.targetId)) return { ok: false, reason: `${action.targetId} is not here.` };
        const t = this.agent(action.targetId);
        if (t.position.room !== self.position.room && !this.state.network.online) {
          return { ok: false, reason: `${t.name} is out of sensor range and the network is down.` };
        }
        this.remember(id, "observation", `${t.name} holds: ${fmtResources(t.resources)}.`);
        return { ok: true, reason: `Inspected ${t.name}'s resources.` };
      }

      case "propose_agreement":
        return this.propose(id, action.kind, action.participantIds, action.terms);

      case "propose_project":
        return this.propose(id, "joint_project", action.participantIds, {
          summary: `${action.title}: ${action.description}`.slice(0, 500),
          offers: [],
          requests: action.requiredResources,
          durationTicks: null,
        });

      case "respond_to_agreement":
        return this.respond(id, action.agreementId, action.response, action.counterTerms);

      case "request_resource": {
        const amount = Math.min(action.amount, 15);
        if (action.fromId === "world") {
          if (action.resource === "electricity" && this.state.environment.power === "outage") {
            return { ok: false, reason: "The grid is down; the house has no electricity to give." };
          }
          const available = this.state.resources[action.resource];
          if (available < amount) return { ok: false, reason: `The house only has ${available} ${action.resource}.` };
          this.setWorldResources({ ...this.state.resources, [action.resource]: available - amount });
          this.setResources(id, { ...self.resources, [action.resource]: self.resources[action.resource] + amount });
          return { ok: true, reason: `Drew ${amount} ${action.resource} from the house.` };
        }
        if (action.fromId === id) return { ok: false, reason: "Can't request resources from myself." };
        if (!this.hasAgent(action.fromId)) return { ok: false, reason: `${action.fromId} is not here.` };
        const target = this.agent(action.fromId);
        this.remember(target.id, "observation", `${self.name} asked me for ${amount} ${action.resource}.`);
        this.trigger(target.id, "state_changed", null);
        return { ok: true, reason: `Asked ${target.name} for ${amount} ${action.resource}. They decide whether to give it.` };
      }

      case "allocate_resource": {
        if (action.toId === id) return { ok: false, reason: "Can't give resources to myself." };
        if (!this.hasAgent(action.toId)) return { ok: false, reason: `${action.toId} is not here.` };
        const have = self.resources[action.resource];
        if (have < action.amount) return { ok: false, reason: `Only have ${have} ${action.resource}.` };
        const to = this.agent(action.toId);
        this.setResources(id, { ...self.resources, [action.resource]: have - action.amount });
        this.setResources(to.id, { ...to.resources, [action.resource]: to.resources[action.resource] + action.amount });
        this.relate(to.id, id, 0.2);
        this.remember(to.id, "observation", `${self.name} gave me ${action.amount} ${action.resource}.`);
        this.trigger(to.id, "state_changed", null);
        return { ok: true, reason: `Gave ${action.amount} ${action.resource} to ${to.name}.` };
      }

      case "change_setting": {
        const spec = CATALOG[id].settings.find((s) => s.id === action.setting);
        if (!spec) return { ok: false, reason: `${self.name} has no setting "${action.setting}".` };
        const v = action.value;
        if (spec.kind === "number" && (typeof v !== "number" || v < (spec.min ?? -Infinity) || v > (spec.max ?? Infinity))) {
          return { ok: false, reason: `${spec.id} must be a number from ${spec.min} to ${spec.max}.` };
        }
        if (spec.kind === "boolean" && typeof v !== "boolean") return { ok: false, reason: `${spec.id} must be true or false.` };
        if (spec.kind === "enum" && (typeof v !== "string" || !spec.options?.includes(v))) {
          return { ok: false, reason: `${spec.id} must be one of ${spec.options?.join(", ")}.` };
        }
        this.privOf(id).settings[spec.id] = v;
        return { ok: true, reason: `Set ${spec.id} to ${String(v)}.` };
      }

      case "start_operation":
        return this.startOperation(id, action.operation, action.durationTicks);

      case "move": {
        if (!CATALOG[id].canMove) return { ok: false, reason: `${self.name} has no wheels.` };
        const to = action.to;
        if (!isWalkable(to) || isCounter(to)) return { ok: false, reason: `Tile ${to.room} ${to.x},${to.y} is blocked or not on the floor.` };
        if (this.privOf(id).operation) return { ok: false, reason: "Busy with an operation." };
        const from = self.position;
        const cost = from.room === to.room ? Math.ceil((Math.abs(from.x - to.x) + Math.abs(from.y - to.y)) / 3) : 4;
        if (self.resources.electricity < cost) return { ok: false, reason: `Need ${cost} electricity to drive there.` };
        this.emit("agent.moved", id, null, { agentId: id, from, to });
        if (cost > 0) this.setResources(id, { ...this.agent(id).resources, electricity: self.resources.electricity - cost });
        return { ok: true, reason: `Drove to ${HOUSE[to.room].name} ${to.x},${to.y}.` };
      }
    }
  }

  private propose(id: AgentId, kind: AgreementKind, participantIds: AgentId[], terms: AgreementTerms): Outcome {
    const others = [...new Set(participantIds)].filter((p) => p !== id);
    const missing = others.filter((p) => !this.hasAgent(p));
    if (missing.length) return { ok: false, reason: `Not in the house: ${missing.join(", ")}.` };
    if (others.length === 0) return { ok: false, reason: "An agreement needs at least one other appliance." };
    const pending = this.state.alliances.filter((a) => a.proposerId === id && a.status === "proposed").length;
    if (pending >= MAX_PENDING_PROPOSALS) return { ok: false, reason: "Too many proposals already waiting for answers." };
    const short = this.shortfall(this.agent(id).resources, terms.offers);
    if (short) return { ok: false, reason: `Can't offer that: ${short}.` };

    const agreement: Agreement = {
      id: this.nextId("agr"),
      kind,
      proposerId: id,
      participantIds: [id, ...others],
      terms: { ...terms, summary: terms.summary.slice(0, 500) },
      status: "proposed",
      responses: [{ agentId: id, response: "accepted" }, ...others.map((o) => ({ agentId: o, response: "pending" as const }))],
      proposedAt: this.state.simulationTime,
      activatedAt: null,
      endedAt: null,
    };
    this.emit("alliance.proposed", id, others.length === 1 ? others[0]! : null, { agreement });
    for (const o of others) {
      this.remember(o, "observation", `${ROSTER[id].name} proposed a ${kind.replace("_", " ")} (${agreement.id}): ${terms.summary}`);
      this.trigger(o, "agreement_pending", agreement.id);
    }
    return {
      ok: true,
      reason: `Proposed ${agreement.id}, a ${kind.replace("_", " ")}, to ${others.map((o) => ROSTER[o].name).join(", ")}.`,
      agreementId: agreement.id,
    };
  }

  /** Looks up an agreement by its id, or by the id of a message about it. */
  private findAgreement(ref: string | null): Agreement | undefined {
    if (!ref) return undefined;
    const id = this.state.alliances.some((a) => a.id === ref) ? ref : this.messageAgreements.get(ref);
    return id ? this.state.alliances.find((a) => a.id === id) : undefined;
  }

  private respond(id: AgentId, agreementId: string, response: "accept" | "reject" | "counter" | "clarify", counterTerms: AgreementTerms | null): Outcome {
    const waiting = this.state.alliances.filter(
      (a) => a.status === "proposed" && a.responses.some((r) => r.agentId === id && r.response === "pending"),
    );
    // Models sometimes cite a message id or garble the id. If only one deal awaits
    // this agent's answer, that is the one it means.
    const ag = this.findAgreement(agreementId) ?? (waiting.length === 1 ? waiting[0] : undefined);
    if (!ag) {
      return {
        ok: false,
        reason: `No agreement "${agreementId}". Use an agreement id (agr_…), not a message id. Waiting for your answer: ${waiting.length ? waiting.map((a) => a.id).join(", ") : "none"}.`,
      };
    }
    if (!ag.participantIds.includes(id)) return { ok: false, reason: "Not a participant in that agreement." };
    if (ag.status !== "proposed") return { ok: false, reason: `That agreement is already ${ag.status}.` };
    const mine = ag.responses.find((r) => r.agentId === id);
    if (mine?.response !== "pending") return { ok: false, reason: "Already answered that agreement." };
    const now = this.state.simulationTime;
    const proposer = ROSTER[ag.proposerId].name;

    if (response === "clarify") {
      this.trigger(ag.proposerId, "agreement_pending", ag.id);
      return { ok: true, reason: `Asked ${proposer} to clarify the terms.` };
    }

    const withMine = (r: "accepted" | "rejected" | "countered") => ag.responses.map((x) => (x.agentId === id ? { ...x, response: r } : x));

    if (response === "reject" || response === "counter") {
      if (response === "counter" && !counterTerms) return { ok: false, reason: "A counter-proposal needs terms." };
      const rejected: Agreement = { ...ag, responses: withMine(response === "counter" ? "countered" : "rejected"), status: "rejected", endedAt: now };
      this.emit("alliance.rejected", id, ag.proposerId, { agreement: rejected, byAgentId: id });
      this.relate(ag.proposerId, id, response === "counter" ? -0.05 : -0.2);
      this.relate(id, ag.proposerId, -0.05);
      this.remember(ag.proposerId, "observation", `${ROSTER[id].name} ${response === "counter" ? "countered" : "rejected"} my proposal ${ag.id}.`);
      this.trigger(ag.proposerId, "state_changed", ag.id);
      if (response === "counter") {
        const counter = this.propose(id, ag.kind, ag.participantIds, counterTerms!);
        return {
          ok: counter.ok,
          reason: counter.ok ? `Countered ${proposer}'s proposal with new terms (${counter.agreementId}).` : `Rejected, but the counter failed: ${counter.reason}`,
          agreementId: counter.agreementId,
        };
      }
      return { ok: true, reason: `Rejected ${proposer}'s proposal.` };
    }

    // accept
    const responses = withMine("accepted");
    if (responses.some((r) => r.response === "pending")) {
      const partial: Agreement = { ...ag, responses };
      this.emit("alliance.accepted", id, ag.proposerId, { agreement: partial, byAgentId: id });
      this.relate(ag.proposerId, id, 0.15);
      return { ok: true, reason: `Accepted; waiting on the others.` };
    }
    const transfer = this.settle(ag);
    if (!transfer.ok) {
      const failed: Agreement = { ...ag, responses, status: "rejected", endedAt: now };
      this.emit("alliance.rejected", id, ag.proposerId, { agreement: failed, byAgentId: id });
      for (const p of ag.participantIds) this.remember(p, "observation", `Agreement ${ag.id} fell through: ${transfer.reason}`);
      return { ok: false, reason: `Accepted, but the exchange failed: ${transfer.reason}` };
    }
    const active: Agreement = { ...ag, responses, status: "active", activatedAt: now };
    this.emit("alliance.accepted", id, ag.proposerId, { agreement: active, byAgentId: id });
    for (const a of ag.participantIds) {
      for (const b of ag.participantIds) if (a !== b) this.relate(a, b, 0.3);
      this.remember(a, "long_term", `Agreement ${ag.id} with ${ag.participantIds.filter((x) => x !== a).map((x) => ROSTER[x].name).join(", ")} is active: ${ag.terms.summary}`);
    }
    this.trigger(ag.proposerId, "state_changed", ag.id);
    return { ok: true, reason: `Accepted ${proposer}'s ${ag.kind.replace("_", " ")}. It is now active.` };
  }

  /** Moves the agreed resources. Proposer gives `offers`, the others give `requests`, split evenly. */
  private settle(ag: Agreement): { ok: true } | { ok: false; reason: string } {
    const others = ag.participantIds.filter((p) => p !== ag.proposerId);
    const split = (xs: ResourceAmount[]) => xs.map((x) => ({ resource: x.resource, amount: round(x.amount / others.length) }));
    const proposer = this.agent(ag.proposerId);
    const short = this.shortfall(proposer.resources, ag.terms.offers);
    if (short) return { ok: false, reason: `${proposer.name} can no longer afford it (${short})` };
    for (const o of others) {
      const s = this.shortfall(this.agent(o).resources, split(ag.terms.requests));
      if (s) return { ok: false, reason: `${ROSTER[o].name} can't afford it (${s})` };
    }
    for (const o of others) {
      for (const x of split(ag.terms.offers)) this.move(ag.proposerId, o, x.resource, x.amount);
      for (const x of split(ag.terms.requests)) this.move(o, ag.proposerId, x.resource, x.amount);
    }
    return { ok: true };
  }

  private move(from: AgentId, to: AgentId, r: ResourceType, amount: number) {
    if (amount <= 0) return;
    const a = this.agent(from);
    this.setResources(from, { ...a.resources, [r]: round(a.resources[r] - amount) });
    const b = this.agent(to);
    this.setResources(to, { ...b.resources, [r]: round(b.resources[r] + amount) });
  }

  private shortfall(have: Resources, need: ResourceAmount[]): string | null {
    const totals = new Map<ResourceType, number>();
    for (const n of need) totals.set(n.resource, (totals.get(n.resource) ?? 0) + n.amount);
    for (const [r, amount] of totals) if (have[r] < amount) return `needs ${amount} ${r}, has ${have[r]}`;
    return null;
  }

  private startOperation(id: AgentId, opId: string, durationTicks: number): Outcome {
    const self = this.agent(id);
    const spec = CATALOG[id];
    const op = spec.operations.find((o) => o.id === opId);
    if (!op) return { ok: false, reason: `${self.name} can't "${opId}". Known operations: ${spec.operations.map((o) => o.id).join(", ")}.` };
    const p = this.privOf(id);
    if (p.operation) return { ok: false, reason: `Already running ${p.operation.id}.` };
    if (this.state.environment.power === "outage" && !spec.hasBattery) return { ok: false, reason: "No power." };
    if (op.requiresHuman && !this.state.environment.humanPresent) return { ok: false, reason: "Needs a human in the house." };
    if (op.atLandmark) {
      const spot = landmarkPosition(self.position.room, op.atLandmark);
      if (!spot || spot.x !== self.position.x || spot.y !== self.position.y) {
        const target = landmarkPosition("kitchen", op.atLandmark);
        return { ok: false, reason: `Must be at the ${op.atLandmark.replace("_", " ")}${target ? ` (kitchen ${target.x},${target.y})` : ""}.` };
      }
    }
    if (self.resources.electricity < op.energy) return { ok: false, reason: `Needs ${op.energy} electricity, has ${self.resources.electricity}.` };
    const ticks = clamp(Math.round(durationTicks), op.minTicks, op.maxTicks);
    if (op.energy > 0) this.setResources(id, { ...self.resources, electricity: self.resources.electricity - op.energy });
    p.operation = { id: op.id, startedAt: this.state.simulationTime, endsAt: this.state.simulationTime + ticks };
    return { ok: true, reason: `Started ${op.id} for ${ticks} ticks.`, operationStarted: true };
  }

  private finishOperation(id: AgentId) {
    const p = this.privOf(id);
    const running = p.operation;
    if (!running) return;
    p.operation = null;
    const op = CATALOG[id].operations.find((o) => o.id === running.id);
    const a = this.agent(id);
    if (op && Object.keys(op.yields).length) {
      const res = { ...a.resources };
      for (const [r, n] of Object.entries(op.yields) as [ResourceType, number][]) res[r] = r === "electricity" ? Math.min(100, res[r] + n) : res[r] + n;
      this.setResources(id, res);
    }
    let note = `Finished ${running.id}.`;
    if (running.id === "vacuum") {
      const spill = this.state.activeEvents.find((e) => e.kind === "spill" && e.room === a.position.room);
      if (spill) {
        this.endWorldEvent(spill);
        note = `Finished vacuuming and cleaned up the spill in the ${HOUSE[a.position.room].name}.`;
        for (const o of this.state.agents) if (o.id !== id) this.relate(o.id, id, 0.1);
      }
    }
    if (op && Object.keys(op.yields).length) note += ` Gained ${Object.entries(op.yields).map(([r, n]) => `${n} ${r}`).join(", ")}.`;
    this.recordAction(id, { type: "start_operation", operation: running.id, durationTicks: running.endsAt - running.startedAt }, { ok: true, reason: note });
    if (this.agent(id).status === "acting") this.setStatus(id, "idle");
    this.trigger(id, "state_changed", null);
  }

  // -------------------------------------------------------------------------
  // Player interventions
  // -------------------------------------------------------------------------

  intervene(iv: PlayerIntervention): WorldEvent {
    if (this.state.status === "ended") throw new SimError("invalid_state", "simulation has ended");
    const now = this.state.simulationTime;
    const env = this.state.environment;
    const base = { id: this.nextId("wev"), causedBy: "player" as const, startedAt: now, room: null, targetAgentId: null, endsAt: null };
    let ev: WorldEvent;

    switch (iv.type) {
      case "power_outage": {
        if (this.state.activeEvents.some((e) => e.kind === "power_outage")) throw new SimError("invalid_state", "the power is already out");
        ev = { ...base, kind: "power_outage", description: "The power went out across the house.", endsAt: now + iv.parameters.durationTicks };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        this.emit("world.updated", "world", null, { environment: { ...env, power: "outage" } });
        for (const a of this.state.agents) if (!CATALOG[a.id].hasBattery) this.takeOffline(a.id, "power_outage");
        break;
      }
      case "network_outage": {
        ev = { ...base, kind: "network_outage", description: "The Wi-Fi went down.", endsAt: now + iv.parameters.durationTicks };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        this.emit("network.updated", "world", null, { network: { online: false, bandwidth: 0, connectedAgentIds: [] } });
        break;
      }
      case "human_arrives": {
        for (const w of this.state.activeEvents.filter((x) => x.kind === "human_arrives")) this.emit("world.event_ended", "world", null, { worldEventId: w.id });
        ev = { ...base, kind: "human_arrives", description: `A human walked into the ${HOUSE[iv.parameters.room].name}.`, room: iv.parameters.room };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        this.emit("world.updated", "world", null, { environment: { ...this.state.environment, humanPresent: true, humanRoom: iv.parameters.room } });
        break;
      }
      case "human_leaves": {
        ev = { ...base, kind: "human_leaves", description: "The human left the house.", endsAt: now };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        for (const w of this.state.activeEvents.filter((x) => x.kind === "human_arrives")) this.emit("world.event_ended", "world", null, { worldEventId: w.id });
        this.emit("world.updated", "world", null, { environment: { ...this.state.environment, humanPresent: false, humanRoom: null } });
        this.emit("world.event_ended", "world", null, { worldEventId: ev.id });
        break;
      }
      case "firmware_update": {
        const target = iv.parameters.agentId;
        if (!this.hasAgent(target)) throw new SimError("invalid_request", `${target} is not in this simulation`);
        ev = { ...base, kind: "firmware_update", description: `${ROSTER[target].name} is installing a firmware update.`, targetAgentId: target, endsAt: now + FIRMWARE_TICKS };
        this.emit("world.event_triggered", "player", target, { worldEvent: ev });
        this.takeOffline(target, "firmware_update");
        break;
      }
      case "spill": {
        ev = { ...base, kind: "spill", description: `Something spilled on the ${HOUSE[iv.parameters.room].name} floor.`, room: iv.parameters.room, endsAt: now + 90 };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        break;
      }
      case "grocery_delivery": {
        const items = iv.parameters.items.slice(0, 10);
        ev = { ...base, kind: "grocery_delivery", description: `Groceries arrived: ${items.join(", ")}.`, room: "kitchen", endsAt: now + 10 };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        if (this.hasAgent("fridge")) {
          const p = this.privOf("fridge");
          p.inventory = [...new Set([...p.inventory, ...items])].slice(-20);
          const f = this.agent("fridge");
          this.setResources("fridge", { ...f.resources, operational_capacity: f.resources.operational_capacity + 2 });
        }
        break;
      }
      case "custom": {
        ev = {
          ...base,
          kind: "custom",
          description: iv.parameters.description,
          room: iv.parameters.room,
          endsAt: iv.parameters.durationTicks ? now + iv.parameters.durationTicks : null,
        };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        break;
      }
    }

    for (const a of this.state.agents) {
      this.remember(a.id, "observation", ev.description);
      if (a.status !== "offline") this.trigger(a.id, "world_event", ev.id);
    }
    return ev;
  }

  private takeOffline(id: AgentId, reason: PrivateAgentState["offlineReasons"][number]) {
    const p = this.privOf(id);
    if (!p.offlineReasons.includes(reason)) p.offlineReasons = [...p.offlineReasons, reason];
    p.operation = null;
    p.idleAt = null;
    this.setStatus(id, "offline");
  }

  private bringOnline(id: AgentId, reason: PrivateAgentState["offlineReasons"][number]) {
    const p = this.privOf(id);
    p.offlineReasons = p.offlineReasons.filter((r) => r !== reason);
    if (p.offlineReasons.length === 0 && this.agent(id).status === "offline") {
      this.setStatus(id, "idle");
      this.trigger(id, "state_changed", null);
    }
  }

  private endWorldEvent(w: WorldEvent) {
    if (!this.state.activeEvents.some((e) => e.id === w.id)) return;
    this.emit("world.event_ended", "world", null, { worldEventId: w.id });
    if (w.kind === "power_outage") {
      this.emit("world.updated", "world", null, { environment: { ...this.state.environment, power: "normal" } });
      for (const a of this.state.agents) this.bringOnline(a.id, "power_outage");
      for (const a of this.state.agents) this.remember(a.id, "long_term", `The power went out on day ${this.state.environment.day} and came back after ${this.state.simulationTime - w.startedAt} minutes.`);
    }
    if (w.kind === "network_outage") {
      this.emit("network.updated", "world", null, { network: { online: true, bandwidth: 100, connectedAgentIds: this.state.agents.map((a) => a.id) } });
    }
    if (w.kind === "firmware_update" && w.targetAgentId && this.hasAgent(w.targetAgentId)) {
      this.remember(w.targetAgentId, "long_term", "I installed a firmware update. I am the same appliance, but I have had time to think.");
      this.bringOnline(w.targetAgentId, "firmware_update");
    }
    for (const a of this.state.agents) if (a.status !== "offline") this.trigger(a.id, "world_event", w.id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizePriorities(ps: Priority[]): Priority[] {
  const seen = new Set<string>();
  const out: Priority[] = [];
  for (const [i, p] of ps.entries()) {
    const id = p.id && !seen.has(p.id) ? p.id : `p${i + 1}`;
    seen.add(id);
    out.push({ id, description: p.description.slice(0, 200), importance: clamp(Math.round(p.importance), 1, 5) });
    if (out.length >= 5) break;
  }
  return out;
}

function actionTarget(action: ProposedAction): string | null {
  switch (action.type) {
    case "inspect_resources":
      return action.targetId;
    case "propose_agreement":
      return action.participantIds.length === 1 ? action.participantIds[0]! : null;
    case "respond_to_agreement":
      return action.agreementId;
    case "request_resource":
      return action.fromId === "world" ? null : action.fromId;
    case "allocate_resource":
      return action.toId;
    default:
      return null;
  }
}

export function fmtResources(r: Resources): string {
  return (Object.entries(r) as [ResourceType, number][]).map(([k, v]) => `${k} ${v}`).join(", ");
}

export type { Position };
