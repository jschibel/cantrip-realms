// Placing the whole map's names (hud.ts, the world's map): in order of importance, each where it covers no name placed
// before it nor any mark - a town's name beside its mark, a land's, a sea's, a region's or a feature's over its point,
// nudged round it within a reach - shrunk a step if it fits nowhere, and dropped if it still does not (a town's never:
// it takes the spot that covers least). Pure: the boxes are the caller's measures, in the map's pixels.

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface Wanted {
  readonly id: string;
  /** Where it belongs: the middle of the name (`over`), or the mark it is written beside (`beside`). */
  readonly x: number;
  readonly y: number;
  /** Its size at full scale. */
  readonly width: number;
  readonly height: number;
  /** `over` its point, nudged within `reach`; `beside` a mark `r` pixels round, never over it. */
  readonly mode: "over" | "beside";
  readonly reach?: number;
  readonly r?: number;
  /** Placed whatever covers it (a town's name): where it covers least. */
  readonly must?: boolean;
  /** The scales it may be written at, the first tried first (default [1]). */
  readonly scales?: readonly number[];
}

export interface Placed {
  readonly id: string;
  readonly x0: number;
  readonly y0: number;
  readonly scale: number;
  readonly box: Box;
}

const GAP = 2;

const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + GAP) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + GAP);

/** The places a name may go, best first: its top-left corners at a scale. */
function spots(w: Wanted, scale: number): [number, number][] {
  const width = w.width * scale;
  const height = w.height * scale;
  if (w.mode === "beside") {
    const r = w.r ?? 4;
    const out: [number, number][] = [];
    // Beside the mark, then a little further off it: right, left, below, above, then the corners.
    for (const g of [2, 2 + height * 0.6, 2 + height * 1.2]) {
      out.push(
        [w.x + r + g, w.y - height / 2],
        [w.x - r - g - width, w.y - height / 2],
        [w.x - width / 2, w.y + r + g - 1],
        [w.x - width / 2, w.y - r - g + 1 - height],
        [w.x + r + g, w.y - r - height + 2 - g / 2],
        [w.x + r + g, w.y + r - 2 + g / 2],
        [w.x - r - g - width, w.y - r - height + 2 - g / 2],
        [w.x - r - g - width, w.y + r - 2 + g / 2],
      );
    }
    return out;
  }
  const out: [number, number][] = [[w.x - width / 2, w.y - height / 2]];
  const reach = w.reach ?? height;
  const step = Math.max(2, height * 0.5);
  for (let d = step; d <= reach + 0.01; d += step) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / step));
    for (let i = 0; i < n; i++) {
      // Up and down first, then aside: a name keeps to its row where it can.
      const a = (i % 2 === 0 ? 1 : -1) * Math.floor((i + 1) / 2) * ((2 * Math.PI) / n) + Math.PI / 2;
      out.push([w.x - width / 2 + Math.cos(a) * d * 1.6, w.y - height / 2 + Math.sin(a) * d]);
    }
  }
  return out;
}

/**
 * Places `wanted` in order (most important first) among `marks` (the boxes no name may cover), within `bounds` if
 * given: each where it covers nothing placed, shrunk through its scales, dropped if nowhere fits unless `must`.
 */
export function placeLabels(wanted: readonly Wanted[], marks: readonly Box[], bounds?: Box): Placed[] {
  const taken: Box[] = [];
  const placed: Placed[] = [];
  // Covering a name is far worse than covering a mark.
  const cost = (b: Box) => {
    let c = 0;
    for (const t of taken) c += 20 * overlap(b, t);
    for (const m of marks) c += overlap(b, m);
    return c;
  };
  const inside = (b: Box) => !bounds || (b.x0 >= bounds.x0 && b.y0 >= bounds.y0 && b.x1 <= bounds.x1 && b.y1 <= bounds.y1);
  for (const w of wanted) {
    let done: Placed | null = null;
    let least: Placed | null = null;
    let leastCost = Infinity;
    for (const scale of w.scales ?? [1]) {
      for (const [x, y] of spots(w, scale)) {
        const box = { x0: x, y0: y, x1: x + w.width * scale, y1: y + w.height * scale };
        const c = cost(box) + (inside(box) ? 0 : 1e6);
        if (c === 0) {
          done = { id: w.id, x0: x, y0: y, scale, box };
          break;
        }
        if (w.must && c < leastCost) {
          leastCost = c;
          least = { id: w.id, x0: x, y0: y, scale, box };
        }
      }
      if (done) break;
    }
    const chosen = done ?? (w.must ? least : null);
    if (!chosen) continue;
    taken.push(chosen.box);
    placed.push(chosen);
  }
  return placed;
}
