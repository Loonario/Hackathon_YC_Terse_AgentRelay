import { PlayerIntervention } from "@proj/contract";
import { readJson, withSimulation } from "@/server/http";

// POST PlayerIntervention -> InterventionResponse
export const POST = withSimulation(async (sim, req) => {
  const intervention = PlayerIntervention.parse(await readJson(req));
  const worldEvent = sim.runner.intervene(intervention);
  return Response.json({ worldEvent });
});
