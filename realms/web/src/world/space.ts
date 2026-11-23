// The ground a character walks: the streamed world, an interior, or a dungeon floor - each a Space that answers what
// the overworld asks of the ground under it (can I stand here, how high is it, what is here). The world keeps only the
// chunks near the player; a hex of a chunk not loaded is no ground at all, so nothing walks off into one.

import { type Hex, hex, key } from "../hex";
import {
  CHUNK,
  type ChestData,
  type ChunkData,
  type DoorData,
  type EntranceData,
  type NpcData,
  type PropData,
  type SpawnData,
  type Terrain,
  type TileData,
  chunkKey,
  chunkOf,
} from "./schema";

export interface Tile {
  readonly hex: Hex;
  /** The top of the hex above the ground plane, in world units. */
  readonly height: number;
  readonly terrain: Terrain;
  /** Whether nobody may stand here: water, a tree, a wall, a table, a chest. */
  readonly blocked: boolean;
}

/** What a click on a hex can mean besides walking there. */
export type Thing =
  | { readonly kind: "npc"; readonly npc: NpcData }
  | { readonly kind: "chest"; readonly chest: ChestData }
  | { readonly kind: "door"; readonly door: DoorData }
  | { readonly kind: "entrance"; readonly entrance: EntranceData }
  | { readonly kind: "marker"; readonly prop: PropData }
  /** An interior's door out, or a dungeon's way up and out. */
  | { readonly kind: "leave" }
  | { readonly kind: "stairs-down" };

export type SpaceKind = "world" | "interior" | "dungeon";

export interface Space {
  /** What the server calls it (interfaces.md, "Places"): "world", an interior's id, "run:<run>". */
  readonly id: string;
  readonly kind: SpaceKind;
  readonly name: string;
  tile(h: Hex): Tile | undefined;
  heightAt(h: Hex): number;
  thing(h: Hex): Thing | undefined;
  /** Whether a hex can be stood on. */
  passable(h: Hex): boolean;
}

/** Things a walk may pass through only to stop on: stepping onto one is using it. */
export const STOPS: ReadonlySet<Thing["kind"]> = new Set(["door", "entrance", "leave", "stairs-down"]);

/** A chunk of the world, indexed for questions. */
export class LoadedChunk {
  readonly q0: number;
  readonly r0: number;
  readonly heights = new Float32Array(CHUNK * CHUNK);
  readonly terrains: Terrain[] = new Array<Terrain>(CHUNK * CHUNK);
  readonly blocked = new Uint8Array(CHUNK * CHUNK);
  readonly things = new Map<string, Thing>();

  constructor(readonly data: ChunkData) {
    this.q0 = data.cq * CHUNK;
    this.r0 = data.cr * CHUNK;
    for (const [q, r, h, t, b] of data.tiles) {
      const i = (q - this.q0) * CHUNK + (r - this.r0);
      this.heights[i] = h;
      this.terrains[i] = t as Terrain;
      this.blocked[i] = b;
    }
    for (const prop of data.props) if (prop.kind === "waymarker") this.things.set(key(prop), { kind: "marker", prop });
    for (const chest of data.chests) this.things.set(key(chest), { kind: "chest", chest });
    for (const npc of data.npcs) this.things.set(key(npc), { kind: "npc", npc });
    for (const door of data.doors) this.things.set(key(door), { kind: "door", door });
    for (const entrance of data.entrances) this.things.set(key(entrance), { kind: "entrance", entrance });
  }

  get key(): string {
    return chunkKey(this.data.cq, this.data.cr);
  }

  index(h: Hex): number {
    return (h.q - this.q0) * CHUNK + (h.r - this.r0);
  }
}

export class WorldSpace implements Space {
  readonly id = "world";
  readonly kind = "world" as const;
  readonly name = "Dominaria";
  readonly chunks = new Map<string, LoadedChunk>();

  chunkAt(h: Hex): LoadedChunk | undefined {
    const { cq, cr } = chunkOf(h);
    return this.chunks.get(chunkKey(cq, cr));
  }

  add(data: ChunkData): LoadedChunk {
    const chunk = new LoadedChunk(data);
    this.chunks.set(chunk.key, chunk);
    return chunk;
  }

  drop(k: string): void {
    this.chunks.delete(k);
  }

  tile(h: Hex): Tile | undefined {
    const c = this.chunkAt(h);
    if (!c) return undefined;
    const i = c.index(h);
    return { hex: h, height: c.heights[i]!, terrain: c.terrains[i]!, blocked: c.blocked[i] === 1 };
  }

  heightAt(h: Hex): number {
    const c = this.chunkAt(h);
    return c ? c.heights[c.index(h)]! : 0;
  }

  thing(h: Hex): Thing | undefined {
    return this.chunkAt(h)?.things.get(key(h));
  }

  passable = (h: Hex): boolean => {
    const c = this.chunkAt(h);
    return c !== undefined && c.blocked[c.index(h)] === 0;
  };

  /** The spawn points of the loaded chunks. */
  spawns(): SpawnData[] {
    return [...this.chunks.values()].flatMap((c) => c.data.spawns);
  }
}

/** A small scene of its own: an interior, or a dungeon floor. */
export class RoomSpace implements Space {
  private readonly tiles = new Map<string, Tile>();
  private readonly things = new Map<string, Thing>();

  constructor(
    readonly id: string,
    readonly kind: "interior" | "dungeon",
    readonly name: string,
    tiles: readonly TileData[],
    readonly props: readonly PropData[],
    readonly npcs: readonly NpcData[],
    exits: { readonly leave: readonly Hex[]; readonly down?: Hex | null },
  ) {
    for (const [q, r, height, terrain, blocked] of tiles) this.tiles.set(`${q},${r}`, { hex: hex(q, r), height, terrain: terrain as Terrain, blocked: blocked === 1 });
    for (const npc of npcs) this.things.set(key(npc), { kind: "npc", npc });
    for (const h of exits.leave) this.things.set(key(h), { kind: "leave" });
    if (exits.down) this.things.set(key(exits.down), { kind: "stairs-down" });
  }

  get all(): IterableIterator<Tile> {
    return this.tiles.values();
  }

  /** Puts a way out on a hex (a dungeon's, once its boss is beaten). */
  addLeave(h: Hex): void {
    this.things.set(key(h), { kind: "leave" });
  }

  tile(h: Hex): Tile | undefined {
    return this.tiles.get(key(h));
  }

  heightAt(h: Hex): number {
    return this.tiles.get(key(h))?.height ?? 0;
  }

  thing(h: Hex): Thing | undefined {
    return this.things.get(key(h));
  }

  passable = (h: Hex): boolean => {
    const tile = this.tiles.get(key(h));
    return tile !== undefined && !tile.blocked;
  };
}
