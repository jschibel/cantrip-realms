// The building recipes, by style (registry.ts). Importing this module defines them all.
import "./benalish";
import "./llanowar";
import "./morass";
import "./keldon";
import "./tolarian";
import "./vess";
import "./village";
import "./phyrexian";

export { BUILDINGS, SHOWCASE, type Showcase, placeBuilding, showcase } from "./registry";
export { house, type HouseSpec, type Opening } from "./benalish";
export * as kit from "./kit";
export { TRADES, type Trade, styled } from "./kit";
