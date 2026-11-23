// Dominaria as the game reads it (interfaces.md, "The world, interiors and dungeons"; the version-2 format of
// realms/docs/interfaces.md): world.json and the dungeons' definitions are small and in the page; each chunk and
// interior is its own lazy bundle, read as the player nears it (`DOMINARIA`, a WorldSource). Also the vendors and the
// planes' names, and the few rules of place the in-memory API (net/mockApi.ts) keeps as the server does.

import planesFile from "../../../content/planes.json";
import worldFile from "../../../content/dominaria/world/world.json";
import { CHUNK, type ChunkData, type DungeonData, type TownData, type WorldData, chunkKey, chunkTile, isBlocked } from "./format";
import { type WorldSource, globSource } from "./load";

/** Dominaria's world.json. */
export const WORLD = worldFile as unknown as WorldData;

/** Dominaria's files: world.json, the chunks and the interiors, each chunk and room loaded when first asked for. */
export const DOMINARIA: WorldSource = globSource(
  async () => WORLD,
  import.meta.glob("../../../content/dominaria/world/chunks/*.json", { import: "default" }),
  import.meta.glob("../../../content/dominaria/interiors/*.json", { import: "default" }),
);

const dungeonFiles = import.meta.glob<DungeonData>("../../../content/dominaria/dungeons/*.json", { eager: true, import: "default" });

/** Every dungeon, by id. */
export const DUNGEONS: ReadonlyMap<string, DungeonData> = new Map(Object.values(dungeonFiles).map((d) => [d.id, d]));

/** A vendor file (interfaces.md, "Vendors"): a shop's in its town, or a traveling trader's round. */
export interface VendorFile {
  readonly id: string;
  readonly name: string;
  readonly town?: string;
  readonly exotic?: boolean;
  readonly trader?: { readonly plane: string; readonly towns: readonly string[]; readonly hour: number; readonly hours: number };
}

const vendorFiles = import.meta.glob<VendorFile>("../../../content/dominaria/vendors/*.json", { eager: true, import: "default" });

/** Every vendor of the plane, by id: what the MockApi deals from, and the traders' schedule. */
export const VENDORS: ReadonlyMap<string, VendorFile> = new Map(Object.values(vendorFiles).map((v) => [v.id, v]));

/** The planes' names (planes.json), by id. */
export const PLANE_NAMES: ReadonlyMap<string, string> = new Map(Object.entries(planesFile.planes).map(([id, p]) => [id, p.name]));

/** A town's inn. */
export const innOf = (town: string): WorldData["inns"][number] => WORLD.inns.find((i) => i.town === town)!;

/** Where a new character begins, and a beaten one with no inn of their own wakes: the capital, else a starting town. */
export function startTown(): TownData {
  return WORLD.towns.find((t) => t.kind === "capital") ?? WORLD.towns.find((t) => t.start)!;
}

/**
 * The eight steps to a neighbour as the server orders them (Tile.Steps): south, east, west, north, then the diagonals
 * south-east, south-west, north-east, north-west.
 */
export const STEPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Where leaving a dungeon, or a waystone's travel to its tower, puts a character (interfaces.md, the dungeon and waystone
 * calls; the server's `Dungeons.Outside`): the first tile a step from the entrance, in STEPS' order, that the step can
 * be walked to (open, no corner cut) and that is no door or entrance itself; else the entrance.
 */
export async function besideEntrance(entrance: readonly [number, number], source: WorldSource = DOMINARIA): Promise<[number, number]> {
  const chunks = new Map<string, ChunkData | null>();
  const chunkAt = async (x: number, z: number) => {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const key = chunkKey(cx, cz);
    if (!chunks.has(key)) chunks.set(key, ((await source.chunk(cx, cz)) as ChunkData | null) ?? null);
    return chunks.get(key)!;
  };
  const open = async (x: number, z: number) => {
    const c = await chunkAt(x, z);
    return !!c && !isBlocked(chunkTile(c, x, z));
  };
  const used = async (x: number, z: number) => {
    const c = await chunkAt(x, z);
    return !!c && (c.entrances.some((e) => e.x === x && e.z === z) || c.buildings.some((b) => b.interior && b.door?.[0] === x && b.door?.[1] === z));
  };
  const [ex, ez] = entrance;
  for (const [dx, dz] of STEPS) {
    const x = ex + dx;
    const z = ez + dz;
    if (!(await open(x, z)) || (await used(x, z))) continue;
    if (dx && dz && !((await open(ex + dx, ez)) && (await open(ex, ez + dz)))) continue;
    return [x, z];
  }
  return [ex, ez];
}

/** Chebyshev distance between tiles: the eight round a tile are all 1 from it. */
export const tilesApart = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

/** Where a mage tower's waystone stands in the world: the tiles of its `waystone` NPCs near the tower's entrance. */
export async function waystoneTiles(tower: DungeonData, source: WorldSource = DOMINARIA): Promise<[number, number][]> {
  const [ex, ez] = tower.entrance;
  const keys = new Set<string>();
  const out: [number, number][] = [];
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as const) {
    const cx = Math.floor((ex + dx) / CHUNK);
    const cz = Math.floor((ez + dz) / CHUNK);
    const key = chunkKey(cx, cz);
    if (keys.has(key)) continue;
    keys.add(key);
    const c = (await source.chunk(cx, cz)) as ChunkData | null;
    for (const n of c?.npcs ?? []) if (n.kind === "waystone" && n.tower === tower.id) out.push([n.x, n.z]);
  }
  return out;
}
