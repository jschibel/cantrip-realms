// The duels of offline play (MockApi): dealt as the realm server deals them (Encounters.PlayerSeat / MobSeat), so the real
// card layer plays a real game with no server - the player's seat their deck, their stats and their worn gear's emblems,
// the mob's its themed deck (decks/realms/<plane>/<mob>.txt), its stats and its gear's. Only checking the result needs the
// server, which offline play has none of: the mock takes the card layer's word for it.

import type { ManaColor } from "../art/figures";
import type { Character, Deck } from "./api";

/** A decklist file's cards, one entry per line `<count> <name>`; `#` comments and blank lines left out. */
export function parseDeckList(text: string): { Name: string; Count: number }[] {
  const cards: { Name: string; Count: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^(\d+)\s+(.+)$/.exec(line);
    if (match) cards.push({ Name: match[2]!.trim(), Count: Number(match[1]) });
  }
  return cards;
}

const STARTERS = import.meta.glob<string>("../../../content/dominaria/starters/*.txt", { eager: true, query: "?raw", import: "default" });
const STARTER_FILES: Record<ManaColor, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

/** The starter deck of a color (design.md A1): realms/content/dominaria/starters/<color>.txt, basics and all. */
export function starterDeck(color: ManaColor): { Name: string; Count: number }[] {
  const text = Object.entries(STARTERS).find(([path]) => path.endsWith(`/${STARTER_FILES[color]}.txt`))?.[1];
  return text ? parseDeckList(text) : [];
}

interface MobFile {
  readonly id: string;
  readonly name: string;
  readonly deck?: string;
  readonly stats?: { readonly life: number; readonly hand: number; readonly maxHand: number };
  readonly gear?: readonly string[];
}

interface GearFile {
  readonly id: string;
  readonly name: string;
  readonly stats?: { readonly life?: number; readonly hand?: number; readonly maxHand?: number };
  readonly effects?: readonly unknown[];
}

const MOBS = new Map(Object.values(import.meta.glob<MobFile>("../../../content/*/mobs/*.json", { eager: true, import: "default" })).map((m) => [m.id, m]));
const GEAR = new Map(Object.values(import.meta.glob<GearFile>("../../../content/gear/*.json", { eager: true, import: "default" })).map((g) => [g.id, g]));
/** The mobs' decks, read when a duel is dealt: keyed by the path a mob file names (`decks/realms/<plane>/<mob>.txt`). */
const MOB_DECKS = import.meta.glob<string>("../../../../decks/realms/*/*.txt", { query: "?raw", import: "default" });

/** A gear item's emblem in the engine, `"<name> (gear)"`, or null for an item with no effects (interfaces.md, Gear). */
const emblemOf = (gear: GearFile): string | null => ((gear.effects?.length ?? 0) > 0 ? `${gear.name} (gear)` : null);

const expand = (cards: readonly { Name: string; Count: number }[]): string[] => cards.flatMap((c) => Array.from({ length: c.Count }, () => c.Name));

/** The player's seat: their deck, their stats with their gear's, an emblem per worn item with effects. */
export function playerSeat(character: Character, deck: Deck): Record<string, unknown> {
  const emblems = Object.values(character.Loadout)
    .map((worn) => worn?.Gear.Emblem ?? null)
    .filter((e): e is string => !!e);
  return seat(character.Name, expand(deck.Main), character.Stats.Life, character.Stats.Hand, character.Stats.MaxHand, emblems);
}

/** The mob's seat: its themed deck, its stats with its gear's, and its gear's emblems; null for a mob with no deck file. */
export async function mobSeat(mob: string): Promise<Record<string, unknown> | null> {
  const file = MOBS.get(mob);
  const load = file?.deck ? Object.entries(MOB_DECKS).find(([path]) => path.endsWith(`/${file.deck}`))?.[1] : undefined;
  if (!file || !load) return null;
  const cards = parseDeckList(await load());
  const worn = (file.gear ?? []).map((id) => GEAR.get(id)).filter((g): g is GearFile => !!g);
  const base = file.stats ?? { life: 20, hand: 7, maxHand: 7 };
  const sum = (key: "life" | "hand" | "maxHand") => base[key] + worn.reduce((n, g) => n + (g.stats?.[key] ?? 0), 0);
  return seat(file.name, expand(cards), sum("life"), sum("hand"), sum("maxHand"), worn.map(emblemOf).filter((e): e is string => !!e));
}

function seat(name: string, deck: string[], life: number, hand: number, maxHand: number, emblems: string[]): Record<string, unknown> {
  return { Name: name, Deck: deck, Sideboard: [], Companion: null, Commanders: [], StartingLife: life, StartingHandSize: hand, MaximumHandSize: maxHand, Emblems: emblems };
}
