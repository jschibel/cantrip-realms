import { describe, expect, it } from "vitest";
import { ghoul, goblin, hero, knight, skeleton, townswoman } from "./characters";
import * as C from "./colors";
import * as P from "./pictures";
import type { Pixmap } from "./pixmap";
import * as T from "./textures";

// The slice's painted art (textures.ts, pictures.ts): the same on every load, seamless where it tiles, and every texel
// one of the palette's colors' kin - nothing left unpainted or transparent where a surface should be solid.

const same = (a: Pixmap, b: Pixmap) => a.width === b.width && a.height === b.height && a.data.every((v, i) => v === b.data[i]);

describe("the slice's textures", () => {
  const surfaces: [string, () => Pixmap][] = [
    ["grass", () => T.grass(1)],
    ["cobbles", () => T.cobbles(2)],
    ["flagstones", () => T.flagstones(C.LIMESTONE, 3)],
    ["dirt", () => T.dirt(4)],
    ["floorboards", () => T.floorboards(5)],
    ["plaster", () => T.plaster(6)],
    ["ashlar", () => T.ashlar(C.LIMESTONE, 7)],
    ["roof tiles", () => T.roofTiles()],
    ["leaves", () => T.leaves(11)],
    ["crypt floor", () => T.cryptFloor(14)],
  ];

  for (const [name, paint] of surfaces) {
    it(`${name}: painted the same every time, solid all over`, () => {
      const a = paint();
      expect(same(a, paint())).toBe(true);
      for (let i = 3; i < a.data.length; i += 4) expect(a.data[i]).toBe(255);
      // Many colors, never one flat fill.
      const colors = new Set<number>();
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) colors.add(a.get(x, y));
      expect(colors.size).toBeGreaterThan(3);
    });
  }

  it("every shelf of books and of wares paints, whatever its seed", () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(P.bookshelf(seed, false).height).toBe(32);
      expect(P.bookshelf(seed, true).height).toBe(32);
    }
  });

  it("pictures are painted at the size of the faces they fit (16 texels to a tile)", () => {
    expect([P.door().width, P.door().height]).toEqual([20, 32]);
    expect([P.windowPicture().width, P.windowPicture().height]).toEqual([16, 18]);
    expect([P.banner().width, P.banner().height]).toEqual([12, 32]);
    expect([P.crateSide(12).width, P.produce("apples", 10).width]).toEqual([12, 10]);
    expect([P.rug(64, 40).width, P.rug(64, 40).height]).toEqual([64, 40]);
    expect([P.hearth(44, 36).width, P.sarcophagusLid(24, 40).height]).toEqual([44, 40]);
  });
});

describe("the slice's figures", () => {
  it("are rigs of named parts that walk and look about", () => {
    for (const spec of [hero(), knight(), goblin(true), goblin(false), skeleton(), ghoul(), townswoman()]) {
      const names = spec.parts.map((p) => p.name);
      for (const part of ["leg.l", "leg.r", "torso", "arm.l", "arm.r", "head"]) expect(names).toContain(part);
      for (const p of spec.parts) if (p.parent) expect(names).toContain(p.parent);
    }
  });
});
