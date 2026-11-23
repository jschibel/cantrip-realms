// How maps join up: the world map's locations are its exits, and every other map hangs off one of them through its
// own exits (a dungeon's deeper floors through the floor above). After a lost duel the player wakes at the nearest
// town's inn (design.md, A3): the town or village whose place on the world map is nearest the map the duel was on.

import { type Hex, distance, hex } from "../hex";
import type { MapData } from "./schema";

export type Load = (id: string) => Promise<MapData>;

/** Where a map is on the world map: its own location, or the location of the map its exits lead back to. */
export async function worldLocation(mapId: string, load: Load): Promise<Hex | null> {
  const world = await load("world");
  const seen = new Set<string>();
  const queue = [mapId];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const place = world.exits.find((e) => e.to === id);
    if (place) return hex(place.q, place.r);
    const map = await load(id);
    for (const exit of map.exits) if (exit.to !== "world" && !seen.has(exit.to)) queue.push(exit.to);
  }
  return null;
}

/** The map of the town or village nearest `mapId` on the world map, whose inn a beaten player wakes at. */
export async function nearestInn(mapId: string, load: Load): Promise<string | null> {
  const here = await load(mapId);
  if (here.inn) return mapId;
  const at = await worldLocation(mapId, load);
  if (!at) return null;
  const world = await load("world");
  let best: { id: string; steps: number } | null = null;
  for (const place of world.exits) {
    const map = await load(place.to);
    if (!map.inn || (map.kind !== "town" && map.kind !== "village")) continue;
    const steps = distance(at, hex(place.q, place.r));
    if (!best || steps < best.steps || (steps === best.steps && place.to < best.id)) best = { id: place.to, steps };
  }
  return best?.id ?? null;
}
