// Dungeon floors on squares (realms/docs/tech.md B5, "Dungeons on squares"): a run is a tournament, each floor one arena
// room in its theme's look - a round of challengers, or the boss's hall - with the run's contract placed on it, and the
// floor drawn in the slice's look.
//
//   generateDungeonFloor(request)   a run's floor: its plan, tiles, props, lights, ways and fights (generate.ts)
//   winsToOpen(challengers)         how many of a round's challengers open its gate (finish.ts)
//   assembleFloor(floor)            the floor as a Place to draw, its bounds and the way up's doorway (assemble.ts)
//   gridOfFloor(floor)              the floor's walkable Grid (assemble.ts)

// The art the floors name: the props and rooms registries, and the dungeons' own surfaces and props.
import "../art/props";
import "../art/rooms";
import "./surfaces";
import "./props";

export { type AssembledFloor, assembleFloor, gridOfFloor } from "./assemble";
export { THEME_DEFS, generateDungeonFloor } from "./generate";
export { MAX_LIGHTS, bossIndex, winsToOpen } from "./finish";
export type { DungeonFloor, FloorRequest, Role, RunFloor, Spot } from "./types";
