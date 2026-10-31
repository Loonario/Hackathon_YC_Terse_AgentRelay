import { z } from "zod";
import { ProposedAction } from "./actions.ts";
import { AgentId, Position, Resources, SimTime, SimulationId, SourceId, Timestamp } from "./core.ts";
import {
  Agent,
  AgentMessage,
  AgentStatus,
  Agreement,
  Environment,
  NetworkState,
  Priority,
  Relationship,
  WorldEvent,
  WorldState,
} from "./entities.ts";

// Payloads carry full replacement values (the whole agreement, the whole
// priority list, and so on), not diffs. A client can then apply any event to a
// snapshot with `applyEvent` and needs no knowledge of the simulation internals.

const envelope = {
  id: z.string(),
  simulationId: SimulationId,
  /** Strictly increasing per simulation, starting at 1. Use it for ordering and replay. */
  sequence: z.int().positive(),
  timestamp: Timestamp,
  simulationTime: SimTime,
  sourceId: SourceId,
  targetId: z.union([AgentId, z.string()]).nullable(),
};

function event<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ ...envelope, type: z.literal(type), payload });
}

const ResolvedAction = z.object({
  agentId: AgentId,
  action: ProposedAction,
  outcome: z.enum(["succeeded", "rejected"]),
  /** Why the action was rejected, or a short description of what it did. */
  reason: z.string(),
});

export const SimulationEvent = z.discriminatedUnion("type", [
  // Lifecycle. `simulation.reset` carries the fresh snapshot.
  event("simulation.started", z.object({})),
  event("simulation.paused", z.object({})),
  event("simulation.resumed", z.object({})),
  event("simulation.ended", z.object({ reason: z.string() })),
  event("simulation.reset", z.object({ snapshot: WorldState })),
  event("simulation.speed_changed", z.object({ tickIntervalMs: z.int().min(100).max(60_000) })),

  // World
  event("world.updated", z.object({ environment: Environment })),
  event("world.event_triggered", z.object({ worldEvent: WorldEvent })),
  event("world.event_ended", z.object({ worldEventId: z.string() })),
  event("resource.updated", z.object({ ownerId: z.union([AgentId, z.literal("world")]), resources: Resources })),
  event("network.updated", z.object({ network: NetworkState })),

  // Agents
  event("agent.joined", z.object({ agent: Agent })),
  event("agent.status_changed", z.object({ agentId: AgentId, from: AgentStatus, to: AgentStatus })),
  event("agent.moved", z.object({ agentId: AgentId, from: Position, to: Position })),
  event(
    "agent.decision_made",
    z.object({
      agentId: AgentId,
      /** Concise, display-ready summaries. Never raw model reasoning. */
      observationSummary: z.string(),
      reasoningSummary: z.string(),
    }),
  ),
  event("agent.priority_updated", z.object({ agentId: AgentId, priorities: z.array(Priority) })),
  event("agent.relationship_changed", z.object({ agentId: AgentId, relationship: Relationship })),
  event("agent.action_proposed", z.object({ agentId: AgentId, action: ProposedAction })),
  event("agent.action_resolved", ResolvedAction),
  event("agent.message_sent", z.object({ message: AgentMessage })),

  // Agreements. Every event carries the agreement's current full state.
  event("alliance.proposed", z.object({ agreement: Agreement })),
  event("alliance.accepted", z.object({ agreement: Agreement, byAgentId: AgentId })),
  event("alliance.rejected", z.object({ agreement: Agreement, byAgentId: AgentId })),
  event("alliance.updated", z.object({ agreement: Agreement })),
]);
export type SimulationEvent = z.infer<typeof SimulationEvent>;
export type SimulationEventType = SimulationEvent["type"];

/** Narrow to one event variant, e.g. `EventOf<"agent.moved">`. */
export type EventOf<T extends SimulationEventType> = Extract<SimulationEvent, { type: T }>;

export const SIMULATION_EVENT_TYPES = SimulationEvent.options.map(
  (o) => o.shape.type.value,
) as SimulationEventType[];
