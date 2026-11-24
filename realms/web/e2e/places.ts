import { type BuildingData, CHUNK, type SpawnData, areaAt } from "../src/world/format";
import { type Tile, chebyshev, chunk, chunkAt, interior, openWorld, world } from "./realm";

// Where the tests find what they need in the generated world: read from its files, never guessed, so a regenerated
// world still has a place for every test.

/** Every chunk within `reach` tiles of a tile. */
function chunksNear(t: Tile, reach: number) {
  const found = [];
  for (let cx = Math.floor((t.x - reach) / CHUNK); cx <= Math.floor((t.x + reach) / CHUNK); cx++) {
    for (let cz = Math.floor((t.z - reach) / CHUNK); cz <= Math.floor((t.z + reach) / CHUNK); cz++) {
      const c = chunk(cx, cz);
      if (c) found.push(c);
    }
  }
  return found;
}

/** The door tile of the building an interior is behind (its `exit`, the street tile one comes out on). */
export function doorOf(id: string): Tile {
  const room = interior(id);
  const door = { x: room.exit[0], z: room.exit[1] };
  // A building is stored in the chunk of its corner, which may lie as far as a big building is wide from its door.
  const building = chunksNear(door, CHUNK).flatMap((c) => c.buildings).find((b) => b.interior === id);
  if (!building) throw new Error(`no building leads into ${id}`);
  return door;
}

/** A spawn point outside a town's walls, the nearest to them of the tier asked for. */
export function spawnNear(town: string, tier = 1): SpawnData {
  const t = world().towns.find((x) => x.id === town)!;
  const centre = { x: t.center[0], z: t.center[1] };
  const spawns = chunksNear(centre, t.radius + 80).flatMap((c) => c.spawns).filter((s) => s.tier === tier && chebyshev(s, centre) > t.radius + 4);
  spawns.sort((a, b) => chebyshev(a, centre) - chebyshev(b, centre) || a.x - b.x || a.z - b.z);
  if (!spawns[0]) throw new Error(`no tier ${tier} spawn near ${town}`);
  return spawns[0];
}

/** Two open tiles of a road a few steps apart, either side of where it crosses `crossing`'s test. */
function roadCrossing(crossing: (a: Tile, b: Tile) => boolean, steps = 4): { from: Tile; to: Tile; a: Tile; b: Tile } {
  for (const road of world().roads) {
    const tiles = road.tiles.map(([x, z]) => ({ x, z }));
    for (let i = steps; i < tiles.length - steps - 1; i++) {
      const a = tiles[i]!;
      const b = tiles[i + 1]!;
      if (!crossing(a, b)) continue;
      const from = tiles[i - steps + 1]!;
      const to = tiles[i + steps]!;
      if (tiles.slice(i - steps + 1, i + steps + 1).every(openWorld) && chebyshev(from, to) <= 2 * steps) return { from, to, a, b };
    }
  }
  throw new Error("no road crossing found");
}

/** Where a road crosses from one chunk to the next. */
export const chunkBorder = () => roadCrossing((a, b) => chunkAt(a) !== chunkAt(b));

/** Where a road crosses into a harder tier's zone (out of the wilds, not a town). */
export const tierRise = () => {
  const w = world();
  return roadCrossing((a, b) => {
    const ta = areaAt(w, a.x, a.z)?.tier ?? 0;
    const tb = areaAt(w, b.x, b.z)?.tier ?? 0;
    return ta >= 1 && tb > ta && w.towns.every((t) => chebyshev(a, { x: t.center[0], z: t.center[1] }) > t.radius + 3);
  }, 3);
};

/** A tile of each tier's zone, well inside it, for checking the map draws it. */
export function zoneSamples(): { tier: number; at: Tile }[] {
  const zones = world().zones;
  const found: { tier: number; at: Tile }[] = [];
  for (let tier = 1; tier <= 4; tier++) {
    let done = false;
    for (let row = 1; row < zones.rows - 1 && !done; row++) {
      for (let col = 1; col < zones.cols - 1 && !done; col++) {
        const same = [-1, 0, 1].every((dr) => [-1, 0, 1].every((dc) => zones.areas[zones.grid[row + dr]?.[col + dc] ?? -1]?.tier === tier));
        if (!same) continue;
        found.push({ tier, at: { x: col * zones.cell + zones.cell / 2, z: row * zones.cell + zones.cell / 2 } });
        done = true;
      }
    }
  }
  return found;
}

/** Buildings of a town's own style facing south (rot 0), in a steady order. */
function southFacing(town: string): BuildingData[] {
  const t = world().towns.find((x) => x.id === town)!;
  const centre = { x: t.center[0], z: t.center[1] };
  const seen = new Set<string>();
  const out: BuildingData[] = [];
  for (const c of chunksNear(centre, t.radius)) {
    for (const b of c.buildings) {
      if (seen.has(b.id) || b.rot !== 0 || b.style !== t.style) continue;
      seen.add(b.id);
      out.push(b);
    }
  }
  return out.sort((a, b) => a.z - b.z || a.x - b.x);
}

/** A street tile under a shop's awning (a display window's, in front of a south-facing shop), and the tile south of it. */
export function underAwning(town = "new-benalia"): { at: Tile; from: Tile } {
  for (const b of southFacing(town)) {
    if (b.kind !== "shop") continue;
    const openings = (b.params?.openings ?? []) as { at: number; kind: string }[];
    for (const o of openings) {
      if (o.kind !== "display") continue;
      const at = { x: Math.floor(b.x + o.at), z: b.z + b.d };
      const from = { x: at.x, z: at.z + 1 };
      if (openWorld(at) && openWorld(from)) return { at, from };
    }
  }
  throw new Error(`no awning to stand under in ${town}`);
}

/** A tile right behind the middle of a south-facing house or shop (north of it), and the tile north of that. */
export function behindBuilding(town = "new-benalia"): { at: Tile; from: Tile } {
  for (const b of southFacing(town)) {
    if (b.kind !== "house" && b.kind !== "shop") continue;
    const at = { x: b.x + Math.floor(b.w / 2), z: b.z - 1 };
    const from = { x: at.x, z: at.z - 1 };
    if (openWorld(at) && openWorld(from)) return { at, from };
  }
  throw new Error(`no building to stand behind in ${town}`);
}
