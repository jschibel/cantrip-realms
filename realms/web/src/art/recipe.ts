import type { LightData, RGB, Rect, XYZ } from "../world/format";
import { EMPTY_MODEL, type Model } from "./paint/builder";
import { type Palette, withDefaults } from "./paint/palette";

// What every art registry is: ids, each mapped to a recipe - a pure function from a recipe's data (a prop's entry in a
// chunk, a building's, an interior) and a palette to what it looks like (`Built`): geometry by material in world
// coordinates, and whatever moves or lights with it. The same data and palette always give the same `Built`; nothing
// here touches a scene. The renderer (render/assemble.ts) calls the recipes for what a place holds and puts the results
// together: it merges every `model` into the place's scenery (a handful of meshes for a whole chunk), and makes the
// frames, cut-aways and lights.
//
// The registries: art/surfaces (ground by id), art/props (scenery by id), art/buildings (by style), art/rooms (by
// interior kind), art/figures (people and creatures by id).

/** A flipbook: one of `models` shown at a time, `floor(time * rate) % models.length` (a fire's flames). */
export interface Frames {
  readonly models: readonly Model[];
  readonly rate: number;
}

/**
 * Something drawn twice, whole and cut down, the cut-down one shown while the camera is swung round toward `camera`'s
 * side (a room's side wall on the camera's side). What stands between the camera and the player out of doors is not cut
 * away but faded (render/occlude.ts).
 */
export interface Cutaway {
  readonly full: Model;
  readonly low: Model;
  readonly when: { readonly camera: "east" | "west" };
}

/** What a recipe makes. Everything but `model` is optional. */
export interface Built {
  /** The still geometry, merged with the rest of the place's scenery. */
  readonly model: Model;
  readonly frames?: readonly Frames[];
  readonly cutaways?: readonly Cutaway[];
  /** Lights that belong to the thing itself whatever the data says (a room's daylight, its shade). */
  readonly lights?: readonly LightSpec[];
  /**
   * The ground it stands solid on, rectangles (x0, z0, x1, z1) in world units: what the occluder fade never fades over
   * (render/occlude.ts), so the ground under it is never seen. None: the rectangle its lowest parts stand on.
   */
  readonly footprints?: readonly Rect[];
  /** Where its door is, world units: what a doorway's iris closes on. Buildings and rooms. */
  readonly doorway?: XYZ;
  /** Rooms: the rectangle (x0, z0, x1, z1) of the ground the camera keeps its view within. */
  readonly bounds?: Rect;
  /**
   * A cheaper stand-in for `model` at the far zoom step (a tree's: its silhouette and painted texture in a hundred or so
   * triangles, where the near one has a few hundred). The renderer draws it instead of `model` there; none, `model`.
   */
  readonly far?: Model;
}

/** A light a recipe brings: one of the world data's lights, or an ambient one (a room's sky and fill). */
export type LightSpec =
  | LightData
  | { readonly kind: "hemisphere"; readonly sky: RGB; readonly ground: RGB; readonly intensity: number }
  | { readonly kind: "directional"; readonly color: RGB; readonly intensity: number; readonly from: XYZ };

export const NOTHING: Built = { model: EMPTY_MODEL };

/** A recipe: the same recipe data and palette always make the same thing. */
export type Recipe<R> = (recipe: R, palette: Palette) => Built;

export interface Entry<R> {
  readonly id: string;
  readonly recipe: Recipe<R>;
  /** The slots it paints and their ramps when the palette does not say: also the list of slots it reads. */
  readonly palette: Palette;
  /** One line on what it is and what it takes (its `args` or `params`). */
  readonly about: string;
  /** Checks a recipe's data beyond the world format's own (its `args`): problems, or none. For the lint. */
  readonly check?: (recipe: R) => readonly string[];
}

/** Recipes by id. Each module of art/ has one; `define` adds to it (at module load, in the module that owns the id). */
export class Registry<R> {
  private readonly entries = new Map<string, Entry<R>>();

  constructor(readonly kind: string) {}

  define(id: string, about: string, recipe: Recipe<R>, palette: Palette = {}, check?: (recipe: R) => readonly string[]): void {
    if (this.entries.has(id)) throw new Error(`${this.kind}: "${id}" is defined twice`);
    this.entries.set(id, { id, recipe, palette, about, check });
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): Entry<R> {
    const e = this.entries.get(id);
    if (!e) throw new Error(`${this.kind}: no "${id}"`);
    return e;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** Makes one: the entry's recipe on the data, its palette under the one given. */
  build(id: string, recipe: R, palette?: Palette): Built {
    const e = this.get(id);
    return e.recipe(recipe, withDefaults(e.palette, palette));
  }

  /** Problems with a recipe's data, for the lint: an unknown id, or what the entry's check finds. */
  problems(id: string, recipe: R): string[] {
    const e = this.entries.get(id);
    if (!e) return [`no ${this.kind} "${id}"`];
    return [...(e.check?.(recipe) ?? [])];
  }
}
