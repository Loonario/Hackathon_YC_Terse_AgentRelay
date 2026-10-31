// Finds each appliance's visor (the glossy black face screen) in its neutral
// sprite and stores it as a quad in apps/web/public/game/sprites.json, in the
// web sprite's pixel space. Phaser draws procedural eyes into these quads.
//
//   bun scripts/visors.ts [--debug out.png]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode, encode } from "./png.ts";

const SRC = join(import.meta.dir, "../apps/web/art-src");
const PUB = join(import.meta.dir, "../apps/web/public/game");
const EYES: Record<string, number> = { toast: 1, mixer: 1, espresso: 1, robo: 1, fridge: 2 }; // visor panels
type P = [number, number];

const manifest = JSON.parse(readFileSync(join(PUB, "sprites.json"), "utf8"));
const debugIdx = process.argv.indexOf("--debug");
const sheets: { w: number; h: number; px: Uint8Array }[] = [];

for (const id of Object.keys(EYES)) {
  const im = decode(join(SRC, `iso_${id}_neutral.png`));
  const { w, h, px } = im;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4]!, g = px[i * 4 + 1]!, b = px[i * 4 + 2]!, a = px[i * 4 + 3]!;
    dark[i] = a > 200 && Math.max(r, g, b) < 46 ? 1 : 0;
  }
  // close small gaps (eye pixels inside the visor) with a dilate pass
  const solid = new Uint8Array(dark);
  const R = 6;
  for (let y = R; y < h - R; y++)
    for (let x = R; x < w - R; x++) {
      if (dark[y * w + x]) continue;
      let l = 0, rr = 0, u = 0, d = 0;
      for (let k = 1; k <= R; k++) { l ||= dark[y * w + x - k]!; rr ||= dark[y * w + x + k]!; u ||= dark[(y - k) * w + x]!; d ||= dark[(y + k) * w + x]!; }
      if ((l && rr) || (u && d)) solid[y * w + x] = 1;
    }
  // connected components
  const label = new Int32Array(w * h).fill(-1);
  const blobs: { pts: P[] }[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!solid[s] || label[s] !== -1) continue;
    const pts: P[] = [];
    const stack = [s];
    label[s] = blobs.length;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      pts.push([x, y]);
      for (const j of [i - 1, i + 1, i - w, i + w])
        if (j >= 0 && j < w * h && solid[j] && label[j] === -1 && Math.abs((j % w) - x) <= 1) { label[j] = blobs.length; stack.push(j); }
    }
    blobs.push({ pts });
  }
  // visors are compact, wider-than-tall-ish blobs; take the biggest N
  const scored = blobs
    .filter((b) => b.pts.length > 400)
    .map((b) => {
      const xs = b.pts.map((p) => p[0]), ys = b.pts.map((p) => p[1]);
      const bw = Math.max(...xs) - Math.min(...xs) + 1, bh = Math.max(...ys) - Math.min(...ys) + 1;
      const fill = b.pts.length / (bw * bh);
      return { b, score: b.pts.length * fill };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, EYES[id]!);
  const k = manifest[id].w / w; // iso px -> web sprite px
  const quads = scored
    .map(({ b }) => {
      // corners from extremes along the diagonals: TL, TR, BR, BL
      let tl = b.pts[0]!, tr = tl, br = tl, bl = tl;
      for (const p of b.pts) {
        if (p[0] + p[1] < tl[0] + tl[1]) tl = p;
        if (p[0] + p[1] > br[0] + br[1]) br = p;
        if (p[0] - p[1] > tr[0] - tr[1]) tr = p;
        if (p[0] - p[1] < bl[0] - bl[1]) bl = p;
      }
      return [tl, tr, br, bl].map(([x, y]) => [Math.round(x * k * 10) / 10, Math.round(y * k * 10) / 10]);
    })
    .sort((a, b) => a[0]![0]! - b[0]![0]!); // left panel first
  // Two-panel faces: a panel that bled into a dark seam comes out much taller
  // than its twin. Rebuild it from the twin's shape at its own top-left corner.
  if (quads.length === 2) {
    const height = (q: number[][]) => Math.max(...q.map((p) => p[1]!)) - Math.min(...q.map((p) => p[1]!));
    const [a, b] = quads as number[][][];
    const [bad, good] = height(a!) > height(b!) * 1.4 ? [0, b!] : height(b!) > height(a!) * 1.4 ? [1, a!] : [-1, a!];
    if (bad >= 0) {
      const o = quads[bad]![0]!;
      quads[bad] = good.map((p) => [Math.round((p[0]! - good[0]![0]! + o[0]!) * 10) / 10, Math.round((p[1]! - good[0]![1]! + o[1]!) * 10) / 10]);
    }
  }
  manifest[id].visors = quads;
  console.log(id, JSON.stringify(quads));

  if (debugIdx > 0) {
    const out = new Uint8Array(px);
    for (const q of quads)
      for (let e = 0; e < 4; e++) {
        const [a0, a1] = q[e]!, [b0, b1] = q[(e + 1) % 4]!;
        for (let t = 0; t <= 1; t += 0.002) {
          const x = Math.round((a0! + (b0! - a0!) * t) / k), y = Math.round((a1! + (b1! - a1!) * t) / k);
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const i = ((y + dy) * w + x + dx) * 4;
            out[i] = 0; out[i + 1] = 255; out[i + 2] = 0; out[i + 3] = 255;
          }
        }
      }
    sheets.push({ w, h, px: out });
  }
}
writeFileSync(join(PUB, "sprites.json"), JSON.stringify(manifest, null, 2));

if (debugIdx > 0) {
  const T = 400, n = sheets.length, out = new Uint8Array(T * n * T * 4);
  sheets.forEach((s, j) => {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const si = (Math.floor((y * s.h) / T) * s.w + Math.floor((x * s.w) / T)) * 4, di = (y * T * n + j * T + x) * 4, a = s.px[si + 3]! / 255;
      for (let c = 0; c < 3; c++) out[di + c] = Math.round(s.px[si + c]! * a + 60 * (1 - a));
      out[di + 3] = 255;
    }
  });
  encode({ w: T * n, h: T, px: out }, process.argv[debugIdx + 1]!);
}
