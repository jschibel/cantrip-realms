// The dungeons' floors as surfaces (art/surfaces): what a dungeon tile's `surface` names. Each is prefixed `dungeon-`.
// Water, lava and the stairwell are holes: what lies under them shows - water and lava scroll a texel at a time, and
// lava glows.

import type { Material } from "../art/paint/builder";
import { material } from "../art/paint/materials";
import { defineSurface } from "../art/surfaces";
import * as P from "./paint";

const scroll = (m: Material, rate: readonly [number, number], step: readonly [number, number]): Material => {
  m.userData.scroll = { rate, step };
  return m;
};

export const waterUnder = (): Material => scroll(material("dungeon-water", () => P.darkWater(49), { flat: true }), [2, 3], [1 / 32, 1 / 32]);
export const lavaUnder = (): Material => scroll(material("dungeon-lava", () => P.lava(48), { glowing: true }), [1, 2], [1 / 32, -1 / 32]);
export const darkUnder = (): Material => material("dungeon-dark", () => P.black(), { flat: true });

defineSurface("dungeon-cave-floor", "a cave's floor: packed earth, grit, bedded stones", {}, () => ({ picture: P.caveFloor(41), priority: 2 }));
defineSurface("dungeon-marble", "a hall's polished marble squares", {}, () => ({ picture: P.marble(42), priority: 1 }));
defineSurface("dungeon-keep-flags", "a keep's worn flagstones", {}, () => ({ picture: P.marble(55, P.KEEP), priority: 1 }));
defineSurface("dungeon-tower-floor", "the mage tower's blue-grey squares", {}, () => ({ picture: P.marble(56, P.TOWER), priority: 1 }));
defineSurface("dungeon-moss", "the root hollow's moss and leaf-litter, roots across it", {}, () => ({ picture: P.mossFloor(43), priority: 3 }));
defineSurface("dungeon-ash", "the foundry's soot-black flags, embers in the joints", {}, () => ({ picture: P.ashFloor(44), priority: 1 }));
defineSurface("dungeon-grating", "an iron grating: a gantry over the lava", {}, () => ({ picture: P.grating(), priority: 4 }));
defineSurface("dungeon-plates", "Phyrexian plating, oily steel and sinew", {}, () => ({ picture: P.plates(45), priority: 1 }));
defineSurface("dungeon-crystal", "faceted crystal tiles: the portal's bridges", {}, () => ({ picture: P.crystalFloor(46), priority: 3 }));
defineSurface("dungeon-rift", "a time-rift room's floor: dark squares torn by glowing cracks", {}, () => ({ picture: P.riftFloor(47), priority: 2 }));
defineSurface("dungeon-water", "still dark water: a hole, the water under it", {}, () => ({
  picture: P.caveFloor(41),
  priority: -1,
  hole: true,
  under: { material: waterUnder(), y: -0.18, spread: 0.75 },
}));
defineSurface("dungeon-lava", "lava: a hole, glowing lava under it", {}, () => ({
  picture: P.ashFloor(44),
  priority: -1,
  hole: true,
  under: { material: lavaUnder(), y: -0.22, spread: 0.75 },
}));
defineSurface("dungeon-stairwell", "the stairs down: a hole, the stair's own steps in it", {}, () => ({
  picture: P.caveFloor(41),
  priority: -2,
  hole: true,
}));
