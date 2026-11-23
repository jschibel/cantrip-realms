// The map generator's workbench: a hex map being drawn, with the strokes the place generators use (fill, roads,
// rooms, scatter), and a last pass that carves a way to everything a player has to reach, so every map it writes
// passes the content lint (src/maps/schema.ts).

import { type Hex, DIRECTIONS, add, distance, hex, key, neighbors, round, spiral, toWorld } from "../../src/hex";
import { fnv1a32, mulberry32 } from "../../src/random";
import type {
  ChestData,
  EncounterZoneData,
  ExitData,
  MapData,
  MapKind,
  NpcData,
  PropKind,
  Region,
  SpawnData,
  Terrain,
} from "../../src/maps/schema";

export const STEP = 0.25;

export interface Cell {
  height: number;
  terrain: Terrain;
  blocked: boolean;
  prop?: PropKind;
  /** Set pieces and roads the scatter and the noise must leave alone. */
  fixed?: boolean;
}

/** Smooth value noise over the plane, seeded: about one bump every `scale` world units. */
export function noise(seed: number, scale: number): (h: Hex) => number {
  const corner = (i: number, j: number) => fnv1a32(`${seed}:${i}:${j}`) / 4294967296;
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (h: Hex) => {
    const { x, z } = toWorld(h);
    const u = x / scale;
    const v = z / scale;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = fade(u - i);
    const fv = fade(v - j);
    const top = corner(i, j) * (1 - fu) + corner(i + 1, j) * fu;
    const bottom = corner(i, j + 1) * (1 - fu) + corner(i + 1, j + 1) * fu;
    return top * (1 - fv) + bottom * fv;
  };
}

/** The hexes on a straight line between two hexes, both ends included. */
export function line(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  const found: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // Nudged off the exact midpoint, so ties round the same way every time.
    found.push(round(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 2e-6));
  }
  return found;
}

/** The hex `steps` away from the centre in the direction of `angle` (radians, 0 along +x, turning toward +z). */
export function toward(angle: number, steps: number, centre: Hex = hex(0, 0)): Hex {
  const { x, z } = toWorld(centre);
  const reach = steps * Math.sqrt(3);
  const px = x + Math.cos(angle) * reach;
  const pz = z + Math.sin(angle) * reach;
  return round((2 / 3) * px, (-1 / 3) * px + (Math.sqrt(3) / 3) * pz);
}

/** The ring of hexes exactly `radius` steps out. */
export function ring(centre: Hex, radius: number): Hex[] {
  return spiral(centre, radius).filter((h) => distance(h, centre) === radius);
}

export class MapBuilder {
  readonly cells = new Map<string, Cell & { hex: Hex }>();
  readonly exits: ExitData[] = [];
  readonly spawns: SpawnData[] = [];
  readonly chests: ChestData[] = [];
  readonly npcs: NpcData[] = [];
  encounters: EncounterZoneData[] | undefined;
  inn: Hex | undefined;
  readonly random: () => number;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly kind: MapKind,
    readonly radius: number,
    readonly region?: Region,
    readonly floor?: number,
  ) {
    this.random = mulberry32(fnv1a32(id));
    for (const h of spiral(hex(0, 0), radius)) {
      this.cells.set(key(h), { hex: h, height: 0, terrain: "grass", blocked: false });
    }
  }

  get all(): (Cell & { hex: Hex })[] {
    return [...this.cells.values()];
  }

  has(h: Hex): boolean {
    return this.cells.has(key(h));
  }

  cell(h: Hex): (Cell & { hex: Hex }) | undefined {
    return this.cells.get(key(h));
  }

  /** Changes a hex, if it is on the map. */
  set(h: Hex, patch: Partial<Cell>): void {
    const cell = this.cells.get(key(h));
    if (cell) Object.assign(cell, patch);
  }

  /** Puts scenery on a hex; it blocks the hex unless told otherwise. */
  prop(h: Hex, kind: PropKind, blocked = true): void {
    this.set(h, { prop: kind, blocked, fixed: true });
  }

  /** Leaves a hex open and bare, and keeps it so. */
  clear(h: Hex, terrain?: Terrain): void {
    const cell = this.cell(h);
    if (!cell) return;
    cell.prop = undefined;
    cell.blocked = false;
    cell.fixed = true;
    if (terrain) cell.terrain = terrain;
    if (cell.terrain === "water" || cell.terrain === "deep-water" || cell.terrain === "lava") cell.terrain = "dirt";
  }

  /** A road or a corridor: every hex within `width` of the line between the points, cleared, levelled and paved. */
  road(points: readonly Hex[], terrain: Terrain, width = 0, height?: number): void {
    for (let i = 1; i < points.length; i++) {
      for (const h of line(points[i - 1]!, points[i]!)) {
        for (const w of spiral(h, width)) {
          const cell = this.cell(w);
          if (!cell || cell.fixed) continue;
          this.clear(w, terrain);
          if (height !== undefined) cell.height = height;
        }
      }
    }
  }

  /** A round open area of one terrain and height: a plaza, a room, a clearing. */
  disc(centre: Hex, radius: number, terrain: Terrain, height?: number): void {
    for (const h of spiral(centre, radius)) {
      const cell = this.cell(h);
      if (!cell) continue;
      this.clear(h, terrain);
      cell.terrain = terrain;
      if (height !== undefined) cell.height = height;
    }
  }

  /** Puts `kind` on a share of the open, unfixed hexes `where` allows. */
  scatter(kinds: readonly PropKind[], share: number, where: (cell: Cell & { hex: Hex }) => boolean = () => true): void {
    for (const cell of this.all) {
      if (cell.fixed || cell.blocked || cell.prop || !where(cell)) continue;
      if (this.random() < share) {
        cell.prop = kinds[Math.floor(this.random() * kinds.length)]!;
        cell.blocked = true;
      }
    }
  }

  exit(h: Hex, to: string): void {
    this.clear(h);
    this.exits.push({ q: h.q, r: h.r, to });
  }

  npc(h: Hex, npc: Omit<NpcData, "q" | "r">, prop?: PropKind): void {
    this.set(h, { blocked: true, fixed: true, prop });
    this.npcs.push({ ...npc, q: h.q, r: h.r });
    // Somewhere to stand in front of them.
    const front = neighbors(h).filter((n) => this.has(n));
    front.sort((a, b) => distance(a, hex(0, 0)) - distance(b, hex(0, 0)));
    if (front[0] && !front.some((n) => this.cell(n)?.blocked === false)) this.clear(front[0]);
  }

  chest(h: Hex, id: string, gold: [number, number], respawnSeconds = 86400): void {
    this.set(h, { blocked: true, fixed: true, prop: undefined });
    this.chests.push({ id, q: h.q, r: h.r, gold, respawnSeconds });
  }

  spawn(h: Hex, id: string, mobs: readonly string[], radius: number, respawnSeconds = 600): void {
    this.clear(h);
    this.spawns.push({ id, q: h.q, r: h.r, mobs, radius, respawnSeconds });
  }

  /** The open, unfixed hex nearest `h` that `ok` allows (for placing a spawn or chest where the noise left room). */
  nearestOpen(h: Hex, ok: (cell: Cell & { hex: Hex }) => boolean = () => true): Hex {
    for (const c of spiral(h, this.radius * 2)) {
      const cell = this.cell(c);
      if (cell && !cell.blocked && !cell.fixed && ok(cell) && !this.taken(c)) return c;
    }
    return h;
  }

  /** Whether an exit, spawn, chest or person is on the hex. */
  taken(h: Hex): boolean {
    const at = (p: { q: number; r: number }) => p.q === h.q && p.r === h.r;
    return this.exits.some(at) || this.spawns.some(at) || this.chests.some(at) || this.npcs.some(at) || (this.inn !== undefined && at(this.inn));
  }

  /**
   * Makes sure everything can be walked to from the first arrival: where a goal is cut off, the cheapest way to it
   * through blocked scenery is cleared (never through a person, a chest or deep water if there is another way).
   */
  connect(): void {
    if (this.kind === "world") return;
    const start = this.inn ?? this.exits[0];
    if (!start) return;
    const from = hex(start.q, start.r);
    const goals: Hex[] = [
      ...this.exits.map((e) => hex(e.q, e.r)),
      ...this.spawns.map((s) => hex(s.q, s.r)),
      ...[...this.chests, ...this.npcs].map((c) => {
        const free = neighbors(hex(c.q, c.r)).filter((n) => this.has(n) && !this.isThing(n));
        free.sort((a, b) => distance(a, from) - distance(b, from));
        return free[0] ?? hex(c.q, c.r);
      }),
    ];
    const came = this.cheapest(from);
    for (const goal of goals) {
      if (!this.has(goal)) throw new Error(`${this.id}: ${key(goal)} is off the map`);
      for (let h: Hex | undefined = goal; h && key(h) !== key(from); h = came.get(key(h))) {
        const cell = this.cell(h)!;
        if (cell.blocked && !this.isThing(h)) {
          cell.blocked = false;
          cell.prop = undefined;
          if (cell.terrain === "water" || cell.terrain === "deep-water" || cell.terrain === "lava") cell.terrain = "sand";
        }
      }
    }
  }

  private isThing(h: Hex): boolean {
    const at = (p: { q: number; r: number }) => p.q === h.q && p.r === h.r;
    return this.chests.some(at) || this.npcs.some(at);
  }

  /** Dijkstra from `from` where open hexes cost 1, scenery 8 and water or lava 30; people and chests are walls. */
  private cheapest(from: Hex): Map<string, Hex> {
    const cost = (h: Hex) => {
      const cell = this.cell(h);
      if (!cell || this.isThing(h)) return Infinity;
      if (!cell.blocked) return 1;
      if (cell.terrain === "water" || cell.terrain === "deep-water" || cell.terrain === "lava") return 30;
      return 8;
    };
    const spent = new Map<string, number>([[key(from), 0]]);
    const came = new Map<string, Hex>();
    const heap: { h: Hex; d: number; n: number }[] = [];
    let pushed = 0;
    const less = (i: number, j: number) => heap[i]!.d < heap[j]!.d || (heap[i]!.d === heap[j]!.d && heap[i]!.n < heap[j]!.n);
    const swap = (i: number, j: number) => ([heap[i], heap[j]] = [heap[j]!, heap[i]!]);
    const push = (h: Hex, d: number) => {
      heap.push({ h, d, n: pushed++ });
      for (let i = heap.length - 1; i > 0 && less(i, (i - 1) >> 1); i = (i - 1) >> 1) swap(i, (i - 1) >> 1);
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && less(l, m)) m = l;
          if (r < heap.length && less(r, m)) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    };
    push(from, 0);
    while (heap.length > 0) {
      const { h, d } = pop();
      if (d > (spent.get(key(h)) ?? Infinity)) continue;
      for (const n of neighbors(h)) {
        const c = cost(n);
        if (c === Infinity) continue;
        const total = d + c;
        if (total < (spent.get(key(n)) ?? Infinity)) {
          spent.set(key(n), total);
          came.set(key(n), h);
          push(n, total);
        }
      }
    }
    return came;
  }

  build(): MapData {
    this.connect();
    const cells = spiral(hex(0, 0), this.radius).map((h) => this.cell(h)!);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      ...(this.region ? { region: this.region } : {}),
      ...(this.floor !== undefined ? { floor: this.floor } : {}),
      radius: this.radius,
      ...(this.inn ? { inn: { q: this.inn.q, r: this.inn.r } } : {}),
      tiles: cells.map((c) => [c.hex.q, c.hex.r, round2(c.height), c.terrain, c.blocked ? 1 : 0] as const),
      props: cells.filter((c) => c.prop).map((c) => ({ q: c.hex.q, r: c.hex.r, kind: c.prop! })),
      exits: this.exits,
      spawns: this.spawns,
      chests: this.chests,
      npcs: this.npcs,
      ...(this.encounters ? { encounters: this.encounters } : {}),
    };
  }
}

export { DIRECTIONS, add, distance, hex, key, neighbors, spiral };
