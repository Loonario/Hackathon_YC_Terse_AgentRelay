import { simulationResponse, withSimulation } from "@/server/http";

// GET /api/simulations/:id -> SimulationResponse
export const GET = withSimulation((sim) => simulationResponse(sim));
