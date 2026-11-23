import { describe, expect, it } from "vitest";
import { CLOTH, RING_COLORS, SKIN_PALETTES } from "./character";
import type { Terrain } from "./maps/schema";
import { DOMINARIA, colorsOf, nearest, shadeOf } from "./palette";
import { terrainColor } from "./scene/world";

const TERRAINS: readonly Terrain[] = ["grass", "meadow", "dirt", "road", "cobble", "stone", "rock", "sand", "water", "deep-water", "swamp", "mud", "moss", "snow", "ice", "ash", "lava", "floor", "wood", "marble", "crystal", "forest", "hills", "mountain"];
const IDENTITY = ["white", "blue", "black", "red", "green"] as const;

describe("the palette", () => {
  it("is ramps of a few colors each, no color in two", () => {
    const colors = colorsOf(DOMINARIA).map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
    for (const ramp of Object.values(DOMINARIA.ramps)) {
      expect(ramp.length).toBeGreaterThanOrEqual(3);
      expect(ramp.length).toBeLessThanOrEqual(7);
    }
  });

  it("shades a color a step down its ramp in shadow and a step up in the sun, clamped at the ends", () => {
    const grass = DOMINARIA.ramps.grass!;
    expect(shadeOf(grass, 2, 0)).toBe(grass[1]);
    expect(shadeOf(grass, 2, 1)).toBe(grass[2]);
    expect(shadeOf(grass, 2, 2)).toBe(grass[3]);
    expect(shadeOf(grass, 0, 0)).toBe(grass[0]);
    expect(shadeOf(grass, grass.length - 1, 2)).toBe(grass.at(-1));
    expect(shadeOf(grass, 2, 1, 2)).toBe(grass[1]);
    expect(shadeOf(grass, 2, 2, 2)).toBe(grass[2]);
  });

  it("gives the land its own colors and characters theirs: no terrain is an identity color", () => {
    const identity = new Set(IDENTITY.flatMap((r) => DOMINARIA.ramps[r]!));
    for (const terrain of TERRAINS) {
      const color = terrainColor(terrain);
      expect(nearest(DOMINARIA, color), terrain).toBe(color);
      expect(identity.has(color), terrain).toBe(false);
    }
    for (const { cloth } of Object.values(CLOTH)) expect(identity.has(cloth)).toBe(true);
    for (const ring of Object.values(RING_COLORS)) expect(identity.has(ring)).toBe(true);
    for (const { skin, hair } of SKIN_PALETTES) {
      expect(nearest(DOMINARIA, skin)).toBe(skin);
      expect(nearest(DOMINARIA, hair)).toBe(hair);
    }
  });
});
