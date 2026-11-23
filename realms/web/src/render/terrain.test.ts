import { describe, expect, it } from "vitest";
import type { TileData } from "../world/format";
import { RAMP, banksOf, cornersOf, floorAt } from "./terrain";

// The ground's shape (terrain.ts): terraces' banks, ramps' slopes, the floor a figure stands on.

/** A little world of tiles from rows of heights (texels), every tile grass; `r` marks a ramp. */
function tiles(rows: string[][]): (x: number, z: number) => TileData | null {
  return (x, z) => {
    const cell = rows[z]?.[x];
    if (cell === undefined) return null;
    const ramp = cell.endsWith("r");
    return [Number(ramp ? cell.slice(0, -1) : cell), "grass", ramp ? RAMP : 0];
  };
}

describe("terrain", () => {
  it("draws a bank of rock on each side of a raised tile, down to its neighbours", () => {
    const at = tiles([
      ["0", "0", "0"],
      ["0", "12", "0"],
      ["0", "0", "0"],
    ]);
    const model = banksOf(at, 0, 0, 3, 3);
    const tris = model.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    expect(tris).toBe(8);
    // Every face of it stands from the ground to 0.75.
    const ys = new Set(model.parts.flatMap((p) => p.positions.filter((_, i) => i % 3 === 1)));
    expect([...ys].sort()).toEqual([0, 0.75]);
    // Each faces out of the tile: the normals' horizontal parts point away from its middle.
    for (const p of model.parts) {
      for (let i = 0; i < p.positions.length; i += 3) {
        const out = (p.positions[i]! - 1.5) * p.normals[i]! + (p.positions[i + 2]! - 1.5) * p.normals[i + 2]!;
        expect(out).toBeGreaterThan(0);
      }
    }
  });

  it("slopes a run of ramps evenly from one level to the next, and stands a figure on the slope", () => {
    const at = tiles([["0", "6r", "12"]]);
    expect(cornersOf(at, 1, 0)).toEqual([0, 0.75, 0.75, 0]);
    expect(floorAt(at, 1.5, 0.5)).toBeCloseTo(0.375, 9);
    expect(floorAt(at, 2.5, 0.5)).toBe(0.75);
    // No bank where the ramp meets the levels it joins.
    const model = banksOf(at, 1, 0, 1, 1);
    const sides = model.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    // Only its open north and south sides (no tiles there) drop to the ground.
    expect(sides).toBeGreaterThan(0);
    const ew = banksOf(tiles([["0", "6r", "12"], ["0", "6r", "12"]]), 1, 0, 1, 1).parts.flatMap((p) => p.normals.filter((_, i) => i % 3 === 0));
    expect(ew.every((n) => Math.abs(n) < 1e-9)).toBe(true);
  });
});
