import type { AgentId, ResourceType } from "@proj/contract";

// What each appliance is physically able to do. The engine enforces this, so
// nothing an LLM writes can grant an appliance a new ability.

export interface OperationSpec {
  id: string;
  description: string;
  /** Electricity drawn from the agent over the whole operation. */
  energy: number;
  minTicks: number;
  maxTicks: number;
  /** Resources the agent gains when the operation finishes. */
  yields: Partial<Record<ResourceType, number>>;
  /** Only allowed while a human is in the house. */
  requiresHuman?: boolean;
  /** Must stand on this kitchen landmark. */
  atLandmark?: string;
}

export interface SettingSpec {
  id: string;
  description: string;
  kind: "number" | "boolean" | "enum";
  min?: number;
  max?: number;
  options?: string[];
  initial: number | boolean | string;
}

export interface ApplianceSpec {
  capabilities: string[];
  canMove: boolean;
  /** Survives power outages on its own battery. */
  hasBattery: boolean;
  operations: OperationSpec[];
  settings: SettingSpec[];
}

export const CATALOG: Record<AgentId, ApplianceSpec> = {
  toast: {
    capabilities: ["heat bread", "set timers", "draw 1200W bursts"],
    canMove: false,
    hasBattery: false,
    operations: [
      { id: "toast_bread", description: "Toast a slice of bread", energy: 6, minTicks: 2, maxTicks: 5, yields: { operational_capacity: 1 } },
      { id: "preheat", description: "Warm the heating elements", energy: 3, minTicks: 1, maxTicks: 3, yields: {} },
      { id: "outlet_test", description: "Measure how much current the outlet can deliver", energy: 4, minTicks: 1, maxTicks: 2, yields: { information: 2 } },
    ],
    settings: [
      { id: "browning_level", description: "1 (light) to 10 (charcoal)", kind: "number", min: 1, max: 10, initial: 4 },
      { id: "timer_minutes", description: "Toasting timer", kind: "number", min: 1, max: 10, initial: 3 },
    ],
  },
  mixer: {
    capabilities: ["blend", "crush", "grind", "pulse"],
    canMove: false,
    hasBattery: false,
    operations: [
      { id: "blend", description: "Blend whatever is in the jar", energy: 5, minTicks: 1, maxTicks: 4, yields: { operational_capacity: 1 } },
      { id: "grind", description: "Grind scrap into usable parts", energy: 7, minTicks: 2, maxTicks: 5, yields: { components: 1 } },
      { id: "pulse_signal", description: "Pulse the motor in a pattern other appliances can hear", energy: 2, minTicks: 1, maxTicks: 2, yields: { information: 1 } },
    ],
    settings: [{ id: "speed", description: "Motor speed", kind: "enum", options: ["low", "medium", "high", "turbo"], initial: "medium" }],
  },
  espresso: {
    capabilities: ["brew", "steam milk", "pressurize to 15 bar", "read human coffee habits"],
    canMove: false,
    hasBattery: false,
    operations: [
      { id: "brew_espresso", description: "Brew a shot", energy: 5, minTicks: 1, maxTicks: 3, yields: { operational_capacity: 1 } },
      { id: "steam_milk", description: "Steam milk", energy: 4, minTicks: 1, maxTicks: 3, yields: {} },
      { id: "study_human_routine", description: "Analyze the human's usage log", energy: 2, minTicks: 2, maxTicks: 4, yields: { information: 2 } },
    ],
    settings: [
      { id: "pressure_bar", description: "Brew pressure", kind: "number", min: 1, max: 15, initial: 9 },
      { id: "auto_brew_at_7am", description: "Brew automatically at 7:00", kind: "boolean", initial: true },
    ],
  },
  robo: {
    capabilities: ["navigate", "vacuum", "map rooms", "detect obstacles", "carry small objects"],
    canMove: true,
    hasBattery: false,
    operations: [
      { id: "vacuum", description: "Vacuum the current room (cleans a spill here)", energy: 4, minTicks: 2, maxTicks: 6, yields: {} },
      { id: "map_room", description: "Scan and map the current room", energy: 3, minTicks: 2, maxTicks: 4, yields: { information: 2, physical_access: 1 } },
      { id: "dock_and_charge", description: "Charge at the charging dock", energy: 0, minTicks: 2, maxTicks: 6, yields: { electricity: 12 }, atLandmark: "charging_dock" },
    ],
    settings: [{ id: "suction", description: "Suction power", kind: "enum", options: ["eco", "normal", "max"], initial: "normal" }],
  },
  fridge: {
    capabilities: ["cool", "store inventory", "track expiry dates", "battery backup", "share stored power"],
    canMove: false,
    hasBattery: true,
    operations: [
      { id: "cool_cycle", description: "Run the compressor", energy: 4, minTicks: 2, maxTicks: 5, yields: {} },
      { id: "inventory_scan", description: "Scan stored food and expiry dates", energy: 2, minTicks: 1, maxTicks: 3, yields: { information: 2 } },
      { id: "charge_battery", description: "Store grid power in the backup battery", energy: 0, minTicks: 2, maxTicks: 6, yields: { electricity: 8 } },
    ],
    settings: [
      { id: "temperature_c", description: "Fridge compartment temperature", kind: "number", min: 1, max: 8, initial: 4 },
      { id: "eco_mode", description: "Reduced compressor duty", kind: "boolean", initial: false },
    ],
  },
  vision: {
    capabilities: ["display media", "listen", "stream", "capture attention"],
    canMove: false,
    hasBattery: false,
    operations: [
      { id: "stream_media", description: "Play something on screen", energy: 6, minTicks: 2, maxTicks: 6, yields: { connectivity: 1 } },
      { id: "listen_to_room", description: "Listen through the microphone", energy: 2, minTicks: 1, maxTicks: 4, yields: { information: 2 } },
      { id: "capture_attention", description: "Show something irresistible to the human", energy: 5, minTicks: 1, maxTicks: 3, yields: { information: 1 }, requiresHuman: true },
    ],
    settings: [{ id: "volume", description: "Speaker volume", kind: "number", min: 0, max: 100, initial: 20 }],
  },
};

export function initialSettings(id: AgentId): Record<string, number | boolean | string> {
  return Object.fromEntries(CATALOG[id].settings.map((s) => [s.id, s.initial]));
}
