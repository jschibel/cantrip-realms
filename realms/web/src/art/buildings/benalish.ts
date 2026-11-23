import type { BuildingData, XYZ } from "../../world/format";
import { type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material, stock } from "../paint/materials";
import type { Palette } from "../paint/palette";
import * as P from "../paint/pictures";
import * as T from "../paint/textures";
import { PX, bannerAt, iron, ironLight, pics, wallLamp } from "../props/draw";
import type { Built } from "../recipe";
import { BUILDINGS, placeBuilding } from "./registry";

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
  b.gableRoof(x0 - overhang, z0 - overhang, x1 + overhang, z1 + overhang, top, h.rise, roofMat, plaster, 0.12);
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

function benalish(building: BuildingData, pal: Palette): Built {
  return placeBuilding(building, (b, x0, z0, x1, z1): XYZ | undefined => {
    if (building.kind === "mausoleum") {
      mausoleum(b, x0, x1, z0, z1);
      return [(x0 + x1) / 2, 1, z1 + 0.5];
    }
    const params = (building.params ?? {}) as Partial<Omit<HouseSpec, "x0" | "x1" | "z0" | "z1">>;
    const h: HouseSpec = {
      x0,
      x1,
      z0,
      z1,
      ground: params.ground ?? 2.5,
      upper: params.upper ?? 1.7,
      roof: params.roof ?? "tile",
      rise: params.rise ?? 1.6,
      chimney: params.chimney,
      wall: params.wall,
      openings: params.openings ?? [],
    };
    house(b, h, pal);
    const door = doorOf(h);
    return door === undefined ? undefined : [x0 + door, 1, z1];
  });
}

BUILDINGS.define(
  "benalish",
  "Benalia's style: kind house or shop (params: ground, upper, roof tile|slate, rise, chimney, wall limestone|plaster, openings [{at, kind}]) or mausoleum",
  benalish,
  BENALISH,
);
