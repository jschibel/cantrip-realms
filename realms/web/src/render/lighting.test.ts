import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { lit } from "./lighting";
import { SUN_DEPTH_BIAS, SUN_NORMAL_BIAS, sunDepth, sunlight } from "./lights";

// The lit materials (lighting.ts) and the sun (lights.ts): how they cast the sun's shadows.

describe("a lit material", () => {
  it("casts its shadow from both faces, so a roof or an awning - a single face - casts one toward the sun", () => {
    expect(lit(null).shadowSide).toBe(THREE.DoubleSide);
    expect(lit(null, { twoSided: true }).shadowSide).toBe(THREE.DoubleSide);
  });
});

describe("the sun's shadow", () => {
  // The world's bias along the sun's beam, from the share of the depth three adds it as.
  const along = (sun: THREE.DirectionalLight) => -sun.shadow.bias * (sun.shadow.camera.far - sun.shadow.camera.near);

  it("holds a lit face off its own depth by a hundredth of a unit however deep the map, so a shadow meets the foot of what casts it", () => {
    const sun = sunlight(new THREE.Scene(), 0, 0, 20);
    expect(along(sun)).toBeCloseTo(SUN_DEPTH_BIAS, 9);
    sunDepth(sun, -80, 160);
    expect(along(sun)).toBeCloseTo(SUN_DEPTH_BIAS, 9);
    expect(sun.shadow.camera.near).toBe(-80);
    expect(sun.shadow.camera.far).toBe(160);
    // Under a sixth of a texel: the gap it leaves at a foot is less than a pixel.
    expect(SUN_DEPTH_BIAS).toBeLessThan(1 / 16 / 6);
  });

  it("lifts a lit point off its face by more than seven tenths of the coarsest fit's texel, so no slope speckles", () => {
    const sun = sunlight(new THREE.Scene(), 0, 0, 20);
    expect(sun.shadow.normalBias).toBe(SUN_NORMAL_BIAS);
    expect(SUN_NORMAL_BIAS).toBeGreaterThan(0.7 * 0.055);
  });
});
