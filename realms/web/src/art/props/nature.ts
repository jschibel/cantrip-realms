import { type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import { Pixmap, type Rgb, hash2, seeded } from "../paint/pixmap";
import * as R from "../paint/ramps";
import type { PropData } from "../../world/format";
import { along, centred, prop } from "./catalogue";
import { bark, cutout, disc, foliage, frustum, limb, lump, needleMaterial, ringsMaterial, rock, snowCover, standingCard } from "./kit";
import { needs, num, point, str, turnOf } from "./registry";

// The open country's growing things and its stone, by biome: Benalia's oaks and birches; Llanowar's giant trees,
// undergrowth and ferns; the Morass's dead trees and cypresses hung with moss; Keld's pines and snowy firs; the coasts'
// palms and scrub; Verdura's lush trees and flowering bushes; stumps, logs, mushrooms, reeds and lily pads; and rocks of
// every stone, crags, cliffs and whole mountains for the far view. Each tree's crown is its palette's `leaves` and its
// trunk its `bark`; a tree's size is its `scale` and its shape its `seed`.

type V3 = [number, number, number];
const s1 = (p: PropData) => p.scale ?? 1;
const sd = (p: PropData) => p.seed ?? 0;

// --- Pictures -------------------------------------------------------------------------------------------------------------

/** A fern's frond, 8 by 20, cut out: a midrib and paired leaflets shrinking to the tip. */
function frondPicture(r: Ramp): Pixmap {
  const p = new Pixmap(8, 20);
  p.fill(0, 0);
  for (let y = 0; y < 20; y++) {
    const half = Math.round(3.5 * Math.sin((Math.PI * (y + 2)) / 22));
    for (let dx = 0; dx <= half; dx++) {
      if (y % 3 === 2 && dx > 0) continue;
      const c = dx === 0 ? r[2]! : dx === half ? r[5]! : y % 3 === 0 ? r[4]! : r[3]!;
      p.put(3 - dx, y, c);
      p.put(4 + dx, y, dx === 0 ? r[2]! : y % 3 === 0 ? r[3]! : r[2]!);
    }
  }
  return p;
}

/** Hanging moss, 8 by 16, cut out: grey-green strands of ragged length. */
function mossStrands(r: Ramp): Pixmap {
  const p = new Pixmap(8, 16);
  p.fill(0, 0);
  for (let x = 0; x < 8; x++) {
    // Strands of ragged length, longest in the middle, hanging from a ragged top.
    const mid = 1 - Math.abs(x - 3.5) / 4;
    const start = Math.floor(hash2(x, 1, 5) * 3);
    const len = Math.round(5 + mid * 8 + hash2(x, 3, 7) * 4);
    for (let y = start; y < Math.min(16, start + len); y++) {
      if (hash2(x, y, 9) < 0.1) continue;
      const tip = y > start + len - 3;
      p.put(x, y, tip ? r[5]! : (x + y) % 3 === 0 ? r[4]! : x % 2 ? r[2]! : r[3]!);
    }
  }
  return p;
}

/** Reeds, 16 by 24, cut out: tall blades and a few cattails. */
function reedPicture(r: Ramp): Pixmap {
  const p = new Pixmap(16, 24);
  p.fill(0, 0);
  const random = seeded(61);
  for (let k = 0; k < 11; k++) {
    const x0 = 1 + Math.floor(random() * 14);
    const h = 12 + Math.floor(random() * 11);
    const lean = random() < 0.5 ? -1 : 1;
    for (let i = 0; i < h; i++) {
      const x = x0 + (i > h * 0.7 ? lean : 0);
      p.put(x, 23 - i, i > h - 3 ? r[5]! : i < 4 ? r[1]! : k % 2 ? r[3]! : r[4]!);
    }
    if (k % 3 === 0) {
      // A cattail: a brown club near the top.
      for (let i = h - 6; i < h - 2; i++) {
        p.put(x0, 23 - i, C.WOOD[2]!);
        p.put(x0 + 1, 23 - i, C.WOOD[3]!);
      }
    }
  }
  return p;
}

/** A palm frond, 32 by 8, cut out: a rib down the middle, leaflets hanging from it, darker below. */
function palmFrond(r: Ramp): Pixmap {
  const p = new Pixmap(32, 8);
  p.fill(0, 0);
  for (let x = 0; x < 32; x++) {
    const half = Math.round(3.5 * Math.sin((Math.PI * (x + 3)) / 35));
    for (let dy = -half; dy <= half; dy++) {
      if ((x + dy) % 3 === 0 && dy !== 0) continue;
      p.put(x, 4 + dy, dy === 0 ? C.STRAW[2]! : dy < 0 ? r[4]! : r[3]!);
    }
  }
  return p;
}

/** A vine, 6 by 24, cut out: a stem with leaves either side, flowers on Verdura's. */
function vinePicture(r: Ramp, flowers: boolean): Pixmap {
  const p = new Pixmap(6, 24);
  p.fill(0, 0);
  for (let y = 0; y < 24; y++) {
    const x = 2 + Math.round(Math.sin(y / 3));
    p.put(x, y, r[2]!);
    if (y % 4 === 1) {
      p.put(x - 1, y, r[4]!);
      p.put(x - 2, y + 1, r[3]!);
    }
    if (y % 4 === 3) {
      p.put(x + 1, y, r[4]!);
      p.put(x + 2, y + 1, r[3]!);
    }
    if (flowers && y % 7 === 5) {
      p.put(x, y, C.PINK[4]!);
      p.put(x + 1, y + 1, C.PINK[3]!);
    }
  }
  return p;
}

/** Leaves thick with flowers: the slice's flower bed (draw.ts) from any ramp and blossom. */
function blossomPicture(r: Ramp, petals: readonly Rgb[]): Pixmap {
  const p = new Pixmap(32, 32, r[2]!);
  const random = seeded(71);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (hash2(x, y, 71) < 0.25) p.set(x, y, r[hash2(x, y, 3) < 0.5 ? 3 : 4]!);
  for (let k = 0; k < 34; k++) {
    const x = Math.floor(random() * 32);
    const y = Math.floor(random() * 32);
    const c = petals[k % petals.length]!;
    p.set(x, y, c);
    p.set(x + 1, y, c);
    p.set(x, y + 1, c);
    p.set(x + 1, y + 1, C.GOLD[5]!);
  }
  return p;
}

/** A mushroom's cap: red with white spots, brown and speckled, or the Morass's glowing violet. */
function capPicture(kind: "red" | "brown" | "glow" | "elf"): Pixmap {
  const ramp = kind === "red" ? C.RED : kind === "brown" ? C.WOOD : kind === "glow" ? C.PURPLE : R.ELF_CLOTH;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = y < 5 ? ramp[4]! : y < 11 ? ramp[3]! : ramp[2]!;
      if (kind === "red" && hash2(x >> 1, y >> 1, 3) < 0.18) c = 0xfff8f0;
      if (kind === "brown" && hash2(x, y, 4) < 0.1) c = ramp[5]!;
      if ((kind === "glow" || kind === "elf") && hash2(x >> 1, y >> 1, 5) < 0.15) c = kind === "glow" ? 0xe8b8ff : C.GOLD[5]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A lily pad, 12 by 12, cut out: a round leaf with its notch, a vein or two, and on some a flower. */
function lilyPicture(flower: boolean): Pixmap {
  const p = new Pixmap(12, 12);
  p.fill(0, 0);
  const g = C.GRASS;
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const d = Math.hypot(x - 5.5, y - 5.5);
      if (d > 5.6) continue;
      const notch = x >= 6 && Math.abs(y - 5.5) < (x - 5) * 0.5;
      if (notch) continue;
      p.set(x, y, d > 4.6 ? g[2]! : (x + y) % 5 === 0 ? g[5]! : g[4]!);
    }
  }
  if (flower) {
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const)
      p.set(4 + dx, 5 + dy, C.PINK[4]!);
    p.set(4, 5, C.GOLD[4]!);
  }
  return p;
}

const frond = (r: Ramp) => cutout(`frond@${rampKey(r)}`, () => frondPicture(r));
const hangingMoss = (r: Ramp) => cutout(`hanging-moss@${rampKey(r)}`, () => mossStrands(r));
const reeds = (r: Ramp) => cutout(`reeds@${rampKey(r)}`, () => reedPicture(r));
const palmLeaf = (r: Ramp) => cutout(`palm-frond@${rampKey(r)}`, () => palmFrond(r));
const vine = (r: Ramp, flowers: boolean) => cutout(`vine${flowers ? "-flowering" : ""}@${rampKey(r)}`, () => vinePicture(r, flowers));
const blossom = (r: Ramp, petals: readonly Rgb[]) => material(`blossom@${rampKey(r)}+${rampKey(petals)}`, () => blossomPicture(r, petals), { smooth: true });

// --- Near and far -----------------------------------------------------------------------------------------------------

/**
 * How finely the growing things are drawn: near, a crown's clumps are spheres of 80 triangles; far (Built.far, the far
 * zoom step), of 20, fewer of them, and the small things (roots, vines, moss, blossom) left out - the silhouette and the
 * painted leaves kept in about a hundred triangles.
 */
let FAR = false;

/** A blob at the detail of the drawing under way. */
function bl(b: MeshBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, mat: Material, offset: readonly [number, number] = [0, 0]): void {
  b.blob(cx, cy, cz, rx, ry, rz, mat, offset, FAR ? 0 : 1);
}

/** The far stand-in of a drawing: the same function drawn coarse. */
function far<A extends unknown[]>(draw: (b: MeshBuilder, ...args: A) => unknown): (b: MeshBuilder, ...args: A) => void {
  return (b, ...args) => {
    FAR = true;
    try {
      draw(b, ...args);
    } finally {
      FAR = false;
    }
  };
}

// --- Trees ---------------------------------------------------------------------------------------------------------------

/** Clumps of foliage round a centre: a crown of `n` blobs, seeded. */
function crown(b: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, n: number, mat: Material, seed: number, spread = 0.6): void {
  const random = seeded(seed * 31 + 7);
  bl(b, x, y, z, rx, ry, rx * 0.95, mat, [seed * 5, 0]);
  const clumps = FAR ? Math.min(n, 3) : n;
  for (let i = 0; i < clumps; i++) {
    const a = (i / n) * Math.PI * 2 + random() * 0.6;
    const r = rx * (0.55 + random() * 0.15);
    const k = 0.55 + random() * 0.2;
    bl(b, x + Math.sin(a) * rx * spread, y + (random() - 0.6) * ry * 0.7, z + Math.cos(a) * rx * spread * 0.8, r * k / 0.6, ry * k, r * k / 0.6, mat, [i * 7 + seed, i * 3]);
  }
}

/** Roots flaring out from a trunk's foot. */
function roots(b: MeshBuilder, x: number, z: number, r: number, reach: number, mat: Material, n = 4, seed = 0): void {
  if (FAR) return;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    limb(b, [x + Math.sin(a) * r * 0.5, r * 1.4, z + Math.cos(a) * r * 0.5], [x + Math.sin(a) * reach, 0, z + Math.cos(a) * reach], r * 0.45, r * 0.12, mat, 5);
  }
}

function oak(b: MeshBuilder, p: PropData, leaves: Ramp, barkRamp: Ramp): void {
  const s = s1(p);
  const { x, z } = p;
  const seed = sd(p);
  const bk = bark(barkRamp);
  frustum(b, x, z, 0, 1.7 * s, 0.3 * s, 0.2 * s, FAR ? 4 : 6, bk);
  roots(b, x, z, 0.24 * s, 0.6 * s, bk, 4, seed);
  if (!FAR) {
    limb(b, [x, 1.4 * s, z], [x - 0.7 * s, 2.2 * s, z + 0.1 * s], 0.13 * s, 0.07 * s, bk, 4);
    limb(b, [x, 1.5 * s, z], [x + 0.75 * s, 2.3 * s, z - 0.1 * s], 0.12 * s, 0.06 * s, bk, 4);
  }
  crown(b, x, 2.65 * s, z, 1.35 * s, 0.95 * s, 3, foliage(leaves), seed, 0.85);
}

function birch(b: MeshBuilder, p: PropData, leaves: Ramp, barkRamp: Ramp): void {
  const s = s1(p);
  const { x, z } = p;
  const seed = sd(p);
  const bk = bark(barkRamp, "birch");
  const random = seeded(seed + 3);
  const trunks: [number, number][] = seed % 2 ? [[0, 0]] : [
    [-0.12, 0.02],
    [0.16, -0.04],
  ];
  for (const [dx, dz] of trunks) {
    const lean = (random() - 0.5) * 0.4;
    limb(b, [x + dx, 0, z + dz], [x + dx + lean * s, 3.0 * s, z + dz], 0.11 * s, 0.06 * s, bk, FAR ? 3 : 5);
  }
  const leaf = foliage(leaves);
  bl(b, x, 2.9 * s, z, 0.75 * s, 1.0 * s, 0.7 * s, leaf, [seed * 3, 2]);
  bl(b, x - 0.35 * s, 2.35 * s, z + 0.15 * s, 0.5 * s, 0.6 * s, 0.5 * s, leaf, [seed, 9]);
  bl(b, x + 0.38 * s, 2.5 * s, z + 0.05 * s, 0.5 * s, 0.65 * s, 0.5 * s, leaf, [5, seed]);
  bl(b, x + 0.05 * s, 3.55 * s, z - 0.1 * s, 0.45 * s, 0.5 * s, 0.45 * s, leaf, [2, 2 + seed]);
}

function giantTree(b: MeshBuilder, p: PropData, leaves: Ramp, barkRamp: Ramp): Pick<import("../recipe").Built, "frames"> | void {
  const s = s1(p);
  const { x, z } = p;
  const seed = sd(p);
  const bk = bark(barkRamp, "smooth");
  frustum(b, x, z, 0, 6.6 * s, 0.85 * s, 0.55 * s, FAR ? 6 : 10, bk);
  // Buttress roots, broad and low (far: none).
  for (let i = 0; i < (FAR ? 0 : 6); i++) {
    const a = (i / 6) * Math.PI * 2 + seed * 0.7;
    limb(b, [x + Math.sin(a) * 0.5 * s, 1.6 * s, z + Math.cos(a) * 0.5 * s], [x + Math.sin(a) * 1.6 * s, 0, z + Math.cos(a) * 1.6 * s], 0.35 * s, 0.14 * s, bk, 6);
  }
  // Great limbs up into the crown.
  for (const [dx, dz] of [
    [-1.4, 0.3],
    [1.5, 0.1],
    [0.2, -1.2],
  ] as const)
    if (!FAR) limb(b, [x, 5.2 * s, z], [x + dx * s, 6.9 * s, z + dz * s], 0.32 * s, 0.14 * s, bk);
  // Shelf fungus on the trunk.
  const shelf = material("shelf-fungus", () => capPicture("brown"), { smooth: true });
  if (!FAR) bl(b, x - 0.62 * s, 2.4 * s, z + 0.55 * s, 0.32 * s, 0.07 * s, 0.25 * s, shelf);
  if (!FAR) bl(b, x + 0.5 * s, 3.3 * s, z + 0.66 * s, 0.26 * s, 0.06 * s, 0.2 * s, shelf);
  const leaf = foliage(leaves);
  crown(b, x, 7.6 * s, z, 2.4 * s, 1.5 * s, 5, leaf, seed, 0.95);
  if (FAR) return;
  // Vines hanging from the crown's rim.
  const v = vine(leaves, false);
  const random = seeded(seed + 9);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + random();
    const r = 2.0 * s;
    standingCard(b, fitted(v), x + Math.sin(a) * r, 5.0 * s + random() * 0.6, z + Math.cos(a) * r * 0.8, 0.375, 1.5, a);
  }
}

function deadTree(b: MeshBuilder, p: PropData, barkRamp: Ramp, mossRamp?: Ramp): void {
  const s = s1(p);
  const { x, z } = p;
  const seed = sd(p);
  const bk = bark(barkRamp, "furrowed");
  const random = seeded(seed * 13 + 5);
  const lean = (random() - 0.5) * 0.5;
  const top: V3 = [x + lean * s, 3.0 * s, z];
  limb(b, [x, 0, z], top, 0.24 * s, 0.07 * s, bk, 6);
  roots(b, x, z, 0.2 * s, 0.55 * s, bk, 4, seed);
  const tips: V3[] = [];
  for (let i = 0; i < 5; i++) {
    const t = 0.4 + i * 0.13;
    const from: V3 = [x + lean * s * t, 3.0 * s * t, z];
    const a = i * 2.3 + seed;
    const len = (0.9 - i * 0.08) * s;
    const to: V3 = [from[0] + Math.sin(a) * len, from[1] + len * 0.7, from[2] + Math.cos(a) * len * 0.6];
    limb(b, from, to, 0.08 * s, 0.025 * s, bk, 4);
    // A twig off each branch, crooked.
    const twig: V3 = [to[0] + Math.sin(a + 1.2) * 0.35 * s, to[1] + 0.25 * s, to[2] + Math.cos(a + 1.2) * 0.2 * s];
    if (!FAR) limb(b, to, twig, 0.03 * s, 0.015 * s, bk, 3);
    tips.push(to);
  }
  if (mossRamp && !FAR) {
    const m = hangingMoss(mossRamp);
    tips.forEach((t, i) => standingCard(b, fitted(m), t[0], t[1] - 0.95, t[2], 0.4, 1.0, i * 1.3));
  }
}

function cypress(b: MeshBuilder, p: PropData, leaves: Ramp, barkRamp: Ramp, mossRamp: Ramp): void {
  const s = s1(p);
  const { x, z } = p;
  const seed = sd(p);
  const bk = bark(barkRamp, "furrowed");
  frustum(b, x, z, 0, 0.9 * s, 0.55 * s, 0.24 * s, 8, bk);
  frustum(b, x, z, 0.9 * s, 3.8 * s, 0.24 * s, 0.13 * s, 7, bk);
  // Knees: little stumps of root standing up from the mud round it.
  const random = seeded(seed + 21);
  for (let i = 0; i < (FAR ? 0 : 4); i++) {
    const a = (i / 4) * Math.PI * 2 + random();
    const r = (0.8 + random() * 0.4) * s;
    frustum(b, x + Math.sin(a) * r, z + Math.cos(a) * r, 0, (0.18 + random() * 0.14) * s, 0.09 * s, 0.03 * s, 5, bk);
  }
  const leaf = foliage(leaves);
  const tiers: [number, number, number][] = [
    [2.5, 1.25, 0.45],
    [3.25, 1.0, 0.45],
    [3.95, 0.7, 0.42],
    [4.5, 0.4, 0.35],
  ];
  for (const [y, r, h] of tiers) bl(b, x, y * s, z, r * s, h * s, r * 0.9 * s, leaf, [seed * 3 + y * 4, y * 2]);
  if (FAR) return;
  const m = hangingMoss(mossRamp);
  for (const [y, r] of tiers.slice(0, 3)) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + y + random();
      standingCard(b, fitted(m), x + Math.sin(a) * r * 0.85 * s, (y - 1.2) * s, z + Math.cos(a) * r * 0.75 * s, 0.5, 1.0, a);
    }
  }
}

function pine(b: MeshBuilder, p: PropData, needlesRamp: Ramp, barkRamp: Ramp, snowy: boolean): void {
  const s = s1(p);
  const { x, z } = p;
  const seed = sd(p);
  frustum(b, x, z, 0, 3.6 * s, 0.17 * s, 0.05 * s, FAR ? 4 : 6, bark(barkRamp));
  const n = needleMaterial(needlesRamp);
  const snow = snowCover();
  const tiers = 4;
  for (let k = 0; k < tiers; k++) {
    const r = (1.2 - k * 0.24) * s;
    const y0 = (0.8 + k * 0.8) * s;
    const h = (1.45 - k * 0.1) * s;
    frustum(b, x, z, y0, y0 + h, r, 0, FAR ? 6 : 9, n, [seed * 3 + k * 5, k * 7]);
    if (snowy) {
      // Snow on each tier's upper slopes, standing a little proud of the needles; the needles show in a band below.
      const t = 0.3;
      frustum(b, x, z, y0 + h * t + 0.04 * s, y0 + h + 0.1 * s, r * (1 - t) + 0.08 * s, 0, FAR ? 6 : 9, snow);
    }
  }
}

function palm(b: MeshBuilder, p: PropData, leaves: Ramp): void {
  const s = s1(p);
  const { x, z } = p;
  const seed = sd(p);
  const bk = bark(C.STRAW, "palm");
  const lean = seed % 2 ? 0.9 : -0.8;
  const pt = (t: number): V3 => [x + lean * s * t * t, 3.3 * s * t, z + 0.1 * s * t];
  const parts = FAR ? 2 : 5;
  for (let i = 0; i < parts; i++) limb(b, pt(i / parts), pt((i + 1) / parts), (0.17 - i * 0.03) * s, (0.155 - i * 0.03) * s, bk, FAR ? 4 : 6);
  const top = pt(1);
  const leaf = palmLeaf(leaves);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + seed;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const w = 0.32 * s;
    const mid: V3 = [top[0] + dx * 0.9 * s, top[1] + 0.25 * s, top[2] + dz * 0.9 * s];
    const end: V3 = [top[0] + dx * 1.7 * s, top[1] - 0.55 * s, top[2] + dz * 1.7 * s];
    // Each frond two quads, its width across (perpendicular to its run, level), its picture running along it.
    const ox = -dz * w;
    const oz = dx * w;
    // Wound so each quad faces up (lit by the sun, not shaded as an underside).
    b.polygon(leaf, [
      [top[0] + ox, top[1], top[2] + oz],
      [mid[0] + ox, mid[1], mid[2] + oz],
      [mid[0] - ox, mid[1], mid[2] - oz],
      [top[0] - ox, top[1], top[2] - oz],
    ], [
      [0, 1],
      [0.5, 1],
      [0.5, 0],
      [0, 0],
    ]);
    b.polygon(leaf, [
      [mid[0] + ox, mid[1], mid[2] + oz],
      [end[0] + ox * 0.6, end[1], end[2] + oz * 0.6],
      [end[0] - ox * 0.6, end[1], end[2] - oz * 0.6],
      [mid[0] - ox, mid[1], mid[2] - oz],
    ], [
      [0.5, 1],
      [1, 0.8],
      [1, 0.2],
      [0.5, 0],
    ]);
  }
  if (FAR) return;
  const nut = material("coconut", () => new Pixmap(4, 4, C.WOOD[2]!), { smooth: true });
  for (let i = 0; i < 3; i++) bl(b, top[0] + Math.sin(i * 2.1) * 0.14 * s, top[1] - 0.12 * s, top[2] + Math.cos(i * 2.1) * 0.14 * s, 0.1 * s, 0.11 * s, 0.1 * s, nut);
}

function lushTree(b: MeshBuilder, p: PropData, leaves: Ramp, barkRamp: Ramp): void {
  const s = s1(p);
  const { x, z } = p;
  const seed = sd(p);
  const bk = bark(barkRamp, "smooth");
  limb(b, [x, 0, z], [x + 0.3 * s, 1.6 * s, z], 0.26 * s, 0.2 * s, bk, 7);
  limb(b, [x + 0.3 * s, 1.6 * s, z], [x - 0.2 * s, 2.6 * s, z], 0.2 * s, 0.14 * s, bk, 7);
  roots(b, x, z, 0.22 * s, 0.6 * s, bk, 5, seed);
  const leaf = foliage(leaves);
  crown(b, x - 0.1 * s, 3.0 * s, z, 1.6 * s, 0.9 * s, 4, leaf, seed, 0.9);
  if (FAR) return;
  const bloom = blossom(leaves, [C.PINK[4]!, 0xfff8f0, C.PINK[3]!]);
  const random = seeded(seed + 4);
  for (let i = 0; i < 2; i++) {
    const a = i * 2.9 + seed;
    bl(b, x + Math.sin(a) * 1.2 * s, (2.9 + random() * 0.5) * s, z + Math.cos(a) * 0.9 * s, 0.55 * s, 0.4 * s, 0.5 * s, bloom, [i * 9, 3]);
  }
  const v = vine(leaves, true);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + random();
    standingCard(b, fitted(v), x + Math.sin(a) * 1.4 * s, 1.3 * s, z + Math.cos(a) * 1.1 * s, 0.375, 1.5, a);
  }
}

function fern(b: MeshBuilder, x: number, z: number, s: number, r: Ramp, seed: number): void {
  const f = fitted(frond(r));
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    b.at(x, 0, z, a, () => {
      // A frond arching out: a quad leaning away from the middle.
      const len = (0.75 + ((i * 37 + seed) % 5) * 0.06) * s;
      const w = 0.22 * s;
      b.quad(f, [
        [-w, 0.05, 0],
        [w, 0.05, 0],
        [w * 0.7, len * 0.55, len * 0.8],
        [-w * 0.7, len * 0.55, len * 0.8],
      ], (c) => c[0], (c) => c[1]);
    });
  }
}

const TREE_INFO = (biomes: string[], w = 1, sample: PropData["seed"] = 1) => ({ category: "tree", biomes, footprint: centred(w * 0.6, w * 0.6), sample: { seed: sample } });

type Draw = (b: MeshBuilder, p: PropData, pal: Palette) => unknown;

/** A tree: drawn near, and the same drawing coarse as its far stand-in (Built.far). */
function tree(id: string, about: string, info: Parameters<typeof prop>[2], draw: Draw, palette: Palette): void {
  prop(id, about, info, (b, p, pal) => void draw(b, p, pal), palette, undefined, far(draw));
}

const oakOf: Draw = (b, p, pal) => oak(b, p, pal.leaves!, pal.bark!);
const giantOf: Draw = (b, p, pal) => giantTree(b, p, pal.leaves!, pal.bark!);
const cypressOf: Draw = (b, p, pal) => cypress(b, p, pal.leaves!, pal.bark!, pal.moss!);
const CYPRESS_PALETTE: Palette = { leaves: R.CYPRESS, bark: R.DEADWOOD, moss: R.HANGING_MOSS };

tree("oak", "a Benalish oak: a broad crown on a stout trunk at x, z; scale (1), seed its shape", TREE_INFO(["plains", "farmland", "forest", "town"]), oakOf, { leaves: C.LEAF, bark: C.WOOD });
tree("birch", "a birch: white trunks (one or two by seed), a light narrow crown, at x, z; scale (1)", TREE_INFO(["plains", "forest", "tundra"]), (b, p, pal) => birch(b, p, pal.leaves!, pal.bark!), { leaves: R.BIRCH_LEAF, bark: R.BIRCH });
tree(
  "giant-tree",
  "a giant of Llanowar at the heart of an elfhame: a mossy trunk on buttress roots, its crown eight tiles up, vines hanging, at x, z; args.size the tiles it fills (3: scale size / 3), or scale",
  { category: "tree", biomes: ["llanowar", "forest"], footprint: centred(3, 3), sample: { seed: 2 } },
  (b, p, pal) => giantOf(b, { ...p, scale: p.scale ?? num(p, "size", 3) / 3 }, pal),
  { leaves: R.ELF_LEAF, bark: R.ELFWOOD },
);
tree(
  "great-tree",
  "one of Llanowar's great trees in the forest, its trunk filling its tile, at x, z; scale (0.55), seed its crown",
  { category: "tree", biomes: ["llanowar", "forest"], footprint: centred(1, 1), sample: { seed: 3 } },
  (b, p, pal) => giantOf(b, { ...p, scale: p.scale ?? 0.55 }, pal),
  { leaves: R.ELF_LEAF, bark: R.ELFWOOD },
);
tree("elf-tree", "a Llanowar tree: an oak's shape in the elves' vivid green on mossy bark, at x, z; scale (1.2)", TREE_INFO(["llanowar"]), (b, p, pal) => oakOf(b, { ...p, scale: p.scale ?? 1.2 }, pal), { leaves: R.ELF_LEAF, bark: R.ELFWOOD });
tree("dead-tree", "a dead tree: a bare, crooked trunk and branches, at x, z; scale (1), seed its branches", TREE_INFO(["swamp", "morass", "waste", "volcanic"]), (b, p, pal) => deadTree(b, p, pal.bark!), { bark: R.DEADWOOD });
tree("mossy-dead-tree", "a dead tree of the Morass, hung with grey moss from every branch, at x, z; scale (1)", TREE_INFO(["morass", "swamp"]), (b, p, pal) => deadTree(b, p, pal.bark!, pal.moss!), { bark: R.DEADWOOD, moss: R.HANGING_MOSS });
tree("cypress", "a swamp cypress: a flared foot, knees round it, olive tiers hung with moss, at x, z; scale (1)", TREE_INFO(["swamp", "morass"]), cypressOf, CYPRESS_PALETTE);
tree("swamp-tree", "a drowned, moss-hung tree of the Morass and Amjad at x, z (the cypress); scale (1)", TREE_INFO(["swamp", "morass"]), cypressOf, CYPRESS_PALETTE);
tree("pine", "a pine: tiers of blue-green needles on a straight trunk, at x, z; scale (1)", TREE_INFO(["tundra", "keld", "mountain", "forest"]), (b, p, pal) => pine(b, p, pal.needles!, pal.bark!, false), { needles: R.PINE, bark: C.WOOD });
tree("snowy-fir", "a fir under snow: each tier capped white, at x, z; scale (1)", TREE_INFO(["keld", "tundra", "mountain"]), (b, p, pal) => pine(b, p, pal.needles!, pal.bark!, true), { needles: R.PINE, bark: C.WOOD });
tree("palm", "a palm: a leaning ringed trunk, drooping fronds and coconuts, at x, z; scale (1), seed which way it leans", TREE_INFO(["coast", "verdura"]), (b, p, pal) => palm(b, p, pal.leaves!), { leaves: R.PALM });
tree("lush-tree", "a tree of Verdura: a broad teal crown in blossom, flowering vines hanging, at x, z; scale (1)", TREE_INFO(["verdura"], 1.3), (b, p, pal) => lushTree(b, p, pal.leaves!, pal.bark!), { leaves: R.LUSH, bark: R.ELFWOOD });

// --- Undergrowth and small growing things ------------------------------------------------------------------------------------

prop("fern", "a fern: fronds arching out from x, z; scale (1)", { category: "plant", biomes: ["forest", "llanowar", "verdura", "swamp"], footprint: centred(0.5, 0.5, false) }, (b, p, pal) => fern(b, p.x, p.z, s1(p), pal.leaves!, sd(p)), { leaves: R.ELF_LEAF });
prop(
  "undergrowth",
  "undergrowth: ferns and low leafy bushes round x, z (about a tile and a half across); seed its make-up",
  { category: "plant", biomes: ["forest", "llanowar", "verdura"], footprint: centred(1.5, 1.5), sample: { seed: 3 } },
  (b, p, pal) => {
    const seed = sd(p);
    const random = seeded(seed + 1);
    const leaf = foliage(pal.bush!);
    bl(b, p.x - 0.3, 0.32, p.z + 0.1, 0.5, 0.36, 0.45, leaf, [seed, 1]);
    bl(b, p.x + 0.35, 0.26, p.z - 0.15, 0.42, 0.3, 0.38, leaf, [seed + 5, 3]);
    fern(b, p.x + 0.1 + (random() - 0.5) * 0.4, p.z + 0.35, 0.9, pal.leaves!, seed);
    fern(b, p.x - 0.5, p.z - 0.35, 0.7, pal.leaves!, seed + 2);
  },
  { leaves: R.ELF_LEAF, bush: C.LEAF },
);
prop("giant-fern", "a giant fern of Verdura or Llanowar: fronds as long as a man, from x, z; scale (2.2)", { category: "plant", biomes: ["verdura", "llanowar"], footprint: centred(1, 1) }, (b, p, pal) => fern(b, p.x, p.z, p.scale ?? 2.2, pal.leaves!, sd(p)), { leaves: R.LUSH });
prop(
  "flowering-bush",
  "a bush in flower at x, z; args.r its radius (0.5); args.petals pink|white|gold|blue",
  { category: "plant", biomes: ["verdura", "plains", "town"], footprint: centred(0.8, 0.8), sample: { args: { petals: "pink" } } },
  (b, p, pal) => {
    const r = num(p, "r", 0.5);
    const petals = { pink: [C.PINK[4]!, C.PINK[3]!, 0xfff8f0], white: [0xfff8f0, C.CLOTH_WHITE[3]!], gold: [C.GOLD[4]!, C.GOLD[3]!], blue: [C.BLUE[5]!, C.BLUE[4]!, 0xfff8f0] }[str(p, "petals", "pink")] ?? [C.PINK[4]!];
    bl(b, p.x, r * 0.8, p.z, r, r * 0.85, r, blossom(pal.leaves!, petals), [p.x * 16, p.z * 16]);
  },
  { leaves: R.LUSH },
);
prop(
  "scrub",
  "coastal scrub and heather: low grey-green clumps and dry twigs round x, z; seed its make-up",
  { category: "plant", biomes: ["coast", "waste", "mountain", "tundra"], footprint: centred(1, 1, false), sample: { seed: 2 } },
  (b, p, pal) => {
    const seed = sd(p);
    const random = seeded(seed + 7);
    const leaf = foliage(pal.leaves!);
    for (let i = 0; i < 4; i++) {
      const r = 0.22 + random() * 0.18;
      bl(b, p.x + (random() - 0.5) * 0.8, r * 0.6, p.z + (random() - 0.5) * 0.6, r, r * 0.7, r * 0.9, leaf, [i * 5 + seed, i]);
    }
    const twig = bark(R.DEADWOOD);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + seed;
      limb(b, [p.x, 0.05, p.z], [p.x + Math.sin(a) * 0.5, 0.55, p.z + Math.cos(a) * 0.35], 0.025, 0.01, twig, 3);
    }
  },
  { leaves: R.SCRUB },
);
prop("stump", "a tree stump at x, z, its rings on top and roots gripping the ground; scale (1)", { category: "plant", biomes: ["forest", "plains", "llanowar", "keld"], footprint: centred(0.6, 0.6) }, (b, p, pal) => {
  const s = s1(p);
  const bk = bark(pal.bark!);
  frustum(b, p.x, p.z, 0, 0.4 * s, 0.32 * s, 0.27 * s, 8, bk);
  disc(b, [p.x, 0.4 * s + 0.001, p.z], [0, 1, 0], 0.27 * s, fitted(ringsMaterial()));
  roots(b, p.x, p.z, 0.2 * s, 0.55 * s, bk, 3, sd(p));
}, { bark: C.WOOD });
prop(
  "log",
  "a fallen log at x, z, args.length long (2.2), turned by rot and turn, moss and a mushroom on it",
  { category: "plant", biomes: ["forest", "llanowar", "swamp", "keld"], footprint: { rect: [-1.1, -0.3, 1.1, 0.3], blocks: true } },
  (b, p, pal) => {
    const l = num(p, "length", 2.2) * s1(p);
    const t = turnOf(p);
    b.at(p.x, 0, p.z, t, () => {
      const bk = bark(pal.bark!);
      limb(b, [-l / 2, 0.26, 0], [l / 2, 0.24, 0], 0.27, 0.24, bk, 8);
      const rings = fitted(ringsMaterial());
      disc(b, [l / 2 + 0.002, 0.24, 0], [1, 0, 0], 0.24, rings);
      disc(b, [-l / 2 - 0.002, 0.26, 0], [-1, 0, 0], 0.27, rings);
      bl(b, -l * 0.15, 0.48, 0.02, 0.34, 0.08, 0.2, foliage(R.MOSS), [3, 1]);
      bl(b, l * 0.2, 0.42, 0.22, 0.12, 0.04, 0.1, material("cap-red", () => capPicture("red"), { smooth: true }));
    });
  },
  { bark: C.WOOD },
);

function mushroom(b: MeshBuilder, x: number, z: number, h: number, r: number, cap: Material, stem: Material): void {
  b.cylinder(x, z, 0, h, r * 0.28, 6, { mat: stem });
  bl(b, x, h, z, r, r * 0.45, r, cap);
}

prop(
  "mushrooms",
  "a cluster of mushrooms round x, z; args.kind red|brown|glow (the Morass's, glowing violet)|elf (Llanowar's green and gold); seed its make-up",
  { category: "plant", biomes: ["forest", "llanowar", "swamp", "morass"], footprint: centred(0.6, 0.6, false), sample: { args: { kind: "red" } } },
  (b, p) => {
    const kind = str<"red" | "brown" | "glow" | "elf">(p, "kind", "red");
    const cap = kind === "glow" ? material("cap-glow", () => capPicture("glow"), { glow: 0.8 }) : material(`cap-${kind}`, () => capPicture(kind), { smooth: true });
    const stem = material("stem", () => new Pixmap(4, 4, C.BONE[5]!), { smooth: true });
    const random = seeded(sd(p) + 3);
    for (let i = 0; i < 4; i++) {
      const s = 0.6 + random() * 0.6;
      mushroom(b, p.x + (random() - 0.5) * 0.5, p.z + (random() - 0.5) * 0.4, 0.16 * s, 0.13 * s, cap, stem);
    }
  },
);
prop(
  "giant-mushroom",
  "a giant mushroom of Llanowar, a cap taller than a man, at x, z; args.kind red|brown|glow|elf (elf); scale (1)",
  { category: "plant", biomes: ["llanowar", "morass"], footprint: centred(1, 1), sample: { args: { kind: "elf" } } },
  (b, p) => {
    const s = s1(p);
    const kind = str<"red" | "brown" | "glow" | "elf">(p, "kind", "elf");
    const cap = kind === "glow" ? material("cap-glow", () => capPicture("glow"), { glow: 0.8 }) : material(`cap-${kind}`, () => capPicture(kind), { smooth: true });
    const stem = material("stem-big", () => {
      const q = new Pixmap(8, 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) q.set(x, y, hash2(x, y, 2) < 0.2 ? C.BONE[3]! : C.BONE[4]!);
      return q;
    }, { smooth: true });
    frustum(b, p.x, p.z, 0, 1.8 * s, 0.26 * s, 0.18 * s, 8, stem);
    bl(b, p.x, 1.85 * s, p.z, 1.1 * s, 0.45 * s, 1.1 * s, cap);
    mushroom(b, p.x + 0.55 * s, p.z + 0.3 * s, 0.35 * s, 0.25 * s, cap, stem);
  },
);
prop(
  "reeds",
  "a clump of reeds and cattails round x, z, standing in shallows or on a bank",
  { category: "plant", biomes: ["swamp", "morass", "coast", "plains"], footprint: centred(0.8, 0.8, false) },
  (b, p, pal) => {
    const f = fitted(reeds(pal.reeds!));
    for (let i = 0; i < 3; i++) standingCard(b, f, p.x + (i - 1) * 0.12, p.y ?? -0.05, p.z + ((i * 7) % 3 - 1) * 0.1, 1, 1.5, (i * Math.PI) / 3 + sd(p));
  },
  { reeds: R.REED },
);
prop(
  "lily-pads",
  "lily pads floating on still water round x, z (a tile across), at y (-0.1: a hole's water)",
  { category: "plant", biomes: ["swamp", "plains", "verdura"], footprint: centred(1, 1, false), sample: { y: 0.02 } },
  (b, p) => {
    const random = seeded(sd(p) + 2);
    for (let i = 0; i < 5; i++) {
      const flower = i === 0;
      const m = cutout(`lily-${flower ? "flower" : "pad"}`, () => lilyPicture(flower), false);
      const x = p.x + (random() - 0.5) * 0.8;
      const z = p.z + (random() - 0.5) * 0.8;
      const r = 0.2 + random() * 0.12;
      b.decal(fitted(m), x - r, z - r, x + r, z + r, (p.y ?? -0.1) + 0.004 + i * 0.001);
    }
  },
);
prop(
  "wildflowers",
  "a patch of wildflowers round x, z (a tile across), standing a hand high",
  { category: "plant", biomes: ["plains", "farmland", "verdura", "town"], footprint: centred(1, 1, false) },
  (b, p) => {
    const m = cutout("wildflowers", () => {
      const q = new Pixmap(16, 8);
      q.fill(0, 0);
      const colors = [C.GOLD[4]!, 0xfff8e8, C.PINK[4]!, C.BLUE[5]!, C.PURPLE[4]!, C.RED[4]!];
      for (let x = 0; x < 16; x += 2) {
        const h = 3 + ((x * 7) % 4);
        for (let y = 8 - h; y < 8; y++) q.put(x, y, C.GRASS[3]!);
        q.put(x, 8 - h - 1, colors[(x / 2) % colors.length]!);
        q.put(x + 1, 8 - h, colors[(x / 2 + 1) % colors.length]!);
      }
      return q;
    });
    for (let i = 0; i < 3; i++) standingCard(b, fitted(m), p.x + (i - 1) * 0.25, 0, p.z + ((i * 5) % 3 - 1) * 0.2, 1, 0.5, i * 1.1);
  },
);

// --- Stone ---------------------------------------------------------------------------------------------------------------

/** A rock: one to three faceted lumps of a stone (the palette's `stone`), seeded. */
function rocks(b: MeshBuilder, x: number, z: number, r: number, seed: number, mat: Material, n = 2): void {
  const random = seeded(seed * 3 + 1);
  lump(b, x, z, 0, [[r * 0.9, 0], [r, r * 0.35], [r * 0.75, r * 0.85], [r * 0.3, r * 1.1]], 7, mat, seed, 0.22);
  for (let i = 1; i < n; i++) {
    const a = random() * Math.PI * 2;
    const rr = r * (0.3 + random() * 0.25);
    lump(b, x + Math.sin(a) * r * 1.05, z + Math.cos(a) * r * 0.9, 0, [[rr, 0], [rr * 1.05, rr * 0.4], [rr * 0.6, rr * 0.9], [0, rr * 1.05]], 6, mat, seed + i, 0.25);
  }
}

prop(
  "rock",
  "a rock: faceted lumps of its palette's stone at x, z; args.r its radius (0.5), seed its shape; tint a stone palette (granite, basalt, sandstone, marble)",
  { category: "rock", biomes: ["any"], footprint: centred(1, 1), sample: { seed: 3, args: { r: 0.5 } } },
  (b, p, pal) => rocks(b, p.x, p.z, num(p, "r", 0.5), sd(p), rock(pal.stone!, pal.lichen ?? null), 2),
  { stone: R.GRANITE, lichen: R.LICHEN },
);
prop(
  "rock-pile",
  "a scatter of small rocks round x, z (a tile across); seed their places",
  { category: "rock", biomes: ["any"], footprint: centred(1, 1, false), sample: { seed: 2 } },
  (b, p, pal) => {
    const random = seeded(sd(p) + 5);
    const mat = rock(pal.stone!, null);
    for (let i = 0; i < 5; i++) {
      const r = 0.1 + random() * 0.12;
      lump(b, p.x + (random() - 0.5) * 0.8, p.z + (random() - 0.5) * 0.8, 0, [[r, 0], [r * 1.05, r * 0.4], [r * 0.5, r * 0.85], [0, r]], 5, mat, i + sd(p), 0.3);
    }
  },
  { stone: R.GRANITE },
);
prop(
  "mossy-rock",
  "a boulder cushioned with moss at x, z; args.r (0.6)",
  { category: "rock", biomes: ["forest", "llanowar", "swamp", "verdura"], footprint: centred(1.2, 1.2), sample: { seed: 1 } },
  (b, p, pal) => {
    const r = num(p, "r", 0.6);
    rocks(b, p.x, p.z, r, sd(p), rock(pal.stone!, R.MOSS), 1);
    bl(b, p.x - r * 0.1, r * 1.0, p.z - r * 0.05, r * 0.7, r * 0.25, r * 0.6, foliage(pal.moss!), [3, 4]);
  },
  { stone: C.COBBLE, moss: R.MOSS },
);
prop(
  "snowy-rock",
  "a rock with snow lying on it at x, z; args.r (0.6)",
  { category: "rock", biomes: ["tundra", "keld", "mountain"], footprint: centred(1.2, 1.2), sample: { seed: 4 } },
  (b, p, pal) => {
    const r = num(p, "r", 0.6);
    rocks(b, p.x, p.z, r, sd(p), rock(pal.stone!, null), 2);
    lump(b, p.x, p.z - r * 0.05, r * 0.62, [[r * 0.72, 0], [r * 0.55, r * 0.3], [0, r * 0.48]], 7, snowCover(), sd(p) + 9, 0.12);
  },
  { stone: R.GRANITE },
);
prop(
  "standing-stone",
  "a standing stone, rough-hewn, at x, z; args.h its height (2), turned by turn",
  { category: "rock", biomes: ["plains", "tundra", "keld", "mountain", "waste"], footprint: centred(0.8, 0.8), sample: { args: { h: 2 } } },
  (b, p, pal) => {
    const h = num(p, "h", 2);
    b.at(p.x, 0, p.z, p.turn ?? 0, () => lump(b, 0, 0, 0, [[0.38, 0], [0.4, h * 0.3], [0.34, h * 0.8], [0.18, h]], 6, rock(pal.stone!, R.LICHEN), sd(p), 0.12, { squash: 0.55 }));
  },
  { stone: R.GRANITE },
);
prop(
  "crag",
  "a crag: a jagged spire of rock at x, z; args.h its height (4), args.r its radius at the foot (1.2); seed its shape",
  { category: "mountain", biomes: ["mountain", "keld", "volcanic", "waste"], footprint: centred(2.4, 2.4), sample: { seed: 2, args: { h: 4, r: 1.2 } } },
  (b, p, pal) => {
    const h = num(p, "h", 4);
    const r = num(p, "r", 1.2);
    const mat = rock(pal.stone!, null);
    lump(b, p.x, p.z, 0, [[r, 0], [r * 0.85, h * 0.25], [r * 0.6, h * 0.55], [r * 0.38, h * 0.8], [0, h]], 7, mat, sd(p), 0.3);
    lump(b, p.x + r * 0.7, p.z + r * 0.4, 0, [[r * 0.5, 0], [r * 0.35, h * 0.3], [0, h * 0.5]], 6, mat, sd(p) + 3, 0.3);
    rocks(b, p.x - r * 0.9, p.z + r * 0.6, r * 0.3, sd(p) + 7, mat, 2);
  },
  { stone: R.GRANITE },
);
prop(
  "cliff",
  "a cliff face from x, z to args.to (its foot's line; the high ground behind it, north or west), args.h high (3): rock in strata with ledges and a ragged top",
  { category: "mountain", biomes: ["mountain", "keld", "coast"], footprint: along(1.2), sample: { args: { to: [6, 0], h: 3 } } },
  (b, p, pal) => {
    const [x1, z1] = point(p, "to");
    const h = num(p, "h", 3);
    const length = Math.hypot(x1 - p.x, z1 - p.z);
    const turn = Math.atan2(-(z1 - p.z), x1 - p.x);
    const mat = rock(pal.stone!, R.LICHEN);
    const random = seeded(sd(p) + 11);
    b.at(p.x, 0, p.z, turn, () => {
      const n = Math.max(2, Math.round(length / 0.75));
      for (let i = 0; i < n; i++) {
        const xa = (i / n) * length;
        const xb = ((i + 1) / n) * length;
        const top = h * (0.8 + random() * 0.3);
        const jut = random() * 0.25;
        b.box(xa, 0, -1.0, xb, top, 0.1 + jut, sides(tiled(mat)));
        // Ledges of the strata, a little proud.
        if (random() < 0.6) b.box(xa - 0.05, top * 0.45, 0.05 + jut, xb + 0.05, top * 0.45 + 0.18, 0.28 + jut, sides(tiled(mat)));
      }
      // Fallen stones at its foot.
      for (let i = 0; i < Math.round(length / 2); i++) rocks(b, 0.6 + random() * (length - 1.2), 0.55 + random() * 0.3, 0.18 + random() * 0.15, i + sd(p), mat, 1);
    });
  },
  { stone: R.GRANITE },
  needs({ to: "point" }),
);
prop(
  "mountain",
  "a mountain for the far view: a faceted massif at x, z, args.r its radius at the foot (6), args.h its height (9), snow above args.snow of its height (0.6; 1 for none); seed its shape",
  { category: "mountain", biomes: ["mountain", "keld", "tundra"], footprint: { rect: [-5, -5, 5, 5], blocks: true }, sample: { seed: 1, args: { r: 5, h: 8, snow: 0.6 } } },
  (b, p, pal) => {
    const r = num(p, "r", 6);
    const h = num(p, "h", 9);
    const snowAt = num(p, "snow", 0.6);
    const mat = rock(pal.stone!, null);
    const rings: [number, number][] = [
      [r, 0],
      [r * 0.82, h * 0.18],
      [r * 0.6, h * 0.4],
      [r * 0.4, h * snowAt],
      [r * 0.18, h * 0.85],
      [0, h],
    ];
    const seed = sd(p);
    lump(b, p.x, p.z, 0, rings.slice(0, 4), 9, mat, seed, 0.2, { twist: seed });
    if (snowAt < 1) {
      lump(b, p.x, p.z, h * snowAt, rings.slice(3).map(([rr, y]) => [rr * 1.03, y - h * snowAt] as [number, number]), 9, snowCover(), seed + 1, 0.15, { twist: seed });
    } else {
      lump(b, p.x, p.z, h * snowAt, rings.slice(3).map(([rr, y]) => [rr, y - h * snowAt] as [number, number]), 9, mat, seed + 1, 0.15, { twist: seed });
    }
    // A shoulder peak.
    lump(b, p.x + r * 0.6, p.z + r * 0.3, 0, [[r * 0.5, 0], [r * 0.35, h * 0.3], [r * 0.12, h * 0.48], [0, h * 0.55]], 7, mat, seed + 5, 0.25);
  },
  { stone: R.GRANITE },
);
prop(
  "boulder-field",
  "boulders strewn over the rectangle from x, z to args.to; seed their places",
  { category: "rock", biomes: ["mountain", "tundra", "waste", "keld"], footprint: { area: true, blocks: false }, sample: { seed: 3, args: { to: [4, 3] } } },
  (b, p, pal) => {
    const [x1, z1] = point(p, "to");
    const random = seeded(sd(p) + 31);
    const mat = rock(pal.stone!, R.LICHEN);
    const n = Math.max(1, Math.round((Math.abs(x1 - p.x) * Math.abs(z1 - p.z)) / 3));
    for (let i = 0; i < n; i++) rocks(b, p.x + random() * (x1 - p.x), p.z + random() * (z1 - p.z), 0.2 + random() * 0.4, i + sd(p), mat, 1 + Math.floor(random() * 2));
  },
  { stone: R.GRANITE },
  needs({ to: "point" }),
);

