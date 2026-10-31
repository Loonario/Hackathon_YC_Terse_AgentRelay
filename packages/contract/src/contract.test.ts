import { describe, expect, test } from "bun:test";
import {
  AgentDecision,
  applyEvent,
  applyEvents,
  exampleEvents,
  exampleSnapshot,
  PlayerIntervention,
  SIMULATION_EVENT_TYPES,
  SimulationEvent,
  StreamMessage,
  WorldState,
  HOUSE,
  ROSTER,
  isCounter,
  isInRoom,
  isWalkable,
} from "./index.ts";

describe("fixtures match schemas", () => {
  test("snapshot", () => {
    expect(() => WorldState.parse(exampleSnapshot)).not.toThrow();
  });
  test("events", () => {
    for (const e of exampleEvents) expect(() => SimulationEvent.parse(e)).not.toThrow();
  });
});

describe("applyEvent", () => {
  const final = applyEvents(exampleSnapshot, exampleEvents);

  test("projects the example run", () => {
    expect(final.status).toBe("running");
    expect(final.lastSequence).toBe(7);
    expect(final.simulationTime).toBe(4);
    expect(final.alliances).toHaveLength(1);
    expect(final.alliances[0]!.status).toBe("active");
    expect(final.agents.find((a) => a.id === "toast")!.status).toBe("thinking");
    expect(final.agents.find((a) => a.id === "robo")!.position).toEqual({ room: "kitchen", x: 5, y: 6 });
    expect(() => WorldState.parse(final)).not.toThrow();
  });

  test("does not mutate input", () => {
    const before = structuredClone(exampleSnapshot);
    applyEvents(exampleSnapshot, exampleEvents);
    expect(exampleSnapshot).toEqual(before);
  });

  test("ignores replayed and out-of-simulation events", () => {
    expect(applyEvents(final, exampleEvents)).toBe(final);
    const foreign = { ...exampleEvents[1]!, simulationId: "other", sequence: 99 };
    expect(applyEvent(final, foreign)).toBe(final);
  });

  test("reset replaces the snapshot", () => {
    const reset = applyEvent(final, {
      id: "evt_8",
      simulationId: final.simulationId,
      sequence: 8,
      timestamp: new Date().toISOString(),
      simulationTime: 0,
      sourceId: "player",
      targetId: null,
      type: "simulation.reset",
      payload: { snapshot: exampleSnapshot },
    });
    expect(reset.alliances).toHaveLength(0);
    expect(reset.lastSequence).toBe(8);
  });
});

describe("schemas", () => {
  test("event types are unique", () => {
    expect(new Set(SIMULATION_EVENT_TYPES).size).toBe(SIMULATION_EVENT_TYPES.length);
  });

  test("intervention", () => {
    expect(PlayerIntervention.parse({ type: "power_outage", parameters: { durationTicks: 10 } }).type).toBe(
      "power_outage",
    );
    expect(() => PlayerIntervention.parse({ type: "power_outage", parameters: {} })).toThrow();
  });

  test("stream message", () => {
    expect(() => StreamMessage.parse({ kind: "snapshot", snapshot: exampleSnapshot })).not.toThrow();
  });

  test("an agent may decide to do nothing", () => {
    const d = AgentDecision.parse({
      agentId: "fridge",
      observationSummary: "Quiet morning.",
      declaredPriorities: [],
      reasoningSummary: "Nothing needs attention.",
      proposedAction: null,
      communicationIntent: null,
      memoryUpdates: [],
    });
    expect(d.proposedAction).toBeNull();
  });

  test("decision schema has no optional fields (OpenAI structured outputs)", () => {
    const schema = AgentDecision.toJSONSchema() as Record<string, unknown>;
    const problems: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object" && n.properties) {
        const keys = Object.keys(n.properties as object);
        const required = new Set((n.required as string[]) ?? []);
        for (const k of keys) if (!required.has(k)) problems.push(`${path}.${k}`);
      }
      for (const [k, v] of Object.entries(n)) walk(v, `${path}/${k}`);
    };
    walk(schema, "");
    expect(problems).toEqual([]);
  });
});

describe("layout", () => {
  test("every roster home is a walkable tile", () => {
    for (const r of Object.values(ROSTER)) expect(isWalkable(r.homePosition)).toBe(true);
  });
  test("doors are walkable and lead to walkable tiles", () => {
    for (const room of Object.values(HOUSE))
      for (const d of room.doors) {
        expect(isWalkable({ room: room.id, x: d.x, y: d.y })).toBe(true);
        expect(isWalkable(d.to)).toBe(true);
      }
  });
  test("landmarks are inside their rooms", () => {
    for (const room of Object.values(HOUSE))
      for (const l of room.landmarks) expect(isInRoom({ room: room.id, x: l.x, y: l.y })).toBe(true);
  });
  test("counter tiles are flagged", () => {
    expect(isCounter(ROSTER.toast.homePosition)).toBe(true);
    expect(isCounter(ROSTER.robo.homePosition)).toBe(false);
  });
  test("speed change applies", () => {
    const s = applyEvent(exampleSnapshot, {
      id: "e", simulationId: exampleSnapshot.simulationId, sequence: 1, timestamp: new Date().toISOString(),
      simulationTime: 0, sourceId: "player", targetId: null, type: "simulation.speed_changed", payload: { tickIntervalMs: 250 },
    });
    expect(s.tickIntervalMs).toBe(250);
  });
});
