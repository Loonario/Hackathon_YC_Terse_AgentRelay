import { HOUSE, isCounter, isWalkable, type RoomId } from "@proj/contract";

// Display-only routing: the backend decides where an agent goes, the frontend
// only picks a believable route there (around the island, not through it).

type T = { x: number; y: number };

const DIRS: T[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

/** Floor tiles only: furniture and raised counters are off-limits mid-route. */
function open(room: RoomId, x: number, y: number) {
  const p = { room, x, y };
  return isWalkable(p) && !isCounter(p);
}

/**
 * Tile route from `from` to `to` (both included). Moves onto or off a raised
 * surface are a direct hop. Falls back to a straight line when no route exists.
 */
export function findPath(room: RoomId, from: T, to: T): T[] {
  const direct = [from, to];
  if (!open(room, from.x, from.y) || !open(room, to.x, to.y)) return direct;
  const { width: W, height: H } = HOUSE[room];
  const key = (x: number, y: number) => y * W + x;
  const g = new Map<number, number>([[key(from.x, from.y), 0]]);
  const prev = new Map<number, number>();
  const heur = (x: number, y: number) => Math.hypot(to.x - x, to.y - y);
  const frontier: { k: number; f: number }[] = [{ k: key(from.x, from.y), f: heur(from.x, from.y) }];
  const goal = key(to.x, to.y);

  while (frontier.length) {
    frontier.sort((a, b) => a.f - b.f);
    const { k } = frontier.shift()!;
    if (k === goal) break;
    const x = k % W, y = Math.floor(k / W);
    for (const d of DIRS) {
      const nx = x + d.x, ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !open(room, nx, ny)) continue;
      // no squeezing diagonally past a corner of furniture
      if (d.x && d.y && (!open(room, x + d.x, y) || !open(room, x, y + d.y))) continue;
      const cost = g.get(k)! + (d.x && d.y ? Math.SQRT2 : 1);
      const nk = key(nx, ny);
      if (cost < (g.get(nk) ?? Infinity)) {
        g.set(nk, cost);
        prev.set(nk, k);
        frontier.push({ k: nk, f: cost + heur(nx, ny) });
      }
    }
  }
  if (!g.has(goal)) return direct;

  const path: T[] = [];
  for (let k: number | undefined = goal; k !== undefined; k = prev.get(k)) path.unshift({ x: k % W, y: Math.floor(k / W) });
  // keep only the corners
  return path.filter((p, i) => {
    if (i === 0 || i === path.length - 1) return true;
    const a = path[i - 1]!, b = path[i + 1]!;
    return p.x - a.x !== b.x - p.x || p.y - a.y !== b.y - p.y;
  });
}
