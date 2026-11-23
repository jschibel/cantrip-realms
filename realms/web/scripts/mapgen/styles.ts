// How each region of Dominaria looks on its maps (design.md, A6): Benalia's meadows and white stone, Tolaria's
// shores, Urborg's swamps, Shiv's ash and lava, Llanowar's deep forest, the hub's cobbled neutral ground, and beyond the
// Phyrexian Portal the invaders' plated halls.

import type { PropKind, Region, Terrain } from "../../src/maps/schema";

export interface Style {
  /** The ground, from dry/high (0) to wet/low (1) by a moisture noise. */
  readonly ground: readonly Terrain[];
  /** What open water is here, if any. */
  readonly water: Terrain | null;
  /** What edges water: a beach, a mud bank. */
  readonly shore: Terrain;
  /** How hilly, in height steps. */
  readonly hills: number;
  readonly trees: readonly PropKind[];
  readonly treeShare: number;
  readonly rocks: readonly PropKind[];
  readonly rockShare: number;
  /** Scattered small things: bushes, reeds, bones. */
  readonly extras: readonly PropKind[];
  readonly extraShare: number;
  readonly road: Terrain;
  readonly paving: Terrain;
  readonly dungeonFloor: Terrain;
  readonly dungeonWall: Terrain;
  readonly dungeonProps: readonly PropKind[];
  /** A dungeon's hazard pools, if any. */
  readonly dungeonPool: Terrain | null;
}

export type StyleName = Region | "hub" | "phyrexia";

export const STYLES: Record<StyleName, Style> = {
  W: {
    ground: ["meadow", "grass", "grass", "grass"],
    water: "water",
    shore: "sand",
    hills: 3,
    trees: ["tree", "tree", "bush"],
    treeShare: 0.07,
    rocks: ["rock", "boulder"],
    rockShare: 0.02,
    extras: ["bush", "fence", "bush"],
    extraShare: 0.015,
    road: "dirt",
    paving: "marble",
    dungeonFloor: "marble",
    dungeonWall: "stone",
    dungeonProps: ["pillar", "statue", "brazier", "banner"],
    dungeonPool: null,
  },
  U: {
    ground: ["grass", "grass", "sand", "sand"],
    water: "water",
    shore: "sand",
    hills: 2,
    trees: ["pine", "bush"],
    treeShare: 0.03,
    rocks: ["rock", "crystal", "boulder"],
    rockShare: 0.03,
    extras: ["reeds", "ruin", "pillar"],
    extraShare: 0.015,
    road: "sand",
    paving: "stone",
    dungeonFloor: "crystal",
    dungeonWall: "stone",
    dungeonProps: ["crystal", "pillar", "ruin"],
    dungeonPool: "water",
  },
  B: {
    ground: ["moss", "mud", "swamp", "swamp"],
    water: "swamp",
    shore: "mud",
    hills: 1,
    trees: ["dead-tree", "dead-tree", "mushroom"],
    treeShare: 0.06,
    rocks: ["rock", "bones"],
    rockShare: 0.02,
    extras: ["reeds", "bones", "mushroom", "coffin"],
    extraShare: 0.03,
    road: "mud",
    paving: "stone",
    dungeonFloor: "stone",
    dungeonWall: "rock",
    dungeonProps: ["coffin", "bones", "pillar", "brazier"],
    dungeonPool: "swamp",
  },
  R: {
    ground: ["rock", "ash", "dirt", "stone"],
    water: "lava",
    shore: "ash",
    hills: 4,
    trees: ["dead-tree"],
    treeShare: 0.02,
    rocks: ["boulder", "rock", "rock"],
    rockShare: 0.06,
    extras: ["bones", "brazier"],
    extraShare: 0.008,
    road: "dirt",
    paving: "stone",
    dungeonFloor: "ash",
    dungeonWall: "rock",
    dungeonProps: ["anvil", "brazier", "crate", "pillar"],
    dungeonPool: "lava",
  },
  G: {
    ground: ["grass", "meadow", "moss", "grass"],
    water: "water",
    shore: "moss",
    hills: 2,
    trees: ["tree", "tree", "pine", "tree"],
    treeShare: 0.2,
    rocks: ["rock", "mushroom"],
    rockShare: 0.02,
    extras: ["bush", "mushroom", "bush"],
    extraShare: 0.05,
    road: "dirt",
    paving: "wood",
    dungeonFloor: "moss",
    dungeonWall: "wood",
    dungeonProps: ["mushroom", "tree", "bush"],
    dungeonPool: "water",
  },
  hub: {
    ground: ["grass", "grass", "meadow", "grass"],
    water: "water",
    shore: "sand",
    hills: 1,
    trees: ["tree", "bush"],
    treeShare: 0.03,
    rocks: ["rock"],
    rockShare: 0.01,
    extras: ["barrel", "crate"],
    extraShare: 0.01,
    road: "cobble",
    paving: "cobble",
    dungeonFloor: "stone",
    dungeonWall: "stone",
    dungeonProps: ["pillar"],
    dungeonPool: null,
  },
  phyrexia: {
    ground: ["ash", "rock", "stone", "ash"],
    water: "lava",
    shore: "ash",
    hills: 2,
    trees: ["dead-tree"],
    treeShare: 0.01,
    rocks: ["rock", "boulder"],
    rockShare: 0.04,
    extras: ["bones"],
    extraShare: 0.02,
    road: "floor",
    paving: "floor",
    dungeonFloor: "floor",
    dungeonWall: "rock",
    dungeonProps: ["altar", "pillar", "bones", "brazier"],
    dungeonPool: "lava",
  },
};
