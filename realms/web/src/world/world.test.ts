import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generate } from "../../scripts/worldgen/generate";
import { readLayout } from "../../scripts/worldgen/layout";
import { DIRECTIONS, distance, hex } from "../hex";
import { mobInfo } from "../mobs";
import {
  CHUNK,
  CHUNKS,
  type ChunkData,
  type DungeonData,
  type InteriorData,
  MAX_TIER,
  type WorldData,
  WORLD_SIZE,
  areaAt,
  townAt,
  validateChunk,
  validateDungeon,
  validateInterior,
} from "./schema";

// The world's content lint (interfaces.md, "The world, interiors and dungeons"): every file is good on its own, the
// whole world can be walked from every inn, every door has its interior and every entrance its dungeon, the tiers grow
// with distance from the starting areas and every spawn's matches its zone, the towns have their people - and the files
// are exactly what the seeded generator writes.

const plane = join(__dirname, "..", "..", "..", "content", "dominaria");
const readDir = <T>(dir: string): Map<string, T> =>
  new Map(readdirSync(join(plane, dir)).filter((f) => f.endsWith(".json")).sort().map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(plane, dir, f), "utf8")) as T]));

const world = JSON.parse(readFileSync(join(plane, "world", "world.json"), "utf8")) as WorldData;
const chunks = readDir<ChunkData>("world/chunks");
const interiors = readDir<InteriorData>("interiors");
const dungeons = readDir<DungeonData>("dungeons");
const vendors = readDir<{ id: string; name: string; town?: string; exotic?: boolean; trader?: { towns: string[] } }>("vendors");
const roster = readDir<{ id: string; tier: number; boss?: boolean }>("mobs");

function all<K extends "props" | "doors" | "npcs" | "spawns" | "chests" | "entrances">(field: K): ChunkData[K][number][] {
  return [...chunks.values()].flatMap((c) => [...c[field]] as ChunkData[K][number][]);
}
const open = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
for (const c of chunks.values()) for (const [q, r, , , b] of c.tiles) open[q * WORLD_SIZE + r] = b === 0 ? 1 : 0;
const isOpen = (q: number, r: number) => q >= 0 && r >= 0 && q < WORLD_SIZE && r < WORLD_SIZE && open[q * WORLD_SIZE + r] === 1;

describe("the world's files", () => {
  it("are every chunk of the world, each good on its own", () => {
    expect(chunks.size).toBe(CHUNKS * CHUNKS);
    const bad = [...chunks].map(([k, c]) => [k, validateChunk(c)] as const).filter(([, p]) => p.length > 0);
    expect(bad).toEqual([]);
  });

  it("have good interiors and dungeons", () => {
    expect([...interiors.values()].flatMap((room) => validateInterior(room).map((p) => `${room.id}: ${p}`))).toEqual([]);
    expect([...dungeons.values()].flatMap((d) => validateDungeon(d).map((p) => `${d.id}: ${p}`))).toEqual([]);
    for (const [file, room] of interiors) expect(room.id).toBe(file);
    for (const [file, d] of dungeons) expect(d.id).toBe(file);
  });

  it("can be walked whole from every inn: every open hex, and beside every person and chest", () => {
    const start = world.inns[0]!;
    const seen = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
    const queue = new Int32Array(WORLD_SIZE * WORLD_SIZE);
    let tail = 0;
    queue[tail++] = start.q * WORLD_SIZE + start.r;
    seen[start.q * WORLD_SIZE + start.r] = 1;
    for (let head = 0; head < tail; head++) {
      const q = Math.floor(queue[head]! / WORLD_SIZE);
      const r = queue[head]! % WORLD_SIZE;
      for (const d of DIRECTIONS) {
        const nq = q + d.q;
        const nr = r + d.r;
        if (isOpen(nq, nr) && !seen[nq * WORLD_SIZE + nr]) {
          seen[nq * WORLD_SIZE + nr] = 1;
          queue[tail++] = nq * WORLD_SIZE + nr;
        }
      }
    }
    const reached = (q: number, r: number) => seen[q * WORLD_SIZE + r] === 1;
    // One walkable whole: each inn reaches every open hex, so all inns reach each other.
    let openCount = 0;
    for (let i = 0; i < open.length; i++) openCount += open[i]!;
    expect(tail, "open hexes walked from the first inn").toBe(openCount);
    for (const inn of world.inns) expect(reached(inn.q, inn.r), inn.id).toBe(true);
    const beside = (p: { q: number; r: number }) => DIRECTIONS.some((d) => reached(p.q + d.q, p.r + d.r));
    for (const npc of all("npcs")) expect(beside(npc), `${npc.kind} ${npc.id}`).toBe(true);
    for (const chest of all("chests")) expect(beside(chest), `chest ${chest.id}`).toBe(true);
    for (const s of all("spawns")) expect(reached(s.q, s.r), `spawn ${s.id}`).toBe(true);
    for (const d of all("doors")) expect(reached(d.q, d.r), `door to ${d.interior}`).toBe(true);
    for (const e of all("entrances")) expect(reached(e.q, e.r), `entrance to ${e.dungeon}`).toBe(true);
  });

  it("have an interior behind every door, coming out beside it, in the town the door stands in", () => {
    const doors = all("doors");
    expect(new Set(doors.map((d) => d.interior)).size).toBe(interiors.size);
    for (const door of doors) {
      const room = interiors.get(door.interior);
      expect(room, door.interior).toBeDefined();
      expect(distance(door, room!.exit), `${door.interior}'s exit`).toBe(1);
      expect(isOpen(room!.exit.q, room!.exit.r)).toBe(true);
      expect(townAt(world.towns, door)?.id, `${door.interior}'s town`).toBe(room!.town);
    }
  });

  it("have a dungeon behind every entrance, as world.json places it, with a spell table beside it, and towers their waystones", () => {
    const entrances = all("entrances");
    expect(entrances.map((e) => e.dungeon).sort()).toEqual([...dungeons.keys()].sort());
    expect(world.dungeons.map((d) => d.id).sort()).toEqual([...dungeons.keys()].sort());
    const npcs = all("npcs");
    for (const e of entrances) {
      const d = dungeons.get(e.dungeon)!;
      expect([e.q, e.r]).toEqual([...d.entrance]);
      expect(world.dungeons.find((w) => w.id === d.id)).toMatchObject({ q: e.q, r: e.r });
      expect(npcs.some((n) => n.kind === "spell-table" && distance(n, e) === 1), `${d.id}'s spell table`).toBe(true);
      if (d.waystone) expect(npcs.some((n) => n.kind === "waystone" && n.tower === d.id && distance(n, e) === 1), `${d.id}'s waystone`).toBe(true);
      expect(DIRECTIONS.some((dir) => isOpen(e.q + dir.q, e.r + dir.r)), `ground beside ${d.id}`).toBe(true);
    }
  });

  it("name only mobs the roster has, each spawn's of its tier and matching its zone, and dungeons' warden and boss", () => {
    const tierOf = new Map([...roster.values()].map((m) => [m.id, m.tier]));
    for (const spawn of all("spawns")) {
      expect(spawn.tier, `spawn ${spawn.id} is its zone's tier`).toBe(areaAt(world.zones, spawn)?.tier);
      for (const mob of spawn.mobs) {
        expect(tierOf.get(mob), `${spawn.id}: ${mob}`).toBe(spawn.tier);
        expect(mobInfo(mob).known).toBe(true);
      }
    }
    for (const d of dungeons.values()) {
      const lists = Array.isArray(d.mobs[0]) ? (d.mobs as string[][]) : [d.mobs as string[]];
      // A tower's mage is the roster's `mage-<tower>`.
      for (const mob of [...lists.flat(), d.warden, d.boss]) expect(roster.has(mob), `${d.id}: ${mob}`).toBe(true);
      if (d.waystone) expect(d.boss).toBe(`mage-${d.id}`);
    }
    // Every mob of the roster is met somewhere, as the server's content check asks.
    const met = new Set([...all("spawns").flatMap((s) => s.mobs), ...[...dungeons.values()].flatMap((d) => [...(d.mobs as (string | string[])[]).flat(), d.warden, d.boss])]);
    expect([...roster.keys()].filter((id) => !met.has(id)), "mobs nobody meets").toEqual([]);
  });

  it("grow harder with distance from the starting areas, and mark where the tier rises", () => {
    const starts = world.towns.filter((t) => t.start).map((t) => ({ at: hex(t.center[0], t.center[1]), radius: t.radius }));
    const from = (h: { q: number; r: number }) => Math.min(...starts.map((s) => distance(h, s.at) - s.radius));
    const spawns = all("spawns");
    const mean = (tier: number) => {
      const of = spawns.filter((s) => s.tier === tier).map(from);
      expect(of.length, `tier ${tier} spawns`).toBeGreaterThan(20);
      return of.reduce((a, b) => a + b, 0) / of.length;
    };
    const means = Array.from({ length: MAX_TIER }, (_, i) => mean(i + 1));
    // Tiers 1-3 by distance; tier 4 is also the hardest lands wherever they are (the waste beside Keld, the Ironclaw
    // Mountains: a region's minTier), so it lies farther out than 1 and 2, not always than 3.
    for (let t = 1; t < MAX_TIER - 1; t++) expect(means[t]!, `tier ${t + 1} lies farther out than tier ${t}`).toBeGreaterThan(means[t - 1]!);
    expect(means[3]!, "tier 4 lies farther out than tiers 1 and 2").toBeGreaterThan(Math.max(means[0]!, means[1]!));
    // Round every starting area the wilds are tier 1 but where a hardest land comes near (the waste by Keld).
    const near = spawns.filter((sp) => starts.some((s) => distance(sp, s.at) < s.radius + 25));
    expect(near.filter((sp) => sp.tier === 1).length / near.length, "tier 1 by the starting areas").toBeGreaterThan(0.75);
    // Every waymarker stands on the harder side of a boundary, in that side's tier.
    for (const m of all("props").filter((p) => p.kind === "waymarker")) {
      const here = areaAt(world.zones, m)?.tier ?? 0;
      expect(m.tier, `waymarker at ${m.q},${m.r}`).toBe(here);
      let softer = false;
      for (const d of DIRECTIONS) for (const e of DIRECTIONS) softer ||= (areaAt(world.zones, { q: m.q + d.q + e.q, r: m.r + d.r + e.r })?.tier ?? 0) < here;
      expect(softer, `waymarker at ${m.q},${m.r} stands at a boundary`).toBe(true);
    }
  });

  it("give every town its people: vendors in their shops, the inn's keeper and spell table, the armorer in the smithy, the quest board outside", () => {
    const people = [...interiors.values()].flatMap((room) => room.npcs.map((n) => ({ ...n, room })));
    for (const v of vendors.values()) {
      const at = people.find((n) => n.kind === "vendor" && n.vendor === v.id);
      if (v.trader) {
        // A traveling trader keeps no shop: its caravan stands at the pitch of each town it visits.
        expect(at, `${v.id} keeps no shop`).toBeUndefined();
        for (const town of v.trader.towns) expect(world.pitches.some((p) => p.town === town), `${v.id}'s pitch in ${town}`).toBe(true);
        continue;
      }
      expect(at, `${v.id}'s shop`).toBeDefined();
      expect(at!.room.town).toBe(v.town);
      expect(at!.room.kind).toBe("shop");
      expect(interiors.get(`${v.id}-shop`), `${v.id}-shop`).toBe(at!.room);
    }
    for (const town of world.towns) {
      const inn = world.inns.find((i) => i.town === town.id)!;
      const room = interiors.get(inn.interior)!;
      expect(room.kind).toBe("inn");
      expect(room.npcs.map((n) => n.kind)).toEqual(expect.arrayContaining(["innkeeper", "spell-table"]));
      expect([inn.q, inn.r]).toEqual([room.exit.q, room.exit.r]);
      expect(all("npcs").some((n) => n.kind === "quest-board" && distance(n, inn) <= 8), `${town.id}'s quest board`).toBe(true);
      if (town.kind !== "village") {
        expect(people.some((n) => n.kind === "armorer" && n.room.town === town.id && n.room.kind === "smithy"), `${town.id}'s armorer`).toBe(true);
        expect(people.some((n) => n.kind === "spell-table" && n.room.town === town.id && n.room.kind === "guildhall"), `${town.id}'s mages' guild`).toBe(true);
      }
    }
  });

  it("have ferries whose lanes run open from dock to dock, a ferryman at each end, and caravan pitches open in their towns", () => {
    const npcs = all("npcs");
    expect(world.ferries.length).toBeGreaterThan(0);
    for (const f of world.ferries) {
      expect(f.lane[0]).toEqual(f.from);
      expect(f.lane.at(-1)).toEqual(f.to);
      for (let k = 1; k < f.lane.length; k++) expect(distance(hex(...f.lane[k - 1]!), hex(...f.lane[k]!)), `${f.id}'s lane`).toBe(1);
      for (const [q, r] of f.lane) expect(isOpen(q, r), `${f.id}'s lane at ${q},${r}`).toBe(true);
      for (const end of [f.from, f.to]) expect(npcs.some((n) => n.kind === "ferryman" && n.ferry === f.id && distance(n, hex(...end)) === 1), `${f.id}'s ferryman`).toBe(true);
    }
    for (const p of world.pitches) {
      expect(isOpen(p.q, p.r), `${p.town}'s pitch`).toBe(true);
      expect(townAt(world.towns, p)?.id).toBe(p.town);
    }
  });

  it("are exactly what the seeded generator writes from the layout and the roster", () => {
    const layout = readLayout();
    const rosterFiles = [...roster.values()] as Parameters<typeof generate>[1];
    const result = generate(layout, rosterFiles, [...vendors.values()]);
    const differing: string[] = [];
    for (const [path, text] of result.files) {
      if (readFileSync(join(plane, path), "utf8").replace(/\r\n/g, "\n") !== text) differing.push(path);
    }
    expect(differing, "files a rerun of `npm run world` would change").toEqual([]);
    expect(result.files.size).toBe(chunks.size + interiors.size + dungeons.size + 1);
    void CHUNK;
  }, 60_000);
});
