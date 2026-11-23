import * as THREE from "three";
import { BODIES, type Body, Character, type ManaColor } from "../character";
import { HEX_SIZE, type Hex, fromWorld, key, toWorld } from "../hex";
import type { GameMap } from "../maps/gameMap";
import type { NpcData, Terrain } from "../maps/schema";
import { fnv1a32, mulberry32 } from "../random";
import { GROUND_ORDER, celMaterial, lightOutdoors, lightUnderground } from "../look";
import { Boxes, TINTS, buildFixture, buildProp } from "./props";

// The three.js scene for a local map: a prism for every hex (one instanced mesh, so a map of a thousand hexes is one
// draw), the scenery merged into two meshes, the people of the map standing at their places, chests, the glowing
// ways out, the sun and the sky's fill light (or a dungeon's gloom and its braziers), and the marker under the hex
// the pointer is over. Colors are the palette's (palette.ts): a terrain is one color, so hexes of it join without a seam
// and a step up shows by its side faces' darker band, and the ground is never outlined (look.ts).

const SHADES: Record<Terrain, readonly string[]> = {
  grass: ["#43722c"],
  meadow: ["#5e9134"],
  dirt: ["#9a663c"],
  road: ["#c08b55"],
  cobble: ["#757b8c"],
  stone: ["#575c6e"],
  rock: ["#3e4252"],
  sand: ["#ddb27a"],
  water: ["#33739a"],
  "deep-water": ["#22557c"],
  swamp: ["#39422c"],
  mud: ["#4d2f1f"],
  moss: ["#525d3c"],
  snow: ["#d5e2ea"],
  ice: ["#84bfd3"],
  ash: ["#2e3140"],
  lava: ["#f58a3a"],
  floor: ["#575c6e"],
  wood: ["#73472b"],
  marble: ["#979cab"],
  crystal: ["#7a32b0"],
  forest: ["#2f5424"],
  hills: ["#5e9134"],
  mountain: ["#757b8c"],
};

/** A terrain's main color, for the minimap and the world map. */
export const terrainColor = (terrain: Terrain): string => SHADES[terrain][0]!;

/** Terrain that lights itself. */
const GLOWS: ReadonlySet<Terrain> = new Set(["lava"]);

/** The depth every hex prism reaches below the ground plane, so steps between heights show as cliffs. */
const BASE = 1.5;

const SKIES: Record<string, string> = { W: "#84bfd3", U: "#5296b5", B: "#525d3c", R: "#9a663c", G: "#5e9134", hub: "#84bfd3" };

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
    this.scene.background = new THREE.Color(dungeon ? "#0b0c10" : SKIES[map.region ?? "hub"]!);
    const random = mulberry32(fnv1a32(map.id));

    // Ground: one instanced mesh of lit prisms, one of glowing ones.
    const tiles = [...map.all];
    // A hair over a hex, so neighbours overlap and no pinhole of sky shows where three meet.
    const prism = new THREE.CylinderGeometry(HEX_SIZE * 1.004, HEX_SIZE * 1.004, 1, 6, 1, false, Math.PI / 2);
    const lit = tiles.filter((t) => !GLOWS.has(t.terrain));
    const glowing = tiles.filter((t) => GLOWS.has(t.terrain));
    const matrix = new THREE.Matrix4();
    for (const [group, material] of [
      [lit, celMaterial({ outlined: false, ground: true })],
      [glowing, new THREE.MeshBasicMaterial({ color: "#ffffff" })],
    ] as const) {
      if (group.length === 0) continue;
      const mesh = new THREE.InstancedMesh(prism, material, group.length);
      mesh.receiveShadow = true;
      mesh.castShadow = material instanceof THREE.MeshLambertMaterial;
      // The ground is drawn first, so the player's ring (character.ts) can go over it and under everything else.
      mesh.renderOrder = GROUND_ORDER;
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
      const color = exit.to === "world" ? "#ffc94a" : "#84bfd3";
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

    // Light: the sun and sky outdoors; in a dungeon, gloom and a pool of light at each brazier.
    if (dungeon) {
      const lamps = tiles.filter((t) => t.prop === "brazier").map((t) => this.surface(t.hex).add(new THREE.Vector3(0, 1.2, 0)));
      lightUnderground(this.scene, lamps);
    } else {
      lightOutdoors(this.scene, map.data.radius * 1.8 + 4);
    }

    const ring = new THREE.RingGeometry(HEX_SIZE * 0.78, HEX_SIZE * 0.95, 6, 1, Math.PI / 2);
    ring.rotateX(-Math.PI / 2);
    this.markerMaterial = new THREE.MeshBasicMaterial({ color: "#ffc94a", side: THREE.DoubleSide });
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
  mark(h: Hex | null, color = "#ffc94a"): void {
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
