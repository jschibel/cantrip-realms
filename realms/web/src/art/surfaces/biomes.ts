import type { Material } from "../paint/builder";
import * as C from "../paint/colors";
import { material } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import { Pixmap } from "../paint/pixmap";
import * as R from "../paint/ramps";
import "../paint/regions";
import * as G from "../paint/terrain";
import type { SurfaceLook } from "./index";

// The world's ground beyond the slice's street: every biome's surfaces, the roads and the waters (art/paint/terrain.ts
// paints them). Where two meet, the higher `priority` grows over the lower in the slice's ragged edge (render/ground.ts),
// so the ladder below decides how every pair of biomes meets:
//
//   -1    waters (holes): every bank grows over them
//    0    paving: flagstones, marble, Phyrexian plating
//    1    cobbles, setts, boardwalks
//    1.5  gravel
//    2    fields: wheat, furrows, straw, crop rows, stubble - equal, so fields meet each other in straight hedgeless seams
//    3    tracks: dirt, cart track, mud track, packed snow
//    3.3  bedrock, basalt; 3.4 salt; 3.5 ice; 3.6 lava crust - hard ground that soft ground creeps over
//    3.8  shingle, wet sand; 4 sand; 4.1 the waste; 4.2 swamp mud, mire; 4.4 scree
//    4.6  ford (shallow water over stones: its banks grow over it, it over the tracks)
//    4.8  the forest floor: loam, leaf litter, needles, moss
//    5    grass; 5.1 pasture; 5.2 plains; 5.3 meadow; 5.4 marsh; 5.5 tundra - the growing things over the bare
//    6    snow, over everything that grows; 6.5 ash, drifting over all of it
//    7    Phyrexian ground: the corruption creeps over every biome it meets
//
// Holes: render/ground.ts discards only the first hole surface of a block, so each hole's own picture is its liquid (a
// second hole in a block shows still water, not a gap).

/** The priority ladder, by name, for code that places surfaces (and for the slice's: grass 5, dirt 3, cobbles 1...). */
export const PRIORITY = {
  water: -1,
  paving: 0,
  cobbles: 1,
  gravel: 1.5,
  field: 2,
  track: 3,
  bedrock: 3.3,
  salt: 3.4,
  ice: 3.5,
  basalt: 3.6,
  shingle: 3.8,
  sand: 4,
  waste: 4.1,
  mud: 4.2,
  scree: 4.4,
  ford: 4.6,
  forest: 4.8,
  grass: 5,
  pasture: 5.1,
  plains: 5.2,
  meadow: 5.3,
  marsh: 5.4,
  tundra: 5.5,
  snow: 6,
  ash: 6.5,
  phyrexian: 7,
} as const;

/** Every surface by biome, for the gallery and for whoever lays out the world. The slice's are listed where they fit. */
export const SURFACE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  grassland: ["grass", "plains", "meadow", "pasture"],
  farmland: ["wheat", "furrows", "straw", "crop-rows", "stubble"],
  forest: ["forest-floor", "leaf-litter", "moss", "needles", "elf-moss"],
  swamp: ["swamp-mud", "mire", "mud", "marsh", "bog"],
  cold: ["tundra", "snow", "ice", "snow-track"],
  mountain: ["bedrock", "rock", "scree", "gravel"],
  coast: ["sand", "wet-sand", "shingle", "sea", "shallows", "ford"],
  fire: ["ash", "basalt", "lava"],
  waste: ["waste", "cracked-earth", "salt-flat"],
  phyrexian: ["phyrexian-ground", "plating", "oil"],
  roads: ["dirt", "road", "cart-track", "cobbles", "setts", "flagstones", "marble-paving", "mud-track", "boardwalk", "boardwalk-ns", "planks"],
  waters: ["stream", "river", "lake", "sea", "shallows", "bog", "lava", "oil", "ford"],
};

// --- Banks ---------------------------------------------------------------------------------------------------------------

type BankKind = "earth" | "rock" | "peat" | "ice" | "sand" | "basalt" | "masonry" | "metal";
const BANK_LOOKS: Readonly<Record<string, { readonly ramp: Ramp; readonly kind: BankKind; readonly fringe: Ramp | null }>> = {
  earth: { ramp: C.DIRT, kind: "earth", fringe: C.GRASS },
  "dry-earth": { ramp: C.DIRT, kind: "earth", fringe: R.PLAINS },
  loam: { ramp: R.LOAM, kind: "earth", fringe: R.MOSS },
  "bare-earth": { ramp: C.DIRT, kind: "earth", fringe: null },
  peat: { ramp: R.MUD, kind: "peat", fringe: R.REED },
  rock: { ramp: R.GRANITE, kind: "rock", fringe: null },
  "frozen-rock": { ramp: R.GRANITE, kind: "rock", fringe: R.TUNDRA },
  ice: { ramp: R.ICE, kind: "ice", fringe: R.SNOW },
  sand: { ramp: R.SAND, kind: "sand", fringe: null },
  basalt: { ramp: R.BASALT, kind: "basalt", fringe: null },
  waste: { ramp: R.WASTE, kind: "earth", fringe: null },
  masonry: { ramp: C.COBBLE, kind: "masonry", fringe: null },
  marble: { ramp: R.MARBLE, kind: "masonry", fringe: null },
  metal: { ramp: R.PHYREXIAN, kind: "metal", fringe: R.OIL },
};

/** Which bank each surface steps down with (render/terrain.ts draws banks on height steps), by bank look. */
export const BANKS: Readonly<Record<string, string>> = {
  grass: "earth", meadow: "earth", pasture: "earth", marsh: "peat", moss: "loam", "elf-moss": "loam",
  plains: "dry-earth", wheat: "dry-earth", furrows: "bare-earth", straw: "bare-earth", "crop-rows": "bare-earth", stubble: "dry-earth",
  dirt: "bare-earth", "cart-track": "bare-earth", road: "bare-earth", "mud-track": "peat",
  "forest-floor": "loam", "leaf-litter": "loam", needles: "loam",
  "swamp-mud": "peat", mire: "peat", mud: "peat", bog: "peat",
  tundra: "frozen-rock", snow: "ice", ice: "ice", "snow-track": "ice",
  bedrock: "rock", rock: "rock", scree: "rock", gravel: "rock",
  sand: "sand", "wet-sand": "sand", shingle: "sand", ford: "sand", sea: "sand", shallows: "sand",
  ash: "basalt", basalt: "basalt", lava: "basalt",
  waste: "waste", "cracked-earth": "waste", "salt-flat": "waste",
  "phyrexian-ground": "metal", plating: "metal", oil: "metal",
  cobbles: "masonry", setts: "masonry", flagstones: "masonry", "marble-paving": "marble", boardwalk: "peat", "boardwalk-ns": "peat", planks: "peat",
  stream: "earth", river: "earth", lake: "earth",
};

/** A surface's bank material, if it has one. */
export function bankOf(id: string): Material | undefined {
  const name = BANKS[id];
  const look = name ? BANK_LOOKS[name] : undefined;
  if (!look) return undefined;
  return material(`bank-${name}`, () => G.bank(look.ramp, look.kind, look.fringe), {});
}

type Define = (id: string, about: string, palette: Palette, look: (palette: Palette) => SurfaceLook) => void;

const ramp = (p: Palette, k: string): Ramp => p[k]!;

/** A liquid lying a little below its banks, sliding a texel at a time (as the slice's stream). */
function liquid(name: string, paint: () => Pixmap, rate: [number, number], step: [number, number], glowing = false): Material {
  const m = material(name, paint, glowing ? { glowing: true } : { flat: true });
  m.userData.scroll = { rate, step };
  return m;
}

export function defineBiomes(define: Define): void {
  // --- Grass -------------------------------------------------------------------------------------------------------------
  define("plains", "the open plains: dry gold-green grass, long blades", { grass: R.PLAINS }, (p) => ({
    picture: G.plains(ramp(p, "grass")),
    priority: PRIORITY.plains,
    tufts: 2,
    tuftRamp: ramp(p, "grass"),
  }));
  define("meadow", "a meadow: lush grass and wildflowers", { grass: C.GRASS }, (p) => ({ picture: G.meadow(ramp(p, "grass")), priority: PRIORITY.meadow, tufts: 4 }));
  define("pasture", "grazed pasture: short turf and clover", { grass: C.GRASS }, (p) => ({ picture: G.pasture(ramp(p, "grass")), priority: PRIORITY.pasture, tufts: 1 }));
  define("marsh", "marsh: wet grass and reeds over mud, water between", { grass: R.REED }, (p) => ({
    picture: G.marsh(ramp(p, "grass")),
    priority: PRIORITY.marsh,
    tufts: 2,
    tuftRamp: ramp(p, "grass"),
  }));

  // --- Farmland ------------------------------------------------------------------------------------------------------
  define("crop-rows", "a kitchen field: rows of cabbages and beans on dark earth (east-west)", { leaves: C.LEAF }, (p) => ({
    picture: G.cropRows(ramp(p, "leaves")),
    priority: PRIORITY.field,
  }));
  define("stubble", "a reaped field: pale earth and rows of cut straw", {}, () => ({ picture: G.stubble(), priority: PRIORITY.field }));

  // --- The forest floor ----------------------------------------------------------------------------------------------
  define("forest-floor", "a forest's floor: loam, moss, roots and twigs", { soil: R.LOAM, moss: R.MOSS }, (p) => ({
    picture: G.forestFloor(ramp(p, "soil"), ramp(p, "moss")),
    priority: PRIORITY.forest,
  }));
  define("leaf-litter", "fallen leaves in rust and gold over loam", { leaves: R.LITTER }, (p) => ({ picture: G.leafLitter(ramp(p, "leaves")), priority: PRIORITY.forest }));
  define("moss", "a carpet of moss in cushions", { moss: R.MOSS }, (p) => ({ picture: G.moss(ramp(p, "moss")), priority: PRIORITY.forest + 0.05 }));
  define("elf-moss", "Llanowar's bright moss under the elfhames", { moss: R.ELF_LEAF }, (p) => ({ picture: G.moss(ramp(p, "moss"), 141), priority: PRIORITY.forest + 0.05 }));
  define("needles", "a pine wood's floor: needles, cones, a little moss", { needles: R.NEEDLES }, (p) => ({ picture: G.needles(ramp(p, "needles")), priority: PRIORITY.forest }));

  // --- Swamp ---------------------------------------------------------------------------------------------------------
  define("swamp-mud", "swamp mud: wet and black, puddles, reed stubs", { mud: R.MUD }, (p) => ({ picture: G.swampMud(ramp(p, "mud")), priority: PRIORITY.mud }));
  define("mire", "the Morass's mire: oily violet-black, a sick sheen", { mud: R.MIRE }, (p) => ({ picture: G.mire(ramp(p, "mud")), priority: PRIORITY.mud + 0.05 }));
  define("bog", "bog water: a hole, murky brown-green water below", { water: R.BOG }, (p) => ({
    picture: G.seaPicture(ramp(p, "water"), 151),
    priority: PRIORITY.water,
    hole: true,
    under: { material: liquid(ramp(p, "water") === R.BOG ? "bog-water" : `bog-water@${rampKey(ramp(p, "water"))}`, () => G.waterOf(ramp(p, "water"), 152), [1, 3], [1 / 32, -1 / 32]), y: -0.1, spread: 0.75 },
  }));

  // --- Cold ----------------------------------------------------------------------------------------------------------
  define("tundra", "tundra: frost-bitten grass, lichen and pebbles", { grass: R.TUNDRA }, (p) => ({
    picture: G.tundra(ramp(p, "grass")),
    priority: PRIORITY.tundra,
    tuftRamp: ramp(p, "grass"),
  }));
  define("snow", "snow: soft drifts, blue in their hollows", { snow: R.SNOW }, (p) => ({ picture: G.snow(ramp(p, "snow")), priority: PRIORITY.snow }));
  define("ice", "ice: clear blue, cracked, dusted with snow; walked on", { ice: R.ICE }, (p) => ({ picture: G.ice(ramp(p, "ice")), priority: PRIORITY.ice }));

  // --- Stone ---------------------------------------------------------------------------------------------------------
  define("bedrock", "mountain bedrock: granite slabs, cracks, lichen", { stone: R.GRANITE }, (p) => ({ picture: G.bedrock(ramp(p, "stone")), priority: PRIORITY.bedrock }));
  define("scree", "scree: loose broken stones down a slope", { stone: R.GRANITE }, (p) => ({ picture: G.scree(ramp(p, "stone")), priority: PRIORITY.scree }));
  define("gravel", "a gravel road or yard", {}, () => ({ picture: G.gravel(), priority: PRIORITY.gravel }));

  // --- Coast ---------------------------------------------------------------------------------------------------------
  define("sand", "sand: warm and pale, wind ripples, shells", { sand: R.SAND }, (p) => ({ picture: G.sand(ramp(p, "sand")), priority: PRIORITY.sand }));
  define("wet-sand", "wet sand at the tide's edge, foam lines", { sand: R.WETSAND }, (p) => ({ picture: G.wetSand(ramp(p, "sand")), priority: PRIORITY.shingle }));
  define("shingle", "a shingle beach: rounded pebbles", {}, () => ({ picture: G.shingle(), priority: PRIORITY.shingle }));
  define("ford", "a ford: shallow water over pebbles, walked through", {}, () => ({ picture: G.ford(), priority: PRIORITY.ford }));

  // --- Fire ----------------------------------------------------------------------------------------------------------
  define("ash", "ash and cinders, a few embers glowing", { ash: R.ASH }, (p) => ({ picture: G.ash(ramp(p, "ash")), priority: PRIORITY.ash }));
  define("basalt", "black basalt in plates, its cracks glowing", { stone: R.BASALT }, (p) => ({ picture: G.basalt(ramp(p, "stone")), priority: PRIORITY.basalt }));
  define("lava", "lava: a hole, molten rock glowing below its banks", {}, () => ({
    picture: G.lava(),
    priority: PRIORITY.water,
    hole: true,
    under: { material: liquid("lava", () => G.lava(R.LAVA, 161), [1, 2], [1 / 64, 1 / 64], true), y: -0.18, spread: 0.75 },
  }));

  // --- The waste -----------------------------------------------------------------------------------------------------
  define("waste", "the desolate waste: bleached earth cracked into plates", { earth: R.WASTE }, (p) => ({ picture: G.waste(ramp(p, "earth")), priority: PRIORITY.waste }));
  define("salt-flat", "a salt flat: white crust in ridged polygons", {}, () => ({ picture: G.saltFlat(), priority: PRIORITY.salt }));

  // --- Phyrexia ------------------------------------------------------------------------------------------------------
  define("phyrexian-ground", "Phyrexian ground: ash slick with glistening oil, shards and sinew", {}, () => ({ picture: G.phyrexianGround(), priority: PRIORITY.phyrexian }));
  define("plating", "Phyrexian plating: riveted metal, oil weeping from its seams", { metal: R.PHYREXIAN }, (p) => ({ picture: G.plating(ramp(p, "metal")), priority: PRIORITY.paving }));
  define("oil", "a pool of glistening oil: a hole, black oil below", {}, () => ({
    picture: tile64(G.oilPool(R.OIL, 171)),
    priority: PRIORITY.water,
    hole: true,
    under: { material: liquid("oil", () => G.oilPool(R.OIL, 172), [1, 1], [1 / 32, 0]), y: -0.08, spread: 0.75 },
  }));

  // --- Waters --------------------------------------------------------------------------------------------------------
  define("river", "a river: a hole, the stream's water below its banks", {}, () => ({
    picture: tile64(G.waterOf(C.WATER, 181)),
    priority: PRIORITY.water,
    hole: true,
    under: { material: liquid("river", () => G.waterOf(C.WATER, 182), [2, 6], [1 / 32, -1 / 32]), y: -0.14, spread: 0.75 },
  }));
  define("lake", "a lake: a hole, still blue water below", {}, () => ({
    picture: tile64(G.waterOf(C.WATER, 183)),
    priority: PRIORITY.water,
    hole: true,
    under: { material: liquid("lake", () => G.waterOf(C.WATER, 184), [1, 2], [1 / 32, 1 / 32]), y: -0.12, spread: 0.75 },
  }));
  define("sea", "the sea: a hole, deep green-blue water below the shore", { water: R.SEA }, (p) => ({
    picture: G.seaPicture(ramp(p, "water")),
    priority: PRIORITY.water,
    hole: true,
    under: { material: liquid(ramp(p, "water") === R.SEA ? "sea" : `sea@${rampKey(ramp(p, "water"))}`, () => G.waterOf(ramp(p, "water"), 185), [1, 3], [1 / 32, 1 / 32]), y: -0.16, spread: 0.75 },
  }));

  // --- Roads ---------------------------------------------------------------------------------------------------------
  define("cart-track", "a cart track: rutted dirt, hoofprints, pebbles", {}, () => ({ picture: G.cartTrack(), priority: PRIORITY.track + 0.05 }));
  define("setts", "setts: squared stone blocks in courses, a dressed street", { stone: C.COBBLE }, (p) => ({ picture: G.setts(ramp(p, "stone")), priority: PRIORITY.cobbles + 0.05 }));
  define("marble-paving", "marble paving, veined, inlaid with azure (Tolaria)", { stone: R.MARBLE }, (p) => ({ picture: G.marblePaving(ramp(p, "stone")), priority: PRIORITY.paving }));
  define("mud-track", "a muddy track: churned mud, puddles, straw thrown down", {}, () => ({ picture: G.mudTrack(), priority: PRIORITY.track }));
  define("snow-track", "packed snow: a trodden track, slush and footprints", {}, () => ({ picture: G.snowTrack(), priority: PRIORITY.track + 0.1 }));
  define("boardwalk", "a boardwalk going east-west, its planks laid north-south", { wood: R.WEATHERED }, (p) => ({ picture: G.boardwalk("x", ramp(p, "wood")), priority: PRIORITY.cobbles }));
  define("boardwalk-ns", "a boardwalk going north-south, its planks laid east-west", { wood: R.WEATHERED }, (p) => ({ picture: G.boardwalk("z", ramp(p, "wood")), priority: PRIORITY.cobbles }));

  // --- The world generator's names (realms/web/scripts/worldgen/ids.ts), where they differ from the ones above ----------
  define("mud", "black mud of the Caligo Morass and Amjad, walked (the mire)", { mud: R.MIRE }, (p) => ({ picture: G.mire(ramp(p, "mud")), priority: PRIORITY.mud + 0.05 }));
  define("rock", "bare mountain rock, walked in the passes (bedrock)", { stone: R.GRANITE }, (p) => ({ picture: G.bedrock(ramp(p, "stone")), priority: PRIORITY.bedrock }));
  define("cracked-earth", "dry cracked earth of the desolate waste", { earth: R.WASTE }, (p) => ({ picture: G.waste(ramp(p, "earth")), priority: PRIORITY.waste }));
  define("road", "a packed gravel road between the towns", {}, () => ({ picture: G.roadGravel(), priority: PRIORITY.track + 0.08 }));
  define("planks", "boards: docks, piers, boardwalks over the Morass (laid east-west)", { wood: R.WEATHERED }, (p) => ({ picture: G.boardwalk("z", ramp(p, "wood")), priority: PRIORITY.cobbles }));
  define("shallows", "shallow water by the coasts and in lakes: a hole, clear water over sand below", {}, () => ({
    picture: tile64(G.waterOf(SHALLOW, 186)),
    priority: PRIORITY.water,
    hole: true,
    under: { material: liquid("shallows", () => G.shallowsBed(), [1, 2], [1 / 32, 1 / 32]), y: -0.06, spread: 0.75 },
  }));
}

/** Shallow water's ramp: pale, sandy-green blue. */
const SHALLOW: Ramp = [0x1c4a6a, 0x26668a, 0x3684a6, 0x4ea2bc, 0x74c0d0, 0xa6dce6, 0xe0f8fc];

/** A 32-square liquid laid out four times to fill a 64-square picture. */
function tile64(p: Pixmap): Pixmap {
  if (p.width === 64) return p;
  const out = new Pixmap(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) out.set(x, y, p.get(x, y));
  return out;
}
