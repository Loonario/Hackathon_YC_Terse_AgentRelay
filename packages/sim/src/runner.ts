import { AgentDecision, type AgentId, type DecisionTrigger, type PlayerIntervention, type WorldEvent } from "@proj/contract";
import type { Engine } from "./engine.ts";
import { buildContext } from "./observe.ts";
import type { AgentBrain, AgentContext } from "./types.ts";

export interface RunnerOptions {
  /** Main decision maker (LLM in live mode, scripted in mock mode). */
  brain: AgentBrain;
  /** Used when the main brain fails, times out, or the budget is spent. */
  fallback?: AgentBrain;
  /** Every agent gets a scheduled decision at least this often (ticks). */
  decisionIntervalTicks?: number;
  /** Minimum ticks between two decisions of the same agent. */
  minGapTicks?: number;
  /** Decisions allowed in flight at once, across all agents. */
  maxConcurrent?: number;
  /** Main-brain decisions allowed per run (reset restores it). Then the fallback takes over. */
  maxDecisions?: number;
  decisionTimeoutMs?: number;
  /** A decision is applied no sooner than this many ticks after it started, so "thinking" is visible. */
  minThinkTicks?: number;
  /** After this many consecutive main-brain failures, use the fallback for `cooldownTicks`. */
  failureThreshold?: number;
  cooldownTicks?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

interface InFlight {
  controller: AbortController;
  startedAt: number;
  generation: number;
  result: AgentDecision | null;
  failed: boolean;
  brain: AgentBrain["kind"];
}

export interface RunnerStats {
  decisions: { main: number; fallback: number; failed: number };
  budgetRemaining: number;
  inFlight: AgentId[];
  circuitOpen: boolean;
}

const TRIGGER_ORDER: DecisionTrigger["reason"][] = ["agreement_pending", "message_received", "world_event", "state_changed", "scheduled"];

/**
 * Drives one simulation: ticks the world on a timer, decides which agents
 * should think, runs their brains with a budget, a concurrency cap and
 * timeouts, and feeds the decisions back into the engine.
 */
export class SimulationRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = new Map<AgentId, InFlight>();
  private used = 0;
  private stats_ = { main: 0, fallback: 0, failed: 0 };
  private consecutiveFailures = 0;
  private circuitOpenUntil = -1;
  private readonly o: Required<Omit<RunnerOptions, "fallback" | "log">> & Pick<RunnerOptions, "fallback" | "log">;

  constructor(
    readonly engine: Engine,
    options: RunnerOptions,
  ) {
    this.o = {
      decisionIntervalTicks: 12,
      minGapTicks: 2,
      maxConcurrent: 3,
      maxDecisions: 500,
      decisionTimeoutMs: 20_000,
      minThinkTicks: 1,
      failureThreshold: 3,
      cooldownTicks: 30,
      ...options,
    };
  }

  get mode() {
    return this.o.brain.kind;
  }

  // -- lifecycle -------------------------------------------------------------

  start() {
    this.engine.start();
    this.schedule();
  }

  pause() {
    this.engine.pause();
    this.stopTimer();
  }

  reset() {
    this.stopTimer();
    for (const f of this.inFlight.values()) f.controller.abort();
    this.inFlight.clear();
    this.used = 0;
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = -1;
    this.engine.reset();
  }

  setSpeed(tickIntervalMs: number) {
    this.engine.setSpeed(tickIntervalMs);
    if (this.timer) {
      this.stopTimer();
      this.schedule();
    }
  }

  intervene(iv: PlayerIntervention): WorldEvent {
    return this.engine.intervene(iv);
  }

  async dispose() {
    this.stopTimer();
    for (const f of this.inFlight.values()) f.controller.abort();
    this.inFlight.clear();
    await this.engine.transport.close();
  }

  stats(): RunnerStats {
    return {
      decisions: { ...this.stats_ },
      budgetRemaining: Math.max(0, this.o.maxDecisions - this.used),
      inFlight: [...this.inFlight.keys()],
      circuitOpen: this.engine.state.simulationTime < this.circuitOpenUntil,
    };
  }

  private schedule() {
    if (this.timer || this.engine.state.status !== "running") return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.engine.state.status !== "running") return;
      try {
        this.step();
      } catch (err) {
        this.o.log?.("tick failed", { error: String(err) });
      }
      this.schedule();
    }, this.engine.state.tickIntervalMs);
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // -- one tick ----------------------------------------------------------------

  /** Advances the world by one tick. Public so tests can drive it by hand. */
  step() {
    const engine = this.engine;
    if (engine.state.status !== "running") return;
    engine.tick();
    const now = engine.state.simulationTime;

    // Apply finished decisions in a stable order.
    for (const a of engine.state.agents) {
      const f = this.inFlight.get(a.id);
      if (!f) continue;
      if (f.generation !== engine.generation) {
        this.inFlight.delete(a.id);
        continue;
      }
      if (f.failed) {
        this.inFlight.delete(a.id);
        engine.endThinking(a.id);
      } else if (f.result && now >= f.startedAt + this.o.minThinkTicks) {
        this.inFlight.delete(a.id);
        engine.applyDecision(f.result, { startedAt: f.startedAt, generation: f.generation });
      }
    }

    // Scheduled wake-ups.
    for (const a of engine.state.agents) {
      if (this.inFlight.has(a.id) || a.status === "offline") continue;
      if (now - engine.schedulingInfo(a.id).lastDecisionAt >= this.o.decisionIntervalTicks) engine.trigger(a.id, "scheduled");
    }

    // Start new decisions.
    const slots = this.o.maxConcurrent - this.inFlight.size;
    if (slots <= 0) return;
    const candidates = engine.state.agents
      .filter((a) => a.status !== "offline" && !this.inFlight.has(a.id))
      .map((a) => ({ id: a.id, info: engine.schedulingInfo(a.id) }))
      .filter(({ info }) => info.triggers.length > 0 && now - info.lastDecisionAt >= this.o.minGapTicks)
      .sort((x, y) => rank(x.info.triggers) - rank(y.info.triggers) || x.info.lastDecisionAt - y.info.lastDecisionAt);

    for (const { id } of candidates.slice(0, slots)) this.begin(id);
  }

  private begin(id: AgentId) {
    const engine = this.engine;
    const trigger = engine.takeTrigger(id);
    const context = buildContext(engine, id, trigger);
    const now = engine.state.simulationTime;
    const useMain = this.used < this.o.maxDecisions && now >= this.circuitOpenUntil;
    const brain = useMain ? this.o.brain : (this.o.fallback ?? this.o.brain);
    if (brain === this.o.brain) this.used++;

    const flight: InFlight = {
      controller: new AbortController(),
      startedAt: now,
      generation: engine.generation,
      result: null,
      failed: false,
      brain: brain.kind,
    };
    this.inFlight.set(id, flight);
    engine.beginThinking(id);

    void this.run(brain, context, flight).then(
      (decision) => {
        flight.result = decision;
      },
      (err) => {
        flight.failed = true;
        this.stats_.failed++;
        // Decisions cancelled by a reset are expected, not failures worth logging.
        if (flight.generation === this.engine.generation) this.o.log?.("decision failed", { agentId: id, error: String(err) });
      },
    );
  }

  private async run(brain: AgentBrain, context: AgentContext, flight: InFlight): Promise<AgentDecision> {
    const id = context.self.id;
    const timeout = setTimeout(() => flight.controller.abort(new Error("decision timed out")), this.o.decisionTimeoutMs);
    try {
      const raw = await brain.decide(context, flight.controller.signal);
      const decision = AgentDecision.parse({ ...raw, agentId: id });
      if (brain === this.o.brain) this.consecutiveFailures = 0;
      brain === this.o.brain ? this.stats_.main++ : this.stats_.fallback++;
      return decision;
    } catch (err) {
      if (flight.generation !== this.engine.generation) throw err;
      const fallback = this.o.fallback;
      if (brain === this.o.brain) {
        this.consecutiveFailures++;
        this.o.log?.(`${brain.kind} brain failed, using fallback`, { agentId: id, error: String(err) });
        if (this.consecutiveFailures >= this.o.failureThreshold) {
          this.circuitOpenUntil = this.engine.state.simulationTime + this.o.cooldownTicks;
          this.consecutiveFailures = 0;
          this.o.log?.("too many failures, fallback brain for a while", { untilTick: this.circuitOpenUntil });
        }
      }
      if (!fallback || fallback === brain) throw err;
      const decision = AgentDecision.parse({ ...(await fallback.decide(context, new AbortController().signal)), agentId: id });
      this.stats_.fallback++;
      return decision;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function rank(triggers: DecisionTrigger[]): number {
  return Math.min(...triggers.map((t) => TRIGGER_ORDER.indexOf(t.reason)));
}
