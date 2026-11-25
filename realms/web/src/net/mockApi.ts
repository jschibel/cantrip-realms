// The realm server's API in memory (?offline): a character, their hearts, a collection, gold, vendors, an armorer,
// encounters - a loss's heart, the buyout, the rematch, death - and chests that behave as interfaces.md says the server's do, so the whole overworld can be played and tested with no
// server. Nothing here is the economy - the server owns that - and the cards and gear in it are a small stand-in set.

import type { BodyName as Body, ManaColor, Slot } from "../art/figures";
import { STARTING_HEARTS, buyout, heartPriceAfter } from "../hearts";
import { mobInfo } from "../mobs";
import { mobSeat, playerSeat, starterDeck } from "./mockDuel";
import { mulberry32 } from "../random";
import { DUNGEONS, PLANE_NAMES, VENDORS, type VendorFile, WORLD, besideEntrance, innOf, startTown, tilesApart, waystoneTiles } from "../world/realm";
import { type DungeonData, townAt } from "../world/format";
import { dealtBy, tableOf } from "../world/standing";

const INNS = WORLD.inns;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * The traveling traders' schedule as the server keeps it (design.md A5; interfaces.md, "Vendors"): on Unix day `d` (UTC) a
 * trader's caravan is in `towns[d mod towns.length]` from `hour` o'clock for `hours` hours - the date alone decides it.
 * Every trader of the vendor files, in id order, with the visit it is on at `nowMs` (null between visits) and the next.
 */
export function travelersAt(nowMs: number): Traveler[] {
  const visitOn = (round: NonNullable<VendorFile["trader"]>, day: number) => {
    const from = day * DAY_MS + round.hour * HOUR_MS;
    const town = round.towns[((day % round.towns.length) + round.towns.length) % round.towns.length]!;
    return { Town: town, From: from, Until: from + round.hours * HOUR_MS };
  };
  const iso = (v: { Town: string; From: number; Until: number }) => ({ Town: v.Town, From: new Date(v.From).toISOString(), Until: new Date(v.Until).toISOString() });
  const today = Math.floor(nowMs / DAY_MS);
  return [...VENDORS.values()]
    .filter((v) => v.trader)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((v) => {
      const round = v.trader!;
      const visit = visitOn(round, today);
      const now = nowMs >= visit.From && nowMs < visit.Until ? iso(visit) : null;
      const next = visit.From > nowMs ? visit : visitOn(round, today + 1);
      return { Id: v.id, Name: v.name, Plane: round.plane, PlaneName: PLANE_NAMES.get(round.plane) ?? round.plane, Visit: now, Next: iso(next) };
    });
}
import {
  ApiError,
  type Character,
  type CardCount,
  type Collection,
  type Deck,
  type Defeat,
  type EncounterAt,
  type EncounterResult,
  type EncounterStart,
  type Gear,
  type GearInstance,
  type HeartsBought,
  type Place,
  type RealmApi,
  type Rematch,
  type Run,
  type RunFloor,
  type Traveler,
  type VendorView,
} from "./api";

/** A few Dominaria cards and their list prices in gold, for the stand-in collection, vendors and loot. */
const CARDS: readonly { Name: string; Gold: number; Color: ManaColor | "C" }[] = [
  { Name: "Benalish Marshal", Gold: 120, Color: "W" },
  { Name: "Serra Angel", Gold: 90, Color: "W" },
  { Name: "Knight of Grace", Gold: 80, Color: "W" },
  { Name: "Pacifism", Gold: 60, Color: "W" },
  { Name: "Opt", Gold: 55, Color: "U" },
  { Name: "Academy Journeymage", Gold: 55, Color: "U" },
  { Name: "Tolarian Scholar", Gold: 52, Color: "U" },
  { Name: "Counterspell", Gold: 150, Color: "U" },
  { Name: "Cast Down", Gold: 110, Color: "B" },
  { Name: "Urborg Drake", Gold: 55, Color: "B" },
  { Name: "Deathbloom Thallid", Gold: 60, Color: "B" },
  { Name: "Vicious Offering", Gold: 70, Color: "B" },
  { Name: "Shivan Fire", Gold: 65, Color: "R" },
  { Name: "Fiery Intervention", Gold: 58, Color: "R" },
  { Name: "Keldon Raider", Gold: 60, Color: "R" },
  { Name: "Goblin Chainwhirler", Gold: 260, Color: "R" },
  { Name: "Llanowar Elves", Gold: 75, Color: "G" },
  { Name: "Yavimaya Sapherd", Gold: 52, Color: "G" },
  { Name: "Grow from the Ashes", Gold: 55, Color: "G" },
  { Name: "Steel Leaf Champion", Gold: 140, Color: "G" },
  { Name: "Icy Manipulator", Gold: 80, Color: "C" },
  { Name: "Juggernaut", Gold: 95, Color: "C" },
];

/** The basic lands, free and never in the collection (design.md A1). */
const BASICS: ReadonlySet<string> = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]);

/** The gear catalogue's files (realms/content/gear), for a boss's unique item as the server drops it. */
interface GearFile {
  readonly id: string;
  readonly name: string;
  readonly slot: Gear["Slot"];
  readonly rarity: Gear["Rarity"];
  readonly gold: number;
  readonly stats: { readonly life: number; readonly hand: number; readonly maxHand: number };
  readonly effects: readonly Record<string, unknown>[];
  readonly text: string;
  readonly look: { readonly mesh: string; readonly palette: readonly string[] };
  readonly unique?: boolean;
}
const GEAR_FILES = new Map(Object.values(import.meta.glob<GearFile>("../../../content/gear/*.json", { eager: true, import: "default" })).map((g) => [g.id, g]));

/** A gear item of the catalogue as the server sends it (PascalCase, with its emblem's name). */
function catalogueGear(id: string): Gear | null {
  const g = GEAR_FILES.get(id);
  if (!g) return null;
  return {
    Id: g.id,
    Name: g.name,
    Slot: g.slot,
    Rarity: g.rarity,
    Gold: g.gold,
    Stats: { Life: g.stats.life, Hand: g.stats.hand, MaxHand: g.stats.maxHand },
    Effects: g.effects,
    Text: g.text,
    Look: { Mesh: g.look.mesh, Palette: g.look.palette },
    Unique: g.unique ?? false,
    Emblem: g.effects.length > 0 ? `${g.name} (gear)` : null,
  };
}

/** How long a beaten boss rests (design.md A6: refought weekly), as the server's Dungeons.BossRest. */
export const BOSS_REST_MS = 7 * DAY_MS;

const gear = (g: Omit<Gear, "Effects" | "Unique" | "Stats" | "Emblem"> & { Stats?: Partial<Gear["Stats"]> }): Gear => ({
  Effects: [],
  Unique: false,
  Emblem: null,
  ...g,
  Stats: { Life: 0, Hand: 0, MaxHand: 0, ...g.Stats },
});

/** The stand-in gear: one of each look, so every slot's mesh can be seen. */
export const MOCK_GEAR: readonly Gear[] = [
  gear({ Id: "circlet-of-foresight", Name: "Circlet of Foresight", Slot: "head", Rarity: "uncommon", Gold: 1200, Stats: { MaxHand: 1 }, Text: "Your maximum hand size is increased by one.", Look: { Mesh: "circlet", Palette: ["#f1b44c", "#5b8fd6"] } }),
  gear({ Id: "kjeldoran-helm", Name: "Kjeldoran Helm", Slot: "head", Rarity: "common", Gold: 350, Stats: { MaxHand: 1 }, Text: "Your maximum hand size is increased by one.", Look: { Mesh: "helm", Palette: ["#9aa0aa", "#3a5f8f"] } }),
  gear({ Id: "copper-amulet", Name: "Copper Amulet", Slot: "neck", Rarity: "common", Gold: 300, Stats: { MaxHand: 1 }, Text: "Your maximum hand size is increased by one.", Look: { Mesh: "amulet", Palette: ["#b8733a", "#3f8f6b"] } }),
  gear({ Id: "padded-jerkin", Name: "Padded Jerkin", Slot: "body", Rarity: "common", Gold: 300, Stats: { Life: 3 }, Text: "You start the game with 3 additional life.", Look: { Mesh: "armor", Palette: ["#8a6a43", "#5a4630"] } }),
  gear({ Id: "tolarian-robe", Name: "Tolarian Robe", Slot: "body", Rarity: "uncommon", Gold: 900, Stats: { Life: 4 }, Text: "You start the game with 4 additional life.", Look: { Mesh: "robe", Palette: ["#5b8fd6", "#f4ecc2"] } }),
  gear({ Id: "brawlers-gloves", Name: "Brawler's Gloves", Slot: "hands", Rarity: "common", Gold: 400, Text: "The first creature you cast each game enters with an additional +1/+1 counter.", Look: { Mesh: "gloves", Palette: ["#6b3f22", "#a8432f"] } }),
  gear({ Id: "travelers-boots", Name: "Traveler's Boots", Slot: "feet", Rarity: "common", Gold: 300, Stats: { Life: 2 }, Text: "You start the game with 2 additional life.", Look: { Mesh: "boots", Palette: ["#5c4128", "#8f7a55"] } }),
  gear({ Id: "copper-ring", Name: "Copper Ring", Slot: "ring", Rarity: "common", Gold: 300, Stats: { Life: 1 }, Text: "You start the game with 1 additional life.", Look: { Mesh: "ring", Palette: ["#b8733a", "#b8733a"] } }),
  gear({ Id: "tinkers-talisman", Name: "Tinker's Talisman", Slot: "relic", Rarity: "uncommon", Gold: 1500, Text: "{1}: Scry 2. Activate only once each game.", Look: { Mesh: "relic", Palette: ["#c9a46a", "#4a7fbf"] } }),
];


/** A seat's setup values to deal a duel with instead of its own (the server's POST /dev/duel; realmTest.forceDuel). */
export interface DevSeat {
  readonly StartingLife?: number;
  readonly StartingHandSize?: number;
  readonly MaximumHandSize?: number;
  readonly Deck?: readonly string[];
  readonly Emblems?: readonly string[];
}

export interface DevDuel {
  readonly Player?: DevSeat | null;
  readonly Mob?: DevSeat | null;
}

/** A game of an encounter, as the server keeps its row: what it was dealt, and how it ended. */
interface Encounter {
  readonly token: string;
  readonly mob: string;
  /** A dungeon run's encounter: its run, floor and index. */
  readonly run?: { readonly id: string; readonly floor: number; readonly index: number };
  /** Where it was met (the spawn's id, or the run's `<floor>:<index>`). */
  readonly spawn: string;
  readonly game: number;
  /** The duel as dealt, and the sideboard it was played with. */
  readonly duel: EncounterStart["Duel"];
  readonly sideboard: readonly CardCount[];
  /** The mob's full starting life for the encounter: what its buyout is measured against. */
  readonly fullLife: number;
  outcome?: "won" | "lost";
  /** The mob's life at the end, as the card layer said it; its starting life when it did not. */
  mobLife?: number;
  result?: EncounterResult;
  /** What the game came to: open, won, defeated (awaiting the answer), paid, rematched or lost (the last heart). */
  state: "open" | "won" | "defeated" | "paid" | "rematched" | "lost";
  price: number | null;
  /** What a win in a run gave, for death in the run to take back. */
  gift?: string | null;
  gear?: GearInstance | null;
}

export class MockApi implements RealmApi {
  readonly offline = true;
  private character: Character | null = null;
  private cards: Record<string, number> = {};
  private deck: Deck = { Main: [], Sideboard: [] };
  private readonly encounters = new Map<string, Encounter>();
  private readonly chestsOpened = new Set<string>();
  private readonly runs = new Map<string, { run: Run; dungeon: string; floor: number; fought: Set<string>; live: boolean }>();
  private attuned: string[];
  /** When each boss was last beaten (unix ms on the stand-in clock), for its week of rest. */
  private readonly bossWins = new Map<string, number>();
  /** The town whose inn the character set as home. */
  private inn: string | null = null;
  private readonly random: () => number;
  private nextToken = 1;
  private nextInstance = 1;
  /** Every call made, by name, for tests to see (realmTest.api). */
  readonly calls: { name: string; body?: unknown }[] = [];
  /** The seats a test forced the next duels to be dealt with (realmTest.forceDuel), or null. */
  devDuel: DevDuel | null = null;
  /** What the clock says, in unix seconds (tests may pin it). */
  now: () => number = () => Date.now() / 1000;

  constructor(seed = 1, character?: { name: string; body: Body; palette: number; color: ManaColor }, attuned: readonly string[] = []) {
    this.random = mulberry32(seed);
    this.attuned = [...attuned];
    if (character) this.make(character.name, character.body, character.palette, character.color);
  }

  private log(name: string, body?: unknown): void {
    this.calls.push(body === undefined ? { name } : { name, body });
  }

  private need(): Character {
    if (!this.character) throw new ApiError(404, "NoCharacter", "Make a character first.");
    return this.character;
  }

  private update(patch: Partial<Character>): Character {
    this.character = { ...this.need(), ...patch };
    this.character = { ...this.character, HeartPrice: heartPriceAfter(this.character.MaxHearts), Defeat: this.pendingDefeat() };
    return this.character;
  }

  /** The game lost with hearts left and not yet answered, as the character shows it. */
  private pendingDefeat(): Defeat | null {
    const e = [...this.encounters.values()].find((x) => x.state === "defeated");
    return e ? this.defeatOf(e) : null;
  }

  private defeatOf(e: Encounter): Defeat {
    const c = this.need();
    const counts = new Map<string, number>();
    for (const name of (e.duel.Seats[0]?.["Deck"] as string[] | undefined) ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
    return {
      Token: e.token,
      Mob: e.mob,
      Spawn: e.spawn,
      Epoch: 0,
      Game: e.game,
      Hearts: c.Hearts,
      MaxHearts: c.MaxHearts,
      MobLife: e.mobLife ?? Number(e.duel.Seats[1]?.["StartingLife"] ?? 0),
      MobFullLife: e.fullLife,
      Price: e.price,
      Main: [...counts].map(([Name, Count]) => ({ Name, Count })).sort((a, b) => (a.Name < b.Name ? -1 : 1)),
      Sideboard: e.sideboard,
    };
  }

  private make(name: string, body: Body, palette: number, color: ManaColor): Character {
    const kit = ["kjeldoran-helm", "padded-jerkin", "travelers-boots"].map((id) => MOCK_GEAR.find((g) => g.Id === id)!);
    const owned: GearInstance[] = kit.map((g) => ({ InstanceId: this.nextInstance++, Gear: g }));
    // A test may make a character of several colors at once ("WUBRG"): the first is the starting one.
    const colors = [...color].filter((l): l is ManaColor => "WUBRG".includes(l));
    // A new character begins at the start town, as the server's do.
    const inn = innOf(startTown().id);
    this.character = {
      Id: "offline-player",
      Name: name,
      Body: body,
      Palette: palette,
      Identity: "WUBRG".split("").filter((l) => colors.includes(l as ManaColor)).join(""),
      Gold: 2000,
      Hearts: STARTING_HEARTS,
      MaxHearts: STARTING_HEARTS,
      HeartPrice: heartPriceAfter(STARTING_HEARTS),
      Defeat: null,
      Space: "world",
      X: inn.x,
      Z: inn.z,
      Stats: { Life: 20 + 3 + 2, Hand: 7, MaxHand: 7 + 1 },
      Loadout: { head: owned[0], neck: null, body: owned[1], hands: null, feet: owned[2], ring1: null, ring2: null, relic: null },
      Gear: owned,
      // As the server says it: the colors unlocked since, never the starting one.
      Unlocked: colors.slice(1),
      Attuned: [...this.attuned],
      Inn: inn.id,
    };
    const own = CARDS.filter((c) => colors.includes(c.Color as ManaColor) || c.Color === "C");
    this.cards = Object.fromEntries(own.map((c) => [c.Name, 4]));
    // The starting color's starter deck, as the server deals a new character (design.md A1), its cards owned beside the
    // stand-ins; and two of the stand-ins in the sideboard, so a rematch has something to swap in.
    const starter = starterDeck(colors[0] ?? "W");
    for (const c of starter) if (!BASICS.has(c.Name)) this.cards[c.Name] = (this.cards[c.Name] ?? 0) + c.Count;
    this.deck = { Main: starter, Sideboard: own.slice(0, 2).map((c) => ({ Name: c.Name, Count: 1 })) };
    return this.update({});
  }

  async me(): Promise<Character | null> {
    this.log("me");
    return this.character;
  }

  async createCharacter(body: { Name: string; Body: Body; Palette: number; Color: ManaColor }): Promise<Character> {
    this.log("createCharacter", body);
    if (this.character) throw new ApiError(409, "HasCharacter", "You already have a character.");
    return this.make(body.Name, body.Body, body.Palette, body.Color);
  }

  async collection(): Promise<Collection> {
    this.log("collection");
    this.need();
    return { Cards: { ...this.cards } };
  }

  async saveDeck(deck: Deck): Promise<Deck> {
    this.log("saveDeck", deck);
    this.need();
    this.deck = deck;
    this.update({});
    return deck;
  }

  async saveLoadout(slots: Partial<Record<Slot, number | null>>): Promise<Character> {
    this.log("saveLoadout", slots);
    const c = this.need();
    const loadout: Partial<Record<Slot, GearInstance | null>> = { ...c.Loadout };
    for (const [slot, id] of Object.entries(slots) as [Slot, number | null][]) {
      if (id === null) loadout[slot] = null;
      else {
        const owned = c.Gear.find((g) => g.InstanceId === id);
        if (!owned) throw new ApiError(422, "IllegalLoadout", `No gear ${id}.`);
        loadout[slot] = owned;
      }
    }
    return this.update({ Loadout: loadout });
  }

  async vendor(id: string): Promise<VendorView> {
    this.log("vendor", { id });
    const pick = mulberry32(id.length * 7919 + id.charCodeAt(0));
    const stock = CARDS.filter(() => pick() < 0.4).map((c) => ({ Name: c.Name, Gold: c.Gold, Count: 1 + Math.floor(pick() * 3), Until: null }));
    const used = (name: string) => [...this.deck.Main, ...this.deck.Sideboard].filter((c) => c.Name === name).reduce((n, c) => n + c.Count, 0);
    const buying = CARDS.filter((c) => (this.cards[c.Name] ?? 0) > 0).map((c) => ({
      Name: c.Name,
      Gold: Math.floor(c.Gold / 2),
      Owned: this.cards[c.Name]!,
      Spare: Math.max(0, this.cards[c.Name]! - used(c.Name)),
    }));
    const file = VENDORS.get(id);
    if (!file) throw new ApiError(404, "NoVendor", `No vendor ${id}.`);
    const kind = file.trader ? "trader" : file.exotic ? "exotic" : "shop";
    const town = file.trader ? (travelersAt(this.now() * 1000).find((t) => t.Id === id)?.Visit?.Town ?? "") : (file.town ?? "");
    return { Vendor: { Id: id, Name: file.name, Town: town, Specialty: {}, Kind: kind, Plane: file.trader?.plane ?? null }, Purse: 50000, Stock: stock, Gold: this.character?.Gold ?? 0, Buying: buying };
  }

  async buy(vendor: string, name: string): Promise<{ Gold: number; Collection: Collection }> {
    this.log("buy", { vendor, name });
    const c = this.need();
    const card = CARDS.find((k) => k.Name === name);
    if (!card) throw new ApiError(409, "SoldOut", `${name} is sold out.`);
    if (c.Gold < card.Gold) throw new ApiError(409, "CannotAfford", `${name} costs ${card.Gold} gold.`);
    this.cards[name] = (this.cards[name] ?? 0) + 1;
    this.update({ Gold: c.Gold - card.Gold });
    return { Gold: this.need().Gold, Collection: { Cards: { ...this.cards } } };
  }

  async sell(vendor: string, name: string): Promise<{ Gold: number; Collection: Collection }> {
    this.log("sell", { vendor, name });
    const c = this.need();
    const card = CARDS.find((k) => k.Name === name);
    if (!card || !this.cards[name]) throw new ApiError(409, "NotTheirTrade", `${vendor} doesn't deal in ${name}.`);
    this.cards[name]! -= 1;
    this.update({ Gold: c.Gold + Math.floor(card.Gold / 2) });
    return { Gold: this.need().Gold, Collection: { Cards: { ...this.cards } } };
  }

  async armorer(town: string): Promise<{ Stock: readonly Gear[] }> {
    this.log("armorer", { town });
    return { Stock: MOCK_GEAR };
  }

  async startEncounter(body: EncounterAt): Promise<EncounterStart> {
    this.log("startEncounter", body);
    const c = this.need();
    const open = [...this.encounters.values()].find((e) => e.state === "open");
    if (open) {
      // A duel never finished counts as lost when the next encounter starts (design.md, A3).
      open.outcome = "lost";
      await this.finishEncounter({ Token: open.token, Log: [] });
      throw new ApiError(409, "Unfinished", "The duel before this one was never finished, so it counts as lost.");
    }
    const defeated = [...this.encounters.values()].find((e) => e.state === "defeated");
    if (defeated) throw new ApiError(409, "Defeated", `${mobInfo(defeated.mob).name} still stands over you: pay it off or fight it again first.`);
    let run: Encounter["run"];
    let gains: RunFloor["BossStats"] = null;
    if ("Run" in body) {
      const live = this.runs.get(body.Run);
      if (!live?.live) throw new ApiError(404, "NotThere", "No such run.");
      if (live.floor !== body.Floor) throw new ApiError(409, "NotThere", "You are not on that floor.");
      const floor = live.run.Floors[body.Floor]!;
      const n = floor.Encounters.length;
      const mob = body.Index === n ? floor.Warden : body.Index === n + 1 ? floor.Boss : floor.Encounters.find((e) => e.Index === body.Index)?.Mob;
      if (!mob || mob !== body.Mob) throw new ApiError(409, "NotThere", "No such encounter on this floor.");
      if (live.fought.has(`${body.Floor}:${body.Index}`)) throw new ApiError(409, "TooSoon", "Already beaten in this run.");
      run = { id: body.Run, floor: body.Floor, index: body.Index };
      // A boss gains what its run's standing gives it (design.md A6).
      if (body.Index === n + 1) gains = floor.BossStats ?? null;
    }
    const mob = mobInfo(body.Mob);
    const token = `duel-${this.nextToken++}`;
    const seed = Math.floor(this.random() * 2 ** 31);
    // Dealt as the server deals it (mockDuel.ts), with what a test forced; a mob with no deck file plays the white starter.
    const dealt = gaining((await mobSeat(body.Mob)) ?? playerSeat({ ...c, Name: mob.name, Loadout: {} }, { Main: starterDeck("W"), Sideboard: [] }), gains);
    const duel: EncounterStart["Duel"] = {
      Seats: [{ ...playerSeat(c, this.deck), ...this.devDuel?.Player }, { ...dealt, ...this.devDuel?.Mob }],
      MinimumDeckSize: 40,
      Seed: seed,
      Mob: { Name: mob.name, Tier: mob.boss ? 0 : mob.tier },
      Game: 1,
      FirstPlayer: null,
    };
    const spawn = run ? `${run.floor}:${run.index}` : "Spawn" in body ? body.Spawn : "";
    this.encounters.set(token, { token, mob: body.Mob, spawn, game: 1, duel, sideboard: this.deck.Sideboard, fullLife: Number(dealt["StartingLife"] ?? 20), state: "open", price: null, ...(run ? { run } : {}) });
    return { Token: token, Seed: seed, Duel: duel };
  }

  /**
   * The stand-in for the server's replay of the duel's log: the mock is told how the duel ended and the mob's life at its
   * end, since it plays no engine. The overworld tells it before finishing, when the card layer says.
   */
  settle(token: string, outcome: "won" | "lost", mobLife?: number): void {
    const encounter = this.encounters.get(token);
    if (encounter && !encounter.result) {
      encounter.outcome = outcome;
      if (mobLife !== undefined) encounter.mobLife = mobLife;
    }
  }

  async finishEncounter(body: { Token: string; Log: readonly string[] }): Promise<EncounterResult> {
    this.log("finishEncounter", { Token: body.Token, Log: body.Log.length });
    const encounter = this.encounters.get(body.Token);
    if (!encounter) throw new ApiError(409, "Unknown", "No such duel.");
    if (encounter.result) return encounter.result;
    const c = this.need();
    const won = encounter.outcome === "won";
    const mob = mobInfo(encounter.mob);
    if (won) {
      const [low, high] = mob.goldRange;
      const gold = low + Math.floor(this.random() * (high - low + 1));
      // A boss (design.md A6): its color unlocked, a rare of its loot given outright, its unique item the first time.
      let unlocked: ManaColor | null = null;
      let gift: string | null = null;
      let dropped: GearInstance | null = null;
      if (mob.boss) {
        this.bossWins.set(mob.id, this.now() * 1000);
        if (mob.unlocks && !c.Identity.includes(mob.unlocks)) {
          unlocked = mob.unlocks;
          const colors = [...c.Unlocked, mob.unlocks];
          this.update({ Unlocked: colors, Identity: "WUBRG".split("").filter((l) => c.Identity.includes(l) || l === mob.unlocks).join("") });
        }
        // The stand-in's dearest cards of the boss's color stand for its loot's rares.
        const colored = CARDS.filter((k) => k.Color === mob.unlocks);
        const rares = (colored.length > 0 ? colored : CARDS).filter((k, _, all) => k.Gold >= Math.max(...all.map((c) => c.Gold)) * 0.5);
        gift = rares[Math.floor(this.random() * rares.length)]!.Name;
        this.cards[gift] = (this.cards[gift] ?? 0) + 1;
        const own = mob.unique ? catalogueGear(mob.unique) : null;
        if (own && !this.need().Gear.some((g) => g.Gear.Id === own.Id)) {
          dropped = { InstanceId: this.nextInstance++, Gear: own };
          this.update({ Gear: [...this.need().Gear, dropped] });
        }
      }
      encounter.state = "won";
      encounter.gift = gift;
      encounter.gear = dropped;
      this.update({ Gold: this.need().Gold + gold });
      encounter.result = { Outcome: "won", Gold: gold, Gear: dropped, Relics: [], Detail: null, Gift: gift, Unlocked: unlocked, Hearts: this.need().Hearts };
      if (encounter.run) {
        const live = this.runs.get(encounter.run.id)!;
        live.fought.add(`${encounter.run.floor}:${encounter.run.index}`);
        // Beating a mage tower's boss attunes its waystone (design.md A6).
        const dungeon = DUNGEONS.get(live.dungeon);
        if (encounter.run.index === live.run.Floors[encounter.run.floor]!.Encounters.length + 1 && dungeon?.waystone && !this.attuned.includes(dungeon.id)) {
          this.attuned.push(dungeon.id);
          this.update({ Attuned: [...this.attuned] });
        }
      }
      return encounter.result;
    }

    // A loss pays nothing and costs a heart (design.md A3b).
    encounter.mobLife ??= Number(encounter.duel.Seats[1]?.["StartingLife"] ?? 0);
    const hearts = Math.max(0, c.Hearts - 1);
    this.update({ Hearts: hearts });
    if (hearts > 0) {
      encounter.state = "defeated";
      encounter.price = encounter.run ? null : buyout(mob.tier, encounter.mobLife, encounter.fullLife);
      const defeat = this.defeatOf(encounter);
      this.update({});
      encounter.result = { Outcome: "lost", Gold: 0, Gear: null, Relics: [], Detail: null, Hearts: hearts, Defeat: defeat, Died: false };
      return encounter.result;
    }

    // The last heart: home, the hearts full, and a run died in over, its winnings taken back.
    encounter.state = "lost";
    let forfeit: EncounterResult["Forfeit"] = null;
    if (encounter.run) {
      const live = this.runs.get(encounter.run.id)!;
      live.live = false;
      const wins = [...this.encounters.values()].filter((e) => e.run?.id === encounter.run!.id && e.state === "won");
      const gold = wins.reduce((n, e) => n + (e.result?.Gold ?? 0), 0);
      const cards = wins.map((e) => e.gift).filter((g): g is string => !!g);
      for (const card of cards) this.cards[card] = Math.max(0, (this.cards[card] ?? 1) - 1);
      const gone = new Set(wins.map((e) => e.gear?.InstanceId).filter((g): g is number => g !== undefined));
      const loadout = Object.fromEntries(Object.entries(this.need().Loadout).map(([slot, worn]) => [slot, worn && gone.has(worn.InstanceId) ? null : worn]));
      this.update({ Gold: Math.max(0, this.need().Gold - gold), Gear: this.need().Gear.filter((g) => !gone.has(g.InstanceId)), Loadout: loadout });
      forfeit = { Gold: gold, Cards: cards, Gear: wins.map((e) => e.gear?.Gear.Name).filter((g): g is string => !!g) };
    }
    const inn = innOf(this.inn ?? startTown().id);
    this.update({ Space: "world", X: inn.x, Z: inn.z, Hearts: this.need().MaxHearts });
    encounter.result = { Outcome: "lost", Gold: 0, Gear: null, Relics: [], Detail: null, Hearts: this.need().Hearts, Defeat: null, Died: true, Forfeit: forfeit };
    return encounter.result;
  }

  private defeated(token: string): Encounter {
    const e = this.encounters.get(token);
    if (!e) throw new ApiError(404, "NoDuel", "You have no such duel.");
    if (e.state !== "defeated") throw new ApiError(409, "Finished", "That duel is over.");
    return e;
  }

  async payEncounter(body: { Token: string }): Promise<{ Gold: number }> {
    this.log("payEncounter", body);
    const e = this.defeated(body.Token);
    if (e.price === null) throw new ApiError(409, "NoBuyout", `${mobInfo(e.mob).name} can't be bought off: fight it again.`);
    const c = this.need();
    if (c.Gold < e.price) throw new ApiError(409, "CannotAfford", `${mobInfo(e.mob).name} asks ${e.price} gold.`);
    e.state = "paid";
    this.update({ Gold: c.Gold - e.price });
    return { Gold: this.need().Gold };
  }

  async rematch(body: Rematch): Promise<EncounterStart> {
    this.log("rematch", body);
    const last = this.defeated(body.Token);
    const total = body.Main.reduce((n, card) => n + card.Count, 0);
    const aside = body.Sideboard.reduce((n, card) => n + card.Count, 0);
    if (total < 40 || aside > 15) throw new ApiError(422, "IllegalDeck", "That deck can't be played in the next game.");
    last.state = "rematched";
    const c = this.need();
    const token = `duel-${this.nextToken++}`;
    const seed = Math.floor(this.random() * 2 ** 31);
    const carried = last.mobLife ?? Number(last.duel.Seats[1]?.["StartingLife"] ?? 0);
    const duel: EncounterStart["Duel"] = {
      ...last.duel,
      Seats: [{ ...playerSeat(c, { Main: body.Main, Sideboard: body.Sideboard }), ...this.devDuel?.Player }, { ...last.duel.Seats[1], StartingLife: carried }],
      Seed: seed,
      Game: last.game + 1,
      FirstPlayer: body.PlayFirst ? 1 : 2,
    };
    this.encounters.set(token, { ...last, token, game: last.game + 1, duel, sideboard: body.Sideboard, state: "open", price: null, outcome: undefined, mobLife: undefined, result: undefined });
    this.update({});
    return { Token: token, Seed: seed, Duel: duel };
  }

  async buyHeart(): Promise<HeartsBought> {
    this.log("buyHeart");
    const c = this.need();
    // A healer works in a temple or a shrine (the stand-in knows them by their rooms' ids).
    if (!/-(temple|shrine)$/.test(c.Space)) throw new ApiError(409, "NotNear", "Hearts are blessed by a healer, at a temple or a shrine.");
    const price = heartPriceAfter(c.MaxHearts);
    if (price === null) throw new ApiError(409, "MostHearts", "You hold as many hearts as anyone can.");
    if (c.Gold < price) throw new ApiError(409, "CannotAfford", `A heart's blessing is ${price} gold.`);
    this.update({ Gold: c.Gold - price, MaxHearts: c.MaxHearts + 1, Hearts: c.Hearts + 1 });
    const now = this.need();
    return { Gold: now.Gold, Hearts: now.Hearts, MaxHearts: now.MaxHearts, Price: now.HeartPrice };
  }

  async openChest(body: { Space: string; Chest: string }): Promise<{ Gold: number; Found: number; Gear?: GearInstance | null }> {
    this.log("openChest", body);
    const c = this.need();
    const key = `${body.Space}|${body.Chest}`;
    if (this.chestsOpened.has(key)) throw new ApiError(409, "Empty", "The chest is empty.");
    this.chestsOpened.add(key);
    const found = 50 + Math.floor(this.random() * 150);
    this.update({ Gold: c.Gold + found });
    return { Gold: this.need().Gold, Found: found };
  }

  async position(body: Place): Promise<{ Hearts: number }> {
    this.log("position", body);
    if (!this.character) return { Hearts: 0 };
    this.update({ Space: body.Space, X: body.X, Z: body.Z });
    // In a town - within its walls, or a building of it (its room's id starts with the town's) - the hearts fill.
    const inTown = body.Space === "world" ? townAt(WORLD.towns, body.X, body.Z) !== null : WORLD.towns.some((t) => body.Space.startsWith(`${t.id}-`));
    if (inTown) this.update({ Hearts: this.need().MaxHearts });
    return { Hearts: this.need().Hearts };
  }

  async setInn(): Promise<{ Inn: string }> {
    this.log("setInn");
    const c = this.need();
    const room = INNS.find((i) => i.interior === c.Space);
    if (!room) throw new ApiError(409, "NotNear", "You are not in an inn.");
    this.inn = room.town;
    this.update({ Inn: room.id });
    return { Inn: room.id };
  }

  /** The traders' schedule, the server's own (travelersAt), on the stand-in clock. */
  async travelers(): Promise<{ Travelers: readonly Traveler[] }> {
    this.log("travelers");
    return { Travelers: travelersAt(this.now() * 1000) };
  }

  async enterDungeon(body: { Dungeon: string }): Promise<Run> {
    this.log("enterDungeon", body);
    const c = this.need();
    const dungeon = DUNGEONS.get(body.Dungeon);
    if (!dungeon) throw new ApiError(404, "NotThere", `No dungeon ${body.Dungeon}.`);
    if (dungeon.requires && ![...dungeon.requires].every((l) => c.Identity.includes(l))) throw new ApiError(409, "Locked", `${dungeon.name} is sealed.`);
    if (c.Space !== "world" || tilesApart([c.X, c.Z], dungeon.entrance) > 1) throw new ApiError(409, "NotNear", `You are not at ${dungeon.name}.`);
    const between = (low: number, high: number) => low + Math.floor(this.random() * (high - low + 1));
    const count = between(dungeon.floors[0], dungeon.floors[1]);
    // A color's dungeon is dealt by where its color stands to the character's (design.md A6), as the server deals it.
    const standing = dealtBy(dungeon, c);
    const gains = standing?.bossStats;
    const floors: RunFloor[] = Array.from({ length: count }, (_, f) => {
      const list = tableOf(dungeon, f, standing, (m) => mobInfo(m).tier);
      return {
        Encounters: Array.from({ length: between(dungeon.encounters[0], dungeon.encounters[1]) }, (_, i) => ({ Index: i, Mob: list[Math.floor(this.random() * list.length)]! })),
        Warden: f < count - 1 ? dungeon.warden : null,
        Boss: f === count - 1 ? dungeon.boss : null,
        Tier: standing?.tier ?? null,
        BossStats: f === count - 1 && gains ? { Life: gains.life, Hand: gains.hand, MaxHand: gains.maxHand } : null,
      };
    });
    // A boss beaten within the week rests: the last floor is without it (design.md A6).
    const won = this.bossWins.get(dungeon.boss);
    const nowMs = this.now() * 1000;
    const resting = mobInfo(dungeon.boss).boss && won !== undefined && won + BOSS_REST_MS > nowMs ? { Boss: dungeon.boss, Until: new Date(won + BOSS_REST_MS).toISOString() } : null;
    if (resting) floors[count - 1] = { ...floors[count - 1]!, Boss: null, BossStats: null };
    const id = `run-${this.nextToken++}`;
    const run: Run = { Run: id, Seed: Math.floor(this.random() * 2 ** 31), Floors: floors, Dungeon: dungeon.id, Floor: 0, Beaten: [], Resting: resting, Tier: standing?.tier ?? dungeon.tier };
    for (const [other, live] of this.runs) if (live.live) this.endRun(other);
    this.runs.set(id, { run, dungeon: dungeon.id, floor: 0, fought: new Set(), live: true });
    this.update({ Space: `run:${id}`, X: 0, Z: 0 });
    return run;
  }

  async currentRun(): Promise<Run | null> {
    this.log("currentRun");
    const c = this.need();
    for (const [id, live] of this.runs) {
      if (live.live && c.Space === `run:${id}`) return { ...live.run, Floor: live.floor, Beaten: [...live.fought].sort() };
    }
    return null;
  }

  async dungeonFloor(body: { Run: string; Floor: number }): Promise<void> {
    this.log("dungeonFloor", body);
    const live = this.runs.get(body.Run);
    if (!live?.live) throw new ApiError(404, "NotThere", "No such run.");
    if (body.Floor !== live.floor + 1 || body.Floor >= live.run.Floors.length) throw new ApiError(409, "NotThere", "There is no stair there.");
    if (live.run.Floors[live.floor]!.Warden && !live.fought.has(`${live.floor}:${live.run.Floors[live.floor]!.Encounters.length}`)) throw new ApiError(409, "WardenStands", "The warden of the floor bars the stair.");
    live.floor = body.Floor;
  }

  async leaveDungeon(body: { Run: string }): Promise<void> {
    this.log("leaveDungeon", body);
    const live = this.runs.get(body.Run);
    if (!live) throw new ApiError(404, "NotThere", "No such run.");
    this.endRun(body.Run);
    const d = DUNGEONS.get(live.dungeon)!;
    const [x, z] = await besideEntrance(d.entrance);
    this.update({ Space: "world", X: x, Z: z });
  }

  /** Ends a run: a game of it lost and not yet answered is over with it, lost. */
  private endRun(id: string): void {
    const live = this.runs.get(id);
    if (live) live.live = false;
    for (const e of this.encounters.values()) if (e.run?.id === id && e.state === "defeated") e.state = "lost";
    if (this.character) this.update({});
  }

  /** Whether a tile is at a tower's waystone, as the server reckons it: beside its entrance, or beside the stone. */
  private async atWaystone(at: readonly [number, number], tower: DungeonData): Promise<boolean> {
    if (tilesApart(at, tower.entrance) <= 1) return true;
    return (await waystoneTiles(tower)).some((w) => tilesApart(at, w) <= 1);
  }

  async waystone(body: { Tower: string }): Promise<{ Place: Place }> {
    this.log("waystone", body);
    const c = this.need();
    let here: DungeonData | undefined;
    for (const d of DUNGEONS.values()) if (!here && d.waystone && c.Space === "world" && (await this.atWaystone([c.X, c.Z], d))) here = d;
    if (!here) throw new ApiError(409, "NotNear", "You are not at a waystone.");
    const there = DUNGEONS.get(body.Tower);
    if (!there?.waystone) throw new ApiError(404, "NotThere", "No such tower.");
    if (!this.attuned.includes(here.id) || !this.attuned.includes(there.id)) throw new ApiError(409, "NotAttuned", "That waystone is not attuned to you.");
    const [x, z] = await besideEntrance(there.entrance);
    const place = { Space: "world", X: x, Z: z };
    this.update(place);
    return { Place: place };
  }

}

/** A mob's seat with what it gains (a boss of a run dealt by standing, design.md A6). */
function gaining(seat: Record<string, unknown>, gains: RunFloor["BossStats"]): Record<string, unknown> {
  if (!gains) return seat;
  const n = (key: string) => Number(seat[key] ?? 0);
  return { ...seat, StartingLife: n("StartingLife") + gains.Life, StartingHandSize: n("StartingHandSize") + gains.Hand, MaximumHandSize: n("MaximumHandSize") + gains.MaxHand };
}
