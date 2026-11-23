import { describe, expect, it } from "vitest";
import { findPath, hex } from "../hex";
import { GameMap } from "./gameMap";
import { nearestInn, worldLocation } from "./graph";
import { type MapData, validateMap } from "./schema";

// The content lint for Dominaria's maps: every file is a good map, the maps join up, and the world is as design.md
// (A6) lays it out.
const files = import.meta.glob<MapData>("../../../content/dominaria/maps/*.json", { eager: true, import: "default" });
const maps = new Map(Object.values(files).map((m) => [m.id, m]));
const ids = new Set(maps.keys());
const load = (id: string) => {
  const map = maps.get(id);
  return map ? Promise.resolve(map) : Promise.reject(new Error(`no map ${id}`));
};

describe("Dominaria's maps", () => {
  it("are named for their files", () => {
    for (const [path, map] of Object.entries(files)) expect(path.endsWith(`/${map.id}.json`)).toBe(true);
  });

  for (const map of maps.values()) {
    it(`${map.id} passes the lint`, () => {
      expect(validateMap(map, ids)).toEqual([]);
    });
  }

  it("join up both ways: an exit from one map to another has one back", () => {
    for (const map of maps.values()) {
      for (const exit of map.exits) {
        if (exit.to === "world") continue;
        expect(maps.get(exit.to)!.exits.some((e) => e.to === map.id), `${map.id} -> ${exit.to}`).toBe(true);
      }
    }
  });

  it("has a world map whose every place can be travelled to from the hub", () => {
    const world = new GameMap(maps.get("world")!);
    const hub = world.data.exits.find((e) => e.to === "new-argive")!;
    expect(hub).toBeDefined();
    for (const place of world.data.exits) {
      expect(findPath(hex(hub.q, hub.r), hex(place.q, place.r), world.passable, undefined, 100000), place.to).not.toBeNull();
    }
  });

  it("puts every map but the encounter maps somewhere on the world map", async () => {
    const encounterMaps = new Set(maps.get("world")!.encounters!.map((z) => z.map));
    for (const map of maps.values()) {
      if (map.kind === "world" || encounterMaps.has(map.id)) continue;
      expect(await worldLocation(map.id, load), map.id).not.toBeNull();
    }
  });

  it("wakes a beaten player at an inn from every map", async () => {
    for (const map of maps.values()) {
      if (map.kind === "world") continue;
      const encounter = map.exits.every((e) => e.to === "world") && map.kind === "wilderness" && !(await worldLocation(map.id, load));
      if (encounter) continue;
      const inn = await nearestInn(map.id, load);
      expect(inn, map.id).not.toBeNull();
      expect(maps.get(inn!)!.inn).toBeDefined();
    }
  });

  it("has the hub, five home towns, five villages, 3-4 wilderness maps a region and dungeons of 3-5 floors", () => {
    const all = [...maps.values()];
    expect(maps.get("new-argive")?.kind).toBe("town");
    expect(maps.get("new-argive")!.npcs.filter((n) => n.kind === "vendor")).toHaveLength(8);
    for (const region of ["W", "U", "B", "R", "G"]) {
      const of = (kind: string) => all.filter((m) => m.region === region && m.kind === kind);
      expect(of("town"), region).toHaveLength(1);
      expect(of("village"), region).toHaveLength(1);
      const vendors = of("town")[0]!.npcs.filter((n) => n.kind === "vendor").length;
      expect(vendors).toBeGreaterThanOrEqual(2);
      expect(vendors).toBeLessThanOrEqual(4);
      const encounterMaps = new Set(maps.get("world")!.encounters!.map((z) => z.map));
      const wild = of("wilderness").filter((m) => !encounterMaps.has(m.id));
      expect(wild.length).toBeGreaterThanOrEqual(3);
      expect(wild.length).toBeLessThanOrEqual(4);
      const floors = of("dungeon");
      expect(floors.length).toBeGreaterThanOrEqual(3);
      expect(floors.length).toBeLessThanOrEqual(5);
      expect(floors.find((f) => f.floor === 1)!.npcs.some((n) => n.kind === "spell-table")).toBe(true);
      expect(floors.some((f) => f.spawns.some((s) => s.id === "boss"))).toBe(true);
    }
    expect(maps.get("benalish-meadow")?.kind).toBe("wilderness");
  });
});
