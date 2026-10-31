// Minimal PNG decode/encode (8-bit RGB/RGBA, non-interlaced). Enough for the
// art scripts, so they need no image library.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

export interface Image {
  w: number;
  h: number;
  /** RGBA, 4 bytes per pixel. */
  px: Uint8Array;
}

export function decode(path: string): Image & { bpp: number } {
  const b = readFileSync(path);
  let o = 8;
  const idat: Buffer[] = [];
  let w = 0, h = 0, ct = 0;
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const t = b.toString("ascii", o + 4, o + 8);
    const d = b.subarray(o + 8, o + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]!; }
    if (t === "IDAT") idat.push(d);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3;
  const src = new Uint8Array(w * h * bpp);
  const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? src[y * stride + x - bpp]! : 0;
      const up = y ? src[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y ? src[(y - 1) * stride + x - bpp]! : 0;
      let v = raw[y * (stride + 1) + 1 + x]!;
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      src[y * stride + x] = v & 255;
    }
  }
  if (bpp === 4) return { w, h, bpp, px: src };
  const px = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
    px[j] = src[i]!; px[j + 1] = src[i + 1]!; px[j + 2] = src[i + 2]!; px[j + 3] = 255;
  }
  return { w, h, bpp: 4, px };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encode(img: Image, path: string) {
  const { w, h, px } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]));
}

if (import.meta.main) {
  for (const p of process.argv.slice(2)) {
    const { w, h, px } = decode(p);
    let clear = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] === 0) clear++;
    console.log(p.split("/").pop(), w, h, "transparent px:", clear);
  }
}
