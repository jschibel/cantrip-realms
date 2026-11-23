// The overworld's ground is a grid of flat-topped hexagons in axial coordinates (q, r): q runs along world x, r down
// and to the right. A hex's centre on the ground plane (x, z) is fixed by its radius, HEX_SIZE world units from centre
// to corner. Movement is hex to hex along a path found with A*; the server checks the same paths (tech.md, B4).

export interface Hex {
  readonly q: number;
  readonly r: number;
}

export const HEX_SIZE = 1;
const SQRT3 = Math.sqrt(3);

/** The six steps to a neighbour, in order around the hex. */
export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const hex = (q: number, r: number): Hex => ({ q, r });

export const key = (h: Hex): string => `${h.q},${h.r}`;

export const equals = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

export const add = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });

export const neighbors = (h: Hex): Hex[] => DIRECTIONS.map((d) => add(h, d));

/** Steps between two hexes, walking hex to hex. */
export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** A hex's centre on the ground plane. */
export function toWorld(h: Hex): { x: number; z: number } {
  return { x: HEX_SIZE * 1.5 * h.q, z: HEX_SIZE * SQRT3 * (h.r + h.q / 2) };
}

/** The hex a point on the ground plane lies in. */
export function fromWorld(x: number, z: number): Hex {
  const q = ((2 / 3) * x) / HEX_SIZE;
  const r = ((-1 / 3) * x + (SQRT3 / 3) * z) / HEX_SIZE;
  return round(q, r);
}

/** The hex nearest fractional axial coordinates. */
export function round(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  // Normalise -0 to 0, so equal hexes have equal keys.
  return { q: rq + 0, r: rr + 0 };
}

/** Every hex within `radius` steps of `centre`, centre first, then ring by ring. */
export function spiral(centre: Hex, radius: number): Hex[] {
  const found: Hex[] = [centre];
  for (let ring = 1; ring <= radius; ring++) {
    let h = add(centre, { q: DIRECTIONS[4]!.q * ring, r: DIRECTIONS[4]!.r * ring });
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        found.push(h);
        h = add(h, DIRECTIONS[side]!);
      }
    }
  }
  return found;
}

/**
 * The shortest walk from `from` to `to` through hexes `passable` allows, as the hexes stepped onto (without `from`),
 * or null when there is none. Every step costs `cost(from, to)`, 1 unless given. Ties go the same way every time, so
 * the client and the server find the same path. The search stops after `limit` hexes are expanded.
 */
export function findPath(
  from: Hex,
  to: Hex,
  passable: (h: Hex) => boolean,
  cost: (a: Hex, b: Hex) => number = () => 1,
  limit = 4096,
): Hex[] | null {
  if (equals(from, to)) {
    return [];
  }
  if (!passable(to)) {
    return null;
  }

  const open = new MinQueue<Hex>();
  const came = new Map<string, Hex>();
  const spent = new Map<string, number>([[key(from), 0]]);
  open.push(from, distance(from, to), 0);
  let expanded = 0;

  while (open.size > 0) {
    const current = open.pop()!;
    if (equals(current, to)) {
      const path: Hex[] = [];
      for (let h: Hex | undefined = current; h && !equals(h, from); h = came.get(key(h))) {
        path.push(h);
      }
      return path.reverse();
    }
    if (++expanded > limit) {
      return null;
    }

    const here = spent.get(key(current))!;
    for (const next of neighbors(current)) {
      if (!passable(next)) {
        continue;
      }
      const total = here + cost(current, next);
      const known = spent.get(key(next));
      if (known === undefined || total < known) {
        spent.set(key(next), total);
        came.set(key(next), current);
        open.push(next, total + distance(next, to), total);
      }
    }
  }
  return null;
}

/** A binary heap ordered by priority, then by larger spent cost (deeper first), then by insertion: a total order. */
class MinQueue<T> {
  private readonly items: { value: T; priority: number; spent: number; order: number }[] = [];
  private pushed = 0;

  get size(): number {
    return this.items.length;
  }

  push(value: T, priority: number, spent: number): void {
    this.items.push({ value, priority, spent, order: this.pushed++ });
    this.up(this.items.length - 1);
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top === undefined || last === undefined) {
      return undefined;
    }
    if (this.items.length > 0) {
      this.items[0] = last;
      this.down(0);
    }
    return top.value;
  }

  private before(a: number, b: number): boolean {
    const x = this.items[a]!;
    const y = this.items[b]!;
    if (x.priority !== y.priority) return x.priority < y.priority;
    if (x.spent !== y.spent) return x.spent > y.spent;
    return x.order < y.order;
  }

  private swap(a: number, b: number): void {
    const t = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = t;
  }

  private up(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) return;
      this.swap(i, parent);
      i = parent;
    }
  }

  private down(i: number): void {
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < this.items.length && this.before(left, best)) best = left;
      if (right < this.items.length && this.before(right, best)) best = right;
      if (best === i) return;
      this.swap(i, best);
      i = best;
    }
  }
}
