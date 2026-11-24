import { describe, expect, it } from "vitest";
import { boards, missing } from "../gallery/boards";
import type { BuildingData, PropData } from "../world/format";
import { BUILDINGS, SHOWCASE } from "./buildings";
import { MeshBuilder, type Model, sides } from "./paint/builder";
import * as C from "./paint/colors";
import { flat } from "./paint/materials";
import { PALETTES } from "./paint/palette";
import { PROP_CATALOGUE, PROPS, tilesOf } from "./props";
import { SURFACE_GROUPS, SURFACES } from "./surfaces";

// The art library (surfaces, props, buildings): every id builds from its own example without problems - geometry with
// no holes in its numbers, the same every time - every outdoor prop says where it stands, every building faces where
// it is turned with its door, and the gallery names nothing the registries lack.

const triangles = (m: Model) => m.parts.reduce((n, p) => n + p.indices.length / 3, 0);
const finite = (m: Model) => m.parts.every((p) => [...p.positions, ...p.normals, ...p.uvs].every(Number.isFinite));

/** A prop's example placed at (x, z): its args' `to` (and a town wall's `gate`) taken as offsets, as the gallery does. */
function example(id: string, x = 10.5, z = 10.5): PropData {
  const s = PROP_CATALOGUE.get(id)!.sample;
  const to = s.args?.to as [number, number] | undefined;
  const gate = s.args?.gate as [number, number] | undefined;
  const args = s.args ? { ...s.args, ...(to ? { to: [x + to[0], z + to[1]] } : {}), ...(gate ? { gate: [z + gate[0], z + gate[1]] } : {}) } : undefined;
  return { ...s, id, x, z, ...(args ? { args } : {}) };
}

describe("the surfaces", () => {
  for (const id of SURFACES.ids()) {
    it(`${id}: a solid 64-square picture, the same every time, with how it meets its neighbours`, () => {
      const look = SURFACES.look(id);
      expect([look.picture.width, look.picture.height]).toEqual([64, 64]);
      expect(look.picture.data).toEqual(SURFACES.look(id).picture.data);
      for (let i = 3; i < look.picture.data.length; i += 4) expect(look.picture.data[i]).toBe(255);
      const colors = new Set<number>();
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) colors.add(look.picture.get(x, y));
      expect(colors.size).toBeGreaterThan(3);
      expect(Number.isFinite(look.priority)).toBe(true);
      if (look.hole) expect(look.under).toBeDefined();
    });
  }

  it("are grouped by biome, every group's ids defined", () => {
    for (const ids of Object.values(SURFACE_GROUPS)) for (const id of ids) expect(SURFACES.has(id), id).toBe(true);
  });
});

describe("the props", () => {
  for (const [id, info] of PROP_CATALOGUE) {
    it(`${id}: builds from its example, and covers the ground its footprint says`, () => {
      expect(PROPS.has(id)).toBe(true);
      const p = example(id);
      expect(PROPS.problems(id, p)).toEqual([]);
      const built = PROPS.build(id, p);
      expect(triangles(built.model)).toBeGreaterThan(0);
      expect(finite(built.model)).toBe(true);
      for (const f of built.frames ?? []) for (const m of f.models) expect(finite(m)).toBe(true);
      expect(PROPS.build(id, p).model.parts.map((x) => x.positions)).toEqual(built.model.parts.map((x) => x.positions));
      expect(tilesOf(p).tiles.length).toBeGreaterThan(0);
      expect(info.biomes.length).toBeGreaterThan(0);
      if (info.light) expect(info.light.at).toHaveLength(3);
    });
  }

  it("trees and dense growth have a far stand-in of about a hundred triangles, and are a few hundred near", () => {
    for (const [id, info] of PROP_CATALOGUE) {
      if (info.category !== "tree") continue;
      const built = PROPS.build(id, example(id));
      expect(built.far, id).toBeDefined();
      expect(triangles(built.far!), id).toBeLessThanOrEqual(130);
      expect(triangles(built.far!), id).toBeLessThan(triangles(built.model));
      expect(finite(built.far!)).toBe(true);
      expect(triangles(built.model), id).toBeLessThanOrEqual(id === "giant-tree" || id === "great-tree" || id === "lush-tree" ? 800 : 500);
    }
  });

  it("stand on the world generator's footprints: a dungeon's entrance over args.w by args.d, its door at its front's middle", () => {
    const cave = { id: "cave-mouth", x: 10, z: 20, rot: 1, args: { w: 4, d: 6 } };
    expect(tilesOf(cave).tiles).toHaveLength(24);
    const door = PROPS.build("cave-mouth", cave).doorway!;
    expect(door[0]).toBeCloseTo(10, 0);
    expect(door[2]).toBeCloseTo(23, 0);
  });

  it("say which tiles they stand on, turned and along their lines", () => {
    const fence = tilesOf({ id: "fence", x: 0.5, z: 0.5, args: { to: [4.5, 0.5] } });
    expect(fence.tiles.map(([x]) => x).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(fence.blocks).toBe(true);
    expect(tilesOf({ id: "giant-tree", x: 5.5, z: 5.5 }).tiles).toHaveLength(9);
    expect(tilesOf({ id: "statue", x: 5.5, z: 5.5, args: { size: 3 } }).tiles).toHaveLength(9);
    const log = tilesOf({ id: "log", x: 5.5, z: 5.5, rot: 1 });
    expect(new Set(log.tiles.map(([x]) => x)).size).toBe(1);
    expect(log.tiles.length).toBeGreaterThanOrEqual(2);
    expect(tilesOf({ id: "fern", x: 2.5, z: 2.5 }).blocks).toBe(false);
  });

  it("recolor by their palette's slots", () => {
    const plain = PROPS.build("oak", example("oak")).model.parts.map((x) => x.material.name);
    const elf = PROPS.build("oak", example("oak"), PALETTES.get("elfhame")).model.parts.map((x) => x.material.name);
    expect(elf).not.toEqual(plain);
  });
});

describe("the buildings", () => {
  const styles = BUILDINGS.ids();

  it("have a style per region, each showing its kinds", () => {
    for (const s of ["benalish", "llanowar", "morass", "keldon", "tolarian", "vess", "village", "phyrexian"]) {
      expect(styles).toContain(s);
      expect(SHOWCASE[s]?.length ?? 0, s).toBeGreaterThan(0);
    }
  });

  for (const style of styles) {
    for (const [i, s] of (SHOWCASE[style] ?? []).entries()) {
      it(`${style} ${s.kind} ${s.w}x${s.d}: builds at every heading, its door with it`, () => {
        for (const rot of [0, 1, 2, 3]) {
          const turned = rot % 2 === 1;
          const bd: BuildingData = { id: `${style}-${i}`, style, kind: s.kind, x: 20, z: 30, w: turned ? s.d : s.w, d: turned ? s.w : s.d, rot, params: s.params };
          expect(BUILDINGS.problems(style, bd)).toEqual([]);
          const built = BUILDINGS.build(style, bd, s.palette ? PALETTES.get(s.palette) : undefined);
          const whole = triangles(built.model) + (built.cutaways ?? []).reduce((n, c) => n + triangles(c.full), 0);
          expect(whole).toBeGreaterThan(0);
          expect(finite(built.model)).toBe(true);
          for (const c of built.cutaways ?? []) expect(finite(c.full) && finite(c.low)).toBe(true);
          if (built.doorway) {
            // The door is on the footprint's edge it faces, give or take its step.
            const [dx, , dz] = built.doorway;
            expect(dx).toBeGreaterThan(bd.x - 1.5);
            expect(dx).toBeLessThan(bd.x + bd.w + 1.5);
            expect(dz).toBeGreaterThan(bd.z - 1.5);
            expect(dz).toBeLessThan(bd.z + bd.d + 1.5);
          }
        }
      });
    }
  }

  it("dress in any region's palette", () => {
    for (const style of styles) {
      const s = SHOWCASE[style]?.[0] ?? SHOWCASE.morass![0]!;
      for (const pal of ["benalish", "keldon", "tolarian", "morass", "village"]) {
        const built = BUILDINGS.build(style, { id: "p", style, kind: s.kind, x: 0, z: 0, w: s.w, d: s.d, rot: 0, params: s.params }, PALETTES.get(pal));
        expect(triangles(built.model), `${style} in ${pal}`).toBeGreaterThan(0);
      }
    }
  });

  it("stand on their footprints: a building on its own, a gatehouse either side of its passage", () => {
    const house = BUILDINGS.build("benalish", { id: "h", style: "benalish", kind: "house", x: 10, z: 20, w: 4, d: 3, rot: 0 });
    expect(house.footprints).toEqual([[10, 20, 14, 23]]);
    const gate = BUILDINGS.build("benalish", { id: "g", style: "benalish", kind: "gatehouse", x: 0, z: 0, w: 6, d: 4, rot: 0 });
    expect(gate.footprints).toEqual([[0, 0, 2, 4], [4, 0, 6, 4]]);
    const turned = BUILDINGS.build("benalish", { id: "g", style: "benalish", kind: "gatehouse", x: 0, z: 0, w: 4, d: 6, rot: 1 });
    expect(turned.footprints).toEqual([[0, 0, 4, 2], [0, 4, 4, 6]]);
});
});

describe("the palettes", () => {
  it("name ramps of colors, darkest first", () => {
    for (const [name, pal] of PALETTES) {
      for (const [slot, ramp] of Object.entries(pal)) {
        expect(ramp.length, `${name}.${slot}`).toBeGreaterThanOrEqual(4);
        for (const c of ramp) expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff).toBe(true);
      }
    }
    for (const n of ["benalish", "llanowar", "morass", "keldon", "tolarian", "vess", "village", "phyrexian", "tier-1", "tier-4", "winter", "basalt"]) expect(PALETTES.has(n), n).toBe(true);
  });
});

describe("the gallery", () => {
  it("names nothing the registries lack, and shows every surface, catalogued prop and style", () => {
    const all = boards();
    for (const b of all) expect(missing(b), b.id).toEqual([]);
    const surfaces = new Set<string>();
    const props = new Set<string>();
    const styles = new Set<string>();
    for (const b of all) {
      for (let z = 0; z < b.d; z++) for (let x = 0; x < b.w; x++) surfaces.add(b.ground(x, z));
      for (const p of b.props) props.add(p.id);
      for (const bd of b.buildings) styles.add(bd.style);
    }
    const outdoors = SURFACES.ids().filter((s) => !["floorboards", "hearthstone", "crypt-floor"].includes(s));
    for (const s of outdoors) expect(surfaces.has(s), s).toBe(true);
    for (const id of PROP_CATALOGUE.keys()) expect(props.has(id), id).toBe(true);
    for (const s of BUILDINGS.ids()) if (SHOWCASE[s]) expect(styles.has(s), s).toBe(true);
  });
});
