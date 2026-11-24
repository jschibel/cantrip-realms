// The realm server's API as the overworld calls it (realms/docs/interfaces.md, "The realm server's API"): its
// shapes, PascalCase as on the wire, and an HTTP client. `MockApi` (mockApi.ts) is the same API in memory, for
// playing and testing the overworld with no server (?offline).

import type { BodyName as Body, ManaColor, Slot } from "../art/figures";

export type GearSlot = "head" | "neck" | "body" | "hands" | "feet" | "ring" | "relic";
export type Rarity = "common" | "uncommon" | "rare" | "mythic";

/** A gear item (`realms/content/gear/<id>.json`) as the server sends it: its content file, PascalCase, with its emblem. */
export interface Gear {
  readonly Id: string;
  readonly Name: string;
  readonly Slot: GearSlot;
  readonly Rarity: Rarity;
  readonly Gold: number;
  readonly Stats: { readonly Life: number; readonly Hand: number; readonly MaxHand: number };
  /** The item's abilities, as its file has them (camelCase): the gear crate's to read. */
  readonly Effects: readonly Record<string, unknown>[];
  readonly Text: string;
  /** How it shows on a character: a gear part of art/figures/gear.ts and its palette. */
  readonly Look: { readonly Mesh: string; readonly Palette: readonly string[] };
  readonly Unique: boolean;
  /** The engine's emblem for the item, `"<name> (gear)"`, or null for an item with no effects. */
  readonly Emblem: string | null;
  /** What it costs of its rarity's budget, and that budget (gear.md, "Budgets"). */
  readonly Points?: number;
  readonly Budget?: number;
}

/** A gear item a player owns: one of possibly several copies. */
export interface GearInstance {
  readonly InstanceId: number;
  readonly Gear: Gear;
}

export interface Character {
  /** The player id the spawn algorithm hashes: `discord-<id>`, `dev-<id>`. */
  readonly Id: string;
  readonly Name: string;
  readonly Body: Body;
  /** Which of the six skin and hair palettes, 0-5. */
  readonly Palette: number;
  /** The starting color and the unlocked ones, as letters in WUBRG order: "WU". */
  readonly Identity: string;
  readonly Gold: number;
  /** The total list price of the cards in the ante (design.md, A2). */
  readonly AnteValue: number;
  /** The space of the character's place (interfaces.md, "Places"): "world", an interior's id, or "run:<run>". */
  readonly Space: string;
  /** The tile the character stands on in its space (x east, z south). */
  readonly X: number;
  readonly Z: number;
  readonly Stats: { readonly Life: number; readonly Hand: number; readonly MaxHand: number };
  /** What each of the eight slots holds, null when empty. */
  readonly Loadout: Readonly<Partial<Record<Slot, GearInstance | null>>>;
  readonly Gear: readonly GearInstance[];
  readonly Unlocked: readonly ManaColor[];
  /** The mage towers whose waystones are attuned to the character (design.md A6). */
  readonly Attuned?: readonly string[];
  /** The character's home inn (world.json's `inns[].id`). */
  readonly Inn?: string;
}

/** A character's identity as colors, in WUBRG order. */
export const identityOf = (c: { readonly Identity: string }): ManaColor[] =>
  [...c.Identity].filter((l): l is ManaColor => "WUBRG".includes(l));

export interface CardCount {
  readonly Name: string;
  readonly Count: number;
}

export interface Deck {
  readonly Main: readonly CardCount[];
  readonly Ante: readonly CardCount[];
  /** What the ante is worth, as the server reckons it (it ignores this when a deck is saved). */
  readonly AnteValue?: number;
}

/** A collection: copies owned, by card name. */
export interface Collection {
  readonly Cards: Readonly<Record<string, number>>;
}

/** What a vendor deals in: any of the filters, all that are given holding (interfaces.md, "Vendors"). */
export interface Specialty {
  readonly Pool?: string | null;
  readonly Colors?: string | null;
  readonly Types?: readonly string[];
  readonly Subtypes?: readonly string[];
  readonly Rarities?: readonly string[];
  readonly Names?: readonly string[];
}

export interface VendorView {
  /** `Kind` is `shop`, `exotic` or `trader`; `Plane` a trader's home plane (else null); `Town` a trader's caravan's town now. */
  readonly Vendor: { readonly Id: string; readonly Name: string; readonly Town: string; readonly Specialty: Specialty; readonly Kind: "shop" | "exotic" | "trader"; readonly Plane: string | null };
  readonly Purse: number;
  readonly Stock: readonly { readonly Name: string; readonly Gold: number; readonly Count: number; readonly Until: string | null }[];
  /** The character's gold. */
  readonly Gold: number;
  /** The character's cards the vendor deals in: what it pays for one, how many they own, how many are in neither deck nor ante. */
  readonly Buying: readonly { readonly Name: string; readonly Gold: number; readonly Owned: number; readonly Spare: number }[];
}

/** Everything the browser deals a duel from. */
export interface DuelSpec {
  readonly Seats: readonly Record<string, unknown>[];
  readonly MinimumDeckSize: number;
  readonly Seed: number;
  readonly Mob: { readonly Name: string; readonly Tier: number; readonly Prize: number };
  readonly AnteValue: number;
  readonly Cap: number;
}

export interface EncounterStart {
  readonly Token: string;
  readonly Seed: number;
  readonly Duel: DuelSpec;
}

export interface EncounterResult {
  readonly Outcome: "won" | "lost";
  readonly Gold: number;
  /** Up to three cards, each with its list price, each within the cap alone. */
  readonly Offer: readonly { readonly Name: string; readonly Gold: number }[];
  readonly Cap: number;
  /** The gear item a win dropped, if one did. */
  readonly Gear: GearInstance | null;
  /** The relics a boss win dropped (design.md A3a), already in the collection; empty for most wins and every loss. */
  readonly Relics: readonly string[];
  /** Why a duel counted as lost without being played out. */
  readonly Detail: string | null;
  /** The ante card a loss cost, if the ante held one. */
  readonly Lost?: string | null;
}

/** A place (interfaces.md, "Places"). */
export interface Place {
  readonly Space: string;
  readonly X: number;
  readonly Z: number;
}

/** A dungeon run's floor: its encounters, its warden and boss (null where it has none). */
export interface RunFloor {
  readonly Encounters: readonly { readonly Index: number; readonly Mob: string }[];
  readonly Warden: string | null;
  readonly Boss: string | null;
}

export interface Run {
  readonly Run: string;
  readonly Seed: number;
  readonly Floors: readonly RunFloor[];
}

/** An encounter's start: a world spawn's mob, or one of a dungeon run's. */
export type EncounterAt =
  | { readonly Spawn: string; readonly Mob: string }
  | { readonly Run: string; readonly Floor: number; readonly Index: number; readonly Mob: string };

/** A caravan's visit to a town: which town, and from when until when (UTC ISO-8601). */
export interface CaravanVisit {
  readonly Town: string;
  readonly From: string;
  readonly Until: string;
}

/**
 * A traveling trader from another plane (design.md A5) and its schedule, as `GET /api/travelers` gives it: its vendor
 * id (its `vendor` screen), its name, its plane's id and name, the visit its caravan is on now (null between visits) and
 * the next to begin.
 */
export interface Traveler {
  readonly Id: string;
  readonly Name: string;
  readonly Plane: string;
  readonly PlaneName: string;
  readonly Visit: CaravanVisit | null;
  readonly Next: CaravanVisit;
}

/** The trader whose caravan is in a town at a moment (Unix milliseconds), if any. */
export function travelerIn(travelers: readonly Traveler[], town: string, nowMs: number): Traveler | undefined {
  return travelers.find((t) => t.Visit !== null && t.Visit.Town === town && Date.parse(t.Visit.From) <= nowMs && nowMs < Date.parse(t.Visit.Until));
}

/** A refused call: the server's error code and its words. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

export interface RealmApi {
  /** Whether this is the in-memory stand-in (?offline). */
  readonly offline: boolean;
  me(): Promise<Character | null>;
  createCharacter(body: { Name: string; Body: Body; Palette: number; Color: ManaColor }): Promise<Character>;
  collection(): Promise<Collection>;
  saveDeck(deck: Deck): Promise<Deck>;
  saveLoadout(slots: Partial<Record<Slot, number | null>>): Promise<Character>;
  vendor(id: string): Promise<VendorView>;
  buy(vendor: string, name: string): Promise<{ Gold: number; Collection: Collection }>;
  sell(vendor: string, name: string): Promise<{ Gold: number; Collection: Collection }>;
  armorer(town: string): Promise<{ Stock: readonly Gear[] }>;
  startEncounter(body: EncounterAt): Promise<EncounterStart>;
  finishEncounter(body: { Token: string; Log: readonly string[] }): Promise<EncounterResult>;
  /** Takes picks from a win's offer: the collection after. */
  takeLoot(body: { Token: string; Picks: readonly string[] }): Promise<Collection>;
  /** Opens a chest: the character's gold after, and what the chest held. */
  openChest(body: { Space: string; Chest: string }): Promise<{ Gold: number; Found: number; Gear?: GearInstance | null }>;
  /** Makes the inn the character stands in their home: where a lost duel wakes them. */
  setInn(): Promise<{ Inn: string }>;
  /** Reports where the character is (a world or interior place). */
  position(body: Place): Promise<void>;
  enterDungeon(body: { Dungeon: string }): Promise<Run>;
  /** Takes the stair down to floor `Floor` (from 0) of the run. */
  dungeonFloor(body: { Run: string; Floor: number }): Promise<void>;
  leaveDungeon(body: { Run: string }): Promise<void>;
  /** Travels from the attuned tower's waystone the character stands at to another attuned tower's. */
  waystone(body: { Tower: string }): Promise<{ Place: Place }>;
  /** The traveling vendors in town now, by the server's schedule. */
  travelers(): Promise<{ Travelers: readonly Traveler[] }>;
}

/** The realm server over HTTP: same-origin `/api`, or the server `base` names, on the signed-in cookie. */
export class HttpApi implements RealmApi {
  readonly offline = false;

  constructor(private readonly base: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(`api/${path}`, this.base), {
      method,
      credentials: "include",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const json: unknown = text.length > 0 ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = json as { Error?: string; Detail?: string };
      throw new ApiError(response.status, error.Error ?? `Http${response.status}`, error.Detail ?? response.statusText);
    }
    return json as T;
  }

  async me(): Promise<Character | null> {
    try {
      return await this.call<Character>("GET", "me");
    } catch (e) {
      if (e instanceof ApiError && e.code === "NoCharacter") return null;
      throw e;
    }
  }

  createCharacter = (body: { Name: string; Body: Body; Palette: number; Color: ManaColor }) => this.call<Character>("POST", "character", body);
  collection = () => this.call<Collection>("GET", "collection");
  saveDeck = (deck: Deck) => this.call<Deck>("PUT", "deck", { Main: deck.Main, Ante: deck.Ante });
  saveLoadout = (slots: Partial<Record<Slot, number | null>>) => this.call<Character>("PUT", "loadout", { Slots: slots });
  vendor = (id: string) => this.call<VendorView>("GET", `vendor/${encodeURIComponent(id)}`);
  buy = (vendor: string, name: string) => this.call<{ Gold: number; Collection: Collection }>("POST", `vendor/${encodeURIComponent(vendor)}/buy`, { Name: name });
  sell = (vendor: string, name: string) => this.call<{ Gold: number; Collection: Collection }>("POST", `vendor/${encodeURIComponent(vendor)}/sell`, { Name: name });
  armorer = (town: string) => this.call<{ Stock: readonly Gear[] }>("GET", `armorer/${encodeURIComponent(town)}`);
  startEncounter = (body: EncounterAt) => this.call<EncounterStart>("POST", "encounter/start", body);
  finishEncounter = (body: { Token: string; Log: readonly string[] }) => this.call<EncounterResult>("POST", "encounter/finish", body);
  takeLoot = (body: { Token: string; Picks: readonly string[] }) => this.call<Collection>("POST", "encounter/loot", body);
  openChest = (body: { Space: string; Chest: string }) => this.call<{ Gold: number; Found: number; Gear?: GearInstance | null }>("POST", "chest/open", body);
  setInn = () => this.call<{ Inn: string }>("POST", "inn", {});
  position = async (body: Place) => {
    await this.call<unknown>("POST", "position", body);
  };
  enterDungeon = (body: { Dungeon: string }) => this.call<Run>("POST", "dungeon/enter", body);
  dungeonFloor = async (body: { Run: string; Floor: number }) => {
    await this.call<unknown>("POST", "dungeon/floor", body);
  };
  leaveDungeon = async (body: { Run: string }) => {
    await this.call<unknown>("POST", "dungeon/leave", body);
  };
  waystone = (body: { Tower: string }) => this.call<{ Place: Place }>("POST", "waystone", body);
  travelers = () => this.call<{ Travelers: readonly Traveler[] }>("GET", "travelers");
}
