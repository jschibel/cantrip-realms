import * as THREE from "three";
import { type Material, type Model, type ModelPart, meshesOf, mergeModels } from "../art/paint/builder";
import type { Built, Cutaway, LightSpec } from "../art/recipe";
import type { LightData, Rect } from "../world/format";
import type { GrassField } from "./grass";
import { type Flicker, addLight, stepFlicker, sunlight } from "./lights";
import { cuttableOf } from "./xray";

// A place as the renderer holds it: one scene - a street with its country, a room - with its ground, its scenery merged
// into a handful of meshes, what moves in it (flames, sliding water, grass in the wind, a cut-away that drops while
// the player stands behind it or the camera looks across it) and its lights. Figures are stood in it and taken out by
// whoever moves them (`addFigure`). The renderer draws `scene`; the page calls `update` each frame with the clock and
// the camera's turn, and `follow` with where the player is.
//
// A place is made of sections: what was built together and goes together - a room is one, the world one a chunk
// (render/chunks.ts streams them in and out). The place's own methods (`addGround`, `addPieces`, `addLight`,
// `addGrass`) add to its first section, which is the scene itself; `section(key)` makes another, `removeSection(key)`
// takes it out and frees what it alone holds.
//
// A chunk's moving parts are merged too (`addMoving(pieces, true)`): its buildings' cut-aways for the player into one
// group a material, re-merged without the ones dropped while the player stands behind them (a few such sets kept), and
// its flames - all burning in step anyway - into one group a frame. Its trees and hedgerows have far stand-ins
// (`Built.far`), merged apart and shown instead of them at the furthest zoom (`setDetail`).
//
// Out of doors at world scale the place pools its lights (`poolLights`): the fires and lamps of every chunk are specs,
// and a fixed set of lights takes the nearest of them each frame - so streaming a chunk in or out never changes how many
// lights the shaders are compiled for. Its sun follows the camera (`followSun`), its shadows always round the view.

/** A cut-away as meshes: the whole and the cut-down, and when the cut-down one shows. */
interface LiveCutaway {
  readonly full: THREE.Group;
  readonly low: THREE.Group;
  readonly when: Cutaway["when"];
}

/**
 * A chunk's cut-aways for the player, merged: the whole of every one not dropped in one group a material, a group for
 * each set of them dropped (made when first wanted, the last few kept), and each one's cut-down cap.
 */
interface MergedCutaways {
  readonly fulls: readonly Model[];
  readonly rects: readonly Rect[];
  readonly lows: readonly THREE.Group[];
  /** The whole ones, by the set dropped ("": none, kept always), the most recently shown last. */
  readonly groups: Map<string, THREE.Group>;
  shown: string;
}

/** How many sets of dropped cut-aways a chunk keeps merged besides the one with none dropped. */
const KEPT_SETS = 3;

/** Small props: what the furthest zoom leaves out, a prop no bigger than this (world units) each way. */
const DETAIL_SIZE = 1.05;
const DETAIL_HEIGHT = 1.35;
/** Tall enough to stand between the camera and the player: what the x-ray cuts (render/xray.ts). */
const TALL = 1.6;

export class Section {
  readonly frames: { readonly groups: THREE.Group[]; readonly rate: number }[] = [];
  readonly cutaways: LiveCutaway[] = [];
  readonly flickers: Flicker[] = [];
  readonly scrolls: Material[] = [];
  readonly grass: GrassField[] = [];
  /** Shown only near: small props and standing grass. */
  readonly detail: THREE.Object3D[] = [];
  /** What has a far stand-in: shown near (with the detail), its stand-ins (`far`) at the furthest zoom instead. */
  readonly near: THREE.Object3D[] = [];
  readonly far: THREE.Object3D[] = [];
  /** The player's cut-aways merged (world chunks: `addMoving(pieces, true)`). */
  readonly merged: MergedCutaways[] = [];
  /** Lights given to the place's pool instead of made (world scale). */
  readonly pooled: LightData[] = [];

  constructor(
    readonly root: THREE.Object3D,
    private readonly owner: Place,
  ) {}

  add(o: THREE.Object3D): void {
    this.root.add(o);
  }

  addGround(mesh: THREE.Object3D): void {
    this.add(mesh);
  }

  /**
   * Cut-aways and flames of pieces, each their own meshes - or, `merge`d (a world chunk: many buildings, many fires),
   * the cut-aways for the player as one group a material and the flames as one group a frame (see `MergedCutaways`).
   */
  addMoving(pieces: readonly Built[], merge = false): void {
    if (merge) {
      const fulls: Model[] = [];
      const rects: Rect[] = [];
      const lows: THREE.Group[] = [];
      const fires = new Map<string, { models: Model[][]; rate: number }>();
      for (const piece of pieces) {
        for (const c of piece.cutaways ?? []) {
          if (!("player" in c.when)) continue;
          fulls.push(c.full);
          rects.push(c.when.player);
          const low = meshesOf(c.low, "cutaway-low");
          low.visible = false;
          this.add(low);
          lows.push(low);
        }
        for (const f of piece.frames ?? []) {
          // Flames step together (floor(time * rate) % frames): those alike merge frame by frame.
          const key = `${f.rate}:${f.models.length}`;
          let fire = fires.get(key);
          if (!fire) fires.set(key, (fire = { models: f.models.map(() => []), rate: f.rate }));
          f.models.forEach((m, i) => fire!.models[i]!.push(m));
        }
      }
      if (fulls.length > 0) {
        const all = mergedMeshes(fulls, "cutaways", true);
        this.add(all);
        this.merged.push({ fulls, rects, lows, groups: new Map([["", all]]), shown: "" });
      }
      for (const { models, rate } of fires.values()) {
        const groups = models.map((ms) => mergedMeshes(ms, "frame", false, false));
        for (const g of groups) this.add(g);
        this.frames.push({ groups, rate });
      }
      pieces = pieces.map((p) => ({ model: p.model, cutaways: p.cutaways?.filter((c) => !("player" in c.when)) }));
    }
    for (const piece of pieces) {
      for (const c of piece.cutaways ?? []) {
        const full = meshesOf(c.full, "cutaway");
        const low = meshesOf(c.low, "cutaway-low");
        low.visible = false;
        this.add(full);
        this.add(low);
        this.cutaways.push({ full, low, when: c.when });
      }
      for (const f of piece.frames ?? []) {
        const groups = f.models.map((m) => meshesOf(m, "frame", false));
        for (const g of groups) this.add(g);
        this.frames.push({ groups, rate: f.rate });
      }
    }
  }

  /**
   * What recipes built, in order: their cut-aways and flames are made first, each its own meshes, then every piece's
   * still geometry merged into one group of meshes - one a material - named `name`.
   */
  addPieces(pieces: readonly Built[], name: string): THREE.Group {
    this.addMoving(pieces);
    const merged = mergeModels(pieces.map((p) => p.model));
    this.noteScrolls(merged);
    const group = meshesOf(merged, name);
    this.add(group);
    return group;
  }

  /**
   * Scenery at world scale, sorted three ways before it is merged (`sortScenery`): what is tall enough to hide the
   * player (cut by the x-ray: render/xray.ts), small props (left out at the furthest zoom), and the rest. Each kind is
   * merged by material. The streamer does the same a group at a time (`addMoving`, then `addMerged` per group).
   */
  addScenery(pieces: readonly Built[], name: string): THREE.Group[] {
    this.addMoving(pieces, true);
    return sortScenery(pieces.map((p) => p.model), name, pieces.map((p) => p.far)).map((g) => this.addMerged(g));
  }

  /**
   * One group of sorted scenery merged by material: tall groups take the x-ray's cut, small ones are detail, near ones
   * give way to their far stand-ins at the furthest zoom.
   */
  addMerged(g: SceneryGroup): THREE.Group {
    const group = mergedMeshes(g.models, g.label, g.kind === "tall");
    for (const m of g.models) this.noteScrolls(m);
    this.add(group);
    if (g.kind === "small") this.detail.push(group);
    else if (g.lod === "near") this.near.push(group);
    else if (g.lod === "far") this.far.push(group);
    return group;
  }

  /** Shows the player's merged cut-aways with those dropped that the player stands behind (`Place.follow`). */
  followMerged(player: { readonly x: number; readonly z: number }): void {
    for (const m of this.merged) {
      const dropped: number[] = [];
      m.rects.forEach(([x0, z0, x1, z1], i) => {
        const inside = player.x > x0 && player.x < x1 && player.z > z0 && player.z < z1;
        m.lows[i]!.visible = inside;
        if (inside) dropped.push(i);
      });
      const key = dropped.join(",");
      if (key === m.shown) continue;
      m.groups.get(m.shown)!.visible = false;
      let group = m.groups.get(key);
      if (group) {
        // The most recently shown last: the oldest goes first.
        m.groups.delete(key);
        m.groups.set(key, group);
      } else {
        group = mergedMeshes(m.fulls.filter((_, i) => !dropped.includes(i)), "cutaways", true);
        this.add(group);
        m.groups.set(key, group);
        for (const [k, old] of m.groups) {
          if (m.groups.size <= KEPT_SETS + 1) break;
          if (k === "" || k === key) continue;
          old.removeFromParent();
          old.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
          m.groups.delete(k);
        }
      }
      group.visible = true;
      m.shown = key;
    }
  }

  private noteScrolls(model: Model): void {
    for (const part of model.parts) if (part.material.userData.scroll && !this.scrolls.includes(part.material)) this.scrolls.push(part.material);
  }

  /** A light of this section; at world scale a fire's or a lamp's goes to the place's pool instead (null then). */
  addLight(spec: LightSpec): THREE.Light | null {
    if (this.owner.pooling && (spec.kind === "point" || spec.kind === "spot")) {
      this.pooled.push(spec);
      return null;
    }
    const holder = new THREE.Scene();
    const { light, flicker } = addLight(holder, spec);
    for (const o of [...holder.children]) this.root.add(o);
    if (flicker) this.flickers.push(flicker);
    return light;
  }

  addGrass(field: GrassField): void {
    this.grass.push(field);
    this.detail.push(field.mesh);
    this.add(field.mesh);
  }

  /** Frees what this section alone holds: its geometry, and the ground's own textures and material. */
  dispose(): void {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const textures = mesh.userData.groundTextures as THREE.Texture[] | undefined;
      if (textures) {
        for (const t of textures) t.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
    });
    this.root.removeFromParent();
  }
}

/** A group of scenery to merge: its kind, its models, and its meshes' name. */
export interface SceneryGroup {
  readonly kind: "tall" | "small" | "rest";
  readonly label: string;
  readonly models: Model[];
  /** What has a far stand-in ("near"), shown near only, and the stand-ins ("far"), shown at the furthest zoom only. */
  readonly lod?: "near" | "far";
}

/** A kind of scenery with more triangles than this is merged in cells of `CELL` tiles, so the view culls it finely. */
const SPLIT_TRIANGLES = 24000;
const CELL = 16;

/**
 * Sorts scenery models into what is tall enough to hide the player, small props, and the rest, each kind one group -
 * or, where a kind is heavy (a forest's trees), one group a cell of 16 by 16 tiles, so what is off screen is culled
 * in smaller pieces and no one merge is a long frame's work. A model with a far stand-in (`fars[i]`, as `Built.far`)
 * goes to a "near" group of its kind and its stand-in to a "far" one - unless it is small, left out far anyway.
 */
export function sortScenery(models: readonly Model[], name: string, fars: readonly (Model | undefined)[] = []): SceneryGroup[] {
  type Entry = { model: Model; at: THREE.Vector3; tris: number };
  type Lod = "" | "near" | "far";
  const kinds: Record<Lod, Record<SceneryGroup["kind"], Entry[]>> = {
    "": { tall: [], small: [], rest: [] },
    near: { tall: [], small: [], rest: [] },
    far: { tall: [], small: [], rest: [] },
  };
  const sort = (m: Model, lod: Lod): SceneryGroup["kind"] | null => {
    const box = boxOf(m);
    if (!box) return null;
    const size = box.getSize(new THREE.Vector3());
    const kind = size.y > TALL ? "tall" : size.x <= DETAIL_SIZE && size.z <= DETAIL_SIZE && size.y <= DETAIL_HEIGHT ? "small" : "rest";
    // Small: left out at the furthest zoom, so it needs no stand-in.
    kinds[kind === "small" && lod === "near" ? "" : lod][kind].push({ model: m, at: box.getCenter(new THREE.Vector3()), tris: m.parts.reduce((n, p) => n + p.indices.length / 3, 0) });
    return kind;
  };
  models.forEach((m, i) => {
    const far = fars[i];
    const kind = sort(m, far ? "near" : "");
    if (far && kind && kind !== "small") sort(far, "far");
  });
  const out: SceneryGroup[] = [];
  for (const lod of ["", "near", "far"] as const) {
    for (const kind of ["rest", "tall", "small"] as const) {
      const list = kinds[lod][kind];
      if (list.length === 0) continue;
      const label = `${kind === "rest" ? name : `${name}:${kind}`}${lod ? `:${lod}` : ""}`;
      const group = (label: string, models: Model[]): SceneryGroup => (lod ? { kind, label, models, lod } : { kind, label, models });
      if (list.reduce((n, e) => n + e.tris, 0) <= SPLIT_TRIANGLES) {
        out.push(group(label, list.map((e) => e.model)));
        continue;
      }
      const cells = new Map<string, Model[]>();
      for (const e of list) {
        const k = `${Math.floor(e.at.x / CELL)},${Math.floor(e.at.z / CELL)}`;
        let c = cells.get(k);
        if (!c) cells.set(k, (c = []));
        c.push(e.model);
      }
      for (const [k, ms] of cells) out.push(group(`${label}@${k}`, ms));
    }
  }
  return out;
}

/**
 * Models merged straight into meshes, one a material in the order materials are first met (as `mergeModels` and
 * `meshesOf` together make them, but into typed arrays at once: a forest's cell of trees in a few milliseconds).
 * `cut` gives each material its x-ray twin. Casting and taking shadows as `meshesOf` does (none with `shadows` false).
 */
export function mergedMeshes(models: readonly Model[], name: string, cut: boolean, shadows = true): THREE.Group {
  const byMaterial = new Map<Material, ModelPart[]>();
  for (const m of models) {
    for (const part of m.parts) {
      if (part.indices.length === 0) continue;
      let list = byMaterial.get(part.material);
      if (!list) byMaterial.set(part.material, (list = []));
      list.push(part);
    }
  }
  const group = new THREE.Group();
  group.name = name;
  for (const [material, parts] of byMaterial) {
    let vertices = 0;
    let indexCount = 0;
    for (const p of parts) {
      vertices += p.positions.length / 3;
      indexCount += p.indices.length;
    }
    const positions = new Float32Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    const uvs = new Float32Array(vertices * 2);
    const indices = vertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let v = 0;
    let i = 0;
    for (const p of parts) {
      positions.set(p.positions, v * 3);
      normals.set(p.normals, v * 3);
      uvs.set(p.uvs, v * 2);
      const idx = p.indices;
      for (let k = 0; k < idx.length; k++) indices[i + k] = idx[k]! + v;
      v += p.positions.length / 3;
      i += idx.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    const mat = cut ? cuttableOf(material) : material;
    const mesh = new THREE.Mesh(geometry, mat);
    const glowing = !!material.userData.glow;
    mesh.castShadow = shadows && !glowing && !material.userData.flat;
    mesh.receiveShadow = shadows && !glowing;
    group.add(mesh);
  }
  return group;
}

function boxOf(model: Model): THREE.Box3 | null {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const part of model.parts) {
    for (let i = 0; i < part.positions.length; i += 3) box.expandByPoint(p.set(part.positions[i]!, part.positions[i + 1]!, part.positions[i + 2]!));
  }
  return box.isEmpty() ? null : box;
}

/** One of the pooled lights: a light that takes whichever spec is nearest. */
interface PoolLight {
  readonly light: THREE.PointLight;
  spec: LightData | null;
}

export class Place {
  readonly scene = new THREE.Scene();
  /** The first section: the scene itself. */
  readonly main: Section;
  private readonly sections = new Map<string, Section>();
  private sun: { light: THREE.DirectionalLight; holder: THREE.Object3D; reach: number } | null = null;
  private readonly pool: PoolLight[] = [];
  /** Whether small props and grass are shown (the furthest zoom leaves them out). */
  private detailShown = true;

  constructor(background: THREE.ColorRepresentation) {
    this.scene.background = new THREE.Color(background);
    this.main = new Section(this.scene, this);
  }

  /** Whether data lights go to the pool (set by `poolLights`). */
  get pooling(): boolean {
    return this.pool.length > 0;
  }

  /** The ground's mesh (render/ground.ts). */
  addGround(mesh: THREE.Object3D): void {
    this.main.addGround(mesh);
  }

  addPieces(pieces: readonly Built[], name: string): THREE.Group {
    return this.main.addPieces(pieces, name);
  }

  /** A light of the place's own (never pooled). */
  addLight(spec: LightSpec): THREE.Light {
    const { light, flicker } = addLight(this.scene, spec);
    if (flicker) this.main.flickers.push(flicker);
    return light;
  }

  addGrass(field: GrassField): void {
    this.main.addGrass(field);
    field.mesh.visible = this.detailShown;
  }

  /** A section of its own, made the first time (a chunk). */
  section(key: string): Section {
    let s = this.sections.get(key);
    if (!s) {
      const root = new THREE.Group();
      root.name = `section:${key}`;
      this.scene.add(root);
      s = new Section(root, this);
      this.sections.set(key, s);
    }
    return s;
  }

  hasSection(key: string): boolean {
    return this.sections.has(key);
  }

  get sectionKeys(): string[] {
    return [...this.sections.keys()];
  }

  /** Takes a section out of the place and frees it. */
  removeSection(key: string): void {
    const s = this.sections.get(key);
    if (!s) return;
    for (const p of this.pool) if (p.spec && s.pooled.includes(p.spec)) p.spec = null;
    s.dispose();
    this.sections.delete(key);
  }

  /**
   * A newly built section shown as the rest are (small props and grass left out at the furthest zoom, far stand-ins in
   * place of what has them), its merged cut-aways as the player stands.
   */
  settle(s: Section): void {
    this.showDetail(s);
    if (this.player) s.followMerged(this.player);
  }

  private showDetail(s: Section): void {
    for (const o of s.detail) o.visible = this.detailShown;
    for (const o of s.near) o.visible = this.detailShown;
    for (const o of s.far) o.visible = !this.detailShown;
  }

  /**
   * Shows or leaves out the small props and standing grass of every section, and draws trees and hedgerows near or as
   * their far stand-ins: the furthest zoom's level of detail.
   */
  setDetail(shown: boolean): void {
    if (shown === this.detailShown) return;
    this.detailShown = shown;
    for (const s of this.all()) this.showDetail(s);
  }

  /** Where the player was last followed (for a section built after). */
  private player: { readonly x: number; readonly z: number } | null = null;

  get detail(): boolean {
    return this.detailShown;
  }

  private all(): Section[] {
    return [this.main, ...this.sections.values()];
  }

  /** The open air's sun and sky, the sun's shadows reaching `reach` each way from the middle. */
  addSun(centreX: number, centreZ: number, reach: number, mapSize = 4096): void {
    const light = sunlight(this.scene, centreX, centreZ, reach);
    light.shadow.mapSize.set(mapSize, mapSize);
    // Deep enough that what stands between the sun and a view far across the world still casts.
    Object.assign(light.shadow.camera, { near: -80, far: 160 });
    light.shadow.camera.updateProjectionMatrix();
    this.sun = { light, holder: light.parent!, reach };
  }

  /**
   * Keeps the sun's shadows on the view: the shadow camera fitted to the ground the view sees - `halfX` by `halfZ`
   * tiles round `focus`, turned by the camera's `yaw` - and what stands up to `tall` high just past it, its middle at the
   * focus moved in whole texels of the shadow map along the sun's own axes, so the shadows' edges never crawl as the
   * camera follows the player. The fit changes only with the view's size and heading, never as it moves.
   */
  followSun(focus: { readonly x: number; readonly z: number }, halfX: number, halfZ: number, yaw: number, tall = 6): void {
    const sun = this.sun;
    if (!sun) return;
    const cam = sun.light.shadow.camera;
    // The shadow camera's own axes: it looks from the light down to its target, up held to the sky.
    const dir = sun.light.position.clone().sub(sun.light.target.position).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    const up = dir.clone().cross(right).normalize();
    const fit = `${halfX.toFixed(2)}:${halfZ.toFixed(2)}:${yaw.toFixed(3)}`;
    if (fit !== this.sunFit) {
      this.sunFit = fit;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      let l = Infinity;
      let r = -Infinity;
      let b = Infinity;
      let t = -Infinity;
      const margin = 3;
      for (const [a, d] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        // A corner of the view's ground, the camera's right and back turned by the yaw; and the same corner `tall` up.
        const x = a * (halfX + margin);
        const z = d * (halfZ + margin + tall);
        for (const y of [0, tall]) {
          const p = new THREE.Vector3(x * c + z * s, y, -x * s + z * c);
          l = Math.min(l, p.dot(right));
          r = Math.max(r, p.dot(right));
          b = Math.min(b, p.dot(up));
          t = Math.max(t, p.dot(up));
        }
      }
      // The shadow camera stands where the light is, which is offset from the holder: the fit is about the holder.
      const off = sun.light.position.clone();
      Object.assign(cam, { left: l - off.dot(right), right: r - off.dot(right), bottom: b - off.dot(up), top: t - off.dot(up) });
      cam.updateProjectionMatrix();
      sun.reach = Math.max(r - l, t - b) / 2;
    }
    const cam2 = cam as THREE.OrthographicCamera;
    const texelX = (cam2.right - cam2.left) / sun.light.shadow.mapSize.x;
    const texelY = (cam2.top - cam2.bottom) / sun.light.shadow.mapSize.y;
    const p = new THREE.Vector3(focus.x, 0, focus.z);
    const a = p.dot(right);
    const b = p.dot(up);
    p.addScaledVector(right, Math.round(a / texelX) * texelX - a).addScaledVector(up, Math.round(b / texelY) * texelY - b);
    sun.holder.position.copy(p);
  }

  private sunFit = "";

  get sunLight(): THREE.DirectionalLight | null {
    return this.sun?.light ?? null;
  }

  /** From now on the data's lights (fires, lamps) are pooled: `count` lights that take the nearest of them each frame. */
  poolLights(count: number): void {
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 1.4);
      light.name = "pooled";
      this.scene.add(light);
      this.pool.push({ light, spec: null });
    }
  }

  /** Gives the pooled lights to the data lights nearest `focus` (a spot is lit as a point of its color). */
  private assignPool(focus: { readonly x: number; readonly z: number }, time: number): void {
    if (this.pool.length === 0) return;
    const specs: { spec: LightData; d: number }[] = [];
    for (const s of this.all()) for (const spec of s.pooled) specs.push({ spec, d: Math.hypot(spec.at[0] - focus.x, spec.at[2] - focus.z) - spec.reach });
    specs.sort((a, b) => a.d - b.d);
    this.pool.forEach((p, i) => {
      const s = specs[i]?.spec ?? null;
      p.spec = s;
      if (!s) {
        p.light.intensity = 0;
        return;
      }
      p.light.position.set(...s.at);
      p.light.color.setRGB(s.color[0], s.color[1], s.color[2]);
      p.light.distance = s.reach;
      p.light.decay = s.decay ?? 1.4;
      const f = s.flicker;
      p.light.intensity = f ? f.base + f.steps[(Math.floor(time * f.rate) + (f.phase ?? 0)) % f.steps.length]! : s.intensity;
    });
  }

  /** The data lights the pool is lighting now, nearest first (for tests). */
  get pooledNow(): readonly (LightData | null)[] {
    return this.pool.map((p) => p.spec);
  }

  addFigure(root: THREE.Object3D): void {
    this.scene.add(root);
  }

  removeFigure(root: THREE.Object3D): void {
    this.scene.remove(root);
  }

  /**
   * Moves what moves: the grass in the wind (facing the camera's turn `yaw`), water a texel at a time, flames and the
   * light they give in steps, and the walls on the camera's side cut down while it is turned (or turning, `toward` the
   * heading it turns to) their way. With `focus`, the pooled lights go to the fires nearest it.
   */
  update(time: number, yaw: number, toward: number, focus?: { readonly x: number; readonly z: number }): void {
    const scrolls = new Set<Material>();
    for (const s of this.all()) {
      for (const g of s.grass) {
        g.time.value = time;
        g.yaw.value = yaw;
      }
      for (const m of s.scrolls) scrolls.add(m);
      for (const c of s.cutaways) {
        if (!("camera" in c.when)) continue;
        const cut = c.when.camera === "east" ? yaw > 0.01 || toward > 0.01 : yaw < -0.01 || toward < -0.01;
        c.full.visible = !cut;
        c.low.visible = cut;
      }
      for (const f of s.frames) {
        const k = Math.floor(time * f.rate) % f.groups.length;
        f.groups.forEach((g, i) => (g.visible = i === k));
      }
      for (const f of s.flickers) stepFlicker(f, time);
    }
    for (const m of scrolls) {
      const { rate, step } = m.userData.scroll as { rate: [number, number]; step: [number, number] };
      m.map!.offset.set(Math.floor(time * rate[0]) * step[0], Math.floor(time * rate[1]) * step[1]);
    }
    if (focus) this.assignPool(focus, time);
  }

  /** Cuts away what would stand between the camera and the player where they stand (a gate tower over its gateway). */
  follow(player: { readonly x: number; readonly z: number }): void {
    this.player = { x: player.x, z: player.z };
    for (const s of this.all()) {
      s.followMerged(player);
      for (const c of s.cutaways) {
        if (!("player" in c.when)) continue;
        const [x0, z0, x1, z1]: Rect = c.when.player;
        const inside = player.x > x0 && player.x < x1 && player.z > z0 && player.z < z1;
        c.full.visible = !inside;
        c.low.visible = inside;
      }
    }
  }
}
