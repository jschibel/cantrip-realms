import type { BuildingData, XYZ } from "../../world/format";
import { type Face, type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import { material, painted } from "../paint/materials";
import type { Palette, Ramp } from "../paint/palette";
import { Pixmap, hash2 } from "../paint/pixmap";
import { fbm, valueNoise } from "../paint/procedural";
import * as C from "../paint/colors";
import * as R from "../paint/ramps";
import * as G from "../paint/terrain";
import { scrolling } from "../props/draw";
import { frustum, glowing, limb, lump } from "../props/kit";
import type { Built } from "../recipe";
import { hipRoof, params as paramsOf, styled } from "./kit";
import { BUILDINGS, showcase } from "./registry";

// Phyrexia's architecture, in the desolate waste where the Portal stands: black-teal metal in ribbed and riveted
// plates, hooked spires and spines, sinew cables strung between, glistening oil weeping down every face, seams that
// glow a pale, sick green. The Portal itself is a great ribbed ring over a passage, its membrane of oil shimmering.
//
// Palette slots: metal (plates and ribs), accent (sinew), trim (oil). Params: h (a spire's or obelisk's height).

const PHYREXIAN: Palette = { metal: R.PHYREXIAN, accent: R.SINEW, trim: R.OIL };

type V3 = [number, number, number];
type Draw = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined;

/** The seams' glow: pale green-white, what Phyrexian light is. */
const SEAM = 0xb8f4c8;

// --- Materials ---------------------------------------------------------------------------------------------------------

const plating = (r: Ramp): Material => painted("phy-plating", r, R.PHYREXIAN, (ramp) => G.plating(ramp, 201));

/** Ribbed metal: ridges running up, each lit on its left, with rivets and an oil stain or two. */
const ribbed = (r: Ramp): Material =>
  painted(
    "phy-ribbed",
    r,
    R.PHYREXIAN,
    (ramp) => {
      const p = new Pixmap(16, 32);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 16; x++) {
          const k = x % 4;
          let c = k === 0 ? ramp[5]! : k === 1 ? ramp[4]! : k === 2 ? ramp[3]! : ramp[1]!;
          if (y % 16 === 0 && k === 1) c = ramp[6]!;
          if (valueNoise(x, y * 2, 4, 32, 202) > 0.78) c = R.OIL[2]!;
          p.set(x, y, c);
        }
      }
      return p;
    },
    { smooth: true },
  );

/** Sinew: red cords twisted along their length, pale at the strain. */
const sinew = (r: Ramp): Material =>
  painted(
    "phy-sinew",
    r,
    R.SINEW,
    (ramp) => {
      const p = new Pixmap(8, 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) p.set(x, y, (x + y) % 4 === 0 ? ramp[5]! : (x + y) % 4 === 1 ? ramp[4]! : (x + y) % 4 === 2 ? ramp[3]! : ramp[2]!);
      return p;
    },
    { smooth: true },
  );

/** The Portal's membrane: black oil swirling, its sheen teal and violet, glowing; it slides slowly. */
const membrane = (): Material => {
  const m = material(
    "phy-membrane",
    () => {
      const p = new Pixmap(32, 32);
      const o = R.OIL;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const n = fbm(x + Math.sin(y / 5) * 4, y, 8, 32, 203);
          let c = n < 0.35 ? o[1]! : n < 0.5 ? o[3]! : n < 0.62 ? o[4]! : n < 0.75 ? o[5]! : o[6]!;
          if (n > 0.8 && hash2(x, y, 204) < 0.15) c = SEAM;
          p.set(x, y, c);
        }
      }
      return p;
    },
    { glowing: true },
  );
  return scrolling(m, [1, 2], [1 / 32, 1 / 32]);
};

/** Oil running down a face: black streaks with a wet highlight, cut out. */
const weep = (): Material =>
  material(
    "phy-weep",
    () => {
      const p = new Pixmap(16, 32);
      p.fill(0, 0);
      for (let x = 0; x < 16; x++) {
        if (hash2(x, 1, 205) < 0.55) continue;
        const len = 8 + Math.floor(hash2(x, 2, 206) * 24);
        for (let y = 0; y < len; y++) p.set(x, y, y === len - 1 ? R.OIL[1]! : (x + y) % 7 === 0 ? R.OIL[5]! : R.OIL[2]!);
      }
      return p;
    },
    { cutout: true },
  );

/** A maw for a door, 32 by 32: a ring of hooked teeth round a dark throat glowing deep within. */
function mawPicture(metal: Ramp): Pixmap {
  const p = new Pixmap(32, 32);
  p.fill(0, 0);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = (x - 15.5) / 15.5;
      const dy = (y - 18) / 18;
      const d = Math.hypot(dx, dy * 1.1);
      if (y > 31 || d > 1) continue;
      const a = Math.atan2(dy, dx);
      const teeth = 0.78 + 0.12 * Math.abs(Math.sin(a * 7));
      let c: number;
      if (d > 0.9) c = metal[2]!;
      else if (d > teeth) c = d > teeth + 0.05 ? C.BONE[4]! : C.BONE[2]!;
      else if (d < 0.3) c = d < 0.15 ? SEAM : R.SINEW[3]!;
      else c = d < 0.5 ? R.SINEW[1]! : R.OIL[1]!;
      p.set(x, y, c);
    }
  }
  return p;
}

// --- Shapes ------------------------------------------------------------------------------------------------------------

interface Mats {
  readonly plate: Face;
  readonly plateMat: Material;
  readonly rib: Material;
  readonly sinew: Material;
  readonly pal: Palette;
}

const mats = (pal: Palette): Mats => ({ plate: tiled(plating(pal.metal!)), plateMat: plating(pal.metal!), rib: ribbed(pal.metal!), sinew: sinew(pal.accent!), pal });

/** A hooked spine: a tapering curve from `base` up `h`, bending over at its top toward `dir` (radians about the vertical). */
function hook(b: MeshBuilder, m: Mats, base: V3, h: number, r: number, dir: number, bend = 0.6): void {
  const n = 6;
  const pt = (t: number): V3 => {
    const curl = Math.pow(t, 3) * bend * h;
    return [base[0] + Math.sin(dir) * curl, base[1] + h * Math.sin((t * Math.PI) / 2.2), base[2] + Math.cos(dir) * curl];
  };
  for (let i = 0; i < n; i++) limb(b, pt(i / n), pt((i + 1) / n), r * (1 - i / n) + 0.01, r * (1 - (i + 1) / n) + 0.005, m.rib, 6);
}

/** A sinew cable strung from `a` to `c`, sagging in the middle. */
function cable(b: MeshBuilder, m: Mats, a: V3, c: V3, sag = 0.4, r = 0.06): void {
  const mid: V3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - sag, (a[2] + c[2]) / 2];
  limb(b, a, mid, r, r * 0.85, m.sinew, 5);
  limb(b, mid, c, r * 0.85, r, m.sinew, 5);
}

/** A glowing seam: a thin upright bar of light on a face facing south at z. */
function seam(b: MeshBuilder, x: number, y0: number, y1: number, z: number): void {
  b.box(x - 0.03, y0, z, x + 0.03, y1, z + 0.03, sides(glowing(SEAM)));
}

/** Spikes along a top edge from (x0, z) to (x1, z) at y: short, hooked forward. */
function spikes(b: MeshBuilder, m: Mats, x0: number, x1: number, z: number, y: number, step = 0.6): void {
  for (let x = x0 + step / 2; x < x1; x += step) hook(b, m, [x, y, z], 0.55 + 0.25 * hash2(Math.round(x * 4), 3, 207), 0.09, 0, 0.5);
}

/** A block of plating with ribs up its faces, glowing seams, oil weeping from its top, spikes along its crest. */
function block(b: MeshBuilder, m: Mats, x0: number, z0: number, x1: number, z1: number, h: number, crest = true): void {
  b.box(x0 - 0.15, 0, z0 - 0.15, x1 + 0.15, 0.25, z1 + 0.15, sides(m.plate));
  b.box(x0, 0.25, z0, x1, h, z1, sides(m.plate));
  for (let x = x0 + 0.5; x < x1 - 0.3; x += 1.2) b.box(x - 0.1, 0.25, z1, x + 0.1, h, z1 + 0.14, sides(tiled(m.rib)));
  for (let z = z0 + 0.5; z < z1 - 0.3; z += 1.2) {
    b.box(x1, 0.25, z - 0.1, x1 + 0.14, h, z + 0.1, sides(tiled(m.rib)));
    b.box(x0 - 0.14, 0.25, z - 0.1, x0, h, z + 0.1, sides(tiled(m.rib)));
  }
  for (let x = x0 + 1.1; x < x1 - 0.3; x += 2.4) seam(b, x, 0.6, h - 0.5, z1);
  b.card(fitted(weep()), x0 + 0.2, h - 1.6, x0 + 1.0, h, z1 + 0.15);
  if (crest) spikes(b, m, x0, x1, z1 - 0.15, h);
}

// --- Kinds -----------------------------------------------------------------------------------------------------------------

/** The Phyrexian Portal: a great ribbed ring over a passage (the middle 2 tiles), its membrane of oil shimmering. */
function portal(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const zm = (z0 + z1) / 2;
    const R0 = Math.min(3.6, (x1 - x0) / 2 - 0.6);
    const cy = R0 - 0.1;
    const n = 28;
    const at = (a: number, r: number, z = zm): V3 => [xm + Math.sin(a) * r, cy + Math.cos(a) * r, z];
    // A platform of plating, a ramp to it, the passage through it.
    b.box(x0, 0, z0, x1, 0.2, z1, sides(m.plate));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const mid = at((a0 + a1) / 2, R0);
      if (Math.abs(mid[0] - xm) < 1.25 && mid[1] < 2.6) continue;
      if (mid[1] < 0) continue;
      // The ring: two tubes, front and back, collared at every other segment, spines outward.
      for (const dz of [-0.45, 0.45]) limb(b, at(a0, R0, zm + dz), at(a1, R0, zm + dz), 0.32, 0.32, m.rib, 7);
      limb(b, at(a0, R0, zm - 0.45), at(a0, R0, zm + 0.45), 0.36, 0.36, m.plateMat, 7);
      if (i % 2 === 0) limb(b, at(a0, R0 + 0.15, zm - 0.6), at(a0, R0 + 0.15, zm + 0.6), 0.22, 0.22, m.rib, 6);
      if (i % 3 === 0) {
        const out = at(a0, R0 + 0.3);
        const tip = at(a0 + 0.12, R0 + 1.3 + 0.4 * hash2(i, 1, 208));
        limb(b, out, tip, 0.14, 0.02, m.rib, 5);
      }
    }
    // The feet: great buttresses either side, sinew strung from the ring to anchors in the ground.
    for (const s of [-1, 1]) {
      const fx = xm + s * (R0 - 0.2);
      lump(b, fx, zm, 0, [[1.0, 0], [0.8, 0.8], [0.45, 1.8], [0.2, 2.4]], 6, m.plateMat, s > 0 ? 3 : 4, 0.25);
      cable(b, m, at(s * 0.9, R0, zm + 0.5), [xm + s * (R0 + 1.2), 0.15, z1 - 0.3], 0.6, 0.07);
      cable(b, m, at(s * 1.6, R0, zm - 0.5), [xm + s * (R0 + 1.0), 0.15, z0 + 0.3], 0.5, 0.06);
      b.box(xm + s * (R0 + 1.2) - 0.2, 0, z1 - 0.5, xm + s * (R0 + 1.2) + 0.2, 0.3, z1 - 0.1, sides(m.plate));
    }
    // The membrane: a disc of oil filling the ring, cut level with the ground.
    const inner = R0 - 0.3;
    const pts: V3[] = [];
    const uvs: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const a = Math.PI - (i / 24) * Math.PI * 2;
      const p = at(a, inner, zm);
      p[1] = Math.max(0.2, p[1]);
      pts.push(p);
      uvs.push([(p[0] - xm) / 2 + 0.5, p[1] / 2]);
    }
    b.polygon(membrane(), pts, uvs);
    b.polygon(membrane(), [...pts].reverse(), [...uvs].reverse());
    // A crown of hooked spires on top.
    hook(b, m, at(0, R0 + 0.2), 2.4, 0.22, 0, 0.5);
    hook(b, m, at(-0.45, R0 + 0.2), 1.6, 0.16, -Math.PI / 2, 0.6);
    hook(b, m, at(0.45, R0 + 0.2), 1.6, 0.16, Math.PI / 2, 0.6);
    return [xm, 1, z1];
  };
}

/** A hooked spire: a ribbed spine rising from a mound of plates, curling over at its top, seams glowing up it. */
function spire(m: Mats, h: number): Draw {
  return (b, x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const r = Math.min(x1 - x0, z1 - z0) / 2;
    lump(b, cx, cz, 0, [[r, 0], [r * 0.75, 0.7], [r * 0.45, 1.4]], 7, m.plateMat, 5, 0.25);
    hook(b, m, [cx, 1.0, cz], h, r * 0.4, Math.PI / 4, 0.45);
    for (let i = 0; i < 4; i++) {
      const y = 1.6 + i * (h / 5);
      const k = 1 - y / (h + 1.0);
      frustum(b, cx, cz, y, y + 0.18, r * 0.42 * k + 0.08, r * 0.38 * k + 0.08, 8, m.plateMat);
    }
    for (const a of [0.4, 2.4, 4.4]) hook(b, m, [cx + Math.sin(a) * r * 0.6, 0.6, cz + Math.cos(a) * r * 0.6], h * 0.35, r * 0.15, a, 0.7);
    b.box(cx - 0.03, 1.4, cz + r * 0.4, cx + 0.03, h * 0.5, cz + r * 0.4 + 0.04, sides(glowing(SEAM)));
    return undefined;
  };
}

/** A hall: plated walls under a hipped roof of plates, ribs arching over it, a maw for its door. */
function hall(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const h = 3.2;
    block(b, m, x0, z0, x1, z1, h, false);
    hipRoof(b, x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, h, Math.min(2.6, (z1 - z0) * 0.5), m.plateMat);
    // Ribs arching over the hall, east-west, like a beast's.
    const top = h + Math.min(2.6, (z1 - z0) * 0.5) + 1.2;
    for (let z = z0 + 0.6; z < z1 - 0.3; z += 1.4) {
      const pts: V3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const x = x0 - 0.35 + (x1 - x0 + 0.7) * t;
        const y = Math.sin(t * Math.PI) * top + (t < 0.5 ? 0 : 0) - 0.1;
        pts.push([x, Math.max(0, y), z]);
      }
      for (let i = 0; i < 8; i++) limb(b, pts[i]!, pts[i + 1]!, 0.16, 0.16, m.rib, 6);
      hook(b, m, [xm, top - 0.15, z], 0.7, 0.1, 0, 0.6);
    }
    // The maw.
    b.card(fitted(material(`phy-maw`, () => mawPicture(m.pal.metal!), { cutout: true })), xm - 1.0, 0.25, xm + 1.0, 2.25, z1 + 0.15);
    for (const s of [-1, 1]) hook(b, m, [xm + s * 1.15, 0.25, z1 + 0.25], 2.4, 0.16, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.5);
    cable(b, m, [x0 + 0.2, h - 0.2, z1 + 0.2], [xm - 1.1, 2.4, z1 + 0.25], 0.4);
    cable(b, m, [x1 - 0.2, h - 0.2, z1 + 0.2], [xm + 1.1, 2.4, z1 + 0.25], 0.4);
    return [xm, 1, z1];
  };
}

/** An oil vat: a ribbed tank brimming with glowing oil, pipes running from it into the ground and a smaller tank. */
function vat(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const r = Math.min(x1 - x0, z1 - z0) / 2 - 0.5;
    const cx = x0 + r + 0.3;
    const cz = (z0 + z1) / 2;
    const h = 2.4;
    b.cylinder(cx, cz, 0, h, r, 12, { mat: m.rib }, fitted(membrane()));
    b.cylinder(cx, cz, h - 0.05, h + 0.15, r + 0.12, 12, { mat: m.plateMat });
    for (const y of [0.4, 1.4]) b.cylinder(cx, cz, y, y + 0.2, r + 0.06, 12, { mat: m.plateMat });
    const sx = x1 - 0.8;
    const sz = z1 - 0.8;
    b.cylinder(sx, sz, 0, 1.3, 0.55, 10, { mat: m.rib }, fitted(membrane()));
    limb(b, [cx + r * 0.7, h * 0.7, cz + r * 0.7], [sx, 1.0, sz], 0.12, 0.12, m.plateMat, 6);
    limb(b, [cx + r, 0.6, cz], [x1 - 0.2, 0.6, cz - 0.6], 0.14, 0.14, m.plateMat, 6);
    limb(b, [x1 - 0.2, 0.6, cz - 0.6], [x1 - 0.2, 0, cz - 0.6], 0.14, 0.14, m.plateMat, 6);
    cable(b, m, [cx - r, h, cz], [x0 + 0.1, 0.1, z1 - 0.2], 0.3);
    b.card(fitted(weep()), cx - 0.5, h - 1.8, cx + 0.5, h, cz + r + 0.01);
    hook(b, m, [cx - r * 0.7, h, cz - r * 0.5], 1.2, 0.1, -0.5, 0.6);
    return undefined;
  };
}

/** An obelisk: a tall four-sided spike of plating, a glowing seam down each face, hooked at its tip. */
function obelisk(m: Mats, h: number): Draw {
  return (b, x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const r = Math.min(x1 - x0, z1 - z0) / 2 - 0.1;
    b.box(cx - r, 0, cz - r, cx + r, 0.35, cz + r, sides(m.plate));
    b.at(cx, 0, cz, Math.PI / 4, () => frustum(b, 0, 0, 0.35, h, r * 0.85, r * 0.15, 4, m.plateMat));
    hook(b, m, [cx, h - 0.1, cz], 0.9, r * 0.15, 0, 0.8);
    for (const a of [0, Math.PI / 2, -Math.PI / 2]) b.at(cx, 0, cz, a, () => b.box(-0.03, 0.6, r * 0.6 * 0.72, 0.03, h * 0.7, r * 0.6 * 0.72 + 0.04, sides(glowing(SEAM))));
    return undefined;
  };
}

function towerOf(b: MeshBuilder, m: Mats, x0: number, z0: number, x1: number, z1: number, h: number): void {
  block(b, m, x0, z0, x1, z1, h, false);
  b.box(x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.25, z1 + 0.15, sides(m.plate));
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  for (const [x, z, a] of [
    [x0, z0, -2.4],
    [x1, z0, 2.4],
    [x0, z1, -0.8],
    [x1, z1, 0.8],
  ] as const)
    hook(b, m, [x, h + 0.25, z], 1.0, 0.12, a, 0.7);
  hook(b, m, [cx, h + 0.25, cz], 2.2, Math.min(x1 - x0, z1 - z0) * 0.18, 0, 0.5);
}

function gatehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const g0 = xm - 1;
    const g1 = xm + 1;
    const h = 4.6;
    towerOf(b, m, x0, z0, g0, z1, h);
    towerOf(b, m, g1, z0, x1, z1, h);
    // A ribbed arch over the passage, teeth hanging from it.
    for (const z of [z0 + 0.3, (z0 + z1) / 2, z1 - 0.3]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push([g0 + (g1 - g0) * t, 2.6 + Math.sin(t * Math.PI) * 1.2, z]);
      }
      for (let i = 0; i < 6; i++) limb(b, pts[i]!, pts[i + 1]!, 0.18, 0.18, m.rib, 6);
    }
    b.box(g0, 3.4, z0 + 0.2, g1, 3.9, z1 - 0.2, sides(m.plate));
    for (let x = g0 + 0.2; x < g1; x += 0.3) limb(b, [x, 2.7, z1 - 0.3], [x, 2.25, z1 - 0.3], 0.06, 0.01, tooth(), 4);
    return [xm, 1, z1];
  };
}

const tooth = (): Material => material("phy-tooth", () => new Pixmap(4, 4, C.BONE[4]!), { smooth: true });

function wall(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 3.0;
    b.box(x0, 0, z0, x1, h, z1, sides(m.plate));
    if (x1 - x0 >= z1 - z0) {
      for (let x = x0 + 0.5; x < x1 - 0.2; x += 1.2) b.box(x - 0.1, 0, z1, x + 0.1, h, z1 + 0.14, sides(tiled(m.rib)));
      spikes(b, m, x0, x1, (z0 + z1) / 2, h, 0.5);
    } else {
      for (let z = z0 + 0.5; z < z1 - 0.2; z += 1.2) {
        b.box(x1, 0, z - 0.1, x1 + 0.14, h, z + 0.1, sides(tiled(m.rib)));
        b.box(x0 - 0.14, 0, z - 0.1, x0, h, z + 0.1, sides(tiled(m.rib)));
      }
      for (let z = z0 + 0.25; z < z1; z += 0.5) hook(b, m, [(x0 + x1) / 2, h, z], 0.6, 0.09, 0, 0.5);
    }
    return undefined;
  };
}

function phyrexian(building: BuildingData, pal: Palette): Built {
  const m = mats(pal);
  const P = paramsOf(building);
  const kind = building.kind ?? "hall";
  const cap = plating(pal.metal!);
  const go = (height: number, draw: Draw, through = false) => styled(building, { cap, height, through }, draw);
  switch (kind) {
    case "portal":
      return go(10, portal(m), true);
    case "spire":
      return go(P.num("h", 6) + 1.5, spire(m, P.num("h", 6)));
    case "vat":
      return go(3.8, vat(m));
    case "obelisk":
      return go(P.num("h", 5) + 1, obelisk(m, P.num("h", 5)));
    case "gatehouse":
      return go(7, gatehouse(m), true);
    case "wall":
      return go(3.8, wall(m));
    case "wall-tower":
      return go(7.5, (b, x0, z0, x1, z1) => {
        towerOf(b, m, x0, z0, x1, z1, 5.0);
        return undefined;
      });
    default:
      return go(8.5, hall(m));
  }
}

BUILDINGS.define(
  "phyrexian",
  "Phyrexian architecture (the desolate waste, the capstone): ribbed and riveted black-teal plates, hooked spires, sinew cables, oil weeping, pale green seams. Kinds: portal (the Phyrexian Portal: a ribbed ring over a passage - the middle 2 tiles - its oil membrane glowing; about 9x4), hall (the default: a ribbed hall with a maw for a door), spire (a hooked spire; params.h, 6), vat (an oil vat with pipes), obelisk (params.h, 5), gatehouse (its passage the middle 2 tiles), wall, wall-tower",
  phyrexian,
  PHYREXIAN,
);

showcase("phyrexian", [
  { kind: "portal", w: 9, d: 4 },
  { kind: "hall", w: 7, d: 6 },
  { kind: "spire", w: 3, d: 3, params: { h: 6 } },
  { kind: "spire", w: 2, d: 2, label: "small", params: { h: 3.5 } },
  { kind: "vat", w: 4, d: 4 },
  { kind: "obelisk", w: 2, d: 2, params: { h: 5 } },
  { kind: "gatehouse", w: 6, d: 3 },
  { kind: "wall-tower", w: 3, d: 3 },
  { kind: "wall", w: 6, d: 1 },
]);
