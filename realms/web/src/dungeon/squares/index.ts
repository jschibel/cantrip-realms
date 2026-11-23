// Dungeon floors on squares (realms/docs/conversion.md, "Dungeons on squares"): one generator per theme, the run's
// contract placed on what it carves, and the floor drawn in the slice's look. The hex generator beside this directory
// (../generate.ts) is the game page's until integration retires it.
//
//   generateDungeonFloor(request)   a run's floor: its plan, tiles, props, lights, stairs and encounters (generate.ts)
//   assembleFloor(floor)            the floor as a Place to draw, its bounds and the way up's doorway (assemble.ts)
//   gridOfFloor(floor)              the floor's walkable Grid

import type { Place } from "../../render/place";
import type { Rect, XYZ } from "../../world/format";
import type { Grid } from "../../world/grid";
import type { DungeonFloor, FloorRequest } from "./types";

export type { DungeonFloor, FloorRequest, Role, RunFloor, Spot } from "./types";

export interface AssembledFloor {
  readonly place: Place;
  /** The ground the camera keeps its view within. */
  readonly bounds: Rect;
  /** The way up's doorway: where the iris closes leaving the dungeon. */
  readonly doorway: XYZ;
}

export function generateDungeonFloor(_request: FloorRequest): DungeonFloor {
  throw new Error("dungeon floors on squares: not built yet");
}

export function assembleFloor(_floor: DungeonFloor): AssembledFloor {
  throw new Error("dungeon floors on squares: not built yet");
}

export function gridOfFloor(_floor: DungeonFloor): Grid {
  throw new Error("dungeon floors on squares: not built yet");
}
