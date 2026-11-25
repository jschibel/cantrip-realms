import { describe, expect, it } from "vitest";
import { MeshBuilder, sides } from "../art/paint/builder";
import { flat } from "../art/paint/materials";
import type { Built } from "../art/recipe";
import { Place, sortScenery } from "./place";

// A place's moving parts (place.ts): cut-aways for the camera, flames in steps, a fire's light in
// step with them - all set by the clock and the camera's turn, nothing by the wall clock.

const cube = (x: number) => {
  const b = new MeshBuilder();
  b.box(x, 0, 0, x + 1, 1, 1, sides(flat(0x808080)));
  return b.model();
};

describe("a place", () => {
  it("cuts a side wall down while the camera looks across it", () => {
    const place = new Place("#000000");
    const pieces: Built[] = [{ model: cube(3), cutaways: [{ full: cube(4), low: cube(5), when: { camera: "east" } }, { full: cube(6), low: cube(7), when: { camera: "west" } }] }];
    place.addPieces(pieces, "scenery");
    const groups = place.scene.children;
    // Each cut-away's whole and cut-down groups, then the merged scenery: one mesh for the one material.
    expect(groups.map((g) => g.name)).toEqual(["cutaway", "cutaway-low", "cutaway", "cutaway-low", "scenery"]);
    expect(groups.at(-1)!.children).toHaveLength(1);
    const shown = () => groups.slice(0, 4).map((g) => g.visible);
    expect(shown()).toEqual([true, false, true, false]);
    place.update(0, Math.PI / 4, Math.PI / 4);
    expect(shown()).toEqual([false, true, true, false]);
    // Turning from the right to the left: both sides are cut while it swings past the front.
    place.update(0, 0.3, -Math.PI / 4);
    expect(shown()).toEqual([false, true, false, true]);
  });

  it("steps flames eight times a second, and the fire's light with them", () => {
    const place = new Place("#000000");
    place.addPieces([{ model: cube(0), frames: [{ models: [cube(1), cube(2), cube(3)], rate: 8 }] }], "scenery");
    const light = place.addLight({ kind: "point", at: [0, 1, 0], color: [1, 0.5, 0.2], intensity: 9, reach: 7, flicker: { base: 8, steps: [0, 1.6, 0.7], rate: 8, phase: 1 } });
    const frames = place.scene.children.slice(0, 3);
    for (const [time, k] of [
      [0, 0],
      [0.13, 1],
      [0.26, 2],
      [0.38, 0],
    ] as const) {
      place.update(time, 0, 0);
      expect(frames.map((f) => f.visible)).toEqual([0, 1, 2].map((i) => i === k));
      expect(light.intensity).toBeCloseTo(8 + [0, 1.6, 0.7][(k + 1) % 3]!, 9);
    }
  });

  it("leaves small props out at the furthest zoom, but never one standing in the way", () => {
    // A bush-sized cube on open ground is small (left out far); the same on a closed tile is drawn at every zoom.
    const groups = sortScenery([cube(0), cube(3)], "chunk", [], [], [false, true]);
    expect(groups.map((g) => [g.kind, g.models.length])).toEqual([
      ["rest", 1],
      ["small", 1],
    ]);
  });
});
