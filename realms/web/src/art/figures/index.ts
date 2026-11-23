import * as C from "../paint/colors";
import { type Palette, paletteKey, withDefaults } from "../paint/palette";
import "./bosses";
import { ghoul, goblin, hero, knight, skeleton, townswoman } from "./cast";
import "./mobs-beasts";
import "./mobs-people";
import { NPC_FIGURES } from "./npcs";
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
  readonly spec: (palette: Palette, seed: number) => FigureSpec;
  /** Whether its seed (the NPC's `seed`) varies it: a street of townsfolk, no two alike. */
  readonly seeded: boolean;
}

const entries = new Map<string, FigureEntry>();

export function defineFigure(id: string, about: string, palette: Palette, spec: (palette: Palette, seed: number) => FigureSpec, seeded = false): void {
  if (entries.has(id)) throw new Error(`figure "${id}" is defined twice`);
  entries.set(id, { id, about, palette, spec, seeded });
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

/**
 * A figure's spec under a palette (over its own) and, for a seeded figure, a seed (an NPC's `seed`; 0 when none): named
 * for the look, so each look has its own material.
 */
export function figureSpec(id: string, palette?: Palette, seed = 0): FigureSpec {
  const e = FIGURES.get(id);
  const spec = e.spec(withDefaults(e.palette, palette), seed);
  const named = e.seeded ? { ...spec, name: `${id}#${seed}` } : spec;
  if (!palette || Object.keys(palette).length === 0) return named;
  return { ...named, name: `${named.name}@${paletteKey(palette)}` };
}

defineFigure("hero", "the player: spiky hair, a tunic with a belt, a cape, boots", { skin: C.SKIN, hair: C.HAIR_RED, tunic: C.BLUE, cape: C.RED, trousers: C.SLATE, boots: C.WOOD }, (p) => hero(p));
defineFigure("knight", "a knight of Benalia: closed helm and plume, tabard over mail, kite shield, spear", { iron: C.IRON }, (p) => knight(p));
defineFigure("grizzlegom", "a goblin shopkeeper: a vest with gold buttons, a hat", { skin: C.GOBLIN, vest: C.PURPLE }, (p) => goblin(true, p));
defineFigure("goblin", "a goblin about town in a leather vest", { skin: C.GOBLIN, vest: C.WOOD }, (p) => goblin(false, p));
defineFigure("skeleton", "a skeleton warrior with a notched sword, eyes glowing", { bone: C.BONE }, (p) => skeleton(p));
defineFigure("ghoul", "a hunched ghoul in rags, eyes glowing", { skin: C.GHOUL, rags: C.DARKWOOD }, (p) => ghoul(p));
defineFigure("townswoman", "a townswoman: headscarf, dress, apron", { skin: C.SKIN, hair: C.HAIR_BROWN, dress: C.TEAL, scarf: C.RED }, (p) => townswoman(p));
// The towns' people (npcs.ts), varied by their seed; a palette's `cloth`, `trim`, `skin` and `hair` override theirs.
for (const npc of NPC_FIGURES) defineFigure(npc.id, npc.about, {}, (p, seed) => npc.make(Object.keys(p).length ? p : undefined, seed), true);

export { type Action, Figure, type FigureSpec, type HeadShape, type Motion, type PartFaces, type PartSpec, type Paint } from "./rig";
export * as faces from "./faces";
export { GEAR_PARTS, type GearLook, type GearPart, SLOTS, type Slot, gearRamps, wear, wearAll } from "./gear";
export { MOB_MESHES, type MobMesh, type MobModel, meshOf, mobFigure } from "./mobs";
export { BODY_NAMES, BUILDS, type BodyName, type Build, type Person, person, scaled } from "./person";
export { type Appearance, type PresenceLook, bodyOf, lookFigure, playerFigure, playerPerson } from "./player";
export { COLORLESS, IDENTITY, IDENTITY_TRIM, MANA, type ManaColor, SKINS, identityRamps, rampOf } from "./ramps";
export { NPC_FIGURES, REGIONS, type Region } from "./npcs";
