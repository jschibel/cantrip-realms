import type { PropData, XYZ } from "../../world/format";
import { MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material, stock } from "../paint/materials";
import { type Ramp, rampKey } from "../paint/palette";
import { Pixmap, hash2, seeded } from "../paint/pixmap";
import { fbm } from "../paint/procedural";
import * as R from "../paint/ramps";
import * as T from "../paint/textures";
import { centred, prop } from "./catalogue";
import * as D from "./draw";
import { bark, flames, foliage, frustum, glowing, limb, lump, rock } from "./kit";
import { bool } from "./registry";

// The wilds' darker things: Phyrexian wreckage strewn over the desolate waste (broken hulls, hooked spikes, ribcages of
// metal, oil vents) and the dungeons' ways in, one for each theme (design.md A6): a cave mouth in a rocky mound, a
// castle's postern, a mage tower's door, a crypt's sunken stair, a root hollow under a giant's roots, a foundry's door in
// the rock, and the Phyrexian Portal's sealed arch. An entrance's `doorway` is the point its iris closes on; its door
// faces south (turned by rot); the tile before it is where the player stands to go in.

type V3 = [number, number, number];
const turned = (p: PropData) => ((p.rot ?? 0) * Math.PI) / 2 + (p.turn ?? 0);

/** Phyrexian metal from a ramp: ribbed plates, a seam, rivets and oil weeping. */
const metal = (r: Ramp) =>
  material(`phyrexian-metal@${rampKey(r)}`, () => {
    const p = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let c = x % 8 === 0 ? r[1]! : x % 8 === 1 ? r[5]! : y % 6 === 0 ? r[2]! : r[3]!;
        if (x % 8 === 4 && y % 6 === 3) c = r[6]!;
        if (x % 8 === 2 && y > 9 && hash2(x, y, 4) < 0.6) c = R.OIL[2]!;
        p.set(x, y, c);
      }
    }
    return p;
  }, { smooth: true });
const sinew = () => material("sinew", () => {
  const p = new Pixmap(8, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) p.set(x, y, (x + y) % 4 === 0 ? R.SINEW[2]! : x % 3 === 0 ? R.SINEW[5]! : R.SINEW[3]!);
  return p;
}, { smooth: true });
const oilPool = () => D.scrolling(material("oil-slick", () => oilSlick(), { cutout: true }), [1, 1], [1 / 32, 0]);

function oilSlick(): Pixmap {
  const p = new Pixmap(32, 32);
  p.fill(0, 0);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5) / 16 + (fbm(x, y, 8, 32, 5) - 0.5) * 0.5;
      if (d > 0.9) continue;
      p.set(x, y, fbm(x + y, y, 8, 32, 9) > 0.66 ? R.OIL[5]! : d > 0.8 ? R.OIL[3]! : R.OIL[1]!);
    }
  }
  return p;
}

// --- Phyrexian wreckage --------------------------------------------------------------------------------------------------

prop(
  "phyrexian-wreck",
  "the broken hull of a Phyrexian war-engine at x, z: curved ribs, torn plates, sinew cables, a pool of oil; seed its make-up",
  { category: "phyrexian", biomes: ["phyrexian", "waste"], footprint: centred(3, 2.4), sample: { seed: 2 } },
  (b, p, pal) => {
    const m = metal(pal.metal!);
    const random = seeded((p.seed ?? 0) + 5);
    b.decal(fitted(oilPool()), p.x - 1.6, p.z - 1.1, p.x + 1.6, p.z + 1.3, 0.006);
    b.at(p.x, 0, p.z, turned(p), () => {
      // The keel: a spine along x, broken at one end, ribs arching up from it.
      limb(b, [-1.4, 0.15, 0], [1.2, 0.35, 0.1], 0.18, 0.12, m, 6);
      for (let i = 0; i < 5; i++) {
        const x = -1.1 + i * 0.5;
        const h = 1.2 + random() * 0.8 - (i === 4 ? 0.7 : 0);
        for (const s of [-1, 1]) {
          const mid: V3 = [x + 0.05, h * 0.7, s * 0.75];
          limb(b, [x, 0.2, s * 0.1], mid, 0.08, 0.06, m, 5);
          limb(b, mid, [x + 0.1, h, s * (0.4 - random() * 0.3)], 0.06, 0.02, m, 4);
        }
      }
      // Torn plates lying against the ribs.
      for (let k = 0; k < 3; k++) {
        b.at(-0.8 + k * 0.7, 0.3 + random() * 0.3, 0.7, random() - 0.5, () => b.box(-0.3, 0, -0.04, 0.3, 0.7, 0.04, sides(tiled(m))));
      }
      // Sinew cables hanging loose.
      limb(b, [-0.6, 1.4, 0.4], [0.2, 0.3, 0.9], 0.05, 0.04, sinew(), 5);
      limb(b, [0.4, 1.2, -0.5], [1.1, 0.05, -0.9], 0.05, 0.04, sinew(), 5);
    });
  },
  { metal: R.PHYREXIAN },
);
prop(
  "phyrexian-spike",
  "a hooked Phyrexian spike thrust up from the ground at x, z, args.h high (3.2), oil weeping down it",
  { category: "phyrexian", biomes: ["phyrexian", "waste"], footprint: centred(1, 1), sample: { seed: 1 } },
  (b, p, pal) => {
    const h = typeof p.args?.h === "number" ? (p.args.h as number) : 3.2;
    const m = metal(pal.metal!);
    lump(b, p.x, p.z, 0, [[0.4, 0], [0.32, h * 0.25], [0.2, h * 0.6], [0.09, h * 0.85]], 6, m, p.seed ?? 0, 0.1);
    const a = p.seed ?? 0;
    limb(b, [p.x, h * 0.85, p.z], [p.x + Math.sin(a) * 0.5, h, p.z + Math.cos(a) * 0.3], 0.09, 0.01, m, 5);
    limb(b, [p.x, h * 0.45, p.z], [p.x - Math.sin(a) * 0.5, h * 0.6, p.z - Math.cos(a) * 0.2], 0.07, 0.01, m, 4);
    b.decal(fitted(oilPool()), p.x - 0.6, p.z - 0.5, p.x + 0.6, p.z + 0.6, 0.006);
  },
  { metal: R.PHYREXIAN },
);
prop(
  "phyrexian-ribs",
  "a ribcage of black metal arching over the ground at x, z, along its turn (rot): a spine and five ribs, some broken",
  { category: "phyrexian", biomes: ["phyrexian", "waste"], footprint: { rect: [-2, -1.2, 2, 1.2], blocks: true } },
  (b, p, pal) => {
    const m = metal(pal.metal!);
    b.at(p.x, 0, p.z, turned(p), () => {
      limb(b, [-2, 0.1, 0], [2, 0.2, 0], 0.16, 0.12, m, 6);
      for (let i = 0; i < 5; i++) {
        const x = -1.6 + i * 0.8;
        const broken = i === 1 || i === 4;
        for (const s of [-1, 1]) {
          const steps = broken && s > 0 ? 2 : 4;
          let prev: V3 = [x, 0.15, 0];
          for (let k = 1; k <= steps; k++) {
            const a = (k / 4) * Math.PI * 0.9;
            const next: V3 = [x + k * 0.05, Math.sin(a) * 2.0 + 0.15, s * (1 - Math.cos(a)) * 0.6];
            limb(b, prev, next, 0.09 - k * 0.012, 0.08 - k * 0.012, m, 5);
            prev = next;
          }
        }
      }
    });
  },
  { metal: R.PHYREXIAN },
);
prop(
  "oil-vent",
  "a Phyrexian vent at x, z: a ribbed cone of metal, glistening oil welling from its mouth and spattered round it",
  { category: "phyrexian", biomes: ["phyrexian", "waste"], footprint: centred(1.4, 1.4) },
  (b, p, pal) => {
    const m = metal(pal.metal!);
    b.decal(fitted(oilPool()), p.x - 1.0, p.z - 0.9, p.x + 1.0, p.z + 1.0, 0.006);
    frustum(b, p.x, p.z, 0, 0.9, 0.6, 0.25, 8, m);
    b.cylinder(p.x, p.z, 0.82, 0.92, 0.24, 8, { mat: m }, { mat: glowing(0x3e8a7a) });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      limb(b, [p.x + Math.sin(a) * 0.2, 0.85, p.z + Math.cos(a) * 0.2], [p.x + Math.sin(a) * 0.45, 0.02, p.z + Math.cos(a) * 0.45], 0.04, 0.06, material("oil-drip", () => new Pixmap(4, 4, R.OIL[2]!), { smooth: true }), 4);
    }
  },
  { metal: R.PHYREXIAN },
);

// --- Dungeon entrances ---------------------------------------------------------------------------------------------------

/** A dark opening, `w` by `h` texels, cut out: black at its back, its rim catching the light, arched on top. */
function mouthPicture(w: number, h: number, rim: Ramp): Pixmap {
  const p = new Pixmap(w, h);
  p.fill(0, 0);
  const r = w / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - r) / r;
      const dy = (y + 0.5 - r) / r;
      const inside = y >= r || dx * dx + dy * dy <= 1;
      if (!inside) continue;
      const d = y >= r ? Math.abs(dx) : Math.hypot(dx, dy);
      let c = d > 0.86 ? rim[2]! : d > 0.7 ? rim[1]! : C.INK;
      if (y > h - 3 && d <= 0.7) c = C.DUNGEON[1]!;
      p.set(x, y, c);
    }
  }
  return p;
}

const mouth = (w: number, h: number, rim: Ramp) => material(`mouth-${w}x${h}@${rampKey(rim)}`, () => mouthPicture(w, h, rim), { cutout: true });

/** An entrance's frame: drawn turned to its rot about its anchor (its door's foot), returning the doorway. */
function entrance(b: MeshBuilder, p: PropData, draw: () => number): { doorway: XYZ } {
  let y = 1;
  b.at(p.x, 0, p.z, turned(p), () => {
    y = draw();
  });
  const t = turned(p);
  return { doorway: [p.x + Math.sin(t) * 0.05, y, p.z + Math.cos(t) * 0.05] };
}

prop(
  "entrance-caves",
  "a cave's mouth (caves theme) in a mound of rock, its door at x, z facing south (turned by rot); 5 by 4 behind it",
  { category: "entrance", biomes: ["mountain", "keld", "tundra"], footprint: { rect: [-2.5, -4, 2.5, 0], blocks: true } },
  (b, p, pal) =>
    entrance(b, p, () => {
      const r = rock(pal.stone!, R.LICHEN);
      lump(b, 0, -2, 0, [[2.6, 0], [2.4, 1.3], [1.8, 2.5], [0.9, 3.2], [0, 3.4]], 9, r, p.seed ?? 4, 0.18, { squash: 0.9 });
      lump(b, 1.8, -0.9, 0, [[0.8, 0], [0.6, 0.8], [0, 1.2]], 6, r, 7, 0.25);
      lump(b, -1.9, -0.8, 0, [[0.7, 0], [0.5, 0.6], [0, 1.0]], 6, r, 8, 0.25);
      b.card(fitted(mouth(28, 34, pal.stone!)), -0.875, 0, 0.875, 2.125, 0.12);
      return 1;
    }),
  { stone: R.GRANITE },
);
prop(
  "entrance-castle",
  "a castle's postern (castle theme): a gate in a stretch of curtain wall between two towers, its portcullis down, at x, z facing south; 7 by 3 behind it",
  { category: "entrance", biomes: ["plains", "farmland"], footprint: { rect: [-3.5, -3, 3.5, 0], blocks: true } },
  (b, p, pal) =>
    entrance(b, p, () => {
      const lime = tiled(stock.limestone(pal.stone));
      const flag = tiled(stock.flagstone(pal.stone));
      b.box(-1.5, 0, -2.2, 1.5, 3.4, -0.2, sides(lime, flag));
      for (const x of [-2.6, 2.6]) {
        b.box(x - 0.9, 0, -2.8, x + 0.9, 4.8, -0.0, sides(lime, flag));
        for (let mx = x - 0.9; mx < x + 0.85; mx += 0.5) b.box(mx, 4.8, -0.25, mx + 0.25, 5.15, 0, sides(lime));
        D.bannerAt(b, x, 3.6, 0);
      }
      for (let mx = -1.5; mx < 1.45; mx += 0.5) b.box(mx, 3.4, -0.45, mx + 0.25, 3.72, -0.2, sides(lime));
      b.card(fitted(mouth(24, 36, pal.stone!)), -0.75, 0, 0.75, 2.25, -0.18);
      for (let x = -0.62; x <= 0.63; x += 0.2) b.box(x - 0.025, 0, -0.16, x + 0.025, 2.0, -0.12, sides(D.iron()));
      for (const y of [0.6, 1.3]) b.box(-0.7, y, -0.16, 0.7, y + 0.05, -0.12, sides(D.iron()));
      return 1;
    }),
  { stone: C.LIMESTONE },
);
prop(
  "entrance-tower",
  "a mage tower standing alone (tower theme): round, ruined at its crown, its door at x, z facing south; 4 by 4 behind it",
  { category: "entrance", biomes: ["coast", "plains", "mountain", "any"], footprint: { rect: [-2, -4, 2, 0], blocks: true } },
  (b, p, pal) =>
    entrance(b, p, () => {
      const r = 1.8;
      const stone = stock.limestone(pal.stone);
      b.cylinder(0, -r, 0, 7.0, r, 12, { mat: stone }, undefined, 0, 1, 2);
      // A crown of broken merlons, and a dome of glass glowing within (the mage at home).
      for (let i = 0; i < 12; i += 1) {
        if (i % 3 === 2) continue;
        const a = (i / 12) * Math.PI * 2;
        b.at(Math.sin(a) * (r - 0.15), 7.0, -r + Math.cos(a) * (r - 0.15), a, () => b.box(-0.22, 0, -0.15, 0.22, 0.35 + (i % 4) * 0.12, 0.15, sides(tiled(stone))));
      }
      lump(b, 0, -r, 6.8, [[1.4, 0], [1.1, 0.6], [0.6, 1.0], [0, 1.15]], 10, glowing(C.BLUE[4]!), 1, 0);
      const glass = material("tower-window-lit", () => T.water(13), { glow: 0.6 });
      for (const [a, y] of [
        [-0.5, 3.2],
        [0.4, 5.0],
      ] as const)
        b.at(0, 0, -r, a, () => b.card(fitted(glass, [0, 0, 8, 14]), -0.25, y, 0.25, y + 0.9, r + 0.01));
      b.card(fitted(mouth(20, 34, pal.stone!)), -0.625, 0, 0.625, 2.125, 0.01);
      return 1;
    }),
  { stone: C.LIMESTONE },
);
prop(
  "entrance-crypt",
  "a crypt's way down (crypt theme): a sunken stair under a stone pediment and an iron gate, at x, z facing south; 3 by 3 behind it",
  { category: "entrance", biomes: ["swamp", "morass", "town", "waste"], footprint: { rect: [-1.5, -3, 1.5, 0], blocks: true } },
  (b, p, pal) =>
    entrance(b, p, () => {
      const stone = tiled(stock.cryptBrick(pal.stone));
      const flag = tiled(stock.cryptStone(pal.stone));
      for (const x of [-1.3, 1.3]) b.box(x - 0.3, 0, -2.6, x + 0.3, 2.2, 0, sides(stone, flag));
      b.box(-1.6, 2.2, -2.7, 1.6, 2.6, 0.1, sides(stone, flag));
      b.gableRoof(-1.7, -2.8, 1.7, 0.2, 2.6, 0.8, stock.slate(), stone);
      // The stair going down into the dark: treads stepping down and back.
      for (let k = 0; k < 5; k++) b.box(-1.0, -0.02 - k * 0.001, -0.4 - k * 0.42, 1.0, 0.0, -0.4 - (k + 1) * 0.42, sides(flag));
      b.decal(fitted(mouth(32, 40, C.DUNGEON)), -1.0, -2.4, 1.0, -0.4, 0.004);
      b.card(fitted(D.pics.cryptGate()), -0.9, 0, 0.9, 2.2, 0.02);
      b.card(fitted(material("skull-relief", () => skullPicture(), { cutout: true })), -0.16, 2.25, 0.16, 2.55, 0.12);
      return 1;
    }),
  { stone: C.DUNGEON },
);
prop(
  "entrance-hollow",
  "a root hollow (hollow theme): a giant's roots arching over a dark way down, moss and ferns about it, at x, z facing south; 5 by 4 behind it",
  { category: "entrance", biomes: ["llanowar", "forest", "verdura"], footprint: { rect: [-2.5, -4, 2.5, 0], blocks: true } },
  (b, p, pal) =>
    entrance(b, p, () => {
      const bk = bark(pal.bark!, "smooth");
      // The stump of a great trunk behind, mossed over, and its roots thrust out and down round the hole.
      lump(b, 0, -2.0, 0, [[2.1, 0], [1.8, 1.0], [1.6, 2.0], [1.5, 2.4]], 10, bk, 3, 0.08);
      b.blob(0, 2.45, -2.0, 1.55, 0.28, 1.45, foliage(R.MOSS), [3, 3]);
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI;
        if (i === 2 || i === 3) continue;
        limb(b, [Math.sin(a) * 1.2, 1.4, -2.0 + Math.cos(a) * 1.0], [Math.sin(a) * 2.5, 0, -2.0 + Math.cos(a) * 2.2], 0.42, 0.18, bk, 7);
      }
      limb(b, [-1.3, 1.5, -0.7], [-0.2, 2.4, -0.3], 0.34, 0.3, bk, 7);
      limb(b, [-0.2, 2.4, -0.3], [1.3, 1.4, -0.6], 0.3, 0.34, bk, 7);
      b.card(fitted(mouth(28, 34, R.LOAM)), -0.875, 0, 0.875, 2.125, -0.3);
      return 1;
    }),
  { bark: R.ELFWOOD },
);
prop(
  "entrance-foundry",
  "a foundry's door (foundry theme): an iron door in a rock face, its seams glowing, chimneys of stone smoking above, at x, z facing south; 5 by 3 behind it",
  { category: "entrance", biomes: ["mountain", "keld", "volcanic"], footprint: { rect: [-2.5, -3, 2.5, 0], blocks: true } },
  (b, p, pal) => {
    const out = entrance(b, p, () => {
      const r = rock(pal.stone!, null);
      lump(b, 0, -1.6, 0, [[2.6, 0], [2.3, 1.6], [1.6, 3.0], [0.6, 3.6]], 8, r, 5, 0.2, { squash: 0.7 });
      const brick = tiled(stock.cryptBrick(R.BASALT));
      b.box(-1.0, 0, -0.6, 1.0, 2.6, 0.05, sides(brick));
      b.card(fitted(material("foundry-door", () => foundryDoor(), {})), -0.75, 0, 0.75, 2.1, 0.06);
      for (const [x, h] of [
        [-1.3, 4.8],
        [1.2, 5.4],
      ] as const)
        b.cylinder(x, -1.4, 2.0, h, 0.3, 8, { mat: stock.cryptBrick(R.BASALT) }, { mat: glowing(C.FIRE[1]!) });
      return 1;
    });
    return { ...out, frames: [flames(p.x - 1.3, 4.75, p.z - 1.39, 10)] };
  },
  { stone: R.BASALT },
);
prop(
  "entrance-portal",
  "the Phyrexian Portal's sealed arch (portal theme): ribbed black metal round a membrane of oil, glowing when args.open, at x, z facing south; 5 by 2 behind it",
  { category: "entrance", biomes: ["phyrexian", "waste"], footprint: { rect: [-2.5, -2, 2.5, 0], blocks: true }, sample: { args: { open: true } } },
  (b, p, pal) =>
    entrance(b, p, () => {
      const m = metal(pal.metal!);
      // Two hooked pillars, ribs arching between them over the membrane.
      for (const s of [-1, 1]) {
        lump(b, s * 1.7, -0.8, 0, [[0.6, 0], [0.5, 1.5], [0.35, 3.0], [0.15, 4.0]], 6, m, s > 0 ? 3 : 4, 0.1);
        limb(b, [s * 1.7, 3.8, -0.8], [s * 1.2, 4.9, -0.6], 0.15, 0.02, m, 5);
      }
      const steps = 9;
      for (let k = 0; k < steps; k++) {
        const a0 = Math.PI - (k / steps) * Math.PI;
        const a1 = Math.PI - ((k + 1) / steps) * Math.PI;
        limb(b, [Math.cos(a0) * 1.5, 1.6 + Math.sin(a0) * 2.2, -0.6], [Math.cos(a1) * 1.5, 1.6 + Math.sin(a1) * 2.2, -0.6], 0.18, 0.18, m, 6);
      }
      const open = bool(p, "open");
      const membrane = open ? material("portal-open", () => membranePicture(true), { glowing: true, cutout: true }) : material("portal-sealed", () => membranePicture(false), { cutout: true });
      b.card(fitted(membrane), -1.4, 0, 1.4, 3.75, -0.62);
      b.decal(fitted(oilPool()), -1.8, -1.4, 1.8, 0.8, 0.006);
      return 1.5;
    }),
  { metal: R.PHYREXIAN },
);

function membranePicture(open: boolean): Pixmap {
  const p = new Pixmap(44, 60);
  p.fill(0, 0);
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 44; x++) {
      const dx = (x + 0.5 - 22) / 22;
      const dy = (y + 0.5 - 22) / 22;
      if (y < 22 && dx * dx + dy * dy > 1) continue;
      const swirl = fbm(x + Math.sin(y / 4) * 3, y * 1.5, 8, 64, open ? 3 : 7);
      const rim = y >= 22 ? Math.abs(dx) : Math.hypot(dx, dy);
      let c = swirl > 0.66 ? R.OIL[5]! : swirl > 0.5 ? R.OIL[3]! : swirl > 0.35 ? R.OIL[2]! : R.OIL[1]!;
      if (open && swirl > 0.72) c = 0x7ad8b0;
      if (open && rim > 0.85) c = 0x3e8a7a;
      p.set(x, y, c);
    }
  }
  return p;
}

function foundryDoor(): Pixmap {
  const p = new Pixmap(24, 34);
  for (let y = 0; y < 34; y++) {
    for (let x = 0; x < 24; x++) {
      let c = x % 6 === 0 ? C.IRON[1]! : y % 8 === 0 ? C.IRON[1]! : C.IRON[2]!;
      if (x % 6 === 1 || y % 8 === 1) c = C.IRON[3]!;
      if ((x === 11 || x === 12) && y > 2) c = C.FIRE[2]!;
      if ((x % 6 === 3 && y % 8 === 4) || (x === 0 && y > 30)) c = C.IRON[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

function skullPicture(): Pixmap {
  const rows = [".bbb.", "bwbwb", "bbbbb", ".b.b."];
  const p = new Pixmap(5, 4);
  p.fill(0, 0);
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && p.set(x, y, ch === "w" ? C.INK : C.BONE[4]!)));
  return p;
}

export const ENTRANCE_THEMES = ["caves", "castle", "tower", "crypt", "hollow", "foundry", "portal"] as const;
