// The world generator's workbench: the whole of Dominaria as flat typed arrays (640 by 640 hexes), with the strokes
// the generator draws with. A hex is an index, `q * SIZE + r`; nothing here allocates per hex, so the whole world is a
// few megabytes and every pass over it is quick.

import { DIRECTIONS, type Hex, hex, toWorld } from "../../src/hex";
import { fnv1a32, mulberry32 } from "../../src/random";
import { type PropData, TERRAINS, type Terrain, WORLD_SIZE } from "../../src/world/schema";

export const SIZE = WORLD_SIZE;
export const STEP = 0.25;

export const T: Record<Terrain, number> = Object.fromEntries(TERRAINS.map((t, i) => [t, i])) as Record<Terrain, number>;
export const terrainName = (i: number): Terrain => TERRAINS[i]!;

/** What a hex is used for, beyond its ground: the generator's own bookkeeping, never written out. */
export const enum Use {
  Wild = 0,
  /** Inside a town's walls, not yet built on. */
  Lot = 1,
  Street = 2,
  Wall = 3,
  Building = 4,
  Door = 5,
  Road = 6,
  /** Kept clear: a square, a plaza, a gate, a dock, an entrance's apron. */
  Kept = 7,
  Water = 8,
}

export const idx = (q: number, r: number): number => q * SIZE + r;
export const qOf = (i: number): number => Math.floor(i / SIZE);
export const rOf = (i: number): number => i % SIZE;
export const hexOf = (i: number): Hex => hex(qOf(i), rOf(i));
export const inside = (q: number, r: number): boolean => q >= 0 && r >= 0 && q < SIZE && r < SIZE;

/** The neighbours of a hex index that are in the world. */
export function around(i: number, out: number[] = []): number[] {
  out.length = 0;
  const q = qOf(i);
  const r = rOf(i);
  for (const d of DIRECTIONS) {
    const nq = q + d.q;
    const nr = r + d.r;
    if (inside(nq, nr)) out.push(idx(nq, nr));
  }
  return out;
}

export class Grid {
  readonly height = new Float32Array(SIZE * SIZE);
  readonly terrain = new Uint8Array(SIZE * SIZE);
  readonly blocked = new Uint8Array(SIZE * SIZE);
  readonly use = new Uint8Array(SIZE * SIZE);
  /** The region each hex lies in: 0-4 for W U B R G, 5 for the hub. */
  readonly region = new Uint8Array(SIZE * SIZE);
  /** The town a hex belongs to, 1 + its index; 0 for none. */
  readonly town = new Uint16Array(SIZE * SIZE);
  /** Scenery by hex: the prop standing there. */
  readonly props = new Map<number, PropData>();

  prop(i: number, prop: Omit<PropData, "q" | "r">, blocked = true): void {
    this.props.set(i, { q: qOf(i), r: rOf(i), ...prop });
    if (blocked) this.blocked[i] = 1;
  }

  /** Leaves a hex open and bare. */
  clear(i: number, terrain?: Terrain): void {
    this.props.delete(i);
    this.blocked[i] = 0;
    if (terrain !== undefined) this.terrain[i] = T[terrain];
  }

  isWater(i: number): boolean {
    const t = this.terrain[i]!;
    return t === T.water || t === T["deep-water"] || t === T.lava || t === T.swamp;
  }

  /** Whether a hex can be stood on. */
  open(i: number): boolean {
    return this.blocked[i] === 0;
  }
}

// --- Geometry ------------------------------------------------------------------------------------------------------

/** New Argive, at the middle of the world. */
export const HUB: Hex = hex(SIZE / 2, SIZE / 2);

const SQRT3 = Math.sqrt(3);
const UP = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
const RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };

/**
 * The hex `steps` hexes from `from` in a direction on screen: `angle` in degrees, clockwise from straight up (the
 * camera looks along the ground's diagonal, so up on screen is -x -z).
 */
export function atAngle(from: Hex, angle: number, steps: number): Hex {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a) * UP.x + Math.sin(a) * RIGHT.x;
  const dz = Math.cos(a) * UP.z + Math.sin(a) * RIGHT.z;
  const { x, z } = toWorld(from);
  return worldToHex(x + dx * steps * SQRT3, z + dz * steps * SQRT3);
}

/** The screen angle of `h` seen from `from`, degrees clockwise from up, 0-360. */
export function angleOf(from: Hex, h: Hex): number {
  const a = toWorld(from);
  const b = toWorld(h);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const up = dx * UP.x + dz * UP.z;
  const right = dx * RIGHT.x + dz * RIGHT.z;
  const deg = (Math.atan2(right, up) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** The smallest turn between two angles in degrees. */
export const angleGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function worldToHex(x: number, z: number): Hex {
  const q = (2 / 3) * x;
  const r = (-1 / 3) * x + (SQRT3 / 3) * z;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return hex(rq + 0, rr + 0);
}

export const hexDistance = (aq: number, ar: number, bq: number, br: number): number =>
  (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;

// --- Noise -------------------------------------------------------------------------------------------------------------

/** Smooth value noise over the ground plane, seeded: about one bump every `scale` world units, 0-1. */
export function noise(seed: string, scale: number): (q: number, r: number) => number {
  const base = fnv1a32(seed);
  const corner = (i: number, j: number) => {
    let h = (base ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (q: number, r: number) => {
    const x = 1.5 * q;
    const z = SQRT3 * (r + q / 2);
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
export function fbm(seed: string, scale: number, octaves = 4): (q: number, r: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => noise(`${seed}:${o}`, scale / 2 ** o));
  const total = layers.reduce((sum, _, o) => sum + 0.5 ** o, 0);
  return (q, r) => {
    let sum = 0;
    for (let o = 0; o < octaves; o++) sum += layers[o]!(q, r) * 0.5 ** o;
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

/** The hexes on a straight line between two hexes, both ends included. */
export function line(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a.q, a.r, b.q, b.r);
  const found: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const q = a.q + (b.q - a.q) * t + 1e-6;
    const r = a.r + (b.r - a.r) * t + 2e-6;
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(s);
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    found.push(hex(rq + 0, rr + 0));
  }
  return found;
}

/** Every hex index within `radius` of a hex, in the world. */
export function disc(centre: Hex, radius: number): number[] {
  const found: number[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const q = centre.q + dq;
      const r = centre.r + dr;
      if (inside(q, r)) found.push(idx(q, r));
    }
  }
  return found;
}

/** The hexes exactly `radius` from a hex, walking round it. */
export function ringOf(centre: Hex, radius: number): Hex[] {
  if (radius === 0) return [centre];
  const found: Hex[] = [];
  let h = hex(centre.q + DIRECTIONS[4]!.q * radius, centre.r + DIRECTIONS[4]!.r * radius);
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      found.push(h);
      h = hex(h.q + DIRECTIONS[side]!.q, h.r + DIRECTIONS[side]!.r);
    }
  }
  return found;
}

/**
 * A distance field: the walking steps from the nearest source to every hex (ignoring what blocks), up to `limit`;
 * farther hexes get `limit`.
 */
export function distanceField(sources: Iterable<number>, limit: number, passable: (i: number) => boolean = () => true): Uint16Array {
  const field = new Uint16Array(SIZE * SIZE).fill(limit);
  const queue = new Int32Array(SIZE * SIZE);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    if (field[s] === 0) continue;
    field[s] = 0;
    queue[tail++] = s;
  }
  const near: number[] = [];
  while (head < tail) {
    const i = queue[head++]!;
    const d = field[i]! + 1;
    if (d >= limit) continue;
    for (const n of around(i, near)) {
      if (field[n]! > d && passable(n)) {
        field[n] = d;
        queue[tail++] = n;
      }
    }
  }
  return field;
}

/**
 * Whether blocking an open hex leaves every way past it open: its open neighbours make one unbroken run round it, so
 * whoever walked through it can walk round it instead.
 */
export function safeToBlock(open: (q: number, r: number) => boolean, q: number, r: number): boolean {
  const flags = DIRECTIONS.map((d) => open(q + d.q, r + d.r));
  const count = flags.filter(Boolean).length;
  if (count === 0) return false;
  let runs = 0;
  for (let k = 0; k < 6; k++) if (flags[k] && !flags[(k + 5) % 6]) runs++;
  return runs <= 1;
}
