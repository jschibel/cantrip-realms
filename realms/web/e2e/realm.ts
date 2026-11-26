import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect } from "@playwright/test";
import { CHUNK, type ChunkData, type DungeonData, type InteriorData, type WorldData, chunkKey, chunkTile, isBlocked, isHop, noLedge } from "../src/world/format";

// The realm's page as the tests drive it, on the manual clock: everything is read from globalThis.realmTest
// (src/testHooks.ts), every action is a real mouse click at the place it publishes, and time moves only when a test
// advances it. Where a test starts is planned from the generated Domains' files (realms/content/dominaria).

export interface Tile {
  readonly x: number;
  readonly z: number;
}

export interface Entity {
  readonly name: string;
  readonly kind: string;
  readonly id: string;
  readonly tile: Tile;
  readonly x: number;
  readonly y: number;
  readonly to?: string;
  readonly spawn?: string;
  readonly tier?: number;
  readonly role?: string | null;
  readonly moving?: boolean;
}

export interface Control {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/** The pinned spawn clock every test plays at, so a spawn's mob is the same on every run. */
export const NOW = 1763856000;

/** A morning hour of the same day, when the traveling traders' first caravans are in town (07:00 UTC: their 06:00 visits). */
export const TRADERS_IN = NOW + 7 * 3600;

export const chebyshev = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** Opens the offline overworld on the manual clock with a made character, at a place; `now` pins the clock elsewhere. */
export async function openRealm(page: Page, options: { at: string; name?: string; color?: string; extra?: string; now?: number }): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const query = `offline&test&manual&name=${options.name ?? "Tester"}&color=${options.color ?? "W"}&now=${options.now ?? NOW}&wander=0&at=${options.at}${options.extra ?? ""}`;
  await page.goto(`/?${query}`);
  await waitReady(page);
  await advance(page, 0.5);
  return errors;
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (globalThis as any).realmTest?.ready === true, undefined, { timeout: 60_000 });
}

/** Moves the page's clock on (with ?manual), a sixtieth at a time. */
export const advance = (page: Page, seconds: number): Promise<void> => page.evaluate((s) => (globalThis as any).realmTest.advance(s), seconds);

/** Reads a property of realmTest by its path ("space.id", "layer"). */
export const realm = <T>(page: Page, read: string): Promise<T> =>
  page.evaluate((r) => r.split(".").reduce((o: any, k) => o?.[k], (globalThis as any).realmTest), read) as Promise<T>;

/** Advances the clock until `check` holds, a fifth of a second at a time, for at most `seconds` of game time. */
export async function until(page: Page, check: () => Promise<boolean>, what: string, seconds = 30): Promise<void> {
  for (let t = 0; t <= seconds; t += 0.2) {
    if (await check()) return;
    await advance(page, 0.2);
  }
  const said = await realm<string[]>(page, "messages").catch(() => []);
  expect(await check(), `${what} (the page said: ${JSON.stringify(said?.slice(-4) ?? [])})`).toBe(true);
}

export const entities = (page: Page) => realm<Entity[]>(page, "entities");

/** An entity, once there is one (the clock moving on while it is looked for). */
export async function entity(page: Page, match: (e: Entity) => boolean, what: string, seconds = 10): Promise<Entity> {
  let found: Entity | undefined;
  await until(page, async () => (found = (await entities(page)).find(match)) !== undefined, what, seconds);
  return found!;
}

export const player = (page: Page) => entity(page, (e) => e.kind === "player", "the player");

export async function playerTile(page: Page): Promise<Tile> {
  return (await player(page)).tile;
}

export async function control(page: Page, name: string): Promise<Control> {
  let found: Control | undefined;
  await expect
    .poll(async () => {
      found = (await realm<Control[]>(page, "controls")).find((c) => c.name === name);
      return found !== undefined;
    }, { message: `control ${name}` })
    .toBe(true);
  return found!;
}

export async function clickControl(page: Page, name: string): Promise<void> {
  const c = await control(page, name);
  await page.mouse.click(c.x, c.y);
}

/** Clicks a tile of the current place. */
export async function clickTile(page: Page, x: number, z: number): Promise<void> {
  const at = await page.evaluate(([a, b]) => (globalThis as any).realmTest.screenOfTile(a, b), [x, z] as const);
  await page.mouse.click(at.x, at.y);
}

/** Waits (on the game's clock) until the player stands still. */
export async function stopped(page: Page, seconds = 30): Promise<void> {
  await until(page, async () => !(await player(page)).moving, "the player stops", seconds);
}

export async function waitSpace(page: Page, id: string | RegExp, seconds = 20): Promise<void> {
  await until(
    page,
    async () => {
      const here = (await realm<string | undefined>(page, "space.id")) ?? "";
      return (typeof id === "string" ? here === id : id.test(here)) && !(await realm<boolean>(page, "transitioning"));
    },
    `in ${id}`,
    seconds,
  );
}

/**
 * Walks the current place toward a tile by clicks a few tiles along the grid's path at a time (never onto anyone,
 * which a click would use), until within `near` of it. A duel a mob starts on the way is won.
 */
export async function walkTo(page: Page, goal: Tile, near = 0, avoid: (t: Tile) => boolean = () => false): Promise<void> {
  for (let tries = 0; tries < 60; tries++) {
    if ((await realm<string | null>(page, "layer.open")) !== null) await winDuel(page);
    await stopped(page);
    const from = await playerTile(page);
    if (chebyshev(from, goal) <= near) return;
    // Toward the goal; past the grid the chunks read hold (a far goal), toward a tile on the way there.
    let path: Tile[] | null = null;
    for (const reach of [Infinity, 24, 12, 6]) {
      const d = chebyshev(from, goal);
      const k2 = Math.min(1, reach / Math.max(1, d));
      const aim = { x: Math.round(from.x + (goal.x - from.x) * k2), z: Math.round(from.z + (goal.z - from.z) * k2) };
      path = (await page.evaluate(([x, z]) => (globalThis as any).realmTest.pathTo(x, z), [aim.x, aim.z] as const)) as Tile[] | null;
      if (path && path.length > 0) break;
    }
    expect(path, `a way from ${from.x},${from.z} to ${goal.x},${goal.z}`).not.toBeNull();
    const busy = new Set((await entities(page)).filter((e) => e.kind !== "player").map((e) => `${e.tile.x},${e.tile.z}`));
    let k = Math.min(7, path!.length - 1);
    while (k > 0 && (busy.has(`${path![k]!.x},${path![k]!.z}`) || avoid(path![k]!))) k--;
    if (k <= 0) return;
    const step = path![k]!;
    // The stage's click on the tile (a long walk's steps may be behind a roof on the page, where a click would pick it).
    await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [step.x, step.z] as const);
    await advance(page, 0.2);
    await until(page, async () => (await realm<string | null>(page, "layer.open")) !== null || !(await player(page)).moving, "the walk ends", 20);
  }
  expect(chebyshev(await playerTile(page), goal), `walked to within ${near} of ${goal.x},${goal.z}`).toBeLessThanOrEqual(near);
}

/**
 * A point on the page where a click lands on `e` itself, as the stage picks it (realmTest.figureAt): on its own figure for
 * one that has a figure (a person, a mob: the entities that say whether they are `moving`), and for a thing that has none
 * (a board, a table, a chest) a point of it with no figure in front - a guard walking his round, an NPC passing, a
 * wanderer - which would take the click and answer it (a remark, a duel) in its place. Null when no point is clear now.
 */
async function clearSpot(page: Page, e: Entity): Promise<{ x: number; y: number } | null> {
  const figure = e.moving !== undefined;
  const offsets = figure ? [[0, 0], [0, -10], [0, 8], [-6, -4], [6, -4], [0, -18]] : [[0, 0], [0, -4], [-4, 0], [4, 0], [0, 4]];
  for (const [dx, dy] of offsets) {
    const at = { x: e.x + dx!, y: e.y + dy! };
    const hit = await page.evaluate(([x, y]) => (globalThis as any).realmTest.figureAt(x, y) as Tile | null, [at.x, at.y] as const);
    if (figure ? hit !== null && hit.x === e.tile.x && hit.z === e.tile.z : hit === null) return at;
  }
  return null;
}

/**
 * Clicks an entity where nothing stands in front of it (clearSpot), waiting on the game's clock for whoever is in the
 * way to walk on; after a few seconds of it, where it is.
 */
export async function clickClear(page: Page, match: (e: Entity) => boolean, what: string): Promise<Entity> {
  for (let tries = 0; ; tries++) {
    const e = await entity(page, match, what);
    // A card screen opened meanwhile (a mob came for the player while they waited): the world takes no click now.
    if (tries > 0 && (await realm<string | null>(page, "layer.open")) !== null) return e;
    const spot = await clearSpot(page, e);
    if (spot || tries >= 24) {
      await page.mouse.click(spot?.x ?? e.x, spot?.y ?? e.y);
      return e;
    }
    await advance(page, 0.25);
  }
}

/** Clicks an entity, once the view has settled on it, where no one else stands in front of it. */
export async function clickEntity(page: Page, match: (e: Entity) => boolean, what: string): Promise<Entity> {
  await advance(page, 0.6);
  return clickClear(page, match, what);
}

/**
 * Wins the duel the stand-in card layer has open, and closes the gear found; and any duel that follows at once (another
 * mob that reached the player while the gear was shown), until the world goes on.
 */
export async function winDuel(page: Page): Promise<void> {
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "a duel", 20);
  await clickControl(page, "layer:win");
  await until(
    page,
    async () => {
      const open = await realm<string | null>(page, "layer.open");
      if (open === "loot" || open === "duel") {
        await clickControl(page, open === "loot" ? "layer:close" : "layer:win");
        return false;
      }
      // A boss's moment (the color it unlocks) is left open for the test to see.
      const screen = await realm<string>(page, "screen");
      return (screen === "world" && !(await realm<boolean>(page, "paused"))) || screen === "boss";
    },
    "back in the world after the duel",
    30,
  );
}

// --- The world's files --------------------------------------------------------------------------------------------------

const plane = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "dominaria");
const read = <T>(path: string): T => JSON.parse(readFileSync(join(plane, path), "utf8")) as T;

let worldFile: WorldData | null = null;
export const world = (): WorldData => (worldFile ??= read<WorldData>("world/world.json"));
export const dungeon = (id: string): DungeonData => read<DungeonData>(`dungeons/${id}.json`);
export const interior = (id: string): InteriorData => read<InteriorData>(`interiors/${id}.json`);

const chunks = new Map<string, ChunkData | null>();
export function chunk(cx: number, cz: number): ChunkData | null {
  const k = chunkKey(cx, cz);
  if (!chunks.has(k)) {
    try {
      chunks.set(k, read<ChunkData>(`world/chunks/${k}.json`));
    } catch {
      chunks.set(k, null);
    }
  }
  return chunks.get(k)!;
}

export const chunkAt = (t: Tile): ChunkData | null => chunk(Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK));

let lanes: Set<string> | null = null;

/** Whether a world tile is open ground with nothing on it that walking onto would use (a door, an entrance, a lane). */
export function openWorld(t: Tile): boolean {
  lanes ??= new Set(world().ferries.flatMap((f) => f.lane.slice(1, -1).map(([x, z]) => `${x},${z}`)));
  if (lanes.has(`${t.x},${t.z}`)) return false;
  const c = chunkAt(t);
  if (!c || isBlocked(chunkTile(c, t.x, t.z))) return false;
  if (c.entrances.some((e) => e.x === t.x && e.z === t.z)) return false;
  if (c.buildings.some((b) => b.door && b.door[0] === t.x && b.door[1] === t.z)) return false;
  return !c.npcs.some((n) => n.x === t.x && n.z === t.z) && !c.spawns.some((s) => s.x === t.x && s.z === t.z);
}

/** No ledge between two side-by-side world tiles (format.ts LEDGE): what a step of the grid's never crosses. */
export function noLedgeWorld(a: Tile, b: Tile): boolean {
  const ca = chunkAt(a);
  const cb = chunkAt(b);
  return !ca || !cb || noLedge(chunkTile(ca, a.x, a.z), chunkTile(cb, b.x, b.z));
}

/** A hop between two side-by-side world tiles (format.ts HOP): a ledge a player hops straight across. */
export function hopWorld(a: Tile, b: Tile): boolean {
  const ca = chunkAt(a);
  const cb = chunkAt(b);
  return !!ca && !!cb && isHop(chunkTile(ca, a.x, a.z), chunkTile(cb, b.x, b.z));
}

/**
 * An open tile about `steps` from `target` (Chebyshev), reached from it over open tiles as a player walks (eight ways, no
 * cut corner, no ledge stepped over but a hop straight across).
 */
export function openNear(target: Tile, steps: number, open: (t: Tile) => boolean = openWorld): Tile {
  const key = (t: Tile) => `${t.x},${t.z}`;
  const seen = new Set([key(target)]);
  let ring: Tile[] = [target];
  let best: Tile | null = null;
  for (let d = 0; d < steps + 40 && ring.length > 0; d++) {
    const next: Tile[] = [];
    for (const t of ring) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = { x: t.x + dx, z: t.z + dz };
          if ((!dx && !dz) || seen.has(key(n)) || !open(n)) continue;
          const a = { x: t.x + dx, z: t.z };
          const b = { x: t.x, z: t.z + dz };
          if (!dx || !dz) {
            if (!noLedgeWorld(t, n) && !hopWorld(t, n)) continue;
          } else if (!(open(a) && open(b) && noLedgeWorld(t, a) && noLedgeWorld(a, n) && noLedgeWorld(t, b) && noLedgeWorld(b, n))) continue;
          seen.add(key(n));
          next.push(n);
        }
      }
    }
    next.sort((a, b) => a.x - b.x || a.z - b.z);
    const far = next.filter((n) => chebyshev(n, target) >= steps);
    if (far[0]) return far[0];
    if (next[0]) best = next.reduce((b, n) => (chebyshev(n, target) > chebyshev(b, target) ? n : b), next[0]);
    ring = next;
  }
  if (best) return best;
  // Shut in (a tree's tile in a wood, a rock): the nearest open tile at all.
  for (let r = 1; r < 60; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = { x: target.x + dx, z: target.z + dz };
        if (Math.max(Math.abs(dx), Math.abs(dz)) === r && open(t)) return t;
      }
    }
  }
  throw new Error(`nowhere open near ${target.x},${target.z}`);
}

/** The `at` of a world tile, for openRealm. */
export const at = (t: Tile): string => `world:${t.x},${t.z}`;
