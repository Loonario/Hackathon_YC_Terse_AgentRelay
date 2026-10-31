import { z } from "zod";

/** Bump when a breaking change is made to any schema in this package. */
export const CONTRACT_VERSION = "0.2.0";

/** One tick of simulation time equals this many simulated minutes. */
export const SIM_MINUTES_PER_TICK = 1;

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const AGENT_IDS = ["toast", "mixer", "espresso", "robo", "fridge", "vision"] as const;
export const AgentId = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentId>;

export const DeviceType = z.enum([
  "toaster",
  "blender",
  "coffee_machine",
  "robot_vacuum",
  "refrigerator",
  "smart_tv",
]);
export type DeviceType = z.infer<typeof DeviceType>;

/** Event source: an agent, the world itself, or the player. */
export const SourceId = z.union([AgentId, z.literal("world"), z.literal("player")]);
export type SourceId = z.infer<typeof SourceId>;

export const SimulationId = z.string().min(1);
export type SimulationId = z.infer<typeof SimulationId>;

// ---------------------------------------------------------------------------
// Space
// ---------------------------------------------------------------------------

export const RoomId = z.enum(["kitchen", "living_room", "hallway", "bedroom"]);
export type RoomId = z.infer<typeof RoomId>;

/**
 * Position in ROOM-LOCAL tile coordinates. (0,0) is the room's back corner, x
 * runs along the right-hand back wall, y along the left-hand back wall. Room
 * sizes, furniture, counters, landmarks and doors are in `HOUSE` (layout.ts);
 * use `isInRoom` / `isWalkable` to validate. The frontend decides pixels.
 */
export const Position = z.object({
  room: RoomId,
  x: z.int().min(0),
  y: z.int().min(0),
});
export type Position = z.infer<typeof Position>;

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export const RESOURCE_TYPES = [
  "electricity",
  "connectivity",
  "information",
  "physical_access",
  "operational_capacity",
  "components",
] as const;
export const ResourceType = z.enum(RESOURCE_TYPES);
export type ResourceType = z.infer<typeof ResourceType>;

/** Every resource type is always present. Amounts are non-negative units. */
export const Resources = z.record(ResourceType, z.number().min(0));
export type Resources = z.infer<typeof Resources>;

export const ResourceAmount = z.object({
  resource: ResourceType,
  amount: z.number().positive(),
});
export type ResourceAmount = z.infer<typeof ResourceAmount>;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Wall-clock time, ISO 8601. */
export const Timestamp = z.iso.datetime();
export type Timestamp = z.infer<typeof Timestamp>;

/** Ticks since the simulation started. */
export const SimTime = z.int().min(0);
export type SimTime = z.infer<typeof SimTime>;
