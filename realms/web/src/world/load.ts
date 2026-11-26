import {
  CHUNK,
  type ChunkData,
  type InteriorData,
  type Rect,
  TEXELS_PER_TILE,
  type TileData,
  type WorldData,
  chunkKey,
  chunkTile,
  chunksOver,
  hasGround,
  interiorArea,
  interiorTile,
  isBlocked,
  RAMP,
  parseChunkKey,
  worldRect,
} from "./format";
import { Grid } from "./grid";
import { checkChunk, checkInterior, checkWorld } from "./lint";

// Loading a version-2 world: where its files come from (a `WorldSource`: Vite's bundles, or fetched over HTTP), each
// file checked as it comes (lint.ts's per-file checks; a file that fails is an error, never half-loaded), and the
// tiles made walkable (`gridOf`). Three-free: what it loads is data, for the renderer and the game alike.

/** Where a world's files come from. Each answers the parsed JSON, or null where there is no such file. */
export interface WorldSource {
  world(): Promise<unknown>;
  chunk(cx: number, cz: number): Promise<unknown | null>;
  interior(id: string): Promise<unknown | null>;
  /** Every chunk there is, when the source can list them (a bundle can; a server need not). */
  chunkKeys?(): readonly string[];
}

const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1, -".json".length);

/**
 * A source from Vite's `import.meta.glob` of a world's folder: `world` the world.json module (or a loader of it), and
 * lazy loaders of its chunks and interiors keyed by path. For instance:
 *
 *     globSource(
 *       () => import("../../fixtures/slice-world/world.json"),
 *       import.meta.glob("../../fixtures/slice-world/chunks/*.json", { import: "default" }),
 *       import.meta.glob("../../fixtures/slice-world/interiors/*.json", { import: "default" }),
 *     )
 */
export function globSource(
  world: () => Promise<unknown>,
  chunks: Record<string, () => Promise<unknown>>,
  interiors: Record<string, () => Promise<unknown>>,
): WorldSource {
  const chunkLoaders = new Map(Object.entries(chunks).map(([path, load]) => [idOf(path), load]));
  const interiorLoaders = new Map(Object.entries(interiors).map(([path, load]) => [idOf(path), load]));
  const unwrap = (m: unknown) => (m && typeof m === "object" && "default" in m ? (m as { default: unknown }).default : m);
  return {
    world: async () => unwrap(await world()),
    chunk: async (cx, cz) => {
      const load = chunkLoaders.get(chunkKey(cx, cz));
      return load ? unwrap(await load()) : null;
    },
    interior: async (id) => {
      const load = interiorLoaders.get(id);
      return load ? unwrap(await load()) : null;
    },
    chunkKeys: () => [...chunkLoaders.keys()],
  };
}

/** A source fetching a world's files from under a URL: `<base>/world.json`, `<base>/chunks/<cx>_<cz>.json`, `<base>/interiors/<id>.json`. */
export function fetchSource(base: string): WorldSource {
  const get = async (path: string): Promise<unknown | null> => {
    const r = await fetch(`${base.replace(/\/$/, "")}/${path}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };
  return {
    world: async () => {
      const w = await get("world.json");
      if (w === null) throw new Error("world.json: not found");
      return w;
    },
    chunk: (cx, cz) => get(`chunks/${chunkKey(cx, cz)}.json`),
    interior: (id) => get(`interiors/${id}.json`),
  };
}

/** A file that is not what the format says: the problems, listed. */
export class WorldFormatError extends Error {
  constructor(
    readonly file: string,
    readonly problems: readonly string[],
  ) {
    super(`${file}: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ""}`);
  }
}

export async function loadWorld(source: WorldSource): Promise<WorldData> {
  const data = await source.world();
  const problems = checkWorld(data);
  if (problems.length > 0) throw new WorldFormatError("world.json", problems);
  return data as WorldData;
}

/**
 * One chunk, checked; null where the world has none there. Given the world, a chunk it has no ground in (past its tiles,
 * or in a world of two scales over neither the travel map nor a town's grounds: format.ts `hasGround`) is none, never
 * asked of the source.
 */
export async function loadChunk(source: WorldSource, cx: number, cz: number, world?: WorldData): Promise<ChunkData | null> {
  if (world && !hasGround(world, cx, cz)) return null;
  const data = await source.chunk(cx, cz);
  if (data === null) return null;
  const problems = checkChunk(data, cx, cz);
  if (problems.length > 0) throw new WorldFormatError(`chunks/${chunkKey(cx, cz)}.json`, problems);
  return data as ChunkData;
}

/**
 * The chunks over a rectangle of tiles (default every chunk the world's tiles touch), checked; missing ones left out, and
 * in a world of two scales those over no ground never asked for (`hasGround`).
 */
export async function loadChunks(source: WorldSource, world: WorldData, over: Rect = worldRect(world)): Promise<ChunkData[]> {
  const keys = source.chunkKeys?.();
  const wanted = chunksOver(over).filter(({ cx, cz }) => hasGround(world, cx, cz) && (!keys || keys.includes(chunkKey(cx, cz))));
  const chunks = await Promise.all(wanted.map(({ cx, cz }) => loadChunk(source, cx, cz, world)));
  return chunks.filter((c): c is ChunkData => c !== null);
}

/** Every chunk a listing source has, checked: for the lint and the tools. */
export async function loadAllChunks(source: WorldSource): Promise<ChunkData[]> {
  const keys = source.chunkKeys?.();
  if (!keys) throw new Error("the source cannot list its chunks");
  const out: ChunkData[] = [];
  for (const key of keys) {
    const at = parseChunkKey(key);
    if (!at) throw new WorldFormatError(`chunks/${key}.json`, ["a chunk file is named <cx>_<cz>.json"]);
    const c = await loadChunk(source, at.cx, at.cz);
    if (c) out.push(c);
  }
  return out;
}

export async function loadInterior(source: WorldSource, id: string): Promise<InteriorData> {
  const data = await source.interior(id);
  if (data === null) throw new Error(`interiors/${id}.json: not found`);
  const problems = checkInterior(data, id);
  if (problems.length > 0) throw new WorldFormatError(`interiors/${id}.json`, problems);
  return data as InteriorData;
}

// --- Walking ---------------------------------------------------------------------------------------------------------

/** A grid over a rectangle of tiles, each open unless blocked (or nothing), at its floor's height, its ramps marked. */
function gridOver(r: Rect, tileAt: (x: number, z: number) => TileData | null): Grid {
  const grid = new Grid(r[2] - r[0], r[3] - r[1], r[0], r[1]);
  for (let z = r[1]; z < r[3]; z++) {
    for (let x = r[0]; x < r[2]; x++) {
      const t = tileAt(x, z);
      if (!t) continue;
      grid.setWalkable(x, z, !isBlocked(t));
      if (t[0] !== 0) grid.setHeight(x, z, t[0] / TEXELS_PER_TILE);
      if (t[2] & RAMP) grid.setRamp(x, z, true);
    }
  }
  return grid;
}

/** The world's walkable tiles over the loaded chunks (a tile of a chunk not loaded is not walked on). */
export function gridOfWorld(world: WorldData, chunks: readonly ChunkData[]): Grid {
  const byKey = new Map(chunks.map((c) => [chunkKey(c.cx, c.cz), c]));
  return gridOver(worldRect(world), (x, z) => {
    const c = byKey.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return c ? chunkTile(c, x, z) : null;
  });
}

/**
 * The walkable tiles of the chunks loaded, as one grid over the rectangle they cover (no bigger: the world is a million
 * tiles, the chunks round a player a few dozen thousand), so a walk crosses from chunk to chunk as if they were one. A
 * tile of the rectangle whose chunk is not loaded, or past the world's edge, is not walked on. The chunk manager
 * remakes it as chunks come and go; a path's tiles are world tiles throughout.
 */
export function gridOfChunks(world: WorldData, chunks: readonly ChunkData[]): Grid {
  if (chunks.length === 0) return new Grid(0, 0);
  const x0 = Math.min(...chunks.map((c) => c.cx)) * CHUNK;
  const z0 = Math.min(...chunks.map((c) => c.cz)) * CHUNK;
  const x1 = (Math.max(...chunks.map((c) => c.cx)) + 1) * CHUNK;
  const z1 = (Math.max(...chunks.map((c) => c.cz)) + 1) * CHUNK;
  const edge = worldRect(world);
  const byKey = new Map(chunks.map((c) => [chunkKey(c.cx, c.cz), c]));
  return gridOver([x0, z0, x1, z1], (x, z) => {
    if (x < edge[0] || z < edge[1] || x >= edge[2] || z >= edge[3]) return null;
    const c = byKey.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return c ? chunkTile(c, x, z) : null;
  });
}

/** An interior's walkable tiles. */
export function gridOfInterior(room: InteriorData): Grid {
  return gridOver(interiorArea(room), (x, z) => interiorTile(room, x, z));
}
