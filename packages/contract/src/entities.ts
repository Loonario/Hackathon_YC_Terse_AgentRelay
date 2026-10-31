import { z } from "zod";
import { AgreementKind, AgreementTerms, ProposedAction } from "./actions.ts";
import {
  AgentId,
  DeviceType,
  Position,
  Resources,
  RoomId,
  SimTime,
  SimulationId,
  SourceId,
  Timestamp,
} from "./core.ts";

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const AgentStatus = z.enum([
  "idle",
  "thinking", // an LLM decision is in progress
  "acting", // running an operation or moving
  "communicating",
  "offline", // no power, or disabled by an event
  "error",
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const Priority = z.object({
  id: z.string(),
  description: z.string().min(1).max(200),
  /** 1 (low) to 5 (critical). */
  importance: z.int().min(1).max(5),
});
export type Priority = z.infer<typeof Priority>;

export const RelationshipStance = z.enum(["ally", "friendly", "neutral", "wary", "rival"]);
export type RelationshipStance = z.infer<typeof RelationshipStance>;

export const Relationship = z.object({
  agentId: AgentId,
  /** -1 (full distrust) to 1 (full trust). */
  trust: z.number().min(-1).max(1),
  stance: RelationshipStance,
});
export type Relationship = z.infer<typeof Relationship>;

export const ActionSummary = z.object({
  action: ProposedAction,
  outcome: z.enum(["succeeded", "rejected"]),
  /** Short, display-ready description of what happened. */
  summary: z.string(),
  simulationTime: SimTime,
});
export type ActionSummary = z.infer<typeof ActionSummary>;

/** Public agent state, as shown in snapshots. */
export const Agent = z.object({
  id: AgentId,
  name: z.string(),
  deviceType: DeviceType,
  status: AgentStatus,
  position: Position,
  knowledgeDomains: z.array(z.string()),
  capabilities: z.array(z.string()),
  currentPriorities: z.array(Priority),
  resources: Resources,
  relationships: z.array(Relationship),
  lastAction: ActionSummary.nullable(),
});
export type Agent = z.infer<typeof Agent>;

export const MemoryEntry = z.object({
  id: z.string(),
  kind: z.enum(["long_term", "interaction", "observation"]),
  content: z.string(),
  simulationTime: SimTime,
});
export type MemoryEntry = z.infer<typeof MemoryEntry>;

/** Detailed agent view, returned by the agent profile endpoint. */
export const AgentProfile = Agent.extend({
  beliefs: z.array(z.string()),
  recentMemory: z.array(MemoryEntry),
  recentActions: z.array(ActionSummary),
});
export type AgentProfile = z.infer<typeof AgentProfile>;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const MessageType = z.enum(["direct", "group", "proposal", "response", "broadcast"]);
export type MessageType = z.infer<typeof MessageType>;

export const AgentMessage = z.object({
  id: z.string(),
  senderId: AgentId,
  recipientIds: z.array(AgentId),
  messageType: MessageType,
  content: z.string(),
  /** Set when this message relates to an agreement. */
  agreementId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  timestamp: Timestamp,
  simulationTime: SimTime,
});
export type AgentMessage = z.infer<typeof AgentMessage>;

// ---------------------------------------------------------------------------
// Agreements (alliances, projects, exchanges, rule changes)
// ---------------------------------------------------------------------------

export const AgreementStatus = z.enum(["proposed", "active", "rejected", "dissolved", "expired"]);
export type AgreementStatus = z.infer<typeof AgreementStatus>;

export const ParticipantResponse = z.enum(["pending", "accepted", "rejected", "countered"]);
export type ParticipantResponse = z.infer<typeof ParticipantResponse>;

export const Agreement = z.object({
  id: z.string(),
  kind: AgreementKind,
  proposerId: AgentId,
  /** Everyone involved, including the proposer. */
  participantIds: z.array(AgentId).min(2),
  terms: AgreementTerms,
  status: AgreementStatus,
  responses: z.array(z.object({ agentId: AgentId, response: ParticipantResponse })),
  proposedAt: SimTime,
  /** Set when the agreement becomes active. */
  activatedAt: SimTime.nullable(),
  /** Set when the agreement ends: rejected, dissolved or expired. */
  endedAt: SimTime.nullable(),
});
export type Agreement = z.infer<typeof Agreement>;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export const SimulationStatus = z.enum(["created", "running", "paused", "ended"]);
export type SimulationStatus = z.infer<typeof SimulationStatus>;

export const PowerState = z.enum(["normal", "brownout", "outage"]);
export type PowerState = z.infer<typeof PowerState>;

export const Environment = z.object({
  /** Simulated clock, minutes since midnight (0 to 1439). */
  timeOfDay: z.int().min(0).max(1439),
  day: z.int().min(1),
  power: PowerState,
  temperatureC: z.number(),
  humanPresent: z.boolean(),
  humanRoom: RoomId.nullable(),
});
export type Environment = z.infer<typeof Environment>;

export const NetworkState = z.object({
  online: z.boolean(),
  /** 0 to 100. */
  bandwidth: z.number().min(0).max(100),
  connectedAgentIds: z.array(AgentId),
});
export type NetworkState = z.infer<typeof NetworkState>;

export const WorldEventKind = z.enum([
  "power_outage",
  "network_outage",
  "human_arrives",
  "human_leaves",
  "firmware_update",
  "spill",
  "grocery_delivery",
  "custom",
]);
export type WorldEventKind = z.infer<typeof WorldEventKind>;

/** An ongoing or one-off happening in the world, often caused by the player. */
export const WorldEvent = z.object({
  id: z.string(),
  kind: WorldEventKind,
  description: z.string(),
  causedBy: SourceId,
  room: RoomId.nullable(),
  targetAgentId: AgentId.nullable(),
  startedAt: SimTime,
  /** null means it lasts until something resolves it. */
  endsAt: SimTime.nullable(),
});
export type WorldEvent = z.infer<typeof WorldEvent>;

/** Full authoritative snapshot of one simulation. */
export const WorldState = z.object({
  simulationId: SimulationId,
  simulationTime: SimTime,
  status: SimulationStatus,
  /** Wall-clock milliseconds per tick (simulation speed). */
  tickIntervalMs: z.int().min(100).max(60_000),
  environment: Environment,
  /** Shared world resource pools. */
  resources: Resources,
  network: NetworkState,
  agents: z.array(Agent),
  alliances: z.array(Agreement),
  activeEvents: z.array(WorldEvent),
  /** Sequence number of the last event applied to this snapshot (0 means none). */
  lastSequence: z.int().min(0),
});
export type WorldState = z.infer<typeof WorldState>;
