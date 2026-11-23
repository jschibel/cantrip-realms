// A cave's walls as living rock (a wall look's `crag`, walls.ts): not a block to a tile but a crag whose outline wanders
// and whose top rises and falls. Every wall tile's outline is eight points on the half-tile lattice (its corners and the
// middles of its sides); where a point touches open ground it is moved back into the rock - along a run of wall a little,
// a jutting corner a lot, a corner of open ground cut into round - and every top point is raised or lowered, a tall wall's
// sloping down toward a lower one beside it. Each point is moved and raised by where it is alone, so neighbouring tiles
// share it and their rock meets without a seam. The floor's ground is drawn on under the rock (`groundUnder`,
// assemble.ts), so what a wall stands back from is floor; the rock never stands over a tile that is walked
// (walls.test.ts). Beyond the drawn walls darker rock (`shoulders`) falls away into the dark, so the walls' tops do not
// end in a hard line against the black; over a chasm the edge juts out in lips of rock that drop a ragged way (`chasm`).

import { type Face, type MeshBuilder } from "../art/paint/builder";
import { flat } from "../art/paint/materials";
import { hash2 } from "../art/paint/pixmap";
import { valueNoise } from "../art/paint/procedural";
import { TEXELS } from "../render/lighting";
import { VOID, WALL } from "./plan";
import type { WallContext } from "./walls";

export interface Crag {
  /** How far a wall stands back from open ground along a run at most, and at a jutting corner, world units (under half a tile). */
  readonly recess: number;
  readonly corner: number;
  /** How much a full wall's top rises and falls from point to point (a lower wall's in proportion). */
  readonly relief: number;
  /** The rock beyond the walls going into the dark: next to them, and further off. */
  readonly shoulder: Face;
  readonly deep: Face;
}

type V3 = readonly [number, number, number];

/** A tile's outline on the half-tile lattice, clockwise seen from above (north up): NW, N, NE, E, SE, S, SW, W. */
const OUTLINE: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
/** The neighbour across each side: segments 0-1 face north, 2-3 east, 4-5 south, 6-7 west. */
const ACROSS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** How a side's face is tiled: the world axis across it (up is y). */
const ACROSS_U: readonly ((c: V3) => number)[] = [(c) => -c[0], (c) => -c[2], (c) => c[0], (c) => c[2]];
const PX = 1 / 16;
/** How far, in tiles, the rock beyond the walls is drawn. */
const REACH = 3;

/** A point of a tile's outline, where it is drawn. */
interface Point {
  readonly i: number;
  readonly j: number;
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

export class Rock {
  private readonly shifts = new Map<number, readonly [number, number]>();
  private depths: Float64Array | null = null;
  private readonly rim: Face;

  constructor(
    private readonly ctx: WallContext,
    private readonly crag: Crag,
  ) {
    this.rim = { mat: flat(ctx.look.rim) };
  }

  /** Whether the floor's ground is drawn under a wall tile, so its rock may stand back: every drawn wall. */
  groundUnder(x: number, z: number): boolean {
    return this.ctx.at(x, z) === WALL && this.ctx.kindAt(x, z) !== "none";
  }

  /** One wall tile's crag, `h` its height (its top rises and falls about it). */
  block(b: MeshBuilder, x: number, z: number, h: number): void {
    const { lowest } = this.ctx;
    const pts = OUTLINE.map(([a, c]) => this.point(x, z, 2 * x + a, 2 * z + c, h));
    const mid: V3 = [x + 0.5, this.top(x, z, h, 2 * x + 1, 2 * z + 1), z + 0.5];
    // The top: facets fanned about the middle.
    for (let k = 0; k < 8; k++) {
      const p = pts[k]!;
      const q = pts[(k + 1) % 8]!;
      this.flatPolygon(b, this.ctx.look.top, [mid, [q.x, q.y, q.z], [p.x, p.y, p.z]]);
    }
    // The faces: toward open ground from the floor up, toward a lower wall what shows above it; a lit rim along a top
    // over open ground, so it reads as a wall's top.
    for (let k = 0; k < 8; k++) {
      const side = k >> 1;
      const nx = x + ACROSS[side]![0];
      const nz = z + ACROSS[side]![1];
      const open = lowest(nx, nz) < 0;
      const chasm = this.ctx.at(nx, nz) === VOID;
      const p = pts[k]!;
      const q = pts[(k + 1) % 8]!;
      const p0 = chasm ? -this.drop(p.i, p.j) : open ? 0 : Math.min(p.y, this.under(nx, nz, p));
      const q0 = chasm ? -this.drop(q.i, q.j) : open ? 0 : Math.min(q.y, this.under(nx, nz, q));
      const pTall = p.y - p0 > 1e-4;
      const qTall = q.y - q0 > 1e-4;
      const face = open ? this.ctx.look.body : this.ctx.look.side;
      const u = ACROSS_U[side]!;
      const qb: V3 = [q.x, q0, q.z];
      const pb: V3 = [p.x, p0, p.z];
      const pt: V3 = [p.x, p.y, p.z];
      const qt: V3 = [q.x, q.y, q.z];
      if (pTall && qTall) this.tiledPolygon(b, face, [qb, pb, pt, qt], u, (c) => c[1]);
      else if (pTall) this.tiledPolygon(b, face, [qb, pb, pt], u, (c) => c[1]);
      else if (qTall) this.tiledPolygon(b, face, [qb, pt, qt], u, (c) => c[1]);
      if (open) {
        const lift = 0.004;
        const inner = (s: Point): V3 => {
          const dx = mid[0] - s.x;
          const dz = mid[2] - s.z;
          const t = (1.5 * PX) / Math.max(1e-6, Math.hypot(dx, dz));
          return [s.x + dx * t, s.y + (mid[1] - s.y) * t + lift, s.z + dz * t];
        };
        this.tiledPolygon(b, this.rim, [[p.x, p.y + lift, p.z], inner(p), inner(q), [q.x, q.y + lift, q.z]], (c) => c[0], (c) => -c[2]);
      }
    }
  }

  /**
   * The rock beyond the drawn walls, out to `REACH` tiles from them: a ring of dark rock that meets the walls' tops
   * where it touches them and falls away from them, then darker rock low down, its far edge ragged against the dark -
   * so the walls' tops do not end in a hard line against the black, and the solid rock inside a cave's pillars is rock.
   */
  shoulders(b: MeshBuilder): void {
    const { w, d } = this.ctx;
    for (let z = -REACH; z < d + REACH; z++) {
      for (let x = -REACH; x < w + REACH; x++) {
        const depth = this.depth(x, z);
        if (depth < 1 || depth > REACH) continue;
        const pts: V3[] = OUTLINE.map(([a, c]) => {
          const i = 2 * x + a;
          const j = 2 * z + c;
          const [sx, sz] = this.shift(i, j);
          return [i / 2 + sx, this.met(i, j) ?? this.fall(i, j), j / 2 + sz];
        });
        const mid: V3 = [x + 0.5, pts.reduce((s, p) => s + p[1], 0) / 8 - 0.08, z + 0.5];
        const face = depth < REACH ? this.crag.shoulder : this.crag.deep;
        for (let k = 0; k < 8; k++) this.flatPolygon(b, face, [mid, pts[(k + 1) % 8]!, pts[k]!]);
      }
    }
  }

  /** The beyond's rock at a point no drawn wall touches: lower the further it is from the walls. */
  private fall(i: number, j: number): number {
    let near = REACH;
    for (const [tx, tz] of this.around(i, j)) near = Math.min(near, this.depth(tx, tz));
    return Math.max(0.04, 0.42 - 0.12 * (near - 1) + 0.1 * this.field(i, j));
  }

  /** How many tiles a wall tile is from the nearest drawn wall, through rock (0 drawn, -1 not rock, past REACH Infinity). */
  private depth(x: number, z: number): number {
    const { w, d, at, kindAt } = this.ctx;
    const gw = w + 2 * (REACH + 1);
    const gd = d + 2 * (REACH + 1);
    if (!this.depths) {
      const depths = new Float64Array(gw * gd).fill(Infinity);
      const queue: number[] = [];
      for (let gz = 0; gz < gd; gz++) {
        for (let gx = 0; gx < gw; gx++) {
          const [tx, tz] = [gx - REACH - 1, gz - REACH - 1];
          if (at(tx, tz) !== WALL) depths[gz * gw + gx] = -1;
          else if (kindAt(tx, tz) !== "none") {
            depths[gz * gw + gx] = 0;
            queue.push(gz * gw + gx);
          }
        }
      }
      for (let n = 0; n < queue.length; n++) {
        const g = queue[n]!;
        const next = depths[g]! + 1;
        if (next > REACH) continue;
        const gx = g % gw;
        const gz = (g - gx) / gw;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const [nx, nz] = [gx + dx, gz + dz];
            if (nx < 0 || nz < 0 || nx >= gw || nz >= gd) continue;
            const ng = nz * gw + nx;
            if (depths[ng]! <= next) continue;
            depths[ng] = next;
            queue.push(ng);
          }
        }
      }
      this.depths = depths;
    }
    const [gx, gz] = [x + REACH + 1, z + REACH + 1];
    if (gx < 0 || gz < 0 || gx >= gw || gz >= gd) return Infinity;
    return this.depths[gz * gw + gx]!;
  }

  /**
   * The ground's edges over the void (a chasm): a lip of rock out over it, wider in places, its face dropping a ragged
   * way into the dark - so the chasm's edge is no line of the tiles. The walls' faces over it drop the same way.
   */
  chasm(b: MeshBuilder): void {
    const { w, d, at } = this.ctx;
    const same = (p: V3, q: V3) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[2] - q[2]) < 1e-6;
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const c = at(x, z);
        if (c === WALL || c === VOID) continue;
        const y = c === 1 ? 0 : -0.18;
        for (let k = 0; k < 8; k++) {
          const side = k >> 1;
          if (at(x + ACROSS[side]![0], z + ACROSS[side]![1]) !== VOID) continue;
          const ends = [OUTLINE[k]!, OUTLINE[(k + 1) % 8]!].map(([a, c2]) => {
            const i = 2 * x + a;
            const j = 2 * z + c2;
            const [sx, sz] = this.lip(i, j);
            const depth = this.drop(i, j) + y;
            return { edge: [i / 2, y, j / 2] as V3, out: [i / 2 + sx, y, j / 2 + sz] as V3, low: [i / 2 + sx, y - depth, j / 2 + sz] as V3 };
          });
          const [p, q] = ends as [(typeof ends)[number], (typeof ends)[number]];
          // The lip's top, a triangle where one end stays put, nothing where both do.
          const top = [p.edge, q.edge, q.out, p.out].filter((v, n, all) => !same(v, all[(n + all.length - 1) % all.length]!));
          if (top.length >= 3) this.flatPolygon(b, this.ctx.look.side, top);
          this.tiledPolygon(b, this.ctx.look.skirt, [q.low, p.low, p.out, q.out], ACROSS_U[side]!, (v) => v[1]);
        }
      }
    }
  }

  /** A drawn wall's height as the rock beyond meets it: a back wall full, the rest as cut down (the sides' cut-away). */
  private still(x: number, z: number): number {
    return this.ctx.kindAt(x, z) === "back" ? this.ctx.full(x, z) : this.ctx.lowAt(x, z);
  }

  /** The highest top of the drawn walls that touch a lattice point, where any does. */
  private met(i: number, j: number): number | null {
    let best: number | null = null;
    for (const [tx, tz] of this.around(i, j)) {
      if (this.ctx.kindAt(tx, tz) === "none") continue;
      const y = this.top(tx, tz, this.still(tx, tz), i, j);
      best = best === null ? y : Math.max(best, y);
    }
    return best;
  }

  /** A neighbour wall's lowest top at a point of the shared side (0 for a wall not drawn). */
  private under(nx: number, nz: number, p: Point): number {
    const n = this.ctx.lowest(nx, nz);
    return n <= 0 ? n : this.top(nx, nz, n, p.i, p.j);
  }

  private point(x: number, z: number, i: number, j: number, h: number): Point {
    const [sx, sz] = this.shift(i, j);
    return { i, j, x: i / 2 + sx, z: j / 2 + sz, y: this.top(x, z, h, i, j) };
  }

  /**
   * A wall tile's top at a lattice point, `h` its height as drawn: where the point touches a wall drawn lower (as the
   * walls stand uncut) the top slopes down toward it - a crag, not a column standing out of a ledge - and it rises and
   * falls there in proportion. The lower `h`, the lower the top at every point, so a neighbour's face toward a wall
   * drawn from that wall's lowest top leaves no gap.
   */
  private top(x: number, z: number, h: number, i: number, j: number): number {
    let y = h;
    let lower = h;
    for (const [tx, tz] of this.around(i, j)) {
      if (tx === x && tz === z) continue;
      const k = this.ctx.kindAt(tx, tz);
      if (k !== "none") lower = Math.min(lower, k === "near" ? this.ctx.lowAt(tx, tz) : this.ctx.full(tx, tz));
    }
    if (lower < h) y = lower + (h - lower) * ((i & 1) === 0 && (j & 1) === 0 ? 0.35 + 0.3 * hash2(i, j, 97) : 0.6 + 0.25 * hash2(i, j, 97));
    return y + this.field(i, j) * this.crag.relief * (y / this.ctx.look.height);
  }

  /** -1 to 1: a rise and fall a couple of tiles across, and a little of each point's own. */
  private field(i: number, j: number): number {
    return (0.75 * valueNoise(i, j, 3, 3 * 4096, 94) + 0.25 * hash2(i, j, 95) - 0.5) * 2;
  }

  /** The tiles round a lattice point: four round a corner, two beside a side's middle, none in a tile's middle. */
  private around(i: number, j: number): (readonly [number, number, number, number])[] {
    const ie = (i & 1) === 0;
    const je = (j & 1) === 0;
    if (ie && je) {
      const [x, z] = [i / 2, j / 2];
      return [[x - 1, z - 1, -1, -1], [x, z - 1, 1, -1], [x - 1, z, -1, 1], [x, z, 1, 1]];
    }
    if (je) return [[(i - 1) / 2, j / 2 - 1, 0, -1], [(i - 1) / 2, j / 2, 0, 1]];
    if (ie) return [[i / 2 - 1, (j - 1) / 2, -1, 0], [i / 2, (j - 1) / 2, 1, 0]];
    return [];
  }

  /**
   * How far a lattice point of a wall is moved: back into the rock, away from the open ground it touches (only where
   * every wall it touches has ground drawn under it); beside the void, out over it. A point of the far edge of the rock beyond
   * the walls (touching only rock) is moved in from the dark past it, so that edge is no straight line either.
   */
  private shift(i: number, j: number): readonly [number, number] {
    const key = (j + 4) * 65536 + (i + 4);
    const known = this.shifts.get(key);
    if (known) return known;
    const { at } = this.ctx;
    if (this.around(i, j).some(([x, z]) => at(x, z) === VOID)) {
      const lip = this.lip(i, j);
      this.shifts.set(key, lip);
      return lip;
    }
    let s = this.push(i, j, (x, z) => {
      const c = at(x, z);
      if (c === WALL) return this.groundUnder(x, z) ? 1 : null;
      return -1;
    });
    if (s[0] === 0 && s[1] === 0) s = this.push(i, j, (x, z) => (at(x, z) !== WALL ? null : this.depth(x, z) <= REACH ? 1 : -1), 0.45);
    this.shifts.set(key, s);
    return s;
  }

  /** How far a point of the edge over the void (ground's or wall's) is moved out over it: wider here, narrower there. */
  private lip(i: number, j: number): readonly [number, number] {
    // Where the void, a wall and open ground meet, the point stays put: moved, the rock would cut across the ground.
    const cells = this.around(i, j).map(([x, z]) => this.ctx.at(x, z));
    if (cells.includes(WALL) && cells.some((c) => c !== WALL && c !== VOID)) return [0, 0];
    return this.push(i, j, (x, z) => (this.ctx.at(x, z) === VOID ? 1 : -1), 0.32);
  }

  /** How far the rock's face drops into the void below a point of its edge. */
  private drop(i: number, j: number): number {
    return 0.9 + 1.6 * hash2(i, j, 96);
  }

  /**
   * A lattice point moved toward the tiles round it that `role` makes 1 and away from those it makes -1 - not at all
   * if it makes any null or the point touches only one kind. A jutting corner moves most (it is rounded off), a corner
   * cut in a little, a point along a straight run unevenly; `corner` is the most it moves at a corner.
   */
  private push(i: number, j: number, role: (x: number, z: number) => 1 | -1 | null, corner = this.crag.corner): readonly [number, number] {
    let vx = 0;
    let vz = 0;
    let into = 0;
    let away = 0;
    for (const [tx, tz, dx, dz] of this.around(i, j)) {
      const r = role(tx, tz);
      if (r === null) return [0, 0];
      vx += r * dx;
      vz += r * dz;
      if (r > 0) into++;
      else away++;
    }
    const len = Math.hypot(vx, vz);
    if (into === 0 || away === 0 || len < 1e-6) return [0, 0];
    const r = hash2(i, j, 93);
    const isCorner = (i & 1) === 0 && (j & 1) === 0;
    const recess = Math.min(this.crag.recess, corner * 0.75);
    const amount = isCorner && into === 1 ? corner * (0.55 + 0.45 * r) : isCorner && into === 3 ? corner * (0.2 + 0.4 * r) : recess * (0.15 + 0.85 * r);
    return [(vx / len) * amount, (vz / len) * amount];
  }

  /** A polygon tiled from above (a top). */
  private flatPolygon(b: MeshBuilder, face: Face, corners: readonly V3[]): void {
    this.tiledPolygon(b, face, corners, (c) => c[0], (c) => -c[2]);
  }

  /** A polygon (counter-clockwise seen from its front) tiled by world coordinates along `u` and `v`, as `quad` tiles. */
  private tiledPolygon(b: MeshBuilder, face: Face, corners: readonly V3[], u: (c: V3) => number, v: (c: V3) => number): void {
    const image = face.mat.map?.image as { width: number; height: number } | undefined;
    const density = (!face.fit && face.density) || TEXELS;
    const w = (image?.width ?? TEXELS) / density;
    const h = (image?.height ?? TEXELS) / density;
    const [ox, oy] = (!face.fit && face.offset) || [0, 0];
    b.polygon(
      face.mat,
      corners,
      corners.map((c) => [(u(c) + ox / TEXELS) / w, (v(c) + oy / TEXELS) / h] as const),
    );
  }
}
