import { describe, expect, it } from "vitest";
import vectors from "../../content/spawn-vectors.json";
import { fnv1a32 } from "./random";
import { spawnEpoch, spawnKey, spawnMob } from "./spawn";

describe("the spawn algorithm", () => {
  it("has golden vectors to check", () => {
    expect(vectors.cases.length).toBeGreaterThan(0);
  });

  for (const c of vectors.cases) {
    it(`matches the golden vector ${c.key}`, () => {
      const spawn = { id: c.spawn, mobs: c.mobs, respawnSeconds: c.respawnSeconds };
      const epoch = spawnEpoch(spawn, c.unixSeconds);
      expect(spawnKey(c.player, c.map, c.spawn, epoch)).toBe(c.key);
      expect(fnv1a32(c.key)).toBe(c.seed);
      expect(spawnMob(c.player, c.map, spawn, epoch)).toBe(c.mob);
    });
  }

  it("hashes the empty string and ASCII as FNV-1a does", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
});
