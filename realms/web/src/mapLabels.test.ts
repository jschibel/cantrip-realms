import { describe, expect, it } from "vitest";
import { type Box, type Placed, type Wanted, placeLabels } from "./mapLabels";

const overlap = (a: Box, b: Box) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
const anyOverlap = (placed: readonly Placed[]) => placed.some((a, i) => placed.some((b, j) => j > i && overlap(a.box, b.box)));

describe("placing the whole map's names", () => {
  it("writes a name over its point when nothing is there", () => {
    const [p] = placeLabels([{ id: "sea", x: 100, y: 50, width: 40, height: 10, mode: "over" }], []);
    expect(p!.box).toEqual({ x0: 80, y0: 45, x1: 120, y1: 55 });
  });

  it("writes a town's name beside its mark, to the right first, never over the mark", () => {
    const mark: Box = { x0: 95, y0: 45, x1: 105, y1: 55 };
    const [p] = placeLabels([{ id: "town", x: 100, y: 50, width: 30, height: 10, mode: "beside", r: 5, must: true }], [mark]);
    expect(p!.box.x0).toBeGreaterThan(105);
    expect(overlap(p!.box, mark)).toBe(false);
  });

  it("nudges a name off another placed before it, within its reach", () => {
    const wanted: Wanted[] = [
      { id: "first", x: 100, y: 100, width: 60, height: 12, mode: "over" },
      { id: "second", x: 100, y: 104, width: 50, height: 12, mode: "over", reach: 30 },
    ];
    const placed = placeLabels(wanted, []);
    expect(placed.map((p) => p.id)).toEqual(["first", "second"]);
    expect(anyOverlap(placed)).toBe(false);
    const second = placed[1]!;
    expect(Math.hypot((second.box.x0 + second.box.x1) / 2 - 100, (second.box.y0 + second.box.y1) / 2 - 104)).toBeLessThanOrEqual(30 * 1.6 + 1);
  });

  it("shrinks a name that fits nowhere at full size, and drops one that fits nowhere at all", () => {
    // A gap 44 pixels wide between two walls: a name of 50 fits only shrunk; one of 80 not even then.
    const walls: Box[] = [
      { x0: 0, y0: 0, x1: 100, y1: 200 },
      { x0: 144, y0: 0, x1: 300, y1: 200 },
    ];
    const bounds: Box = { x0: 0, y0: 0, x1: 300, y1: 200 };
    const [shrunk] = placeLabels([{ id: "a", x: 122, y: 100, width: 46, height: 10, mode: "over", reach: 4, scales: [1, 0.85] }], walls, bounds);
    expect(shrunk!.scale).toBe(0.85);
    expect(placeLabels([{ id: "b", x: 122, y: 100, width: 80, height: 10, mode: "over", reach: 4, scales: [1, 0.85] }], walls, bounds)).toEqual([]);
  });

  it("places a town's name however crowded, where it covers least, and names first come first", () => {
    const crowd: Wanted[] = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, x: 100 + (i % 3) * 6, y: 100 + Math.floor(i / 3) * 6, width: 60, height: 12, mode: "beside" as const, r: 3, must: true }));
    const placed = placeLabels(crowd, []);
    expect(placed.map((p) => p.id)).toEqual(crowd.map((c) => c.id));
  });

  it("keeps many names apart: none over another once placed", () => {
    const wanted: Wanted[] = [];
    for (let i = 0; i < 60; i++) wanted.push({ id: `n${i}`, x: (i * 37) % 400, y: (i * 53) % 300, width: 40 + (i % 5) * 10, height: 12, mode: "over", reach: 24 });
    const placed = placeLabels(wanted, [], { x0: 0, y0: 0, x1: 400, y1: 300 });
    expect(placed.length).toBeGreaterThan(20);
    expect(anyOverlap(placed)).toBe(false);
  });
});
