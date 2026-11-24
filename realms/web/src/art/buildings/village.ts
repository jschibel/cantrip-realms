import type { BuildingData, XYZ } from "../../world/format";
import { type Face, type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, painted, stock } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import { Pixmap, hash2 } from "../paint/pixmap";
import { valueNoise } from "../paint/procedural";
import * as R from "../paint/ramps";
import * as T from "../paint/textures";
import { barrel, crate, pics, sack } from "../props/draw";
import { bannerMaterial, limb } from "../props/kit";
import type { Built } from "../recipe";
import { coneRoof, door, doorMaterial, hangingSign, params as paramsOf, plaque, signMaterial, styled, type Trade, tradeOf, windowSpots } from "./kit";
import { BUILDINGS, showcase } from "./registry";
import { ridgeNS, slope } from "./tolarian";

// A village's style, for hamlets in any region: cottages of wattle and daub in ochre between dark timber framing, on
// footings of fieldstone, under thick thatch rounded at its ridge and eaves; small shuttered windows with flower boxes,
// fieldstone chimneys. Its civic buildings are humble: a chapel with a bell-cote, a moot hall standing on posts, a hedge
// wizard's crooked tower, a fieldstone wall, a timber gate.
//
// Palette slots: plaster (daub), roof (thatch), timber (frames), darkTimber (doors), stone (footings, chimneys), cloth
// (shutters, banners). Params: floors (house, inn), trade (a sign's emblem), doorAt.

const VILLAGE: Palette = { plaster: R.DAUB, roof: R.THATCH, timber: C.DARKWOOD, darkTimber: C.WOOD, stone: C.COBBLE, cloth: C.RED, trim: C.GOLD };

type Draw = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined;

// --- Materials ---------------------------------------------------------------------------------------------------------

const daub = (r: Ramp): Material => painted("village-daub", r, R.DAUB, (ramp) => T.plaster(91, ramp));
const frame = (r: Ramp): Material => painted("village-frame", r, C.DARKWOOD, (ramp) => T.timber(92, ramp));

/** Thatch: bundles of straw laid in courses, each course's butt ends a darker line, the straw streaked along the slope. */
const thatch = (r: Ramp): Material =>
  painted(
    "village-thatch",
    r,
    R.THATCH,
    (ramp) => {
      const p = new Pixmap(32, 32);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const course = y % 8;
          const n = valueNoise(x * 3, y, 4, 32, 93);
          let c = n < 0.35 ? ramp[2]! : n < 0.7 ? ramp[3]! : ramp[Math.min(ramp.length - 1, 4)]!;
          if (course === 7) c = ramp[1]!;
          else if (course === 6) c = ramp[2]!;
          else if (course === 0 && hash2(x, y, 94) < 0.5) c = ramp[Math.min(ramp.length - 1, 5)]!;
          if (hash2(x, y, 95) < 0.04) c = ramp[2]!;
          p.set(x, y, c);
        }
      }
      return p;
    },
    { smooth: true },
  );

/** Fieldstone: rounded stones of a few greys set in earth-brown mortar. */
const fieldstone = (r: Ramp): Material => painted("village-fieldstone", r, C.COBBLE, () => T.cobbles(96));

/** Shutters painted the palette's cloth color. */
const shutterMat = (r: Ramp): Material =>
  material(`village-shutter@${rampKey(r)}`, () => {
    const p = new Pixmap(6, 14);
    for (let y = 0; y < 14; y++) for (let x = 0; x < 6; x++) p.set(x, y, y === 0 || y === 13 || y === 6 || y === 7 ? r[1]! : x % 2 ? r[2]! : r[3]!);
    return p;
  });

/** A small cottage window, 12 by 12, cut out: four little panes in a dark frame, a sill below. */
const smallWindow = (lit: boolean) =>
  material(`village-window${lit ? "-lit" : ""}`, () => {
    const p = new Pixmap(12, 12);
    const w = C.DARKWOOD;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        let c = lit ? (y < 6 ? C.GOLD[4]! : C.GOLD[3]!) : y < 5 ? C.WATER[3]! : C.WATER[2]!;
        if (x < 1 || x > 10 || y < 1 || y > 9 || x === 5 || x === 6 || y === 5) c = w[3]!;
        if (y > 9) c = w[4]!;
        p.set(x, y, c);
      }
    }
    if (!lit) {
      p.set(2, 3, C.WATER[5]!);
      p.set(3, 2, C.WATER[5]!);
    }
    return p;
  }, lit ? { glow: 0.5 } : {});

// --- Parts ---------------------------------------------------------------------------------------------------------------

interface Mats {
  readonly wall: Face;
  readonly frame: Face;
  readonly stone: Face;
  readonly thatch: Material;
  readonly pal: Palette;
}

const mats = (pal: Palette): Mats => ({ wall: tiled(daub(pal.plaster!)), frame: tiled(frame(pal.timber!)), stone: tiled(fieldstone(pal.stone!)), thatch: thatch(pal.roof!), pal });

/** Daub walls between a timber frame: posts at the corners and along the front, a sill beam and a wall plate, braces. */
function framed(b: MeshBuilder, m: Mats, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
  b.box(x0, y0, z0, x1, y1, z1, sides(m.wall));
  const t = 0.14;
  const o = 0.04;
  b.box(x0 - o, y0, z1 - 0.02, x1 + o, y0 + t, z1 + o, sides(m.frame));
  b.box(x0 - o, y1 - t, z1 - 0.02, x1 + o, y1, z1 + o, sides(m.frame));
  const posts = windowSpots(x1 - x0, undefined, 1.5, 0).map((x) => x0 + x);
  for (const x of [x0, ...posts.filter((x) => x - x0 > 0.4 && x1 - x > 0.4), x1 - t]) b.box(x, y0, z1 - 0.02, x + t, y1, z1 + o, sides(m.frame));
  for (const x of [x0 - o, x1 - t + o]) {
    b.box(x, y0, z0, x + t, y1, z1, sides(m.frame));
    b.box(x - (x < x0 ? 0 : 0), y1 - t, z0, x + t, y1, z1, sides(m.frame));
  }
  // Braces at the corners of the front: short diagonal timbers.
  for (const [xa, dir] of [
    [x0 + t, 1],
    [x1 - t, -1],
  ] as const) {
    limb(b, [xa, y0 + 0.2, z1 + 0.01], [xa + dir * 0.55, y1 - 0.2, z1 + 0.01], 0.05, 0.05, frame(m.pal.timber!), 4);
  }
}

/**
 * A thatched roof east-west over x0..x1, z0..z1 from y, `rise` high: the gable roof in thick straw, a rolled ridge along
 * its top and the eaves' thickness, so it reads rounded and heavy.
 */
function thatchRoof(b: MeshBuilder, m: Mats, x0: number, z0: number, x1: number, z1: number, y: number, rise: number): void {
  const o = 0.4;
  b.gableRoof(x0 - o, z0 - o, x1 + o, z1 + o, y, rise, m.thatch, m.wall, 0.15);
  // The thickness of the thatch at the eaves and the gable ends.
  for (const z of [z0 - o, z1 + o]) b.box(x0 - o, y - 0.35, Math.min(z, z + (z > z0 ? -0.25 : 0)), x1 + o, y - 0.12, Math.max(z, z + (z > z0 ? 0 : 0.25)), sides(tiled(m.thatch)));
  const zm = (z0 + z1) / 2;
  limb(b, [x0 - o - 0.05, y + rise - 0.02, zm], [x1 + o + 0.05, y + rise - 0.02, zm], 0.2, 0.2, m.thatch, 8, true);
  // The ridge's binding: a darker band of hazel spars.
  for (let x = x0 - o + 0.4; x < x1 + o - 0.3; x += 0.9) b.box(x - 0.03, y + rise + 0.08, zm - 0.2, x + 0.03, y + rise + 0.17, zm + 0.2, sides(flat(R.THATCH[2]!)));
}

/** A fieldstone chimney rising up the gable end at x, its stack above the ridge. */
function chimney(b: MeshBuilder, m: Mats, x: number, z: number, top: number): void {
  b.box(x - 0.35, 0, z - 0.4, x + 0.35, top, z + 0.4, sides(m.stone));
  b.box(x - 0.42, top, z - 0.47, x + 0.42, top + 0.12, z + 0.47, sides(m.stone));
  b.cylinder(x, z, top + 0.12, top + 0.4, 0.12, 6, { mat: flat(C.ROOF[2]!) }, { mat: flat(C.INK) });
}

/** A small window with its shutters open and a box of flowers under it. */
function cottageWindow(b: MeshBuilder, m: Mats, x: number, y: number, z: number, lit = false, flowers = true): void {
  b.card(fitted(smallWindow(lit)), x - 0.375, y, x + 0.375, y + 0.75, z + 0.01);
  const sh = fitted(shutterMat(m.pal.cloth!));
  b.card(sh, x - 0.375 - 0.3, y + 0.02, x - 0.375, y + 0.72, z + 0.02);
  b.card(sh, x + 0.375, y + 0.02, x + 0.375 + 0.3, y + 0.72, z + 0.02);
  if (flowers) {
    b.box(x - 0.45, y - 0.18, z, x + 0.45, y + 0.02, z + 0.25, sides(m.frame));
    b.blob(x, y + 0.08, z + 0.12, 0.42, 0.16, 0.14, pics.flowers());
  }
}

function sideCottageWindow(b: MeshBuilder, x: number, y: number, z: number, facing: 1 | -1, lit = false): void {
  b.at(x + facing * 0.01, 0, z, (facing * Math.PI) / 2, () => b.card(fitted(smallWindow(lit)), -0.375, y, 0.375, y + 0.75, 0));
}

const villageSign = (trade: Trade, pal: Palette) => signMaterial(trade, pal.darkTimber ?? C.WOOD, pal.timber ?? C.DARKWOOD, "board");
const villageDoor = (m: Mats, shape: "square" | "arch" | "round" = "square") => doorMaterial(m.pal.darkTimber ?? C.WOOD, m.pal.timber ?? C.DARKWOOD, shape);

// --- Kinds -----------------------------------------------------------------------------------------------------------------

/** A cottage, or a long house of two floors: framed daub on a fieldstone footing, thatch, a chimney, flower boxes. */
function cottage(m: Mats, building: BuildingData, floors: number, trade?: Trade, lit = false): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 0.4 + floors * 2.0;
    const doorAt = paramsOf(building).num("doorAt", Math.max(1.0, (x1 - x0) / 2 - (floors > 1 ? 0 : 0.5)));
    b.box(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, 0.4, z1 + 0.06, sides(m.stone));
    framed(b, m, x0, z0, x1, z1, 0.4, h);
    if (floors > 1) b.box(x0 - 0.06, 2.3, z1 - 0.02, x1 + 0.06, 2.42, z1 + 0.06, sides(m.frame));
    thatchRoof(b, m, x0, z0, x1, z1, h, Math.min(2.4, (z1 - z0) * 0.6 + 0.4));
    chimney(b, m, x1 - 0.1, (z0 + z1) / 2, h + Math.min(2.4, (z1 - z0) * 0.6 + 0.4) + 0.3);
    door(b, x0 + doorAt, 0.4, z1, villageDoor(m), m.stone);
    for (const x of windowSpots(x1 - x0, doorAt, 1.5)) {
      if (x1 - (x0 + x) < 0.7) continue;
      cottageWindow(b, m, x0 + x, 1.0, z1, lit);
    }
    for (let f = 1; f < floors; f++) for (const x of windowSpots(x1 - x0, undefined, 1.5)) cottageWindow(b, m, x0 + x, 0.9 + f * 2.0, z1, lit, false);
    for (const z of windowSpots(z1 - z0, undefined, 1.6, 0.9)) sideCottageWindow(b, x0, 1.0, z0 + z, -1, lit);
    if (trade) {
      hangingSign(b, x0 + Math.min(x1 - x0 - 0.8, doorAt + 1.05), 2.2, z1, villageSign(trade, m.pal), m.frame);
      // Its wares out on a trestle before it.
      b.box(x0 + 0.3, 0.65, z1 + 0.5, x0 + 1.5, 0.75, z1 + 1.0, sides(tiled(stock.boards())));
      for (const x of [x0 + 0.4, x0 + 1.35]) b.box(x, 0, z1 + 0.55, x + 0.08, 0.65, z1 + 0.95, sides(m.frame));
      crate(b, x0 + 0.65, z1 + 0.75, 0.4, "apples", 0.75);
      crate(b, x0 + 1.15, z1 + 0.75, 0.4, "cabbages", 0.75);
      sack(b, x1 - 0.5, z1 + 0.55);
    }
    return [x0 + doorAt, 1, z1];
  };
}

function inn(m: Mats, building: BuildingData, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const at = cottage(m, building, 2, undefined, true)(b, x0, z0, x1, z1)!;
    hangingSign(b, Math.max(x0 + 0.6, at[0] - 1.3), 2.2, z1, villageSign(trade, m.pal), m.frame);
    barrel(b, x0 + 0.5, z1 + 0.5);
    barrel(b, x0 + 1.15, z1 + 0.45, 0.7);
    // A bench by the door.
    b.box(at[0] + 0.9, 0.35, z1 + 0.25, at[0] + 2.1, 0.45, z1 + 0.6, sides(m.frame));
    for (const x of [at[0] + 1.0, at[0] + 1.95]) b.box(x, 0, z1 + 0.3, x + 0.08, 0.35, z1 + 0.55, sides(m.frame));
    return at;
  };
}

/** A chapel: a small daub nave under thatch, a bell-cote of timber over its gable, a round door. */
function chapel(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const h = 2.8;
    const rise = Math.min(2.6, (x1 - x0) * 0.5);
    b.box(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, 0.4, z1 + 0.06, sides(m.stone));
    b.box(x0, 0.4, z0, x1, h, z1, sides(m.stone));
    // Its roof runs north-south, its gable to the street.
    ridgeNS(b, x0 - 0.35, z0 - 0.35, x1 + 0.35, z1 + 0.35, h, rise, m.thatch, m.wall, 0.15);
    // The bell-cote: two posts and a little roof on the gable's peak, the bell hung between.
    const by = h + rise - 0.4;
    for (const dx of [-0.35, 0.35]) b.box(xm + dx - 0.06, by, z1 - 0.1, xm + dx + 0.06, by + 1.1, z1 + 0.05, sides(m.frame));
    ridgeNS(b, xm - 0.55, z1 - 0.35, xm + 0.55, z1 + 0.3, by + 1.1, 0.45, stock.roof(C.ROOF), m.frame);
    b.cylinder(xm, z1 - 0.02, by + 0.45, by + 0.85, 0.16, 8, { mat: flat(C.GOLD[2]!, { smooth: true }) }, undefined, -0.25);
    door(b, xm, 0.4, z1, villageDoor(m, "arch"), m.stone);
    b.card(fitted(material("village-chapel-window", () => {
      const p = new Pixmap(10, 10);
      p.fill(0, 0);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (Math.hypot(x - 4.5, y - 4.5) < 4.8) p.set(x, y, Math.hypot(x - 4.5, y - 4.5) > 3.6 ? C.COBBLE[5]! : (x + y) % 3 ? C.BLUE[3]! : C.GOLD[4]!);
      return p;
    }, { cutout: true })), xm - 0.3, h + 0.35, xm + 0.3, h + 0.95, z1 + 0.01);
    for (const z of windowSpots(z1 - z0, undefined, 1.6, 0.9)) {
      sideCottageWindow(b, x1, 1.0, z0 + z, 1);
      sideCottageWindow(b, x0, 1.0, z0 + z, -1);
    }
    return [xm, 1, z1];
  };
}

/** A moot hall: its upper floor of framed daub stands on timber posts over an open market floor. */
function mootHall(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const up = 2.2;
    const h = up + 2.2;
    b.box(x0, 0, z0, x1, 0.15, z1, sides(m.stone));
    for (const x of windowSpots(x1 - x0, undefined, 1.6, 0.15)) for (const z of [z0 + 0.15, z1 - 0.35]) b.box(x0 + x - 0.1, 0.15, z - 0.1, x0 + x + 0.1, up, z + 0.1, sides(m.frame));
    b.box(x0 - 0.1, up, z0 - 0.1, x1 + 0.1, up + 0.2, z1 + 0.1, sides(m.frame));
    framed(b, m, x0, z0, x1, z1, up + 0.2, h);
    thatchRoof(b, m, x0, z0, x1, z1, h, Math.min(2.4, (z1 - z0) * 0.5 + 0.4));
    for (const x of windowSpots(x1 - x0, undefined, 1.5)) cottageWindow(b, m, x0 + x, up + 0.75, z1, false, false);
    // A stair up to its door at the east end, the door in the upper floor's end.
    for (let i = 0; i < 6; i++) b.box(x1 + 0.05, i * 0.4, z1 - 1.6 + i * 0.22, x1 + 0.75, i * 0.4 + 0.12, z1 - 1.3 + i * 0.22, sides(m.frame));
    plaque(b, xm, up + 1.5, z1 + 0.03, villageSign(trade, m.pal));
    const banner = bannerMaterial(m.pal.cloth!, m.pal.trim!);
    b.card(fitted(banner), x0 + 0.3, up - 2.0 + 0.1, x0 + 1.05, up + 0.1, z1 + 0.12);
    // Market goods under it.
    crate(b, xm - 0.6, z0 + 1.2, 0.55, "carrots");
    crate(b, xm + 0.2, z0 + 1.1, 0.55, "apples");
    sack(b, xm + 1.0, z0 + 1.3);
    return [xm, 1, z1];
  };
}

/** A smithy: a fieldstone forge under a thatched lean-to, its fire glowing, an anvil on a stump. */
function smithy(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const back = z1 - 1.8;
    const xm = (x0 + x1) / 2;
    b.box(x0, 0, z0, x1, 2.4, back, sides(m.stone));
    thatchRoof(b, m, x0, z0, x1, back, 2.4, 1.4);
    for (const x of [x0 + 0.1, x1 - 0.3]) b.box(x, 0, z1 - 0.3, x + 0.2, 2.0, z1 - 0.1, sides(m.frame));
    b.box(x0, 1.95, z1 - 0.35, x1, 2.1, z1 - 0.05, sides(m.frame));
    slope(b, x0 - 0.2, back, x1 + 0.2, z1 + 0.2, 2.05, 2.6, m.thatch);
    const fx = x0 + 1.1;
    b.box(fx - 0.6, 0, back, fx + 0.6, 0.8, back + 0.8, sides(m.stone));
    b.box(fx - 0.45, 0.8, back + 0.08, fx + 0.45, 0.85, back + 0.7, sides(fitted(material("village-coals", () => {
      const p = new Pixmap(8, 8);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) p.set(x, y, [C.FIRE[0]!, C.FIRE[1]!, C.FIRE[2]!, C.FIRE[3]!][(x * 3 + y * 5) % 4]!);
      return p;
    }, { glowing: true }))));
    chimney(b, m, fx, back - 0.45, 4.6);
    b.cylinder(xm + 0.4, z1 - 0.9, 0, 0.45, 0.24, 7, { mat: stock.bark() }, fitted(material("village-stump-top", () => new Pixmap(4, 4, C.WOOD[4]!))));
    const ironFace = sides(flat(C.IRON[2]!), flat(C.IRON[4]!));
    b.box(xm + 0.1, 0.45, z1 - 1.02, xm + 0.65, 0.6, z1 - 0.78, ironFace);
    b.box(xm + 0.65, 0.48, z1 - 0.96, xm + 0.8, 0.57, z1 - 0.84, ironFace);
    door(b, x1 - 0.8, 0, back, villageDoor(m));
    hangingSign(b, x0 + 0.25, 1.9, z1 - 0.1, villageSign(trade, m.pal), m.frame);
    return [x1 - 0.8, 1, back];
  };
}

/** A hedge wizard's tower: three storeys of daub and stone, each a little askew on the last, a pointed thatch hat. */
function crookedTower(m: Mats, trade: Trade, floors: number): Draw {
  return (b, x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const s = Math.min(x1 - x0, z1 - z0) - 0.6;
    b.box(cx - s / 2 - 0.1, 0, cz - s / 2 - 0.1, cx + s / 2 + 0.1, 0.4, cz + s / 2 + 0.1, sides(m.stone));
    let y = 0.4;
    let ox = 0;
    for (let f = 0; f < floors; f++) {
      const turn = (f % 2 ? 1 : -1) * 0.12 * f;
      const k = 1 - f * 0.08;
      const hf = 1.9;
      b.at(cx + ox, 0, cz, turn, () => {
        b.box((-s / 2) * k, y, (-s / 2) * k, (s / 2) * k, y + hf, (s / 2) * k, sides(f === 0 ? m.stone : m.wall));
        b.box((-s / 2) * k - 0.06, y + hf - 0.12, (-s / 2) * k - 0.06, (s / 2) * k + 0.06, y + hf, (s / 2) * k + 0.06, sides(m.frame));
        if (f > 0) b.card(fitted(smallWindow(true)), -0.375, y + 0.6, 0.375, y + 1.35, (s / 2) * k + 0.01);
      });
      if (f > 0) sideCottageWindow(b, cx + ox + (s / 2) * k, y + 0.5, cz, 1, true);
      y += hf;
      ox += (f % 2 ? -1 : 1) * 0.12;
    }
    const r = (s / 2) * (1 - floors * 0.08) * 1.45;
    coneRoof(b, cx + ox, cz, y - 0.1, r, r * 2.4, m.thatch, 10);
    // The hat's tip leans: a crooked finial with a star.
    limb(b, [cx + ox, y - 0.1 + r * 2.35, cz], [cx + ox + 0.35, y + r * 2.4 + 0.35, cz + 0.1], 0.06, 0.03, frame(m.pal.timber!), 4);
    b.blob(cx + ox + 0.37, y + r * 2.4 + 0.4, cz + 0.1, 0.09, 0.09, 0.09, material("village-star", () => new Pixmap(2, 2, C.GOLD[5]!), { glowing: true }));
    door(b, cx, 0.4, cz + s / 2, villageDoor(m, "round"));
    plaque(b, cx, 2.45 - 0.05, cz + s / 2 + 0.02, signMaterial(trade, C.PURPLE, C.GOLD, "round"));
    return [cx, 1, cz + s / 2];
  };
}

/** A barn: tall framed walls of boards under a great thatch, its doors wide, hay showing in the loft. */
function barn(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const h = 3.0;
    b.box(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, 0.4, z1 + 0.06, sides(m.stone));
    b.box(x0, 0.4, z0, x1, h, z1, sides(tiled(material(`village-boards@${rampKey(m.pal.darkTimber ?? C.WOOD)}`, () => {
      const r = m.pal.darkTimber ?? C.WOOD;
      const p = new Pixmap(16, 32);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 4 === 0 ? r[1]! : x % 4 === 1 ? r[4]! : hash2(x, y, 97) < 0.1 ? r[2]! : r[3]!);
      return p;
    }))));
    thatchRoof(b, m, x0, z0, x1, z1, h, Math.min(2.8, (z1 - z0) * 0.6 + 0.4));
    b.card(fitted(doorMaterial(m.pal.darkTimber ?? C.WOOD, m.pal.timber ?? C.DARKWOOD, "square", false)), xm - 1.0, 0.4, xm + 1.0, 2.8, z1 + 0.01);
    b.card(fitted(material("village-hay", () => {
      const p = new Pixmap(12, 10);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) p.set(x, y, x < 1 || x > 10 || y < 1 ? C.DARKWOOD[2]! : hash2(x, y, 98) < 0.5 ? C.STRAW[3]! : C.STRAW[2]!);
      return p;
    })), xm - 0.4, h + 0.05, xm + 0.4, h + 0.7, z1 + 0.32);
    for (let i = 0; i < 3; i++) b.blob(x0 + 0.5 + i * 0.5, 0.35, z1 + 0.6, 0.35, 0.35, 0.3, material("village-haybale", () => T.straw(99), { smooth: true }));
    barrel(b, x1 - 0.5, z1 + 0.5);
    return [xm, 1, z1];
  };
}

/** A fieldstone wall, chest high, capped with flat stones. */
function wall(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const t = Math.min(0.7, Math.min(x1 - x0, z1 - z0));
    const along = x1 - x0 >= z1 - z0;
    const [a0, b0, a1, b1] = along ? [x0, (z0 + z1) / 2 - t / 2, x1, (z0 + z1) / 2 + t / 2] : [(x0 + x1) / 2 - t / 2, z0, (x0 + x1) / 2 + t / 2, z1];
    b.box(a0, 0, b0, a1, 1.2, b1, sides(m.stone));
    b.box(a0 - 0.05, 1.2, b0 - 0.05, a1 + 0.05, 1.35, b1 + 0.05, sides(tiled(stock.flagstone(C.COBBLE))));
    return undefined;
  };
}

/** A timber gate: two great posts, a thatched lintel over the passage (the middle 2 tiles), its leaves swung open. */
function gate(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const g0 = xm - 1;
    const g1 = xm + 1;
    const zm = (z0 + z1) / 2;
    for (const x of [g0 - 0.3, g1]) b.box(x, 0, zm - 0.2, x + 0.3, 3.0, zm + 0.2, sides(m.frame));
    b.box(g0 - 0.5, 2.8, zm - 0.25, g1 + 0.5, 3.05, zm + 0.25, sides(m.frame));
    b.gableRoof(g0 - 0.7, zm - 0.6, g1 + 0.7, zm + 0.6, 3.05, 0.7, m.thatch, m.frame, 0.1);
    // The leaves swung back against the fence.
    const leaf = fitted(material("village-gate-leaf", () => {
      const p = new Pixmap(16, 24);
      for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) p.set(x, y, y < 2 || y > 21 || Math.abs(x * 1.4 - y) < 1.5 ? C.WOOD[4]! : x % 4 === 0 ? C.WOOD[1]! : C.WOOD[3]!);
      return p;
    }, { twoSided: true }));
    for (const [x, s] of [
      [g0, -1],
      [g1, 1],
    ] as const)
      b.at(x, 0, zm + 0.2, (s * Math.PI) / 2.3, () => b.card(leaf, s > 0 ? 0 : -1.0, 0.1, s > 0 ? 1.0 : 0, 1.6, 0));
    // A stretch of wattle fence either side of the posts.
    const wattle = tiled(material("village-wattle", () => {
      const p = new Pixmap(16, 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x + Math.floor(y / 4) * 4) % 8 < 4 ? C.WOOD[3]! : C.WOOD[2]!);
      return p;
    }));
    if (g0 - 0.3 - x0 > 0.2) b.box(x0, 0, zm - 0.08, g0 - 0.3, 1.2, zm + 0.08, sides(wattle));
    if (x1 - g1 - 0.3 > 0.2) b.box(g1 + 0.3, 0, zm - 0.08, x1, 1.2, zm + 0.08, sides(wattle));
    return [xm, 1, z1];
  };
}

/** A watchtower: a hut of boards on four tall legs, a ladder up, a thatched cap. */
function watchtower(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const s = Math.min(x1 - x0, z1 - z0) / 2 - 0.2;
    const up = 3.2;
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const)
      limb(b, [cx + dx * (s + 0.15), 0, cz + dz * (s + 0.15)], [cx + dx * (s - 0.1), up, cz + dz * (s - 0.1)], 0.09, 0.08, frame(m.pal.timber!), 5);
    b.box(cx - s - 0.1, up, cz - s - 0.1, cx + s + 0.1, up + 0.15, cz + s + 0.1, sides(m.frame));
    b.box(cx - s, up + 0.15, cz - s, cx + s, up + 1.2, cz + s, sides(m.wall));
    b.box(cx - s - 0.05, up + 1.1, cz - s - 0.05, cx + s + 0.05, up + 1.25, cz + s + 0.05, sides(m.frame));
    coneRoof(b, cx, cz, up + 1.25, s * 1.6, s * 1.6, m.thatch, 8);
    b.card(fitted(smallWindow(false)), cx - 0.375, up + 0.35, cx + 0.375, up + 1.1, cz + s + 0.01);
    for (const dx of [-0.2, 0.2]) b.box(cx + dx - 0.04, 0, cz + s + 0.35, cx + dx + 0.04, up, cz + s + 0.43, sides(m.frame));
    for (let y = 0.3; y < up; y += 0.35) b.box(cx - 0.2, y, cz + s + 0.36, cx + 0.2, y + 0.05, cz + s + 0.42, sides(m.frame));
    return undefined;
  };
}

function village(building: BuildingData, pal: Palette): Built {
  const m = mats(pal);
  const P = paramsOf(building);
  const kind = building.kind ?? "house";
  const trade = tradeOf(building);
  const go = (draw: Draw, through = false) => styled(building, draw, through);
  switch (kind) {
    case "shop":
      return go(cottage(m, building, 1, trade ?? "general"));
    case "tenement":
    case "inn":
      return go(kind === "inn" ? inn(m, building, trade ?? "inn") : cottage(m, building, 2));
    case "temple":
      return go(chapel(m));
    case "guildhall":
      return go(mootHall(m, trade ?? "guild"));
    case "smithy":
      return go(smithy(m, trade ?? "smith"));
    case "library":
      return go(cottage(m, building, 1, trade ?? "books", true));
    case "tower":
      return go(crookedTower(m, trade ?? "magic", P.num("floors", 3)));
    case "barn":
    case "warehouse":
      return go(barn(m));
    case "gatehouse":
      return go(gate(m), true);
    case "wall":
      return go(wall(m));
    case "wall-tower":
      return go(watchtower(m));
    default:
      return go(cottage(m, building, P.num("floors", 1)));
  }
}

BUILDINGS.define(
  "village",
  "A village's style for any region: wattle and daub between dark timber framing on fieldstone footings, thick rounded thatch, fieldstone chimneys, shuttered windows with flower boxes. Kinds: house (params floors 1-2), tenement (two floors), shop (wares on a trestle), inn, temple (a chapel with a bell-cote), guildhall (a moot hall on posts over a market floor), smithy (a forge under a thatched lean-to), library (a lit cottage with a book sign), tower (a hedge wizard's crooked tower; floors), warehouse (a barn), gatehouse (a timber gate over the middle 2 tiles), wall (fieldstone, chest high), wall-tower (a watchtower on legs); params.trade names a sign's emblem, params.doorAt the door",
  village,
  VILLAGE,
);

showcase("village", [
  { kind: "house", w: 4, d: 3, label: "cottage" },
  { kind: "house", w: 5, d: 4, label: "two floors", params: { floors: 2 } },
  { kind: "house", w: 6, d: 4, label: "whitewashed", palette: "whitewash" },
  { kind: "shop", w: 5, d: 4, params: { trade: "food" } },
  { kind: "inn", w: 7, d: 5 },
  { kind: "smithy", w: 5, d: 5 },
  { kind: "temple", w: 4, d: 6 },
  { kind: "guildhall", w: 6, d: 4 },
  { kind: "library", w: 5, d: 4 },
  { kind: "tower", w: 3, d: 3, params: { floors: 3 } },
  { kind: "warehouse", w: 7, d: 5 },
  { kind: "gatehouse", w: 6, d: 1 },
  { kind: "wall-tower", w: 3, d: 3 },
  { kind: "wall", w: 6, d: 1 },
]);

