// Each plane is drawn in a palette of its own (tech.md, B5): every pixel the renderer puts on screen is one of these
// colors, picked after lighting with an ordered dither between the nearest two. Dominaria's is temperate and worn:
// grass and moss, earth and timber, old stone, sea and sky, with a few strong accents for magic and for people.

export type Palette = readonly string[];

export const DOMINARIA: Palette = [
  // Shadows and outline.
  "#0d0f14", "#1a1c24", "#2a2b36", "#3b3c4a",
  // Stone, cold to warm.
  "#4f5363", "#6b7080", "#8c909c", "#b3b5bc", "#d8d6d0", "#f2efe6",
  // Earth and timber.
  "#2e1f17", "#4a3122", "#6b4630", "#8f6340", "#b5855a", "#d6ae7e",
  // Grass and leaf.
  "#1c2e1a", "#2a4524", "#3a5f2c", "#4f7a34", "#6b963e", "#8fb350", "#b8cf6a",
  // Moss and swamp.
  "#2c3326", "#434c36", "#5d6646",
  // Water and sky.
  "#12263a", "#1d3f5c", "#2b5d80", "#3f80a3", "#62a4c2", "#93c8dc", "#c6e5ee",
  // Skin and cloth.
  "#5a3528", "#8a5539", "#c08a62", "#e8c39b",
  // Accents: the five colors' magic, gold and blood.
  "#f4ecc2", "#5b8fd6", "#4b2f5e", "#c8432c", "#3e9a4a",
  "#f1b44c", "#9c6a1e", "#7a1f24", "#e86a3a", "#a97fd0",
];

/** A palette's colors as linear RGB triples in 0-1, for the renderer's lookup texture. */
export function toRgb(palette: Palette): Float32Array {
  const rgb = new Float32Array(palette.length * 3);
  palette.forEach((hex, i) => {
    const value = parseInt(hex.slice(1), 16);
    rgb[i * 3] = ((value >> 16) & 0xff) / 255;
    rgb[i * 3 + 1] = ((value >> 8) & 0xff) / 255;
    rgb[i * 3 + 2] = (value & 0xff) / 255;
  });
  return rgb;
}
