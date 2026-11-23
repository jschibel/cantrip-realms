import * as THREE from "three";
import { describe, expect, it } from "vitest";
import * as C from "../art/paint/colors";
import * as R from "../art/paint/ramps";
import { SURFACES } from "../art/surfaces";
import { grassField, tuftAtlas } from "./grass";

// Standing grass (grass.ts): each tile's tufts in its surface's ramp - plains gold-green, marsh reeds, tundra frost -
// one instanced mesh for a block whatever ramps it holds, flowers only in the green.

describe("standing grass", () => {
  it("paints each tile's tufts in its own ramp, a row of the picture each", () => {
    const ramps = [undefined, R.PLAINS, R.TUNDRA];
    const field = grassField(3, 1, { x: 0, z: 0 }, () => 6, 9, () => 0, (x) => ramps[x]);
    const variant = field.mesh.geometry.getAttribute("variant");
    // Three ramps: the green at the top row of the picture (row 2 counted up from the bottom), then plains, then tundra.
    const rows = new Map<number, Set<number>>();
    const cols = new Map<number, Set<number>>();
    const m = new THREE.Matrix4();
    for (let i = 0; i < variant.count; i++) {
      field.mesh.getMatrixAt(i, m);
      const tile = Math.floor(m.elements[12]!);
      (rows.get(tile) ?? rows.set(tile, new Set()).get(tile)!).add(variant.getY(i));
      (cols.get(tile) ?? cols.set(tile, new Set()).get(tile)!).add(variant.getX(i));
    }
    expect([...rows.get(0)!]).toEqual([2]);
    expect([...rows.get(1)!]).toEqual([1]);
    expect([...rows.get(2)!]).toEqual([0]);
    // Flowers (variants 2 and 3) only in the green.
    expect([...cols.get(1)!, ...cols.get(2)!].every((v) => v < 2)).toBe(true);
  });

  it("stands where it did before ramps: the same tufts, the same places, for the green", () => {
    const a = grassField(8, 8, { x: 0, z: 0 }, () => 3, 5);
    const b = grassField(8, 8, { x: 0, z: 0 }, () => 3, 5, () => 0, () => C.GRASS);
    expect(b.mesh.count).toBe(a.mesh.count);
    expect([...b.mesh.instanceMatrix.array]).toEqual([...a.mesh.instanceMatrix.array]);
  });

  it("paints a picture row per ramp, in the ramp's colors", () => {
    const p = tuftAtlas([C.GRASS, R.REED]);
    expect([p.width, p.height]).toEqual([32, 12]);
    // The bottom row of the first variant is its darkest blade color: ramp[3].
    expect(p.get(0, 5)).toBe(C.GRASS[3]);
    expect(p.get(0, 11)).toBe(R.REED[3]);
  });

  it("gives the surfaces that should have tufts their ramp: plains, marsh and now tundra", () => {
    for (const id of ["plains", "marsh", "tundra"]) {
      const look = SURFACES.look(id);
      expect(look.tufts, id).toBeGreaterThan(0);
      expect(look.tuftRamp, id).toBeDefined();
    }
  });
});
