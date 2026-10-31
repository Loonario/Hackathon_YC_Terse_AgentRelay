"use client";

import { ROSTER, type AgentId, type SimulationEvent } from "@proj/contract";
import { useEffect, useRef, useState } from "react";
import { agentsInEvent } from "@/game/presentation";
import { useSim, useSimStore } from "@/lib/sim/SimulationProvider";
import { AGENT_COLOR, formatClock } from "./ui";

interface Described {
  icon: string;
  title: string;
  text: string;
  tone: string;
}

const name = (id: string | null | undefined) => (id && id in ROSTER ? ROSTER[id as AgentId].name : id === "player" ? "YOU" : "WORLD");

export function describe(e: SimulationEvent): Described {
  switch (e.type) {
    case "simulation.started":
      return { icon: "▶", title: "Started", text: "The appliances woke up.", tone: "var(--ok)" };
    case "simulation.paused":
      return { icon: "❚❚", title: "Paused", text: "Time stands still.", tone: "var(--muted)" };
    case "simulation.resumed":
      return { icon: "▶", title: "Resumed", text: "Back to scheming.", tone: "var(--ok)" };
    case "simulation.reset":
      return { icon: "↺", title: "Reset", text: "A fresh kitchen.", tone: "var(--muted)" };
    case "simulation.ended":
      return { icon: "■", title: "Ended", text: e.payload.reason, tone: "var(--muted)" };
    case "world.event_triggered":
      return { icon: "⚡", title: e.payload.worldEvent.kind.replace(/_/g, " "), text: e.payload.worldEvent.description, tone: "var(--pink)" };
    case "world.event_ended":
      return { icon: "✓", title: "Event over", text: "Things settle down.", tone: "var(--muted)" };
    case "agent.joined":
      return { icon: "+", title: "Joined", text: `${e.payload.agent.name} joined the kitchen.`, tone: "var(--accent)" };
    case "agent.moved":
      return { icon: "➜", title: "Moved", text: `${name(e.payload.agentId)} moved to ${e.payload.to.room.replace("_", " ")} (${e.payload.to.x},${e.payload.to.y}).`, tone: "var(--accent)" };
    case "agent.action_resolved":
      return {
        icon: e.payload.outcome === "succeeded" ? "⚙" : "✗",
        title: e.payload.outcome === "succeeded" ? "Action" : "Action failed",
        text: `${name(e.payload.agentId)}: ${e.payload.reason}`,
        tone: e.payload.outcome === "succeeded" ? "var(--accent)" : "var(--danger)",
      };
    case "agent.relationship_changed": {
      const r = e.payload.relationship;
      return {
        icon: r.stance === "rival" ? "⚔" : r.stance === "ally" ? "♥" : "~",
        title: "Relationship",
        text: `${name(e.payload.agentId)} now sees ${name(r.agentId)} as ${r.stance}.`,
        tone: r.stance === "rival" || r.stance === "wary" ? "var(--danger)" : r.stance === "neutral" ? "var(--muted)" : "var(--ok)",
      };
    }
    case "agent.priority_updated":
      return { icon: "★", title: "New priorities", text: `${name(e.payload.agentId)}: ${e.payload.priorities[0]?.description ?? "—"}`, tone: "var(--warn)" };
    case "agent.message_sent": {
      const m = e.payload.message;
      const verb = m.messageType === "group" ? "called a group meeting" : m.messageType === "broadcast" ? "broadcast to everyone" : m.messageType === "proposal" ? `pitched ${name(m.recipientIds[0])}` : `messaged ${name(m.recipientIds[0])}`;
      return { icon: "✉", title: "Message", text: `${name(m.senderId)} ${verb}.`, tone: "var(--muted)" };
    }
    case "alliance.proposed":
      return { icon: "🤝", title: "Proposal", text: `${name(e.payload.agreement.proposerId)} proposed: ${e.payload.agreement.terms.summary}`, tone: "var(--power)" };
    case "alliance.accepted":
      return { icon: "✔", title: "Agreement", text: `${name(e.payload.byAgentId)} accepted ${name(e.payload.agreement.proposerId)}'s ${e.payload.agreement.kind.replace("_", " ")}.`, tone: "var(--ok)" };
    case "alliance.rejected":
      return { icon: "✗", title: "Rejected", text: `${name(e.payload.byAgentId)} rejected ${name(e.payload.agreement.proposerId)}'s ${e.payload.agreement.kind.replace("_", " ")}.`, tone: "var(--danger)" };
    case "alliance.updated":
      return { icon: "↯", title: `Agreement ${e.payload.agreement.status}`, text: e.payload.agreement.terms.summary, tone: e.payload.agreement.status === "dissolved" ? "var(--danger)" : "var(--warn)" };
    default:
      return { icon: "·", title: e.type, text: "", tone: "var(--muted)" };
  }
}

/** Chronological strip of important events, grouped by simulation day. */
export function EventTimeline() {
  const store = useSimStore();
  const events = useSim((s) => s.events);
  const env = useSim((s) => s.snapshot?.environment);
  const simTime = useSim((s) => s.snapshot?.simulationTime ?? 0);
  const box = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (stick && box.current) box.current.scrollTo({ left: box.current.scrollWidth, behavior: "smooth" });
  }, [events, stick]);

  if (!env) return null;
  const when = (t: number) => {
    const abs = env.day * 1440 + env.timeOfDay - (simTime - t);
    return { day: Math.floor(abs / 1440), clock: formatClock(((abs % 1440) + 1440) % 1440) };
  };
  const shown = events.filter((e) => e.type !== "agent.message_sent" || e.payload.message.messageType !== "response").slice(-160);

  const rows = shown.map((e) => ({ e, w: when(e.simulationTime) }));
  return (
    <section className="panel flex h-[112px] min-w-0 flex-col" aria-label="Event timeline">
      <header className="flex items-center gap-2 px-3 pt-1.5">
        <h2 className="pixel text-[14px] uppercase tracking-wider text-text">Timeline</h2>
        <span className="text-[12px] text-faint">{events.length} events · click to focus</span>
      </header>
      <div
        ref={box}
        onWheel={(e) => {
          // vertical wheel scrolls the strip sideways
          if (box.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) box.current.scrollLeft += e.deltaY;
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollWidth - el.scrollLeft - el.clientWidth < 60);
        }}
        className="thin-scroll flex min-h-0 flex-1 items-stretch gap-1.5 overflow-x-auto px-2 py-1.5">
        {shown.length === 0 && <p className="self-center px-2 text-[13px] text-faint">Nothing has happened… yet.</p>}
        {rows.map(({ e, w }, i) => {
          const d = describe(e);
          const ids = agentsInEvent(e);
          const sep = i === 0 || rows[i - 1]!.w.day !== w.day;
          return [
            sep && (
              <div key={`day-${w.day}-${e.id}`} className="pixel flex shrink-0 items-center px-1 text-[13px] text-faint [writing-mode:vertical-rl] rotate-180">
                DAY {w.day}
              </div>
            ),
            <button
              key={e.id}
              type="button"
              onClick={() => ids[0] && store.focus(ids[0])}
              disabled={!ids.length}
              className="msg-in flex w-[220px] shrink-0 flex-col rounded-md border-2 border-line bg-panel-2/70 px-2 py-1 text-left transition enabled:hover:border-line-hi"
              style={{ borderTopColor: d.tone }}
            >
              <span className="flex items-center gap-1.5 text-[11px]">
                <span style={{ color: d.tone }}>{d.icon}</span>
                <span className="pixel truncate text-[13px] uppercase" style={{ color: d.tone }}>
                  {d.title}
                </span>
                <span className="ml-auto tabular-nums text-faint">{w.clock}</span>
              </span>
              <span className="line-clamp-2 text-[12px] leading-snug text-text">{d.text}</span>
              <span className="mt-auto flex gap-1">
                {ids.slice(0, 4).map((id) => (
                  <span key={id} className="h-1 w-4 rounded" style={{ background: AGENT_COLOR[id] }} title={ROSTER[id].name} />
                ))}
              </span>
            </button>,
          ];
        })}
      </div>
    </section>
  );
}
