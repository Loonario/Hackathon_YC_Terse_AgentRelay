import { AgentId } from "@proj/contract";
import { SimError } from "@proj/sim";
import { handle } from "@/server/http";
import { getSimulation } from "@/server/registry";

// GET -> AgentProfileResponse
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; agentId: string }> }) {
  return handle(async () => {
    const { id, agentId } = await ctx.params;
    const sim = await getSimulation(id);
    const parsed = AgentId.safeParse(agentId);
    if (!parsed.success || !sim.engine.hasAgent(parsed.data)) throw new SimError("not_found", `agent ${agentId} not found`);
    return Response.json({ agent: sim.engine.profile(parsed.data) });
  });
}
