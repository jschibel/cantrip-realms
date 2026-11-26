// The world generator's workbench: the whole world - the travel map, and the towns' grounds in their pockets east of it -
// as flat typed arrays of square tiles, with the strokes the generator draws with. A tile is an index, `z * width + x` (row by row, as a chunk's tiles are); nothing
// here allocates per tile, so the whole world is a few megabytes and every pass over it is quick.

import { PROP_CATALOGUE } from "../../src/art/props";
import type { PropData } from "../../src/world/format";
import { BARE, BLOCKED, HOP, LEDGE, RAMP } from "../../src/world/format";
import { fnv1a32, mulberry32 } from "../../src/random";
import { S, WATER } from "./ids";

/** What a tile is used for, beyond its ground: the generator's own bookkeeping, never written out. */
export const enum Use {
  Wild = 0,
  /** Inside a town's walls, not yet built on. */
  Lot = 1,
  Street = 2,
  Wall = 3,
  Building = 4,
  /** A building's door, or a dungeon's entrance: walked onto, never built on or blocked. */
  Door = 5,
  Road = 6,
  /** Kept clear: a square, a plaza, a gate's apron, an entrance's. */
  Kept = 7,
  Field = 8,
  /** A pier, a dock, a ferry's lane. */
  Dock = 9,
  /** A garden or yard inside a town: may be planted. */
  Yard = 10,
}

export class Land {
  readonly size: number;
  /** Floor height, texels (1/16 tile). */
  readonly height: Int16Array;
  /** Index into ids.ts's SURFACES. */
  readonly surface: Uint8Array;
  /** BLOCKED | BARE, as the tile data's. */
  readonly flags: Uint8Array;
  readonly use: Uint8Array;
  /** The region each tile lies in: an index into the layout's regions. */
  readonly region: Uint8Array;
  /** The town a tile belongs to, 1 + its index; 0 for none. */
  readonly town: Uint16Array;
  /** One-tile scenery by tile (a tree, a rock): removable when a way is cut through. */
  readonly decor = new Map<number, PropData>();
  /** Everything else that stands in the world: set pieces, walls, wares, bridges. Never removed. */
  readonly fixtures: PropData[] = [];
  /** Tiles within a town's square (its `radius` along x and z) or just round it: no spawn, chest or waymarker there. */
  readonly townArea: Uint8Array;
  /**
   * Whether the land is in terraces (`terraces`): from then on a step is also never taken over a ledge, a bank higher
   * than LEDGE between tiles not both ramps (world/grid.ts `canStep`).
   */
  levelled = false;

  constructor(
    readonly width: number,
    readonly depth: number,
  ) {
    this.size = width * depth;
    this.height = new Int16Array(this.size);
    this.surface = new Uint8Array(this.size);
    this.flags = new Uint8Array(this.size);
    this.use = new Uint8Array(this.size);
    this.region = new Uint8Array(this.size);
    this.town = new Uint16Array(this.size);
    this.townArea = new Uint8Array(this.size);
  }

  idx = (x: number, z: number): number => z * this.width + x;
  xOf = (i: number): number => i % this.width;
  zOf = (i: number): number => Math.floor(i / this.width);
  inside = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < this.width && z < this.depth;

  /** The four neighbours of a tile that are in the world. */
  n4(i: number, out: number[] = []): number[] {
    out.length = 0;
    const x = i % this.width;
    const z = (i - x) / this.width;
    if (x > 0) out.push(i - 1);
    if (x < this.width - 1) out.push(i + 1);
    if (z > 0) out.push(i - this.width);
    if (z < this.depth - 1) out.push(i + this.width);
    return out;
  }

  /** The eight neighbours of a tile that are in the world. */
  n8(i: number, out: number[] = []): number[] {
    out.length = 0;
    const x = i % this.width;
    const z = (i - x) / this.width;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dz) && this.inside(x + dx, z + dz)) out.push(i + dz * this.width + dx);
      }
    }
    return out;
  }

  /**
   * The walkable steps out of a tile as the overworld walks (world/grid.ts `canStep`): eight ways, never cutting a
   * blocked corner, and once the land is levelled never over a ledge.
   */
  steps(i: number, out: number[] = []): number[] {
    out.length = 0;
    const x = i % this.width;
    const z = (i - x) / this.width;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!(dx || dz) || !this.inside(x + dx, z + dz)) continue;
        const j = i + dz * this.width + dx;
        if (!this.open(j)) continue;
        if (!dx || !dz) {
          if (this.passes(i, j)) out.push(j);
          continue;
        }
        const a = i + dx;
        const b = i + dz * this.width;
        if (this.open(a) && this.open(b) && this.passes(i, a) && this.passes(a, j) && this.passes(i, b) && this.passes(b, j)) out.push(j);
      }
    }
    return out;
  }

  /** Whether the edge between two side-by-side tiles is no ledge (always, before the land is levelled). */
  passes(i: number, j: number): boolean {
    return !this.levelled || (this.flags[i]! & this.flags[j]! & RAMP) !== 0 || Math.abs(this.height[i]! - this.height[j]!) <= LEDGE;
  }

  open(i: number): boolean {
    return (this.flags[i]! & BLOCKED) === 0;
  }

  isWater(i: number): boolean {
    return WATER.has(this.surface[i]!);
  }

  isSea(i: number): boolean {
    const s = this.surface[i]!;
    return s === S.sea || s === S.shallows;
  }

  block(i: number, bare = true): void {
    this.flags[i] = BLOCKED | (bare ? BARE : 0);
  }

  unblock(i: number): void {
    this.flags[i] = 0;
  }

  /**
   * Stands one-tile scenery on a tile, nothing growing up under it: blocking it as the art catalogue says the prop does
   * (art/props, its footprint's `blocks`; what is drawn is what blocks), unless told otherwise.
   */
  put(i: number, prop: PropData, blocks = PROP_CATALOGUE.get(prop.id)?.footprint.blocks ?? true): void {
    this.decor.set(i, prop);
    if (blocks) this.block(i);
    else this.flags[i] = this.flags[i]! | BARE;
  }

  /** Clears a tile to open ground: its scenery gone. */
  clear(i: number, surface?: number): void {
    this.decor.delete(i);
    this.flags[i] = 0;
    if (surface !== undefined) this.surface[i] = surface;
  }

  /** Every tile of a rectangle, x0..x1 and z0..z1 included, clipped to the world. */
  rect(x0: number, z0: number, x1: number, z1: number): number[] {
    const out: number[] = [];
    for (let z = Math.max(0, z0); z <= Math.min(this.depth - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x++) out.push(this.idx(x, z));
    return out;
  }

  /** Every tile within `radius` of a tile (a round disc), clipped to the world. */
  disc(cx: number, cz: number, radius: number): number[] {
    const out: number[] = [];
    const r = Math.ceil(radius);
    for (let z = cz - r; z <= cz + r; z++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (this.inside(x, z) && (x - cx) ** 2 + (z - cz) ** 2 <= radius * radius + 0.25) out.push(this.idx(x, z));
      }
    }
    return out;
  }

  /**
   * Distances, tiles, from the nearest of `sources` to every tile, as the crow flies near enough (a chamfer: a step
   * along x or z is 1, a diagonal 1.5), ignoring what blocks. Up to `limit`; farther tiles get `limit`.
   */
  distances(sources: Iterable<number>, limit = 4000): Float32Array {
    const d = new Float32Array(this.size).fill(limit);
    for (const s of sources) d[s] = 0;
    const W = this.width;
    const H = this.depth;
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
          const i = z * W + x;
          let v = d[i]!;
          if (x > 0) v = Math.min(v, d[i - 1]! + 1);
          if (z > 0) {
            v = Math.min(v, d[i - W]! + 1);
            if (x > 0) v = Math.min(v, d[i - W - 1]! + 1.5);
            if (x < W - 1) v = Math.min(v, d[i - W + 1]! + 1.5);
          }
          d[i] = v;
        }
      }
      for (let z = H - 1; z >= 0; z--) {
        for (let x = W - 1; x >= 0; x--) {
          const i = z * W + x;
          let v = d[i]!;
          if (x < W - 1) v = Math.min(v, d[i + 1]! + 1);
          if (z < H - 1) {
            v = Math.min(v, d[i + W]! + 1);
            if (x < W - 1) v = Math.min(v, d[i + W + 1]! + 1.5);
            if (x > 0) v = Math.min(v, d[i + W - 1]! + 1.5);
          }
          d[i] = v;
        }
      }
    }
    return d;
  }

  /**
   * The walkable regions: each open tile labelled by the piece of the world it is walked in (the overworld's steps), the
   * piece holding `from` labelled 0, the others 1, 2, ... by size, biggest first; blocked tiles -1.
   */
  pieces(from: number): { label: Int32Array; sizes: number[]; tiles: number[][] } {
    const label = new Int32Array(this.size).fill(-1);
    const queue = new Int32Array(this.size);
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
        for (const n of this.steps(i, near)) {
          if (label[n] === -1) {
            label[n] = mark;
            queue[tail++] = n;
          }
        }
      }
      return found;
    };
    const tiles: number[][] = [flood(from, 0)];
    for (let i = 0; i < this.size; i++) if (label[i] === -1 && this.open(i)) tiles.push(flood(i, tiles.length));
    const order = tiles.slice(1).sort((a, b) => b.length - a.length || a[0]! - b[0]!);
    const sorted = [tiles[0]!, ...order];
    sorted.forEach((list, k) => {
      for (const i of list) label[i] = k;
    });
    return { label, sizes: sorted.map((l) => l.length), tiles: sorted };
  }
}

// --- Noise -------------------------------------------------------------------------------------------------------------

/** Smooth value noise over the ground, seeded: about one bump every `scale` tiles, 0-1. */
export function noise(seed: string, scale: number): (x: number, z: number) => number {
  const base = fnv1a32(seed);
  const corner = (i: number, j: number) => {
    let h = (base ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const u = x / scale;
    const v = z / scale;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = fade(u - i);
    const fv = fade(v - j);
    const top = corner(i, j) * (1 - fu) + corner(i + 1, j) * fu;
    const bottom = corner(i, j + 1) * (1 - fu) + corner(i + 1, j + 1) * fu;
    return top * (1 - fv) + bottom * fv;
  };
}

/** Octaves of noise added up, 0-1. */
export function fbm(seed: string, scale: number, octaves = 4): (x: number, z: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => noise(`${seed}:${o}`, scale / 2 ** o));
  const total = layers.reduce((sum, _, o) => sum + 0.5 ** o, 0);
  return (x, z) => {
    let sum = 0;
    for (let o = 0; o < octaves; o++) sum += layers[o]!(x, z) * 0.5 ** o;
    return sum / total;
  };
}

/** A seeded random source for one part of the world, so changing one part leaves the others as they were. */
export const randomFor = (seed: number, part: string): (() => number) => mulberry32(fnv1a32(`${seed}:${part}`));

export function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** A whole number from low to high, both included. */
export const between = (random: () => number, low: number, high: number): number => low + Math.floor(random() * (high - low + 1));

export const pick = <T>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

/** Rounds to sixteenths (a texel), so world units in the files stay short and exact. */
export const texel = (v: number): number => Math.round(v * 16) / 16;

/** A binary heap of tile indexes by priority. */
export class Heap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      items[i] = items[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0]!;
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lastKey;
        if (l < n && keys[l]! < mk) {
          m = l;
          mk = keys[l]!;
        }
        if (r < n && keys[r]! < mk) m = r;
        if (m === i) break;
        items[i] = items[m]!;
        keys[i] = keys[m]!;
        i = m;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

// --- Terraces -------------------------------------------------------------------------------------------------------

/** A terrace's level, texels (format.ts HOP: one level is hopped, two or more a cliff). */
export const LEVEL = 12;

/**
 * The open ground as terraces a walker reads at a glance (render/terrain.ts draws them): every open tile a whole number
 * of levels high; no terrace or pit a single tile across (a tile above or below both its neighbours along x, or along z,
 * comes level with them); and no two open side-by-side tiles more than a level apart (a hop) - the higher comes down,
 * from the low ground up, unless it is `fixed` (a road, a place's ground), when the other comes to within a level of it
 * instead. Blocked tiles (peaks, water, footprints) stand as they are. Only the tiles `mine` says are touched (the
 * travel map's; the towns' grounds are their generator's). Returns how many tiles moved.
 */
export function settle(land: Land, mine: (i: number) => boolean, fixed: (i: number) => boolean = () => false): number {
  const W = land.width;
  const h = land.height;
  const open = (i: number) => mine(i) && land.open(i) && !land.isWater(i);
  let moved = 0;
  for (let pass = 0; pass < 4; pass++) {
    let now = 0;
    for (let i = 0; i < land.size; i++) {
      if (!open(i) || fixed(i)) continue;
      const x = i % W;
      for (const [a, b] of [
        [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1],
        [i - W, i + W < land.size ? i + W : -1],
      ] as const) {
        if (a < 0 || b < 0 || !open(a) || !open(b)) continue;
        if (h[i]! > h[a]! && h[i]! > h[b]!) h[i] = Math.max(h[a]!, h[b]!);
        else if (h[i]! < h[a]! && h[i]! < h[b]!) h[i] = Math.min(h[a]!, h[b]!);
        else continue;
        now++;
      }
    }
    moved += now;
    if (now === 0) break;
  }
  // A level at most between open neighbours: settled outward from the fixed ground first, then from the low ground up.
  const near: number[] = [];
  const heap = new Heap();
  const key = (i: number) => (fixed(i) ? -1e6 + h[i]! : h[i]!);
  for (let i = 0; i < land.size; i++) if (open(i)) heap.push(i, key(i));
  const done = new Uint8Array(land.size);
  while (heap.size > 0) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    for (const n of land.n4(i, near)) {
      if (!open(n) || done[n] || fixed(n)) continue;
      if (h[n]! > h[i]! + LEVEL) h[n] = h[i]! + LEVEL;
      else if (fixed(i) && h[n]! < h[i]! - LEVEL) h[n] = h[i]! - LEVEL;
      else continue;
      moved++;
      heap.push(n, key(n));
    }
  }
  return moved;
}

/**
 * Ramps where a way climbs: each tile of a way (`way`) with the way going on a level below it beside it becomes, with that
 * tile, a ramp of two tiles (flag RAMP; a quarter of a level up from the lower, a quarter down from the higher). A tile is
 * in one ramp at most. Returns how many tiles became ramps.
 */
export function rampWays(land: Land, way: (i: number) => boolean): number {
  const h = land.height;
  const near: number[] = [];
  const ramp = new Uint8Array(land.size);
  const pairs: [number, number][] = [];
  const W = land.width;
  for (let i = 0; i < land.size; i++) {
    if (!way(i) || ramp[i]) continue;
    for (const n of land.n4(i, near)) {
      if (!way(n) || ramp[n] || h[n] !== h[i]! - LEVEL) continue;
      // Only where the way runs straight up the bank: on below the lower tile, on above the higher (else the hop is
      // the way up, and a ramp there would climb nowhere).
      const below = n + (n - i);
      const above = i + (i - n);
      if (Math.abs((n % W) - (i % W)) + Math.abs(Math.floor(n / W) - Math.floor(i / W)) !== 1) continue;
      if (below < 0 || below >= land.size || above < 0 || above >= land.size) continue;
      if (h[below]! > h[n]! || h[above]! < h[i]! || ramp[below] || ramp[above]) continue;
      ramp[n] = 1;
      ramp[i] = 1;
      pairs.push([n, i]);
      break;
    }
  }
  const quarter = LEVEL / 4;
  for (const [low, high] of pairs) {
    h[low] = h[low]! + quarter;
    h[high] = h[high]! - quarter;
    land.flags[low] = (land.flags[low]! & ~BLOCKED) | RAMP;
    land.flags[high] = (land.flags[high]! & ~BLOCKED) | RAMP;
  }
  return pairs.length * 2;
}

/** Whether the edge between two side-by-side tiles is crossed by one who hops (world/grid.ts `canStep`, format.ts HOP). */
export function hops(land: Land, i: number, j: number): boolean {
  return (land.flags[i]! & land.flags[j]! & RAMP) !== 0 || Math.abs(land.height[i]! - land.height[j]!) <= HOP;
}

/**
 * The steps one who hops (a player) takes out of a tile (world/grid.ts `canStep` on a player's ground): a straight step
 * over no cliff, a diagonal only where both tiles it passes between are open and all four edges round the corner are no
 * ledge at all.
 */
export function hopSteps(land: Land, i: number, out: number[] = []): number[] {
  out.length = 0;
  const W = land.width;
  const x = i % W;
  const z = (i - x) / W;
  const flat = (a: number, b: number) => (land.flags[a]! & land.flags[b]! & RAMP) !== 0 || Math.abs(land.height[a]! - land.height[b]!) <= LEDGE;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!(dx || dz) || !land.inside(x + dx, z + dz)) continue;
      const j = i + dz * W + dx;
      if (!land.open(j)) continue;
      if (!dx || !dz) {
        if (hops(land, i, j)) out.push(j);
        continue;
      }
      const a = i + dx;
      const b = i + dz * W;
      if (land.open(a) && land.open(b) && flat(i, a) && flat(a, j) && flat(i, b) && flat(b, j)) out.push(j);
    }
  }
  return out;
}

/**
 * The pieces of ground one who hops walks, each open tile labelled by its piece (`hopSteps`): the piece holding `from`
 * 0, the others 1, 2, ... biggest first; blocked tiles and tiles `mine` does not say -1. `links` joins tiles a step
 * apart for the walk although they are not (a ferry's dock to its other).
 */
export function hopPieces(land: Land, from: number, mine: (i: number) => boolean, links: ReadonlyMap<number, readonly number[]> = new Map()): { label: Int32Array; tiles: number[][] } {
  const label = new Int32Array(land.size).fill(-1);
  const queue = new Int32Array(land.size);
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
      for (const n of [...hopSteps(land, i, near), ...(links.get(i) ?? [])]) {
        if (label[n] !== -1 || !mine(n)) continue;
        label[n] = mark;
        queue[tail++] = n;
      }
    }
    return found;
  };
  const tiles: number[][] = [flood(from, 0)];
  for (let i = 0; i < land.size; i++) if (label[i] === -1 && mine(i) && land.open(i)) tiles.push(flood(i, tiles.length));
  const order = tiles.slice(1).sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  const sorted = [tiles[0]!, ...order];
  sorted.forEach((list, k) => {
    for (const i of list) label[i] = k;
  });
  return { label, tiles: sorted };
}
