// A town's grounds at walking scale (the world revamp's "Two scales, one world file"): the town within its walls, the
// country round it that is walked - fields, farms, a wood's edge, the shore - and an apron of scenery past that, only
// seen. Here: the site's fields (the land's height in levels, the sea, the river), the ground of the country by biome, the
// roads out from the gates (weighted A* over the land, bending with it and bridging the river), the walked ground's edge
// closed everywhere but where each road leaves (its exit, a signpost by it), and the apron beyond.

import type { PropData, XZ } from "../../../src/world/format";
import { BLOCKED } from "../../../src/world/format";
import { S } from "../ids";
import { type Land, Use, fbm, noise, texel } from "../land";
import type { Box, Plan } from "./plan";
import type { Side, TownBiome, TownSetting } from "./types";

/** The ground of the country by biome: its grass, its worn ground, its trees, its field surfaces. */
export interface Country {
  readonly ground: number;
  readonly rough: number;
  readonly track: number;
  readonly trees: readonly string[];
  readonly undergrowth: readonly string[];
  readonly fields: readonly number[];
  /** What closes the walked ground's edge. */
  readonly edge: "hedgerow" | "wood" | "palisade" | "bog";
  /** How much of the country is wood, 0-1. */
  readonly wood: number;
  readonly palette?: string;
}

export function countryOf(biome: TownBiome): Country {
  switch (biome) {
    case "forest":
    case "jungle":
      return { ground: S["forest-floor"], rough: S.moss, track: S.dirt, trees: biome === "jungle" ? ["lush-tree", "palm", "great-tree"] : ["great-tree", "elf-tree", "oak", "tree"], undergrowth: ["undergrowth", "fern", "mushrooms", "giant-fern"], fields: [S.meadow], edge: "wood", wood: 0.55 };
    case "swamp":
      return { ground: S.mud, rough: S.moss, track: S.planks, trees: ["swamp-tree", "mossy-dead-tree", "cypress", "dead-tree"], undergrowth: ["reeds", "mushrooms"], fields: [S.moss], edge: "bog", wood: 0.35 };
    case "tundra":
      return { ground: S.tundra, rough: S.snow, track: S.dirt, trees: ["snowy-fir", "pine"], undergrowth: ["snowy-rock", "scrub"], fields: [S.tundra], edge: "palisade", wood: 0.3 };
    case "mountains":
    case "highlands":
      return { ground: S.grass, rough: S.scree, track: S.dirt, trees: ["pine", "birch"], undergrowth: ["rock", "scrub", "boulder"], fields: [S.meadow, S.straw], edge: "hedgerow", wood: 0.2 };
    case "coast":
      return { ground: S.grass, rough: S.sand, track: S.dirt, trees: ["oak", "birch", "tree"], undergrowth: ["scrub", "bush"], fields: [S.meadow, S.wheat], edge: "hedgerow", wood: 0.15 };
    case "desert":
    case "badlands":
    case "waste":
      return { ground: biome === "desert" ? S.sand : S["cracked-earth"], rough: S.scree, track: S.dirt, trees: ["dead-tree", "palm"], undergrowth: ["rock", "scrub"], fields: [S.straw], edge: "hedgerow", wood: 0.05 };
    case "volcanic":
      return { ground: S.ash, rough: S.rock, track: S.dirt, trees: ["dead-tree"], undergrowth: ["rock", "crag"], fields: [S.ash], edge: "hedgerow", wood: 0.05 };
    default:
      return { ground: S.grass, rough: S.meadow, track: S.dirt, trees: ["oak", "tree", "birch"], undergrowth: ["bush", "wildflowers"], fields: [S.wheat, S.furrows, S.straw], edge: "hedgerow", wood: 0.12 };
  }
}

/** The walked ground: the country this far out from the town's outline on every side with a way out (less on the sea). */
export const COUNTRY = 16;

export interface Fields {
  readonly GW: number;
  readonly GD: number;
  readonly box: Box;
  /** The walked ground's rectangle (its edge wobbles a little inside it). */
  readonly walked: Box;
  /** The land's height in levels, fractional. */
  readonly height: (x: number, z: number) => number;
  /** Whether a tile is sea. */
  readonly isSea: (x: number, z: number) => boolean;
  readonly setting: TownSetting;
}

const opposite: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };

/**
 * The site: where the land rises (away from the sea, else north, so the banks face the camera), how hilly it is, and
 * where the sea comes to (a shore a few tiles out from the town on each sea side, wandering along the country).
 */
export function fieldsOf(GW: number, GD: number, box: Box, setting: TownSetting, seedTag: string, rise: number): Fields {
  const sea = new Set(setting.sea);
  const high: Side = setting.sea.length > 0 ? opposite[setting.sea[0]!] : "north";
  const roll = fbm(`${seedTag}:height`, 26, 3);
  const wander = noise(`${seedTag}:shore`, 9);
  const toward = (x: number, z: number): number => (high === "north" ? 1 - z / GD : high === "south" ? z / GD : high === "west" ? 1 - x / GW : x / GW);
  const r = Math.max(0, Math.min(1, setting.relief));
  /** How far a tile is out to sea past the shore (negative ashore), on each sea side. */
  const pastShore = (x: number, z: number): number => {
    let most = -Infinity;
    for (const s of sea) {
      const along = s === "north" || s === "south" ? x : z;
      const near = s === "north" || s === "south" ? along >= box.x0 - 6 && along < box.x1 + 6 : along >= box.z0 - 6 && along < box.z1 + 6;
      const off = near ? 2 : 3 + Math.round(wander(along, s.length * 7) * 6);
      const d = s === "south" ? z - (box.z1 + off) : s === "north" ? box.z0 - 1 - off - z : s === "east" ? x - (box.x1 + off) : box.x0 - 1 - off - x;
      most = Math.max(most, d);
    }
    return most;
  };
  const isSea = (x: number, z: number) => sea.size > 0 && pastShore(x, z) >= 0;
  const height = (x: number, z: number): number => {
    let h = 1 + r * (rise * toward(x, z) + 2.2 * (roll(x, z) - 0.5));
    if (sea.size > 0) {
      const d = -pastShore(x, z);
      if (d < 12) h = Math.min(h, 1 + (Math.max(0, d) / 12) * (h - 1));
    }
    return Math.max(1, h);
  };
  const walked: Box = {
    x0: sea.has("west") ? 2 : box.x0 - COUNTRY,
    z0: sea.has("north") ? 2 : box.z0 - COUNTRY,
    x1: sea.has("east") ? GW - 2 : box.x1 + COUNTRY,
    z1: sea.has("south") ? GD - 2 : box.z1 + COUNTRY,
  };
  return { GW, GD, box, walked, height, isSea, setting };
}

/** A river's course outside the town: the tiles of its bed, by its middle line wandering a little. */
export function riverTiles(f: Fields, plan: Plan, seedTag: string): Set<number> {
  const out = new Set<number>();
  const river = f.setting.river;
  if (!river) return out;
  const meander = noise(`${seedTag}:river`, 14);
  const width = 5;
  const add = (x: number, z: number) => {
    if (x >= 0 && z >= 0 && x < f.GW && z < f.GD && !f.isSea(x, z)) out.add(z * f.GW + x);
  };
  if (river === "through" || river === "north" || river === "south") {
    // East-west: through the town along its band, or past its north or south side.
    const z0 = river === "through" && plan.river ? plan.river.z0 : river === "north" ? f.box.z0 - 9 : f.box.z1 + 4;
    for (let x = 0; x < f.GW; x++) {
      const inTown = x >= f.box.x0 - 3 && x < f.box.x1 + 3;
      const away = inTown ? 0 : Math.min(Math.abs(x - f.box.x0), Math.abs(x - f.box.x1));
      const off = inTown ? 0 : Math.round((meander(x, 3) - 0.5) * Math.min(1, away / 12) * 10);
      for (let k = 0; k < width; k++) add(x, z0 + off + k);
    }
  } else {
    const x0 = river === "east" ? f.box.x1 + 4 : f.box.x0 - 9;
    for (let z = 0; z < f.GD; z++) {
      const off = Math.round((meander(5, z) - 0.5) * 10);
      for (let k = 0; k < width; k++) add(x0 + off + k, z);
    }
  }
  return out;
}

/** Steps between neighbours, x and z. */
export const N4: readonly XZ[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * A road from a gate out to the grounds' edge on its side: weighted A* over the land (each tile's cost its climb, its
 * water to bridge, the sea never, the town never), eight ways with a cost on each turn, so it runs straight where the land
 * lets it and bends round hills. Returns its middle line, gate to edge.
 */
export function roadPath(land: Land, from: XZ, side: Side, level: Int16Array, blockedFor: (i: number) => boolean, water: (i: number) => boolean, wanted: number): number[] {
  const W = land.width;
  const H = land.depth;
  const goal = (i: number) => {
    const x = i % W;
    const z = (i - x) / W;
    return side === "north" ? z === 0 : side === "south" ? z === H - 1 : side === "west" ? x === 0 : x === W - 1;
  };
  const dirs: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.42],
    [-1, 1, 1.42],
    [1, -1, 1.42],
    [-1, -1, 1.42],
  ];
  const [ox, oz] = side === "north" ? [0, -1] : side === "south" ? [0, 1] : side === "west" ? [-1, 0] : [1, 0];
  // A state is a tile and the way it was entered (one of eight, or 8 for none).
  const key = (i: number, d: number) => i * 9 + d;
  const dist = new Map<number, number>();
  const came = new Map<number, number>();
  const start = from[1] * W + from[0];
  const open: [number, number, number][] = [];
  const push = (f: number, i: number, d: number) => {
    open.push([f, i, d]);
    for (let k = open.length - 1; k > 0; ) {
      const p = (k - 1) >> 1;
      if (open[p]![0] <= open[k]![0]) break;
      [open[p], open[k]] = [open[k]!, open[p]!];
      k = p;
    }
  };
  const pop = () => {
    const top = open[0]!;
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < open.length && open[l]![0] < open[m]![0]) m = l;
        if (r < open.length && open[r]![0] < open[m]![0]) m = r;
        if (m === k) break;
        [open[m], open[k]] = [open[k]!, open[m]!];
        k = m;
      }
    }
    return top;
  };
  const hx = (i: number) => {
    const x = i % W;
    const z = (i - x) / W;
    return side === "north" ? z : side === "south" ? H - 1 - z : side === "west" ? x : W - 1 - x;
  };
  dist.set(key(start, 8), 0);
  push(hx(start), start, 8);
  let end = -1;
  let endKey = -1;
  while (open.length > 0) {
    const [, i, d] = pop();
    const k0 = key(i, d);
    const g = dist.get(k0)!;
    if (goal(i)) {
      end = i;
      endKey = k0;
      break;
    }
    const x = i % W;
    const z = (i - x) / W;
    for (let n = 0; n < 8; n++) {
      const [dx, dz, step] = dirs[n]!;
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = nz * W + nx;
      if (blockedFor(j)) continue;
      // Never back toward the town.
      if (dx * ox + dz * oz < 0) continue;
      let c = step;
      c += Math.abs(level[j]! - level[i]!) * 6;
      if (water(j)) c += 5;
      if (d !== 8 && d !== n) c += 1.6;
      // Away from the line straight out of the gate, a little dearer: roads go where they are going.
      const off = side === "north" || side === "south" ? Math.abs(nx - wanted) : Math.abs(nz - wanted);
      c += off > 8 ? 0.08 * (off - 8) : 0;
      const nk = key(j, n);
      const ng = g + c;
      if (ng < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, ng);
        came.set(nk, k0);
        push(ng + hx(j), j, n);
      }
    }
  }
  if (end < 0) return [];
  const out: number[] = [];
  for (let k: number | undefined = endKey; k !== undefined; k = came.get(k)) out.push(Math.floor(k / 9));
  return out.reverse();
}

/** A tree or a bush of the country at a tile, its scale and seed varied. */
export function treeProp(id: string, x: number, z: number, random: () => number, scale = 1): PropData {
  return { id, x: texel(x + 0.5 + (random() - 0.5) * 0.3), z: texel(z + 0.5 + (random() - 0.5) * 0.3), seed: Math.floor(random() * 16), scale: texel(scale * (0.85 + random() * 0.3)) };
}

/** Marks a tile blocked ground of the apron: drawn, never walked. */
export function apron(land: Land, i: number): void {
  land.flags[i] = BLOCKED;
  land.use[i] = Use.Wild;
}
