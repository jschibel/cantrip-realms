import * as THREE from "three";
import type { VoxPart } from "./format";

// The greedy mesher: a part's voxels become as few quads as keep its colors. Each plane between two layers of voxels,
// along each axis, is a mask of the faces showing there - a solid voxel's side with nothing beyond it - and runs of the
// same color in that mask are grown into rectangles, first along one axis and then the other. A 6x6x6 head of one
// color is 6 quads, not 216 cubes; a face of two colors is cut where they meet, so the colors stay exact.

/** The palette index of the voxel at x, y, z of a part, or -1 where it is empty or outside the grid. */
export function voxelAt(part: VoxPart, x: number, y: number, z: number): number {
  const [w, h, d] = part.size;
  if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) {
    return -1;
  }
  const char = part.layers[y]?.[z]?.[x];
  if (char === undefined || char === ".") {
    return -1;
  }
  const index = parseInt(char, 36);
  return Number.isNaN(index) ? -1 : index;
}

/**
 * The part's surface as quads: positions in world units with the part's `origin` at 0,0,0 (a voxel `voxel` units on a
 * side), a normal per face, and each vertex colored by `color(palette index)`.
 */
export function greedyMesh(part: VoxPart, color: (index: number) => THREE.Color, voxel: number): THREE.BufferGeometry {
  const dims = part.size;
  const grid = new Int16Array(dims[0] * dims[1] * dims[2]);
  for (let y = 0; y < dims[1]; y++) {
    for (let z = 0; z < dims[2]; z++) {
      for (let x = 0; x < dims[0]; x++) {
        grid[x + dims[0] * (y + dims[1] * z)] = voxelAt(part, x, y, z);
      }
    }
  }
  const at = (p: readonly number[]): number => {
    const [x, y, z] = p as [number, number, number];
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) return -1;
    return grid[x + dims[0] * (y + dims[1] * z)]!;
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const [ox, oy, oz] = part.origin;

  const quad = (corners: number[][], normal: number[], index: number, front: boolean) => {
    const base = positions.length / 3;
    const c = color(index);
    for (const corner of corners) {
      positions.push((corner[0]! - ox) * voxel, (corner[1]! - oy) * voxel, (corner[2]! - oz) * voxel);
      normals.push(normal[0]!, normal[1]!, normal[2]!);
      colors.push(c.r, c.g, c.b);
    }
    if (front) {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  };

  for (let d = 0; d < 3; d++) {
    // u and v run across the plane, so that u x v points along d: a quad wound u then v faces +d.
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const width = dims[u]!;
    const height = dims[v]!;
    const mask = new Int32Array(width * height);
    const p = [0, 0, 0];
    const q = [0, 0, 0];

    for (let k = 0; k <= dims[d]!; k++) {
      for (const front of [true, false]) {
        // front: the +d faces of the layer below the plane (k - 1); otherwise the -d faces of the layer above it (k).
        for (let j = 0; j < height; j++) {
          for (let i = 0; i < width; i++) {
            p[d] = k - 1;
            p[u] = i;
            p[v] = j;
            q[d] = k;
            q[u] = i;
            q[v] = j;
            const below = at(p);
            const above = at(q);
            const shown = front ? (below >= 0 && above < 0 ? below : -1) : above >= 0 && below < 0 ? above : -1;
            mask[i + j * width] = shown;
          }
        }

        for (let j = 0; j < height; j++) {
          for (let i = 0; i < width; ) {
            const c = mask[i + j * width]!;
            if (c < 0) {
              i++;
              continue;
            }
            let w = 1;
            while (i + w < width && mask[i + w + j * width] === c) w++;
            let h = 1;
            grow: while (j + h < height) {
              for (let x = 0; x < w; x++) {
                if (mask[i + x + (j + h) * width] !== c) break grow;
              }
              h++;
            }

            const corner = [0, 0, 0];
            corner[d] = k;
            corner[u] = i;
            corner[v] = j;
            const du = [0, 0, 0];
            du[u] = w;
            const dv = [0, 0, 0];
            dv[v] = h;
            const normal = [0, 0, 0];
            normal[d] = front ? 1 : -1;
            quad(
              [
                corner,
                [corner[0]! + du[0]!, corner[1]! + du[1]!, corner[2]! + du[2]!],
                [corner[0]! + du[0]! + dv[0]!, corner[1]! + du[1]! + dv[1]!, corner[2]! + du[2]! + dv[2]!],
                [corner[0]! + dv[0]!, corner[1]! + dv[1]!, corner[2]! + dv[2]!],
              ],
              normal,
              c,
              front,
            );

            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) mask[i + x + (j + y) * width] = -1;
            }
            i += w;
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
