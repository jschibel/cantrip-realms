import * as C from "../paint/colors";
import type { Ramp } from "../paint/palette";
import type { Person } from "./person";
import { full, rampOf, rampsOf } from "./ramps";

// Gear as painted parts per slot (design.md A4): a worn item's `look` - a gear mesh id and its colors - changes the
// wearer's description (person.ts), so it shows on the character as others see it. Each mesh is a kind of thing, its
// first color the stuff it is made of and its second the trim or the stone:
//
//   circlet   head: a band round the brow, a stone at its front
//   crown     head: a crown of points, a stone at its front
//   helm      head: an open helm with cheek guards, a nasal and a plume
//   hood      head: a hood drawn up, trimmed
//   hat       head: a wizard's pointed hat, banded
//   amulet    neck: a chain to a stone on the chest
//   armor     body: plate over the chest and arms, pauldrons on the shoulders
//   robe      body: a robe to the ankles, trimmed down its front and at its hem
//   cloak     body: a long cloak with a collar, over the character's own clothes
//   gloves    hands: gloves with a cuff
//   gauntlets hands: plate gauntlets, and the arms' bracers
//   boots     feet: boots to the shin with a turned cuff
//   greaves   feet: heavy armored boots
//   ring      ring1 (the right hand) or ring2 (the left): a band and a stone that glows
//   relic     relic: a talisman floating beside the character, its stone glowing
//   orb       relic: a glowing orb in a cage, floating beside the character

/** The eight slots a character wears gear in (design.md A4); a ring fits either ring slot. */
export const SLOTS = ["head", "neck", "body", "hands", "feet", "ring1", "ring2", "relic"] as const;
export type Slot = (typeof SLOTS)[number];

/** How a worn item looks (interfaces.md, gear `look`): a gear mesh id and its colors. */
export interface GearLook {
  readonly mesh: string;
  readonly palette: readonly string[];
}

export interface GearPart {
  readonly id: string;
  readonly about: string;
  /** The content slot it is made for (gear `slot`): a ring's is `ring`, worn in `ring1` or `ring2`. */
  readonly slot: "head" | "neck" | "body" | "hands" | "feet" | "ring" | "relic";
  /** Its two colors when an item names none. */
  readonly palette: readonly [string, string];
  /** Puts it on: a description changed, in the slot it is worn in. */
  readonly wear: (p: Person, stuff: Ramp, trim: Ramp, slot: Slot) => Person;
}

const parts = new Map<string, GearPart>();

function define(part: GearPart): void {
  if (parts.has(part.id)) throw new Error(`gear part "${part.id}" is defined twice`);
  parts.set(part.id, part);
}

export const GEAR_PARTS = {
  has: (id: string): boolean => parts.has(id),
  ids: (): string[] => [...parts.keys()],
  get(id: string): GearPart {
    const p = parts.get(id);
    if (!p) throw new Error(`no gear part "${id}"`);
    return p;
  },
};

define({ id: "circlet", about: "a band round the brow, a stone at its front", slot: "head", palette: ["#f1b44c", "#5b8fd6"], wear: (p, s, t) => ({ ...p, headgear: { kind: "circlet", ramp: s, gem: t } }) });
define({ id: "crown", about: "a crown of points, a stone at its front", slot: "head", palette: ["#f1b44c", "#c8432c"], wear: (p, s, t) => ({ ...p, headgear: { kind: "circlet", ramp: s, gem: t, crown: true } }) });
define({ id: "helm", about: "an open helm with cheek guards, a nasal and a plume in its second color", slot: "head", palette: ["#9aa0aa", "#3a5f8f"], wear: (p, s, t) => ({ ...p, headgear: { kind: "open-helm", ramp: s, trim: t, plume: t }, hair: p.hair && p.hair.style === "long" ? p.hair : p.hair ? { ...p.hair, style: "crop" } : p.hair }) });
define({ id: "hood", about: "a hood drawn up, trimmed", slot: "head", palette: ["#4a3122", "#c9a46a"], wear: (p, s, t) => ({ ...p, headgear: { kind: "hood", ramp: s, trim: t } }) });
define({ id: "hat", about: "a wizard's pointed hat, banded", slot: "head", palette: ["#2f5fa8", "#f1b44c"], wear: (p, s, t) => ({ ...p, headgear: { kind: "wizard", ramp: s, band: t } }) });
define({ id: "amulet", about: "a chain to a stone on the chest", slot: "neck", palette: ["#c9ced8", "#2f5fa8"], wear: (p, s, t) => ({ ...p, amulet: { chain: s, gem: t } }) });
define({
  id: "armor",
  about: "plate over the chest and arms, trimmed, and pauldrons on the shoulders",
  slot: "body",
  palette: ["#9aa0aa", "#4a4f58"],
  wear: (p, s, t) => ({ ...p, top: { style: "plate", ramp: s, trim: t }, sleeves: "long", sleeve: s, pauldrons: { ramp: s, trim: t }, skirt: undefined, belt: p.belt === null ? null : full(C.WOOD) }),
});
define({
  id: "robe",
  about: "a robe to the ankles, trimmed down its front and at its hem",
  slot: "body",
  palette: ["#5b8fd6", "#f4ecc2"],
  wear: (p, s, t) => ({ ...p, top: { style: "robe", ramp: s, trim: t }, sleeves: "long", sleeve: s, skirt: { ramp: s, trim: t, length: p.build.leg[1] - 1 }, pauldrons: undefined }),
});
define({ id: "cloak", about: "a long cloak with a collar, over the character's own clothes", slot: "body", palette: ["#2a2b36", "#c9a46a"], wear: (p, s, t) => ({ ...p, cape: { ramp: s, trim: t, collar: true, wide: true, length: p.build.torso[1] + p.build.leg[1] - 1 } }) });
define({ id: "gloves", about: "gloves with a cuff", slot: "hands", palette: ["#6b3f22", "#a8432f"], wear: (p, s, t) => ({ ...p, gloves: { ramp: s, trim: t } }) });
define({ id: "gauntlets", about: "plate gauntlets, and bracers up the forearms", slot: "hands", palette: ["#9aa0aa", "#f1b44c"], wear: (p, s, t) => ({ ...p, gloves: { ramp: s, trim: t }, sleeve: p.top.style === "plate" ? p.sleeve : s, sleeves: "long" }) });
define({ id: "boots", about: "boots to the shin with a turned cuff", slot: "feet", palette: ["#5c4128", "#8f7a55"], wear: (p, s, t) => ({ ...p, boots: { ramp: s, trim: t, height: 3 } }) });
define({ id: "greaves", about: "heavy armored boots", slot: "feet", palette: ["#9aa0aa", "#4a4f58"], wear: (p, s, t) => ({ ...p, boots: { ramp: s, trim: t, height: 4, big: true } }) });
define({
  id: "ring",
  about: "a band and a stone that glows: on the right hand in ring1, the left in ring2",
  slot: "ring",
  palette: ["#c9ced8", "#c9ced8"],
  wear: (p, s, t, slot) => ({ ...p, rings: { ...p.rings, [slot === "ring2" ? "l" : "r"]: { band: s, gem: t } } }),
});
define({ id: "relic", about: "a talisman floating beside the character, its stone glowing", slot: "relic", palette: ["#c9a46a", "#4a7fbf"], wear: (p, s, t) => ({ ...p, relic: { body: s, gem: t } }) });
define({ id: "orb", about: "a glowing orb in a cage, floating beside the character", slot: "relic", palette: ["#9aa0aa", "#a97fd0"], wear: (p, s, t) => ({ ...p, relic: { body: s, gem: t } }) });

/** The ramps of a look's palette (two: the stuff and the trim), the part's own where it names none. */
export function gearRamps(look: GearLook): [Ramp, Ramp] {
  const part = parts.get(look.mesh);
  const [s, t] = rampsOf(look.palette, 2, part ? [...part.palette] : ["#9aa0aa", "#4a4f58"]);
  return [s!, t!];
}

/** A description wearing a look in a slot. An unknown mesh is worn as nothing (it draws as the body beneath). */
export function wear(p: Person, slot: Slot, look: GearLook): Person {
  const part = parts.get(look.mesh);
  if (!part) return p;
  const [s, t] = gearRamps(look);
  return part.wear(p, s, t, slot);
}

/**
 * Everything worn, in the order that makes them layer right: the body first (a robe or armor replaces the clothes), then
 * what goes over it.
 */
export function wearAll(p: Person, slots: Readonly<Partial<Record<string, GearLook>>>): Person {
  const order: Slot[] = ["body", "feet", "hands", "neck", "head", "ring1", "ring2", "relic"];
  let out = p;
  for (const slot of order) {
    const look = slots[slot];
    if (look) out = wear(out, slot, look);
  }
  return out;
}

export { rampOf };
