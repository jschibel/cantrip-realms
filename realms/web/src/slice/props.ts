import * as THREE from "three";
import * as C from "./colors";
import { type BoxFaces, type Face, type Material, MeshBuilder, fitted, sides, tiled } from "./geometry";
import { flat, material, surfaces } from "./kit";
import * as P from "./pictures";
import { Pixmap } from "./pixmap";
import * as T from "./textures";

// The things scenes are furnished with, built by code from boxes, roofs, cylinders and blobs on a MeshBuilder: Benalish
// houses (a limestone ground floor, a timber-framed upper floor, a tiled roof with a ridge and a chimney), doors,
// windows with shutters and flower boxes, banners, the shop's sign, lamps, trees and bushes, barrels, crates and sacks,
// a fountain, a market stall, a crypt's mausoleum, gravestones and railings. Units are tiles; one texel is 1/16.

export const PX = 1 / 16;

// --- Materials of pictures ------------------------------------------------------------------------------------------

export const pics = {
  door: () => material("door", () => P.door(1)),
  shopDoor: () => material("shop-door", () => P.door(2, C.GREEN.concat([0x48b058, 0x78d080]))),
  window: () => material("window", () => P.windowPicture(false)),
  windowLit: () => material("window-lit", () => P.windowPicture(true), { glow: 0.55 }),
  shutter: () => material("shutter", () => P.shutter(C.TEAL)),
  shutterBlue: () => material("shutter-blue", () => P.shutter(C.BLUE)),
  sign: () => material("sign", () => P.goblinSign()),
  display: () => material("display", () => P.displayWindow()),
  banner: () => material("banner", () => P.banner(), { cutout: true, twoSided: true }),
  crate: (n = 16) => material(`crate-${n}`, () => P.crateSide(n)),
  barrelSide: (h = 13) => material(`barrel-side-${h}`, () => P.barrelSide(30, h), { smooth: true }),
  barrelTop: () => material("barrel-top", () => P.barrelTop()),
  awning: () => material("awning", () => P.awning(), { twoSided: true }),
  valance: () => material("valance", () => P.valance(), { cutout: true, twoSided: true }),
  produce: (kind: "apples" | "cabbages" | "carrots" | "bread" | "fish", n = 16) => material(`produce-${kind}-${n}`, () => P.produce(kind, n)),
  gravestone: () => material("gravestone", () => P.gravestone(), { cutout: true }),
  cryptGate: () => material("crypt-gate", () => P.cryptGate()),
  water: () => material("water", () => T.water(13)),
  waterfall: () => material("waterfall", () => waterfall(), { cutout: true, twoSided: true }),
  sack: () => material("sack", () => P.sackcloth(), { smooth: true }),
  clay: () => material("clay", () => P.clay(), { smooth: true }),
  flowers: () => material("flowers", () => flowerBed(), { smooth: true }),
};

/** Falling water: streaks of pale blue and white with gaps between them, cut out. */
function waterfall(): Pixmap {
  const p = new Pixmap(32, 16);
  p.fill(0, 0);
  for (let x = 0; x < 32; x++) {
    if (x % 4 !== 1 && x % 7 !== 3) continue;
    for (let y = 0; y < 16; y++) {
      const c = (x * 5 + y) % 9 === 0 ? 0xffffff : (x + y * 3) % 7 === 0 ? C.WATER[6]! : x % 3 === 0 ? C.WATER[5]! : C.WATER[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Leaves sprinkled with flowers, for flower boxes and beds. */
function flowerBed(): Pixmap {
  const p = T.leaves(31, C.LEAF);
  const colors = [C.RED[4]!, C.GOLD[4]!, 0xffffff, C.PINK[3]!, C.BLUE[5]!];
  for (let k = 0; k < 26; k++) {
    const x = (k * 13 + 5) % 32;
    const y = (k * 7 + 3) % 32;
    const c = colors[k % colors.length]!;
    p.set(x, y, c);
    p.set(x + 1, y, c);
    p.set(x, y + 1, c);
    p.set(x + 1, y + 1, C.GOLD[5]!);
  }
  return p;
}

const iron = () => flat(C.IRON[2]!);
const ironLight = () => flat(C.IRON[4]!);
const gold = () => flat(C.GOLD[3]!);

// --- Buildings ------------------------------------------------------------------------------------------------------

export interface Opening {
  /** Centre along the front, in tiles from the building's west end. */
  readonly at: number;
  readonly kind: "door" | "shopDoor" | "window" | "display" | "banner" | "sign" | "windowUp" | "bannerUp" | "lamp";
}

export interface HouseSpec {
  readonly x0: number;
  readonly x1: number;
  /** North (back) and south (front) wall planes. */
  readonly z0: number;
  readonly z1: number;
  /** Ground floor's height, and the timber-framed upper floor's (0: none). */
  readonly ground: number;
  readonly upper: number;
  readonly roof: "tile" | "slate";
  readonly rise: number;
  readonly openings: readonly Opening[];
  readonly chimney?: number;
  /** The ground floor's walls: limestone ashlar, or whitewash. */
  readonly wall?: "limestone" | "plaster";
}

/** A Benalish house: plinth, ashlar or whitewashed ground floor with quoins, a timber-framed upper floor, a tiled roof. */
export function house(b: MeshBuilder, h: HouseSpec): void {
  const { x0, x1, z0, z1, ground, upper } = h;
  const top = ground + upper;
  const lime = tiled(surfaces.limestone());
  const plaster = tiled(surfaces.plaster());
  const timber = tiled(surfaces.darkTimber());
  const wall = h.wall === "plaster" ? plaster : lime;
  // The plinth: a course of darker stone, a texel proud of the wall.
  b.box(x0 - PX, 0, z0 - PX, x1 + PX, 0.25, z1 + PX, sides(tiled(surfaces.cobbleWall())));
  b.box(x0, 0.25, z0, x1, ground, z1, sides(wall));
  // Quoins at the corners of the ground floor.
  if (h.wall !== "limestone") {
    for (const x of [x0 - PX, x1 - 0.25 + PX]) {
      for (let y = 0.25; y < ground - 0.1; y += 0.5) {
        const long = Math.round(y * 2) % 2 === 0;
        b.box(x - (x === x0 - PX && long ? 0.12 : 0), y, z1 - 0.4, x + 0.25 + PX + (x !== x0 - PX && long ? 0.12 : 0), y + 0.44, z1 + PX, sides(lime));
      }
    }
  }
  if (upper > 0) {
    // The jetty: a beam across the front, and the upper floor a texel or two over the lower.
    b.box(x0 - 0.12, ground, z0 - 0.06, x1 + 0.12, ground + 0.25, z1 + 0.14, sides(timber));
    b.box(x0 - 0.06, ground + 0.25, z0, x1 + 0.06, top, z1 + 0.08, sides(plaster));
    // Timber framing on the front and ends: posts, a rail, braces.
    const zf = z1 + 0.08;
    const posts: number[] = [];
    for (let x = x0 - 0.06; x <= x1 + 0.07; x += (x1 - x0 + 0.12) / Math.max(2, Math.round((x1 - x0) / 1.5))) posts.push(x);
    for (const x of posts) b.box(Math.min(x, x1 + 0.06 - 0.19), ground + 0.25, zf - 0.02, Math.min(x, x1 + 0.06 - 0.19) + 0.19, top, zf + 0.06, sides(timber));
    b.box(x0 - 0.06, top - 0.19, zf - 0.02, x1 + 0.06, top, zf + 0.06, sides(timber));
    for (const z of [z0 + 0.06, z1]) {
      b.box(x0 - 0.12, ground + 0.25, z, x0 - 0.04, top, z + 0.19, sides(timber));
      b.box(x1 + 0.04, ground + 0.25, z, x1 + 0.12, top, z + 0.19, sides(timber));
    }
  }
  // The roof: tiles on the slopes, a ridge, bargeboards along the gables.
  const overhang = 0.3;
  const roofMat = h.roof === "slate" ? surfaces.slate() : surfaces.roof();
  b.gableRoof(x0 - overhang, z0 - overhang, x1 + overhang, z1 + overhang, top, h.rise, roofMat, plaster, 0.12);
  const zm = (z0 + z1) / 2;
  b.box(x0 - overhang - 0.04, top + h.rise - 0.1, zm - 0.1, x1 + overhang + 0.04, top + h.rise + 0.1, zm + 0.1, sides(tiled(h.roof === "slate" ? surfaces.darkTimber() : surfaces.timber())));
  if (h.chimney !== undefined) {
    const cx = x0 + h.chimney;
    b.box(cx - 0.3, top, zm - 0.6, cx + 0.3, top + h.rise + 0.8, zm - 0.05, sides(lime));
    b.box(cx - 0.36, top + h.rise + 0.8, zm - 0.66, cx + 0.36, top + h.rise + 0.95, zm + 0.01, sides(tiled(surfaces.cobbleWall())));
  }

  for (const o of h.openings) {
    const x = x0 + o.at;
    const zf = z1;
    switch (o.kind) {
      case "door":
      case "shopDoor":
        doorway(b, x, zf, o.kind === "shopDoor" ? pics.shopDoor() : pics.door());
        break;
      case "window":
        windowAt(b, x, 0.9, zf);
        break;
      case "windowUp":
        windowAt(b, x, ground + 0.45, zf + 0.08, true);
        break;
      case "display":
        displayAt(b, x, zf);
        break;
      case "banner":
        bannerAt(b, x, ground - 0.15, zf);
        break;
      case "bannerUp":
        bannerAt(b, x, top - 0.1, zf + 0.08);
        break;
      case "sign":
        signAt(b, x, ground + 0.05, zf);
        break;
      case "lamp":
        wallLamp(b, x, 1.9, zf);
        break;
    }
  }
}

/** A door in its arched surround, with a stone step before it. */
export function doorway(b: MeshBuilder, x: number, z: number, mat: Material): void {
  b.card(fitted(mat), x - 0.625, 0.25, x + 0.625, 2.25, z + 0.01);
  b.box(x - 0.7, 0, z, x + 0.7, 0.12, z + 0.3, sides(tiled(surfaces.flagstone())));
}

/** A window with its shutters open and a box of flowers under it. */
export function windowAt(b: MeshBuilder, x: number, y: number, z: number, flowers = false): void {
  b.card(fitted(pics.window()), x - 0.5, y, x + 0.5, y + 1.125, z + 0.01);
  const shutter = fitted(pics.shutter());
  b.card(shutter, x - 0.5 - 0.38, y + 0.12, x - 0.5, y + 1.0, z + 0.02);
  b.card(shutter, x + 0.5, y + 0.12, x + 0.5 + 0.38, y + 1.0, z + 0.02);
  if (flowers) {
    b.box(x - 0.55, y - 0.2, z, x + 0.55, y + 0.05, z + 0.28, sides(tiled(surfaces.timber())));
    b.blob(x - 0.25, y + 0.1, z + 0.14, 0.32, 0.18, 0.16, pics.flowers());
    b.blob(x + 0.25, y + 0.12, z + 0.14, 0.32, 0.2, 0.16, pics.flowers());
  }
}

/** The shop's display window, under a little striped awning. */
export function displayAt(b: MeshBuilder, x: number, z: number): void {
  b.card(fitted(pics.display()), x - 1, 0.45, x + 1, 1.95, z + 0.01);
  b.box(x - 1.06, 0.3, z, x + 1.06, 0.45, z + 0.2, sides(tiled(surfaces.timber())));
  // The awning: a sloped striped cloth on two iron arms, its scalloped edge hanging.
  const y = 2.25;
  b.quad({ mat: pics.awning() }, [
    [x - 1.1, y - 0.35, z + 0.7],
    [x + 1.1, y - 0.35, z + 0.7],
    [x + 1.1, y, z],
    [x - 1.1, y, z],
  ], (c) => c[0], (c) => -c[2] + c[1]);
  b.card({ mat: pics.valance(), offset: [0, -(y - 0.72) * 16] }, x - 1.1, y - 0.72, x + 1.1, y - 0.345, z + 0.7);
}

/** A banner on an iron rod from the wall. */
export function bannerAt(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.45, y - 0.05, z, x + 0.45, y + 0.02, z + 0.12, sides(iron()));
  b.box(x - 0.5, y - 0.07, z + 0.08, x - 0.42, y + 0.04, z + 0.14, sides(gold()));
  b.box(x + 0.42, y - 0.07, z + 0.08, x + 0.5, y + 0.04, z + 0.14, sides(gold()));
  b.card(fitted(pics.banner()), x - 0.375, y - 2, x + 0.375, y - 0.02, z + 0.1);
}

/** The shop's hanging sign: an iron bracket out from the wall, the board on two chains facing the street. */
export function signAt(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.04, y + 0.62, z, x + 0.04, y + 0.7, z + 0.75, sides(iron()));
  b.box(x - 0.04, y + 0.2, z, x + 0.04, y + 0.7, z + 0.06, sides(iron()));
  // A scroll of iron under the arm.
  b.box(x - 0.03, y + 0.45, z + 0.05, x + 0.03, y + 0.5, z + 0.45, sides(iron()));
  b.box(x - 0.5, y - 0.3, z + 0.55, x + 0.5, y + 0.575, z + 0.62, {
    south: fitted(pics.sign()),
    north: fitted(pics.sign()),
    east: tiled(surfaces.timber()),
    west: tiled(surfaces.timber()),
    top: tiled(surfaces.timber()),
  });
  for (const cx of [x - 0.35, x + 0.35]) b.box(cx - 0.02, y + 0.575, z + 0.57, cx + 0.02, y + 0.62, z + 0.6, sides(ironLight()));
}

/** A lantern on a bracket on the wall. */
export function wallLamp(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.03, y + 0.3, z, x + 0.03, y + 0.36, z + 0.35, sides(iron()));
  lantern(b, x, y - 0.1, z + 0.3);
}

const lanternGlass = () => material("lantern-glass", () => new Pixmap(4, 4, C.GOLD[4]!), { glowing: true });

/** A lantern: an iron cage round warm glass, a cap and a ring. */
export function lantern(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.13, y, z - 0.13, x + 0.13, y + 0.32, z + 0.13, sides(fitted(lanternGlass())));
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    b.box(x + dx * 0.13 - 0.025, y, z + dz * 0.13 - 0.025, x + dx * 0.13 + 0.025, y + 0.32, z + dz * 0.13 + 0.025, sides(iron()));
  b.box(x - 0.18, y + 0.32, z - 0.18, x + 0.18, y + 0.4, z + 0.18, sides(iron()));
  b.box(x - 0.1, y + 0.4, z - 0.1, x + 0.1, y + 0.47, z + 0.1, sides(iron()));
  b.box(x - 0.15, y - 0.05, z - 0.15, x + 0.15, y, z + 0.15, sides(iron()));
}

/** A street lamp: a post on a stone foot, a crossarm and a lantern. */
export function lampPost(b: MeshBuilder, x: number, z: number): void {
  b.box(x - 0.18, 0, z - 0.18, x + 0.18, 0.2, z + 0.18, sides(tiled(surfaces.limestone())));
  b.cylinder(x, z, 0.2, 2.2, 0.06, 6, { mat: iron() });
  b.box(x - 0.1, 2.15, z - 0.1, x + 0.1, 2.25, z + 0.1, sides(iron()));
  lantern(b, x, 2.25, z);
}

// --- Nature ---------------------------------------------------------------------------------------------------------

/** A broadleaf tree: a trunk and a crown of a few rounded clumps. */
export function tree(b: MeshBuilder, x: number, z: number, size = 1, seed = 0): void {
  b.cylinder(x, z, 0, 1.3 * size, 0.18 * size, 7, { mat: surfaces.bark() });
  b.cylinder(x, z, 0, 0.2, 0.26 * size, 7, { mat: surfaces.bark() });
  const s = size;
  const off = (k: number) => ((seed * 7 + k * 13) % 10) / 10 - 0.5;
  b.blob(x, 1.95 * s, z, 1.05 * s, 0.85 * s, 1.0 * s, surfaces.leaves(), [seed * 5, 0]);
  b.blob(x - 0.6 * s, 1.55 * s + off(1) * 0.2, z + 0.25 * s, 0.7 * s, 0.6 * s, 0.7 * s, surfaces.leaves(), [seed * 3, 7]);
  b.blob(x + 0.62 * s, 1.6 * s + off(2) * 0.2, z + 0.15 * s, 0.68 * s, 0.6 * s, 0.68 * s, surfaces.leaves(), [11, seed]);
  b.blob(x + 0.1 * s, 2.55 * s, z - 0.15 * s, 0.68 * s, 0.55 * s, 0.68 * s, surfaces.leaves(), [5, 3 + seed]);
}

/** A round bush. */
export function bush(b: MeshBuilder, x: number, z: number, r = 0.45, flowering = false): void {
  b.blob(x, r * 0.8, z, r, r * 0.85, r, flowering ? pics.flowers() : surfaces.leaves(), [x * 16, z * 16]);
}

// --- Goods ----------------------------------------------------------------------------------------------------------

export function barrel(b: MeshBuilder, x: number, z: number, h = 0.8): void {
  // Staves once round a 0.3 radius are 30 texels; the picture is as tall as the barrel.
  b.cylinder(x, z, 0, h, 0.3, 10, fitted(pics.barrelSide(Math.round(h * 16))), fitted(pics.barrelTop()), 0.12, 3);
}

/** A crate, its edges rounded a texel, with produce heaped in it (or its lid on). */
export function crate(b: MeshBuilder, x: number, z: number, size = 0.75, goods?: "apples" | "cabbages" | "carrots" | "bread" | "fish", y = 0, turn = 0): void {
  b.at(x, y, z, turn, () => {
    const s = size / 2;
    const n = Math.round(size * 16);
    const side = fitted(pics.crate(n));
    b.roundedBox(-s, 0, -s, s, size, s, PX, { south: side, north: side, east: side, west: side, top: goods ? fitted(pics.produce(goods, n)) : side });
    if (goods) b.blob(0, size, 0, s * 0.85, 0.12, s * 0.85, pics.produce(goods, n), [0, 0]);
  });
}

export function sack(b: MeshBuilder, x: number, z: number): void {
  b.blob(x, 0.3, z, 0.28, 0.32, 0.24, pics.sack());
  b.blob(x, 0.66, z, 0.12, 0.08, 0.1, pics.sack());
}

export function pot(b: MeshBuilder, x: number, z: number, y = 0, r = 0.2): void {
  b.cylinder(x, z, y, y + r * 1.6, r, 8, fitted(pics.clay()), undefined, 0.35, 3);
  b.cylinder(x, z, y + r * 1.6, y + r * 1.85, r * 0.7, 8, fitted(pics.clay()), fitted(material("pot-dark", () => new Pixmap(4, 4, C.DIRT[0]!))));
}

// --- The street's set pieces ----------------------------------------------------------------------------------------

/**
 * A tiered fountain: an octagonal basin, a pillar and a bowl, and water falling from it. Returns the water's material,
 * which the scene slides along a texel at a time.
 */
export function fountain(b: MeshBuilder, x: number, z: number): Material {
  const water = pics.water();
  const stone = surfaces.limestone();
  // The basin: a low octagonal wall with a broad rim, and water within.
  b.cylinder(x, z, 0, 0.5, 1.8, 8, { mat: stone }, undefined, 0, 1, 6);
  b.cylinder(x, z, 0.5, 0.64, 1.9, 8, { mat: surfaces.flagstone() }, undefined, 0, 1, 6);
  b.ring(x, z, 0.64, 1.5, 1.9, 8, surfaces.flagstone());
  b.cylinder(x, z, 0.4, 0.64, 1.5, 8, { mat: stone }, undefined, 0, 1, 5);
  b.cylinder(x, z, 0.0, 0.44, 1.49, 8, { mat: water }, fitted(water));
  // The pillar and the upper bowl, water brimming in it and spilling in streams.
  b.cylinder(x, z, 0.44, 1.55, 0.26, 8, { mat: stone }, undefined, 0, 1, 2);
  b.cylinder(x, z, 1.55, 1.85, 0.85, 8, { mat: surfaces.flagstone() }, undefined, -0.3, 1, 3);
  b.ring(x, z, 1.85, 0.7, 0.85, 8, surfaces.flagstone());
  b.cylinder(x, z, 1.6, 1.8, 0.7, 8, { mat: water }, fitted(water));
  b.cylinder(x, z, 0.46, 1.84, 0.88, 8, { mat: pics.waterfall() }, undefined, 0, 1, 4);
  // A finial: a gilded sun of Benalia over the bowl, a jet rising from it.
  b.cylinder(x, z, 1.8, 2.25, 0.12, 6, { mat: stone });
  b.cylinder(x, z, 2.25, 2.4, 0.22, 8, { mat: gold() }, { mat: gold() });
  b.cylinder(x, z, 2.4, 2.9, 0.05, 6, { mat: pics.waterfall() });
  return water;
}

/** A market stall: a counter of crates and produce under a striped awning on four posts. */
export function stall(b: MeshBuilder, x0: number, z: number, width: number): void {
  const x1 = x0 + width;
  const post = sides(tiled(surfaces.timber()));
  for (const x of [x0 + 0.05, x1 - 0.15]) {
    b.box(x, 0, z - 0.95, x + 0.1, 2.0, z - 0.85, post);
    b.box(x, 0, z + 0.15, x + 0.1, 2.4, z + 0.25, post);
  }
  b.box(x0, 0, z - 0.35, x1, 0.85, z + 0.3, {
    south: tiled(material("counter", () => P.counterFront())),
    east: tiled(surfaces.timber()),
    west: tiled(surfaces.timber()),
    north: tiled(surfaces.timber()),
    top: tiled(surfaces.boards()),
  });
  const goods = ["apples", "cabbages", "carrots", "bread", "fish"] as const;
  for (let i = 0; i < Math.floor(width / 0.8); i++) crate(b, x0 + 0.45 + i * 0.8, z - 0.02, 0.6, goods[i % goods.length], 0.85, (i % 2) * 0.06 - 0.03);
  b.quad({ mat: pics.awning() }, [
    [x0 - 0.2, 2.15, z + 0.55],
    [x1 + 0.2, 2.15, z + 0.55],
    [x1 + 0.2, 2.55, z - 1.0],
    [x0 - 0.2, 2.55, z - 1.0],
  ], (c) => c[0], (c) => -c[2] + c[1]);
  b.card({ mat: pics.valance(), offset: [0, -1.775 * 16] }, x0 - 0.2, 1.775, x1 + 0.2, 2.15, z + 0.55);
}

/** A mausoleum: a dark stone house of the dead with pillars, a pediment and an iron gate - the way into the crypt. */
export function mausoleum(b: MeshBuilder, x0: number, x1: number, z0: number, z1: number): void {
  const stone = tiled(material("mausoleum-stone", () => T.ashlar(C.COBBLE, 41, 8, 10, 16)));
  b.box(x0 - 0.1, 0, z0 - 0.1, x1 + 0.1, 0.3, z1 + 0.6, sides(stone));
  b.box(x0, 0.3, z0, x1, 2.6, z1, sides(stone));
  const xm = (x0 + x1) / 2;
  // Steps up to the gate.
  b.box(xm - 0.9, 0, z1 + 0.6, xm + 0.9, 0.15, z1 + 0.95, sides(stone));
  // Pillars either side of the gate.
  for (const x of [xm - 1.2, xm + 1.2]) {
    b.box(x - 0.28, 0.3, z1 + 0.05, x + 0.28, 0.5, z1 + 0.55, sides(stone));
    b.cylinder(x, z1 + 0.3, 0.5, 2.5, 0.18, 8, { mat: surfaces.limestone() }, undefined, 0, 1, 2);
    b.box(x - 0.28, 2.5, z1 + 0.05, x + 0.28, 2.7, z1 + 0.55, sides(stone));
  }
  b.box(xm - 1.6, 2.6, z1, xm + 1.6, 2.9, z1 + 0.6, sides(stone));
  b.card(fitted(pics.cryptGate()), xm - 0.625, 0.3, xm + 0.625, 2.175, z1 + 0.01);
  b.gableRoof(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.7, 2.9, 1.0, surfaces.slate(), stone);
  // A carved skull over the gate.
  b.card(fitted(material("skull-relief", () => P.skull(), { cutout: true })), xm - 5 / 32, 2.3, xm + 5 / 32, 2.3 + 5 / 16, z1 + 0.02);
}

export function gravestone(b: MeshBuilder, x: number, z: number, turn = 0): void {
  b.at(x, 0, z, turn, () => {
    const face = fitted(pics.gravestone());
    b.box(-0.375, 0, -0.06, 0.375, 1.0, 0.06, { south: face, north: face });
    b.box(-0.34, 0, -0.06, 0.34, 0.68, 0.06, sides(tiled(surfaces.cobbleWall())));
    b.box(-0.35, 0, -0.15, 0.35, 0.08, 0.2, sides(tiled(surfaces.cobbleWall())));
  });
}

/** Iron railings along a line, with spear-point finials. */
export function railings(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number): void {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.round(length / 0.25);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    b.box(x - 0.025, 0, z - 0.025, x + 0.025, 1.0, z + 0.025, sides(iron()));
    b.box(x - 0.04, 1.0, z - 0.04, x + 0.04, 1.08, z + 0.04, sides(gold()));
  }
  const dx = (x1 - x0) / length;
  const dz = (z1 - z0) / length;
  for (const y of [0.15, 0.85]) {
    b.box(Math.min(x0, x1) - 0.03 * Math.abs(dz), y, Math.min(z0, z1) - 0.03 * Math.abs(dx), Math.max(x0, x1) + 0.03 * Math.abs(dz), y + 0.06, Math.max(z0, z1) + 0.03 * Math.abs(dx), sides(iron()));
  }
}

/** A low wall of fieldstone with a hedge along its top. */
export function hedgeWall(b: MeshBuilder, x0: number, x1: number, z: number): void {
  b.box(x0, 0, z - 0.3, x1, 0.5, z + 0.3, sides(tiled(surfaces.cobbleWall()), tiled(surfaces.limestone())));
  for (let x = x0 + 0.4; x < x1; x += 0.7) b.blob(x, 0.75, z, 0.45, 0.4, 0.38, surfaces.leaves(), [x * 16, 0]);
}

/** A bench of planks on stone feet. */
export function bench(b: MeshBuilder, x: number, z: number, width = 1.6): void {
  const stone = sides(tiled(surfaces.limestone()));
  b.box(x - width / 2 + 0.1, 0, z - 0.18, x - width / 2 + 0.3, 0.38, z + 0.18, stone);
  b.box(x + width / 2 - 0.3, 0, z - 0.18, x + width / 2 - 0.1, 0.38, z + 0.18, stone);
  b.box(x - width / 2, 0.38, z - 0.22, x + width / 2, 0.48, z + 0.22, sides(tiled(surfaces.timber()), tiled(surfaces.boards())));
}

export function box(b: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: BoxFaces | Face): void {
  b.box(x0, y0, z0, x1, y1, z1, "mat" in faces ? sides(faces) : faces);
}

/** A soft, round shadow on the ground under a figure: drawn darker, never outlined. */
export function blobShadow(radius: number): THREE.Mesh {
  // Multiplied over the ground: white leaves it be, the violet-grey darkens it.
  const p = new Pixmap(16, 16, 0xffffff);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.hypot((x - 7.5) / 7.5, (y - 7.5) / 7.5) <= 1) p.set(x, y, 0x8a84a8);
  const tex = new THREE.DataTexture(p.data, 16, 16);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false });
  mat.userData.skipNormal = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), mat);
  mesh.position.y = 0.01;
  mesh.renderOrder = 1;
  return mesh;
}

// --- Open country ---------------------------------------------------------------------------------------------------

const rockMat = () => material("rock", () => T.rock(18), { smooth: true });

/**
 * The town's wall, running north-south along x (its outer face west), with a gate over the road between g0 and g1:
 * limestone ashlar, a parapet with merlons on both faces, square towers either side of the gate and a lintel over it.
 */
export function townWall(
  b: MeshBuilder,
  x: number,
  z0: number,
  z1: number,
  g0: number,
  g1: number,
  /** The tower south of the gate and the lintel, which stand in front of the gateway from the south: built full and cut down. */
  southFull: MeshBuilder,
  southLow: MeshBuilder,
): void {
  const lime = tiled(surfaces.limestone());
  const top = tiled(surfaces.flagstone());
  const t = 0.75;
  const h = 2.25;
  const run = (za: number, zb: number) => {
    if (zb - za <= 0) return;
    b.box(x - t, 0, za, x, h, zb, sides(lime, top));
    for (let z = za; z < zb - 0.1; z += 0.5) {
      b.box(x - t, h, z, x - t + 0.19, h + 0.31, Math.min(z + 0.25, zb), sides(lime));
      b.box(x - 0.19, h, z, x, h + 0.31, Math.min(z + 0.25, zb), sides(lime));
    }
  };
  run(z0, g0 - 1);
  run(g1 + 1, z1);
  // The gatehouse: a square tower either side, proud of the wall both ways, roofed in slate, with arrow slits and a
  // banner on the faces that look south; a lintel across, high enough to walk under.
  const slit = fitted(material("arrow-slit", () => {
    const p = new Pixmap(4, 12, C.INK);
    p.vline(0, 0, 12, C.LIMESTONE[2]!);
    return p;
  }));
  for (const [za, zb] of [
    [g0 - 2, g0],
    [g1, g1 + 2],
  ] as const) {
    const xa = x - t - 0.5;
    const xb = x + 0.5;
    const south = za >= g1;
    const tb = south ? southFull : b;
    tb.box(xa, 0, za, xb, 4.0, zb, sides(lime, top));
    for (let mx = xa; mx < xb - 0.1; mx += 0.5) {
      tb.box(mx, 4.0, zb - 0.25, mx + 0.25, 4.375, zb, sides(lime));
      tb.box(mx, 4.0, za, mx + 0.25, 4.375, za + 0.25, sides(lime));
    }
    tb.gableRoof(xa - 0.15, za - 0.15, xb + 0.15, zb + 0.15, 4.375, 1.2, surfaces.slate(), lime);
    tb.card(slit, (xa + xb) / 2 - 0.125, 2.6, (xa + xb) / 2 + 0.125, 3.35, zb + 0.01);
    if (south) {
      bannerAt(tb, (xa + xb) / 2, 2.3, zb);
      // Cut down to the wall's height, its top showing: what stands there while someone is in the gateway.
      southLow.box(xa, 0, za, xb, 1.0, zb, sides(lime, top));
    }
  }
  // The lintel goes with the south tower: from the south it too stands over whoever is in the gateway.
  southFull.box(x - t - 0.12, 2.5, g0, x + 0.12, 3.25, g1, sides(lime, top));
  for (let z = g0; z < g1 - 0.1; z += 0.5) southFull.box(x - t - 0.12, 3.25, z, x - t + 0.07, 3.56, z + 0.25, sides(lime));
}

/** A stone bridge over a stream: a deck at `y`, its arch's face to the water, a low parapet along each side. */
export function bridge(b: MeshBuilder, x0: number, x1: number, z0: number, z1: number, y: number): void {
  const stone = tiled(material("bridge-stone", () => T.ashlar(C.LIMESTONE, 51, 6, 8, 12)));
  const deck = tiled(surfaces.flagstone());
  b.box(x0, -0.2, z0, x1, y, z1, { top: deck, south: stone, north: stone, east: stone, west: stone });
  for (const [za, zb] of [
    [z0, z0 + 0.25],
    [z1 - 0.25, z1],
  ] as const) {
    b.box(x0, y, za, x1, y + 0.5, zb, sides(stone));
    b.box(x0 - 0.06, y + 0.5, za - 0.03, x1 + 0.06, y + 0.6, zb + 0.03, sides(deck));
  }
}

/** A boulder: a squashed lump of rock, with a smaller one at its foot. */
export function boulder(b: MeshBuilder, x: number, z: number, r = 0.5, seed = 0): void {
  const s = ((seed * 37) % 10) / 10;
  b.blob(x, r * 0.55, z, r, r * 0.75, r * (0.8 + s * 0.3), rockMat(), [seed * 7, seed * 3]);
  b.blob(x + r * 0.8, r * 0.25, z + r * 0.4, r * 0.4, r * 0.32, r * 0.35, rockMat(), [seed * 3, seed * 5]);
}

/** A flat stepping stone in a stream. */
export function steppingStone(b: MeshBuilder, x: number, z: number): void {
  b.blob(x, 0.0, z, 0.36, 0.14, 0.3, rockMat(), [x * 16, z * 16]);
}

/** A raised terrace of turf with an earthen bank round it: a tier of a rise. */
export function terrace(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number): void {
  b.box(x0, 0, z0, x1, y, z1, { top: tiled(material("turf", () => T.grass(5))), south: tiled(rockMat()), north: tiled(rockMat()), east: tiled(rockMat()), west: tiled(rockMat()) });
}

/**
 * A ruined round tower on a rise: a ring of ashlar broken off at heights from `low` to `high`, one side fallen to a
 * gap, its inside seen from above, and fallen blocks round its foot.
 */
export function ruinedTower(b: MeshBuilder, cx: number, cz: number, y0: number, r: number, low: number, high: number): void {
  const mat = material("tower-stone", () => T.ashlar(C.LIMESTONE, 61, 6, 7, 11));
  const image = mat.map!.image as { width: number; height: number };
  const tw = image.width / 16;
  const th = image.height / 16;
  const n = 20;
  const thick = 0.5;
  for (let i = 0; i < n; i++) {
    // A breach to the south-east, and a jagged top elsewhere.
    if (i >= 3 && i <= 5) continue;
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const f = Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6));
    const h = y0 + low + (high - low) * (i > 12 ? f : f * 0.55);
    const at = (a: number, rr: number, y: number): [number, number, number] => [cx + Math.sin(a) * rr, y, cz + Math.cos(a) * rr];
    const arc0 = a0 * r;
    const arc1 = a1 * r;
    const uv = (arc: number, y: number): [number, number] => [arc / tw, y / th];
    b.polygon(mat, [at(a0, r, y0), at(a1, r, y0), at(a1, r, h), at(a0, r, h)], [uv(arc0, y0), uv(arc1, y0), uv(arc1, h), uv(arc0, h)]);
    b.polygon(mat, [at(a1, r - thick, y0), at(a0, r - thick, y0), at(a0, r - thick, h), at(a1, r - thick, h)], [uv(arc1, y0), uv(arc0, y0), uv(arc0, h), uv(arc1, h)]);
    b.polygon(mat, [at(a0, r, h), at(a1, r, h), at(a1, r - thick, h), at(a0, r - thick, h)], [uv(arc0, 0), uv(arc1, 0), uv(arc1, thick), uv(arc0, thick)]);
    // The ends of the wall at the breach.
    if (i === 2 || i === 6) {
      const a = i === 2 ? a1 : a0;
      b.polygon(mat, [at(a, r, y0), at(a, r - thick, y0), at(a, r - thick, h), at(a, r, h)], [uv(0, y0), uv(thick, y0), uv(thick, h), uv(0, h)]);
    }
  }
  // Fallen blocks.
  const fallen = fitted(mat, [0, 0, 8, 6]);
  for (const [dx, dz, s, turn] of [
    [r + 0.6, 0.8, 0.45, 0.3],
    [r + 1.1, 1.6, 0.35, 1.1],
    [0.8, r + 0.9, 0.4, 0.7],
    [-r - 0.5, -0.4, 0.3, 0.2],
  ] as const) {
    b.at(cx + dx, y0, cz + dz, turn, () => b.roundedBox(-s, 0, -s * 0.7, s, s * 0.9, s * 0.7, 1 / 16, sides(fallen)));
  }
}

/** A hedgerow along a line: a low bank of turf and stones, bushes all along it. */
export function hedgeRow(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, seed = 0): void {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(length / 0.7));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wobble = Math.sin((i + seed) * 1.9) * 0.12;
    const x = x0 + (x1 - x0) * t + (z1 !== z0 ? wobble : 0);
    const z = z0 + (z1 - z0) * t + (x1 !== x0 ? wobble : 0);
    const r = 0.42 + 0.1 * Math.abs(Math.sin((i + seed) * 2.3));
    b.blob(x, r * 0.85, z, r, r * 0.8, r, i % 7 === 3 ? pics.flowers() : surfaces.leaves(), [x * 16, z * 16]);
  }
}

/** Water lying a little below the ground, seen through the ground's holes: a stream. */
export const streamMaterial = () => material("stream", () => T.water(13), { flat: true });

export function waterSurface(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number): void {
  b.quad({ mat: streamMaterial() }, [[x0, -0.12, z1], [x1, -0.12, z1], [x1, -0.12, z0], [x0, -0.12, z0]], (c) => c[0], (c) => -c[2]);
}
