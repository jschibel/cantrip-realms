import type { InteriorData } from "../../world/format";
import { type Face, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import type { Palette } from "../paint/palette";
import * as Pic from "../paint/pictures";
import type { Built } from "../recipe";
import * as P from "./paint";
import { ROOMS } from "./registry";
import { exitGap, roomShell } from "./shell";
import { type Band, type Finish, finishOf } from "./styles";

// The square rooms: a shop, an inn or tavern, a guildhall, a temple, a smithy, a library, a house and a shop of exotic
// wares, each a shell in its style's finish (styles.ts) seen as a 16-bit RPG shows a room - the back wall standing full
// height, the side walls cut-aways toward the camera, the front wall cut down low with a gap for the way out - with its
// own light. What a kind changes is the shell's height, whether its walls are its style's stone, and what is built
// into it: an inn's gallery of rooms upstairs. Everything else in the room is its props (layout.ts lays them out).
//
// An interior's `params` the shell reads (layout.ts writes them):
//   gallery: {y, depth, from, to, doors: [x...]}   an inn's gallery along the back wall from x `from` to `to` at height
//                                        y, `depth` deep, with a door to a room upstairs at each x (its middle)

const THICKNESS = 0.75;
const FRONT = 0.6;

export interface HallKind {
  /** The back wall's height. */
  readonly height: number;
  /** Walls of the style's stone (a smithy). */
  readonly stone?: boolean;
  /** The fill's color and strength instead of the style's (exotic wares' violet). */
  readonly sky?: readonly [number, number, number];
  readonly fill?: number;
  /** The wall's face above its footing instead of the style's (exotic wares' drapes). */
  readonly upper?: () => Face;
}

/** The kinds' shells: how tall, of what. An inn with rooms upstairs is taller (`hallHeight`). */
export const HALLS: Readonly<Record<string, HallKind>> = {
  shop: { height: 3.0 },
  inn: { height: 3.25 },
  guildhall: { height: 3.5 },
  temple: { height: 4.25, stone: true },
  smithy: { height: 3.25, stone: true },
  library: { height: 3.5 },
  house: { height: 3.0 },
  "exotic-wares": { height: 3.25, sky: [0.5, 0.36, 0.72], fill: 0.6, upper: () => tiled(material("drapes-arcane", () => P.damask(P.ARCANE, 60))) },
};

/** An inn's gallery as its params give it. */
export interface Gallery {
  readonly y: number;
  readonly depth: number;
  /** Its ends along the back wall (default the whole wall). */
  readonly from?: number;
  readonly to?: number;
  readonly doors: readonly number[];
}

export function galleryOf(room: InteriorData): Gallery | null {
  const g = room.params?.gallery as Gallery | undefined;
  return g && typeof g.y === "number" ? g : null;
}

/** The height of a kind's back wall, an inn's raised over its gallery. */
export function hallHeight(room: InteriorData): number {
  const g = galleryOf(room);
  const base = HALLS[room.kind]?.height ?? 3;
  return g ? g.y + 2.0 : base;
}

function hall(room: InteriorData, pal: Palette): Built {
  const kind = HALLS[room.kind] ?? HALLS.shop!;
  const f = finishOf(room.style, pal);
  const { w: W, d: D } = room;
  const H = hallHeight(room);
  const b = new MeshBuilder();
  let bands: readonly Band[] = kind.stone ? f.stoneBands(H) : f.bands(H);
  if (kind.upper) {
    const upper = kind.upper();
    bands = bands.map((band, i) => (i === bands.length - 2 ? { ...band, face: upper } : band));
  }
  const gap = exitGap(room.entry[0]);
  const walls = roomShell(b, { width: W, depth: D, height: H, thickness: THICKNESS, front: FRONT, back: bands, side: kind.stone ? bands[bands.length - 2]!.face : f.side, top: f.top, exit: gap });
  // Posts in the back wall, framing it in bays.
  if (f.posts && !kind.stone) {
    const xs: number[] = [];
    for (let x = 0; x < W; x += f.posts.bay) xs.push(x);
    xs.push(W);
    const half = f.posts.width / 2;
    for (const x of xs) b.box(x - half, 0, 0, x + half, H, 0.1, sides(f.posts.face));
  }
  // The doorframe in the front wall.
  for (const x of [gap[0] - 0.125, gap[1]]) b.box(x, 0, D, x + 0.125, 0.8, D + THICKNESS, sides(f.frame));
  const gallery = galleryOf(room);
  if (gallery) drawGallery(b, W, gallery, f);
  return {
    model: b.model(),
    cutaways: walls,
    lights: [
      { kind: "hemisphere", sky: kind.sky ?? f.sky, ground: f.ground, intensity: (kind.fill ?? f.fill) * Math.PI },
      { kind: "directional", color: f.daylight.color, intensity: f.daylight.intensity * Math.PI, from: f.daylight.from },
    ],
    doorway: [(gap[0] + gap[1]) / 2, 0.8, D],
    // The view's reach, as the camera sees it: from the back wall's top to the front wall's foot.
    bounds: [-THICKNESS, -THICKNESS - H, W + THICKNESS, D + THICKNESS],
  };
}

/**
 * An inn's gallery: a walk of boards along the back wall at height `y`, on brackets, with a railing of turned balusters
 * and the doors of the rooms upstairs in the wall behind it, a lamp between each two.
 */
function drawGallery(b: MeshBuilder, W: number, g: Gallery, f: Finish): void {
  const boards = tiled(stock.boards());
  const beam = f.frame;
  const { y, depth } = g;
  const x0 = g.from ?? 0;
  const x1 = g.to ?? W;
  // The walk and its fascia, its open end closed.
  b.box(x0, y - 0.1875, 0, x1, y, depth, { top: boards, south: beam, bottom: beam, east: beam, west: beam });
  // Brackets under it, every two tiles.
  for (let x = x0 + 1; x < x1; x += 2) {
    b.box(x - 0.0625, y - 0.6875, 0, x + 0.0625, y - 0.1875, 0.125, sides(beam));
    b.box(x - 0.0625, y - 0.3125, 0.0625, x + 0.0625, y - 0.1875, depth - 0.0625, sides(beam));
  }
  // The railing along its front and its open end: a rail on posts, balusters between.
  const rail = y + 0.75;
  b.box(x0, rail, depth - 0.125, x1, rail + 0.0625, depth, sides(beam));
  for (let x = x0; x <= x1 + 0.01; x += 2) b.box(Math.min(x, x1) - 0.0625, y, depth - 0.125, Math.min(x, x1) + 0.0625, rail + 0.125, depth, sides(beam));
  for (let x = x0 + 0.25; x < x1; x += 0.25) if (Math.abs((x - x0) % 2) > 0.01) b.box(x - 0.03, y, depth - 0.09, x + 0.03, rail, depth - 0.03, sides(beam));
  const open = x0 > 0 ? x0 : x1 < W ? x1 : null;
  if (open !== null) {
    const ox = open === x0 ? x0 : x1 - 0.0625;
    b.box(ox, rail, 0, ox + 0.0625, rail + 0.0625, depth, sides(beam));
    for (let z = 0.15; z < depth - 0.1; z += 0.25) b.box(ox, y, z - 0.03, ox + 0.0625, rail, z + 0.03, sides(beam));
  }
  // The doors upstairs, each in a frame, a brass number plate.
  const door = fitted(material("door-upstairs", () => Pic.door(3)));
  for (const x of g.doors) {
    b.box(x - 0.5625, y, 0, x + 0.5625, y + 1.5, 0.04, sides(beam));
    b.card(door, x - 0.4375, y, x + 0.4375, y + 1.375, 0.05);
    b.box(x - 0.125, y + 1.0, 0.05, x + 0.125, y + 1.125, 0.07, sides(flat(C.GOLD[3]!)));
  }
}

for (const kind of Object.keys(HALLS)) {
  const about =
    kind === "inn"
      ? "an inn or a tavern in its style's finish; params.gallery {y, depth, doors} its rooms upstairs"
      : `a ${kind.replace("-", " ")} in its style's finish (style: benalish, llanowar, morass, keldon, tolarian, vess)`;
  ROOMS.define(kind, about, hall, { plaster: C.PLASTER, darkTimber: C.DARKWOOD });
}

