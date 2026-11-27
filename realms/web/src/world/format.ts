// The world as data, version 2 (realms/docs/interfaces.md, "Version 2 of the world data"): square tiles, positions in
// tiles `[x, z]` with x east and z south, the world cut into 32-by-32 chunks. What the world generator writes, what the
// overworld walks and draws (render/assemble.ts names each id to the art registries), and what the realm server checks
// places against. Nothing here is three.js: the world data names ids, and the art registries make the meshes.
//
// Files of a world (`realms/content/<plane>/world`, or a fixture folder such as `realms/web/fixtures/slice-world`):
//   world.json                 WorldData
//   chunks/<cx>_<cz>.json      ChunkData, chunk (cx, cz) holding tiles x in [cx * 32, cx * 32 + 32), likewise z
//   interiors/<id>.json        InteriorData
//   dungeons/<id>.json         DungeonData (unchanged from version 1 but for `entrance`, now [x, z])
//
// The loader (load.ts) reads and checks each file as it comes; the lint (lint.ts) checks a whole world.

/** The version these types describe. */
export const FORMAT_VERSION = 2;

/** Tiles along a chunk's side. */
export const CHUNK = 32;
/** World units along a tile's side. */
export const TILE = 1;
/** Texels along a tile's side: heights are in texels, so a step is a whole number of pixels. */
export const TEXELS_PER_TILE = 16;

/** A position in tiles: `[x, z]`, x east, z south. */
export type XZ = readonly [number, number];
/** A point in world units: `[x, y, z]`, y up. */
export type XYZ = readonly [number, number, number];
/** A linear color, each channel 0 to 1. */
export type RGB = readonly [number, number, number];
/** A rectangle of tiles or world units: `[x0, z0, x1, z1]`, x1 and z1 excluded. */
export type Rect = readonly [number, number, number, number];

export const REGIONS = ["W", "U", "B", "R", "G"] as const;
export type Region = (typeof REGIONS)[number];

export const NPC_KINDS = [
  "innkeeper",
  "spell-table",
  "vendor",
  "armorer",
  /** A temple's priest or a shrine's keeper, who sells hearts (design.md A3b). */
  "healer",
  "quest-board",
  "arena",
  "townsfolk",
  "guard",
  "waystone",
  "ferryman",
  /** A dungeon run's shrine (design.md A6), on a floor the run names: prayed at, it gives back a heart once in the run. */
  "heart-shrine",
  /** Only there to be seen: walks its rounds, is never spoken to (the sample crypt's skeleton and ghoul). */
  "ambient",
] as const;
export type NpcKind = (typeof NPC_KINDS)[number];

/**
 * The kinds that are things, not people: a spell table, a quest board, the arena's gate, a waystone, a dungeon's shrine.
 * Each stands on a blocked tile of its own (`stand` its middle) with a prop drawing it there; it has no figure, and is
 * used by a click on its tile from beside it.
 */
export const OBJECT_KINDS: ReadonlySet<NpcKind> = new Set<NpcKind>(["spell-table", "quest-board", "arena", "waystone", "heart-shrine"]);

/** What an interior is: the room recipe (art/rooms) that lays it out. */
export const INTERIOR_KINDS = ["shop", "inn", "guildhall", "temple", "smithy", "library", "house", "tower", "exotic-wares", "crypt"] as const;
export type InteriorKind = (typeof INTERIOR_KINDS)[number];

/** A region's building style (art/buildings), and the style its interiors are furnished in. */
export const STYLES = ["benalish", "tolarian", "urborg", "keldon", "llanowar", "argive"] as const;
export type Style = (typeof STYLES)[number];

export const THEMES = ["caves", "castle", "tower", "crypt", "hollow", "foundry", "portal"] as const;
export type Theme = (typeof THEMES)[number];

/** The highest tier of the wilds. A zone of tier 0 is no wilds: the sea, or a town's walls. */
export const MAX_TIER = 4;

// --- Tiles ---------------------------------------------------------------------------------------------------------

/**
 * A tile on the wire: `[height, surface, flags]`.
 * - `height`: the floor's height in texels (1/16 of a tile), so a dais of 3/16 or a terrace of 3/4 (12) is exact.
 * - `surface`: a surface id (art/surfaces), or `""` for none: nothing is drawn there (beyond the world's edge, the
 *   dark round a room) and nothing walks there.
 * - `flags`: `BLOCKED` (1) nobody walks there; `BARE` (2) nothing grows up off it (no standing grass under a tree or a
 *   house); `RAMP` (4) its floor slopes between its neighbours' levels. 0 and 1 mean what version 1's `blocked` meant.
 */
export type TileData = readonly [number, string, number];

export const BLOCKED = 1;
export const BARE = 2;
/**
 * `RAMP` (4): the tile's floor slopes from the level on one side to the level on the other, along the axis its
 * neighbours differ most on - a way up a terrace (render/terrain.ts draws it; a run of ramp tiles is one even slope).
 */
export const RAMP = 4;
/**
 * The most a step from one tile to a side-by-side one climbs or drops, texels (a quarter of a tile), unless both are
 * ramps (a ramp's tiles go up its slope whatever their heights). A higher bank - a terrace's edge, a road's embankment -
 * is a ledge: the tiles both sides of it are open and walked up to its brink, but nobody walks over it; one no higher
 * than `HOP` is hopped (world/grid.ts `canStep`).
 */
export const LEDGE = 4;
/**
 * The highest ledge hopped, texels (a terrace's one level): between two side-by-side open tiles whose floors differ by
 * more than `LEDGE` and no more than this (not both ramps), the edge is a hop - crossed straight across, never on a
 * diagonal step, by whoever hops (players always do; a mob as its file says). A higher bank is a cliff nobody crosses
 * (world/grid.ts `canStep`).
 */
export const HOP = 12;
/** The surface of no ground at all. */
export const NO_SURFACE = "";

// --- What stands on the tiles ----------------------------------------------------------------------------------------

/**
 * Scenery (art/props): a tree, a lamp, a barrel, a hedgerow, a hearth. `x`, `z` (and `y`) place the prop's anchor in
 * world units - tiles, fractions allowed - as its recipe documents (most: its middle on the ground; a line or a
 * rectangle: its first corner, `args.to` the other). It belongs to the chunk its anchor is in.
 */
export interface PropData {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Height of its foot above the floor, world units (a pot on a mantel). */
  readonly y?: number;
  /** Quarter turns clockwise seen from above: 0 faces south, toward the camera. */
  readonly rot?: number;
  /** A small turn on top of `rot`, radians (a gravestone leaning off true). */
  readonly turn?: number;
  readonly scale?: number;
  /** A named palette laid over the recipe's (art/paint/palette.ts, `PALETTES`). */
  readonly tint?: string;
  /** Which of the recipe's variations: a tree's crown, a shelf's books. */
  readonly seed?: number;
  /** Whatever else the recipe takes, as the registry entry documents it (JSON values only). */
  readonly args?: Readonly<Record<string, unknown>>;
}

/**
 * A building (art/buildings): drawn by its `style`'s recipe as a `kind` (default `house`), its footprint `w` by `d`
 * world units from (`x`, `z`), its front toward `rot` (quarter turns clockwise, 0: south). The tiles under it are
 * blocked by the tile data, not by this entry. `door` is the walkable tile in front of its door; walking through it
 * enters `interior`. A building with a door but no interior has a door that is only painted.
 */
export interface BuildingData {
  readonly id: string;
  readonly style: string;
  readonly kind?: string;
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly rot: number;
  readonly door?: XZ;
  readonly interior?: string;
  /** What its sign says or shows (a shop's name). */
  readonly sign?: string;
  /** A named palette over the style's own. */
  readonly palette?: string;
  /** The style's choices for this building - storeys, roof, openings - as its recipe documents them. */
  readonly params?: Readonly<Record<string, unknown>>;
}

/** How an NPC moves when nothing else moves it. Tiles throughout. */
export interface Behaviour {
  /** Wander about a home tile: stand a while (seconds, low and high), then walk to an open tile within reach. */
  readonly wander?: { readonly home: XZ; readonly reach: number; readonly pause: readonly [number, number] };
  /** Pace a beat between tiles, standing `pause` seconds at each. */
  readonly beat?: { readonly stops: readonly XZ[]; readonly pause: number };
  /** Turn to look at the player within this many tiles. */
  readonly watch?: number;
  /** Which way to face when standing, as a step `[dx, dz]`. */
  readonly rest?: XZ;
}

export interface NpcData {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly kind: NpcKind;
  /** What the overworld calls them: "Grizzlegom", "The Laughing Wurm". */
  readonly name?: string;
  readonly vendor?: string;
  readonly tower?: string;
  readonly ferry?: string;
  readonly text?: readonly string[];
  /** Their figure (art/figures), and a named palette over its own. */
  readonly figure?: string;
  readonly palette?: string;
  readonly behaviour?: Behaviour;
  /** Walking speed, tiles a second. */
  readonly speed?: number;
  /** Seeds their wandering, so it is the same every visit; without it they wander as they please. */
  readonly seed?: number;
  /** Where they stand, world units, when not on their tile's middle on its floor (a vendor up on a crate). */
  readonly stand?: XYZ;
}

export interface SpawnData {
  /** Unique across the world: `"<cx>_<cz>:<n>"`. */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly mobs: readonly string[];
  readonly radius: number;
  readonly respawnSeconds: number;
  readonly tier: number;
}

/** Walking onto an entrance starts a run of its dungeon. */
export interface EntranceData {
  readonly x: number;
  readonly z: number;
  readonly dungeon: string;
}

/** A waymarker stands where the tier rises, in the harder side's tier. */
export interface WaymarkerData {
  readonly x: number;
  readonly z: number;
  readonly tier: number;
}

/**
 * A light a place holds beyond its sky or its room's own: a fire, a candle, daylight through a window. `color` is
 * linear `[r, g, b]`, each 0 to 1; `intensity` in three.js units (physically correct lights). A `flicker`
 * steps the intensity: `base + steps[(floor(time * rate) + phase) % steps.length]`, in step with the flames.
 */
export interface LightData {
  readonly kind: "point" | "spot";
  readonly at: XYZ;
  readonly color: RGB;
  readonly intensity: number;
  /** How far it reaches (world units), and how fast it falls off. */
  readonly reach: number;
  readonly decay?: number;
  /** A spot's target, cone (radians) and soft edge (0-1). */
  readonly to?: XYZ;
  readonly angle?: number;
  readonly penumbra?: number;
  readonly shadow?: boolean;
  readonly flicker?: { readonly base: number; readonly steps: readonly number[]; readonly rate: number; readonly phase?: number };
}

export interface ChunkData {
  readonly cx: number;
  readonly cz: number;
  /** `CHUNK * CHUNK` tiles, row by row: z then x. */
  readonly tiles: readonly TileData[];
  readonly props: readonly PropData[];
  readonly buildings: readonly BuildingData[];
  readonly npcs: readonly NpcData[];
  readonly spawns: readonly SpawnData[];
  readonly entrances: readonly EntranceData[];
  readonly waymarkers: readonly WaymarkerData[];
  readonly lights?: readonly LightData[];
}

// --- Interiors ---------------------------------------------------------------------------------------------------------

/**
 * A room behind a door, laid out by its `kind`'s room recipe (art/rooms) in its `style`: its floor is `w` by `d` tiles
 * from (0, 0), its walls round that, its exit in the front (south) wall. `tiles` cover `area` (default the floor), row
 * by row: an area may reach past the floor where something is walked over or seen (the sill of the exit's gap in the
 * front wall). `entry` is its own tile at the door: stepping onto it leaves, and one arrives a step in from it (north).
 * `exit` is the world tile one comes out on: the door tile of the building that leads in.
 */
export interface InteriorData {
  readonly id: string;
  readonly name: string;
  readonly kind: InteriorKind;
  readonly town?: string;
  readonly style: string;
  readonly w: number;
  readonly d: number;
  readonly area?: Rect;
  readonly tiles: readonly TileData[];
  readonly props: readonly PropData[];
  readonly npcs: readonly NpcData[];
  readonly lights?: readonly LightData[];
  readonly entry: XZ;
  readonly exit: XZ;
  /** The room recipe's choices, as it documents them. */
  readonly params?: Readonly<Record<string, unknown>>;
}

// --- The world ---------------------------------------------------------------------------------------------------------

export interface TownData {
  readonly id: string;
  readonly name: string;
  readonly kind: "capital" | "town" | "village";
  /** Its middle and its walls (`radius` tiles from it): in its grounds, where it has them (`inTown`, `townAt`). */
  readonly center: XZ;
  /** Its walls stand this many tiles from its centre. */
  readonly radius: number;
  readonly style: string;
  readonly region?: Region;
  readonly start: boolean;
  readonly home?: Region;
  /** Its street plan, for the maps and the lint (streets.ts). */
  readonly plan?: TownPlan;
  /**
   * A world of two scales (`WorldData.travel`): on the travel map, the middle tile of its icon - a `town-icon` prop over
   * a blocked square footprint, `ICON_SIZE` of its kind across (`siteRect`).
   */
  readonly site?: XZ;
  /** Its grounds at walking scale: the rectangle of tiles drawn for it, in a pocket of its own. The camera keeps within it. */
  readonly grounds?: Rect;
  /** The ways between its grounds and the travel map. */
  readonly ways?: readonly TownWay[];
}

/** A side of a town's icon, and of its grounds: the way a way leaves it. */
export type Side = "north" | "east" | "south" | "west";
export const SIDES: readonly Side[] = ["north", "east", "south", "west"];

/**
 * A way between a town's grounds and the travel map (interfaces.md, "Two scales"): pushing from `outside` into the icon
 * enters the grounds at `inside`; walking onto an `exit` tile leaves them, onto `outside`.
 */
export interface TownWay {
  readonly side: Side;
  /** Travel map: the open tile beside the icon on that side. Pushing from it into the icon enters; leaving this way stands the player here. */
  readonly outside: XZ;
  /** Grounds: where one arrives, on the road a few tiles in from the exit. */
  readonly inside: XZ;
  /** Grounds: the open tiles across the road at the edge of the walked ground; walking onto one leaves to `outside`. */
  readonly exit: readonly XZ[];
  /** Where the road leads (a town's or a dungeon's id), for the maps' "To New Benalia". */
  readonly to?: string;
}

/** A name the whole map writes over the land and the sea. */
export interface MapLabel {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** `land` (Aerona), `region` (Benalia), `feature` (the Hurloon Mountains), `sea`. */
  readonly kind: "land" | "region" | "feature" | "sea";
}
export const LABEL_KINDS: readonly MapLabel["kind"][] = ["land", "region", "feature", "sea"];

/**
 * A town's street plan (interfaces.md, "Town plans"): its outline, its streets as a graph - junctions and ends (`nodes`)
 * joined by `ways` - its squares and plazas, its gates and its key places. A way's tiles are `wayTiles` (streets.ts):
 * the straight runs from node `a` through its `via` corners to node `b`, each tile widened by a square brush `width`
 * tiles across. Every street tile of the town is a tile of a way or a square, and every door opens onto one.
 */
export interface TownPlan {
  /** The corners of the town's outline, in order round it: its wall, hedge or edge runs along it. */
  readonly outline: readonly XZ[];
  readonly enclosure: "wall" | "palisade" | "hedge" | "none";
  readonly nodes: readonly XZ[];
  readonly ways: readonly StreetWay[];
  readonly squares: readonly TownSquare[];
  /** Each gate's node: the end of its way out, where a road arrives (or the harbour's quay). */
  readonly gates: readonly number[];
  readonly places: readonly TownPlace[];
}

export interface StreetWay {
  readonly a: number;
  readonly b: number;
  readonly width: number;
  /** A main street: a gate's way in, the streets round or across the square. */
  readonly main?: boolean;
  /** Its corners between `a` and `b`, in order. */
  readonly via?: readonly XZ[];
}

/** A square or plaza: `w` by `d` tiles from (x, z), or the ellipse inside them when `round`. */
export interface TownSquare {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly round?: boolean;
  readonly name?: string;
}

export const PLACE_KINDS = ["inn", "shop", "exotic-wares", "guildhall", "temple", "library", "tower", "smithy", "shrine", "quest-board", "arena", "pitch"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** A place the maps name: the tile of a door leading in, or of what is used from beside it. */
export interface TownPlace {
  readonly kind: PlaceKind;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export interface InnData {
  readonly id: string;
  readonly town: string;
  readonly x: number;
  readonly z: number;
  readonly interior: string;
}

export interface ZoneArea {
  readonly id: string;
  readonly name: string;
  readonly region: Region | null;
  readonly tier: number;
}

/** The tier zones: the world cut into `cell`-by-`cell` squares of tiles, `grid[row][col]` an index into `areas`. */
export interface Zones {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly areas: readonly ZoneArea[];
  readonly grid: readonly (readonly number[])[];
}

/**
 * The travel map from above, for the regional map (overview.ts reads and writes it): `cell`-by-`cell` squares from the
 * origin, a letter each that `legend` names (a surface's id, `woods:<kind>` where a grove stands; a first-version grid's
 * `town`, `woods`, `peaks`). The generator's is a tile a square, its `rows` and `levels` run-length coded (`rle`).
 */
export interface Overview {
  readonly cell: number;
  readonly legend: Readonly<Record<string, string>>;
  readonly rows: readonly string[];
  /** Rows (and levels) run-length coded: each run its count, left out for one, then its letter. */
  readonly rle?: boolean;
  /** Each square's ground level, a letter a square as the rows: `a` level 0 (a floor's height over 12 texels, rounded). */
  readonly levels?: readonly string[];
  /** The ranges' peaks: the middle tile of each one's footprint, its width in tiles and its kind (the `peak` prop's). */
  readonly peaks?: readonly (readonly [number, number, number, string])[];
}

/** A wonder of the travel map (a `landmark` prop's), named for the whole map. */
export interface MapLandmark {
  readonly id: string;
  readonly name: string;
  /** The `landmark` prop's `args.kind`: `cathedral`, `great-oak`, `floating-towers`, `ruin`, `obelisk`, `arena`, `lighthouse`. */
  readonly kind: string;
  /** The middle tile of its footprint. */
  readonly x: number;
  readonly z: number;
}

export interface RoadData {
  readonly from: string;
  readonly to: string;
  readonly tiles: readonly XZ[];
}

export interface WorldDungeon {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export interface FerryData {
  readonly id: string;
  readonly name: string;
  readonly from: XZ;
  readonly to: XZ;
  readonly lane: readonly XZ[];
}

export interface PitchData {
  readonly town: string;
  readonly x: number;
  readonly z: number;
}

export interface WorldData {
  /** The world's tiles: `size[0]` by `size[1]` from `origin` (default `[0, 0]`). */
  readonly size: XZ;
  readonly origin?: XZ;
  readonly chunk: number;
  readonly tile: number;
  /**
   * Where the camera keeps its view, as a rectangle of tiles (default the whole world): tiles past it are scenery seen
   * from a corner, never walked to (the sample's wood round its edges).
   */
  readonly bounds?: Rect;
  readonly seed?: number;
  readonly regions: readonly { readonly color: Region; readonly name: string; readonly tiles: number }[];
  readonly towns: readonly TownData[];
  readonly inns: readonly InnData[];
  readonly dungeons: readonly WorldDungeon[];
  readonly roads: readonly RoadData[];
  readonly ferries: readonly FerryData[];
  readonly pitches: readonly PitchData[];
  readonly zones: Zones;
  readonly overview: Overview;
  /**
   * The travel map (interfaces.md, "Two scales"): the rectangle of tiles that is the Domains at travel scale, its towns
   * icons whose grounds lie in pockets of their own past it. Absent (the fixtures, a world of one scale): every tile is
   * the travel map's, and towns stand on it at walking scale.
   */
  readonly travel?: Rect;
  /** Names the whole map writes over the land and the sea. */
  readonly labels?: readonly MapLabel[];
  /** The travel map's wonders, which the whole map marks and names. */
  readonly landmarks?: readonly MapLandmark[];
}

export interface DungeonData {
  readonly id: string;
  readonly name: string;
  readonly theme: Theme;
  readonly entrance: XZ;
  readonly requires?: string;
  readonly floors: readonly [number, number];
  readonly tier: number;
  readonly encounters: readonly [number, number];
  readonly mobs: readonly string[] | readonly (readonly string[])[];
  readonly warden: string;
  readonly boss: string;
  readonly region?: Region;
  readonly waystone?: boolean;
  /**
   * How a color's dungeon is dealt by where its color stands to the character's (design.md A6; the server's
   * `DungeonStanding`, and standing.ts): the run's tier, its floors' mob tiers and what its boss gains. A standing not
   * given deals the dungeon as written.
   */
  readonly standing?: Readonly<Partial<Record<Standing, DungeonStanding>>>;
}

/** Where a dungeon's color stands to a character's: their own, next to their starting color, or across from it. */
export type Standing = "own" | "ally" | "enemy";

/** A color dungeon's run as one standing deals it. */
export interface DungeonStanding {
  readonly tier: number;
  /** The lowest and the highest tier of its floors' mobs. */
  readonly mobTiers: readonly [number, number];
  /** What its boss gains over its own stats. */
  readonly bossStats?: { readonly life: number; readonly hand: number; readonly maxHand: number };
}

// --- Geometry ----------------------------------------------------------------------------------------------------------

/** The chunk a tile is in. */
export const chunkOf = (x: number, z: number): { cx: number; cz: number } => ({ cx: Math.floor(x / CHUNK), cz: Math.floor(z / CHUNK) });
/** A chunk's key, and its file's name without `.json`. */
export const chunkKey = (cx: number, cz: number): string => `${cx}_${cz}`;
/** A chunk key back to its coordinates; null for anything else. */
export function parseChunkKey(key: string): { cx: number; cz: number } | null {
  const m = /^(-?\d+)_(-?\d+)$/.exec(key);
  return m ? { cx: Number(m[1]), cz: Number(m[2]) } : null;
}

/** The world's tiles as a rectangle. */
export function worldRect(w: WorldData): Rect {
  const [ox, oz] = w.origin ?? [0, 0];
  return [ox, oz, ox + w.size[0], oz + w.size[1]];
}

/** The rectangle the camera keeps to. */
export const viewBounds = (w: WorldData): Rect => w.bounds ?? worldRect(w);

export const inRect = (r: Rect, x: number, z: number): boolean => x >= r[0] && z >= r[1] && x < r[2] && z < r[3];

/** The chunks a rectangle of tiles touches. */
export function chunksOver(r: Rect): { cx: number; cz: number }[] {
  const out: { cx: number; cz: number }[] = [];
  for (let cz = Math.floor(r[1] / CHUNK); cz <= Math.floor((r[3] - 1) / CHUNK); cz++) {
    for (let cx = Math.floor(r[0] / CHUNK); cx <= Math.floor((r[2] - 1) / CHUNK); cx++) out.push({ cx, cz });
  }
  return out;
}

/** A tile of a chunk by world coordinates (which must be in it). */
export const chunkTile = (c: ChunkData, x: number, z: number): TileData => c.tiles[(z - c.cz * CHUNK) * CHUNK + (x - c.cx * CHUNK)]!;

/** An interior's tile area. */
export const interiorArea = (i: InteriorData): Rect => i.area ?? [0, 0, i.w, i.d];

/** A tile of an interior, or null outside its area. */
export function interiorTile(i: InteriorData, x: number, z: number): TileData | null {
  const a = interiorArea(i);
  if (!inRect(a, x, z)) return null;
  return i.tiles[(z - a[1]) * (a[2] - a[0]) + (x - a[0])] ?? null;
}

/** The tier zone a tile lies in (world.json's `zones`, squares of `cell` tiles from the world's origin), or null off it. */
export function areaAt(world: Pick<WorldData, "zones" | "origin">, x: number, z: number): ZoneArea | null {
  const [ox, oz] = world.origin ?? [0, 0];
  const zones = world.zones;
  const index = zones.grid[Math.floor((z - oz) / zones.cell)]?.[Math.floor((x - ox) / zones.cell)];
  return index === undefined ? null : (zones.areas[index] ?? null);
}

/** A tile's tier: its zone's (0 for the sea, or off the world). A town within its walls is no tier's (see `townAt`). */
export const tierAt = (world: Pick<WorldData, "zones" | "origin">, x: number, z: number): number => areaAt(world, x, z)?.tier ?? 0;

/** Whether a tile is within a town's walls: no farther than its `radius` from its `center` along x and along z. */
export const inTown = (town: Pick<TownData, "center" | "radius">, x: number, z: number): boolean =>
  Math.max(Math.abs(x - town.center[0]), Math.abs(z - town.center[1])) <= town.radius;

/** The town whose walls a tile is within, if any. */
export const townAt = (towns: readonly TownData[], x: number, z: number): TownData | null => towns.find((t) => inTown(t, x, z)) ?? null;

/** A tile's floor height in world units. */
export const heightOf = (t: TileData): number => t[0] / TEXELS_PER_TILE;
export const isBlocked = (t: TileData): boolean => (t[2] & BLOCKED) !== 0 || t[1] === NO_SURFACE;
export const isBare = (t: TileData): boolean => (t[2] & BARE) !== 0;
/** Whether the edge between two side-by-side tiles is no ledge (`LEDGE`): their floors that near, or both ramps. */
export const noLedge = (a: TileData, b: TileData): boolean => (a[2] & b[2] & RAMP) !== 0 || Math.abs(a[0] - b[0]) <= LEDGE;
/** Whether the edge between two side-by-side tiles is a hop (`HOP`): a ledge no higher than one level. */
export const isHop = (a: TileData, b: TileData): boolean => !noLedge(a, b) && Math.abs(a[0] - b[0]) <= HOP;

/** The step out of a building's door, by its turn: rot 0 faces south. Into the building is the opposite. */
export function frontStep(rot: number): XZ {
  const steps: XZ[] = [
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 0],
  ];
  return steps[((rot % 4) + 4) % 4]!;
}

// --- Two scales (interfaces.md, "Two scales") ----------------------------------------------------------------------
//
// A world with `travel` holds two kinds of ground: the travel map, where each town is an icon on a blocked square, and
// each town's grounds at walking scale, a rectangle of its own (a pocket) past the travel map, never touching it nor
// another. A town's ways join the two: pushing into the icon from a way's `outside` enters the grounds at its `inside`;
// walking onto one of its `exit` tiles leaves to its `outside`. Chunks exist only over the travel map and the grounds
// (`groundChunks`): a chunk with no file is no ground, and is never asked for. A world without `travel` is one scale, as
// before: every tile the travel map's, and every chunk of its `size` one there may be.

/** Tiles across a town's icon on the travel map, by its kind (the `town-icon` prop's `size`). */
export const ICON_SIZE: Readonly<Record<TownData["kind"], number>> = { capital: 7, town: 5, village: 3 };

/** The step out of an icon (or a town's grounds) on a side: north is -z. */
export function sideStep(side: Side): XZ {
  return side === "north" ? [0, -1] : side === "south" ? [0, 1] : side === "east" ? [1, 0] : [-1, 0];
}

/**
 * The step out of a town's grounds through one of its ways: from its `inside` toward its exit, along the axis the two lie
 * apart on. A town's ways may share one gate whichever side of its icon each comes from, so this - not the way's side -
 * is which way one faces walking out (and, turned round, walking in).
 */
export function outwardStep(way: Pick<TownWay, "inside" | "exit">): XZ {
  const n = Math.max(1, way.exit.length);
  const dx = way.exit.reduce((s, e) => s + e[0], 0) / n - way.inside[0];
  const dz = way.exit.reduce((s, e) => s + e[1], 0) / n - way.inside[1];
  return Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
}

/** A town's icon's footprint on the travel map: the square `ICON_SIZE` of its kind across round its `site`; null with none. */
export function siteRect(town: Pick<TownData, "site" | "kind">): Rect | null {
  if (!town.site) return null;
  const half = Math.floor((ICON_SIZE[town.kind] ?? 3) / 2);
  return [town.site[0] - half, town.site[1] - half, town.site[0] + half + 1, town.site[1] + half + 1];
}

/** The travel map's rectangle: `travel`, or the whole world's in a world of one scale. */
export const travelRect = (w: Pick<WorldData, "travel" | "size" | "origin">): Rect => w.travel ?? worldRect(w as WorldData);

/** Whether a tile is the travel map's (every tile is, in a world of one scale). */
export const inTravel = (w: Pick<WorldData, "travel">, x: number, z: number): boolean => !w.travel || inRect(w.travel, x, z);

/** The town whose grounds hold a tile, if any. */
export const groundsAt = (w: Pick<WorldData, "towns">, x: number, z: number): TownData | null =>
  w.towns.find((t) => t.grounds && inRect(t.grounds, x, z)) ?? null;

/** The town whose icon stands on a tile of the travel map, if any. */
export function siteAt(w: Pick<WorldData, "towns">, x: number, z: number): TownData | null {
  for (const t of w.towns) {
    const r = siteRect(t);
    if (r && inRect(r, x, z)) return t;
  }
  return null;
}

/** A town's way, and which end of it a tile is: its `outside` on the travel map, or one of its `exit` tiles in the grounds. */
export interface WayEnd {
  readonly town: TownData;
  readonly way: TownWay;
  readonly end: "outside" | "exit";
}

/** The way whose `outside` or one of whose `exit` tiles a tile is, if any. */
export function wayAt(w: Pick<WorldData, "towns">, x: number, z: number): WayEnd | null {
  for (const town of w.towns) {
    for (const way of town.ways ?? []) {
      if (way.outside[0] === x && way.outside[1] === z) return { town, way, end: "outside" };
      if (way.exit.some(([ex, ez]) => ex === x && ez === z)) return { town, way, end: "exit" };
    }
  }
  return null;
}

/** Where a tile is: the travel map, a town's grounds, or neither (no ground: between the pockets, past the world). */
export type Scale = { readonly scale: "travel" } | { readonly scale: "grounds"; readonly town: TownData } | null;

export function scaleAt(w: Pick<WorldData, "travel" | "towns" | "size" | "origin">, x: number, z: number): Scale {
  const town = groundsAt(w, x, z);
  if (town) return { scale: "grounds", town };
  return inRect(travelRect(w), x, z) ? { scale: "travel" } : null;
}

/**
 * The rectangle the camera keeps to round a tile: a town's grounds in them, the travel map on it; in a world of one
 * scale, its `bounds` (`viewBounds`).
 */
export function framingAt(w: WorldData, x: number, z: number): Rect {
  if (!w.travel) return viewBounds(w);
  return groundsAt(w, x, z)?.grounds ?? w.travel;
}

/** The rectangles of ground of a world of two scales - the travel map, then each town's grounds; null for one scale. */
export function groundRects(w: Pick<WorldData, "travel" | "towns">): Rect[] | null {
  if (!w.travel) return null;
  return [w.travel, ...w.towns.flatMap((t) => (t.grounds ? [t.grounds] : []))];
}

const chunkSets = new WeakMap<object, ReadonlySet<string> | null>();

/**
 * The chunks a world has files for, by key: in a world of two scales every chunk over the travel map or a town's grounds
 * and no other (the loader never asks for another, the streamer never reads one, the lint holds the files to it); null
 * in a world of one scale, whose every chunk within `size` may have one.
 */
export function groundChunks(w: Pick<WorldData, "travel" | "towns">): ReadonlySet<string> | null {
  const known = chunkSets.get(w);
  if (known !== undefined) return known;
  const rects = groundRects(w);
  const set = rects ? new Set(rects.flatMap((r) => chunksOver(r).map(({ cx, cz }) => chunkKey(cx, cz)))) : null;
  chunkSets.set(w, set);
  return set;
}

/** Whether a chunk may hold ground: within the world's tiles, and in a world of two scales over the travel map or a grounds. */
export function hasGround(w: WorldData, cx: number, cz: number): boolean {
  const r = worldRect(w);
  if (!(cx * CHUNK < r[2] && (cx + 1) * CHUNK > r[0] && cz * CHUNK < r[3] && (cz + 1) * CHUNK > r[1])) return false;
  const set = groundChunks(w);
  return !set || set.has(chunkKey(cx, cz));
}
