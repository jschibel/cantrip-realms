import * as THREE from "three";
import type { Material, Model } from "../art/paint/builder";
import type { Rect } from "../world/format";

// The occluder fade: whatever tall thing stands between the camera and the player - a house, a tree's crown, a town
// wall, a shop's awning - fades where it stands in front of them, so the player is never lost behind it. One way of
// seeing past scenery, out of doors.
//
// Which things fade is asked each frame (`aimOccluders`): rays from the player's figure toward the camera, against each
// occluder's own triangles (its box first, to ask few) - the ones they meet stand in front of the player. Their ids go
// to the shaders, and every vertex of an occluder carries its id, its foot's height and its footprints as attributes,
// so a chunk's tall scenery still merges into a mesh a material.
//
// Of an occluder that fades, a fragment fades - over a short gradient, to `FADE_MIN` - only where it stands in front of
// the player: nearer the camera than the player's figure, along the camera's heading (`FRONT_FROM`, `FRONT_TO`). So
// the back of a house never fades for a player standing at its front, and the wall behind a player under an awning
// stays solid while the awning over them fades. Of what stands in front, two parts fade:
// - over the player's own figure on the screen (a box about it, `FIGURE_*`): whatever covers them, whatever it is;
// - what hides the ground round them (`AROUND_*` tiles of their feet) outside the occluder's own footprints, as the
//   camera sees it: the ground under each pixel at the occluder's foot, where it is not ground the occluder stands
//   solid on (`Built.footprints`; by default the rectangle its lowest parts stand on). So the walls and roof rising
//   behind a building's footprint, where the player walks, are seen through round them, and the ground inside a
//   footprint - where nothing is built, as a room is its own place - is never shown.
//
// The color and normal passes draw only what is opaque (`occGhost` 0: a fading fragment is discarded); the renderer
// then draws the occluders again into a target of their own, only their fading fragments (`occGhost` 1), the nearest
// of them at each pixel with its alpha, and the post pass lays that over the scene (render/renderer.ts). So what is
// behind shows through - the player, the street - and nothing is sorted. Only scenery merged as tall
// (render/place.ts) is an occluder; the ground, figures and small props never are. A faded occluder still casts its
// shadow, whole: the shadow pass knows nothing of the fade. One player at a time: the uniforms are shared.

/** How much of an occluder is left where it has faded: a ghost of it. */
export const FADE_MIN = 0.25;
/** Where the fade starts past a footprint's (or the figure's) edge, and how far on it reaches `FADE_MIN`: scene pixels. */
const FADE_FROM = 1;
const FADE_OVER = 7;
/**
 * In front of the player: a point fades whole up to `FRONT_FROM` world units behind the player's feet along the
 * camera's heading, not at all from `FRONT_TO` - past the back of their figure, short of a wall they stand against
 * (half a tile at the front heading, a little over a third at the turned ones).
 */
const FRONT_FROM = 0.1;
const FRONT_TO = 0.3;
/** The player's figure on the screen, scene pixels: half its width, and its height above its feet. */
const FIGURE_HALF_WIDTH = 7;
const FIGURE_HEIGHT = 24;
/** The ground round the player's feet that what stands past a footprint fades over: its radius, and its soft edge (tiles). */
const AROUND_RADIUS = 2;
const AROUND_OVER = 0.75;
/** How many occluders can fade at once (a forest's crowns round the player). */
export const MAX_FADING = 16;
/** The layer the occluders are also on, for their fading pass. */
export const OCCLUDER_LAYER = 1;
/** How near the player an occluder mesh must come to be asked about, world units past its bounds. */
export const OCCLUDER_REACH = 12;

/** The uniforms every occluder shares. */
export const OCCLUDE = {
  /** The ids of the occluders fading this frame; -1 for none. */
  occFading: { value: new Float32Array(MAX_FADING).fill(-1) },
  /** Where the player's feet are. */
  occPlayer: { value: new THREE.Vector3() },
  /** The camera's view direction, and its right and up in the world: a ground offset's pixels on the screen. */
  occView: { value: new THREE.Vector3(0, -1, -1) },
  occRight: { value: new THREE.Vector3(1, 0, 0) },
  occUp: { value: new THREE.Vector3(0, 1, 0) },
  /** World units a scene pixel, across and up. */
  occWpp: { value: new THREE.Vector2(1 / 16, 1 / 16) },
  /** 0: draw what is opaque, drop what fades; 1: draw only what fades, its alpha written. */
  occGhost: { value: 0 },
};

const f = (n: number) => n.toFixed(4);

const VERTEX_DECLARE = /* glsl */ `
attribute vec4 occFoot;
attribute vec4 occFoot2;
attribute vec2 occInfo;
uniform float occFading[${MAX_FADING}];
uniform float occGhost;
varying vec3 vOccWorld;
varying vec4 vOccFoot;
varying vec4 vOccFoot2;
varying float vOccBase;
varying float vOccActive;`;

/** Sets the varyings from the vertex in the world (`world`, a vec3 expression). */
const vertexSet = (world: string) => /* glsl */ `
vOccWorld = ${world};
vOccFoot = occFoot / 16.0;
vOccFoot2 = occFoot2 / 16.0;
vOccBase = occInfo.y;
vOccActive = 0.0;
// The fading ids come first, -1 after them: the first -1 ends the search.
for (int i = 0; i < ${MAX_FADING}; i++) {
  if (occFading[i] < 0.0) break;
  if (abs(occFading[i] - occInfo.x) < 0.5) {
    vOccActive = 1.0;
    break;
  }
}
// The fading pass draws only what fades: the rest is put out of view before it is rasterized.
if (occGhost > 0.5 && vOccActive < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`;

const FRAGMENT_DECLARE = /* glsl */ `
uniform vec3 occPlayer;
uniform vec3 occView;
uniform vec3 occRight;
uniform vec3 occUp;
uniform vec2 occWpp;
uniform float occGhost;
varying vec3 vOccWorld;
varying vec4 vOccFoot;
varying vec4 vOccFoot2;
varying float vOccBase;
varying float vOccActive;
float occAlpha;
// How far a point on the ground lies outside a footprint, in scene pixels on the screen (none: very far).
float occOutside(vec2 h, vec4 r) {
  if (r.x > r.z) return 1e6;
  vec2 d = min(h - r.xy, 0.0) + max(h - r.zw, 0.0);
  vec3 g = vec3(d.x, 0.0, d.y);
  return length(vec2(dot(g, occRight) / occWpp.x, dot(g, occUp) / occWpp.y));
}
// How far a point on the screen (scene pixels from the player's feet, up positive) lies outside their figure: none
// below their feet, where nothing of an occluder covers them.
float occOffFigure(vec2 s) {
  if (s.y < -1.0) return 1e6;
  return length(vec2(max(abs(s.x) - ${f(FIGURE_HALF_WIDTH)}, 0.0), max(s.y - ${f(FIGURE_HEIGHT)}, 0.0)));
}`;

/** First thing in the fragment shader's main: this fragment's alpha, and whether this pass draws it. */
const FRAGMENT_TEST = /* glsl */ `
occAlpha = 1.0;
if (vOccActive > 0.5) {
  // In front of the player: nearer the camera than their figure, along the camera's heading.
  vec3 occFromFeet = vOccWorld - occPlayer;
  float occBehind = dot(occFromFeet, normalize(vec3(occView.x, 0.0, occView.z)));
  float occFront = 1.0 - smoothstep(${f(FRONT_FROM)}, ${f(FRONT_TO)}, occBehind);
  if (occFront > 0.0) {
    // Where this pixel is on the screen from the player's feet, scene pixels.
    vec2 occScreen = vec2(dot(occFromFeet, occRight) / occWpp.x, dot(occFromFeet, occUp) / occWpp.y);
    float occOnFigure = 1.0 - smoothstep(${f(FADE_FROM)}, ${f(FADE_FROM + FADE_OVER)}, occOffFigure(occScreen));
    // Where the ground under this pixel is, at the occluder's foot: over its footprint, or how far past it; and whether
    // it is ground round the player.
    vec2 h = (vOccWorld + ((vOccBase - vOccWorld.y) / occView.y) * occView).xz;
    float past = min(occOutside(h, vOccFoot), occOutside(h, vOccFoot2));
    float occPast = smoothstep(${f(FADE_FROM)}, ${f(FADE_FROM + FADE_OVER)}, past);
    float occAround = 1.0 - smoothstep(${f(AROUND_RADIUS)}, ${f(AROUND_RADIUS + AROUND_OVER)}, length(h - occPlayer.xz));
    occAlpha = mix(1.0, ${f(FADE_MIN)}, occFront * max(occOnFigure, occPast * occAround));
  }
}
if (occGhost > 0.5 ? occAlpha > 0.999 : occAlpha < 0.999) discard;`;

/** Last thing: in the fading pass, the alpha. */
const FRAGMENT_END = /* glsl */ `
if (occGhost > 0.5) gl_FragColor.a = occAlpha;`;

/** Puts the fade into a shader (three's own, after `onBeforeCompile`'s other patches). */
export function occluderShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, OCCLUDE);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>${VERTEX_DECLARE}`)
    .replace("#include <project_vertex>", `#include <project_vertex>${vertexSet("(modelMatrix * vec4(transformed, 1.0)).xyz")}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>${FRAGMENT_DECLARE}`)
    .replace("void main() {", `void main() {${FRAGMENT_TEST}`)
    .replace("#include <dithering_fragment>", `#include <dithering_fragment>${FRAGMENT_END}`);
}

/** For the normal pass's own shader (render/edges.ts): the declarations, the varyings set from `position`, the test. */
export const OCCLUDE_NORMAL = {
  vertexDeclare: VERTEX_DECLARE,
  vertexSet: vertexSet("(modelMatrix * vec4(position, 1.0)).xyz"),
  fragmentDeclare: FRAGMENT_DECLARE,
  test: FRAGMENT_TEST,
};

const twins = new WeakMap<Material, Material>();

/** The occluder twin of a scenery material: the same picture and light, with the fade. Made once for each. */
export function occluderOf(m: Material): Material {
  let c = twins.get(m);
  if (!c) {
    c = m.clone() as Material;
    c.name = `${m.name}+occluder`;
    c.userData = { ...m.userData, occluder: true };
    const before = m.onBeforeCompile.bind(m);
    c.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      occluderShader(shader as unknown as Parameters<typeof occluderShader>[0]);
    };
    const key = m.customProgramCacheKey();
    c.customProgramCacheKey = () => `${key}|occluder`;
    twins.set(m, c);
  }
  return c;
}

// --- Which occluders stand in front of the player -----------------------------------------------------------------------

/** One occluder's triangles in a merged mesh: its id, its box, and its run of the mesh's index. */
export interface OccluderRun {
  readonly id: number;
  readonly box: THREE.Box3;
  readonly start: number;
  readonly count: number;
}

/** Where the rays to the camera start, about the player's feet: their feet, middle, head and either side. */
const RAY_STARTS: readonly (readonly [number, number])[] = [
  [0, 0.3],
  [0, 0.9],
  [0, 1.5],
  [-0.25, 0.9],
  [0.25, 0.9],
];

/**
 * Aims the fade at the player for the frame: `feet` where they stand, the camera as it will draw, world units a scene
 * pixel, the scene whose occluders are asked. `on` false turns it off (indoors it is never wanted: the walls on the
 * camera's side are cut away whole). Returns how many occluders fade.
 */
export function aimOccluders(on: boolean, feet: THREE.Vector3, camera: THREE.Camera, wppX: number, wppY: number, scene: THREE.Object3D): number {
  const fading = OCCLUDE.occFading.value;
  fading.fill(-1);
  if (!on) return 0;
  OCCLUDE.occPlayer.value.copy(feet);
  const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  OCCLUDE.occView.value.copy(view);
  OCCLUDE.occRight.value.copy(right);
  OCCLUDE.occUp.value.set(0, 1, 0).applyQuaternion(camera.quaternion);
  OCCLUDE.occWpp.value.set(wppX, wppY);
  const toward = view.clone().negate();
  const rays = RAY_STARTS.map(([side, up]) => new THREE.Ray(feet.clone().addScaledVector(right, side).add(new THREE.Vector3(0, up, 0)), toward));
  const found = new Set<number>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const runs = mesh.userData?.occluders as readonly OccluderRun[] | undefined;
    if (!runs || !mesh.visible) return;
    const sphere = mesh.geometry.boundingSphere;
    if (sphere && Math.hypot(sphere.center.x - feet.x, sphere.center.z - feet.z) > sphere.radius + OCCLUDER_REACH) return;
    for (const run of runs) {
      if (found.has(run.id) || !rays.some((r) => r.intersectsBox(run.box))) continue;
      if (meetsRun(mesh.geometry, run, rays)) found.add(run.id);
    }
  });
  let k = 0;
  for (const id of found) {
    if (k >= MAX_FADING) break;
    fading[k++] = id;
  }
  return k;
}

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const HIT = new THREE.Vector3();

/** Whether any of the rays meets one of a run's triangles in front of where it starts (toward the camera). */
function meetsRun(geometry: THREE.BufferGeometry, run: OccluderRun, rays: readonly THREE.Ray[]): boolean {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const index = geometry.getIndex()!;
  for (let t = run.start; t < run.start + run.count; t += 3) {
    A.fromBufferAttribute(position, index.getX(t));
    B.fromBufferAttribute(position, index.getX(t + 1));
    C.fromBufferAttribute(position, index.getX(t + 2));
    for (const r of rays) if (r.intersectTriangle(A, B, C, false, HIT) && HIT.distanceToSquared(r.origin) > 1e-6) return true;
  }
  return false;
}

/** Whether any occluder fades this frame. */
export function occluding(): boolean {
  return OCCLUDE.occFading.value[0]! >= 0;
}

// --- An occluder's shape ------------------------------------------------------------------------------------------------

/** What an occluder is: its id, up to two footprints, its box and its foot's height. */
export interface Occluder {
  readonly id: number;
  readonly feet: readonly [Rect, Rect | null];
  readonly box: THREE.Box3;
}

const NO_RECT: Rect = [1, 0, 0, 0];

/**
 * Footprints as at most two rectangles: the nearest two merged - those that touch first, and of them the two whose
 * union grows least - until two are left. So the gap a gate leaves between two runs of wall stays open.
 */
export function twoRects(rects: readonly Rect[]): readonly [Rect, Rect | null] {
  const list = rects.map((r) => [...r] as [number, number, number, number]);
  const area = (r: readonly number[]) => (r[2]! - r[0]!) * (r[3]! - r[1]!);
  const union = (a: readonly number[], b: readonly number[]): [number, number, number, number] => [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.max(a[2]!, b[2]!), Math.max(a[3]!, b[3]!)];
  const apart = (a: readonly number[], b: readonly number[]) => Math.max(0, a[0]! - b[2]!, b[0]! - a[2]!, a[1]! - b[3]!, b[1]! - a[3]!);
  while (list.length > 2) {
    let best = [0, 1];
    let cost = [Infinity, Infinity];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const gap = apart(list[i]!, list[j]!);
        const g = area(union(list[i]!, list[j]!)) - area(list[i]!) - area(list[j]!);
        if (gap < cost[0]! || (gap === cost[0] && g < cost[1]!)) {
          cost = [gap, g];
          best = [i, j];
        }
      }
    }
    const [i, j] = best as [number, number];
    list[i] = union(list[i]!, list[j]!);
    list.splice(j, 1);
  }
  return [list[0] ?? NO_RECT, list[1] ?? null];
}

/** How far above its lowest point a model's parts count as what it stands on (its default footprint). */
const FOOT = 0.25;
let nextId = 1;

/** A model as an occluder, with an id of its own: its footprints (given, or the rectangle its lowest parts stand on) and its box. */
export function occluderOfModel(model: Model, footprints?: readonly Rect[]): Occluder | null {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const part of model.parts) {
    for (let i = 0; i < part.positions.length; i += 3) box.expandByPoint(p.set(part.positions[i]!, part.positions[i + 1]!, part.positions[i + 2]!));
  }
  if (box.isEmpty()) return null;
  let feet = footprints;
  if (!feet) {
    const base: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const part of model.parts) {
      const q = part.positions;
      for (let i = 0; i < q.length; i += 3) {
        if (q[i + 1]! > box.min.y + FOOT) continue;
        base[0] = Math.min(base[0], q[i]!);
        base[1] = Math.min(base[1], q[i + 2]!);
        base[2] = Math.max(base[2], q[i]!);
        base[3] = Math.max(base[3], q[i + 2]!);
      }
    }
    feet = [base];
  }
  return { id: nextId++, feet: twoRects(feet), box };
}

export interface OccluderArrays {
  readonly foot: Int16Array;
  readonly foot2: Int16Array;
  readonly info: Float32Array;
}

export function occluderArrays(vertices: number): OccluderArrays {
  return { foot: new Int16Array(vertices * 4), foot2: new Int16Array(vertices * 4), info: new Float32Array(vertices * 2) };
}

/** The occluder attributes of `count` vertices from `at`: its footprints in sixteenths of a tile, its id and foot. */
export function fillOccluder(arrays: OccluderArrays, at: number, count: number, o: Occluder | null): void {
  const q = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 16)));
  const a = o?.feet[0] ?? NO_RECT;
  const b = o?.feet[1] ?? NO_RECT;
  for (let v = at; v < at + count; v++) {
    for (let k = 0; k < 4; k++) {
      arrays.foot[v * 4 + k] = q(a[k]!);
      arrays.foot2[v * 4 + k] = q(b[k]!);
    }
    arrays.info[v * 2] = o?.id ?? -2;
    arrays.info[v * 2 + 1] = o?.box.min.y ?? 0;
  }
}

/** Sets an occluder mesh's attributes and its runs (`userData.occluders`), and puts it on the occluders' layer too. */
export function setOccluder(mesh: THREE.Mesh, arrays: OccluderArrays, runs: readonly OccluderRun[]): void {
  mesh.geometry.setAttribute("occFoot", new THREE.BufferAttribute(arrays.foot, 4));
  mesh.geometry.setAttribute("occFoot2", new THREE.BufferAttribute(arrays.foot2, 4));
  mesh.geometry.setAttribute("occInfo", new THREE.BufferAttribute(arrays.info, 2));
  mesh.userData.occluders = runs;
  mesh.layers.enable(OCCLUDER_LAYER);
}
