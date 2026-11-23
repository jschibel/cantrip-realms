import * as THREE from "three";
import { type Material, type Model, meshesOf, mergeModels } from "../art/paint/builder";
import type { Built, Cutaway, LightSpec } from "../art/recipe";
import type { Rect } from "../world/format";
import type { GrassField } from "./grass";
import { type Flicker, addLight, stepFlicker, sunlight } from "./lights";

// A place as the renderer holds it: one scene - a street with its country, a room - with its ground, its scenery merged
// into a handful of meshes, what moves in it (flames, sliding water, grass in the wind, a cut-away that drops while
// the player stands behind it or the camera looks across it) and its lights. Figures are stood in it and taken out by
// whoever moves them (`addFigure`). The renderer draws `scene`; the page calls `update` each frame with the clock and
// the camera's turn, and `follow` with where the player is.

/** A cut-away as meshes: the whole and the cut-down, and when the cut-down one shows. */
interface LiveCutaway {
  readonly full: THREE.Group;
  readonly low: THREE.Group;
  readonly when: Cutaway["when"];
}

export class Place {
  readonly scene = new THREE.Scene();
  private readonly frames: { readonly groups: THREE.Group[]; readonly rate: number }[] = [];
  private readonly cutaways: LiveCutaway[] = [];
  private readonly flickers: Flicker[] = [];
  private readonly scrolls: Material[] = [];
  private grass: GrassField | null = null;

  constructor(background: THREE.ColorRepresentation) {
    this.scene.background = new THREE.Color(background);
  }

  /** The ground's mesh (render/ground.ts). */
  addGround(mesh: THREE.Object3D): void {
    this.scene.add(mesh);
  }

  /**
   * What recipes built, in order: their cut-aways and flames are made first, each its own meshes, then every piece's
   * still geometry merged into one group of meshes - one a material - named `name`.
   */
  addPieces(pieces: readonly Built[], name: string): THREE.Group {
    for (const piece of pieces) {
      for (const c of piece.cutaways ?? []) {
        const full = meshesOf(c.full, "cutaway");
        const low = meshesOf(c.low, "cutaway-low");
        low.visible = false;
        this.scene.add(full, low);
        this.cutaways.push({ full, low, when: c.when });
      }
      for (const f of piece.frames ?? []) {
        const groups = f.models.map((m) => meshesOf(m, "frame", false));
        for (const g of groups) this.scene.add(g);
        this.frames.push({ groups, rate: f.rate });
      }
    }
    const merged = mergeModels(pieces.map((p) => p.model));
    this.noteScrolls(merged);
    const group = meshesOf(merged, name);
    this.scene.add(group);
    return group;
  }

  private noteScrolls(model: Model): void {
    for (const part of model.parts) if (part.material.userData.scroll && !this.scrolls.includes(part.material)) this.scrolls.push(part.material);
  }

  /** The open air's sun and sky, the sun's shadows reaching `reach` each way from the middle. */
  addSun(centreX: number, centreZ: number, reach: number): void {
    sunlight(this.scene, centreX, centreZ, reach);
  }

  addLight(spec: LightSpec): THREE.Light {
    const { light, flicker } = addLight(this.scene, spec);
    if (flicker) this.flickers.push(flicker);
    return light;
  }

  addGrass(field: GrassField): void {
    this.grass = field;
    this.scene.add(field.mesh);
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
   * heading it turns to) their way.
   */
  update(time: number, yaw: number, toward: number): void {
    if (this.grass) {
      this.grass.time.value = time;
      this.grass.yaw.value = yaw;
    }
    for (const m of this.scrolls) {
      const { rate, step } = m.userData.scroll as { rate: [number, number]; step: [number, number] };
      m.map!.offset.set(Math.floor(time * rate[0]) * step[0], Math.floor(time * rate[1]) * step[1]);
    }
    for (const c of this.cutaways) {
      if (!("camera" in c.when)) continue;
      const cut = c.when.camera === "east" ? yaw > 0.01 || toward > 0.01 : yaw < -0.01 || toward < -0.01;
      c.full.visible = !cut;
      c.low.visible = cut;
    }
    for (const f of this.frames) {
      const k = Math.floor(time * f.rate) % f.groups.length;
      f.groups.forEach((g, i) => (g.visible = i === k));
    }
    for (const f of this.flickers) stepFlicker(f, time);
  }

  /** Cuts away what would stand between the camera and the player where they stand (a gate tower over its gateway). */
  follow(player: { readonly x: number; readonly z: number }): void {
    for (const c of this.cutaways) {
      if (!("player" in c.when)) continue;
      const [x0, z0, x1, z1]: Rect = c.when.player;
      const inside = player.x > x0 && player.x < x1 && player.z > z0 && player.z < z1;
      c.full.visible = !inside;
      c.low.visible = inside;
    }
  }
}
