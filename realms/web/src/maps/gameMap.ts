// A map loaded to be walked: the data of maps/schema.ts indexed by hex, with the questions the overworld asks of it -
// can I stand here, what is here, where do I arrive.

import { type Hex, distance, hex, key, neighbors } from "../hex";
import type { ChestData, ExitData, MapData, MapKind, NpcData, PropKind, Region, SpawnData, Terrain } from "./schema";

export interface Tile {
  readonly hex: Hex;
  /** The top of the hex above the ground plane, in world units. */
  readonly height: number;
  readonly terrain: Terrain;
  /** Whether nobody may stand here: water, a tree, a wall, a table, a chest. */
  readonly blocked: boolean;
  /** Scenery standing on the hex. */
  readonly prop?: PropKind;
}

/** What a click on a hex can mean besides walking there. */
export type Thing =
  | { readonly kind: "npc"; readonly npc: NpcData }
  | { readonly kind: "chest"; readonly chest: ChestData }
  | { readonly kind: "exit"; readonly exit: ExitData };

export class GameMap {
  private readonly tiles = new Map<string, Tile>();
  private readonly things = new Map<string, Thing>();

  constructor(readonly data: MapData) {
    const props = new Map(data.props.map((p) => [key(p), p.kind as PropKind]));
    for (const [q, r, height, terrain, blocked] of data.tiles) {
      const h = hex(q, r);
      this.tiles.set(key(h), { hex: h, height, terrain: terrain as Terrain, blocked: blocked === 1, prop: props.get(key(h)) });
    }
    for (const exit of data.exits) this.things.set(key(exit), { kind: "exit", exit });
    for (const chest of data.chests) this.things.set(key(chest), { kind: "chest", chest });
    for (const npc of data.npcs) this.things.set(key(npc), { kind: "npc", npc });
  }

  get id(): string {
    return this.data.id;
  }

  get name(): string {
    return this.data.name;
  }

  get kind(): MapKind {
    return this.data.kind;
  }

  get region(): Region | undefined {
    return this.data.region;
  }

  get spawns(): readonly SpawnData[] {
    return this.data.spawns;
  }

  get all(): IterableIterator<Tile> {
    return this.tiles.values();
  }

  get size(): number {
    return this.tiles.size;
  }

  tile(h: Hex): Tile | undefined {
    return this.tiles.get(key(h));
  }

  /** Whether a hex can be stood on. */
  passable = (h: Hex): boolean => {
    const tile = this.tiles.get(key(h));
    return tile !== undefined && !tile.blocked;
  };

  heightAt(h: Hex): number {
    return this.tiles.get(key(h))?.height ?? 0;
  }

  thing(h: Hex): Thing | undefined {
    return this.things.get(key(h));
  }

  /** An open hex beside `h`, the one nearest `toward`; `h` itself when it is open and nothing better is asked. */
  besides(h: Hex, toward: Hex = hex(0, 0)): Hex | null {
    const free = neighbors(h).filter(this.passable);
    free.sort((a, b) => distance(a, toward) - distance(b, toward) || a.q - b.q || a.r - b.r);
    return free[0] ?? (this.passable(h) ? h : null);
  }

  /**
   * Where a player coming from map `from` (or "world") appears: just inside the exit that leads back there, else at
   * the inn, else inside the first exit.
   */
  arrival(from: string): Hex {
    const back = this.data.exits.find((e) => e.to === from);
    if (back) return this.besides(hex(back.q, back.r)) ?? hex(back.q, back.r);
    return this.respawn();
  }

  /**
   * Where a player starts out on this map with nowhere else to be: its own inn (a town's or village's), or inside the
   * first exit. A beaten player wakes at the inn the map names, which may be another map's (`data.inn.map`).
   */
  respawn(): Hex {
    if (this.data.inn && this.data.inn.map === undefined) return hex(this.data.inn.q, this.data.inn.r);
    const first = this.data.exits[0];
    if (first) return this.besides(hex(first.q, first.r)) ?? hex(first.q, first.r);
    return [...this.tiles.values()].find((t) => !t.blocked)?.hex ?? hex(0, 0);
  }
}
