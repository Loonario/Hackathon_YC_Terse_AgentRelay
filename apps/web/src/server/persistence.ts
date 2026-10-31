import { SimulationEvent, type CreateSimulationRequest } from "@proj/contract";
import type { Engine, EngineSnapshot } from "@proj/sim";
import { actors } from "@/generated/index.js";
import { log } from "./config";

// Write-behind persistence to the Terse SimulationLog actor. The in-memory
// engine stays the authority while the server runs. Events are flushed in
// batches; a snapshot is saved every few seconds and on lifecycle changes.
// If Terse is unreachable the simulation keeps running and flushes retry.

export interface StoredMeta {
  request: Required<Pick<CreateSimulationRequest, "mode" | "seed" | "tickIntervalMs">> & { agentIds: string[] };
  createdAt: string;
}

const FLUSH_MS = 1000;
const SNAPSHOT_MS = 10_000;
const MAX_BUFFER = 20_000;
const LIFECYCLE = new Set(["simulation.started", "simulation.paused", "simulation.resumed", "simulation.reset", "simulation.ended"]);

export class TerseSink {
  private buffer: SimulationEvent[] = [];
  private timer: ReturnType<typeof setInterval>;
  private flushing = false;
  private lastSnapshotAt = 0;
  private snapshotDue = true;
  private failures = 0;
  private off: () => void;

  constructor(private engine: Engine) {
    this.off = engine.onEvent((e) => {
      this.buffer.push(e);
      if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
      if (LIFECYCLE.has(e.type)) this.snapshotDue = true;
    });
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
  }

  static async init(id: string, meta: StoredMeta) {
    await actors.SimulationLog.get(id).init(JSON.stringify(meta));
  }

  async flush() {
    if (this.flushing) return;
    // Back off while Terse is down: retry roughly every 2^n seconds, max 30s.
    if (this.failures > 0 && Math.random() > 1 / Math.min(30, 2 ** this.failures)) return;
    const snapshotNow = this.snapshotDue || Date.now() - this.lastSnapshotAt > SNAPSHOT_MS;
    if (this.buffer.length === 0 && !snapshotNow) return;
    this.flushing = true;
    const batch = this.buffer.splice(0, 500);
    const snapshot = snapshotNow ? JSON.stringify(this.engine.exportSnapshot()) : null;
    try {
      await actors.SimulationLog.get(this.engine.id).append(
        batch.map((e) => ({ seq: e.sequence, type: e.type, body: JSON.stringify(e) })),
        snapshot,
        this.engine.state.lastSequence,
      );
      if (snapshot) {
        this.lastSnapshotAt = Date.now();
        this.snapshotDue = false;
      }
      if (this.failures > 0) log("terse", "persistence recovered", { simulationId: this.engine.id });
      this.failures = 0;
    } catch (err) {
      this.buffer.unshift(...batch);
      if (this.failures === 0) log("terse", "persistence failed; will retry", { simulationId: this.engine.id, error: String(err) });
      this.failures++;
    } finally {
      this.flushing = false;
    }
  }

  async close() {
    clearInterval(this.timer);
    this.off();
    this.failures = 0;
    this.snapshotDue = true;
    await this.flush().catch(() => undefined);
  }
}

export interface Restorable {
  meta: StoredMeta;
  snapshot: EngineSnapshot;
  laterEvents: SimulationEvent[];
}

/** Loads a simulation from Terse, or null if it was never stored. */
export async function loadSimulation(id: string): Promise<Restorable | null> {
  const actor = actors.SimulationLog.get(id);
  const stored = await actor.load();
  if (!stored.meta || !stored.snapshot) return null;
  const laterEvents: SimulationEvent[] = [];
  let after = stored.snapshotSequence;
  for (;;) {
    const page = await actor.events(after, 2000);
    for (const body of page) {
      const parsed = SimulationEvent.safeParse(JSON.parse(body));
      if (parsed.success) laterEvents.push(parsed.data);
    }
    if (page.length < 2000) break;
    after = laterEvents.at(-1)?.sequence ?? after + page.length;
  }
  return { meta: JSON.parse(stored.meta) as StoredMeta, snapshot: JSON.parse(stored.snapshot) as EngineSnapshot, laterEvents };
}

/** Stored events after `after`, for replay of history older than what's in memory. */
export async function storedEvents(id: string, after: number, limit: number): Promise<SimulationEvent[]> {
  const page = await actors.SimulationLog.get(id).events(after, limit);
  return page.flatMap((body) => {
    const parsed = SimulationEvent.safeParse(JSON.parse(body));
    return parsed.success ? [parsed.data] : [];
  });
}
