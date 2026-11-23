import type { PropData } from "../../world/format";
import { type Face, MeshBuilder, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, painted, stock } from "../paint/materials";
import type { Palette, Ramp } from "../paint/palette";
import { Pixmap } from "../paint/pixmap";
import * as RP from "../rooms/paint";

// The furniture's drawing kit (furniture.ts and the files beside it): how a free-standing piece is placed and turned,
// how a thing against a wall is, the woods a palette gives, and a candle.

export const PX = 1 / 16;

/** A free-standing piece's turn: its `rot` in quarter turns as a building's, and its `turn`. */
export const pieceTurn = (p: PropData): number => (-(p.rot ?? 0) * Math.PI) / 2 - (p.turn ?? 0);

/** Draws a piece about its anchor: `draw()` round (0, 0) at its foot, turned to face its way. */
export function standing(b: MeshBuilder, p: PropData, draw: () => void): void {
  const turn = pieceTurn(p);
  b.at(p.x, p.y ?? 0, p.z, turn, draw);
}

/** Where a point `dx`, `dz` from a piece's anchor (in its own frame) lands once it is turned: a flame's foot. */
export function spotOf(p: PropData, dx: number, dz: number): [number, number] {
  const t = pieceTurn(p);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [p.x + dx * c + dz * s, p.z - dx * s + dz * c];
}

/** The woods and cloth of a palette, as faces. */
export function woods(pal: Palette): { timber: Face; dark: Face; boards: Face } {
  return { timber: tiled(stock.timber(pal.timber)), dark: tiled(stock.darkTimber(pal.darkTimber)), boards: tiled(woodTop(pal.timber)) };
}

/** A table's or a seat's top: boards from the palette's timber. */
export const woodTop = (ramp: Ramp | undefined): ReturnType<typeof material> =>
  ramp ? painted("boards", ramp, C.WOOD, (r) => RP.planks(r.length >= 7 ? r : C.WOOD, 5)) : stock.boards();

export const WOOD_PALETTE: Palette = { timber: C.WOOD, darkTimber: C.DARKWOOD, cloth: C.RED };

const candleFlame = () => material("candle-flame", () => new Pixmap(2, 2, C.FIRE[4]!), { glowing: true });

/** A candle on a dish, standing at y, its middle at x, z (in the builder's frame). */
export function smallCandle(b: MeshBuilder, x: number, y: number, z: number, h = 0.22): void {
  b.box(x - 0.08, y, z - 0.08, x + 0.08, y + 0.04, z + 0.08, sides(flat(C.GOLD[2]!)));
  b.box(x - 0.04, y + 0.04, z - 0.04, x + 0.04, y + 0.04 + h, z + 0.04, sides(flat(0xf4ecd4)));
  b.box(x - 0.03, y + 0.04 + h, z - 0.03, x + 0.03, y + 0.14 + h, z + 0.03, sides(candleFlame()));
}

/** Draws a wall piece in its wall's frame: `draw()` with its anchor at (0, 0), the wall's face at z = 0, facing south. */
export function wallPiece(b: MeshBuilder, p: PropData, draw: () => void): void {
  b.at(p.x, 0, p.z, pieceTurn(p), draw);
}

