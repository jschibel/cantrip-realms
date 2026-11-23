import { fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, painted, stock } from "../paint/materials";
import type { Ramp } from "../paint/palette";
import { Pixmap } from "../paint/pixmap";
import * as RP from "../rooms/paint";
import { WOOD_PALETTE, smallCandle, standing, wallPiece, woods } from "./furnish";
import { bool, drawn, num } from "./registry";

// A temple's furniture: its altar on a dais, its pews, columns, stained glass and font. Stone takes the palette's
// `stone` (marble by default), cloth its `cloth`.

const SACRED = { ...WOOD_PALETTE, stone: RP.MARBLE, cloth: C.BLUE.concat([0xb8dcff]) };

const stoneFace = (r: Ramp) => tiled(painted("altar-stone", r, RP.MARBLE, (q) => RP.marble(q, 61)));

drawn(
  "altar",
  "an altar, its middle at x, z (2 by 1), its cloth of the palette's, candles and a book on it; args.dais a stepped dais under it (3.5 by 2.5)",
  (b, p, pal) => {
    const stone = stoneFace(pal.stone!);
    const cloth = painted("altar-cloth", pal.cloth!, SACRED.cloth, (r) => altarCloth(r));
    standing(b, p, () => {
      let y = 0;
      if (bool(p, "dais")) {
        b.box(-1.75, 0, -1.25, 1.75, 0.1875, 1.25, sides(stone));
        b.box(-1.375, 0.1875, -1.0, 1.375, 0.375, 0.75, sides(stone));
        y = 0.375;
      }
      b.box(-1, y, -0.45, 1, y + 0.95, 0.45, sides(stone));
      b.box(-1.06, y + 0.95, -0.5, 1.06, y + 1.05, 0.5, sides(stone));
      b.box(-0.55, y + 0.45, 0.5, 0.55, y + 1.06, 0.52, { south: fitted(cloth) });
      b.box(-0.55, y + 1.05, -0.3, 0.55, y + 1.06, 0.52, { top: fitted(cloth, [0, 0, 12, 4]) });
      for (const x of [-0.8, 0.8]) smallCandle(b, x, y + 1.05, 0, 0.32);
      b.box(-0.2, y + 1.05, -0.2, 0.2, y + 1.12, 0.1, { top: fitted(material("spellbook-gold", () => holyBook())), south: tiled(flat(C.RED[1]!)), east: tiled(flat(C.RED[1]!)) });
    });
  },
  SACRED,
);

drawn(
  "pew",
  "a pew, its middle at x, z, args.len long (3) along x, its seat to the north and its back to the south (facing north) unless rot turns it",
  (b, p, pal) => {
    const len = num(p, "len", 3);
    const { timber, dark, boards } = woods(pal);
    standing(b, p, () => {
      for (const x of [-len / 2, len / 2 - 0.1]) b.box(x, 0, -0.3, x + 0.1, 0.9, 0.3, sides(dark));
      b.box(-len / 2, 0.4, -0.3, len / 2, 0.48, 0.15, sides(timber, boards));
      b.box(-len / 2, 0.48, 0.15, len / 2, 0.95, 0.25, sides(timber));
      b.box(-len / 2, 0.95, 0.12, len / 2, 1.0, 0.28, sides(dark));
    });
  },
  WOOD_PALETTE,
);

drawn("column", "a round column, its middle at x, z, args.h high (3.5), of the palette's stone, on a base under a capital", (b, p, pal) => {
  const h = num(p, "h", 3.5);
  const stone = painted("column-stone", pal.stone!, RP.MARBLE, (r) => RP.marble(r, 62));
  const { x, z } = p;
  b.box(x - 0.42, 0, z - 0.42, x + 0.42, 0.25, z + 0.42, sides(tiled(stone)));
  b.cylinder(x, z, 0.25, h - 0.3, 0.28, 10, { mat: stone }, undefined, 0.04, 2);
  b.box(x - 0.4, h - 0.3, z - 0.4, x + 0.4, h - 0.12, z + 0.4, sides(tiled(stone)));
  b.box(x - 0.46, h - 0.12, z - 0.46, x + 0.46, h, z + 0.46, sides(tiled(stone)));
}, { stone: RP.MARBLE });

drawn("stained-window", "a stained-glass window in a wall (its face at z), its middle at x, its sill at y (1.25), args.w by args.h (1 by 2); its seed", (b, p) => {
  const w = num(p, "w", 1);
  const h = num(p, "h", 2);
  const y = p.y ?? 1.25;
  const seed = p.seed ?? 1;
  const glass = fitted(material(`stained-${seed}-${w}-${h}`, () => RP.stainedGlass(seed, Math.round(w * 16), Math.round(h * 16)), { glowing: true, cutout: true }));
  wallPiece(b, p, () => {
    b.card(glass, -w / 2, y, w / 2, y + h, 0.03);
    b.box(-w / 2 - 0.1, y - 0.1, 0, w / 2 + 0.1, y, 0.12, sides(tiled(stock.limestone())));
  });
});

drawn("font", "a font of holy water on a pedestal, its middle at x, z", (b, p, pal) => {
  const stone = painted("column-stone", pal.stone!, RP.MARBLE, (r) => RP.marble(r, 62));
  const { x, z } = p;
  b.cylinder(x, z, 0, 0.15, 0.32, 8, { mat: stone }, { mat: stone });
  b.cylinder(x, z, 0.15, 0.7, 0.14, 8, { mat: stone });
  b.cylinder(x, z, 0.7, 0.95, 0.42, 10, { mat: stone }, undefined, -0.15);
  b.ring(x, z, 0.95, 0.34, 0.42, 10, stone);
  b.cylinder(x, z, 0.7, 0.9, 0.34, 10, { mat: flat(C.WATER[4]!) }, { mat: material("font-water", () => holyWater(), { glow: 0.3 }) });
}, { stone: RP.MARBLE });

drawn("candle-rack", "a rack of votive candles, its middle at x, z, rows climbing to the north (1.25 wide)", (b, p) => {
  const iron = flat(C.IRON[2]!);
  standing(b, p, () => {
    for (let row = 0; row < 3; row++) {
      const y = 0.55 + row * 0.18;
      const z = 0.15 - row * 0.15;
      b.box(-0.625, 0, z - 0.06, 0.625, y, z + 0.06, sides(iron));
      for (let k = 0; k < 5; k++) smallCandle(b, -0.5 + k * 0.25, y, z, 0.08 + ((k + row) % 3) * 0.04);
    }
  });
});

// --- Pictures ----------------------------------------------------------------------------------------------------------

function altarCloth(r: Ramp): Pixmap {
  const p = new Pixmap(12, 10, r[3]!);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) if (x === 0 || x === 11 || y === 9) p.set(x, y, C.GOLD[3]!);
  for (let y = 3; y < 8; y++) p.set(5, y, C.GOLD[4]!), p.set(6, y, C.GOLD[4]!);
  for (let x = 3; x < 9; x++) p.set(x, 4, C.GOLD[4]!);
  return p;
}

function holyBook(): Pixmap {
  const p = new Pixmap(8, 6, 0xf4e8c8);
  p.vline(3, 0, 6, 0xb89868);
  p.vline(4, 0, 6, 0xd8c090);
  for (let y = 1; y < 5; y++) for (const x of [1, 6]) p.set(x, y, 0x806040);
  p.hline(0, 5, 8, C.RED[2]!);
  return p;
}

function holyWater(): Pixmap {
  const p = new Pixmap(8, 8, C.WATER[4]!);
  for (const [x, y] of [[2, 2], [5, 4], [3, 6]] as const) p.set(x, y, C.WATER[6]!);
  return p;
}

