// The ground of a dungeon floor being carved, on squares: every tile starts solid, a theme's carver opens rooms and
// ways between them, pools of water and lava, chasms and the void; then the run's contract (finish.ts) places what the
// run holds on it, and the theme dresses it. Walking is eight-way, never cutting a corner past a tile one cannot stand
// on - as world/grid.ts walks - so everything here that asks "can one get there" asks it that way.

import type { LightData, PropData } from "../world/format";
import { fnv1a32, mulberry32 } from "../random";

/** What a tile is made of. */
export const WALL = 0;
export const FLOOR = 1;
export const WATER = 2;
export const LAVA = 3;
/** Nothing at all: a chasm, the void round the portal's islands, the sky past the battlements. */
export const VOID = 4;
export type Cell = typeof WALL | typeof FLOOR | typeof WATER | typeof LAVA | typeof VOID;

export const CELL_CHARS = ["#", ".", "~", "=", " "] as const;

/** A room the carver made: its middle tile and about how far it reaches. The first is the arrival's. */
export interface Room {
  readonly x: number;
  readonly z: number;
  readonly size: number;
  /** What kind of room, for the theme's dressing (an ossuary, a library, a glade...). */
  readonly kind?: string;
}

/** The eight steps, orthogonal first. */
export const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** The eight neighbours in order round the tile (clockwise from north-west), for counting runs. */
const RING: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

/** A light the theme offers, and how much it matters (the brightest where the player goes are kept). */
export interface LightOffer {
  readonly light: LightData;
  readonly weight: number;
}

export class Plan {
  readonly cells: Uint8Array;
  readonly surface: string[];
  /** Tiles one cannot walk onto though their ground is floor: a prop stands there. */
  readonly blocked: Uint8Array;
  /** The stairs and the way out: walked onto only to be taken. */
  readonly stops = new Set<number>();
  readonly props: PropData[] = [];
  readonly lights: LightOffer[] = [];
  readonly random: () => number;

  constructor(
    readonly w: number,
    readonly d: number,
    seed: string,
    readonly floorSurface: string,
  ) {
    this.cells = new Uint8Array(w * d);
    this.blocked = new Uint8Array(w * d);
    this.surface = new Array<string>(w * d).fill("");
    this.random = mulberry32(fnv1a32(seed));
  }

  /** A whole number from lo to hi, both included. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.random() * list.length)]!;
  }

  inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.w && z < this.d;
  }

  /** Inside and off the outermost ring: every floor is walled in. */
  inner(x: number, z: number): boolean {
    return x >= 1 && z >= 1 && x < this.w - 1 && z < this.d - 1;
  }

  index(x: number, z: number): number {
    return z * this.w + x;
  }

  cell(x: number, z: number): Cell {
    return this.inside(x, z) ? (this.cells[this.index(x, z)] as Cell) : WALL;
  }

  /** Whether one can stand on a tile: floor, nothing standing on it. */
  walkable(x: number, z: number): boolean {
    if (!this.inside(x, z)) return false;
    const i = this.index(x, z);
    return this.cells[i] === FLOOR && this.blocked[i] === 0;
  }

  /** Whether one walks across a tile: walkable and not a stop. */
  passable(x: number, z: number): boolean {
    return this.walkable(x, z) && !this.stops.has(this.index(x, z));
  }

  // --- Carving -----------------------------------------------------------------------------------------------------

  /** Opens a tile as floor (never the outermost ring). */
  carve(x: number, z: number, surface = this.floorSurface): void {
    if (!this.inner(x, z)) return;
    const i = this.index(x, z);
    this.cells[i] = FLOOR;
    this.surface[i] = surface;
    this.blocked[i] = 0;
  }

  /** Sets a tile to wall, water, lava or the void. */
  fill(x: number, z: number, cell: Cell = WALL, surface = ""): void {
    if (!this.inside(x, z)) return;
    const i = this.index(x, z);
    this.cells[i] = cell;
    this.surface[i] = cell === FLOOR ? surface || this.floorSurface : surface;
    this.blocked[i] = 0;
  }

  /** Opens the tiles from (x0, z0) to (x1, z1), both included. */
  rect(x0: number, z0: number, x1: number, z1: number, surface?: string): void {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.carve(x, z, surface);
  }

  /** Opens a disc of tiles round (cx, cz). */
  disc(cx: number, cz: number, r: number, surface?: string): void {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r + 0.5) this.carve(x, z, surface);
  }

  /**
   * A way between two tiles, `width` tiles wide (1 or more), straight in an L (x first or z first, as the dice say),
   * or wandering when `wander` is given.
   */
  corridor(ax: number, az: number, bx: number, bz: number, width = 1, surface?: string, wander = 0): void {
    const lay = (x: number, z: number) => {
      const h = Math.floor((width - 1) / 2);
      for (let dz = -h; dz < width - h; dz++) for (let dx = -h; dx < width - h; dx++) this.carve(x + dx, z + dz, surface);
    };
    let x = ax;
    let z = az;
    const xFirst = this.random() < 0.5;
    for (let guard = 0; guard < 600 && (x !== bx || z !== bz); guard++) {
      lay(x, z);
      const dx = Math.sign(bx - x);
      const dz = Math.sign(bz - z);
      if (wander > 0 && this.random() < wander) {
        // A step aside, never away from where it is going.
        if (this.random() < 0.5 && dz !== 0) x += this.random() < 0.5 ? 1 : -1;
        else if (dx !== 0) z += this.random() < 0.5 ? 1 : -1;
        else x += dx;
        x = Math.max(1, Math.min(this.w - 2, x));
        z = Math.max(1, Math.min(this.d - 2, z));
        continue;
      }
      if (dx !== 0 && (xFirst || dz === 0)) x += dx;
      else z += dz;
    }
    lay(bx, bz);
  }

  /** Every tile of a kind, in a fixed order (row by row). */
  tilesOf(cell: Cell): [number, number][] {
    const out: [number, number][] = [];
    for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) if (this.cells[this.index(x, z)] === cell) out.push([x, z]);
    return out;
  }

  /** The walkable tiles, row by row. */
  walkables(): [number, number][] {
    const out: [number, number][] = [];
    for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) if (this.walkable(x, z)) out.push([x, z]);
    return out;
  }

  // --- Walking -----------------------------------------------------------------------------------------------------

  /** Whether a step from (x, z) by (dx, dz) may be taken on tiles `can` says one may cross: no corner is cut. */
  static step(can: (x: number, z: number) => boolean, x: number, z: number, dx: number, dz: number): boolean {
    if (!can(x + dx, z + dz)) return false;
    if (dx !== 0 && dz !== 0) return can(x + dx, z) && can(x, z + dz);
    return true;
  }

  /**
   * Walking steps from a tile to every tile reached, crossing only passable tiles; a stop is reached (it is walked onto
   * to be taken) but never crossed.
   */
  steps(fromX: number, fromZ: number): Map<number, number> {
    const seen = new Map<number, number>([[this.index(fromX, fromZ), 0]]);
    const queue: number[] = [this.index(fromX, fromZ)];
    const cross = (x: number, z: number) => this.passable(x, z);
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!;
      const x = i % this.w;
      const z = (i - x) / this.w;
      if (q > 0 && this.stops.has(i)) continue;
      const d = seen.get(i)!;
      for (const [dx, dz] of STEPS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.walkable(nx, nz)) continue;
        const ni = this.index(nx, nz);
        if (seen.has(ni)) continue;
        // The stop itself may be stepped onto; the corners past must still be crossable.
        if (dx !== 0 && dz !== 0 && !(cross(nx, z) && cross(x, nz))) continue;
        seen.set(ni, d + 1);
        queue.push(ni);
      }
    }
    return seen;
  }

  /** The shortest walk between two tiles, both included, crossing no stop (the last tile may be one). */
  path(fromX: number, fromZ: number, toX: number, toZ: number): [number, number][] {
    const start = this.index(fromX, fromZ);
    const goal = this.index(toX, toZ);
    const came = new Map<number, number>([[start, -1]]);
    const queue = [start];
    for (let q = 0; q < queue.length && !came.has(goal); q++) {
      const i = queue[q]!;
      const x = i % this.w;
      const z = (i - x) / this.w;
      if (q > 0 && this.stops.has(i)) continue;
      for (const [dx, dz] of STEPS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.walkable(nx, nz)) continue;
        const ni = this.index(nx, nz);
        if (came.has(ni)) continue;
        if (dx !== 0 && dz !== 0 && !(this.passable(nx, z) && this.passable(x, nz))) continue;
        came.set(ni, i);
        queue.push(ni);
      }
    }
    if (!came.has(goal)) return [];
    const out: [number, number][] = [];
    for (let i = goal; i !== -1; i = came.get(i)!) out.push([i % this.w, Math.floor(i / this.w)]);
    return out.reverse();
  }

  /**
   * Whether a walkable tile can be made one nobody crosses (a prop on it, or a stop) and every way past it stays open:
   * the passable tiles round it make one unbroken run, stepping round the ring orthogonally - so whatever went through
   * it, or cut a corner by it, goes round it instead. A tile next to a stop is never taken, so a stop keeps its ways.
   */
  safe(x: number, z: number): boolean {
    if (!this.passable(x, z)) return false;
    for (const [dx, dz] of STEPS) if (this.stops.has(this.index(x + dx, z + dz)) && this.inside(x + dx, z + dz)) return false;
    const on = RING.map(([dx, dz]) => this.passable(x + dx, z + dz));
    // A corner of the ring joins the run only through its edge neighbours (a diagonal past the tile is no way round).
    let runs = 0;
    let any = false;
    for (let k = 0; k < 8; k++) {
      if (!on[k]) continue;
      any = true;
      if (!on[(k + 7) % 8]) runs++;
    }
    if (!any) return false;
    // A lone corner with its two edges closed is cut off from the rest unless it is all there is.
    return runs <= 1;
  }

  /** Puts a prop that blocks its tile, only where that cuts no way off. False where it may not stand. */
  block(x: number, z: number, prop: PropData | null): boolean {
    if (!this.safe(x, z)) return false;
    this.blocked[this.index(x, z)] = 1;
    if (prop) this.props.push(prop);
    return true;
  }

  /** Puts a prop that blocks nothing (a torch on the wall, bones on the floor). */
  put(prop: PropData): void {
    this.props.push(prop);
  }

  light(light: LightData, weight: number): void {
    this.lights.push({ light, weight });
  }

  /** The plan's rows as characters (`CELL_CHARS`). */
  rows(): string[] {
    const out: string[] = [];
    for (let z = 0; z < this.d; z++) {
      let row = "";
      for (let x = 0; x < this.w; x++) row += CELL_CHARS[this.cells[this.index(x, z)]!];
      out.push(row);
    }
    return out;
  }
}

// --- Walls: which way a wall faces the open ground, so the walls and the dressing agree --------------------------------

/** Not wall: what a wall faces (floor, water, lava, the void). */
export const open = (cells: (x: number, z: number) => Cell, x: number, z: number): boolean => cells(x, z) !== WALL;

/**
 * How a wall tile is drawn: `none` (no open ground round it: not drawn), `near` (open ground north of it - it stands
 * between the camera and the floor, so it is drawn low), `east` (open ground only to its west: the east side of a
 * space, cut down while the camera is swung east), `west` (likewise), `back` (open ground only south of it: a wall
 * seen face on, full height: open ground straight south of it, none beside it, the floor running on diagonally south
 * of it as along any back wall). A wall with open ground both east and west is drawn low.
 */
export type WallKind = "none" | "near" | "east" | "west" | "back";

export function wallKind(cells: (x: number, z: number) => Cell, x: number, z: number): WallKind {
  if (cells(x, z) !== WALL) return "none";
  const o = (dx: number, dz: number) => open(cells, x + dx, z + dz);
  if (o(-1, -1) || o(0, -1) || o(1, -1)) return "near";
  // Open ground straight south makes a wall of a space's back, whatever lies diagonally south of it (the same space's
  // floor running on along the wall): only open ground beside it makes it a side. A wall with open ground only
  // diagonally south of it is a corner, the side of the space beside it.
  const south = o(0, 1);
  const west = o(-1, 0) || (!south && o(-1, 1));
  const east = o(1, 0) || (!south && o(1, 1));
  if (west && east) return "near";
  if (west) return "east";
  if (east) return "west";
  if (south) return "back";
  return "none";
}
