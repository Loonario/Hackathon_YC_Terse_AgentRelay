import { z } from "zod";
import { AgentId, SimulationId } from "./core.ts";
import { AgentProfile, Agent, WorldEvent, WorldState } from "./entities.ts";
import { SimulationEvent } from "./events.ts";
import { PlayerIntervention } from "./interventions.ts";

// ---------------------------------------------------------------------------
// HTTP routes. All bodies are JSON. Errors use `ApiError`.
// ---------------------------------------------------------------------------

export const routes = {
  simulations: () => `/api/simulations`,
  simulation: (id: string) => `/api/simulations/${id}`,
  start: (id: string) => `/api/simulations/${id}/start`,
  pause: (id: string) => `/api/simulations/${id}/pause`,
  resume: (id: string) => `/api/simulations/${id}/resume`,
  reset: (id: string) => `/api/simulations/${id}/reset`,
  /** POST `SetSpeedRequest`. */
  speed: (id: string) => `/api/simulations/${id}/speed`,
  agents: (id: string) => `/api/simulations/${id}/agents`,
  agent: (id: string, agentId: string) => `/api/simulations/${id}/agents/${agentId}`,
  /** Query: `?after=<sequence>&limit=<n>` */
  events: (id: string) => `/api/simulations/${id}/events`,
  /** Server-Sent Events. Query: `?after=<sequence>` to resume. */
  stream: (id: string) => `/api/simulations/${id}/stream`,
  interventions: (id: string) => `/api/simulations/${id}/interventions`,
} as const;

/**
 * "mock" runs the deterministic scripted agents (no LLM, no Agent Relay).
 * "live" runs LLM agents that talk over Agent Relay.
 */
export const SimulationMode = z.enum(["mock", "live"]);
export type SimulationMode = z.infer<typeof SimulationMode>;

// POST /api/simulations
export const CreateSimulationRequest = z.object({
  mode: SimulationMode.default("mock"),
  /** Same seed and mode gives the same mock run. */
  seed: z.int().default(1),
  agentIds: z.array(AgentId).min(2).optional(),
  /** Wall-clock milliseconds per tick. */
  tickIntervalMs: z.int().min(100).max(60_000).default(1000),
});
export type CreateSimulationRequest = z.input<typeof CreateSimulationRequest>;

// POST /api/simulations, GET /:id, and every lifecycle POST
export const SimulationResponse = z.object({ simulation: WorldState });
export type SimulationResponse = z.infer<typeof SimulationResponse>;

// POST /:id/speed. Responds with `SimulationResponse`.
export const SetSpeedRequest = z.object({ tickIntervalMs: z.int().min(100).max(60_000) });
export type SetSpeedRequest = z.infer<typeof SetSpeedRequest>;

// GET /:id/agents
export const AgentsResponse = z.object({ agents: z.array(Agent) });
export type AgentsResponse = z.infer<typeof AgentsResponse>;

// GET /:id/agents/:agentId
export const AgentProfileResponse = z.object({ agent: AgentProfile });
export type AgentProfileResponse = z.infer<typeof AgentProfileResponse>;

// GET /:id/events
export const EventsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type EventsQuery = z.input<typeof EventsQuery>;

export const EventsResponse = z.object({
  events: z.array(SimulationEvent),
  /** Highest sequence the server has. If it exceeds the last returned event, fetch again. */
  lastSequence: z.int().min(0),
});
export type EventsResponse = z.infer<typeof EventsResponse>;

// POST /:id/interventions
export const InterventionRequest = PlayerIntervention;
export type InterventionRequest = PlayerIntervention;

export const InterventionResponse = z.object({ worldEvent: WorldEvent });
export type InterventionResponse = z.infer<typeof InterventionResponse>;

export const ApiError = z.object({
  error: z.object({
    code: z.enum(["not_found", "invalid_request", "invalid_state", "internal"]),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------------------------------------------------------------------------
// Live stream (GET /:id/stream, Server-Sent Events).
//
// Each SSE `data:` line is one JSON `StreamMessage`. The SSE `id:` is the
// event sequence, so browsers reconnect with `Last-Event-ID` automatically.
//
// On connect the server sends one `snapshot`, then every event with
// sequence > snapshot.lastSequence, in order. With `?after=N` and N still in
// the log, the server skips the snapshot and replays events after N.
// ---------------------------------------------------------------------------

export const StreamMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), snapshot: WorldState }),
  z.object({ kind: z.literal("event"), event: SimulationEvent }),
  z.object({ kind: z.literal("heartbeat"), lastSequence: z.int().min(0) }),
]);
export type StreamMessage = z.infer<typeof StreamMessage>;

// ---------------------------------------------------------------------------
// Client interface. The frontend codes against this. The HTTP client and the
// in-browser mock client both implement it, so either can be swapped in.
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

export interface SimulationClient {
  create(request?: CreateSimulationRequest): Promise<WorldState>;
  get(simulationId: SimulationId): Promise<WorldState>;
  start(simulationId: SimulationId): Promise<WorldState>;
  pause(simulationId: SimulationId): Promise<WorldState>;
  resume(simulationId: SimulationId): Promise<WorldState>;
  reset(simulationId: SimulationId): Promise<WorldState>;
  setSpeed(simulationId: SimulationId, tickIntervalMs: number): Promise<WorldState>;
  listAgents(simulationId: SimulationId): Promise<Agent[]>;
  getAgent(simulationId: SimulationId, agentId: AgentId): Promise<AgentProfile>;
  listEvents(simulationId: SimulationId, query?: EventsQuery): Promise<EventsResponse>;
  intervene(simulationId: SimulationId, intervention: PlayerIntervention): Promise<WorldEvent>;
  /** Delivers a snapshot first, then events in sequence order. */
  subscribe(
    simulationId: SimulationId,
    onMessage: (message: StreamMessage) => void,
    options?: { after?: number },
  ): Unsubscribe;
}
