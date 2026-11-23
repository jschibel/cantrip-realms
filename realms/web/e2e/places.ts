import { type Hex, distance, hex } from "../src/hex";
import { CHUNK, type DoorData, type SpawnData, areaAt } from "../src/world/schema";
import { chunk, chunkOfHex, interior, openWorld, world } from "./realm";

// Where the tests find what they need in the generated world: read from its files, never guessed, so a regenerated
// world still has a place for every test.

/** Every chunk within `reach` hexes of a hex. */
function chunksNear(h: Hex, reach: number) {
  const found = [];
  for (let cq = Math.max(0, Math.floor((h.q - reach) / CHUNK)); cq <= Math.min(19, Math.floor((h.q + reach) / CHUNK)); cq++) {
    for (let cr = Math.max(0, Math.floor((h.r - reach) / CHUNK)); cr <= Math.min(19, Math.floor((h.r + reach) / CHUNK)); cr++) found.push(chunk(cq, cr));
  }
  return found;
}

/** The door into an interior, and the street hex before it. */
export function doorOf(id: string): { door: DoorData; exit: Hex } {
  const room = interior(id);
  const exit = hex(room.exit.q, room.exit.r);
  const door = chunksNear(exit, 4).flatMap((c) => c.doors).find((d) => d.interior === id);
  if (!door) throw new Error(`no door to ${id}`);
  return { door, exit };
}

/** A spawn point outside a town's walls, the nearest to them of the tier asked for. */
export function spawnNear(town: string, tier = 1): SpawnData {
  const t = world().towns.find((x) => x.id === town)!;
  const centre = hex(t.center[0], t.center[1]);
  const spawns = chunksNear(centre, t.radius + 60).flatMap((c) => c.spawns).filter((s) => s.tier === tier && distance(s, centre) > t.radius + 6);
  spawns.sort((a, b) => distance(a, centre) - distance(b, centre) || a.q - b.q);
  if (!spawns[0]) throw new Error(`no tier ${tier} spawn near ${town}`);
  return spawns[0];
}

/** Two open hexes of a road a few steps apart, either side of where it crosses `crossing`'s test. */
function roadCrossing(crossing: (a: Hex, b: Hex) => boolean, steps = 4): { from: Hex; to: Hex; a: Hex; b: Hex } {
  for (const road of world().roads) {
    const hexes = road.hexes.map(([q, r]) => hex(q, r));
    for (let i = steps; i < hexes.length - steps - 1; i++) {
      const a = hexes[i]!;
      const b = hexes[i + 1]!;
      if (!crossing(a, b)) continue;
      const from = hexes[i - steps + 1]!;
      const to = hexes[i + steps]!;
      if (hexes.slice(i - steps + 1, i + steps + 1).every(openWorld) && distance(from, to) <= 2 * steps) return { from, to, a, b };
    }
  }
  throw new Error("no road crossing found");
}

/** Where a road crosses from one chunk to the next. */
export const chunkBorder = () => roadCrossing((a, b) => chunkOfHex(a) !== chunkOfHex(b));

/** Where a road crosses into a harder tier's zone (out of the wilds, not a town). */
export const tierRise = () => {
  const zones = world().zones;
  return roadCrossing((a, b) => {
    const ta = areaAt(zones, a)?.tier ?? 0;
    const tb = areaAt(zones, b)?.tier ?? 0;
    return ta >= 1 && tb > ta && world().towns.every((t) => distance(a, hex(t.center[0], t.center[1])) > t.radius + 3);
  }, 3);
};

/** A hex of each tier's zone, on land, for checking the map draws it. */
export function zoneSamples(): { tier: number; at: Hex }[] {
  const zones = world().zones;
  const found: { tier: number; at: Hex }[] = [];
  for (let tier = 1; tier <= 4; tier++) {
    let done = false;
    for (let row = 0; row < zones.rows && !done; row++) {
      for (let col = 0; col < zones.cols && !done; col++) {
        // The middle of a square whose neighbours are all of its tier, so the sample is well inside the zone.
        const same = [-1, 0, 1].every((dr) => [-1, 0, 1].every((dc) => zones.areas[zones.grid[row + dr]?.[col + dc] ?? 0]?.tier === tier));
        if (!same) continue;
        found.push({ tier, at: hex(col * zones.cell + zones.cell / 2, row * zones.cell + zones.cell / 2) });
        done = true;
      }
    }
  }
  return found;
}
