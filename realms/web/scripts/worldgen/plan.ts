// A town's street plan, laid before anything is built (design.md A6; format.ts, `TownPlan`): the streets as paths of
// tiles - loops (the lane inside the walls, a clan's or an elfhame's rings) and lines (the grid's streets, the spokes,
// a village's high street and back lanes, each gate's way in) - cut where they meet into a graph of junctions and the
// ways between them. A line is walked from where it starts until it meets a loop (or, for a gate's way in, any street),
// so every street ends at another; the graph then loses what would end nowhere (`prune`), lanes the plan can spare
// (`thin`) and the lanes through a landmark's ground (`clear`), and is never left in two pieces.

import type { StreetWay, TownSquare, XZ } from "../../src/world/format";
import { inSquare, lineTiles, pathTiles, wayTiles } from "../../src/world/streets";

interface Path {
  readonly points: XZ[];
  readonly width: number;
  readonly main: boolean;
  readonly closed: boolean;
  /** Its middle tiles in order, and the segment of `points` each lies on. */
  readonly tiles: [number, number][];
  readonly segment: number[];
}

export interface Way extends StreetWay {
  readonly via: XZ[];
  /** A gate's way in: never cleared or thinned. */
  readonly gate: boolean;
  /** Part of a loop (the lane inside the walls, a ring): kept when lanes are thinned. */
  readonly loop: boolean;
}

const key = (x: number, z: number) => `${x},${z}`;

/** The streets being planned, as paths of middle tiles, then as a graph of nodes and ways. */
export class Planner {
  private readonly paths: Path[] = [];
  /** The paths through each middle tile. */
  private readonly through = new Map<string, number[]>();
  /** Tiles of the loops, where a line stops. */
  private readonly loopTiles = new Set<string>();

  constructor(
    /** Whether a street may run over a tile: inside the town's outline, off its wall. */
    private readonly ok: (x: number, z: number) => boolean,
  ) {}

  private add(points: XZ[], width: number, main: boolean, closed: boolean): void {
    const tiles: [number, number][] = [];
    const segment: number[] = [];
    const ring = closed ? [...points, points[0]!] : points;
    for (let k = 1; k < ring.length; k++) {
      const run = lineTiles(ring[k - 1]!, ring[k]!);
      for (let t = k === 1 ? 0 : 1; t < run.length; t++) {
        if (closed && k === ring.length - 1 && t === run.length - 1) continue;
        tiles.push(run[t]!);
        segment.push(k - 1);
      }
    }
    if (points.length === 1) {
      tiles.push([points[0]![0], points[0]![1]]);
      segment.push(0);
    }
    const id = this.paths.length;
    this.paths.push({ points, width, main, closed, tiles, segment });
    for (const [x, z] of tiles) {
      const k = key(x, z);
      const list = this.through.get(k);
      if (!list) this.through.set(k, [id]);
      else if (!list.includes(id)) list.push(id);
      if (closed) this.loopTiles.add(k);
    }
  }

  /** A loop through its corners; false (and nothing added) when a tile of it is off the town's ground. */
  loop(corners: XZ[], width: number, main = false): boolean {
    const tiles = pathTiles([...corners, corners[0]!]);
    if (tiles.some(([x, z]) => !this.ok(x, z))) return false;
    this.add(corners, width, main, true);
    return true;
  }

  /** A line through its points; false (and nothing added) when a tile of it is off the town's ground. */
  line(points: XZ[], width: number, main = false, anywhere = false): boolean {
    if (!anywhere && pathTiles(points).some(([x, z]) => !this.ok(x, z))) return false;
    this.add(points, width, main, false);
    return true;
  }

  isLoop = (x: number, z: number): boolean => this.loopTiles.has(key(x, z));
  isStreet = (x: number, z: number): boolean => this.through.has(key(x, z));

  /**
   * Walks from a tile a step at a time along (dx, dz) until a tile of a loop (or with `any`, of any street), and gives
   * the tile it meets; null when it leaves the town's ground first (`free` steps past the start may lie off it: a
   * gate's way in from outside), or goes farther than `limit`.
   */
  walk(from: XZ, dx: number, dz: number, limit: number, o: { any?: boolean; free?: number } = {}): XZ | null {
    for (let s = 1; s <= limit; s++) {
      const x = from[0] + dx * s;
      const z = from[1] + dz * s;
      if (o.any ? this.isStreet(x, z) : this.isLoop(x, z)) return [x, z];
      if (s > (o.free ?? 0) && !this.ok(x, z)) return null;
    }
    return null;
  }

  /** The graph: a node at each end of a line and where paths meet, a way along each path between its nodes. */
  graph(squares: readonly TownSquare[], gates: readonly XZ[]): Graph {
    const nodes: XZ[] = [];
    const nodeAt = new Map<string, number>();
    const node = (x: number, z: number): number => {
      const k = key(x, z);
      let n = nodeAt.get(k);
      if (n === undefined) {
        n = nodes.length;
        nodes.push([x, z]);
        nodeAt.set(k, n);
      }
      return n;
    };
    const ways: Way[] = [];
    const gateKeys = new Set(gates.map(([x, z]) => key(x, z)));
    this.paths.forEach((p) => {
      const at: number[] = [];
      p.tiles.forEach(([x, z], k) => {
        const shared = (this.through.get(key(x, z))?.length ?? 0) > 1;
        if (shared || (!p.closed && (k === 0 || k === p.tiles.length - 1))) at.push(k);
      });
      if (p.closed && at.length === 0) at.push(0);
      const pairs: [number, number][] = [];
      for (let k = 1; k < at.length; k++) pairs.push([at[k - 1]!, at[k]!]);
      if (p.closed) pairs.push([at[at.length - 1]!, at[0]! + p.tiles.length]);
      const isGate = !p.closed && p.tiles.some(([x, z]) => gateKeys.has(key(x, z)));
      for (const [i, j] of pairs) {
        const n = p.tiles.length;
        const [ax, az] = p.tiles[i % n]!;
        const [bx, bz] = p.tiles[j % n]!;
        if (j - i < 1) continue;
        // The corners passed between: the starts of the segments after i's, up to j's.
        const via: XZ[] = [];
        const count = p.points.length;
        const last = j >= n ? p.segment[j % n]! + count : p.segment[j % n]!;
        for (let t = p.segment[i % n]! + 1; t <= last; t++) {
          const c = p.points[t % count]!;
          if ((c[0] !== ax || c[1] !== az) && (c[0] !== bx || c[1] !== bz)) via.push(c);
        }
        const a = node(ax, az);
        const b = node(bx, bz);
        if (a === b) continue;
        ways.push({ a, b, width: p.width, ...(p.main ? { main: true } : {}), via, gate: isGate, loop: p.closed });
      }
    });
    return new Graph(nodes, ways, squares, gates.map(([x, z]) => node(x, z)));
  }
}

/** The streets as a graph, losing ways as the plan needs. */
export class Graph {
  readonly ways: (Way | null)[];

  constructor(
    readonly nodes: XZ[],
    ways: Way[],
    readonly squares: readonly TownSquare[],
    /** The gates' nodes: a road goes on from each, so a way ending there ends nowhere. */
    readonly gates: readonly number[],
  ) {
    this.ways = ways;
  }

  get live(): Way[] {
    return this.ways.filter((w): w is Way => w !== null);
  }

  private inSquares(n: number): number {
    const [x, z] = this.nodes[n]!;
    return this.squares.some((s) => inSquare(s, x, z)) ? 1 : 0;
  }

  /** The ways at a node, a square it stands in and a road going on from it. */
  degree(n: number): number {
    let d = this.inSquares(n) + (this.gates.includes(n) ? 1 : 0);
    for (const w of this.ways) if (w && (w.a === n || w.b === n)) d++;
    return d;
  }

  /** Removes every way that would end nowhere, again and again, until none does. */
  prune(): void {
    for (let changed = true; changed; ) {
      changed = false;
      for (let k = 0; k < this.ways.length; k++) {
        const w = this.ways[k];
        if (!w) continue;
        if (this.degree(w.a) <= 1 || this.degree(w.b) <= 1) {
          this.ways[k] = null;
          changed = true;
        }
      }
    }
  }

  /** Whether every way is reached from every other, through the nodes and the squares. */
  connected(): boolean {
    const live = this.live;
    if (live.length === 0) return false;
    const seen = new Set<number>();
    const stack = [live[0]!.a];
    seen.add(live[0]!.a);
    const squareOf = (n: number) => this.squares.findIndex((s) => inSquare(s, this.nodes[n]![0], this.nodes[n]![1]));
    while (stack.length > 0) {
      const n = stack.pop()!;
      const sq = squareOf(n);
      for (const w of live) {
        for (const [p, q] of [[w.a, w.b], [w.b, w.a]] as const) {
          if (p === n && !seen.has(q)) {
            seen.add(q);
            stack.push(q);
          }
        }
      }
      if (sq >= 0) {
        for (const w of live) {
          for (const m of [w.a, w.b]) {
            if (!seen.has(m) && squareOf(m) === sq) {
              seen.add(m);
              stack.push(m);
            }
          }
        }
      }
    }
    return live.every((w) => seen.has(w.a) && seen.has(w.b)) && this.gates.every((g) => seen.has(g));
  }

  /** Tries a change, keeping it only when nothing is left ending nowhere it should not, and the plan in one piece. */
  private attempt(remove: number[], keep: (w: Way) => boolean): boolean {
    const before = [...this.ways];
    for (const k of remove) this.ways[k] = null;
    this.prune();
    if (!this.connected() || !before.every((w, k) => !w || !keep(w) || this.ways[k] !== null)) {
      this.ways.splice(0, this.ways.length, ...before);
      return false;
    }
    return true;
  }

  /**
   * Clears ground for a landmark: every lane through the rectangle goes (with any way left ending nowhere), unless a
   * main street or a gate's way crosses it, or the plan would fall in two. False, and nothing changed, when it cannot.
   */
  clear(x0: number, z0: number, w: number, d: number): boolean {
    const hits: number[] = [];
    for (let k = 0; k < this.ways.length; k++) {
      const way = this.ways[k];
      if (!way) continue;
      if (!wayTiles(this, way).some(([x, z]) => x >= x0 && x < x0 + w && z >= z0 && z < z0 + d)) continue;
      if (way.main || way.gate) return false;
      hits.push(k);
    }
    for (const s of this.squares) if (s.x < x0 + w && s.x + s.w > x0 && s.z < z0 + d && s.z + s.d > z0) return false;
    return this.attempt(hits, (way) => way.main || way.gate);
  }

  /**
   * Thins the lanes: about `share` of those between two junctions go, in random order - never a loop's or a main
   * street, nor a lane off a main street, so the ways from the main streets into the blocks all stay.
   */
  thin(share: number, random: () => number): void {
    const onMain = new Set<number>();
    for (const w of this.ways) if (w?.main) onMain.add(w.a).add(w.b);
    const lanes = this.ways.map((w, k) => ({ w, k })).filter(({ w }) => w && !w.main && !w.gate && !w.loop && !onMain.has(w.a) && !onMain.has(w.b));
    let goal = Math.round(lanes.length * share);
    for (const { k } of lanes.map((l) => ({ ...l, r: random() })).sort((p, q) => p.r - q.r)) {
      if (goal <= 0) break;
      const w = this.ways[k];
      if (!w || this.degree(w.a) < 3 || this.degree(w.b) < 3) continue;
      if (this.attempt([k], (way) => way.main || way.gate || way.loop)) goal--;
    }
  }
}

/** The polygon `poly` moved in by `d` tiles: each edge pushed toward `centre`, the corners where the pushed edges meet. */
export function inset(poly: readonly XZ[], centre: XZ, d: number): XZ[] {
  const n = poly.length;
  const lines = poly.map((a, k) => {
    const b = poly[(k + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = -(b[1] - a[1]) / len;
    let nz = (b[0] - a[0]) / len;
    if (nx * (centre[0] - (a[0] + b[0]) / 2) + nz * (centre[1] - (a[1] + b[1]) / 2) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return { px: a[0] + nx * d, pz: a[1] + nz * d, dx: b[0] - a[0], dz: b[1] - a[1], nx, nz };
  });
  return poly.map((c, k) => {
    const p = lines[(k + n - 1) % n]!;
    const q = lines[k]!;
    const cross = p.dx * q.dz - p.dz * q.dx;
    if (Math.abs(cross) < 1e-6 * Math.hypot(p.dx, p.dz) * Math.hypot(q.dx, q.dz) + 1e-9) return [Math.round(c[0] + q.nx * d), Math.round(c[1] + q.nz * d)] as const;
    const t = ((q.px - p.px) * q.dz - (q.pz - p.pz) * q.dx) / cross;
    let x = p.px + p.dx * t;
    let z = p.pz + p.dz * t;
    // A sharp corner's meeting point flies off: keep it near the corner.
    if (Math.hypot(x - c[0], z - c[1]) > d * 2.5) {
      x = c[0] + ((p.nx + q.nx) / 2) * d;
      z = c[1] + ((p.nz + q.nz) / 2) * d;
    }
    return [Math.round(x), Math.round(z)] as const;
  });
}
