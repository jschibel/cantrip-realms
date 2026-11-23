import * as THREE from "three";

// The overworld's materials and light (tech.md, B5, "The pixel-art look"). Every lit surface is a cel material: it
// writes its own color unlit (one of the palette's) and, in the alpha channel, which light band it is in and whether it
// is outlined; the renderer's post pass (render.ts) turns that into the ramp's color for the band and draws the
// outlines. Unlit materials (glows, the ways out, the marker, the sky) write alpha 1 and are shown as their nearest
// palette color.
//
// A band is picked from how much light a surface gets against its own color: lit faces the sun, shade is turned from
// it, shadow is turned away or in a cast shadow. The lights are white and the thresholds sit between the levels they
// give, so a face is one band all over: a top in the sun is lit, a top in shadow or a sunward side is shade, the far side
// is shadow.

/** The share of a surface's own color it shows lit by the sky alone, and by the sun full on. */
const AMBIENT = 0.3;
const SUN = 0.6;
/** Light levels between the bands: above LIT is lit, above SHADE is shade, below is shadow. */
const LIT = 0.62;
const SHADE = 0.4;

const CEL_FRAGMENT = /* glsl */ `
  float celOwn = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float celLight = dot(outgoingLight, vec3(0.299, 0.587, 0.114)) / max(celOwn, 1e-4);
  float celBand = max(CEL_FLOOR, celLight > ${LIT.toFixed(3)} ? 2.0 : celLight > ${SHADE.toFixed(3)} ? 1.0 : 0.0);
  gl_FragColor = vec4(diffuseColor.rgb, (1.0 + celBand + 4.0 * CEL_OUTLINED) / 16.0);
`;

function celCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", CEL_FRAGMENT);
}

export interface CelOptions {
  /** The surface's color, or white to take it from the vertices (or instances). */
  readonly color?: THREE.ColorRepresentation;
  readonly vertexColors?: boolean;
  /** Characters, mobs, props and buildings are outlined; the ground is not. */
  readonly outlined: boolean;
  /**
   * The ground's two tones: lit tops, and shade for everything else - a top in shadow, and the side faces of a step up,
   * which so read as one darker band however small the step. Things standing on it have all three bands.
   */
  readonly ground?: boolean;
}

/** A lit surface in flat bands, flat-shaded so each face is one band. */
export function celMaterial(options: CelOptions): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: options.color ?? "#ffffff", vertexColors: options.vertexColors ?? false, flatShading: true });
  material.defines = { CEL_OUTLINED: options.outlined ? "1.0" : "0.0", CEL_FLOOR: options.ground ? "1.0" : "0.0" };
  material.onBeforeCompile = celCompile;
  return material;
}

/** Light for the open air: the sun, casting shadows over `reach` world units round the middle, and the sky. */
export function lightOutdoors(scene: THREE.Scene, reach: number): void {
  const sun = new THREE.DirectionalLight("#ffffff", SUN * Math.PI);
  sun.position.set(-18, 30, 10);
  sun.castShadow = true;
  // A cast shadow takes a surface down one band, not to the bottom.
  sun.shadow.intensity = 0.5;
  sun.shadow.bias = -0.0005;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: 120 });
  scene.add(sun, sun.target, new THREE.AmbientLight("#ffffff", AMBIENT * Math.PI));
}

/**
 * Light underground: dimmer, so tops are shade and sides shadow, and a pool of light round each lamp (a brazier's
 * fire) where they are lit.
 */
export function lightUnderground(scene: THREE.Scene, lamps: readonly THREE.Vector3[]): void {
  const above = new THREE.DirectionalLight("#ffffff", 0.32 * Math.PI);
  above.position.set(-10, 30, 6);
  scene.add(above, above.target, new THREE.AmbientLight("#ffffff", 0.26 * Math.PI));
  for (const at of lamps.slice(0, 8)) {
    const lamp = new THREE.PointLight("#ffffff", 9, 7, 1.2);
    lamp.position.copy(at);
    scene.add(lamp);
  }
}
