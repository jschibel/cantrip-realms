// Every art id the world generator names (realms/docs/conversion.md, "The world's ids"): the surfaces of its tiles, the
// props it stands on them, the building styles and kinds, the room kinds of its interiors, the figures of its people.
// The art registries are being built beside the world; an id here that a registry does not have yet is a placeholder,
// listed in PLACEHOLDERS with what it should look like, so the Art library knows what to make and the lint (world/lint.ts,
// `onUnknown`) names it instead of failing. When the art has one, it comes off the list.

/** Surfaces, by what the world uses them for. Index 0 is no surface: nothing drawn, nothing walked. */
export const SURFACES = [
  "",
  // Known to art/surfaces today.
  "grass",
  "cobbles",
  "flagstones",
  "dirt",
  "straw",
  "furrows",
  "wheat",
  "stream",
  "floorboards",
  "hearthstone",
  // Placeholders (PLACEHOLDERS below says what each is).
  "meadow",
  "forest-floor",
  "moss",
  "mud",
  "bog",
  "snow",
  "ice",
  "tundra",
  "rock",
  "scree",
  "sand",
  "sea",
  "shallows",
  "lava",
  "ash",
  "cracked-earth",
  "road",
  "planks",
  "phyrexian-ground",
] as const;
export type Surface = (typeof SURFACES)[number];

/** A surface's index in SURFACES, by id. */
export const S = Object.fromEntries(SURFACES.map((s, i) => [s === "" ? "none" : s, i])) as Record<Exclude<Surface, ""> | "none", number>;

/** Water: holes, drawn as what lies under them. */
export const WATER: ReadonlySet<number> = new Set([S.stream, S.bog, S.sea, S.shallows, S.lava]);

/** Building styles: one a region (world/format.ts, `STYLES`). */
export const STYLE_OF_REGION = {
  benalish: "Benalia's stone and banners",
  llanowar: "Llanowar's tree-houses",
  urborg: "the Morass's dark stilt-houses (the Vess estate's)",
  keldon: "Keldon longhouses",
  tolarian: "Tolarian domes",
} as const;

/**
 * The kinds of building the world asks each style for, with the `params` it gives every one (art/buildings/benalish.ts
 * documents them: ground, upper, roof, rise, chimney, wall, openings): a style reads what it can use of them.
 */
export const BUILDING_KINDS = ["house", "tenement", "shop", "inn", "temple", "guildhall", "smithy", "library", "tower", "warehouse", "barn", "keep", "manor"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/**
 * What every placeholder id is, by kind: the Art library's list to make (or to rename here). Props' anchors are their
 * middles on the ground unless said; `args.to` is a line's far end (tile middles) or a rectangle's far corner.
 */
export const PLACEHOLDERS: Readonly<Record<"surfaces" | "props" | "styles" | "rooms" | "figures", Readonly<Record<string, string>>>> = {
  surfaces: {
    meadow: "flowered grass, Benalia's fields and Sursi's downs (tufts)",
    "forest-floor": "leaf litter and roots under the trees of Llanowar, the Durkwood and Verdura",
    moss: "moss and wet grass, the Morass's edges and the forests' clearings (a few tufts)",
    mud: "black mud of the Caligo Morass and Amjad, walked",
    bog: "standing black water of the Morass: a hole, water under",
    snow: "snow, Keld's heights and Parma",
    ice: "blue ice, frozen shores and lakes, walked",
    tundra: "frozen grass and gravel, Keld's steppe (sparse tufts)",
    rock: "bare mountain rock, walked in the passes",
    scree: "loose stones on mountainsides and in passes",
    sand: "beach sand on the coasts",
    sea: "the open sea: a hole, deep water under",
    shallows: "shallow water by the coasts and in lakes: a hole, water under",
    lava: "lava, round Keldon forges and the foundry: a hole, glowing under",
    ash: "ash and cinders, the desolate waste",
    "cracked-earth": "dry cracked earth, the desolate waste",
    road: "a packed gravel road, the main roads between the towns",
    planks: "boards: docks, piers, boardwalks over the Morass",
    "phyrexian-ground": "glistening oil-black ground round the Phyrexian Portal",
  },
  props: {
    pine: "a conifer at x, z, scale, seed (Keld, the mountains, Skyshroud)",
    "dead-tree": "a bare dead tree at x, z, scale, seed (the Morass, the waste)",
    "great-tree": "one of Llanowar's giant trees, its trunk filling its tile, at x, z, scale, seed",
    "swamp-tree": "a drowned, moss-hung tree at x, z, scale, seed (the Morass, Amjad)",
    mushroom: "a giant fungus at x, z, scale, seed (the Morass, the forests' floors)",
    reeds: "a clump of reeds at x, z (shores, bogs)",
    "ice-rock": "a block of blue ice at x, z, seed (Parma, Keld's shores)",
    crystal: "a growth of blue crystal at x, z, seed (Orvada's isles, Tolarian squares)",
    stump: "a tree stump at x, z, seed",
    "fruit-tree": "a small fruit tree at x, z, scale, seed (orchards inside the walls)",
    "tree-platform": "a ring platform round a giant tree's trunk at x, z, args.height up, with a ladder (the elfhames)",
    "ruined-wall": "a broken stretch of wall from x, z to args.to",
    "wall-run": "a town wall from x, z to args.to (tile middles, one straight run), its outer face args.face (n, e, s, w), in args.style",
    "wall-tower": "a round tower of a town wall at x, z (a corner, or beside a gate), in args.style",
    gatehouse: "a town gate at x, z (the gap's middle), facing rot (out of the town), args.width tiles wide, in args.style; cut down while the player is under it",
    statue: "a statue on a plinth at x, z, filling args.size tiles (a town's centrepiece)",
    well: "a well at x, z",
    "giant-tree": "a living tree at the heart of an elfhame at x, z, filling args.size tiles",
    "quest-board": "a notice board on posts at x, z, facing rot",
    "spell-table": "a spell table at x, z: a stone table with a deck laid out, where a deck is built",
    waystone: "a mage tower's waystone at x, z: a tall carved stone that glows when attuned",
    "arena-gate": "the closed gate of a town's arena at x, z, facing rot, with its 'coming soon' sign",
    "ferry-post": "a ferry's mooring post and bell at x, z",
    pier: "a wooden pier from x, z to args.to (a rectangle of planks on piles)",
    "cave-mouth": "a cave's mouth in a rock face, its footprint args.w by args.d from x, z, facing rot (caves)",
    "castle-gate": "a ruined keep's gate, its footprint args.w by args.d from x, z, facing rot (castle)",
    "mage-tower": "a mage's round tower with its door, its footprint args.w by args.d from x, z, facing rot (tower)",
    "crypt-door": "a crypt's sunken doorway, its footprint args.w by args.d from x, z, facing rot (crypt)",
    "root-hollow": "a hollow under great roots, its footprint args.w by args.d from x, z, facing rot (hollow)",
    "foundry-gate": "an orc foundry's iron gate in the rock, its footprint args.w by args.d from x, z, facing rot (foundry)",
    "phyrexian-portal": "the Phyrexian Portal, its footprint args.w by args.d from x, z, facing rot",
    "flower-bed": "a bed of flowers filling a tile at x, z (gardens)",
    "fence-run": "a low fence from x, z to args.to (yards and fields)",
    "hay-bale": "a bale of hay at x, z",
    "wood-pile": "a pile of logs at x, z",
    tent: "a tent at x, z, facing rot",
    // Furniture the interiors name beyond art/props/indoors.ts's (the Interiors agent's to make or rename).
    "bar-counter": "an inn's bar from x, z to args.to",
    "dining-table": "a long table, its middle at x, z, args.width",
    bed: "a bed against the back wall, its head at x, z",
    altar: "a temple's altar at x, z",
    pew: "a temple's pew, its middle at x, z, args.width",
    anvil: "a smith's anvil at x, z",
    forge: "a smith's forge against the back wall at x, z (flames)",
    "weapon-rack": "a rack of spears and axes at x, z",
    "armor-stand": "a stand of armor at x, z",
    "curio-cabinet": "a glass cabinet of curios from other planes at x, z",
    "planar-mirror": "a tall mirror showing another plane at x, z",
    orrery: "a brass orrery on a stand at x, z",
    lectern: "a reading lectern at x, z",
  },
  styles: {
    llanowar: "Llanowar's tree-houses (and its villages')",
    urborg: "the Morass's dark stilt-houses, the Vess estate's",
    keldon: "Keldon longhouses, also Foriys's and the waste's",
    tolarian: "Tolarian domes, Walassa and Denawa",
  },
  rooms: {
    inn: "an inn's common room: bar, tables, hearth",
    guildhall: "a mages' guild hall",
    temple: "a temple's nave",
    smithy: "a smithy: forge, anvil, racks",
    library: "a library",
    house: "a house's one room",
    tower: "a mage tower's round room (Tolarian towns' libraries)",
    "exotic-wares": "an exotic wares shop: curios from other planes",
  },
  figures: {
    townsman: "a man of the town, by palette (townswoman's fellow)",
    elf: "an elf of Llanowar",
    wizard: "a robed mage (Tolarians)",
    humanoid: "a Keldon warrior",
    ferryman: "a ferryman in oilskins",
  },
};

/** Every placeholder id of a kind, as a set. */
export const placeholderIds = (kind: keyof typeof PLACEHOLDERS): ReadonlySet<string> => new Set(Object.keys(PLACEHOLDERS[kind]));
