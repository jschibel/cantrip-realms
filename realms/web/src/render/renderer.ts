import * as THREE from "three";
import { normalMaterialFor } from "./edges";
import { OCCLUDE, OCCLUDER_LAYER, type OccluderRun, occluding } from "./occlude";
import type { View } from "./view";

// The slice's renderer: a real 3D scene drawn small and shown in big, clean pixels.
//
// The scene is drawn to a low-resolution target - a texel of every texture is one of its pixels - and the canvas is
// scaled up by a whole number with nearest-neighbour filtering. The camera is orthographic and its view moves only in
// whole pixels - over a frame drawn a margin larger, the camera standing still while it can (`place`) - so nothing
// shimmers or flickers as it follows the player.
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
//
// Out of doors, what stands between the camera and the player fades (render/occlude.ts): the two passes draw only what
// is opaque, a third draws the fading parts of the occluders into a target of their own - the nearest at each pixel,
// with its alpha - and the post pass lays it over the scene, outlines and all, as a ghost of what was there.

const DISTANCE = 120;
/**
 * Scene pixels drawn past each edge of the view: how far the view moves over a drawn frame before the camera is placed
 * again (`place`).
 */
const MARGIN = 32;
const NEAR = 1;
const FAR = 300;

const POST_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform sampler2D tGhost;
uniform sampler2D tGhostDepth;
uniform float ghosts;
uniform vec2 resolution; // the drawn frame's: the view's and its margins
uniform vec2 window; // where the view's lower left corner is in the drawn frame, pixels
uniform float depthRange;
uniform vec3 irisCenter; // x, y in the view's pixels, radius in pixels (negative: no iris)
uniform float fade;
uniform float outlineStrength;
uniform float highlightStrength;

float depthAt(vec2 uv) { return texture2D(tDepth, uv).r * depthRange; }
// The faded occluders' ghost at a pixel: its color and alpha, where it stands in front of the scene (else alpha 0).
vec4 ghostAt(vec2 uv) {
  if (ghosts < 0.5) return vec4(0.0);
  vec4 g = texture2D(tGhost, uv);
  if (g.a <= 0.0 || texture2D(tGhostDepth, uv).r >= texture2D(tDepth, uv).r) return vec4(0.0);
  return g;
}
// The depth a pixel's outline is judged against: a ghost in front counts as there, so the edge where an occluder
// starts to fade is not outlined - unless the pixel itself is under a ghost (then what is behind is outlined as ever).
float edgeDepthAt(vec2 uv, bool under) {
  float d = depthAt(uv);
  if (under || ghosts < 0.5) return d;
  if (ghostAt(uv).a > 0.0) d = min(d, texture2D(tGhostDepth, uv).r * depthRange);
  return d;
}

void main() {
  vec2 px = 1.0 / resolution;
  vec2 vUv = (gl_FragCoord.xy + window) * px;
  vec3 color = texture2D(tColor, vUv).rgb;
  vec4 nk = texture2D(tNormal, vUv);
  float kind = nk.a;
  vec3 n = normalize(nk.rgb * 2.0 - 1.0);
  float d = depthAt(vUv);
  vec4 ghost = ghostAt(vUv);
  bool under = ghost.a > 0.0;

  vec2 offsets[4] = vec2[4](vec2(px.x, 0.0), vec2(-px.x, 0.0), vec2(0.0, px.y), vec2(0.0, -px.y));
  float outline = 0.0;
  float highlight = 0.0;
  // Terrain (kind 0.875) is outlined where it stands in front of markedly farther ground - a terrace's edge - and has
  // no highlights; flat ground and decals (0.5) neither.
  if (kind > 0.85 && kind < 0.9) {
    for (int i = 0; i < 4; i++) {
      float gap = edgeDepthAt(vUv + offsets[i], under) - d;
      if (gap > 0.32) outline = 1.0;
    }
  }
  if (kind > 0.9) {
    for (int i = 0; i < 4; i++) {
      vec2 at = vUv + offsets[i];
      float dn = edgeDepthAt(at, under);
      vec4 nn = texture2D(tNormal, at);
      // In front of something markedly farther (or of nothing): the silhouette. A neighbour a ghost stands over is
      // part of the occluder this pixel belongs to.
      bool ghosted = !under && ghostAt(at).a > 0.0;
      float gap = dn - d;
      if (gap > 0.32 || (nn.a < 0.1 && !ghosted)) outline = 1.0;
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

  // The faded occluders over it all.
  color = mix(color, ghost.rgb, ghost.a);

  if (irisCenter.z >= 0.0) {
    if (distance(gl_FragCoord.xy, irisCenter.xy) > irisCenter.z) color = vec3(0.0);
  }
  color = mix(color, vec3(0.0), fade);
  gl_FragColor = vec4(color, 1.0);
}`;

export class PixelRenderer {
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
  /** The faded occluders: their color and alpha, and their depth. */
  private readonly ghost: THREE.WebGLRenderTarget;
  private readonly post: THREE.ShaderMaterial;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    view: View,
    /** The size to fill, in CSS pixels: the window's by default (the game, the galleries); a box's for a preview. */
    readonly area?: () => { readonly width: number; readonly height: number },
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
    this.ghost = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(2, 2, THREE.FloatType),
    });

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      uniforms: {
        tColor: { value: this.color.texture },
        tDepth: { value: this.color.depthTexture },
        tNormal: { value: this.normals.texture },
        tGhost: { value: this.ghost.texture },
        tGhostDepth: { value: this.ghost.depthTexture },
        ghosts: { value: 0 },
        resolution: { value: new THREE.Vector2(2, 2) },
        window: { value: new THREE.Vector2(MARGIN, MARGIN) },
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
    const box = this.area?.();
    const cssWidth = box?.width ?? window.innerWidth;
    const cssHeight = box?.height ?? window.innerHeight;
    const scale = this.view.scale;
    const even = (n: number) => Math.max(2, Math.ceil(n / 2) * 2);
    const width = even(cssWidth / scale);
    const height = even(cssHeight / scale);
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      const drawnWidth = width + 2 * MARGIN;
      const drawnHeight = height + 2 * MARGIN;
      this.color.setSize(drawnWidth, drawnHeight);
      this.normals.setSize(drawnWidth, drawnHeight);
      this.ghost.setSize(drawnWidth, drawnHeight);
      (this.post.uniforms.resolution!.value as THREE.Vector2).set(drawnWidth, drawnHeight);
    }
    const shownWidth = width * scale;
    const shownHeight = height * scale;
    this.canvas.style.width = `${shownWidth}px`;
    this.canvas.style.height = `${shownHeight}px`;
    if (box) return;
    this.canvas.style.left = `${Math.round((cssWidth - shownWidth) / 2)}px`;
    this.canvas.style.top = `${Math.round((cssHeight - shownHeight) / 2)}px`;
  }

  setView(view: View): void {
    this.view = view;
    this.resize();
  }

  /** Places the camera for the frame as `render` will (for what is aimed by the camera before drawing: the occluder fade). */
  placeCamera(): void {
    this.place();
  }

  /**
   * Places the camera on the view and the focus, the focus rounded to a whole pixel in the camera's frame.
   *
   * The frame is drawn `MARGIN` pixels wider than the view on every side, and the post pass shows the view's part of it
   * (`window`). Snapped, the camera stays where it is while the view moves within that margin: only the window moves,
   * by whole pixels, and the scene is drawn exactly as it was - every edge and texel on the same pixels to the last
   * bit. Moving the camera instead, even by whole pixels, rounds differently at each step, and an edge or a texel's
   * border that runs within a hundredth of a pixel of the pixels' centres - a roof's eave or a row of its tiles, seen
   * from a turned heading, runs along a diagonal of them - would land on some steps and not on others: a line that
   * flickers while the camera follows a walk. The camera is placed again when the view would leave the margin, turns,
   * zooms or glides.
   */
  private place(): void {
    const v = this.view;
    this.camera.rotation.set(-v.pitch, v.yaw, 0);
    this.camera.updateMatrix();

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
    const across = this.focus.dot(right);
    const along = this.focus.dot(up);
    const at = this.focus.clone().addScaledVector(back, DISTANCE);
    let dx = 0;
    let dy = 0;
    if (this.snap) {
      at.addScaledVector(right, Math.round(across / v.wppX) * v.wppX - across).addScaledVector(up, Math.round(along / v.wppY) * v.wppY - along);
      const key = `${v.yaw}:${v.pitch}:${v.wppX}:${v.wppY}`;
      if (this.anchor && this.anchorKey === key) {
        const off = at.clone().sub(this.anchor);
        dx = Math.round(off.dot(right) / v.wppX);
        dy = Math.round(off.dot(up) / v.wppY);
      }
      if (!this.anchor || this.anchorKey !== key || Math.abs(dx) > MARGIN || Math.abs(dy) > MARGIN) {
        this.anchor = at.clone();
        this.anchorKey = key;
        dx = dy = 0;
      }
      this.camera.position.copy(this.anchor);
    } else {
      this.anchor = null;
      this.camera.position.copy(at);
    }
    (this.post.uniforms.window!.value as THREE.Vector2).set(MARGIN + dx, MARGIN + dy);
    const halfW = (this.width / 2 + MARGIN) * v.wppX;
    const halfH = (this.height / 2 + MARGIN) * v.wppY;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Where the snapped camera stands while the view moves over its frame (`place`), and the view it stands for. */
  private anchor: THREE.Vector3 | null = null;
  private anchorKey = "";

  /** Where a point in the world is in the view as last placed: scene pixels from its upper left corner. */
  scenePixel(point: THREE.Vector3): { x: number; y: number } {
    const p = point.clone().project(this.camera);
    const w = this.post.uniforms.window!.value as THREE.Vector2;
    const x = ((p.x + 1) / 2) * (this.width + 2 * MARGIN) - w.x;
    const y = ((p.y + 1) / 2) * (this.height + 2 * MARGIN) - w.y;
    return { x, y: this.height - y };
  }

  /** What the last frame drew: draw calls and triangles over all its passes (shadows, color, normals, post). */
  readonly stats = { calls: 0, triangles: 0 };

  render(scene: THREE.Scene): void {
    this.place();
    const r = this.renderer;
    r.info.autoReset = false;
    r.info.reset();
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

    // The fading pass: the occluders near the player again, only what of them fades, with its light and alpha.
    const ghosts = occluding() && this.drawGhosts(scene);
    this.post.uniforms.ghosts!.value = ghosts ? 1 : 0;

    const iris = this.post.uniforms.irisCenter!.value as THREE.Vector3;
    if (this.iris) {
      const p = this.scenePixel(this.iris.at);
      iris.set(p.x, this.height - p.y, this.iris.radius);
    } else {
      iris.set(0, 0, -1);
    }
    this.post.uniforms.fade!.value = this.fade;
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
    this.stats.calls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
  }

  /**
   * Draws the fading parts of the occluders fading this frame into the ghost target; false if none were drawn. Only
   * their own triangles are drawn: each one's run of its merged mesh, as a draw group for the pass.
   */
  private drawGhosts(scene: THREE.Scene): boolean {
    const r = this.renderer;
    const fading = new Set(OCCLUDE.occFading.value);
    const hidden: THREE.Object3D[] = [];
    const grouped: { mesh: THREE.Mesh; material: THREE.Material }[] = [];
    scene.traverse((o) => {
      // The lights light the fading pass as they do the scene.
      if ((o as THREE.Light).isLight) o.layers.enable(OCCLUDER_LAYER);
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.layers.isEnabled(OCCLUDER_LAYER) || !mesh.visible) return;
      const runs = (mesh.userData.occluders as readonly OccluderRun[] | undefined)?.filter((run) => fading.has(run.id)) ?? [];
      if (runs.length === 0 || Array.isArray(mesh.material)) {
        mesh.visible = false;
        hidden.push(mesh);
        return;
      }
      for (const run of runs) mesh.geometry.addGroup(run.start, run.count, 0);
      grouped.push({ mesh, material: mesh.material });
      mesh.material = [mesh.material];
    });
    if (grouped.length > 0) {
      const background = scene.background;
      scene.background = null;
      const shadows = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      const layers = this.camera.layers.mask;
      this.camera.layers.set(OCCLUDER_LAYER);
      OCCLUDE.occGhost.value = 1;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(this.ghost);
      r.clear();
      r.render(scene, this.camera);
      r.setClearColor(0x000000, 1);
      OCCLUDE.occGhost.value = 0;
      this.camera.layers.mask = layers;
      r.shadowMap.autoUpdate = shadows;
      scene.background = background;
    }
    for (const { mesh, material } of grouped) {
      mesh.geometry.clearGroups();
      mesh.material = material;
    }
    for (const o of hidden) o.visible = true;
    return grouped.length > 0;
  }

  /** Where a point in the world is on the page, in CSS pixels. */
  toScreen(point: THREE.Vector3): { x: number; y: number } {
    this.place();
    const p = this.scenePixel(point);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (p.x / this.width) * rect.width, y: rect.top + (p.y / this.height) * rect.height };
  }

  /** The ray under a point on the page. */
  rayAt(x: number, y: number): THREE.Ray {
    this.place();
    const rect = this.canvas.getBoundingClientRect();
    // The view's pixel, then where it is in the drawn frame.
    const w = this.post.uniforms.window!.value as THREE.Vector2;
    const px = ((x - rect.left) / rect.width) * this.width + w.x;
    const py = (1 - (y - rect.top) / rect.height) * this.height + w.y;
    const ndc = new THREE.Vector2((px / (this.width + 2 * MARGIN)) * 2 - 1, (py / (this.height + 2 * MARGIN)) * 2 - 1);
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
