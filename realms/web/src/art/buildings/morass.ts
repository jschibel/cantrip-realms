import type { BuildingData, XYZ } from "../../world/format";
import { type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import * as Pic from "../paint/pictures";
import { Pixmap, type Rgb, hash2, seeded } from "../paint/pixmap";
import { fbm, valueNoise } from "../paint/procedural";
import * as R from "../paint/ramps";
import { barrel, crate, iron, sack } from "../props/draw";
import { bannerMaterial, cutout, glowing, limb } from "../props/kit";
import type { Built, Frames } from "../recipe";
import { coneRoof, doorMaterial, hangingSign, params as paramsOf, plaque, roofFace, signMaterial, styled, type Trade, tradeOf, windowSpots } from "./kit";
import { BUILDINGS, showcase } from "./registry";

// The Caligo Morass's style: dark stilt-houses of tarred planks standing on crooked stilts over the mire, their steep
// roofs of moss-grown shingles sagging at the ridge, a flight of steps up to a raised door, windows lit a sickly
// yellow-green, green lanterns hung from brackets, black cloth, and skulls and bones nailed up against what walks the
// swamp at night. A whole house is a touch askew (turned a hair off true), as nothing in the Morass stands straight.
//
// Kinds: house, shop, tenement, inn, temple, guildhall, smithy, library, tower, warehouse, gatehouse (its passage the
// middle 2 tiles), wall, wall-tower. Params: trade (the sign's emblem), floors (tenement, tower), stilts (their height,
// 1.2), doorAt (along the front, tiles from the west end). Palette slots: wall (planks), roof (shingles), timber
// (stilts and frames), cloth.

const MORASS: Palette = { wall: R.TARRED, roof: R.MOSS_ROOF, timber: R.DEADWOOD, cloth: C.BLACK };

// --- Shared with the other new styles: flames laid as a building is (keldon.ts, llanowar.ts) ------------------------------

/** Draws in a building's frame, as `placeBuilding` does (registry.ts): facing south on its footprint, turned to its rot. */
export function inFrame(building: BuildingData, b: MeshBuilder, draw: (x0: number, z0: number, x1: number, z1: number) => void): void {
  const rot = ((building.rot % 4) + 4) % 4;
  const { x, z, w, d } = building;
  if (rot === 0) {
    draw(x, z, x + w, z + d);
    return;
  }
  const across = rot % 2 === 0 ? w : d;
  const deep = rot % 2 === 0 ? d : w;
  b.at(x + w / 2, 0, z + d / 2, (-rot * Math.PI) / 2, () => draw(-across / 2, -deep / 2, across / 2, deep / 2));
}

/** Fires burning at spots of a building (fire bowls, a forge): three frames of flame, laid out and turned as it is. */
export function fireFrames(building: BuildingData, spots: (x0: number, z0: number, x1: number, z1: number) => readonly XYZ[], n = 12): Frames {
  return {
    rate: 8,
    models: [0, 1, 2].map((f) => {
      const m = material(`flame-${f}-${n}`, () => Pic.flame(f, n), { glowing: true, cutout: true });
      const fb = new MeshBuilder();
      inFrame(building, fb, (x0, z0, x1, z1) => {
        for (const [x, y, z] of spots(x0, z0, x1, z1)) {
          fb.card(fitted(m), x - n / 32, y, x + n / 32, y + n / 16, z);
          // A second card across the first, so the fire reads from the turned headings.
          fb.at(x, 0, z, Math.PI / 2, () => fb.card(fitted(m), -n / 32, y, n / 32, y + n / 16, 0));
        }
      });
      return fb.model();
    }),
  };
}

// --- Pictures -------------------------------------------------------------------------------------------------------------

/** Tarred planks standing on end, 16 by 32: four texels a plank, dark gaps, grain, a nail here and there. */
function tarredPlanks(r: Ramp): Pixmap {
  const p = new Pixmap(16, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const plank = Math.floor(x / 4);
      const n = valueNoise(x * 3, y, 6, 32, 40 + plank);
      let c = n < 0.3 ? r[2]! : n < 0.7 ? r[3]! : r[4]!;
      if (x % 4 === 0) c = r[0]!;
      else if (x % 4 === 1) c = r[5]!;
      if (hash2(x, y, 41) < 0.05) c = r[2]!;
      if ((y + plank * 7) % 32 === 3 && x % 4 === 2) c = C.IRON[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Mossy shingles, 32 by 32: overlapping rows of grey-black shingles, their lower edges ragged, moss gathering on them. */
function mossShingles(r: Ramp): Pixmap {
  const p = new Pixmap(32, 32);
  const m = R.MOSS;
  for (let row = 0; row < 8; row++) {
    const shift = (row % 2) * 3;
    for (let x = 0; x < 32; x++) {
      const t = Math.floor((x + shift) / 6);
      const tone = hash2(t, row, 51) < 0.35 ? 2 : 3;
      const len = 4 - (hash2(t, row, 52) < 0.3 ? 1 : 0);
      for (let j = 0; j < 4; j++) {
        const y = row * 4 + j;
        let c = r[tone]!;
        if (j === 0) c = r[tone + 1]!;
        if (j >= len) c = r[0]!;
        if ((x + shift) % 6 === 5) c = r[1]!;
        // Moss in a few soft cushions, catching the light on the shingles' upper edges, speckled in round them.
        const moss = fbm(x, y, 16, 32, 53) + (hash2(x, y, 54) - 0.5) * 0.12;
        if (moss > 0.62) c = j === 0 ? m[3]! : m[2]!;
        if (moss > 0.7 && j < 2) c = m[4]!;
        p.set(x, y, c);
      }
    }
  }
  return p;
}

/** A window lit a sickly yellow-green, 16 by 18: a crooked frame, cross bars, a cracked pane. */
function sicklyWindow(frame: Ramp): Pixmap {
  const p = new Pixmap(16, 18);
  p.fill(0, 0);
  const glass: Rgb[] = [0x4c6a26, 0x6a9238, 0x92b850, 0xbcd874];
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 16; x++) {
      const tilt = Math.round(y / 9);
      const xx = x - tilt;
      if (xx < 0 || xx > 14) continue;
      if (xx < 2 || xx > 12 || y < 2 || y > 15) {
        p.set(x, y, y > 15 ? frame[4]! : xx < 2 ? frame[3]! : frame[2]!);
        continue;
      }
      if (xx === 7 || y === 8) {
        p.set(x, y, frame[1]!);
        continue;
      }
      p.set(x, y, glass[Math.min(3, Math.floor((16 - y) / 4) + (hash2(x, y, 3) < 0.1 ? 1 : 0))]!);
    }
  }
  for (let i = 0; i < 4; i++) p.set(3 + i, 11 + (i >> 1), 0x3a4418);
  return p;
}

/** A skull with crossed bones under it, cut out (the slice's skull, nailed up). */
function skullAndBones(): Pixmap {
  const p = new Pixmap(12, 12);
  p.fill(0, 0);
  const b = C.BONE;
  for (let i = 0; i < 12; i++) {
    p.set(i, 7 + Math.floor(i / 3), b[4]!);
    p.set(11 - i, 7 + Math.floor(i / 3), b[3]!);
  }
  p.blit(Pic.skull(), 2, 0);
  return p;
}

/** Wet stones and mud, 32 square: a footing. */
function footing(): Pixmap {
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = fbm(x, y, 8, 32, 61);
      p.set(x, y, n < 0.35 ? R.MUD[3]! : n < 0.55 ? C.COBBLE[2]! : n < 0.75 ? C.COBBLE[3]! : R.MOSS[3]!);
    }
  }
  return p;
}

const mats = (pal: Palette) => {
  const wall = pal.wall ?? R.TARRED;
  const roof = pal.roof ?? R.MOSS_ROOF;
  const timber = pal.timber ?? R.DEADWOOD;
  return {
    wall: material(`tarred-planks@${rampKey(wall)}`, () => tarredPlanks(wall)),
    roof: material(`moss-shingles@${rampKey(roof)}`, () => mossShingles(roof)),
    timber: material(`morass-timber@${rampKey(timber)}`, () => tarredPlanks(timber), { smooth: true }),
    deck: material(`morass-deck@${rampKey(timber)}`, () => tarredPlanks(timber)),
    window: material(`sickly-window@${rampKey(timber)}`, () => sicklyWindow(timber), { cutout: true, glow: 0.7 }),
    door: doorMaterial(timber, R.WEATHERED, "square", true),
    cloth: pal.cloth ?? C.BLACK,
    skull: cutout("skull-and-bones", skullAndBones, false),
    lanternGlass: glowing(0xc8e060),
  };
};
type Mats = ReturnType<typeof mats>;

// --- Pieces ---------------------------------------------------------------------------------------------------------------

/** Crooked stilts under a floor from x0..x1, z0..z1 at height h, cross-braced along the front and sides. */
function stilts(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, h: number, mat: Material, seed: number): void {
  const random = seeded(seed + 17);
  const xs = [x0 + 0.15, ...windowSpots(x1 - x0, undefined, 1.6, 0.9).map((x) => x0 + x), x1 - 0.15];
  for (const z of [z0 + 0.15, z1 - 0.15]) {
    for (const x of xs) {
      const lean = (random() - 0.5) * 0.25;
      limb(b, [x + lean, -0.1, z + (random() - 0.5) * 0.2], [x, h, z], 0.1, 0.08, mat, 5);
    }
  }
  if (z1 - z0 > 2.5) for (const x of [x0 + 0.15, x1 - 0.15]) limb(b, [x, -0.1, (z0 + z1) / 2], [x, h, (z0 + z1) / 2], 0.09, 0.08, mat, 5);
  // Braces: crossed poles on the front and both sides.
  limb(b, [xs[0]!, 0.15, z1 - 0.15], [xs[1]!, h - 0.15, z1 - 0.15], 0.05, 0.05, mat, 4);
  limb(b, [xs[xs.length - 1]!, 0.15, z1 - 0.15], [xs[xs.length - 2]!, h - 0.15, z1 - 0.15], 0.05, 0.05, mat, 4);
  limb(b, [x0 + 0.15, 0.15, z1 - 0.15], [x0 + 0.15, h - 0.15, z0 + 0.15], 0.05, 0.05, mat, 4);
  limb(b, [x1 - 0.15, 0.15, z0 + 0.15], [x1 - 0.15, h - 0.15, z1 - 0.15], 0.05, 0.05, mat, 4);
}

/** A gable roof whose ridge sags in the middle: two slopes, each of two faces, the gable ends and a crooked ridge pole. */
function saggingRoof(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, sag: number, roof: Material, gable: Material, ridge: Material): void {
  const zm = (z0 + z1) / 2;
  const xm = (x0 + x1) / 2;
  const t = y + rise;
  const run = (z1 - z0) / 2;
  const ey = y - sag * 0.4;
  roofFace(b, roof, [[x0, y, z1], [xm, ey, z1], [xm, t - sag, zm], [x0, t, zm]], run, rise);
  roofFace(b, roof, [[xm, ey, z1], [x1, y, z1], [x1, t, zm], [xm, t - sag, zm]], run, rise);
  roofFace(b, roof, [[x1, y, z0], [xm, ey, z0], [xm, t - sag, zm], [x1, t, zm]], run, rise);
  roofFace(b, roof, [[xm, ey, z0], [x0, y, z0], [x0, t, zm], [xm, t - sag, zm]], run, rise);
  const inset = 0.3;
  for (const [x, s] of [
    [x1 - inset, 1],
    [x0 + inset, -1],
  ] as const) {
    const tri: [number, number, number][] = s > 0 ? [[x, y - 0.05, z1 - 0.35], [x, y - 0.05, z0 + 0.35], [x, t - 0.2, zm]] : [[x, y - 0.05, z0 + 0.35], [x, y - 0.05, z1 - 0.35], [x, t - 0.2, zm]];
    b.polygon(gable, tri, tri.map((c) => [(s > 0 ? -c[2] : c[2]), c[1] / 2] as [number, number]));
  }
  limb(b, [x0 - 0.12, t + 0.04, zm], [xm, t - sag + 0.04, zm], 0.07, 0.07, ridge, 5);
  limb(b, [xm, t - sag + 0.04, zm], [x1 + 0.12, t + 0.04, zm], 0.07, 0.07, ridge, 5);
}

/** Steps from the ground at zFoot up to a floor at height h ending at zTop, `w` wide, centred on x, with handrails. */
function steps(b: MeshBuilder, x: number, zTop: number, zFoot: number, h: number, w: number, m: Mats): void {
  const n = Math.max(3, Math.round(h / 0.25));
  const run = (zFoot - zTop) / n;
  const tread = tiled(m.deck);
  for (let i = 0; i < n; i++) {
    const y = h - ((i + 1) * h) / n;
    b.box(x - w / 2, y, zTop + i * run, x + w / 2, y + 0.1, zTop + (i + 1) * run + 0.04, sides(tread));
  }
  for (const sx of [x - w / 2 - 0.05, x + w / 2 + 0.05]) {
    limb(b, [sx, 0, zFoot - 0.05], [sx, 0.85, zFoot - 0.05], 0.04, 0.04, m.timber, 4);
    limb(b, [sx, 0.8, zFoot - 0.05], [sx, h + 0.8, zTop], 0.03, 0.03, m.timber, 4);
  }
}

/** A green lantern hung from a bracket on a wall facing south at z. */
function greenLantern(b: MeshBuilder, x: number, y: number, z: number, m: Mats): void {
  b.box(x - 0.03, y + 0.35, z, x + 0.03, y + 0.41, z + 0.4, sides(iron()));
  b.box(x - 0.01, y + 0.2, z + 0.34, x + 0.01, y + 0.36, z + 0.36, sides(iron()));
  b.box(x - 0.1, y - 0.1, z + 0.25, x + 0.1, y + 0.2, z + 0.45, sides(fitted(m.lanternGlass)));
  b.box(x - 0.13, y + 0.2, z + 0.22, x + 0.13, y + 0.26, z + 0.48, sides(iron()));
  b.box(x - 0.12, y - 0.14, z + 0.23, x + 0.12, y - 0.1, z + 0.47, sides(iron()));
}

/** A cloth of the swamp's colors hung from an iron rod out from a wall facing south at z. */
function hangingCloth(b: MeshBuilder, x: number, y: number, z: number, cloth: Ramp): void {
  b.box(x - 0.45, y - 0.04, z, x + 0.45, y + 0.02, z + 0.12, sides(iron()));
  b.card(fitted(bannerMaterial(cloth, C.BONE)), x - 0.375, y - 2, x + 0.375, y - 0.02, z + 0.1);
}

/** A stilt-house's walls: x0..x1, z0..zf (front), standing on a floor at `floor`, `walls` high. */
interface Body {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly zf: number;
  readonly floor: number;
  readonly walls: number;
}

/** Walls of tarred planks, corner posts, a beam along the front's top, and lit windows down the sides. */
function body(b: MeshBuilder, s: Body, m: Mats, seed: number, windows = true): void {
  const { x0, x1, z0, zf, floor, walls } = s;
  const post = tiled(m.timber);
  b.box(x0, floor + 0.15, z0, x1, floor + walls, zf, sides(tiled(m.wall)));
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x0, z0],
    [x1, z0],
  ] as const)
    b.box(x - 0.09, floor, z - 0.09, x + 0.09, floor + walls + 0.05, z + 0.09, sides(post));
  b.box(x0 - 0.06, floor + walls - 0.12, zf, x1 + 0.06, floor + walls, zf + 0.08, sides(post));
  if (!windows) return;
  const random = seeded(seed + 3);
  for (const z of windowSpots(zf - z0, undefined, 1.6, 0.9)) {
    const y = floor + 0.55 + (random() - 0.5) * 0.12;
    b.at(x1 + 0.01, 0, z0 + z, Math.PI / 2, () => b.card(fitted(m.window), -0.5, y, 0.5, y + 1.125, 0));
    b.at(x0 - 0.01, 0, z0 + z, -Math.PI / 2, () => b.card(fitted(m.window), -0.5, y, 0.5, y + 1.125, 0));
  }
}

/** The front's door (at `door` along it, a skull over it) and its windows, set a little askew. */
function front(b: MeshBuilder, s: Body, door: number | undefined, m: Mats, seed: number): void {
  const random = seeded(seed + 9);
  if (door !== undefined) {
    b.card(fitted(m.door), s.x0 + door - 0.625, s.floor + 0.15, s.x0 + door + 0.625, s.floor + 2.15, s.zf + 0.01);
    b.card(fitted(m.skull), s.x0 + door - 0.19, s.floor + 2.15, s.x0 + door + 0.19, s.floor + 2.53, s.zf + 0.02);
  }
  for (const x of windowSpots(s.x1 - s.x0, door, 1.6, 0.85)) {
    const y = s.floor + 0.6 + (random() - 0.5) * 0.15;
    b.card(fitted(m.window), s.x0 + x - 0.5, y, s.x0 + x + 0.5, y + 1.125, s.zf + 0.01);
  }
}

/** A deck on stilts from x0..x1, z0..z1 at height h. */
function deck(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, h: number, m: Mats): void {
  b.box(x0, h, z0, x1, h + 0.15, z1, sides(tiled(m.timber), tiled(m.deck)));
}

type Draw = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined;

/**
 * A stilt-house on its footprint: the stilts and deck, a porch at the front and steps down to the ground at the door,
 * the house on the deck under its sagging roof. `extra` adds what a kind has besides (a counter, a sign, cloth).
 */
function stiltHouse(building: BuildingData, m: Mats, opts: { storeys?: number; rise?: number; sag?: number; extra?: (b: MeshBuilder, s: Body, door: number) => void }): Draw {
  return (b, x0, z0, x1, z1) => {
    const P = paramsOf(building);
    const h = P.num("stilts", 1.2);
    const seed = Math.round(Math.abs(building.x * 7 + building.z * 13));
    const storeys = opts.storeys ?? 1;
    const walls = 2.2 * storeys;
    const zf = z1 - 1.6;
    const door = Math.min(x1 - x0 - 0.9, Math.max(0.9, P.num("doorAt", Math.round(x1 - x0) / 2)));
    const turn = ((seed % 5) - 2) * 0.012;
    stilts(b, x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.95, h, m.timber, seed);
    deck(b, x0, z0, x1, z1 - 0.9, h, m);
    steps(b, x0 + door, z1 - 0.9, z1, h + 0.15, 1.0, m);
    const hx = (x1 - x0) / 2 - 0.2;
    const hz = (zf - z0) / 2;
    b.at((x0 + x1) / 2, 0, (z0 + zf) / 2 + 0.05, turn, () => {
      const s: Body = { x0: -hx, x1: hx, z0: -hz + 0.1, zf: hz, floor: h, walls };
      const d = door - (x1 - x0) / 2 + hx;
      body(b, s, m, seed);
      front(b, s, d, m, seed);
      for (let k = 1; k < storeys; k++) for (const x of windowSpots(2 * hx, undefined, 1.6, 0.85)) b.card(fitted(m.window), -hx + x - 0.5, h + 0.6 + k * 2.2, -hx + x + 0.5, h + 1.725 + k * 2.2, hz + 0.01);
      saggingRoof(b, -hx - 0.35, -hz - 0.2, hx + 0.35, hz + 0.45, h + walls, opts.rise ?? 2.4, opts.sag ?? 0.22, m.roof, m.wall, m.timber);
      greenLantern(b, -hx + 0.4, h + 1.6, hz + 0.08, m);
      opts.extra?.(b, s, d);
    });
    return [x0 + door, h + 1, zf];
  };
}

// --- Kinds ---------------------------------------------------------------------------------------------------------------

const sign = (trade: Trade) => signMaterial(trade, R.WEATHERED, R.TARRED, "board");

function shopExtra(m: Mats, trade: Trade): (b: MeshBuilder, s: Body, door: number) => void {
  return (b, s, door) => {
    // A counter on the porch, wares on it and a sack beside it, the sign hung beyond the door.
    const xa = s.x0 + 0.2;
    const xb = Math.max(xa + 1.0, s.x0 + door - 0.85);
    b.box(xa, s.floor + 0.15, s.zf + 0.15, xb, s.floor + 1.0, s.zf + 0.55, sides(tiled(m.timber), tiled(m.deck)));
    crate(b, (xa + xb) / 2, s.zf + 0.35, 0.42, "fish", s.floor + 1.0);
    sack(b, s.x1 - 0.45, s.zf + 0.45);
    hangingSign(b, s.x0 + door + 1.05, s.floor + 2.3, s.zf, sign(trade), tiled(m.timber));
  };
}

function temple(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 1.2;
    const xm = (x0 + x1) / 2;
    const zf = z1 - 1.6;
    stilts(b, x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.95, h, m.timber, 5);
    deck(b, x0, z0, x1, z1 - 0.9, h, m);
    steps(b, xm, z1 - 0.9, z1, h + 0.15, 1.4, m);
    const s: Body = { x0: x0 + 0.3, x1: x1 - 0.3, z0: z0 + 0.3, zf, floor: h, walls: 3.0 };
    body(b, s, m, 7);
    front(b, s, xm - s.x0, m, 7);
    saggingRoof(b, s.x0 - 0.35, s.z0 - 0.3, s.x1 + 0.35, zf + 0.4, h + 3.0, 3.2, 0.25, m.roof, m.wall, m.timber);
    // A steeple over the door: a box of planks, a steep six-sided spire, a skull at its foot.
    const tw = 0.8;
    b.box(xm - tw, h + 3.0, zf - 1.6, xm + tw, h + 5.6, zf, sides(tiled(m.wall)));
    coneRoof(b, xm, zf - 0.8, h + 5.6, 1.25, 3.0, m.roof, 6);
    b.card(fitted(m.window), xm - 0.5, h + 4.0, xm + 0.5, h + 5.125, zf + 0.01);
    b.at(xm + tw + 0.01, 0, zf - 0.8, Math.PI / 2, () => b.card(fitted(m.window), -0.5, h + 4.0, 0.5, h + 5.125, 0));
    b.at(xm - tw - 0.01, 0, zf - 0.8, -Math.PI / 2, () => b.card(fitted(m.window), -0.5, h + 4.0, 0.5, h + 5.125, 0));
    for (const x of [xm - 1.5, xm + 1.5]) hangingCloth(b, x, h + 2.9, zf + 0.02, m.cloth);
    b.card(fitted(m.skull), xm - 0.35, h + 2.4, xm + 0.35, h + 3.1, zf + 0.03);
    return [xm, h + 1, zf];
  };
}

function smithy(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    // On the ground, on a footing of stones: a forge cannot stand on stilts.
    const stone = tiled(material("morass-footing", () => footing()));
    const back = z1 - 2.0;
    const xm = (x0 + x1) / 2;
    b.box(x0, 0, z0, x1, 0.35, back, sides(stone));
    const s: Body = { x0, x1, z0, zf: back, floor: 0.2, walls: 2.3 };
    body(b, s, m, 11);
    saggingRoof(b, x0 - 0.3, z0 - 0.3, x1 + 0.3, back + 0.3, 2.5, 1.8, 0.15, m.roof, m.wall, m.timber);
    // The open forge under a lean-to on crooked posts.
    for (const x of [x0 + 0.15, x1 - 0.15]) limb(b, [x, 0, z1 - 0.3], [x, 2.15, z1 - 0.3], 0.08, 0.07, m.timber, 5);
    roofFace(b, m.roof, [[x0 - 0.2, 2.1, z1 + 0.1], [x1 + 0.2, 2.1, z1 + 0.1], [x1 + 0.2, 2.6, back], [x0 - 0.2, 2.6, back]], z1 - back, 0.5);
    const fx = x0 + 1.1;
    b.box(fx - 0.6, 0, back, fx + 0.6, 0.8, back + 0.85, sides(stone));
    b.box(fx - 0.45, 0.8, back + 0.08, fx + 0.45, 0.85, back + 0.75, sides(fitted(glowing(C.FIRE[2]!))));
    b.box(fx - 0.25, 0.85, z0 + 0.5, fx + 0.25, 4.6, back + 0.3, sides(stone));
    b.cylinder(xm + 0.6, z1 - 1.0, 0, 0.45, 0.22, 7, { mat: m.timber });
    b.box(xm + 0.35, 0.45, z1 - 1.12, xm + 0.85, 0.62, z1 - 0.88, sides(iron()));
    b.card(fitted(m.door), x1 - 1.0 - 0.625, 0.35, x1 - 1.0 + 0.625, 2.35, back + 0.01);
    hangingSign(b, x0 + 0.3, 2.0, z1 - 0.3, sign(trade), tiled(m.timber));
    return [x1 - 1.0, 1, back];
  };
}

function tower(m: Mats, storeys: number): Draw {
  return (b, x0, z0, x1, z1) => {
    // A tall crooked tower of planks on stilts, each storey narrower and off true, a lit room at the top.
    const xm = (x0 + x1) / 2;
    const h = 1.2;
    const zf = z1 - 1.4;
    const zm = (z0 + zf) / 2;
    stilts(b, x0 + 0.2, z0 + 0.1, x1 - 0.2, z1 - 0.9, h, m.timber, 13);
    deck(b, x0 + 0.1, z0, x1 - 0.1, z1 - 0.85, h, m);
    steps(b, xm, z1 - 0.85, z1, h + 0.15, 0.9, m);
    let hw = (x1 - x0) / 2 - 0.35;
    let hd = (zf - z0) / 2 - 0.1;
    let y = h + 0.15;
    let lean = 0;
    for (let k = 0; k < storeys; k++) {
      const top = y + 2.1;
      const [w0, d0, y0] = [hw, hd, y];
      b.at(xm + lean, 0, zm, 0.03 * (k % 2 ? 1 : -1), () => {
        b.box(-w0, y0, -d0, w0, top, d0, sides(tiled(m.wall)));
        b.box(-w0 - 0.08, top - 0.12, -d0 - 0.08, w0 + 0.08, top, d0 + 0.08, sides(tiled(m.timber)));
        if (k > 0) b.card(fitted(m.window), -0.5, y0 + 0.6, 0.5, y0 + 1.725, d0 + 0.01);
        b.at(w0 + 0.01, 0, 0, Math.PI / 2, () => b.card(fitted(m.window), -0.5, y0 + 0.6, 0.5, y0 + 1.725, 0));
        b.at(-w0 - 0.01, 0, 0, -Math.PI / 2, () => b.card(fitted(m.window), -0.5, y0 + 0.6, 0.5, y0 + 1.725, 0));
      });
      y = top;
      hw *= 0.88;
      hd *= 0.88;
      lean += 0.08;
    }
    const fz = zm + (zf - z0) / 2 - 0.1;
    b.card(fitted(m.door), xm - 0.625, h + 0.15, xm + 0.625, h + 2.15, fz + 0.01);
    b.card(fitted(m.skull), xm - 0.19, h + 2.15, xm + 0.19, h + 2.53, fz + 0.02);
    coneRoof(b, xm + lean, zm, y, Math.max(hw, hd) * 1.6, 2.6, m.roof, 6);
    greenLantern(b, xm + 0.9, h + 1.5, fz + 0.02, m);
    return [xm, h + 1, fz];
  };
}

/** The Morass's gatehouse: two watch-huts on tall stilts either side of the passage, a plank bridge across between them. */
function gatehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const g0 = xm - 1;
    const g1 = xm + 1;
    const h = 2.6;
    for (const [xa, xb] of [
      [x0, g0],
      [g1, x1],
    ] as const) {
      stilts(b, xa + 0.05, z0 + 0.1, xb - 0.05, z1 - 0.1, h, m.timber, Math.round(Math.abs(xa * 3)));
      deck(b, xa, z0, xb, z1, h, m);
      const s: Body = { x0: xa + 0.15, x1: xb - 0.15, z0: z0 + 0.3, zf: z1 - 0.4, floor: h, walls: 1.8 };
      body(b, s, m, 21, false);
      b.card(fitted(m.window), (xa + xb) / 2 - 0.5, h + 0.55, (xa + xb) / 2 + 0.5, h + 1.675, s.zf + 0.01);
      saggingRoof(b, xa - 0.2, z0 + 0.05, xb + 0.2, z1 - 0.1, h + 1.8, 1.6, 0.1, m.roof, m.wall, m.timber);
    }
    // The bridge across the passage at the huts' floors, its rails, a skull and the swamp's cloth hung under it.
    deck(b, g0, z0 + 0.6, g1, z1 - 0.6, h, m);
    for (const z of [z0 + 0.65, z1 - 0.65]) limb(b, [g0, h + 0.85, z], [g1, h + 0.75, z], 0.04, 0.04, m.timber, 4);
    b.card(fitted(m.skull), xm - 0.3, h + 0.2, xm + 0.3, h + 0.8, z1 - 0.58);
    hangingCloth(b, xm, h, z1 - 0.62, m.cloth);
    return [xm, 1, z1];
  };
}

/** A palisade of crooked stakes along the footprint's longer side, bound with rope, skulls on some. */
function wall(building: BuildingData, m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const along = x1 - x0 >= z1 - z0;
    const length = along ? x1 - x0 : z1 - z0;
    const random = seeded(Math.round(Math.abs(building.x * 5 + building.z * 11)));
    const n = Math.round(length / 0.3);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = along ? x0 + t * (x1 - x0) : cx;
      const z = along ? cz : z0 + t * (z1 - z0);
      const hgt = 2.0 + random() * 0.6;
      const lean = (random() - 0.5) * 0.2;
      const top: [number, number, number] = [x + (along ? lean : 0), hgt, z + (along ? 0 : lean)];
      limb(b, [x, -0.1, z], top, 0.13, 0.11, m.timber, 5);
      limb(b, top, [top[0], hgt + 0.3, top[2]], 0.11, 0.01, m.timber, 5);
    }
    const rope = material("rope", () => new Pixmap(4, 4, C.STRAW[1]!));
    for (const y of [0.6, 1.7]) limb(b, along ? [x0, y, cz + 0.13] : [cx + 0.13, y, z0], along ? [x1, y, cz + 0.13] : [cx + 0.13, y, z1], 0.03, 0.03, rope, 4);
    for (let i = 2; i < n; i += 5) {
      const t = (i + 0.5) / n;
      if (along) b.card(fitted(m.skull), x0 + t * (x1 - x0) - 0.2, 1.2, x0 + t * (x1 - x0) + 0.2, 1.6, cz + 0.15);
      else b.at(cx + 0.15, 0, z0 + t * (z1 - z0), Math.PI / 2, () => b.card(fitted(m.skull), -0.2, 1.2, 0.2, 1.6, 0));
    }
    return undefined;
  };
}

/** A watch-hut on tall stilts, a ladder up to it, a green lantern. */
function wallTower(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 3.0;
    stilts(b, x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, h, m.timber, 31);
    deck(b, x0, z0, x1, z1, h, m);
    const s: Body = { x0: x0 + 0.2, x1: x1 - 0.2, z0: z0 + 0.2, zf: z1 - 0.35, floor: h, walls: 1.7 };
    body(b, s, m, 33, false);
    b.card(fitted(m.window), (x0 + x1) / 2 - 0.5, h + 0.45, (x0 + x1) / 2 + 0.5, h + 1.575, s.zf + 0.01);
    coneRoof(b, (x0 + x1) / 2, (z0 + z1) / 2, h + 1.7, Math.max(x1 - x0, z1 - z0) * 0.72, 2.0, m.roof, 6);
    const lx = x0 + 0.6;
    for (const dx of [-0.2, 0.2]) limb(b, [lx + dx, 0, z1 + 0.3], [lx + dx, h + 0.2, z1 + 0.02], 0.035, 0.035, m.timber, 4);
    for (let y = 0.3; y < h; y += 0.35) {
      const z = z1 + 0.3 - (y / (h + 0.2)) * 0.28;
      b.box(lx - 0.2, y, z - 0.02, lx + 0.2, y + 0.04, z + 0.02, sides(tiled(m.timber)));
    }
    greenLantern(b, x1 - 0.5, h + 1.0, s.zf + 0.02, m);
    return undefined;
  };
}

function morass(building: BuildingData, pal: Palette): Built {
  const kind = building.kind ?? "house";
  const P = paramsOf(building);
  const m = mats(pal);
  const trade = tradeOf(building);
  const go = (draw: Draw, through = false) => styled(building, draw, through);
  switch (kind) {
    case "shop":
      return go(stiltHouse(building, m, { extra: shopExtra(m, trade ?? "general") }));
    case "tenement": {
      const floors = P.num("floors", 2);
      return go(stiltHouse(building, m, { storeys: floors, rise: 2.6 }));
    }
    case "inn":
      return go(stiltHouse(building, m, {
        storeys: 2,
        rise: 2.6,
        extra: (b, s, door) => {
          hangingSign(b, s.x0 + door + 1.1, s.floor + 2.3, s.zf, sign(trade ?? "inn"), tiled(m.timber));
          greenLantern(b, s.x1 - 0.4, s.floor + 1.6, s.zf + 0.08, m);
          hangingCloth(b, s.x1 - 0.7, s.floor + 4.2, s.zf, m.cloth);
          barrel(b, s.x1 - 0.45, s.zf + 0.45);
        },
      }));
    case "temple":
      return go(temple(m));
    case "guildhall":
      return go(stiltHouse(building, m, {
        storeys: 2,
        rise: 2.2,
        sag: 0.35,
        extra: (b, s, door) => {
          plaque(b, s.x0 + door, s.floor + 2.65, s.zf, signMaterial(trade ?? "guild", C.BLACK, C.BONE, "shield"));
          hangingCloth(b, s.x0 + 0.8, s.floor + 4.3, s.zf, m.cloth);
          hangingCloth(b, s.x1 - 0.8, s.floor + 4.3, s.zf, m.cloth);
        },
      }));
    case "smithy":
      return go(smithy(m, trade ?? "smith"));
    case "library":
      return go(stiltHouse(building, m, {
        storeys: 2,
        rise: 2.8,
        extra: (b, s, door) => plaque(b, s.x0 + door, s.floor + 2.6, s.zf, signMaterial(trade ?? "books", R.TARRED, C.BONE, "board")),
      }));
    case "tower": {
      const floors = P.num("floors", 3);
      return go(tower(m, floors));
    }
    case "barn":
    case "warehouse":
      return go(stiltHouse(building, m, {
        rise: 2.0,
        sag: 0.3,
        extra: (b, s, door) => {
          b.box(s.x0 + door - 0.06, s.floor + s.walls + 0.1, s.zf, s.x0 + door + 0.06, s.floor + s.walls + 0.22, s.zf + 1.0, sides(tiled(m.timber)));
          b.box(s.x0 + door - 0.01, s.floor + 1.6, s.zf + 0.9, s.x0 + door + 0.01, s.floor + s.walls + 0.1, s.zf + 0.92, sides(iron()));
          barrel(b, s.x1 - 0.5, s.zf + 0.45);
          crate(b, s.x0 + 0.5, s.zf + 0.4, 0.55, undefined, s.floor + 0.15);
        },
      }));
    case "gatehouse":
      return go(gatehouse(m), true);
    case "wall":
      return go(wall(building, m));
    case "wall-tower":
      return go(wallTower(m));
    default:
      return go(stiltHouse(building, m, {}));
  }
}

BUILDINGS.define(
  "morass",
  "the Caligo Morass's style - stilt-houses of tarred planks over the mire, sagging moss-shingle roofs, steps up to a raised door, sickly green-lit windows, black cloth, skulls. Kinds: house, shop, tenement (floors), inn, temple, guildhall, smithy (on a stone footing), library, tower (floors), warehouse, gatehouse (its passage the middle 2 tiles, a plank bridge over it), wall (a palisade of stakes along its longer side), wall-tower; params: trade, stilts (1.2), doorAt. Palette: wall, roof, timber, cloth",
  morass,
  MORASS,
);

// The world's name for the style (world/format.ts STYLES: the Morass's, the Vess estate's villages).
BUILDINGS.define("urborg", "the Morass's style under the world's name for it: see morass", morass, MORASS);

showcase("morass", [
  { kind: "house", w: 5, d: 5 },
  { kind: "house", w: 4, d: 4, label: "hut" },
  { kind: "shop", w: 6, d: 5, params: { trade: "potions" } },
  { kind: "tenement", w: 4, d: 5 },
  { kind: "inn", w: 7, d: 6 },
  { kind: "temple", w: 6, d: 8 },
  { kind: "guildhall", w: 8, d: 6 },
  { kind: "smithy", w: 6, d: 5 },
  { kind: "library", w: 6, d: 6 },
  { kind: "tower", w: 4, d: 4, params: { floors: 3 } },
  { kind: "warehouse", w: 8, d: 6 },
  { kind: "gatehouse", w: 6, d: 3 },
  { kind: "wall-tower", w: 3, d: 3 },
  { kind: "wall", w: 6, d: 1 },
]);
