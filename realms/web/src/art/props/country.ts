import type { PropData } from "../../world/format";
import { type Face, type Material, MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import { type Ramp, rampKey } from "../paint/palette";
import { Pixmap, hash2, seeded } from "../paint/pixmap";
import { sprite } from "../paint/sprite";
import * as R from "../paint/ramps";
import * as T from "../paint/textures";
import { along, centred, describe, over, prop } from "./catalogue";
import * as D from "./draw";
import { PX, atScaled, bannerMaterial, bark, cloth, cutout, disc, flames, foliage, frustum, glowing, limb, lump, planks, ringsMaterial, rock, wood } from "./kit";
import { bool, needs, num, point, str, turnOf } from "./registry";

// The country's and the road's made things: fences, walls and hedges; ruins and statues; torches, fire bowls, campfires
// and lanterns; signposts, waymarkers by tier, banners, quest boards and waystones; wells, carts and wagons, hay, wood,
// troughs, stalls and anvils; caravans, tents and pavilions; bridges, fords, docks and boats. Line props run from their
// anchor (x, z) to `args.to`; area props cover the rectangle from their anchor to `args.to`. Lights are the chunk's:
// each lit prop's catalogue entry says where its light is (catalogue.ts).

type V3 = [number, number, number];

/** Runs `draw` in a frame along the line from (x, z) to `to`: local +x along it, its length given. */
function alongLine(b: MeshBuilder, p: PropData, draw: (length: number) => void): void {
  const [x1, z1] = point(p, "to");
  const dx = x1 - p.x;
  const dz = z1 - p.z;
  const length = Math.hypot(dx, dz);
  b.at(p.x, p.y ?? 0, p.z, Math.atan2(-dz, dx), () => draw(length));
}

const turned = turnOf;

// --- Pictures -----------------------------------------------------------------------------------------------------------

/** Wattle: withies woven between stakes, 16 by 16. */
function wattlePicture(r: Ramp): Pixmap {
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const row = Math.floor(y / 3);
      const over = (Math.floor(x / 4) + row) % 2 === 0;
      let c = over ? r[4]! : r[2]!;
      if (y % 3 === 2) c = r[1]!;
      if (over && y % 3 === 0) c = r[5]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A wheel, 16 by 16, cut out: a rim, a hub and spokes. */
function wheelPicture(r: Ramp): Pixmap {
  const p = new Pixmap(16, 16);
  p.fill(0, 0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const a = Math.atan2(y - 7.5, x - 7.5);
      if (d > 8) continue;
      if (d > 6.2) p.set(x, y, d > 7.2 ? C.IRON[2]! : r[3]!);
      else if (d < 1.8) p.set(x, y, C.IRON[3]!);
      else if (Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.36) p.set(x, y, r[4]!);
    }
  }
  return p;
}

/** Parchments pinned to a board, 24 by 16: a quest board's notices. */
function noticesPicture(): Pixmap {
  const p = new Pixmap(24, 16);
  const w = C.WOOD;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) p.set(x, y, y % 4 === 0 ? w[2]! : w[3]!);
  const random = seeded(7);
  for (const [x0, y0, pw, ph] of [
    [1, 1, 7, 9],
    [9, 2, 6, 7],
    [16, 1, 7, 10],
    [5, 9, 7, 6],
    [14, 10, 6, 5],
  ] as const) {
    for (let y = y0; y < y0 + ph; y++) {
      for (let x = x0; x < x0 + pw; x++) {
        let c = y === y0 + ph - 1 ? C.STRAW[2]! : C.STRAW[4]!;
        if (y > y0 && y < y0 + ph - 1 && x > x0 && x < x0 + pw - 1 && (y - y0) % 2 === 0 && random() < 0.7) c = C.WOOD[1]!;
        p.set(x, y, c);
      }
    }
    p.set(x0 + Math.floor(pw / 2), y0, C.RED[3]!);
  }
  return p;
}

/** A banner by tier, 12 by 32, cut out: the tier's color, its number in white pips down it. */
function tierBannerPicture(tier: number): Pixmap {
  const r = R.TIER[tier]!;
  const p = new Pixmap(12, 32);
  p.fill(0, 0);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 12; x++) {
      const notch = 32 - y;
      if (notch <= 5 && Math.abs(x - 5.5) < 6 - notch) continue;
      let c = r[3]!;
      if (x === 3 || x === 8) c = r[2]!;
      if (x === 4 || x === 9) c = r[4]!;
      if (x === 0 || x === 11) c = C.CLOTH_WHITE[3]!;
      if (y < 2) c = C.CLOTH_WHITE[y === 0 ? 4 : 2]!;
      p.set(x, y, c);
    }
  }
  for (let k = 0; k < tier; k++) {
    const y = 6 + k * 5;
    p.set(5, y, 0xffffff);
    p.set(6, y, 0xffffff);
    p.set(5, y + 1, 0xffffff);
    p.set(6, y + 1, C.CLOTH_WHITE[2]!);
  }
  return p;
}

/** A signpost's arrow board, 24 by 8, cut out: a pointed plank with a scrawl of lettering. */
function arrowPicture(): Pixmap {
  const p = new Pixmap(24, 8);
  p.fill(0, 0);
  const w = C.WOOD;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 24; x++) {
      const tip = x - 18;
      if (tip > 0 && Math.abs(y - 3.5) > 4 - tip * 0.7) continue;
      let c = y === 0 ? w[6]! : y === 7 ? w[2]! : w[4]!;
      if (y >= 2 && y <= 5 && x > 2 && x < 17 && hash2(x, y, 3) < 0.45) c = w[1]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Runes carved and glowing, 8 by 24: a waystone's face. */
function runesPicture(r: Ramp): Pixmap {
  const p = new Pixmap(8, 24);
  p.fill(0, 0);
  const glyphs = ["x.x", ".x.", "x.x", "...", "xxx", "x..", "xx.", "...", ".x.", "xxx", ".x.", "...", "x..", "xxx", "..x", "...", "xxx", "x.x", "xxx"];
  glyphs.forEach((row, y) => {
    for (let i = 0; i < 3; i++) if (row[i] === "x") p.set(2 + i, y + 2, r[5]!);
  });
  return p;
}

const wattle = (r: Ramp) => material(`wattle@${rampKey(r)}`, () => wattlePicture(r));
const wheel = (r: Ramp) => cutout(`wheel@${rampKey(r)}`, () => wheelPicture(r));

// --- Fences, walls and hedges -----------------------------------------------------------------------------------------

/** A post-and-rail fence along a line: posts every 1.2, two rails between. */
function fence(b: MeshBuilder, length: number, timber: Face, h = 1.0): void {
  const n = Math.max(1, Math.round(length / 1.2));
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * length;
    b.box(x - 0.07, 0, -0.07, x + 0.07, h, 0.07, sides(timber));
  }
  for (const y of [h * 0.4, h * 0.8]) b.box(0, y, -0.035, length, y + 0.09, 0.035, sides(timber));
}

prop("fence", "a post-and-rail fence from x, z to args.to", { category: "fence", biomes: ["plains", "farmland", "town", "keld"], footprint: along(0.3), sample: { args: { to: [5, 0] } } }, (b, p, pal) => alongLine(b, p, (l) => fence(b, l, tiled(wood(pal.timber!)))), { timber: C.WOOD }, needs({ to: "point" }));
prop(
  "picket-fence",
  "a whitewashed picket fence from x, z to args.to",
  { category: "fence", biomes: ["town", "farmland", "plains"], footprint: along(0.3), sample: { args: { to: [5, 0] } } },
  (b, p, pal) =>
    alongLine(b, p, (l) => {
      const paint = tiled(stock.plaster(pal.plaster));
      const n = Math.max(1, Math.round(l / 0.22));
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * l;
        b.box(x - 0.05, 0, -0.02, x + 0.05, 0.75, 0.02, sides(paint));
        b.box(x - 0.03, 0.75, -0.02, x + 0.03, 0.82, 0.02, sides(paint));
      }
      for (const y of [0.2, 0.55]) b.box(0, y, -0.05, l, y + 0.07, -0.02, sides(tiled(wood(pal.timber!))));
    }),
  { plaster: C.PLASTER, timber: C.WOOD },
  needs({ to: "point" }),
);
prop(
  "wattle-fence",
  "a woven wattle fence from x, z to args.to, stakes standing through it",
  { category: "fence", biomes: ["farmland", "plains", "llanowar", "swamp"], footprint: along(0.3), sample: { args: { to: [5, 0] } } },
  (b, p, pal) =>
    alongLine(b, p, (l) => {
      b.box(0, 0.05, -0.05, l, 0.8, 0.05, sides(tiled(wattle(pal.timber!))));
      const n = Math.max(1, Math.round(l / 0.9));
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * l;
        b.box(x - 0.04, 0, -0.06, x + 0.04, 0.95, 0.06, sides(tiled(wood(C.WOOD))));
      }
    }),
  { timber: C.STRAW },
  needs({ to: "point" }),
);
prop(
  "stone-wall",
  "a dry-stone wall from x, z to args.to, capped with upright stones; args.h its height (0.8)",
  { category: "fence", biomes: ["plains", "farmland", "mountain", "tundra", "keld"], footprint: along(0.6), sample: { args: { to: [6, 0] } } },
  (b, p, pal) =>
    alongLine(b, p, (l) => {
      const h = num(p, "h", 0.8);
      const stone = tiled(material(`fieldstone@${rampKey(pal.stone!)}`, () => fieldstone(pal.stone!)));
      b.box(0, 0, -0.28, l, h, 0.28, sides(stone));
      const random = seeded(p.seed ?? 3);
      for (let x = 0.1; x < l - 0.1; x += 0.24) {
        const t = 0.16 + random() * 0.08;
        b.box(x, h, -0.22, x + 0.2, h + t, 0.22, sides(stone));
      }
    }),
  { stone: R.GRANITE },
  needs({ to: "point" }),
);
prop(
  "palisade",
  "a palisade of sharpened logs from x, z to args.to; args.h their height (2.2)",
  { category: "fence", biomes: ["keld", "tundra", "forest", "swamp"], footprint: along(0.4), sample: { args: { to: [5, 0] } } },
  (b, p, pal) =>
    alongLine(b, p, (l) => {
      const h = num(p, "h", 2.2);
      const bk = bark(pal.timber!);
      const n = Math.max(1, Math.floor(l / 0.3));
      for (let i = 0; i < n; i++) {
        const x = 0.15 + i * 0.3;
        const t = h * (0.9 + hash2(i, 1, p.seed ?? 0) * 0.15);
        frustum(b, x, 0, 0, t - 0.3, 0.15, 0.14, 6, bk);
        frustum(b, x, 0, t - 0.3, t, 0.14, 0, 6, bk);
      }
      b.box(0, h * 0.55, 0.12, l, h * 0.55 + 0.12, 0.2, sides(tiled(wood(C.DARKWOOD))));
    }),
  { timber: R.LOG },
  needs({ to: "point" }),
);
prop(
  "hedge",
  "a clipped hedge from x, z to args.to, args.h high (1.1)",
  { category: "fence", biomes: ["town", "plains", "farmland"], footprint: along(0.8), sample: { args: { to: [5, 0] } } },
  (b, p, pal) =>
    alongLine(b, p, (l) => {
      const h = num(p, "h", 1.1);
      b.roundedBox(0, 0, -0.38, l, h, 0.38, 0.12, sides(tiled(foliage(pal.leaves!))), { steps: 2 });
    }),
  { leaves: C.LEAF },
  needs({ to: "point" }),
);
prop(
  "fence-gate",
  "a field gate of planks and a brace between two posts, its middle at x, z, across x (turned by rot); args.open swings it",
  { category: "fence", biomes: ["farmland", "plains", "town"], footprint: { rect: [-0.8, -0.15, 0.8, 0.15], blocks: false } },
  (b, p, pal) => {
    const timber = tiled(wood(pal.timber!));
    b.at(p.x, 0, p.z, turned(p), () => {
      for (const x of [-0.72, 0.72]) b.box(x - 0.08, 0, -0.08, x + 0.08, 1.15, 0.08, sides(timber));
      b.at(-0.64, 0, 0, bool(p, "open") ? -1.3 : 0, () => {
        for (const y of [0.25, 0.55, 0.85]) b.box(0, y, -0.03, 1.28, y + 0.1, 0.03, sides(timber));
        b.box(0.02, 0.2, -0.03, 0.1, 0.95, 0.03, sides(timber));
        b.box(1.18, 0.2, -0.03, 1.26, 0.95, 0.03, sides(timber));
        limb(b, [0.1, 0.3, 0.04], [1.2, 0.85, 0.04], 0.03, 0.03, wood(pal.timber!), 4);
      });
    });
  },
  { timber: C.WOOD },
);

function fieldstone(r: Ramp): Pixmap {
  const p = T.cobbles(52);
  // Recolored from the cobbles' greys to the palette's stone, keeping their shading.
  const k = C.COBBLE;
  const map = new Map(k.map((c, i) => [c, r[Math.min(r.length - 1, i)]!]));
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) p.set(x, y, map.get(p.get(x, y)) ?? p.get(x, y));
  return p;
}

// --- Ruins and statues ---------------------------------------------------------------------------------------------------

const ashlarOf = (r: Ramp) => material(`ruin-ashlar@${rampKey(r)}`, () => T.ashlar(r, 61, 6, 7, 11));

prop(
  "ruined-wall",
  "a ruined wall of ashlar from x, z to args.to, broken off at heights up to args.h (2.5), fallen blocks at its foot",
  { category: "ruin", biomes: ["plains", "waste", "forest", "mountain", "swamp"], footprint: along(0.8), sample: { seed: 2, args: { to: [6, 0], h: 2.5 } } },
  (b, p, pal) =>
    alongLine(b, p, (l) => {
      const h = num(p, "h", 2.5);
      const stone = tiled(ashlarOf(pal.stone!));
      const random = seeded((p.seed ?? 0) + 41);
      const n = Math.max(2, Math.round(l / 0.5));
      for (let i = 0; i < n; i++) {
        const xa = (i / n) * l;
        const xb = ((i + 1) / n) * l;
        const t = h * (0.2 + 0.8 * Math.abs(Math.sin(i * 1.3 + (p.seed ?? 0)))) * (0.75 + random() * 0.25);
        b.box(xa, 0, -0.3, xb, t, 0.3, sides(stone));
      }
      for (let k = 0; k < Math.round(l / 1.5); k++) {
        const s = 0.18 + random() * 0.12;
        b.at(0.4 + random() * (l - 0.8), 0, 0.55 + random() * 0.35, random() * 2, () => b.roundedBox(-s, 0, -s * 0.7, s, s * 0.9, s * 0.7, PX, sides(fitted(ashlarOf(pal.stone!), [0, 0, 8, 6]))));
      }
    }),
  { stone: C.LIMESTONE },
  needs({ to: "point" }),
);

function column(b: MeshBuilder, x: number, z: number, h: number, stone: Ramp, broken: boolean, seed: number): void {
  const flag = stock.flagstone(stone);
  const shaft = material(`column-shaft@${rampKey(stone)}`, () => {
    const q = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) for (let xx = 0; xx < 16; xx++) q.set(xx, y, xx % 4 === 0 ? stone[3]! : xx % 4 === 1 ? stone[5]! : stone[4]!);
    return q;
  }, { smooth: true });
  b.box(x - 0.42, 0, z - 0.42, x + 0.42, 0.3, z + 0.42, sides(tiled(flag)));
  if (broken) {
    b.cylinder(x, z, 0.3, h * 0.6, 0.28, 10, { mat: shaft });
    lump(b, x, z, h * 0.6, [[0.28, 0], [0.24, 0.2], [0.1, 0.38]], 10, shaft, seed, 0.3);
  } else {
    b.cylinder(x, z, 0.3, h - 0.3, 0.28, 10, { mat: shaft });
    b.box(x - 0.38, h - 0.3, z - 0.38, x + 0.38, h, z + 0.38, sides(tiled(flag)));
  }
}

prop(
  "column",
  "a fluted column on its plinth at x, z, args.h high (3); args.broken snaps it off with its drum fallen beside it",
  { category: "ruin", biomes: ["plains", "waste", "coast", "town"], footprint: centred(1, 1), sample: { args: { h: 3 } } },
  (b, p, pal) => {
    const h = num(p, "h", 3);
    const broken = bool(p, "broken");
    column(b, p.x, p.z, h, pal.stone!, broken, p.seed ?? 0);
    if (broken) limb(b, [p.x + 0.5, 0.28, p.z + 0.3], [p.x + 1.5, 0.28, p.z + 0.7], 0.27, 0.27, material(`column-shaft@${rampKey(pal.stone!)}`, () => new Pixmap(16, 16, pal.stone![4]!)), 10, true);
  },
  { stone: C.LIMESTONE },
);
prop(
  "ruined-arch",
  "a ruined arch: two piers and the springing of an arch between them, one side broken, centred at x, z across x (turned by rot); 3 wide",
  { category: "ruin", biomes: ["plains", "waste", "forest", "mountain"], footprint: { rect: [-1.6, -0.4, 1.6, 0.4], blocks: false } },
  (b, p, pal) => {
    const stone = tiled(ashlarOf(pal.stone!));
    b.at(p.x, 0, p.z, turned(p), () => {
      b.box(-1.6, 0, -0.35, -0.9, 2.6, 0.35, sides(stone));
      b.box(0.9, 0, -0.35, 1.6, 1.7, 0.35, sides(stone));
      // The voussoirs round the arch, from the left pier up past the crown and broken off beyond it.
      const segments = 9;
      for (let i = 0; i < segments - 2; i++) {
        const a0 = Math.PI - (i / segments) * Math.PI;
        const a1 = Math.PI - ((i + 1) / segments) * Math.PI;
        const r0 = 0.9;
        const r1 = 1.55;
        const pt = (a: number, r: number): V3 => [Math.cos(a) * r, 2.6 + Math.sin(a) * r * 0.75, 0];
        for (const zz of [0.35, -0.35]) {
          const s = zz > 0 ? 1 : -1;
          const q = [pt(a0, r0), pt(a1, r0), pt(a1, r1), pt(a0, r1)].map((c) => [c[0], c[1], zz] as V3);
          b.polygon(stone.mat, s > 0 ? [q[1]!, q[0]!, q[3]!, q[2]!] : q, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
        const top0 = pt(a0, r1);
        const top1 = pt(a1, r1);
        b.polygon(stone.mat, [[top0[0], top0[1], 0.35], [top1[0], top1[1], 0.35], [top1[0], top1[1], -0.35], [top0[0], top0[1], -0.35]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    });
  },
  { stone: C.LIMESTONE },
);
prop(
  "rubble-heap",
  "a heap of fallen ashlar and broken stone round x, z (a tile and a half across)",
  { category: "ruin", biomes: ["plains", "waste", "town", "mountain"], footprint: centred(1.5, 1.5), sample: { seed: 2 } },
  (b, p, pal) => {
    const random = seeded((p.seed ?? 0) + 3);
    lump(b, p.x, p.z, 0, [[0.75, 0], [0.55, 0.3], [0.2, 0.5]], 7, rock(pal.stone!, null), p.seed ?? 0, 0.3);
    for (let i = 0; i < 6; i++) {
      const s = 0.14 + random() * 0.14;
      b.at(p.x + (random() - 0.5) * 1.3, 0.1 + random() * 0.25, p.z + (random() - 0.5) * 1.1, random() * 3, () => b.roundedBox(-s, 0, -s * 0.7, s, s * 0.9, s * 0.7, PX, sides(fitted(ashlarOf(pal.stone!), [0, 0, 8, 6]))));
    }
  },
  { stone: C.LIMESTONE },
);

/** A statue: a knight with sword and shield, or an angel with her wings spread, of stone on a plinth. */
function statue(b: MeshBuilder, x: number, z: number, kind: "knight" | "angel", stone: Ramp): void {
  const s = material(`statue@${rampKey(stone)}`, () => T.ashlar(stone, 71, 16, 30, 40, 32, 32), { smooth: true });
  const face = tiled(s);
  b.box(x - 0.6, 0, z - 0.6, x + 0.6, 0.5, z + 0.6, sides(tiled(stock.flagstone(stone))));
  b.box(x - 0.48, 0.5, z - 0.48, x + 0.48, 1.0, z + 0.48, sides(face));
  const y = 1.0;
  // Legs, a robe or tabard, the body, the head.
  b.box(x - 0.2, y, z - 0.1, x - 0.04, y + 0.7, z + 0.1, sides(face));
  b.box(x + 0.04, y, z - 0.1, x + 0.2, y + 0.7, z + 0.1, sides(face));
  b.box(x - 0.26, y + 0.55, z - 0.14, x + 0.26, y + 1.45, z + 0.14, sides(face));
  b.roundedBox(x - 0.15, y + 1.45, z - 0.14, x + 0.15, y + 1.78, z + 0.14, 0.05, sides(face));
  if (kind === "knight") {
    // A sword held point-down before it, a shield on its arm.
    b.box(x - 0.03, y + 0.15, z + 0.16, x + 0.03, y + 1.15, z + 0.22, sides(face));
    b.box(x - 0.16, y + 1.1, z + 0.15, x + 0.16, y + 1.16, z + 0.23, sides(face));
    b.roundedBox(x + 0.26, y + 0.6, z - 0.2, x + 0.34, y + 1.25, z + 0.2, 0.03, sides(face));
    b.box(x - 0.33, y + 0.75, z - 0.08, x - 0.26, y + 1.4, z + 0.08, sides(face));
  } else {
    // Wings spread behind, arms raised: each wing drawn both ways round, so it shows from either side.
    for (const sgn of [-1, 1]) {
      const wing: V3[] = [
        [x + sgn * 0.15, y + 1.0, z - 0.1],
        [x + sgn * 1.0, y + 1.9, z - 0.25],
        [x + sgn * 0.85, y + 1.25, z - 0.2],
        [x + sgn * 0.5, y + 0.6, z - 0.15],
      ];
      const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      b.polygon(s, wing, uv);
      b.polygon(s, [...wing].reverse(), [...uv].reverse());
      b.box(x + sgn * 0.26, y + 1.2, z - 0.06, x + sgn * 0.34, y + 1.85, z + 0.06, sides(face));
    }
  }
}

prop(
  "statue",
  "a statue on a plinth at x, z: args.figure knight|angel (knight), of its palette's stone; args.size the tiles across it fills (1.2: a town's centrepiece 2 or 3), turned by rot",
  { category: "ruin", biomes: ["town", "plains", "waste"], footprint: { rect: [-0.6, -0.6, 0.6, 0.6], blocks: true, sizeArg: true }, sample: { args: { figure: "angel", size: 2 } } },
  (b, p, pal) => atScaled(b, p.x, 0, p.z, turned(p), (p.scale ?? 1) * (num(p, "size", 1.2) / 1.2), () => statue(b, 0, 0, str<string>(p, "figure", "knight") === "angel" ? "angel" : "knight", pal.stone!)),
  { stone: C.LIMESTONE },
);

// --- Lights ------------------------------------------------------------------------------------------------------------

const FIRE_LIGHT = { kind: "point", color: [1.0, 0.62, 0.3], intensity: 2.2, reach: 6, decay: 1.4, flicker: { base: 2.0, steps: [0, 0.3, 0.1, 0.35], rate: 8 } } as const;

prop(
  "torch-post",
  "a torch on a post at x, z, its flame burning (1.9 up)",
  { category: "light", biomes: ["any"], footprint: centred(0.3, 0.3), light: { ...FIRE_LIGHT, at: [0, 2.0, 0] } },
  (b, p) => {
    const t = tiled(wood(C.DARKWOOD));
    b.box(p.x - 0.06, 0, p.z - 0.06, p.x + 0.06, 1.6, p.z + 0.06, sides(t));
    b.cylinder(p.x, p.z, 1.6, 1.78, 0.11, 6, { mat: D.iron() }, { mat: glowing(C.FIRE[2]!) });
    return { frames: [flames(p.x, 1.72, p.z + 0.01, 10)] };
  },
);
prop(
  "fire-bowl",
  "a fire bowl of iron on three legs at x, z, flames in it (Keld's halls, a camp's watch)",
  { category: "light", biomes: ["keld", "town", "waste", "volcanic"], footprint: centred(0.8, 0.8), light: { ...FIRE_LIGHT, at: [0, 1.4, 0] } },
  (b, p) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      limb(b, [p.x + Math.sin(a) * 0.4, 0, p.z + Math.cos(a) * 0.4], [p.x + Math.sin(a) * 0.15, 0.8, p.z + Math.cos(a) * 0.15], 0.035, 0.035, D.iron(), 4);
    }
    b.cylinder(p.x, p.z, 0.8, 1.05, 0.36, 8, { mat: D.iron() }, { mat: glowing(C.FIRE[2]!) }, -0.15);
    return { frames: [flames(p.x, 1.0, p.z + 0.01, 14)] };
  },
);
prop(
  "campfire",
  "a campfire at x, z: a ring of stones, crossed logs, embers and flames",
  { category: "light", biomes: ["any"], footprint: centred(1.2, 1.2), light: { ...FIRE_LIGHT, at: [0, 0.6, 0] } },
  (b, p) => {
    const stone = rock(C.COBBLE, null);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      lump(b, p.x + Math.sin(a) * 0.5, p.z + Math.cos(a) * 0.45, 0, [[0.13, 0], [0.12, 0.08], [0, 0.15]], 5, stone, i, 0.25);
    }
    const bk = bark(C.WOOD);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      limb(b, [p.x + Math.sin(a) * 0.4, 0.05, p.z + Math.cos(a) * 0.35], [p.x - Math.sin(a) * 0.05, 0.35, p.z - Math.cos(a) * 0.05], 0.06, 0.05, bk, 5);
    }
    b.decal(fitted(material("embers-bed", () => embersPicture(), { glowing: true })), p.x - 0.32, p.z - 0.3, p.x + 0.32, p.z + 0.3, 0.01);
    return { frames: [flames(p.x, 0.08, p.z + 0.02, 14)] };
  },
);
prop(
  "lantern-post",
  "a crooked pole with a lantern hung from its arm at x, z (the Morass's, its glass args.glow gold|green)",
  { category: "light", biomes: ["swamp", "morass", "town", "road"], footprint: centred(0.3, 0.3), light: { kind: "point", color: [0.9, 0.95, 0.45], intensity: 1.6, reach: 5, decay: 1.5, at: [0.6, 1.8, 0] } },
  (b, p) => {
    const bk = bark(R.DEADWOOD);
    limb(b, [p.x, 0, p.z], [p.x + 0.08, 1.2, p.z], 0.07, 0.06, bk, 5);
    limb(b, [p.x + 0.08, 1.2, p.z], [p.x - 0.04, 2.3, p.z], 0.06, 0.05, bk, 5);
    limb(b, [p.x - 0.02, 2.15, p.z], [p.x + 0.65, 2.3, p.z], 0.04, 0.03, bk, 4);
    b.box(p.x + 0.59, 1.92, p.z - 0.01, p.x + 0.61, 2.28, p.z + 0.01, sides(D.iron()));
    const glass = str<string>(p, "glow", "gold") === "green" ? glowing(0xc8e86a) : glowing(C.GOLD[4]!);
    b.box(p.x + 0.48, 1.55, p.z - 0.12, p.x + 0.72, 1.85, p.z + 0.12, sides(fitted(glass)));
    b.box(p.x + 0.45, 1.85, p.z - 0.15, p.x + 0.75, 1.93, p.z + 0.15, sides(D.iron()));
    b.box(p.x + 0.47, 1.5, p.z - 0.14, p.x + 0.73, 1.55, p.z + 0.14, sides(D.iron()));
  },
);

function embersPicture(): Pixmap {
  const p = new Pixmap(10, 10);
  p.fill(0, 0);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (Math.hypot(x - 4.5, y - 4.5) < 4.6) p.set(x, y, [C.FIRE[0]!, C.FIRE[1]!, C.FIRE[2]!, C.FIRE[0]!][(x * 7 + y * 3) % 4]!);
  return p;
}

// --- Signs, markers and banners ---------------------------------------------------------------------------------------

prop(
  "signpost",
  "a signpost at x, z with args.arrows boards (1-3, default 2) pointing different ways",
  { category: "sign", biomes: ["road", "any"], footprint: centred(0.3, 0.3), sample: { args: { arrows: 3 } } },
  (b, p) => {
    const t = tiled(wood(C.WOOD));
    b.box(p.x - 0.07, 0, p.z - 0.07, p.x + 0.07, 2.1, p.z + 0.07, sides(t));
    b.box(p.x - 0.1, 2.1, p.z - 0.1, p.x + 0.1, 2.18, p.z + 0.1, sides(t));
    const arrow = fitted(cutout("signpost-arrow", () => arrowPicture()));
    const n = Math.max(1, Math.min(3, num(p, "arrows", 2)));
    const angles = [0.2, Math.PI - 0.35, -0.9];
    for (let i = 0; i < n; i++) b.at(p.x, 0, p.z, angles[i]!, () => b.box(0.08, 1.85 - i * 0.32, -0.03, 1.5, 2.05 - i * 0.32, 0.03, { south: arrow, north: arrow, top: t, east: t }));
  },
);
prop(
  "waymarker",
  "a waymarker at x, z where the tier changes: a standing stone banded in the tier's color (args.tier 1-4), its number in white pips",
  { category: "sign", biomes: ["any"], footprint: centred(0.8, 0.8), sample: { args: { tier: 3 } } },
  (b, p) => {
    const tier = Math.max(1, Math.min(4, Math.round(num(p, "tier", 1))));
    const r = R.TIER[tier]!;
    lump(b, p.x, p.z, 0, [[0.36, 0], [0.38, 0.6], [0.32, 1.5], [0.16, 1.85]], 6, rock(R.GRANITE, R.LICHEN), p.seed ?? tier, 0.1, { squash: 0.7 });
    const band = material(`tier-band-${tier}`, () => {
      const q = new Pixmap(16, 8);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) q.set(x, y, y === 0 ? r[5]! : y === 7 ? r[1]! : x % 4 === 0 ? r[3]! : r[4]!);
      return q;
    });
    b.cylinder(p.x, p.z, 0.95, 1.2, 0.39, 8, { mat: band }, undefined, 0, 1, 2);
    const pip = glowing(0xfff8e8);
    for (let k = 0; k < tier; k++) b.box(p.x - 0.05, 0.45 + k * 0.12, p.z + 0.25, p.x + 0.05, 0.53 + k * 0.12, p.z + 0.3, sides(fitted(pip)));
  },
);
prop(
  "tier-banner",
  "a banner on a pole by the road at x, z in the tier's color (args.tier 1-4), its number in pips: where a road crosses into a harder tier",
  { category: "sign", biomes: ["road", "any"], footprint: centred(0.3, 0.3), sample: { args: { tier: 2 } } },
  (b, p) => {
    const tier = Math.max(1, Math.min(4, Math.round(num(p, "tier", 1))));
    const t = tiled(wood(C.DARKWOOD));
    b.box(p.x - 0.06, 0, p.z - 0.06, p.x + 0.06, 3.0, p.z + 0.06, sides(t));
    b.box(p.x - 0.45, 2.8, p.z - 0.04, p.x + 0.45, 2.88, p.z + 0.04, sides(t));
    b.cylinder(p.x, p.z, 3.0, 3.15, 0.08, 6, { mat: D.gold() }, { mat: D.gold() });
    const m = cutout(`tier-banner-${tier}`, () => tierBannerPicture(tier));
    b.card(fitted(m), p.x - 0.375, 0.82, p.x + 0.375, 2.8, p.z + 0.06);
  },
);
prop(
  "banner-pole",
  "a region's banner on a tall pole at x, z (its palette's cloth and trim: benalish, keldon, llanowar...)",
  { category: "sign", biomes: ["town", "road", "any"], footprint: centred(0.3, 0.3), sample: { tint: "keldon" } },
  (b, p, pal) => {
    const t = tiled(wood(C.DARKWOOD));
    b.box(p.x - 0.06, 0, p.z - 0.06, p.x + 0.06, 3.4, p.z + 0.06, sides(t));
    b.box(p.x - 0.45, 3.2, p.z - 0.04, p.x + 0.45, 3.28, p.z + 0.04, sides(t));
    b.cylinder(p.x, p.z, 3.4, 3.55, 0.08, 6, { mat: D.gold() }, { mat: D.gold() });
    b.card(fitted(bannerMaterial(pal.cloth!, pal.trim!)), p.x - 0.375, 1.22, p.x + 0.375, 3.2, p.z + 0.06);
  },
  { cloth: C.BLUE, trim: C.GOLD },
);
prop(
  "milestone",
  "a milestone by the road at x, z: a squat rounded stone with a carved mark",
  { category: "sign", biomes: ["road"], footprint: centred(0.5, 0.5) },
  (b, p) => {
    b.roundedBox(p.x - 0.22, 0, p.z - 0.14, p.x + 0.22, 0.6, p.z + 0.14, 0.08, sides(tiled(rock(C.LIMESTONE, R.LICHEN))), { steps: 2 });
    b.card(fitted(cutout("milestone-mark", () => sprite(["x.x.x", "x.x.x", "xxxxx", "..x..", "..x.."], { x: C.LIMESTONE[1]! }), false)), p.x - 0.16, 0.25, p.x + 0.16, 0.56, p.z + 0.145);
  },
);
prop(
  "quest-board",
  "a quest board outside an inn at x, z facing south: notices pinned under a little roof",
  { category: "sign", biomes: ["town"], footprint: centred(1.8, 0.5) },
  (b, p) => {
    const t = tiled(wood(C.WOOD));
    b.at(p.x, 0, p.z, turned(p), () => {
      for (const x of [-0.8, 0.8]) b.box(x - 0.07, 0, -0.07, x + 0.07, 2.2, 0.07, sides(t));
      b.box(-0.8, 0.8, -0.05, 0.8, 1.9, 0.05, { south: fitted(material("notices", () => noticesPicture())), north: t, east: t, west: t, top: t });
      b.gableRoof(-1.0, -0.35, 1.0, 0.35, 2.15, 0.35, stock.roof(), t);
    });
  },
);
prop(
  "waystone",
  "a mage tower's waystone at x, z: a carved obelisk, its runes glowing blue, a crystal at its tip",
  { category: "sign", biomes: ["any"], footprint: centred(1, 1), light: { kind: "point", color: [0.5, 0.7, 1.0], intensity: 1.2, reach: 4, at: [0, 2.6, 0] } },
  (b, p) => {
    const stone = tiled(stock.cryptStone(C.DUNGEON));
    b.box(p.x - 0.55, 0, p.z - 0.55, p.x + 0.55, 0.25, p.z + 0.55, sides(stone));
    lump(b, p.x, p.z, 0.25, [[0.32, 0], [0.3, 1.6], [0.2, 2.1], [0, 2.4]], 4, stock.cryptStone(C.DUNGEON), 1, 0.02, { twist: Math.PI / 4 });
    const runes = fitted(material("runes-blue", () => runesPicture(C.BLUE), { glowing: true, cutout: true }));
    b.card(runes, p.x - 0.13, 0.6, p.x + 0.13, 1.6, p.z + 0.225);
    lump(b, p.x, p.z, 2.5, [[0, 0], [0.14, 0.2], [0, 0.55]], 5, glowing(C.BLUE[5]!), 2, 0);
  },
);

// --- Wells, carts, goods and stalls ------------------------------------------------------------------------------------

prop(
  "well",
  "a well at x, z: a round wall of fieldstone, a little roof on two posts, a windlass and its bucket",
  { category: "goods", biomes: ["town", "farmland", "plains"], footprint: centred(1.6, 1.6) },
  (b, p) => {
    const stone = { mat: material(`fieldstone@${rampKey(C.COBBLE)}`, () => fieldstone(C.COBBLE)) };
    b.cylinder(p.x, p.z, 0, 0.75, 0.75, 10, stone, undefined, 0, 1, 2);
    b.ring(p.x, p.z, 0.75, 0.5, 0.78, 10, stock.flagstone());
    b.cylinder(p.x, p.z, 0.3, 0.7, 0.5, 10, { mat: pondWater() }, fitted(pondWater()));
    const t = tiled(wood(C.WOOD));
    for (const x of [-0.72, 0.72]) b.box(p.x + x - 0.07, 0.6, p.z - 0.07, p.x + x + 0.07, 2.0, p.z + 0.07, sides(t));
    limb(b, [p.x - 0.72, 1.45, p.z], [p.x + 0.72, 1.45, p.z], 0.07, 0.07, wood(C.WOOD), 6);
    b.box(p.x - 0.01, 1.0, p.z - 0.01, p.x + 0.01, 1.45, p.z + 0.01, sides(flat(C.STRAW[1]!)));
    b.cylinder(p.x, p.z, 0.85, 1.05, 0.12, 6, fitted(D.pics.barrelSide(4)));
    b.gableRoof(p.x - 1.0, p.z - 0.6, p.x + 1.0, p.z + 0.6, 1.95, 0.6, stock.roof(), t);
  },
);
const pondWater = () => D.scrolling(material("well-water", () => T.water(13)), [1, 2], [1 / 32, 1 / 32]);

/** A cart's wheel standing at (x, y, z), facing east-west, with its rim. */
function cartWheel(b: MeshBuilder, x: number, y: number, z: number, r: number, side: 1 | -1, ramp: Ramp): void {
  const face = fitted(wheel(ramp));
  disc(b, [x + side * 0.05, y, z], [side, 0, 0], r, face, 10);
  disc(b, [x - side * 0.05, y, z], [-side, 0, 0], r, face, 10);
  limb(b, [x - 0.05, y, z], [x + 0.05, y, z], r, r, flat(C.IRON[2]!), 10);
}

/** A cart's bed: planks on a frame from x0..x1 (along x), its sides `wall` high, at height y. */
function cartBed(b: MeshBuilder, x0: number, x1: number, w: number, y: number, wall: number, ramp: Ramp): void {
  const deck = tiled(planks(ramp, true));
  const side = tiled(wood(ramp));
  b.box(x0, y, -w / 2, x1, y + 0.1, w / 2, sides(side, deck));
  b.box(x0, y + 0.1, -w / 2, x1, y + 0.1 + wall, -w / 2 + 0.06, sides(side));
  b.box(x0, y + 0.1, w / 2 - 0.06, x1, y + 0.1 + wall, w / 2, sides(side));
  b.box(x0, y + 0.1, -w / 2, x0 + 0.06, y + 0.1 + wall, w / 2, sides(side));
  b.box(x1 - 0.06, y + 0.1, -w / 2, x1, y + 0.1 + wall, w / 2, sides(side));
}

prop(
  "cart",
  "a two-wheeled handcart at x, z, its shafts toward its turn (rot); args.load sacks|crates|hay|none (sacks)",
  { category: "goods", biomes: ["town", "farmland", "road"], footprint: { rect: [-1.2, -0.6, 1.2, 0.6], blocks: true }, sample: { args: { load: "hay" } } },
  (b, p) => {
    b.at(p.x, 0, p.z, turned(p), () => {
      cartBed(b, -0.8, 0.6, 1.0, 0.5, 0.3, C.WOOD);
      for (const z of [-0.6, 0.6]) cartWheel(b, -0.1, 0.42, z, 0.42, z > 0 ? 1 : -1, C.WOOD);
      for (const z of [-0.35, 0.35]) limb(b, [0.6, 0.55, z], [1.3, 0.25, z], 0.04, 0.035, wood(C.WOOD), 4);
      load(b, str(p, "load", "sacks"), -0.1, 0.6);
    });
  },
);
prop(
  "wagon",
  "a four-wheeled wagon at x, z, along its turn (rot); args.load sacks|crates|hay|none (crates)",
  { category: "goods", biomes: ["town", "farmland", "road"], footprint: { rect: [-1.7, -0.75, 1.9, 0.75], blocks: true } },
  (b, p) => {
    b.at(p.x, 0, p.z, turned(p), () => {
      cartBed(b, -1.5, 1.2, 1.2, 0.6, 0.35, C.WOOD);
      for (const x of [-1.0, 0.75]) for (const z of [-0.7, 0.7]) cartWheel(b, x, 0.4, z, 0.4, z > 0 ? 1 : -1, C.WOOD);
      limb(b, [1.2, 0.55, 0], [2.1, 0.3, 0], 0.05, 0.04, wood(C.WOOD), 4);
      load(b, str(p, "load", "crates"), -0.15, 0.7);
    });
  },
);

/** What a cart carries, heaped on its bed at (x, y). */
function load(b: MeshBuilder, kind: string, x: number, y: number): void {
  if (kind === "sacks") {
    for (const [dx, dz] of [
      [-0.3, -0.2],
      [0.15, 0.15],
      [-0.1, 0.25],
    ] as const)
      b.blob(x + dx, y + 0.22, dz, 0.26, 0.2, 0.22, D.pics.sack());
  } else if (kind === "crates") {
    D.crate(b, x - 0.35, -0.15, 0.55, "apples", y);
    D.crate(b, x + 0.3, 0.1, 0.55, undefined, y);
    D.crate(b, x + 0.3, 0.05, 0.45, "cabbages", y + 0.55, 0.2);
  } else if (kind === "hay") {
    lump(b, x, 0, y, [[0.6, 0], [0.55, 0.3], [0.3, 0.55], [0, 0.65]], 8, thatchMat(), 3, 0.12, { squash: 0.8 });
  }
}

const thatchMat = () => material("hay", () => haystackPicture(), { smooth: true });

function haystackPicture(): Pixmap {
  const s = R.THATCH;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, hash2(x, y, 3) < 0.3 ? s[5]! : (x + y * 2) % 5 === 0 ? s[2]! : s[4]!);
  return p;
}

prop(
  "hay-bale",
  "a bale of hay at x, z, bound with twine; turned by rot and turn",
  { category: "goods", biomes: ["farmland", "plains", "town"], footprint: centred(1, 0.7) },
  (b, p) =>
    b.at(p.x, 0, p.z, turned(p), () => {
      b.roundedBox(-0.45, 0, -0.3, 0.45, 0.55, 0.3, 0.05, sides(tiled(thatchMat())));
      for (const x of [-0.2, 0.2]) b.box(x - 0.015, -0.001, -0.305, x + 0.015, 0.556, 0.305, sides(flat(C.WOOD[1]!)));
    }),
);
prop("haystack", "a haystack at x, z, its top tied down; scale (1)", { category: "goods", biomes: ["farmland", "plains"], footprint: centred(1.8, 1.8) }, (b, p) => {
  const s = p.scale ?? 1;
  lump(b, p.x, p.z, 0, [[0.85 * s, 0], [0.9 * s, 0.6 * s], [0.7 * s, 1.3 * s], [0.3 * s, 1.75 * s], [0, 1.9 * s]], 10, thatchMat(), p.seed ?? 1, 0.06, { smooth: true });
  b.cylinder(p.x, p.z, 1.85 * s, 2.15 * s, 0.03, 4, { mat: wood(C.DARKWOOD) });
});
prop(
  "woodpile",
  "a stack of split logs at x, z, ends toward the camera, along its turn (rot)",
  { category: "goods", biomes: ["forest", "keld", "town", "farmland"], footprint: { rect: [-0.9, -0.45, 0.9, 0.45], blocks: true } },
  (b, p) =>
    b.at(p.x, 0, p.z, turned(p), () => {
      const bk = bark(C.WOOD);
      const rings = fitted(ringsMaterial());
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 5 - row; i++) {
          const x = -0.68 + i * 0.32 + row * 0.16;
          const y = 0.15 + row * 0.27;
          limb(b, [x, y, -0.4], [x, y, 0.4], 0.14, 0.14, bk, 7);
          disc(b, [x, y, 0.401], [0, 0, 1], 0.14, rings, 7);
        }
      }
    }),
);
prop(
  "trough",
  "a water trough of planks at x, z, along its turn (rot)",
  { category: "goods", biomes: ["farmland", "town", "road"], footprint: { rect: [-0.8, -0.35, 0.8, 0.35], blocks: true } },
  (b, p) =>
    b.at(p.x, 0, p.z, turned(p), () => {
      const side = tiled(wood(C.WOOD));
      b.box(-0.8, 0, -0.32, 0.8, 0.55, -0.25, sides(side));
      b.box(-0.8, 0, 0.25, 0.8, 0.55, 0.32, sides(side));
      b.box(-0.8, 0, -0.25, -0.73, 0.55, 0.25, sides(side));
      b.box(0.73, 0, -0.25, 0.8, 0.55, 0.25, sides(side));
      b.decal(fitted(pondWater()), -0.73, -0.25, 0.73, 0.25, 0.45);
    }),
);
prop(
  "crate-stack",
  "crates stacked two high round x, z, some heaped with goods; seed their make-up",
  { category: "goods", biomes: ["town", "coast", "road"], footprint: centred(1.6, 1.2), sample: { seed: 2 } },
  (b, p) => {
    const goods = ["apples", "fish", "bread", "cabbages", "carrots"] as const;
    const g = goods[(p.seed ?? 0) % goods.length]!;
    D.crate(b, p.x - 0.4, p.z - 0.15, 0.75, undefined, 0, 0.05);
    D.crate(b, p.x + 0.4, p.z - 0.1, 0.7, g, 0, -0.08);
    D.crate(b, p.x - 0.35, p.z - 0.15, 0.6, undefined, 0.75, 0.25);
    D.barrel(b, p.x + 0.35, p.z + 0.45, 0.7);
  },
);
prop(
  "canopy-stall",
  "a market stall under a cloth canopy (its palette's cloth, striped) from x along args.width (3), its counter's line at z; args.goods what is laid out (apples, cabbages, carrots, bread, fish)",
  { category: "street", biomes: ["town"], footprint: { rect: [0, -1.1, 3, 0.4], blocks: true }, sample: { tint: "red-cloth", args: { width: 3, goods: "fish" } } },
  (b, p, pal) => {
    const w = num(p, "width", 3);
    const x0 = p.x;
    const z = p.z;
    const t = tiled(wood(C.WOOD));
    for (const x of [x0 + 0.05, x0 + w - 0.15]) for (const dz of [-1.0, 0.25]) b.box(x, 0, z + dz, x + 0.1, 2.2, z + dz + 0.1, sides(t));
    b.box(x0 + 0.1, 0.75, z - 0.4, x0 + w - 0.1, 0.85, z + 0.3, sides(t, tiled(planks(C.WOOD, true))));
    b.box(x0 + 0.2, 0, z - 0.35, x0 + w - 0.2, 0.75, z + 0.25, sides(fitted(cloth(pal.cloth!))));
    const goods = str<"apples" | "cabbages" | "carrots" | "bread" | "fish">(p, "goods", "apples");
    for (let i = 0; i < Math.floor(w / 0.8); i++) D.crate(b, x0 + 0.5 + i * 0.75, z - 0.05, 0.55, i % 2 ? goods : "bread", 0.85, (i % 2) * 0.1 - 0.05);
    const canopy = cloth(pal.cloth!, "striped", pal.trim);
    b.quad({ mat: canopy }, [
      [x0 - 0.15, 2.2, z + 0.55],
      [x0 + w + 0.15, 2.2, z + 0.55],
      [x0 + w + 0.15, 2.45, z - 1.1],
      [x0 - 0.15, 2.45, z - 1.1],
    ], (c) => c[0], (c) => -c[2]);
  },
  { cloth: C.RED, trim: C.CLOTH_WHITE },
);
prop("anvil", "a smith's anvil on its block at x, z", { category: "street", biomes: ["town", "keld"], footprint: centred(0.8, 0.6) }, (b, p) => {
  b.cylinder(p.x, p.z, 0, 0.5, 0.22, 7, { mat: bark(C.WOOD) }, fitted(ringsMaterial()));
  const ironFace = sides(flat(C.IRON[2]!), flat(C.IRON[4]!));
  b.box(p.x - 0.12, 0.5, p.z - 0.1, p.x + 0.12, 0.62, p.z + 0.1, ironFace);
  b.box(p.x - 0.3, 0.62, p.z - 0.12, p.x + 0.25, 0.78, p.z + 0.12, ironFace);
  b.box(p.x + 0.25, 0.66, p.z - 0.06, p.x + 0.42, 0.76, p.z + 0.06, ironFace);
});

// --- Caravans and camps ------------------------------------------------------------------------------------------------

/** A wagon's canvas cover: hoops along x from x0 to x1, `w` wide, its crown at `top`, drawn as a few flat strips. */
function cover(b: MeshBuilder, x0: number, x1: number, w: number, y: number, top: number, mat: Material): void {
  const steps = 6;
  const pt = (k: number): [number, number] => {
    const a = Math.PI - (k / steps) * Math.PI;
    return [Math.cos(a) * (w / 2), y + Math.sin(a) * (top - y)];
  };
  for (let k = 0; k < steps; k++) {
    const [za, ya] = pt(k);
    const [zb, yb] = pt(k + 1);
    b.polygon(mat, [[x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za]].map((c) => c as V3).reverse() as V3[], [[0, 0], [0, 1], [1, 1], [1, 0]]);
    // The ends, closed.
    b.polygon(mat, [[x1, y, 0], [x1, ya, za], [x1, yb, zb]] as V3[], [[0.5, 0], [0, 1], [1, 1]]);
    b.polygon(mat, [[x0, y, 0], [x0, yb, zb], [x0, ya, za]] as V3[], [[0.5, 0], [1, 1], [0, 1]]);
  }
}

prop(
  "caravan-wagon",
  "a covered wagon at x, z along its turn (rot): canvas over hoops in its palette's cloth",
  { category: "travel", biomes: ["road", "town", "plains", "waste"], footprint: { rect: [-1.7, -0.8, 1.9, 0.8], blocks: true }, sample: { tint: "default" } },
  (b, p, pal) =>
    b.at(p.x, 0, p.z, turned(p), () => {
      cartBed(b, -1.5, 1.2, 1.3, 0.6, 0.35, C.WOOD);
      for (const x of [-1.0, 0.75]) for (const z of [-0.75, 0.75]) cartWheel(b, x, 0.4, z, 0.4, z > 0 ? 1 : -1, C.WOOD);
      limb(b, [1.2, 0.55, 0], [2.1, 0.3, 0], 0.05, 0.04, wood(C.WOOD), 4);
      cover(b, -1.45, 1.1, 1.35, 1.0, 2.2, cloth(pal.cloth!));
    }),
  { cloth: C.CLOTH_WHITE },
);
prop(
  "caravan",
  "a travelling trader's caravan at x, z along its turn (rot): a covered wagon, an awning off its side on poles, goods from other planes under it, a rug",
  { category: "travel", biomes: ["road", "town", "plains", "waste"], footprint: { rect: [-1.7, -0.8, 1.9, 2.6], blocks: true }, sample: { tint: "purple-cloth" } },
  (b, p, pal) =>
    b.at(p.x, 0, p.z, turned(p), () => {
      cartBed(b, -1.5, 1.2, 1.3, 0.6, 0.35, C.WOOD);
      for (const x of [-1.0, 0.75]) for (const z of [-0.75, 0.75]) cartWheel(b, x, 0.4, z, 0.4, z > 0 ? 1 : -1, C.WOOD);
      limb(b, [1.2, 0.55, 0], [2.1, 0.3, 0], 0.05, 0.04, wood(C.WOOD), 4);
      cover(b, -1.45, 1.1, 1.35, 1.0, 2.2, cloth(pal.cloth!));
      const t = tiled(wood(C.DARKWOOD));
      for (const x of [-1.4, 1.1]) b.box(x - 0.05, 0, 2.3, x + 0.05, 1.9, 2.4, sides(t));
      b.quad({ mat: cloth(pal.cloth!, "striped", pal.trim) }, [[-1.55, 1.85, 2.45], [1.25, 1.85, 2.45], [1.25, 2.0, 0.6], [-1.55, 2.0, 0.6]], (c) => c[0], (c) => -c[2]);
      b.decal(fitted(material("caravan-rug", () => rugPicture())), -1.2, 1.0, 0.9, 2.2, 0.004);
      D.crate(b, -0.8, 1.6, 0.5, "fish");
      D.pot(b, 0.1, 1.7, 0, 0.18);
      D.pot(b, 0.45, 1.55, 0, 0.14);
      D.barrel(b, 0.75, 1.95, 0.6);
    }),
  { cloth: C.PURPLE, trim: C.GOLD },
);

function rugPicture(): Pixmap {
  const p = new Pixmap(32, 20);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 32; x++) {
      const edge = x < 2 || x > 29 || y < 2 || y > 17;
      const d = Math.abs(x - 15.5) / 14 + Math.abs(y - 9.5) / 8;
      p.set(x, y, edge ? C.GOLD[3]! : d < 0.5 ? C.TEAL[3]! : (x + y) % 4 === 0 ? C.RED[2]! : C.RED[3]!);
    }
  }
  return p;
}

prop(
  "tent",
  "an A-frame tent of canvas at x, z, its flap open toward its turn (rot; south by default); its palette's cloth",
  { category: "travel", biomes: ["any"], footprint: centred(2, 2.4), sample: { tint: "default" } },
  (b, p, pal) =>
    b.at(p.x, 0, p.z, turned(p), () => {
      const c = cloth(pal.cloth!);
      const w = 0.95;
      const h = 1.5;
      const d = 1.1;
      b.polygon(c, [[-w, 0, d], [-w, 0, -d], [0, h, -d], [0, h, d]] as V3[], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      b.polygon(c, [[w, 0, -d], [w, 0, d], [0, h, d], [0, h, -d]] as V3[], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      b.polygon(c, [[w, 0, -d], [0, h, -d], [-w, 0, -d]] as V3[], [[1, 0], [0.5, 1], [0, 0]]);
      // The front: the flap tied back, the dark inside showing.
      b.polygon(material("tent-inside", () => new Pixmap(4, 4, C.DARKWOOD[1]!)), [[-w * 0.6, 0, d - 0.02], [w * 0.6, 0, d - 0.02], [0, h * 0.85, d - 0.02]] as V3[], [[0, 0], [1, 0], [0.5, 1]]);
      b.polygon(c, [[-w, 0, d], [-w * 0.55, 0, d + 0.05], [0, h, d]] as V3[], [[0, 0], [1, 0], [0.5, 1]]);
      b.polygon(c, [[w * 0.55, 0, d + 0.05], [w, 0, d], [0, h, d]] as V3[], [[0, 0], [1, 0], [0.5, 1]]);
      const t = wood(C.DARKWOOD);
      limb(b, [0, 0, d + 0.1], [0, h + 0.2, d + 0.05], 0.03, 0.03, t, 4);
      limb(b, [0, 0, -d - 0.1], [0, h + 0.2, -d - 0.05], 0.03, 0.03, t, 4);
    }),
  { cloth: [0x5a4a3a, 0x7c6a52, 0xa08c6c, 0xc2ae8a, 0xdccaa6] },
);
prop(
  "pavilion",
  "a round pavilion at x, z: striped walls in its palette's cloth and trim, a conical roof, a pennant on top; args.r its radius (1.5)",
  { category: "travel", biomes: ["town", "plains", "road"], footprint: centred(3.2, 3.2), sample: { tint: "red-cloth" } },
  (b, p, pal) => {
    const r = num(p, "r", 1.5);
    const stripe = cloth(pal.cloth!, "striped", pal.trim);
    b.cylinder(p.x, p.z, 0, 1.6, r, 12, { mat: stripe });
    b.polygon(material("tent-inside", () => new Pixmap(4, 4, C.DARKWOOD[1]!)), [[p.x - 0.45, 0, p.z + r + 0.01], [p.x + 0.45, 0, p.z + r + 0.01], [p.x + 0.45, 1.3, p.z + r + 0.01], [p.x - 0.45, 1.3, p.z + r + 0.01]] as V3[], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    frustum(b, p.x, p.z, 1.6, 3.0, r + 0.15, 0, 12, stripe);
    b.cylinder(p.x, p.z, 3.0, 3.6, 0.03, 4, { mat: wood(C.DARKWOOD) });
    b.card(fitted(bannerMaterial(pal.cloth!, pal.trim!)), p.x + 0.03, 3.25, p.x + 0.4, 3.58, p.z);
  },
  { cloth: C.RED, trim: C.CLOTH_WHITE },
);

// --- Bridges, fords, docks and boats ------------------------------------------------------------------------------------

prop(
  "wooden-bridge",
  "a wooden bridge from x, z to args.to over water, args.w wide (2), its deck at args.y (0.2): planks across, rails along",
  { category: "water", biomes: ["any"], footprint: along(2, false), sample: { args: { to: [5, 0], w: 2 } } },
  (b, p) =>
    alongLine(b, p, (l) => {
      const w = num(p, "w", 2) / 2;
      const y = num(p, "y", 0.2);
      const deck = tiled(planks(R.WEATHERED, false));
      const t = tiled(wood(R.WEATHERED));
      b.box(0, y - 0.12, -w, l, y, w, { top: deck, south: t, north: t, east: t, west: t });
      for (let x = 0.2; x < l; x += Math.max(1, l / Math.round(l / 1.4))) {
        for (const z of [-w + 0.08, w - 0.08]) {
          b.box(x - 0.07, -0.8, z - 0.07, x + 0.07, y + 0.9, z + 0.07, sides(t));
        }
      }
      for (const z of [-w + 0.08, w - 0.08]) b.box(0, y + 0.8, z - 0.05, l, y + 0.9, z + 0.05, sides(t));
    }),
  {},
  needs({ to: "point" }),
);
prop(
  "ford-stones",
  "stepping stones across a ford or stream from x, z to args.to",
  { category: "water", biomes: ["any"], footprint: along(0.8, false), sample: { args: { to: [4, 0] } } },
  (b, p) =>
    alongLine(b, p, (l) => {
      const n = Math.max(2, Math.round(l / 0.7));
      for (let i = 0; i <= n; i++) b.blob((i / n) * l, -0.02, ((i % 2) - 0.5) * 0.18, 0.3, 0.13, 0.26, material("rock", () => T.rock(18), { smooth: true }), [i * 7, i]);
    }),
  {},
  needs({ to: "point" }),
);
prop(
  "dock",
  "a dock of planks over the rectangle from x, z to args.to, its deck at args.y (0.3), posts down into the water, bollards and a coil of rope",
  { category: "water", biomes: ["coast", "swamp", "town"], footprint: over(false), sample: { args: { to: [3, 5], y: 0.3 } } },
  (b, p) => {
    const [x1, z1] = point(p, "to");
    const [xa, xb] = [Math.min(p.x, x1), Math.max(p.x, x1)];
    const [za, zb] = [Math.min(p.z, z1), Math.max(p.z, z1)];
    const y = num(p, "y", 0.3);
    const t = tiled(wood(R.WEATHERED));
    b.box(xa, y - 0.15, za, xb, y, zb, { top: tiled(planks(R.WEATHERED, xb - xa > zb - za)), south: t, north: t, east: t, west: t });
    for (let x = xa + 0.1; x <= xb - 0.1 + 1e-6; x += Math.max(0.5, (xb - xa - 0.2) / Math.max(1, Math.round((xb - xa) / 1.5)))) {
      for (let z = za + 0.1; z <= zb - 0.1 + 1e-6; z += Math.max(0.5, (zb - za - 0.2) / Math.max(1, Math.round((zb - za) / 1.5)))) {
        if (x > xa + 0.2 && x < xb - 0.2 && z > za + 0.2 && z < zb - 0.2) continue;
        b.cylinder(x, z, -1.0, y + 0.35, 0.1, 6, { mat: bark(R.WEATHERED) }, fitted(ringsMaterial(R.WEATHERED)));
      }
    }
    b.cylinder(xb - 0.3, zb - 0.3, y, y + 0.25, 0.15, 8, { mat: flat(C.IRON[2]!) }, { mat: flat(C.IRON[3]!) });
    b.cylinder(xa + 0.45, zb - 0.45, y, y + 0.14, 0.22, 10, { mat: material("rope", () => ropePicture()) }, fitted(material("rope-top", () => ropeTop())));
  },
  {},
  needs({ to: "point" }),
);

function ropePicture(): Pixmap {
  const p = new Pixmap(16, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x + y) % 3 === 0 ? C.STRAW[1]! : C.STRAW[3]!);
  return p;
}

function ropeTop(): Pixmap {
  const p = new Pixmap(8, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) p.set(x, y, Math.floor(Math.hypot(x - 3.5, y - 3.5)) % 2 ? C.STRAW[2]! : C.STRAW[4]!);
  return p;
}

/** A boat's hull along z: an elliptical gunwale (rx, rz) at `top`, a narrower keel line below, planked, its floor inside. */
function hull(b: MeshBuilder, rx: number, rz: number, top: number, ramp: Ramp): void {
  const side = material(`hull@${rampKey(ramp)}`, () => {
    const q = new Pixmap(32, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) q.set(x, y, y % 4 === 0 ? ramp[1]! : y % 4 === 1 ? ramp[4]! : ramp[3]!);
    for (let x = 0; x < 32; x++) q.set(x, 0, C.RED[2]!);
    return q;
  }, { smooth: true });
  const n = 12;
  const ring = (r: number, k: number, y: number, i: number): V3 => {
    const a = (i / n) * Math.PI * 2;
    return [Math.sin(a) * rx * r, y, Math.cos(a) * rz * k];
  };
  for (let i = 0; i < n; i++) {
    const a = ring(1, 1, top, i);
    const bb = ring(1, 1, top, i + 1);
    const c = ring(0.5, 0.82, 0, i + 1);
    const d = ring(0.5, 0.82, 0, i);
    b.polygon(side, [d, c, bb, a], [[i / n * 4, 0], [(i + 1) / n * 4, 0], [(i + 1) / n * 4, 1], [i / n * 4, 1]]);
  }
  const floor: V3[] = [];
  for (let i = n - 1; i >= 0; i--) floor.push(ring(0.85, 0.92, top * 0.45, i));
  b.polygon(planks(ramp, true), floor.reverse(), floor.map((c) => [c[0] / 2, c[2] / 2] as [number, number]));
  // The inner face of the sides, darker, so it reads as a hollow seen from above.
  const inner = material(`hull-in@${rampKey(ramp)}`, () => new Pixmap(4, 4, ramp[2]!));
  for (let i = 0; i < n; i++) {
    const a = ring(0.96, 0.98, top, i);
    const bb = ring(0.96, 0.98, top, i + 1);
    const c = ring(0.85, 0.92, top * 0.45, i + 1);
    const d = ring(0.85, 0.92, top * 0.45, i);
    b.polygon(inner, [a, bb, c, d], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }
}

prop(
  "rowboat",
  "a rowboat afloat at x, z (y its waterline, -0.1 on a hole's water), along its turn (rot: 0 bow south), oars shipped",
  { category: "water", biomes: ["coast", "swamp", "town"], footprint: centred(1, 2.6, true), sample: { y: 0 } },
  (b, p) =>
    b.at(p.x, p.y ?? -0.1, p.z, turned(p), () => {
      hull(b, 0.5, 1.25, 0.42, C.WOOD);
      for (const z of [-0.35, 0.35]) b.box(-0.42, 0.3, z - 0.1, 0.42, 0.36, z + 0.1, sides(tiled(wood(C.WOOD))));
      for (const s of [-1, 1]) limb(b, [s * 0.25, 0.38, -0.7], [s * 0.3, 0.4, 0.8], 0.025, 0.025, wood(C.WOOD), 4);
    }),
);
prop(
  "ferry",
  "a ferry raft at x, z (y its deck, 0.2 by default) along its turn (rot): a flat deck with rails and its rope post; 2.5 by 4",
  { category: "water", biomes: ["coast", "swamp", "town"], footprint: centred(2.5, 4, true) },
  (b, p) =>
    b.at(p.x, 0, p.z, turned(p), () => {
      const y = p.y ?? 0.2;
      const t = tiled(wood(R.WEATHERED));
      b.box(-1.25, y - 0.3, -2, 1.25, y, 2, { top: tiled(planks(R.WEATHERED, true)), south: t, north: t, east: t, west: t });
      for (const s of [-1.15, 1.15]) {
        b.box(s - 0.05, y + 0.7, -1.9, s + 0.05, y + 0.78, 1.9, sides(t));
        for (let z = -1.85; z <= 1.86; z += 0.925) b.box(s - 0.05, y, z - 0.05, s + 0.05, y + 0.78, z + 0.05, sides(t));
      }
      b.cylinder(0.9, -1.6, y, y + 1.2, 0.08, 6, { mat: wood(C.DARKWOOD) });
      b.cylinder(0.9, -1.6, y + 0.9, y + 1.0, 0.11, 6, { mat: material("rope", () => ropePicture()) });
    }),
);
prop(
  "sailboat",
  "a moored sailboat at x, z (y its waterline) along its turn (rot): a hull, a mast and a furled-or-set sail (args.sail set|furled) in its palette's cloth",
  { category: "water", biomes: ["coast", "town"], footprint: centred(1.6, 4.6, true), sample: { args: { sail: "set" }, y: 0 } },
  (b, p, pal) =>
    b.at(p.x, p.y ?? -0.1, p.z, turned(p), () => {
      hull(b, 0.8, 2.2, 0.6, C.WOOD);
      b.box(-0.6, 0.45, -0.5, 0.6, 0.55, 0.5, sides(tiled(planks(C.WOOD, true))));
      b.cylinder(0, -0.3, 0.3, 4.2, 0.07, 6, { mat: wood(C.WOOD) });
      limb(b, [0, 1.0, -0.3], [0, 1.0, 1.7], 0.05, 0.05, wood(C.WOOD), 5);
      const c = cloth(pal.cloth!);
      if (str<string>(p, "sail", "set") === "set") {
        b.polygon(c, [[0, 1.05, -0.2], [0.02, 1.05, 1.6], [0, 4.0, -0.25]] as V3[], [[0, 0], [1, 0], [0, 1]]);
        b.polygon(c, [[0, 1.05, 1.6], [0, 1.05, -0.2], [0, 4.0, -0.25]] as V3[], [[1, 0], [0, 0], [0, 1]]);
      } else {
        limb(b, [0, 1.1, -0.2], [0, 1.1, 1.6], 0.12, 0.08, c, 6);
      }
    }),
  { cloth: C.CLOTH_WHITE },
);

// --- The slice's own outdoor props, catalogued ---------------------------------------------------------------------------

describe("barrel", { category: "goods", biomes: ["town", "road", "coast"], footprint: centred(0.6, 0.6) });
describe("crate", { category: "goods", biomes: ["town", "road", "coast"], footprint: centred(0.75, 0.75), sample: { args: { goods: "apples" } } });
describe("sack", { category: "goods", biomes: ["town", "farmland"], footprint: centred(0.6, 0.5, false) });
describe("pot", { category: "goods", biomes: ["town"], footprint: centred(0.4, 0.4, false) });
describe("lamp-post", { category: "light", biomes: ["town", "road"], footprint: centred(0.4, 0.4), light: { kind: "point", color: [1.0, 0.8, 0.45], intensity: 1.4, reach: 5, at: [0, 2.4, 0] } });
describe("bench", { category: "street", biomes: ["town"], footprint: centred(1.6, 0.5) });
describe("market-stall", { category: "street", biomes: ["town"], footprint: { rect: [0, -1, 3.4, 0.35], blocks: true }, sample: { args: { width: 3.4 } } });
describe("fountain", { category: "street", biomes: ["town"], footprint: centred(4, 4) });
describe("gravestone", { category: "ruin", biomes: ["town", "swamp", "morass"], footprint: centred(0.8, 0.4) });
describe("railings", { category: "fence", biomes: ["town"], footprint: along(0.2), sample: { args: { to: [4, 0] } } });
describe("hedge-wall", { category: "fence", biomes: ["town", "plains"], footprint: along(0.7), sample: { args: { to: [4, 0] } } });
describe("tree", { category: "tree", biomes: ["plains", "town", "forest"], footprint: centred(0.6, 0.6), sample: { seed: 1 } });
describe("bush", { category: "plant", biomes: ["plains", "town", "forest"], footprint: centred(0.8, 0.8), sample: { args: { flowering: true } } });
describe("hedgerow", { category: "fence", biomes: ["farmland", "plains"], footprint: along(0.9), sample: { args: { to: [5, 0] } } });
describe("boulder", { category: "rock", biomes: ["plains", "forest", "mountain"], footprint: centred(1, 1), sample: { seed: 1 } });
describe("stepping-stone", { category: "water", biomes: ["any"], footprint: centred(0.6, 0.6, false) });
describe("town-wall", { category: "fence", biomes: ["town"], footprint: { line: 1.5, blocks: true }, sample: { args: { to: [0, 10], gate: [4, 6] } } });
describe("bridge", { category: "water", biomes: ["any"], footprint: { area: true, blocks: false }, sample: { args: { to: [4, 2], y: 0.25 } } });
describe("terrace", { category: "mountain", biomes: ["plains", "town"], footprint: { area: true, blocks: false }, sample: { args: { to: [4, 3], y: 0.75 } } });
describe("ruined-tower", { category: "ruin", biomes: ["plains", "waste"], footprint: centred(5, 5), sample: { args: { r: 2.2, low: 1.4, high: 4.5 } } });

