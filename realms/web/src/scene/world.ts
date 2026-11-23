import * as THREE from "three";
import { BODIES, type Body, Character, type ManaColor } from "../character";
import { HEX_SIZE, type Hex, fromWorld, hex, key, toWorld } from "../hex";
import { GROUND_ORDER, celMaterial, lightOutdoors, lightUnderground } from "../look";
import { fnv1a32, mulberry32 } from "../random";
import type { ChestData, DoorData, EntranceData, NpcData, PropData, Terrain } from "../world/schema";
import type { Space, Tile } from "../world/space";
import { buildStructure } from "./buildings";
import { Boxes, TINTS, buildFixture } from "./props";

// The three.js scene of the ground a character walks (the streamed world, an interior, a dungeon floor), built patch
// by patch: a prism for every hex (one instanced mesh a patch), the scenery merged, the people standing at their
// places, chests, doors, the glowing ways in and out, the light, and the marker under the hex the pointer is over.
// Colors are the palette's (palette.ts): a terrain is one color, so hexes of it join without a seam and a step up shows
// by its side faces' darker band, and the ground is never outlined (look.ts).

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
  crystal: ["#5e5294"],
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

// One ground material for every patch, lit in its two bands; one for glowing ground (lava).
const GROUND = celMaterial({ outlined: false, ground: true });
const GROUND_GLOW = new THREE.MeshBasicMaterial({ color: "#ffffff" });
/** Materials every patch shares, never freed with one. */
const SHARED = new Set<THREE.Material>([GROUND, GROUND_GLOW]);

/** The sky's color over a region ("hub" for the heartland). */
export const skyOf = (region: string | null): string => SKIES[region ?? "hub"] ?? SKIES.hub!;

/** Someone standing at their place: an innkeeper, a vendor, an armorer, a townsperson, a guard. */
export interface Resident {
  readonly npc: NpcData;
  readonly character: Character;
}

/** What one patch of ground holds: a chunk of the world, a room, a dungeon floor. */
export interface PatchData {
  readonly tiles: Iterable<Tile>;
  readonly props: readonly PropData[];
  readonly npcs: readonly NpcData[];
  readonly chests: readonly ChestData[];
  readonly doors: readonly DoorData[];
  readonly entrances: readonly EntranceData[];
  /** Ways out: an interior's door, a dungeon's way up. */
  readonly leaves: readonly Hex[];
  readonly down?: Hex | null;
  /** The region whose tint the scenery takes, or "hub". */
  readonly tint: string;
  /** What its scenery's randomness is seeded by. */
  readonly seed: string;
}

interface Patch {
  readonly group: THREE.Group;
  readonly residents: Resident[];
  readonly clickable: THREE.Object3D[];
  readonly motes: THREE.Object3D[];
}

export type SceneMode = "outdoor" | "indoor" | "dungeon";

/**
 * The three.js scene of a space: a patch for each chunk near the player (or the one room), each a prism per hex (one
 * instanced mesh), its scenery merged, its people, chests, doors and ways in and out; the light (the sun following the
 * player outdoors, warm lamps indoors, a dungeon's gloom and braziers); and the marker under the hex the pointer is
 * over. A hex is found under the pointer by meeting the ground at its height, not by testing every prism.
 */
export class World {
  readonly scene = new THREE.Scene();
  private readonly patches = new Map<string, Patch>();
  /** What can be clicked besides the ground, by object: its hex. */
  private readonly clickable = new Map<THREE.Object3D, Hex>();
  private readonly chests = new Map<string, { group: THREE.Group; hex: Hex; open: boolean }>();
  private readonly waystones = new Map<string, { group: THREE.Group; lit: boolean }>();
  private readonly doors = new Map<string, { panel: THREE.Object3D; turn: number; opening: number }>();
  private readonly marker: THREE.Mesh;
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private readonly sun: THREE.DirectionalLight | null = null;
  private readonly sunOffset = new THREE.Vector3();
  private lit = false;
  private time = 0;
  /** Which towers are attuned, for the waystones' glow. */
  attuned: (tower: string) => boolean = () => false;

  constructor(
    readonly space: Space,
    readonly mode: SceneMode,
    sky: string,
  ) {
    this.scene.background = new THREE.Color(mode === "outdoor" ? sky : "#0b0c10");
    if (mode !== "dungeon") {
      // The sun follows the player over the world (update); a room has it over the room.
      lightOutdoors(this.scene, mode === "outdoor" ? 34 : 16);
      this.sun = mode === "outdoor" ? (this.scene.children.find((o) => o instanceof THREE.DirectionalLight) as THREE.DirectionalLight) : null;
      if (this.sun) this.sunOffset.copy(this.sun.position);
    }
    const ring = new THREE.RingGeometry(HEX_SIZE * 0.78, HEX_SIZE * 0.95, 6, 1, Math.PI / 2);
    ring.rotateX(-Math.PI / 2);
    this.markerMaterial = new THREE.MeshBasicMaterial({ color: "#ffc94a", side: THREE.DoubleSide });
    this.marker = new THREE.Mesh(ring, this.markerMaterial);
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  setSky(color: string): void {
    if (this.mode === "outdoor") (this.scene.background as THREE.Color).set(color);
  }

  hasPatch(k: string): boolean {
    return this.patches.has(k);
  }

  get patchKeys(): string[] {
    return [...this.patches.keys()];
  }

  /** Everyone standing at their places in the patches built. */
  get residents(): Resident[] {
    return [...this.patches.values()].flatMap((p) => p.residents);
  }

  /** Builds a patch of ground and everything on it. */
  addPatch(k: string, data: PatchData): void {
    if (this.patches.has(k)) this.removePatch(k);
    const group = new THREE.Group();
    const patch: Patch = { group, residents: [], clickable: [], motes: [] };
    const random = mulberry32(fnv1a32(data.seed));
    const tint = TINTS[data.tint] ?? TINTS.hub!;

    // Ground: one instanced mesh of lit prisms, one of glowing ones.
    const tiles = [...data.tiles];
    // A hair over a hex, so neighbours overlap and no pinhole of sky shows where three meet.
    const prism = new THREE.CylinderGeometry(HEX_SIZE * 1.004, HEX_SIZE * 1.004, 1, 6, 1, false, Math.PI / 2);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (const glow of [false, true]) {
      const set = tiles.filter((t) => GLOWS.has(t.terrain) === glow);
      if (set.length === 0) continue;
      const mesh = new THREE.InstancedMesh(prism, glow ? GROUND_GLOW : GROUND, set.length);
      mesh.receiveShadow = true;
      mesh.castShadow = !glow;
      // The ground is drawn first, so the player's ring (character.ts) can go over it and under everything else.
      mesh.renderOrder = GROUND_ORDER;
      set.forEach((tile, i) => {
        const { x, z } = toWorld(tile.hex);
        const tall = tile.height + BASE;
        matrix.makeScale(1, tall, 1).setPosition(x, tile.height - tall / 2, z);
        mesh.setMatrixAt(i, matrix);
        const shades = SHADES[tile.terrain] ?? SHADES.grass;
        const pick = (Math.imul(tile.hex.q, 73856093) ^ Math.imul(tile.hex.r, 19349663)) >>> 0;
        mesh.setColorAt(i, color.set(shades[pick % shades.length]!));
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    // Scenery, merged.
    const boxes = new Boxes();
    for (const prop of data.props) {
      const h = hex(prop.q, prop.r);
      const { x, z } = toWorld(h);
      const square = prop.kind === "building" || prop.kind === "entrance" || prop.kind === "gate" || prop.kind === "wall" || prop.kind === "tower" || prop.kind === "waymarker";
      boxes.at(x, this.space.heightAt(h), z, square ? 0 : random() * Math.PI);
      buildStructure(boxes, prop, tint, random);
    }
    if (!boxes.empty) group.add(boxes.build());

    // People, fixtures, chests, and an unseen column over each that clicks catch.
    const column = new THREE.CylinderGeometry(0.75, 0.75, 1.8, 6, 1, false, Math.PI / 2);
    const unseen = new THREE.MeshBasicMaterial();
    const catcher = (h: Hex) => {
      const c = new THREE.Mesh(column, unseen);
      c.visible = false;
      c.position.copy(this.surface(h)).add(new THREE.Vector3(0, 0.9, 0));
      group.add(c);
      this.clickable.set(c, h);
      patch.clickable.push(c);
    };
    for (const npc of data.npcs) {
      this.placeNpc(group, patch, npc);
      catcher(hex(npc.q, npc.r));
    }
    for (const chest of data.chests) {
      const h = hex(chest.q, chest.r);
      const g = new THREE.Group();
      g.position.copy(this.surface(h));
      g.rotation.y = random() * Math.PI;
      group.add(g);
      this.chests.set(chest.id, { group: g, hex: h, open: true });
      this.setChest(chest.id, false);
      catcher(h);
    }
    for (const prop of data.props) if (prop.kind === "waymarker") catcher(hex(prop.q, prop.r));

    // Doors: a panel in the wall beside each, which swings open as someone goes in.
    for (const door of data.doors) {
      const h = hex(door.q, door.r);
      const wall = this.doorWall(h, data.props);
      const panel = new THREE.Group();
      const b = new Boxes();
      b.at(0, 0, 0).box(0.9, 1.5, 0.12, "#4d2f1f", 0.45, 0.75, 0).box(0.12, 0.12, 0.14, "#ffc94a", 0.75, 0.75, 0.02);
      panel.add(b.build());
      panel.position.set(wall.x - Math.cos(wall.turn) * 0.45, this.space.heightAt(h), wall.z + Math.sin(wall.turn) * 0.45);
      panel.rotation.y = wall.turn;
      group.add(panel);
      this.doors.set(key(h), { panel, turn: wall.turn, opening: 0 });
      catcher(h);
    }
    // Ways in and out: a ring of light on the hex and a mote over it.
    const ways: [Hex, string][] = [
      ...data.entrances.map((e) => [hex(e.q, e.r), "#8e82c8"] as [Hex, string]),
      ...data.leaves.map((h) => [h, "#ffc94a"] as [Hex, string]),
      ...(data.down ? [[data.down, "#5296b5"] as [Hex, string]] : []),
    ];
    for (const [h, tone] of ways) {
      const ringGeometry = new THREE.RingGeometry(HEX_SIZE * 0.55, HEX_SIZE * 0.85, 6, 1, Math.PI / 2);
      ringGeometry.rotateX(-Math.PI / 2);
      const mark = new THREE.Group();
      mark.add(new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: tone, side: THREE.DoubleSide })));
      const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: tone }));
      mote.position.y = 0.9;
      mark.add(mote);
      mark.position.copy(this.surface(h)).add(new THREE.Vector3(0, 0.03, 0));
      group.add(mark);
      patch.motes.push(mote);
      catcher(h);
    }
    // A dungeon's braziers light it (the look's light underground, once, for its one floor).
    if (this.mode === "dungeon" && !this.lit) {
      this.lit = true;
      lightUnderground(this.scene, data.props.filter((p) => p.kind === "brazier").map((p) => this.surface(hex(p.q, p.r)).add(new THREE.Vector3(0, 1.2, 0))));
    }
    this.scene.add(group);
    this.patches.set(k, patch);
  }

  /** Where a door's panel hangs: on the wall of the building it is beside, facing out toward the door's hex. */
  private doorWall(h: Hex, props: readonly PropData[]): { x: number; z: number; turn: number } {
    const at = toWorld(h);
    let best: { x: number; z: number; turn: number; gap: number } | null = null;
    for (const p of props) {
      if (p.kind !== "building" || Math.abs(p.q - h.q) > 8 || Math.abs(p.r - h.r) > 8) continue;
      const c = toWorld(hex(p.q, p.r));
      const w = (p.w ?? 3) / 2;
      const d = (p.d ?? 3) / 2;
      const cx = Math.max(c.x - w, Math.min(c.x + w, at.x));
      const cz = Math.max(c.z - d, Math.min(c.z + d, at.z));
      const gap = Math.hypot(at.x - cx, at.z - cz);
      if (best && gap >= best.gap) continue;
      // Which face it is on: the one the door's hex lies beyond.
      const turn = Math.abs(cx - (c.x + w)) < 1e-6 ? Math.PI / 2 : Math.abs(cx - (c.x - w)) < 1e-6 ? -Math.PI / 2 : Math.abs(cz - (c.z + d)) < 1e-6 ? 0 : Math.PI;
      best = { x: cx, z: cz, turn, gap };
    }
    return best ?? { x: at.x, z: at.z, turn: 0 };
  }

  removePatch(k: string): void {
    const patch = this.patches.get(k);
    if (!patch) return;
    for (const r of patch.residents) {
      patch.group.remove(r.character.root);
      r.character.dispose();
    }
    for (const c of patch.clickable) this.clickable.delete(c);
    for (const [id, chest] of [...this.chests]) if (chest.group.parent === patch.group) this.chests.delete(id);
    for (const [id, w] of [...this.waystones]) if (w.group.parent === patch.group) this.waystones.delete(id);
    for (const [id, d] of [...this.doors]) if (d.panel.parent === patch.group) this.doors.delete(id);
    patch.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) if (!SHARED.has(m) && !(m as { vertexColors?: boolean }).vertexColors) m.dispose();
      }
    });
    this.scene.remove(patch.group);
    this.patches.delete(k);
  }

  private placeNpc(group: THREE.Group, patch: Patch, npc: NpcData): void {
    const h = hex(npc.q, npc.r);
    const at = this.surface(h);
    if (npc.kind === "waystone") {
      const g = new THREE.Group();
      g.position.copy(at);
      group.add(g);
      this.waystones.set(npc.tower ?? npc.id, { group: g, lit: true });
      this.setWaystone(npc.tower ?? npc.id, this.attuned(npc.tower ?? npc.id));
      return;
    }
    const fixture = npc.kind === "spell-table" || npc.kind === "quest-board" || npc.kind === "arena" ? npc.kind : null;
    if (fixture) {
      const boxes = new Boxes();
      buildFixture(boxes, fixture);
      const built = boxes.build();
      built.position.copy(at);
      built.rotation.y = this.facing(h);
      group.add(built);
      return;
    }
    // A person: dressed in the region's color, a body and palette of their own.
    const seed = fnv1a32(`${this.space.id}:${npc.id}`);
    const body: Body = npc.kind === "armorer" || npc.kind === "guard" ? "broad" : BODIES[seed % BODIES.length]!;
    const color = (["W", "U", "B", "R", "G"] as const)[seed % 5]! as ManaColor;
    const character = Character.player(npc.name ?? npc.kind, { body, palette: (seed >>> 3) % 6, identity: [color], slots: {} });
    character.root.position.copy(at);
    character.root.rotation.y = this.facing(h);
    group.add(character.root);
    patch.residents.push({ npc, character });
  }

  /** The way a fixture or person faces: toward the open ground beside them. */
  private facing(h: Hex): number {
    const open = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }]
      .map((d) => hex(h.q + d.q, h.r + d.r))
      .find((n) => this.space.passable(n));
    if (!open) return 0;
    const a = toWorld(h);
    const b = toWorld(open);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** Shows a chest shut or opened. */
  setChest(id: string, open: boolean): void {
    const chest = this.chests.get(id);
    if (!chest || chest.open === open) return;
    for (const child of [...chest.group.children]) chest.group.remove(child);
    const boxes = new Boxes();
    buildFixture(boxes, open ? "chest-open" : "chest");
    chest.group.add(boxes.build());
    chest.open = open;
  }

  /** Shows a tower's waystone lit (attuned) or dormant. */
  setWaystone(tower: string, lit: boolean): void {
    const stone = this.waystones.get(tower);
    if (!stone || stone.lit === lit) return;
    for (const child of [...stone.group.children]) stone.group.remove(child);
    const b = new Boxes();
    b.box(0.9, 0.3, 0.9, "#757b8c", 0, 0.15, 0);
    b.box(0.55, 1.7, 0.45, lit ? "#979cab" : "#575c6e", 0, 1.1, 0);
    b.box(0.3, 0.3, 0.48, lit ? "#5296b5" : "#2e3140", 0, 1.4, 0, { glow: lit });
    b.box(0.2, 0.2, 0.2, lit ? "#84bfd3" : "#2e3140", 0, 2.15, 0, { glow: lit });
    stone.group.add(b.build());
    stone.lit = lit;
  }

  /** Swings a door open; it shuts again by itself. */
  openDoor(h: Hex): void {
    const door = this.doors.get(key(h));
    if (door) door.opening = 1.2;
  }

  /** A hex's centre, standing on top of it. */
  surface(h: Hex): THREE.Vector3 {
    const { x, z } = toWorld(h);
    return new THREE.Vector3(x, this.space.heightAt(h), z);
  }

  /** Shows the marker on a hex, or hides it; its color says what a click there would do. */
  mark(h: Hex | null, color = "#ffc94a"): void {
    this.marker.visible = h !== null;
    if (h) {
      this.marker.position.copy(this.surface(h)).add(new THREE.Vector3(0, 0.02, 0));
      this.markerMaterial.color.set(color);
    }
  }

  /** The hex under a ray: a person's, a fixture's, a chest's, a door's, or the ground's where the ray meets it. */
  pick(ray: THREE.Raycaster): Hex | null {
    const hits = ray.intersectObjects([...this.clickable.keys()], false);
    const owner = hits[0] && this.clickable.get(hits[0].object);
    if (owner) return owner;
    // The ground: meet the plane at the height of the hex last found, until the hex found stops changing.
    let height = 0;
    let found: Hex | null = null;
    const point = new THREE.Vector3();
    for (let k = 0; k < 5; k++) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
      if (!ray.ray.intersectPlane(plane, point)) return found;
      const h = fromWorld(point.x, point.z);
      if (found && found.q === h.q && found.r === h.r) break;
      found = h;
      height = this.space.heightAt(h);
    }
    return found && this.space.tile(found) ? found : null;
  }

  update(seconds: number, focus: THREE.Vector3): void {
    this.time += seconds;
    for (const patch of this.patches.values()) {
      for (const mote of patch.motes) {
        mote.position.y = 0.9 + Math.sin(this.time * 2.5) * 0.12;
        mote.rotation.y += seconds * 1.5;
      }
      for (const resident of patch.residents) resident.character.animate(seconds, false);
    }
    for (const door of this.doors.values()) {
      if (door.opening <= 0) continue;
      door.opening = Math.max(0, door.opening - seconds);
      const swing = door.opening > 0.9 ? (1.2 - door.opening) / 0.3 : door.opening > 0.3 ? 1 : door.opening / 0.3;
      door.panel.rotation.y = door.turn + swing * 1.4;
    }
    if (this.sun) {
      this.sun.position.copy(focus).add(this.sunOffset);
      this.sun.target.position.copy(focus);
      this.sun.target.updateMatrixWorld();
    }
  }

  /** Frees every patch. Characters' meshes are shared between characters (character.ts), so they are taken out first. */
  dispose(): void {
    for (const k of [...this.patches.keys()]) this.removePatch(k);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) if (!SHARED.has(m) && !(m as { vertexColors?: boolean }).vertexColors) m.dispose();
      }
    });
    this.scene.clear();
  }
}

export { key };
