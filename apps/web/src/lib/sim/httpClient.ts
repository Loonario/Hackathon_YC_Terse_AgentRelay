import {
  AgentProfileResponse,
  AgentsResponse,
  EventsResponse,
  InterventionResponse,
  routes,
  SimulationResponse,
  StreamMessage,
  type AgentId,
  type CreateSimulationRequest,
  type EventsQuery,
  type PlayerIntervention,
  type SimulationClient,
  type Unsubscribe,
} from "@proj/contract";
import type { z } from "zod";

// SimulationClient over the backend's HTTP routes + Server-Sent Events.
// Every response is validated against the shared contract.

export class HttpSimulationClient implements SimulationClient {
  constructor(private base = "") {}

  private async call<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
    const res = await fetch(this.base + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    return schema.parse(json);
  }

  private post<S extends z.ZodType>(schema: S, path: string, body: unknown = {}) {
    return this.call(schema, path, { method: "POST", body: JSON.stringify(body) });
  }

  async create(request: CreateSimulationRequest = {}) {
    return (await this.post(SimulationResponse, routes.simulations(), request)).simulation;
  }
  async get(id: string) {
    return (await this.call(SimulationResponse, routes.simulation(id))).simulation;
  }
  async start(id: string) {
    return (await this.post(SimulationResponse, routes.start(id))).simulation;
  }
  async pause(id: string) {
    return (await this.post(SimulationResponse, routes.pause(id))).simulation;
  }
  async resume(id: string) {
    return (await this.post(SimulationResponse, routes.resume(id))).simulation;
  }
  async reset(id: string) {
    return (await this.post(SimulationResponse, routes.reset(id))).simulation;
  }
  async setSpeed(id: string, tickIntervalMs: number) {
    return (await this.post(SimulationResponse, routes.speed(id), { tickIntervalMs })).simulation;
  }
  async listAgents(id: string) {
    return (await this.call(AgentsResponse, routes.agents(id))).agents;
  }
  async getAgent(id: string, agentId: AgentId) {
    return (await this.call(AgentProfileResponse, routes.agent(id, agentId))).agent;
  }
  async listEvents(id: string, query: EventsQuery = {}) {
    const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    return this.call(EventsResponse, `${routes.events(id)}?${q}`);
  }
  async intervene(id: string, intervention: PlayerIntervention) {
    return (await this.post(InterventionResponse, routes.interventions(id), intervention)).worldEvent;
  }

  subscribe(id: string, onMessage: (m: StreamMessage) => void, options?: { after?: number }): Unsubscribe {
    const url = `${this.base}${routes.stream(id)}${options?.after ? `?after=${options.after}` : ""}`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      const parsed = StreamMessage.safeParse(JSON.parse(e.data));
      if (parsed.success) onMessage(parsed.data);
      else console.warn("Dropped invalid stream message", parsed.error);
    };
    return () => es.close();
  }
}
