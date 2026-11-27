import type { BuildingData, ChunkData, DungeonData, InteriorData, NpcData, PropData, Rect, SpawnData, TileData, TownData, TownPlan, WorldData, XZ } from "../../src/world/format";
import { BARE, BLOCKED, CHUNK, chunkKey, chunksOver, groundChunks, inRect } from "../../src/world/format";
import type { WorldSource } from "../../src/world/load";
import { PROPS } from "../../src/art/props";
import shopTemplate from "../slice-world/interiors/shop.json";

// A small world of two scales (interfaces.md, "Two scales"), for the two scales' tests (the game page's ?world=two,
// e2e/travel-map.spec.ts, the realm server's tests through the files `npm run two-world` writes): a travel map of 96 by
// 96 tiles - grass and a pine wood, a coast and the sea, a road from the west to a town's icon and on south to a dungeon's
// way in, a spawn of each tier - and the town of Twoford at walking scale in a pocket of its own, 96 by 96 tiles three
// chunks east of it: a basin of grass walked about, ringed by a wooded bank two terraces high that is only seen, its
// town in the middle (a street and a square, an inn and a shop with their rooms, a house at the street's end, its door
// only painted,
// townsfolk), and two roads out to its ways - west, and south toward the caves. Made by code, the same every time: it is
// a `WorldSource` like any other, read and checked chunk by chunk as the real world is. Nothing in it is the game's.

import { BASIN, CENTER, ENTRANCE, GROUNDS, INN_DOOR, SITE, SOUTH, TRAVEL, WEST } from "./places";

export { BASIN, CENTER, ENTRANCE, GROUNDS, INN_DOOR, SITE, SOUTH, TRAVEL, WEST, WOOD } from "./places";

const SIZE: XZ = [288, 96];
/** The bank round the basin, and the sea's floor: two terraces up, and level. */
const BANK = 24;

const h32 = (x: number, z: number, s: number) => {
  let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

interface Made {
  readonly tiles: Map<string, TileData>;
  readonly props: PropData[];
  readonly buildings: BuildingData[];
  readonly npcs: NpcData[];
  readonly spawns: SpawnData[];
  readonly entrances: { x: number; z: number; dungeon: string }[];
  readonly rooms: Map<string, InteriorData>;
}

let made: Made | null = null;

/** The town's street plan: its west gate, the square in the middle, the street on east to a house, and its south gate. */
const PLAN: TownPlan = {
  outline: [
    [224, 28],
    [256, 28],
    [256, 60],
    [224, 60],
  ],
  enclosure: "none",
  nodes: [
    [224, 44],
    [240, 44],
    [256, 44],
    [240, 60],
  ],
  ways: [
    { a: 0, b: 1, width: 5, main: true },
    { a: 1, b: 2, width: 5 },
    { a: 1, b: 3, width: 3, main: true },
  ],
  squares: [{ x: 235, z: 39, w: 11, d: 11, name: "The Market" }],
  gates: [0, 3],
  places: [
    { kind: "inn", name: "The Two Fords", x: INN_DOOR[0], z: INN_DOOR[1] },
    { kind: "shop", name: "Grizzlegom's Goblins", x: 228, z: 46 },
  ],
};

/** The whole world, made once. */
function make(): Made {
  if (made) return made;
  const tiles = new Map<string, TileData>();
  const key = (x: number, z: number) => `${x},${z}`;
  const set = (x: number, z: number, t: TileData) => tiles.set(key(x, z), t);
  const get = (x: number, z: number) => tiles.get(key(x, z)) ?? null;
  const props: PropData[] = [];
  const buildings: BuildingData[] = [];
  const npcs: NpcData[] = [];
  const spawns: SpawnData[] = [];
  const entrances: Made["entrances"] = [];
  const rooms = new Map<string, InteriorData>();
  const block = (x: number, z: number) => {
    const t = get(x, z)!;
    set(x, z, [t[0], t[1], BLOCKED | BARE]);
  };

  // Every chunk of ground is whole: tiles past the travel map and the grounds are none (no chunk holds them).
  for (const k of groundChunks({ travel: TRAVEL, towns: [{ grounds: GROUNDS } as TownData] })!) {
    const [cx, cz] = k.split("_").map(Number) as [number, number];
    for (let z = cz * CHUNK; z < cz * CHUNK + CHUNK; z++) for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) set(x, z, [0, "grass", 0]);
  }

  // --- The travel map ---
  // The sea east and south, a strip of sand along its shore.
  for (let z = TRAVEL[1]; z < TRAVEL[3]; z++) {
    for (let x = TRAVEL[0]; x < TRAVEL[2]; x++) {
      const shore = Math.min(80 - x, 84 - z) + Math.floor(h32(x >> 2, z >> 2, 3) * 2);
      if (shore <= 0) set(x, z, [0, "sea", BLOCKED | BARE]);
      else if (shore <= 2) set(x, z, [0, "sand", 0]);
    }
  }
  // The roads: from the west edge to the icon's west way, and from its south way down and west to the caves.
  const road = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, [0, "road", 0]);
  };
  road(0, 39, 45, 41);
  road(47, 43, 49, 72);
  road(21, 70, 49, 72);
  // The icon: a town's, 5 by 5 round its site, blocked.
  for (let z = SITE[1] - 2; z <= SITE[1] + 2; z++) for (let x = SITE[0] - 2; x <= SITE[0] + 2; x++) set(x, z, [0, "grass", BLOCKED | BARE]);
  // The art's town icon (the travel art's `town-icon`); until the art has it, four towers of a wall stand in for it.
  if (PROPS.has("town-icon")) props.push({ id: "town-icon", x: SITE[0] + 0.5, z: SITE[1] + 0.5, seed: 7, args: { size: "town", style: "benalish", walled: false } });
  else for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) props.push({ id: "wall-tower", x: SITE[0] + 0.5 + dx * 1.2, z: SITE[1] + 0.5 + dz * 1.2, args: { style: "benalish" } });
  // A pine wood in the south-west, a tree on every third tile of a lattice so every open tile between is walked to.
  for (let z = 50; z < 66; z += 3) {
    for (let x = 3; x < 36; x += 3) {
      if (get(x, z)?.[1] !== "grass") continue;
      props.push({ id: "tree", x: x + 0.5, z: z + 0.5, scale: 0.9 + h32(x, z, 5) * 0.3, seed: x * 7 + z });
      block(x, z);
    }
  }
  // The caves: a cave's mouth facing south over a blocked footprint, the way in before it, the spell table beside it.
  const [ex, ez] = ENTRANCE;
  for (let z = ez - 4; z < ez; z++) for (let x = ex - 3; x < ex + 3; x++) set(x, z, [0, "dirt", BLOCKED | BARE]);
  props.push({ id: "cave-mouth", x: ex - 3, z: ez - 4, rot: 0, args: { w: 6, d: 4 } });
  set(ex, ez, [0, "dirt", 0]);
  entrances.push({ x: ex, z: ez, dungeon: "two-caves" });
  set(ex - 2, ez, [0, "dirt", BLOCKED | BARE]);
  props.push({ id: "spell-table", x: ex - 1.5, z: ez + 0.5, rot: 0 });
  npcs.push({ id: "two-caves-spell-table", x: ex - 2, z: ez, kind: "spell-table", name: "Spell table", stand: [ex - 1.5, 0, ez + 0.5] });
  // A spawn of each tier, each harder further from the icon (the zones' tiers below).
  const spawnAt: [number, number, number, string][] = [
    [30, 28, 1, "benalish-hero"],
    [72, 12, 2, "benalish-knight"],
    [10, 76, 3, "commander-eesha"],
    [74, 78, 4, "serra-angel"],
  ];
  for (const [x, z, tier, mob] of spawnAt) {
    const k = chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    spawns.push({ id: `${k}:${spawns.filter((s) => s.id.startsWith(`${k}:`)).length}`, x, z, mobs: [mob], radius: 2, respawnSeconds: 600, tier });
  }

  // --- Twoford's grounds ---
  // The bank: two terraces up all round the basin, wooded, only seen.
  for (let z = GROUNDS[1]; z < GROUNDS[3]; z++) {
    for (let x = GROUNDS[0]; x < GROUNDS[2]; x++) {
      if (inRect(BASIN, x, z)) continue;
      set(x, z, [BANK, "grass", BLOCKED]);
      const edge = Math.min(x - (BASIN[0] - 1), BASIN[2] - x, z - (BASIN[1] - 1), BASIN[3] - z);
      if ((edge === 1 && (x + z) % 2 === 0) || h32(x, z, 9) < 0.12) props.push({ id: "tree", x: x + 0.5, z: z + 0.5, scale: 0.9 + h32(x, z, 10) * 0.4, seed: x * 13 + z });
    }
  }
  // The roads out: west along z 43-45 through a cut in the bank to its exit, south along x 239-241 to its own; past the
  // exits the road is blocked to the pocket's edge (walking onto an exit leaves first).
  const groundRoad = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, [0, "road", 0]);
  };
  groundRoad(197, 43, 223, 45);
  groundRoad(239, 61, 241, 90);
  for (const [x, z] of WEST.exit) set(x, z, [0, "road", 0]);
  for (const [x, z] of SOUTH.exit) set(x, z, [0, "road", 0]);
  for (let x = GROUNDS[0]; x < 196; x++) for (let z = 43; z <= 45; z++) set(x, z, [0, "road", BLOCKED | BARE]);
  for (let z = 92; z < GROUNDS[3]; z++) for (let x = 239; x <= 241; x++) set(x, z, [0, "road", BLOCKED | BARE]);
  // The town: its streets cobbled, the square flagged, a well in the middle of it.
  for (let x = 224; x <= 256; x++) for (let z = 42; z <= 46; z++) set(x, z, [0, "cobbles", 0]);
  for (let z = 44; z <= 60; z++) for (let x = 239; x <= 241; x++) set(x, z, [0, "cobbles", 0]);
  for (let z = 39; z < 50; z++) for (let x = 235; x < 246; x++) set(x, z, [0, "flagstones", 0]);
  props.push({ id: "fountain", x: 240.5, z: 41.5 });
  for (let z = 40; z <= 42; z++) for (let x = 239; x <= 241; x++) set(x, z, [0, "flagstones", BLOCKED | BARE]);
  // The buildings: the inn north of the street, the shop south of it, a house at the street's east end.
  const house = (id: string, x: number, z: number, w: number, d: number, rot: number, extra: Partial<BuildingData> = {}) => {
    buildings.push({ id, style: "benalish", kind: extra.interior ? "shop" : "house", x, z, w, d, rot, ...extra });
    for (let tz = z; tz < z + d; tz++) for (let tx = x; tx < x + w; tx++) set(tx, tz, [0, "flagstones", BLOCKED | BARE]);
  };
  house("two-inn", 226, 37, 5, 5, 0, { door: INN_DOOR, interior: "twoford-inn", sign: "The Two Fords" });
  house("two-shop", 226, 47, 5, 5, 2, { door: [228, 46], interior: "twoford-shop", sign: "Grizzlegom's Goblins" });
  house("two-house", 257, 42, 5, 5, 1, { door: [256, 44] });
  house("two-cottage", 248, 37, 5, 5, 0);
  house("two-barn", 248, 47, 5, 5, 2);
  const template = shopTemplate as unknown as InteriorData;
  rooms.set("twoford-inn", { ...template, id: "twoford-inn", name: "The Two Fords", kind: "inn", town: "twoford", exit: INN_DOOR, npcs: [{ id: "twoford-innkeeper", x: 8, z: 1, kind: "innkeeper", name: "Mother Ada", figure: "townswoman", stand: [8.5, 0.5, 1.75], behaviour: { rest: [0, 1], watch: 5 } }] });
  rooms.set("twoford-shop", { ...template, id: "twoford-shop", town: "twoford", exit: [228, 46], npcs: template.npcs.map((n) => ({ ...n, id: "twoford-grizzlegom" })) });
  // Townsfolk in the square and the street.
  for (const [i, [x, z]] of [
    [237, 47],
    [244, 40],
    [232, 44],
  ].entries()) {
    npcs.push({ id: `two-folk-${i}`, x: x!, z: z!, kind: "townsfolk", name: `Twoford townsfolk ${i}`, figure: "townswoman", seed: i + 1, speed: 1.5, behaviour: { wander: { home: [x!, z!], reach: 3, pause: [1, 3] } } });
  }
  made = { tiles, props, buildings, npcs, spawns, entrances, rooms };
  return made;
}

const inChunk = (cx: number, cz: number, x: number, z: number) => Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz;

/** The world's chunk (cx, cz), as a file would hold it; null over no ground. */
export function twoChunk(cx: number, cz: number): ChunkData | null {
  if (!groundChunks(TWO_WORLD)!.has(chunkKey(cx, cz))) return null;
  const m = make();
  const tiles: TileData[] = [];
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) tiles.push(m.tiles.get(`${cx * CHUNK + i},${cz * CHUNK + j}`)!);
  const here = <T extends { x: number; z: number }>(list: readonly T[]) => list.filter((e) => inChunk(cx, cz, Math.floor(e.x), Math.floor(e.z)));
  return { cx, cz, tiles, props: here(m.props), buildings: here(m.buildings), npcs: here(m.npcs), spawns: here(m.spawns), entrances: here(m.entrances), waymarkers: [] };
}

/** The overview: a letter for each 8 by 8 square of the travel map, by its middle tile (the icon's a town's). */
function overview(): WorldData["overview"] {
  const m = make();
  const rows: string[] = [];
  for (let z = 4; z < TRAVEL[3]; z += 8) {
    let row = "";
    for (let x = 4; x < TRAVEL[2]; x += 8) {
      const s = m.tiles.get(`${x},${z}`)?.[1];
      row += Math.abs(x - SITE[0]) <= 4 && Math.abs(z - SITE[1]) <= 4 ? "T" : s === "sea" ? "s" : s === "sand" ? "a" : x < 36 && z >= 50 && z < 66 ? "F" : "g";
    }
    rows.push(row);
  }
  return { cell: 8, legend: { g: "grass", s: "sea", a: "sand", T: "town", F: "woods" }, rows };
}

const TOWN: TownData = {
  id: "twoford",
  name: "Twoford",
  kind: "town",
  center: CENTER,
  radius: 16,
  style: "benalish",
  region: "W",
  start: true,
  home: "W",
  plan: PLAN,
  site: SITE,
  grounds: GROUNDS,
  ways: [WEST, SOUTH],
};

export const TWO_WORLD: WorldData = {
  size: SIZE,
  chunk: CHUNK,
  tile: 1,
  seed: 2,
  regions: [{ color: "W", name: "Twoland", tiles: 96 * 96 }],
  towns: [TOWN],
  inns: [{ id: "twoford-inn", town: "twoford", x: INN_DOOR[0], z: INN_DOOR[1], interior: "twoford-inn" }],
  dungeons: [{ id: "two-caves", x: ENTRANCE[0], z: ENTRANCE[1] }],
  roads: [{ from: "twoford", to: "two-caves", tiles: [...Array.from({ length: 28 }, (_, i): XZ => [48, 43 + i]), ...Array.from({ length: 28 }, (_, i): XZ => [47 - i, 71])] }],
  ferries: [],
  pitches: [],
  zones: {
    cell: 32,
    cols: 3,
    rows: 3,
    areas: [1, 2, 3, 4].map((tier) => ({ id: `twoland-${tier}`, name: tier === 1 ? "The Twofields" : tier === 2 ? "Goblin Heights" : tier === 3 ? "The Pinewood" : "The Glass Shore", region: "W" as const, tier })),
    grid: [
      [0, 0, 1],
      [0, 0, 1],
      [2, 2, 3],
    ],
  },
  get overview() {
    return overview();
  },
  travel: TRAVEL,
  labels: [
    { name: "Twoland", x: 24, z: 26, kind: "land" },
    { name: "Goblin Heights", x: 70, z: 8, kind: "feature" },
    { name: "The Glass Sea", x: 88, z: 90, kind: "sea" },
  ],
};

/** The caves south-west of Twoford: a round of Benalish challengers, then the commander's hall, as a dungeon's file holds it. */
export const TWO_CAVES: DungeonData = {
  id: "two-caves",
  name: "The Twoford Caves",
  theme: "caves",
  entrance: ENTRANCE,
  floors: [2, 2],
  tier: 1,
  encounters: [3, 3],
  mobs: ["benalish-hero", "benalish-knight"],
  boss: "commander-eesha",
};

/** The chunks there are, by key. */
export const TWO_CHUNKS: readonly string[] = [...groundChunks(TWO_WORLD)!].sort();

/** The world as a source: read chunk by chunk (checked as any world's files are), its rooms the slice's shop dressed. */
export function twoSource(): WorldSource {
  return {
    world: async () => JSON.parse(JSON.stringify(TWO_WORLD)) as unknown,
    chunk: async (cx, cz) => twoChunk(cx, cz),
    interior: async (id) => make().rooms.get(id) ?? null,
    chunkKeys: () => TWO_CHUNKS,
  };
}

/** Every file of the world as the realm's are laid out (world/world.json, world/chunks, interiors, dungeons): `npm run two-world` writes them. */
export function twoFiles(): Map<string, unknown> {
  const out = new Map<string, unknown>();
  out.set("world/world.json", JSON.parse(JSON.stringify(TWO_WORLD)));
  for (const k of TWO_CHUNKS) {
    const [cx, cz] = k.split("_").map(Number) as [number, number];
    out.set(`world/chunks/${k}.json`, twoChunk(cx, cz));
  }
  for (const [id, room] of make().rooms) out.set(`interiors/${id}.json`, room);
  out.set("dungeons/two-caves.json", TWO_CAVES);
  return out;
}

/** The chunks over a rectangle of the world: for tests. */
export const chunksOf = (r: Rect) => chunksOver(r).map(({ cx, cz }) => chunkKey(cx, cz));
