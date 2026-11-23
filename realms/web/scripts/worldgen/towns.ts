// Towns (design.md A6) on square tiles: a walled square with a gate toward every road that leaves it (and the harbour,
// where there is water), avenues from the gates to the central square, a lane inside the walls, and the quarters
// between cut into blocks by streets. Each block is built round its edges, every building facing the street it stands
// on - its door the street tile before its front - with yards behind. The town's own buildings come first, where they
// belong: the inn on the square, the shops round it and the market, the guildhall, temple and library a street or two
// off, the smithy by a gate; then rows of houses and tenements, warehouses by the harbour. A building with a door into an
// interior faces south, east or west, never away from the camera. Outdoors: the centrepiece, benches and lamps, market
// stalls and wares, the quest board by the inn's door, guards at the gates, townsfolk on the square, the arena, and the
// caravans' pitch.

import type { BuildingData, InteriorKind, NpcData, PropData, Region, TownData } from "../../src/world/format";
import { type Footprint, building, frontTile } from "./buildings";
import { type BuildingKind, S } from "./ids";
import { type Land, Use, between, pick, randomFor, shuffle, texel } from "./land";
import type { TownLayout } from "./layout";

export interface InteriorSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: InteriorKind;
  readonly town: string;
  readonly style: string;
  /** The door's tile in the world: where one comes out. */
  readonly exit: readonly [number, number];
  readonly vendor?: { readonly id: string; readonly name: string };
  readonly armorer?: boolean;
  readonly innkeeper?: { readonly name: string; readonly text: readonly string[] };
  readonly spellTable?: boolean;
  readonly resident?: { readonly name: string; readonly text: readonly string[] };
}

export interface BuiltTown {
  readonly data: TownData;
  readonly buildings: BuildingData[];
  readonly interiors: InteriorSpec[];
  readonly npcs: NpcData[];
  /** The road's end outside each gate a road may leave by, by the side it is on (n, e, s, w). */
  readonly gates: Map<string, number>;
  /** The inn's door tile, outside. */
  readonly inn: { readonly x: number; readonly z: number; readonly interior: string };
  /** Where traveling vendors' caravans pitch, if the town has one. */
  readonly pitch: { readonly x: number; readonly z: number } | null;
}

export interface TownSpec {
  readonly plan: TownLayout;
  readonly index: number;
  readonly color: Region | null;
  /** Where the roads out of it go. */
  readonly targets: readonly { readonly id: string; readonly at: readonly [number, number] }[];
  readonly vendors: readonly { readonly id: string; readonly name: string }[];
  readonly exotic: { readonly id: string; readonly name: string } | null;
}

interface Ground {
  readonly lot: number;
  readonly street: number;
  readonly square: number;
  readonly yard: number;
}

const GROUNDS: Record<string, Ground> = {
  benalish: { lot: S.grass, street: S.cobbles, square: S.flagstones, yard: S.grass },
  llanowar: { lot: S.moss, street: S.dirt, square: S.grass, yard: S["forest-floor"] },
  urborg: { lot: S.mud, street: S.planks, square: S.flagstones, yard: S.moss },
  keldon: { lot: S.tundra, street: S.dirt, square: S.flagstones, yard: S.tundra },
  tolarian: { lot: S.grass, street: S.flagstones, square: S.flagstones, yard: S.sand },
  argive: { lot: S.grass, street: S.cobbles, square: S.flagstones, yard: S.grass },
};

/** Who keeps a town's gates and walks its square, by its style (art/figures; townsman, elf, wizard and humanoid are placeholders). */
const FOLK_FIGURES: Record<string, { guard: string; folk: readonly string[] }> = {
  benalish: { guard: "knight", folk: ["townswoman", "townsman"] },
  llanowar: { guard: "elf", folk: ["elf", "elf", "townswoman"] },
  urborg: { guard: "knight", folk: ["townswoman", "townsman"] },
  keldon: { guard: "humanoid", folk: ["townsman", "townswoman", "humanoid"] },
  tolarian: { guard: "wizard", folk: ["wizard", "townswoman", "townsman"] },
  argive: { guard: "knight", folk: ["townswoman", "townsman"] },
};

/** The four sides of a town, as the fronts that face out of them. */
const SIDES = [
  { name: "s", rot: 0, dx: 0, dz: 1 },
  { name: "w", rot: 1, dx: -1, dz: 0 },
  { name: "n", rot: 2, dx: 0, dz: -1 },
  { name: "e", rot: 3, dx: 1, dz: 0 },
] as const;
type Side = (typeof SIDES)[number];

const sideToward = (dx: number, dz: number): Side => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? SIDES[3] : SIDES[1]) : dz > 0 ? SIDES[0] : SIDES[2]);

interface Block {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** Sizes, tiles across the front and deep, of the town's own buildings. */
const SIZE: Record<string, readonly [number, number]> = {
  "inn-capital": [14, 9],
  "inn-town": [12, 8],
  "inn-village": [10, 7],
  shop: [8, 6],
  exotic: [9, 7],
  guildhall: [12, 9],
  temple: [11, 12],
  library: [10, 8],
  tower: [8, 8],
  smithy: [8, 7],
  shrine: [7, 6],
  house: [7, 6],
};

export function buildTown(land: Land, spec: TownSpec, seed: number): BuiltTown {
  const { plan } = spec;
  const random = randomFor(seed, `town:${plan.id}`);
  const R = plan.radius;
  const [cx, cz] = plan.at;
  const tag = spec.index + 1;
  const style = plan.style;
  const ground = GROUNDS[style] ?? GROUNDS.benalish!;
  const capital = plan.kind === "capital";
  const village = plan.kind === "village";
  const cheb = (x: number, z: number) => Math.max(Math.abs(x - cx), Math.abs(z - cz));
  const I = (x: number, z: number) => land.idx(x, z);

  // --- The site: levelled, cleared and walled ---------------------------------------------------------------------

  // Which side the sea is on, if it comes near the walls: the harbour's.
  let harbour: Side | null = null;
  {
    let most = 0.25;
    for (const side of SIDES) {
      let sea = 0;
      let all = 0;
      for (let out = R + 3; out <= R + 22; out++) {
        for (let t = -Math.floor(R / 2); t <= Math.floor(R / 2); t++) {
          const x = side.dx !== 0 ? cx + side.dx * out : cx + t;
          const z = side.dz !== 0 ? cz + side.dz * out : cz + t;
          if (!land.inside(x, z)) continue;
          all++;
          if (land.isSea(I(x, z))) sea++;
        }
      }
      if (all > 0 && sea / all > most) {
        most = sea / all;
        harbour = side;
      }
    }
  }

  const heights: number[] = [];
  for (const i of land.rect(cx - R, cz - R, cx + R, cz + R)) if (!land.isWater(i) && land.open(i)) heights.push(land.height[i]!);
  heights.sort((a, b) => a - b);
  const level = Math.max(1, heights[Math.floor(heights.length / 2)] ?? 2);

  for (const i of land.rect(cx - R - 6, cz - R - 6, cx + R + 6, cz + R + 6)) {
    const x = land.xOf(i);
    const z = land.zOf(i);
    const d = cheb(x, z);
    if (d <= R) {
      land.clear(i, ground.lot);
      land.height[i] = level;
      land.use[i] = Use.Lot;
      land.town[i] = tag;
    } else if (!land.isSea(i)) {
      // The apron round the walls: open ground, easing down to the land.
      land.clear(i, land.isWater(i) || !land.open(i) ? S.dirt : land.surface[i]!);
      const t = (d - R) / 7;
      land.height[i] = Math.round(level * (1 - t) + land.height[i]! * t);
      land.use[i] = Use.Kept;
    }
  }

  const street = (i: number, surface = ground.street) => {
    if (land.use[i] === Use.Wall || land.use[i] === Use.Door) return;
    land.clear(i, surface);
    land.use[i] = Use.Street;
  };
  const kept = (i: number, surface: number) => {
    if (land.use[i] === Use.Wall || land.use[i] === Use.Door) return;
    land.clear(i, surface);
    land.use[i] = Use.Kept;
  };

  for (const i of land.rect(cx - R, cz - R, cx + R, cz + R)) {
    if (cheb(land.xOf(i), land.zOf(i)) === R) {
      land.use[i] = Use.Wall;
      land.surface[i] = ground.street;
      land.block(i);
    }
  }

  // Gates on every side that meets dry land (and the harbour's), one a side at its middle, where the avenue meets the
  // wall: a road leaves by whichever is cheapest to its end (roads.ts), a bay or a cliff before one gate or not.
  const gateWidth = capital ? 5 : 3;
  const half = (gateWidth - 1) / 2;
  const gates = new Map<string, number>();
  const gateSides = new Set<Side>();
  const dry = (side: Side) => [1, 2, 3].every((out) => !land.isSea(I(cx + side.dx * (R + out), cz + side.dz * (R + out))));
  for (const side of SIDES) if (dry(side)) gateSides.add(side);
  if (gateSides.size === 0) {
    const t = spec.targets[0];
    gateSides.add(t ? sideToward(t.at[0] - cx, t.at[1] - cz) : SIDES[0]);
  }
  if (harbour) gateSides.add(harbour);
  const outsideOf = (side: Side) => I(cx + side.dx * (R + 1), cz + side.dz * (R + 1));
  for (const side of SIDES.filter((s) => gateSides.has(s))) {
    for (let t = -half; t <= half; t++) {
      const x = side.dx !== 0 ? cx + side.dx * R : cx + t;
      const z = side.dz !== 0 ? cz + side.dz * R : cz + t;
      land.use[I(x, z)] = Use.Street;
      land.clear(I(x, z), ground.street);
      // The way out, through the apron.
      for (let out = 1; out <= 3; out++) {
        const j = I(x + side.dx * out, z + side.dz * out);
        if (land.inside(x + side.dx * out, z + side.dz * out) && !land.isSea(j)) land.clear(j, ground.street);
      }
    }
    land.fixtures.push({ id: "gatehouse", x: cx + side.dx * R + 0.5, z: cz + side.dz * R + 0.5, rot: side.rot, args: { width: gateWidth, style, size: plan.kind } });
  }
  for (const side of SIDES) if (gateSides.has(side) && (side !== harbour || dry(side))) gates.set(side.name, outsideOf(side));

  wallProps(land, plan, cx, cz, R, [...gateSides], half);

  // --- Streets ----------------------------------------------------------------------------------------------------

  const lane = 2;
  for (const i of land.rect(cx - R + 1, cz - R + 1, cx + R - 1, cz + R - 1)) if (cheb(land.xOf(i), land.zOf(i)) >= R - lane) street(i);
  const a = capital ? 2 : 1;
  for (let t = -a; t <= a; t++) {
    for (let s = -(R - 1); s <= R - 1; s++) {
      street(I(cx + t, cz + s));
      street(I(cx + s, cz + t));
    }
  }
  const SQ = capital ? 15 : village ? 6 : 10;
  for (const i of land.rect(cx - SQ, cz - SQ, cx + SQ, cz + SQ)) kept(i, ground.square);

  // Plazas off the avenues: the capital's market, the arena (towns and the capital).
  const quadrants = shuffle([[1, -1], [-1, -1], [1, 1], [-1, 1]] as [number, number][], random).filter(([qx, qz]) => !harbour || !(Math.sign(harbour.dx) === qx || Math.sign(harbour.dz) === qz));
  while (quadrants.length < 2) quadrants.push([1, 1]);
  const plaza = (q: readonly [number, number], halfSize: number, along: number) => {
    const px = cx + q[0] * (a + 1 + along + halfSize);
    const pz = cz + q[1] * (a + 1 + halfSize);
    for (const i of land.rect(px - halfSize, pz - halfSize, px + halfSize, pz + halfSize)) if (cheb(land.xOf(i), land.zOf(i)) < R - lane) kept(i, ground.square);
    return [px, pz] as const;
  };
  const market = capital ? plaza(quadrants[0]!, 10, SQ + 4) : null;
  const arena = village ? null : plaza(quadrants[1]!, capital ? 7 : 5, capital ? SQ + 6 : SQ + 3);

  // The quarters, cut into blocks by streets.
  const blocks: Block[] = [];
  const cut = (b: Block) => {
    const w = b.x1 - b.x0 + 1;
    const h = b.z1 - b.z0 + 1;
    const maxW = capital ? 26 : 22;
    const maxH = capital ? 22 : 18;
    const sw = capital && (w > 40 || h > 40) ? 3 : 2;
    if (w > maxW && w >= h) {
      const at = b.x0 + Math.round(w * (0.38 + random() * 0.24));
      for (let x = at; x < at + sw; x++) for (let z = b.z0; z <= b.z1; z++) if (land.use[I(x, z)] === Use.Lot) street(I(x, z));
      cut({ ...b, x1: at - 1 });
      cut({ ...b, x0: at + sw });
    } else if (h > maxH) {
      const at = b.z0 + Math.round(h * (0.38 + random() * 0.24));
      for (let z = at; z < at + sw; z++) for (let x = b.x0; x <= b.x1; x++) if (land.use[I(x, z)] === Use.Lot) street(I(x, z));
      cut({ ...b, z1: at - 1 });
      cut({ ...b, z0: at + sw });
    } else if (w >= 5 && h >= 5) blocks.push(b);
  };
  const inner = R - lane - 1;
  for (const [qx, qz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]] as const) {
    const xs = [cx + qx * (a + 1), cx + qx * inner].sort((p, q) => p - q);
    const zs = [cz + qz * (a + 1), cz + qz * inner].sort((p, q) => p - q);
    cut({ x0: xs[0]!, z0: zs[0]!, x1: xs[1]!, z1: zs[1]! });
  }

  // --- Buildings --------------------------------------------------------------------------------------------------

  const buildings: BuildingData[] = [];
  const interiors: InteriorSpec[] = [];
  const doors = new Set<number>();
  const frontsOn = (i: number) => land.use[i] === Use.Street || land.use[i] === Use.Kept;

  /** The footprint of a building on a block's side, `at` tiles along it, or null if it does not fit there. */
  const fit = (b: Block, side: Side, at: number, wide: number, deep: number, doorAt: number): Footprint | null => {
    let f: Omit<Footprint, "door">;
    if (side.rot === 0) f = { x: b.x0 + at, z: b.z1 - deep + 1, w: wide, d: deep, rot: 0 };
    else if (side.rot === 2) f = { x: b.x1 - at - wide + 1, z: b.z0, w: wide, d: deep, rot: 2 };
    else if (side.rot === 1) f = { x: b.x0, z: b.z0 + at, w: deep, d: wide, rot: 1 };
    else f = { x: b.x1 - deep + 1, z: b.z1 - at - wide + 1, w: deep, d: wide, rot: 3 };
    if (f.x < b.x0 || f.z < b.z0 || f.x + f.w - 1 > b.x1 || f.z + f.d - 1 > b.z1) return null;
    for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) if (land.use[I(x, z)] !== Use.Lot) return null;
    // Every tile along its front faces the street, so nothing of it stands back off the street behind a yard.
    for (let k = 0; k < wide; k++) {
      const [tx, tz] = frontTile(f, k + 0.5);
      if (!frontsOn(I(tx, tz))) return null;
    }
    const door = frontTile(f, doorAt + 0.5);
    const di = I(door[0], door[1]);
    if (!frontsOn(di) || !land.open(di) || doors.has(di)) return null;
    return { ...f, door };
  };
  const place = (f: Footprint, kind: BuildingKind, id: string, extra: { interior?: string; sign?: string } = {}): BuildingData => {
    for (let z = f.z; z < f.z + f.d; z++) {
      for (let x = f.x; x < f.x + f.w; x++) {
        const i = I(x, z);
        land.use[i] = Use.Building;
        land.block(i);
      }
    }
    const data = building(id, style, kind, f, random, extra);
    if (extra.interior) {
      const di = I(f.door[0], f.door[1]);
      doors.add(di);
      land.use[di] = Use.Door;
    }
    buildings.push(data);
    return data;
  };

  const sidesOf = (b: Block): Side[] => SIDES.filter((s) => {
    // A side faces a street if the row past it does.
    const tiles = s.rot === 0 ? land.rect(b.x0, b.z1 + 1, b.x1, b.z1 + 1) : s.rot === 2 ? land.rect(b.x0, b.z0 - 1, b.x1, b.z0 - 1) : s.rot === 1 ? land.rect(b.x0 - 1, b.z0, b.x0 - 1, b.z1) : land.rect(b.x1 + 1, b.z0, b.x1 + 1, b.z1);
    return tiles.filter(frontsOn).length >= tiles.length / 2;
  });
  const sideLength = (b: Block, s: Side) => (s.rot % 2 === 0 ? b.x1 - b.x0 + 1 : b.z1 - b.z0 + 1);
  const sideDepth = (b: Block, s: Side) => (s.rot % 2 === 0 ? b.z1 - b.z0 + 1 : b.x1 - b.x0 + 1);

  /** A town building, as near a point as a block's side lets it stand, facing south, west or east (its door seen). */
  const special = (size: readonly [number, number], near: readonly [number, number], spread: number): Footprint | null => {
    let best: { f: Footprint; score: number } | null = null;
    for (const b of blocks) {
      for (const s of sidesOf(b)) {
        if (s.rot === 2) continue;
        const [wide, deep0] = size;
        const deep = Math.min(deep0, sideDepth(b, s) - 1);
        if (deep < 5) continue;
        const length = sideLength(b, s);
        for (let at = 0; at + wide <= length; at++) {
          const f = fit(b, s, at, wide, deep, Math.floor(wide / 2));
          if (!f) continue;
          const score = Math.hypot(f.door[0] - near[0], f.door[1] - near[1]) + (s.rot === 0 ? 0 : 5) + random() * spread;
          if (!best || score < best.score) best = { f, score };
        }
      }
    }
    return best?.f ?? null;
  };
  const addInterior = (f: Footprint, kind: BuildingKind, id: string, title: string, room: InteriorKind, extra: Partial<InteriorSpec> = {}) => {
    place(f, kind, id, { interior: id, sign: title });
    interiors.push({ id, name: title, kind: room, town: plan.id, style, exit: f.door, ...extra });
  };

  // The inn on the square, facing it from the north where it can.
  const innSize = SIZE[`inn-${plan.kind}`]!;
  const innAt = special(innSize, [cx, cz - SQ - 1], 1) ?? special([innSize[0] - 2, innSize[1] - 1], [cx, cz], 4);
  if (!innAt) throw new Error(`${plan.id}: no room for the inn`);
  addInterior(innAt, "inn", `${plan.id}-inn`, plan.inn, "inn", { innkeeper: { name: `The keeper of ${plan.inn}`, text: plan.innkeeper }, spellTable: true });

  // The shops round the square and the market; the exotic wares shop among them.
  spec.vendors.forEach((v, k) => {
    const target: readonly [number, number] = market && k % 2 === 1 ? market : [cx + (k % 3 - 1) * SQ, cz + (k % 2 === 0 ? -SQ : SQ)];
    const f = special(SIZE.shop!, target, 6);
    if (!f) throw new Error(`${plan.id}: no room for ${v.id}'s shop`);
    addInterior(f, "shop", `${v.id}-shop`, v.name, "shop", { vendor: v });
  });
  if (spec.exotic) {
    const f = special(SIZE.exotic!, market ?? [cx, cz + SQ], 4);
    if (!f) throw new Error(`${plan.id}: no room for the exotic wares shop`);
    addInterior(f, "shop", `${spec.exotic.id}-shop`, spec.exotic.name, "exotic-wares", { vendor: spec.exotic });
  }
  const off = Math.round(R * 0.4);
  if (!village) {
    const guild = special(SIZE.guildhall!, [cx + off, cz - off], 8);
    if (guild) addInterior(guild, "guildhall", `${plan.id}-guildhall`, plan.guild, "guildhall", { spellTable: true, resident: { name: "Guild master", text: ["Our tables are open to any mage. Build your deck in peace."] } });
    const temple = special(SIZE.temple!, [cx - off, cz - off], 8);
    if (temple) addInterior(temple, "temple", `${plan.id}-temple`, plan.temple, "temple", { resident: { name: "Priest", text: ["Rest a while. The wells of Dominaria remember the faithful."] } });
    const tower = style === "tolarian";
    const library = special(SIZE[tower ? "tower" : "library"]!, [cx - off, cz + off], 8);
    if (library) {
      const title = tower ? `The ${plan.name} Mage's Tower` : `The ${plan.name} Library`;
      addInterior(library, tower ? "tower" : "library", `${plan.id}-${tower ? "tower" : "library"}`, title, tower ? "tower" : "library", {
        resident: { name: tower ? "Archmage" : "Librarian", text: ["Every card ever printed is written down somewhere. Most of them here."] },
      });
    }
    const gate = [...gates.values()][0]!;
    const smithy = special(SIZE.smithy!, [land.xOf(gate), land.zOf(gate)], 10);
    if (smithy) addInterior(smithy, "smithy", `${plan.id}-smithy`, `The ${plan.name} Smithy`, "smithy", { armorer: true });
  } else {
    const shrine = special(SIZE.shrine!, [cx, cz + SQ], 6);
    if (shrine) addInterior(shrine, "temple", `${plan.id}-shrine`, `The ${plan.name} Shrine`, "temple", { resident: { name: "Hermit", text: ["The road is long. Sit, and let it wait for you."] } });
  }

  // Houses with doors, spread about the town.
  const homes = capital ? 10 : village ? 3 : 6;
  for (let n = 1; n <= homes; n++) {
    const angle = random() * Math.PI * 2;
    const reach = R * (0.35 + random() * 0.45);
    const f = special(SIZE.house!, [cx + Math.cos(angle) * reach, cz + Math.sin(angle) * reach], 14);
    if (!f) break;
    const folk = plan.folk[(n - 1) % Math.max(1, plan.folk.length)];
    addInterior(f, "house", `${plan.id}-house-${n}`, `A house in ${plan.name}`, "house", n <= plan.folk.length && folk ? { resident: folk } : {});
  }

  // The rest: rows round every block, south fronts first, then west and east, then north; tenements toward the middle of
  // a big town, warehouses by the harbour and the gates, barns in a village.
  const harbourGate: number | null = harbour ? outsideOf(harbour) : null;
  let count = 0;
  const generic = (b: Block, s: Side) => {
    const length = sideLength(b, s);
    const depth = sideDepth(b, s);
    const maxDeep = depth >= 12 ? Math.floor((depth - 1) / 2) : depth - 1;
    if (maxDeep < 4) return;
    let at = 0;
    while (at < length) {
      const near = cheb(s.rot % 2 === 0 ? b.x0 + at : b.x0, s.rot % 2 === 0 ? b.z0 : b.z0 + at) / R;
      const byHarbour = harbourGate !== null && Math.hypot(land.xOf(harbourGate) - (b.x0 + b.x1) / 2, land.zOf(harbourGate) - (b.z0 + b.z1) / 2) < R * 0.45;
      const kind: BuildingKind = byHarbour && random() < 0.5 ? "warehouse" : !village && near < 0.6 && random() < (capital ? 0.55 : 0.3) ? "tenement" : village && random() < 0.15 ? "barn" : "house";
      const wide = kind === "warehouse" ? between(random, 9, 12) : kind === "tenement" ? between(random, 6, 9) : kind === "barn" ? between(random, 7, 9) : between(random, 5, 8);
      const deep = Math.min(maxDeep, kind === "warehouse" ? 7 : kind === "tenement" ? between(random, 6, 7) : between(random, 5, 6));
      const f = deep >= 4 && at + wide <= length ? fit(b, s, at, wide, deep, between(random, 1, wide - 2)) : null;
      if (f) {
        place(f, kind, `${plan.id}-b${++count}`);
        at += wide + (capital ? (random() < 0.7 ? 0 : 1) : between(random, 0, 2));
      } else at++;
    }
  };
  for (const rot of [0, 1, 3, 2]) for (const b of blocks) for (const s of sidesOf(b)) if (s.rot === rot) generic(b, s);

  // What is left of the lots is yards and gardens.
  for (const i of land.rect(cx - R, cz - R, cx + R, cz + R)) {
    if (land.use[i] !== Use.Lot) continue;
    land.use[i] = Use.Yard;
    land.surface[i] = ground.yard;
  }

  // --- Outdoors: the square, lamps, wares, people -----------------------------------------------------------------

  const props = land.fixtures;
  const npcs: NpcData[] = [];
  const reserved = new Set<number>();
  /** Whether a tile may take something that blocks it: open paving of a street or square, never at a door, never closing a way. */
  const free = (i: number) => {
    if (!land.open(i) || reserved.has(i) || (land.use[i] !== Use.Street && land.use[i] !== Use.Kept)) return false;
    const near: number[] = [];
    if (land.n8(i, near).some((j) => doors.has(j) || land.use[j] === Use.Door || reserved.has(j))) return false;
    return safeToBlock(land, i);
  };
  const stand = (i: number) => land.block(i);

  // The centrepiece, filling the square's middle.
  const centre: Record<string, { id: string; size: number }> = {
    fountain: { id: "fountain", size: 3 },
    statue: { id: "statue", size: 3 },
    well: { id: "well", size: 2 },
    crystal: { id: "crystal", size: 2 },
    tree: { id: "giant-tree", size: 4 },
    brazier: { id: "brazier", size: 2 },
  };
  const piece = centre[plan.centrepiece] ?? centre.fountain!;
  const p0 = -Math.floor(piece.size / 2);
  for (const i of land.rect(cx + p0, cz + p0, cx + p0 + piece.size - 1, cz + p0 + piece.size - 1)) stand(i);
  props.push({ id: piece.id, x: cx + p0 + piece.size / 2, z: cz + p0 + piece.size / 2, ...(piece.id === "statue" || piece.id === "giant-tree" ? { args: { size: piece.size } } : {}) });

  // Benches round the centrepiece, lamps at the square's corners and along the avenues.
  for (const [dx, dz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const bx = cx + dx * (piece.size + 2);
    const bz = cz + dz * (piece.size + 2);
    const i = I(bx, bz);
    if (free(i)) {
      stand(i);
      props.push({ id: "bench", x: bx + 0.5, z: bz + 0.5, args: { width: 1.2 } });
    }
    const lx = cx + dx * SQ;
    const lz = cz + dz * SQ;
    if (free(I(lx, lz))) {
      stand(I(lx, lz));
      props.push({ id: "lamp-post", x: lx + 0.5, z: lz + 0.5 });
    }
  }
  for (let s = SQ + 6; s < R - lane - 1; s += 11) {
    for (const [x, z] of [
      [cx - a - 1 + 1, cz - s],
      [cx + a, cz + s],
      [cx - s, cz + a],
      [cx + s, cz - a],
    ] as const) {
      // A lamp at the edge of the avenue, against the building line.
      const i = I(x, z);
      if (free(i) && land.n4(i).some((j) => land.use[j] === Use.Building)) {
        stand(i);
        props.push({ id: "lamp-post", x: x + 0.5, z: z + 0.5 });
      }
    }
  }

  // The market: rows of stalls, wares heaped by them.
  const goods = ["apples", "cabbages", "carrots", "bread", "fish"];
  const stalls = (at: readonly [number, number], halfSize: number) => {
    for (let z = at[1] - halfSize + 2; z <= at[1] + halfSize - 3; z += 5) {
      for (let x = at[0] - halfSize + 2; x <= at[0] + halfSize - 4; x += 6) {
        const tiles = land.rect(x, z, x + 2, z);
        if (!tiles.every(free)) continue;
        for (const i of tiles) stand(i);
        props.push({ id: "market-stall", x, z: z + 0.8, args: { width: 3 } });
        const c = I(x + 3, z);
        if (free(c)) {
          stand(c);
          props.push({ id: "crate", x: x + 3.5, z: z + 0.5, args: { goods: pick(random, goods) } });
        }
      }
    }
  };
  if (market) stalls(market, 10);
  else if (!village) stalls([cx + Math.round(SQ / 2) + 1, cz + Math.round(SQ / 2) + 1], Math.floor(SQ / 2) - 1);

  // The caravans' pitch: open paving, open all round, in the market (or the square).
  let pitch: { x: number; z: number } | null = null;
  if (plan.caravan) {
    const where = market ?? [cx, cz];
    const reach = market ? 8 : SQ - 2;
    const options = land
      .rect(where[0] - reach, where[1] - reach, where[0] + reach, where[1] + reach)
      .filter((i) => land.use[i] === Use.Kept && land.open(i) && land.n8(i).every((j) => land.open(j) && land.use[j] === Use.Kept && !reserved.has(j)))
      .sort((p, q) => Math.abs(cheb(land.xOf(q), land.zOf(q)) - 0) - Math.abs(cheb(land.xOf(p), land.zOf(p)) - 0) || p - q);
    const spot = options.find((i) => Math.max(Math.abs(land.xOf(i) - where[0]), Math.abs(land.zOf(i) - where[1])) >= reach - 2) ?? options[0];
    if (spot === undefined) throw new Error(`${plan.id}: no room for the caravan pitch`);
    pitch = { x: land.xOf(spot), z: land.zOf(spot) };
    for (const j of [spot, ...land.n8(spot)]) reserved.add(j);
  }

  // The quest board by the inn's door.
  const innDoor = I(innAt.door[0], innAt.door[1]);
  const boardAt = land
    .disc(innAt.door[0], innAt.door[1], 6)
    .filter((i) => free(i) && land.n4(i).some((j) => land.use[j] === Use.Building))
    .sort((p, q) => dist(land, p, innDoor) - dist(land, q, innDoor) || p - q)[0];
  if (boardAt === undefined) throw new Error(`${plan.id}: no room for the quest board`);
  stand(boardAt);
  const bx = land.xOf(boardAt);
  const bz = land.zOf(boardAt);
  props.push({ id: "quest-board", x: bx + 0.5, z: bz + 0.5, rot: innAt.rot });
  npcs.push({ id: `${plan.id}-quest-board`, x: bx, z: bz, kind: "quest-board", name: village ? "Notice board" : "Quest board", text: plan.board, stand: [bx + 0.5, level / 16, bz + 0.5] });

  // The arena, closed: its gate on the plaza.
  if (arena) {
    const i = I(arena[0], arena[1]);
    for (const j of land.rect(arena[0] - 1, arena[1] - 1, arena[0] + 1, arena[1])) stand(j);
    props.push({ id: "arena-gate", x: arena[0] + 0.5, z: arena[1] + 0.5, rot: 0 });
    npcs.push({ id: `${plan.id}-arena`, x: land.xOf(i), z: land.zOf(i), kind: "arena", name: "The arena", text: ["The arena is closed. A sign reads: coming soon."], stand: [arena[0] + 0.5, level / 16, arena[1] + 0.5] });
  }

  // Guards in the gates, pacing the avenue inside; townsfolk about the square.
  const figures = FOLK_FIGURES[style] ?? FOLK_FIGURES.benalish!;
  let k = 0;
  for (const side of SIDES.filter((s) => gateSides.has(s))) {
    const ax = cx + side.dx * (R - lane - 2) + (side.dz !== 0 ? a : 0);
    const az = cz + side.dz * (R - lane - 2) + (side.dx !== 0 ? a : 0);
    const bx2 = cx + side.dx * (R - lane - 10) + (side.dz !== 0 ? a : 0);
    const bz2 = cz + side.dz * (R - lane - 10) + (side.dx !== 0 ? a : 0);
    if (!land.open(I(ax, az)) || !land.open(I(bx2, bz2))) continue;
    npcs.push({
      id: `${plan.id}-guard-${++k}`,
      x: ax,
      z: az,
      kind: "guard",
      name: `${plan.name} guard`,
      text: ["Keep to the roads. The waymarkers say how bad it gets past them."],
      figure: figures.guard,
      speed: 2.2,
      behaviour: { beat: { stops: [[ax, az], [bx2, bz2]], pause: 3.5 }, watch: 4 },
    });
  }
  plan.folk.forEach((folk, n) => {
    const angle = (n * 2.4 + 0.6) % (Math.PI * 2);
    const home = [Math.round(cx + Math.cos(angle) * (piece.size + 4)), Math.round(cz + Math.sin(angle) * (piece.size + 4))] as const;
    const at = land.disc(home[0], home[1], 4).filter((i) => land.open(i) && land.use[i] === Use.Kept && !reserved.has(i)).sort((p, q) => p - q)[0];
    if (at === undefined) return;
    npcs.push({
      id: `${plan.id}-folk-${n + 1}`,
      x: land.xOf(at),
      z: land.zOf(at),
      kind: "townsfolk",
      name: folk.name,
      text: folk.text,
      figure: figures.folk[n % figures.folk.length]!,
      speed: 1.6,
      seed: n + 1,
      behaviour: { wander: { home: [land.xOf(at), land.zOf(at)], reach: 4, pause: [2, 6] }, watch: 3 },
    });
  });

  // Gardens in the yards: trees and bushes, flower beds, now and then a well or a wood pile.
  const yardTrees = style === "urborg" ? ["dead-tree", "swamp-tree"] : style === "keldon" ? ["pine"] : style === "llanowar" ? ["tree", "great-tree"] : ["tree"];
  for (const i of land.rect(cx - R, cz - R, cx + R, cz + R)) {
    if (land.use[i] !== Use.Yard || !land.open(i)) continue;
    const x = land.xOf(i);
    const z = land.zOf(i);
    const roll = random();
    if (roll < 0.12) land.put(i, { id: pick(random, yardTrees), x: texel(x + 0.5), z: texel(z + 0.5), seed: between(random, 0, 15), scale: texel(0.8 + random() * 0.3) });
    else if (roll < 0.2) land.put(i, { id: "bush", x: x + 0.5, z: z + 0.5, seed: between(random, 0, 15), ...(random() < 0.4 ? { args: { flowering: true } } : {}) });
    else if (roll < 0.25) land.put(i, { id: "flower-bed", x: x + 0.5, z: z + 0.5 });
    else if (roll < 0.26) land.put(i, { id: village ? "hay-bale" : "wood-pile", x: x + 0.5, z: z + 0.5 });
  }

  // The harbour's pier, out from its gate into the water, with a crate or two on it.
  if (harbour && harbourGate !== null) {
    const hx = land.xOf(harbourGate);
    const hz = land.zOf(harbourGate);
    let wet = 0;
    let end = 0;
    for (let s = 0; s <= 46 && wet < 9; s++) {
      const x = hx + harbour.dx * s;
      const z = hz + harbour.dz * s;
      if (!land.inside(x, z)) break;
      for (let t = -1; t <= 1; t++) {
        const px = x + (harbour.dz !== 0 ? t : 0);
        const pz = z + (harbour.dx !== 0 ? t : 0);
        const i = I(px, pz);
        if (land.isSea(i)) {
          land.clear(i, S.planks);
          land.use[i] = Use.Dock;
          land.height[i] = Math.max(2, level - 2);
        } else if (land.use[i] !== Use.Wall) {
          land.clear(i, S.planks);
          land.use[i] = Use.Kept;
        }
      }
      if (land.isSea(I(x + harbour.dx, z + harbour.dz)) || wet > 0) wet++;
      end = s;
    }
    if (end > 0) {
      const ax = Math.min(hx, hx + harbour.dx * end) - (harbour.dz !== 0 ? 1 : 0);
      const az = Math.min(hz, hz + harbour.dz * end) - (harbour.dx !== 0 ? 1 : 0);
      const bx3 = Math.max(hx, hx + harbour.dx * end) + (harbour.dz !== 0 ? 1 : 0);
      const bz3 = Math.max(hz, hz + harbour.dz * end) + (harbour.dx !== 0 ? 1 : 0);
      props.push({ id: "pier", x: ax, z: az, args: { to: [bx3 + 1, bz3 + 1] } });
    }
  }

  return {
    data: {
      id: plan.id,
      name: plan.name,
      kind: plan.kind,
      center: [cx, cz],
      radius: R,
      style,
      ...(spec.color ? { region: spec.color } : {}),
      start: plan.start,
      ...(plan.home ? { home: plan.home } : {}),
    },
    buildings,
    interiors,
    npcs,
    gates,
    inn: { x: innAt.door[0], z: innAt.door[1], interior: `${plan.id}-inn` },
    pitch,
  };
}

const dist = (land: Land, a: number, b: number) => Math.hypot(land.xOf(a) - land.xOf(b), land.zOf(a) - land.zOf(b));

/**
 * Whether blocking an open tile leaves every way past it open: its open neighbours, walked round it as the overworld
 * walks (eight ways, no corner cut past a blocked tile), are still one run - whoever walked through it can walk round.
 */
export function safeToBlock(land: Land, i: number): boolean {
  const x = land.xOf(i);
  const z = land.zOf(i);
  const ring: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const open = ring.map(([dx, dz]) => land.inside(x + dx, z + dz) && land.open(land.idx(x + dx, z + dz)));
  // Walk the ring: a corner tile joins its two sides only through itself, so runs of open tiles round the ring, each
  // diagonal counted only where it is reached from an open side.
  let runs = 0;
  let any = false;
  for (let k = 0; k < 8; k++) {
    if (!open[k]) continue;
    any = true;
    const prev = (k + 7) % 8;
    if (!open[prev]) runs++;
  }
  if (!any) return false;
  if (runs === 0) return true;
  // A corner open but both its sides closed is cut off from the rest once the middle is blocked.
  for (let k = 0; k < 8; k += 2) if (open[k] && !open[(k + 7) % 8] && !open[(k + 1) % 8]) return false;
  return runs <= 1;
}

/** The town's walls: towers at the corners and beside each gate, and runs of wall between them, cut at chunk edges. */
function wallProps(land: Land, plan: TownLayout, cx: number, cz: number, R: number, gateSides: readonly Side[], half: number): void {
  const style = plan.style;
  const args = { style, size: plan.kind };
  const towers: [number, number][] = [
    [cx - R, cz - R],
    [cx + R, cz - R],
    [cx - R, cz + R],
    [cx + R, cz + R],
  ];
  for (const side of gateSides) {
    for (const t of [-half - 1, half + 1]) towers.push(side.dx !== 0 ? [cx + side.dx * R, cz + t] : [cx + t, cz + side.dz * R]);
  }
  for (const [x, z] of towers) land.fixtures.push({ id: "wall-tower", x: x + 0.5, z: z + 0.5, args });
  const isTower = (x: number, z: number) => towers.some(([tx, tz]) => tx === x && tz === z);
  const isGate = (x: number, z: number) =>
    gateSides.some((s) => (s.dx !== 0 ? x === cx + s.dx * R && Math.abs(z - cz) <= half : z === cz + s.dz * R && Math.abs(x - cx) <= half));
  const runs = (face: string, tiles: [number, number][]) => {
    let start: [number, number] | null = null;
    let last: [number, number] | null = null;
    const flush = () => {
      if (start && last) land.fixtures.push({ id: "wall-run", x: start[0] + 0.5, z: start[1] + 0.5, args: { to: [last[0] + 0.5, last[1] + 0.5], face, ...args } });
      start = null;
      last = null;
    };
    for (const [x, z] of tiles) {
      if (isTower(x, z) || isGate(x, z)) {
        flush();
        continue;
      }
      // A run stops at a chunk's edge and after 16 tiles, so each chunk draws its own.
      if (start && (Math.floor(x / 32) !== Math.floor(start[0] / 32) || Math.floor(z / 32) !== Math.floor(start[1] / 32) || Math.abs(x - start[0]) + Math.abs(z - start[1]) >= 16)) flush();
      if (!start) start = [x, z];
      last = [x, z];
    }
    flush();
  };
  const line = (fixed: "x" | "z", value: number) => {
    const out: [number, number][] = [];
    for (let t = -R; t <= R; t++) out.push(fixed === "z" ? [cx + t, value] : [value, cz + t]);
    return out;
  };
  runs("n", line("z", cz - R));
  runs("s", line("z", cz + R));
  runs("w", line("x", cx - R));
  runs("e", line("x", cx + R));
}

export type { PropData };
