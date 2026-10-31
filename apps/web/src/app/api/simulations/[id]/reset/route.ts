import { simulationResponse, withSimulation } from "@/server/http";

export const POST = withSimulation((sim) => {
  sim.runner.reset();
  return simulationResponse(sim);
});
