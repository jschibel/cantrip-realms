import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BuildingData, ChunkData, InteriorData, PropData, WorldData } from "../world/format";
import { lintWorld } from "../world/lint";
import { BUILDINGS } from "./buildings";
import { FIGURES, figureSpec } from "./figures";
import { MeshBuilder, mergeModels, sides } from "./paint/builder";
import * as C from "./paint/colors";
import { flat, stock } from "./paint/materials";
import { PALETTES } from "./paint/palette";
import { PROPS } from "./props";
import { Registry } from "./recipe";
import { ROOMS } from "./rooms";
import { SURFACES } from "./surfaces";

// The art registries (art/recipe.ts): every id the sample world names is there and builds, the same data always gives
// the same model, models merge as one builder would have drawn them, palettes recolor and only where they say.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "fixtures", "slice-world");
const read = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf8"));
const world = read("world.json") as WorldData;
const chunks = readdirSync(join(root, "chunks")).map((f) => read(`chunks/${f}`) as ChunkData);
const interiors = readdirSync(join(root, "interiors")).map((f) => read(`interiors/${f}`) as InteriorData);

/** What the art has, for the lint. */
export const KNOWN = {
  surfaces: new Set(SURFACES.ids()),
  props: new Set(PROPS.ids()),
  styles: new Set(BUILDINGS.ids()),
  rooms: new Set(ROOMS.ids()),
  figures: new Set(FIGURES.ids()),
  palettes: new Set(PALETTES.keys()),
  propProblems: (p: PropData) => PROPS.problems(p.id, p),
  buildingProblems: (b: BuildingData) => BUILDINGS.problems(b.style, b),
};

const triangles = (m: { parts: readonly { indices: readonly number[] }[] }) => m.parts.reduce((n, p) => n + p.indices.length / 3, 0);

describe("the art registries", () => {
  it("have every id the sample world names, and its props' args as their recipes want them", () => {
    expect(lintWorld(world, chunks, interiors, KNOWN)).toEqual([]);
  });

  it("build everything the sample world holds", () => {
    for (const c of chunks) {
      for (const b of c.buildings) expect(triangles(BUILDINGS.build(b.style, b).model), b.id).toBeGreaterThan(0);
      for (const p of c.props) expect(triangles(PROPS.build(p.id, p).model), `${p.id} at ${p.x},${p.z}`).toBeGreaterThan(0);
    }
    for (const r of interiors) {
      const shell = ROOMS.build(r.kind, r);
      expect(shell.cutaways).toHaveLength(2);
      expect(shell.doorway).toBeDefined();
      for (const p of r.props) expect(triangles(PROPS.build(p.id, p).model), `${r.id}: ${p.id}`).toBeGreaterThan(0);
    }
    for (const id of FIGURES.ids()) expect(figureSpec(id).parts.length).toBeGreaterThan(5);
  });

  it("make the same model from the same data, every time", () => {
    const p: PropData = { id: "tree", x: 3.25, z: 7.5, scale: 1.1, seed: 4 };
    const a = PROPS.build("tree", p).model;
    const b = PROPS.build("tree", p).model;
    expect(a.parts.map((x) => x.material)).toEqual(b.parts.map((x) => x.material));
    expect(a.parts.map((x) => x.positions)).toEqual(b.parts.map((x) => x.positions));
  });

  it("merge models as one builder drawing them in turn would have", () => {
    const iron = flat(C.IRON[2]!);
    const lime = stock.limestone();
    const one = new MeshBuilder();
    one.box(0, 0, 0, 1, 1, 1, sides(iron));
    one.box(2, 0, 0, 3, 1, 1, sides(lime));
    one.box(4, 0, 0, 5, 1, 1, sides(iron));
    const whole = one.model();
    const parts = [
      [0, iron],
      [2, lime],
      [4, iron],
    ].map(([x, m]) => {
      const b = new MeshBuilder();
      b.box(x as number, 0, 0, (x as number) + 1, 1, 1, sides(m as typeof iron));
      return b.model();
    });
    expect(mergeModels(parts)).toEqual(whole);
  });

  it("round a box thinner than twice its rounding by half its thinnest side, and one with no thickness not at all", () => {
    const lime = stock.limestone();
    for (const w of [0, 1e-9, 0.1, 0.24, 1]) {
      for (const steps of [1, 2]) {
        const b = new MeshBuilder();
        b.roundedBox(2, 0, 0, 2 + w, 0.9, 0.76, 0.12, sides(lime), { steps });
        const positions = b.model().parts.flatMap((p) => p.positions);
        expect(positions.every(Number.isFinite), `${w} wide`).toBe(true);
        // Its faces never fold out past the box.
        const xs = positions.filter((_, i) => i % 3 === 0);
        expect(Math.min(...xs), `${w} wide`).toBeGreaterThanOrEqual(2 - 1e-9);
        expect(Math.max(...xs), `${w} wide`).toBeLessThanOrEqual(2 + w + 1e-9);
      }
    }
  });

  it("turn a building to face its rot, its door with it", () => {
    const south: BuildingData = { id: "h", style: "benalish", x: 0, z: 0, w: 6, d: 4, rot: 0, params: { openings: [{ at: 3, kind: "door" }] } };
    expect(BUILDINGS.build("benalish", south).doorway).toEqual([3, 1, 4]);
    const west = BUILDINGS.build("benalish", { ...south, w: 4, d: 6, rot: 1 }).doorway!;
    // Facing west, its front is its west wall (x = 0) and its door half way along it.
    expect(west[0]).toBeCloseTo(0, 9);
    expect(west[2]).toBeCloseTo(3, 9);
  });

  it("recolor by palette, and only by the slots a recipe reads", () => {
    const p: PropData = { id: "tree", x: 0, z: 0 };
    const plain = PROPS.build("tree", p).model.parts.map((x) => x.material.name);
    const autumn = PROPS.build("tree", p, PALETTES.get("autumn")).model.parts.map((x) => x.material.name);
    expect(plain).toContain("leaves");
    expect(autumn.find((n) => n.startsWith("leaves@"))).toBeDefined();
    expect(autumn).toContain("bark");
    expect(figureSpec("hero", PALETTES.get("dark-hair")).name).not.toBe(figureSpec("hero").name);
  });

  it("refuse an id defined twice, and name an unknown one", () => {
    const r = new Registry<number>("test");
    r.define("a", "one", () => ({ model: { parts: [] } }));
    expect(() => r.define("a", "again", () => ({ model: { parts: [] } }))).toThrow(/twice/);
    expect(r.problems("b", 1)).toEqual(['no test "b"']);
    expect(() => PROPS.build("no-such-prop", { id: "no-such-prop", x: 0, z: 0 })).toThrow(/no "no-such-prop"/);
  });
});
