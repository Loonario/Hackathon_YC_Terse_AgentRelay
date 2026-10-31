import { HOUSE, isCounter, type Position, type RoomId } from "@proj/contract";

// Maps contract tile positions (room-local) to pixels of the room art.
// Each rendered room has a floor calibration: the pixel of the back corner
// (tile 0,0) and the screen vector of one tile along x and along y. Raised
// tiles (counters, island) are drawn `counterLift` pixels higher.

export interface RoomCalibration {
  art: string;
  width: number;
  height: number;
  origin: { x: number; y: number };
  ex: { x: number; y: number };
  ey: { x: number; y: number };
  counterLift: number;
}

export const ROOM_ART: Partial<Record<RoomId, RoomCalibration>> = {
  kitchen: {
    art: "/game/kitchen.png",
    width: 1536,
    height: 1024,
    origin: { x: 757, y: 424 },
    ex: { x: 78.75, y: 33.1 },
    ey: { x: -74.4, y: 33.1 },
    counterLift: 95,
  },
};

/** Pixel of a tile's center at floor or counter height. null when the room isn't drawn. */
export function tileToPixel(pos: Position): { x: number; y: number } | null {
  const c = ROOM_ART[pos.room];
  if (!c) return null;
  const tx = pos.x + 0.5, ty = pos.y + 0.5;
  return {
    x: c.origin.x + tx * c.ex.x + ty * c.ey.x,
    y: c.origin.y + tx * c.ex.y + ty * c.ey.y - (isCounter(pos) ? c.counterLift : 0),
  };
}

/** Inverse of the floor mapping: fractional tile under a floor pixel. */
export function pixelToTile(room: RoomId, px: { x: number; y: number }) {
  const c = ROOM_ART[room];
  if (!c) return null;
  const dx = px.x - c.origin.x, dy = px.y - c.origin.y;
  const det = c.ex.x * c.ey.y - c.ey.x * c.ex.y;
  return { x: (dx * c.ey.y - dy * c.ey.x) / det, y: (c.ex.x * dy - c.ex.y * dx) / det };
}

/** Corners of a tile's floor diamond, for the debug grid. */
export function tileCorners(room: RoomId, x: number, y: number) {
  const c = ROOM_ART[room]!;
  const p = (tx: number, ty: number) => ({ x: c.origin.x + tx * c.ex.x + ty * c.ey.x, y: c.origin.y + tx * c.ex.y + ty * c.ey.y });
  return [p(x, y), p(x + 1, y), p(x + 1, y + 1), p(x, y + 1)];
}

export function roomSize(room: RoomId) {
  return { w: HOUSE[room].width, h: HOUSE[room].height };
}
