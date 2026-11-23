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
  type FerryData,
  type EntranceData,
  type InnData,
  type InteriorData,
  type NpcData,
  type Overview,
  type PropData,
  TERRAINS,
  type TileData,
  type TownData,
  type WorldData,
  chunkKey,
  tierAt,
} from "../../src/world/schema";
import { Grid, SIZE, T, Use, around, disc, distanceField, hexDistance, hexOf, idx, line as hexLine, qOf, rOf, safeToBlock, terrainName } from "./grid";
import { buildInterior } from "./interiors";
import type { DungeonLayout, Layout } from "./layout";
import { Roads } from "./roads";
import { mountains, shapeLand, waters } from "./terrain";
import { type BuiltTown, buildTown } from "./towns";
import { type MobFile, type Site, connect, dress, placeDungeon, populate, resolveMobs } from "./wilds";
import { makeZones } from "./zones";

/** A vendor file (interfaces.md, "Vendors"): a shop's in its `town`, an exotic wares shop's `exotic`; a traveling
 * trader has no town, and keeps no shop (its caravan stands at a town's pitch while it is in town). */
export interface Vendor {
  readonly id: string;
  readonly name: string;
  readonly town?: string;
  readonly exotic?: boolean;
}

export interface Generated {
  /** Each file to write, by its path under the plane's content directory, and its text. */
  readonly files: Map<string, string>;
  readonly stats: Record<string, number>;
  /** Every mob id the world and its dungeons name. */
  readonly mobs: readonly string[];
}

export function generate(layout: Layout, roster: readonly MobFile[], vendors: readonly Vendor[], log: (text: string) => void = () => {}): Generated {
  const seed = layout.seed;
  const grid = new Grid();
  shapeLand(grid, layout);
  mountains(grid, layout);
  waters(grid, layout);
  log("land");

  // Where the towns stand, and which roads leave each.
  const at = (p: readonly [number, number]) => hex(p[0], p[1]);
  const centreOf = new Map(layout.towns.map((t) => [t.id, at(t.at)]));
  const dungeonAt = new Map(layout.dungeons.map((d) => [d.id, at(d.at)]));
  for (const f of layout.ferries ?? []) {
    dungeonAt.set(`ferry:${f.id}:from`, at(f.from));
    dungeonAt.set(`ferry:${f.id}:to`, at(f.to));
  }
  const links: { a: string; b: string; main: boolean }[] = layout.roads.map((r) => ({ a: r.from, b: r.to, main: r.main ?? false }));
  for (const d of layout.dungeons) if (d.road) links.push({ a: d.road, b: d.id, main: false });
  const colorOf = (region: string | undefined) => layout.regions.find((r) => r.id === region)?.color ?? null;

  const towns: BuiltTown[] = [];
  const townPlans = layout.towns;
  townPlans.forEach((plan, index) => {
    const targets = links
      .filter((l) => l.a === plan.id || l.b === plan.id)
      .map((l) => (l.a === plan.id ? l.b : l.a))
      .map((id) => ({ id, at: centreOf.get(id) ?? dungeonAt.get(id)! }));
    const sold = vendors.filter((v) => v.town === plan.id && !v.exotic).sort((a, b) => a.id.localeCompare(b.id));
    // The town's exotic wares shop is its exotic vendor's (layout.json's `exotic` names the vendor file).
    const exotic = vendors.filter((v) => v.town === plan.id && v.exotic);
    if (exotic.length !== (plan.exotic ? 1 : 0) || (plan.exotic && exotic[0]!.id !== plan.exotic)) {
      throw new Error(`${plan.id}: layout.json's exotic shop is ${plan.exotic ?? "none"}, its exotic vendors ${exotic.map((v) => v.id).join(", ") || "none"}`);
    }
    towns.push(buildTown(grid, plan, colorOf(plan.region), index, centreOf.get(plan.id)!, targets, seed, sold, exotic[0] ?? null));
  });
  log("towns");

  const outdoor: NpcData[] = towns.flatMap((t) => t.npcs);
  const sites = new Map<string, Site>();
  for (const plan of layout.dungeons) {
    // Its front toward the nearest town.
    const here = at(plan.at);
    const near = [...centreOf.values()].sort((x, y) => Math.hypot(x.q - here.q, x.r - here.r) - Math.hypot(y.q - here.q, y.r - here.r))[0]!;
    sites.set(plan.id, placeDungeon(grid, plan, outdoor, near));
  }
  log("dungeons");

  // Ferries to the far isles: a dock on each shore, a ferryman beside it, and the lane over the water between.
  const ferries: FerryData[] = [];
  const docks = new Map<string, number>();
  const shore = (want: ReturnType<typeof hex>): number => {
    const options = disc(want, 30).filter((i) => !grid.isWater(i) && grid.town[i] === 0 && grid.use[i] !== Use.Door && grid.use[i] !== Use.Building && around(i).some((n) => grid.isWater(n)));
    options.sort((a, b) => hexDistance(qOf(a), rOf(a), want.q, want.r) - hexDistance(qOf(b), rOf(b), want.q, want.r) || a - b);
    if (options[0] === undefined) throw new Error(`no shore near ${want.q},${want.r} for a ferry`);
    return options[0];
  };
  for (const f of layout.ferries ?? []) {
    const a = shore(at(f.from));
    const b = shore(at(f.to));
    const lane = hexLine(hexOf(a), hexOf(b)).map((h) => idx(h.q, h.r));
    for (const i of lane) {
      grid.props.delete(i);
      grid.blocked[i] = 0;
      grid.use[i] = Use.Kept;
      if (!grid.isWater(i)) grid.terrain[i] = T.wood;
    }
    for (const [end, which] of [[a, "from"], [b, "to"]] as const) {
      grid.terrain[end] = T.wood;
      docks.set(`ferry:${f.id}:${which}`, end);
      const open = (q: number, r: number) => grid.blocked[idx(q, r)] === 0;
      const beside = around(end).filter((n) => !lane.includes(n) && !grid.isWater(n) && grid.blocked[n] === 0 && safeToBlock(open, qOf(n), rOf(n))).sort((x, y) => x - y)[0];
      if (beside === undefined) throw new Error(`ferry ${f.id}: no room for its ferryman`);
      grid.blocked[beside] = 1;
      grid.use[beside] = Use.Building;
      outdoor.push({ id: `${f.id}-ferryman-${which}`, q: qOf(beside), r: rOf(beside), kind: "ferryman", ferry: f.id, name: `The ferryman of ${f.name.replace(/^The /, "the ")}` });
    }
    ferries.push({ id: f.id, name: f.name, from: [qOf(a), rOf(a)], to: [qOf(b), rOf(b)], lane: lane.map((i) => [qOf(i), rOf(i)] as const) });
  }
  log("ferries");

  const roads = new Roads(grid);
  const endOf = (id: string, toward: string): number => {
    const dock = docks.get(id);
    if (dock !== undefined) return dock;
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

  dress(grid, layout);
  const innHex = towns[0]!.inn;
  const joined = connect(grid, idx(innHex.q, innHex.r));
  log(`connect: ${joined.filled} pockets filled, ${joined.joined} stretches joined`);

  const starts: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const t = grid.town[i]!;
    if (t !== 0 && townPlans[t - 1]!.start && grid.use[i] !== Use.Kept) starts.push(i);
  }
  const sea: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (grid.terrain[i] === T["deep-water"]) sea.push(i);
  const zones = makeZones(grid, layout, starts, roads.main, distanceField(sea, 2000));
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

  const dungeons: DungeonData[] = layout.dungeons.map((plan) => {
    const site = sites.get(plan.id)!;
    return dungeonData(plan, colorOf(plan.region), site, Math.max(plan.tier, tierAt(zones, site.entrance)), roster);
  });
  for (const d of dungeons) files.set(`dungeons/${d.id}.json`, `${JSON.stringify(d, null, 2)}\n`);

  const inns: InnData[] = towns.map((t) => ({ id: `${t.data.id}-inn`, town: t.data.id, q: t.inn.q, r: t.inn.r, interior: t.inn.interior }));
  const colored = layout.regions.filter((r) => r.color !== null);
  const regionCounts = colored.map((r) => ({ color: r.color!, name: r.name, hexes: 0 }));
  for (let i = 0; i < SIZE * SIZE; i++) {
    const region = layout.regions[grid.region[i]!]!;
    const k = colored.indexOf(region);
    if (k >= 0 && grid.terrain[i] !== T["deep-water"] && grid.terrain[i] !== T.water) regionCounts[k]!.hexes++;
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
    ferries,
    pitches: towns.flatMap((t) => (t.pitch ? [{ town: t.data.id, q: t.pitch.q, r: t.pitch.r }] : [])),
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

function dungeonData(plan: DungeonLayout, color: DungeonData["region"] | null, site: Site, tier: number, roster: readonly MobFile[]): DungeonData {
  const ask = (spec: string) => resolveMobs(roster, color ?? null, spec);
  const nested = Array.isArray(plan.mobs[0]);
  const mobs = nested ? (plan.mobs as string[][]).map((list) => [...new Set(list.flatMap(ask))]) : [...new Set((plan.mobs as string[]).flatMap(ask))];
  return {
    id: plan.id,
    name: plan.name,
    theme: plan.theme,
    entrance: [site.entrance.q, site.entrance.r],
    ...(plan.requires ? { requires: plan.requires } : {}),
    floors: plan.floors,
    tier,
    encounters: plan.encounters,
    mobs: mobs as DungeonData["mobs"],
    warden: ask(plan.warden)[0]!,
    boss: ask(plan.boss)[0]!,
    ...(color ? { region: color } : {}),
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
  const { zones, overview: view, roads, ferries, pitches, ...rest } = world;
  const head = formatRecord(rest as unknown as Record<string, unknown>, ["regions", "towns", "inns", "dungeons"]).trimEnd().slice(0, -2);
  const zoneText = `  "zones": {\n    "cell": ${zones.cell}, "cols": ${zones.cols}, "rows": ${zones.rows},\n    "areas": [\n${zones.areas.map((a) => `      ${line(a)}`).join(",\n")}\n    ],\n    "grid": [\n${zones.grid.map((r) => `      ${line(r)}`).join(",\n")}\n    ]\n  }`;
  const viewText = `  "overview": {\n    "cell": ${view.cell},\n    "legend": ${line(view.legend)},\n    "rows": [\n${view.rows.map((r) => `      ${line(r)}`).join(",\n")}\n    ]\n  }`;
  const list = (name: string, items: readonly unknown[]) => (items.length === 0 ? `  "${name}": []` : `  "${name}": [\n${items.map((r) => `    ${line(r)}`).join(",\n")}\n  ]`);
  return `${head},\n${list("roads", roads)},\n${list("ferries", ferries)},\n${list("pitches", pitches)},\n${zoneText},\n${viewText}\n}\n`;
}

export { around };
