import { HOP, LEDGE, TEXELS_PER_TILE } from "./format";

// Square tiles: the world is a grid (classic 16-bit RPGs are tile-based), and the player walks it by A* in eight
// directions - never cutting a corner past a blocked tile, so a diagonal step is only taken where both of the tiles it
// passes between are open - and never over a ledge but by a hop: a step between side-by-side tiles climbs or drops at
// most LEDGE (world/format.ts), unless both are ramps; a ledge no higher than HOP (a terrace's one level) is hopped
// straight across by those who hop (players always; a mob as its file says), never on a diagonal step; a higher bank is
// a cliff nobody crosses. `canStep` is the one rule of a step, for the A* here, the player's body (render/motion.ts), the
// relay, the lint and the world generator alike; the realm server holds a walk to the same rule (RealmSpace.CanStep).

export interface Tile {
  readonly x: number;
  readonly z: number;
}

/** Whether a tile is open. */
export type Open = (x: number, z: number) => boolean;

/** Whether something holds of the edge between two side-by-side tiles. */
export type Pass = (ax: number, az: number, bx: number, bz: number) => boolean;

/** The tiles walked and the edges between them: what a walk, a body and a path are held to. */
export interface Ground {
  readonly open: Open;
  /** Whether the edge between two side-by-side open tiles is no ledge: it may be walked (or stood) across. */
  readonly pass: Pass;
  /**
   * Whether the edge between two side-by-side open tiles that does not `pass` is a hop (format.ts HOP), crossed by a
   * hop straight across it. Absent, for those who do not hop: no ledge is crossed.
   */
  readonly hop?: Pass;
}

const across: Pass = () => true;

/** Ground of open tiles and no ledges: `open` alone says where one walks. */
export const flatGround = (open: Open): Ground => ({ open, pass: across });

/**
 * Whether a tile is a step of the eight ways from another: open, and its edge with the one before no ledge or (straight
 * across, on the ground of one who hops) a hop; a diagonal only where both tiles it passes between are open and all
 * four edges round the corner are no ledge - never cutting a corner, nor hopping on a diagonal.
 */
export function canStep(g: Ground, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.max(Math.abs(dx), Math.abs(dz)) !== 1 || !g.open(bx, bz)) return false;
  if (dx === 0 || dz === 0) return g.pass(ax, az, bx, bz) || (g.hop !== undefined && g.hop(ax, az, bx, bz));
  return (
    g.open(bx, az) &&
    g.open(ax, bz) &&
    g.pass(ax, az, bx, az) &&
    g.pass(bx, az, bx, bz) &&
    g.pass(ax, az, ax, bz) &&
    g.pass(ax, bz, bx, bz)
  );
}

/** What a hop costs the A*, in steps: a little more than a plain step, so a ramp or level ground about as short is taken instead. */
export const HOP_COST = 2;

/** A floor `LEDGE` above another, and `HOP`, world units. */
const LEDGE_UNITS = LEDGE / TEXELS_PER_TILE;
const HOP_UNITS = HOP / TEXELS_PER_TILE;

export class Grid {
  private readonly open: Uint8Array;
  /** How high each tile's floor stands (a dais, a step), in world units. */
  private readonly floor: Float32Array;
  /** Which tiles are ramps (format.ts RAMP): their steps go up the slope whatever the heights. */
  private readonly ramps: Uint8Array;
  /** The grid as `canStep` and the body take it, for one who hops (a player): its hops crossed. */
  readonly ground: Ground = {
    open: (x, z) => this.walkable(x, z),
    pass: (ax, az, bx, bz) => this.passes(ax, az, bx, bz),
    hop: (ax, az, bx, bz) => this.hops(ax, az, bx, bz),
  };
  /** The grid for one who does not hop: no ledge crossed. */
  readonly still: Ground = { open: this.ground.open, pass: this.ground.pass };

  /** The grid as one who hops, or does not, walks it. */
  groundFor(hops: boolean): Ground {
    return hops ? this.ground : this.still;
  }

  /**
   * A grid `width` by `height` tiles whose first tile is (x0, z0) in the world: tiles are always named by their world
   * coordinates, which may be negative (the country west of the town gate).
   */
  constructor(
    readonly width: number,
    readonly height: number,
    readonly x0 = 0,
    readonly z0 = 0,
  ) {
    this.open = new Uint8Array(width * height);
    this.floor = new Float32Array(width * height);
    this.ramps = new Uint8Array(width * height);
  }

  private index(x: number, z: number): number {
    return (z - this.z0) * this.width + (x - this.x0);
  }

  /** The floor's height on a tile (0 outside the grid). */
  heightAt(x: number, z: number): number {
    return this.inside(x, z) ? this.floor[this.index(x, z)]! : 0;
  }

  /** Raises the floor of every tile of a rectangle. */
  raise(x0: number, z0: number, x1: number, z1: number, y: number): void {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (this.inside(x, z)) this.floor[this.index(x, z)] = y;
  }

  /** Sets one tile's floor height. */
  setHeight(x: number, z: number, y: number): void {
    if (this.inside(x, z)) this.floor[this.index(x, z)] = y;
  }

  /** Marks a tile a ramp (or not). */
  setRamp(x: number, z: number, ramp: boolean): void {
    if (this.inside(x, z)) this.ramps[this.index(x, z)] = ramp ? 1 : 0;
  }

  inside(x: number, z: number): boolean {
    return x >= this.x0 && z >= this.z0 && x < this.x0 + this.width && z < this.z0 + this.height;
  }

  walkable(x: number, z: number): boolean {
    return this.inside(x, z) && this.open[this.index(x, z)] === 1;
  }

  /** Whether the edge between two side-by-side tiles is no ledge (format.ts LEDGE): floors that near, or both ramps. */
  passes(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.inside(ax, az) || !this.inside(bx, bz)) return true;
    const a = this.index(ax, az);
    const b = this.index(bx, bz);
    return (this.ramps[a]! & this.ramps[b]!) === 1 || Math.abs(this.floor[a]! - this.floor[b]!) <= LEDGE_UNITS + 1e-6;
  }

  /**
   * Whether the edge between two side-by-side tiles is a hop (format.ts HOP): a ledge, its floors no more than a level
   * apart. (Whether both tiles are open is `canStep`'s to ask.)
   */
  hops(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.inside(ax, az) || !this.inside(bx, bz) || this.passes(ax, az, bx, bz)) return false;
    return Math.abs(this.floor[this.index(ax, az)]! - this.floor[this.index(bx, bz)]!) <= HOP_UNITS + 1e-6;
  }

  /** Whether one tile is a step of the grid's from another (`canStep`), for one who hops (the default) or does not. */
  canStep(from: Tile, to: Tile, hops = true): boolean {
    return canStep(this.groundFor(hops), from.x, from.z, to.x, to.z);
  }

  setWalkable(x: number, z: number, open: boolean): void {
    if (this.inside(x, z)) this.open[this.index(x, z)] = open ? 1 : 0;
  }

  /** Blocks every tile of a rectangle (a house, a counter). */
  block(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.setWalkable(x, z, false);
  }

  /**
   * The tiles from one to the other, both included, or null if there is no way: for one who hops (the default), a hop a
   * step of HOP_COST; for one who does not, round by the ramps.
   */
  path(fromWorld: Tile, toWorld: Tile, hops = true): Tile[] | null {
    if (!this.walkable(toWorld.x, toWorld.z)) return null;
    if (fromWorld.x === toWorld.x && fromWorld.z === toWorld.z) return [fromWorld];
    // The search runs in the grid's own coordinates, from 0.
    const { x0, z0 } = this;
    const from = { x: fromWorld.x - x0, z: fromWorld.z - z0 };
    const to = { x: toWorld.x - x0, z: toWorld.z - z0 };
    const w = this.width;
    const key = (x: number, z: number) => z * w + x;
    const g = new Float64Array(w * this.height).fill(Infinity);
    const came = new Int32Array(w * this.height).fill(-1);
    const closed = new Uint8Array(w * this.height);
    const heuristic = (x: number, z: number) => {
      const dx = Math.abs(x - to.x);
      const dz = Math.abs(z - to.z);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    // A binary heap of [f, key].
    const heap: [number, number][] = [];
    const push = (f: number, k: number) => {
      heap.push([f, k]);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent]![0] <= heap[i]![0]) break;
        [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
        i = parent;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    const start = key(from.x, from.z);
    g[start] = 0;
    push(heuristic(from.x, from.z), start);
    const goal = key(to.x, to.z);
    const ground = this.groundFor(hops);
    while (heap.length > 0) {
      const [, k] = pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === goal) break;
      const x = k % w;
      const z = (k - x) / w;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (!canStep(ground, x + x0, z + z0, nx + x0, nz + z0)) continue;
          const nk = key(nx, nz);
          const step = dx !== 0 && dz !== 0 ? Math.SQRT2 : hops && !this.passes(x + x0, z + z0, nx + x0, nz + z0) ? HOP_COST : 1;
          const cost = g[k]! + step;
          if (cost < g[nk]!) {
            g[nk] = cost;
            came[nk] = k;
            push(cost + heuristic(nx, nz), nk);
          }
        }
      }
    }
    if (!closed[goal]) return null;
    const out: Tile[] = [];
    for (let k = goal; k !== -1; k = came[k]!) out.push({ x: (k % w) + x0, z: Math.floor(k / w) + z0 });
    return out.reverse();
  }
}
