import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKED, CHUNK, type ChunkData, type DungeonData, ICON_SIZE, type InteriorData, LEDGE, RAMP, type WorldData, chunkKey, siteRect } from "../../src/world/format";
import { POCKET_GAP, lintRealm } from "../../src/world/lint";
import { tilesOf } from "../../src/art/props";
import { SURFACES } from "../../src/art/surfaces";
import { distanceTo, poissonTiles } from "./fields";
import { type Vendor, generate } from "./generate";
import { distanceToLine, landmassAt, readGeography, signedArea2 } from "./geography";
import { S } from "./ids";
import { LEVEL, Land, Use, hopPieces, randomFor, rampWays, settle, shuffle } from "./land";
import { checkLayout, readLayout } from "./layout";
import { packPockets } from "./pockets";
import { Roads } from "./roads";
import type { Terrain } from "./terrain";
import type { MobFile } from "./wilds";
import { LAND_PER_SPAWN } from "./wilds";
import { tierOfDistance } from "./zones";

// The world generator: its parts on small grounds of their own (the fields, the terraces, a road over a river, the
// pockets), then the whole of Dominaria as one run makes it - held to the travel map's rules: the coast the sketch's,
// the great ranges closed but at their passes, everything reached on foot by one who hops, open neighbours level, a
// hop or a cliff apart, ramps that climb, the spawns sparse and away from the towns and the main roads - and the realm
// lint catching each kind of fault in the checked-in world.

describe("the fields", () => {
  it("measure the exact distance to the nearest source", () => {
    const d = distanceTo(7, 5, (i) => i === 2 * 7 + 3);
    expect(d[2 * 7 + 3]).toBe(0);
    expect(d[2 * 7 + 6]).toBeCloseTo(3);
    expect(d[0]).toBeCloseTo(Math.hypot(3, 2));
    expect(d[4 * 7 + 5]).toBeCloseTo(Math.hypot(2, 2));
  });

  it("scatter blue noise: never two samples nearer than their radius", () => {
    const W = 60;
    const random = randomFor(3, "poisson");
    const order = shuffle(Array.from({ length: W * W }, (_, i) => i), random);
    const taken = new Uint8Array(W * W);
    const got = poissonTiles(W, W, order, () => 3, () => 1, taken, random);
    expect(got.length).toBeGreaterThan(200);
    for (const a of got) for (const b of got) if (a !== b) expect(Math.hypot((a % W) - (b % W), Math.floor(a / W) - Math.floor(b / W))).toBeGreaterThanOrEqual(3);
  });
});

/** Open grass, `w` by `d`, every tile at `level`. */
function meadow(w: number, d: number, level = 0): Land {
  const land = new Land(w, d);
  land.surface.fill(S.grass);
  land.height.fill(level * LEVEL);
  return land;
}

describe("the terraces", () => {
  it("leave no open neighbours more than a level apart and no terrace a tile wide", () => {
    const land = meadow(20, 20);
    // A spike of four levels, a lone raised tile, and a wall that stays.
    land.height[land.idx(10, 10)] = 4 * LEVEL;
    land.height[land.idx(3, 3)] = LEVEL;
    land.flags[land.idx(15, 15)] = BLOCKED;
    land.height[land.idx(15, 15)] = 9 * LEVEL;
    settle(land, () => true);
    expect(land.height[land.idx(3, 3)]).toBe(0);
    for (let i = 0; i < land.size; i++) {
      if (!land.open(i)) continue;
      for (const n of land.n4(i)) if (land.open(n)) expect(Math.abs(land.height[i]! - land.height[n]!)).toBeLessThanOrEqual(LEVEL);
    }
    expect(land.height[land.idx(15, 15)]).toBe(9 * LEVEL);
  });

  it("ramp a way where it climbs a level: two tiles, a quarter of a level from each side", () => {
    const land = meadow(10, 3);
    for (let x = 5; x < 10; x++) for (let z = 0; z < 3; z++) land.height[land.idx(x, z)] = LEVEL;
    for (let x = 0; x < 10; x++) land.use[land.idx(x, 1)] = Use.Road;
    expect(rampWays(land, (i) => land.use[i] === Use.Road)).toBe(2);
    expect(land.flags[land.idx(4, 1)]! & RAMP).toBe(RAMP);
    expect(land.flags[land.idx(5, 1)]! & RAMP).toBe(RAMP);
    expect([land.height[land.idx(4, 1)], land.height[land.idx(5, 1)]]).toEqual([LEVEL / 4, LEVEL - LEVEL / 4]);
  });
});

/** A terrain record for a small land of open country (all one landmass), for the parts that read one. */
function plainTerrain(land: Land): Terrain {
  const n = land.size;
  return {
    W: land.width,
    H: land.depth,
    mass: new Int16Array(n),
    inland: new Float32Array(n).fill(10),
    biome: new Uint8Array(n),
    water: new Uint8Array(n),
    band: new Uint8Array(n),
    crest: new Float32Array(n),
    hill: new Uint8Array(n),
    forest: new Float32Array(n),
    swamp: new Float32Array(n),
    reserved: new Uint8Array(n),
    river: new Uint8Array(n),
  };
}

describe("roads", () => {
  it("join edge to edge, run straight over open ground, bridge a river on a main road and ford it on a lesser one", () => {
    for (const main of [true, false]) {
      const land = meadow(60, 30);
      const terrain = plainTerrain(land);
      for (let z = 0; z < 30; z++) for (const x of [29, 30]) {
        const i = land.idx(x, z);
        land.surface[i] = S.stream;
        land.flags[i] = BLOCKED;
        terrain.water[i] = 1;
      }
      const roads = new Roads(land, terrain, []);
      const path = roads.route(new Map([[land.idx(5, 15), 0]]), [land.idx(55, 15)])!;
      expect(path).not.toBeNull();
      for (let k = 1; k < path.length; k++) expect(Math.abs(land.xOf(path[k]!) - land.xOf(path[k - 1]!)) + Math.abs(land.zOf(path[k]!) - land.zOf(path[k - 1]!))).toBe(1);
      expect(path.length).toBe(51);
      roads.lay("a", "b", path, main);
      const props = roads.bridges();
      expect(props.map((p) => p.id)).toEqual(main ? ["bridge"] : ["stepping-stone", "stepping-stone"]);
      for (const i of path) expect(land.open(i)).toBe(true);
      // The river flows on beside the crossing.
      expect(land.open(land.idx(30, 2))).toBe(false);
    }
  });

  it("never cross a great range but where a pass is, and cut a gap through a lesser one when there is no other way", () => {
    const land = meadow(40, 30);
    const terrain = plainTerrain(land);
    for (let x = 0; x < 40; x++) for (const z of [14, 15, 16]) {
      const i = land.idx(x, z);
      land.flags[i] = BLOCKED;
      terrain.band[i] = 1;
    }
    expect(new Roads(land, terrain, [3]).route(new Map([[land.idx(20, 2), 0]]), [land.idx(20, 27)])).toBeNull();
    const roads = new Roads(land, terrain, [2]);
    const path = roads.route(new Map([[land.idx(20, 2), 0]]), [land.idx(20, 27)])!;
    roads.lay("a", "b", path, false);
    for (const i of path) expect(land.open(i) && terrain.band[i]).toBe(0);
  });
});

describe("the pockets", () => {
  it("lie east of the travel map in whole chunks, two empty chunks from it and from each other", () => {
    const sizes = [192, 160, 160, 128, 128, 128, 128, 128].map((s, k) => ({ id: `t${k}`, size: [s, s] as const }));
    const { rects, size } = packPockets([0, 0, 512, 768], sizes);
    const all = [...rects.values()];
    for (const r of all) {
      expect(r.every((v) => v % CHUNK === 0)).toBe(true);
      expect(r[0]).toBeGreaterThanOrEqual(512 + POCKET_GAP * CHUNK);
      expect(r[2] <= size[0] && r[3] <= size[1]).toBe(true);
      for (const o of all) {
        if (o === r) continue;
        const apart = Math.max(o[0] - r[2], r[0] - o[2], o[1] - r[3], r[1] - o[3]);
        expect(apart).toBeGreaterThanOrEqual(POCKET_GAP * CHUNK);
      }
    }
  });
});

describe("the tiers and the layout", () => {
  it("rise with the walk from the starting towns", () => {
    expect([0, 55, 56, 120, 121, 200, 201, 900].map(tierOfDistance)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("the layout is good as checked in, and the checks name what is wrong with a bad one", () => {
    const layout = readLayout();
    expect(checkLayout(layout)).toEqual([]);
    const towns = layout.towns.map((t, k) => (k === 1 ? { ...t, at: [1, 2] } : t));
    expect(checkLayout({ ...layout, towns }).join("\n")).toMatch(/geography.json's, not layout.json's/);
    expect(checkLayout({ ...layout, towns: layout.towns.map((t) => ({ ...t, start: false })) }).join("\n")).toMatch(/no town is a starting area/);
  });
});

const plane = join(__dirname, "..", "..", "..", "content", "dominaria");
const readAll = <T>(dir: string): T[] => readdirSync(join(plane, dir)).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(plane, dir, f), "utf8")) as T);

describe("Dominaria as one run makes it", () => {
  const geo = readGeography();
  const result = generate(readLayout(), readAll<MobFile>("mobs"), readAll<Vendor>("vendors"));
  const land = result.land;
  const world = JSON.parse(result.files.get("world/world.json")!) as WorldData;
  const chunks = [...result.files].filter(([p]) => p.startsWith("world/chunks/")).map(([, t]) => JSON.parse(t) as ChunkData);
  const [W, H] = geo.size;
  const travel = (i: number) => i % land.width < W && Math.floor(i / land.width) < H;

  it("lays each town on the setting town/settings.json holds (what the town tests build on; `town-preview.ts --settings` writes it)", () => {
    const held = JSON.parse(readFileSync(new URL("./town/settings.json", import.meta.url), "utf8")) as unknown;
    expect(result.settings).toEqual(held);
  });

  it("is a travel map at the origin and every town's grounds in a pocket past it, a chunk file for each chunk of ground and no other", () => {
    expect(world.travel).toEqual([0, 0, 512, 768]);
    const rects = [world.travel!, ...world.towns.map((t) => t.grounds!)];
    const want = new Set(rects.flatMap((r) => {
      const out: string[] = [];
      for (let z = r[1]; z < r[3]; z += CHUNK) for (let x = r[0]; x < r[2]; x += CHUNK) out.push(chunkKey(x / CHUNK, z / CHUNK));
      return out;
    }));
    expect(new Set(chunks.map((c) => chunkKey(c.cx, c.cz)))).toEqual(want);
    for (const t of world.towns) {
      const g = t.grounds!;
      expect(g[0]).toBeGreaterThanOrEqual(512 + POCKET_GAP * CHUNK);
      expect(g[2] <= world.size[0] && g[3] <= world.size[1], t.id).toBe(true);
    }
  });

  it("gives every town an icon on its site and a way on each side a road arrives, its outside open beside the icon", () => {
    for (const t of world.towns) {
      expect(t.site, t.id).toEqual(geo.towns[t.id]!.at);
      const r = siteRect(t)!;
      expect(r[2] - r[0]).toBe(ICON_SIZE[t.kind]);
      for (let z = r[1]; z < r[3]; z++) for (let x = r[0]; x < r[2]; x++) expect(land.open(land.idx(x, z))).toBe(false);
      expect(t.ways!.length, `${t.id}'s ways`).toBeGreaterThan(0);
      for (const w of t.ways!) {
        expect(land.open(land.idx(w.outside[0], w.outside[1])), `${t.id} ${w.side}`).toBe(true);
        expect(w.exit.length).toBeGreaterThan(0);
        if (w.to !== undefined) expect(world.towns.some((o) => o.id === w.to) || world.dungeons.some((d) => d.id === w.to)).toBe(true);
      }
    }
  });

  it("keeps the coast the sketch's: a few tiles in from its traced coast is land, a few out to sea is sea", () => {
    let checked = 0;
    let wrong = 0;
    for (const l of geo.landmasses) {
      if (Math.abs(signedArea2(l.points)) < 2 * 400) continue;
      for (let k = 0; k < l.points.length; k++) {
        const [ax, az] = l.points[k]!;
        const [bx, bz] = l.points[(k + 1) % l.points.length]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1) continue;
        // Clockwise on the map: the land lies to the right of the way the coast runs (x east, z south).
        const [nx, nz] = [-(bz - az) / len, (bx - ax) / len];
        const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
        for (const [sign, wantLand] of [[1, true], [-1, false]] as const) {
          const x = mx + sign * nx * 3;
          const z = mz + sign * nz * 3;
          const sketchLand = landmassAt(geo, x, z) !== undefined;
          if (sketchLand !== wantLand) continue; // a thin spit or an inlet narrower than the probe
          if (geo.landmasses.some((o) => o !== l && distanceToLine(o.points, x, z, true) < 4)) continue;
          checked++;
          const isLand = result.land.surface[land.idx(Math.floor(x), Math.floor(z))] !== S.sea && result.land.surface[land.idx(Math.floor(x), Math.floor(z))] !== S.shallows;
          if (isLand !== wantLand) wrong++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1500);
    expect(wrong / checked).toBeLessThan(0.03);
  });

  it("closes the great ranges but at their passes, and keeps each pass open", () => {
    for (const m of geo.mountains.filter((r) => r.height === 3)) {
      const passes = geo.passes.filter((p) => p.range === m.id);
      let crest = 0;
      let open = 0;
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
        if (distanceToLine(m.points, x + 0.5, z + 0.5) > m.width * 0.25) continue;
        if (passes.some((p) => Math.hypot(x - p.at[0], z - p.at[1]) < m.width / 2 + 6)) continue;
        crest++;
        if (land.open(land.idx(x, z)) && !land.isWater(land.idx(x, z))) open++;
      }
      expect(open / crest, `${m.id}'s crest open`).toBeLessThan(0.02);
      for (const p of passes) {
        const near = land.disc(p.at[0], p.at[1], 3).filter((i) => land.open(i));
        expect(near.length, p.name).toBeGreaterThan(10);
      }
    }
  });

  it("is one world on foot for one who hops: every way, entrance, dock and landmark reached from New Benalia", () => {
    const nb = world.towns.find((t) => t.id === "new-benalia")!;
    const from = land.idx(nb.ways![0]!.outside[0], nb.ways![0]!.outside[1]);
    const { label, tiles } = hopPieces(land, from, travel);
    const reached = (x: number, z: number) => label[land.idx(x, z)] === 0;
    for (const t of world.towns) for (const w of t.ways!) expect(reached(w.outside[0], w.outside[1]), `${t.id}'s ${w.side} way`).toBe(true);
    for (const d of world.dungeons) expect(reached(d.x, d.z), d.id).toBe(true);
    for (const f of world.ferries) for (const end of [f.from, f.to]) expect(reached(end[0], end[1]), f.id).toBe(true);
    for (const l of geo.landmarks) {
      const beside = land.rect(l.at[0] - 2, l.at[1] - 2, l.at[0] + 2, l.at[1] + 2).some((i) => label[i] === 0);
      expect(beside, l.id).toBe(true);
    }
    // Nothing bigger than a few tiles cut off.
    expect(tiles.slice(1).filter((t) => t.length > 4).map((t) => `${land.xOf(t[0]!)},${land.zOf(t[0]!)}: ${t.length}`)).toEqual([]);
  });

  it("keeps open neighbours level, a hop or a cliff apart (never between), and every ramp climbing", () => {
    let between = 0;
    let lone = 0;
    let ramps = 0;
    const h = land.height;
    const ramp = (i: number) => (land.flags[i]! & RAMP) !== 0;
    for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
      const i = land.idx(x, z);
      if (!land.open(i)) continue;
      for (const j of [i + 1, i + land.width]) {
        if (!land.open(j) || ramp(i) || ramp(j)) continue;
        const rise = Math.abs(h[i]! - h[j]!);
        if (rise > LEDGE && rise !== LEVEL && rise < 2 * LEVEL) between++;
      }
      if (!ramp(i)) continue;
      ramps++;
      const across = (a: number, b: number) => (h[a]! < h[i]! && h[b]! > h[i]!) || (h[a]! > h[i]! && h[b]! < h[i]!);
      if (!across(i - 1, i + 1) && !across(i - land.width, i + land.width)) lone++;
    }
    expect(between).toBe(0);
    expect(ramps).toBeGreaterThan(50);
    expect(lone, "ramps that climb nowhere").toBeLessThan(ramps * 0.05);
  });

  it("spawns sparsely: about one a 3,500 tiles of land, none by a town's icon, none by a main road in tier 1 country", () => {
    const spawns = chunks.flatMap((c) => c.spawns);
    const expected = result.stats.landTiles! / LAND_PER_SPAWN;
    expect(spawns.length).toBeGreaterThan(expected * 0.6);
    expect(spawns.length).toBeLessThan(expected * 1.6);
    const mains = new Set(geo.roads.filter((r) => r.main).map((r) => `${r.from}|${r.to}`));
    const mainTiles = world.roads.filter((r) => mains.has(`${r.from}|${r.to}`)).flatMap((r) => r.tiles);
    for (const s of spawns) {
      expect(s.x < W && s.z < H, s.id).toBe(true);
      for (const t of world.towns) {
        const r = siteRect(t)!;
        expect(Math.max(r[0] - s.x, s.x - (r[2] - 1), r[1] - s.z, s.z - (r[3] - 1)), `${s.id} by ${t.id}`).toBeGreaterThanOrEqual(10);
      }
      if (s.tier === 1) expect(mainTiles.every(([x, z]) => Math.hypot(x - s.x, z - s.z) >= 6), `${s.id} by a main road`).toBe(true);
    }
  });
});

describe("the realm lint, on Dominaria made wrong on purpose", () => {
  const world = JSON.parse(readFileSync(join(plane, "world", "world.json"), "utf8")) as WorldData;
  const chunks = readAll<ChunkData>("world/chunks");
  const interiors = readAll<InteriorData>("interiors");
  const dungeons = readAll<DungeonData>("dungeons");
  const lint = (w: WorldData, c: ChunkData[], d: DungeonData[] = dungeons, r: InteriorData[] = interiors) => lintRealm(w, c, r, d).join("\n");
  const withChunk = (pick: (c: ChunkData) => boolean, change: (c: ChunkData) => ChunkData) => chunks.map((c) => (pick(c) ? change(c) : c));

  it("catches a spawn of the wrong tier, a pocket nobody can walk to, a ferry lane that jumps, an entrance into no dungeon", () => {
    const withSpawn = chunks.find((c) => c.spawns.length > 0)!;
    expect(lint(world, withChunk((c) => c === withSpawn, (c) => ({ ...c, spawns: c.spawns.map((s, k) => (k === 0 ? { ...s, tier: s.tier === 4 ? 3 : s.tier + 1 } : s)) })))).toMatch(/but its zone's is/);
    const sea = chunks.find((c) => c.tiles.every((t) => t[1] === "sea"))!;
    const pocket = { ...sea, tiles: sea.tiles.map((t, k) => (k === 16 * 32 + 16 ? ([0, "sand", 0] as const) : t)) };
    expect(lint(world, chunks.map((c) => (c === sea ? pocket : c)))).toMatch(/1 open tiles are not walked to/);
    const ferry = world.ferries[0]!;
    expect(lint({ ...world, ferries: [{ ...ferry, lane: [ferry.lane[0]!, ...ferry.lane.slice(3)] }, ...world.ferries.slice(1)] }, chunks)).toMatch(/no step of a walk/);
    const withEntrance = chunks.find((c) => c.entrances.length > 0)!;
    expect(lint(world, withChunk((c) => c === withEntrance, (c) => ({ ...c, entrances: c.entrances.map((e) => ({ ...e, dungeon: "nowhere" })) })))).toMatch(/no dungeon nowhere/);
  });

  it("walks onto a town's exit and out through its way, never on past it", () => {
    const town = world.towns.find((t) => t.id === "new-benalia")!;
    const way = town.ways![0]!;
    const [sx, sz] = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[way.side] as [number, number];
    const [ex, ez] = way.exit[Math.floor(way.exit.length / 2)]!;
    const close = (x: number, z: number) =>
      chunks.map((c) =>
        c.cx === Math.floor(x / CHUNK) && c.cz === Math.floor(z / CHUNK)
          ? { ...c, tiles: c.tiles.map((t, k) => (k === (z - c.cz * CHUNK) * CHUNK + (x - c.cx * CHUNK) ? ([t[0], "grass", BLOCKED] as const) : t)) }
          : c,
      );
    const seen = { propTiles: tilesOf, liquid: (s: string) => SURFACES.has(s) && SURFACES.look(s).hole === true };
    const known = { surfaces: new Set<string>(), props: new Set<string>(), styles: new Set<string>(), rooms: new Set<string>(), figures: new Set<string>(), palettes: new Set<string>(), onUnknown: () => {}, ...seen };
    const grass = (c: ChunkData[]) => Number(/(\d+) closed grass tile/.exec(lintRealm(world, c, interiors, dungeons, { known }).join("\n"))?.[1] ?? 0);
    const before = grass(chunks);
    // A tile past the exit, closed with nothing drawn there: nobody comes up against it.
    expect(grass(close(ex + sx, ez + sz))).toBe(before);
    // The same two steps inside the grounds from the exit: walked up to.
    expect(grass(close(ex - 2 * sx, ez - 2 * sz))).toBe(before + 1);
  });

  it("catches a town's way whose outside is not beside its icon, and a spawn by an icon", () => {
    const k = world.towns.findIndex((t) => t.id === "capashen-hold");
    const town = world.towns[k]!;
    const moved = { ...town, ways: town.ways!.map((w, i) => (i === 0 ? { ...w, outside: [w.outside[0] + 5, w.outside[1] + 5] as const } : w)) };
    expect(lint({ ...world, towns: world.towns.map((t, i) => (i === k ? moved : t)) }, chunks)).toMatch(/is not beside the icon/);
    const [sx, sz] = town.site!;
    const x = sx + ICON_SIZE[town.kind];
    const key = chunkKey(Math.floor(x / CHUNK), Math.floor(sz / CHUNK));
    const spawn = { id: `${key}:99`, x, z: sz, mobs: ["benalish-hero"], radius: 4, respawnSeconds: 600, tier: 1 };
    const near = withChunk((c) => chunkKey(c.cx, c.cz) === key, (c) => ({ ...c, spawns: [...c.spawns, spawn] }));
    expect(lint(world, near)).toMatch(/within 10 tiles of capashen-hold's icon/);
  });
});
