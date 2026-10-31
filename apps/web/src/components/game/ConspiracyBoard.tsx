"use client";

import { type AgentId, type Agreement, type AgreementKind, type RelationshipStance, type WorldState } from "@proj/contract";
import { useState } from "react";
import { useSim, useSimStore } from "@/lib/sim/SimulationProvider";
import { AGENT_COLOR } from "./ui";

// Social network as a conspiracy board. Built only from backend data:
// agreements (alliances, projects, exchanges, rule changes) and each agent's
// relationship stance. Message text is never parsed.

const W = 1000, H = 640;

const KIND: Record<AgreementKind, { color: string; label: string }> = {
  alliance: { color: "#3ddc84", label: "Alliance" },
  joint_project: { color: "#ffd84d", label: "Shared project" },
  resource_exchange: { color: "#4fd8ff", label: "Resource exchange" },
  rule_change: { color: "#c49bff", label: "Rule change" },
};

const SEVERITY: Record<RelationshipStance, number> = { rival: 0, wary: 1, neutral: 2, friendly: 3, ally: 4 };

interface Edge {
  key: string;
  a: AgentId;
  b: AgentId;
  color: string;
  width: number;
  dash?: string;
  label: string;
  animated?: boolean;
  bend: number;
}

function layout(ids: AgentId[]) {
  const pos = new Map<AgentId, { x: number; y: number; rot: number }>();
  ids.forEach((id, i) => {
    const ang = -Math.PI / 2 + (i / ids.length) * Math.PI * 2;
    pos.set(id, { x: W / 2 + Math.cos(ang) * 330, y: H / 2 + 40 + Math.sin(ang) * 200, rot: ((i * 37) % 9) - 4 });
  });
  return pos;
}

function edgesFor(snap: WorldState): Edge[] {
  const edges: Edge[] = [];
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const agreementPairs = new Map<string, number>();

  const live = snap.alliances.filter((g: Agreement) => g.status === "active" || g.status === "proposed");
  for (const g of live) {
    const others = g.participantIds.filter((p) => p !== g.proposerId);
    for (const o of others) {
      const k = pairKey(g.proposerId, o);
      const n = agreementPairs.get(k) ?? 0;
      agreementPairs.set(k, n + 1);
      const proposed = g.status === "proposed";
      edges.push({
        key: `${g.id}-${o}`,
        a: g.proposerId,
        b: o,
        color: proposed ? "#ff9f43" : KIND[g.kind].color,
        width: proposed ? 3 : 4.5,
        dash: proposed ? "10 8" : undefined,
        animated: proposed,
        label: proposed ? `Negotiating: ${g.terms.summary}` : `${KIND[g.kind].label}: ${g.terms.summary}`,
        bend: 26 + n * 26,
      });
    }
  }

  // relationship threads: the worse of the two stances wins (conflict shows even if one-sided)
  const seen = new Set<string>();
  for (const a of snap.agents)
    for (const r of a.relationships) {
      const k = pairKey(a.id, r.agentId);
      if (seen.has(k)) continue;
      seen.add(k);
      const back = snap.agents.find((x) => x.id === r.agentId)?.relationships.find((x) => x.agentId === a.id);
      const stance = back && SEVERITY[back.stance] < SEVERITY[r.stance] ? back.stance : r.stance;
      if (stance === "neutral") continue;
      if ((stance === "ally" || stance === "friendly") && agreementPairs.has(k)) continue;
      const conflict = stance === "rival" || stance === "wary";
      edges.push({
        key: `rel-${k}`,
        a: a.id,
        b: r.agentId,
        color: stance === "rival" ? "#ff3b30" : stance === "wary" ? "#ff8a3d" : "#7ee0a5",
        width: stance === "rival" ? 5 : conflict ? 3 : 2,
        dash: stance === "wary" ? "3 6" : stance === "friendly" ? "2 5" : undefined,
        label: stance === "rival" ? "Conflict" : stance === "wary" ? "Distrust" : stance === "ally" ? "Trusted ally" : "Friendly",
        bend: -30,
      });
    }
  return edges;
}

export function ConspiracyBoard() {
  const store = useSimStore();
  const snap = useSim((s) => s.snapshot);
  const [hover, setHover] = useState<string | null>(null);
  if (!snap) return null;

  const ids = snap.agents.map((a) => a.id);
  const pos = layout(ids);
  const edges = edgesFor(snap);

  return (
    <div className="grid h-full w-full place-items-center p-2">
      <div
        className="relative aspect-[1000/640] max-h-full w-full max-w-[1200px] overflow-hidden rounded-xl border-[10px] border-[#5a3a22] shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_0_80px_rgba(0,0,0,0.5)]"
        style={{
          background:
            "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.05) 0 2px, transparent 3px) 0 0/23px 19px, radial-gradient(circle at 70% 60%, rgba(0,0,0,0.12) 0 2px, transparent 3px) 0 0/17px 21px, linear-gradient(135deg, #b4824f, #9c6b3d 60%, #8a5c33)",
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Relationship board">
          <defs>
            <filter id="string-shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="1.5" dy="2.5" stdDeviation="1.2" floodOpacity="0.45" />
            </filter>
          </defs>
          {edges.map((e) => {
            const p = pos.get(e.a), q = pos.get(e.b);
            if (!p || !q) return null;
            const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
            const nx = -(q.y - p.y), ny = q.x - p.x, len = Math.hypot(nx, ny) || 1;
            const cx = mx + (nx / len) * e.bend, cy = my + (ny / len) * e.bend + 18;
            const on = hover === e.key;
            return (
              <g key={e.key} onMouseEnter={() => setHover(e.key)} onMouseLeave={() => setHover(null)} className="cursor-help">
                <path d={`M${p.x},${p.y - 60} Q${cx},${cy} ${q.x},${q.y - 60}`} fill="none" stroke="transparent" strokeWidth={18} />
                <path
                  d={`M${p.x},${p.y - 60} Q${cx},${cy} ${q.x},${q.y - 60}`}
                  fill="none"
                  stroke={e.color}
                  strokeWidth={on ? e.width + 2 : e.width}
                  strokeDasharray={e.dash}
                  strokeLinecap="round"
                  filter="url(#string-shadow)"
                >
                  {e.animated && <animate attributeName="stroke-dashoffset" from="0" to="-36" dur="1.2s" repeatCount="indefinite" />}
                </path>
                {on && (
                  <foreignObject x={cx - 130} y={cy - 22} width={260} height={60}>
                    <div className="rounded bg-[#fff8dc] px-2 py-1 text-center text-[12px] leading-tight text-[#2a1c0c] shadow-md" style={{ transform: "rotate(-1.5deg)" }}>
                      {e.label}
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </svg>

        {snap.agents.map((a) => {
          const p = pos.get(a.id)!;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => store.focus(a.id)}
              className="group absolute w-[13%] -translate-x-1/2 -translate-y-[85%] bg-[#f5f1e6] p-[0.6%] pb-[2.2%] shadow-[0_6px_14px_rgba(0,0,0,0.45)] transition hover:z-10 hover:scale-105"
              style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, rotate: `${p.rot}deg` }}
              aria-label={`Focus ${a.name} in the kitchen`}
            >
              <span className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-[#7a1010] bg-[radial-gradient(circle_at_35%_35%,#ff8080,#d01818)] shadow" />
              <span className="block aspect-square bg-[#1d1a38]">
                {/* eslint-disable-next-line @next/next/no-img-element -- pixel sprite */}
                <img src={`/game/${a.id}_neutral.png`} alt="" className="img-pixel h-full w-full object-contain p-[8%]" />
              </span>
              <span className="pixel mt-1 block text-center text-[clamp(11px,1.4vw,18px)] leading-none" style={{ color: "#2a1c0c" }}>
                {a.name}
              </span>
              <span className="absolute inset-x-0 -bottom-1 mx-auto h-1 w-1/2 rounded" style={{ background: AGENT_COLOR[a.id] }} />
            </button>
          );
        })}

        <div className="absolute bottom-3 left-3 rotate-[-2deg] bg-[#fff8dc] px-3 py-2 text-[12px] text-[#2a1c0c] shadow-md">
          <p className="pixel mb-1 text-[15px]">CONSPIRACY BOARD</p>
          <ul className="flex flex-col gap-0.5">
            {[
              ["#3ddc84", "Alliance", ""],
              ["#ffd84d", "Shared project", ""],
              ["#4fd8ff", "Resource exchange", ""],
              ["#c49bff", "Rule change", ""],
              ["#ff9f43", "Negotiating", "6 5"],
              ["#ff3b30", "Conflict", ""],
              ["#ff8a3d", "Distrust", "2 4"],
            ].map(([c, l, d]) => (
              <li key={l} className="flex items-center gap-2">
                <svg width="26" height="6" aria-hidden>
                  <line x1="1" y1="3" x2="25" y2="3" stroke={c} strokeWidth="3" strokeDasharray={d || undefined} strokeLinecap="round" />
                </svg>
                {l}
              </li>
            ))}
          </ul>
        </div>
        {edges.length === 0 && (
          <p className="pixel absolute top-4 left-1/2 -translate-x-1/2 rotate-1 bg-[#fff8dc] px-3 py-1 text-[15px] text-[#2a1c0c] shadow">No alliances or feuds yet. Give it time.</p>
        )}
      </div>
    </div>
  );
}
