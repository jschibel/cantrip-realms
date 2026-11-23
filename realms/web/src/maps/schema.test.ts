import { describe, expect, it } from "vitest";
import { hex, spiral } from "../hex";
import { GameMap } from "./gameMap";
import { innOf, nearestInn, worldLocation } from "./graph";
import { type MapData, validateMap } from "./schema";

/** A small good map to break: a village with its inn, spell table and a way out. */
function village(patch: Partial<MapData> = {}): MapData {
  const blocked = new Set(["2,0", "-2,0", "0,-3"]);
  return {
    id: "test-village",
    name: "Test Village",
    kind: "village",
    region: "W",
    radius: 4,
    inn: { q: 0, r: 0 },
    tiles: spiral(hex(0, 0), 4).map((h) => [h.q, h.r, 0, "grass", blocked.has(`${h.q},${h.r}`) ? 1 : 0] as const),
    props: [{ q: 0, r: -3, kind: "tree" }],
    exits: [{ q: 4, r: 0, to: "world" }],
    spawns: [],
    chests: [{ id: "c1", q: -2, r: 0, gold: [50, 100], respawnSeconds: 600 }],
    npcs: [
      { id: "inn", q: 2, r: 0, kind: "inn" },
      { id: "spell-table", q: 0, r: -3, kind: "spell-table" },
    ],
    ...patch,
  };
}

describe("validateMap", () => {
  it("passes a good map", () => {
    expect(validateMap(village(), new Set(["test-village"]))).toEqual([]);
  });

  it("finds a map that is not one", () => {
    expect(validateMap(null)).toEqual(["a map is a JSON object"]);
    expect(validateMap({ id: "Bad Id", kind: "castle" }).length).toBeGreaterThan(2);
  });

  it("finds tiles off the map, twice over or of unknown terrain", () => {
    const map = village();
    const problems = validateMap({ ...map, tiles: [...map.tiles, [9, 0, 0, "grass", 0], [0, 0, 0, "lava-cake", 0], [1, 1, 0, "grass", 2]] });
    expect(problems).toEqual(expect.arrayContaining(["tile 9,0 is outside the radius", "tile 0,0: terrain lava-cake is unknown", "tile 0,0 is listed twice", "tile 1,1: blocked is 0 or 1"]));
  });

  it("wants a village's inn and spell table, and a town's vendors, armorer and board", () => {
    expect(validateMap(village({ npcs: [] }))).toEqual(expect.arrayContaining(["a village needs a inn", "a village needs a spell-table"]));
    expect(validateMap(village({ kind: "town" }))).toEqual(expect.arrayContaining(["a town needs a vendor", "a town needs a armorer", "a town needs a quest-board"]));
  });

  it("wants people and chests on blocked hexes and exits and spawns on open ones", () => {
    const problems = validateMap(
      village({
        npcs: [...village().npcs, { id: "folk", q: 1, r: 1, kind: "townsfolk" }],
        exits: [{ q: 2, r: 0, to: "world" }],
        spawns: [{ id: "s1", q: -2, r: 0, mobs: ["urborg-ghoul"], radius: 2, respawnSeconds: 600 }],
      }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "townsfolk folk at 1,1 stands on an open hex: its tile is blocked",
        "exit to world at 2,0 is blocked",
        "spawn s1 at -2,0 is blocked",
      ]),
    );
  });

  it("wants every map but the world map to name its inn, a town's own and any other map's a town's", () => {
    expect(validateMap(village({ inn: undefined }))).toContain("a village needs an inn to respawn at");
    expect(validateMap(village({ inn: { map: "elsewhere", q: 0, r: 0 } }), new Set(["test-village", "elsewhere"]))).toContain("a village's inn is its own");
    const wild = village({ kind: "wilderness", npcs: [] });
    expect(validateMap({ ...wild, inn: undefined })).toContain("a map names the inn a beaten player wakes at");
    expect(validateMap(wild)).toContain("only a town's or village's inn is on its own map; any other map's names the town's");
    expect(validateMap({ ...wild, inn: { map: "test-town", q: 1, r: 1 } }, new Set(["test-village", "test-town"]))).toEqual([]);
    expect(validateMap({ ...wild, inn: { map: "nowhere", q: 1, r: 1 } }, new Set(["test-village"]))).toContain("the inn is on nowhere: no such map");
  });

  it("follows exits to maps that exist", () => {
    expect(validateMap(village({ exits: [{ q: 4, r: 0, to: "nowhere" }] }), new Set(["test-village"]))).toContain("exit to nowhere: no such map");
  });

  it("finds what cannot be walked to", () => {
    // Wall the chest's corner off: a ring two steps round it, leaving room to stand beside it inside.
    const walled = new Set(spiral(hex(-2, 0), 2).filter((h) => Math.abs(h.q + 2) + Math.abs(h.r) + Math.abs(h.q + 2 + h.r) === 4).map((h) => `${h.q},${h.r}`));
    const map = village();
    const tiles = map.tiles.map((t) => (walled.has(`${t[0]},${t[1]}`) ? ([t[0], t[1], t[2], t[3], 1] as const) : t));
    expect(validateMap({ ...map, tiles })).toContain("chest c1 cannot be walked to");
  });
});

describe("GameMap", () => {
  it("puts an arriving player just inside the exit back, and a beaten one at the inn", () => {
    const map = new GameMap(village({ exits: [{ q: 4, r: 0, to: "world" }, { q: -4, r: 2, to: "next-door" }] }));
    const fromNext = map.arrival("next-door");
    expect(Math.max(Math.abs(fromNext.q + 4), Math.abs(fromNext.r - 2), Math.abs(fromNext.q + fromNext.r + 2))).toBe(1);
    expect(map.passable(fromNext)).toBe(true);
    expect(map.respawn()).toEqual(hex(0, 0));
    expect(map.arrival("somewhere-else")).toEqual(hex(0, 0));
    expect(map.thing(hex(2, 0))).toMatchObject({ kind: "npc" });
    expect(map.thing(hex(-2, 0))).toMatchObject({ kind: "chest" });
  });
});

describe("the nearest inn", () => {
  const world: MapData = {
    id: "world",
    name: "World",
    kind: "world",
    radius: 10,
    tiles: spiral(hex(0, 0), 10).map((h) => [h.q, h.r, 0, "grass", 0] as const),
    props: [],
    exits: [
      { q: 0, r: 0, to: "hub" },
      { q: 8, r: 0, to: "far-town" },
      { q: 3, r: 0, to: "near-village" },
      { q: 2, r: 0, to: "dungeon-1" },
    ],
    spawns: [],
    chests: [],
    npcs: [],
  };
  const maps = new Map<string, MapData>([
    ["world", world],
    ["hub", { ...village({ id: "hub", kind: "town" }) }],
    ["far-town", { ...village({ id: "far-town", kind: "town" }) }],
    ["near-village", village({ id: "near-village" })],
    ["dungeon-1", { ...village({ id: "dungeon-1", kind: "dungeon", floor: 1, inn: undefined, exits: [{ q: 4, r: 0, to: "world" }, { q: -4, r: 0, to: "dungeon-2" }] }) }],
    ["dungeon-2", { ...village({ id: "dungeon-2", kind: "dungeon", floor: 2, inn: undefined, exits: [{ q: 4, r: 0, to: "dungeon-1" }] }) }],
    ["roadside", { ...village({ id: "roadside", kind: "wilderness", inn: undefined, npcs: [] }) }],
  ]);
  maps.set("world", { ...world, encounters: [{ q: 7, r: 0, radius: 2, map: "roadside", chance: 0.1 }] });
  const load = (id: string) => Promise.resolve(maps.get(id)!);

  it("is found from a deep dungeon floor through the floors above", async () => {
    expect(await worldLocation("dungeon-2", load)).toEqual(hex(2, 0));
    expect(await nearestInn("dungeon-2", load)).toBe("near-village");
  });

  it("is the map's own when it has one", async () => {
    expect(await nearestInn("far-town", load)).toBe("far-town");
    expect(await innOf("far-town", load)).toEqual({ q: 0, r: 0 });
  });

  it("is written as the town's map and hex for any other map, an encounter's map by its zone", async () => {
    expect(await innOf("dungeon-2", load)).toEqual({ map: "near-village", q: 0, r: 0 });
    expect(await worldLocation("roadside", load)).toEqual(hex(7, 0));
    expect(await innOf("roadside", load)).toEqual({ map: "far-town", q: 0, r: 0 });
    expect(await innOf("world", load)).toBeNull();
  });
});
