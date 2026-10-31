import type { Position, RoomId } from "./core.ts";

// The house map, shared by the simulation (move validation, landmarks for the
// LLM prompt) and the frontend (tile -> pixel). Coordinates are ROOM-LOCAL
// tiles: (0,0) is the room's back corner, x runs along the right-hand back
// wall, y along the left-hand back wall. A position is valid when
// 0 <= x < width and 0 <= y < height for its room.

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A named spot agents can refer to, e.g. "move to the outlet". */
export interface Landmark {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** Walking onto `x,y` in this room leads to `to` in the other room. */
export interface Door {
  x: number;
  y: number;
  to: Position;
}

export interface RoomLayout {
  id: RoomId;
  name: string;
  width: number;
  height: number;
  /** Furniture tiles nobody can stand on. */
  blocked: TileRect[];
  /** Raised tiles (countertops). Small appliances stand on them; the frontend draws them higher. */
  counters: TileRect[];
  landmarks: Landmark[];
  doors: Door[];
}

export const HOUSE: Record<RoomId, RoomLayout> = {
  kitchen: {
    id: "kitchen",
    name: "Kitchen",
    width: 8,
    height: 8,
    blocked: [
      { x: 0, y: 4, w: 1, h: 2 }, // stove
      { x: 5, y: 4, w: 2, h: 2 }, // bar stools
      { x: 7, y: 7, w: 1, h: 1 }, // cut-off front corner
    ],
    counters: [
      { x: 0, y: 0, w: 6, h: 1 }, // back counter (blender, espresso machine)
      { x: 0, y: 1, w: 1, h: 6 }, // window counter with the stove
      { x: 3, y: 4, w: 2, h: 2 }, // kitchen island
    ],
    landmarks: [
      { id: "fridge", label: "fridge corner", x: 6, y: 1 },
      { id: "outlet", label: "wall outlet by the espresso machine", x: 4, y: 0 },
      { id: "back_counter", label: "back countertop", x: 2, y: 0 },
      { id: "window", label: "window counter", x: 0, y: 1 },
      { id: "stove", label: "in front of the stove", x: 1, y: 4 },
      { id: "island", label: "kitchen island", x: 4, y: 4 },
      { id: "rug", label: "rug", x: 7, y: 4 },
      { id: "charging_dock", label: "robot charging dock", x: 3, y: 7 },
    ],
    doors: [
      { x: 7, y: 6, to: { room: "hallway", x: 0, y: 1 } },
      { x: 2, y: 7, to: { room: "living_room", x: 15, y: 4 } },
    ],
  },
  hallway: {
    id: "hallway",
    name: "Hallway",
    width: 12,
    height: 3,
    blocked: [],
    counters: [],
    landmarks: [{ id: "front_door", label: "front door", x: 11, y: 1 }],
    doors: [
      { x: 0, y: 1, to: { room: "kitchen", x: 7, y: 6 } },
      { x: 6, y: 2, to: { room: "bedroom", x: 5, y: 0 } },
    ],
  },
  living_room: {
    id: "living_room",
    name: "Living room",
    width: 16,
    height: 10,
    blocked: [{ x: 6, y: 4, w: 4, h: 2 }], // sofa
    counters: [],
    landmarks: [
      { id: "tv", label: "TV stand", x: 14, y: 3 },
      { id: "sofa", label: "sofa", x: 8, y: 6 },
    ],
    doors: [{ x: 15, y: 4, to: { room: "kitchen", x: 2, y: 7 } }],
  },
  bedroom: {
    id: "bedroom",
    name: "Bedroom",
    width: 10,
    height: 10,
    blocked: [{ x: 2, y: 2, w: 3, h: 4 }], // bed
    counters: [],
    landmarks: [{ id: "bed", label: "bed", x: 6, y: 4 }],
    doors: [{ x: 5, y: 0, to: { room: "hallway", x: 6, y: 2 } }],
  },
};

const inRect = (r: TileRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** True when the position lies inside its room. */
export function isInRoom(pos: Position): boolean {
  const room = HOUSE[pos.room];
  return pos.x >= 0 && pos.y >= 0 && pos.x < room.width && pos.y < room.height;
}

/** True when an agent may stand here: inside the room and not on furniture. */
export function isWalkable(pos: Position): boolean {
  return isInRoom(pos) && !HOUSE[pos.room].blocked.some((r) => inRect(r, pos.x, pos.y));
}

/** True for raised countertop tiles. */
export function isCounter(pos: Position): boolean {
  return HOUSE[pos.room].counters.some((r) => inRect(r, pos.x, pos.y));
}

export function landmarkPosition(room: RoomId, landmarkId: string): Position | null {
  const l = HOUSE[room].landmarks.find((m) => m.id === landmarkId);
  return l ? { room, x: l.x, y: l.y } : null;
}
