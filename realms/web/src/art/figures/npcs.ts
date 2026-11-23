import * as C from "../paint/colors";
import type { Palette, Ramp } from "../paint/palette";
import { seeded } from "../paint/pixmap";
import type { Held } from "./held";
import { choose } from "./mobs";
import { BODY_NAMES, BUILDS, type HairStyle, type Headgear, type Person, type Top, person } from "./person";
import { SKINS, full, hashOf, rampOf } from "./ramps";
import type { FigureSpec } from "./rig";

// The people of the towns (design.md A6): townsfolk dressed as their region dresses, guards, shopkeepers, innkeepers,
// the ferryman and the planar traders. Each is a person (person.ts) chosen from a seed - the NPC's `seed` in the world
// data - so a street of them varies (body, skin and hair, clothes, a hat or none) and each is the same on every visit.
// A palette given with one overrides its main ramps by slot (`cloth`, `trim`, `hair`, `skin`).

export type Region = "benalia" | "orvada" | "caligo" | "keld" | "llanowar";
export const REGIONS: readonly Region[] = ["benalia", "orvada", "caligo", "keld", "llanowar"];

interface RegionStyle {
  readonly cloth: readonly string[];
  readonly trim: readonly string[];
  readonly tops: readonly Top["style"][];
  readonly hats: readonly ((r: Ramp, t: Ramp) => Headgear | undefined)[];
  /** Elves: long ears and their own skins. */
  readonly elves?: boolean;
  readonly skins?: readonly number[];
  readonly bodies?: readonly (typeof BODY_NAMES)[number][];
}

const STYLES: Readonly<Record<Region, RegionStyle>> = {
  benalia: {
    cloth: ["#f2efe6", "#3a5f8f", "#c8343a", "#e0a02c", "#2e8c80", "#8a6a43"],
    trim: ["#f1b44c", "#f2efe6", "#3a5f8f", "#c8343a"],
    tops: ["tunic", "dress", "vest", "shirt"],
    hats: [() => undefined, () => undefined, (r) => ({ kind: "scarf", ramp: r }), () => ({ kind: "wide", ramp: full(C.STRAW) })],
  },
  orvada: {
    cloth: ["#2f5fa8", "#5b8fd6", "#3d8fa8", "#f4ecc2", "#93c8dc", "#2a2b5e"],
    trim: ["#f4ecc2", "#f1b44c", "#c9ced8"],
    tops: ["robe", "coat", "tunic", "shirt"],
    hats: [() => undefined, () => undefined, (r, t) => ({ kind: "wizard", ramp: r, band: t, tall: 0.75 }), (r) => ({ kind: "cap", ramp: r, brim: false })],
  },
  caligo: {
    cloth: ["#2a2b36", "#2a2a2d", "#5d6646", "#3a3442", "#6e4436"],
    trim: ["#8c909c", "#7a1f24", "#c9a46a"],
    tops: ["coat", "rags", "leather", "dress"],
    hats: [(r, t) => ({ kind: "hood", ramp: r, trim: t }), (r) => ({ kind: "hood", ramp: r }), () => undefined],
    skins: [0, 0, 1, 2],
  },
  keld: {
    cloth: ["#8f2f2f", "#c8432c", "#6e4436", "#4a3122", "#e0703a"],
    trim: ["#2e1f17", "#f1b44c", "#9aa0aa"],
    tops: ["fur", "leather", "tunic", "fur"],
    hats: [() => undefined, () => undefined, () => ({ kind: "horned", ramp: full(C.IRON) })],
    bodies: ["broad", "stocky", "tall", "broad"],
  },
  llanowar: {
    cloth: ["#3e9a4a", "#4f7a34", "#2a4524", "#8f6340", "#6b963e"],
    trim: ["#d6ae7e", "#2a4524", "#f1b44c"],
    tops: ["leather", "tunic", "robe", "dress"],
    hats: [() => undefined, () => undefined, (r) => ({ kind: "leaves", ramp: full(C.LEAF) }), (r) => ({ kind: "hood", ramp: r })],
    elves: true,
    bodies: ["lithe", "tall", "lithe", "tall"],
  },
};

const ELF_SKINS = [rampOf("#e8b88a", 4), rampOf("#c89468", 4), rampOf("#a87650", 4)];
const HAIRS: readonly HairStyle[] = ["crop", "swept", "long", "ponytail", "bun", "spiky", "bald", "wild"];

/** A palette's ramp for a slot, or the given one. */
const over = (p: Palette | undefined, slot: string, r: Ramp): Ramp => (p?.[slot] ? full(p[slot]!) : r);

/** A townsperson of a region, varied by its seed. */
function townsperson(region: Region, seed: number, palette: Palette | undefined, role: "townsfolk" | "guard"): Person {
  const next = seeded(hashOf(`${region}:${role}:${seed}`));
  const st = STYLES[region];
  const body = choose(next, st.bodies ?? BODY_NAMES);
  const sk = st.skins ? SKINS[choose(next, st.skins)]! : choose(next, SKINS);
  const skin = over(palette, "skin", st.elves ? choose(next, ELF_SKINS) : sk.skin);
  const hair = over(palette, "hair", st.elves ? choose(next, [rampOf("#4a2e1a"), rampOf("#2a2a3a"), rampOf("#c8a050"), rampOf("#8a4a20")]) : sk.hair);
  const cloth = over(palette, "cloth", rampOf(choose(next, st.cloth)));
  const trim = over(palette, "trim", rampOf(choose(next, st.trim)));
  const style = choose(next, HAIRS);
  const top = choose(next, st.tops);
  const hat = choose(next, st.hats)(cloth, trim);
  const beard = (body === "broad" || body === "stocky") && next() < 0.45 ? { style: choose(next, ["full", "short", "moustache", "long"] as const) } : undefined;
  const legs = rampOf(choose(next, ["#3a3e52", "#5a3026", "#4a3122", "#343e64", "#2a2b36"]));
  const b = BUILDS[body];
  const base: Person = {
    name: `${role}:${region}`,
    build: b,
    skin,
    ears: st.elves ? "long" : undefined,
    hair: { ramp: hair, style },
    beard,
    headgear: hat,
    top: { style: top, ramp: cloth, trim, under: rampOf(choose(next, ["#f4ecd4", "#d8d0cc", "#c9a46a"])) },
    legs,
    boots: { ramp: rampOf(choose(next, ["#5a3026", "#3c2022", "#24141c"])), height: 2 },
    skirt: top === "dress" || top === "robe" ? { ramp: cloth, trim } : top === "coat" && next() < 0.5 ? { ramp: cloth, trim, length: 3 } : undefined,
    cape: region === "caligo" && next() < 0.6 ? { ramp: rampOf("#2a2b36"), ragged: true } : region === "llanowar" && next() < 0.5 ? { ramp: full(C.LEAF), ragged: true } : undefined,
    face: { spectacles: region === "orvada" && next() < 0.35 },
    stride: 0.6,
    armSwing: 0.5,
  };
  if (role === "townsfolk") {
    const held: (Held | undefined)[] = [undefined, undefined, undefined, { kind: "book", cover: trim }, { kind: "lantern" }, { kind: "torch" }];
    return { ...base, right: region === "orvada" ? choose(next, [undefined, { kind: "book", cover: trim } as Held]) : choose(next, held.slice(0, 4)) };
  }
  // A guard: armed and armored in the region's way.
  const iron = full(C.IRON);
  switch (region) {
    case "benalia":
      return { ...base, name: "guard:benalia", headgear: { kind: "open-helm", ramp: iron, trim: full(C.GOLD), plume: full(C.BLUE) }, top: { style: "tabard", ramp: full(C.CLOTH_WHITE), trim: full(C.BLUE), under: iron, emblem: full(C.GOLD) }, legs: iron, skirt: undefined, right: { kind: "spear", pennant: full(C.BLUE) }, left: { kind: "shield", face: full(C.BLUE), trim: full(C.GOLD), emblem: full(C.CLOTH_WHITE) }, boots: { ramp: full(C.WOOD), height: 3 } };
    case "orvada":
      return { ...base, name: "guard:orvada", headgear: { kind: "cap", ramp: iron }, top: { style: "coat", ramp: full(C.BLUE), trim: full(C.GOLD), under: full(C.CLOTH_WHITE) }, skirt: { ramp: full(C.BLUE), trim: full(C.GOLD), length: 3 }, right: { kind: "spear", head: full(C.GOLD) }, boots: { ramp: full(C.SLATE), height: 3 } };
    case "caligo":
      return { ...base, name: "guard:caligo", headgear: { kind: "hood", ramp: rampOf("#2a2b36"), trim: rampOf("#7a1f24") }, top: { style: "mail", ramp: iron }, cape: { ramp: rampOf("#2a2b36"), trim: rampOf("#7a1f24"), ragged: true }, skirt: undefined, right: { kind: "scythe" }, boots: { ramp: rampOf("#24141c"), height: 3 } };
    case "keld":
      return { ...base, name: "guard:keld", build: BUILDS.broad, headgear: { kind: "horned", ramp: iron }, top: { style: "fur", ramp: rampOf("#6e4436") }, pauldrons: { ramp: rampOf("#4a3122"), fur: true }, skirt: { ramp: rampOf("#8f2f2f"), length: 3, ragged: true }, right: { kind: "axe", big: true }, left: { kind: "shield", face: rampOf("#8f2f2f"), trim: iron, round: true } };
    case "llanowar":
      return { ...base, name: "guard:llanowar", headgear: undefined, top: { style: "leather", ramp: rampOf("#2a4524"), trim: rampOf("#d6ae7e") }, cape: { ramp: full(C.LEAF), ragged: true }, skirt: { ramp: rampOf("#2a4524"), length: 2, ragged: true }, left: { kind: "bow" }, right: undefined };
  }
}

/** A shopkeeper: a vest and a long apron, sleeves rolled. */
function shopkeeper(seed: number, palette: Palette | undefined): Person {
  const next = seeded(hashOf(`shopkeeper:${seed}`));
  const body = choose(next, BODY_NAMES);
  const sk = choose(next, SKINS);
  const cloth = over(palette, "cloth", rampOf(choose(next, ["#6e3c98", "#2e8c80", "#c8343a", "#3462c8", "#7c4630"])));
  return {
    name: "shopkeeper",
    build: BUILDS[body],
    skin: over(palette, "skin", sk.skin),
    hair: { ramp: over(palette, "hair", sk.hair), style: choose(next, ["crop", "bun", "bald", "swept"] as HairStyle[]) },
    beard: body !== "lithe" && next() < 0.5 ? { style: choose(next, ["moustache", "full", "short"] as const) } : undefined,
    headgear: next() < 0.3 ? { kind: "cap", ramp: cloth, brim: false } : undefined,
    face: { spectacles: next() < 0.4 },
    top: { style: "vest", ramp: cloth, under: full(C.CLOTH_WHITE) },
    sleeves: "short",
    legs: full(C.SLATE),
    boots: { ramp: full(C.WOOD), height: 2 },
    skirt: { ramp: rampOf("#e8e4d8"), trim: cloth, length: BUILDS[body].leg[1] - 2 },
    right: next() < 0.5 ? { kind: "book", cover: full(C.WOOD) } : undefined,
    stride: 0.5,
  };
}

/** An innkeeper: an apron over a shirt, sleeves rolled, a lantern at evening. */
function innkeeper(seed: number, palette: Palette | undefined): Person {
  const next = seeded(hashOf(`innkeeper:${seed}`));
  const body = choose(next, ["broad", "stocky", "broad", "tall"] as const);
  const sk = choose(next, SKINS);
  const shirt = over(palette, "cloth", rampOf(choose(next, ["#e8e4d8", "#c9a46a", "#93c8dc"])));
  return {
    name: "innkeeper",
    build: BUILDS[body],
    skin: over(palette, "skin", sk.skin),
    hair: { ramp: over(palette, "hair", sk.hair), style: choose(next, ["crop", "bun", "bald", "ponytail"] as HairStyle[]) },
    beard: next() < 0.5 ? { style: choose(next, ["full", "moustache"] as const) } : undefined,
    headgear: next() < 0.35 ? { kind: "scarf", ramp: rampOf(choose(next, ["#c8343a", "#2e8c80", "#e0a02c"])) } : undefined,
    top: { style: "shirt", ramp: shirt, trim: shirt },
    sleeves: "short",
    legs: full(C.WOOD),
    belt: full(C.WOOD),
    boots: { ramp: full(C.DARKWOOD), height: 2 },
    skirt: { ramp: rampOf("#f4ecd4"), trim: rampOf("#c9a46a"), length: BUILDS[body].leg[1] - 1 },
    right: next() < 0.5 ? { kind: "lantern" } : undefined,
    stride: 0.5,
  };
}

/** The ferryman: a wide hat, a long weathered coat, a pole. */
function ferryman(seed: number, palette: Palette | undefined): Person {
  const next = seeded(hashOf(`ferryman:${seed}`));
  const sk = choose(next, SKINS);
  const coat = over(palette, "cloth", rampOf("#3a4a5a"));
  return {
    name: "ferryman",
    build: BUILDS.tall,
    skin: over(palette, "skin", sk.skin),
    hair: { ramp: next() < 0.6 ? rampOf("#c8c8d0") : sk.hair, style: choose(next, ["long", "crop", "ponytail"] as HairStyle[]) },
    beard: next() < 0.7 ? { ramp: rampOf("#c8c8d0"), style: choose(next, ["long", "full", "short"] as const) } : undefined,
    headgear: next() < 0.8 ? { kind: "wide", ramp: full(C.STRAW), band: rampOf("#3a4a5a") } : { kind: "hood", ramp: coat },
    top: { style: "coat", ramp: coat, trim: rampOf("#2a2b36"), under: rampOf("#8a6a43") },
    legs: rampOf("#2a2b36"),
    boots: { ramp: full(C.DARKWOOD), height: 4 },
    skirt: { ramp: coat, trim: rampOf("#2a2b36"), length: BUILDS.tall.leg[1] - 2, open: rampOf("#2a2b36"), ragged: true },
    right: { kind: "pole" },
    left: { kind: "lantern", light: full(C.FIRE) },
    stride: 0.45,
    hunch: 0.1,
  };
}

/** A planar trader: a turban, a patterned robe in far-off colors, a glowing curio orbiting. */
function planarTrader(seed: number, palette: Palette | undefined): Person {
  const next = seeded(hashOf(`planar-trader:${seed}`));
  const sk = choose(next, SKINS);
  const robe = over(palette, "cloth", rampOf(choose(next, ["#a97fd0", "#2e8c80", "#e0703a", "#62a4c2"])));
  const trim = over(palette, "trim", rampOf(choose(next, ["#f1b44c", "#f4ecc2", "#c8343a"])));
  return {
    name: "planar-trader",
    build: BUILDS[choose(next, BODY_NAMES)],
    skin: over(palette, "skin", sk.skin),
    hair: { ramp: sk.hair, style: "crop" },
    beard: next() < 0.5 ? { style: choose(next, ["goatee", "long"] as const) } : undefined,
    headgear: { kind: "turban", ramp: trim, gem: robe },
    top: { style: "robe", ramp: robe, trim, emblem: trim },
    sleeves: "long",
    skirt: { ramp: robe, trim },
    cape: { ramp: trim, trim: robe, collar: true },
    amulet: { chain: full(C.GOLD), gem: rampOf("#62a4c2") },
    relic: { body: full(C.GOLD), gem: rampOf(choose(next, ["#a97fd0", "#62a4c2", "#7cff9c"])) },
    right: { kind: "staff", top: "orb", glow: rampOf("#a97fd0") },
    stride: 0.4,
  };
}

/** The NPC figures by id, each made from a palette and a seed. */
export const NPC_FIGURES: readonly { readonly id: string; readonly about: string; readonly make: (palette: Palette | undefined, seed: number) => FigureSpec }[] = [
  ...REGIONS.map((r) => ({ id: `townsfolk-${r}`, about: `a townsperson of ${r}, dressed as the region dresses, varied by its seed`, make: (p: Palette | undefined, s: number) => person(townsperson(r, s, p, "townsfolk")) })),
  ...REGIONS.map((r) => ({ id: `guard-${r}`, about: `a guard of ${r}, armed and armored in the region's way`, make: (p: Palette | undefined, s: number) => person(townsperson(r, s, p, "guard")) })),
  { id: "shopkeeper", about: "a shopkeeper: a vest and a long apron, sleeves rolled, spectacles on some", make: (p, s) => person(shopkeeper(s, p)) },
  { id: "innkeeper", about: "an innkeeper: an apron over a shirt, sleeves rolled, a lantern on some", make: (p, s) => person(innkeeper(s, p)) },
  { id: "ferryman", about: "the ferryman: a wide straw hat, a long weathered coat, a lantern and a pole", make: (p, s) => person(ferryman(s, p)) },
  { id: "planar-trader", about: "a planar trader: a turban, a robe in far-off colors, a glowing curio orbiting", make: (p, s) => person(planarTrader(s, p)) },
];
