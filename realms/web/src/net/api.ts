// The realm server's API as the overworld calls it (realms/docs/interfaces.md, "The realm server's API"): its
// shapes, PascalCase as on the wire, and an HTTP client. `MockApi` (mockApi.ts) is the same API in memory, for
// playing and testing the overworld with no server (?offline).

import type { BodyName as Body, ManaColor, Slot } from "../art/figures";
import { noteCall } from "../reports/logs";

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
  /** The hearts the character has, and holds (design.md A3b): a lost game takes one; a town fills them. */
  readonly Hearts: number;
  readonly MaxHearts: number;
  /** What a healer asks for one more heart; null at the most. */
  readonly HeartPrice: number | null;
  /** A lost game the character has still to answer - pay or fight again - which a reload comes back to; null with none. */
  readonly Defeat: Defeat | null;
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

/**
 * A find standing in the world's wilds (`GET /api/finds`; design.md A5, A3b): a treasure chest or a heartbloom, which the
 * server spawns and nobody keeps - its id, kind and tile, and when it goes if nobody takes it (UTC ISO-8601).
 */
export interface Find {
  readonly Id: string;
  readonly Kind: "chest" | "heartbloom";
  readonly X: number;
  readonly Z: number;
  readonly Until: string;
}

/** What a find held: a chest's gold and gear, or (`Heart`) a heartbloom's heart; the character's gold and hearts after. */
export interface ChestFound {
  readonly Gold: number;
  readonly Found: number;
  readonly Gear?: GearInstance | null;
  readonly Hearts: number;
  readonly Heart?: boolean;
}

/** A character's identity as colors, in WUBRG order. */
export const identityOf = (c: { readonly Identity: string }): ManaColor[] =>
  [...c.Identity].filter((l): l is ManaColor => "WUBRG".includes(l));

export interface CardCount {
  readonly Name: string;
  readonly Count: number;
}

/** A deck and its sideboard (design.md A2): up to 15 cards beside it, swapped in between the games of a rematch. */
export interface Deck {
  readonly Main: readonly CardCount[];
  readonly Sideboard: readonly CardCount[];
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
  /** The character's cards the vendor deals in: what it pays for one, how many they own, how many are in neither deck nor sideboard. */
  readonly Buying: readonly { readonly Name: string; readonly Gold: number; readonly Owned: number; readonly Spare: number }[];
}

/** Everything the browser deals a duel from. */
export interface DuelSpec {
  readonly Seats: readonly Record<string, unknown>[];
  readonly MinimumDeckSize: number;
  readonly Seed: number;
  readonly Mob: { readonly Name: string; readonly Tier: number };
  /** Which game of its encounter this is: 1, and one more each time the player fought on (design.md A3). */
  readonly Game: number;
  /** The seat to play first, as the loser of the last game chose; null in an encounter's first game. */
  readonly FirstPlayer: number | null;
}

export interface EncounterStart {
  readonly Token: string;
  readonly Seed: number;
  readonly Duel: DuelSpec;
}

export interface EncounterResult {
  readonly Outcome: "won" | "lost";
  /** The gold a win paid; a loss pays nothing. */
  readonly Gold: number;
  /** The gear item a win dropped, if one did. */
  readonly Gear: GearInstance | null;
  /** The relics a boss win dropped (design.md A3a), already in the collection; empty for most wins and every loss. */
  readonly Relics: readonly string[];
  /** Why a duel counted as lost without being played out. */
  readonly Detail: string | null;
  /** A boss win's gift (design.md A6): a rare or mythic of its loot, already in the collection. */
  readonly Gift?: string | null;
  /** The color a boss win unlocked just now (design.md A6), else null. */
  readonly Unlocked?: ManaColor | null;
  /** The character's hearts after the game. */
  readonly Hearts: number;
  /** A loss with hearts left: the mob's offer, to pay or fight again. */
  readonly Defeat?: Defeat | null;
  /** A loss of the last heart: the character is home, their hearts full again. */
  readonly Died?: boolean;
  /** What a dungeon run they died in had won, taken back. */
  readonly Forfeit?: RunLoss | null;
}

/**
 * A game lost with hearts left, its answer pending (design.md A3): the game's token, the mob, where it was met (a world
 * spawn's id, or a run's `<floor>:<index>`) and in which epoch, which game of the encounter; the hearts left; the mob's
 * life at the end and its full starting life; its buyout (null in a dungeon: it is fought again); and the deck and
 * sideboard the game was played with, which the next game's are swapped from.
 */
export interface Defeat {
  readonly Token: string;
  readonly Mob: string;
  readonly Spawn: string;
  readonly Epoch: number;
  readonly Game: number;
  readonly Hearts: number;
  readonly MaxHearts: number;
  readonly MobLife: number;
  readonly MobFullLife: number;
  readonly Price: number | null;
  readonly Main: readonly CardCount[];
  readonly Sideboard: readonly CardCount[];
}

/** What a dungeon run had won and dying in it took back. */
export interface RunLoss {
  readonly Gold: number;
  readonly Cards: readonly string[];
  readonly Gear: readonly string[];
}

/** Fighting on after a lost game: the deck and sideboard swapped from the last game's, and whether the player plays first. */
export interface Rematch {
  readonly Token: string;
  readonly Main: readonly CardCount[];
  readonly Sideboard: readonly CardCount[];
  readonly PlayFirst: boolean;
}

/** A character's hearts after buying one at a healer, their gold, and the next one's price (null at the most). */
export interface HeartsBought {
  readonly Gold: number;
  readonly Hearts: number;
  readonly MaxHearts: number;
  readonly Price: number | null;
}

/** A place (interfaces.md, "Places"). */
export interface Place {
  readonly Space: string;
  readonly X: number;
  readonly Z: number;
}

/**
 * A dungeon run's floor (design.md A6: a run is a tournament): a round's challengers, its encounters, or on the last floor
 * the boss (null where it has none, or it rests), fought by the index past the encounters; in a run dealt by the
 * character's standing to the dungeon's color, the tier it is dealt at and what its boss gains.
 */
export interface RunFloor {
  readonly Encounters: readonly { readonly Index: number; readonly Mob: string }[];
  readonly Boss: string | null;
  readonly Tier?: number | null;
  readonly BossStats?: { readonly Life: number; readonly Hand: number; readonly MaxHand: number } | null;
  /** The floor holds the run's shrine (design.md A6: one run in eight has one), which gives back a heart once in the run. */
  readonly Shrine?: boolean;
}

/** A boss resting after a win (design.md A6: refought weekly): who, and when it is back (UTC ISO-8601). */
export interface Resting {
  readonly Boss: string;
  readonly Until: string;
}

export interface Run {
  readonly Run: string;
  readonly Seed: number;
  readonly Floors: readonly RunFloor[];
  /** The dungeon's id, the floor the character stands on, the encounters beaten (`<floor>:<index>`). */
  readonly Dungeon?: string | null;
  readonly Floor?: number;
  readonly Beaten?: readonly string[] | null;
  /** The boss that rests, so the last floor is without it; null when it fights. */
  readonly Resting?: Resting | null;
  /** The run's tier: its dungeon's, or the one the character's standing to its color deals it at (design.md A6). */
  readonly Tier?: number | null;
  /** Whether the run's shrine, if it has one, has given its heart. */
  readonly ShrineUsed?: boolean;
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
  /** Pays off the mob of a lost game (a world mob's buyout): the character's gold after. */
  payEncounter(body: { Token: string }): Promise<{ Gold: number }>;
  /** Fights on after a lost game: the encounter's next game. */
  rematch(body: Rematch): Promise<EncounterStart>;
  /** Buys one more heart at the healer the character stands with. */
  buyHeart(): Promise<HeartsBought>;
  /** The finds standing in the world's wilds now. */
  finds(): Promise<Find[]>;
  /** Opens a chest or picks a heartbloom (a find's id): the character's gold and hearts after, and what it held; it is gone for all. */
  openChest(body: { Space: string; Chest: string }): Promise<ChestFound>;
  /** Makes the inn the character stands in their home: where they wake when their last heart is lost. */
  setInn(): Promise<{ Inn: string }>;
  /** Reports where the character is (a world or interior place): their hearts after, which a town fills. */
  position(body: Place): Promise<{ Hearts: number }>;
  enterDungeon(body: { Dungeon: string }): Promise<Run>;
  /** The character's live run, to resume it after a reload; null with none. */
  currentRun(): Promise<Run | null>;
  /** Prays at the shrine of the run's floor the character stands on: their hearts after, one given back. */
  prayAtShrine(body: { Run: string }): Promise<{ Hearts: number }>;
  /** Takes the stair down to floor `Floor` (from 0) of the run. */
  dungeonFloor(body: { Run: string; Floor: number }): Promise<void>;
  leaveDungeon(body: { Run: string }): Promise<void>;
  /** Travels from the attuned tower's waystone the character stands at to another attuned tower's. */
  waystone(body: { Tower: string }): Promise<{ Place: Place }>;
  /** The traveling vendors in town now, by the server's schedule. */
  travelers(): Promise<{ Travelers: readonly Traveler[] }>;
  /**
   * Writes what the page saw to a development server's log (`POST /dev/log`: a jump of the player's figure, with what
   * passed before it), so a teleport seen in play can be read beside what the server did. Nothing elsewhere.
   */
  report?(text: string): Promise<void>;
  /**
   * Files a playtest report (F8 anywhere in the game; reports/index.ts): the realm server writes it to its reports folder
   * (`POST /api/reports`); offline, the dev server does (vite.config.ts). Its id is its folder's name.
   */
  fileReport(body: ReportFiling): Promise<ReportFiled>;
}

/** A playtest report as the server takes it (`POST /api/reports`; realms/reports/README.md). */
export interface ReportFiling {
  readonly Kind: "bug" | "feedback" | "idea";
  readonly Severity: "blocker" | "major" | "minor" | "trivial";
  /** The part of the game it is about, a slug. */
  readonly Area: string;
  readonly Title: string;
  readonly Description: string;
  /** The screen as a PNG data URL, or null when left out. */
  readonly Screenshot: string | null;
  readonly Place: string;
  readonly Screen: string;
  readonly Build: string;
  /** The state in a few lines, for the report's page. */
  readonly Summary: readonly string[];
  /** Everything the page knew (context.json). */
  readonly Context: unknown;
  readonly Console: string;
  readonly Network: string;
  readonly Cards: string;
  readonly Trace: string;
}

/** Where a report was written: its id, which is its folder's name, and the folder. */
export interface ReportFiled {
  readonly Id: string;
  readonly Folder: string;
}

/** The realm server over HTTP: same-origin `/api`, or the server `base` names, on the signed-in cookie. */
export class HttpApi implements RealmApi {
  readonly offline = false;

  constructor(private readonly base: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const began = performance.now();
    let response: Response;
    try {
      response = await fetch(new URL(`api/${path}`, this.base), {
        method,
        credentials: "include",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      noteCall(method, path, "failed", performance.now() - began, String(e));
      throw e;
    }
    const text = await response.text();
    const json: unknown = text.length > 0 ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = json as { Error?: string; Detail?: string };
      noteCall(method, path, response.status, performance.now() - began, error.Error);
      throw new ApiError(response.status, error.Error ?? `Http${response.status}`, error.Detail ?? response.statusText);
    }
    noteCall(method, path, response.status, performance.now() - began);
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
  saveDeck = (deck: Deck) => this.call<Deck>("PUT", "deck", { Main: deck.Main, Sideboard: deck.Sideboard });
  saveLoadout = (slots: Partial<Record<Slot, number | null>>) => this.call<Character>("PUT", "loadout", { Slots: slots });
  vendor = (id: string) => this.call<VendorView>("GET", `vendor/${encodeURIComponent(id)}`);
  buy = (vendor: string, name: string) => this.call<{ Gold: number; Collection: Collection }>("POST", `vendor/${encodeURIComponent(vendor)}/buy`, { Name: name });
  sell = (vendor: string, name: string) => this.call<{ Gold: number; Collection: Collection }>("POST", `vendor/${encodeURIComponent(vendor)}/sell`, { Name: name });
  armorer = (town: string) => this.call<{ Stock: readonly Gear[] }>("GET", `armorer/${encodeURIComponent(town)}`);
  startEncounter = (body: EncounterAt) => this.call<EncounterStart>("POST", "encounter/start", body);
  finishEncounter = (body: { Token: string; Log: readonly string[] }) => this.call<EncounterResult>("POST", "encounter/finish", body);
  payEncounter = (body: { Token: string }) => this.call<{ Gold: number }>("POST", "encounter/pay", body);
  rematch = (body: Rematch) => this.call<EncounterStart>("POST", "encounter/rematch", body);
  buyHeart = () => this.call<HeartsBought>("POST", "hearts/buy", {});
  finds = () => this.call<Find[]>("GET", "finds");
  openChest = (body: { Space: string; Chest: string }) => this.call<ChestFound>("POST", "chest/open", body);
  setInn = () => this.call<{ Inn: string }>("POST", "inn", {});
  position = (body: Place) => this.call<{ Hearts: number }>("POST", "position", body);
  enterDungeon = (body: { Dungeon: string }) => this.call<Run>("POST", "dungeon/enter", body);
  currentRun = async (): Promise<Run | null> => {
    try {
      return await this.call<Run>("GET", "dungeon/run");
    } catch (e) {
      if (e instanceof ApiError && e.code === "NotThere") return null;
      throw e;
    }
  };
  prayAtShrine = (body: { Run: string }) => this.call<{ Hearts: number }>("POST", "dungeon/shrine", body);
  dungeonFloor = async (body: { Run: string; Floor: number }) => {
    await this.call<unknown>("POST", "dungeon/floor", body);
  };
  leaveDungeon = async (body: { Run: string }) => {
    await this.call<unknown>("POST", "dungeon/leave", body);
  };
  waystone = (body: { Tower: string }) => this.call<{ Place: Place }>("POST", "waystone", body);
  travelers = () => this.call<{ Travelers: readonly Traveler[] }>("GET", "travelers");
  fileReport = (body: ReportFiling) => this.call<ReportFiled>("POST", "reports", body);
  report = async (text: string): Promise<void> => {
    // Only a development server has it (404 elsewhere): whatever comes back is let be.
    await fetch(new URL("dev/log", this.base), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Text: text }) }).catch(() => undefined);
  };
}
