// A picture of the generated world, for looking at while tuning the generator (`npx vite-node scripts/world-preview.ts
// <out.png> [zones]`): every hex as the camera sees it from far above - up on the picture is up on screen - in its
// ground's color, scenery darker, roads, towns, doors, dungeon entrances and spawn points marked; with `zones`, each
// tier's zone tinted.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { toWorld } from "../src/hex";
import type { ChunkData, WorldData } from "../src/world/schema";
import { areaAt } from "../src/world/schema";

const here = dirname(fileURLToPath(import.meta.url));
const plane = join(here, "..", "..", "content", "dominaria");
const out = process.argv[2] ?? "world.png";
const showZones = process.argv.includes("zones");
const world = JSON.parse(readFileSync(join(plane, "world", "world.json"), "utf8")) as WorldData;

const COLORS: Record<string, string> = {
  grass: "#5a8538", meadow: "#8fb350", dirt: "#9a6c45", road: "#c9a070", cobble: "#9a9eaa", stone: "#7a7f8e", rock: "#5a5e6e", sand: "#d6ae7e",
  water: "#2f6488", "deep-water": "#12263a", swamp: "#2c3326", mud: "#6b4630", moss: "#3a5f2c", snow: "#f2efe6", ice: "#c6e5ee", ash: "#4f5363",
  lava: "#e86a3a", floor: "#6b7080", wood: "#8f6340", marble: "#d8d6d0", crystal: "#a97fd0", forest: "#2a4524", hills: "#7a8a40", mountain: "#8c909c",
};
const TIERS = ["#000000", "#3e9a4a", "#e0c040", "#e07a30", "#c8302c"];

const W = 1400;
const H = 1400;
const pixels = new Uint8Array(W * H * 3);
const tiles = new Map<string, { t: string; b: number; prop?: string }>();
const marks: { q: number; r: number; color: string; size: number }[] = [];
for (const file of readdirSync(join(plane, "world", "chunks"))) {
  const chunk = JSON.parse(readFileSync(join(plane, "world", "chunks", file), "utf8")) as ChunkData;
  for (const [q, r, , t, b] of chunk.tiles) tiles.set(`${q},${r}`, { t, b });
  for (const p of chunk.props) {
    const tile = tiles.get(`${p.q},${p.r}`);
    if (tile) tile.prop = p.kind;
  }
  for (const s of chunk.spawns) marks.push({ q: s.q, r: s.r, color: TIERS[s.tier]!, size: 1 });
  for (const d of chunk.doors) marks.push({ q: d.q, r: d.r, color: "#ffffff", size: 0 });
  for (const e of chunk.entrances) marks.push({ q: e.q, r: e.r, color: "#ff40ff", size: 4 });
  for (const p of chunk.props) if (p.kind === "waymarker") marks.push({ q: p.q, r: p.r, color: TIERS[p.tier!]!, size: 2 });
}
const corner = [toWorld({ q: 0, r: 0 }), toWorld({ q: 640, r: 0 }), toWorld({ q: 0, r: 640 }), toWorld({ q: 640, r: 640 })];
const across = (p: { x: number; z: number }) => (p.x - p.z) / Math.SQRT2;
const down = (p: { x: number; z: number }) => (p.x + p.z) / Math.SQRT2;
const minA = Math.min(...corner.map(across));
const maxA = Math.max(...corner.map(across));
const minD = Math.min(...corner.map(down));
const maxD = Math.max(...corner.map(down));
const scale = Math.min(W / (maxA - minA), H / (maxD - minD));
const hexAt = (px: number, py: number) => {
  const a = px / scale + minA;
  const d = py / scale + minD;
  const x = (a + d) / Math.SQRT2;
  const z = (d - a) / Math.SQRT2;
  const q = (2 / 3) * x;
  const r = (-1 / 3) * x + (Math.sqrt(3) / 3) * z;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  if (Math.abs(rq - q) > Math.abs(rr - r) && Math.abs(rq - q) > Math.abs(rs - s)) rq = -rr - rs;
  else if (Math.abs(rr - r) > Math.abs(rs - s)) rr = -rq - rs;
  return { q: rq, r: rr };
};
const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] as const;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const h = hexAt(x, y);
    const tile = tiles.get(`${h.q},${h.r}`);
    let [r, g, b] = tile ? rgb(COLORS[tile.t] ?? "#ff00ff") : [0, 0, 0];
    if (tile?.prop) {
      const dark = tile.prop === "building" || tile.prop === "wall" || tile.prop === "tower" ? 0.35 : 0.65;
      [r, g, b] = [r * dark, g * dark, b * dark];
    }
    if (showZones && tile) {
      const tier = areaAt(world.zones, h)?.tier ?? 0;
      if (tier > 0) {
        const [tr, tg, tb] = rgb(TIERS[tier]!);
        [r, g, b] = [r * 0.6 + tr * 0.4, g * 0.6 + tg * 0.4, b * 0.6 + tb * 0.4];
      }
    }
    const o = (y * W + x) * 3;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
  }
}
for (const m of marks) {
  const p = toWorld(m);
  const px = Math.round((across(p) - minA) * scale);
  const py = Math.round((down(p) - minD) * scale);
  const [r, g, b] = rgb(m.color);
  for (let dy = -m.size; dy <= m.size; dy++) {
    for (let dx = -m.size; dx <= m.size; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const o = (y * W + x) * 3;
      pixels[o] = r;
      pixels[o + 1] = g;
      pixels[o + 2] = b;
    }
  }
}

// A PNG: the rows, each led by filter 0, deflated, in IHDR/IDAT/IEND chunks with their CRCs.
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  Buffer.from(pixels.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(`wrote ${out}`);
