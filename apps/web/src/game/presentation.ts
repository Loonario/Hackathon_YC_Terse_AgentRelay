import type { AgentId, AgentStatus, SimulationEvent, WorldState } from "@proj/contract";
import type { CharacterCue, Mood, PresentationState } from "./types";

// Translates backend events into display cues. Nothing here decides what an
// agent does: it only chooses how to show what the backend reported.

export function stateForStatus(status: AgentStatus): PresentationState {
  switch (status) {
    case "thinking":
      return "thinking";
    case "acting":
      return "performing_action";
    case "communicating":
      return "communicating";
    case "offline":
      return "offline";
    case "error":
      return "concerned";
    default:
      return "idle";
  }
}

export function moodForState(state: PresentationState): Mood {
  switch (state) {
    case "thinking":
      return "thinking";
    case "celebrating":
      return "happy";
    case "concerned":
      return "worried";
    case "offline":
      return "sleepy";
    case "negotiating":
      return "love";
    default:
      return "neutral";
  }
}

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function cuesForEvent(event: SimulationEvent, state: WorldState): CharacterCue[] {
  switch (event.type) {
    case "agent.status_changed": {
      const s = stateForStatus(event.payload.to);
      return [{ agentId: event.payload.agentId, state: s, mood: moodForState(s) }];
    }
    case "agent.decision_made":
      return [
        {
          agentId: event.payload.agentId,
          state: "thinking",
          mood: "thinking",
          holdMs: 2200,
          bubble: { kind: "thought", text: clip(event.payload.reasoningSummary, 70) },
        },
      ];
    case "agent.message_sent": {
      const m = event.payload.message;
      const kind = m.messageType === "proposal" ? "proposal" : m.messageType === "broadcast" ? "system" : "speech";
      const cues: CharacterCue[] = [
        {
          agentId: m.senderId,
          state: m.messageType === "proposal" ? "negotiating" : "communicating",
          holdMs: 2600,
          bubble: { kind, text: clip(m.content) },
          lookAt: m.recipientIds.length === 1 ? m.recipientIds[0] : null,
        },
      ];
      for (const r of m.recipientIds) cues.push({ agentId: r, lookAt: m.senderId, holdMs: 2600 });
      return cues;
    }
    case "agent.moved":
      return [{ agentId: event.payload.agentId, state: "moving" }];
    case "agent.action_resolved":
      return [
        event.payload.outcome === "succeeded"
          ? { agentId: event.payload.agentId, state: "performing_action", holdMs: 1600 }
          : { agentId: event.payload.agentId, state: "concerned", mood: "angry", holdMs: 2000, bubble: { kind: "conflict", text: clip(event.payload.reason, 60) } },
      ];
    case "agent.relationship_changed": {
      const { agentId, relationship } = event.payload;
      const mood: Mood = relationship.stance === "rival" ? "angry" : relationship.stance === "wary" ? "worried" : relationship.stance === "ally" ? "love" : "happy";
      return [{ agentId, mood, holdMs: 1800, lookAt: relationship.agentId }];
    }
    case "alliance.proposed":
      return event.payload.agreement.participantIds
        .filter((id) => id !== event.payload.agreement.proposerId)
        .map((id) => ({ agentId: id, mood: "surprised" as Mood, holdMs: 1500, lookAt: event.payload.agreement.proposerId }));
    case "alliance.accepted":
      return event.payload.agreement.status === "active"
        ? event.payload.agreement.participantIds.map((id) => ({ agentId: id, state: "celebrating" as PresentationState, holdMs: 2400 }))
        : [{ agentId: event.payload.byAgentId, mood: "happy", holdMs: 1500 }];
    case "alliance.rejected":
      return [
        { agentId: event.payload.byAgentId, mood: "angry", holdMs: 2000, lookAt: event.payload.agreement.proposerId },
        { agentId: event.payload.agreement.proposerId, state: "concerned", holdMs: 2200, bubble: { kind: "conflict", text: "Rejected?!" } },
      ];
    case "world.event_triggered": {
      // Everyone reacts to a world event; the target reacts more.
      const target = event.payload.worldEvent.targetAgentId;
      return state.agents.map((a) => ({
        agentId: a.id,
        mood: (a.id === target ? "worried" : "surprised") as Mood,
        holdMs: 1800,
      }));
    }
    default:
      return [];
  }
}

/** The agent ids an event is about, for timeline click-to-focus. */
export function agentsInEvent(event: SimulationEvent): AgentId[] {
  const p = event.payload as Record<string, unknown>;
  const ids = new Set<AgentId>();
  if (typeof p.agentId === "string") ids.add(p.agentId as AgentId);
  if (typeof p.byAgentId === "string") ids.add(p.byAgentId as AgentId);
  if (event.type === "agent.message_sent") {
    ids.add(event.payload.message.senderId);
    event.payload.message.recipientIds.forEach((r) => ids.add(r));
  }
  if ("agreement" in p) (p.agreement as { participantIds: AgentId[] }).participantIds.forEach((r) => ids.add(r));
  return [...ids];
}
