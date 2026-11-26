import { type BuildingData, CHUNK, HOP, ICON_SIZE, type PropData, RAMP, type SpawnData, TEXELS_PER_TILE, type TileData, areaAt, chunkTile, siteRect } from "../src/world/format";
import { type Tile, chebyshev, chunk, chunkAt, interior, mobFile, openWorld, world } from "./realm";

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

/**
 * Where a town is on the ground wanderers walk, and how far from there its edge lies: its icon on the travel map (a
 * world of two scales: wanderers live there alone), or its walls (one scale).
 */
export function townSpot(town: string): { centre: Tile; edge: number } {
  const t = world().towns.find((x) => x.id === town)!;
  if (t.site) return { centre: { x: t.site[0], z: t.site[1] }, edge: Math.floor((ICON_SIZE[t.kind] ?? 3) / 2) };
  return { centre: { x: t.center[0], z: t.center[1] }, edge: t.radius };
}

/** Every spawn point of the travel map (a world of two scales; of the whole world in one of one scale). */
export function travelSpawns(): SpawnData[] {
  const w = world();
  const r = w.travel ?? [0, 0, w.size[0], w.size[1]];
  const out: SpawnData[] = [];
  for (let cx = Math.floor(r[0] / CHUNK); cx < Math.ceil(r[2] / CHUNK); cx++) for (let cz = Math.floor(r[1] / CHUNK); cz < Math.ceil(r[3] / CHUNK); cz++) out.push(...(chunk(cx, cz)?.spawns ?? []));
  return out;
}

/** Whether a mob hops a ledge a level high (its file's `hops`, true when left out: mobs.ts mobInfo). */
export function hops(mob: string): boolean {
  try {
    return mobFile(mob).hops !== false;
  } catch {
    return true;
  }
}

/** A spawn point outside a town (its walls, or on the travel map its icon), the nearest to it of the tier asked for. */
export function spawnNear(town: string, tier = 1): SpawnData {
  const { centre, edge } = townSpot(town);
  const spawns = chunksNear(centre, edge + 120).flatMap((c) => c.spawns).filter((s) => s.tier === tier && chebyshev(s, centre) > edge + 4);
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
    return ta >= 1 && tb > ta && w.towns.every((t) => {
      const { centre, edge } = townSpot(t.id);
      return chebyshev(a, centre) > edge + 3;
    });
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

/** The open tile nearest a town's middle whose floor stands more than half a tile up (its square, a terrace of it). */
export function raisedNear(town = "new-benalia"): Tile {
  const t = world().towns.find((x) => x.id === town)!;
  for (let r = 0; r < 80; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const at = { x: t.center[0] + dx, z: t.center[1] + dz };
        const d = tileData(at.x, at.z);
        if (d && d[0] > TEXELS_PER_TILE / 2 && openWorld(at)) return at;
      }
    }
  }
  throw new Error(`no raised ground near the middle of ${town}`);
}

/** A world tile's data, or null past the world. */
function tileData(x: number, z: number): TileData | null {
  const c = chunkAt({ x, z });
  return c ? chunkTile(c, x, z) : null;
}

/**
 * The brink of a straight ledge a level high near a town (world/grid.ts canStep, a hop): an open tile with open ground
 * one level (HOP) below it to the west, and the same for two tiles north and south of it, with open ground on its level
 * east of all five for a few tiles - hopped straight across, walked along. Outside its walls, in its grounds (a world of
 * two scales); `travel`: on the travel map round its icon instead.
 */
export function ledgeBrink(town = "new-benalia", travel = false): { at: Tile; below: Tile } {
  const t = world().towns.find((x) => x.id === town)!;
  const onTravel = travel && !!t.site;
  const { centre, edge } = onTravel ? townSpot(town) : { centre: { x: t.center[0], z: t.center[1] }, edge: t.radius };
  const bounds = onTravel ? world().travel ?? null : t.grounds ?? null;
  const inside = (x: number, z: number) => !bounds || (x >= bounds[0] && z >= bounds[1] && x < bounds[2] && z < bounds[3]);
  const tile = (x: number, z: number) => {
    const c = chunkAt({ x, z });
    return c ? c.tiles[(z - c.cz * CHUNK) * CHUNK + (x - c.cx * CHUNK)]! : null;
  };
  const level = (x: number, z: number, h: number) => {
    const n = tile(x, z);
    return inside(x, z) && !!n && openWorld({ x, z }) && (n[2] & RAMP) === 0 && n[0] === h;
  };
  const found: Tile[] = [];
  for (let r = edge + 2; r < edge + 160 && found.length === 0; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = centre.x + dx;
        const z = centre.z + dz;
        const here = tile(x, z);
        if (!here || !level(x, z, here[0])) continue;
        const west = tile(x - 1, z);
        if (!west || !level(x - 1, z, west[0]) || here[0] - west[0] !== HOP) continue;
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
  if (!found[0]) throw new Error(`no ledge near ${town}${onTravel ? " on the travel map" : ""}`);
  return { at: found[0], below: { x: found[0].x - 1, z: found[0].z } };
}

/** Whether a tile of the travel map is within `margin` of a town's icon, a dungeon's entrance or a ferry's dock. */
export function nearAWay(t: Tile, margin: number): boolean {
  const w = world();
  for (const town of w.towns) {
    const r = siteRect(town);
    if (r && t.x >= r[0] - margin && t.x < r[2] + margin && t.z >= r[1] - margin && t.z < r[3] + margin) return true;
  }
  if (w.dungeons.some((d) => chebyshev(t, d) <= margin)) return true;
  return w.ferries.some((f) => chebyshev(t, { x: f.from[0], z: f.from[1] }) <= margin || chebyshev(t, { x: f.to[0], z: f.to[1] }) <= margin);
}

/** The props of the travel map, every chunk's. */
function travelProps(): PropData[] {
  const r = world().travel;
  if (!r) return [];
  const out: PropData[] = [];
  for (let cx = Math.floor(r[0] / CHUNK); cx < Math.ceil(r[2] / CHUNK); cx++) for (let cz = Math.floor(r[1] / CHUNK); cz < Math.ceil(r[3] / CHUNK); cz++) out.push(...(chunk(cx, cz)?.props ?? []));
  return out;
}

/** An open tile within `reach` of a point, the nearest (then the first by z, x), or null. */
function openWithin(at: Tile, reach: number): Tile | null {
  for (let r = 0; r <= reach; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = { x: at.x + dx, z: at.z + dz };
        if (Math.max(Math.abs(dx), Math.abs(dz)) === r && openWorld(t)) return t;
      }
    }
  }
  return null;
}

/**
 * Places of the travel map to walk about (a world of two scales), each at least 16 tiles from any icon, entrance or dock:
 * the middle of the longest road there is such a middle of, the heart of a wood nearest Llanowar's icon, the foot of a
 * range's peaks nearest the middle of the map, a bridge over a river, and a bank a level high near New Benalia's icon.
 */
export function travelSpots(): { name: string; at: Tile }[] {
  const w = world();
  if (!w.travel) return [];
  const clear = (t: Tile | null): t is Tile => !!t && !nearAWay(t, 16);
  const out: { name: string; at: Tile }[] = [];
  const roads = [...w.roads].sort((a, b) => b.tiles.length - a.tiles.length || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  for (const road of roads) {
    const [x, z] = road.tiles[Math.floor(road.tiles.length / 2)]!;
    const at = openWithin({ x, z }, 1);
    if (clear(at)) {
      out.push({ name: "road", at });
      break;
    }
  }
  const props = travelProps();
  const groves = props.filter((p) => p.id === "grove");
  const llanowar = townSpot("llanowar").centre;
  const woods = groves.map((g) => ({ x: Math.floor(g.x), z: Math.floor(g.z) })).sort((a, b) => chebyshev(a, llanowar) - chebyshev(b, llanowar) || a.x - b.x || a.z - b.z);
  for (const g of woods) {
    if (groves.filter((o) => chebyshev(g, o) <= 5).length < 20) continue;
    const at = openWithin(g, 2);
    if (clear(at)) {
      out.push({ name: "wood", at });
      break;
    }
  }
  const middle = { x: (w.travel[0] + w.travel[2]) / 2, z: (w.travel[1] + w.travel[3]) / 2 };
  const peaks = (w.overview.peaks ?? []).map(([x, z, size]) => ({ x, z, size })).filter((p) => p.size >= 3).sort((a, b) => chebyshev(a, middle) - chebyshev(b, middle) || a.x - b.x || a.z - b.z);
  for (const p of peaks) {
    const at = openWithin(p, Math.floor(p.size / 2) + 2);
    if (clear(at)) {
      out.push({ name: "range", at });
      break;
    }
  }
  for (const b of props.filter((p) => p.id === "bridge").sort((a, b) => a.x - b.x || a.z - b.z)) {
    const at = openWithin({ x: Math.floor(b.x), z: Math.floor(b.z) }, 3);
    if (clear(at)) {
      out.push({ name: "bridge", at });
      break;
    }
  }
  out.push({ name: "bank", at: ledgeBrink("new-benalia", true).at });
  return out;
}
