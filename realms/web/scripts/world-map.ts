// Maps of the generated world from straight above (`npm run world:map [out-dir]`), drawn from the checked-in files as
// the overworld loads them, into realms/web/e2e/screenshots/world2/ by default:
//   world.png      the travel map, two pixels a tile: grounds, the levels shaded at their brinks, groves, peaks, roads,
//                  bridges, the towns' icons, entrances, landmarks, ferries, spawns, and the labels
//   zones.png      the same with each tier's zone tinted, the spawns and waymarkers by tier
//   terraces.png   the levels alone, a band of color each, ramps orange, closed ground dark
//   close-<name>.png  a 96-by-96 stretch at eight pixels a tile (the Hurloon passes, Benalia's coast, Llanowar's rivers,
//                  the Rip, Sursi and the Cathedral)
//   pockets.png    the whole world file: the travel map and each town's grounds in its pocket, a pixel a tile
// (Each town's own pictures are the town generator's: scripts/worldgen/town-preview.ts.)
// `crop x0 z0 x1 z1 [scale]` after the directory draws a stretch of the world instead.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNK, type ChunkData, type DungeonData, type TileData, type WorldData, isBlocked, siteRect, tierAt } from "../src/world/format";
import { Picture, SURFACE_COLORS, TIER_COLORS, rgb } from "./worldgen/picture";

type RGB = readonly [number, number, number];
const here = dirname(fileURLToPath(import.meta.url));
const plane = join(here, "..", "..", "content", "dominaria");
const out = process.argv[2] ?? join(here, "..", "e2e", "screenshots", "world2");
mkdirSync(out, { recursive: true });

const world = JSON.parse(readFileSync(join(plane, "world", "world.json"), "utf8")) as WorldData;
const chunks = readdirSync(join(plane, "world", "chunks")).map((f) => JSON.parse(readFileSync(join(plane, "world", "chunks", f), "utf8")) as ChunkData);
const dungeons = readdirSync(join(plane, "dungeons")).map((f) => JSON.parse(readFileSync(join(plane, "dungeons", f), "utf8")) as DungeonData);
const [W, H] = world.size;
const travel = world.travel ?? [0, 0, W, H];

const tiles = new Map<number, TileData>();
for (const c of chunks) c.tiles.forEach((t, k) => tiles.set((c.cz * CHUNK + Math.floor(k / CHUNK)) * W + c.cx * CHUNK + (k % CHUNK), t));
const tileAt = (x: number, z: number) => tiles.get(z * W + x);
const props = chunks.flatMap((c) => c.props);

const shade = (c: RGB, k: number): [number, number, number] => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
const WATER = new Set(["sea", "shallows", "stream", "bog", "lava"]);
const PEAK: Record<string, RGB> = { rock: rgb("#8a8580"), snow: rgb("#eef0f4"), ice: rgb("#cfe6f0"), ash: rgb("#4a4650"), sandstone: rgb("#c89a60"), redrock: rgb("#a8503a") };
const GROVE: Record<string, RGB> = { broadleaf: rgb("#2f5a22"), pine: rgb("#24452c"), snowpine: rgb("#3a5a4c"), swamp: rgb("#33412a"), dead: rgb("#5a4a3a"), palm: rgb("#4a7a2a"), jungle: rgb("#1f4a1c"), elfwood: rgb("#3f6a1e") };

// --- Letters, for the labels: a five-by-seven pixel font -------------------------------------------------------------
const FONT: Record<string, string> = {
  A: "01110100011000111111100011000110001", B: "11110100011000111110100011000111110", C: "01110100011000010000100001000101110", D: "11110100011000110001100011000111110",
  E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000", G: "01110100011000010111100011000101111", H: "10001100011000111111100011000110001",
  I: "01110001000010000100001000010001110", J: "00111000100001000010000101001001100", K: "10001100101010011000101001001010001", L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001", N: "10001110011010110011100011000110001", O: "01110100011000110001100011000101110", P: "11110100011000111110100001000010000",
  Q: "01110100011000110001101011001001101", R: "11110100011000111110101001001010001", S: "01111100001000001110000010000111110", T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110", V: "10001100011000110001100010101000100", W: "10001100011000110101101011101110001", X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100", Z: "11111000010001000100010001000011111", "'": "00100001000100000000000000000000000", "-": "00000000000000011111000000000000000",
  " ": "00000000000000000000000000000000000",
};
function text(p: Picture, s: string, cx: number, cy: number, k: number, color: RGB): void {
  const chars = [...s.toUpperCase()].filter((ch) => FONT[ch] !== undefined);
  const w = chars.length * 6 * k - k;
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - 3.5 * k);
  chars.forEach((ch, n) => {
    const bits = FONT[ch]!;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
      if (bits[y * 5 + x] !== "1") continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) p.fill(x0 + (n * 6 + x) * k + dx, y0 + y * k + dy, k, k, [15, 15, 20], 0.6);
    }
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (bits[y * 5 + x] === "1") p.fill(x0 + (n * 6 + x) * k, y0 + y * k, k, k, color);
  });
}

/** The world from above, `scale` pixels a tile, over [x0, z0, x1, z1]. */
function draw(x0: number, z0: number, x1: number, z1: number, scale: number, opts: { zones?: boolean; labels?: boolean } = {}): Picture {
  const p = new Picture((x1 - x0) * scale, (z1 - z0) * scale);
  const px = (x: number) => (x - x0) * scale;
  const pz = (z: number) => (z - z0) * scale;
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const t = tileAt(x, z);
      if (!t) continue;
      let c: RGB = SURFACE_COLORS[t[1]] ?? rgb("#ff00ff");
      if (!WATER.has(t[1])) c = shade(c, 0.86 + Math.min(10, t[0] / 12) * 0.035);
      // The brinks: the foot of a higher tile to the north or west in shadow, a cliff darker; a lit lip on the higher.
      const n = tileAt(x, z - 1);
      const w = tileAt(x - 1, z);
      const up = Math.max(n && !WATER.has(n[1]) ? n[0] - t[0] : 0, w && !WATER.has(w[1]) ? w[0] - t[0] : 0);
      if (up > 4 && !WATER.has(t[1])) c = shade(c, up >= 24 ? 0.6 : 0.75);
      const s = tileAt(x, z + 1);
      const e = tileAt(x + 1, z);
      if (((s && s[0] < t[0] - 4) || (e && e[0] < t[0] - 4)) && !WATER.has(t[1])) c = shade(c, 1.12);
      if (t[2] & 4) c = rgb("#d89a50");
      p.fill(px(x), pz(z), scale, scale, c);
      if (opts.zones) {
        const tier = tierAt(world, x, z);
        if (tier > 0) p.fill(px(x), pz(z), scale, scale, TIER_COLORS[tier]!, 0.35);
      }
    }
  }
  for (const r of world.roads) for (const [x, z] of r.tiles) if (x >= x0 && x < x1 && z >= z0 && z < z1) p.fill(px(x), pz(z), scale, scale, rgb("#e8d2a0"), 0.55);
  for (const f of world.ferries) for (const [x, z] of f.lane) p.fill(px(x) + scale / 4, pz(z) + scale / 4, scale / 2, scale / 2, rgb("#9fe8ff"), 0.7);
  const shown = props.filter((q) => q.x >= x0 - 3 && q.x < x1 + 3 && q.z >= z0 - 3 && q.z < z1 + 3);
  // Peaks first, widest first, so the summits lie over the skirts.
  for (const q of shown.filter((q) => q.id === "peak").sort((a, b) => ((b.args?.w as number) ?? 1) - ((a.args?.w as number) ?? 1))) {
    const w = (q.args?.w as number) ?? 1;
    const c = PEAK[(q.args?.kind as string) ?? "rock"] ?? PEAK.rock!;
    const half = (w * scale) / 2;
    for (let r = half; r > 0; r -= Math.max(1, scale / 3)) p.fill(px(q.x) - r, pz(q.z) - r, 2 * r, 2 * r, shade(c, 0.7 + 0.4 * (1 - r / half)));
  }
  for (const q of shown) {
    const x = px(q.x);
    const z = pz(q.z);
    const to = q.args?.to as [number, number] | undefined;
    if (q.id === "grove") p.fill(x - scale * 0.45, z - scale * 0.45, scale * 0.9, scale * 0.9, GROVE[(q.args?.kind as string) ?? "broadleaf"] ?? GROVE.broadleaf!);
    else if (q.id === "town-icon") {
      const n = { capital: 7, town: 5, village: 3 }[q.args?.size as string] ?? 3;
      p.fill(x - (n * scale) / 2, z - (n * scale) / 2, n * scale, n * scale, rgb("#2a1a14"));
      p.fill(x - (n * scale) / 2 + 1, z - (n * scale) / 2 + 1, n * scale - 2, n * scale - 2, rgb("#c0503a"));
      p.fill(x - scale / 2, z - scale / 2, scale, scale, rgb("#f0e0c0"));
    } else if (q.id === "landmark") {
      p.fill(x - 1.5 * scale, z - 1.5 * scale, 3 * scale, 3 * scale, rgb("#1a1020"));
      p.fill(x - 1.5 * scale + 1, z - 1.5 * scale + 1, 3 * scale - 2, 3 * scale - 2, rgb("#b070e0"));
    } else if (q.id === "bridge" && to) p.fill(x, z, px(to[0]) - x, pz(to[1]) - z, rgb("#8a6a48"));
    else if (q.id === "stepping-stone") p.fill(x - scale / 4, z - scale / 4, scale / 2, scale / 2, rgb("#c0b8a8"));
    else if (q.id === "signpost") p.fill(x - scale / 2, z - scale / 2, scale, scale, rgb("#ffe060"));
    else if (q.args?.w !== undefined && q.id !== "peak") p.fill(x, z, (q.args.w as number) * scale, (q.args.d as number) * scale, rgb("#d040d0"));
    else if (scale >= 4 && q.id !== "peak") p.fill(x - scale * 0.25, z - scale * 0.25, scale * 0.5, scale * 0.5, rgb("#404040"));
  }
  for (const c of chunks) {
    if ((c.cx + 1) * CHUNK <= x0 || c.cx * CHUNK >= x1 || (c.cz + 1) * CHUNK <= z0 || c.cz * CHUNK >= z1) continue;
    for (const b of c.buildings) p.fill(px(b.x), pz(b.z), b.w * scale, b.d * scale, b.interior ? rgb("#b0503a") : rgb("#804030"));
    for (const n of c.npcs) p.fill(px(n.x), pz(n.z), scale, scale, rgb("#00e0ff"));
    for (const e of c.entrances) p.fill(px(e.x), pz(e.z), scale, scale, rgb("#ff40ff"));
    for (const s of c.spawns) p.ring(px(s.x) + scale / 2, pz(s.z) + scale / 2, Math.max(2, scale * 1.5), TIER_COLORS[s.tier]!);
    if (opts.zones || scale >= 4) for (const m of c.waymarkers) p.fill(px(m.x) - 1, pz(m.z) - 1, scale + 2, scale + 2, shade(TIER_COLORS[m.tier]!, 0.7));
  }
  if (opts.zones) for (const d of dungeons) {
    const [x, z] = d.entrance;
    p.fill(px(x) - 3, pz(z) - 3, 7, 7, d.waystone ? rgb("#40c0ff") : rgb("#ffffff"));
    p.fill(px(x) - 1, pz(z) - 1, 3, 3, TIER_COLORS[d.tier]!);
  }
  if (opts.labels) {
    for (const l of world.labels ?? []) {
      if (l.x < x0 || l.x >= x1 || l.z < z0 || l.z >= z1) continue;
      const k = l.kind === "land" ? 3 : l.kind === "sea" ? 2 : l.kind === "region" ? 2 : 1;
      text(p, l.name, px(l.x), pz(l.z), k, l.kind === "sea" ? rgb("#a8d8ff") : l.kind === "feature" ? rgb("#f0e8c0") : rgb("#ffffff"));
    }
    for (const t of world.towns) if (t.site && t.site[0] >= x0 && t.site[0] < x1 && t.site[1] >= z0 && t.site[1] < z1) text(p, t.name.replace(/^The /, ""), px(t.site[0]), pz(t.site[1] + 5), 1, rgb("#ffd0a0"));
  }
  return p;
}

/** The terraces from above: each level a band of color, ramps orange, closed land dark, peaks grey, water blue. */
function relief(x0: number, z0: number, x1: number, z1: number, scale: number): Picture {
  const p = new Picture((x1 - x0) * scale, (z1 - z0) * scale);
  const bands = ["#2f5a2a", "#4a7a36", "#6a9a44", "#8db45a", "#b2c977", "#d2d99a", "#ece9c4", "#f6f0dc", "#ffffff"].map(rgb);
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const t = tileAt(x, z);
    if (!t) continue;
    let c: RGB;
    if (WATER.has(t[1]) && isBlocked(t)) c = t[1] === "sea" ? rgb("#16304a") : rgb("#2f6488");
    else if (t[2] & 4) c = rgb("#f08a24");
    else {
      c = bands[Math.max(0, Math.min(bands.length - 1, Math.round(t[0] / 12)))]!;
      const n = tileAt(x, z - 1);
      const w = tileAt(x - 1, z);
      if ((n && n[0] > t[0] + 4) || (w && w[0] > t[0] + 4)) c = shade(c, 0.6);
      if (isBlocked(t)) c = shade(c, 0.55);
    }
    p.fill((x - x0) * scale, (z - z0) * scale, scale, scale, c);
  }
  return p;
}

if (process.argv[3] === "crop") {
  const [x0, z0, x1, z1, scale] = process.argv.slice(4).map(Number);
  writeFileSync(join(out, `crop-${x0}-${z0}.png`), draw(x0!, z0!, x1!, z1!, scale || 4, { labels: true }).png());
  process.exit(0);
}

writeFileSync(join(out, "world.png"), draw(travel[0], travel[1], travel[2], travel[3], 2, { labels: true }).png());
writeFileSync(join(out, "zones.png"), draw(travel[0], travel[1], travel[2], travel[3], 1, { zones: true }).png());
writeFileSync(join(out, "terraces.png"), relief(travel[0], travel[1], travel[2], travel[3], 1).png());
const CLOSE: Record<string, readonly [number, number]> = {
  "hurloon-passes": [176, 286],
  "benalia-coast": [72, 338],
  "llanowar-rivers": [196, 376],
  "the-rip": [210, 168],
  "sursi-cathedral": [284, 496],
};
for (const [name, [x, z]] of Object.entries(CLOSE)) writeFileSync(join(out, `close-${name}.png`), draw(x - 48, z - 48, x + 48, z + 48, 8).png());
// The whole world file: the travel map and the pockets, each pocket outlined.
{
  const p = draw(0, 0, W, H, 1);
  for (const t of world.towns) {
    const g = t.grounds;
    if (!g) continue;
    p.ring((g[0] + g[2]) / 2, (g[1] + g[3]) / 2, 0, rgb("#ffffff"));
    for (let x = g[0]; x < g[2]; x++) {
      p.set(x, g[1], rgb("#ffe060"));
      p.set(x, g[3] - 1, rgb("#ffe060"));
    }
    for (let z = g[1]; z < g[3]; z++) {
      p.set(g[0], z, rgb("#ffe060"));
      p.set(g[2] - 1, z, rgb("#ffe060"));
    }
    text(p, t.id, (g[0] + g[2]) / 2, g[1] + 8, 1, rgb("#ffffff"));
    const r = siteRect(t);
    if (r) text(p, t.id.slice(0, 3), r[0], r[1] - 6, 1, rgb("#ffe060"));
  }
  writeFileSync(join(out, "pockets.png"), p.png());
}
console.log(`world-map.ts: ${4 + Object.keys(CLOSE).length} pictures in ${out}`);
