import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { tierMarker } from "./entities";

// The gem a wanderer carries over its head (design.md A3: every fight is the player's choice, its tier seen first).
describe("a wanderer's tier marker", () => {
  const figure = (height: number, scale = 1) => {
    const root = new THREE.Group();
    root.position.set(10, 0, 20);
    root.scale.setScalar(scale);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, height, 1).translate(0, height / 2, 0)));
    return root;
  };
  const world = (root: THREE.Object3D, gem: THREE.Object3D) => {
    root.add(gem);
    root.updateMatrixWorld(true);
    return gem.getWorldPosition(new THREE.Vector3());
  };

  it("is the tier's color of the map's legend", () => {
    const colors = [1, 2, 3, 4].map((t) => ((tierMarker(t, figure(1.5)) as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex());
    expect(colors).toEqual([0x1fbf62, 0xffc94a, 0xf58a3a, 0xe02a3a]);
  });

  it("floats a little over the figure's head, whatever the figure's size", () => {
    for (const [height, scale] of [[1.5, 1], [1, 3]] as const) {
      const root = figure(height, scale);
      const at = world(root, tierMarker(2, root));
      expect(at.x).toBeCloseTo(10, 6);
      expect(at.z).toBeCloseTo(20, 6);
      expect(at.y).toBeCloseTo(height * scale + 0.35, 6);
      // And the same size over a giant as over a goblin.
      const size = new THREE.Box3().setFromObject(root.children.at(-1)!).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(0.34, 4);
    }
  });
});
