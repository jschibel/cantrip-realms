import type { PropData } from "../../world/format";
import { MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import { Pixmap } from "../paint/pixmap";
import { drawn } from "./registry";

// Furniture the room recipes (art/rooms/layout.ts) and the dungeon floors furnish with, beyond the slice's own
// (indoors.ts). Each entry says where its anchor is; things against a wall take its face's z and turn with `rot` (1
// west, 2 north, 3 east, as a building's), standing things are placed by their middle on the floor.

/** A turn for a free-standing piece: its `rot` in quarter turns as a building's, and its `turn`. */
export const pieceTurn = (p: PropData): number => (-(p.rot ?? 0) * Math.PI) / 2 - (p.turn ?? 0);

/** Draws a free-standing piece about its middle: `draw()` round (0, 0), turned to face its way. */
export function standing(b: MeshBuilder, p: PropData, draw: () => void): void {
  b.at(p.x, p.y ?? 0, p.z, pieceTurn(p), draw);
}

const candleFlame = () => material("candle-flame", () => new Pixmap(2, 2, C.FIRE[4]!), { glowing: true });

/** A candle on a dish, standing at y, its middle at x, z (in the builder's frame). */
export function smallCandle(b: MeshBuilder, x: number, y: number, z: number, h = 0.22): void {
  b.box(x - 0.08, y, z - 0.08, x + 0.08, y + 0.04, z + 0.08, sides(flat(C.GOLD[2]!)));
  b.box(x - 0.04, y + 0.04, z - 0.04, x + 0.04, y + 0.04 + h, z + 0.04, sides(flat(0xf4ecd4)));
  b.box(x - 0.03, y + 0.04 + h, z - 0.03, x + 0.03, y + 0.14 + h, z + 0.03, sides(candleFlame()));
}

// --- The spell table -----------------------------------------------------------------------------------------------------

/** A spell table's cloth: the guild's violet, a gold border and its sigil, 24 by 16. */
function spellCloth(): Pixmap {
  const v = C.PURPLE;
  const p = new Pixmap(24, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 24; x++) {
      let c = (x * 3 + y * 5) % 7 === 0 ? v[2]! : v[3]!;
      if (x === 0 || y === 0 || x === 23 || y === 15) c = C.GOLD[2]!;
      else if (x === 1 || y === 1 || x === 22 || y === 14) c = v[1]!;
      p.set(x, y, c);
    }
  }
  // The five-pointed sigil at the middle, in gold thread.
  for (const [x, y] of [[11, 4], [12, 4], [9, 6], [14, 6], [10, 9], [13, 9], [11, 11], [12, 11], [8, 7], [15, 7], [11, 7], [12, 7]] as const) p.set(x, y, C.GOLD[4]!);
  return p;
}

/** An open spellbook: two pages of runes, 12 by 8. */
function spellbook(): Pixmap {
  const p = new Pixmap(12, 8, 0xf0dcaa);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 11; x++) if (x !== 5 && x !== 6 && (x * 5 + y * 3) % 4 === 0) p.set(x, y, y % 3 ? C.PURPLE[3]! : 0x6a4a38);
  p.vline(5, 0, 8, 0xb89868);
  p.vline(6, 0, 8, 0xd8c090);
  for (let x = 0; x < 12; x++) p.set(x, 7, C.PURPLE[1]!);
  return p;
}

/** A deck's back: blue and gold, 4 by 6. */
function deckBack(): Pixmap {
  const p = new Pixmap(4, 6, C.BLUE[2]!);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) p.set(x, y, C.BLUE[3]!);
  p.set(1, 2, C.GOLD[4]!);
  p.set(2, 3, C.GOLD[4]!);
  return p;
}

drawn("spell-table", "a spell table, its middle at x, z (1.5 by 1): a violet cloth, a spellbook, decks and a candle; rot turns it", (b, p) => {
  const timber = tiled(stock.timber());
  const dark = tiled(stock.darkTimber());
  const cloth = material("spell-cloth", () => spellCloth());
  standing(b, p, () => {
    for (const [lx, lz] of [[-0.62, -0.38], [0.5, -0.38], [-0.62, 0.26], [0.5, 0.26]] as const) b.box(lx, 0, lz, lx + 0.12, 0.72, lz + 0.12, sides(dark));
    b.box(-0.75, 0.72, -0.5, 0.75, 0.82, 0.5, sides(timber, timber));
    // The cloth over the top, hanging a little down the front and the back.
    b.box(-0.6, 0.82, -0.52, 0.6, 0.83, 0.52, { top: fitted(cloth) });
    b.box(-0.6, 0.62, 0.5, 0.6, 0.83, 0.52, { south: fitted(cloth, [0, 0, 24, 4]) });
    b.box(-0.6, 0.62, -0.52, 0.6, 0.83, -0.5, { north: fitted(cloth, [0, 12, 24, 4]) });
    b.box(-0.3, 0.83, -0.25, 0.18, 0.87, 0.07, { top: fitted(material("spellbook", () => spellbook())), south: dark, east: dark, west: dark });
    const back = fitted(material("deck-back", () => deckBack()));
    b.box(0.3, 0.83, -0.2, 0.48, 0.95, 0.06, { top: back, south: tiled(flat(0xf4ecd4)), east: tiled(flat(0xe0d8c4)), west: tiled(flat(0xe0d8c4)), north: tiled(flat(0xe0d8c4)) });
    b.box(0.32, 0.83, 0.14, 0.5, 0.88, 0.4, { top: back, south: tiled(flat(0xf4ecd4)), east: tiled(flat(0xe0d8c4)) });
    smallCandle(b, -0.5, 0.83, 0.25);
  });
});
