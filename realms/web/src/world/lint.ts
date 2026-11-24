import {
  BARE,
  RAMP,
  BLOCKED,
  CHUNK,
  type ChunkData,
  INTERIOR_KINDS,
  type InteriorData,
  NO_SURFACE,
  NPC_KINDS,
  type PropData,
  type BuildingData,
  REGIONS,
  type Rect,
  TILE,
  type TileData,
  type WorldData,
  chunkKey,
  chunkTile,
  inRect,
  OBJECT_KINDS,
  interiorArea,
  interiorTile,
  isBlocked,
  worldRect,
  type DungeonData,
  MAX_TIER,
  type NpcData,
  inTown,
  tierAt,
  townAt,
  type TownData,
  type XZ,
  PLACE_KINDS,
  LEDGE,
} from "./format";
import { type Ground, canStep } from "./grid";
import { inSquare, streetTiles, wayPoints } from "./streets";

// The world's lint, in two parts. Per file (`checkWorld`, `checkChunk`, `checkInterior`): each file is what the format
// says - its fields there and of their kinds, a chunk's 1,024 tiles, everything in it inside it. The loader runs these on
// every file it reads. Of the whole (`lintWorld`): ids unique, every door leading to an interior there is and every
// interior back out onto an open tile, every surface, prop, building style, room kind and figure one the art has (the
// caller passes what it has: this module stays free of three.js), and each prop's args as its recipe wants them.

type Problems = string[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isXZ = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isXYZ = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isRect = (v: unknown): v is Rect => Array.isArray(v) && v.length === 4 && v.every(isInt) && v[2]! > v[0]! && v[3]! > v[1]!;
const ID = /^[a-z0-9][a-z0-9_:-]*$/;

function need(out: Problems, where: string, o: Record<string, unknown>, key: string, ok: (v: unknown) => boolean, what: string): void {
  if (!ok(o[key])) out.push(`${where}: ${key} should be ${what}`);
}
function may(out: Problems, where: string, o: Record<string, unknown>, key: string, ok: (v: unknown) => boolean, what: string): void {
  if (o[key] !== undefined && !ok(o[key])) out.push(`${where}: ${key} should be ${what}`);
}

/** A tile on the wire: [height (whole texels), surface id or "", flags 0-3]. */
function checkTile(t: unknown): boolean {
  return Array.isArray(t) && t.length === 3 && isInt(t[0]) && isStr(t[1]) && isInt(t[2]) && t[2] >= 0 && t[2] <= (BLOCKED | BARE | RAMP);
}

function checkTiles(out: Problems, where: string, tiles: unknown, count: number): void {
  if (!Array.isArray(tiles)) return void out.push(`${where}: tiles should be a list`);
  if (tiles.length !== count) out.push(`${where}: ${tiles.length} tiles, not ${count}`);
  const bad = tiles.findIndex((t) => !checkTile(t));
  if (bad >= 0) out.push(`${where}: tile ${bad} should be [height (texels), surface, flags 0-7], not ${JSON.stringify(tiles[bad])}`);
}

function checkProps(out: Problems, where: string, props: unknown, inside: (x: number, z: number) => boolean): void {
  if (!Array.isArray(props)) return void out.push(`${where}: props should be a list`);
  props.forEach((p, i) => {
    const w = `${where}: props[${i}]`;
    if (!isObject(p)) return void out.push(`${w} should be an object`);
    need(out, w, p, "id", isStr, "a prop id");
    need(out, w, p, "x", isNum, "a number");
    need(out, w, p, "z", isNum, "a number");
    for (const k of ["y", "turn", "scale", "seed"]) may(out, w, p, k, isNum, "a number");
    may(out, w, p, "rot", (v) => isInt(v) && (v as number) >= 0 && (v as number) <= 3, "0 to 3");
    may(out, w, p, "tint", isStr, "a palette name");
    may(out, w, p, "args", isObject, "an object");
    if (isNum(p.x) && isNum(p.z) && !inside(Math.floor(p.x), Math.floor(p.z))) out.push(`${w} (${p.id}) stands at ${p.x},${p.z}, outside`);
  });
}

function checkNpcs(out: Problems, where: string, npcs: unknown, inside: (x: number, z: number) => boolean): void {
  if (!Array.isArray(npcs)) return void out.push(`${where}: npcs should be a list`);
  npcs.forEach((n, i) => {
    const w = `${where}: npcs[${i}]`;
    if (!isObject(n)) return void out.push(`${w} should be an object`);
    need(out, w, n, "id", (v) => isStr(v) && ID.test(v), "an id (lower case, digits, - _ :)");
    need(out, w, n, "x", isInt, "a whole tile");
    need(out, w, n, "z", isInt, "a whole tile");
    need(out, w, n, "kind", (v) => (NPC_KINDS as readonly unknown[]).includes(v), `one of ${NPC_KINDS.join(", ")}`);
    for (const k of ["name", "vendor", "tower", "ferry", "figure", "palette"]) may(out, w, n, k, isStr, "a string");
    for (const k of ["speed", "seed"]) may(out, w, n, k, isNum, "a number");
    may(out, w, n, "stand", isXYZ, "[x, y, z]");
    may(out, w, n, "behaviour", isObject, "an object");
    if (isInt(n.x) && isInt(n.z) && !inside(n.x, n.z)) out.push(`${w} (${n.id}) stands at ${n.x},${n.z}, outside`);
  });
}

function checkLights(out: Problems, where: string, lights: unknown): void {
  if (lights === undefined) return;
  if (!Array.isArray(lights)) return void out.push(`${where}: lights should be a list`);
  lights.forEach((l, i) => {
    const w = `${where}: lights[${i}]`;
    if (!isObject(l)) return void out.push(`${w} should be an object`);
    need(out, w, l, "kind", (v) => v === "point" || v === "spot", "point or spot");
    need(out, w, l, "at", isXYZ, "[x, y, z]");
    need(out, w, l, "color", isXYZ, "[r, g, b]");
    need(out, w, l, "intensity", isNum, "a number");
    need(out, w, l, "reach", isNum, "a number");
    may(out, w, l, "to", isXYZ, "[x, y, z]");
    may(out, w, l, "flicker", (f) => isObject(f) && isNum(f.base) && isNum(f.rate) && Array.isArray(f.steps) && f.steps.every(isNum), "{base, steps, rate, phase?}");
  });
}

/** world.json, as a file. */
export function checkWorld(data: unknown): Problems {
  const out: Problems = [];
  if (!isObject(data)) return ["world.json should be an object"];
  const w = "world.json";
  need(out, w, data, "size", (v) => isXZ(v) && v.every((n) => isInt(n) && n > 0), "[width, height], whole tiles");
  may(out, w, data, "origin", (v) => isXZ(v) && v.every(isInt), "[x, z], whole tiles");
  need(out, w, data, "chunk", (v) => v === CHUNK, String(CHUNK));
  need(out, w, data, "tile", (v) => v === TILE, String(TILE));
  may(out, w, data, "bounds", isRect, "[x0, z0, x1, z1], whole tiles");
  for (const k of ["regions", "towns", "inns", "dungeons", "roads", "ferries", "pitches"]) need(out, w, data, k, Array.isArray, "a list");
  need(out, w, data, "zones", isObject, "the tier zones");
  need(out, w, data, "overview", isObject, "the overview");
  if (out.length > 0) return out;
  const world = data as unknown as WorldData;
  const rect = worldRect(world);
  if (world.bounds && !(world.bounds[0] >= rect[0] && world.bounds[1] >= rect[1] && world.bounds[2] <= rect[2] && world.bounds[3] <= rect[3])) {
    out.push(`${w}: bounds reach past the world`);
  }
  world.regions.forEach((r, i) => {
    if (!(REGIONS as readonly string[]).includes(r.color)) out.push(`${w}: regions[${i}].color should be one of ${REGIONS.join("")}`);
  });
  world.towns.forEach((t, i) => {
    if (!isStr(t.id) || !isXZ(t.center) || !isNum(t.radius)) out.push(`${w}: towns[${i}] should have an id, a center [x, z] and a radius`);
  });
  world.inns.forEach((n, i) => {
    if (!isInt(n.x) || !isInt(n.z) || !isStr(n.interior)) out.push(`${w}: inns[${i}] should have x, z and its interior`);
  });
  return out;
}

/** A chunk file: chunk (cx, cz)'s tiles and what stands on them, all inside it. */
export function checkChunk(data: unknown, cx: number, cz: number): Problems {
  const out: Problems = [];
  const w = `chunk ${chunkKey(cx, cz)}`;
  if (!isObject(data)) return [`${w} should be an object`];
  if (data.cx !== cx || data.cz !== cz) out.push(`${w}: says it is ${String(data.cx)}_${String(data.cz)}`);
  checkTiles(out, w, data.tiles, CHUNK * CHUNK);
  const inside = (x: number, z: number) => Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz;
  checkProps(out, w, data.props, inside);
  checkNpcs(out, w, data.npcs, inside);
  checkLights(out, w, data.lights);
  if (!Array.isArray(data.buildings)) out.push(`${w}: buildings should be a list`);
  else {
    data.buildings.forEach((b, i) => {
      const bw = `${w}: buildings[${i}]`;
      if (!isObject(b)) return void out.push(`${bw} should be an object`);
      need(out, bw, b, "id", (v) => isStr(v) && ID.test(v), "an id");
      need(out, bw, b, "style", isStr, "a building style");
      may(out, bw, b, "kind", isStr, "a kind");
      for (const k of ["x", "z"]) need(out, bw, b, k, isNum, "a number");
      for (const k of ["w", "d"]) need(out, bw, b, k, (v) => isNum(v) && v > 0, "a size");
      need(out, bw, b, "rot", (v) => isInt(v) && v >= 0 && v <= 3, "0 to 3");
      may(out, bw, b, "door", (v) => isXZ(v) && v.every(isInt), "[x, z], a tile");
      may(out, bw, b, "interior", isStr, "an interior id");
      may(out, bw, b, "params", isObject, "an object");
      if (isNum(b.x) && isNum(b.z) && !inside(Math.floor(b.x), Math.floor(b.z))) out.push(`${bw} (${b.id}) stands at ${b.x},${b.z}, outside`);
      if (b.interior !== undefined && b.door === undefined) out.push(`${bw} (${b.id}) leads into ${b.interior} with no door`);
    });
  }
  for (const k of ["spawns", "chests", "entrances", "waymarkers"]) {
    const list = data[k];
    if (!Array.isArray(list)) {
      out.push(`${w}: ${k} should be a list`);
      continue;
    }
    list.forEach((e, i) => {
      if (!isObject(e) || !isInt(e.x) || !isInt(e.z)) return void out.push(`${w}: ${k}[${i}] should stand on a tile (x, z)`);
      if (!inside(e.x, e.z)) out.push(`${w}: ${k}[${i}] stands at ${e.x},${e.z}, outside`);
      if (k === "spawns" && !(isStr(e.id) && e.id.startsWith(`${chunkKey(cx, cz)}:`))) out.push(`${w}: spawns[${i}].id should be "${chunkKey(cx, cz)}:<n>"`);
    });
  }
  return out;
}

/** An interior file. */
export function checkInterior(data: unknown, id: string): Problems {
  const out: Problems = [];
  const w = `interior ${id}`;
  if (!isObject(data)) return [`${w} should be an object`];
  need(out, w, data, "id", (v) => v === id, `"${id}", its file's name`);
  need(out, w, data, "name", isStr, "a name");
  need(out, w, data, "kind", (v) => (INTERIOR_KINDS as readonly unknown[]).includes(v), `one of ${INTERIOR_KINDS.join(", ")}`);
  need(out, w, data, "style", isStr, "a style");
  need(out, w, data, "w", (v) => isInt(v) && v > 0, "whole tiles");
  need(out, w, data, "d", (v) => isInt(v) && v > 0, "whole tiles");
  may(out, w, data, "area", isRect, "[x0, z0, x1, z1], whole tiles");
  need(out, w, data, "entry", (v) => isXZ(v) && v.every(isInt), "[x, z], a tile");
  need(out, w, data, "exit", (v) => isXZ(v) && v.every(isInt), "[x, z], a world tile");
  if (out.length > 0) return out;
  const room = data as unknown as InteriorData;
  const area = interiorArea(room);
  if (!(area[0] <= 0 && area[1] <= 0 && area[2] >= room.w && area[3] >= room.d)) out.push(`${w}: its area should hold its floor`);
  checkTiles(out, w, data.tiles, (area[2] - area[0]) * (area[3] - area[1]));
  const inside = (x: number, z: number) => inRect(area, x, z);
  // Furniture may stand against the walls round the area, as far as a tile out (a buttress at a corner).
  checkProps(out, w, data.props, (x, z) => inRect([area[0] - 1, area[1] - 1, area[2] + 1, area[3] + 1], x, z));
  checkNpcs(out, w, data.npcs, inside);
  checkLights(out, w, data.lights);
  if (out.length === 0) {
    const entry = interiorTile(room, room.entry[0], room.entry[1]);
    if (!entry || isBlocked(entry)) out.push(`${w}: its entry ${room.entry.join(",")} is not an open tile`);
    const inward = interiorTile(room, room.entry[0], room.entry[1] - 1);
    if (!inward || isBlocked(inward)) out.push(`${w}: the tile a step in from its entry is not open`);
  }
  return out;
}

/** What the art has, by kind: the lint checks the world names nothing else. */
export interface KnownArt {
  readonly surfaces: ReadonlySet<string>;
  readonly props: ReadonlySet<string>;
  readonly styles: ReadonlySet<string>;
  readonly rooms: ReadonlySet<string>;
  readonly figures: ReadonlySet<string>;
  readonly palettes: ReadonlySet<string>;
  /** A prop's own problems (its args), as its registry entry checks them. */
  readonly propProblems?: (p: PropData) => readonly string[];
  readonly buildingProblems?: (b: BuildingData) => readonly string[];
  /**
   * The tiles a placed prop covers and whether they refuse walking (art/props `tilesOf`). With `liquid`, the realm lint
   * finds every closed tile nothing drawn there closes (`lintRealm`, "Nothing closed unseen").
   */
  readonly propTiles?: (p: PropData) => { readonly tiles: readonly XZ[]; readonly blocks: boolean };
  /** Whether a surface is a liquid lying below its banks (art/surfaces, a `hole`): its tiles are seen to be water. */
  readonly liquid?: (surface: string) => boolean;
  /**
   * Given, an id the art does not have is named to it instead of being a problem: while the art is being built beside
   * the world, the world may name ids the art will have (the generator's placeholders, scripts/worldgen/ids.ts).
   */
  readonly onUnknown?: (kind: UnknownKind, id: string, where: string) => void;
}

/** The kinds of art id the lint looks up. */
export type UnknownKind = "surface" | "prop" | "style" | "room" | "figure" | "palette";

/**
 * A whole world: each file as `checkChunk` and `checkInterior` have it, and together - one chunk a place, ids unique,
 * doors and interiors leading each to the other onto open tiles, tiles past the world's edge never walked, NPCs on open
 * tiles, and (with `known`) every id the world names one the art has.
 */
export function lintWorld(world: WorldData, chunks: readonly ChunkData[], interiors: readonly InteriorData[], known?: KnownArt): Problems {
  const out: Problems = [...checkWorld(world)];
  const unknown = (kind: UnknownKind, id: string, where: string, problem: string) => {
    if (known?.onUnknown) known.onUnknown(kind, id, where);
    else out.push(`${where}: ${problem}`);
  };
  const rect = worldRect(world);
  const byKey = new Map<string, ChunkData>();
  for (const c of chunks) {
    const key = chunkKey(c.cx, c.cz);
    if (byKey.has(key)) out.push(`chunk ${key}: twice`);
    byKey.set(key, c);
    out.push(...checkChunk(c, c.cx, c.cz));
  }
  const rooms = new Map<string, InteriorData>();
  for (const r of interiors) {
    if (rooms.has(r.id)) out.push(`interior ${r.id}: twice`);
    rooms.set(r.id, r);
    out.push(...checkInterior(r, r.id));
  }
  if (out.length > 0) return out;

  const tileAt = (x: number, z: number): TileData | null => {
    const c = byKey.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return c ? chunkTile(c, x, z) : null;
  };
  const open = (x: number, z: number) => {
    const t = tileAt(x, z);
    return !!t && inRect(rect, x, z) && !isBlocked(t);
  };

  // Every tile of the world is in a chunk; past its edge, nothing is walked.
  for (let z = rect[1]; z < rect[3]; z += CHUNK) for (let x = rect[0]; x < rect[2]; x += CHUNK) {
    if (!byKey.has(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)))) out.push(`no chunk ${chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK))} for the world's tiles`);
  }
  for (const c of chunks) {
    c.tiles.forEach((t, i) => {
      const x = c.cx * CHUNK + (i % CHUNK);
      const z = c.cz * CHUNK + Math.floor(i / CHUNK);
      if (!inRect(rect, x, z) && !isBlocked(t)) out.push(`chunk ${chunkKey(c.cx, c.cz)}: tile ${x},${z} is past the world's edge and open`);
      if (known && t[1] !== NO_SURFACE && !known.surfaces.has(t[1])) unknown("surface", t[1], `chunk ${chunkKey(c.cx, c.cz)}: tile ${x},${z}`, `has no surface "${t[1]}"`);
    });
  }

  // Ids unique across the world.
  const seen = new Map<string, string>();
  const unique = (kind: string, id: string, where: string) => {
    const k = `${kind}:${id}`;
    if (seen.has(k)) out.push(`${where}: ${kind} id ${id} also at ${seen.get(k)}`);
    else seen.set(k, where);
  };
  for (const c of chunks) {
    const where = `chunk ${chunkKey(c.cx, c.cz)}`;
    for (const b of c.buildings) unique("building", b.id, where);
    for (const n of c.npcs) unique("npc", n.id, where);
    for (const s of c.spawns) unique("spawn", s.id, where);
    for (const s of c.chests) unique("chest", s.id, where);
  }
  for (const r of interiors) for (const n of r.npcs) unique("npc", n.id, `interior ${r.id}`);

  // Doors and interiors, each to the other, onto open tiles.
  const doorsInto = new Map<string, [number, number][]>();
  for (const c of chunks) {
    for (const b of c.buildings) {
      const where = `chunk ${chunkKey(c.cx, c.cz)}: building ${b.id}`;
      if (b.door && !open(b.door[0], b.door[1])) out.push(`${where}: its door ${b.door.join(",")} is not an open tile`);
      if (b.interior) {
        if (!rooms.has(b.interior)) out.push(`${where}: no interior ${b.interior}`);
        if (b.door) doorsInto.set(b.interior, [...(doorsInto.get(b.interior) ?? []), [b.door[0], b.door[1]]]);
      }
      if (known && !known.styles.has(b.style)) unknown("style", b.style, where, `no building style ${b.style}`);
      else if (known?.buildingProblems) out.push(...known.buildingProblems(b).map((p) => `${where}: ${p}`));
      if (known && b.palette && !known.palettes.has(b.palette)) unknown("palette", b.palette, where, `no palette ${b.palette}`);
    }
  }
  for (const r of interiors) {
    const doors = doorsInto.get(r.id) ?? [];
    if (doors.length === 0) out.push(`interior ${r.id}: no door leads into it`);
    if (!doors.some(([x, z]) => x === r.exit[0] && z === r.exit[1])) out.push(`interior ${r.id}: its exit ${r.exit.join(",")} is not the door that leads in`);
    if (!open(r.exit[0], r.exit[1])) out.push(`interior ${r.id}: its exit ${r.exit.join(",")} is not an open world tile`);
    if (known && !known.rooms.has(r.kind)) unknown("room", r.kind, `interior ${r.id}`, `no room recipe for ${r.kind}`);
    if (known) {
      const a = interiorArea(r);
      r.tiles.forEach((t, i) => {
        if (t[1] !== NO_SURFACE && !known.surfaces.has(t[1])) unknown("surface", t[1], `interior ${r.id}: tile ${a[0] + (i % (a[2] - a[0]))},${a[1] + Math.floor(i / (a[2] - a[0]))}`, `has no surface "${t[1]}"`);
      });
    }
  }

  // NPCs on open tiles; props and figures the art has.
  const npcCheck = (where: string, n: ChunkData["npcs"][number], isOpen: (x: number, z: number) => boolean) => {
    if (!isOpen(n.x, n.z) && n.stand === undefined) out.push(`${where}: npc ${n.id} stands on a blocked tile ${n.x},${n.z}`);
    if (known && n.figure && !known.figures.has(n.figure)) unknown("figure", n.figure, `${where}: npc ${n.id}`, `no figure ${n.figure}`);
    if (known && n.palette && !known.palettes.has(n.palette)) unknown("palette", n.palette, `${where}: npc ${n.id}`, `no palette ${n.palette}`);
  };
  const propCheck = (where: string, p: PropData) => {
    if (!known) return;
    if (!known.props.has(p.id)) unknown("prop", p.id, where, `no prop ${p.id}`);
    else if (known.propProblems) out.push(...known.propProblems(p).map((m) => `${where}: ${m}`));
    if (p.tint && !known.palettes.has(p.tint)) unknown("palette", p.tint, `${where}: prop ${p.id}`, `no palette ${p.tint}`);
  };
  for (const c of chunks) {
    const where = `chunk ${chunkKey(c.cx, c.cz)}`;
    for (const n of c.npcs) npcCheck(where, n, open);
    for (const p of c.props) propCheck(where, p);
  }
  for (const r of interiors) {
    const where = `interior ${r.id}`;
    const isOpen = (x: number, z: number) => {
      const t = interiorTile(r, x, z);
      return !!t && !isBlocked(t);
    };
    for (const n of r.npcs) npcCheck(where, n, isOpen);
    for (const p of r.props) propCheck(where, p);
  }
  return out;
}

// --- The realm: the whole world as the game plays it ------------------------------------------------------------------

/** What the realm lint is told beyond the files: the art's ids, and the mob roster's tiers. */
export interface RealmOptions {
  readonly known?: KnownArt;
  /** Each mob's tier, by id: a spawn's mobs are of its tier, and every mob a spawn names is one. */
  readonly tiers?: ReadonlyMap<string, number>;
}

/**
 * A whole realm (interfaces.md, "The world, interiors and dungeons"), beyond `lintWorld`: the world is one walkable whole
 * from the first inn (every open tile reached, eight ways with no corner cut, the ferries' lanes included) and
 * everything in it is reached - inns, doors, entrances, spawns, pitches, docks, and beside every NPC, chest and
 * waymarker; nothing that is stood on stands on a blocked tile; every interior belongs to the town its door stands in;
 * every entrance has its dungeon where world.json and the dungeon say, its spell table beside it, a tower its waystone,
 * and an open step out; every spawn is of its zone's tier and of its mobs', and the tiers grow with distance from the
 * starting areas; waymarkers stand where the tier rises, in the harder side's tier; ferries' lanes are walks from dock
 * to dock with a ferryman at each; pitches stand open in their towns; spell tables are spell-table NPCs.
 */
export function lintRealm(world: WorldData, chunks: readonly ChunkData[], interiors: readonly InteriorData[], dungeons: readonly DungeonData[], options: RealmOptions = {}): Problems {
  const out: Problems = lintWorld(world, chunks, interiors, options.known);
  if (out.length > 0) return out;
  const rect = worldRect(world);
  const W = rect[2] - rect[0];
  const H = rect[3] - rect[1];
  const index = (x: number, z: number) => (z - rect[1]) * W + (x - rect[0]);
  const openTiles = new Uint8Array(W * H);
  const floors = new Int16Array(W * H);
  const ramps = new Uint8Array(W * H);
  for (const c of chunks) {
    c.tiles.forEach((t, k) => {
      const x = c.cx * CHUNK + (k % CHUNK);
      const z = c.cz * CHUNK + Math.floor(k / CHUNK);
      if (!inRect(rect, x, z)) return;
      if (!isBlocked(t)) openTiles[index(x, z)] = 1;
      floors[index(x, z)] = t[0];
      ramps[index(x, z)] = t[2] & RAMP ? 1 : 0;
    });
  }
  const open = (x: number, z: number) => inRect(rect, x, z) && openTiles[index(x, z)] === 1;
  /** No ledge between two side-by-side tiles of the world (format.ts LEDGE). */
  const pass = (ax: number, az: number, bx: number, bz: number) => {
    if (!inRect(rect, ax, az) || !inRect(rect, bx, bz)) return true;
    const a = index(ax, az);
    const b = index(bx, bz);
    return (ramps[a]! & ramps[b]!) === 1 || Math.abs(floors[a]! - floors[b]!) <= LEDGE;
  };
  const ground: Ground = { open, pass };
  const all = <K extends "props" | "buildings" | "npcs" | "spawns" | "chests" | "entrances" | "waymarkers">(k: K): ChunkData[K][number][] =>
    chunks.flatMap((c) => [...c[k]] as ChunkData[K][number][]);
  const npcs = all("npcs");
  const at = (p: { x: number; z: number }) => `${p.x},${p.z}`;

  // Walked whole from the first inn.
  const first = world.inns[0];
  if (!first) return ["world.json: no inn"];
  if (!open(first.x, first.z)) return [`inn ${first.id}: ${at(first)} is not an open tile`];
  const reached = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let tail = 0;
  queue[tail++] = index(first.x, first.z);
  reached[index(first.x, first.z)] = 1;
  for (let head = 0; head < tail; head++) {
    const k = queue[head]!;
    const x = (k % W) + rect[0];
    const z = Math.floor(k / W) + rect[1];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || !canStep(ground, x, z, x + dx, z + dz)) continue;
        const n = index(x + dx, z + dz);
        if (reached[n]) continue;
        reached[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  const walked = (x: number, z: number) => inRect(rect, x, z) && reached[index(x, z)] === 1;
  const beside = (p: { x: number; z: number }, reach = 1) => {
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) if (walked(p.x + dx, p.z + dz)) return true;
    return false;
  };
  let openCount = 0;
  for (let k = 0; k < openTiles.length; k++) openCount += openTiles[k]!;
  if (tail !== openCount) {
    let sample = "";
    for (let k = 0; k < openTiles.length && !sample; k++) if (openTiles[k] && !reached[k]) sample = `${(k % W) + rect[0]},${Math.floor(k / W) + rect[1]}`;
    out.push(`the world: ${openCount - tail} open tiles are not walked to from inn ${first.id} (one at ${sample})`);
  }
  for (const inn of world.inns) {
    if (!walked(inn.x, inn.z)) out.push(`inn ${inn.id}: ${at(inn)} is not walked to`);
    if (!interiors.some((r) => r.id === inn.interior && r.kind === "inn" && r.exit[0] === inn.x && r.exit[1] === inn.z)) out.push(`inn ${inn.id}: no inn interior ${inn.interior} coming out at ${at(inn)}`);
  }

  // Doors and the towns their interiors belong to.
  for (const b of all("buildings")) {
    if (!b.door) continue;
    if (!walked(b.door[0], b.door[1])) out.push(`building ${b.id}: its door ${b.door.join(",")} is not walked to`);
    const room = interiors.find((r) => r.id === b.interior);
    const town = townAt(world.towns, b.door[0], b.door[1]);
    if (room && (room.town ?? null) !== (town?.id ?? null)) out.push(`interior ${room.id}: its town is ${room.town ?? "none"}, but its door stands in ${town?.id ?? "no town"}`);
  }

  // Dungeons and their entrances.
  const entrances = all("entrances");
  const byId = new Map(dungeons.map((d) => [d.id, d]));
  for (const place of world.dungeons) {
    const d = byId.get(place.id);
    if (!d) out.push(`world.json: dungeon ${place.id} has no dungeon file`);
    else if (d.entrance[0] !== place.x || d.entrance[1] !== place.z) out.push(`dungeon ${d.id}: its entrance ${d.entrance.join(",")} is not where world.json places it, ${at(place)}`);
  }
  for (const d of dungeons) {
    if (!world.dungeons.some((p) => p.id === d.id)) out.push(`dungeon ${d.id}: world.json does not place it`);
    const e = entrances.find((x) => x.dungeon === d.id);
    if (!e) {
      out.push(`dungeon ${d.id}: no entrance of a chunk leads into it`);
      continue;
    }
    if (e.x !== d.entrance[0] || e.z !== d.entrance[1]) out.push(`dungeon ${d.id}: its chunk's entrance is at ${at(e)}, not ${d.entrance.join(",")}`);
    if (!walked(e.x, e.z)) out.push(`dungeon ${d.id}: its entrance ${at(e)} is not walked to`);
    const near = (kind: string, extra: (n: NpcData) => boolean = () => true) => npcs.some((n) => n.kind === kind && Math.max(Math.abs(n.x - e.x), Math.abs(n.z - e.z)) <= 2 && extra(n));
    if (!near("spell-table")) out.push(`dungeon ${d.id}: no spell table beside its entrance`);
    if (d.waystone && !near("waystone", (n) => n.tower === d.id)) out.push(`dungeon ${d.id}: no waystone beside its entrance`);
    let step = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && open(e.x + dx, e.z + dz)) step = true;
    if (!step) out.push(`dungeon ${d.id}: no open step out of its entrance`);
  }
  for (const e of entrances) if (!byId.has(e.dungeon)) out.push(`entrance at ${at(e)}: no dungeon ${e.dungeon}`);

  // People and things: the stood-on walked to, the rest walked to beside; spell tables are NPCs.
  for (const n of npcs) if (n.stand === undefined ? !walked(n.x, n.z) : !beside(n)) out.push(`npc ${n.id} at ${at(n)} is not walked to`);
  for (const p of all("props")) {
    if (p.id !== "spell-table") continue;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (!npcs.some((n) => n.kind === "spell-table" && n.x === x && n.z === z)) out.push(`a spell-table prop at ${x},${z} is no spell-table NPC`);
  }
  for (const r of interiors) {
    for (const p of r.props) if (p.id === "spell-table" && !r.npcs.some((n) => n.kind === "spell-table" && n.x === Math.floor(p.x) && n.z === Math.floor(p.z))) out.push(`interior ${r.id}: a spell-table prop is no spell-table NPC`);
  }
  for (const c of all("chests")) if (!beside(c)) out.push(`chest ${c.id} at ${at(c)} is not walked to`);

  // Spawns and tiers: each of its zone's tier, harder the farther from the starting areas.
  const starts = world.towns.filter((t) => t.start);
  const fromStart = (x: number, z: number) => Math.min(...starts.map((t) => Math.max(Math.abs(x - t.center[0]), Math.abs(z - t.center[1])) - t.radius));
  const byTier = Array.from({ length: MAX_TIER + 1 }, () => [] as number[]);
  for (const s of all("spawns")) {
    const where = `spawn ${s.id}`;
    if (!walked(s.x, s.z)) out.push(`${where} at ${at(s)} is not walked to`);
    if (s.tier < 1 || s.tier > MAX_TIER) out.push(`${where}: tier ${s.tier} is not 1 to ${MAX_TIER}`);
    if (s.tier !== tierAt(world, s.x, s.z)) out.push(`${where}: tier ${s.tier}, but its zone's is ${tierAt(world, s.x, s.z)}`);
    if (townAt(world.towns, s.x, s.z)) out.push(`${where} stands in a town`);
    if (s.mobs.length === 0) out.push(`${where} has no mobs`);
    for (const m of s.mobs) {
      const tier = options.tiers?.get(m);
      if (options.tiers && tier === undefined) out.push(`${where}: no mob ${m}`);
      else if (tier !== undefined && tier !== s.tier) out.push(`${where} is tier ${s.tier} but holds ${m}, of tier ${tier}`);
    }
    byTier[s.tier]?.push(fromStart(s.x, s.z));
  }
  const means = byTier.map((list) => (list.length === 0 ? Number.NaN : list.reduce((a, b) => a + b, 0) / list.length));
  for (let t = 2; t < MAX_TIER; t++) if (!(means[t]! > means[t - 1]!)) out.push(`tier ${t} spawns lie no farther out than tier ${t - 1}'s (${Math.round(means[t]!)} against ${Math.round(means[t - 1]!)} tiles)`);
  if (!(means[MAX_TIER]! > Math.max(means[1]!, means[2]!))) out.push(`tier ${MAX_TIER} spawns lie no farther out than tiers 1 and 2`);
  for (const m of all("waymarkers")) {
    const here = tierAt(world, m.x, m.z);
    if (m.tier !== here) out.push(`waymarker at ${at(m)}: tier ${m.tier}, but its zone's is ${here}`);
    let softer = false;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (tierAt(world, m.x + dx, m.z + dz) < here) softer = true;
    if (!softer) out.push(`waymarker at ${at(m)} stands at no rise of the tier`);
    if (!beside(m)) out.push(`waymarker at ${at(m)} is not walked to`);
  }

  // Ferries and pitches.
  for (const f of world.ferries) {
    const lane = f.lane;
    if (lane.length < 2 || lane[0]![0] !== f.from[0] || lane[0]![1] !== f.from[1] || lane.at(-1)![0] !== f.to[0] || lane.at(-1)![1] !== f.to[1]) out.push(`ferry ${f.id}: its lane does not run from ${f.from.join(",")} to ${f.to.join(",")}`);
    for (let k = 0; k < lane.length; k++) {
      const [x, z] = lane[k]!;
      if (!open(x, z)) out.push(`ferry ${f.id}: its lane's tile ${x},${z} is not open`);
      if (k === 0) continue;
      const [px, pz] = lane[k - 1]!;
      if (!canStep(ground, px, pz, x, z)) out.push(`ferry ${f.id}: its lane steps from ${px},${pz} to ${x},${z}, no step of a walk`);
    }
    for (const end of [f.from, f.to]) {
      if (!walked(end[0], end[1])) out.push(`ferry ${f.id}: its dock ${end.join(",")} is not walked to`);
      if (!npcs.some((n) => n.kind === "ferryman" && n.ferry === f.id && Math.max(Math.abs(n.x - end[0]), Math.abs(n.z - end[1])) <= 1)) out.push(`ferry ${f.id}: no ferryman beside its dock ${end.join(",")}`);
    }
  }
  for (const p of world.pitches) {
    const town = world.towns.find((t) => t.id === p.town);
    if (!town || !inTown(town, p.x, p.z)) out.push(`pitch of ${p.town} at ${at(p)} is not in its town`);
    if (!walked(p.x, p.z)) out.push(`pitch of ${p.town} at ${at(p)} is not walked to`);
  }

  // The towns' streets.
  const buildings = all("buildings");
  for (const town of world.towns) if (town.plan) out.push(...lintTown(town, open, buildings));

  // Nothing closed unseen.
  const { propTiles, liquid } = options.known ?? {};
  if (propTiles && liquid) out.push(...unseenClosed(world, chunks, propTiles, liquid, walked, pass));
  return out;
}

/**
 * Nothing closed unseen: every closed tile a walker comes up against - one beside an open tile walked to, not under it
 * by more than a step (where its bank is seen) - has what closes it drawn there: no ground, a liquid (water, lava), a
 * building's footprint, a prop that blocks over it, a thing used from beside it (a spell table, a quest board, the
 * arena's gate, a waystone), a chest or a waymarker; or it is a ferry's lane, open water to its passengers alone. An
 * open tile a prop that blocks stands on is none of the lint's: what is drawn there may be walked past.
 */
function unseenClosed(
  world: WorldData,
  chunks: readonly ChunkData[],
  propTiles: (p: PropData) => { readonly tiles: readonly XZ[]; readonly blocks: boolean },
  liquid: (surface: string) => boolean,
  walked: (x: number, z: number) => boolean,
  pass: (ax: number, az: number, bx: number, bz: number) => boolean,
): Problems {
  const seen = new Set<string>();
  const key = (x: number, z: number) => `${x},${z}`;
  for (const c of chunks) {
    for (const b of c.buildings) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) seen.add(key(x, z));
    for (const p of c.props) {
      const { tiles, blocks } = propTiles(p);
      if (blocks) for (const [x, z] of tiles) seen.add(key(x, z));
    }
    for (const n of c.npcs) if (OBJECT_KINDS.has(n.kind)) seen.add(key(n.x, n.z));
    for (const t of [...c.chests, ...c.waymarkers]) seen.add(key(t.x, t.z));
  }
  for (const f of world.ferries) for (const [x, z] of f.lane) seen.add(key(x, z));
  const out: Problems = [];
  const counts = new Map<string, { n: number; at: string }>();
  for (const c of chunks) {
    c.tiles.forEach((t, k) => {
      if (!isBlocked(t) || t[1] === NO_SURFACE || liquid(t[1])) return;
      const x = c.cx * CHUNK + (k % CHUNK);
      const z = c.cz * CHUNK + Math.floor(k / CHUNK);
      if (seen.has(key(x, z))) return;
      // Come up against: from a tile walked to beside it, no ledge between them (a bank seen from below closes it).
      const against = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => walked(x + dx!, z + dz!) && pass(x, z, x + dx!, z + dz!));
      if (!against) return;
      const what = t[1];
      const found = counts.get(what);
      if (found) found.n++;
      else counts.set(what, { n: 1, at: key(x, z) });
    });
  }
  for (const [surface, { n, at }] of counts) out.push(`${n} closed ${surface} tile(s) with nothing drawn there to close them, one at ${at}`);
  return out;
}

/**
 * What a town's street plan must hold (format.ts, `TownPlan`): `spur`, the most tiles a street may run on past its last
 * junction to end at no door (a lot's depth); `detour`, the most a walk along the streets between two of its key places
 * (its gates, doors and what is used from beside it) may be over the straight line between them, for those at least
 * `apart` tiles apart.
 */
export const TOWN_LIMITS = { spur: 8, detour: 2, apart: 12 } as const;

/**
 * A town's street plan against its tiles: its nodes, ways, gates and places well formed; every street's ends, every
 * door into its buildings and every key place walked to from every gate along the streets alone (a door opening onto a
 * street); no street ending at no door more than a lot's depth past its last junction; and no walk between two key
 * places along the streets much longer than the straight line between them (`TOWN_LIMITS`).
 */
export function lintTown(town: TownData, open: (x: number, z: number) => boolean, buildings: readonly BuildingData[], limits: { readonly spur: number; readonly detour: number; readonly apart: number } = TOWN_LIMITS): Problems {
  const plan = town.plan!;
  const where = `town ${town.id}`;
  const out: Problems = [];
  const n = plan.nodes.length;
  const node = (k: number) => Number.isInteger(k) && k >= 0 && k < n;
  plan.ways.forEach((w, k) => {
    if (!node(w.a) || !node(w.b) || w.a === w.b) out.push(`${where}: way ${k} should join two of its nodes`);
    if (!isInt(w.width) || w.width < 1 || w.width > 6) out.push(`${where}: way ${k} should be 1 to 6 tiles wide`);
  });
  for (const g of plan.gates) if (!node(g)) out.push(`${where}: a gate should be one of its nodes`);
  for (const p of plan.places) {
    if (!(PLACE_KINDS as readonly string[]).includes(p.kind)) out.push(`${where}: a place of kind ${p.kind}, which is none of ${PLACE_KINDS.join(", ")}`);
    if (!inTown(town, p.x, p.z)) out.push(`${where}: ${p.name} at ${p.x},${p.z} is not in the town`);
  }
  if (plan.gates.length === 0) out.push(`${where}: no gate`);
  if (out.length > 0) return out;

  const tiles = streetTiles(plan);
  const key = (x: number, z: number) => `${x},${z}`;
  const street = (x: number, z: number) => tiles.has(key(x, z)) && open(x, z);
  /** The open street tile a walk starts from at a point: the point's own, or one beside it. */
  const startAt = (x: number, z: number): XZ | null => {
    if (street(x, z)) return [x, z];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (street(x + dx, z + dz)) return [x + dx, z + dz];
    return null;
  };
  const walks = new Map<string, Map<string, number>>();
  /** Distances walked along the open street tiles from a tile: eight ways, never cutting a corner, a diagonal step the root of 2. */
  const walkFrom = (from: XZ): Map<string, number> => {
    const k0 = key(from[0], from[1]);
    const known = walks.get(k0);
    if (known) return known;
    const found = new Map([[k0, 0]]);
    const heap: [number, number, number][] = [[0, from[0], from[1]]];
    const push = (item: [number, number, number]) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (heap[up]![0] <= heap[i]![0]) break;
        [heap[up], heap[i]] = [heap[i]!, heap[up]!];
        i = up;
      }
    };
    const pop = (): [number, number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    while (heap.length > 0) {
      const [d, x, z] = pop();
      if (d > found.get(key(x, z))!) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dz) || !street(x + dx, z + dz)) continue;
          if (dx && dz && !(street(x + dx, z) && street(x, z + dz))) continue;
          const next = d + (dx && dz ? Math.SQRT2 : 1);
          const k = key(x + dx, z + dz);
          if (next < (found.get(k) ?? Infinity)) {
            found.set(k, next);
            push([next, x + dx, z + dz]);
          }
        }
      }
    }
    walks.set(k0, found);
    return found;
  };

  // Every street's ends, every door and every place walked to from every gate.
  const gates: { at: XZ; name: string }[] = [];
  for (const g of plan.gates) {
    const [x, z] = plan.nodes[g]!;
    const at = startAt(x, z);
    if (!at) out.push(`${where}: its gate at ${x},${z} is on no open street`);
    else gates.push({ at, name: `the gate at ${x},${z}` });
  }
  if (gates.length === 0) return out;
  const doors = buildings.filter((b) => b.door && inTown(town, b.door[0], b.door[1]));
  for (const b of doors) if (!tiles.has(key(b.door![0], b.door![1]))) out.push(`${where}: the door of ${b.id} at ${b.door!.join(",")} opens onto no street`);
  for (const g of gates) {
    const reached = walkFrom(g.at);
    const walked = (at: XZ | null) => !!at && reached.has(key(at[0], at[1]));
    for (const b of doors) if (tiles.has(key(b.door![0], b.door![1])) && !walked(b.door!)) out.push(`${where}: the door of ${b.id} at ${b.door!.join(",")} is not walked to along the streets from ${g.name}`);
    for (const p of plan.places) if (!walked(startAt(p.x, p.z))) out.push(`${where}: ${p.name} at ${p.x},${p.z} is not walked to along the streets from ${g.name}`);
    plan.ways.forEach((w, k) => {
      for (const e of [w.a, w.b]) {
        const [x, z] = plan.nodes[e]!;
        if (!walked(startAt(x, z))) out.push(`${where}: way ${k}'s end at ${x},${z} is not walked to along the streets from ${g.name}`);
      }
    });
  }

  // No street running on past its last junction to end at no door.
  const degree = new Array<number>(n).fill(0);
  for (const w of plan.ways) {
    degree[w.a]!++;
    degree[w.b]!++;
  }
  const joined = (k: number) => plan.gates.includes(k) || plan.squares.some((s) => inSquare(s, plan.nodes[k]![0], plan.nodes[k]![1]));
  const length = (w: (typeof plan.ways)[number]) => {
    const p = wayPoints(plan, w);
    let sum = 0;
    for (let k = 1; k < p.length; k++) sum += Math.hypot(p[k]![0] - p[k - 1]![0], p[k]![1] - p[k - 1]![1]);
    return sum;
  };
  for (let k = 0; k < n; k++) {
    if (degree[k] !== 1 || joined(k)) continue;
    let at = k;
    let way = plan.ways.find((w) => w.a === k || w.b === k)!;
    let run = 0;
    for (let steps = 0; steps < plan.ways.length; steps++) {
      run += length(way);
      const next = way.a === at ? way.b : way.a;
      if (degree[next] !== 2 || joined(next)) break;
      const on = plan.ways.find((w) => w !== way && (w.a === next || w.b === next));
      if (!on) break;
      at = next;
      way = on;
    }
    const [x, z] = plan.nodes[k]!;
    const door = doors.some((b) => Math.max(Math.abs(b.door![0] - x), Math.abs(b.door![1] - z)) <= 2);
    if (run > limits.spur && !door) out.push(`${where}: a street ends at ${x},${z}, at no door, ${Math.round(run)} tiles past its last junction`);
  }

  // No long way round between key places.
  const points: { at: XZ; name: string }[] = [...gates];
  for (const p of plan.places) {
    const at = startAt(p.x, p.z);
    if (at) points.push({ at, name: p.name });
  }
  for (let i = 0; i < points.length; i++) {
    const from = walkFrom(points[i]!.at);
    // From gate to gate the road outside the walls is the way.
    for (let j = Math.max(i + 1, gates.length); j < points.length; j++) {
      const [ax, az] = points[i]!.at;
      const [bx, bz] = points[j]!.at;
      const straight = Math.hypot(ax - bx, az - bz);
      if (straight < limits.apart) continue;
      const walked = from.get(key(bx, bz));
      if (walked === undefined) continue;
      if (walked > straight * limits.detour) {
        out.push(`${where}: from ${points[i]!.name} to ${points[j]!.name} is ${Math.round(walked)} tiles along the streets, ${(walked / straight).toFixed(2)} times the ${Math.round(straight)} between them`);
      }
    }
  }
  return out;
}

