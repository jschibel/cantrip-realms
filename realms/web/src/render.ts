import * as THREE from "three";
import { type Palette, toRgb } from "./palette";

// The overworld's look (tech.md, B5): the scene is drawn small - a few screen pixels to each of its own - and every
// pixel is then put through a post pass that dithers it to the plane's palette and outlines silhouettes, before the
// canvas is scaled up with no smoothing. The camera is orthographic and dimetric (a 2:1 pixel slope, as isometric
// pixel art is drawn) and moves only in whole pixels, so nothing shimmers as it follows the player.

/** World units each of the scene's pixels covers: a hex, two units across, is 32 pixels wide. */
export const WORLD_PER_PIXEL = 1 / 16;

/** The camera looks down at atan(1/2) below the horizon, turned 45 degrees: a 2:1 pixel slope on the ground. */
const PITCH = Math.atan(0.5);
const YAW = Math.PI / 4;
const DISTANCE = 60;

const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tPalette;
uniform float paletteSize;
uniform vec2 resolution;
uniform float dither;
uniform float depthEdge;
varying vec2 vUv;

const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);

vec3 nearest(vec3 color) {
  float best = 1e9;
  vec3 pick = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (float(i) >= paletteSize) break;
    vec3 candidate = texture2D(tPalette, vec2((float(i) + 0.5) / paletteSize, 0.5)).rgb;
    vec3 d = color - candidate;
    float distance = dot(d * d, vec3(0.30, 0.59, 0.11));
    if (distance < best) {
      best = distance;
      pick = candidate;
    }
  }
  return pick;
}

void main() {
  vec2 pixel = floor(vUv * resolution);
  vec3 color = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).r;

  // A pixel whose neighbour is much farther away is on the silhouette of something nearer: outline it.
  vec2 step = 1.0 / resolution;
  float farther = 0.0;
  farther = max(farther, texture2D(tDepth, vUv + vec2(step.x, 0.0)).r - depth);
  farther = max(farther, texture2D(tDepth, vUv - vec2(step.x, 0.0)).r - depth);
  farther = max(farther, texture2D(tDepth, vUv + vec2(0.0, step.y)).r - depth);
  farther = max(farther, texture2D(tDepth, vUv - vec2(0.0, step.y)).r - depth);

  int index = int(mod(pixel.x, 4.0)) + int(mod(pixel.y, 4.0)) * 4;
  float threshold = BAYER[index] / 16.0 - 0.5;
  vec3 shaded = farther > depthEdge ? color * 0.35 : color + threshold * dither;
  gl_FragColor = vec4(nearest(shaded), 1.0);
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
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(-PITCH, YAW, 0);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });

    const rgb = toRgb(palette);
    const texels = new Uint8Array(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      texels[i * 4] = Math.round(rgb[i * 3]! * 255);
      texels[i * 4 + 1] = Math.round(rgb[i * 3 + 1]! * 255);
      texels[i * 4 + 2] = Math.round(rgb[i * 3 + 2]! * 255);
      texels[i * 4 + 3] = 255;
    }
    const paletteTexture = new THREE.DataTexture(texels, palette.length, 1, THREE.RGBAFormat);
    paletteTexture.magFilter = THREE.NearestFilter;
    paletteTexture.minFilter = THREE.NearestFilter;
    paletteTexture.needsUpdate = true;

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        tPalette: { value: paletteTexture },
        paletteSize: { value: palette.length },
        resolution: { value: new THREE.Vector2(1, 1) },
        dither: { value: 0.09 },
        // Depth runs 0-1 from the camera's near plane to its far one: an edge is a step of half a world unit.
        depthEdge: { value: 0.5 / (200 - 1) },
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
