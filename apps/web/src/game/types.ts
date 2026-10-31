import type { AgentId } from "@proj/contract";

/**
 * How a character looks right now. Presentation only: the backend decides the
 * real agent status, the frontend picks the animation (see presentation.ts).
 */
export type PresentationState =
  | "idle"
  | "thinking"
  | "communicating"
  | "moving"
  | "performing_action"
  | "negotiating"
  | "celebrating"
  | "concerned"
  | "offline";

/** Eye expressions drawn on the visor. */
export type Mood = "neutral" | "happy" | "angry" | "thinking" | "worried" | "surprised" | "sleepy" | "love";

export type BubbleKind = "speech" | "proposal" | "agreement" | "conflict" | "thought" | "system";

/** One display instruction for a character, derived from a simulation event. */
export interface CharacterCue {
  agentId: AgentId;
  state?: PresentationState;
  mood?: Mood;
  /** How long a transient state/mood lasts before falling back, in ms. */
  holdMs?: number;
  bubble?: { kind: BubbleKind; text: string };
  /** Look toward another agent (eyes glance). */
  lookAt?: AgentId | null;
}

/** Sprite manifest written by scripts/native-art.ts + scripts/visors.ts. */
export type Quad = [[number, number], [number, number], [number, number], [number, number]];
export interface SpriteInfo {
  /** Native placement of the sprite's top-left corner in kitchen.png pixels (home tile). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Visor panels in sprite pixels, corners TL, TR, BR, BL. */
  visors: Quad[];
}
export type SpriteManifest = Partial<Record<AgentId, SpriteInfo>>;
