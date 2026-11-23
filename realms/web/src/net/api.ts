// The realm server's API as the overworld calls it (realms/docs/interfaces.md, "The realm server's API"): its
// shapes, PascalCase as on the wire, and an HTTP client. `MockApi` (mockApi.ts) is the same API in memory, for
// playing and testing the overworld with no server (?offline).

import type { Body, ManaColor, Slot } from "../character";

export type GearSlot = "head" | "neck" | "body" | "hands" | "feet" | "ring" | "relic";
export type Rarity = "common" | "uncommon" | "rare" | "mythic";

/** A gear item's definition (`realms/content/gear/<id>.json`), as the server sends it: camelCase, as in the file. */
export interface Gear {
  readonly id: string;
  readonly name: string;
  readonly slot: GearSlot;
  readonly rarity: Rarity;
  readonly gold: number;
  readonly stats: { readonly life: number; readonly hand: number; readonly maxHand: number };
  readonly effects: readonly Record<string, unknown>[];
  readonly text: string;
  readonly look: { readonly mesh: string; readonly palette: readonly string[] };
  readonly unique: boolean;
}

/** A gear item a player owns: one of possibly several copies. */
export interface GearInstance {
  readonly InstanceId: string;
  readonly Gear: Gear;
}

export interface Character {
  /** The player id the spawn algorithm hashes: `discord-<id>`. */
  readonly Id: string;
  readonly Name: string;
  readonly Body: Body;
  /** Which of the six skin and hair palettes, 0-5. */
  readonly Palette: number;
  readonly Identity: readonly ManaColor[];
  readonly Gold: number;
  /** The total list price of the cards in the ante (design.md, A2). */
  readonly AnteValue: number;
  readonly Map: string;
  readonly Q: number;
  readonly R: number;
  readonly Stats: { readonly Life: number; readonly Hand: number; readonly MaxHand: number };
  readonly Loadout: Partial<Record<Slot, Gear>>;
  readonly Gear: readonly GearInstance[];
  readonly Unlocked: readonly ManaColor[];
}

export interface CardCount {
  readonly Name: string;
  readonly Count: number;
}

export interface Deck {
  readonly Main: readonly CardCount[];
  readonly Ante: readonly CardCount[];
}

export interface VendorView {
  readonly Vendor: { readonly id: string; readonly name: string; readonly town: string };
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
  readonly Offer: readonly { readonly Name: string; readonly Gold: number }[];
  readonly Cap: number;
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
  collection(): Promise<{ Cards: Record<string, number> }>;
  saveDeck(deck: Deck): Promise<Deck>;
  saveLoadout(slots: Partial<Record<Slot, string | null>>): Promise<Character>;
  vendor(id: string): Promise<VendorView>;
  buy(vendor: string, name: string): Promise<{ Gold: number; Collection: Record<string, number> }>;
  sell(vendor: string, name: string): Promise<{ Gold: number; Collection: Record<string, number> }>;
  armorer(town: string): Promise<{ Stock: readonly Gear[] }>;
  startEncounter(body: { Map: string; Spawn: string; Mob: string }): Promise<EncounterStart>;
  finishEncounter(body: { Token: string; Log: readonly string[] }): Promise<EncounterResult>;
  takeLoot(body: { Token: string; Picks: readonly string[] }): Promise<{ Collection: Record<string, number> }>;
  openChest(body: { Map: string; Chest: string }): Promise<{ Gold: number }>;
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
  collection = () => this.call<{ Cards: Record<string, number> }>("GET", "collection");
  saveDeck = (deck: Deck) => this.call<Deck>("PUT", "deck", deck);
  saveLoadout = (slots: Partial<Record<Slot, string | null>>) => this.call<Character>("PUT", "loadout", { Slots: slots });
  vendor = (id: string) => this.call<VendorView>("GET", `vendor/${encodeURIComponent(id)}`);
  buy = (vendor: string, name: string) => this.call<{ Gold: number; Collection: Record<string, number> }>("POST", `vendor/${encodeURIComponent(vendor)}/buy`, { Name: name });
  sell = (vendor: string, name: string) => this.call<{ Gold: number; Collection: Record<string, number> }>("POST", `vendor/${encodeURIComponent(vendor)}/sell`, { Name: name });
  armorer = (town: string) => this.call<{ Stock: readonly Gear[] }>("GET", `armorer/${encodeURIComponent(town)}`);
  startEncounter = (body: { Map: string; Spawn: string; Mob: string }) => this.call<EncounterStart>("POST", "encounter/start", body);
  finishEncounter = (body: { Token: string; Log: readonly string[] }) => this.call<EncounterResult>("POST", "encounter/finish", body);
  takeLoot = (body: { Token: string; Picks: readonly string[] }) => this.call<{ Collection: Record<string, number> }>("POST", "encounter/loot", body);
  openChest = (body: { Map: string; Chest: string }) => this.call<{ Gold: number }>("POST", "chest/open", body);
  travel = async (body: { Map: string; Q: number; R: number }) => {
    await this.call<unknown>("POST", "travel", body);
  };
}
