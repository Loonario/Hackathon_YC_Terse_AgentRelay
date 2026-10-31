import { z } from "zod";
import { ProposedAction } from "./actions.ts";
import { AgentId, SimTime } from "./core.ts";
import { MessageType, Priority } from "./entities.ts";

// What an agent's decision cycle returns. Both the LLM runtime and the
// deterministic mock produce this shape, so the engine treats them the same.
// Every field is required (nullable where empty), for OpenAI structured outputs.

export const CommunicationIntent = z.object({
  messageType: MessageType,
  recipientIds: z.array(AgentId).min(1),
  content: z.string().min(1).max(600),
  agreementId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
});
export type CommunicationIntent = z.infer<typeof CommunicationIntent>;

export const MemoryUpdate = z.object({
  kind: z.enum(["long_term", "interaction", "observation"]),
  content: z.string().min(1).max(300),
});
export type MemoryUpdate = z.infer<typeof MemoryUpdate>;

export const AgentDecision = z.object({
  agentId: AgentId,
  observationSummary: z.string().max(400),
  /** The agent's full current priority list. Repeat it unchanged to keep it. */
  declaredPriorities: z.array(Priority).max(5),
  /** Concise, observable justification. Not raw chain-of-thought. */
  reasoningSummary: z.string().max(400),
  /** null means the agent chooses not to act this cycle. */
  proposedAction: ProposedAction.nullable(),
  /** null means the agent sends no message this cycle. */
  communicationIntent: CommunicationIntent.nullable(),
  memoryUpdates: z.array(MemoryUpdate).max(5),
});
export type AgentDecision = z.infer<typeof AgentDecision>;

/** Why an agent's decision cycle was triggered. */
export const DecisionTrigger = z.object({
  reason: z.enum(["world_event", "message_received", "scheduled", "state_changed", "agreement_pending"]),
  /** Event or message id that caused it, if any. */
  refId: z.string().nullable(),
  simulationTime: SimTime,
});
export type DecisionTrigger = z.infer<typeof DecisionTrigger>;
