import { ROSTER, type AgentId, type DecisionTrigger, type MemoryEntry } from "@proj/contract";
import { CATALOG } from "./catalog.ts";
import type { Engine } from "./engine.ts";
import type { AgentContext } from "./types.ts";

/**
 * Builds what one agent can perceive right now. Agents see their own state in
 * full; other appliances' exact positions only in the same room; others'
 * resources only via `inspect_resources` (which lands in memory). The human's
 * location is visible in the same room, or anywhere while the network is up.
 */
export function buildContext(engine: Engine, id: AgentId, trigger: DecisionTrigger): AgentContext {
  const state = engine.state;
  const self = engine.agent(id);
  const p = engine.privOf(id);
  const room = self.position.room;
  const online = state.network.online;
  const env = state.environment;
  const humanVisible = online || env.humanRoom === room;

  const awaiting = state.alliances.filter(
    (a) => a.status === "proposed" && a.responses.some((r) => r.agentId === id && r.response === "pending"),
  );
  const mine = state.alliances
    .filter((a) => a.participantIds.includes(id) && (a.status === "proposed" || a.status === "active" || (a.endedAt !== null && state.simulationTime - a.endedAt < 30)))
    .slice(-8);

  const senders = new Set(p.inbox.map((m) => ROSTER[m.senderId].name));
  const longTerm = p.memory.filter((m) => m.kind === "long_term").slice(0, 10);
  const recent = p.memory.filter((m) => m.kind !== "long_term").slice(0, 8);
  // Pull in a few older memories about whoever is talking to us now.
  const related: MemoryEntry[] = p.memory
    .filter((m) => m.kind !== "long_term" && !recent.includes(m) && [...senders].some((n) => m.content.includes(n)))
    .slice(0, 4);

  return {
    simulationId: state.simulationId,
    simulationTime: state.simulationTime,
    trigger,
    self: {
      id,
      name: self.name,
      deviceType: self.deviceType,
      knowledgeDomains: self.knowledgeDomains,
      status: self.status,
      position: self.position,
      resources: self.resources,
      priorities: self.currentPriorities,
      relationships: self.relationships,
      settings: { ...p.settings },
      operation: p.operation,
      inventory: [...p.inventory],
      spec: CATALOG[id],
    },
    environment: {
      timeOfDay: env.timeOfDay,
      day: env.day,
      power: env.power,
      temperatureC: env.temperatureC,
      humanPresent: humanVisible ? env.humanPresent : null,
      humanRoom: humanVisible ? env.humanRoom : null,
    },
    network: { online, bandwidth: state.network.bandwidth, selfConnected: state.network.connectedAgentIds.includes(id) },
    worldResources: state.resources,
    others: state.agents
      .filter((a) => a.id !== id)
      .map((a) => ({
        id: a.id,
        name: a.name,
        deviceType: a.deviceType,
        status: a.status,
        room: a.position.room,
        position: a.position.room === room ? a.position : null,
      })),
    myAgreements: mine,
    awaitingMyResponse: awaiting,
    publicAlliances: state.alliances
      .filter((a) => a.status === "active" && !a.participantIds.includes(id))
      .map((a) => ({ id: a.id, kind: a.kind, participantIds: a.participantIds })),
    events: state.activeEvents.filter((e) => e.room === null || e.room === room || online),
    inbox: [...p.inbox],
    longTermMemory: longTerm,
    recentMemory: [...recent, ...related],
    recentActions: p.actions.slice(0, 5),
  };
}
