import type { StreetWay, TownPlan, TownSquare, XZ } from "./format";

// The tiles of a town's street plan (format.ts, `TownPlan`), as the world generator paves them, the lint walks them and
// the maps draw them: a way runs in straight four-connected steps from its first node through its corners to its last,
// each tile widened by a square brush; a square is its rectangle, or the ellipse in it. Three-free.

/** The tiles of a straight run, corner to corner, four-connected: Bresenham's, a tile added at each diagonal step. */
export function lineTiles(a: XZ, b: XZ): [number, number][] {
  const out: [number, number][] = [];
  let [x, z] = a;
  const [x1, z1] = b;
  const dx = Math.abs(x1 - x);
  const dz = -Math.abs(z1 - z);
  const sx = x < x1 ? 1 : -1;
  const sz = z < z1 ? 1 : -1;
  let err = dx + dz;
  for (;;) {
    out.push([x, z]);
    if (x === x1 && z === z1) break;
    const e2 = 2 * err;
    const stepX = e2 >= dz;
    const stepZ = e2 <= dx;
    if (stepX && stepZ) {
      // A diagonal step: go one way first, so the two tiles share a side.
      err += dz;
      x += sx;
      out.push([x, z]);
      err += dx;
      z += sz;
      continue;
    }
    if (stepX) {
      err += dz;
      x += sx;
    }
    if (stepZ) {
      err += dx;
      z += sz;
    }
  }
  return out;
}

/** The tiles of a run through points in order, four-connected, each once where the runs meet. */
export function pathTiles(points: readonly XZ[]): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 1; k < points.length; k++) {
    const run = lineTiles(points[k - 1]!, points[k]!);
    out.push(...(k === 1 ? run : run.slice(1)));
  }
  if (points.length === 1) out.push([points[0]![0], points[0]![1]]);
  return out;
}

/** The brush's reach either side of a middle tile, for a way `width` tiles across: from `lo` to `hi`, both included. */
export const brushOf = (width: number): readonly [number, number] => {
  const lo = -Math.floor((width - 1) / 2);
  return [lo, lo + width - 1];
};

/** A way's points, node to node through its corners. */
export const wayPoints = (plan: Pick<TownPlan, "nodes">, way: StreetWay): XZ[] => [plan.nodes[way.a]!, ...(way.via ?? []), plan.nodes[way.b]!];

/** A way's middle line, its tiles in order from `a` to `b`. */
export const wayMiddle = (plan: Pick<TownPlan, "nodes">, way: StreetWay): [number, number][] => pathTiles(wayPoints(plan, way));

/** Every tile of a way: its middle line widened by its brush, each once. */
export function wayTiles(plan: Pick<TownPlan, "nodes">, way: StreetWay): [number, number][] {
  const [lo, hi] = brushOf(way.width);
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [x, z] of wayMiddle(plan, way)) {
    for (let dz = lo; dz <= hi; dz++) {
      for (let dx = lo; dx <= hi; dx++) {
        const k = `${x + dx},${z + dz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([x + dx, z + dz]);
      }
    }
  }
  return out;
}

/** Whether a tile is in a square: its rectangle, or the ellipse in it when round. */
export function inSquare(s: TownSquare, x: number, z: number): boolean {
  if (x < s.x || z < s.z || x >= s.x + s.w || z >= s.z + s.d) return false;
  if (!s.round) return true;
  const hx = (s.w - 1) / 2;
  const hz = (s.d - 1) / 2;
  return Math.hypot((x - s.x - hx) / Math.max(hx, 0.5), (z - s.z - hz) / Math.max(hz, 0.5)) <= 1;
}

/** Every tile of a square. */
export function squareTiles(s: TownSquare): [number, number][] {
  const out: [number, number][] = [];
  for (let z = s.z; z < s.z + s.d; z++) for (let x = s.x; x < s.x + s.w; x++) if (inSquare(s, x, z)) out.push([x, z]);
  return out;
}

/** Every street tile of a plan - its ways' and its squares' - as "x,z". */
export function streetTiles(plan: TownPlan): Set<string> {
  const out = new Set<string>();
  for (const w of plan.ways) for (const [x, z] of wayTiles(plan, w)) out.add(`${x},${z}`);
  for (const s of plan.squares) for (const [x, z] of squareTiles(s)) out.add(`${x},${z}`);
  return out;
}

/** Whether a tile lies inside a polygon through tiles (its corners' tiles), even-odd: a town's outline, a lane round it. */
export function inPolygon(poly: readonly XZ[], x: number, z: number): boolean {
  let inside = false;
  for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
    const [xi, zi] = poly[k]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
