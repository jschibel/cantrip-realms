// Towns (design.md A6) on square tiles, each laid out by its form (layout.ts, `Form`) and built in its region's style.
//
// A town's outline is a rough polygon hugging the land - pulled in from the coast, a river or a cliff, its corners
// wandering - within the square of its `radius` (what the server calls the town). A walled town's wall runs along it
// (a palisade round a Keldon clan, hedges round a village, nothing round an elfhame or the Morass's stilt village).
//
// The streets are planned whole before anything is built (plan.ts), in one of three shapes: a grid (Benalia's cities,
// the capital, the campus, the estate) - the central square a block of its own framed by four main streets that run
// from wall to wall, a street every block beyond them; rings (Keld's clans, Llanowar's elfhames) - an octagonal ring
// round a round square, spokes from the square out through it, more spokes from the ring out; or a ladder (villages,
// the Morass's boardwalks, any small town but an elfhame) - a high street and a cross street through the square inside
// a loop of back lanes. A big town has a lane inside its walls (round its edge where it has none) that every street
// runs out to. Gates open where a street of the plan meets the outline toward each road (and onto the harbour), the
// outline straightened across each so the wall meets the way out square, and each gate's way runs straight in to the
// first street it meets. Every street ends at another street, a square or a gate: what would end nowhere is left out.
// The plan then loses lanes through a landmark's ground and a few between lanes (a bigger block here and there), and is
// paved: the main streets, the lanes, the squares; plazas open beside them where the town needs them - the capital's
// market, a temple's close, the arena, a campus's courtyards. The town keeps the plan (format.ts, `TownPlan`): its
// streets, squares, gates and key places, which the maps draw and the lint walks.
//
// The town is cut into districts round seeds - the market quarter round the square, a temple close, the keep or the
// nobles' manors (New Benalia's citadel and the Seven Houses), the artisans' quarter by a gate, the harbour, quiet
// residential streets, poorer outskirts by the walls, parks, orchards and allotments - and each district builds its
// own way: terraced rows along the main streets, detached houses with yards toward the edge, warehouses by the water,
// longhouses in a clan, tree-houses spread among giant trees. The landmarks come first and much bigger (the citadel, the
// cathedral, the great hall, the manor), then the town's own buildings, on a main street or a square where they can be
// (the inn by a gate, the shops round the square and the market, the guildhall and the smithy among the artisans), then
// the rows along every street. Every building faces the street before it, its door that street tile; one with an
// interior faces south, west or east, never away from the camera. Outdoors: the centrepiece, benches and lamps, market
// stalls, the quest board by the inn's door, guards in the gates, townsfolk on the square, the arena's gate on its
// plaza's side along a street, the caravans' pitch, gardens, orchard rows and the harbour's pier.

import type { BuildingData, InteriorKind, NpcData, PropData, Region, StreetWay, TownData, TownPlace, TownPlan, TownSquare, XZ } from "../../src/world/format";
import { brushOf, inPolygon, inSquare, lineTiles, pathTiles, squareTiles, wayMiddle, wayTiles } from "../../src/world/streets";
import { type Footprint, building } from "./buildings";
import { type BuildingKind, S } from "./ids";
import { type Land, Use, between, pick, randomFor, texel } from "./land";
import type { Form, TownLayout } from "./layout";
import { Planner, inset } from "./plan";
import { REGION_OF_STYLE } from "./rooms";
import { tilesOf } from "../../src/art/props";

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
  /** The footprint of the building it is behind, world units across its front and deep (the room is sized from it). */
  readonly building?: { readonly w: number; readonly d: number };
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

/** How a town's streets are laid (plan.ts): a grid of streets round the square, rings round it crossed by spokes, or a
 * high street through it between back lanes (a ladder). */
type Shape = "grid" | "rings" | "ladder";

interface FormSpec {
  readonly enclosure: "wall" | "palisade" | "hedge" | "none";
  /** The central square's half sizes along x and z, or its radii when round. */
  readonly square: readonly [number, number];
  readonly round: boolean;
  /** Tiles across a main street (round or across the square, a gate's way in) and a lane. */
  readonly main: number;
  readonly lane: number;
  readonly shape: Shape;
  /**
   * The plan's spacing. A grid's: tiles from street to street along x and along z (a block two lots deep and its back
   * yards). Rings': the ring's half size and the second spokes' offset, shares of the radius and of the ring. A
   * ladder's: the back lanes' and the outer cross streets' offsets from the middle, shares of the radius.
   */
  readonly pitch: readonly [number, number];
  /** The share of a grid's lanes between junctions left out, for a bigger block here and there. */
  readonly thin: number;
  /** How far the outline's corners pull in, a share of the radius. */
  readonly pull: number;
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
    shape: "grid",
    pitch: [21, 19],
    thin: 0.12,
    pull: 0.14,
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
    shape: "grid",
    pitch: [20, 18],
    thin: 0.12,
    pull: 0.18,
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
    shape: "ladder",
    pitch: [0.55, 0.62],
    thin: 0,
    pull: 0.22,
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
    main: 3,
    lane: 2,
    shape: "rings",
    pitch: [0.48, 0.55],
    thin: 0,
    pull: 0.24,
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
    shape: "ladder",
    pitch: [0.5, 0.6],
    thin: 0,
    pull: 0.25,
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
    shape: "rings",
    pitch: [0.5, 0.55],
    thin: 0,
    pull: 0.2,
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
    shape: "grid",
    pitch: [23, 20],
    thin: 0.1,
    pull: 0.16,
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
    shape: "grid",
    pitch: [20, 18],
    thin: 0.1,
    pull: 0.15,
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

/** A ladder's offsets where a form has no ladder of its own (a small town): its back lanes' and its outer cross
 * streets', shares of the radius. */
const LADDER: readonly [number, number] = [0.55, 0.62];

/** How a district builds along its streets: kinds by weight, tiles across the front and deep, the gap between, how often
 * a lot is left open. Null: it builds nothing (gardens, orchards). */
interface Fill {
  readonly kinds: readonly (readonly [BuildingKind, number])[];
  readonly wide: readonly [number, number];
  readonly deep: readonly [number, number];
  readonly gap: readonly [number, number];
  readonly skip: number;
}

function fillFor(form: Form, district: District, small: boolean): Fill | null {
  if (district === "park" || district === "orchard" || district === "allotments" || district === "grounds") return null;
  if (form === "clan") return { kinds: [["house", 4], ["barn", 1]], wide: [5, 7], deep: small ? [7, 9] : [10, 13], gap: [1, 3], skip: 0.15 };
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

/** Who keeps a town's gates and walks its square, by its style: the region's guards and townsfolk (art/figures/npcs.ts). */
const FOLK_FIGURES: Record<string, { guard: string; folk: readonly string[] }> = Object.fromEntries(
  Object.entries(REGION_OF_STYLE).map(([style, region]) => [style, { guard: `guard-${region}`, folk: [`townsfolk-${region}`] }]),
);

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
function sizeOf(form: Form, what: string, small = false): readonly [number, number] {
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
    house: form === "clan" ? (small ? [6, 8] : [6, 11]) : [7, 6],
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
  /** The town's name after "the": The Elfhames of Llanowar's library is "The Elfhames of Llanowar Library". */
  const the = plan.name.startsWith("The ") ? plan.name : `The ${plan.name}`;
  const I = (x: number, z: number) => land.idx(x, z);
  const x0 = cx - R;
  const z0 = cz - R;
  const span = 2 * R + 1;
  const local = (x: number, z: number) => (z - z0) * span + (x - x0);
  const inBox = (x: number, z: number) => Math.abs(x - cx) <= R && Math.abs(z - cz) <= R;

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
    const wanted = R * (1 - F.pull * random()) * (most / R) ** 0.35;
    radii.push(Math.max(R * 0.55, Math.min(wanted, reach(angle), most)));
  }
  radii = radii.map((r, k) => {
    const most = (R - 1) / Math.max(Math.abs(Math.cos(angles[k]!)), Math.abs(Math.sin(angles[k]!)));
    return Math.min(most, (radii[(k + corners - 1) % corners]! + 2 * r + radii[(k + 1) % corners]!) / 4);
  });
  let poly: XZ[] = angles.map((a, k) => [Math.round(cx + Math.cos(a) * radii[k]!), Math.round(cz + Math.sin(a) * radii[k]!)] as const);
  /**
   * Each edge's tiles, corner to corner, four-connected: a slanted edge is a staircase of whole tiles, so the wall drawn
   * on them (straight runs along rows and columns) stands exactly on the tiles that block, with no gap at a step.
   */
  let edges: [number, number][][] = [];
  const ring = new Set<number>();
  const inside = new Uint8Array(span * span);
  /** Takes the outline's corners as they now are: its edges, the ring of tiles they run over, the tiles within. */
  const outline = () => {
    edges = poly.map((a, k) => lineTiles(a, poly[(k + 1) % poly.length]!));
    ring.clear();
    for (const e of edges) for (const [x, z] of e) ring.add(local(x, z));
    inside.fill(0);
    for (let z = z0; z < z0 + span; z++) for (let x = x0; x < x0 + span; x++) if (inPolygon(poly, x, z) || ring.has(local(x, z))) inside[local(x, z)] = 1;
  };
  outline();
  const within = (x: number, z: number) => inBox(x, z) && inside[local(x, z)] === 1;
  const onRing = (x: number, z: number) => inBox(x, z) && ring.has(local(x, z));
  const walled = F.enclosure !== "none";
  /** How far out along an angle the town reaches, tiles. */
  const boundary = (angle: number): number => {
    let last = 0;
    for (let t = 0; t < R * 1.5; t += 0.5) {
      if (within(Math.round(cx + Math.cos(angle) * t), Math.round(cz + Math.sin(angle) * t))) last = t;
      else if (t > last + 2) break;
    }
    return last;
  };

  // --- The harbour --------------------------------------------------------------------------------------------------

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

  // --- The plan's lines: where its streets run out toward the outline, so a gate opens onto one ----------------------

  const small = R < 30;
  // A small town's streets are a loop round its middle crossed through the square: a ladder, or an elfhame's ring.
  const shape: Shape = small ? (F.shape === "rings" && form !== "clan" ? "rings" : "ladder") : F.shape;
  const [sqx, sqz]: readonly [number, number] = small ? (F.round ? [5, 5] : [Math.min(F.square[0], 5), Math.min(F.square[1], 4)]) : F.square;
  const [mlo, mhi] = brushOf(F.main);
  /** The plan's streets running north and south, by their x from the centre, and those running east and west, by z. */
  const xs: { at: number; main: boolean }[] = [];
  const zs: { at: number; main: boolean }[] = [];
  const firstAngle = spec.targets[0] ? Math.atan2(spec.targets[0].at[1] - cz, spec.targets[0].at[0] - cx) : turn;
  /** A ladder's high street runs north and south when the first road arrives from the north or the south. */
  const upright = Math.abs(Math.sin(firstAngle)) >= Math.abs(Math.cos(firstAngle));
  let ladder: { across: number; along: number } | null = null;
  let ringAt = 0;
  let spokeAt = 0;
  if (shape === "grid") {
    // The square's own block, the main streets round it, and a street every pitch beyond them.
    for (const [list, halfway, pitch] of [
      [xs, sqx, F.pitch[0]],
      [zs, sqz, F.pitch[1]],
    ] as const) {
      for (const sign of [1, -1]) {
        for (let k = 0; ; k++) {
          const at = (sign > 0 ? halfway + 1 - mlo : -(halfway + 1 + mhi)) + sign * k * pitch;
          if (Math.abs(at) > R - 6) break;
          list.push({ at, main: k === 0 });
        }
      }
    }
  } else if (shape === "rings") {
    ringAt = Math.max(Math.max(sqx, sqz) + 7, Math.round(R * F.pitch[0]));
    spokeAt = Math.round(ringAt * F.pitch[1]);
    for (const list of [xs, zs]) {
      list.push({ at: 0, main: true });
      if (!small) list.push({ at: spokeAt, main: false }, { at: -spokeAt, main: false });
    }
  } else {
    const shares = F.shape === "ladder" ? F.pitch : LADDER;
    const across = Math.max((upright ? sqx : sqz) + 6, Math.round(R * shares[0]));
    const along = Math.max((upright ? sqz : sqx) + 6, Math.round(R * shares[1]));
    ladder = { across, along };
    const high = upright ? xs : zs;
    const rungs = upright ? zs : xs;
    high.push({ at: 0, main: true }, { at: across, main: false }, { at: -across, main: false });
    rungs.push({ at: 0, main: true }, { at: along, main: false }, { at: -along, main: false });
  }

  // --- The gates: one toward each road, on a street of the plan where one runs that way -------------------------------

  const gateWidth = form === "capital" ? 5 : 3;
  const half = (gateWidth - 1) / 2;
  /** Each gate: its tile in the outline, and the way out (a quarter turn: x or z). */
  const chosen: { x: number; z: number; ux: number; uz: number; harbour: boolean }[] = [];
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
  /** A gate on the side facing (ux, uz), its way in `at` tiles across from the centre; null where it cannot open. */
  const gateOn = (ux: number, uz: number, at: number, harbour: boolean) => {
    const [sx, sz] = ux === 0 ? [cx + at, cz] : [cx, cz + at];
    if (!within(sx, sz)) return null;
    let p: XZ | null = null;
    for (let s = 0; s < R * 1.6 && inBox(sx + ux * s, sz + uz * s); s++) {
      if (onRing(sx + ux * s, sz + uz * s)) {
        p = [sx + ux * s, sz + uz * s];
        break;
      }
    }
    if (!p) return null;
    // The way out must reach dry ground (a harbour's, the water), clear of other towns.
    for (let s = 1; s <= 6; s++) {
      const x = p[0] + ux * s;
      const z = p[1] + uz * s;
      if (!land.inside(x, z) || (land.town[I(x, z)] !== 0 && !within(x, z))) return null;
      if (!harbour && land.isSea(I(x, z))) return null;
    }
    // Room either side of it for the wall to meet it square, and clear of the other gates.
    for (const s of [-half - 3, half + 3]) if (Math.max(Math.abs(p[0] - uz * s - cx), Math.abs(p[1] + ux * s - cz)) > R - 1) return null;
    if (chosen.some((g) => Math.max(Math.abs(g.x - p![0]), Math.abs(g.z - p![1])) < Math.max(10, R * 0.3))) return null;
    return { x: p[0], z: p[1], ux, uz, harbour };
  };
  /**
   * The outline made straight across a gate, so its wall meets the way out square: two corners either side of the gate,
   * across the way out, in place of any corner between them.
   */
  const straighten = (g: { x: number; z: number; ux: number; uz: number }) => {
    const f = half + 3;
    const q1: XZ = [g.x + g.uz * f, g.z - g.ux * f];
    const q2: XZ = [g.x - g.uz * f, g.z + g.ux * f];
    const angleOf = (p: XZ) => Math.atan2(p[1] - cz, p[0] - cx);
    const [a1, a2] = [angleOf(q1), angleOf(q2)];
    const between2 = angleGap(a1, a2);
    const kept = poly.filter((c) => {
      const a = angleOf(c);
      if (angleGap(a, a1) + angleGap(a, a2) <= between2 + 1e-9) return false;
      return Math.hypot(c[0] - q1[0], c[1] - q1[1]) >= 3 && Math.hypot(c[0] - q2[0], c[1] - q2[1]) >= 3;
    });
    const from = (p: XZ) => (((angleOf(p) - turn) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    poly = [...kept, q1, q2].sort((p, q) => from(p) - from(q));
    outline();
  };
  for (const w of wanted) {
    const sides = (
      [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const
    ).slice().sort((p, q) => angleGap(Math.atan2(p[1], p[0]), w.angle) - angleGap(Math.atan2(q[1], q[0]), w.angle));
    let made: ReturnType<typeof gateOn> = null;
    for (const [ux, uz] of sides) {
      if (made) break;
      const across = ux === 0;
      const b = boundary(w.angle);
      const lateral = across ? Math.cos(w.angle) * b : Math.sin(w.angle) * b;
      // The plan's streets that way, the main ones and those nearest the road first; then a way of the gate's own.
      const options = (across ? xs : zs).map((l) => ({ at: l.at, score: Math.abs(l.at - lateral * 0.5) - (l.main ? 8 : 0) }));
      for (const o of [0, -3, 3, -6, 6, -9, 9, -12, 12]) options.push({ at: Math.round(lateral * 0.5) + o, score: 1000 + Math.abs(o) });
      options.sort((p, q) => p.score - q.score);
      for (const o of options) if (!made) made = gateOn(ux, uz, o.at, w.harbour);
    }
    if (made) {
      chosen.push(made);
      straighten(made);
    }
  }
  if (chosen.length === 0) throw new Error(`${plan.id}: no way into the town reaches dry ground`);

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

  // Street bookkeeping: what kind of way each street tile is (0 a main street, 1 a lane, 2 a square or plaza), the
  // order it was laid in, for building along it in turn, and every tile of the plan's streets and squares.
  const rank = new Int8Array(span * span).fill(-1);
  const order = new Int32Array(span * span);
  const street = new Uint8Array(span * span);
  /** The main streets' tiles and the square's (and the market's): where the town's own buildings stand first. */
  const keyTile = new Uint8Array(span * span);
  let laid = 0;
  const pave = (x: number, z: number, r: number, surface: number): boolean => {
    if (!within(x, z) || (onRing(x, z) && walled)) return false;
    const i = I(x, z);
    if (land.use[i] !== Use.Lot) {
      const done = land.use[i] === Use.Street || land.use[i] === Use.Kept;
      if (done) street[local(x, z)] = 1;
      return done;
    }
    land.clear(i, surface);
    land.use[i] = r === 2 ? Use.Kept : Use.Street;
    rank[local(x, z)] = r;
    order[local(x, z)] = laid++;
    street[local(x, z)] = 1;
    return true;
  };

  // --- The gates' ways out, cleared through the wall, each with its gatehouse -----------------------------------------

  const gates = new Map<string, number>();
  const gateMouths: { x: number; z: number; ux: number; uz: number; harbour: boolean; inner: readonly [number, number]; end: XZ }[] = [];
  const mouthTiles = new Set<number>();
  for (const g of chosen) {
    const { ux, uz } = g;
    for (let s = -5; s <= 6; s++) {
      for (let a = -half; a <= half; a++) {
        const x = g.x + ux * s - uz * a;
        const z = g.z + uz * s + ux * a;
        if (!land.inside(x, z)) continue;
        const i = I(x, z);
        if (within(x, z)) {
          if (land.use[i] === Use.Wall || land.use[i] === Use.Lot) {
            land.clear(i, ground.street);
            land.use[i] = Use.Street;
            rank[local(x, z)] = 0;
            order[local(x, z)] = laid++;
          }
          street[local(x, z)] = 1;
          if (Math.abs(s) <= 1) mouthTiles.add(i);
        } else if (!land.isSea(i) && land.town[i] === 0) {
          land.clear(i, ground.street);
          land.use[i] = Use.Kept;
        }
      }
    }
    const end: XZ = [g.x + ux * 6, g.z + uz * 6];
    if (!g.harbour || !land.isSea(I(end[0], end[1]))) gates.set(`gate-${gates.size + 1}`, I(end[0], end[1]));
    gateMouths.push({ x: g.x, z: g.z, ux, uz, harbour: g.harbour, inner: [g.x - ux * 5, g.z - uz * 5], end });
    if (walled && F.enclosure !== "hedge") {
      const gatehouse: PropData = { id: "gatehouse", x: g.x + 0.5, z: g.z + 0.5, rot: rotOf(ux, uz), args: { width: gateWidth, style, kind: F.enclosure, size: plan.kind } };
      land.fixtures.push(gatehouse);
      // Its towers stand on their tiles (the passage between them stays the street it was cleared to).
      for (const [x, z] of tilesOf(gatehouse).tiles) if (land.inside(x, z)) land.block(I(x, z));
    }
  }
  if (gates.size === 0) throw new Error(`${plan.id}: no way into the town reaches dry ground`);

  // --- Districts -------------------------------------------------------------------------------------------------------

  const firstGate = gateMouths.find((g) => !g.harbour) ?? gateMouths[0]!;
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
  const centreOf = (district: District): [number, number] => {
    const s = seeds.find((x) => x.kind === district);
    return s ? [Math.round(s.x), Math.round(s.z)] : [cx, cz];
  };

  // --- The streets, planned whole before anything is built (plan.ts) ---------------------------------------------------

  const squares: TownSquare[] = [];
  const centralSquare: TownSquare = { x: cx - sqx, z: cz - sqz, w: 2 * sqx + 1, d: 2 * sqz + 1, ...(F.round ? { round: true } : {}), name: "The square" };
  squares.push(centralSquare);
  const planner = new Planner((x, z) => within(x, z) && !onRing(x, z));
  // The lane inside the walls (or round the edge), which every street of a grid or the rings runs out to.
  let edgeLane: XZ[] | null = null;
  if (!small) {
    for (let d = 3; d <= 8 && !edgeLane; d++) {
      const c = inset(poly, [cx, cz], d);
      if (planner.loop(c, F.lane)) edgeLane = c;
    }
    if (!edgeLane) throw new Error(`${plan.id}: no room for the lane round its edge`);
  }
  const insideLane = (x: number, z: number) => !!edgeLane && inPolygon(edgeLane, x, z) && !planner.isLoop(x, z);
  if (shape === "grid") {
    // Every street runs straight across the town, from the lane on one side to the lane on the other.
    for (const l of xs) {
      const x = cx + l.at;
      if (!insideLane(x, cz)) continue;
      const north = planner.walk([x, cz], 0, -1, span);
      const south = planner.walk([x, cz], 0, 1, span);
      if (north && south && south[1] - north[1] >= 8) planner.line([north, south], l.main ? F.main : F.lane, l.main);
    }
    for (const l of zs) {
      const z = cz + l.at;
      if (!insideLane(cx, z)) continue;
      const west = planner.walk([cx, z], -1, 0, span);
      const east = planner.walk([cx, z], 1, 0, span);
      if (west && east && east[0] - west[0] >= 8) planner.line([west, east], l.main ? F.main : F.lane, l.main);
    }
  } else if (shape === "rings") {
    // A ring round the square (an octagon, its corners cut), as far out as it fits well inside the edge's lane - or, in
    // a small town with no such lane, inside its edge.
    const margin = edgeLane ? inset(edgeLane, [cx, cz], 6) : inset(poly, [cx, cz], 3);
    const octagon = (rx: number, rz: number): XZ[] => {
      const c = Math.round(Math.min(rx, rz) * 0.3);
      return [
        [cx - rx + c, cz - rz],
        [cx + rx - c, cz - rz],
        [cx + rx, cz - rz + c],
        [cx + rx, cz + rz - c],
        [cx + rx - c, cz + rz],
        [cx - rx + c, cz + rz],
        [cx - rx, cz + rz - c],
        [cx - rx, cz - rz + c],
      ];
    };
    const fits = (rx: number, rz: number) => octagon(rx, rz).every(([x, z]) => inPolygon(margin, x, z)) && pathTiles([...octagon(rx, rz), octagon(rx, rz)[0]!]).every(([x, z]) => within(x, z) && !onRing(x, z));
    let ring1: number | null = null;
    let [rx, rz] = [0, 0];
    for (let r = small ? Math.round(R * 0.62) : ringAt; r >= Math.max(sqx, sqz) + 5 && ring1 === null; r--) if (fits(r, r)) ring1 = r;
    if (ring1 !== null) {
      // A small town's ring stretches along x or z as far as its edge lets it.
      [rx, rz] = [ring1, ring1];
      while (small && rx < R * 0.7 && fits(rx + 1, rz)) rx++;
      while (small && rz < R * 0.7 && fits(rx, rz + 1)) rz++;
      planner.loop(octagon(rx, rz), F.lane);
    }
    // The spokes: from the square out through the ring to the edge's lane, and from the ring out between them.
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      let s = 0;
      while (inSquare(centralSquare, cx + dx * (s + 1), cz + dz * (s + 1))) s++;
      const start: XZ = [cx + dx * s, cz + dz * s];
      const first = planner.walk(start, dx, dz, span);
      const end = first && ring1 !== null && edgeLane ? planner.walk(first, dx, dz, span) : first;
      if (end) planner.line([start, end], F.main, true);
      if (ring1 === null || small) continue;
      for (const side of [-1, 1]) {
        const from: XZ = [cx + dx * rx - dz * side * spokeAt, cz + dz * rz + dx * side * spokeAt];
        if (!planner.isLoop(from[0], from[1])) continue;
        const out = planner.walk(from, dx, dz, span);
        if (out && Math.max(Math.abs(out[0] - from[0]), Math.abs(out[1] - from[1])) >= 6) planner.line([from, out], F.lane);
      }
    }
  } else {
    // The ladder: the back lanes and the outer cross streets a loop round the middle, the high street and the cross
    // street through the square joining across it - as far out as it fits.
    let { across, along } = ladder!;
    const [ha, hb] = upright ? [sqx, sqz] : [sqz, sqx];
    const at = (a: number, b: number): XZ => (upright ? [cx + a, cz + b] : [cx + b, cz + a]);
    for (;;) {
      const box: XZ[] = [at(-across, -along), at(across, -along), at(across, along), at(-across, along)];
      const fits = pathTiles([...box, box[0]!]).every(([x, z]) => within(x, z) && !onRing(x, z));
      if (fits || (across <= ha + 2 && along <= hb + 2)) {
        if (!planner.loop(box, F.lane)) throw new Error(`${plan.id}: no room for its streets`);
        planner.line([at(0, -along), at(0, along)], F.main, true);
        planner.line([at(-across, 0), at(across, 0)], F.main, true);
        break;
      }
      if (across > ha + 2) across--;
      if (along > hb + 2) along--;
    }
  }
  // Each gate's way in: from the road's end outside, straight in to the first street it meets (or in to the square's
  // row or column, then along it).
  for (const g of gateMouths) {
    const hit = planner.walk(g.end, -g.ux, -g.uz, span, { any: true, free: 7 });
    if (hit) {
      planner.line([g.end, hit], gateWidth, true, true);
      continue;
    }
    const steps = g.ux !== 0 ? Math.abs(g.end[0] - cx) : Math.abs(g.end[1] - cz);
    const corner: XZ = [g.end[0] - g.ux * steps, g.end[1] - g.uz * steps];
    const dx = g.ux === 0 ? Math.sign(cx - corner[0]) : 0;
    const dz = g.uz === 0 ? Math.sign(cz - corner[1]) : 0;
    const on = planner.isStreet(corner[0], corner[1]) ? corner : planner.walk(corner, dx, dz, span, { any: true });
    if (!on) throw new Error(`${plan.id}: no way in from its gate at ${g.x},${g.z}`);
    planner.line(on === corner ? [g.end, corner] : [g.end, corner, on], gateWidth, true, true);
  }
  const graph = planner.graph(squares, gateMouths.map((g) => g.end));
  graph.prune();

  // Ground for the landmarks, cleared of the lanes before anything stands: the capital's citadel, a city's keep, the
  // estate's manor, a temple bigger than a block.
  const reserve = (size: readonly [number, number], near: readonly [number, number]) => {
    const [w, d] = size;
    const options: [number, number, number][] = [];
    for (let z = Math.round(near[1] - R * 0.4); z <= near[1] + R * 0.4; z += 2) {
      for (let x = Math.round(near[0] - R * 0.4); x <= near[0] + R * 0.4; x += 2) options.push([x - Math.floor(w / 2), z - Math.floor(d / 2), Math.hypot(x - near[0], z - near[1])]);
    }
    options.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
    for (const [rx, rz] of options) {
      let ok = true;
      for (let z = rz - 1; z <= rz + d && ok; z++) for (let x = rx - 1; x <= rx + w && ok; x++) ok = within(x, z) && !onRing(x, z) && !mouthTiles.has(I(x, z));
      if (ok && graph.clear(rx, rz, w, d)) return;
    }
  };
  const templeSize = sizeOf(form, "temple");
  if (form === "capital") reserve([28, 22], centreOf("keep"));
  else if (form === "city") reserve([20, 16], centreOf("keep"));
  else if (form === "estate") reserve([24, 16], centreOf("grounds"));
  if (form === "capital" || form === "city" || form === "clan") reserve(templeSize, form === "clan" ? [cx, cz - sqz - 2 - Math.floor(templeSize[1] / 2)] : centreOf("temple"));
  graph.thin(F.thin, random);
  // Paved: the main streets first, then the lanes, then the squares.
  const ways = graph.live;
  const mains: [number, number][][] = [];
  for (const w of [...ways.filter((w) => w.main), ...ways.filter((w) => !w.main)]) {
    for (const [x, z] of wayTiles(graph, w)) if (pave(x, z, w.main ? 0 : 1, w.main ? ground.street : ground.lane) && w.main) keyTile[local(x, z)] = 1;
    if (w.main) mains.push(wayMiddle(graph, w));
  }
  for (const s of squares) for (const [x, z] of squareTiles(s)) if (pave(x, z, 2, ground.square)) keyTile[local(x, z)] = 1;

  // --- Building ---------------------------------------------------------------------------------------------------------

  const buildings: BuildingData[] = [];
  const interiors: InteriorSpec[] = [];
  const doors = new Set<number>();
  const places: TownPlace[] = [];
  /** Whether a tile is one of the plan's streets or squares, still open: what a door may open onto. */
  const fronts = (x: number, z: number) => {
    if (!within(x, z) || street[local(x, z)] !== 1) return false;
    const u = land.use[I(x, z)];
    return u === Use.Street || u === Use.Kept;
  };

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
    const out: { x: number; z: number; rot: number; rank: number; order: number; key: boolean }[] = [];
    for (let z = z0; z < z0 + span; z++) {
      for (let x = x0; x < x0 + span; x++) {
        if (!fronts(x, z) || !within(x, z)) continue;
        for (const d of DIRS) if (within(x + d.dx, z + d.dz) && land.use[I(x + d.dx, z + d.dz)] === Use.Lot) out.push({ x, z, rot: d.rot, rank: rank[local(x, z)]!, order: order[local(x, z)]!, key: keyTile[local(x, z)] === 1 });
      }
    }
    return out;
  };

  /** A town building as near a point as the streets let it stand, facing south, west or east, its door seen. */
  const site = (size: readonly [number, number], near: readonly [number, number], o: { spread?: number; main?: boolean; key?: boolean; district?: District; gap?: number; anyWay?: boolean } = {}): Footprint | null => {
    let best: { f: Footprint; score: number } | null = null;
    const [wide, deep] = size;
    for (const c of frontages()) {
      if (!o.anyWay && c.rot === 2) continue;
      if (o.main && c.rank !== 0) continue;
      if (o.key && !c.key) continue;
      const dist = Math.hypot(c.x - near[0], c.z - near[1]);
      if (best && dist - 12 > best.score) continue;
      for (const k of [Math.floor(wide / 2), Math.floor(wide / 2) - 2, Math.floor(wide / 2) + 2, 1, wide - 2]) {
        if (k < 0 || k >= wide) continue;
        const f = footprintAt([c.x, c.z], c.rot, wide, deep, k);
        if (o.district && districtAt(Math.round(f.x + f.w / 2), Math.round(f.z + f.d / 2)) !== o.district) continue;
        if (!fits(f, o.gap ?? 1)) continue;
        // A door off the middle of its front (near a corner, under a banner) is the last choice.
        const score = dist + (c.rot === 0 ? 0 : 4) + Math.abs(k - Math.floor(wide / 2)) * 1.5 + random() * (o.spread ?? 4);
        if (!best || score < best.score) best = { f, score };
        break;
      }
    }
    return best?.f ?? null;
  };
  /** A place the town is crossed for, on a main street or a square where one is near enough, else on any street. */
  const keySite = (size: readonly [number, number], near: readonly [number, number], o: { spread?: number; gap?: number } = {}): Footprint | null => site(size, near, { ...o, key: true }) ?? site(size, near, o);
  const addInterior = (f: Footprint, kind: BuildingKind, id: string, title: string, room: InteriorKind, extra: Partial<InteriorSpec> = {}) => {
    place(f, kind, id, { interior: id, sign: title });
    interiors.push({ id, name: title, kind: room, town: plan.id, style, exit: f.door, building: f.rot % 2 === 0 ? { w: f.w, d: f.d } : { w: f.d, d: f.w }, ...extra });
    if (room !== "house" && room !== "crypt") places.push({ kind: id.endsWith("-shrine") ? "shrine" : room, name: title, x: f.door[0], z: f.door[1] });
  };
  /** A plaza of `w` by `d` lots beside a street, as near a point as it fits: one of the plan's squares. */
  const plaza = (w: number, d: number, near: readonly [number, number], surface: number, name: string, o: { loose?: boolean; key?: boolean } = {}): [number, number] | null => {
    let best: [number, number, number] | null = null;
    for (let z = z0; z + d <= z0 + span; z += 2) {
      for (let x = x0; x + w <= x0 + span; x += 2) {
        const dist = Math.hypot(x + w / 2 - near[0], z + d / 2 - near[1]);
        if (best && dist >= best[2]) continue;
        let ok = true;
        for (let zz = z; zz < z + d && ok; zz++) for (let xx = x; xx < x + w && ok; xx++) ok = within(xx, zz) && land.use[I(xx, zz)] === Use.Lot && !onRing(xx, zz);
        if (!ok) continue;
        // On a corner: along two of its sides, most of each a street (with `key`, one a main street or the square).
        const side = (n: number, at: (k: number) => readonly [number, number]) => {
          let open = 0;
          let main = 0;
          for (let k = 0; k < n; k++) {
            const [tx, tz] = at(k);
            if (fronts(tx, tz)) open++;
            if (fronts(tx, tz) && keyTile[local(tx, tz)] === 1) main++;
          }
          return { open: open * 2 > n ? 1 : 0, main: main * 2 > n ? 1 : 0 };
        };
        const all4 = [side(w, (k) => [x + k, z - 1]), side(w, (k) => [x + k, z + d]), side(d, (k) => [x - 1, z + k]), side(d, (k) => [x + w, z + k])];
        const sides = all4.reduce((n, q) => n + q.open, 0);
        if (sides >= (o.loose ? 1 : 2) && (!o.key || all4.some((q) => q.main))) best = [x, z, dist];
      }
    }
    if (!best) return null;
    for (let zz = best[1]; zz < best[1] + d; zz++) for (let xx = best[0]; xx < best[0] + w; xx++) pave(xx, zz, 2, surface);
    squares.push({ x: best[0], z: best[1], w, d, name });
    // The market is the square's own: the shops stand round it as round the square.
    if (name === "The market") for (let zz = best[1]; zz < best[1] + d; zz++) for (let xx = best[0]; xx < best[0] + w; xx++) keyTile[local(xx, zz)] = 1;
    return [best[0] + Math.floor(w / 2), best[1] + Math.floor(d / 2)];
  };

  // Open spaces first: the capital's market, the arena, a campus's courtyards.
  const market = form === "capital" ? plaza(18, 13, centreOf("market").map((v, k) => v + (k === 0 ? 22 : 4)) as [number, number], ground.square, "The market", { key: true }) : null;
  const arena = village || form === "stilts" ? null : (plaza(10, 8, centreOf("residential"), ground.square, "The arena", { key: true }) ?? plaza(10, 8, centreOf("residential"), ground.square, "The arena"));
  if (form === "campus") for (let n = 0; n < 3; n++) plaza(between(random, 12, 16), between(random, 9, 12), seeds[(n % (seeds.length - 1)) + 1] ? [Math.round(seeds[(n % (seeds.length - 1)) + 1]!.x), Math.round(seeds[(n % (seeds.length - 1)) + 1]!.z)] : [cx, cz], S.grass, "A courtyard");

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

  if (!village && form !== "stilts") {
    const near: readonly [number, number] = form === "clan" ? [cx, cz - sqz - 2] : centreOf("temple");
    const temple = keySite(templeSize, near, { spread: 3, gap: 2 }) ?? site([templeSize[0] - 3, templeSize[1] - 3], near, { spread: 3 });
    if (temple) {
      addInterior(temple, "temple", `${plan.id}-temple`, plan.temple, "temple", { resident: { name: "Priest", text: ["Rest a while. The wells of Dominaria remember the faithful."] } });
      // Its close: open paving before its front.
      if (form === "capital" || form === "city") {
        const [sx, sz] = [temple.door[0] - (temple.rot === 1 ? 6 : temple.rot === 3 ? -1 : Math.floor(temple.w / 2)), temple.door[1] + (temple.rot === 0 ? 1 : -Math.floor(temple.d / 2))];
        const [cw, cd] = [temple.rot === 0 ? temple.w : 6, temple.rot === 0 ? 6 : temple.d];
        let paved = 0;
        for (let z = sz; z < sz + cd; z++) for (let x = sx; x < sx + cw; x++) if (within(x, z) && land.use[I(x, z)] === Use.Lot && pave(x, z, 2, ground.square)) paved++;
        if (paved > 0) squares.push({ x: sx, z: sz, w: cw, d: cd, name: "The temple close" });
      }
    }
  }
  const innGate = firstGate.inner;
  const innSize = R < 30 ? ([10, 7] as const) : sizeOf(form, "inn");
  const innAt = site(innSize, innGate, { main: true, spread: 2 }) ?? site(innSize, innGate, { spread: 2 }) ?? site([8, 6], [cx, cz], { spread: 2, gap: 0 });
  if (!innAt) throw new Error(`${plan.id}: no room for the inn`);
  addInterior(innAt, "inn", `${plan.id}-inn`, plan.inn, "inn", { innkeeper: { name: `The keeper of ${plan.inn}`, text: plan.innkeeper }, spellTable: true });
  spec.vendors.forEach((v, k) => {
    const near: readonly [number, number] = market && k % 2 === 1 ? market : [cx + Math.round(Math.cos(k * 2.1) * (sqx + 3)), cz + Math.round(Math.sin(k * 2.1) * (sqz + 3))];
    const f = keySite(sizeOf(form, "shop"), near, { spread: 4, gap: 0 }) ?? site([7, 5], near, { spread: 4, gap: 0 });
    if (!f) throw new Error(`${plan.id}: no room for ${v.id}'s shop`);
    addInterior(f, "shop", `${v.id}-shop`, v.name, "shop", { vendor: v });
  });
  if (spec.exotic) {
    const f = keySite(sizeOf(form, "exotic"), market ?? [cx, cz], { spread: 4, gap: 0 }) ?? site([7, 5], market ?? [cx, cz], { spread: 4, gap: 0 });
    if (!f) throw new Error(`${plan.id}: no room for the exotic wares shop`);
    addInterior(f, "shop", `${spec.exotic.id}-shop`, spec.exotic.name, "exotic-wares", { vendor: spec.exotic });
  }
  if (!village) {
    const guild = keySite(sizeOf(form, "guildhall"), form === "campus" ? [cx, cz + sqz + 2] : centreOf("artisan"), { spread: 6, gap: 1 });
    if (guild) addInterior(guild, "guildhall", `${plan.id}-guildhall`, plan.guild, "guildhall", { spellTable: true, resident: { name: "Guild master", text: ["Our tables are open to any mage. Build your deck in peace."] } });
    const tower = style === "tolarian";
    const library = keySite(sizeOf(form, tower ? "tower" : "library"), centreOf(form === "campus" ? "residential" : "temple"), { spread: 8, gap: 1 });
    if (library) {
      const title = tower ? `${the} Mage's Tower` : `${the} Library`;
      addInterior(library, tower ? "tower" : "library", `${plan.id}-${tower ? "tower" : "library"}`, title, tower ? "tower" : "library", {
        resident: { name: tower ? "Archmage" : "Librarian", text: ["Every card ever printed is written down somewhere. Most of them here."] },
      });
    }
    const smithy = keySite(sizeOf(form, "smithy"), centreOf("artisan"), { spread: 6, gap: 0 }) ?? site(sizeOf(form, "smithy"), innGate, { spread: 8, gap: 0 });
    if (smithy) addInterior(smithy, "smithy", `${plan.id}-smithy`, `${the} Smithy`, "smithy", { armorer: true });
  } else {
    const shrine = keySite(sizeOf(form, "shrine"), [cx, cz + sqz + 3], { spread: 6 });
    if (shrine) addInterior(shrine, "temple", `${plan.id}-shrine`, `${the} Shrine`, "temple", { resident: { name: "Hermit", text: ["The road is long. Sit, and let it wait for you."] } });
  }
  const homes = form === "capital" ? 10 : village || form === "stilts" ? 3 : 6;
  for (let n = 1; n <= homes; n++) {
    const angle = turn + n * 2.4;
    const r = boundary(angle) * (0.4 + random() * 0.35);
    const near: readonly [number, number] = [cx + Math.cos(angle) * r, cz + Math.sin(angle) * r];
    const size = sizeOf(form, "house", small);
    const f = site(size, near, { spread: 12, gap: 1 }) ?? site(size, near, { spread: 12, gap: 0 }) ?? site([size[0] - 1, size[1] - 1], near, { spread: 12, gap: 0 });
    if (!f) break;
    const folk = plan.folk[(n - 1) % Math.max(1, plan.folk.length)];
    addInterior(f, "house", `${plan.id}-house-${n}`, `A house in ${plan.name}`, "house", n <= plan.folk.length && folk ? { resident: folk } : {});
  }

  // The rows: along the main streets first, then the lanes and squares, each district building its own way.
  const all = frontages().sort((p, q) => p.rank - q.rank || p.order - q.order);
  let count = 0;
  for (const c of all) {
    if (land.use[I(c.x + DIRS.find((d) => d.rot === c.rot)!.dx, c.z + DIRS.find((d) => d.rot === c.rot)!.dz)] !== Use.Lot) continue;
    const dir = DIRS.find((d) => d.rot === c.rot)!;
    const district = districtAt(c.x + dir.dx, c.z + dir.dz);
    const fill = fillFor(form, district, small);
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
  else if (!village && form !== "elfhame") stalls([cx + Math.ceil(sqx / 2) + 1, cz + Math.ceil(sqz / 2)], Math.floor(sqx / 2), Math.floor(sqz / 2));

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
    places.push({ kind: "pitch", name: "The caravans' pitch", x: pitch.x, z: pitch.z });
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
  places.push({ kind: "quest-board", name: village ? "Notice board" : "Quest board", x: bx, z: bz });

  // The arena, closed: its gate at the middle of its plaza's side along a street (a main street's where it has one),
  // facing it - south, east or west before north.
  if (!village) {
    let at = arena ?? plaza(8, 6, centreOf("residential"), ground.square, "The arena", { key: true }) ?? plaza(8, 6, centreOf("residential"), ground.square, "The arena", { loose: true });
    let rot = 0;
    const yard = at ? squares.find((s) => s.name === "The arena" && inSquare(s, at![0], at![1])) : undefined;
    if (yard) {
      const sides = [
        { rot: 0, x: yard.x + Math.floor(yard.w / 2), z: yard.z + yard.d - 1, ox: 0, oz: 1 },
        { rot: 3, x: yard.x + yard.w - 1, z: yard.z + Math.floor(yard.d / 2), ox: 1, oz: 0 },
        { rot: 1, x: yard.x, z: yard.z + Math.floor(yard.d / 2), ox: -1, oz: 0 },
        { rot: 2, x: yard.x + Math.floor(yard.w / 2), z: yard.z, ox: 0, oz: -1 },
      ];
      const score = (s: (typeof sides)[number]) => {
        const [ex, ez] = [s.x + s.ox, s.z + s.oz];
        return fronts(ex, ez) ? (keyTile[local(ex, ez)] === 1 ? 2 : 1) : 0;
      };
      const best = sides.reduce((b, s) => (score(s) > score(b) ? s : b));
      at = [best.x, best.z];
      rot = best.rot;
    }
    at ??= [cx, cz + sqz - 1];
    const gate: PropData = { id: "arena-gate", x: at[0] + 0.5, z: at[1] + 0.5, rot };
    for (const [x, z] of tilesOf(gate).tiles) if (land.inside(x, z) && free(I(x, z))) stand(I(x, z));
    props.push(gate);
    if (land.open(I(at[0], at[1]))) stand(I(at[0], at[1]));
    npcs.push({ id: `${plan.id}-arena`, x: at[0], z: at[1], kind: "arena", name: "The arena", text: ["The arena is closed. A sign reads: coming soon."], stand: [at[0] + 0.5, level / 16, at[1] + 0.5] });
    places.push({ kind: "arena", name: "The arena", x: at[0], z: at[1] });
  }

  // Guards in the gates, pacing the main street inside; townsfolk about the square.
  const figures = FOLK_FIGURES[style] ?? FOLK_FIGURES.benalish!;
  if (F.guards) {
    let k = 0;
    for (const g of gateMouths) {
      // Just inside the gate, and up the way in.
      const stops = [1, 9].map((s): [number, number] => [g.x - g.ux * s, g.z - g.uz * s]).filter((p) => land.open(I(p[0], p[1])));
      if (stops.length < 2) continue;
      npcs.push({
        id: `${plan.id}-guard-${++k}`,
        x: stops[0]![0],
        z: stops[0]![1],
        kind: "guard",
        name: `${plan.name} guard`,
        text: ["Keep to the roads. The waymarkers say how bad it gets past them."],
        figure: figures.guard,
        seed: k,
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

  // The enclosure's drawing: wall runs along the outline between towers, or hedgerows, or a palisade - each run straight
  // along a row or a column of the outline's tiles, so a slanted edge is drawn as the staircase its tiles are, and what is
  // drawn is what blocks (cut at chunk edges, 16 tiles at most).
  if (walled) {
    for (const e of edges) {
      // The outer face: the side of the whole edge away from the centre.
      const [ex0, ez0] = e[0]!;
      const [ex1, ez1] = e[e.length - 1]!;
      const len = Math.hypot(ex1 - ex0, ez1 - ez0) || 1;
      const nx = (ez1 - ez0) / len;
      const nz = -(ex1 - ex0) / len;
      const sgn = nx * ((ex0 + ex1) / 2 - cx) + nz * ((ez0 + ez1) / 2 - cz) >= 0 ? 1 : -1;
      const along = Math.abs(ex1 - ex0) >= Math.abs(ez1 - ez0);
      let run: [number, number][] = [];
      const flush = () => {
        if (run.length > 0) {
          const [ax, az] = run[0]!;
          const [bx2, bz2] = run[run.length - 1]!;
          // A run's face is the outer side across it: a row faces north or south, a column east or west.
          const row = run.length > 1 ? az === bz2 : along;
          const face = row ? (nz * sgn >= 0 ? "s" : "n") : nx * sgn >= 0 ? "e" : "w";
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
        const last = run[run.length - 1];
        // The run goes on while the tile is the next along its row (or column) in the same chunk.
        const next = !!last && Math.abs(x - last[0]) + Math.abs(z - last[1]) === 1;
        const straight = next && (run.length < 2 || (run[0]![1] === run[1]![1] ? z === last![1] : x === last![0]));
        if (s && (!straight || Math.floor(x / 32) !== Math.floor(s[0] / 32) || Math.floor(z / 32) !== Math.floor(s[1] / 32) || run.length >= 16)) flush();
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

  /** The plan as the world keeps it (format.ts, `TownPlan`): only the nodes its ways use, in the order they are met. */
  const planOf = (): TownPlan => {
    const index = new Map<number, number>();
    const nodes: XZ[] = [];
    const use = (n: number) => {
      let k = index.get(n);
      if (k === undefined) {
        k = nodes.length;
        index.set(n, k);
        nodes.push(graph.nodes[n]!);
      }
      return k;
    };
    const kept = graph.live.map((w): StreetWay => ({ a: use(w.a), b: use(w.b), width: w.width, ...(w.main ? { main: true } : {}), ...(w.via.length > 0 ? { via: w.via } : {}) }));
    return {
      outline: poly,
      enclosure: F.enclosure,
      nodes,
      ways: kept,
      squares,
      gates: graph.gates.map(use),
      places,
    };
  };
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
      plan: planOf(),
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
