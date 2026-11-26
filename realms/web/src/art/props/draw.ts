import * as C from "../paint/colors";
import { type BoxFaces, type Face, type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import { flat, material, stock } from "../paint/materials";
import type { Ramp } from "../paint/palette";
import * as P from "../paint/pictures";
import { Pixmap } from "../paint/pixmap";
import * as T from "../paint/textures";

// The drawing kit of scenery: things drawn by code from boxes, roofs, cylinders and blobs onto a MeshBuilder, in world
// units (tiles; one texel is 1/16) - lamps and lanterns, banners, trees and bushes, barrels, crates and sacks, a
// fountain, a market stall, gravestones and railings, hedges, the town wall and its gate, a bridge, boulders, a rise of
// turf and a ruined tower. The props registry (index.ts) names them for the world data; buildings (art/buildings) draw
// their fronts with some of them.

export const PX = 1 / 16;

// --- Materials of pictures ------------------------------------------------------------------------------------------

export const pics = {
  door: () => material("door", () => P.door(1)),
  shopDoor: () => material("shop-door", () => P.door(2, C.GREEN.concat([0x48b058, 0x78d080]))),
  window: () => material("window", () => P.windowPicture(false)),
  windowLit: () => material("window-lit", () => P.windowPicture(true), { glow: 0.55 }),
  shutter: () => material("shutter", () => P.shutter(C.TEAL)),
  shutterBlue: () => material("shutter-blue", () => P.shutter(C.BLUE)),
  sign: () => material("sign", () => P.goblinSign()),
  display: () => material("display", () => P.displayWindow()),
  banner: () => material("banner", () => P.banner(), { cutout: true, twoSided: true }),
  crate: (n = 16) => material(`crate-${n}`, () => P.crateSide(n)),
  barrelSide: (h = 13) => material(`barrel-side-${h}`, () => P.barrelSide(30, h), { smooth: true }),
  barrelTop: () => material("barrel-top", () => P.barrelTop()),
  awning: () => material("awning", () => P.awning(), { twoSided: true }),
  valance: () => material("valance", () => P.valance(), { cutout: true, twoSided: true }),
  produce: (kind: "apples" | "cabbages" | "carrots" | "bread" | "fish", n = 16) => material(`produce-${kind}-${n}`, () => P.produce(kind, n)),
  gravestone: () => material("gravestone", () => P.gravestone(), { cutout: true }),
  cryptGate: () => material("crypt-gate", () => P.cryptGate()),
  water: () => scrolling(material("water", () => T.water(13)), [3, 5], [1 / 32, 1 / 32]),
  waterfall: () => scrolling(material("waterfall", () => waterfall(), { cutout: true, twoSided: true }), [0, 14], [0, -1 / 16]),
  sack: () => material("sack", () => P.sackcloth(), { smooth: true }),
  clay: () => material("clay", () => P.clay(), { smooth: true }),
  flowers: () => material("flowers", () => flowerBed(), { smooth: true }),
};

/**
 * Marks a material as one whose picture slides a texel at a time (water): its offset is `floor(time * rate) * step` each
 * way. The renderer moves every such material a place holds (render/place.ts).
 */
export function scrolling(m: Material, rate: readonly [number, number], step: readonly [number, number]): Material {
  m.userData.scroll = { rate, step };
  return m;
}

/** Falling water: streaks of pale blue and white with gaps between them, cut out. */
function waterfall(): Pixmap {
  const p = new Pixmap(32, 16);
  p.fill(0, 0);
  for (let x = 0; x < 32; x++) {
    if (x % 4 !== 1 && x % 7 !== 3) continue;
    for (let y = 0; y < 16; y++) {
      const c = (x * 5 + y) % 9 === 0 ? 0xffffff : (x + y * 3) % 7 === 0 ? C.WATER[6]! : x % 3 === 0 ? C.WATER[5]! : C.WATER[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Leaves sprinkled with flowers, for flower boxes and beds. */
function flowerBed(): Pixmap {
  const p = T.leaves(31, C.LEAF);
  const colors = [C.RED[4]!, C.GOLD[4]!, 0xffffff, C.PINK[3]!, C.BLUE[5]!];
  for (let k = 0; k < 26; k++) {
    const x = (k * 13 + 5) % 32;
    const y = (k * 7 + 3) % 32;
    const c = colors[k % colors.length]!;
    p.set(x, y, c);
    p.set(x + 1, y, c);
    p.set(x, y + 1, c);
    p.set(x + 1, y + 1, C.GOLD[5]!);
  }
  return p;
}

export const iron = () => flat(C.IRON[2]!);
export const ironLight = () => flat(C.IRON[4]!);
export const gold = () => flat(C.GOLD[3]!);

// --- Lamps and banners ----------------------------------------------------------------------------------------------

/** A banner on an iron rod from the wall. */
export function bannerAt(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.45, y - 0.05, z, x + 0.45, y + 0.02, z + 0.12, sides(iron()));
  b.box(x - 0.5, y - 0.07, z + 0.08, x - 0.42, y + 0.04, z + 0.14, sides(gold()));
  b.box(x + 0.42, y - 0.07, z + 0.08, x + 0.5, y + 0.04, z + 0.14, sides(gold()));
  b.card(fitted(pics.banner()), x - 0.375, y - 2, x + 0.375, y - 0.02, z + 0.1);
}

/** A lantern on a bracket on the wall. */
export function wallLamp(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.03, y + 0.3, z, x + 0.03, y + 0.36, z + 0.35, sides(iron()));
  lantern(b, x, y - 0.1, z + 0.3);
}

const lanternGlass = () => material("lantern-glass", () => new Pixmap(4, 4, C.GOLD[4]!), { glowing: true });

/** A lantern: an iron cage round warm glass, a cap and a ring. */
export function lantern(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.13, y, z - 0.13, x + 0.13, y + 0.32, z + 0.13, sides(fitted(lanternGlass())));
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    b.box(x + dx * 0.13 - 0.025, y, z + dz * 0.13 - 0.025, x + dx * 0.13 + 0.025, y + 0.32, z + dz * 0.13 + 0.025, sides(iron()));
  b.box(x - 0.18, y + 0.32, z - 0.18, x + 0.18, y + 0.4, z + 0.18, sides(iron()));
  b.box(x - 0.1, y + 0.4, z - 0.1, x + 0.1, y + 0.47, z + 0.1, sides(iron()));
  b.box(x - 0.15, y - 0.05, z - 0.15, x + 0.15, y, z + 0.15, sides(iron()));
}

/** A street lamp: a post on a stone foot, a crossarm and a lantern. */
export function lampPost(b: MeshBuilder, x: number, z: number): void {
  b.box(x - 0.18, 0, z - 0.18, x + 0.18, 0.2, z + 0.18, sides(tiled(stock.limestone())));
  b.cylinder(x, z, 0.2, 2.2, 0.06, 6, { mat: iron() });
  b.box(x - 0.1, 2.15, z - 0.1, x + 0.1, 2.25, z + 0.1, sides(iron()));
  lantern(b, x, 2.25, z);
}

// --- Nature ---------------------------------------------------------------------------------------------------------

/**
 * A broadleaf tree: a trunk and a crown of a few rounded clumps. `detail` is the clumps' (2 as the slice drew them, 1
 * near in the world, 0 its far stand-in: fewer clumps too).
 */
export function tree(b: MeshBuilder, x: number, z: number, size = 1, seed = 0, leaves: Ramp = C.LEAF, detail = 2): void {
  const segments = detail === 0 ? 4 : 7;
  b.cylinder(x, z, 0, 1.3 * size, 0.18 * size, segments, { mat: stock.bark() });
  if (detail > 0) b.cylinder(x, z, 0, 0.2, 0.26 * size, segments, { mat: stock.bark() });
  const s = size;
  const off = (k: number) => ((seed * 7 + k * 13) % 10) / 10 - 0.5;
  const crown = stock.leaves(leaves);
  b.blob(x, 1.95 * s, z, 1.05 * s, 0.85 * s, 1.0 * s, crown, [seed * 5, 0], detail);
  b.blob(x - 0.6 * s, 1.55 * s + off(1) * 0.2, z + 0.25 * s, 0.7 * s, 0.6 * s, 0.7 * s, crown, [seed * 3, 7], detail);
  b.blob(x + 0.62 * s, 1.6 * s + off(2) * 0.2, z + 0.15 * s, 0.68 * s, 0.6 * s, 0.68 * s, crown, [11, seed], detail);
  if (detail > 0) b.blob(x + 0.1 * s, 2.55 * s, z - 0.15 * s, 0.68 * s, 0.55 * s, 0.68 * s, crown, [5, 3 + seed], detail);
}

/** A round bush. */
export function bush(b: MeshBuilder, x: number, z: number, r = 0.45, flowering = false, leaves: Ramp = C.LEAF, detail = 2): void {
  b.blob(x, r * 0.8, z, r, r * 0.85, r, flowering ? pics.flowers() : stock.leaves(leaves), [x * 16, z * 16], detail);
}

// --- Goods ----------------------------------------------------------------------------------------------------------

export function barrel(b: MeshBuilder, x: number, z: number, h = 0.8): void {
  // Staves once round a 0.3 radius are 30 texels; the picture is as tall as the barrel.
  b.cylinder(x, z, 0, h, 0.3, 10, fitted(pics.barrelSide(Math.round(h * 16))), fitted(pics.barrelTop()), 0.12, 3);
}

/** A crate, its edges rounded a texel, with produce heaped in it (or its lid on). */
export function crate(b: MeshBuilder, x: number, z: number, size = 0.75, goods?: "apples" | "cabbages" | "carrots" | "bread" | "fish", y = 0, turn = 0): void {
  b.at(x, y, z, turn, () => {
    const s = size / 2;
    const n = Math.round(size * 16);
    const side = fitted(pics.crate(n));
    b.roundedBox(-s, 0, -s, s, size, s, PX, { south: side, north: side, east: side, west: side, top: goods ? fitted(pics.produce(goods, n)) : side });
    if (goods) b.blob(0, size, 0, s * 0.85, 0.12, s * 0.85, pics.produce(goods, n), [0, 0]);
  });
}

export function sack(b: MeshBuilder, x: number, z: number): void {
  b.blob(x, 0.3, z, 0.28, 0.32, 0.24, pics.sack());
  b.blob(x, 0.66, z, 0.12, 0.08, 0.1, pics.sack());
}

export function pot(b: MeshBuilder, x: number, z: number, y = 0, r = 0.2): void {
  b.cylinder(x, z, y, y + r * 1.6, r, 8, fitted(pics.clay()), undefined, 0.35, 3);
  b.cylinder(x, z, y + r * 1.6, y + r * 1.85, r * 0.7, 8, fitted(pics.clay()), fitted(material("pot-dark", () => new Pixmap(4, 4, C.DIRT[0]!))));
}

// --- The street's set pieces ----------------------------------------------------------------------------------------

/**
 * A tiered fountain: an octagonal basin, a pillar and a bowl, and water falling from it. Returns the water's material,
 * which the scene slides along a texel at a time.
 */
export function fountain(b: MeshBuilder, x: number, z: number): Material {
  const water = pics.water();
  const stone = stock.limestone();
  // The basin: a low octagonal wall with a broad rim, and water within.
  b.cylinder(x, z, 0, 0.5, 1.8, 8, { mat: stone }, undefined, 0, 1, 6);
  b.cylinder(x, z, 0.5, 0.64, 1.9, 8, { mat: stock.flagstone() }, undefined, 0, 1, 6);
  b.ring(x, z, 0.64, 1.5, 1.9, 8, stock.flagstone());
  b.cylinder(x, z, 0.4, 0.64, 1.5, 8, { mat: stone }, undefined, 0, 1, 5);
  b.cylinder(x, z, 0.0, 0.44, 1.49, 8, { mat: water }, fitted(water));
  // The pillar and the upper bowl, water brimming in it and spilling in streams.
  b.cylinder(x, z, 0.44, 1.55, 0.26, 8, { mat: stone }, undefined, 0, 1, 2);
  b.cylinder(x, z, 1.55, 1.85, 0.85, 8, { mat: stock.flagstone() }, undefined, -0.3, 1, 3);
  b.ring(x, z, 1.85, 0.7, 0.85, 8, stock.flagstone());
  b.cylinder(x, z, 1.6, 1.8, 0.7, 8, { mat: water }, fitted(water));
  b.cylinder(x, z, 0.46, 1.84, 0.88, 8, { mat: pics.waterfall() }, undefined, 0, 1, 4);
  // A finial: a gilded sun of Benalia over the bowl, a jet rising from it.
  b.cylinder(x, z, 1.8, 2.25, 0.12, 6, { mat: stone });
  b.cylinder(x, z, 2.25, 2.4, 0.22, 8, { mat: gold() }, { mat: gold() });
  b.cylinder(x, z, 2.4, 2.9, 0.05, 6, { mat: pics.waterfall() });
  return water;
}

/** A market stall: a counter of crates and produce under a striped awning on four posts. */
export function stall(b: MeshBuilder, x0: number, z: number, width: number): void {
  const x1 = x0 + width;
  const post = sides(tiled(stock.timber()));
  for (const x of [x0 + 0.05, x1 - 0.15]) {
    b.box(x, 0, z - 0.95, x + 0.1, 2.0, z - 0.85, post);
    b.box(x, 0, z + 0.15, x + 0.1, 2.4, z + 0.25, post);
  }
  b.box(x0, 0, z - 0.35, x1, 0.85, z + 0.3, {
    south: tiled(material("counter", () => P.counterFront())),
    east: tiled(stock.timber()),
    west: tiled(stock.timber()),
    north: tiled(stock.timber()),
    top: tiled(stock.boards()),
  });
  const goods = ["apples", "cabbages", "carrots", "bread", "fish"] as const;
  for (let i = 0; i < Math.floor(width / 0.8); i++) crate(b, x0 + 0.45 + i * 0.8, z - 0.02, 0.6, goods[i % goods.length], 0.85, (i % 2) * 0.06 - 0.03);
  b.quad({ mat: pics.awning() }, [
    [x0 - 0.2, 2.15, z + 0.55],
    [x1 + 0.2, 2.15, z + 0.55],
    [x1 + 0.2, 2.55, z - 1.0],
    [x0 - 0.2, 2.55, z - 1.0],
  ], (c) => c[0], (c) => -c[2] + c[1]);
  b.card({ mat: pics.valance(), offset: [0, -1.775 * 16] }, x0 - 0.2, 1.775, x1 + 0.2, 2.15, z + 0.55);
}

export function gravestone(b: MeshBuilder, x: number, z: number, turn = 0): void {
  b.at(x, 0, z, turn, () => {
    const face = fitted(pics.gravestone());
    b.box(-0.375, 0, -0.06, 0.375, 1.0, 0.06, { south: face, north: face });
    b.box(-0.34, 0, -0.06, 0.34, 0.68, 0.06, sides(tiled(stock.cobbleWall())));
    b.box(-0.35, 0, -0.15, 0.35, 0.08, 0.2, sides(tiled(stock.cobbleWall())));
  });
}

/** Iron railings along a line, with spear-point finials: a post at each end and about every quarter; a line of no length, one post. */
export function railings(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number): void {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const n = length > 0 ? Math.max(1, Math.round(length / 0.25)) : 0;
  for (let i = 0; i <= n; i++) {
    const t = n > 0 ? i / n : 0;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    b.box(x - 0.025, 0, z - 0.025, x + 0.025, 1.0, z + 0.025, sides(iron()));
    b.box(x - 0.04, 1.0, z - 0.04, x + 0.04, 1.08, z + 0.04, sides(gold()));
  }
  if (length === 0) return;
  const dx = (x1 - x0) / length;
  const dz = (z1 - z0) / length;
  for (const y of [0.15, 0.85]) {
    b.box(Math.min(x0, x1) - 0.03 * Math.abs(dz), y, Math.min(z0, z1) - 0.03 * Math.abs(dx), Math.max(x0, x1) + 0.03 * Math.abs(dz), y + 0.06, Math.max(z0, z1) + 0.03 * Math.abs(dx), sides(iron()));
  }
}

/** A low wall of fieldstone with a hedge along its top. */
export function hedgeWall(b: MeshBuilder, x0: number, x1: number, z: number, leaves: Ramp = C.LEAF): void {
  b.box(x0, 0, z - 0.3, x1, 0.5, z + 0.3, sides(tiled(stock.cobbleWall()), tiled(stock.limestone())));
  for (let x = x0 + 0.4; x < x1; x += 0.7) b.blob(x, 0.75, z, 0.45, 0.4, 0.38, stock.leaves(leaves), [x * 16, 0]);
}

/** A bench of planks on stone feet. */
export function bench(b: MeshBuilder, x: number, z: number, width = 1.6): void {
  const stone = sides(tiled(stock.limestone()));
  b.box(x - width / 2 + 0.1, 0, z - 0.18, x - width / 2 + 0.3, 0.38, z + 0.18, stone);
  b.box(x + width / 2 - 0.3, 0, z - 0.18, x + width / 2 - 0.1, 0.38, z + 0.18, stone);
  b.box(x - width / 2, 0.38, z - 0.22, x + width / 2, 0.48, z + 0.22, sides(tiled(stock.timber()), tiled(stock.boards())));
}

export function box(b: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: BoxFaces | Face): void {
  b.box(x0, y0, z0, x1, y1, z1, "mat" in faces ? sides(faces) : faces);
}

// --- Open country ---------------------------------------------------------------------------------------------------

const rockMat = () => material("rock", () => T.rock(18), { smooth: true });

/**
 * The town's wall, running north-south along x (its outer face west), with a gate over the road between g0 and g1:
 * limestone ashlar, a parapet with merlons on both faces, square towers either side of the gate and a lintel over it.
 */
export function townWall(
  b: MeshBuilder,
  x: number,
  z0: number,
  z1: number,
  g0: number,
  g1: number,
): void {
  const lime = tiled(stock.limestone());
  const top = tiled(stock.flagstone());
  const t = 0.75;
  const h = 2.25;
  const run = (za: number, zb: number) => {
    if (zb - za <= 0) return;
    b.box(x - t, 0, za, x, h, zb, sides(lime, top));
    for (let z = za; z < zb - 0.1; z += 0.5) {
      b.box(x - t, h, z, x - t + 0.19, h + 0.31, Math.min(z + 0.25, zb), sides(lime));
      b.box(x - 0.19, h, z, x, h + 0.31, Math.min(z + 0.25, zb), sides(lime));
    }
  };
  run(z0, g0 - 1);
  run(g1 + 1, z1);
  // The gatehouse: a square tower either side, proud of the wall both ways, roofed in slate, with arrow slits and a
  // banner on the faces that look south; a lintel across, high enough to walk under.
  const slit = fitted(material("arrow-slit", () => {
    const p = new Pixmap(4, 12, C.INK);
    p.vline(0, 0, 12, C.LIMESTONE[2]!);
    return p;
  }));
  for (const [za, zb] of [
    [g0 - 2, g0],
    [g1, g1 + 2],
  ] as const) {
    const xa = x - t - 0.5;
    const xb = x + 0.5;
    const south = za >= g1;
    b.box(xa, 0, za, xb, 4.0, zb, sides(lime, top));
    for (let mx = xa; mx < xb - 0.1; mx += 0.5) {
      b.box(mx, 4.0, zb - 0.25, mx + 0.25, 4.375, zb, sides(lime));
      b.box(mx, 4.0, za, mx + 0.25, 4.375, za + 0.25, sides(lime));
    }
    b.gableRoof(xa - 0.15, za - 0.15, xb + 0.15, zb + 0.15, 4.375, 1.2, stock.slate(), lime);
    b.card(slit, (xa + xb) / 2 - 0.125, 2.6, (xa + xb) / 2 + 0.125, 3.35, zb + 0.01);
    if (south) bannerAt(b, (xa + xb) / 2, 2.3, zb);
  }
  // The lintel over the gateway, high enough to walk under.
  b.box(x - t - 0.12, 2.5, g0, x + 0.12, 3.25, g1, sides(lime, top));
  for (let z = g0; z < g1 - 0.1; z += 0.5) b.box(x - t - 0.12, 3.25, z, x - t + 0.07, 3.56, z + 0.25, sides(lime));
}

/** A stone bridge over a stream: a deck at `y`, its arch's face to the water, a low parapet along each side. */
export function bridge(b: MeshBuilder, x0: number, x1: number, z0: number, z1: number, y: number): void {
  const stone = tiled(material("bridge-stone", () => T.ashlar(C.LIMESTONE, 51, 6, 8, 12)));
  const deck = tiled(stock.flagstone());
  b.box(x0, -0.2, z0, x1, y, z1, { top: deck, south: stone, north: stone, east: stone, west: stone });
  for (const [za, zb] of [
    [z0, z0 + 0.25],
    [z1 - 0.25, z1],
  ] as const) {
    b.box(x0, y, za, x1, y + 0.5, zb, sides(stone));
    b.box(x0 - 0.06, y + 0.5, za - 0.03, x1 + 0.06, y + 0.6, zb + 0.03, sides(deck));
  }
}

/** A boulder: a squashed lump of rock, with a smaller one at its foot. */
export function boulder(b: MeshBuilder, x: number, z: number, r = 0.5, seed = 0): void {
  const s = ((seed * 37) % 10) / 10;
  b.blob(x, r * 0.55, z, r, r * 0.75, r * (0.8 + s * 0.3), rockMat(), [seed * 7, seed * 3]);
  b.blob(x + r * 0.8, r * 0.25, z + r * 0.4, r * 0.4, r * 0.32, r * 0.35, rockMat(), [seed * 3, seed * 5]);
}

/** A flat stepping stone in a stream. */
export function steppingStone(b: MeshBuilder, x: number, z: number): void {
  b.blob(x, 0.0, z, 0.36, 0.14, 0.3, rockMat(), [x * 16, z * 16]);
}

/** A raised terrace of turf with an earthen bank round it: a tier of a rise. */
export function terrace(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number): void {
  b.box(x0, 0, z0, x1, y, z1, { top: tiled(material("turf", () => T.grass(5))), south: tiled(rockMat()), north: tiled(rockMat()), east: tiled(rockMat()), west: tiled(rockMat()) });
}

/**
 * A ruined round tower on a rise: a ring of ashlar broken off at heights from `low` to `high`, one side fallen to a
 * gap, its inside seen from above, and fallen blocks round its foot.
 */
export function ruinedTower(b: MeshBuilder, cx: number, cz: number, y0: number, r: number, low: number, high: number): void {
  const mat = material("tower-stone", () => T.ashlar(C.LIMESTONE, 61, 6, 7, 11));
  const image = mat.map!.image as { width: number; height: number };
  const tw = image.width / 16;
  const th = image.height / 16;
  const n = 20;
  const thick = 0.5;
  for (let i = 0; i < n; i++) {
    // A breach to the south-east, and a jagged top elsewhere.
    if (i >= 3 && i <= 5) continue;
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const f = Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6));
    const h = y0 + low + (high - low) * (i > 12 ? f : f * 0.55);
    const at = (a: number, rr: number, y: number): [number, number, number] => [cx + Math.sin(a) * rr, y, cz + Math.cos(a) * rr];
    const arc0 = a0 * r;
    const arc1 = a1 * r;
    const uv = (arc: number, y: number): [number, number] => [arc / tw, y / th];
    b.polygon(mat, [at(a0, r, y0), at(a1, r, y0), at(a1, r, h), at(a0, r, h)], [uv(arc0, y0), uv(arc1, y0), uv(arc1, h), uv(arc0, h)]);
    b.polygon(mat, [at(a1, r - thick, y0), at(a0, r - thick, y0), at(a0, r - thick, h), at(a1, r - thick, h)], [uv(arc1, y0), uv(arc0, y0), uv(arc0, h), uv(arc1, h)]);
    b.polygon(mat, [at(a0, r, h), at(a1, r, h), at(a1, r - thick, h), at(a0, r - thick, h)], [uv(arc0, 0), uv(arc1, 0), uv(arc1, thick), uv(arc0, thick)]);
    // The ends of the wall at the breach.
    if (i === 2 || i === 6) {
      const a = i === 2 ? a1 : a0;
      b.polygon(mat, [at(a, r, y0), at(a, r - thick, y0), at(a, r - thick, h), at(a, r, h)], [uv(0, y0), uv(thick, y0), uv(thick, h), uv(0, h)]);
    }
  }
  // Fallen blocks.
  const fallen = fitted(mat, [0, 0, 8, 6]);
  for (const [dx, dz, s, turn] of [
    [r + 0.6, 0.8, 0.45, 0.3],
    [r + 1.1, 1.6, 0.35, 1.1],
    [0.8, r + 0.9, 0.4, 0.7],
    [-r - 0.5, -0.4, 0.3, 0.2],
  ] as const) {
    b.at(cx + dx, y0, cz + dz, turn, () => b.roundedBox(-s, 0, -s * 0.7, s, s * 0.9, s * 0.7, 1 / 16, sides(fallen)));
  }
}

/** A hedgerow along a line: a low bank of turf and stones, bushes all along it. */
export function hedgeRow(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, seed = 0, leaves: Ramp = C.LEAF, detail = 2): void {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(length / 0.7));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wobble = Math.sin((i + seed) * 1.9) * 0.12;
    const x = x0 + (x1 - x0) * t + (z1 !== z0 ? wobble : 0);
    const z = z0 + (z1 - z0) * t + (x1 !== x0 ? wobble : 0);
    const r = 0.42 + 0.1 * Math.abs(Math.sin((i + seed) * 2.3));
    b.blob(x, r * 0.85, z, r, r * 0.8, r, i % 7 === 3 ? pics.flowers() : stock.leaves(leaves), [x * 16, z * 16], detail);
  }
}

