import { type Page, expect, test } from "@playwright/test";
import type { SpawnData } from "../src/world/format";
import { hops, spawnNear, townSpot, travelSpawns } from "./places";
import { type Tile, advance, at, chebyshev, clickClear, clickControl, entities, openNear, openRealm, playerTile, realm, until, waitReady, world } from "./realm";

// Duels in the Domains: the card layer is absent here; its stand-in (?offline uses it) records every request, and these
// tests assert the duel requests through it, then answer them with its buttons. A wanderer of the travel map chasing a
// player down, and one that does not hop stopping at a bank's brink. A loss and its hearts are hearts.spec.ts.

const spawn = spawnNear("new-benalia");
/** How near a wanderer gives chase (entities.ts CHASE_RANGE). */
const CHASE_RANGE = 6;

async function engage(page: Page): Promise<void> {
  await openRealm(page, { at: at(openNear(spawn, 4)) });
  // A click on the spawn's mob (which may come for you first, being near).
  let clicked = false;
  await until(
    page,
    async () => {
      if ((await realm<string | null>(page, "layer.open")) === "duel") return true;
      const mob = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === spawn.id);
      if (mob && !clicked) {
        await clickClear(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
        clicked = true;
      }
      return false;
    },
    "the duel opens",
    30,
  );
  const requests = await realm<{ screen: string; args: Record<string, any> }[]>(page, "layer.requests");
  const duel = requests.find((r) => r.screen === "duel")!;
  expect(spawn.mobs).toContain(duel.args.mob.id);
  expect(duel.args.mob).toMatchObject({ map: "world", spawn: spawn.id });
  expect(duel.args.duel).toMatchObject({ Game: 1, FirstPlayer: null });
  expect(duel.args.hearts).toEqual({ have: 2, hold: 2 });
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.find((c) => c.name === "startEncounter")?.body).toEqual({ Spawn: spawn.id, Mob: duel.args.mob.id });
}

test("a wanderer of the travel map gives chase to a player standing near and starts the duel itself", async ({ page }) => {
  // A few tiles from its spawn, inside the chase's reach (entities.ts CHASE_RANGE): the player stands still.
  const start = openNear(spawn, 4);
  await openRealm(page, { at: at(start) });
  expect(world().travel && start.x < world().travel![2], "on the travel map").toBe(true);
  const first = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === spawn.id);
  expect(first, "the spawn's mob").toBeDefined();
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "the mob comes and the duel opens", 30);
  const duel = (await realm<{ screen: string; args: Record<string, any> }[]>(page, "layer.requests")).find((r) => r.screen === "duel")!;
  expect(duel.args.mob).toMatchObject({ map: "world", spawn: spawn.id });
  // The mob came to the player, who never moved.
  expect(await playerTile(page)).toEqual(start);
  const mob = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === spawn.id)!;
  expect(chebyshev(mob.tile, start)).toBeLessThanOrEqual(1);
  expect(chebyshev(first!.tile, start)).toBeGreaterThan(1);
});

test("a wanderer that does not hop gives up the chase at the brink of a bank a level high", async ({ page }) => {
  test.setTimeout(240_000);
  // Wanderers of the travel map whose spawns hold a mob that does not hop (its file's `hops`), nearest New Benalia's icon
  // first; the first whose mob at the pinned clock does not hop, with a tile in its reach a hopper gets to from it and it
  // does not (across a bank a level high, the ramps round it far), is the one: the player stands there.
  const { centre } = townSpot("new-benalia");
  const candidates = travelSpawns()
    .filter((s) => s.mobs.some((m) => !hops(m)))
    .sort((a, b) => chebyshev(a, centre) - chebyshev(b, centre) || a.x - b.x || a.z - b.z);
  let found: { spawn: SpawnData; mob: string; stand: Tile } | null = null;
  for (const s of candidates) {
    await openRealm(page, { at: at(openNear(s, 1)) });
    const mob = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === s.id);
    if (!mob || hops(mob.id)) continue;
    // A tile within its reach that a hopper walks to from where it stands and it does not, nor to any tile beside it.
    const stand = await page.evaluate(([mx, mz, reach]) => {
      const g = (globalThis as any).sliceStage.current.grid;
      const from = { x: mx, z: mz };
      for (let r = 2; r <= reach; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const t = { x: mx + dx, z: mz + dz };
            if (!g.walkable(t.x, t.z)) continue;
            const hopper = g.path(from, t, true);
            if (!hopper || hopper.length > 3 * r) continue;
            let near = false;
            for (let ez = -1; ez <= 1 && !near; ez++) for (let ex = -1; ex <= 1 && !near; ex++) near = g.walkable(t.x + ex, t.z + ez) && g.path(from, { x: t.x + ex, z: t.z + ez }, false) !== null;
            if (!near) return t;
          }
        }
      }
      return null;
    }, [mob.tile.x, mob.tile.z, CHASE_RANGE - 1] as const);
    if (stand) {
      found = { spawn: s, mob: mob.id, stand };
      break;
    }
  }
  expect(found, "a wanderer that does not hop, with a bank in its reach").not.toBeNull();
  await openRealm(page, { at: at(found!.stand) });
  const before = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === found!.spawn.id)!;
  expect(before.id).toBe(found!.mob);
  // It gives chase as far as it can go - the brink - and no further: never across a ledge it does not hop, and no duel,
  // for twenty seconds.
  const steps: Tile[] = [before.tile];
  for (let i = 0; i < 100; i++) {
    await advance(page, 0.2);
    expect(await realm<string | null>(page, "layer.open"), "no duel across the bank").toBeNull();
    const m = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === found!.spawn.id)!;
    const last = steps.at(-1)!;
    if (m.tile.x !== last.x || m.tile.z !== last.z) {
      const ok = await page.evaluate(([ax, az, bx, bz]) => (globalThis as any).sliceStage.current.grid.canStep({ x: ax, z: az }, { x: bx, z: bz }, false), [last.x, last.z, m.tile.x, m.tile.z] as const);
      expect(ok, `${found!.mob} stepped ${last.x},${last.z} to ${m.tile.x},${m.tile.z}`).toBe(true);
      steps.push(m.tile);
    }
  }
  expect(await playerTile(page)).toEqual(found!.stand);
  // It came nearer, as near as it can go - no tile it walks to from its spawn is nearer the player - and stands at the
  // bank's brink (or foot): ground a ledge up or down beside it.
  const last = steps.at(-1)!;
  expect(chebyshev(last, found!.stand), `${found!.mob} came nearer than its spawn`).toBeLessThan(chebyshev(before.tile, found!.stand));
  const { nearest, atBank } = await page.evaluate(([sx, sz, px, pz, lx, lz, reach]) => {
    const g = (globalThis as any).sliceStage.current.grid;
    const d = (x: number, z: number) => Math.max(Math.abs(x - px), Math.abs(z - pz));
    const seen = new Set([`${sx},${sz}`]);
    let ring = [{ x: sx, z: sz }];
    let nearest = d(sx, sz);
    while (ring.length > 0) {
      const next: { x: number; z: number }[] = [];
      for (const t of ring) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const n = { x: t.x + dx, z: t.z + dz };
            if ((!dx && !dz) || seen.has(`${n.x},${n.z}`) || Math.max(Math.abs(n.x - sx), Math.abs(n.z - sz)) > reach || !g.walkable(n.x, n.z) || !g.canStep(t, n, false)) continue;
            seen.add(`${n.x},${n.z}`);
            next.push(n);
            nearest = Math.min(nearest, d(n.x, n.z));
          }
        }
      }
      ring = next;
    }
    let atBank = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) atBank ||= Math.abs(g.heightAt(lx + dx, lz + dz) - g.heightAt(lx, lz)) > 0.25 + 1e-6;
    return { nearest, atBank };
  }, [before.tile.x, before.tile.z, found!.stand.x, found!.stand.z, last.x, last.z, CHASE_RANGE + 2] as const);
  expect(chebyshev(last, found!.stand), `${found!.mob} stopped at ${last.x},${last.z}, as near as it can go`).toBe(nearest);
  expect(atBank, `${found!.mob} stopped at ${last.x},${last.z}, at a bank`).toBe(true);
});

test("engaging a wanderer asks for a duel; winning pays gold and the mob is gone", async ({ page }) => {
  await engage(page);
  await clickControl(page, "layer:win");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "back in the world");
  const calls = (await realm<{ name: string }[]>(page, "api")).map((c) => c.name);
  expect(calls).toEqual(expect.arrayContaining(["startEncounter", "finishEncounter"]));
  expect((await realm<{ kind: string; spawn?: string }[]>(page, "entities")).some((e) => e.kind === "mob" && e.spawn === spawn.id)).toBe(false);
  expect((await realm<string[]>(page, "messages")).some((m) => /You defeated .*: \d+ gold\./.test(m))).toBe(true);
  expect((await realm<{ screen: string }[]>(page, "layer.requests")).some((r) => r.screen === "loot")).toBe(false);
});
