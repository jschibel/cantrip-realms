// A stand-in for the town generator (the contract's "The town generator's interface": `TownSetting`, `TownSpec`,
// `groundsSize`, `buildTown`), until the real one lands: it lays a town's grounds in its pocket as plainly as will do -
// a flat ground of the town's biome, the town of towns.ts as it was built before the travel map (every building,
// interior, inn, vendor shop, NPC and plan as before) at the grounds' middle, a road out from a gate to the edge of the
// walked ground on each side a way leaves by, its exit there, and round the walked ground an apron two levels up (a
// cliff nobody walks or comes up against), wooded here and there, only seen. generate.ts calls it through one import;
// swapping in the real generator is changing that import.

import type { NpcData, Region, Side, TownData, TownWay, XZ } from "../../src/world/format";
import type { GeoBiome } from "./geography";
import { S } from "./ids";
import { LEVEL, type Land, Use, randomFor } from "./land";
import type { TownEntry } from "./layout";
import { type BuiltTown as OldBuilt, buildTown as buildOld } from "./towns";

/** What the travel map says about where a town stands. */
export interface TownSetting {
  readonly biome: GeoBiome;
  /** Sides of the town the sea lies on (a harbour town), and a river through or past it. */
  readonly sea: readonly Side[];
  readonly river?: Side | "through";
  /** How hilly its ground is, 0 (flat) to 1 (terraced hillside). */
  readonly relief: number;
  /** The roads that leave it on the travel map: the side, and the id of where each leads. At least one. */
  readonly ways: readonly { readonly side: Side; readonly to: string }[];
}

export interface TownSpec {
  readonly plan: TownEntry;
  readonly index: number;
  readonly color: Region | null;
  readonly vendors: readonly { readonly id: string; readonly name: string }[];
  readonly exotic: { readonly id: string; readonly name: string } | null;
  readonly setting: TownSetting;
  /** The north-west corner of its grounds in the Land. */
  readonly origin: XZ;
}

export interface BuiltTown {
  /** Its data, `grounds` and `ways` filled (each way's `outside` the integrator's to fill: [0, 0] here). */
  readonly data: TownData;
  readonly buildings: OldBuilt["buildings"];
  readonly interiors: OldBuilt["interiors"];
  readonly npcs: NpcData[];
  readonly inn: OldBuilt["inn"];
  readonly pitch: OldBuilt["pitch"];
}

/** Tiles of country walked round the town's square, and of apron past it. */
const COUNTRY = 18;
const APRON = 8;

/** The size of the grounds a town needs, whole chunks (multiples of 32) each way. */
export function groundsSize(plan: Pick<TownEntry, "radius">): readonly [number, number] {
  const side = Math.ceil((2 * plan.radius + 1 + 2 * (COUNTRY + APRON)) / 32) * 32;
  return [side, side];
}

const GROUND: Partial<Record<GeoBiome, number>> = {
  tundra: S.tundra,
  desert: S.sand,
  swamp: S.moss,
  badlands: S.badlands,
  highlands: S.highland,
  waste: S["cracked-earth"],
  jungle: S["jungle-floor"],
  forest: S.grass,
  mountains: S.grass,
};

/** Lays the whole grounds (its terrain, the town, the country round it, the apron) into the Land at `origin`. */
export function buildTown(land: Land, spec: TownSpec, seed: number): BuiltTown {
  const [gw, gh] = groundsSize(spec.plan);
  const [x0, z0] = spec.origin;
  const x1 = x0 + gw;
  const z1 = z0 + gh;
  const random = randomFor(seed, `standin:${spec.plan.id}`);
  const ground = GROUND[spec.setting.biome] ?? S.grass;
  const walked = (x: number, z: number) => x >= x0 + APRON && z >= z0 + APRON && x < x1 - APRON && z < z1 - APRON;
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const i = land.idx(x, z);
      land.surface[i] = ground;
      land.use[i] = Use.Wild;
      if (walked(x, z)) {
        land.height[i] = 0;
        land.flags[i] = 0;
      } else {
        land.height[i] = 2 * LEVEL;
        land.flags[i] = 3;
        if (random() < 0.3) land.decor.set(i, { id: spec.setting.biome === "tundra" ? "pine" : "tree", x: x + 0.5, z: z + 0.5, seed: Math.floor(random() * 16), scale: 0.8 + Math.round(random() * 4) / 16 });
      }
    }
  }
  const mid: XZ = [x0 + gw / 2, z0 + gh / 2];
  const edge: Record<Side, XZ> = {
    north: [mid[0], z0 + APRON],
    south: [mid[0], z1 - APRON - 1],
    west: [x0 + APRON, mid[1]],
    east: [x1 - APRON - 1, mid[1]],
  };
  const old = buildOld(
    land,
    {
      plan: { ...spec.plan, at: mid },
      index: spec.index,
      color: spec.color,
      targets: spec.setting.ways.map((w) => ({ id: w.to, at: edge[w.side] })),
      vendors: spec.vendors,
      exotic: spec.exotic,
    },
    seed,
  );
  // Each way: a road from the gate facing its side out to the edge of the walked ground, its exit there.
  const STEP: Record<Side, XZ> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
  const gates = [...old.gates.values()];
  const ways: TownWay[] = [];
  const seen = new Set<Side>();
  for (const w of spec.setting.ways) {
    if (seen.has(w.side)) continue;
    seen.add(w.side);
    const [sx, sz] = STEP[w.side];
    const gate = [...gates].sort((a, b) => {
      const score = (g: number) => -((land.xOf(g) - mid[0]) * sx + (land.zOf(g) - mid[1]) * sz) / Math.max(1, Math.hypot(land.xOf(g) - mid[0], land.zOf(g) - mid[1]));
      return score(a) - score(b) || a - b;
    })[0]!;
    const path = pathOut(land, gate, w.side, walked, [x0 + APRON, z0 + APRON, x1 - APRON, z1 - APRON]);
    if (!path) throw new Error(`${spec.plan.id}: no way out to the ${w.side} from its gate at ${land.xOf(gate)},${land.zOf(gate)}`);
    const across: XZ = sx === 0 ? [1, 0] : [0, 1];
    for (const i of path) {
      for (const k of [-1, 0, 1]) {
        const x = land.xOf(i) + across[0] * k;
        const z = land.zOf(i) + across[1] * k;
        if (!walked(x, z)) continue;
        const j = land.idx(x, z);
        if (land.town[j] !== 0 || land.use[j] === Use.Building || land.use[j] === Use.Door || land.use[j] === Use.Wall) continue;
        land.decor.delete(j);
        land.flags[j] = 0;
        land.surface[j] = S.dirt;
        land.use[j] = Use.Road;
      }
    }
    const end = path[path.length - 1]!;
    const exit: XZ[] = [-1, 0, 1].map((k) => [land.xOf(end) + across[0] * k, land.zOf(end) + across[1] * k] as const).filter(([x, z]) => walked(x, z) && land.open(land.idx(x, z)));
    const inside = path[Math.max(0, path.length - 5)]!;
    ways.push({ side: w.side, outside: [0, 0], inside: [land.xOf(inside), land.zOf(inside)], exit, to: w.to });
  }
  return {
    data: { ...old.data, grounds: [x0, z0, x1, z1], ways },
    buildings: old.buildings,
    interiors: old.interiors,
    npcs: old.npcs,
    inn: old.inn,
    pitch: old.pitch,
  };
}

/** The shortest way from a gate's road end to the edge of the walked ground on a side, over open ground outside the town. */
function pathOut(land: Land, from: number, side: Side, walked: (x: number, z: number) => boolean, rect: readonly [number, number, number, number]): number[] | null {
  const goal = (x: number, z: number) => (side === "north" ? z === rect[1] : side === "south" ? z === rect[3] - 1 : side === "west" ? x === rect[0] : x === rect[2] - 1);
  const came = new Map<number, number>([[from, -1]]);
  const queue = [from];
  const near: number[] = [];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = land.xOf(i);
    const z = land.zOf(i);
    const upright = side === "north" || side === "south";
    const along = upright ? x : z;
    if (goal(x, z) && along > (upright ? rect[0] : rect[1]) + 1 && along < (upright ? rect[2] : rect[3]) - 2) {
      const out: number[] = [];
      for (let k = i; k !== -1; k = came.get(k)!) out.push(k);
      return out.reverse();
    }
    for (const n of land.n4(i, near)) {
      if (came.has(n) || !walked(land.xOf(n), land.zOf(n)) || land.town[n] !== 0) continue;
      const u = land.use[n]!;
      if (u === Use.Building || u === Use.Door || u === Use.Wall || u === Use.Field) continue;
      came.set(n, i);
      queue.push(n);
    }
  }
  return null;
}
