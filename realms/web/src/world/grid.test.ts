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

describe("hops (format.ts HOP)", () => {
  /** Open ground rising a level (12 texels) at x = 3 and another at x = 6; a two-tile ramp up the first at row 4. */
  function hills(): Grid {
    const g = grid(["........", "........", "........", "........", "........"]);
    for (let z = 0; z < 5; z++) for (let x = 3; x < 8; x++) g.setHeight(x, z, (x < 6 ? 12 : 24) / 16);
    g.setHeight(2, 4, 3 / 16);
    g.setHeight(3, 4, 9 / 16);
    g.setRamp(2, 4, true);
    g.setRamp(3, 4, true);
    return g;
  }

  it("hops a level straight across, up and down, but never on a diagonal, and never two levels", () => {
    const g = hills();
    expect(g.canStep({ x: 2, z: 0 }, { x: 3, z: 0 })).toBe(true);
    expect(g.canStep({ x: 3, z: 0 }, { x: 2, z: 0 })).toBe(true);
    expect(g.hops(2, 0, 3, 0) && !g.passes(2, 0, 3, 0)).toBe(true);
    expect(g.canStep({ x: 2, z: 0 }, { x: 3, z: 1 })).toBe(false);
    expect(g.canStep({ x: 2, z: 1 }, { x: 3, z: 0 })).toBe(false);
    // A level up, then the next: each a hop; from the low ground straight to two levels up, none.
    expect(g.canStep({ x: 5, z: 0 }, { x: 6, z: 0 })).toBe(true);
    g.setHeight(5, 1, 0);
    expect(g.hops(5, 1, 6, 1)).toBe(false);
    expect(g.canStep({ x: 5, z: 1 }, { x: 6, z: 1 })).toBe(false);
  });

  it("is no step for one who does not hop, who goes round by the ramp or finds no way", () => {
    const g = hills();
    expect(g.canStep({ x: 2, z: 0 }, { x: 3, z: 0 }, false)).toBe(false);
    const round = g.path({ x: 1, z: 0 }, { x: 4, z: 0 }, false)!;
    expect(round.some((t) => t.x === 2 && t.z === 4)).toBe(true);
    for (let i = 1; i < round.length; i++) expect(g.canStep(round[i - 1]!, round[i]!, false)).toBe(true);
    expect(g.path({ x: 1, z: 0 }, { x: 7, z: 0 }, false)).toBeNull();
  });

  it("costs the A* more than a step: a ramp about as short is taken, a far one is not", () => {
    const g = hills();
    // Beside the ramp: up it rather than a hop beside it.
    const near = g.path({ x: 1, z: 3 }, { x: 4, z: 3 })!;
    expect(near.some((t) => t.x === 2 && t.z === 4)).toBe(true);
    // Far from it: straight over the ledge, a hop.
    const far = g.path({ x: 1, z: 0 }, { x: 4, z: 0 })!;
    expect(far.map((t) => [t.x, t.z])).toEqual([[1, 0], [2, 0], [3, 0], [4, 0]]);
    // And on up the next level too, a hop each.
    expect(g.path({ x: 1, z: 0 }, { x: 7, z: 0 })!.length).toBe(7);
  });
});
