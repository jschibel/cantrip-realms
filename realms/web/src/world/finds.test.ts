import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../random";
import { FIND_APART, FIND_RULES, FindSpawner, HEARTBLOOM_APART, type StandingFind, WORKED_GROUND, goldOf, zoneOf } from "./finds";
import { CHUNK, type ChunkData, type WorldData, chunkKey, isBlocked, townAt } from "./format";

// The stand-in's finds of the wilds (finds.ts), spawned over Dominaria's own files, as the server's are (FindsTests):
// what holds whatever its dice roll.

const plane = join(__dirname, "..", "..", "..", "content", "dominaria", "world");
const world = JSON.parse(readFileSync(join(plane, "world.json"), "utf8")) as WorldData;
const chunks = new Map<string, ChunkData>();
for (const f of readdirSync(join(plane, "chunks"))) {
  const c = JSON.parse(readFileSync(join(plane, "chunks", f), "utf8")) as ChunkData;
  chunks.set(chunkKey(c.cx, c.cz), c);
}
const tileAt = (x: number, z: number) => chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)))?.tiles[(z - Math.floor(z / CHUNK) * CHUNK) * CHUNK + (x - Math.floor(x / CHUNK) * CHUNK)];

describe("the finds of the wilds", () => {
  it("come and go a few to a zone, each on open ground of the wilds, and crumble in their time", async () => {
    const spawner = new FindSpawner(world, async (cx, cz) => chunks.get(chunkKey(cx, cz)) ?? null, mulberry32(20261125));
    const start = 1_800_000_000_000;
    const seen = new Map<string, StandingFind>();
    for (let minute = 1; minute <= 6 * 60; minute++) {
      const now = start + minute * 60_000;
      const standing = await spawner.standing(now);
      const byZone = new Map<number, number>();
      for (const f of standing) {
        expect(f.until, `${f.id} stands past its time`).toBeGreaterThan(now);
        seen.set(f.id, f);
        if (f.kind === "chest") byZone.set(zoneOf(world, f.x, f.z), (byZone.get(zoneOf(world, f.x, f.z)) ?? 0) + 1);
        for (const o of standing) {
          if (o === f) continue;
          const apart = Math.max(Math.abs(o.x - f.x), Math.abs(o.z - f.z));
          expect(apart, `${f.id} and ${o.id}`).toBeGreaterThanOrEqual(f.kind === "heartbloom" && o.kind === "heartbloom" ? HEARTBLOOM_APART : FIND_APART);
        }
      }
      for (const [zone, n] of byZone) expect(n, `zone ${zone}'s chests`).toBeLessThanOrEqual(FIND_RULES.chestsPerZone);
      expect(standing.filter((f) => f.kind === "heartbloom").length).toBeLessThanOrEqual(FIND_RULES.heartblooms);
    }
    const all = [...seen.values()];
    expect(all.some((f) => f.kind === "chest")).toBe(true);
    expect(all.some((f) => f.kind === "heartbloom")).toBe(true);
    for (const f of all) {
      const zone = zoneOf(world, f.x, f.z);
      expect(zone, `${f.id} in a zone`).toBeGreaterThanOrEqual(0);
      expect(f.tier).toBe(world.zones.areas[zone]!.tier);
      expect(f.tier).toBeGreaterThan(0);
      expect(townAt(world.towns, f.x, f.z), `${f.id} in a town`).toBeNull();
      const here = tileAt(f.x, f.z)!;
      expect(WORKED_GROUND.has(here[1]), `${f.id} on ${here[1]}`).toBe(false);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) expect(isBlocked(tileAt(f.x + dx, f.z + dz)!), `${f.id}: ${f.x + dx},${f.z + dz}`).toBe(false);
      expect(f.until - f.since).toBe((f.kind === "chest" ? FIND_RULES.chestLasts : FIND_RULES.heartbloomLasts) * 1000);
    }

    // Taken, gone for all; a chest's gold by its tier, the richest in the hardest wilds.
    const one = all.at(-1)!;
    expect(spawner.take(one.id)).toBe(true);
    expect(spawner.take(one.id)).toBe(false);
    expect([1, 2, 3, 4].map(goldOf)).toEqual([[50, 150], [100, 250], [180, 380], [300, 500]]);
  });

  it("never spawn where a player stands", async () => {
    const spawner = new FindSpawner(world, async (cx, cz) => chunks.get(chunkKey(cx, cz)) ?? null, mulberry32(7), { ...FIND_RULES, chestEvery: 60 });
    // Players standing all over the wilds' middles: nothing comes within four tiles of one.
    const players = [...chunks.values()].map((c) => ({ x: c.cx * CHUNK + 16, z: c.cz * CHUNK + 16 }));
    for (let minute = 1; minute <= 120; minute++) {
      for (const f of await spawner.standing(minute * 60_000, players)) {
        for (const p of players) expect(Math.max(Math.abs(p.x - f.x), Math.abs(p.z - f.z)), `${f.id} by a player`).toBeGreaterThanOrEqual(4);
      }
    }
  });
});
