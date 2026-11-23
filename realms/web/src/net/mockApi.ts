// The realm server's API in memory (?offline): a character, a collection, gold, vendors, an armorer, encounters and
// chests that behave as interfaces.md says the server's do, so the whole overworld can be played and tested with no
// server. Nothing here is the economy - the server owns that - and the cards and gear in it are a small stand-in set.

import type { Body, ManaColor, Slot } from "../character";
import { mobInfo } from "../mobs";
import { mulberry32 } from "../random";
import {
  ApiError,
  type Character,
  type Deck,
  type EncounterResult,
  type EncounterStart,
  type Gear,
  type GearInstance,
  type RealmApi,
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

const gear = (g: Omit<Gear, "effects" | "unique" | "stats"> & { stats?: Partial<Gear["stats"]> }): Gear => ({
  effects: [],
  unique: false,
  ...g,
  stats: { life: 0, hand: 0, maxHand: 0, ...g.stats },
});

/** The stand-in gear: one of each look, so every slot's mesh can be seen. */
export const MOCK_GEAR: readonly Gear[] = [
  gear({ id: "circlet-of-foresight", name: "Circlet of Foresight", slot: "head", rarity: "uncommon", gold: 1200, stats: { maxHand: 1 }, text: "Your maximum hand size is increased by one.", look: { mesh: "circlet", palette: ["#f1b44c", "#5b8fd6"] } }),
  gear({ id: "benalish-helm", name: "Benalish Helm", slot: "head", rarity: "common", gold: 300, stats: { life: 2 }, text: "You start with 2 more life.", look: { mesh: "helm", palette: ["#b3b5bc", "#f4ecc2"] } }),
  gear({ id: "amulet-of-the-wells", name: "Amulet of the Wells", slot: "neck", rarity: "uncommon", gold: 900, text: "Your first spell each game costs 1 less.", look: { mesh: "amulet", palette: ["#f1b44c", "#c8432c"] } }),
  gear({ id: "serran-mail", name: "Serran Mail", slot: "body", rarity: "common", gold: 400, stats: { life: 3 }, text: "You start with 3 more life.", look: { mesh: "armor", palette: ["#d8d6d0", "#f1b44c"] } }),
  gear({ id: "tolarian-robe", name: "Tolarian Robe", slot: "body", rarity: "common", gold: 350, stats: { life: 2 }, text: "You start with 2 more life.", look: { mesh: "robe", palette: ["#5b8fd6", "#f4ecc2"] } }),
  gear({ id: "keldon-gauntlets", name: "Keldon Gauntlets", slot: "hands", rarity: "common", gold: 300, text: "Your first creature each game enters with a +1/+1 counter.", look: { mesh: "gloves", palette: ["#6b4630", "#c8432c"] } }),
  gear({ id: "travellers-boots", name: "Traveller's Boots", slot: "feet", rarity: "common", gold: 250, stats: { life: 1 }, text: "You start with 1 more life.", look: { mesh: "boots", palette: ["#4a3122", "#8f6340"] } }),
  gear({ id: "signet-of-llanowar", name: "Signet of Llanowar", slot: "ring", rarity: "uncommon", gold: 800, text: "Green spells you cast cost 1 less, once each game.", look: { mesh: "ring", palette: ["#3e9a4a", "#f1b44c"] } }),
  gear({ id: "urborg-relic", name: "Urborg Relic", slot: "relic", rarity: "rare", gold: 2400, text: "Once each game: each opponent discards a card.", look: { mesh: "relic", palette: ["#a97fd0", "#4b2f5e"] } }),
];

const START: Record<ManaColor, string> = {
  W: "new-benalia",
  U: "tolarian-academy",
  B: "urborg",
  R: "keld",
  G: "llanowar",
};

interface Encounter {
  readonly token: string;
  readonly mob: string;
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
  private readonly random: () => number;
  private nextToken = 1;
  private nextInstance = 1;
  /** Every call made, by name, for tests to see (realmTest.api). */
  readonly calls: { name: string; body?: unknown }[] = [];
  /** What the clock says, in unix seconds (tests may pin it). */
  now: () => number = () => Date.now() / 1000;

  constructor(seed = 1, character?: { name: string; body: Body; palette: number; color: ManaColor }) {
    this.random = mulberry32(seed);
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
    const kit = ["benalish-helm", "tolarian-robe", "travellers-boots"].map((id) => MOCK_GEAR.find((g) => g.id === id)!);
    const owned: GearInstance[] = kit.map((g) => ({ InstanceId: `g${this.nextInstance++}`, Gear: g }));
    const inn = START[color];
    this.character = {
      Id: "offline-player",
      Name: name,
      Body: body,
      Palette: palette,
      Identity: [color],
      Gold: 2000,
      AnteValue: 0,
      Map: inn,
      Q: 0,
      R: 0,
      Stats: { Life: 20 + 2 + 2 + 1, Hand: 7, MaxHand: 7 },
      Loadout: { head: kit[0], body: kit[1], feet: kit[2] },
      Gear: owned,
      Unlocked: [color],
    };
    const own = CARDS.filter((c) => c.Color === color || c.Color === "C");
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

  async collection(): Promise<{ Cards: Record<string, number> }> {
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

  async saveLoadout(slots: Partial<Record<Slot, string | null>>): Promise<Character> {
    this.log("saveLoadout", slots);
    const c = this.need();
    const loadout: Partial<Record<Slot, Gear>> = { ...c.Loadout };
    for (const [slot, id] of Object.entries(slots) as [Slot, string | null][]) {
      if (id === null) delete loadout[slot];
      else {
        const owned = c.Gear.find((g) => g.InstanceId === id);
        if (!owned) throw new ApiError(422, "IllegalLoadout", `No gear ${id}.`);
        loadout[slot] = owned.Gear;
      }
    }
    return this.update({ Loadout: loadout });
  }

  async vendor(id: string): Promise<VendorView> {
    this.log("vendor", { id });
    const pick = mulberry32(id.length * 7919 + id.charCodeAt(0));
    const stock = CARDS.filter(() => pick() < 0.4).map((c) => ({ Name: c.Name, Gold: c.Gold, Count: 1 + Math.floor(pick() * 3), Until: null }));
    return { Vendor: { id, name: id, town: "" }, Purse: 50000, Stock: stock };
  }

  async buy(vendor: string, name: string): Promise<{ Gold: number; Collection: Record<string, number> }> {
    this.log("buy", { vendor, name });
    const c = this.need();
    const card = CARDS.find((k) => k.Name === name);
    if (!card) throw new ApiError(409, "SoldOut", `${name} is sold out.`);
    if (c.Gold < card.Gold) throw new ApiError(409, "CannotAfford", `${name} costs ${card.Gold} gold.`);
    this.cards[name] = (this.cards[name] ?? 0) + 1;
    this.update({ Gold: c.Gold - card.Gold });
    return { Gold: this.need().Gold, Collection: { ...this.cards } };
  }

  async sell(vendor: string, name: string): Promise<{ Gold: number; Collection: Record<string, number> }> {
    this.log("sell", { vendor, name });
    const c = this.need();
    const card = CARDS.find((k) => k.Name === name);
    if (!card || !this.cards[name]) throw new ApiError(409, "NotTheirTrade", `${vendor} doesn't deal in ${name}.`);
    this.cards[name]! -= 1;
    this.update({ Gold: c.Gold + Math.floor(card.Gold / 2) });
    return { Gold: this.need().Gold, Collection: { ...this.cards } };
  }

  async armorer(town: string): Promise<{ Stock: readonly Gear[] }> {
    this.log("armorer", { town });
    return { Stock: MOCK_GEAR };
  }

  async startEncounter(body: { Map: string; Spawn: string; Mob: string }): Promise<EncounterStart> {
    this.log("startEncounter", body);
    const c = this.need();
    const open = [...this.encounters.values()].find((e) => !e.result);
    if (open) {
      // A duel never finished counts as lost when the next encounter starts (design.md, A3).
      open.outcome = "lost";
      await this.finishEncounter({ Token: open.token, Log: [] });
    }
    const mob = mobInfo(body.Mob);
    const token = `duel-${this.nextToken++}`;
    const cap = Math.min(c.AnteValue, mob.prize);
    this.encounters.set(token, { token, mob: body.Mob, cap, looted: false });
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
      encounter.result = { Outcome: "won", Gold: gold, Offer: offer.map((k) => ({ Name: k.Name, Gold: k.Gold })), Cap: encounter.cap };
      this.update({ Gold: c.Gold + gold });
    } else {
      // A random ante card is lost.
      const ante = this.deck.Ante.flatMap((a) => Array.from({ length: a.Count }, () => a.Name));
      const lost = ante[Math.floor(this.random() * ante.length)];
      if (lost) {
        this.deck = { ...this.deck, Ante: this.deck.Ante.map((a) => (a.Name === lost ? { ...a, Count: a.Count - 1 } : a)).filter((a) => a.Count > 0) };
        this.cards[lost] = Math.max(0, (this.cards[lost] ?? 1) - 1);
      }
      encounter.result = { Outcome: "lost", Gold: 0, Offer: [], Cap: encounter.cap };
      this.update({});
    }
    return encounter.result;
  }

  async takeLoot(body: { Token: string; Picks: readonly string[] }): Promise<{ Collection: Record<string, number> }> {
    this.log("takeLoot", body);
    const encounter = this.encounters.get(body.Token);
    if (!encounter?.result || encounter.result.Outcome !== "won" || encounter.looted) throw new ApiError(409, "NoLoot", "Nothing to take.");
    const offered = encounter.result.Offer;
    const total = body.Picks.reduce((sum, name) => sum + (offered.find((o) => o.Name === name)?.Gold ?? Infinity), 0);
    if (total > encounter.cap) throw new ApiError(422, "OverCap", `The picks are worth ${total}, over the cap of ${encounter.cap}.`);
    for (const name of body.Picks) this.cards[name] = (this.cards[name] ?? 0) + 1;
    encounter.looted = true;
    return { Collection: { ...this.cards } };
  }

  async openChest(body: { Map: string; Chest: string }): Promise<{ Gold: number }> {
    this.log("openChest", body);
    const c = this.need();
    const key = `${body.Map}|${body.Chest}`;
    if (this.chestsOpened.has(key)) throw new ApiError(409, "Empty", "The chest is empty.");
    this.chestsOpened.add(key);
    const gold = 50 + Math.floor(this.random() * 150);
    this.update({ Gold: c.Gold + gold });
    return { Gold: gold };
  }

  async travel(body: { Map: string; Q: number; R: number }): Promise<void> {
    this.log("travel", body);
    if (this.character) this.update({ Map: body.Map, Q: body.Q, R: body.R });
  }
}
