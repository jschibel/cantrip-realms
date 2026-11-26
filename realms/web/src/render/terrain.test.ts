import { describe, expect, it } from "vitest";
import type { TileData } from "../world/format";
import { NO_RELIEF, RAMP, banksOf, cornersOf, floorAt, nearBank, reliefMap } from "./terrain";

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

  it("slopes a road's ramp along the road, never up a cliff or a terrace beside it", () => {
    // A road coming down from 48 to 36 eastward on two ramps along the middle row, a lower terrace north of it and a cliff
    // of scree (72) at the second ramp's south (the Domains' travel map, where a pass runs along a range's foot).
    const at = tiles([
      ["48", "36", "36", "36"],
      ["48", "45r", "39r", "36"],
      ["48", "48", "72", "36"],
    ]);
    expect(cornersOf(at, 1, 1)).toEqual([3, 2.625, 2.625, 3]);
    expect(cornersOf(at, 2, 1)).toEqual([2.625, 2.25, 2.25, 2.625]);
    // Walked along the road, the floor runs evenly down from 48 to 36 texels: no step where one tile meets the next.
    for (let x = 0.5; x < 3.5; x += 0.01) {
      const a = floorAt(at, x, 1.5);
      const b = floorAt(at, x + 0.01, 1.5);
      expect(Math.abs(b - a), `at ${x.toFixed(2)}`).toBeLessThan(0.01);
    }
  });

  it("maps a block's relief for the ground's shader: every tile's corners in texels, nothing where there is no ground", () => {
    const at = tiles([["0", "6r", "12"], ["24", "12", "12"]]);
    const relief = reliefMap(at, 0, 0, 4, 2);
    const tile = (i: number, j: number) => [...relief.subarray((j * 4 + i) * 4, (j * 4 + i) * 4 + 4)];
    expect(tile(0, 1)).toEqual([24, 24, 24, 24]);
    // The ramp from its corners: level with each end, so no brink or foot is drawn where it meets them.
    expect(tile(1, 0)).toEqual(cornersOf(at, 1, 0).map((h) => h * 16));
    expect(tile(1, 0)[0]).toBe(0);
    expect(tile(1, 0)[1]).toBe(12);
    // Past the tiles: no ground.
    expect(tile(3, 0)).toEqual([NO_RELIEF, NO_RELIEF, NO_RELIEF, NO_RELIEF]);
  });

  it("knows where a terrace's brink and its bank's foot are, so no grass stands over them", () => {
    const at = tiles([["0", "0", "0"], ["0", "12", "0"], ["0", "0", "0"]]);
    // On the raised tile, near its edge: the brink; in its middle, none.
    expect(nearBank(at, 1.1, 1.5)).toBe(true);
    expect(nearBank(at, 1.5, 1.95)).toBe(true);
    expect(nearBank(at, 1.5, 1.5)).toBe(false);
    // Below, close to the bank: its foot; a little further, not.
    expect(nearBank(at, 0.9, 1.5)).toBe(true);
    expect(nearBank(at, 0.7, 1.5)).toBe(false);
    // A kerb of two texels is no bank, and a ramp meets its levels with none.
    expect(nearBank(tiles([["0", "2"]]), 1.05, 0.5)).toBe(false);
    expect(nearBank(tiles([["0", "6r", "12"]]), 1.95, 0.5)).toBe(false);
    expect(nearBank(tiles([["0", "6r", "12"]]), 1.05, 0.5)).toBe(false);
  });
});
