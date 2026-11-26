import * as THREE from "three";
import { type Material, MeshBuilder, type Model } from "../art/paint/builder";
import { material } from "../art/paint/materials";
import * as T from "../art/paint/textures";
import { HOP, LEDGE, NO_SURFACE, RAMP, TEXELS_PER_TILE, type TileData } from "../world/format";

// The ground's shape: each tile's floor at its height, the bank down to a lower neighbour drawn as a face of rock, and
// a ramp tile sloped from the level before it to the level after it. Heights are whole texels (world/format.ts), so a
// terrace's edge is a whole number of pixels high and its face a band of rock the camera sees head on; a hill is
// terraces, as a 16-bit RPG draws its hills, and a ramp (or a stair of low steps) is the way up one.
//
// A tile's corners are the heights the ground's mesh is drawn at (`cornersOf`); `floorAt` is the same surface sampled
// anywhere, for what stands or walks on it (figures, grass). Everything is read through `tileAt`, so a chunk drawn on
// its own sees its neighbours' edge tiles and its banks meet theirs.

export { RAMP };

/** Reads a tile by world coordinates: null where there is no tile (past the world, or a chunk not loaded). */
export type TileAt = (x: number, z: number) => TileData | null;

const hasGround = (t: TileData | null): t is TileData => t !== null && t[1] !== NO_SURFACE;
const levelOf = (t: TileData): number => t[0] / TEXELS_PER_TILE;
const isRamp = (t: TileData | null): boolean => t !== null && (t[2] & RAMP) !== 0;

/** A tile's four corner heights, world units: north-west, north-east, south-east, south-west. */
export type Corners = readonly [number, number, number, number];

/**
 * The corners of a tile's floor. A flat tile is level at its height. A ramp slopes along the axis it is walked on: the
 * one with more ends walked onto freely (a ramp a step up or down from it, or ground no further than a ledge from it, as
 * world/format.ts `noLedge` walks them), else the one its neighbours differ most on. Each of its two ends meets the neighbour there - at
 * that neighbour's height, or half-way to it where the neighbour is a ramp as well (a ramp of several tiles is one even
 * slope). A neighbour more than a level from it is a cliff beside it, never an end: a road's ramp along a cliff's foot
 * slopes along the road, not up the cliff.
 */
export function cornersOf(tileAt: TileAt, x: number, z: number): Corners {
  const t = tileAt(x, z);
  if (!t) return [0, 0, 0, 0];
  const h = levelOf(t);
  if (!isRamp(t)) return [h, h, h, h];
  const end = (n: TileData | null): { at: number; walked: boolean } => {
    if (!hasGround(n) || Math.abs(n[0] - t[0]) > HOP) return { at: h, walked: false };
    const nh = levelOf(n);
    // (A ramp at its own height beside it is another lane of a wide ramp: a side.)
    return isRamp(n) ? { at: (h + nh) / 2, walked: n[0] !== t[0] } : { at: nh, walked: Math.abs(n[0] - t[0]) <= LEDGE };
  };
  const north = end(tileAt(x, z - 1));
  const south = end(tileAt(x, z + 1));
  const west = end(tileAt(x - 1, z));
  const east = end(tileAt(x + 1, z));
  const along = Number(north.walked) + Number(south.walked) - (Number(west.walked) + Number(east.walked));
  if (along > 0 || (along === 0 && Math.abs(north.at - south.at) >= Math.abs(east.at - west.at))) return [north.at, north.at, south.at, south.at];
  return [west.at, east.at, east.at, west.at];
}

/** The floor's height at a point (world units), the tile's corners blended across it: what a figure stands on. */
export function floorAt(tileAt: TileAt, x: number, z: number): number {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  const t = tileAt(tx, tz);
  if (!t) return 0;
  if (!isRamp(t)) return levelOf(t);
  const [nw, ne, se, sw] = cornersOf(tileAt, tx, tz);
  const fx = x - tx;
  const fz = z - tz;
  return (nw * (1 - fx) + ne * fx) * (1 - fz) + (sw * (1 - fx) + se * fx) * fz;
}

/**
 * Whether a point is within `brink` of a terrace's brink (its tile's edge standing above the neighbour's by more than a
 * kerb's two texels, wherever along the edge) or within `foot` of a bank's foot: where the ground's edges are drawn
 * (render/ground.ts), so no standing grass hides them.
 */
export function nearBank(tileAt: TileAt, x: number, z: number, brink = 0.4, foot = 0.2): boolean {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  const fx = x - tx;
  const fz = z - tz;
  const reach = Math.max(brink, foot);
  const step = 2 / TEXELS_PER_TILE;
  const eps = 1e-3;
  // Each side: its way out, how far the point is from it, and the point on it.
  const sides: readonly (readonly [number, number, number, number, number])[] = [
    [0, -1, fz, x, tz],
    [0, 1, 1 - fz, x, tz + 1],
    [-1, 0, fx, tx, z],
    [1, 0, 1 - fx, tx + 1, z],
  ];
  for (const [dx, dz, d, ex, ez] of sides) {
    if (d >= reach || !hasGround(tileAt(tx + dx, tz + dz))) continue;
    const drop = floorAt(tileAt, ex - dx * eps, ez - dz * eps) - floorAt(tileAt, ex + dx * eps, ez + dz * eps);
    if ((drop > step && d < brink) || (drop < -step && d < foot)) return true;
  }
  return false;
}

/** What `reliefMap` holds for a tile with no ground: no edge is drawn against it. */
export const NO_RELIEF = -65536;

/**
 * The relief of a block of tiles for the ground's shader (render/ground.ts): each tile's four corner heights in texels
 * (`cornersOf` times 16: north-west, north-east, south-east, south-west), `NO_RELIEF` where there is no ground, a row of
 * `cols` tiles from (x0, z0) at a time. The shader reads it to find where a tile's edge drops to a lower neighbour (its
 * brink) or rises to a higher one (its foot), wherever the drop is along the edge - so a ramp, level with the ground at
 * its ends, has neither there.
 */
export function reliefMap(tileAt: TileAt, x0: number, z0: number, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows * 4).fill(NO_RELIEF);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!hasGround(tileAt(x0 + i, z0 + j))) continue;
      const c = cornersOf(tileAt, x0 + i, z0 + j);
      out.set(c.map((h) => h * TEXELS_PER_TILE), (j * cols + i) * 4);
    }
  }
  return out;
}

/** The rock of a bank, unless the surface on top names its own (`cliff`). */
const defaultBank = (): Material => material("bank-rock", () => T.rock(19));

/**
 * The faces of the banks of a block of tiles: where a tile's edge stands above its neighbour's, a face of rock from the
 * one down to the other, facing out of the higher tile. Where there is no neighbour (the world's edge, the dark round a
 * room) the face goes down to the ground's zero. `bankOf(tile)` names a surface's own bank material, if it has one.
 */
export function banksOf(tileAt: TileAt, x0: number, z0: number, cols: number, rows: number, bankOf: (t: TileData) => Material | undefined = () => undefined): Model {
  const b = new MeshBuilder();
  for (let z = z0; z < z0 + rows; z++) {
    for (let x = x0; x < x0 + cols; x++) {
      const t = tileAt(x, z);
      if (!hasGround(t)) continue;
      const mine = cornersOf(tileAt, x, z);
      const mat = bankOf(t) ?? defaultBank();
      const image = mat.map?.image as { width: number; height: number } | undefined;
      const w = (image?.width ?? 32) / 16;
      const h = (image?.height ?? 32) / 16;
      // Each edge: its two ends (corner indices of mine, and of the neighbour's facing them), the neighbour, and the face.
      const edges: { readonly dx: number; readonly dz: number; readonly a: readonly [number, number]; readonly n: readonly [number, number]; readonly ends: readonly [readonly [number, number], readonly [number, number]] }[] = [
        // North edge: from the north-east corner to the north-west, facing north.
        { dx: 0, dz: -1, a: [1, 0], n: [2, 3], ends: [[x + 1, z], [x, z]] },
        // South edge: west to east, facing south.
        { dx: 0, dz: 1, a: [3, 2], n: [0, 1], ends: [[x, z + 1], [x + 1, z + 1]] },
        // West edge: north to south... seen from the west, south-west then north-west.
        { dx: -1, dz: 0, a: [0, 3], n: [1, 2], ends: [[x, z], [x, z + 1]] },
        // East edge: south-east then north-east.
        { dx: 1, dz: 0, a: [2, 1], n: [3, 0], ends: [[x + 1, z + 1], [x + 1, z]] },
      ];
      for (const e of edges) {
        const n = tileAt(x + e.dx, z + e.dz);
        const theirs = hasGround(n) ? cornersOf(tileAt, x + e.dx, z + e.dz) : null;
        const top0 = mine[e.a[0]]!;
        const top1 = mine[e.a[1]]!;
        const bottom0 = theirs ? Math.min(top0, theirs[e.n[0]]!) : Math.min(top0, 0);
        const bottom1 = theirs ? Math.min(top1, theirs[e.n[1]]!) : Math.min(top1, 0);
        if (top0 - bottom0 < 1e-4 && top1 - bottom1 < 1e-4) continue;
        const [p0, p1] = e.ends;
        // The face, counter-clockwise seen from outside: the two bottom ends, then the tops.
        const corners: [number, number, number][] = [
          [p0[0], bottom0, p0[1]],
          [p1[0], bottom1, p1[1]],
          [p1[0], top1, p1[1]],
          [p0[0], top0, p0[1]],
        ];
        // Across the face left to right as it is seen: east along a south face, west along a north one, and so on.
        const along = (c: readonly number[]) => (e.dz !== 0 ? c[0]! * e.dz : -c[2]! * e.dx);
        b.polygon(
          mat,
          corners,
          corners.map((c) => [along(c) / w, c[1] / h] as [number, number]),
        );
      }
    }
  }
  return b.model();
}

/**
 * The floor of a block of tiles as triangles, a quad per tile with ground (corners at `cornersOf`): positions, normals
 * and uvs for the ground's mesh (render/ground.ts paints it).
 */
export function floorGeometry(tileAt: TileAt, x0: number, z0: number, cols: number, rows: number, y = 0): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const n = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let z = z0; z < z0 + rows; z++) {
    for (let x = x0; x < x0 + cols; x++) {
      if (!hasGround(tileAt(x, z))) continue;
      const [nw, ne, se, sw] = cornersOf(tileAt, x, z);
      const base = positions.length / 3;
      positions.push(x, y + sw, z + 1, x + 1, y + se, z + 1, x + 1, y + ne, z, x, y + nw, z);
      // One facing for the whole quad (a ramp is a plane along one axis).
      u.set(1, se - sw, 0);
      v.set(0, nw - sw, -1);
      n.crossVectors(u, v).normalize();
      for (let k = 0; k < 4; k++) normals.push(n.x, n.y, n.z);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
