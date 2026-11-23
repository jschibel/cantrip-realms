import * as C from "../paint/colors";
import { chain, horn, wings } from "./anatomy";
import { cloth, layer, rows } from "./faces";
import { defineMob } from "./mobs";
import { type V3, allSides, eyes, glowing, part, plates, solid } from "./paints";
import { type Build, person, scaled } from "./person";
import { SKINS, at, full, rampOf } from "./ramps";
import { ARCANE_EYE, OIL_EYE, type Paint, type PartSpec } from "./rig";

// The bosses who unlock their colors, and the praetor who ends the arc (design.md A6): each a figure of its own, larger
// than the roster's and drawn as the card is - Lyra's wings and flaming sword, Teferi's hourglass and the time turning
// round him, Liliana's veil and violet eyes, Garna's axes and war paint, Rofellos's crown of branches, Sheoldred on her
// legs of a spider with a scorpion's tail. A boss's mesh is its own id; its palette recolors it like any mob's.

const GOLD = full(C.GOLD);
const IRON = full(C.IRON);
const WOOD = full(C.WOOD);
const BONE = full(C.BONE);
const k = (v: number, s: number) => Math.max(1, Math.round(v * s));

/** A boss's build: tall, its head growing less than its body. */
const HERO: Build = { head: [12, 10, 10], torso: [11, 9, 7], arm: [4, 10, 4], leg: [5, 8, 5] };
const big = (s: number, b: Build = HERO) => scaled(b, Math.max(1, s / 1.25), 0.35);

/** Motes that circle a caster: small lights orbiting at a radius, out of step. */
function motes(ramp: readonly number[], count: number, radius: number, y: number): PartSpec[] {
  const out: PartSpec[] = [];
  for (let i = 0; i < count; i++) out.push(part(`mote.${i}`, [2, 2, 2], [0, y + i * 3, 0], [-1, -1, -1], allSides(glowing(ramp)), at(ramp, 6), { glow: true, round: 0, motion: { kind: "orbit", radius: radius + i * 2, rate: 1.3 + i * 0.4 } }));
  return out;
}

defineMob({
  id: "lyra",
  about: "Lyra Dawnbringer: an angel in gold plate and a white robe, golden hair, a blazing halo, vast white wings, a flaming sword",
  slots: ["robe", "armor", "accent"],
  palette: ["#f2efe6", "#f1b44c", "#93c8dc"],
  build: ([robe, armor, accent], s) => {
    const b = big(s);
    return person({
      name: "lyra",
      build: b,
      skin: SKINS[0]!.skin,
      face: { mouth: "grim" },
      hair: { ramp: rampOf("#f4c860"), style: "long" },
      headgear: { kind: "circlet", ramp: armor!, gem: accent!, crown: true },
      halo: rampOf("#fff0a0"),
      top: { style: "plate", ramp: armor!, trim: robe!, emblem: accent! },
      sleeves: "long",
      sleeve: armor!,
      pauldrons: { ramp: armor!, trim: robe! },
      gloves: { ramp: armor! },
      skirt: { ramp: robe!, trim: armor!, length: b.leg[1] - 1 },
      boots: { ramp: armor!, height: 3 },
      right: { kind: "sword", flame: true, length: 15 },
      extras: wings({ kind: "feather", ramp: full(C.CLOTH_WHITE), trim: accent!, span: k(22, s / 1.25), height: k(24, s / 1.25), parent: "torso", at: [2, b.torso[1], -b.torso[2] / 2 - 0.5], raise: 0.4, jointed: true }),
      spark: rampOf("#fff0a0"),
      stride: 0.4,
      armSwing: 0.35,
      hover: 3,
      footprint: 0.6 * s,
    });
  },
});

defineMob({
  id: "teferi",
  about: "Teferi, Hero of Dominaria: dark-skinned and bald, a white beard, blue and white robes trimmed in gold, an hourglass staff, time turning round him",
  slots: ["robe", "trim", "mantle"],
  palette: ["#5b8fd6", "#f1b44c", "#f2efe6"],
  build: ([robe, trim, mantle], s) => {
    const b = big(s);
    return person({
      name: "teferi",
      build: b,
      skin: SKINS[5]!.skin,
      face: { mouth: "smile" },
      hair: { ramp: rampOf("#e8e8f0"), style: "bald" },
      beard: { ramp: rampOf("#e8e8f0"), style: "goatee" },
      top: { style: "robe", ramp: robe!, trim: trim!, emblem: mantle! },
      sleeves: "long",
      skirt: { ramp: robe!, trim: trim! },
      cape: { ramp: mantle!, trim: trim!, collar: true, wide: true },
      amulet: { chain: trim!, gem: full(C.WATER) },
      right: { kind: "staff", top: "hourglass", glow: rampOf("#82b8f6"), length: 28 },
      extras: motes(rampOf("#a8d8ff"), 3, 8, b.leg[1] + 4),
      spark: rampOf("#82b8f6"),
      stride: 0.35,
      footprint: 0.55 * s,
    });
  },
});

defineMob({
  id: "liliana",
  about: "Liliana of the Veil: pale, black-haired, violet-eyed, a dark hood and gown, the Chain Veil's gold at her brow, dark motes about her",
  slots: ["gown", "trim", "veil"],
  palette: ["#2a2b36", "#4b2f5e", "#c9a46a"],
  build: ([gown, trim, veil], s) => {
    const b = big(s, { head: [12, 10, 10], torso: [10, 9, 6], arm: [3, 10, 3], leg: [4, 8, 4] });
    return person({
      name: "liliana",
      build: b,
      skin: rampOf("#f0dcd4", 4),
      face: { eyes: ARCANE_EYE, mouth: "grim" },
      hair: { ramp: rampOf("#1a1622"), style: "long" },
      headgear: { kind: "circlet", ramp: veil!, gem: rampOf("#b06ee6"), crown: false },
      top: { style: "dress", ramp: gown!, trim: veil!, under: trim! },
      sleeves: "long",
      sleeve: gown!,
      skirt: { ramp: gown!, trim: trim!, ragged: true },
      cape: { ramp: trim!, trim: veil!, collar: true, ragged: true },
      gloves: { ramp: gown!, trim: veil! },
      extras: motes(rampOf("#9058c0"), 3, 7, b.leg[1] + 6),
      spark: rampOf("#b06ee6"),
      stride: 0.35,
      armSwing: 0.3,
      footprint: 0.5 * s,
    });
  },
});

defineMob({
  id: "garna",
  about: "Garna, Bloodfist of Keld: a Keldon berserker, braided black hair, red war paint, a horned helm, furs and leather, an axe in each hand",
  slots: ["cloth", "fur", "metal"],
  palette: ["#8f2f2f", "#2e1f17", "#f1b44c"],
  build: ([clothR, furR, metal], s) => {
    const b = big(s, { head: [12, 10, 10], torso: [13, 9, 8], arm: [5, 10, 5], leg: [5, 8, 5] });
    return person({
      name: "garna",
      build: b,
      skin: SKINS[3]!.skin,
      face: { paint: at(full(C.RED), 3), mouth: "grim", brow: true },
      hair: { ramp: rampOf("#1e1a24"), style: "wild" },
      headgear: { kind: "horned", ramp: IRON, horn: BONE },
      top: { style: "fur", ramp: furR! },
      legs: clothR!,
      belt: metal!,
      boots: { ramp: furR!, height: 4 },
      pauldrons: { ramp: furR!, fur: true },
      skirt: { ramp: clothR!, trim: metal!, length: 4, ragged: true },
      gloves: { ramp: WOOD, trim: metal! },
      right: { kind: "axe", big: true, blade: IRON },
      left: { kind: "axe", big: true, blade: IRON },
      spark: full(C.FIRE),
      stride: 0.8,
      armSwing: 0.55,
      footprint: 0.6 * s,
    });
  },
});

defineMob({
  id: "rofellos",
  about: "Rofellos, Llanowar Emissary: an elf in green robes and a mantle of leaves, a crown of branches, a staff in leaf",
  slots: ["robe", "mantle", "accent"],
  palette: ["#3e9a4a", "#8f6340", "#f1b44c"],
  build: ([robe, mantle, accent], s) => {
    const b = big(s, { head: [11, 10, 10], torso: [10, 9, 6], arm: [3, 10, 3], leg: [4, 9, 4] });
    const [w, h] = b.head;
    const crown: PartSpec[] = [];
    for (let i = -2; i <= 2; i++) crown.push(part(`branch.${i + 2}`, [1, 6 - Math.abs(i), 1], [i * 2.2, h - 1, -1], [-0.5, 0, -0.5], solid(WOOD, 4), at(WOOD, 4), { parent: "head", tilt: [-0.15, -i * 0.25], round: 0 }), part(`leaf.${i + 2}`, [2, 2, 2], [0, 6 - Math.abs(i), 0], [-1, 0, -1], solid(full(C.LEAF), 5), at(C.LEAF, 5), { parent: `branch.${i + 2}`, round: 0 }));
    void w;
    return person({
      name: "rofellos",
      build: b,
      skin: rampOf("#d8a478", 4),
      ears: "long",
      face: { eyes: 0x1e5a2c },
      hair: { ramp: rampOf("#3a2418"), style: "long" },
      headgear: { kind: "leaves", ramp: full(C.LEAF), berry: at(accent!, 4) },
      top: { style: "robe", ramp: robe!, trim: accent! },
      sleeves: "long",
      skirt: { ramp: robe!, trim: accent!, ragged: true },
      cape: { ramp: full(C.LEAF), trim: mantle!, collar: true, ragged: true, wide: true },
      amulet: { chain: WOOD, gem: accent! },
      right: { kind: "staff", top: "leaves", length: 28 },
      extras: [...crown, ...motesOf()],
      spark: full(C.LEAF),
      stride: 0.4,
      footprint: 0.5 * s,
    });
  },
});

const motesOf = () => motes(rampOf("#b4e06c"), 2, 7, 10);

defineMob({
  id: "praetor",
  about: "Sheoldred, the praetor: a crowned porcelain body above six spider legs, a scorpion's tail arched over it, oil-green eyes",
  slots: ["plate", "sinew", "dark"],
  palette: ["#f2efe6", "#7a1f24", "#0d0f14"],
  build: ([plate, sinew, dark], s) => {
    const b = big(s, { head: [11, 10, 10], torso: [11, 10, 7], arm: [3, 13, 3], leg: [4, 1, 4] });
    const P = plate!;
    const D = dark!;
    const [w, h] = b.head;
    const legH = k(12, s / 1.25);
    const face: Paint = layer(cloth(P, 4), rows(0, 1, at(P, 6)), eyes(w, h - 4, { color: OIL_EYE, size: 1 }), (p) => { p.vline(Math.floor(w / 2) - 1, 2, h - 3, at(P, 2)); p.hline(2, h - 2, w - 4, at(sinew!, 2)); });
    const crown: PartSpec[] = [-2, -1, 0, 1, 2].map((i) => horn(`crown.${i + 2}`, "head", [i * 2.2, h - 2, -1], [2, 6 + (2 - Math.abs(i)) * 2, 2], P, [-0.25, -i * 0.3]));
    const abdomen: V3 = [k(12, s / 1.25), k(8, s / 1.25), k(14, s / 1.25)];
    const legs: PartSpec[] = [];
    [-1, 0, 1].forEach((row, i) => {
      for (const side of [1, -1] as const) {
        const n = `leg.${i}${side > 0 ? "l" : "r"}`;
        legs.push(part(n, [2, k(9, s / 1.25), 2], [side * (abdomen[0] / 2 - 1), abdomen[1] - 1, row * (abdomen[2] / 3)], side > 0 ? [0, 0, -1] : [-2, 0, -1], solid(D, 3, rows(0, 1, at(P, 4))), at(D, 3), { parent: "abdomen", tilt: [0, side * -1.1], motion: { kind: "leg", phase: (i % 2 === 0) === side > 0 ? 0 : Math.PI, amount: 0.35 } }));
        legs.push(part(`${n}.shin`, [2, legH + abdomen[1], 2], [0, k(9, s / 1.25), 0], [-1, -(legH + abdomen[1]), -1], { front: layer(cloth(P, 4), rows(0, 0, at(D, 2))), left: cloth(P, 3), right: cloth(P, 3), back: cloth(P, 3), top: cloth(P, 5, false), bottom: cloth(D, 1, false) }, at(P, 4), { parent: n, tilt: [0, side * 1.1], round: 0 }));
      }
    });
    const tail = chain({ name: "tail", parent: "abdomen", at: [0, abdomen[1] - 1, -abdomen[2] / 2 + 1], count: 6, first: [4, 4, 5], last: [2, 2, 4], faces: (i) => allSides(layer(plates(P, 2, 4), rows(0, 0, at(sinew!, 3)))), fill: at(P, 4), droop: -0.5, sway: 0.15, axis: "x", rate: 1.6 });
    const sting = horn("sting", "tail.5", [0, 0, -3.5], [2, 5, 2], sinew!, [-2.2, 0]);
    return person({
      name: "praetor",
      build: b,
      skin: sinew!,
      ownHead: { faces: { front: face, back: cloth(D, 3), left: layer(cloth(P, 3), rows(h - 3, h - 1, at(sinew!, 3))), right: layer(cloth(P, 3), rows(h - 3, h - 1, at(sinew!, 3))), top: cloth(P, 5, false) }, parts: crown },
      top: { style: "plate", ramp: P, trim: D, emblem: sinew! },
      sleeves: "long",
      sleeve: sinew!,
      pauldrons: { ramp: P, trim: D },
      gloves: { ramp: D },
      noLegs: true,
      right: { kind: "scythe", blade: P },
      extras: [
        part("abdomen", abdomen, [0, legH, 0], [-abdomen[0] / 2, 0, -abdomen[2] / 2], allSides(layer(plates(P, 3, 4), (p) => { for (let x = 1; x < p.width; x += 4) p.vline(x, 0, p.height, at(sinew!, 3)); })), at(P, 4), { round: 2 }),
        ...legs,
        ...tail,
        sting,
      ],
      spark: rampOf("#7cff9c"),
      stride: 0.4,
      armSwing: 0.3,
      perch: legH + abdomen[1] - 2,
      footprint: 0.9 * s,
      headShape: { steps: 3, jaw: 0.25, dome: 0.1, back: 0.15 },
    });
  },
});

