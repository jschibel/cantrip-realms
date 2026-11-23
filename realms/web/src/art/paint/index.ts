// The painting toolkit every recipe draws with (realms/docs/conversion.md, "art/paint"):
//
//   Pixmap, seeded, hash2, rgb      pixel buffers painted by code, seeded randomness (pixmap.ts)
//   colors (C)                      the ramps, dark to light, hue-shifting (colors.ts)
//   Palette, Ramp, PALETTES         ramps by slot; named palettes the world data may name (palette.ts)
//   procedural                      value noise, fbm, cells (stones, slabs), tufts, pebbles, cracks (procedural.ts)
//   sprite, mirror                  hand-drawn pixel art as text (sprite.ts)
//   textures (T)                    tiling surfaces, 16 texels a tile, seamless and seeded (textures.ts)
//   pictures (Pic)                  pictures of single things fitted to faces: doors, signs, shelves (pictures.ts)
//   material, painted, flat, stock  materials made once by name; ramp-keyed; flat colors; stock walls and roofs (materials.ts)
//   MeshBuilder, Model, Face        low-poly shapes in world units, faces tiled or fitted; models merge (builder.ts)

export * as C from "./colors";
export * as Pic from "./pictures";
export * as procedural from "./procedural";
export * as T from "./textures";
export { EMPTY_MODEL, type BoxFaces, type Face, type Material, MeshBuilder, type Model, type ModelPart, fitted, meshesOf, mergeModels, sides, tiled } from "./builder";
export { flat, material, painted, stock } from "./materials";
export { NO_PALETTE, PALETTES, type Palette, type Ramp, namedPalette, paletteKey, rampKey, slot, withDefaults } from "./palette";
export { Pixmap, type Rgb, hash2, rgb, seeded } from "./pixmap";
export { mirror, sprite } from "./sprite";
