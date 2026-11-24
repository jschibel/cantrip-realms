import { type Ground, type Open, type Pass, type Tile, canStep as stepOver, flatGround } from "../world/grid";

// The player's body on the grid, between tile centres: a square of BODY tiles either way of its middle that never
// overlaps a closed tile, nor stands across a ledge (a bank higher than a step between two open tiles: world/grid.ts).
// Holding the button walks it straight at the cursor (`slide`): what is in the way stops the part of the step that goes
// into it and keeps the part along it, so it slides along a wall or the brink of a ledge and stops only where nothing is
// left to go, and a corner it only brushes turns it round the corner. A click walks the grid's path pulled straight
// (`smooth`): from where the body stands to the furthest corner of the path it can walk to in a line, and on from there,
// so a click walk is a few straight legs, not a staircase of eight-way steps. Both keep the grid's rule: a body whose
// middle goes from one tile to a diagonal one overlaps all four tiles at the corner, so it never cuts the corner of a
// closed tile or a ledge - `tilesAlong` turns a line walked back into the eight-way steps the relay sends.
//
// What is walked is a `Ground` (world/grid.ts): the open tiles and the edges between them. A plain test of open tiles
// stands for ground with no ledges.

export type { Ground, Open, Pass };

/** Half the side of the player's body, tiles: room to walk a one-tile alley, too big to squeeze past a closed corner. */
export const BODY = 0.3;

export interface Point {
  readonly x: number;
  readonly z: number;
}

const E = 1e-7;
/** The longest piece of a move tested at once: less than a tile, so no tile is ever jumped over. */
const PIECE = 0.25;

const groundOf = (g: Ground | Open): Ground => (typeof g === "function" ? flatGround(g) : g);

/** The ground with its axes swapped: (a, b) is (z, x). */
const swap = (g: Ground): Ground => ({ open: (a, b) => g.open(b, a), pass: (a1, b1, a2, b2) => g.pass(b1, a1, b2, a2) });

interface Axis {
  /** Where the body's middle ends along the axis. */
  readonly at: number;
  /** The line of tiles across the axis that stopped it, or null. */
  readonly hit: number | null;
}

/**
 * Whether the body, spanning the rows `lo` to `hi`, may come into the line of tiles `line` from the line beside it
 * (`from`): every tile of it open, no ledge between it and the line it comes from, and none along it between the rows.
 */
function enters(g: Ground, from: number, line: number, lo: number, hi: number): boolean {
  for (let row = lo; row <= hi; row++) {
    if (!g.open(line, row) || !g.pass(from, row, line, row)) return false;
    if (row < hi && !g.pass(line, row, line, row + 1)) return false;
  }
  return true;
}

/**
 * Moves the body's middle along one axis (`a`, the other being `b`) by `d`, stopping flush against the first line of
 * tiles across it that it may not come into (`enters`), in the ground's terms (a, b).
 */
function along(g: Ground, a: number, b: number, d: number, r: number): Axis {
  if (d === 0) return { at: a, hit: null };
  const lo = Math.floor(b - r + E);
  const hi = Math.floor(b + r - E);
  if (d > 0) {
    const to = Math.floor(a + d + r - E);
    for (let line = Math.floor(a + r - E) + 1; line <= to; line++) if (!enters(g, line - 1, line, lo, hi)) return { at: Math.max(a, line - r), hit: line };
  } else {
    const to = Math.floor(a + d - r + E);
    for (let line = Math.floor(a - r + E) - 1; line >= to; line--) if (!enters(g, line + 1, line, lo, hi)) return { at: Math.min(a, line + 1 + r), hit: line };
  }
  return { at: a + d, hit: null };
}

/**
 * After a move along `a` from the line `from` stopped at the line `hit`: if only one of the two rows the body spans may
 * be come into there and the body's middle is past it in that one (it only brushes the corner), the way round - the move
 * along `b` that clears the corner, at most `budget` - else 0.
 */
function roundCorner(g: Ground, b: number, from: number, hit: number, r: number, budget: number): number {
  const lo = Math.floor(b - r + E);
  const hi = Math.floor(b + r - E);
  if (lo === hi) return 0;
  const loOpen = enters(g, from, hit, lo, lo);
  const hiOpen = enters(g, from, hit, hi, hi);
  if (loOpen === hiOpen) return 0;
  // The closed row's overlap, and the way out of it.
  if (loOpen && b < hi) return -Math.min(budget, b + r - hi);
  if (hiOpen && b >= hi) return Math.min(budget, hi - (b - r));
  return 0;
}

/**
 * Moves the body's middle from (x, z) by (dx, dz), sliding along whatever is closed or a ledge: each piece of the move
 * goes along its longer axis first, then the other; a piece stopped by a corner the body only brushes is turned round it
 * (unless the move heads the other way across). Where it ends.
 */
export function slide(ground: Ground | Open, x: number, z: number, dx: number, dz: number, r = BODY): Point {
  const g = groundOf(ground);
  const swapped = swap(g);
  const pieces = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / PIECE));
  const sx = dx / pieces;
  const sz = dz / pieces;
  for (let i = 0; i < pieces; i++) {
    // The longer axis first: (a, b) are the body's middle along it and across it, `o` the ground in those terms.
    const xFirst = Math.abs(sx) >= Math.abs(sz);
    const [a, b, d, cross, o, across] = xFirst ? [x, z, sx, sz, g, swapped] : [z, x, sz, sx, swapped, g];
    const first = along(o, a, b, d, r);
    let nb: number | null = null;
    if (first.hit !== null) {
      // Round a corner it only brushes, when the move is mostly into it or already heads the way round: the rest of
      // the piece goes round instead of across, never further than the piece.
      const went = Math.abs(first.at - a);
      const from = first.hit - Math.sign(d);
      const turn = roundCorner(o, b, from, first.hit, r, Math.sqrt(Math.max(0, d * d + cross * cross - went * went)));
      if (turn !== 0 && (Math.abs(cross) < Math.abs(d) * 0.5 || Math.sign(cross) === Math.sign(turn))) nb = along(across, b, first.at, turn, r).at;
    }
    nb ??= along(across, b, first.at, cross, r).at;
    if (xFirst) {
      x = first.at;
      z = nb;
    } else {
      z = first.at;
      x = nb;
    }
  }
  return { x, z };
}

/** Whether the body can stand with its middle at a point: every tile it overlaps open, and no ledge between them. */
export function fits(ground: Ground | Open, x: number, z: number, r = BODY): boolean {
  const g = groundOf(ground);
  const x0 = Math.floor(x - r + E);
  const x1 = Math.floor(x + r - E);
  const z0 = Math.floor(z - r + E);
  const z1 = Math.floor(z + r - E);
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!g.open(tx, tz)) return false;
      if (tx < x1 && !g.pass(tx, tz, tx + 1, tz)) return false;
      if (tz < z1 && !g.pass(tx, tz, tx, tz + 1)) return false;
    }
  }
  return true;
}

/**
 * Whether the body walks from one point to another in a straight line without overlapping a closed tile or standing
 * across a ledge.
 */
export function clear(ground: Ground | Open, from: Point, to: Point, r = BODY): boolean {
  const g = groundOf(ground);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const x0 = Math.floor(Math.min(from.x, to.x) - r + E);
  const x1 = Math.floor(Math.max(from.x, to.x) + r - E);
  const z0 = Math.floor(Math.min(from.z, to.z) - r + E);
  const z1 = Math.floor(Math.max(from.z, to.z) + r - E);
  // The segment against a box the middle may not go inside: a hit only where it goes inside, not along an edge.
  const inside = (p: number, d: number, lo: number, hi: number, span: [number, number]): boolean => {
    if (Math.abs(d) < 1e-12) return p > lo && p < hi;
    let t1 = (lo - p) / d;
    let t2 = (hi - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    span[0] = Math.max(span[0], t1);
    span[1] = Math.min(span[1], t2);
    return span[0] < span[1];
  };
  const hits = (bx0: number, bz0: number, bx1: number, bz1: number) => {
    const span: [number, number] = [0, 1];
    return inside(from.x, dx, bx0 + E, bx1 - E, span) && inside(from.z, dz, bz0 + E, bz1 - E, span);
  };
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      // A closed tile grown by the body.
      if (!g.open(tx, tz)) {
        if (hits(tx - r, tz - r, tx + 1 + r, tz + 1 + r)) return false;
        continue;
      }
      // A ledge on its east or south edge: the body may not stand across it, so the edge grown by the body.
      if (tx < x1 && g.open(tx + 1, tz) && !g.pass(tx, tz, tx + 1, tz) && hits(tx + 1 - r, tz - r, tx + 1 + r, tz + 1 + r)) return false;
      if (tz < z1 && g.open(tx, tz + 1) && !g.pass(tx, tz, tx, tz + 1) && hits(tx - r, tz + 1 - r, tx + 1 + r, tz + 1 + r)) return false;
    }
  }
  return true;
}

/** A tile's middle. */
export const middle = (t: Tile): Point => ({ x: t.x + 0.5, z: t.z + 0.5 });

/**
 * The grid's path from the tile the body stands on, pulled straight: the points to walk to from where it stands, each
 * the furthest middle of a tile of the path it can walk to in a line from the one before, the last the goal's middle.
 * A body standing off its tile's middle where the path's first step is not clear goes to the middle first.
 */
export function smooth(ground: Ground | Open, from: Point, route: readonly Tile[]): Point[] {
  const g = groundOf(ground);
  const points = route.slice(1).map(middle);
  const out: Point[] = [];
  let at = from;
  let i = 0;
  if (points.length === 0) {
    const goal = route[0] ? middle(route[0]) : from;
    return Math.hypot(goal.x - from.x, goal.z - from.z) > 0.05 ? [goal] : [];
  }
  if (!clear(g, at, points[0]!)) {
    at = middle(route[0]!);
    out.push(at);
  }
  while (i < points.length) {
    let j = points.length - 1;
    while (j > i && !clear(g, at, points[j]!)) j--;
    at = points[j]!;
    out.push(at);
    i = j + 1;
  }
  return out;
}

/**
 * Whether one tile is a step of the grid's from another: one of the eight round it, over no ledge, never cutting a
 * closed corner or a ledge's (world/grid.ts `canStep`).
 */
export function canStep(ground: Ground | Open, a: Tile, b: Tile): boolean {
  return stepOver(groundOf(ground), a.x, a.z, b.x, b.z);
}

/**
 * The tiles a body's middle passes walking from a point through others in straight lines, each a step of the grid's
 * from the one before: the tiles it crosses, two straight steps round a corner drawn together as the diagonal step
 * where that is a step of the grid's (so the walk's length is near the line's).
 */
export function tilesAlong(ground: Ground | Open, from: Point, points: readonly Point[]): Tile[] {
  const crossed: Tile[] = [{ x: Math.floor(from.x), z: Math.floor(from.z) }];
  let a = from;
  for (const b of points) {
    // Amanatides and Woo's walk over the squares a segment crosses.
    let tx = Math.floor(a.x);
    let tz = Math.floor(a.z);
    const end = { x: Math.floor(b.x), z: Math.floor(b.z) };
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);
    const deltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const deltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
    let maxX = stepX > 0 ? (tx + 1 - a.x) * deltaX : stepX < 0 ? (a.x - tx) * deltaX : Infinity;
    let maxZ = stepZ > 0 ? (tz + 1 - a.z) * deltaZ : stepZ < 0 ? (a.z - tz) * deltaZ : Infinity;
    for (let guard = 0; (tx !== end.x || tz !== end.z) && guard < 4096; guard++) {
      if (Math.abs(maxX - maxZ) < 1e-9) {
        tx += stepX;
        tz += stepZ;
        maxX += deltaX;
        maxZ += deltaZ;
      } else if (maxX < maxZ) {
        tx += stepX;
        maxX += deltaX;
      } else {
        tz += stepZ;
        maxZ += deltaZ;
      }
      crossed.push({ x: tx, z: tz });
    }
    a = b;
  }
  return joinCorners(ground, crossed);
}

/** Two straight steps that turn a corner drawn together as the one diagonal step, where it is a step of the grid's. */
export function joinCorners(ground: Ground | Open, tiles: readonly Tile[]): Tile[] {
  const g = groundOf(ground);
  const out: Tile[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    const last = out.at(-1);
    if (last && last.x === t.x && last.z === t.z) continue;
    const before = out.at(-2);
    if (before && last && Math.abs(t.x - before.x) === 1 && Math.abs(t.z - before.z) === 1 && canStep(g, before, t)) out[out.length - 1] = t;
    else out.push(t);
  }
  return out;
}
