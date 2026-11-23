import type { BuildingData, XYZ } from "../../world/format";
import { type Face, type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, painted } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import { Pixmap, seeded } from "../paint/pixmap";
import * as R from "../paint/ramps";
import * as T from "../paint/textures";
import { barrel, crate, gold, iron, lantern, pics } from "../props/draw";
import { bannerMaterial, glowing } from "../props/kit";
import type { Built } from "../recipe";
import { door, doorMaterial, hangingSign, hipRoof, merlons, params as paramsOf, plaque, signMaterial, styled, type Trade, tradeOf, windowSpots } from "./kit";
import { BUILDINGS, showcase } from "./registry";
import { ridgeNS } from "./tolarian";

// The Vess estate's style, in the Caligo Morass: a manor and its village of black stone, steep roofs of
// black slate with iron finials on their ridges, tall chimneys, gothic lancet windows lit gold from within, pointed
// doors, gargoyles crouched at the eaves, black-and-gold cloth; and the Vess crypts' mausoleum.
//
// Palette slots: stone (walls), roof (slate), cloth and trim (banners), timber (doors). Params: floors (house, shop,
// inn, tower), trade (a sign's emblem), doorAt.

const VESS: Palette = { stone: R.VESS_STONE, roof: R.VESS_SLATE, cloth: C.BLACK, trim: C.GOLD, timber: C.DARKWOOD };

type Draw = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined;

// --- Materials ---------------------------------------------------------------------------------------------------------

const vessStone = (r: Ramp): Material => painted("vess-stone", r, R.VESS_STONE, (ramp) => T.ashlar(ramp, 81, 6, 7, 13));
const vessFlag = (r: Ramp): Material => painted("vess-flag", r, R.VESS_STONE, (ramp) => T.flagstones(ramp, 82));

/** Slate shingles from a ramp: narrow plates in staggered rows, a dark lap under each. */
const vessSlate = (r: Ramp): Material =>
  painted("vess-slate", r, R.VESS_SLATE, (s) => {
    const p = new Pixmap(32, 32);
    const random = seeded(83);
    for (let row = 0; row < 8; row++) {
      const shift = row % 2 ? 2 : 0;
      for (let t = 0; t < 9; t++) {
        const base = random() < 0.65 ? 3 : random() < 0.5 ? 2 : 4;
        for (let j = 0; j < 4; j++) {
          for (let i = 0; i < 4; i++) {
            let c = s[base]!;
            if (j === 0) c = s[1]!;
            if (j === 1 && i < 2) c = s[Math.min(s.length - 1, base + 1)]!;
            if (i === 3) c = s[base - 1]!;
            p.set(t * 4 + i + shift, row * 4 + j, c);
          }
        }
      }
    }
    return p;
  });

/** A lancet window, 12 by 28, cut out: a tall pointed arch of stone, leaded glass glowing gold (or dark). */
function lancetPicture(frame: Ramp, lit: boolean): Pixmap {
  const p = new Pixmap(12, 28);
  p.fill(0, 0);
  const inArch = (x: number, y: number, inset: number) => {
    const half = 6 - inset;
    if (x < inset || x > 11 - inset || y < inset || y > 27 - (inset > 0 ? 2 : 0)) return false;
    if (y >= 9) return true;
    // A pointed arch: two arcs meeting at the top.
    const dx = Math.abs(x - 5.5);
    return dx <= half * Math.sqrt(Math.max(0, (y - inset + 1) / (9 - inset + 1))) + 0.3;
  };
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 12; x++) {
      if (!inArch(x, y, 0)) continue;
      if (!inArch(x, y, 2)) {
        p.set(x, y, y > 25 ? frame[5]! : x < 6 ? frame[4]! : frame[2]!);
        continue;
      }
      const lead = x === 5 || x === 6 || (y > 9 && (y - 10) % 5 === 0) || (y < 10 && (x + y) % 4 === 0);
      let c = lit ? (y < 12 ? C.GOLD[4]! : y < 20 ? C.GOLD[3]! : C.FIRE[2]!) : y < 12 ? C.DUNGEON[3]! : C.DUNGEON[1]!;
      if (lead) c = C.INK;
      p.set(x, y, c);
    }
  }
  return p;
}

const lancet = (frame: Ramp, lit = true) =>
  material(`vess-lancet${lit ? "-lit" : ""}@${rampKey(frame)}`, () => lancetPicture(frame, lit), lit ? { cutout: true, glow: 0.6 } : { cutout: true });

/** A gargoyle's picture, 12 by 12, cut out: a crouched horned beast in dark stone, its eyes glowing. */
function gargoylePicture(r: Ramp): Pixmap {
  const p = new Pixmap(12, 12);
  p.fill(0, 0);
  const rows = ["h........h..", ".h......h...", ".hhhhhhhh...", "wwhehhehhww.", "wwhhhhhhhwww", "wwwhmmmhwww.", ".ww.hhhh.ww.", "....hhhh....", "...hh..hh...", "...hh..hh...", "..hhh..hhh..", "............"];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === ".") continue;
      p.set(x, y, ch === "e" ? C.RED[5]! : ch === "m" ? r[1]! : ch === "w" ? r[2]! : x < 6 ? r[4]! : r[3]!);
    }
  });
  return p;
}

// --- Parts ---------------------------------------------------------------------------------------------------------------

interface Mats {
  readonly wall: Face;
  readonly flag: Face;
  readonly slate: Material;
  readonly pal: Palette;
}

const mats = (pal: Palette): Mats => ({ wall: tiled(vessStone(pal.stone!)), flag: tiled(vessFlag(pal.stone!)), slate: vessSlate(pal.roof!), pal });

/** An iron finial: a spike with a crossbar, on a ridge's end or a spire's point. */
function finial(b: MeshBuilder, x: number, y: number, z: number, h = 0.6): void {
  b.box(x - 0.03, y, z - 0.03, x + 0.03, y + h, z + 0.03, sides(iron()));
  b.box(x - 0.14, y + h * 0.55, z - 0.02, x + 0.14, y + h * 0.55 + 0.05, z + 0.02, sides(iron()));
  b.box(x - 0.05, y + h, z - 0.05, x + 0.05, y + h + 0.1, z + 0.05, sides(gold()));
}

/** A gargoyle crouched on a ledge at (x, y, z), facing south and seen from either side. */
function gargoyle(b: MeshBuilder, m: Mats, x: number, y: number, z: number): void {
  const g = fitted(material(`gargoyle@${rampKey(m.pal.stone!)}`, () => gargoylePicture(m.pal.stone!), { cutout: true, twoSided: true }));
  b.box(x - 0.22, y - 0.08, z - 0.25, x + 0.22, y, z + 0.15, sides(m.flag));
  b.card(g, x - 0.375, y, x + 0.375, y + 0.75, z + 0.05);
  b.at(x, 0, z - 0.05, Math.PI / 2, () => b.card(g, -0.3, y, 0.3, y + 0.6, 0));
}

/** A tall chimney: a stack of stone above the roof, a cap and two pots. */
function chimney(b: MeshBuilder, m: Mats, x: number, z: number, y0: number, y1: number): void {
  b.box(x - 0.3, y0, z - 0.3, x + 0.3, y1, z + 0.3, sides(m.wall));
  b.box(x - 0.38, y1, z - 0.38, x + 0.38, y1 + 0.15, z + 0.38, sides(m.flag));
  for (const dx of [-0.13, 0.13]) b.cylinder(x + dx, z, y1 + 0.15, y1 + 0.45, 0.09, 6, { mat: flat(C.ROOF[1]!) }, { mat: flat(C.INK) });
}

/** A steep gabled range: stone walls `h` high, black slate rising `rise` east-west, finials at both ends of the ridge. */
function range(b: MeshBuilder, m: Mats, x0: number, z0: number, x1: number, z1: number, h: number, rise: number): void {
  b.box(x0 - 0.08, 0, z0 - 0.08, x1 + 0.08, 0.35, z1 + 0.08, sides(m.flag));
  b.box(x0, 0.35, z0, x1, h, z1, sides(m.wall));
  b.box(x0 - 0.1, h - 0.15, z0 - 0.1, x1 + 0.1, h, z1 + 0.1, sides(m.flag));
  b.gableRoof(x0 - 0.25, z0 - 0.25, x1 + 0.25, z1 + 0.25, h, rise, m.slate, m.wall, 0.1);
  const zm = (z0 + z1) / 2;
  b.box(x0 - 0.25, h + rise - 0.06, zm - 0.06, x1 + 0.25, h + rise + 0.08, zm + 0.06, sides(iron()));
  finial(b, x0 - 0.15, h + rise, zm);
  finial(b, x1 + 0.15, h + rise, zm);
}

/** A cross gable over the front: a steep pediment of slate facing south from the range, a lancet in its face. */
function crossGable(b: MeshBuilder, m: Mats, xm: number, w: number, zBack: number, zFront: number, h: number, rise: number): void {
  b.box(xm - w / 2, h - 0.6, zBack, xm + w / 2, h, zFront, sides(m.wall));
  ridgeNS(b, xm - w / 2 - 0.2, zBack, xm + w / 2 + 0.2, zFront + 0.2, h, rise, m.slate, m.wall, 0.08);
  finial(b, xm, h + rise - 0.05, zFront + 0.15, 0.5);
  b.card(fitted(lancet(m.pal.stone!)), xm - 0.375, h + 0.1, xm + 0.375, h + 0.1 + 1.75, zFront + 0.21);
}

/** Lancets down both side walls, each storey. */
function flanks(b: MeshBuilder, m: Mats, x0: number, x1: number, z0: number, z1: number, floors: number): void {
  const mat = lancet(m.pal.stone!);
  for (let f = 0; f < floors; f++) {
    for (const z of windowSpots(z1 - z0, undefined, 1.6, 1.0)) {
      sideTall(b, x1, 0.75 + f * 2.2, z0 + z, 1, mat);
      sideTall(b, x0, 0.75 + f * 2.2, z0 + z, -1, mat);
    }
  }
}

function sideTall(b: MeshBuilder, x: number, y: number, z: number, facing: 1 | -1, mat: Material): void {
  b.at(x + facing * 0.01, 0, z, (facing * Math.PI) / 2, () => b.card(fitted(mat), -0.375, y, 0.375, y + 1.75, 0));
}

/** Lancets across a front, clear of the door. */
function lancets(b: MeshBuilder, m: Mats, x0: number, x1: number, z: number, floors: number, doorAt: number | undefined): void {
  const mat = lancet(m.pal.stone!);
  for (let f = 0; f < floors; f++) for (const x of windowSpots(x1 - x0, f === 0 ? doorAt : undefined, 1.5)) b.card(fitted(mat), x0 + x - 0.375, 0.75 + f * 2.2, x0 + x + 0.375, 0.75 + f * 2.2 + 1.75, z + 0.01);
}

const vessSign = (trade: Trade, pal: Palette) => signMaterial(trade, pal.cloth!, pal.trim!, "shield");
const vessDoor = (m: Mats) => doorMaterial(m.pal.timber ?? C.DARKWOOD, m.pal.stone!, "pointed");

// --- Kinds -----------------------------------------------------------------------------------------------------------------

function house(m: Mats, building: BuildingData, floors: number, trade?: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 0.35 + floors * 2.2 + 0.3;
    const rise = Math.min(3.2, (z1 - z0) * 0.75);
    const doorAt = paramsOf(building).num("doorAt", (x1 - x0) / 2);
    range(b, m, x0, z0, x1, z1, h, rise);
    if (x1 - x0 >= 5) crossGable(b, m, x0 + doorAt, 2.0, z1 - 0.6, z1 + 0.25, h, 1.6);
    chimney(b, m, x0 + 0.7, (z0 + z1) / 2 - 0.5, h, h + rise + 0.8);
    door(b, x0 + doorAt, 0.35, z1 + (x1 - x0 >= 5 ? 0.25 : 0), vessDoor(m), m.flag);
    lancets(b, m, x0, x1, z1, floors, doorAt);
    flanks(b, m, x0, x1, z0, z1, floors);
    if (trade) {
      hangingSign(b, x0 + Math.min(x1 - x0 - 0.6, doorAt + 1.25), 2.55, z1, vessSign(trade, m.pal), m.flag);
      crate(b, x0 + 0.6, z1 + 0.55, 0.55);
      barrel(b, x1 - 0.55, z1 + 0.5, 0.75);
    }
    wallLantern(b, x0 + doorAt - 0.95, 1.9, z1);
    return [x0 + doorAt, 1, z1];
  };
}

/** A lantern on an iron bracket, its glass gold. */
function wallLantern(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.03, y + 0.3, z, x + 0.03, y + 0.36, z + 0.35, sides(iron()));
  lantern(b, x, y - 0.1, z + 0.3);
}

function inn(m: Mats, building: BuildingData, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const draw = house(m, building, 2);
    const at = draw(b, x0, z0, x1, z1)!;
    hangingSign(b, Math.max(x0 + 0.6, at[0] - 1.6), 2.6, z1, vessSign(trade, m.pal), m.flag);
    wallLantern(b, at[0] + 0.95, 1.9, z1);
    return at;
  };
}

/** A chapel: a steep-roofed nave, a tower at its front with a needle spire, a rose of stained glass, buttresses. */
function chapel(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const tw = Math.min(2.6, (x1 - x0) * 0.4);
    const h = 4.2;
    const front = z1 - 1.0;
    range(b, m, x0, z0, x1, front, h, Math.min(3.4, (front - z0) * 0.7));
    for (const z of windowSpots(front - z0, undefined, 2.0, 1.0)) {
      for (const x of [x0 - 0.3, x1]) b.box(x, 0, z0 + z - 1.0 - 0.15, x + 0.3, h - 0.5, z0 + z - 1.0 + 0.15, sides(m.wall, m.flag));
    }
    flanks(b, m, x0, x1, z0, front, 1);
    const ta = xm - tw / 2;
    const tb = xm + tw / 2;
    const top = h + 2.8;
    b.box(ta, 0, z1 - tw, tb, top, z1, sides(m.wall));
    b.box(ta - 0.1, top, z1 - tw - 0.1, tb + 0.1, top + 0.2, z1 + 0.1, sides(m.flag));
    hipRoof(b, ta - 0.1, z1 - tw - 0.1, tb + 0.1, z1 + 0.1, top + 0.2, 3.6, m.slate);
    finial(b, xm, top + 3.75, z1 - tw / 2, 0.8);
    for (const [x, z] of [
      [ta - 0.05, z1 + 0.05],
      [tb + 0.05, z1 + 0.05],
    ] as const) {
      b.box(x - 0.12, top, z - 0.12, x + 0.12, top + 0.8, z + 0.12, sides(m.flag));
      finial(b, x, top + 0.8, z, 0.35);
    }
    b.card(fitted(lancet(m.pal.stone!, false)), xm - 0.375, top - 2.2, xm + 0.375, top - 0.45, z1 + 0.01);
    b.card(fitted(material("vess-rose", () => rose(), { cutout: true, glow: 0.5 })), xm - 0.5, 2.6, xm + 0.5, 3.6, z1 + 0.01);
    door(b, xm, 0.35, z1, vessDoor(m), m.flag);
    gargoyle(b, m, ta - 0.25, h - 0.1, z1 - 0.2);
    gargoyle(b, m, tb + 0.25, h - 0.1, z1 - 0.2);
    return [xm, 1, z1];
  };
}

/** A rose window, 16 by 16: petals of red, violet and gold round a gold heart, leaded. */
function rose(): Pixmap {
  const p = new Pixmap(16, 16);
  p.fill(0, 0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 7.6) continue;
      const a = Math.atan2(y - 7.5, x - 7.5);
      const petal = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8);
      let c = d > 6.4 ? R.VESS_STONE[4]! : d < 2 ? C.GOLD[4]! : [C.RED[3]!, C.PURPLE[4]!][petal % 2]!;
      if (d > 2 && d < 6.4 && Math.abs(((a + Math.PI) / (Math.PI * 2)) * 8 - petal - 0.5) > 0.42) c = C.INK;
      if (Math.abs(d - 4.2) < 0.5) c = C.INK;
      p.set(x, y, c);
    }
  }
  return p;
}

function hall(m: Mats, trade: Trade, kind: "guildhall" | "library"): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const h = kind === "library" ? 5.2 : 4.8;
    range(b, m, x0, z0, x1, z1, h, Math.min(3.4, (z1 - z0) * 0.65));
    crossGable(b, m, xm, 2.6, z1 - 0.6, z1 + 0.3, h, 2.0);
    for (const x of windowSpots(x1 - x0, undefined, 2.2, 0.3)) b.box(x0 + x - 0.16, 0, z1, x0 + x + 0.16, h - 0.6, z1 + 0.35, sides(m.wall, m.flag));
    lancets(b, m, x0, x1, z1, 2, xm - x0);
    flanks(b, m, x0, x1, z0, z1, 2);
    door(b, xm, 0.35, z1 + 0.3, vessDoor(m), m.flag);
    plaque(b, xm, 2.55, z1 + 0.31, vessSign(trade, m.pal));
    const banner = bannerMaterial(m.pal.cloth!, m.pal.trim!);
    for (const x of [x0 + 0.6, x1 - 0.6]) b.card(fitted(banner), x - 0.375, h - 2.3, x + 0.375, h - 0.3, z1 + 0.02);
    chimney(b, m, x1 - 0.8, (z0 + z1) / 2 - 0.6, h, h + 3.6);
    gargoyle(b, m, x0 + 0.2, h, z1 + 0.05);
    gargoyle(b, m, x1 - 0.2, h, z1 + 0.05);
    return [xm, 1, z1 + 0.3];
  };
}

function smithy(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const back = z1 - 1.8;
    const xm = (x0 + x1) / 2;
    range(b, m, x0, z0, x1, back, 2.8, 1.9);
    // A lean-to of slate over the working floor, on iron posts.
    for (const x of [x0 + 0.15, x1 - 0.25]) b.box(x, 0, z1 - 0.3, x + 0.1, 2.2, z1 - 0.2, sides(iron()));
    slopeRoof(b, x0 - 0.15, back, x1 + 0.15, z1 + 0.1, 2.2, 2.75, m.slate);
    const fx = x0 + 1.1;
    b.box(fx - 0.65, 0, back, fx + 0.65, 0.85, back + 0.85, sides(m.wall));
    b.box(fx - 0.5, 0.85, back + 0.08, fx + 0.5, 0.9, back + 0.75, sides(fitted(glowing(C.FIRE[2]!))));
    chimney(b, m, fx, back - 0.4, 2.0, 5.6);
    anvilAt(b, xm + 0.4, z1 - 0.9);
    door(b, x1 - 0.8, 0, back, vessDoor(m));
    hangingSign(b, x0 + 0.3, 2.2, z1 - 0.1, vessSign(trade, m.pal), m.flag);
    flanks(b, m, x0, x1, z0, back, 1);
    return [x1 - 0.8, 1, back];
  };
}

function slopeRoof(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, low: number, high: number, mat: Material): void {
  b.quad({ mat, density: (16 * (z1 - z0 + high - low)) / Math.hypot(z1 - z0, high - low) }, [
    [x0, low, z1],
    [x1, low, z1],
    [x1, high, z0],
    [x0, high, z0],
  ], (c) => c[0], (c) => Math.hypot(z1 - c[2], c[1] - low));
}

function anvilAt(b: MeshBuilder, x: number, z: number): void {
  const ironFace = sides(flat(C.IRON[2]!), flat(C.IRON[4]!));
  b.cylinder(x, z, 0, 0.5, 0.22, 7, { mat: flat(C.DARKWOOD[3]!) }, { mat: flat(C.DARKWOOD[4]!) });
  b.box(x - 0.3, 0.5, z - 0.12, x + 0.25, 0.68, z + 0.12, ironFace);
  b.box(x + 0.25, 0.55, z - 0.06, x + 0.42, 0.65, z + 0.06, ironFace);
}

/** A square tower: tall, pinnacles at its corners, a needle spire of slate, lancets climbing it. */
function tower(m: Mats, trade: Trade, floors: number): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const zm = (z0 + z1) / 2;
    const h = 1.2 + floors * 2.2;
    b.box(x0 - 0.1, 0, z0 - 0.1, x1 + 0.1, 0.4, z1 + 0.1, sides(m.flag));
    b.box(x0, 0.4, z0, x1, h, z1, sides(m.wall));
    b.box(x0 - 0.12, h, z0 - 0.12, x1 + 0.12, h + 0.2, z1 + 0.12, sides(m.flag));
    hipRoof(b, x0, z0, x1, z1, h + 0.2, (x1 - x0) * 1.5, m.slate);
    finial(b, xm, h + 0.2 + (x1 - x0) * 1.5, zm, 0.8);
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ] as const) {
      b.box(x - 0.14, h, z - 0.14, x + 0.14, h + 0.9, z + 0.14, sides(m.flag));
      finial(b, x, h + 0.9, z, 0.35);
    }
    const mat = lancet(m.pal.stone!);
    for (let k = 1; k < floors; k++) {
      b.card(fitted(mat), xm - 0.375, 0.6 + k * 2.2, xm + 0.375, 2.35 + k * 2.2, z1 + 0.01);
      sideTall(b, k % 2 ? x1 : x0, 0.6 + k * 2.2, zm, k % 2 ? 1 : -1, mat);
    }
    door(b, xm, 0.4, z1, vessDoor(m), m.flag);
    plaque(b, xm, 2.55, z1 + 0.01, vessSign(trade, m.pal));
    gargoyle(b, m, x0 + 0.2, h - 0.6, z1 + 0.05);
    gargoyle(b, m, x1 - 0.2, h - 0.6, z1 + 0.05);
    return [xm, 1, z1];
  };
}

function warehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    range(b, m, x0, z0, x1, z1, 3.4, Math.min(3, (z1 - z0) * 0.6));
    b.card(fitted(doorMaterial(m.pal.timber ?? C.DARKWOOD, m.pal.stone!, "pointed")), xm - 1.0, 0.35, xm + 1.0, 3.0, z1 + 0.01);
    for (const x of windowSpots(x1 - x0, xm - x0, 2.2)) b.card(fitted(lancet(m.pal.stone!, false)), x0 + x - 0.375, 1.0, x0 + x + 0.375, 2.75, z1 + 0.01);
    flanks(b, m, x0, x1, z0, z1, 1);
    crate(b, x0 + 0.6, z1 + 0.55, 0.65);
    barrel(b, x0 + 1.4, z1 + 0.5);
    barrel(b, x1 - 0.55, z1 + 0.5);
    return [xm, 1, z1];
  };
}

function squareTower(b: MeshBuilder, m: Mats, x0: number, z0: number, x1: number, z1: number, h: number): void {
  b.box(x0, 0, z0, x1, h, z1, sides(m.wall, m.flag));
  b.box(x0 - 0.12, h, z0 - 0.12, x1 + 0.12, h + 0.2, z1 + 0.12, sides(m.flag));
  hipRoof(b, x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, h + 0.2, (x1 - x0) * 1.2, m.slate);
  finial(b, (x0 + x1) / 2, h + 0.2 + (x1 - x0 + 0.2) * 1.2, (z0 + z1) / 2, 0.6);
  b.card(fitted(lancet(m.pal.stone!, false)), (x0 + x1) / 2 - 0.375, h - 2.3, (x0 + x1) / 2 + 0.375, h - 0.55, z1 + 0.01);
}

function gatehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const g0 = xm - 1;
    const g1 = xm + 1;
    const h = 5.0;
    squareTower(b, m, x0, z0, g0, z1, h);
    squareTower(b, m, g1, z0, x1, z1, h);
    b.box(g0, 2.8, z0 + 0.1, g1, h - 0.6, z1 - 0.1, sides(m.wall, m.flag));
    merlons(b, g0, z1 - 0.2, g1, z1 - 0.2, h - 0.6, m.wall, 0.3);
    for (let x = g0 + 0.15; x < g1 - 0.1; x += 0.25) b.box(x - 0.03, 2.4, z1 - 0.35, x + 0.03, 2.8, z1 - 0.29, sides(iron()));
    const banner = bannerMaterial(m.pal.cloth!, m.pal.trim!);
    b.card(fitted(banner), xm - 0.375, h - 2.6, xm + 0.375, h - 0.6, z1 - 0.09);
    return [xm, 1, z1];
  };
}

function wall(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const h = 3.0;
    b.box(x0, 0, z0, x1, h, z1, sides(m.wall, m.flag));
    if (x1 - x0 >= z1 - z0) {
      merlons(b, x0, z1 - 0.1, x1, z1 - 0.1, h, m.wall);
      merlons(b, x0, z0 + 0.1, x1, z0 + 0.1, h, m.wall);
    } else {
      merlons(b, x1 - 0.1, z0, x1 - 0.1, z1, h, m.wall);
      merlons(b, x0 + 0.1, z0, x0 + 0.1, z1, h, m.wall);
    }
    return undefined;
  };
}

/** The Vess crypts' mausoleum: a steep-gabled house of the dead, its iron gate between pillars, gargoyles at its eaves. */
function mausoleum(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const zf = z1 - 0.6;
    b.box(x0 - 0.1, 0, z0 - 0.1, x1 + 0.1, 0.3, z1, sides(m.flag));
    b.box(x0, 0.3, z0, x1, 2.8, zf, sides(m.wall));
    ridgeNS(b, x0 - 0.2, z0 - 0.2, x1 + 0.2, zf + 0.25, 2.8, Math.min(2.6, (x1 - x0) * 0.6), m.slate, m.wall, 0.1);
    finial(b, xm, 2.8 + Math.min(2.6, (x1 - x0) * 0.6) - 0.05, zf + 0.2, 0.7);
    b.box(xm - 0.9, 0, zf + 0.25, xm + 0.9, 0.15, z1 + 0.35, sides(m.flag));
    for (const x of [xm - 1.1, xm + 1.1]) {
      b.box(x - 0.24, 0.3, zf, x + 0.24, 2.8, zf + 0.4, sides(m.wall, m.flag));
      b.box(x - 0.3, 2.8, zf - 0.05, x + 0.3, 3.0, zf + 0.45, sides(m.flag));
    }
    b.card(fitted(pics.cryptGate()), xm - 0.625, 0.3, xm + 0.625, 2.175, zf + 0.01);
    gargoyle(b, m, x0 + 0.2, 2.8, zf + 0.1);
    gargoyle(b, m, x1 - 0.2, 2.8, zf + 0.1);
    for (const x of [x0 - 0.01, x1 + 0.01]) b.at(x, 0, (z0 + zf) / 2, x < xm ? -Math.PI / 2 : Math.PI / 2, () => b.card(fitted(lancet(m.pal.stone!, false)), -0.375, 0.7, 0.375, 2.45, 0));
    return [xm, 1, z1];
  };
}

/** The Vess manor: a central block of three storeys under a tower and spire, two gabled wings reaching forward round a court. */
function manor(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    const xm = (x0 + x1) / 2;
    const ww = Math.min(4, (x1 - x0) * 0.28);
    const zc = z1 - 2.6;
    const h = 0.35 + 3 * 2.2;
    const wh = 0.35 + 2 * 2.2 + 0.3;
    // The central block and its tower.
    range(b, m, x0 + ww, z0, x1 - ww, zc, h, Math.min(3.4, (zc - z0) * 0.6));
    lancets(b, m, x0 + ww, x1 - ww, zc, 3, xm - x0 - ww);
    const tw = 2.6;
    const top = h + 2.6;
    b.box(xm - tw / 2, 0, zc - tw + 0.6, xm + tw / 2, top, zc + 0.6, sides(m.wall));
    b.box(xm - tw / 2 - 0.12, top, zc - tw + 0.48, xm + tw / 2 + 0.12, top + 0.2, zc + 0.72, sides(m.flag));
    hipRoof(b, xm - tw / 2 - 0.1, zc - tw + 0.5, xm + tw / 2 + 0.1, zc + 0.7, top + 0.2, 4.0, m.slate);
    finial(b, xm, top + 4.15, zc - tw / 2 + 0.6, 0.9);
    b.card(fitted(lancet(m.pal.stone!)), xm - 0.375, top - 2.2, xm + 0.375, top - 0.45, zc + 0.61);
    b.card(fitted(material("vess-rose", () => rose(), { cutout: true, glow: 0.5 })), xm - 0.5, 4.6, xm + 0.5, 5.6, zc + 0.61);
    // The wings: each a gabled range running north-south, its gable to the court's front.
    for (const [wa, wb] of [
      [x0, x0 + ww],
      [x1 - ww, x1],
    ] as const) {
      b.box(wa - 0.08, 0, z0 - 0.08, wb + 0.08, 0.35, z1 + 0.08, sides(m.flag));
      b.box(wa, 0.35, z0, wb, wh, z1, sides(m.wall));
      ridgeNS(b, wa - 0.25, z0 - 0.25, wb + 0.25, z1 + 0.25, wh, Math.min(3, ww * 0.75), m.slate, m.wall, 0.1);
      finial(b, (wa + wb) / 2, wh + Math.min(3, ww * 0.75) - 0.05, z1 + 0.2, 0.6);
      for (let f = 0; f < 2; f++) b.card(fitted(lancet(m.pal.stone!)), (wa + wb) / 2 - 0.375, 0.75 + f * 2.2, (wa + wb) / 2 + 0.375, 2.5 + f * 2.2, z1 + 0.01);
      flanks(b, m, wa, wb, z0, z1, 2);
      gargoyle(b, m, wa + 0.2, wh, z1 + 0.05);
      gargoyle(b, m, wb - 0.2, wh, z1 + 0.05);
      chimney(b, m, (wa + wb) / 2, z0 + 1.0, wh, wh + 3.4);
    }
    // The court: steps up to the door, lanterns, banners on the tower.
    b.box(xm - 1.4, 0, zc + 0.6, xm + 1.4, 0.2, zc + 1.3, sides(m.flag));
    b.box(xm - 1.0, 0.2, zc + 0.6, xm + 1.0, 0.35, zc + 0.95, sides(m.flag));
    door(b, xm, 0.35, zc + 0.6, vessDoor(m));
    const banner = bannerMaterial(m.pal.cloth!, m.pal.trim!);
    for (const x of [xm - tw / 2 - 0.5, xm + tw / 2 + 0.5]) b.card(fitted(banner), x - 0.375, h - 2.3, x + 0.375, h - 0.3, zc + 0.02);
    wallLantern(b, xm - 0.95, 1.9, zc + 0.6);
    wallLantern(b, xm + 0.95, 1.9, zc + 0.6);
    return [xm, 1, zc + 0.6];
  };
}

function vess(building: BuildingData, pal: Palette): Built {
  const m = mats(pal);
  const P = paramsOf(building);
  const kind = building.kind ?? "house";
  const trade = tradeOf(building);
  const cap = vessFlag(pal.stone!);
  const go = (height: number, draw: Draw, through = false) => styled(building, { cap, height, through }, draw);
  switch (kind) {
    case "manor":
      return go(14, manor(m));
    case "shop":
      return go(8, house(m, building, P.num("floors", 2), trade ?? "general"));
    case "inn":
      return go(8.5, inn(m, building, trade ?? "inn"));
    case "temple":
      return go(11, chapel(m));
    case "guildhall":
      return go(9, hall(m, trade ?? "guild", "guildhall"));
    case "library":
      return go(9.5, hall(m, trade ?? "books", "library"));
    case "smithy":
      return go(5.6, smithy(m, trade ?? "smith"));
    case "tower":
      return go(1.2 + P.num("floors", 3) * 2.2 + 6, tower(m, trade ?? "magic", P.num("floors", 3)));
    case "barn":
    case "warehouse":
      return go(6.4, warehouse(m));
    case "gatehouse":
      return go(8, gatehouse(m), true);
    case "wall":
      return go(3.3, wall(m));
    case "wall-tower":
      return go(9, (b, x0, z0, x1, z1) => {
        squareTower(b, m, x0, z0, x1, z1, 5.2);
        return undefined;
      });
    case "mausoleum":
      return go(5.4, mausoleum(m));
    default:
      return go(9, house(m, building, P.num("floors", 2)));
  }
}

BUILDINGS.define(
  "vess",
  "The Vess estate's style (the Caligo Morass): black stone, steep black slate with iron finials, tall chimneys, gothic lancets lit gold, pointed doors, gargoyles. Kinds: manor (the great house: a towered central block and two forward wings round a court; about 14x9), house, shop, inn (params floors), temple (a chapel with a needle spire), guildhall, library, smithy, tower (floors), warehouse, gatehouse (its passage the middle 2 tiles), wall, wall-tower, mausoleum (the Vess crypts' entrance); params.trade names a sign's emblem, params.doorAt the door",
  vess,
  VESS,
);

showcase("vess", [
  { kind: "manor", w: 14, d: 9 },
  { kind: "house", w: 4, d: 4, label: "cottage", params: { floors: 1 } },
  { kind: "house", w: 6, d: 4 },
  { kind: "shop", w: 6, d: 4, params: { trade: "potions" } },
  { kind: "inn", w: 8, d: 5 },
  { kind: "smithy", w: 6, d: 5 },
  { kind: "temple", w: 6, d: 9 },
  { kind: "guildhall", w: 8, d: 5 },
  { kind: "library", w: 8, d: 6 },
  { kind: "tower", w: 3, d: 3, params: { floors: 3 } },
  { kind: "warehouse", w: 7, d: 5 },
  { kind: "mausoleum", w: 4, d: 5 },
  { kind: "gatehouse", w: 6, d: 3 },
  { kind: "wall-tower", w: 3, d: 3 },
  { kind: "wall", w: 6, d: 1 },
]);

