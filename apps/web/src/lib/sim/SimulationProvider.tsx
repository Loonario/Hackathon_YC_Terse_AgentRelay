"use client";

import { createContext, use, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { MockSimulationClient } from "@/game/mock/MockSimulationClient";
import { HttpSimulationClient } from "./httpClient";
import { SimulationStore, type SimState } from "./store";

// The real backend (this app's /api/simulations routes) is the default.
// The in-browser mock is opt-in for offline UI work: ?mock=1 or
// NEXT_PUBLIC_SIM_SOURCE=mock.
function makeClient() {
  const urlMock = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");
  return urlMock || process.env.NEXT_PUBLIC_SIM_SOURCE === "mock" ? new MockSimulationClient() : new HttpSimulationClient();
}

const StoreContext = createContext<SimulationStore | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new SimulationStore(makeClient()));
  useEffect(() => {
    // dev-only handle for debugging from the console: window.__simStore
    if (process.env.NODE_ENV !== "production") (window as unknown as { __simStore: SimulationStore }).__simStore = store;
    void store.connect();
    return () => store.disconnect();
  }, [store]);
  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useSimStore() {
  const store = use(StoreContext);
  if (!store) throw new Error("useSimStore must be used inside <SimulationProvider>");
  return store;
}

const serverState = (s: SimulationStore) => s.getState();

/** Subscribe to the store; `select` picks a slice. */
export function useSim<T>(select: (s: SimState) => T): T {
  const store = useSimStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()), () => select(serverState(store)));
}
