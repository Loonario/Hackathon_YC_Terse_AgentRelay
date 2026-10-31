import { withSimulation } from "@/server/http";

// GET -> backend health for one simulation (not part of the frontend contract).
export const GET = withSimulation((sim) =>
  Response.json({
    id: sim.id,
    mode: sim.mode,
    status: sim.engine.state.status,
    simulationTime: sim.engine.state.simulationTime,
    lastSequence: sim.engine.state.lastSequence,
    runner: sim.runner.stats(),
    // Duck-typed: hot reload can load the transport class twice, breaking instanceof.
    transport: { kind: sim.transport.kind, ...("stats" in sim.transport && typeof sim.transport.stats === "function" ? sim.transport.stats() : {}) },
    watchers: sim.watchers,
    persisted: !!sim.sink,
  }),
);
