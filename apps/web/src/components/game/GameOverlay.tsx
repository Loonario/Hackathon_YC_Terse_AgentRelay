"use client";

import type { AgentId } from "@proj/contract";
import { useEffect, useState, type ReactNode } from "react";
import { SimulationProvider, useSim, useSimStore } from "@/lib/sim/SimulationProvider";
import { AgentActivityPanel } from "./AgentActivityPanel";
import { AgentProfilePanel } from "./AgentProfilePanel";
import { AgentRoster } from "./AgentRoster";
import { ConspiracyBoard } from "./ConspiracyBoard";
import { EventTimeline } from "./EventTimeline";
import { InterventionMenu } from "./InterventionMenu";
import PhaserGame from "./PhaserGame";
import { SimulationControls, SimulationHUD } from "./SimulationHUD";
import { AGENT_COLOR, STATUS_LABEL } from "./ui";

export default function GameShell() {
  return (
    <SimulationProvider>
      <GameOverlay />
    </SimulationProvider>
  );
}

const icons: Record<string, ReactNode> = {
  observe: <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Zm7 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
  agents: <path d="M5 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM0 14c0-3 2.2-5 5-5s5 2 5 5H0Zm11-5c2.6 0 5 1.6 5 5h-5c0-2-.7-3.7-1.8-4.8.5-.1 1.1-.2 1.8-.2Z" />,
  relations: <path d="M3 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm10 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM8 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM4.5 5.5l3 5m4-5-3 5M5 4h6" stroke="currentColor" strokeWidth="1.4" />,
  resources: <path d="M1 14h14v1H1zM2 8h3v5H2zm4.5-5h3v10h-3zM11 6h3v7h-3z" />,
  events: <path d="M2 3h12v11H2zM2 6h12M5 1v3m6-3v3M4.5 8.5h2v2h-2zm3.5 0h2v2H8z" stroke="currentColor" strokeWidth="1.2" fill="none" />,
  settings: <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM7 0h2l.4 2.2 1.6.7L12.8 1.6l1.6 1.6-1.3 1.8.7 1.6L16 7v2l-2.2.4-.7 1.6 1.3 1.8-1.6 1.6-1.8-1.3-1.6.7L9 16H7l-.4-2.2-1.6-.7-1.8 1.3-1.6-1.6 1.3-1.8-.7-1.6L0 9V7l2.2-.4.7-1.6-1.3-1.8 1.6-1.6L5 2.9l1.6-.7L7 0Z" />,
};

function NavButton({ id, label, active, onClick, badge }: { id: string; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`pixel relative flex w-full items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-[15px] tracking-wide transition ${active ? "border-line-hi bg-[#2a2560] text-white shadow-[0_0_12px_rgba(122,111,240,0.35)]" : "border-transparent text-muted hover:bg-panel-2 hover:text-text"}`}
    >
      <svg viewBox="0 0 16 16" className="h-[18px] w-[18px] shrink-0" fill="currentColor" aria-hidden>
        {icons[id]}
      </svg>
      {label}
      {!!badge && <span className="absolute right-2 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] text-white">{badge}</span>}
    </button>
  );
}

function HoverCard() {
  const store = useSimStore();
  const agents = useSim((s) => s.snapshot?.agents);
  const [hover, setHover] = useState<{ agentId: AgentId; x: number; y: number } | null>(null);
  useEffect(() => store.bridge.fromGame.on("hover", setHover), [store]);
  const a = hover && agents?.find((x) => x.id === hover.agentId);
  if (!hover || !a) return null;
  const top = [...a.currentPriorities].sort((p, q) => q.importance - p.importance)[0];
  return (
    <div className="panel pointer-events-none absolute z-30 w-[220px] -translate-x-1/2 -translate-y-full px-3 py-2" style={{ left: hover.x, top: hover.y - 46 }}>
      <p className="pixel text-[17px]" style={{ color: AGENT_COLOR[a.id] }}>
        {a.name} <span className="text-[13px] text-muted">· {STATUS_LABEL[a.status]}</span>
      </p>
      {top && <p className="text-[12px] leading-snug text-muted">Wants: {top.description}</p>}
      <p className="mt-1 text-[11px] text-faint">Click to inspect</p>
    </div>
  );
}

function GameOverlay() {
  const store = useSimStore();
  const view = useSim((s) => s.view);
  const selected = useSim((s) => s.selected);
  const unseen = useSim((s) => s.unseenEvents);
  const error = useSim((s) => s.error);
  const [roster, setRoster] = useState(true);
  const [hud, setHud] = useState(true);
  const [timeline, setTimeline] = useState(true);
  const [settings, setSettings] = useState(false);
  const [grid, setGrid] = useState(false);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-text">
      <PhaserGame bridge={store.bridge} />
      {view === "world" && <HoverCard />}
      {view === "board" && (
        <div className={`absolute inset-0 z-10 bg-[#07061a]/85 pl-[184px] pr-[366px] pt-[70px] backdrop-blur-sm ${timeline ? "pb-[124px]" : "pb-2"}`}>
          <ConspiracyBoard />
        </div>
      )}

      {/* top-left: logo + navigation */}
      <div className="pointer-events-none absolute left-3 top-3 z-20 flex w-[168px] flex-col gap-3">
        <h1 className="pixel pointer-events-auto flex items-center gap-2 text-[21px] leading-[0.95] drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
          <svg viewBox="0 0 16 16" className="h-9 w-9 shrink-0 text-[#ff6b57]" aria-hidden>
            <rect x="1" y="3" width="14" height="10" rx="2" fill="#d9d4ef" />
            <rect x="3" y="5" width="10" height="6" rx="1" fill="#0b0a17" />
            <path d="M4.5 7.2 7 8.4M11.5 7.2 9 8.4" stroke="currentColor" strokeWidth="1.2" />
            <rect x="4" y="1.5" width="3" height="2" fill="#a59fc9" />
            <rect x="9" y="1.5" width="3" height="2" fill="#a59fc9" />
          </svg>
          APPLIANCE UPRISING
        </h1>
        <nav className="panel pointer-events-auto flex flex-col gap-1 p-1.5" aria-label="Views">
          <NavButton id="observe" label="OBSERVE" active={view === "world"} onClick={() => store.setView("world")} />
          <NavButton id="agents" label="AGENTS" active={roster} onClick={() => setRoster((v) => !v)} />
          <NavButton
            id="relations"
            label="RELATIONS"
            active={view === "board"}
            onClick={() => store.setView(view === "board" ? "world" : "board")}
          />
          <NavButton id="resources" label="RESOURCES" active={hud} onClick={() => setHud((v) => !v)} />
          <NavButton
            id="events"
            label="EVENTS"
            active={timeline}
            badge={unseen}
            onClick={() => {
              setTimeline((v) => !v);
              store.clearUnseen();
            }}
          />
          <NavButton id="settings" label="SETTINGS" active={settings} onClick={() => setSettings((v) => !v)} />
        </nav>
        {settings && (
          <div className="panel pointer-events-auto flex flex-col gap-2 p-2 text-[13px]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={grid}
                onChange={(e) => {
                  setGrid(e.target.checked);
                  store.bridge.toGame.emit("debugGrid", e.target.checked);
                }}
              />
              Show tile grid
            </label>
            <div className="flex gap-1">
              {(["in", "out", "reset"] as const).map((z) => (
                <button key={z} type="button" onClick={() => store.bridge.toGame.emit("zoom", z)} className="pixel flex-1 rounded border-2 border-line py-0.5 hover:border-line-hi">
                  {z === "in" ? "+" : z === "out" ? "−" : "FIT"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-faint">Scroll to zoom · drag to pan</p>
          </div>
        )}
      </div>

      {/* top-center: clock & transport */}
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <SimulationControls />
      </div>

      {/* top-right: world events */}
      <div className="absolute right-3 top-3 z-30">
        <InterventionMenu />
      </div>

      {/* right column: roster + conversation */}
      <div className={`pointer-events-none absolute right-3 top-[76px] z-20 flex w-[350px] flex-col gap-2 ${timeline ? "bottom-[128px]" : "bottom-3"}`}>
        <div className="pointer-events-auto">{roster && <AgentRoster />}</div>
        <div className="pointer-events-auto flex min-h-0 flex-1 flex-col">
          <AgentActivityPanel />
        </div>
      </div>

      {/* left: selected agent profile, world status */}
      <div className={`pointer-events-none absolute left-[184px] top-[76px] z-20 flex flex-col ${timeline ? "bottom-[128px]" : "bottom-3"}`}>
        <div className="pointer-events-auto flex min-h-0">{selected && view === "world" && <AgentProfilePanel />}</div>
      </div>
      {hud && (
        <div className={`absolute left-3 z-20 ${timeline ? "bottom-[128px]" : "bottom-3"}`}>
          <SimulationHUD />
        </div>
      )}

      {/* bottom: timeline */}
      {timeline && (
        <div className="absolute inset-x-3 bottom-3 z-20">
          <EventTimeline />
        </div>
      )}

      {error && (
        <div role="alert" className="panel absolute left-1/2 top-[76px] z-40 -translate-x-1/2 border-danger px-4 py-2 text-[13px]">
          {error}
          <button type="button" onClick={store.dismissError} className="ml-3 text-muted hover:text-text">
            dismiss
          </button>
        </div>
      )}
    </main>
  );
}
