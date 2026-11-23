// A dungeon floor as the renderer draws it: its ground from the tiles' surfaces, its walls from the plan, its props and
// its lights - as render/assemble.ts's `assembleInterior` draws a room. (`groundOf` and `underOf` there are private;
// these are the same few lines, to be folded together at integration.)

import { MeshBuilder } from "../../art/paint/builder";
import { namedPalette } from "../../art/paint/palette";
import { PROPS } from "../../art/props";
import type { Built } from "../../art/recipe";
import { SURFACES, type SurfaceLook } from "../../art/surfaces";
import { INDOOR_BACKGROUND } from "../../render/assemble";
import { buildGround } from "../../render/ground";
import { Place } from "../../render/place";
import { NO_SURFACE, type Rect, type XYZ } from "../../world/format";
import { Grid } from "../../world/grid";
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
  const index = new Map<string, number>();
  const looks: SurfaceLook[] = [];
  const ids: number[][] = [];
  for (let z = 0; z < floor.d; z++) {
    const row: number[] = [];
    for (let x = 0; x < floor.w; x++) {
      const s = floor.tiles[z * floor.w + x]?.[1] ?? NO_SURFACE;
      if (s === NO_SURFACE) {
        row.push(-1);
        continue;
      }
      let k = index.get(s);
      if (k === undefined) {
        k = looks.length;
        index.set(s, k);
        looks.push(SURFACES.look(s));
      }
      row.push(k);
    }
    ids.push(row);
  }
  place.addGround(buildGround(ids, looks.map((l) => ({ picture: l.picture, priority: l.priority, hole: l.hole })), { x: 0, z: 0 }));
  // What lies under the holes: water, lava.
  const under = new MeshBuilder();
  ids.forEach((row, z) =>
    row.forEach((k, x) => {
      const u = k >= 0 ? looks[k]!.under : undefined;
      if (!u) return;
      const [xa, xb, za, zb, y] = [x - u.spread, x + 1 + u.spread, z - u.spread, z + 1 + u.spread, u.y];
      under.quad({ mat: u.material }, [[xa, y, zb], [xb, y, zb], [xb, y, za], [xa, y, za]], (c) => c[0], (c) => -c[2]);
    }),
  );
  const walls = drawWalls(floor.cells, floor.theme);
  const pieces: Built[] = [walls, ...floor.props.map((p) => PROPS.build(p.id, p, namedPalette(p.tint))), { model: under.model() }];
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
