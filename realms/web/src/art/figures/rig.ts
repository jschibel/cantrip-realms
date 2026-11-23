import * as THREE from "three";
import { lit, textureOf } from "../../render/lighting";
import { MeshBuilder, fitted } from "../paint/builder";
import { Pixmap, type Rgb } from "../paint/pixmap";
import { cloth } from "./faces";

// The figure rig: people and creatures as chunky figures with 16-bit RPG proportions - a big head, two and a half heads tall -
// built as 3D rigs of boxes (legs, torso, arms, head, and whatever a figure adds: a helm's plume, a goblin's ears, a
// cape) and painted texel by texel at the scene's density. Each part's six faces are painted by code, a face or a crest
// by hand, and packed into one picture per figure, cut out where hair is jagged. The rig walks with a swing of the arms
// and legs and a bob of the body, and breathes and looks about when it stands.

/** A face painter: draws into a picture of the face's size. */
export type Paint = (p: Pixmap) => void;

export interface PartFaces {
  readonly front?: Paint;
  readonly back?: Paint;
  /** The figure's own left and right: east and west when it faces south (+z). */
  readonly left?: Paint;
  readonly right?: Paint;
  readonly top?: Paint;
  readonly bottom?: Paint;
}

export interface PartSpec {
  readonly name: string;
  /** Size in texels: width (x), height (y), depth (z). */
  readonly size: readonly [number, number, number];
  /** Where the part's pivot sits on its parent, in texels; and where the box sits on the pivot (its min corner). */
  readonly at: readonly [number, number, number];
  readonly box: readonly [number, number, number];
  readonly parent?: string;
  readonly faces: PartFaces;
  /** Fill for faces not painted. */
  readonly fill: Rgb;
  /**
   * A fixed tilt, radians about x then z (a goblin's ears, a ghoul's hunch), and optionally about y (a serpent's coils
   * curling round).
   */
  readonly tilt?: readonly [number, number] | readonly [number, number, number];
  /** How far its edges are rounded, in texels: by default a third of its thinnest side, at most 2. */
  readonly round?: number;
  /** A head's shaping (see `headShape`). */
  readonly shape?: HeadShape;
  /** How the part moves beyond the walk's named swings (a quadruped's legs, wings, a tail, a floating relic). */
  readonly motion?: Motion;
  /** The whole part lights itself (a ring's stone, a relic, a staff's crystal, a halo). */
  readonly glow?: boolean;
}

/**
 * How a part moves, for parts the walk does not swing by name (`leg.l`, `arm.r`, `cape`...):
 * - `leg`: swings about x with the stride, at `phase` (radians) in the cycle - a quadruped's diagonal pairs are 0 and
 *   pi; a `front` leg lifts when the figure rears to cast.
 * - `wing`: beats about z (`side` 1 its left wing, -1 its right), slowly standing, fast walking, spread wide casting.
 * - `tail`: sways about `axis`, each segment `delay` behind the one before, harder walking (a tail, a wurm's body).
 * - `bob`: rises and falls `amount` texels (a spirit's wisps).
 * - `orbit`: circles the figure's middle `radius` texels out, bobbing (a relic).
 * - `spark`: shown only while casting, pulsing (the light between a caster's hands).
 */
export type Motion =
  | { readonly kind: "leg"; readonly phase: number; readonly amount?: number; readonly front?: boolean }
  | { readonly kind: "wing"; readonly side: 1 | -1; readonly amount?: number }
  | { readonly kind: "tail"; readonly delay: number; readonly amount?: number; readonly axis?: "x" | "y" | "z"; readonly rate?: number }
  | { readonly kind: "bob"; readonly amount: number; readonly rate?: number; readonly delay?: number }
  | { readonly kind: "orbit"; readonly radius: number; readonly rate: number }
  | { readonly kind: "spark" };

/** What a figure can do besides walk and stand: cast a spell, or reach out to something (a door, a chest, a vendor). */
export type Action = "cast" | "interact";

/**
 * How a head is shaped from its rounded block, so it reads as a skull and not a box: its edges curved in `steps`
 * facets; its jaw and the back of its lower head drawn in towards the chin by `jaw` (0-1) - cheeks and a chin, not a
 * flat bottom; its crown domed up by `dome` of its height; its back rounded out by `back` of its depth.
 */
export interface HeadShape {
  readonly steps: number;
  readonly jaw: number;
  readonly dome: number;
  readonly back: number;
}

export const HEAD: HeadShape = { steps: 3, jaw: 0.16, dome: 0.08, back: 0.1 };

/** Gives a figure's head its rounding and shape: a skull, not a block. */
export function shapeHead(parts: PartSpec[], shape: HeadShape = HEAD, round = 3): PartSpec[] {
  return parts.map((p) => (p.name === "head" ? { ...p, round, shape } : p));
}

export interface FigureSpec {
  readonly name: string;
  readonly parts: readonly PartSpec[];
  /** How the figure moves: its stride's swing and its arms' (radians), and how far it hunches. */
  readonly stride?: number;
  readonly armSwing?: number;
  readonly hunch?: number;
  /** How far the torso tips forward walking (radians; 0.12 by default). */
  readonly lean?: number;
  /** Floats this many texels off the ground, bobbing (spirits, djinn). */
  readonly hover?: number;
  /** How wide its shadow is, in tiles (a radius); about 0.42 for a person. */
  readonly footprint?: number;
  /** Its wings beat standing as well as moving: it is aloft (a dragon, a bird, a drake). */
  readonly flies?: boolean;
  /**
   * How much of the sprite lean (`setLean`) it takes, 1 by default: a long body on four legs takes less, or seen head-on
   * the lean stands its back up behind its head in a column.
   */
  readonly leans?: number;
}

export const PX = 1 / 16;

// --- The rig ------------------------------------------------------------------------------------------------------

/** Packs each part's six faces into one picture, painted, and returns where each landed. */
function paintAtlas(spec: FigureSpec): { atlas: Pixmap; rects: Map<string, [number, number, number, number]>; glowing: [number, number, number, number][] } {
  const faces: { key: string; w: number; h: number; paint: Paint; fill: Rgb }[] = [];
  const glowParts = new Set(spec.parts.filter((p) => p.glow).map((p) => p.name));
  for (const part of spec.parts) {
    const [w, h, d] = part.size;
    const f = part.faces;
    faces.push({ key: `${part.name}:front`, w, h, paint: f.front ?? cloth([part.fill, part.fill], 0), fill: part.fill });
    faces.push({ key: `${part.name}:back`, w, h, paint: f.back ?? f.front ?? cloth([part.fill, part.fill], 0), fill: part.fill });
    faces.push({ key: `${part.name}:left`, w: d, h, paint: f.left ?? f.right ?? cloth([part.fill, part.fill], 0), fill: part.fill });
    faces.push({ key: `${part.name}:right`, w: d, h, paint: f.right ?? f.left ?? cloth([part.fill, part.fill], 0), fill: part.fill });
    faces.push({ key: `${part.name}:top`, w, h: d, paint: f.top ?? cloth([part.fill, part.fill], 0, false), fill: part.fill });
    faces.push({ key: `${part.name}:bottom`, w, h: d, paint: f.bottom ?? cloth([part.fill, part.fill], 0, false), fill: part.fill });
  }
  // Shelf packing, a texel of gutter round each face (its own edge color, so sampling never bleeds).
  const width = 128;
  let x = 0;
  let y = 0;
  let shelf = 0;
  const placed: { face: (typeof faces)[number]; x: number; y: number }[] = [];
  for (const face of faces) {
    if (x + face.w + 2 > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    placed.push({ face, x: x + 1, y: y + 1 });
    x += face.w + 2;
    shelf = Math.max(shelf, face.h + 2);
  }
  const height = Math.max(16, 2 ** Math.ceil(Math.log2(y + shelf)));
  const atlas = new Pixmap(width, height);
  atlas.fill(0, 0);
  const rects = new Map<string, [number, number, number, number]>();
  const glowing: [number, number, number, number][] = [];
  for (const { face, x: fx, y: fy } of placed) {
    const pic = new Pixmap(face.w, face.h, face.fill);
    face.paint(pic);
    atlas.copy(pic, 0, 0, face.w, face.h, fx, fy);
    rects.set(face.key, [fx, fy, face.w, face.h]);
    if (glowParts.has(face.key.slice(0, face.key.lastIndexOf(":")))) glowing.push([fx, fy, face.w, face.h]);
  }
  return { atlas, rects, glowing };
}

const figureMaterials = new Map<string, THREE.Material>();

/** Colors that glow wherever a figure is painted with them: a ghoul's eyes, a skeleton's. */
export const GHOUL_EYE = 0xd8f060;
export const BONE_EYE = 0xff4a3a;
/** More colors that glow: a spirit's pale eyes, arcane violet, embers, holy light, a vampire's red, Phyrexian oil-light. */
export const SPIRIT_EYE = 0xa8f4ff;
export const ARCANE_EYE = 0xd89cff;
export const EMBER_EYE = 0xffb03c;
export const HOLY_LIGHT = 0xfff2a8;
export const BLOOD_EYE = 0xff2e4c;
export const OIL_EYE = 0x7cff9c;
const GLOWS = new Set<Rgb>([GHOUL_EYE, BONE_EYE, SPIRIT_EYE, ARCANE_EYE, EMBER_EYE, HOLY_LIGHT, BLOOD_EYE, OIL_EYE]);

interface Joint {
  readonly name: string;
  readonly group: THREE.Group;
  readonly rest: THREE.Euler;
  readonly at: THREE.Vector3;
  readonly motion?: Motion;
}

/** How long each action lasts by default, seconds. */
const ACTION_LENGTH: Readonly<Record<Action, number>> = { cast: 1.2, interact: 0.7 };

export class Figure {
  readonly root = new THREE.Group();
  /** The figure's turn: 0 faces south (towards the three-quarter camera). */
  facing = 0;
  private targetFacing = 0;
  private readonly body = new THREE.Group();
  /** Turns the figure to its facing, inside the lean. */
  private readonly turn = new THREE.Group();
  /** Leans the whole figure back from the camera (see `setLean`). */
  private readonly lean = new THREE.Group();
  /** The camera's turn the lean is made about, taken back off the figure's facing. */
  private yaw = 0;
  private readonly joints = new Map<string, Joint>();
  private phase = 0;
  private time = Math.random() * 10;
  private moving = 0;
  private action: { kind: Action; t: number; length: number } | null = null;
  /** Top of the head above the feet, in world units. */
  readonly height: number;

  constructor(readonly spec: FigureSpec) {
    this.root.name = spec.name;
    this.root.add(this.lean);
    this.lean.add(this.turn);
    this.turn.add(this.body);
    let material = figureMaterials.get(spec.name) as THREE.MeshLambertMaterial | undefined;
    const { atlas, rects, glowing } = paintAtlas(spec);
    if (!material) {
      material = lit(textureOf(atlas, false), { cutout: true });
      // Eyes that glow in the dark: the texels painted in a glow color light themselves.
      const glows = new Pixmap(atlas.width, atlas.height, 0);
      let any = false;
      for (const [gx, gy, gw, gh] of glowing) {
        for (let y = gy; y < gy + gh; y++) {
          for (let x = gx; x < gx + gw; x++) {
            if (atlas.alpha(x, y) > 0) {
              glows.set(x, y, atlas.get(x, y));
              any = true;
            }
          }
        }
      }
      for (let y = 0; y < atlas.height; y++) {
        for (let x = 0; x < atlas.width; x++) {
          if (atlas.alpha(x, y) > 0 && GLOWS.has(atlas.get(x, y))) {
            glows.set(x, y, atlas.get(x, y));
            any = true;
          }
        }
      }
      if (any) {
        material.emissive = new THREE.Color("#ffffff");
        material.emissiveMap = textureOf(glows, false);
        material.emissiveIntensity = 0.9;
      }
      material.name = `figure:${spec.name}`;
      figureMaterials.set(spec.name, material);
    }
    const mat = material;
    for (const part of spec.parts) {
      const group = new THREE.Group();
      group.name = part.name;
      const parent = part.parent ? this.joints.get(part.parent)?.group : this.body;
      group.position.set(part.at[0] * PX, part.at[1] * PX, part.at[2] * PX);
      if (part.tilt) group.rotation.set(part.tilt[0], part.tilt[2] ?? 0, part.tilt[1]);
      (parent ?? this.body).add(group);
      this.joints.set(part.name, { name: part.name, group, rest: group.rotation.clone(), at: group.position.clone(), motion: part.motion });
      if (part.motion?.kind === "spark") {
        group.visible = false;
        group.scale.setScalar(0.01);
      }

      const [w, h, d] = part.size;
      const [bx, by, bz] = part.box;
      const b = new MeshBuilder();
      const face = (key: string) => fitted(mat, rects.get(`${part.name}:${key}`));
      const faces = { south: face("front"), north: face("back"), east: face("left"), west: face("right"), top: face("top"), bottom: face("bottom") };
      const round = part.round ?? Math.min(2, Math.floor(Math.min(w, h, d) / 3));
      const shape = part.shape;
      const warp = shape
        ? ([x, y, z]: readonly [number, number, number]): [number, number, number] => {
            // In the part's own texels: across from its middle, up from its foot, back from its face.
            const cx = (bx + w / 2) * PX;
            const ny = (y / PX - by) / h;
            const nb = ((bz + d) * PX - z) / (d * PX);
            const nx = (x - cx) / ((w / 2) * PX);
            const low = Math.max(0, (0.55 - ny) / 0.55);
            // The jaw: narrower towards the chin, the lower back of the head tucked in under the skull.
            let wx = cx + (x - cx) * (1 - shape.jaw * low * low);
            let wz = z + nb * d * PX * shape.jaw * 0.8 * low * low;
            // The back of the skull rounded out, most at its middle height.
            wz -= nb * nb * d * PX * shape.back * Math.sin(Math.PI * Math.min(1, ny));
            // The crown domed, most at its middle.
            const top = Math.max(0, (ny - 0.6) / 0.4);
            const wy = y + h * PX * shape.dome * top * Math.max(0, 1 - nx * nx) * Math.max(0, 1 - (nb - 0.5) * (nb - 0.5) * 4);
            wx = cx + (wx - cx) * (1 + 0.04 * Math.sin(Math.PI * Math.min(1, ny)));
            return [wx, wy, wz];
          }
        : undefined;
      if (round > 0) b.roundedBox(bx * PX, by * PX, bz * PX, (bx + w) * PX, (by + h) * PX, (bz + d) * PX, round * PX, faces, { steps: shape?.steps ?? 1, warp });
      else b.box(bx * PX, by * PX, bz * PX, (bx + w) * PX, (by + h) * PX, (bz + d) * PX, faces);
      const built = b.build(part.name);
      for (const child of [...built.children]) group.add(child);
    }
    this.root.updateMatrixWorld(true);
    this.height = new THREE.Box3().setFromObject(this.root).max.y;
  }

  /**
   * The sprite cheat, in 3D. A 16-bit RPG draws its map from above but its people from the front; seen from above, a 3D
   * figure shows the whole top of its head instead. So a figure leans back from the camera by `angle`, about its feet
   * and the camera's horizontal axis, and is squashed along its own height by just enough that its front still shows
   * one texel to a pixel (cos pitch / cos(pitch - angle)) - and its top shrinks to a sliver, as a sprite's does. The
   * camera's pitch and turn are passed in, so the lean follows the camera through a doorway's easing.
   */
  setLean(full: number, pitch: number, yaw: number): void {
    const angle = full * (this.spec.leans ?? 1);
    this.lean.rotation.set(-angle, yaw, 0, "YXZ");
    this.lean.scale.y = Math.cos(pitch) / Math.cos(pitch - angle);
    this.yaw = yaw;
    this.turn.rotation.y = this.facing - yaw;
  }

  /** Turns to face a direction on the ground (x, z), smoothly. */
  face(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    this.targetFacing = Math.atan2(dx, dz);
  }

  /** Casts a spell (arms raised, light between the hands) or reaches out to something, for `seconds`. */
  act(kind: Action, seconds = ACTION_LENGTH[kind]): void {
    this.action = { kind, t: 0, length: Math.max(0.2, seconds) };
  }

  /** The action under way, if any. */
  get acting(): Action | null {
    return this.action?.kind ?? null;
  }

  /** How far into its action's pose the figure is: easing in, held, easing out (0 when not acting). */
  private actionWeight(): number {
    const a = this.action;
    if (!a) return 0;
    return Math.max(0, Math.min(1, a.t / 0.15, (a.length - a.t) / 0.2));
  }

  /** Advances the animation: `speed` is how fast it is walking, in tiles a second (0 standing). */
  update(dt: number, speed: number): void {
    this.time += dt;
    this.moving += ((speed > 0.1 ? 1 : 0) - this.moving) * Math.min(1, dt * 12);
    // Turning: the short way round, quickly.
    let delta = this.targetFacing - this.facing;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.facing += delta * Math.min(1, dt * 14);
    this.turn.rotation.y = this.facing - this.yaw;

    // Two steps a cycle; a cycle every 0.56 s at walking pace.
    this.phase += dt * (speed > 0.1 ? Math.max(1.6, speed) * 3.2 : 0);
    const s = Math.sin(this.phase);
    const walk = this.moving;
    const stand = 1 - walk;
    const stride = this.spec.stride ?? 0.75;
    const armSwing = this.spec.armSwing ?? 0.7;
    const breathe = Math.sin(this.time * 2.6);

    const joint = (name: string) => this.joints.get(name);
    const swing = (name: string, x: number, z = 0) => {
      const j = joint(name);
      if (j) j.group.rotation.set(j.rest.x + x, j.rest.y, j.rest.z + z);
    };
    swing("leg.l", s * stride * walk);
    swing("leg.r", -s * stride * walk);
    swing("arm.l", -s * armSwing * walk + breathe * 0.04 * stand, -0.06 - 0.05 * breathe * stand);
    swing("arm.r", s * armSwing * walk - breathe * 0.04 * stand, 0.06 + 0.05 * breathe * stand);
    swing("cape", 0.25 * walk + Math.abs(s) * 0.25 * walk + 0.04 * breathe * stand);
    swing("torso", (this.spec.hunch ?? 0) + 0.12 * walk + 0.02 * breathe * stand);
    // The head looks about now and then when standing, and nods with each step.
    const look = Math.sin(this.time * 0.7) > 0.75 ? Math.sin(this.time * 0.7 * 3) * 0.25 : 0;
    const head = joint("head");
    if (head) head.group.rotation.set(head.rest.x - 0.1 * walk + Math.abs(s) * 0.08 * walk, look * stand, head.rest.z);
    const tail = joint("ear.l");
    if (tail) tail.group.rotation.z = tail.rest.z + Math.sin(this.time * 3) * 0.08 + Math.abs(s) * 0.15 * walk;
    const tail2 = joint("ear.r");
    if (tail2) tail2.group.rotation.z = tail2.rest.z - Math.sin(this.time * 3) * 0.08 - Math.abs(s) * 0.15 * walk;
    if (this.spec.lean !== undefined) {
      const torso = joint("torso");
      if (torso) torso.group.rotation.x = torso.rest.x + (this.spec.hunch ?? 0) + this.spec.lean * walk + 0.02 * breathe * stand;
    }
    // The bob: up on each step, and a breath's rise when standing.
    this.body.position.y = (Math.abs(Math.cos(this.phase)) * 1.6 * walk + (breathe > 0.3 ? 0.6 : 0) * stand) * PX;
    // A floating figure hangs above the ground, rising and falling.
    if (this.spec.hover !== undefined) this.body.position.y = (this.spec.hover + Math.sin(this.time * 2.2) * 1.2 + Math.abs(Math.cos(this.phase)) * 0.6 * walk) * PX;

    if (this.action) {
      this.action.t += dt;
      if (this.action.t >= this.action.length) this.action = null;
    }
    const act = this.actionWeight();
    const casting = this.action?.kind === "cast" ? act : 0;
    const reaching = this.action?.kind === "interact" ? act : 0;
    for (const j of this.joints.values()) if (j.motion) this.move(j, j.motion, walk, casting);
    if (act > 0) this.pose(casting, reaching);
  }

  /** A part's own motion, this frame. */
  private move(j: Joint, m: Motion, walk: number, casting: number): void {
    const g = j.group;
    const t = this.time;
    switch (m.kind) {
      case "leg":
        g.rotation.set(j.rest.x + Math.sin(this.phase + m.phase) * (m.amount ?? 0.6) * walk - (m.front ? 0.7 * casting : 0), j.rest.y, j.rest.z);
        break;
      case "wing": {
        // A slow open and close standing, a quick beat walking, and spread up and wide when casting.
        const aloft = this.spec.flies ? Math.max(walk, 0.7) : walk;
        const beat = Math.sin(t * (this.spec.flies ? 7 : 11)) * 0.45 * aloft;
        const idle = Math.sin(t * 1.8) * 0.08 * (1 - aloft);
        g.rotation.set(j.rest.x, j.rest.y - m.side * 0.35 * casting, j.rest.z + m.side * ((m.amount ?? 1) * (beat + idle) + 0.45 * casting));
        break;
      }
      case "tail": {
        const rate = m.rate ?? 2.2;
        const swing = Math.sin(t * rate + this.phase * 0.5 - m.delay) * (m.amount ?? 0.25) * (0.5 + 0.5 * walk);
        const axis = m.axis ?? "y";
        g.rotation.set(j.rest.x + (axis === "x" ? swing : 0), j.rest.y + (axis === "y" ? swing : 0), j.rest.z + (axis === "z" ? swing : 0));
        break;
      }
      case "bob":
        g.position.set(j.at.x, j.at.y + Math.sin(t * (m.rate ?? 2.6) - (m.delay ?? 0)) * m.amount * PX, j.at.z);
        break;
      case "orbit": {
        const a = t * m.rate;
        g.position.set(j.at.x + Math.cos(a) * m.radius * PX, j.at.y + Math.sin(t * 2.4) * 1.5 * PX, j.at.z + Math.sin(a) * m.radius * PX * 0.6);
        g.rotation.set(0, a * 1.5, 0);
        break;
      }
      case "spark": {
        g.visible = casting > 0.05;
        const k = Math.max(0.01, casting * (0.85 + 0.15 * Math.sin(t * 18)));
        g.scale.set(k, k, k);
        g.rotation.set(0, t * 4, 0);
        break;
      }
    }
  }

  /**
   * The action's pose over the walk: casting raises both arms high and a little apart, the head tipped up (a creature
   * with no arms rears, its head up and its wings spread); reaching puts the right arm out before it, the head bowed.
   */
  private pose(casting: number, reaching: number): void {
    const add = (name: string, x: number, z = 0) => {
      const j = this.joints.get(name);
      if (j) {
        j.group.rotation.x += x;
        j.group.rotation.z += z;
      }
    };
    const arms = this.joints.has("arm.l") || this.joints.has("arm.r");
    add("arm.l", -2.5 * casting, 0.35 * casting);
    add("arm.r", -2.5 * casting - 1.35 * reaching, -0.35 * casting);
    add("head", -0.28 * casting + 0.18 * reaching);
    add("torso", (arms ? -0.1 : -0.3) * casting + 0.1 * reaching);
  }
}

