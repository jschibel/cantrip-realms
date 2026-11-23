import { ROOMS } from "../art/rooms";
import { CHUNK, type ChunkData, type InteriorData, type Rect, type TileData, type WorldData, type XYZ, chunkKey, chunkTile, interiorArea, interiorTile, viewBounds, worldRect } from "../world/format";
import { type DoorSpot, buildChunk, groundOf, lookOf, propOf, underOf } from "./chunks";
import { buildGround } from "./ground";
import { Place } from "./place";

// From the world data to what the renderer draws: the one place where world ids meet the art registries. A world's
// chunks, or an interior, become a `Place` - its ground from the tiles' surfaces and heights, every building, room and
// prop from its recipe, its lights, and (out of doors) its sun and standing grass - and the doors in it, for the page to
// walk through.
//
// `assembleWorld` builds every chunk it is given at once, each its own section (render/chunks.ts `buildChunk`); the
// game streams them instead (`ChunkStreamer`), with the same steps. `openAir` is the empty world place either starts
// from: its sky, its sun and its pool of lights.

/** The open air's backdrop, where no ground is drawn. */
export const OUTDOOR_BACKGROUND = "#1a2a22";
/** The dark round a room. */
export const INDOOR_BACKGROUND = "#000000";

export type { DoorSpot };

export interface AssembledWorld {
  readonly place: Place;
  readonly doors: readonly DoorSpot[];
  /** The rectangle the camera keeps its view within. */
  readonly bounds: Rect;
}

export interface AssembledRoom {
  readonly place: Place;
  /** Where its way out is: the iris closes on it going out. */
  readonly doorway: XYZ;
  readonly bounds: Rect;
}

/**
 * The world's chunks as one place: the ground over them all (texels counted from the world's origin), each chunk's
 * buildings and props (in chunk order, row by row), the water under the streams, the sun and the standing grass.
 */
export function assembleWorld(world: WorldData, chunks: readonly ChunkData[]): AssembledWorld {
  const ordered = [...chunks].sort((a, b) => a.cz - b.cz || a.cx - b.cx);
  const rect = worldRect(world);
  const place = openAir(world, (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2, Math.ceil(Math.max(world.size[0], world.size[1]) / 2) + 4, 4096);
  const byKey = new Map(ordered.map((c) => [chunkKey(c.cx, c.cz), c]));
  const tileAt = (x: number, z: number): TileData | null => {
    const c = byKey.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return c ? chunkTile(c, x, z) : null;
  };
  const doors: DoorSpot[] = [];
  for (const c of ordered) {
    const steps = buildChunk(world, c, tileAt, place.section(chunkKey(c.cx, c.cz)), place, doors);
    while (!steps.next().done);
  }
  return { place, doors, bounds: viewBounds(world) };
}

/**
 * The open air before any chunk is in it: its sky and sun - the sun's shadows `reach` each way from (x, z), on a shadow
 * map `mapSize` square - and a pool of eight lights for the chunks' fires and lamps.
 */
export function openAir(world: WorldData, x: number, z: number, reach: number, mapSize = 2048): Place {
  void world;
  const place = new Place(OUTDOOR_BACKGROUND);
  place.addSun(x, z, reach, mapSize);
  place.poolLights(8);
  return place;
}

/** An interior as a place: its floor, its room's shell and light, its furniture and its lights. */
export function assembleInterior(room: InteriorData): AssembledRoom {
  const place = new Place(INDOOR_BACKGROUND);
  const area = interiorArea(room);
  const cols = area[2] - area[0];
  const { ids, looks } = groundOf(area[3] - area[1], cols, (i, j) => room.tiles[j * cols + i] ?? null);
  // A room's floor is drawn level: its daises and steps are its furniture.
  place.addGround(buildGround(ids, looks.map((l) => ({ picture: l.picture, priority: l.priority, hole: l.hole })), { x: area[0], z: area[1] }, 0, { x: 0, z: 0 }));
  const shell = ROOMS.build(room.kind, room);
  const level = (x: number, z: number): TileData | null => {
    const t = interiorTile(room, x, z);
    return t ? [0, t[1], t[2]] : null;
  };
  place.addPieces([shell, ...room.props.map(propOf), underOf(level, area[0], area[1], cols, area[3] - area[1], (t) => lookOf(t[1]))], room.id);
  for (const l of shell.lights ?? []) place.addLight(l);
  for (const l of room.lights ?? []) place.addLight(l);
  return { place, doorway: shell.doorway ?? [room.entry[0], 1, room.d], bounds: shell.bounds ?? [0, 0, room.w, room.d] };
}
