// The world as data (realms/docs/interfaces.md, "The world, interiors and dungeons"): Dominaria as one connected map in
// 32-by-32 chunks (`world/world.json`, `world/chunks/<cq>_<cr>.json`), the interiors its doors lead into
// (`interiors/<id>.json`) and the dungeons its entrances start (`dungeons/<id>.json`). What the world generator
// (scripts/world.ts) and the editor write, what the overworld walks and draws, and what the realm server checks places,
// spawns and walks against. The validators here are the per-file content lint; world.test.ts lints the whole.

import { type Hex, distance, hex, key, neighbors } from "../hex";

export const REGIONS = ["W", "U", "B", "R", "G"] as const;
export type Region = (typeof REGIONS)[number];

/** Ground a hex can be. */
export const TERRAINS = [
  "grass",
  "meadow",
  "dirt",
  "road",
  "cobble",
  "stone",
  "rock",
  "sand",
  "water",
  "deep-water",
  "swamp",
  "mud",
  "moss",
  "snow",
  "ice",
  "ash",
  "lava",
  "floor",
  "wood",
  "marble",
  "crystal",
  "forest",
  "hills",
  "mountain",
] as const;
export type Terrain = (typeof TERRAINS)[number];

/** Scenery that stands on a hex. Whether it blocks is the tile's `blocked`, not the prop's. */
export const PROP_KINDS = [
  "tree",
  "pine",
  "dead-tree",
  "bush",
  "rock",
  "boulder",
  "reeds",
  "mushroom",
  "crystal",
  "house",
  "tower",
  "wall",
  "fence",
  "well",
  "fountain",
  "statue",
  "pillar",
  "ruin",
  "brazier",
  "banner",
  "crate",
  "barrel",
  "bones",
  "tent",
  "stall",
  "anvil",
  "altar",
  "coffin",
  "throne",
  "portal",
  "stairs-down",
  "stairs-up",
  "signpost",
  // A building's outer shell: a box of `w` by `d` world units round its hex, `h` tall, its front toward `front`.
  "building",
  // A town gate's arch over an open hex, and the towers beside it.
  "gate",
  // A tier's boundary: a standing stone (or, by a road, a banner) in the tier's color, with its number in pips.
  "waymarker",
  // A dungeon's way in, drawn for its theme: a cave mouth, a castle gate, a tower, a crypt door...
  "entrance",
  "lamp",
  "dock",
  // Furnishings, inside.
  "counter",
  "shelf",
  "bookshelf",
  "bed",
  "table",
  "hearth",
  "pew",
  "forge",
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** People and places to use: an inn to rest and respawn at, a spell table, vendors, an armorer, a waystone... */
export const NPC_KINDS = ["inn", "spell-table", "vendor", "armorer", "quest-board", "arena", "townsfolk", "guard", "waystone"] as const;
export type NpcKind = (typeof NPC_KINDS)[number];

export const BUILDING_USES = ["house", "tenement", "shop", "inn", "temple", "guildhall", "smithy", "library", "mage-tower", "warehouse"] as const;
export type BuildingUse = (typeof BUILDING_USES)[number];

/** The kinds of interior: the building uses that have one (design.md A6). */
export const INTERIOR_KINDS = ["shop", "inn", "guildhall", "temple", "smithy", "library", "house", "tower"] as const;
export type InteriorKind = (typeof INTERIOR_KINDS)[number];

/** How a region's towns are built (design.md A6). */
export const STYLES = ["benalish", "tolarian", "urborg", "keldon", "llanowar", "argive"] as const;
export type TownStyle = (typeof STYLES)[number];

export const THEMES = ["caves", "castle", "tower", "crypt", "hollow", "foundry", "portal"] as const;
export type Theme = (typeof THEMES)[number];

/** The sides of a building, in the ground plane's axes: +x, -x, +z, -z. */
export const FRONTS = ["x+", "x-", "z+", "z-"] as const;
export type Front = (typeof FRONTS)[number];

/** The world's size and its chunks' (interfaces.md). */
export const WORLD_SIZE = 640;
export const CHUNK = 32;
export const CHUNKS = WORLD_SIZE / CHUNK;

/** The highest tier of the wilds. A zone of tier 0 is no wilds: the sea, or a town's walls. */
export const MAX_TIER = 4;

/** A tile on the wire: `[q, r, height, terrain, blocked]`. */
export type TileData = readonly [number, number, number, string, number];

export interface PropData {
  readonly q: number;
  readonly r: number;
  readonly kind: string;
  /** A building's or entrance's size and look. */
  readonly w?: number;
  readonly d?: number;
  readonly h?: number;
  readonly style?: string;
  readonly use?: string;
  readonly front?: Front;
  /** A waymarker's tier: the harder side's. A dungeon entrance's theme is its `style`. */
  readonly tier?: number;
}

export interface SpawnData {
  /** Unique across the world: `"<cq>_<cr>:<n>"`. */
  readonly id: string;
  readonly q: number;
  readonly r: number;
  /** Only mobs of the spawn's tier. */
  readonly mobs: readonly string[];
  /** How far from its spawn point the mob wanders. */
  readonly radius: number;
  readonly respawnSeconds: number;
  /** The tier of the zone it stands in (interfaces.md, "Spawn tiers"). */
  readonly tier: number;
}

export interface ChestData {
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly gold: readonly [number, number];
  readonly respawnSeconds: number;
}

export interface NpcData {
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly kind: string;
  /** A vendor's id (`<plane>/vendors/<id>.json`). */
  readonly vendor?: string;
  /** A waystone's tower (a dungeon of theme `tower` with `waystone: true`). */
  readonly tower?: string;
  /** What the overworld calls them: "Grizzlegom", "The Laughing Wurm". */
  readonly name?: string;
  /** What they say when spoken to; a quest board's notices. One line each. */
  readonly text?: readonly string[];
}

/** Walking onto a door enters its interior. */
export interface DoorData {
  readonly q: number;
  readonly r: number;
  readonly interior: string;
}

/** Walking onto an entrance starts a run of its dungeon. */
export interface EntranceData {
  readonly q: number;
  readonly r: number;
  readonly dungeon: string;
}

export interface ChunkData {
  readonly cq: number;
  readonly cr: number;
  readonly tiles: readonly TileData[];
  readonly props: readonly PropData[];
  readonly doors: readonly DoorData[];
  readonly npcs: readonly NpcData[];
  readonly spawns: readonly SpawnData[];
  readonly chests: readonly ChestData[];
  readonly entrances: readonly EntranceData[];
}

export interface TownData {
  readonly id: string;
  readonly name: string;
  readonly kind: "capital" | "town" | "village";
  readonly center: readonly [number, number];
  /** Its walls stand this many hexes from its centre. */
  readonly radius: number;
  readonly style: TownStyle;
  readonly region?: Region;
  /** Whether it is a starting area: the capital and the five home towns (design.md A6). */
  readonly start: boolean;
  /** The color whose characters begin here, for a home town. */
  readonly home?: Region;
}

/** An inn: where a beaten character wakes, the world hex outside its door. */
export interface InnData {
  readonly id: string;
  readonly town: string;
  readonly q: number;
  readonly r: number;
  readonly interior: string;
}

export interface ZoneArea {
  readonly id: string;
  readonly name: string;
  readonly region: Region | null;
  readonly tier: number;
}

/**
 * The tier zones (design.md A6): the world cut into `cell`-by-`cell` squares of axial hexes, `grid[row][col]` the index
 * in `areas` of the area the square at `q = col * cell`, `r = row * cell` belongs to. An area is a region's band of one
 * tier, the hub's heartland, or the sea (tier 0); a town inside its walls is its own place and no tier's.
 */
export interface Zones {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly areas: readonly ZoneArea[];
  readonly grid: readonly (readonly number[])[];
}

/** The world from above, for the regional map: one letter of `legend` for each `cell`-by-`cell` square of hexes. */
export interface Overview {
  readonly cell: number;
  readonly legend: Readonly<Record<string, string>>;
  readonly rows: readonly string[];
}

export interface RoadData {
  readonly from: string;
  readonly to: string;
  readonly hexes: readonly (readonly [number, number])[];
}

export interface WorldDungeon {
  readonly id: string;
  readonly q: number;
  readonly r: number;
}

export interface WorldData {
  readonly size: readonly [number, number];
  readonly chunk: number;
  readonly seed: number;
  readonly regions: readonly { readonly color: Region; readonly name: string; readonly hexes: number }[];
  readonly towns: readonly TownData[];
  readonly inns: readonly InnData[];
  readonly dungeons: readonly WorldDungeon[];
  readonly roads: readonly RoadData[];
  readonly zones: Zones;
  readonly overview: Overview;
}

export interface InteriorData {
  readonly id: string;
  readonly name: string;
  readonly kind: InteriorKind;
  /** The town whose door leads in. */
  readonly town: string;
  readonly style: TownStyle;
  /** Where its door comes out in the world: the hex in front of the door. */
  readonly exit: { readonly q: number; readonly r: number };
  /** Its own hex at the door: stepping onto it leaves. */
  readonly entry: { readonly q: number; readonly r: number };
  readonly tiles: readonly TileData[];
  readonly props: readonly PropData[];
  readonly npcs: readonly NpcData[];
}

export interface DungeonData {
  readonly id: string;
  readonly name: string;
  readonly theme: Theme;
  readonly entrance: readonly [number, number];
  /** The colors a character's identity must hold to go in, in WUBRG order. */
  readonly requires?: string;
  readonly floors: readonly [number, number];
  /** At least the tier of where it stands. */
  readonly tier: number;
  /** How many encounters each floor holds, besides its warden and boss. */
  readonly encounters: readonly [number, number];
  /** One list for every floor, or a list per floor (the last list for the floors past it). */
  readonly mobs: readonly string[] | readonly (readonly string[])[];
  readonly warden: string;
  readonly boss: string;
  readonly region?: Region;
  /** A mage tower: beating its boss attunes its waystone (design.md A6). */
  readonly waystone?: boolean;
  /** A mage tower's: where waystone travel to it arrives, open ground beside its waystone. */
  readonly arrival?: readonly [number, number];
}

// --- Geometry ---------------------------------------------------------------------------------------------------------

export const chunkOf = (h: Hex): { cq: number; cr: number } => ({ cq: Math.floor(h.q / CHUNK), cr: Math.floor(h.r / CHUNK) });
export const chunkKey = (cq: number, cr: number): string => `${cq}_${cr}`;
export const inWorld = (h: Hex): boolean => h.q >= 0 && h.r >= 0 && h.q < WORLD_SIZE && h.r < WORLD_SIZE;

/** The zone area a hex lies in. */
export function areaAt(zones: Zones, h: Hex): ZoneArea | null {
  const col = Math.floor(h.q / zones.cell);
  const row = Math.floor(h.r / zones.cell);
  const index = zones.grid[row]?.[col];
  return index === undefined ? null : zones.areas[index] ?? null;
}

export const tierAt = (zones: Zones, h: Hex): number => areaAt(zones, h)?.tier ?? 0;

/** The town whose walls a hex is within. */
export function townAt(towns: readonly TownData[], h: Hex): TownData | null {
  for (const town of towns) if (distance(h, hex(town.center[0], town.center[1])) <= town.radius) return town;
  return null;
}

// --- Lint ---------------------------------------------------------------------------------------------------------------

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

interface Tiles {
  readonly tiles: Map<string, TileData>;
  readonly open: (h: Hex) => boolean;
}

function checkTiles(list: unknown, fail: (text: string) => void, inside: (q: number, r: number) => boolean): Tiles {
  const tiles = new Map<string, TileData>();
  if (!Array.isArray(list)) {
    fail("tiles is not a list");
    return { tiles, open: () => false };
  }
  for (const tile of list as unknown[]) {
    if (!Array.isArray(tile) || tile.length !== 5) {
      fail(`tile ${JSON.stringify(tile)} is not [q, r, height, terrain, blocked]`);
      continue;
    }
    const [q, r, height, terrain, blocked] = tile as unknown[];
    const at = `tile ${String(q)},${String(r)}`;
    if (!isInt(q) || !isInt(r)) {
      fail(`${at}: q and r are whole numbers`);
      continue;
    }
    if (!inside(q, r)) fail(`${at} is outside`);
    if (typeof height !== "number" || !Number.isFinite(height) || Math.abs(height) > 16) fail(`${at}: height is not a number from -16 to 16`);
    if (!TERRAINS.includes(terrain as Terrain)) fail(`${at}: terrain ${String(terrain)} is unknown`);
    if (blocked !== 0 && blocked !== 1) fail(`${at}: blocked is 0 or 1`);
    if (tiles.has(`${q},${r}`)) fail(`${at} is listed twice`);
    tiles.set(`${q},${r}`, tile as unknown as TileData);
  }
  return { tiles, open: (h: Hex) => tiles.get(key(h))?.[4] === 0 };
}

function checkProps(props: unknown, fail: (text: string) => void, on: (h: Hex) => boolean): void {
  if (!Array.isArray(props)) return fail("props is not a list");
  for (const prop of props as PropData[]) {
    if (!PROP_KINDS.includes(prop.kind as PropKind)) fail(`prop ${String(prop.kind)} is unknown`);
    if (!isInt(prop.q) || !isInt(prop.r) || !on(hex(prop.q, prop.r))) fail(`prop ${prop.kind} at ${prop.q},${prop.r} is off its tiles`);
    if (prop.kind === "building" || prop.kind === "entrance") {
      for (const n of ["w", "d", "h"] as const) if (!(typeof prop[n] === "number" && prop[n]! > 0 && prop[n]! < 40)) fail(`${prop.kind} at ${prop.q},${prop.r}: ${n} is a size`);
      if (!FRONTS.includes(prop.front as Front)) fail(`${prop.kind} at ${prop.q},${prop.r}: front is one of ${FRONTS.join(", ")}`);
    }
    if (prop.kind === "building" && !BUILDING_USES.includes(prop.use as BuildingUse)) fail(`building at ${prop.q},${prop.r}: use ${String(prop.use)} is unknown`);
    if (prop.kind === "entrance" && !THEMES.includes(prop.style as Theme)) fail(`entrance at ${prop.q},${prop.r}: style ${String(prop.style)} is no theme`);
    if (prop.kind === "waymarker" && !(isInt(prop.tier) && prop.tier >= 1 && prop.tier <= MAX_TIER)) fail(`waymarker at ${prop.q},${prop.r} has no tier`);
  }
}

function checkNpcs(npcs: unknown, fail: (text: string) => void, on: (h: Hex) => boolean, open: (h: Hex) => boolean, beside: (h: Hex) => boolean = open): void {
  if (!Array.isArray(npcs)) return fail("npcs is not a list");
  const seen = new Set<string>();
  for (const npc of npcs as NpcData[]) {
    if (typeof npc.id !== "string" || npc.id.length === 0) fail(`an npc has no id`);
    else if (seen.has(npc.id)) fail(`npc id ${npc.id} is used twice`);
    else seen.add(npc.id);
    if (!NPC_KINDS.includes(npc.kind as NpcKind)) fail(`npc ${npc.id}: kind ${npc.kind} is unknown`);
    if (npc.kind === "vendor" && (typeof npc.vendor !== "string" || !KEBAB.test(npc.vendor))) fail(`vendor ${npc.id} names no vendor id`);
    if (npc.kind !== "vendor" && npc.vendor !== undefined) fail(`npc ${npc.id} is not a vendor but names one`);
    if (npc.kind === "waystone" && (typeof npc.tower !== "string" || !KEBAB.test(npc.tower))) fail(`waystone ${npc.id} names no tower`);
    if (npc.text !== undefined && (!Array.isArray(npc.text) || npc.text.some((line) => typeof line !== "string"))) fail(`npc ${npc.id}: text is a list of lines`);
    const h = hex(npc.q, npc.r);
    if (!on(h)) fail(`npc ${npc.id} is off its tiles`);
    else if (open(h)) fail(`${npc.kind} ${npc.id} at ${key(h)} stands on an open hex: its tile is blocked`);
    else if (!neighbors(h).some(beside)) fail(`${npc.kind} ${npc.id} has no open hex beside it`);
  }
}

/** Everything wrong with a chunk file on its own, as sentences; empty for a good one. */
export function validateChunk(data: unknown): string[] {
  const problems: string[] = [];
  const fail = (text: string) => problems.push(text);
  if (typeof data !== "object" || data === null) return ["a chunk is a JSON object"];
  const c = data as ChunkData;
  if (!isInt(c.cq) || !isInt(c.cr) || c.cq < 0 || c.cr < 0 || c.cq >= CHUNKS || c.cr >= CHUNKS) return [`chunk ${String(c.cq)}_${String(c.cr)} is not a chunk of the world`];
  for (const field of ["props", "doors", "npcs", "spawns", "chests", "entrances"] as const) if (!Array.isArray(c[field])) fail(`${field} is not a list`);
  if (problems.length > 0) return problems;
  const q0 = c.cq * CHUNK;
  const r0 = c.cr * CHUNK;
  const ours = (q: number, r: number) => q >= q0 && q < q0 + CHUNK && r >= r0 && r < r0 + CHUNK;
  const { tiles, open } = checkTiles(c.tiles, fail, ours);
  if (tiles.size !== CHUNK * CHUNK) fail(`a chunk has ${CHUNK * CHUNK} tiles, not ${tiles.size}`);
  const on = (h: Hex) => tiles.has(key(h));
  checkProps(c.props, fail, on);
  // A person on the chunk's edge may be reached from the next chunk: the world lint checks that.
  checkNpcs(c.npcs, fail, on, open, (h) => !on(h) || open(h));
  const taken = new Map<string, string>();
  const place = (what: string, q: number, r: number, mustBeOpen: boolean | null) => {
    const h = hex(q, r);
    if (!isInt(q) || !isInt(r) || !on(h)) return fail(`${what} at ${q},${r} is off the chunk`);
    if (mustBeOpen === true && !open(h)) fail(`${what} at ${key(h)} is blocked`);
    if (mustBeOpen === false && open(h)) fail(`${what} at ${key(h)} stands on an open hex: its tile is blocked`);
    const other = taken.get(key(h));
    if (other) fail(`${what} and ${other} share ${key(h)}`);
    taken.set(key(h), what);
  };
  for (const door of c.doors) {
    if (typeof door.interior !== "string" || !KEBAB.test(door.interior)) fail(`door at ${door.q},${door.r} names no interior`);
    place(`door to ${door.interior}`, door.q, door.r, true);
  }
  for (const entrance of c.entrances) {
    if (typeof entrance.dungeon !== "string" || !KEBAB.test(entrance.dungeon)) fail(`entrance at ${entrance.q},${entrance.r} names no dungeon`);
    place(`entrance to ${entrance.dungeon}`, entrance.q, entrance.r, true);
  }
  const prefix = `${chunkKey(c.cq, c.cr)}:`;
  const ids = new Set<string>();
  for (const spawn of c.spawns) {
    if (typeof spawn.id !== "string" || !spawn.id.startsWith(prefix)) fail(`spawn id ${String(spawn.id)} is not "${prefix}<n>"`);
    else if (ids.has(spawn.id)) fail(`spawn id ${spawn.id} is used twice`);
    ids.add(spawn.id);
    if (!Array.isArray(spawn.mobs) || spawn.mobs.length === 0) fail(`spawn ${spawn.id} has no mobs`);
    else for (const mob of spawn.mobs) if (typeof mob !== "string" || !KEBAB.test(mob)) fail(`spawn ${spawn.id}: mob ${String(mob)} is not an id`);
    if (!isInt(spawn.radius) || spawn.radius < 0) fail(`spawn ${spawn.id}: radius is a whole number`);
    if (!isInt(spawn.respawnSeconds) || spawn.respawnSeconds < 1) fail(`spawn ${spawn.id}: respawnSeconds is a positive whole number`);
    if (!isInt(spawn.tier) || spawn.tier < 1 || spawn.tier > MAX_TIER) fail(`spawn ${spawn.id}: tier is 1 to ${MAX_TIER}`);
    place(`spawn ${spawn.id}`, spawn.q, spawn.r, true);
  }
  for (const chest of c.chests) {
    if (typeof chest.id !== "string" || !chest.id.startsWith(prefix)) fail(`chest id ${String(chest.id)} is not "${prefix}<n>"`);
    else if (ids.has(chest.id)) fail(`chest id ${chest.id} is used twice`);
    ids.add(chest.id);
    const [low, high] = Array.isArray(chest.gold) ? chest.gold : [];
    if (!isInt(low) || !isInt(high) || low < 0 || high < low) fail(`chest ${chest.id}: gold is [low, high]`);
    if (!isInt(chest.respawnSeconds) || chest.respawnSeconds < 1) fail(`chest ${chest.id}: respawnSeconds is a positive whole number`);
    place(`chest ${chest.id}`, chest.q, chest.r, false);
  }
  return problems;
}

/** Everything wrong with an interior on its own: its shape, and that everything in it is reached from its door. */
export function validateInterior(data: unknown): string[] {
  const problems: string[] = [];
  const fail = (text: string) => problems.push(text);
  if (typeof data !== "object" || data === null) return ["an interior is a JSON object"];
  const room = data as InteriorData;
  if (typeof room.id !== "string" || !KEBAB.test(room.id)) fail("id is not kebab-case");
  if (typeof room.name !== "string" || room.name.length === 0) fail("name is missing");
  if (!INTERIOR_KINDS.includes(room.kind)) fail(`kind ${String(room.kind)} is not one of ${INTERIOR_KINDS.join(", ")}`);
  if (typeof room.town !== "string" || !KEBAB.test(room.town)) fail("town is not an id");
  if (!STYLES.includes(room.style)) fail(`style ${String(room.style)} is unknown`);
  if (!room.exit || !isInt(room.exit.q) || !isInt(room.exit.r)) fail("exit is not a hex");
  if (!room.entry || !isInt(room.entry.q) || !isInt(room.entry.r)) fail("entry is not a hex");
  if (problems.length > 0) return problems;
  const { tiles, open } = checkTiles(room.tiles, fail, (q, r) => Math.abs(q) <= 24 && Math.abs(r) <= 24);
  const on = (h: Hex) => tiles.has(key(h));
  checkProps(room.props, fail, on);
  checkNpcs(room.npcs, fail, on, open);
  const entry = hex(room.entry.q, room.entry.r);
  if (!open(entry)) return [...problems, "the entry is not an open hex"];
  const reached = reach(entry, open);
  for (const npc of room.npcs ?? []) {
    if (!neighbors(hex(npc.q, npc.r)).some((n) => reached.has(key(n)))) fail(`${npc.kind} ${npc.id} cannot be walked to from the door`);
  }
  const unreached = [...tiles.values()].filter((t) => t[4] === 0 && !reached.has(`${t[0]},${t[1]}`));
  if (unreached.length > 0) fail(`${unreached.length} open hexes cannot be walked to from the door (${unreached[0]![0]},${unreached[0]![1]})`);
  if (!neighbors(entry).some((n) => open(n))) fail("nobody can step in from the door");
  return problems;
}

/** Everything wrong with a dungeon definition on its own. */
export function validateDungeon(data: unknown): string[] {
  const problems: string[] = [];
  const fail = (text: string) => problems.push(text);
  if (typeof data !== "object" || data === null) return ["a dungeon is a JSON object"];
  const d = data as DungeonData;
  if (typeof d.id !== "string" || !KEBAB.test(d.id)) fail("id is not kebab-case");
  if (typeof d.name !== "string" || d.name.length === 0) fail("name is missing");
  if (!THEMES.includes(d.theme)) fail(`theme ${String(d.theme)} is not one of ${THEMES.join(", ")}`);
  if (!Array.isArray(d.entrance) || !isInt(d.entrance[0]) || !isInt(d.entrance[1]) || !inWorld(hex(d.entrance[0], d.entrance[1]))) fail("entrance is not a hex of the world");
  if (d.requires !== undefined && (typeof d.requires !== "string" || d.requires.length === 0 || !/^W?U?B?R?G?$/.test(d.requires))) fail(`requires ${String(d.requires)} is not colors' letters in WUBRG order`);
  const range = (name: string, v: unknown, low: number, high: number) => {
    if (!Array.isArray(v) || !isInt(v[0]) || !isInt(v[1]) || v[0] < low || v[1] < v[0] || v[1] > high) fail(`${name} is [min, max] from ${low} to ${high}`);
  };
  range("floors", d.floors, 1, 6);
  range("encounters", d.encounters, 0, 12);
  if (!isInt(d.tier) || d.tier < 1 || d.tier > MAX_TIER) fail(`tier is 1 to ${MAX_TIER}`);
  const lists = Array.isArray(d.mobs) && d.mobs.length > 0 && Array.isArray(d.mobs[0]) ? (d.mobs as string[][]) : [d.mobs as string[]];
  if (!Array.isArray(d.mobs) || lists.some((l) => !Array.isArray(l) || l.length === 0 || l.some((m) => typeof m !== "string" || !KEBAB.test(m)))) fail("mobs is a list of mob ids, or a list of them per floor");
  for (const [name, id] of [["warden", d.warden], ["boss", d.boss]] as const) if (typeof id !== "string" || !KEBAB.test(id)) fail(`${name} is not a mob id`);
  if (d.region !== undefined && !REGIONS.includes(d.region)) fail(`region ${String(d.region)} is not a color`);
  if (d.waystone !== undefined && (d.waystone !== true || d.theme !== "tower")) fail("only a tower has a waystone");
  if (d.waystone && !(Array.isArray(d.arrival) && isInt(d.arrival[0]) && isInt(d.arrival[1]))) fail("a waystone tower names where travel to it arrives");
  return problems;
}

/** The hexes reached on foot from `from`. */
export function reach(from: Hex, open: (h: Hex) => boolean): Set<string> {
  const reached = new Set<string>([key(from)]);
  const queue: Hex[] = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbors(queue[i]!)) {
      if (open(next) && !reached.has(key(next))) {
        reached.add(key(next));
        queue.push(next);
      }
    }
  }
  return reached;
}
