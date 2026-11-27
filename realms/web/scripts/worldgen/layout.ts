// What the world generator is told beyond the travel map's geography (realms/content/<plane>/layout.json): the seed,
// how much the land rises and falls, each town as its people know it (its kind, form, style and size at walking scale,
// its inn, temple, guild, folk and texts) and each dungeon's and mage tower's definition (its theme, floors, tier, mobs,
// boss). Where anything stands - the coast, the regions, the towns' and dungeons' sites, the roads, ferries
// and landmarks - is the geography's (geography.json, geography.ts): one source for each fact, `checkGeography` proving
// the ids of the two agree.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DungeonData, type Region, STYLES, type Style, THEMES, type Theme } from "../../src/world/format";

/** What a region's land is: its ground, hills, water and scenery. The travel map adds its own (geography.ts GEO_BIOMES). */
export const BIOMES = ["heartland", "plains", "coast", "swamp", "mountains", "volcanic", "forest", "tundra", "waste"] as const;
export type Biome = (typeof BIOMES)[number];

export type At = readonly [number, number];

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

/**
 * A town as layout.json has it: everything but where it stands (its site on the travel map is the geography's, its
 * grounds' pocket the generator's).
 */
export interface TownLayout {
  readonly id: string;
  readonly name: string;
  readonly kind: "capital" | "town" | "village";
  readonly style: Style;
  /** Tiles from the centre to the edge of its square at walking scale, along x and z: the town is the square of tiles
   * within it, its walls (or its edge) an outline inside that square, hugging the land. */
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

/**
 * A dungeon or mage tower: a tournament (design.md A6) of `floors` floors, each but the last a round of `encounters`
 * challengers drawn from `mobs`, the last the boss's hall. Its mobs and boss are mob ids, or asked of the roster so a new
 * roster needs no change here: `@wanderers:2` (every wanderer of tier 2 of the dungeon's region), `@wanderers:2-3`,
 * `@wanderer:3` (one of them), `@warden:2` (the roster's `warden-2`, a construct that fights among the challengers). Its
 * `region` is the region whose color its mobs are drawn by (the geography's region of its site is where it stands, which
 * may be another).
 */
export interface DungeonLayout {
  readonly id: string;
  readonly name: string;
  readonly theme: Theme;
  /** A region's id (geography.json's), or none (the capstone). */
  readonly region?: string;
  readonly requires?: string;
  readonly floors: readonly [number, number];
  readonly tier: number;
  readonly encounters: readonly [number, number];
  readonly mobs: readonly string[] | readonly (readonly string[])[];
  readonly boss: string;
  readonly waystone?: boolean;
  /** How a color's dungeon is dealt by the character's standing to its color (format.ts, design.md A6), as written. */
  readonly standing?: DungeonData["standing"];
}

export interface Layout {
  readonly seed: number;
  /** How much the land rises and falls: 1 as designed, 0 a flat world (every walked tile at height 0). */
  readonly relief: number;
  readonly towns: readonly TownLayout[];
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

/** What is wrong with a layout: ids that clash, styles, forms and themes that are none, sizes out of reason. */
export function checkLayout(layout: Layout): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(layout.seed)) problems.push("seed should be a whole number");
  if (!(typeof layout.relief === "number" && layout.relief >= 0)) problems.push("relief should be a number, 0 or more");
  const towns = new Set(layout.towns.map((t) => t.id));
  const dungeons = new Set(layout.dungeons.map((d) => d.id));
  if (towns.size !== layout.towns.length) problems.push("two towns share an id");
  if (dungeons.size !== layout.dungeons.length) problems.push("two dungeons share an id");
  for (const t of layout.towns) {
    if ("at" in t || "region" in t) problems.push(`town ${t.id}: where it stands is geography.json's, not layout.json's`);
    if (!(STYLES as readonly string[]).includes(t.style)) problems.push(`town ${t.id}: style ${t.style} is unknown`);
    if (t.form !== undefined && !FORMS.includes(t.form)) problems.push(`town ${t.id}: form ${t.form} is unknown`);
    if (!(Number.isInteger(t.radius) && t.radius >= 16 && t.radius <= 100)) problems.push(`town ${t.id}: radius ${t.radius} should be 16 to 100 tiles`);
    if (!["capital", "town", "village"].includes(t.kind)) problems.push(`town ${t.id}: kind ${t.kind} is unknown`);
  }
  for (const d of layout.dungeons) {
    if ("at" in d || "road" in d) problems.push(`dungeon ${d.id}: where it stands and its road are geography.json's, not layout.json's`);
    if (!(THEMES as readonly string[]).includes(d.theme)) problems.push(`dungeon ${d.id}: theme ${d.theme} is unknown`);
  }
  if (!layout.towns.some((t) => t.start)) problems.push("no town is a starting area");
  if (layout.towns.filter((t) => t.kind === "capital").length !== 1) problems.push("there should be one capital");
  return problems;
}
