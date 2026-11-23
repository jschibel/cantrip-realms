import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { VoxPart } from "./format";
import { greedyMesh, voxelAt } from "./mesher";

const part = (size: [number, number, number], layers: string[][], origin: [number, number, number] = [0, 0, 0]): VoxPart => ({
  name: "test",
  pivot: [0, 0, 0],
  origin,
  size,
  layers,
});

const palette = [new THREE.Color("#ff0000"), new THREE.Color("#00ff00"), new THREE.Color("#0000ff")];
const color = (i: number) => palette[i] ?? new THREE.Color("#ffffff");
const quads = (g: THREE.BufferGeometry) => g.getIndex()!.count / 6;

describe("greedy mesher", () => {
  it("reads voxels by palette index, with empties and the outside as -1", () => {
    const p = part([2, 1, 1], [["0z"]]);
    expect(voxelAt(p, 0, 0, 0)).toBe(0);
    expect(voxelAt(p, 1, 0, 0)).toBe(35);
    expect(voxelAt(p, 2, 0, 0)).toBe(-1);
    expect(voxelAt(part([1, 1, 1], [["."]]), 0, 0, 0)).toBe(-1);
  });

  it("makes a solid box of one color six quads", () => {
    const box = part([3, 2, 4], [["000", "000", "000", "000"], ["000", "000", "000", "000"]]);
    const g = greedyMesh(box, color, 1);
    expect(quads(g)).toBe(6);
    expect(g.getIndex()!.count / 3).toBe(12);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.toArray()).toEqual([0, 0, 0]);
    expect(g.boundingBox!.max.toArray()).toEqual([3, 2, 4]);
  });

  it("splits faces where colors meet", () => {
    const g = greedyMesh(part([2, 1, 1], [["01"]]), color, 1);
    // Top, bottom, front and back are cut in two; the two ends are one each; the face between them is hidden.
    expect(quads(g)).toBe(10);
    const colors = g.getAttribute("color");
    const seen = new Set<string>();
    for (let i = 0; i < colors.count; i++) seen.add(`${colors.getX(i)},${colors.getY(i)},${colors.getZ(i)}`);
    expect(seen).toEqual(new Set(["1,0,0", "0,1,0"]));
  });

  it("culls faces between solid voxels", () => {
    // Two cubes apart are twelve quads; joined, the faces between them go and the rest merge: six.
    expect(quads(greedyMesh(part([3, 1, 1], [["0.0"]]), color, 1))).toBe(12);
    expect(quads(greedyMesh(part([2, 1, 1], [["00"]]), color, 1))).toBe(6);
    // A 3x3x3 cube has an inner voxel that adds nothing.
    const solid = Array.from({ length: 3 }, () => ["000", "000", "000"]);
    expect(quads(greedyMesh(part([3, 3, 3], solid), color, 1))).toBe(6);
  });

  it("faces each quad outwards", () => {
    const g = greedyMesh(part([1, 1, 1], [["0"]], [0.5, 0.5, 0.5]), color, 1);
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const index = g.getIndex()!;
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)].map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
      const winding = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!));
      const normal = new THREE.Vector3().fromBufferAttribute(nor, index.getX(t));
      expect(winding.dot(normal)).toBeGreaterThan(0);
      // The cube is centred, so an outward face's centre lies along its normal.
      expect(a!.clone().add(b!).add(c!).dot(normal)).toBeGreaterThan(0);
    }
  });

  it("puts the part's origin at 0,0,0 and scales by the voxel size", () => {
    const g = greedyMesh(part([2, 4, 2], Array.from({ length: 4 }, () => ["00", "00"]), [1, 4, 1]), color, 1 / 16);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.toArray()).toEqual([-1 / 16, -4 / 16, -1 / 16]);
    expect(g.boundingBox!.max.toArray()).toEqual([1 / 16, 0, 1 / 16]);
  });
});
