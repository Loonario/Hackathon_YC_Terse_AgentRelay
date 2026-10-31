import type { AgentId, SimulationEvent, WorldState } from "@proj/contract";

// Typed channel between React (UI) and Phaser (world). React pushes world
// state and events in; the scene reports clicks and hovers back.

export interface ToGame {
  snapshot: WorldState;
  event: { event: SimulationEvent; state: WorldState };
  select: AgentId | null;
  focus: AgentId | null;
  debugGrid: boolean;
  zoom: "in" | "out" | "reset";
}

export interface FromGame {
  ready: void;
  select: AgentId | null;
  hover: { agentId: AgentId; x: number; y: number } | null;
}

type Handler<T> = (payload: T) => void;

class Channel<M> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();
  on<K extends keyof M>(type: K, fn: Handler<M[K]>) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn as Handler<never>);
    return () => void this.handlers.get(type)?.delete(fn as Handler<never>);
  }
  emit<K extends keyof M>(type: K, payload: M[K]) {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<M[K]>)(payload));
  }
  clear() {
    this.handlers.clear();
  }
}

export class GameBridge {
  readonly toGame = new Channel<ToGame>();
  readonly fromGame = new Channel<FromGame>();
  /** Latest snapshot, so a scene that boots late can catch up. */
  lastSnapshot: WorldState | null = null;
}
