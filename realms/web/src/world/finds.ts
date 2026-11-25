import { type ChunkData, type TileData, type WorldData, CHUNK, chunkKey, isBlocked, noLedge, townAt } from "./format";

// The finds of the wilds (design.md A5, A3b): treasure chests and heartblooms, none kept in the world's files - they come
// and go. The server spawns them (Economy/Finds.cs) and says which stand (`GET /api/finds`); the offline stand-in
// (net/mockApi.ts) spawns its own by the same rules with this. Treasure chests: at most FIND_RULES.chestsPerZone in each
// tier zone of the wilds, a new one about every chestEvery seconds while a zone has fewer, crumbling after chestLasts
// unopened. Heartblooms: at most `heartblooms` in the world, HEARTBLOOM_APART tiles from each other, one about every
// heartbloomEvery, wilting after heartbloomLasts. A find stands on a random open tile of the wilds with open, level ground
// all round - never on worked ground (WORKED_GROUND), in a town, within AWAY_FROM_PLACES of a door, a way in, a person or
// a spawn point, within FIND_APART of another find, or within AWAY_FROM_PLAYERS of a player - and the first to take it has
// it, gone for all.

export type FindKind = "chest" | "heartbloom";

/** How the finds spawn: the server's defaults (RealmOptions.Finds). Times in seconds. */
export interface FindRules {
  readonly chestsPerZone: number;
  readonly chestEvery: number;
  readonly chestLasts: number;
  readonly heartblooms: number;
  readonly heartbloomEvery: number;
  readonly heartbloomLasts: number;
}

export const FIND_RULES: FindRules = { chestsPerZone: 2, chestEvery: 600, chestLasts: 1800, heartblooms: 8, heartbloomEvery: 1800, heartbloomLasts: 10_800 };

/** How near another find, tiles (Chebyshev), a find never spawns; how near another heartbloom one never grows. */
export const FIND_APART = 8;
export const HEARTBLOOM_APART = 150;
/** How near a player, and a door, a way in, a person or a spawn point, a find never spawns, tiles. */
export const AWAY_FROM_PLAYERS = 4;
export const AWAY_FROM_PLACES = 3;
/** The surfaces of worked ground - roads, streets, floors, fields - where no find spawns (RealmSpace.WorkedGround). */
export const WORKED_GROUND: ReadonlySet<string> = new Set(["road", "cobbles", "flagstones", "planks", "wheat", "furrows"]);
/** How many tiles a spawn tries before it waits for its next turn. */
const TRIES = 64;

/** A treasure chest's gold by its zone's tier (Finds.GoldOf): 50 to 500, richer the harder the wilds. */
export function goldOf(tier: number): readonly [number, number] {
  return tier <= 1 ? [50, 150] : tier === 2 ? [100, 250] : tier === 3 ? [180, 380] : [300, 500];
}

/** A find standing now: its id, kind, tile, its zone's tier, and when it appeared and goes (unix ms). */
export interface StandingFind {
  readonly id: string;
  readonly kind: FindKind;
  readonly x: number;
  readonly z: number;
  readonly tier: number;
  readonly since: number;
  readonly until: number;
}

/** The tier zone a tile is in: its index among the world's zone areas, or -1. */
export function zoneOf(world: WorldData, x: number, z: number): number {
  const zones = world.zones;
  const [ox, oz] = world.origin ?? [0, 0];
  const zone = zones.grid[Math.floor((z - oz) / zones.cell)]?.[Math.floor((x - ox) / zones.cell)];
  return zone !== undefined && zone >= 0 && zone < zones.areas.length ? zone : -1;
}

/** Reads a chunk of the world (null where there is none): the stand-in's loader. */
export type ChunkOf = (cx: number, cz: number) => Promise<ChunkData | null>;

/** The finds of the wilds as the offline stand-in spawns them, on its own clock and dice. */
export class FindSpawner {
  private readonly live = new Map<string, StandingFind>();
  private readonly nextChest = new Map<number, number>();
  private nextBloom: number | null = null;
  private count = 0;
  private readonly cells = new Map<number, [number, number][]>();

  constructor(
    private readonly world: WorldData,
    private readonly chunkOf: ChunkOf,
    private readonly random: () => number,
    private readonly rules: FindRules = FIND_RULES,
  ) {
    const zones = world.zones;
    zones.grid.forEach((row, r) =>
      row.forEach((zone, c) => {
        if (zone < 0 || (zones.areas[zone]?.tier ?? 0) <= 0) return;
        if (!this.cells.has(zone)) this.cells.set(zone, []);
        this.cells.get(zone)!.push([c, r]);
      }),
    );
  }

  /** The finds standing at a moment (unix ms), the world moved on to it first; `players` where the players stand. */
  async standing(now: number, players: readonly { x: number; z: number }[] = []): Promise<StandingFind[]> {
    await this.advance(now, players);
    return [...this.live.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** A find standing, or null: taken, gone, or never one. */
  get(id: string, now: number): StandingFind | null {
    const f = this.live.get(id);
    return f && f.until > now ? f : null;
  }

  /** Takes a find: true for the first to ask. */
  take(id: string): boolean {
    return this.live.delete(id);
  }

  /** Stands a find on a tile now, whatever the rules (the server's POST /dev/find), every other taken away first if `clear`. */
  place(kind: FindKind, x: number, z: number, now: number, clear = false): StandingFind {
    if (clear) this.live.clear();
    return this.add(kind, x, z, now);
  }

  private add(kind: FindKind, x: number, z: number, now: number): StandingFind {
    const zone = zoneOf(this.world, x, z);
    const tier = zone >= 0 ? (this.world.zones.areas[zone]?.tier ?? 0) : 0;
    const lasts = kind === "chest" ? this.rules.chestLasts : this.rules.heartbloomLasts;
    const find: StandingFind = { id: `${kind === "chest" ? "chest" : "bloom"}-${++this.count}`, kind, x, z, tier, since: now, until: now + lasts * 1000 };
    this.live.set(find.id, find);
    return find;
  }

  private spread(every: number, least: number, most: number): number {
    return every * 1000 * (least + this.random() * (most - least));
  }

  private async advance(now: number, players: readonly { x: number; z: number }[]): Promise<void> {
    for (const [id, f] of this.live) if (f.until <= now) this.live.delete(id);
    if (this.rules.chestsPerZone > 0) {
      for (const [zone, cells] of this.cells) {
        const next = this.nextChest.get(zone);
        if (next === undefined) {
          this.nextChest.set(zone, now + this.spread(this.rules.chestEvery, 0, 1));
          continue;
        }
        if (next > now) continue;
        this.nextChest.set(zone, now + this.spread(this.rules.chestEvery, 0.5, 1.5));
        const held = [...this.live.values()].filter((f) => f.kind === "chest" && zoneOf(this.world, f.x, f.z) === zone).length;
        if (held >= this.rules.chestsPerZone) continue;
        const at = await this.spot("chest", cells, players);
        if (at) this.add("chest", at.x, at.z, now);
      }
    }
    if (this.rules.heartblooms > 0) {
      if (this.nextBloom === null) this.nextBloom = now + this.spread(this.rules.heartbloomEvery, 0, 1);
      else if (this.nextBloom <= now) {
        this.nextBloom = now + this.spread(this.rules.heartbloomEvery, 0.5, 1.5);
        const held = [...this.live.values()].filter((f) => f.kind === "heartbloom").length;
        if (held < this.rules.heartblooms) {
          const at = await this.spot("heartbloom", [...this.cells.values()].flat(), players);
          if (at) this.add("heartbloom", at.x, at.z, now);
        }
      }
    }
  }

  /** A tile of the wilds for a find among cells of the zones, by the rules, or null if none was met in a few tries. */
  private async spot(kind: FindKind, cells: readonly [number, number][], players: readonly { x: number; z: number }[]): Promise<{ x: number; z: number } | null> {
    if (cells.length === 0) return null;
    const { cell } = this.world.zones;
    const [ox, oz] = this.world.origin ?? [0, 0];
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const [c, r] = cells[Math.floor(this.random() * cells.length)]!;
      const x = ox + c * cell + Math.floor(this.random() * cell);
      const z = oz + r * cell + Math.floor(this.random() * cell);
      if (townAt(this.world.towns, x, z)) continue;
      const apart = (o: { x: number; z: number }, reach: number) => Math.max(Math.abs(o.x - x), Math.abs(o.z - z)) < reach;
      if ([...this.live.values()].some((f) => apart(f, kind === "heartbloom" && f.kind === "heartbloom" ? HEARTBLOOM_APART : FIND_APART))) continue;
      if (players.some((p) => apart({ x: Math.floor(p.x), z: Math.floor(p.z) }, AWAY_FROM_PLAYERS))) continue;
      if (await this.fits(x, z)) return { x, z };
    }
    return null;
  }

  /** Whether a find may stand on a tile: open ground, not worked, level and open all round, nothing kept near it. */
  private async fits(x: number, z: number): Promise<boolean> {
    const chunks = new Map<string, ChunkData | null>();
    const chunk = async (tx: number, tz: number) => {
      const cx = Math.floor(tx / CHUNK);
      const cz = Math.floor(tz / CHUNK);
      const k = chunkKey(cx, cz);
      if (!chunks.has(k)) chunks.set(k, await this.chunkOf(cx, cz));
      return chunks.get(k) ?? null;
    };
    const tileAt = async (tx: number, tz: number): Promise<TileData | undefined> => {
      const c = await chunk(tx, tz);
      return c?.tiles[(tz - c.cz * CHUNK) * CHUNK + (tx - c.cx * CHUNK)];
    };
    const here = await tileAt(x, z);
    if (!here || isBlocked(here) || WORKED_GROUND.has(here[1])) return false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = await tileAt(x + dx, z + dz);
        if (!t || isBlocked(t) || !noLedge(here, t)) return false;
      }
    }
    // Nothing kept near: the doors, ways in, people and spawn points of the chunks round it.
    const near = (p: { x: number; z: number }) => Math.max(Math.abs(Math.floor(p.x) - x), Math.abs(Math.floor(p.z) - z)) <= AWAY_FROM_PLACES;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = await chunk(x + dx * CHUNK, z + dz * CHUNK);
        if (!c) continue;
        if (c.npcs.some(near) || c.spawns.some(near) || c.entrances.some(near) || c.buildings.some((b) => b.door && near({ x: b.door[0], z: b.door[1] }))) return false;
      }
    }
    return true;
  }
}
