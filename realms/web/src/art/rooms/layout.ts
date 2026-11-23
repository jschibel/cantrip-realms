import { fnv1a32, mulberry32 } from "../../random";
import {
  BLOCKED,
  type InteriorData,
  type InteriorKind,
  type LightData,
  NO_SURFACE,
  type NpcData,
  type PropData,
  type RGB,
  type TileData,
  type XZ,
} from "../../world/format";
import type { Gallery } from "./hall";
import { type Finish, ROOM_STYLES, type RoomStyle, finishOf, styleOf } from "./styles";

// Laying out a room: from an interior's kind, its building's style and size, and a seed, the room's floor, its
// furniture (props), the people who keep it (npcs) and its fires' and windows' light - an `InteriorData`, as the world
// generator writes it to `interiors/<id>.json` (realms/docs/tech.md B5, "Rooms"). The same spec gives the same room.
//
// Every room is walked whole from its door: furniture is set down only where it leaves every open tile reached from the
// arrival (a keeper's place behind a counter is the one pocket allowed). The tall things stand against the back wall,
// low ones against the side walls (which drop away toward the camera), and the way in from the door is kept clear.

export const ROOM_KINDS = ["shop", "inn", "guildhall", "temple", "smithy", "library", "house", "tower", "exotic-wares"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export { ROOM_STYLES, type RoomStyle };

/** What a shop trades in: its wares. */
export const SPECIALTIES = ["cards", "curios", "books", "weapons"] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export interface RoomSpec {
  readonly id: string;
  readonly name?: string;
  readonly kind: RoomKind;
  /** The building's style: benalish, llanowar, morass, keldon, tolarian, vess (or an alias, styles.ts). */
  readonly style: string;
  readonly seed: number;
  readonly town?: string;
  /** The floor's size in tiles; else from `building` (or the kind's usual). */
  readonly w?: number;
  readonly d?: number;
  /** The footprint of the building it is behind, world units. */
  readonly building?: { readonly w: number; readonly d: number };
  /** The world tile one comes out on: the building's door tile. */
  readonly exit: XZ;
  /** A shop's wares; by the seed when not given. */
  readonly specialty?: string;
  /** An inn's rooms upstairs (default true); false makes it a tavern. */
  readonly upstairs?: boolean;
  /** Laid over the room's keeper (the vendor, the innkeeper, the armorer...): its id, name, vendor, figure. */
  readonly keeper?: Partial<NpcData>;
}

const TITLES: Record<InteriorKind, string> = {
  shop: "Shop",
  inn: "Inn",
  guildhall: "Guildhall",
  temple: "Temple",
  smithy: "Smithy",
  library: "Library",
  house: "House",
  tower: "Mage tower",
  "exotic-wares": "Exotic wares",
  crypt: "Crypt",
};

export const roomTitle = (kind: InteriorKind): string => TITLES[kind];

/** Each kind's floor: its smallest and largest, in tiles. A room is seen whole at every heading up to its largest. */
export const ROOM_SIZES: Readonly<Record<RoomKind, { readonly w: readonly [number, number]; readonly d: readonly [number, number] }>> = {
  house: { w: [8, 10], d: [6, 7] },
  shop: { w: [9, 11], d: [6, 7] },
  inn: { w: [10, 11], d: [6, 7] },
  guildhall: { w: [10, 11], d: [6, 7] },
  temple: { w: [9, 11], d: [6, 7] },
  smithy: { w: [9, 11], d: [6, 7] },
  library: { w: [9, 11], d: [6, 7] },
  tower: { w: [8, 10], d: [8, 10] },
  "exotic-wares": { w: [9, 11], d: [6, 7] },
};

/** A room's floor for its kind and building: the building's footprint grown a little, kept to the kind's sizes. */
export function roomSize(kind: RoomKind, building: { readonly w: number; readonly d: number } | undefined, random: () => number): { w: number; d: number } {
  const s = ROOM_SIZES[kind];
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));
  if (kind === "tower") {
    // Round: an even width across, so the way out is in the middle.
    const across = building ? Math.round(Math.max(building.w, building.d)) : s.w[0];
    const even = clamp(across + (across % 2), s.w);
    return { w: even - (even % 2), d: even - (even % 2) };
  }
  if (building) return { w: clamp(Math.round(building.w * 1.25) + 1, s.w), d: clamp(Math.round(building.d * 1.1) + 1, s.d) };
  return { w: s.w[0] + Math.floor(random() * (s.w[1] - s.w[0] + 1)), d: s.d[0] + Math.floor(random() * (s.d[1] - s.d[0] + 1)) };
}

// --- The plan: what stands where -----------------------------------------------------------------------------------------

const FREE = 0;
const TAKEN = 1;
const AISLE = 2;
const OUTSIDE = 3;
const POCKET = 4;

/** The light of a fire (a hearth, a forge's mouth), flickering in step with the flames (as the slice's rooms). */
const fire = (x: number, y: number, z: number, phase: number, strength = 1): LightData => ({
  kind: "point",
  at: [x, y, z],
  color: [1, 0.55, 0.25],
  intensity: 9 * strength,
  reach: 7.5,
  flicker: { base: 8 * strength, steps: [0, 1.6 * strength, 0.7 * strength], rate: 8, phase },
});
const candleLight = (x: number, y: number, z: number): LightData => ({ kind: "point", at: [x, y, z], color: [1, 0.75, 0.4], intensity: 2.2, reach: 3.2 });
const glowLight = (x: number, y: number, z: number, color: RGB, intensity = 4, reach = 4.5): LightData => ({ kind: "point", at: [x, y, z], color, intensity, reach });
const daylight = (x: number, color: RGB = [1, 0.94, 0.78], intensity = 40): LightData => ({
  kind: "spot",
  at: [x, 4, -1.6],
  to: [x, 0, 3.6],
  color,
  intensity,
  reach: 14,
  angle: 0.36,
  penumbra: 0.05,
  decay: 1.2,
});
const VIOLET: RGB = [0.7, 0.45, 1];
const TEAL: RGB = [0.35, 1, 0.8];

class Plan {
  readonly state: Uint8Array;
  readonly surface: string[];
  readonly props: PropData[] = [];
  readonly npcs: NpcData[] = [];
  readonly lights: LightData[] = [];
  params: Record<string, unknown> = {};
  /** The arrival: a step in from the door. */
  readonly arrive: XZ;

  constructor(
    readonly w: number,
    readonly d: number,
    /** The entry tile's x: the way out's gap is this tile and the one west of it. */
    readonly ex: number,
    readonly finish: Finish,
    readonly random: () => number,
  ) {
    this.state = new Uint8Array(w * d);
    this.surface = new Array<string>(w * d).fill(finish.floor);
    this.arrive = [ex, d - 2];
    // The way in: the door's two tiles and the two in from them.
    this.aisle(ex - 1, d - 2, ex + 1, d);
  }

  private i(x: number, z: number): number {
    return z * this.w + x;
  }

  inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.w && z < this.d && this.state[this.i(x, z)] !== OUTSIDE;
  }

  get(x: number, z: number): number {
    return x >= 0 && z >= 0 && x < this.w && z < this.d ? this.state[this.i(x, z)]! : OUTSIDE;
  }

  /** Whether every tile of [x0, x1) by [z0, z1) is free. */
  free(x0: number, z0: number, x1: number, z1: number): boolean {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (this.get(x, z) !== FREE) return false;
    return x1 > x0 && z1 > z0;
  }

  /** Keeps tiles clear: nothing is set down on them. */
  aisle(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = Math.max(0, z0); z < Math.min(this.d, z1); z++) for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) if (this.state[this.i(x, z)] === FREE) this.state[this.i(x, z)] = AISLE;
  }

  /** A keeper's place: free tiles no one need reach (behind a counter). */
  pocket(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (this.get(x, z) === FREE) this.state[this.i(x, z)] = POCKET;
  }

  outside(x: number, z: number): void {
    this.state[this.i(x, z)] = OUTSIDE;
  }

  paint(x0: number, z0: number, x1: number, z1: number, surface: string): void {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (this.inside(x, z)) this.surface[this.i(x, z)] = surface;
  }

  /** Every free tile and every aisle is reached from the arrival, four ways. */
  private walkedWhole(): boolean {
    const seen = new Uint8Array(this.w * this.d);
    const open = (x: number, z: number) => {
      const s = this.get(x, z);
      return s === FREE || s === AISLE;
    };
    const [ax, az] = this.arrive;
    if (!open(ax, az)) return false;
    const queue: number[] = [this.i(ax, az)];
    seen[queue[0]!] = 1;
    for (let k = 0; k < queue.length; k++) {
      const at = queue[k]!;
      const x = at % this.w;
      const z = Math.floor(at / this.w);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        if (!open(nx, nz) || seen[this.i(nx, nz)]) continue;
        seen[this.i(nx, nz)] = 1;
        queue.push(this.i(nx, nz));
      }
    }
    for (let k = 0; k < this.state.length; k++) if ((this.state[k] === FREE || this.state[k] === AISLE) && !seen[k]) return false;
    return true;
  }

  /** Takes the tiles [x0, x1) by [z0, z1) for furniture if they are free and the room is still walked whole. */
  take(x0: number, z0: number, x1: number, z1: number, allowPocket = false): boolean {
    const was: [number, number][] = [];
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const s = this.get(x, z);
        if (s !== FREE && !(allowPocket && s === POCKET)) {
          for (const [k, v] of was) this.state[k] = v;
          return false;
        }
        was.push([this.i(x, z), s]);
        this.state[this.i(x, z)] = TAKEN;
      }
    }
    if (was.length === 0 || this.walkedWhole()) return true;
    for (const [k, v] of was) this.state[k] = v;
    return false;
  }

  /** Takes what it can of [x0, x1) by [z0, z1), a tile at a time, keeping the room walked whole: how many it took. */
  claim(x0: number, z0: number, x1: number, z1: number): number {
    let n = 0;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (this.get(x, z) === FREE && this.take(x, z, x + 1, z + 1)) n++;
    return n;
  }

  /** Sets a prop down on the tiles it takes, if they can be had; false (and nothing done) if not. */
  piece(x0: number, z0: number, x1: number, z1: number, prop: PropData): boolean {
    if (!this.take(x0, z0, x1, z1)) return false;
    this.props.push(prop);
    return true;
  }

  /** A prop that takes no tiles (on a wall, on a table, a rug). */
  add(prop: PropData): void {
    this.props.push(prop);
  }

  /** The leftmost x of a run of `n` free tiles along row z within [x0, x1), nearest `prefer`; -1 for none. */
  run(z: number, n: number, x0: number, x1: number, prefer: number): number {
    let best = -1;
    for (let x = x0; x + n <= x1; x++) {
      if (!this.free(x, z, x + n, z + 1)) continue;
      if (best < 0 || Math.abs(x + n / 2 - prefer) < Math.abs(best + n / 2 - prefer)) best = x;
    }
    return best;
  }

  /** A whole number in [lo, hi]. */
  between(lo: number, hi: number): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.random() < p;
  }
}

// --- The kinds ---------------------------------------------------------------------------------------------------------------

type Layout = (plan: Plan, spec: RoomSpec, keeper: (base: NpcData) => void) => void;

/** The palette furniture in this room takes. */
const tintOf = (plan: Plan): string => plan.finish.palette;

/** A hearth against the back wall at x (its middle), its flags before it, pots and candles on its mantel, its fire's light. */
function hearth(plan: Plan, x: number, phase = 0): boolean {
  if (!plan.take(x - 2, 0, x + 2, 1)) return false;
  // The hearth is 2.75 wide, its middle on a tile's edge (x).
  plan.add({ id: "hearth", x, z: 0 });
  plan.paint(x - 2, 1, x + 2, 2, plan.finish.hearthFloor);
  plan.add({ id: "candle", x: x - 1.25, z: 0.3, y: 1.875 });
  plan.add({ id: "pot", x: x + 0.75, z: 0.3, y: 1.875, args: { r: 0.12 } });
  if (plan.chance(0.5)) plan.add({ id: "skull", x: x - 0.4, z: 0.32, y: 1.875 });
  plan.lights.push(fire(x, 1, 1.2, phase));
  return true;
}

/** A free-standing table with seats round it, its middle at (x + w/2, z + d/2): stools or chairs, a meal or a candle. */
function diningTable(plan: Plan, x: number, z: number, w: number, d: number, seats: "chairs" | "stools" | "benches", meal = true): boolean {
  if (!plan.take(x, z, x + w, z + d)) return false;
  const tint = tintOf(plan);
  const mx = x + w / 2;
  const mz = z + d / 2;
  plan.add({ id: "table", x: mx, z: mz, tint, args: { w: w - 0.5, d: d - 0.25, cloth: plan.chance(0.4) } });
  if (meal) plan.add({ id: "tankards", x: mx, z: mz, y: 0.8125, seed: plan.between(1, 9) });
  if (plan.chance(0.7)) {
    plan.add({ id: "candle", x: mx + (w - 0.5) / 2 - 0.3, z: mz - 0.2, y: 0.8125 });
    plan.lights.push(candleLight(mx + (w - 0.5) / 2 - 0.3, 1.2, mz - 0.2));
  }
  if (seats === "benches") {
    if (plan.take(x, z - 1, x + w, z)) plan.add({ id: "bench-seat", x: mx, z: z - 0.4, tint, args: { len: w - 0.5 } });
    if (plan.take(x, z + d, x + w, z + d + 1)) plan.add({ id: "bench-seat", x: mx, z: z + d + 0.4, tint, args: { len: w - 0.5 } });
    return true;
  }
  // Seats along its long sides, a tile from it, where the floor is free (they do not block: they are pulled out).
  for (let k = 0; k < Math.floor(w); k++) {
    const sx = x + k + 0.5;
    if (k % 2 === 1 && w < 3) continue;
    for (const [sz, rot] of [[z - 0.35, 0], [z + d + 0.35, 2]] as const) {
      const tz = Math.floor(sz);
      if (plan.get(Math.floor(sx), tz) !== FREE && plan.get(Math.floor(sx), tz) !== AISLE) continue;
      if (seats === "stools") plan.add({ id: "stool", x: sx, z: sz });
      else plan.add({ id: "chair", x: sx, z: sz + (rot === 0 ? -0.1 : 0.1), rot: rot === 0 ? 0 : 2, tint });
    }
  }
  return true;
}

/** Barrels, sacks and crates heaped in a front corner (west or east). */
function cornerStores(plan: Plan, side: "west" | "east"): void {
  const x = side === "west" ? 0 : plan.w - 1;
  const z = plan.d - 1;
  if (!plan.take(x, z - 1, x + 1, z + 1)) {
    if (!plan.take(x, z, x + 1, z + 1)) return;
    plan.add({ id: "barrel", x: x + 0.5, z: z + 0.45, args: { h: 0.8 } });
    return;
  }
  const at = side === "west" ? x + 0.5 : x + 0.5;
  plan.add({ id: "barrel", x: at, z: z - 0.55 });
  plan.add({ id: "sack", x: at + (side === "west" ? 0.05 : -0.05), z: z + 0.45 });
  if (plan.chance(0.6)) plan.add({ id: "crate", x: at + (side === "west" ? 0.6 : -0.6), z: z + 0.5, turn: 0.15, args: { size: 0.5, goods: plan.chance(0.5) ? "apples" : "carrots" } });
}

/** Goods shelves (bottled wares) or books along the back wall between x0 and x1, a tile each, with a window or a poster. */
function shelves(plan: Plan, x0: number, x1: number, goods: boolean, count: number): number {
  let placed = 0;
  for (let x = x0; x < x1 && placed < count; x++) {
    if (!plan.take(x, 0, x + 1, 1)) continue;
    plan.add({ id: "bookshelf", x, z: 0, seed: plan.between(1, 20), ...(goods ? { args: { goods: true } } : {}) });
    placed++;
  }
  return placed;
}

/** A window in the back wall at x (its left), daylight falling through it. */
function window(plan: Plan, x: number, y = 1.125): void {
  plan.add({ id: "back-window", x, z: 0, y });
  plan.lights.push(daylight(x + 0.5));
}

const house: Layout = (plan) => {
  const { w, d } = plan;
  const west = plan.chance(0.5);
  const hx = west ? 2 : w - 2;
  hearth(plan, hx);
  // The bed against the back wall on the other side, a chest at its foot, a cupboard beside it.
  const bx = west ? w - 2 : 0;
  if (plan.take(bx, 0, bx + 1, 2)) {
    plan.add({ id: "bed", x: bx + 0.5, z: 0, tint: tintOf(plan), seed: plan.between(1, 9) });
    if (plan.take(bx, 2, bx + 1, 3)) plan.add({ id: "chest", x: bx + 0.5, z: 2.4, tint: tintOf(plan) });
  }
  const cx = west ? w - 3 : 1;
  if (plan.take(cx, 0, cx + 1, 1)) plan.add({ id: "wardrobe", x: cx, z: 0, tint: tintOf(plan) });
  // A window and a shelf between.
  const mid = Math.floor(w / 2);
  window(plan, west ? mid - 1 : mid);
  shelves(plan, west ? mid + 1 : mid - 2, west ? mid + 2 : mid - 1, plan.chance(0.5), 1);
  // The table by the fire, a carpet, stores in a front corner.
  const tx = west ? 1 : w - 4;
  diningTable(plan, tx, Math.min(3, d - 4), 3, 1, plan.chance(0.5) ? "stools" : "chairs", plan.chance(0.5));
  plan.add({ id: "carpet", x: Math.max(1, plan.ex - 2), z: d - 2.75, tint: tintOf(plan), args: { to: [Math.min(w - 1, plan.ex + 2), d - 0.75] } });
  cornerStores(plan, west ? "east" : "west");
  if (plan.take(west ? 0 : w - 1, 2, west ? 1 : w, 3)) plan.add({ id: "plant", x: west ? 0.5 : w - 0.5, z: 2.5 });
};

const shop: Layout = (plan, spec, keeper) => {
  const { w, d } = plan;
  const specialty: Specialty = (SPECIALTIES as readonly string[]).includes(spec.specialty ?? "") ? (spec.specialty as Specialty) : SPECIALTIES[plan.between(0, 3)]!;
  plan.params = { ...plan.params, specialty };
  const west = plan.chance(0.5);
  // The counter: an L round the keeper's place in a back corner, its return toward the room's middle.
  const cw = Math.min(5, Math.floor(w / 2));
  const c0 = west ? 0 : w - cw;
  plan.pocket(c0, 0, c0 + cw, 2);
  plan.take(c0, 2, c0 + cw, 3);
  const returnX = west ? c0 + cw - 1 : c0;
  plan.take(returnX, 1, returnX + 1, 2, true);
  plan.add({
    id: "shop-counter",
    x: west ? c0 + cw - 0.75 : c0 + 0.25,
    z: 1,
    args: { to: west ? [c0 + 0.25, 3] : [c0 + cw - 0.25, 3] },
  });
  if (west) {
    // The counter's return runs north on its west end: mirrored, it is drawn as its own piece.
    plan.props.pop();
    plan.add({ id: "bar-counter", x: c0 + 0.25, z: 2.25, args: { to: [c0 + cw - 0.25, 3] } });
    plan.add({ id: "bar-counter", x: c0 + cw - 1, z: 1, args: { to: [c0 + cw - 0.25, 2.25] } });
  }
  const kx = west ? c0 + 1 : c0 + cw - 2;
  keeper({ id: `${spec.id}-keeper`, x: kx, z: 1, kind: "vendor", name: "Shopkeeper", stand: [kx + 0.5, 0, 1.6], behaviour: { rest: [0, 1], watch: 5 } });
  // On the counter: scales, coin, the ledger, a candle.
  const top = 1.0625;
  const cx = west ? c0 + 1.5 : c0 + 1.25;
  plan.add({ id: "scales", x: cx, z: 2.6, y: top });
  plan.add({ id: "coins", x: cx + 1, z: 2.55, y: top });
  plan.add({ id: "ledger", x: cx + 1.75, z: 2.35, y: top });
  plan.add({ id: "candle", x: west ? c0 + 0.5 : c0 + cw - 0.5, z: 2.6, y: top });
  plan.lights.push(candleLight(west ? c0 + 0.5 : c0 + cw - 0.5, 1.6, 2.7));
  // Behind the counter, the back wall: shelves of the specialty's goods.
  for (let x = c0; x < c0 + cw; x++) {
    if (!plan.take(x, 0, x + 1, 1, true)) continue;
    if (specialty === "weapons" && x % 2 === 1) {
      plan.add({ id: "blade-rack", x: x + 0.5, z: 0, y: 1.25 });
      plan.add({ id: "shield", x: x + 0.2, z: 0, y: 0.3 });
    } else plan.add({ id: "bookshelf", x, z: 0, seed: plan.between(1, 20), ...(specialty === "books" ? {} : { args: { goods: true } }) });
  }
  // The rest of the back wall: a hearth or a window, and the wares.
  const r0 = west ? c0 + cw : 0;
  const r1 = west ? w : c0;
  if (r1 - r0 >= 5 && plan.chance(0.6)) hearth(plan, west ? r1 - 2 : r0 + 2);
  else window(plan, Math.floor((r0 + r1) / 2));
  wares(plan, specialty, r0, r1, west);
  cornerStores(plan, west ? "east" : "west");
  if (plan.chance(0.5)) cornerStores(plan, west ? "west" : "east");
};

/** A shop's wares, by what it trades in, on the floor and the wall between x0 and x1 (the side away from the counter). */
function wares(plan: Plan, specialty: Specialty, x0: number, x1: number, counterWest: boolean): void {
  const { d } = plan;
  const tint = tintOf(plan);
  const mid = Math.floor((x0 + x1) / 2);
  const away = counterWest ? x1 - 1 : x0;
  switch (specialty) {
    case "cards": {
      for (const [x, z] of [[mid - 1, 3], [mid - 1, 5]] as const) if (z + 1 < d - 1 && plan.take(x, z, x + 2, z + 1)) plan.add({ id: "card-case", x: x + 1, z: z + 0.5, seed: plan.between(1, 9), tint });
      if (plan.take(away, 2, away + 1, 3)) plan.add({ id: "booster-crate", x: away + 0.5, z: 2.5, seed: plan.between(0, 4) });
      plan.add({ id: "poster", x: x0 + 0.5, z: 0, y: 2.3, seed: 2 });
      shelves(plan, x0, x1, true, 2);
      break;
    }
    case "curios": {
      for (let x = x0; x < x1; x++) if (plan.get(x, 0) === FREE && plan.take(x, 0, x + 1, 1)) plan.add({ id: "curio-case", x, z: 0, seed: plan.between(1, 9), tint });
      if (plan.take(mid, 3, mid + 1, 4)) plan.add({ id: "relic-pedestal", x: mid + 0.5, z: 3.5, seed: plan.between(0, 3) });
      for (const [x, z] of [[away, 3], [away, 4]] as const) if (plan.take(x, z, x + 1, z + 1)) plan.add({ id: "pot", x: x + 0.5, z: z + 0.5, args: { r: 0.22 } });
      plan.lights.push(glowLight(mid + 0.5, 1.4, 3.5, [1, 0.85, 0.55], 2.5, 3.5));
      break;
    }
    case "books": {
      shelves(plan, x0, x1, false, 4);
      if (plan.take(mid - 1, 3, mid + 1, 4)) plan.add({ id: "bookcase", x: mid, z: 3.5, seed: plan.between(1, 20), tint, args: { len: 2, h: 1.75 } });
      if (plan.take(away, 2, away + 1, 3)) plan.add({ id: "lectern", x: away + 0.5, z: 2.5, tint });
      plan.add({ id: "book-pile", x: mid + 0.3, z: d - 2.4, seed: plan.between(1, 9) });
      break;
    }
    case "weapons": {
      for (let x = x0; x < x1; x += 2) {
        if (plan.get(x, 0) !== FREE) continue;
        plan.add({ id: "blade-rack", x: x + 0.5, z: 0, y: 1.25 });
        plan.add({ id: "shield", x: x + 1.1, z: 0, y: 1.8 });
      }
      if (plan.take(mid - 1, 3, mid + 1, 4)) plan.add({ id: "weapon-rack", x: mid, z: 3.5, tint });
      if (plan.take(away, 2, away + 1, 3)) plan.add({ id: "armor-stand", x: away + 0.5, z: 2.5, seed: plan.between(0, 1), tint });
      if (plan.take(away, 4, away + 1, 5)) plan.add({ id: "weapon-barrel", x: away + 0.5, z: 4.5 });
      break;
    }
  }
}

const inn: Layout = (plan, spec, keeper) => {
  const { w, d } = plan;
  const upstairs = spec.upstairs ?? true;
  const west = plan.chance(0.5);
  const tint = tintOf(plan);
  // The bar along one half of the back wall: the innkeeper behind it, bottles and kegs on the wall behind. In an inn the
  // stair to the rooms upstairs climbs the side wall by it to a gallery over the bar, the rooms' doors along it.
  const bw = Math.min(5, Math.floor(w / 2) - (upstairs ? 0 : 1));
  const sx = west ? 0 : w - 1;
  const bx0 = upstairs ? (west ? 1 : w - 1 - bw) : west ? 0 : w - bw;
  if (upstairs) {
    const gallery: Gallery = { y: 2.75, depth: 0.625, from: west ? 0 : w - bw - 1, to: west ? bw + 1 : w, doors: [] };
    const steps = Math.round(gallery.y / 0.1875);
    plan.take(sx, 0, sx + 1, Math.ceil(gallery.depth + steps * 0.25));
    plan.add({ id: "inn-stair", x: sx, z: gallery.depth, tint, args: { rise: gallery.y, rail: west ? "east" : "west" } });
    const from = gallery.from!;
    const to = gallery.to!;
    const doors: number[] = [];
    for (let x = from + 2; x < to - 0.5; x += 2.5) doors.push(west ? x : to - (x - from));
    plan.params = { ...plan.params, gallery: { ...gallery, doors } };
  }
  plan.pocket(bx0, 0, bx0 + bw, 2);
  plan.take(bx0, 2, bx0 + bw, 3);
  plan.add({ id: "bar-counter", x: bx0 + 0.25, z: 2.2, tint, args: { to: [bx0 + bw - 0.25, 2.85] } });
  const kx = bx0 + Math.floor(bw / 2);
  keeper({ id: `${spec.id}-innkeeper`, x: kx, z: 1, kind: "innkeeper", name: "Innkeeper", stand: [kx + 0.5, 0, 1.5], behaviour: { rest: [0, 1], watch: 5 } });
  plan.take(bx0, 0, bx0 + bw, 1, true);
  const shelf = Math.min(2.5, bw - 1.75);
  plan.add({ id: "bar-shelf", x: west ? bx0 + bw - shelf - 0.1 : bx0 + 0.1, z: 0, tint, seed: plan.between(1, 9), args: { w: shelf } });
  plan.add({ id: "keg-rack", x: west ? bx0 + 0.9 : bx0 + bw - 0.9, z: 0, tint });
  plan.add({ id: "tankards", x: bx0 + bw / 2 - 0.6, z: 2.5, y: 1.0, seed: 4 });
  const lamp = west ? bx0 + bw - 0.4 : bx0 + 0.4;
  plan.add({ id: "candle", x: lamp, z: 2.5, y: 1.0 });
  plan.lights.push(candleLight(lamp, 1.5, 2.6));
  // The hearth on the other half of the back wall.
  const hx = west ? w - 3 : 3;
  hearth(plan, hx, 1);
  // The spell table in a front corner on the hearth's side.
  const tx = west ? w - 3 : 1;
  const tz = d - 3;
  if (plan.take(tx, tz, tx + 2, tz + 1)) {
    plan.add({ id: "spell-desk", x: tx + 1, z: tz + 0.5 });
    plan.npcs.push({ id: `${spec.id}-spell-table`, x: tx + (west ? 0 : 1), z: tz, kind: "spell-table", name: "Spell table", stand: [tx + (west ? 0 : 1) + 0.5, 0, tz + 0.5] });
  }
  // Tables in the middle; in a tavern, a game of cards in the other front corner.
  let placed = 0;
  for (const [x, z] of [[plan.ex - 1, 3], [west ? 1 : w - 4, d - 3], [plan.ex - 3, 4]] as const) {
    if (placed >= (upstairs ? 1 : 2)) break;
    if (diningTable(plan, x, z, 2, 1, plan.chance(0.5) ? "stools" : "benches")) placed++;
  }
  if (!upstairs && plan.take(west ? 1 : w - 3, d - 2, west ? 3 : w - 1, d - 1)) plan.add({ id: "card-table", x: west ? 1 : w - 3, z: d - 2 });
  const wl = west ? w - 5.5 : 5.5;
  plan.add({ id: "wall-lamp", x: wl, z: 0, y: 1.6 });
  plan.lights.push({ ...candleLight(wl, 1.55, 0.9), intensity: 1.4 });
  cornerStores(plan, west ? "east" : "west");
};

const guildhall: Layout = (plan, spec, keeper) => {
  const { w, d } = plan;
  const tint = tintOf(plan);
  // Banners of the guild between the posts, a quest board, a map; the long table under a carpet.
  for (let x = 2; x < w - 1; x += 4) plan.add({ id: "guild-banner", x, z: 0, tint, y: 2.9 });
  const qx = plan.between(0, 1) ? 0.5 : w - 2.5;
  if (plan.take(Math.floor(qx), 0, Math.floor(qx) + 2, 1)) {
    plan.add({ id: "notice-board", x: qx, z: 0 });
  }
  const mx = qx < w / 2 ? w - 3.5 : 2;
  plan.add({ id: "wall-map", x: mx, z: 0, y: 1.0 });
  shelves(plan, qx < w / 2 ? 3 : w - 5, qx < w / 2 ? w - 4 : w - 3, false, 2);
  const tw = Math.min(5, w - 5);
  const tx = Math.floor((w - tw) / 2);
  plan.add({ id: "carpet", x: tx - 0.75, z: 1.75, tint, args: { to: [tx + tw + 0.75, 4.25] } });
  if (plan.take(tx, 2, tx + tw, 4)) {
    plan.add({ id: "table", x: tx + tw / 2, z: 3, tint, args: { w: tw - 0.25, d: 1.5, cloth: true } });
    for (let k = 0; k < tw; k += 1) {
      if (plan.get(tx + k, 1) === FREE) plan.add({ id: "chair", x: tx + k + 0.5, z: 1.75, tint });
      if (plan.get(tx + k, 4) === FREE || plan.get(tx + k, 4) === AISLE) plan.add({ id: "chair", x: tx + k + 0.5, z: 4.25, rot: 2, tint });
    }
    for (const k of [1, tw - 1]) {
      plan.add({ id: "candle", x: tx + k, z: 3, y: 0.8125 });
      plan.lights.push(candleLight(tx + k, 1.3, 3));
    }
    plan.add({ id: "book-pile", x: tx + tw / 2, z: 3, y: 0.8125, seed: 3 });
  }
  // The mages' spell table, a keeper.
  const sx = plan.chance(0.5) ? 1 : w - 3;
  if (plan.take(sx, d - 2, sx + 2, d - 1)) {
    plan.add({ id: "spell-desk", x: sx + 1, z: d - 1.5 });
    plan.npcs.push({ id: `${spec.id}-spell-table`, x: sx + (sx < w / 2 ? 1 : 0), z: d - 2, kind: "spell-table", name: "Spell table", stand: [sx + (sx < w / 2 ? 1 : 0) + 0.5, 0, d - 1.5] });
  }
  keeper({ id: `${spec.id}-guildmaster`, x: tx + tw, z: 2, kind: "townsfolk", name: "Guildmaster", behaviour: { rest: [-1, 0], watch: 5 } });
  for (const x of [0, w - 1]) {
    if (!plan.take(x, 2, x + 1, 3)) continue;
    plan.add({ id: "candle-stand", x: x + 0.5 + (x === 0 ? 0.2 : -0.2), z: 2.5 });
    plan.lights.push({ ...candleLight(x + 0.5 + (x === 0 ? 0.3 : -0.3), 1.45, 2.5), intensity: 1.6 });
  }
};

const temple: Layout = (plan, spec, keeper) => {
  const { w, d } = plan;
  const tint = tintOf(plan);
  plan.paint(0, 0, w, d, plan.finish.fineFloor);
  const mid = plan.ex;
  // The aisle from the door to the altar, kept clear.
  plan.aisle(mid - 1, 3, mid + 1, d);
  // The altar on its dais at the back, stained glass behind it, candles flanking.
  plan.take(mid - 2, 0, mid + 2, 3);
  plan.add({ id: "altar", x: mid, z: 1.25, args: { dais: true }, tint: undefined });
  const windows = [mid - 0.0, mid - 3, mid + 3].filter((x) => x > 0.75 && x < w - 0.75);
  windows.forEach((x, k) => {
    plan.add({ id: "stained-window", x, z: 0, y: k === 0 ? 1.75 : 1.4, seed: k + plan.between(1, 5), args: { w: k === 0 ? 1.25 : 0.875, h: k === 0 ? 2.25 : 1.75 } });
    plan.lights.push({ kind: "spot", at: [x, 3.8, -0.5], to: [x, 0, 4.5], color: [0.75, 0.8, 1], intensity: k === 0 ? 30 : 14, reach: 12, angle: 0.4, penumbra: 0.3, decay: 1.2 });
  });
  for (const x of [mid - 2.5, mid + 2.5]) {
    if (plan.take(Math.floor(x), 1, Math.floor(x) + 1, 2)) {
      plan.add({ id: "candle-stand", x, z: 1.5 });
      plan.lights.push({ ...candleLight(x, 1.45, 1.6), intensity: 1.8 });
    }
  }
  // Columns down both sides, pews between them and the aisle.
  for (const z of [2, 4]) {
    for (const x of [1, w - 2]) if (z < d - 1 && plan.take(x, z, x + 1, z + 1)) plan.add({ id: "pillar", x: x + 0.5, z: z + 0.5, args: { h: 4.25 } });
  }
  for (const [x0, x1] of [[2, mid - 1], [mid + 1, w - 2]] as const) {
    if (x1 - x0 < 2) continue;
    for (let z = 3; z < d - 1; z++) if (plan.take(x0, z, x1, z + 1)) plan.add({ id: "pew", x: (x0 + x1) / 2, z: z + 0.5, rot: 2, tint, args: { len: x1 - x0 - 0.25 } });
  }
  // A font by the door, a candle rack, a runner up the aisle.
  if (plan.take(mid + 1, d - 1, mid + 2, d)) plan.add({ id: "font", x: mid + 1.5, z: d - 0.5 });
  if (plan.take(0, d - 1, 1, d)) {
    plan.add({ id: "candle-rack", x: 0.6, z: d - 0.5, rot: 3 });
    plan.lights.push(candleLight(0.6, 1.0, d - 0.5));
  }
  plan.add({ id: "carpet", x: mid - 0.875, z: 2.75, tint, args: { to: [mid + 0.875, d] } });
  keeper({ id: `${spec.id}-priest`, x: mid, z: 3, kind: "townsfolk", name: "Priest", behaviour: { rest: [0, 1], watch: 5 } });
};

const smithy: Layout = (plan, spec, keeper) => {
  const { w, d } = plan;
  const tint = tintOf(plan);
  plan.paint(0, 0, w, d, plan.finish.stoneFloor);
  const west = plan.chance(0.5);
  // The forge against the back wall, the anvil before it, the quench beside.
  const fx = west ? 3 : w - 3;
  plan.take(fx - 2, 0, fx + 2, 2);
  plan.add({ id: "forge", x: fx, z: 0 });
  plan.lights.push(fire(fx, 1.0, 1.6, 0, 1.4), glowLight(fx, 0.6, 1.4, [1, 0.45, 0.15], 6, 4));
  if (plan.take(fx - 1, 2, fx, 3)) plan.add({ id: "stump-anvil", x: fx - 0.5, z: 2.6, rot: west ? 0 : 2 });
  if (plan.take(fx + 1, 2, fx + 2, 4)) plan.add({ id: "quench-trough", x: fx + 1.5, z: 3, rot: 1 });
  keeper({ id: `${spec.id}-armorer`, x: fx, z: 3, kind: "armorer", name: "Armorer", behaviour: { rest: [0, 1], watch: 5 } });
  plan.take(fx, 3, fx + 1, 4);
  // Tools on the wall, coal and iron by the forge.
  const tx = west ? fx + 3 : fx - 4;
  plan.add({ id: "tool-rack", x: tx, z: 0, y: 1.3, tint });
  if (plan.take(west ? 0 : w - 1, 0, west ? 1 : w, 1)) plan.add({ id: "coal-heap", x: west ? 0.5 : w - 0.5, z: 0.6 });
  // The armorer's wares on the far side: racks of weapons and suits of plate.
  const ax = west ? w - 2 : 1;
  for (const [z, id] of [[1, "armor-stand"], [3, "weapon-rack"]] as const) {
    if (z < d - 1 && plan.take(ax, z, ax + 1, z + 1)) plan.add({ id, x: ax + 0.5, z: z + 0.5, rot: west ? 1 : 3, tint, seed: z });
  }
  if (plan.take(west ? ax - 2 : ax + 1, 0, west ? ax : ax + 3, 1)) {
    plan.add({ id: "blade-rack", x: west ? ax - 1 : ax + 2, z: 0, y: 1.2 });
    plan.add({ id: "shield", x: west ? ax - 1.3 : ax + 1.7, z: 0, y: 0.25 });
  }
  if (plan.take(west ? 0 : w - 1, 2, west ? 1 : w, 3)) plan.add({ id: "grindstone", x: west ? 0.5 : w - 0.5, z: 2.5, rot: 1, tint });
  if (plan.take(west ? 1 : w - 2, d - 2, west ? 2 : w - 1, d - 1)) plan.add({ id: "ingots", x: west ? 1.5 : w - 1.5, z: d - 1.5 });
  cornerStores(plan, west ? "east" : "west");
  window(plan, west ? w - 4 : 3, 1.5);
};

const library: Layout = (plan, spec, keeper) => {
  const { w, d } = plan;
  const tint = tintOf(plan);
  // Books the length of the back wall, but for a window.
  const win = plan.between(2, w - 3);
  for (let x = 0; x < w; x++) {
    if (x === win) continue;
    if (plan.take(x, 0, x + 1, 1)) plan.add({ id: "bookshelf", x, z: 0, seed: plan.between(1, 30) });
  }
  window(plan, win, 1.0);
  plan.add({ id: "ladder", x: win === 3 ? 6.5 : 3.5, z: 0.45, args: { h: 2.4 } });
  // Stacks standing free on one side, reading desks on the other.
  const west = plan.chance(0.5);
  const sx = west ? 1 : w - 4;
  for (const z of [2, 4]) if (z < d - 1 && plan.take(sx, z, sx + 3, z + 1)) plan.add({ id: "bookcase", x: sx + 1.5, z: z + 0.5, seed: plan.between(1, 30), tint, args: { len: 3, h: 2.0 } });
  const dx = west ? w - 3 : 1;
  for (const z of [2, 4]) {
    if (z >= d - 1 || !plan.take(dx, z, dx + 2, z + 1)) continue;
    plan.add({ id: "reading-desk", x: dx + 1, z: z + 0.5, tint });
    plan.add({ id: "chair", x: dx + 1, z: z + 1.25, rot: 2, tint });
    plan.lights.push(candleLight(dx + 0.55, 1.3, z + 0.3));
  }
  if (plan.take(plan.ex - 2, 2, plan.ex - 1, 3)) plan.add({ id: "globe", x: plan.ex - 1.5, z: 2.5, tint });
  if (plan.take(plan.ex + 1, 2, plan.ex + 2, 3)) plan.add({ id: "lectern", x: plan.ex + 1.5, z: 2.5, tint });
  plan.add({ id: "book-pile", x: west ? w - 0.6 : 0.6, z: d - 1.5, seed: 4 });
  plan.add({ id: "carpet", x: plan.ex - 2.5, z: 1.5, tint, args: { to: [plan.ex + 2.5, d - 1] } });
  keeper({ id: `${spec.id}-librarian`, x: plan.ex, z: 1, kind: "townsfolk", name: "Librarian", behaviour: { rest: [0, 1], watch: 5 } });
  plan.add({ id: "wall-lamp", x: west ? w - 0.5 : 0.5, z: 0, y: 2.1 });
};

const exoticWares: Layout = (plan, spec, keeper) => {
  const { w, d } = plan;
  const tint = tintOf(plan);
  const west = plan.chance(0.5);
  // The counter in a back corner, as a shop's, the vendor behind it.
  const cw = 4;
  const c0 = west ? 0 : w - cw;
  plan.pocket(c0, 0, c0 + cw, 2);
  plan.take(c0, 2, c0 + cw, 3);
  plan.add({ id: "bar-counter", x: c0 + 0.25, z: 2.2, tint, args: { to: [c0 + cw - 0.25, 2.85] } });
  const kx = c0 + 1;
  keeper({ id: `${spec.id}-keeper`, x: kx, z: 1, kind: "vendor", name: "Curio dealer", stand: [kx + 0.5, 0, 1.5], behaviour: { rest: [0, 1], watch: 5 } });
  for (let x = c0; x < c0 + cw; x++) if (plan.take(x, 0, x + 1, 1, true)) plan.add({ id: "curio-case", x, z: 0, seed: plan.between(1, 9), tint });
  plan.add({ id: "floating-crystal", x: c0 + 1.5, z: 2.5, y: 1.55, args: { color: "violet", size: 0.14 } });
  plan.add({ id: "relic-pedestal", x: c0 + cw - 0.8, z: 2.5, seed: 1 });
  // The planar rift in the far back corner, its light; curio cases along the wall between.
  const rx = west ? w - 2 : 1;
  if (plan.take(rx - 1, 0, rx + 2, 2)) {
    plan.add({ id: "planar-rift", x: rx + 0.5, z: 0.8 });
    plan.lights.push(glowLight(rx + 0.5, 1.5, 1.4, VIOLET, 9, 6), glowLight(rx + 0.5, 0.6, 1.2, TEAL, 4, 3.5));
  }
  for (let x = west ? cw : 2; x < (west ? w - 3 : w - cw); x++) if (plan.take(x, 0, x + 1, 1)) plan.add({ id: "curio-case", x, z: 0, seed: plan.between(1, 9), tint });
  // Pedestals and lamps in the room, the cauldron in a corner, a carpet.
  const mid = Math.floor(w / 2);
  if (plan.take(mid, 3, mid + 1, 4)) plan.add({ id: "relic-pedestal", x: mid + 0.5, z: 3.5, seed: plan.between(0, 3) });
  if (plan.take(west ? w - 2 : 1, 3, west ? w - 1 : 2, 4)) {
    plan.add({ id: "arcane-lamp", x: west ? w - 1.5 : 1.5, z: 3.5, args: { color: "teal" } });
    plan.lights.push(glowLight(west ? w - 1.5 : 1.5, 1.7, 3.5, TEAL, 4, 4));
  }
  if (plan.take(west ? 0 : w - 1, d - 2, west ? 1 : w, d)) {
    plan.add({ id: "cauldron", x: west ? 0.6 : w - 0.6, z: d - 1.2 });
    plan.lights.push(glowLight(west ? 0.6 : w - 0.6, 1.0, d - 1.2, [0.45, 1, 0.4], 2.5, 3));
  }
  plan.add({ id: "floating-crystal", x: mid - 1.5, z: 4.5, y: 1.9, args: { color: "teal" } });
  plan.lights.push(glowLight(mid - 1.5, 1.9, 4.5, TEAL, 3, 4));
  plan.add({ id: "carpet", x: plan.ex - 2, z: 3, tint: "room-morass", args: { to: [plan.ex + 2, d - 0.5] } });
  plan.lights.push(glowLight(c0 + 1.5, 1.6, 2.5, VIOLET, 3, 4));
};

/** A floor of a mage tower: a round room, its stair winding up at the back, the mage's instruments round a rune circle. */
const tower: Layout = (plan, spec, keeper) => {
  const { w, d } = plan;
  const cx = w / 2;
  const cz = d / 2;
  const R = w / 2;
  const tint = tintOf(plan);
  // Outside the ring is no floor; tiles the wall crosses are floor drawn but not walked.
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const far = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      const near = Math.hypot(Math.max(0, Math.abs(x + 0.5 - cx) - 0.5), Math.max(0, Math.abs(z + 0.5 - cz) - 0.5));
      if (near >= R) plan.outside(x, z);
      else if (far > R - 0.55) plan.take(x, z, x + 1, z + 1);
    }
  }
  const west = plan.chance(0.5);
  // The spiral stair up, at the back to one side.
  const sx = Math.round(cx + (west ? -1 : 1) * R * 0.45);
  const sz = Math.round(cz - R * 0.5);
  plan.claim(sx - 1, sz - 1, sx + 2, sz + 2);
  plan.add({ id: "spiral-stair", x: sx + 0.5, z: sz + 0.5, tint, args: { r: 1.3, h: 3.5, flip: west } });
  // Shelves round the back of the ring, each turned to face the middle.
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (west ? 1 : -1) * (0.55 + k * 0.28);
    const x = cx + Math.cos(a) * (R - 0.05);
    const z = cz + Math.sin(a) * (R - 0.05);
    if (Math.sin(a) > -0.2) break;
    const turn = Math.atan2(-Math.cos(a), -Math.sin(a));
    plan.add({ id: "bookshelf", x: x - Math.cos(turn) * 0.5, z: z + Math.sin(turn) * 0.5, turn: -turn, seed: plan.between(1, 30), ...(k % 3 === 2 ? { args: { goods: true } } : {}) });
    plan.take(Math.floor(x - Math.cos(a) * 0.5), Math.floor(z - Math.sin(a) * 0.5), Math.floor(x - Math.cos(a) * 0.5) + 1, Math.floor(z - Math.sin(a) * 0.5) + 1);
  }
  // The rune circle in the middle, a crystal over it.
  const color = plan.chance(0.5) ? "violet" : "teal";
  plan.add({ id: "rune-circle", x: cx, z: cz + 0.5, args: { r: 1.6, color } });
  plan.add({ id: "floating-crystal", x: cx, z: cz + 0.5, y: 1.7, args: { color, size: 0.3 } });
  plan.lights.push(glowLight(cx, 1.6, cz + 0.5, color === "violet" ? VIOLET : TEAL, 7, 6));
  // The mage's instruments on the other side: an orrery, a telescope, a desk.
  const ox = west ? Math.floor(cx + 1.5) : Math.floor(cx - 2.5);
  if (plan.take(ox, Math.floor(cz - 2), ox + 1, Math.floor(cz - 1))) plan.add({ id: "orrery", x: ox + 0.5, z: Math.floor(cz - 2) + 0.5, tint });
  const tx = west ? Math.floor(cx + R - 2.5) : Math.floor(cx - R + 1.5);
  if (plan.take(tx, Math.floor(cz), tx + 1, Math.floor(cz) + 1)) plan.add({ id: "telescope", x: tx + 0.5, z: Math.floor(cz) + 0.5, rot: west ? 1 : 3, tint });
  const dx = west ? Math.floor(cx - R + 1.5) : Math.floor(cx + R - 3.5);
  if (plan.take(dx, Math.floor(cz) + 1, dx + 2, Math.floor(cz) + 2)) {
    plan.add({ id: "reading-desk", x: dx + 1, z: Math.floor(cz) + 1.5, tint, rot: west ? 3 : 1 });
    plan.lights.push(candleLight(dx + 1, 1.3, Math.floor(cz) + 1.5));
  }
  const px = west ? Math.floor(cx - 2) : Math.floor(cx + 1);
  if (plan.take(px, Math.floor(cz + 2), px + 1, Math.floor(cz + 3))) {
    plan.add({ id: "crystal-pedestal", x: px + 0.5, z: Math.floor(cz + 2) + 0.5, args: { color: color === "violet" ? "teal" : "violet" } });
    plan.lights.push(glowLight(px + 0.5, 1.4, Math.floor(cz + 2) + 0.5, color === "violet" ? TEAL : VIOLET, 3.5, 4));
  }
  keeper({ id: `${spec.id}-mage`, x: Math.floor(cx), z: Math.floor(cz - 1), kind: "townsfolk", name: "Mage", behaviour: { rest: [0, 1], watch: 5 } });
};

// --- Dressing the walls ---------------------------------------------------------------------------------------------------

/** How far along the back wall each thing that hangs on it or stands against it reaches, from its anchor's x. */
function wallReach(p: PropData): [number, number] | null {
  if (p.z > 0.2 || (p.rot ?? 0) !== 0 || p.turn) return null;
  const w = typeof p.args?.w === "number" ? (p.args.w as number) : 1;
  const x = p.x;
  switch (p.id) {
    case "hearth":
      return [x - 1.5, x + 1.5];
    case "forge":
      return [x - 2, x + 2];
    case "keg-rack":
      return [x - 0.9, x + 0.9];
    case "blade-rack":
    case "guild-banner":
      return [x - 0.6, x + 0.6];
    case "wall-lamp":
    case "ladder":
      return [x - 0.35, x + 0.35];
    case "stained-window":
      return [x - w / 2 - 0.2, x + w / 2 + 0.2];
    case "tapestry":
    case "notice-board":
      return [x, x + 2];
    case "wall-map":
    case "tool-rack":
      return [x, x + 1.5];
    case "poster":
    case "shield":
      return [x, x + 0.7];
    case "bookshelf":
    case "back-window":
    case "wardrobe":
    case "bar-shelf":
    case "curio-case":
    case "bed":
      return [p.id === "bed" ? x - 0.5 : x, p.id === "bed" ? x + 0.5 : x + w];
    default:
      return null;
  }
}

/** What a kind hangs in the bare stretches of its back wall: pictures to choose from, widest first. */
const DRESSING: Readonly<Record<RoomKind, readonly ("window" | "poster" | "lamp" | "shield" | "tapestry" | "banner" | "map")[]>> = {
  house: ["window", "poster", "lamp"],
  shop: ["window", "poster", "shield"],
  inn: ["tapestry", "lamp", "poster", "shield"],
  guildhall: ["tapestry", "banner", "map"],
  temple: ["banner", "lamp"],
  smithy: ["shield", "lamp"],
  library: ["lamp"],
  tower: [],
  "exotic-wares": ["tapestry", "lamp", "poster"],
};

/** Hangs pictures, lamps and shields in the bare stretches of the back wall, so no stretch of it stands empty. */
function dress(plan: Plan, kind: RoomKind): void {
  const used: [number, number][] = [];
  for (const p of plan.props) {
    const r = wallReach(p);
    if (r) used.push(r);
  }
  const posts = plan.finish.posts;
  if (posts) for (let x = 0; x <= plan.w; x += posts.bay) used.push([x - posts.width / 2, x + posts.width / 2]);
  used.sort((a, b) => a[0] - b[0]);
  const spans: [number, number][] = [];
  let at = 0.15;
  for (const [a, b] of used) {
    if (a - at >= 0.7) spans.push([at, a]);
    at = Math.max(at, b);
  }
  if (plan.w - 0.15 - at >= 0.7) spans.push([at, plan.w - 0.15]);
  const options = DRESSING[kind];
  if (options.length === 0) return;
  let windows = plan.lights.filter((l) => l.kind === "spot").length;
  // The options in turn from a seeded start, so a wall is not all lamps.
  let next = plan.between(0, options.length - 1);
  for (const [a, b] of spans) {
    const span = b - a;
    const mid = (a + b) / 2;
    const pick = options[next++ % options.length]!;
    if (pick === "window" && span >= 1.4 && windows < 2) {
      window(plan, mid - 0.5);
      windows++;
    } else if ((pick === "tapestry" || pick === "map") && span >= 2.3) {
      if (pick === "tapestry") plan.add({ id: "tapestry", x: mid - 1, z: 0, y: 0.6, tint: tintOf(plan), seed: plan.between(1, 9) });
      else plan.add({ id: "wall-map", x: mid - 0.75, z: 0, y: 1.1 });
    } else if (pick === "banner" && span >= 1.2) plan.add({ id: "guild-banner", x: mid, z: 0, y: 2.6, tint: tintOf(plan) });
    else if (pick === "shield" && span >= 0.8) plan.add({ id: "shield", x: mid - 0.3125, z: 0, y: 1.7 });
    else if (pick === "lamp" || span < 1.2) {
      plan.add({ id: "wall-lamp", x: mid, z: 0, y: 1.6 });
      plan.lights.push({ ...candleLight(mid, 1.55, 0.9), intensity: 1.4 });
    } else plan.add({ id: "poster", x: mid - 0.3125, z: 0, y: 1.4, seed: plan.between(2, 6) });
  }
}

const LAYOUTS: Readonly<Record<RoomKind, Layout>> = { house, shop, inn, guildhall, temple, smithy, library, tower, "exotic-wares": exoticWares };

// --- The room ------------------------------------------------------------------------------------------------------------------

/** Lays out a room: the same spec always gives the same room. */
export function layoutRoom(spec: RoomSpec): InteriorData {
  const style = styleOf(spec.style);
  const random = mulberry32(fnv1a32(`room:${spec.kind}:${style}:${spec.seed}`));
  const size = spec.w !== undefined && spec.d !== undefined ? { w: spec.w, d: spec.d } : roomSize(spec.kind, spec.building, random);
  const { w, d } = size;
  const ex = spec.kind === "tower" ? w / 2 : Math.floor(w / 2) + (w % 2 === 0 && random() < 0.5 ? 0 : 0);
  const plan = new Plan(w, d, ex, finishOf(style), random);
  const keepers: NpcData[] = [];
  LAYOUTS[spec.kind](plan, spec, (base) => keepers.push({ ...base, ...(keepers.length === 0 ? spec.keeper : {}) }));
  if (spec.kind !== "tower") dress(plan, spec.kind);

  // The tiles: the floor, and the sill of the way out under the front wall (drawn, not walked).
  const tiles: TileData[] = [];
  for (let z = 0; z <= d; z++) {
    for (let x = 0; x < w; x++) {
      if (z === d) {
        tiles.push(x === ex - 1 || x === ex ? [0, plan.surface[(d - 1) * w + x]!, BLOCKED] : [0, NO_SURFACE, BLOCKED]);
        continue;
      }
      const s = plan.get(x, z);
      // A keeper's place is walked by the keeper alone: its tiles are blocked but the one they stand on.
      const keeps = s === POCKET && keepers.some((k) => k.x === x && k.z === z);
      if (s === OUTSIDE) tiles.push([0, NO_SURFACE, BLOCKED]);
      else tiles.push([0, plan.surface[z * w + x]!, s === TAKEN || (s === POCKET && !keeps) ? BLOCKED : 0]);
    }
  }
  return {
    id: spec.id,
    name: spec.name ?? `${TITLES[spec.kind]}`,
    kind: spec.kind,
    ...(spec.town ? { town: spec.town } : {}),
    style,
    w,
    d,
    area: [0, 0, w, d + 1],
    tiles,
    props: plan.props,
    npcs: [...keepers, ...plan.npcs],
    lights: plan.lights,
    entry: [ex, d - 1],
    exit: spec.exit,
    ...(Object.keys(plan.params).length > 0 ? { params: plan.params } : {}),
  };
}
