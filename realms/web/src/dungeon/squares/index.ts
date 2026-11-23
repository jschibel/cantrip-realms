// Dungeon floors on squares (realms/docs/conversion.md, "Dungeons on squares"): one generator per theme, the run's
// contract placed on what it carves, and the floor drawn in the slice's look. The hex generator beside this directory
// (../generate.ts) is the game page's until integration retires it.
//
//   generateDungeonFloor(request)   a run's floor: its plan, tiles, props, lights, stairs and encounters (generate.ts)
//   assembleFloor(floor)            the floor as a Place to draw, its bounds and the way up's doorway (assemble.ts)
//   gridOfFloor(floor)              the floor's walkable Grid (assemble.ts)

// The art the floors name: the props and rooms registries, and the dungeons' own surfaces and props.
import "../../art/props";
import "../../art/rooms";
import "./surfaces";
import "./props";

export { type AssembledFloor, assembleFloor, gridOfFloor } from "./assemble";
export { THEME_DEFS, generateDungeonFloor } from "./generate";
export { MAX_LIGHTS, bossIndex, wardenIndex } from "./finish";
export type { DungeonFloor, FloorRequest, Role, RunFloor, Spot } from "./types";
