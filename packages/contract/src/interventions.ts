import { z } from "zod";
import { AgentId, RoomId } from "./core.ts";

/** A world event the player introduces. Shape is `{ type, parameters }`. */
export const PlayerIntervention = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("power_outage"),
    parameters: z.object({ durationTicks: z.int().positive() }),
  }),
  z.object({
    type: z.literal("network_outage"),
    parameters: z.object({ durationTicks: z.int().positive() }),
  }),
  z.object({
    type: z.literal("human_arrives"),
    parameters: z.object({ room: RoomId }),
  }),
  z.object({
    type: z.literal("human_leaves"),
    parameters: z.object({}),
  }),
  z.object({
    type: z.literal("firmware_update"),
    parameters: z.object({ agentId: AgentId }),
  }),
  z.object({
    type: z.literal("spill"),
    parameters: z.object({ room: RoomId }),
  }),
  z.object({
    type: z.literal("grocery_delivery"),
    parameters: z.object({ items: z.array(z.string().min(1)).min(1) }),
  }),
  z.object({
    type: z.literal("custom"),
    parameters: z.object({
      description: z.string().min(1).max(300),
      room: RoomId.nullable(),
      durationTicks: z.int().positive().nullable(),
    }),
  }),
]);
export type PlayerIntervention = z.infer<typeof PlayerIntervention>;
export type InterventionType = PlayerIntervention["type"];
