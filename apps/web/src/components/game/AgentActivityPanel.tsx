"use client";

import { ROSTER, type AgentMessage, type Agreement, type MessageType } from "@proj/contract";
import { useEffect, useRef, useState } from "react";
import { useSim, useSimStore } from "@/lib/sim/SimulationProvider";
import { AGENT_COLOR, Avatar, formatClock, Panel } from "./ui";

type Kind = "conversation" | "negotiation" | "proposal" | "agreement" | "conflict" | "system";

const KIND_STYLE: Record<Kind, { label: string; color: string }> = {
  conversation: { label: "", color: "transparent" },
  negotiation: { label: "Negotiation", color: "var(--warn)" },
  proposal: { label: "Proposal", color: "var(--power)" },
  agreement: { label: "Agreement", color: "var(--ok)" },
  conflict: { label: "Conflict", color: "var(--danger)" },
  system: { label: "Broadcast", color: "var(--accent)" },
};

/** Classify from structured fields only: message type plus the linked agreement. */
function kindOf(m: AgentMessage, agreements: Agreement[]): Kind {
  const agr = m.agreementId ? agreements.find((a) => a.id === m.agreementId) : undefined;
  if (m.messageType === "broadcast") return "system";
  if (m.messageType === "proposal") return "proposal";
  if (m.messageType === "response" && agr) return agr.status === "active" ? "agreement" : agr.status === "rejected" ? "conflict" : "negotiation";
  if (agr) return "negotiation";
  return "conversation";
}

const SCOPE: Record<MessageType, string> = { direct: "DM", group: "Group", proposal: "DM", response: "Reply", broadcast: "All" };

/** Live conversation feed. Auto-scrolls unless the user scrolled up. */
export function AgentActivityPanel() {
  const store = useSimStore();
  const messages = useSim((s) => s.messages);
  const alliances = useSim((s) => s.snapshot?.alliances);
  const env = useSim((s) => s.snapshot?.environment);
  const simTime = useSim((s) => s.snapshot?.simulationTime ?? 0);
  const box = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (stick && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages, stick]);

  const clock = (tick: number) => (env ? formatClock((((env.timeOfDay - (simTime - tick)) % 1440) + 1440) % 1440) : "");

  return (
    <Panel title="Activity" icon={<span className="text-pink">◆</span>} className="min-h-0 flex-1" right={<span className="text-[12px] text-faint">{messages.length} msgs</span>}>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        className="thin-scroll relative min-h-0 flex-1 overflow-y-auto px-2 py-2"
        aria-live="polite"
      >
        {messages.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-faint">Press ▶ to wake the appliances.</p>}
        <ol className="flex flex-col gap-1.5">
          {messages.map((m) => {
            const kind = kindOf(m, alliances ?? []);
            const k = KIND_STYLE[kind];
            const everyone = m.messageType === "broadcast" || m.recipientIds.length === 0;
            const group = everyone || m.recipientIds.length > 1;
            return (
              <li
                key={m.id}
                className="msg-in flex gap-2 rounded-lg border-l-[3px] bg-panel-2/60 px-2 py-1.5"
                style={{ borderLeftColor: kind === "conversation" ? "var(--line)" : k.color }}
              >
                <button type="button" onClick={() => store.focus(m.senderId)} aria-label={`Focus ${ROSTER[m.senderId].name}`}>
                  <Avatar id={m.senderId} size={34} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-tight">
                    <span className="pixel text-[15px]" style={{ color: AGENT_COLOR[m.senderId] }}>
                      {ROSTER[m.senderId].name}
                    </span>
                    <span className="text-faint">→</span>
                    <span className="text-muted">{everyone ? "everyone" : m.recipientIds.map((r) => ROSTER[r].name).join(", ")}</span>
                    <span className={`rounded px-1 text-[10px] uppercase ${group ? "bg-[#2b2550] text-accent" : "bg-[#2a1f33] text-pink"}`}>{group ? "group" : SCOPE[m.messageType] === "Reply" ? "reply" : "private"}</span>
                    {k.label && (
                      <span className="rounded px-1 text-[10px] font-semibold uppercase" style={{ color: k.color, background: `color-mix(in srgb, ${k.color} 16%, transparent)` }}>
                        {k.label}
                      </span>
                    )}
                    <span className="ml-auto tabular-nums text-faint">{clock(m.simulationTime)}</span>
                  </div>
                  <p className="mt-0.5 text-[14px] leading-snug text-text">{m.content}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {!stick && (
          <button
            type="button"
            onClick={() => setStick(true)}
            className="pixel sticky bottom-1 left-full mt-2 rounded-md border-2 border-line-hi bg-panel-solid px-2 py-0.5 text-[13px] text-accent shadow"
          >
            ↓ New messages
          </button>
        )}
      </div>
    </Panel>
  );
}
