import * as C from "../paint/colors";
import type { Ramp } from "../paint/palette";
import { chain, horn, wings } from "./anatomy";
import { cloth, layer, rows } from "./faces";
import type { Held } from "./held";
import { choose, defineMob } from "./mobs";
import { type V3, allSides, bark, cutTo, eyes, feathers, flipX, fur, glowing, part, plates, pointUp, ragged, solid, speckle, stone } from "./paints";
import { type Build, type HairStyle, person, scaled } from "./person";
import { SKINS, at, full, rampOf } from "./ramps";
import { ARCANE_EYE, BLOOD_EYE, EMBER_EYE, GHOUL_EYE, OIL_EYE, SPIRIT_EYE, type FigureSpec, type Paint, type PartSpec } from "./rig";

// The roster's people and everything built like one (mobs.ts): soldiers, knights, archers, barbarians, elves, goblins,
// orcs, minotaurs, giants, merfolk, vampires, angels, demons and imps, the aven, ghouls and horrors, Phyrexians, the
// mages of each region, thrulls, djinn, spirits and wraiths, elementals, yetis and apes, treefolk, constructs and golems.
// Each reads its colors from the mob's palette (`slots`, in order) and its variations from the mob's id: the words in
// it first (an archer has a bow, a mechanic a wrench), then its seed.

const IRON = full(C.IRON);
const GOLD = full(C.GOLD);
const WOOD = full(C.WOOD);
const DARK = full(C.DARKWOOD);
const BONE = full(C.BONE);
const SLATE = full(C.SLATE);

/** A human's skin and hair, from the seed (the six palettes a player may have). */
function human(next: () => number): { skin: Ramp; hair: Ramp } {
  const s = choose(next, SKINS);
  return { skin: s.skin, hair: s.hair };
}

const has = (id: string, ...words: string[]) => words.some((w) => id.includes(w));

/** How light a color is, 0-1. */
const luma = (c: number) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

/** A build at a size, with the head growing less than the body. */
const sized = (b: Build, s: number) => (s === 1 ? b : scaled(b, s));

const SOLDIER: Build = { head: [12, 10, 10], torso: [11, 7, 6], arm: [3, 8, 3], leg: [4, 6, 4] };
const SLIM: Build = { head: [11, 10, 10], torso: [9, 8, 5], arm: [3, 9, 3], leg: [4, 7, 4] };
const BRUTE: Build = { head: [12, 10, 10], torso: [14, 8, 8], arm: [5, 10, 5], leg: [5, 6, 5] };
const SMALL: Build = { head: [12, 9, 9], torso: [8, 5, 5], arm: [3, 6, 3], leg: [3, 4, 3] };
const ROBED: Build = { head: [12, 10, 10], torso: [10, 8, 6], arm: [3, 9, 3], leg: [4, 7, 4] };

// --- Soldiers and knights --------------------------------------------------------------------------------------------

defineMob({
  id: "humanoid",
  about: "a soldier: an open helm, a tabard over mail, a spear (a bow for an archer) and a round shield",
  slots: ["tabard", "trim", "accent"],
  palette: ["#d8d6d0", "#3a5f8f", "#f1b44c"],
  build: ([tab, trim, accent], s, next, id) => {
    const h = human(next);
    const archer = has(id, "archer", "bow");
    const vampire = has(id, "vampire");
    if (vampire) return vampireOf([tab!, trim!, accent!], s, next);
    const leader = s >= 1.3 || has(id, "warlord", "founder", "torsten");
    return person({
      name: "humanoid",
      build: sized(leader ? { ...SOLDIER, torso: [12, 8, 7], arm: [4, 9, 4] } : SOLDIER, s),
      skin: h.skin,
      hair: { ramp: h.hair, style: choose(next, ["crop", "swept", "long"] as HairStyle[]) },
      beard: next() < 0.45 || leader ? { style: leader ? "full" : "short" } : undefined,
      headgear: archer ? { kind: "hood", ramp: tab!, trim: trim! } : { kind: "open-helm", ramp: IRON, trim: accent!, plume: leader ? trim! : undefined },
      top: { style: archer ? "leather" : "tabard", ramp: archer ? WOOD : tab!, trim: trim!, under: IRON, emblem: accent! },
      legs: archer ? full(C.SLATE) : IRON,
      boots: { ramp: WOOD, height: 3 },
      cape: leader ? { ramp: trim!, trim: accent!, collar: true } : archer ? { ramp: tab!, length: 9 } : undefined,
      pauldrons: leader ? { ramp: IRON, trim: accent! } : undefined,
      right: archer ? undefined : leader ? { kind: "sword", hilt: accent! } : { kind: "spear", pennant: trim! },
      left: archer ? { kind: "bow" } : { kind: "shield", face: trim!, trim: accent!, emblem: tab!, round: !leader },
      extras: archer ? [quiver(sized(SOLDIER, s))] : [],
      spark: rampOf(at(accent!, 4)),
      stride: 0.65,
    });
  },
});

/** A quiver of arrows across the back. */
function quiver(b: Build): PartSpec {
  const [tw, th, td] = b.torso;
  return part("quiver", [3, 9, 2], [tw / 2 - 2, th + 2, -td / 2 - 1], [-1.5, -9, -1], { front: layer(cloth(WOOD, 3), rows(0, 1, 0xe8e4d0), (p) => { p.put(0, 0, 0xc8343a); p.put(2, 0, 0xc8343a); }), back: layer(cloth(WOOD, 3), rows(0, 1, 0xe8e4d0)), left: cloth(WOOD, 2), top: layer(cloth(WOOD, 2, false), (p) => p.put(1, 0, 0xe8e4d0)) }, at(WOOD, 3), { parent: "torso", tilt: [0, 0.4] });
}

defineMob({
  id: "knight",
  about: "a knight: a closed helm with a plume, plate under a tabard, pauldrons, a kite shield and a sword",
  slots: ["tabard", "trim", "plume", "armor"],
  palette: ["#f2efe6", "#f1b44c", "#93c8dc", "#9aa0aa"],
  build: ([tab, trim, plume, armor], s, next, id) => {
    const metal = armor ?? IRON;
    return person({
      name: "knight",
      build: sized({ head: [12, 10, 11], torso: [11, 8, 7], arm: [4, 8, 4], leg: [5, 6, 5] }, s),
      skin: SKINS[0]!.skin,
      headgear: { kind: "helm", ramp: metal, trim: trim!, plume: plume! },
      top: { style: "tabard", ramp: tab!, trim: trim!, under: metal, emblem: plume! },
      sleeve: metal,
      legs: metal,
      boots: { ramp: metal, trim: trim!, height: 3, big: true },
      pauldrons: { ramp: metal, trim: trim! },
      gloves: { ramp: metal, trim: trim! },
      cape: s >= 1.2 || has(id, "paladin", "stromgald") ? { ramp: tab!, trim: trim!, collar: false } : undefined,
      right: has(id, "malice") || next() < 0.5 ? { kind: "sword", hilt: trim! } : { kind: "spear", pennant: tab! },
      left: { kind: "shield", face: tab!, trim: trim!, emblem: plume! },
      spark: rampOf(at(trim!, 4)),
      stride: 0.6,
      armSwing: 0.35,
      headShape: { steps: 3, jaw: 0.1, dome: 0.1, back: 0.08 },
    });
  },
});

defineMob({
  id: "barbarian",
  about: "a barbarian: bare arms, a fur mantle, a horned helm, war paint and a great axe",
  slots: ["fur", "paint", "metal"],
  palette: ["#8f6340", "#c8432c", "#9aa0aa"],
  build: ([furR, paint, metal], s, next, id) => {
    const h = human(next);
    const warlord = has(id, "warlord") || s >= 1.25;
    return person({
      name: "barbarian",
      build: sized(warlord ? BRUTE : { ...BRUTE, torso: [13, 7, 7], arm: [4, 9, 4] }, s),
      skin: h.skin,
      face: { paint: at(paint!, 3), mouth: "grim", brow: true },
      hair: { ramp: h.hair, style: choose(next, ["wild", "long", "mohawk"] as HairStyle[]) },
      beard: { style: choose(next, ["full", "long", "short"] as const) },
      headgear: next() < 0.6 || warlord ? { kind: "horned", ramp: metal!, horn: BONE } : undefined,
      top: { style: "fur", ramp: furR! },
      legs: furR!,
      belt: WOOD,
      boots: { ramp: furR!, height: 3 },
      pauldrons: { ramp: furR!, fur: true },
      skirt: { ramp: WOOD, length: 3, ragged: true },
      right: { kind: "axe", big: true, blade: metal! },
      left: warlord ? { kind: "shield", face: paint!, trim: metal!, round: true } : undefined,
      spark: full(C.FIRE),
      stride: 0.8,
      armSwing: 0.55,
    });
  },
});

// --- Elves -------------------------------------------------------------------------------------------------------

function elfOf([coat, cloak, hairC]: readonly Ramp[], s: number, next: () => number, id: string, druid: boolean): FigureSpec {
  const skins = [rampOf("#e8b88a", 4), rampOf("#c89468", 4), rampOf("#a87650", 4)];
  const skin = choose(next, skins);
  const archer = has(id, "archer");
  const warrior = has(id, "warrior", "marhault");
  const rider = false;
  void rider;
  return person({
    name: druid ? "elf-druid" : "elf",
    build: sized(SLIM, s),
    skin,
    ears: "long",
    face: { eyes: druid ? undefined : 0x1e5a2c },
    hair: { ramp: hairC ?? rampOf("#4a2e1a"), style: choose(next, druid ? (["long", "wild"] as HairStyle[]) : (["long", "ponytail", "swept"] as HairStyle[])) },
    headgear: druid ? (next() < 0.5 ? { kind: "antlers", ramp: WOOD } : { kind: "leaves", ramp: full(C.LEAF) }) : archer ? undefined : warrior && s >= 1.4 ? { kind: "circlet", ramp: GOLD, gem: full(C.GREEN) } : undefined,
    top: { style: druid ? "robe" : "leather", ramp: coat!, trim: cloak!, emblem: druid ? GOLD : undefined },
    legs: druid ? undefined : rampOf(at(coat!, 1)),
    boots: druid ? undefined : { ramp: WOOD, height: 4 },
    skirt: druid ? { ramp: coat!, trim: cloak!, ragged: true } : { ramp: coat!, length: 2, ragged: true },
    cape: { ramp: cloak!, length: SLIM.torso[1] + SLIM.leg[1] - 1, ragged: true, collar: false },
    right: druid ? { kind: "staff", top: "leaves" } : warrior ? { kind: "sword", hilt: GOLD } : archer ? undefined : { kind: "spear", length: 24 },
    left: archer ? { kind: "bow" } : warrior ? { kind: "shield", face: cloak!, trim: GOLD, round: true } : undefined,
    extras: archer ? [quiver(sized(SLIM, s))] : [],
    spark: full(C.LEAF),
    stride: druid ? 0.35 : 0.75,
  });
}

defineMob({ id: "elf", about: "an elf of Llanowar: long ears, a leather jerkin and a ragged leaf-green cloak; a bow for an archer, a sword and shield for a warrior, else a spear", slots: ["coat", "cloak", "hair"], palette: ["#3e9a4a", "#2a4524", "#4a2e1a"], build: (r, s, n, id) => elfOf(r, s, n, id, false) });
defineMob({ id: "elf-druid", about: "an elf druid: long ears, a robe, antlers or a crown of leaves, a staff in leaf", slots: ["robe", "cloak", "hair"], palette: ["#3e9a4a", "#8f6340", "#4a2e1a"], build: (r, s, n, id) => elfOf(r, s, n, id, true) });

// --- Goblins and orcs --------------------------------------------------------------------------------------------

function bigEars(skin: Ramp, w: number, h: number, size = 7): PartSpec[] {
  const ear: Paint = layer(cloth(skin, 4), (p) => { p.hline(0, 0, p.width, at(skin, 5)); p.put(p.width - 1, 0, 0, 0); p.put(p.width - 1, p.height - 1, 0, 0); p.hline(1, 1, p.width - 2, at(C.PINK, 2)); });
  return [
    part("ear.l", [size, 3, 2], [w / 2, h - 4, 0], [0, -1, -1], { front: ear, back: ear, top: cloth(skin, 5, false) }, at(skin, 4), { parent: "head", tilt: [0, 0.35] }),
    part("ear.r", [size, 3, 2], [-w / 2, h - 4, 0], [-size, -1, -1], { front: flipX(ear), back: flipX(ear), top: cloth(skin, 5, false) }, at(skin, 4), { parent: "head", tilt: [0, -0.35] }),
  ];
}

defineMob({
  id: "goblin",
  about: "a goblin: green, grinning, ears out to here, a vest and a crude blade",
  slots: ["skin", "vest", "accent"],
  palette: ["#6b963e", "#c8432c", "#4a3122"],
  build: ([skin, vest, accent], s, next) => {
    const b = sized({ head: [14, 10, 10], torso: [9, 6, 6], arm: [3, 7, 3], leg: [3, 4, 3] }, s);
    return person({
      name: "goblin",
      build: b,
      skin: skin!,
      face: { eyes: at(GOLD, 4), mouth: "fangs", blush: false },
      top: { style: "vest", ramp: vest!, under: accent! },
      legs: accent!,
      boots: { ramp: DARK, height: 2 },
      headgear: next() < 0.4 ? { kind: "cap", ramp: IRON, brim: false } : undefined,
      right: choose(next, [{ kind: "dagger" }, { kind: "club", size: 0.7 }, { kind: "torch" }] as Held[]),
      extras: [...bigEars(skin!, b.head[0], b.head[1]), part("nose", [3, 3, 3], [0, 4, b.head[2] / 2], [-1.5, -1, 0], { front: layer(cloth(skin!, 4), rows(0, 0, at(skin!, 5))), top: cloth(skin!, 5, false) }, at(skin!, 4), { parent: "head", tilt: [0.3, 0] })],
      spark: full(C.FIRE),
      stride: 0.9,
      armSwing: 0.9,
      headShape: { steps: 3, jaw: 0.08, dome: 0.06, back: 0.1 },
    });
  },
});

defineMob({
  id: "orc",
  about: "an orc: broad and grey-green, tusked, heavy-browed, in leather and spiked iron, with a cleaver; goggles and a wrench for a mechanic",
  slots: ["skin", "leather", "metal"],
  palette: ["#6f8a58", "#4a3122", "#9aa0aa"],
  build: ([skin, leather, metal], s, next, id) => {
    const mechanic = has(id, "mechanic", "artiller");
    return person({
      name: "orc",
      build: sized({ head: [12, 10, 10], torso: [13, 7, 7], arm: [4, 9, 4], leg: [5, 5, 5] }, s),
      skin: skin!,
      face: { eyes: has(id, "artiller") ? undefined : EMBER_EYE, mouth: "tusks", brow: true, blush: false },
      hair: { ramp: rampOf("#1e1a24"), style: choose(next, ["mohawk", "topknot", "crop"] as HairStyle[]) },
      headgear: mechanic ? { kind: "goggles", ramp: leather!, lens: rampOf("#f1b44c") } : undefined,
      top: { style: "leather", ramp: leather!, trim: metal! },
      sleeves: "none",
      legs: leather!,
      boots: { ramp: DARK, height: 3 },
      pauldrons: { ramp: metal! },
      gloves: mechanic ? { ramp: leather! } : undefined,
      right: mechanic ? (has(id, "artiller") ? { kind: "hammer" } : { kind: "wrench" }) : { kind: "axe", blade: metal! },
      left: has(id, "artiller") ? { kind: "torch" } : undefined,
      spark: full(C.FIRE),
      stride: 0.8,
      headShape: { steps: 3, jaw: 0.04, dome: 0.04, back: 0.1 },
    });
  },
});

// --- Minotaurs, giants and the two-headed ------------------------------------------------------------------------

defineMob({
  id: "minotaur",
  about: "a Hurloon minotaur: a bull's head with horns and a ring through its nose, bare-chested, hooved, a great axe",
  slots: ["hide", "kilt", "horn"],
  palette: ["#7a4a30", "#c8432c", "#e8e4d8"],
  build: ([hide, kilt, hornR], s, next) => {
    const b = sized({ head: [11, 9, 10], torso: [14, 8, 8], arm: [5, 10, 5], leg: [5, 6, 5] }, s);
    const [w, h, d] = b.head;
    const H = hide!;
    const front: Paint = layer(fur(H, 3), (p) => { p.box(2, h - 6, w - 4, 1, at(H, 2)); }, eyes(w, h - 5, { color: EMBER_EYE, size: 1 }), rows(0, 1, at(H, 4)));
    const muzzleW = Math.max(5, w - 4);
    const parts: PartSpec[] = [
      part("muzzle", [muzzleW, 4, 4], [0, 0, d / 2 - 1], [-muzzleW / 2, 0, 0], { front: layer(cloth(rampOf(at(H, 2)), 4), (p) => { p.put(1, 1, C.INK); p.put(muzzleW - 2, 1, C.INK); p.hline(1, 3, muzzleW - 2, at(GOLD, 4)); }), top: cloth(H, 4, false), left: cloth(H, 3) }, at(H, 3), { parent: "head", round: 1.2 }),
      horn("horn.l", "head", [w / 2 - 1, h - 3, 0], [2, 6, 2], hornR!, [0, -1.15]),
      horn("horn.r", "head", [-w / 2 + 1, h - 3, 0], [2, 6, 2], hornR!, [0, 1.15]),
      part("ear.l", [3, 2, 2], [w / 2, h - 5, -1], [0, -1, -1], solid(H, 3), at(H, 3), { parent: "head", tilt: [0, -0.3] }),
      part("ear.r", [3, 2, 2], [-w / 2, h - 5, -1], [-3, -1, -1], solid(H, 3), at(H, 3), { parent: "head", tilt: [0, 0.3] }),
    ];
    return person({
      name: "minotaur",
      build: b,
      skin: H,
      ownHead: { faces: { front, back: fur(H, 3), left: fur(H, 3), right: fur(H, 3), top: fur(H, 4) }, parts },
      top: { style: "bare", ramp: H },
      sleeves: "none",
      legs: H,
      belt: WOOD,
      boots: { ramp: rampOf("#2a2024"), height: 2 },
      skirt: { ramp: kilt!, length: 3, ragged: true },
      pauldrons: next() < 0.5 ? { ramp: H, fur: true } : undefined,
      right: { kind: "axe", big: true },
      spark: full(C.FIRE),
      stride: 0.7,
      headTilt: 0.15,
      headShape: { steps: 2, jaw: 0.02, dome: 0.04, back: 0.06 },
    });
  },
});

function giantOf([skin, cloth2, hairC]: readonly Ramp[], s: number, next: () => number, heads: 1 | 2): FigureSpec {
  const b = sized({ head: [12, 10, 10], torso: [16, 10, 9], arm: [5, 12, 5], leg: [6, 8, 6] }, s);
  const spec = person({
    name: heads === 2 ? "ettin" : "giant",
    build: b,
    skin: skin!,
    face: { brow: true, mouth: "grim", blush: false },
    hair: { ramp: hairC!, style: choose(next, ["wild", "long", "crop"] as HairStyle[]) },
    beard: { ramp: hairC!, style: choose(next, ["long", "full"] as const) },
    top: { style: "fur", ramp: cloth2! },
    legs: cloth2!,
    belt: WOOD,
    boots: { ramp: cloth2!, height: 4 },
    pauldrons: { ramp: cloth2!, fur: true },
    skirt: { ramp: WOOD, length: 4, ragged: true },
    right: { kind: "club", size: 1.5 * s },
    spark: full(C.FIRE),
    stride: 0.55,
    armSwing: 0.45,
  });
  if (heads === 1) return spec;
  // The second head: the same, beside the first, on a shoulder.
  const head = spec.parts.find((p) => p.name === "head")!;
  const second: PartSpec[] = [];
  const shift = b.head[0] / 2 + 0.5;
  const moved = spec.parts.map((p) => (p.name === "head" ? { ...p, at: [shift, p.at[1], p.at[2]] as const } : p));
  for (const p of spec.parts) {
    if (p.parent === "head") second.push({ ...p, name: `${p.name}.2`, parent: "head.2" });
  }
  second.unshift({ ...head, name: "head.2", at: [-shift, head.at[1] - 1, head.at[2]], tilt: [0.05, 0.12] });
  return { ...spec, parts: [...moved, ...second] };
}

defineMob({ id: "giant", about: "a giant: huge, bearded, in furs, with a tree-trunk club", slots: ["skin", "fur", "hair"], palette: ["#d29f72", "#8f6340", "#6e3a26"], build: (r, s, n) => giantOf(r, s, n, 1) });
defineMob({ id: "ettin", about: "a two-headed giant: two bearded heads on its shoulders, furs, a club", slots: ["skin", "fur", "hair"], palette: ["#c8432c", "#6b963e", "#4a2420"], build: (r, s, n) => giantOf(r, s, n, 2) });

// --- Merfolk, vampires -----------------------------------------------------------------------------------------------

defineMob({
  id: "merfolk",
  about: "a merfolk of Vodalia: scaled blue-green skin, fin ears and a crest, a shell harness and a trident",
  slots: ["skin", "fin", "harness"],
  palette: ["#3d8fa8", "#93c8dc", "#f4ecc2"],
  build: ([skin, fin, harness], s, next, id) => {
    const b = sized(SLIM, s);
    const lord = has(id, "lord") || s >= 1.1;
    return person({
      name: "merfolk",
      build: b,
      skin: skin!,
      ears: { fin: fin! },
      face: { eyes: 0x10203a, mouth: "grim", blush: false },
      top: { style: "bare", ramp: skin! },
      sleeves: "none",
      legs: skin!,
      belt: harness!,
      boots: { ramp: fin!, height: 2 },
      skirt: { ramp: fin!, length: 3, ragged: true },
      headgear: lord ? { kind: "circlet", ramp: harness!, gem: full(C.WATER), crown: true } : undefined,
      amulet: { chain: harness!, gem: full(C.WATER) },
      right: { kind: "trident" },
      left: has(id, "soldier", "raider") ? { kind: "shield", face: fin!, trim: harness!, round: true } : undefined,
      extras: [part("crest", [1, 4, b.head[2] - 2], [0, b.head[1] - 1, 0], [-0.5, 0, -(b.head[2] - 2) / 2], { left: layer(cloth(fin!, 4), cutTo((x, y, w, h) => y >= h - 1 - Math.round((x / w) * (h - 1)) || x > w - 2)), right: layer(cloth(fin!, 4), cutTo((x, y, w, h) => y >= Math.round((x / w) * (h - 1)) || x < 1)), front: cloth(fin!, 4), top: cloth(fin!, 5, false) }, at(fin!, 4), { parent: "head", round: 0 })],
      spark: full(C.WATER),
      stride: 0.7,
    });
  },
});

function vampireOf([cape, coat, trim]: readonly Ramp[], s: number, next: () => number): FigureSpec {
  return person({
    name: "vampire",
    build: sized(SLIM, s),
    skin: rampOf("#e8dcd8", 4),
    face: { eyes: BLOOD_EYE, mouth: "fangs", blush: false },
    hair: { ramp: rampOf("#1a1622"), style: choose(next, ["swept", "long"] as HairStyle[]) },
    top: { style: "coat", ramp: coat!, trim: trim!, under: full(C.CLOTH_WHITE) },
    legs: rampOf("#1a1622"),
    boots: { ramp: rampOf("#1a1622"), height: 3 },
    cape: { ramp: cape!, trim: trim!, collar: true, wide: true },
    gloves: { ramp: rampOf("#1a1622") },
    spark: rampOf("#c8243c"),
    stride: 0.6,
    armSwing: 0.3,
  });
}

defineMob({ id: "vampire", about: "a vampire: pale, red-eyed, fanged, a high-collared cape over a black coat", slots: ["cape", "coat", "trim"], palette: ["#7a1f24", "#2a2b36", "#c9ced8"], build: (r, s, n) => vampireOf(r, s, n) });

// --- Angels, demons, imps, the aven -----------------------------------------------------------------------------------

defineMob({
  id: "angel",
  about: "an angel: tall, feathered wings, a halo, armor and a robe, a sword or a spear; a fallen one's wings dark and no halo",
  slots: ["robe", "trim", "accent"],
  palette: ["#f2efe6", "#f1b44c", "#93c8dc"],
  build: ([robe, trim, accent], s, next, id) => {
    const fallen = has(id, "fallen") || luma(robe![3]!) < 0.3;
    const h = human(next);
    const b = sized({ head: [12, 10, 10], torso: [10, 9, 6], arm: [3, 9, 3], leg: [4, 8, 4] }, s);
    const wingR = fallen ? rampOf("#2a2630") : full(C.CLOTH_WHITE);
    return person({
      name: "angel",
      build: b,
      skin: fallen ? rampOf("#c8c0c8", 4) : h.skin,
      face: fallen ? { eyes: BLOOD_EYE, mouth: "grim" } : { mouth: "grim" },
      hair: { ramp: fallen ? rampOf("#1a1622") : choose(next, [rampOf("#f4d070"), rampOf("#e8e0c8"), h.hair, rampOf("#c8743c")]), style: "long" },
      headgear: s >= 1.4 && !fallen ? { kind: "circlet", ramp: trim!, gem: accent! } : undefined,
      halo: fallen ? undefined : rampOf("#fff0a0"),
      top: { style: "plate", ramp: fallen ? rampOf("#3a3442") : trim!, trim: fallen ? robe! : robe!, emblem: accent! },
      sleeve: robe!,
      sleeves: "long",
      skirt: { ramp: robe!, trim: trim!, length: b.leg[1] - 1 },
      boots: { ramp: trim!, height: 2 },
      right: has(id, "paragon") || next() < 0.4 ? { kind: "spear", head: trim!, length: 32 } : { kind: "sword", hilt: trim!, flame: has(id, "archangel") },
      extras: wings({ kind: "feather", ramp: wingR, trim: fallen ? rampOf("#5a1828") : accent!, span: Math.round(15 * s), height: Math.round(18 * s), parent: "torso", at: [2, b.torso[1], -b.torso[2] / 2 - 0.5], raise: 0.35 }),
      spark: fallen ? rampOf("#c8243c") : rampOf("#fff0a0"),
      stride: 0.4,
      armSwing: 0.4,
      hover: 2,
      footprint: 0.55 * s,
    });
  },
});

defineMob({
  id: "demon",
  about: "a demon: huge and horned, bat wings, a tail, hooves, glowing eyes",
  slots: ["skin", "wings", "horn"],
  palette: ["#7a1f24", "#2a2b36", "#e8e4d8"],
  build: ([skin, wingR, hornR], s) => {
    const b = sized({ head: [12, 10, 10], torso: [15, 9, 8], arm: [5, 11, 5], leg: [5, 7, 5] }, s);
    return person({
      name: "demon",
      build: b,
      skin: skin!,
      face: { eyes: EMBER_EYE, mouth: "fangs", brow: true, blush: false },
      horns: { ramp: hornR!, size: 2.2 },
      top: { style: "bare", ramp: skin! },
      sleeves: "none",
      legs: skin!,
      belt: rampOf("#2a2024"),
      boots: { ramp: rampOf("#2a2024"), height: 2 },
      skirt: { ramp: wingR!, length: 3, ragged: true },
      gloves: { ramp: rampOf(at(skin!, 1)) },
      extras: [
        ...wings({ kind: "bat", ramp: wingR!, trim: rampOf(at(wingR!, 1)), span: Math.round(18 * s), height: Math.round(16 * s), parent: "torso", at: [2, b.torso[1], -b.torso[2] / 2 - 0.5], raise: 0.45, jointed: true }),
        ...chain({ name: "tail", parent: "torso", at: [0, 1, -b.torso[2] / 2], count: 4, first: [3, 3, 4], last: [1, 1, 4], faces: () => solid(skin!, 3), fill: at(skin!, 3), droop: 0.35, sway: 0.3 }),
      ],
      spark: full(C.FIRE),
      stride: 0.55,
      armSwing: 0.45,
      footprint: 0.6 * s,
    });
  },
});

defineMob({
  id: "imp",
  about: "an imp: small, big-eared and grinning, bat wings, a barbed tail",
  slots: ["skin", "wings", "accent"],
  palette: ["#8c909c", "#4b2f5e", "#c8432c"],
  build: ([skin, wingR, accent], s) => {
    const b = sized(SMALL, s);
    return person({
      name: "imp",
      build: b,
      skin: skin!,
      face: { eyes: EMBER_EYE, mouth: "fangs", blush: false },
      horns: { ramp: BONE, size: 0.6 },
      top: { style: "bare", ramp: skin! },
      sleeves: "none",
      legs: skin!,
      belt: null,
      skirt: { ramp: accent!, length: 2, ragged: true },
      extras: [
        ...bigEars(skin!, b.head[0], b.head[1], 5),
        ...wings({ kind: "bat", ramp: wingR!, span: Math.round(9 * s), height: Math.round(9 * s), parent: "torso", at: [1, b.torso[1], -b.torso[2] / 2 - 0.5], raise: 0.6 }),
        ...chain({ name: "tail", parent: "torso", at: [0, 0, -b.torso[2] / 2], count: 3, first: [1, 1, 3], last: [2, 2, 2], faces: (i) => (i === 2 ? { front: layer(cloth(accent!, 4), pointUp) } : solid(skin!, 3)), fill: at(skin!, 3), droop: -0.4, sway: 0.4, rate: 4 }),
      ],
      spark: full(C.FIRE),
      stride: 1,
      armSwing: 1,
      hover: 4,
    });
  },
});

defineMob({
  id: "aven",
  about: "an aven: a bird-headed soldier with a hooked beak and great wings, in a breastplate",
  slots: ["feathers", "armor", "beak"],
  palette: ["#e8e4d8", "#b3b5bc", "#c08a62"],
  build: ([feath, armor, beak], s) => {
    const b = sized({ head: [10, 10, 10], torso: [10, 8, 6], arm: [3, 9, 3], leg: [3, 7, 3] }, s);
    const [w, h, d] = b.head;
    const F = feath!;
    const front: Paint = layer(feathers(F, 4, false), eyes(w, h - 4, { size: 2 }), rows(0, 1, at(F, 5)), (p) => { p.hline(1, h - 6, 3, at(F, 2)); p.hline(w - 4, h - 6, 3, at(F, 2)); });
    return person({
      name: "aven",
      build: b,
      skin: F,
      ownHead: {
        faces: { front, back: feathers(F, 3, false), left: feathers(F, 3, false), right: feathers(F, 3, false), top: cloth(F, 5, false) },
        parts: [
          part("beak", [4, 3, 4], [0, 2, d / 2 - 0.5], [-2, 0, 0], { front: layer(cloth(beak!, 4), rows(2, 2, at(beak!, 2))), top: cloth(beak!, 5, false), left: cloth(beak!, 3) }, at(beak!, 4), { parent: "head", round: 0.8 }),
          part("beak.tip", [2, 2, 2], [0, 0, 3.5], [-1, -1, 0], solid(beak!, 4), at(beak!, 4), { parent: "beak", round: 0.5, tilt: [0.5, 0] }),
          part("crest", [2, 4, 5], [0, h - 1, -1], [-1, 0, -5], { left: layer(feathers(F, 5), pointUp), right: layer(feathers(F, 5), pointUp), top: cloth(F, 5, false) }, at(F, 5), { parent: "head", tilt: [-0.4, 0] }),
        ],
      },
      top: { style: "plate", ramp: armor!, trim: beak! },
      sleeve: F,
      sleeves: "long",
      legs: rampOf("#d8a040"),
      skirt: { ramp: F, length: 3, ragged: true },
      boots: { ramp: rampOf("#d8a040"), height: 2 },
      right: { kind: "spear", length: 28 },
      extras: wings({ kind: "feather", ramp: F, trim: rampOf(at(F, 2)), span: Math.round(14 * s), height: Math.round(17 * s), parent: "torso", at: [2, b.torso[1], -b.torso[2] / 2 - 0.5], raise: 0.35 }),
      spark: rampOf("#fff0a0"),
      stride: 0.6,
      headShape: { steps: 3, jaw: 0.1, dome: 0.12, back: 0.1 },
    });
  },
});

// --- The dead and the dreadful ----------------------------------------------------------------------------------------

defineMob({
  id: "ghoul",
  about: "a ghoul, a zombie of the Morass: hunched and grey-green, sunken glowing eyes, rags, long clawed arms",
  slots: ["skin", "rags", "accent"],
  palette: ["#8c909c", "#4b2f5e", "#5d6646"],
  build: ([skin, rags, accent], s, next, id) => {
    const master = has(id, "master", "warden") || s >= 1.3;
    return person({
      name: "ghoul",
      build: sized({ head: [11, 9, 10], torso: [10, 7, 6], arm: [3, 11, 3], leg: [3, 5, 3] }, s),
      skin: skin!,
      face: { eyes: GHOUL_EYE, mouth: "fangs", blush: false },
      hair: next() < 0.5 ? { ramp: accent!, style: "wild" } : undefined,
      top: { style: "rags", ramp: rags! },
      legs: rags!,
      boots: { ramp: skin!, height: 2 },
      skirt: { ramp: rags!, length: 3, ragged: true },
      cape: master ? { ramp: accent!, ragged: true, collar: true } : undefined,
      right: master ? { kind: "staff", top: "skull" } : undefined,
      spark: rampOf("#b4e060"),
      stride: 0.55,
      armSwing: 0.25,
      hunch: 0.4,
      headTilt: -0.4,
    });
  },
});

defineMob({
  id: "horror",
  about: "a horror: a hunched hulk of the swamp, a fanged maw, many eyes, spines down its back, long claws",
  slots: ["skin", "flesh", "spines"],
  palette: ["#4b2f5e", "#7a1f24", "#2a2b36"],
  build: ([skin, flesh, spines], s, next) => {
    const b = sized({ head: [13, 9, 10], torso: [15, 9, 9], arm: [5, 13, 5], leg: [5, 5, 5] }, s);
    const [w, h] = b.head;
    const face: Paint = layer(speckle(skin!, [2, 4], 0.2, 5), cloth(skin!, 3), speckle(skin!, [2, 4], 0.2, 5), (p) => {
      for (const [x, y] of [[2, 2], [w - 4, 2], [4, 4], [w - 6, 4], [Math.floor(w / 2) - 1, 1]] as const) {
        p.put(x, y, GHOUL_EYE);
        p.put(x + 1, y, GHOUL_EYE);
      }
      p.box(1, h - 4, w - 2, 3, at(flesh!, 1));
      for (let x = 1; x < w - 1; x += 2) {
        p.put(x, h - 4, 0xf4ecd4);
        p.put(x + 1, h - 2, 0xf4ecd4);
      }
    });
    const spinesParts: PartSpec[] = [];
    for (let i = 0; i < 4; i++) spinesParts.push(horn(`spine.${i}`, "torso", [0, b.torso[1] - 1 - i * 2, -b.torso[2] / 2 + 1], [2, 4 + (i % 2), 2], spines!, [-0.9, 0]));
    return person({
      name: "horror",
      build: b,
      skin: skin!,
      ownHead: { faces: { front: face, back: cloth(skin!, 3), left: layer(cloth(skin!, 3), speckle(skin!, [2], 0.2)), right: layer(cloth(skin!, 3), speckle(skin!, [2], 0.2)), top: cloth(skin!, 4, false) } },
      top: { style: "bare", ramp: skin! },
      sleeves: "none",
      legs: skin!,
      belt: null,
      skirt: next() < 0.5 ? { ramp: flesh!, length: 2, ragged: true } : undefined,
      gloves: { ramp: flesh! },
      extras: spinesParts,
      spark: rampOf("#b4e060"),
      stride: 0.5,
      armSwing: 0.3,
      hunch: 0.35,
      headTilt: -0.2,
      footprint: 0.55 * s,
    });
  },
});

defineMob({
  id: "phyrexian",
  about: "a Phyrexian: long-limbed, white porcelain plates over red sinew, a faceplate with glowing slits, tubes and blades",
  slots: ["plates", "sinew", "dark"],
  palette: ["#e8e4d8", "#7a1f24", "#0d0f14"],
  build: ([platesR, sinew, dark], s, next, id) => {
    const b = sized({ head: [10, 10, 10], torso: [10, 9, 6], arm: [3, 12, 3], leg: [4, 8, 4] }, s);
    const [w, h] = b.head;
    const P = platesR!;
    const mask: Paint = layer(cloth(P, 4), rows(0, 0, at(P, 6)), (p) => {
      p.hline(1, h - 5, 3, OIL_EYE);
      p.hline(w - 4, h - 5, 3, OIL_EYE);
      p.vline(Math.floor(w / 2) - 1, 1, h - 2, at(P, 2));
      for (let x = 2; x < w - 2; x += 2) p.put(x, h - 2, at(dark!, 3));
    });
    const mage = has(id, "mindcutter", "ertai");
    return person({
      name: "phyrexian",
      build: b,
      skin: sinew!,
      ownHead: { faces: { front: mask, back: layer(cloth(dark!, 3), rows(0, 1, at(P, 4))), left: layer(cloth(P, 3), rows(h - 4, h - 1, at(sinew!, 3))), right: layer(cloth(P, 3), rows(h - 4, h - 1, at(sinew!, 3))), top: cloth(P, 5, false) }, parts: [horn("crest", "head", [0, h - 1, -1], [2, 5, 3], P, [-0.6, 0]), part("tube.l", [1, 5, 1], [w / 2 - 1, 1, -2], [-0.5, -5, -0.5], solid(dark!, 3), at(dark!, 3), { parent: "head" }), part("tube.r", [1, 5, 1], [-w / 2 + 1, 1, -2], [-0.5, -5, -0.5], solid(dark!, 3), at(dark!, 3), { parent: "head" })] },
      top: { style: "plate", ramp: P, trim: dark! },
      sleeves: "long",
      sleeve: sinew!,
      legs: sinew!,
      boots: { ramp: P, height: 4, trim: dark! },
      pauldrons: { ramp: P, trim: sinew! },
      cape: mage ? { ramp: dark!, trim: sinew!, ragged: true } : undefined,
      right: mage ? { kind: "staff", top: "crystal", glow: rampOf("#7cff9c") } : { kind: "scythe", blade: P },
      left: mage ? undefined : { kind: "dagger", blade: P },
      extras: [part("spine", [2, b.torso[1], 2], [0, 0, -b.torso[2] / 2 - 0.5], [-1, 0, -1], { front: layer(cloth(P, 4), (p) => { for (let y = 0; y < p.height; y += 2) p.put(0, y, at(dark!, 2)); }), left: cloth(P, 3) }, at(P, 4), { parent: "torso", round: 0 })],
      spark: rampOf("#7cff9c"),
      stride: 0.6,
      armSwing: 0.3,
      headShape: { steps: 2, jaw: 0.25, dome: 0.12, back: 0.15 },
      footprint: 0.5 * s,
    });
  },
});

// --- Mages -------------------------------------------------------------------------------------------------------------

type MageKind = "wizard" | "cleric" | "warlock" | "shaman" | "druid" | "artificer";

function mageOf(kind: MageKind, [robe, trim, accent]: readonly Ramp[], s: number, next: () => number, id: string): FigureSpec {
  const h = human(next);
  const b = sized(ROBED, s);
  const elder = next() < 0.5;
  const grand = s >= 1.18;
  const hairRamp = elder ? rampOf(choose(next, ["#d8d8e0", "#b8b8c4", "#e8e0d0"])) : h.hair;
  const beard = elder && next() < 0.7 ? ({ ramp: hairRamp, style: choose(next, ["long", "full", "goatee"] as const) } as const) : undefined;
  const common = { build: b, skin: h.skin, hair: { ramp: hairRamp, style: choose(next, ["long", "bun", "crop", "swept", "bald", "ponytail"] as HairStyle[]) }, beard };
  const sleeves = "long" as const;
  switch (kind) {
    case "wizard":
      return person({
        ...common,
        name: "wizard",
        face: { spectacles: next() < 0.3 },
        headgear: next() < 0.65 ? { kind: "wizard", ramp: robe!, band: trim!, tall: grand ? 1.25 : 1 } : undefined,
        top: { style: "robe", ramp: robe!, trim: trim!, emblem: accent! },
        sleeves,
        skirt: { ramp: robe!, trim: trim! },
        cape: grand ? { ramp: accent!, trim: trim!, collar: true } : undefined,
        right: { kind: "staff", top: choose(next, ["crystal", "orb", "moon"] as const), glow: rampOf("#82b8f6") },
        left: next() < 0.6 ? { kind: "book", cover: accent! } : undefined,
        spark: rampOf("#82b8f6"),
      });
    case "cleric":
      return person({
        ...common,
        name: "cleric",
        headgear: next() < 0.5 ? { kind: "mitre", ramp: robe!, trim: trim! } : { kind: "hood", ramp: robe!, trim: trim! },
        top: { style: "robe", ramp: robe!, trim: trim!, emblem: GOLD },
        sleeves,
        skirt: { ramp: robe!, trim: trim! },
        cape: grand ? { ramp: accent!, trim: trim! } : undefined,
        amulet: { chain: GOLD, gem: accent! },
        right: { kind: "staff", top: "sun", glow: GOLD },
        left: next() < 0.4 ? { kind: "book", cover: trim! } : undefined,
        spark: rampOf("#fff0a0"),
      });
    case "warlock":
      return person({
        ...common,
        name: "warlock",
        face: { eyes: ARCANE_EYE },
        headgear: next() < 0.7 ? { kind: "hood", ramp: robe!, trim: trim! } : undefined,
        top: { style: "robe", ramp: robe!, trim: trim!, emblem: accent! },
        sleeves,
        skirt: { ramp: robe!, trim: trim!, ragged: true },
        cape: { ramp: trim!, ragged: true, collar: grand },
        right: { kind: "staff", top: choose(next, ["skull", "moon", "crystal"] as const), glow: rampOf("#b06ee6") },
        left: next() < 0.5 ? { kind: "book", cover: accent! } : undefined,
        spark: rampOf("#b06ee6"),
      });
    case "shaman":
      return person({
        ...common,
        name: "shaman",
        face: { paint: at(robe!, 2), mouth: "grim" },
        headgear: { kind: "feathers", ramp: choose(next, [full(C.RED), full(C.GOLD), rampOf("#e8e4d8")]), band: trim! },
        top: { style: "fur", ramp: trim! },
        sleeves: "none",
        skirt: { ramp: robe!, trim: accent!, ragged: true },
        pauldrons: { ramp: trim!, fur: true },
        amulet: { chain: BONE, gem: full(C.FIRE) },
        right: { kind: "staff", top: "flame" },
        spark: full(C.FIRE),
      });
    case "druid":
      return person({
        ...common,
        name: "druid",
        headgear: next() < 0.5 ? { kind: "leaves", ramp: full(C.LEAF) } : { kind: "antlers", ramp: WOOD },
        top: { style: "robe", ramp: robe!, trim: trim! },
        sleeves,
        skirt: { ramp: robe!, trim: trim!, ragged: true },
        cape: { ramp: accent!, ragged: true },
        right: { kind: "staff", top: choose(next, ["leaves", "crook"] as const) },
        spark: full(C.LEAF),
      });
    case "artificer":
      return person({
        ...common,
        name: "artificer",
        headgear: { kind: "goggles", ramp: WOOD, lens: rampOf("#62a4c2") },
        top: { style: "coat", ramp: robe!, trim: trim!, under: accent! },
        legs: SLATE,
        boots: { ramp: WOOD, height: 3 },
        gloves: { ramp: WOOD, trim: GOLD },
        right: { kind: "wrench", metal: GOLD },
        relic: { body: GOLD, gem: rampOf("#62a4c2") },
        extras: [part("pack", [6, 6, 3], [0, b.torso[1], -b.torso[2] / 2], [-3, -6, -3], { front: layer(cloth(WOOD, 3), rows(0, 0, at(GOLD, 3))), back: layer(cloth(WOOD, 3), (p) => { p.put(1, 2, at(GOLD, 4)); p.put(4, 2, at(rampOf("#62a4c2"), 5)); }), left: cloth(WOOD, 2), top: cloth(GOLD, 3, false) }, at(WOOD, 3), { parent: "torso" })],
        spark: rampOf("#62a4c2"),
      });
  }
}

const MAGES: readonly [MageKind, string, readonly string[]][] = [
  ["wizard", "a wizard of Tolaria: a pointed hat (or none), a trimmed robe, a staff with a crystal, orb or moon, often a book", ["#2f5fa8", "#f4ecc2", "#a97fd0"]],
  ["cleric", "a cleric of Benalia: a mitre or a hood, a white robe, a sun-topped staff, an amulet", ["#f2efe6", "#f1b44c", "#93c8dc"]],
  ["warlock", "a warlock of the Morass: hooded, violet-eyed, a ragged robe and cape, a staff with a skull, moon or crystal", ["#2a2b36", "#4b2f5e", "#7a1f24"]],
  ["shaman", "a Keldon shaman: war paint, a feathered headband, furs over a ragged robe, a staff of fire", ["#8f2f2f", "#4a3122", "#f1b44c"]],
  ["druid", "a druid of the elfhame: leaves or antlers on the head, a robe, a ragged cloak, a staff in leaf", ["#6b963e", "#8f6340", "#2a4524"]],
  ["artificer", "an artificer: goggles, a work coat, gloves, a wrench, a pack of tools and a floating device", ["#8f6340", "#f1b44c", "#62a4c2"]],
];
for (const [kind, about, palette] of MAGES) defineMob({ id: kind, about, slots: ["robe", "trim", "accent"], palette, build: (r, s, n, id) => mageOf(kind, r, s, n, id) });

defineMob({
  id: "thrull",
  about: "a thrull: a hunched, hairless, grey servant-creature of the Morass in a robe, its eyes glowing",
  slots: ["skin", "robe", "trim"],
  palette: ["#8c909c", "#4b2f5e", "#c9ced8"],
  build: ([skin, robe, trim], s, next) =>
    person({
      name: "thrull",
      build: sized({ head: [12, 9, 11], torso: [10, 7, 6], arm: [3, 9, 3], leg: [3, 5, 3] }, s),
      skin: skin!,
      face: { eyes: ARCANE_EYE, mouth: "grim", brow: true, blush: false },
      top: { style: "robe", ramp: robe!, trim: trim! },
      sleeves: "long",
      skirt: { ramp: robe!, trim: trim!, ragged: true },
      right: { kind: "staff", top: choose(next, ["skull", "crystal"] as const), glow: rampOf("#b06ee6") },
      spark: rampOf("#b06ee6"),
      hunch: 0.35,
      headTilt: -0.3,
      stride: 0.4,
    }),
});

// --- Djinn, spirits, wraiths, elementals -------------------------------------------------------------------------

defineMob({
  id: "djinn",
  about: "a djinn: a great bare-chested upper body, a topknot and earrings, arms folded or raised, trailing into smoke instead of legs",
  slots: ["skin", "cloth", "trim"],
  palette: ["#5b8fd6", "#f4ecc2", "#f1b44c"],
  build: ([skin, clothR, trim], s, next, id) => {
    const b = sized({ head: [12, 10, 10], torso: [14, 9, 8], arm: [5, 10, 5], leg: [5, 1, 5] }, s);
    const wizardly = has(id, "arcanis", "mage");
    return person({
      name: "djinn",
      build: b,
      skin: skin!,
      face: { eyes: SPIRIT_EYE, mouth: "grim", brow: true },
      hair: { ramp: rampOf("#1e1a30"), style: "topknot" },
      beard: next() < 0.5 ? { ramp: rampOf("#1e1a30"), style: "goatee" } : undefined,
      headgear: wizardly ? { kind: "turban", ramp: clothR!, gem: trim! } : undefined,
      top: wizardly ? { style: "robe", ramp: clothR!, trim: trim! } : { style: "bare", ramp: skin! },
      sleeves: wizardly ? "long" : "none",
      belt: clothR!,
      noLegs: true,
      gloves: { ramp: trim! },
      right: wizardly ? { kind: "book", cover: trim! } : undefined,
      extras: chain({ name: "smoke", parent: "torso", at: [0, 0, 0], count: 4, first: [b.torso[0] - 2, 4, b.torso[2] - 1], last: [3, 3, 3], down: true, faces: (i) => allSides(layer(cloth(skin!, 3 - Math.min(2, i)), speckle(skin!, [4, 5], 0.25, i), i === 3 ? ragged(2, 1) : undefined)), fill: at(skin!, 3), droop: 0.15, sway: 0.18, axis: "z", rate: 2 }),
      spark: rampOf("#a8f4ff"),
      hover: 6,
      armSwing: 0.2,
      footprint: 0.6 * s,
    });
  },
});

function spiritOf(name: string, [body, glow, dark]: readonly Ramp[], s: number, hooded: boolean): FigureSpec {
  const b = sized({ head: [11, 10, 10], torso: [10, 8, 6], arm: [3, 10, 3], leg: [4, 1, 4] }, s);
  const B = body!;
  return person({
    name,
    build: b,
    skin: hooded ? dark! : B,
    face: { eyes: hooded ? GHOUL_EYE : SPIRIT_EYE, mouth: hooded ? "none" : "grim", blush: false },
    hair: hooded ? undefined : { ramp: rampOf(at(B, 5)), style: "wild" },
    headgear: hooded ? { kind: "hood", ramp: B, trim: dark! } : undefined,
    top: { style: "robe", ramp: B, trim: hooded ? dark! : glow! },
    sleeves: "long",
    skirt: { ramp: B, trim: hooded ? dark! : B, length: 3, ragged: true },
    gloves: hooded ? { ramp: dark! } : undefined,
    noLegs: true,
    extras: chain({ name: "wisp", parent: "torso", at: [0, -2, 0], count: 3, first: [b.torso[0] - 1, 4, b.torso[2] - 1], last: [2, 3, 2], down: true, faces: (i) => allSides(layer(cloth(B, 3 - i), ragged(2, 1, i))), fill: at(B, 3), sway: 0.25, axis: "z", rate: 2.4 }),
    spark: rampOf("#a8f4ff"),
    hover: 5,
    armSwing: 0.15,
    stride: 0.2,
  });
}

defineMob({ id: "spirit", about: "a spirit: a pale floating figure, wild hair and robes trailing into wisps, its eyes glowing", slots: ["body", "glow", "dark"], palette: ["#93c8dc", "#f4ecc2", "#5b8fd6"], build: (r, s) => spiritOf("spirit", r, s, false) });
defineMob({ id: "wraith", about: "a wraith: a hooded shadow, its robe ragged into wisps, two eyes in the dark of its hood", slots: ["robe", "glow", "dark"], palette: ["#5d6646", "#7a1f24", "#0d0f14"], build: (r, s) => spiritOf("wraith", r, s, true) });

defineMob({
  id: "elemental",
  about: "an air elemental: a column of turning cloud, a face of wind in it, cloudy arms",
  slots: ["cloud", "eyes", "shadow"],
  palette: ["#c8e0f0", "#f4ecc2", "#5b8fd6"],
  build: ([cloud, , shadow], s) => {
    const b = sized({ head: [12, 10, 10], torso: [12, 8, 9], arm: [4, 11, 4], leg: [4, 1, 4] }, s);
    const cl = cloud!;
    const puff = (i: number): Paint => layer(cloth(cl, 4 - (i % 2)), (p) => { for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y * 2 + i) % 6 === 0) p.put(x, y, at(cl, 6)); else if ((x * 2 + y + i) % 7 === 0) p.put(x, y, at(shadow!, 3)); });
    return person({
      name: "elemental",
      build: b,
      skin: cl,
      ownHead: { faces: { front: layer(puff(0), eyes(b.head[0], b.head[1] - 4, { color: at(shadow!, 1) }), (p) => p.hline(Math.floor(b.head[0] / 2) - 2, b.head[1] - 2, 4, at(shadow!, 2))), back: puff(1), left: puff(2), right: puff(3), top: puff(4) } },
      top: { style: "robe", ramp: cl, trim: cl },
      sleeves: "long",
      belt: null,
      noLegs: true,
      extras: chain({ name: "swirl", parent: "torso", at: [0, 0, 0], count: 4, first: [b.torso[0] - 1, 4, b.torso[2] - 1], last: [3, 3, 3], down: true, faces: (i) => allSides(puff(i + 5)), fill: at(cl, 4), sway: 0.35, axis: "y", rate: 4 }),
      spark: rampOf("#a8f4ff"),
      hover: 5,
      armSwing: 0.3,
      footprint: 0.55 * s,
    });
  },
});

// --- Yetis, apes, treefolk, constructs, golems ---------------------------------------------------------------------

function shaggy(name: string, [furR, face, accent]: readonly Ramp[], s: number, ape: boolean, id: string): FigureSpec {
  const b = sized({ head: [12, 10, 10], torso: [15, 9, 9], arm: [6, 13, 6], leg: [5, 5, 5] }, s);
  const F = furR!;
  const [w, h] = b.head;
  const faceP: Paint = layer(fur(F, 3), (p) => p.box(2, h - 7, w - 4, 6, at(face!, 3)), eyes(w, h - 5, { color: ape ? 0x3a2010 : 0x2050a0, size: 1 }), (p) => { p.hline(3, h - 3, w - 6, at(face!, 1)); if (!ape) { p.put(3, h - 2, 0xffffff); p.put(w - 4, h - 2, 0xffffff); } }, rows(0, 1, at(F, 4)));
  const shaman = has(id, "elder", "shaman", "mage");
  return person({
    name,
    build: b,
    skin: F,
    ownHead: { faces: { front: faceP, back: fur(F, 3), left: fur(F, 3), right: fur(F, 3), top: fur(F, 4) } },
    top: { style: "fur", ramp: F },
    sleeves: "none",
    sleeve: F,
    legs: F,
    belt: null,
    gloves: { ramp: face! },
    boots: { ramp: face!, height: 1 },
    amulet: shaman ? { chain: BONE, gem: accent! } : undefined,
    headgear: shaman ? { kind: "feathers", ramp: accent!, band: BONE } : undefined,
    right: shaman ? { kind: "staff", top: "leaves" } : undefined,
    spark: full(C.LEAF),
    stride: 0.5,
    armSwing: 0.5,
    hunch: ape ? 0.45 : 0.25,
    headTilt: ape ? -0.35 : -0.1,
    footprint: 0.6 * s,
  });
}

defineMob({ id: "yeti", about: "a yeti: shaggy white fur, a blue face, fangs, long arms, hunched", slots: ["fur", "face", "accent"], palette: ["#e8ecf4", "#93c8dc", "#5b8fd6"], build: (r, s, _n, id) => shaggy("yeti", r, s, false, id) });
defineMob({ id: "ape", about: "a great ape: dark fur, a bare face and hands, knuckles near the ground; a shaman wears bone and feathers and carries a leafy staff", slots: ["fur", "face", "accent"], palette: ["#2a2b36", "#8c909c", "#3e9a4a"], build: (r, s, _n, id) => shaggy("ape", r, s, true, id) });

defineMob({
  id: "treefolk",
  about: "a treefolk: a trunk of bark for a body, a face in it, root legs, branch arms and a crown of leaves",
  slots: ["leaves", "bark", "accent"],
  palette: ["#3e9a4a", "#8f6340", "#d6ae7e"],
  build: ([leaves, barkR, accent], s, next) => {
    const b = sized({ head: [12, 8, 10], torso: [14, 12, 10], arm: [4, 13, 4], leg: [6, 6, 6] }, s);
    const B = barkR!;
    const L = leaves!;
    const [w, h, d] = b.head;
    const face: Paint = layer(bark(B, 3), (p) => { p.box(2, h - 5, 3, 2, C.INK); p.box(w - 5, h - 5, 3, 2, C.INK); p.put(3, h - 5, EMBER_EYE); p.put(w - 4, h - 5, EMBER_EYE); p.hline(4, h - 2, w - 8, at(B, 0)); });
    const crown: PartSpec[] = [part("crown", [w + 8, 8, d + 8], [0, h - 2, -1], [-(w + 8) / 2, 0, -(d + 8) / 2], allSides(layer(speckle(L, [2, 5, 6], 0.35, 3), cloth(L, 4), speckle(L, [2, 5, 6], 0.35, 3), (p) => { for (let x = 0; x < p.width; x++) if (x % 3 === 0) p.put(x, p.height - 1, 0, 0); p.put(2, 2, at(accent!, 4)); p.put(p.width - 4, 4, at(accent!, 4)); }), layer(cloth(L, 5, false), speckle(L, [3, 6], 0.4, 4))), at(L, 4), { parent: "head", round: 3 })];
    const twigs: PartSpec[] = [];
    for (const side of [1, -1] as const) twigs.push(part(side > 0 ? "twig.l" : "twig.r", [5, 2, 2], [0, -b.arm[1] + 4, 0], side > 0 ? [0, 0, -1] : [-5, 0, -1], solid(B, 3), at(B, 3), { parent: side > 0 ? "arm.l" : "arm.r", tilt: [0, side * 0.6] }), part(side > 0 ? "leaf.l" : "leaf.r", [4, 3, 3], [side * 5, 1, 0], [-2, 0, -1.5], solid(L, 4), at(L, 4), { parent: side > 0 ? "twig.l" : "twig.r", round: 1 }));
    return person({
      name: "treefolk",
      build: b,
      skin: B,
      ownHead: { faces: { front: face, back: bark(B, 3), left: bark(B, 3), right: bark(B, 3), top: bark(B, 4) }, parts: crown },
      top: { style: "bare", ramp: B },
      sleeves: "none",
      sleeve: B,
      legs: B,
      belt: null,
      boots: { ramp: rampOf(at(B, 1)), height: 2, big: true },
      extras: twigs,
      spark: full(C.LEAF),
      stride: 0.4,
      armSwing: 0.35,
      headShape: { steps: 2, jaw: 0, dome: 0.02, back: 0.02 },
      footprint: 0.6 * s,
    });
  },
});

/** Faces of metal or stone for a construct's parts. */
function made(r: Ramp, stoneLike: boolean): Paint {
  return stoneLike ? stone(r, 3) : plates(r, 3, 4);
}

function constructOf(name: string, [body, glow, dark]: readonly Ramp[], s: number, stoneLike: boolean, id: string): FigureSpec {
  const big = s >= 1.6 || has(id, "leveler");
  const b = sized(stoneLike ? { head: [11, 9, 10], torso: [16, 11, 10], arm: [6, 13, 6], leg: [6, 7, 6] } : big ? { head: [11, 9, 10], torso: [15, 10, 9], arm: [5, 12, 5], leg: [5, 8, 5] } : { head: [11, 9, 10], torso: [11, 8, 7], arm: [4, 9, 4], leg: [4, 6, 4] }, s);
  const M = body!;
  const G = glow!;
  const [w, h] = b.head;
  const face: Paint = layer(made(M, stoneLike), (p) => {
    p.box(1, h - 6, w - 2, 3, at(dark!, 2));
    const ey = h - 5;
    if (stoneLike || next3(id) === 0) {
      p.box(2, ey, 2, 1, at(G, 6));
      p.box(w - 4, ey, 2, 1, at(G, 6));
    } else p.box(Math.floor(w / 2) - 2, ey, 4, 1, at(G, 6));
  });
  const three = has(id, "triskelion");
  const extras: PartSpec[] = [part("core", [4, 4, 1], [0, b.torso[1] - 4, b.torso[2] / 2], [-2, -2, 0], { front: glowing(G) }, at(G, 5), { parent: "torso", glow: true, round: 0 })];
  if (three) extras.push(part("arm.3", [b.arm[0], b.arm[1], b.arm[2]], [0, b.torso[1] - 1, -b.torso[2] / 2 - 1], [-b.arm[0] / 2, -b.arm[1] + 1, -b.arm[2] / 2], allSides(made(M, false)), at(M, 4), { parent: "torso", tilt: [-2.4, 0], motion: { kind: "tail", delay: 0, amount: 0.3, axis: "x", rate: 3 } }));
  if (big) extras.push(part("tower", [6, 6, 6], [0, b.torso[1], -2], [-3, 0, -3], allSides(made(M, false), cloth(dark!, 3, false)), at(M, 3), { parent: "torso" }), part("tower.light", [2, 2, 2], [0, 6, 0], [-1, 0, -1], allSides(glowing(G)), at(G, 6), { parent: "tower", glow: true, round: 0 }));
  return person({
    name,
    build: b,
    skin: M,
    ownHead: { faces: { front: face, back: made(M, stoneLike), left: made(M, stoneLike), right: made(M, stoneLike), top: cloth(M, 5, false) } },
    top: { style: "plate", ramp: M, trim: dark! },
    sleeves: "long",
    sleeve: M,
    legs: M,
    belt: null,
    boots: { ramp: dark!, height: 2, big: true },
    pauldrons: stoneLike ? undefined : { ramp: M, trim: dark! },
    gloves: { ramp: dark! },
    right: stoneLike ? undefined : has(id, "soldier", "yotian") ? { kind: "spear", head: M } : undefined,
    left: has(id, "soldier", "yotian") ? { kind: "shield", face: M, trim: dark!, emblem: G, round: true } : undefined,
    extras,
    spark: G,
    stride: 0.45,
    armSwing: 0.35,
    headShape: { steps: 2, jaw: 0.02, dome: 0.02, back: 0.04 },
    footprint: 0.55 * s,
  });
}

const next3 = (id: string) => id.length % 3;

defineMob({ id: "construct", about: "a construct: a riveted metal soldier, glowing eyes and a glowing core; a Triskelion's three arms, a Leveler's tower on its back", slots: ["metal", "glow", "dark"], palette: ["#8c909c", "#62a4c2", "#2a2b36"], build: (r, s, _n, id) => constructOf("construct", r, s, false, id) });
defineMob({ id: "golem", about: "a golem: blocks of stone or obsidian, a glowing core and eyes", slots: ["stone", "glow", "dark"], palette: ["#4a4f58", "#f1b44c", "#1a1a24"], build: (r, s, _n, id) => constructOf("golem", r, s, true, id) });

export type { V3 };
export { bigEars, quiver, has, human, sized, luma, SLIM, BRUTE, ROBED, SOLDIER, SMALL };
