import { Pixmap, type Rgb, hash2, seeded } from "./pixmap";

// Painting helpers the textures are made with: tileable value noise, cells (stones, slabs, bricks) shaded with a lit
// top-left edge and a shadowed bottom-right one, as pixel artists shade a stone, and small stamps (tufts, pebbles).

/** Smooth value noise in [0, 1), tileable with the given period in texels (cells of `cell` texels). */
export function valueNoise(x: number, y: number, cell: number, period: number, seed: number): number {
  const n = Math.max(1, Math.round(period / cell));
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (i: number, j: number) => hash2(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
  const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** Two octaves of value noise. */
export function fbm(x: number, y: number, cell: number, period: number, seed: number): number {
  return valueNoise(x, y, cell, period, seed) * 0.65 + valueNoise(x, y, cell / 2, period, seed + 7) * 0.35;
}

export interface CellShade {
  /** The cell's body color. */
  readonly base: Rgb;
  /** Its lit top and left edge, and a brighter corner texel. */
  readonly light: Rgb;
  readonly lighter?: Rgb;
  /** Its shadowed bottom and right edge. */
  readonly dark: Rgb;
  /** Speckles in the body, as a share of its texels, and their color. */
  readonly speckle?: number;
  readonly speckleColor?: Rgb;
}

/**
 * Paints cells: `cell(x, y)` names the cell a texel is in, or -1 for the gaps between them (mortar), which take
 * `gap` (and `gapDeep` where both sides of the gap are deep in it). Each cell is shaded by `shade(id)`.
 */
export function paintCells(
  p: Pixmap,
  cell: (x: number, y: number) => number,
  shade: (id: number) => CellShade,
  gap: Rgb,
  seed: number,
): void {
  const random = seeded(seed);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const id = cell(x, y);
      if (id < 0) {
        p.set(x, y, gap);
        continue;
      }
      const s = shade(id);
      const up = cell(x, y - 1) !== id;
      const left = cell(x - 1, y) !== id;
      const down = cell(x, y + 1) !== id;
      const right = cell(x + 1, y) !== id;
      let color = s.base;
      if (down || right) color = s.dark;
      else if (up && left && s.lighter !== undefined) color = s.lighter;
      else if (up || left) color = s.light;
      else if (s.speckle && random() < s.speckle) color = s.speckleColor ?? s.dark;
      p.set(x, y, color);
    }
  }
}

/** Jittered points on a torus, row by row: the seeds of irregular stones. */
export function jitteredPoints(width: number, height: number, stepX: number, stepY: number, jitter: number, seed: number): [number, number][] {
  const random = seeded(seed);
  const points: [number, number][] = [];
  const rows = Math.round(height / stepY);
  const cols = Math.round(width / stepX);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const offset = j % 2 ? stepX / 2 : 0;
      points.push([i * stepX + offset + (random() - 0.5) * jitter * stepX, j * stepY + (random() - 0.5) * jitter * stepY]);
    }
  }
  return points;
}

/**
 * A Voronoi map of the points on a torus, stretched by `aspect` (wider stones when above 1): each texel's nearest
 * point, or -1 where it is within `gap` of the border between two.
 */
export function voronoi(width: number, height: number, points: readonly [number, number][], gap: number, aspect = 1): Int16Array {
  const out = new Int16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = Infinity;
      let second = Infinity;
      let pick = 0;
      points.forEach(([px, py], i) => {
        let dx = Math.abs(x + 0.5 - px);
        let dy = Math.abs(y + 0.5 - py);
        dx = Math.min(dx, width - dx) / aspect;
        dy = Math.min(dy, height - dy);
        const d = Math.hypot(dx, dy);
        if (d < best) {
          second = best;
          best = d;
          pick = i;
        } else if (d < second) {
          second = d;
        }
      });
      out[y * width + x] = second - best < gap ? -1 : pick;
    }
  }
  return out;
}

/** Looks a texel up in a cell map, wrapping. */
export function cellAt(map: Int16Array, width: number, height: number): (x: number, y: number) => number {
  return (x, y) => map[((((y % height) + height) % height) * width + (((x % width) + width) % width))]!;
}

/** A grass tuft: a few blades, dark at the root and light at the tips, standing on (x, y). */
export function tuft(p: Pixmap, x: number, y: number, dark: Rgb, mid: Rgb, light: Rgb, wide = 1): void {
  p.set(x, y, dark);
  p.set(x, y - 1, mid);
  p.set(x, y - 2, light);
  p.set(x - 1, y, dark);
  p.set(x - 1, y - 1, light);
  p.set(x + 1, y, dark);
  p.set(x + 1, y - 1, light);
  if (wide > 1) {
    p.set(x - 2, y, dark);
    p.set(x + 2, y, dark);
    p.set(x + 2, y - 1, mid);
    p.set(x - 2, y - 1, mid);
  }
}

/** A pebble: two or three texels with a lit top and a shadow under. */
export function pebble(p: Pixmap, x: number, y: number, body: Rgb, light: Rgb, shadow: Rgb, wide: boolean): void {
  p.set(x, y, light);
  if (wide) p.set(x + 1, y, body);
  p.set(x, y + 1, shadow);
  if (wide) p.set(x + 1, y + 1, shadow);
}

/** A crack: a short random walk of dark texels, mostly sideways. */
export function crack(p: Pixmap, x: number, y: number, length: number, color: Rgb, random: () => number, edge?: Rgb): void {
  let cx = x;
  let cy = y;
  for (let i = 0; i < length; i++) {
    p.set(cx, cy, color);
    if (edge !== undefined) p.set(cx, cy + 1, edge);
    const r = random();
    if (r < 0.55) cx += 1;
    else if (r < 0.78) cy += 1;
    else cy -= 1;
  }
}
