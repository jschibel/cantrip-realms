// The generator's fields: grids of numbers over the travel map and the techniques that make them - exact Euclidean
// distance transforms (Felzenszwalb and Huttenlocher's, in two separable passes), seeded gradient noise summed as fractal
// Brownian motion, ridged multifractal noise for the mountains' crests, domain warping (noise sampling a field at
// coordinates displaced by noise, so a traced line wanders without moving), and Poisson-disc sampling at tile
// resolution with a radius that varies over the map (blue noise: never a grid, never clumps).

import { fnv1a32 } from "../../src/random";

/** A grid of numbers `w` by `h`, indexed `z * w + x`. */
export interface Field {
  readonly w: number;
  readonly h: number;
  readonly v: Float32Array;
}

export const field = (w: number, h: number, fill = 0): Field => ({ w, h, v: new Float32Array(w * h).fill(fill) });

/** The value at a point, bilinearly between the tiles' middles (clamped at the edges). */
export function sample(f: Field, x: number, z: number): number {
  const u = Math.max(0, Math.min(f.w - 1.001, x - 0.5));
  const t = Math.max(0, Math.min(f.h - 1.001, z - 0.5));
  const i = Math.floor(u);
  const j = Math.floor(t);
  const fu = u - i;
  const ft = t - j;
  const k = j * f.w + i;
  const a = f.v[k]!;
  const b = f.v[k + 1]!;
  const c = f.v[k + f.w]!;
  const d = f.v[k + f.w + 1]!;
  return (a * (1 - fu) + b * fu) * (1 - ft) + (c * (1 - fu) + d * fu) * ft;
}

// --- Distance transforms ------------------------------------------------------------------------------------------------

const BIG = 1e20;

/** The squared distance transform of one line (Felzenszwalb and Huttenlocher, 2012): `f` in, `d` out, `n` long. */
function edt1(f: Float64Array, d: Float64Array, n: number, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -BIG;
  z[1] = BIG;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]! && k > 0) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    if (s <= z[k]!) {
      // k is 0: q's parabola lies under the first's everywhere.
      v[0] = q;
      z[0] = -BIG;
      z[1] = BIG;
      continue;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = BIG;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    d[q] = (q - p) * (q - p) + f[p]!;
  }
}

/**
 * The exact Euclidean distance, tiles, from every tile to the nearest tile where `source` is true (0 there), over a `w`
 * by `h` grid; `Infinity`-like (1e10) where there is no source at all.
 */
export function distanceTo(w: number, h: number, source: (i: number) => boolean): Float32Array {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = source(i) ? 0 : BIG;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x]!;
    edt1(f, d, h, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]!;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]!;
    edt1(f, d, w, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x]! >= BIG ? 1e10 : Math.sqrt(d[x]!);
  }
  return out;
}

/** A signed distance field of a mask: positive inside (distance to the nearest tile outside), negative outside. */
export function signedDistance(w: number, h: number, inside: (i: number) => boolean): Float32Array {
  const toOut = distanceTo(w, h, (i) => !inside(i));
  const toIn = distanceTo(w, h, inside);
  const out = new Float32Array(w * h);
  // Half a tile either way, so the coast lies between the last tile in and the first out.
  for (let i = 0; i < w * h; i++) out[i] = inside(i) ? toOut[i]! - 0.5 : -(toIn[i]! - 0.5);
  return out;
}

// --- Noise -------------------------------------------------------------------------------------------------------------

/** Seeded 2D gradient noise (Perlin's, with hashed gradients), about -1 to 1, one feature every `scale` tiles. */
export function gradient(seed: string, scale: number): (x: number, z: number) => number {
  const base = fnv1a32(seed);
  const grad = (i: number, j: number, fx: number, fz: number) => {
    let h = (base ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    const a = (((h ^ (h >>> 16)) >>> 0) / 4294967296) * Math.PI * 2;
    return Math.cos(a) * fx + Math.sin(a) * fz;
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, z) => {
    const u = x / scale;
    const v = z / scale;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const a = grad(i, j, fu, fv);
    const b = grad(i + 1, j, fu - 1, fv);
    const c = grad(i, j + 1, fu, fv - 1);
    const d = grad(i + 1, j + 1, fu - 1, fv - 1);
    const su = fade(fu);
    const sv = fade(fv);
    return ((a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv) * 1.4;
  };
}

/** Fractal Brownian motion: octaves of gradient noise, each half the size and half the weight, about -1 to 1. */
export function fractal(seed: string, scale: number, octaves = 4, gain = 0.5): (x: number, z: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => gradient(`${seed}:${o}`, scale / 2 ** o));
  let total = 0;
  for (let o = 0; o < octaves; o++) total += gain ** o;
  return (x, z) => {
    let sum = 0;
    let w = 1;
    for (let o = 0; o < octaves; o++) {
      sum += layers[o]!(x, z) * w;
      w *= gain;
    }
    return sum / total;
  };
}

/**
 * Ridged multifractal noise (Musgrave): each octave folded to a crest (1 - |n|, squared) and weighted by the octave
 * before, so ridges branch into finer ridges along the crests and the valleys stay smooth. 0 to about 1.
 */
export function ridged(seed: string, scale: number, octaves = 4): (x: number, z: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => gradient(`${seed}:${o}`, scale / 2 ** o));
  return (x, z) => {
    let sum = 0;
    let weight = 1;
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      let r = 1 - Math.abs(layers[o]!(x, z));
      r *= r;
      r *= weight;
      weight = Math.max(0, Math.min(1, r * 2));
      sum += r * amp;
      total += amp;
      amp *= 0.5;
    }
    return sum / total;
  };
}

/** A domain warp: the displacement, tiles, by which a point samples its field (two fractal noises, `amount` at most about). */
export function warp(seed: string, scale: number, amount: number): (x: number, z: number) => readonly [number, number] {
  const a = fractal(`${seed}:wx`, scale, 3);
  const b = fractal(`${seed}:wz`, scale, 3);
  return (x, z) => [a(x, z) * amount, b(x, z) * amount];
}

// --- Poisson-disc sampling -----------------------------------------------------------------------------------------------

/**
 * Blue noise at tile resolution: tiles in a shuffled order, each taken with the chance `chance(i)` when no tile taken
 * before lies within `radius(i)` of it (dart throwing, which over every tile of a region is a maximal Poisson-disc set
 * of a radius that varies over the map). `taken` marks what is already there (it is written to); returns the tiles
 * taken in the order taken.
 */
export function poissonTiles(
  w: number,
  h: number,
  order: readonly number[],
  radius: (i: number) => number,
  chance: (i: number) => number,
  taken: Uint8Array,
  random: () => number,
): number[] {
  const out: number[] = [];
  for (const i of order) {
    if (taken[i]) continue;
    const p = chance(i);
    if (p <= 0 || random() >= p) continue;
    const r = radius(i);
    const x = i % w;
    const z = (i - x) / w;
    const R = Math.ceil(r);
    let free = true;
    for (let dz = -R; dz <= R && free; dz++) {
      const zz = z + dz;
      if (zz < 0 || zz >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w || dx * dx + dz * dz >= r * r) continue;
        if (taken[zz * w + xx] === 2) {
          free = false;
          break;
        }
      }
    }
    if (!free) continue;
    taken[i] = 2;
    out.push(i);
  }
  return out;
}
