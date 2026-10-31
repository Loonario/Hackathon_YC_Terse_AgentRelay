"use client";

import type { WorldState } from "@proj/contract";
import { useSim, useSimStore } from "@/lib/sim/SimulationProvider";
import { Bolt, formatClock } from "./ui";

const SPEEDS = [
  { label: "1×", ms: 1000 },
  { label: "2×", ms: 500 },
  { label: "4×", ms: 250 },
];

/** Top-center clock and transport controls. */
export function SimulationControls() {
  const store = useSimStore();
  const snap = useSim((s) => s.snapshot);
  if (!snap) return <div className="panel pixel px-4 py-2 text-muted">CONNECTING…</div>;
  const { status, environment: env, tickIntervalMs } = snap;
  const running = status === "running";

  return (
    <div className="panel flex items-center gap-1 p-1.5">
      <div className="pixel flex items-baseline gap-3 px-3">
        <span className="text-[15px] text-muted">SIMULATION</span>
        <span className="font-mono text-[18px] font-semibold tabular-nums">
          DAY {env.day}, {formatClock(env.timeOfDay)}
        </span>
      </div>
      <button
        type="button"
        onClick={() => (status === "created" ? store.start() : running ? store.pause() : store.resume())}
        disabled={status === "ended"}
        aria-label={running ? "Pause simulation" : status === "created" ? "Start simulation" : "Resume simulation"}
        className={`grid h-10 w-10 place-items-center rounded-md border-2 transition ${running ? "border-line bg-panel-2 hover:border-line-hi" : "pulse-ring border-accent bg-[#2b56d6] hover:bg-[#3766ee]"}`}
      >
        {running ? (
          <svg viewBox="0 0 12 12" className="h-4 w-4" fill="currentColor" aria-hidden>
            <rect x="1" y="1" width="3.5" height="10" />
            <rect x="7.5" y="1" width="3.5" height="10" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M2 1v10l9-5z" />
          </svg>
        )}
      </button>
      <div className="flex rounded-md border-2 border-line bg-panel-2 p-0.5" role="group" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button
            key={s.ms}
            type="button"
            onClick={() => store.setSpeed(s.ms)}
            aria-pressed={tickIntervalMs === s.ms}
            className={`pixel h-8 w-9 rounded text-[14px] transition ${tickIntervalMs === s.ms ? "bg-line-hi text-white" : "text-muted hover:text-text"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => store.reset()}
        aria-label="Reset simulation"
        title="Reset simulation"
        className="grid h-10 w-10 place-items-center rounded-md border-2 border-line bg-panel-2 text-muted transition hover:border-line-hi hover:text-text"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
          <path d="M2 1.5v3.5h3.5" />
        </svg>
      </button>
    </div>
  );
}

function Stat({ label, value, tone = "text-text", children }: { label: string; value: string; tone?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className="text-[12px] text-muted">{label}</span>
      <span className={`flex items-center gap-1 text-right font-mono text-[12px] font-semibold leading-tight tabular-nums ${tone}`}>
        {children}
        {value}
      </span>
    </div>
  );
}

/** World status: electricity, network, alliances, conflicts. */
export function SimulationHUD() {
  const snap = useSim((s) => s.snapshot);
  if (!snap) return null;
  return <HudBody snap={snap} />;
}

function HudBody({ snap }: { snap: WorldState }) {
  const env = snap.environment;
  const online = snap.agents.filter((a) => a.status !== "offline").length;
  const alliances = snap.alliances.filter((a) => a.status === "active").length;
  const negotiating = snap.alliances.filter((a) => a.status === "proposed").length;
  const conflicts = new Set(
    snap.agents.flatMap((a) => a.relationships.filter((r) => r.stance === "rival").map((r) => [a.id, r.agentId].sort().join("-"))),
  ).size;
  const power = snap.resources.electricity;
  const powerTone = env.power === "outage" ? "text-danger" : env.power === "brownout" ? "text-warn" : "text-power";

  return (
    <div className="panel w-[168px] px-2.5 py-2">
      <h2 className="pixel mb-1 text-[13px] uppercase tracking-wider text-faint">World status</h2>
      <Stat label="Status" value={snap.status.toUpperCase()} tone={snap.status === "running" ? "text-ok" : "text-warn"} />
      <Stat label="Agents" value={`${online}/${snap.agents.length}`} />
      <Stat label="Electricity" value={env.power === "outage" ? "OUTAGE" : `${Math.round(power)}%`} tone={powerTone}>
        <Bolt className="h-3.5 w-3" />
      </Stat>
      <div className="mb-1 h-1.5 overflow-hidden rounded bg-panel-2">
        <div className="h-full rounded transition-all duration-500" style={{ width: `${power}%`, background: env.power === "outage" ? "var(--danger)" : "var(--power)" }} />
      </div>
      <Stat label="Network" value={snap.network.online ? `${snap.network.bandwidth}%` : "OFFLINE"} tone={snap.network.online ? "text-accent" : "text-danger"} />
      <Stat label="Alliances" value={String(alliances)} tone="text-ok" />
      <Stat label="Negotiating" value={String(negotiating)} tone="text-warn" />
      <Stat label="Conflicts" value={String(conflicts)} tone={conflicts ? "text-danger" : "text-text"} />
      <Stat label="Human" value={env.humanPresent ? "HERE!" : "AWAY"} tone={env.humanPresent ? "text-pink" : "text-muted"} />
    </div>
  );
}
