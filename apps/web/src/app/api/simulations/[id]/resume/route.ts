import { simulationResponse, withSimulation } from "@/server/http";

export const POST = withSimulation((sim) => {
  sim.runner.start();
  return simulationResponse(sim);
});
