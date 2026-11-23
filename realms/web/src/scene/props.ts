import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PropKind } from "../maps/schema";

// Scenery built from boxes, the way the spike's trees and spell table were, in the palette's colors. A map's props are
// merged into one lit mesh and one glowing one (a town has hundreds of them), each box carrying its color as vertex
// colors, so the whole of a map's scenery is two draws.

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
      const mesh = new THREE.Mesh(mergeGeometries(this.lit), new THREE.MeshToonMaterial({ vertexColors: true }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (this.glowing.length > 0) {
      group.add(new THREE.Mesh(mergeGeometries(this.glowing), new THREE.MeshBasicMaterial({ vertexColors: true })));
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
  W: { leaves: ["#3a5f2c", "#4f7a34", "#6b963e"], stone: ["#b3b5bc", "#d8d6d0"], roof: "#7a1f24", wall: "#f2efe6", banner: "#f4ecc2" },
  U: { leaves: ["#2a4524", "#3a5f2c", "#3f80a3"], stone: ["#8c909c", "#b3b5bc"], roof: "#1d3f5c", wall: "#d8d6d0", banner: "#5b8fd6" },
  B: { leaves: ["#2c3326", "#434c36", "#4b2f5e"], stone: ["#3b3c4a", "#4f5363"], roof: "#2a2b36", wall: "#6b7080", banner: "#4b2f5e" },
  R: { leaves: ["#434c36", "#5d6646", "#9c6a1e"], stone: ["#4f5363", "#3b3c4a"], roof: "#c8432c", wall: "#8f6340", banner: "#c8432c" },
  G: { leaves: ["#1c2e1a", "#2a4524", "#3a5f2c"], stone: ["#6b7080", "#8c909c"], roof: "#4f7a34", wall: "#b5855a", banner: "#3e9a4a" },
  hub: { leaves: ["#3a5f2c", "#4f7a34", "#6b963e"], stone: ["#8c909c", "#b3b5bc"], roof: "#6b4630", wall: "#d8d6d0", banner: "#f1b44c" },
};

const pickOf = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

/** Adds one prop's boxes, standing on the point `boxes` was placed `at`. */
export function buildProp(b: Boxes, kind: PropKind, tint: PropTint, random: () => number): void {
  switch (kind) {
    case "tree": {
      const tall = 0.9 + random() * 0.6;
      b.box(0.24, tall, 0.24, "#4a3122", 0, tall / 2, 0);
      for (let i = 0; i < 4; i++) {
        const size = 0.7 + random() * 0.4;
        b.box(size, size * 0.8, size, tint.leaves[i % tint.leaves.length]!, (random() - 0.5) * 0.5, tall + 0.2 + i * 0.28, (random() - 0.5) * 0.5);
      }
      break;
    }
    case "pine": {
      const tall = 0.5 + random() * 0.3;
      b.box(0.2, tall, 0.2, "#4a3122", 0, tall / 2, 0);
      for (let i = 0; i < 4; i++) {
        const size = 1.0 - i * 0.22;
        b.box(size, 0.4, size, tint.leaves[0]!, 0, tall + 0.2 + i * 0.36, 0, { turn: i * 0.4 });
      }
      break;
    }
    case "dead-tree": {
      const tall = 1.0 + random() * 0.5;
      b.box(0.2, tall, 0.2, "#3b3c4a", 0, tall / 2, 0);
      b.box(0.5, 0.1, 0.1, "#3b3c4a", 0.2, tall * 0.7, 0, { tilt: 0.6 });
      b.box(0.4, 0.08, 0.08, "#3b3c4a", -0.16, tall * 0.85, 0.05, { tilt: -0.7, turn: 0.8 });
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
      for (let i = 0; i < 5; i++) b.box(0.06, 0.6 + random() * 0.3, 0.06, "#8fb350", (random() - 0.5) * 0.6, 0.35, (random() - 0.5) * 0.6);
      break;
    case "mushroom":
      b.box(0.14, 0.4, 0.14, "#f2efe6", 0, 0.2, 0);
      b.box(0.55, 0.18, 0.55, pickOf(random, ["#c8432c", "#a97fd0", "#e86a3a"]), 0, 0.46, 0);
      break;
    case "crystal":
      b.box(0.3, 1.0, 0.3, "#a97fd0", 0, 0.5, 0, { glow: true, tilt: 0.15 });
      b.box(0.22, 0.6, 0.22, "#93c8dc", 0.25, 0.3, 0.1, { glow: true, tilt: -0.3 });
      b.box(0.18, 0.5, 0.18, "#62a4c2", -0.2, 0.25, -0.12, { glow: true, tilt: 0.4 });
      break;
    case "house":
      b.box(1.5, 1.0, 1.5, tint.wall, 0, 0.5, 0);
      b.box(1.7, 0.35, 1.7, tint.roof, 0, 1.15, 0);
      b.box(1.2, 0.3, 1.2, tint.roof, 0, 1.45, 0);
      b.box(0.6, 0.25, 0.6, tint.roof, 0, 1.7, 0);
      b.box(0.3, 0.55, 0.05, "#4a3122", 0, 0.28, 0.76);
      b.box(0.24, 0.2, 0.05, "#f1b44c", 0.45, 0.6, 0.76, { glow: true });
      break;
    case "tower":
      b.box(1.2, 2.4, 1.2, tint.stone[1]!, 0, 1.2, 0);
      for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const) b.box(0.3, 0.3, 0.3, tint.stone[0]!, x, 2.55, z);
      b.box(0.2, 0.3, 0.05, "#1a1c24", 0, 1.8, 0.61);
      break;
    case "wall":
      b.box(1.7, 1.1, 0.7, tint.stone[0]!, 0, 0.55, 0);
      b.box(0.4, 0.25, 0.72, tint.stone[1]!, -0.55, 1.22, 0);
      b.box(0.4, 0.25, 0.72, tint.stone[1]!, 0.55, 1.22, 0);
      break;
    case "fence":
      for (const x of [-0.6, 0, 0.6]) b.box(0.1, 0.5, 0.1, "#6b4630", x, 0.25, 0);
      b.box(1.4, 0.08, 0.06, "#8f6340", 0, 0.35, 0);
      break;
    case "well":
      b.box(1.0, 0.5, 1.0, tint.stone[0]!, 0, 0.25, 0);
      b.box(0.7, 0.05, 0.7, "#1d3f5c", 0, 0.5, 0);
      b.box(0.08, 0.8, 0.08, "#4a3122", -0.45, 0.9, 0);
      b.box(0.08, 0.8, 0.08, "#4a3122", 0.45, 0.9, 0);
      b.box(1.1, 0.25, 0.5, tint.roof, 0, 1.35, 0);
      break;
    case "fountain":
      b.box(1.7, 0.35, 1.7, tint.stone[1]!, 0, 0.18, 0);
      b.box(1.4, 0.05, 1.4, "#3f80a3", 0, 0.36, 0);
      b.box(0.35, 0.9, 0.35, tint.stone[0]!, 0, 0.6, 0);
      b.box(0.7, 0.12, 0.7, tint.stone[1]!, 0, 1.05, 0);
      b.box(0.18, 0.3, 0.18, "#93c8dc", 0, 1.25, 0, { glow: true });
      break;
    case "statue":
      b.box(1.0, 0.5, 1.0, tint.stone[0]!, 0, 0.25, 0);
      b.box(0.4, 0.8, 0.3, tint.stone[1]!, 0, 0.9, 0);
      b.box(0.25, 0.25, 0.25, tint.stone[1]!, 0, 1.45, 0);
      b.box(0.7, 0.12, 0.12, tint.stone[1]!, 0, 1.2, 0);
      b.box(0.06, 0.9, 0.06, "#9c6a1e", 0.32, 1.3, 0);
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
      b.box(0.15, 0.6, 0.15, "#2a2b36", 0, 0.3, 0);
      b.box(0.5, 0.15, 0.5, "#3b3c4a", 0, 0.65, 0);
      b.box(0.3, 0.25, 0.3, "#e86a3a", 0, 0.82, 0, { glow: true });
      b.box(0.15, 0.2, 0.15, "#f1b44c", 0, 1.0, 0, { glow: true });
      break;
    case "banner":
      b.box(0.08, 1.8, 0.08, "#4a3122", 0, 0.9, 0);
      b.box(0.5, 0.8, 0.04, tint.banner, 0.28, 1.35, 0);
      b.box(0.5, 0.1, 0.05, "#f1b44c", 0.28, 1.72, 0);
      break;
    case "crate":
      b.box(0.6, 0.6, 0.6, "#8f6340", 0, 0.3, 0, { turn: random() });
      break;
    case "barrel":
      b.box(0.5, 0.7, 0.5, "#6b4630", 0, 0.35, 0);
      b.box(0.54, 0.06, 0.54, "#2a2b36", 0, 0.55, 0);
      b.box(0.54, 0.06, 0.54, "#2a2b36", 0, 0.15, 0);
      break;
    case "bones":
      b.box(0.5, 0.06, 0.08, "#f2efe6", 0, 0.03, 0, { turn: random() * 3 });
      b.box(0.4, 0.06, 0.08, "#d8d6d0", 0.1, 0.03, 0.15, { turn: random() * 3 });
      b.box(0.18, 0.16, 0.18, "#f2efe6", -0.2, 0.08, -0.1);
      break;
    case "tent":
      b.box(1.4, 0.7, 1.2, tint.banner, 0, 0.35, 0);
      b.box(1.0, 0.4, 1.25, tint.banner, 0, 0.9, 0);
      b.box(0.4, 0.2, 1.26, tint.banner, 0, 1.2, 0);
      b.box(0.3, 0.5, 0.05, "#2a2b36", 0, 0.25, 0.61);
      break;
    case "stall":
      for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]] as const) b.box(0.08, 1.2, 0.08, "#4a3122", x, 0.6, z);
      b.box(1.4, 0.1, 1.0, tint.banner, 0, 1.25, 0);
      b.box(1.3, 0.5, 0.4, "#8f6340", 0, 0.25, 0.3);
      b.box(0.3, 0.12, 0.3, "#f1b44c", -0.3, 0.56, 0.3);
      b.box(0.3, 0.12, 0.3, "#5b8fd6", 0.2, 0.56, 0.3);
      break;
    case "anvil":
      b.box(0.3, 0.4, 0.3, "#3b3c4a", 0, 0.2, 0);
      b.box(0.7, 0.2, 0.3, "#4f5363", 0, 0.5, 0);
      b.box(0.3, 0.3, 0.3, "#c8432c", 0.6, 0.15, 0.2, { glow: true });
      break;
    case "altar":
      b.box(1.2, 0.6, 0.7, tint.stone[1]!, 0, 0.3, 0);
      b.box(0.2, 0.2, 0.2, "#a97fd0", 0, 0.75, 0, { glow: true });
      break;
    case "coffin":
      b.box(0.5, 0.3, 1.2, "#2e1f17", 0, 0.15, 0, { turn: random() });
      break;
    case "throne":
      b.box(1.0, 0.5, 0.9, tint.stone[0]!, 0, 0.25, 0);
      b.box(1.0, 1.6, 0.25, tint.stone[1]!, 0, 1.0, -0.35);
      b.box(0.3, 0.3, 0.1, "#f1b44c", 0, 1.75, -0.2, { glow: true });
      break;
    case "portal":
      b.box(0.25, 2.0, 0.25, "#3b3c4a", -0.7, 1.0, 0);
      b.box(0.25, 2.0, 0.25, "#3b3c4a", 0.7, 1.0, 0);
      b.box(1.65, 0.25, 0.25, "#3b3c4a", 0, 2.1, 0);
      b.box(1.15, 1.8, 0.08, "#a97fd0", 0, 1.0, 0, { glow: true });
      break;
    case "stairs-down":
      b.box(1.2, 0.04, 1.2, "#0d0f14", 0, 0.01, 0);
      for (let i = 0; i < 3; i++) b.box(1.0, 0.05, 0.25, "#4f5363", 0, -0.08 - i * 0.12, -0.3 + i * 0.3);
      break;
    case "stairs-up":
      for (let i = 0; i < 4; i++) b.box(1.0, 0.15 + i * 0.15, 0.25, tint.stone[1]!, 0, (0.15 + i * 0.15) / 2, 0.4 - i * 0.27);
      break;
    case "signpost":
      b.box(0.1, 1.2, 0.1, "#4a3122", 0, 0.6, 0);
      b.box(0.7, 0.18, 0.05, "#8f6340", 0.22, 1.0, 0, { turn: 0.3 });
      b.box(0.6, 0.16, 0.05, "#8f6340", -0.18, 0.75, 0, { turn: -0.5 });
      break;
  }
}

/** The fixtures of the people and things a map's NPC kinds stand at: the spell table, the quest board, the arena. */
export function buildFixture(b: Boxes, kind: "spell-table" | "quest-board" | "arena" | "chest" | "chest-open"): void {
  switch (kind) {
    case "spell-table":
      // A reading table with an open spellbook and a candle: where decks are built (design.md, A2).
      b.box(1.1, 0.1, 0.7, "#6b4630", 0, 0.62, 0);
      for (const [x, z] of [[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]] as const) b.box(0.08, 0.6, 0.08, "#4a3122", x, 0.3, z);
      b.box(0.42, 0.05, 0.3, "#f2efe6", -0.1, 0.7, 0);
      b.box(0.02, 0.06, 0.3, "#7a1f24", -0.1, 0.71, 0);
      b.box(0.06, 0.16, 0.06, "#f4ecc2", 0.35, 0.75, 0.1);
      b.box(0.04, 0.06, 0.04, "#f1b44c", 0.35, 0.86, 0.1, { glow: true });
      break;
    case "quest-board":
      b.box(0.1, 1.5, 0.1, "#4a3122", -0.5, 0.75, 0);
      b.box(0.1, 1.5, 0.1, "#4a3122", 0.5, 0.75, 0);
      b.box(1.2, 0.8, 0.08, "#8f6340", 0, 1.05, 0);
      b.box(0.3, 0.35, 0.02, "#f2efe6", -0.3, 1.1, 0.05);
      b.box(0.25, 0.3, 0.02, "#f4ecc2", 0.1, 1.0, 0.05);
      b.box(0.2, 0.25, 0.02, "#f2efe6", 0.38, 1.15, 0.05);
      b.box(1.3, 0.12, 0.2, "#6b4630", 0, 1.5, 0);
      break;
    case "arena":
      b.box(0.4, 2.2, 0.4, "#6b7080", -0.8, 1.1, 0);
      b.box(0.4, 2.2, 0.4, "#6b7080", 0.8, 1.1, 0);
      b.box(2.2, 0.4, 0.5, "#8c909c", 0, 2.3, 0);
      b.box(1.2, 1.6, 0.1, "#4a3122", 0, 0.8, 0);
      b.box(0.8, 0.35, 0.05, "#f1b44c", 0, 1.2, 0.08);
      break;
    case "chest":
      b.box(0.8, 0.45, 0.55, "#6b4630", 0, 0.23, 0);
      b.box(0.82, 0.18, 0.57, "#8f6340", 0, 0.54, 0);
      b.box(0.84, 0.06, 0.08, "#f1b44c", 0, 0.4, 0);
      b.box(0.12, 0.14, 0.04, "#f1b44c", 0, 0.42, 0.29, { glow: true });
      break;
    case "chest-open":
      b.box(0.8, 0.45, 0.55, "#6b4630", 0, 0.23, 0);
      b.box(0.82, 0.57, 0.12, "#8f6340", 0, 0.75, -0.3);
      b.box(0.7, 0.05, 0.45, "#2e1f17", 0, 0.44, 0);
      break;
  }
}
