import { describe, expect, it } from "vitest";
import vectors from "../../../content/walk-vectors.json";
import { Grid } from "./grid";

// The golden vectors of walking on squares (realms/content/walk-vectors.json, tools/realms/walk-vectors.ts), which the
// realm server's tests check too (realms/dotnet/Cantrip.Realms.Server.Tests/WalkTests.cs): the paths the A* finds, and
// which walks are walks - the rule the server holds a presence walk to.

type XZ = readonly [number, number];

function gridOf(g: { x0: number; z0: number; rows: readonly string[] }): Grid {
  const grid = new Grid(g.rows[0]!.length, g.rows.length, g.x0, g.z0);
  g.rows.forEach((row, z) => [...row].forEach((c, x) => grid.setWalkable(g.x0 + x, g.z0 + z, c === ".")));
  return grid;
}

/** Whether the A* takes a step straight: from one tile to the next, a step of eight ways, it finds no other way. */
function steps(grid: Grid, from: XZ, to: XZ): boolean {
  if (Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) !== 1) return false;
  const path = grid.path({ x: from[0], z: from[1] }, { x: to[0], z: to[1] });
  return path !== null && path.length === 2;
}

describe("walking on squares", () => {
  it("has golden vectors to check", () => {
    expect(vectors.grids.length).toBeGreaterThan(0);
  });

  for (const g of vectors.grids) {
    const grid = gridOf(g);
    describe(g.name, () => {
      for (const p of g.paths) {
        it(`finds the path from (${p.from}) to (${p.to})`, () => {
          const path = grid.path({ x: p.from[0]!, z: p.from[1]! }, { x: p.to[0]!, z: p.to[1]! });
          expect(path?.map((t) => [t.x, t.z]) ?? null).toEqual(p.path);
        });
      }

      for (const w of g.walks) {
        it(`${w.ok ? "takes" : "refuses"} the walk ${JSON.stringify(w.walk)}`, () => {
          const walk = w.walk as unknown as XZ[];
          const ok = grid.walkable(walk[0]![0], walk[0]![1]) && walk.slice(1).every((to, i) => steps(grid, walk[i]!, to));
          expect(ok).toBe(w.ok);
        });
      }
    });
  }
});
