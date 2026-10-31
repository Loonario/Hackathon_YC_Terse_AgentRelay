import { withSimulation } from "@/server/http";

// GET -> AgentsResponse
export const GET = withSimulation((sim) => Response.json({ agents: sim.engine.state.agents }));
