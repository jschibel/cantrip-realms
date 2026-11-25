import type { BuildingData, XYZ } from "../../world/format";
import { type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import { Pixmap, hash2 } from "../paint/pixmap";
import * as P from "../paint/pictures";
import * as T from "../paint/textures";
import { PX, bannerAt, barrel, crate, gold, iron, ironLight, pics, wallLamp } from "../props/draw";
import type { Built } from "../recipe";
import { coneRoof, door as doorCard, doorMaterial, hangingSign, hipRoof, merlons, params as paramsOf, plaque, shedRoof, sideWindow, signMaterial, styled, type Trade, tradeOf, windowMaterial, windowSpots } from "./kit";
import { BUILDINGS, showcase } from "./registry";

// Benalia's style: houses of limestone ashlar or whitewash on a darker plinth, timber-framed upper floors jettied over
// the street, red tile or slate roofs with a ridge and a chimney, shuttered windows with flower boxes, blue-and-gold
// banners; a shop's display windows under a striped awning and its hanging sign; and in the churchyard a mausoleum of
// dark stone, pillared, with an iron gate.
//
// The style's recipe (`benalish`, end of file) draws a building by its `kind`: `house` (the default) and `shop` from
// `params` (HouseSpec less its footprint), `mausoleum` from its footprint alone.

const BENALISH: Palette = { stone: C.LIMESTONE, plaster: C.PLASTER, roof: C.ROOF, timber: C.WOOD, darkTimber: C.DARKWOOD };

export interface Opening {
  /** Centre along the front, in tiles from the building's west end. */
  readonly at: number;
  readonly kind: "door" | "shopDoor" | "window" | "display" | "banner" | "sign" | "windowUp" | "bannerUp" | "lamp";
}

export interface HouseSpec {
  /** West and east ends. */
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
export function house(b: MeshBuilder, h: HouseSpec, pal: Palette = BENALISH): void {
  const { x0, x1, z0, z1, ground, upper } = h;
  const top = ground + upper;
  const lime = tiled(stock.limestone(pal.stone));
  const plaster = tiled(stock.plaster(pal.plaster));
  const timber = tiled(stock.darkTimber(pal.darkTimber));
  const wall = h.wall === "plaster" ? plaster : lime;
  // The plinth: a course of darker stone, a texel proud of the wall.
  b.box(x0 - PX, 0, z0 - PX, x1 + PX, 0.25, z1 + PX, sides(tiled(stock.cobbleWall())));
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
  const roofMat = h.roof === "slate" ? stock.slate() : stock.roof(pal.roof);
  // The eaves hang below the walls' top - by 0.12 at most, and only so far that each slope still clears, by a texel, the
  // outermost of the walls standing to that top: the front's rail, 0.16 in from the eave (else a deep house's shallow
  // slope cuts under the rail and its top shows through the tiles as a line along the eave).
  const run = (z1 - z0) / 2 + overhang;
  const inset = overhang - 0.14;
  const eaveDrop = Math.max(0, Math.min(0.12, ((h.rise * inset) / run - PX) / (1 - inset / run)));
  b.gableRoof(x0 - overhang, z0 - overhang, x1 + overhang, z1 + overhang, top, h.rise, roofMat, plaster, eaveDrop);
  const zm = (z0 + z1) / 2;
  b.box(x0 - overhang - 0.04, top + h.rise - 0.1, zm - 0.1, x1 + overhang + 0.04, top + h.rise + 0.1, zm + 0.1, sides(tiled(h.roof === "slate" ? stock.darkTimber(pal.darkTimber) : stock.timber(pal.timber))));
  if (h.chimney !== undefined) {
    const cx = x0 + h.chimney;
    b.box(cx - 0.3, top, zm - 0.6, cx + 0.3, top + h.rise + 0.8, zm - 0.05, sides(lime));
    b.box(cx - 0.36, top + h.rise + 0.8, zm - 0.66, cx + 0.36, top + h.rise + 0.95, zm + 0.01, sides(tiled(stock.cobbleWall())));
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
  b.box(x - 0.7, 0, z, x + 0.7, 0.12, z + 0.3, sides(tiled(stock.flagstone())));
}

/** A window with its shutters open and a box of flowers under it. */
export function windowAt(b: MeshBuilder, x: number, y: number, z: number, flowers = false): void {
  b.card(fitted(pics.window()), x - 0.5, y, x + 0.5, y + 1.125, z + 0.01);
  const shutter = fitted(pics.shutter());
  b.card(shutter, x - 0.5 - 0.38, y + 0.12, x - 0.5, y + 1.0, z + 0.02);
  b.card(shutter, x + 0.5, y + 0.12, x + 0.5 + 0.38, y + 1.0, z + 0.02);
  if (flowers) {
    b.box(x - 0.55, y - 0.2, z, x + 0.55, y + 0.05, z + 0.28, sides(tiled(stock.timber())));
    b.blob(x - 0.25, y + 0.1, z + 0.14, 0.32, 0.18, 0.16, pics.flowers());
    b.blob(x + 0.25, y + 0.12, z + 0.14, 0.32, 0.2, 0.16, pics.flowers());
  }
}

/** The shop's display window, under a little striped awning. */
export function displayAt(b: MeshBuilder, x: number, z: number): void {
  b.card(fitted(pics.display()), x - 1, 0.45, x + 1, 1.95, z + 0.01);
  b.box(x - 1.06, 0.3, z, x + 1.06, 0.45, z + 0.2, sides(tiled(stock.timber())));
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

/** The shop's hanging sign: an iron bracket out from the wall, the board on two chains facing the street. */
export function signAt(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.04, y + 0.62, z, x + 0.04, y + 0.7, z + 0.75, sides(iron()));
  b.box(x - 0.04, y + 0.2, z, x + 0.04, y + 0.7, z + 0.06, sides(iron()));
  // A scroll of iron under the arm.
  b.box(x - 0.03, y + 0.45, z + 0.05, x + 0.03, y + 0.5, z + 0.45, sides(iron()));
  b.box(x - 0.5, y - 0.3, z + 0.55, x + 0.5, y + 0.575, z + 0.62, {
    south: fitted(pics.sign()),
    north: fitted(pics.sign()),
    east: tiled(stock.timber()),
    west: tiled(stock.timber()),
    top: tiled(stock.timber()),
  });
  for (const cx of [x - 0.35, x + 0.35]) b.box(cx - 0.02, y + 0.575, z + 0.57, cx + 0.02, y + 0.62, z + 0.6, sides(ironLight()));
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
    b.cylinder(x, z1 + 0.3, 0.5, 2.5, 0.18, 8, { mat: stock.limestone() }, undefined, 0, 1, 2);
    b.box(x - 0.28, 2.5, z1 + 0.05, x + 0.28, 2.7, z1 + 0.55, sides(stone));
  }
  b.box(xm - 1.6, 2.6, z1, xm + 1.6, 2.9, z1 + 0.6, sides(stone));
  b.card(fitted(pics.cryptGate()), xm - 0.625, 0.3, xm + 0.625, 2.175, z1 + 0.01);
  b.gableRoof(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.7, 2.9, 1.0, stock.slate(), stone);
  // A carved skull over the gate.
  b.card(fitted(material("skull-relief", () => P.skull(), { cutout: true })), xm - 5 / 32, 2.3, xm + 5 / 32, 2.3 + 5 / 16, z1 + 0.02);
}


// --- The style's recipe ----------------------------------------------------------------------------------------------

/** The door a house's front opens at: its first door. */
function doorOf(h: HouseSpec): number | undefined {
  return h.openings.find((o) => o.kind === "door" || o.kind === "shopDoor")?.at;
}

/** A house's openings when its params give none: a door in the middle, windows either side, windows above. */
function autoOpenings(width: number, upper: number, door: "door" | "shopDoor", extra: readonly Opening[] = []): Opening[] {
  const at = Math.round(width) / 2;
  const out: Opening[] = [{ at, kind: door }];
  for (const x of windowSpots(width, at, door === "shopDoor" ? 2.3 : 1.75)) out.push({ at: x, kind: door === "shopDoor" ? "display" : "window" });
  if (upper > 0) for (const x of windowSpots(width, undefined, 1.75)) out.push({ at: x, kind: "windowUp" });
  return [...out, ...extra];
}

/** Windows down a building's sides, so its ends read when the camera swings round. */
function sideWindows(b: MeshBuilder, x0: number, x1: number, z0: number, z1: number, y: number, mat: Material): void {
  for (const z of windowSpots(z1 - z0, undefined, 1.75, 1.0)) {
    sideWindow(b, x1, y, z0 + z, 1, mat);
    sideWindow(b, x0, y, z0 + z, -1, mat);
  }
}

type Draw = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined;

const benalishSign = (trade: Trade) => signMaterial(trade, C.WOOD, C.WOOD, "board");

/** A house (or a shop, a tenement, an inn) from its params, its openings laid out when they are not given. */
function houseOf(building: BuildingData, pal: Palette, fallback: Partial<HouseSpec>, door: "door" | "shopDoor", extra: readonly Opening[] = []): Draw {
  return (b, x0, z0, x1, z1) => {
    const params = (building.params ?? {}) as Partial<Omit<HouseSpec, "x0" | "x1" | "z0" | "z1">>;
    const upper = params.upper ?? fallback.upper ?? 1.7;
    const h: HouseSpec = {
      x0,
      x1,
      z0,
      z1,
      ground: params.ground ?? fallback.ground ?? 2.5,
      upper,
      roof: params.roof ?? fallback.roof ?? "tile",
      rise: params.rise ?? fallback.rise ?? 1.6,
      chimney: params.chimney ?? fallback.chimney,
      wall: params.wall ?? fallback.wall,
      openings: params.openings ?? autoOpenings(x1 - x0, upper, door, extra),
    };
    house(b, h, pal);
    // Windows down the ends, for the camera's turned headings (not on the slice's own houses, which give their openings).
    if (!params.openings) sideWindows(b, x0, x1, z0, z1, h.upper > 0 ? h.ground + 0.45 : 0.9, windowMaterial(C.LIMESTONE, "clear"));
    const trade = tradeOf(building);
    if (trade && building.kind !== "house" && !h.openings.some((o) => o.kind === "sign")) {
      const at = doorOf(h) ?? (x1 - x0) / 2;
      const sx = x0 + Math.min(x1 - x0 - 0.6, at + 1.15);
      hangingSign(b, sx, h.ground + 0.8, z1, benalishSign(trade), tiled(stock.timber(pal.timber)));
    }
    const at = doorOf(h);
    return at === undefined ? undefined : [x0 + at, 1, z1];
  };
}

/** A temple of the Church of Serra: a long nave of limestone, a bell tower at its front under a slate spire, stained glass. */
function temple(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette): XYZ {
  const lime = tiled(stock.limestone(pal.stone));
  const flag = tiled(stock.flagstone(pal.stone));
  const xm = (x0 + x1) / 2;
  const tw = Math.min(3, (x1 - x0) * 0.42);
  const nave = 4.2;
  const front = z1 - 1.2;
  b.box(x0 - PX, 0, z0 - PX, x1 + PX, 0.3, front + PX, sides(tiled(stock.cobbleWall())));
  b.box(x0, 0.3, z0, x1, nave, front, sides(lime));
  b.gableRoof(x0 - 0.3, z0 - 0.3, x1 + 0.3, front + 0.3, nave, 2.0, stock.slate(), lime, 0.12);
  // Buttresses down the sides, and stained glass between them.
  const bays = windowSpots(front - z0, undefined, 2.0, 1.0);
  for (const z of bays) {
    for (const x of [x0 - 0.3, x1]) b.box(x, 0, z0 + z - 1.0 - 0.18, x + 0.3, nave - 0.6, z0 + z - 1.0 + 0.18, sides(lime, flag));
  }
  const stained = windowMaterial(C.LIMESTONE, "stained", "arch");
  for (const z of bays) {
    sideWindow(b, x1, 1.6, z0 + z, 1, stained);
    sideWindow(b, x0, 1.6, z0 + z, -1, stained);
  }
  for (const x of windowSpots(x1 - x0, xm - x0, 1.7, 0.8)) {
    if (Math.abs(x0 + x - xm) < tw / 2 + 0.5) continue;
    b.card(fitted(stained), x0 + x - 0.5, 1.6, x0 + x + 0.5, 2.725, front + 0.01);
  }
  // The tower: square and tall, its spire of slate, a gilded sun on top.
  const ta = xm - tw / 2;
  const tb = xm + tw / 2;
  const top = nave + 2.6;
  b.box(ta, 0, z1 - 2.6, tb, top, z1, sides(lime));
  b.box(ta - 0.1, top, z1 - 2.7, tb + 0.1, top + 0.2, z1 + 0.1, sides(flag));
  hipRoof(b, ta - 0.1, z1 - 2.7, tb + 0.1, z1 + 0.1, top + 0.2, 2.6, stock.slate());
  b.cylinder(xm, z1 - 1.3, top + 2.75, top + 3.2, 0.04, 4, { mat: gold() });
  b.cylinder(xm, z1 - 1.3, top + 3.2, top + 3.35, 0.16, 8, { mat: gold() }, { mat: gold() });
  // The belfry's openings, a rose window over the great door.
  const belfry = windowMaterial(C.LIMESTONE, "dark", "arch");
  b.card(fitted(belfry), xm - 0.5, top - 1.6, xm + 0.5, top - 0.475, z1 + 0.01);
  sideWindow(b, tb, top - 1.6, z1 - 1.3, 1, belfry);
  sideWindow(b, ta, top - 1.6, z1 - 1.3, -1, belfry);
  b.card(fitted(windowMaterial(C.GOLD, "stained", "round")), xm - 0.55, 2.7, xm + 0.55, 3.9, z1 + 0.01);
  doorCard(b, xm, 0.12, z1, doorMaterial(C.WOOD, C.LIMESTONE, "pointed"), flag);
  bannerAt(b, ta - 0.55, 3.2, front);
  bannerAt(b, tb + 0.55, 3.2, front);
  return [xm, 1, z1];
}

/** A guildhall: two storeys of ashlar behind pilasters, a balcony over its door, banners, a plaque of its guild. */
function guildhall(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette, trade: Trade | undefined): XYZ {
  const lime = tiled(stock.limestone(pal.stone));
  const flag = tiled(stock.flagstone(pal.stone));
  const xm = (x0 + x1) / 2;
  const h = 5.2;
  const zf = z1 - 0.12;
  b.box(x0 - PX, 0, z0 - PX, x1 + PX, 0.35, z1 + PX, sides(tiled(stock.cobbleWall())));
  b.box(x0, 0.35, z0, x1, h, zf, sides(lime));
  // A cornice round the top, a low hipped roof of tile behind.
  b.box(x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.2, z1 + 0.05, sides(flag));
  hipRoof(b, x0 - 0.1, z0 - 0.1, x1 + 0.1, z1, h + 0.2, 1.5, stock.roof(pal.roof));
  // Pilasters between the bays.
  const bays = windowSpots(x1 - x0, undefined, 1.75, 0.9);
  for (let i = 0; i + 1 < bays.length; i++) {
    const x = x0 + (bays[i]! + bays[i + 1]!) / 2;
    b.box(x - 0.14, 0.35, zf, x + 0.14, h, z1, sides(flag));
  }
  b.box(x0, 0.35, zf, x0 + 0.28, h, z1, sides(flag));
  b.box(x1 - 0.28, 0.35, zf, x1, h, z1, sides(flag));
  const glass = windowMaterial(C.LIMESTONE, "clear", "arch");
  for (const x of bays) if (Math.abs(x0 + x - xm) > 1.0) b.card(fitted(glass), x0 + x - 0.5, 0.9, x0 + x + 0.5, 2.025, zf + 0.01);
  for (const x of bays) b.card(fitted(glass), x0 + x - 0.5, 3.0, x0 + x + 0.5, 4.125, zf + 0.01);
  sideWindows(b, x0, x1, z0, z1, 3.0, glass);
  // The balcony over the door, on two brackets, with an iron rail.
  b.box(xm - 1.1, 2.55, zf, xm + 1.1, 2.7, zf + 0.6, sides(flag));
  for (const x of [xm - 0.9, xm + 0.9]) b.box(x - 0.08, 2.2, zf, x + 0.08, 2.55, zf + 0.4, sides(flag));
  b.box(xm - 1.1, 3.25, zf + 0.52, xm + 1.1, 3.3, zf + 0.6, sides(iron()));
  for (let x = xm - 1.05; x <= xm + 1.06; x += 0.21) b.box(x - 0.02, 2.7, zf + 0.53, x + 0.02, 3.25, zf + 0.58, sides(iron()));
  doorCard(b, xm, 0.35, zf, doorMaterial(C.DARKWOOD, C.LIMESTONE, "arch"), flag);
  plaque(b, xm, 4.2, zf, signMaterial(trade ?? "guild", C.BLUE, C.GOLD, "shield"));
  bannerAt(b, x0 + 0.6, h - 0.15, z1);
  bannerAt(b, x1 - 0.6, h - 0.15, z1);
  return [xm, 1, zf];
}

/** A smithy: a stone forge-house, its front open under a lean-to on posts, the forge glowing, an anvil and a quench tub. */
function smithy(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette, trade: Trade | undefined): XYZ {
  const lime = tiled(stock.limestone(pal.stone));
  const timber = tiled(stock.timber(pal.timber));
  const back = z1 - 1.8;
  const xm = (x0 + x1) / 2;
  b.box(x0 - PX, 0, z0 - PX, x1 + PX, 0.25, back + PX, sides(tiled(stock.cobbleWall())));
  b.box(x0, 0.25, z0, x1, 2.6, back, sides(lime));
  b.gableRoof(x0 - 0.3, z0 - 0.3, x1 + 0.3, back + 0.3, 2.6, 1.4, stock.roof(pal.roof), tiled(stock.plaster(pal.plaster)), 0.12);
  // The lean-to over the working floor, on posts.
  for (const x of [x0 + 0.1, x1 - 0.3]) b.box(x, 0, z1 - 0.3, x + 0.2, 2.1, z1 - 0.1, sides(timber));
  b.box(x0, 2.05, z1 - 0.35, x1, 2.2, z1 - 0.05, sides(timber));
  shedRoof(b, x0 - 0.15, back, x1 + 0.15, z1 + 0.15, 2.15, 2.75, stock.roof(pal.roof));
  // The forge against the house: a hearth of stone, coals glowing, a hood, and its chimney up through the roof.
  const fx = x0 + 1.2;
  const rough = tiled(stock.cobbleWall());
  b.box(fx - 0.7, 0, back, fx + 0.7, 0.8, back + 0.9, sides(rough));
  b.box(fx - 0.5, 0.8, back + 0.08, fx + 0.5, 0.86, back + 0.8, sides(fitted(material("forge-coals", () => coals(), { glowing: true }))));
  b.box(fx - 0.6, 1.5, back, fx + 0.6, 2.05, back + 0.8, sides(rough));
  b.box(fx - 0.35, 2.05, z0 + 0.8, fx + 0.35, 4.7, back + 0.35, sides(rough));
  // The anvil, a quench tub and blades on a rack on the wall.
  anvil(b, xm + 0.4, z1 - 0.9);
  b.cylinder(x1 - 0.8, z1 - 0.95, 0, 0.5, 0.32, 8, fitted(material("tub", () => tubPicture())), fitted(stock.boards()));
  b.box(x1 - 2.25, 1.15, back, x1 - 1.05, 1.23, back + 0.12, sides(timber));
  for (let i = 0; i < 4; i++) b.box(x1 - 2.15 + i * 0.3, 0.55, back + 0.02, x1 - 2.1 + i * 0.3, 1.4, back + 0.07, sides(ironLight()));
  doorCard(b, x1 - 0.55, 0.25, back, doorMaterial(C.WOOD, C.LIMESTONE, "square"));
  hangingSign(b, x0 + 0.2, 2.0, z1 - 0.1, benalishSign(trade ?? "smith"), timber);
  return [x1 - 0.55, 1, back];
}

function coals(): Pixmap {
  const p = new Pixmap(8, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) p.set(x, y, [C.FIRE[0]!, C.FIRE[1]!, C.FIRE[2]!, C.FIRE[3]!][(x * 3 + y * 5) % 4]!);
  return p;
}

function tubPicture(): Pixmap {
  const p = new Pixmap(16, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) p.set(x, y, y === 1 || y === 6 ? C.IRON[2]! : x % 4 === 0 ? C.WOOD[2]! : C.WOOD[4]!);
  return p;
}

/** An anvil on its block, its middle at x, z. */
export function anvil(b: MeshBuilder, x: number, z: number): void {
  b.cylinder(x, z, 0, 0.5, 0.22, 7, fitted(material("anvil-block", () => tubPicture())), fitted(stock.boards()));
  const ironFace = sides(flat(C.IRON[2]!), flat(C.IRON[4]!));
  b.box(x - 0.12, 0.5, z - 0.1, x + 0.12, 0.62, z + 0.1, ironFace);
  b.box(x - 0.3, 0.62, z - 0.12, x + 0.25, 0.78, z + 0.12, ironFace);
  b.box(x + 0.25, 0.66, z - 0.06, x + 0.42, 0.76, z + 0.06, ironFace);
}

/** A library: tall arched windows under a slate roof, a round reading tower at one corner, a plaque of a book. */
function library(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette, trade: Trade | undefined): XYZ {
  const lime = tiled(stock.limestone(pal.stone));
  const flag = tiled(stock.flagstone(pal.stone));
  const h = 4.0;
  const tr = 1.2;
  const tx = x1 - tr;
  const tz = z1 - tr;
  const xe = x1 - tr * 0.6;
  b.box(x0 - PX, 0, z0 - PX, xe + PX, 0.3, z1 + PX, sides(tiled(stock.cobbleWall())));
  b.box(x0, 0.3, z0, xe, h, z1, sides(lime));
  b.gableRoof(x0 - 0.3, z0 - 0.3, xe + 0.1, z1 + 0.3, h, 1.8, stock.slate(), lime, 0.12);
  // The reading tower.
  b.cylinder(tx, tz, 0, h + 2.2, tr, 12, { mat: stock.limestone(pal.stone) }, undefined, 0, 1, 2);
  b.cylinder(tx, tz, h + 2.2, h + 2.45, tr + 0.15, 12, { mat: stock.flagstone(pal.stone) });
  coneRoof(b, tx, tz, h + 2.45, tr + 0.25, 2.2, stock.slate(), 12);
  const glass = windowMaterial(C.LIMESTONE, "clear", "arch");
  b.at(tx, 0, tz, 0, () => b.card(fitted(glass), -0.5, h + 0.6, 0.5, h + 1.725, tr + 0.01));
  b.at(tx, 0, tz, Math.PI / 4, () => b.card(fitted(glass), -0.5, 1.6, 0.5, 2.725, tr + 0.01));
  const tall = material("library-window", () => tallWindow(), { cutout: true });
  const front = tx - tr - x0;
  const door = front / 2;
  for (const x of windowSpots(front, door, 1.6, 0.8)) b.card(fitted(tall), x0 + x - 0.5, 0.8, x0 + x + 0.5, 3.3, z1 + 0.01);
  for (const z of windowSpots(z1 - z0, undefined, 1.6, 1.0)) sideTall(b, x0, z0 + z, tall);
  doorCard(b, x0 + door, 0.3, z1, doorMaterial(C.DARKWOOD, C.LIMESTONE, "arch"), flag);
  plaque(b, x0 + door, 2.55, z1, signMaterial(trade ?? "books", C.BLUE, C.GOLD, "board"));
  return [x0 + door, 1, z1];
}

function sideTall(b: MeshBuilder, x: number, z: number, mat: Material): void {
  b.at(x - 0.01, 0, z, -Math.PI / 2, () => b.card(fitted(mat), -0.5, 0.8, 0.5, 3.3, 0));
}

/** A tall arched window, 16 by 40: leaded panes, the top in an arch. */
function tallWindow(): Pixmap {
  const p = new Pixmap(16, 40);
  p.fill(0, 0);
  const l = C.LIMESTONE;
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = y - 8;
      const outer = y >= 8 || dx * dx + dy * dy <= 64;
      const inner = x >= 2 && x <= 13 && y <= 37 && (y >= 8 || dx * dx + dy * dy <= 36);
      if (!outer) continue;
      if (!inner) {
        p.set(x, y, y > 37 ? l[6]! : x < 8 ? l[4]! : l[3]!);
        continue;
      }
      const lead = x === 7 || x === 8 || (y - 8) % 6 === 0;
      p.set(x, y, lead ? C.IRON[2]! : y < 14 ? C.WATER[3]! : y < 28 ? C.WATER[2]! : C.WATER[1]!);
    }
  }
  p.set(4, 16, C.WATER[5]!);
  p.set(5, 15, C.WATER[5]!);
  return p;
}

/** A mage's tower: round and tall, windows climbing it, a conical roof of slate, a plaque of a star over its door. */
function tower(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette, trade: Trade | undefined, storeys: number): XYZ {
  const r = Math.min(x1 - x0, z1 - z0) / 2 - 0.1;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const h = 2.4 + storeys * 2.2;
  b.cylinder(cx, cz, 0, 0.35, r + 0.15, 12, { mat: stock.cobbleWall() }, undefined, 0, 1, 2);
  b.cylinder(cx, cz, 0.35, h, r, 12, { mat: stock.limestone(pal.stone) }, undefined, 0, 1, 2);
  b.cylinder(cx, cz, h, h + 0.3, r + 0.25, 12, { mat: stock.flagstone(pal.stone) });
  coneRoof(b, cx, cz, h + 0.3, r + 0.35, r * 2.2, stock.slate(), 12);
  b.cylinder(cx, cz, h + 0.3 + r * 2.2, h + 0.75 + r * 2.2, 0.04, 4, { mat: gold() });
  const glass = windowMaterial(C.LIMESTONE, "lit", "arch");
  for (let k = 1; k < storeys + 1; k++) {
    const a = ((k % 3) - 1) * (Math.PI / 4);
    b.at(cx, 0, cz, a, () => b.card(fitted(glass), -0.5, 0.4 + k * 2.2, 0.5, 1.525 + k * 2.2, r + 0.01));
  }
  doorCard(b, cx, 0.35, cz + r, doorMaterial(C.PURPLE, C.LIMESTONE, "pointed"));
  plaque(b, cx, 2.45, cz + r + 0.01, signMaterial(trade ?? "magic", C.SLATE, C.GOLD, "round"));
  return [cx, 1, cz + r];
}

/** A warehouse: a long barn of boards on a stone footing, great doors, a hoist beam over a loft door, crates by it. */
function warehouse(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette): XYZ {
  const timber = tiled(stock.timber(pal.timber));
  const plank = tiled(stock.darkTimber(pal.darkTimber));
  const xm = (x0 + x1) / 2;
  const wood = pal.timber ?? C.WOOD;
  b.box(x0 - PX, 0, z0 - PX, x1 + PX, 0.5, z1 + PX, sides(tiled(stock.cobbleWall())));
  b.box(x0, 0.5, z0, x1, 3.6, z1, sides(tiled(material(`barn-boards@${rampKey(wood)}`, () => barnBoards(wood)))));
  for (const x of [x0, x1 - 0.2]) b.box(x, 0.5, z1, x + 0.2, 3.6, z1 + 0.06, sides(plank));
  b.gableRoof(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, 3.6, 1.8, stock.slate(), timber, 0.12);
  const big = material(`barn-door@${rampKey(wood)}`, () => barnDoor(wood));
  b.card(fitted(big), xm - 1.1, 0.5, xm + 1.1, 2.875, z1 + 0.02);
  b.card(fitted(doorMaterial(wood, C.DARKWOOD, "square", false)), xm - 0.45, 3.0, xm + 0.45, 4.4, z1 + 0.02);
  b.box(xm - 0.06, 4.45, z1, xm + 0.06, 4.57, z1 + 0.9, sides(timber));
  b.box(xm - 0.01, 3.4, z1 + 0.78, xm + 0.01, 4.45, z1 + 0.8, sides(iron()));
  crate(b, x0 + 0.7, z1 + 0.6, 0.7);
  crate(b, x0 + 0.75, z1 + 0.6, 0.55, undefined, 0.7, 0.3);
  barrel(b, x1 - 0.6, z1 + 0.55);
  return [xm, 1, z1];
}

function barnBoards(r: Ramp): Pixmap {
  const p = new Pixmap(16, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 4 === 0 ? r[1]! : x % 4 === 1 ? r[4]! : hash2(x, y, 3) < 0.1 ? r[2]! : r[3]!);
  return p;
}

function barnDoor(r: Ramp): Pixmap {
  const p = new Pixmap(36, 38);
  for (let y = 0; y < 38; y++) {
    for (let x = 0; x < 36; x++) {
      let c = x % 4 === 0 ? r[2]! : r[3]!;
      if (x === 17 || x === 18) c = r[1]!;
      const half = x < 18 ? x : x - 18;
      if (y < 2 || y > 35 || Math.abs(half * 2 - (y - 2)) < 2) c = r[4]!;
      if (x < 1 || x > 34) c = r[1]!;
      p.set(x, y, c);
    }
  }
  return p;
}

function slit(): Pixmap {
  const p = new Pixmap(4, 12, C.INK);
  p.vline(0, 0, 12, C.LIMESTONE[2]!);
  return p;
}

/** A gatehouse: two square towers and the arch between them over a passage two tiles wide; walked through. */
function gatehouse(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette): XYZ {
  const lime = tiled(stock.limestone(pal.stone));
  const flag = tiled(stock.flagstone(pal.stone));
  const xm = (x0 + x1) / 2;
  const g0 = xm - 1;
  const g1 = xm + 1;
  const h = 5.0;
  const slitMat = fitted(material("arrow-slit-benalish", () => slit()));
  for (const [xa, xb] of [
    [x0, g0],
    [g1, x1],
  ] as const) {
    b.box(xa, 0, z0, xb, h, z1, sides(lime, flag));
    merlons(b, xa, z1 - 0.1, xb, z1 - 0.1, h, lime);
    merlons(b, xa, z0 + 0.1, xb, z0 + 0.1, h, lime);
    b.card(slitMat, (xa + xb) / 2 - 0.125, 3.0, (xa + xb) / 2 + 0.125, 3.75, z1 + 0.01);
    bannerAt(b, (xa + xb) / 2, 2.7, z1);
  }
  // The arch over the passage, its portcullis raised (its teeth showing), merlons along the walk.
  b.box(g0, 2.75, z0, g1, h - 0.4, z1, sides(lime, flag));
  merlons(b, g0, z1 - 0.1, g1, z1 - 0.1, h - 0.4, lime);
  for (let x = g0 + 0.15; x < g1 - 0.1; x += 0.25) b.box(x - 0.03, 2.35, z1 - 0.3, x + 0.03, 2.75, z1 - 0.24, sides(iron()));
  b.box(g0, 2.6, z1 - 0.3, g1, 2.68, z1 - 0.24, sides(iron()));
  return [xm, 1, z1];
}

/** A stretch of town wall along the footprint's longer side, crenellated on both faces, a walk on top. */
function wall(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette): undefined {
  const lime = tiled(stock.limestone(pal.stone));
  const flag = tiled(stock.flagstone(pal.stone));
  const h = 3.0;
  b.box(x0, 0, z0, x1, h, z1, sides(lime, flag));
  if (x1 - x0 >= z1 - z0) {
    merlons(b, x0, z1 - 0.1, x1, z1 - 0.1, h, lime);
    merlons(b, x0, z0 + 0.1, x1, z0 + 0.1, h, lime);
  } else {
    merlons(b, x1 - 0.1, z0, x1 - 0.1, z1, h, lime);
    merlons(b, x0 + 0.1, z0, x0 + 0.1, z1, h, lime);
  }
  return undefined;
}

/** A wall tower: square, taller than the wall, crenellated all round, a banner. */
function wallTower(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, pal: Palette): undefined {
  const lime = tiled(stock.limestone(pal.stone));
  const flag = tiled(stock.flagstone(pal.stone));
  const h = 5.4;
  b.box(x0, 0, z0, x1, h, z1, sides(lime, flag));
  b.box(x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.2, z1 + 0.15, sides(flag));
  merlons(b, x0, z1, x1, z1, h + 0.2, lime);
  merlons(b, x0, z0, x1, z0, h + 0.2, lime);
  merlons(b, x0, z0 + 0.3, x0, z1 - 0.3, h + 0.2, lime);
  merlons(b, x1, z0 + 0.3, x1, z1 - 0.3, h + 0.2, lime);
  b.card(fitted(material("arrow-slit-benalish", () => slit())), (x0 + x1) / 2 - 0.125, 3.2, (x0 + x1) / 2 + 0.125, 3.95, z1 + 0.01);
  bannerAt(b, (x0 + x1) / 2, 2.9, z1);
  return undefined;
}

function benalish(building: BuildingData, pal: Palette): Built {
  const kind = building.kind ?? "house";
  const P = paramsOf(building);
  const trade = tradeOf(building);
  const go = (draw: Draw, through = false) => styled(building, draw, through);
  switch (kind) {
    case "mausoleum":
      return go((b, x0, z0, x1, z1) => {
        mausoleum(b, x0, x1, z0, z1);
        return [(x0 + x1) / 2, 1, z1 + 0.5];
      });
    case "shop":
      return go(houseOf(building, pal, { upper: 1.7 }, "shopDoor"));
    case "tenement":
      return go(houseOf(building, pal, { ground: 2.5, upper: 3.4, rise: 1.8, chimney: 1.2 }, "door"));
    case "inn":
      return go(houseOf(building, pal, { ground: 2.6, upper: 2.0, rise: 1.8, chimney: 1.4, wall: "plaster" }, "door", [{ at: 0.8, kind: "lamp" }]));
    case "temple":
      return go((b, x0, z0, x1, z1) => temple(b, x0, z0, x1, z1, pal));
    case "guildhall":
      return go((b, x0, z0, x1, z1) => guildhall(b, x0, z0, x1, z1, pal, trade));
    case "smithy":
      return go((b, x0, z0, x1, z1) => smithy(b, x0, z0, x1, z1, pal, trade));
    case "library":
      return go((b, x0, z0, x1, z1) => library(b, x0, z0, x1, z1, pal, trade));
    case "tower":
      return go((b, x0, z0, x1, z1) => tower(b, x0, z0, x1, z1, pal, trade, P.num("floors", 3)));
    case "barn":
    case "warehouse":
      return go((b, x0, z0, x1, z1) => warehouse(b, x0, z0, x1, z1, pal));
    case "gatehouse":
      return go((b, x0, z0, x1, z1) => gatehouse(b, x0, z0, x1, z1, pal), true);
    case "wall":
      return go((b, x0, z0, x1, z1) => wall(b, x0, z0, x1, z1, pal));
    case "wall-tower":
      return go((b, x0, z0, x1, z1) => wallTower(b, x0, z0, x1, z1, pal));
    default:
      return go(houseOf(building, pal, {}, "door"));
  }
}

BUILDINGS.define(
  "benalish",
  "Benalia's style - limestone and whitewash, timber-framed upper floors, red tile or slate, blue-and-gold banners. Kinds: house, shop, tenement, inn (params: ground, upper, roof tile|slate, rise, chimney, wall limestone|plaster, openings [{at, kind}], laid out when not given), temple, guildhall, smithy, library, tower (floors), warehouse, gatehouse (its passage the middle 2 tiles), wall, wall-tower, mausoleum; params.trade names a sign's emblem",
  benalish,
  BENALISH,
);

showcase("benalish", [
  { kind: "house", w: 6, d: 4, label: "slice", params: { upper: 1.7, chimney: 1.5, openings: [{ at: 1.5, kind: "window" }, { at: 3, kind: "door" }, { at: 4.5, kind: "window" }, { at: 1.5, kind: "windowUp" }, { at: 4.5, kind: "windowUp" }] } },
  { kind: "house", w: 4, d: 4, label: "cottage", params: { upper: 0, chimney: 1, wall: "plaster" } },
  { kind: "shop", w: 7, d: 4, params: { roof: "slate", trade: "potions" } },
  { kind: "tenement", w: 5, d: 4 },
  { kind: "inn", w: 8, d: 5 },
  { kind: "smithy", w: 6, d: 5 },
  { kind: "guildhall", w: 9, d: 6 },
  { kind: "temple", w: 7, d: 9 },
  { kind: "library", w: 8, d: 6 },
  { kind: "tower", w: 4, d: 4, params: { floors: 3 } },
  { kind: "warehouse", w: 8, d: 5 },
  { kind: "mausoleum", w: 5, d: 4 },
  { kind: "gatehouse", w: 6, d: 3 },
  { kind: "wall-tower", w: 3, d: 3 },
  { kind: "wall", w: 6, d: 1 },
]);
