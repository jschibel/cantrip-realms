import * as C from "../paint/colors";
import { type Palette, paletteKey, withDefaults } from "../paint/palette";
import { ghoul, goblin, hero, knight, skeleton, townswoman } from "./cast";
import type { FigureSpec } from "./rig";

// The figures registry: people and creatures by id, each a `FigureSpec` - a rig of named parts (rig.ts) with every face
// painted - made from a palette. `figureSpec(id, palette)` is what an NPC's `figure` (and its `palette`) names; `new
// Figure(spec)` (rig.ts) builds it, and the renderer stands it in a place.
//
// A spec's `name` keys its painted material (one per look), so a palette that differs from the figure's own gives the
// spec a name of its own: `<id>@<palette key>`.
//
// To add a figure: write it in cast.ts as a function of a palette - its rig from `humanoid` or parts of its own, every
// face painted with faces.ts - and define it here with the slots it reads and their defaults. Every rig has at least
// `leg.l`, `leg.r`, `torso`, `arm.l`, `arm.r` and `head` (the walk swings them); `cape`, `ear.l` and `ear.r` move too.

export interface FigureEntry {
  readonly id: string;
  readonly about: string;
  readonly palette: Palette;
  readonly spec: (palette: Palette) => FigureSpec;
}

const entries = new Map<string, FigureEntry>();

export function defineFigure(id: string, about: string, palette: Palette, spec: (palette: Palette) => FigureSpec): void {
  if (entries.has(id)) throw new Error(`figure "${id}" is defined twice`);
  entries.set(id, { id, about, palette, spec });
}

export const FIGURES = {
  has: (id: string): boolean => entries.has(id),
  ids: (): string[] => [...entries.keys()],
  get(id: string): FigureEntry {
    const e = entries.get(id);
    if (!e) throw new Error(`no figure "${id}"`);
    return e;
  },
};

/** A figure's spec under a palette (over its own): named for the look, so each look has its own material. */
export function figureSpec(id: string, palette?: Palette): FigureSpec {
  const e = FIGURES.get(id);
  const spec = e.spec(withDefaults(e.palette, palette));
  if (!palette || Object.keys(palette).length === 0) return spec;
  return { ...spec, name: `${spec.name}@${paletteKey(palette)}` };
}

defineFigure("hero", "the player: spiky hair, a tunic with a belt, a cape, boots", { skin: C.SKIN, hair: C.HAIR_RED, tunic: C.BLUE, cape: C.RED, trousers: C.SLATE, boots: C.WOOD }, (p) => hero(p));
defineFigure("knight", "a knight of Benalia: closed helm and plume, tabard over mail, kite shield, spear", { iron: C.IRON }, (p) => knight(p));
defineFigure("grizzlegom", "a goblin shopkeeper: a vest with gold buttons, a hat", { skin: C.GOBLIN, vest: C.PURPLE }, (p) => goblin(true, p));
defineFigure("goblin", "a goblin about town in a leather vest", { skin: C.GOBLIN, vest: C.WOOD }, (p) => goblin(false, p));
defineFigure("skeleton", "a skeleton warrior with a notched sword, eyes glowing", { bone: C.BONE }, (p) => skeleton(p));
defineFigure("ghoul", "a hunched ghoul in rags, eyes glowing", { skin: C.GHOUL, rags: C.DARKWOOD }, (p) => ghoul(p));
defineFigure("townswoman", "a townswoman: headscarf, dress, apron", { skin: C.SKIN, hair: C.HAIR_BROWN, dress: C.TEAL, scarf: C.RED }, (p) => townswoman(p));

export { Figure, type FigureSpec, type HeadShape, type PartFaces, type PartSpec, type Paint } from "./rig";
export * as faces from "./faces";
