import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Vendor, generate } from "../../scripts/worldgen/generate";
import { PLACEHOLDERS } from "../../scripts/worldgen/ids";
import { readLayout } from "../../scripts/worldgen/layout";
import { roomProblems } from "../../scripts/worldgen/rooms";
import type { MobFile } from "../../scripts/worldgen/wilds";
import { BUILDINGS } from "../art/buildings";
import { FIGURES } from "../art/figures";
import { PALETTES } from "../art/paint/palette";
import { PROPS } from "../art/props";
import { ROOMS } from "../art/rooms";
import { SURFACES } from "../art/surfaces";
import { type ChunkData, type DungeonData, type InteriorData, RAMP, type WorldData, chunkKey, frontStep, isBlocked, parseChunkKey, tierAt, townAt } from "./format";
import { type KnownArt, type UnknownKind, checkChunk, checkInterior, checkWorld, lintRealm } from "./lint";
import { gridOfChunks } from "./load";

// Dominaria as checked in (realms/content/dominaria: world/, interiors/, dungeons/): every file good on its own and named
// for what it holds, the whole realm lint clean (world/lint.ts, `lintRealm`) against the art's registries - an id the art
// has not made yet named, and one of the generator's documented placeholders (scripts/worldgen/ids.ts) - walked from
// chunk to chunk, every town with its people, and every file exactly what the seeded generator writes.

const plane = join(__dirname, "..", "..", "..", "content", "dominaria");
const readDir = <T>(dir: string): Map<string, T> =>
  new Map(
    readdirSync(join(plane, dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(plane, dir, f), "utf8")) as T]),
  );

const world = JSON.parse(readFileSync(join(plane, "world", "world.json"), "utf8")) as WorldData;
const chunkFiles = readDir<ChunkData>("world/chunks");
const chunks = [...chunkFiles.values()];
const interiors = readDir<InteriorData>("interiors");
const dungeons = readDir<DungeonData>("dungeons");
const roster = readDir<MobFile & { tier: number }>("mobs");
const vendors = readDir<Vendor & { trader?: { towns: string[] } }>("vendors");
const all = <K extends "props" | "buildings" | "npcs" | "spawns" | "chests" | "entrances" | "waymarkers">(k: K): ChunkData[K][number][] =>
  chunks.flatMap((c) => [...c[k]] as ChunkData[K][number][]);

const unknown = new Map<UnknownKind, Set<string>>();
const known: KnownArt = {
  surfaces: new Set(SURFACES.ids()),
  props: new Set(PROPS.ids()),
  styles: new Set(BUILDINGS.ids()),
  rooms: new Set(ROOMS.ids()),
  figures: new Set(FIGURES.ids()),
  palettes: new Set(PALETTES.keys()),
  propProblems: (p) => PROPS.problems(p.id, p),
  buildingProblems: (b) => BUILDINGS.problems(b.style, b),
  onUnknown: (kind, id) => {
    let found = unknown.get(kind);
    if (!found) unknown.set(kind, (found = new Set()));
    found.add(id);
  },
};

describe("Dominaria's files", () => {
  it("are every chunk of the world, each named for the tiles it holds and good on its own", () => {
    expect(checkWorld(world)).toEqual([]);
    expect((world.size[0] % 32) + (world.size[1] % 32)).toBe(0);
    expect(chunkFiles.size).toBe((world.size[0] / 32) * (world.size[1] / 32));
    const bad: string[] = [];
    for (const [name, c] of chunkFiles) {
      const at = parseChunkKey(name);
      if (!at) bad.push(`${name}: no chunk's name`);
      else bad.push(...checkChunk(c, at.cx, at.cz));
    }
    for (const [name, room] of interiors) bad.push(...checkInterior(room, name), ...roomProblems(room).map((p) => `${name}: ${p}`));
    for (const [name, d] of dungeons) if (d.id !== name) bad.push(`dungeons/${name}.json holds ${d.id}`);
    expect(bad).toEqual([]);
  });

  it("lint clean as a realm, naming only the art ids the generator documents as placeholders", () => {
    const tiers = new Map([...roster.values()].map((m) => [m.id, m.tier]));
    expect(lintRealm(world, chunks, [...interiors.values()], [...dungeons.values()], { known, tiers })).toEqual([]);
    const kinds: Record<UnknownKind, keyof typeof PLACEHOLDERS | null> = { surface: "surfaces", prop: "props", style: "styles", room: "rooms", figure: "figures", palette: null };
    const undocumented: string[] = [];
    for (const [kind, ids] of unknown) {
      const list = kinds[kind];
      for (const id of ids) if (!list || !(id in PLACEHOLDERS[list])) undocumented.push(`${kind} ${id}`);
    }
    expect(undocumented, "ids neither the art has nor ids.ts documents").toEqual([]);
    // What the art has yet to make, for the record.
    console.log(`placeholders still named: ${[...unknown].map(([k, ids]) => `${k}s ${[...ids].sort().join(" ")}`).join("; ")}`);
  });

  it("is walked across chunk edges as one ground", () => {
    // From the capital's inn door to a door two chunks away, with only the chunks round the inn loaded.
    const inn = world.inns.find((i) => i.town === "new-benalia")!;
    const cx = Math.floor(inn.x / 32);
    const cz = Math.floor(inn.z / 32);
    const near = chunks.filter((c) => Math.abs(c.cx - cx) <= 2 && Math.abs(c.cz - cz) <= 2);
    expect(near).toHaveLength(25);
    const grid = gridOfChunks(world, near);
    expect([grid.width, grid.height]).toEqual([160, 160]);
    const goal = all("buildings").find((b) => b.door && Math.max(Math.abs(Math.floor(b.door[0] / 32) - cx), Math.abs(Math.floor(b.door[1] / 32) - cz)) === 2);
    expect(goal, "a door two chunks away").toBeDefined();
    const path = grid.path({ x: inn.x, z: inn.z }, { x: goal!.door![0], z: goal!.door![1] });
    expect(path, `a way from ${inn.x},${inn.z} to ${goal!.door!.join(",")}`).not.toBeNull();
    expect(new Set(path!.map((t) => chunkKey(Math.floor(t.x / 32), Math.floor(t.z / 32)))).size).toBeGreaterThanOrEqual(3);
    for (let k = 1; k < path!.length; k++) {
      const a = path![k - 1]!;
      const b = path![k]!;
      expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBe(1);
      expect(grid.walkable(b.x, b.z)).toBe(true);
      if (a.x !== b.x && a.z !== b.z) expect(grid.walkable(b.x, a.z) && grid.walkable(a.x, b.z), "no corner cut").toBe(true);
    }
    // A chunk not loaded is not walked into.
    expect(grid.walkable(cx * 32 + 100, cz * 32)).toBe(false);
  });

  it("give every town its people: vendors in their shops, the inn's keeper and spell table, the armorer in the smithy, the quest board outside", () => {
    const people = [...interiors.values()].flatMap((room) => room.npcs.map((n) => ({ ...n, room })));
    for (const v of vendors.values()) {
      const at = people.find((n) => n.kind === "vendor" && n.vendor === v.id);
      if (v.trader) {
        expect(at, `${v.id} keeps no shop`).toBeUndefined();
        for (const town of v.trader.towns) expect(world.pitches.some((p) => p.town === town), `${v.id}'s pitch in ${town}`).toBe(true);
        continue;
      }
      expect(at, `${v.id}'s shop`).toBeDefined();
      expect(at!.room.town).toBe(v.town);
      expect(at!.room.kind).toBe(v.exotic ? "exotic-wares" : "shop");
      expect(interiors.get(`${v.id}-shop`), `${v.id}-shop`).toBe(at!.room);
    }
    const npcs = all("npcs");
    for (const town of world.towns) {
      const inn = world.inns.find((i) => i.town === town.id)!;
      const room = interiors.get(inn.interior)!;
      expect(room.kind).toBe("inn");
      expect(room.npcs.map((n) => n.kind)).toEqual(expect.arrayContaining(["innkeeper", "spell-table"]));
      expect([inn.x, inn.z]).toEqual([...room.exit]);
      expect(npcs.some((n) => n.kind === "quest-board" && Math.max(Math.abs(n.x - inn.x), Math.abs(n.z - inn.z)) <= 6), `${town.id}'s quest board`).toBe(true);
      if (town.kind !== "village") {
        expect(people.some((n) => n.kind === "armorer" && n.room.town === town.id && n.room.kind === "smithy"), `${town.id}'s armorer`).toBe(true);
        expect(people.some((n) => n.kind === "spell-table" && n.room.town === town.id && n.room.kind === "guildhall"), `${town.id}'s mages' guild`).toBe(true);
      }
    }
  });

  it("keep the guards' beats off the towns' doors and what is used from beside it, so no guard stops in the way of a click", () => {
    const close: string[] = [];
    const doors = all("buildings").flatMap((b) => (b.door ? [b.door] : []));
    for (const g of all("npcs").filter((n) => n.kind === "guard")) {
      const town = world.towns.find((t) => t.id === g.id.slice(0, g.id.lastIndexOf("-guard-")))!;
      const marks = [...town.plan!.places.map((p) => [p.x, p.z] as const), ...doors];
      for (const [x, z] of g.behaviour!.beat!.stops) if (marks.some(([mx, mz]) => Math.max(Math.abs(mx - x), Math.abs(mz - z)) <= 3)) close.push(`${g.id} stops at ${x},${z}`);
    }
    expect(close).toEqual([]);
  });

  it("face every door into an interior south, west or east, toward the camera, at its building's front", () => {
    for (const b of all("buildings")) {
      if (!b.door) continue;
      expect([0, 1, 3], `${b.id} faces ${b.rot}`).toContain(b.rot);
      const [sx, sz] = frontStep(b.rot);
      const inX = b.door[0] - sx;
      const inZ = b.door[1] - sz;
      expect(inX >= b.x && inX < b.x + b.w && inZ >= b.z && inZ < b.z + b.d, `${b.id}'s door ${b.door.join(",")} is at its front`).toBe(true);
      expect(townAt(world.towns, b.door[0], b.door[1])?.id).toBe(interiors.get(b.interior!)!.town);
    }
  });

  it("keep the tiers of the zones: tier 1 round the starting areas, the hardest lands tier 4, every mob met", () => {
    const starts = world.towns.filter((t) => t.start);
    const spawns = all("spawns");
    const near = spawns.filter((s) => starts.some((t) => Math.max(Math.abs(s.x - t.center[0]), Math.abs(s.z - t.center[1])) < t.radius + 40));
    expect(near.filter((s) => s.tier === 1).length / near.length, "tier 1 by the starting areas").toBeGreaterThan(0.7);
    for (let tier = 1; tier <= 4; tier++) expect(spawns.filter((s) => s.tier === tier).length, `tier ${tier} spawns`).toBeGreaterThan(40);
    const portal = dungeons.get("phyrexian-portal")!;
    expect(tierAt(world, portal.entrance[0], portal.entrance[1])).toBe(4);
    expect(portal.requires).toBe("WUBRG");
    const met = new Set([...spawns.flatMap((s) => s.mobs), ...[...dungeons.values()].flatMap((d) => [...(d.mobs as (string | string[])[]).flat(), d.warden, d.boss])]);
    expect([...roster.keys()].filter((id) => !met.has(id)), "mobs nobody meets").toEqual([]);
    for (const d of dungeons.values()) if (d.waystone) expect([d.boss, d.tier]).toEqual([`mage-${d.id}`, Number(d.id.slice(d.id.lastIndexOf("-") + 1))]);
  });

  it("are terraces: open ground level but at its ramps, a level only left by a ramp, and every ramp between two levels", () => {
    const [W, H] = world.size;
    const height = new Int16Array(W * H);
    const flags = new Uint8Array(W * H);
    for (const c of chunks) {
      c.tiles.forEach((t, k) => {
        const i = (c.cz * 32 + Math.floor(k / 32)) * W + c.cx * 32 + (k % 32);
        height[i] = t[0];
        flags[i] = isBlocked(t) ? 1 : t[2];
      });
    }
    const open = (i: number) => (flags[i]! & 1) === 0;
    const ramp = (i: number) => (flags[i]! & RAMP) !== 0;
    let steps = 0;
    let lone = 0;
    let ramps = 0;
    for (let i = 0; i < W * H; i++) {
      if (!open(i)) continue;
      const next = [i % W < W - 1 ? i + 1 : -1, i + W < W * H ? i + W : -1];
      for (const j of next) if (j >= 0 && open(j) && !ramp(i) && !ramp(j) && Math.abs(height[i]! - height[j]!) > 4) steps++;
      if (!ramp(i)) continue;
      ramps++;
      // A ramp climbs: along one axis, ground (or ramp) below it on one side and above it on the other.
      const x = i % W;
      const across = (a: number, b: number) => (height[a]! < height[i]! && height[b]! > height[i]!) || (height[a]! > height[i]! && height[b]! < height[i]!);
      if (!(x > 0 && x < W - 1 && across(i - 1, i + 1)) && !(i >= W && i + W < W * H && across(i - W, i + W))) lone++;
    }
    expect(steps, "open neighbours a level apart with no ramp between").toBe(0);
    expect(ramps).toBeGreaterThan(400);
    expect(lone, "ramps that climb nowhere").toBeLessThan(ramps * 0.02);
  });

  it("keep the sea unwalked but for the ferries' lanes and the causeways", () => {
    const lanes = new Set(world.ferries.flatMap((f) => f.lane.map(([x, z]) => `${x},${z}`)));
    const wet: string[] = [];
    for (const c of chunks) {
      c.tiles.forEach((t, k) => {
        const tile = `${c.cx * 32 + (k % 32)},${c.cz * 32 + Math.floor(k / 32)}`;
        if ((t[1] === "sea" || t[1] === "shallows") && !isBlocked(t) && !lanes.has(tile)) wet.push(tile);
      });
    }
    expect(wet.slice(0, 5)).toEqual([]);
  });

  it("are exactly what the seeded generator writes from the layout and the roster", () => {
    const result = generate(readLayout(), [...roster.values()], [...vendors.values()]);
    const differing: string[] = [];
    for (const [path, text] of result.files) if (readFileSync(join(plane, path), "utf8").replace(/\r\n/g, "\n") !== text) differing.push(path);
    expect(differing.slice(0, 10), "files a rerun of `npm run world` would change").toEqual([]);
    expect(result.files.size).toBe(chunkFiles.size + interiors.size + dungeons.size + 1);
  }, 120_000);
});
