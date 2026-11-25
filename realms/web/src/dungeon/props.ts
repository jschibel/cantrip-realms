// The dungeons' own props (art/props), each prefixed `dungeon-`: the stairs and the way out, and what dresses each
// theme - stalagmites and crystals, glowing mushrooms and hanging roots, a keep's well, banners, statues and parapets,
// a foundry's forges, anvils and crucibles, a time-rift, the Phyrexian pylons, altars and vats, and the shrine a run
// now and then holds, with its heart. Things against a wall take its face's z and turn with `rot` (1 west, 2 north, 3
// east); the rest stand by their middle at x, z.

import { MeshBuilder, fitted, sides, tiled } from "../art/paint/builder";
import * as C from "../art/paint/colors";
import { flat, material, stock } from "../art/paint/materials";
import type { Ramp } from "../art/paint/palette";
import * as Pic from "../art/paint/pictures";
import { Pixmap, hash2 } from "../art/paint/pixmap";
import * as T from "../art/paint/textures";
import { bool, drawn, num, point, str } from "../art/props/registry";
import type { Frames } from "../art/recipe";
import type { PropData } from "../world/format";
import * as P from "./paint";

const PX = 1 / 16;

/** The turn of a wall or piece: `rot` quarter turns as a building's, and `turn`. */
const turnOf = (p: PropData): number => (-(p.rot ?? 0) * Math.PI) / 2 - (p.turn ?? 0);

function at(b: MeshBuilder, p: PropData, draw: () => void): void {
  b.at(p.x, p.y ?? 0, p.z, turnOf(p), draw);
}

/** Three frames of a flame `n` texels high (the slice's flames: the same materials). */
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

const glowFlat = (name: string, color: number) => material(name, () => new Pixmap(2, 2, color), { glowing: true });
const RAMPS: Record<string, Ramp> = { blue: P.CRYSTAL, violet: [0x1e1030, 0x34184e, 0x502872, 0x6e3c98, 0x9058c0, 0xb888e0, 0xe8d0ff], green: P.ICHOR, gold: C.GOLD };

// --- The ways up, down and out ------------------------------------------------------------------------------------------

const treadOf = (stone: string) => tiled(material(`dungeon-tread-${stone}`, () => Pic.stepTread(stoneRamp(stone))));
const stoneOf = (stone: string) => tiled(material(`dungeon-stair-stone-${stone}`, () => T.ashlar([...stoneRamp(stone)], 66, 5, 6, 10)));
function stoneRamp(stone: string): Ramp {
  switch (stone) {
    case "keep":
      return P.KEEP;
    case "tower":
      return P.TOWER;
    case "cave":
      return P.CAVE;
    case "root":
      return P.ROOT;
    case "soot":
      return P.SOOT;
    case "plate":
      return P.PLATE;
    default:
      return C.DUNGEON;
  }
}

drawn(
  "dungeon-stairs-up",
  "the way up: a flight climbing north on the tile from x, z (its north-west corner) to an arch in the wall behind; args.stone the stone (crypt, keep, tower, cave, root, soot, plate)",
  (b, p) => {
    const stone = str(p, "stone", "crypt");
    const tread = treadOf(stone);
    const side = stoneOf(stone);
    const { x, z } = p;
    for (let i = 0; i < 4; i++) {
      const z1 = z + 1 - i * 0.25;
      b.box(x + 0.12, 0, z1 - 0.25, x + 0.88, (i + 1) * 0.1875, z1, { top: tread, south: side, east: side, west: side });
    }
    // The arch: dark within, posts and a lintel of dressed stone.
    b.card(fitted(material(`dungeon-arch-${stone}`, () => P.archway(stoneRamp(stone)), { cutout: true })), x, 0, x + 1, 1.5, z + 0.02);
    b.box(x - 0.06, 0, z, x + 0.1, 1.6, z + 0.2, sides(side));
    b.box(x + 0.9, 0, z, x + 1.06, 1.6, z + 0.2, sides(side));
    b.box(x - 0.1, 1.6, z, x + 1.1, 1.78, z + 0.24, sides(side));
  },
);

drawn(
  "dungeon-stairs-down",
  "the stairs down: a flight going down north into the tile from x, z (its north-west corner), a hole in the floor; args.stone",
  (b, p) => {
    const stone = str(p, "stone", "crypt");
    const tread = treadOf(stone);
    const side = stoneOf(stone);
    const { x, z } = p;
    for (let i = 0; i < 4; i++) {
      const z1 = z + 1 - i * 0.25;
      const y = -(i + 1) * 0.25;
      b.box(x + 0.06, y - 0.12, z1 - 0.25, x + 0.94, y, z1, { top: tread, south: side });
    }
    // The pit's walls and its dark bottom.
    b.box(x, -1.4, z, x + 0.06, 0, z + 1, { east: side });
    b.box(x + 0.94, -1.4, z, x + 1, 0, z + 1, { west: side });
    b.box(x, -1.4, z, x + 1, 0, z + 0.04, { south: side });
    b.box(x, -1.4, z, x + 1, -1.4, z + 1, { top: fitted(material("dungeon-dark", () => P.black(), { flat: true })) });
    // A kerb round the mouth, open to the south.
    for (const [x0, x1, z0, z1] of [[x - 0.06, x + 0.06, z, z + 1], [x + 0.94, x + 1.06, z, z + 1], [x - 0.06, x + 1.06, z - 0.06, z + 0.06]] as const) b.box(x0, 0, z0, x1, 0.12, z1, sides(side));
  },
);

drawn("dungeon-way-out", "the way out past the boss: steps up into a doorway of daylight on the tile from x, z (its north-west corner)", (b, p) => {
  const { x, z } = p;
  const tread = treadOf("keep");
  const side = stoneOf("keep");
  for (let i = 0; i < 3; i++) {
    const z1 = z + 1 - i * 0.25;
    b.box(x + 0.1, 0, z1 - 0.25, x + 0.9, (i + 1) * 0.16, z1, { top: tread, south: side, east: side, west: side });
  }
  b.box(x + 0.05, 0, z, x + 0.95, 0.5, z + 0.3, sides(side));
  b.card(fitted(material("dungeon-daylight", () => daylight(), { glowing: true, cutout: true })), x + 0.12, 0.5, x + 0.88, 2.0, z + 0.18);
  b.box(x - 0.05, 0, z + 0.05, x + 0.12, 2.1, z + 0.3, sides(side));
  b.box(x + 0.88, 0, z + 0.05, x + 1.05, 2.1, z + 0.3, sides(side));
  b.box(x - 0.1, 2.1, z, x + 1.1, 2.3, z + 0.34, sides(side));
});

function daylight(): Pixmap {
  const p = new Pixmap(12, 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 12; x++) p.set(x, y, y < 3 && Math.abs(x - 5.5) > 4 - y ? 0 : y % 6 === 0 ? 0xfff8d0 : x % 5 === 0 ? 0xf4e0a0 : 0xfff0b8, y < 3 && Math.abs(x - 5.5) > 4 - y ? 0 : 255);
  return p;
}

// --- Caves ------------------------------------------------------------------------------------------------------------

drawn("dungeon-stalagmite", "a stalagmite at x, z, args.h high (1.2); its seed leans it", (b, p) => {
  const h = num(p, "h", 1.2);
  const rock = tiled(material("dungeon-cave-rock", () => P.caveRock(51)));
  const lean = ((p.seed ?? 0) % 3) * 0.04 - 0.04;
  for (let i = 0; i < 4; i++) {
    const r = 0.32 * (1 - i / 4.5);
    b.cylinder(p.x + lean * i, p.z, (h * i) / 4, (h * (i + 1)) / 4, r, 6, rock, rock);
  }
});

drawn("dungeon-crystal", "a cluster of glowing crystals at x, z; args.hue blue, violet, green or gold; args.size (1)", (b, p) => {
  const hue: string = str(p, "hue", "blue");
  const r = RAMPS[hue] ?? P.CRYSTAL;
  const s = num(p, "size", 1);
  const face = fitted(material(`dungeon-crystal-${hue}`, () => P.crystalFace(r), { glow: 0.55 }));
  const shards: [number, number, number, number][] = [[0, 0, 0.9, 0.12], [0.18, 0.1, 0.6, 0.09], [-0.16, 0.08, 0.5, 0.08], [0.05, -0.16, 0.42, 0.07]];
  shards.forEach(([dx, dz, h, w], i) => {
    b.at(p.x + dx * s, 0, p.z + dz * s, i * 0.7 + (p.seed ?? 0), () => {
      b.box(-w * s, 0, -w * s, w * s, h * s, w * s, sides(face));
      b.box(-w * s * 0.55, h * s, -w * s * 0.55, w * s * 0.55, (h + 0.12) * s, w * s * 0.55, sides(face));
    });
  });
});

drawn("dungeon-mushrooms", "a clump of glowing mushrooms at x, z; args.hue (green); its seed", (b, p) => {
  const hue: string = str(p, "hue", "green");
  const r = hue === "blue" ? P.CRYSTAL : hue === "violet" ? RAMPS.violet! : [0x08201a, 0x10382a, 0x1a5a3c, 0x2a8a52, 0x48c070, 0x8ae8a0, 0xd0ffd8];
  const cap = fitted(material(`dungeon-cap-${hue}`, () => P.capTop(r), { glow: 0.7 }));
  const stalk = flat(0xd8d0b8);
  const seed = p.seed ?? 0;
  for (let i = 0; i < 4; i++) {
    const a = seed + i * 2.1;
    const d = i === 0 ? 0 : 0.18 + 0.06 * i;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    const h = 0.32 - i * 0.05;
    b.cylinder(x, z, 0, h, 0.035, 5, { mat: stalk });
    b.cylinder(x, z, h, h + 0.06, 0.14 - i * 0.02, 7, cap, cap, 0.4);
  }
});

// --- The root hollow ---------------------------------------------------------------------------------------------------

drawn("dungeon-roots", "roots hanging down a wall (its face at z) from x to x + args.w (1), and trailing on the floor", (b, p) => {
  const w = num(p, "w", 1);
  const m = material("dungeon-hanging-roots", () => hangingRoots(), { cutout: true, twoSided: true });
  const turn = turnOf(p);
  b.at(p.x, 0, p.z, turn, () => {
    b.card(fitted(m), 0, 0.2, w, 2.6, 0.06);
    b.blob(w * 0.3, 0.08, 0.22, 0.28, 0.12, 0.2, stock.bark(), [p.x * 16, 0]);
    b.blob(w * 0.75, 0.06, 0.18, 0.22, 0.1, 0.16, stock.bark(), [p.x * 16, 5]);
  });
});

function hangingRoots(): Pixmap {
  const p = new Pixmap(16, 40);
  p.fill(0, 0);
  for (let k = 0; k < 6; k++) {
    let x = 1 + k * 2.6;
    const len = 18 + ((k * 7) % 5) * 5;
    for (let y = 0; y < len; y++) {
      x += Math.sin(y * 0.4 + k) * 0.35;
      const xi = Math.round(x);
      p.set(xi, y, y % 7 === 0 ? P.ROOT[2]! : P.ROOT[4]!);
      if (y < len - 6) p.set(xi + 1, y, P.ROOT[2]!);
      if (hash2(xi, y, k) < 0.06) p.set(xi - 1, y, P.MOSS[5]!);
    }
  }
  return p;
}

drawn("dungeon-sunpool", "a pool of green-gold light fallen from the canopy onto x, z, args.r across (1)", (b, p) => {
  const r = num(p, "r", 1);
  b.decal(fitted(material("dungeon-sunpool", () => sunPool(), { glow: 0.35, cutout: true })), p.x - r, p.z - r, p.x + r, p.z + r, 0.01);
});

function sunPool(): Pixmap {
  const p = new Pixmap(32, 32);
  p.fill(0, 0);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5) / 16;
      if (d < 1 && hash2(x, y, 3) < 1 - d * 0.9) p.set(x, y, d < 0.5 ? 0xd8e890 : 0xa8c860, 255);
    }
  }
  return p;
}

// --- The castle ---------------------------------------------------------------------------------------------------------

drawn("dungeon-banner", "a keep's banner on a rod against a wall (its face at z), its middle at x", (b, p) => {
  const m = material("dungeon-keep-banner", () => P.keepBanner(), { cutout: true, twoSided: true });
  b.at(p.x, 0, p.z, turnOf(p), () => {
    b.box(-0.45, 2.55, 0.06, 0.45, 2.62, 0.18, sides(flat(C.IRON[2]!)));
    b.box(-0.5, 2.53, 0.12, -0.42, 2.64, 0.2, sides(flat(C.GOLD[3]!)));
    b.box(0.42, 2.53, 0.12, 0.5, 2.64, 0.2, sides(flat(C.GOLD[3]!)));
    b.card(fitted(m), -0.375, 0.8, 0.375, 2.55, 0.14);
  });
});

drawn("dungeon-statue", "a knight's statue on a plinth at x, z, facing its rot", (b, p) => {
  const stone = tiled(stock.limestone(P.KEEP));
  const dark = tiled(material("dungeon-keep-dark", () => T.ashlar([P.KEEP[0]!, ...P.KEEP.slice(0, 6)], 58, 8, 12, 20)));
  at(b, p, () => {
    b.box(-0.42, 0, -0.42, 0.42, 0.4, 0.42, sides(dark));
    b.box(-0.18, 0.4, -0.12, -0.03, 1.05, 0.1, sides(stone));
    b.box(0.03, 0.4, -0.12, 0.18, 1.05, 0.1, sides(stone));
    b.box(-0.24, 1.05, -0.15, 0.24, 1.65, 0.14, sides(stone));
    b.box(-0.36, 1.1, -0.1, -0.24, 1.6, 0.08, sides(stone));
    b.box(0.24, 1.1, -0.1, 0.36, 1.6, 0.08, sides(stone));
    b.box(-0.14, 1.65, -0.13, 0.14, 1.95, 0.13, sides(stone));
    // The sword held point down before it.
    b.box(-0.03, 0.5, 0.16, 0.03, 1.4, 0.2, sides(stone));
    b.box(-0.14, 1.32, 0.15, 0.14, 1.38, 0.21, sides(stone));
    // A shield on its arm.
    b.box(0.3, 1.0, -0.12, 0.42, 1.55, 0.16, sides(dark));
  });
});

drawn("dungeon-well", "a stone well at x, z (two tiles across) under a little roof", (b, p) => {
  const stone = tiled(stock.limestone(P.KEEP));
  const { x, z } = p;
  b.cylinder(x, z, 0, 0.7, 0.75, 10, stone, tiled(material("dungeon-water", () => P.darkWater(49), { flat: true })));
  b.ring(x, z, 0.7, 0.55, 0.75, 10, stock.limestone(P.KEEP));
  for (const dx of [-0.7, 0.62]) b.box(x + dx, 0.7, z - 0.05, x + dx + 0.08, 1.9, z + 0.05, sides(tiled(stock.timber())));
  b.box(x - 0.75, 1.85, z - 0.05, x + 0.75, 1.92, z + 0.05, sides(tiled(stock.darkTimber())));
  b.gableRoof(x - 0.85, z - 0.55, x + 0.85, z + 0.55, 1.95, 0.45, stock.roof(), tiled(stock.darkTimber()));
  b.box(x - 0.12, 1.2, z - 0.12, x + 0.12, 1.45, z + 0.12, sides(tiled(stock.timber())));
});

drawn("dungeon-parapet", "a crenellated parapet along a battlement's edge, from x, z to args.to (its line along x or z)", (b, p) => {
  const [x1, z1] = point(p, "to");
  const stone = tiled(stock.limestone(P.KEEP));
  const top = tiled(material("dungeon-keep-top", () => T.flagstones([P.KEEP[0]!, ...P.KEEP.slice(0, 6)], 59)));
  const alongX = Math.abs(x1 - p.x) >= Math.abs(z1 - p.z);
  const len = alongX ? x1 - p.x : z1 - p.z;
  if (alongX) b.box(p.x, 0, p.z - 0.2, x1, 0.75, p.z + 0.2, sides(stone, top));
  else b.box(p.x - 0.2, 0, p.z, p.x + 0.2, 0.75, z1, sides(stone, top));
  for (let s = 0; s + 0.5 <= len + 1e-6; s += 1) {
    if (alongX) b.box(p.x + s + 0.05, 0.75, p.z - 0.2, p.x + s + 0.5, 1.2, p.z + 0.2, sides(stone, top));
    else b.box(p.x - 0.2, 0.75, p.z + s + 0.05, p.x + 0.2, 1.2, p.z + s + 0.5, sides(stone, top));
  }
}, {}, (p) => (Array.isArray(p.args?.to) ? [] : [`prop ${p.id} at ${p.x},${p.z}: args.to should be a point`]));

// --- The foundry ---------------------------------------------------------------------------------------------------------

drawn("dungeon-forge", "a forge against a wall (its face at z), its middle at x: a hearth of coals under a hood, its fire burning", (b, p) => {
  const stone = tiled(material("dungeon-soot-stone", () => T.ashlar(P.SOOT, 62, 6, 8, 14)));
  const iron = tiled(material("dungeon-iron-band", () => P.ironBand()));
  const coals = fitted(material("dungeon-coals", () => coalsPicture(), { glowing: true }));
  const turn = turnOf(p);
  b.at(p.x, 0, p.z, turn, () => {
    b.box(-0.9, 0, 0, 0.9, 0.8, 0.9, { south: stone, east: stone, west: stone, top: stone });
    b.box(-0.6, 0.8, 0.1, 0.6, 0.82, 0.75, { top: coals });
    b.box(-0.95, 0.8, 0, -0.8, 1.6, 0.9, sides(iron));
    b.box(0.8, 0.8, 0, 0.95, 1.6, 0.9, sides(iron));
    b.box(-0.95, 1.6, 0, 0.95, 2.0, 0.95, sides(iron));
    b.box(-0.5, 2.0, 0, 0.5, 3.0, 0.5, sides(stone));
  });
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const fx = p.x + 0.45 * s;
  const fz = p.z + 0.45 * c;
  return { frames: [flames(12, (fb, face) => fb.card(face, fx - 0.375, 0.82, fx + 0.375, 1.57, fz))] };
});

function coalsPicture(): Pixmap {
  const p = new Pixmap(16, 8, P.LAVA_RAMP[1]!);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) if (hash2(x, y, 5) < 0.45) p.set(x, y, hash2(x, y, 6) < 0.3 ? P.LAVA_RAMP[4]! : P.LAVA_RAMP[3]!);
  return p;
}

drawn("dungeon-anvil", "an anvil on a block at x, z, turned by rot", (b, p) => {
  const iron = flat(C.IRON[2]!);
  const light = flat(C.IRON[4]!);
  at(b, p, () => {
    b.box(-0.22, 0, -0.18, 0.22, 0.42, 0.18, sides(tiled(stock.darkTimber())));
    b.box(-0.12, 0.42, -0.1, 0.12, 0.56, 0.1, sides(iron));
    b.box(-0.32, 0.56, -0.13, 0.26, 0.72, 0.13, sides(iron, light));
    b.box(0.26, 0.6, -0.07, 0.44, 0.7, 0.07, sides(iron, light));
    b.box(-0.1, 0.72, 0.02, 0.1, 0.76, 0.06, sides(flat(C.WOOD[3]!)));
  });
});

drawn("dungeon-crucible", "a crucible of molten metal on a stand at x, z, glowing", (b, p) => {
  const iron = tiled(material("dungeon-iron-band", () => P.ironBand()));
  b.cylinder(p.x, p.z, 0, 0.3, 0.42, 8, iron);
  b.cylinder(p.x, p.z, 0.3, 0.9, 0.48, 10, iron, fitted(material("dungeon-melt", () => P.lava(70), { glowing: true })), 0.25);
});

drawn("dungeon-chains", "chains hanging down a wall (its face at z) at x, a hook at their end", (b, p) => {
  const iron = flat(C.IRON[3]!);
  b.at(p.x, 0, p.z, turnOf(p), () => {
    for (const dx of [-0.2, 0.2]) {
      for (let y = 1.2; y < 2.9; y += 0.14) b.box(dx - 0.03, y, 0.1, dx + 0.03, y + 0.1, 0.16, sides(iron));
    }
    b.box(-0.24, 1.08, 0.08, 0.24, 1.14, 0.18, sides(iron));
  });
});

// --- The tower ---------------------------------------------------------------------------------------------------------

drawn("dungeon-rift", "a time-rift standing open at x, z: a tear of light in a ring of floating shards", (b, p) => {
  const ring = fitted(material("dungeon-crystal-blue", () => P.crystalFace(P.CRYSTAL), { glow: 0.55 }));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const x = p.x + Math.cos(a) * 0.75;
    const z = p.z + Math.sin(a) * 0.4;
    const y = 0.4 + (k % 3) * 0.35;
    b.box(x - 0.06, y, z - 0.06, x + 0.06, y + 0.24, z + 0.06, sides(ring));
  }
  b.cylinder(p.x, p.z, 0, 0.06, 0.8, 12, { mat: stock.cryptStone(P.TOWER) }, fitted(material("dungeon-rift-floor", () => P.riftFloor(47))));
  return {
    frames: [
      {
        rate: 6,
        models: [0, 1, 2].map((f) => {
          const fb = new MeshBuilder();
          fb.card(fitted(material(`dungeon-rift-${f}`, () => P.rift(f), { glowing: true, cutout: true, twoSided: true })), p.x - 0.5, 0.15, p.x + 0.5, 1.65, p.z);
          return fb.model();
        }),
      },
    ],
  };
});

drawn("dungeon-desk", "a mage's desk at x, z (1.5 by 0.8) with books, a scroll and a candle, turned by rot", (b, p) => {
  const timber = tiled(stock.timber());
  const dark = tiled(stock.darkTimber());
  at(b, p, () => {
    for (const [lx, lz] of [[-0.7, -0.35], [0.6, -0.35], [-0.7, 0.25], [0.6, 0.25]] as const) b.box(lx, 0, lz, lx + 0.1, 0.72, lz + 0.1, sides(dark));
    b.box(-0.75, 0.72, -0.4, 0.75, 0.8, 0.4, sides(timber));
    for (const [i, c] of [C.RED[2]!, C.BLUE[2]!, C.GREEN[2]!].entries()) b.box(-0.6 + i * 0.12, 0.8, -0.3, -0.5 + i * 0.12, 1.08 - i * 0.04, 0.0, sides(flat(c)));
    b.box(0.0, 0.8, -0.15, 0.4, 0.82, 0.2, { top: fitted(material("dungeon-scroll", () => scroll())) });
    b.box(0.5, 0.8, -0.05, 0.56, 1.02, 0.01, sides(flat(0xf4ecd4)));
    b.box(0.51, 1.02, -0.04, 0.55, 1.08, 0.0, sides(material("candle-flame", () => new Pixmap(2, 2, C.FIRE[4]!), { glowing: true })));
  });
});

function scroll(): Pixmap {
  const p = new Pixmap(8, 6, 0xf0dcaa);
  for (let y = 1; y < 5; y++) for (let x = 1; x < 7; x++) if ((x + y * 2) % 3 === 0) p.set(x, y, 0x5a3a48);
  return p;
}

// --- The portal ---------------------------------------------------------------------------------------------------------

drawn("dungeon-pylon", "a Phyrexian pylon at x, z: spined plates round a glowing core, args.h high (2.2)", (b, p) => {
  const h = num(p, "h", 2.2);
  const plate = tiled(material("dungeon-ribs", () => P.ribs(53)));
  const sinew = tiled(material("dungeon-sinew", () => T.flagstones(P.SINEW, 64)));
  const core = fitted(material("dungeon-ichor", () => ichorCore(), { glowing: true }));
  b.box(p.x - 0.42, 0, p.z - 0.42, p.x + 0.42, 0.22, p.z + 0.42, sides(sinew));
  b.box(p.x - 0.3, 0.22, p.z - 0.3, p.x + 0.3, 0.4, p.z + 0.3, sides(plate));
  b.box(p.x - 0.14, 0.4, p.z - 0.14, p.x + 0.14, h * 0.85, p.z + 0.14, sides(core));
  for (let k = 0; k < 4; k++) {
    b.at(p.x, 0.4, p.z, (k * Math.PI) / 2 + Math.PI / 4, () => {
      // A curved blade of plating, leaning in toward the core at its tip.
      b.box(0.16, 0, -0.07, 0.32, h * 0.55, 0.07, sides(plate));
      b.box(0.12, h * 0.55, -0.06, 0.26, h * 0.85, 0.06, sides(plate));
      b.box(0.06, h * 0.85, -0.05, 0.18, h, 0.05, sides(plate));
    });
  }
});

function ichorCore(): Pixmap {
  const p = new Pixmap(4, 16, P.ICHOR[5]!);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) if ((y + x) % 5 === 0) p.set(x, y, P.ICHOR[6]!);
  return p;
}

drawn("dungeon-altar", "a Phyrexian altar at x, z (1.5 by 1), ichor glowing in its basin; turned by rot", (b, p) => {
  const plate = tiled(material("dungeon-ribs", () => P.ribs(53)));
  const sinew = tiled(material("dungeon-sinew", () => T.flagstones(P.SINEW, 64)));
  at(b, p, () => {
    b.box(-0.8, 0, -0.55, 0.8, 0.15, 0.55, sides(sinew));
    b.box(-0.65, 0.15, -0.4, 0.65, 0.85, 0.4, sides(plate));
    b.box(-0.55, 0.85, -0.3, 0.55, 0.87, 0.3, { top: fitted(material("dungeon-ichor-pool", () => P.sigil(), { glowing: true })) });
    for (const dx of [-0.7, 0.7]) b.box(dx - 0.06, 0.15, -0.06, dx + 0.06, 1.5, 0.06, sides(plate));
  });
});

drawn("dungeon-vat", "a glass vat of green fluid at x, z, something floating in it", (b, p) => {
  const plate = tiled(material("dungeon-ribs", () => P.ribs(53)));
  const fluid = fitted(material("dungeon-vat-fluid", () => vatFluid(), { glow: 0.6 }));
  b.cylinder(p.x, p.z, 0, 0.25, 0.48, 8, plate, plate);
  b.cylinder(p.x, p.z, 0.25, 1.7, 0.4, 8, fluid);
  b.cylinder(p.x, p.z, 1.7, 1.9, 0.48, 8, plate, plate);
});

function vatFluid(): Pixmap {
  const p = new Pixmap(24, 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) p.set(x, y, hash2(x, y, 9) < 0.05 ? P.ICHOR[6]! : y % 6 === 0 ? P.ICHOR[4]! : P.ICHOR[3]!);
  for (let y = 7; y < 17; y++) for (let x = 9; x < 15; x++) if (Math.hypot(x - 11.5, (y - 12) * 0.6) < 3) p.set(x, y, P.SINEW[2]!);
  return p;
}

drawn("dungeon-sigil", "the praetor's sigil inlaid in the floor round x, z, args.r across (2)", (b, p) => {
  const r = num(p, "r", 2);
  b.decal(fitted(material("dungeon-sigil", () => P.sigil(), { glow: 0.8, cutout: true })), p.x - r, p.z - r, p.x + r, p.z + r, 0.006);
});

drawn("dungeon-grime", "grime and moss on the floor round x, z (a tile across); its seed", (b, p) => {
  const seed = p.seed ?? 4;
  b.decal(fitted(material(`dungeon-grime-${seed}`, () => Pic.grime(seed), { cutout: true })), p.x - 0.75, p.z - 0.75, p.x + 0.75, p.z + 0.75, 0.005 + (seed % 3) * 0.001);
});

// --- A shrine (design.md A6: one run in eight holds one) ---------------------------------------------------------------

/** The heart a shrine gives: rose-red light. */
const SHRINE_HEART: Ramp = [0x3c0614, 0x6c0e24, 0xa8163a, 0xd82a4c, 0xf8546a, 0xff94a0, 0xffd8dc];
/** A spent shrine's heart: cold grey stone. */
const SPENT_HEART: Ramp = [0x18161c, 0x2a2730, 0x3c3842, 0x504a54, 0x665e66, 0x7e767c, 0x968c90];

drawn(
  "dungeon-shrine",
  "a forgotten shrine of Serra at x, z (a tile, used from beside it): a stepped plinth of args.stone (keep), a stele carved with an angel's spread wings, a candle burning at each side; its heart hovers over it (dungeon-shrine-heart)",
  (b, p) => {
    const stone = str(p, "stone", "keep");
    const side = stoneOf(stone);
    const tread = treadOf(stone);
    const { x, z } = p;
    // Two steps up to an altar block, and the stele behind it, its face to the south.
    b.box(x - 0.5, 0, z - 0.46, x + 0.5, 0.14, z + 0.46, { top: tread, south: side, east: side, west: side, north: side });
    b.box(x - 0.42, 0.14, z - 0.38, x + 0.42, 0.3, z + 0.36, { top: tread, south: side, east: side, west: side, north: side });
    b.box(x - 0.3, 0.3, z - 0.14, x + 0.3, 0.74, z + 0.24, sides(side));
    b.box(x - 0.36, 0.74, z - 0.2, x + 0.36, 0.82, z + 0.3, sides(side));
    b.box(x - 0.24, 0.3, z - 0.38, x + 0.24, 1.7, z - 0.24, sides(side));
    b.box(x - 0.3, 1.7, z - 0.42, x + 0.3, 1.8, z - 0.2, sides(side));
    const wings = fitted(material("dungeon-shrine-wings", () => wingsPicture(P.MARBLE), { cutout: true }));
    b.card(wings, x - 0.55, 0.9, x + 0.55, 1.62, z - 0.23);
    // The candles: wax, and a flame on each.
    const wax = fitted(material("dungeon-candle-wax", () => new Pixmap(2, 2, 0xe8dcc0)));
    const flame = fitted(glowFlat("dungeon-candle-flame", 0xffd070));
    for (const dx of [-0.38, 0.38]) {
      b.box(x + dx - 0.04, 0.3, z + 0.14, x + dx + 0.04, 0.56, z + 0.22, sides(wax));
      b.box(x + dx - 0.025, 0.56, z + 0.16, x + dx + 0.025, 0.65, z + 0.2, sides(flame));
    }
  },
);

drawn(
  "dungeon-shrine-heart",
  "a shrine's heart hovering over its plinth at x, z: a heart of rose-red light in a halo, which gives back a heart once in the run; args.spent cold grey stone, its blessing given",
  (b, p) => {
    const spent = bool(p, "spent", false);
    const { x, z } = p;
    const heart = fitted(material(spent ? "dungeon-shrine-heart-spent" : "dungeon-shrine-heart", () => Pic.heart(spent ? SPENT_HEART : SHRINE_HEART, 16), spent ? { cutout: true } : { glowing: true, cutout: true }));
    b.card(heart, x - 0.28, 0.9, x + 0.28, 1.46, z + 0.06);
    if (spent) return;
    const halo = fitted(material("dungeon-shrine-halo", () => halo16(SHRINE_HEART), { glowing: true, cutout: true }));
    b.card(halo, x - 0.5, 0.68, x + 0.5, 1.68, z + 0.02);
  },
);

/** An angel's wings spread, 24 by 14, cut out: rows of feathers fanning out from the middle, carved in pale stone. */
function wingsPicture(r: Ramp): Pixmap {
  const p = new Pixmap(24, 14);
  p.fill(0, 0);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 24; x++) {
      const u = Math.abs(x - 11.5) / 12;
      // The wing's edge rises from the middle and sweeps down to its tip; feathers hang under it in steps.
      const top = 1 + u * 3 + (u > 0.75 ? (u - 0.75) * 16 : 0);
      const bottom = 13 - u * 7 + ((Math.floor(u * 6) % 2) * 1.5);
      if (u < 0.08 || y < top || y > bottom) continue;
      const feather = Math.floor(u * 6);
      p.set(x, y, y - top < 1 ? r[6]! : (x + feather) % 4 === 0 ? r[3]! : y > bottom - 1.5 ? r[4]! : r[5]!);
    }
  }
  return p;
}

/** A soft round glow, 16 by 16, cut out: thinning out from the middle, in the ramp's light. */
function halo16(r: Ramp): Pixmap {
  const p = new Pixmap(16, 16);
  p.fill(0, 0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 8;
      if (d > 1 || hash2(x, y, 37) > 1.05 - d) continue;
      p.set(x, y, d < 0.45 ? r[5]! : r[4]!);
    }
  }
  return p;
}

void PX;
