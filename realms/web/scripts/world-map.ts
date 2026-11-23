// Maps of the generated world from straight above (`npm run world:map [out-dir]`), drawn from the checked-in files as
// the overworld loads them: the whole of Dominaria a tile a pixel (world.png), the same with each tier's zone tinted and
// the spawns, waymarkers, dungeons and towers marked (zones.png), and every town close up, four pixels a tile
// (town-<id>.png) - streets, buildings by footprint with their doors, walls and gates, wares, people. The default
// directory is realms/web/e2e/screenshots/world2/.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNK, type ChunkData, type DungeonData, type WorldData, isBlocked, tierAt } from "../src/world/format";
import { Picture, SURFACE_COLORS, TIER_COLORS, rgb } from "./worldgen/picture";

const here = dirname(fileURLToPath(import.meta.url));
const plane = join(here, "..", "..", "content", "dominaria");
const out = process.argv[2] ?? join(here, "..", "e2e", "screenshots", "world2");
mkdirSync(out, { recursive: true });

const world = JSON.parse(readFileSync(join(plane, "world", "world.json"), "utf8")) as WorldData;
const chunks = readdirSync(join(plane, "world", "chunks")).map((f) => JSON.parse(readFileSync(join(plane, "world", "chunks", f), "utf8")) as ChunkData);
const dungeons = readdirSync(join(plane, "dungeons")).map((f) => JSON.parse(readFileSync(join(plane, "dungeons", f), "utf8")) as DungeonData);
const [W, H] = world.size;

const darker = (c: readonly [number, number, number], k = 0.55): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];
const TREE = new Set(["tree", "pine", "dead-tree", "great-tree", "swamp-tree", "giant-tree"]);
const STYLE_ROOF: Record<string, [number, number, number]> = { benalish: rgb("#b0503a"), llanowar: rgb("#6a8a3a"), urborg: rgb("#4a3a52"), keldon: rgb("#7a5a3a"), tolarian: rgb("#5a7ab8"), argive: rgb("#b0503a") };

/** Draws the world at `scale` pixels a tile over the tiles x0..x1, z0..z1. */
function draw(x0: number, z0: number, x1: number, z1: number, scale: number, zones = false): Picture {
  const p = new Picture((x1 - x0) * scale, (z1 - z0) * scale);
  const px = (x: number) => (x - x0) * scale;
  const pz = (z: number) => (z - z0) * scale;
  const inView = (c: ChunkData) => (c.cx + 1) * CHUNK > x0 && c.cx * CHUNK < x1 && (c.cz + 1) * CHUNK > z0 && c.cz * CHUNK < z1;
  const shown = chunks.filter(inView);
  for (const c of shown) {
    c.tiles.forEach((t, k) => {
      const x = c.cx * CHUNK + (k % CHUNK);
      const z = c.cz * CHUNK + Math.floor(k / CHUNK);
      let color = SURFACE_COLORS[t[1]] ?? rgb("#ff00ff");
      // Hills lighter, as the sun would have them.
      if (!isBlocked(t)) color = color.map((v) => Math.min(255, v + t[0] * 0.6)) as [number, number, number];
      else if (t[1] !== "sea" && t[1] !== "shallows" && t[1] !== "stream" && t[1] !== "bog") color = darker(color, 0.8);
      p.fill(px(x), pz(z), scale, scale, color);
      if (zones) {
        const tier = tierAt(world, x, z);
        if (tier > 0) p.fill(px(x), pz(z), scale, scale, TIER_COLORS[tier]!, 0.35);
      }
    });
  }
  for (const c of shown) {
    for (const prop of c.props) {
      const x = px(prop.x);
      const z = pz(prop.z);
      const to = prop.args?.to as [number, number] | undefined;
      if (TREE.has(prop.id)) p.fill(x - scale * 0.4, z - scale * 0.4, Math.max(1, scale * 0.8), Math.max(1, scale * 0.8), rgb("#1e3a18"));
      else if (prop.id === "wall-run" && to) p.fill(Math.min(x, px(to[0])) - scale / 2, Math.min(z, pz(to[1])) - scale / 2, Math.abs(px(to[0]) - x) + scale, Math.abs(pz(to[1]) - z) + scale, rgb("#5a5a62"));
      else if (prop.id === "wall-tower" || prop.id === "gatehouse") p.fill(x - scale, z - scale, scale * 2, scale * 2, rgb("#45454c"));
      else if ((prop.id === "hedgerow" || prop.id === "ruined-wall") && to) p.fill(Math.min(x, px(to[0])) - scale / 2, Math.min(z, pz(to[1])) - scale / 2, Math.abs(px(to[0]) - x) + scale, Math.abs(pz(to[1]) - z) + scale, rgb("#2e4a22"));
      else if ((prop.id === "bridge" || prop.id === "pier") && to) p.fill(x, z, px(to[0]) - x, pz(to[1]) - z, rgb("#8a6a48"));
      else if (prop.args?.w !== undefined) p.fill(x, z, (prop.args.w as number) * scale, (prop.args.d as number) * scale, rgb("#d040d0"));
      else if (scale >= 3) p.fill(x - scale * 0.3, z - scale * 0.3, scale * 0.6, scale * 0.6, rgb("#303030"));
    }
    for (const b of c.buildings) {
      const roof = STYLE_ROOF[b.style] ?? rgb("#b0503a");
      p.fill(px(b.x), pz(b.z), b.w * scale, b.d * scale, b.interior ? roof : darker(roof, 0.75));
      if (scale >= 3) {
        // The front edge, lighter, so the way a building faces shows.
        const front = [[0, b.d - 0.25, b.w, 0.25], [0, 0, 0.25, b.d], [0, 0, b.w, 0.25], [b.w - 0.25, 0, 0.25, b.d]][b.rot]!;
        p.fill(px(b.x + front[0]!), pz(b.z + front[1]!), front[2]! * scale, front[3]! * scale, rgb("#f0e0b0"));
      }
      if (b.door) p.fill(px(b.door[0]), pz(b.door[1]), scale, scale, rgb("#ffffff"));
    }
    for (const n of c.npcs) p.fill(px(n.x), pz(n.z), scale, scale, rgb("#00e0ff"));
    for (const e of c.entrances) p.fill(px(e.x) - scale, pz(e.z) - scale, scale * 3, scale * 3, rgb("#ff40ff"));
    for (const ch of c.chests) p.fill(px(ch.x), pz(ch.z), scale, scale, rgb("#ffd700"));
    if (zones || scale >= 3) {
      for (const s of c.spawns) p.ring(px(s.x) + scale / 2, pz(s.z) + scale / 2, Math.max(1, scale), TIER_COLORS[s.tier]!);
      for (const m of c.waymarkers) p.fill(px(m.x) - 1, pz(m.z) - 1, scale + 2, scale + 2, darker(TIER_COLORS[m.tier]!, 0.7));
    }
  }
  for (const f of world.ferries) for (const [x, z] of f.lane) p.fill(px(x), pz(z), scale, scale, rgb("#80ffff"), 0.6);
  for (const pitch of world.pitches) p.ring(px(pitch.x) + scale / 2, pz(pitch.z) + scale / 2, scale * 1.5, rgb("#ff8000"));
  if (zones) {
    for (const d of dungeons) {
      const [x, z] = d.entrance;
      p.fill(px(x) - 3, pz(z) - 3, 7, 7, d.waystone ? rgb("#40c0ff") : rgb("#ffffff"));
      p.fill(px(x) - 1, pz(z) - 1, 3, 3, TIER_COLORS[d.tier]!);
    }
  }
  return p;
}

// A crop of the world for a closer look: `npm run world:map -- <out-dir> crop x0 z0 x1 z1 [scale]`.
if (process.argv[3] === "crop") {
  const [x0, z0, x1, z1, scale] = process.argv.slice(4).map(Number);
  writeFileSync(join(out, `crop-${x0}-${z0}.png`), draw(x0!, z0!, x1!, z1!, scale || 3).png());
  process.exit(0);
}
writeFileSync(join(out, "world.png"), draw(0, 0, W, H, 1).png());
writeFileSync(join(out, "zones.png"), draw(0, 0, W, H, 1, true).png());
for (const t of world.towns) {
  const r = t.radius + 10;
  const scale = t.kind === "capital" ? 3 : 4;
  writeFileSync(join(out, `town-${t.id}.png`), draw(t.center[0] - r, t.center[1] - r, t.center[0] + r + 1, t.center[1] + r + 1, scale).png());
}
console.log(`world-map.ts: ${2 + world.towns.length} pictures in ${out}`);
