import type * as THREE from "three";
import { BUILDINGS } from "../art/buildings";
import { type Material, MeshBuilder } from "../art/paint/builder";
import { namedPalette } from "../art/paint/palette";
import { PROPS } from "../art/props";
import type { Built } from "../art/recipe";
import { SURFACES, type SurfaceLook } from "../art/surfaces";
import {
  CHUNK,
  type ChunkData,
  NO_SURFACE,
  type Rect,
  type TileData,
  type WorldData,
  chunkKey,
  chunkTile,
  frontStep,
  isBare,
  isBlocked,
  parseChunkKey,
  worldRect,
} from "../world/format";
import { Grid } from "../world/grid";
import { type WorldSource, loadChunk } from "../world/load";
import { grassField } from "./grass";
import { buildGround } from "./ground";
import { type Place, type Section, sortScenery } from "./place";
import { type TileAt, banksOf, floorAt, floorGeometry } from "./terrain";

// The world at scale: its chunks built as the player comes near and dropped as they go (render/place.ts sections), a
// chunk's work spread over frames so none of them hitches. A chunk is built only once the chunks round it are read, so
// its ground grows over its neighbours' edges and its banks meet theirs as if the world were one piece.
//
// What a chunk is built into (`chunkPieces`): the ground's mesh (floors at their heights: render/terrain.ts), its banks
// of rock, the water under its streams, every building and prop from its recipe - merged per chunk into the tall (cut
// by the x-ray), the small (left out at the furthest zoom) and the rest, trees and hedgerows near and far (`Built.far`,
// shown at the furthest zoom instead), the buildings' cut-aways merged and the flames merged a frame (buildings' and
// props' alike) - its lights (pooled), its standing grass and its doors. `assembleWorld` (assemble.ts) calls the same steps for every chunk at once.

/** A door in a place: stand on `tile` and step `step` to go through to `to` (an interior's id); `at` is the doorway. */
export interface DoorSpot {
  readonly tile: readonly [number, number];
  readonly step: readonly [number, number];
  readonly to: string;
  readonly at: readonly [number, number, number];
}

/** A surface's look, made once per id (a look paints its picture). */
const looksById = new Map<string, SurfaceLook>();
export function lookOf(id: string): SurfaceLook | undefined {
  if (id === NO_SURFACE || !SURFACES.has(id)) return undefined;
  let l = looksById.get(id);
  if (!l) {
    l = SURFACES.look(id);
    looksById.set(id, l);
  }
  return l;
}

/** The surfaces a block of tiles uses, numbered in the order met (row by row), with their looks. */
export function groundOf(rows: number, cols: number, tileAt: (col: number, row: number) => TileData | null): { ids: number[][]; looks: SurfaceLook[] } {
  const index = new Map<string, number>();
  const looks: SurfaceLook[] = [];
  const ids: number[][] = [];
  for (let j = 0; j < rows; j++) {
    const row: number[] = [];
    for (let i = 0; i < cols; i++) {
      const t = tileAt(i, j);
      const s = t?.[1] ?? NO_SURFACE;
      if (s === NO_SURFACE) {
        row.push(-1);
        continue;
      }
      let k = index.get(s);
      if (k === undefined) {
        k = looks.length;
        index.set(s, k);
        looks.push(lookOf(s) ?? SURFACES.look(s));
      }
      row.push(k);
    }
    ids.push(row);
  }
  return { ids, looks };
}

/** What lies under the holes of a block (a stream's water), a quad under each at its tile's floor, as one model. */
export function underOf(tileAt: TileAt, x0: number, z0: number, cols: number, rows: number, lookOf: (t: TileData) => SurfaceLook | undefined): Built {
  const b = new MeshBuilder();
  for (let z = z0; z < z0 + rows; z++) {
    for (let x = x0; x < x0 + cols; x++) {
      const t = tileAt(x, z);
      const under = t ? lookOf(t)?.under : undefined;
      if (!t || !under) continue;
      const y = t[0] / 16 + under.y;
      const [xa, xb, za, zb] = [x - under.spread, x + 1 + under.spread, z - under.spread, z + 1 + under.spread];
      b.quad({ mat: under.material }, [[xa, y, zb], [xb, y, zb], [xb, y, za], [xa, y, za]], (c) => c[0], (c) => -c[2]);
    }
  }
  return { model: b.model() };
}

/** A building's recipe, its palette its own over its style's. */
export const buildingOf = (bd: ChunkData["buildings"][number]): Built => BUILDINGS.build(bd.style, bd, namedPalette(bd.palette));
export const propOf = (p: ChunkData["props"][number]): Built => PROPS.build(p.id, p, namedPalette(p.tint));

/** How long a step of building recipes runs before it gives the frame back, ms. */
const STEP_MS = 2.5;

/** A seed from a chunk's coordinates, so its grass stands where it did whenever it is built. */
const seedOf = (cx: number, cz: number) => (((cx * 73856093) ^ (cz * 19349663)) >>> 0) % 2147483647 || 9;

/**
 * Builds one chunk into a section, a step at a time: each `yield` is a point where the work may stop for the frame.
 * `tileAt` reads tiles of the world as far as they are loaded (this chunk's neighbours too).
 */
export function* buildChunk(world: WorldData, c: ChunkData, tileAt: TileAt, section: Section, place: Place, doors: DoorSpot[]): Generator<string, void, void> {
  const x0 = c.cx * CHUNK;
  const z0 = c.cz * CHUNK;
  const rect = worldRect(world);
  // The ground: the chunk's tiles and a border of its neighbours', so its edges grow over theirs as they would whole.
  const { ids, looks } = groundOf(CHUNK + 2, CHUNK + 2, (i, j) => tileAt(x0 - 1 + i, z0 - 1 + j));
  const shape = floorGeometry(tileAt, x0, z0, CHUNK, CHUNK);
  const ground = buildGround(ids, looks.map((l) => ({ picture: l.picture, priority: l.priority, hole: l.hole })), { x: x0 - 1, z: z0 - 1 }, 0, { x: rect[0], z: rect[1] }, shape);
  // Terrain: outlined where a terrace's edge stands in front of the ground below it (render/renderer.ts).
  (ground.material as THREE.Material).userData.terrain = true;
  section.addGround(ground);
  yield "ground";

  const pieces: Built[] = [];
  yield "ground-done";
  // A surface may name the rock of its own banks (`cliff`); else they are the bank rock.
  pieces.push({ model: banksOf(tileAt, x0, z0, CHUNK, CHUNK, (t) => (lookOf(t[1]) as (SurfaceLook & { cliff?: Material }) | undefined)?.cliff) });
  pieces.push(underOf(tileAt, x0, z0, CHUNK, CHUNK, (t) => lookOf(t[1])));
  let since = performance.now();
  for (const bd of c.buildings) {
    const built = buildingOf(bd);
    pieces.push(built);
    if (bd.door && bd.interior && built.doorway) {
      const [fx, fz] = frontStep(bd.rot);
      doors.push({ tile: bd.door, step: [-fx, -fz], to: bd.interior, at: built.doorway });
    }
    if (performance.now() - since > STEP_MS) {
      yield "buildings";
      since = performance.now();
    }
  }
  for (const p of c.props) {
    pieces.push(propOf(p));
    if (performance.now() - since > STEP_MS) {
      yield "props";
      since = performance.now();
    }
  }
  yield "banks+props";
  // The cut-aways merged a chunk (a set of them re-merged as the player drops some), its flames merged a frame.
  section.addMoving(pieces, true);
  yield "cutaways";
  // Trees and hedgerows: near, and their far stand-ins merged apart for the furthest zoom.
  for (const g of sortScenery(pieces.map((p) => p.model), `chunk:${c.cx}_${c.cz}`, pieces.map((p) => p.far))) {
    section.addMerged(g);
    yield `merge ${g.label} (${g.models.length})`;
  }
  for (const l of c.lights ?? []) section.addLight(l);

  // Standing grass on tufted surfaces where nothing stands, at the floor's height.
  section.addGrass(
    grassField(
      CHUNK,
      CHUNK,
      { x: x0, z: z0 },
      (i, j) => {
        const t = tileAt(x0 + i, z0 + j);
        if (!t || isBare(t) || t[1] === NO_SURFACE) return 0;
        return lookOf(t[1])?.tufts ?? 0;
      },
      seedOf(c.cx, c.cz),
      (x, z) => floorAt(tileAt, x + 0.5, z + 0.5),
      (i, j) => lookOf(tileAt(x0 + i, z0 + j)?.[1] ?? NO_SURFACE)?.tuftRamp,
    ),
  );
  place.settle(section);
}

/** How far round the view chunks are kept, in tiles past the view's own reach. */
export interface StreamReach {
  /** Built within this many tiles of the focus. */
  readonly build: number;
  /** Read (their data) within this many: a chunk is built only once its neighbours are read. */
  readonly load: number;
  /** Dropped past this many. */
  readonly drop: number;
}

/** How much building a frame may do: milliseconds of it, or (on a manual clock, for tests) a number of steps. */
export interface Budget {
  readonly ms?: number;
  readonly steps?: number;
}

/**
 * The chunks of a world streamed round a point: read from the source, built into the place a few steps a frame, and
 * dropped when far. Also the walkable grid over the chunks read (a window of the world, so a path is a bounded search),
 * the floor's height anywhere, and the doors of the chunks built.
 */
export class ChunkStreamer {
  /** Chunks read: their data, or null where the world has none. */
  readonly data = new Map<string, ChunkData | null>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly building = new Map<string, Generator<string, void, void>>();
  private readonly built = new Set<string>();
  private readonly doorsOf = new Map<string, DoorSpot[]>();
  /** The walkable tiles over the chunks read. Remade as they change (`gridChanged` says when). */
  grid: Grid;
  private gridRect: Rect = [0, 0, 0, 0];
  private gridDirty = true;
  /** Called when a chunk's section is built, and as one is dropped (to stand and take away its people). */
  onBuilt: (key: string, chunk: ChunkData) => void = () => {};
  onDropped: (key: string, chunk: ChunkData) => void = () => {};
  onGrid: (grid: Grid) => void = () => {};
  /** Failures reading a chunk (a bad file): kept, so a page can show them. */
  readonly errors: string[] = [];
  /** How long the last frame's building took, ms, and the longest any frame's has. */
  lastBuildMs = 0;
  worstBuildMs = 0;
  /** The longest single step of building yet, and what it was. */
  worstStep = { ms: 0, what: "" };

  constructor(
    readonly world: WorldData,
    private readonly source: WorldSource,
    readonly place: Place,
  ) {
    this.grid = new Grid(0, 0);
  }

  /** A tile of the world, as far as it is read. */
  readonly tileAt: TileAt = (x, z) => {
    const c = this.data.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return c ? chunkTile(c, x, z) : null;
  };

  /** The floor's height at a point: a ramp's slope, a terrace's top. */
  floorAt(x: number, z: number): number {
    return floorAt(this.tileAt, x, z);
  }

  /** The doors of the chunks built. */
  get doors(): DoorSpot[] {
    return [...this.doorsOf.values()].flat();
  }

  get builtKeys(): string[] {
    return [...this.built].sort();
  }

  get loadedKeys(): string[] {
    return [...this.data.keys()].filter((k) => this.data.get(k) !== null).sort();
  }

  /** Whether nothing is being read or built for where the focus is. */
  get idle(): boolean {
    return this.loading.size === 0 && this.building.size === 0 && this.pendingBuild.length === 0;
  }

  private pendingBuild: string[] = [];

  /** The chunks whose square is within `reach` tiles of a point. */
  private chunksNear(x: number, z: number, reach: number): string[] {
    const r = worldRect(this.world);
    const out: string[] = [];
    const cx0 = Math.floor(Math.max(r[0], x - reach) / CHUNK);
    const cx1 = Math.floor((Math.min(r[2] - 1, x + reach)) / CHUNK);
    const cz0 = Math.floor(Math.max(r[1], z - reach) / CHUNK);
    const cz1 = Math.floor((Math.min(r[3] - 1, z + reach)) / CHUNK);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        // Distance from the point to the chunk's square.
        const dx = Math.max(cx * CHUNK - x, 0, x - (cx + 1) * CHUNK);
        const dz = Math.max(cz * CHUNK - z, 0, z - (cz + 1) * CHUNK);
        if (Math.hypot(dx, dz) <= reach) out.push(chunkKey(cx, cz));
      }
    }
    return out;
  }

  private read(key: string): Promise<void> {
    let p = this.loading.get(key);
    if (p) return p;
    const at = parseChunkKey(key)!;
    p = loadChunk(this.source, at.cx, at.cz)
      .then((c) => {
        this.data.set(key, c);
      })
      .catch((e: unknown) => {
        this.errors.push(String(e));
        this.data.set(key, null);
      })
      .finally(() => {
        this.loading.delete(key);
        this.gridDirty = true;
      });
    this.loading.set(key, p);
    return p;
  }

  private neighboursRead(key: string): boolean {
    const { cx, cz } = parseChunkKey(key)!;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (this.insideWorld(cx + dx, cz + dz) && !this.data.has(chunkKey(cx + dx, cz + dz))) return false;
    return true;
  }

  private insideWorld(cx: number, cz: number): boolean {
    const r = worldRect(this.world);
    return cx * CHUNK < r[2] && (cx + 1) * CHUNK > r[0] && cz * CHUNK < r[3] && (cz + 1) * CHUNK > r[1];
  }

  /**
   * What to keep round a point: reads what is within `load`, queues for building what is within `build` (nearest
   * first), and drops what is past `drop`.
   */
  want(x: number, z: number, reach: StreamReach): void {
    for (const k of this.chunksNear(x, z, reach.load)) if (!this.data.has(k)) void this.read(k);
    const wanted = this.chunksNear(x, z, reach.build);
    // A chunk is built once its eight neighbours are read: read those of every chunk wanted for building, which the load
    // reach (measured to the nearest point of each chunk) does not always take in at a corner.
    for (const k of wanted) {
      const { cx, cz } = parseChunkKey(k)!;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = chunkKey(cx + dx, cz + dz);
          if (this.insideWorld(cx + dx, cz + dz) && !this.data.has(n)) void this.read(n);
        }
      }
    }
    const near = wanted.filter((k) => !this.built.has(k) && !this.building.has(k));
    const centre = (k: string) => {
      const { cx, cz } = parseChunkKey(k)!;
      return Math.hypot((cx + 0.5) * CHUNK - x, (cz + 0.5) * CHUNK - z);
    };
    this.pendingBuild = near.sort((a, b) => centre(a) - centre(b));
    const keep = new Set(this.chunksNear(x, z, reach.drop));
    for (const k of [...this.built, ...this.building.keys()]) if (!keep.has(k)) this.drop(k);
    // Data far past the drop reach is forgotten too (the grid stays a window).
    const remember = new Set(this.chunksNear(x, z, reach.drop + CHUNK));
    for (const k of [...this.data.keys()]) {
      if (!remember.has(k) && !this.built.has(k) && !this.building.has(k)) {
        this.data.delete(k);
        this.gridDirty = true;
      }
    }
  }

  private drop(key: string): void {
    this.building.delete(key);
    if (this.built.delete(key)) {
      const c = this.data.get(key);
      if (c) this.onDropped(key, c);
    }
    this.doorsOf.delete(key);
    this.place.removeSection(key);
  }

  /** Builds within the budget: chunks in the order wanted, a step at a time. At least one step a call. */
  pump(budget: Budget): void {
    const start = performance.now();
    let steps = 0;
    const more = () => (budget.steps !== undefined ? steps < budget.steps : steps === 0 || performance.now() - start < (budget.ms ?? 4));
    while (more()) {
      let job = this.building.entries().next().value as [string, Generator<string, void, void>] | undefined;
      if (!job) {
        const next = this.pendingBuild.findIndex((k) => this.data.has(k) && this.neighboursRead(k));
        if (next < 0) break;
        const key = this.pendingBuild.splice(next, 1)[0]!;
        const c = this.data.get(key);
        if (!c) {
          this.built.add(key);
          continue;
        }
        const doors: DoorSpot[] = [];
        this.doorsOf.set(key, doors);
        job = [key, buildChunk(this.world, c, this.tileAt, this.place.section(key), this.place, doors)];
        this.building.set(key, job[1]);
      }
      const [key, gen] = job;
      steps++;
      const t0 = performance.now();
      const r = gen.next();
      const took = performance.now() - t0;
      if (took > this.worstStep.ms) this.worstStep = { ms: took, what: `${key}: ${r.done ? "grass" : r.value}` };
      if (r.done) {
        this.building.delete(key);
        this.built.add(key);
        const c = this.data.get(key);
        if (c) this.onBuilt(key, c);
      }
    }
    this.lastBuildMs = performance.now() - start;
    this.worstBuildMs = Math.max(this.worstBuildMs, this.lastBuildMs);
    if (this.gridDirty) this.remakeGrid();
  }

  /** Reads and builds everything wanted now, however long it takes (arriving somewhere: the iris is shut). */
  async settle(x: number, z: number, reach: StreamReach): Promise<void> {
    for (let i = 0; i < 64; i++) {
      this.want(x, z, reach);
      await Promise.all([...this.loading.values()]);
      this.want(x, z, reach);
      while (this.building.size > 0 || this.pendingBuild.some((k) => this.data.has(k) && this.neighboursRead(k))) this.pump({ steps: 1000 });
      if (this.loading.size === 0 && this.pendingBuild.length === 0) break;
    }
    this.remakeGrid();
  }

  /** The grid over the chunks read: a window round the player, the world's tiles in it by their flags. */
  private remakeGrid(): void {
    this.gridDirty = false;
    const keys = [...this.data.keys()].filter((k) => this.data.get(k));
    if (keys.length === 0) return;
    const at = keys.map((k) => parseChunkKey(k)!);
    const w = worldRect(this.world);
    const rect: Rect = [
      Math.max(w[0], Math.min(...at.map((c) => c.cx)) * CHUNK),
      Math.max(w[1], Math.min(...at.map((c) => c.cz)) * CHUNK),
      Math.min(w[2], (Math.max(...at.map((c) => c.cx)) + 1) * CHUNK),
      Math.min(w[3], (Math.max(...at.map((c) => c.cz)) + 1) * CHUNK),
    ];
    const grid = new Grid(rect[2] - rect[0], rect[3] - rect[1], rect[0], rect[1]);
    for (const k of keys) {
      const c = this.data.get(k)!;
      for (let j = 0; j < CHUNK; j++) {
        for (let i = 0; i < CHUNK; i++) {
          const x = c.cx * CHUNK + i;
          const z = c.cz * CHUNK + j;
          const t = c.tiles[j * CHUNK + i]!;
          if (!grid.inside(x, z)) continue;
          grid.setWalkable(x, z, !isBlocked(t));
          if (t[0] !== 0) grid.setHeight(x, z, t[0] / 16);
        }
      }
    }
    this.grid = grid;
    this.gridRect = rect;
    this.onGrid(grid);
  }

  /** The rectangle of tiles the grid covers now. */
  get window(): Rect {
    return this.gridRect;
  }
}
