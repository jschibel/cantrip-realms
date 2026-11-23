// Where the world comes from (interfaces.md, "The world, interiors and dungeons"): world.json is in the page; each
// chunk and interior is its own lazy bundle, fetched as the player nears it; the dungeons' definitions are small and
// in the page.

import worldFile from "../../../content/dominaria/world/world.json";
import { type ChunkData, type DungeonData, type InteriorData, type WorldData, chunkKey } from "./schema";

export const WORLD = worldFile as unknown as WorldData;

const chunkFiles = import.meta.glob<ChunkData>("../../../content/dominaria/world/chunks/*.json", { import: "default" });
const interiorFiles = import.meta.glob<InteriorData>("../../../content/dominaria/interiors/*.json", { import: "default" });
const dungeonFiles = import.meta.glob<DungeonData>("../../../content/dominaria/dungeons/*.json", { eager: true, import: "default" });

const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1, -".json".length);
const chunkLoaders = new Map(Object.entries(chunkFiles).map(([path, load]) => [idOf(path), load]));
const interiorLoaders = new Map(Object.entries(interiorFiles).map(([path, load]) => [idOf(path), load]));

/** Every dungeon, by id. */
export const DUNGEONS: ReadonlyMap<string, DungeonData> = new Map(Object.values(dungeonFiles).map((d) => [d.id, d]));

const chunks = new Map<string, Promise<ChunkData | null>>();

/** A chunk's file, loaded once; null past the world's edge. */
export function loadChunk(cq: number, cr: number): Promise<ChunkData | null> {
  const k = chunkKey(cq, cr);
  let found = chunks.get(k);
  if (!found) {
    const load = chunkLoaders.get(k);
    found = load ? load() : Promise.resolve(null);
    chunks.set(k, found);
  }
  return found;
}

const interiors = new Map<string, Promise<InteriorData>>();

export const hasInterior = (id: string): boolean => interiorLoaders.has(id);

export function loadInterior(id: string): Promise<InteriorData> {
  let found = interiors.get(id);
  if (!found) {
    const load = interiorLoaders.get(id);
    if (!load) return Promise.reject(new Error(`no interior ${id}`));
    found = load();
    interiors.set(id, found);
  }
  return found;
}

/** The town a character of a color begins in. */
export function homeTown(color: string): WorldData["towns"][number] {
  return WORLD.towns.find((t) => t.home === color) ?? WORLD.towns.find((t) => t.kind === "capital")!;
}

/** A town's inn. */
export const innOf = (town: string) => WORLD.inns.find((i) => i.town === town)!;
