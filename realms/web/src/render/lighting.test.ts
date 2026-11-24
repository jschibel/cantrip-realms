import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { lit } from "./lighting";

// The lit materials (lighting.ts): how they cast the sun's shadows.

describe("a lit material", () => {
  it("casts its shadow from both faces, so a roof or an awning - a single face - casts one toward the sun", () => {
    expect(lit(null).shadowSide).toBe(THREE.DoubleSide);
    expect(lit(null, { twoSided: true }).shadowSide).toBe(THREE.DoubleSide);
  });
});
