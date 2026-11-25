import type { BuildingData, ChunkData, InteriorData, LightData, NpcData, PropData, SpawnData, TileData, WorldData } from "../../src/world/format";
import { BARE, BLOCKED, CHUNK, RAMP, chunkKey } from "../../src/world/format";
import type { WorldSource } from "../../src/world/load";
import shopTemplate from "../slice-world/interiors/shop.json";

// A large synthetic world for the renderer's tests and its benchmark (render/, the game page ?world=large): 8 by 8 chunks
// (256 tiles square) of mixed country made by code from a seed, the same every time - a dense walled-less town of
// Benalish houses and shops (some with rooms behind their doors), streets and a market with lamps; a deep forest; hills
// of terraces with ramps up them and a ruin on top; a lake with its shore; fields; dirt roads between them; and
// townsfolk going about. It is a `WorldSource` like any other, so it is read and checked chunk by chunk as the real
// world is - no files, and nothing in it is the game's: it exists to be streamed, walked and timed.

export const SIZE = 8 * CHUNK;
/** Where the town's middle is, and the start. */
export const TOWN: readonly [number, number] = [128, 137];
/** A tile in the forest, on the road, and one by the hills' ramp: places the tests and the benchmark walk to. */
export const FOREST: readonly [number, number] = [40, 60];
export const HILLS: readonly [number, number] = [200, 72];

const h32 = (x: number, z: number, s: number) => {
  let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function noise(x: number, z: number, scale: number, s: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = h32(ix, iz, s) * (1 - sx) + h32(ix + 1, iz, s) * sx;
  const b = h32(ix, iz + 1, s) * (1 - sx) + h32(ix + 1, iz + 1, s) * sx;
  return a * (1 - sz) + b * sz;
}

interface Made {
  readonly tiles: TileData[][];
  readonly props: PropData[];
  readonly buildings: BuildingData[];
  readonly npcs: NpcData[];
  readonly lights: LightData[];
  readonly spawns: SpawnData[];
  readonly rooms: Map<string, InteriorData>;
}

let made: Made | null = null;

/** The whole world, made once. */
function make(): Made {
  if (made) return made;
  const tiles: TileData[][] = [];
  for (let z = 0; z < SIZE; z++) {
    const row: TileData[] = [];
    for (let x = 0; x < SIZE; x++) row.push([0, "grass", 0]);
    tiles.push(row);
  }
  const set = (x: number, z: number, t: TileData) => {
    if (x >= 0 && z >= 0 && x < SIZE && z < SIZE) tiles[z]![x] = t;
  };
  const get = (x: number, z: number): TileData | null => (x >= 0 && z >= 0 && x < SIZE && z < SIZE ? tiles[z]![x]! : null);
  const props: PropData[] = [];
  const buildings: BuildingData[] = [];
  const npcs: NpcData[] = [];
  const lights: LightData[] = [];
  const rooms = new Map<string, InteriorData>();
  const town = { x0: 100, z0: 100, x1: 176, z1: 172 };
  const inTown = (x: number, z: number) => x >= town.x0 - 2 && x < town.x1 + 2 && z >= town.z0 - 2 && z < town.z1 + 2;

  // The lake and its shore, south-west.
  for (let z = 150; z < 250; z++) {
    for (let x = 10; x < 110; x++) {
      const d = Math.hypot(x - 58, (z - 200) * 1.2) + noise(x, z, 7, 3) * 10;
      if (d < 26) set(x, z, [0, "stream", BLOCKED | BARE]);
      else if (d < 29) set(x, z, [0, "dirt", 0]);
    }
  }
  // Fields, south-east.
  for (let z = 186; z < 246; z++) for (let x = 150; x < 246; x++) if (!inTown(x, z)) set(x, z, [0, ((Math.floor((x - 150) / 12) + Math.floor((z - 186) / 10)) % 2 === 0 ? "furrows" : "wheat"), 0]);

  // The hills, north-east: terraces three high, each a level of 12 texels, a three-wide ramp up each from the west.
  const level = (x: number, z: number) => {
    const d = Math.hypot((x - 205) * 0.9, z - 70) + noise(x, z, 9, 5) * 8;
    return d < 16 ? 3 : d < 28 ? 2 : d < 40 ? 1 : 0;
  };
  for (let z = 15; z < 130; z++) for (let x = 150; x < 256; x++) if (level(x, z) > 0) set(x, z, [level(x, z) * 12, "grass", 0]);
  // The ramp lane along z 69-71, from the west: where the level steps up eastward, the two tiles across the bank slope,
  // a quarter and three quarters of the way up (as the generator's ramps). Every other bank is a ledge (world/grid.ts),
  // walked up to and never over: only the ramps go up.
  for (let x = 150; x < 240; x++) for (let z = 69; z <= 71; z++) set(x, z, [level(x, 70) * 12, "dirt", 0]);
  for (let x = 150; x < 240; x++) {
    const here = level(x, 70);
    const next = level(x + 1, 70);
    if (next <= here) continue;
    for (let z = 69; z <= 71; z++) {
      set(x, z, [here * 12 + 3, "dirt", RAMP]);
      set(x + 1, z, [next * 12 - 3, "dirt", RAMP]);
    }
  }
  props.push({ id: "ruined-tower", x: 210, z: 72, y: 3 * 12 / 16, args: { r: 2.4, low: 1.6, high: 5.5 } });
  for (let x = 207; x <= 213; x++) for (let z = 69; z <= 75; z++) if (Math.hypot(x + 0.5 - 210, z + 0.5 - 72) < 3) set(x, z, [get(x, z)![0], "grass", BLOCKED | BARE]);
  for (let i = 0; i < 30; i++) {
    const x = 160 + Math.floor(h32(i, 1, 9) * 90);
    const z = 20 + Math.floor(h32(i, 2, 9) * 105);
    const t = get(x, z)!;
    if (t[1] === "grass" && t[2] === 0 && t[0] > 0) {
      props.push({ id: "boulder", x: x + 0.5, z: z + 0.5, y: t[0] / 16, seed: i, args: { r: 0.4 + h32(i, 3, 9) * 0.3 } });
      set(x, z, [t[0], t[1], BLOCKED | BARE]);
    }
  }

  // Roads: from the town's gates west to the forest, south-west to the lake, east to the hills' ramp, south to the fields.
  const road = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const z = Math.round(z0 + ((z1 - z0) * i) / n);
      for (let w = -1; w <= 1; w++) {
        for (const [dx, dz] of Math.abs(x1 - x0) > Math.abs(z1 - z0) ? [[0, w]] : [[w, 0]]) {
          const t = get(x + dx!, z + dz!);
          if (t && t[1] !== "stream" && t[0] === 0 && t[2] === 0) set(x + dx!, z + dz!, [0, "dirt", 0]);
        }
      }
    }
  };
  road(town.x0, 136, 4, 60);
  road(town.x0, 160, 70, 172);
  road(town.x1, 70, 150, 70);
  road(150, 70, town.x1, 120);
  road(136, town.z1, 180, 200);

  // The forest, north-west: trees thick where the noise says, bushes and boulders between, the road through it open.
  let tree = 0;
  for (let z = 2; z < 140; z++) {
    for (let x = 2; x < 125; x++) {
      const t = get(x, z)!;
      if (t[1] !== "grass" || t[2] !== 0 || inTown(x, z)) continue;
      const thick = noise(x, z, 14, 11) * 0.8 + 0.25 - Math.max(0, (z - 110) / 40);
      const r = h32(x, z, 12);
      if (r < thick * 0.34) {
        props.push({ id: "tree", x: x + 0.3 + h32(x, z, 13) * 0.4, z: z + 0.3 + h32(x, z, 14) * 0.4, scale: 0.85 + h32(x, z, 15) * 0.45, seed: tree++ });
        set(x, z, [0, "grass", BLOCKED | BARE]);
      } else if (r < thick * 0.4) {
        props.push({ id: "bush", x: x + 0.5, z: z + 0.5, args: { r: 0.3 + h32(x, z, 16) * 0.2, flowering: h32(x, z, 17) < 0.3 } });
        set(x, z, [0, "grass", BLOCKED | BARE]);
      } else if (r < thick * 0.41) {
        props.push({ id: "boulder", x: x + 0.5, z: z + 0.5, seed: x * 7 + z, args: { r: 0.35 + h32(x, z, 18) * 0.25 } });
        set(x, z, [0, "grass", BLOCKED | BARE]);
      }
    }
  }

  // The town: cobbled streets every 18 tiles, a flagstone market in the middle, houses and shops round each block.
  for (let z = town.z0; z < town.z1; z++) for (let x = town.x0; x < town.x1; x++) set(x, z, [0, "flagstones", 0]);
  const blocks: [number, number][] = [];
  for (let bz = town.z0 + 3; bz + 14 <= town.z1; bz += 18) for (let bx = town.x0 + 3; bx + 15 <= town.x1; bx += 18) blocks.push([bx, bz]);
  // Streets: cobbles everywhere in the town but the blocks.
  for (let z = town.z0; z < town.z1; z++) for (let x = town.x0; x < town.x1; x++) set(x, z, [0, "cobbles", 0]);
  let room = 0;
  let house = 0;
  const market = blocks.find(([bx, bz]) => bx <= 128 && bx + 15 > 128 && bz <= 128 && bz + 14 > 128);
  for (const [bx, bz] of blocks) {
    if (bx === market?.[0] && bz === market?.[1]) {
      for (let z = bz; z < bz + 15; z++) for (let x = bx; x < bx + 15; x++) set(x, z, [0, "flagstones", 0]);
      props.push({ id: "fountain", x: bx + 7.5, z: bz + 7.5 });
      for (let x = bx + 6; x <= bx + 8; x++) for (let z = bz + 6; z <= bz + 8; z++) set(x, z, [0, "flagstones", BLOCKED | BARE]);
      for (let i = 0; i < 3; i++) {
        props.push({ id: "market-stall", x: bx + 2 + i * 4.5, z: bz + 2, args: { width: 3.4 } });
        for (let x = bx + 1 + i * 4.5; x < bx + 5 + i * 4.5; x++) set(Math.floor(x), bz + 1, [0, "flagstones", BLOCKED | BARE]);
        for (const [id, dx, dz] of [["barrel", 0.4, 3.4], ["crate", 1.4, 3.5], ["sack", 2.3, 3.4], ["pot", 3, 3.6]] as const) props.push({ id, x: bx + 1 + i * 4.5 + dx, z: bz + 1 + dz });
      }
      for (const [dx, dz] of [[1, 13], [13, 13], [1, 7], [13, 7]]) {
        props.push({ id: "lamp-post", x: bx + dx! + 0.5, z: bz + dz! + 0.4 });
        set(bx + dx!, bz + dz!, [0, "flagstones", BLOCKED | BARE]);
        lights.push({ kind: "point", at: [bx + dx! + 0.5, 2.4, bz + dz! + 0.4], color: [1, 0.72, 0.38], intensity: 4, reach: 5, flicker: { base: 3.6, steps: [0, 0.5, 0.2, 0.7], rate: 6, phase: (dx! + dz!) % 4 } });
      }
      props.push({ id: "bench", x: bx + 4, z: bz + 12 }, { id: "bench", x: bx + 11, z: bz + 12 });
      continue;
    }
    // Two rows of buildings back to back: the north row faces north onto its street (rot 2), the south row south (rot 0).
    for (const [row, rot] of [[0, 2], [1, 0]] as const) {
      let x = bx;
      while (x < bx + 15) {
        // Odd widths, so a door in the middle is on a tile's middle whichever way the building faces.
        const w = 5 + 2 * Math.floor(h32(x, bz + row, 21) * 2);
        if (x + w > bx + 15) break;
        const z = bz + row * 7;
        const d = 6;
        const shop = h32(x, z, 22) < 0.35;
        const doorAt = Math.floor(w / 2) + 0.5;
        const doorX = x + Math.floor(doorAt);
        const door: [number, number] = rot === 0 ? [doorX, z + d] : [doorX, z - 1];
        const id = `${shop ? "shop" : "house"}-${house++}`;
        const interior = shop && room < 12 ? `room-${room++}` : undefined;
        const ground = 2.3 + h32(x, z, 23) * 0.5;
        const b: BuildingData = {
          id,
          style: "benalish",
          kind: shop ? "shop" : "house",
          x,
          z,
          w,
          d,
          rot,
          ...(interior ? { door, interior } : {}),
          ...(shop ? { sign: `Shop ${house}` } : {}),
          params: {
            ground,
            upper: 1.6 + h32(x, z, 24) * 0.3,
            roof: h32(x, z, 25) < 0.6 ? "tile" : "slate",
            rise: 1.6,
            chimney: 1 + h32(x, z, 26) * (w - 2),
            wall: h32(x, z, 27) < 0.5 ? "limestone" : "plaster",
            openings: shop
              ? [{ at: 1.2, kind: "display" }, { at: doorAt, kind: "shopDoor" }, { at: w - 1.2, kind: "display" }, { at: doorAt, kind: "sign" }, { at: 1.2, kind: "windowUp" }, { at: w - 1.2, kind: "windowUp" }]
              : [{ at: 1.2, kind: "window" }, { at: doorAt, kind: "door" }, { at: w - 1.2, kind: "window" }, { at: doorAt, kind: "windowUp" }],
          },
        };
        buildings.push(b);
        for (let tz = z; tz < z + d; tz++) for (let tx = x; tx < x + w; tx++) set(tx, tz, [0, "flagstones", BLOCKED | BARE]);
        if (interior) {
          rooms.set(interior, { ...(shopTemplate as unknown as InteriorData), id: interior, name: `Shop ${house}`, exit: door });
        }
        x += w;
      }
    }
  }
  // Townsfolk: wandering the streets, a guard on a beat.
  const figures = ["townswoman", "goblin", "knight", "townswoman", "townswoman"];
  for (let i = 0; i < 14; i++) {
    const x = town.x0 + 1 + Math.floor(h32(i, 5, 31) * (town.x1 - town.x0 - 2));
    const z = town.z0 + 1 + 18 * Math.floor(h32(i, 6, 31) * 4);
    if (get(x, z)![2] !== 0) continue;
    npcs.push({ id: `folk-${i}`, x, z, kind: "townsfolk", name: `townsfolk ${i}`, figure: figures[i % figures.length], seed: i + 1, speed: 1.6 + h32(i, 7, 31), behaviour: { wander: { home: [x, z], reach: 4, pause: [1, 3] } } });
  }
  npcs.push({ id: "guard", x: town.x0 + 1, z: TOWN[1], kind: "guard", name: "guard", figure: "knight", speed: 2.2, behaviour: { beat: { stops: [[town.x0 + 1, TOWN[1]], [town.x1 - 2, TOWN[1]]], pause: 2 } } });
  // Spawn points along the road west, in the meadow between the town and the forest: goblins and a skeleton.
  const spawns: SpawnData[] = [];
  for (const [x, z, mob] of [[88, 128, "goblin-raider"], [74, 116, "goblin-raider"], [60, 104, "skeleton-warrior"], [50, 96, "goblin-raider"]] as const) {
    let at: [number, number] | null = null;
    for (let r = 0; r < 4 && !at; r++) for (let dz = -r; dz <= r && !at; dz++) for (let dx = -r; dx <= r && !at; dx++) if (get(x + dx, z + dz)![2] === 0) at = [x + dx, z + dz];
    if (!at) continue;
    const key = `${Math.floor(at[0] / CHUNK)}_${Math.floor(at[1] / CHUNK)}`;
    spawns.push({ id: `${key}:${spawns.filter((sp) => sp.id.startsWith(`${key}:`)).length}`, x: at[0], z: at[1], mobs: [mob], radius: 2, respawnSeconds: 600, tier: 1 });
  }
  made = { tiles, props, buildings, npcs, lights, spawns, rooms };
  return made;
}

function inChunk(cx: number, cz: number, x: number, z: number): boolean {
  return Math.floor(x / CHUNK) === cx && Math.floor(z / CHUNK) === cz;
}

/** The world's chunk (cx, cz), as a file would hold it. */
export function largeChunk(cx: number, cz: number): ChunkData | null {
  if (cx < 0 || cz < 0 || cx >= 8 || cz >= 8) return null;
  const m = make();
  const tiles: TileData[] = [];
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) tiles.push(m.tiles[cz * CHUNK + j]![cx * CHUNK + i]!);
  const here = <T extends { x: number; z: number }>(list: readonly T[]) => list.filter((e) => inChunk(cx, cz, Math.floor(e.x), Math.floor(e.z)));
  return {
    cx,
    cz,
    tiles,
    props: here(m.props),
    buildings: here(m.buildings),
    npcs: here(m.npcs),
    spawns: here(m.spawns),
    entrances: [],
    waymarkers: [],
    lights: m.lights.filter((l) => inChunk(cx, cz, Math.floor(l.at[0]), Math.floor(l.at[2]))),
  };
}

export const LARGE_WORLD: WorldData = {
  size: [SIZE, SIZE],
  chunk: CHUNK,
  tile: 1,
  seed: 1,
  regions: [{ color: "W", name: "Testland", tiles: SIZE * SIZE }],
  towns: [{ id: "testholm", name: "Testholm", kind: "town", center: TOWN, radius: 40, style: "benalish", region: "W", start: true, home: "W" }],
  inns: [],
  dungeons: [],
  roads: [],
  ferries: [],
  pitches: [],
  zones: { cell: 64, cols: 4, rows: 4, areas: [{ id: "testland", name: "Testland", region: "W", tier: 1 }], grid: [0, 1, 2, 3].map(() => [0, 0, 0, 0]) },
  overview: { cell: 16, legend: { g: "grass" }, rows: Array.from({ length: 16 }, () => "g".repeat(16)) },
};

/** The large world as a source: read chunk by chunk (checked as any world's files are), its rooms copies of the slice's shop. */
export function largeSource(): WorldSource {
  return {
    world: async () => LARGE_WORLD,
    chunk: async (cx, cz) => largeChunk(cx, cz),
    interior: async (id) => make().rooms.get(id) ?? null,
    chunkKeys: () => Array.from({ length: 64 }, (_, i) => chunkKey(i % 8, Math.floor(i / 8))),
  };
}
