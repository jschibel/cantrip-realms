import * as THREE from "three";
import { type Palette, colorsOf, hexToRgb, shadeOf } from "./palette";

// The overworld's look (tech.md, B5): one idea, big clean pixels. The scene is drawn small - a few screen pixels to
// each of its own - and the canvas is scaled up with no smoothing. Every lit surface writes its palette color and its
// light band (look.ts); the post pass shows each pixel as its ramp's color for that band, and draws a one-pixel dark
// outline round what you look at - characters, mobs, props and buildings - and never on the ground. Nothing is mixed,
// dithered or blurred. The camera is orthographic and dimetric (a 2:1 pixel slope, as isometric pixel art is drawn) and
// moves only in whole pixels, so nothing shimmers as it follows the player.

/** World units each of the scene's pixels covers: a hex, two units across, is 32 pixels wide. */
export const WORLD_PER_PIXEL = 1 / 16;

/** The camera looks down at atan(1/2) below the horizon, turned 45 degrees: a 2:1 pixel slope on the ground. */
const PITCH = Math.atan(0.5);
const YAW = Math.PI / 4;
const DISTANCE = 60;
const NEAR = 1;
const FAR = 200;

/** How the look's two open choices are set: light bands per surface, and the outline's color. */
export interface LookOptions {
  /** Three bands (shadow, shade, lit) or two (shade, lit). */
  readonly bands: 2 | 3;
  /** The palette's near-black, or the darkest color of the outlined thing's own ramp. */
  readonly outline: "dark" | "ramp";
}

/** The look's options, from the page's query (?bands=2, ?outline=ramp) for comparing them; three bands, dark lines. */
export function lookOptions(search = typeof window === "undefined" ? "" : window.location.search): LookOptions {
  const query = new URLSearchParams(search);
  return { bands: query.get("bands") === "2" ? 2 : 3, outline: query.get("outline") === "ramp" ? "ramp" : "dark" };
}

const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
// The palette, one color to a texel in row 0; below it, what each is drawn as: row 1 in shadow, 2 in shade, 3 lit, and
// row 4 the darkest of its ramp (for a ramp-colored outline).
uniform sampler2D tShades;
uniform float paletteSize;
uniform vec2 resolution;
uniform float depthRange;
uniform vec3 outlineColor;
uniform float rampOutline;
varying vec2 vUv;

/** The index of the palette color nearest a color. */
float nearestIndex(vec3 color) {
  float best = 1e9;
  float pick = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= paletteSize) break;
    vec3 candidate = texture2D(tShades, vec2((float(i) + 0.5) / paletteSize, 0.1)).rgb;
    vec3 d = color - candidate;
    float distance = dot(d * d, vec3(0.30, 0.59, 0.11));
    if (distance < best) {
      best = distance;
      pick = float(i);
    }
  }
  return pick;
}

vec3 shade(float index, float row) {
  return texture2D(tShades, vec2((index + 0.5) / paletteSize, (row + 0.5) / 5.0)).rgb;
}

/** A pixel's code from its alpha: 1 is unlit; otherwise its band, and whether it is outlined. */
bool isRaw(float a) { return a > 0.99; }
float codeOf(float a) { return floor(a * 16.0 + 0.5) - 1.0; }
bool isOutlined(float a) { return !isRaw(a) && codeOf(a) >= 4.0; }

void main() {
  vec4 here = texture2D(tColor, vUv);
  float depth = texture2D(tDepth, vUv).r * depthRange;
  vec2 step = 1.0 / resolution;

  // An outline pixel is next to an outlined thing that is in front of it: outside that thing's silhouette, on whatever
  // is behind - the ground (which may rise a little toward the camera at a figure's feet), or another thing well
  // behind. The ground itself never makes an outline.
  bool outlined = isOutlined(here.a);
  float nearestFront = 1e9;
  vec3 source = vec3(0.0);
  vec2 offsets[4] = vec2[4](vec2(step.x, 0.0), vec2(-step.x, 0.0), vec2(0.0, step.y), vec2(0.0, -step.y));
  for (int i = 0; i < 4; i++) {
    vec4 there = texture2D(tColor, vUv + offsets[i]);
    if (!isOutlined(there.a)) continue;
    float d = texture2D(tDepth, vUv + offsets[i]).r * depthRange;
    bool front = outlined ? depth - d > 0.45 : d < depth + 0.3;
    if (front && d < nearestFront) {
      nearestFront = d;
      source = there.rgb;
    }
  }
  if (nearestFront < 1e8) {
    gl_FragColor = vec4(rampOutline > 0.5 ? shade(nearestIndex(source), 4.0) : outlineColor, 1.0);
    return;
  }

  float index = nearestIndex(here.rgb);
  if (isRaw(here.a)) {
    gl_FragColor = vec4(shade(index, 0.0), 1.0);
    return;
  }
  float band = mod(codeOf(here.a), 4.0);
  gl_FragColor = vec4(shade(index, 1.0 + band), 1.0);
}`;

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.OrthographicCamera;
  /** Screen pixels to each of the scene's pixels. */
  scale = 3;
  width = 1;
  height = 1;

  private readonly target: THREE.WebGLRenderTarget;
  private readonly post: THREE.ShaderMaterial;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly focus = new THREE.Vector3();

  constructor(
    readonly canvas: HTMLCanvasElement,
    palette: Palette,
    /** The CSS size to fill: the window's, unless given (a preview canvas). */
    private readonly fit: () => { width: number; height: number } = () => ({ width: window.innerWidth, height: window.innerHeight }),
    look: LookOptions = lookOptions(),
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(-PITCH, YAW, 0);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });

    // The shade table: the palette in row 0, then each color in shadow, shade and lit, then its ramp's darkest.
    const colors = colorsOf(palette);
    const texels = new Uint8Array(colors.length * 5 * 4);
    colors.forEach(({ color, ramp, at }, i) => {
      const rows = [color, shadeOf(ramp, at, 0, look.bands), shadeOf(ramp, at, 1, look.bands), shadeOf(ramp, at, 2, look.bands), ramp[0]!];
      rows.forEach((hex, row) => {
        const o = (row * colors.length + i) * 4;
        texels.set([...hexToRgb(hex), 255], o);
      });
    });
    const shades = new THREE.DataTexture(texels, colors.length, 5, THREE.RGBAFormat);
    shades.magFilter = THREE.NearestFilter;
    shades.minFilter = THREE.NearestFilter;
    shades.needsUpdate = true;

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        tShades: { value: shades },
        paletteSize: { value: colors.length },
        resolution: { value: new THREE.Vector2(1, 1) },
        // Depth runs 0-1 from the camera's near plane to its far one, linearly (the camera is orthographic).
        depthRange: { value: FAR - NEAR },
        outlineColor: { value: new THREE.Color(palette.outline) },
        rampOutline: { value: look.outline === "ramp" ? 1 : 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.resize();
  }

  /** Fits the scene's pixels to the window: as many as fit at the current scale, the canvas stretched over them. */
  resize(): void {
    const { width: cssWidth, height: cssHeight } = this.fit();
    this.scale = Math.min(6, Math.max(2, Math.round(Math.max(cssHeight, 600) / 300)));
    this.width = Math.ceil(cssWidth / this.scale);
    this.height = Math.ceil(cssHeight / this.scale);

    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width * this.scale}px`;
    this.canvas.style.height = `${this.height * this.scale}px`;
    this.target.setSize(this.width, this.height);
    (this.post.uniforms.resolution!.value as THREE.Vector2).set(this.width, this.height);

    const halfWidth = (this.width / 2) * WORLD_PER_PIXEL;
    const halfHeight = (this.height / 2) * WORLD_PER_PIXEL;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.lookAt(this.focus);
  }

  /** Centres the view on a point, rounded to the nearest whole scene pixel along the screen's axes. */
  lookAt(point: THREE.Vector3): void {
    this.focus.copy(point);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
    const across = point.dot(right);
    const along = point.dot(up);
    const snapped = point
      .clone()
      .addScaledVector(right, Math.round(across / WORLD_PER_PIXEL) * WORLD_PER_PIXEL - across)
      .addScaledVector(up, Math.round(along / WORLD_PER_PIXEL) * WORLD_PER_PIXEL - along);
    this.camera.position.copy(snapped).addScaledVector(back, DISTANCE);
    this.camera.updateMatrixWorld();
  }

  render(scene: THREE.Scene): void {
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  /** Where a point in the world is on the page, in CSS pixels from the canvas's top left. */
  toScreen(point: THREE.Vector3): { x: number; y: number } {
    const projected = point.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  /** The ray under a point on the page, in CSS pixels. */
  rayAt(x: number, y: number): THREE.Raycaster {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }
}
