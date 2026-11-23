import * as C from "../paint/colors";
import type { Ramp } from "../paint/palette";
import { Pixmap, type Rgb, hash2, rgb, seeded } from "../paint/pixmap";
import { cellAt, crack, fbm, jitteredPoints, paintCells, valueNoise, voronoi } from "../paint/procedural";

// The rooms' own paint: the regional floors and walls (seamless tiles, 64 texels square = four tiles, or 16 and 32 to
// tile along a wall) and the pictures their furniture is painted with. Ramps run dark to light as everywhere else.

const ramp = (...hex: string[]): Ramp => hex.map(rgb);

/** Llanowar's living wood: honeyed boards with a green cast. */
export const ELFWOOD = ramp("#1e1a14", "#33301c", "#4e4824", "#6c642e", "#8e823a", "#b0a24c", "#d4c46a");
/** The Morass: boards black with damp, grey-green where they are worn. */
export const BOGWOOD = ramp("#0e0e12", "#18191c", "#232622", "#30352a", "#3f4632", "#55603e", "#6e7a4c");
/** Keld: cold dark stone, a little blue. */
export const KELD_STONE = ramp("#16161e", "#24242e", "#34343e", "#46464e", "#5a5a62", "#72727a", "#90909a");
/** Tolaria: clean white and pale blue stone. */
export const TOLARIAN = ramp("#3a4a6a", "#5a6e94", "#8296b8", "#a8bad4", "#c8d6e8", "#e4ecf6", "#f8fbff");
/** The Vess estate: wine-dark damask and old gold. */
export const VESS_RED = ramp("#1a0a12", "#2e0e1c", "#461428", "#621c34", "#7e2840", "#9a3a50");
/** A temple's marble: warm white veined with grey. */
export const MARBLE = ramp("#4a4650", "#6e6a74", "#96929a", "#bcb8bc", "#dcd8d6", "#f0ece6", "#fffcf6");
/** Arcane violet and teal, for planar curios and mages' rooms. */
export const ARCANE = ramp("#120a24", "#241040", "#3c1a66", "#5a2a92", "#7e44c0", "#a46ee0", "#d0a8f8");
export const ARCANE_TEAL = ramp("#06201e", "#0c3a36", "#14584e", "#1e7c6a", "#30a488", "#5ccaa8", "#a0ecd0");

// --- Floors ----------------------------------------------------------------------------------------------------------------

/** Boards running east-west from a wood ramp (seven colors): the slice's floorboards, in another wood. */
export function planks(r: Ramp, seed = 5, plank = 4): Pixmap {
  const size = 64;
  const p = new Pixmap(size, size);
  const random = seeded(seed);
  for (let row = 0; row < size / plank; row++) {
    let x = Math.floor(random() * 32);
    const start = x;
    while (x < start + size) {
      const len = 16 + Math.floor(random() * 4) * 8;
      const tone = random();
      const base = tone < 0.3 ? r[3]! : tone < 0.8 ? r[4]! : r[5]!;
      const grain = tone < 0.3 ? r[2]! : r[3]!;
      const light = tone < 0.3 ? r[4]! : r[5]!;
      for (let i = 0; i < len; i++) {
        for (let j = 0; j < plank; j++) {
          let c = base;
          if (j === 0 && (i + row) % 3 !== 0) c = light;
          if (j === plank - 1) c = r[2]!;
          if (i === 0) c = r[1]!;
          p.set(x + i, row * plank + j, c);
        }
      }
      for (let g = 0; g < len / 6; g++) {
        const gx = x + 2 + Math.floor(random() * (len - 4));
        const gy = row * plank + 1 + Math.floor(random() * (plank - 2));
        const gl = 2 + Math.floor(random() * 4);
        for (let i = 0; i < gl; i++) if (gx + i < x + len) p.set(gx + i, gy, grain);
      }
      p.set(x + 2, row * plank + 1, r[6]!);
      x += len;
    }
  }
  return p;
}

/** Llanowar's floor: living boards, with moss creeping into their seams. */
export function elfFloor(seed = 41): Pixmap {
  const p = planks(ELFWOOD, seed, 5);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (fbm(x, y, 16, 64, seed + 1) > 0.68 && hash2(x, y, seed) < 0.5) p.set(x, y, hash2(x, y, seed + 2) < 0.5 ? C.LEAF[3]! : C.LEAF[4]!);
    }
  }
  return p;
}

/** The Morass's floor: black boards, mud in the gaps, a puddle's sheen. */
export function bogFloor(seed = 42): Pixmap {
  const p = planks(BOGWOOD, seed, 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const n = fbm(x, y, 16, 64, seed + 3);
      if (n > 0.74) p.set(x, y, hash2(x, y, seed) < 0.2 ? BOGWOOD[6]! : BOGWOOD[2]!);
    }
  }
  return p;
}

/** Tolarian mosaic: small white tiles with a blue diamond every two tiles, gold at the points. */
export function mosaic(seed = 43): Pixmap {
  const p = new Pixmap(64, 64);
  const t = TOLARIAN;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const tx = x % 4;
      const ty = y % 4;
      let c = hash2(x >> 2, y >> 2, seed) < 0.3 ? t[4]! : t[5]!;
      if (tx === 3 || ty === 3) c = t[3]!;
      // The diamond: |dx| + |dy| small about the middle of each 32-texel block.
      const dx = Math.abs((x % 32) - 15.5);
      const dy = Math.abs((y % 32) - 15.5);
      const d = dx + dy;
      if (d < 13 && d > 10) c = C.BLUE[3]!;
      else if (d <= 10 && d > 8) c = C.BLUE[4]!;
      else if (d <= 3) c = C.GOLD[4]!;
      if (d < 13 && (tx === 3 || ty === 3)) c = C.BLUE[2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Parquet: herringbone blocks of a wood ramp (the Vess estate's halls), polished. */
export function parquet(r: Ramp = C.WOOD, seed = 44): Pixmap {
  const p = new Pixmap(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      // Blocks 16 by 4, alternating direction in a herringbone of period 16.
      const u = (x + y) % 16;
      const v = (x - y + 64) % 16;
      const along = Math.floor((x + y) / 4) % 2 === 0;
      const k = along ? u : v;
      const block = along ? Math.floor((x - y + 64) / 16) * 7 + Math.floor((x + y) / 4) : Math.floor((x + y) / 16) * 5 + Math.floor((x - y + 64) / 4);
      const tone = hash2(block, 3, seed);
      let c = tone < 0.3 ? r[3]! : tone < 0.75 ? r[4]! : r[5]!;
      if (k === 0) c = r[1]!;
      else if (k === 1) c = tone < 0.5 ? r[5]! : r[6]!;
      else if (valueNoise(x * 2, y, 8, 64, seed + block) < 0.3) c = r[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Marble slabs, a tile each, laid in two tones as a checker, veined, with thin joints. */
export function marble(r: Ramp = MARBLE, seed = 45, dark?: Ramp): Pixmap {
  const p = new Pixmap(64, 64);
  const other = dark ?? r;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const odd = ((x >> 4) + (y >> 4)) % 2 === 1;
      const m = odd ? other : r;
      const vein = Math.abs(fbm(x, y, 16, 64, seed) - 0.5);
      let c = odd && dark ? m[3]! : m[4]!;
      if (vein < 0.03) c = m[2]!;
      else if (vein < 0.06) c = m[3]!;
      else if (hash2(x, y, seed) < 0.03) c = m[5]!;
      if (x % 16 === 15 || y % 16 === 15) c = m[1]!;
      if (x % 16 === 0 || y % 16 === 0) c = m[5]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Rough stones set in a floor or a wall: Keldon rubble. */
export function rubbleStone(r: Ramp = KELD_STONE, seed = 46, step = 11): Pixmap {
  const size = 64;
  const points = jitteredPoints(size, size, step, step * 0.8, 0.45, seed);
  const ids = voronoi(size, size, points, 1.2);
  const at = cellAt(ids, size, size);
  const p = new Pixmap(size, size);
  const random = seeded(seed);
  paintCells(
    p,
    at,
    (i) => {
      const b = hash2(i, 1, seed);
      const base = b < 0.3 ? 3 : b < 0.8 ? 4 : 5;
      return { base: r[base]!, light: r[Math.min(r.length - 1, base + 1)]!, dark: r[base - 1]!, speckle: 0.06, speckleColor: r[base - 1]! };
    },
    r[1]!,
    seed,
  );
  for (let k = 0; k < 5; k++) crack(p, Math.floor(random() * size), Math.floor(random() * size), 3, r[2]!, random);
  return p;
}

// --- Walls -----------------------------------------------------------------------------------------------------------------

/** Wainscot from a wood ramp: upright boards under a rail, 16 by 16. */
export function wainscotOf(w: Ramp): Pixmap {
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = x % 4 === 0 ? w[2]! : x % 4 === 1 ? w[5]! : w[4]!;
      if (y === 0) c = w[6]!;
      if (y === 1) c = w[5]!;
      if (y === 2) c = w[2]!;
      if (y === 15) c = w[1]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Living wood grown into a wall: grain running up, knots, and moss in the hollows (Llanowar). 32 by 64. */
export function livingWood(seed = 47): Pixmap {
  const r = ELFWOOD;
  const p = new Pixmap(32, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 32; x++) {
      const n = valueNoise(x * 2, y, 8, 64, seed) * 0.7 + valueNoise(x, y, 4, 32, seed + 1) * 0.3;
      let c = n < 0.35 ? r[2]! : n < 0.55 ? r[3]! : n < 0.75 ? r[4]! : r[5]!;
      if (x % 11 === 0 && hash2(x, y >> 3, seed) < 0.7) c = r[1]!;
      if (fbm(x, y, 8, 32, seed + 5) > 0.72) c = hash2(x, y, seed) < 0.5 ? C.LEAF[3]! : C.LEAF[2]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed);
  for (let k = 0; k < 3; k++) {
    const kx = 3 + Math.floor(random() * 26);
    const ky = 4 + Math.floor(random() * 56);
    p.rect(kx - 1, ky - 2, 3, 5, r[2]!);
    p.set(kx, ky, r[0]!);
    p.set(kx, ky - 1, r[1]!);
    p.set(kx - 1, ky - 2, r[5]!);
  }
  return p;
}

/** Lashed bog-oak planks running up, dark, a reed binding across them (the Morass's stilt-houses). 32 by 32. */
export function lashedPlanks(seed = 48): Pixmap {
  const r = BOGWOOD;
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const plank = Math.floor(x / 5);
      const n = valueNoise(x * 4, y, 8, 32, seed + plank);
      let c = n < 0.4 ? r[2]! : n < 0.75 ? r[3]! : r[4]!;
      if (x % 5 === 4) c = r[0]!;
      if (x % 5 === 0) c = r[4]!;
      if (y === 10 || y === 11) c = y === 10 ? C.STRAW[2]! : C.STRAW[1]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Damask: wine-dark paper with a gold-thread motif in a diamond lattice (the Vess estate). 32 by 32. */
export function damask(r: Ramp = VESS_RED, seed = 49): Pixmap {
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      let c = hash2(x, y, seed) < 0.06 ? r[2]! : r[3]!;
      const dx = Math.abs(((x + 8) % 16) - 8);
      const dy = Math.abs(((y + 8) % 16) - 8);
      if (dx + dy === 7) c = r[4]!;
      // The motif: a small lily in each lattice cell.
      const mx = Math.abs((x % 16) - 7.5);
      const my = (y % 16) - 4;
      if ((mx < 1 && my >= 0 && my < 8) || (mx < 3 && mx >= 1 && my >= 2 && my < 5) || (mx < 2 && my === 8)) c = C.GOLD[2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A plain dressed-stone wall from a ramp: long blocks in even courses (the smithy, a temple). */
export function dressedStone(r: Ramp, seed = 50): Pixmap {
  const size = 64;
  const random = seeded(seed);
  const ids = new Int16Array(size * 48).fill(-1);
  let id = 0;
  for (let row = 0; row < 6; row++) {
    let x = Math.floor(random() * 16);
    const start = x;
    while (x < start + size) {
      const len = 12 + Math.floor(random() * 3) * 4;
      for (let j = 1; j < 8; j++) for (let i = 1; i < len; i++) ids[(row * 8 + j) * size + ((x + i) % size)] = id;
      id++;
      x += len;
    }
  }
  const p = new Pixmap(size, 48);
  paintCells(
    p,
    cellAt(ids, size, 48),
    (i) => {
      const b = hash2(i, 2, seed);
      const base = b < 0.25 ? 3 : b < 0.85 ? 4 : 5;
      return { base: r[base]!, light: r[Math.min(r.length - 1, base + 1)]!, dark: r[base - 1]!, speckle: 0.04, speckleColor: r[base - 1]! };
    },
    r[2]!,
    seed,
  );
  return p;
}

// --- Pictures ----------------------------------------------------------------------------------------------------------------

/** A stained-glass window, `w` by `h`, round-headed: panes in jewel colors between lead lines, a figure's halo. */
export function stainedGlass(seed = 1, w = 16, h = 32): Pixmap {
  const p = new Pixmap(w, h);
  p.fill(0, 0);
  const jewels = [C.BLUE[3]!, C.RED[3]!, C.GOLD[4]!, C.GREEN[3]!, C.PURPLE[4]!, C.BLUE[4]!, C.TEAL[4]!];
  const cx = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const head = y < w / 2 ? Math.hypot(x - cx, y - w / 2) <= w / 2 : true;
      if (!head) continue;
      const lead = x === 0 || x === w - 1 || y === 0 || (y < w / 2 && Math.hypot(x - cx, y - w / 2) > w / 2 - 1) || x % 5 === 2 || y % 6 === 3;
      const c = lead ? C.INK : jewels[Math.floor(hash2(Math.floor(x / 5), Math.floor(y / 6), seed) * jewels.length)]!;
      p.set(x, y, c);
    }
  }
  // A haloed figure up the middle.
  for (let y = 6; y < h - 4; y++) for (let x = Math.floor(cx) - 1; x <= Math.ceil(cx) + 1; x++) p.set(x, y, y < 11 ? C.GOLD[5]! : C.CLOTH_WHITE[3]!);
  for (let x = Math.floor(cx) - 2; x <= Math.ceil(cx) + 2; x++) p.set(x, 5, C.GOLD[4]!);
  return p;
}

/** A shelf of bottles behind a bar, 32 by 24: three shelves of bottles in greens, browns and reds, a cask's end. */
export function barShelf(seed = 3): Pixmap {
  const w = C.DARKWOOD;
  const p = new Pixmap(32, 24, w[2]!);
  const random = seeded(seed);
  const glass = [0x2e6a3a, 0x5a3a20, 0x7a2028, 0x3a5a7a, 0xb08a3a, 0x40703a];
  for (const shelf of [7, 15, 23]) {
    p.hline(0, shelf, 32, w[4]!);
    let x = 1;
    while (x < 30) {
      const g = glass[Math.floor(random() * glass.length)]!;
      const tall = 4 + Math.floor(random() * 3);
      p.rect(x, shelf - tall, 2, tall, g);
      p.set(x, shelf - tall - 1, w[0]!);
      p.set(x, shelf - tall + 1, 0xffffff);
      x += 3 + Math.floor(random() * 2);
    }
  }
  for (let y = 0; y < 24; y++) {
    p.set(0, y, w[1]!);
    p.set(31, y, w[1]!);
  }
  return p;
}

/** A keg's end, 12 by 12: staves round a tap. */
export function kegEnd(): Pixmap {
  const p = new Pixmap(12, 12);
  p.fill(0, 0);
  const w = C.WOOD;
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const d = Math.hypot(x - 5.5, y - 5.5);
      if (d > 6) continue;
      let c = x % 3 === 0 ? w[3]! : w[4]!;
      if (d > 4.8) c = C.IRON[2]!;
      p.set(x, y, c);
    }
  }
  p.rect(5, 7, 2, 3, C.GOLD[2]!);
  return p;
}

/** A quilt for a bed, 16 by 24: patches of a ramp and white, a turned-down sheet at the head. */
export function quilt(r: Ramp = C.RED, seed = 2): Pixmap {
  const p = new Pixmap(16, 24);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 16; x++) {
      let c = hash2(x >> 2, y >> 2, seed) < 0.5 ? r[3]! : hash2(x >> 2, y >> 2, seed + 1) < 0.5 ? r[2]! : C.CLOTH_WHITE[2]!;
      if (x % 4 === 0 || y % 4 === 0) c = r[1]!;
      if (y < 6) c = y === 5 ? C.CLOTH_WHITE[1]! : C.CLOTH_WHITE[3]!;
      p.set(x, y, c);
    }
  }
  // The pillow.
  p.rect(3, 1, 10, 3, C.CLOTH_WHITE[4]!);
  p.hline(3, 3, 10, C.CLOTH_WHITE[2]!);
  return p;
}

/** A quest board's face, 32 by 20: cork in a frame, notices pinned at angles with lines of writing. */
export function noticeBoard(seed = 4): Pixmap {
  const p = new Pixmap(32, 20, C.WOOD[3]!);
  const random = seeded(seed);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 32; x++) if (x === 0 || y === 0 || x === 31 || y === 19) p.set(x, y, C.DARKWOOD[2]!);
  for (let k = 0; k < 6; k++) {
    const x = 2 + Math.floor((k % 3) * 10 + random() * 3);
    const y = 2 + Math.floor(Math.floor(k / 3) * 8 + random() * 2);
    p.rect(x, y, 7, 7, k % 2 ? 0xf0e2bc : 0xe4d4a8);
    for (let l = 0; l < 3; l++) p.hline(x + 1, y + 2 + l * 2, 3 + Math.floor(random() * 3), 0x6a5040);
    p.set(x + 3, y, C.RED[3]!);
  }
  return p;
}

/** A forge's mouth, 24 by 16: an arch of firebrick round glowing coals. */
export function forgeMouth(): Pixmap {
  const p = new Pixmap(24, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 24; x++) {
      const inArch = y > 5 ? x > 3 && x < 20 : Math.hypot(x - 11.5, y - 6) < 8;
      if (!inArch) {
        p.set(x, y, (x + (y >> 2) * 2) % 6 === 0 || y % 4 === 0 ? C.RED[0]! : C.RED[1]!);
        continue;
      }
      const heat = y / 16 + hash2(x, y, 3) * 0.3;
      p.set(x, y, heat > 0.95 ? C.FIRE[4]! : heat > 0.75 ? C.FIRE[3]! : heat > 0.55 ? C.FIRE[2]! : heat > 0.35 ? C.FIRE[1]! : C.FIRE[0]!);
    }
  }
  return p;
}

/** A rune circle for a mage's floor, 64 by 64, cut out: two rings, a star between them, runes round the band. */
export function runeCircle(r: Ramp = ARCANE): Pixmap {
  const p = new Pixmap(64, 64);
  p.fill(0, 0);
  const c = 31.5;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const d = Math.hypot(x - c, y - c);
      const a = Math.atan2(y - c, x - c);
      if (Math.abs(d - 30) < 0.8 || Math.abs(d - 24) < 0.7) p.set(x, y, r[5]!);
      else if (d > 25 && d < 29 && Math.floor(((a + Math.PI) / (2 * Math.PI)) * 40) % 3 === 0 && hash2(x, y, 7) < 0.55) p.set(x, y, r[4]!);
    }
  }
  // A five-pointed star joining points on the inner ring.
  const pts = [0, 1, 2, 3, 4].map((k) => [c + 23 * Math.cos(-Math.PI / 2 + (k * 4 * Math.PI) / 5), c + 23 * Math.sin(-Math.PI / 2 + (k * 4 * Math.PI) / 5)] as const);
  for (let k = 0; k < 5; k++) {
    const [x0, y0] = pts[k]!;
    const [x1, y1] = pts[(k + 1) % 5]!;
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) p.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), r[6]!);
  }
  return p;
}

/** A planar rift, 24 by 40, cut out: a tear of swirling violet and teal light with a white-hot seam. */
export function rift(): Pixmap {
  const p = new Pixmap(24, 40);
  p.fill(0, 0);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 24; x++) {
      const nx = (x - 11.5) / 11.5;
      const ny = (y - 19.5) / 19.5;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const swirl = Math.sin(Math.atan2(ny, nx) * 3 + d * 9) * 0.5 + 0.5;
      let c = swirl > 0.6 ? ARCANE[5]! : swirl > 0.3 ? ARCANE[4]! : ARCANE_TEAL[4]!;
      if (d > 0.8) c = ARCANE[3]!;
      if (Math.abs(nx) < 0.12 && d < 0.85) c = d < 0.5 ? 0xffffff : ARCANE_TEAL[6]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A glass case's contents, 16 by 12: curios on two shelves - phials, a skull, gems, a small idol - dark behind. */
export function curios(seed = 5): Pixmap {
  const p = new Pixmap(16, 12, C.INK);
  const random = seeded(seed);
  const things = [C.PURPLE[4]!, ARCANE_TEAL[5]!, C.GOLD[4]!, C.RED[4]!, C.BONE[4]!, C.BLUE[5]!, C.GREEN[3]!];
  for (const shelf of [5, 11]) {
    p.hline(0, shelf, 16, C.DARKWOOD[4]!);
    let x = 1;
    while (x < 14) {
      const c = things[Math.floor(random() * things.length)]!;
      const h = 2 + Math.floor(random() * 3);
      p.rect(x, shelf - h, 2, h, c);
      p.set(x, shelf - h, 0xffffff);
      x += 3 + Math.floor(random() * 2);
    }
  }
  return p;
}

/** Cards laid out in a display case, 16 by 10: rows of cards face up, a few foil ones bright. */
export function cardDisplay(seed = 6): Pixmap {
  const p = new Pixmap(16, 10, C.DARKWOOD[1]!);
  const frames = [0xe8e0d0, C.GOLD[4]!, 0x6a6a7a, C.RED[3]!, C.BLUE[3]!, C.GREEN[3]!];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 1 + col * 4;
      const y = 1 + row * 5;
      const f = frames[Math.floor(hash2(col, row, seed) * frames.length)]!;
      p.rect(x, y, 3, 4, f);
      p.rect(x + 1, y + 1, 1, 1, hash2(col, row, seed + 1) < 0.5 ? C.BLUE[4]! : C.RED[4]!);
      p.set(x, y + 3, 0x40384a);
      if (hash2(col, row, seed + 2) < 0.25) p.set(x + 2, y, 0xffffff);
    }
  }
  return p;
}

/** A booster pack's face, 6 by 8: foil with a sigil. */
export function boosterPack(seed = 1): Pixmap {
  const hue = [C.RED, C.BLUE, C.GREEN, C.PURPLE, C.GOLD][seed % 5]!;
  const p = new Pixmap(6, 8, hue[3]!);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) if ((x + y) % 4 === 0) p.set(x, y, hue[4]!);
  p.hline(0, 0, 6, 0xd8d8e0);
  p.hline(0, 7, 6, 0xd8d8e0);
  p.rect(2, 3, 2, 2, 0xffffff);
  return p;
}

/** A map of the Domains for a guild's wall or table, 24 by 16: sea, the coast's lands, red pins. */
export function domainsMap(seed = 9): Pixmap {
  const p = new Pixmap(24, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 24; x++) {
      const land = fbm(x * 2, y * 2, 10, 64, seed) > 0.5;
      p.set(x, y, land ? (hash2(x, y, seed) < 0.2 ? 0x8a9a58 : 0xc8b888) : 0x7a9ab0);
      if (x === 0 || y === 0 || x === 23 || y === 15) p.set(x, y, 0x5a3a28);
    }
  }
  for (const [x, y] of [[6, 5], [15, 9], [19, 4]] as const) p.set(x, y, C.RED[4]!);
  return p;
}

/** A tapestry, 20 by 28: a hunting scene in a border - a hart and a hound under a tree, in wool colors. */
export function tapestry(r: Ramp = C.GREEN, seed = 3): Pixmap {
  const p = new Pixmap(20, 28);
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 20; x++) {
      let c = y > 18 ? r[2]! : y > 10 ? r[1]! : 0x2a3858;
      if (hash2(x, y, seed) < 0.08) c = r[3] ?? r[2]!;
      if (x < 2 || x > 17 || y < 2 || y > 25) c = (x + y) % 2 ? C.GOLD[2]! : C.RED[2]!;
      p.set(x, y, c);
    }
  }
  // The tree, the hart and the hound.
  p.rect(13, 8, 2, 12, C.WOOD[2]!);
  for (let y = 4; y < 11; y++) for (let x = 10; x < 18; x++) if (Math.hypot(x - 13.5, y - 7) < 4) p.set(x, y, C.LEAF[3]!);
  p.rect(4, 15, 6, 3, C.WOOD[4]!);
  p.rect(4, 18, 1, 3, C.WOOD[4]!);
  p.rect(9, 18, 1, 3, C.WOOD[4]!);
  p.rect(9, 12, 2, 3, C.WOOD[4]!);
  p.set(8, 11, C.WOOD[5]!);
  p.set(11, 11, C.WOOD[5]!);
  p.rect(5, 21, 4, 2, C.CLOTH_WHITE[2]!);
  return p;
}
