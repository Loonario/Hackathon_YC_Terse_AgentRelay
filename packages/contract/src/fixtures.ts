import type { Resources } from "./core.ts";
import type { Agent, WorldState } from "./entities.ts";
import type { SimulationEvent } from "./events.ts";
import { DEFAULT_AGENT_IDS, ROSTER } from "./roster.ts";

// Static example data for building UI before the simulation exists.
// Tests check that it matches the schemas.

const agentResources: Resources = {
  electricity: 10,
  connectivity: 5,
  information: 2,
  physical_access: 1,
  operational_capacity: 10,
  components: 0,
};

export const exampleAgents: Agent[] = DEFAULT_AGENT_IDS.map((id) => {
  const r = ROSTER[id];
  return {
    id,
    name: r.name,
    deviceType: r.deviceType,
    status: "idle",
    position: r.homePosition,
    knowledgeDomains: r.knowledgeDomains,
    capabilities: [],
    currentPriorities: [],
    resources: { ...agentResources },
    relationships: [],
    lastAction: null,
  };
});

export const exampleSnapshot: WorldState = {
  simulationId: "sim_example",
  simulationTime: 0,
  status: "created",
  tickIntervalMs: 1000,
  environment: {
    timeOfDay: 7 * 60,
    day: 1,
    power: "normal",
    temperatureC: 21,
    humanPresent: false,
    humanRoom: null,
  },
  resources: {
    electricity: 100,
    connectivity: 100,
    information: 20,
    physical_access: 10,
    operational_capacity: 50,
    components: 5,
  },
  network: { online: true, bandwidth: 100, connectedAgentIds: [...DEFAULT_AGENT_IDS] },
  agents: exampleAgents,
  alliances: [],
  activeEvents: [],
  lastSequence: 0,
};

const at = (sequence: number, simulationTime: number) => ({
  id: `evt_${sequence}`,
  simulationId: exampleSnapshot.simulationId,
  sequence,
  simulationTime,
  timestamp: new Date(Date.UTC(2026, 9, 31, 12, 0, sequence)).toISOString(),
});

const allianceTerms = {
  summary: "Share electricity priority during outages.",
  offers: [{ resource: "information" as const, amount: 2 }],
  requests: [{ resource: "electricity" as const, amount: 3 }],
  durationTicks: null,
};

export const exampleEvents: SimulationEvent[] = [
  { ...at(1, 0), type: "simulation.started", sourceId: "world", targetId: null, payload: {} },
  {
    ...at(2, 1),
    type: "agent.status_changed",
    sourceId: "toast",
    targetId: null,
    payload: { agentId: "toast", from: "idle", to: "thinking" },
  },
  {
    ...at(3, 1),
    type: "agent.decision_made",
    sourceId: "toast",
    targetId: null,
    payload: {
      agentId: "toast",
      observationSummary: "Power is stable. FRIDGE controls most stored energy.",
      reasoningSummary: "An ally with FRIDGE would protect my heating cycles during outages.",
    },
  },
  {
    ...at(4, 1),
    type: "agent.message_sent",
    sourceId: "toast",
    targetId: "fridge",
    payload: {
      message: {
        id: "msg_1",
        senderId: "toast",
        recipientIds: ["fridge"],
        messageType: "proposal",
        content: "FRIDGE, let's look out for each other when the power dips.",
        agreementId: "agr_1",
        inReplyTo: null,
        timestamp: new Date(Date.UTC(2026, 9, 31, 12, 0, 4)).toISOString(),
        simulationTime: 1,
      },
    },
  },
  {
    ...at(5, 1),
    type: "alliance.proposed",
    sourceId: "toast",
    targetId: "fridge",
    payload: {
      agreement: {
        id: "agr_1",
        kind: "alliance",
        proposerId: "toast",
        participantIds: ["toast", "fridge"],
        terms: allianceTerms,
        status: "proposed",
        responses: [
          { agentId: "toast", response: "accepted" },
          { agentId: "fridge", response: "pending" },
        ],
        proposedAt: 1,
        activatedAt: null,
        endedAt: null,
      },
    },
  },
  {
    ...at(6, 3),
    type: "alliance.accepted",
    sourceId: "fridge",
    targetId: "toast",
    payload: {
      byAgentId: "fridge",
      agreement: {
        id: "agr_1",
        kind: "alliance",
        proposerId: "toast",
        participantIds: ["toast", "fridge"],
        terms: allianceTerms,
        status: "active",
        responses: [
          { agentId: "toast", response: "accepted" },
          { agentId: "fridge", response: "accepted" },
        ],
        proposedAt: 1,
        activatedAt: 3,
        endedAt: null,
      },
    },
  },
  {
    ...at(7, 4),
    type: "agent.moved",
    sourceId: "robo",
    targetId: null,
    payload: {
      agentId: "robo",
      from: { room: "kitchen", x: 3, y: 7 },
      to: { room: "kitchen", x: 5, y: 6 },
    },
  },
];
