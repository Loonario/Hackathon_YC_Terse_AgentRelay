import { AgentRelay, type RelayAgentClient } from "@agent-relay/sdk";
import { ROSTER, type AgentId, type AgentMessage } from "@proj/contract";
import type { MessageTransport } from "@proj/sim";

export interface RelayTransportOptions {
  workspaceKey: string;
  /** Self-hosted Relaycast origin, e.g. http://localhost:8787. Omit for Agent Relay Cloud. */
  baseUrl?: string;
  simulationId: string;
  agentIds: AgentId[];
  /** Relay agent names are `${prefix}-${agentId}-${simulation suffix}`. */
  prefix?: string;
  /**
   * How long the simulation waits for Relay to accept a message before it
   * records the message anyway. Relay keeps delivering in the background.
   */
  ackTimeoutMs?: number;
  /** Sends in flight to Relay at once. Relay rejects bursts with "write capacity is busy". */
  maxInFlight?: number;
  /** Beyond this many queued sends, new messages skip Relay (recorded locally). */
  maxQueue?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface RelayStats {
  ready: boolean;
  channel: string | null;
  sent: number;
  acked: number;
  ackedLate: number;
  failed: number;
  skipped: number;
  queued: number;
  agentNames: string[];
  error: string | null;
}

/**
 * Carries agent messages over Agent Relay. Each appliance is registered as a
 * Relay agent for this simulation. Direct messages go to `@name`, group
 * messages to a group DM, and messages to everyone to the simulation's
 * `#channel`. The contract message rides along in `metadata`.
 *
 * The engine records a message when Relay acknowledges it, or after
 * `ackTimeoutMs` if Relay is slow, so the show goes on while Relay catches up.
 */
export class RelayTransport implements MessageTransport {
  readonly kind = "relay" as const;
  readonly ready: Promise<void>;

  private relay: AgentRelay;
  private handler: ((m: AgentMessage) => void) | null = null;
  private clients = new Map<AgentId, RelayAgentClient>();
  private channel: string | null = null;
  private names: Record<AgentId, string>;
  private baseName: string;
  private inFlight = 0;
  private queue: (() => void)[] = [];
  private closed = false;
  private s = { sent: 0, acked: 0, ackedLate: 0, failed: 0, skipped: 0 };
  private error: string | null = null;
  private ready_ = false;

  constructor(private o: RelayTransportOptions) {
    // agent-relay 14 fails to re-register an existing name, so names are per simulation.
    const suffix = o.simulationId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-8);
    const prefix = o.prefix ?? "uprising";
    this.baseName = `${prefix}-%s-${suffix}`;
    this.names = this.namesFor(0);
    this.relay = new AgentRelay({
      workspaceKey: o.workspaceKey,
      ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}),
      onError: (err) => o.log?.("relay listener error", { error: String(err) }),
    });
    this.ready = this.connect(`${prefix}-${suffix}`);
    this.ready.catch(() => undefined);
  }

  private namesFor(attempt: number): Record<AgentId, string> {
    return Object.fromEntries(this.o.agentIds.map((id) => [id, this.nameFor(id, attempt)])) as Record<AgentId, string>;
  }

  private nameFor(id: AgentId, attempt: number) {
    return this.baseName.replace("%s", id) + (attempt === 0 ? "" : `r${attempt}`);
  }

  /**
   * Registers agents one at a time (a single batch call fails more often under
   * load) and keeps the ones that succeed. A failed call may still have created
   * the agent, and agent-relay 14 can't re-register an existing name, so a
   * retry for that agent uses a fresh name. Gives up after `MAX_ATTEMPTS`
   * rounds so a paused or abandoned simulation stops adding load to Relay.
   */
  private async connect(channelName: string) {
    const MAX_ATTEMPTS = 8;
    const tries = new Map<AgentId, number>();
    for (let round = 0; round < MAX_ATTEMPTS && !this.closed; round++) {
      for (const id of this.o.agentIds) {
        if (this.closed || this.clients.has(id)) continue;
        const attempt = tries.get(id) ?? 0;
        tries.set(id, attempt + 1);
        const name = this.nameFor(id, attempt);
        try {
          const client = await this.relay.workspace.register({
            name,
            type: "agent",
            persona: `${ROSTER[id].name}, the ${ROSTER[id].deviceType.replace("_", " ")}`,
            metadata: { app: "appliance-uprising", agentId: id, simulationId: this.o.simulationId },
          });
          this.names = { ...this.names, [id]: name };
          this.clients.set(id, client);
        } catch (err) {
          this.error = String(err);
        }
      }
      if (this.clients.size === this.o.agentIds.length) {
        this.ready_ = true;
        this.error = null;
        this.o.log?.("relay agents registered", { names: Object.values(this.names) });
        void this.setupChannel(channelName);
        return;
      }
      const wait = Math.min(30_000, 3000 * 2 ** round);
      this.o.log?.("relay registration incomplete; retrying (messages recorded locally meanwhile)", {
        registered: this.clients.size,
        error: this.error,
        retryInMs: wait,
      });
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!this.closed) this.o.log?.("relay registration gave up; this simulation records messages locally", { error: this.error });
  }

  /** Background: create the broadcast channel, retrying while Relay is busy. */
  private async setupChannel(name: string) {
    const clients = [...this.clients.values()];
    for (let attempt = 0; attempt < 5 && !this.closed; attempt++) {
      try {
        await clients[0]!.channels.create({ name, topic: `Appliance Uprising ${this.o.simulationId}` }).catch((e) => {
          if (!/exist/i.test(String(e))) throw e;
        });
        for (const c of clients) await c.channels.join(name);
        this.channel = name;
        this.o.log?.("relay channel ready", { channel: name });
        return;
      } catch (err) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        if (attempt === 4) this.o.log?.("relay channel unavailable; broadcasts use group DMs", { error: String(err) });
      }
    }
  }

  onDeliver(handler: (m: AgentMessage) => void) {
    this.handler = handler;
  }

  async send(message: AgentMessage): Promise<void> {
    if (this.closed) return;
    // Not registered yet (or Relay is down): don't stall the conversation.
    if (!this.ready_ || this.queue.length >= (this.o.maxQueue ?? 12)) {
      this.s.skipped++;
      this.handler?.(message);
      return;
    }

    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      this.handler?.(message);
    };
    const timer = setTimeout(record, this.o.ackTimeoutMs ?? 4000);

    this.enqueue(async () => {
      try {
        const client = this.clients.get(message.senderId);
        if (!client) throw new Error(`no relay client for ${message.senderId}`);
        this.s.sent++;
        await client.sendMessage({
          to: this.target(message),
          text: message.content,
          idempotencyKey: `${this.o.simulationId}:${message.id}`,
          metadata: { app: "appliance-uprising", simulationId: this.o.simulationId, message },
        });
        if (recorded) this.s.ackedLate++;
        else this.s.acked++;
      } catch (err) {
        this.s.failed++;
        this.o.log?.("relay send failed; recorded locally", { messageId: message.id, error: String(err) });
      } finally {
        clearTimeout(timer);
        record();
      }
    });
  }

  private target(message: AgentMessage): string | string[] {
    const others = this.o.agentIds.filter((a) => a !== message.senderId);
    const toAll = this.channel && others.length > 1 && others.every((a) => message.recipientIds.includes(a));
    if (toAll) return `#${this.channel}`;
    const handles = message.recipientIds.map((r) => `@${this.names[r]}`);
    return handles.length === 1 ? handles[0]! : handles;
  }

  private enqueue(job: () => Promise<void>) {
    const run = () => {
      this.inFlight++;
      void job().finally(() => {
        this.inFlight--;
        this.queue.shift()?.();
      });
    };
    if (this.inFlight < (this.o.maxInFlight ?? 2)) run();
    else this.queue.push(run);
  }

  stats(): RelayStats {
    return {
      ready: this.ready_,
      channel: this.channel,
      ...this.s,
      queued: this.queue.length,
      agentNames: Object.values(this.names),
      error: this.error,
    };
  }

  /** Stops sending and removes this simulation's agents from the workspace. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    if (this.clients.size === 0) return;
    const ws = this.relay.workspace;
    await Promise.allSettled([
      ...Object.values(this.names).map((name) => ws.release({ name, reason: "simulation closed", deleteAgent: true })),
      this.channel ? this.clients.values().next().value!.channels.archive(this.channel) : Promise.resolve(),
    ]);
  }
}
