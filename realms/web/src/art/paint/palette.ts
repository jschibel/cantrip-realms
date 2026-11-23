import * as C from "./colors";
import type { Rgb } from "./pixmap";

// Palettes: which ramps a recipe paints with. A ramp (colors.ts) runs dark to light, its hue shifting as it goes; a
// palette names ramps by the slots a recipe paints - a house's `stone` and `roof`, a figure's `hair` and `tunic`, a
// tree's `leaves`. Each registry entry (art/recipe.ts) declares the slots it reads and their defaults; a palette given
// with a recipe overrides some of them, so one recipe paints a Benalish house or a Keldon one, a green tree or an
// autumn one, a red-haired hero or a dark-haired one. The world data names a palette by id (a prop's `tint`, an NPC's
// `palette`); `PALETTES` holds the named ones.

/** A ramp of colors, darkest first. */
export type Ramp = readonly Rgb[];

/** Ramps by slot name. A slot a recipe does not read is ignored. */
export type Palette = Readonly<Record<string, Ramp>>;

/** The empty palette: every slot at the recipe's default. */
export const NO_PALETTE: Palette = Object.freeze({});

/** A palette over the defaults: `over`'s slots win where it has them. */
export function withDefaults(defaults: Palette, over: Palette | undefined): Palette {
  if (!over || Object.keys(over).length === 0) return defaults;
  return { ...defaults, ...over };
}

/** A slot's ramp, or the fallback when the palette lacks it. */
export function slot(palette: Palette, name: string, fallback: Ramp): Ramp {
  return palette[name] ?? fallback;
}

/**
 * A short, stable name for a ramp, for naming the materials painted with it: two materials painted alike from the
 * same ramp are one material (art/paint/materials.ts caches by name).
 */
export function rampKey(ramp: Ramp): string {
  let h = 2166136261;
  for (const c of ramp) {
    h ^= c;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/** A palette's name for material keys: its slots and ramps, in slot order. */
export function paletteKey(palette: Palette): string {
  return Object.keys(palette)
    .sort()
    .map((k) => `${k}=${rampKey(palette[k]!)}`)
    .join(",");
}

/**
 * The named palettes the world data may name (a prop's `tint`, an NPC's `palette`, a building's `palette`). Each is a
 * partial palette laid over the recipe's own defaults. Add one here when a region or a variant needs it.
 */
export const PALETTES: ReadonlyMap<string, Palette> = new Map<string, Palette>([
  ["default", NO_PALETTE],
  // Examples of the mechanism, used by nothing in the slice yet.
  ["autumn", { leaves: [0x2a1a10, 0x4a2414, 0x7a3418, 0xa8501c, 0xcc7224, 0xe89a34, 0xf8c454] }],
  ["dark-hair", { hair: C.HAIR_BROWN }],
]);

/** A named palette, or the empty one for none; an unknown name throws (the lint catches it first). */
export function namedPalette(name: string | undefined): Palette {
  if (name === undefined) return NO_PALETTE;
  const p = PALETTES.get(name);
  if (!p) throw new Error(`no palette "${name}"`);
  return p;
}
