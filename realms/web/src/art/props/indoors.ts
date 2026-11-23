import { MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import * as Pic from "../paint/pictures";
import { Pixmap, seeded } from "../paint/pixmap";
import * as T from "../paint/textures";
import type { Frames } from "../recipe";
import * as D from "./draw";
import { bool, drawn, num, point } from "./registry";
import type { PropData } from "../../world/format";

// Furniture by id: a shop's hearth, shelves, counter and wares, and a crypt's ossuary, pillars, dais, braziers and
// coffins. Most stand against a room's back wall (z = 0, facing south) or on its floor; each says where its anchor is.
// Flames are flipbooks (`frames`) the renderer steps eight times a second; the light a fire gives is the room's data
// (InteriorData's `lights`, its `flicker` in step with the flames).

const PX = D.PX;

/** Three frames of a flame `n` texels high, drawn as upright cards by `card`. */
function flames(n: number, card: (b: MeshBuilder, face: ReturnType<typeof fitted>) => void): Frames {
  return {
    rate: 8,
    models: [0, 1, 2].map((f) => {
      const m = material(`flame-${f}-${n}`, () => Pic.flame(f, n), { glowing: true, cutout: true });
      const fb = new MeshBuilder();
      card(fb, fitted(m));
      return fb.model();
    }),
  };
}

/** A wall prop's turn: its `rot` in quarter turns as a building's (1 faces west, 2 north, 3 east), and its `turn`. */
const wallTurn = (p: PropData): number => (-(p.rot ?? 0) * Math.PI) / 2 - (p.turn ?? 0);

/**
 * Draws something that hangs on or stands against a wall: `draw(x, z)` with its wall's face at `z` (facing south) and
 * its middle or left at `x`, as each entry says. The wall is the prop's own `z` - a room's back wall is 0 - and its
 * `rot` turns it to face another way, about its anchor.
 */
function onWall(b: MeshBuilder, p: PropData, draw: (x: number, z: number) => void): void {
  const turn = wallTurn(p);
  if (turn === 0) draw(p.x, p.z);
  else b.at(p.x, 0, p.z, turn, () => draw(0, 0));
}

/**
 * Where a point `dx`, `dz` from a wall prop's anchor (in its own frame, facing south) lands once it is turned: a
 * flame's foot. Flames are cards facing the camera whatever wall they burn on, so they are drawn there unturned.
 */
function wallSpot(p: PropData, dx: number, dz: number): [number, number] {
  const t = wallTurn(p);
  if (t === 0) return [p.x + dx, p.z + dz];
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [p.x + dx * c + dz * s, p.z - dx * s + dz * c];
}

// --- A shop ------------------------------------------------------------------------------------------------------------

drawn("hearth", "a stone hearth against a wall (its face at z), its middle at x, its fire burning", (b, p) => {
  const hearth = material("hearth", () => Pic.hearth(44, 36));
  const stone = tiled(stock.cobbleWall());
  onWall(b, p, (x, z) => {
    b.box(x - 1.375, 0, z, x + 1.375, 2.25, z + 0.4, { south: fitted(hearth), top: stone, east: stone, west: stone });
    b.box(x - 1.5, 1.75, z, x + 1.5, 1.875, z + 0.55, sides(tiled(stock.timber())));
    b.box(x - 1.125, 2.25, z, x + 1.125, 3.0, z + 0.25, sides(stone));
  });
  const [fx, fz] = wallSpot(p, 0, 0.42);
  return { frames: [flames(16, (fb, face) => fb.card(face, fx - 0.5, 0.05, fx + 0.5, 1.05, fz))] };
});

drawn("candle", "a candle in a brass dish at x, z, standing at y", (b, p) => candle(b, p.x, p.y ?? 0, p.z));

drawn("skull", "a skull ornament on a shelf: its left at x, its foot at y, its face at z", (b, p) => {
  const y = p.y ?? 0;
  b.card(fitted(material("mantel-skull", () => Pic.skull(), { cutout: true })), p.x, y, p.x + 5 / 16, y + 5 / 16, p.z);
});

drawn("bookshelf", "a tall shelf against a wall (its face at z) from x, of books or (args.goods) bottled wares, its seed", (b, p) => {
  const goods = bool(p, "goods");
  const seed = p.seed ?? 5;
  const front = fitted(material(`shelf-${goods ? "goods" : "books"}-${seed}`, () => Pic.bookshelf(seed, goods)));
  onWall(b, p, (x, z) => b.box(x, 0, z, x + 1.0, 2.0, z + 0.45, { south: front, top: tiled(stock.darkTimber()), east: tiled(stock.timber()), west: tiled(stock.timber()) }));
});

drawn("back-window", "a window in a wall (its face at z), daylight behind it, from x to x + 1, its sill at y", (b, p) => {
  const y = p.y ?? 1.125;
  onWall(b, p, (x, z) => b.card(fitted(material("window-in", () => Pic.windowPicture(true), { glow: 0.6 })), x, y, x + 1, y + 1.125, z + 0.02));
});

drawn("poster", "a poster on a wall (its face at z): its left at x, its foot at y; its seed", (b, p) => {
  const seed = p.seed ?? 2;
  const y = p.y ?? 0;
  onWall(b, p, (x, z) => b.card(fitted(material(seed === 2 ? "poster-a" : `poster-${seed}`, () => Pic.poster(seed))), x, y, x + 0.625, y + 0.4375, z + 0.02));
});

drawn("blade-rack", "a rack of blades on a wall (its face at z), its middle at x, its foot at y", (b, p) => onWall(b, p, (x, z) => bladeRack(b, x, p.y ?? 1.25, z)));

drawn("shield", "a shield hung on a wall (its face at z): its left at x, its foot at y", (b, p) => {
  const y = p.y ?? 2.0;
  onWall(b, p, (x, z) => b.box(x, y, z, x + 0.625, y + 0.75, z + 0.06, { south: fitted(material("shield", () => shieldPicture())) }));
});

drawn(
  "shop-counter",
  "an L-shaped counter from x, z to args.to, its return running north on its west end",
  (b, p) => {
    const [x1, z1] = point(p, "to");
    const front = tiled(material("counter", () => Pic.counterFront()));
    const top = tiled(material("counter-top", () => T.floorboards(19)));
    b.box(p.x, 0, z1 - 0.75, x1, 1.0, z1, { south: front, north: front, west: front, east: front, top });
    b.box(p.x, 0, p.z, p.x + 0.75, 1.0, z1 - 0.75, { west: front, east: front, top, north: front });
    b.box(p.x - 0.125, 1.0, z1 - 0.875, x1 + 0.125, 1.0625, z1 + 0.125, sides(tiled(stock.darkTimber())));
  },
);

drawn("scales", "a merchant's brass scales at x, z, standing at y", (b, p) => scales(b, p.x, p.y ?? 0, p.z));
drawn("coins", "a heap of coin at x, z, at y", (b, p) => coins(b, p.x, p.y ?? 0, p.z));
drawn("ledger", "a ledger open on a counter: from x, z, at y", (b, p) => {
  const y = p.y ?? 0;
  b.box(p.x, y, p.z, p.x + 0.625, y + 0.0625, p.z + 0.5, { top: fitted(material("ledger", () => ledger())), south: tiled(stock.darkTimber()), east: tiled(stock.darkTimber()) });
});

drawn("card-table", "a table with a game of cards on it, from x, z (2 by 1)", (b, p) => {
  const { x, z } = p;
  b.box(x, 0.6875, z, x + 2, 0.8125, z + 1, sides(tiled(stock.timber()), tiled(stock.boards())));
  for (const [dx, dz] of [[0.125, 0.125], [1.75, 0.125], [0.125, 0.75], [1.75, 0.75]] as const) b.box(x + dx, 0, z + dz, x + dx + 0.125, 0.6875, z + dz + 0.125, sides(tiled(stock.darkTimber())));
  b.decal(fitted(material("cards", () => cardsPicture(), { cutout: true })), x + 0.375, z + 0.1875, x + 1.375, z + 0.8125, 0.82);
});

drawn("stool", "a stool at x, z", (b, p) => stool(b, p.x, p.z));

drawn("rug", "a rug from x, z to args.to", (b, p) => {
  const [x1, z1] = point(p, "to");
  b.box(p.x, 0, p.z, x1, PX, z1, { top: fitted(material("rug", () => Pic.rug(64, 40))) });
});

// --- A crypt -----------------------------------------------------------------------------------------------------------

const cryptDark = () => tiled(material("crypt-dark", () => T.ashlar([C.DUNGEON[0]!, ...C.DUNGEON.slice(0, 6)], 29, 8, 12, 20)));

drawn("ossuary", "a niche of skulls in a wall (its face at z), its middle at x", (b, p) => {
  const ossuary = material("ossuary", () => ossuaryPicture());
  onWall(b, p, (x, z) => b.box(x - 0.5625, 0.75, z - 0.05, x + 0.5625, 2.25, z + 0.01, { south: fitted(ossuary) }));
});

drawn("buttress", "a buttress of dark stone against a wall (its face at z), its middle at x, args.h high", (b, p) => {
  onWall(b, p, (x, z) => b.box(x - 0.1875, 0, z, x + 0.1875, num(p, "h", 3.2), z + 0.25, sides(cryptDark())));
});

drawn("tattered-banner", "a tattered banner on an iron rod against a wall (its face at z), its middle at x", (b, p) => {
  const banner = material("tattered", () => Pic.tatteredBanner(), { cutout: true, twoSided: true });
  onWall(b, p, (x, z) => {
    b.box(x - 0.4375, 2.75, z + 0.18, x + 0.4375, 2.8125, z + 0.3, sides(flat(C.IRON[2]!)));
    b.card(fitted(banner), x - 0.375, 0.75, x + 0.375, 2.75, z + 0.28);
  });
});

drawn("torch", "a torch in an iron sconce on a wall (its face at z) at x, its flame burning", (b, p) => {
  onWall(b, p, (x, z) => {
    b.box(x - 0.0625, 1.75, z + 0.25, x + 0.0625, 1.875, z + 0.6, sides(flat(C.IRON[2]!)));
    b.cylinder(x, z + 0.6, 1.875, 2.0, 0.125, 6, { mat: flat(C.IRON[3]!) }, { mat: flat(C.FIRE[0]!) });
  });
  const [fx, fz] = wallSpot(p, 0, 0.62);
  return { frames: [flameAt(fx, 1.95, fz, 10)] };
});

drawn("cobweb", "a cobweb: its corner at x, y, z, args.size across, args.flip to hang it from its right", (b, p) => {
  const web = material("cobweb", () => Pic.cobweb(), { cutout: true, twoSided: true });
  const size = num(p, "size", 1);
  const y = p.y ?? 0;
  if (bool(p, "flip")) b.at(p.x, y, p.z, 0, () => b.quad(fitted(web), [[0, 0, 0], [-size, 0, 0], [-size, size, 0], [0, size, 0]], (c) => c[0], (c) => c[1]));
  else b.card(fitted(web), p.x, y, p.x + size, y + size, p.z);
});

drawn("crypt-pillar", "a pillar of crypt brick, its middle at x, z", (b, p) => {
  const { x, z } = p;
  const pillarStone = fitted(stock.cryptStone());
  const brick = tiled(stock.cryptBrick());
  b.roundedBox(x - 0.4375, 0, z - 0.4375, x + 0.4375, 0.3125, z + 0.4375, 1.5 / 16, sides(pillarStone));
  b.box(x - 0.3125, 0.3125, z - 0.3125, x + 0.3125, 2.375, z + 0.3125, sides(brick));
  b.roundedBox(x - 0.4375, 2.375, z - 0.4375, x + 0.4375, 2.6875, z + 0.4375, 1.5 / 16, sides(pillarStone));
});

drawn("fallen-drum", "a broken pillar's drum lying on its side at x, z, turned by turn", (b, p) => {
  b.at(p.x, 0, p.z, p.turn ?? 0, () => b.cylinder(0, 0, 0, 0.375, 0.3125, 8, { mat: stock.cryptBrick() }, fitted(stock.cryptStone())));
});

drawn(
  "crypt-dais",
  "a stepped dais from x, z (5 by 4.25) with a sarcophagus on it, and a runner from it south to args.runner's z",
  (b, p) => {
    const { x, z } = p;
    const stone = tiled(stock.cryptStone());
    b.box(x, 0, z, x + 5, 0.1875, z + 4.25, sides(stone));
    b.box(x + 0.5, 0.1875, z + 0.25, x + 4.5, 0.375, z + 3.9, sides(stone));
    // A worn runner of the order's violet from the stair to the dais and up its steps.
    const runner = { mat: material("runner", () => runnerPicture()), offset: [8, 0] as const };
    b.box(x + 2, 0, z + 4.25, x + 3, 1 / 16, num(p, "runner", z + 7.6), { top: runner });
    b.box(x + 2, 0.1875, z + 3.9, x + 3, 0.1875 + 1 / 16, z + 4.25, { top: runner, south: runner });
    b.box(x + 2, 0.375, z + 3.25, x + 3, 0.375 + 1 / 16, z + 3.9, { top: runner, south: runner });
    const lid = material("sarcophagus-lid", () => Pic.sarcophagusLid(24, 40));
    const end = material("sarcophagus-end", () => Pic.sarcophagusSide(24, 12));
    const side = material("sarcophagus-side", () => Pic.sarcophagusSide(40, 12));
    b.box(x + 1.75, 0.375, z + 0.75, x + 3.25, 1.125, z + 3.25, { south: fitted(end), north: fitted(end), east: fitted(side), west: fitted(side) });
    b.roundedBox(x + 1.6875, 1.125, z + 0.6875, x + 3.3125, 1.3125, z + 3.3125, 1 / 16, { top: fitted(lid), south: stone, east: stone, west: stone, north: stone });
  },
);

drawn("brazier", "an iron brazier at x, z, its embers and flames burning", (b, p) => {
  const { x, z } = p;
  b.cylinder(x, z, 0, 0.125, 0.25, 8, { mat: flat(C.IRON[2]!) });
  b.cylinder(x, z, 0.125, 0.75, 0.0625, 6, { mat: flat(C.IRON[3]!) });
  b.cylinder(x, z, 0.75, 1.0, 0.3125, 8, { mat: flat(C.IRON[2]!) }, { mat: material("embers", () => embers(), { glowing: true }) }, 0.15);
  return { frames: [flameAt(x, 0.95, z + 0.01, 12)] };
});

drawn("candles", "a cluster of three candles at x, z, standing at y", (b, p) => candles(b, p.x, p.y ?? 0, p.z));

drawn("coffin", "a coffin lying north-south from x, z, args.open its lid set aside", (b, p) => coffin(b, p.x, p.z, bool(p, "open")));

drawn("bones", "bones strewn on the floor round x, z (a tile across), lying at y; which bones its seed", (b, p) => {
  const seed = p.seed ?? 1;
  const bones = material(`bones-${seed}`, () => Pic.bones(seed), { cutout: true });
  b.decal(fitted(bones), p.x - 0.5, p.z - 0.5, p.x + 0.5, p.z + 0.5, p.y ?? 0.004);
});

drawn("rubble", "a fallen block of crypt stone at x, z, args.size across", (b, p) => {
  const s = num(p, "size", 0.375);
  b.at(p.x, 0, p.z, s * 3, () => b.roundedBox(-s / 2, 0, -s / 2, s / 2, s * 0.8, s / 2, 1 / 16, sides(fitted(stock.cryptStone()))));
});

/** A flame's three frames as cards `n` texels high, their foot's middle at x, y, z. */
function flameAt(x: number, y: number, z: number, n: number): Frames {
  return flames(n, (fb, face) => fb.card(face, x - n / 32, y, x + n / 32, y + n / 16, z));
}

// --- The furniture's own pieces ------------------------------------------------------------------------------------------

function candle(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.08, y, z - 0.08, x + 0.08, y + 0.04, z + 0.08, sides(flat(C.GOLD[2]!)));
  b.box(x - 0.04, y + 0.04, z - 0.04, x + 0.04, y + 0.26, z + 0.04, sides(flat(0xf4ecd4)));
  b.box(x - 0.03, y + 0.26, z - 0.03, x + 0.03, y + 0.36, z + 0.03, sides(material("candle-flame", () => new Pixmap(2, 2, C.FIRE[4]!), { glowing: true })));
}

function stool(b: MeshBuilder, x: number, z: number): void {
  b.cylinder(x, z, 0.38, 0.48, 0.24, 8, { mat: stock.timber() }, fitted(stock.boards()));
  for (const [dx, dz] of [[-0.14, -0.14], [0.1, -0.14], [-0.14, 0.1], [0.1, 0.1]] as const) b.box(x + dx, 0, z + dz, x + dx + 0.05, 0.38, z + dz + 0.05, sides(tiled(stock.darkTimber())));
}

function scales(b: MeshBuilder, x: number, y: number, z: number): void {
  const brass = flat(C.GOLD[3]!);
  const dark = flat(C.GOLD[1]!);
  b.box(x - 0.12, y, z - 0.08, x + 0.12, y + 0.04, z + 0.08, sides(dark));
  b.box(x - 0.02, y + 0.04, z - 0.02, x + 0.02, y + 0.42, z + 0.02, sides(brass));
  b.box(x - 0.3, y + 0.4, z - 0.015, x + 0.3, y + 0.43, z + 0.015, sides(brass));
  for (const dx of [-0.28, 0.28]) b.cylinder(x + dx, z, y + 0.16, y + 0.2, 0.1, 8, { mat: brass }, { mat: brass });
}

function coins(b: MeshBuilder, x: number, y: number, z: number): void {
  const gold = flat(C.GOLD[4]!);
  for (const [dx, dz, h] of [[0, 0, 0.12], [0.14, 0.06, 0.08], [-0.1, 0.1, 0.05], [0.06, -0.12, 0.04]] as const) b.cylinder(x + dx, z + dz, y, y + h, 0.08, 8, { mat: flat(C.GOLD[3]!) }, { mat: gold });
}

function bladeRack(b: MeshBuilder, x: number, y: number, z = 0): void {
  b.box(x - 0.55, y + 1.0, z, x + 0.55, y + 1.08, z + 0.15, sides(tiled(stock.darkTimber())));
  b.box(x - 0.55, y, z, x + 0.55, y + 0.08, z + 0.15, sides(tiled(stock.darkTimber())));
  for (const [i, dx] of [-0.36, -0.12, 0.12, 0.36].entries()) {
    const steel = flat(C.IRON[5]!);
    b.box(x + dx - 0.03, y + 0.05, z + 0.08, x + dx + 0.03, y + (i % 2 ? 1.05 : 0.95), z + 0.12, sides(steel));
    b.box(x + dx - 0.1, y + 0.18, z + 0.06, x + dx + 0.1, y + 0.23, z + 0.14, sides(flat(C.GOLD[3]!)));
    b.box(x + dx - 0.03, y, z + 0.08, x + dx + 0.03, y + 0.18, z + 0.12, sides(flat(C.WOOD[2]!)));
  }
}

function shieldPicture(): Pixmap {
  const p = new Pixmap(10, 12);
  p.fill(0, 0);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 10; x++) {
      const w = y < 6 ? 5 : 5 - (y - 5) * 0.8;
      if (Math.abs(x - 4.5) > w) continue;
      let c = x < 5 ? C.RED[3]! : C.CLOTH_WHITE[3]!;
      if (Math.abs(x - 4.5) > w - 1 || y === 0) c = C.GOLD[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

function ledger(): Pixmap {
  const p = new Pixmap(10, 8, 0xf0dcaa);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 9; x++) if (x !== 4 && x !== 5 && (x + y) % 3 !== 0) p.set(x, y, y % 2 ? 0x8a6a48 : 0xf0dcaa);
  p.vline(4, 0, 8, 0xb89868);
  p.vline(5, 0, 8, 0xd8c090);
  for (let x = 0; x < 10; x++) p.set(x, 7, C.RED[1]!);
  return p;
}

function cardsPicture(): Pixmap {
  const p = new Pixmap(16, 10);
  p.fill(0, 0);
  const card = (x: number, y: number, back: boolean) => {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) p.put(x + i, y + j, back ? (i + j) % 2 ? C.BLUE[3]! : C.BLUE[2]! : 0xfff8e8);
    if (!back) p.put(x + 1, y + 1, C.RED[3]!);
  };
  card(1, 1, true);
  card(5, 4, false);
  card(9, 2, false);
  card(12, 5, true);
  p.put(7, 1, C.GOLD[4]!);
  p.put(8, 1, C.GOLD[3]!);
  return p;
}

function ossuaryPicture(): Pixmap {
  const p = new Pixmap(18, 24, C.INK);
  const d = C.DUNGEON;
  // The niche's arch, dark within.
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 18; x++) {
      const dx = x - 8.5;
      const inArch = y > 4 ? Math.abs(dx) < 7.5 : dx * dx + (y - 5) * (y - 5) * 2 < 56;
      if (!inArch) p.set(x, y, (x + y) % 5 === 0 ? d[3]! : d[4]!);
      else p.set(x, y, y < 8 ? C.INK : d[0]!);
    }
  }
  const skull = Pic.skull();
  const random = seeded(4);
  for (const [sx, sy] of [[2, 8], [7, 8], [12, 8], [4, 13], [9, 13], [2, 18], [7, 18], [12, 18]] as const) {
    p.blit(skull, sx + Math.floor(random() * 2), sy);
  }
  for (let x = 1; x < 17; x++) {
    p.set(x, 12, d[5]!);
    p.set(x, 17, d[5]!);
    p.set(x, 23, d[5]!);
  }
  return p;
}

/** A runner's weave, 16 by 16 to tile along it: violet with gold edges and a worn, darker middle. */
function runnerPicture(): Pixmap {
  const v = C.PURPLE;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = (x + y) % 4 === 0 ? v[2]! : v[3]!;
      if (x === 0 || x === 15) c = C.GOLD[2]!;
      if (x === 1 || x === 14) c = C.GOLD[3]!;
      if (x === 2 || x === 13) c = v[1]!;
      if (x > 5 && x < 10 && (x * 7 + y * 3) % 5 === 0) c = v[2]!;
      if (y % 8 === 0 && x > 3 && x < 12 && x % 2 === 0) c = C.GOLD[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

function embers(): Pixmap {
  const p = new Pixmap(8, 8, C.FIRE[1]!);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x * 3 + y * 5) % 7 < 2) p.set(x, y, C.FIRE[3]!);
  return p;
}

function candles(b: MeshBuilder, x: number, y: number, z: number): void {
  const wax = flat(0xe8e0d0);
  const flame = material("candle-flame", () => new Pixmap(2, 2, C.FIRE[4]!), { glowing: true });
  for (const [dx, dz, h] of [[0, 0, 0.3], [0.12, 0.08, 0.2], [-0.1, 0.1, 0.16]] as const) {
    b.box(x + dx - 0.04, y, z + dz - 0.04, x + dx + 0.04, y + h, z + dz + 0.04, sides(wax));
    b.box(x + dx - 0.025, y + h, z + dz - 0.025, x + dx + 0.025, y + h + 0.08, z + dz + 0.025, sides(flame));
  }
}

function coffin(b: MeshBuilder, x: number, z: number, open: boolean): void {
  const wood = tiled(stock.darkTimber());
  b.box(x, 0, z, x + 0.9, 0.5, z + 1.9, sides(wood));
  if (open) {
    b.box(x + 0.1, 0.38, z + 0.1, x + 0.8, 0.5, z + 1.8, { top: fitted(material("coffin-in", () => new Pixmap(4, 4, C.DARKWOOD[0]!))) });
    b.at(x + 1.2, 0, z + 0.95, 0.15, () => b.box(-0.06, 0, -0.95, 0.06, 0.9, 0.95, sides(wood)));
  } else {
    b.box(x - 0.04, 0.5, z - 0.04, x + 0.94, 0.58, z + 1.94, sides(wood));
    b.box(x + 0.4, 0.58, z + 0.35, x + 0.5, 0.6, z + 1.0, sides(flat(C.GOLD[2]!)));
    b.box(x + 0.2, 0.58, z + 0.55, x + 0.7, 0.6, z + 0.65, sides(flat(C.GOLD[2]!)));
  }
}
