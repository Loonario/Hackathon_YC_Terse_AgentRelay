import type {
  ActionSummary,
  AgentDecision,
  AgentId,
  AgentMessage,
  AgentStatus,
  Agreement,
  DecisionTrigger,
  DeviceType,
  Environment,
  MemoryEntry,
  Position,
  Priority,
  Relationship,
  Resources,
  RoomId,
  WorldEvent,
} from "@proj/contract";
import type { ApplianceSpec } from "./catalog.ts";

// ---------------------------------------------------------------------------
// Private per-agent state. Not part of the public snapshot.
// ---------------------------------------------------------------------------

export interface PrivateAgentState {
  memory: MemoryEntry[];
  actions: ActionSummary[];
  /** Messages received since the agent last decided. */
  inbox: AgentMessage[];
  settings: Record<string, number | boolean | string>;
  /** Running operation, if any. */
  operation: { id: string; endsAt: number; startedAt: number } | null;
  /** Food tracked by FRIDGE; empty for others. */
  inventory: string[];
  /** Simulation time when the agent last finished a decision. */
  lastDecisionAt: number;
  /** Why the agent is offline. It comes back when this is empty. */
  offlineReasons: ("power_outage" | "firmware_update")[];
  /** When to drop back to idle after communicating. */
  idleAt: number | null;
  /** Why the agent should decide next. */
  triggers: DecisionTrigger[];
}

// ---------------------------------------------------------------------------
// What an agent is allowed to see when it decides.
// ---------------------------------------------------------------------------

export interface ObservedAgent {
  id: AgentId;
  name: string;
  deviceType: DeviceType;
  status: AgentStatus;
  room: RoomId;
  /** Only when in the same room. */
  position: Position | null;
}

export interface AgentContext {
  simulationId: string;
  simulationTime: number;
  trigger: DecisionTrigger;
  self: {
    id: AgentId;
    name: string;
    deviceType: DeviceType;
    knowledgeDomains: string[];
    status: AgentStatus;
    position: Position;
    resources: Resources;
    priorities: Priority[];
    relationships: Relationship[];
    settings: Record<string, number | boolean | string>;
    operation: PrivateAgentState["operation"];
    inventory: string[];
    spec: ApplianceSpec;
  };
  environment: {
    timeOfDay: number;
    day: number;
    power: Environment["power"];
    temperatureC: number;
    /** null when the agent cannot tell. */
    humanPresent: boolean | null;
    humanRoom: RoomId | null;
  };
  network: { online: boolean; bandwidth: number; selfConnected: boolean };
  worldResources: Resources;
  others: ObservedAgent[];
  /** Agreements this agent is part of (pending, active, recently ended). */
  myAgreements: Agreement[];
  /** Agreements this agent must still answer. */
  awaitingMyResponse: Agreement[];
  /** Active agreements between other agents (publicly known). */
  publicAlliances: { id: string; kind: Agreement["kind"]; participantIds: AgentId[] }[];
  events: WorldEvent[];
  inbox: AgentMessage[];
  longTermMemory: MemoryEntry[];
  recentMemory: MemoryEntry[];
  recentActions: ActionSummary[];
}

// ---------------------------------------------------------------------------
// Pluggable parts.
// ---------------------------------------------------------------------------

/** Produces one decision. The LLM runtime and the scripted mock both implement this. */
export interface AgentBrain {
  readonly kind: "mock" | "llm";
  decide(context: AgentContext, signal: AbortSignal): Promise<AgentDecision>;
}

/**
 * Moves agent messages between agents. The engine validates a message, hands
 * it to `send`, and records it once the transport calls `onDeliver`.
 * The local transport delivers right away; the Agent Relay transport delivers
 * when Relay hands the message back.
 */
export interface MessageTransport {
  readonly kind: "local" | "relay";
  send(message: AgentMessage): Promise<void>;
  onDeliver(handler: (message: AgentMessage) => void): void;
  close(): Promise<void>;
}

export class LocalTransport implements MessageTransport {
  readonly kind = "local" as const;
  private handler: ((m: AgentMessage) => void) | null = null;
  async send(message: AgentMessage) {
    this.handler?.(message);
  }
  onDeliver(handler: (m: AgentMessage) => void) {
    this.handler = handler;
  }
  async close() {}
}

export class SimError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_request" | "invalid_state" | "internal",
    message: string,
  ) {
    super(message);
  }
}
