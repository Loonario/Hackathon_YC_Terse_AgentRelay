import { SetSpeedRequest } from "@proj/contract";
import { readJson, simulationResponse, withSimulation } from "@/server/http";

// POST SetSpeedRequest -> SimulationResponse
export const POST = withSimulation(async (sim, req) => {
  const { tickIntervalMs } = SetSpeedRequest.parse(await readJson(req));
  sim.runner.setSpeed(tickIntervalMs);
  return simulationResponse(sim);
});
