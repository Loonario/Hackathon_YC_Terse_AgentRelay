import type { AgentId, AgentStatus } from "@proj/contract";
import type { ReactNode } from "react";

/** Identity color per appliance, used in chat, board and timeline. */
export const AGENT_COLOR: Record<AgentId, string> = {
  toast: "#ff6b57",
  mixer: "#b48cff",
  espresso: "#ffb84d",
  robo: "#4fd8ff",
  fridge: "#8ef0b8",
  vision: "#ffd84d",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  thinking: "Thinking",
  acting: "Acting",
  communicating: "Talking",
  offline: "Offline",
  error: "Error",
};

export function Avatar({ id, size = 40, ring = false }: { id: AgentId; size?: number; ring?: boolean }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-md bg-panel-2"
      style={{ width: size, height: size, boxShadow: ring ? `0 0 0 2px ${AGENT_COLOR[id]}` : undefined }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny pixel sprites, no optimization wanted */}
      <img src={`/game/${id}_neutral.png`} alt="" className="img-pixel h-[86%] w-[86%] object-contain" draggable={false} />
    </span>
  );
}

export function Panel({ title, icon, right, children, className = "" }: { title?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {title && (
        <header className="flex items-center gap-2 border-b-2 border-line px-3 py-2">
          {icon}
          <h2 className="pixel text-[15px] uppercase tracking-wider text-text">{title}</h2>
          <div className="ml-auto">{right}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function formatClock(timeOfDay: number) {
  const h = Math.floor(timeOfDay / 60), m = timeOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Simulated wall time of a tick, for message timestamps. */
export function tickClock(startMinutes: number, startTick: number, tick: number) {
  return formatClock((((startMinutes + tick - startTick) % 1440) + 1440) % 1440);
}

export function Bolt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 16" className={className} aria-hidden fill="currentColor">
      <path d="M7 0 0 9h4l-1 7 7-9H6l1-7Z" />
    </svg>
  );
}
