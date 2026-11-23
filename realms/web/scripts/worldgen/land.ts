// The world generator's workbench: the whole of Dominaria as flat typed arrays of square tiles (1024 by 1216), with the
// strokes the generator draws with. A tile is an index, `z * width + x` (row by row, as a chunk's tiles are); nothing
// here allocates per tile, so the whole world is a few megabytes and every pass over it is quick.

import type { PropData } from "../../src/world/format";
import { BARE, BLOCKED, RAMP } from "../../src/world/format";
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

  /** The walkable steps out of a tile as the overworld walks (world/grid.ts): eight ways, never cutting a blocked corner. */
  steps(i: number, out: number[] = []): number[] {
    out.length = 0;
    const x = i % this.width;
    const z = (i - x) / this.width;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!(dx || dz) || !this.inside(x + dx, z + dz)) continue;
        const j = i + dz * this.width + dx;
        if (!this.open(j)) continue;
        if (dx && dz && !(this.open(i + dx) && this.open(i + dz * this.width))) continue;
        out.push(j);
      }
    }
    return out;
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

  /** Stands one-tile scenery on a tile, blocking it (and nothing grows up under it). */
  put(i: number, prop: PropData, blocks = true): void {
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

/**
 * The land as terraces, as a 16-bit RPG draws its hills and as the renderer builds them (render/terrain.ts): every
 * height a whole number of `step`s (12 texels, three quarters of a tile), each level flat, one level at most above an
 * open neighbour, no terrace a single tile wide (banks at least a tile apart). Where a way - a road, a street, a gate's
 * way out - climbs a level, its two tiles across the bank become a ramp (flag RAMP, a quarter and three quarters of the
 * way up); across the open country a straight ramp is cut where a bank runs straight, one every so often; every other
 * tile at the top of a bank (its rim) is blocked, so a level is left only by a ramp. `connect` joins what this leaves
 * apart, with ramps where it climbs. Blocked tiles (peaks, buildings, trees) and water are levelled too but never
 * opened.
 */
const PAVED: ReadonlySet<number> = new Set([S.road, S.dirt, S.cobbles, S.flagstones, S.planks, S.scree]);

export function terraces(land: Land, step: number, seed: number): { ramps: number; rims: number } {
  const W = land.width;
  const h = land.height;
  const water = (i: number) => land.isWater(i);
  for (let i = 0; i < land.size; i++) h[i] = Math.round(h[i]! / step) * step;
  // No terrace a tile wide: a tile above (or below) both its neighbours along x, or along z, comes level with them.
  const near: number[] = [];
  for (let pass = 0; pass < 4; pass++) {
    let moved = 0;
    for (let i = 0; i < land.size; i++) {
      if (water(i)) continue;
      const x = i % W;
      const z = (i - x) / W;
      for (const [a, b] of [
        [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1],
        [z > 0 ? i - W : -1, z < land.depth - 1 ? i + W : -1],
      ] as const) {
        if (a < 0 || b < 0 || water(a) || water(b)) continue;
        if (h[i]! > h[a]! && h[i]! > h[b]!) {
          h[i] = Math.max(h[a]!, h[b]!);
          moved++;
        } else if (h[i]! < h[a]! && h[i]! < h[b]!) {
          h[i] = Math.min(h[a]!, h[b]!);
          moved++;
        }
      }
    }
    if (moved === 0) break;
  }
  const open = (i: number) => (land.flags[i]! & BLOCKED) === 0;
  // A bridge's deck, a ford's stones: at their banks' level.
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < land.size; i++) {
      if (!water(i) || !open(i)) continue;
      const banks = land.n4(i, near).filter((n) => open(n) && !water(n)).map((n) => h[n]!);
      if (banks.length > 0) h[i] = Math.min(...banks);
      else {
        const decks = land.n4(i, near).filter((n) => open(n)).map((n) => h[n]!);
        if (decks.length > 0) h[i] = Math.min(...decks);
      }
    }
  }
  for (const p of land.fixtures) {
    if (p.id !== "bridge") continue;
    const deck = h[land.idx(Math.min(land.width - 1, Math.floor(p.x) + 1), Math.min(land.depth - 1, Math.floor(p.z) + 1))]!;
    (p as { args?: Record<string, unknown> }).args = { ...p.args, y: deck / 16 + 0.25 };
  }
  // One level at most between open neighbours: the higher comes down, from the low ground up.
  {
    const heap = new Heap();
    for (let i = 0; i < land.size; i++) {
      if (!open(i)) continue;
      if (land.n4(i, near).some((n) => open(n) && h[n]! > h[i]! + step)) heap.push(i, h[i]!);
    }
    while (heap.size > 0) {
      const i = heap.pop();
      for (const n of land.n4(i, near)) {
        if (!open(n) || h[n]! <= h[i]! + step) continue;
        h[n] = h[i]! + step;
        heap.push(n, h[n]!);
      }
    }
  }
  const ramp = new Uint8Array(land.size);
  const quarter = Math.round(step / 4);
  /** A ramp of two tiles across a bank, `low` below and `high` above it. */
  const makeRamp = (low: number, high: number) => {
    ramp[low] = 1;
    ramp[high] = 1;
  };
  // Ways climb by ramps: each tile of a way at the top of a bank, with the way going on below it.
  const way = (i: number) => {
    const u = land.use[i]!;
    if (!open(i) || water(i) || land.town[i] !== 0) return false;
    // Kept ground is a way only where it is paved: a gate's way out, not the grass round a town's walls.
    const paved = PAVED.has(land.surface[i]!);
    return u === Use.Road || u === Use.Street || u === Use.Dock || u === Use.Door || (u === Use.Kept && paved);
  };
  for (let i = 0; i < land.size; i++) {
    if (!way(i) || ramp[i]) continue;
    for (const n of land.n4(i, near)) {
      if (!way(n) || ramp[n] || h[n] !== h[i]! - step) continue;
      makeRamp(n, i);
      break;
    }
  }
  // Across the open country, a straight ramp now and then where a bank runs straight: a tile below and a tile above,
  // the ground going on level below the one and above the other, and level either side of each.
  const taken = new Uint8Array(land.size);
  const order = Array.from({ length: land.size }, (_, i) => i);
  const random = randomFor(seed, "ramps");
  shuffle(order, random);
  const level = (i: number, want: number) => i >= 0 && open(i) && !water(i) && !ramp[i] && h[i] === want;
  for (const a of order) {
    if (taken[a] || !open(a) || water(a) || ramp[a] || land.town[a] !== 0) continue;
    const x = a % W;
    const z = (a - x) / W;
    if (x < 2 || z < 2 || x > W - 3 || z > land.depth - 3) continue;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const b = a + dz * W + dx;
      const L = h[a]!;
      if (!level(b, L + step)) continue;
      const c = b + dz * W + dx;
      const d = a - dz * W - dx;
      const sides = [[dz, dx], [-dz, -dx]].flatMap(([sx, sz]) => [a + sz! * W + sx!, b + sz! * W + sx!]);
      if (!level(c, L + step) || !level(d, L) || !level(sides[0]!, L) || !level(sides[2]!, L) || !level(sides[1]!, L + step) || !level(sides[3]!, L + step)) continue;
      makeRamp(a, b);
      for (const t of land.disc(x, z, 16)) taken[t] = 1;
      break;
    }
  }
  let ramps = 0;
  for (let i = 0; i < land.size; i++) {
    if (!ramp[i]) continue;
    ramps++;
    const low = land.n4(i, near).some((n) => ramp[n] && h[n]! > h[i]!);
    h[i] = low ? h[i]! + quarter : h[i]! - quarter;
    land.flags[i] = (land.flags[i]! & ~BLOCKED) | RAMP;
  }
  // Every other tile at the top of a bank is its rim: blocked, so the levels are left only by the ramps.
  let rims = 0;
  const rim: number[] = [];
  for (let i = 0; i < land.size; i++) {
    if (!open(i) || ramp[i] || water(i)) continue;
    if (land.n4(i, near).some((n) => open(n) && !ramp[n] && h[n]! < h[i]! - quarter)) rim.push(i);
  }
  for (const i of rim) {
    land.flags[i] = land.flags[i]! | BLOCKED;
    rims++;
  }
  return { ramps, rims };
}
