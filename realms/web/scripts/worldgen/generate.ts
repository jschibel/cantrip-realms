// Dominaria, generated (design.md A6; interfaces.md "The world, interiors and dungeons"): one seeded run lays the land,
// the towns and their buildings, the dungeons and mage towers, the roads between them, the scenery, the tier zones and
// what lives in them, and writes it all as the world's files - its chunks, the interiors behind its doors and its
// dungeons' definitions. The same seed and the same mob roster give the same files, byte for byte.

import { hex } from "../../src/hex";
import {
  CHUNK,
  CHUNKS,
  type ChunkData,
  type DoorData,
  type DungeonData,
  type EntranceData,
  type InnData,
  type InteriorData,
  type NpcData,
  type Overview,
  type PropData,
  REGIONS as COLORS,
  TERRAINS,
  type TileData,
  type TownData,
  type WorldData,
  chunkKey,
  tierAt,
} from "../../src/world/schema";
import { Grid, HUB, SIZE, T, Use, atAngle, around, idx, qOf, rOf, terrainName } from "./grid";
import { buildInterior } from "./interiors";
import { ALL_DUNGEONS, CAPITAL, type DungeonPlan, PORTAL, REGIONS, REGION_NAMES, TOWERS, type TownPlan } from "./plan";
import { Roads } from "./roads";
import { REGION_ORDER, shapeLand, waters } from "./terrain";
import { type BuiltTown, buildTown } from "./towns";
import { type MobFile, type Site, connect, dress, placeDungeon, populate } from "./wilds";
import { makeZones } from "./zones";

export const SEED = 1997;

export interface Vendor {
  readonly id: string;
  readonly name: string;
  readonly town: string;
}

export interface Generated {
  /** Each file to write, by its path under the plane's content directory, and its text. */
  readonly files: Map<string, string>;
  readonly stats: Record<string, number>;
  /** Every mob id the world and its dungeons name. */
  readonly mobs: readonly string[];
}

export function generate(roster: readonly MobFile[], vendors: readonly Vendor[], seed = SEED, log: (text: string) => void = () => {}): Generated {
  const grid = new Grid();
  shapeLand(grid, seed);
  waters(grid, seed);
  log("land");

  // Where the towns stand, and which roads leave each.
  const centreOf = new Map<string, ReturnType<typeof hex>>();
  for (const plan of [CAPITAL, ...REGIONS.flatMap((p) => [p.town, ...p.villages])]) centreOf.set(plan.id, plan.steps === 0 ? HUB : atAngle(HUB, plan.angle, plan.steps));
  const dungeonAt = new Map<string, ReturnType<typeof hex>>();
  for (const plan of ALL_DUNGEONS) dungeonAt.set(plan.id, atAngle(HUB, plan.angle, plan.steps));
  const links: { a: string; b: string; main: boolean }[] = [];
  REGIONS.forEach((p, k) => {
    const [near, far] = p.villages;
    const next = REGIONS[(k + 1) % REGIONS.length]!;
    links.push({ a: CAPITAL.id, b: near!.id, main: true });
    links.push({ a: near!.id, b: p.town.id, main: true });
    links.push({ a: p.town.id, b: far!.id, main: false });
    links.push({ a: far!.id, b: next.villages[1]!.id, main: false });
    links.push({ a: p.town.id, b: p.dungeon.id, main: false });
    for (const t of p.towers) if (t.road) links.push({ a: p.town.id, b: t.id, main: false });
  });
  for (const t of TOWERS) if (t.road) links.push({ a: CAPITAL.id, b: t.id, main: false });
  links.push({ a: CAPITAL.id, b: PORTAL.id, main: false });

  const towns: BuiltTown[] = [];
  const townPlans: TownPlan[] = [CAPITAL, ...REGIONS.flatMap((p) => [p.town, ...p.villages])];
  townPlans.forEach((plan, index) => {
    const targets = links
      .filter((l) => l.a === plan.id || l.b === plan.id)
      .map((l) => (l.a === plan.id ? l.b : l.a))
      .map((id) => ({ id, at: centreOf.get(id) ?? dungeonAt.get(id)! }));
    const sold = vendors.filter((v) => v.town === plan.id).sort((a, b) => a.id.localeCompare(b.id));
    towns.push(buildTown(grid, plan, index, centreOf.get(plan.id)!, targets, seed, sold));
  });
  log("towns");

  const outdoor: NpcData[] = towns.flatMap((t) => t.npcs);
  const sites = new Map<string, Site>();
  for (const plan of ALL_DUNGEONS) sites.set(plan.id, placeDungeon(grid, plan, outdoor));
  log("dungeons");

  const roads = new Roads(grid);
  const endOf = (id: string, toward: string): number => {
    const town = towns.find((t) => t.data.id === id);
    if (town) {
      const gate = town.gates.get(toward);
      if (gate === undefined) throw new Error(`${id} has no gate toward ${toward}`);
      return gate;
    }
    const site = sites.get(id)!;
    return idx(site.entrance.q, site.entrance.r);
  };
  // Main roads first, so the others join them.
  for (const link of [...links.filter((l) => l.main), ...links.filter((l) => !l.main)]) {
    const a = endOf(link.a, link.b);
    const b = endOf(link.b, link.a);
    if (!roads.lay(link.a, link.b, a, b, link.main)) {
      const say = (i: number) => `${qOf(i)},${rOf(i)} use ${grid.use[i]} town ${grid.town[i]} terrain ${terrainName(grid.terrain[i]!)} [${around(i).map((n) => `${grid.use[n]}/${grid.town[n]}/${terrainName(grid.terrain[n]!)}`).join(" ")}]`;
      throw new Error(`no road from ${link.a} (${say(a)}) to ${link.b} (${say(b)})`);
    }
  }
  log("roads");

  dress(grid, seed);
  const innHex = towns[0]!.inn;
  const joined = connect(grid, idx(innHex.q, innHex.r));
  log(`connect: ${joined.filled} pockets filled, ${joined.joined} stretches joined`);

  const starts: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const t = grid.town[i]!;
    if (t !== 0 && townPlans[t - 1]!.start && grid.use[i] !== Use.Kept) starts.push(i);
  }
  const zones = makeZones(grid, starts, roads.main);
  log("zones");

  const keepAway = [
    ...towns.flatMap((t) => t.doors.map((d) => hex(d.q, d.r))),
    ...[...sites.values()].map((s) => s.entrance),
    ...outdoor.map((n) => hex(n.q, n.r)),
  ];
  const placed = populate(grid, zones, roster, seed, keepAway);
  log(`populate: ${placed.spawns.length} spawns, ${placed.chests.length} chests, ${placed.markers.length} waymarkers`);

  // The files.
  const files = new Map<string, string>();
  const doors: DoorData[] = towns.flatMap((t) => t.doors);
  const entrances: EntranceData[] = [...sites.values()].map((s) => ({ q: s.entrance.q, r: s.entrance.r, dungeon: s.plan.id }));
  const chunkOfHex = (q: number, r: number) => chunkKey(Math.floor(q / CHUNK), Math.floor(r / CHUNK));
  const byChunk = <T extends { q: number; r: number }>(list: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const item of list) {
      const k = chunkOfHex(item.q, item.r);
      map.set(k, [...(map.get(k) ?? []), item]);
    }
    return map;
  };
  const doorsBy = byChunk(doors);
  const entrancesBy = byChunk(entrances);
  const npcsBy = byChunk(outdoor);
  const spawnsBy = byChunk(placed.spawns);
  const chestsBy = byChunk(placed.chests);
  const propsBy = byChunk([...grid.props.values()]);
  const order = (a: { q: number; r: number }, b: { q: number; r: number }) => a.q - b.q || a.r - b.r;
  for (let cq = 0; cq < CHUNKS; cq++) {
    for (let cr = 0; cr < CHUNKS; cr++) {
      const k = chunkKey(cq, cr);
      const tiles: TileData[] = [];
      for (let q = cq * CHUNK; q < cq * CHUNK + CHUNK; q++) {
        for (let r = cr * CHUNK; r < cr * CHUNK + CHUNK; r++) {
          const i = idx(q, r);
          tiles.push([q, r, Math.round(grid.height[i]! * 100) / 100, terrainName(grid.terrain[i]!), grid.blocked[i]!]);
        }
      }
      const chunk: ChunkData = {
        cq,
        cr,
        tiles,
        props: (propsBy.get(k) ?? []).sort(order),
        doors: (doorsBy.get(k) ?? []).sort(order),
        npcs: (npcsBy.get(k) ?? []).sort(order),
        spawns: (spawnsBy.get(k) ?? []).sort(order),
        chests: (chestsBy.get(k) ?? []).sort(order),
        entrances: (entrancesBy.get(k) ?? []).sort(order),
      };
      files.set(`world/chunks/${k}.json`, formatChunk(chunk));
    }
  }

  const interiors: InteriorData[] = towns.flatMap((t) => t.interiors).map(buildInterior);
  for (const room of interiors) files.set(`interiors/${room.id}.json`, formatRecord(room as unknown as Record<string, unknown>, ["tiles", "props", "npcs"]));

  const dungeons: DungeonData[] = ALL_DUNGEONS.map((plan) => {
    const site = sites.get(plan.id)!;
    return dungeonData(plan, site, Math.max(plan.tier, tierAt(zones, site.entrance)));
  });
  for (const d of dungeons) files.set(`dungeons/${d.id}.json`, `${JSON.stringify(d, null, 2)}\n`);

  const inns: InnData[] = towns.map((t) => ({ id: `${t.data.id}-inn`, town: t.data.id, q: t.inn.q, r: t.inn.r, interior: t.inn.interior }));
  const regionCounts = COLORS.map((color) => ({ color, name: REGION_NAMES[color], hexes: 0 }));
  for (let i = 0; i < SIZE * SIZE; i++) {
    const k = grid.region[i]!;
    if (k < 5 && grid.terrain[i] !== T["deep-water"] && grid.terrain[i] !== T.water) regionCounts[COLORS.indexOf(REGION_ORDER[k]!)]!.hexes++;
  }
  const world: WorldData = {
    size: [SIZE, SIZE],
    chunk: CHUNK,
    seed,
    regions: regionCounts,
    towns: towns.map((t): TownData => t.data),
    inns,
    dungeons: dungeons.map((d) => ({ id: d.id, q: d.entrance[0], r: d.entrance[1] })),
    roads: roads.laid.map((road) => ({ from: road.from, to: road.to, hexes: road.hexes.map((i) => [qOf(i), rOf(i)] as const) })),
    zones,
    overview: overview(grid),
  };
  files.set("world/world.json", formatWorld(world));

  const mobs = new Set<string>();
  for (const s of placed.spawns) for (const m of s.mobs) mobs.add(m);
  for (const d of dungeons) {
    for (const list of Array.isArray(d.mobs[0]) ? (d.mobs as string[][]) : [d.mobs as string[]]) for (const m of list) mobs.add(m);
    mobs.add(d.warden);
    mobs.add(d.boss);
  }
  return {
    files,
    mobs: [...mobs].sort(),
    stats: {
      chunks: CHUNKS * CHUNKS,
      towns: towns.length,
      buildings: towns.reduce((n, t) => n + t.buildings.length, 0),
      interiors: interiors.length,
      dungeons: dungeons.length,
      towers: dungeons.filter((d) => d.waystone).length,
      spawns: placed.spawns.length,
      chests: placed.chests.length,
      waymarkers: placed.markers.length,
      roadHexes: roads.laid.reduce((n, r) => n + r.hexes.length, 0),
    },
  };
}

function dungeonData(plan: DungeonPlan, site: Site, tier: number): DungeonData {
  return {
    id: plan.id,
    name: plan.name,
    theme: plan.theme,
    entrance: [site.entrance.q, site.entrance.r],
    ...(plan.requires ? { requires: plan.requires } : {}),
    floors: plan.floors,
    tier,
    encounters: plan.encounters,
    mobs: plan.mobs,
    warden: plan.warden,
    boss: plan.boss,
    ...(plan.region ? { region: plan.region } : {}),
    ...(plan.waystone ? { waystone: true } : {}),
  };
}

/** The world from above, a letter for each 4-by-4 square: its commonest ground, woods, or a town. */
function overview(grid: Grid): Overview {
  const cell = 4;
  const letters = "abcdefghijklmnopqrstuvwx";
  const legend: Record<string, string> = Object.fromEntries(TERRAINS.map((t, i) => [letters[i]!, t]));
  legend.T = "town";
  legend.F = "woods";
  const rows: string[] = [];
  for (let r0 = 0; r0 < SIZE; r0 += cell) {
    let row = "";
    for (let q0 = 0; q0 < SIZE; q0 += cell) {
      const counts = new Map<string, number>();
      for (let dq = 0; dq < cell; dq++) {
        for (let dr = 0; dr < cell; dr++) {
          const i = idx(q0 + dq, r0 + dr);
          const prop = grid.props.get(i)?.kind;
          const k = grid.town[i] !== 0 && grid.use[i] !== Use.Kept ? "T" : prop === "tree" || prop === "pine" || prop === "dead-tree" ? "F" : letters[grid.terrain[i]!]!;
          counts.set(k, (counts.get(k) ?? 0) + (k === "T" ? 3 : k === "F" ? 2 : 1));
        }
      }
      row += [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    }
    rows.push(row);
  }
  return { cell, legend, rows };
}

// --- Formatting: one item to a line, so a file diffs well -----------------------------------------------------------

const line = (v: unknown) => JSON.stringify(v);

export function formatRecord(record: Record<string, unknown>, lists: readonly string[]): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (lists.includes(k) && Array.isArray(v)) {
      parts.push(v.length === 0 ? `  ${line(k)}: []` : `  ${line(k)}: [\n${v.map((item) => `    ${line(item)}`).join(",\n")}\n  ]`);
    } else parts.push(`  ${line(k)}: ${line(v)}`);
  }
  return `{\n${parts.join(",\n")}\n}\n`;
}

function formatChunk(chunk: ChunkData): string {
  return formatRecord(chunk as unknown as Record<string, unknown>, ["doors", "entrances", "npcs", "spawns", "chests", "props", "tiles"]);
}

function formatWorld(world: WorldData): string {
  const { zones, overview: view, roads, ...rest } = world;
  const head = formatRecord(rest as unknown as Record<string, unknown>, ["regions", "towns", "inns", "dungeons"]).trimEnd().slice(0, -2);
  const zoneText = `  "zones": {\n    "cell": ${zones.cell}, "cols": ${zones.cols}, "rows": ${zones.rows},\n    "areas": [\n${zones.areas.map((a) => `      ${line(a)}`).join(",\n")}\n    ],\n    "grid": [\n${zones.grid.map((r) => `      ${line(r)}`).join(",\n")}\n    ]\n  }`;
  const viewText = `  "overview": {\n    "cell": ${view.cell},\n    "legend": ${line(view.legend)},\n    "rows": [\n${view.rows.map((r) => `      ${line(r)}`).join(",\n")}\n    ]\n  }`;
  const roadText = `  "roads": [\n${roads.map((r) => `    ${line(r)}`).join(",\n")}\n  ]`;
  return `${head},\n${roadText},\n${zoneText},\n${viewText}\n}\n`;
}

export { around };
