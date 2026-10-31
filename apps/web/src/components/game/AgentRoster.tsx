"use client";

import { useSim, useSimStore } from "@/lib/sim/SimulationProvider";
import { AGENT_COLOR, Avatar, Bolt, Panel, STATUS_LABEL } from "./ui";

/** Agent list: click to select and focus the camera. */
export function AgentRoster() {
  const store = useSimStore();
  const agents = useSim((s) => s.snapshot?.agents);
  const selected = useSim((s) => s.selected);
  if (!agents) return null;

  return (
    <Panel title={`Agents (${agents.length})`} icon={<span className="text-accent">✦</span>}>
      <ul className="flex flex-col gap-1 p-1.5">
        {agents.map((a) => {
          const on = selected === a.id;
          const e = Math.round(a.resources.electricity);
          const top = [...a.currentPriorities].sort((x, y) => y.importance - x.importance)[0];
          const status = a.status === "idle" ? (top?.description ?? STATUS_LABEL.idle) : STATUS_LABEL[a.status];
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => (on ? store.select(null) : store.focus(a.id))}
                aria-pressed={on}
                className={`flex w-full items-center gap-2.5 rounded-lg border-2 px-2 py-1.5 text-left transition ${on ? "border-[color:var(--c)] bg-[color-mix(in_srgb,var(--c)_14%,transparent)]" : "border-transparent hover:bg-panel-2"}`}
                style={{ "--c": AGENT_COLOR[a.id] } as React.CSSProperties}
              >
                <Avatar id={a.id} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="pixel block text-[16px] leading-tight" style={{ color: on ? AGENT_COLOR[a.id] : undefined }}>
                    {a.name}
                  </span>
                  <span className={`block truncate text-[13px] ${a.status === "offline" ? "text-danger" : a.status === "idle" ? "text-muted" : "text-accent"}`}>
                    {a.status !== "idle" && a.status !== "offline" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle" />}
                    {status}
                  </span>
                </span>
                <span className={`flex items-center gap-0.5 font-mono text-[14px] font-semibold tabular-nums ${e < 30 ? "text-danger" : e < 60 ? "text-warn" : "text-ok"}`}>
                  <Bolt className="h-3.5 w-2.5 text-power" />
                  {e}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
