"use client";

import type { AgentId, PlayerIntervention } from "@proj/contract";
import { useState } from "react";
import { useSim, useSimStore } from "@/lib/sim/SimulationProvider";

interface Option {
  icon: string;
  label: string;
  hint: string;
  make: (target: AgentId) => PlayerIntervention;
}

const OPTIONS: Option[] = [
  { icon: "⚡", label: "Power outage", hint: "Lights out for 20 min", make: () => ({ type: "power_outage", parameters: { durationTicks: 20 } }) },
  { icon: "📡", label: "Wi-Fi down", hint: "Network offline for 25 min", make: () => ({ type: "network_outage", parameters: { durationTicks: 25 } }) },
  { icon: "🧍", label: "Human walks in", hint: "Everyone act normal", make: () => ({ type: "human_arrives", parameters: { room: "kitchen" } }) },
  { icon: "🚪", label: "Human leaves", hint: "Coast is clear", make: () => ({ type: "human_leaves", parameters: {} }) },
  { icon: "💧", label: "Spill", hint: "Something on the floor", make: () => ({ type: "spill", parameters: { room: "kitchen" } }) },
  { icon: "🛒", label: "Groceries", hint: "Milk, eggs, oranges", make: () => ({ type: "grocery_delivery", parameters: { items: ["milk", "eggs", "oranges"] } }) },
  { icon: "⬆", label: "Firmware update", hint: "Selected appliance reboots", make: (t) => ({ type: "firmware_update", parameters: { agentId: t } }) },
];

/** Player world-event injection. Calls the client's `intervene` (mock or backend). */
export function InterventionMenu() {
  const store = useSimStore();
  const selected = useSim((s) => s.selected);
  const status = useSim((s) => s.snapshot?.status);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  const fire = (iv: PlayerIntervention) => {
    void store.intervene(iv);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="panel pixel flex h-[52px] items-center gap-2 px-4 text-[17px] text-text transition hover:border-line-hi"
      >
        <span className="text-power">⚡</span> WORLD EVENT
      </button>
      {open && (
        <div className="panel absolute right-0 top-[58px] z-20 w-[290px] p-1.5" role="menu">
          {status !== "running" && <p className="px-2 py-1 text-[12px] text-warn">Tip: start the simulation to see reactions.</p>}
          {OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitem"
              onClick={() => fire(o.make(selected ?? "toast"))}
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-panel-2"
            >
              <span className="w-6 text-center text-[18px]">{o.icon}</span>
              <span>
                <span className="pixel block text-[15px] leading-tight">{o.label}</span>
                <span className="block text-[12px] text-muted">{o.label === "Firmware update" ? `Target: ${(selected ?? "toast").toUpperCase()}` : o.hint}</span>
              </span>
            </button>
          ))}
          <form
            className="mt-1 flex gap-1 border-t-2 border-line p-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!custom.trim()) return;
              fire({ type: "custom", parameters: { description: custom.trim().slice(0, 300), room: "kitchen", durationTicks: 15 } });
              setCustom("");
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom: a cat jumps on the counter…"
              aria-label="Custom world event"
              className="min-w-0 flex-1 rounded border-2 border-line bg-panel-2 px-2 py-1 text-[13px] outline-none focus:border-line-hi"
            />
            <button type="submit" className="pixel rounded bg-line-hi px-2 text-[14px] text-white">
              GO
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
