import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { celMaterial } from "../look";
import type { PropKind } from "../world/schema";

// Scenery built from boxes, the way the spike's trees and spell table were, in the palette's colors (palette.ts). A
// map's props are merged into one lit mesh and one glowing one (a town has hundreds of them), each box carrying its
// color as vertex colors, so the whole of a map's scenery is two draws. Scenery is outlined, as characters are; the
// ground is not (look.ts).

// One outlined cel material for all lit scenery, one unlit for its glows: the colors are in the vertices.
const LIT = celMaterial({ vertexColors: true, outlined: true });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Collects colored boxes, then merges them into one geometry. */
export class Boxes {
  private readonly lit: THREE.BufferGeometry[] = [];
  private readonly glowing: THREE.BufferGeometry[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly base = new THREE.Matrix4();

  /** Where the next boxes go: a prop's hex, turned. */
  at(x: number, y: number, z: number, turn = 0): this {
    this.base.makeRotationY(turn).setPosition(x, y, z);
    return this;
  }

  box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, options: { glow?: boolean; turn?: number; tilt?: number } = {}): this {
    const geometry = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    this.matrix.makeRotationY(options.turn ?? 0);
    if (options.tilt) this.matrix.multiply(new THREE.Matrix4().makeRotationZ(options.tilt));
    this.matrix.setPosition(x, y, z);
    geometry.applyMatrix4(this.matrix);
    geometry.applyMatrix4(this.base);
    const c = new THREE.Color(color);
    const colors = new Float32Array(geometry.attributes.position!.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.deleteAttribute("uv");
    (options.glow ? this.glowing : this.lit).push(geometry);
    return this;
  }

  get empty(): boolean {
    return this.lit.length + this.glowing.length === 0;
  }

  /** The merged meshes: lit (casting shadows) and glowing (unlit). */
  build(): THREE.Group {
    const group = new THREE.Group();
    if (this.lit.length > 0) {
      const mesh = new THREE.Mesh(mergeGeometries(this.lit), LIT);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (this.glowing.length > 0) {
      group.add(new THREE.Mesh(mergeGeometries(this.glowing), GLOW));
    }
    for (const g of [...this.lit, ...this.glowing]) g.dispose();
    this.lit.length = 0;
    this.glowing.length = 0;
    return group;
  }
}

/** The tints a region gives its scenery: Urborg's trees are dead and grey, Shiv's stone is dark. */
export interface PropTint {
  readonly leaves: readonly string[];
  readonly stone: readonly string[];
  readonly roof: string;
  readonly wall: string;
  readonly banner: string;
}

export const TINTS: Record<string, PropTint> = {
  W: { leaves: ["#285a3a", "#285a3a", "#3b7a45"], stone: ["#979cab", "#bcbfc9"], roof: "#85382c", wall: "#e0e0e3", banner: "#fff8de" },
  U: { leaves: ["#1a3d2c", "#285a3a", "#285a3a"], stone: ["#757b8c", "#979cab"], roof: "#22557c", wall: "#bcbfc9", banner: "#3f62e8" },
  B: { leaves: ["#39422c", "#39422c", "#525d3c"], stone: ["#3e4252", "#575c6e"], roof: "#2e3140", wall: "#757b8c", banner: "#7a32b0" },
  R: { leaves: ["#525d3c", "#525d3c", "#a8681a"], stone: ["#575c6e", "#3e4252"], roof: "#ad5238", wall: "#9a663c", banner: "#e02a3a" },
  G: { leaves: ["#1a3d2c", "#285a3a", "#285a3a"], stone: ["#757b8c", "#979cab"], roof: "#43722c", wall: "#c08b55", banner: "#1fbf62" },
  hub: { leaves: ["#285a3a", "#285a3a", "#3b7a45"], stone: ["#979cab", "#bcbfc9"], roof: "#85382c", wall: "#e0e0e3", banner: "#ffc94a" },
};

const pickOf = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

/** Adds one prop's boxes, standing on the point `boxes` was placed `at`. */
export function buildProp(b: Boxes, kind: PropKind, tint: PropTint, random: () => number): void {
  switch (kind) {
    case "tree": {
      const tall = 0.9 + random() * 0.6;
      b.box(0.24, tall, 0.24, "#4d2f1f", 0, tall / 2, 0);
      for (let i = 0; i < 4; i++) {
        const size = 0.7 + random() * 0.4;
        b.box(size, size * 0.8, size, tint.leaves[i % tint.leaves.length]!, (random() - 0.5) * 0.5, tall + 0.2 + i * 0.28, (random() - 0.5) * 0.5);
      }
      break;
    }
    case "pine": {
      const tall = 0.5 + random() * 0.3;
      b.box(0.2, tall, 0.2, "#4d2f1f", 0, tall / 2, 0);
      for (let i = 0; i < 4; i++) {
        const size = 1.0 - i * 0.22;
        b.box(size, 0.4, size, tint.leaves[0]!, 0, tall + 0.2 + i * 0.36, 0, { turn: i * 0.4 });
      }
      break;
    }
    case "dead-tree": {
      const tall = 1.0 + random() * 0.5;
      b.box(0.2, tall, 0.2, "#3e4252", 0, tall / 2, 0);
      b.box(0.5, 0.1, 0.1, "#3e4252", 0.2, tall * 0.7, 0, { tilt: 0.6 });
      b.box(0.4, 0.08, 0.08, "#3e4252", -0.16, tall * 0.85, 0.05, { tilt: -0.7, turn: 0.8 });
      break;
    }
    case "bush":
      b.box(0.7, 0.45, 0.7, tint.leaves[1]!, 0, 0.22, 0);
      b.box(0.45, 0.3, 0.45, tint.leaves[2]!, 0.1, 0.5, -0.05);
      break;
    case "rock":
      b.box(0.9, 0.5, 0.7, tint.stone[0]!, 0, 0.25, 0);
      b.box(0.5, 0.35, 0.5, tint.stone[1]!, 0.15, 0.6, -0.05);
      break;
    case "boulder":
      b.box(1.3, 0.9, 1.1, tint.stone[0]!, 0, 0.45, 0);
      b.box(0.8, 0.5, 0.8, tint.stone[1]!, -0.1, 1.1, 0.1);
      break;
    case "reeds":
      for (let i = 0; i < 5; i++) b.box(0.06, 0.6 + random() * 0.3, 0.06, "#80ad42", (random() - 0.5) * 0.6, 0.35, (random() - 0.5) * 0.6);
      break;
    case "mushroom":
      b.box(0.14, 0.4, 0.14, "#f2f7f8", 0, 0.2, 0);
      b.box(0.55, 0.18, 0.55, pickOf(random, ["#ad5238", "#8e82c8", "#f58a3a"]), 0, 0.46, 0);
      break;
    case "crystal":
      b.box(0.3, 1.0, 0.3, "#c4bcef", 0, 0.5, 0, { glow: true, tilt: 0.15 });
      b.box(0.22, 0.6, 0.22, "#84bfd3", 0.25, 0.3, 0.1, { glow: true, tilt: -0.3 });
      b.box(0.18, 0.5, 0.18, "#5296b5", -0.2, 0.25, -0.12, { glow: true, tilt: 0.4 });
      break;
    case "house":
      b.box(1.5, 1.0, 1.5, tint.wall, 0, 0.5, 0);
      b.box(1.7, 0.35, 1.7, tint.roof, 0, 1.15, 0);
      b.box(1.2, 0.3, 1.2, tint.roof, 0, 1.45, 0);
      b.box(0.6, 0.25, 0.6, tint.roof, 0, 1.7, 0);
      b.box(0.3, 0.55, 0.05, "#4d2f1f", 0, 0.28, 0.76);
      b.box(0.24, 0.2, 0.05, "#ffc94a", 0.45, 0.6, 0.76, { glow: true });
      break;
    case "tower":
      b.box(1.2, 2.4, 1.2, tint.stone[1]!, 0, 1.2, 0);
      for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const) b.box(0.3, 0.3, 0.3, tint.stone[0]!, x, 2.55, z);
      b.box(0.2, 0.3, 0.05, "#1b1d26", 0, 1.8, 0.61);
      break;
    case "wall":
      b.box(1.7, 1.1, 0.7, tint.stone[0]!, 0, 0.55, 0);
      b.box(0.4, 0.25, 0.72, tint.stone[1]!, -0.55, 1.22, 0);
      b.box(0.4, 0.25, 0.72, tint.stone[1]!, 0.55, 1.22, 0);
      break;
    case "fence":
      for (const x of [-0.6, 0, 0.6]) b.box(0.1, 0.5, 0.1, "#73472b", x, 0.25, 0);
      b.box(1.4, 0.08, 0.06, "#9a663c", 0, 0.35, 0);
      break;
    case "well":
      b.box(1.0, 0.5, 1.0, tint.stone[0]!, 0, 0.25, 0);
      b.box(0.7, 0.05, 0.7, "#173a5c", 0, 0.5, 0);
      b.box(0.08, 0.8, 0.08, "#4d2f1f", -0.45, 0.9, 0);
      b.box(0.08, 0.8, 0.08, "#4d2f1f", 0.45, 0.9, 0);
      b.box(1.1, 0.25, 0.5, tint.roof, 0, 1.35, 0);
      break;
    case "fountain":
      b.box(1.7, 0.35, 1.7, tint.stone[1]!, 0, 0.18, 0);
      b.box(1.4, 0.05, 1.4, "#33739a", 0, 0.36, 0);
      b.box(0.35, 0.9, 0.35, tint.stone[0]!, 0, 0.6, 0);
      b.box(0.7, 0.12, 0.7, tint.stone[1]!, 0, 1.05, 0);
      b.box(0.18, 0.3, 0.18, "#84bfd3", 0, 1.25, 0, { glow: true });
      break;
    case "statue":
      b.box(1.0, 0.5, 1.0, tint.stone[0]!, 0, 0.25, 0);
      b.box(0.4, 0.8, 0.3, tint.stone[1]!, 0, 0.9, 0);
      b.box(0.25, 0.25, 0.25, tint.stone[1]!, 0, 1.45, 0);
      b.box(0.7, 0.12, 0.12, tint.stone[1]!, 0, 1.2, 0);
      b.box(0.06, 0.9, 0.06, "#a8681a", 0.32, 1.3, 0);
      break;
    case "pillar":
      b.box(0.6, 0.15, 0.6, tint.stone[0]!, 0, 0.08, 0);
      b.box(0.4, 1.6, 0.4, tint.stone[1]!, 0, 0.9, 0);
      b.box(0.6, 0.15, 0.6, tint.stone[0]!, 0, 1.75, 0);
      break;
    case "ruin":
      b.box(1.0, 0.7, 0.5, tint.stone[0]!, 0, 0.35, 0, { turn: random() });
      b.box(0.5, 0.4, 0.5, tint.stone[1]!, 0.3, 0.9, 0.0, { turn: random() });
      b.box(0.4, 0.2, 0.4, tint.stone[0]!, -0.4, 0.1, 0.4);
      break;
    case "brazier":
      b.box(0.15, 0.6, 0.15, "#2e3140", 0, 0.3, 0);
      b.box(0.5, 0.15, 0.5, "#3e4252", 0, 0.65, 0);
      b.box(0.3, 0.25, 0.3, "#f58a3a", 0, 0.82, 0, { glow: true });
      b.box(0.15, 0.2, 0.15, "#ffc94a", 0, 1.0, 0, { glow: true });
      break;
    case "banner":
      b.box(0.08, 1.8, 0.08, "#4d2f1f", 0, 0.9, 0);
      b.box(0.5, 0.8, 0.04, tint.banner, 0.28, 1.35, 0);
      b.box(0.5, 0.1, 0.05, "#ffc94a", 0.28, 1.72, 0);
      break;
    case "crate":
      b.box(0.6, 0.6, 0.6, "#9a663c", 0, 0.3, 0, { turn: random() });
      break;
    case "barrel":
      b.box(0.5, 0.7, 0.5, "#73472b", 0, 0.35, 0);
      b.box(0.54, 0.06, 0.54, "#2e3140", 0, 0.55, 0);
      b.box(0.54, 0.06, 0.54, "#2e3140", 0, 0.15, 0);
      break;
    case "bones":
      b.box(0.5, 0.06, 0.08, "#f2f7f8", 0, 0.03, 0, { turn: random() * 3 });
      b.box(0.4, 0.06, 0.08, "#e0e0e3", 0.1, 0.03, 0.15, { turn: random() * 3 });
      b.box(0.18, 0.16, 0.18, "#f2f7f8", -0.2, 0.08, -0.1);
      break;
    case "tent":
      b.box(1.4, 0.7, 1.2, tint.banner, 0, 0.35, 0);
      b.box(1.0, 0.4, 1.25, tint.banner, 0, 0.9, 0);
      b.box(0.4, 0.2, 1.26, tint.banner, 0, 1.2, 0);
      b.box(0.3, 0.5, 0.05, "#2e3140", 0, 0.25, 0.61);
      break;
    case "stall":
      for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]] as const) b.box(0.08, 1.2, 0.08, "#4d2f1f", x, 0.6, z);
      b.box(1.4, 0.1, 1.0, tint.banner, 0, 1.25, 0);
      b.box(1.3, 0.5, 0.4, "#9a663c", 0, 0.25, 0.3);
      b.box(0.3, 0.12, 0.3, "#ffc94a", -0.3, 0.56, 0.3);
      b.box(0.3, 0.12, 0.3, "#3f62e8", 0.2, 0.56, 0.3);
      break;
    case "anvil":
      b.box(0.3, 0.4, 0.3, "#3e4252", 0, 0.2, 0);
      b.box(0.7, 0.2, 0.3, "#575c6e", 0, 0.5, 0);
      b.box(0.3, 0.3, 0.3, "#ad5238", 0.6, 0.15, 0.2, { glow: true });
      break;
    case "altar":
      b.box(1.2, 0.6, 0.7, tint.stone[1]!, 0, 0.3, 0);
      b.box(0.2, 0.2, 0.2, "#c4bcef", 0, 0.75, 0, { glow: true });
      break;
    case "coffin":
      b.box(0.5, 0.3, 1.2, "#2e1c14", 0, 0.15, 0, { turn: random() });
      break;
    case "throne":
      b.box(1.0, 0.5, 0.9, tint.stone[0]!, 0, 0.25, 0);
      b.box(1.0, 1.6, 0.25, tint.stone[1]!, 0, 1.0, -0.35);
      b.box(0.3, 0.3, 0.1, "#ffc94a", 0, 1.75, -0.2, { glow: true });
      break;
    case "portal":
      b.box(0.25, 2.0, 0.25, "#3e4252", -0.7, 1.0, 0);
      b.box(0.25, 2.0, 0.25, "#3e4252", 0.7, 1.0, 0);
      b.box(1.65, 0.25, 0.25, "#3e4252", 0, 2.1, 0);
      b.box(1.15, 1.8, 0.08, "#8e82c8", 0, 1.0, 0, { glow: true });
      break;
    case "stairs-down":
      b.box(1.2, 0.04, 1.2, "#0b0c10", 0, 0.01, 0);
      for (let i = 0; i < 3; i++) b.box(1.0, 0.05, 0.25, "#575c6e", 0, -0.08 - i * 0.12, -0.3 + i * 0.3);
      break;
    case "stairs-up":
      for (let i = 0; i < 4; i++) b.box(1.0, 0.15 + i * 0.15, 0.25, tint.stone[1]!, 0, (0.15 + i * 0.15) / 2, 0.4 - i * 0.27);
      break;
    case "signpost":
      b.box(0.1, 1.2, 0.1, "#4d2f1f", 0, 0.6, 0);
      b.box(0.7, 0.18, 0.05, "#9a663c", 0.22, 1.0, 0, { turn: 0.3 });
      b.box(0.6, 0.16, 0.05, "#9a663c", -0.18, 0.75, 0, { turn: -0.5 });
      break;
  }
}

/** The fixtures of the people and things a map's NPC kinds stand at: the spell table, the quest board, the arena. */
export function buildFixture(b: Boxes, kind: "spell-table" | "quest-board" | "arena" | "chest" | "chest-open"): void {
  switch (kind) {
    case "spell-table":
      // A reading table with an open spellbook and a candle: where decks are built (design.md, A2).
      b.box(1.1, 0.1, 0.7, "#73472b", 0, 0.62, 0);
      for (const [x, z] of [[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]] as const) b.box(0.08, 0.6, 0.08, "#4d2f1f", x, 0.3, z);
      b.box(0.42, 0.05, 0.3, "#f2f7f8", -0.1, 0.7, 0);
      b.box(0.02, 0.06, 0.3, "#85382c", -0.1, 0.71, 0);
      b.box(0.06, 0.16, 0.06, "#fff8de", 0.35, 0.75, 0.1);
      b.box(0.04, 0.06, 0.04, "#ffc94a", 0.35, 0.86, 0.1, { glow: true });
      break;
    case "quest-board":
      b.box(0.1, 1.5, 0.1, "#4d2f1f", -0.5, 0.75, 0);
      b.box(0.1, 1.5, 0.1, "#4d2f1f", 0.5, 0.75, 0);
      b.box(1.2, 0.8, 0.08, "#9a663c", 0, 1.05, 0);
      b.box(0.3, 0.35, 0.02, "#f2f7f8", -0.3, 1.1, 0.05);
      b.box(0.25, 0.3, 0.02, "#fff8de", 0.1, 1.0, 0.05);
      b.box(0.2, 0.25, 0.02, "#f2f7f8", 0.38, 1.15, 0.05);
      b.box(1.3, 0.12, 0.2, "#73472b", 0, 1.5, 0);
      break;
    case "arena":
      b.box(0.4, 2.2, 0.4, "#757b8c", -0.8, 1.1, 0);
      b.box(0.4, 2.2, 0.4, "#757b8c", 0.8, 1.1, 0);
      b.box(2.2, 0.4, 0.5, "#979cab", 0, 2.3, 0);
      b.box(1.2, 1.6, 0.1, "#4d2f1f", 0, 0.8, 0);
      b.box(0.8, 0.35, 0.05, "#ffc94a", 0, 1.2, 0.08);
      break;
    case "chest":
      b.box(0.8, 0.45, 0.55, "#73472b", 0, 0.23, 0);
      b.box(0.82, 0.18, 0.57, "#9a663c", 0, 0.54, 0);
      b.box(0.84, 0.06, 0.08, "#ffc94a", 0, 0.4, 0);
      b.box(0.12, 0.14, 0.04, "#ffc94a", 0, 0.42, 0.29, { glow: true });
      break;
    case "chest-open":
      b.box(0.8, 0.45, 0.55, "#73472b", 0, 0.23, 0);
      b.box(0.82, 0.57, 0.12, "#9a663c", 0, 0.75, -0.3);
      b.box(0.7, 0.05, 0.45, "#2e1c14", 0, 0.44, 0);
      break;
  }
}
