// Dominaria's maps (design.md, A6): the world map, New Argive at the hub, the five regions round it in WUBRG wheel
// order - each with its home town, a village, three wilderness maps and a dungeon of 3-5 floors - the small maps
// travel encounters are fought on, and the capstone: the Phyrexian Portal by the hub, sealed until a character has all
// five colors, whose last floor is the praetor's hall. Run `npm run maps` to write realms/content/dominaria/maps/*.json;
// the same run gives the same files. A map tuned by hand in the editor is listed in HAND_TUNED and left alone.

import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Hex, distance, hex, key, neighbors, spiral, toWorld } from "../src/hex";
import { formatMap } from "../src/maps/format";
import { innOf } from "../src/maps/graph";
import type { MapData, Region } from "../src/maps/schema";
import { validateMap } from "../src/maps/schema";
import { MapBuilder, STEP, toward } from "./mapgen/builder";
import { type Link, dungeon, encounter, settlement, wilderness, world } from "./mapgen/places";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "content", "dominaria", "maps");

/** Maps edited by hand after generation: not overwritten. */
const HAND_TUNED = new Set<string>();

interface RegionPlan {
  readonly region: Region;
  readonly name: string;
  readonly town: { id: string; name: string; vendors: { id: string; name: string }[]; inn: string; centrepiece: "fountain" | "statue" | "well" | "crystal" | "tree" | "brazier" };
  readonly village: { id: string; name: string; vendor: { id: string; name: string }; inn: string };
  readonly wilds: readonly { id: string; name: string; feature?: "lake" | "river" | "ruins" | "grove" | "crater" | "coast"; spellTable?: boolean }[];
  readonly dungeon: { id: string; name: string; floors: number };
  readonly encounter: { id: string; name: string };
  readonly t1: readonly string[];
  readonly t2: readonly string[];
  readonly deep: readonly string[];
  readonly keeper: string;
  readonly boss: string;
  readonly folk: readonly { name: string; text: string[] }[];
  readonly board: readonly string[];
}

const REGIONS: readonly RegionPlan[] = [
  {
    region: "W",
    name: "Benalia",
    town: {
      id: "new-benalia",
      name: "New Benalia",
      inn: "The Shining Shield",
      centrepiece: "statue",
      vendors: [
        { id: "benalia-white-goods", name: "Benalish White Goods" },
        { id: "benalia-soldiers", name: "The Soldiers' Quarter" },
      ],
    },
    village: { id: "capashen-hold", name: "Capashen Hold", inn: "The Capashen Arms", vendor: { id: "capashen-trader", name: "Capashen Trading Post" } },
    wilds: [
      { id: "benalish-meadow", name: "Benalish Meadow" },
      { id: "kjeldoran-steppe", name: "Kjeldoran Steppe", feature: "ruins", spellTable: true },
      { id: "serran-highlands", name: "Serran Highlands", feature: "lake" },
    ],
    dungeon: { id: "serras-fallen-sanctum", name: "Serra's Fallen Sanctum", floors: 4 },
    encounter: { id: "encounter-benalia", name: "Benalish Roadside" },
    t1: ["phyrexian-scout", "benalish-deserter"],
    t2: ["kjeldoran-raider", "serra-zealot"],
    deep: ["sanctum-guardian", "fallen-seraph"],
    keeper: "sanctum-warden",
    boss: "lyra-dawnbringer",
    folk: [
      { name: "Benalish squire", text: ["The Capashens say the meadow's scouts are Phyrexian. Stragglers, I hope."] },
      { name: "Old pilgrim", text: ["Serra's sanctum fell with her realm. Its angels guard it still, but not for her."] },
    ],
    board: ["Bounty: Phyrexian scouts in the Benalish Meadow.", "Wanted: an escort to Capashen Hold."],
  },
  {
    region: "U",
    name: "Tolaria",
    town: {
      id: "tolarian-academy",
      name: "Tolarian Academy",
      inn: "The Drowned Lecture",
      centrepiece: "crystal",
      vendors: [
        { id: "tolaria-blue-goods", name: "Academy Supplies" },
        { id: "tolaria-wizards", name: "The Wizards' Exchange" },
        { id: "tolaria-artificers", name: "The Artificers' Bench" },
      ],
    },
    village: { id: "lat-nam", name: "Lat-Nam", inn: "The Scholar's Rest", vendor: { id: "lat-nam-scribe", name: "The Lat-Nam Scribe" } },
    wilds: [
      { id: "tolarian-shore", name: "Tolarian Shore", feature: "coast" },
      { id: "academy-ruins", name: "Academy Ruins", feature: "ruins", spellTable: true },
      { id: "riptide-flats", name: "Riptide Flats", feature: "river" },
    ],
    dungeon: { id: "time-rift-academy", name: "The Time-Rift Academy", floors: 3 },
    encounter: { id: "encounter-tolaria", name: "Tolarian Coast" },
    t1: ["tolarian-apprentice", "coral-merfolk"],
    t2: ["academy-automaton", "time-drifter"],
    deep: ["rift-elemental", "temporal-sentinel"],
    keeper: "rift-warden",
    boss: "teferi",
    folk: [
      { name: "Lecturer", text: ["Mind the time rifts. A student walked into one and came out last Tuesday."] },
      { name: "Fisher", text: ["The merfolk keep to the shore. Mostly."] },
    ],
    board: ["Lost: one automaton, answers to nothing.", "Research assistants wanted for the rift. Hazard pay."],
  },
  {
    region: "B",
    name: "Urborg",
    town: {
      id: "urborg",
      name: "Urborg",
      inn: "The Last Lantern",
      centrepiece: "brazier",
      vendors: [
        { id: "urborg-black-goods", name: "The Black Market" },
        { id: "urborg-grave-goods", name: "Grave Goods" },
      ],
    },
    village: { id: "bogwater", name: "Bogwater", inn: "The Sunken Cup", vendor: { id: "bogwater-peddler", name: "Bogwater Peddler" } },
    wilds: [
      { id: "urborg-mire", name: "Urborg Mire", feature: "lake" },
      { id: "cabal-fens", name: "Cabal Fens", feature: "river", spellTable: true },
      { id: "twilight-mire", name: "Twilight Mire", feature: "ruins" },
    ],
    dungeon: { id: "tomb-of-yawgmoth", name: "The Tomb of Yawgmoth", floors: 5 },
    encounter: { id: "encounter-urborg", name: "Urborg Bog" },
    t1: ["urborg-ghoul", "cabal-initiate"],
    t2: ["bog-wraith", "phyrexian-plaguelord"],
    deep: ["yawgmoth-cultist", "phyrexian-horror"],
    keeper: "tomb-warden",
    boss: "sheoldred",
    folk: [
      { name: "Gravedigger", text: ["Business is good. Too good. The ghouls keep getting up again."] },
      { name: "Cabal defector", text: ["The tomb goes down five floors. I went down two."] },
    ],
    board: ["Bounty: five Urborg ghouls, any condition.", "Do not feed the bog wraiths."],
  },
  {
    region: "R",
    name: "Shiv",
    town: {
      id: "keld",
      name: "Keld",
      inn: "The Burning Keel",
      centrepiece: "brazier",
      vendors: [
        { id: "keld-red-goods", name: "Keldon Wares" },
        { id: "keld-dragons-hoard", name: "The Dragon's Hoard" },
      ],
    },
    village: { id: "ghitu-encampment", name: "Ghitu Encampment", inn: "The Ember Tent", vendor: { id: "ghitu-trader", name: "Ghitu Trader" } },
    wilds: [
      { id: "shivan-highlands", name: "Shivan Highlands", feature: "crater" },
      { id: "smoldering-crater", name: "Smoldering Crater", feature: "crater", spellTable: true },
      { id: "keldon-coast", name: "Keldon Coast", feature: "coast" },
    ],
    dungeon: { id: "shivan-foundry", name: "The Shivan Foundry", floors: 4 },
    encounter: { id: "encounter-shiv", name: "Shivan Pass" },
    t1: ["ghitu-firebrand", "goblin-warband"],
    t2: ["keldon-raider", "shivan-drake"],
    deep: ["foundry-construct", "flame-elemental"],
    keeper: "foundry-warden",
    boss: "darigaaz",
    folk: [
      { name: "Keldon warrior", text: ["Fight me. No? Then fight the goblins, they're asking for it."] },
      { name: "Ghitu smith", text: ["The foundry's still running. Nobody's feeding it. Think about that."] },
    ],
    board: ["Bounty: the goblin warband that took the mine cart.", "Dragon sighted over the highlands. Again."],
  },
  {
    region: "G",
    name: "Llanowar",
    town: {
      id: "llanowar",
      name: "Llanowar",
      inn: "The Hollow Bough",
      centrepiece: "tree",
      vendors: [
        { id: "llanowar-green-goods", name: "Llanowar Provisions" },
        { id: "llanowar-elvish-exchange", name: "The Elvish Exchange" },
      ],
    },
    village: { id: "yavimaya-hollow", name: "Yavimaya Hollow", inn: "The Mossy Hearth", vendor: { id: "yavimaya-forager", name: "Yavimaya Forager" } },
    wilds: [
      { id: "llanowar-wilds", name: "Llanowar Wilds", feature: "grove" },
      { id: "yavimaya-coast", name: "Yavimaya Coast", feature: "coast", spellTable: true },
      { id: "krosan-verge", name: "Krosan Verge", feature: "river" },
    ],
    dungeon: { id: "heart-of-yavimaya", name: "The Heart of Yavimaya", floors: 3 },
    encounter: { id: "encounter-llanowar", name: "Llanowar Trail" },
    t1: ["llanowar-elves-pack", "elvish-scout"],
    t2: ["yavimaya-wurm", "multani-guard"],
    deep: ["krosan-beast", "yavimaya-ancient"],
    keeper: "heart-warden",
    boss: "multani",
    folk: [
      { name: "Elvish ranger", text: ["The forest is listening. Walk softly and it may even like you."] },
      { name: "Wurm herder", text: ["They're gentle, really. Just very, very large."] },
    ],
    board: ["Bounty: the wurm eating the north orchard.", "Wanted: anyone who can talk to Multani. Politely."],
  },
];

const HUB = {
  id: "new-argive",
  name: "New Argive",
  inn: "The Gilded Sprocket",
  vendors: [
    { id: "argive-goblin-trader", name: "Grizzlegom's Goblins" },
    { id: "argive-curio-dealer", name: "The Curio Dealer" },
    { id: "argive-artificer", name: "Argivian Artifacts" },
    { id: "argive-land-broker", name: "The Land Broker" },
    { id: "argive-spellsmith", name: "Instants and Sorceries" },
    { id: "argive-enchanter", name: "The Enchanter's Stall" },
    { id: "argive-legends", name: "Legends of Dominaria" },
    { id: "argive-knights", name: "The Knights' Outfitter" },
  ],
};

/**
 * The capstone (design.md A6): the Phyrexian Portal, open once all five colors are unlocked. Tier 4 Phyrexians on every
 * floor, the portal's warden keeping each, and on the last floor the five-color praetor who ends the Dominaria arc.
 */
const PORTAL = {
  id: "phyrexian-portal",
  name: "The Phyrexian Portal",
  floors: 4,
  requires: "WUBRG",
  first: ["phyrexian-ravager", "phyrexian-negator", "phyrexian-gorger"],
  deep: ["phyrexian-ravager", "gitaxian-mindcutter", "phyrexian-negator", "phyrexian-gorger"],
  keeper: "portal-warden",
  boss: "phyrexian-praetor",
  /** Where it stands on the world map: south of the hub, between Urborg's and Shiv's roads. */
  angle: Math.PI / 2,
  steps: 5,
};

// Regions round the hub clockwise from the top of the map, in wheel order: ally colors are neighbours.
const angleOf = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / 5;

/** Where every place is on the world map. */
const places = new Map<string, Hex>([[HUB.id, hex(0, 0)]]);
REGIONS.forEach((plan, i) => {
  const a = angleOf(i);
  places.set(plan.village.id, toward(a - 0.3, 7));
  places.set(plan.wilds[1]!.id, toward(a + 0.28, 8));
  places.set(plan.town.id, toward(a, 13));
  places.set(plan.wilds[0]!.id, toward(a - 0.3, 15));
  places.set(plan.wilds[2]!.id, toward(a + 0.3, 17));
  places.set(`${plan.dungeon.id}-1`, toward(a, 20));
});
places.set(`${PORTAL.id}-1`, toward(PORTAL.angle, PORTAL.steps));

/** The direction from one place to another on the world map, for where a map's exit to it goes. */
function bearing(from: string, to: string): number {
  const a = toWorld(places.get(from)!);
  const b = toWorld(to === "world" ? hex(0, 0) : places.get(to)!);
  if (Math.abs(a.x - b.x) + Math.abs(a.z - b.z) < 1e-6) return 0;
  return Math.atan2(b.z - a.z, b.x - a.x);
}

/** A map's exits: to the world map (toward the hub), and to the maps it joins on foot (toward them). */
function links(id: string, to: readonly string[]): Link[] {
  const out: Link[] = [{ to: "world", angle: bearing(id, "world") + (id === HUB.id ? 0.5 : 0) }];
  for (const t of to) {
    let angle = bearing(id, t);
    // Keep exits apart: nudge one that would sit on top of another.
    while (out.some((l) => Math.abs(Math.atan2(Math.sin(l.angle - angle), Math.cos(l.angle - angle))) < 0.6)) angle += 0.7;
    out.push({ to: t, angle });
  }
  return out;
}

/** The spike's meadow, kept as it was: the road, the pond, the outcrop and its spell table, now with its ways out. */
function benalishMeadow(plan: RegionPlan): MapData {
  const b = new MapBuilder("benalish-meadow", "Benalish Meadow", "wilderness", 16, "W");
  const pond = hex(5, -7);
  const outcrop = hex(-8, -2);
  const table = hex(-3, 3);
  const start = hex(0, 0);
  let seed = 7 >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const onRoad = (h: Hex) => h.q + h.r === 0 || h.q + h.r === 1;
  for (const h of spiral(hex(0, 0), 16)) {
    const roll = random();
    const wave = Math.sin(h.q * 0.45) + Math.cos(h.r * 0.38 + h.q * 0.2) + roll * 0.6;
    const cell = b.cell(h)!;
    cell.height = Math.max(0, Math.round(wave + 1)) * STEP;
    cell.terrain = "grass";
    if (distance(h, pond) <= 2) Object.assign(cell, { terrain: "water", height: -0.1, blocked: true });
    else if (distance(h, pond) === 3) Object.assign(cell, { terrain: "sand", height: 0 });
    else if (onRoad(h)) Object.assign(cell, { terrain: "dirt", height: STEP, fixed: true });
    else if (distance(h, outcrop) <= 2) {
      cell.terrain = "stone";
      cell.height += STEP * (3 - distance(h, outcrop));
      if (distance(h, outcrop) === 1 && roll < 0.5) Object.assign(cell, { prop: "rock", blocked: true });
    } else if (distance(h, start) > 3 && distance(h, table) > 2 && roll < 0.1) Object.assign(cell, { prop: "tree", blocked: true });
  }
  b.npc(table, { id: "spell-table", kind: "spell-table", name: "Spell table" });
  b.set(table, { terrain: "stone", height: STEP });
  for (const h of spiral(start, 1)) b.clear(h);
  // The road runs out at the map's two far corners: one way to the world map, the other to New Benalia.
  b.exit(hex(15, -15), "world");
  b.exit(hex(-15, 15), plan.town.id);
  b.chest(outcrop, "c1", [50, 200]);
  b.spawn(hex(7, 3), "s1", ["phyrexian-scout"], 4, 600);
  b.spawn(b.nearestOpen(hex(-6, 9)), "s2", plan.t1, 4, 600);
  b.spawn(b.nearestOpen(hex(-2, -10)), "s3", [...plan.t1, plan.t2[0]!], 4, 600);
  b.spawn(b.nearestOpen(hex(11, -4)), "s4", plan.t2, 3, 600);
  b.chest(b.nearestOpen(hex(9, 5)), "c2", [50, 250]);
  return b.build();
}

function plan(): MapData[] {
  const maps: MapData[] = [];
  const hubLinks: Link[] = [
    { to: "world", angle: Math.PI / 2 },
    { to: "world", angle: -Math.PI / 2 },
  ];
  maps.push(
    settlement({
      id: HUB.id,
      name: HUB.name,
      kind: "town",
      radius: 18,
      links: hubLinks,
      vendors: HUB.vendors,
      inn: HUB.inn,
      innkeeper: ["Welcome to New Argive. Rooms are free for mages; the Argivians are grateful, or say so."],
      board: [
        "The five color-wells of Dominaria are held by guardians. Earn each well's attunement.",
        "When all five are yours, the Phyrexian Portal will open. So say the seers.",
        "The arena opens soon. Practise your duelling.",
      ],
      folk: [
        { name: "Argivian scholar", text: ["Every road leads here, and every road leads away. Pick one."] },
        { name: "Town crier", text: ["Hear ye! Phyrexian stragglers sighted in every region! Arm yourselves with cards!"] },
        { name: "Merchant", text: ["Eight vendors in one square. Nowhere else on Dominaria can say that."] },
      ],
      centrepiece: "statue",
      walls: true,
    }),
  );

  for (const p of REGIONS) {
    const [w0, w1, w2] = p.wilds;
    maps.push(
      settlement({
        id: p.town.id,
        name: p.town.name,
        kind: "town",
        region: p.region,
        links: links(p.town.id, [w0!.id, w2!.id]),
        vendors: p.town.vendors,
        inn: p.town.inn,
        innkeeper: [`Welcome to ${p.town.name}, mage. Rest here, and here you wake if a duel goes badly.`],
        board: p.board,
        folk: p.folk,
        centrepiece: p.town.centrepiece,
        walls: true,
      }),
    );
    maps.push(
      settlement({
        id: p.village.id,
        name: p.village.name,
        kind: "village",
        region: p.region,
        links: links(p.village.id, [w1!.id]),
        vendors: [p.village.vendor],
        inn: p.village.inn,
        innkeeper: [`${p.village.inn}. Small, but the beds are dry.`],
        board: [`Travellers: the roads of ${p.name} are not safe after dark.`],
      }),
    );
    const mixed = [...p.t1, ...p.t2];
    maps.push(
      w0!.id === "benalish-meadow"
        ? benalishMeadow(p)
        : wilderness({ id: w0!.id, name: w0!.name, region: p.region, links: links(w0!.id, [p.town.id]), spawns: [p.t1, mixed, p.t1, p.t2], chests: 2, feature: w0!.feature, spellTable: w0!.spellTable }),
      wilderness({ id: w1!.id, name: w1!.name, region: p.region, links: links(w1!.id, [p.village.id]), spawns: [p.t1, p.t1, mixed], chests: 1, feature: w1!.feature, spellTable: w1!.spellTable }),
      wilderness({ id: w2!.id, name: w2!.name, region: p.region, radius: 18, links: links(w2!.id, [p.town.id]), spawns: [mixed, p.t2, p.t2, mixed, p.t1], chests: 2, feature: w2!.feature, spellTable: w2!.spellTable }),
    );
    for (let floor = 1; floor <= p.dungeon.floors; floor++) {
      const last = floor === p.dungeon.floors;
      maps.push(
        dungeon({
          id: `${p.dungeon.id}-${floor}`,
          name: `${p.dungeon.name}, floor ${floor}`,
          region: p.region,
          floor,
          floors: p.dungeon.floors,
          up: floor === 1 ? "world" : `${p.dungeon.id}-${floor - 1}`,
          down: last ? undefined : `${p.dungeon.id}-${floor + 1}`,
          mobs: floor <= 1 ? [...p.t2, p.deep[0]!] : p.deep,
          keeper: p.keeper,
          boss: last ? p.boss : undefined,
        }),
      );
    }
    maps.push(encounter({ id: p.encounter.id, name: p.encounter.name, region: p.region, mobs: mixed }));
  }

  for (let floor = 1; floor <= PORTAL.floors; floor++) {
    const last = floor === PORTAL.floors;
    maps.push(
      dungeon({
        id: `${PORTAL.id}-${floor}`,
        name: `${PORTAL.name}, floor ${floor}`,
        style: "phyrexia",
        requires: PORTAL.requires,
        floor,
        floors: PORTAL.floors,
        up: floor === 1 ? "world" : `${PORTAL.id}-${floor - 1}`,
        down: last ? undefined : `${PORTAL.id}-${floor + 1}`,
        mobs: floor <= 1 ? PORTAL.first : PORTAL.deep,
        keeper: PORTAL.keeper,
        boss: last ? PORTAL.boss : undefined,
      }),
    );
  }

  const roads: string[][] = [];
  REGIONS.forEach((p, i) => {
    const next = REGIONS[(i + 1) % REGIONS.length]!;
    roads.push([HUB.id, p.village.id, p.town.id, `${p.dungeon.id}-1`]);
    roads.push([p.village.id, p.wilds[1]!.id]);
    roads.push([p.town.id, p.wilds[0]!.id]);
    roads.push([p.town.id, p.wilds[2]!.id]);
    roads.push([p.village.id, next.village.id]);
  });
  roads.push([HUB.id, `${PORTAL.id}-1`]);
  maps.push(
    world({
      radius: 26,
      regions: REGIONS.map((p, i) => ({ region: p.region, angle: angleOf(i), encounter: p.encounter.id })),
      places: [...places].map(([id, at]) => ({ id, at })),
      roads,
    }),
  );
  return maps;
}

/**
 * Every map's inn (interfaces.md, "Maps"): a town's or village's is its own, written where it was built; any other
 * map's is its nearest town's or village's on the world map, worked out here once so nothing works it out in play.
 */
async function withInns(planned: readonly MapData[]): Promise<MapData[]> {
  const byId = new Map(planned.map((m) => [m.id, m]));
  const load = (id: string) => {
    const map = byId.get(id);
    return map ? Promise.resolve(map) : Promise.reject(new Error(`no map ${id}`));
  };
  const out: MapData[] = [];
  for (const map of planned) {
    if (map.kind === "world" || map.kind === "town" || map.kind === "village") {
      out.push(map);
      continue;
    }
    const inn = await innOf(map.id, load);
    if (!inn) throw new Error(`${map.id}: no town or village can be found from it`);
    out.push({ ...map, inn });
  }
  return out;
}

const maps = await withInns(plan());
const ids = new Set(maps.map((m) => m.id));
let bad = 0;
for (const map of maps) {
  const problems = validateMap(map, ids);
  if (problems.length > 0) {
    bad++;
    console.error(`${map.id}:\n  ${problems.join("\n  ")}`);
  }
}
mkdirSync(out, { recursive: true });
for (const file of readdirSync(out)) {
  const id = file.replace(/\.json$/, "");
  if (file.endsWith(".json") && !ids.has(id) && !HAND_TUNED.has(id)) unlinkSync(join(out, file));
}
for (const map of maps) {
  if (HAND_TUNED.has(map.id)) continue;
  writeFileSync(join(out, `${map.id}.json`), formatMap(map));
}
const count = (kind: string) => maps.filter((m) => m.kind === kind).length;
console.log(
  `maps.ts: ${maps.length} maps (${count("town")} towns, ${count("village")} villages, ${count("wilderness")} wilderness, ${count("dungeon")} dungeon floors, ${count("world")} world)${bad ? `; ${bad} with problems` : ""}`,
);
const mobs = new Set(maps.flatMap((m) => m.spawns.flatMap((s) => s.mobs)));
console.log(`mobs: ${[...mobs].sort().join(", ")}`);
if (bad) process.exitCode = 1;
void key;
void neighbors;
