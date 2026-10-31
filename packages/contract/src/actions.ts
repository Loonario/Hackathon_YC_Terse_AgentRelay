import { z } from "zod";
import { AgentId, Position, ResourceAmount, ResourceType, RoomId } from "./core.ts";

// Every field is required. Use `.nullable()` instead of `.optional()`, because
// these schemas are also used as OpenAI structured-output formats.

export const AgreementKind = z.enum(["alliance", "joint_project", "resource_exchange", "rule_change"]);
export type AgreementKind = z.infer<typeof AgreementKind>;

export const AgreementTerms = z.object({
  /** Human-readable terms, written by the proposing agent. */
  summary: z.string().min(1).max(500),
  /** Resources the proposer offers to give. */
  offers: z.array(ResourceAmount),
  /** Resources the proposer asks for. */
  requests: z.array(ResourceAmount),
  /** Agreement lifetime in ticks. null means open-ended. */
  durationTicks: z.int().positive().nullable(),
});
export type AgreementTerms = z.infer<typeof AgreementTerms>;

export const AgreementResponse = z.enum(["accept", "reject", "counter", "clarify"]);
export type AgreementResponse = z.infer<typeof AgreementResponse>;

/**
 * Something an agent wants to do in the world. The simulation engine checks it
 * against capabilities, rules, resources and permissions, then resolves it.
 * Messages are not actions: they go in `AgentDecision.communicationIntent`.
 */
export const ProposedAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wait") }),
  z.object({ type: z.literal("observe_environment"), room: RoomId.nullable() }),
  z.object({ type: z.literal("inspect_resources"), targetId: AgentId.nullable() }),
  z.object({
    type: z.literal("propose_agreement"),
    kind: AgreementKind,
    participantIds: z.array(AgentId).min(1),
    terms: AgreementTerms,
  }),
  z.object({
    type: z.literal("respond_to_agreement"),
    agreementId: z.string(),
    response: AgreementResponse,
    /** Required when response is "counter", otherwise null. */
    counterTerms: AgreementTerms.nullable(),
    note: z.string().max(300).nullable(),
  }),
  z.object({
    type: z.literal("request_resource"),
    fromId: z.union([AgentId, z.literal("world")]),
    resource: ResourceType,
    amount: z.number().positive(),
  }),
  z.object({
    type: z.literal("allocate_resource"),
    toId: AgentId,
    resource: ResourceType,
    amount: z.number().positive(),
  }),
  z.object({
    type: z.literal("change_setting"),
    setting: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    type: z.literal("start_operation"),
    operation: z.string().min(1),
    durationTicks: z.int().positive(),
  }),
  z.object({
    type: z.literal("propose_project"),
    title: z.string().min(1).max(120),
    description: z.string().max(500),
    participantIds: z.array(AgentId),
    requiredResources: z.array(ResourceAmount),
  }),
  z.object({ type: z.literal("move"), to: Position }),
]);
export type ProposedAction = z.infer<typeof ProposedAction>;
export type ActionType = ProposedAction["type"];
