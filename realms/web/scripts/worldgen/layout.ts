// The world's geography as data (realms/content/<plane>/layout.json): the landmasses and the sea between them, the
// regions and the land each is (its biome), the mountain ranges, rivers and lakes, the towns, the roads between them,
// and the dungeons and mage towers. The generator draws the world from it; changing the world's map is changing this
// file. Places are axial hexes of the world (src/hex.ts), (0, 0) its top corner.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Region, Theme, TownStyle } from "../../src/world/schema";

/** What a region's land is: its ground, hills, water and scenery (terrain.ts, wilds.ts). */
export const BIOMES = ["heartland", "plains", "coast", "swamp", "mountains", "volcanic", "forest", "tundra"] as const;
export type Biome = (typeof BIOMES)[number];

export type At = readonly [number, number];

export interface Landmass {
  readonly id: string;
  readonly name: string;
  readonly center: At;
  /** Hexes from the centre to the coast, before stretching. */
  readonly radius: number;
  /** How much the coast wanders in and out, hexes. */
  readonly wobble?: number;
  /** Stretched along the ground's x and z: an island long one way. */
  readonly stretch?: readonly [number, number];
  /** Turned on the map, degrees. */
  readonly turn?: number;
}

/** A sea cut into the land (a bay), or a scatter of islets over the sea (an archipelago). */
export interface Patch {
  readonly center: At;
  readonly radius: number;
  /** For an archipelago: how much of it is land, 0-1. */
  readonly density?: number;
}

export interface RegionLayout {
  /** Its id in other ids (`<region>-<tier>` for its mage towers). */
  readonly id: string;
  readonly name: string;
  /** Its color, for its mobs and its home town; none for neutral ground. */
  readonly color: Region | null;
  readonly biome: Biome;
  readonly style: TownStyle;
  /** The middle of its land: every hex belongs to the region whose middle is nearest (borders waved by noise). */
  readonly at: At;
  /** How far its land reaches against its neighbours' (1 by default). */
  readonly weight?: number;
  /** The names of its bands of tier, 1 to 4. */
  readonly areas: readonly [string, string, string, string];
}

export interface Folk {
  readonly name: string;
  readonly text: readonly string[];
}

export interface TownLayout {
  readonly id: string;
  readonly name: string;
  readonly kind: "capital" | "town" | "village";
  /** A region's id. */
  readonly region: string;
  readonly style: TownStyle;
  readonly at: At;
  /** Hexes from the centre to the walls. */
  readonly radius: number;
  readonly inn: string;
  readonly innkeeper: readonly string[];
  readonly board: readonly string[];
  readonly folk: readonly Folk[];
  readonly centrepiece: "fountain" | "statue" | "well" | "crystal" | "tree" | "brazier";
  /** A starting area (design.md A6): the tiers of the wilds grow with distance from these. */
  readonly start: boolean;
  /** The color whose characters call it home. */
  readonly home?: Region;
  readonly temple: string;
  readonly guild: string;
}

/**
 * A dungeon or mage tower. Its mobs, warden and boss are mob ids, or asked of the roster so a new roster needs no
 * change here: `@wanderers:2` (every wanderer of tier 2 of the dungeon's region), `@wanderers:2-3`, `@wanderer:3` (one
 * of them), `@warden:2` (the roster's `warden-2`).
 */
export interface DungeonLayout {
  readonly id: string;
  readonly name: string;
  readonly theme: Theme;
  /** A region's id, or none (the capstone). */
  readonly region?: string;
  readonly at: At;
  readonly requires?: string;
  readonly floors: readonly [number, number];
  readonly tier: number;
  readonly encounters: readonly [number, number];
  readonly mobs: readonly string[] | readonly (readonly string[])[];
  readonly warden: string;
  readonly boss: string;
  readonly waystone?: boolean;
  /** A road to it, from the town named. */
  readonly road?: string;
}

export interface Layout {
  readonly seed: number;
  readonly landmasses: readonly Landmass[];
  readonly bays: readonly Patch[];
  readonly archipelagos: readonly Patch[];
  readonly regions: readonly RegionLayout[];
  readonly mountains: readonly { readonly from: At; readonly to: At; readonly width: number }[];
  readonly rivers: readonly { readonly from: At; readonly to: At; readonly lava?: boolean }[];
  readonly lakes: readonly { readonly at: At; readonly radius: number; readonly kind?: "water" | "swamp" | "lava" }[];
  readonly towns: readonly TownLayout[];
  readonly roads: readonly { readonly from: string; readonly to: string; readonly main?: boolean }[];
  readonly dungeons: readonly DungeonLayout[];
}

const here = dirname(fileURLToPath(import.meta.url));

/** The plane's layout file. */
export function readLayout(plane = "dominaria"): Layout {
  const layout = JSON.parse(readFileSync(join(here, "..", "..", "..", "content", plane, "layout.json"), "utf8")) as Layout;
  const problems = checkLayout(layout);
  if (problems.length > 0) throw new Error(`layout.json:\n  ${problems.join("\n  ")}`);
  return layout;
}

/** What is wrong with a layout: ids that clash or name nothing, places off the world. */
export function checkLayout(layout: Layout): string[] {
  const problems: string[] = [];
  const regions = new Set(layout.regions.map((r) => r.id));
  const towns = new Set(layout.towns.map((t) => t.id));
  const dungeons = new Set(layout.dungeons.map((d) => d.id));
  const on = (at: At) => at[0] >= 8 && at[1] >= 8 && at[0] < 632 && at[1] < 632;
  if (regions.size !== layout.regions.length) problems.push("two regions share an id");
  if (towns.size !== layout.towns.length) problems.push("two towns share an id");
  if (dungeons.size !== layout.dungeons.length) problems.push("two dungeons share an id");
  for (const r of layout.regions) {
    if (!BIOMES.includes(r.biome)) problems.push(`region ${r.id}: biome ${r.biome} is unknown`);
    if (!on(r.at)) problems.push(`region ${r.id} is off the world`);
  }
  for (const t of layout.towns) {
    if (!regions.has(t.region)) problems.push(`town ${t.id}: no region ${t.region}`);
    if (!on(t.at)) problems.push(`town ${t.id} is off the world`);
  }
  for (const d of layout.dungeons) {
    if (d.region !== undefined && !regions.has(d.region)) problems.push(`dungeon ${d.id}: no region ${d.region}`);
    if (d.road !== undefined && !towns.has(d.road)) problems.push(`dungeon ${d.id}: its road is from no town ${d.road}`);
    if (!on(d.at)) problems.push(`dungeon ${d.id} is off the world`);
  }
  for (const road of layout.roads) for (const end of [road.from, road.to]) if (!towns.has(end)) problems.push(`a road joins no town ${end}`);
  if (!layout.towns.some((t) => t.start)) problems.push("no town is a starting area");
  return problems;
}
