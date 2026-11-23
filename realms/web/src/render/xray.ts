import * as THREE from "three";
import type { Material } from "../art/paint/builder";

// The cut-away for whatever stands between the camera and the player: a house, a tree's crown, a wall - at every heading.
// A circle of whole scene pixels round the player is cut out of the tall scenery that is nearer the camera than the
// player and higher than their knees, so they are never lost behind a building and the rest of it stays. What is cut
// shows what lies behind it (the street, the player), and the outline pass draws the hole's rim in the scenery's own
// darkened color, as it does every silhouette. It is the same in the color pass and the normal pass, so the outlines
// and highlights follow the hole exactly.
//
// Only scenery merged as tall (`cuttable`: buildings, trees, walls - render/sections.ts sorts them) takes the cut; the
// ground, the banks, grass, figures and small props never do. One player at a time: the uniforms are shared.

/** The circle's radius, scene pixels: wider than a figure (about 16 by 24), so their whole silhouette shows. */
export const XRAY_RADIUS = 26;
/** How much nearer the camera than the player's chest scenery must be to be cut (world units along the view). */
const NEARER = 0.55;
/** Scenery lower than this over the player's floor is left (a low wall's foot, a fence). */
const KNEE = 0.5;

/** The uniforms every cuttable material shares: the circle (x, y in target pixels, radius; negative: off), depth, floor. */
export const XRAY = {
  xrayAt: { value: new THREE.Vector3(0, 0, -1) },
  xrayDepth: { value: 0 },
  xrayFloor: { value: 0 },
};

const VERTEX_DECLARE = /* glsl */ `
varying float vXrayDepth;
varying float vXrayY;`;
const VERTEX_SET = /* glsl */ `
vXrayDepth = -mvPosition.z;
vXrayY = (modelMatrix * vec4(transformed, 1.0)).y;`;
const FRAGMENT_DECLARE = /* glsl */ `
uniform vec3 xrayAt;
uniform float xrayDepth;
uniform float xrayFloor;
varying float vXrayDepth;
varying float vXrayY;`;
/** The test, first thing in the fragment shader's main. */
export const XRAY_TEST = /* glsl */ `
if (xrayAt.z > 0.0 && vXrayY > xrayFloor && vXrayDepth < xrayDepth - ${NEARER.toFixed(3)} && distance(floor(gl_FragCoord.xy) + 0.5, xrayAt.xy) < xrayAt.z) discard;`;

/** Puts the cut into a shader (three's own, after `onBeforeCompile`'s other patches): its uniforms, varyings and test. */
export function xrayShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, XRAY);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>${VERTEX_DECLARE}`)
    .replace("#include <project_vertex>", `#include <project_vertex>${VERTEX_SET}`);
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>${FRAGMENT_DECLARE}`).replace("void main() {", `void main() {${XRAY_TEST}`);
}

/** For the normal pass's own shader (render/edges.ts): the same declarations, set from `position` there. */
export const XRAY_NORMAL = { vertexDeclare: VERTEX_DECLARE, fragmentDeclare: FRAGMENT_DECLARE, test: XRAY_TEST };

const cuttable = new WeakMap<Material, Material>();

/**
 * The cuttable twin of a scenery material: the same picture and light, its shader with the cut. Made once for each, so
 * a chunk's tall scenery merges by material as before.
 */
export function cuttableOf(m: Material): Material {
  let c = cuttable.get(m);
  if (!c) {
    c = m.clone() as Material;
    c.name = `${m.name}+xray`;
    c.userData = { ...m.userData, xray: true };
    const before = m.onBeforeCompile.bind(m);
    c.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      xrayShader(shader as unknown as Parameters<typeof xrayShader>[0]);
    };
    const key = m.customProgramCacheKey();
    c.customProgramCacheKey = () => `${key}|xray`;
    cuttable.set(m, c);
  }
  return c;
}

/**
 * Aims the cut at the player for the frame: `chest` their middle in the world, `floor` the ground they stand on, the
 * camera as it will draw, the target's size in pixels. `on` false turns it off (indoors it is never wanted: the walls on
 * the camera's side are cut away whole).
 */
export function aimXray(on: boolean, chest: THREE.Vector3, floor: number, camera: THREE.Camera, width: number, height: number): void {
  if (!on) {
    XRAY.xrayAt.value.set(0, 0, -1);
    return;
  }
  const p = chest.clone().project(camera);
  XRAY.xrayAt.value.set(((p.x + 1) / 2) * width, ((p.y + 1) / 2) * height, XRAY_RADIUS);
  XRAY.xrayDepth.value = -chest.clone().applyMatrix4(camera.matrixWorldInverse).z;
  XRAY.xrayFloor.value = floor + KNEE;
}
