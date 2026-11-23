import * as THREE from "three";
import type { Pixmap } from "./pixmap";

// Materials for the slice: textures painted by code shown texel for texel, lit in a few stepped bands.
//
// Each lit material is three's Lambert with two changes: the light is gathered on white (so it is the light alone, with
// the sun's shadow in it), and before it meets the texture its brightness is snapped to one of a few bands while its
// hue is kept - warm where the sun falls, cool in the shade, orange round a fire. So a surface shows its texture in one,
// two or three flat tones, never a gradient, and the colors stay rich: a shadow is the texture in violet-blue light,
// not the texture darkened to grey.

/** Brightness thresholds between the bands and the brightness each band is shown at. */
const BAND_EDGES = [0.34, 0.6, 0.92, 1.25] as const;
const BAND_LEVELS = [0.34, 0.6, 0.84, 1.0, 1.14] as const;

const BAND_GLSL = /* glsl */ `
  vec3 sliceLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float sliceLum = max(dot(sliceLight, vec3(0.299, 0.587, 0.114)), 1e-4);
  float sliceBand = sliceLum < ${BAND_EDGES[0].toFixed(3)} ? ${BAND_LEVELS[0].toFixed(3)}
    : sliceLum < ${BAND_EDGES[1].toFixed(3)} ? ${BAND_LEVELS[1].toFixed(3)}
    : sliceLum < ${BAND_EDGES[2].toFixed(3)} ? ${BAND_LEVELS[2].toFixed(3)}
    : sliceLum < ${BAND_EDGES[3].toFixed(3)} ? ${BAND_LEVELS[3].toFixed(3)} : ${BAND_LEVELS[4].toFixed(3)};
  // The hue of the light, at the band's brightness; a strongly colored light (a fire) keeps its color.
  vec3 sliceTint = sliceLight / sliceLum;
  outgoingLight = diffuseColor.rgb * sliceTint * sliceBand + totalEmissiveRadiance;
  gl_FragColor = vec4(outgoingLight, diffuseColor.a);
`;

/** The texels per world unit everything is painted at: a tile, one unit square, is 16 texels across. */
export const TEXELS = 16;

/** A pixmap as a texture shown in hard texels, its first row at the top (v = 1). */
export function textureOf(pixmap: Pixmap, repeat = true): THREE.DataTexture {
  const { width, height } = pixmap;
  const flipped = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    flipped.set(pixmap.data.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
  }
  const texture = new THREE.DataTexture(flipped, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export interface LitOptions {
  /** Cut out texels below half alpha (foliage fringes, cobwebs, the sign's chains). */
  readonly cutout?: boolean;
  /** Smooth normals (a barrel, a tree's crown): the bands then step round the curve. */
  readonly smooth?: boolean;
  /** Seen from both sides (a banner, a leaf card). */
  readonly twoSided?: boolean;
  /** Gives off its own light at this strength of its texture (a window at night, embers). */
  readonly glow?: number;
  /** Not outlined, and drawn under the outline pass's notice (ground decals). */
  readonly flat?: boolean;
}

/** Turns a Lambert shader's light into the banded light (for materials that patch their shaders further). */
export function bandShader(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <lights_lambert_fragment>", "LambertMaterial material;\nmaterial.diffuseColor = vec3(1.0);\nmaterial.specularStrength = 1.0;")
    .replace("#include <opaque_fragment>", BAND_GLSL);
}

function patch(material: THREE.MeshLambertMaterial): void {
  material.onBeforeCompile = bandShader;
}

/** A lit, banded material showing a texture (or a flat color). */
export function lit(map: THREE.Texture | null, options: LitOptions = {}, color: THREE.ColorRepresentation = "#ffffff"): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map,
    color,
    flatShading: !options.smooth,
    alphaTest: options.cutout ? 0.5 : 0,
    side: options.twoSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (options.glow && map) {
    material.emissive = new THREE.Color("#ffffff");
    material.emissiveMap = map;
    material.emissiveIntensity = options.glow;
  }
  material.userData.flat = options.flat ?? false;
  patch(material);
  return material;
}

/** A material that shows its texture at full strength whatever the light: fire, a lit window's glass, the iris. */
export function glow(map: THREE.Texture, cutout = false): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ map, alphaTest: cutout ? 0.5 : 0, side: THREE.DoubleSide });
  material.userData.glow = true;
  return material;
}

// The normal pass: each surface's facing, in view space, for the post pass to find convex edges and outline what
// stands in front. Cut-out materials keep their cut-outs; a flat material writes a zero kind so it is never outlined.
const NORMAL_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NORMAL_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float cutout;
uniform float kind;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  if (cutout > 0.5 && texture2D(map, vUv).a < 0.5) discard;
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(n * 0.5 + 0.5, kind);
}`;

const normals = new WeakMap<THREE.Material, THREE.ShaderMaterial>();

/** The normal-pass stand-in for a material, made once for each. */
export function normalMaterialFor(material: THREE.Material): THREE.ShaderMaterial {
  let n = normals.get(material);
  if (!n) {
    const source = material as THREE.MeshLambertMaterial;
    const cutout = (source.alphaTest ?? 0) > 0 && !!source.map;
    n = new THREE.ShaderMaterial({
      vertexShader: NORMAL_VERTEX,
      fragmentShader: NORMAL_FRAGMENT,
      uniforms: {
        map: { value: cutout ? source.map : null },
        cutout: { value: cutout ? 1 : 0 },
        kind: { value: material.userData.flat ? 0.5 : material.userData.glow ? 0.75 : 1 },
      },
      side: material.side,
    });
    normals.set(material, n);
  }
  return n;
}
