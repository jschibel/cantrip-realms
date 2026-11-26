// The towns of layout.json at walking scale, each in a pocket of its own, before the travel map exists
// (`npx vite-node scripts/worldgen/town-preview.ts [town-id ...]`): every town built by the new generator (town/) on a
// setting made up from the canon (TOWN_SETTINGS below: what the travel map will say of where each stands), checked
// (town/check.ts throws on a rule broken), drawn from above into e2e/screenshots/world2/town-<id>.png, and written as a
// standalone version-2 world - world.json, the chunks where there is ground, the interiors - into realms/web/town-preview/
// (gitignored), which the game opens with `?world=towns&at=<town-id>`.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNK, type ChunkData, type InteriorData, type NpcData, type PropData, TILE, type TileData, type WorldData, chunkKey } from "../../../src/world/format";
import { formatRecord } from "../generate";
import { SURFACES } from "../ids";
import { Land } from "../land";
import { readLayout } from "../layout";
import { Picture, SURFACE_COLORS, rgb } from "../picture";
import { buildInterior } from "../rooms";
import { type BuiltTown, type TownSetting, buildTown, groundsSize } from "./index";
import type { InteriorSpec as OldInteriorSpec } from "../towns";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "..");
const plane = join(web, "..", "content", "dominaria");

/** Where each town stands, as the travel map will say: made up from the canon (the world revamp's brief). */
export const TOWN_SETTINGS: Readonly<Record<string, TownSetting>> = {
  "new-benalia": { biome: "plains", sea: [], river: "through", relief: 0.35, ways: [{ side: "south", to: "capashen-hold" }, { side: "north", to: "vess-estate" }, { side: "east", to: "llanowar" }, { side: "west", to: "avenant" }] },
  "capashen-hold": { biome: "plains", sea: ["west"], relief: 0.8, ways: [{ side: "north", to: "new-benalia" }, { side: "south", to: "serras-rest" }, { side: "east", to: "llanowar" }] },
  llanowar: { biome: "forest", sea: [], river: "east", relief: 0.3, ways: [{ side: "west", to: "new-benalia" }, { side: "south", to: "steelleaf-glade" }, { side: "east", to: "sursi" }] },
  "vess-estate": { biome: "swamp", sea: [], relief: 0.1, ways: [{ side: "south", to: "new-benalia" }, { side: "east", to: "cabal-crossing" }] },
  keld: { biome: "tundra", sea: ["south"], relief: 0.6, ways: [{ side: "north", to: "keldon-watch" }, { side: "east", to: "phyrexian-portal" }, { side: "west", to: "foriys" }] },
  "tolarian-academy": { biome: "coast", sea: ["west", "south"], relief: 0.3, ways: [{ side: "north", to: "denawa" }, { side: "east", to: "new-benalia" }] },
  "serras-rest": { biome: "plains", sea: [], relief: 0.3, ways: [{ side: "south", to: "sursi" }, { side: "west", to: "capashen-hold" }] },
  sursi: { biome: "plains", sea: [], relief: 0.5, ways: [{ side: "south", to: "llanowar" }, { side: "north", to: "serras-rest" }] },
  "steelleaf-glade": { biome: "forest", sea: [], river: "north", relief: 0.2, ways: [{ side: "south", to: "llanowar" }, { side: "east", to: "verdura-grove" }] },
  "cabal-crossing": { biome: "swamp", sea: [], relief: 0, ways: [{ side: "west", to: "vess-estate" }, { side: "east", to: "new-benalia" }] },
  "keldon-watch": { biome: "tundra", sea: ["north"], relief: 0.5, ways: [{ side: "south", to: "keld" }] },
  denawa: { biome: "coast", sea: ["east"], relief: 0.2, ways: [{ side: "south", to: "tolarian-academy" }] },
  avenant: { biome: "plains", sea: ["west"], relief: 0.2, ways: [{ side: "south", to: "new-benalia" }, { side: "east", to: "capashen-hold" }] },
  foriys: { biome: "highlands", sea: ["east"], relief: 0.9, ways: [{ side: "south", to: "keld" }, { side: "west", to: "sursi" }] },
  oneah: { biome: "forest", sea: ["south"], relief: 0.3, ways: [{ side: "north", to: "sursi" }, { side: "west", to: "verdura-grove" }] },
  "verdura-grove": { biome: "jungle", sea: [], relief: 0.2, ways: [{ side: "south", to: "steelleaf-glade" }] },
};

interface VendorFile {
  readonly id: string;
  readonly name: string;
  readonly town?: string;
  readonly exotic?: boolean;
}

export function readVendors(): VendorFile[] {
  return readdirSync(join(plane, "vendors")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(plane, "vendors", f), "utf8")) as VendorFile);
}

/** The pockets: each town's grounds in a grid, two empty chunks between any two. */
export function pockets(ids: readonly string[]): { size: [number, number]; origin: Map<string, [number, number]> } {
  const layout = readLayout();
  const origin = new Map<string, [number, number]>();
  const cols = 4;
  let x = 0;
  let z = 0;
  let rowDepth = 0;
  let width = 0;
  ids.forEach((id, k) => {
    const plan = layout.towns.find((t) => t.id === id)!;
    const [w, d] = groundsSize(plan);
    if (k > 0 && k % cols === 0) {
      x = 0;
      z += rowDepth + 64;
      rowDepth = 0;
    }
    origin.set(id, [x, z]);
    x += w + 64;
    width = Math.max(width, x);
    rowDepth = Math.max(rowDepth, d);
  });
  return { size: [width, z + rowDepth], origin };
}

/** Builds the towns named (all by default) into one Land. */
export function buildAll(ids?: readonly string[], seed?: number, lenient = false): { land: Land; towns: BuiltTown[]; size: [number, number] } {
  const layout = readLayout();
  const vendors = readVendors();
  const all = ids && ids.length > 0 ? ids : layout.towns.map((t) => t.id);
  const { size, origin } = pockets(all);
  const land = new Land(size[0], size[1]);
  const towns: BuiltTown[] = [];
  for (const id of all) {
    const index = layout.towns.findIndex((t) => t.id === id);
    const plan = layout.towns[index]!;
    const sold = vendors.filter((v) => v.town === id && !v.exotic).sort((a, b) => a.id.localeCompare(b.id));
    const exotic = vendors.find((v) => v.town === id && v.exotic) ?? null;
    const color = layout.regions.find((r) => r.id === plan.region)?.color ?? null;
    try {
      towns.push(buildTown(land, { plan, index, color, vendors: sold, exotic, setting: TOWN_SETTINGS[id]!, origin: origin.get(id)! }, seed ?? layout.seed, { lenient }));
    } catch (e) {
      if (!lenient) throw e;
      console.log(`FAILED ${(e as Error).message}`);
    }
  }
  return { land, towns, size };
}

// --- Pictures -----------------------------------------------------------------------------------------------------------

const TREES = new Set(["tree", "oak", "birch", "pine", "elf-tree", "great-tree", "giant-tree", "fruit-tree", "snowy-fir", "dead-tree", "mossy-dead-tree", "swamp-tree", "cypress", "palm", "lush-tree"]);
const ROOF: Record<string, [number, number, number]> = { benalish: rgb("#b0503a"), village: rgb("#c8a050"), llanowar: rgb("#6a8a3a"), urborg: rgb("#4a3a52"), morass: rgb("#4a3a52"), vess: rgb("#2a2a38"), keldon: rgb("#7a5a3a"), tolarian: rgb("#5a7ab8") };

/** A town's grounds from straight above, `scale` pixels a tile, over `[x0, z0, x1, z1]` (its grounds by default). */
export function picture(land: Land, t: BuiltTown, scale = 4, crop: readonly [number, number, number, number] = t.data.grounds): Picture {
  const [x0, z0, x1, z1] = crop;
  const p = new Picture((x1 - x0) * scale, (z1 - z0) * scale);
  const px = (x: number) => (x - x0) * scale;
  const pz = (z: number) => (z - z0) * scale;
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const i = land.idx(x, z);
      let c = SURFACE_COLORS[SURFACES[land.surface[i]!]!] ?? rgb("#ff00ff");
      c = c.map((v) => Math.min(255, v + land.height[i]! * 0.9)) as [number, number, number];
      const water = land.isWater(i);
      if (land.flags[i]! & 1 && !water) c = c.map((v) => v * 0.78) as [number, number, number];
      if (land.flags[i]! & 4) c = [240, 150, 60];
      p.fill(px(x), pz(z), scale, scale, c);
      // A bank's foot: darker where the tile to the north or west is higher.
      const n = land.inside(x, z - 1) ? land.height[land.idx(x, z - 1)]! : land.height[i]!;
      if (!water && n > land.height[i]! + 6) p.fill(px(x), pz(z), scale, Math.max(1, scale / 3), [40, 40, 40], 0.5);
    }
  }
  const props: PropData[] = [];
  for (const q of land.fixtures) if (q.x >= x0 && q.x < x1 && q.z >= z0 && q.z < z1) props.push(q);
  for (const [i, q] of land.decor) {
    const x = land.xOf(i);
    const z = land.zOf(i);
    if (x >= x0 && x < x1 && z >= z0 && z < z1) props.push(q);
  }
  for (const q of props) {
    const to = q.args?.to as [number, number] | undefined;
    if (TREES.has(q.id)) p.fill(px(q.x) - scale * 0.45, pz(q.z) - scale * 0.45, scale * 0.9, scale * 0.9, q.id === "fruit-tree" ? rgb("#4a7a28") : rgb("#1e3a18"));
    else if (to && ["wall-run", "hedgerow", "hedge", "palisade", "stone-wall", "railings", "fence", "picket-fence"].includes(q.id)) {
      const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - q.x, to[1] - q.z) * 2));
      const color = q.id === "wall-run" ? rgb("#5a5a62") : q.id === "palisade" ? rgb("#6a4a2a") : q.id === "stone-wall" || q.id === "railings" ? rgb("#8a8a90") : rgb("#2e4a22");
      const w = q.id === "wall-run" ? scale : Math.max(1, scale * 0.6);
      for (let s = 0; s <= steps; s++) p.fill(px(q.x + ((to[0] - q.x) * s) / steps) - w / 2, pz(q.z + ((to[1] - q.z) * s) / steps) - w / 2, w, w, color);
    } else if (q.id === "wall-tower" || q.id === "gatehouse") p.fill(px(q.x) - scale, pz(q.z) - scale, scale * 2, scale * 2, rgb("#45454c"));
    else if ((q.id === "bridge" || q.id === "pier") && to) p.fill(px(q.x), pz(q.z), (to[0] - q.x) * scale, (to[1] - q.z) * scale, rgb("#8a6a48"), 0.8);
    else p.fill(px(q.x) - scale * 0.3, pz(q.z) - scale * 0.3, scale * 0.6, scale * 0.6, rgb("#303030"));
  }
  return p;
}

export function drawBuildings(p: Picture, t: BuiltTown, x0: number, z0: number, scale: number, npcs: readonly NpcData[]): void {
  const px = (x: number) => (x - x0) * scale;
  const pz = (z: number) => (z - z0) * scale;
  for (const b of t.buildings) {
    const roof = ROOF[b.style] ?? rgb("#b0503a");
    p.fill(px(b.x), pz(b.z), b.w * scale, b.d * scale, b.interior ? roof : roof.map((v) => v * 0.72) as [number, number, number]);
    const front = [[0, b.d - 0.3, b.w, 0.3], [0, 0, 0.3, b.d], [0, 0, b.w, 0.3], [b.w - 0.3, 0, 0.3, b.d]][b.rot]!;
    p.fill(px(b.x + front[0]!), pz(b.z + front[1]!), front[2]! * scale, front[3]! * scale, rgb("#f0e0b0"));
    if (b.door) p.fill(px(b.door[0]), pz(b.door[1]), scale, scale, rgb("#ffffff"));
  }
  for (const n of npcs) p.fill(px(n.x) + 1, pz(n.z) + 1, scale - 2, scale - 2, rgb("#00e0ff"));
  for (const w of t.data.ways) {
    for (const [x, z] of w.exit) p.fill(px(x), pz(z), scale, scale, rgb("#ff40ff"));
    p.ring(px(w.inside[0]) + scale / 2, pz(w.inside[1]) + scale / 2, scale, rgb("#ff40ff"));
  }
  if (t.pitch) p.ring(px(t.pitch.x) + scale / 2, pz(t.pitch.z) + scale / 2, scale * 1.5, rgb("#ff8000"));
}

// --- The world's files ----------------------------------------------------------------------------------------------------

export function writeWorld(out: string, land: Land, towns: readonly BuiltTown[], size: [number, number]): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "chunks"), { recursive: true });
  mkdirSync(join(out, "interiors"), { recursive: true });
  const props: PropData[] = [...land.fixtures, ...land.decor.values()];
  const keyOf = (x: number, z: number) => chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  const by = <T>(list: readonly T[], at: (t: T) => readonly [number, number]) => {
    const m = new Map<string, T[]>();
    for (const t of list) {
      const [x, z] = at(t);
      const k = keyOf(Math.floor(x), Math.floor(z));
      let l = m.get(k);
      if (!l) m.set(k, (l = []));
      l.push(t);
    }
    return m;
  };
  const npcs = towns.flatMap((t) => t.npcs);
  const propsBy = by(props, (p) => [p.x, p.z]);
  const buildingsBy = by(towns.flatMap((t) => t.buildings), (b) => [b.x, b.z]);
  const npcsBy = by(npcs, (n) => [n.x, n.z]);
  const order = <T extends { x: number; z: number; id?: string }>(a: T, b: T) => a.z - b.z || a.x - b.x || (a.id ?? "").localeCompare(b.id ?? "");
  let chunks = 0;
  for (const t of towns) {
    const [gx0, gz0, gx1, gz1] = t.data.grounds;
    for (let cz = gz0 / CHUNK; cz < gz1 / CHUNK; cz++) {
      for (let cx = gx0 / CHUNK; cx < gx1 / CHUNK; cx++) {
        const k = chunkKey(cx, cz);
        const tiles: TileData[] = [];
        for (let z = cz * CHUNK; z < cz * CHUNK + CHUNK; z++) for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
          const i = land.idx(x, z);
          tiles.push([land.height[i]!, SURFACES[land.surface[i]!]!, land.flags[i]!]);
        }
        const chunk: ChunkData = { cx, cz, tiles, props: (propsBy.get(k) ?? []).sort(order), buildings: (buildingsBy.get(k) ?? []).sort(order), npcs: (npcsBy.get(k) ?? []).sort(order), spawns: [], entrances: [], waymarkers: [] };
        writeFileSync(join(out, "chunks", `${k}.json`), formatRecord(chunk as unknown as Record<string, unknown>, ["tiles", "props", "buildings", "npcs", "spawns", "entrances", "waymarkers"], { tiles: CHUNK }));
        chunks++;
      }
    }
  }
  const interiors: InteriorData[] = towns.flatMap((t) => t.interiors).map((r) => buildInterior(r as unknown as OldInteriorSpec));
  for (const r of interiors) writeFileSync(join(out, "interiors", `${r.id}.json`), formatRecord(r as unknown as Record<string, unknown>, ["tiles", "props", "npcs", "lights"], { tiles: r.w }));
  const cell = 16;
  const cols = Math.ceil(size[0] / cell);
  const rows = Math.ceil(size[1] / cell);
  const world: WorldData = {
    size,
    chunk: CHUNK,
    tile: TILE,
    seed: 0,
    regions: [],
    towns: towns.map((t) => t.data),
    inns: towns.map((t) => ({ id: `${t.data.id}-inn`, town: t.data.id, x: t.inn.x, z: t.inn.z, interior: t.inn.interior })),
    dungeons: [],
    roads: [],
    ferries: [],
    pitches: towns.flatMap((t) => (t.pitch ? [{ town: t.data.id, x: t.pitch.x, z: t.pitch.z }] : [])),
    zones: { cell, cols, rows, areas: [{ id: "none", name: "Town grounds", region: null, tier: 0 }], grid: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)) },
    overview: { cell: 8, legend: { a: "grass" }, rows: Array.from({ length: Math.ceil(size[1] / 8) }, () => "a".repeat(Math.ceil(size[0] / 8))) },
  };
  writeFileSync(join(out, "world.json"), `${JSON.stringify(world)}\n`);
  console.log(`town-preview: ${towns.length} towns, ${chunks} chunks, ${interiors.length} interiors in ${out}`);
}

