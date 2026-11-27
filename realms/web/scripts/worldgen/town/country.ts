// The country round a town, seen past its wall and never walked (hub.ts): its ground, its trees and growth, and its
// fields, by the biome the travel map puts the town in.

import type { PropData } from "../../../src/world/format";
import { S } from "../ids";
import { texel } from "../land";
import type { TownBiome } from "./types";

/** The ground of the country by biome: its grass, its worn track, its trees, its growth, its fields. */
export interface Country {
  readonly ground: number;
  readonly track: number;
  readonly trees: readonly string[];
  readonly undergrowth: readonly string[];
  readonly fields: readonly number[];
  /** How much of the country is wood, 0-1. */
  readonly wood: number;
}

export function countryOf(biome: TownBiome): Country {
  switch (biome) {
    case "forest":
    case "jungle":
      return { ground: S["forest-floor"], track: S.dirt, trees: biome === "jungle" ? ["lush-tree", "palm", "great-tree"] : ["great-tree", "elf-tree", "oak", "tree"], undergrowth: ["undergrowth", "fern", "mushrooms", "giant-fern"], fields: [S.meadow], wood: 0.55 };
    case "swamp":
      return { ground: S.mud, track: S.planks, trees: ["swamp-tree", "mossy-dead-tree", "cypress", "dead-tree"], undergrowth: ["reeds", "mushrooms"], fields: [S.moss], wood: 0.35 };
    case "tundra":
      return { ground: S.tundra, track: S.dirt, trees: ["snowy-fir", "pine"], undergrowth: ["snowy-rock", "scrub"], fields: [S.tundra], wood: 0.3 };
    case "mountains":
    case "highlands":
      return { ground: S.grass, track: S.dirt, trees: ["pine", "birch"], undergrowth: ["rock", "scrub", "boulder"], fields: [S.meadow, S.straw], wood: 0.2 };
    case "coast":
      return { ground: S.grass, track: S.dirt, trees: ["oak", "birch", "tree"], undergrowth: ["scrub", "bush"], fields: [S.meadow, S.wheat], wood: 0.15 };
    case "desert":
    case "badlands":
    case "waste":
      return { ground: biome === "desert" ? S.sand : S["cracked-earth"], track: S.dirt, trees: ["dead-tree", "palm"], undergrowth: ["rock", "scrub"], fields: [S.straw], wood: 0.05 };
    case "volcanic":
      return { ground: S.ash, track: S.dirt, trees: ["dead-tree"], undergrowth: ["rock", "crag"], fields: [S.ash], wood: 0.05 };
    default:
      return { ground: S.grass, track: S.dirt, trees: ["oak", "tree", "birch"], undergrowth: ["bush", "wildflowers"], fields: [S.wheat, S.furrows, S.straw], wood: 0.12 };
  }
}

/** A tree or a bush of the country at a tile, its scale and seed varied. */
export function treeProp(id: string, x: number, z: number, random: () => number, scale = 1): PropData {
  return { id, x: texel(x + 0.5 + (random() - 0.5) * 0.3), z: texel(z + 0.5 + (random() - 0.5) * 0.3), seed: Math.floor(random() * 16), scale: texel(scale * (0.85 + random() * 0.3)) };
}
