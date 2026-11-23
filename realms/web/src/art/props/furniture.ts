import type { PropData } from "../../world/format";
import { type Face, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, painted, stock } from "../paint/materials";
import type { Ramp } from "../paint/palette";
import * as Pic from "../paint/pictures";
import { Pixmap, hash2 } from "../paint/pixmap";
import * as RP from "../rooms/paint";
import * as D from "./draw";
import { PX, WOOD_PALETTE, smallCandle, standing, wallPiece, woods } from "./furnish";
import { bool, drawn, num, point } from "./registry";

// Furniture the room recipes (art/rooms/layout.ts) and the dungeon floors furnish with, beyond the slice's own
// (indoors.ts): what a house, an inn, a guildhall and a shop hold, here; a temple's, a smithy's and a scholar's or a
// mage's in their own files below. Each entry says where its anchor is. A free-standing piece is placed by its middle
// on the floor (or at y) and faces south unless `rot` turns it (quarter turns, as a building's: 1 west, 2 north,
// 3 east); a thing against a wall takes its wall's face at z and turns with `rot` the same way. Pieces of wood take the
// palette's `timber` and `darkTimber`, cloth its `cloth` (a room's style names one: `tint: "room-<style>"`).

/** Four legs under a top `w` by `d` (round the middle), `h` high. */
function legs(b: MeshBuilder, w: number, d: number, h: number, face: Face, inset = 0.06, size = 0.1): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - inset) - (sx > 0 ? size : 0);
    const z = sz * (d / 2 - inset) - (sz > 0 ? size : 0);
    b.box(x, 0, z, x + size, h, z + size, sides(face));
  }
}

// --- Tables and seats -----------------------------------------------------------------------------------------------------

drawn(
  "table",
  "a table, its middle at x, z, args.w by args.d (1.5 by 1), args.cloth a runner of the palette's cloth down it",
  (b, p, pal) => {
    const w = num(p, "w", 1.5);
    const d = num(p, "d", 1);
    const { timber, dark, boards } = woods(pal);
    standing(b, p, () => {
      legs(b, w, d, 0.69, dark);
      b.box(-w / 2, 0.69, -d / 2, w / 2, 0.8125, d / 2, sides(timber, boards));
      if (bool(p, "cloth")) {
        const cloth = painted("runner-cloth", pal.cloth!, C.RED, (r) => runnerCloth(r));
        b.box(-w / 2 + 0.2, 0.8125, -d / 2 - 0.01, w / 2 - 0.2, 0.825, d / 2 + 0.01, { top: tiled(cloth), south: tiled(cloth), north: tiled(cloth) });
      }
    });
  },
  WOOD_PALETTE,
);

drawn(
  "chair",
  "a chair, its middle at x, z, facing south (its back to the north) unless rot turns it",
  (b, p, pal) => {
    const { timber, dark, boards } = woods(pal);
    standing(b, p, () => {
      legs(b, 0.5, 0.5, 0.44, dark, 0.02, 0.07);
      b.box(-0.25, 0.44, -0.25, 0.25, 0.5, 0.25, sides(timber, boards));
      b.box(-0.25, 0.5, -0.25, 0.25, 1.1, -0.18, sides(timber));
      b.box(-0.18, 0.62, -0.26, 0.18, 0.98, -0.17, sides(dark));
    });
  },
  WOOD_PALETTE,
);

drawn(
  "bench-seat",
  "a backless bench, its middle at x, z, args.len long (2) along x unless rot turns it",
  (b, p, pal) => {
    const len = num(p, "len", 2);
    const { timber, dark, boards } = woods(pal);
    standing(b, p, () => {
      for (const x of [-len / 2 + 0.1, len / 2 - 0.22]) b.box(x, 0, -0.15, x + 0.12, 0.42, 0.15, sides(dark));
      b.box(-len / 2, 0.42, -0.2, len / 2, 0.5, 0.2, sides(timber, boards));
    });
  },
  WOOD_PALETTE,
);

drawn(
  "tankards",
  "a meal on a table: tankards and a plate round x, z, at y (the table's top); its seed which",
  (b, p) => {
    const y = p.y ?? 0.8125;
    const pewter = flat(C.IRON[4]!);
    const ale = flat(C.GOLD[4]!);
    const seed = p.seed ?? 1;
    const spots = [[-0.3, -0.1], [0.25, 0.15], [0.05, -0.25]] as const;
    spots.forEach(([dx, dz], i) => {
      if (hash2(i, seed, 3) < 0.25) return;
      b.cylinder(p.x + dx, p.z + dz, y, y + 0.18, 0.07, 6, { mat: pewter }, { mat: ale });
      b.box(p.x + dx + 0.06, y + 0.05, p.z + dz - 0.015, p.x + dx + 0.11, y + 0.14, p.z + dz + 0.015, sides(pewter));
    });
    b.cylinder(p.x - 0.05, p.z + 0.2, y, y + 0.03, 0.16, 8, { mat: flat(0xd8d0c0) }, { mat: material("plate", () => plate()) });
  },
);

// --- A house ----------------------------------------------------------------------------------------------------------------

drawn(
  "bed",
  "a bed, its head against a wall (its face at z), its middle across at x, running south 2 tiles; rot turns it; its seed the quilt's pattern",
  (b, p, pal) => {
    const { timber, dark } = woods(pal);
    const quilt = painted(`quilt-${p.seed ?? 2}`, pal.cloth!, C.RED, (r) => RP.quilt(r, p.seed ?? 2));
    standing(b, p, () => {
      // The headboard, the frame and the mattress under the quilt.
      b.box(-0.5, 0, 0, 0.5, 1.0, 0.12, sides(dark));
      b.box(-0.45, 0.85, 0.11, 0.45, 0.95, 0.14, sides(timber));
      b.box(-0.5, 0.15, 0.12, 0.5, 0.42, 1.92, sides(timber));
      b.box(-0.5, 0, 1.82, 0.5, 0.6, 1.94, sides(dark));
      b.box(-0.46, 0.42, 0.14, 0.46, 0.6, 1.84, { top: fitted(quilt), south: fitted(quilt, [0, 22, 16, 2]), east: fitted(quilt, [0, 6, 16, 3]), west: fitted(quilt, [0, 6, 16, 3]) });
      for (const x of [-0.5, 0.38]) for (const z of [0.12, 1.7]) b.box(x, 0, z, x + 0.12, 0.2, z + 0.12, sides(dark));
    });
  },
  WOOD_PALETTE,
);

drawn(
  "chest",
  "a chest bound in iron, its middle at x, z, its lock to the south unless rot turns it",
  (b, p, pal) => {
    const { timber } = woods(pal);
    const iron = flat(C.IRON[2]!);
    standing(b, p, () => {
      b.roundedBox(-0.4, 0, -0.25, 0.4, 0.42, 0.25, PX, sides(timber));
      b.roundedBox(-0.42, 0.42, -0.27, 0.42, 0.56, 0.27, PX, sides(timber));
      for (const x of [-0.3, 0.22]) b.box(x, 0, -0.27, x + 0.08, 0.57, 0.28, sides(iron));
      b.box(-0.06, 0.32, 0.27, 0.06, 0.46, 0.29, sides(flat(C.GOLD[3]!)));
    });
  },
  WOOD_PALETTE,
);

drawn(
  "wardrobe",
  "a tall cupboard against a wall (its face at z) from x, args.w wide (1), its doors to the south; rot turns it",
  (b, p, pal) => {
    const w = num(p, "w", 1);
    const { timber, dark } = woods(pal);
    const doors = fitted(painted("wardrobe-doors", pal.timber!, C.WOOD, (r) => cupboardDoors(r)));
    wallPiece(b, p, () => {
      b.box(0, 0, 0, w, 2.1, 0.6, { south: doors, east: timber, west: timber, top: dark });
      b.box(-0.05, 2.1, 0, w + 0.05, 2.22, 0.66, sides(dark));
      b.box(-0.02, 0, 0, w + 0.02, 0.12, 0.64, sides(dark));
    });
  },
  WOOD_PALETTE,
);

drawn("plant", "a potted plant, its middle at x, z (at y)", (b, p, pal) => {
  const y = p.y ?? 0;
  D.pot(b, p.x, p.z, y, 0.17);
  b.blob(p.x, y + 0.48, p.z, 0.26, 0.24, 0.26, stock.leaves(pal.leaves), [p.x * 16, p.z * 16]);
  b.blob(p.x + 0.1, y + 0.66, p.z - 0.05, 0.14, 0.14, 0.14, stock.leaves(pal.leaves), [3, 5]);
}, { leaves: C.LEAF });

drawn("candle-stand", "a tall iron candlestand with three candles, its middle at x, z (its light is the room's data)", (b, p) => {
  const iron = flat(C.IRON[2]!);
  const { x, z } = p;
  b.cylinder(x, z, 0, 0.06, 0.22, 6, { mat: iron }, { mat: iron });
  b.cylinder(x, z, 0.06, 1.25, 0.04, 6, { mat: iron });
  b.box(x - 0.3, 1.2, z - 0.03, x + 0.3, 1.25, z + 0.03, sides(iron));
  for (const dx of [-0.28, 0, 0.28]) smallCandle(b, x + dx, dx === 0 ? 1.3 : 1.25, z, 0.2);
});

drawn("wall-lamp", "a lantern on a bracket on a wall (its face at z) at x, its foot at y (1.6)", (b, p) => {
  wallPiece(b, p, () => D.wallLamp(b, 0, p.y ?? 1.6, 0));
});

drawn("carpet", "a carpet of the palette's cloth from x, z to args.to", (b, p, pal) => {
  const [x1, z1] = point(p, "to");
  const pic = painted("carpet", pal.cloth!, C.RED, (r) => carpet(r));
  b.box(p.x, 0, p.z, x1, PX, z1, { top: fitted(pic) });
}, WOOD_PALETTE);

drawn("fur-rug", "a fur rug from x, z to args.to", (b, p) => {
  const [x1, z1] = point(p, "to");
  b.decal(fitted(material("fur", () => fur(), { cutout: true })), p.x, p.z, x1, z1, 0.01);
});

// --- An inn -----------------------------------------------------------------------------------------------------------------

drawn(
  "bar-counter",
  "a bar's counter from x, z to args.to (a rectangle), panelled on every side, a brass rail along its south foot",
  (b, p, pal) => {
    const [x1, z1] = point(p, "to");
    const front = tiled(material("counter", () => Pic.counterFront()));
    const { boards, dark } = woods(pal);
    b.box(p.x, 0, p.z, x1, 1.0, z1, { south: front, north: front, west: front, east: front, top: boards });
    b.box(p.x - 0.1, 1.0, p.z - 0.1, x1 + 0.1, 1.0625, z1 + 0.1, sides(dark));
    b.box(p.x, 0.12, z1 + 0.08, x1, 0.18, z1 + 0.14, sides(flat(C.GOLD[3]!)));
  },
  WOOD_PALETTE,
);

drawn("bar-shelf", "shelves of bottles against a wall (its face at z) from x, args.w wide (2)", (b, p, pal) => {
  const w = num(p, "w", 2);
  const { dark } = woods(pal);
  const bottles = fitted(material(`bar-shelf-${p.seed ?? 3}`, () => RP.barShelf(p.seed ?? 3)));
  wallPiece(b, p, () => {
    b.box(0, 0.9, 0, w, 2.4, 0.3, { south: bottles, east: dark, west: dark, top: dark });
    b.box(-0.06, 2.4, 0, w + 0.06, 2.5, 0.36, sides(dark));
    b.box(0, 0, 0, w, 0.9, 0.4, { south: tiled(material("counter", () => Pic.counterFront())), top: dark, east: dark, west: dark });
  });
}, WOOD_PALETTE);

drawn("keg-rack", "two kegs on a cradle against a wall (its face at z), their middle at x, their taps to the south", (b, p, pal) => {
  const { dark } = woods(pal);
  const end = fitted(material("keg-end", () => RP.kegEnd(), { cutout: true }));
  const staves = tiled(stock.timber());
  wallPiece(b, p, () => {
    b.box(-0.9, 0, 0.05, 0.9, 0.3, 0.75, sides(dark));
    for (const x of [-0.45, 0.45]) {
      b.roundedBox(x - 0.38, 0.3, 0.02, x + 0.38, 1.06, 0.8, 2 * PX, { south: end, north: staves, east: staves, west: staves, top: staves });
      b.box(x - 0.03, 0.42, 0.8, x + 0.03, 0.5, 0.92, sides(flat(C.GOLD[3]!)));
    }
  });
}, WOOD_PALETTE);

drawn(
  "inn-stair",
  "a stair from the floor up to args.rise (2.75), its top step's north edge at x (its west side), z, descending south a tile wide; args.rail its open side (east|west)",
  (b, p, pal) => {
    const rise = num(p, "rise", 2.75);
    const steps = Math.round(rise / 0.1875);
    const { timber, dark, boards } = woods(pal);
    const tread = 0.25;
    const railX = railSide(p) === "west" ? p.x + 0.06 : p.x + 0.94;
    for (let i = 0; i < steps; i++) {
      const z0 = p.z + i * tread;
      const top = rise - i * 0.1875;
      b.box(p.x, 0, z0, p.x + 1, top, z0 + tread, { top: boards, south: timber, east: dark, west: dark });
      // The handrail on its open side: a baluster on every other step, the rail stepping down with the treads.
      if (i % 2 === 0) b.box(railX - 0.03, top, z0 + 0.1, railX + 0.03, top + 0.8, z0 + 0.16, sides(dark));
      b.box(railX - 0.05, top + 0.8, z0, railX + 0.05, top + 0.88, z0 + tread, sides(dark));
    }
    const foot = p.z + steps * tread;
    b.box(railX - 0.07, 0, foot - 0.2, railX + 0.07, 1.1, foot - 0.06, sides(dark));
  },
  WOOD_PALETTE,
);

const railSide = (p: PropData): string => (typeof p.args?.rail === "string" ? (p.args.rail as string) : "east");

// --- A guildhall --------------------------------------------------------------------------------------------------------------

drawn("guild-banner", "a banner of the palette's cloth on a rod against a wall (its face at z), its middle at x, its rod at y (2.6)", (b, p, pal) => {
  const cloth = pal.cloth!;
  const pic = painted("guild-banner", cloth, C.RED, (r) => Pic.banner(r.length >= 6 ? r : C.RED, C.GOLD));
  const y = p.y ?? 2.6;
  wallPiece(b, p, () => {
    b.box(-0.45, y - 0.05, 0, 0.45, y + 0.02, 0.12, sides(D.iron()));
    b.box(-0.5, y - 0.07, 0.08, -0.42, y + 0.04, 0.14, sides(D.gold()));
    b.box(0.42, y - 0.07, 0.08, 0.5, y + 0.04, 0.14, sides(D.gold()));
    b.card(fitted(pic), -0.375, y - 2, 0.375, y - 0.02, 0.1);
  });
}, WOOD_PALETTE);

drawn("tapestry", "a tapestry on a wall (its face at z) from x (2 wide), its foot at y (0.8); of the palette's cloth", (b, p, pal) => {
  const y = p.y ?? 0.8;
  const pic = painted("tapestry", pal.cloth!, C.GREEN, (r) => RP.tapestry(r, p.seed ?? 3));
  wallPiece(b, p, () => {
    b.card(fitted(pic), 0, y, 2, y + 2.8 * (2 / 2), 0.03);
    b.box(-0.08, y + 2.8, 0, 2.08, y + 2.88, 0.08, sides(D.iron()));
  });
}, { cloth: C.GREEN });

drawn("quest-board", "a board of notices on a wall (its face at z) from x (2 wide), its foot at y (0.9)", (b, p) => {
  const y = p.y ?? 0.9;
  wallPiece(b, p, () => {
    b.box(0, y, 0, 2, y + 1.25, 0.08, { south: fitted(material(`notices-${p.seed ?? 4}`, () => RP.noticeBoard(p.seed ?? 4))), top: tiled(stock.darkTimber()) });
  });
});

drawn("wall-map", "a map of the Domains on a wall (its face at z) from x (1.5 wide), its foot at y (1.2)", (b, p) => {
  const y = p.y ?? 1.2;
  wallPiece(b, p, () => b.box(0, y, 0, 1.5, y + 1.0, 0.05, { south: fitted(material("domains-map", () => RP.domainsMap())), top: tiled(stock.darkTimber()) }));
});

// --- The spell table -----------------------------------------------------------------------------------------------------

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
    const edge = tiled(flat(0xe0d8c4));
    b.box(0.3, 0.83, -0.2, 0.48, 0.95, 0.06, { top: back, south: tiled(flat(0xf4ecd4)), east: edge, west: edge, north: edge });
    b.box(0.32, 0.83, 0.14, 0.5, 0.88, 0.4, { top: back, south: tiled(flat(0xf4ecd4)), east: edge });
    smallCandle(b, -0.5, 0.83, 0.25);
  });
});

// --- Shared pieces --------------------------------------------------------------------------------------------------------------

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

/** A runner's cloth from a ramp, 16 by 16 to tile: a woven border and a stripe. */
function runnerCloth(r: Ramp): Pixmap {
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = (x + y) % 4 === 0 ? r[2]! : r[3]!;
      if (y === 1 || y === 14) c = C.GOLD[3]!;
      if (y === 0 || y === 15) c = r[1]!;
      if (y === 7 || y === 8) c = r[4] ?? r[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A plate with a loaf and a wedge of cheese, 8 by 8. */
function plate(): Pixmap {
  const p = new Pixmap(8, 8, 0xe8e0d0);
  p.rect(1, 2, 4, 3, C.WOOD[5]!);
  p.hline(1, 2, 4, C.WOOD[6]!);
  p.rect(5, 4, 2, 2, C.GOLD[4]!);
  p.set(0, 0, 0xc8c0b0);
  p.set(7, 7, 0xc8c0b0);
  return p;
}

/** A cupboard's doors, 16 by 34: two panelled doors, iron hinges and a latch. */
function cupboardDoors(r: Ramp): Pixmap {
  const p = new Pixmap(16, 34, r[3]!);
  for (let y = 0; y < 34; y++) {
    for (let x = 0; x < 16; x++) {
      const door = x < 8 ? x : x - 8;
      let c = r[3]!;
      if (door === 0 || y === 0 || y === 33) c = r[1]!;
      else if (door >= 2 && door <= 5 && ((y >= 3 && y <= 14) || (y >= 18 && y <= 30))) c = door === 2 || y === 3 || y === 18 ? r[2]! : r[4]!;
      p.set(x, y, c);
    }
  }
  for (const y of [5, 27]) {
    p.hline(0, y, 2, C.IRON[2]!);
    p.hline(14, y, 2, C.IRON[2]!);
  }
  p.rect(7, 16, 2, 2, C.GOLD[3]!);
  return p;
}

/** A carpet from a ramp, 48 by 32: a bordered field with a lozenge medallion. */
function carpet(r: Ramp): Pixmap {
  const w = 48;
  const h = 32;
  const p = new Pixmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, w - 1 - x, y, h - 1 - y);
      let c = r[2]!;
      if (edge < 1) c = r[1]!;
      else if (edge < 2) c = C.GOLD[3]!;
      else if (edge < 4) c = (x + y) % 3 === 0 ? r[1]! : r[3]!;
      else if (edge < 5) c = C.GOLD[2]!;
      else {
        const m = Math.abs(x - (w - 1) / 2) / 1.5 + Math.abs(y - (h - 1) / 2);
        if (m < 3) c = C.GOLD[4]!;
        else if (m < 5) c = r[4] ?? r[3]!;
        else if (m < 6) c = C.GOLD[3]!;
        else if ((x + y) % 5 === 0) c = r[3]!;
      }
      p.set(x, y, c);
    }
  }
  return p;
}

/** A pelt, 32 by 24, cut out: a ragged outline of grey-brown fur in tufts. */
function fur(): Pixmap {
  const p = new Pixmap(32, 24);
  p.fill(0, 0);
  const f = [0x3a3028, 0x5a4a3c, 0x7a6650, 0x9a8468, 0xbaa486];
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 32; x++) {
      const nx = (x - 15.5) / 15;
      const ny = (y - 11.5) / 11;
      const ragged = 0.85 + hash2(Math.floor(Math.atan2(ny, nx) * 6), 1, 9) * 0.2;
      if (nx * nx + ny * ny > ragged) continue;
      const t = hash2(x >> 1, y, 5);
      p.set(x, y, t < 0.2 ? f[1]! : t < 0.6 ? f[2]! : t < 0.9 ? f[3]! : f[4]!);
    }
  }
  return p;
}



export { PX, WOOD_PALETTE, pieceTurn, smallCandle, spotOf, standing, wallPiece, woodTop, woods } from "./furnish";
