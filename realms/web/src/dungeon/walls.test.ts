import { describe, expect, it } from "vitest";
import type { Model } from "../art/paint/builder";
import { generateDungeonFloor } from "./index";
import { drawWalls } from "./walls";

// A cave's crags (rock.ts) stand back from the walked ground, never over it: no facet of rock above the floor lies
// inside a tile that is not wall, and every point of it is a number.

const run = { Encounters: [0, 1, 2].map((i) => ({ Index: i, Mob: `mob-${i}` })), Warden: "warden", Boss: null };

function facets(model: Model, each: (x: number, y: number, z: number) => void): void {
  for (const part of model.parts) {
    const p = part.positions;
    for (let t = 0; t < part.indices.length; t += 3) {
      const [a, b, c] = [part.indices[t]! * 3, part.indices[t + 1]! * 3, part.indices[t + 2]! * 3];
      each((p[a]! + p[b]! + p[c]!) / 3, (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3, (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3);
    }
  }
}

describe("a cave's walls", () => {
  for (const [seed, at] of [[1, 0], [2, 2], [3, 1], [4, 0], [5, 1], [6, 2], [7, 0], [8, 1]] as const) {
    it(`seed ${seed}, floor ${at}: rock only over rock`, () => {
      const floor = generateDungeonFloor({ theme: "caves", seed, floor: at, floors: 3, run: { ...run, Warden: at < 2 ? "warden" : null, Boss: at === 2 ? "boss" : null } });
      const built = drawWalls(floor.cells, floor.theme);
      const models = [built.model, ...(built.cutaways ?? []).flatMap((c) => [c.full, c.low])];
      let count = 0;
      for (const m of models) {
        facets(m, (x, y, z) => {
          count++;
          expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
          // The kerbs round the pools stand a texel over the floor; rock stands higher.
          if (y < 0.05) return;
          const [tx, tz] = [Math.floor(x), Math.floor(z)];
          const inside = x - tx > 1e-3 && tx + 1 - x > 1e-3 && z - tz > 1e-3 && tz + 1 - z > 1e-3;
          const cell = floor.cells[tz]?.[tx] ?? "#";
          if (inside && cell !== "#" && cell !== " ") expect.fail(`rock at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)} over "${cell}"`);
        });
      }
      expect(count).toBeGreaterThan(1000);
    });
  }
});
