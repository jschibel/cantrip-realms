// The mobs the overworld shows (realms/content/<plane>/mobs/*.json; interfaces.md, "Mobs"): their names, tiers, models
// and what they say when they beat the player. A map may name a mob whose file the server's content has not written yet; such a mob is shown with a look
// guessed from its id - a stand-in for display only, never for anything of value, which the server owns.

import type { ManaColor, MobModel } from "./art/figures";

export interface MobInfo {
  readonly id: string;
  readonly name: string;
  /**
   * Whether its name is a proper name (its file's `named`): a legend's own, said bare - "Rofellos, Llanowar Emissary",
   * "Rorix Bladewing" - where any other mob is "the Llanowar Elves", "the Phyrexian Praetor" (theMob).
   */
  readonly named: boolean;
  /** The card the mob is (its file's `creature`): it picks the figure's variations with the id (art/figures/mobs.ts). */
  readonly creature: string;
  readonly tier: number;
  readonly goldRange: readonly [number, number];
  readonly model: MobModel;
  readonly boss: boolean;
  /** What it says (a beast: does, between asterisks) over the player it beat, by how the game went (hearts.ts, defeatLine). */
  readonly lines?: MobLines;
  /** The color a boss unlocks when beaten (design.md A6); none for any other mob, or the capstone. */
  readonly unlocks?: ManaColor;
  /** A boss's own unique gear item, by id. */
  readonly unique?: string;
  /** Whether this came from a mob file, rather than being guessed from the id. */
  readonly known: boolean;
}

/** A mob's lines (its file's `lines`): for a win without a point of life lost, one with some lost, and a close one. */
export interface MobLines {
  readonly flawless?: readonly string[];
  readonly solid?: readonly string[];
  readonly close?: readonly string[];
}

interface MobFile {
  readonly id: string;
  readonly name: string;
  readonly named?: boolean;
  readonly creature?: string;
  readonly tier: number;
  readonly goldRange: readonly [number, number];
  readonly model: MobModel;
  readonly boss?: boolean;
  readonly lines?: MobLines;
  readonly unlocks?: ManaColor;
  readonly unique?: string;
}

const files = import.meta.glob<MobFile>("../../content/*/mobs/*.json", { eager: true, import: "default" });
const byId = new Map(Object.values(files).map((m) => [m.id, m]));

/** Which base model a mob id reads as, by the words in it, for mobs with no file yet. */
const GUESSES: readonly [RegExp, string, readonly string[], number?][] = [
  [/seraph|angel/, "angel", ["#f2efe6", "#f1b44c", "#93c8dc"]],
  [/drake|dragon/, "drake", ["#c8432c", "#f1b44c", "#2e1f17"], 1.3],
  [/wurm|beast|ancient/, "wurm", ["#4f7a34", "#d6ae7e", "#2a4524"], 1.2],
  [/elf|elves|elvish|forager/, "elf", ["#3e9a4a", "#8f6340", "#c08a62"]],
  [/goblin/, "goblin", ["#6b963e", "#c8432c", "#4a3122"]],
  [/ghoul|zombie/, "ghoul", ["#8c909c", "#2a2a2d", "#5d6646"]],
  [/phyrexian|horror|plaguelord/, "phyrexian", ["#b3b5bc", "#7a1f24", "#2a2b36"]],
  [/automaton|construct|sentinel|warden|golem/, "construct", ["#8c909c", "#9c6a1e", "#62a4c2"]],
  [/wraith|spirit|elemental|drifter/, "spirit", ["#93c8dc", "#f4ecc2", "#5b8fd6"]],
];

function guess(id: string): MobInfo {
  const name = id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const found = GUESSES.find(([pattern]) => pattern.test(id));
  const [mesh, palette, size] = found ? [found[1], found[2], found[3]] : ["humanoid", ["#8c909c", "#7a1f24", "#4a3122"] as const, undefined];
  return { id, name, named: false, creature: name, tier: 1, goldRange: [20, 60], model: { mesh, palette, size }, boss: false, known: false };
}

export function mobInfo(id: string): MobInfo {
  const file = byId.get(id);
  if (!file) return guess(id);
  return { ...file, named: file.named ?? false, creature: file.creature ?? file.name, boss: file.boss ?? false, known: true };
}

/**
 * A mob as a sentence names it: "the Llanowar Elves", "the Phyrexian Praetor", but a legend by its own name bare ("Rofellos,
 * Llanowar Emissary", "Rorix Bladewing"). `start` capitalizes the article for the start of a sentence.
 */
export function theMob(info: { readonly name: string; readonly named: boolean }, start = true): string {
  return info.named ? info.name : `${start ? "The" : "the"} ${info.name}`;
}
