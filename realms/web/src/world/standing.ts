// Where a color dungeon's color stands to a character's, and how a run of it is dealt (design.md A6; the realm server's
// Standings and DungeonStanding, which this mirrors for the in-memory API and the map): the character's own color - started
// with or unlocked - deals it as written; a color next to their starting color on the wheel (W U B R G) is an ally's, and one
// across from it an enemy's, each as the dungeon file's `standing` says (an ally's tier 3 with T2-T3 mobs, an enemy's
// tier 4 with T3-T4 mobs and a stronger boss).
import type { DungeonData, DungeonStanding, Standing } from "./format";

const WHEEL = "WUBRG";

/** The character as standing reads it: their identity, and the colors of it unlocked (the rest is their starting color). */
export interface Colors {
  readonly Identity: string;
  readonly Unlocked: readonly string[];
}

/** The color a character started with: the one of their identity not unlocked. Null when none is left so. */
export function startingColor(c: Colors): string | null {
  return [...c.Identity].find((l) => WHEEL.includes(l) && !c.Unlocked.includes(l)) ?? null;
}

/** Where a region's color stands to a character; null for no region (or no starting color to stand by). */
export function standingOf(region: string | null | undefined, c: Colors): Standing | null {
  const at = region && region.length === 1 ? WHEEL.indexOf(region) : -1;
  if (at < 0) return null;
  if (c.Identity.includes(region!)) return "own";
  const start = startingColor(c);
  const from = start ? WHEEL.indexOf(start) : -1;
  if (from < 0) return null;
  const apart = (at - from + WHEEL.length) % WHEEL.length;
  return apart === 1 || apart === 4 ? "ally" : "enemy";
}

/** How a dungeon is dealt to a character: its standing's, or null as written. */
export const dealtBy = (d: DungeonData, c: Colors): DungeonStanding | null => {
  const s = standingOf(d.region, c);
  return (s && d.standing?.[s]) ?? null;
};

/** The tier a dungeon's run is for a character. */
export const tierFor = (d: DungeonData, c: Colors): number => dealtBy(d, c)?.tier ?? d.tier;

/**
 * The mobs a floor's encounters are drawn from as `standing` deals the run: the floor's own of its tiers, else every
 * floor's of them; the floor's table as written with none.
 */
export function tableOf(d: DungeonData, floor: number, standing: DungeonStanding | null, tierOf: (mob: string) => number): string[] {
  const lists = Array.isArray(d.mobs[0]) ? (d.mobs as readonly (readonly string[])[]) : [d.mobs as readonly string[]];
  const own = [...(lists[Math.min(floor, lists.length - 1)] ?? [])];
  if (!standing) return own;
  const [low, high] = standing.mobTiers;
  const fits = (m: string) => tierOf(m) >= low && tierOf(m) <= high;
  const kept = own.filter(fits);
  return kept.length > 0 ? kept : [...new Set(lists.flat().filter(fits))];
}
