// The realm server's API in memory (?offline): a character, a collection, gold, vendors, an armorer, encounters and
// chests that behave as interfaces.md says the server's do, so the whole overworld can be played and tested with no
// server. Nothing here is the economy - the server owns that - and the cards and gear in it are a small stand-in set.

import type { BodyName as Body, ManaColor, Slot } from "../art/figures";
import { mobInfo } from "../mobs";
import { mulberry32 } from "../random";
import { DUNGEONS, PLANE_NAMES, VENDORS, type VendorFile, WORLD, besideEntrance, innOf, startTown, tilesApart, waystoneTiles } from "../world/realm";
import type { DungeonData } from "../world/format";

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
  type Collection,
  type Deck,
  type EncounterAt,
  type EncounterResult,
  type EncounterStart,
  type Gear,
  type GearInstance,
  type Place,
  type RealmApi,
  type Run,
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


interface Encounter {
  readonly token: string;
  readonly mob: string;
  /** A dungeon run's encounter: its run, floor and index. */
  readonly run?: { readonly id: string; readonly floor: number; readonly index: number };
  readonly cap: number;
  outcome?: "won" | "lost";
  result?: EncounterResult;
  looted: boolean;
}

export class MockApi implements RealmApi {
  readonly offline = true;
  private character: Character | null = null;
  private cards: Record<string, number> = {};
  private deck: Deck = { Main: [], Ante: [] };
  private readonly encounters = new Map<string, Encounter>();
  private readonly chestsOpened = new Set<string>();
  private readonly runs = new Map<string, { run: Run; dungeon: string; floor: number; fought: Set<string>; live: boolean }>();
  private attuned: string[];
  /** The town whose inn the character set as home. */
  private inn: string | null = null;
  private readonly random: () => number;
  private nextToken = 1;
  private nextInstance = 1;
  /** Every call made, by name, for tests to see (realmTest.api). */
  readonly calls: { name: string; body?: unknown }[] = [];
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

  private anteValue(): number {
    return this.deck.Ante.reduce((sum, c) => sum + (CARDS.find((k) => k.Name === c.Name)?.Gold ?? 0) * c.Count, 0);
  }

  private update(patch: Partial<Character>): Character {
    this.character = { ...this.need(), ...patch };
    this.character = { ...this.character, AnteValue: this.anteValue() };
    return this.character;
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
      AnteValue: 0,
      Space: "world",
      X: inn.x,
      Z: inn.z,
      Stats: { Life: 20 + 3 + 2, Hand: 7, MaxHand: 7 + 1 },
      Loadout: { head: owned[0], neck: null, body: owned[1], hands: null, feet: owned[2], ring1: null, ring2: null, relic: null },
      Gear: owned,
      Unlocked: colors,
      Attuned: [...this.attuned],
    };
    const own = CARDS.filter((c) => colors.includes(c.Color as ManaColor) || c.Color === "C");
    this.cards = Object.fromEntries(own.map((c) => [c.Name, 4]));
    this.deck = { Main: own.map((c) => ({ Name: c.Name, Count: 3 })), Ante: own.slice(0, 2).map((c) => ({ Name: c.Name, Count: 1 })) };
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
    const used = (name: string) => [...this.deck.Main, ...this.deck.Ante].filter((c) => c.Name === name).reduce((n, c) => n + c.Count, 0);
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
    const open = [...this.encounters.values()].find((e) => !e.result);
    if (open) {
      // A duel never finished counts as lost when the next encounter starts (design.md, A3).
      open.outcome = "lost";
      await this.finishEncounter({ Token: open.token, Log: [] });
    }
    let run: Encounter["run"];
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
    }
    const mob = mobInfo(body.Mob);
    const token = `duel-${this.nextToken++}`;
    const cap = Math.min(c.AnteValue, mob.prize);
    this.encounters.set(token, { token, mob: body.Mob, cap, looted: false, ...(run ? { run } : {}) });
    const seed = Math.floor(this.random() * 2 ** 31);
    return {
      Token: token,
      Seed: seed,
      Duel: {
        Seats: [
          { Name: c.Name, StartingLife: c.Stats.Life, StartingHandSize: c.Stats.Hand, MaximumHandSize: c.Stats.MaxHand, Deck: this.deck.Main, Emblems: [] },
          { Name: mob.name, StartingLife: 20, StartingHandSize: 7, MaximumHandSize: 7, Deck: [], Emblems: [] },
        ],
        MinimumDeckSize: 40,
        Seed: seed,
        Mob: { Name: mob.name, Tier: mob.tier, Prize: mob.prize },
        AnteValue: c.AnteValue,
        Cap: cap,
      },
    };
  }

  /**
   * The stand-in for the server's replay of the duel's log: the mock is told how the duel ended, since it plays no
   * engine. The overworld tells it before finishing, when the card layer says.
   */
  settle(token: string, outcome: "won" | "lost"): void {
    const encounter = this.encounters.get(token);
    if (encounter && !encounter.result) encounter.outcome = outcome;
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
      const fits = CARDS.filter((k) => k.Gold <= encounter.cap);
      const offer = encounter.cap > 0 && fits.length > 0 ? [fits[Math.floor(this.random() * fits.length)]!, ...[0, 1].map(() => CARDS[Math.floor(this.random() * CARDS.length)]!)] : [];
      encounter.result = { Outcome: "won", Gold: gold, Offer: offer.map((k) => ({ Name: k.Name, Gold: k.Gold })), Cap: encounter.cap, Gear: null, Relics: [], Detail: null };
      this.update({ Gold: c.Gold + gold });
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
    } else {
      // A random ante card is lost.
      const ante = this.deck.Ante.flatMap((a) => Array.from({ length: a.Count }, () => a.Name));
      const lost = ante[Math.floor(this.random() * ante.length)];
      if (lost) {
        this.deck = { ...this.deck, Ante: this.deck.Ante.map((a) => (a.Name === lost ? { ...a, Count: a.Count - 1 } : a)).filter((a) => a.Count > 0) };
        this.cards[lost] = Math.max(0, (this.cards[lost] ?? 1) - 1);
      }
      encounter.result = { Outcome: "lost", Gold: 0, Offer: [], Cap: encounter.cap, Gear: null, Relics: [], Detail: null };
      // A lost duel ends any run, and the character wakes at the inn of their home town.
      if (encounter.run) this.runs.get(encounter.run.id)!.live = false;
      const inn = innOf(this.inn ?? startTown().id);
      this.update({ Space: "world", X: inn.x, Z: inn.z });
    }
    return encounter.result;
  }

  async takeLoot(body: { Token: string; Picks: readonly string[] }): Promise<Collection> {
    this.log("takeLoot", body);
    const encounter = this.encounters.get(body.Token);
    if (!encounter?.result || encounter.result.Outcome !== "won" || encounter.looted) throw new ApiError(409, "NoLoot", "Nothing to take.");
    const offered = encounter.result.Offer;
    const total = body.Picks.reduce((sum, name) => sum + (offered.find((o) => o.Name === name)?.Gold ?? Infinity), 0);
    if (total > encounter.cap) throw new ApiError(422, "OverCap", `The picks are worth ${total}, over the cap of ${encounter.cap}.`);
    for (const name of body.Picks) this.cards[name] = (this.cards[name] ?? 0) + 1;
    encounter.looted = true;
    return { Cards: { ...this.cards } };
  }

  async openChest(body: { Space: string; Chest: string }): Promise<{ Gold: number; Found: number }> {
    this.log("openChest", body);
    const c = this.need();
    const key = `${body.Space}|${body.Chest}`;
    if (this.chestsOpened.has(key)) throw new ApiError(409, "Empty", "The chest is empty.");
    this.chestsOpened.add(key);
    const found = 50 + Math.floor(this.random() * 150);
    this.update({ Gold: c.Gold + found });
    return { Gold: this.need().Gold, Found: found };
  }

  async position(body: Place): Promise<void> {
    this.log("position", body);
    if (this.character) this.update({ Space: body.Space, X: body.X, Z: body.Z });
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
    const lists = Array.isArray(dungeon.mobs[0]) ? (dungeon.mobs as string[][]) : [dungeon.mobs as string[]];
    const floors = Array.from({ length: count }, (_, f) => {
      const list = lists[Math.min(f, lists.length - 1)]!;
      return {
        Encounters: Array.from({ length: between(dungeon.encounters[0], dungeon.encounters[1]) }, (_, i) => ({ Index: i, Mob: list[Math.floor(this.random() * list.length)]! })),
        Warden: f < count - 1 ? dungeon.warden : null,
        Boss: f === count - 1 ? dungeon.boss : null,
      };
    });
    const id = `run-${this.nextToken++}`;
    const run: Run = { Run: id, Seed: Math.floor(this.random() * 2 ** 31), Floors: floors };
    for (const other of this.runs.values()) other.live = false;
    this.runs.set(id, { run, dungeon: dungeon.id, floor: 0, fought: new Set(), live: true });
    this.update({ Space: `run:${id}`, X: 0, Z: 0 });
    return run;
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
    live.live = false;
    const d = DUNGEONS.get(live.dungeon)!;
    const [x, z] = await besideEntrance(d.entrance);
    this.update({ Space: "world", X: x, Z: z });
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
