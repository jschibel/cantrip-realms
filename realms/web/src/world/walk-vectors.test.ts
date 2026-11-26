import { describe, expect, it } from "vitest";
import vectors from "../../../content/walk-vectors.json";
import { Grid } from "./grid";

// The golden vectors of walking on squares (realms/content/walk-vectors.json, tools/realms/walk-vectors.ts), which the
// realm server's tests check too (realms/dotnet/Cantrip.Realms.Server.Tests/WalkTests.cs): the paths the A* finds, and
// which walks are walks - the rule the server holds a presence walk to, ledges, hops and ramps included; a player's,
// who hops, and (cases marked `hops: false`) one's who does not.

type XZ = readonly [number, number];

function gridOf(g: { x0: number; z0: number; rows: readonly string[]; heights?: readonly (readonly number[])[]; ramps?: readonly string[] }): Grid {
  const grid = new Grid(g.rows[0]!.length, g.rows.length, g.x0, g.z0);
  g.rows.forEach((row, z) => [...row].forEach((c, x) => grid.setWalkable(g.x0 + x, g.z0 + z, c === ".")));
  g.heights?.forEach((row, z) => row.forEach((h, x) => grid.setHeight(g.x0 + x, g.z0 + z, h / 16)));
  g.ramps?.forEach((row, z) => [...row].forEach((c, x) => grid.setRamp(g.x0 + x, g.z0 + z, c === "r")));
  return grid;
}

/** Whether a step is one of the grid's (`canStep`), and the A* finds a way along it. */
function steps(grid: Grid, from: XZ, to: XZ, hops: boolean): boolean {
  const ok = grid.canStep({ x: from[0], z: from[1] }, { x: to[0], z: to[1] }, hops);
  if (ok) expect(grid.path({ x: from[0], z: from[1] }, { x: to[0], z: to[1] }, hops)).not.toBeNull();
  return ok;
}

describe("walking on squares", () => {
  it("has golden vectors to check", () => {
    expect(vectors.grids.length).toBeGreaterThan(0);
  });

  for (const g of vectors.grids) {
    const grid = gridOf(g);
    describe(g.name, () => {
      for (const p of g.paths as { from: number[]; to: number[]; hops?: boolean; path: number[][] | null }[]) {
        const hops = p.hops ?? true;
        it(`finds the path from (${p.from}) to (${p.to})${hops ? "" : " for one who does not hop"}`, () => {
          const path = grid.path({ x: p.from[0]!, z: p.from[1]! }, { x: p.to[0]!, z: p.to[1]! }, hops);
          expect(path?.map((t) => [t.x, t.z]) ?? null).toEqual(p.path);
        });
      }

      for (const w of g.walks as { walk: number[][]; hops?: boolean; ok: boolean }[]) {
        const hops = w.hops ?? true;
        it(`${w.ok ? "takes" : "refuses"} the walk ${JSON.stringify(w.walk)}${hops ? "" : " of one who does not hop"}`, () => {
          const walk = w.walk as unknown as XZ[];
          const ok = grid.walkable(walk[0]![0], walk[0]![1]) && walk.slice(1).every((to, i) => steps(grid, walk[i]!, to, hops));
          expect(ok).toBe(w.ok);
        });
      }
    });
  }
});
