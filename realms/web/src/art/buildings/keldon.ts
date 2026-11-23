import type { BuildingData, XYZ } from "../../world/format";
import { type MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import { Pixmap, hash2, seeded } from "../paint/pixmap";
import { fbm, valueNoise } from "../paint/procedural";
import * as R from "../paint/ramps";
import * as T from "../paint/textures";
import { barrel, crate, iron, ironLight } from "../props/draw";
import { bannerMaterial, cloth, disc, glowing, limb, lump, rock, snowCover } from "../props/kit";
import type { Built } from "../recipe";
import { doorMaterial, hangingSign, hipRoof, params as paramsOf, plaque, shedRoof, signMaterial, styled, type Trade, tradeOf, windowMaterial, windowSpots } from "./kit";
import { fireFrames } from "./morass";
import { BUILDINGS, showcase } from "./registry";

// Keld's style: longhouses - long, low walls of pine logs on a footing of dark basalt, steep roofs of sod (or thatch)
// with snow lying on them, the gable beams crossed above the ridge and carved into dragons' heads, war-red cloth, round
// shields hung along the walls, and fire bowls burning at the doors. Its halls are bigger longhouses; its fire hall a
// tall one with a ring of standing stones and a fire before it; its watchtowers squat stone with a log gallery on top;
// its walls palisades of sharpened logs.
//
// Kinds: house, shop, inn (a mead hall), temple (a fire hall), guildhall, smithy, library (a skald's hall of stone),
// tower (a watchtower), warehouse (a storehouse on stone piers), gatehouse (its passage the middle 2 tiles), wall (a
// palisade along its longer side), wall-tower. Params: trade, doorAt, roof sod|thatch (sod), snow (true), floors (tower).
// Palette slots: timber (logs), stone (footings), roof (sod), cloth (red), trim (iron).

const KELDON: Palette = { timber: R.LOG, stone: R.KELD_STONE, roof: R.SOD, cloth: R.KELD_RED, trim: C.IRON };

// --- Pictures -------------------------------------------------------------------------------------------------------------

/** Logs laid one on another, 16 by 32: each four texels high, rounded (lit on top, dark beneath), grain and knots. */
function logWall(r: Ramp): Pixmap {
  const p = new Pixmap(16, 32);
  for (let y = 0; y < 32; y++) {
    const row = Math.floor(y / 4);
    for (let x = 0; x < 16; x++) {
      const j = y % 4;
      const n = valueNoise(x, y * 4 + row * 13, 6, 32, 70);
      let c = j === 0 ? r[5]! : j === 1 ? (n < 0.4 ? r[3]! : r[4]!) : j === 2 ? (n < 0.5 ? r[2]! : r[3]!) : r[0]!;
      if (j === 1 && hash2(x, row, 71) < 0.08) c = r[2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** The ends of logs at a corner, 16 by 32: rings stacked, four texels a log. */
function logEnds(r: Ramp): Pixmap {
  const p = new Pixmap(16, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const cx = (x % 4) - 1.5;
      const cy = (y % 4) - 1.5;
      const d = Math.hypot(cx, cy);
      p.set(x, y, d > 1.9 ? r[0]! : d > 1.3 ? r[2]! : d > 0.6 ? r[5]! : r[4]!);
    }
  }
  return p;
}

/** Sod: turf gone wintry, tufts and dead straw in it, 32 by 32. */
function sod(r: Ramp): Pixmap {
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = fbm(x, y, 8, 32, 80);
      let c = n < 0.35 ? r[2]! : n < 0.62 ? r[3]! : r[4]!;
      if (hash2(x, y, 81) < 0.08) c = r[1]!;
      if (hash2(x, y, 82) < 0.05) c = C.STRAW[2]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(83);
  for (let k = 0; k < 30; k++) {
    const x = Math.floor(random() * 32);
    const y = Math.floor(random() * 32);
    p.set(x, y, r[5]!);
    p.set(x - 1, y + 1, r[4]!);
    p.set(x + 1, y + 1, r[4]!);
  }
  return p;
}

/** Thatch: straw in long strokes down the slope, 32 by 32. */
function thatch(r: Ramp): Pixmap {
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = valueNoise(x * 4, y, 6, 32, 90);
      let c = n < 0.3 ? r[2]! : n < 0.65 ? r[3]! : r[4]!;
      if (y % 8 === 7) c = r[1]!;
      if (hash2(x, y, 91) < 0.06) c = r[5]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A round shield, 16 by 16, cut out: quartered red and bone, an iron rim and boss. */
function shieldPicture(field: Ramp, seed: number): Pixmap {
  const p = new Pixmap(16, 16);
  p.fill(0, 0);
  const pattern = seed % 3;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const d = Math.hypot(dx, dy);
      if (d > 7.6) continue;
      let c: number;
      if (d > 6.6) c = dx + dy < 0 ? C.IRON[4]! : C.IRON[2]!;
      else if (d < 1.8) c = d < 1 ? C.IRON[5]! : C.IRON[3]!;
      else {
        const quarter = pattern === 0 ? (dx < 0) !== (dy < 0) : pattern === 1 ? Math.abs(dx) < 2 || Math.abs(dy) < 2 : Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 2 === 0;
        c = quarter ? field[3]! : C.BONE[4]!;
        if (hash2(x, y, seed) < 0.06) c = quarter ? field[2]! : C.BONE[3]!;
      }
      p.set(x, y, c);
    }
  }
  return p;
}

const mats = (pal: Palette, building: BuildingData) => {
  const timber = pal.timber ?? R.LOG;
  const stone = pal.stone ?? R.KELD_STONE;
  const roof = pal.roof ?? R.SOD;
  const roofKind = paramsOf(building).str<"sod" | "thatch">("roof", "sod");
  const red = pal.cloth ?? R.KELD_RED;
  return {
    logs: material(`log-wall@${rampKey(timber)}`, () => logWall(timber)),
    ends: material(`log-ends@${rampKey(timber)}`, () => logEnds(timber)),
    plank: material(`keld-planks@${rampKey(timber)}`, () => T.timber(10, timber)),
    stone: material(`keld-stone@${rampKey(stone)}`, () => T.ashlar(stone, 77, 6, 6, 11)),
    roof: roofKind === "thatch" ? material(`thatch@${rampKey(pal.roof ? roof : R.THATCH)}`, () => thatch(pal.roof ? roof : R.THATCH)) : material(`sod@${rampKey(roof)}`, () => sod(roof)),
    door: doorMaterial(timber, timber, "square", true),
    window: windowMaterial(timber, "lit", "square"),
    red,
    banner: bannerMaterial(red, C.IRON),
    shields: [0, 1, 2].map((k) => material(`keld-shield-${k}@${rampKey(red)}`, () => shieldPicture(red, k), { cutout: true })),
    snow: paramsOf(building).bool("snow", true),
    embers: glowing(C.FIRE[2]!),
    basalt: rock(R.BASALT, R.LICHEN),
  };
};
type Mats = ReturnType<typeof mats>;
type Draw = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined;

// --- Pieces ---------------------------------------------------------------------------------------------------------------

/** A round shield hung on a wall facing south at z (or a side wall, turned), its middle at (x, y). */
function shield(b: MeshBuilder, x: number, y: number, z: number, m: Mats, k: number, turn = 0): void {
  b.at(x, 0, z, turn, () => disc(b, [0, y, 0.03], [0, 0, 1], 0.42, fitted(m.shields[k % 3]!), 12));
}

/** A dragon's head carved at a beam's end: a snout, a jaw, a red eye. */
function dragonHead(b: MeshBuilder, x: number, y: number, z: number, dir: 1 | -1, m: Mats): void {
  limb(b, [x, y, z], [x, y + 0.18, z + dir * 0.38], 0.09, 0.05, m.plank, 5);
  limb(b, [x, y - 0.05, z + dir * 0.05], [x, y - 0.02, z + dir * 0.32], 0.05, 0.03, m.plank, 4);
  b.box(x - 0.1, y + 0.08, z + dir * 0.1 - 0.03, x + 0.1, y + 0.13, z + dir * 0.1 + 0.03, sides(fitted(glowing(C.RED[4]!))));
}

/**
 * A longhouse's roof: steep, of sod or thatch, its gables of planks; snow lying on its upper slopes; the gable beams
 * crossed over the ridge at both ends, carved into dragons' heads; a smoke-hole's hood on the ridge.
 */
function longRoof(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, m: Mats): void {
  const o = 0.4;
  const zm = (z0 + z1) / 2;
  const run = (z1 - z0) / 2 + o;
  b.gableRoof(x0 - o, z0 - o, x1 + o, z1 + o, y, rise, m.roof, tiled(m.plank), 0.15);
  if (m.snow) {
    const k = 0.38;
    b.gableRoof(x0 - o + 0.06, z0 - o + run * k, x1 + o - 0.06, z1 + o - run * k, y + rise * k + 0.05, rise * (1 - k) + 0.02, snowCover(), tiled(snowCover()), 0);
  }
  const top = y + rise;
  for (const x of [x0 - o - 0.05, x1 + o + 0.05]) {
    limb(b, [x, y - 0.1, z0 - o], [x, top + 0.55, zm + 0.45], 0.08, 0.07, m.plank, 5);
    limb(b, [x, y - 0.1, z1 + o], [x, top + 0.55, zm - 0.45], 0.08, 0.07, m.plank, 5);
    dragonHead(b, x, top + 0.55, zm + 0.45, 1, m);
    dragonHead(b, x, top + 0.55, zm - 0.45, -1, m);
  }
  const hx = (x0 + x1) / 2;
  b.box(hx - 0.35, top - 0.15, zm - 0.3, hx + 0.35, top + 0.3, zm + 0.3, sides(tiled(m.plank)));
  hipRoof(b, hx - 0.45, zm - 0.4, hx + 0.45, zm + 0.4, top + 0.3, 0.3, m.snow ? snowCover() : m.roof);
}

interface LongOpts {
  readonly wall?: number;
  readonly rise?: number;
  readonly door?: number;
  readonly shields?: boolean;
  readonly windows?: boolean;
}

/** A longhouse on x0..x1, z0..z1: a basalt footing, log walls with their ends at the corners, a door, windows, shields. */
function longhouse(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, m: Mats, o: LongOpts = {}): { readonly door: number; readonly top: number } {
  const wall = o.wall ?? 2.0;
  const top = 0.5 + wall;
  const door = o.door ?? Math.round(x1 - x0) / 2;
  b.box(x0 - 0.1, 0, z0 - 0.1, x1 + 0.1, 0.5, z1 + 0.1, sides(tiled(m.stone)));
  b.box(x0, 0.5, z0, x1, top, z1, sides(tiled(m.logs)));
  // The logs' ends crossing at each corner.
  for (const [x, z] of [
    [x0, z1],
    [x1, z1],
    [x0, z0],
    [x1, z0],
  ] as const)
    b.box(x - 0.14, 0.5, z - 0.14, x + 0.14, top + 0.08, z + 0.14, sides(tiled(m.ends)));
  longRoof(b, x0, z0, x1, z1, top, Math.max(2.2, (z1 - z0) * 0.75), m);
  // The door between carved posts, a red cloth over its lintel.
  const dx = x0 + door;
  b.card(fitted(m.door), dx - 0.625, 0.5, dx + 0.625, 2.5, z1 + 0.01);
  for (const s of [-1, 1]) b.box(dx + s * 0.72 - 0.09, 0.5, z1, dx + s * 0.72 + 0.09, 2.7, z1 + 0.14, sides(tiled(m.plank)));
  b.box(dx - 0.85, 2.5, z1, dx + 0.85, 2.7, z1 + 0.16, sides(tiled(m.plank)));
  b.card(fitted(cloth(m.red)), dx - 0.6, 2.2, dx + 0.6, 2.5, z1 + 0.15);
  b.box(dx - 0.75, 0.38, z1, dx + 0.75, 0.5, z1 + 0.35, sides(tiled(m.stone)));
  if (o.windows !== false) {
    for (const x of windowSpots(x1 - x0, door, 2.2, 1.0)) b.card(fitted(m.window), x0 + x - 0.4, 1.2, x0 + x + 0.4, 2.1, z1 + 0.01);
    for (const z of windowSpots(z1 - z0, undefined, 2.0, 1.0)) {
      b.at(x1 + 0.01, 0, z0 + z, Math.PI / 2, () => b.card(fitted(m.window), -0.4, 1.2, 0.4, 2.1, 0));
      b.at(x0 - 0.01, 0, z0 + z, -Math.PI / 2, () => b.card(fitted(m.window), -0.4, 1.2, 0.4, 2.1, 0));
    }
  }
  if (o.shields !== false) {
    const spots = windowSpots(x1 - x0, door, 2.2, 1.0);
    spots.forEach((x, i) => {
      const sx = x0 + x + (i < spots.length / 2 ? -1.1 : 1.1);
      if (sx > x0 + 0.5 && sx < x1 - 0.5 && Math.abs(sx - dx) > 1.2) shield(b, sx, 1.65, z1 + 0.01, m, i);
    });
    for (const z of windowSpots(z1 - z0, undefined, 2.0, 1.0)) {
      shield(b, x1 + 0.02, 1.65, z0 + z + 1.0 > z1 - 0.5 ? z0 + z - 0.9 : z0 + z + 0.95, m, 1, Math.PI / 2);
      shield(b, x0 - 0.02, 1.65, z0 + z + 1.0 > z1 - 0.5 ? z0 + z - 0.9 : z0 + z + 0.95, m, 2, -Math.PI / 2);
    }
  }
  return { door, top };
}

/** A fire bowl: an iron bowl of embers on three legs, its middle at x, z (the flames are the recipe's frames). */
function fireBowl(b: MeshBuilder, x: number, z: number, m: Mats): void {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    limb(b, [x + Math.sin(a) * 0.32, 0, z + Math.cos(a) * 0.32], [x, 0.7, z], 0.035, 0.03, material("keld-iron", () => new Pixmap(4, 4, C.IRON[2]!)), 4);
  }
  b.cylinder(x, z, 0.7, 0.95, 0.3, 8, { mat: material("keld-iron-bowl", () => new Pixmap(4, 4, C.IRON[3]!)) }, fitted(m.embers), -0.25);
}

const BOWL = 0.95;

/** A red banner on a pole standing at x, z. */
function bannerPole(b: MeshBuilder, x: number, z: number, h: number, m: Mats): void {
  limb(b, [x, 0, z], [x, h, z], 0.05, 0.04, m.plank, 5);
  b.box(x - 0.42, h - 0.12, z - 0.03, x + 0.42, h - 0.06, z + 0.03, sides(iron()));
  b.card(fitted(m.banner), x - 0.375, h - 2.1, x + 0.375, h - 0.1, z + 0.04);
}

/** A square log tower: walls of logs on a stone foot, a gallery and a steep cap; for gates and walls. */
function logTower(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, h: number, m: Mats): void {
  b.box(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, 0.6, z1 + 0.05, sides(tiled(m.stone)));
  b.box(x0, 0.6, z0, x1, h, z1, sides(tiled(m.logs)));
  for (const [x, z] of [
    [x0, z1],
    [x1, z1],
    [x0, z0],
    [x1, z0],
  ] as const)
    b.box(x - 0.12, 0.6, z - 0.12, x + 0.12, h, z + 0.12, sides(tiled(m.ends)));
  // The gallery, overhanging, its walls of planks with slits.
  b.box(x0 - 0.3, h, z0 - 0.3, x1 + 0.3, h + 1.0, z1 + 0.3, sides(tiled(m.plank)));
  for (const x of windowSpots(x1 - x0, undefined, 0.8, 0.4)) b.card(fitted(material("keld-slit", () => slitPicture())), x0 + x - 0.08, h + 0.35, x0 + x + 0.08, h + 0.8, z1 + 0.31);
  hipRoof(b, x0 - 0.45, z0 - 0.45, x1 + 0.45, z1 + 0.45, h + 1.0, 1.4, m.roof);
  if (m.snow) hipRoof(b, x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, h + 1.0 + 1.4 * 0.45, 1.4 * 0.55 + 0.03, snowCover());
}

function slitPicture(): Pixmap {
  const p = new Pixmap(3, 8, C.INK);
  p.vline(0, 0, 8, R.LOG[2]!);
  return p;
}

// --- Kinds ---------------------------------------------------------------------------------------------------------------

const keldSign = (trade: Trade, m: Mats) => signMaterial(trade, R.LOG, m.red, "shield");

function house(building: BuildingData, m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const { door } = longhouse(b, x0, z0, x1, z1 - 0.4, m, { door: paramsOf(building).num("doorAt", Math.round(x1 - x0) / 2) });
    const xs = x1 - 0.7;
    b.box(xs - 0.4, 0, z1 - 0.35, xs + 0.4, 0.45, z1 - 0.05, sides(tiled(m.plank)));
    return [x0 + door, 1, z1 - 0.4];
  };
}

function shop(building: BuildingData, m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const zf = z1 - 1.5;
    const { door } = longhouse(b, x0, z0, x1, zf, m, { door: paramsOf(building).num("doorAt", Math.round(x1 - x0) / 2) });
    // A lean-to of hides on log posts along the front, furs and goods on a trestle under it.
    const hide = cloth(HIDE);
    for (const x of [x0 + 0.15, x1 - 0.15]) limb(b, [x, 0, z1 - 0.15], [x, 2.0, z1 - 0.15], 0.07, 0.06, m.plank, 5);
    shedRoof(b, x0 - 0.1, zf, x1 + 0.1, z1 + 0.1, 1.95, 2.45, hide);
    const tx = x0 + 0.6;
    const tw = Math.max(1.0, door - 1.4);
    b.box(tx, 0.7, z1 - 1.0, tx + tw, 0.82, z1 - 0.5, sides(tiled(m.plank)));
    for (const x of [tx + 0.1, tx + tw - 0.1]) b.box(x - 0.05, 0, z1 - 0.95, x + 0.05, 0.7, z1 - 0.55, sides(tiled(m.plank)));
    b.blob(tx + tw * 0.3, 0.92, z1 - 0.75, 0.32, 0.12, 0.22, material("fur", () => furPicture()));
    b.blob(tx + tw * 0.7, 0.9, z1 - 0.75, 0.28, 0.1, 0.2, material("fur-white", () => furPicture(true)));
    crate(b, x1 - 0.7, z1 - 0.8, 0.6);
    barrel(b, x1 - 1.4, z1 - 0.8, 0.75);
    hangingSign(b, x0 + door + 1.1, 2.6, zf, keldSign(trade, m), tiled(m.plank));
    return [x0 + door, 1, zf];
  };
}

/** Tanned hide: a lean-to's cover. */
const HIDE: Ramp = [0x3a2418, 0x5a3a24, 0x7c5434, 0x9c7048, 0xbc8e60, 0xd8b080];

function furPicture(white = false): Pixmap {
  const r = white ? C.CLOTH_WHITE : [0x2a1a14, 0x4a2e1e, 0x6a462c, 0x8a603a, 0xa87c4c];
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, r[1 + Math.floor(valueNoise(x * 2, y, 4, 16, white ? 3 : 4) * 3)]!);
  return p;
}

/** A mead hall: a big longhouse, fire bowls burning either side of its door, red banners, its sign of a tankard. */
function inn(building: BuildingData, m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const zf = z1 - 1.2;
    const { door } = longhouse(b, x0, z0, x1, zf, m, { wall: 2.4 });
    const dx = x0 + door;
    fireBowl(b, dx - 1.5, z1 - 0.55, m);
    fireBowl(b, dx + 1.5, z1 - 0.55, m);
    bannerPole(b, x0 + 0.5, z1 - 0.5, 3.4, m);
    bannerPole(b, x1 - 0.5, z1 - 0.5, 3.4, m);
    hangingSign(b, dx + 1.15, 2.9, zf, keldSign(trade, m), tiled(m.plank));
    barrel(b, x1 - 1.3, zf + 0.45, 0.8);
    return [dx, 1, zf];
  };
}

const innFires = (x0: number, z0: number, x1: number, z1: number): XYZ[] => {
  const dx = x0 + Math.round(x1 - x0) / 2;
  return [
    [dx - 1.5, BOWL - 0.05, z1 - 0.55],
    [dx + 1.5, BOWL - 0.05, z1 - 0.55],
  ];
};

/** The fire hall: a tall longhouse, its roof steeper, before it a ring of standing stones about a great fire bowl. */
function temple(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const zf = z1 - 3.0;
    const { door } = longhouse(b, x0, z0, x1, zf, m, { wall: 2.8, shields: true });
    const dx = x0 + door;
    const cz = z1 - 1.5;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const sx = dx + Math.sin(a) * 1.3;
      const sz = cz + Math.cos(a) * 1.0;
      if (Math.abs(sx - dx) < 0.5 && sz < cz) continue;
      lump(b, sx, sz, 0, [[0.2, 0], [0.22, 0.5], [0.15, 1.05], [0.06, 1.2]], 5, m.basalt, i + 3, 0.15, { squash: 0.7 });
    }
    fireBowl(b, dx, cz, m);
    bannerPole(b, x0 + 0.5, zf + 0.5, 3.8, m);
    bannerPole(b, x1 - 0.5, zf + 0.5, 3.8, m);
    plaque(b, dx, 2.75, zf + 0.17, signMaterial("temple", R.LOG, m.red, "round"));
    return [dx, 1, zf];
  };
}

const templeFires = (x0: number, _z0: number, x1: number, z1: number): XYZ[] => [[x0 + Math.round(x1 - x0) / 2, BOWL - 0.05, z1 - 1.5]];

/** A great hall: a broad longhouse with a porch on carved posts along its front, shields all along it. */
function guildhall(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const zf = z1 - 1.4;
    const { door, top } = longhouse(b, x0, z0, x1, zf, m, { wall: 2.4 });
    const posts = windowSpots(x1 - x0, undefined, 2.0, 0.3);
    for (const x of posts) {
      limb(b, [x0 + x, 0, z1 - 0.2], [x0 + x, top - 0.2, z1 - 0.2], 0.1, 0.09, m.plank, 6);
      b.cylinder(x0 + x, z1 - 0.2, 1.4, 1.6, 0.13, 6, { mat: material("keld-red-band", () => new Pixmap(4, 4, m.red[3]!)) });
    }
    b.box(x0 - 0.2, top - 0.3, z1 - 0.35, x1 + 0.2, top - 0.1, z1 - 0.05, sides(tiled(m.plank)));
    shedRoof(b, x0 - 0.3, zf, x1 + 0.3, z1 + 0.1, top - 0.15, top + 0.5, m.roof);
    if (m.snow) shedRoof(b, x0 - 0.2, zf, x1 + 0.2, z1 - 0.5, top + 0.15, top + 0.52, snowCover());
    plaque(b, x0 + door, 2.75, zf + 0.17, keldSign(trade, m));
    return [x0 + door, 1, zf];
  };
}

/** A smithy: a stone forge-house, its forge open under a lean-to on log posts, an anvil and a quench trough. */
function smithy(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const back = z1 - 2.0;
    const stone = tiled(m.stone);
    b.box(x0, 0, z0, x1, 2.6, back, sides(stone));
    longRoof(b, x0, z0, x1, back, 2.6, 2.0, m);
    for (const x of [x0 + 0.15, x1 - 0.15]) limb(b, [x, 0, z1 - 0.2], [x, 2.15, z1 - 0.2], 0.09, 0.08, m.plank, 5);
    shedRoof(b, x0 - 0.2, back, x1 + 0.2, z1 + 0.15, 2.1, 2.65, m.roof);
    const fx = x0 + 1.1;
    b.box(fx - 0.65, 0, back, fx + 0.65, 0.85, back + 0.9, sides(stone));
    b.box(fx - 0.5, 0.85, back + 0.08, fx + 0.5, 0.9, back + 0.8, sides(fitted(m.embers)));
    b.box(fx - 0.3, 0.9, z0 + 0.7, fx + 0.3, 5.4, back + 0.35, sides(stone));
    const ax = (x0 + x1) / 2 + 0.5;
    b.cylinder(ax, z1 - 1.0, 0, 0.5, 0.22, 7, { mat: m.ends });
    b.box(ax - 0.3, 0.5, z1 - 1.12, ax + 0.25, 0.66, z1 - 0.88, sides(iron(), ironLight()));
    b.box(x1 - 1.3, 0, z1 - 1.3, x1 - 0.4, 0.45, z1 - 0.7, sides(tiled(m.plank), fitted(glowing(0x2a4a7a))));
    b.card(fitted(m.door), x1 - 1.0 - 0.625, 0.25, x1 - 1.0 + 0.625, 2.25, back + 0.01);
    hangingSign(b, x0 + 0.25, 2.0, z1 - 0.2, keldSign(trade, m), tiled(m.plank));
    return [x1 - 1.0, 1, back];
  };
}

const smithyFires = (x0: number, _z0: number, _x1: number, z1: number): XYZ[] => [[x0 + 1.1, 0.9, z1 - 2.0 + 0.5]];

/** A skald's hall: walls of basalt, a log gable, rune stones either side of its door. */
function library(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const zf = z1 - 1.0;
    const xm = (x0 + x1) / 2;
    b.box(x0 - 0.1, 0, z0 - 0.1, x1 + 0.1, 0.4, zf + 0.1, sides(tiled(m.stone)));
    b.box(x0, 0.4, z0, x1, 3.0, zf, sides(tiled(m.stone)));
    longRoof(b, x0, z0, x1, zf, 3.0, Math.max(2.2, (zf - z0) * 0.75), m);
    b.card(fitted(m.door), xm - 0.625, 0.4, xm + 0.625, 2.4, zf + 0.01);
    for (const x of windowSpots(x1 - x0, xm - x0, 1.8, 1.0)) b.card(fitted(windowMaterial(R.KELD_STONE, "lit", "arch")), x0 + x - 0.5, 1.0, x0 + x + 0.5, 2.125, zf + 0.01);
    for (const z of windowSpots(zf - z0, undefined, 1.8, 1.0)) {
      b.at(x1 + 0.01, 0, z0 + z, Math.PI / 2, () => b.card(fitted(windowMaterial(R.KELD_STONE, "lit", "arch")), -0.5, 1.0, 0.5, 2.125, 0));
      b.at(x0 - 0.01, 0, z0 + z, -Math.PI / 2, () => b.card(fitted(windowMaterial(R.KELD_STONE, "lit", "arch")), -0.5, 1.0, 0.5, 2.125, 0));
    }
    const rune = material("rune-glow", () => runePicture(), { cutout: true, glow: 0.9 });
    for (const s of [-1, 1]) {
      const rx = xm + s * 1.3;
      lump(b, rx, z1 - 0.45, 0, [[0.28, 0], [0.3, 0.6], [0.24, 1.4], [0.1, 1.6]], 6, m.basalt, s + 7, 0.1, { squash: 0.6 });
      b.card(fitted(rune), rx - 0.12, 0.6, rx + 0.12, 1.2, z1 - 0.45 + 0.2);
    }
    plaque(b, xm, 2.45, zf + 0.01, keldSign(trade, m));
    return [xm, 1, zf];
  };
}

function runePicture(): Pixmap {
  const p = new Pixmap(4, 10);
  p.fill(0, 0);
  for (const [x, y] of [[1, 0], [1, 1], [1, 2], [2, 2], [1, 3], [1, 4], [2, 5], [1, 6], [0, 6], [1, 7], [1, 8], [2, 9]] as const) p.set(x, y, 0xffa040);
  return p;
}

/** A watchtower: squat, of basalt, a little tapered, a log gallery and a steep cap of sod, a red banner. */
function tower(m: Mats, trade: Trade, floors: number): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 1.2 + floors * 1.5;
    const xm = (x0 + x1) / 2;
    const stone = tiled(m.stone);
    b.box(x0, 0, z0, x1, h * 0.4, z1, sides(stone));
    b.box(x0 + 0.12, h * 0.4, z0 + 0.12, x1 - 0.12, h, z1 - 0.12, sides(stone));
    b.box(x0 - 0.2, h, z0 - 0.2, x1 + 0.2, h + 1.1, z1 + 0.2, sides(tiled(m.plank)));
    for (const x of windowSpots(x1 - x0, undefined, 0.8, 0.4)) b.card(fitted(material("keld-slit", () => slitPicture())), x0 + x - 0.08, h + 0.35, x0 + x + 0.08, h + 0.85, z1 + 0.21);
    hipRoof(b, x0 - 0.4, z0 - 0.4, x1 + 0.4, z1 + 0.4, h + 1.1, 1.8, m.roof);
    if (m.snow) hipRoof(b, x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, h + 1.1 + 1.8 * 0.45, 1.8 * 0.55 + 0.03, snowCover());
    b.card(fitted(m.window), xm - 0.4, h - 1.3, xm + 0.4, h - 0.4, z1 - 0.11);
    b.card(fitted(m.door), xm - 0.625, 0, xm + 0.625, 2.0, z1 + 0.01);
    plaque(b, xm, 2.15, z1 + 0.01, keldSign(trade, m));
    b.box(xm - 0.42, h - 0.25, z1 - 0.12, xm + 0.42, h - 0.19, z1 + 0.0, sides(iron()));
    b.card(fitted(m.banner), xm + 0.6, h - 2.3, xm + 1.35, h - 0.3, z1 - 0.11);
    return [xm, 1, z1];
  };
}

/** A storehouse on stone piers: its floor raised off the snow, steps to its door, the loft overhanging, sod on top. */
function warehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const zf = z1 - 1.1;
    const lift = 0.8;
    const xm = (x0 + x1) / 2;
    for (const x of windowSpots(x1 - x0, undefined, 1.6, 0.4)) for (const z of [z0 + 0.4, zf - 0.4]) lump(b, x0 + x, z, 0, [[0.28, 0], [0.24, lift * 0.6], [0.2, lift]], 6, m.basalt, Math.round(x * 3 + z), 0.12);
    b.box(x0, lift, z0, x1, lift + 0.15, zf, sides(tiled(m.plank)));
    b.box(x0 + 0.1, lift + 0.15, z0 + 0.1, x1 - 0.1, lift + 2.0, zf - 0.1, sides(tiled(m.logs)));
    b.box(x0 - 0.25, lift + 2.0, z0 - 0.25, x1 + 0.25, lift + 3.0, zf + 0.25, sides(tiled(m.plank)));
    longRoof(b, x0 - 0.25, z0 - 0.25, x1 + 0.25, zf + 0.25, lift + 3.0, 1.9, m);
    b.card(fitted(m.door), xm - 0.625, lift + 0.15, xm + 0.625, lift + 2.0, zf - 0.09);
    for (let i = 0; i < 3; i++) b.box(xm - 0.5, (i * lift) / 3, zf + 0.75 - i * 0.28, xm + 0.5, ((i + 1) * lift) / 3, zf + 1.03 - i * 0.28, sides(tiled(m.stone)));
    crate(b, x0 + 0.6, z1 - 0.45, 0.6);
    barrel(b, x1 - 0.6, z1 - 0.45, 0.75);
    return [xm, 1, zf];
  };
}

/** A log palisade along a line: logs on end, sharpened, bound by a rail, from (x0, z) to (x1, z) or north-south. */
function palisade(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, h: number, m: Mats, seed: number, y0 = 0): void {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(length / 0.32));
  const random = seeded(seed);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const top = h + (random() - 0.5) * 0.3;
    b.cylinder(x, z, y0, top, 0.16, 6, { mat: m.plank });
    limb(b, [x, top, z], [x, top + 0.38, z], 0.16, 0.01, m.plank, 6);
  }
  const nx = (z1 - z0) / length;
  const nz = -(x1 - x0) / length;
  for (const y of y0 > 0 ? [y0 + 0.3] : [0.7, h - 0.5]) limb(b, [x0 - nx * 0.18, y, z0 - nz * 0.18], [x1 - nx * 0.18, y, z1 - nz * 0.18], 0.06, 0.06, m.ends, 5);
}

/** A log gate: two log towers either side of the passage, a beam over it carrying a palisade walk, red banners. */
function gatehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const g0 = xm - 1;
    const g1 = xm + 1;
    const h = 3.6;
    logTower(b, x0, z0, g0, z1, h, m);
    logTower(b, g1, z0, x1, z1, h, m);
    b.box(g0, 2.7, z0 + 0.2, g1, 3.0, z1 - 0.2, sides(tiled(m.logs)));
    // A palisade along the beam's front: the walk between the towers.
    palisade(b, g0, z1 - 0.35, g1, z1 - 0.35, 3.7, m, 9, 3.0);
    shield(b, (x0 + g0) / 2, 2.2, z1 + 0.01, m, 0);
    shield(b, (g1 + x1) / 2, 2.2, z1 + 0.01, m, 1);
    return [xm, 1, z1];
  };
}

function keldon(building: BuildingData, pal: Palette): Built {
  const kind = building.kind ?? "house";
  const P = paramsOf(building);
  const m = mats(pal, building);
  const trade = tradeOf(building);
  const cap = m.stone;
  const go = (height: number, draw: Draw, through = false) => styled(building, { cap, height, through }, draw);
  const lit = (built: Built, spots: (x0: number, z0: number, x1: number, z1: number) => XYZ[]): Built => ({ ...built, frames: [...(built.frames ?? []), fireFrames(building, spots)] });
  const ridge = (d: number) => 0.5 + 2.0 + Math.max(2.2, d * 0.75) + 0.6;
  switch (kind) {
    case "shop":
      return go(ridge(building.d - 1.5), shop(building, m, trade ?? "general"));
    case "inn":
      return lit(go(ridge(building.d - 1.2) + 0.4, inn(building, m, trade ?? "drink")), innFires);
    case "temple":
      return lit(go(ridge(building.d - 3) + 0.8, temple(m)), templeFires);
    case "guildhall":
      return go(ridge(building.d - 1.4) + 0.4, guildhall(m, trade ?? "guild"));
    case "smithy":
      return lit(go(5.4, smithy(m, trade ?? "smith")), smithyFires);
    case "library":
      return go(ridge(building.d - 1) + 0.5, library(m, trade ?? "books"));
    case "tower": {
      const floors = P.num("floors", 2);
      return go(1.2 + floors * 1.5 + 2.9, tower(m, trade ?? "magic", floors));
    }
    case "warehouse":
      return go(0.8 + 3.0 + 1.9 + 0.6, warehouse(m));
    case "gatehouse":
      return go(6.1, gatehouse(m), true);
    case "wall":
      return go(3.4, (b, x0, z0, x1, z1) => {
        if (x1 - x0 >= z1 - z0) palisade(b, x0, (z0 + z1) / 2, x1, (z0 + z1) / 2, 2.8, m, Math.round(Math.abs(x0)));
        else palisade(b, (x0 + x1) / 2, z0, (x0 + x1) / 2, z1, 2.8, m, Math.round(Math.abs(z0)));
        return undefined;
      });
    case "wall-tower":
      return go(6.1, (b, x0, z0, x1, z1) => {
        logTower(b, x0, z0, x1, z1, 3.6, m);
        shield(b, (x0 + x1) / 2, 2.2, z1 + 0.01, m, 2);
        return undefined;
      });
    default:
      return go(ridge(building.d - 0.4), house(building, m));
  }
}

BUILDINGS.define(
  "keldon",
  "Keld's style - longhouses of pine logs on basalt footings, steep sod roofs under snow, crossed gable beams carved into dragons, red cloth, round shields, fire bowls. Kinds: house, shop (a hide lean-to of furs), inn (a mead hall, fires at its door), temple (a fire hall, standing stones about a fire), guildhall (a porch on carved posts), smithy, library (a skald's hall of stone, rune stones), tower (a squat watchtower; floors), warehouse (a storehouse on stone piers), gatehouse (its passage the middle 2 tiles), wall (a log palisade along its longer side), wall-tower; params: trade, doorAt, roof sod|thatch, snow (true), floors. Palette: timber, stone, roof, cloth",
  keldon,
  KELDON,
);

showcase("keldon", [
  { kind: "house", w: 7, d: 4, label: "longhouse" },
  { kind: "house", w: 5, d: 4, label: "small, thatch", params: { roof: "thatch", snow: false } },
  { kind: "shop", w: 7, d: 5, params: { trade: "armor" } },
  { kind: "inn", w: 9, d: 6 },
  { kind: "temple", w: 7, d: 8 },
  { kind: "guildhall", w: 10, d: 6 },
  { kind: "smithy", w: 6, d: 5 },
  { kind: "library", w: 7, d: 5 },
  { kind: "tower", w: 3, d: 3, params: { floors: 2 } },
  { kind: "warehouse", w: 5, d: 5 },
  { kind: "gatehouse", w: 6, d: 3 },
  { kind: "wall-tower", w: 2, d: 2 },
  { kind: "wall", w: 6, d: 1 },
]);

