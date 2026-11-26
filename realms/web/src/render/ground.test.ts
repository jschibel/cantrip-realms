import { describe, expect, it } from "vitest";
import { Pixmap } from "../art/paint/pixmap";
import { SURFACES } from "../art/surfaces";
import { brinkMap, buildGround, groundAtlas, groundMap } from "./ground";

// The ground's tile map (ground.ts): every tile carries its surface, its priority's rank and its hole flag, so a block
// may use any number of surfaces and every hole among them is a gap - a river running into the sea, lava beside oil.

const texel = (m: ReturnType<typeof groundMap>, i: number, j: number) => [...m.data.subarray((j * m.width + i) * 4, (j * m.width + i) * 4 + 3)];

describe("the ground's tile map", () => {
  it("marks every hole surface, not only the first", () => {
    const ids = ["grass", "river", "sea", "sand", "lava", "oil", "ash"];
    const looks = ids.map((id) => SURFACES.look(id));
    const map = groundMap([[0, 1, 2, 3, 4, 5, 6, -1]], looks);
    const holes = Array.from({ length: 8 }, (_, i) => texel(map, i, 0)[2]);
    expect(holes).toEqual([0, 255, 255, 0, 255, 255, 0, 0]);
  });

  it("ranks priorities in order, ties alike, nothing with the lowest (a hole's)", () => {
    const map = groundMap([[0, 1, 2, 3, -1]], [{ priority: 5 }, { priority: 1.05 }, { priority: -1, hole: true }, { priority: 5 }]);
    const [grass, cobbles, water, grass2, none] = Array.from({ length: 5 }, (_, i) => texel(map, i, 0));
    expect(grass![1]).toBe(grass2![1]);
    expect(grass![1]).toBeGreaterThan(cobbles![1]!);
    expect(cobbles![1]).toBeGreaterThan(water![1]!);
    expect(none).toEqual([255, map.noneRank, 0]);
    expect(water![1]).toBe(map.noneRank);
  });

  it("takes as many surfaces as a block uses: well past the 16 it once read", () => {
    const ids = SURFACES.ids().slice(0, 40);
    expect(ids.length).toBe(40);
    const looks = ids.map((id) => SURFACES.look(id));
    const map = groundMap([ids.map((_, i) => i)], looks);
    for (let i = 0; i < ids.length; i++) {
      const [id, rank, hole] = texel(map, i, 0);
      expect(id).toBe(i);
      // The rank orders exactly as the priority does.
      for (let k = 0; k < ids.length; k++) expect(Math.sign(rank! - texel(map, k, 0)[1]!)).toBe(Math.sign(looks[i]!.priority - looks[k]!.priority));
      expect(hole).toBe(looks[i]!.hole ? 255 : 0);
    }
    const { atlas, columns, rows } = groundAtlas(looks);
    expect([columns, rows, atlas.width, atlas.height]).toEqual([8, 5, 512, 320]);
    // Surface 13 is at column 5, row 1.
    const picture = looks[13]!.picture;
    expect(atlas.get(5 * 64 + 3, 64 + 7)).toBe(picture.get(3, 7));
    expect(() => buildGround([ids.map((_, i) => i)], looks)).not.toThrow();
  });

  it("lays a few surfaces out in one row", () => {
    const p = new Pixmap(64, 64);
    const { columns, rows } = groundAtlas([{ picture: p }, { picture: p }, { picture: p }]);
    expect([columns, rows]).toEqual([3, 1]);
  });

  it("gives each surface its brink's stone, and none where it has no bank", () => {
    const looks = ["grass", "snow", "rock", "floorboards"].map((id) => SURFACES.look(id));
    expect(looks[0]!.brink).toBeDefined();
    expect(looks[3]!.brink).toBeUndefined();
    const data = brinkMap(looks);
    const color = (i: number) => [...data.subarray(i * 4, i * 4 + 4)];
    expect(color(0)).toEqual([(looks[0]!.brink! >> 16) & 255, (looks[0]!.brink! >> 8) & 255, looks[0]!.brink! & 255, 255]);
    expect(color(1)[3]).toBe(255);
    expect(color(3)).toEqual([0, 0, 0, 0]);
    // A block with relief takes it tile for tile; a mismatched one is refused.
    expect(() => buildGround([[0, 1]], looks, { x: 0, z: 0 }, 0, { x: 0, z: 0 }, undefined, new Float32Array(8))).not.toThrow();
    expect(() => buildGround([[0, 1]], looks, { x: 0, z: 0 }, 0, { x: 0, z: 0 }, undefined, new Float32Array(4))).toThrow();
  });
});
