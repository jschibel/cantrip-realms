import { describe, expect, it } from "vitest";
import { distance, findPath, fromWorld, hex, key, neighbors, spiral, toWorld } from "./hex";

describe("hex grid", () => {
  it("measures steps between hexes", () => {
    expect(distance(hex(0, 0), hex(0, 0))).toBe(0);
    expect(distance(hex(0, 0), hex(3, 0))).toBe(3);
    expect(distance(hex(0, 0), hex(2, -3))).toBe(3);
    expect(distance(hex(-2, 1), hex(1, 1))).toBe(3);
  });

  it("has six neighbours, each one step away", () => {
    const around = neighbors(hex(4, -2));
    expect(around).toHaveLength(6);
    expect(new Set(around.map(key)).size).toBe(6);
    for (const h of around) {
      expect(distance(h, hex(4, -2))).toBe(1);
    }
  });

  it("finds a hex again from its centre and from near its centre", () => {
    for (const h of spiral(hex(0, 0), 6)) {
      const { x, z } = toWorld(h);
      expect(fromWorld(x, z)).toEqual(h);
      expect(fromWorld(x + 0.3, z - 0.3)).toEqual(h);
    }
  });

  it("lists every hex of a spiral once", () => {
    const hexes = spiral(hex(1, 1), 3);
    expect(hexes).toHaveLength(1 + 6 + 12 + 18);
    expect(new Set(hexes.map(key)).size).toBe(hexes.length);
    expect(Math.max(...hexes.map((h) => distance(h, hex(1, 1))))).toBe(3);
  });
});

describe("findPath", () => {
  const open = () => true;

  it("walks straight when nothing is in the way", () => {
    const path = findPath(hex(0, 0), hex(4, 0), open)!;
    expect(path).toHaveLength(4);
    expect(path.at(-1)).toEqual(hex(4, 0));
  });

  it("goes around a wall", () => {
    const wall = new Set([key(hex(2, -1)), key(hex(2, 0)), key(hex(2, 1)), key(hex(2, -2))]);
    const path = findPath(hex(0, 0), hex(4, 0), (h) => !wall.has(key(h)) && distance(h, hex(0, 0)) <= 8)!;
    expect(path.at(-1)).toEqual(hex(4, 0));
    expect(path.some((h) => wall.has(key(h)))).toBe(false);
    for (let i = 1; i < path.length; i++) {
      expect(distance(path[i - 1]!, path[i]!)).toBe(1);
    }
  });

  it("finds nothing when the goal is walled in or blocked", () => {
    const goal = hex(3, 0);
    const ring = new Set(neighbors(goal).map(key));
    expect(findPath(hex(0, 0), goal, (h) => !ring.has(key(h)) && distance(h, hex(0, 0)) <= 6)).toBeNull();
    expect(findPath(hex(0, 0), goal, (h) => key(h) !== key(goal))).toBeNull();
  });

  it("finds the same path every time", () => {
    const first = findPath(hex(0, 0), hex(5, -3), open);
    for (let i = 0; i < 5; i++) {
      expect(findPath(hex(0, 0), hex(5, -3), open)).toEqual(first);
    }
  });

  it("is empty from a hex to itself", () => {
    expect(findPath(hex(2, 2), hex(2, 2), open)).toEqual([]);
  });
});
