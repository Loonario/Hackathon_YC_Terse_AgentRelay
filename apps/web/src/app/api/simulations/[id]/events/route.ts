import { EventsQuery } from "@proj/contract";
import { withSimulation } from "@/server/http";
import { storedEvents } from "@/server/persistence";

// GET ?after=<sequence>&limit=<n> -> EventsResponse
export const GET = withSimulation(async (sim, req) => {
  const url = new URL(req.url);
  const { after, limit } = EventsQuery.parse(Object.fromEntries(url.searchParams));
  const engine = sim.engine;
  // Older than what's in memory: read it from the Terse log.
  const events =
    after < engine.firstSequence - 1 && sim.sink
      ? await storedEvents(sim.id, after, limit).catch(() => engine.events(after, limit))
      : engine.events(after, limit);
  return Response.json({ events, lastSequence: engine.state.lastSequence });
});
