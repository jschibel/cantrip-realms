import type { BuildingData, XYZ } from "../../world/format";
import { type MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import { Pixmap, hash2, seeded } from "../paint/pixmap";
import { valueNoise } from "../paint/procedural";
import * as R from "../paint/ramps";
import { barrel, crate, iron, sack } from "../props/draw";
import { bannerMaterial, bark, cloth, foliage, frustum, glowing, limb, lump, planks, rock } from "../props/kit";
import type { Built } from "../recipe";
import { coneRoof, doorMaterial, hangingSign, params as paramsOf, plaque, roofFace, signMaterial, styled, type Trade, tradeOf, windowSpots } from "./kit";
import { fireFrames } from "./morass";
import { BUILDINGS, showcase } from "./registry";

// Llanowar's style: the elfhames' tree-houses. A living giant's trunk, smooth and mossy, rises from buttress roots with
// a door into its foot; round decks of planks ring it at a height on braces, railed, and on them round huts of woven
// bark under conical roofs of leaf-thatch, the trunk going up through them into its crown. Stairs wind up round the
// trunk; seed-pod lanterns glow green-gold; green-and-gold banners hang from the decks; signs are cut as leaves.
//
// Kinds: house, shop (a stall at the trunk's foot), tenement (decks up the trunk; floors), inn, temple (a great tree
// over a sanctuary of rooted arches and a glowing seed), guildhall (a long hall on a broad deck), smithy (an open forge
// under arching roots), library (huts stacked up the trunk), tower (a slender tree climbed by its stair, a hut on top;
// floors), warehouse (a root-cellar mound), gatehouse (two trees arching over the passage, the middle 2 tiles, a bridge
// between them), wall (a living palisade of roots and hedge along its longer side), wall-tower (a lookout deck).
// Params: trade, deck (the first deck's height, 3), floors. Palette slots: bark, leaves, timber (decks), roof
// (leaf-thatch), cloth (banners), trim.

const LLANOWAR: Palette = { bark: R.ELFWOOD, leaves: R.ELF_LEAF, timber: R.ELFWOOD, roof: R.ELF_LEAF, cloth: R.ELF_CLOTH, trim: C.GOLD };

// --- Pictures -------------------------------------------------------------------------------------------------------------

/** Leaf-thatch, 32 by 32: rows of overlapping leaves laid like shingles, each lit at its tip, the odd one gone gold. */
function leafThatch(r: Ramp): Pixmap {
  const p = new Pixmap(32, 32);
  for (let row = 0; row < 8; row++) {
    for (let x = 0; x < 32; x++) {
      const shift = (row % 2) * 2;
      const k = Math.floor((x + shift) / 4);
      const fx = (x + shift) % 4;
      const gold = false;
      const tone = gold ? -1 : hash2(k, row, 62) < 0.4 ? 2 : 3;
      for (let j = 0; j < 4; j++) {
        const y = row * 4 + j;
        // A leaf: widest at its top, coming to a point at its foot.
        const inside = Math.abs(fx - 1.5) <= 2 - j * 0.45;
        let c = inside ? (gold ? C.GOLD[j === 0 ? 4 : 3]! : r[j === 0 ? tone + 1 : j === 3 ? tone - 1 : tone]!) : r[0]!;
        if (inside && fx === 1 && j > 0) c = gold ? C.GOLD[2]! : r[tone - 1]!;
        p.set(x, y, c);
      }
    }
  }
  return p;
}

/** Wattle, 16 by 16: withies woven over and under upright stakes, a hut's wall; lit along each withy's top. */
function wovenBark(r: Ramp): Pixmap {
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const row = Math.floor(y / 4);
      const j = y % 4;
      // Each withy bulges out between the stakes it passes in front of, and dips behind the others.
      const front = (Math.floor(x / 4) + row) % 2 === 0;
      let c = j === 0 ? r[front ? 6 : 5]! : j === 1 ? r[front ? 5 : 4]! : j === 2 ? r[front ? 4 : 3]! : r[1]!;
      if (x % 4 === 0 && !front) c = r[2]!;
      if (hash2(x, y, 72) < 0.05) c = r[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A round window of a hut, 12 by 12: a ring of bent wood, lit gold within, a leaf in its lattice. */
function roundWindow(r: Ramp): Pixmap {
  const p = new Pixmap(12, 12);
  p.fill(0, 0);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const d = Math.hypot(x - 5.5, y - 5.5);
      if (d > 5.8) continue;
      let c = d > 4.4 ? (x < 6 ? r[5]! : r[3]!) : y < 5 ? C.GOLD[4]! : C.GOLD[3]!;
      if (d <= 4.4 && (x === 5 || x === 6) && y > 2) c = r[2]!;
      if (d <= 4.4 && y === 6 && Math.abs(x - 5.5) < 3) c = r[2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

const mats = (pal: Palette) => {
  const barkRamp = pal.bark ?? R.ELFWOOD;
  const leaves = pal.leaves ?? R.ELF_LEAF;
  const timber = pal.timber ?? R.ELFWOOD;
  const roof = pal.roof ?? R.ELF_LEAF;
  const cloth = pal.cloth ?? R.ELF_CLOTH;
  return {
    bark: bark(barkRamp, "smooth"),
    leaves: foliage(leaves),
    deck: planks(timber, true),
    wood: material(`elf-wood@${rampKey(timber)}`, () => woodGrain(timber), { smooth: true }),
    roof: material(`leaf-thatch@${rampKey(roof)}`, () => leafThatch(roof)),
    hut: material(`woven-bark@${rampKey(timber)}`, () => wovenBark(timber)),
    window: material(`round-window@${rampKey(timber)}`, () => roundWindow(timber), { cutout: true, glow: 0.55 }),
    door: doorMaterial(timber, barkRamp, "round", false),
    banner: bannerMaterial(cloth, pal.trim ?? C.GOLD),
    cloth,
    pod: glowing(0xe4f48a),
    leafRamp: leaves,
  };
};
type Mats = ReturnType<typeof mats>;
type Draw = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined;

function woodGrain(r: Ramp): Pixmap {
  const p = new Pixmap(16, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
    const n = valueNoise(x * 4, y, 6, 32, 73);
    p.set(x, y, n < 0.35 ? r[3]! : n < 0.7 ? r[4]! : r[5]!);
  }
  return p;
}

// --- Pieces ---------------------------------------------------------------------------------------------------------------

/** A living trunk at (cx, cz), `r` thick at its foot, `h` tall, on buttress roots, a door into its foot facing south. */
function trunk(b: MeshBuilder, cx: number, cz: number, r: number, h: number, m: Mats, door = true, seed = 0): number {
  frustum(b, cx, cz, 0, h, r * 1.1, r * 0.72, 12, m.bark);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5 + seed;
    if (door && Math.cos(a) > 0.8) continue;
    limb(b, [cx + Math.sin(a) * r * 0.6, r * 1.7, cz + Math.cos(a) * r * 0.6], [cx + Math.sin(a) * r * 1.9, 0, cz + Math.cos(a) * r * 1.9], r * 0.42, r * 0.16, m.bark, 6);
  }
  if (!door) return cz + r;
  // The door: a frame of living wood grown round an opening, the door's leaf within.
  const zf = cz + r * 1.1 + 0.05;
  b.box(cx - 0.85, 0, zf - 0.45, cx + 0.85, 2.4, zf, sides(tiled(m.bark)));
  b.card(fitted(m.door), cx - 0.625, 0.08, cx + 0.625, 2.08, zf + 0.01);
  b.box(cx - 0.75, 0, zf, cx + 0.75, 0.1, zf + 0.35, sides(tiled(m.deck)));
  pod(b, cx + 0.95, 1.9, zf + 0.05, m);
  return zf;
}

/** A glowing seed-pod lantern on a stem, hung at (x, y, z). */
function pod(b: MeshBuilder, x: number, y: number, z: number, m: Mats): void {
  limb(b, [x, y + 0.5, z - 0.05], [x, y + 0.12, z], 0.015, 0.015, m.wood, 3);
  b.blob(x, y, z, 0.11, 0.14, 0.11, m.pod);
}

/** A round deck of planks about (cx, cz) at height y, radius r, on braces from the trunk, a railing round it. */
function deck(b: MeshBuilder, cx: number, cz: number, y: number, r: number, trunkR: number, m: Mats, rail = true): void {
  lump(b, cx, cz, y - 0.18, [[r - 0.05, 0], [r, 0.1], [r, 0.18]], 14, m.deck, 0, 0, { twist: 0 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    limb(b, [cx + Math.sin(a) * trunkR * 0.9, y - 1.3, cz + Math.cos(a) * trunkR * 0.9], [cx + Math.sin(a) * r * 0.85, y - 0.15, cz + Math.cos(a) * r * 0.85], 0.07, 0.05, m.wood, 5);
  }
  if (!rail) return;
  // A light rail on posts a stride apart: the deck's edge stays open to the eye.
  const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.9));
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.sin(a) * (r - 0.06);
    const z = cz + Math.cos(a) * (r - 0.06);
    b.box(x - 0.03, y, z - 0.03, x + 0.03, y + 0.6, z + 0.03, sides(tiled(m.wood)));
    pts.push([x, y + 0.6, z]);
  }
  for (let i = 0; i < n; i++) limb(b, pts[i]!, pts[(i + 1) % n]!, 0.03, 0.03, m.wood, 4);
}

/** A round hut on a deck at height y about (cx, cz): woven walls, round windows, a door facing south, a leaf roof. */
function hut(b: MeshBuilder, cx: number, cz: number, y: number, r: number, h: number, m: Mats, rise = r * 1.1): void {
  b.cylinder(cx, cz, y, y + h, r, 12, { mat: m.hut });
  b.cylinder(cx, cz, y + h - 0.12, y + h, r + 0.05, 12, { mat: m.wood });
  coneRoof(b, cx, cz, y + h, r + 0.5, rise, m.roof, 12);
  b.blob(cx, y + h + rise + 0.05, cz, 0.1, 0.16, 0.1, glowing(C.GOLD[4]!));
  for (const a of [0.0, Math.PI / 2.4, -Math.PI / 2.4]) {
    b.at(cx, 0, cz, a, () => {
      if (a === 0) b.card(fitted(m.door), -0.5, y, 0.5, y + 1.6, r + 0.01);
      else b.card(fitted(m.window), -0.36, y + 0.6, 0.36, y + 1.32, r + 0.01);
    });
  }
}

/** A crown of leaves about (cx, cz) at height y. */
function crown(b: MeshBuilder, cx: number, cz: number, y: number, rx: number, m: Mats, seed = 0): void {
  const random = seeded(seed + 91);
  b.blob(cx, y, cz, rx, rx * 0.6, rx * 0.9, m.leaves, [seed * 5, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + random() * 0.5;
    const k = 0.5 + random() * 0.2;
    b.blob(cx + Math.sin(a) * rx * 0.75, y - rx * 0.1 + (random() - 0.5) * rx * 0.3, cz + Math.cos(a) * rx * 0.65, rx * k, rx * k * 0.65, rx * k, m.leaves, [i * 7 + seed, i * 3]);
  }
}

/** Stairs winding up round a trunk at (cx, cz), radius r, from the ground to height h, starting facing `a0`. */
function spiral(b: MeshBuilder, cx: number, cz: number, r: number, h: number, m: Mats, a0 = Math.PI * 0.75): void {
  const n = Math.max(4, Math.round(h / 0.28));
  for (let k = 0; k < n; k++) {
    const a = a0 + k * 0.32;
    const y = (k * h) / n;
    b.at(cx, 0, cz, a, () => b.box(-0.2, y, r - 0.05, 0.2, y + 0.09, r + 0.7, sides(tiled(m.deck))));
  }
}

/** A banner of green and gold hung from a deck's edge at (x, z), its top at y. */
function deckBanner(b: MeshBuilder, x: number, y: number, z: number, m: Mats): void {
  b.box(x - 0.42, y - 0.05, z - 0.03, x + 0.42, y + 0.01, z + 0.03, sides(iron()));
  b.card(fitted(m.banner), x - 0.375, y - 2.0, x + 0.375, y, z + 0.04);
}

const leafSign = (trade: Trade, m: Mats) => signMaterial(trade, m.cloth, C.GOLD, "leaf");

interface Tree {
  readonly cx: number;
  readonly cz: number;
  readonly r: number;
  readonly deckR: number;
  readonly door: number;
}

/** Where a tree-house's trunk stands on its footprint, how thick, and its deck's reach. */
function treeOn(x0: number, z0: number, x1: number, z1: number): Tree {
  const s = Math.min(x1 - x0, z1 - z0);
  const r = Math.max(0.55, Math.min(1.05, s * 0.17));
  const cx = (x0 + x1) / 2;
  const cz = z1 - r * 1.1 - 1.0;
  return { cx, cz, r, deckR: s / 2 - 0.15, door: cz + r * 1.1 + 0.05 };
}

/** A tree-house: the trunk with its door, `levels` decks each with a hut, the stair up, the crown over all. */
function treeHouse(building: BuildingData, m: Mats, levels: number, extra?: (b: MeshBuilder, t: Tree, top: number) => void): Draw {
  return (b, x0, z0, x1, z1) => {
    const P = paramsOf(building);
    const t = treeOn(x0, z0, x1, z1);
    const first = P.num("deck", 3);
    const seed = Math.round(Math.abs(building.x * 3 + building.z * 7));
    const dz = t.cz - 0.3;
    let y = first;
    let dr = t.deckR;
    for (let k = 0; k < levels; k++) {
      const top = k === levels - 1;
      deck(b, t.cx, dz, y, dr, t.r, m);
      if (top) {
        // The top deck's hut round the trunk, the trunk going up through its roof into the crown.
        hut(b, t.cx, dz, y, t.r * 0.75 + 0.5, 1.7, m, 1.5);
      } else {
        // A deck below: a small hut to one side of the trunk, its door to the south.
        const side = k % 2 ? 1 : -1;
        const hr = Math.max(0.5, Math.min(0.85, (dr - t.r * 0.8 - 0.3) / 2));
        const a = side * 0.95;
        const d = t.r * 0.8 + 0.2 + hr;
        hut(b, t.cx + Math.sin(a) * d, dz + Math.cos(a) * d * 0.6, y, hr, 1.6, m, 1.0);
      }
      deckBanner(b, t.cx + dr * 0.7, y - 0.15, dz + dr * 0.7, m);
      pod(b, t.cx - dr * 0.75, y - 0.35, dz + dr * 0.66, m);
      if (k + 1 < levels) {
        // A ladder up from this deck to the next, on the trunk's east side.
        const lx = t.cx + t.r * 0.95;
        for (const s of [-0.18, 0.18]) limb(b, [lx + 0.1, y, dz + s], [lx, y + 3.2, dz + s], 0.03, 0.03, m.wood, 4);
        for (let ry = y + 0.3; ry < y + 3.2; ry += 0.35) b.box(lx + 0.02, ry, dz - 0.18, lx + 0.08, ry + 0.04, dz + 0.18, sides(tiled(m.wood)));
      }
      y += 3.2;
      dr *= 0.78;
    }
    const top = y - 3.2 + 1.7 + 1.5;
    trunk(b, t.cx, t.cz, t.r, top + 0.8, m, true, seed);
    spiral(b, t.cx, t.cz, t.r * 0.95, first, m);
    // The crown above and behind the top hut, so its roof shows in front of it.
    const cr = Math.max(2.0, t.deckR * 0.95);
    crown(b, t.cx, dz - cr * 0.45, top + cr * 0.55, cr, m, seed);
    extra?.(b, t, top);
    return [t.cx, 1, t.door];
  };
}

// --- Kinds ---------------------------------------------------------------------------------------------------------------

function shopStall(m: Mats, trade: Trade): (b: MeshBuilder, t: Tree) => void {
  return (b, t) => {
    // A stall at the trunk's foot, west of the door: a counter of planks under a leaf-green awning on two poles.
    const xa = t.cx - t.deckR + 0.1;
    const xb = t.cx - 1.05;
    if (xb - xa < 0.8) return;
    const z = t.door + 0.3;
    b.box(xa, 0, z - 0.4, xb, 0.85, z, sides(tiled(m.wood), tiled(m.deck)));
    crate(b, (xa + xb) / 2 - 0.15, z - 0.2, 0.38, "apples", 0.85);
    for (const x of [xa + 0.05, xb - 0.05]) limb(b, [x, 0, z + 0.5], [x, 1.9, z + 0.5], 0.04, 0.04, m.wood, 4);
    roofFace(b, cloth(m.cloth, "striped", C.GOLD), [[xa - 0.15, 1.85, z + 0.6], [xb + 0.15, 1.85, z + 0.6], [xb + 0.15, 2.2, z - 0.5], [xa - 0.15, 2.2, z - 0.5]], 1.1, 0.35);
    sack(b, xa + 0.2, z + 0.55);
    hangingSign(b, t.cx + 1.25, 2.4, t.door - 0.4, leafSign(trade, m), tiled(m.wood));
  };
}

function temple(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2;
    const s = Math.min(x1 - x0, z1 - z0);
    const r = Math.min(1.4, s * 0.2);
    const cz = (z0 + z1) / 2 - 0.4;
    // The sanctuary: great roots arching from the trunk to the ground all round, a glowing seed on a root altar before it.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const far = s / 2 - 0.3;
      const mid: [number, number, number] = [cx + Math.sin(a) * far * 0.7, 2.6, cz + Math.cos(a) * far * 0.7];
      limb(b, [cx + Math.sin(a) * r * 0.7, 3.5, cz + Math.cos(a) * r * 0.7], mid, r * 0.32, r * 0.22, m.bark, 6);
      limb(b, mid, [cx + Math.sin(a) * far, 0, cz + Math.cos(a) * far], r * 0.22, r * 0.14, m.bark, 6);
    }
    frustum(b, cx, cz, 0, 10.5, r * 1.05, r * 0.7, 12, m.bark);
    const zf = cz + r * 1.05;
    b.box(cx - 0.9, 0, zf - 0.4, cx + 0.9, 2.6, zf + 0.05, sides(tiled(m.bark)));
    b.card(fitted(doorMaterial(m.cloth, R.ELFWOOD, "pointed", false)), cx - 0.625, 0.05, cx + 0.625, 2.05, zf + 0.06);
    plaque(b, cx, 2.0, zf + 0.07, signMaterial(trade, m.cloth, C.GOLD, "leaf"));
    lump(b, cx, z1 - 0.7, 0, [[0.45, 0], [0.4, 0.5], [0.3, 0.7]], 7, rock(R.ELFWOOD, R.MOSS), 3, 0.1);
    b.blob(cx, 0.95, z1 - 0.7, 0.24, 0.3, 0.24, glowing(0xeaff9a));
    // High up, a broad deck and the shrine's hut under a tall spire of leaves, gold at its tip.
    deck(b, cx, cz, 5.0, s / 2, r, m);
    hut(b, cx, cz - 0.2, 5.0, Math.max(r + 0.7, s * 0.28), 2.2, m, 3.4);
    b.blob(cx, 7.2 + 3.4 + 0.1, cz - 0.2, 0.14, 0.2, 0.14, glowing(C.GOLD[4]!));
    deckBanner(b, cx - s * 0.35, 4.85, cz + s * 0.35, m);
    deckBanner(b, cx + s * 0.35, 4.85, cz + s * 0.35, m);
    const cr = s * 0.45;
    crown(b, cx, cz - cr * 0.45, 10.6 + cr * 0.55, cr, m, 5);
    return [cx, 1, zf];
  };
}

function guildhall(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    // A long hall on a broad deck of planks, held by the trunk at its middle and posts at its corners.
    const t = treeOn(x0, z0, x1, z1);
    const y = 3.0;
    const dz0 = z0 + 0.2;
    const dz1 = z1 - 1.2;
    b.box(x0, y - 0.2, dz0, x1, y, dz1, sides(tiled(m.wood), tiled(m.deck)));
    for (const [x, z] of [
      [x0 + 0.3, dz0 + 0.3],
      [x1 - 0.3, dz0 + 0.3],
      [x0 + 0.3, dz1 - 0.3],
      [x1 - 0.3, dz1 - 0.3],
    ] as const)
      limb(b, [x, 0, z], [x, y - 0.2, z], 0.16, 0.12, m.bark, 6);
    const hz0 = dz0 + 0.3;
    const hz1 = dz1 - 0.8;
    b.box(x0 + 0.4, y, hz0, x1 - 0.4, y + 2.1, hz1, sides(tiled(m.hut)));
    b.gableRoof(x0 + 0.1, hz0 - 0.4, x1 - 0.1, hz1 + 0.4, y + 2.1, 1.9, m.roof, tiled(m.hut), 0.1);
    for (const x of windowSpots(x1 - x0 - 0.8, undefined, 1.5, 0.8)) b.card(fitted(m.window), x0 + 0.4 + x - 0.36, y + 0.7, x0 + 0.4 + x + 0.36, y + 1.42, hz1 + 0.01);
    for (const z of windowSpots(hz1 - hz0, undefined, 1.5, 0.7)) {
      b.at(x1 - 0.39, 0, hz0 + z, Math.PI / 2, () => b.card(fitted(m.window), -0.36, y + 0.7, 0.36, y + 1.42, 0));
      b.at(x0 + 0.39, 0, hz0 + z, -Math.PI / 2, () => b.card(fitted(m.window), -0.36, y + 0.7, 0.36, y + 1.42, 0));
    }
    // A railing along the deck's front, banners from it.
    for (let x = x0 + 0.1; x <= x1 - 0.05; x += 0.5) b.box(x - 0.035, y, dz1 - 0.1, x + 0.035, y + 0.7, dz1 - 0.03, sides(tiled(m.wood)));
    limb(b, [x0 + 0.1, y + 0.7, dz1 - 0.07], [x1 - 0.1, y + 0.7, dz1 - 0.07], 0.035, 0.035, m.wood, 4);
    for (const x of windowSpots(x1 - x0, undefined, 2.6, 1.0)) deckBanner(b, x0 + x, y - 0.25, dz1 + 0.02, m);
    trunk(b, t.cx, (dz0 + dz1) / 2, t.r, y + 0.3, m, false, 2);
    // The way in: a stair up the front to the deck, a door in the hall's front, its plaque over it.
    const sx = x0 + 1.0;
    const n = 10;
    for (let k = 0; k < n; k++) b.box(sx - 0.45, (k * y) / n, z1 - 0.1 - ((k + 1) * 1.1) / n, sx + 0.45, ((k + 1) * y) / n, z1 - 0.1 - (k * 1.1) / n, sides(tiled(m.deck)));
    const xm = (x0 + x1) / 2;
    b.card(fitted(m.door), xm - 0.625, y, xm + 0.625, y + 2.0, hz1 + 0.01);
    plaque(b, xm, y + 2.0, hz1 + 0.02, leafSign(trade, m));
    crown(b, t.cx, (dz0 + dz1) / 2, y + 5.3, Math.max(2.0, (x1 - x0) * 0.3), m, 3);
    return [sx, 1, z1 - 0.1];
  };
}

function smithy(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    // An open forge under great roots arching over it from an old stump at the back, a leaf roof laid over the roots.
    const cx = (x0 + x1) / 2;
    const cz = z0 + 1.0;
    frustum(b, cx, cz, 0, 2.6, 1.0, 0.8, 10, m.bark);
    const ends: [number, number][] = [
      [x0 + 0.3, z1 - 0.4],
      [x1 - 0.3, z1 - 0.4],
      [x0 + 0.2, (z0 + z1) / 2],
      [x1 - 0.2, (z0 + z1) / 2],
    ];
    for (const [ex, ez] of ends) {
      const mid: [number, number, number] = [(cx + ex) / 2, 3.2, (cz + ez) / 2];
      limb(b, [cx, 2.4, cz], mid, 0.32, 0.24, m.bark, 6);
      limb(b, mid, [ex, 0, ez], 0.24, 0.16, m.bark, 6);
    }
    roofFace(b, m.roof, [[x0 - 0.2, 2.4, z1 + 0.1], [x1 + 0.2, 2.4, z1 + 0.1], [x1 + 0.2, 3.3, cz], [x0 - 0.2, 3.3, cz]], z1 - cz, 0.9);
    const stone = rock(C.COBBLE, R.MOSS);
    const fx = x0 + 1.2;
    const fz = cz + 1.3;
    lump(b, fx, fz, 0, [[0.7, 0], [0.65, 0.7], [0.55, 0.85]], 8, stone, 4, 0.08);
    b.blob(fx, 0.85, fz, 0.42, 0.06, 0.42, glowing(C.FIRE[2]!));
    lump(b, fx, cz + 0.2, 0, [[0.4, 0], [0.32, 3.0], [0.25, 4.2]], 7, stone, 6, 0.1);
    const ax = cx + 0.6;
    const az = z1 - 1.2;
    b.cylinder(ax, az, 0, 0.5, 0.24, 8, { mat: m.bark });
    b.box(ax - 0.3, 0.5, az - 0.12, ax + 0.25, 0.66, az + 0.12, sides(iron()));
    barrel(b, x1 - 0.6, z1 - 0.7, 0.7);
    hangingSign(b, x1 - 0.5, 2.1, z1 - 0.4, leafSign(trade, m), tiled(m.wood));
    return [cx, 1, z1 - 0.5];
  };
}

function tower(building: BuildingData, m: Mats, floors: number): Draw {
  return (b, x0, z0, x1, z1) => {
    // A slender tree, its stair winding all the way up it to a hut at its top, crowned.
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2 - 0.2;
    const r = Math.max(0.5, Math.min(x1 - x0, z1 - z0) * 0.15);
    const h = 3.0 + floors * 1.8;
    frustum(b, cx, cz, 0, h + 3.0, r * 1.1, r * 0.6, 10, m.bark);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      if (Math.cos(a) > 0.8) continue;
      limb(b, [cx + Math.sin(a) * r * 0.6, r * 1.6, cz + Math.cos(a) * r * 0.6], [cx + Math.sin(a) * r * 2.0, 0, cz + Math.cos(a) * r * 2.0], r * 0.4, r * 0.15, m.bark, 6);
    }
    const zf = cz + r * 1.1 + 0.05;
    b.box(cx - 0.8, 0, zf - 0.4, cx + 0.8, 2.35, zf, sides(tiled(m.bark)));
    b.card(fitted(m.door), cx - 0.625, 0.05, cx + 0.625, 2.05, zf + 0.01);
    plaque(b, cx, 2.35, zf + 0.01, leafSign(tradeOf(building) ?? "magic", m));
    spiral(b, cx, cz, r * 0.9, h, m, Math.PI);
    const dr = Math.min(x1 - x0, z1 - z0) / 2 + 0.2;
    deck(b, cx, cz, h, dr, r, m);
    hut(b, cx, cz, h, Math.max(r + 0.5, dr * 0.62), 1.9, m, 2.6);
    for (let k = 1; k < floors; k++) pod(b, cx + r * 1.2 * Math.sin(k * 2), 2.5 + k * 1.8, cz + r * 1.2 * Math.cos(k * 2), m);
    crown(b, cx, cz, h + 4.6, 1.6, m, 7);
    return [cx, 1, zf];
  };
}

function library(building: BuildingData, m: Mats, trade: Trade): Draw {
  return treeHouse(building, m, 3, (b, t) => plaque(b, t.cx, 2.4, t.door + 0.01, leafSign(trade, m)));
}

function warehouse(m: Mats, trade: Trade): Draw {
  return (b, x0, z0, x1, z1) => {
    // A root-cellar: a long mound of moss and earth, roots knotted over it, a framed door into its front.
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2 - 0.2;
    const rx = (x1 - x0) / 2 - 0.1;
    const rz = (z1 - z0) / 2 - 0.3;
    const earth = rock(R.LOAM, R.MOSS);
    b.blob(cx, 0.2, cz, rx, 2.0, rz, foliage(R.MOSS));
    b.blob(cx, 0.1, cz + 0.1, rx * 0.98, 1.6, rz * 0.98, earth);
    const random = seeded(17);
    for (let i = 0; i < 6; i++) {
      const a = -1.2 + i * 0.48;
      const sx = cx + Math.sin(a) * rx * 0.9;
      limb(b, [sx, 0, cz - rz * 0.9], [cx + Math.sin(a) * rx * 0.4, 2.1 + random() * 0.2, cz], 0.14, 0.1, m.bark, 5);
      limb(b, [cx + Math.sin(a) * rx * 0.4, 2.1, cz], [sx + 0.2, 0, cz + rz * 0.85], 0.1, 0.13, m.bark, 5);
    }
    const zf = cz + rz * 0.92;
    b.box(cx - 1.0, 0, zf - 0.6, cx + 1.0, 2.5, zf, sides(tiled(m.wood)));
    roofFace(b, m.roof, [[cx - 1.2, 2.4, zf + 0.25], [cx + 1.2, 2.4, zf + 0.25], [cx + 1.2, 2.9, zf - 0.7], [cx - 1.2, 2.9, zf - 0.7]], 0.95, 0.5);
    b.card(fitted(doorMaterial(R.ELFWOOD, R.ELFWOOD, "round", true)), cx - 0.625, 0, cx + 0.625, 2.0, zf + 0.01);
    pod(b, cx + 1.15, 1.8, zf + 0.1, m);
    crate(b, x0 + 0.7, z1 - 0.5, 0.6, "carrots");
    sack(b, x0 + 1.4, z1 - 0.4);
    barrel(b, x1 - 0.6, z1 - 0.5, 0.75);
    plaque(b, cx, 2.0, zf + 0.02, leafSign(trade, m));
    return [cx, 1, zf];
  };
}

function gatehouse(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    // Two trees either side of the passage, their limbs grown together into an arch over it, a bridge between them.
    const xm = (x0 + x1) / 2;
    const zc = (z0 + z1) / 2;
    const r = Math.min(0.75, ((x1 - x0) / 2 - 1) * 0.42);
    const ta = (x0 + xm - 1) / 2;
    const tb = (xm + 1 + x1) / 2;
    for (const [tx, s] of [
      [ta, 1],
      [tb, -1],
    ] as const) {
      trunk(b, tx, zc, r, 6.0, m, false, s);
      limb(b, [tx, 4.6, zc], [xm, 5.8, zc], r * 0.55, r * 0.35, m.bark, 7);
      crown(b, tx, zc, 7.0, 1.8, m, s + 3);
    }
    crown(b, xm, zc, 6.4, 1.2, m, 9);
    b.box(ta, 3.4, zc - 0.5, tb, 3.6, zc + 0.5, sides(tiled(m.wood), tiled(m.deck)));
    for (const z of [zc - 0.45, zc + 0.45]) limb(b, [ta, 4.2, z], [tb, 4.2, z], 0.035, 0.035, m.wood, 4);
    deckBanner(b, xm - 0.5, 3.35, zc + 0.52, m);
    deckBanner(b, xm + 0.5, 3.35, zc + 0.52, m);
    pod(b, xm, 3.0, zc + 0.6, m);
    return [xm, 1, z1];
  };
}

function wall(building: BuildingData, m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    // A living palisade: roots grown up and woven together into a fence, a hedge along its top.
    const along = x1 - x0 >= z1 - z0;
    const length = along ? x1 - x0 : z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const at = (t: number, off = 0): [number, number] => (along ? [x0 + t * length, cz + off] : [cx + off, z0 + t * length]);
    const n = Math.max(2, Math.round(length / 0.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const [xa, za] = at(t, -0.12);
      const [xb, zb] = at(Math.min(1, t + 0.7 / length), 0.12);
      const [xc, zc] = at(Math.max(0, t - 0.7 / length), 0.12);
      limb(b, [xa, 0, za], [xb, 2.1, zb], 0.1, 0.07, m.bark, 5);
      limb(b, [xa, 0, za], [xc, 2.0, zc], 0.09, 0.06, m.bark, 5);
    }
    const random = seeded(Math.round(Math.abs(building.x * 7 + building.z)));
    for (let t = 0.05; t < 1; t += 0.7 / length) {
      const [x, z] = at(t);
      b.blob(x, 2.1 + random() * 0.2, z, 0.48, 0.4, 0.42, m.leaves, [x * 16, z * 16]);
    }
    return undefined;
  };
}

function wallTower(m: Mats): Draw {
  return (b, x0, z0, x1, z1) => {
    // A lookout: a trunk with a railed deck high up, a leaf canopy on poles over it, a lantern.
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const r = Math.max(0.4, Math.min(x1 - x0, z1 - z0) * 0.2);
    const dr = Math.min(x1 - x0, z1 - z0) / 2 + 0.25;
    trunk(b, cx, cz, r, 4.0, m, false, 4);
    spiral(b, cx, cz, r * 0.95, 3.8, m);
    deck(b, cx, cz, 3.8, dr, r, m);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      limb(b, [cx + Math.sin(a) * dr * 0.8, 3.8, cz + Math.cos(a) * dr * 0.8], [cx + Math.sin(a) * dr * 0.8, 5.4, cz + Math.cos(a) * dr * 0.8], 0.05, 0.05, m.wood, 4);
    }
    coneRoof(b, cx, cz, 5.4, dr + 0.3, 1.4, m.roof, 10);
    pod(b, cx, 4.9, cz + dr * 0.5, m);
    deckBanner(b, cx, 3.65, cz + dr + 0.02, m);
    return undefined;
  };
}

const smithyFire = (x0: number, z0: number): XYZ[] => [[x0 + 1.2, 0.85, z0 + 1.0 + 1.3 + 0.2]];

function llanowar(building: BuildingData, pal: Palette): Built {
  const kind = building.kind ?? "house";
  const P = paramsOf(building);
  const m = mats(pal);
  const trade = tradeOf(building);
  const go = (height: number, draw: Draw, through = false) => styled(building, { cap: m.deck, height, through }, draw);
  const s = Math.min(building.w, building.d);
  const treeTop = (levels: number) => P.num("deck", 3) + (levels - 1) * 3.2 + 3.2 + Math.max(2.0, (s / 2) * 0.95) * 1.15;
  switch (kind) {
    case "shop":
      return go(treeTop(1), treeHouse(building, m, 1, shopStall(m, trade ?? "general")));
    case "tenement":
      return go(treeTop(P.num("floors", 3)), treeHouse(building, m, P.num("floors", 3)));
    case "inn":
      return go(treeTop(2), treeHouse(building, m, 2, (b, t) => hangingSign(b, t.cx + 1.25, 2.4, t.door - 0.4, leafSign(trade ?? "inn", m), tiled(m.wood))));
    case "temple":
      return go(10.6 + s * 0.45 * 1.15, temple(m, trade ?? "temple"));
    case "guildhall":
      return go(8.5, guildhall(m, trade ?? "guild"));
    case "smithy":
      return { ...go(4.4, smithy(m, trade ?? "smith")), frames: [fireFrames(building, (x0, z0) => smithyFire(x0, z0))] };
    case "library":
      return go(treeTop(3), library(building, m, trade ?? "books"));
    case "tower": {
      const floors = P.num("floors", 3);
      return go(3.0 + floors * 1.8 + 5.6, tower(building, m, floors));
    }
    case "warehouse":
      return go(3.0, warehouse(m, trade ?? "general"));
    case "gatehouse":
      return go(8.2, gatehouse(m), true);
    case "wall":
      return go(2.6, wall(building, m));
    case "wall-tower":
      return go(6.8, wallTower(m));
    default:
      return go(treeTop(1), treeHouse(building, m, 1));
  }
}

BUILDINGS.define(
  "llanowar",
  "Llanowar's style - tree-houses of the elfhames: living mossy trunks with doors in their feet, round railed decks and woven huts under leaf-thatch cones, stairs winding up, seed-pod lanterns, green-and-gold banners, leaf signs. Kinds: house, shop (a stall at the foot), tenement (floors decks), inn (two decks), temple (a sanctuary of rooted arches, a shrine high up), guildhall (a long hall on a broad deck, a stair up), smithy (an open forge under arching roots), library (three decks), tower (a slender tree climbed to a hut; floors), warehouse (a root-cellar mound), gatehouse (two trees arching over the passage, the middle 2 tiles), wall (a living palisade along its longer side), wall-tower (a lookout deck); params: trade, deck (3), floors. Palette: bark, leaves, timber, roof, cloth, trim",
  llanowar,
  LLANOWAR,
);

showcase("llanowar", [
  { kind: "house", w: 5, d: 5 },
  { kind: "house", w: 4, d: 4, label: "small" },
  { kind: "shop", w: 6, d: 5, params: { trade: "herbs" } },
  { kind: "inn", w: 6, d: 6 },
  { kind: "tenement", w: 5, d: 5, params: { floors: 3 } },
  { kind: "temple", w: 7, d: 7 },
  { kind: "guildhall", w: 8, d: 6 },
  { kind: "smithy", w: 6, d: 5 },
  { kind: "library", w: 6, d: 6 },
  { kind: "tower", w: 4, d: 4, params: { floors: 3 } },
  { kind: "warehouse", w: 6, d: 5 },
  { kind: "gatehouse", w: 6, d: 3 },
  { kind: "wall-tower", w: 3, d: 3 },
  { kind: "wall", w: 6, d: 1 },
]);

