import type { Agent, Agreement, WorldState } from "./entities.ts";
import type { SimulationEvent } from "./events.ts";

/**
 * Applies one event to a snapshot and returns the new snapshot. Pure: the input
 * is not mutated. Events at or below `state.lastSequence`, or for another
 * simulation, are ignored, so replaying overlapping ranges is safe.
 *
 * The backend uses this to build snapshots, and clients use it to stay in sync.
 */
export function applyEvent(state: WorldState, event: SimulationEvent): WorldState {
  if (event.simulationId !== state.simulationId) return state;
  if (event.sequence <= state.lastSequence) return state;

  if (event.type === "simulation.reset") {
    return { ...event.payload.snapshot, lastSequence: event.sequence };
  }

  const next: WorldState = {
    ...state,
    simulationTime: Math.max(state.simulationTime, event.simulationTime),
    lastSequence: event.sequence,
  };

  switch (event.type) {
    case "simulation.started":
    case "simulation.resumed":
      return { ...next, status: "running" };
    case "simulation.paused":
      return { ...next, status: "paused" };
    case "simulation.ended":
      return { ...next, status: "ended" };
    case "simulation.speed_changed":
      return { ...next, tickIntervalMs: event.payload.tickIntervalMs };

    case "world.updated":
      return { ...next, environment: event.payload.environment };
    case "world.event_triggered": {
      const others = next.activeEvents.filter((e) => e.id !== event.payload.worldEvent.id);
      return { ...next, activeEvents: [...others, event.payload.worldEvent] };
    }
    case "world.event_ended":
      return { ...next, activeEvents: next.activeEvents.filter((e) => e.id !== event.payload.worldEventId) };
    case "resource.updated": {
      const { ownerId, resources } = event.payload;
      if (ownerId === "world") return { ...next, resources };
      return updateAgent(next, ownerId, (a) => ({ ...a, resources }));
    }
    case "network.updated":
      return { ...next, network: event.payload.network };

    case "agent.joined": {
      const others = next.agents.filter((a) => a.id !== event.payload.agent.id);
      return { ...next, agents: [...others, event.payload.agent] };
    }
    case "agent.status_changed":
      return updateAgent(next, event.payload.agentId, (a) => ({ ...a, status: event.payload.to }));
    case "agent.moved":
      return updateAgent(next, event.payload.agentId, (a) => ({ ...a, position: event.payload.to }));
    case "agent.priority_updated":
      return updateAgent(next, event.payload.agentId, (a) => ({ ...a, currentPriorities: event.payload.priorities }));
    case "agent.relationship_changed": {
      const rel = event.payload.relationship;
      return updateAgent(next, event.payload.agentId, (a) => ({
        ...a,
        relationships: [...a.relationships.filter((r) => r.agentId !== rel.agentId), rel],
      }));
    }
    case "agent.action_resolved": {
      const { agentId, action, outcome, reason } = event.payload;
      return updateAgent(next, agentId, (a) => ({
        ...a,
        lastAction: { action, outcome, summary: reason, simulationTime: event.simulationTime },
      }));
    }
    // Recorded in the event log only. No snapshot field changes.
    case "agent.decision_made":
    case "agent.action_proposed":
    case "agent.message_sent":
      return next;

    case "alliance.proposed":
    case "alliance.accepted":
    case "alliance.rejected":
    case "alliance.updated":
      return upsertAgreement(next, event.payload.agreement);

    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** Applies events in sequence order. */
export function applyEvents(state: WorldState, events: readonly SimulationEvent[]): WorldState {
  return [...events].sort((a, b) => a.sequence - b.sequence).reduce(applyEvent, state);
}

function updateAgent(state: WorldState, agentId: Agent["id"], fn: (agent: Agent) => Agent): WorldState {
  return { ...state, agents: state.agents.map((a) => (a.id === agentId ? fn(a) : a)) };
}

function upsertAgreement(state: WorldState, agreement: Agreement): WorldState {
  const exists = state.alliances.some((a) => a.id === agreement.id);
  return {
    ...state,
    alliances: exists
      ? state.alliances.map((a) => (a.id === agreement.id ? agreement : a))
      : [...state.alliances, agreement],
  };
}
