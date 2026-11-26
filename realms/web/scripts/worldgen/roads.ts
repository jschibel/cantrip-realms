// Roads over the travel map (design.md A6), between the towns' icons, the dungeons' entrances and the ferries' docks as
// the sketch's `roads` join them: each the least-cost path over a cost field - A* in eight directions, its steps dearer
// over a level's rise, through a wood (by its depth) and over a river (a bridge or a ford), cheap along a road already
// laid so the roads merge into a network, never over the sea, a lake, a mere or a range's band (so a range is crossed
// at its passes, and a road through a named pass is routed through it) - then smoothed by string pulling (the line cut
// straight between two of its points wherever the straight line costs no more), and drawn four-connected so its tiles
// join edge to edge. Main roads are two tiles wide and gravelled, the others one, of packed dirt (planks over the bog,
// scree in the hills). Where a road crosses a river a main road has a bridge, a lesser one stepping stones; where it
// climbs a level it gets a ramp (land.ts `rampWays`); at a junction stands a signpost naming where each branch leads.

import { type PropData } from "../../src/world/format";
import { S } from "./ids";
import { Heap, type Land, Use, texel } from "./land";
import type { Terrain } from "./terrain";

export interface LaidRoad {
  readonly from: string;
  readonly to: string;
  readonly main: boolean;
  /** Its middle line, tile by tile, four-connected, from `from` to `to`. */
  readonly tiles: readonly number[];
}

/** A crossing of a river: its tiles, and whether it is bridged (a main road's) or forded. */
interface Crossing {
  readonly tiles: number[];
  readonly bridge: boolean;
  readonly along: "x" | "z";
}

const SQRT2 = Math.SQRT2;

export class Roads {
  readonly laid: LaidRoad[] = [];
  /** 1 on a main road's tiles. */
  readonly main: Uint8Array;
  private readonly crossings: Crossing[] = [];
  private readonly g: Float64Array;
  private readonly came: Int32Array;
  private readonly closed: Uint8Array;

  constructor(
    private readonly land: Land,
    private readonly terrain: Terrain,
    /** Each range's height (1 hills, 2 mountains, 3 a great range), by its index. */
    private readonly heights: readonly number[],
  ) {
    this.main = new Uint8Array(land.size);
    this.g = new Float64Array(land.size);
    this.came = new Int32Array(land.size);
    this.closed = new Uint8Array(land.size);
  }

  private inMap(i: number): boolean {
    return i % this.land.width < this.terrain.W && Math.floor(i / this.land.width) < this.terrain.H;
  }

  /** Whether a road may run over a tile (an end always may). */
  private passable(i: number, ends: ReadonlySet<number>): boolean {
    if (ends.has(i)) return true;
    if (!this.inMap(i)) return false;
    const t = this.terrain;
    if (t.water[i] === 2 || t.water[i] === 3 || t.water[i] === 4) return false;
    // A range of mountains (height 2) is crossed where a road cuts its own gap, dearly; a great range only at its passes.
    if (t.band[i]) return this.heights[t.band[i]! - 1]! < 3;
    const u = this.land.use[i]!;
    if (u === Use.Building || u === Use.Door || u === Use.Dock || u === Use.Wall) return false;
    if (t.water[i] === 1) return true;
    return this.land.open(i) || this.land.decor.has(i);
  }

  /** What a step onto a tile costs beyond its length. */
  private cost(i: number): number {
    const t = this.terrain;
    const u = this.land.use[i]!;
    if (u === Use.Road) return 0.3;
    let c = 1 + Math.min(0.9, t.forest[i]! * 0.12) + (t.swamp[i]! > 0 ? 0.5 : 0);
    if (t.water[i] === 1) c += 9;
    if (t.band[i]) c += 25;
    if (u === Use.Kept) c += 0.2;
    if (t.reserved[i] && u !== Use.Kept) c += 4;
    return c;
  }

  /**
   * The cheapest way from any of `starts` (each with its extra cost to set out from) to any of `goals`, eight ways with
   * no corner cut nor a river crossed on the slant; the tiles in order, or null.
   */
  private search(starts: ReadonlyMap<number, number>, goals: ReadonlySet<number>): number[] | null {
    const L = this.land;
    const W = L.width;
    const ends = new Set([...starts.keys(), ...goals]);
    this.g.fill(Infinity);
    this.closed.fill(0);
    const gx = [...goals].map((i) => [i % W, Math.floor(i / W)] as const);
    const h = (i: number) => {
      const x = i % W;
      const z = Math.floor(i / W);
      let best = Infinity;
      for (const [tx, tz] of gx) {
        const dx = Math.abs(x - tx);
        const dz = Math.abs(z - tz);
        best = Math.min(best, Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz));
      }
      return best * 0.55;
    };
    const heap = new Heap();
    for (const [s, extra] of starts) {
      this.g[s] = extra;
      this.came[s] = -1;
      heap.push(s, extra + h(s));
    }
    const H = L.height;
    let found = -1;
    while (heap.size > 0) {
      const i = heap.pop();
      if (this.closed[i]) continue;
      this.closed[i] = 1;
      if (goals.has(i)) {
        found = i;
        break;
      }
      const x = i % W;
      const z = (i - x) / W;
      const prev = this.came[i]!;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!(dx || dz) || !L.inside(x + dx, z + dz)) continue;
          const n = i + dz * W + dx;
          if (this.closed[n] || !this.passable(n, ends)) continue;
          if (dx && dz) {
            const a = i + dx;
            const b = i + dz * W;
            if (!this.passable(a, ends) || !this.passable(b, ends)) continue;
            if (this.terrain.water[n] === 1 || this.terrain.water[i] === 1 || this.terrain.water[a] === 1 || this.terrain.water[b] === 1) continue;
          }
          const climb = Math.abs(H[n]! - H[i]!) / 12;
          const turn = prev >= 0 && n - i !== i - prev ? 0.25 : 0;
          const total = this.g[i]! + (dx && dz ? SQRT2 : 1) * this.cost(n) + climb * 3 + turn;
          if (total < this.g[n]!) {
            this.g[n] = total;
            this.came[n] = i;
            heap.push(n, total + h(n));
          }
        }
      }
    }
    if (found < 0) return null;
    const out: number[] = [];
    for (let i = found; i !== -1; i = this.came[i]!) out.push(i);
    return out.reverse();
  }

  /** The tiles of a straight line from one tile to another, four-connected (each step along x or along z). */
  private line(a: number, b: number): number[] {
    const W = this.land.width;
    let x = a % W;
    let z = Math.floor(a / W);
    const bx = b % W;
    const bz = Math.floor(b / W);
    const dx = Math.abs(bx - x);
    const dz = Math.abs(bz - z);
    const sx = bx > x ? 1 : -1;
    const sz = bz > z ? 1 : -1;
    const out = [a];
    // Along whichever axis keeps the line nearer the true one: x while (ix + 1/2) / dx < (iz + 1/2) / dz.
    for (let ix = 0, iz = 0; ix < dx || iz < dz; ) {
      if ((1 + 2 * ix) * dz < (1 + 2 * iz) * dx) {
        x += sx;
        ix++;
      } else {
        z += sz;
        iz++;
      }
      out.push(z * W + x);
    }
    return out;
  }

  /** A path's tiles four-connected: each diagonal step through the cheaper of the two tiles beside it. */
  private fourWay(path: readonly number[], ends: ReadonlySet<number>): number[] {
    const W = this.land.width;
    const out: number[] = [];
    for (let k = 0; k < path.length; k++) {
      const i = path[k]!;
      if (k > 0) {
        const p = path[k - 1]!;
        const dx = (i % W) - (p % W);
        const dz = Math.floor(i / W) - Math.floor(p / W);
        if (dx && dz) {
          const a = p + dx;
          const b = p + dz * W;
          const ca = this.passable(a, ends) ? this.cost(a) : Infinity;
          const cb = this.passable(b, ends) ? this.cost(b) : Infinity;
          out.push(ca <= cb ? a : b);
        }
      }
      out.push(i);
    }
    return out;
  }

  /** Smooths a four-connected path by string pulling: from each point, straight to the farthest one the line costs no more to reach. */
  private pull(path: readonly number[], ends: ReadonlySet<number>): number[] {
    const H = this.land.height;
    const step = (a: number, b: number) => this.cost(b) + (Math.abs(H[b]! - H[a]!) / 12) * 3;
    const acc = [0];
    for (let k = 1; k < path.length; k++) acc.push(acc[k - 1]! + step(path[k - 1]!, path[k]!));
    const wet = (i: number) => this.terrain.water[i] === 1;
    const out: number[] = [path[0]!];
    let i = 0;
    while (i < path.length - 1) {
      let best = i + 1;
      for (let j = Math.min(path.length - 1, i + 48); j > i + 1; j--) {
        const tiles = this.line(path[i]!, path[j]!);
        let ok = true;
        let cost = 0;
        let waterLine = 0;
        for (let k = 1; k < tiles.length && ok; k++) {
          if (!this.passable(tiles[k]!, ends)) ok = false;
          else {
            cost += step(tiles[k - 1]!, tiles[k]!);
            if (wet(tiles[k]!)) waterLine++;
          }
        }
        if (!ok) continue;
        let waterPath = 0;
        for (let k = i + 1; k <= j; k++) if (wet(path[k]!)) waterPath++;
        if (waterLine > waterPath || cost > acc[j]! - acc[i]! + 0.5) continue;
        best = j;
        break;
      }
      const seg = this.line(path[i]!, path[best]!);
      for (let k = 1; k < seg.length; k++) out.push(seg[k]!);
      i = best;
    }
    return out;
  }

  /**
   * Routes a road from any of `starts` (each with the extra cost of setting out from it) to any of `goals`, through each
   * of `via` in order; null where there is no way. The middle line, four-connected.
   */
  route(starts: ReadonlyMap<number, number>, goals: readonly number[], via: readonly number[] = []): number[] | null {
    const stops = [...via, -1];
    let from = starts;
    const out: number[] = [];
    const ends = new Set([...starts.keys(), ...goals, ...via]);
    for (const stop of stops) {
      const to = stop === -1 ? new Set(goals) : new Set([stop]);
      const raw = this.search(from, to);
      if (!raw) return null;
      const four = this.pull(this.fourWay(raw, ends), ends);
      out.push(...(out.length > 0 ? four.slice(1) : four));
      from = new Map([[four[four.length - 1]!, 0]]);
    }
    return out;
  }

  /** Lays a routed road: its tiles paved (a main road two wide), its crossings of rivers bridged or forded. */
  lay(from: string, to: string, tiles: readonly number[], main: boolean): void {
    const L = this.land;
    const W = L.width;
    const t = this.terrain;
    let run: number[] = [];
    const finish = (k: number) => {
      if (run.length === 0) return;
      const before = tiles[k - run.length - 1];
      const after = tiles[k];
      const along = before !== undefined && after !== undefined && Math.abs((after % W) - (before % W)) >= Math.abs(Math.floor(after / W) - Math.floor(before / W)) ? "x" : "z";
      this.crossings.push({ tiles: run, bridge: main, along });
      run = [];
    };
    tiles.forEach((i, k) => {
      if (t.water[i] === 1) run.push(i);
      else finish(k);
    });
    finish(tiles.length);
    const paveOne = (j: number, level: number, centre: boolean) => {
      const u = L.use[j]!;
      if (!this.inMap(j) || u === Use.Building || u === Use.Door || u === Use.Dock || u === Use.Wall) return;
      if (t.water[j] === 2 || t.water[j] === 3 || t.water[j] === 4) return;
      if (t.band[j] && this.heights[t.band[j]! - 1]! >= 3) return;
      // Through a range's band: the road's own gap, its peaks never stood there.
      if (t.band[j]) t.band[j] = 0;
      if (t.water[j] === 1) {
        if (!centre && !main) return;
        L.decor.delete(j);
        L.flags[j] = 0;
        L.use[j] = Use.Road;
        if (main) this.main[j] = 1;
        return;
      }
      if (!centre && t.reserved[j] && u !== Use.Kept) return;
      L.decor.delete(j);
      L.flags[j] = 0;
      L.height[j] = level;
      if (u === Use.Kept && !centre) return;
      L.use[j] = Use.Road;
      if (main) this.main[j] = 1;
      const s = L.surface[j]!;
      L.surface[j] = s === S.mud || s === S.moss ? S.planks : main ? S.road : S.dirt;
    };
    // The road's levels: the land's, but through a range's band graded straight from the ground before it to the ground
    // after, a level a tile at most.
    const levels = tiles.map((i) => L.height[i]!);
    for (let k = 0; k < tiles.length; k++) {
      if (!t.band[tiles[k]!]) continue;
      let e = k;
      while (e < tiles.length && t.band[tiles[e]!]) e++;
      const a = k > 0 ? levels[k - 1]! : levels[e] ?? 0;
      const b = e < tiles.length ? levels[e]! : a;
      for (let m = k; m < e; m++) levels[m] = Math.round((a + ((b - a) * (m - k + 1)) / (e - k + 1)) / 12) * 12;
      k = e;
    }
    tiles.forEach((i, k) => {
      const level = levels[k]!;
      paveOne(i, level, true);
      if (main) for (const j of [i + 1, i + W, i + W + 1]) paveOne(j, level, false);
    });
    this.laid.push({ from, to, main, tiles });
  }

  /**
   * The crossings, once the land's heights are final: a bridge's deck (and a ford's stones) at the level of its higher
   * bank, the bridge prop over it from bank to bank; returns the props.
   */
  bridges(): PropData[] {
    const L = this.land;
    const W = L.width;
    const out: PropData[] = [];
    const near: number[] = [];
    for (const c of this.crossings) {
      // Every tile of the river under the road (both lanes).
      const tiles = new Set<number>();
      for (const i of c.tiles) {
        tiles.add(i);
        for (const j of [i + 1, i + W, i + W + 1, i - 1, i - W]) if (this.terrain.water[j] === 1 && L.use[j] === Use.Road && L.open(j)) tiles.add(j);
      }
      let bank = 0;
      for (const i of tiles) for (const n of L.n4(i, near)) if (!tiles.has(n) && L.open(n) && this.terrain.water[n] !== 1) bank = Math.max(bank, L.height[n]!);
      for (const i of tiles) L.height[i] = bank;
      const xs = [...tiles].map((i) => i % W);
      const zs = [...tiles].map((i) => Math.floor(i / W));
      const x0 = Math.min(...xs);
      const z0 = Math.min(...zs);
      const x1 = Math.max(...xs) + 1;
      const z1 = Math.max(...zs) + 1;
      if (c.bridge) {
        const [bx0, bz0, bx1, bz1] = c.along === "x" ? [x0 - 1, z0, x1 + 1, z1] : [x0, z0 - 1, x1, z1 + 1];
        out.push({ id: "bridge", x: bx0, z: bz0, args: { to: [bx1, bz1], y: texel(bank / 16 + 0.25) } });
      } else {
        for (const i of [...tiles].sort((a, b) => a - b)) out.push({ id: "stepping-stone", x: (i % W) + 0.5, z: Math.floor(i / W) + 0.5, scale: 0.6 });
      }
    }
    return out;
  }

  /**
   * The junctions of the network: each tile where a road leaves another (a tile of two roads' middle lines, one of which
   * goes on where the other does not), one to a cluster, with the roads that meet there.
   */
  junctions(): { at: number; roads: LaidRoad[] }[] {
    const on = new Map<number, Set<number>>();
    this.laid.forEach((r, k) => {
      for (const i of r.tiles) {
        let s = on.get(i);
        if (!s) on.set(i, (s = new Set()));
        s.add(k);
      }
    });
    const W = this.land.width;
    const found: { at: number; roads: LaidRoad[] }[] = [];
    const near: number[] = [];
    for (const [i, roads] of [...on].sort((a, b) => a[0] - b[0])) {
      if (roads.size < 2) continue;
      // A branch: a neighbour on one of these roads but not on all of them.
      const branching = this.land.n4(i, near).some((n) => {
        const there = on.get(n);
        return there !== undefined && [...roads].some((k) => there.has(k)) && [...roads].some((k) => !there.has(k));
      });
      if (!branching) continue;
      if (found.some((f) => Math.hypot((f.at % W) - (i % W), Math.floor(f.at / W) - Math.floor(i / W)) < 10)) continue;
      found.push({ at: i, roads: [...roads].map((k) => this.laid[k]!) });
    }
    return found;
  }
}
