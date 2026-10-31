import { LlmBrain, RelayTransport } from "@proj/agents";
import { CreateSimulationRequest, DEFAULT_AGENT_IDS, type AgentId, type SimulationMode } from "@proj/contract";
import { Engine, LocalTransport, MockBrain, SimError, SimulationRunner, type MessageTransport } from "@proj/sim";
import { config, log } from "./config";
import { loadSimulation, TerseSink, type StoredMeta } from "./persistence";

// Owns every running simulation in this server process. Kept on globalThis so
// Next's hot reload doesn't orphan running timers.

export interface Simulation {
  id: string;
  mode: SimulationMode;
  engine: Engine;
  runner: SimulationRunner;
  transport: MessageTransport;
  sink: TerseSink | null;
  /** Last time a request touched it; the least recently used simulation is closed first. */
  usedAt: number;
  /** Open live streams (browser tabs) watching this simulation. */
  watchers: number;
  /** When the last watcher left (or the simulation was created). */
  unwatchedSince: number;
}

const g = globalThis as unknown as {
  __sims?: Map<string, Simulation>;
  __simLoads?: Map<string, Promise<Simulation | null>>;
  __simIdleTimer?: ReturnType<typeof setInterval>;
};
const sims = (g.__sims ??= new Map());
const loads = (g.__simLoads ??= new Map());

/** Marks a stream as watching `sim`. Call the returned function when it closes. */
export function watch(sim: Simulation): () => void {
  sim.watchers++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    sim.watchers = Math.max(0, sim.watchers - 1);
    if (sim.watchers === 0) sim.unwatchedSince = Date.now();
  };
}

// Live runs cost OpenAI calls on every decision. Pause any live run nobody is
// watching, e.g. after its tab was closed. Opening the stream again doesn't
// resume it; the player presses play.
if (g.__simIdleTimer) clearInterval(g.__simIdleTimer);
g.__simIdleTimer = setInterval(() => {
  for (const sim of sims.values()) {
    if (sim.mode !== "live" || sim.watchers > 0 || sim.engine.state.status !== "running") continue;
    if (Date.now() - sim.unwatchedSince < config.live.idlePauseMs) continue;
    sim.runner.pause();
    log("registry", "paused live simulation nobody is watching", { simulationId: sim.id, idleMs: Date.now() - sim.unwatchedSince });
  }
}, 5000);

function build(id: string, meta: StoredMeta): Simulation {
  const { mode, seed, tickIntervalMs } = meta.request;
  const agentIds = meta.request.agentIds as AgentId[];
  const scope = `sim ${id.slice(-6)}`;
  const say = (m: string, d?: Record<string, unknown>) => log(scope, m, d);

  let transport: MessageTransport = new LocalTransport();
  if (mode === "live") {
    transport = new RelayTransport({
      workspaceKey: config.relayKey,
      baseUrl: config.relayBaseUrl || undefined,
      simulationId: id,
      agentIds,
      ackTimeoutMs: config.live.relayAckTimeoutMs,
      log: (m, d) => say(m, d),
    });
  }

  const engine = new Engine({ simulationId: id, seed, agentIds, tickIntervalMs, transport });
  const mock = new MockBrain(seed);
  const runner =
    mode === "live"
      ? new SimulationRunner(engine, {
          brain: new LlmBrain({ apiKey: config.openaiKey, model: config.openaiModel }),
          fallback: mock,
          maxDecisions: config.live.budget,
          maxConcurrent: config.live.maxConcurrent,
          decisionIntervalTicks: config.live.decisionIntervalTicks,
          decisionTimeoutMs: config.live.timeoutMs,
          minGapTicks: 3,
          log: say,
        })
      : new SimulationRunner(engine, { brain: mock, decisionIntervalTicks: 6, maxConcurrent: 2, log: say });

  return { id, mode, engine, runner, transport, sink: null, usedAt: Date.now(), watchers: 0, unwatchedSince: Date.now() };
}

async function remember(sim: Simulation) {
  sims.set(sim.id, sim);
  while (sims.size > config.maxSimulations) {
    const oldest = [...sims.values()].sort((a, b) => a.usedAt - b.usedAt)[0]!;
    log("registry", "closing oldest simulation", { simulationId: oldest.id });
    await closeSimulation(oldest.id);
  }
}

export async function createSimulation(input: unknown): Promise<Simulation> {
  const parsed = CreateSimulationRequest.safeParse(input ?? {});
  if (!parsed.success) throw new SimError("invalid_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const req = parsed.data;
  if (req.mode === "live") {
    if (!config.openaiKey) throw new SimError("invalid_request", "live mode needs OPENAI_API_KEY on the server");
    if (!config.relayKey) throw new SimError("invalid_request", "live mode needs RELAY_WORKSPACE_KEY on the server");
  }
  const id = `sim_${req.mode}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const meta: StoredMeta = {
    request: { mode: req.mode, seed: req.seed, tickIntervalMs: req.tickIntervalMs, agentIds: req.agentIds ?? [...DEFAULT_AGENT_IDS] },
    createdAt: new Date().toISOString(),
  };
  const sim = build(id, meta);
  if (config.persist) {
    try {
      await TerseSink.init(id, meta);
      sim.sink = new TerseSink(sim.engine);
    } catch (err) {
      log("terse", "unreachable; this simulation is memory-only", { simulationId: id, error: String(err) });
    }
  }
  await remember(sim);
  log("registry", "created simulation", { simulationId: id, mode: req.mode, agents: meta.request.agentIds.length, persisted: !!sim.sink });
  return sim;
}

/** Finds a simulation in memory, or restores it from Terse. */
export async function getSimulation(id: string): Promise<Simulation> {
  const live = sims.get(id);
  if (live) {
    live.usedAt = Date.now();
    return live;
  }
  if (config.persist && /^sim_[a-z0-9_]+$/i.test(id)) {
    let pending = loads.get(id);
    if (!pending) {
      pending = restore(id).finally(() => loads.delete(id));
      loads.set(id, pending);
    }
    const restored = await pending;
    if (restored) return restored;
  }
  throw new SimError("not_found", `simulation ${id} not found`);
}

async function restore(id: string): Promise<Simulation | null> {
  try {
    const stored = await loadSimulation(id);
    if (!stored) return null;
    const sim = build(id, stored.meta);
    sim.engine.restore(stored.snapshot, stored.laterEvents);
    sim.sink = new TerseSink(sim.engine);
    await remember(sim);
    log("registry", "restored simulation from Terse", { simulationId: id, sequence: sim.engine.state.lastSequence });
    return sim;
  } catch (err) {
    log("terse", "restore failed", { simulationId: id, error: String(err) });
    return null;
  }
}

export async function closeSimulation(id: string) {
  const sim = sims.get(id);
  if (!sim) return;
  sims.delete(id);
  await sim.runner.dispose().catch(() => undefined);
  await sim.sink?.close();
}

export function listSimulations(): Simulation[] {
  return [...sims.values()];
}
