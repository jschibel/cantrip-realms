// Towns (design.md A6) on square tiles, each laid out by its form (layout.ts, `Form`) and built in its region's style.
//
// A town's outline is a rough polygon hugging the land - pulled in from the coast, a river or a cliff, its corners
// wandering - within the square of its `radius` (what the server calls the town). A walled town's wall runs along it
// (a palisade round a Keldon clan, hedges round a village, nothing round an elfhame or the Morass's stilt village),
// with a gate where each road arrives and one onto the harbour. From each gate a main street bends through the land to
// the central square; lanes branch from the main streets irregularly, some meeting others, some ending in a yard; plazas
// open where the town needs them - the capital's market, a cathedral's close, the arena, a campus's courtyards.
//
// The town is cut into districts round seeds - the market quarter round the square, a temple close, the keep or the
// nobles' manors (New Benalia's citadel and the Seven Houses), the artisans' quarter by a gate, the harbour, quiet
// residential streets, poorer outskirts by the walls, parks, orchards and allotments - and each district builds its
// own way: terraced rows along the main streets, detached houses with yards toward the edge, warehouses by the water,
// longhouses in a clan, tree-houses spread among giant trees. The landmarks come first and much bigger (the citadel, the
// cathedral, the great hall, the manor), then the town's own buildings where they belong (the inn on a main street by a
// gate, the shops round the square and the market, the smithy among the artisans), then the rows. Every building faces
// the street before it, its door that street tile; one with an interior faces south, west or east, never away from the
// camera. Outdoors: the centrepiece, benches and lamps, market stalls, the quest board by the inn's door, guards in the
// gates, townsfolk on the square, the arena, the caravans' pitch, gardens, orchard rows and the harbour's pier.

import type { BuildingData, InteriorKind, NpcData, PropData, Region, TownData } from "../../src/world/format";
import { type Footprint, building } from "./buildings";
import { type BuildingKind, S } from "./ids";
import { type Land, Use, between, pick, randomFor, shuffle, texel } from "./land";
import type { Form, TownLayout } from "./layout";

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
  /** The road's end outside each gate (or each way in, where there is no wall) a road may arrive by. */
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
  /** Where the roads out of it go: a gate is made toward each. */
  readonly targets: readonly { readonly id: string; readonly at: readonly [number, number] }[];
  readonly vendors: readonly { readonly id: string; readonly name: string }[];
  readonly exotic: { readonly id: string; readonly name: string } | null;
}

// --- Forms and districts -------------------------------------------------------------------------------------------

type District = "market" | "temple" | "keep" | "noble" | "artisan" | "harbour" | "residential" | "outskirts" | "park" | "orchard" | "allotments" | "grounds";

/** A district's seed: its angle (radians, from the town's own turn; or toward the first gate, the harbour, or away from
 * the first gate), how far out (a share of the town's reach), and how far its ground reaches against its neighbours'. */
interface Seed {
  readonly kind: District;
  readonly angle: number | "gate" | "harbour" | "away";
  readonly at: number;
  readonly weight: number;
}

interface FormSpec {
  readonly enclosure: "wall" | "palisade" | "hedge" | "none";
  /** The central square's half sizes along x and z, or its radius when round. */
  readonly square: readonly [number, number];
  readonly round: boolean;
  readonly main: number;
  readonly lane: number;
  /** How far a main street wanders off the straight, a share of its length. */
  readonly bend: number;
  readonly laneEvery: readonly [number, number];
  readonly laneLength: readonly [number, number];
  readonly laneChance: number;
  /** How far the outline's corners pull in, a share of the radius. */
  readonly shape: number;
  readonly districts: readonly Seed[];
  readonly guards: boolean;
}

const FORMS: Record<Form, FormSpec> = {
  capital: {
    enclosure: "wall",
    square: [13, 9],
    round: false,
    main: 4,
    lane: 2,
    bend: 0.07,
    laneEvery: [7, 12],
    laneLength: [10, 26],
    laneChance: 0.85,
    shape: 0.14,
    guards: true,
    districts: [
      { kind: "market", angle: 0, at: 0, weight: 1.25 },
      { kind: "temple", angle: 2.2, at: 0.42, weight: 0.85 },
      { kind: "keep", angle: "away", at: 0.62, weight: 0.85 },
      { kind: "noble", angle: 4.0, at: 0.5, weight: 1 },
      { kind: "artisan", angle: "gate", at: 0.6, weight: 0.9 },
      { kind: "harbour", angle: "harbour", at: 0.78, weight: 0.9 },
      { kind: "residential", angle: 1.1, at: 0.58, weight: 1.1 },
      { kind: "residential", angle: 5.2, at: 0.62, weight: 1.1 },
      { kind: "park", angle: 3.1, at: 0.6, weight: 0.6 },
      { kind: "orchard", angle: 0.4, at: 0.85, weight: 0.55 },
    ],
  },
  city: {
    enclosure: "wall",
    square: [10, 7],
    round: false,
    main: 3,
    lane: 2,
    bend: 0.1,
    laneEvery: [7, 12],
    laneLength: [8, 20],
    laneChance: 0.8,
    shape: 0.18,
    guards: true,
    districts: [
      { kind: "market", angle: 0, at: 0, weight: 1.2 },
      { kind: "temple", angle: 2.4, at: 0.45, weight: 0.8 },
      { kind: "keep", angle: "away", at: 0.6, weight: 0.8 },
      { kind: "artisan", angle: "gate", at: 0.6, weight: 0.9 },
      { kind: "harbour", angle: "harbour", at: 0.75, weight: 0.9 },
      { kind: "residential", angle: 1.2, at: 0.6, weight: 1.1 },
      { kind: "residential", angle: 4.6, at: 0.6, weight: 1.1 },
      { kind: "orchard", angle: 3.6, at: 0.85, weight: 0.55 },
    ],
  },
  village: {
    enclosure: "hedge",
    square: [5, 4],
    round: false,
    main: 3,
    lane: 2,
    bend: 0.2,
    laneEvery: [6, 10],
    laneLength: [5, 12],
    laneChance: 0.6,
    shape: 0.22,
    guards: false,
    districts: [
      { kind: "market", angle: 0, at: 0, weight: 1 },
      { kind: "residential", angle: 1.5, at: 0.55, weight: 1.2 },
      { kind: "residential", angle: 4.5, at: 0.55, weight: 1.2 },
      { kind: "orchard", angle: 3, at: 0.8, weight: 0.6 },
      { kind: "allotments", angle: 0.2, at: 0.85, weight: 0.5 },
    ],
  },
  elfhame: {
    enclosure: "none",
    square: [8, 8],
    round: true,
    main: 2,
    lane: 2,
    bend: 0.28,
    laneEvery: [8, 14],
    laneLength: [8, 22],
    laneChance: 0.75,
    shape: 0.24,
    guards: false,
    districts: [
      { kind: "market", angle: 0, at: 0, weight: 1.1 },
      { kind: "temple", angle: 2, at: 0.5, weight: 0.8 },
      { kind: "artisan", angle: "gate", at: 0.55, weight: 0.8 },
      { kind: "residential", angle: 0.8, at: 0.6, weight: 1.2 },
      { kind: "residential", angle: 4.2, at: 0.6, weight: 1.2 },
      { kind: "park", angle: 3.2, at: 0.65, weight: 0.7 },
    ],
  },
  stilts: {
    enclosure: "none",
    square: [5, 4],
    round: false,
    main: 2,
    lane: 2,
    bend: 0.25,
    laneEvery: [6, 10],
    laneLength: [5, 12],
    laneChance: 0.75,
    shape: 0.25,
    guards: false,
    districts: [
      { kind: "market", angle: 0, at: 0, weight: 1 },
      { kind: "residential", angle: 1.6, at: 0.55, weight: 1.2 },
      { kind: "residential", angle: 4.4, at: 0.55, weight: 1.2 },
    ],
  },
  clan: {
    enclosure: "palisade",
    square: [10, 10],
    round: true,
    main: 3,
    lane: 2,
    bend: 0.18,
    laneEvery: [7, 11],
    laneLength: [8, 18],
    laneChance: 0.8,
    shape: 0.2,
    guards: true,
    districts: [
      { kind: "market", angle: 0, at: 0, weight: 1.3 },
      { kind: "artisan", angle: "gate", at: 0.6, weight: 0.9 },
      { kind: "harbour", angle: "harbour", at: 0.75, weight: 0.8 },
      { kind: "residential", angle: 1.3, at: 0.6, weight: 1.2 },
      { kind: "residential", angle: 3.6, at: 0.6, weight: 1.2 },
      { kind: "allotments", angle: 5.2, at: 0.8, weight: 0.5 },
    ],
  },
  campus: {
    enclosure: "none",
    square: [11, 8],
    round: false,
    main: 3,
    lane: 2,
    bend: 0.12,
    laneEvery: [12, 18],
    laneLength: [8, 16],
    laneChance: 0.5,
    shape: 0.16,
    guards: false,
    districts: [
      { kind: "market", angle: 0, at: 0, weight: 1.3 },
      { kind: "temple", angle: 2.5, at: 0.5, weight: 0.8 },
      { kind: "residential", angle: 0.9, at: 0.6, weight: 1.1 },
      { kind: "residential", angle: 4.4, at: 0.6, weight: 1.1 },
      { kind: "park", angle: 3.4, at: 0.65, weight: 0.8 },
    ],
  },
  estate: {
    enclosure: "wall",
    square: [9, 6],
    round: false,
    main: 3,
    lane: 2,
    bend: 0.12,
    laneEvery: [8, 12],
    laneLength: [6, 14],
    laneChance: 0.6,
    shape: 0.15,
    guards: true,
    districts: [
      { kind: "market", angle: 0, at: 0, weight: 1.1 },
      { kind: "grounds", angle: -Math.PI / 2, at: 0.55, weight: 1.3 },
      { kind: "temple", angle: 2.6, at: 0.55, weight: 0.8 },
      { kind: "artisan", angle: "gate", at: 0.6, weight: 0.8 },
      { kind: "residential", angle: 0.6, at: 0.6, weight: 1 },
      { kind: "orchard", angle: 3.8, at: 0.75, weight: 0.6 },
    ],
  },
};

/** How a district builds along its streets: kinds by weight, tiles across the front and deep, the gap between, how often
 * a lot is left open. Null: it builds nothing (gardens, orchards). */
interface Fill {
  readonly kinds: readonly (readonly [BuildingKind, number])[];
  readonly wide: readonly [number, number];
  readonly deep: readonly [number, number];
  readonly gap: readonly [number, number];
  readonly skip: number;
}

function fillFor(form: Form, district: District): Fill | null {
  if (district === "park" || district === "orchard" || district === "allotments" || district === "grounds") return null;
  if (form === "clan") return { kinds: [["house", 4], ["barn", 1]], wide: [5, 7], deep: [10, 13], gap: [1, 3], skip: 0.15 };
  if (form === "elfhame") return { kinds: [["house", 1]], wide: [5, 7], deep: [5, 6], gap: [3, 6], skip: 0.35 };
  if (form === "stilts") return { kinds: [["house", 5], ["warehouse", 1]], wide: [5, 7], deep: [5, 6], gap: [1, 2], skip: 0.15 };
  if (form === "campus") return { kinds: [["house", 2], ["library", 1], ["tower", 1]], wide: [8, 12], deep: [7, 9], gap: [0, 1], skip: 0.1 };
  switch (district) {
    case "market":
      return { kinds: [["tenement", 3], ["house", 2], ["shop", 1]], wide: [5, 7], deep: [6, 8], gap: [0, 0], skip: 0.03 };
    case "temple":
      return { kinds: [["house", 3], ["library", 1]], wide: [6, 8], deep: [6, 7], gap: [1, 2], skip: 0.15 };
    case "keep":
      return { kinds: [["warehouse", 2], ["barn", 1]], wide: [9, 13], deep: [7, 8], gap: [1, 2], skip: 0.2 };
    case "noble":
      return { kinds: [["house", 1]], wide: [9, 11], deep: [8, 9], gap: [3, 5], skip: 0.25 };
    case "artisan":
      return { kinds: [["house", 2], ["warehouse", 1], ["barn", 1]], wide: [6, 9], deep: [6, 8], gap: [0, 1], skip: 0.08 };
    case "harbour":
      return { kinds: [["warehouse", 4], ["house", 1]], wide: [9, 13], deep: [7, 8], gap: [1, 1], skip: 0.08 };
    case "outskirts":
      return { kinds: [["house", 4], ["barn", 1]], wide: [5, 7], deep: [5, 6], gap: [2, 4], skip: 0.3 };
    default:
      return form === "village"
        ? { kinds: [["house", 4], ["barn", 1]], wide: [5, 7], deep: [5, 6], gap: [2, 3], skip: 0.2 }
        : { kinds: [["house", 3], ["tenement", form === "capital" ? 2 : 1]], wide: [5, 8], deep: [5, 7], gap: [0, 1], skip: 0.06 };
  }
}

interface Ground {
  readonly lot: number;
  readonly street: number;
  readonly lane: number;
  readonly square: number;
  readonly yard: number;
}

const GROUNDS: Record<string, Ground> = {
  benalish: { lot: S.grass, street: S.cobbles, lane: S.cobbles, square: S.flagstones, yard: S.grass },
  llanowar: { lot: S["forest-floor"], street: S.dirt, lane: S.dirt, square: S.moss, yard: S["forest-floor"] },
  urborg: { lot: S.mud, street: S.planks, lane: S.planks, square: S.planks, yard: S.moss },
  keldon: { lot: S.tundra, street: S.dirt, lane: S.dirt, square: S.flagstones, yard: S.tundra },
  tolarian: { lot: S.grass, street: S.flagstones, lane: S.flagstones, square: S.flagstones, yard: S.grass },
  argive: { lot: S.grass, street: S.cobbles, lane: S.cobbles, square: S.flagstones, yard: S.grass },
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

/** Lights along a main street, by style. */
const STREET_LIGHT: Record<string, string | null> = { benalish: "lamp-post", tolarian: "lamp-post", keldon: "brazier", urborg: "brazier", llanowar: null, argive: "lamp-post" };

/** Steps edge to edge, and the front each faces a street across: rot 0 south, 1 west, 2 north, 3 east. */
const DIRS = [
  { dx: 0, dz: 1, rot: 2 },
  { dx: -1, dz: 0, rot: 3 },
  { dx: 0, dz: -1, rot: 0 },
  { dx: 1, dz: 0, rot: 1 },
] as const;

/** The quarter turn a direction faces: out of a gate, the way a building's front looks. */
const rotOf = (ux: number, uz: number): number => (Math.abs(ux) > Math.abs(uz) ? (ux > 0 ? 3 : 1) : uz > 0 ? 0 : 2);

/** The footprint of a building whose door, `k` tiles along its front from the front's left end as drawn, is `door`. */
export function footprintAt(door: readonly [number, number], rot: number, wide: number, deep: number, k: number): Footprint {
  const [dx, dz] = door;
  switch (rot) {
    case 0:
      return { x: dx - k, z: dz - deep, w: wide, d: deep, rot, door };
    case 2:
      return { x: dx + k + 1 - wide, z: dz + 1, w: wide, d: deep, rot, door };
    case 1:
      return { x: dx + 1, z: dz - k, w: deep, d: wide, rot, door };
    default:
      return { x: dx - deep, z: dz - wide + 1 + k, w: deep, d: wide, rot, door };
  }
}

/** Sizes of the town's own buildings, tiles across the front and deep, by form. */
function sizeOf(form: Form, what: string): readonly [number, number] {
  const big = form === "capital";
  const table: Record<string, readonly [number, number]> = {
    inn: big ? [14, 10] : form === "village" || form === "stilts" ? [10, 7] : [12, 9],
    shop: [8, 6],
    exotic: [9, 7],
    guildhall: big ? [16, 12] : form === "campus" ? [18, 12] : [13, 10],
    temple: big ? [16, 22] : form === "clan" ? [22, 12] : form === "city" ? [13, 16] : [11, 12],
    library: big ? [12, 10] : [10, 8],
    tower: [9, 9],
    smithy: [9, 7],
    shrine: [7, 6],
    house: form === "clan" ? [6, 11] : [7, 6],
  };
  return table[what] ?? [7, 6];
}

// --- The town --------------------------------------------------------------------------------------------------------

export function buildTown(land: Land, spec: TownSpec, seed: number): BuiltTown {
  const { plan } = spec;
  const form: Form = plan.form ?? (plan.kind === "capital" ? "capital" : plan.kind === "village" ? "village" : "city");
  const F = FORMS[form];
  const random = randomFor(seed, `town:${plan.id}`);
  const R = plan.radius;
  const [cx, cz] = plan.at;
  const tag = spec.index + 1;
  const style = plan.style;
  const ground = form === "stilts" ? { ...GROUNDS.urborg!, lot: S.bog } : (GROUNDS[style] ?? GROUNDS.benalish!);
  const village = plan.kind === "village";
  const I = (x: number, z: number) => land.idx(x, z);
  const x0 = cx - R;
  const z0 = cz - R;
  const span = 2 * R + 1;
  const local = (x: number, z: number) => (z - z0) * span + (x - x0);
  const inSquare = (x: number, z: number) => Math.abs(x - cx) <= R && Math.abs(z - cz) <= R;

  // --- The outline: a polygon round the centre, its corners pulled in by the land ------------------------------------

  const turn = random() * Math.PI * 2;
  const corners = form === "village" || form === "stilts" || R < 30 ? 9 : 13;
  const obstacle = (x: number, z: number) => {
    if (!land.inside(x, z)) return true;
    const i = I(x, z);
    return land.isSea(i) || land.surface[i] === S.stream || (!land.open(i) && land.height[i]! > 60);
  };
  const reach = (angle: number) => {
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    for (let t = 1; t < R * 1.6; t += 0.5) if (obstacle(Math.round(cx + ux * t), Math.round(cz + uz * t))) return t - 3;
    return R * 1.6;
  };
  let radii: number[] = [];
  const angles: number[] = [];
  for (let k = 0; k < corners; k++) {
    const angle = turn + (k + (random() - 0.5) * 0.5) * ((Math.PI * 2) / corners);
    angles.push(angle);
    const most = (R - 1) / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
    const wanted = R * (1 - F.shape * random()) * (most / R) ** 0.35;
    radii.push(Math.max(R * 0.55, Math.min(wanted, reach(angle), most)));
  }
  radii = radii.map((r, k) => {
    const most = (R - 1) / Math.max(Math.abs(Math.cos(angles[k]!)), Math.abs(Math.sin(angles[k]!)));
    return Math.min(most, (radii[(k + corners - 1) % corners]! + 2 * r + radii[(k + 1) % corners]!) / 4);
  });
  const poly = angles.map((a, k) => [Math.round(cx + Math.cos(a) * radii[k]!), Math.round(cz + Math.sin(a) * radii[k]!)] as const);
  const inPoly = (x: number, z: number) => {
    let inside = false;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
      const [xi, zi] = poly[k]!;
      const [xj, zj] = poly[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  /** Each edge's tiles, corner to corner, eight-connected (so it closes the way to whoever walks without cutting corners). */
  const edges = poly.map((a, k) => line(a, poly[(k + 1) % poly.length]!));
  const ring = new Set<number>();
  for (const e of edges) for (const [x, z] of e) ring.add(local(x, z));
  const inside = new Uint8Array(span * span);
  for (let z = z0; z < z0 + span; z++) for (let x = x0; x < x0 + span; x++) if (inPoly(x, z) || ring.has(local(x, z))) inside[local(x, z)] = 1;
  const within = (x: number, z: number) => inSquare(x, z) && inside[local(x, z)] === 1;
  const onRing = (x: number, z: number) => inSquare(x, z) && ring.has(local(x, z));
  const walled = F.enclosure !== "none";

  // --- The site: levelled and cleared inside, an apron round it ------------------------------------------------------

  const heights: number[] = [];
  for (let z = z0; z < z0 + span; z++) for (let x = x0; x < x0 + span; x++) if (within(x, z) && !land.isWater(I(x, z)) && land.open(I(x, z))) heights.push(land.height[I(x, z)]!);
  heights.sort((a, b) => a - b);
  const level = Math.max(1, heights[Math.floor(heights.length / 2)] ?? 2);
  // How far outside the outline each tile lies, near enough (the ring's tiles at 0).
  const outside = new Map<number, number>();
  for (const i of land.rect(x0 - 8, z0 - 8, x0 + span + 7, z0 + span + 7)) {
    const x = land.xOf(i);
    const z = land.zOf(i);
    if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) <= R + 6) land.townArea[i] = 1;
    if (within(x, z)) continue;
    let d = Infinity;
    for (const e of edges) for (let k = 0; k < e.length; k += 2) d = Math.min(d, Math.hypot(e[k]![0] - x, e[k]![1] - z));
    if (d <= 6) outside.set(i, d);
  }
  for (let z = z0; z < z0 + span; z++) {
    for (let x = x0; x < x0 + span; x++) {
      if (!within(x, z)) continue;
      const i = I(x, z);
      land.clear(i, ground.lot);
      if (form === "stilts") land.block(i, false);
      land.height[i] = level;
      land.use[i] = Use.Lot;
      land.town[i] = tag;
    }
  }
  for (const [i, d] of outside) {
    if (land.isSea(i) || land.town[i] !== 0 || land.use[i] === Use.Building || land.use[i] === Use.Door) continue;
    land.clear(i, land.isWater(i) || !land.open(i) ? S.dirt : land.surface[i]!);
    const t = d / 7;
    land.height[i] = Math.round(level * (1 - t) + land.height[i]! * t);
    land.use[i] = Use.Kept;
  }
  if (walled) {
    for (const k of ring) {
      const x = x0 + (k % span);
      const z = z0 + Math.floor(k / span);
      const i = I(x, z);
      land.use[i] = Use.Wall;
      land.surface[i] = F.enclosure === "hedge" ? ground.yard : ground.street;
      land.block(i);
    }
  }

  // Street bookkeeping: what kind of way each street tile is (0 a main street, 1 a lane, 2 a square or plaza) and the
  // order it was laid in, for building along it in turn.
  const rank = new Int8Array(span * span).fill(-1);
  const order = new Int32Array(span * span);
  let laid = 0;
  const pave = (x: number, z: number, r: number, surface: number, open = true): boolean => {
    if (!within(x, z) || onRing(x, z) && walled) return false;
    const i = I(x, z);
    if (land.use[i] !== Use.Lot) return land.use[i] === Use.Street || land.use[i] === Use.Kept;
    land.clear(i, surface);
    if (!open) land.block(i, false);
    land.use[i] = r === 2 ? Use.Kept : Use.Street;
    rank[local(x, z)] = r;
    order[local(x, z)] = laid++;
    return true;
  };

  // --- The harbour, the gates and the main streets -------------------------------------------------------------------

  let harbourAngle: number | null = null;
  {
    let most = 0.35;
    for (let a = 0; a < 24; a++) {
      const angle = (a / 24) * Math.PI * 2;
      const r0 = boundary(angle) + 2;
      let sea = 0;
      for (let t = r0; t < r0 + 20; t++) if (land.inside(Math.round(cx + Math.cos(angle) * t), Math.round(cz + Math.sin(angle) * t)) && land.isSea(I(Math.round(cx + Math.cos(angle) * t), Math.round(cz + Math.sin(angle) * t)))) sea++;
      if (sea / 20 > most) {
        most = sea / 20;
        harbourAngle = angle;
      }
    }
  }
  /** How far out along an angle the town reaches, tiles. */
  function boundary(angle: number): number {
    let last = 0;
    for (let t = 0; t < R * 1.5; t += 0.5) {
      if (within(Math.round(cx + Math.cos(angle) * t), Math.round(cz + Math.sin(angle) * t))) last = t;
      else if (t > last + 2) break;
    }
    return last;
  }

  const gateWidth = form === "capital" ? 5 : 3;
  const half = (gateWidth - 1) / 2;
  const gates = new Map<string, number>();
  const gateMouths: { x: number; z: number; ux: number; uz: number; inner: readonly [number, number] }[] = [];
  const mouthTiles = new Set<number>();
  const wanted: { angle: number; harbour: boolean }[] = [];
  for (const t of spec.targets) {
    const angle = Math.atan2(t.at[1] - cz, t.at[0] - cx);
    if (!wanted.some((w) => angleGap(w.angle, angle) < 0.6)) wanted.push({ angle, harbour: false });
  }
  if (wanted.length < 2 && !village) wanted.push({ angle: (wanted[0]?.angle ?? turn) + Math.PI, harbour: false });
  if (harbourAngle !== null) {
    const near = wanted.findIndex((w) => angleGap(w.angle, harbourAngle!) < 0.5);
    if (near >= 0) wanted.splice(near, 1);
    wanted.push({ angle: harbourAngle, harbour: true });
  }
  const opening = (angle: number, harbour: boolean): boolean => {
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    const b = boundary(angle);
    const px = Math.round(cx + ux * b);
    const pz = Math.round(cz + uz * b);
    // The way out must reach dry ground (a harbour's, the water), clear of other towns.
    for (let s = 1; s <= 6; s++) {
      const x = Math.round(px + ux * s);
      const z = Math.round(pz + uz * s);
      if (!land.inside(x, z) || land.town[I(x, z)] !== 0 && !within(x, z)) return false;
      if (!harbour && land.isSea(I(x, z))) return false;
    }
    if (gateMouths.some((g) => Math.hypot(g.x - px, g.z - pz) < R * 0.35)) return false;
    for (let s = -5; s <= 6; s++) {
      const mx = px + ux * s;
      const mz = pz + uz * s;
      for (let a = -half; a <= half; a++) {
        for (let b2 = -half; b2 <= half; b2++) {
          const x = Math.round(mx + a);
          const z = Math.round(mz + b2);
          if (!land.inside(x, z)) continue;
          const i = I(x, z);
          if (within(x, z)) {
            if (land.use[i] === Use.Wall || land.use[i] === Use.Lot) {
              land.clear(i, ground.street);
              land.use[i] = Use.Street;
              rank[local(x, z)] = 0;
              order[local(x, z)] = laid++;
            }
            if (Math.abs(s) <= 1) mouthTiles.add(i);
          } else if (!land.isSea(i) && land.town[i] === 0) {
            land.clear(i, ground.street);
            land.use[i] = Use.Kept;
          }
        }
      }
    }
    const ex = Math.round(px + ux * 6);
    const ez = Math.round(pz + uz * 6);
    if (!harbour || !land.isSea(I(ex, ez))) gates.set(`gate-${gates.size + 1}`, I(ex, ez));
    gateMouths.push({ x: px, z: pz, ux, uz, inner: [Math.round(px - ux * 5), Math.round(pz - uz * 5)] });
    if (walled && F.enclosure !== "hedge") land.fixtures.push({ id: "gatehouse", x: px + 0.5, z: pz + 0.5, rot: rotOf(ux, uz), args: { width: gateWidth, style, kind: F.enclosure, size: plan.kind } });
    return true;
  };
  for (const w of wanted) {
    let made = false;
    for (const off of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6]) if (!made) made = opening(w.angle + off, w.harbour);
  }
  if (gates.size === 0) throw new Error(`${plan.id}: no way into the town reaches dry ground`);

  // The central square, then a main street from each gate to it, bending with the land.
  const [sqx, sqz] = F.square;
  for (let z = cz - sqz; z <= cz + sqz; z++) {
    for (let x = cx - sqx; x <= cx + sqx; x++) {
      if (F.round && Math.hypot((x - cx) / sqx, (z - cz) / sqz) > 1) continue;
      pave(x, z, 2, ground.square);
    }
  }
  const mains: [number, number][][] = [];
  for (const g of gateMouths) {
    // It leaves the gate straight in, then jogs along x and z toward the square, a stretch at a time, so the buildings
    // along it stand square to it; a planned town's stretches are long, an old one's short.
    const [ax, az] = g.inner;
    const points: [number, number][] = [[ax, az]];
    let [x, z] = [ax, az];
    let alongX = Math.abs(g.ux) > Math.abs(g.uz);
    const stretch = Math.max(6, Math.round(R * (0.5 - F.bend)));
    for (let leg = 0; leg < 12 && (Math.abs(cx - x) > 1 || Math.abs(cz - z) > 1); leg++) {
      const left = alongX ? cx - x : cz - z;
      const step = Math.abs(left) <= stretch * 1.3 ? left : Math.sign(left) * between(random, Math.round(stretch * 0.6), stretch);
      if (alongX) x += step;
      else z += step;
      points.push([x, z]);
      alongX = !alongX;
    }
    const path = brushPath(points, F.main, (x, z) => pave(x, z, 0, ground.street));
    mains.push(path);
  }

  // A lane inside the walls, all the way round, so the town's edge has streets to build along too.
  if (walled && F.enclosure !== "hedge" && R >= 30) {
    for (const k of ring) {
      const rx = x0 + (k % span);
      const rz = z0 + Math.floor(k / span);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (within(rx + dx, rz + dz) && !onRing(rx + dx, rz + dz)) pave(rx + dx, rz + dz, 1, ground.lane);
    }
  }

  // --- Districts -------------------------------------------------------------------------------------------------------

  const firstGate = gateMouths.find((g) => !(harbourAngle !== null && Math.abs(Math.atan2(g.uz, g.ux) - harbourAngle) < 0.01)) ?? gateMouths[0]!;
  const gateAngle = Math.atan2(firstGate.uz, firstGate.ux);
  const seeds = F.districts
    .filter((s) => s.angle !== "harbour" || harbourAngle !== null)
    .map((s) => {
      const angle = s.angle === "gate" ? gateAngle : s.angle === "away" ? gateAngle + Math.PI : s.angle === "harbour" ? harbourAngle! : turn + s.angle;
      const r = boundary(angle) * s.at;
      return { kind: s.kind, x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r, weight: s.weight };
    });
  const districtOf = new Map<number, District>();
  const districtAt = (x: number, z: number): District => {
    const k = local(x, z);
    let found = districtOf.get(k);
    if (found === undefined) {
      let best = Infinity;
      found = "residential";
      for (const s of seeds) {
        const d = Math.hypot(x - s.x, z - s.z) / s.weight;
        if (d < best) {
          best = d;
          found = s.kind;
        }
      }
      // The edges of a big town are its poorer outskirts.
      if (found === "residential" && !village && Math.hypot(x - cx, z - cz) > boundary(Math.atan2(z - cz, x - cx)) - R * 0.2) found = "outskirts";
      districtOf.set(k, found);
    }
    return found;
  };

  // --- Building ---------------------------------------------------------------------------------------------------------

  const buildings: BuildingData[] = [];
  const interiors: InteriorSpec[] = [];
  const doors = new Set<number>();
  const fronts = (x: number, z: number) => {
    if (!land.inside(x, z)) return false;
    const u = land.use[I(x, z)];
    return u === Use.Street || u === Use.Kept;
  };
  const isMain = (x: number, z: number) => inSquare(x, z) && rank[local(x, z)] === 0;

  /** Whether a building fits: on unbuilt lots of the town, its door on a street, its front mostly on the street, its
   * sides and back `gap` tiles clear of other buildings. */
  const fits = (f: Footprint, gap: number): boolean => {
    for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) if (!within(x, z) || land.use[I(x, z)] !== Use.Lot) return false;
    const di = I(f.door[0], f.door[1]);
    if (!fronts(f.door[0], f.door[1]) || doors.has(di) || mouthTiles.has(di)) return false;
    if (form !== "stilts" && !land.open(di)) return false;
    // Along its front, most tiles face the street.
    const wide = f.rot % 2 === 0 ? f.w : f.d;
    let facing = 0;
    for (let k = 0; k < wide; k++) {
      const [tx, tz] = frontOf(f, k);
      if (fronts(tx, tz)) facing++;
    }
    if (facing < Math.min(wide, 2)) return false;
    if (gap > 0) {
      for (let z = f.z - gap; z < f.z + f.d + gap; z++) {
        for (let x = f.x - gap; x < f.x + f.w + gap; x++) {
          if (!land.inside(x, z)) continue;
          if (land.use[I(x, z)] === Use.Building && !(x >= f.x && x < f.x + f.w && z >= f.z && z < f.z + f.d)) return false;
        }
      }
    }
    return true;
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
    const stilted = form === "stilts" ? { ...data, params: { ...data.params, stilts: true } } : data;
    if (extra.interior) {
      const di = I(f.door[0], f.door[1]);
      doors.add(di);
      land.use[di] = Use.Door;
      land.unblock(di);
    }
    buildings.push(stilted);
    return stilted;
  };
  /** Every place a building can face a street: the street tile its door would open on, and the turn it would face. */
  const frontages = () => {
    const out: { x: number; z: number; rot: number; rank: number; order: number }[] = [];
    for (let z = z0; z < z0 + span; z++) {
      for (let x = x0; x < x0 + span; x++) {
        if (!fronts(x, z) || !within(x, z)) continue;
        for (const d of DIRS) if (within(x + d.dx, z + d.dz) && land.use[I(x + d.dx, z + d.dz)] === Use.Lot) out.push({ x, z, rot: d.rot, rank: rank[local(x, z)]!, order: order[local(x, z)]! });
      }
    }
    return out;
  };

  /** A town building as near a point as the streets let it stand, facing south, west or east, its door seen. */
  const site = (size: readonly [number, number], near: readonly [number, number], o: { spread?: number; main?: boolean; district?: District; gap?: number; anyWay?: boolean } = {}): Footprint | null => {
    let best: { f: Footprint; score: number } | null = null;
    const [wide, deep] = size;
    for (const c of frontages()) {
      if (!o.anyWay && c.rot === 2) continue;
      if (o.main && c.rank !== 0) continue;
      const dist = Math.hypot(c.x - near[0], c.z - near[1]);
      if (best && dist - 12 > best.score) continue;
      for (const k of [Math.floor(wide / 2), Math.floor(wide / 2) - 2, Math.floor(wide / 2) + 2, 1, wide - 2]) {
        if (k < 0 || k >= wide) continue;
        const f = footprintAt([c.x, c.z], c.rot, wide, deep, k);
        if (o.district && districtAt(Math.round(f.x + f.w / 2), Math.round(f.z + f.d / 2)) !== o.district) continue;
        if (!fits(f, o.gap ?? 1)) continue;
        const score = dist + (c.rot === 0 ? 0 : 4) + random() * (o.spread ?? 4);
        if (!best || score < best.score) best = { f, score };
        break;
      }
    }
    return best?.f ?? null;
  };
  const centreOf = (district: District): [number, number] => {
    const s = seeds.find((x) => x.kind === district);
    return s ? [Math.round(s.x), Math.round(s.z)] : [cx, cz];
  };
  const addInterior = (f: Footprint, kind: BuildingKind, id: string, title: string, room: InteriorKind, extra: Partial<InteriorSpec> = {}) => {
    place(f, kind, id, { interior: id, sign: title });
    interiors.push({ id, name: title, kind: room, town: plan.id, style, exit: f.door, ...extra });
  };
  /** A plaza of `w` by `d` lots beside a street, as near a point as it fits. */
  const plaza = (w: number, d: number, near: readonly [number, number], surface: number): [number, number] | null => {
    let best: [number, number, number] | null = null;
    for (let z = z0; z + d <= z0 + span; z += 2) {
      for (let x = x0; x + w <= x0 + span; x += 2) {
        const dist = Math.hypot(x + w / 2 - near[0], z + d / 2 - near[1]);
        if (best && dist >= best[2]) continue;
        let ok = true;
        for (let zz = z; zz < z + d && ok; zz++) for (let xx = x; xx < x + w && ok; xx++) ok = within(xx, zz) && land.use[I(xx, zz)] === Use.Lot && !onRing(xx, zz);
        if (!ok) continue;
        let touching = 0;
        for (let xx = x; xx < x + w; xx++) touching += (fronts(xx, z - 1) ? 1 : 0) + (fronts(xx, z + d) ? 1 : 0);
        for (let zz = z; zz < z + d; zz++) touching += (fronts(x - 1, zz) ? 1 : 0) + (fronts(x + w, zz) ? 1 : 0);
        if (touching >= 3) best = [x, z, dist];
      }
    }
    if (!best) return null;
    for (let zz = best[1]; zz < best[1] + d; zz++) for (let xx = best[0]; xx < best[0] + w; xx++) pave(xx, zz, 2, surface);
    return [best[0] + Math.floor(w / 2), best[1] + Math.floor(d / 2)];
  };

  // Open spaces first: the capital's market, the arena, a campus's courtyards.
  const market = form === "capital" ? plaza(18, 13, centreOf("market").map((v, k) => v + (k === 0 ? 22 : 4)) as [number, number], ground.square) : null;
  const arena = village || form === "stilts" || form === "elfhame" ? null : plaza(10, 8, centreOf("residential"), ground.square);
  if (form === "campus") for (let n = 0; n < 3; n++) plaza(between(random, 12, 16), between(random, 9, 12), seeds[(n % (seeds.length - 1)) + 1] ? [Math.round(seeds[(n % (seeds.length - 1)) + 1]!.x), Math.round(seeds[(n % (seeds.length - 1)) + 1]!.z)] : [cx, cz], S.grass);

  // The landmarks, much bigger than the rest, and the town's own buildings, each where it belongs.
  const landmark = (size: readonly [number, number], near: readonly [number, number], kind: BuildingKind, id: string, o: { district?: District } = {}) => {
    const f = site(size, near, { spread: 6, gap: 2, anyWay: true, ...o }) ?? site([size[0] - 4, size[1] - 4], near, { spread: 6, gap: 1, anyWay: true });
    if (f) place(f, kind, id);
    return f;
  };
  if (form === "capital") {
    landmark([28, 22], centreOf("keep"), "keep", `${plan.id}-citadel`);
    for (let n = 1; n <= 7; n++) landmark([between(random, 11, 13), between(random, 9, 11)], centreOf("noble"), "manor", `${plan.id}-manor-${n}`, { district: "noble" });
  } else if (form === "city") landmark([20, 16], centreOf("keep"), "keep", `${plan.id}-keep`);
  else if (form === "estate") landmark([24, 16], centreOf("grounds"), "manor", `${plan.id}-manor`);

  // Lanes off the main streets, now that the landmarks stand: some branch again, some meet another street, some end.
  // A big town lays them before its own buildings (they need the frontage); a small one after (they would cut its lots
  // too small).
  const wild = form === "elfhame" || form === "stilts";
  const drawLanes = () => {
    const lanes: [number, number][][] = [];
    const branch = (from: readonly [number, number], angle: number, depth: number) => {
      let [x, z] = from;
      const points: [number, number][] = [[x, z]];
      let a = angle;
      for (let seg = 0; seg < 2; seg++) {
        const length = between(random, F.laneLength[0], F.laneLength[1]);
        x += Math.cos(a) * length;
        z += Math.sin(a) * length;
        points.push([x, z]);
        a += random() < 0.5 ? 0 : (random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      }
      const path = brushPath(points, F.lane, (px, pz) => {
        if (!within(px, pz) || onRing(px, pz)) return false;
        const u = land.use[I(px, pz)];
        if (u === Use.Lot) return pave(px, pz, 1, ground.lane);
        return u === Use.Street || u === Use.Kept;
      }, true);
      lanes.push(path);
      if (depth === 0 && path.length > 10 && random() < 0.45) {
        const at = path[Math.floor(path.length * (0.4 + random() * 0.4))]!;
        branch(at, a + (random() < 0.5 ? 1 : -1) * (Math.PI / 2) + (wild ? (random() - 0.5) * 0.5 : 0), 1);
      }
    };
    for (const path of mains) {
      let side = random() < 0.5 ? 1 : -1;
      for (let k = between(random, 4, 8); k < path.length - 4; k += between(random, F.laneEvery[0], F.laneEvery[1])) {
        if (random() > F.laneChance) continue;
        const [ax, az] = path[k]!;
        const [bx, bz] = path[Math.min(path.length - 1, k + 2)]!;
        const along = Math.abs(bx - ax) >= Math.abs(bz - az) ? (bx >= ax ? 0 : Math.PI) : bz > az ? Math.PI / 2 : -Math.PI / 2;
      branch([ax, az], along + side * (Math.PI / 2) + (wild ? (random() - 0.5) * 0.7 : 0), 0);
        side = -side;
      }
    }
    // Lanes from the square's corners, so the middle of the town is not all main street.
    for (let n = 0; n < (village ? 2 : 4); n++) {
      const a = n * (Math.PI / 2);
      branch([Math.round(cx + Math.cos(a) * (F.square[0] + 1)), Math.round(cz + Math.sin(a) * (F.square[1] + 1))], a, 0);
    }
  };
  if (R >= 30) drawLanes();

  const templeSize = sizeOf(form, "temple");
  if (!village && form !== "stilts") {
    const near: readonly [number, number] = form === "clan" ? [cx, cz - F.square[1] - 2] : centreOf("temple");
    const temple = site(templeSize, near, { spread: 3, gap: 2 }) ?? site([templeSize[0] - 3, templeSize[1] - 3], near, { spread: 3 });
    if (temple) {
      addInterior(temple, "temple", `${plan.id}-temple`, plan.temple, "temple", { resident: { name: "Priest", text: ["Rest a while. The wells of Dominaria remember the faithful."] } });
      // Its close: open paving before its front.
      if (form === "capital" || form === "city") {
        const [sx, sz] = [temple.door[0] - (temple.rot === 1 ? 6 : temple.rot === 3 ? -1 : Math.floor(temple.w / 2)), temple.door[1] + (temple.rot === 0 ? 1 : -Math.floor(temple.d / 2))];
        for (let z = sz; z < sz + (temple.rot === 0 ? 6 : temple.d); z++) for (let x = sx; x < sx + (temple.rot === 0 ? temple.w : 6); x++) if (within(x, z) && land.use[I(x, z)] === Use.Lot) pave(x, z, 2, ground.square);
      }
    }
  }
  const innGate = firstGate.inner;
  const innSize = R < 30 ? ([10, 7] as const) : sizeOf(form, "inn");
  const innAt = site(innSize, innGate, { main: true, spread: 2 }) ?? site(innSize, innGate, { spread: 2 }) ?? site([8, 6], [cx, cz], { spread: 2, gap: 0 });
  if (!innAt) throw new Error(`${plan.id}: no room for the inn`);
  addInterior(innAt, "inn", `${plan.id}-inn`, plan.inn, "inn", { innkeeper: { name: `The keeper of ${plan.inn}`, text: plan.innkeeper }, spellTable: true });
  spec.vendors.forEach((v, k) => {
    const near: readonly [number, number] = market && k % 2 === 1 ? market : [cx + Math.round(Math.cos(k * 2.1) * (F.square[0] + 3)), cz + Math.round(Math.sin(k * 2.1) * (F.square[1] + 3))];
    const f = site(sizeOf(form, "shop"), near, { spread: 4, gap: 0 }) ?? site([7, 5], near, { spread: 4, gap: 0 });
    if (!f) throw new Error(`${plan.id}: no room for ${v.id}'s shop`);
    addInterior(f, "shop", `${v.id}-shop`, v.name, "shop", { vendor: v });
  });
  if (spec.exotic) {
    const f = site(sizeOf(form, "exotic"), market ?? [cx, cz], { spread: 4, gap: 0 }) ?? site([7, 5], market ?? [cx, cz], { spread: 4, gap: 0 });
    if (!f) throw new Error(`${plan.id}: no room for the exotic wares shop`);
    addInterior(f, "shop", `${spec.exotic.id}-shop`, spec.exotic.name, "exotic-wares", { vendor: spec.exotic });
  }
  if (!village) {
    const guild = site(sizeOf(form, "guildhall"), form === "campus" ? [cx, cz + F.square[1] + 2] : centreOf("artisan"), { spread: 6, gap: 1 });
    if (guild) addInterior(guild, "guildhall", `${plan.id}-guildhall`, plan.guild, "guildhall", { spellTable: true, resident: { name: "Guild master", text: ["Our tables are open to any mage. Build your deck in peace."] } });
    const tower = style === "tolarian";
    const library = site(sizeOf(form, tower ? "tower" : "library"), centreOf(form === "campus" ? "residential" : "temple"), { spread: 8, gap: 1 });
    if (library) {
      const title = tower ? `The ${plan.name} Mage's Tower` : `The ${plan.name} Library`;
      addInterior(library, tower ? "tower" : "library", `${plan.id}-${tower ? "tower" : "library"}`, title, tower ? "tower" : "library", {
        resident: { name: tower ? "Archmage" : "Librarian", text: ["Every card ever printed is written down somewhere. Most of them here."] },
      });
    }
    const smithy = site(sizeOf(form, "smithy"), centreOf("artisan"), { spread: 6, gap: 0 }) ?? site(sizeOf(form, "smithy"), innGate, { spread: 8, gap: 0 });
    if (smithy) addInterior(smithy, "smithy", `${plan.id}-smithy`, `The ${plan.name} Smithy`, "smithy", { armorer: true });
  } else {
    const shrine = site(sizeOf(form, "shrine"), [cx, cz + F.square[1] + 3], { spread: 6 });
    if (shrine) addInterior(shrine, "temple", `${plan.id}-shrine`, `The ${plan.name} Shrine`, "temple", { resident: { name: "Hermit", text: ["The road is long. Sit, and let it wait for you."] } });
  }
  const homes = form === "capital" ? 10 : village || form === "stilts" ? 3 : 6;
  for (let n = 1; n <= homes; n++) {
    const angle = turn + n * 2.4;
    const r = boundary(angle) * (0.4 + random() * 0.35);
    const f = site(sizeOf(form, "house"), [cx + Math.cos(angle) * r, cz + Math.sin(angle) * r], { spread: 12, gap: 1 });
    if (!f) break;
    const folk = plan.folk[(n - 1) % Math.max(1, plan.folk.length)];
    addInterior(f, "house", `${plan.id}-house-${n}`, `A house in ${plan.name}`, "house", n <= plan.folk.length && folk ? { resident: folk } : {});
  }

  if (R < 30) drawLanes();

  // The rows: along the main streets first, then the lanes and squares, each district building its own way.
  const all = frontages().sort((p, q) => p.rank - q.rank || p.order - q.order);
  let count = 0;
  for (const c of all) {
    if (land.use[I(c.x + DIRS.find((d) => d.rot === c.rot)!.dx, c.z + DIRS.find((d) => d.rot === c.rot)!.dz)] !== Use.Lot) continue;
    const dir = DIRS.find((d) => d.rot === c.rot)!;
    const district = districtAt(c.x + dir.dx, c.z + dir.dz);
    const fill = fillFor(form, district);
    if (!fill || random() < fill.skip) continue;
    const total = fill.kinds.reduce((n, [, w]) => n + w, 0);
    let roll = random() * total;
    const kind = fill.kinds.find(([, w]) => (roll -= w) < 0)?.[0] ?? fill.kinds[0]![0];
    const wide0 = between(random, fill.wide[0], fill.wide[1]);
    const terrace = c.rank === 0 && (form === "capital" || form === "city") && district !== "noble" && district !== "outskirts";
    const gap = terrace ? 0 : between(random, fill.gap[0], fill.gap[1]);
    let done = false;
    for (const wide of [wide0, wide0 - 2]) for (let deep = between(random, fill.deep[0], fill.deep[1]); deep >= Math.max(4, fill.deep[0] - 2) && !done && wide >= 4; deep--) {
      for (const k of [Math.floor(wide / 2), 1, wide - 2, 0, wide - 1]) {
        const f = footprintAt([c.x, c.z], c.rot, wide, deep, k);
        if (fits(f, gap)) {
          place(f, kind, `${plan.id}-b${++count}`);
          done = true;
          break;
        }
      }
    }
  }

  // --- Outdoors ---------------------------------------------------------------------------------------------------------

  const props = land.fixtures;
  const npcs: NpcData[] = [];
  const reserved = new Set<number>();
  /** Whether a tile may take something that blocks it: open paving of a street or square, never at a door or a gate,
   * never closing a way. */
  const free = (i: number) => {
    if (!land.open(i) || reserved.has(i) || mouthTiles.has(i) || (land.use[i] !== Use.Street && land.use[i] !== Use.Kept) || land.town[i] !== tag) return false;
    if (land.n8(i).some((j) => doors.has(j) || land.use[j] === Use.Door || reserved.has(j))) return false;
    return safeToBlock(land, i);
  };
  const stand = (i: number) => land.block(i);

  // The centrepiece in the square's middle; benches round it.
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
  for (const [dx, dz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const bx = cx + dx * (piece.size + 2);
    const bz = cz + dz * (piece.size + 1);
    if (free(I(bx, bz))) {
      stand(I(bx, bz));
      props.push({ id: "bench", x: bx + 0.5, z: bz + 0.5, args: { width: 1.2 } });
    }
  }
  // Lights along the main streets, against the buildings.
  const light = STREET_LIGHT[style] ?? null;
  if (light) {
    for (const path of mains) {
      for (let k = 6; k < path.length; k += 11) {
        const [x, z] = path[k]!;
        const options = land.rect(x - 3, z - 3, x + 3, z + 3).filter((i) => free(i) && land.n4(i).some((j) => land.use[j] === Use.Building));
        const at = options.sort((p, q) => p - q)[0];
        if (at === undefined) continue;
        stand(at);
        props.push({ id: light, x: land.xOf(at) + 0.5, z: land.zOf(at) + 0.5 });
      }
    }
  }
  // Market stalls: the capital's market, or a corner of the square.
  const goods = ["apples", "cabbages", "carrots", "bread", "fish"];
  const stalls = (at: readonly [number, number], hx: number, hz: number) => {
    for (let z = at[1] - hz + 1; z <= at[1] + hz - 2; z += 4) {
      for (let x = at[0] - hx + 1; x <= at[0] + hx - 4; x += 5) {
        const tiles = land.rect(x, z, x + 2, z);
        if (!tiles.every(free)) continue;
        for (const i of tiles) stand(i);
        props.push({ id: "market-stall", x, z: z + 0.8, args: { width: 3 } });
        if (free(I(x + 3, z))) {
          stand(I(x + 3, z));
          props.push({ id: "crate", x: x + 3.5, z: z + 0.5, args: { goods: pick(random, goods) } });
        }
      }
    }
  };
  if (market) stalls(market, 8, 5);
  else if (!village && form !== "elfhame") stalls([cx + Math.ceil(F.square[0] / 2) + 1, cz + Math.ceil(F.square[1] / 2)], Math.floor(F.square[0] / 2), Math.floor(F.square[1] / 2));

  // The caravans' pitch: open paving, open all round, in the market (or the square).
  let pitch: { x: number; z: number } | null = null;
  if (plan.caravan) {
    const where = market ?? [cx, cz];
    const options = land
      .rect(where[0] - 14, where[1] - 14, where[0] + 14, where[1] + 14)
      .filter((i) => land.use[i] === Use.Kept && land.town[i] === tag && land.open(i) && land.n8(i).every((j) => land.open(j) && land.use[j] === Use.Kept && !reserved.has(j)))
      .sort((p, q) => Math.hypot(land.xOf(p) - where[0], land.zOf(p) - where[1]) - Math.hypot(land.xOf(q) - where[0], land.zOf(q) - where[1]) || p - q);
    const spot = options.find((i) => Math.hypot(land.xOf(i) - where[0], land.zOf(i) - where[1]) >= 4) ?? options[0];
    if (spot === undefined) throw new Error(`${plan.id}: no room for the caravan pitch`);
    pitch = { x: land.xOf(spot), z: land.zOf(spot) };
    for (const j of [spot, ...land.n8(spot)]) reserved.add(j);
  }

  // The quest board by the inn's door.
  const innDoor = I(innAt.door[0], innAt.door[1]);
  const boardAt = land
    .disc(innAt.door[0], innAt.door[1], 6)
    .filter((i) => free(i))
    .sort((p, q) => (land.n4(q).some((j) => land.use[j] === Use.Building) ? 1 : 0) - (land.n4(p).some((j) => land.use[j] === Use.Building) ? 1 : 0) || dist(land, p, innDoor) - dist(land, q, innDoor) || p - q)[0];
  if (boardAt === undefined) throw new Error(`${plan.id}: no room for the quest board`);
  stand(boardAt);
  const bx = land.xOf(boardAt);
  const bz = land.zOf(boardAt);
  props.push({ id: "quest-board", x: bx + 0.5, z: bz + 0.5, rot: innAt.rot });
  npcs.push({ id: `${plan.id}-quest-board`, x: bx, z: bz, kind: "quest-board", name: village ? "Notice board" : "Quest board", text: plan.board, stand: [bx + 0.5, level / 16, bz + 0.5] });

  // The arena, closed: its gate on its plaza.
  if (!village) {
    const at = arena ?? plaza(8, 6, centreOf("residential"), ground.square) ?? [cx, cz + F.square[1] - 1];
    const ai = land.rect(at[0] - 1, at[1] - 1, at[0] + 1, at[1]).filter(free);
    for (const j of ai) stand(j);
    props.push({ id: "arena-gate", x: at[0] + 0.5, z: at[1] + 0.5, rot: 0 });
    if (land.open(I(at[0], at[1]))) stand(I(at[0], at[1]));
    npcs.push({ id: `${plan.id}-arena`, x: at[0], z: at[1], kind: "arena", name: "The arena", text: ["The arena is closed. A sign reads: coming soon."], stand: [at[0] + 0.5, level / 16, at[1] + 0.5] });
  }

  // Guards in the gates, pacing the main street inside; townsfolk about the square.
  const figures = FOLK_FIGURES[style] ?? FOLK_FIGURES.benalish!;
  if (F.guards) {
    let k = 0;
    for (const g of gateMouths) {
      const path = mains[gateMouths.indexOf(g)]!;
      const stops = [path[1], path[Math.min(path.length - 1, 9)]].filter((p): p is [number, number] => !!p && land.open(I(p[0], p[1])));
      if (stops.length < 2) continue;
      npcs.push({
        id: `${plan.id}-guard-${++k}`,
        x: stops[0]![0],
        z: stops[0]![1],
        kind: "guard",
        name: `${plan.name} guard`,
        text: ["Keep to the roads. The waymarkers say how bad it gets past them."],
        figure: figures.guard,
        speed: 2.2,
        behaviour: { beat: { stops, pause: 3.5 }, watch: 4 },
      });
    }
  }
  plan.folk.forEach((folk, n) => {
    const angle = (n * 2.4 + 0.6) % (Math.PI * 2);
    const home = [Math.round(cx + Math.cos(angle) * (piece.size + 3)), Math.round(cz + Math.sin(angle) * (piece.size + 2))] as const;
    const at = land.disc(home[0], home[1], 4).filter((i) => land.open(i) && land.use[i] === Use.Kept && land.town[i] === tag && !reserved.has(i)).sort((p, q) => p - q)[0];
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

  // What is left of the lots is gardens, parks, orchards and allotments, and the elfhames' giant trees.
  const yardTrees = style === "urborg" ? ["dead-tree", "swamp-tree"] : style === "keldon" ? ["pine"] : style === "llanowar" ? ["tree", "great-tree"] : ["tree"];
  for (let z = z0; z < z0 + span; z++) {
    for (let x = x0; x < x0 + span; x++) {
      if (!within(x, z)) continue;
      const i = I(x, z);
      if (land.use[i] !== Use.Lot) continue;
      land.use[i] = Use.Yard;
      if (form === "stilts") {
        if (random() < 0.05) land.put(i, { id: "reeds", x: x + 0.5, z: z + 0.5 }, true);
        continue;
      }
      const district = districtAt(x, z);
      const roll = random();
      const tree = (id: string, scale: number) => land.put(i, { id, x: texel(x + 0.5), z: texel(z + 0.5), seed: between(random, 0, 15), scale: texel(scale + random() * 0.3) });
      if (district === "orchard") {
        land.surface[i] = S.grass;
        if ((x - cx) % 3 === 0 && (z - cz) % 3 === 0) tree("fruit-tree", 0.7);
      } else if (district === "allotments") {
        land.surface[i] = Math.floor((z - cz) / 3) % 2 === 0 ? S.furrows : S.wheat;
        if (roll < 0.01) land.put(i, { id: "hay-bale", x: x + 0.5, z: z + 0.5 });
      } else if (district === "park" || district === "grounds") {
        land.surface[i] = district === "grounds" ? S.grass : ground.yard === S.sand ? S.grass : ground.yard;
        if (district === "grounds" && (x - cx) % 6 === 0 && (z - cz) % 2 === 0 && roll < 0.8) land.put(i, { id: "hedge-wall", x, z: z + 0.5, args: { to: [x + 1, z + 0.5] } });
        else if (district === "grounds" && roll < 0.03) land.put(i, { id: "gravestone", x: x + 0.5, z: z + 0.5, turn: texel((random() - 0.5) * 0.3) });
        else if (roll < 0.07) tree(pick(random, yardTrees), 0.9);
        else if (roll < 0.1) land.put(i, { id: "flower-bed", x: x + 0.5, z: z + 0.5 });
      } else if (form === "elfhame") {
        land.surface[i] = ground.yard;
        if (roll < 0.09) {
          tree("great-tree", 1);
          if (random() < 0.3) props.push({ id: "tree-platform", x: texel(x + 0.5), z: texel(z + 0.5), args: { height: texel(2.5 + random()) } });
        } else if (roll < 0.15) tree("tree", 0.9);
        else if (roll < 0.17) land.put(i, { id: "mushroom", x: x + 0.5, z: z + 0.5 });
      } else {
        land.surface[i] = ground.yard;
        if (roll < 0.1) tree(pick(random, yardTrees), 0.8);
        else if (roll < 0.17) land.put(i, { id: "bush", x: x + 0.5, z: z + 0.5, seed: between(random, 0, 15), ...(random() < 0.4 ? { args: { flowering: true } } : {}) });
        else if (roll < 0.21) land.put(i, { id: "flower-bed", x: x + 0.5, z: z + 0.5 });
        else if (roll < 0.22) land.put(i, { id: village || form === "clan" ? "hay-bale" : "wood-pile", x: x + 0.5, z: z + 0.5 });
      }
    }
  }

  // The enclosure's drawing: wall runs along the outline between towers (cut at chunk edges), or hedgerows, or a palisade.
  if (walled) {
    for (const e of edges) {
      let run: [number, number][] = [];
      const flush = () => {
        if (run.length > 0) {
          const [ax, az] = run[0]!;
          const [bx2, bz2] = run[run.length - 1]!;
          const nx = (bz2 - az) / (Math.hypot(bx2 - ax, bz2 - az) || 1);
          const nz = -(bx2 - ax) / (Math.hypot(bx2 - ax, bz2 - az) || 1);
          // The outer face: the side away from the centre.
          const mx = (ax + bx2) / 2 - cx;
          const mz = (az + bz2) / 2 - cz;
          const sgn = nx * mx + nz * mz >= 0 ? 1 : -1;
          const face = ["s", "w", "n", "e"][rotOf(nx * sgn, nz * sgn)]!;
          if (F.enclosure === "hedge") props.push({ id: "hedgerow", x: ax + 0.5, z: az + 0.5, seed: between(random, 0, 15), args: { to: [bx2 + 0.5, bz2 + 0.5] } });
          else props.push({ id: "wall-run", x: ax + 0.5, z: az + 0.5, args: { to: [bx2 + 0.5, bz2 + 0.5], face, style, kind: F.enclosure, size: plan.kind } });
        }
        run = [];
      };
      for (const [x, z] of e) {
        if (land.use[I(x, z)] !== Use.Wall) {
          flush();
          continue;
        }
        const s = run[0];
        if (s && (Math.floor(x / 32) !== Math.floor(s[0] / 32) || Math.floor(z / 32) !== Math.floor(s[1] / 32) || run.length >= 16)) flush();
        run.push([x, z]);
      }
      flush();
    }
    if (F.enclosure !== "hedge") {
      for (const [x, z] of poly) if (land.use[I(x, z)] === Use.Wall) props.push({ id: "wall-tower", x: x + 0.5, z: z + 0.5, args: { style, kind: F.enclosure, size: plan.kind } });
      for (const g of gateMouths) {
        for (const side of [-1, 1]) {
          const x = Math.round(g.x - g.uz * side * (half + 1.5));
          const z = Math.round(g.z + g.ux * side * (half + 1.5));
          if (land.inside(x, z) && land.use[I(x, z)] === Use.Wall) props.push({ id: "wall-tower", x: x + 0.5, z: z + 0.5, args: { style, kind: F.enclosure, size: plan.kind } });
        }
      }
    }
  }

  // The harbour's pier, out from its gate into the water, straight along the way the gate faces.
  const harbourGate = harbourAngle !== null ? gateMouths.find((g) => Math.abs(Math.atan2(g.uz, g.ux) - harbourAngle!) < 0.7) : undefined;
  if (harbourGate) {
    const rot = rotOf(harbourGate.ux, harbourGate.uz);
    const [ux, uz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][rot]!;
    const hx = Math.round(harbourGate.x + harbourGate.ux * 6);
    const hz = Math.round(harbourGate.z + harbourGate.uz * 6);
    let wet = 0;
    let end = -1;
    for (let s = -5; s <= 46 && wet < 9; s++) {
      const x = hx + ux! * s;
      const z = hz + uz! * s;
      if (!land.inside(x, z)) break;
      for (let t = -1; t <= 1; t++) {
        const px = x + (uz !== 0 ? t : 0);
        const pz = z + (ux !== 0 ? t : 0);
        if (!land.inside(px, pz)) continue;
        const i = I(px, pz);
        if (land.isSea(i)) {
          land.clear(i, S.planks);
          land.use[i] = Use.Dock;
          land.height[i] = Math.max(2, level - 2);
        } else if (land.town[i] === 0 && (land.use[i] === Use.Kept || land.use[i] === Use.Wild)) {
          land.clear(i, S.planks);
          land.use[i] = Use.Kept;
        }
      }
      if (wet > 0 || land.isSea(I(x + ux!, z + uz!))) wet++;
      end = s;
    }
    if (end > 0) {
      const ax = Math.min(hx, hx + ux! * end) - (uz !== 0 ? 1 : 0);
      const az = Math.min(hz, hz + uz! * end) - (ux !== 0 ? 1 : 0);
      const bx3 = Math.max(hx, hx + ux! * end) + (uz !== 0 ? 1 : 0);
      const bz3 = Math.max(hz, hz + uz! * end) + (ux !== 0 ? 1 : 0);
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

const angleGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

/** The tile in front of a footprint's front wall `k` tiles along it from its left end as drawn. */
function frontOf(f: Footprint, k: number): [number, number] {
  switch (f.rot) {
    case 0:
      return [f.x + k, f.z + f.d];
    case 2:
      return [f.x + f.w - 1 - k, f.z - 1];
    case 1:
      return [f.x - 1, f.z + k];
    default:
      return [f.x + f.w, f.z + f.d - 1 - k];
  }
}

/** The tiles of a straight line, corner to corner, eight-connected (Bresenham). */
function line(a: readonly [number, number], b: readonly [number, number]): [number, number][] {
  const out: [number, number][] = [];
  let [x, z] = a;
  const [x1, z1] = b;
  const dx = Math.abs(x1 - x);
  const dz = -Math.abs(z1 - z);
  const sx = x < x1 ? 1 : -1;
  const sz = z < z1 ? 1 : -1;
  let err = dx + dz;
  for (;;) {
    out.push([x, z]);
    if (x === x1 && z === z1) break;
    const e2 = 2 * err;
    if (e2 >= dz) {
      err += dz;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      z += sz;
    }
  }
  return out;
}

/**
 * Paints a way along a polyline with a square brush `width` tiles wide (so its tiles always join edge to edge), calling
 * `paint` for each tile; with `stop`, it ends where `paint` says no at the brush's middle - a lane meeting a building or
 * the wall. The middle line's tiles, in order.
 */
function brushPath(points: readonly (readonly [number, number])[], width: number, paint: (x: number, z: number) => boolean, stop = false): [number, number][] {
  const middle: [number, number][] = [];
  const lo = -Math.floor((width - 1) / 2);
  const hi = lo + width - 1;
  for (let k = 1; k < points.length; k++) {
    const [ax, az] = points[k - 1]!;
    const [bx, bz] = points[k]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) * 2));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(ax + ((bx - ax) * s) / steps);
      const z = Math.round(az + ((bz - az) * s) / steps);
      const last = middle[middle.length - 1];
      if (last && last[0] === x && last[1] === z) continue;
      // A diagonal step is filled in, so the way joins edge to edge however narrow.
      if (last && last[0] !== x && last[1] !== z) paint(x, last[1]);
      let ok = true;
      for (let dz = lo; dz <= hi; dz++) for (let dx = lo; dx <= hi; dx++) if (!paint(x + dx, z + dz) && dx === 0 && dz === 0) ok = false;
      if (stop && !ok && middle.length > 2) return middle;
      middle.push([x, z]);
    }
  }
  return middle;
}

/**
 * Whether blocking an open tile leaves every way past it open: its open neighbours, walked round it as the overworld
 * walks (eight ways, no corner cut past a blocked tile), are still one run - whoever walked through it can walk round.
 */
export function safeToBlock(land: Land, i: number): boolean {
  const x = land.xOf(i);
  const z = land.zOf(i);
  const ring: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const open = ring.map(([dx, dz]) => land.inside(x + dx, z + dz) && land.open(land.idx(x + dx, z + dz)));
  let runs = 0;
  let any = false;
  for (let k = 0; k < 8; k++) {
    if (!open[k]) continue;
    any = true;
    if (!open[(k + 7) % 8]) runs++;
  }
  if (!any) return false;
  if (runs === 0) return true;
  for (let k = 0; k < 8; k += 2) if (open[k] && !open[(k + 7) % 8] && !open[(k + 1) % 8]) return false;
  return runs <= 1;
}

export type { PropData };
