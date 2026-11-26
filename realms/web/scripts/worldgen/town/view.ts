// What the camera cannot see (tech.md B5, "One camera"): it looks north, pitched 45 degrees, and turns 45 degrees to
// either side, so whatever stands up hides the ground behind it - a point `y` high hides the ground `y` further along the
// way the camera looks. A town is laid out so that nothing hides a street, a square or a door (checked from here), so
// every object's hidden ground is measured from the art itself: its model built where it stands (art/buildings,
// art/props), each vertex above the eye's height carried down along the camera's line to the ground, and the hull of
// those points and its footprint is the ground it hides at that heading. Cached by what decides the shape.

import "../../../src/art/props";
import { BUILDINGS } from "../../../src/art/buildings";
import { PROPS } from "../../../src/art/props/registry";
import type { BuildingData, PropData } from "../../../src/world/format";

/** The camera's headings: -1 looking north-east, 0 north, 1 north-west. */
export const HEADINGS = [-1, 0, 1] as const;
export type Heading = (typeof HEADINGS)[number];

/** The way the camera looks across the ground at each heading, a unit step (x east, z south). */
const LOOK: Readonly<Record<Heading, readonly [number, number]>> = {
  [-1]: [Math.SQRT1_2, -Math.SQRT1_2],
  0: [0, -1],
  1: [-Math.SQRT1_2, -Math.SQRT1_2],
};

/** How high above the ground what must be seen is: a door's middle, a walker's chest. */
export const EYE = 0.9;

type Pt = readonly [number, number];

/** The convex hull of points, counter-clockwise (Andrew's monotone chain). */
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function inHull(h: readonly Pt[], x: number, z: number): boolean {
  if (h.length < 3) return false;
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!;
    const b = h[(i + 1) % h.length]!;
    if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-9) return false;
  }
  return true;
}

/** The ground an object hides at each heading: a hull for each, about the object's own origin. */
export interface Shadow {
  readonly hulls: Readonly<Record<Heading, readonly Pt[]>>;
  /** Its highest point. */
  readonly top: number;
}

type Model = { readonly parts: readonly { readonly positions: ArrayLike<number> }[] };

/** How wide what stands high must be to hide anything worth seeing: a chimney, a spire's needle, a pennant are not. */
const THIN = 1.75;

/**
 * The shadow of a model: the vertices above the eye carried down the camera's line, with the footprint's corners -
 * but not the thin things standing highest (a chimney, a spire's needle, a pennant), which hide nothing worth seeing: the
 * vertices above the height where what stands that high first spans THIN tiles across are left out.
 */
function shadowOf(model: Model, footprint: readonly [number, number, number, number]): Shadow {
  const pts: [number, number, number][] = [];
  for (const part of model.parts) {
    const v = part.positions;
    for (let i = 0; i + 2 < v.length; i += 3) {
      const y = v[i + 1]!;
      if (y <= EYE) continue;
      pts.push([v[i]!, y, v[i + 2]!]);
    }
  }
  pts.sort((a, b) => b[1] - a[1]);
  let cut = Infinity;
  {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, y, z] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
      if (x1 - x0 >= THIN || z1 - z0 >= THIN) {
        cut = y;
        break;
      }
    }
  }
  const ys = pts.map((p) => p[1]).filter((y) => y <= cut);
  const [x0, z0, x1, z1] = footprint;
  const corners: Pt[] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const hulls = {} as Record<Heading, readonly Pt[]>;
  for (const h of HEADINGS) {
    const [dx, dz] = LOOK[h];
    const cast: Pt[] = [...corners];
    for (const [x, y, z] of pts) {
      if (y > cut) continue;
      const k = y - EYE;
      cast.push([x + dx * k, z + dz * k]);
    }
    hulls[h] = hull(cast);
  }
  return { hulls, top: ys.length > 0 ? Math.max(...ys) : 0 };
}

const buildingCache = new Map<string, Shadow>();
const propCache = new Map<string, Shadow>();

/** A building's shadow, its hulls about its footprint's north-west corner. */
export function buildingShadow(b: BuildingData): Shadow {
  const key = JSON.stringify([b.style, b.kind, b.w, b.d, b.rot, b.params?.upper, b.params?.ground, b.params?.rise, b.params?.floors, b.params?.stilts]);
  let s = buildingCache.get(key);
  if (!s) {
    const at: BuildingData = { ...b, x: 0, z: 0 };
    const built = BUILDINGS.build(b.style, at);
    s = shadowOf(built.model as Model, [0, 0, b.w, b.d]);
    buildingCache.set(key, s);
  }
  return s;
}

/** A prop's shadow, its hulls about its anchor. */
export function propShadow(p: PropData): Shadow {
  const key = JSON.stringify([p.id, p.rot ?? 0, p.scale ?? 1, p.args ?? null]);
  let s = propCache.get(key);
  if (!s) {
    const at: PropData = { ...p, x: 0, z: 0, ...(p.args && Array.isArray(p.args.to) ? { args: { ...p.args, to: [(p.args.to as number[])[0]! - p.x, (p.args.to as number[])[1]! - p.z] } } : {}) };
    const built = PROPS.build(p.id, at);
    s = shadowOf(built.model as Model, [-0.3, -0.3, 0.3, 0.3]);
    propCache.set(key, s);
  }
  return s;
}

/**
 * The tiles a shadow covers at a heading: every tile whose middle lies in its hull, offset to (ox, oz), less `own` (the
 * footprint's own tiles, which nobody needs to see past).
 */
export function hiddenTiles(s: Shadow, heading: Heading, ox: number, oz: number, own?: (x: number, z: number) => boolean): [number, number][] {
  const h = s.hulls[heading];
  if (h.length < 3) return [];
  let xa = Infinity;
  let xb = -Infinity;
  let za = Infinity;
  let zb = -Infinity;
  for (const [x, z] of h) {
    xa = Math.min(xa, x);
    xb = Math.max(xb, x);
    za = Math.min(za, z);
    zb = Math.max(zb, z);
  }
  const out: [number, number][] = [];
  for (let z = Math.floor(za + oz); z <= Math.ceil(zb + oz); z++) {
    for (let x = Math.floor(xa + ox); x <= Math.ceil(xb + ox); x++) {
      if (own?.(x, z)) continue;
      if (inHull(h, x + 0.5 - ox, z + 0.5 - oz)) out.push([x, z]);
    }
  }
  return out;
}

/** The tiles a building hides at a heading, its own footprint left out. */
export function buildingHides(b: BuildingData, heading: Heading): [number, number][] {
  return hiddenTiles(buildingShadow(b), heading, b.x, b.z, (x, z) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d);
}

/** The tiles a prop hides at a heading, its own tile left out. */
export function propHides(p: PropData, heading: Heading): [number, number][] {
  const fx = Math.floor(p.x);
  const fz = Math.floor(p.z);
  return hiddenTiles(propShadow(p), heading, p.x, p.z, (x, z) => x === fx && z === fz);
}
