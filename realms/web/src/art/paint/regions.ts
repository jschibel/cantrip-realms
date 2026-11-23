import * as C from "./colors";
import { definePalette } from "./palette";
import * as R from "./ramps";

// The named palettes of the Domains' regions and biomes (palette.ts, PALETTES): what the world data names as a
// building's `palette` or a prop's `tint`. A region's palette names the slots its buildings and trees read - walls,
// roofs, timber, cloth, leaves - so one recipe dresses for any region: a Benalish house in Keldon stone, an oak in
// Llanowar's green. Slots a recipe does not read are ignored, so one palette serves buildings and props alike.
//
// Slots in use: stone, plaster, roof, timber, darkTimber (houses); wall, trim, cloth, accent, metal (the styles); leaves,
// bark, needles, moss, bush, reeds (trees and plants); grass, earth, sand, snow, water (surfaces).

// --- Regions -------------------------------------------------------------------------------------------------------------

definePalette("benalish", { stone: C.LIMESTONE, plaster: C.PLASTER, roof: C.ROOF, timber: C.WOOD, darkTimber: C.DARKWOOD, cloth: C.BLUE, trim: C.GOLD });
definePalette("benalish-slate", { roof: C.SLATE });
definePalette("llanowar", { timber: R.ELFWOOD, darkTimber: R.ELFWOOD, leaves: R.ELF_LEAF, bark: R.ELFWOOD, cloth: R.ELF_CLOTH, trim: C.GOLD, roof: R.ELF_LEAF });
definePalette("morass", { timber: R.TARRED, darkTimber: R.TARRED, roof: R.MOSS_ROOF, wall: R.TARRED, cloth: C.BLACK, trim: R.BOG, leaves: R.CYPRESS, bark: R.DEADWOOD, moss: R.HANGING_MOSS });
definePalette("keldon", { stone: R.KELD_STONE, timber: R.LOG, darkTimber: R.LOG, roof: R.SOD, cloth: R.KELD_RED, trim: C.IRON, needles: R.PINE });
definePalette("tolarian", { stone: R.MARBLE, plaster: R.MARBLE, roof: R.VERDIGRIS, cloth: R.TOLARIAN_CLOTH, trim: C.GOLD, wall: R.MARBLE });
definePalette("vess", { stone: R.VESS_STONE, roof: R.VESS_SLATE, cloth: C.BLACK, trim: C.GOLD, timber: C.DARKWOOD, darkTimber: C.DARKWOOD });
definePalette("village", { plaster: R.DAUB, roof: R.THATCH, timber: C.WOOD, darkTimber: C.DARKWOOD, stone: C.COBBLE, cloth: C.RED });
definePalette("phyrexian", { metal: R.PHYREXIAN, wall: R.PHYREXIAN, accent: R.SINEW, trim: R.OIL, cloth: R.SINEW });

// --- Variations of a region ----------------------------------------------------------------------------------------------

definePalette("whitewash", { plaster: C.PLASTER, stone: C.PLASTER });
definePalette("thatch", { roof: R.THATCH });
definePalette("red-cloth", { cloth: C.RED, trim: C.GOLD });
definePalette("green-cloth", { cloth: C.GREEN, trim: C.GOLD });
definePalette("purple-cloth", { cloth: C.PURPLE, trim: C.GOLD });
definePalette("teal-cloth", { cloth: C.TEAL, trim: C.CLOTH_WHITE });

// --- Biomes: trees, plants and stone ---------------------------------------------------------------------------------------

definePalette("summer", { leaves: C.LEAF });
definePalette("spring", { leaves: R.BIRCH_LEAF });
definePalette("elfhame", { leaves: R.ELF_LEAF, bark: R.ELFWOOD });
definePalette("verdura", { leaves: R.LUSH, bark: R.ELFWOOD });
definePalette("swamp", { leaves: R.CYPRESS, bark: R.DEADWOOD, moss: R.HANGING_MOSS, reeds: R.REED });
definePalette("winter", { leaves: R.PINE, needles: R.PINE, grass: R.TUNDRA });
definePalette("blighted", { leaves: [0x1a1418, 0x2a2024, 0x3c2e2c, 0x50403a, 0x645446, 0x7a6a54, 0x928060], bark: R.DEADWOOD });
definePalette("granite", { stone: R.GRANITE });
definePalette("basalt", { stone: R.BASALT });
definePalette("sandstone", { stone: [0x3a2420, 0x5a382a, 0x7c5034, 0xa06c44, 0xc28c58, 0xdcac74, 0xf0cc96] });
definePalette("marble", { stone: R.MARBLE });
definePalette("cobble", { stone: C.COBBLE });
definePalette("ice", { stone: R.ICE });
definePalette("phyrexian-stone", { stone: R.PHYREXIAN });

// --- Tiers: waymarkers, tier banners -----------------------------------------------------------------------------------------

for (const t of [1, 2, 3, 4]) definePalette(`tier-${t}`, { cloth: R.TIER[t]!, trim: C.CLOTH_WHITE });
