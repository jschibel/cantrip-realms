// Each plane is drawn in a palette of its own (tech.md, B5), made of ramps: a material's few colors from dark to light.
// Everything the scene draws gives its color as one of the palette's (or near one) and a light band - shadow, shade or
// lit - and the renderer shows the ramp's color for that band: a step down the ramp in shadow, a step up in the sun.
// No color is mixed or dithered; an area of one color stays one color.
//
// The terrain and scenery ramps are muted - grass and moss, earth, stone, water, snow, timber and tile - and the
// identity ramps (the five colors' cloth) are saturated in hues the land does not use, so a character always stands out.

export interface Palette {
  readonly name: string;
  /** Every ramp, darkest first; no color is in two ramps. */
  readonly ramps: Readonly<Record<string, readonly string[]>>;
  /** The outline drawn round characters, mobs, props and buildings. */
  readonly outline: string;
}

export const DOMINARIA: Palette = {
  name: "Dominaria",
  outline: "#0b0c10",
  ramps: {
    ink: ["#0b0c10", "#1b1d26", "#2e3140"],
    stone: ["#3e4252", "#575c6e", "#757b8c", "#979cab", "#bcbfc9", "#e0e0e3"],
    snow: ["#aebfcc", "#d5e2ea", "#f2f7f8"],
    earth: ["#2e1c14", "#4d2f1f", "#73472b", "#9a663c", "#c08b55", "#ddb27a", "#f0d6a2"],
    grass: ["#1f3a1c", "#2f5424", "#43722c", "#5e9134", "#80ad42", "#a8c95a"],
    foliage: ["#10261f", "#1a3d2c", "#285a3a", "#3b7a45"],
    moss: ["#252b1f", "#39422c", "#525d3c", "#6e7a4c"],
    water: ["#10263f", "#173a5c", "#22557c", "#33739a", "#5296b5", "#84bfd3", "#bfe3ec"],
    skin: ["#3e2219", "#5e3424", "#87502f", "#b07448", "#d29f72", "#f0caa0", "#fde6c8"],
    tile: ["#5a2420", "#85382c", "#ad5238"],
    gold: ["#6e4210", "#a8681a", "#e09a2a", "#ffc94a", "#fff09a"],
    fire: ["#8a2a12", "#d0521f", "#f58a3a"],
    // The five colors' cloth: what a character wears, and nothing the land is made of.
    white: ["#b0a37a", "#e6dbb4", "#fff8de"],
    blue: ["#142266", "#2338b0", "#3f62e8", "#85a6ff"],
    black: ["#2a0f3d", "#4d1d70", "#7a32b0", "#b06ee6"],
    red: ["#520a14", "#9c1424", "#e02a3a", "#ff7a6a"],
    green: ["#0a4026", "#0f7a44", "#1fbf62", "#7af0a6"],
  },
};

/** Light bands, darkest first: in shadow, turned from the sun, lit. */
export type Band = 0 | 1 | 2;

/** The palette's colors in one list, ramp by ramp, and where in its ramp each one is. */
export function colorsOf(palette: Palette): { color: string; ramp: readonly string[]; at: number }[] {
  return Object.values(palette.ramps).flatMap((ramp) => ramp.map((color, at) => ({ color, ramp, at })));
}

/**
 * What a palette color is drawn as in a band: a step down its ramp in shadow, itself turned from the sun, a step up in
 * the sun (clamped at the ramp's ends). With two bands, it is itself lit and a step down otherwise.
 */
export function shadeOf(ramp: readonly string[], at: number, band: Band, bands: 2 | 3 = 3): string {
  const step = bands === 2 ? (band === 2 ? 0 : -1) : band - 1;
  return ramp[Math.max(0, Math.min(ramp.length - 1, at + step))]!;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** The palette color nearest a color, weighting green over red over blue as the eye does (the renderer's own rule). */
export function nearest(palette: Palette, hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  let best = palette.outline;
  let distance = Infinity;
  for (const { color } of colorsOf(palette)) {
    const [cr, cg, cb] = hexToRgb(color);
    const d = 0.3 * (cr - r) ** 2 + 0.59 * (cg - g) ** 2 + 0.11 * (cb - b) ** 2;
    if (d < distance) {
      distance = d;
      best = color;
    }
  }
  return best;
}
