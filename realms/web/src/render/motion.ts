import { type Ground, type Open, type Pass, type Tile, canStep as stepOver, flatGround } from "../world/grid";
import { HOP, TEXELS_PER_TILE } from "../world/format";

// The player's body on the grid, between tile centres: a square of BODY tiles either way of its middle that never
// overlaps a closed tile, nor stands across a ledge (a bank higher than a step between two open tiles: world/grid.ts).
// Holding the button walks it straight at the cursor (`slide`): what is in the way stops the part of the step that goes
// into it and keeps the part along it, so it slides along a wall or the brink of a ledge and stops only where nothing is
// left to go, and a corner it only brushes turns it round the corner. A click walks the grid's path pulled straight
// (`smooth`): from where the body stands to the furthest corner of the path it can walk to in a line, and on from there,
// so a click walk is a few straight legs, not a staircase of eight-way steps. Both keep the grid's rule: a body whose
// middle goes from one tile to a diagonal one overlaps all four tiles at the corner, so it never cuts the corner of a
// closed tile or a ledge - so every line its middle walks crosses tiles each a step of the grid's from the one before
// (`legClear`), which is the rule the server checks the walks the relay tells it by (net/relay.ts).
//
// A ledge a level high (a hop, format.ts HOP) is crossed in one hop, never stood across: from a stand flush with its
// brink on one side, straight across, to a stand flush with it on the other (`Hop`), at walking pace - a held walk
// pushed into it takes it (`hopToward`), a click's walk goes to the brink and over (`smooth`). While the body is across
// it, the figure's height is an arc from the one floor to the other (`hopUnder`, `hopHeight`), wherever it is along the
// crossing - so another player's figure walking the points the relay sends, or a mob walking tile to tile, arcs over
// the edge alike.
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
const swap = (g: Ground): Ground => {
  const hop = g.hop;
  return {
    open: (a, b) => g.open(b, a),
    pass: (a1, b1, a2, b2) => g.pass(b1, a1, b2, a2),
    ...(hop ? { hop: (a1: number, b1: number, a2: number, b2: number) => hop(b1, a1, b2, a2) } : {}),
  };
};

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
 * A body standing off its tile's middle where the path's first step is not clear goes to the middle first. Where the
 * path hops a ledge (its step straight across an edge that does not pass), the walk goes to the brink - the stand flush
 * with it in the middle of the tile's row - and over it to the stand flush on the other side (`hopOf`), and is pulled
 * straight afresh from there.
 */
export function smooth(ground: Ground | Open, from: Point, route: readonly Tile[]): Point[] {
  const g = groundOf(ground);
  if (route.length < 2) {
    const goal = route[0] ? middle(route[0]) : from;
    return Math.hypot(goal.x - from.x, goal.z - from.z) > 0.05 ? [goal] : [];
  }
  const out: Point[] = [];
  const add = (p: Point) => {
    const last = out.at(-1) ?? from;
    if (Math.hypot(p.x - last.x, p.z - last.z) > 1e-9) out.push(p);
  };
  let at = from;
  let start = 0;
  for (;;) {
    // The run of the path walked before its next hop, if any: from route[start] to route[k].
    let k = start;
    const hops = (a: Tile, b: Tile) => (a.x === b.x || a.z === b.z) && !g.pass(a.x, a.z, b.x, b.z);
    while (k + 1 < route.length && !hops(route[k]!, route[k + 1]!)) k++;
    const hop = k + 1 < route.length ? hopOf(route[k]!, route[k + 1]!) : null;
    const points = route.slice(start + 1, k + 1).map(middle);
    if (hop) {
      if (points.length > 0) points[points.length - 1] = hop.from;
      else points.push(hop.from);
    }
    if (points.length > 0 && !clear(g, at, points[0]!)) {
      at = middle(route[start]!);
      add(at);
    }
    let i = 0;
    while (i < points.length) {
      let j = points.length - 1;
      while (j > i && !clear(g, at, points[j]!)) j--;
      at = points[j]!;
      add(at);
      i = j + 1;
    }
    if (!hop) return out;
    add(hop.to);
    at = hop.to;
    start = k + 1;
  }
}

/** A hop: straight across a ledge from a stand flush with its brink on one side to a stand flush with it on the other. */
export interface Hop {
  readonly from: Point;
  readonly to: Point;
}

/** A body's hop from one tile to a side-by-side one across the edge between them, in the middle of the tiles' row. */
export function hopOf(a: Tile, b: Tile, r = BODY): Hop {
  if (a.z === b.z) {
    const edge = Math.max(a.x, b.x);
    const dir = Math.sign(b.x - a.x);
    return { from: { x: edge - dir * r, z: a.z + 0.5 }, to: { x: edge + dir * r, z: a.z + 0.5 } };
  }
  const edge = Math.max(a.z, b.z);
  const dir = Math.sign(b.z - a.z);
  return { from: { x: a.x + 0.5, z: edge - dir * r }, to: { x: a.x + 0.5, z: edge + dir * r } };
}

/** How much of a push must go straight into a hop's edge for a held walk to take it: within 60 degrees of straight across. */
const HOP_PUSH = 0.5;

/**
 * The hop a held walk steered at `target` takes from where the body stands, or null: the body flush with the brink of
 * the line of tiles it is pushed into most (`HOP_PUSH`), the target past that edge, each edge of it the body spans
 * either no ledge or a hop and one at least a hop, and the body fitting flush on the other side. A ground with no
 * hops (one who does not hop) has none.
 */
export function hopToward(ground: Ground, x: number, z: number, target: Point, r = BODY): Hop | null {
  if (!ground.hop) return null;
  const dx = target.x - x;
  const dz = target.z - z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return null;
  const xFirst = Math.abs(dx) >= Math.abs(dz);
  const d = xFirst ? dx : dz;
  if (Math.abs(d) < len * HOP_PUSH) return null;
  // In the ground's terms along the push (a) and across it (b).
  const g = xFirst ? ground : swap(ground);
  const a = xFirst ? x : z;
  const b = xFirst ? z : x;
  const edge = Math.round(a + Math.sign(d) * r);
  if (Math.abs(a + Math.sign(d) * r - edge) > 1e-6 || (d > 0 ? (xFirst ? target.x : target.z) <= edge : (xFirst ? target.x : target.z) >= edge)) return null;
  const from = d > 0 ? edge - 1 : edge;
  const line = d > 0 ? edge : edge - 1;
  const lo = Math.floor(b - r + E);
  const hi = Math.floor(b + r - E);
  let hops = 0;
  for (let row = lo; row <= hi; row++) {
    if (!g.open(line, row)) return null;
    if (g.pass(from, row, line, row)) continue;
    if (!g.hop!(from, row, line, row)) return null;
    hops++;
  }
  if (hops === 0) return null;
  const land = edge + Math.sign(d) * r;
  const to = xFirst ? { x: land, z } : { x, z: land };
  if (!fits(ground, to.x, to.z, r)) return null;
  return { from: { x, z }, to };
}

/** Where a body is across a hop's edge: the stands flush either side of it, and how far across it is, 0 to 1. */
export interface HopSpan extends Hop {
  readonly s: number;
}

/**
 * Whether a body (its middle at x, z) stands across a hop's edge, and where along the crossing: the edge it spans
 * between two open tiles of its middle's row (or another row it spans) that does not pass and is a hop. Null
 * otherwise, or on ground with no hops.
 */
export function hopUnder(ground: Ground, x: number, z: number, r = BODY): HopSpan | null {
  const hop = ground.hop;
  if (!hop) return null;
  const x0 = Math.floor(x - r + E);
  const x1 = Math.floor(x + r - E);
  const z0 = Math.floor(z - r + E);
  const z1 = Math.floor(z + r - E);
  const across = (ax: number, az: number, bx: number, bz: number) => ground.open(ax, az) && ground.open(bx, bz) && !ground.pass(ax, az, bx, bz) && hop(ax, az, bx, bz);
  const rows = (lo: number, hi: number, mid: number) => [mid, ...Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((v) => v !== mid)];
  if (x1 === x0 + 1) {
    for (const row of rows(z0, z1, Math.floor(z))) {
      if (across(x0, row, x1, row)) return { from: { x: x1 - r, z }, to: { x: x1 + r, z }, s: (x - (x1 - r)) / (2 * r) };
    }
  }
  if (z1 === z0 + 1) {
    for (const col of rows(x0, x1, Math.floor(x))) {
      if (across(col, z0, col, z1)) return { from: { x, z: z1 - r }, to: { x, z: z1 + r }, s: (z - (z1 - r)) / (2 * r) };
    }
  }
  return null;
}

/** How high a hop's arc rises over the straight line between its floors at its middle, world units. */
export const HOP_LIFT = 0.35;
/**
 * The most a figure's height changes along a hop for a tile its middle moves, world units: the steepest the arc goes (a
 * level's rise eased in, and the lift) over the crossing's length - what a jump watch allows a hopping figure.
 */
export const HOP_STEEP = (1.5 * (HOP / TEXELS_PER_TILE) + 4 * HOP_LIFT) / (2 * BODY);

/**
 * A figure's height across a hop's edge: from the floor at the stand on one side to the floor at the stand on the
 * other, eased, over an arc HOP_LIFT high - up and over, or off and down. `floor` is the floor's height at a point.
 */
export function hopHeight(span: HopSpan, floor: (x: number, z: number) => number): number {
  const s = Math.min(1, Math.max(0, span.s));
  const a = floor(span.from.x, span.from.z);
  const b = floor(span.to.x, span.to.z);
  return a + (b - a) * s * s * (3 - 2 * s) + 4 * HOP_LIFT * s * (1 - s);
}

/**
 * Whether one tile is a step of the grid's from another: one of the eight round it, over no ledge but a hop straight
 * across (on a hopper's ground), never cutting a closed corner or a ledge's (world/grid.ts `canStep`).
 */
export function canStep(ground: Ground | Open, a: Tile, b: Tile): boolean {
  return stepOver(groundOf(ground), a.x, a.z, b.x, b.z);
}

/** How near, in the line's own measure, two crossings are one through a corner (as the server takes it). */
const CORNER = 1e-9;

/**
 * Whether a straight line walked from one point to another keeps the grid's rule, as the server checks a walk told
 * (Places.cs `CanWalk`, exactly): the tiles it crosses, in turn, each a step (`canStep`) from the one before - through a
 * tile's corner, the diagonal step. A line the body's middle walks always does.
 */
export function legClear(ground: Ground | Open, a: Point, b: Point): boolean {
  const g = groundOf(ground);
  let tx = Math.floor(a.x);
  let tz = Math.floor(a.z);
  const ex = Math.floor(b.x);
  const ez = Math.floor(b.z);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const stepX = Math.sign(dx);
  const stepZ = Math.sign(dz);
  const deltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const deltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let maxX = stepX > 0 ? (tx + 1 - a.x) * deltaX : stepX < 0 ? (a.x - tx) * deltaX : Infinity;
  let maxZ = stepZ > 0 ? (tz + 1 - a.z) * deltaZ : stepZ < 0 ? (a.z - tz) * deltaZ : Infinity;
  // Amanatides and Woo's walk over the squares a segment crosses, before its end; an end on the edge of the tile reached
  // (a point on a tile's edge is the tile east or south of it) is a step on to that tile.
  for (let guard = 0; Math.min(maxX, maxZ) < 1 - CORNER && guard < 4096; guard++) {
    const wx = tx;
    const wz = tz;
    if (Math.abs(maxX - maxZ) < CORNER) {
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
    if (!stepOver(g, wx, wz, tx, tz)) return false;
  }
  if (tx === ex && tz === ez) return true;
  return Math.max(Math.abs(ex - tx), Math.abs(ez - tz)) === 1 && stepOver(g, tx, tz, ex, ez);
}
