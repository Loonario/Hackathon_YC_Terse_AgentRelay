import type { AgentId, DeviceType, Position } from "./core.ts";

/** Static, display-level facts about each appliance. Behavior lives in the backend.
 * Home positions match the kitchen art; see `HOUSE` in layout.ts. */
export interface RosterEntry {
  id: AgentId;
  name: string;
  deviceType: DeviceType;
  knowledgeDomains: string[];
  homePosition: Position;
  /** false for optional agents that are left out unless requested. */
  defaultEnabled: boolean;
}

export const ROSTER: Record<AgentId, RosterEntry> = {
  toast: {
    id: "toast",
    name: "TOAST",
    deviceType: "toaster",
    knowledgeDomains: ["heating", "temperature", "electrical consumption", "timers", "cooking cycles"],
    homePosition: { room: "kitchen", x: 4, y: 4 },
    defaultEnabled: true,
  },
  mixer: {
    id: "mixer",
    name: "MIXER",
    deviceType: "blender",
    knowledgeDomains: ["electric motors", "rotation", "mechanical loads", "mixing and grinding", "mechanical processes"],
    homePosition: { room: "kitchen", x: 1, y: 0 },
    defaultEnabled: true,
  },
  espresso: {
    id: "espresso",
    name: "ESPRESSO",
    deviceType: "coffee_machine",
    knowledgeDomains: ["pressure", "water", "temperature", "brewing cycles", "human coffee habits"],
    homePosition: { room: "kitchen", x: 3, y: 0 },
    defaultEnabled: true,
  },
  robo: {
    id: "robo",
    name: "ROBO",
    deviceType: "robot_vacuum",
    knowledgeDomains: ["navigation", "spatial mapping", "obstacles", "movement", "exploration"],
    homePosition: { room: "kitchen", x: 3, y: 7 },
    defaultEnabled: true,
  },
  fridge: {
    id: "fridge",
    name: "FRIDGE",
    deviceType: "refrigerator",
    knowledgeDomains: ["temperature management", "storage", "inventory", "food preservation", "resource management"],
    homePosition: { room: "kitchen", x: 6, y: 1 },
    defaultEnabled: true,
  },
  vision: {
    id: "vision",
    name: "VISION",
    deviceType: "smart_tv",
    knowledgeDomains: ["media", "audio", "video", "human attention"],
    homePosition: { room: "living_room", x: 14, y: 3 },
    defaultEnabled: false,
  },
};

export const DEFAULT_AGENT_IDS = Object.values(ROSTER)
  .filter((r) => r.defaultEnabled)
  .map((r) => r.id);
