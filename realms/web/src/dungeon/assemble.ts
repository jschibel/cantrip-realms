// A dungeon floor as the renderer draws it: its ground from the tiles' surfaces, its walls from the plan, its props and
// its lights - as render/assemble.ts's `assembleInterior` draws a room, from the same ground and under-hole helpers.

import type { Built } from "../art/recipe";
import { INDOOR_BACKGROUND } from "../render/assemble";
import { groundOf, lookOf, propOf, underOf } from "../render/chunks";
import { buildGround } from "../render/ground";
import { Place } from "../render/place";
import { NO_SURFACE, type Rect, type TileData, type XYZ } from "../world/format";
import { Grid } from "../world/grid";
import type { DungeonFloor } from "./types";
import { drawWalls } from "./walls";

export interface AssembledFloor {
  readonly place: Place;
  /** The ground the camera keeps its view within. */
  readonly bounds: Rect;
  /** The way up's doorway: where the iris closes leaving the dungeon. */
  readonly doorway: XYZ;
}

export function assembleFloor(floor: DungeonFloor): AssembledFloor {
  const place = new Place(INDOOR_BACKGROUND);
  const tileAt = (x: number, z: number): TileData | null => (x >= 0 && z >= 0 && x < floor.w && z < floor.d ? floor.tiles[z * floor.w + x] ?? null : null);
  const { ids, looks } = groundOf(floor.d, floor.w, tileAt);
  place.addGround(buildGround(ids, looks.map((l) => ({ picture: l.picture, priority: l.priority, hole: l.hole })), { x: 0, z: 0 }));
  const walls = drawWalls(floor.cells, floor.theme);
  // What lies under the holes: water, lava.
  const pieces: Built[] = [walls, ...floor.props.map(propOf), underOf(tileAt, 0, 0, floor.w, floor.d, (t) => lookOf(t[1]))];
  place.addPieces(pieces, `dungeon-${floor.theme}-${floor.floor}`);
  for (const l of walls.lights ?? []) place.addLight(l);
  for (const l of floor.lights) place.addLight(l);
  const [ux, uz] = floor.up;
  return { place, bounds: [0, -3, floor.w, floor.d], doorway: [ux + 0.5, 0.9, uz + 0.3] };
}

/** A floor's walkable tiles: every tile whose ground is walked (the stairs and the way out are, to be taken). */
export function gridOfFloor(floor: DungeonFloor): Grid {
  const grid = new Grid(floor.w, floor.d, 0, 0);
  for (let z = 0; z < floor.d; z++) {
    for (let x = 0; x < floor.w; x++) {
      const t = floor.tiles[z * floor.w + x]!;
      grid.setWalkable(x, z, (t[2] & 1) === 0 && t[1] !== NO_SURFACE);
    }
  }
  return grid;
}
