// Dominaria, generated (design.md A6; interfaces.md "The world, interiors and dungeons"): one seeded run lays the land,
// the towns and their buildings, the dungeons and mage towers, the ferries, the roads between them, the fields and the
// scenery, the tier zones and what lives in them, and writes it all as the world's files in the version-2 format
// (realms/docs/interfaces.md, "Version 2 of the world data") - its chunks of square tiles, the interiors behind its doors and its dungeons'
// definitions. The same layout, seed and mob roster give the same files, byte for byte.

import {
  CHUNK,
  type ChunkData,
  type DungeonData,
  type EntranceData,
  type FerryData,
  type InteriorData,
  type NpcData,
  type Overview,
  type PropData,
  type Region,
  TILE,
  type TileData,
  type WorldData,
  chunkKey,
  isHeartbloom,
} from "../../src/world/format";
import { S, SURFACES } from "./ids";
import { Land, Use, terraces } from "./land";
import type { DungeonLayout, Layout } from "./layout";
import { Roads } from "./roads";
import { buildInterior } from "./rooms";
import { mountains, seas, shapeLand, waters } from "./terrain";
import { type BuiltTown, buildTown } from "./towns";
import { type MobFile, type Site, connect, dress, fields, placeDungeon, populate, resolveMobs } from "./wilds";
import { makeZones } from "./zones";

/** A vendor file (interfaces.md, "Vendors"): a shop's in its `town`, an exotic wares shop's `exotic`; a traveling trader has no town. */
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
  /** The workbench, for the tools that draw it. */
  readonly land: Land;
}

export function generate(layout: Layout, roster: readonly MobFile[], vendors: readonly Vendor[], log: (text: string) => void = () => {}): Generated {
  const seed = layout.seed;
  const [W, H] = layout.size;
  const land = new Land(W, H);
  shapeLand(land, layout);
  mountains(land, layout);
  waters(land, layout);
  const fromLand = seas(land);
  log("land");

  // The towns, each with a gate toward every road that leaves it.
  const colorOf = (region: string | undefined): Region | null => layout.regions.find((r) => r.id === region)?.color ?? null;
  const placeOf = new Map<string, readonly [number, number]>();
  for (const t of layout.towns) placeOf.set(t.id, t.at);
  for (const d of layout.dungeons) placeOf.set(d.id, d.at);
  for (const f of layout.ferries) {
    placeOf.set(`ferry:${f.id}:from`, f.from);
    placeOf.set(`ferry:${f.id}:to`, f.to);
  }
  const links: { a: string; b: string; main: boolean }[] = layout.roads.map((r) => ({ a: r.from, b: r.to, main: r.main ?? false }));
  for (const d of layout.dungeons) if (d.road) links.push({ a: d.road, b: d.id, main: false });
  const towns: BuiltTown[] = layout.towns.map((plan, index) => {
    const targets = links
      .filter((l) => l.a === plan.id || l.b === plan.id)
      .map((l) => (l.a === plan.id ? l.b : l.a))
      .map((id) => ({ id, at: placeOf.get(id)! }));
    const sold = vendors.filter((v) => v.town === plan.id && !v.exotic).sort((a, b) => a.id.localeCompare(b.id));
    const exotic = vendors.filter((v) => v.town === plan.id && v.exotic);
    if (exotic.length !== (plan.exotic ? 1 : 0) || (plan.exotic && exotic[0]!.id !== plan.exotic)) {
      throw new Error(`${plan.id}: layout.json's exotic shop is ${plan.exotic ?? "none"}, its exotic vendors ${exotic.map((v) => v.id).join(", ") || "none"}`);
    }
    return buildTown(land, { plan, index, color: colorOf(plan.region), targets, vendors: sold, exotic: exotic[0] ?? null }, seed);
  });
  log("towns");

  const outdoor: NpcData[] = towns.flatMap((t) => t.npcs);
  const sites = new Map<string, Site>();
  for (const plan of layout.dungeons) {
    const near = [...layout.towns].sort((p, q) => Math.hypot(p.at[0] - plan.at[0], p.at[1] - plan.at[1]) - Math.hypot(q.at[0] - plan.at[0], q.at[1] - plan.at[1]))[0]!;
    sites.set(plan.id, placeDungeon(land, plan, outdoor, near.at));
  }
  log("dungeons");

  const { ferries, docks } = layFerries(land, layout, outdoor);
  log("ferries");

  const roads = new Roads(land);
  /** Where a road may end at a place: a dock, a dungeon's entrance, or any of a town's gates. */
  const endsOf = (id: string): number[] => {
    const dock = docks.get(id);
    if (dock !== undefined) return [dock];
    const town = towns.find((t) => t.data.id === id);
    if (town) return [...town.gates.values()];
    return [sites.get(id)!.entrance];
  };
  // Main roads first, so the others join them.
  for (const link of [...links.filter((l) => l.main), ...links.filter((l) => !l.main)]) {
    if (!roads.lay(link.a, link.b, endsOf(link.a), endsOf(link.b), link.main)) throw new Error(`no road from ${link.a} to ${link.b}`);
  }
  log("roads");

  fields(land, layout);
  dress(land, layout);
  const step = Math.max(1, Math.round(12 * Math.min(1, layout.relief)));
  const shaped = terraces(land, step, seed);
  log(`terraces: ${shaped.ramps} ramp tiles, ${shaped.ledges} tiles at the brink of a ledge`);
  const capital = towns.find((t) => t.data.kind === "capital") ?? towns[0]!;
  const joined = connect(land, land.idx(capital.inn.x, capital.inn.z), step);
  log(`connect: ${joined.filled} pockets filled, ${joined.joined} stretches joined`);

  const starts: number[] = [];
  for (let i = 0; i < land.size; i++) {
    const t = land.town[i]!;
    if (t !== 0 && layout.towns[t - 1]!.start) starts.push(i);
  }
  const zones = makeZones(land, layout, starts, roads.main, fromLand);
  log("zones");

  const keepAway = [
    ...towns.flatMap((t) => t.interiors.map((r) => land.idx(r.exit[0], r.exit[1]))),
    ...[...sites.values()].map((s) => s.entrance),
    ...outdoor.map((n) => land.idx(n.x, n.z)),
    ...docks.values(),
  ];
  const placed = populate(land, zones, roster, seed, keepAway);
  const blooms = placed.chests.filter(isHeartbloom).length;
  log(`populate: ${placed.spawns.length} spawns, ${placed.chests.length - blooms} chests, ${blooms} heartblooms, ${placed.waymarkers.length} waymarkers`);

  // --- The files ------------------------------------------------------------------------------------------------------

  const files = new Map<string, string>();
  const keyOf = (x: number, z: number) => chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  const byChunk = <T>(list: readonly T[], at: (item: T) => readonly [number, number]) => {
    const map = new Map<string, T[]>();
    for (const item of list) {
      const [x, z] = at(item);
      const k = keyOf(Math.floor(x), Math.floor(z));
      let found = map.get(k);
      if (!found) map.set(k, (found = []));
      found.push(item);
    }
    return map;
  };
  const props: PropData[] = [...land.fixtures, ...land.decor.values()];
  const buildings = towns.flatMap((t) => t.buildings);
  const entrances: EntranceData[] = [...sites.values()].map((s) => ({ x: land.xOf(s.entrance), z: land.zOf(s.entrance), dungeon: s.plan.id }));
  const propsBy = byChunk(props, (p) => [p.x, p.z]);
  const buildingsBy = byChunk(buildings, (b) => [b.x, b.z]);
  const npcsBy = byChunk(outdoor, (n) => [n.x, n.z]);
  const spawnsBy = byChunk(placed.spawns, (s) => [s.x, s.z]);
  const chestsBy = byChunk(placed.chests, (c) => [c.x, c.z]);
  const entrancesBy = byChunk(entrances, (e) => [e.x, e.z]);
  const markersBy = byChunk(placed.waymarkers, (m) => [m.x, m.z]);
  const order = <T extends { x: number; z: number; id?: string }>(a: T, b: T) => a.z - b.z || a.x - b.x || (a.id ?? "").localeCompare(b.id ?? "");
  for (let cz = 0; cz < H / CHUNK; cz++) {
    for (let cx = 0; cx < W / CHUNK; cx++) {
      const k = chunkKey(cx, cz);
      const tiles: TileData[] = [];
      for (let z = cz * CHUNK; z < cz * CHUNK + CHUNK; z++) {
        for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
          const i = land.idx(x, z);
          tiles.push([land.height[i]!, SURFACES[land.surface[i]!]!, land.flags[i]!]);
        }
      }
      const chunk: ChunkData = {
        cx,
        cz,
        tiles,
        props: (propsBy.get(k) ?? []).sort(order),
        buildings: (buildingsBy.get(k) ?? []).sort(order),
        npcs: (npcsBy.get(k) ?? []).sort(order),
        spawns: (spawnsBy.get(k) ?? []).sort(order),
        chests: (chestsBy.get(k) ?? []).sort(order),
        entrances: (entrancesBy.get(k) ?? []).sort(order),
        waymarkers: (markersBy.get(k) ?? []).sort(order),
      };
      files.set(`world/chunks/${k}.json`, formatChunk(chunk));
    }
  }

  const interiors: InteriorData[] = towns.flatMap((t) => t.interiors).map(buildInterior);
  for (const room of interiors) files.set(`interiors/${room.id}.json`, formatInterior(room));

  const tierOf = (x: number, z: number) => zones.areas[zones.grid[Math.floor(z / zones.cell)]?.[Math.floor(x / zones.cell)] ?? 0]?.tier ?? 0;
  const dungeons: DungeonData[] = layout.dungeons.map((plan) => {
    const e = sites.get(plan.id)!.entrance;
    // A dungeon is at least as hard as the land it stands in; a mage tower is its circle's tier, as its mage and its mobs
    // are (the roster's mage-<region>-<tier>), wherever it stands.
    return dungeonData(plan, colorOf(plan.region), [land.xOf(e), land.zOf(e)], plan.waystone ? plan.tier : Math.max(plan.tier, tierOf(land.xOf(e), land.zOf(e))), roster);
  });
  for (const d of dungeons) files.set(`dungeons/${d.id}.json`, `${JSON.stringify(d, null, 2)}\n`);

  const colored = layout.regions.map((r, k) => ({ r, k })).filter(({ r }) => r.color !== null);
  const counts = new Map<number, number>();
  for (let i = 0; i < land.size; i++) if (!land.isWater(i)) counts.set(land.region[i]!, (counts.get(land.region[i]!) ?? 0) + 1);
  const world: WorldData = {
    size: [W, H],
    chunk: CHUNK,
    tile: TILE,
    seed,
    regions: colored.map(({ r, k }) => ({ color: r.color!, name: r.name, tiles: counts.get(k) ?? 0 })),
    towns: towns.map((t) => t.data),
    inns: towns.map((t) => ({ id: `${t.data.id}-inn`, town: t.data.id, x: t.inn.x, z: t.inn.z, interior: t.inn.interior })),
    dungeons: dungeons.map((d) => ({ id: d.id, x: d.entrance[0], z: d.entrance[1] })),
    roads: roads.laid.map((road) => ({ from: road.from, to: road.to, tiles: road.tiles.map((i) => [land.xOf(i), land.zOf(i)] as const) })),
    ferries,
    pitches: towns.flatMap((t) => (t.pitch ? [{ town: t.data.id, x: t.pitch.x, z: t.pitch.z }] : [])),
    zones,
    overview: overview(land),
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
    land,
    mobs: [...mobs].sort(),
    stats: {
      chunks: (W / CHUNK) * (H / CHUNK),
      towns: towns.length,
      buildings: buildings.length,
      interiors: interiors.length,
      dungeons: dungeons.length,
      towers: dungeons.filter((d) => d.waystone).length,
      spawns: placed.spawns.length,
      chests: placed.chests.length - blooms,
      heartblooms: blooms,
      waymarkers: placed.waymarkers.length,
      props: props.length,
      roadTiles: roads.laid.reduce((n, r) => n + r.tiles.length, 0),
    },
  };
}

/**
 * The ferries to the far isles: a dock on each shore (the open shore tile nearest the layout's place, sea beside it), a
 * ferryman beside each, and the lane over the water between: sea tiles edge to edge, open to the ferry's passengers
 * (the overworld lets nobody else onto it; interfaces.md).
 */
function layFerries(land: Land, layout: Layout, npcs: NpcData[]): { ferries: FerryData[]; docks: Map<string, number> } {
  const ferries: FerryData[] = [];
  const docks = new Map<string, number>();
  const near: number[] = [];
  const shore = (want: readonly [number, number]): number => {
    const options = land
      .disc(want[0], want[1], 70)
      .filter((i) => !land.isWater(i) && land.open(i) && land.town[i] === 0 && (land.use[i] === Use.Wild || land.use[i] === Use.Kept) && land.n4(i, near).some((n) => land.isSea(n)));
    options.sort((a, b) => Math.hypot(land.xOf(a) - want[0], land.zOf(a) - want[1]) - Math.hypot(land.xOf(b) - want[0], land.zOf(b) - want[1]) || a - b);
    if (options[0] === undefined) throw new Error(`no shore near ${want.join(",")} for a ferry`);
    return options[0];
  };
  for (const f of layout.ferries) {
    const a = shore(f.from);
    const b = shore(f.to);
    const lane = seaPath(land, a, b);
    if (!lane) throw new Error(`ferry ${f.id}: no way over the water from ${land.xOf(a)},${land.zOf(a)} to ${land.xOf(b)},${land.zOf(b)}`);
    for (const i of lane) {
      land.decor.delete(i);
      land.unblock(i);
      land.use[i] = Use.Dock;
    }
    for (const [end, which] of [[a, "from"], [b, "to"]] as const) {
      land.surface[end] = S.planks;
      docks.set(`ferry:${f.id}:${which}`, end);
      // The ferryman stands beside the dock, on the land side, with the mooring post by him.
      const beside = land
        .n8(end, near)
        .filter((n) => !land.isWater(n) && land.open(n) && land.use[n] !== Use.Dock && land.town[n] === 0)
        .sort((p, q) => p - q)[0];
      if (beside === undefined) throw new Error(`ferry ${f.id}: no room for its ferryman`);
      land.use[beside] = Use.Kept;
      land.decor.delete(beside);
      npcs.push({ id: `${f.id}-ferryman-${which}`, x: land.xOf(beside), z: land.zOf(beside), kind: "ferryman", ferry: f.id, name: `The ferryman of ${f.name.replace(/^The /, "the ")}`, figure: "ferryman", behaviour: { watch: 5 } });
      land.fixtures.push({ id: "ferry-post", x: land.xOf(end) + 0.5, z: land.zOf(end) + 0.5 });
    }
    ferries.push({ id: f.id, name: f.name, from: [land.xOf(a), land.zOf(a)], to: [land.xOf(b), land.zOf(b)], lane: lane.map((i) => [land.xOf(i), land.zOf(i)] as const) });
  }
  return { ferries, docks };
}

/** The shortest way edge to edge over the sea from one shore tile to another, both ends included, or null. */
function seaPath(land: Land, a: number, b: number): number[] | null {
  const came = new Int32Array(land.size).fill(-2);
  const queue = new Int32Array(land.size);
  let head = 0;
  let tail = 0;
  queue[tail++] = a;
  came[a] = -1;
  const near: number[] = [];
  while (head < tail) {
    const i = queue[head++]!;
    if (i === b) break;
    for (const n of land.n4(i, near)) {
      if (came[n] !== -2 || !(land.isSea(n) || n === b)) continue;
      came[n] = i;
      queue[tail++] = n;
    }
  }
  if (came[b] === -2) return null;
  const path: number[] = [];
  for (let i = b; i !== -1; i = came[i]!) path.push(i);
  return path.reverse();
}

function dungeonData(plan: DungeonLayout, color: Region | null, entrance: readonly [number, number], tier: number, roster: readonly MobFile[]): DungeonData {
  const ask = (spec: string) => resolveMobs(roster, color, spec);
  const nested = Array.isArray(plan.mobs[0]);
  const mobs = nested ? (plan.mobs as string[][]).map((list) => [...new Set(list.flatMap(ask))]) : [...new Set((plan.mobs as string[]).flatMap(ask))];
  return {
    id: plan.id,
    name: plan.name,
    theme: plan.theme,
    entrance: [entrance[0], entrance[1]],
    ...(plan.requires ? { requires: plan.requires } : {}),
    floors: plan.floors,
    tier,
    encounters: plan.encounters,
    mobs: mobs as DungeonData["mobs"],
    warden: ask(plan.warden)[0]!,
    boss: ask(plan.boss)[0]!,
    ...(color ? { region: color } : {}),
    ...(plan.waystone ? { waystone: true } : {}),
    ...(plan.standing ? { standing: plan.standing } : {}),
  };
}

/** The letters of the overview, by surface. */
const LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** The world from above for the regional map: a letter for each 8-by-8 square, its commonest ground, woods or a town. */
function overview(land: Land): Overview {
  const cell = 8;
  const legend: Record<string, string> = {};
  SURFACES.forEach((s, k) => {
    if (s !== "") legend[LETTERS[k - 1]!] = s;
  });
  legend.T = "town";
  legend.F = "woods";
  const woods = new Set(["tree", "pine", "dead-tree", "great-tree", "swamp-tree"]);
  const rows: string[] = [];
  for (let z0 = 0; z0 < land.depth; z0 += cell) {
    let row = "";
    for (let x0 = 0; x0 < land.width; x0 += cell) {
      const counts = new Map<string, number>();
      for (const i of land.rect(x0, z0, x0 + cell - 1, z0 + cell - 1)) {
        const tree = land.decor.get(i);
        const k = land.town[i] !== 0 ? "T" : tree && woods.has(tree.id) ? "F" : LETTERS[land.surface[i]! - 1]!;
        counts.set(k, (counts.get(k) ?? 0) + (k === "T" ? 3 : k === "F" ? 3 : 1));
      }
      row += [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    }
    rows.push(row);
  }
  return { cell, legend, rows };
}

// --- Formatting: one item to a line (a chunk's tiles a row to a line), so a file diffs well --------------------------

const line = (v: unknown) => JSON.stringify(v);

export function formatRecord(record: Record<string, unknown>, lists: readonly string[], rows: Readonly<Record<string, number>> = {}): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) continue;
    if (lists.includes(k) && Array.isArray(v)) {
      const per = rows[k];
      if (v.length === 0) parts.push(`  ${line(k)}: []`);
      else if (per) {
        const out: string[] = [];
        for (let i = 0; i < v.length; i += per) out.push(`    ${v.slice(i, i + per).map(line).join(",")}`);
        parts.push(`  ${line(k)}: [\n${out.join(",\n")}\n  ]`);
      } else parts.push(`  ${line(k)}: [\n${v.map((item) => `    ${line(item)}`).join(",\n")}\n  ]`);
    } else parts.push(`  ${line(k)}: ${line(v)}`);
  }
  return `{\n${parts.join(",\n")}\n}\n`;
}

function formatChunk(chunk: ChunkData): string {
  return formatRecord(chunk as unknown as Record<string, unknown>, ["tiles", "props", "buildings", "npcs", "spawns", "chests", "entrances", "waymarkers", "lights"], { tiles: CHUNK });
}

function formatInterior(room: InteriorData): string {
  return formatRecord(room as unknown as Record<string, unknown>, ["tiles", "props", "npcs", "lights"], { tiles: room.w });
}

function formatWorld(world: WorldData): string {
  const { zones, overview: view, roads, ferries, pitches, ...rest } = world;
  const head = formatRecord(rest as unknown as Record<string, unknown>, ["regions", "towns", "inns", "dungeons"]).trimEnd().slice(0, -2);
  const zoneText = `  "zones": {\n    "cell": ${zones.cell}, "cols": ${zones.cols}, "rows": ${zones.rows},\n    "areas": [\n${zones.areas.map((a) => `      ${line(a)}`).join(",\n")}\n    ],\n    "grid": [\n${zones.grid.map((r) => `      ${line(r)}`).join(",\n")}\n    ]\n  }`;
  const viewText = `  "overview": {\n    "cell": ${view.cell},\n    "legend": ${line(view.legend)},\n    "rows": [\n${view.rows.map((r) => `      ${line(r)}`).join(",\n")}\n    ]\n  }`;
  const list = (name: string, items: readonly unknown[]) => (items.length === 0 ? `  "${name}": []` : `  "${name}": [\n${items.map((r) => `    ${line(r)}`).join(",\n")}\n  ]`);
  return `${head},\n${list("roads", roads)},\n${list("ferries", ferries)},\n${list("pitches", pitches)},\n${zoneText},\n${viewText}\n}\n`;
}
