import { type Rgb, rgb } from "./pixmap";

// The slice's palette: SNES-rich ramps, each running dark to light and shifting hue as it goes - shadows lean to violet
// and blue, lights to yellow - the way 16-bit artists ramped their colors, rather than one hue darkened. Every texture
// and model is painted from these, so the whole scene shares one set of colors; the light bands (material.ts) then
// tint them warm in the sun and cool in the shade.

const ramp = (...hexes: string[]): Rgb[] => hexes.map(rgb);

export const INK = rgb("#111113");

export const GRASS = ramp("#173326", "#1f4a2c", "#2c6a32", "#41893a", "#5fa843", "#86c653", "#b4e06c");
export const MEADOW = ramp("#2a4a24", "#3b6a2c", "#558a34", "#78a840");
export const LEAF = ramp("#0f2a26", "#17402c", "#215a30", "#2f7a34", "#47983c", "#6cb84a", "#9cd65a");
export const DIRT = ramp("#3a2228", "#5a3830", "#7c5438", "#a07446", "#c49a5c", "#e2c27e");
export const COBBLE = ramp("#2a2638", "#3f3a50", "#5a5468", "#767084", "#948ea0", "#b4b0bc", "#d6d3da");
export const LIMESTONE = ramp("#3e3442", "#5e5058", "#827068", "#a6927e", "#c6b496", "#e0d2b2", "#f4ecd4");
export const PLASTER = ramp("#6e6478", "#948aa0", "#b8b0bc", "#d8d0cc", "#eee6dc", "#fbf6ec");
export const WOOD = ramp("#24141c", "#3c2022", "#5a3026", "#7c4630", "#9c623a", "#bc844c", "#dcac6a");
export const DARKWOOD = ramp("#180e16", "#28161c", "#3c2024", "#54302c", "#6e4436");
export const ROOF = ramp("#3a1424", "#5e1c2a", "#86282e", "#ac3c32", "#cc5a3a", "#e4804c", "#f4aa6a");
export const SLATE = ramp("#1a1a30", "#262a48", "#343e64", "#4a5a86", "#6a7ea6");
export const GOLD = ramp("#4a2410", "#7c4214", "#b46a1c", "#e0a02c", "#f8d04c", "#fff0a0");
export const BLUE = ramp("#10143a", "#192664", "#24409a", "#3462c8", "#4c8ae6", "#82b8f6");
export const RED = ramp("#3a0c1c", "#661428", "#982034", "#c8343a", "#e85a48", "#f88c6a");
export const GREEN = ramp("#0c2a1c", "#14482a", "#1e6a34", "#2e8e3e");
export const PURPLE = ramp("#1e1030", "#34184e", "#502872", "#6e3c98", "#9058c0");
/** Black cloth: black, its folds lifting to charcoal - the color black, never violet. */
export const BLACK = ramp("#0c0c0e", "#161618", "#222224", "#303033", "#424245");
export const TEAL = ramp("#0e2a34", "#164a52", "#206a6a", "#2e8c80", "#4cb09a");
export const WATER = ramp("#0c1a3a", "#13306a", "#1c4c94", "#2a70b8", "#4498d4", "#78c4ec", "#c8f0ff");
export const SKIN = ramp("#4a2224", "#7a3a32", "#b05e46", "#dc8c62", "#f4b888", "#ffdcb0");
export const GOBLIN = ramp("#1c2c1c", "#2c4a22", "#44702a", "#649a34", "#8cc244", "#b8e06a");
export const BONE = ramp("#3a3036", "#5e5250", "#8a7e70", "#b4aa92", "#d8d0b6", "#f4f0dc");
export const GHOUL = ramp("#1e2228", "#2e3a38", "#46584c", "#647a5e", "#8a9e74", "#b4c48e");
export const IRON = ramp("#161624", "#262838", "#3a3e52", "#585e74", "#808aa0", "#b0b8c8", "#e4ecf4");
export const DUNGEON = ramp("#0d0d0f", "#18181b", "#252528", "#343437", "#46464a", "#5e5e62", "#7c7c80");
export const CRYPT_FLOOR = ramp("#141415", "#212123", "#303032", "#424244", "#565658", "#6e6e70");
export const FIRE = ramp("#7a1810", "#c8401c", "#f07a28", "#ffbc40", "#fff08a", "#ffffe0");
export const CLOTH_WHITE = ramp("#6c6480", "#9890a8", "#c4bed0", "#e8e4ec", "#ffffff");
export const HAIR_BROWN = ramp("#2a1418", "#4a2420", "#6e3a26", "#965430", "#b8743c");
export const HAIR_RED = ramp("#3a1010", "#6e1c14", "#a83018", "#d8521e", "#f08038");
export const STRAW = ramp("#5a3a1c", "#8a6028", "#b48a38", "#dab452", "#f4dc7a");
export const PINK = ramp("#5a1a3a", "#8c2c54", "#c04870", "#e8789a", "#fcb0c8");
