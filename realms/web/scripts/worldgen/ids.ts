// Every art id the world generator names (realms/docs/tech.md B5, "The world's ids"): the surfaces of its tiles, the
// props it stands on them, the building styles and kinds, the room kinds of its interiors, the figures of its people.
// An id the art registries do not have yet is a placeholder, listed in PLACEHOLDERS with what it should look like.

/** Surfaces, by what the world uses them for. Index 0 is no surface: nothing drawn, nothing walked. */
export const SURFACES = [
  "",
  "grass",
  "cobbles",
  "flagstones",
  "dirt",
  "straw",
  "furrows",
  "wheat",
  "stream",
  "floorboards",
  "hearthstone",
  "meadow",
  "forest-floor",
  "moss",
  "mud",
  "bog",
  "snow",
  "ice",
  "tundra",
  "rock",
  "scree",
  "sand",
  "sea",
  "shallows",
  "lava",
  "ash",
  "cracked-earth",
  "road",
  "planks",
  "phyrexian-ground",
] as const;
export type Surface = (typeof SURFACES)[number];

/** A surface's index in SURFACES, by id. */
export const S = Object.fromEntries(SURFACES.map((s, i) => [s === "" ? "none" : s, i])) as Record<Exclude<Surface, ""> | "none", number>;

/** Water: holes, drawn as what lies under them. */
export const WATER: ReadonlySet<number> = new Set([S.stream, S.bog, S.sea, S.shallows, S.lava]);

/** Building styles: one a region (world/format.ts, `STYLES`). */
export const STYLE_OF_REGION = {
  benalish: "Benalia's stone and banners",
  llanowar: "Llanowar's tree-houses",
  urborg: "the Morass's dark stilt-houses (the Vess estate's)",
  keldon: "Keldon longhouses",
  tolarian: "Tolarian domes",
} as const;

/**
 * The kinds of building the world asks each style for, with the `params` it gives every one (art/buildings/benalish.ts
 * documents them: ground, upper, roof, rise, chimney, wall, openings): a style reads what it can use of them.
 */
export const BUILDING_KINDS = ["house", "tenement", "shop", "inn", "temple", "guildhall", "smithy", "library", "tower", "warehouse", "barn", "keep", "manor"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/**
 * Placeholder ids, by kind: an id the generator names before the art has it, with what it should look like, so the lint
 * (world/lint.ts, `onUnknown`) names it instead of failing. Every id the world names is the art's now, so the lists are
 * empty; a new one goes here (with its description) only while the Art library makes it.
 */
export const PLACEHOLDERS: Readonly<Record<"surfaces" | "props" | "styles" | "rooms" | "figures", Readonly<Record<string, string>>>> = {
  surfaces: {},
  props: {},
  styles: {},
  rooms: {},
  figures: {},
};

/** Every placeholder id of a kind, as a set. */
export const placeholderIds = (kind: keyof typeof PLACEHOLDERS): ReadonlySet<string> => new Set(Object.keys(PLACEHOLDERS[kind]));
