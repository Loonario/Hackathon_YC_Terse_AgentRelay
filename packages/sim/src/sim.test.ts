import { describe, expect, test } from "bun:test";
import { applyEvents, DEFAULT_AGENT_IDS, SimulationEvent, WorldState, type AgentDecision } from "@proj/contract";
import { Engine } from "./engine.ts";
import { MockBrain } from "./mockBrain.ts";
import { SimulationRunner } from "./runner.ts";
import type { AgentBrain } from "./types.ts";

const fixedNow = () => new Date("2026-10-31T12:00:00.000Z");
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeEngine(seed = 7) {
  return new Engine({ simulationId: "sim_test", seed, agentIds: [...DEFAULT_AGENT_IDS], tickIntervalMs: 1000, now: fixedNow });
}

async function run(seed: number, ticks: number) {
  const engine = makeEngine(seed);
  const runner = new SimulationRunner(engine, { brain: new MockBrain(seed), decisionIntervalTicks: 6 });
  engine.start();
  for (let i = 0; i < ticks; i++) {
    runner.step();
    await flush();
  }
  return { engine, runner };
}

const decision = (over: Partial<AgentDecision>): AgentDecision => ({
  agentId: "toast",
  observationSummary: "",
  declaredPriorities: [],
  reasoningSummary: "",
  proposedAction: null,
  communicationIntent: null,
  memoryUpdates: [],
  ...over,
});

describe("mock run", () => {
  test("is deterministic for a seed", async () => {
    const a = await run(3, 120);
    const b = await run(3, 120);
    const strip = (e: SimulationEvent) => ({ ...e, timestamp: "" });
    expect(a.engine.events(0, 100_000).map(strip)).toEqual(b.engine.events(0, 100_000).map(strip));
  });

  test("produces valid events that replay to the same snapshot", async () => {
    const { engine } = await run(5, 200);
    const events = engine.events(0, 100_000);
    for (const e of events) SimulationEvent.parse(e);
    WorldState.parse(engine.state);
    const types = new Set(events.map((e) => e.type));
    for (const t of ["agent.decision_made", "agent.message_sent", "agent.action_resolved", "alliance.proposed", "agent.priority_updated"]) {
      expect(types.has(t as SimulationEvent["type"])).toBe(true);
    }
    // Rebuilding from the first snapshot + events matches the live snapshot.
    const initial = makeEngine(5).state;
    expect(applyEvents(initial, events)).toEqual(engine.state);
  });

  test("survives every intervention", async () => {
    const { engine, runner } = await run(9, 20);
    runner.intervene({ type: "power_outage", parameters: { durationTicks: 10 } });
    expect(engine.state.agents.find((a) => a.id === "toast")!.status).toBe("offline");
    expect(engine.state.agents.find((a) => a.id === "fridge")!.status).not.toBe("offline");
    runner.intervene({ type: "spill", parameters: { room: "kitchen" } });
    runner.intervene({ type: "human_arrives", parameters: { room: "kitchen" } });
    runner.intervene({ type: "network_outage", parameters: { durationTicks: 5 } });
    runner.intervene({ type: "firmware_update", parameters: { agentId: "mixer" } });
    runner.intervene({ type: "grocery_delivery", parameters: { items: ["cheese"] } });
    runner.intervene({ type: "custom", parameters: { description: "A cat jumps on the counter", room: "kitchen", durationTicks: 4 } });
    runner.intervene({ type: "human_leaves", parameters: {} });
    for (let i = 0; i < 40; i++) {
      runner.step();
      await flush();
    }
    expect(engine.state.environment.power).toBe("normal");
    expect(engine.state.network.online).toBe(true);
    expect(engine.state.agents.every((a) => a.status !== "offline")).toBe(true);
    WorldState.parse(engine.state);
  });

  test("reset starts over cleanly", async () => {
    const { engine, runner } = await run(2, 50);
    runner.reset();
    expect(engine.state.simulationTime).toBe(0);
    expect(engine.state.status).toBe("created");
    expect(engine.state.alliances).toHaveLength(0);
    expect(engine.state.lastSequence).toBeGreaterThan(0);
  });
});

describe("persistence", () => {
  test("snapshot + later events restore the same public state", async () => {
    const { engine, runner } = await run(4, 60);
    const snap = JSON.parse(JSON.stringify(engine.exportSnapshot()));
    const seqAtSnap = engine.state.lastSequence;
    for (let i = 0; i < 30; i++) {
      runner.step();
      await flush();
    }
    const later = engine.events(seqAtSnap, 100_000);
    const restored = makeEngine(4);
    restored.restore(snap, later);
    const { status: _s, lastSequence: _l, ...expected } = engine.state;
    const { status, lastSequence: _l2, ...actual } = restored.state;
    expect(status).toBe("paused");
    expect({ ...actual, agents: actual.agents.map((a) => ({ ...a, status: "x" })) }).toEqual({
      ...expected,
      agents: expected.agents.map((a) => ({ ...a, status: "x" })),
    });
  });
});

describe("rules", () => {
  test("agents cannot do what their appliance can't", () => {
    const engine = makeEngine();
    engine.start();
    engine.applyDecision(decision({ proposedAction: { type: "move", to: { room: "kitchen", x: 6, y: 6 } } }), { startedAt: 0, generation: 0 });
    expect(engine.state.agents.find((a) => a.id === "toast")!.lastAction?.outcome).toBe("rejected");
    engine.applyDecision(decision({ proposedAction: { type: "start_operation", operation: "vacuum", durationTicks: 2 } }), { startedAt: 0, generation: 0 });
    expect(engine.state.agents.find((a) => a.id === "toast")!.lastAction?.outcome).toBe("rejected");
  });

  test("agreements need the other side to accept", () => {
    const engine = makeEngine();
    engine.start();
    engine.applyDecision(
      decision({
        proposedAction: {
          type: "propose_agreement",
          kind: "alliance",
          participantIds: ["fridge"],
          terms: { summary: "Power pact", offers: [], requests: [{ resource: "electricity", amount: 2 }], durationTicks: null },
        },
      }),
      { startedAt: 0, generation: 0 },
    );
    const ag = engine.state.alliances[0]!;
    expect(ag.status).toBe("proposed");
    const fridgeBefore = engine.agent("fridge").resources.electricity;
    engine.applyDecision(
      decision({ agentId: "fridge", proposedAction: { type: "respond_to_agreement", agreementId: ag.id, response: "accept", counterTerms: null, note: null } }),
      { startedAt: 0, generation: 0 },
    );
    expect(engine.state.alliances[0]!.status).toBe("active");
    expect(engine.agent("fridge").resources.electricity).toBe(fridgeBefore - 2);
    expect(engine.agent("toast").relationships.find((r) => r.agentId === "fridge")!.trust).toBeGreaterThan(0);
  });

  test("agreement replies work even when the agent cites the message id", () => {
    const engine = makeEngine();
    engine.start();
    const meta = { startedAt: 0, generation: 0 };
    const propose = (agentId: AgentDecision["agentId"], to: AgentDecision["agentId"]) =>
      engine.applyDecision(
        decision({
          agentId,
          proposedAction: {
            type: "propose_agreement",
            kind: "alliance",
            participantIds: [to],
            terms: { summary: "Pact", offers: [], requests: [], durationTicks: null },
          },
          // The model doesn't know the new id yet, so it leaves agreementId null.
          communicationIntent: { messageType: "proposal", recipientIds: [to], content: "Deal?", agreementId: null, inReplyTo: null },
        }),
        meta,
      );
    const respond = (agreementId: string) =>
      engine.applyDecision(
        decision({ agentId: "fridge", proposedAction: { type: "respond_to_agreement", agreementId, response: "accept", counterTerms: null, note: null } }),
        meta,
      );
    const lastReason = () => engine.agent("fridge").lastAction!.summary;

    // 1. The proposal message carries the new agreement's id.
    propose("toast", "fridge");
    const sent = engine.events(0, 1000).filter((e) => e.type === "agent.message_sent").at(-1)!;
    const agr = engine.state.alliances[0]!;
    expect(sent.type === "agent.message_sent" && sent.payload.message.agreementId).toBe(agr.id);

    // 2. A second pending deal, so the "only one pending" fallback can't help.
    propose("mixer", "fridge");
    respond("nonsense");
    expect(engine.agent("fridge").lastAction!.outcome).toBe("rejected");
    expect(lastReason()).toContain(agr.id);

    // 3. Citing the proposal message id resolves to the agreement.
    respond(sent.type === "agent.message_sent" ? sent.payload.message.id : "");
    expect(engine.state.alliances.find((a) => a.id === agr.id)!.status).toBe("active");
  });

  test("messages are delivered through the transport and wake the recipient", () => {
    const engine = makeEngine();
    engine.start();
    engine.applyDecision(
      decision({ communicationIntent: { messageType: "direct", recipientIds: ["robo"], content: "Hi ROBO", agreementId: null, inReplyTo: null } }),
      { startedAt: 0, generation: 0 },
    );
    expect(engine.events(0, 1000).some((e) => e.type === "agent.message_sent")).toBe(true);
    expect(engine.schedulingInfo("robo").triggers.map((t) => t.reason)).toContain("message_received");
  });

  test("a broken brain falls back to the mock", async () => {
    const broken: AgentBrain = { kind: "llm", decide: async () => { throw new Error("boom"); } };
    const engine = makeEngine();
    const runner = new SimulationRunner(engine, { brain: broken, fallback: new MockBrain(1), decisionIntervalTicks: 3 });
    engine.start();
    for (let i = 0; i < 30; i++) {
      runner.step();
      await flush();
    }
    expect(runner.stats().decisions.fallback).toBeGreaterThan(0);
    expect(engine.events(0, 10_000).some((e) => e.type === "agent.decision_made")).toBe(true);
  });
});
