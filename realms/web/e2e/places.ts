import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildingData, CHUNK, type ChestData, type ChunkData, NO_SURFACE, RAMP, type SpawnData, TEXELS_PER_TILE, type TileData, areaAt, chunkTile, isHeartbloom } from "../src/world/format";
import { type Tile, chebyshev, chunk, chunkAt, interior, openNear, openWorld, world } from "./realm";

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

let blooms: ChestData[] | null = null;

/** The world's heartblooms (design.md A3b), from its chunk files: only the files that name one are read whole. */
export function heartblooms(): ChestData[] {
  if (blooms) return blooms;
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "dominaria", "world", "chunks");
  blooms = readdirSync(dir)
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .filter((text) => text.includes('"heart":true'))
    .flatMap((text) => (JSON.parse(text) as ChunkData).chests.filter(isHeartbloom));
  return blooms;
}

/** The heartbloom nearest a town. */
export function heartbloomNear(town: string): ChestData {
  const t = world().towns.find((x) => x.id === town)!;
  const centre = { x: t.center[0], z: t.center[1] };
  const near = [...heartblooms()].sort((a, b) => chebyshev(a, centre) - chebyshev(b, centre) || a.id.localeCompare(b.id))[0];
  if (!near) throw new Error("the world grows no heartbloom");
  return near;
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

/** Whether no building stands on the tiles from x0, z0 to x1, z1 (both included). */
function unbuilt(x0: number, z0: number, x1: number, z1: number): boolean {
  return chunksNear({ x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, CHUNK).every((c) => c.buildings.every((b) => b.x > x1 || b.x + b.w <= x0 || b.z > z1 || b.z + b.d <= z0));
}

/**
 * A street tile under a shop's awning (a display window's, in front of a south-facing shop), and the tile south of it:
 * one with the street before it clear of buildings for a few tiles, so nothing but the awning stands in front of the
 * player at any heading.
 */
export function underAwning(town = "new-benalia"): { at: Tile; from: Tile } {
  for (const b of southFacing(town)) {
    if (b.kind !== "shop") continue;
    const openings = (b.params?.openings ?? []) as { at: number; kind: string }[];
    for (const o of openings) {
      if (o.kind !== "display") continue;
      const at = { x: Math.floor(b.x + o.at), z: b.z + b.d };
      const from = { x: at.x, z: at.z + 1 };
      if (openWorld(at) && openWorld(from) && unbuilt(at.x - 4, at.z + 1, at.x + 4, at.z + 5)) return { at, from };
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

/** A world tile's data, or null past the world. */
function tileData(x: number, z: number): TileData | null {
  const c = chunkAt({ x, z });
  return c ? chunkTile(c, x, z) : null;
}

/**
 * The foot of a terrace's east face, the side its shadow falls on (the sun stands to the south-west), out in the open:
 * a straight run of at least six rows where the ground stands a whole step (12 texels) or more above flat ground east
 * of it, three tiles of that ground flat, nothing built or standing within six tiles toward the sun and four the other
 * ways, and no higher ground near enough to shade it - so no other shadow falls there. `x` is the face's line, rows
 * `z0` to `z1` (both included) the run, `y` the lower ground's height (world units); `stand` the open tile nearest a
 * few tiles north of the run, for the player, whose figure and shadow are then clear of it.
 */
export function terraceFoot(near = "new-benalia"): { x: number; z0: number; z1: number; y: number; stand: Tile } {
  const t = world().towns.find((x) => x.id === near)!;
  const centre = { x: t.center[0], z: t.center[1] };
  const flat = (d: TileData | null): d is TileData => d !== null && d[1] !== NO_SURFACE && (d[2] & RAMP) === 0;
  const step = (x: number, z: number): number | null => {
    const hi = tileData(x, z);
    const lo = tileData(x + 1, z);
    if (!flat(hi) || !flat(lo) || hi[0] - lo[0] < 12) return null;
    for (let k = 2; k <= 3; k++) {
      const d = tileData(x + k, z);
      if (!flat(d) || d[0] !== lo[0]) return null;
    }
    return lo[0];
  };
  const clear = (x0: number, z0: number, x1: number, z1: number) =>
    unbuilt(x0, z0, x1, z1) &&
    chunksNear({ x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, CHUNK).every((c) =>
      [...c.props, ...c.npcs].every((p) => p.x < x0 || p.x > x1 + 1 || p.z < z0 || p.z > z1 + 1),
    );
  // No ground above the terrace near enough to shade the foot: the sun stands about as high as it is far, so a rise of
  // h casts about h along the ground, and a tenth more is room enough.
  const unshaded = (x: number, z0: number, z1: number, hi: number, lo: number): boolean => {
    for (let tz = z0 - 8; tz <= z1 + 16; tz++) {
      for (let tx = x - 16; tx <= x + 6; tx++) {
        const d = tileData(tx, tz);
        if (!d || d[0] <= hi) continue;
        const far = Math.max(Math.abs(tx - (x + 1)), tz < z0 ? z0 - tz : tz > z1 ? tz - z1 : 0);
        if (((d[0] - lo) / TEXELS_PER_TILE) * 1.1 >= far) return false;
      }
    }
    return true;
  };
  // Ring by ring out from the town, so the run found is the nearest and always the same.
  for (let r = 0; r < 400; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = centre.x + dx;
        const z0 = centre.z + dz;
        const y = step(x, z0);
        if (y === null || step(x, z0 - 1) !== null) continue;
        let z1 = z0;
        while (step(x, z1 + 1) === y && z1 - z0 < 9) z1++;
        if (z1 - z0 < 5 || !clear(x - 6, z0 - 4, x + 5, z1 + 6) || !unshaded(x, z0, z1, tileData(x, z0)![0], y)) continue;
        return { x: x + 1, z0, z1, y: y / TEXELS_PER_TILE, stand: openNear({ x: x + 2, z: z0 - 3 }, 0) };
      }
    }
  }
  throw new Error(`no terrace's foot in the open near ${near}`);
}

/**
 * The brink of a straight ledge near a town (world/grid.ts canStep): an open tile with open ground a whole level below
 * it to the west, and the same for two tiles north and south of it, with open ground on its level east of all five for a
 * few tiles - walked up to and along, never over.
 */
export function ledgeBrink(town = "new-benalia"): { at: Tile; below: Tile } {
  const t = world().towns.find((x) => x.id === town)!;
  const tile = (x: number, z: number) => {
    const c = chunkAt({ x, z });
    return c ? c.tiles[(z - c.cz * CHUNK) * CHUNK + (x - c.cx * CHUNK)]! : null;
  };
  const level = (x: number, z: number, h: number) => {
    const n = tile(x, z);
    return !!n && openWorld({ x, z }) && (n[2] & RAMP) === 0 && n[0] === h;
  };
  const found: Tile[] = [];
  for (let r = t.radius + 2; r < t.radius + 160 && found.length === 0; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = t.center[0] + dx;
        const z = t.center[1] + dz;
        const here = tile(x, z);
        if (!here || !level(x, z, here[0])) continue;
        const west = tile(x - 1, z);
        if (!west || !level(x - 1, z, west[0]) || here[0] - west[0] < 12) continue;
        // A straight ledge: the same drop to the west all along five rows, open ground on top east of it.
        let room = true;
        for (let k = -2; k <= 2 && room; k++) {
          room = level(x - 1, z + k, west[0]);
          for (let e = 0; e <= 3 && room; e++) room = level(x + e, z + k, here[0]);
        }
        if (room) found.push({ x, z });
      }
    }
  }
  found.sort((a, b) => a.z - b.z || a.x - b.x);
  if (!found[0]) throw new Error(`no ledge near ${town}`);
  return { at: found[0], below: { x: found[0].x - 1, z: found[0].z } };
}
