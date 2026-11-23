import * as THREE from "three";

// A body in the overworld: a rig of blocky parts - legs, torso, arms, head - each a box, the way the voxel models
// (tech.md, B5) are cut. Gear hangs on a part's attachment point (head, torso, hands, feet), so what a character wears
// shows on them. Walking swings the limbs; a character stands still between steps.

export interface Look {
  readonly skin: string;
  readonly hair: string;
  readonly shirt: string;
  readonly trousers: string;
  readonly boots: string;
  /** How much bigger than a person: 1 for a person. */
  readonly size?: number;
}

export const SLOTS = ["head", "neck", "body", "hands", "feet", "ring1", "ring2", "relic"] as const;
export type Slot = (typeof SLOTS)[number];

const box = (w: number, h: number, d: number, color: string, y: number): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshToonMaterial({ color }));
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

export class Character {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: [THREE.Group, THREE.Group];
  private readonly arms: [THREE.Group, THREE.Group];
  private phase = 0;
  private walking = 0;

  constructor(
    readonly name: string,
    look: Look,
  ) {
    const s = look.size ?? 1;
    this.root.add(this.body);
    this.body.scale.setScalar(s);
    this.root.name = name;

    const limb = (x: number, top: number, length: number, width: number, color: string, foot?: string) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, top, 0);
      pivot.add(box(width, length, width, color, -length / 2));
      if (foot) {
        pivot.add(box(width + 0.02, 0.12, width + 0.08, foot, -length + 0.06));
      }
      this.body.add(pivot);
      return pivot;
    };

    this.legs = [limb(-0.11, 0.62, 0.62, 0.17, look.trousers, look.boots), limb(0.11, 0.62, 0.62, 0.17, look.trousers, look.boots)];
    this.body.add(box(0.44, 0.5, 0.26, look.shirt, 0.86));
    this.arms = [limb(-0.3, 1.08, 0.5, 0.13, look.shirt), limb(0.3, 1.08, 0.5, 0.13, look.shirt)];
    for (const arm of this.arms) {
      arm.add(box(0.12, 0.1, 0.12, look.skin, -0.52));
    }
    const head = box(0.3, 0.3, 0.3, look.skin, 1.28);
    head.add(box(0.32, 0.1, 0.32, look.hair, 0.14));
    this.body.add(head);
  }

  /** Turns to face a point on the ground. */
  face(x: number, z: number): void {
    const dx = x - this.root.position.x;
    const dz = z - this.root.position.z;
    if (dx * dx + dz * dz > 1e-6) {
      this.root.rotation.y = Math.atan2(dx, dz);
    }
  }

  /** Moves the limbs on: `moving` is whether the character walked this frame. */
  animate(seconds: number, moving: boolean): void {
    this.walking = THREE.MathUtils.damp(this.walking, moving ? 1 : 0, 12, seconds);
    this.phase += seconds * 9 * this.walking;
    const swing = Math.sin(this.phase) * 0.7 * this.walking;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.8;
    this.arms[1].rotation.x = swing * 0.8;
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * this.walking;
  }
}
