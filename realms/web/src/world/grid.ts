// Square tiles: the slice's world is a grid (classic 16-bit RPGs are tile-based), and the player walks it by A* in eight
// directions - never cutting a corner past a blocked tile, so a diagonal step is only taken where both of the tiles it
// passes between are open.

export interface Tile {
  readonly x: number;
  readonly z: number;
}

export class Grid {
  private readonly open: Uint8Array;
  /** How high each tile's floor stands (a dais, a step), in world units. */
  private readonly floor: Float32Array;

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

  inside(x: number, z: number): boolean {
    return x >= this.x0 && z >= this.z0 && x < this.x0 + this.width && z < this.z0 + this.height;
  }

  walkable(x: number, z: number): boolean {
    return this.inside(x, z) && this.open[this.index(x, z)] === 1;
  }

  setWalkable(x: number, z: number, open: boolean): void {
    if (this.inside(x, z)) this.open[this.index(x, z)] = open ? 1 : 0;
  }

  /** Blocks every tile of a rectangle (a house, a counter). */
  block(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.setWalkable(x, z, false);
  }

  /** The tiles from one to the other, both included, or null if there is no way. */
  path(fromWorld: Tile, toWorld: Tile): Tile[] | null {
    if (!this.walkable(toWorld.x, toWorld.z)) return null;
    if (fromWorld.x === toWorld.x && fromWorld.z === toWorld.z) return [fromWorld];
    // The search runs in the grid's own coordinates, from 0.
    const { x0, z0 } = this;
    const from = { x: fromWorld.x - x0, z: fromWorld.z - z0 };
    const to = { x: toWorld.x - x0, z: toWorld.z - z0 };
    const open = (x: number, z: number) => this.walkable(x + x0, z + z0);
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
          if (!open(nx, nz)) continue;
          if (dx !== 0 && dz !== 0 && (!open(x + dx, z) || !open(x, z + dz))) continue;
          const nk = key(nx, nz);
          const cost = g[k]! + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
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
