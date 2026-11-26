// The wilds of the travel map: dungeon entrances and mage towers with their spell tables and waystones, the peaks over
// the ranges' bands, the woods and the scatter of each biome, the farmland round Benalia's and Sursi's towns, a pass
// that joins every open tile to the rest of the world (or fills a pocket nobody could reach), then the spawn points by
// tier and the waymarkers where the tier rises. (The finds of the wilds - treasure chests, heartblooms - are none of the
// world's files: the server spawns them, by its zones.)
//
// Everything that stands on one tile and blocks it (a grove, a boulder, a signpost) stands alone: nothing else blocked
// in the eight tiles round it, so no scatter ever closes a way - a wood is walked through between its groves however
// thick it grows. The scatter is blue noise (fields.ts `poissonTiles`), its spacing and its chance by the biome and by
// how deep into a wood a tile lies (a distance field): sparse at a wood's edge, thick in its heart.

import { ENTRANCES, PROP_CATALOGUE, TRAVEL_ENTRANCES } from "../../src/art/props";
import type { NpcData, PropData, Region, SpawnData, Theme, WaymarkerData, Zones } from "../../src/world/format";
import { CHUNK, chunkKey } from "../../src/world/format";
import { fractal, poissonTiles } from "./fields";
import type { GeoBiome, Geography, XZ } from "./geography";
import { GEO_BIOMES } from "./geography";
import { S } from "./ids";
import { type Land, Use, between, hopPieces, hopSteps, randomFor, shuffle, texel } from "./land";
import type { DungeonLayout } from "./layout";
import type { Terrain } from "./terrain";

// --- Dungeons ------------------------------------------------------------------------------------------------------------

/**
 * Each dungeon theme's way in on the travel map: its entrance prop, the footprint it is drawn over (across its front and
 * deep: the art's TRAVEL_ENTRANCES, odd widths so the door is on a tile's middle), and its scale. The art fits an
 * entrance to its footprint and reads no `scale`; the one number per theme is kept here should it ever be wanted.
 */
export const ENTRANCE_ON_MAP: Readonly<Record<Theme, { readonly prop: string; readonly size: readonly [number, number]; readonly scale?: number }>> = Object.fromEntries(
  (Object.keys(ENTRANCES) as Theme[]).map((theme) => [theme, { prop: ENTRANCES[theme], size: TRAVEL_ENTRANCES[ENTRANCES[theme]] ?? [3, 2] }]),
) as Record<Theme, { prop: string; size: readonly [number, number]; scale?: number }>;

export interface Site {
  readonly plan: DungeonLayout;
  /** The entrance tile: walked onto, it starts a run. */
  readonly entrance: number;
}

/** The footprint of something whose front's middle opens onto `door`, facing `rot` (0 south, 1 west, 3 east). */
function footprintBefore(door: XZ, rot: number, wide: number, deep: number): { x: number; z: number; w: number; d: number } {
  const [dx, dz] = door;
  const h = Math.floor(wide / 2);
  return rot === 0
    ? { x: dx - h, z: dz - deep, w: wide, d: deep }
    : rot === 1
      ? { x: dx + 1, z: dz - h, w: deep, d: wide }
      : { x: dx - deep, z: dz - h, w: deep, d: wide };
}

/**
 * Stands a dungeon's way in on its site, within the 5-by-5 square of level ground the sketch keeps there: its entrance
 * prop over its blocked footprint, facing `toward` (where its road comes from) but never north, away from the camera;
 * the entrance tile before it; the spell table two tiles to one side along its front, and a mage tower's waystone two
 * to the other; the square round it kept clear.
 */
export function placeDungeon(land: Land, plan: DungeonLayout, at: XZ, toward: XZ, npcs: NpcData[], props: PropData[]): Site {
  const dx = toward[0] - at[0];
  const dz = toward[1] - at[1];
  const rot = Math.abs(dx) > Math.abs(dz) * 1.5 ? (dx >= 0 ? 3 : 1) : 0;
  const door: XZ = rot === 0 ? [at[0], at[1] + 1] : rot === 1 ? [at[0] - 1, at[1]] : [at[0] + 1, at[1]];
  const level = land.height[land.idx(at[0], at[1])]!;
  for (const i of land.rect(at[0] - 3, at[1] - 3, at[0] + 3, at[1] + 3)) {
    if (land.isSea(i)) continue;
    land.clear(i, land.isWater(i) ? S.dirt : land.surface[i]);
    land.height[i] = level;
    land.use[i] = Use.Kept;
  }
  const { prop, size } = ENTRANCE_ON_MAP[plan.theme];
  const f = footprintBefore(door, rot, size[0], size[1]);
  for (const i of land.rect(f.x, f.z, f.x + f.w - 1, f.z + f.d - 1)) {
    land.use[i] = Use.Building;
    land.block(i);
  }
  props.push({ id: prop, x: f.x, z: f.z, rot, args: { w: f.w, d: f.d } });
  const e = land.idx(door[0], door[1]);
  land.use[e] = Use.Door;
  land.unblock(e);
  const beside = (side: number): XZ => (rot === 0 ? [door[0] + side * 2, door[1]] : [door[0], door[1] + side * 2]);
  const object = (id: string, kind: NpcData["kind"], name: string, tile: XZ, extra: Partial<NpcData> = {}) => {
    const i = land.idx(tile[0], tile[1]);
    land.use[i] = Use.Building;
    land.block(i);
    props.push({ id: kind, x: tile[0] + 0.5, z: tile[1] + 0.5, rot });
    npcs.push({ id, x: tile[0], z: tile[1], kind, name, stand: [tile[0] + 0.5, level / 16, tile[1] + 0.5], ...extra });
  };
  object(`${plan.id}-spell-table`, "spell-table", "Spell table", beside(-1));
  if (plan.waystone) object(`${plan.id}-waystone`, "waystone", `The waystone of ${plan.name.replace(/^The /, "the ")}`, beside(1), { tower: plan.id });
  return { plan, entrance: e };
}

// --- The peaks ------------------------------------------------------------------------------------------------------------

/**
 * The ranges' bands crowned with peaks: from the crest outward, the biggest peak (5, 3 or 1 tiles square) whose square
 * lies all in the band where no peak's heart stands yet - so the peaks overlap at their skirts and the range reads as one
 * wall - then a peak of one tile on any band tile no peak's square covers. Each the higher the nearer the crest, by its
 * range's height; its kind the range's. The hills (ranges of height 1) get a scatter of low single peaks along their
 * crests, each alone (walked round). Returns the peaks.
 */
export function placePeaks(land: Land, terrain: Terrain, geo: Geography, seed: number, free: (i: number) => boolean): PropData[] {
  const random = randomFor(seed, "peaks");
  const out: PropData[] = [];
  const W = land.width;
  const heart = new Uint8Array(land.size);
  const covered = new Uint8Array(land.size);
  const bandTiles: number[] = [];
  for (let z = 0; z < terrain.H; z++) for (let x = 0; x < terrain.W; x++) if (terrain.band[z * W + x]) bandTiles.push(z * W + x);
  const jitter = new Float32Array(land.size);
  for (const i of bandTiles) jitter[i] = random();
  bandTiles.sort((a, b) => terrain.crest[b]! + jitter[b]! * 0.15 - (terrain.crest[a]! + jitter[a]! * 0.15) || a - b);
  const square = (i: number, half: number, test: (j: number) => boolean) => {
    for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) if (!test(i + dz * W + dx)) return false;
    return true;
  };
  const peak = (i: number, w: number) => {
    const k = terrain.band[i]! - 1;
    const m = geo.mountains[k]!;
    const tall = m.height === 3 ? 1.15 : 0.9;
    const h = Math.min(12, Math.round((0.9 * w + 1) * tall * (0.7 + 0.45 * terrain.crest[i]! + 0.2 * random()) * 10) / 10);
    out.push({ id: "peak", x: (i % W) + 0.5, z: Math.floor(i / W) + 0.5, seed: between(random, 0, 63), args: { w, h, kind: m.kind } });
    const half = (w - 1) / 2;
    const core = Math.max(0, half - 1);
    for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) covered[i + dz * W + dx] = 1;
    for (let dz = -core; dz <= core; dz++) for (let dx = -core; dx <= core; dx++) heart[i + dz * W + dx] = 1;
  };
  for (const i of bandTiles) {
    if (heart[i]) continue;
    const k = terrain.band[i];
    const inBand = (j: number) => terrain.band[j] === k;
    const fresh = (j: number) => !heart[j];
    if (square(i, 2, inBand) && square(i, 1, fresh) && random() < 0.85) peak(i, 5);
    else if (square(i, 1, inBand) && fresh(i)) peak(i, 3);
  }
  for (const i of bandTiles) if (!covered[i]) peak(i, 1);
  // The hills: a low peak here and there along their crests, alone.
  const taken = new Uint8Array(land.size);
  const order = shuffle(Array.from({ length: land.size }, (_, i) => i).filter((i) => terrain.hill[i]), random);
  for (const i of poissonTiles(W, land.depth, order, () => 3.2, (i) => (free(i) ? 0.55 : 0), taken, random)) {
    const m = geo.mountains[terrain.hill[i]! - 1]!;
    land.block(i);
    out.push({ id: "peak", x: (i % W) + 0.5, z: Math.floor(i / W) + 0.5, seed: between(random, 0, 63), args: { w: 1, h: Math.round((1.3 + random() * 0.8) * 10) / 10, kind: m.kind } });
  }
  return out;
}

// --- Woods and scatter ------------------------------------------------------------------------------------------------------

type GroveKind = "broadleaf" | "pine" | "snowpine" | "swamp" | "dead" | "palm" | "jungle" | "elfwood";

/** A region's own woods, by its id: Llanowar's giants, Skyshroud's snow pines, the Morass's drowned trees... */
const REGION_GROVES: Readonly<Record<string, readonly GroveKind[]>> = {
  llanowar: ["elfwood", "elfwood", "broadleaf", "elfwood", "broadleaf"],
  durkwood: ["broadleaf", "broadleaf", "pine"],
  "whispering-woods": ["broadleaf", "pine", "broadleaf"],
  skyshroud: ["snowpine"],
  keld: ["snowpine", "pine"],
  parma: ["snowpine"],
  caligo: ["swamp", "swamp", "dead"],
  amjad: ["swamp", "dead", "swamp"],
  verdura: ["jungle", "jungle", "palm"],
  shanodin: ["broadleaf", "broadleaf", "pine"],
  "smoke-mountains": ["pine"],
  waste: ["dead"],
  kush: ["broadleaf", "palm"],
};

/** Each biome's woods where its region has none of its own. */
const BIOME_GROVES: Readonly<Record<GeoBiome, readonly GroveKind[]>> = {
  heartland: ["broadleaf"],
  plains: ["broadleaf", "broadleaf", "pine"],
  coast: ["broadleaf", "pine"],
  swamp: ["swamp", "dead"],
  mountains: ["pine"],
  volcanic: ["dead"],
  forest: ["broadleaf", "broadleaf", "pine"],
  tundra: ["snowpine"],
  waste: ["dead"],
  desert: ["palm"],
  badlands: ["dead"],
  highlands: ["pine", "broadleaf"],
  jungle: ["jungle", "jungle", "palm"],
};

/** Each biome's lone groves (chance a tile, spacing), and its scatter of small things by id (chance, spacing). */
const SCATTER: Readonly<Record<GeoBiome, { readonly trees: number; readonly things: readonly string[]; readonly share: number }>> = {
  heartland: { trees: 0.03, things: ["bush", "bush", "boulder"], share: 0.012 },
  plains: { trees: 0.025, things: ["bush", "boulder"], share: 0.01 },
  coast: { trees: 0.02, things: ["boulder", "bush", "crystal"], share: 0.012 },
  swamp: { trees: 0.05, things: ["reeds", "mushroom", "reeds"], share: 0.03 },
  mountains: { trees: 0.04, things: ["boulder", "boulder"], share: 0.03 },
  volcanic: { trees: 0.008, things: ["boulder"], share: 0.03 },
  forest: { trees: 0.04, things: ["bush", "mushroom", "fern"], share: 0.02 },
  tundra: { trees: 0.025, things: ["ice-rock", "boulder", "boulder"], share: 0.007 },
  waste: { trees: 0.006, things: ["boulder", "stump"], share: 0.02 },
  desert: { trees: 0.003, things: ["boulder"], share: 0.006 },
  badlands: { trees: 0.004, things: ["boulder", "boulder"], share: 0.025 },
  highlands: { trees: 0.03, things: ["boulder", "bush"], share: 0.025 },
  jungle: { trees: 0.05, things: ["giant-fern", "fern", "bush"], share: 0.03 },
};

/** The scale small things stand at on the travel map: miniatures beside its peaks and groves. */
const SMALL = 0.6;

/**
 * The woods and the scatter of the travel map: groves by blue noise, their spacing and chance by the biome and the depth
 * into a wood or a swamp, copses here and there in the open country, their kind by the region's woods or the biome's;
 * then rocks, bushes, reeds and the like, a sparser blue noise. `free` says where a thing that blocks may stand (a
 * tile alone: open wild land with nothing blocked or walked-on round it). Returns how many groves and things it placed.
 */
export function scatter(land: Land, terrain: Terrain, geo: Geography, seed: number, free: (i: number) => boolean): { groves: number; things: number } {
  const random = randomFor(seed, "scatter");
  const W = land.width;
  const copse = fractal(`${seed}:copses`, 22, 3);
  const taken = new Uint8Array(land.size);
  const tiles: number[] = [];
  for (let z = 0; z < terrain.H; z++) for (let x = 0; x < terrain.W; x++) tiles.push(z * W + x);
  const order = shuffle(tiles.slice(), random);
  const biomeOf = (i: number) => GEO_BIOMES[terrain.biome[i]!]!;
  const deep = (i: number) => terrain.forest[i]!;
  const spread = fractal(`${seed}:grove-spread`, 7, 2);
  const radius = (i: number) => {
    const d = deep(i);
    // Never quite the closest packing, and never the same everywhere: no rows in a wood's heart.
    if (d > 0) return Math.max(1.6, 3.4 - d * 0.3) * (1.05 + 0.25 * Math.abs(spread(i % W, Math.floor(i / W))));
    if (terrain.swamp[i]! > 0) return 2.2;
    return copse(i % W, Math.floor(i / W)) > 0.32 ? 1.6 : 3.5;
  };
  const chance = (i: number) => {
    if (!free(i)) return 0;
    const d = deep(i);
    if (d > 0) return Math.min(0.9, 0.35 + d * 0.09);
    if (terrain.swamp[i]! > 0) return Math.min(0.5, 0.12 + terrain.swamp[i]! * 0.04);
    const base = SCATTER[biomeOf(i)].trees;
    return copse(i % W, Math.floor(i / W)) > 0.32 ? Math.min(0.8, base * 22) : base;
  };
  const groves = poissonTiles(W, land.depth, order, radius, chance, taken, random);
  for (const i of groves) {
    const region = geo.regions[land.region[i]!]!;
    const b = biomeOf(i);
    // A region's own woods in its woods; the biome's in the country round them (no elfwood out on Benalia's downs).
    const own = REGION_GROVES[region.id];
    let kinds = own && (b === "forest" || b === "jungle" || b === "swamp" || b === "tundra" || region.id === "waste" || region.id === "smoke-mountains") ? own : BIOME_GROVES[b];
    if (kinds.includes("palm") && terrain.inland[i]! > 10) kinds = kinds.filter((k) => k !== "palm").length > 0 ? kinds.filter((k) => k !== "palm") : kinds;
    const kind = kinds[Math.floor(random() * kinds.length)]!;
    const x = i % W;
    const z = Math.floor(i / W);
    land.put(i, { id: "grove", x: texel(x + 0.5 + (random() - 0.5) * 0.2), z: texel(z + 0.5 + (random() - 0.5) * 0.2), seed: between(random, 0, 63), args: { kind } });
  }
  // The small things: what blocks alone like a grove, what does not (reeds, ferns) anywhere open and wild.
  let things = 0;
  const order2 = shuffle(tiles.slice(), random);
  const thingAt = new Map<number, string>();
  const pickThing = (i: number) => {
    const b = biomeOf(i);
    const wet = land.n4(i).some((n) => land.isWater(n) && !land.isSea(n));
    const list = wet ? ["reeds", "reeds", ...SCATTER[b].things] : SCATTER[b].things;
    return list[Math.floor(random() * list.length)]!;
  };
  const placed = poissonTiles(W, land.depth, order2, () => 2.5, (i) => {
    if (land.use[i] !== Use.Wild || !land.open(i) || land.isWater(i) || terrain.reserved[i] || land.decor.has(i)) return 0;
    const id = pickThing(i);
    const blocks = PROP_CATALOGUE.get(id)?.footprint.blocks ?? true;
    if (blocks && !free(i)) return 0;
    thingAt.set(i, id);
    const wet = land.n4(i).some((n) => land.isWater(n) && !land.isSea(n));
    return SCATTER[biomeOf(i)].share * (wet ? 6 : 1) * (deep(i) > 0 ? 0.6 : 1);
  }, taken, random);
  for (const i of placed) {
    const id = thingAt.get(i)!;
    const x = i % W;
    const z = Math.floor(i / W);
    const small = id === "reeds" || id === "fern" ? {} : { scale: SMALL };
    land.put(i, { id, x: texel(x + 0.5), z: texel(z + 0.5), seed: between(random, 0, 15), ...small });
    things++;
  }
  return { groves: groves.length, things };
}

/**
 * The farmland round the towns of Benalia and Sursi: the open country within `reach` tiles of each icon cut into fields
 * (a Voronoi of seeds about six tiles apart, each cell wheat, furrows or left to grass), ending raggedly where the noise
 * says. Only the ground changes: the fields are walked.
 */
export function farmland(land: Land, terrain: Terrain, geo: Geography, seed: number, towns: readonly { id: string; at: XZ; kind: string }[]): number {
  const random = randomFor(seed, "farmland");
  const edge = fractal(`${seed}:farm-edge`, 9, 2);
  const farming = new Set(["benalia", "sursi"]);
  let made = 0;
  for (const t of towns) {
    const region = geo.towns[t.id]?.region;
    if (!region || !farming.has(region)) continue;
    const reach = t.kind === "capital" ? 26 : t.kind === "town" ? 20 : 14;
    const seeds: { x: number; z: number; crop: number }[] = [];
    for (let n = 0; n < reach * reach * 0.12; n++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * reach;
      seeds.push({ x: t.at[0] + Math.cos(a) * r, z: t.at[1] + Math.sin(a) * r, crop: random() < 0.42 ? S.wheat : random() < 0.75 ? S.furrows : S.meadow });
    }
    for (let z = t.at[1] - reach; z <= t.at[1] + reach; z++) {
      for (let x = t.at[0] - reach; x <= t.at[0] + reach; x++) {
        if (x < 0 || z < 0 || x >= terrain.W || z >= terrain.H) continue;
        const i = land.idx(x, z);
        if (land.use[i] !== Use.Wild || !land.open(i) || terrain.reserved[i] || terrain.band[i] || terrain.forest[i]! > 0) continue;
        const b = GEO_BIOMES[terrain.biome[i]!]!;
        if (b !== "heartland" && b !== "plains" && b !== "coast") continue;
        if (Math.hypot(x - t.at[0], z - t.at[1]) > reach * (0.75 + 0.3 * edge(x, z))) continue;
        let best = seeds[0]!;
        for (const s of seeds) if ((s.x - x) ** 2 + (s.z - z) ** 2 < (best.x - x) ** 2 + (best.z - z) ** 2) best = s;
        land.surface[i] = best.crop;
        land.use[i] = Use.Field;
        made++;
      }
    }
  }
  return made;
}

// --- One world --------------------------------------------------------------------------------------------------------------

/**
 * Every open tile of the travel map joins the world as one who hops walks it (land.ts `hopSteps`, with the ferries'
 * lanes as `links`): a pocket too small to matter is filled in; a bigger stretch - an isle the sketch gave no ferry, a
 * meadow walled by a range and a river - gets the cheapest way through to the rest: stepping stones over a river, a
 * dry path over a bog, a notch through a range's band (dearer through a great range's, never over the sea). `mine`
 * says which tiles are the travel map's. Returns what it did.
 */
export function connect(land: Land, terrain: Terrain, from: number, mine: (i: number) => boolean, links: ReadonlyMap<number, readonly number[]>): { filled: number; joined: number; cut: number[]; stranded: string[] } {
  const { label, tiles } = hopPieces(land, from, mine, links);
  const stranded: string[] = [];
  let filled = 0;
  let joined = 0;
  const cutAll: number[] = [];
  const important = (i: number) => {
    const u = land.use[i]!;
    return u === Use.Door || u === Use.Road || u === Use.Dock || u === Use.Kept;
  };
  const costOf = (i: number): number => {
    if (!mine(i)) return Infinity;
    const u = land.use[i]!;
    if (u === Use.Building || u === Use.Wall || u === Use.Door) return Infinity;
    if (land.isSea(i) || terrain.water[i] === 4 || terrain.water[i] === 2) return Infinity;
    if (land.open(i)) return 1;
    if (terrain.water[i] === 1) return 4;
    if (terrain.water[i] === 3) return 3;
    const k = terrain.band[i]!;
    if (k) return 8;
    if (land.decor.has(i)) return 2;
    return 6;
  };
  const dist = new Float64Array(land.size);
  const came = new Int32Array(land.size);
  const near: number[] = [];
  for (let k = 1; k < tiles.length; k++) {
    const part = tiles[k]!;
    if (label[part[0]!] === 0) continue;
    if (part.length < 48 && !part.some(important)) {
      for (const i of part) {
        land.block(i, false);
        label[i] = -1;
      }
      filled++;
      continue;
    }
    // Dijkstra from the piece out across what blocks, to the world.
    dist.fill(Infinity);
    const heap: [number, number][] = [];
    const push = (d: number, i: number) => {
      heap.push([d, i]);
      for (let c = heap.length - 1; c > 0; ) {
        const p = (c - 1) >> 1;
        if (heap[p]![0] <= heap[c]![0]) break;
        [heap[p], heap[c]] = [heap[c]!, heap[p]!];
        c = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let c = 0; ; ) {
          const l = 2 * c + 1;
          const r = l + 1;
          let m = c;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c]!, heap[m]!];
          c = m;
        }
      }
      return top;
    };
    for (const i of part) {
      dist[i] = 0;
      came[i] = -1;
      push(0, i);
    }
    let reached = -1;
    while (heap.length > 0) {
      const [d, i] = pop();
      if (d > dist[i]!) continue;
      if (label[i] === 0) {
        reached = i;
        break;
      }
      for (const n of land.n4(i, near)) {
        const c = costOf(n);
        if (c === Infinity || dist[i]! + c >= dist[n]!) continue;
        dist[n] = dist[i]! + c;
        came[n] = i;
        push(dist[n]!, n);
      }
    }
    if (reached < 0) {
      if (part.some(important)) {
        stranded.push(`a stretch of ${part.length} tiles at ${land.xOf(part[0]!)},${land.zOf(part[0]!)} cannot be joined to the world`);
        for (const i of part) label[i] = 0;
        continue;
      }
      for (const i of part) land.block(i, false);
      filled++;
      continue;
    }
    const cut: number[] = [];
    for (let i = came[reached]!; i !== -1 && label[i] !== k; i = came[i]!) cut.push(i);
    for (const i of cut) {
      if (terrain.water[i] === 1) {
        land.fixtures.push({ id: "stepping-stone", x: land.xOf(i) + 0.5, z: land.zOf(i) + 0.5, scale: SMALL });
      } else if (terrain.water[i] === 3) {
        land.surface[i] = S.mud;
        terrain.water[i] = 0;
      } else if (terrain.band[i]) {
        land.surface[i] = S.scree;
        terrain.band[i] = 0;
      }
      land.decor.delete(i);
      land.unblock(i);
      // Wild ground, so `settle` grades it down to a level a step from the land it joins.
      land.use[i] = Use.Wild;
      cutAll.push(i);
    }
    // (The way through is graded to a level a step by `settle`, after.)
    for (const i of part) label[i] = 0;
    for (const i of cut) label[i] = 0;
    joined++;
  }
  return { filled, joined, cut: cutAll, stranded };
}

// --- What lives in the wilds ------------------------------------------------------------------------------------------------

export interface MobFile {
  readonly id: string;
  readonly tier: number;
  readonly boss?: boolean;
  /** The region it roams, by color (interfaces.md, "Mobs"). */
  readonly region?: string;
  readonly loot?: { readonly colors?: string };
}

/** The mobs that wander: no boss, no dungeon warden, no tower's mage, none of the Portal's. */
export const wanderers = (roster: readonly MobFile[]) =>
  roster.filter((m) => !m.boss && !m.id.includes("warden") && !m.id.startsWith("mage-") && !m.id.startsWith("phyrexian-") && m.id !== "gitaxian-mindcutter");

/**
 * A dungeon's mob list, warden or boss as the layout names it (layout.ts): ids as they are, and the roster asked for the
 * rest - `@wanderers:2`, `@wanderers:2-3`, `@wanderer:3`, `@warden:2`.
 */
export function resolveMobs(roster: readonly MobFile[], region: Region | null, spec: string): string[] {
  const match = /^@(wanderers|wanderer|warden):(\d)(?:-(\d))?$/.exec(spec);
  if (!match) return [spec];
  const low = Number(match[2]);
  const high = Number(match[3] ?? match[2]);
  if (match[1] === "warden") return [`warden-${low}`];
  const all = wanderers(roster).filter((m) => m.tier >= low && m.tier <= high);
  const own = region ? all.filter((m) => m.region === region) : all;
  const pool = (own.length > 0 ? own : all).map((m) => m.id).sort();
  if (pool.length === 0) throw new Error(`the roster has no wanderer of tier ${low}-${high}`);
  return match[1] === "wanderer" ? [pool[0]!] : pool;
}

/** The wanderers of a tier for a region: its own colors' first, any of the tier's if it has none (a colorless region's). */
function poolFor(roster: readonly MobFile[], tier: number, region: Region | null): string[] {
  const tierMobs = wanderers(roster).filter((m) => m.tier === tier);
  if (tierMobs.length === 0) throw new Error(`the roster has no tier ${tier} mob that wanders`);
  const own = region ? tierMobs.filter((m) => (m.region !== undefined ? m.region === region : (m.loot?.colors ?? "").includes(region))) : tierMobs;
  return (own.length > 0 ? own : tierMobs).map((m) => m.id).sort();
}

export interface Placed {
  readonly spawns: SpawnData[];
  readonly waymarkers: WaymarkerData[];
}

/** The travel map's land tiles there are for every spawn (interfaces.md, "Spawns": about one a this many). */
export const LAND_PER_SPAWN = 3500;
/** How far a spawn's mobs wander from it, tiles. */
export const SPAWN_RADIUS = 4;

/**
 * Spawn points and waymarkers, by tier. Spawns: about one per LAND_PER_SPAWN tiles of land, blue noise over the open
 * wilds a mob can wander (its radius all walked ground of the world's piece, no cliff-locked pocket), never within 6
 * tiles of a main road in tier 1 country, within 10 of a town's icon or 8 of a place (`away`); every region big enough
 * gets one at least, at its heart; their mobs by region and tier from the roster, and every wanderer met somewhere.
 * Waymarkers: beside the roads where the tier rises along them, on the harder side, and a few standing stones along the
 * rest of each rise. Nothing placed here cuts a way off.
 */
export function populate(
  land: Land,
  terrain: Terrain,
  geo: Geography,
  zones: Zones,
  roster: readonly MobFile[],
  seed: number,
  opts: { readonly walked: (i: number) => boolean; readonly away: Uint8Array; readonly mainRoad: Float32Array; readonly free: (i: number) => boolean },
): Placed {
  const random = randomFor(seed, "populate");
  const W = land.width;
  const cellOf = (i: number) => zones.grid[Math.floor(land.zOf(i) / zones.cell)]?.[Math.floor(land.xOf(i) / zones.cell)];
  const tierOf = (i: number) => (land.xOf(i) < terrain.W && land.zOf(i) < terrain.H ? (zones.areas[cellOf(i) ?? 0]?.tier ?? 0) : 0);
  const regionOf = (i: number) => zones.areas[cellOf(i) ?? 0]?.region ?? null;
  const near: number[] = [];
  /** Whether a mob can wander round a tile: its disc open ground walked to, and wide enough. */
  const roomy = (i: number) => {
    const x = land.xOf(i);
    const z = land.zOf(i);
    let open = 0;
    let all = 0;
    for (const j of land.disc(x, z, SPAWN_RADIUS)) {
      all++;
      if (land.open(j) && opts.walked(j)) open++;
    }
    return open >= all * 0.7 && hopSteps(land, i, near).length >= 7;
  };
  const eligible = (i: number) => {
    if (land.use[i] !== Use.Wild && land.use[i] !== Use.Field) return false;
    if (!land.open(i) || !opts.walked(i) || opts.away[i] || terrain.reserved[i]) return false;
    const tier = tierOf(i);
    if (tier === 0) return false;
    if (tier === 1 && opts.mainRoad[i]! < 6) return false;
    return true;
  };
  const spacing = Math.sqrt(LAND_PER_SPAWN / 1.25);
  const taken = new Uint8Array(land.size);
  const chosen: number[] = [];
  // Every region big enough to hold one gets a spawn at its heart: the eligible tile farthest from its border.
  const byRegion = new Map<number, number[]>();
  for (let z = 0; z < terrain.H; z++) for (let x = 0; x < terrain.W; x++) {
    const i = z * W + x;
    if (terrain.mass[i]! < 0) continue;
    const r = land.region[i]!;
    let list = byRegion.get(r);
    if (!list) byRegion.set(r, (list = []));
    list.push(i);
  }
  for (const [r, list] of [...byRegion].sort((a, b) => a[0] - b[0])) {
    if (list.length < 400) continue;
    const mx = list.reduce((s, i) => s + land.xOf(i), 0) / list.length;
    const mz = list.reduce((s, i) => s + land.zOf(i), 0) / list.length;
    const options = list.filter((i) => eligible(i) && roomy(i) && land.region[i] === r).sort((a, b) => Math.hypot(land.xOf(a) - mx, land.zOf(a) - mz) - Math.hypot(land.xOf(b) - mx, land.zOf(b) - mz) || a - b);
    const best = options.find((i) => !chosen.some((c) => Math.hypot(land.xOf(c) - land.xOf(i), land.zOf(c) - land.zOf(i)) < spacing * 0.5));
    if (best === undefined) continue;
    chosen.push(best);
  }
  for (const i of chosen) taken[i] = 2;
  const order: number[] = [];
  for (let z = 0; z < terrain.H; z++) for (let x = 0; x < terrain.W; x++) order.push(z * W + x);
  shuffle(order, random);
  const rest = poissonTiles(W, land.depth, order, () => spacing, (i) => (eligible(i) && roomy(i) ? 0.04 : 0), taken, random);
  const all = [...chosen, ...rest];
  const spawns: SpawnData[] = all.map((i) => {
    const tier = tierOf(i);
    const pool = shuffle(poolFor(roster, tier, regionOf(i)), random);
    return { id: "", x: land.xOf(i), z: land.zOf(i), mobs: pool.slice(0, Math.min(pool.length, 2 + Math.floor(random() * 2))).sort(), radius: SPAWN_RADIUS, respawnSeconds: 600, tier };
  });
  // Every wanderer is met somewhere: one nobody drew joins the spawns of its tier (and its region's) with fewest mobs.
  const met = new Set(spawns.flatMap((s) => s.mobs));
  for (const m of wanderers(roster).sort((a, b) => a.id.localeCompare(b.id))) {
    if (met.has(m.id)) continue;
    const ofTier = spawns.filter((s) => s.tier === m.tier);
    const own = ofTier.filter((s) => regionOf(land.idx(s.x, s.z)) === (m.region ?? null));
    const options = (own.length > 0 ? own : ofTier).sort((a, b) => a.mobs.length - b.mobs.length || a.x - b.x || a.z - b.z).slice(0, 2);
    if (options.length === 0) throw new Error(`no spawn of tier ${m.tier} for ${m.id}`);
    for (const s of options) (s as { mobs: readonly string[] }).mobs = [...s.mobs, m.id].sort();
    met.add(m.id);
  }

  // Waymarkers: where the tier rises along a road, a marker beside it on the harder side; standing stones along the rest.
  const waymarkers: WaymarkerData[] = [];
  const markerTaken = new Uint8Array(land.size);
  const markAt = (i: number, tier: number, spacing2: number) => {
    if (markerTaken[i] || !opts.free(i) || tierOf(i) !== tier || opts.away[i]) return false;
    if (!land.rect(land.xOf(i) - 2, land.zOf(i) - 2, land.xOf(i) + 2, land.zOf(i) + 2).some((j) => tierOf(j) < tier && tierOf(j) > 0)) return false;
    if (spawns.some((s) => Math.abs(s.x - land.xOf(i)) <= 1 && Math.abs(s.z - land.zOf(i)) <= 1)) return false;
    land.block(i);
    land.use[i] = Use.Building;
    for (const j of land.disc(land.xOf(i), land.zOf(i), spacing2)) markerTaken[j] = 1;
    waymarkers.push({ x: land.xOf(i), z: land.zOf(i), tier });
    return true;
  };
  const four: number[] = [];
  for (let z = 0; z < terrain.H; z++) {
    for (let x = 0; x < terrain.W; x++) {
      const i = z * W + x;
      if (land.use[i] !== Use.Road) continue;
      const here = tierOf(i);
      if (here === 0) continue;
      for (const n of land.n4(i, four)) {
        const there = tierOf(n);
        if (there <= here || land.use[n] !== Use.Road) continue;
        const options = land.rect(land.xOf(n) - 3, land.zOf(n) - 3, land.xOf(n) + 3, land.zOf(n) + 3).sort((p, q) => Math.hypot(land.xOf(p) - land.xOf(n), land.zOf(p) - land.zOf(n)) - Math.hypot(land.xOf(q) - land.xOf(n), land.zOf(q) - land.zOf(n)) || p - q);
        for (const b of options) if (markAt(b, there, 10)) break;
      }
    }
  }
  const order3 = shuffle(order.slice(), random);
  for (const i of order3) {
    const here = tierOf(i);
    if (here === 0 || markerTaken[i] || land.use[i] !== Use.Wild) continue;
    const harder = land.n4(i, four).filter((n) => tierOf(n) > here);
    if (harder.length === 0 || random() < 0.85) continue;
    for (const n of harder) if (markAt(n, tierOf(n), 40)) break;
  }

  const byPlace = <T extends { x: number; z: number }>(list: T[]) => list.sort((a, b) => a.z - b.z || a.x - b.x);
  const counts = new Map<string, number>();
  const nextId = (x: number, z: number) => {
    const k = chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    return `${k}:${n}`;
  };
  return {
    spawns: byPlace(spawns).map((s) => ({ ...s, id: nextId(s.x, s.z) })),
    waymarkers: byPlace(waymarkers),
  };
}
