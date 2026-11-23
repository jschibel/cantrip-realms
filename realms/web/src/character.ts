import * as THREE from "three";
import type { AttachPoint, VoxModel, VoxPart } from "./voxel/format";
import { greedyMesh } from "./voxel/mesher";
import { celMaterial } from "./look";
import { getModel } from "./voxel/models";

// A body in the overworld (design.md A1, A4; tech.md B5): a voxel model (realms/content/models) cut into parts - legs,
// torso, arms, head, or a drake's wings and tail - each meshed once and turned about its pivot as the character walks.
// A player's body is drawn in their skin and hair and their colors' cloth; each worn gear item's mesh hangs on the
// body's attachment points, so what a character wears is what others see. A mob is its base model in its palette.

export const BODIES = ["lithe", "broad", "tall", "stocky"] as const;
export type Body = (typeof BODIES)[number];

/** The six skin-and-hair palettes a character is made with (design.md A1), in the palette's skin ramp. */
export const SKIN_PALETTES: readonly { readonly name: string; readonly skin: string; readonly hair: string }[] = [
  { name: "Fair, brown hair", skin: "#f0caa0", hair: "#73472b" },
  { name: "Fair, red hair", skin: "#f0caa0", hair: "#d0521f" },
  { name: "Olive, black hair", skin: "#d29f72", hair: "#1b1d26" },
  { name: "Bronze, black hair", skin: "#b07448", hair: "#2e1c14" },
  { name: "Umber, dark hair", skin: "#87502f", hair: "#1b1d26" },
  { name: "Deep, silver hair", skin: "#5e3424", hair: "#bcbfc9" },
];

export type ManaColor = "W" | "U" | "B" | "R" | "G";

/**
 * Each color's cloth and its darker trim, from the palette's identity ramps (palette.ts): saturated, in hues the land
 * does not use, so a character stands out from wherever they stand.
 */
export const CLOTH: Readonly<Record<ManaColor, { readonly cloth: string; readonly trim: string }>> = {
  W: { cloth: "#fff8de", trim: "#e09a2a" },
  U: { cloth: "#3f62e8", trim: "#142266" },
  B: { cloth: "#7a32b0", trim: "#2a0f3d" },
  R: { cloth: "#e02a3a", trim: "#520a14" },
  G: { cloth: "#1fbf62", trim: "#0a4026" },
};
const UNCOLORED = { cloth: "#979cab", trim: "#575c6e" };
const LEATHER = "#4d2f1f";

/**
 * How much bigger than the scenery a figure is drawn - every character and mob - so that people read first in any
 * scene (tech.md, B5): larger than life, as pixel-art games draw them.
 */
export const FIGURE_SCALE = 1.5;

/** The ring under the player, in the lightest of their color's ramp. */
export const RING_COLORS: Readonly<Record<ManaColor, string>> = { W: "#fff8de", U: "#85a6ff", B: "#b06ee6", R: "#ff7a6a", G: "#7af0a6" };
const RING = new THREE.RingGeometry(0.58, 0.72, 32, 1).rotateX(-Math.PI / 2);

export const SLOTS = ["head", "neck", "body", "hands", "feet", "ring1", "ring2", "relic"] as const;
export type Slot = (typeof SLOTS)[number];

/** How a worn item looks (interfaces.md, gear `look`): a gear mesh of realms/content/models and its two colors. */
export interface GearLook {
  readonly mesh: string;
  readonly palette: readonly string[];
}

export interface Appearance {
  readonly body: Body;
  /** An index into SKIN_PALETTES. */
  readonly palette: number;
  /** The character's color identity, in WUBRG order: the first is their cloth, the second its trim. */
  readonly identity: readonly ManaColor[];
  readonly slots: Partial<Record<Slot, GearLook>>;
}

/** How a mob looks (interfaces.md, mob `model`). */
export interface MobModel {
  readonly mesh: string;
  readonly palette: readonly string[];
  /** How much bigger than its model: 1 for as made. */
  readonly size?: number;
}

/** The palette a body is drawn with: "$0" skin, "$1" hair, "$2" cloth, "$3" trim, "$4" leather. */
export function bodyPalette(a: Appearance): string[] {
  const skin = SKIN_PALETTES[a.palette] ?? SKIN_PALETTES[0]!;
  const first = a.identity[0];
  const second = a.identity[1];
  const cloth = first ? CLOTH[first] : UNCOLORED;
  const trim = second ? CLOTH[second].cloth : cloth.trim;
  return [skin.skin, skin.hair, cloth.cloth, trim, LEATHER];
}

// One outlined cel material for every lit voxel and one unlit for glows: the colors are in the vertices.
const LIT = celMaterial({ vertexColors: true, outlined: true });
const GLOW = new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true });

// Meshes are shared between characters drawn alike: a part in one palette is meshed once.
const meshes = new Map<string, THREE.BufferGeometry>();

function partGeometry(model: VoxModel, part: VoxPart, palette: readonly string[]): THREE.BufferGeometry {
  const key = `${model.id}|${part.name}|${palette.join(",")}`;
  let geometry = meshes.get(key);
  if (!geometry) {
    const colors = model.palette.map((entry) => {
      if (entry.startsWith("$")) {
        const n = Number(entry.slice(1));
        return new THREE.Color(palette[Math.min(n, palette.length - 1)] ?? "#ff00ff");
      }
      return new THREE.Color(entry);
    });
    geometry = greedyMesh(part, (i) => colors[i] ?? new THREE.Color("#ff00ff"), model.voxel);
    meshes.set(key, geometry);
  }
  return geometry;
}

function meshOf(model: VoxModel, part: VoxPart, palette: readonly string[]): THREE.Mesh {
  const mesh = new THREE.Mesh(partGeometry(model, part, palette), part.glow ? GLOW : LIT);
  mesh.castShadow = !part.glow;
  mesh.receiveShadow = !part.glow;
  mesh.name = part.name;
  return mesh;
}

/** A part as built: its group, turned by animation about the pivot, and where it rests. */
interface Node {
  readonly part: VoxPart;
  readonly group: THREE.Group;
  readonly rest: THREE.Vector3;
  /** Its place among the parts of the same motion (a wurm's segments), for phase. */
  readonly order: number;
}

/** The other side's attachment point: a second ring is worn on the left hand. */
const MIRROR: Partial<Record<AttachPoint, AttachPoint>> = {
  "hand-right": "hand-left",
  "hand-left": "hand-right",
  "arm-right": "arm-left",
  "arm-left": "arm-right",
  "leg-right": "leg-left",
  "leg-left": "leg-right",
  "foot-right": "foot-left",
  "foot-left": "foot-right",
};

export class Character {
  readonly root = new THREE.Group();
  /** Top of the head above the feet, in world units: where a label or a test hook points. */
  height = 1.4;

  private readonly body = new THREE.Group();
  private model: VoxModel | undefined;
  private nodes: Node[] = [];
  private readonly gear = new Map<Slot, Node[]>();
  private phase = 0;
  private time = 0;
  private walking = 0;
  private action: { kind: "cast" | "interact"; t: number } | null = null;
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;

  private constructor(readonly name: string) {
    this.root.name = name;
    this.root.add(this.body);
    this.body.scale.setScalar(FIGURE_SCALE);
  }

  /** A player's character: their body, palette and colors, wearing their gear. */
  static player(name: string, appearance: Appearance): Character {
    const c = new Character(name);
    c.setAppearance(appearance);
    return c;
  }

  /** A mob drawn from its base model; an unknown mesh is drawn as the humanoid. */
  static mob(name: string, model: MobModel): Character {
    const c = new Character(name);
    const vox = getModel(model.mesh) ?? getModel("humanoid");
    c.body.scale.setScalar((model.size ?? 1) * FIGURE_SCALE);
    if (vox) c.build(vox, model.palette);
    return c;
  }

  /** Puts on a new body, palette, colors and gear at once. */
  setAppearance(a: Appearance): void {
    const vox = getModel(`body-${a.body}`) ?? getModel("body-lithe");
    if (!vox) return;
    this.build(vox, bodyPalette(a));
    for (const slot of SLOTS) {
      this.wear(slot, a.slots[slot] ?? null);
    }
  }

  /** Changes what one slot shows: the item's mesh on the body's attachment points, or nothing. */
  wear(slot: Slot, look: GearLook | null): void {
    for (const node of this.gear.get(slot) ?? []) {
      node.group.removeFromParent();
    }
    this.gear.delete(slot);
    const vox = look && getModel(look.mesh);
    const body = this.model;
    if (!look || !vox || vox.kind !== "gear" || !body?.attach) return;

    const worn: Node[] = [];
    for (const part of vox.parts) {
      let mount = part.mount;
      if (!mount) continue;
      if (slot === "ring2") mount = MIRROR[mount] ?? mount;
      const point = body.attach[mount];
      const host = point && this.nodes.find((n) => n.part.name === point.part);
      if (!point || !host) continue;

      // Stretched to the body region it covers, along each axis it was fitted on.
      const scale = new THREE.Vector3(1, 1, 1);
      if (part.fit && point.size) {
        scale.set(
          part.fit[0] > 0 ? point.size[0] / part.fit[0] : 1,
          part.fit[1] > 0 ? point.size[1] / part.fit[1] : 1,
          part.fit[2] > 0 ? point.size[2] / part.fit[2] : 1,
        );
      }
      const group = new THREE.Group();
      group.name = `${slot}:${part.name}`;
      group.add(meshOf(vox, part, look.palette));
      group.scale.copy(scale);
      const o = host.part.origin;
      group.position.set(
        (point.at[0] - o[0] + part.pivot[0] * scale.x) * body.voxel,
        (point.at[1] - o[1] + part.pivot[1] * scale.y) * body.voxel,
        (point.at[2] - o[2] + part.pivot[2] * scale.z) * body.voxel,
      );
      host.group.add(group);
      worn.push({ part, group, rest: group.position.clone(), order: 0 });
    }
    this.gear.set(slot, worn);
  }

  /** Shows a ring on the ground under the character (the player's, in their color), or takes it away. */
  showRing(color: string | null): void {
    if (this.ring) {
      this.ring.removeFromParent();
      this.ring.material.dispose();
      this.ring = null;
    }
    if (!color) return;
    this.ring = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color }));
    this.ring.name = "ring";
    this.ring.position.y = 0.03;
    this.root.add(this.ring);
  }

  /** Turns to face a point on the ground. */
  face(x: number, z: number): void {
    const dx = x - this.root.position.x;
    const dz = z - this.root.position.z;
    if (dx * dx + dz * dz > 1e-6) {
      this.root.rotation.y = Math.atan2(dx, dz);
    }
  }

  /** A short one-shot gesture: raising both hands to cast, or reaching out to a table, a chest or a person. */
  play(action: "cast" | "interact"): void {
    this.action = { kind: action, t: 0 };
  }

  /** Moves the parts on by `seconds`: `moving` is whether the character walked this frame. */
  animate(seconds: number, moving: boolean): void {
    this.time += seconds;
    this.walking = THREE.MathUtils.damp(this.walking, moving ? 1 : 0, 12, seconds);
    this.phase += seconds * 9 * this.walking;
    const swing = Math.sin(this.phase) * 0.7 * this.walking;

    let gesture = 0;
    let casting = false;
    if (this.action) {
      this.action.t += seconds;
      const length = this.action.kind === "cast" ? 0.8 : 0.5;
      gesture = Math.sin(Math.min(1, this.action.t / length) * Math.PI);
      casting = this.action.kind === "cast";
      if (this.action.t >= length) this.action = null;
    }

    for (const node of this.nodes) {
      const g = node.group;
      switch (node.part.motion) {
        case "leg-left":
          g.rotation.x = swing;
          break;
        case "leg-right":
          g.rotation.x = -swing;
          break;
        case "arm-left":
          g.rotation.x = -swing * 0.8 - (casting ? gesture * 2.4 : 0);
          g.rotation.z = casting ? gesture * 0.3 : 0;
          break;
        case "arm-right":
          g.rotation.x = swing * 0.8 - gesture * (casting ? 2.4 : 1.3);
          g.rotation.z = casting ? -gesture * 0.3 : 0;
          break;
        case "wing-left":
        case "wing-right": {
          const beat = Math.sin(this.time * (3 + 7 * this.walking)) * (0.25 + 0.35 * this.walking);
          const left = node.part.motion === "wing-left";
          g.rotation.z = left ? beat + 0.15 : -beat - 0.15;
          g.rotation.y = left ? -0.5 : 0.5;
          break;
        }
        case "tail":
          g.rotation.y = Math.sin(this.time * 1.6 + this.phase * 0.3) * 0.3;
          break;
        case "segment":
          g.rotation.y = Math.sin(this.time * 1.5 + this.phase * 0.5 - node.order * 0.9) * (0.18 + 0.12 * this.walking);
          break;
        case "bob":
          g.position.y = node.rest.y + Math.abs(Math.sin(this.phase)) * 0.05 * this.walking + Math.sin(this.time * 2) * 0.008;
          break;
        case "float":
          g.position.y = node.rest.y + 0.12 + Math.sin(this.time * 2.2) * 0.05;
          break;
      }
    }
    for (const nodes of this.gear.values()) {
      for (const node of nodes) {
        if (node.part.motion === "float") {
          node.group.position.y = node.rest.y + Math.sin(this.time * 2.5) * 0.05;
          node.group.rotation.y = this.time * 1.5;
        }
      }
    }
  }

  /** Takes the character out of the scene. Meshes are shared, so they are kept for the next one drawn alike. */
  dispose(): void {
    this.root.removeFromParent();
    this.body.clear();
    this.nodes = [];
    this.gear.clear();
  }

  private build(model: VoxModel, palette: readonly string[]): void {
    this.body.clear();
    this.nodes = [];
    this.gear.clear();
    this.model = model;

    const byName = new Map<string, Node>();
    const counts = new Map<string, number>();
    // A part is placed once its parent is, whatever order the file lists them in.
    const pending = [...model.parts];
    while (pending.length > 0) {
      const index = pending.findIndex((p) => p.parent === undefined || byName.has(p.parent));
      if (index < 0) break;
      const part = pending.splice(index, 1)[0]!;
      const group = new THREE.Group();
      group.name = part.name;
      group.add(meshOf(model, part, palette));
      const parent = part.parent === undefined ? undefined : byName.get(part.parent);
      const o = parent?.part.origin ?? [0, 0, 0];
      group.position.set((part.pivot[0] - o[0]) * model.voxel, (part.pivot[1] - o[1]) * model.voxel, (part.pivot[2] - o[2]) * model.voxel);
      (parent?.group ?? this.body).add(group);
      const motion = part.motion ?? "none";
      const order = counts.get(motion) ?? 0;
      counts.set(motion, order + 1);
      const node: Node = { part, group, rest: group.position.clone(), order };
      byName.set(part.name, node);
      this.nodes.push(node);
    }

    // The height is the top of the model standing at rest, as drawn (a halo floating above it does not count).
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const node of this.nodes) {
      if (node.part.glow && node.part.motion === "float") continue;
      box.expandByObject(node.group.children[0]!);
    }
    const base = this.root.getWorldPosition(new THREE.Vector3()).y;
    this.height = box.isEmpty() ? 1.4 : box.max.y - base;
  }
}
