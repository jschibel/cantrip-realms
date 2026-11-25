import { describe, expect, it } from "vitest";
import { Grid } from "../world/grid";
import { BODY, canStep, clear, fits, legClear, slide, smooth } from "./motion";

function grid(rows: string[]): Grid {
  const g = new Grid(rows[0]!.length, rows.length);
  rows.forEach((row, z) => [...row].forEach((c, x) => g.setWalkable(x, z, c === ".")));
  return g;
}

const openOf = (g: Grid) => (x: number, z: number) => g.walkable(x, z);

/** Walks a body from a point toward another a sixtieth at a time at 4.2 tiles a second, as a held walk does. */
function hold(g: Grid, from: { x: number; z: number }, to: { x: number; z: number }, frames: number) {
  const open = openOf(g);
  const out = [from];
  let p = from;
  for (let i = 0; i < frames; i++) {
    const dx = to.x - p.x;
    const dz = to.z - p.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, 4.2 / 60);
    p = d < 1e-9 ? p : slide(open, p.x, p.z, (dx / d) * step, (dz / d) * step);
    out.push(p);
  }
  return out;
}

describe("the player's body between tile middles", () => {
  it("walks straight across open ground", () => {
    const g = grid(["......", "......", "......"]);
    expect(slide(openOf(g), 0.5, 0.5, 2, 1)).toEqual({ x: 2.5, z: 1.5 });
  });

  it("stops flush against a wall it walks into, and slides along it what it walks along it", () => {
    const g = grid(["......", "......", "######"]);
    const open = openOf(g);
    // Straight into the wall: no further than the body's half from it.
    expect(slide(open, 2.5, 1.5, 0, 1).z).toBeCloseTo(2 - BODY, 9);
    // At it slantwise: stopped across, the part along it kept.
    const p = slide(open, 2.5, 1.5, 0.5, 0.5);
    expect(p.z).toBeCloseTo(2 - BODY, 9);
    expect(p.x).toBeCloseTo(3, 9);
  });

  it("never overlaps a closed tile, whatever the move", () => {
    const g = grid(["........", "..#..#..", "..#.##..", "...#....", "........"]);
    const open = openOf(g);
    let p = { x: 0.5, z: 0.5 };
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 4000; i++) {
      p = slide(open, p.x, p.z, rand() * 0.3, rand() * 0.3);
      expect(fits(open, p.x, p.z), `at ${p.x},${p.z}`).toBe(true);
    }
  });

  it("never squeezes through two closed tiles meeting at a corner, which the grid never cuts", () => {
    const g = grid(["....", ".#..", "..#.", "...."]);
    // From the open tile at (2, 1) to the one at (1, 2): the body is stopped, never crossing the corner between them.
    const walked = hold(g, { x: 2.5, z: 1.5 }, { x: 1.5, z: 2.5 }, 120);
    for (const p of walked) expect(Math.floor(p.x) === 1 && Math.floor(p.z) === 2).toBe(false);
  });

  it("turns round a corner it only brushes, into a one-tile alley", () => {
    const g = grid(["......", "......", "###.##", "###.##", "......"]);
    // Walking south a little off the alley's line: it goes down the alley, not stopped on its corner.
    const walked = hold(g, { x: 3.7, z: 0.5 }, { x: 3.7, z: 4.5 }, 120);
    expect(walked.at(-1)!.z).toBeGreaterThan(4);
  });

  it("held at a point inside a building, slides along its wall to the nearest place and stays there without a jitter", () => {
    const g = grid(["..........", "..........", "...####...", "...####...", ".........."]);
    const walked = hold(g, { x: 0.5, z: 0.5 }, { x: 5, z: 3 }, 240);
    const last = walked.slice(-30);
    // Come to rest: what is left is a creep too small to see, the rest of the way along the wall, never back.
    for (let i = 1; i < last.length; i++) expect(Math.hypot(last[i]!.x - last[i - 1]!.x, last[i]!.z - last[i - 1]!.z)).toBeLessThan(1e-3);
    expect(last.at(-1)!.z).toBeCloseTo(2 - BODY, 9);
    // And never turned back on the way: each step heads on from the one before.
    for (let i = 2; i < walked.length; i++) {
      const u = { x: walked[i - 1]!.x - walked[i - 2]!.x, z: walked[i - 1]!.z - walked[i - 2]!.z };
      const v = { x: walked[i]!.x - walked[i - 1]!.x, z: walked[i]!.z - walked[i - 1]!.z };
      expect(u.x * v.x + u.z * v.z).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("walks no further in a frame than asked", () => {
    const g = grid(["......", "..#...", "......"]);
    const open = openOf(g);
    for (const [x, z, dx, dz] of [[1.5, 1.5, 0.07, 0.01], [1.69, 0.8, 0.05, 0.05], [1.2, 0.69, 0.06, 0.03]] as const) {
      const p = slide(open, x, z, dx, dz);
      expect(Math.hypot(p.x - x, p.z - z)).toBeLessThanOrEqual(Math.hypot(dx, dz) + 1e-12);
    }
  });
});

describe("a click's walk pulled straight", () => {
  it("is one straight leg where the line is clear, the grid's diagonal-then-straight path notwithstanding", () => {
    const g = grid(["........", "........", "........", "........"]);
    const route = g.path({ x: 0, z: 0 }, { x: 6, z: 2 })!;
    expect(route.length).toBeGreaterThan(2);
    expect(smooth(openOf(g), { x: 0.5, z: 0.5 }, route)).toEqual([{ x: 6.5, z: 2.5 }]);
  });

  it("goes round a building in straight legs, each clear of it", () => {
    const g = grid(["..........", "..........", "...####...", "...####...", "...####...", ".........."]);
    const open = openOf(g);
    const route = g.path({ x: 1, z: 5 }, { x: 8, z: 0 })!;
    const legs = smooth(open, { x: 1.5, z: 5.5 }, route);
    expect(legs.length).toBeLessThan(route.length - 1);
    let at = { x: 1.5, z: 5.5 };
    for (const p of legs) {
      expect(clear(open, at, p)).toBe(true);
      at = p;
    }
    expect(at).toEqual({ x: 8.5, z: 0.5 });
  });

  it("from a body standing off its tile's middle by a wall, goes to the middle first when the first step is not clear", () => {
    const g = grid(["...", "#..", "..."]);
    const open = openOf(g);
    // On (1, 0) by its west edge, overlapping the open (0, 0): straight at (1, 1) it would clip the closed (0, 1).
    const from = { x: 1.25, z: 0.65 };
    expect(fits(open, from.x, from.z)).toBe(true);
    const route = g.path({ x: 1, z: 0 }, { x: 0, z: 2 })!;
    expect(clear(open, from, { x: 1.5, z: 1.5 })).toBe(false);
    const legs = smooth(open, from, route);
    expect(legs[0]).toEqual({ x: 1.5, z: 0.5 });
    let at = from;
    for (const p of legs) {
      expect(clear(open, at, p)).toBe(true);
      at = p;
    }
  });

  it("is legs the server takes: each crosses tiles a step of the grid's apart, its corners never cut", () => {
    const g = grid(["..........", "..........", "...####...", "...####...", "...####...", ".........."]);
    const open = openOf(g);
    const from = { x: 1.5, z: 5.5 };
    const route = g.path({ x: 1, z: 5 }, { x: 8, z: 0 })!;
    let at = from;
    for (const p of smooth(open, from, route)) {
      expect(legClear(open, at, p), `${at.x},${at.z} to ${p.x},${p.z}`).toBe(true);
      at = p;
    }
    expect(at).toEqual({ x: 8.5, z: 0.5 });
    // Through the block's corner, and a slant that clips it: not walks; a slant past it is.
    expect(legClear(open, { x: 2.5, z: 1.5 }, { x: 3.5, z: 2.5 })).toBe(false);
    expect(legClear(open, { x: 2.5, z: 1.5 }, { x: 3.9, z: 2.5 })).toBe(false);
    expect(legClear(open, { x: 2.5, z: 1.5 }, { x: 4.5, z: 1.9 })).toBe(true);
    expect(legClear(open, { x: 2.5, z: 0.5 }, { x: 9.5, z: 1.5 })).toBe(true);
  });

  it("walks only lines the server takes, however it is steered round what is in the way", () => {
    const g = grid(["..........", "..........", "...####...", "...####...", "...####...", ".........."]);
    const open = openOf(g);
    // Steered at points all round the block from beside it, frame by frame: every frame's line is a walk.
    for (const [sx, sz, tx, tz] of [[2.5, 1.5, 8, 5], [1.5, 5.5, 8, 1], [8.5, 0.5, 1, 5], [5, 1.4, 5, 5.5], [2.7, 3, 8, 3]] as const) {
      const frames = hold(g, { x: sx, z: sz }, { x: tx, z: tz }, 240);
      for (let f = 1; f < frames.length; f++) expect(legClear(open, frames[f - 1]!, frames[f]!), JSON.stringify(frames.slice(f - 1, f + 1))).toBe(true);
    }
  });
});

describe("the body at a ledge", () => {
  /** Open ground, a terrace 12 texels up from x = 3 east, its two-tile ramp across the bank at row 2. */
  function terrace(): Grid {
    const g = grid(["........", "........", "........", "........", "........"]);
    for (let z = 0; z < 5; z++) for (let x = 3; x < 8; x++) g.setHeight(x, z, 12 / 16);
    g.setHeight(2, 2, 3 / 16);
    g.setHeight(3, 2, 9 / 16);
    g.setRamp(2, 2, true);
    g.setRamp(3, 2, true);
    return g;
  }

  it("walks up to the brink and stops flush with it, from above and below alike, never over", () => {
    const g = terrace().ground;
    // Below, east into the bank's face: the middle half a body from the edge at x = 3.
    expect(slide(g, 1.5, 0.5, 2, 0).x).toBeCloseTo(3 - BODY, 9);
    // Above, west to the brink: the top tile is walked to its edge.
    expect(slide(g, 5.5, 4.5, -4, 0).x).toBeCloseTo(3 + BODY, 9);
    expect(fits(g, 3 + BODY, 4.5)).toBe(true);
    expect(fits(g, 3, 4.5)).toBe(false);
  });

  it("slides along the brink what it walks along it, and goes up by the ramp", () => {
    const g = terrace().ground;
    const p = slide(g, 3.5, 4.5, -0.5, -0.5);
    expect(p.x).toBeCloseTo(3 + BODY, 9);
    expect(p.z).toBeCloseTo(4, 9);
    // Up the ramp's middle, straight from the low ground to the top.
    expect(slide(g, 0.5, 2.5, 5, 0)).toEqual({ x: 5.5, z: 2.5 });
  });

  it("finds a straight line over a ledge no line of sight, and a click's walk goes by the ramp, each leg clear", () => {
    const t = terrace();
    const g = t.ground;
    expect(clear(g, { x: 1.5, z: 0.5 }, { x: 5.5, z: 0.5 })).toBe(false);
    const route = t.path({ x: 1, z: 0 }, { x: 5, z: 0 })!;
    expect(route.some((s) => s.x === 2 && s.z === 2)).toBe(true);
    let at = { x: 1.5, z: 0.5 };
    for (const p of smooth(g, at, route)) {
      expect(clear(g, at, p), `${at.x},${at.z} to ${p.x},${p.z}`).toBe(true);
      at = p;
    }
    expect(at).toEqual({ x: 5.5, z: 0.5 });
    expect(canStep(g, { x: 2, z: 0 }, { x: 3, z: 0 })).toBe(false);
    expect(canStep(g, { x: 2, z: 2 }, { x: 3, z: 2 })).toBe(true);
  });
});
