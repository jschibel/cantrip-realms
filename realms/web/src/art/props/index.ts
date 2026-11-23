// The props, by id (registry.ts). Importing this module defines them all.
import "./outdoors";
import "./indoors";
import "./nature";
import "./country";
import "./wilds";

export { PROPS, bool, drawn, needs, num, point, str, turnOf } from "./registry";
export * as draw from "./draw";
export { PROP_CATALOGUE, type Footprint, type PropInfo, tilesOf } from "./catalogue";
export { ENTRANCE_THEMES } from "./wilds";
