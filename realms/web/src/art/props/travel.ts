import type { PropData, Rect } from "../../world/format";
import { type Material, type MeshBuilder, fitted } from "../paint/builder";
import * as C from "../paint/colors";
import { material } from "../paint/materials";
import { type Ramp, rampKey } from "../paint/palette";
import { Pixmap, hash2, seeded } from "../paint/pixmap";
import { fbm } from "../paint/procedural";
import * as R from "../paint/ramps";
import type { Built } from "../recipe";
import { type Footprint, prop } from "./catalogue";
import { atScaled, bark, cutout, foliage, glowing, limb, needleMaterial, rock, snowCover } from "./kit";
import { num, str, turnOf } from "./registry";
import { type V3, TAU, camUv, cone, spike } from "./travelKit";
import { LANDMARK_KINDS, LANDMARK_LIGHTS, landmark } from "./travelLandmarks";
import { TOWN_SIZES, TOWN_STYLES, townIcon } from "./travelTowns";

// The travel map's miniatures (design: the contract's "Two scales, one world file"). Out of the towns the land is a map
// of the Domains at travel scale, walked by the player's figure at its usual size in the JRPG-overworld way: a mountain
// is a miniature peak three to seven tiles tall, a forest clumps of miniature trees a tile each, a town an icon of itself
// three to seven tiles across, a wonder a miniature on three by three. Each is drawn in the game's own look (low-poly,
// painted small, banded light) and stands over the tiles the catalogue says, all of them blocked: the world generator
// places them by these ids and args, and the walk grid closes their squares.
//
//   peak        x, z the middle of its square; args.w 1, 3 or 5 tiles across; args.h its height (0.9 w + 1); args.kind
//               rock, snow, ice, ash, sandstone or redrock; seed its shape (single, twin, shoulder, spur or jagged).
//               Side by side, peaks merge into a range: each is a broad massif to half its height (its foot reaches the
//               corners of its square and past), a ridge running along a seeded direction, so neighbours join in a
//               saddle at about half their height; the snow and ice lines stand at one height over every peak.
//   grove       x, z the middle of its tile; args.kind broadleaf, pine, snowpine, swamp, dead, palm, jungle or elfwood;
//               seed its trees. Three to five miniature trees whose crowns reach past the tile's edges, so groves side by
//               side are one canopy; at most 150 triangles (its far stand-in about a third of that).
//   town-icon   travelTowns.ts.          landmark    travelLandmarks.ts.
//
// `scale` scales any of them about its anchor, footprint and all (the catalogue's `scaleOf`).

// --- Peaks --------------------------------------------------------------------------------------------------------------

export const PEAK_KINDS = ["rock", "snow", "ice", "ash", "sandstone", "redrock"] as const;
export type PeakKind = (typeof PEAK_KINDS)[number];

/** How high the snow lies on every snow peak (a range's line is one line), or lower on a peak too low to reach it. */
const SNOW_LINE = 2.3;
const ICE_LINE = 1.5;

/** One stratum of banded rock: a ramp's tone, darker grains, a lit seam along it. */
function stratum(ramp: Ramp, k: number): Material {
  return material(`stratum-${k}@${rampKey(ramp)}`, () => {
    const p = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let c = ramp[k]!;
        if (fbm(x, y * 2, 8, 16, 40 + k) > 0.64) c = ramp[Math.min(ramp.length - 1, k + 1)]!;
        if (hash2(x, y, 41 + k) < 0.1) c = ramp[k - 1]!;
        if (y % 8 === 7 && hash2(x, y, 42) < 0.75) c = ramp[k - 1]!;
        p.set(x, y, c);
      }
    }
    return p;
  });
}

/** A glacier: pale blue ice under old snow, blue crevasses across it. */
const glacier = () =>
  material(
    "mini-glacier",
    () => {
      const p = new Pixmap(32, 32);
      const r = R.ICE;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const n = fbm(x, y, 8, 32, 197);
          let c = n < 0.4 ? r[4]! : n < 0.68 ? r[5]! : r[6]!;
          if (hash2(x, y, 198) < 0.05) c = R.SNOW[5]!;
          p.set(x, y, c);
        }
      }
      const random = seeded(199);
      for (let k = 0; k < 6; k++) {
        let x = Math.floor(random() * 32);
        const y = Math.floor(random() * 32);
        for (let i = 0; i < 6; i++) {
          p.set(x, y + (i % 2), r[2]!);
          p.set(x, y + 1 + (i % 2), r[6]!);
          x++;
        }
      }
      return p;
    },
    { smooth: true },
  );

/** How high each band of a layered stone runs: sandstone's and red rock's facets take their band by height. */
const BAND: Partial<Record<PeakKind, number>> = { sandstone: 0.34, redrock: 0.42 };

/** Which of `n` bands a height falls in, bands `band` high from the ground (below it too). */
const bandOf = (y: number, band: number, n: number) => ((Math.floor(y / band) % n) + n) % n;

/** A peak's materials: which a facet wears, by its height (absolute) and how much it faces up. */
function peakPaint(kind: PeakKind, h: number): (y: number, rise: number, k: number) => Material {
  const jit = (k: number) => (hash2(k, 7, 91) - 0.5) * 0.5;
  switch (kind) {
    case "snow": {
      const body = rock(R.GRANITE, R.LICHEN);
      const line = Math.min(SNOW_LINE, h * 0.6);
      return (y, rise, k) => (y + jit(k) > line || (rise > 0.72 && y > line - 0.7) ? snowCover() : body);
    }
    case "ice": {
      // Blue-grey stone, glaciers above a line lower than the snow's, snow on the very top.
      const body = rock(R.ICE_ROCK, null);
      const line = Math.min(ICE_LINE, h * 0.45);
      return (y, rise, k) => (y + jit(k) > h * 0.82 ? snowCover() : y + jit(k) > line || (rise > 0.7 && y > line - 0.6) ? glacier() : body);
    }
    case "ash": {
      const low = rock(R.BASALT, null);
      const high = rock(R.ASH, null);
      return (y, _rise, k) => (y + jit(k) > h * 0.55 ? high : low);
    }
    case "sandstone": {
      const bands = [stratum(R.SANDSTONE, 4), stratum(R.SANDSTONE, 2), stratum(R.SANDSTONE, 5), stratum(R.SANDSTONE, 3), stratum(R.SANDSTONE, 4), stratum(R.SANDSTONE, 5)];
      return (y, rise) => (rise > 0.85 ? stratum(R.SANDSTONE, 5) : bands[bandOf(y, BAND.sandstone!, bands.length)]!);
    }
    case "redrock": {
      const bands = [stratum(R.REDROCK, 4), stratum(R.REDROCK, 2), stratum(R.REDROCK, 5), stratum(R.REDROCK, 3)];
      return (y, rise) => (rise > 0.85 ? stratum(R.REDROCK, 5) : bands[bandOf(y, BAND.redrock!, bands.length)]!);
    }
    default: {
      const body = rock(R.GRANITE, R.LICHEN);
      const high = rock(R.GRANITE, null);
      return (y, rise, k) => (y + jit(k) > h * 0.7 && rise > 0.4 ? high : body);
    }
  }
}

/**
 * The massif's profile: a broad foot, its slopes steepening up to the summit (a mountain's, not a boulder's), so peaks
 * side by side meet at their feet in a run of rock and stand up out of it as one range.
 */
const MASSIF: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.1, 0.84],
  [0.28, 0.64],
  [0.52, 0.42],
  [0.76, 0.2],
  [1, 0],
];
/** A summit standing on the massif. */
const SUMMIT: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.4, 0.58],
  [0.75, 0.26],
  [1, 0],
];
/** A butte (sandstone and red rock: a mesa): a talus foot, then cliffs to a flat top. */
const MESA: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.16, 0.8],
  [0.24, 0.66],
  [0.6, 0.62],
  [0.96, 0.58],
  [1, 0.54],
  [1.0001, 0],
];

/** A profile with rings added at the heights given (a layered stone's band lines), so no facet straddles a band. */
function ringedAt(profile: readonly (readonly [number, number])[], top: number, band: number | undefined): (readonly [number, number])[] {
  if (!band) return [...profile];
  const out = [...profile];
  const f = (u: number) => {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [ua, fa] = profile[i]!;
      const [ub, fb] = profile[i + 1]!;
      if (u >= ua && u <= ub) return fa + ((fb - fa) * (u - ua)) / Math.max(1e-9, ub - ua);
    }
    return 0;
  };
  for (let y = band; y < top; y += band) {
    const u = y / top;
    if (u <= 0.02 || u >= 0.97 || out.some(([v]) => Math.abs(v - u) < 0.03)) continue;
    out.push([u, f(u)]);
  }
  return out.sort((a, c) => a[0] - c[0]);
}

/** Draws a peak about the origin: `w` tiles across, `h` high. */
function drawPeak(b: MeshBuilder, w: number, h: number, kind: PeakKind, seed: number): void {
  const random = seeded(seed * 31 + 5);
  const paint = peakPaint(kind, h);
  const variant = w === 1 ? Math.floor(random() * 2) * 2 : Math.floor(random() * 5);
  const dir = random() * Math.PI;
  const along: [number, number] = [Math.sin(dir), Math.cos(dir)];
  const segs = w >= 5 ? 11 : w >= 3 ? 9 : 7;
  const r = 0.6 * w + 0.22;
  const bottom = -0.5;
  const lean: [number, number] = [(random() - 0.5) * 0.18 * w, (random() - 0.5) * 0.18 * w];
  const mesa = (kind === "sandstone" || kind === "redrock") && variant === 4;
  const crater = kind === "ash" && w >= 3;
  const band = BAND[kind];
  // The massif: the whole peak, or the foot two summits stand on.
  const twin = variant === 1;
  const top = twin ? h * 0.7 : mesa ? h * 0.78 : h;
  const rim = cone(
    b,
    {
      x: 0,
      z: 0,
      r,
      top,
      bottom,
      profile: ringedAt(mesa ? MESA : crater ? MASSIF.slice(0, -1).concat([[0.94, 0.12]]) : MASSIF, top, band),
      segments: segs,
      seed,
      jitter: variant === 4 && !mesa ? 0.2 : 0.12,
      stretch: { dir, by: variant === 3 ? 0.3 : 0.2 },
      lean: mesa || twin ? [0, 0] : lean,
      wobble: band ? 0 : 0.06,
    },
    paint,
  );
  if (crater) {
    // Its crater: a glow of lava a little below the rim, covering the open top.
    const y = Math.min(...rim.map((q) => q[1])) - 0.04;
    const lava = glowing(R.LAVA[3]!);
    const uv = camUv(b, lava);
    const ring = rim.map((q) => [q[0], y, q[2]] as V3);
    b.polygon(lava, ring, ring.map(uv));
  }
  const summit = (x: number, z: number, rr: number, t: number, s: number) =>
    cone(
      b,
      { x, z, r: rr, top: t, bottom: t * 0.2, profile: ringedAt(SUMMIT, t, band), segments: Math.max(6, segs - 2), seed: s, jitter: 0.14, lean: [(random() - 0.5) * 0.16 * w, (random() - 0.5) * 0.16 * w], wobble: band ? 0 : 0.06 },
      paint,
    );
  if (twin) {
    // Twin summits along the ridge.
    summit(along[0] * 0.24 * w, along[1] * 0.24 * w, 0.42 * w, h, seed + 1);
    summit(-along[0] * 0.26 * w, -along[1] * 0.26 * w, 0.38 * w, h * 0.86, seed + 2);
  } else if (variant === 2) {
    // A shoulder: a lower summit off to one side.
    const side = random() < 0.5 ? 1 : -1;
    summit(along[0] * 0.34 * w * side, along[1] * 0.34 * w * side, 0.4 * w, h * 0.66, seed + 3);
  } else if (variant === 3) {
    // A spur running out along the ridge, low, to the edge of its square.
    summit(along[0] * 0.42 * w, along[1] * 0.42 * w, 0.32 * w, h * 0.46, seed + 4);
  } else if (variant === 4 && !mesa) {
    // Jagged: crags standing up off its shoulders.
    for (let k = 0; k < 2; k++) {
      const a = dir + Math.PI / 2 + k * Math.PI + (random() - 0.5);
      summit(Math.sin(a) * 0.26 * w, Math.cos(a) * 0.26 * w, 0.2 * w, h * (0.62 + random() * 0.12), seed + 5 + k);
    }
  }
}

const peakW = (p: PropData) => {
  const w = num(p, "w", 3);
  return w >= 4 ? 5 : w >= 2 ? 3 : 1;
};
const peakH = (p: PropData, w: number) => num(p, "h", 0.9 * w + 1);

/** Checks a prop's args against the values they may take. */
function oneOf(key: string, values: readonly (string | number | boolean)[], optional = true): (p: PropData) => string[] {
  return (p) => {
    const v = p.args?.[key];
    if (v === undefined) return optional ? [] : [`prop ${p.id} at ${p.x},${p.z}: args.${key} is missing (one of ${values.join(", ")})`];
    return values.includes(v as string) ? [] : [`prop ${p.id} at ${p.x},${p.z}: args.${key} ${JSON.stringify(v)} is not one of ${values.join(", ")}`];
  };
}
function positive(key: string, max = Infinity): (p: PropData) => string[] {
  return (p) => {
    const v = p.args?.[key];
    if (v === undefined) return [];
    return typeof v === "number" && v > 0 && v <= max ? [] : [`prop ${p.id} at ${p.x},${p.z}: args.${key} ${JSON.stringify(v)} should be a number over 0${max < Infinity ? ` and at most ${max}` : ""}`];
  };
}
export const checks =
  (...cs: ((p: PropData) => string[])[]) =>
  (p: PropData): string[] =>
    cs.flatMap((c) => c(p));

/** The square of `n` tiles about a prop's anchor, scaled with it: its footprints (the occluder fade never fades over it). */
export function square(p: PropData, n: number): Rect {
  const h = (n * (p.scale ?? 1)) / 2;
  return [p.x - h, p.z - h, p.x + h, p.z + h];
}

/** A footprint of `n(p)` tiles square about the anchor, all blocked. */
export const squareOf = (n: (p: PropData) => number): Footprint => ({ rect: [-0.5, -0.5, 0.5, 0.5], blocks: true, scaleOf: n });

prop(
  "peak",
  "a miniature mountain of the travel map: x, z the middle of its square; args.w its tiles across (1, 3 or 5, all blocked; 3), args.h its height in tiles (0.9 w + 1), args.kind rock, snow (capped above one snow line), ice (glaciers), ash (dark cinder, a glowing crater from w 3), sandstone (banded) or redrock (the badlands' and the Red Iron Mountains'); seed its shape - single, twin summits, a shoulder, a spur along its ridge, jagged, or (sandstone, red rock) a mesa. Side by side, peaks merge into one range",
  { category: "miniature", biomes: ["mountain", "keld", "tundra", "waste", "volcanic"], footprint: squareOf(peakW), sample: { seed: 3, args: { w: 3, kind: "snow" } } },
  (b, p) => {
    const w = peakW(p);
    const h = peakH(p, w);
    atScaled(b, p.x, 0, p.z, 0, p.scale ?? 1, () => drawPeak(b, w, h, str(p, "kind", "rock") as PeakKind, p.seed ?? 0));
    return { footprints: [square(p, w)] };
  },
  {},
  checks(oneOf("w", [1, 3, 5]), positive("h", 12), oneOf("kind", PEAK_KINDS)),
);

// --- Groves -------------------------------------------------------------------------------------------------------------

export const GROVE_KINDS = ["broadleaf", "pine", "snowpine", "swamp", "dead", "palm", "jungle", "elfwood"] as const;
export type GroveKind = (typeof GROVE_KINDS)[number];

/** Where a grove's trees stand about its tile's middle, and each one's size: three, four or five, seeded. */
function stands(n: number, random: () => number, spread = 0.24): [number, number, number][] {
  const out: [number, number, number][] = [];
  const turn = random() * TAU;
  if (n === 5) out.push([(random() - 0.5) * 0.08, (random() - 0.5) * 0.08, 1.08]);
  const ring = n === 5 ? 4 : n;
  for (let i = 0; i < ring; i++) {
    const a = turn + (i / ring) * TAU + (random() - 0.5) * 0.5;
    const d = spread * (n === 5 ? 1.25 : 1) * (0.85 + random() * 0.3);
    out.push([Math.sin(a) * d, Math.cos(a) * d, 0.88 + random() * 0.24]);
  }
  // The far ones first: drawn behind (no matter to the depth buffer; it keeps a model's order stable).
  return out.sort((a, c) => a[1] - c[1]);
}

/** A crown of leaves: a low sphere (20 triangles), squashed. */
const crownOf = (b: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, mat: Material, k: number) => b.blob(x, y, z, rx, ry, rx * 0.92, mat, [k * 5, k * 3], 0);
/** A trunk: three sides. */
const trunkOf = (b: MeshBuilder, x: number, z: number, y1: number, r: number, mat: Material) => limb(b, [x, 0, z], [x, y1, z], r, r * 0.7, mat, 3);

/** Hanging moss, 8 by 16, cut out: grey-green strands of ragged length. */
const mossCurtain = () =>
  cutout("mini-moss", () => {
    const p = new Pixmap(8, 16);
    p.fill(0, 0);
    const r = R.HANGING_MOSS;
    for (let x = 0; x < 8; x++) {
      const len = 6 + Math.round((1 - Math.abs(x - 3.5) / 4) * 7 + hash2(x, 2, 5) * 3);
      for (let y = 0; y < len; y++) if (hash2(x, y, 9) > 0.12) p.put(x, y, y > len - 3 ? r[5]! : (x + y) % 3 === 0 ? r[4]! : r[2 + (x % 2)]!);
    }
    return p;
  });

/** Still dark water lying under a swamp's trees, its edge ragged: a cut-out pool. */
const darkPool = () =>
  cutout(
    "mini-swamp-pool",
    () => {
      const p = new Pixmap(24, 24);
      p.fill(0, 0);
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          const d = Math.hypot(x - 11.5, y - 11.5) / 12 + (fbm(x, y, 6, 24, 3) - 0.5) * 0.45;
          if (d > 0.92) continue;
          p.set(x, y, d > 0.82 ? R.MUD[3]! : fbm(x * 2, y, 6, 24, 8) > 0.68 ? R.BOG[5]! : R.BOG[d > 0.6 ? 2 : 1]!);
        }
      }
      return p;
    },
    false,
  );

/** A palm frond, 16 by 6, cut out: a green midrib, leaflets either side, lit above, tapering to its tip. */
const frondOf = (r: Ramp) =>
  cutout(`mini-frond@${rampKey(r)}`, () => {
    const p = new Pixmap(16, 6);
    p.fill(0, 0);
    for (let x = 0; x < 16; x++) {
      const half = x < 1 ? 0 : x > 14 ? 0 : x < 3 || x > 12 ? 1 : 2;
      for (let dy = -half; dy <= half; dy++) {
        if (dy !== 0 && (x + Math.abs(dy)) % 3 === 0) continue;
        p.put(x, 3 + dy, dy === 0 ? r[2]! : dy < 0 ? r[dy === -2 ? 5 : 4]! : r[3]!);
      }
    }
    return p;
  });

/** A palm: a leaning trunk in two pieces, fronds drooping from its top. */
function palmTree(b: MeshBuilder, x: number, z: number, s: number, lean: number, leaves: Ramp, fronds: number, k: number): void {
  const bk = bark(C.STRAW, "palm");
  const top: V3 = [x + lean * 0.3 * s, 1.2 * s, z + 0.04];
  const mid: V3 = [x + lean * 0.08 * s, 0.62 * s, z];
  limb(b, [x, 0, z], mid, 0.07 * s, 0.06 * s, bk, 4);
  limb(b, mid, top, 0.06 * s, 0.045 * s, bk, 4);
  const leaf = frondOf(leaves);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * TAU + k;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const w = 0.13 * s;
    const end: V3 = [top[0] + dx * 0.62 * s, top[1] - 0.3 * s, top[2] + dz * 0.62 * s];
    const ox = -dz * w;
    const oz = dx * w;
    b.polygon(leaf, [
      [top[0] + ox, top[1] + 0.03, top[2] + oz],
      [end[0] + ox * 0.4, end[1], end[2] + oz * 0.4],
      [end[0] - ox * 0.4, end[1], end[2] - oz * 0.4],
      [top[0] - ox, top[1] + 0.03, top[2] - oz],
    ], [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
  }
}

/** An elfhame's platform: a ring of planks round a trunk, `y` up. */
function platform(b: MeshBuilder, x: number, z: number, y: number, r: number): void {
  const deck = material("mini-platform-deck", () => {
    const q = new Pixmap(8, 8);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) q.set(i, j, j % 3 === 0 ? C.WOOD[2]! : hash2(i, j, 3) < 0.15 ? C.WOOD[3]! : C.WOOD[4]!);
    return q;
  });
  b.cylinder(x, z, y - 0.05, y, r, 6, { mat: bark(R.ELFWOOD, "smooth") }, fitted(deck));
}

/** Draws a grove's trees about the origin; `far` draws its stand-in (fewer trees, no small things). */
function drawGrove(b: MeshBuilder, kind: GroveKind, seed: number, leavesOver: Ramp | undefined, far: boolean): void {
  const random = seeded(seed * 131 + 17);
  switch (kind) {
    case "pine":
    case "snowpine": {
      const needles = needleMaterial(leavesOver ?? R.PINE);
      const bk = bark(C.WOOD);
      const snow = snowCover();
      const trees = stands(far ? 3 : kind === "snowpine" ? 4 : 5, random, 0.26);
      trees.forEach(([x, z, s], i) => {
        const t = s * (0.95 + random() * 0.2);
        if (!far) trunkOf(b, x, z, 0.32 * t, 0.05 * t, bk);
        const tiers: [number, number, number][] = [
          [0.2, 0.95, 0.3],
          [0.58, 1.42, 0.22],
        ];
        for (const [y0, y1, r] of tiers) {
          spike(b, x, z, y0 * t, y1 * t, r * t, 6, needles, i + y0);
          if (kind === "snowpine") spike(b, x, z, (y0 + (y1 - y0) * 0.42) * t + 0.015, y1 * t + 0.03, r * t * 0.62, 6, snow, i + y0);
        }
      });
      break;
    }
    case "swamp": {
      const leaf = foliage(leavesOver ?? R.SWAMP_LEAF);
      const bk = bark(R.DEADWOOD, "furrowed");
      if (!far) b.decal(fitted(darkPool()), -0.72, -0.72, 0.72, 0.72, 0.012);
      const trees = stands(3, random, 0.25);
      trees.forEach(([x, z, s], i) => {
        const lean = (random() - 0.5) * 0.16;
        limb(b, [x, 0, z], [x + lean, 0.9 * s, z], 0.11 * s, 0.04 * s, bk, far ? 3 : 4);
        crownOf(b, x + lean, 1.05 * s, z, 0.42 * s, 0.24 * s, leaf, i + seed);
        if (!far) {
          // Moss hanging from the crown's rim, on the side the camera sees.
          const m = fitted(mossCurtain());
          for (const a of [-0.8, 0.7]) b.at(x + lean + Math.sin(a) * 0.3 * s, 0, z + Math.cos(a) * 0.28 * s, a, () => b.card(m, -0.1, 0.5 * s, 0.1, 0.92 * s, 0));
        }
      });
      break;
    }
    case "dead": {
      // Bleached snags: silver-grey trunks, a few crooked limbs.
      const bk = bark(C.BONE, "furrowed");
      const trees = stands(far ? 2 : 3, random, 0.24);
      for (const [x, z, s] of trees) {
        const lean = (random() - 0.5) * 0.2;
        const h = 1.25 * s;
        limb(b, [x, 0, z], [x + lean, h, z], 0.1 * s, 0.03 * s, bk, 4);
        for (let k = 0; k < (far ? 2 : 4); k++) {
          const t = 0.4 + k * 0.14;
          const a = random() * TAU;
          const from: V3 = [x + lean * t, h * t, z];
          const len = (0.42 - k * 0.06) * s;
          limb(b, from, [from[0] + Math.sin(a) * len, from[1] + len * 0.7, from[2] + Math.cos(a) * len * 0.7], 0.04 * s, 0.012 * s, bk, 3);
        }
      }
      break;
    }
    case "palm": {
      const leaves = leavesOver ?? R.PALM;
      const trees = stands(3, random, 0.24);
      trees.forEach(([x, z, s], i) => palmTree(b, x, z, s * 1.05, random() < 0.5 ? -1 : 1, leaves, far ? 4 : 6, seed + i * 1.7));
      if (!far) crownOf(b, (random() - 0.5) * 0.3, 0.14, (random() - 0.5) * 0.3, 0.26, 0.16, foliage(R.LUSH), seed);
      break;
    }
    case "jungle": {
      const leaf = foliage(leavesOver ?? R.LUSH);
      const dark = foliage(R.ELF_LEAF);
      const bk = bark(R.ELFWOOD, "smooth");
      const trees = stands(3, random, 0.26);
      trees.forEach(([x, z, s], i) => {
        if (i === 1 && !far) {
          palmTree(b, x, z, s * 1.25, random() < 0.5 ? -1 : 1, R.PALM, 5, seed + i);
          return;
        }
        if (!far) trunkOf(b, x, z, 0.95 * s, 0.06 * s, bk);
        crownOf(b, x, 1.12 * s, z, 0.44 * s, 0.3 * s, i === 0 ? leaf : dark, i + seed);
      });
      if (!far) {
        crownOf(b, (random() - 0.5) * 0.4, 0.22, 0.25 + random() * 0.1, 0.3, 0.2, dark, seed + 7);
        const v = fitted(mossCurtain());
        b.at(trees[0]![0], 0, trees[0]![1] + 0.3, 0.3, () => b.card(v, -0.06, 0.55, 0.06, 0.95, 0));
      }
      break;
    }
    case "elfwood": {
      // One of Llanowar's giants in miniature (two in some groves): a tall smooth trunk, a broad crown high up, a
      // platform or two round the trunk; a lesser tree beside it.
      const leaf = foliage(leavesOver ?? R.ELF_LEAF);
      const bk = bark(R.ELFWOOD, "smooth");
      const x = (random() - 0.5) * 0.16;
      const z = (random() - 0.5) * 0.16;
      const s = 0.92 + random() * 0.14;
      const h = 2.0 * s;
      const segs = far ? 4 : 6;
      limb(b, [x, 0, z], [x, h * 0.92, z], 0.15 * s, 0.1 * s, bk, segs);
      crownOf(b, x, h + 0.1, z, 0.62 * s, 0.32 * s, leaf, seed);
      if (!far) {
        crownOf(b, x - 0.32 * s, h - 0.22, z + 0.1, 0.36 * s, 0.24 * s, leaf, seed + 1);
        crownOf(b, x + 0.34 * s, h - 0.16, z - 0.08, 0.34 * s, 0.22 * s, leaf, seed + 2);
        platform(b, x, z, 0.95 * s, 0.32 * s);
        if (random() < 0.6) platform(b, x, z, 1.42 * s, 0.25 * s);
        // A lesser tree at its foot, on the side away from the camera's middle.
        const a = random() * TAU;
        trunkOf(b, x + Math.sin(a) * 0.34, z + Math.cos(a) * 0.34, 0.6, 0.05, bk);
        crownOf(b, x + Math.sin(a) * 0.34, 0.8, z + Math.cos(a) * 0.34, 0.3, 0.26, leaf, seed + 3);
      }
      break;
    }
    default: {
      const leaf = foliage(leavesOver ?? C.LEAF);
      const bk = bark(C.WOOD);
      // Round crowns big enough to touch their neighbours' over the tile's edges: one canopy, trunks under it.
      const trees = stands(far ? 2 : 4, random, far ? 0.2 : 0.26);
      trees.forEach(([x, z, s], i) => {
        if (!far) trunkOf(b, x, z, 0.6 * s, 0.065 * s, bk);
        crownOf(b, x, 0.95 * s, z, (far ? 0.52 : 0.44) * s, (far ? 0.42 : 0.38) * s, leaf, i + seed);
      });
    }
  }
}

const groveKind = (p: PropData): GroveKind => {
  const k = str(p, "kind", "broadleaf");
  return (GROVE_KINDS as readonly string[]).includes(k) ? (k as GroveKind) : "broadleaf";
};

prop(
  "grove",
  "a clump of miniature trees on one tile of the travel map (blocked): x, z the tile's middle; args.kind broadleaf, pine, snowpine, swamp (hung with moss over dark water), dead, palm, jungle or elfwood (one of Llanowar's giants in miniature, 2.2-2.6 high, a platform round its trunk); seed its trees. Groves side by side are one canopy; its palette's leaves recolor the crowns",
  { category: "miniature", biomes: ["forest", "llanowar", "swamp", "morass", "tundra", "keld", "coast", "verdura", "waste", "plains"], footprint: centred1(), sample: { seed: 2, args: { kind: "broadleaf" } } },
  (b, p, pal) => {
    const kind = groveKind(p);
    atScaled(b, p.x, 0, p.z, turnOf(p), p.scale ?? 1, () => drawGrove(b, kind, p.seed ?? 0, pal.leaves, false));
    return kind === "elfwood" ? { footprints: [square(p, 1)] } : {};
  },
  {},
  checks(oneOf("kind", GROVE_KINDS)),
  (b, p, pal) => atScaled(b, p.x, 0, p.z, turnOf(p), p.scale ?? 1, () => drawGrove(b, groveKind(p), p.seed ?? 0, pal.leaves, true)),
);

function centred1(): Footprint {
  return { rect: [-0.5, -0.5, 0.5, 0.5], blocks: true };
}

// --- Town icons and landmarks (their own files) ---------------------------------------------------------------------------

export { LANDMARK_KINDS, LANDMARK_LIGHTS, TOWN_SIZES, TOWN_STYLES };

const townSize = (p: PropData): number => TOWN_SIZES[str(p, "size", "town") as keyof typeof TOWN_SIZES] ?? 5;

prop(
  "town-icon",
  "a miniature town on the travel map, entered from any side a road reaches: x, z the middle of its square; args.size capital (7x7), town (5x5) or village (3x3), the whole square blocked; args.style benalish (a white keep, red roofs, blue banners), tolarian (marble and blue domes, the Academy's), urborg (a stilt village over dark water; town or capital, the Vess manor), keldon (a clan hold: longhouses, a great hall, a palisade), llanowar (an elfhame among giant trees), argive (the Vess manor's stone) or village (cottages, thatch, a windmill); args.walled a wall round it with a gate on each side (else its streets run out on all four); seed its houses",
  { category: "miniature", biomes: ["any"], footprint: squareOf(townSize), sample: { seed: 1, args: { size: "town", style: "benalish", walled: true } } },
  (b, p) => {
    const n = townSize(p);
    atScaled(b, p.x, 0, p.z, turnOf(p), p.scale ?? 1, () => townIcon(b, n, str(p, "style", "village"), p.args?.walled === true, p.seed ?? 0));
    return { footprints: [square(p, n)] };
  },
  {},
  checks(oneOf("size", Object.keys(TOWN_SIZES), false), oneOf("style", TOWN_STYLES, false), oneOf("walled", [true, false])),
);

prop(
  "landmark",
  "a miniature wonder of the travel map on a 3x3 square (blocked): x, z its middle; args.kind cathedral (the Cathedral of Serra), great-oak (the Oak of the Oath), floating-towers (towers hanging over the ground), ruin, obelisk, arena or lighthouse (its lantern's light: LANDMARK_LIGHTS, added to the chunk's lights as a lit prop's are); turned by rot (fronts face south)",
  {
    category: "miniature",
    biomes: ["any"],
    footprint: squareOf(() => 3),
    sample: { args: { kind: "cathedral" } },
  },
  (b, p): Omit<Built, "model"> => {
    const kind = str(p, "kind", "ruin");
    atScaled(b, p.x, 0, p.z, turnOf(p), p.scale ?? 1, () => landmark(b, kind, p.seed ?? 0));
    return { footprints: [square(p, 3)] };
  },
  {},
  checks(oneOf("kind", LANDMARK_KINDS, false)),
);
