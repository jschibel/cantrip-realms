// Where maps come from: the plane's map files, bundled by Vite as lazy chunks so the page loads only the maps it
// enters. The map editor's own unsaved maps are put in front of them (`provide`).

import { GameMap } from "./gameMap";
import type { MapData } from "./schema";

const files = import.meta.glob<MapData>("../../../content/dominaria/maps/*.json", { import: "default" });

const byId = new Map<string, () => Promise<MapData>>();
for (const [path, load] of Object.entries(files)) {
  const id = path.slice(path.lastIndexOf("/") + 1, -".json".length);
  byId.set(id, load);
}

const loaded = new Map<string, Promise<GameMap>>();

/** Every map id there is. */
export const mapIds = (): string[] => [...byId.keys()].sort();

export const hasMap = (id: string): boolean => byId.has(id);

/** A map by id, loaded once. */
export function loadMap(id: string): Promise<GameMap> {
  let map = loaded.get(id);
  if (!map) {
    const load = byId.get(id);
    if (!load) return Promise.reject(new Error(`no map ${id}`));
    map = load().then((data) => new GameMap(data));
    loaded.set(id, map);
  }
  return map;
}

/** Puts a map in place of the file's (the editor's working copy). */
export function provide(data: MapData): void {
  byId.set(data.id, () => Promise.resolve(data));
  loaded.delete(data.id);
}
