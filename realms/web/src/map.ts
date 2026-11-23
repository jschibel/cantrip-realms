import { type Hex, distance, hex, key, spiral } from "./hex";

// A local map (design.md, A6): hexes with a height and a terrain, some of them blocked. Maps will be data
// (realms/content/<plane>/maps/*.json, tech.md B5); until the map editor exists, the spike's meadow is generated here
// from a seed, so it is the same on every load.

export type Terrain = "grass" | "dirt" | "stone" | "water" | "sand";

export interface Tile {
  readonly hex: Hex;
  /** The top of the hex above the ground plane, in world units. */
  readonly height: number;
  readonly terrain: Terrain;
  /** Whether nobody may stand here: water, a tree, a wall, a table. */
  readonly blocked: boolean;
  /** What stands on the hex, drawn by the world: a tree, a rock, the spell table. */
  readonly prop?: "tree" | "rock" | "spell-table";
}

export class GameMap {
  private readonly tiles = new Map<string, Tile>();

  constructor(
    readonly name: string,
    tiles: Iterable<Tile>,
    readonly start: Hex,
  ) {
    for (const tile of tiles) {
      this.tiles.set(key(tile.hex), tile);
    }
  }

  get all(): IterableIterator<Tile> {
    return this.tiles.values();
  }

  tile(h: Hex): Tile | undefined {
    return this.tiles.get(key(h));
  }

  passable = (h: Hex): boolean => {
    const tile = this.tiles.get(key(h));
    return tile !== undefined && !tile.blocked;
  };

  heightAt(h: Hex): number {
    return this.tiles.get(key(h))?.height ?? 0;
  }
}

/** A small, seeded random source: the same seed gives the same numbers on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP = 0.25;

/** The spike's map: a Benalish meadow with a road, a pond, an outcrop, trees and a spell table. */
export function meadow(seed = 7): GameMap {
  const random = mulberry32(seed);
  const radius = 16;
  const pond = hex(5, -7);
  const outcrop = hex(-8, -2);
  const table = hex(-3, 3);
  const start = hex(0, 0);

  // The road runs straight across the map along one of the hex axes (q + r is the same all along it), two hexes wide.
  const onRoad = (h: Hex) => h.q + h.r === 0 || h.q + h.r === 1;

  const tiles: Tile[] = [];
  for (const h of spiral(hex(0, 0), radius)) {
    const roll = random();
    const wave = Math.sin(h.q * 0.45) + Math.cos(h.r * 0.38 + h.q * 0.2) + roll * 0.6;
    let height = Math.max(0, Math.round(wave + 1)) * STEP;
    let terrain: Terrain = "grass";
    let blocked = false;
    let prop: Tile["prop"];

    if (distance(h, pond) <= 2) {
      terrain = "water";
      height = -0.1;
      blocked = true;
    } else if (distance(h, pond) === 3) {
      terrain = "sand";
      height = 0;
    } else if (onRoad(h)) {
      terrain = "dirt";
      height = STEP;
    } else if (distance(h, outcrop) <= 2) {
      terrain = "stone";
      height += STEP * (3 - distance(h, outcrop));
      if (distance(h, outcrop) <= 1 && roll < 0.5) {
        prop = "rock";
        blocked = true;
      }
    } else if (distance(h, start) > 3 && distance(h, table) > 2 && roll < 0.1) {
      prop = "tree";
      blocked = true;
    }

    if (h.q === table.q && h.r === table.r) {
      terrain = "stone";
      height = STEP;
      prop = "spell-table";
      blocked = true;
    }
    if (distance(h, start) <= 1) {
      blocked = false;
      prop = undefined;
    }
    tiles.push({ hex: h, height, terrain, blocked, prop });
  }
  return new GameMap("Benalish Meadow", tiles, start);
}
