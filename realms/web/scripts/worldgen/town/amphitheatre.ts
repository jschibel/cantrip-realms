// The grown towns (planner.ts): an elfhame among the great trees, a Keldon clan hold, a village round its green, the
// boardwalks over the Morass. Each is laid out the same way, by its form's recipe:
//
// 1. The site: the sea and a stretch of shore kept clear, the river or stream (a course that meanders by noise, laid
//    through or past the town as the setting says), and - for an elfhame - the great trees first, scattered by
//    Poisson-disc sampling, thinned by a noise so the wood has clearings.
// 2. The centre: an ellipse (a glade, a hall's yard, a green, a platform) where a score over the grounds is best: room
//    for the rings to the north, level ground, clear of water and of the sea, near the middle - and in an elfhame, where
//    the trees are fewest (the glade is found among them, not cut).
// 3. The rings: the town's places on lots in arcs concave to the south round the centre's north, east and west - an
//    amphitheatre (every door seen from the south). Each arc is fitted to an ellipse about the centre and sampled to lots
//    stepped along it: the head lot on the axis (the temple's, the shrine's, the great hall's), the rest outward to east
//    and west in turn, each lot's front where the arc runs over its inner edge, so the fronts step down and out. A ring's
//    lots front a path that runs along them and jogs between them (a stepped curve); a second ring stands behind the
//    first, clear of the ground the first's buildings hide from the camera (measured from the art, view.ts).
// 4. Growth: what the rings cannot hold, lots grown outward from the paths over a field (nearer the centre, the north
//    and the shore better), each with its own path to its door.
// 5. The paths: spokes down from the rings into the centre, and from each gate a road in, laid by least-cost routes
//    (organic.ts `route`) that wander round the lots and what they hide, merge with the paths already laid and bridge the
//    water.
// 6. The outline: traced from what is built (a closing of it), or for a clan an oval round its lots; each gate where its
//    road crosses it.
// 7. The terraces: the centre one level, each lot one level within a level of it, the rest eased.
// The lots are the solver's blocks (place.ts), one building each; the centre is the plan's square.

import type { PropData, TownSquare, XZ } from "../../../src/world/format";
import { inSquare, squareTiles } from "../../../src/world/streets";
import { S } from "../ids";
import { fbm, noise } from "../land";
import { makeBuilding } from "./buildings";
import { poisson } from "./country";
import { type Role, groundsOf, kindFor, sizesFor, styleFor } from "./forms";
import { Grid, type Lot, N4, N8, Net, type OrganicPlan, blockOf, chain, dilate, erode, fillHoles, inEllipse, organicPlanner, pull, ring, route, terraces } from "./organic";
import type { Box, Gate, PlanInput, Planner } from "./planner";
import type { Side } from "./types";
import { buildingHides } from "./view";

type Form = "elfhame" | "clan" | "village" | "stilts" | "capital" | "city" | "campus" | "estate";

/** What a form asks of the planner. */
interface Recipe {
  /** The centre's radii, a home town's and a village's. */
  readonly centre: { readonly town: readonly [number, number]; readonly village: readonly [number, number] };
  /** A round centre (an ellipse) or a platform (its rectangle). */
  readonly round: boolean;
  /** Rings of lots, a home town's and a village's. */
  readonly rings: { readonly town: number; readonly village: number };
  /** Lots beyond the program's, for the town's ordinary houses. */
  readonly extra: { readonly town: number; readonly village: number };
  /** The outline: traced round what is built, or an oval round the lots. */
  readonly outline: "traced" | "oval";
  /** Great trees first (an elfhame). */
  readonly trees: boolean;
  /** Every way boardwalk (the stilts'). */
  readonly planks: boolean;
  /** More boardwalks between the rings' paths, and platforms at junctions (the stilts' web). */
  readonly web: boolean;
  /** A light at the junctions. */
  readonly light: PropData | null;
  /** What heads the centre: its temple (or shrine), its mage's tower, or its landmark (the estate's manor). */
  readonly head?: "temple" | "tower" | "landmark";
  /** The head's place off the centre's axis, as a share of its half-width (the Academy's tower stands to one side). */
  readonly headOffset?: number;
  /** The ring whose head is the town's landmark at the north (the capital's citadel, the Hold's keep). */
  readonly landmarkRing?: number;
  /** Lesser centres, each with arcs of its own (the capital's lesser square and quarters, the Academy's quads). */
  readonly quarters?: { readonly town: readonly Quarter[]; readonly village: readonly Quarter[] };
  /** The town always stands on its river (through it, or along its south where the setting puts it on a side). */
  readonly river?: boolean;
  /** How far the river bends either way, tiles. */
  readonly bend?: number;
  /** A quay along the water south of the town (its river's north bank, or the shore), warehouses fronting it. */
  readonly quay?: boolean;
  /** Bridges over the river besides the roads', as many as there is room for. */
  readonly bridges?: number;
  /** A designed wall: straight curtains between towers, stepped in at its corners, the town grown to fill it. */
  readonly designed?: boolean;
  /** A lot kept for a garden with no building (the Academy's walled physic garden). */
  readonly garden?: "physic";
  /** A slip for the boats on a shore, its boat drawn up on it, and sheds by it (a clan's). */
  readonly slip?: boolean;
  /** Each ring a terrace above the one inside it (a hold on its rise). */
  readonly terraced?: boolean;
  /** No wall round the town though its form has one: the estate's wall is its manor's alone. */
  readonly unwalled?: boolean;
  /** The centre's name, and a lesser one's. */
  readonly names?: readonly [string, string];
}

/** A lesser centre: a square, a close, a yard, a park, a quad, a deck - and the arcs that stand round it. */
interface Quarter {
  readonly kind: "square" | "close" | "yard" | "park" | "circle" | "quad" | "deck";
  readonly name: string;
  /** Its radii. */
  readonly size: readonly [number, number];
  /** What heads it: the first still waiting of these roles; none, and its arcs hold only what it holds. */
  readonly head: readonly string[] | null;
  /** What its arcs hold: the town's places in turn, the manors, or so many of the extra lots (workshops, houses). */
  readonly fill: "queue" | "manor" | "extra";
  readonly count?: number;
  readonly rings: number;
  /** Where it lies: near the centre, on the high ground, or by a gate other than the main one. */
  readonly where: "near" | "high" | "gate";
}

/** A deck of the stilts': a lesser platform, the next of the town's places round it. */
const DECK = (rx: number, rz: number): Quarter => ({ kind: "deck", name: "A platform", size: [rx, rz], head: null, fill: "queue", rings: 1, where: "near" });

/** A quad of the Academy's: a lawn headed by a hall (its library, its guild), its own arc of halls round it. */
const QUAD = (rx: number, rz: number): Quarter => ({ kind: "quad", name: "The quad", size: [rx, rz], head: ["library", "guildhall", "tower", "temple", "exotic", "shop"], fill: "queue", rings: 1, where: "near" });

/**
 * The capital's quarters besides its market square: the lesser square with the great places it holds, the Seven Houses'
 * close on the high ground (their manors in arcs round it, each in its walled garden), the smiths' yard by a gate (the
 * smithy at its head, workshops round it) and the park.
 */
const CAPITAL_QUARTERS: readonly Quarter[] = [
  { kind: "square", name: "The lesser square", size: [7, 4], head: ["guildhall", "library", "exotic", "shop"], fill: "queue", rings: 1, where: "near" },
  { kind: "close", name: "The Houses' close", size: [6, 3], head: ["manor"], fill: "manor", rings: 2, where: "high" },
  { kind: "yard", name: "The smiths' yard", size: [5, 3], head: ["smithy"], fill: "extra", count: 6, rings: 1, where: "gate" },
  { kind: "park", name: "The park", size: [8, 5], head: null, fill: "extra", count: 6, rings: 1, where: "near" },
];

const RECIPES: Readonly<Record<Form, Recipe>> = {
  elfhame: { centre: { town: [16, 8], village: [14, 7] }, round: true, rings: { town: 2, village: 1 }, extra: { town: 18, village: 6 }, outline: "traced", trees: true, planks: false, web: false, light: { id: "lantern-post", x: 0, z: 0, args: { glow: "green" } }, names: ["The glade", "The glade"], quarters: { town: [{ kind: "circle", name: "The druids' circle", size: [7, 4], head: null, fill: "extra", count: 5, rings: 1, where: "near" }], village: [] } },
  clan: { centre: { town: [15, 7], village: [10, 5] }, round: true, rings: { town: 2, village: 1 }, extra: { town: 16, village: 7 }, outline: "oval", trees: false, planks: false, web: false, light: { id: "torch-post", x: 0, z: 0 }, names: ["The yard", "The yard"], slip: true },
  village: { centre: { town: [14, 7], village: [12, 6] }, round: true, rings: { town: 2, village: 1 }, extra: { town: 10, village: 10 }, outline: "traced", trees: false, planks: false, web: false, light: { id: "lamp-post", x: 0, z: 0 }, names: ["The green", "The green"] },
  stilts: { centre: { town: [9, 6], village: [7, 5] }, round: false, rings: { town: 2, village: 1 }, extra: { town: 8, village: 7 }, outline: "traced", trees: false, planks: true, web: true, light: { id: "lantern-post", x: 0, z: 0, args: { glow: "gold" } }, names: ["The platform", "A platform"], quarters: { town: [DECK(3, 2), DECK(2, 2)], village: [DECK(3, 2), DECK(2, 2)] } },
  // The forms that were rows.
  capital: { centre: { town: [13, 7], village: [13, 7] }, round: false, rings: { town: 2, village: 2 }, extra: { town: 80, village: 80 }, outline: "traced", trees: false, planks: false, web: false, light: { id: "lamp-post", x: 0, z: 0 }, landmarkRing: 2, quarters: { town: CAPITAL_QUARTERS, village: CAPITAL_QUARTERS }, terraced: true, names: ["The market square", "The lesser square"], river: true, bend: 12, quay: true, bridges: 2, designed: true },
  city: { centre: { town: [11, 6], village: [9, 5] }, round: false, rings: { town: 3, village: 2 }, extra: { town: 26, village: 10 }, outline: "traced", trees: false, planks: false, web: false, light: { id: "lamp-post", x: 0, z: 0 }, landmarkRing: 2, terraced: true, names: ["The square", "The square"], quay: true, designed: true },
  campus: { centre: { town: [12, 7], village: [9, 5] }, round: false, rings: { town: 1, village: 1 }, extra: { town: 12, village: 6 }, outline: "traced", trees: false, planks: false, web: false, light: { id: "lamp-post", x: 0, z: 0 }, head: "tower", headOffset: 0.5, quarters: { town: [QUAD(7, 4), QUAD(6, 4), QUAD(6, 3)], village: [QUAD(7, 4), QUAD(5, 3)] }, names: ["The great quad", "The quad"], garden: "physic" },
  estate: { centre: { town: [15, 6], village: [10, 5] }, round: false, rings: { town: 1, village: 1 }, extra: { town: 14, village: 9 }, outline: "traced", trees: false, planks: false, web: false, light: { id: "lantern-post", x: 0, z: 0, args: { glow: "gold" } }, head: "landmark", unwalled: true, names: ["The village green", "The green"] },
};

/** A strip's width: the path along a ring's fronts, a spoke, a road in. */
const W = 3;
/** Tiles between lots in a ring: a passage. */
const GAP = 3;

/** A lot the program asks for: its width (the building's and its margins), depth, and what its building hides north. */
interface Want {
  readonly id: string;
  readonly role: Role | "arena";
  readonly w: number;
  /** The building's depth (the deepest it may be) and the lot's (with its yard). */
  readonly d: number;
  readonly depth: number;
  /** Rows north of its building the camera cannot see past. */
  readonly shadow: number;
  readonly site?: string;
  /** One of the extra lots beyond the program: laid where there is room, left out where there is none. */
  readonly optional?: boolean;
}

const shadows = new Map<string, number>();
/** How far north of a building of a role its shadow reaches at the front heading (two storeys, as built). */
function shadowOf(style: string, role: Role, w: number, d: number): number {
  const key = `${style}:${role}:${w}:${d}`;
  let s = shadows.get(key);
  if (s === undefined) {
    // The tallest it may be built: each of its recipe's choices at either end.
    s = 0;
    for (const pick of [0, 0.5, 0.999]) {
      const b = makeBuilding("measure", style, kindFor(style, role), { x: 0, z: 0, w, d, rot: 0, door: [Math.floor(w / 2), d] }, () => pick, { storeys: 2, params: role === "tower" ? { floors: 3 } : style === "urborg" ? { stilts: 1.2 } : {}, ...(role === "manor" ? { grand: true } : {}) });
      s = Math.max(s, ...buildingHides(b, 0).map(([, z]) => -z));
    }
    shadows.set(key, s);
  }
  return s;
}

const STEP: Record<Side, XZ> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

function planGrown(form: Form, input: PlanInput): OrganicPlan {
  const R = RECIPES[form];
  const { box, town, fields, setting } = input;
  const village = town.kind === "village";
  const random = input.random;
  const g = new Grid(fields.GW, fields.GD);
  const I = g.idx;
  const sea = new Set(setting.sea);
  const looks = groundsOf(town);

  // --- 1. The site -------------------------------------------------------------------------------------------------------
  // Closed to the town: the sea, the shore (two tiles of it), the water, and the grounds past the box.
  const blocked = new Uint8Array(g.size);
  const seaTile = new Uint8Array(g.size);
  for (let i = 0; i < g.size; i++) if (fields.isSea(g.x(i), g.z(i))) seaTile[i] = 1;
  const nearSea = dilate(g, seaTile, 2);
  for (let i = 0; i < g.size; i++) {
    const x = g.x(i);
    const z = g.z(i);
    if (nearSea[i] || x < box.x0 + 1 || z < box.z0 + 1 || x >= box.x1 - 1 || z >= box.z1 - 1) blocked[i] = 1;
  }
  // The water: a course that meanders, past a side or through, three to five wide.
  const water = new Uint8Array(g.size);
  // A town that always stands on its river (the capital) has it through its south, bending: where the setting puts the
  // river on a side, along its south side inside it.
  const riverAt = R.river ? (setting.river === "south" || sea.has("south") ? "south-in" : "through") : setting.river;
  if (riverAt) {
    const wander = fbm(`${input.tag}:stream`, 22, 2);
    const width = village ? 3 : R.river ? 6 : 4;
    const along = riverAt === "through" || riverAt === "south-in" || riverAt === "north" || riverAt === "south";
    const base = riverAt === "through" ? Math.round((box.z0 + box.z1) / 2 + (box.z1 - box.z0) * 0.22) : riverAt === "south-in" ? box.z1 - 20 : riverAt === "north" ? box.z0 - 6 : riverAt === "south" ? box.z1 + 3 : riverAt === "west" ? box.x0 - 6 : box.x1 + 3;
    const span = along ? g.W : g.D;
    // A real bend: one long swing across the town, the noise's wander over it.
    const phase = R.bend ? random() * Math.PI * 2 : 0;
    for (let t = 0; t < span; t++) {
      const swing = R.bend ? Math.round(Math.sin(((t - box.x0) / (box.x1 - box.x0)) * Math.PI * 1.6 + phase) * R.bend) : 0;
      const off = swing + Math.round((wander(t, along ? 3 : 7) - 0.5) * (riverAt === "through" ? 12 : 10));
      for (let k = 0; k < width; k++) {
        const [x, z] = along ? [t, base + off + k] : [base + off + k, t];
        if (g.inside(x, z) && !seaTile[I(x, z)]) water[I(x, z)] = 1;
      }
    }
  }
  const wet = (i: number) => water[i] === 1;
  // The great trees, first: blue noise over the grounds, thinned by a noise of its own so the wood has clearings.
  const treeAt = new Uint8Array(g.size);
  const treeList: XZ[] = [];
  if (R.trees) {
    const thin = fbm(`${input.tag}:glades`, 24, 2);
    for (const [px, pz] of poisson(box.x0, box.z0, box.x1, box.z1, village ? 4.2 : 3.6, random, (x, z) => g.inside(x, z) && !blocked[I(x, z)] && !wet(I(x, z)))) {
      const x = Math.floor(px);
      const z = Math.floor(pz);
      if (thin(x, z) < 0.42) continue;
      treeAt[I(x, z)] = 1;
      treeList.push([x, z]);
    }
  }

  // --- The program's lots -------------------------------------------------------------------------------------------------
  const style = (role: Role) => styleFor(town, role);
  const wants: Want[] = [];
  let deepest = 0;
  const capital = form === "capital";
  const want = (id: string, role: Role | "arena", site?: string, optional = false) => {
    const sizes: readonly (readonly [number, number])[] = role === "arena" ? [[12, 8]] : sizesFor(style(role), role, capital);
    const w0 = Math.max(...sizes.map(([w]) => w));
    const d0 = Math.max(...sizes.map(([, d]) => d));
    const shadow = role === "arena" ? 1 : Math.max(...sizes.map(([w, d]) => shadowOf(style(role), role, w, d)));
    deepest = Math.max(deepest, d0);
    // A manor's lot is its walled garden: room beside it for the gate, and behind it for the garden.
    const garden = role === "manor" ? 6 : 0;
    wants.push({ id, role, w: w0 + (role === "inn" ? 3 : 1) + (site ? 2 : 0) + garden, d: d0, depth: d0 + 2 + garden, shadow, ...(site ? { site } : {}), ...(optional ? { optional } : {}) });
  };
  // A landmark's ground (the citadel, the keep, the manor): a lot of its own, built by the dressing (dress.ts).
  const landmarkWant = (req: (typeof input.sites)[number]): Want => {
    // The estate's manor at the head of a long avenue through its formal garden.
    const depth = req.id.endsWith("-manor") ? 31 : req.id.endsWith("-citadel") ? 22 : 15;
    return { id: req.id, role: "hall", w: req.w, d: depth - 2, depth, shadow: 14, site: req.id };
  };
  const landmarks = input.sites.filter((s) => s.where === "north").map(landmarkWant);
  const headNeed = R.head === "tower" ? input.needs.find((n) => n.role === "tower") : R.head === "landmark" ? undefined : input.needs.find((n) => n.role === "temple" || n.role === "shrine");
  if (headNeed) want(headNeed.id, headNeed.role as Role, headNeed.id);
  else if (R.head === "landmark" && landmarks[0]) wants.push(landmarks.shift()!);
  else {
    const n = input.needs.find((q) => q.role === "temple" || q.role === "shrine")!;
    want(n.id, n.role as Role, n.id);
  }
  const head = wants[0]!;
  const rank: Record<string, number> = { inn: 0, shop: 1, exotic: 1, guildhall: 2, library: 2, tower: 2, temple: 2, arena: 2.5, smithy: 4, home: 5, manor: 6 };
  for (const n of [...input.needs].filter((n) => n.id !== head.id).sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9))) want(n.id, n.role);
  const extra = village ? R.extra.village : R.extra.town;
  // The extra lots: houses, and every third a store - a barn in a village, a longhouse's shed in a hold, a warehouse in a
  // town by the water; the Academy keeps one for its physic garden.
  const third: Role = form === "village" || form === "estate" ? "barn" : "warehouse";
  for (let k = 0; k < extra; k++) want(`${town.id}-lot-${k + 1}`, k % 3 === 2 ? third : "house", undefined, true);
  if (R.garden === "physic" && !village) wants.push({ id: `${town.id}-physic-garden`, role: "house", w: 14, d: 8, depth: 12, shadow: 0, optional: true });

  // --- 2. The centre -------------------------------------------------------------------------------------------------------
  const [rx0, rz0] = village ? R.centre.village : R.centre.town;
  const rx = Math.max(5, Math.round(rx0 * (0.85 + 0.15 * input.shape.scale) + (random() - 0.5) * 2));
  const rz = Math.max(4, Math.round(rz0 * (0.85 + 0.15 * input.shape.scale) + (random() - 0.5) * 1.5));
  const rings = village ? R.rings.village : R.rings.town;
  const headWant = wants[0]!;
  // Room north of the centre for the rings: a lot, what it hides, the path behind; the first ring's lots are the deepest.
  const north = headWant.depth + 2 + (rings > 1 ? Math.max(...wants.map((w) => w.shadow)) + W + headWant.depth : 0);
  let best: { cx: number; cz: number; cost: number } | null = null;
  const height = input.height;
  const mainWay: Side = setting.ways.some((w) => w.side === "south") ? "south" : setting.ways[0]!.side;
  for (let cz = box.z0 + rz + Math.min(north, Math.floor((box.z1 - box.z0) / 2) - rz) ; cz <= box.z1 - rz - 6; cz++) {
    for (let cx = box.x0 + rx + 8; cx <= box.x1 - rx - 8; cx++) {
      let bad = false;
      let lo = Infinity;
      let hi = -Infinity;
      let trees = 0;
      for (let z = cz - rz - 2; z <= cz + rz + 2 && !bad; z++) {
        for (let x = cx - rx - 2; x <= cx + rx + 2 && !bad; x++) {
          if (!inEllipse(cx + 0.5, cz + 0.5, rx + 2, rz + 2, x, z)) continue;
          if (!g.inside(x, z)) {
            bad = true;
            break;
          }
          const i = I(x, z);
          if (blocked[i] || wet(i)) bad = true;
          if (treeAt[i]) trees++;
          const h = height(x, z);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      if (bad) continue;
      const mx = (box.x0 + box.x1) / 2;
      const mz = (box.z0 + box.z1) / 2;
      // Free ground north of it for the rings.
      let room = 0;
      for (let z = cz - rz - 1; z >= cz - rz - north && z > box.z0; z -= 2) for (let x = cx - rx; x <= cx + rx; x += 3) if (g.inside(x, z) && !blocked[I(x, z)] && !wet(I(x, z))) room++;
      // Toward the main way in, so the walk from its gate to the centre is short.
      const toMain = mainWay === "south" ? box.z1 - cz : mainWay === "north" ? cz - box.z0 : mainWay === "east" ? box.x1 - cx : cx - box.x0;
      const cost = Math.abs(cx - mx) * (mainWay === "east" || mainWay === "west" ? 0.4 : 0.8) + Math.abs(cz - mz - 4) * 0.3 + toMain * 0.25 + (hi - lo) * 4 + trees * 1.5 - room * 0.25 + random() * 0.5;
      if (!best || cost < best.cost) best = { cx, cz, cost };
    }
  }
  if (!best) throw new Error(`${town.id}: no ground for its centre`);
  const { cx, cz } = best;
  const centre: TownSquare = { x: cx - rx, z: cz - rz, w: 2 * rx + 1, d: 2 * rz + 1, ...(R.round ? { round: true } : {}), name: R.names?.[0] ?? "The square" };
  const centreTiles = new Uint8Array(g.size);
  for (const [x, z] of squareTiles(centre)) if (g.inside(x, z)) centreTiles[I(x, z)] = 1;
  const centreLevel = Math.max(1, Math.round(average(squareTiles(centre), (x, z) => height(x, z))));

  const net = new Net(g);
  const lots: (Lot & { want: Want })[] = [];
  const lotAt = new Int16Array(g.size);
  const shade = new Uint16Array(g.size);
  // --- The paths: a route from a tile to the centre or the network ------------------------------------------------------------
  const wander = noise(`${input.tag}:paths`, 6);
  function passable(x: number, z: number): boolean {
    // The middle line passes a tile where all its width paves free ground: no lot, nothing a building hides, no sea.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const zz = z + dz;
      if (!g.inside(xx, zz)) return false;
      const i = I(xx, zz);
      if (blocked[i] || lotAt[i] || shade[i]) return false;
    }
    return true;
  }
  function cost(x: number, z: number): number {
    const i = I(x, z);
    let c = 1 + wander(x, z) * 0.6;
    if (net.middle[i]) c *= 0.5;
    else if (net.paved[i]) c *= 0.75;
    if (wet(i)) c += 5;
    if (treeAt[i]) c += 2.5;
    const h = height(x, z);
    for (const [dx, dz] of N4) if (g.inside(x + dx, z + dz)) c += Math.abs(height(x + dx, z + dz) - h) * 1.5;
    return c;
  }
  function connect(from: XZ, to: "centre" | "net", main: boolean, own: readonly XZ[] = []): boolean {
    // Not back onto the path it starts from.
    const mine = new Set(own.map(([x, z]) => I(x, z)));
    const goal = (x: number, z: number) => (to === "net" && net.middle[I(x, z)]! > 0 && !mine.has(I(x, z))) || centreTiles[I(x, z)]! > 0;
    const r = route(g, { from: [from], goal, pass: (x, z) => passable(x, z) || (x === from[0] && z === from[1]), cost, turn: 0.5, limit: 120 });
    if (!r || r.length < 2) return false;
    const tiles = pull(r, (x, z) => passable(x, z), cost);
    net.add(tiles, W, main, R.planks ? "planks" : main ? "street" : "path");
    return true;
  }

  // --- 3. The rings ----------------------------------------------------------------------------------------------------------
  /** Whether a lot (and the strip before it, and what it hides) may stand: x0..x1, its door row z1. */
  const fits = (wt: Want, x0: number, x1: number, z1: number): boolean => {
    const z0 = z1 - wt.depth;
    for (let z = z0 - 1; z < z1 + W; z++) {
      for (let x = x0 - 1; x <= x1; x++) {
        if (!g.inside(x, z)) return false;
        const i = I(x, z);
        if (z < z1 && x >= x0 && x < x1) {
          if (blocked[i] || wet(i) || centreTiles[i] || net.paved[i] || lotAt[i]) return false;
        } else if (z >= z1) {
          // The strip before it: free of other lots and of what they hide.
          if (x >= x0 && x < x1 && (blocked[i] || wet(i) || lotAt[i] || shade[i])) return false;
        } else if (lotAt[i]) return false;
      }
    }
    // What its building hides must be no way nor the centre.
    for (let z = z1 - wt.d - wt.shadow; z < z1 - 1; z++) for (let x = x0; x < x1; x++) if (g.inside(x, z) && (net.paved[I(x, z)] || centreTiles[I(x, z)])) return false;
    return true;
  };
  const place = (wt: Want, x0: number, x1: number, z1: number, ringNo: number) => {
    const lot = { x0, z0: z1 - wt.depth, x1, z1, ring: ringNo, want: wt, ...(wt.site ? { site: wt.site } : {}) };
    lots.push(lot);
    for (let z = lot.z0; z < z1; z++) for (let x = x0; x < x1; x++) lotAt[I(x, z)] = lots.length;
    for (let z = z1 - wt.d - wt.shadow; z < z1 - wt.d; z++) for (let x = x0; x < x1; x++) if (g.inside(x, z)) shade[I(x, z)]!++;
    return lot;
  };
  /** Takes back the lot last placed. */
  const unplace = (lot: Lot & { want: Want }) => {
    lots.splice(lots.indexOf(lot), 1);
    for (let z = lot.z0; z < lot.z1; z++) for (let x = lot.x0; x < lot.x1; x++) lotAt[I(x, z)] = 0;
    for (let z = lot.z1 - lot.want.d - lot.want.shadow; z < lot.z1 - lot.want.d; z++) for (let x = lot.x0; x < lot.x1; x++) if (g.inside(x, z)) shade[I(x, z)]!--;
  };
  const queue = [...wants.slice(1)];
  /** A centre the town's arcs stand round: the main one, or a lesser square, quad or platform. */
  interface Centre {
    readonly cx: number;
    readonly cz: number;
    readonly rx: number;
    readonly rz: number;
    readonly square: TownSquare;
    readonly level: number;
  }
  const topIn = (c: Centre, x: number): number | null => {
    for (let z = c.square.z; z < c.square.z + c.square.d; z++) if (g.inside(x, z) && inSquare(c.square, x, z)) return z;
    return null;
  };
  /** Each lot's ring, its centre's level, for the terraces. */
  const lotLevel = new Map<Lot, number>();
  const ringLots: (Lot & { want: Want })[][] = [];
  /**
   * Arcs round a centre: `rings` of them, the first just outside it, each next behind what the one before hides; the
   * first's head on the axis (or off it by `offset`), a landmark at the head of ring `landmarkRing`; the rest outward to
   * east and west in turn, each front a step below the one inside it. A path along each arc's fronts jogs down between
   * them, a spoke from each jog down to the centre (or the arc inside it).
   */
  function arcsAround(c: Centre, rings: number, headW: Want | null, offset: number, landmark: Want | null, landmarkRing: number, ringBase: number, westFirst = false): void {
    const { cx: ax, cz: az, rx: arx, rz: arz } = c;
    const mine: (Lot & { want: Want })[][] = [];
    for (let r = 1; r <= rings; r++) {
      const these: (Lot & { want: Want })[] = [];
      const prev = mine[r - 2] ?? [];
      const depthBehind = (headW ?? queue[0] ?? head).depth + (headW ?? queue[0] ?? head).shadow + W;
      const Rx = r === 1 ? arx + 1 : arx + 1 + 10 * (r - 1);
      const Rz = r === 1 ? arz + 1 : arz + 1 + depthBehind * (r - 1);
      const frontAt = (m: number) => Math.round(az - Rz * Math.sqrt(Math.max(0, 1 - ((m - ax) / Rx) ** 2)));
      const frontOf = (x0: number, x1: number): number => {
        const inner = x1 <= ax ? x1 - 1 : x0 >= ax ? x0 : ax;
        let z1 = frontAt(inner);
        if (r === 1) {
          let top = Infinity;
          for (let x = x0; x < x1; x++) {
            const t = topIn(c, x);
            if (t !== null) top = Math.min(top, t);
          }
          if (Number.isFinite(top)) z1 = c.square.round ? Math.min(z1, top - 1) : top;
        }
        for (const p of prev) if (p.x0 < x1 + 1 && p.x1 > x0 - 1) z1 = Math.min(z1, p.z1 - p.want.d - p.want.shadow - W);
        return z1;
      };
      // The head of this ring: the centre's own (the first), or the landmark.
      const crown = r === 1 ? headW : r === landmarkRing ? landmark : null;
      if (crown) {
        const want0 = Math.round(ax + offset * arx - crown.w / 2);
        let done = false;
        for (const shift of [0, 2, -2, 4, -4, 6, -6, 9, -9]) {
          const x0 = want0 + shift;
          const z1 = frontOf(x0, x0 + crown.w);
          if (!fits(crown, x0, x0 + crown.w, z1)) continue;
          const lot = place(crown, x0, x0 + crown.w, z1, ringBase + r);
          lotLevel.set(lot, c.level + (R.terraced ? r - 1 : 0) + (crown === landmark && R.terraced ? 1 : 0));
          these.push(lot);
          done = true;
          break;
        }
        if (!done && r === 1 && ringBase === 0) throw new Error(`${town.id}: no room at the head of ${c.square.name ?? "its centre"}`);
      }
      // Behind the first ring's head nothing stands but its own grounds (the temple's close, the hall's yard): the arcs
      // behind it start beside it, so no place hides behind another the long way round.
      const firstHead = r > 1 ? mine[0]?.find((l) => l.want === headW) : undefined;
      let east = these[0] ? these[0].x1 + GAP : firstHead ? firstHead.x1 + GAP : ax + 1;
      let west = these[0] ? these[0].x0 - GAP : firstHead ? firstHead.x0 - GAP : ax - 1;
      let eastDone = false;
      let westDone = false;
      let lastEast = these[0] ? these[0].z1 : -Infinity;
      let lastWest = lastEast;
      for (let side = 0; queue.length > 0 && !(eastDone && westDone); side++) {
        const toEast = ((side % 2 === (westFirst ? 1 : 0)) && !eastDone) || westDone;
        const wt = queue[0]!;
        let placed = false;
        for (let shift = 0; shift <= 6 && !placed; shift += 2) {
          const x0 = toEast ? east + shift : west - shift - wt.w;
          const x1 = x0 + wt.w;
          const inner = toEast ? x0 : x1 - 1;
          if (Math.abs(inner - ax) > Rx + 14 || x0 < box.x0 + 2 || x1 > box.x1 - 2) break;
          let z1 = frontOf(x0, x1);
          // Fronts step down as the arc runs out, never back up, never in line with the one inside - but along a square's
          // straight north side (a market square, a quad) they close it, in line.
          const onSide = r === 1 && !c.square.round && x0 < c.square.x + c.square.w && x1 > c.square.x;
          z1 = Math.max(z1, (toEast ? lastEast : lastWest) + (onSide ? 0 : 1));
          if (z1 > az + 2) break;
          if (!fits(wt, x0, x1, z1)) continue;
          const lot = place(wt, x0, x1, z1, ringBase + r);
          lotLevel.set(lot, c.level + (R.terraced ? r - 1 : 0));
          these.push(lot);
          queue.shift();
          if (toEast) {
            east = x1 + GAP;
            lastEast = z1;
          } else {
            west = x0 - GAP;
            lastWest = z1;
          }
          placed = true;
        }
        if (!placed) {
          if (toEast) eastDone = true;
          else westDone = true;
        }
      }
      these.sort((a, b) => a.x0 - b.x0);
      mine.push(these);
      ringLots.push(these);
      if (these.length === 0) continue;
      const mid = (l: Lot) => l.z1 + 1;
      // Its ends at the outer lots' outer corners, each a spoke's start.
      const first = these[0]!;
      const pts: XZ[] = [[first.x0 - 2, mid(first)]];
      const jogs: XZ[] = [];
      for (let k = 0; k + 1 < these.length; k++) {
        const a = these[k]!;
        const b = these[k + 1]!;
        const j = Math.floor((a.x1 + b.x0 - 1) / 2);
        pts.push([j, mid(a)], [j, mid(b)]);
        jogs.push([j, Math.max(mid(a), mid(b))]);
      }
      const last = these[these.length - 1]!;
      pts.push([last.x1 + 1, mid(last)]);
      const line = chain(pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1]![0] || p[1] !== pts[k - 1]![1]));
      if (line.length >= 2) net.add(line, W, r === 1 && ringBase === 0, R.planks ? "planks" : r === 1 ? "street" : "path");
      const own = line.length >= 2 ? line : [];
      const spokeEnds: XZ[] = [...jogs, pts[0]!, pts[pts.length - 1]!];
      for (const [jx, jz] of spokeEnds) {
        if (connect([jx, jz], r === 1 ? "centre" : "net", false, own) || connect([jx, jz], "net", false, own)) continue;
        // An outer end with no spoke down from it ends at its lot's door instead (no path running on past it).
        const lot = jx < ax ? first : last;
        const mx = Math.floor((lot.x0 + lot.x1) / 2);
        if ((jx === pts[0]![0] && jz === pts[0]![1]) || (jx === pts[pts.length - 1]![0] && jz === pts[pts.length - 1]![1])) net.cutBack(jx, jz, ([x]) => Math.abs(x - mx) <= 1);
      }
    }
  }
  const main: Centre = { cx, cz, rx, rz, square: centre, level: centreLevel };
  const landmark = landmarks.shift() ?? null;
  // What a quarter of its own will hold (the manors in their close, the smithy at the head of its yard) waits for it.
  const quarterList0 = R.quarters ? (village ? R.quarters.village : R.quarters.town) : [];
  const reserved = queue.filter((w) => quarterList0.some((q) => (q.fill === "manor" && w.role === "manor") || (q.kind === "yard" && (q.head ?? []).includes(w.role))));
  for (const w of reserved) queue.splice(queue.indexOf(w), 1);
  // The inn is first of the rest, beside the head on the side of the main way in; where that leaves it too far from the
  // main gate, the later tries (index.ts, `deep` for a grown town) have it wait for the roads in and grow by the main way,
  // between the gate and the centre.
  const innWant: Want | null = input.deep ? (queue.find((w) => w.role === "inn") ?? null) : null;
  if (innWant) queue.splice(queue.indexOf(innWant), 1);
  arcsAround(main, rings, head, R.headOffset ?? 0, landmark, R.landmarkRing ?? 0, 0, mainWay === "west");
  queue.unshift(...reserved);
  // A landmark no ring took stands where it may: at the north, on the axis as near as it can.
  if (landmark && !lots.some((l) => l.want === landmark)) {
    let best2: { x0: number; z1: number; s: number } | null = null;
    for (let z1 = box.z0 + landmark.depth + 2; z1 < cz - rz - 2; z1++) for (let x0 = box.x0 + 2; x0 + landmark.w <= box.x1 - 2; x0++) {
      if (!fits(landmark, x0, x0 + landmark.w, z1)) continue;
      const s = Math.abs(x0 + landmark.w / 2 - cx) + (z1 - box.z0) * 0.5;
      if (!best2 || s < best2.s) best2 = { x0, z1, s };
    }
    if (!best2) throw new Error(`${town.id}: no room for ${landmark.id}`);
    const lot = place(landmark, best2.x0, best2.x0 + landmark.w, best2.z1, rings + 1);
    lotLevel.set(lot, centreLevel + (R.terraced ? rings : 0));
    const m = best2.z1 + 1;
    const strip = chain([[best2.x0 + 1, m], [best2.x0 + landmark.w - 2, m]]);
    net.add(strip, W, true, "street");
    if (!connect([Math.floor(best2.x0 + landmark.w / 2), m], "net", false, strip)) throw new Error(`${town.id}: no way to ${landmark.id}`);
  }
  // The lesser centres: each where the ground is free and level a little way from the main one, an arc of its own round it
  // headed by the next of the town's great places, and a way to the rest.
  const quads: Centre[] = [];
  /** Each lesser centre's quarter, by its index in `quads` (the stilts' knots have none). */
  const quarterOf: Quarter[] = [];
  const quarterList = R.quarters ? (village ? R.quarters.village : R.quarters.town) : [];
  // A quarter by a gate: by the first way in that is not the main one (else the main one), inside the town's edge beside
  // where its road comes in, so the road passes its open side.
  const wayIn = (): XZ => {
    const sides = setting.ways.map((w) => w.side);
    const side = sides.find((s) => s !== mainWay && (s === "east" || s === "west")) ?? sides.find((s) => s !== mainWay) ?? mainWay;
    const inset = 24;
    return side === "east" ? [box.x1 - inset, cz + Math.round(rz / 2) - 6] : side === "west" ? [box.x0 + inset, cz + Math.round(rz / 2) - 6] : side === "north" ? [cx + 18, box.z0 + inset + 8] : [cx + 18, box.z1 - inset];
  };
  for (const [q, spec] of quarterList.entries()) {
    const [qrx, qrz] = spec.size;
    const behind = spec.fill === "manor" ? 16 : 8;
    const target = spec.where === "gate" ? wayIn() : null;
    let bestQ: { x: number; z: number; s: number } | null = null;
    for (let z = box.z0 + qrz + behind + 2; z <= box.z1 - qrz - 4; z++) {
      for (let x = box.x0 + qrx + 4; x <= box.x1 - qrx - 4; x++) {
        const d = Math.hypot(x - cx, (z - cz) * 1.3);
        if (d < rx + qrx + 8 || (!target && d > rx + qrx + 34 + (spec.where === "high" ? 30 : 0))) continue;
        let ok = true;
        for (let zz = z - qrz - behind; zz <= z + qrz + 2 && ok; zz++) for (let xx = x - qrx - 2; xx <= x + qrx + 2 && ok; xx++) {
          if (!g.inside(xx, zz)) ok = false;
          else {
            const i = I(xx, zz);
            ok = !blocked[i] && !wet(i) && !lotAt[i] && !net.paved[i] && !centreTiles[i] && !shade[i];
          }
        }
        if (!ok) continue;
        const apart = quads.reduce((t, o) => t + Math.max(0, 30 - Math.hypot(o.cx - x, o.cz - z)), 0);
        const where = target ? Math.hypot(x - target[0], z - target[1]) * 2 : spec.where === "high" ? -height(x, z) * 8 + Math.abs(d - (rx + qrx + 30)) * 0.3 : Math.abs(d - (rx + qrx + 14)) + Math.abs(z - cz) * 0.4;
        const s = where + apart + random();
        if (!bestQ || s < bestQ.s) bestQ = { x, z, s };
      }
    }
    if (process.env.TOWN_DEBUG === "quads") console.log(`quad ${q} ${spec.name}: ${bestQ ? `${bestQ.x},${bestQ.z}` : "none"}; queue ${queue.length}; centre ${cx},${cz} r ${rx},${rz} box ${box.x0},${box.z0}-${box.x1},${box.z1}`);
    if (!bestQ) continue;
    quarterOf[quads.length] = spec;
    const sq: TownSquare = { x: bestQ.x - qrx, z: bestQ.z - qrz, w: 2 * qrx + 1, d: 2 * qrz + 1, name: spec.name };
    const k = quads.length;
    for (const [x, z] of squareTiles(sq)) if (g.inside(x, z)) centreTiles[I(x, z)] = 2 + k;
    const lv = Math.max(centreLevel - 1, Math.min(centreLevel + 1, Math.round(height(bestQ.x, bestQ.z))));
    const c: Centre = { cx: bestQ.x, cz: bestQ.z, rx: qrx, rz: qrz, square: sq, level: lv };
    quads.push(c);
    // Its way to the rest: from the middle of its south edge to the network or the main centre.
    const from: XZ = [bestQ.x, sq.z + sq.d - 1];
    const r = route(g, { from: [from], goal: (x, z) => net.middle[I(x, z)]! > 0 || centreTiles[I(x, z)] === 1, pass: (x, z) => passable(x, z) || centreTiles[I(x, z)] === 2 + k, cost, turn: 0.5, limit: 200 });
    if (!r) throw new Error(`${town.id}: no way to its ${sq.name}`);
    net.add(pull(r, (x, z) => passable(x, z), cost), W, false, R.planks ? "planks" : "street");
    // And a second from its side toward the main centre, so the two are near by more than one way.
    {
      const side: XZ = bestQ.x < cx ? [sq.x + sq.w - 1, bestQ.z] : [sq.x, bestQ.z];
      const r2 = route(g, { from: [side], goal: (x, z) => centreTiles[I(x, z)] === 1 || (net.middle[I(x, z)]! > 0 && !inSquare(sq, x, z)), pass: (x, z) => passable(x, z) || centreTiles[I(x, z)] === 2 + k, cost, turn: 0.5, limit: 120 });
      if (r2 && r2.length >= 2) net.add(pull(r2, (x, z) => passable(x, z), cost), W, false, R.planks ? "planks" : "street");
    }
    // Its head: the first still waiting of the roles it wants (the library, the guild; a manor; the smithy), or none.
    let headQ: Want | null = null;
    for (const role of spec.head ?? []) {
      const at = queue.findIndex((w) => w.role === role);
      if (at >= 0) {
        headQ = queue.splice(at, 1)[0]!;
        break;
      }
    }
    if (spec.head && !headQ && spec.fill === "queue") headQ = queue.shift() ?? null;
    // What its arcs hold: the queue as it stands, or only the manors, or so many of the extra lots.
    const take = spec.fill === "manor" ? queue.filter((w) => w.role === "manor") : spec.fill === "extra" ? queue.filter((w) => w.optional).slice(0, spec.count ?? 6) : null;
    if (take) {
      const rest = queue.filter((w) => !take.includes(w));
      queue.length = 0;
      queue.push(...take);
      arcsAround(c, spec.rings, headQ, 0, null, 0, 10 * (k + 1));
      const left = [...queue];
      queue.length = 0;
      queue.push(...rest.filter((w) => !w.optional), ...left.filter((w) => !w.optional), ...rest.filter((w) => w.optional), ...left.filter((w) => w.optional));
    } else arcsAround(c, spec.rings, headQ, 0, null, 0, 10 * (k + 1));
    if (headQ && !lots.some((l) => l.want === headQ)) queue.unshift(headQ);
  }

  // --- 5. The roads in: before what grows, so nothing grows across them -----------------------------------------------------------
  // A clan hold's palisade is an oval round its rings (room left in it for what grows); its gates are where the roads
  // cross it. The other towns' roads run in from the edge of the ground they may grow over, the town reaching out
  // along them to it.
  let oval: Uint8Array | null = null;
  if (R.outline === "oval") {
    // About the middle of what stands (its lots, the yard), circumscribing it with room for what grows, within the
    // ground it may grow over.
    let bx0 = Infinity;
    let bz0 = Infinity;
    let bx1 = -Infinity;
    let bz1 = -Infinity;
    for (let i = 0; i < g.size; i++) {
      if (!lotAt[i] && !centreTiles[i]) continue;
      bx0 = Math.min(bx0, g.x(i));
      bx1 = Math.max(bx1, g.x(i) + 1);
      bz0 = Math.min(bz0, g.z(i));
      bz1 = Math.max(bz1, g.z(i) + 1);
    }
    const room = village ? 2 : 1.8;
    const half = (box.x1 - box.x0) / 2 - 1.5;
    const halfZ = (box.z1 - box.z0) / 2 - 1.5;
    // An oval a little bigger than the ground it may grow over is shaved straight only where it meets that ground's edge.
    const ox = Math.max(Math.min(half * 1.12, ((bx1 - bx0) / 2) * room), half * 0.95);
    const oz = Math.max(Math.min(halfZ * 1.12, ((bz1 - bz0) / 2) * room), halfZ * 0.95);
    const ocx = (box.x0 + box.x1) / 2;
    const ocz = (box.z0 + box.z1) / 2;
    oval = new Uint8Array(g.size);
    for (let i = 0; i < g.size; i++) {
      const x = g.x(i);
      const z = g.z(i);
      if (inEllipse(ocx, ocz, ox, oz, x, z) && !nearSea[i] && x > box.x0 && z > box.z0 && x < box.x1 - 1 && z < box.z1 - 1) oval[i] = 1;
    }
    // What already stands is inside it.
    for (let i = 0; i < g.size; i++) if (lotAt[i] || centreTiles[i] || net.paved[i]) oval[i] = 1;
  } else if (R.designed) {
    // A designed wall: the ground the town may grow over, stepped in at each corner (as deep a step as leaves what stands
    // outside it) and in along a stretch of each side - straight curtains between the corners, a tower at each. The town
    // grows to fill it.
    oval = new Uint8Array(g.size);
    const stands = (x: number, z: number) => g.inside(x, z) && (lotAt[I(x, z)]! > 0 || centreTiles[I(x, z)]! > 0 || net.paved[I(x, z)]! > 0);
    const clearOf = (ax: number, az: number, bx: number, bz: number) => {
      for (let z = Math.min(az, bz); z <= Math.max(az, bz); z++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) if (stands(x, z)) return false;
      return true;
    };
    const X0 = box.x0 + 1;
    const Z0 = box.z0 + 1;
    const X1 = box.x1 - 2;
    const Z1 = box.z1 - 2;
    const cuts: Box[] = [];
    for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const sizes = [[30, 22], [24, 18], [18, 14], [12, 9], [7, 5]].map(([w, d]) => [w! + Math.floor(random() * 6), d! + Math.floor(random() * 4)] as const);
      for (const [w, d] of sizes) {
        const ax = sx ? X1 - w + 1 : X0;
        const az = sz ? Z1 - d + 1 : Z0;
        if (!clearOf(ax - 2, az - 2, ax + w + 1, az + d + 1)) continue;
        cuts.push({ x0: ax, z0: az, x1: ax + w, z1: az + d });
        break;
      }
    }
    // A stretch of each side set in by a few tiles, where nothing stands there.
    for (const side of ["north", "south", "east", "west"] as const) {
      const along = side === "north" || side === "south";
      const len = Math.floor(((along ? X1 - X0 : Z1 - Z0) * (0.22 + random() * 0.12)));
      const at = Math.floor((along ? X0 : Z0) + (along ? X1 - X0 : Z1 - Z0) * (0.3 + random() * 0.4) - len / 2);
      const depth = 4 + Math.floor(random() * 3);
      const b: Box = side === "north" ? { x0: at, z0: Z0, x1: at + len, z1: Z0 + depth } : side === "south" ? { x0: at, z0: Z1 - depth + 1, x1: at + len, z1: Z1 + 1 } : side === "west" ? { x0: X0, z0: at, x1: X0 + depth, z1: at + len } : { x0: X1 - depth + 1, z0: at, x1: X1 + 1, z1: at + len };
      if (clearOf(b.x0 - 2, b.z0 - 2, b.x1 + 1, b.z1 + 1)) cuts.push(b);
    }
    for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
      if (cuts.some((c) => x >= c.x0 && x < c.x1 && z >= c.z0 && z < c.z1)) continue;
      if (!nearSea[I(x, z)]) oval[I(x, z)] = 1;
    }
    for (let i = 0; i < g.size; i++) if (lotAt[i] || centreTiles[i] || net.paved[i]) oval[i] = 1;
  }
  // A quay along the water south of the town: its river's north bank, or the shore - a street the length of the town,
  // its warehouses fronting it (growth puts them there), a way up from it to the centre.
  const quayTiles: XZ[] = [];
  if (R.quay) {
    const runs: XZ[][] = [];
    let run: XZ[] = [];
    for (let x = box.x0 + 2; x < box.x1 - 2; x++) {
      let zw = -1;
      for (let z = cz + rz + 4; z < box.z1 && zw < 0; z++) if (wet(I(x, z)) || nearSea[I(x, z)]) zw = z;
      const zq = zw - 2;
      const ok = zw > 0 && [zq - 1, zq, zq + 1].every((z) => g.inside(x, z) && (!oval || oval[I(x, z)] === 1) && !blocked[I(x, z)] && !lotAt[I(x, z)] && !shade[I(x, z)] && !wet(I(x, z)) && !centreTiles[I(x, z)]);
      if (ok && (run.length === 0 || Math.abs(run[run.length - 1]![1] - zq) <= 3)) run.push([x, zq]);
      else {
        if (run.length) runs.push(run);
        run = ok ? [[x, zq]] : [];
      }
    }
    if (run.length) runs.push(run);
    const best = runs.sort((a, b) => b.length - a.length)[0];
    if (best && best.length >= 16) {
      const line = chain(best);
      // In stretches between the ways it crosses, each joined to them there.
      let from = 0;
      for (let k = 1; k < line.length; k++) {
        const crossing = net.middle[I(line[k]![0], line[k]![1])]! > 0;
        if (!crossing && k < line.length - 1) continue;
        const part = line.slice(from, k + 1);
        if (part.length >= 2 && !part.slice(1, -1).some(([x, z]) => net.middle[I(x, z)]! > 0)) net.add(part, W, true, "street");
        from = k;
      }
      quayTiles.push(...line);
      const mid = line[Math.floor(line.length / 2)]!;
      if (!connect(mid, "centre", true, line)) connect(mid, "net", true, line);
    }
  }
  /** Walks along the ways laid so far (and over the centre) from some tiles. */
  const alongWays = (from: readonly XZ[]): Float32Array => {
    const d = new Float32Array(g.size).fill(Infinity);
    const q: number[] = [];
    for (const [x, z] of from) if (g.inside(x, z)) {
      d[I(x, z)] = 0;
      q.push(I(x, z));
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!;
      for (const [dx, dz] of N4) {
        const x = g.x(i) + dx;
        const z = g.z(i) + dz;
        if (!g.inside(x, z)) continue;
        const j = I(x, z);
        if (!(net.paved[j] || centreTiles[j] === 1) || d[j]! <= d[i]! + 1) continue;
        d[j] = d[i]! + 1;
        q.push(j);
      }
    }
    return d;
  };
  const gates: Gate[] = [];
  const gateNodes: XZ[] = [];
  const gatePaths: XZ[][] = [];
  const sides = setting.ways.map((w) => w.side);
  const mainSide: Side = sides.includes("south") ? "south" : sides[0]!;
  const usedLateral = new Map<Side, number[]>();
  const free = (x: number, z: number) => g.inside(x, z) && !seaTile[I(x, z)] && !lotAt[I(x, z)] && !shade[I(x, z)];
  setting.ways.forEach((way, index) => {
    const side = way.side;
    const [dx, dz] = STEP[side];
    const along = side === "north" || side === "south";
    const base = along ? cx : cz + Math.round(rz / 2);
    const taken = usedLateral.get(side) ?? [];
    const toCentre = alongWays(squareTiles(centre).filter(([px, pz]) => g.inside(px, pz)));
    for (const off of [...Array(81).keys()].map((k) => (k % 2 === 0 ? k / 2 : -(k + 1) / 2))) {
      const u = base + off;
      if (taken.some((t) => Math.abs(t - u) < 8)) continue;
      // The ring tile T the road crosses: on the oval out from the centre, or on the edge of the ground the town grows over.
      let x: number;
      let z: number;
      if (oval) {
        x = along ? u : cx;
        z = along ? cz : u;
        if (!g.inside(x, z)) continue;
        for (let steps = 0; g.inside(x, z) && oval[I(x, z)] && steps < 200; steps++) {
          x += dx;
          z += dz;
        }
      } else {
        x = along ? u : side === "west" ? box.x0 : box.x1 - 1;
        z = along ? (side === "north" ? box.z0 : box.z1 - 1) : u;
      }
      if (!g.inside(x + 3 * dx, z + 3 * dz) || !g.inside(x - 5 * dx, z - 5 * dz)) continue;
      // T and three past it the road's, the four within it the gate's straight stretch: none of it sea, a lot or what one hides.
      let ok = true;
      for (let s = -4; s <= 3 && ok; s++) for (let q = -1; q <= 1 && ok; q++) {
        const [px, pz] = along ? [x + s * dx + q, z + s * dz] : [x + s * dx, z + s * dz + q];
        if (!free(px, pz) || (s >= 0 && q === 0 && oval && oval[I(px, pz)])) ok = false;
      }
      if (!ok) continue;
      const inner: XZ = [x - 5 * dx, z - 5 * dz];
      const inTown = (px: number, pz: number) => !oval || oval[I(px, pz)] === 1;
      // Each road in runs to the centre, or joins a way that leads straight on to it (not one that goes the long way round).
      const direct = (px: number, pz: number) => toCentre[I(px, pz)]! <= Math.max(10, Math.hypot(px - cx, pz - cz) * 1.35);
      const passIn = (px: number, pz: number) => (passable(px, pz) && inTown(px, pz)) || (px === inner[0] && pz === inner[1]);
      // Where no way that leads straight on can be reached, the nearest way.
      const r = route(g, { from: [inner], goal: (px, pz) => centreTiles[I(px, pz)] === 1 || (net.middle[I(px, pz)]! > 0 && direct(px, pz)), pass: passIn, cost, turn: 0.5, limit: 140 }) ?? route(g, { from: [inner], goal: (px, pz) => centreTiles[I(px, pz)] === 1 || net.middle[I(px, pz)]! > 0, pass: passIn, cost, turn: 0.5, limit: 260 });
      if (!r) {
        continue;
      }
      const stub: XZ[] = [];
      for (let s = 3; s >= -4; s--) stub.push([x + s * dx, z + s * dz]);
      const tiles = chain([...stub, ...pull(r, (px, pz) => passable(px, pz) && inTown(px, pz), cost)]);
      net.add(tiles, W, true, R.planks ? "planks" : "street");
      gatePaths.push(tiles);
      taken.push(u);
      usedLateral.set(side, taken);
      const passage: Box = along ? { x0: x - 1, z0: z, x1: x + 2, z1: z + 1 } : { x0: x, z0: z - 1, x1: x + 1, z1: z + 2 };
      const node: XZ = [x + 3 * dx, z + 3 * dz];
      gates.push({ side, way: index, main: side === mainSide && !gates.some((gg) => gg.main), passage, node, inner, width: W });
      gateNodes.push(node);
      return;
    }
    if (process.env.TOWN_DEBUG) return;
    throw new Error(`${town.id}: no way in from the ${side}`);
  });
  if (gates.length > 0 && !gates.some((gg) => gg.main)) gates[0] = { ...gates[0]!, main: true };
  // Bridges from the quay over the river, besides the roads': straight across where the river runs narrow enough, each
  // well apart from the others and from a road's, a way on from its far end to the rest.
  if (R.bridges && quayTiles.length > 0) {
    const crossings: number[] = [];
    for (let i = 0; i < g.size; i++) if (wet(i) && net.middle[i]) crossings.push(g.x(i));
    const byX = new Map(quayTiles.map(([x, z]) => [x, z] as const));
    const want = [cx - 34, cx + 34, cx - 58, cx + 58];
    let made = 0;
    for (const tx of want) {
      if (made >= R.bridges) break;
      for (const dx of [0, 3, -3, 6, -6, 9, -9]) {
        const x = tx + dx;
        const zq = byX.get(x);
        if (zq === undefined || crossings.some((c) => Math.abs(c - x) < 16)) continue;
        // Down from the quay, over the water, to dry ground three past it.
        let z = zq + 1;
        while (g.inside(x, z) && !wet(I(x, z))) z++;
        const wetFrom = z;
        while (g.inside(x, z) && wet(I(x, z))) z++;
        const end = z + 3;
        if (z - wetFrom > 9 || z === wetFrom) continue;
        let ok = true;
        for (let zz = zq + 2; zz <= end + 1 && ok; zz++) for (const xx of [x - 1, x, x + 1]) if (!g.inside(xx, zz) || (oval && !oval[I(xx, zz)]) || blocked[I(xx, zz)] || lotAt[I(xx, zz)] || shade[I(xx, zz)] || (net.paved[I(xx, zz)] && zz > z)) ok = false;
        if (!ok) continue;
        // On from its far end along the bank to the nearest way there (never back over the water).
        const on = route(g, { from: [[x, end]], goal: (px, pz) => net.middle[I(px, pz)]! > 0 && pz > z - 1, pass: (px, pz) => (passable(px, pz) && !wet(I(px, pz)) && (!oval || oval[I(px, pz)] === 1)) || (px === x && pz === end), cost, turn: 0.5, limit: 140 });
        if (!on || on.length < 2) continue;
        const span = chain([[x, zq], [x, end]]);
        net.add(span, W, true, "street");
        net.add(pull(on, (px, pz) => passable(px, pz) && !wet(I(px, pz)), cost), W, false, "street");
        crossings.push(x);
        made++;
        break;
      }
    }
  }
  // A clan's: nothing past its palisade.
  if (oval) for (let i = 0; i < g.size; i++) if (!oval[i]) blocked[i] = 1;


  // --- 4. Growth: what the rings could not hold, grown outward from the paths ----------------------------------------------------
  if (innWant) queue.unshift(innWant);
  const mainInner = (gates.find((gg) => gg.main) ?? gates[0])?.inner ?? null;
  // The main way in's stretch near the centre: the inn stands by it, so its walk from the gate is the way's own.
  const mainPath = (gatePaths[Math.max(0, gates.findIndex((gg) => gg.main))] ?? []).filter(([x, z]) => Math.hypot(x - cx, z - cz) < (village ? 22 : town.kind === "capital" ? 34 : 28));
  const byMainWay = (x: number, z: number) => (mainPath.length ? Math.min(...mainPath.map(([px, pz]) => Math.abs(px - x) + Math.abs(pz - z))) : 0);
  for (const wt of [...queue]) {
    // How far each tile is from a way (or the centre), walking where a path could run: a lot's door must be near one.
    const reach = new Float64Array(g.size).fill(Infinity);
    const frontier: number[] = [];
    for (let i = 0; i < g.size; i++) if (net.middle[i] || centreTiles[i]) {
      reach[i] = 0;
      frontier.push(i);
    }
    for (let h = 0; h < frontier.length; h++) {
      const i = frontier[h]!;
      for (const [dx, dz] of N4) {
        const x = g.x(i) + dx;
        const z = g.z(i) + dz;
        if (!g.inside(x, z) || !passable(x, z) || (wet(I(x, z)) && !net.paved[I(x, z)])) continue;
        const j = I(x, z);
        if (reach[j]! <= reach[i]! + 1) continue;
        reach[j] = reach[i]! + 1;
        frontier.push(j);
      }
    }
    const candidates: { x0: number; z1: number; score: number }[] = [];
    const innWalks = wt.role === "inn" && mainInner ? { gate: alongWays([mainInner]), square: alongWays(squareTiles(centre).filter(([x, z]) => g.inside(x, z))) } : null;
    for (let z1 = box.z0 + wt.depth + 2; z1 < box.z1 - W - 2; z1++) {
      for (let x0 = box.x0 + 2; x0 + wt.w <= box.x1 - 2; x0++) {
        const c = Math.floor(x0 + wt.w / 2);
        const near = reach[I(c, z1 + 1)]!;
        if (near > 30) continue;
        // Nothing closes the centre's south side: it opens toward the way in.
        if (x0 < centre.x + centre.w + 2 && x0 + wt.w > centre.x - 2 && z1 > cz && z1 - wt.depth < centre.z + centre.d + 6) continue;
        if (!fits(wt, x0, x0 + wt.w, z1)) continue;
        // Near the centre and the ways, north of the centre rather than south, a store or a shed by the shore.
        const d = Math.hypot(x0 + wt.w / 2 - cx, z1 - cz);
        let shore = false;
        for (let k = 0; k < wt.w && !shore; k++) for (let s = 3; s < 9 && !shore; s++) if (g.inside(x0 + k, z1 + s) && (seaTile[I(x0 + k, z1 + s)] || wet(I(x0 + k, z1 + s)))) shore = true;
        // Fronts step: one in line with another's is worth less.
        const inLine = lots.filter((l) => l.z1 === z1).length;
        // In a town of arcs, on the next arc out: the amphitheatre holds what grows (an elfhame's, a clan's, a village's).
        const arcR = Math.hypot((x0 + wt.w / 2 - cx) / (rx + 14), (z1 - cz) / (rz + 12));
        const onArc = R.round ? Math.abs(arcR - 1) * 14 + (z1 > cz + 2 ? 8 : 0) : 0;
        // The inn by the main gate's way and within a short walk of the square (dearly past it); the town's other places
        // near the centre; the rest where they fill the town (in a designed wall, distance from the centre counts for
        // little).
        const innReach = village ? 20 : town.kind === "capital" ? 30 : 26;
        let lean = d * (wt.optional ? (R.round ? 0.3 : R.designed ? 0.25 : 0.6) : 1);
        if (wt.role === "inn" && innWalks) {
          // Its door by a way: the walk to it from the main gate as short as may be, and on from it to the square short.
          let wg = Infinity;
          let ws = Infinity;
          for (let dz = -2; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
            const x = c + dx;
            const z = z1 + 1 + dz;
            if (!g.inside(x, z)) continue;
            const k = Math.abs(dx) + Math.abs(dz);
            wg = Math.min(wg, innWalks.gate[I(x, z)]! + k);
            ws = Math.min(ws, innWalks.square[I(x, z)]! + k);
          }
          if (Number.isFinite(wg) && Number.isFinite(ws)) lean = wg * 2 + ws * 0.6 + Math.max(0, ws - innReach) * 10 + byMainWay(c, z1 + 1) * 0.2;
          else lean = 1000 + d;
        }
        const score = lean + near * 1.5 + (wt.role === "inn" ? 0 : onArc + (z1 > cz + 2 ? 5 : 0)) + inLine * 8 - (shore && wt.role === "warehouse" ? 16 : 0) + random() * 2;
        candidates.push({ x0, z1, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score || a.z1 - b.z1 || a.x0 - b.x0);
    if (process.env.TOWN_DEBUG === "growth") console.log(`growth ${wt.id} ${wt.w}x${wt.depth}+${wt.shadow}: ${candidates.length} candidates${candidates[0] ? ` best ${candidates[0].x0},${candidates[0].z1}` : ""}`);
    // The best that a path can reach: each tried in turn, its lot taken back where none can.
    let landed = false;
    for (const cand of candidates.slice(0, R.designed ? 48 : 16)) {
      const lot = place(wt, cand.x0, cand.x0 + wt.w, cand.z1, 0);
      const m = lot.z1 + 1;
      const c = Math.floor((lot.x0 + lot.x1) / 2);
      const strip = chain([[lot.x0 + 1, m], [lot.x1 - 2, m]]);
      if (strip.every(([x, z]) => net.paved[I(x, z)])) {
        landed = true;
        break;
      }
      const onWay = strip.some(([x, z]) => net.middle[I(x, z)]! > 0);
      const r = onWay ? null : route(g, { from: [[c, m]], goal: (x, z) => (net.middle[I(x, z)]! > 0 && !strip.some(([sx, sz]) => sx === x && sz === z)) || centreTiles[I(x, z)]! > 0, pass: (x, z) => (passable(x, z) && (!wet(I(x, z)) || net.paved[I(x, z)]! > 0)) || (x === c && z === m), cost, turn: 0.5, limit: 120 });
      if (!onWay && (!r || r.length < 2)) {
        unplace(lot);
        continue;
      }
      net.add(strip, W, false, R.planks ? "planks" : "path");
      if (r) net.add(pull(r, (x, z) => passable(x, z), cost), W, false, R.planks ? "planks" : "path");
      landed = true;
      break;
    }
    if (!landed) {
      if (process.env.TOWN_DEBUG || wt.optional) continue;
      throw new Error(`${town.id}: no room for the lot of ${wt.id}`);
    }
    queue.splice(queue.indexOf(wt), 1);
  }


  // Every lot's door on a way: a front some path's cutting back left bare gets its strip again, joined to the rest.
  for (const lot of lots) {
    // A landmark's ground fronts its own way (its gate's).
    if (lot.want.site && lot.want.role === "hall") continue;
    const m = lot.z1 + 1;
    const c = Math.floor((lot.x0 + lot.x1) / 2);
    if (net.paved[I(c, lot.z1)]) continue;
    const strip = chain([[lot.x0 + 1, m], [lot.x1 - 2, m]]);
    if (!strip.every(([x, z]) => g.inside(x, z) && passable(x, z))) continue;
    if (strip.some(([x, z]) => net.middle[I(x, z)]! > 0)) {
      // A way runs by already: the strip in stretches, each joined to it where it meets it.
      let from = 0;
      for (let k = 1; k < strip.length; k++) {
        if (net.middle[I(strip[k]![0], strip[k]![1])]! === 0 && k < strip.length - 1) continue;
        const part = strip.slice(from, k + 1);
        if (part.length >= 2 && !part.slice(1, -1).some(([x, z]) => net.middle[I(x, z)]! > 0)) net.add(part, W, false, R.planks ? "planks" : "path");
        from = k;
      }
      continue;
    }
    net.add(strip, W, false, R.planks ? "planks" : "path");
    if (!connect([c, m], "net", false, strip)) connect([c, m], "centre", false, strip);
  }
  if (process.env.TOWN_DEBUG === "lots") console.log(`lots ${lots.length} (${lots.filter((l) => l.want.optional).length} extra); left ${queue.map((w) => w.id).join(" ")}; ${lots.filter((l) => !l.want.optional).map((l) => `${l.want.id}@${l.x0},${l.z0}-${l.x1},${l.z1}${net.paved[I(Math.floor((l.x0 + l.x1) / 2), l.z1)] ? "" : "!"}`).join(" ")}`);
  // --- The stilts' web: more boardwalks between the rings' paths, platforms at the junctions ---------------------------------------
  {
    // Every path that ends at no junction goes on to the nearest other (a loop, not a dead end: no walk goes the long way
    // round); the stilts' web joins one end in three of every path besides.
    const count = new Map<string, number>();
    for (const e of net.edges) for (const t of [e.tiles[0]!, e.tiles[e.tiles.length - 1]!]) count.set(`${t[0]},${t[1]}`, (count.get(`${t[0]},${t[1]}`) ?? 0) + 1);
    const ends = net.edges.flatMap((e) => [{ at: e.tiles[0]!, own: e.tiles }, { at: e.tiles[e.tiles.length - 1]!, own: e.tiles }]);
    ends.forEach(({ at, own }, k) => {
      if (centreTiles[I(at[0], at[1])] || net.middle[I(at[0], at[1])]! > 1) return;
      const dead = (count.get(`${at[0]},${at[1]}`) ?? 0) === 1 && !gateNodes.some((n) => n[0] === at[0] && n[1] === at[1]);
      if (dead || (R.web && k % 3 === 0)) connect(at, "net", false, own);
    });
  }
  // The stilts' lesser platforms: where three boardwalks or more meet away from the centre and its platforms, a deck of
  // planks of its own size (the web's knots), each one level.
  if (R.web) {
    const meets = new Map<string, number>();
    for (const e of net.edges) for (const t of [e.tiles[0]!, e.tiles[e.tiles.length - 1]!]) meets.set(`${t[0]},${t[1]}`, (meets.get(`${t[0]},${t[1]}`) ?? 0) + 1);
    const knots = [...meets.entries()].filter(([, n]) => n >= 3).map(([k]) => k.split(",").map(Number) as unknown as XZ);
    knots.sort((a, b) => Math.hypot(b[0] - cx, b[1] - cz) - Math.hypot(a[0] - cx, a[1] - cz) || a[0] - b[0] || a[1] - b[1]);
    const most = village ? 2 : 3;
    for (const [jx, jz] of knots) {
      if (quads.length >= quarterList.length + most) break;
      if (Math.hypot(jx - cx, (jz - cz) * 1.3) < rx + 8) continue;
      if (quads.some((q) => Math.hypot(q.cx - jx, q.cz - jz) < 12)) continue;
      // Of the sizes it may have (wider than deep, each knot its own), the biggest the ground there holds.
      const sizes: [number, number][] = (quads.length % 2 === 0 ? [[3, 2], [2, 2], [2, 1]] : [[2, 2], [3, 1], [2, 1]]);
      for (const [hx, hz] of sizes) {
        const sq: TownSquare = { x: jx - hx, z: jz - hz, w: 2 * hx + 1, d: 2 * hz + 1, name: R.names?.[1] ?? "A platform" };
        const tiles = squareTiles(sq);
        if (!tiles.every(([x, z]) => g.inside(x, z) && !lotAt[I(x, z)] && !blocked[I(x, z)] && !wet(I(x, z)) && !centreTiles[I(x, z)])) continue;
        // Nothing of it before a door (a lot's front row is its own).
        if (tiles.some(([x, z]) => g.inside(x, z - 1) && lotAt[I(x, z - 1)])) continue;
        const k = quads.length;
        for (const [x, z] of tiles) centreTiles[I(x, z)] = 2 + k;
        const lv = Math.max(centreLevel - 1, Math.min(centreLevel + 1, Math.round(height(jx, jz))));
        quads.push({ cx: jx, cz: jz, rx: hx, rz: hz, square: sq, level: lv });
        break;
      }
    }
  }
  if (process.env.TOWN_DEBUG === "quads") console.log(`platforms: ${quads.map((q) => `${q.cx},${q.cz} ${q.square.w}x${q.square.d}`).join("; ")}`);

  // --- The centre's open ground: inside the arcs, down to the centre, its edge wandering -------------------------------------------
  const open = new Uint8Array(g.size);
  const edge = noise(`${input.tag}:open`, 5);
  for (let z = centre.z - 8; z < centre.z + centre.d + 3; z++) {
    for (let x = centre.x - 6; x < centre.x + centre.w + 6; x++) {
      if (!g.inside(x, z)) continue;
      const i = I(x, z);
      if (centreTiles[i] || lotAt[i] || blocked[i] || wet(i) || shade[i]) continue;
      // Within the centre's ellipse grown by a wandering margin, south of the lots' fronts at its column.
      const grow = 1.5 + edge(x, z) * 3;
      if (!inEllipse(cx + 0.5, cz + 0.5, rx + grow, rz + grow, x, z)) continue;
      let under = false;
      for (const l of lots) if (x >= l.x0 - 1 && x < l.x1 + 1 && z >= l.z1) under = true;
      if (!under && z < cz) continue;
      open[i] = 1;
    }
  }

  // --- A village's pond on its green: a little water in the open ground at the green's south-east or south-west --------------
  if (form === "village" || form === "campus") {
    for (const sx of [1, -1]) {
      const px = cx + sx * Math.round(rx * 0.75);
      const pz = cz + Math.round(rz * 0.6);
      const tiles: number[] = [];
      let ok = true;
      for (let z = pz - 2; z <= pz + 2 && ok; z++) for (let x = px - 3; x <= px + 3 && ok; x++) {
        if (!inEllipse(px + 0.5, pz + 0.5, 3, 1.9, x, z)) continue;
        if (!g.inside(x, z)) ok = false;
        else {
          const i = I(x, z);
          // In the open ground about the green, never on a way or the green's own square tiles where the ways come in.
          if (!open[i] || centreTiles[i] || net.paved[i] || lotAt[i]) ok = false;
          for (const [dx, dz] of N8) if (g.inside(x + dx, z + dz) && net.paved[I(x + dx, z + dz)]) ok = false;
          tiles.push(i);
        }
      }
      if (!ok || tiles.length < 8) continue;
      for (const i of tiles) {
        water[i] = 1;
        open[i] = 0;
      }
      break;
    }
  }

  // --- 6. The outline: the oval, or traced round what is built (a closing of it), the roads' stretches to the edge within it ---
  const built = new Uint8Array(g.size);
  for (let i = 0; i < g.size; i++) if (lotAt[i] || net.paved[i] || centreTiles[i] || open[i]) built[i] = 1;
  const mask = oval ? Uint8Array.from(oval) : erode(g, dilate(g, built, 3), 2);
  for (let i = 0; i < g.size; i++) {
    const x = g.x(i);
    const z = g.z(i);
    // What is built is the town's; but a road's stretch out past a palisade is the country's.
    if (built[i] && (!oval || oval[i])) mask[i] = 1;
    if (nearSea[i] || x <= box.x0 || z <= box.z0 || x >= box.x1 - 1 || z >= box.z1 - 1) mask[i] = 0;
  }
  fillHoles(g, mask, box);
  // The ring round it: where the gates' roads cross it, its passages.
  ring(g, mask);
  const ringOpen = new Uint8Array(g.size);
  for (let i = 0; i < g.size; i++) if (mask[i] === 2 && (R.unwalled || nearSea[i] || dilate1(i))) ringOpen[i] = 1;
  function dilate1(i: number): boolean {
    const x = g.x(i);
    const z = g.z(i);
    return N8.some(([dx, dz]) => g.inside(x + 2 * dx, z + 2 * dz) && seaTile[I(x + 2 * dx, z + 2 * dz)] === 1);
  }


  // --- Piers off the shore ------------------------------------------------------------------------------------------------------
  const piers: OrganicPlan["piers"][number][] = [];
  for (const side of sea) {
    const [dx, dz] = STEP[side];
    const along = side === "north" || side === "south";
    let lastAt = -100;
    for (let t = along ? box.x0 + 4 : box.z0 + 4; t < (along ? box.x1 - 4 : box.z1 - 4) && piers.length < (village ? 2 : 3); t++) {
      if (t - lastAt < 14) continue;
      // From the town's edge on that side, out over the sea.
      let x = along ? t : cx;
      let z = along ? cz : t;
      while (g.inside(x, z) && !seaTile[I(x, z)]) {
        x += dx;
        z += dz;
      }
      if (!g.inside(x, z)) continue;
      // The shore's first tile back must be the town's.
      const back = [x - 3 * dx, z - 3 * dz] as const;
      if (!g.inside(back[0], back[1]) || mask[I(back[0], back[1])] === 0) continue;
      const len = 6;
      const x0 = dx < 0 ? x - len + 1 : dx > 0 ? x : x;
      const z0 = dz < 0 ? z - len + 1 : dz > 0 ? z : z;
      const box2: Box = along ? { x0, z0, x1: x0 + 3, z1: z0 + len } : { x0, z0, x1: x0 + len, z1: z0 + 3 };
      let okP = true;
      for (let zz = box2.z0; zz < box2.z1 && okP; zz++) for (let xx = box2.x0; xx < box2.x1 && okP; xx++) okP = g.inside(xx, zz) && seaTile[I(xx, zz)] === 1;
      if (!okP) continue;
      // A clan's first is its slip: the boat drawn up on it, sheds by it on the shore.
      const slip = R.slip === true && piers.length === 0;
      // Its boat at its seaward end, the slip walked up to it from the shore.
      const far: XZ = [dx > 0 ? box2.x1 - 1.5 : dx < 0 ? box2.x0 + 1.5 : (box2.x0 + box2.x1) / 2, dz > 0 ? box2.z1 - 1.5 : dz < 0 ? box2.z0 + 1.5 : (box2.z0 + box2.z1) / 2];
      piers.push({ box: box2, boat: slip ? far : along ? [box2.x1 + 1.5, (box2.z0 + box2.z1) / 2] : [(box2.x0 + box2.x1) / 2, box2.z1 + 1.5], along, ...(slip ? { slip } : {}) });
      lastAt = t;
    }
  }

  // --- 7. The terraces -----------------------------------------------------------------------------------------------------------
  const c = centreLevel;
  const groups: { tiles: number[]; level: number }[] = [];
  const centreGroup: number[] = [];
  for (let i = 0; i < g.size; i++) if (centreTiles[i] === 1 || open[i]) centreGroup.push(i);
  groups.push({ tiles: centreGroup, level: c });
  quads.forEach((q, k) => {
    const tiles: number[] = [];
    for (let i = 0; i < g.size; i++) if (centreTiles[i] === 2 + k) tiles.push(i);
    groups.push({ tiles, level: q.level });
  });
  for (const l of lots) {
    const tiles: number[] = [];
    for (let z = l.z0; z < l.z1 + W; z++) for (let x = l.x0; x < l.x1; x++) if (g.inside(x, z) && !centreTiles[I(x, z)] && !open[I(x, z)]) tiles.push(I(x, z));
    const lv = Math.max(1, lotLevel.get(l) ?? Math.min(c + 1, Math.max(c - 1, Math.round(height((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2)))));
    groups.push({ tiles, level: lv });
  }
  const level = terraces(g, mask, (x, z) => height(x, z), groups);

  // --- The plan ---------------------------------------------------------------------------------------------------------------
  const sites = lots.filter((l) => l.site).map((l) => ({ id: l.site!, box: { x0: l.x0, z0: l.z0, x1: l.x1, z1: l.z1 }, k0: 0, k1: 0 }));
  // Each lot one building's block (a store's a store, the physic garden none).
  const blocks = lots.filter((l) => !l.site).map((l) => blockOf(l, box, l.want.id, l.want.id.endsWith("-physic-garden") ? { garden: "physic" } : l.want.optional && l.want.role !== "house" ? { role: l.want.role } : {}));
  // Roads up into the centre its furniture keeps off (one across it, from the east or the west, is walked round); bridges
  // where the ways cross the water.
  const through: Box[] = [];
  for (const p of gatePaths) {
    const k = p.findIndex(([x, z]) => centreTiles[I(x, z)]);
    if (k <= 0) continue;
    // Where it comes up into the centre from the north or the south: its columns there.
    const [ex, ez] = p[k]!;
    if (p[k - 1]![0] !== ex || p[k - 1]![1] === ez) continue;
    through.push({ x0: ex - 1, z0: centre.z, x1: ex + 2, z1: centre.z + centre.d });
  }
  const bridges: Box[] = [];
  {
    const seen = new Uint8Array(g.size);
    for (let i = 0; i < g.size; i++) {
      if (seen[i] || !wet(i) || !net.paved[i] || !mask[i]) continue;
      const comp = [i];
      seen[i] = 1;
      for (let h = 0; h < comp.length; h++) for (const [dx, dz] of N4) {
        const x = g.x(comp[h]!) + dx;
        const z = g.z(comp[h]!) + dz;
        if (!g.inside(x, z)) continue;
        const j = I(x, z);
        if (seen[j] || !wet(j) || !net.paved[j]) continue;
        seen[j] = 1;
        comp.push(j);
      }
      const xs = comp.map((k) => g.x(k));
      const zs = comp.map((k) => g.z(k));
      bridges.push({ x0: Math.min(...xs), z0: Math.min(...zs) - 1, x1: Math.max(...xs) + 1, z1: Math.max(...zs) + 2 });
    }
  }
  const trees: PropData[] = [];
  if (R.trees) {
    for (const [x, z] of treeList) {
      const i = I(x, z);
      if (!mask[i] || lotAt[i] || net.paved[i] || open[i] || centreTiles[i] || blocked[i]) continue;
      trees.push({ id: "great-tree", x: x + 0.5, z: z + 0.5, seed: (x * 7 + z * 13) % 16, scale: 0.55 });
    }
  }
  // Lights at the junctions: where three or more ways meet, and the ends of the rings' paths.
  const lanterns: XZ[] = [];
  {
    const count = new Map<string, number>();
    for (const e of net.edges) for (const t of [e.tiles[0]!, e.tiles[e.tiles.length - 1]!]) count.set(`${t[0]},${t[1]}`, (count.get(`${t[0]},${t[1]}`) ?? 0) + 1);
    for (const [k, n] of count) if (n >= (R.web ? 2 : 3)) lanterns.push(k.split(",").map(Number) as unknown as XZ);
  }
  const square = { x0: centre.x, z0: centre.z, x1: centre.x + centre.w, z1: centre.z + centre.d, ...(R.round ? { round: true } : {}) };
  const surfaces = R.planks
    ? { centre: S.planks, open: S.planks, street: S.planks, path: S.planks, planks: S.planks, platform: S.planks }
    : form === "village" || form === "estate"
      ? { centre: S.grass, open: S.grass, street: looks.street, path: looks.path, planks: S.planks, platform: S.grass }
      : { centre: looks.square, open: form === "elfhame" ? S.moss : form === "campus" ? S.grass : looks.path, street: looks.street, path: looks.path, planks: S.planks, platform: looks.square };
  return {
    organic: true,
    g,
    net,
    centre,
    platforms: quads.map((q) => q.square),
    platformSurfaces: quads.map((_, k) => {
      const kind = quarterOf[k]?.kind;
      return kind === "park" || kind === "quad" || kind === "circle" ? S.grass : kind === "yard" ? S.dirt : kind === "close" ? S.flagstones : surfaces.platform;
    }),
    quarters: quads.map((_, k) => quarterOf[k]?.kind ?? "deck"),
    designed: R.designed === true,
    quay: quayTiles,
    head: head.id,
    open,
    mask,
    ringOpen,
    level,
    lots,
    trees,
    surfaces,
    lanterns,
    light: R.light,
    piers,
    gateNodes,
    box,
    inner: { x0: box.x0 + 1, z0: box.z0 + 1, x1: box.x1 - 1, z1: box.z1 - 1 },
    square,
    gates,
    sites,
    blocks,
    south: { k: 99, z0: box.z1, z1: box.z1 },
    river: null,
    sea,
    through,
    bridges,
    water: new Set([...water.keys()].filter((i) => water[i])),
  };
}

function average(tiles: readonly (readonly [number, number])[], f: (x: number, z: number) => number): number {
  let s = 0;
  for (const [x, z] of tiles) s += f(x, z);
  return tiles.length > 0 ? s / tiles.length : 1;
}

/** The planner of a grown form. */
export const grown = (form: Form): Planner => organicPlanner((input) => planGrown(form, input));