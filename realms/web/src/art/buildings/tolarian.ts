import * as THREE from "three";
import type { BuildingData, XYZ } from "../../world/format";
import { TEXELS } from "../../render/lighting";
import { type Face, type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, painted } from "../paint/materials";
import type { Palette, Ramp } from "../paint/palette";
import { Pixmap, hash2, seeded } from "../paint/pixmap";
import * as R from "../paint/ramps";
import * as T from "../paint/textures";
import { barrel, crate, gold } from "../props/draw";
import { bannerMaterial, glowing } from "../props/kit";
import type { Built } from "../recipe";
import { door, doorMaterial, hangingSign, hipRoof, merlons, params as paramsOf, plaque, sideWindow, signMaterial, styled, type Trade, tradeOf, window, windowMaterial, windowSpots } from "./kit";
import { BUILDINGS, showcase } from "./registry";

// Tolaria's style, the Academy's on Walassa: white marble veined blue, domes of verdigris copper on drums, porticoes of
// fluted columns under pediments, friezes of azure tile, round and arched windows, Tolarian blue cloth, and spires
// carrying the Academy's instruments - a mage's spire wears an orrery's ring round its dome.
//
// Palette slots: stone (marble walls), roof (copper domes and roofs), accent (the azure tile), cloth (banners,
// awnings), trim (gilding). Params: floors (house, shop, tower), dome (house), trade (the sign's emblem), doorAt.
// `dome`, `ridgeNS` and `column` are shared with the other styles drawn alongside (vess.ts, village.ts, phyrexian.ts).

const TOLARIAN: Palette = { stone: R.MARBLE, roof: R.VERDIGRIS, accent: C.BLUE, cloth: R.TOLARIAN_CLOTH, trim: C.GOLD };

type V3 = readonly [number, number, number];
type Draw = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined;

// --- Materials ---------------------------------------------------------------------------------------------------------

/** Marble ashlar: broad white blocks, a blue vein wandering across some. */
export const marble = (r: Ramp): Material =>
  painted("tol-marble", r, R.MARBLE, (ramp) => {
    const p = T.ashlar(ramp, 71, 8, 12, 20);
    const random = seeded(72);
    for (let k = 0; k < 6; k++) {
      let x = Math.floor(random() * 64);
      let y = Math.floor(random() * 48);
      for (let i = 0; i < 10; i++) {
        p.set(x, y, ramp[2]!);
        x += 1;
        y += random() < 0.5 ? 1 : random() < 0.5 ? 0 : -1;
      }
    }
    return p;
  });

/** Polished marble slabs for steps, cornices and plinths. */
const marbleSlab = (r: Ramp): Material => painted("tol-slab", r, R.MARBLE, (ramp) => T.flagstones(ramp, 73));

/** Verdigris copper: standing seams running up, patina in streaks. */
export const copper = (r: Ramp): Material =>
  painted(
    "tol-copper",
    r,
    R.VERDIGRIS,
    (ramp) => {
      const p = new Pixmap(32, 32);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const seam = x % 8;
          let c = seam === 0 ? ramp[5]! : seam === 7 ? ramp[2]! : ramp[3]!;
          if (seam > 0 && seam < 7 && hash2(x >> 1, y >> 2, 74) < 0.18) c = ramp[4]!;
          if (seam > 0 && seam < 7 && hash2(x, y, 75) < 0.05) c = ramp[2]!;
          p.set(x, y, c);
        }
      }
      return p;
    },
    { smooth: true },
  );

/** Azure tile: a frieze of blue and white squares with a gold dot at their corners. */
const azure = (r: Ramp): Material =>
  painted("tol-azure", r, C.BLUE, (ramp) => {
    const p = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const cell = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
        let c = cell ? ramp[3]! : ramp[4]!;
        if (x % 4 === 0 || y % 4 === 0) c = ramp[1]!;
        if ((x % 8 === 2 && y % 8 === 2) || (x % 8 === 6 && y % 8 === 6)) c = 0xfff8e8;
        if (x % 4 === 0 && y % 4 === 0) c = C.GOLD[4]!;
        p.set(x, y, c);
      }
    }
    return p;
  });

/** Fluted marble for columns: light and dark flutes running up. */
const flutes = (r: Ramp): Material =>
  painted(
    "tol-flutes",
    r,
    R.MARBLE,
    (ramp) => {
      const p = new Pixmap(16, 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 4 === 0 ? ramp[2]! : x % 4 === 1 ? ramp[6]! : ramp[4]!);
      return p;
    },
    { smooth: true },
  );

// --- Shapes ------------------------------------------------------------------------------------------------------------

/**
 * A dome: a hemisphere (an onion when `rise` > r) of rings over a circle at (cx, cz), radius r from y, smooth, its
 * material laid on as the three-quarter camera sees it (as a blob's), so its texels keep their size.
 */
export function dome(b: MeshBuilder, cx: number, cz: number, y: number, r: number, rise: number, mat: Material, segments = 12, rings = 5): void {
  const matrix = (b as unknown as { matrix: THREE.Matrix4 }).matrix;
  const image = mat.map?.image as { width: number; height: number } | undefined;
  const w = (image?.width ?? TEXELS) / TEXELS;
  const h = (image?.height ?? TEXELS) / TEXELS;
  const uv = (c: V3): [number, number] => {
    const p = new THREE.Vector3(...c).applyMatrix4(matrix);
    return [p.x / w, (p.y - p.z) / h];
  };
  const at = (a: number, phi: number): V3 => [cx + Math.sin(a) * Math.cos(phi) * r, y + Math.sin(phi) * rise, cz + Math.cos(a) * Math.cos(phi) * r];
  const n = (a: number, phi: number): V3 => {
    const v = new THREE.Vector3((Math.sin(a) * Math.cos(phi)) / r, Math.sin(phi) / rise, (Math.cos(a) * Math.cos(phi)) / r).normalize();
    return [v.x, v.y, v.z];
  };
  for (let j = 0; j < rings; j++) {
    const p0 = (j / rings) * (Math.PI / 2);
    const p1 = ((j + 1) / rings) * (Math.PI / 2);
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const top = j === rings - 1;
      const poly: V3[] = top ? [at(a0, p0), at(a1, p0), at(a0, p1)] : [at(a0, p0), at(a1, p0), at(a1, p1), at(a0, p1)];
      const nr: V3[] = top ? [n(a0, p0), n(a1, p0), [0, 1, 0]] : [n(a0, p0), n(a1, p0), n(a1, p1), n(a0, p1)];
      b.polygon(mat, poly, poly.map(uv), nr);
    }
  }
}

/** A gable roof whose ridge runs north-south (its gable, a pediment, to the front) over x0..x1, z0..z1. */
export function ridgeNS(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, roof: Material, gable: Face, eaveDrop = 0): void {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hd = (z1 - z0) / 2;
  const hw = (x1 - x0) / 2;
  b.at(cx, 0, cz, Math.PI / 2, () => b.gableRoof(-hd, -hw, hd, hw, y, rise, roof, gable, eaveDrop));
}

/** A fluted column on a square base with a capital: its middle at x, z, from y0 to y1. */
export function column(b: MeshBuilder, x: number, z: number, y0: number, y1: number, r: number, shaft: Material, slab: Face): void {
  b.box(x - r - 0.06, y0, z - r - 0.06, x + r + 0.06, y0 + 0.15, z + r + 0.06, sides(slab));
  b.cylinder(x, z, y0 + 0.15, y1 - 0.15, r, 8, { mat: shaft });
  b.box(x - r - 0.08, y1 - 0.15, z - r - 0.08, x + r + 0.08, y1, z + r + 0.08, sides(slab));
}

/** A thin bar between two points (a ring's segment, a rail): a box turned along it about the vertical. */
export function bar(b: MeshBuilder, a: V3, c: V3, t: number, mat: Material): void {
  const dx = c[0] - a[0];
  const dz = c[2] - a[2];
  const len = Math.hypot(dx, dz);
  const turn = Math.atan2(-dz, dx);
  b.at((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, turn, () => b.box(-len / 2 - 0.01, -t, -t, len / 2 + 0.01, t, t, sides(mat)));
}

/** A single roof slope from high at z0 to low at z1 (a lean-to, a canopy). */
export function slope(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, low: number, high: number, mat: Material): void {
  b.quad({ mat, density: (16 * (z1 - z0 + high - low)) / Math.hypot(z1 - z0, high - low) }, [
    [x0, low, z1],
    [x1, low, z1],
    [x1, high, z0],
    [x0, high, z0],
  ], (c) => c[0], (c) => Math.hypot(z1 - c[2], c[1] - low));
}

// --- Parts ---------------------------------------------------------------------------------------------------------------

interface Mats {
  readonly wall: Face;
  readonly slab: Face;
  readonly frieze: Face;
  readonly copper: Material;
  readonly shaft: Material;
  readonly pal: Palette;
}

function mats(pal: Palette): Mats {
  return { wall: tiled(marble(pal.stone!)), slab: tiled(marbleSlab(pal.stone!)), frieze: tiled(azure(pal.accent!)), copper: copper(pal.roof!), shaft: flutes(pal.stone!), pal };
}

/** A marble block on a plinth, `h` high: a frieze of azure tile under a cornice; a flat roof with a balustrade. */
function block(b: MeshBuilder, m: Mats, x0: number, z0: number, x1: number, z1: number, h: number, balustrade = true): void {
  b.box(x0 - 0.1, 0, z0 - 0.1, x1 + 0.1, 0.3, z1 + 0.1, sides(m.slab));
  b.box(x0, 0.3, z0, x1, h - 0.35, z1, sides(m.wall));
  b.box(x0 - 0.02, h - 0.35, z0 - 0.02, x1 + 0.02, h - 0.12, z1 + 0.02, sides(m.frieze));
  b.box(x0 - 0.15, h - 0.12, z0 - 0.15, x1 + 0.15, h, z1 + 0.15, sides(m.slab));
  if (!balustrade) return;
  for (const [ax, az, bx, bz] of [
    [x0 - 0.1, z1 + 0.05, x1 + 0.1, z1 + 0.05],
    [x0 - 0.1, z0 - 0.05, x1 + 0.1, z0 - 0.05],
    [x0 - 0.05, z0, x0 - 0.05, z1],
    [x1 + 0.05, z0, x1 + 0.05, z1],
  ] as const) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.round(len / 0.3));
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      b.box(x - 0.04, h, z - 0.04, x + 0.04, h + 0.3, z + 0.04, sides(m.slab));
    }
    b.box(Math.min(ax, bx) - 0.06, h + 0.3, Math.min(az, bz) - 0.06, Math.max(ax, bx) + 0.06, h + 0.4, Math.max(az, bz) + 0.06, sides(m.slab));
  }
}

/** A dome on a drum at (cx, cz): a ring of marble with windows, a copper dome, a lantern and a gilded finial. */
function domeOn(b: MeshBuilder, m: Mats, cx: number, cz: number, y: number, r: number, drum = 0.8, lit = false): number {
  b.cylinder(cx, cz, y, y + drum, r, 12, { mat: marble(m.pal.stone!) }, undefined, 0, 1, 2);
  b.cylinder(cx, cz, y + drum, y + drum + 0.12, r + 0.1, 12, { mat: marbleSlab(m.pal.stone!) }, { mat: marbleSlab(m.pal.stone!) });
  if (drum >= 0.7 && r >= 0.9) {
    const glass = windowMaterial(m.pal.stone!, lit ? "lit" : "clear", "round");
    for (const a of [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2]) b.at(cx, 0, cz, a, () => b.card(fitted(glass), -0.3, y + 0.04, 0.3, y + 0.04 + 0.675, r + 0.01));
  }
  const top = y + drum + 0.12;
  dome(b, cx, cz, top, r, r * 0.78, m.copper);
  b.cylinder(cx, cz, top + r * 0.74, top + r * 0.74 + 0.3, Math.max(0.12, r * 0.15), 8, { mat: marble(m.pal.stone!) });
  b.cylinder(cx, cz, top + r * 0.74 + 0.3, top + r * 0.74 + 0.75, 0.04, 4, { mat: gold() });
  b.blob(cx, top + r * 0.74 + 0.78, cz, 0.08, 0.08, 0.08, glowing(C.GOLD[4]!));
  return top + r * 0.78;
}

/** A portico: columns across the front from xa to xb on steps, a frieze and a pediment roofed in copper above. */
function portico(b: MeshBuilder, m: Mats, xa: number, xb: number, zBack: number, zFront: number, h: number, n: number): void {
  b.box(xa - 0.1, 0, zBack, xb + 0.1, 0.3, zFront + 0.1, sides(m.slab));
  b.box(xa + 0.2, 0, zFront + 0.1, xb - 0.2, 0.15, zFront + 0.4, sides(m.slab));
  for (let i = 0; i < n; i++) {
    const x = xa + 0.3 + ((xb - xa - 0.6) * i) / (n - 1);
    column(b, x, zFront - 0.3, 0.3, h - 0.3, 0.16, m.shaft, m.slab);
  }
  b.box(xa - 0.05, h - 0.3, zBack, xb + 0.05, h - 0.05, zFront, sides(m.frieze));
  b.box(xa - 0.12, h - 0.05, zBack, xb + 0.12, h + 0.05, zFront + 0.08, sides(m.slab));
  ridgeNS(b, xa - 0.15, zBack - 0.2, xb + 0.15, zFront + 0.15, h + 0.05, Math.min(1.3, (xb - xa) * 0.28), m.copper, m.wall, 0.08);
}

/** A front's openings: an arched door, round windows either side, arched windows above on an upper floor. */
function front(b: MeshBuilder, m: Mats, x0: number, x1: number, z: number, floors: number, doorAt: number, lit = false): void {
  door(b, x0 + doorAt, 0.3, z, doorMaterial(C.DARKWOOD, m.pal.stone!, "arch"), m.slab);
  const round = windowMaterial(m.pal.stone!, lit ? "lit" : "clear", "round");
  const arch = windowMaterial(m.pal.stone!, lit ? "lit" : "clear", "arch");
  for (const x of windowSpots(x1 - x0, doorAt, 1.8)) window(b, x0 + x, 0.9, z, round);
  for (let f = 1; f < floors; f++) for (const x of windowSpots(x1 - x0, undefined, 1.8)) window(b, x0 + x, 0.75 + f * 2.2, z, arch);
}

/** Windows down both side walls, every storey. */
function flanks(b: MeshBuilder, m: Mats, x0: number, x1: number, z0: number, z1: number, floors: number, lit = false): void {
  const arch = windowMaterial(m.pal.stone!, lit ? "lit" : "clear", "arch");
  for (let f = 0; f < floors; f++) {
    for (const z of windowSpots(z1 - z0, undefined, 1.8, 1.0)) {
      sideWindow(b, x1, 0.85 + f * 2.2, z0 + z, 1, arch);
      sideWindow(b, x0, 0.85 + f * 2.2, z0 + z, -1, arch);
    }
  }
}

const tolSign = (trade: Trade, pal: Palette) => signMaterial(trade, pal.accent!, pal.trim!, "round");

// --- Kinds -----------------------------------------------------------------------------------------------------------------

function house(m: Mats, building: BuildingData, floors: number, domed: boolean, trade?: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 0.3 + floors * 2.2 + 0.4;
    block(b, m, x0, z0, x1, z1, h, !domed);
    const doorAt = paramsOf(building).num("doorAt", (x1 - x0) / 2);
    front(b, m, x0, x1, z1, floors, doorAt);
    flanks(b, m, x0, x1, z0, z1, floors);
    if (domed) {
      hipRoof(b, x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, h, 0.5, m.copper);
      domeOn(b, m, (x0 + x1) / 2, (z0 + z1) / 2, h + 0.3, Math.min(x1 - x0, z1 - z0) * 0.3, 0.5);
    }
    if (trade) {
      // A shop: Tolarian blue awnings over its windows, a round sign, wares by the door.
      const cloth = bannerMaterial(m.pal.cloth!, m.pal.trim!);
      for (const x of windowSpots(x1 - x0, doorAt, 1.8)) {
        b.quad({ mat: cloth }, [
          [x0 + x - 0.7, 1.95, z1 + 0.6],
          [x0 + x + 0.7, 1.95, z1 + 0.6],
          [x0 + x + 0.7, 2.3, z1],
          [x0 + x - 0.7, 2.3, z1],
        ], (c) => c[0], (c) => c[1] - c[2]);
      }
      hangingSign(b, x0 + Math.min(x1 - x0 - 0.6, doorAt + 1.15), 2.55, z1, tolSign(trade, m.pal), m.slab);
      crate(b, x0 + 0.55, z1 + 0.55, 0.55, "fish");
      barrel(b, x1 - 0.5, z1 + 0.5, 0.7);
    }
    return [x0 + doorAt, 1, z1];
  };
}

function inn(m: Mats, building: BuildingData, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 0.3 + 2 * 2.2 + 0.4;
    block(b, m, x0, z0, x1, z1, h, false);
    hipRoof(b, x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, h, 0.6, m.copper);
    domeOn(b, m, (x0 + x1) / 2, (z0 + z1) / 2, h + 0.35, Math.min(x1 - x0, z1 - z0) * 0.28, 0.6, true);
    const doorAt = paramsOf(building).num("doorAt", (x1 - x0) / 2);
    front(b, m, x0, x1, z1, 2, doorAt, true);
    flanks(b, m, x0, x1, z0, z1, 2, true);
    // A loggia over the door: two columns and a marble canopy.
    for (const dx of [-0.9, 0.9]) b.cylinder(x0 + doorAt + dx, z1 + 0.6, 0.3, 2.45, 0.1, 8, { mat: m.shaft });
    b.box(x0 + doorAt - 1.1, 2.45, z1, x0 + doorAt + 1.1, 2.6, z1 + 0.8, sides(m.slab, m.frieze));
    hangingSign(b, x0 + Math.max(0.6, doorAt - 1.7), 2.6, z1, tolSign(trade, m.pal), m.slab);
    return [x0 + doorAt, 1, z1];
  };
}

function temple(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const zp = z1 - 1.6;
    const h = 4.2;
    block(b, m, x0, z0, x1, zp, h, false);
    hipRoof(b, x0 - 0.15, z0 - 0.15, x1 + 0.15, zp + 0.1, h, 0.6, m.copper);
    domeOn(b, m, xm, (z0 + zp) / 2, h + 0.4, Math.min(x1 - x0, zp - z0) * 0.36, 1.0);
    portico(b, m, x0 + 0.4, x1 - 0.4, zp, z1, h, Math.max(4, Math.round((x1 - x0) / 1.4)));
    door(b, xm, 0.3, zp, doorMaterial(C.DARKWOOD, C.GOLD, "arch"));
    flanks(b, m, x0, x1, z0, zp, 1);
    const banner = bannerMaterial(m.pal.cloth!, m.pal.trim!);
    for (const x of [x0 + 1.0, x1 - 1.0]) b.card(fitted(banner), x - 0.375, h - 2.6, x + 0.375, h - 0.6, zp + 0.02);
    return [xm, 1, z1];
  };
}

function guildhall(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const h = 0.3 + 2 * 2.2 + 0.4;
    block(b, m, x0, z0, x1, z1, h, true);
    // An arcade along the ground floor: arched openings between pilasters, arched windows above.
    const arch = windowMaterial(m.pal.stone!, "dark", "arch");
    const bays = windowSpots(x1 - x0, undefined, 1.6, 0.8);
    for (const x of bays) if (Math.abs(x0 + x - xm) > 0.5) b.card(fitted(arch), x0 + x - 0.5, 0.3, x0 + x + 0.5, 2.3, z1 + 0.01);
    for (let i = 0; i + 1 < bays.length; i++) {
      const x = x0 + (bays[i]! + bays[i + 1]!) / 2;
      b.box(x - 0.1, 0.3, z1, x + 0.1, h - 0.35, z1 + 0.1, sides(m.slab));
    }
    const up = windowMaterial(m.pal.stone!, "clear", "arch");
    for (const x of bays) window(b, x0 + x, 2.95, z1, up);
    flanks(b, m, x0, x1, z0, z1, 2);
    door(b, xm, 0.3, z1, doorMaterial(C.DARKWOOD, C.GOLD, "arch"), m.slab);
    plaque(b, xm, 2.4, z1 + 0.01, signMaterial(trade, m.pal.accent!, m.pal.trim!, "shield"));
    // Three domes along the roof, the middle one the greatest.
    const r = Math.min(z1 - z0, (x1 - x0) / 3) * 0.32;
    domeOn(b, m, xm, (z0 + z1) / 2, h, r * 1.3, 0.7);
    domeOn(b, m, x0 + (x1 - x0) * 0.18, (z0 + z1) / 2, h, r * 0.75, 0.35);
    domeOn(b, m, x1 - (x1 - x0) * 0.18, (z0 + z1) / 2, h, r * 0.75, 0.35);
    const banner = bannerMaterial(m.pal.cloth!, m.pal.trim!);
    for (const x of [x0 + 0.45, x1 - 0.45]) b.card(fitted(banner), x - 0.375, h - 2.4, x + 0.375, h - 0.4, z1 + 0.02);
    return [xm, 1, z1];
  };
}

function smithy(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const back = z1 - 1.8;
    const xm = (x0 + x1) / 2;
    block(b, m, x0, z0, x1, back, 3.0, false);
    hipRoof(b, x0 - 0.15, z0 - 0.15, x1 + 0.15, back + 0.15, 3.0, 0.9, m.copper);
    // The working floor under a copper canopy on columns.
    b.box(x0, 0, back, x1, 0.15, z1, sides(m.slab));
    for (const x of [x0 + 0.3, x1 - 0.3]) column(b, x, z1 - 0.3, 0.15, 2.5, 0.12, m.shaft, m.slab);
    b.box(x0 - 0.1, 2.5, back, x1 + 0.1, 2.65, z1, sides(m.frieze));
    slope(b, x0 - 0.15, back, x1 + 0.15, z1 + 0.15, 2.65, 3.1, m.copper);
    // A forge, its coals glowing, its copper flue above the roof; an anvil.
    const fx = x0 + 1.0;
    b.box(fx - 0.6, 0.15, back, fx + 0.6, 0.85, back + 0.8, sides(m.wall));
    b.box(fx - 0.45, 0.85, back + 0.08, fx + 0.45, 0.9, back + 0.7, sides(fitted(glowing(C.FIRE[2]!))));
    b.cylinder(fx, back + 0.3, 1.5, 4.6, 0.22, 8, { mat: m.copper });
    b.cylinder(fx, back + 0.3, 4.6, 4.8, 0.3, 8, { mat: m.copper }, { mat: flat(C.INK) });
    anvil(b, xm + 0.4, z1 - 0.9);
    door(b, x1 - 0.8, 0.15, back, doorMaterial(C.DARKWOOD, m.pal.stone!, "arch"));
    hangingSign(b, x0 + 0.4, 2.4, z1 - 0.05, tolSign(trade, m.pal), m.slab);
    flanks(b, m, x0, x1, z0, back, 1);
    return [x1 - 0.8, 1, back];
  };
}

/** An anvil on a marble block. */
function anvil(b: MeshBuilder, x: number, z: number): void {
  const ironFace = sides(flat(C.IRON[2]!), flat(C.IRON[4]!));
  b.box(x - 0.2, 0.15, z - 0.18, x + 0.2, 0.55, z + 0.18, sides(tiled(marbleSlab(R.MARBLE))));
  b.box(x - 0.3, 0.55, z - 0.12, x + 0.25, 0.72, z + 0.12, ironFace);
  b.box(x + 0.25, 0.6, z - 0.06, x + 0.42, 0.7, z + 0.06, ironFace);
}

/** The Academy's library: a domed rotunda ringed by a colonnade, a portico to the south. */
function library(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const r = Math.min(x1 - x0, z1 - z0 - 1.2) / 2 - 0.45;
    const cz = z0 + 0.45 + r;
    const h = 4.0;
    b.cylinder(xm, cz, 0, 0.35, r + 0.5, 16, { mat: marbleSlab(m.pal.stone!) }, { mat: marbleSlab(m.pal.stone!) });
    b.cylinder(xm, cz, 0.35, h, r, 16, { mat: marble(m.pal.stone!) }, undefined, 0, 1, 2);
    b.cylinder(xm, cz, h - 0.35, h - 0.1, r + 0.02, 16, { mat: azure(m.pal.accent!) });
    b.cylinder(xm, cz, h - 0.1, h + 0.05, r + 0.45, 16, { mat: marbleSlab(m.pal.stone!) }, { mat: marbleSlab(m.pal.stone!) });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (Math.cos(a) > 0.85) continue;
      column(b, xm + Math.sin(a) * (r + 0.3), cz + Math.cos(a) * (r + 0.3), 0.35, h - 0.1, 0.11, m.shaft, m.slab);
    }
    const tall = windowMaterial(m.pal.stone!, "lit", "arch");
    for (const a of [-Math.PI / 2, -Math.PI / 4, Math.PI / 4, Math.PI / 2]) b.at(xm, 0, cz, a, () => b.card(fitted(tall), -0.5, 1.4, 0.5, 2.525, r + 0.01));
    domeOn(b, m, xm, cz, h + 0.05, r * 0.95, 0.9, true);
    portico(b, m, xm - 1.6, xm + 1.6, cz + r - 0.2, z1, 3.4, 4);
    door(b, xm, 0.3, cz + r + 0.02, doorMaterial(C.DARKWOOD, C.GOLD, "arch"));
    plaque(b, xm, 2.4, cz + r + 0.03, signMaterial(trade, m.pal.accent!, m.pal.trim!, "round"));
    return [xm, 1, z1];
  };
}

/** A mage's spire: slender and tall, a dome at its top girdled by an orrery's gilded ring and its planets. */
function tower(m: Mats, trade: Trade, floors: number): Draw {
  return (b, x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const r = Math.min(x1 - x0, z1 - z0) / 2 - 0.4;
    const h = 2.4 + floors * 2.2;
    b.cylinder(cx, cz, 0, 0.35, r + 0.3, 12, { mat: marbleSlab(m.pal.stone!) }, { mat: marbleSlab(m.pal.stone!) });
    b.cylinder(cx, cz, 0.35, h, r, 12, { mat: marble(m.pal.stone!) }, undefined, 0, 1, 2);
    for (let f = 1; f <= floors; f++) b.cylinder(cx, cz, f * 2.2 + 0.1, f * 2.2 + 0.3, r + 0.04, 12, { mat: azure(m.pal.accent!) });
    const glass = windowMaterial(m.pal.stone!, "lit", "arch");
    for (let k = 1; k <= floors; k++) {
      const a = ((k % 3) - 1) * (Math.PI / 4);
      b.at(cx, 0, cz, a, () => b.card(fitted(glass), -0.4, 0.55 + k * 2.2, 0.4, 1.45 + k * 2.2, r + 0.01));
    }
    // A gallery under the dome, the dome, and the orrery round it.
    b.cylinder(cx, cz, h, h + 0.15, r + 0.35, 12, { mat: marbleSlab(m.pal.stone!) }, { mat: marbleSlab(m.pal.stone!) });
    domeOn(b, m, cx, cz, h + 0.15, r + 0.1, 0.6, true);
    const ringY = h + 0.15 + 0.6 + (r + 0.1) * 0.45;
    const rr = r + 0.85;
    const n = 20;
    const pt = (a: number): V3 => [cx + Math.sin(a) * rr, ringY + Math.sin(a) * 0.3, cz + Math.cos(a) * rr];
    for (let i = 0; i < n; i++) bar(b, pt((i / n) * Math.PI * 2), pt(((i + 1) / n) * Math.PI * 2), 0.035, gold());
    [C.RED[4]!, C.BLUE[5]!, C.GOLD[5]!, C.TEAL[4]!].forEach((c, i) => {
      const p = pt(i * 1.7 + 0.4);
      b.blob(p[0], p[1], p[2], 0.13, 0.13, 0.13, glowing(c));
    });
    door(b, cx, 0.35, cz + r, doorMaterial(R.TOLARIAN_CLOTH, m.pal.stone!, "arch"));
    plaque(b, cx, 2.45, cz + r + 0.02, signMaterial(trade, m.pal.accent!, m.pal.trim!, "round"));
    return [cx, 1, cz + r];
  };
}

function warehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    block(b, m, x0, z0, x1, z1, 3.6, false);
    hipRoof(b, x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, 3.6, 1.4, m.copper);
    b.card(fitted(doorMaterial(C.DARKWOOD, m.pal.stone!, "arch", true)), xm - 1.0, 0.3, xm + 1.0, 2.9, z1 + 0.01);
    const round = windowMaterial(m.pal.stone!, "clear", "round");
    for (const x of windowSpots(x1 - x0, xm - x0, 2.0)) window(b, x0 + x, 1.8, z1, round);
    for (const z of windowSpots(z1 - z0, undefined, 2.0, 1.0)) {
      sideWindow(b, x1, 1.8, z0 + z, 1, round);
      sideWindow(b, x0, 1.8, z0 + z, -1, round);
    }
    crate(b, x0 + 0.6, z1 + 0.55, 0.65);
    crate(b, x0 + 1.35, z1 + 0.5, 0.55, "fish");
    barrel(b, x1 - 0.55, z1 + 0.5);
    return [xm, 1, z1];
  };
}

/** A round tower with a dome: the gatehouse's, the wall's. */
function roundTower(b: MeshBuilder, m: Mats, cx: number, cz: number, r: number, h: number): void {
  b.cylinder(cx, cz, 0, h, r, 12, { mat: marble(m.pal.stone!) }, undefined, 0, 1, 2);
  b.cylinder(cx, cz, h - 0.4, h - 0.15, r + 0.02, 12, { mat: azure(m.pal.accent!) });
  b.cylinder(cx, cz, h - 0.15, h, r + 0.15, 12, { mat: marbleSlab(m.pal.stone!) }, { mat: marbleSlab(m.pal.stone!) });
  domeOn(b, m, cx, cz, h, r * 0.85, 0.3);
  const slit = windowMaterial(m.pal.stone!, "dark", "arch");
  b.at(cx, 0, cz, 0, () => b.card(fitted(slit), -0.25, h - 2.0, 0.25, h - 1.45, r + 0.01));
}

function gatehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const g0 = xm - 1;
    const g1 = xm + 1;
    const h = 4.6;
    const r = Math.min(g0 - x0, z1 - z0) / 2;
    roundTower(b, m, (x0 + g0) / 2, (z0 + z1) / 2, r, h);
    roundTower(b, m, (g1 + x1) / 2, (z0 + z1) / 2, r, h);
    // The arch over the passage: marble, an azure frieze, a gilded keystone, merlons along its walk.
    b.box(g0 - 0.2, 2.6, z0 + 0.2, g1 + 0.2, 3.7, z1 - 0.2, sides(m.wall, m.slab));
    b.box(g0 - 0.2, 3.35, z1 - 0.21, g1 + 0.2, 3.6, z1 - 0.18, sides(m.frieze));
    b.box(xm - 0.15, 2.45, z1 - 0.25, xm + 0.15, 2.85, z1 - 0.15, sides(gold()));
    merlons(b, g0 - 0.2, z1 - 0.3, g1 + 0.2, z1 - 0.3, 3.7, m.slab, 0.25);
    return [xm, 1, z1];
  };
}

function wall(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 2.8;
    b.box(x0, 0, z0, x1, h, z1, sides(m.wall, m.slab));
    b.box(x0 - 0.02, h - 0.55, z0 - 0.02, x1 + 0.02, h - 0.3, z1 + 0.02, sides(m.frieze));
    if (x1 - x0 >= z1 - z0) {
      merlons(b, x0, z1 - 0.1, x1, z1 - 0.1, h, m.slab, 0.25, 0.6);
      merlons(b, x0, z0 + 0.1, x1, z0 + 0.1, h, m.slab, 0.25, 0.6);
    } else {
      merlons(b, x1 - 0.1, z0, x1 - 0.1, z1, h, m.slab, 0.25, 0.6);
      merlons(b, x0 + 0.1, z0, x0 + 0.1, z1, h, m.slab, 0.25, 0.6);
    }
    return undefined;
  };
}

function wallTower(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    roundTower(b, m, (x0 + x1) / 2, (z0 + z1) / 2, Math.min(x1 - x0, z1 - z0) / 2 - 0.05, 4.8);
    return undefined;
  };
}

function tolarian(building: BuildingData, pal: Palette): Built {
  const m = mats(pal);
  const P = paramsOf(building);
  const kind = building.kind ?? "house";
  const trade = tradeOf(building);
  const cap = marbleSlab(pal.stone!);
  const go = (height: number, draw: Draw, through = false) => styled(building, { cap, height, through }, draw);
  switch (kind) {
    case "shop":
      return go(0.3 + P.num("floors", 1) * 2.2 + 1, house(m, building, P.num("floors", 1), false, trade ?? "general"));
    case "inn":
      return go(8.5, inn(m, building, trade ?? "inn"));
    case "temple":
      return go(9.5, temple(m));
    case "guildhall":
      return go(8, guildhall(m, trade ?? "guild"));
    case "smithy":
      return go(4.8, smithy(m, trade ?? "smith"));
    case "library":
      return go(9, library(m, trade ?? "books"));
    case "tower":
      return go(2.4 + P.num("floors", 3) * 2.2 + 3.5, tower(m, trade ?? "magic", P.num("floors", 3)));
    case "warehouse":
      return go(5, warehouse(m));
    case "gatehouse":
      return go(5.5, gatehouse(m), true);
    case "wall":
      return go(3.1, wall(m));
    case "wall-tower":
      return go(6, wallTower(m));
    default: {
      const floors = P.num("floors", 1);
      return go(0.3 + floors * 2.2 + 3, house(m, building, floors, P.bool("dome", true)));
    }
  }
}

BUILDINGS.define(
  "tolarian",
  "Tolaria's style (Walassa, the Academy): blue-veined marble, verdigris domes on drums, porticoes of fluted columns, azure tile friezes, round and arched windows. Kinds: house (params floors 1-2, dome true|false), shop (floors), inn, temple (a portico and a great dome), guildhall (an arcade, three domes), smithy (open front under a copper canopy), library (a domed rotunda in a colonnade), tower (a mage's spire with an orrery; floors), warehouse, gatehouse (round towers; its passage the middle 2 tiles), wall, wall-tower; params.trade names a sign's emblem, params.doorAt the door",
  tolarian,
  TOLARIAN,
);

showcase("tolarian", [
  { kind: "house", w: 4, d: 4, label: "small" },
  { kind: "house", w: 6, d: 5, label: "two floors", params: { floors: 2 } },
  { kind: "shop", w: 6, d: 4, params: { trade: "potions" } },
  { kind: "inn", w: 8, d: 6 },
  { kind: "smithy", w: 6, d: 5 },
  { kind: "guildhall", w: 10, d: 6 },
  { kind: "temple", w: 8, d: 9 },
  { kind: "library", w: 9, d: 10 },
  { kind: "tower", w: 4, d: 4, params: { floors: 3 } },
  { kind: "tower", w: 3, d: 3, label: "slender", params: { floors: 4 } },
  { kind: "warehouse", w: 8, d: 5 },
  { kind: "gatehouse", w: 6, d: 3 },
  { kind: "wall-tower", w: 3, d: 3 },
  { kind: "wall", w: 6, d: 1 },
]);
