// Roads between the towns and out to the dungeons and the ferries (design.md A6): the cheapest way over the land by A*
// in four directions (a road's tiles join edge to edge), preferring flat open ground and roads already laid, bridging
// rivers, raising causeways over the straits to the near isles, cutting passes through mountains, never through a town's
// walls but out of one gate and in at another. The
// main roads are three tiles wide and gravelled; the rest two, of packed dirt, and boardwalks over the Morass.

import { BLOCKED } from "../../src/world/format";
import { S } from "./ids";
import { Heap, type Land, Use, texel } from "./land";

const NONE = Number.POSITIVE_INFINITY;

export interface LaidRoad {
  readonly from: string;
  readonly to: string;
  /** Its middle line, tile by tile. */
  readonly tiles: readonly number[];
}

export class Roads {
  private readonly spent: Float64Array;
  private readonly came: Int32Array;
  private readonly closed: Uint8Array;
  /** Tiles of the main roads (hub to home towns): the wilds along them are the tamest (design.md A6). */
  readonly main: Uint8Array;
  readonly laid: LaidRoad[] = [];

  constructor(private readonly land: Land) {
    this.spent = new Float64Array(land.size);
    this.came = new Int32Array(land.size);
    this.closed = new Uint8Array(land.size);
    this.main = new Uint8Array(land.size);
  }

  private cost(i: number, ends: ReadonlySet<number>): number {
    const g = this.land;
    if (ends.has(i)) return 1;
    const use = g.use[i]!;
    if (g.town[i] !== 0) return NONE;
    if (use === Use.Wall || use === Use.Building || use === Use.Door || use === Use.Dock) return NONE;
    if (use === Use.Road) return 0.35;
    const s = g.surface[i]!;
    if (s === S.sea) return 70;
    if (s === S.shallows) return 40;
    if (s === S.stream) return 14;
    if (s === S.bog) return 5;
    if (s === S.lava) return 40;
    if (g.flags[i]! & BLOCKED) return 9;
    if (use === Use.Kept) return 1.4;
    return 1;
  }

  /**
   * Lays the cheapest road from any of the tiles `starts` (a town's gates) to any of `goals`; false when there is no
   * way.
   */
  lay(from: string, to: string, starts: readonly number[], goals: readonly number[], main = false): boolean {
    const g = this.land;
    this.spent.fill(NONE);
    this.closed.fill(0);
    const ends = new Set([...starts, ...goals]);
    const targets = new Set(goals);
    const heap = new Heap();
    const h = (i: number) => {
      let best = Infinity;
      for (const t of goals) best = Math.min(best, Math.abs(g.xOf(i) - g.xOf(t)) + Math.abs(g.zOf(i) - g.zOf(t)));
      return best * 0.35;
    };
    for (const a of starts) {
      this.spent[a] = 0;
      this.came[a] = -1;
      heap.push(a, h(a));
    }
    let b = -1;
    const near: number[] = [];
    let found = false;
    while (heap.size > 0) {
      const i = heap.pop();
      if (this.closed[i]) continue;
      this.closed[i] = 1;
      if (targets.has(i)) {
        found = true;
        b = i;
        break;
      }
      const here = this.spent[i]!;
      for (const n of g.n4(i, near)) {
        if (this.closed[n]) continue;
        const c = this.cost(n, ends);
        if (c === NONE) continue;
        const slope = Math.abs(g.height[n]! - g.height[i]!);
        // Turning costs a little, so roads run straight where the land lets them.
        const prev = this.came[i]!;
        const turn = prev >= 0 && n - i !== i - prev ? 0.3 : 0;
        const total = here + c + slope * 0.15 + turn;
        if (total < this.spent[n]!) {
          this.spent[n] = total;
          this.came[n] = i;
          heap.push(n, total + h(n));
        }
      }
    }
    if (!found) return false;
    const tiles: number[] = [];
    for (let i = b; i !== -1; i = this.came[i]!) tiles.push(i);
    tiles.reverse();
    this.pave(tiles, main);
    this.laid.push({ from, to, tiles });
    return true;
  }

  /** Paves a road's tiles and the tiles beside them: bridges over rivers, boardwalks over bog, passes through rock. */
  private pave(tiles: readonly number[], main: boolean): void {
    const g = this.land;
    const width = main ? 3 : 2;
    // Ease the grade along the middle line first: no step of more than two texels.
    for (let k = 1; k < tiles.length; k++) {
      const p = tiles[k - 1]!;
      const i = tiles[k]!;
      if (g.use[i] === Use.Road || g.town[i] !== 0 || g.use[i] === Use.Kept) continue;
      const diff = g.height[i]! - g.height[p]!;
      if (Math.abs(diff) > 2) g.height[i] = g.height[p]! + Math.sign(diff) * 2;
    }
    const near: number[] = [];
    const crossing: number[] = [];
    const finishBridge = () => {
      if (crossing.length === 0) return;
      // The bridge's deck spans the crossing and a tile of bank at each end, as wide as the road.
      const xs = crossing.map((i) => g.xOf(i));
      const zs = crossing.map((i) => g.zOf(i));
      const x0 = Math.min(...xs);
      const z0 = Math.min(...zs);
      const x1 = Math.max(...xs) + 1;
      const z1 = Math.max(...zs) + 1;
      const along = x1 - x0 >= z1 - z0 ? "x" : "z";
      const deck = Math.max(...crossing.map((i) => g.height[i]!)) + 4;
      for (const i of g.rect(x0 - (along === "x" ? 0 : 1), z0 - (along === "z" ? 0 : 1), x1 - 1 + (along === "x" ? 0 : 1), z1 - 1 + (along === "z" ? 0 : 1))) {
        if (g.surface[i] === S.stream || g.surface[i] === S.lava) {
          g.flags[i] = 0;
          g.height[i] = deck;
          g.use[i] = Use.Road;
          g.decor.delete(i);
        }
      }
      const [bx0, bz0, bx1, bz1] = along === "x" ? [x0 - 1, z0, x1 + 1, z1] : [x0, z0 - 1, x1, z1 + 1];
      g.fixtures.push({ id: "bridge", x: bx0, z: bz0, args: { to: [bx1, bz1], y: texel(deck / 16) } });
      crossing.length = 0;
    };
    for (const i of tiles) {
      if (g.town[i] !== 0) {
        finishBridge();
        continue;
      }
      const water = g.surface[i] === S.stream || g.surface[i] === S.lava;
      if (water) crossing.push(i);
      else finishBridge();
      if (main) this.main[i] = 1;
      const x = g.xOf(i);
      const z = g.zOf(i);
      const band = width === 3 ? g.rect(x - 1, z - 1, x + 1, z + 1) : g.rect(x, z, x + 1, z + 1);
      for (const j of band) {
        const u = g.use[j]!;
        if (g.town[j] !== 0 || u === Use.Wall || u === Use.Building || u === Use.Door || u === Use.Dock || u === Use.Road) continue;
        const s = g.surface[j]!;
        if (s === S.sea || s === S.shallows) {
          // A causeway over the strait to a near isle (design.md A6).
          g.decor.delete(j);
          g.flags[j] = 0;
          g.height[j] = 2;
          g.use[j] = Use.Road;
          g.surface[j] = S.road;
          if (main) this.main[j] = 1;
          continue;
        }
        if (s === S.stream || s === S.lava) {
          if (water) crossing.push(j);
          continue;
        }
        if (j !== i && Math.abs(g.height[j]! - g.height[i]!) > 6) continue;
        g.decor.delete(j);
        g.flags[j] = 0;
        g.height[j] = g.height[i]!;
        if (u === Use.Kept) continue;
        g.use[j] = Use.Road;
        g.surface[j] = s === S.bog || s === S.mud ? S.planks : s === S.rock || s === S.snow ? S.scree : main ? S.road : S.dirt;
      }
    }
    finishBridge();
    for (const i of tiles) for (const n of g.n4(i, near)) if (g.use[n] === Use.Road && g.flags[n]) g.flags[n] = 0;
  }
}
