import * as C from "./colors";
import { cellAt, crack, fbm, jitteredPoints, paintCells, pebble, tuft, valueNoise, voronoi } from "./procedural";
import { Pixmap, type Rgb, hash2, seeded } from "./pixmap";
import * as R from "./ramps";

// The ground of every biome, painted by code at 16 texels a tile as the slice's surfaces are (textures.ts): grass of the
// plains, meadow and pasture; crops and stubble; a forest's loam, leaf litter, moss and needles; swamp mud, mire and
// marsh; tundra, snow and ice; bedrock, scree and gravel; sand, shingle and wet sand; ash, basalt and lava; the waste's
// cracked earth and salt; Phyrexian plating and oil; the roads (ruts, setts, marble, mud, packed snow, boardwalks); and
// the waters (sea, lake, bog, a ford). Each is 64 texels square, seamless (painting wraps, noise tiles with period 64)
// and seeded, so it is the same on every load. Ramps are taken as arguments where a palette may recolor them.

const SIZE = 64;
type Ramp = readonly Rgb[];

const at = (r: Ramp, i: number): Rgb => r[Math.max(0, Math.min(r.length - 1, i))]!;

/** Fills with a ramp's colors in soft fbm patches: `levels` the ramp indices from the lowest noise up. */
function patches(p: Pixmap, r: Ramp, levels: readonly number[], cell: number, seed: number, speck = 0.04): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, cell, SIZE, seed);
      let k = Math.min(levels.length - 1, Math.floor(n * levels.length * 1.15 - 0.08 * levels.length));
      k = Math.max(0, k);
      let c = at(r, levels[k]!);
      if (hash2(x, y, seed + 1) < speck) c = at(r, levels[Math.max(0, k - 1)]!);
      p.set(x, y, c);
    }
  }
}

/** Scatters `count` tufts in a loose grid, as the slice's grass does. */
function tufts(p: Pixmap, r: Ramp, seed: number, skip: number, lo = 1, hi = 4): void {
  const random = seeded(seed + 11);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      if (random() < skip) continue;
      const x = i * 8 + 2 + Math.floor(random() * 5) + (j % 2) * 4;
      const y = j * 8 + 3 + Math.floor(random() * 4);
      tuft(p, x, y, at(r, lo), at(r, hi - 1), at(r, hi), random() < 0.3 ? 2 : 1);
    }
  }
}

/** Small flowers: a petal cross round a centre, a stalk's dark under. */
function flowers(p: Pixmap, count: number, seed: number, petals: readonly (readonly [Rgb, Rgb])[], under: Rgb): void {
  const random = seeded(seed + 23);
  for (let k = 0; k < count; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    const [petal, centre] = petals[Math.floor(random() * petals.length)]!;
    p.set(x, y - 1, petal);
    p.set(x - 1, y, petal);
    p.set(x + 1, y, petal);
    p.set(x, y, centre);
    p.set(x, y + 1, under);
  }
}

const WILDFLOWERS: readonly (readonly [Rgb, Rgb])[] = [
  [0xfff8e8, 0xf4dc7a],
  [0xf8d04c, 0xe0a02c],
  [0xfcb0c8, 0xe8789a],
  [0x82b8f6, 0x4c8ae6],
  [0xd890f0, 0x9058c0],
  [0xf88c6a, 0xc8343a],
];

// --- Grass ------------------------------------------------------------------------------------------------------------

/** The plains: dry gold-green grass in long patches, sparse tufts, the odd yellow flower. */
export function plains(r: Ramp = R.PLAINS, seed = 101): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y * 1.6, 16, SIZE, seed);
      let c = r[3]!;
      if (n < 0.36) c = r[2]!;
      else if (n > 0.66) c = r[4]!;
      const h = hash2(x, y, seed);
      if (h < 0.05) c = n > 0.5 ? r[5]! : r[2]!;
      p.set(x, y, c);
    }
  }
  // Long blades: short vertical strokes, lit at the tip.
  const random = seeded(seed + 3);
  for (let k = 0; k < 90; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, r[2]!);
    p.set(x, y - 1, r[4]!);
    p.set(x, y - 2, r[5]!);
  }
  tufts(p, r, seed, 0.55, 1, 5);
  flowers(p, 4, seed, [[0xf8d04c, 0xe0a02c], [0xfff8e8, 0xf4dc7a]], r[1]!);
  return p;
}

/** A meadow: lush grass, tufts all over and flowers of every color. */
export function meadow(r: Ramp = C.GRASS, seed = 102): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = r[3]!;
      if (n < 0.32) c = r[2]!;
      else if (n > 0.64) c = r[4]!;
      if (hash2(x, y, seed + 3) < 0.05) c = n > 0.5 ? r[5]! : r[2]!;
      p.set(x, y, c);
    }
  }
  tufts(p, r, seed, 0.12, 2, 5);
  flowers(p, 22, seed, WILDFLOWERS, r[1]!);
  return p;
}

/** Pasture: short grazed turf, patches of clover in a lighter green, few tufts. */
export function pasture(r: Ramp = C.GRASS, seed = 103): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 8, SIZE, seed);
      let c = r[4]!;
      if (n < 0.38) c = r[3]!;
      if (hash2(x, y, seed) < 0.08) c = r[3]!;
      if (hash2(x, y, seed + 9) < 0.03) c = r[5]!;
      p.set(x, y, c);
    }
  }
  // Clover: little three-leaf clumps, lighter, in drifts.
  const random = seeded(seed + 5);
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    if (fbm(x, y, 16, SIZE, seed + 4) < 0.45) continue;
    p.set(x, y, r[5]!);
    p.set(x + 1, y, r[5]!);
    p.set(x, y - 1, r[6]!);
    p.set(x + 1, y + 1, r[3]!);
    if (random() < 0.15) p.set(x + 1, y - 1, 0xfff8e8);
  }
  tufts(p, r, seed, 0.72, 2, 5);
  return p;
}

/** Marsh: wet grass and reeds over mud, standing water glinting between the clumps. */
export function marsh(r: Ramp = R.REED, seed = 104): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const m = R.MUD;
  const w = R.BOG;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.3 ? w[3]! : n < 0.4 ? m[4]! : n < 0.62 ? r[3]! : r[4]!;
      if (n < 0.3 && hash2(x, y, seed) < 0.05) c = w[5]!;
      if (n >= 0.4 && hash2(x, y, seed + 2) < 0.06) c = r[2]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 7);
  for (let k = 0; k < 70; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    if (fbm(x, y, 16, SIZE, seed) < 0.4) continue;
    const h = 2 + Math.floor(random() * 3);
    for (let i = 0; i < h; i++) p.set(x, y - i, i === h - 1 ? r[6]! : i === 0 ? r[1]! : r[4]!);
  }
  return p;
}

// --- Farmland ----------------------------------------------------------------------------------------------------------

/** Rows of green crops (cabbages, beans) on dark earth, east-west. */
export function cropRows(leaf: Ramp = C.LEAF, seed = 105): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const d = C.DIRT;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const row = y % 8;
      let c = row < 2 ? d[1]! : row < 3 ? d[2]! : d[3]!;
      if (hash2(x, y, seed) < 0.06) c = d[2]!;
      p.set(x, y, c);
    }
  }
  // A plant every few texels along each row: a rounded head, lit on top.
  for (let row = 0; row < SIZE / 8; row++) {
    for (let x = (row % 2) * 3; x < SIZE; x += 6) {
      const cy = row * 8 + 5;
      const t = hash2(x, row, seed) < 0.5 ? 3 : 4;
      for (const [dx, dy, k] of [
        [-1, -1, t + 1],
        [0, -2, t + 2],
        [1, -1, t + 1],
        [-2, 0, t],
        [-1, 0, t],
        [0, -1, t + 1],
        [0, 0, t],
        [1, 0, t],
        [2, 0, t - 1],
        [-1, 1, t - 1],
        [0, 1, t - 1],
        [1, 1, t - 2],
      ] as const)
        p.set(x + dx, cy + dy, at(leaf, k));
      p.set(x, cy + 2, d[0]!);
    }
  }
  return p;
}

/** Stubble: a reaped field, pale earth with rows of cut straw and a stray stalk. */
export function stubble(seed = 106): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const s = C.STRAW;
  const d = C.DIRT;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.45 ? d[3]! : d[4]!;
      if (y % 4 === 3) c = d[2]!;
      p.set(x, y, c);
    }
  }
  for (let y = 0; y < SIZE; y += 4) {
    for (let x = 0; x < SIZE; x++) {
      if (hash2(x, y, seed + 1) < 0.45) {
        p.set(x, y + 1, s[3]!);
        p.set(x, y, hash2(x, y, seed + 2) < 0.5 ? s[4]! : s[2]!);
      }
    }
  }
  const random = seeded(seed + 3);
  for (let k = 0; k < 10; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    for (let i = 0; i < 4; i++) p.set(x + i, y - (i >> 1), s[i % 2 ? 4 : 3]!);
  }
  return p;
}

// --- The forest floor ------------------------------------------------------------------------------------------------

/** A forest's floor: dark loam, moss in patches, roots, twigs and a few fallen leaves. */
export function forestFloor(soil: Ramp = R.LOAM, moss: Ramp = R.MOSS, seed = 107): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      const mossy = fbm(x, y, 16, SIZE, seed + 9);
      let c = n < 0.35 ? soil[2]! : n < 0.65 ? soil[3]! : soil[4]!;
      if (hash2(x, y, seed) < 0.06) c = soil[1]!;
      if (mossy > 0.64) c = mossy > 0.74 ? moss[3]! : moss[2]!;
      if (mossy > 0.64 && hash2(x, y, seed + 4) < 0.1) c = moss[4]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  // Roots: long dark walks with a lit edge above.
  for (let k = 0; k < 4; k++) {
    let x = Math.floor(random() * SIZE);
    let y = Math.floor(random() * SIZE);
    for (let i = 0; i < 14; i++) {
      p.set(x, y, soil[1]!);
      p.set(x, y - 1, soil[5]!);
      x += 1;
      if (random() < 0.3) y += random() < 0.5 ? 1 : -1;
    }
  }
  // Twigs and leaves.
  for (let k = 0; k < 18; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    if (random() < 0.5) {
      p.set(x, y, soil[5]!);
      p.set(x + 1, y + 1, soil[5]!);
      p.set(x + 2, y + 1, soil[4]!);
    } else {
      const l = R.LITTER;
      p.set(x, y, l[4]!);
      p.set(x + 1, y, l[3]!);
      p.set(x, y + 1, l[2]!);
    }
  }
  return p;
}

/** Leaf litter: fallen leaves in rust and gold, heaped over loam. */
export function leafLitter(leaves: Ramp = R.LITTER, seed = 108): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const soil = R.LOAM;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, hash2(x, y, seed) < 0.3 ? soil[2]! : soil[3]!);
  const random = seeded(seed + 1);
  for (let k = 0; k < 260; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    const t = 2 + Math.floor(random() * 4);
    // A leaf: a little diamond, lit on its top-left, a dark vein.
    p.set(x, y - 1, at(leaves, t + 1));
    p.set(x - 1, y, at(leaves, t + 1));
    p.set(x, y, at(leaves, t));
    p.set(x + 1, y, at(leaves, t));
    p.set(x, y + 1, at(leaves, t - 1));
    if (random() < 0.4) p.set(x + 1, y + 1, at(leaves, t - 2));
  }
  return p;
}

/** Moss: a deep green carpet in cushions, shadowed between them. */
export function moss(r: Ramp = R.MOSS, seed = 109): Pixmap {
  const points = jitteredPoints(SIZE, SIZE, 7, 6, 0.8, seed);
  const map = voronoi(SIZE, SIZE, points, 0.6);
  const cell = cellAt(map, SIZE, SIZE);
  const random = seeded(seed + 1);
  const shades = points.map(() => {
    const b = random() < 0.4 ? 3 : 4;
    return { base: r[b]!, light: r[b + 1]!, lighter: r[Math.min(r.length - 1, b + 2)]!, dark: r[b - 1]!, speckle: 0.12, speckleColor: r[b + 1]! };
  });
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cell, (i) => shades[i]!, r[1]!, seed);
  return p;
}

/** Pine needles: a rusty mat of short strokes, cones and the odd tuft of green. */
export function needles(r: Ramp = R.NEEDLES, seed = 110): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, fbm(x, y, 16, SIZE, seed) < 0.45 ? r[2]! : r[3]!);
  const random = seeded(seed + 1);
  for (let k = 0; k < 420; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    const c = random() < 0.5 ? r[4]! : random() < 0.5 ? r[5]! : r[1]!;
    const dir = random() < 0.5 ? 1 : -1;
    p.set(x, y, c);
    p.set(x + dir, y + 1, c);
  }
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, r[5]!);
    p.set(x + 1, y, r[4]!);
    p.set(x, y + 1, r[3]!);
    p.set(x + 1, y + 1, r[1]!);
  }
  tufts(p, R.MOSS, seed, 0.85, 2, 5);
  return p;
}

// --- Swamp -------------------------------------------------------------------------------------------------------------

/** Swamp mud: wet black-olive mud, puddles with a sky glint, reed stubs and footprints of something big. */
export function swampMud(r: Ramp = R.MUD, seed = 111): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const w = R.BOG;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.28 ? w[2]! : n < 0.45 ? r[3]! : n < 0.7 ? r[4]! : r[5]!;
      if (n < 0.28 && hash2(x, y, seed) < 0.04) c = w[5]!;
      if (n >= 0.28 && hash2(x, y, seed + 1) < 0.07) c = r[2]!;
      p.set(x, y, c);
    }
  }
  // The puddles' lit far rims.
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (fbm(x, y, 16, SIZE, seed) < 0.28 && fbm(x, y - 1, 16, SIZE, seed) >= 0.28) p.set(x, y, w[4]!);
  const random = seeded(seed + 2);
  for (let k = 0; k < 16; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, R.REED[4]!);
    p.set(x, y - 1, R.REED[5]!);
    p.set(x, y + 1, r[1]!);
  }
  return p;
}

/** The Morass's mire: oily black, sick green where the light catches it, bubbles and a rainbow sheen. */
export function mire(r: Ramp = R.MIRE, seed = 112): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y * 1.3, 16, SIZE, seed);
      let c = n < 0.3 ? r[1]! : n < 0.5 ? r[2]! : n < 0.7 ? r[3]! : r[4]!;
      const sheen = valueNoise(x, y, 8, SIZE, seed + 5);
      if (n < 0.3 && sheen > 0.7) c = R.OIL[5]!;
      if (n < 0.3 && sheen > 0.78) c = R.BOG[6]!;
      if (hash2(x, y, seed) < 0.03) c = r[5]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, r[6]!);
    p.set(x + 1, y + 1, r[1]!);
    p.set(x - 1, y + 1, r[0]!);
  }
  return p;
}

// --- Cold ---------------------------------------------------------------------------------------------------------------

/** Tundra: frost-bitten grass, lichen, pebbles and a glitter of hoar frost. */
export function tundra(r: Ramp = R.TUNDRA, seed = 113): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.35 ? r[2]! : n < 0.62 ? r[3]! : r[4]!;
      if (hash2(x, y, seed) < 0.05) c = r[1]!;
      if (fbm(x, y, 16, SIZE, seed + 3) > 0.74 && hash2(x, y, seed + 5) < 0.6) c = R.LICHEN[hash2(x, y, seed + 2) < 0.5 ? 2 : 3]!;
      if (hash2(x, y, seed + 6) < 0.025) c = R.SNOW[5]!;
      p.set(x, y, c);
    }
  }
  tufts(p, r, seed, 0.6, 1, 5);
  const random = seeded(seed + 4);
  for (let k = 0; k < 14; k++) pebble(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), R.GRANITE[4]!, R.GRANITE[5]!, R.GRANITE[1]!, random() < 0.5);
  return p;
}

/** Snow: soft drifts, blue in their hollows, white on their crests, a sparkle here and there. */
export function snow(r: Ramp = R.SNOW, seed = 114): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y * 1.5, 16, SIZE, seed);
      // The drifts: a lit crest where the noise rises to the north, a shadow where it falls.
      const slope = fbm(x, y * 1.5 - 1.5, 16, SIZE, seed) - n;
      let c = n < 0.4 ? r[4]! : r[5]!;
      if (slope > 0.018) c = r[3]!;
      if (slope < -0.02) c = r[6]!;
      if (hash2(x, y, seed) < 0.012) c = 0xffffff;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Ice: clear blue with white cracks, frozen bubbles, and snow dusting its edges. */
export function ice(r: Ramp = R.ICE, seed = 115): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.4 ? r[3]! : n < 0.66 ? r[4]! : r[5]!;
      if (fbm(x, y, 8, SIZE, seed + 4) > 0.74) c = R.SNOW[5]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  for (let k = 0; k < 8; k++) crack(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), 8 + Math.floor(random() * 10), r[6]!, random, r[2]!);
  for (let k = 0; k < 12; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, r[6]!);
    p.set(x + 1, y + 1, r[2]!);
  }
  // Long streaks of glare.
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    for (let i = 0; i < 5; i++) p.set(x + i, y - i, r[6]!);
  }
  return p;
}

// --- Stone --------------------------------------------------------------------------------------------------------------

/** Bedrock: big slabs of mountain granite, cracked, lichen in the cracks' lee. */
export function bedrock(r: Ramp = R.GRANITE, seed = 116): Pixmap {
  const points = jitteredPoints(SIZE, SIZE, 21, 16, 0.7, seed);
  const map = voronoi(SIZE, SIZE, points, 1.2, 1.4);
  const cell = cellAt(map, SIZE, SIZE);
  const random = seeded(seed + 1);
  const shades = points.map(() => {
    const b = random() < 0.4 ? 3 : random() < 0.8 ? 4 : 5;
    return { base: r[b]!, light: r[b + 1]!, lighter: r[Math.min(r.length - 1, b + 2)]!, dark: r[b - 1]!, speckle: 0.06, speckleColor: r[b - 1]! };
  });
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cell, (i) => shades[i]!, r[1]!, seed);
  for (let k = 0; k < 9; k++) crack(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), 4 + Math.floor(random() * 6), r[2]!, random);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (cell(x, y) >= 0 && fbm(x, y, 8, SIZE, seed + 7) > 0.76) p.set(x, y, R.LICHEN[hash2(x, y, seed) < 0.5 ? 2 : 1]!);
  return p;
}

/** Scree: loose broken stones heaped down a slope, dark gaps between them. */
export function scree(r: Ramp = R.GRANITE, seed = 117): Pixmap {
  const points = jitteredPoints(SIZE, SIZE, 6, 5, 0.9, seed);
  const map = voronoi(SIZE, SIZE, points, 1.0, 1.1);
  const cell = cellAt(map, SIZE, SIZE);
  const random = seeded(seed + 1);
  const shades = points.map(() => {
    const b = 2 + Math.floor(random() * 4);
    return { base: at(r, b), light: at(r, b + 1), lighter: at(r, b + 2), dark: at(r, b - 1), speckle: 0.04, speckleColor: at(r, b - 1) };
  });
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cell, (i) => shades[i]!, r[0]!, seed);
  return p;
}

/** Gravel: a dense bed of small pebbles in warm and cool greys. */
export function gravel(seed = 118): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const k = C.COBBLE;
  const g = R.GRANITE;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, hash2(x, y, seed) < 0.5 ? k[2]! : g[3]!);
  const random = seeded(seed + 1);
  for (let n = 0; n < 520; n++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    const warm = random() < 0.45;
    const r = warm ? g : k;
    const b = 3 + Math.floor(random() * 2);
    pebble(p, x, y, r[b]!, r[b + 1]!, r[1]!, random() < 0.6);
  }
  return p;
}

// --- Coast ---------------------------------------------------------------------------------------------------------------

/** Sand: warm and pale, wind ripples running east-west, shells and a stray pebble. */
export function sand(r: Ramp = R.SAND, seed = 119): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      const wave = (y + Math.round(valueNoise(x, 0, 16, SIZE, seed + 2) * 4)) % 6;
      let c = n < 0.4 ? r[3]! : r[4]!;
      if (wave === 0) c = r[5]!;
      if (wave === 1) c = n < 0.4 ? r[2]! : r[3]!;
      if (hash2(x, y, seed) < 0.03) c = r[2]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, 0xfff4e8);
    p.set(x + 1, y, C.PINK[4]!);
    p.set(x, y + 1, r[1]!);
  }
  for (let k = 0; k < 8; k++) pebble(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), C.COBBLE[4]!, C.COBBLE[5]!, r[1]!, false);
  return p;
}

/** Wet sand at the tide's edge: darker, glassy, with the sky caught in it and lines of foam. */
export function wetSand(r: Ramp = R.WETSAND, seed = 120): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y * 2, 16, SIZE, seed);
      let c = n < 0.38 ? r[3]! : n < 0.7 ? r[4]! : r[5]!;
      if (hash2(x, y, seed) < 0.04) c = r[2]!;
      // The sky caught in the film of water: a pale glint here and there.
      if (valueNoise(x, y * 3, 8, SIZE, seed + 3) > 0.82 && hash2(x, y, seed + 1) < 0.5) c = R.SEA[6]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  // Worm casts and little shells.
  for (let k = 0; k < 10; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, r[1]!);
    p.set(x + 1, y, r[2]!);
    if (k % 3 === 0) p.set(x, y - 1, 0xfff4e8);
  }
  return p;
}

/** Shingle: a beach of rounded pebbles, grey, slate-blue and sandy. */
export function shingle(seed = 121): Pixmap {
  const points = jitteredPoints(SIZE, SIZE, 5, 4, 0.8, seed);
  const map = voronoi(SIZE, SIZE, points, 1.1, 1.3);
  const cell = cellAt(map, SIZE, SIZE);
  const random = seeded(seed + 1);
  const ramps = [C.COBBLE, R.GRANITE, C.COBBLE, R.SAND, R.GRANITE];
  const shades = points.map(() => {
    const r = ramps[Math.floor(random() * ramps.length)]!;
    const b = 3 + Math.floor(random() * 2);
    return { base: at(r, b), light: at(r, b + 1), lighter: at(r, b + 2), dark: at(r, b - 1), speckle: 0, speckleColor: at(r, b) };
  });
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cell, (i) => shades[i]!, R.SAND[2]!, seed);
  return p;
}

// --- Fire and ash ------------------------------------------------------------------------------------------------------

/** Ash: grey drifts, cinders, and the odd ember still glowing. */
export function ash(r: Ramp = R.ASH, seed = 122): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y * 1.4, 16, SIZE, seed);
      let c = n < 0.35 ? r[2]! : n < 0.6 ? r[3]! : r[4]!;
      if (hash2(x, y, seed) < 0.08) c = r[1]!;
      if (hash2(x, y, seed + 1) < 0.02) c = r[5]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 2);
  for (let k = 0; k < 30; k++) pebble(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), R.BASALT[3]!, R.BASALT[5]!, R.BASALT[0]!, random() < 0.5);
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, R.LAVA[4]!);
    p.set(x + 1, y, R.LAVA[2]!);
  }
  return p;
}

/** Basalt: black flows in plates, cracked, the cracks glowing a dull red deep down. */
export function basalt(r: Ramp = R.BASALT, seed = 123, glowing = true): Pixmap {
  const points = jitteredPoints(SIZE, SIZE, 13, 11, 0.6, seed);
  const map = voronoi(SIZE, SIZE, points, 1.0);
  const cell = cellAt(map, SIZE, SIZE);
  const random = seeded(seed + 1);
  const shades = points.map(() => {
    const b = 2 + Math.floor(random() * 3);
    return { base: at(r, b), light: at(r, b + 2), lighter: at(r, b + 3), dark: at(r, b - 1), speckle: 0.05, speckleColor: at(r, b + 1) };
  });
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cell, (i) => shades[i]!, glowing ? R.LAVA[1]! : r[0]!, seed);
  if (glowing) for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (cell(x, y) < 0 && hash2(x, y, seed) < 0.18) p.set(x, y, R.LAVA[2]!);
  return p;
}

/** Lava: molten rock, bright in its channels, a darker crust drifting on it. Painted to glow. */
export function lava(r: Ramp = R.LAVA, seed = 124): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      const v = fbm(x, y, 8, SIZE, seed + 3);
      let c = n < 0.32 ? r[1]! : n < 0.45 ? r[2]! : n < 0.62 ? r[3]! : n < 0.76 ? r[4]! : r[5]!;
      if (v > 0.7 && n > 0.45) c = r[6]!;
      if (hash2(x, y, seed) < 0.03) c = r[Math.max(1, n < 0.45 ? 2 : 4)]!;
      p.set(x, y, c);
    }
  }
  return p;
}

// --- The waste --------------------------------------------------------------------------------------------------------

/** The desolate waste: bleached earth cracked into plates, dust in the cracks, a bone or two. */
export function waste(r: Ramp = R.WASTE, seed = 125): Pixmap {
  const points = jitteredPoints(SIZE, SIZE, 10, 9, 0.8, seed);
  const map = voronoi(SIZE, SIZE, points, 0.8);
  const cell = cellAt(map, SIZE, SIZE);
  const random = seeded(seed + 1);
  const shades = points.map(() => {
    const b = 4 + Math.floor(random() * 2);
    // Flat plates: only the cracks between them and a curled lip on their far side show.
    return { base: at(r, b), light: at(r, b), lighter: at(r, b + 1), dark: at(r, b - 1), speckle: 0.06, speckleColor: at(r, b - 1) };
  });
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cell, (i) => shades[i]!, r[2]!, seed);
  const bone = C.BONE;
  for (let k = 0; k < 2; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, bone[5]!);
    p.set(x + 1, y, bone[4]!);
    p.set(x + 2, y, bone[4]!);
    p.set(x + 3, y, bone[5]!);
    p.set(x + 1, y + 1, bone[2]!);
    p.set(x + 2, y + 1, bone[2]!);
  }
  return p;
}

/** A salt flat: white crust in polygons with raised rims, grey hollows. */
export function saltFlat(r: Ramp = R.SALT, seed = 126): Pixmap {
  const points = jitteredPoints(SIZE, SIZE, 14, 12, 0.7, seed);
  const map = voronoi(SIZE, SIZE, points, 1.3);
  const cell = cellAt(map, SIZE, SIZE);
  const random = seeded(seed + 1);
  const shades = points.map(() => {
    const b = 3 + Math.floor(random() * 2);
    // Flat crust, its ridged rims white along the cracks.
    return { base: at(r, b), light: at(r, b), lighter: at(r, b), dark: at(r, b - 1), speckle: 0.08, speckleColor: at(r, b + 1) };
  });
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cell, (i) => shades[i]!, r[5]!, seed);
  return p;
}

// --- Phyrexia ------------------------------------------------------------------------------------------------------------

/** Phyrexian plating: riveted plates of cold metal, oil weeping from the seams, sinew cables between. */
export function plating(r: Ramp = R.PHYREXIAN, seed = 127): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const random = seeded(seed);
  // Plates: a grid of 16 by 16, every other row shifted, some split.
  const plate = (x: number, y: number) => {
    const row = Math.floor(y / 16);
    const sx = x + (row % 2) * 8;
    return row * 8 + Math.floor((((sx % SIZE) + SIZE) % SIZE) / 16);
  };
  const tones = Array.from({ length: 40 }, () => 3 + Math.floor(random() * 2));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const id = plate(x, y);
      const t = tones[id % tones.length]!;
      const up = plate(x, y - 1) !== id;
      const left = plate(x - 1, y) !== id;
      const down = plate(x, y + 1) !== id;
      const right = plate(x + 1, y) !== id;
      let c = r[t]!;
      if (down || right) c = r[1]!;
      else if (up || left) c = r[t + 1]!;
      else if (hash2(x, y, seed) < 0.05) c = r[t - 1]!;
      p.set(x, y, c);
    }
  }
  // Rivets in each plate's corners.
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x0 = col * 16 - (row % 2) * 8;
      const y0 = row * 16;
      for (const [dx, dy] of [
        [2, 2],
        [13, 2],
        [2, 13],
        [13, 13],
      ] as const) {
        p.set(x0 + dx, y0 + dy, r[6]!);
        p.set(x0 + dx + 1, y0 + dy + 1, r[0]!);
      }
    }
  }
  // Oil weeping down from seams, and a sinew cable or two.
  const o = R.OIL;
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * 4) * 16 + 15;
    const len = 3 + Math.floor(random() * 7);
    for (let i = 0; i < len; i++) {
      p.set(x, y + i, o[i === len - 1 ? 3 : 1]!);
      if (i < len - 2) p.set(x + 1, y + i, o[2]!);
    }
    p.set(x, y + 1, o[5]!);
  }
  const s = R.SINEW;
  for (let k = 0; k < 2; k++) {
    let x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    for (let i = 0; i < 24; i++, x++) {
      const yy = y + Math.round(Math.sin(i / 3) * 1.5);
      p.set(x, yy, s[3]!);
      p.set(x, yy - 1, s[5]!);
      p.set(x, yy + 1, s[1]!);
    }
  }
  return p;
}

/** Phyrexian ground: the waste gone wrong - ash and dark earth slick with glistening oil, shards of metal, sinew. */
export function phyrexianGround(seed = 128): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const o = R.OIL;
  const a = R.ASH;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      const sheen = valueNoise(x, y, 8, SIZE, seed + 3);
      let c = n < 0.42 ? o[2]! : n < 0.5 ? o[3]! : n < 0.72 ? a[2]! : a[3]!;
      if (n < 0.42 && sheen > 0.66) c = o[5]!;
      if (n < 0.42 && sheen > 0.74) c = o[6]!;
      if (n >= 0.5 && hash2(x, y, seed) < 0.08) c = a[1]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  const m = R.PHYREXIAN;
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    // A shard: a sliver of metal, lit along its top edge.
    for (let i = 0; i < 4; i++) {
      p.set(x + i, y - (i >> 1), m[5]!);
      p.set(x + i, y + 1 - (i >> 1), m[2]!);
    }
  }
  const s = R.SINEW;
  for (let k = 0; k < 5; k++) {
    let x = Math.floor(random() * SIZE);
    let y = Math.floor(random() * SIZE);
    for (let i = 0; i < 9; i++) {
      p.set(x, y, s[3]!);
      p.set(x, y - 1, s[4]!);
      x++;
      if (random() < 0.4) y += random() < 0.5 ? 1 : -1;
    }
  }
  return p;
}

/** Oil: a black glistening pool, its sheen in slow bands (the renderer slides it). */
export function oilPool(r: Ramp = R.OIL, seed = 129): Pixmap {
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = fbm(x, y * 2, 8, 32, seed);
      let c = n < 0.45 ? r[1]! : n < 0.6 ? r[2]! : r[3]!;
      const v = valueNoise(x + y, y, 8, 32, seed + 2);
      if (v > 0.72) c = r[5]!;
      if (v > 0.8) c = r[6]!;
      p.set(x, y, c);
    }
  }
  return p;
}

// --- Water ---------------------------------------------------------------------------------------------------------------

/** Water from a ramp: the slice's stream (textures.ts, water) for any water - the sea, a lake, a bog. */
export function waterOf(r: Ramp, seed = 130, size = 32): Pixmap {
  const p = new Pixmap(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x, y * 2, 8, size, seed);
      p.set(x, y, n < 0.42 ? r[2]! : r[3]!);
    }
  }
  const random = seeded(seed);
  for (let k = 0; k < (size * size) / 56; k++) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const len = 2 + Math.floor(random() * 4);
    for (let i = 0; i < len; i++) p.set(x + i, y, r[4]!);
    p.set(x + 1, y - 1, r[5]!);
    if (random() < 0.3) p.set(x + len, y - 1, r[6]!);
  }
  return p;
}

/** The sea seen from above, 64 square: deep and still where nothing draws over it (a hole's own picture). */
export function seaPicture(r: Ramp = R.SEA, seed = 131): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const tile = waterOf(r, seed, 32);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, tile.get(x, y));
  return p;
}

/** A ford: shallow water over a bed of pebbles, its ripples catching the light; walked through. */
export function ford(seed = 132): Pixmap {
  const p = shingle(seed);
  const w = C.WATER;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = p.get(x, y);
      // The water over it: each texel pulled toward the stream's blue, the stones still showing.
      const r = (c >> 16) & 0xff;
      const g = (c >> 8) & 0xff;
      const b = c & 0xff;
      const wc = w[3]!;
      const mix = (a: number, bb: number) => Math.round(a * 0.45 + bb * 0.55);
      p.set(x, y, (mix(r, (wc >> 16) & 0xff) << 16) | (mix(g, (wc >> 8) & 0xff) << 8) | mix(b, wc & 0xff));
    }
  }
  const random = seeded(seed + 1);
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    for (let i = 0; i < 4; i++) p.set(x + i, y, i === 1 ? 0xffffff : w[5]!);
  }
  return p;
}

// --- Roads ---------------------------------------------------------------------------------------------------------------

/** A cart track: packed dirt, rutted and hoof-printed, pebbles, darker hollows. */
export function cartTrack(seed = 133): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const d = C.DIRT;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.3 ? d[2]! : n < 0.66 ? d[3]! : d[4]!;
      if (hash2(x, y, seed) < 0.06) c = d[2]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  // Hoofprints: little dark crescents.
  for (let k = 0; k < 24; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, d[1]!);
    p.set(x + 1, y, d[1]!);
    p.set(x - 1, y - 1, d[1]!);
    p.set(x + 2, y - 1, d[1]!);
    p.set(x, y + 1, d[5]!);
  }
  // Ruts' darker hollows (no standing water: it repeats every four tiles too plainly on a long road).
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (fbm(x, y, 16, SIZE, seed + 5) < 0.24 && hash2(x, y, seed + 9) < 0.5) p.set(x, y, d[2]!);
  for (let k = 0; k < 20; k++) pebble(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), d[4]!, d[5]!, d[1]!, random() < 0.5);
  return p;
}

/** Setts: squared stone blocks in straight courses, a town's dressed street (Tolaria's, the Vess estate's). */
export function setts(r: Ramp = C.COBBLE, seed = 134): Pixmap {
  const random = seeded(seed);
  const ids = new Int16Array(SIZE * SIZE).fill(-1);
  const shades: { base: Rgb; light: Rgb; lighter: Rgb; dark: Rgb; speckle: number; speckleColor: Rgb }[] = [];
  let id = 0;
  const course = 8;
  for (let row = 0; row < SIZE / course; row++) {
    let x = (row % 2) * 5;
    const start = x;
    while (x < start + SIZE) {
      const w = Math.min(start + SIZE - x, 8 + Math.floor(random() * 3) * 2);
      const b = 3 + Math.floor(random() * 3);
      shades.push({ base: at(r, b), light: at(r, b + 1), lighter: at(r, b + 2), dark: at(r, b - 1), speckle: 0.05, speckleColor: at(r, b - 1) });
      for (let j = 1; j < course; j++) for (let i = 1; i < w; i++) ids[(row * course + j) * SIZE + ((x + i) % SIZE)] = id;
      id++;
      x += w;
    }
  }
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cellAt(ids, SIZE, SIZE), (i) => shades[i]!, r[1]!, seed);
  return p;
}

/** Marble paving: big white slabs veined blue, laid square with a dark joint (Tolaria). */
export function marblePaving(r: Ramp = R.MARBLE, seed = 135): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const random = seeded(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const slab = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
      const fx = x % 32;
      const fy = y % 32;
      let c = slab ? r[5]! : r[4]!;
      const vein = Math.abs(valueNoise(x * 0.6 + y * 0.8, y, 16, SIZE, seed + slab) - 0.5) < 0.025;
      if (vein) c = r[2]!;
      if (fx === 0 || fy === 0) c = r[1]!;
      else if (fx === 1 || fy === 1) c = r[6]!;
      else if (fx === 31 || fy === 31) c = r[3]!;
      p.set(x, y, c);
    }
  }
  // An inlaid diamond of azure at the slabs' meeting.
  for (const [cx, cy] of [
    [0, 0],
    [32, 32],
    [0, 32],
    [32, 0],
  ] as const) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2 + Math.abs(dy); dx <= 2 - Math.abs(dy); dx++) p.set(cx + dx, cy + dy, dy < 0 ? C.BLUE[4]! : C.BLUE[3]!);
  }
  for (let k = 0; k < 3; k++) crack(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), 4, r[3]!, random);
  return p;
}

/** A muddy track: dark wet mud churned by feet and wheels, puddles and straw thrown down. */
export function mudTrack(seed = 136): Pixmap {
  const p = swampMud(R.MUD, seed);
  const random = seeded(seed + 3);
  const s = C.STRAW;
  for (let k = 0; k < 24; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    for (let i = 0; i < 3; i++) p.set(x + i, y + (i === 2 ? 1 : 0), i === 0 ? s[2]! : s[1]!);
  }
  return p;
}

/** Packed snow: a trodden track, grey-blue, footprints and slush. */
export function snowTrack(seed = 137): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const s = R.SNOW;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.4 ? s[2]! : n < 0.7 ? s[3]! : s[4]!;
      if (hash2(x, y, seed) < 0.05) c = s[1]!;
      if (fbm(x, y, 8, SIZE, seed + 2) < 0.22) c = R.MUD[4]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  for (let k = 0; k < 26; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    p.set(x, y, s[1]!);
    p.set(x, y + 1, s[1]!);
    p.set(x + 1, y, s[2]!);
    p.set(x, y - 1, s[5]!);
  }
  return p;
}

/** A boardwalk of planks laid across its way: `along` "x" runs the planks north-south (a walk going east-west). */
export function boardwalk(along: "x" | "z", r: Ramp = R.WEATHERED, seed = 138): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const random = seeded(seed);
  const plank = 4;
  const gap = R.MUD;
  for (let k = 0; k < SIZE / plank; k++) {
    const tone = random();
    const base = tone < 0.3 ? 3 : tone < 0.8 ? 4 : 5;
    const missing = random() < 0.04;
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < plank; j++) {
        let c = at(r, base);
        if (j === 0) c = at(r, base + 1);
        if (j === plank - 1) c = gap[1]!;
        if (hash2(i, k, seed) < 0.06) c = at(r, base - 1);
        if (missing) c = j === 0 ? gap[3]! : gap[2]!;
        const [x, y] = along === "x" ? [k * plank + j, i] : [i, k * plank + j];
        p.set(x, y, c);
      }
    }
    // Nails where the planks cross the joists, every 16.
    if (!missing) {
      for (let i = 2; i < SIZE; i += 16) {
        const [x, y] = along === "x" ? [k * plank + 1, i] : [i, k * plank + 1];
        p.set(x, y, R.WEATHERED[6]!);
      }
    }
  }
  return p;
}

// --- Banks ---------------------------------------------------------------------------------------------------------------

/**
 * A bank's face where the ground steps down, 32 square, its top row the ground's edge: strata of a ramp, stones or roots
 * in them, and a fringe of what grows on top (`fringe`, none for bare stone). Tiled up and along the bank.
 */
export function bank(r: Ramp, kind: "earth" | "rock" | "peat" | "ice" | "sand" | "basalt" | "masonry" | "metal", fringe: Ramp | null, seed = 140): Pixmap {
  const p = new Pixmap(32, 32);
  const random = seeded(seed);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const band = Math.floor((y + Math.round(valueNoise(x, 0, 8, 32, seed) * 3)) / (kind === "rock" || kind === "basalt" ? 6 : 4));
      let c = at(r, 2 + (band % 3));
      if (kind === "basalt" && x % 6 === 0) c = r[1]!;
      if (kind === "masonry") c = (y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 6) % 12 === 0) ? r[1]! : at(r, 3 + (hash2(Math.floor(x / 12), Math.floor(y / 8), seed) < 0.5 ? 0 : 1));
      if (kind === "metal") c = x % 8 === 0 ? r[1]! : x % 8 === 1 ? r[5]! : y % 10 === 0 ? r[2]! : r[3]!;
      if (kind === "ice" && hash2(x, y, seed) < 0.05) c = r[6]!;
      if ((kind === "earth" || kind === "peat") && hash2(x, y, seed) < 0.06) c = r[1]!;
      p.set(x, y, c);
    }
  }
  if (kind === "earth" || kind === "sand" || kind === "rock") for (let k = 0; k < 8; k++) pebble(p, Math.floor(random() * 32), 4 + Math.floor(random() * 26), C.COBBLE[4]!, C.COBBLE[5]!, r[0]!, random() < 0.5);
  if (kind === "earth" || kind === "peat") {
    // Roots hanging down the face.
    for (let k = 0; k < 4; k++) {
      let x = Math.floor(random() * 32);
      for (let y = 3; y < 10 + random() * 10; y++) {
        p.set(x, y, r[1]!);
        if (random() < 0.3) x += random() < 0.5 ? 1 : -1;
      }
    }
  }
  if (kind === "rock" || kind === "basalt") for (let k = 0; k < 4; k++) crack(p, Math.floor(random() * 32), Math.floor(random() * 32), 5, r[0]!, random);
  if (fringe) {
    // The ground's edge: a lip of what grows on top, ragged, hanging over the face.
    for (let x = 0; x < 32; x++) {
      const h = 2 + Math.floor(hash2(x, 1, seed) * 3);
      for (let y = 0; y < h; y++) p.set(x, y, y === h - 1 ? fringe[1]! : y === 0 ? fringe[Math.min(fringe.length - 1, 4)]! : fringe[3]!);
    }
  }
  return p;
}

/** A packed gravel road: grey-brown grit rolled flat, a pebble here and there. */
export function roadGravel(seed = 142): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  const d = C.DIRT;
  const g = R.GRANITE;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.4 ? g[3]! : n < 0.66 ? d[3]! : g[4]!;
      const h = hash2(x, y, seed);
      if (h < 0.12) c = g[2]!;
      else if (h > 0.9) c = g[5]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  for (let k = 0; k < 40; k++) pebble(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), g[4]!, g[6]!, g[1]!, random() < 0.5);
  return p;
}

/** The bed of shallow water: sand and pebbles seen through a film of pale water (the shallows' `under`). */
export function shallowsBed(seed = 143): Pixmap {
  const p = sand(R.SAND, seed);
  const w = 0x4ea2bc;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = p.get(x, y);
      const mix = (s: number) => Math.round(((c >> s) & 0xff) * 0.5 + ((w >> s) & 0xff) * 0.5);
      p.set(x, y, (mix(16) << 16) | (mix(8) << 8) | mix(0));
    }
  }
  const random = seeded(seed + 1);
  for (let k = 0; k < 16; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    for (let i = 0; i < 4; i++) p.set(x + i, y, i === 1 ? 0xffffff : 0xa6dce6);
  }
  return p;
}

// --- The travel map's open country: desert, badlands, uplands, jungle ----------------------------------------------------

/**
 * Dunes: desert sand in long swells, each lit on its windward slope and shaded in its lee, ripples curving across them
 * and wind-blown streaks; no shells, no pebbles (that is the beach's sand).
 */
export function dunes(r: Ramp = R.DUNE, seed = 144): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  // The swells: a long wave across x (whole periods across the picture, so it tiles), bent by noise.
  const swell = (x: number, y: number) => {
    const bend = (valueNoise(x, y, 32, SIZE, seed) - 0.5) * 14 + Math.sin((2 * Math.PI * x) / SIZE) * 5;
    return (((y + bend) / 32) % 1 + 1) % 1;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const s = swell(x, y);
      // Windward (rising toward the crest) lit, the lee beyond the crest in shade.
      let c = s < 0.5 ? r[4]! : s < 0.62 ? r[5]! : s < 0.7 ? r[3]! : s < 0.88 ? r[3]! : r[4]!;
      if (s >= 0.6 && s < 0.64) c = r[6]!;
      if (s >= 0.66 && s < 0.74 && hash2(x, y, seed) < 0.5) c = r[2]!;
      // Ripples: thin curving lines a few texels apart on the slopes.
      const ripple = (y + Math.round(Math.sin((2 * Math.PI * x) / 32 + y / 9) * 2 + valueNoise(x, 0, 16, SIZE, seed + 2) * 3)) % 4;
      if (ripple === 0 && s < 0.58) c = r[3]!;
      if (hash2(x, y, seed + 1) < 0.02) c = r[s < 0.6 ? 5 : 2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/**
 * Badlands: dry red earth cracked into broad plates, dark gullies wandering through it, red stones and a dry, grey-gold
 * tuft or two.
 */
export function badlands(r: Ramp = R.BADLANDS, seed = 145): Pixmap {
  const points = jitteredPoints(SIZE, SIZE, 14, 12, 0.85, seed);
  const map = voronoi(SIZE, SIZE, points, 0.7);
  const cell = cellAt(map, SIZE, SIZE);
  const random = seeded(seed + 1);
  const shades = points.map(() => {
    const b = 3 + Math.floor(random() * 3);
    return { base: at(r, b), light: at(r, b + 1), lighter: at(r, b + 1), dark: at(r, b - 1), speckle: 0.07, speckleColor: at(r, b - 1) };
  });
  const p = new Pixmap(SIZE, SIZE);
  paintCells(p, cell, (i) => shades[i]!, r[1]!, seed);
  // Dust drifts: soft patches a step paler over the plates.
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (cell(x, y) >= 0 && fbm(x, y, 16, SIZE, seed + 5) > 0.68) p.set(x, y, at(r, 5));
  // Gullies: dark meanders with a lit lip on their far side.
  for (let k = 0; k < 3; k++) {
    let x = Math.floor(random() * SIZE);
    let y = Math.floor(random() * SIZE);
    for (let i = 0; i < 26; i++) {
      p.set(x, y, r[0]!);
      p.set(x, y + 1, r[2]!);
      p.set(x, y - 1, r[5]!);
      x += 1;
      if (random() < 0.4) y += random() < 0.5 ? 1 : -1;
    }
  }
  for (let k = 0; k < 14; k++) pebble(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), R.REDROCK[4]!, R.REDROCK[6]!, r[0]!, random() < 0.5);
  for (let k = 0; k < 5; k++) tuft(p, Math.floor(random() * SIZE), Math.floor(random() * SIZE), R.PLAINS[2]!, R.PLAINS[4]!, R.PLAINS[6]!);
  return p;
}

/**
 * Highland: rough upland grass in olive and tawny patches, clumps of heather in violet, and grey stones breaking
 * through the turf.
 */
export function highland(r: Ramp = R.HIGHLAND, heather: Ramp = R.HEATHER, seed = 146): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y * 1.3, 16, SIZE, seed);
      let c = n < 0.34 ? r[2]! : n < 0.58 ? r[3]! : n < 0.76 ? r[4]! : r[5]!;
      if (hash2(x, y, seed) < 0.07) c = r[1]!;
      // Heather: clumps where a second noise runs high, dark at their roots and lit on top.
      const h = fbm(x, y, 8, SIZE, seed + 3);
      if (h > 0.68) c = h > 0.74 ? (hash2(x, y, seed + 4) < 0.4 ? heather[5]! : heather[4]!) : hash2(x, y, seed + 5) < 0.5 ? heather[2]! : heather[3]!;
      p.set(x, y, c);
    }
  }
  tufts(p, r, seed, 0.5, 1, 6);
  const random = seeded(seed + 6);
  // Stones breaking through: small grey lumps, lit on top, a shadow under.
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    const g = R.GRANITE;
    p.set(x, y, g[5]!);
    p.set(x + 1, y, g[4]!);
    p.set(x + 2, y, g[4]!);
    p.set(x, y + 1, g[3]!);
    p.set(x + 1, y + 1, g[3]!);
    p.set(x + 2, y + 1, g[2]!);
    p.set(x + 1, y + 2, r[0]!);
  }
  return p;
}

/**
 * The jungle's floor: black-brown loam under broad fallen leaves, fern fronds and roots, a red flower here and there.
 */
export function jungleFloor(soil: Ramp = R.JUNGLE_SOIL, leaf: Ramp = R.LUSH, seed = 147): Pixmap {
  const p = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = fbm(x, y, 16, SIZE, seed);
      let c = n < 0.4 ? soil[2]! : n < 0.66 ? soil[3]! : soil[4]!;
      if (hash2(x, y, seed) < 0.06) c = soil[1]!;
      // Low green growth over half of it.
      const g = fbm(x, y, 16, SIZE, seed + 9);
      if (g > 0.55) c = g > 0.68 ? leaf[3]! : leaf[2]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  // Broad leaves: lozenges six texels long, a lit edge and a midrib.
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(random() * SIZE);
    const y = Math.floor(random() * SIZE);
    const t = 2 + Math.floor(random() * 3);
    for (let i = 0; i < 6; i++) {
      const half = i === 0 || i === 5 ? 0 : i === 1 || i === 4 ? 1 : 2;
      for (let j = -half; j <= half; j++) p.set(x + i, y + j, j < 0 ? at(leaf, t + 2) : j === 0 ? at(leaf, t - 1) : at(leaf, t));
    }
  }
  // Roots: dark walks with a lit edge above.
  for (let k = 0; k < 3; k++) {
    let x = Math.floor(random() * SIZE);
    let y = Math.floor(random() * SIZE);
    for (let i = 0; i < 12; i++) {
      p.set(x, y, soil[0]!);
      p.set(x, y - 1, soil[5]!);
      x += 1;
      if (random() < 0.35) y += random() < 0.5 ? 1 : -1;
    }
  }
  flowers(p, 5, seed, [[0xe85a48, 0xf8d04c], [0xfcb0c8, 0xf8d04c]], soil[1]!);
  return p;
}
