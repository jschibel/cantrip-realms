import type { Ramp } from "../paint/palette";
import { seeded } from "../paint/pixmap";
import { hashOf, rampsOf } from "./ramps";
import type { FigureSpec } from "./rig";

// The mob meshes (interfaces.md, "Models"; a mob's `model.mesh`): each a figure built from the mob's colors (its
// `model.palette`, `#rrggbb`, made ramps here: `$0`, `$1`, `$2` in the order the mesh's `slots` name them), its size
// (`model.size`, 1 as the mesh is made: the figure is built bigger in whole texels, never scaled, so every size stays
// crisp) and a seed (the mob's id), which picks among a mesh's variations - a beard or none, a hat's shape, a staff's
// head. The meshes are defined in mobs-people.ts, mobs-beasts.ts and bosses.ts; an unknown mesh is drawn as `humanoid`.

export interface MobMesh {
  readonly id: string;
  readonly about: string;
  /** What each of the palette's colors paints, in order. */
  readonly slots: readonly string[];
  /** The colors when a mob names none. */
  readonly palette: readonly string[];
  /** How big the mesh is at size 1 against a person: a giant, a dragon or a wurm is made big before the mob's size. */
  readonly scale?: number;
  /**
   * The figure: `ramps` the palette's colors in the order of `slots`, `size` the mob's, `seed` draws its variations,
   * and `words` are the mob's id and its creature's name in lower case, which pick variations by name first.
   */
  readonly build: (ramps: readonly Ramp[], size: number, seed: () => number, words: string) => FigureSpec;
}

const meshes = new Map<string, MobMesh>();

export function defineMob(mesh: MobMesh): void {
  if (meshes.has(mesh.id)) throw new Error(`mob mesh "${mesh.id}" is defined twice`);
  meshes.set(mesh.id, mesh);
}

export const MOB_MESHES = {
  has: (id: string): boolean => meshes.has(id),
  ids: (): string[] => [...meshes.keys()],
  get(id: string): MobMesh {
    const m = meshes.get(id);
    if (!m) throw new Error(`no mob mesh "${id}"`);
    return m;
  },
};

/** How a mob looks (interfaces.md, mob `model`). */
export interface MobModel {
  readonly mesh: string;
  readonly palette: readonly string[];
  readonly size?: number;
}

/** The mesh a model is drawn with: its own, or `humanoid` for one this client does not know. */
export function meshOf(model: MobModel): MobMesh {
  return meshes.get(model.mesh) ?? meshes.get("humanoid")!;
}

/**
 * A mob's figure: its mesh in its colors at its size, its variations seeded by `id` (the mob's id; the mesh's own when
 * none) and chosen by the words of its id and its `creature` (the card it is: an archer's bow, a mechanic's wrench, a
 * Triskelion's third arm). Named for all of it, so each look has its own painted material.
 */
export function mobFigure(model: MobModel, id = model.mesh, creature = ""): FigureSpec {
  const mesh = meshOf(model);
  const size = Math.min(3.5, (model.size && model.size > 0 ? Math.min(3, model.size) : 1) * (mesh.scale ?? 1));
  // A color the mob does not give is the mesh's own (a knight's armor is iron unless its palette says).
  const colors = mesh.palette.map((own, i) => model.palette[i] ?? own);
  const ramps = rampsOf(colors, Math.max(1, mesh.slots.length), mesh.palette);
  const words = `${id} ${creature}`.toLowerCase();
  const spec = mesh.build(ramps, size, seeded(hashOf(id)), words);
  return { ...spec, name: `mob:${mesh.id}:${model.palette.join("")}:${size}:${id}:${creature}` };
}

/** A choice among options by a seed's next draw. */
export function choose<T>(next: () => number, options: readonly T[]): T {
  return options[Math.floor(next() * options.length) % options.length]!;
}
