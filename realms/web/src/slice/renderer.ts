import * as THREE from "three";
import { normalMaterialFor } from "./material";

// The slice's renderer: a real 3D scene drawn small and shown in big, clean pixels.
//
// The scene is drawn to a low-resolution target - a texel of every texture is one of its pixels - and the canvas is
// scaled up by a whole number with nearest-neighbour filtering. The camera is orthographic and moves only in whole
// pixels, so nothing shimmers as it follows the player.
//
// One view, three-quarter, as A Link to the Past, Chrono Trigger and Final Fantasy VI draw a town or a room. The camera
// is pitched 45 degrees and its image drawn at 1/sin 45 vertically, so a floor's texel is one pixel - tiles are 16 by 16
// pixels looking north, and nothing is foreshortened, the way those games' tiles are - while the scene stays a true 3D
// scene (light, shadows, depth). It has three headings: north, as those games look, or swung 45 degrees round to
// either side (main.ts); never further, so nothing is ever seen from behind. Doors ease between a street's view and a
// room's closer one.
//
// A second pass draws every surface's facing; the post pass uses it and the depth to draw a soft outline in the
// darkened color of whatever stands in front of something farther, and a bright line on convex edges - the stepped,
// hand-drawn edges pixel artists put on blocks and boxes. It also draws the iris that closes over a doorway.

export interface View {
  /** Turn about the vertical, radians: 0 looks north (towards -z). */
  readonly yaw: number;
  /** Down from the horizon, radians. */
  readonly pitch: number;
  /** World units across one pixel, horizontally and vertically in the camera's frame. */
  readonly wppX: number;
  readonly wppY: number;
  /** Screen pixels to each of the scene's: the zoom. A whole number at rest. */
  readonly scale: number;
}

export const THREE_QUARTER: Omit<View, "scale"> = { yaw: 0, pitch: Math.PI / 4, wppX: 1 / 16, wppY: Math.SQRT1_2 / 16 };

export function blendViews(a: View, b: View, t: number): View {
  const k = t * t * (3 - 2 * t);
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { yaw: mix(a.yaw, b.yaw), pitch: mix(a.pitch, b.pitch), wppX: mix(a.wppX, b.wppX), wppY: mix(a.wppY, b.wppY), scale: mix(a.scale, b.scale) };
}

const DISTANCE = 120;
const NEAR = 1;
const FAR = 300;

const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 resolution;
uniform float depthRange;
uniform vec3 irisCenter; // x, y in pixels, radius in pixels (negative: no iris)
uniform float fade;
uniform float outlineStrength;
uniform float highlightStrength;
varying vec2 vUv;

float depthAt(vec2 uv) { return texture2D(tDepth, uv).r * depthRange; }

void main() {
  vec2 px = 1.0 / resolution;
  vec3 color = texture2D(tColor, vUv).rgb;
  vec4 nk = texture2D(tNormal, vUv);
  float kind = nk.a;
  vec3 n = normalize(nk.rgb * 2.0 - 1.0);
  float d = depthAt(vUv);

  vec2 offsets[4] = vec2[4](vec2(px.x, 0.0), vec2(-px.x, 0.0), vec2(0.0, px.y), vec2(0.0, -px.y));
  float outline = 0.0;
  float highlight = 0.0;
  if (kind > 0.9) {
    for (int i = 0; i < 4; i++) {
      vec2 at = vUv + offsets[i];
      float dn = depthAt(at);
      vec4 nn = texture2D(tNormal, at);
      // In front of something markedly farther (or of nothing): the silhouette.
      float gap = dn - d;
      if (gap > 0.32 || nn.a < 0.1) outline = 1.0;
      // A convex crease: the facing turns, the neighbour is not in front, and it is the side that faces more up and
      // towards the light that is lit (one pixel wide).
      if (nn.a > 0.9 && gap > -0.06) {
        vec3 m = normalize(nn.rgb * 2.0 - 1.0);
        float turn = 1.0 - dot(n, m);
        float facing = dot(n - m, vec3(-0.35, 1.0, 0.45));
        if (turn > 0.15 && facing > 0.04) highlight = max(highlight, 1.0);
      }
    }
  }
  if (outline > 0.5) {
    // A soft outline: the color itself, darkened and pushed to violet, never a flat black.
    color = color * vec3(0.42, 0.38, 0.52) * outlineStrength + color * (1.0 - outlineStrength);
  } else if (highlight > 0.5) {
    color = min(vec3(1.0), color * (1.0 + 0.32 * highlightStrength) + vec3(0.05, 0.045, 0.03) * highlightStrength);
  }

  if (irisCenter.z >= 0.0) {
    vec2 p = floor(vUv * resolution) + 0.5;
    if (distance(p, irisCenter.xy) > irisCenter.z) color = vec3(0.0);
  }
  color = mix(color, vec3(0.0), fade);
  gl_FragColor = vec4(color, 1.0);
}`;

export class SliceRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
  width = 2;
  height = 2;
  view: View;
  /** The point the camera centres on. */
  readonly focus = new THREE.Vector3();
  /** The iris: its centre in the world and its radius in scene pixels; null when open. */
  iris: { at: THREE.Vector3; radius: number } | null = null;
  fade = 0;
  /**
   * Whether the camera snaps to whole pixels. It does at rest and while it follows the player; while it turns from one
   * heading to another it glides, so the turn has no steps in it, and snaps again once it has settled. The pixels stay
   * crisp either way: the target is still drawn small and shown in whole pixels.
   */
  snap = true;

  private readonly color: THREE.WebGLRenderTarget;
  private readonly normals: THREE.WebGLRenderTarget;
  private readonly post: THREE.ShaderMaterial;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    view: View,
  ) {
    this.view = view;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera.rotation.order = "YXZ";
    canvas.style.imageRendering = "pixelated";

    this.color = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(2, 2, THREE.FloatType),
    });
    this.normals = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      uniforms: {
        tColor: { value: this.color.texture },
        tDepth: { value: this.color.depthTexture },
        tNormal: { value: this.normals.texture },
        resolution: { value: new THREE.Vector2(2, 2) },
        depthRange: { value: FAR - NEAR },
        irisCenter: { value: new THREE.Vector3(0, 0, -1) },
        fade: { value: 0 },
        outlineStrength: { value: 1 },
        highlightStrength: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.resize();
  }

  /** Outline and highlight strengths, 0 to 1: for comparing by eye (?outline=0). */
  setEdges(outline: number, highlight: number): void {
    this.post.uniforms.outlineStrength!.value = outline;
    this.post.uniforms.highlightStrength!.value = highlight;
  }

  /** Fits the target to the window at the view's zoom: an even number of scene pixels each way, the canvas over them. */
  resize(): void {
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;
    const scale = this.view.scale;
    const even = (n: number) => Math.max(2, Math.ceil(n / 2) * 2);
    const width = even(cssWidth / scale);
    const height = even(cssHeight / scale);
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      this.color.setSize(width, height);
      this.normals.setSize(width, height);
      (this.post.uniforms.resolution!.value as THREE.Vector2).set(width, height);
    }
    const shownWidth = width * scale;
    const shownHeight = height * scale;
    this.canvas.style.width = `${shownWidth}px`;
    this.canvas.style.height = `${shownHeight}px`;
    this.canvas.style.left = `${Math.round((cssWidth - shownWidth) / 2)}px`;
    this.canvas.style.top = `${Math.round((cssHeight - shownHeight) / 2)}px`;
  }

  setView(view: View): void {
    this.view = view;
    this.resize();
  }

  /** Places the camera on the view and the focus, the focus rounded to a whole pixel in the camera's frame. */
  private place(): void {
    const v = this.view;
    this.camera.rotation.set(-v.pitch, v.yaw, 0);
    this.camera.updateMatrix();
    const halfW = (this.width / 2) * v.wppX;
    const halfH = (this.height / 2) * v.wppY;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
    const across = this.focus.dot(right);
    const along = this.focus.dot(up);
    this.camera.position.copy(this.focus).addScaledVector(back, DISTANCE);
    if (this.snap) {
      this.camera.position
        .addScaledVector(right, Math.round(across / v.wppX) * v.wppX - across)
        .addScaledVector(up, Math.round(along / v.wppY) * v.wppY - along);
    }
    this.camera.updateMatrixWorld();
  }

  render(scene: THREE.Scene): void {
    this.place();
    const r = this.renderer;
    r.setRenderTarget(this.color);
    r.render(scene, this.camera);

    // The normal pass: every mesh in its normal stand-in, no shadows or lights needed.
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      if (!Array.isArray(mesh.material) && mesh.material.userData.skipNormal) {
        mesh.visible = false;
        hidden.push(mesh);
        return;
      }
      this.swapped.push({ mesh, material: mesh.material });
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(normalMaterialFor) : normalMaterialFor(mesh.material);
    });
    const background = scene.background;
    scene.background = null;
    const shadows = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setClearColor(0x8080ff, 0);
    r.setRenderTarget(this.normals);
    r.clear();
    r.render(scene, this.camera);
    r.setClearColor(0x000000, 1);
    r.shadowMap.autoUpdate = shadows;
    scene.background = background;
    for (const { mesh, material } of this.swapped) mesh.material = material;
    this.swapped.length = 0;
    for (const o of hidden) o.visible = true;

    const iris = this.post.uniforms.irisCenter!.value as THREE.Vector3;
    if (this.iris) {
      const p = this.iris.at.clone().project(this.camera);
      iris.set(((p.x + 1) / 2) * this.width, ((p.y + 1) / 2) * this.height, this.iris.radius);
    } else {
      iris.set(0, 0, -1);
    }
    this.post.uniforms.fade!.value = this.fade;
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }

  /** Where a point in the world is on the page, in CSS pixels. */
  toScreen(point: THREE.Vector3): { x: number; y: number } {
    this.place();
    const p = point.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** The ray under a point on the page. */
  rayAt(x: number, y: number): THREE.Ray {
    this.place();
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    const caster = new THREE.Raycaster();
    caster.setFromCamera(ndc, this.camera);
    return caster.ray;
  }

  /** Reads the last frame's scene pixels (for the walking clips), top row first. */
  readFrame(scene: THREE.Scene): { width: number; height: number; rgba: Uint8Array } {
    this.render(scene);
    const gl = this.renderer.getContext();
    const out = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    const flipped = new Uint8Array(out.length);
    const row = this.width * 4;
    for (let y = 0; y < this.height; y++) flipped.set(out.subarray(y * row, (y + 1) * row), (this.height - 1 - y) * row);
    return { width: this.width, height: this.height, rgba: flipped };
  }
}
