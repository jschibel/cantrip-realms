// The world's geography as data (realms/content/<plane>/layout.json): its size, the landmasses and the sea between them,
// the regions and the land each is (its biome), the mountain ranges, rivers and lakes, the towns, the roads between
// them, the dungeons and mage towers, and the ferries. The generator draws the world from it; changing the world's map is
// changing this file. Places are square tiles `[x, z]` of the world (x east, z south, (0, 0) its north-west corner);
// lengths (radii, widths) are tiles.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Region, STYLES, type Style, THEMES, type Theme } from "../../src/world/format";

/** What a region's land is: its ground, hills, water and scenery (terrain.ts, wilds.ts). */
export const BIOMES = ["heartland", "plains", "coast", "swamp", "mountains", "volcanic", "forest", "tundra", "waste"] as const;
export type Biome = (typeof BIOMES)[number];

export type At = readonly [number, number];

export interface Landmass {
  readonly id: string;
  readonly name: string;
  readonly center: At;
  /** Tiles from the centre to the coast. */
  readonly radius: number;
  /** How far the coast wanders in and out, tiles. */
  readonly wobble?: number;
  /** Stretched along x and z: an island long one way. */
  readonly stretch?: readonly [number, number];
  /** Turned on the map, degrees clockwise. */
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
  readonly style: Style;
  /** The middle of its land: every tile belongs to the region whose middle is nearest (borders waved by noise). */
  readonly at: At;
  /** How far its land reaches against its neighbours' (1 by default). */
  readonly weight?: number;
  /** The least tier of its wilds, however near a starting area (the hardest lands are tier 4 wherever they are). */
  readonly minTier?: number;
  /** The names of its bands of tier, 1 to 4. */
  readonly areas: readonly [string, string, string, string];
}

export interface Folk {
  readonly name: string;
  readonly text: readonly string[];
}

export type Centrepiece = "fountain" | "statue" | "well" | "crystal" | "tree" | "brazier";

/**
 * How a town is laid out (towns.ts): `capital` and `city` walled stone towns of avenues and districts, `village` a
 * hamlet in hedges, `elfhame` tree-houses spread among Llanowar's giant trees, `stilts` the Morass's houses on stilts
 * along boardwalks, `clan` Keldon longhouses clustered round a great hall in a palisade, `campus` Tolarian domes round
 * courtyards, `estate` a manor with its grounds and outbuildings.
 */
export const FORMS = ["capital", "city", "village", "elfhame", "stilts", "clan", "campus", "estate"] as const;
export type Form = (typeof FORMS)[number];

export interface TownLayout {
  readonly id: string;
  readonly name: string;
  readonly kind: "capital" | "town" | "village";
  /** A region's id. */
  readonly region: string;
  readonly style: Style;
  readonly at: At;
  /** Tiles from the centre to the edge of its square, along x and z: the town is the square of tiles within it, its walls
   * (or its edge) an outline inside that square, hugging the land. */
  readonly radius: number;
  /** How it is laid out; by default `capital`, `city` or `village` by its kind. */
  readonly form?: Form;
  readonly inn: string;
  readonly innkeeper: readonly string[];
  readonly board: readonly string[];
  readonly folk: readonly Folk[];
  readonly centrepiece: Centrepiece;
  /** A starting area (design.md A6): the tiers of the wilds grow with distance from these. */
  readonly start: boolean;
  /** The color whose characters call it home. */
  readonly home?: Region;
  readonly temple: string;
  readonly guild: string;
  /** An exotic wares shop here (design.md A5): the exotic vendor's id. */
  readonly exotic?: string;
  /** A pitch in its market square where traveling vendors from other planes set up their caravans (design.md A5). */
  readonly caravan?: boolean;
}

/** A ferry across the sea to a far isle (design.md A6): a dock at each end, a lane over the water between them. */
export interface FerryLayout {
  readonly id: string;
  readonly name: string;
  /** The two docks, near enough: each is the nearest shore to these. */
  readonly from: At;
  readonly to: At;
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
  /** The world's tiles, x by z, from (0, 0). Whole chunks (32) each way. */
  readonly size: readonly [number, number];
  /** How much the land rises and falls: 1 as designed, 0 a flat world (every walked tile at height 0). */
  readonly relief: number;
  readonly landmasses: readonly Landmass[];
  readonly bays: readonly Patch[];
  readonly archipelagos: readonly Patch[];
  readonly regions: readonly RegionLayout[];
  readonly mountains: readonly { readonly from: At; readonly to: At; readonly width: number }[];
  readonly rivers: readonly { readonly from: At; readonly to: At; readonly lava?: boolean }[];
  readonly lakes: readonly { readonly at: At; readonly radius: number; readonly kind?: "water" | "swamp" | "lava" }[];
  readonly towns: readonly TownLayout[];
  /** Roads between towns, dungeons and ferry docks (`ferry:<id>:from`, `ferry:<id>:to`). */
  readonly roads: readonly { readonly from: string; readonly to: string; readonly main?: boolean }[];
  readonly dungeons: readonly DungeonLayout[];
  readonly ferries: readonly FerryLayout[];
}

const here = dirname(fileURLToPath(import.meta.url));

/** The plane's layout file. */
export function readLayout(plane = "dominaria"): Layout {
  const layout = JSON.parse(readFileSync(join(here, "..", "..", "..", "content", plane, "layout.json"), "utf8")) as Layout;
  const problems = checkLayout(layout);
  if (problems.length > 0) throw new Error(`layout.json:\n  ${problems.join("\n  ")}`);
  return layout;
}

/** What is wrong with a layout: ids that clash or name nothing, places off the world, sizes not whole chunks. */
export function checkLayout(layout: Layout): string[] {
  const problems: string[] = [];
  const [W, H] = layout.size ?? [0, 0];
  if (!(W > 0 && H > 0 && W % 32 === 0 && H % 32 === 0)) problems.push(`size ${String(layout.size)} should be whole chunks of 32 each way`);
  if (!(typeof layout.relief === "number" && layout.relief >= 0)) problems.push("relief should be a number, 0 or more");
  const regions = new Set(layout.regions.map((r) => r.id));
  const towns = new Set(layout.towns.map((t) => t.id));
  const dungeons = new Set(layout.dungeons.map((d) => d.id));
  const on = (at: At, margin = 16) => at[0] >= margin && at[1] >= margin && at[0] < W - margin && at[1] < H - margin;
  if (regions.size !== layout.regions.length) problems.push("two regions share an id");
  if (towns.size !== layout.towns.length) problems.push("two towns share an id");
  if (dungeons.size !== layout.dungeons.length) problems.push("two dungeons share an id");
  for (const r of layout.regions) {
    if (!BIOMES.includes(r.biome)) problems.push(`region ${r.id}: biome ${r.biome} is unknown`);
    if (!(STYLES as readonly string[]).includes(r.style)) problems.push(`region ${r.id}: style ${r.style} is unknown`);
    if (!on(r.at)) problems.push(`region ${r.id} is off the world`);
  }
  for (const t of layout.towns) {
    if (!regions.has(t.region)) problems.push(`town ${t.id}: no region ${t.region}`);
    if (!(STYLES as readonly string[]).includes(t.style)) problems.push(`town ${t.id}: style ${t.style} is unknown`);
    if (t.form !== undefined && !FORMS.includes(t.form)) problems.push(`town ${t.id}: form ${t.form} is unknown`);
    if (!on(t.at, t.radius + 24)) problems.push(`town ${t.id} is off the world, or too near its edge`);
  }
  for (const [k, a] of layout.towns.entries()) {
    for (const b of layout.towns.slice(k + 1)) {
      // Their walls and the aprons round them (6 tiles each) apart, with room for a road between.
      const gap = Math.max(Math.abs(a.at[0] - b.at[0]), Math.abs(a.at[1] - b.at[1])) - a.radius - b.radius;
      if (gap < 16) problems.push(`towns ${a.id} and ${b.id} stand ${gap} tiles apart, wall to wall: 16 at the least`);
    }
  }
  for (const d of layout.dungeons) {
    if (d.region !== undefined && !regions.has(d.region)) problems.push(`dungeon ${d.id}: no region ${d.region}`);
    if (d.road !== undefined && !towns.has(d.road)) problems.push(`dungeon ${d.id}: its road is from no town ${d.road}`);
    if (!(THEMES as readonly string[]).includes(d.theme)) problems.push(`dungeon ${d.id}: theme ${d.theme} is unknown`);
    if (!on(d.at)) problems.push(`dungeon ${d.id} is off the world`);
  }
  const docks = new Set(layout.ferries.flatMap((f) => [`ferry:${f.id}:from`, `ferry:${f.id}:to`]));
  for (const road of layout.roads) for (const end of [road.from, road.to]) if (!towns.has(end) && !dungeons.has(end) && !docks.has(end)) problems.push(`a road joins nothing called ${end}`);
  for (const f of layout.ferries) for (const end of [f.from, f.to]) if (!on(end)) problems.push(`ferry ${f.id}'s dock is off the world`);
  if (!layout.towns.some((t) => t.start)) problems.push("no town is a starting area");
  return problems;
}
