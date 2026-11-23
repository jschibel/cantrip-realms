// How maps join up: the world map's locations are its exits, and every other map hangs off one of them through its
// own exits (a dungeon's deeper floors through the floor above); a travel encounter's map is where its zone is. After
// a lost duel the player wakes at the nearest town's inn (design.md, A3): the town or village whose place on the world
// map is nearest the map the duel was on. The map generator (scripts/maps.ts) works that out once and writes it into
// each map's `inn`; nothing works it out in play.

import { type Hex, distance, hex } from "../hex";
import type { InnData, MapData } from "./schema";

export type Load = (id: string) => Promise<MapData>;

/**
 * Where a map is on the world map: its own location, the location of the map its exits lead back to, or - for a
 * travel encounter's map - the middle of the first encounter zone fought on it.
 */
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
  const zone = world.encounters?.find((z) => z.map === mapId);
  return zone ? hex(zone.q, zone.r) : null;
}

/** Whether a map is a town or village with an inn of its own. */
const hasOwnInn = (map: MapData) => (map.kind === "town" || map.kind === "village") && map.inn !== undefined && map.inn.map === undefined;

/** The map of the town or village nearest `mapId` on the world map, whose inn a beaten player wakes at. */
export async function nearestInn(mapId: string, load: Load): Promise<string | null> {
  const here = await load(mapId);
  if (hasOwnInn(here)) return mapId;
  const at = await worldLocation(mapId, load);
  if (!at) return null;
  const world = await load("world");
  let best: { id: string; steps: number } | null = null;
  for (const place of world.exits) {
    const map = await load(place.to);
    if (!hasOwnInn(map)) continue;
    const steps = distance(at, hex(place.q, place.r));
    if (!best || steps < best.steps || (steps === best.steps && place.to < best.id)) best = { id: place.to, steps };
  }
  return best?.id ?? null;
}

/**
 * The inn a map names (interfaces.md, "Maps"): a town's or village's own hex, any other map's its nearest town's or
 * village's, `{map, q, r}`. Null for the world map, or a map no town can be found from.
 */
export async function innOf(mapId: string, load: Load): Promise<InnData | null> {
  const here = await load(mapId);
  if (here.kind === "world") return null;
  if (hasOwnInn(here)) return { q: here.inn!.q, r: here.inn!.r };
  const town = await nearestInn(mapId, load);
  if (!town) return null;
  const inn = (await load(town)).inn!;
  return { map: town, q: inn.q, r: inn.r };
}
