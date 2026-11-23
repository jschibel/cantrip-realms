import * as THREE from "three";
import * as C from "./colors";
import { MeshBuilder, fitted } from "./geometry";
import { lit, textureOf } from "./material";
import { Pixmap, type Rgb } from "./pixmap";
import { sprite } from "./sprite";

// The slice's people and creatures: chunky figures with 16-bit RPG proportions - a big head, two and a half heads tall -
// built as 3D rigs of boxes (legs, torso, arms, head, and whatever a figure adds: a helm's plume, a goblin's ears, a
// cape) and painted texel by texel at the scene's density. Each part's six faces are painted by code, a face or a crest
// by hand, and packed into one picture per figure, cut out where hair is jagged. The rig walks with a swing of the arms
// and legs and a bob of the body, and breathes and looks about when it stands.

/** A face painter: draws into a picture of the face's size. */
type Paint = (p: Pixmap) => void;

interface PartFaces {
  readonly front?: Paint;
  readonly back?: Paint;
  /** The figure's own left and right: east and west when it faces south (+z). */
  readonly left?: Paint;
  readonly right?: Paint;
  readonly top?: Paint;
  readonly bottom?: Paint;
}

interface PartSpec {
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
}

export interface FigureSpec {
  readonly name: string;
  readonly parts: readonly PartSpec[];
  /** How the figure moves: its stride's swing and its arms' (radians), and how far it hunches. */
  readonly stride?: number;
  readonly armSwing?: number;
  readonly hunch?: number;
}

const PX = 1 / 16;

// --- Painting helpers -------------------------------------------------------------------------------------------

/** Fills a face in a ramp's color with a lit top-left edge and a shadowed bottom-right one. */
function cloth(ramp: readonly Rgb[], at: number, edges = true): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        let c = ramp[at]!;
        if (edges && y === p.height - 1) c = ramp[Math.max(0, at - 1)]!;
        p.set(x, y, c);
      }
    }
  };
}

const layer =
  (...paints: (Paint | undefined)[]): Paint =>
  (p) => {
    for (const paint of paints) paint?.(p);
  };

const rows =
  (y0: number, y1: number, color: Rgb): Paint =>
  (p) => {
    for (let y = y0; y <= y1; y++) for (let x = 0; x < p.width; x++) p.put(x, y, color);
  };

const stamp =
  (art: readonly string[], legend: Record<string, Rgb>, x: number, y: number): Paint =>
  (p) =>
    p.blit(sprite(art, legend), x, y);

/** Hair across a face's top rows, with a ragged lower edge (cut out where `cut`). */
function hairRows(ramp: readonly Rgb[], depth: (x: number) => number, cutAbove = -1): Paint {
  return (p) => {
    for (let x = 0; x < p.width; x++) {
      const d = depth(x);
      for (let y = 0; y < d; y++) {
        let c = ramp[3]!;
        if (y === d - 1) c = ramp[1]!;
        else if ((x + y) % 5 === 0) c = ramp[4]!;
        else if ((x * 3 + y) % 7 === 0) c = ramp[2]!;
        p.put(x, y, c);
      }
      for (let y = 0; y < cutAbove; y++) p.put(x, y, 0, 0);
    }
  };
}

/** A whole face of hair, streaked. */
function hairAll(ramp: readonly Rgb[]): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        // Locks of hair: strands running down in a darker tone, parted into clumps.
        let c = ramp[3]!;
        if ((x + Math.floor(y / 2)) % 4 === 0) c = ramp[2]!;
        if (x % 4 === 1 && y % 3 === 0) c = ramp[4]!;
        p.set(x, y, c);
      }
    }
  };
}

/**
 * Hair seen from above, as 16-bit sprites paint it: clumps with dark parting lines, and a band of shine across the
 * crown (rows from the back of the head, at the top of the picture, to the front, at the bottom).
 */
function hairCrown(ramp: readonly Rgb[]): Paint {
  return (p) => {
    const shine = Math.floor(p.height * 0.55);
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        let c = ramp[3]!;
        if ((x + Math.floor(y / 2)) % 4 === 0) c = ramp[2]!;
        if ((y === shine || y === shine + 1) && x % 4 !== 0 && x > 0 && x < p.width - 1) c = ramp[y === shine ? 4 : 5] ?? ramp[4]!;
        if (y === p.height - 1) c = ramp[2]!;
        p.set(x, y, c);
      }
    }
  };
}

/** Spikes along a face's top edge: cut out between them. */
function spikes(period: number, height: number): Paint {
  return (p) => {
    for (let x = 0; x < p.width; x++) {
      const phase = x % period;
      const h = Math.round(height * (1 - Math.abs(phase - (period - 1) / 2) / ((period - 1) / 2 + 0.5)));
      for (let y = 0; y < height - h; y++) p.put(x, y, 0, 0);
    }
  };
}

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
const GHOUL_EYE = 0xd8f060;
const BONE_EYE = 0xff4a3a;
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
      if (round > 0) b.roundedBox(bx * PX, by * PX, bz * PX, (bx + w) * PX, (by + h) * PX, (bz + d) * PX, round * PX, faces);
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

// --- The cast ------------------------------------------------------------------------------------------------------

const S = C.SKIN;
const K = C.INK;
const WHITE = 0xffffff;

/** A humanoid's skeleton of parts: legs, torso, arms and head of the given sizes, standing on y = 0. */
function humanoid(o: {
  head: readonly [number, number, number];
  torso: readonly [number, number, number];
  arm: readonly [number, number, number];
  leg: readonly [number, number, number];
  faces: Record<string, PartFaces>;
  fills: Record<string, Rgb>;
  headLift?: number;
}): PartSpec[] {
  const [tw, th, td] = o.torso;
  const [lw, lh, ld] = o.leg;
  const [aw, ah, ad] = o.arm;
  const [hw, hh, hd] = o.head;
  const gap = tw / 2 - lw;
  return [
    { name: "leg.l", size: o.leg, at: [gap / 2 + lw / 2, lh, 0], box: [-lw / 2, -lh, -ld / 2], faces: o.faces.leg ?? {}, fill: o.fills.leg! },
    { name: "leg.r", size: o.leg, at: [-gap / 2 - lw / 2, lh, 0], box: [-lw / 2, -lh, -ld / 2], faces: o.faces.leg ?? {}, fill: o.fills.leg! },
    { name: "torso", size: o.torso, at: [0, lh, 0], box: [-tw / 2, 0, -td / 2], faces: o.faces.torso ?? {}, fill: o.fills.torso! },
    { name: "arm.l", parent: "torso", size: o.arm, at: [tw / 2 + aw / 2, th - 1, 0], box: [-aw / 2, -ah + 1, -ad / 2], faces: o.faces.arm ?? {}, fill: o.fills.arm! },
    { name: "arm.r", parent: "torso", size: o.arm, at: [-tw / 2 - aw / 2, th - 1, 0], box: [-aw / 2, -ah + 1, -ad / 2], faces: o.faces.armR ?? o.faces.arm ?? {}, fill: o.fills.arm! },
    { name: "head", parent: "torso", size: o.head, at: [0, th + (o.headLift ?? 0), 0], box: [-hw / 2, 0, -hd / 2], faces: o.faces.head ?? {}, fill: o.fills.head! },
  ];
}

/** A boot: leg cloth above, a boot below with a lit toe. */
function legFaces(trousers: readonly Rgb[], boot: readonly Rgb[], bootFrom: number): PartFaces {
  const paint = (front: boolean): Paint =>
    layer(cloth(trousers, 2), (p) => {
      for (let y = bootFrom; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          let c = boot[2]!;
          if (y === bootFrom) c = boot[3]!;
          if (y === p.height - 1) c = boot[0]!;
          if (front && y === p.height - 2 && x > 0 && x < p.width - 1) c = boot[4] ?? boot[3]!;
          p.set(x, y, c);
        }
      }
    });
  return { front: paint(true), back: paint(false), left: paint(false), top: cloth(trousers, 2, false), bottom: cloth(boot, 0, false) };
}

/** The hero: red spiky hair, a blue tunic with a belt, a red cape, brown boots. */
export function hero(): FigureSpec {
  const hair = C.HAIR_RED;
  const tunic = C.BLUE;
  const face: Paint = layer(
    cloth(S, 4, false),
    stamp(
      [
        "............",
        "............",
        "............",
        "...........",
        "..hh....hh..",
        "..wK....Kw..",
        "..KK....KK..",
        ".r........r.",
        ".....mm.....",
        "ssssssssssss",
      ],
      { h: hair[2]!, w: WHITE, K, r: C.PINK[3]!, m: S[2]!, s: S[3]! },
      0,
      0,
    ),
    hairRows(hair, (x) => (x === 0 || x === 11 ? 7 : x % 3 === 0 ? 4 : 3)),
  );
  const side: Paint = layer(cloth(S, 4, false), hairRows(hair, (x) => (x < 4 ? 10 : x < 6 ? 5 : 4)), stamp(["ee", "Ee"], { e: S[3]!, E: S[2]! }, 5, 5));
  const back: Paint = layer(hairAll(hair), rows(9, 9, hair[1]!));
  const capFront: Paint = layer(hairAll(hair), spikes(4, 3), (p) => {
    for (let x = 0; x < p.width; x++) p.put(x, p.height - 1, x % 3 === 1 ? 0 : hair[2]!, x % 3 === 1 ? 0 : 255);
  });
  const capSide: Paint = layer(hairAll(hair), spikes(3, 3));
  const torso: PartFaces = {
    front: layer(
      cloth(tunic, 3),
      stamp([".wWWWWw.", "..wWWw..", "...ww..."], { w: C.CLOTH_WHITE[3]!, W: C.CLOTH_WHITE[4]! }, 1, 0),
      rows(5, 5, C.WOOD[2]!),
      stamp(["gG"], { g: C.GOLD[3]!, G: C.GOLD[4]! }, 4, 5),
      (p) => p.put(0, 1, tunic[4]!),
    ),
    back: layer(cloth(tunic, 3), rows(5, 5, C.WOOD[2]!)),
    left: layer(cloth(tunic, 3), rows(5, 5, C.WOOD[2]!)),
    top: cloth(tunic, 4, false),
  };
  const arm: PartFaces = {
    front: layer(cloth(tunic, 3), rows(0, 0, tunic[4]!), rows(4, 4, C.CLOTH_WHITE[3]!), rows(5, 7, S[4]!), rows(7, 7, S[3]!)),
    left: layer(cloth(tunic, 3), rows(4, 4, C.CLOTH_WHITE[3]!), rows(5, 7, S[4]!), rows(7, 7, S[3]!)),
    top: cloth(tunic, 4, false),
    bottom: cloth(S, 3, false),
  };
  const parts = humanoid({
    head: [12, 10, 8],
    torso: [10, 7, 6],
    arm: [3, 8, 3],
    leg: [4, 5, 4],
    headLift: 0,
    faces: { head: { front: face, left: side, right: side, back, top: hairCrown(hair) }, torso, arm, leg: legFaces(C.SLATE, C.WOOD, 2) },
    fills: { head: S[4]!, torso: tunic[3]!, arm: tunic[3]!, leg: C.SLATE[2]! },
  });
  parts.push({ name: "hair", parent: "head", size: [14, 4, 10], at: [0, 7.5, 0], box: [-7, 0, -5.5], faces: { front: capFront, left: capSide, back: capSide, top: hairCrown(hair) }, fill: hair[3]!, round: 2 });
  parts.push({
    name: "cape",
    parent: "torso",
    size: [10, 11, 1],
    at: [0, 7, -3.5],
    box: [-5, -11, -1],
    faces: { front: cloth(C.RED, 2), back: layer(cloth(C.RED, 3), (p) => p.vline(3, 0, 11, C.RED[2]!), (p) => p.vline(7, 0, 11, C.RED[2]!), rows(0, 0, C.GOLD[3]!)) },
    fill: C.RED[3]!,
  });
  return { name: "hero", parts };
}

/** A knight of Benalia: a closed helm with a blue plume, white and gold tabard over mail, a kite shield, a spear. */
export function knight(): FigureSpec {
  const iron = C.IRON;
  const helmFront: Paint = layer(
    cloth(iron, 4),
    rows(0, 0, iron[5]!),
    rows(4, 4, K),
    rows(5, 5, iron[2]!),
    (p) => {
      p.vline(5, 1, 3, iron[6]!);
      p.vline(6, 1, 3, iron[3]!);
      for (const x of [3, 8]) p.put(x, 7, K);
      for (const x of [2, 9]) p.put(x, 7, iron[2]!);
      p.hline(0, p.height - 1, p.width, iron[2]!);
    },
  );
  const helmSide: Paint = layer(cloth(iron, 3), rows(0, 0, iron[5]!), (p) => p.put(1, 4, K), (p) => p.put(2, 4, K), rows(9, 9, iron[2]!));
  const tabard: Paint = layer(
    cloth(iron, 3),
    (p) => {
      for (let y = 0; y < p.height; y++) for (let x = 2; x < p.width - 2; x++) p.set(x, y, C.CLOTH_WHITE[x === 2 ? 4 : 3]!);
      p.vline(4, 0, p.height, C.BLUE[3]!);
      p.vline(5, 0, p.height, C.BLUE[2]!);
      p.hline(2, 2, p.width - 4, C.BLUE[3]!);
      p.put(4, 2, C.GOLD[4]!);
      p.put(5, 2, C.GOLD[3]!);
    },
    rows(5, 5, C.WOOD[2]!),
    stamp(["G"], { G: C.GOLD[4]! }, 7, 5),
  );
  const mail: Paint = layer(cloth(iron, 3), (p) => {
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y) % 2 === 0) p.set(x, y, iron[2]!);
  }, rows(0, 1, iron[5]!));
  const parts = humanoid({
    head: [12, 10, 10],
    torso: [10, 7, 6],
    arm: [3, 8, 3],
    leg: [4, 5, 4],
    faces: {
      head: { front: helmFront, left: helmSide, back: layer(cloth(iron, 3), rows(0, 0, iron[5]!)), top: layer(cloth(iron, 4, false), (p) => p.vline(5, 0, p.height, iron[6]!)) },
      torso: { front: tabard, back: layer(cloth(C.CLOTH_WHITE, 3), (p) => p.vline(4, 0, p.height, C.BLUE[3]!)), left: mail, top: cloth(iron, 4, false) },
      arm: { front: layer(mail, rows(6, 7, iron[4]!)), left: mail, top: cloth(iron, 5, false) },
      leg: legFaces(iron, C.IRON, 2),
    },
    fills: { head: iron[4]!, torso: iron[3]!, arm: iron[3]!, leg: iron[3]! },
  });
  parts.push({ name: "plume", parent: "head", size: [2, 5, 9], at: [0, 10, 0], box: [-1, -1, -5], faces: { left: layer(cloth(C.BLUE, 3), rows(0, 0, C.BLUE[5]!), spikes(3, 2)), top: cloth(C.BLUE, 4, false), front: cloth(C.BLUE, 4) }, fill: C.BLUE[3]!, tilt: [-0.15, 0] });
  parts.push({
    name: "shield",
    parent: "arm.l",
    size: [1, 10, 8],
    at: [2, -3, 0],
    box: [0, -5, -4],
    faces: {
      left: layer(cloth(C.BLUE, 3), (p) => {
        for (let y = 0; y < p.height; y++) {
          for (let x = 0; x < p.width; x++) {
            const kite = Math.abs(x - 3.5) <= Math.min(4, (p.height - y) * 0.75);
            if (!kite) p.put(x, y, 0, 0);
            else if (x === 0 || y === 0 || Math.abs(x - 3.5) > Math.min(4, (p.height - y) * 0.75) - 1) p.put(x, y, C.GOLD[3]!);
          }
        }
        p.blit(sprite(["..g..", ".gGg.", "gGWGg", ".gGg.", "..g.."], { g: C.GOLD[2]!, G: C.GOLD[3]!, W: C.GOLD[5]! }), 1, 2);
      }),
      right: cloth(C.WOOD, 3),
      front: cloth(C.GOLD, 3),
      top: cloth(C.GOLD, 4, false),
    },
    fill: C.GOLD[3]!,
  });
  parts.push({
    name: "spear",
    parent: "arm.r",
    size: [1, 30, 1],
    at: [0, -6, 1.5],
    box: [-0.5, -6, -0.5],
    faces: { front: layer(cloth(C.WOOD, 4), rows(0, 3, iron[5]!), rows(0, 0, iron[6]!)), left: layer(cloth(C.WOOD, 3), rows(0, 3, iron[4]!)), top: cloth(iron, 6, false) },
    fill: C.WOOD[4]!,
  });
  return { name: "knight", parts, stride: 0.6, armSwing: 0.35 };
}

/** Grizzlegom: a goblin shopkeeper, green and grinning, with ears out to here, a purple vest and gold buttons. */
export function goblin(vendor = true): FigureSpec {
  const g = C.GOBLIN;
  const vest = vendor ? C.PURPLE : C.WOOD;
  const face: Paint = layer(
    cloth(g, 4, false),
    stamp(
      [
        "..............",
        ".hh........hh.",
        "..bb......bb..",
        "..YYK....KYY..",
        "..YKK....KKY..",
        "..............",
        ".mWmWmWmWmWm..",
        "..mmmmmmmmm...",
        "..............",
        "gggggggggggggg",
      ],
      { h: g[1]!, b: g[2]!, Y: C.GOLD[4]!, K, m: C.RED[1]!, W: 0xfff8e0, g: g[3]! },
      0,
      1,
    ),
    rows(0, 0, g[5]!),
  );
  const side: Paint = layer(cloth(g, 3, false), rows(0, 0, g[5]!));
  const ear: Paint = layer(cloth(g, 4), (p) => {
    p.hline(0, 0, p.width, g[5]!);
    p.put(p.width - 1, 0, 0, 0);
    p.put(p.width - 1, p.height - 1, 0, 0);
    p.hline(1, 1, p.width - 2, C.PINK[2]!);
  });
  const torso: PartFaces = {
    front: layer(cloth(vendor ? C.CLOTH_WHITE : C.WOOD, 3), (p) => {
      for (let y = 0; y < p.height; y++) {
        for (const x of [0, 1, 2, p.width - 3, p.width - 2, p.width - 1]) p.set(x, y, vest[x < 2 || x > p.width - 3 ? 3 : 2]!);
      }
      for (const y of [1, 3, 5]) p.put(3, y, C.GOLD[4]!);
    }, rows(6, 6, vest[1]!)),
    back: cloth(vest, 3),
    left: cloth(vest, 3),
    top: cloth(vest, 4, false),
  };
  const arm: PartFaces = { front: layer(cloth(g, 3), rows(0, 2, vendor ? C.CLOTH_WHITE[3]! : C.WOOD[3]!), rows(5, 6, g[4]!)), top: cloth(C.CLOTH_WHITE, 3, false) };
  const parts = humanoid({
    head: [14, 10, 8],
    torso: [9, 7, 6],
    arm: [3, 7, 3],
    leg: [3, 4, 3],
    faces: {
      head: { front: face, left: side, back: layer(cloth(g, 3), stamp(["h h", " h "], { h: g[1]! }, 5, 1)), top: layer(cloth(g, 4, false), stamp(["hh.h", ".hh."], { h: g[1]! }, 5, 3)) },
      torso,
      arm,
      leg: legFaces(C.WOOD, C.DARKWOOD, 2),
    },
    fills: { head: g[4]!, torso: vest[3]!, arm: g[3]!, leg: C.WOOD[3]! },
  });
  parts.push({ name: "ear.l", parent: "head", size: [7, 3, 2], at: [7, 6, 0], box: [0, -1, -1], faces: { front: ear, back: ear, top: cloth(g, 5, false) }, fill: g[4]!, tilt: [0, 0.35] });
  parts.push({ name: "ear.r", parent: "head", size: [7, 3, 2], at: [-7, 6, 0], box: [-7, -1, -1], faces: { front: ear, back: ear, top: cloth(g, 5, false) }, fill: g[4]!, tilt: [0, -0.35] });
  parts.push({ name: "nose", parent: "head", size: [3, 3, 3], at: [0, 4, 4], box: [-1.5, -1, 0], faces: { front: layer(cloth(g, 4), rows(0, 0, g[5]!)), top: cloth(g, 5, false) }, fill: g[4]!, tilt: [0.3, 0] });
  if (vendor) {
    parts.push({ name: "hat", parent: "head", size: [8, 4, 6], at: [0, 9.5, -0.5], box: [-4, 0, -3], faces: { front: layer(cloth(C.RED, 3), rows(3, 3, C.GOLD[3]!), rows(0, 0, C.RED[4]!)), left: layer(cloth(C.RED, 2), rows(3, 3, C.GOLD[2]!)), top: layer(cloth(C.RED, 4, false), stamp(["G"], { G: C.GOLD[4]! }, 3, 2)) }, fill: C.RED[3]!, round: 1.5 });
  }
  return { name: vendor ? "grizzlegom" : "goblin", parts, stride: 0.9, armSwing: 0.9 };
}

/** A skeleton warrior: a grinning skull with red pin-prick eyes, a ribcage, bare bones and a notched sword. */
export function skeleton(): FigureSpec {
  const b = C.BONE;
  const skull: Paint = layer(
    cloth(b, 4, false),
    stamp(
      [
        "..........",
        "..........",
        ".KKK..KKK.",
        ".KRK..KRK.",
        ".KKK..KKK.",
        "....KK....",
        ".bWbWbWbW.",
        "..WbWbWb..",
        "...bbbb...",
      ],
      { K, R: BONE_EYE, W: b[5]!, b: b[2]! },
      0,
      0,
    ),
    rows(0, 0, b[5]!),
  );
  const ribs: Paint = (p) => {
    p.fill(0, 0);
    for (let y = 0; y < p.height; y++) {
      p.put(Math.floor(p.width / 2), y, b[3]!);
      if (y % 2 === 0 && y < p.height - 2) for (let x = 1; x < p.width - 1; x++) p.put(x, y, x === 1 ? b[5]! : b[4]!);
    }
    p.hline(1, p.height - 1, p.width - 2, b[3]!);
    p.hline(1, p.height - 2, p.width - 2, b[2]!);
  };
  const bone: Paint = layer(cloth(b, 4), (p) => p.vline(p.width - 1, 0, p.height, b[2]!), rows(0, 0, b[5]!));
  const parts = humanoid({
    head: [10, 9, 9],
    torso: [8, 7, 5],
    arm: [2, 8, 2],
    leg: [2, 6, 2],
    faces: {
      head: { front: skull, left: layer(cloth(b, 3, false), stamp(["KK"], { K }, 3, 4)), back: cloth(b, 3), top: layer(cloth(b, 4, false), (p) => p.vline(4, 0, p.height, b[2]!)) },
      torso: { front: ribs, back: ribs, left: ribs, top: cloth(b, 4, false) },
      arm: { front: bone, left: bone, top: cloth(b, 5, false) },
      leg: { front: bone, left: bone, top: cloth(b, 5, false), bottom: cloth(b, 2, false) },
    },
    fills: { head: b[4]!, torso: b[4]!, arm: b[4]!, leg: b[4]! },
  });
  parts.push({ name: "pelvis", size: [6, 2, 3], at: [0, 6, 0], box: [-3, -1, -1.5], faces: { front: layer(cloth(b, 4), rows(0, 0, b[5]!)) }, fill: b[4]! });
  parts.push({
    name: "sword",
    parent: "arm.r",
    size: [1, 3, 16],
    at: [0, -6, 0],
    box: [-0.5, -1, 0],
    faces: {
      left: layer(cloth(C.IRON, 4), (p) => {
        p.hline(0, 0, p.width, C.IRON[5]!);
        for (let x = 0; x < 4; x++) p.vline(x, 0, p.height, C.WOOD[3]!);
        p.vline(4, 0, p.height, C.GOLD[2]!);
        p.put(9, 2, C.FIRE[0]!);
        p.put(12, 0, C.IRON[1]!);
      }),
      top: layer(cloth(C.IRON, 5, false), (p) => p.box(0, 0, 1, 4, C.WOOD[3]!)),
    },
    fill: C.IRON[4]!,
  });
  return { name: "skeleton", parts, stride: 0.8, armSwing: 0.5 };
}

/** A ghoul: hunched and grey-green, with sunken glowing eyes, ragged clothes and long clawed arms. */
export function ghoul(): FigureSpec {
  const g = C.GHOUL;
  const rag = C.DARKWOOD;
  const face: Paint = layer(
    cloth(g, 4, false),
    stamp(
      [
        ".hh.h..h.hh",
        "...........",
        ".ddd...ddd.",
        ".dYd...dYd.",
        "...........",
        ".....d.....",
        ".KWKWKWKWK.",
        "..KKKKKKK..",
        "...........",
      ],
      { h: g[1]!, d: g[2]!, Y: GHOUL_EYE, K, W: C.BONE[4]! },
      0,
      0,
    ),
  );
  const ragged: Paint = layer(cloth(rag, 3), (p) => {
    for (let x = 0; x < p.width; x++) if (x % 3 === 1) p.put(x, p.height - 1, 0, 0);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x * 7 + y * 3) % 11 === 0) p.put(x, y, g[3]!);
  });
  const arm: Paint = layer(cloth(g, 3), rows(0, 2, rag[3]!), (p) => {
    for (let x = 0; x < p.width; x++) p.put(x, p.height - 1, x % 2 ? C.BONE[4]! : K);
  });
  const parts = humanoid({
    head: [11, 9, 9],
    torso: [10, 7, 6],
    arm: [3, 11, 3],
    leg: [3, 5, 3],
    faces: {
      head: { front: face, left: layer(cloth(g, 3, false), rows(0, 1, g[1]!)), back: layer(cloth(g, 3), rows(0, 2, g[1]!)), top: layer(cloth(g, 4, false), stamp(["h.h", ".h."], { h: g[1]! }, 3, 2)) },
      torso: { front: ragged, back: ragged, left: ragged, top: cloth(rag, 4, false) },
      arm: { front: arm, left: arm, top: cloth(rag, 3, false) },
      leg: legFaces(rag, g, 3),
    },
    fills: { head: g[4]!, torso: rag[3]!, arm: g[3]!, leg: rag[3]! },
  });
  const head = parts.find((p) => p.name === "head")!;
  parts[parts.indexOf(head)] = { ...head, tilt: [-0.4, 0], at: [0, 6, 1] };
  return { name: "ghoul", parts, stride: 0.55, armSwing: 0.25, hunch: 0.4 };
}

/** A headscarf from above: cloth with a knot of white dots. */
function scarfTop(ramp: readonly Rgb[]): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) p.set(x, y, (x + y) % 4 === 0 ? 0xfff4dc : y === p.height - 1 ? ramp[2]! : ramp[3]!);
  };
}

/** A townswoman at the market stall: a headscarf, a green dress, a white apron. */
export function townswoman(): FigureSpec {
  const hair = C.HAIR_BROWN;
  const dress = C.TEAL;
  const scarf = C.RED;
  const face: Paint = layer(
    cloth(S, 4, false),
    stamp(
      [
        "............",
        "............",
        "............",
        "............",
        "..hh....hh..",
        "..KK....KK..",
        "..KK....KK..",
        ".r........r.",
        ".....mm.....",
        "ssssssssssss",
      ],
      { h: hair[2]!, K, r: C.PINK[3]!, m: C.RED[3]!, s: S[3]! },
      0,
      0,
    ),
    hairRows(scarf, (x) => (x === 0 || x === 11 ? 8 : 3)),
    (p) => {
      p.put(1, 3, hair[3]!);
      p.put(10, 3, hair[3]!);
    },
  );
  const parts = humanoid({
    head: [12, 10, 8],
    torso: [10, 7, 6],
    arm: [3, 7, 3],
    leg: [4, 5, 4],
    faces: {
      head: { front: face, left: layer(cloth(S, 4, false), hairRows(scarf, (x) => (x < 5 ? 10 : 4))), back: hairAll(scarf), top: scarfTop(scarf) },
      torso: { front: layer(cloth(dress, 3), (p) => p.box(2, 2, 6, 5, C.CLOTH_WHITE[4]!), rows(1, 1, C.CLOTH_WHITE[3]!)), back: layer(cloth(dress, 3), rows(2, 2, C.CLOTH_WHITE[3]!)), left: cloth(dress, 3), top: cloth(dress, 4, false) },
      arm: { front: layer(cloth(dress, 3), rows(5, 6, S[4]!)), top: cloth(dress, 4, false) },
      leg: { front: layer(cloth(dress, 2), (p) => p.box(1, 0, 3, 4, C.CLOTH_WHITE[3]!), rows(4, 4, C.WOOD[1]!)), left: layer(cloth(dress, 2), rows(4, 4, C.WOOD[1]!)) },
    },
    fills: { head: S[4]!, torso: dress[3]!, arm: dress[3]!, leg: dress[2]! },
  });
  return { name: "townswoman", parts, stride: 0.35, armSwing: 0.4 };
}
