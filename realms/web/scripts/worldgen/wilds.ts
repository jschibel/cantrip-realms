// The wilds between the towns: dungeon entrances and mage towers with their waystones and spell tables, fields round
// the towns of the plains, the scenery of each region, a pass that joins every open tile to the rest of the world (or
// fills a pocket nobody could reach), then the spawn points by tier, chests, the waymarkers where the tier rises, and the
// few heartblooms of the wilds.

import type { ChestData, NpcData, Region, SpawnData, Theme, WaymarkerData, Zones } from "../../src/world/format";
import { BLOCKED, CHUNK, HEARTBLOOM_APART, HEARTBLOOM_REGROWTH, MAX_TIER, RAMP, chunkKey } from "../../src/world/format";
import type { Footprint } from "./buildings";
import { S } from "./ids";
import { type Land, Use, between, pick, randomFor, shuffle, texel } from "./land";
import type { Biome, DungeonLayout, Layout } from "./layout";
import { biomeOf, woodsNoise } from "./terrain";
import { safeToBlock } from "./towns";

/** A dungeon's way in, by theme: the prop drawn over its footprint, and the footprint's size across its front and deep. */
const ENTRANCES: Record<Theme, { prop: string; size: readonly [number, number] }> = {
  caves: { prop: "cave-mouth", size: [6, 4] },
  castle: { prop: "castle-gate", size: [9, 7] },
  tower: { prop: "mage-tower", size: [6, 6] },
  crypt: { prop: "crypt-door", size: [6, 5] },
  hollow: { prop: "root-hollow", size: [7, 5] },
  foundry: { prop: "foundry-gate", size: [9, 6] },
  portal: { prop: "phyrexian-portal", size: [8, 4] },
};

export interface Site {
  readonly plan: DungeonLayout;
  /** The entrance tile: walked onto, it starts a run. */
  readonly entrance: number;
}

/** The footprint of something whose front's middle opens onto `door`, facing `rot`. */
function footprintBefore(door: readonly [number, number], rot: number, wide: number, deep: number): Footprint {
  const [dx, dz] = door;
  const h = Math.floor(wide / 2);
  const f =
    rot === 0
      ? { x: dx - h, z: dz - deep, w: wide, d: deep, rot }
      : rot === 2
        ? { x: dx - (wide - 1 - h), z: dz + 1, w: wide, d: deep, rot }
        : rot === 1
          ? { x: dx + 1, z: dz - (wide - 1 - h), w: deep, d: wide, rot }
          : { x: dx - deep, z: dz - h, w: deep, d: wide, rot };
  return { ...f, door };
}

/**
 * Stands a dungeon's way in where its plan says, as near as the land allows: its structure facing toward `toward` (a
 * town) but never north, away from the camera; the entrance tile before it; the antechamber's spell table beside it, and
 * a mage tower's waystone.
 */
export function placeDungeon(land: Land, plan: DungeonLayout, npcs: NpcData[], toward: readonly [number, number]): Site {
  const [wx, wz] = plan.at;
  const good = (x: number, z: number) => {
    for (const j of land.rect(x - 8, z - 8, x + 8, z + 8)) {
      if (land.isSea(j) || land.town[j] !== 0 || land.use[j] !== Use.Wild) return false;
    }
    return land.inside(x - 8, z - 8) && land.inside(x + 8, z + 8);
  };
  let at: [number, number] | null = null;
  for (let r = 0; r < 120 && !at; r++) {
    for (let dz = -r; dz <= r && !at; dz++) {
      for (let dx = -r; dx <= r && !at; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (good(wx + dx, wz + dz)) at = [wx + dx, wz + dz];
      }
    }
  }
  if (!at) throw new Error(`no ground for ${plan.id} near ${plan.at.join(",")}`);
  const e = land.idx(at[0], at[1]);
  const floor = plan.theme === "portal" ? S["phyrexian-ground"] : plan.theme === "foundry" ? S.ash : plan.theme === "crypt" ? S.mud : null;
  for (const i of land.disc(at[0], at[1], 8)) {
    const s = land.surface[i]!;
    const dry = land.isWater(i) || !land.open(i) ? S.dirt : s;
    land.clear(i, floor ?? dry);
    land.height[i] = land.height[e]!;
    land.use[i] = Use.Kept;
  }
  // Facing the town it is nearest, never north (its door would be behind it).
  const dx = toward[0] - at[0];
  const dz = toward[1] - at[1];
  const rot = Math.abs(dx) > Math.abs(dz) || dz < 0 ? (dx >= 0 ? 3 : 1) : 0;
  const { prop, size } = ENTRANCES[plan.theme];
  const f = footprintBefore(at, rot, size[0], size[1]);
  for (const i of land.rect(f.x, f.z, f.x + f.w - 1, f.z + f.d - 1)) {
    land.use[i] = Use.Building;
    land.block(i);
  }
  land.fixtures.push({ id: prop, x: f.x, z: f.z, rot, args: { w: f.w, d: f.d } });
  land.use[e] = Use.Door;
  land.unblock(e);
  // Beside the way in, along the front: the spell table, and a tower's waystone on the other side.
  const height = land.height[e]! / 16;
  // Two tiles either side of the door, along the front.
  const beside = (side: number): [number, number] => (rot % 2 === 0 ? [at[0] + side * 2, at[1]] : [at[0], at[1] + side * 2]);
  const object = (id: string, kind: NpcData["kind"], name: string, tile: [number, number], extra: Partial<NpcData> = {}) => {
    const i = land.idx(tile[0], tile[1]);
    land.use[i] = Use.Building;
    land.block(i);
    land.fixtures.push({ id: kind, x: tile[0] + 0.5, z: tile[1] + 0.5, rot });
    npcs.push({ id, x: tile[0], z: tile[1], kind, name, stand: [tile[0] + 0.5, height, tile[1] + 0.5], ...extra });
  };
  object(`${plan.id}-spell-table`, "spell-table", "Spell table", beside(-1));
  if (plan.waystone) object(`${plan.id}-waystone`, "waystone", `The waystone of ${plan.name.replace(/^The /, "the ")}`, beside(1), { tower: plan.id });
  return { plan, entrance: e };
}

// --- Scenery -------------------------------------------------------------------------------------------------------------

interface Dress {
  /** Trees, rocks and the rest, each as props by id; shares are of open wild tiles at full thickness of woods. */
  readonly trees: readonly string[];
  readonly treeShare: number;
  readonly rocks: readonly string[];
  readonly rockShare: number;
  readonly extras: readonly string[];
  readonly extraShare: number;
}

const DRESS: Record<Biome, Dress> = {
  plains: { trees: ["tree", "tree", "bush"], treeShare: 0.05, rocks: ["boulder"], rockShare: 0.006, extras: ["bush", "stump"], extraShare: 0.006 },
  heartland: { trees: ["tree", "bush"], treeShare: 0.04, rocks: ["boulder"], rockShare: 0.004, extras: ["bush"], extraShare: 0.004 },
  coast: { trees: ["pine", "bush", "tree"], treeShare: 0.04, rocks: ["boulder", "boulder", "crystal"], rockShare: 0.012, extras: ["reeds", "ruined-wall"], extraShare: 0.006 },
  swamp: { trees: ["dead-tree", "swamp-tree", "swamp-tree", "mushroom"], treeShare: 0.12, rocks: ["boulder", "bones"], rockShare: 0.006, extras: ["reeds", "mushroom", "bones"], extraShare: 0.03 },
  volcanic: { trees: ["dead-tree", "pine"], treeShare: 0.02, rocks: ["boulder", "boulder"], rockShare: 0.04, extras: ["bones"], extraShare: 0.004 },
  forest: { trees: ["tree", "tree", "tree", "pine"], treeShare: 0.3, rocks: ["boulder", "mushroom"], rockShare: 0.01, extras: ["bush", "mushroom", "stump", "bush"], extraShare: 0.04 },
  waste: { trees: ["dead-tree"], treeShare: 0.008, rocks: ["boulder", "boulder", "bones"], rockShare: 0.03, extras: ["bones", "ruined-wall"], extraShare: 0.006 },
  mountains: { trees: ["pine", "pine", "dead-tree"], treeShare: 0.06, rocks: ["boulder"], rockShare: 0.04, extras: ["stump"], extraShare: 0.004 },
  tundra: { trees: ["pine", "pine", "dead-tree"], treeShare: 0.035, rocks: ["boulder", "ice-rock"], rockShare: 0.02, extras: ["bones"], extraShare: 0.003 },
};

/** Regions whose woods are their own: Llanowar's giant trees, Skyshroud's and Keld's pines, Orvada's crystals. */
const REGION_TREES: Record<string, readonly string[]> = {
  llanowar: ["tree", "tree", "great-tree", "tree", "great-tree", "pine"],
  skyshroud: ["pine", "pine", "tree"],
  durkwood: ["tree", "pine", "dead-tree", "tree"],
  amjad: ["dead-tree", "swamp-tree", "mushroom"],
};

/** Fields round the towns of the plains: ploughland and wheat in hedged squares (Benalia's farmland, design.md A6). */
export function fields(land: Land, layout: Layout): void {
  const random = randomFor(layout.seed, "fields");
  const farming = new Set(["plains", "heartland"]);
  for (const town of layout.towns) {
    const region = layout.regions.findIndex((r) => r.id === town.region);
    if (!farming.has(layout.regions[region]?.biome ?? "")) continue;
    const [cx, cz] = town.at;
    const count = town.kind === "capital" ? 46 : town.kind === "town" ? 28 : 12;
    let made = 0;
    for (let n = 0; n < count * 4 && made < count; n++) {
      const angle = random() * Math.PI * 2;
      const reach = town.radius + 10 + random() * (town.kind === "village" ? 40 : 70);
      const w = between(random, 10, 22);
      const d = between(random, 8, 15);
      const x0 = Math.round(cx + Math.cos(angle) * reach - w / 2);
      const z0 = Math.round(cz + Math.sin(angle) * reach - d / 2);
      const tiles = land.rect(x0 - 1, z0 - 1, x0 + w, z0 + d);
      if (tiles.length !== (w + 2) * (d + 2)) continue;
      if (!tiles.every((i) => land.use[i] === Use.Wild && land.open(i) && !land.isWater(i) && farming.has(biomeOf(layout, land.region[i]!)))) continue;
      const crop = random() < 0.5 ? S.furrows : S.wheat;
      for (const i of land.rect(x0, z0, x0 + w - 1, z0 + d - 1)) {
        land.clear(i, crop);
        land.use[i] = Use.Field;
      }
      // A hedgerow along its north edge with a gap to walk through, and along its west edge now and then.
      const gap = x0 + between(random, 2, w - 4);
      for (const [a, b] of [[x0, gap - 1], [gap + 2, x0 + w - 1]] as const) {
        if (b < a) continue;
        for (let x = a; x <= b; x++) {
          land.use[land.idx(x, z0 - 1)] = Use.Field;
          land.block(land.idx(x, z0 - 1));
        }
        land.fixtures.push({ id: "hedgerow", x: a + 0.5, z: z0 - 0.5, seed: between(random, 0, 15), args: { to: [b + 0.5, z0 - 0.5] } });
      }
      if (random() < 0.4) {
        const gz = z0 + between(random, 1, d - 3);
        for (const [a, b] of [[z0, gz - 1], [gz + 2, z0 + d - 1]] as const) {
          if (b < a) continue;
          for (let z = a; z <= b; z++) {
            land.use[land.idx(x0 - 1, z)] = Use.Field;
            land.block(land.idx(x0 - 1, z));
          }
          land.fixtures.push({ id: "hedgerow", x: x0 - 0.5, z: a + 0.5, seed: between(random, 0, 15), args: { to: [x0 - 0.5, b + 0.5] } });
        }
      }
      if (random() < 0.3) {
        const i = land.idx(x0 + w - 2, z0 + d - 2);
        land.put(i, { id: "hay-bale", x: x0 + w - 1.5, z: z0 + d - 1.5 });
      }
      made++;
    }
  }
}

/** Scenery over the wilds: woods thicken and thin by a noise, so there are forests and clearings. */
export function dress(land: Land, layout: Layout): void {
  const random = randomFor(layout.seed, "dress");
  const woods = woodsNoise(layout.seed);
  const near: number[] = [];
  for (let i = 0; i < land.size; i++) {
    if (land.use[i] !== Use.Wild || !land.open(i) || land.town[i] !== 0) continue;
    const s = land.surface[i]!;
    if (s === S.sand || s === S.road || s === S.planks || s === S.ice) continue;
    const x = land.xOf(i);
    const z = land.zOf(i);
    const region = layout.regions[land.region[i]!]!;
    const style = DRESS[region.biome];
    const trees = REGION_TREES[region.id] ?? style.trees;
    const thick = 0.2 + 2.4 * Math.max(0, woods(x, z) - 0.35);
    const wet = land.n4(i, near).some((j) => land.isWater(j));
    const roll = random();
    const prop = (id: string, blocks = true, big = 0) =>
      land.put(i, { id, x: texel(x + 0.5 + (random() - 0.5) * 0.3), z: texel(z + 0.5 + (random() - 0.5) * 0.3), seed: between(random, 0, 15), ...(big ? { scale: texel(0.8 + random() * big) } : {}) }, blocks);
    if (wet && roll < 0.25) prop("reeds", false);
    else if (roll < style.treeShare * thick) prop(pick(random, trees), true, 0.45);
    else if (roll < style.treeShare * thick + style.rockShare) prop(pick(random, style.rocks), true, 0.5);
    else if (roll < style.treeShare * thick + style.rockShare + style.extraShare) {
      const id = pick(random, style.extras);
      if (id === "ruined-wall") {
        const len = between(random, 2, 5);
        if (land.rect(x, z, x + len - 1, z).every((j) => land.use[j] === Use.Wild && land.open(j))) {
          for (const j of land.rect(x, z, x + len - 1, z)) land.block(j);
          land.fixtures.push({ id, x: x + 0.5, z: z + 0.5, args: { to: [x + len - 0.5, z + 0.5] } });
        }
      } else prop(id, id !== "reeds" && id !== "bones" && id !== "stump", 0);
    }
  }
}

// --- One world -----------------------------------------------------------------------------------------------------------

/**
 * Every open tile joins the world (the lint walks it all from every inn): a pocket too small to matter is filled in, a
 * bigger stretch - an island, a valley walled by mountains, a yard behind a row of houses - gets a way through to the
 * rest: a ford, a pass, a gap.
 */
export function connect(land: Land, from: number, step = 12): { filled: number; joined: number } {
  const { label, tiles } = land.pieces(from);
  let filled = 0;
  let joined = 0;
  const important = (i: number) => {
    const u = land.use[i]!;
    return u === Use.Door || u === Use.Road || u === Use.Street || u === Use.Dock;
  };
  const carvable = (i: number) => {
    const u = land.use[i]!;
    if (u === Use.Wall || u === Use.Building || u === Use.Door) return false;
    if (land.surface[i] === S.sea) return false;
    return true;
  };
  const came = new Int32Array(land.size);
  const seen = new Uint8Array(land.size);
  const queue = new Int32Array(land.size);
  const near: number[] = [];
  for (let k = 1; k < tiles.length; k++) {
    const part = tiles[k]!;
    if (label[part[0]!] === 0) continue;
    if (part.length < 400 && !part.some(important)) {
      for (const i of part) {
        land.block(i);
        label[i] = -1;
      }
      filled++;
      continue;
    }
    // The shortest way out across what blocks, to the world.
    seen.fill(0);
    let head = 0;
    let tail = 0;
    for (const i of part) {
      seen[i] = 1;
      came[i] = -1;
      queue[tail++] = i;
    }
    let reached = -1;
    while (head < tail && reached < 0) {
      const i = queue[head++]!;
      for (const n of land.n4(i, near)) {
        if (seen[n] || !carvable(n)) continue;
        seen[n] = 1;
        came[n] = i;
        if (label[n] === 0) {
          reached = n;
          break;
        }
        queue[tail++] = n;
      }
    }
    if (reached < 0) {
      if (part.some(important)) throw new Error(`a stretch of ${part.length} tiles at ${land.xOf(part[0]!)},${land.zOf(part[0]!)} cannot be joined to the world: ${part.slice(0, 30).map((i) => `${land.xOf(i)},${land.zOf(i)}:${land.use[i]}/${land.surface[i]}`).join(" ")}`);
      for (const i of part) land.block(i);
      filled++;
      continue;
    }
    const cut: number[] = [reached];
    for (let i = came[reached]!; i !== -1; i = came[i]!) {
      cut.push(i);
      if (label[i] === k) break;
    }
    for (const i of cut.slice(1, -1)) {
      const s = land.surface[i]!;
      if (s === S.stream) {
        land.fixtures.push({ id: "stepping-stone", x: land.xOf(i) + 0.5, z: land.zOf(i) + 0.5 });
      } else if (s === S.shallows || s === S.bog) land.surface[i] = S.sand;
      else if (s === S.lava) land.surface[i] = S.ash;
      else if (land.height[i]! > 60) {
        land.surface[i] = S.scree;
      }
      land.decor.delete(i);
      land.unblock(i);
      if (land.use[i] === Use.Yard) land.use[i] = Use.Street;
      label[i] = 0;
    }
    // Graded from one end's level to the other's, a ramp wherever it climbs a level (terraces, land.ts).
    const from = land.height[cut[0]!]!;
    const to = land.height[cut[cut.length - 1]!]!;
    const levels = cut.map((_, k2) => (k2 === 0 ? from : k2 === cut.length - 1 ? to : Math.round((from + ((to - from) * k2) / (cut.length - 1)) / step) * step));
    for (let k2 = 1; k2 < cut.length - 1; k2++) if ((land.flags[cut[k2]!]! & RAMP) === 0) land.height[cut[k2]!] = levels[k2]!;
    for (let k2 = 1; k2 < cut.length; k2++) {
      const a = cut[k2 - 1]!;
      const b = cut[k2]!;
      if (land.passes(a, b)) continue;
      // Over a ledge: both a ramp, a quarter of the way up and down from their levels (one a ramp already keeps its own).
      const [low, high] = land.height[a]! < land.height[b]! ? [a, b] : [b, a];
      for (const t of [low, high]) {
        if (land.flags[t]! & RAMP) continue;
        land.height[t] = land.height[t]! + (t === low ? 1 : -1) * Math.round(step / 4);
        land.flags[t] = (land.flags[t]! & ~BLOCKED) | RAMP;
      }
    }
    for (const i of part) label[i] = 0;
    joined++;
  }
  return { filled, joined };
}

// --- What lives in the wilds ---------------------------------------------------------------------------------------------

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

/** The wanderers of a tier for a region: its own colors' first, any of the tier's if it has none. */
function poolFor(roster: readonly MobFile[], tier: number, region: Region | null): string[] {
  const tierMobs = wanderers(roster).filter((m) => m.tier === tier);
  if (tierMobs.length === 0) throw new Error(`the roster has no tier ${tier} mob that wanders`);
  const own = region ? tierMobs.filter((m) => (m.region !== undefined ? m.region === region : (m.loot?.colors ?? "").includes(region))) : tierMobs;
  return (own.length > 0 ? own : tierMobs).map((m) => m.id).sort();
}

export interface Placed {
  readonly spawns: SpawnData[];
  readonly chests: ChestData[];
  readonly waymarkers: WaymarkerData[];
}

const GOLD: Record<number, readonly [number, number]> = { 1: [50, 150], 2: [100, 250], 3: [180, 380], 4: [300, 500] };

/** Heartblooms in each tier's wilds (design.md A3b): eight across the realm. */
const HEARTBLOOMS_PER_TIER = 2;

/** Spawn points, chests and waymarkers, by tier, and the heartblooms. Nothing placed here cuts a way off. */
export function populate(land: Land, zones: Zones, roster: readonly MobFile[], seed: number, keepAway: readonly number[]): Placed {
  const random = randomFor(seed, "populate");
  const away = new Uint8Array(land.size);
  for (const k of keepAway) for (const i of land.disc(land.xOf(k), land.zOf(k), 9)) away[i] = 1;
  const cellOf = (i: number) => zones.grid[Math.floor(land.zOf(i) / zones.cell)]?.[Math.floor(land.xOf(i) / zones.cell)];
  const tierOf = (i: number) => zones.areas[cellOf(i) ?? 0]?.tier ?? 0;
  const regionOf = (i: number) => zones.areas[cellOf(i) ?? 0]?.region ?? null;
  const counts = new Map<string, number>();
  const nextId = (i: number, prefix = "") => {
    const k = chunkKey(Math.floor(land.xOf(i) / CHUNK), Math.floor(land.zOf(i) / CHUNK));
    const n = (counts.get(k + prefix) ?? 0) + 1;
    counts.set(k + prefix, n);
    return `${k}:${prefix}${n}`;
  };
  const near: number[] = [];
  const order = shuffle(Array.from({ length: land.size }, (_, i) => i), random);
  const wild = (i: number) => (land.use[i] === Use.Wild || land.use[i] === Use.Field) && land.town[i] === 0 && !land.townArea[i] && !away[i];

  // Spawns: on open wild ground of some tier, well apart.
  const taken = new Uint8Array(land.size);
  const spawns: SpawnData[] = [];
  for (const i of order) {
    if (!wild(i) || !land.open(i) || taken[i]) continue;
    const tier = tierOf(i);
    if (tier === 0) continue;
    if (land.steps(i, near).length < 6) continue;
    if (random() > 0.5) continue;
    for (const j of land.disc(land.xOf(i), land.zOf(i), 17)) taken[j] = 1;
    const pool = shuffle(poolFor(roster, tier, regionOf(i)), random);
    spawns.push({ id: "", x: land.xOf(i), z: land.zOf(i), mobs: pool.slice(0, Math.min(pool.length, 2 + Math.floor(random() * 2))).sort(), radius: 6, respawnSeconds: 600, tier });
  }
  // Every wanderer is met somewhere: one nobody drew joins the spawns of its tier (and its region's) with fewest mobs.
  const met = new Set(spawns.flatMap((s) => s.mobs));
  for (const m of wanderers(roster).sort((a, b) => a.id.localeCompare(b.id))) {
    if (met.has(m.id)) continue;
    const ofTier = spawns.filter((s) => s.tier === m.tier);
    const own = ofTier.filter((s) => regionOf(land.idx(s.x, s.z)) === (m.region ?? null));
    const options = (own.length > 0 ? own : ofTier).sort((a, b) => a.mobs.length - b.mobs.length || a.x - b.x || a.z - b.z).slice(0, 3);
    if (options.length === 0) throw new Error(`no spawn of tier ${m.tier} for ${m.id}`);
    for (const s of options) (s as { mobs: readonly string[] }).mobs = [...s.mobs, m.id].sort();
    met.add(m.id);
  }

  // Chests: on a tile of their own with open ground all round, far apart.
  const chestTaken = new Uint8Array(land.size);
  const chests: ChestData[] = [];
  for (const i of order) {
    if (!wild(i) || !land.open(i) || chestTaken[i] || land.use[i] === Use.Field) continue;
    const tier = tierOf(i);
    if (tier === 0 || random() > 0.03) continue;
    const ring = land.n8(i, near);
    if (ring.length !== 8 || !ring.every((n) => land.open(n) && land.use[n] === Use.Wild)) continue;
    if (spawns.some((s) => Math.abs(s.x - land.xOf(i)) < 5 && Math.abs(s.z - land.zOf(i)) < 5)) continue;
    for (const j of land.disc(land.xOf(i), land.zOf(i), 30)) chestTaken[j] = 1;
    land.block(i);
    chests.push({ id: "", x: land.xOf(i), z: land.zOf(i), gold: GOLD[tier]!, respawnSeconds: 86400 });
  }

  // Waymarkers: where the tier rises, a marker beside every road that crosses, and standing stones along the rest.
  const waymarkers: WaymarkerData[] = [];
  const markerTaken = new Uint8Array(land.size);
  const mark = (i: number, tier: number, spacing: number) => {
    if (markerTaken[i] || !land.open(i) || land.use[i] !== Use.Wild || land.town[i] !== 0 || land.townArea[i]) return false;
    if (tierOf(i) !== tier) return false;
    // At the rise: softer ground within two tiles.
    if (!land.rect(land.xOf(i) - 2, land.zOf(i) - 2, land.xOf(i) + 2, land.zOf(i) + 2).some((j) => tierOf(j) < tier)) return false;
    if (land.steps(i, near).length < 5 || !safeToBlock(land, i)) return false;
    if (land.n8(i, near).some((n) => land.use[n] === Use.Door)) return false;
    if (spawns.some((s) => s.x === land.xOf(i) && s.z === land.zOf(i))) return false;
    land.block(i);
    for (const j of land.disc(land.xOf(i), land.zOf(i), spacing)) markerTaken[j] = 1;
    waymarkers.push({ x: land.xOf(i), z: land.zOf(i), tier });
    return true;
  };
  const four: number[] = [];
  for (let i = 0; i < land.size; i++) {
    if (land.use[i] !== Use.Road) continue;
    const here = tierOf(i);
    if (here === 0) continue;
    for (const n of land.n4(i, four)) {
      const there = tierOf(n);
      if (there <= here || land.use[n] !== Use.Road) continue;
      // The marker stands on the harder side, just off the road.
      const x = land.xOf(n);
      const z = land.zOf(n);
      const options = land.rect(x - 3, z - 3, x + 3, z + 3).sort((p, q) => Math.hypot(land.xOf(p) - x, land.zOf(p) - z) - Math.hypot(land.xOf(q) - x, land.zOf(q) - z) || p - q);
      for (const b of options) if (land.use[b] === Use.Wild && mark(b, there, 8)) break;
    }
  }
  for (const i of order) {
    const here = tierOf(i);
    if (here === 0 || markerTaken[i] || land.use[i] !== Use.Wild) continue;
    const harder = land.n4(i, four).filter((n) => tierOf(n) > here);
    if (harder.length === 0 || random() < 0.6) continue;
    for (const n of harder) if (mark(n, tierOf(n), 26)) break;
  }

  // Heartblooms (design.md A3b): rare, a few in each tier's wilds, each alone in a clearing - an open, level tile with
  // nothing standing on it and open, level ground all round, off the roads and the fields - far from every other and from
  // the spawns and chests. Walked onto, not round: the tile stays open. Chosen in the populating order, rolling no dice,
  // so the rest of the world is as it was without them.
  const blooms: ChestData[] = [];
  const ring: number[] = [];
  const apart = (x: number, z: number, others: readonly { x: number; z: number }[], reach: number) => others.every((o) => Math.max(Math.abs(o.x - x), Math.abs(o.z - z)) >= reach);
  for (let tier = 1; tier <= MAX_TIER; tier++) {
    let grown = 0;
    for (const i of order) {
      if (grown >= HEARTBLOOMS_PER_TIER) break;
      if (tierOf(i) !== tier || !wild(i) || land.use[i] !== Use.Wild || !land.open(i) || land.decor.has(i) || (land.flags[i]! & RAMP) !== 0) continue;
      if (land.steps(i, ring).length !== 8 || !ring.every((n) => land.use[n] === Use.Wild && !land.decor.has(n) && (land.flags[n]! & RAMP) === 0)) continue;
      const x = land.xOf(i);
      const z = land.zOf(i);
      if (!apart(x, z, blooms, HEARTBLOOM_APART) || !apart(x, z, spawns, 6) || !apart(x, z, chests, 6)) continue;
      blooms.push({ id: "", x, z, heart: true, respawnSeconds: HEARTBLOOM_REGROWTH });
      grown++;
    }
  }

  const byPlace = <T extends { x: number; z: number }>(list: T[]) => list.sort((a, b) => a.z - b.z || a.x - b.x);
  return {
    spawns: byPlace(spawns).map((s) => ({ ...s, id: nextId(land.idx(s.x, s.z)) })),
    chests: [...byPlace(chests).map((c) => ({ ...c, id: nextId(land.idx(c.x, c.z), "c") })), ...byPlace(blooms).map((c) => ({ ...c, id: nextId(land.idx(c.x, c.z), "h") }))],
    waymarkers: byPlace(waymarkers),
  };
}
