// The realm server's API as the overworld calls it (realms/docs/interfaces.md, "The realm server's API"): its
// shapes, PascalCase as on the wire, and an HTTP client. `MockApi` (mockApi.ts) is the same API in memory, for
// playing and testing the overworld with no server (?offline).

import type { Body, ManaColor, Slot } from "../character";

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
  /** How it shows on a character: a gear mesh of realms/content/models and its palette. */
  readonly Look: { readonly Mesh: string; readonly Palette: readonly string[] };
  readonly Unique: boolean;
  /** The engine's emblem for the item, `"<name> (gear)"`, or null for an item with no effects. */
  readonly Emblem: string | null;
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
  readonly Map: string;
  readonly Q: number;
  readonly R: number;
  readonly Stats: { readonly Life: number; readonly Hand: number; readonly MaxHand: number };
  /** What each of the eight slots holds, null when empty. */
  readonly Loadout: Readonly<Partial<Record<Slot, GearInstance | null>>>;
  readonly Gear: readonly GearInstance[];
  readonly Unlocked: readonly ManaColor[];
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
  readonly Vendor: { readonly Id: string; readonly Name: string; readonly Town: string; readonly Specialty: Specialty };
  readonly Purse: number;
  readonly Stock: readonly { readonly Name: string; readonly Gold: number; readonly Count: number; readonly Until: string | null }[];
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
  /** Why a duel counted as lost without being played out. */
  readonly Detail: string | null;
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
  startEncounter(body: { Map: string; Spawn: string; Mob: string }): Promise<EncounterStart>;
  finishEncounter(body: { Token: string; Log: readonly string[] }): Promise<EncounterResult>;
  /** Takes picks from a win's offer: the collection after. */
  takeLoot(body: { Token: string; Picks: readonly string[] }): Promise<Collection>;
  /** Opens a chest: the character's gold after, and what the chest held. */
  openChest(body: { Map: string; Chest: string }): Promise<{ Gold: number; Found: number }>;
  travel(body: { Map: string; Q: number; R: number }): Promise<void>;
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
  startEncounter = (body: { Map: string; Spawn: string; Mob: string }) => this.call<EncounterStart>("POST", "encounter/start", body);
  finishEncounter = (body: { Token: string; Log: readonly string[] }) => this.call<EncounterResult>("POST", "encounter/finish", body);
  takeLoot = (body: { Token: string; Picks: readonly string[] }) => this.call<Collection>("POST", "encounter/loot", body);
  openChest = (body: { Map: string; Chest: string }) => this.call<{ Gold: number; Found: number }>("POST", "chest/open", body);
  travel = async (body: { Map: string; Q: number; R: number }) => {
    await this.call<unknown>("POST", "travel", body);
  };
}
