// The wilds between the towns: dungeon entrances and mage towers with their waystones, the scenery of each region,
// a last pass that joins every open hex to the rest of the world (or fills a pocket nobody could reach), then the
// spawn points by tier, chests, and the waymarkers where the tier changes.

import { type Hex, hex, toWorld } from "../../src/hex";
import { type ChestData, type NpcData, type PropData, type Region, type SpawnData, type Theme, type Zones, areaAt, chunkKey, CHUNK } from "../../src/world/schema";
import { Grid, HUB, SIZE, STEP, T, Use, angleOf, around, atAngle, disc, fbm, hexDistance, hexOf, idx, inside, noise, qOf, rOf, randomFor, safeToBlock, shuffle } from "./grid";
import type { Biome, DungeonLayout as DungeonPlan, Layout } from "./layout";
import { biomeOf } from "./terrain";
import { footprintOf, frontToward } from "./towns";

const SIZES: Record<Theme, readonly [number, number, number]> = {
  caves: [5, 4, 2.6],
  castle: [7.5, 6, 4.4],
  tower: [4.4, 4.4, 8.5],
  crypt: [5.6, 4.6, 3],
  hollow: [5.6, 4.6, 4.2],
  foundry: [7.4, 5.6, 3.6],
  portal: [6.4, 3.4, 5.6],
};

export interface Site {
  readonly plan: DungeonPlan;
  readonly entrance: Hex;
  readonly waystone?: Hex;
}

/** Stands a dungeon's way in where its plan says, as near as the land allows: the structure, the hex before it. */
export function placeDungeon(grid: Grid, plan: DungeonPlan, npcs: NpcData[], toward: Hex): Site {
  const want = hex(plan.at[0], plan.at[1]);
  const good = (i: number) => {
    if (grid.town[i] !== 0) return false;
    for (const j of disc(hexOf(i), 6)) {
      const t = grid.terrain[j]!;
      if (t === T["deep-water"] || grid.town[j] !== 0 || grid.use[j] !== Use.Wild) return false;
    }
    return true;
  };
  let at: Hex | null = null;
  for (let radius = 0; radius < 40 && !at; radius++) {
    for (const i of disc(want, radius)) {
      if (hexDistance(qOf(i), rOf(i), want.q, want.r) !== radius) continue;
      if (good(i)) {
        at = hexOf(i);
        break;
      }
    }
  }
  if (!at) throw new Error(`no ground for ${plan.id}`);
  const e = idx(at.q, at.r);
  // Clear the ground round it, filling water so the way in can be reached.
  for (const i of disc(at, 6)) {
    if (grid.terrain[i] === T.water || grid.terrain[i] === T.swamp || grid.terrain[i] === T.lava || grid.terrain[i] === T.mountain) {
      grid.terrain[i] = plan.theme === "foundry" ? T.ash : plan.theme === "crypt" ? T.mud : T.dirt;
    }
    grid.props.delete(i);
    grid.blocked[i] = 0;
    grid.height[i] = grid.height[e]!;
    grid.use[i] = Use.Kept;
  }
  const front = frontToward(angleOf(at, toward));
  const [across, deep, tall] = SIZES[plan.theme];
  const along = front === "x+" || front === "x-";
  const w = along ? deep : across;
  const d = along ? across : deep;
  const n = { "x+": [1, 0], "x-": [-1, 0], "z+": [0, 1], "z-": [0, -1] }[front];
  const p = toWorld(at);
  const extent = (along ? w : d) / 2 + 0.55;
  const anchor = nearestHex(p.x - n[0]! * extent, p.z - n[1]! * extent);
  const footprint = footprintOf(anchor, w, d).filter((i) => i !== e);
  for (const i of footprint) grid.blocked[i] = 1;
  grid.prop(idx(anchor.q, anchor.r), { kind: "entrance", style: plan.theme, w: round(w), d: round(d), h: tall, front, use: plan.id });
  grid.use[e] = Use.Door;
  // Beside the way in: the antechamber's spell table (interfaces.md), and a mage tower's waystone.
  const beside = (taken: number[]) =>
    around(e)
      .filter((i) => !footprint.includes(i) && grid.blocked[i] === 0 && !taken.includes(i))
      .map((i) => hexOf(i))
      .sort((a, b) => a.q - b.q || a.r - b.r)
      .find((h) => around(idx(h.q, h.r)).filter((i) => grid.blocked[i] === 0 && i !== e).length >= 3);
  const placed: number[] = [];
  let waystone: Hex | undefined;
  if (plan.waystone) {
    const spot = beside(placed);
    if (!spot) throw new Error(`${plan.id}: no room for the waystone`);
    grid.blocked[idx(spot.q, spot.r)] = 1;
    grid.use[idx(spot.q, spot.r)] = Use.Building;
    placed.push(idx(spot.q, spot.r));
    waystone = spot;
    npcs.push({ id: `${plan.id}-waystone`, q: spot.q, r: spot.r, kind: "waystone", tower: plan.id, name: `The waystone of ${plan.name.replace(/^The /, "the ")}` });
  }
  const table = beside(placed);
  if (!table) throw new Error(`${plan.id}: no room for the spell table`);
  grid.blocked[idx(table.q, table.r)] = 1;
  grid.use[idx(table.q, table.r)] = Use.Building;
  npcs.push({ id: `${plan.id}-spell-table`, q: table.q, r: table.r, kind: "spell-table", name: "Spell table" });
  return { plan, entrance: at, ...(waystone ? { waystone } : {}) };
}

const round = (v: number) => Math.round(v * 100) / 100;

function nearestHex(x: number, z: number): Hex {
  const q = (2 / 3) * x;
  const r = (-1 / 3) * x + (Math.sqrt(3) / 3) * z;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  if (Math.abs(rq - q) > Math.abs(rr - r) && Math.abs(rq - q) > Math.abs(rs - s)) rq = -rr - rs;
  else if (Math.abs(rr - r) > Math.abs(rs - s)) rr = -rq - rs;
  return hex(rq + 0, rr + 0);
}

interface Dress {
  readonly trees: readonly string[];
  readonly treeShare: number;
  readonly rocks: readonly string[];
  readonly rockShare: number;
  readonly extras: readonly string[];
  readonly extraShare: number;
}

const DRESS: Record<Biome, Dress> = {
  plains: { trees: ["tree", "tree", "bush"], treeShare: 0.06, rocks: ["rock", "boulder"], rockShare: 0.015, extras: ["bush", "fence"], extraShare: 0.01 },
  coast: { trees: ["pine", "bush"], treeShare: 0.04, rocks: ["rock", "crystal", "boulder"], rockShare: 0.02, extras: ["reeds", "ruin", "pillar"], extraShare: 0.01 },
  swamp: { trees: ["dead-tree", "dead-tree", "mushroom"], treeShare: 0.07, rocks: ["rock", "bones"], rockShare: 0.015, extras: ["reeds", "bones", "mushroom", "coffin"], extraShare: 0.025 },
  volcanic: { trees: ["dead-tree", "pine"], treeShare: 0.025, rocks: ["boulder", "rock", "rock"], rockShare: 0.06, extras: ["bones", "brazier"], extraShare: 0.004 },
  forest: { trees: ["tree", "tree", "pine", "tree"], treeShare: 0.2, rocks: ["rock", "mushroom"], rockShare: 0.015, extras: ["bush", "mushroom", "bush"], extraShare: 0.04 },
  heartland: { trees: ["tree", "bush"], treeShare: 0.035, rocks: ["rock"], rockShare: 0.008, extras: ["fence", "crate"], extraShare: 0.006 },
  mountains: { trees: ["pine", "pine", "dead-tree"], treeShare: 0.05, rocks: ["boulder", "rock"], rockShare: 0.05, extras: ["bones"], extraShare: 0.004 },
  tundra: { trees: ["pine", "dead-tree"], treeShare: 0.03, rocks: ["rock", "boulder", "crystal"], rockShare: 0.03, extras: ["bones"], extraShare: 0.004 },
};

/** Scenery over the wilds: woods thicken and thin by a noise, so there are forests and clearings. */
export function dress(grid: Grid, layout: Layout): void {
  const seed = layout.seed;
  const random = randomFor(seed, "dress");
  const woods = fbm(`${seed}:woods`, 30, 3);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  for (let q = 0; q < SIZE; q++) {
    for (let r = 0; r < SIZE; r++) {
      const i = idx(q, r);
      if (grid.use[i] !== Use.Wild || grid.blocked[i] || grid.town[i] !== 0) continue;
      const t = grid.terrain[i]!;
      if (t === T.sand || t === T.road || t === T.wood) continue;
      const style = DRESS[biomeOf(layout, grid.region[i]!)];
      const thick = 0.25 + 1.6 * Math.max(0, woods(q, r) - 0.3);
      const roll = random();
      if (roll < style.treeShare * thick) grid.prop(i, { kind: pick(style.trees) });
      else if (roll < style.treeShare * thick + style.rockShare) grid.prop(i, { kind: pick(style.rocks) });
      else if (roll < style.treeShare * thick + style.rockShare + style.extraShare) grid.prop(i, { kind: pick(style.extras) });
    }
  }
}

/**
 * Every open hex joins the world (the lint walks it all from every inn): a pocket too small to matter is filled in,
 * a bigger stretch - an island, a valley walled by mountains - gets a way through to the rest, a ford or a pass.
 */
export function connect(grid: Grid, from: number): { filled: number; joined: number } {
  const label = new Int32Array(SIZE * SIZE).fill(-1);
  const queue = new Int32Array(SIZE * SIZE);
  const near: number[] = [];
  const flood = (start: number, mark: number): number[] => {
    const found: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = mark;
    while (head < tail) {
      const i = queue[head++]!;
      found.push(i);
      for (const n of around(i, near)) {
        if (label[n] === -1 && grid.blocked[n] === 0) {
          label[n] = mark;
          queue[tail++] = n;
        }
      }
    }
    return found;
  };
  flood(from, 0);
  const others: number[][] = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (label[i] === -1 && grid.blocked[i] === 0) others.push(flood(i, others.length + 1));
  others.sort((a, b) => b.length - a.length);
  let filled = 0;
  let joined = 0;
  const passable = (i: number) => grid.use[i] !== Use.Wall && grid.use[i] !== Use.Building && (grid.town[i] === 0 || grid.use[i] === Use.Kept);
  const from2 = new Int32Array(SIZE * SIZE);
  for (const part of others) {
    const important = part.some((i) => grid.use[i] === Use.Door || grid.use[i] === Use.Road || grid.use[i] === Use.Street);
    if (part.length < 120 && !important) {
      for (const i of part) {
        grid.blocked[i] = 1;
        if (!grid.props.has(i) && !grid.isWater(i)) grid.prop(i, { kind: "bush" });
      }
      filled++;
      continue;
    }
    // The shortest way out across what blocks, to the world.
    const seen = new Uint8Array(SIZE * SIZE);
    let head = 0;
    let tail = 0;
    for (const i of part) {
      seen[i] = 1;
      from2[i] = -1;
      queue[tail++] = i;
    }
    let reached = -1;
    while (head < tail && reached < 0) {
      const i = queue[head++]!;
      for (const n of around(i, near)) {
        if (seen[n] || !passable(n)) continue;
        seen[n] = 1;
        from2[n] = i;
        if (label[n] === 0) {
          reached = n;
          break;
        }
        queue[tail++] = n;
      }
    }
    if (reached < 0) throw new Error(`a stretch of ${part.length} hexes cannot be joined to the world`);
    for (let i = from2[reached]!; i !== -1 && label[i] !== label[part[0]!]; i = from2[i]!) {
      const t = grid.terrain[i]!;
      if (t === T.water || t === T["deep-water"] || t === T.swamp) {
        grid.terrain[i] = T.sand;
        grid.height[i] = 0;
      } else if (t === T.lava) grid.terrain[i] = T.ash;
      else if (t === T.mountain || t === T.snow) {
        grid.terrain[i] = T.rock;
        grid.height[i] = Math.max(0, grid.height[i]! - STEP * 3);
      }
      grid.props.delete(i);
      grid.blocked[i] = 0;
      label[i] = 0;
    }
    for (const i of part) label[i] = 0;
    joined++;
  }
  return { filled, joined };
}

export interface MobFile {
  readonly id: string;
  readonly tier: number;
  readonly boss?: boolean;
  /** The region it roams, by color (interfaces.md, "Mobs"). */
  readonly region?: string;
  readonly loot?: { readonly colors?: string };
}

/** The mobs that wander: no boss, no dungeon warden, no tower's mage. */
export const wanderers = (roster: readonly MobFile[]) =>
  roster.filter((m) => !m.boss && !m.id.includes("warden") && !m.id.startsWith("mage-") && !m.id.startsWith("phyrexian-") && m.id !== "gitaxian-mindcutter");

/**
 * A dungeon's mob list, warden or boss as the layout names it (layout.ts): ids as they are, and the roster asked for
 * the rest - `@wanderers:2`, `@wanderers:2-3`, `@wanderer:3`, `@warden:2`.
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

/** Two or three mobs of a tier for a spawn in a region: its own colors' first, any of the tier's if it has none. */
export function mobsFor(roster: readonly MobFile[], tier: number, region: Region | null, random: () => number): string[] {
  const tierMobs = wanderers(roster).filter((m) => m.tier === tier);
  if (tierMobs.length === 0) throw new Error(`the roster has no tier ${tier} mob that wanders`);
  const own = region ? tierMobs.filter((m) => (m.region !== undefined ? m.region === region : (m.loot?.colors ?? "").includes(region))) : tierMobs;
  const pool = shuffle((own.length > 0 ? own : tierMobs).map((m) => m.id).sort(), random);
  return pool.slice(0, Math.min(pool.length, 2 + Math.floor(random() * 2))).sort();
}

export interface Placed {
  readonly spawns: SpawnData[];
  readonly chests: ChestData[];
  readonly markers: PropData[];
}

const GOLD: Record<number, readonly [number, number]> = { 1: [50, 150], 2: [100, 250], 3: [180, 380], 4: [300, 500] };

/** Spawn points, chests and waymarkers, by tier. Nothing placed here can cut a way off. */
export function populate(grid: Grid, zones: Zones, roster: readonly MobFile[], seed: number, keepAway: readonly Hex[]): Placed {
  const random = randomFor(seed, "populate");
  const away = new Uint8Array(SIZE * SIZE);
  for (const h of keepAway) for (const i of disc(h, 7)) away[i] = 1;
  const open = (q: number, r: number) => inside(q, r) && grid.blocked[idx(q, r)] === 0;
  const tierOf = (i: number) => areaAt(zones, hexOf(i))?.tier ?? 0;
  const regionOf = (i: number) => areaAt(zones, hexOf(i))?.region ?? null;
  const counts = new Map<string, number>();
  const nextId = (i: number, prefix = "") => {
    const k = chunkKey(Math.floor(qOf(i) / CHUNK), Math.floor(rOf(i) / CHUNK));
    const n = (counts.get(k + prefix) ?? 0) + 1;
    counts.set(k + prefix, n);
    return `${k}:${prefix}${n}`;
  };

  const order = shuffle(Array.from({ length: SIZE * SIZE }, (_, i) => i), random);
  const wild = (i: number) => grid.use[i] === Use.Wild && grid.town[i] === 0 && !away[i];

  // Spawns: on open wild ground of some tier, apart from each other.
  const taken = new Uint8Array(SIZE * SIZE);
  const spawns: SpawnData[] = [];
  for (const i of order) {
    if (!wild(i) || grid.blocked[i] || taken[i]) continue;
    const tier = tierOf(i);
    if (tier === 0) continue;
    if (around(i).filter((n) => grid.blocked[n] === 0).length < 4) continue;
    if (random() > 0.5) continue;
    for (const j of disc(hexOf(i), 10)) taken[j] = 1;
    spawns.push({ id: "", q: qOf(i), r: rOf(i), mobs: mobsFor(roster, tier, regionOf(i), random), radius: 4, respawnSeconds: 600, tier });
  }

  // Chests: on a blocked hex with open ground all round, far apart.
  const chestTaken = new Uint8Array(SIZE * SIZE);
  const chests: ChestData[] = [];
  for (const i of order) {
    if (!wild(i) || grid.blocked[i] || chestTaken[i] || taken[i] === 2) continue;
    const tier = tierOf(i);
    if (tier === 0 || random() > 0.04) continue;
    if (around(i).length !== 6 || !around(i).every((n) => grid.blocked[n] === 0 && grid.use[n] !== Use.Road)) continue;
    if (spawns.some((s) => hexDistance(s.q, s.r, qOf(i), rOf(i)) < 3)) continue;
    for (const j of disc(hexOf(i), 16)) chestTaken[j] = 1;
    grid.blocked[i] = 1;
    chests.push({ id: "", q: qOf(i), r: rOf(i), gold: GOLD[tier]!, respawnSeconds: 86400 });
  }

  // Waymarkers: where the tier rises, a banner beside every road that crosses, and standing stones along the rest.
  const markers: PropData[] = [];
  const markerTaken = new Uint8Array(SIZE * SIZE);
  const mark = (i: number, tier: number, style: "banner" | "stone", spacing: number) => {
    if (markerTaken[i] || grid.blocked[i] || grid.use[i] !== Use.Wild || grid.town[i] !== 0) return false;
    if (spawns.some((s) => s.q === qOf(i) && s.r === rOf(i))) return false;
    if (!safeToBlock(open, qOf(i), rOf(i)) || around(i).filter((n) => grid.blocked[n] === 0).length < 4) return false;
    if (around(i).some((n) => grid.use[n] === Use.Door)) return false;
    grid.blocked[i] = 1;
    for (const j of disc(hexOf(i), spacing)) markerTaken[j] = 1;
    const prop = { q: qOf(i), r: rOf(i), kind: "waymarker", tier, style } as const;
    grid.props.set(i, prop);
    markers.push(prop);
    return true;
  };
  // Roads first, so every road crossing gets its banner.
  const near: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (grid.use[i] !== Use.Road) continue;
    const here = tierOf(i);
    if (here === 0) continue;
    for (const n of around(i, near)) {
      const there = tierOf(n);
      if (there <= here || grid.use[n] !== Use.Road) continue;
      // The banner stands on the harder side, beside the road.
      for (const b of around(n)) if (tierOf(b) === there && grid.use[b] !== Use.Road && mark(b, there, "banner", 4)) break;
    }
  }
  for (const i of order) {
    const here = tierOf(i);
    if (here === 0 || markerTaken[i]) continue;
    const harder = around(i).map(tierOf).filter((t) => t > here);
    if (harder.length === 0) continue;
    if (random() < 0.5) continue;
    for (const n of around(i)) if (tierOf(n) > here && mark(n, tierOf(n), "stone", 14)) break;
  }

  const sorted = <T extends { q: number; r: number }>(list: T[]) => list.sort((a, b) => a.q - b.q || a.r - b.r);
  return {
    spawns: sorted(spawns).map((s) => ({ ...s, id: nextId(idx(s.q, s.r)) })),
    chests: sorted(chests).map((c) => ({ ...c, id: nextId(idx(c.q, c.r), "c") })),
    markers: sorted(markers),
  };
}

export { noise };
