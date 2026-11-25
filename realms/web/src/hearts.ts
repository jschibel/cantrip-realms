// Hearts and the defeat that costs one (design.md A3, A3b), as the overworld shows them and the in-memory API keeps them:
// the buyout a world mob asks, the hearts a healer sells and what they cost, and the line a mob says over the player it
// beat. The realm server owns all of it (Encounters.Buyout, Hearts.Prices); these are its numbers, which
// hearts.test.ts holds to the same cases its tests check.

import { mobInfo } from "./mobs";

/** The hearts a new character has and holds. */
export const STARTING_HEARTS = 2;

/** The most hearts a character can hold. */
export const MOST_HEARTS = 5;

/** What the heart that brings a character's capacity to each number costs at a healer, in gold. */
export const HEART_PRICES: Readonly<Record<number, number>> = { 3: 1_000, 4: 3_000, 5: 8_000 };

/** What a character holding `capacity` hearts pays for one more; null at the most. */
export const heartPriceAfter = (capacity: number): number | null => HEART_PRICES[capacity + 1] ?? null;

/** What a mob of each tier asks to be paid off with after a flawless win. */
export const BUYOUT_BASE: Readonly<Record<number, number>> = { 1: 30, 2: 120, 3: 400, 4: 1_200 };

/**
 * A mob's buyout: its tier's base in the share of its full starting life it ended the game with, never more than the
 * whole, rounded half up, and at least 1 gold.
 */
export function buyout(tier: number, lifeAtEnd: number, fullLife: number): number {
  const whole = BUYOUT_BASE[tier] ?? BUYOUT_BASE[4]!;
  const share = fullLife <= 0 ? 1 : Math.min(1, lifeAtEnd / fullLife);
  return Math.max(1, Math.round(whole * share));
}

/** How a mob's win went, by the life it kept of its full life: none lost, a quarter or less left, or between. */
export type Margin = "flawless" | "solid" | "close";

export function marginOf(lifeAtEnd: number, fullLife: number): Margin {
  if (lifeAtEnd >= fullLife) return "flawless";
  return lifeAtEnd <= fullLife * 0.25 ? "close" : "solid";
}

/** What any mob says when its file has no line for the moment. */
const GENERIC: Readonly<Record<Margin, readonly string[]>> = {
  flawless: ["Is that all you have? Come back when you know your deck."],
  solid: ["A fair fight, and a fair beating. Better luck next time."],
  close: ["That was closer than I'd like. Still, the day is mine."],
};

/**
 * What a mob says over the player it beat (its file's `lines`): one of its lines for how the game went, chosen at
 * `random`, or a generic one where it has none. A beast's line is a narrated action, between asterisks.
 */
export function defeatLine(mob: string, margin: Margin, random: () => number = Math.random): string {
  const own = mobInfo(mob).lines?.[margin];
  const lines = own && own.length > 0 ? own : GENERIC[margin];
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))]!;
}

/** Whether a line is a narrated action (`*The wurm settles back into the moss.*`) rather than speech. */
export const isNarrated = (line: string): boolean => /^\*.*\*$/s.test(line.trim());
