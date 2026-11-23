// Roads between the towns and out to the dungeons (design.md A6): the cheapest way over the land by A*, preferring
// flat open ground and roads already laid, bridging rivers, cutting passes through mountains, never through a town's
// walls but out of one gate and in at another.

import { Grid, SIZE, STEP, T, Use, around, hexDistance, idx, qOf, rOf } from "./grid";

const NONE = Number.POSITIVE_INFINITY;

export class Roads {
  private readonly spent = new Float64Array(SIZE * SIZE);
  private readonly came = new Int32Array(SIZE * SIZE);
  private readonly closed = new Uint8Array(SIZE * SIZE);
  /** Hexes of the roads the heartland is joined by: hub to home towns (their wilds are the tamest, design.md A6). */
  readonly main = new Uint8Array(SIZE * SIZE);
  readonly laid: { from: string; to: string; hexes: number[] }[] = [];

  constructor(private readonly grid: Grid) {}

  private cost(i: number, a: number, b: number): number {
    const g = this.grid;
    if (i === a || i === b) return 1;
    if (g.town[i] !== 0 && g.use[i] !== Use.Kept && g.use[i] !== Use.Road) return NONE;
    const t = g.terrain[i]!;
    if (t === T["deep-water"]) return 40;
    if (g.use[i] === Use.Road) return 0.4;
    if (g.use[i] === Use.Door || g.use[i] === Use.Building) return NONE;
    if (t === T.water || t === T.swamp) return 16;
    if (t === T.lava) return 30;
    if (t === T.mountain) return 12;
    if (t === T.snow) return 2.2;
    return g.blocked[i] ? 1.8 : 1;
  }

  /** Lays the road from hex `a` to hex `b` (indexes); false when there is no way. */
  lay(from: string, to: string, a: number, b: number, main = false): boolean {
    const g = this.grid;
    this.spent.fill(NONE);
    this.closed.fill(0);
    const bq = qOf(b);
    const br = rOf(b);
    const heap = new Heap();
    this.spent[a] = 0;
    this.came[a] = -1;
    heap.push(a, hexDistance(qOf(a), rOf(a), bq, br) * 0.4);
    const near: number[] = [];
    let found = false;
    while (heap.size > 0) {
      const i = heap.pop();
      if (this.closed[i]) continue;
      this.closed[i] = 1;
      if (i === b) {
        found = true;
        break;
      }
      const here = this.spent[i]!;
      for (const n of around(i, near)) {
        if (this.closed[n]) continue;
        const c = this.cost(n, a, b);
        if (c === NONE) continue;
        const slope = Math.abs(g.height[n]! - g.height[i]!) / STEP;
        const total = here + c + slope * 0.6;
        if (total < this.spent[n]!) {
          this.spent[n] = total;
          this.came[n] = i;
          heap.push(n, total + hexDistance(qOf(n), rOf(n), bq, br) * 0.4);
        }
      }
    }
    if (!found) return false;
    const hexes: number[] = [];
    for (let i = b; i !== -1; i = this.came[i]!) hexes.push(i);
    hexes.reverse();
    for (const i of hexes) {
      if (g.town[i] !== 0 && g.use[i] !== Use.Kept) continue;
      if (main) this.main[i] = 1;
      if (g.use[i] === Use.Road || g.use[i] === Use.Door) continue;
      const t = g.terrain[i]!;
      g.terrain[i] = t === T.water || t === T.swamp || t === T.lava || t === T["deep-water"] ? T.wood : T.road;
      if (t === T.water || t === T.swamp || t === T.lava) g.height[i] = STEP;
      if (t === T.mountain) g.height[i] = Math.max(STEP, g.height[i]! - STEP * 4);
      g.blocked[i] = 0;
      g.props.delete(i);
      g.use[i] = Use.Road;
    }
    // Ease the road's grade: no step along it of more than one height step.
    for (let k = 1; k < hexes.length; k++) {
      const p = hexes[k - 1]!;
      const i = hexes[k]!;
      if (g.use[i] !== Use.Road) continue;
      const diff = g.height[i]! - g.height[p]!;
      if (Math.abs(diff) > STEP) g.height[i] = g.height[p]! + Math.sign(diff) * STEP;
    }
    this.laid.push({ from, to, hexes });
    return true;
  }
}

/** A binary heap of hex indexes by priority. */
class Heap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      items[i] = items[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0]!;
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lastKey;
        if (l < n && keys[l]! < mk) {
          m = l;
          mk = keys[l]!;
        }
        if (r < n && keys[r]! < mk) m = r;
        if (m === i) break;
        items[i] = items[m]!;
        keys[i] = keys[m]!;
        i = m;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

export { idx };
