import type { RGB, XYZ } from "../../world/format";
import { type Face, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, painted, stock } from "../paint/materials";
import { type Palette, type Ramp, definePalette } from "../paint/palette";
import { Pixmap } from "../paint/pixmap";
import * as T from "../paint/textures";
import { defineSurface } from "../surfaces";
import * as P from "./paint";

// The regional finishes rooms are built in: what a Benalish house's room is made of (boards, wainscot, plaster between
// timber posts), a Llanowar tree-house's (living wood), the Morass's stilt-houses' (black boards, lashed planks, mud
// daub), a Keldon longhouse's (rubble footings, dark timber, cold flags), the Tolarian Academy's (mosaic, white stone,
// brass) and the Vess estate's (parquet, damask, gilt). A room's `style` names its finish; its kind may ask for the
// finish's stone or its fine floor instead of the plain one (a smithy, a temple). Furniture takes the finish's woods by
// a named palette, `room-<style>` (a prop's `tint`).

export const ROOM_STYLES = ["benalish", "llanowar", "morass", "keldon", "tolarian", "vess"] as const;
export type RoomStyle = (typeof ROOM_STYLES)[number];

/** Other names a world may give a style: its building style's region. */
const ALIASES: Readonly<Record<string, RoomStyle>> = { urborg: "morass", caligo: "morass", argive: "vess", keld: "keldon", orvada: "tolarian", benalia: "benalish" };

/** A room's style from its interior's `style`: the finish of that name or its alias, else Benalish. */
export function styleOf(style: string | undefined): RoomStyle {
  if (style && (ROOM_STYLES as readonly string[]).includes(style)) return style as RoomStyle;
  return ALIASES[style ?? ""] ?? "benalish";
}

export interface Band {
  /** The band's top, from the floor. */
  readonly to: number;
  readonly face: Face;
  /** Texels it stands out from the band above. */
  readonly proud?: number;
}

export interface Finish {
  readonly style: RoomStyle;
  /** Surfaces: the usual floor, a stone one (a smithy's), a fine one (a temple's), the flags before a fire. */
  readonly floor: string;
  readonly stoneFloor: string;
  readonly fineFloor: string;
  readonly hearthFloor: string;
  /** The back wall's bands for a wall `height` high: a footing, the wall, a beam under the ceiling's shadow. */
  readonly bands: (height: number) => readonly Band[];
  /** The bands of a stone-walled room in this style (a smithy, a temple's footing). */
  readonly stoneBands: (height: number) => readonly Band[];
  readonly side: Face;
  readonly top: Face;
  /** Posts framing the back wall in bays, if the style has them. */
  readonly posts?: { readonly face: Face; readonly bay: number; readonly width: number };
  readonly frame: Face;
  /** The room's own light: the sky's fill and the ground's bounce, and the daylight through the door. */
  readonly sky: RGB;
  readonly ground: RGB;
  readonly fill: number;
  readonly daylight: { readonly color: RGB; readonly intensity: number; readonly from: XYZ };
  /** The palette furniture in this style takes (`room-<style>`). */
  readonly palette: string;
}

const PX = 1 / 16;

/** The tops of the walls: a dark beam, as a 16-bit room's border is drawn (the slice shop's). */
function wallTopPicture(ramp: Ramp = C.DARKWOOD): Pixmap {
  const p = T.timber(17, ramp);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y * 3) % 11 === 0) p.set(x, y, ramp[1]!);
  return p;
}

/** A mud daub's plaster ramp: grey-green and brown (the Morass). */
const DAUB: Ramp = [0x2a2a24, 0x3a3a30, 0x4c4a3a, 0x5e5a44, 0x706a50, 0x847c5c];
/** Tolaria's plaster: pale blue-white. */
const TOLARIAN_PLASTER: Ramp = [0x5a6a8a, 0x7e8eac, 0xa6b4cc, 0xc8d4e4, 0xe0e8f2, 0xf4f8fc];
/** The Morass's dark timber, as a five-step ramp. */
const BOG_TIMBER: Ramp = P.BOGWOOD.slice(1, 6);

const benalish = (pal: Palette): Finish => {
  const beam = tiled(stock.darkTimber(pal.darkTimber));
  const plaster = tiled(stock.plaster(pal.plaster));
  return {
    style: "benalish",
    floor: "floorboards",
    stoneFloor: "room-stone",
    fineFloor: "room-marble",
    hearthFloor: "hearthstone",
    bands: (h) => [
      { to: 1.0, face: tiled(material("wainscot", () => P.wainscotOf(C.WOOD))), proud: PX },
      { to: h - 0.25, face: plaster },
      { to: h, face: beam, proud: 2 * PX },
    ],
    stoneBands: (h) => [
      { to: 0.75, face: tiled(stock.cobbleWall()), proud: PX },
      { to: h - 0.25, face: tiled(stock.limestone(pal.stone)) },
      { to: h, face: beam, proud: 2 * PX },
    ],
    side: plaster,
    top: tiled(material("wall-top", () => wallTopPicture())),
    posts: { face: beam, bay: 4, width: 0.25 },
    frame: beam,
    sky: [0.58, 0.5, 0.72],
    ground: [0.32, 0.22, 0.26],
    fill: 0.62,
    daylight: { color: [1.0, 0.9, 0.75], intensity: 0.25, from: [-4, 10, 8] },
    palette: "room-benalish",
  };
};

const llanowar = (): Finish => {
  const bark = tiled(stock.bark());
  const wood = tiled(material("living-wood", () => P.livingWood()));
  return {
    style: "llanowar",
    floor: "room-elfwood",
    stoneFloor: "room-earth",
    fineFloor: "room-elfwood",
    hearthFloor: "room-mossy-flags",
    bands: (h) => [
      { to: 0.875, face: tiled(material("wainscot-elf", () => P.wainscotOf(P.ELFWOOD))), proud: PX },
      { to: h - 0.3125, face: wood },
      { to: h, face: tiled(stock.leaves()), proud: 3 * PX },
    ],
    stoneBands: (h) => [
      { to: 1.0, face: tiled(material("mossy-rubble", () => P.rubbleStone(C.COBBLE, 51))), proud: PX },
      { to: h - 0.3125, face: wood },
      { to: h, face: tiled(stock.leaves()), proud: 3 * PX },
    ],
    side: wood,
    top: tiled(material("wall-top-elf", () => wallTopPicture(P.ELFWOOD.slice(1, 6)))),
    posts: { face: bark, bay: 5, width: 0.375 },
    frame: bark,
    sky: [0.5, 0.62, 0.42],
    ground: [0.26, 0.24, 0.14],
    fill: 0.6,
    daylight: { color: [0.95, 1.0, 0.7], intensity: 0.3, from: [-3, 10, 7] },
    palette: "room-llanowar",
  };
};

const morass = (): Finish => {
  const beam = tiled(painted("dark-timber", BOG_TIMBER, C.DARKWOOD, (r) => T.timber(16, r)));
  const planks = tiled(material("lashed-planks", () => P.lashedPlanks()));
  const daub = tiled(stock.plaster(DAUB));
  return {
    style: "morass",
    floor: "room-bogwood",
    stoneFloor: "crypt-floor",
    fineFloor: "room-bogwood",
    hearthFloor: "crypt-floor",
    bands: (h) => [
      { to: 1.25, face: planks, proud: PX },
      { to: h - 0.25, face: daub },
      { to: h, face: beam, proud: 2 * PX },
    ],
    stoneBands: (h) => [
      { to: 1.0, face: tiled(stock.cryptBrick()), proud: PX },
      { to: h - 0.25, face: daub },
      { to: h, face: beam, proud: 2 * PX },
    ],
    side: planks,
    top: tiled(material("wall-top-bog", () => wallTopPicture(BOG_TIMBER))),
    posts: { face: beam, bay: 3, width: 0.25 },
    frame: beam,
    sky: [0.4, 0.48, 0.44],
    ground: [0.16, 0.18, 0.14],
    fill: 0.55,
    daylight: { color: [0.7, 0.85, 0.7], intensity: 0.18, from: [-4, 10, 8] },
    palette: "room-morass",
  };
};

const keldon = (): Finish => {
  const beam = tiled(stock.darkTimber());
  const rubble = tiled(material("keld-rubble", () => P.rubbleStone()));
  const boards = tiled(painted("keld-boards", C.DARKWOOD, C.WOOD, (r) => T.timber(18, r)));
  return {
    style: "keldon",
    floor: "room-keld-flags",
    stoneFloor: "room-keld-flags",
    fineFloor: "room-keld-flags",
    hearthFloor: "room-keld-flags",
    bands: (h) => [
      { to: 1.25, face: rubble, proud: 2 * PX },
      { to: h - 0.375, face: boards },
      { to: h, face: beam, proud: 2 * PX },
    ],
    stoneBands: (h) => [
      { to: h - 0.375, face: rubble },
      { to: h, face: beam, proud: 2 * PX },
    ],
    side: boards,
    top: tiled(material("wall-top", () => wallTopPicture())),
    posts: { face: beam, bay: 3, width: 0.375 },
    frame: beam,
    sky: [0.6, 0.42, 0.38],
    ground: [0.28, 0.16, 0.14],
    fill: 0.6,
    daylight: { color: [0.8, 0.85, 1.0], intensity: 0.2, from: [-4, 10, 8] },
    palette: "room-keldon",
  };
};

const tolarian = (): Finish => {
  const brass = tiled(painted("brass", C.GOLD, C.WOOD, (r) => T.timber(19, r)));
  const stone = tiled(material("tolarian-stone", () => P.dressedStone(P.TOLARIAN, 52)));
  const plaster = tiled(stock.plaster(TOLARIAN_PLASTER));
  return {
    style: "tolarian",
    floor: "room-mosaic",
    stoneFloor: "room-tolarian-flags",
    fineFloor: "room-mosaic",
    hearthFloor: "room-tolarian-flags",
    bands: (h) => [
      { to: 0.875, face: stone, proud: PX },
      { to: 1.0, face: brass, proud: PX },
      { to: h - 0.1875, face: plaster },
      { to: h, face: brass, proud: PX },
    ],
    stoneBands: (h) => [
      { to: h - 0.1875, face: stone },
      { to: h, face: brass, proud: PX },
    ],
    side: plaster,
    top: tiled(material("tolarian-top", () => T.flagstones(P.TOLARIAN, 53))),
    frame: brass,
    sky: [0.7, 0.76, 0.92],
    ground: [0.36, 0.34, 0.44],
    fill: 0.68,
    daylight: { color: [0.9, 0.95, 1.0], intensity: 0.32, from: [-4, 10, 8] },
    palette: "room-tolarian",
  };
};

const vess = (): Finish => {
  const beam = tiled(stock.darkTimber());
  const gilt = tiled(painted("gilt", C.GOLD, C.WOOD, (r) => T.timber(20, r)));
  const paper = tiled(material("damask", () => P.damask()));
  return {
    style: "vess",
    floor: "room-parquet",
    stoneFloor: "room-checker",
    fineFloor: "room-checker",
    hearthFloor: "room-checker",
    bands: (h) => [
      { to: 1.0, face: tiled(material("wainscot-dark", () => P.wainscotOf(C.DARKWOOD.concat([0x8a5a44, 0xa87050])))), proud: PX },
      { to: 1.0625, face: gilt, proud: PX },
      { to: h - 0.25, face: paper },
      { to: h, face: beam, proud: 2 * PX },
    ],
    stoneBands: (h) => [
      { to: 1.0, face: tiled(stock.cryptBrick()), proud: PX },
      { to: h - 0.25, face: paper },
      { to: h, face: beam, proud: 2 * PX },
    ],
    side: paper,
    top: tiled(material("wall-top", () => wallTopPicture())),
    posts: { face: beam, bay: 4, width: 0.25 },
    frame: gilt,
    sky: [0.52, 0.4, 0.56],
    ground: [0.24, 0.14, 0.2],
    fill: 0.55,
    daylight: { color: [0.95, 0.85, 0.8], intensity: 0.18, from: [-4, 10, 8] },
    palette: "room-vess",
  };
};

const FINISHES: Readonly<Record<RoomStyle, (pal: Palette) => Finish>> = { benalish, llanowar, morass, keldon, tolarian, vess };

/** A style's finish, its walls painted from the palette given (the shop's `plaster` and `darkTimber`). */
export const finishOf = (style: string | undefined, pal: Palette = {}): Finish => FINISHES[styleOf(style)](pal);

// --- Floors ------------------------------------------------------------------------------------------------------------------

defineSurface("room-elfwood", "Llanowar's living boards, moss in their seams", {}, () => ({ picture: P.elfFloor(), priority: 1 }));
defineSurface("room-bogwood", "the Morass's black boards, mud in the gaps", {}, () => ({ picture: P.bogFloor(), priority: 1 }));
defineSurface("room-keld-flags", "Keld's cold dark flags", {}, () => ({ picture: T.flagstones(P.KELD_STONE, 54), priority: 1 }));
defineSurface("room-mosaic", "a Tolarian mosaic of white tiles and blue diamonds", {}, () => ({ picture: P.mosaic(), priority: 1 }));
defineSurface("room-tolarian-flags", "pale Tolarian flags", {}, () => ({ picture: T.flagstones(P.TOLARIAN, 55), priority: 2 }));
defineSurface("room-parquet", "a herringbone parquet, polished", {}, () => ({ picture: P.parquet(), priority: 1 }));
defineSurface("room-marble", "white marble slabs, veined", {}, () => ({ picture: P.marble(), priority: 1 }));
defineSurface("room-checker", "black and white marble in a checker (the Vess estate)", {}, () => ({ picture: P.marble(P.MARBLE, 56, P.KELD_STONE), priority: 1 }));
defineSurface("room-stone", "a workshop's grey flags", {}, () => ({ picture: T.flagstones(C.COBBLE, 57), priority: 1 }));
defineSurface("room-earth", "beaten earth strewn with straw", {}, () => ({ picture: T.straw(58), priority: 1 }));
defineSurface("room-mossy-flags", "flags furred with moss, before a Llanowar fire", {}, () => ({ picture: T.flagstones([0x1a2a1c, 0x2a3e26, 0x3c5430, 0x506a3a, 0x688646, 0x86a256], 59), priority: 2 }));

// --- The furniture's palettes --------------------------------------------------------------------------------------------------

definePalette("room-benalish", {});
definePalette("room-llanowar", { timber: P.ELFWOOD, darkTimber: P.ELFWOOD.slice(1, 6), cloth: C.GREEN.concat([0x48b058, 0x78d080]) });
definePalette("room-morass", { timber: P.BOGWOOD, darkTimber: BOG_TIMBER, cloth: C.PURPLE.concat([0xb080d8, 0xd0a8f0]) });
definePalette("room-keldon", { timber: C.WOOD, darkTimber: C.DARKWOOD, cloth: C.RED.concat([0xffb090]) });
definePalette("room-tolarian", { timber: C.WOOD, darkTimber: C.DARKWOOD, cloth: C.BLUE.concat([0xb8dcff]) });
definePalette("room-vess", { timber: C.DARKWOOD.concat([0x8a5a44, 0xa87050]), darkTimber: C.DARKWOOD, cloth: P.VESS_RED.concat([0xc05a6a]) });

/** A flat color as a tiled face (a brass rod, a gilt edge). */
export const flatFace = (color: number): Face => tiled(flat(color));
