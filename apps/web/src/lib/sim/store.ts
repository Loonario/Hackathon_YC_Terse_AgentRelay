import {
  applyEvent,
  type AgentId,
  type AgentMessage,
  type AgentProfile,
  type PlayerIntervention,
  type SimulationClient,
  type SimulationEvent,
  type StreamMessage,
  type WorldState,
} from "@proj/contract";
import { GameBridge } from "@/game/bridge";

// Client-side simulation store. Holds the latest snapshot (kept in sync with
// the contract's `applyEvent`), the event log and UI selection, and forwards
// everything to the Phaser world through the bridge.

export type View = "world" | "board";

export interface SimState {
  snapshot: WorldState | null;
  events: SimulationEvent[];
  messages: AgentMessage[];
  selected: AgentId | null;
  profile: AgentProfile | null;
  view: View;
  unseenEvents: number;
  error: string | null;
}

const MAX_EVENTS = 600;

/** Events worth showing in the timeline (clock ticks and status churn are noise). */
export const TIMELINE_TYPES = new Set<SimulationEvent["type"]>([
  "simulation.started",
  "simulation.paused",
  "simulation.resumed",
  "simulation.reset",
  "simulation.ended",
  "world.event_triggered",
  "world.event_ended",
  "agent.joined",
  "agent.moved",
  "agent.action_resolved",
  "agent.relationship_changed",
  "agent.priority_updated",
  "agent.message_sent",
  "alliance.proposed",
  "alliance.accepted",
  "alliance.rejected",
  "alliance.updated",
]);

export class SimulationStore {
  readonly bridge = new GameBridge();
  private state: SimState = { snapshot: null, events: [], messages: [], selected: null, profile: null, view: "world", unseenEvents: 0, error: null };
  private listeners = new Set<() => void>();
  private unsub: (() => void) | null = null;
  private simId: string | null = null;
  private profileTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private client: SimulationClient) {
    this.bridge.fromGame.on("select", (id) => this.select(id));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<SimState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async connect() {
    if (this.simId) return;
    try {
      // Server mode: "live" = LLM agents over Agent Relay (default), "mock" = scripted agents on
      // the server. Override with ?mode=mock or NEXT_PUBLIC_SIM_MODE.
      const q = new URLSearchParams(location.search);
      const mode = q.get("mode") === "mock" || (!q.get("mode") && process.env.NEXT_PUBLIC_SIM_MODE === "mock") ? "mock" : "live";
      const sim = await this.client.create({ mode, seed: 7, tickIntervalMs: 1000 });
      this.simId = sim.simulationId;
      this.unsub = this.client.subscribe(sim.simulationId, (m) => this.onMessage(m));
      // ?autostart=1 starts right away (demos, screenshots); ?speed=250 sets the tick interval
      if (q.get("speed")) await this.client.setSpeed(sim.simulationId, Number(q.get("speed")));
      if (q.has("autostart")) await this.client.start(sim.simulationId);
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  disconnect() {
    this.unsub?.();
    this.unsub = null;
  }

  private onMessage(m: StreamMessage) {
    if (m.kind === "heartbeat") return;
    if (m.kind === "snapshot") {
      this.bridge.lastSnapshot = m.snapshot;
      this.set({ snapshot: m.snapshot });
      this.bridge.toGame.emit("snapshot", m.snapshot);
      return;
    }
    const prev = this.state.snapshot;
    if (!prev) return;
    const event = m.event;
    const next = applyEvent(prev, event);
    if (next === prev) return;
    this.bridge.lastSnapshot = next;
    const patch: Partial<SimState> = { snapshot: next };
    if (TIMELINE_TYPES.has(event.type)) {
      patch.events = [...this.state.events, event].slice(-MAX_EVENTS);
      if (this.state.view !== "board" && event.type.startsWith("world.")) patch.unseenEvents = this.state.unseenEvents + 1;
    }
    if (event.type === "agent.message_sent") patch.messages = [...this.state.messages, event.payload.message].slice(-200);
    if (event.type === "simulation.reset") Object.assign(patch, { events: [event], messages: [], unseenEvents: 0 });
    this.set(patch);
    this.bridge.toGame.emit("event", { event, state: next });
    if (this.state.selected && involves(event, this.state.selected)) this.refreshProfile();
  }

  // -- player controls ----------------------------------------------------------

  private async run(fn: (id: string) => Promise<unknown>) {
    if (!this.simId) return;
    try {
      await fn(this.simId);
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  start = () => this.run((id) => this.client.start(id));
  pause = () => this.run((id) => this.client.pause(id));
  resume = () => this.run((id) => this.client.resume(id));
  reset = () => this.run((id) => this.client.reset(id));
  setSpeed = (ms: number) => this.run((id) => this.client.setSpeed(id, ms));
  intervene = (iv: PlayerIntervention) => this.run((id) => this.client.intervene(id, iv));

  select = (id: AgentId | null) => {
    if (id === this.state.selected) return;
    this.set({ selected: id, profile: null });
    this.bridge.toGame.emit("select", id);
    if (id) this.refreshProfile(true);
  };

  focus = (id: AgentId) => {
    this.select(id);
    if (this.state.view !== "world") this.set({ view: "world" });
    this.bridge.toGame.emit("focus", id);
  };

  setView = (view: View) => this.set({ view, unseenEvents: view === "board" ? this.state.unseenEvents : this.state.unseenEvents });
  clearUnseen = () => this.set({ unseenEvents: 0 });
  dismissError = () => this.set({ error: null });

  private refreshProfile(now = false) {
    if (this.profileTimer) return;
    this.profileTimer = setTimeout(
      async () => {
        this.profileTimer = null;
        const id = this.state.selected;
        if (!id || !this.simId) return;
        try {
          const profile = await this.client.getAgent(this.simId, id);
          if (this.state.selected === id) this.set({ profile });
        } catch {
          /* profile is optional; the snapshot still shows the basics */
        }
      },
      now ? 0 : 400,
    );
  }
}

function involves(e: SimulationEvent, id: AgentId) {
  if (e.sourceId === id || e.targetId === id) return true;
  const p = e.payload as { agentId?: string; message?: AgentMessage };
  return p.agentId === id || !!p.message?.recipientIds.includes(id);
}
