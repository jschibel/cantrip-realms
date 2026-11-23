import { BUILDINGS } from "../art/buildings";
import { MeshBuilder } from "../art/paint/builder";
import { namedPalette } from "../art/paint/palette";
import { PROPS } from "../art/props";
import type { Built } from "../art/recipe";
import { ROOMS } from "../art/rooms";
import { SURFACES, type SurfaceLook } from "../art/surfaces";
import {
  type ChunkData,
  type InteriorData,
  NO_SURFACE,
  type Rect,
  type TileData,
  type WorldData,
  type XYZ,
  type XZ,
  chunkTile,
  frontStep,
  heightOf,
  interiorArea,
  isBare,
  viewBounds,
  worldRect,
} from "../world/format";
import { grassField } from "./grass";
import { buildGround } from "./ground";
import { Place } from "./place";

// From the world data to what the renderer draws: the one place where world ids meet the art registries. A world's
// chunks, or an interior, become a `Place` - its ground from the tiles' surfaces, every building, room and prop from its
// recipe, its lights, and (out of doors) its sun and standing grass - and the doors in it, for the page to walk through.
//
// Phase 1 draws the loaded chunks as one place, their scenery merged into one group: a streaming renderer draws each
// chunk apart (and drops the far ones), calling the same recipes.

/** The open air's backdrop, where no ground is drawn. */
export const OUTDOOR_BACKGROUND = "#1a2a22";
/** The dark round a room. */
export const INDOOR_BACKGROUND = "#000000";

/** A door in a place: stand on `tile` and step `step` to go through to `to` (an interior's id); `at` is the doorway. */
export interface DoorSpot {
  readonly tile: XZ;
  readonly step: XZ;
  readonly to: string;
  readonly at: XYZ;
}

export interface AssembledWorld {
  readonly place: Place;
  readonly doors: readonly DoorSpot[];
  /** The rectangle the camera keeps its view within. */
  readonly bounds: Rect;
}

export interface AssembledRoom {
  readonly place: Place;
  /** Where its way out is: the iris closes on it going out. */
  readonly doorway: XYZ;
  readonly bounds: Rect;
}

/** The surfaces a block of tiles uses, numbered in the order met (row by row), with their looks. */
function groundOf(rows: number, cols: number, tileAt: (col: number, row: number) => TileData | null): { ids: number[][]; looks: SurfaceLook[] } {
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
        looks.push(SURFACES.look(s));
      }
      row.push(k);
    }
    ids.push(row);
  }
  return { ids, looks };
}

/** What lies under the holes (a stream's water), a quad under each, as one model. */
function underOf(ids: readonly (readonly number[])[], looks: readonly SurfaceLook[], x0: number, z0: number): Built {
  const b = new MeshBuilder();
  ids.forEach((row, j) =>
    row.forEach((k, i) => {
      const under = k >= 0 ? looks[k]!.under : undefined;
      if (!under) return;
      const x = x0 + i;
      const z = z0 + j;
      const [xa, xb, za, zb, y] = [x - under.spread, x + 1 + under.spread, z - under.spread, z + 1 + under.spread, under.y];
      b.quad({ mat: under.material }, [[xa, y, zb], [xb, y, zb], [xb, y, za], [xa, y, za]], (c) => c[0], (c) => -c[2]);
    }),
  );
  return { model: b.model() };
}

/** A building's recipe, its palette its own over its style's. */
const buildingOf = (bd: ChunkData["buildings"][number]): Built => BUILDINGS.build(bd.style, bd, namedPalette(bd.palette));
const propOf = (p: ChunkData["props"][number]): Built => PROPS.build(p.id, p, namedPalette(p.tint));

/**
 * The world's chunks as one place: the ground over them all (texels counted from the world's origin), each chunk's
 * buildings and props (in chunk order, row by row), the water under the streams, the sun and the standing grass.
 */
export function assembleWorld(world: WorldData, chunks: readonly ChunkData[]): AssembledWorld {
  const ordered = [...chunks].sort((a, b) => a.cz - b.cz || a.cx - b.cx);
  const place = new Place(OUTDOOR_BACKGROUND);
  if (ordered.length === 0) return { place, doors: [], bounds: viewBounds(world) };
  const cx0 = Math.min(...ordered.map((c) => c.cx));
  const cz0 = Math.min(...ordered.map((c) => c.cz));
  const cx1 = Math.max(...ordered.map((c) => c.cx)) + 1;
  const cz1 = Math.max(...ordered.map((c) => c.cz)) + 1;
  const size = world.chunk;
  const byKey = new Map(ordered.map((c) => [`${c.cx}_${c.cz}`, c]));
  const tileAt = (x: number, z: number): TileData | null => {
    const c = byKey.get(`${Math.floor(x / size)}_${Math.floor(z / size)}`);
    return c ? chunkTile(c, x, z) : null;
  };
  const x0 = cx0 * size;
  const z0 = cz0 * size;
  const rect = worldRect(world);
  const { ids, looks } = groundOf((cz1 - cz0) * size, (cx1 - cx0) * size, (i, j) => tileAt(x0 + i, z0 + j));
  place.addGround(buildGround(ids, looks.map((l) => ({ picture: l.picture, priority: l.priority, hole: l.hole })), { x: x0, z: z0 }, 0, { x: rect[0], z: rect[1] }));

  const pieces: Built[] = [];
  const doors: DoorSpot[] = [];
  for (const c of ordered) {
    for (const bd of c.buildings) {
      const built = buildingOf(bd);
      pieces.push(built);
      if (bd.door && bd.interior && built.doorway) {
        const [fx, fz] = frontStep(bd.rot);
        doors.push({ tile: bd.door, step: [-fx, -fz], to: bd.interior, at: built.doorway });
      }
    }
    for (const p of c.props) pieces.push(propOf(p));
  }
  pieces.push(underOf(ids, looks, x0, z0));
  place.addPieces(pieces, "scenery");
  for (const c of ordered) for (const l of c.lights ?? []) place.addLight(l);

  // The sun over the world's middle, its shadows reaching past its edges.
  place.addSun((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2, Math.ceil(Math.max(world.size[0], world.size[1]) / 2) + 4);
  // Standing grass over the world, on tufted surfaces where nothing stands.
  const tufts = new Map(looks.map((l, k) => [k, l.tufts ?? 0]));
  const ww = rect[2] - rect[0];
  const wh = rect[3] - rect[1];
  place.addGrass(
    grassField(
      ww,
      wh,
      { x: rect[0], z: rect[1] },
      (i, j) => {
        const t = tileAt(rect[0] + i, rect[1] + j);
        if (!t || isBare(t)) return 0;
        const k = ids[rect[1] + j - z0]![rect[0] + i - x0]!;
        return k < 0 ? 0 : tufts.get(k)!;
      },
      9,
      (x, z) => {
        const t = tileAt(x, z);
        return t ? heightOf(t) : 0;
      },
    ),
  );
  return { place, doors, bounds: viewBounds(world) };
}

/** An interior as a place: its floor, its room's shell and light, its furniture and its lights. */
export function assembleInterior(room: InteriorData): AssembledRoom {
  const place = new Place(INDOOR_BACKGROUND);
  const area = interiorArea(room);
  const cols = area[2] - area[0];
  const { ids, looks } = groundOf(area[3] - area[1], cols, (i, j) => room.tiles[j * cols + i] ?? null);
  place.addGround(buildGround(ids, looks.map((l) => ({ picture: l.picture, priority: l.priority, hole: l.hole })), { x: area[0], z: area[1] }, 0, { x: 0, z: 0 }));
  const shell = ROOMS.build(room.kind, room);
  place.addPieces([shell, ...room.props.map(propOf), underOf(ids, looks, area[0], area[1])], room.id);
  for (const l of shell.lights ?? []) place.addLight(l);
  for (const l of room.lights ?? []) place.addLight(l);
  return { place, doorway: shell.doorway ?? [room.entry[0], 1, room.d], bounds: shell.bounds ?? [0, 0, room.w, room.d] };
}
