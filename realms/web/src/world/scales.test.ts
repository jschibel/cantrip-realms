import { describe, expect, it } from "vitest";
import { BASIN, GROUNDS, SITE, SOUTH, TRAVEL, TWO_CAVES, TWO_CHUNKS, TWO_WORLD, WEST, chunksOf, twoChunk, twoFiles, twoSource } from "../../fixtures/two-world/source";
import { LARGE_WORLD } from "../../fixtures/large-world/source";
import { BLOCKED, type ChunkData, type InteriorData, type TownData, type WorldData, chunkKey, framingAt, groundChunks, groundsAt, hasGround, inTravel, scaleAt, siteAt, siteRect, sideStep, travelRect, wayAt, worldRect } from "./format";
import { checkWorld, lintRealm, lintWorld } from "./lint";
import { loadAllChunks, loadChunks, loadInterior, loadWorld } from "./load";

// The two scales (interfaces.md, "Two scales"): the format's helpers, the lint of a world of two scales good and bad, and
// loading a world whose chunks lie only over its ground - on the two-scale fixture (fixtures/two-world).

const town = TWO_WORLD.towns[0]!;

async function whole(): Promise<{ chunks: ChunkData[]; rooms: InteriorData[] }> {
  const source = twoSource();
  const chunks = await loadAllChunks(source);
  const rooms = await Promise.all(["twoford-inn", "twoford-shop"].map((id) => loadInterior(source, id)));
  return { chunks, rooms };
}

/** The world with its town changed. */
const withTown = (patch: Partial<TownData>): WorldData => ({ ...TWO_WORLD, overview: TWO_WORLD.overview, towns: [{ ...town, ...patch }] });

describe("the two scales' helpers", () => {
  it("tell the travel map from a town's grounds and from no ground", () => {
    expect(inTravel(TWO_WORLD, 10, 10)).toBe(true);
    expect(inTravel(TWO_WORLD, 200, 10)).toBe(false);
    expect(groundsAt(TWO_WORLD, 240, 44)?.id).toBe("twoford");
    expect(groundsAt(TWO_WORLD, 48, 40)).toBeNull();
    expect(scaleAt(TWO_WORLD, 10, 10)).toEqual({ scale: "travel" });
    expect(scaleAt(TWO_WORLD, 240, 44)).toMatchObject({ scale: "grounds", town: { id: "twoford" } });
    expect(scaleAt(TWO_WORLD, 140, 10)).toBeNull();
    expect(travelRect(TWO_WORLD)).toEqual(TRAVEL);
    expect(framingAt(TWO_WORLD, 240, 44)).toEqual(GROUNDS);
    expect(framingAt(TWO_WORLD, 20, 20)).toEqual(TRAVEL);
  });

  it("find a town's icon and its ways", () => {
    expect(siteRect(town)).toEqual([46, 38, 51, 43]);
    expect(siteAt(TWO_WORLD, 46, 42)?.id).toBe("twoford");
    expect(siteAt(TWO_WORLD, 45, 40)).toBeNull();
    expect(wayAt(TWO_WORLD, ...WEST.outside)).toMatchObject({ end: "outside", way: { side: "west" } });
    expect(wayAt(TWO_WORLD, 240, 91)).toMatchObject({ end: "exit", way: { side: "south" } });
    expect(wayAt(TWO_WORLD, 240, 90)).toBeNull();
    expect(sideStep("north")).toEqual([0, -1]);
    expect(sideStep("west")).toEqual([-1, 0]);
  });

  it("know which chunks there are from the travel map and the grounds", () => {
    const chunks = groundChunks(TWO_WORLD)!;
    expect([...chunks].sort()).toEqual([...chunksOf(TRAVEL), ...chunksOf(GROUNDS)].sort());
    expect(chunks.size).toBe(18);
    expect(hasGround(TWO_WORLD, 0, 0)).toBe(true);
    expect(hasGround(TWO_WORLD, 4, 1)).toBe(false);
    expect(hasGround(TWO_WORLD, 7, 2)).toBe(true);
    expect(hasGround(TWO_WORLD, 9, 0)).toBe(false);
  });

  it("leave a world of one scale as it was", () => {
    expect(groundChunks(LARGE_WORLD)).toBeNull();
    expect(inTravel(LARGE_WORLD, 3, 3)).toBe(true);
    expect(hasGround(LARGE_WORLD, 7, 7)).toBe(true);
    expect(hasGround(LARGE_WORLD, 8, 0)).toBe(false);
    expect(framingAt(LARGE_WORLD, 10, 10)).toEqual(worldRect(LARGE_WORLD));
    expect(checkWorld(LARGE_WORLD)).toEqual([]);
  });
});

describe("loading a world of two scales", () => {
  it("asks for no chunk over no ground", async () => {
    const asked: string[] = [];
    const source = twoSource();
    const counting = { ...source, chunk: (cx: number, cz: number) => (asked.push(chunkKey(cx, cz)), source.chunk(cx, cz)), chunkKeys: undefined };
    const world = await loadWorld(counting);
    const chunks = await loadChunks(counting, world);
    expect(chunks.map((c) => chunkKey(c.cx, c.cz)).sort()).toEqual([...TWO_CHUNKS]);
    expect(asked.sort()).toEqual([...TWO_CHUNKS]);
  });

  it("has a chunk for every chunk of ground and none past it", () => {
    expect(twoChunk(4, 1)).toBeNull();
    expect(twoChunk(6, 0)?.tiles).toHaveLength(1024);
  });
});

describe("the lint of a world of two scales", () => {
  // The inn is in the grounds and the travel map is walked to from there only through the ways: the fixture passing is
  // the walk following them.
  it("passes the fixture whole: walked from the inn, through the ways, to every open tile", async () => {
    const { chunks, rooms } = await whole();
    expect(lintRealm(TWO_WORLD, chunks, rooms, [TWO_CAVES])).toEqual([]);
  });

  it("finds a world.json whose two scales do not hold together", () => {
    const problems = (patch: Partial<TownData>) => checkWorld(withTown(patch));
    expect(problems({})).toEqual([]);
    expect(problems({ grounds: [96, 0, 160, 64] }).join("\n")).toMatch(/within 2 chunks of the travel map/);
    expect(problems({ grounds: [64, 0, 128, 64] }).join("\n")).toMatch(/within 2 chunks of the travel map/);
    expect(problems({ ways: [{ ...WEST, outside: [44, 40] }] }).join("\n")).toMatch(/not beside the icon on its west/);
    expect(problems({ ways: [{ ...SOUTH, inside: [40, 40] }] }).join("\n")).toMatch(/inside 40,40 is not in its grounds/);
    expect(problems({ ways: [{ ...SOUTH, to: "nowhere" }] }).join("\n")).toMatch(/leads to nowhere/);
    expect(problems({ ways: [] }).join("\n")).toMatch(/no way between its grounds and the travel map/);
    expect(problems({ site: undefined }).join("\n")).toMatch(/no site/);
    expect(problems({ center: [20, 20] }).join("\n")).toMatch(/centre 20,20 is not in its grounds/);
    expect(problems({ grounds: undefined }).join("\n")).toMatch(/with no grounds, it stands on the travel map, but its centre 240,44 is not on it/);
    expect(problems({ grounds: undefined, center: [20, 20], site: undefined, ways: undefined })).toEqual([]);
    expect(checkWorld({ ...TWO_WORLD, overview: TWO_WORLD.overview, inns: [{ ...TWO_WORLD.inns[0]!, x: 30, z: 30 }] }).join("\n")).toMatch(/its inn twoford-inn at 30,30 is not in its grounds/);
    expect(checkWorld({ ...TWO_WORLD, overview: TWO_WORLD.overview, dungeons: [{ id: "two-caves", x: 230, z: 30 }] }).join("\n")).toMatch(/dungeon two-caves at 230,30 is not on the travel map/);
    expect(checkWorld({ ...TWO_WORLD, overview: TWO_WORLD.overview, zones: { ...TWO_WORLD.zones, cols: 9, grid: TWO_WORLD.zones.grid.map((r) => [...r, ...r, ...r]) } }).join("\n")).toMatch(/zones reach past the travel map/);
    expect(checkWorld({ ...TWO_WORLD, overview: TWO_WORLD.overview, labels: [{ name: "X", x: 1, z: 1, kind: "ocean" as "sea" }] }).join("\n")).toMatch(/labels should be/);
    expect(checkWorld({ ...TWO_WORLD, overview: TWO_WORLD.overview, travel: undefined }).join("\n")).toMatch(/no travel map/);
    const second: TownData = { ...town, id: "other", grounds: [256, 96, 320, 160] };
    expect(checkWorld({ ...TWO_WORLD, size: [320, 160], overview: TWO_WORLD.overview, towns: [town, second] }).join("\n")).toMatch(/grounds lie within 2 chunks of twoford's/);
  });

  it("finds chunks over no ground, missing ground and ways on closed tiles", async () => {
    const { chunks, rooms } = await whole();
    const stray: ChunkData = { cx: 4, cz: 0, tiles: chunks[0]!.tiles, props: [], buildings: [], npcs: [], spawns: [], entrances: [], waymarkers: [] };
    expect(lintWorld(TWO_WORLD, [...chunks, stray], rooms).join("\n")).toMatch(/chunk 4_0: a file over no ground/);
    expect(lintWorld(TWO_WORLD, chunks.filter((c) => !(c.cx === 7 && c.cz === 1)), rooms).join("\n")).toMatch(/no chunk 7_1 for the world's ground/);
    // The south way's inside closed: a tile of the road blocked.
    const closed = chunks.map((c) => (c.cx === 7 && c.cz === 2 ? { ...c, tiles: c.tiles.map((t, i) => (224 + (i % 32) === SOUTH.inside[0] && 64 + Math.floor(i / 32) === SOUTH.inside[1] ? ([t[0], t[1], BLOCKED] as const) : t)) } : c));
    expect(lintWorld(TWO_WORLD, closed, rooms).join("\n")).toMatch(/its south way's inside 240,83 is not an open tile/);
    // The icon on an open tile.
    const openIcon = chunks.map((c) => (c.cx === 1 && c.cz === 1 ? { ...c, tiles: c.tiles.map((t, i) => (32 + (i % 32) === SITE[0] && 32 + Math.floor(i / 32) === SITE[1] ? ([0, "grass", 0] as const) : t)) } : c));
    expect(lintWorld(TWO_WORLD, openIcon, rooms).join("\n")).toMatch(/its icon's tile 48,40 is open/);
  });

  it("finds spawns off the travel map and near the icon", async () => {
    const { chunks, rooms } = await whole();
    const inGrounds = chunks.map((c) => (c.cx === 7 && c.cz === 1 ? { ...c, spawns: [{ id: "7_1:0", x: 230, z: 50, mobs: ["benalish-hero"], radius: 2, respawnSeconds: 600, tier: 1 }] } : c));
    expect(lintRealm(TWO_WORLD, inGrounds, rooms, [TWO_CAVES]).join("\n")).toMatch(/a spawn at 230,50 is not on the travel map/);
    const nearIcon = chunks.map((c) => (c.cx === 1 && c.cz === 1 ? { ...c, spawns: [{ id: "1_1:0", x: 55, z: 40, mobs: ["benalish-hero"], radius: 2, respawnSeconds: 600, tier: 1 }] } : c));
    expect(lintRealm(TWO_WORLD, nearIcon, rooms, [TWO_CAVES]).join("\n")).toMatch(/spawn 1_1:0 stands within 10 tiles of twoford's icon/);
  });

  it("keeps the basin within the grounds, and the files as the source makes them", () => {
    expect(BASIN[0] >= GROUNDS[0] && BASIN[2] <= GROUNDS[2]).toBe(true);
    const files = twoFiles();
    expect(files.size).toBe(TWO_CHUNKS.length + 4);
    expect(checkWorld(files.get("world/world.json"))).toEqual([]);
  });
});
