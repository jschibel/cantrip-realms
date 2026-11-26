// Dominaria, generated (design.md A6; interfaces.md "The world, interiors and dungeons", "Two scales"): one seeded run
// grows the travel map from the geography's sketch (geography.json) - its coast, regions and biomes, terraced relief,
// ranges of peaks with their passes, rivers and lakes, woods, roads, the towns' icons, the dungeons' and mage towers'
// entrances, the landmarks, the ferries, the tier zones and what lives in them - then lays each town's grounds at walking
// scale in a pocket of its own east of it (the town generator, behind its contract's interface), and writes it all as
// the world's files in the version-2 format: world.json, a chunk file for every chunk of ground (and none elsewhere),
// the interiors behind its doors and its dungeons' definitions. The same geography, layout, seed, roster and vendors
// give the same files, byte for byte.

import { CHUNK, type ChunkData, type DungeonData, type EntranceData, type FerryData, type InteriorData, type LightData, type NpcData, type Overview, type PropData, type Rect, type Region, type Side, TILE, type TileData, type TownData, type WorldData, chunkKey, chunksOver } from "../../src/world/format";
import { distanceTo } from "./fields";
import { type Geography, readGeography } from "./geography";
import { SURFACES } from "./ids";
import { BLOCKED } from "../../src/world/format";
import { Land, Use, hopPieces, rampWays, settle } from "./land";
import type { DungeonLayout, Layout } from "./layout";
import { type Icon, SIDE_LIST, layFerries, placeIcons, placeLandmarks, settingOf } from "./places";
import { packPockets } from "./pockets";
import { Roads } from "./roads";
import { buildInterior } from "./rooms";
import { shapeTravel } from "./terrain";
// The town generator (town/index.ts, the contract's interface): each town's grounds at walking scale.
import { type BuiltTown, buildTown, groundsSize } from "./town";
import { type MobFile, type Site, connect, farmland, placeDungeon, placePeaks, populate, resolveMobs, scatter } from "./wilds";
import { makeZones, walkingDistances } from "./zones";

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
  /** What the generator would tell a person: the sketch's hints the land does not bear out. */
  readonly notes: readonly string[];
}

export function generate(layout: Layout, roster: readonly MobFile[], vendors: readonly Vendor[], log: (text: string) => void = () => {}, geo: Geography = readGeography()): Generated {
  const seed = layout.seed;
  const travel: Rect = [0, 0, geo.size[0], geo.size[1]];
  const notes: string[] = [];
  const { rects: pockets, size } = packPockets(
    travel,
    layout.towns.map((t) => ({ id: t.id, size: groundsSize(t) })),
  );
  const land = new Land(size[0], size[1]);
  land.flags.fill(BLOCKED);
  const LW = land.width;
  const mine = (i: number) => i % LW < travel[2] && Math.floor(i / LW) < travel[3];

  // --- The land ----------------------------------------------------------------------------------------------------------
  const terrain = shapeTravel(land, geo, layout);
  settle(land, mine, (i) => terrain.reserved[i] === 1);
  log("land");

  // --- The places ----------------------------------------------------------------------------------------------------------
  const props: PropData[] = [];
  const outdoor: NpcData[] = [];
  const icons = placeIcons(land, geo, layout.towns, seed, props);
  const lights: LightData[] = placeLandmarks(land, geo, seed, props);
  const placeOf = (id: string) => {
    const dock = /^ferry:(.+):(from|to)$/.exec(id);
    if (dock) {
      const f = geo.ferries.find((g) => g.id === dock[1])!;
      return dock[2] === "from" ? f.from : f.to;
    }
    return geo.towns[id]?.at ?? geo.dungeons[id]!.at;
  };
  const sites = new Map<string, Site>();
  for (const plan of layout.dungeons) {
    const at = geo.dungeons[plan.id]!.at;
    // Facing the place its road comes from, or the nearest town.
    const road = geo.roads.find((r) => r.from === plan.id || r.to === plan.id);
    const toward = road
      ? placeOf(road.from === plan.id ? road.to : road.from)
      : Object.values(geo.towns).map((t) => t.at).sort((p, q) => Math.hypot(p[0] - at[0], p[1] - at[1]) - Math.hypot(q[0] - at[0], q[1] - at[1]))[0]!;
    sites.set(plan.id, placeDungeon(land, plan, at, toward, outdoor, props));
  }
  const { ferries, docks } = layFerries(land, terrain, geo, outdoor, props);
  log("places");

  // --- The roads ------------------------------------------------------------------------------------------------------------
  const roads = new Roads(land, terrain, geo.mountains.map((m) => m.height));
  /** Each town's ways so far: the side a road arrives on, and where the first road on it leads. */
  const waysOf = new Map<string, Map<Side, string>>(layout.towns.map((t) => [t.id, new Map()]));
  const sideOf = (icon: Icon, tile: number): Side | undefined => SIDE_LIST.find((s) => icon.outside[s] === tile);
  const endsOf = (id: string, other: string, fresh: boolean): number[] => {
    const icon = icons.get(id);
    if (icon) {
      const used = waysOf.get(id)!;
      // Never from the side the sea lies on: the town's harbour is there, not a road out.
      const sea = geo.towns[id]!.sea ?? [];
      return SIDE_LIST.filter((s) => !sea.includes(s) && land.open(icon.outside[s]) && (!fresh || !used.has(s) || used.get(s) === other)).map((s) => icon.outside[s]);
    }
    const dock = docks.get(id);
    if (dock !== undefined) return [dock];
    return [sites.get(id)!.entrance];
  };
  const ordered = [...geo.roads.filter((r) => r.main), ...geo.roads.filter((r) => !r.main)];
  for (const r of ordered) {
    const via = (r.via ?? []).map((name) => {
      const p = geo.passes.find((q) => q.name === name)!;
      return land.idx(p.at[0], p.at[1]);
    });
    let path: number[] | null = null;
    for (const fresh of [true, false]) {
      const starts = endsOf(r.from, r.to, fresh);
      const goals = endsOf(r.to, r.from, fresh);
      if (starts.length === 0 || goals.length === 0) continue;
      path = roads.route(new Map(starts.map((s) => [s, 0])), goals, via);
      if (path) break;
    }
    if (!path) {
      notes.push(`no road from ${r.from} to ${r.to}`);
      continue;
    }
    for (const [id, tile, other] of [[r.from, path[0]!, r.to], [r.to, path[path.length - 1]!, r.from]] as const) {
      const icon = icons.get(id);
      if (!icon) continue;
      const side = sideOf(icon, tile)!;
      const used = waysOf.get(id)!;
      if (!used.has(side)) used.set(side, other);
    }
    roads.lay(r.from, r.to, path, r.main ?? false);
  }
  const fixed = (i: number) => {
    const u = land.use[i]!;
    return terrain.reserved[i] === 1 || u === Use.Road || u === Use.Kept || u === Use.Door || u === Use.Dock;
  };
  settle(land, mine, fixed);
  log(`roads: ${roads.laid.length}`);

  // --- One world ------------------------------------------------------------------------------------------------------------
  const capital = layout.towns.find((t) => t.kind === "capital")!;
  const capitalIcon = icons.get(capital.id)!;
  const from = SIDE_LIST.map((s) => capitalIcon.outside[s]).find((i) => land.open(i))!;
  const joined = connect(land, terrain, from, mine, new Map());
  notes.push(...joined.stranded);
  settle(land, mine, fixed);
  // Settling can part what was joined only where it raised a cut a level too far: once more, to be sure.
  const again = connect(land, terrain, from, mine, new Map());
  if (again.joined + again.filled > 0) settle(land, mine, fixed);
  log(`connect: ${joined.filled} pockets filled, ${joined.joined} joined`);

  const bridges = roads.bridges();
  const ramps = rampWays(land, (i) => mine(i) && land.open(i) && (land.use[i] === Use.Road || land.use[i] === Use.Door || land.use[i] === Use.Dock || land.use[i] === Use.Kept) && terrain.water[i] !== 4);
  log(`ramps: ${ramps} tiles, bridges and fords: ${bridges.length}`);

  // --- The wilds ------------------------------------------------------------------------------------------------------------
  const free = (i: number) => {
    if (!mine(i) || terrain.mass[i]! < 0 || !land.open(i) || land.use[i] !== Use.Wild || terrain.reserved[i] || land.isWater(i) || land.decor.has(i)) return false;
    const x = i % LW;
    const z = Math.floor(i / LW);
    if (x < 1 || z < 1 || x >= travel[2] - 1 || z >= travel[3] - 1) return false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const j = i + dz * LW + dx;
      if (j === i) continue;
      if (!land.open(j)) return false;
      const u = land.use[j]!;
      if (u === Use.Road || u === Use.Kept || u === Use.Door || u === Use.Dock || u === Use.Building) return false;
    }
    return true;
  };
  const farms = farmland(land, terrain, geo, seed, layout.towns.map((t) => ({ id: t.id, at: geo.towns[t.id]!.at, kind: t.kind })));
  const peaks = placePeaks(land, terrain, geo, seed, free);
  const wood = scatter(land, terrain, geo, seed, free);
  const names = new Map<string, string>([...layout.towns.map((t) => [t.id, t.name] as const), ...layout.dungeons.map((d) => [d.id, d.name] as const), ...geo.ferries.flatMap((f) => [[`ferry:${f.id}:from`, f.name], [`ferry:${f.id}:to`, f.name]] as const)]);
  let signposts = 0;
  for (const j of roads.junctions()) {
    const x = j.at % LW;
    const z = Math.floor(j.at / LW);
    const spot = land.rect(x - 3, z - 3, x + 3, z + 3).filter(free).sort((p, q) => Math.hypot((p % LW) - x, Math.floor(p / LW) - z) - Math.hypot((q % LW) - x, Math.floor(q / LW) - z) || p - q)[0];
    if (spot === undefined) continue;
    const to = [...new Set(j.roads.flatMap((r) => [r.from, r.to]).map((id) => names.get(id) ?? id))].sort();
    land.block(spot);
    land.use[spot] = Use.Building;
    props.push({ id: "signpost", x: (spot % LW) + 0.5, z: Math.floor(spot / LW) + 0.5, args: { text: to.join(" / ") } });
    signposts++;
  }
  log(`wilds: ${peaks.length} peaks, ${wood.groves} groves, ${wood.things} small things, ${farms} tiles of fields, ${signposts} signposts`);

  // --- Tiers and what lives there --------------------------------------------------------------------------------------------
  const starts = layout.towns.filter((t) => t.start).flatMap((t) => SIDE_LIST.map((s) => icons.get(t.id)!.outside[s]).filter((i) => land.open(i)));
  const distance = walkingDistances(land, starts, mine, new Map());
  const zones = makeZones(land, terrain, geo, distance);
  const { label } = hopPieces(land, from, mine);
  const away = new Uint8Array(land.size);
  const keep = (x: number, z: number, r: number) => {
    for (const i of land.rect(x - r, z - r, x + r, z + r)) away[i] = 1;
  };
  for (const icon of icons.values()) keep(icon.site[0], icon.site[1], icon.half + 10);
  for (const s of sites.values()) keep(land.xOf(s.entrance), land.zOf(s.entrance), 8);
  for (const l of geo.landmarks) keep(l.at[0], l.at[1], 6);
  for (const d of docks.values()) keep(land.xOf(d), land.zOf(d), 6);
  for (const n of outdoor) keep(n.x, n.z, 4);
  const mainT = distanceTo(travel[2], travel[3], (t) => roads.main[(Math.floor(t / travel[2])) * LW + (t % travel[2])] === 1);
  const mainRoad = new Float32Array(land.size).fill(1e9);
  for (let z = 0; z < travel[3]; z++) for (let x = 0; x < travel[2]; x++) mainRoad[z * LW + x] = mainT[z * travel[2] + x]!;
  const placed = populate(land, terrain, geo, zones, roster, seed, { walked: (i) => label[i] === 0, away, mainRoad, free });
  log(`populate: ${placed.spawns.length} spawns, ${placed.waymarkers.length} waymarkers`);

  // --- The towns' grounds ---------------------------------------------------------------------------------------------------
  /** Where a road to a place leads in the end: a town or a dungeon as it is; a dock, over the ferry and on along the road from its far dock. */
  const beyond = (id: string, from: string, depth = 0): string => {
    const dock = /^ferry:(.+):(from|to)$/.exec(id);
    if (!dock || depth > 4) return id;
    const far = `ferry:${dock[1]}:${dock[2] === "from" ? "to" : "from"}`;
    const next = geo.roads.map((r) => (r.from === far ? r.to : r.to === far ? r.from : null)).filter((x): x is string => x !== null && x !== from);
    const towns = next.filter((x) => geo.towns[x] !== undefined);
    const pick = towns[0] ?? next[0];
    return pick === undefined ? id : beyond(pick, far, depth + 1);
  };
  const colorOf = (region: string | undefined): Region | null => geo.regions.find((r) => r.id === region)?.color ?? null;
  const towns: (Omit<BuiltTown, "data"> & { readonly data: TownData })[] = layout.towns.map((plan, index) => {
    const sold = vendors.filter((v) => v.town === plan.id && !v.exotic).sort((a, b) => a.id.localeCompare(b.id));
    const exotic = vendors.filter((v) => v.town === plan.id && v.exotic);
    if (exotic.length !== (plan.exotic ? 1 : 0) || (plan.exotic && exotic[0]!.id !== plan.exotic)) {
      throw new Error(`${plan.id}: layout.json's exotic shop is ${plan.exotic ?? "none"}, its exotic vendors ${exotic.map((v) => v.id).join(", ") || "none"}`);
    }
    const icon = icons.get(plan.id)!;
    const ways = [...waysOf.get(plan.id)!].map(([side, to]) => ({ side, to: beyond(to, plan.id) }));
    if (ways.length === 0) throw new Error(`${plan.id}: no road arrives at its icon`);
    const setting = settingOf(land, terrain, geo, plan.id, icon.half, ways, notes);
    const g = pockets.get(plan.id)!;
    // Lenient: a town that keeps its own rules only near enough says so in its report (passed on as notes) rather than
    // stopping the world; the realm lint still holds every town to its streets' rules.
    const spec = { plan, index, color: colorOf(geo.towns[plan.id]!.region), vendors: sold, exotic: exotic[0] ?? null, origin: [g[0], g[1]] as const };
    let built: BuiltTown;
    try {
      built = buildTown(land, { ...spec, setting }, seed, { lenient: true });
    } catch (e) {
      // The town generator could not lay the town as the travel map has it: noted (for the town generator's work), and
      // laid without its river, the one hint it has failed on.
      const { river: _, ...dry } = setting;
      notes.push(`town generator failed on ${plan.id} with setting ${JSON.stringify(setting)}: ${(e as Error).message}; laid without its river`);
      built = buildTown(land, { ...spec, setting: dry }, seed, { lenient: true });
    }
    notes.push(...built.report.notes.map((n) => `${plan.id} (setting ${JSON.stringify(setting)}): ${n}`));
    if (built.data.grounds.join() !== g.join()) throw new Error(`${plan.id}: its grounds ${built.data.grounds.join(",")} are not its pocket ${g.join(",")}`);
    const data: TownData = {
      ...built.data,
      site: icon.site,
      ways: built.data.ways.map(({ to, ...w }) => ({
        side: w.side,
        outside: [land.xOf(icon.outside[w.side]), land.zOf(icon.outside[w.side])] as const,
        inside: w.inside,
        exit: w.exit,
        ...(to !== undefined && (geo.towns[to] !== undefined || geo.dungeons[to] !== undefined) ? { to } : {}),
      })),
    };
    return { ...built, data };
  });
  for (const t of towns) outdoor.push(...t.npcs);
  log("towns");

  // --- The files ------------------------------------------------------------------------------------------------------------
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
  const allProps: PropData[] = [...land.fixtures, ...props, ...bridges, ...peaks, ...land.decor.values()];
  const buildings = towns.flatMap((t) => t.buildings);
  const entrances: EntranceData[] = [...sites.values()].map((s) => ({ x: land.xOf(s.entrance), z: land.zOf(s.entrance), dungeon: s.plan.id }));
  const propsBy = byChunk(allProps, (p) => [p.x, p.z]);
  const buildingsBy = byChunk(buildings, (b) => [b.x, b.z]);
  const npcsBy = byChunk(outdoor, (n) => [n.x, n.z]);
  const spawnsBy = byChunk(placed.spawns, (s) => [s.x, s.z]);
  const entrancesBy = byChunk(entrances, (e) => [e.x, e.z]);
  const markersBy = byChunk(placed.waymarkers, (m) => [m.x, m.z]);
  const lightsBy = byChunk(lights, (l) => [l.at[0], l.at[2]]);
  const order = <T extends { x: number; z: number; id?: string }>(a: T, b: T) => a.z - b.z || a.x - b.x || (a.id ?? "").localeCompare(b.id ?? "");
  const ground = [travel, ...towns.map((t) => t.data.grounds!)];
  const keys = new Set(ground.flatMap((r) => chunksOver(r).map(({ cx, cz }) => chunkKey(cx, cz))));
  let chunkCount = 0;
  for (const k of [...keys].sort()) {
    const [cx, cz] = k.split("_").map(Number) as [number, number];
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
      entrances: (entrancesBy.get(k) ?? []).sort(order),
      waymarkers: (markersBy.get(k) ?? []).sort(order),
      ...(lightsBy.has(k) ? { lights: lightsBy.get(k)! } : {}),
    };
    files.set(`world/chunks/${k}.json`, formatChunk(chunk));
    chunkCount++;
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

  const counts = new Map<number, number>();
  let landTiles = 0;
  for (let z = 0; z < travel[3]; z++) for (let x = 0; x < travel[2]; x++) {
    const i = z * LW + x;
    if (terrain.mass[i]! < 0) continue;
    landTiles++;
    counts.set(land.region[i]!, (counts.get(land.region[i]!) ?? 0) + 1);
  }
  const world: WorldData = {
    size: [size[0], size[1]],
    chunk: CHUNK,
    tile: TILE,
    seed,
    travel,
    regions: geo.regions.map((r, k) => ({ r, k })).filter(({ r }) => r.color !== null).map(({ r, k }) => ({ color: r.color!, name: r.name, tiles: counts.get(k) ?? 0 })),
    towns: towns.map((t) => t.data),
    inns: towns.map((t) => ({ id: `${t.data.id}-inn`, town: t.data.id, x: t.inn.x, z: t.inn.z, interior: t.inn.interior })),
    dungeons: dungeons.map((d) => ({ id: d.id, x: d.entrance[0], z: d.entrance[1] })),
    roads: roads.laid.map((road) => ({ from: road.from, to: road.to, tiles: road.tiles.map((i) => [land.xOf(i), land.zOf(i)] as const) })),
    ferries: ferries as FerryData[],
    pitches: towns.flatMap((t) => (t.pitch ? [{ town: t.data.id, x: t.pitch.x, z: t.pitch.z }] : [])),
    zones,
    overview: overview(land, travel, icons, peaks),
    labels: geo.labels.map((l) => ({ name: l.name, x: l.x, z: l.z, kind: l.kind })),
  };
  files.set("world/world.json", formatWorld(world));

  const mobs = new Set<string>();
  for (const s of placed.spawns) for (const m of s.mobs) mobs.add(m);
  for (const d of dungeons) {
    for (const list of Array.isArray(d.mobs[0]) ? (d.mobs as string[][]) : [d.mobs as string[]]) for (const m of list) mobs.add(m);
    mobs.add(d.warden);
    mobs.add(d.boss);
  }
  let groves = 0;
  for (const p of land.decor.values()) if (p.id === "grove") groves++;
  return {
    files,
    land,
    notes,
    mobs: [...mobs].sort(),
    stats: {
      chunks: chunkCount,
      landTiles,
      towns: towns.length,
      buildings: buildings.length,
      interiors: interiors.length,
      dungeons: dungeons.length,
      towers: dungeons.filter((d) => d.waystone).length,
      peaks: peaks.length,
      groves,
      spawns: placed.spawns.length,
      waymarkers: placed.waymarkers.length,
      signposts,
      roads: roads.laid.length,
      props: allProps.length,
      roadTiles: roads.laid.reduce((n, r) => n + r.tiles.length, 0),
    },
  };
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

/**
 * The travel map from above for the regional map: a letter for each 8-by-8 square - a town where an icon stands, peaks
 * where a range's peaks are most of it, woods where the groves are thick, else its commonest ground.
 */
function overview(land: Land, travel: Rect, icons: ReadonlyMap<string, Icon>, peaks: readonly PropData[]): Overview {
  const cell = 8;
  const legend: Record<string, string> = {};
  SURFACES.forEach((s, k) => {
    if (s !== "") legend[LETTERS[k - 1]!] = s;
  });
  legend.T = "town";
  legend.F = "woods";
  legend.M = "peaks";
  const peaked = new Uint8Array(land.size);
  for (const p of peaks) {
    const w = (p.args?.w as number) ?? 1;
    const h = (w - 1) / 2;
    for (let dz = -h; dz <= h; dz++) for (let dx = -h; dx <= h; dx++) peaked[land.idx(Math.floor(p.x) + dx, Math.floor(p.z) + dz)] = 1;
  }
  const town = new Uint8Array(land.size);
  for (const icon of icons.values()) for (const i of land.rect(icon.site[0] - icon.half, icon.site[1] - icon.half, icon.site[0] + icon.half, icon.site[1] + icon.half)) town[i] = 1;
  const rows: string[] = [];
  for (let z0 = travel[1]; z0 < travel[3]; z0 += cell) {
    let row = "";
    for (let x0 = travel[0]; x0 < travel[2]; x0 += cell) {
      const counts = new Map<string, number>();
      for (const i of land.rect(x0, z0, x0 + cell - 1, z0 + cell - 1)) {
        const k = town[i] ? "T" : peaked[i] ? "M" : land.decor.get(i)?.id === "grove" ? "F" : LETTERS[land.surface[i]! - 1]!;
        counts.set(k, (counts.get(k) ?? 0) + (k === "T" ? 20 : k === "F" ? 3.5 : 1));
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
  return formatRecord(chunk as unknown as Record<string, unknown>, ["tiles", "props", "buildings", "npcs", "spawns", "entrances", "waymarkers", "lights"], { tiles: CHUNK });
}

function formatInterior(room: InteriorData): string {
  return formatRecord(room as unknown as Record<string, unknown>, ["tiles", "props", "npcs", "lights"], { tiles: room.w });
}

function formatWorld(world: WorldData): string {
  const { zones, overview: view, roads, ferries, pitches, labels, ...rest } = world;
  const head = formatRecord(rest as unknown as Record<string, unknown>, ["regions", "towns", "inns", "dungeons"]).trimEnd().slice(0, -2);
  const zoneText = `  "zones": {\n    "cell": ${zones.cell}, "cols": ${zones.cols}, "rows": ${zones.rows},\n    "areas": [\n${zones.areas.map((a) => `      ${line(a)}`).join(",\n")}\n    ],\n    "grid": [\n${zones.grid.map((r) => `      ${line(r)}`).join(",\n")}\n    ]\n  }`;
  const viewText = `  "overview": {\n    "cell": ${view.cell},\n    "legend": ${line(view.legend)},\n    "rows": [\n${view.rows.map((r) => `      ${line(r)}`).join(",\n")}\n    ]\n  }`;
  const list = (name: string, items: readonly unknown[]) => (items.length === 0 ? `  "${name}": []` : `  "${name}": [\n${items.map((r) => `    ${line(r)}`).join(",\n")}\n  ]`);
  return `${head},\n${list("roads", roads)},\n${list("ferries", ferries)},\n${list("pitches", pitches)},\n${list("labels", labels ?? [])},\n${zoneText},\n${viewText}\n}\n`;
}
