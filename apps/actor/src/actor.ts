import { Actor, Emittable, Persisted, type ActorDatabase, type ActorSocket } from "terse-sdk/actor"

// Used by `bun run check` to confirm the actor server is reachable.
export class Counter extends Actor<{ userId: string }, { by: number }, { count: number }> {
    @Persisted
    @Emittable
    count = 0

    async increment(by = 1): Promise<number> {
        this.count += by
        return this.count
    }

    async onMessage(socket: ActorSocket<{ userId: string }, { count: number }>, message: { by: number }): Promise<void> {
        await this.increment(message.by)
        this.broadcast({ count: this.count })
    }
}

// Actor class methods must all be async, so sync helpers live outside the class.
function ensureTable(db: ActorDatabase) {
    db.exec("CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, type TEXT NOT NULL, body TEXT NOT NULL)")
}

export interface StoredEvent {
    seq: number
    type: string
    /** The event as JSON. */
    body: string
}

export interface StoredSimulation {
    /** Creation options as JSON. */
    meta: string | null
    /** Latest engine snapshot as JSON (world state plus private agent state). */
    snapshot: string | null
    snapshotSequence: number
    lastSequence: number
}

/**
 * Durable record of one simulation (actor id = simulation id). The web server
 * is the authority while it runs; this actor keeps the ordered event log and
 * periodic snapshots so a simulation survives a server restart and can be
 * replayed. Payloads are JSON strings: this project must stay self-contained,
 * so validation against the shared contract happens in the web server.
 */
export class SimulationLog extends Actor<{ userId: string }, never, Record<string, never>> {
    @Persisted
    meta: string | null = null

    @Persisted
    snapshot: string | null = null

    @Persisted
    snapshotSequence = 0

    @Persisted
    lastSequence = 0

    async init(meta: string): Promise<void> {
        this.meta = meta
    }

    /** Appends events (ignoring sequences already stored) and optionally replaces the snapshot. */
    async append(events: StoredEvent[], snapshot: string | null, snapshotSequence: number): Promise<number> {
        ensureTable(this.db)
        let last = this.lastSequence
        for (const e of events) {
            this.db.exec("INSERT OR IGNORE INTO events (seq, type, body) VALUES (?, ?, ?)", e.seq, e.type, e.body)
            if (e.seq > last) last = e.seq
        }
        this.lastSequence = last
        if (snapshot !== null) {
            this.snapshot = snapshot
            this.snapshotSequence = snapshotSequence
        }
        return last
    }

    async load(): Promise<StoredSimulation> {
        return { meta: this.meta, snapshot: this.snapshot, snapshotSequence: this.snapshotSequence, lastSequence: this.lastSequence }
    }

    /** Event bodies with sequence > after, oldest first. */
    async events(after: number, limit: number): Promise<string[]> {
        ensureTable(this.db)
        const rows = this.db.exec<{ body: string }>(
            "SELECT body FROM events WHERE seq > ? ORDER BY seq LIMIT ?",
            after,
            Math.min(Math.max(1, limit), 5000),
        )
        return rows.map((r) => r.body)
    }
}
