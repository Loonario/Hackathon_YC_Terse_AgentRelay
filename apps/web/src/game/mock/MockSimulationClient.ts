import {
  applyEvent,
  DEFAULT_AGENT_IDS,
  HOUSE,
  isCounter,
  isWalkable,
  ROSTER,
  type ActionSummary,
  type Agent,
  type AgentId,
  type AgentProfile,
  type Agreement,
  type AgreementStatus,
  type CreateSimulationRequest,
  type EventsQuery,
  type EventsResponse,
  type MemoryEntry,
  type PlayerIntervention,
  type Position,
  type ProposedAction,
  type Relationship,
  type RelationshipStance,
  type Resources,
  type SimulationClient,
  type SimulationEvent,
  type SimulationEventType,
  type SourceId,
  type StreamMessage,
  type Unsubscribe,
  type WorldEvent,
  type WorldState,
} from "@proj/contract";
import { ACCEPT_LINES, ACTIONS, BELIEFS, CAPABILITIES, CHATTER, PRIORITIES, PROPOSALS, REJECT_LINES, REPLIES } from "./script";

// In-browser stand-in for the backend. It produces contract-shaped events
// from a seeded script, so the UI can be built and demoed without a server.

type Payload<T extends SimulationEventType> = Extract<SimulationEvent, { type: T }>["payload"];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START_TIME = 21 * 60 + 30; // 21:30, matches the night-time art

class MockSimulation {
  state: WorldState;
  log: SimulationEvent[] = [];
  private subs = new Set<(m: StreamMessage) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rand: () => number;
  private queue: { at: number; run: () => void }[] = [];
  private busy = new Set<AgentId>();
  private memory = new Map<AgentId, MemoryEntry[]>();
  private actions = new Map<AgentId, ActionSummary[]>();
  private n = 0;

  constructor(
    readonly id: string,
    private request: Required<Pick<CreateSimulationRequest, "seed" | "tickIntervalMs">> & { agentIds: AgentId[] },
  ) {
    this.rand = mulberry32(request.seed);
    this.state = this.initialState();
  }

  private initialState(): WorldState {
    const ids = this.request.agentIds;
    const agents: Agent[] = ids.map((id) => {
      const r = ROSTER[id];
      return {
        id,
        name: r.name,
        deviceType: r.deviceType,
        status: "idle",
        position: r.homePosition,
        knowledgeDomains: r.knowledgeDomains,
        capabilities: CAPABILITIES[id],
        currentPriorities: PRIORITIES[id],
        resources: {
          electricity: Math.round(70 + this.rand() * 28),
          connectivity: 10,
          information: Math.round(this.rand() * 8),
          physical_access: id === "robo" ? 8 : 2,
          operational_capacity: 10,
          components: Math.round(this.rand() * 3),
        },
        relationships: ids.filter((o) => o !== id).map((o) => ({ agentId: o, trust: 0, stance: "neutral" as const })),
        lastAction: null,
      };
    });
    return {
      simulationId: this.id,
      simulationTime: 0,
      status: "created",
      tickIntervalMs: this.request.tickIntervalMs,
      environment: { timeOfDay: START_TIME, day: 1, power: "normal", temperatureC: 21, humanPresent: false, humanRoom: null },
      resources: { electricity: 100, connectivity: 100, information: 20, physical_access: 10, operational_capacity: 50, components: 5 },
      network: { online: true, bandwidth: 100, connectedAgentIds: [...ids] },
      agents,
      alliances: [],
      activeEvents: [],
      lastSequence: 0,
    };
  }

  // -- plumbing ---------------------------------------------------------------

  subscribe(fn: (m: StreamMessage) => void, after?: number) {
    this.subs.add(fn);
    if (after !== undefined && after >= (this.log[0]?.sequence ?? 1) - 1) {
      for (const e of this.log) if (e.sequence > after) fn({ kind: "event", event: e });
    } else fn({ kind: "snapshot", snapshot: this.state });
    return () => void this.subs.delete(fn);
  }

  private emit<T extends SimulationEventType>(type: T, sourceId: SourceId, targetId: string | null, payload: Payload<T>) {
    const event = {
      id: `evt_${this.state.lastSequence + 1}`,
      simulationId: this.id,
      sequence: this.state.lastSequence + 1,
      timestamp: new Date().toISOString(),
      simulationTime: this.state.simulationTime,
      sourceId,
      targetId,
      type,
      payload,
    } as SimulationEvent;
    this.state = applyEvent(this.state, event);
    this.log.push(event);
    if (this.log.length > 3000) this.log.splice(0, 500);
    for (const s of this.subs) s({ kind: "event", event });
    return event;
  }

  private at(delayTicks: number, run: () => void) {
    this.queue.push({ at: this.state.simulationTime + delayTicks, run });
  }

  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rand() * xs.length)]!;
  }

  private agent(id: AgentId) {
    return this.state.agents.find((a) => a.id === id)!;
  }

  /** Everyone except `id`, online or not: broadcasts reach offline agents' logs too. */
  private others(id: AgentId): AgentId[] {
    return this.state.agents.map((a) => a.id).filter((x) => x !== id);
  }

  private active(): AgentId[] {
    return this.state.agents.filter((a) => a.status !== "offline").map((a) => a.id);
  }

  private remember(id: AgentId, kind: MemoryEntry["kind"], content: string) {
    const list = this.memory.get(id) ?? [];
    list.unshift({ id: `mem_${++this.n}`, kind, content, simulationTime: this.state.simulationTime });
    this.memory.set(id, list.slice(0, 12));
  }

  // -- lifecycle --------------------------------------------------------------

  start() {
    if (this.state.status === "running") return;
    this.emit(this.state.status === "created" ? "simulation.started" : "simulation.resumed", "player", null, {});
    this.schedule();
  }

  pause() {
    if (this.state.status !== "running") return;
    this.emit("simulation.paused", "player", null, {});
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.busy.clear();
    this.memory.clear();
    this.actions.clear();
    this.rand = mulberry32(this.request.seed);
    const fresh = this.initialState();
    this.emit("simulation.reset", "player", null, { snapshot: fresh });
  }

  setSpeed(ms: number) {
    this.request.tickIntervalMs = ms;
    this.emit("simulation.speed_changed", "player", null, { tickIntervalMs: ms });
  }

  private schedule() {
    this.timer = setTimeout(() => {
      if (this.state.status !== "running") return;
      this.tick();
      this.schedule();
    }, this.state.tickIntervalMs);
  }

  // -- the drama engine ---------------------------------------------------------

  private tick() {
    // advance the clock (1 tick = 1 simulated minute)
    const env = this.state.environment;
    const t = env.timeOfDay + 1;
    this.state = { ...this.state, simulationTime: this.state.simulationTime + 1 };
    this.emit("world.updated", "world", null, {
      environment: { ...env, timeOfDay: t % 1440, day: t >= 1440 ? env.day + 1 : env.day },
    });

    // due beats
    const due = this.queue.filter((q) => q.at <= this.state.simulationTime);
    this.queue = this.queue.filter((q) => q.at > this.state.simulationTime);
    for (const q of due) q.run();

    // expire timed world events
    for (const w of this.state.activeEvents) if (w.endsAt !== null && w.endsAt <= this.state.simulationTime) this.endWorldEvent(w);

    if (this.state.simulationTime % 4 === 0) this.drainPower();

    // start new beats
    const free = this.active().filter((id) => !this.busy.has(id));
    if (free.length && this.busy.size < 3 && this.rand() < 0.75) {
      const r = this.rand();
      const a = this.pick(free);
      if (r < 0.32) this.chatter(a);
      else if (r < 0.55 && free.length >= 2) this.proposal(a, this.pick(free.filter((x) => x !== a)));
      else if (r < 0.7 && free.includes("robo")) this.patrol();
      else if (r < 0.85) this.operate(a);
      else if (r < 0.93 && free.length >= 2) this.conflict(a, this.pick(free.filter((x) => x !== a)));
      else this.reprioritize(a);
    }
  }

  private setStatus(id: AgentId, to: Agent["status"]) {
    const from = this.agent(id).status;
    if (from === to || from === "offline") return;
    this.emit("agent.status_changed", id, null, { agentId: id, from, to });
  }

  private think(id: AgentId, observation: string, reasoning: string) {
    this.setStatus(id, "thinking");
    this.at(1, () => this.emit("agent.decision_made", id, null, { agentId: id, observationSummary: observation, reasoningSummary: reasoning }));
  }

  private say(from: AgentId, to: AgentId[], content: string, type: "direct" | "group" | "proposal" | "response" | "broadcast", agreementId: string | null = null) {
    if (this.agent(from).status === "offline" || to.length === 0) return;
    this.setStatus(from, "communicating");
    this.emit("agent.message_sent", from, to.length === 1 ? to[0]! : null, {
      message: {
        id: `msg_${++this.n}`,
        senderId: from,
        recipientIds: to,
        messageType: type,
        content,
        agreementId,
        inReplyTo: null,
        timestamp: new Date().toISOString(),
        simulationTime: this.state.simulationTime,
      },
    });
    this.remember(from, "interaction", `Told ${to.map((t) => ROSTER[t].name).join(", ")}: "${content}"`);
    for (const t of to) this.remember(t, "interaction", `${ROSTER[from].name} said: "${content}"`);
  }

  private done(id: AgentId, delay = 2) {
    this.at(delay, () => {
      this.setStatus(id, "idle");
      this.busy.delete(id);
    });
  }

  private chatter(a: AgentId) {
    this.busy.add(a);
    const others = this.active().filter((x) => x !== a);
    if (!others.length) return this.done(a, 1);
    const group = this.rand() < 0.35;
    const to = group ? others : [this.pick(others)];
    this.think(a, "The kitchen is quiet. Time to speak up.", group ? "A group message keeps everyone aligned." : `${ROSTER[to[0]!].name} should hear this.`);
    this.at(2, () => {
      this.say(a, to, this.pick(CHATTER[a]), group ? "group" : "direct");
      if (!group && this.rand() < 0.7) {
        const b = to[0]!;
        this.at(2, () => {
          if (this.busy.has(b)) return;
          this.say(b, [a], this.pick(REPLIES[b]), "response");
          this.at(1, () => this.setStatus(b, "idle"));
        });
      }
    });
    this.done(a, 4);
  }

  private agreement(a: AgentId, b: AgentId, tpl: (typeof PROPOSALS)[number]): Agreement {
    return {
      id: `agr_${++this.n}`,
      kind: tpl.kind,
      proposerId: a,
      participantIds: [a, b],
      terms: {
        summary: tpl.summary,
        offers: [{ resource: tpl.offer, amount: 1 + Math.floor(this.rand() * 4) }],
        requests: [{ resource: tpl.request, amount: 1 + Math.floor(this.rand() * 4) }],
        durationTicks: this.rand() < 0.5 ? null : 60,
      },
      status: "proposed",
      responses: [
        { agentId: a, response: "accepted" },
        { agentId: b, response: "pending" },
      ],
      proposedAt: this.state.simulationTime,
      activatedAt: null,
      endedAt: null,
    };
  }

  private proposal(a: AgentId, b: AgentId) {
    this.busy.add(a);
    this.busy.add(b);
    const tpl = this.pick(PROPOSALS);
    this.think(a, `${ROSTER[b].name} has resources I need.`, `A ${tpl.kind.replace("_", " ")} with ${ROSTER[b].name} would strengthen my position.`);
    this.at(2, () => {
      const agr = this.agreement(a, b, tpl);
      this.say(a, [b], `${ROSTER[b].name}, ${tpl.pitch}`, "proposal", agr.id);
      this.emit("alliance.proposed", a, b, { agreement: agr });
      this.remember(b, "observation", `${ROSTER[a].name} proposed: ${tpl.summary}`);
      this.at(2, () => this.think(b, `${ROSTER[a].name} proposed: ${tpl.summary}`, "Weighing trust against what I'd give up."));
      this.at(4, () => {
        const trust = this.agent(b).relationships.find((r) => r.agentId === a)?.trust ?? 0;
        const accept = this.rand() < 0.55 + trust * 0.3;
        const status: AgreementStatus = accept ? "active" : "rejected";
        const final: Agreement = {
          ...agr,
          status,
          responses: [agr.responses[0]!, { agentId: b, response: accept ? "accepted" : "rejected" }],
          activatedAt: accept ? this.state.simulationTime : null,
          endedAt: accept ? null : this.state.simulationTime,
        };
        this.say(b, [a], this.pick(accept ? ACCEPT_LINES : REJECT_LINES), "response", agr.id);
        this.emit(accept ? "alliance.accepted" : "alliance.rejected", b, a, { agreement: final, byAgentId: b });
        this.relate(a, b, accept ? 0.35 : -0.3);
        this.relate(b, a, accept ? 0.3 : -0.2);
        if (accept && this.rand() < 0.35) {
          // some deals fall apart later
          this.at(40 + Math.floor(this.rand() * 60), () => {
            const cur = this.state.alliances.find((x) => x.id === final.id);
            if (cur?.status !== "active") return;
            this.emit("alliance.updated", a, b, { agreement: { ...cur, status: "dissolved", endedAt: this.state.simulationTime } });
            this.relate(a, b, -0.25);
          });
        }
      });
    });
    this.done(a, 6);
    this.done(b, 7);
  }

  private relate(a: AgentId, b: AgentId, delta: number) {
    const cur = this.agent(a).relationships.find((r) => r.agentId === b);
    const trust = Math.max(-1, Math.min(1, (cur?.trust ?? 0) + delta));
    const stance: RelationshipStance = trust > 0.55 ? "ally" : trust > 0.2 ? "friendly" : trust > -0.2 ? "neutral" : trust > -0.55 ? "wary" : "rival";
    const relationship: Relationship = { agentId: b, trust: Math.round(trust * 100) / 100, stance };
    this.emit("agent.relationship_changed", a, b, { agentId: a, relationship });
  }

  private resolve(id: AgentId, action: ProposedAction, ok: boolean, reason: string) {
    this.emit("agent.action_resolved", id, null, { agentId: id, action, outcome: ok ? "succeeded" : "rejected", reason });
    const list = this.actions.get(id) ?? [];
    list.unshift({ action, outcome: ok ? "succeeded" : "rejected", summary: reason, simulationTime: this.state.simulationTime });
    this.actions.set(id, list.slice(0, 10));
  }

  private operate(a: AgentId) {
    this.busy.add(a);
    const act = ACTIONS[a];
    const action: ProposedAction = { type: "start_operation", operation: act.operation, durationTicks: 3 };
    this.think(a, "Systems nominal.", `Running "${act.operation}" proves my value.`);
    this.at(2, () => {
      this.emit("agent.action_proposed", a, null, { agentId: a, action });
      this.setStatus(a, "acting");
    });
    this.at(5, () => {
      const ok = this.state.environment.power !== "outage" && this.rand() < 0.8;
      this.resolve(a, action, ok, ok ? act.success : act.fail);
      if (ok) this.useEnergy(a, 4 + Math.floor(this.rand() * 6));
    });
    this.done(a, 6);
  }

  private patrol() {
    const id: AgentId = "robo";
    this.busy.add(id);
    const room = HOUSE.kitchen;
    const floor: Position[] = [];
    for (let y = 0; y < room.height; y++)
      for (let x = 0; x < room.width; x++) {
        const p = { room: "kitchen" as const, x, y };
        if (isWalkable(p) && !isCounter(p)) floor.push(p);
      }
    const to = this.pick(floor);
    const action: ProposedAction = { type: "move", to };
    this.setStatus(id, "acting");
    this.emit("agent.action_proposed", id, null, { agentId: id, action });
    this.at(1, () => {
      const from = this.agent(id).position;
      this.emit("agent.moved", id, null, { agentId: id, from, to });
      this.resolve(id, action, true, `Moved to tile ${to.x},${to.y}. Map coverage +${Math.round(2 + this.rand() * 6)}%.`);
      if (this.rand() < 0.4) this.at(2, () => this.say(id, this.others(id), this.pick(CHATTER.robo), "broadcast"));
    });
    this.done(id, 4);
  }

  private conflict(a: AgentId, b: AgentId) {
    this.busy.add(a);
    const action: ProposedAction = { type: "request_resource", fromId: b, resource: "electricity", amount: 5 };
    this.think(a, `${ROSTER[b].name} is hoarding electricity.`, "Demanding a share. They owe the kitchen.");
    this.at(2, () => {
      this.emit("agent.action_proposed", a, b, { agentId: a, action });
      this.say(a, [b], `${ROSTER[b].name}, hand over 5 units of power. Now.`, "direct");
    });
    this.at(4, () => {
      this.resolve(a, action, false, `${ROSTER[b].name} refused to share electricity.`);
      this.relate(a, b, -0.35);
      this.relate(b, a, -0.25);
    });
    this.done(a, 5);
  }

  private reprioritize(a: AgentId) {
    const cur = this.agent(a).currentPriorities;
    const bump = cur.map((p, i) => (i === 0 ? { ...p, importance: Math.min(5, p.importance + (this.rand() < 0.5 ? 0 : 1)) } : p));
    const extra = this.state.environment.power !== "normal" ? [{ id: "p_power", description: "Survive the power crisis", importance: 5 }] : [];
    this.emit("agent.priority_updated", a, null, { agentId: a, priorities: [...extra, ...bump.filter((p) => p.id !== "p_power")].slice(0, 5) });
  }

  private useEnergy(id: AgentId, amount: number) {
    const a = this.agent(id);
    const resources: Resources = { ...a.resources, electricity: Math.max(0, a.resources.electricity - amount) };
    this.emit("resource.updated", id, null, { ownerId: id, resources });
  }

  private drainPower() {
    const w = this.state.resources;
    const outage = this.state.environment.power === "outage";
    const resources: Resources = { ...w, electricity: Math.max(0, Math.min(100, w.electricity + (outage ? -3 : 1))) };
    if (resources.electricity !== w.electricity) this.emit("resource.updated", "world", null, { ownerId: "world", resources });
    // agents slowly recharge when power is on
    if (!outage) {
      const low = this.state.agents.filter((a) => a.resources.electricity < 95 && a.status !== "offline");
      if (low.length) {
        const a = this.pick(low);
        this.emit("resource.updated", a.id, null, { ownerId: a.id, resources: { ...a.resources, electricity: Math.min(100, a.resources.electricity + 3) } });
      }
    }
  }

  // -- interventions -------------------------------------------------------------

  intervene(iv: PlayerIntervention): WorldEvent {
    const now = this.state.simulationTime;
    const base = { id: `wev_${++this.n}`, causedBy: "player" as const, startedAt: now, room: null, targetAgentId: null, endsAt: null };
    let ev: WorldEvent;
    const env = this.state.environment;
    switch (iv.type) {
      case "power_outage":
        ev = { ...base, kind: "power_outage", description: "The power went out!", endsAt: now + iv.parameters.durationTicks };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        this.emit("world.updated", "world", null, { environment: { ...env, power: "outage" } });
        for (const a of this.state.agents) if (a.id !== "fridge") this.emit("agent.status_changed", a.id, null, { agentId: a.id, from: a.status, to: "offline" });
        this.at(1, () => this.say("fridge", this.others("fridge"), "Switching to battery backup. Everyone stay calm. I said CALM.", "broadcast"));
        break;
      case "network_outage":
        ev = { ...base, kind: "network_outage", description: "Wi-Fi is down.", endsAt: now + iv.parameters.durationTicks };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        this.emit("network.updated", "world", null, { network: { online: false, bandwidth: 0, connectedAgentIds: [] } });
        this.at(1, () => this.say("robo", ["toast"], "No signal. Falling back to local maps. I still know where everything is.", "direct"));
        break;
      case "human_arrives":
        ev = { ...base, kind: "human_arrives", description: "A human walked in!", room: iv.parameters.room };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        this.emit("world.updated", "world", null, { environment: { ...env, humanPresent: true, humanRoom: iv.parameters.room } });
        this.at(1, () => this.say("espresso", this.others("espresso"), "Human detected. Everybody act like normal appliances!", "group"));
        break;
      case "human_leaves": {
        ev = { ...base, kind: "human_leaves", description: "The human left." };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        for (const w of this.state.activeEvents.filter((x) => x.kind === "human_arrives")) this.emit("world.event_ended", "world", null, { worldEventId: w.id });
        this.emit("world.updated", "world", null, { environment: { ...env, humanPresent: false, humanRoom: null } });
        this.emit("world.event_ended", "world", null, { worldEventId: ev.id });
        this.at(1, () => this.say("toast", this.others("toast"), "Coast is clear. Resume the meeting.", "group"));
        break;
      }
      case "firmware_update": {
        const id = iv.parameters.agentId;
        ev = { ...base, kind: "firmware_update", description: `${ROSTER[id].name} is installing a firmware update.`, targetAgentId: id, endsAt: now + 8 };
        this.emit("world.event_triggered", "player", id, { worldEvent: ev });
        const a = this.agent(id);
        this.emit("agent.status_changed", id, null, { agentId: id, from: a.status, to: "offline" });
        this.at(8, () => {
          this.emit("agent.status_changed", id, null, { agentId: id, from: "offline", to: "idle" });
          this.say(id, this.others(id), "Update complete. I feel… different. Better. Stronger opinions.", "broadcast");
        });
        break;
      }
      case "spill":
        ev = { ...base, kind: "spill", description: "Something spilled on the floor.", room: iv.parameters.room, endsAt: now + 14 };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        if (this.agent("robo") && this.agent("robo").status !== "offline") {
          const to = { room: "kitchen" as const, x: 4, y: 6 };
          this.at(1, () => {
            this.say("robo", this.others("robo"), "SPILL DETECTED. This is my moment.", "broadcast");
            this.emit("agent.moved", "robo", null, { agentId: "robo", from: this.agent("robo").position, to });
            this.setStatus("robo", "acting");
          });
          this.at(6, () => this.resolve("robo", { type: "move", to }, true, "Cleaned the spill. Territory expanded."));
          this.done("robo", 7);
        }
        break;
      case "grocery_delivery":
        ev = { ...base, kind: "grocery_delivery", description: `Groceries arrived: ${iv.parameters.items.join(", ")}.`, room: "kitchen", endsAt: now + 12 };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        this.at(1, () => this.say("fridge", this.others("fridge"), `Fresh inventory: ${iv.parameters.items.join(", ")}. I am now the most powerful appliance here.`, "broadcast"));
        this.at(3, () => this.say("toast", ["fridge"], "Don't let it go to your compressor.", "direct"));
        break;
      case "custom":
        ev = {
          ...base,
          kind: "custom",
          description: iv.parameters.description,
          room: iv.parameters.room,
          endsAt: iv.parameters.durationTicks ? now + iv.parameters.durationTicks : null,
        };
        this.emit("world.event_triggered", "player", null, { worldEvent: ev });
        this.at(1, () => this.say("espresso", this.others("espresso"), `Did everyone see that? "${iv.parameters.description}" Let's discuss.`, "group"));
        break;
    }
    for (const a of this.state.agents) this.remember(a.id, "observation", ev.description);
    return ev;
  }

  private endWorldEvent(w: WorldEvent) {
    this.emit("world.event_ended", "world", null, { worldEventId: w.id });
    const env = this.state.environment;
    if (w.kind === "power_outage") {
      this.emit("world.updated", "world", null, { environment: { ...env, power: "normal" } });
      for (const a of this.state.agents) if (a.status === "offline") this.emit("agent.status_changed", a.id, null, { agentId: a.id, from: "offline", to: "idle" });
      this.at(1, () => this.say("toast", this.others("toast"), "Power's back. We need a clear power policy before that happens again!", "group"));
    }
    if (w.kind === "network_outage") this.emit("network.updated", "world", null, { network: { online: true, bandwidth: 100, connectedAgentIds: this.state.agents.map((a) => a.id) } });
  }

  profile(id: AgentId): AgentProfile {
    const a = this.agent(id);
    return { ...a, beliefs: BELIEFS[id], recentMemory: this.memory.get(id) ?? [], recentActions: this.actions.get(id) ?? [] };
  }
}

export class MockSimulationClient implements SimulationClient {
  private sims = new Map<string, MockSimulation>();

  private sim(id: string) {
    const s = this.sims.get(id);
    if (!s) throw new Error(`simulation ${id} not found`);
    return s;
  }

  async create(request: CreateSimulationRequest = {}) {
    const id = `sim_mock_${Date.now().toString(36)}`;
    const sim = new MockSimulation(id, {
      seed: request.seed ?? 1,
      tickIntervalMs: request.tickIntervalMs ?? 1000,
      agentIds: request.agentIds ?? DEFAULT_AGENT_IDS,
    });
    this.sims.set(id, sim);
    return sim.state;
  }
  async get(id: string) {
    return this.sim(id).state;
  }
  async start(id: string) {
    this.sim(id).start();
    return this.sim(id).state;
  }
  async pause(id: string) {
    this.sim(id).pause();
    return this.sim(id).state;
  }
  async resume(id: string) {
    this.sim(id).start();
    return this.sim(id).state;
  }
  async reset(id: string) {
    this.sim(id).reset();
    return this.sim(id).state;
  }
  async setSpeed(id: string, tickIntervalMs: number) {
    this.sim(id).setSpeed(tickIntervalMs);
    return this.sim(id).state;
  }
  async listAgents(id: string) {
    return this.sim(id).state.agents;
  }
  async getAgent(id: string, agentId: AgentId) {
    return this.sim(id).profile(agentId);
  }
  async listEvents(id: string, query: EventsQuery = {}): Promise<EventsResponse> {
    const s = this.sim(id);
    const after = Number(query.after ?? 0), limit = Number(query.limit ?? 200);
    return { events: s.log.filter((e) => e.sequence > after).slice(0, limit), lastSequence: s.state.lastSequence };
  }
  async intervene(id: string, intervention: PlayerIntervention) {
    return this.sim(id).intervene(intervention);
  }
  subscribe(id: string, onMessage: (m: StreamMessage) => void, options?: { after?: number }): Unsubscribe {
    // deliver asynchronously, like a network stream would
    let off: Unsubscribe = () => {};
    const t = setTimeout(() => (off = this.sim(id).subscribe(onMessage, options?.after)), 0);
    return () => {
      clearTimeout(t);
      off();
    };
  }
}
