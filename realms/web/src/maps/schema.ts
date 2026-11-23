// A map as data (realms/content/<plane>/maps/<id>.json; realms/docs/interfaces.md, "Maps"): what the generator and
// the map editor write, what the overworld walks and draws, and what the realm server checks spawns, chests and paths
// against. `validateMap` is the content lint every map file passes (maps.test.ts).

import { type Hex, distance, hex, key, neighbors } from "../hex";

export const MAP_KINDS = ["town", "village", "wilderness", "dungeon", "world"] as const;
export type MapKind = (typeof MAP_KINDS)[number];

export const REGIONS = ["W", "U", "B", "R", "G"] as const;
export type Region = (typeof REGIONS)[number];

/** Ground a hex can be: local maps' and the world map's. */
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
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** People and places to use in a map: an inn to rest and respawn at, a spell table, vendors, an armorer... */
export const NPC_KINDS = ["inn", "spell-table", "vendor", "armorer", "quest-board", "arena", "townsfolk"] as const;
export type NpcKind = (typeof NPC_KINDS)[number];

/** A tile on the wire: `[q, r, height, terrain, blocked]`. */
export type TileData = readonly [number, number, number, string, number];

export interface PropData {
  readonly q: number;
  readonly r: number;
  readonly kind: string;
}

export interface ExitData {
  readonly q: number;
  readonly r: number;
  /** A map id, or "world" for the world map's travel screen. */
  readonly to: string;
}

export interface SpawnData {
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly mobs: readonly string[];
  /** How far from its spawn point the mob wanders. */
  readonly radius: number;
  readonly respawnSeconds: number;
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
  /** What the overworld calls them: "Grizzlegom", "The Laughing Wurm". */
  readonly name?: string;
  /** What they say when spoken to; a quest board's notices. One line each. */
  readonly text?: readonly string[];
}

/** On the world map: where travel may be interrupted, and the small map an encounter there is fought on. */
export interface EncounterZoneData {
  readonly q: number;
  readonly r: number;
  readonly radius: number;
  /** The encounter map's id: its spawn is the mob. */
  readonly map: string;
  /** The chance of an encounter on each hex travelled off the roads; on a road it is a third of this. */
  readonly chance: number;
}

/** An inn: a hex of this map, or of the map `map` names. */
export interface InnData {
  readonly q: number;
  readonly r: number;
  readonly map?: string;
}

export interface MapData {
  readonly id: string;
  readonly name: string;
  readonly kind: MapKind;
  readonly region?: Region;
  /** A dungeon's floor, from 1 at the entrance. */
  readonly floor?: number;
  readonly radius: number;
  readonly tiles: readonly TileData[];
  readonly props: readonly PropData[];
  readonly exits: readonly ExitData[];
  readonly spawns: readonly SpawnData[];
  readonly chests: readonly ChestData[];
  readonly npcs: readonly NpcData[];
  /**
   * Where a character who loses a duel here wakes: a town's or village's own open hex, or, on any other map, its nearest
   * town's or village's on the world map (`map` names it), which the map generator writes (scripts/maps.ts, graph.ts).
   * Every map but the world map names one.
   */
  readonly inn?: InnData;
  /** The world map's encounter zones. */
  readonly encounters?: readonly EncounterZoneData[];
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/**
 * Everything wrong with a map, as sentences; empty for a good one. `maps` is every map id there is, for checking
 * exits; without it exits are not followed. Checks the shapes of every field, that every hex named is on the map,
 * that people and things stand where they can be reached, and that every exit, chest, spawn and person can be walked
 * to from where a player arrives.
 */
export function validateMap(data: unknown, maps?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const fail = (text: string) => problems.push(text);
  if (typeof data !== "object" || data === null) return ["a map is a JSON object"];
  const m = data as Partial<Record<keyof MapData, unknown>>;

  if (typeof m.id !== "string" || !KEBAB.test(m.id)) fail("id is not kebab-case");
  if (typeof m.name !== "string" || m.name.length === 0) fail("name is missing");
  if (!MAP_KINDS.includes(m.kind as MapKind)) fail(`kind ${String(m.kind)} is not one of ${MAP_KINDS.join(", ")}`);
  if (m.region !== undefined && !REGIONS.includes(m.region as Region)) fail(`region ${String(m.region)} is not a color`);
  if (m.kind === "dungeon" && !(isInt(m.floor) && m.floor >= 1)) fail("a dungeon floor needs floor >= 1");
  if (m.kind !== "dungeon" && m.floor !== undefined) fail("only a dungeon has a floor");
  if (!isInt(m.radius) || m.radius < 2 || m.radius > 64) fail("radius is not a whole number from 2 to 64");
  for (const field of ["tiles", "props", "exits", "spawns", "chests", "npcs"] as const) {
    if (!Array.isArray(m[field])) fail(`${field} is not a list`);
  }
  if (problems.length > 0) return problems;
  const map = data as MapData;

  // Tiles: inside the radius, each hex once, a known terrain.
  const tiles = new Map<string, TileData>();
  for (const tile of map.tiles) {
    if (!Array.isArray(tile) || tile.length !== 5) {
      fail(`tile ${JSON.stringify(tile)} is not [q, r, height, terrain, blocked]`);
      continue;
    }
    const [q, r, height, terrain, blocked] = tile;
    const at = `tile ${q},${r}`;
    if (!isInt(q) || !isInt(r)) fail(`${at}: q and r are whole numbers`);
    else if (distance(hex(q, r), hex(0, 0)) > map.radius) fail(`${at} is outside the radius`);
    if (typeof height !== "number" || !Number.isFinite(height) || Math.abs(height) > 16) fail(`${at}: height is not a number from -16 to 16`);
    if (!TERRAINS.includes(terrain as Terrain)) fail(`${at}: terrain ${terrain} is unknown`);
    if (blocked !== 0 && blocked !== 1) fail(`${at}: blocked is 0 or 1`);
    if (tiles.has(`${q},${r}`)) fail(`${at} is listed twice`);
    tiles.set(`${q},${r}`, tile);
  }
  const open = (h: Hex) => tiles.get(key(h))?.[4] === 0;
  const onMap = (h: Hex) => tiles.has(key(h));
  const where = (what: string, p: { q: unknown; r: unknown }): Hex | null => {
    if (!isInt(p.q) || !isInt(p.r)) {
      fail(`${what}: q and r are whole numbers`);
      return null;
    }
    const h = hex(p.q, p.r);
    if (!onMap(h)) {
      fail(`${what} at ${key(h)} is off the map`);
      return null;
    }
    return h;
  };
  const ids = (what: string, list: readonly { id: unknown }[]) => {
    const seen = new Set<string>();
    for (const item of list) {
      if (typeof item.id !== "string" || !KEBAB.test(item.id)) fail(`${what} id ${String(item.id)} is not kebab-case`);
      else if (seen.has(item.id)) fail(`${what} id ${item.id} is used twice`);
      else seen.add(item.id);
    }
  };

  // Where a player can stand and must be able to walk to.
  const goals: { what: string; stand: Hex[] }[] = [];
  const reachableFrom = (h: Hex) => [h, ...neighbors(h)].filter(open);

  for (const prop of map.props) {
    if (!PROP_KINDS.includes(prop.kind as PropKind)) fail(`prop ${prop.kind} is unknown`);
    where(`prop ${prop.kind}`, prop);
  }

  const arrivals: Hex[] = [];
  for (const exit of map.exits) {
    const h = where(`exit to ${exit.to}`, exit);
    if (typeof exit.to !== "string" || exit.to.length === 0) fail("an exit has no destination");
    else if (exit.to !== "world" && maps && !maps.has(exit.to)) fail(`exit to ${exit.to}: no such map`);
    if (exit.to === map.id) fail("an exit leads back into its own map");
    if (h) {
      if (map.kind !== "world" && !open(h)) fail(`exit to ${exit.to} at ${key(h)} is blocked`);
      if (map.kind !== "world") arrivals.push(h);
      goals.push({ what: `exit to ${exit.to}`, stand: reachableFrom(h) });
    }
  }
  if (map.kind !== "world" && map.exits.length === 0) fail("a map needs a way out");

  ids("spawn", map.spawns);
  for (const spawn of map.spawns) {
    const h = where(`spawn ${spawn.id}`, spawn);
    if (!Array.isArray(spawn.mobs) || spawn.mobs.length === 0) fail(`spawn ${spawn.id} has no mobs`);
    else for (const mob of spawn.mobs) if (typeof mob !== "string" || !KEBAB.test(mob)) fail(`spawn ${spawn.id}: mob ${String(mob)} is not an id`);
    if (!isInt(spawn.radius) || spawn.radius < 0) fail(`spawn ${spawn.id}: radius is a whole number`);
    if (!isInt(spawn.respawnSeconds) || spawn.respawnSeconds < 1) fail(`spawn ${spawn.id}: respawnSeconds is a positive whole number`);
    if (h) {
      if (!open(h)) fail(`spawn ${spawn.id} at ${key(h)} is blocked`);
      goals.push({ what: `spawn ${spawn.id}`, stand: reachableFrom(h) });
    }
  }

  ids("chest", map.chests);
  for (const chest of map.chests) {
    const h = where(`chest ${chest.id}`, chest);
    const [low, high] = Array.isArray(chest.gold) ? chest.gold : [];
    if (!isInt(low) || !isInt(high) || low < 0 || high < low) fail(`chest ${chest.id}: gold is [low, high]`);
    if (!isInt(chest.respawnSeconds) || chest.respawnSeconds < 1) fail(`chest ${chest.id}: respawnSeconds is a positive whole number`);
    if (h) {
      if (open(h)) fail(`chest ${chest.id} at ${key(h)} stands on an open hex: its tile is blocked`);
      goals.push({ what: `chest ${chest.id}`, stand: neighbors(h).filter(open) });
    }
  }

  ids("npc", map.npcs);
  for (const npc of map.npcs) {
    const h = where(`${npc.kind} ${npc.id}`, npc);
    if (!NPC_KINDS.includes(npc.kind as NpcKind)) fail(`npc ${npc.id}: kind ${npc.kind} is unknown`);
    if (npc.kind === "vendor" && (typeof npc.vendor !== "string" || !KEBAB.test(npc.vendor))) fail(`vendor ${npc.id} names no vendor id`);
    if (npc.kind !== "vendor" && npc.vendor !== undefined) fail(`npc ${npc.id} is not a vendor but names one`);
    if (npc.text !== undefined && (!Array.isArray(npc.text) || npc.text.some((line) => typeof line !== "string"))) fail(`npc ${npc.id}: text is a list of lines`);
    if (h) {
      if (open(h)) fail(`${npc.kind} ${npc.id} at ${key(h)} stands on an open hex: its tile is blocked`);
      goals.push({ what: `${npc.kind} ${npc.id}`, stand: neighbors(h).filter(open) });
    }
  }

  const kinds = new Set(map.npcs.map((n) => n.kind));
  const settlement = map.kind === "town" || map.kind === "village";
  if (settlement) {
    for (const needed of ["inn", "spell-table"] as const) if (!kinds.has(needed)) fail(`a ${map.kind} needs a ${needed}`);
  }
  if (map.kind === "town") {
    for (const needed of ["vendor", "armorer", "quest-board"] as const) if (!kinds.has(needed)) fail(`a town needs a ${needed}`);
  }
  if (map.kind === "world") {
    if (map.inn !== undefined) fail("the world map names no inn");
  } else if (!map.inn) {
    fail(settlement ? `a ${map.kind} needs an inn to respawn at` : "a map names the inn a beaten player wakes at");
  } else if (map.inn.map === undefined) {
    if (!settlement) fail("only a town's or village's inn is on its own map; any other map's names the town's");
    const h = where("inn", map.inn);
    if (h && !open(h)) fail(`the inn's respawn hex ${key(h)} is blocked`);
    if (h) arrivals.push(h);
  } else {
    if (settlement) fail(`a ${map.kind}'s inn is its own`);
    if (typeof map.inn.map !== "string" || map.inn.map === map.id) fail("the inn's map is another map's id");
    else if (maps && !maps.has(map.inn.map)) fail(`the inn is on ${map.inn.map}: no such map`);
    if (!isInt(map.inn.q) || !isInt(map.inn.r)) fail("inn: q and r are whole numbers");
  }

  if (map.kind === "world") {
    for (const zone of map.encounters ?? []) {
      where(`encounter zone ${zone.map}`, zone);
      if (maps && !maps.has(zone.map)) fail(`encounter zone: no map ${zone.map}`);
      if (!(zone.chance >= 0 && zone.chance <= 1)) fail(`encounter zone ${zone.map}: chance is from 0 to 1`);
    }
  } else if (map.encounters !== undefined) {
    fail("only the world map has encounter zones");
  }

  // Everything must be reachable on foot from where a player arrives. The world map is travelled, not walked.
  if (map.kind !== "world" && arrivals.length > 0) {
    const from = arrivals[0]!;
    const reached = new Set<string>([key(from)]);
    const queue: Hex[] = [from];
    for (let h = queue.shift(); h; h = queue.shift()) {
      for (const next of neighbors(h)) {
        if (open(next) && !reached.has(key(next))) {
          reached.add(key(next));
          queue.push(next);
        }
      }
    }
    for (const arrival of arrivals.slice(1)) {
      if (!reached.has(key(arrival))) fail(`${key(arrival)} cannot be walked to from ${key(from)}`);
    }
    for (const goal of goals) {
      if (goal.stand.length === 0) fail(`${goal.what} has no open hex to stand on beside it`);
      else if (!goal.stand.some((h) => reached.has(key(h)))) fail(`${goal.what} cannot be walked to`);
    }
  }
  return problems;
}
