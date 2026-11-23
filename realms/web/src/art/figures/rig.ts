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
  /** A fixed tilt, radians about x then z (a goblin's ears, a ghoul's hunch). */
  readonly tilt?: readonly [number, number];
  /** How far its edges are rounded, in texels: by default a third of its thinnest side, at most 2. */
  readonly round?: number;
  /** A head's shaping (see `headShape`). */
  readonly shape?: HeadShape;
}

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
}

export const PX = 1 / 16;

// --- The rig ------------------------------------------------------------------------------------------------------

/** Packs each part's six faces into one picture, painted, and returns where each landed. */
function paintAtlas(spec: FigureSpec): { atlas: Pixmap; rects: Map<string, [number, number, number, number]> } {
  const faces: { key: string; w: number; h: number; paint: Paint; fill: Rgb }[] = [];
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
  for (const { face, x: fx, y: fy } of placed) {
    const pic = new Pixmap(face.w, face.h, face.fill);
    face.paint(pic);
    atlas.copy(pic, 0, 0, face.w, face.h, fx, fy);
    rects.set(face.key, [fx, fy, face.w, face.h]);
  }
  return { atlas, rects };
}

const figureMaterials = new Map<string, THREE.Material>();

/** Colors that glow wherever a figure is painted with them: a ghoul's eyes, a skeleton's. */
export const GHOUL_EYE = 0xd8f060;
export const BONE_EYE = 0xff4a3a;
const GLOWS = new Set<Rgb>([GHOUL_EYE, BONE_EYE]);

interface Joint {
  readonly name: string;
  readonly group: THREE.Group;
  readonly rest: THREE.Euler;
}

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
  /** Top of the head above the feet, in world units. */
  readonly height: number;

  constructor(readonly spec: FigureSpec) {
    this.root.name = spec.name;
    this.root.add(this.lean);
    this.lean.add(this.turn);
    this.turn.add(this.body);
    let material = figureMaterials.get(spec.name) as THREE.MeshLambertMaterial | undefined;
    const { atlas, rects } = paintAtlas(spec);
    if (!material) {
      material = lit(textureOf(atlas, false), { cutout: true });
      // Eyes that glow in the dark: the texels painted in a glow color light themselves.
      const glows = new Pixmap(atlas.width, atlas.height, 0);
      let any = false;
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
      if (part.tilt) group.rotation.set(part.tilt[0], 0, part.tilt[1]);
      (parent ?? this.body).add(group);
      this.joints.set(part.name, { name: part.name, group, rest: group.rotation.clone() });

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
  setLean(angle: number, pitch: number, yaw: number): void {
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
    // The bob: up on each step, and a breath's rise when standing.
    this.body.position.y = (Math.abs(Math.cos(this.phase)) * 1.6 * walk + (breathe > 0.3 ? 0.6 : 0) * stand) * PX;
  }
}

