import * as C from "./colors";
import { cellAt, crack, fbm, jitteredPoints, paintCells, pebble, tuft, valueNoise, voronoi } from "./procedural";
import { Pixmap, type Rgb, hash2, seeded } from "./pixmap";

// The slice's tiling surfaces, painted by code at 16 texels to a tile: grass with tufts and flowers, cobbles,
// flagstones, a dirt path, floorboards, plaster, Benalish limestone, crypt brick, roof tiles, timber, foliage and bark,
// and water. Each is seamless (painting wraps), and seeded, so it is the same on every load.

const pick = <T>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))]!;

/** Grass: a few greens in soft patches, tufts in rows like a 16-bit field, and a scatter of small flowers. */
export function grass(seed = 1, flowers = true): Pixmap {
  const size = 64;
  const p = new Pixmap(size, size);
  const g = C.GRASS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x, y, 16, size, seed);
      const fine = hash2(x, y, seed + 3);
      let c = g[3]!;
      if (n < 0.34) c = g[2]!;
      else if (n > 0.68) c = g[4]!;
      if (fine < 0.04) c = n > 0.5 ? g[4]! : g[2]!;
      p.set(x, y, c);
    }
  }
  // Tufts on a loose grid, so they cover the field evenly the way tiles of grass do.
  const random = seeded(seed + 11);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      if (random() < 0.28) continue;
      const x = i * 8 + 2 + Math.floor(random() * 5) + (j % 2) * 4;
      const y = j * 8 + 3 + Math.floor(random() * 4);
      const n = fbm(x, y, 16, size, seed);
      const dark = n < 0.34 ? g[1]! : g[2]!;
      const light = n > 0.6 ? g[5]! : g[4]!;
      tuft(p, x, y, dark, n > 0.68 ? g[5]! : g[4]!, light, random() < 0.3 ? 2 : 1);
    }
  }
  if (flowers) {
    const petals: Rgb[][] = [
      [0xfff8e8, 0xf4dc7a],
      [0xf8d04c, 0xe0a02c],
      [0xfcb0c8, 0xe8789a],
      [0x82b8f6, 0x4c8ae6],
    ];
    for (let k = 0; k < 7; k++) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      const [petal, centre] = pick(petals, random());
      p.set(x, y - 1, petal!);
      p.set(x - 1, y, petal!);
      p.set(x + 1, y, petal!);
      p.set(x, y, centre!);
      p.set(x, y + 1, g[1]!);
    }
  }
  return p;
}

/** Cobbles: rounded stones of a few cool greys and the odd warm one, set in dark joints with moss in places. */
export function cobbles(seed = 2): Pixmap {
  const size = 64;
  const points = jitteredPoints(size, size, 8, 7, 0.5, seed);
  const map = voronoi(size, size, points, 1.1, 1.2);
  const at = cellAt(map, size, size);
  const k = C.COBBLE;
  const l = C.LIMESTONE;
  const random = seeded(seed + 5);
  const shades = points.map(() => {
    const r = random();
    if (r < 0.12) return { base: l[4]!, light: l[5]!, lighter: l[5]!, dark: l[3]!, speckle: 0.03, speckleColor: l[3]! };
    if (r < 0.55) return { base: k[4]!, light: k[5]!, lighter: k[6]!, dark: k[3]!, speckle: 0.03, speckleColor: k[3]! };
    return { base: k[5]!, light: k[6]!, lighter: k[6]!, dark: k[4]!, speckle: 0.03, speckleColor: k[4]! };
  });
  const p = new Pixmap(size, size);
  paintCells(p, at, (id) => shades[id]!, k[2]!, seed);
  // The joints: darker where they are deepest, a little moss where the noise says so.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(x, y) >= 0) continue;
      const enclosed = at(x, y - 1) < 0 && at(x, y + 1) < 0 && at(x - 1, y) < 0;
      if (enclosed) p.set(x, y, k[1]!);
      if (fbm(x, y, 12, size, seed + 9) > 0.76 && hash2(x, y, seed) < 0.5) p.set(x, y, C.MEADOW[hash2(x, y, 4) < 0.5 ? 1 : 2]!);
    }
  }
  return p;
}

/** Flagstones: big squared slabs in staggered courses, chipped and cracked: a plaza or a crypt floor. */
export function flagstones(ramp: readonly Rgb[], seed = 3, size = 64): Pixmap {
  const random = seeded(seed);
  const course = 16;
  const ids = new Int16Array(size * size).fill(-1);
  let id = 0;
  const shades: { base: Rgb; light: Rgb; lighter: Rgb; dark: Rgb; speckle: number; speckleColor: Rgb }[] = [];
  for (let row = 0; row < size / course; row++) {
    // Each course split into slabs of 12 to 24 texels, its start shifted.
    let x = Math.floor(random() * 10);
    const start = x;
    const rowTall = row % 2 === 0;
    while (x < start + size) {
      const w = Math.min(start + size - x, 12 + Math.floor(random() * 4) * 4);
      // Some slabs are split in two along the course.
      const split = !rowTall && random() < 0.35 ? 8 : course;
      for (let part = 0; part < course; part += split) {
        const b = random();
        const base = b < 0.3 ? 2 : b < 0.85 ? 3 : 4;
        shades.push({ base: ramp[base]!, light: ramp[base + 1]!, lighter: ramp[Math.min(ramp.length - 1, base + 2)]!, dark: ramp[base - 1]!, speckle: 0.05, speckleColor: ramp[base - 1]! });
        for (let yy = 1; yy < Math.min(split, course - part); yy++) {
          for (let xx = 1; xx < w; xx++) {
            const px = (x + xx) % size;
            const py = row * course + part + yy;
            ids[py * size + px] = id;
          }
        }
        id++;
      }
      x += w;
    }
  }
  const at = cellAt(ids, size, size);
  const p = new Pixmap(size, size);
  paintCells(p, at, (i) => shades[i]!, ramp[0]!, seed);
  // Chipped corners and a few cracks.
  for (let n = 0; n < 7; n++) crack(p, Math.floor(random() * size), Math.floor(random() * size), 3 + Math.floor(random() * 5), ramp[1]!, random);
  return p;
}

/** A packed dirt path: warm browns in patches, pebbles, a stray blade or two. */
export function dirt(seed = 4): Pixmap {
  const size = 64;
  const d = C.DIRT;
  const p = new Pixmap(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x, y, 12, size, seed);
      let c = d[3]!;
      if (n < 0.33) c = d[2]!;
      else if (n > 0.66) c = d[4]!;
      if (hash2(x, y, seed) < 0.05) c = d[2]!;
      p.set(x, y, c);
    }
  }
  const random = seeded(seed + 1);
  for (let k = 0; k < 26; k++) pebble(p, Math.floor(random() * size), Math.floor(random() * size), d[4]!, d[5]!, d[1]!, random() < 0.5);
  return p;
}

/** Floorboards running east-west: planks four texels wide, staggered ends with nails, grain and knots. */
export function floorboards(seed = 5): Pixmap {
  const size = 64;
  const w = C.WOOD;
  const p = new Pixmap(size, size);
  const random = seeded(seed);
  const plank = 4;
  for (let row = 0; row < size / plank; row++) {
    let x = Math.floor(random() * 32);
    const start = x;
    while (x < start + size) {
      const len = 16 + Math.floor(random() * 4) * 8;
      const tone = random();
      const base = tone < 0.3 ? w[3]! : tone < 0.8 ? w[4]! : w[5]!;
      const grain = tone < 0.3 ? w[2]! : w[3]!;
      const light = tone < 0.3 ? w[4]! : w[5]!;
      for (let i = 0; i < len; i++) {
        for (let j = 0; j < plank; j++) {
          const y = row * plank + j;
          let c = base;
          if (j === 0 && (i + row) % 3 !== 0) c = light;
          if (j === plank - 1) c = w[2]!;
          if (i === 0) c = w[1]!;
          p.set(x + i, y, c);
        }
      }
      // Grain streaks and a knot.
      for (let g = 0; g < len / 6; g++) {
        const gx = x + 2 + Math.floor(random() * (len - 4));
        const gy = row * plank + 1 + Math.floor(random() * 2);
        const gl = 2 + Math.floor(random() * 4);
        for (let i = 0; i < gl; i++) if (gx + i < x + len) p.set(gx + i, gy, grain);
      }
      if (random() < 0.25) {
        const kx = x + 4 + Math.floor(random() * (len - 8));
        p.set(kx, row * plank + 1, w[2]!);
        p.set(kx + 1, row * plank + 1, w[1]!);
        p.set(kx, row * plank + 2, w[2]!);
      }
      // Nails by the ends.
      p.set(x + 2, row * plank + 1, w[6]!);
      p.set(x + 2, row * plank + 2, w[2]!);
      x += len;
    }
  }
  return p;
}

/** Whitewashed plaster: warm white with faint speckle, hairline cracks and a patch where the stone shows through. */
export function plaster(seed = 6, ramp: readonly Rgb[] = C.PLASTER): Pixmap {
  const size = 64;
  const p = new Pixmap(size, size);
  const random = seeded(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x, y, 16, size, seed);
      let c = ramp[4]!;
      if (n < 0.3) c = ramp[3]!;
      if (n > 0.72) c = ramp[5]!;
      if (hash2(x, y, seed) < 0.035) c = ramp[3]!;
      p.set(x, y, c);
    }
  }
  for (let k = 0; k < 3; k++) crack(p, Math.floor(random() * size), Math.floor(random() * size), 4 + Math.floor(random() * 4), ramp[2]!, random);
  // A worn patch: a couple of stones peeping through.
  const px = Math.floor(random() * 48);
  const py = Math.floor(random() * 48);
  const l = C.LIMESTONE;
  p.rect(px, py, 6, 3, l[3]!);
  p.hline(px, py, 6, l[4]!);
  p.hline(px, py + 3, 6, l[1]!);
  p.rect(px + 3, py + 4, 5, 3, l[3]!);
  p.hline(px + 3, py + 4, 5, l[4]!);
  p.hline(px + 3, py + 7, 5, l[1]!);
  p.vline(px + 2, py + 4, 3, ramp[2]!);
  return p;
}

/**
 * Ashlar: squared blocks in courses of `course` texels (mortar included), staggered, each block a little different;
 * Benalish limestone in the town, cold blue brick in the crypt.
 */
export function ashlar(ramp: readonly Rgb[], seed = 7, course = 6, minLen = 7, maxLen = 13, width = 64, height = 48): Pixmap {
  const random = seeded(seed);
  const ids = new Int16Array(width * height).fill(-1);
  const shades: { base: Rgb; light: Rgb; lighter: Rgb; dark: Rgb; speckle: number; speckleColor: Rgb }[] = [];
  let id = 0;
  for (let row = 0; row < height / course; row++) {
    let x = Math.floor(random() * maxLen);
    const start = x;
    while (x < start + width) {
      const len = Math.min(start + width - x, minLen + Math.floor(random() * (maxLen - minLen + 1)));
      const b = random();
      const base = b < 0.25 ? 3 : b < 0.85 ? 4 : 5;
      const top = Math.min(ramp.length - 1, base + 1);
      shades.push({ base: ramp[base]!, light: ramp[top]!, lighter: ramp[Math.min(ramp.length - 1, base + 2)]!, dark: ramp[base - 1]!, speckle: 0.05, speckleColor: ramp[base - 1]! });
      for (let j = 1; j < course; j++) for (let i = 1; i < len; i++) ids[(row * course + j) * width + ((x + i) % width)] = id;
      id++;
      x += len;
    }
  }
  const at = cellAt(ids, width, height);
  const p = new Pixmap(width, height);
  paintCells(p, at, (i) => shades[i]!, ramp[1]!, seed);
  for (let k = 0; k < 4; k++) crack(p, Math.floor(random() * width), Math.floor(random() * height), 2 + Math.floor(random() * 3), ramp[2]!, random);
  return p;
}

/** Roof tiles: rows of rounded clay tiles, each lit on its left and shadowed on its right, under the row above. */
export function roofTiles(ramp: readonly Rgb[] = C.ROOF, seed = 8): Pixmap {
  const size = 32;
  const p = new Pixmap(size, size);
  const random = seeded(seed);
  const tileW = 4;
  const rowH = 4;
  for (let row = 0; row < size / rowH; row++) {
    const shift = row % 2 ? 2 : 0;
    for (let t = 0; t < size / tileW; t++) {
      const r = random();
      const base = r < 0.2 ? 3 : r < 0.85 ? 4 : 5;
      for (let j = 0; j < rowH; j++) {
        for (let i = 0; i < tileW; i++) {
          const x = t * tileW + i + shift;
          // Rows count down from the ridge in the picture's rows: the lower edge of a row is its last texel row.
          const y = row * rowH + j;
          let c = ramp[base]!;
          if (i === 0) c = ramp[Math.min(ramp.length - 1, base + 1)]!;
          if (i === tileW - 1) c = ramp[base - 1]!;
          if (j === 0) c = ramp[base - 2]!;
          if (j === rowH - 1 && (i === 0 || i === tileW - 1)) c = ramp[1]!;
          if (j === rowH - 1 && (i === 1 || i === 2)) c = ramp[base]!;
          p.set(x, y, c);
        }
      }
    }
  }
  return p;
}

/** Slate shingles: square-cut dark blue-grey plates. */
export function slates(seed = 9, s: readonly Rgb[] = C.SLATE): Pixmap {
  const size = 32;
  const p = new Pixmap(size, size);
  const random = seeded(seed);
  for (let row = 0; row < size / 4; row++) {
    const shift = row % 2 ? 3 : 0;
    for (let t = 0; t < size / 6 + 1; t++) {
      const base = random() < 0.7 ? 3 : 2;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 6; i++) {
          let c = s[base]!;
          if (j === 0) c = s[1]!;
          if (j === 1) c = s[Math.min(4, base + 1)]!;
          if (i === 5) c = s[base - 1]!;
          p.set(t * 6 + i + shift, row * 4 + j, c);
        }
      }
    }
  }
  return p;
}

/** Timber: dark beams with grain running along them (vertical in the picture), for framing and posts. */
export function timber(seed = 10, ramp: readonly Rgb[] = C.WOOD): Pixmap {
  const size = 16;
  const p = new Pixmap(size, size * 2);
  for (let y = 0; y < size * 2; y++) {
    for (let x = 0; x < size; x++) {
      const n = valueNoise(x * 4, y, 6, size * 2, seed);
      let c = ramp[3]!;
      if (n < 0.35) c = ramp[2]!;
      if (n > 0.7) c = ramp[4]!;
      if (hash2(x, y, seed) < 0.06) c = ramp[2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Leaves: clumps of leaves, each lit on top and shadowed beneath, over a darker bed, as 16-bit trees are drawn. */
export function leaves(seed = 11, ramp: readonly Rgb[] = C.LEAF): Pixmap {
  const size = 32;
  const p = new Pixmap(size, size, ramp[2]!);
  const random = seeded(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (hash2(x, y, seed) < 0.2) p.set(x, y, ramp[1]!);
  const points = jitteredPoints(size, size, 6, 5, 0.6, seed);
  for (const [cx, cy] of points) {
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    const tone = random() < 0.5 ? 4 : 3;
    // A clump: a rounded patch three or four texels across.
    const shape = ["  XX  ", " XXXX ", "XXXXXX", " XXXX ", "  X   "];
    shape.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] !== "X") continue;
        let c = ramp[tone]!;
        if (j === 0 || (j === 1 && (i === 1 || i === 4))) c = ramp[tone + 1]!;
        if (j === 0 && i === 2) c = ramp[Math.min(ramp.length - 1, tone + 2)]!;
        if (j >= 3) c = ramp[tone - 1]!;
        p.set(x0 + i - 3, y0 + j - 2, c);
      }
    });
  }
  return p;
}

/** Bark: dark grooves running up a trunk. */
export function bark(seed = 12): Pixmap {
  const w = C.WOOD;
  const p = new Pixmap(16, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const n = valueNoise(x * 3, y, 5, 32, seed);
      let c = w[3]!;
      if (n < 0.4) c = w[2]!;
      if (n < 0.22) c = w[1]!;
      if (n > 0.72) c = w[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Water: deep blue with lighter ripple dashes and the odd glint. The renderer slides it a texel at a time. */
export function water(seed = 13): Pixmap {
  const size = 32;
  const c = C.WATER;
  const p = new Pixmap(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x, y * 2, 8, size, seed);
      p.set(x, y, n < 0.4 ? c[2]! : n < 0.7 ? c[3]! : c[3]!);
    }
  }
  const random = seeded(seed);
  for (let k = 0; k < 18; k++) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const len = 2 + Math.floor(random() * 4);
    for (let i = 0; i < len; i++) p.set(x + i, y, c[4]!);
    p.set(x + 1, y - 1, c[5]!);
    if (random() < 0.3) p.set(x + len, y - 1, c[6]!);
  }
  return p;
}

/** A ground texture's dark crypt variant: flagstones in the crypt's cold violet stone, with grime in the joints. */
export function cryptFloor(seed = 14): Pixmap {
  const p = flagstones(C.CRYPT_FLOOR, seed);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (fbm(x, y, 16, 64, seed + 2) > 0.7 && hash2(x, y, seed) < 0.3) p.set(x, y, C.CRYPT_FLOOR[1]!);
    }
  }
  return p;
}

/** Packed earth and straw: a stable's or cellar's floor, and the market's beaten ground. */
export function straw(seed = 15): Pixmap {
  const p = dirt(seed);
  const random = seeded(seed + 3);
  const s = C.STRAW;
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(random() * 64);
    const y = Math.floor(random() * 64);
    const len = 2 + Math.floor(random() * 3);
    for (let i = 0; i < len; i++) p.set(x + i, y + (i > 1 ? 1 : 0), i === 0 ? s[3]! : s[2]!);
  }
  return p;
}

/** A ploughed field: furrows running east-west, a lit crest and a dark trough to each, clods and the odd green shoot. */
export function furrows(seed = 16): Pixmap {
  const d = C.DIRT;
  const p = new Pixmap(64, 64);
  const random = seeded(seed);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const row = (y + Math.round(valueNoise(x, 0, 16, 64, seed) * 2)) % 4;
      let c = [d[4]!, d[3]!, d[2]!, d[1]!][row]!;
      if (hash2(x, y, seed) < 0.06) c = row < 2 ? d[2]! : d[3]!;
      p.set(x, y, c);
    }
  }
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(random() * 64);
    const y = Math.floor(random() * 16) * 4;
    p.set(x, y, C.GRASS[4]!);
    p.set(x, y + 1, C.GRASS[3]!);
  }
  return p;
}

/** Ripe wheat in rows: gold ears over darker stalks, a shadowed line between rows. */
export function wheat(seed = 17): Pixmap {
  const s = C.STRAW;
  const p = new Pixmap(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const row = y % 6;
      const ear = (x + Math.floor(y / 6) * 2) % 3 === 0;
      let c = s[2]!;
      if (row === 0) c = ear ? s[4]! : s[3]!;
      else if (row === 1) c = ear ? s[3]! : s[2]!;
      else if (row === 5) c = s[0]!;
      else if (row === 4) c = s[1]!;
      if (hash2(x, y, seed) < 0.05) c = s[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Weathered rock: grey bands with cracks and spots of lichen, for boulders and the rise's banks. */
export function rock(seed = 18): Pixmap {
  const k = C.COBBLE;
  const p = new Pixmap(32, 32);
  const random = seeded(seed);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = fbm(x, y * 1.5, 10, 32, seed);
      let c = n < 0.35 ? k[3]! : n < 0.62 ? k[4]! : k[5]!;
      if (hash2(x, y, seed) < 0.04) c = k[2]!;
      if (fbm(x, y, 6, 32, seed + 3) > 0.74) c = C.MEADOW[2]!;
      p.set(x, y, c);
    }
  }
  for (let n = 0; n < 5; n++) crack(p, Math.floor(random() * 32), Math.floor(random() * 32), 4 + Math.floor(random() * 4), k[1]!, random);
  return p;
}
