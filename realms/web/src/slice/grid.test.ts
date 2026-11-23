import { describe, expect, it } from "vitest";
import { Grid } from "./grid";

function grid(rows: string[]): Grid {
  const g = new Grid(rows[0]!.length, rows.length);
  rows.forEach((row, z) => [...row].forEach((c, x) => g.setWalkable(x, z, c === ".")));
  return g;
}

describe("square-grid A*", () => {
  it("walks diagonally across open ground", () => {
    const g = grid(["....", "....", "....", "...."]);
    const path = g.path({ x: 0, z: 0 }, { x: 3, z: 3 })!;
    expect(path).toHaveLength(4);
    expect(path.at(-1)).toEqual({ x: 3, z: 3 });
  });

  it("goes round a wall and never cuts its corner", () => {
    const g = grid(["....", ".##.", "....", "...."]);
    const path = g.path({ x: 0, z: 0 }, { x: 2, z: 2 })!;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      expect(g.walkable(b.x, b.z)).toBe(true);
      if (a.x !== b.x && a.z !== b.z) {
        expect(g.walkable(b.x, a.z) && g.walkable(a.x, b.z)).toBe(true);
      }
    }
  });

  it("names tiles by world coordinates, negative ones too", () => {
    const g = new Grid(6, 4, -3, -2);
    for (let z = -2; z < 2; z++) for (let x = -3; x < 3; x++) g.setWalkable(x, z, true);
    g.block(0, -2, 0, 0);
    expect(g.walkable(-3, -2) && !g.walkable(-4, -2) && !g.walkable(0, -1)).toBe(true);
    const path = g.path({ x: -2, z: -1 }, { x: 2, z: -1 })!;
    expect(path[0]).toEqual({ x: -2, z: -1 });
    expect(path.at(-1)).toEqual({ x: 2, z: -1 });
    expect(path.some((t) => t.z === 1)).toBe(true);
  });

  it("finds no way to a closed tile or a sealed room", () => {
    const g = grid([".#..", "##..", "...."]);
    expect(g.path({ x: 0, z: 0 }, { x: 3, z: 2 })).toBeNull();
    expect(g.path({ x: 3, z: 2 }, { x: 1, z: 0 })).toBeNull();
  });
});
