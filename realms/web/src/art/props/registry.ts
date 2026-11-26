import * as THREE from "three";
import type { PropData, XZ } from "../../world/format";
import { type Built, Registry } from "../recipe";
import { MeshBuilder } from "../paint/builder";
import type { Palette } from "../paint/palette";

// The props registry and the helpers its entries read their data with. A prop's recipe takes its `PropData` - where it
// stands (`x`, `z`, `y`), its turn (`rot` quarter turns, `turn` radians), `scale`, `seed` and its own `args` - and a
// palette, and draws it in world coordinates (so tiled textures line up with the world's grid, as every surface does).

export const PROPS = new Registry<PropData>("prop");

/** A number from a prop's args, or its default. */
export function num(p: PropData, key: string, fallback: number): number {
  const v = p.args?.[key];
  return typeof v === "number" ? v : fallback;
}

export function bool(p: PropData, key: string, fallback = false): boolean {
  const v = p.args?.[key];
  return typeof v === "boolean" ? v : fallback;
}

export function str<T extends string>(p: PropData, key: string, fallback: T): T;
export function str<T extends string>(p: PropData, key: string): T | undefined;
export function str<T extends string>(p: PropData, key: string, fallback?: T): T | undefined {
  const v = p.args?.[key];
  return typeof v === "string" ? (v as T) : fallback;
}

/** A point `[x, z]` from a prop's args (the far end of a line, the far corner of a rectangle). */
export function point(p: PropData, key: string): XZ {
  const v = p.args?.[key];
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") return [v[0], v[1]];
  throw new Error(`prop ${p.id} at ${p.x},${p.z}: args.${key} is not [x, z]`);
}

/**
 * The prop's whole turn about the vertical, radians: its quarter turns clockwise seen from above (format.ts: 0 faces
 * south, 1 west, 2 north, 3 east, as a building's `rot`) and its small turn.
 */
export const turnOf = (p: PropData): number => -((p.rot ?? 0) * Math.PI) / 2 + (p.turn ?? 0);

/** Checks for an entry: the args it needs are there and of the right kind. */
export function needs(spec: Readonly<Record<string, "number" | "boolean" | "string" | "point">>): (p: PropData) => string[] {
  return (p) => {
    const out: string[] = [];
    for (const [key, kind] of Object.entries(spec)) {
      const v = p.args?.[key];
      const ok =
        kind === "point" ? Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number") : typeof v === kind;
      if (!ok) out.push(`prop ${p.id} at ${p.x},${p.z}: args.${key} should be a ${kind}`);
    }
    return out;
  };
}

/**
 * A drawing in world units at the prop's own size made to honour its `scale` too, about its anchor (x, z) - as the
 * catalogue's `tilesOf` scales a centred footprint, so what it draws and the ground it closes stay one size.
 */
export function scaledAbout<T>(draw: (b: MeshBuilder, p: PropData, palette: Palette) => T): (b: MeshBuilder, p: PropData, palette: Palette) => T {
  return (b, p, palette) => {
    const s = p.scale ?? 1;
    if (s === 1) return draw(b, p, palette);
    const saved = b.matrix;
    b.matrix = saved.clone().multiply(new THREE.Matrix4().makeTranslation(p.x, 0, p.z).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-p.x, 0, -p.z)));
    try {
      return draw(b, p, palette);
    } finally {
      b.matrix = saved;
    }
  };
}

/** Defines a prop drawn onto a builder: the commonest kind of entry. */
export function drawn(
  id: string,
  about: string,
  draw: (b: MeshBuilder, p: PropData, palette: Palette) => Omit<Built, "model"> | void,
  palette: Palette = {},
  check?: (p: PropData) => readonly string[],
  /** Draws its far-zoom stand-in (Built.far), if it has one: dense vegetation does. */
  far?: (b: MeshBuilder, p: PropData, palette: Palette) => void,
): void {
  PROPS.define(
    id,
    about,
    (p, pal) => {
      const b = new MeshBuilder();
      const extra = draw(b, p, pal) ?? {};
      const model = b.model();
      if (!far) return { ...extra, model };
      far(b, p, pal);
      return { ...extra, model, far: b.model() };
    },
    palette,
    check,
  );
}
