// Cuts foreground furniture (island + bar stools) out of the kitchen
// background, so characters standing behind it can be drawn underneath it.
// The cut comes from the same image, so it lines up pixel-for-pixel.
//
//   bun scripts/foreground.ts [--debug out.png]
//
// Writes apps/web/public/game/island_fg.png and foreground.json.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode, encode } from "./png.ts";

const PUB = join(import.meta.dir, "../apps/web/public/game");
type P = [number, number];

// Outlines traced on a 3x zoom of background.png (origin 520,560), so zoom
// coordinates map to kitchen pixels as (520 + zx/3, 560 + zy/3).
const Z = (pts: P[]): P[] => pts.map(([x, y]) => [520 + x / 3, 560 + y / 3]);
const SHAPES: P[][] = [
  // island: top surface, left face, front face (bottom edge runs behind the stools)
  Z([[680, 22], [1134, 266], [1134, 300], [1102, 318], [1102, 689], [490, 1050], [86, 810], [68, 430], [46, 372]]),
  // front stool: seat + legs
  Z([[662, 600], [698, 562], [842, 562], [938, 606], [938, 740], [968, 988], [930, 994], [822, 1064], [782, 1064], [690, 998], [645, 992], [666, 760]]),
  // back stool: seat + legs
  Z([[907, 480], [948, 425], [1092, 425], [1190, 478], [1190, 600], [1210, 818], [1170, 826], [1080, 904], [1032, 904], [932, 842], [907, 600]]),
];

/** Tile footprint the cut-out covers (island 3..4 x 4..5 plus stools 5..6 x 4..5). */
const FOOTPRINT = { room: "kitchen", x: 3, y: 4, w: 4, h: 2 };

function inside(pt: P, poly: P[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const bg = decode(join(import.meta.dir, "../apps/web/art-src/background.png"));
const all = SHAPES.flat();
const x0 = Math.floor(Math.min(...all.map((p) => p[0]))), x1 = Math.ceil(Math.max(...all.map((p) => p[0])));
const y0 = Math.floor(Math.min(...all.map((p) => p[1]))), y1 = Math.ceil(Math.max(...all.map((p) => p[1])));
const w = x1 - x0 + 1, h = y1 - y0 + 1;
const px = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    // 2x2 supersampling for a soft 1px edge
    let cover = 0;
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as P[])
      if (SHAPES.some((s) => inside([x0 + x + dx, y0 + y + dy], s))) cover++;
    if (!cover) continue;
    const si = ((y0 + y) * bg.w + x0 + x) * 4, di = (y * w + x) * 4;
    px[di] = bg.px[si]!; px[di + 1] = bg.px[si + 1]!; px[di + 2] = bg.px[si + 2]!;
    px[di + 3] = Math.round((cover / 4) * 255);
  }
encode({ w, h, px }, join(PUB, "island_fg.png"));
writeFileSync(join(PUB, "foreground.json"), JSON.stringify({ island: { key: "island_fg", x: x0, y: y0, w, h, footprint: FOOTPRINT } }, null, 2));
console.log("island_fg", { x: x0, y: y0, w, h });

const dbg = process.argv.indexOf("--debug");
if (dbg > 0) {
  // magenta where the cut-out is, to check the outline
  const out = { w: bg.w, h: bg.h, px: new Uint8Array(bg.px) };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = px[(y * w + x) * 4 + 3]! / 255;
      if (!a) continue;
      const i = ((y0 + y) * bg.w + x0 + x) * 4;
      out.px[i] = Math.round(out.px[i]! * (1 - a * 0.45) + 255 * a * 0.45);
      out.px[i + 2] = Math.round(out.px[i + 2]! * (1 - a * 0.45) + 255 * a * 0.45);
    }
  encode(out, process.argv[dbg + 1]!);
}
