// What stands at the sketch's places on the travel map: each town's icon (a `town-icon` over its blocked square, a ring
// of open ground round it), the landmarks, and the ferries - a dock on each shore, a ferryman beside each, the lane over
// the water between them (sea tiles edge to edge, open to the ferry's passengers alone). And each town's setting for its
// grounds (the town generator's `TownSetting`): its biome there, the sea and the river by it, how hilly, its ways.

import { ICON_SIZE, type LightData, type NpcData, type PropData, type Side, type XZ } from "../../src/world/format";
import { LANDMARK_LIGHTS } from "../../src/art/props";
import { GEO_BIOMES, type GeoBiome, type Geography, distanceToLine } from "./geography";
import { S } from "./ids";
import { LEVEL, type Land, Use, randomFor } from "./land";
import type { TownEntry } from "./layout";
import type { Terrain } from "./terrain";

export const SIDE_STEP: Readonly<Record<Side, XZ>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
export const SIDE_LIST: readonly Side[] = ["north", "east", "south", "west"];

/** A town's icon on the travel map: its site, its footprint's half size, and the open tile beside it on each side. */
export interface Icon {
  readonly id: string;
  readonly site: XZ;
  readonly half: number;
  readonly outside: Readonly<Record<Side, number>>;
}

/** The icon's style: the town's own, but a Benalish village is cottages and a windmill. */
const iconStyle = (t: TownEntry) => (t.kind === "village" && (t.style === "benalish" || t.style === "argive") ? "village" : t.style);
/** Walled: the capital, the cities, the clans' palisades and the estate. */
const walled = (t: TownEntry) => ["capital", "city", "clan", "estate"].includes(t.form ?? (t.kind === "capital" ? "capital" : t.kind === "village" ? "village" : "city"));

/** Stands each town's icon on its site: the square blocked under its `town-icon`, the ring round it open and level. */
export function placeIcons(land: Land, geo: Geography, towns: readonly TownEntry[], seed: number, props: PropData[]): Map<string, Icon> {
  const random = randomFor(seed, "icons");
  const icons = new Map<string, Icon>();
  for (const t of towns) {
    const site = geo.towns[t.id]!.at;
    const half = Math.floor(ICON_SIZE[t.kind] / 2);
    const level = land.height[land.idx(site[0], site[1])]!;
    for (const i of land.rect(site[0] - half - 1, site[1] - half - 1, site[0] + half + 1, site[1] + half + 1)) {
      const inside = Math.max(Math.abs(land.xOf(i) - site[0]), Math.abs(land.zOf(i) - site[1])) <= half;
      land.clear(i, land.isWater(i) ? S.dirt : land.surface[i]);
      land.height[i] = level;
      land.use[i] = inside ? Use.Building : Use.Kept;
      if (inside) land.block(i);
    }
    props.push({ id: "town-icon", x: site[0] + 0.5, z: site[1] + 0.5, seed: Math.floor(random() * 64), args: { size: t.kind, style: iconStyle(t), walled: walled(t) } });
    const outside = Object.fromEntries(SIDE_LIST.map((s) => [s, land.idx(site[0] + SIDE_STEP[s][0] * (half + 1), site[1] + SIDE_STEP[s][1] * (half + 1))])) as Record<Side, number>;
    icons.set(t.id, { id: t.id, site, half, outside });
  }
  return icons;
}

/** The sketch's landmarks, each a `landmark` over its blocked 3-by-3 square, the ring round it open; and their lights. */
export function placeLandmarks(land: Land, geo: Geography, seed: number, props: PropData[]): LightData[] {
  const random = randomFor(seed, "landmarks");
  const lights: LightData[] = [];
  for (const l of geo.landmarks) {
    const level = land.height[land.idx(l.at[0], l.at[1])]!;
    for (const i of land.rect(l.at[0] - 2, l.at[1] - 2, l.at[0] + 2, l.at[1] + 2)) {
      const inside = Math.max(Math.abs(land.xOf(i) - l.at[0]), Math.abs(land.zOf(i) - l.at[1])) <= 1;
      land.clear(i, land.isWater(i) ? S.dirt : land.surface[i]);
      land.height[i] = level;
      land.use[i] = inside ? Use.Building : Use.Kept;
      if (inside) land.block(i);
    }
    props.push({ id: "landmark", x: l.at[0] + 0.5, z: l.at[1] + 0.5, rot: 0, seed: Math.floor(random() * 64), args: { kind: l.kind } });
    const light = LANDMARK_LIGHTS[l.kind];
    if (light) lights.push({ ...light, at: [l.at[0] + 0.5 + light.at[0], level / 16 + light.at[1], l.at[1] + 0.5 + light.at[2]] });
  }
  return lights;
}

export interface Ferried {
  readonly ferries: { id: string; name: string; from: XZ; to: XZ; lane: XZ[] }[];
  /** Each dock's tile, by `ferry:<id>:from|to`. */
  readonly docks: Map<string, number>;
}

/**
 * The ferries: a dock on each shore (the open land tile nearest the sketch's place with the sea beside it), its ferryman
 * beside it and its mooring post on it; the lane over the sea between the docks - straight where the sea lets it, else
 * the shortest way edge to edge.
 */
export function layFerries(land: Land, terrain: Terrain, geo: Geography, npcs: NpcData[], props: PropData[]): Ferried {
  const ferries: Ferried["ferries"] = [];
  const docks = new Map<string, number>();
  const near: number[] = [];
  const sea = (i: number) => terrain.water[i] === 4;
  const shore = (want: XZ): number => {
    const options = land.disc(want[0], want[1], 12).filter((i) => terrain.mass[i]! >= 0 && land.open(i) && !terrain.band[i] && (land.use[i] === Use.Wild || land.use[i] === Use.Kept) && land.n4(i, near).some(sea));
    options.sort((a, b) => Math.hypot(land.xOf(a) - want[0], land.zOf(a) - want[1]) - Math.hypot(land.xOf(b) - want[0], land.zOf(b) - want[1]) || a - b);
    if (options[0] === undefined) throw new Error(`no shore near ${want.join(",")} for a ferry`);
    return options[0];
  };
  for (const f of geo.ferries) {
    const a = shore(f.from);
    const b = shore(f.to);
    const lane = seaLane(land, a, b, sea);
    if (!lane) throw new Error(`ferry ${f.id}: no way over the water from ${land.xOf(a)},${land.zOf(a)} to ${land.xOf(b)},${land.zOf(b)}`);
    for (const i of lane.slice(1, -1)) {
      land.decor.delete(i);
      land.unblock(i);
      land.height[i] = 0;
      land.use[i] = Use.Dock;
    }
    for (const [end, which] of [[a, "from"], [b, "to"]] as const) {
      land.surface[end] = S.planks;
      land.use[end] = Use.Dock;
      land.height[end] = Math.min(land.height[end]!, LEVEL);
      docks.set(`ferry:${f.id}:${which}`, end);
      const beside = land
        .n8(end, near)
        .filter((n) => terrain.mass[n]! >= 0 && land.open(n) && !land.isWater(n) && land.use[n] !== Use.Dock && land.use[n] !== Use.Building)
        .sort((p, q) => p - q)[0];
      if (beside === undefined) throw new Error(`ferry ${f.id}: no room for its ferryman`);
      land.use[beside] = Use.Kept;
      land.decor.delete(beside);
      land.height[beside] = land.height[end]!;
      npcs.push({ id: `${f.id}-ferryman-${which}`, x: land.xOf(beside), z: land.zOf(beside), kind: "ferryman", ferry: f.id, name: `The ferryman of ${f.name.replace(/^The /, "the ")}`, figure: "ferryman", behaviour: { watch: 5 } });
      props.push({ id: "ferry-post", x: land.xOf(end) + 0.5, z: land.zOf(end) + 0.5, scale: 0.6 });
    }
    ferries.push({ id: f.id, name: f.name, from: [land.xOf(a), land.zOf(a)], to: [land.xOf(b), land.zOf(b)], lane: lane.map((i) => [land.xOf(i), land.zOf(i)] as const) });
  }
  return { ferries, docks };
}

/** A lane over the sea from one dock to the other, both included, edge to edge: the straight line if it is all sea, else the shortest. */
function seaLane(land: Land, a: number, b: number, sea: (i: number) => boolean): number[] | null {
  const W = land.width;
  const ax = a % W;
  const az = Math.floor(a / W);
  const bx = b % W;
  const bz = Math.floor(b / W);
  const dx = Math.abs(bx - ax);
  const dz = Math.abs(bz - az);
  const sx = bx > ax ? 1 : -1;
  const sz = bz > az ? 1 : -1;
  const straight = [a];
  let x = ax;
  let z = az;
  for (let ix = 0, iz = 0; ix < dx || iz < dz; ) {
    if ((1 + 2 * ix) * dz < (1 + 2 * iz) * dx) {
      x += sx;
      ix++;
    } else {
      z += sz;
      iz++;
    }
    straight.push(z * W + x);
  }
  if (straight.slice(1, -1).every(sea)) return straight;
  const came = new Int32Array(land.size).fill(-2);
  const queue = [a];
  came[a] = -1;
  const near: number[] = [];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    if (i === b) break;
    for (const n of land.n4(i, near)) {
      if (came[n] !== -2 || !(sea(n) || n === b)) continue;
      came[n] = i;
      queue.push(n);
    }
  }
  if (came[b] === -2) return null;
  const path: number[] = [];
  for (let i = b; i !== -1; i = came[i]!) path.push(i);
  return path.reverse();
}

/**
 * A town's setting for its grounds, from the travel map round its icon: its biome; the sides the sea lies on (the
 * sketch's word, checked against the land within twelve tiles: `problems` names a side it gives that has no sea); the
 * river by it (the sketch's, checked); how hilly (the sketch's, else the spread of the land's levels round it); its ways.
 */
export function settingOf(land: Land, terrain: Terrain, geo: Geography, id: string, half: number, ways: readonly { side: Side; to: string }[], problems: string[]): { biome: GeoBiome; sea: Side[]; river?: Side | "through"; relief: number; ways: { side: Side; to: string }[] } {
  const g = geo.towns[id]!;
  const [cx, cz] = g.at;
  const biome = GEO_BIOMES[terrain.biome[land.idx(cx, cz)]!]!;
  const seaOn = (side: Side) => {
    const [dx, dz] = SIDE_STEP[side];
    for (let k = half + 1; k <= half + 12; k++) for (const o of [-half, 0, half]) {
      const x = cx + dx * k + dz * o;
      const z = cz + dz * k + dx * o;
      if (x >= 0 && z >= 0 && x < terrain.W && z < terrain.H && terrain.water[land.idx(x, z)] === 4) return true;
    }
    return false;
  };
  const sea = (g.sea ?? []).filter((s) => {
    if (seaOn(s)) return true;
    problems.push(`town ${id}: the sketch has the sea to its ${s}, the land none within 12 tiles`);
    return false;
  });
  if (g.river !== undefined && !geo.rivers.some((r) => distanceToLine(r.points, cx + 0.5, cz + 0.5) <= half + 12)) problems.push(`town ${id}: the sketch has a river by it, the land none`);
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of land.disc(cx, cz, 14)) {
    if (terrain.mass[i]! < 0 || terrain.band[i] || land.isWater(i)) continue;
    lo = Math.min(lo, land.height[i]!);
    hi = Math.max(hi, land.height[i]!);
  }
  const relief = g.relief ?? Math.min(1, Math.max(0, (hi - lo) / (LEVEL * 4)));
  return { biome, sea, ...(g.river !== undefined ? { river: g.river } : {}), relief, ways: [...ways] };
}
