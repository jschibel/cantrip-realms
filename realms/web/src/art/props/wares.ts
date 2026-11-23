import { fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import { Pixmap } from "../paint/pixmap";
import * as RP from "../rooms/paint";
import * as D from "./draw";
import { WOOD_PALETTE, standing, wallPiece, woods } from "./kit";
import { drawn, num, str } from "./registry";

// A shop's wares by what it trades in - cards in glass cases and crates of boosters, curios, weapons - and a shop of
// exotic wares' planar curios: cases of glowing oddments, a rift held open in a frame, lamps of coloured glass and a
// bubbling cauldron. Glows are glowing materials; their light is the room's data (layout.ts).

const glass = () => material("glass", () => glassPicture(), { cutout: true });

drawn("card-case", "a glass-topped case of cards for sale, its middle at x, z (1.5 by 0.75) along x unless rot turns it; its seed", (b, p, pal) => {
  const { timber, dark } = woods(pal);
  const cards = fitted(material(`card-display-${p.seed ?? 6}`, () => RP.cardDisplay(p.seed ?? 6)));
  standing(b, p, () => {
    b.box(-0.75, 0, -0.375, 0.75, 0.8, 0.375, { south: tiled(material("counter", () => counterPanel())), north: timber, east: timber, west: timber });
    b.box(-0.7, 0.8, -0.32, 0.7, 0.82, 0.32, { top: cards });
    b.box(-0.75, 0.82, -0.375, 0.75, 0.86, 0.375, { top: fitted(glass()) });
    b.box(-0.78, 0.8, -0.4, -0.7, 0.88, 0.4, sides(dark));
    b.box(0.7, 0.8, -0.4, 0.78, 0.88, 0.4, sides(dark));
  });
}, WOOD_PALETTE);

drawn("booster-crate", "an open crate of booster packs, its middle at x, z (at y); its seed the packs' colors", (b, p) => {
  const seed = p.seed ?? 1;
  D.crate(b, p.x, p.z, 0.6, undefined, p.y ?? 0, p.turn ?? 0);
  const y = (p.y ?? 0) + 0.6;
  for (let k = 0; k < 6; k++) {
    const x = p.x - 0.22 + (k % 3) * 0.16;
    const z = p.z - 0.12 + Math.floor(k / 3) * 0.2;
    const pack = fitted(material(`booster-${(seed + k) % 5}`, () => RP.boosterPack(seed + k)));
    b.box(x - 0.06, y - 0.08, z - 0.02, x + 0.06, y + 0.1, z + 0.02, { south: pack, north: pack, top: tiled(flat(0xd8d8e0)) });
  }
});

drawn("weapon-barrel", "a barrel of spears and staves, its middle at x, z", (b, p) => {
  D.barrel(b, p.x, p.z, 0.75);
  for (const [dx, dz, h] of [[-0.1, -0.08, 1.6], [0.08, 0.05, 1.45], [0.12, -0.1, 1.7], [-0.06, 0.12, 1.35]] as const) {
    b.box(p.x + dx - 0.025, 0.5, p.z + dz - 0.025, p.x + dx + 0.025, h, p.z + dz + 0.025, sides(tiled(stock.timber())));
    b.box(p.x + dx - 0.04, h, p.z + dz - 0.02, p.x + dx + 0.04, h + 0.16, p.z + dz + 0.02, sides(flat(C.IRON[5]!)));
  }
});

drawn("curio-case", "a tall glass cabinet of curios against a wall (its face at z) from x, args.w wide (1), glowing faintly; its seed", (b, p, pal) => {
  const w = num(p, "w", 1);
  const { timber, dark } = woods(pal);
  const seed = p.seed ?? 5;
  const shelves = fitted(material(`curios-${seed}`, () => RP.curios(seed), { glow: 0.35 }));
  wallPiece(b, p, () => {
    b.box(0, 0, 0, w, 0.7, 0.55, { south: tiled(material("counter", () => counterPanel())), east: timber, west: timber, top: dark });
    b.box(0.05, 0.7, 0.05, w - 0.05, 1.95, 0.45, { south: shelves, east: fitted(glass()), west: fitted(glass()) });
    for (const x of [0, w - 0.06]) b.box(x, 0.7, 0, x + 0.06, 2.0, 0.55, sides(dark));
    b.box(-0.04, 1.95, 0, w + 0.04, 2.08, 0.6, sides(dark));
  });
}, WOOD_PALETTE);

drawn("planar-rift", "a rift into another plane held open in a ring of iron and runes, its middle at x, z, standing a little proud of the floor; faces south unless rot turns it", (b, p) => {
  const rift = fitted(material("planar-rift", () => RP.rift(), { glowing: true, cutout: true }));
  const iron = flat(C.IRON[2]!);
  standing(b, p, () => {
    b.box(-0.6, 0, -0.25, 0.6, 0.15, 0.25, sides(tiled(stock.cryptStone())));
    b.card(rift, -0.75, 0.25, 0.75, 2.75, 0);
    for (const x of [-0.85, 0.75]) b.box(x, 0.15, -0.06, x + 0.1, 2.6, 0.06, sides(iron));
    b.box(-0.85, 2.6, -0.06, 0.85, 2.7, 0.06, sides(iron));
    for (const y of [0.7, 1.4, 2.1]) for (const x of [-0.84, 0.76]) b.box(x, y, 0.06, x + 0.08, y + 0.08, 0.07, sides(material("rune-glow", () => new Pixmap(2, 2, RP.ARCANE_TEAL[5]!), { glowing: true })));
  });
});

drawn("arcane-lamp", "a lamp of coloured glass on a stand, its middle at x, z; args.color violet|teal (its light is the room's data)", (b, p) => {
  const ramp = str<string>(p, "color", "violet") === "teal" ? RP.ARCANE_TEAL : RP.ARCANE;
  const iron = flat(C.IRON[2]!);
  const { x, z } = p;
  b.cylinder(x, z, 0, 0.05, 0.2, 6, { mat: iron }, { mat: iron });
  b.cylinder(x, z, 0.05, 1.5, 0.035, 6, { mat: iron });
  b.box(x - 0.14, 1.5, z - 0.14, x + 0.14, 1.85, z + 0.14, sides(material(`lamp-glass-${ramp[5]!.toString(16)}`, () => new Pixmap(4, 4, ramp[5]!), { glowing: true })));
  b.box(x - 0.18, 1.85, z - 0.18, x + 0.18, 1.92, z + 0.18, sides(iron));
});

drawn("cauldron", "an iron cauldron on three legs over embers, something green bubbling in it, its middle at x, z", (b, p) => {
  const iron = flat(C.IRON[1]!);
  const { x, z } = p;
  for (const a of [0.3, 2.4, 4.5]) b.box(x + Math.cos(a) * 0.3 - 0.04, 0, z + Math.sin(a) * 0.3 - 0.04, x + Math.cos(a) * 0.3 + 0.04, 0.3, z + Math.sin(a) * 0.3 + 0.04, sides(iron));
  b.cylinder(x, z, 0.2, 0.75, 0.42, 10, { mat: iron }, undefined, 0.2);
  b.ring(x, z, 0.75, 0.34, 0.44, 10, iron);
  b.cylinder(x, z, 0.5, 0.7, 0.36, 10, { mat: iron }, { mat: material("brew", () => brew(), { glowing: true }) });
});

drawn("relic-pedestal", "a relic on a cushion under a glass dome on a pedestal, its middle at x, z; its seed which relic", (b, p) => {
  const { x, z } = p;
  const stone = stock.limestone();
  b.box(x - 0.25, 0, z - 0.25, x + 0.25, 0.9, z + 0.25, sides(tiled(stone)));
  b.box(x - 0.2, 0.9, z - 0.2, x + 0.2, 0.98, z + 0.2, sides(flat(C.RED[2]!)));
  const hues = [C.GOLD[4]!, RP.ARCANE[5]!, RP.ARCANE_TEAL[5]!, C.RED[4]!];
  b.blob(x, 1.06, z, 0.08, 0.08, 0.08, material(`relic-${(p.seed ?? 0) % 4}`, () => new Pixmap(2, 2, hues[(p.seed ?? 0) % 4]!), { glowing: true }), [0, 0]);
  b.box(x - 0.17, 0.98, z - 0.17, x + 0.17, 1.3, z + 0.17, { south: fitted(glass()), east: fitted(glass()), west: fitted(glass()), top: fitted(glass()) });
});

/** Glass: clear, a highlight streak in its corner (cut out where it is clear). */
function glassPicture(): Pixmap {
  const p = new Pixmap(8, 8);
  p.fill(0, 0);
  for (let k = 0; k < 3; k++) p.set(1 + k, 1 + k, 0xffffff, 200);
  for (let x = 0; x < 8; x++) {
    p.set(x, 0, 0xc8e0f0, 150);
    p.set(x, 7, 0xc8e0f0, 150);
  }
  return p;
}

function counterPanel(): Pixmap {
  // The slice's counter front, painted the same (art/paint/pictures counterFront), named "counter" there too.
  const w = C.WOOD;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = w[4]!;
      const inPanel = x >= 3 && x <= 12 && y >= 3 && y <= 12;
      if (inPanel) {
        c = w[3]!;
        if (x === 3 || y === 3) c = w[2]!;
        if (x === 12 || y === 12) c = w[5]!;
      }
      if (x === 0) c = w[5]!;
      if (x === 15) c = w[2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

function brew(): Pixmap {
  const p = new Pixmap(8, 8, 0x3aa040);
  for (const [x, y] of [[1, 2], [5, 1], [3, 5], [6, 6]] as const) {
    p.set(x, y, 0x9ae070);
    p.set(x + 1, y, 0x6ac050);
  }
  return p;
}

