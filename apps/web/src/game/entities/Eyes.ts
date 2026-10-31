import type * as PhaserNS from "phaser";
import type { Mood, Quad } from "../types";

// LED-matrix eyes drawn into the visor quads of a sprite. Each mood is a small
// glyph (7x6 cells, left eye). The right eye is the mirror image. Cells are
// mapped onto the visor with a bilinear transform so they follow the
// isometric face plane.

const G = (rows: string[]) => rows.map((r) => [...r].map((c) => c === "#"));

const GLYPHS: Record<Mood | "blink", boolean[][]> = {
  neutral: G([".......", "..###..", ".#...#.", "#.....#", ".......", "......."]),
  happy: G([".......", "..###..", ".#####.", "##...##", "#.....#", "......."]),
  angry: G(["##.....", ".###...", "..####.", "..#####", "...###.", "......."]),
  thinking: G(["..###..", ".#..##.", "#...###", "#.....#", ".#...#.", "..###.."]),
  worried: G(["....##.", "..##...", ".......", "..###..", ".#####.", "..###.."]),
  surprised: G(["..###..", ".#...#.", "#.....#", "#..#..#", ".#...#.", "..###.."]),
  sleepy: G([".......", ".......", ".......", "#######", ".......", "......."]),
  love: G([".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."]),
  blink: G([".......", ".......", ".......", ".#####.", ".......", "......."]),
};

const COLORS: Record<Mood, number> = {
  neutral: 0xe8f6ff,
  happy: 0xf4fbff,
  angry: 0xff3b30,
  thinking: 0x9fe7ff,
  worried: 0xbfd9ff,
  surprised: 0xffffff,
  sleepy: 0x56607a,
  love: 0xff5fa2,
};

type V = { x: number; y: number };
/** Phaser 4 types fillPoints as Vector2[], but plain {x,y} objects are all it reads. */
const pts = (ps: V[]) => ps as unknown as PhaserNS.Math.Vector2[];
const lerp = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function bilinear(q: Quad, u: number, v: number): V {
  const [tl, tr, br, bl] = q.map(([x, y]) => ({ x, y }));
  return lerp(lerp(tl!, tr!, u), lerp(bl!, br!, u), v);
}

/** Shrinks a quad toward its center (keeps the bezel visible). */
function inset(q: Quad, k: number): Quad {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  return q.map(([x, y]) => [cx + (x - cx) * (1 - k), cy + (y - cy) * (1 - k)]) as Quad;
}

export class Eyes {
  readonly g: PhaserNS.GameObjects.Graphics;
  private mood: Mood = "neutral";
  private blinking = false;
  private look = 0; // -1 left .. 1 right
  private dim = false;
  private timer?: PhaserNS.Time.TimerEvent;

  constructor(
    private scene: PhaserNS.Scene,
    private visors: Quad[],
  ) {
    this.g = scene.add.graphics();
    this.scheduleBlink();
    this.draw();
  }

  setMood(mood: Mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    this.draw();
  }

  /** -1 = glance left, 1 = glance right, 0 = forward. */
  setLook(dir: number) {
    this.look = Math.max(-1, Math.min(1, dir));
    this.draw();
  }

  setDim(dim: boolean) {
    this.dim = dim;
    this.draw();
  }

  private scheduleBlink() {
    this.timer = this.scene.time.delayedCall(2200 + Math.random() * 3500, () => {
      if (this.mood !== "sleepy" && this.mood !== "love") {
        this.blinking = true;
        this.draw();
        this.scene.time.delayedCall(110, () => {
          this.blinking = false;
          this.draw();
        });
      }
      this.scheduleBlink();
    });
  }

  draw() {
    const g = this.g;
    g.clear();
    const mood = this.dim ? "sleepy" : this.mood;
    const glyph = GLYPHS[this.blinking ? "blink" : mood];
    const color = COLORS[mood];

    // Eyes per panel: one panel = two eyes, two panels = one eye each.
    const eyes: { quad: Quad; u0: number; u1: number; mirror: boolean }[] = [];
    if (this.visors.length === 1) {
      const q = inset(this.visors[0]!, 0.06);
      eyes.push({ quad: q, u0: 0.12, u1: 0.44, mirror: false }, { quad: q, u0: 0.56, u1: 0.88, mirror: true });
    } else {
      this.visors.forEach((v, i) => eyes.push({ quad: inset(v, 0.06), u0: 0.14, u1: 0.86, mirror: i === 1 }));
    }

    // blank the visor glass first (hides any eyes painted into the art)
    for (const v of this.visors) {
      const q = inset(v, 0.04);
      g.fillStyle(0x07060d, 1);
      g.fillPoints(pts(q.map(([x, y]) => ({ x, y }))), true);
      // glossy highlight along the top edge
      g.fillStyle(0xffffff, 0.06);
      g.fillPoints(pts([bilinear(q, 0.05, 0.05), bilinear(q, 0.95, 0.05), bilinear(q, 0.95, 0.22), bilinear(q, 0.05, 0.22)]), true);
    }

    const shift = this.look * 0.06;
    const rows = glyph.length, cols = glyph[0]!.length;
    for (const e of eyes) {
      const v0 = 0.16, v1 = 0.84;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const on = glyph[r]![e.mirror ? cols - 1 - c : c];
          if (!on) continue;
          const cu0 = e.u0 + ((e.u1 - e.u0) * c) / cols + shift, cu1 = e.u0 + ((e.u1 - e.u0) * (c + 1)) / cols + shift;
          const cv0 = v0 + ((v1 - v0) * r) / rows, cv1 = v0 + ((v1 - v0) * (r + 1)) / rows;
          const cell = [bilinear(e.quad, cu0, cv0), bilinear(e.quad, cu1, cv0), bilinear(e.quad, cu1, cv1), bilinear(e.quad, cu0, cv1)];
          // soft glow, then the lit pixel
          g.fillStyle(color, mood === "sleepy" ? 0.08 : 0.22);
          const cx = (cell[0]!.x + cell[2]!.x) / 2, cy = (cell[0]!.y + cell[2]!.y) / 2;
          g.fillPoints(pts(cell.map((p) => ({ x: cx + (p.x - cx) * 1.9, y: cy + (p.y - cy) * 1.9 }))), true);
          g.fillStyle(color, mood === "sleepy" ? 0.55 : 1);
          g.fillPoints(pts(cell.map((p) => ({ x: cx + (p.x - cx) * 0.86, y: cy + (p.y - cy) * 0.86 }))), true);
        }
    }
  }

  destroy() {
    this.timer?.remove();
    this.g.destroy();
  }
}
