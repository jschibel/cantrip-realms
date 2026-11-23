import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOCKED, type ChunkData, type InteriorData, type WorldData, chunkKey, chunkOf, frontStep, isBlocked, parseChunkKey } from "./format";
import { type KnownArt, checkChunk, checkInterior, lintWorld } from "./lint";
import { WorldFormatError, globSource, gridOfInterior, gridOfWorld, loadChunk, loadChunks, loadInterior, loadWorld } from "./load";

// The version-2 world format (format.ts), its loader and its lint, on the slice's sample world (fixtures/slice-world)
// and on files made wrong on purpose. The art's ids are checked against the registries in art/registries.test.ts.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "fixtures", "slice-world");
const read = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf8"));

function sample(): { world: WorldData; chunks: ChunkData[]; interiors: InteriorData[] } {
  const world = read("world.json") as WorldData;
  const chunks = readdirSync(join(root, "chunks")).map((f) => read(`chunks/${f}`) as ChunkData);
  const interiors = readdirSync(join(root, "interiors")).map((f) => read(`interiors/${f}`) as InteriorData);
  return { world, chunks, interiors };
}

function sourceOf(files: { world: unknown; chunks: Record<string, unknown>; interiors: Record<string, unknown> }) {
  const lazy = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`dir/${k}.json`, async () => v]));
  return globSource(async () => ({ default: files.world }), lazy(files.chunks), lazy(files.interiors));
}

describe("the version-2 world format", () => {
  it("names chunks by the tiles they hold, negative ones too", () => {
    expect(chunkOf(0, 31)).toEqual({ cx: 0, cz: 0 });
    expect(chunkOf(-1, 32)).toEqual({ cx: -1, cz: 1 });
    expect(parseChunkKey(chunkKey(-3, 1))).toEqual({ cx: -3, cz: 1 });
    expect(parseChunkKey("a_b")).toBeNull();
  });

  it("turns a building's front a quarter at a time, clockwise from the south", () => {
    expect([0, 1, 2, 3].map(frontStep)).toEqual([
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ]);
  });
});

describe("the sample world (fixtures/slice-world)", () => {
  it("lints clean as a whole", () => {
    const { world, chunks, interiors } = sample();
    expect(lintWorld(world, chunks, interiors)).toEqual([]);
  });

  it("loads through a source, every file checked, and walks as the slice did", async () => {
    const { world, chunks, interiors } = sample();
    const source = sourceOf({
      world,
      chunks: Object.fromEntries(chunks.map((c) => [chunkKey(c.cx, c.cz), c])),
      interiors: Object.fromEntries(interiors.map((i) => [i.id, i])),
    });
    const w = await loadWorld(source);
    const loaded = await loadChunks(source, w);
    expect(loaded).toHaveLength(15);
    const grid = gridOfWorld(w, loaded);
    // The street before the shop, the gateway, and out in the country; the shop's own walls, and past the world's edge.
    expect([grid.walkable(13, 12), grid.walkable(-1, 12), grid.walkable(-38, 16)]).toEqual([true, true, true]);
    expect([grid.walkable(13, 7), grid.walkable(-1, 5), grid.walkable(-61, 12), grid.walkable(-70, 12)]).toEqual([false, false, false, false]);
    // The bridge's deck and the rise's top tier stand up off the ground.
    expect(grid.heightAt(-50, 25)).toBe(1.5);
    const path = grid.path({ x: 13, z: 12 }, { x: -38, z: 16 });
    expect(path?.at(-1)).toEqual({ x: -38, z: 16 });

    const shop = await loadInterior(source, "shop");
    const room = gridOfInterior(shop);
    expect(room.walkable(6, 7) && room.walkable(6, 6) && !room.walkable(6, 8) && !room.walkable(3, 0)).toBe(true);
    const crypt = await loadInterior(source, "crypt");
    expect(gridOfInterior(crypt).heightAt(6, 2)).toBe(0.375);
  });

  it("refuses a chunk that is not what the format says", async () => {
    const { world, chunks } = sample();
    const good = chunks[0]!;
    const bad = { ...good, tiles: good.tiles.slice(1) };
    const source = sourceOf({ world, chunks: { [chunkKey(good.cx, good.cz)]: bad }, interiors: {} });
    await expect(loadChunk(source, good.cx, good.cz)).rejects.toBeInstanceOf(WorldFormatError);
    expect(checkChunk(bad, good.cx, good.cz).join()).toMatch(/1023 tiles/);
    expect(checkChunk({ ...good, tiles: good.tiles.map((t, i) => (i === 5 ? [0.5, "grass", 0] : t)) }, good.cx, good.cz).join()).toMatch(/tile 5/);
    expect(checkChunk({ ...good, props: [{ id: "tree", x: good.cx * 32 + 40, z: good.cz * 32 }] }, good.cx, good.cz).join()).toMatch(/outside/);
    expect(await loadChunk(source, 99, 99)).toBeNull();
  });

  it("catches a door into nothing, an exit onto a wall, an entry in a wall", () => {
    const { world, chunks, interiors } = sample();
    const withShop = chunks.find((c) => c.buildings.some((b) => b.interior === "shop"))!;
    const broken = chunks.map((c) => (c === withShop ? { ...c, buildings: c.buildings.map((b) => (b.interior === "shop" ? { ...b, interior: "nowhere" } : b)) } : c));
    expect(lintWorld(world, broken, interiors).join("\n")).toMatch(/no interior nowhere[\s\S]*no door leads into it/);
    const shop = interiors.find((i) => i.id === "shop")!;
    const walled = interiors.map((i) => (i === shop ? { ...i, exit: [13, 7] as const } : i));
    expect(lintWorld(world, chunks, walled).join("\n")).toMatch(/exit 13,7 is not the door/);
    const blocked = { ...shop, tiles: shop.tiles.map((t, k) => (k === 7 * 12 + 6 ? ([t[0], t[1], BLOCKED] as const) : t)) };
    expect(checkInterior(blocked, "shop").join()).toMatch(/entry 6,7 is not an open tile/);
  });

  it("checks every id the world names against the art it is given", () => {
    const { world, chunks, interiors } = sample();
    const none: KnownArt = { surfaces: new Set(), props: new Set(), styles: new Set(), rooms: new Set(), figures: new Set(), palettes: new Set() };
    const problems = lintWorld(world, chunks, interiors, none).join("\n");
    for (const missing of ['no surface "grass"', "no prop tree", "no building style benalish", "no room recipe for crypt", "no figure knight"]) expect(problems).toContain(missing);
  });

  it("keeps nothing walkable past the world's edge", () => {
    const { world, chunks } = sample();
    const outside = chunks.flatMap((c) => c.tiles.filter((t, i) => {
      const x = c.cx * 32 + (i % 32);
      const z = c.cz * 32 + Math.floor(i / 32);
      const [ox, oz] = world.origin!;
      return (x < ox || z < oz || x >= ox + world.size[0] || z >= oz + world.size[1]) && !isBlocked(t);
    }));
    expect(outside).toEqual([]);
  });
});
