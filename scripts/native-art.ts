// Kitchen art pipeline (OpenAI Images). Appliances are painted INTO the scene
// so they share its scale, perspective and light, then cut out as sprites.
// Eyes are not baked in: Phaser draws them on the visors (see visors.ts).
//
//   bun --env-file=apps/web/.env.local scripts/native-art.ts scene    # art-src/scene_neutral.png from reference + layout
//   bun --env-file=apps/web/.env.local scripts/native-art.ts empty    # art-src/background.png: same scene, appliances removed
//   bun --env-file=apps/web/.env.local scripts/native-art.ts isolate [ids...]  # public/game/<id>_neutral.png + sprites.json
//   bun scripts/visors.ts                                             # detect visor quads into sprites.json
//   cp apps/web/art-src/background.png apps/web/public/game/kitchen.png
//
// If the scene is regenerated, re-measure CUT (where each appliance landed).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode, encode, type Image } from "./png.ts";

const SRC = join(import.meta.dir, "../apps/web/art-src");
const PUB = join(import.meta.dir, "../apps/web/public/game");
const SCENE_MODEL = process.env.IMAGE_MODEL ?? "gpt-image-2";
// gpt-image-2 has no transparent backgrounds, so sprites use gpt-image-1.5.
const SPRITE_MODEL = process.env.SPRITE_MODEL ?? "gpt-image-1.5";

type Id = "fridge" | "toast" | "mixer" | "espresso" | "robo";
type Box = { x: number; y: number; w: number; h: number };

/** Where each appliance sits in scene_neutral.png, measured by eye. */
const CUT: Record<Id, Box> = {
  fridge: { x: 1025, y: 250, w: 305, h: 545 },
  toast: { x: 655, y: 545, w: 145, h: 145 },
  mixer: { x: 688, y: 295, w: 115, h: 205 },
  espresso: { x: 822, y: 342, w: 150, h: 186 },
  robo: { x: 345, y: 740, w: 165, h: 125 },
};
const IDS = Object.keys(CUT) as Id[];
const NOUN: Record<Id, string> = { fridge: "refrigerator", toast: "toaster", mixer: "blender", espresso: "espresso machine", robo: "robot vacuum" };

async function imagesEdit(fields: Record<string, string>, images: { path: string; name: string }[], maskPath?: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const im of images) form.append("image[]", new Blob([readFileSync(im.path)], { type: "image/png" }), im.name);
  if (maskPath) form.append("mask", new Blob([readFileSync(maskPath)], { type: "image/png" }), "mask.png");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const json = (await res.json()) as { data?: { b64_json: string }[]; error?: { message: string } };
  if (!res.ok || !json.data) throw new Error(json.error?.message ?? String(res.status));
  return Buffer.from(json.data[0]!.b64_json, "base64");
}

const STYLE = "Style: Isometric Pixel-Art Simulation Game x Retro-Futurism x Cinematic Domestic Sci-Fi, crisp 16-bit pixel art.";

/** Style from the reference mock-up, layout from the approved v1 composite. */
async function scene() {
  const png = await imagesEdit(
    {
      model: SCENE_MODEL,
      size: "1536x1024",
      quality: "high",
      prompt:
        "Paint a new game scene. Use the FIRST image as the style reference: its kitchen style (white tiled walls, warm under-cabinet light, " +
        "lush hanging and potted plants, wooden shelves with jars and books, stainless range hood, glowing oven, purple night city in the window) and especially its refrigerator style " +
        "(big rounded retro-futuristic silver-lavender French-door fridge with soft rounded corners, sticky notes and a photo). " +
        "Use the SECOND image for the camera angle and layout, but make the room more compact: fewer floor tiles, the room fills more of the frame, cozy and dense. " +
        "Layout: left wall with the big window, counter, stove and glowing oven; back-right wall with a counter holding the BLENDER character and the ESPRESSO MACHINE character, shelves and range hood above; " +
        "the big FRIDGE character stands on the floor at the right end of the right wall; a kitchen island in the middle with a bowl of oranges, " +
        "and the TOASTER character standing on top of the kitchen island; two red bar stools at the island; the ROBOT VACUUM character on the floor in the front-left; a red rug at front-right. " +
        "Characters: each appliance has a glossy black visor screen with two calm glowing white eyes. " +
        "Every appliance is physically grounded on its surface with a soft contact shadow and lit by the room light. " +
        `${STYLE} IMPORTANT: no UI, no panels, no text, no logo, no buttons: only the room, surrounded by a dark navy void.`,
    },
    [
      { path: join(SRC, "reference.png"), name: "reference.png" },
      { path: join(SRC, "v1/preview_native.png"), name: "layout.png" },
    ],
  );
  writeFileSync(join(SRC, "scene_neutral.png"), png);
  console.log("wrote scene_neutral.png");
}

function mask(img: Image, boxes: Box[]): Image {
  const px = new Uint8Array(img.w * img.h * 4).fill(255); // opaque = keep
  for (const r of boxes)
    for (let y = Math.max(0, r.y); y < Math.min(img.h, r.y + r.h); y++)
      for (let x = Math.max(0, r.x); x < Math.min(img.w, r.x + r.w); x++) px[(y * img.w + x) * 4 + 3] = 0; // transparent = edit
  return { w: img.w, h: img.h, px };
}

/** The game background: the scene with the appliances removed. */
async function empty() {
  const maskPath = join(SRC, "_mask.png");
  encode(mask(decode(join(SRC, "scene_neutral.png")), IDS.map((id) => ({ x: CUT[id].x - 6, y: CUT[id].y - 6, w: CUT[id].w + 12, h: CUT[id].h + 12 }))), maskPath);
  const png = await imagesEdit(
    {
      model: SCENE_MODEL,
      size: "1536x1024",
      quality: "high",
      prompt:
        "Remove the five appliances (the refrigerator, the toaster on the island, the blender, the espresso machine and the robot vacuum) from this kitchen. " +
        "Where the refrigerator stood, show the empty tiled floor and the white tiled wall with its baseboard. " +
        "Where the small appliances stood, show the empty countertop / island top. Where the robot vacuum was, show empty floor tiles. " +
        "Do not add anything new. Every other pixel stays identical: same room, counters, island, shelves, lighting and pixel-art style.",
    },
    [{ path: join(SRC, "scene_neutral.png"), name: "scene.png" }],
    maskPath,
  );
  writeFileSync(join(SRC, "background.png"), png);
  console.log("wrote background.png");
}

function crop(img: Image, x: number, y: number, s: number): Image {
  const px = new Uint8Array(s * s * 4);
  for (let j = 0; j < s; j++)
    for (let i = 0; i < s; i++) {
      const sx = Math.min(img.w - 1, Math.max(0, x + i)), sy = Math.min(img.h - 1, Math.max(0, y + j));
      px.set(img.px.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), (j * s + i) * 4);
    }
  return { w: s, h: s, px };
}

const sips = (...args: string[]) => {
  const r = Bun.spawnSync(["sips", ...args], { stdout: "ignore", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
};

type Manifest = Record<string, Box & { visors?: number[][][] }>;

/** Crop from the scene, isolate on transparency with the same framing, scale back to the crop. */
async function isolateOne(id: Id, scene: Image, manifest: Manifest) {
  const r = CUT[id];
  const side = Math.max(r.w, r.h) + 24;
  const x = Math.round(r.x + r.w / 2 - side / 2), y = Math.round(r.y + r.h / 2 - side / 2);
  const cropPath = join(SRC, `_crop_${id}.png`);
  encode(crop(scene, x, y, side), cropPath);
  sips("-z", "1024", "1024", cropPath);
  const png = await imagesEdit(
    {
      model: SPRITE_MODEL,
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      input_fidelity: "high",
      prompt:
        `Isolate the ${NOUN[id]} in the center of this image on a fully transparent background. Keep the appliance pixel-identical: same size, position, angle, colors, lighting and pixel art. ` +
        "Remove everything else (wall, counter, floor, neighbouring objects). Keep only a faint soft contact shadow directly under it." +
        (id === "fridge"
          ? " Also fix the face: exactly ONE glowing eye per upper door (two eyes total), placed high on each door near the center seam, at the same height, so the seam splits the face between the eyes. Each eye is on its own small black visor panel."
          : ""),
    },
    [{ path: cropPath, name: "crop.png" }],
  );
  const big = join(SRC, `iso_${id}_neutral.png`);
  writeFileSync(big, png);
  sips("-z", String(side), String(side), big, "--out", join(PUB, `${id}_neutral.png`));
  manifest[id] = { ...manifest[id], x, y, w: side, h: side };
  console.log("isolated", id);
}

async function isolate(only: Id[]) {
  const scene = decode(join(SRC, "scene_neutral.png"));
  const manifestPath = join(PUB, "sprites.json");
  const manifest: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const results = await Promise.allSettled((only.length ? only : IDS).map((id) => isolateOne(id, scene, manifest)));
  for (const r of results) if (r.status === "rejected") console.error(String(r.reason));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "scene") await scene();
else if (cmd === "empty") await empty();
else if (cmd === "isolate") await isolate(rest as Id[]);
else console.log("usage: native-art.ts scene | empty | isolate [ids...]");
