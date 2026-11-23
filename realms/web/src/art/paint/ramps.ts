import { type Rgb, rgb } from "./pixmap";

// The world's ramps beyond the slice's (colors.ts): the ground of every biome, the foliage of every region's trees, and
// the materials of every region's buildings. Each runs dark to light and shifts hue as it goes - shadows to violet and
// blue, lights to yellow - as the slice's do, so a Keldon longhouse and a Benalish house stand in one picture. The
// biome and region palettes (regions.ts) name these by slot.

const ramp = (...hexes: string[]): Rgb[] => hexes.map(rgb);

// --- Grass and growing things -------------------------------------------------------------------------------------------

/** Dry plains grass, gold-green: the open country between Benalia's farms. */
export const PLAINS = ramp("#26301c", "#3a4a22", "#566628", "#748432", "#96a03e", "#b8ba54", "#dcd47a");
/** Moss: a forest's green carpet, cool and deep. */
export const MOSS = ramp("#10241e", "#163824", "#204e28", "#2e682c", "#428432", "#5ea03c", "#86bc4c");
/** Reeds and marsh grass: green going yellow. */
export const REED = ramp("#1a2614", "#283a18", "#3c521e", "#567026", "#768e32", "#9aaa44", "#c0c462");
/** Frost-bitten tundra grass, olive gone grey. */
export const TUNDRA = ramp("#262a2c", "#363c36", "#4c5240", "#646a4a", "#807f58", "#9e9a70", "#bcb890");
/** Lichen on rock and tundra: pale green-gold. */
export const LICHEN = ramp("#3c4a34", "#5a6c40", "#7e9050", "#a4b066", "#c8cc84");

// --- Earth --------------------------------------------------------------------------------------------------------------

/** A forest's floor: dark loam, violet in its shadows. */
export const LOAM = ramp("#170f16", "#24161c", "#352320", "#4a3226", "#62442e", "#7e5a3a", "#9c744a");
/** Fallen leaves: rust, amber and gold. */
export const LITTER = ramp("#32160f", "#521f14", "#7a3218", "#a24a1e", "#c46628", "#e08a36", "#f4b252");
/** Pine needles: rusty brown. */
export const NEEDLES = ramp("#22120e", "#3a1e16", "#56301e", "#744228", "#925834", "#ae7444");
/** Swamp mud: wet, nearly black, olive where it catches the light. */
export const MUD = ramp("#0f0e14", "#18161c", "#242220", "#332f28", "#443e30", "#58503a", "#706646");
/** The Morass: oily violet-black mire, sick green in its light. */
export const MIRE = ramp("#0c0910", "#15111b", "#1f1b25", "#2a282c", "#36382f", "#464a36", "#5c6040");
/** Bog water: brown-green, murky. */
export const BOG = ramp("#0a1210", "#101c18", "#18281f", "#223628", "#2e4630", "#3e5a3a", "#5a7650");
/** Sand: warm, pale at its lightest. */
export const SAND = ramp("#4c3226", "#6e4c34", "#966e44", "#ba9256", "#d8b46e", "#ecd08e", "#fae8b6");
/** Wet sand at the water's edge. */
export const WETSAND = ramp("#3e3434", "#5a4a42", "#76624e", "#907a5e", "#a8926e", "#bea886");
/** The desolate waste: bleached, cracked earth, rose-grey. */
export const WASTE = ramp("#2e2024", "#46322e", "#604438", "#7c5a46", "#9a7458", "#b6906e", "#d2ae8c");
/** Salt and alkali crust. */
export const SALT = ramp("#7a7688", "#9a98a8", "#bab8c4", "#d6d4da", "#ecebec", "#fbfaf4");

// --- Stone, snow and fire --------------------------------------------------------------------------------------------

/** Mountain granite: warm grey, violet in shadow. */
export const GRANITE = ramp("#24202a", "#36303a", "#4c4448", "#645a5a", "#80746e", "#9e9284", "#beb4a2");
/** Basalt: near-black, blue-violet. */
export const BASALT = ramp("#0c0a10", "#15131b", "#201e28", "#2c2a35", "#3b3844", "#4e4a56", "#66616c");
/** Ash and cinders: grey, a touch warm. */
export const ASH = ramp("#262224", "#383334", "#4e4846", "#666059", "#807970", "#9c9488", "#bab2a4");
/** Lava: glowing, dark crust to white heat. */
export const LAVA = ramp("#3a0806", "#7a140a", "#c0300e", "#ec5a14", "#ff9428", "#ffcc50", "#fff4a0");
/** Snow: blue in its shadows, white in the sun. */
export const SNOW = ramp("#46507a", "#64709e", "#8896c2", "#aebcdc", "#d0dcf0", "#eaf2fc", "#ffffff");
/** Ice: deep blue to pale cyan. */
export const ICE = ramp("#142c56", "#1c4478", "#285e9a", "#4080bc", "#66a4d6", "#9acdee", "#d8f4ff");
/** The open sea: deeper and greener than a stream. */
export const SEA = ramp("#071a30", "#0c2a4c", "#123e6a", "#1a568a", "#2874a6", "#4a9ac4", "#88cce6");

// --- Phyrexia -------------------------------------------------------------------------------------------------------------

/** Phyrexian metal: cold grey-teal, bone-pale at its edges. */
export const PHYREXIAN = ramp("#0e1218", "#181e26", "#252d36", "#36404a", "#4c585e", "#6a7678", "#929c98");
/** Glistening oil: black, an iridescent sheen of teal and violet. */
export const OIL = ramp("#050308", "#0c0912", "#16111e", "#22192c", "#30223c", "#3e5c62", "#6a4a86");
/** Sinew and flesh: dark red to pink. */
export const SINEW = ramp("#260a12", "#44101e", "#6a1a2a", "#922a36", "#b64646", "#d6766a", "#eeaa90");

// --- Foliage ------------------------------------------------------------------------------------------------------------

/** Llanowar's canopy: vivid yellow-green. */
export const ELF_LEAF = ramp("#0b2218", "#11361e", "#1a5022", "#2a6c26", "#42902c", "#68b03a", "#9cd050");
/** Verdura's lush growth: teal-green, glossy. */
export const LUSH = ramp("#08222a", "#0c3834", "#14543e", "#1e7246", "#30924e", "#54b45a", "#88d46c");
/** Birch leaves: light, yellow-green. */
export const BIRCH_LEAF = ramp("#1a2e1a", "#264620", "#386426", "#50842e", "#70a43a", "#98c44c", "#c4e068");
/** Pine and fir needles: blue-green, dark. */
export const PINE = ramp("#071618", "#0c2626", "#133830", "#1c4a3a", "#286044", "#387850", "#529462");
/** Cypress and swamp foliage: olive, dull. */
export const CYPRESS = ramp("#0c140f", "#142016", "#1e301b", "#2a4020", "#385228", "#4a6630", "#62803c");
/** Hanging moss: grey-green. */
export const HANGING_MOSS = ramp("#262c24", "#384030", "#4e5840", "#687254", "#848e6a", "#a4aa86");
/** Palm fronds: bright yellow-green. */
export const PALM = ramp("#122a18", "#1e401c", "#305e22", "#487e2a", "#66a034", "#8cc044", "#b6dc62");
/** Scrub and heather: grey-green with violet in it. */
export const SCRUB = ramp("#1c1e22", "#2a3028", "#3c4630", "#525e38", "#6c7644", "#8a9258");

// --- Wood ---------------------------------------------------------------------------------------------------------------

/** Birch bark: white, banded dark. */
export const BIRCH = ramp("#2e2832", "#4c4650", "#7a7478", "#aaa4a4", "#d4d0ca", "#eeebe4", "#fffcf4");
/** Dead wood: weathered grey-violet. */
export const DEADWOOD = ramp("#121016", "#1e1a22", "#2c2730", "#3c363c", "#504848", "#685e5a", "#847870");
/** Llanowar's living wood: warm bark with green in its shadows. */
export const ELFWOOD = ramp("#141210", "#221c14", "#36291a", "#4c3a22", "#66502c", "#846a3a", "#a4884e");
/** Pine logs: Keld's longhouse walls, warm grey-brown. */
export const LOG = ramp("#1c1416", "#2e201e", "#443024", "#5c432e", "#78593a", "#94724c", "#b28e62");
/** Thatch: straw gone grey-gold with age. */
export const THATCH = ramp("#2e2016", "#4a3420", "#6a4c2a", "#8c6a36", "#ac8a46", "#c8a85e", "#e2c67e");
/** Weathered shingles and planks: silver-grey. */
export const WEATHERED = ramp("#1a1820", "#29262c", "#3a3638", "#4e4846", "#665e58", "#80766c", "#9c9284");
/** The Morass's tarred planks: near black, a little green. */
export const TARRED = ramp("#0b0a0d", "#141217", "#1d1a1f", "#272327", "#332d30", "#423a3a", "#544a46");

// --- Walls and roofs ------------------------------------------------------------------------------------------------------

/** Tolarian marble: white, blue-veined. */
export const MARBLE = ramp("#464866", "#64688a", "#8a8eaa", "#b2b6ca", "#d4d6e2", "#eeeff4", "#ffffff");
/** Verdigris copper: a dome's green-blue. */
export const VERDIGRIS = ramp("#0c2628", "#123c3c", "#1a5650", "#267464", "#3a927a", "#5eb094", "#94d0b2");
/** The Vess estate's stone: dark violet-grey. */
export const VESS_STONE = ramp("#110d17", "#1c1724", "#282132", "#352c42", "#453a54", "#584b68", "#706282");
/** Purple slate for the manor's roofs. */
export const VESS_SLATE = ramp("#130b1b", "#1f132a", "#2c1d3e", "#3c2954", "#50376a", "#664a82");
/** Keldon basalt blocks and their red-brown mortar. */
export const KELD_STONE = ramp("#141016", "#201a20", "#2e262a", "#3e3436", "#524444", "#685854", "#827064");
/** Wattle and daub: ochre plaster of a village's cottages. */
export const DAUB = ramp("#54402c", "#745a3a", "#967650", "#b49466", "#d0b084", "#e6cca4", "#f6e4c4");
/** Mossy shingles on the Morass's roofs. */
export const MOSS_ROOF = ramp("#0e120e", "#171d15", "#22291c", "#2e3722", "#3b4729", "#4c5a32");
/** Turf on a Keldon roof, wintry. */
export const SOD = ramp("#1c2018", "#2a3020", "#3c4428", "#525a30", "#6a703a", "#868a4c");

// --- Cloth --------------------------------------------------------------------------------------------------------------

/** Keld's war-red cloth. */
export const KELD_RED = ramp("#2a0808", "#4c0e0c", "#761a12", "#a02a18", "#c84224", "#e46a3a");
/** Llanowar's cloth: green and gold. */
export const ELF_CLOTH = ramp("#0e2a18", "#164426", "#20623a", "#30844c", "#4aa45e", "#78c47a");
/** Tolarian blue-white. */
export const TOLARIAN_CLOTH = ramp("#101c44", "#1a2e6a", "#284894", "#3c68ba", "#6090da", "#9cc0f0");

/** Waymarkers and their banners, by tier: 1 green, 2 gold, 3 orange, 4 red (hud.ts's tier colors, in ramps). */
export const TIER: readonly (readonly Rgb[])[] = [
  ramp("#2a2c38", "#444858", "#666c7e", "#8a90a2", "#aeb4c2", "#d0d4de"),
  ramp("#0a2a1a", "#0e4a2a", "#127040", "#1a9852", "#1fbf62", "#6adc92"),
  ramp("#4a2a0c", "#7c4a12", "#b4781c", "#e4a42c", "#ffc94a", "#ffe490"),
  ramp("#4a1a0a", "#7c2a10", "#b4481c", "#e0682c", "#f58a3a", "#ffb878"),
  ramp("#3a0812", "#64101c", "#961a28", "#c02030", "#e02a3a", "#f8706a"),
];
