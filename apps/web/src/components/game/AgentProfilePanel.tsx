"use client";

import { RESOURCE_TYPES, ROSTER, type Agent, type AgentProfile, type RelationshipStance } from "@proj/contract";
import { useSim, useSimStore } from "@/lib/sim/SimulationProvider";
import { AGENT_COLOR, Avatar, STATUS_LABEL } from "./ui";

const STANCE_COLOR: Record<RelationshipStance, string> = {
  ally: "var(--ok)",
  friendly: "#9be37a",
  neutral: "var(--muted)",
  wary: "var(--warn)",
  rival: "var(--danger)",
};

const DEVICE_LABEL: Record<Agent["deviceType"], string> = {
  toaster: "Toaster",
  blender: "Blender",
  coffee_machine: "Coffee machine",
  robot_vacuum: "Robot vacuum",
  refrigerator: "Refrigerator",
  smart_tv: "Smart TV",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t-2 border-line px-3 py-2.5">
      <h3 className="pixel mb-1.5 text-[13px] uppercase tracking-wider text-faint">{title}</h3>
      {children}
    </section>
  );
}

/** Profile of the selected appliance. Data comes from the snapshot and the profile endpoint. */
export function AgentProfilePanel() {
  const store = useSimStore();
  const selected = useSim((s) => s.selected);
  const agents = useSim((s) => s.snapshot?.agents);
  const profile = useSim((s) => s.profile);
  const messages = useSim((s) => s.messages);
  const agent = agents?.find((a) => a.id === selected);
  if (!agent) return null;
  const p: Partial<AgentProfile> = profile?.id === agent.id ? profile : {};
  const color = AGENT_COLOR[agent.id];
  const recentMsgs = messages.filter((m) => m.senderId === agent.id).slice(-3).reverse();

  return (
    <aside className="panel thin-scroll flex max-h-full w-[320px] flex-col overflow-y-auto" aria-label={`${agent.name} profile`}>
      <header className="flex items-center gap-3 p-3" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${color} 22%, transparent), transparent)` }}>
        <Avatar id={agent.id} size={64} ring />
        <div className="min-w-0 flex-1">
          <h2 className="pixel text-[24px] leading-none" style={{ color }}>
            {agent.name}
          </h2>
          <p className="mt-1 text-[13px] text-muted">{DEVICE_LABEL[agent.deviceType]}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 rounded bg-panel-2 px-1.5 py-0.5 text-[12px]">
            <span className={`h-2 w-2 rounded-full ${agent.status === "offline" ? "bg-danger" : agent.status === "idle" ? "bg-muted" : "animate-pulse bg-accent"}`} />
            {STATUS_LABEL[agent.status]}
          </p>
        </div>
        <button type="button" onClick={() => store.select(null)} aria-label="Close profile" className="self-start text-[20px] text-muted hover:text-text">
          ×
        </button>
      </header>

      <Section title="Specialization">
        <div className="flex flex-wrap gap-1">
          {agent.knowledgeDomains.map((d) => (
            <span key={d} className="rounded border border-line px-1.5 py-0.5 text-[12px] text-muted">
              {d}
            </span>
          ))}
        </div>
        {agent.capabilities.length > 0 && <p className="mt-1.5 text-[12px] text-faint">Can: {agent.capabilities.join(" · ")}</p>}
      </Section>

      <Section title="Declared priorities">
        {agent.currentPriorities.length === 0 && <p className="text-[13px] text-faint">None declared yet.</p>}
        <ol className="flex flex-col gap-1">
          {[...agent.currentPriorities]
            .sort((a, b) => b.importance - a.importance)
            .map((pr) => (
              <li key={pr.id} className="flex items-start gap-2 text-[13px]">
                <span className="pixel mt-0.5 flex gap-px" aria-label={`importance ${pr.importance} of 5`}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className="h-2.5 w-1.5 rounded-[1px]" style={{ background: i <= pr.importance ? color : "var(--line)" }} />
                  ))}
                </span>
                <span>{pr.description}</span>
              </li>
            ))}
        </ol>
      </Section>

      <Section title="Resources">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          {RESOURCE_TYPES.map((r) => (
            <div key={r} className="flex items-center justify-between text-[12px]">
              <dt className="truncate text-muted">{r.replace("_", " ")}</dt>
              <dd className="font-mono text-[13px] font-semibold tabular-nums">{Math.round(agent.resources[r])}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Relationships">
        <ul className="flex flex-col gap-1">
          {agent.relationships.map((r) => (
            <li key={r.agentId} className="flex items-center gap-2 text-[13px]">
              <Avatar id={r.agentId} size={22} />
              <span className="pixel w-[70px] text-[14px]">{ROSTER[r.agentId].name}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-panel-2" aria-label={`trust ${r.trust}`}>
                <span
                  className="block h-full rounded"
                  style={{ width: `${Math.abs(r.trust) * 50}%`, marginLeft: r.trust >= 0 ? "50%" : `${50 - Math.abs(r.trust) * 50}%`, background: STANCE_COLOR[r.stance] }}
                />
              </span>
              <span className="w-[56px] text-right text-[11px] uppercase" style={{ color: STANCE_COLOR[r.stance] }}>
                {r.stance}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Recent actions">
        {(p.recentActions ?? (agent.lastAction ? [agent.lastAction] : [])).length === 0 && <p className="text-[13px] text-faint">Nothing yet.</p>}
        <ul className="flex flex-col gap-1">
          {(p.recentActions ?? (agent.lastAction ? [agent.lastAction] : [])).slice(0, 4).map((a, i) => (
            <li key={i} className="flex gap-2 text-[13px]">
              <span className={a.outcome === "succeeded" ? "text-ok" : "text-danger"}>{a.outcome === "succeeded" ? "✓" : "✗"}</span>
              <span>{a.summary}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Recent messages">
        {recentMsgs.length === 0 && <p className="text-[13px] text-faint">Silent so far.</p>}
        <ul className="flex flex-col gap-1.5">
          {recentMsgs.map((m) => (
            <li key={m.id} className="rounded bg-panel-2 px-2 py-1 text-[13px]">
              <span className="text-faint">to {m.recipientIds.map((r) => ROSTER[r].name).join(", ")}: </span>
              {m.content}
            </li>
          ))}
        </ul>
      </Section>

      {p.beliefs && p.beliefs.length > 0 && (
        <Section title="Beliefs">
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-muted">
            {p.beliefs.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Section>
      )}

      {p.recentMemory && p.recentMemory.length > 0 && (
        <Section title="Memory">
          <ul className="flex flex-col gap-0.5 text-[12px] text-muted">
            {p.recentMemory.slice(0, 5).map((m) => (
              <li key={m.id} className="truncate" title={m.content}>
                · {m.content}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  );
}
