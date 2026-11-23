// What Dominaria holds (design.md A6), before any of it is drawn: the hub, the five regions round it in WUBRG wheel
// order with their home towns, villages, dungeons and mage towers, the capstone portal south of the hub, and the words
// their people say. Where each place stands is the layout's (layout.ts); this is what is particular to each.

import type { DungeonData, Region, Theme, TownStyle } from "../../src/world/schema";

export interface Folk {
  readonly name: string;
  readonly text: readonly string[];
}

export interface TownPlan {
  readonly id: string;
  readonly name: string;
  readonly kind: "capital" | "town" | "village";
  readonly region?: Region;
  readonly style: TownStyle;
  /** Hexes from the centre to the walls. */
  readonly radius: number;
  readonly inn: string;
  readonly innkeeper: readonly string[];
  readonly board: readonly string[];
  readonly folk: readonly Folk[];
  readonly centrepiece: "fountain" | "statue" | "well" | "crystal" | "tree" | "brazier";
  /** Where it stands from the hub: screen angle (degrees clockwise from up) and hexes. */
  readonly angle: number;
  readonly steps: number;
  /** Whether characters may begin here (the capital and the home towns). */
  readonly start: boolean;
  readonly home?: Region;
  readonly temple: string;
  readonly guild: string;
}

export interface DungeonPlan {
  readonly id: string;
  readonly name: string;
  readonly theme: Theme;
  readonly region?: Region;
  readonly requires?: string;
  readonly floors: readonly [number, number];
  /** The dungeon's own floor of tier; it takes its place's when that is higher. */
  readonly tier: number;
  readonly encounters: readonly [number, number];
  readonly mobs: DungeonData["mobs"];
  readonly warden: string;
  readonly boss: string;
  readonly waystone?: boolean;
  /** Where it stands from the hub. */
  readonly angle: number;
  readonly steps: number;
  /** A road to it from the nearest road. */
  readonly road?: boolean;
}

export const REGION_NAMES: Record<Region, string> = { W: "Benalia", U: "Tolaria", B: "Urborg", R: "Keld and Shiv", G: "Llanowar and Yavimaya" };

/** Each region's direction from the hub, clockwise from the top of the screen in wheel order. */
export const REGION_ANGLE: Record<Region, number> = { W: 0, U: 72, B: 144, R: 216, G: 288 };

export const REGION_STYLE: Record<Region, TownStyle> = { W: "benalish", U: "tolarian", B: "urborg", R: "keldon", G: "llanowar" };

/** The names of each region's bands of tier, from the home town outward, and the hub's heartland. */
export const AREA_NAMES: Record<Region | "hub", readonly string[]> = {
  W: ["Benalish Farmlands", "Serran Highlands", "Kjeldoran Steppe", "The Pale Wastes"],
  U: ["Tolarian Shore", "Riptide Flats", "Lat-Nam Reaches", "The Drowned Isles"],
  B: ["Urborg Mire", "Cabal Fens", "Twilight Mire", "The Gloom of Yawgmoth"],
  R: ["Keldon Coast", "Shivan Highlands", "The Smoldering Crags", "The Burning Wastes"],
  G: ["Llanowar Wilds", "Yavimaya Coast", "Krosan Verge", "The Deep Wild"],
  hub: ["The Argive Heartland", "The Argive Marches", "The Argive Marches", "The Argive Marches"],
};

const R = REGION_ANGLE;

export const CAPITAL: TownPlan = {
  id: "new-argive",
  name: "New Argive",
  kind: "capital",
  style: "argive",
  radius: 60,
  inn: "The Gilded Sprocket",
  innkeeper: ["Welcome to New Argive. Rooms are free for mages; the Argivians are grateful, or say so."],
  board: [
    "The five color-wells of Dominaria are held by guardians. Earn each well's attunement.",
    "When all five are yours, the Phyrexian Portal south of the city will open. So say the seers.",
    "The mage towers' waystones carry those who beat their mages from tower to tower.",
    "The arena opens soon. Practise your duelling.",
  ],
  folk: [
    { name: "Argivian scholar", text: ["Every road leads here, and every road leads away. Pick one."] },
    { name: "Town crier", text: ["Hear ye! Phyrexian stragglers sighted in every region! Arm yourselves with cards!"] },
    { name: "Merchant", text: ["Eight vendors in one city. Nowhere else on Dominaria can say that."] },
    { name: "Old soldier", text: ["The farther from the walls, the worse the things out there. The waymarkers tell you how bad."] },
    { name: "Dock porter", text: ["The Portal's road runs south out of the gate. Nobody comes back up it."] },
  ],
  centrepiece: "statue",
  angle: 0,
  steps: 0,
  start: true,
  temple: "The Temple of the Thran",
  guild: "The Argivian Mages' Guild",
};

export interface RegionPlan {
  readonly region: Region;
  readonly town: TownPlan;
  readonly villages: readonly TownPlan[];
  readonly dungeon: DungeonPlan;
  readonly small: readonly DungeonPlan[];
  readonly towers: readonly DungeonPlan[];
}

const home = (region: Region, p: Omit<TownPlan, "kind" | "region" | "style" | "radius" | "angle" | "steps" | "start" | "home">): TownPlan => ({
  ...p,
  kind: "town",
  region,
  style: REGION_STYLE[region],
  radius: 40,
  angle: R[region],
  steps: 150,
  start: true,
  home: region,
});

const village = (region: Region, near: boolean, p: Pick<TownPlan, "id" | "name" | "inn" | "board" | "folk">): TownPlan => ({
  ...p,
  kind: "village",
  region,
  style: REGION_STYLE[region],
  radius: 15,
  innkeeper: [`${p.inn}. Small, but the beds are dry.`],
  centrepiece: "well",
  angle: R[region] + (near ? -14 : 22),
  steps: near ? 82 : 205,
  start: false,
  temple: "Shrine",
  guild: "Hedge mage's hut",
});

const tower = (id: string, name: string, region: Region | undefined, angle: number, steps: number, tier: number, mobs: readonly string[], warden: string, road = false): DungeonPlan => ({
  id,
  name,
  theme: "tower",
  ...(region ? { region } : {}),
  floors: tier <= 1 ? [1, 1] : [1, 2],
  tier,
  encounters: tier <= 1 ? [1, 2] : [2, 3],
  mobs,
  warden,
  boss: `mage-${id}`,
  waystone: true,
  angle,
  steps,
  road,
});

export const REGIONS: readonly RegionPlan[] = [
  {
    region: "W",
    town: home("W", {
      id: "new-benalia",
      name: "New Benalia",
      inn: "The Shining Shield",
      innkeeper: ["Welcome to New Benalia, mage. Rest here, and here you wake if a duel goes badly."],
      board: ["Bounty: Phyrexian scouts in the Benalish Farmlands.", "Wanted: an escort to Capashen Hold."],
      folk: [
        { name: "Benalish squire", text: ["The Capashens say the meadow's scouts are Phyrexian. Stragglers, I hope."] },
        { name: "Old pilgrim", text: ["Serra's sanctum fell with her realm. Its angels guard it still, but not for her."] },
      ],
      centrepiece: "statue",
      temple: "The Cathedral of Serra",
      guild: "The Order of the White Shield",
    }),
    villages: [
      village("W", true, { id: "capashen-hold", name: "Capashen Hold", inn: "The Capashen Arms", board: ["Travellers: the roads of Benalia are not safe after dark."], folk: [{ name: "Capashen guard", text: ["Hold's open to honest folk. And mages, I suppose."] }] }),
      village("W", false, { id: "serras-rest", name: "Serra's Rest", inn: "The Feather and Lance", board: ["Fallen angels seen over the steppe. Do not approach."], folk: [{ name: "Shepherd", text: ["The angels used to bless the flocks. Now they take them."] }] }),
    ],
    dungeon: { id: "serras-fallen-sanctum", name: "Serra's Fallen Sanctum", theme: "castle", region: "W", floors: [3, 4], tier: 3, encounters: [3, 4], mobs: [["kjeldoran-raider", "serra-zealot", "sanctum-guardian"], ["sanctum-guardian", "fallen-seraph"]], warden: "sanctum-warden", boss: "lyra-dawnbringer", angle: R.W + 4, steps: 238, road: true },
    small: [
      { id: "kjeldoran-watchtower", name: "The Ruined Kjeldoran Watchtower", theme: "castle", region: "W", floors: [1, 2], tier: 1, encounters: [2, 3], mobs: ["benalish-deserter", "phyrexian-scout"], warden: "kjeldoran-raider", boss: "serra-zealot", angle: R.W + 24, steps: 120 },
      { id: "benalish-barrow-caves", name: "The Barrow Caves", theme: "caves", region: "W", floors: [1, 2], tier: 2, encounters: [2, 3], mobs: ["kjeldoran-raider", "serra-zealot"], warden: "serra-zealot", boss: "sanctum-guardian", angle: R.W - 24, steps: 200 },
    ],
    towers: [tower("serran-lookout", "The Serran Lookout", "W", R.W - 18, 125, 1, ["benalish-deserter", "phyrexian-scout"], "benalish-deserter", true), tower("kjeldoran-beacon", "The Kjeldoran Beacon", "W", R.W + 26, 222, 3, ["sanctum-guardian"], "sanctum-guardian")],
  },
  {
    region: "U",
    town: home("U", {
      id: "tolarian-academy",
      name: "Tolarian Academy",
      inn: "The Drowned Lecture",
      innkeeper: ["Welcome to the Academy, mage. Mind the time rifts on your way to bed."],
      board: ["Lost: one automaton, answers to nothing.", "Research assistants wanted for the rift. Hazard pay."],
      folk: [
        { name: "Lecturer", text: ["Mind the time rifts. A student walked into one and came out last Tuesday."] },
        { name: "Fisher", text: ["The merfolk keep to the shore. Mostly."] },
      ],
      centrepiece: "crystal",
      temple: "The Shrine of the Tides",
      guild: "The Academy's Hall of Mages",
    }),
    villages: [
      village("U", true, { id: "lat-nam", name: "Lat-Nam", inn: "The Scholar's Rest", board: ["Tutors wanted. Must not be phased out."], folk: [{ name: "Scribe", text: ["Lat-Nam copied every spell ever written. Then someone lost the index."] }] }),
      village("U", false, { id: "tidewater", name: "Tidewater", inn: "The Barnacle", board: ["Boats for hire to the Drowned Isles. No refunds."], folk: [{ name: "Old salt", text: ["The islands drown a little more each year. So do the people who go there."] }] }),
    ],
    dungeon: { id: "time-rift-academy", name: "The Time-Rift Academy", theme: "tower", region: "U", floors: [3, 4], tier: 3, encounters: [3, 4], mobs: [["academy-automaton", "time-drifter", "rift-elemental"], ["rift-elemental", "temporal-sentinel"]], warden: "rift-warden", boss: "teferi", angle: R.U - 4, steps: 232, road: true },
    small: [
      { id: "riptide-sea-caves", name: "The Riptide Sea Caves", theme: "caves", region: "U", floors: [1, 2], tier: 1, encounters: [2, 3], mobs: ["coral-merfolk", "tolarian-apprentice"], warden: "time-drifter", boss: "academy-automaton", angle: R.U + 22, steps: 112 },
      { id: "lat-nam-watchtower", name: "The Drowned Watchtower", theme: "castle", region: "U", floors: [1, 2], tier: 2, encounters: [2, 3], mobs: ["academy-automaton", "time-drifter"], warden: "academy-automaton", boss: "rift-elemental", angle: R.U - 26, steps: 196 },
    ],
    towers: [tower("lat-nam-observatory", "The Lat-Nam Observatory", "U", R.U + 16, 118, 1, ["tolarian-apprentice", "coral-merfolk"], "tolarian-apprentice", true), tower("tidecallers-spire", "The Tidecaller's Spire", "U", R.U - 24, 215, 3, ["rift-elemental"], "rift-elemental")],
  },
  {
    region: "B",
    town: home("B", {
      id: "urborg",
      name: "Urborg",
      inn: "The Last Lantern",
      innkeeper: ["Welcome to Urborg. Keep your boots dry and your deck drier."],
      board: ["Bounty: five Urborg ghouls, any condition.", "Do not feed the bog wraiths."],
      folk: [
        { name: "Gravedigger", text: ["Business is good. Too good. The ghouls keep getting up again."] },
        { name: "Cabal defector", text: ["The tomb goes down five floors. I went down two."] },
      ],
      centrepiece: "brazier",
      temple: "The Chapel of the Drowned",
      guild: "The Cabal's Old Hall",
    }),
    villages: [
      village("B", true, { id: "bogwater", name: "Bogwater", inn: "The Sunken Cup", board: ["Stilts repaired. Inquire within, if the floor holds."], folk: [{ name: "Bog fisher", text: ["What's in the water? You don't want to know. I don't."] }] }),
      village("B", false, { id: "cabal-crossing", name: "Cabal Crossing", inn: "The Rotten Plank", board: ["Cultists seen in the Twilight Mire. They wave."], folk: [{ name: "Lantern keeper", text: ["Keep the lantern lit and the dead keep their distance. Usually."] }] }),
    ],
    dungeon: { id: "tomb-of-yawgmoth", name: "The Tomb of Yawgmoth", theme: "crypt", region: "B", floors: [4, 5], tier: 3, encounters: [3, 4], mobs: [["bog-wraith", "phyrexian-plaguelord", "yawgmoth-cultist"], ["yawgmoth-cultist", "phyrexian-horror"]], warden: "tomb-warden", boss: "sheoldred", angle: R.B + 4, steps: 236, road: true },
    small: [
      { id: "drowned-barrow", name: "The Drowned Barrow", theme: "crypt", region: "B", floors: [1, 2], tier: 1, encounters: [2, 3], mobs: ["urborg-ghoul", "cabal-initiate"], warden: "bog-wraith", boss: "phyrexian-plaguelord", angle: R.B - 22, steps: 115 },
      { id: "fen-caves", name: "The Fen Caves", theme: "caves", region: "B", floors: [1, 2], tier: 2, encounters: [2, 3], mobs: ["bog-wraith", "phyrexian-plaguelord"], warden: "phyrexian-plaguelord", boss: "yawgmoth-cultist", angle: R.B + 26, steps: 198 },
    ],
    towers: [tower("fenwatch-tower", "The Fenwatch Tower", "B", R.B + 18, 122, 1, ["urborg-ghoul", "cabal-initiate"], "cabal-initiate", true), tower("dread-spire", "The Dread Spire", "B", R.B - 24, 220, 3, ["yawgmoth-cultist"], "yawgmoth-cultist")],
  },
  {
    region: "R",
    town: home("R", {
      id: "keld",
      name: "Keld",
      inn: "The Burning Keel",
      innkeeper: ["Welcome to Keld. Sit, drink, and if someone shouts, shout back."],
      board: ["Bounty: the goblin warband that took the mine cart.", "Dragon sighted over the highlands. Again."],
      folk: [
        { name: "Keldon warrior", text: ["Fight me. No? Then fight the goblins, they're asking for it."] },
        { name: "Ghitu smith", text: ["The foundry's still running. Nobody's feeding it. Think about that."] },
      ],
      centrepiece: "brazier",
      temple: "The Hall of the Fallen",
      guild: "The Pyromancers' Lodge",
    }),
    villages: [
      village("R", true, { id: "ghitu-encampment", name: "Ghitu Encampment", inn: "The Ember Tent", board: ["Fire-walkers wanted. Burn ward supplied."], folk: [{ name: "Ghitu firebrand", text: ["Shiv's mountains are hot underfoot. Watch for the lava when it glows."] }] }),
      village("R", false, { id: "keldon-watch", name: "Keldon Watch", inn: "The Axe and Ember", board: ["Raiders out past the crags. Travel in pairs."], folk: [{ name: "Lookout", text: ["From up here you can see the drakes circling the Burning Wastes."] }] }),
    ],
    dungeon: { id: "shivan-foundry", name: "The Shivan Foundry", theme: "foundry", region: "R", floors: [3, 4], tier: 3, encounters: [3, 4], mobs: [["keldon-raider", "shivan-drake", "foundry-construct"], ["foundry-construct", "flame-elemental"]], warden: "foundry-warden", boss: "darigaaz", angle: R.R - 4, steps: 234, road: true },
    small: [
      { id: "goblin-warrens", name: "The Goblin Warrens", theme: "caves", region: "R", floors: [1, 2], tier: 1, encounters: [2, 3], mobs: ["goblin-warband", "ghitu-firebrand"], warden: "keldon-raider", boss: "shivan-drake", angle: R.R + 22, steps: 116 },
      { id: "old-forge", name: "The Old Ghitu Forge", theme: "foundry", region: "R", floors: [1, 2], tier: 2, encounters: [2, 3], mobs: ["keldon-raider", "shivan-drake"], warden: "shivan-drake", boss: "foundry-construct", angle: R.R - 26, steps: 200 },
    ],
    towers: [tower("pyre-tower", "The Pyre Tower", "R", R.R - 18, 120, 1, ["ghitu-firebrand", "goblin-warband"], "ghitu-firebrand", true), tower("flamespire", "The Flamespire", "R", R.R + 24, 222, 3, ["foundry-construct"], "foundry-construct")],
  },
  {
    region: "G",
    town: home("G", {
      id: "llanowar",
      name: "Llanowar",
      inn: "The Hollow Bough",
      innkeeper: ["Welcome to Llanowar. The trees are listening; tip accordingly."],
      board: ["Bounty: the wurm eating the north orchard.", "Wanted: anyone who can talk to Multani. Politely."],
      folk: [
        { name: "Elvish ranger", text: ["The forest is listening. Walk softly and it may even like you."] },
        { name: "Wurm herder", text: ["They're gentle, really. Just very, very large."] },
      ],
      centrepiece: "tree",
      temple: "The Grove of Gaea",
      guild: "The Druids' Circle",
    }),
    villages: [
      village("G", true, { id: "yavimaya-hollow", name: "Yavimaya Hollow", inn: "The Mossy Hearth", board: ["Mind the roots. They move."], folk: [{ name: "Forager", text: ["Every mushroom here is edible. Some only once."] }] }),
      village("G", false, { id: "steelleaf-glade", name: "Steelleaf Glade", inn: "The Iron Acorn", board: ["The Deep Wild is closed. The Deep Wild does not care."], folk: [{ name: "Old druid", text: ["Past the verge the forest is older than the elves, and less forgiving."] }] }),
    ],
    dungeon: { id: "heart-of-yavimaya", name: "The Heart of Yavimaya", theme: "hollow", region: "G", floors: [3, 4], tier: 3, encounters: [3, 4], mobs: [["yavimaya-wurm", "multani-guard", "krosan-beast"], ["krosan-beast", "yavimaya-ancient"]], warden: "heart-warden", boss: "multani", angle: R.G + 4, steps: 236, road: true },
    small: [
      { id: "elvish-hollow", name: "The Elvish Hollow", theme: "hollow", region: "G", floors: [1, 2], tier: 1, encounters: [2, 3], mobs: ["llanowar-elves-pack", "elvish-scout"], warden: "multani-guard", boss: "yavimaya-wurm", angle: R.G - 22, steps: 114 },
      { id: "krosan-caves", name: "The Krosan Caves", theme: "caves", region: "G", floors: [1, 2], tier: 2, encounters: [2, 3], mobs: ["yavimaya-wurm", "multani-guard"], warden: "yavimaya-wurm", boss: "krosan-beast", angle: R.G + 26, steps: 198 },
    ],
    towers: [tower("verdant-tower", "The Verdant Tower", "G", R.G + 18, 122, 1, ["llanowar-elves-pack", "elvish-scout"], "elvish-scout", true), tower("gaeas-spire", "Gaea's Spire", "G", R.G - 24, 218, 3, ["krosan-beast"], "krosan-beast")],
  },
];

/** The hub's own tower, by New Argive, and the towers far out in the wilds between the regions. */
export const TOWERS: readonly DungeonPlan[] = [
  tower("argive-spire", "The Argive Spire", undefined, 36, 88, 1, ["phyrexian-scout", "benalish-deserter", "tolarian-apprentice"], "kjeldoran-raider", true),
  tower("urzas-spire", "Urza's Spire", undefined, 36, 262, 4, ["temporal-sentinel", "fallen-seraph"], "gitaxian-mindcutter"),
  tower("drowned-isles-tower", "The Tower of the Drowned Isles", "U", 108, 262, 4, ["gitaxian-mindcutter", "temporal-sentinel"], "temporal-sentinel"),
  tower("thran-spire", "The Thran Spire", undefined, 252, 262, 4, ["flame-elemental", "phyrexian-ravager"], "phyrexian-gorger"),
  tower("glacial-tower", "The Glacial Tower", undefined, 324, 262, 4, ["yavimaya-ancient", "fallen-seraph"], "phyrexian-gorger"),
];

/** The capstone (design.md A6): just south of the hub, on its own road, sealed to all but five colors. */
export const PORTAL: DungeonPlan = {
  id: "phyrexian-portal",
  name: "The Phyrexian Portal",
  theme: "portal",
  requires: "WUBRG",
  floors: [4, 4],
  tier: 4,
  encounters: [3, 4],
  mobs: [["phyrexian-ravager", "phyrexian-negator", "phyrexian-gorger"], ["phyrexian-ravager", "gitaxian-mindcutter", "phyrexian-negator", "phyrexian-gorger"]],
  warden: "portal-warden",
  boss: "phyrexian-praetor",
  angle: 180,
  steps: 84,
  road: true,
};

export const ALL_TOWNS: readonly TownPlan[] = [CAPITAL, ...REGIONS.flatMap((p) => [p.town, ...p.villages])];
export const ALL_DUNGEONS: readonly DungeonPlan[] = [...REGIONS.flatMap((p) => [p.dungeon, ...p.small, ...p.towers]), ...TOWERS, PORTAL];
