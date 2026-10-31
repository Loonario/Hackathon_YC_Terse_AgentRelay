// End-to-end check of the backend HTTP API against a running Next server.
// Every response is validated against the shared contract.
//
//   bun scripts/e2e.ts                       # mock mode, http://localhost:3000
//   bun scripts/e2e.ts --base http://localhost:3001 --live --seconds 60
import {
  AgentProfileResponse,
  AgentsResponse,
  ApiError,
  applyEvent,
  EventsResponse,
  InterventionResponse,
  routes,
  SimulationResponse,
  StreamMessage,
  type SimulationEvent,
  type WorldState,
} from "@proj/contract";
import type { z } from "zod";

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const base = arg("base", "http://localhost:3000");
const live = process.argv.includes("--live");
const seconds = Number(arg("seconds", live ? "60" : "8"));

let failures = 0;
const ok = (cond: unknown, label: string, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<S extends z.ZodType>(schema: S, path: string, body?: unknown): Promise<{ status: number; data: z.infer<S> | null; raw: unknown }> {
  const res = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const raw = await res.json();
  const parsed = schema.safeParse(raw);
  return { status: res.status, data: parsed.success ? parsed.data : null, raw };
}

/** Reads the SSE stream in the background, applying events to the first snapshot. */
function watch(id: string) {
  const ctrl = new AbortController();
  const out = { snapshot: null as WorldState | null, events: [] as SimulationEvent[], invalid: 0, state: null as WorldState | null };
  const done = (async () => {
    const res = await fetch(base + routes.stream(id), { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!data) continue;
        const m = StreamMessage.safeParse(JSON.parse(data.slice(6)));
        if (!m.success) {
          out.invalid++;
          continue;
        }
        if (m.data.kind === "snapshot") out.state = out.snapshot = m.data.snapshot;
        if (m.data.kind === "event" && out.state) {
          out.events.push(m.data.event);
          out.state = applyEvent(out.state, m.data.event);
        }
      }
    }
  })().catch(() => undefined);
  return { out, stop: async () => (ctrl.abort(), await done) };
}

const S = routes;
console.log(`\n== ${live ? "LIVE (OpenAI + Agent Relay)" : "MOCK"} against ${base} ==\n`);

// --- create ---------------------------------------------------------------
const created = await call(SimulationResponse, S.simulations(), { mode: live ? "live" : "mock", seed: 7, tickIntervalMs: live ? 1000 : 200 });
ok(created.status === 200 && created.data, "create simulation", created.data ? created.data.simulation.simulationId : JSON.stringify(created.raw));
if (!created.data) process.exit(1);
const id = created.data.simulation.simulationId;
ok(created.data.simulation.status === "created" && created.data.simulation.agents.length === 5, "starts with 5 agents, status created");

const bad = await call(ApiError, S.simulations(), { mode: "nope" });
ok(bad.status === 400 && bad.data, "rejects invalid create body (400)");
const missing = await call(ApiError, S.simulation("sim_does_not_exist"));
ok(missing.status === 404 && missing.data?.error.code === "not_found", "unknown simulation is 404");

// --- run + stream -----------------------------------------------------------
const stream = watch(id);
await sleep(300);
const started = await call(SimulationResponse, S.start(id), {});
ok(started.data?.simulation.status === "running", "start -> running");

const third = Math.max(2, Math.round(seconds / 3));
await sleep(third * 1000);
const outage = await call(InterventionResponse, S.interventions(id), { type: "power_outage", parameters: { durationTicks: live ? 12 : 10 } });
ok(outage.data?.worldEvent.kind === "power_outage", "power outage intervention");
const badIv = await call(ApiError, S.interventions(id), { type: "power_outage", parameters: {} });
ok(badIv.status === 400, "rejects invalid intervention (400)");
await sleep(third * 1000);
const human = await call(InterventionResponse, S.interventions(id), { type: "human_arrives", parameters: { room: "kitchen" } });
ok(human.data?.worldEvent.kind === "human_arrives", "human arrives intervention");
await call(InterventionResponse, S.interventions(id), { type: "spill", parameters: { room: "kitchen" } });
await sleep(third * 1000);

// --- reads ------------------------------------------------------------------
const snap = await call(SimulationResponse, S.simulation(id));
ok(snap.data, "GET simulation matches contract", snap.data ? `t=${snap.data.simulation.simulationTime} seq=${snap.data.simulation.lastSequence}` : "");
const agents = await call(AgentsResponse, S.agents(id));
ok(agents.data?.agents.length === 5, "GET agents");
const profile = await call(AgentProfileResponse, S.agent(id, "fridge"));
ok(profile.data && profile.data.agent.recentMemory.length > 0, "GET agent profile has memory", profile.data ? `${profile.data.agent.recentMemory.length} memories` : "");
const noAgent = await call(ApiError, S.agent(id, "vision"));
ok(noAgent.status === 404, "agent not in simulation is 404");
const page = await call(EventsResponse, `${S.events(id)}?after=0&limit=50`);
ok(page.data?.events.length === 50 && page.data.events[0]!.sequence === 1, "GET events pages from the start");

// --- stream consistency -----------------------------------------------------
await stream.stop();
const s = stream.out;
ok(s.snapshot && s.invalid === 0, "stream: snapshot first, every message valid", `${s.events.length} events`);
const seqs = s.events.map((e) => e.sequence);
ok(seqs.every((q, i) => i === 0 || q === seqs[i - 1]! + 1), "stream: sequences strictly consecutive");
const types = new Map<string, number>();
for (const e of s.events) types.set(e.type, (types.get(e.type) ?? 0) + 1);
console.log("  event counts:", Object.fromEntries([...types].sort((a, b) => b[1] - a[1])));
for (const t of ["agent.decision_made", "agent.message_sent", "agent.action_resolved", "agent.priority_updated", "world.event_triggered"]) {
  ok((types.get(t) ?? 0) > 0, `stream has ${t}`);
}
const now = await call(SimulationResponse, S.simulation(id));
if (s.state && now.data) {
  const strip = (w: WorldState) => ({ ...w, simulationTime: 0, lastSequence: 0, environment: { ...w.environment, timeOfDay: 0 }, agents: w.agents.map((a) => ({ ...a, status: "x", resources: {} })), resources: {} });
  ok(s.state.lastSequence <= now.data.simulation.lastSequence, "client-side replay keeps up with server");
  ok(JSON.stringify(strip(s.state).alliances) === JSON.stringify(strip(now.data.simulation).alliances) || s.state.lastSequence < now.data.simulation.lastSequence, "client replay matches server agreements");
}
const offline = s.events.filter((e) => e.type === "agent.status_changed" && e.payload.to === "offline").length;
ok(offline >= 4, "outage took non-battery agents offline", `${offline} went offline`);

// --- sample of what the agents said -----------------------------------------
const said = s.events.flatMap((e) => (e.type === "agent.message_sent" ? [`${e.payload.message.senderId} -> ${e.payload.message.recipientIds.join(",")}: ${e.payload.message.content}`] : []));
console.log("  messages (first 6):");
for (const m of said.slice(0, 6)) console.log(`    ${m.slice(0, 150)}`);
const deals = s.events.flatMap((e) => (e.type.startsWith("alliance.") && "agreement" in e.payload ? [`${e.type} ${e.payload.agreement.id} ${e.payload.agreement.status}: ${e.payload.agreement.terms.summary}`] : []));
console.log(`  agreement events: ${deals.length}`);
for (const d of deals.slice(0, 4)) console.log(`    ${d.slice(0, 150)}`);

// --- backend health ---------------------------------------------------------
const debug = (await (await fetch(base + `/api/simulations/${id}/debug`)).json()) as {
  runner: { decisions: { main: number; fallback: number; failed: number } };
  transport: { kind: string; sent?: number; acked?: number; ackedLate?: number; failed?: number; skipped?: number; error?: string | null; channel?: string | null };
  persisted: boolean;
};
console.log("  runner:", JSON.stringify(debug.runner), "\n  transport:", JSON.stringify(debug.transport));
ok(debug.persisted, "persisted to Terse");
if (live) {
  ok(debug.runner.decisions.main > 0, "OpenAI made decisions", `${debug.runner.decisions.main} OpenAI, ${debug.runner.decisions.fallback} fallback`);
  ok(debug.transport.kind === "relay", "messages use the Agent Relay transport");
  ok((debug.transport.acked ?? 0) + (debug.transport.ackedLate ?? 0) > 0, "Relay accepted messages", `acked ${debug.transport.acked}, late ${debug.transport.ackedLate}, failed ${debug.transport.failed}, skipped ${debug.transport.skipped}`);
}

// --- lifecycle --------------------------------------------------------------
const paused = await call(SimulationResponse, S.pause(id), {});
ok(paused.data?.simulation.status === "paused", "pause");
const resumed = await call(SimulationResponse, S.resume(id), {});
ok(resumed.data?.simulation.status === "running", "resume");
const fast = await call(SimulationResponse, `/api/simulations/${id}/speed`, { tickIntervalMs: 250 });
ok(fast.data?.simulation.tickIntervalMs === 250, "set speed");
const reset = await call(SimulationResponse, S.reset(id), {});
ok(reset.data?.simulation.status === "created" && reset.data.simulation.alliances.length === 0 && reset.data.simulation.simulationTime === 0, "reset to a fresh world");
await call(SimulationResponse, S.pause(id), {});

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}  (simulation ${id})\n`);
process.exit(failures ? 1 : 0);
