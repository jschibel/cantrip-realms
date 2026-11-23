import * as THREE from "three";
import { type Material, type Model, meshesOf, mergeModels } from "../art/paint/builder";
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
// Out of doors at world scale the place pools its lights (`poolLights`): the fires and lamps of every chunk are specs,
// and a fixed set of lights takes the nearest of them each frame - so streaming a chunk in or out never changes how many
// lights the shaders are compiled for. Its sun follows the camera (`followSun`), its shadows always round the view.

/** A cut-away as meshes: the whole and the cut-down, and when the cut-down one shows. */
interface LiveCutaway {
  readonly full: THREE.Group;
  readonly low: THREE.Group;
  readonly when: Cutaway["when"];
}

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

  /** Cut-aways and flames of pieces, each their own meshes. */
  private addMoving(pieces: readonly Built[]): void {
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
   * Scenery at world scale, sorted three ways before it is merged: what is tall enough to hide the player (cut by the
   * x-ray: render/xray.ts), small props (left out at the furthest zoom), and the rest. Each kind is merged by material.
   */
  addScenery(pieces: readonly Built[], name: string): { tall: THREE.Group; small: THREE.Group; rest: THREE.Group } {
    this.addMoving(pieces);
    const tall: Model[] = [];
    const small: Model[] = [];
    const rest: Model[] = [];
    for (const p of pieces) {
      const size = sizeOf(p.model);
      if (!size) continue;
      if (size.y > TALL) tall.push(p.model);
      else if (size.x <= DETAIL_SIZE && size.z <= DETAIL_SIZE && size.y <= DETAIL_HEIGHT) small.push(p.model);
      else rest.push(p.model);
    }
    const make = (models: Model[], label: string, cut: boolean) => {
      const merged = mergeModels(models);
      this.noteScrolls(merged);
      const group = meshesOf(cut ? { parts: merged.parts.map((part) => ({ ...part, material: cuttableOf(part.material) })) } : merged, label);
      this.add(group);
      return group;
    };
    const groups = { rest: make(rest, name, false), tall: make(tall, `${name}:tall`, true), small: make(small, `${name}:small`, false) };
    this.detail.push(groups.small);
    return groups;
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

function sizeOf(model: Model): THREE.Vector3 | null {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const part of model.parts) {
    for (let i = 0; i < part.positions.length; i += 3) box.expandByPoint(p.set(part.positions[i]!, part.positions[i + 1]!, part.positions[i + 2]!));
  }
  return box.isEmpty() ? null : box.getSize(new THREE.Vector3());
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

  /** A newly built section shown as the rest are (small props and grass left out at the furthest zoom). */
  settle(s: Section): void {
    for (const o of s.detail) o.visible = this.detailShown;
  }

  /** Shows or leaves out the small props and standing grass of every section: the furthest zoom's level of detail. */
  setDetail(shown: boolean): void {
    if (shown === this.detailShown) return;
    this.detailShown = shown;
    for (const s of this.all()) for (const o of s.detail) o.visible = shown;
  }

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
    this.sun = { light, holder: light.parent!, reach };
  }

  /**
   * Keeps the sun's shadows round the view: its middle moved to `focus` - in whole texels of the shadow map along the
   * sun's own axes, so the shadows' edges never crawl as the camera follows the player - reaching `reach` each way.
   */
  followSun(focus: { readonly x: number; readonly z: number }, reach: number): void {
    const sun = this.sun;
    if (!sun) return;
    const cam = sun.light.shadow.camera;
    if (reach !== sun.reach) {
      sun.reach = reach;
      Object.assign(cam, { left: -reach, right: reach, top: reach, bottom: -reach });
      cam.updateProjectionMatrix();
    }
    const texel = (2 * reach) / sun.light.shadow.mapSize.x;
    // The shadow camera's own axes: it looks from the light down to its target, up held to the sky.
    const dir = sun.light.position.clone().sub(sun.light.target.position).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    const up = dir.clone().cross(right).normalize();
    const p = new THREE.Vector3(focus.x, 0, focus.z);
    const a = p.dot(right);
    const b = p.dot(up);
    p.addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(up, Math.round(b / texel) * texel - b);
    sun.holder.position.copy(p);
  }

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
    for (const s of this.all()) {
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
