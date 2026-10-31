import { handle, readJson, simulationResponse } from "@/server/http";
import { createSimulation } from "@/server/registry";

// POST /api/simulations: CreateSimulationRequest -> SimulationResponse
export async function POST(req: Request) {
  return handle(async () => {
    const sim = await createSimulation(await readJson(req));
    return simulationResponse(sim);
  });
}
