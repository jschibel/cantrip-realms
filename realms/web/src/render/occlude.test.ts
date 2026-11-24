import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MeshBuilder, sides } from "../art/paint/builder";
import { flat } from "../art/paint/materials";
import { FADE_MIN, OCCLUDE, aimOccluders, occluderOfModel, twoRects } from "./occlude";
import { mergedMeshes } from "./place";

// The occluder fade's shapes and aim (occlude.ts): what an occluder stands on, its box, and which occluders fade for
// where the player stands - a shop's awning over them makes the shop fade (its fragments then fade where they stand in
// front of the player, the shader's part, e2e/occlude.spec.ts).

describe("an occluder", () => {
  it("stands where its lowest parts are, unless it says otherwise", () => {
    const b = new MeshBuilder();
    // A trunk on the ground and a crown spreading wide above it.
    b.box(4.4, 0, 6.4, 4.6, 2, 6.6, sides(flat(0x6a4a30)));
    b.box(3, 2, 5, 6, 4, 8, sides(flat(0x2a6a30)));
    const model = b.model();
    const tree = occluderOfModel(model)!;
    expect(tree.feet).toEqual([[4.4, 6.4, 4.6, 6.6], null]);
    expect([tree.box.min.toArray(), tree.box.max.toArray()]).toEqual([[3, 0, 5], [6, 4, 8]]);
    expect(occluderOfModel(model, [[4, 6, 5, 7]])!.feet).toEqual([[4, 6, 5, 7], null]);
  });

  it("keeps two footprints, merging the nearest", () => {
    expect(twoRects([[0, 0, 1, 1]])).toEqual([[0, 0, 1, 1], null]);
    // A wall and a tower each side of a gate: each side's two become one, the gate's gap between them kept.
    expect(twoRects([[0, 0, 1, 4], [0, 4, 2, 6], [0, 8, 2, 10], [0, 10, 1, 14]])).toEqual([[0, 0, 2, 6], [0, 8, 2, 14]]);
  });

  it("leaves a quarter of itself where it fades", () => {
    expect(FADE_MIN).toBe(0.25);
  });
});

describe("the occluders aimed at", () => {
  // A shop on (0, 0)-(6, 4), its front to the south (z 4), 3 high, with an awning over the street in front of it,
  // seen from the front heading (the camera looking north and down at 45 degrees).
  const shop = (): THREE.Scene => {
    const b = new MeshBuilder();
    b.box(0, 0, 0, 6, 3, 4, sides(flat(0xc8b8a0)));
    b.quad({ mat: flat(0xc03030) }, [[1, 1.9, 4.7], [3, 1.9, 4.7], [3, 2.25, 4], [1, 2.25, 4]], (c) => c[0], (c) => -c[2] + c[1]);
    // Its scalloped edge hanging, as a Benalish shop's (art/buildings/benalish.ts `displayAt`).
    b.quad({ mat: flat(0xf0e0d0) }, [[1, 1.53, 4.7], [3, 1.53, 4.7], [3, 1.9, 4.7], [1, 1.9, 4.7]], (c) => c[0], (c) => c[1]);
    const scene = new THREE.Scene();
    scene.add(mergedMeshes([b.model()], "tall", true, true, [[[0, 0, 6, 4]]]));
    scene.updateMatrixWorld(true);
    return scene;
  };
  const camera = new THREE.OrthographicCamera();
  camera.rotation.order = "YXZ";
  camera.rotation.set(-Math.PI / 4, 0, 0);
  camera.updateMatrixWorld();

  it("are what stands between the player and the camera: a shop's awning over them, not the open street", () => {
    const scene = shop();
    const under = new THREE.Vector3(2, 0, 4.5);
    expect(aimOccluders(true, under, camera, 1 / 16, Math.SQRT1_2 / 16, scene), "under the awning").toBe(1);
    expect(OCCLUDE.occPlayer.value.toArray(), "where the fade is aimed from").toEqual(under.toArray());
    expect(aimOccluders(true, new THREE.Vector3(2, 0, 6.5), camera, 1 / 16, Math.SQRT1_2 / 16, scene), "out in the street").toBe(0);
    // Behind the shop, it hides them whole.
    expect(aimOccluders(true, new THREE.Vector3(3, 0, -0.5), camera, 1 / 16, Math.SQRT1_2 / 16, scene), "behind it").toBe(1);
    expect(aimOccluders(false, under, camera, 1 / 16, Math.SQRT1_2 / 16, scene), "off indoors").toBe(0);
  });
});
