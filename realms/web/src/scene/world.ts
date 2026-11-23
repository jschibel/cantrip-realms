import * as THREE from "three";
import { BODIES, type Body, Character, type ManaColor } from "../character";
import { HEX_SIZE, type Hex, fromWorld, key, toWorld } from "../hex";
import type { GameMap } from "../maps/gameMap";
import type { NpcData, Terrain } from "../maps/schema";
import { fnv1a32, mulberry32 } from "../random";
import { Boxes, TINTS, buildFixture, buildProp } from "./props";

// The three.js scene for a local map: a prism for every hex (one instanced mesh, so a map of a thousand hexes is one
// draw), the scenery merged into two meshes, the people of the map standing at their places, chests, the glowing
// ways out, the sun and the sky's fill light (or a dungeon's gloom and its braziers), and the marker under the hex
// the pointer is over. Colors are picked near the palette's, so little is lost when the post pass snaps them to it.

const SHADES: Record<Terrain, readonly string[]> = {
  grass: ["#4f7a34", "#5a8538", "#6b963e"],
  meadow: ["#6b963e", "#8fb350", "#6b963e"],
  dirt: ["#8f6340", "#9a6c45", "#a9794e"],
  road: ["#b5855a", "#a9794e"],
  cobble: ["#8c909c", "#7a7f8e", "#b3b5bc"],
  stone: ["#6b7080", "#7a7f8e", "#8c909c"],
  rock: ["#4f5363", "#3b3c4a", "#5a5e6e"],
  sand: ["#d6ae7e", "#cfa676"],
  water: ["#2b5d80", "#2f6488"],
  "deep-water": ["#1d3f5c", "#12263a"],
  swamp: ["#434c36", "#2c3326", "#5d6646"],
  mud: ["#4a3122", "#6b4630", "#5a3528"],
  moss: ["#3a5f2c", "#434c36", "#5d6646"],
  snow: ["#f2efe6", "#d8d6d0"],
  ice: ["#c6e5ee", "#93c8dc"],
  ash: ["#3b3c4a", "#4f5363", "#2a2b36"],
  lava: ["#e86a3a", "#c8432c", "#f1b44c"],
  floor: ["#6b7080", "#4f5363"],
  wood: ["#8f6340", "#6b4630"],
  marble: ["#d8d6d0", "#f2efe6", "#b3b5bc"],
  crystal: ["#a97fd0", "#62a4c2", "#93c8dc"],
  forest: ["#2a4524", "#3a5f2c"],
  hills: ["#6b963e", "#8f6340"],
  mountain: ["#6b7080", "#8c909c"],
};

/** A terrain's main color, for the minimap and the world map. */
export const terrainColor = (terrain: Terrain): string => SHADES[terrain][0]!;

/** Terrain that lights itself. */
const GLOWS: ReadonlySet<Terrain> = new Set(["lava"]);

/** The depth every hex prism reaches below the ground plane, so steps between heights show as cliffs. */
const BASE = 1.5;

const SKIES: Record<string, string> = { W: "#93c8dc", U: "#62a4c2", B: "#5d6646", R: "#b5855a", G: "#8fb350", hub: "#93c8dc" };

/** Someone standing at their place in the map: an innkeeper, a vendor, an armorer, a townsperson. */
export interface Resident {
  readonly npc: NpcData;
  readonly character: Character;
}

export class World {
  readonly scene = new THREE.Scene();
  /** The hex prisms, for finding the hex under the pointer: instance i is `hexes[i]`. */
  private readonly grounds: { mesh: THREE.InstancedMesh; hexes: Hex[] }[] = [];
  /** What can be clicked other than the ground, by object: its hex. */
  private readonly clickable = new Map<THREE.Object3D, Hex>();
  private readonly chests = new Map<string, { group: THREE.Group; hex: Hex; open: boolean }>();
  readonly residents: Resident[] = [];
  private readonly exitMarks: THREE.Object3D[] = [];
  private readonly marker: THREE.Mesh;
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private time = 0;

  constructor(readonly map: GameMap) {
    const dungeon = map.kind === "dungeon";
    const tint = TINTS[map.region ?? "hub"]!;
    this.scene.background = new THREE.Color(dungeon ? "#0d0f14" : SKIES[map.region ?? "hub"]!);
    const random = mulberry32(fnv1a32(map.id));

    // Ground: one instanced mesh of lit prisms, one of glowing ones.
    const tiles = [...map.all];
    const prism = new THREE.CylinderGeometry(HEX_SIZE * 0.999, HEX_SIZE * 0.999, 1, 6, 1, false, Math.PI / 2);
    const lit = tiles.filter((t) => !GLOWS.has(t.terrain));
    const glowing = tiles.filter((t) => GLOWS.has(t.terrain));
    const matrix = new THREE.Matrix4();
    for (const [group, material] of [
      [lit, new THREE.MeshToonMaterial({ color: "#ffffff" })],
      [glowing, new THREE.MeshBasicMaterial({ color: "#ffffff" })],
    ] as const) {
      if (group.length === 0) continue;
      const mesh = new THREE.InstancedMesh(prism, material, group.length);
      mesh.receiveShadow = true;
      mesh.castShadow = material instanceof THREE.MeshToonMaterial;
      const hexes: Hex[] = [];
      group.forEach((tile, i) => {
        const { x, z } = toWorld(tile.hex);
        const tall = tile.height + BASE;
        matrix.makeScale(1, tall, 1).setPosition(x, tile.height - tall / 2, z);
        mesh.setMatrixAt(i, matrix);
        const shades = SHADES[tile.terrain];
        mesh.setColorAt(i, new THREE.Color(shades[Math.floor(random() * shades.length)]!));
        hexes.push(tile.hex);
      });
      this.grounds.push({ mesh, hexes });
      this.scene.add(mesh);
    }

    // Scenery, merged, and clickable through the hex it stands on.
    const boxes = new Boxes();
    for (const tile of tiles) {
      if (!tile.prop) continue;
      const { x, z } = toWorld(tile.hex);
      boxes.at(x, tile.height, z, tile.prop === "house" || tile.prop === "wall" || tile.prop === "tower" ? 0 : random() * Math.PI);
      buildProp(boxes, tile.prop, tint, random);
    }
    if (!boxes.empty) {
      const scenery = boxes.build();
      this.scene.add(scenery);
      scenery.traverse((o) => this.clickable.set(o, { q: NaN, r: NaN }));
    }

    // The people and their fixtures, and an unseen column over each person and chest that clicks catch, however
    // thin the thing drawn there is from where the camera looks.
    for (const npc of map.data.npcs) this.placeNpc(npc, random);
    const column = new THREE.CylinderGeometry(0.75, 0.75, 1.8, 6, 1, false, Math.PI / 2);
    const unseen = new THREE.MeshBasicMaterial();
    for (const thing of [...map.data.npcs, ...map.data.chests]) {
      const h = { q: thing.q, r: thing.r };
      const catcher = new THREE.Mesh(column, unseen);
      catcher.visible = false;
      catcher.position.copy(this.surface(h)).add(new THREE.Vector3(0, 0.9, 0));
      catcher.updateMatrixWorld();
      this.clickable.set(catcher, h);
    }
    for (const chest of map.data.chests) {
      const h = { q: chest.q, r: chest.r };
      const group = new THREE.Group();
      group.position.copy(this.surface(h));
      group.rotation.y = random() * Math.PI;
      this.scene.add(group);
      this.chests.set(chest.id, { group, hex: h, open: true });
      this.setChest(chest.id, false);
    }

    // The ways out: a ring of light on the hex, and a mote over it, gold to the world map, blue to another map.
    for (const exit of map.data.exits) {
      const h = { q: exit.q, r: exit.r };
      const color = exit.to === "world" ? "#f1b44c" : "#62a4c2";
      const ring = new THREE.RingGeometry(HEX_SIZE * 0.55, HEX_SIZE * 0.85, 6, 1, Math.PI / 2);
      ring.rotateX(-Math.PI / 2);
      const mark = new THREE.Group();
      mark.add(new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
      const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color }));
      mote.position.y = 0.9;
      mark.add(mote);
      mark.position.copy(this.surface(h)).add(new THREE.Vector3(0, 0.03, 0));
      this.scene.add(mark);
      this.exitMarks.push(mote);
      mark.traverse((o) => this.clickable.set(o, h));
    }

    // Light: the sun and sky outdoors; in a dungeon, gloom and a warm light at each brazier.
    if (dungeon) {
      this.scene.add(new THREE.HemisphereLight("#d8d6d0", "#3b3c4a", 1.9));
      const moon = new THREE.DirectionalLight("#f2efe6", 1.3);
      moon.position.set(-10, 30, 6);
      this.scene.add(moon, moon.target);
      let lamps = 0;
      for (const tile of tiles) {
        if (tile.prop !== "brazier" || lamps >= 8) continue;
        const lamp = new THREE.PointLight("#f1b44c", 10, 8, 1.5);
        lamp.position.copy(this.surface(tile.hex)).add(new THREE.Vector3(0, 1.2, 0));
        this.scene.add(lamp);
        lamps++;
      }
    } else {
      const sun = new THREE.DirectionalLight("#fff2d6", 2.2);
      sun.position.set(-18, 30, 10);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const reach = map.data.radius * 1.8 + 4;
      sun.shadow.camera.left = -reach;
      sun.shadow.camera.right = reach;
      sun.shadow.camera.top = reach;
      sun.shadow.camera.bottom = -reach;
      sun.shadow.camera.far = 120;
      this.scene.add(sun, sun.target);
      this.scene.add(new THREE.HemisphereLight("#c6e5ee", "#434c36", 1.1));
    }

    const ring = new THREE.RingGeometry(HEX_SIZE * 0.78, HEX_SIZE * 0.95, 6, 1, Math.PI / 2);
    ring.rotateX(-Math.PI / 2);
    this.markerMaterial = new THREE.MeshBasicMaterial({ color: "#f1b44c", side: THREE.DoubleSide });
    this.marker = new THREE.Mesh(ring, this.markerMaterial);
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  private placeNpc(npc: NpcData, random: () => number): void {
    const h = { q: npc.q, r: npc.r };
    const at = this.surface(h);
    const fixture = npc.kind === "spell-table" || npc.kind === "quest-board" || npc.kind === "arena" ? npc.kind : null;
    if (fixture) {
      const boxes = new Boxes();
      buildFixture(boxes, fixture);
      const group = boxes.build();
      group.position.copy(at);
      group.rotation.y = this.facing(h);
      this.scene.add(group);
      group.traverse((o) => this.clickable.set(o, h));
      return;
    }
    // A person: dressed in the region's color, a body and palette of their own.
    const seed = fnv1a32(`${this.map.id}:${npc.id}`);
    const body: Body = npc.kind === "armorer" ? "broad" : BODIES[seed % BODIES.length]!;
    const color = (this.map.region ?? (["W", "U", "B", "R", "G"] as const)[seed % 5]!) as ManaColor;
    const character = Character.player(npc.name ?? npc.kind, { body, palette: (seed >>> 3) % 6, identity: [color], slots: {} });
    character.root.position.copy(at);
    character.root.rotation.y = this.facing(h);
    this.scene.add(character.root);
    character.root.traverse((o) => this.clickable.set(o, h));
    this.residents.push({ npc, character });
    void random;
  }

  /** The way a fixture or person at `h` faces: toward the middle of the map, where people come from. */
  private facing(h: Hex): number {
    const { x, z } = toWorld(h);
    return Math.atan2(-x, -z);
  }

  /** Shows a chest shut or opened. */
  setChest(id: string, open: boolean): void {
    const chest = this.chests.get(id);
    if (!chest || chest.open === open) return;
    for (const child of [...chest.group.children]) {
      chest.group.remove(child);
      this.clickable.delete(child);
    }
    const boxes = new Boxes();
    buildFixture(boxes, open ? "chest-open" : "chest");
    const built = boxes.build();
    chest.group.add(built);
    built.traverse((o) => this.clickable.set(o, chest.hex));
    chest.open = open;
  }

  /** A hex's centre, standing on top of it. */
  surface(h: Hex): THREE.Vector3 {
    const { x, z } = toWorld(h);
    return new THREE.Vector3(x, this.map.heightAt(h), z);
  }

  /** Shows the marker on a hex, or hides it; its color says what a click there would do. */
  mark(h: Hex | null, color = "#f1b44c"): void {
    this.marker.visible = h !== null;
    if (h) {
      this.marker.position.copy(this.surface(h)).add(new THREE.Vector3(0, 0.02, 0));
      this.markerMaterial.color.set(color);
    }
  }

  /** The hex under a ray: the hex of a person, fixture, chest or exit, of scenery, or of the ground. */
  pick(ray: THREE.Raycaster): Hex | null {
    const targets: THREE.Object3D[] = [...this.grounds.map((g) => g.mesh), ...this.clickable.keys()];
    const hits = ray.intersectObjects(targets, false);
    for (const hit of hits) {
      const ground = this.grounds.find((g) => g.mesh === hit.object);
      if (ground && hit.instanceId !== undefined) return ground.hexes[hit.instanceId]!;
      const owner = this.clickable.get(hit.object);
      if (owner) {
        // Scenery is merged, so its hex is where the ray met it; scenery in the way of nothing is looked through,
        // to the ground behind it.
        if (Number.isNaN(owner.q)) {
          const h = fromWorld(hit.point.x, hit.point.z);
          if (this.map.thing(h)) return h;
          continue;
        }
        return owner;
      }
    }
    return null;
  }

  update(seconds: number): void {
    this.time += seconds;
    for (const mote of this.exitMarks) {
      mote.position.y = 0.9 + Math.sin(this.time * 2.5) * 0.12;
      mote.rotation.y += seconds * 1.5;
    }
    for (const resident of this.residents) resident.character.animate(seconds, false);
  }

  /** Frees the map's own meshes. Characters' meshes are shared between characters (character.ts), so they are taken
   * out of the scene first, not freed. */
  dispose(): void {
    for (const r of this.residents) {
      this.scene.remove(r.character.root);
      r.character.dispose();
    }
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) m.dispose();
      }
    });
    this.scene.clear();
  }
}

export { key };
