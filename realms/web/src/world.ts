import * as THREE from "three";
import { HEX_SIZE, type Hex, toWorld } from "./hex";
import { type GameMap, type Terrain, mulberry32 } from "./map";

// The three.js scene for a local map: a prism for every hex (one instanced mesh, so a map of a thousand hexes is one
// draw), the props that stand on hexes, the sun and the sky's fill light, and the marker under the hex the pointer is
// over. Colors are picked near the palette's, so little is lost when the post pass snaps them to it.

const SHADES: Record<Terrain, readonly string[]> = {
  grass: ["#4f7a34", "#5a8538", "#6b963e"],
  dirt: ["#8f6340", "#9a6c45", "#a9794e"],
  stone: ["#6b7080", "#7a7f8e", "#8c909c"],
  water: ["#2b5d80", "#2f6488"],
  sand: ["#d6ae7e", "#cfa676"],
};

/** The depth every hex prism reaches below the ground plane, so steps between heights show as cliffs. */
const BASE = 1.5;

export class World {
  readonly scene = new THREE.Scene();
  /** The hex prisms, for finding the hex under the pointer: instance i is `hexes[i]`. */
  readonly ground: THREE.InstancedMesh;
  readonly hexes: Hex[] = [];
  /** What can be clicked other than the ground, by object: its hex. */
  readonly props = new Map<THREE.Object3D, Hex>();
  private readonly marker: THREE.Mesh;

  constructor(readonly map: GameMap) {
    this.scene.background = new THREE.Color("#93c8dc");
    const tiles = [...map.all];
    const random = mulberry32(11);

    const prism = new THREE.CylinderGeometry(HEX_SIZE * 0.999, HEX_SIZE * 0.999, 1, 6, 1, false, Math.PI / 2);
    this.ground = new THREE.InstancedMesh(prism, new THREE.MeshToonMaterial({ color: "#ffffff" }), tiles.length);
    this.ground.receiveShadow = true;
    this.ground.castShadow = true;
    const matrix = new THREE.Matrix4();
    tiles.forEach((tile, i) => {
      const { x, z } = toWorld(tile.hex);
      const tall = tile.height + BASE;
      matrix.makeScale(1, tall, 1).setPosition(x, tile.height - tall / 2, z);
      this.ground.setMatrixAt(i, matrix);
      const shades = SHADES[tile.terrain];
      this.ground.setColorAt(i, new THREE.Color(shades[Math.floor(random() * shades.length)]!));
      this.hexes.push(tile.hex);

      if (tile.prop) {
        const prop = this.buildProp(tile.prop, random);
        prop.position.set(x, tile.height, z);
        this.scene.add(prop);
        prop.traverse((part) => this.props.set(part, tile.hex));
      }
    });
    this.scene.add(this.ground);

    const sun = new THREE.DirectionalLight("#fff2d6", 2.2);
    sun.position.set(-18, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const reach = 26;
    sun.shadow.camera.left = -reach;
    sun.shadow.camera.right = reach;
    sun.shadow.camera.top = reach;
    sun.shadow.camera.bottom = -reach;
    sun.shadow.camera.far = 80;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight("#c6e5ee", "#434c36", 1.1));

    const ring = new THREE.RingGeometry(HEX_SIZE * 0.78, HEX_SIZE * 0.95, 6, 1, Math.PI / 2);
    ring.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: "#f1b44c", side: THREE.DoubleSide }));
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  /** A hex's centre, standing on top of it. */
  surface(h: Hex): THREE.Vector3 {
    const { x, z } = toWorld(h);
    return new THREE.Vector3(x, this.map.heightAt(h), z);
  }

  /** Shows the marker on a hex, or hides it. */
  mark(h: Hex | null): void {
    this.marker.visible = h !== null;
    if (h) {
      this.marker.position.copy(this.surface(h)).add(new THREE.Vector3(0, 0.02, 0));
    }
  }

  /** The hex under a ray: a prop's, or the ground's. */
  pick(ray: THREE.Raycaster): { hex: Hex; prop: boolean } | null {
    const hits = ray.intersectObjects([this.ground, ...this.props.keys()], false);
    for (const hit of hits) {
      if (hit.object === this.ground && hit.instanceId !== undefined) {
        return { hex: this.hexes[hit.instanceId]!, prop: false };
      }
      const owner = this.props.get(hit.object);
      if (owner) {
        return { hex: owner, prop: true };
      }
    }
    return null;
  }

  private buildProp(kind: "tree" | "rock" | "spell-table", random: () => number): THREE.Group {
    const group = new THREE.Group();
    const add = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, glow = false) => {
      const material = glow ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshToonMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = !glow;
      mesh.receiveShadow = true;
      group.add(mesh);
    };

    switch (kind) {
      case "tree": {
        const tall = 0.9 + random() * 0.6;
        add(0.24, tall, 0.24, "#4a3122", 0, tall / 2, 0);
        const leaves = ["#2a4524", "#3a5f2c", "#4f7a34"];
        for (let i = 0; i < 4; i++) {
          const size = 0.7 + random() * 0.4;
          add(size, size * 0.8, size, leaves[i % leaves.length]!, (random() - 0.5) * 0.5, tall + 0.2 + i * 0.28, (random() - 0.5) * 0.5);
        }
        group.rotation.y = random() * Math.PI;
        break;
      }
      case "rock": {
        add(0.9, 0.5, 0.7, "#6b7080", 0, 0.25, 0);
        add(0.5, 0.35, 0.5, "#8c909c", 0.15, 0.6, -0.05);
        group.rotation.y = random() * Math.PI;
        break;
      }
      case "spell-table": {
        // A reading table with an open spellbook and a candle: where decks are built (design.md, A2).
        add(1.1, 0.1, 0.7, "#6b4630", 0, 0.62, 0);
        for (const [x, z] of [[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]] as const) {
          add(0.08, 0.6, 0.08, "#4a3122", x, 0.3, z);
        }
        add(0.42, 0.05, 0.3, "#f2efe6", -0.1, 0.7, 0);
        add(0.02, 0.06, 0.3, "#7a1f24", -0.1, 0.71, 0);
        add(0.06, 0.16, 0.06, "#f4ecc2", 0.35, 0.75, 0.1);
        add(0.04, 0.06, 0.04, "#f1b44c", 0.35, 0.86, 0.1, true);
        break;
      }
    }
    return group;
  }
}
