// Seeded randomness and hashing. Content generators and the overworld's own dressing use mulberry32 so a seed gives
// the same numbers on every machine; the spawn algorithm (spawn.ts) uses FNV-1a, which the realm server shares.

/** A small, seeded random source: the same seed gives the same numbers on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const encoder = new TextEncoder();

/** FNV-1a, 32-bit, over the string's UTF-8 bytes (realms/docs/interfaces.md, "Spawns"). */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A whole number from `low` to `high`, both included. */
export const between = (random: () => number, low: number, high: number): number =>
  low + Math.floor(random() * (high - low + 1));

/** One of the items, picked by `random`. */
export function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("pick: nothing to pick from");
  return item;
}
