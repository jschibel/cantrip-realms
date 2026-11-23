import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../art/buildings";
import { PROPS } from "../art/props";
import { type BuildingData, CHUNK, type ChunkData, type PropData, type TileData, type WorldData } from "../world/format";
import { assembleWorld } from "./assemble";

// A chunk as the world assembles and streams it (chunks.ts `buildChunk`): buildings' flames kept as props' are, merged
// a frame; the buildings' cut-aways merged into one group a material, re-merged without those the player drops; trees
// near and as their far stand-ins, switched with the furthest zoom's detail.

const WORLD: WorldData = {
  size: [CHUNK, CHUNK],
  chunk: CHUNK,
  tile: 1,
  regions: [],
  towns: [],
  inns: [],
  dungeons: [],
  roads: [],
  ferries: [],
  pitches: [],
  zones: { cell: 32, cols: 1, rows: 1, areas: [{ id: "a", name: "A", region: null, tier: 1 }], grid: [[0]] },
  overview: { cell: 32, legend: { g: "grass" }, rows: ["g"] },
};

const building = (id: string, style: string, kind: string, x: number, z: number, w: number, d: number): BuildingData => ({ id, style, kind, x, z, w, d, rot: 0 });

const BUILDINGS_HERE: BuildingData[] = [
  building("inn", "keldon", "inn", 1, 1, 9, 6),
  building("temple", "keldon", "temple", 12, 1, 7, 8),
  building("smithy", "keldon", "smithy", 21, 1, 6, 5),
  building("elf-smithy", "llanowar", "smithy", 1, 14, 6, 5),
  building("house", "benalish", "house", 12, 14, 6, 5),
];
const PROPS_HERE: PropData[] = [
  { id: "torch-post", x: 24.5, z: 14.5 },
  { id: "tree", x: 4.5, z: 26.5 },
  { id: "pine", x: 8.5, z: 26.5 },
  { id: "hedgerow", x: 12, z: 28, args: { to: [20, 28] } },
];

function chunk(): ChunkData {
  const tiles: TileData[] = Array.from({ length: CHUNK * CHUNK }, () => [0, "grass", 0] as TileData);
  return { cx: 0, cz: 0, tiles, props: PROPS_HERE, buildings: BUILDINGS_HERE, npcs: [], spawns: [], chests: [], entrances: [], waymarkers: [] };
}

const meshes = (o: THREE.Object3D, visibleOnly = true) => {
  const out: THREE.Mesh[] = [];
  (visibleOnly ? o.traverseVisible.bind(o) : o.traverse.bind(o))((m) => (m as THREE.Mesh).isMesh && out.push(m as THREE.Mesh));
  return out;
};
const triangles = (ms: readonly THREE.Mesh[]) => ms.reduce((n, m) => n + (m.geometry.index?.count ?? 0) / 3, 0);

describe("a chunk assembled", () => {
  const built = BUILDINGS_HERE.map((b) => BUILDINGS.build(b.style, b));
  const props = PROPS_HERE.map((p) => PROPS.build(p.id, p));

  it("keeps the buildings' flames as it does a prop's, merged a frame", () => {
    for (const k of [0, 1, 2, 3]) expect(built[k]!.frames?.length, BUILDINGS_HERE[k]!.id).toBeGreaterThan(0);
    const section = assembleWorld(WORLD, [chunk()]).place.section("0_0");
    const fires = [...built, ...props].flatMap((b) => b.frames ?? []);
    // Every flame's every frame is drawn, in as many groups as there are kinds of flame (by rate and frame count).
    const kinds = new Set(fires.map((f) => `${f.rate}:${f.models.length}`));
    expect(section.frames).toHaveLength(kinds.size);
    for (const f of section.frames) {
      const alike = fires.filter((g) => g.rate === f.rate && g.models.length === f.groups.length);
      f.groups.forEach((group, i) => expect(triangles(meshes(group, false))).toBe(alike.reduce((n, g) => n + g.models[i]!.parts.reduce((t, p) => t + p.indices.length / 3, 0), 0)));
    }
    // A frame at a time, as the clock says.
    const place = assembleWorld(WORLD, [chunk()]).place;
    place.update(0.13, 0, 0);
    for (const f of place.section("0_0").frames) expect(f.groups.map((g) => g.visible)).toEqual(f.groups.map((_, i) => i === Math.floor(0.13 * f.rate) % f.groups.length));
  });

  it("merges the cut-aways a material, and re-merges them without those the player stands behind", () => {
    const { place } = assembleWorld(WORLD, [chunk()]);
    const section = place.section("0_0");
    const cuts = built.flatMap((b) => b.cutaways ?? []);
    expect(cuts.length).toBeGreaterThanOrEqual(5);
    expect(section.cutaways).toHaveLength(0);
    expect(section.merged).toHaveLength(1);
    const merged = section.merged[0]!;
    const whole = merged.groups.get("")!;
    const materials = new Set(cuts.flatMap((c) => c.full.parts.filter((p) => p.indices.length > 0).map((p) => p.material)));
    expect(whole.children).toHaveLength(materials.size);
    const fullTris = cuts.reduce((n, c) => n + c.full.parts.reduce((t, p) => t + p.indices.length / 3, 0), 0);
    expect(triangles(meshes(whole))).toBe(fullTris);

    // Behind the inn: its upper storey drops, its cap shows, the rest stay whole.
    const [x0, z0, x1, z1] = (cuts[0]!.when as { player: readonly number[] }).player;
    place.follow({ x: (x0! + x1!) / 2, z: (z0! + z1!) / 2 });
    expect(merged.shown).toBe("0");
    expect(whole.visible).toBe(false);
    expect(merged.lows.map((l) => l.visible)).toEqual(merged.lows.map((_, i) => i === 0));
    const without = merged.groups.get("0")!;
    expect(without.visible).toBe(true);
    expect(triangles(meshes(without))).toBe(fullTris - cuts[0]!.full.parts.reduce((t, p) => t + p.indices.length / 3, 0));
    // Away again: the whole group, kept, shows; the set dropped is kept for next time.
    place.follow({ x: 16, z: 31 });
    expect(whole.visible).toBe(true);
    expect(without.visible).toBe(false);
    expect(merged.lows.every((l) => !l.visible)).toBe(true);
    place.follow({ x: (x0! + x1!) / 2, z: (z0! + z1!) / 2 });
    expect(merged.groups.get("0")).toBe(without);
  });

  it("draws trees and hedgerows as their far stand-ins at the furthest zoom", () => {
    const { place } = assembleWorld(WORLD, [chunk()]);
    const section = place.section("0_0");
    const fars = props.filter((p) => p.far);
    expect(fars.length).toBe(3);
    expect(section.near.length).toBeGreaterThan(0);
    expect(section.far.length).toBeGreaterThan(0);
    const farTris = fars.reduce((n, p) => n + p.far!.parts.reduce((t, q) => t + q.indices.length / 3, 0), 0);
    const nearTris = fars.reduce((n, p) => n + p.model.parts.reduce((t, q) => t + q.indices.length / 3, 0), 0);
    const tris = (list: readonly THREE.Object3D[]) => list.reduce((n, o) => n + triangles(meshes(o, false)), 0);
    expect(tris(section.far)).toBe(farTris);
    expect(tris(section.near)).toBe(nearTris);
    const shown = () => [section.near.every((o) => o.visible), section.far.every((o) => !o.visible)];
    expect(shown()).toEqual([true, true]);
    place.setDetail(false);
    expect(section.near.every((o) => !o.visible) && section.far.every((o) => o.visible)).toBe(true);
    place.setDetail(true);
    expect(shown()).toEqual([true, true]);
  });
});
