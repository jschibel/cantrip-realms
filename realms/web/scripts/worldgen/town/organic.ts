// What the planners of grown towns share (planner.ts; amphitheatre.ts's elfhames, clan holds and villages, stilts.ts's
// boardwalks): their ways as a network of paths that wander (`Net`, each path its middle line of tiles, widened by its
// width as streets.ts paves a way), laid by least-cost routes over a cost field (`route`: A* in eight ways that never
// cuts a corner, each turn and climb dearer, cheaper along a way already laid so paths merge, then pulled straight where
// the ground lets it); the town's outline traced from what is built (`outline`: a morphological closing, its holes
// filled, the ring round it); its terraces (`terraces`: the centre and each lot one level, the rest eased so open
// neighbours are a level apart at most); and the painting, the graph and the lights every grown plan is given
// (`ORGANIC`).

import type { PropData, StreetWay, TownSquare, XZ } from "../../../src/world/format";
import { BARE, BLOCKED } from "../../../src/world/format";
import { brushOf, lineTiles, squareTiles } from "../../../src/world/streets";
import { S } from "../ids";
import { Heap, Use } from "../land";
import { stand } from "./dress";
import { formOf, groundsOf } from "./forms";
import type { Ctx } from "./index";
import type { Block, Box, ExtraWay, Graph, Plan, Planner } from "./planner";
import { propHides } from "./view";

// --- Grids --------------------------------------------------------------------------------------------------------------

export class Grid {
  readonly size: number;
  constructor(
    readonly W: number,
    readonly D: number,
  ) {
    this.size = W * D;
  }
  idx = (x: number, z: number): number => z * this.W + x;
  inside = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < this.W && z < this.D;
  x = (i: number): number => i % this.W;
  z = (i: number): number => Math.floor(i / this.W);
}

export const N4: readonly XZ[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const N8: readonly XZ[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

// --- The network ----------------------------------------------------------------------------------------------------------

/** A path of the town: its middle line of tiles, four-connected, in order; its width; whether it is a main way. */
export interface Edge {
  tiles: XZ[];
  readonly width: number;
  readonly main: boolean;
  /** What paves it: a street's surface, a path's, the boardwalks' planks. */
  readonly surface: "street" | "path" | "planks";
}

/** The four-connected tiles of a run of points (each two eight-connected, or a straight run): lineTiles joined. */
export function chain(points: readonly XZ[]): XZ[] {
  const out: XZ[] = [];
  for (let k = 0; k < points.length; k++) {
    if (k === 0) {
      out.push([points[0]![0], points[0]![1]]);
      continue;
    }
    const run = lineTiles(points[k - 1]!, points[k]!);
    for (let j = 1; j < run.length; j++) out.push(run[j]!);
  }
  return out;
}

/** The corners of a four-connected run of tiles: its ends, and every tile where it turns. */
export function corners(tiles: readonly XZ[]): XZ[] {
  if (tiles.length <= 2) return tiles.map((t) => [t[0], t[1]]);
  const out: XZ[] = [[tiles[0]![0], tiles[0]![1]]];
  for (let k = 1; k < tiles.length - 1; k++) {
    const a = tiles[k - 1]!;
    const b = tiles[k]!;
    const c = tiles[k + 1]!;
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) out.push([b[0], b[1]]);
  }
  const last = tiles[tiles.length - 1]!;
  out.push([last[0], last[1]]);
  return out;
}

/**
 * The ways of a grown town: paths joined where they meet. A path laid to end on another's middle line splits that one
 * there, so every junction is a node of the graph; one that ends on a square ends there.
 */
export class Net {
  readonly edges: Edge[] = [];
  /** How many paths pave each tile (their middle lines widened by their widths). */
  readonly paved: Uint16Array;
  /** Middle-line tiles: how many paths' middles pass through each. */
  readonly middle: Uint16Array;

  constructor(readonly g: Grid) {
    this.paved = new Uint16Array(g.size);
    this.middle = new Uint16Array(g.size);
  }

  /** The tiles a path paves: each middle tile widened by its brush. */
  static brush(e: Pick<Edge, "tiles" | "width">): XZ[] {
    const [lo, hi] = brushOf(e.width);
    const seen = new Set<string>();
    const out: XZ[] = [];
    for (const [x, z] of e.tiles) {
      for (let dz = lo; dz <= hi; dz++) for (let dx = lo; dx <= hi; dx++) {
        const k = `${x + dx},${z + dz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([x + dx, z + dz]);
      }
    }
    return out;
  }

  private mark(e: Edge, by: number): void {
    const { g } = this;
    for (const [x, z] of Net.brush(e)) if (g.inside(x, z)) this.paved[g.idx(x, z)]! += by;
    for (const [x, z] of e.tiles) if (g.inside(x, z)) this.middle[g.idx(x, z)]! += by;
  }

  /** Splits the path whose middle passes through (x, z) inside it (not at an end) there; whether one did. */
  split(x: number, z: number): boolean {
    for (let e = 0; e < this.edges.length; e++) {
      const edge = this.edges[e]!;
      const k = edge.tiles.findIndex((t) => t[0] === x && t[1] === z);
      if (k <= 0 || k >= edge.tiles.length - 1) continue;
      const tail: Edge = { ...edge, tiles: edge.tiles.slice(k) };
      edge.tiles = edge.tiles.slice(0, k + 1);
      // The shared tile is now counted twice: once by each half.
      this.middle[this.g.idx(x, z)]!++;
      this.edges.push(tail);
      // The halves' brushes cover what the whole did, the shared tile's twice.
      const [lo, hi] = brushOf(edge.width);
      for (let dz = lo; dz <= hi; dz++) for (let dx = lo; dx <= hi; dx++) if (this.g.inside(x + dx, z + dz)) this.paved[this.g.idx(x + dx, z + dz)]!++;
      return true;
    }
    return false;
  }

  /** Cuts back the path that ends at (x, z) from that end, as far as `keep` says it may (its tiles in order from that end). */
  cutBack(x: number, z: number, keep: (t: XZ) => boolean): void {
    for (const e of this.edges) {
      const first = e.tiles[0]!;
      const last = e.tiles[e.tiles.length - 1]!;
      const atStart = first[0] === x && first[1] === z;
      const atEnd = last[0] === x && last[1] === z;
      if (!atStart && !atEnd) continue;
      const order = atStart ? [...e.tiles] : [...e.tiles].reverse();
      let k = 0;
      while (k < order.length - 2 && !keep(order[k]!)) k++;
      if (k === 0) return;
      this.mark(e, -1);
      const kept = order.slice(k);
      e.tiles = atStart ? kept : kept.reverse();
      this.mark(e, 1);
      return;
    }
  }

  /** Whether a tile is an end of a path. */
  isEnd(x: number, z: number): boolean {
    return this.edges.some((e) => (e.tiles[0]![0] === x && e.tiles[0]![1] === z) || (e.tiles[e.tiles.length - 1]![0] === x && e.tiles[e.tiles.length - 1]![1] === z));
  }

  /** Adds a path (its tiles four-connected), splitting any path its ends land on. Returns its index. */
  add(tiles: readonly XZ[], width: number, main: boolean, surface: Edge["surface"] = main ? "street" : "path"): number {
    if (tiles.length < 2) throw new Error("a path of fewer than two tiles");
    for (let k = 1; k < tiles.length; k++) {
      const d = Math.abs(tiles[k]![0] - tiles[k - 1]![0]) + Math.abs(tiles[k]![1] - tiles[k - 1]![1]);
      if (d !== 1) throw new Error(`a path not four-connected at ${tiles[k - 1]!.join(",")} -> ${tiles[k]!.join(",")}`);
    }
    for (const end of [tiles[0]!, tiles[tiles.length - 1]!]) {
      const i = this.g.idx(end[0], end[1]);
      if (this.g.inside(end[0], end[1]) && this.middle[i]! > 0 && !this.isEnd(end[0], end[1])) this.split(end[0], end[1]);
    }
    const e: Edge = { tiles: tiles.map((t) => [t[0], t[1]]), width, main, surface };
    this.edges.push(e);
    this.mark(e, 1);
    return this.edges.length - 1;
  }

  /** Every paved tile, by index. */
  pavedTiles(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.g.size; i++) if (this.paved[i]) out.push(i);
    return out;
  }

  /** The network as the world keeps it: nodes at the paths' ends, each path a way through its corners. */
  graph(): { nodes: XZ[]; ways: StreetWay[] } {
    const nodes: XZ[] = [];
    const index = new Map<string, number>();
    const node = (p: XZ) => {
      const k = `${p[0]},${p[1]}`;
      let i = index.get(k);
      if (i === undefined) {
        i = nodes.length;
        index.set(k, i);
        nodes.push([p[0], p[1]]);
      }
      return i;
    };
    const ways: StreetWay[] = [];
    for (const e of this.edges) {
      const c = corners(e.tiles);
      const a = node(c[0]!);
      const b = node(c[c.length - 1]!);
      if (a === b) continue;
      const via = c.slice(1, -1);
      ways.push({ a, b, width: e.width, ...(e.main ? { main: true } : {}), ...(via.length > 0 ? { via } : {}) });
    }
    return { nodes, ways };
  }
}

// --- Routes ---------------------------------------------------------------------------------------------------------------

export interface RouteOptions {
  /** Where it may start (cost 0). */
  readonly from: readonly XZ[];
  /** Where it may end. */
  readonly goal: (x: number, z: number) => boolean;
  /** A point the goal lies at, for the search's estimate (none: a plain Dijkstra). */
  readonly toward?: XZ;
  /** Whether the middle line may pass a tile (what its width paves there is free). */
  readonly pass: (x: number, z: number) => boolean;
  /** What a step onto a tile costs, 1 the least. */
  readonly cost: (x: number, z: number) => number;
  /** What each turn costs. */
  readonly turn?: number;
  /** How far it may search, in cost. */
  readonly limit?: number;
}

/**
 * The cheapest way from `from` to a goal tile: A* over eight directions (a diagonal step only where both tiles beside it
 * may be passed, so the four-connected line drawn from it passes only free tiles), each step its tile's cost, each turn
 * `turn` more. Returns the tiles in order, eight-connected, or null.
 */
export function route(g: Grid, o: RouteOptions): XZ[] | null {
  const turn = o.turn ?? 0.4;
  // A state is a tile and the direction it was entered by (0-7, 8 none).
  const best = new Float64Array(g.size * 9).fill(Infinity);
  const came = new Int32Array(g.size * 9).fill(-1);
  const heap = new Heap();
  const h = (x: number, z: number) => (o.toward ? Math.hypot(x - o.toward[0], z - o.toward[1]) * 0.98 : 0);
  for (const [x, z] of o.from) {
    if (!g.inside(x, z)) continue;
    const s = g.idx(x, z) * 9 + 8;
    best[s] = 0;
    heap.push(s, h(x, z));
  }
  const limit = o.limit ?? Infinity;
  let end = -1;
  while (heap.size > 0) {
    const s = heap.pop();
    const i = Math.floor(s / 9);
    const d = s % 9;
    const x = g.x(i);
    const z = g.z(i);
    const here = best[s]!;
    if (here > limit) break;
    if (d !== 8 && o.goal(x, z)) {
      end = s;
      break;
    }
    for (let n = 0; n < 8; n++) {
      const [dx, dz] = N8[n]!;
      const nx = x + dx;
      const nz = z + dz;
      if (!g.inside(nx, nz) || !o.pass(nx, nz)) continue;
      if (dx && dz && (!o.pass(x + dx, z) || !o.pass(x, z + dz))) continue;
      const step = (dx && dz ? Math.SQRT2 : 1) * o.cost(nx, nz) + (d !== 8 && d !== n ? turn : 0);
      const ns = g.idx(nx, nz) * 9 + n;
      const nd = here + step;
      if (nd < best[ns]!) {
        best[ns] = nd;
        came[ns] = s;
        heap.push(ns, nd + h(nx, nz));
      }
    }
  }
  if (end < 0) return null;
  const out: XZ[] = [];
  for (let s = end; s >= 0; s = came[s]!) {
    const i = Math.floor(s / 9);
    out.push([g.x(i), g.z(i)]);
  }
  return out.reverse();
}

/**
 * A route pulled straight where the ground lets it: from each corner, on to the furthest tile of the route (no further
 * than `reach` along it) the straight line to which passes only tiles it may and costs little more than the route did;
 * returned four-connected.
 */
export function pull(route: readonly XZ[], pass: (x: number, z: number) => boolean, cost: (x: number, z: number) => number, reach = 9): XZ[] {
  const points: XZ[] = [route[0]!];
  // The route's cost up to each tile.
  const along: number[] = [0];
  for (let k = 1; k < route.length; k++) along.push(along[k - 1]! + cost(route[k]![0], route[k]![1]) * Math.hypot(route[k]![0] - route[k - 1]![0], route[k]![1] - route[k - 1]![1]));
  let i = 0;
  while (i < route.length - 1) {
    let next = i + 1;
    for (let j = Math.min(route.length - 1, i + reach); j > i + 1; j--) {
      const line = lineTiles(route[i]!, route[j]!);
      if (!line.every(([x, z]) => pass(x, z))) continue;
      let c = 0;
      for (let k = 1; k < line.length; k++) c += cost(line[k]![0], line[k]![1]);
      if (c <= (along[j]! - along[i]!) * 1.12 + 0.5) {
        next = j;
        break;
      }
    }
    points.push(route[next]!);
    i = next;
  }
  return chain(points);
}

// --- Shapes ---------------------------------------------------------------------------------------------------------------

/** A tile mask grown by `r` (a disc), or shrunk by it. */
export function dilate(g: Grid, m: Uint8Array, r: number): Uint8Array {
  const out = new Uint8Array(g.size);
  const offsets: XZ[] = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dz * dz <= r * r + 0.5) offsets.push([dx, dz]);
  for (let i = 0; i < g.size; i++) {
    if (!m[i]) continue;
    const x = g.x(i);
    const z = g.z(i);
    for (const [dx, dz] of offsets) if (g.inside(x + dx, z + dz)) out[g.idx(x + dx, z + dz)] = 1;
  }
  return out;
}

export function erode(g: Grid, m: Uint8Array, r: number): Uint8Array {
  const inv = new Uint8Array(g.size);
  for (let i = 0; i < g.size; i++) inv[i] = m[i] ? 0 : 1;
  const grown = dilate(g, inv, r);
  const out = new Uint8Array(g.size);
  for (let i = 0; i < g.size; i++) out[i] = grown[i] ? 0 : 1;
  return out;
}

/** Fills a mask's holes within a box: what the box's edge cannot reach without crossing it. */
export function fillHoles(g: Grid, m: Uint8Array, box: Box): void {
  const outside = new Uint8Array(g.size);
  const queue: number[] = [];
  for (let z = box.z0; z < box.z1; z++) for (let x = box.x0; x < box.x1; x++) if ((x === box.x0 || z === box.z0 || x === box.x1 - 1 || z === box.z1 - 1) && !m[g.idx(x, z)]) {
    outside[g.idx(x, z)] = 1;
    queue.push(g.idx(x, z));
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!;
    const x = g.x(i);
    const z = g.z(i);
    for (const [dx, dz] of N4) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < box.x0 || nz < box.z0 || nx >= box.x1 || nz >= box.z1) continue;
      const j = g.idx(nx, nz);
      if (outside[j] || m[j]) continue;
      outside[j] = 1;
      queue.push(j);
    }
  }
  for (let z = box.z0; z < box.z1; z++) for (let x = box.x0; x < box.x1; x++) if (!outside[g.idx(x, z)]) m[g.idx(x, z)] = 1;
}

/** The ring round a mask (its tiles 1): every tile beside one (eight ways) not in it, marked 2. */
export function ring(g: Grid, m: Uint8Array): void {
  const add: number[] = [];
  for (let i = 0; i < g.size; i++) {
    if (m[i]) continue;
    const x = g.x(i);
    const z = g.z(i);
    if (N8.some(([dx, dz]) => g.inside(x + dx, z + dz) && m[g.idx(x + dx, z + dz)] === 1)) add.push(i);
  }
  for (const i of add) m[i] = 2;
}

/** Whether a tile is in an ellipse about (cx, cz) with radii rx, rz (tile middles). */
export const inEllipse = (cx: number, cz: number, rx: number, rz: number, x: number, z: number): boolean => ((x + 0.5 - cx) / rx) ** 2 + ((z + 0.5 - cz) / rz) ** 2 <= 1;

// --- Lots -------------------------------------------------------------------------------------------------------------------

/** Ground for one building facing south: x0..x1, z0..z1, its door on the way along row z1. */
export interface Lot {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** The need it is made for, when it is one need's own (a site's id). */
  readonly site?: string;
  /** Which ring of an arc it stands in (0 none). */
  readonly ring: number;
}

/** A lot as the solver's block (planner.ts): one building, its door on row z1. */
export function blockOf(l: Lot, box: Box, meant?: string): Block & { readonly one: true; readonly meant?: string } {
  return { k: Math.max(0, Math.floor((l.z1 - box.z0) / 10)), x0: l.x0, x1: l.x1, z0: l.z0, z1: l.z1, west: "street", east: "street", one: true, ...(meant ? { meant } : {}) };
}

// --- The plan of a grown town -------------------------------------------------------------------------------------------------

export interface OrganicPlan extends Plan {
  readonly organic: true;
  readonly g: Grid;
  readonly net: Net;
  /** The centre as the world keeps it (round or a rectangle), and any other squares or platforms. */
  readonly centre: TownSquare;
  readonly platforms: readonly TownSquare[];
  /** Open ground of the centre beyond its square (1): kept clear, walked over. */
  readonly open: Uint8Array;
  /** The town: 1 within its outline, 2 the ring its edge stands on. */
  readonly mask: Uint8Array;
  /** Ring tiles left open (on the sea, where the form has no wall). */
  readonly ringOpen: Uint8Array;
  /** The level of every tile of the town. */
  readonly level: Int16Array;
  readonly lots: readonly Lot[];
  /** What stands in the town from the plan: the elfhame's great trees. */
  readonly trees: readonly PropData[];
  /** Surfaces: of the centre and its open ground, and of the streets, paths and boardwalks. */
  readonly surfaces: { readonly centre: number; readonly open: number; readonly street: number; readonly path: number; readonly planks: number; readonly platform: number };
  /** The site at the head of the centre (its temple, shrine, tower or landmark). */
  readonly head: string;
  /** Junctions where a light stands. */
  readonly lanterns: readonly XZ[];
  /** The light that stands there. */
  readonly light: PropData | null;
  /** Piers off the shore, and where a boat lies by each. */
  readonly piers: readonly { readonly box: Box; readonly boat: XZ; readonly along: boolean }[];
  /** The gates' nodes outside the town, by gate. */
  readonly gateNodes: readonly XZ[];
}

export const isOrganic = (p: Plan): p is OrganicPlan => (p as Partial<OrganicPlan>).organic === true;

/** Lays a grown plan's ground (planner.ts, `paint`). */
function paintOrganic(ctx: Ctx): void {
  const { land, F } = ctx;
  const plan = ctx.plan as OrganicPlan;
  const g = groundsOf(ctx.town);
  const tagN = ctx.spec.index + 1;
  const { mask } = plan;
  for (let i = 0; i < land.size; i++) {
    if (!mask[i]) continue;
    if (land.isSea(i)) continue;
    land.town[i] = tagN;
    land.decor.delete(i);
    land.flags[i] = 0;
    land.surface[i] = g.yard;
    land.use[i] = Use.Lot;
    ctx.level[i] = plan.level[i]!;
    ctx.inTown[i] = mask[i]!;
  }
  // The ring: the wall, palisade or hedge where the form has one, open ground on the sea and where it has none.
  for (let i = 0; i < land.size; i++) {
    if (mask[i] !== 2 || land.isSea(i)) continue;
    if (F.enclosure === "none" || plan.ringOpen[i]) continue;
    land.use[i] = Use.Wall;
    land.flags[i] = BLOCKED | BARE;
  }
  const pave = (i: number, surface: number, use: number, see: boolean) => {
    land.flags[i] = 0;
    land.surface[i] = surface;
    land.use[i] = use;
    land.decor.delete(i);
    if (see) ctx.mustSee[i] = 1;
  };
  // The centre's open ground, then its square, then the ways over them.
  for (let i = 0; i < land.size; i++) if (plan.open[i] && mask[i] === 1) pave(i, plan.surfaces.open, Use.Kept, false);
  for (const sq of [plan.centre, ...plan.platforms]) {
    for (const [x, z] of squareTiles(sq)) {
      if (!land.inside(x, z)) continue;
      pave(land.idx(x, z), sq === plan.centre ? plan.surfaces.centre : plan.surfaces.platform, Use.Kept, true);
    }
  }
  for (const e of plan.net.edges) {
    const surface = e.surface === "planks" ? plan.surfaces.planks : e.surface === "street" ? plan.surfaces.street : plan.surfaces.path;
    for (const [x, z] of Net.brush(e)) {
      if (!land.inside(x, z)) continue;
      const i = land.idx(x, z);
      // Beyond the town (a gate's way out to its road's end) the road is the country's to lay.
      if (!mask[i]) continue;
      if (land.use[i] === Use.Kept && ctx.mustSee[i]) continue;
      pave(i, surface, Use.Street, true);
    }
  }
  // Water through the town: under a way, a bridge's deck; elsewhere closed.
  for (const i of ctx.river) {
    if (!mask[i]) continue;
    const bridge = land.use[i] === Use.Street;
    land.surface[i] = S.stream;
    land.flags[i] = bridge ? 0 : BLOCKED;
    if (!bridge) {
      land.use[i] = Use.Wild;
      ctx.mustSee[i] = 0;
    }
  }
  // The plan's own trees.
  for (const t of plan.trees) {
    const i = land.idx(Math.floor(t.x), Math.floor(t.z));
    if (land.use[i] !== Use.Lot) continue;
    // Never where it hides a way, the centre or a door from the camera.
    if (propHides(t, 0).some(([hx, hz]) => land.inside(hx, hz) && ctx.mustSee[land.idx(hx, hz)] === 1)) continue;
    if (land.n8(i).some((j) => ctx.mustSee[j] === 1)) continue;
    land.put(i, t);
    land.use[i] = Use.Yard;
  }
}

/** A grown plan's ways and squares as the world keeps them. */
function graphOrganic(plan: Plan, extra: readonly ExtraWay[]): Graph {
  const p = plan as OrganicPlan;
  const { nodes, ways } = p.net.graph();
  const index = new Map(nodes.map((n, k) => [`${n[0]},${n[1]}`, k]));
  const node = (q: XZ) => {
    const k = `${q[0]},${q[1]}`;
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      index.set(k, i);
      nodes.push([q[0], q[1]]);
    }
    return i;
  };
  for (const e of extra) if (e.a[0] !== e.b[0] || e.a[1] !== e.b[1]) ways.push({ a: node(e.a), b: node(e.b), width: e.width, ...(e.main ? { main: true } : {}), ...(e.via && e.via.length > 0 ? { via: e.via.map((v) => [v[0], v[1]] as XZ) } : {}) });
  const gates = p.gateNodes.map(node);
  return { nodes, ways, gates, squares: [p.centre, ...p.platforms] };
}

/** Lights at the plan's junctions: each on a closed tile beside its way, hiding nothing the camera must see. */
function lightsOrganic(ctx: Ctx): void {
  const plan = ctx.plan as OrganicPlan;
  const { land } = ctx;
  if (!plan.light) return;
  const doorNear = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (land.inside(x + dx, z + dz) && land.use[land.idx(x + dx, z + dz)] === Use.Door) return true;
    return false;
  };
  const taken: XZ[] = [];
  // A deck of planks (the stilts' lesser platforms) keeps its stores: a stack of crates at a back corner no way crosses.
  if (plan.surfaces.platform === S.planks) {
    plan.platforms.forEach((sq, k) => {
      for (const [x, z] of [[sq.x, sq.z], [sq.x + sq.w - 1, sq.z]] as const) {
        if (!land.inside(x, z)) continue;
        const i = land.idx(x, z);
        if (land.use[i] !== Use.Kept || !land.open(i) || doorNear(x, z)) continue;
        const p: PropData = { id: "crate-stack", x: x + 0.5, z: z + 0.5, seed: k };
        if (propHides(p, 0).some(([hx, hz]) => land.inside(hx, hz) && ctx.mustSee[land.idx(hx, hz)] === 1 && land.use[land.idx(hx, hz)] !== Use.Kept)) continue;
        stand(ctx, p, Use.Yard);
        return;
      }
    });
  }
  for (const [jx, jz] of plan.lanterns) {
    let done = false;
    for (let r = 1; r <= 3 && !done; r++) {
      for (let dz = -r; dz <= r && !done; dz++) {
        for (let dx = -r; dx <= r && !done; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = jx + dx;
          const z = jz + dz;
          if (!land.inside(x, z)) continue;
          const i = land.idx(x, z);
          if (land.use[i] !== Use.Lot || !land.open(i) || doorNear(x, z)) continue;
          if (!land.n4(i).some((j) => land.use[j] === Use.Street)) continue;
          if (taken.some(([tx, tz]) => Math.abs(tx - x) + Math.abs(tz - z) < 6)) continue;
          const p: PropData = { ...plan.light, x: x + 0.5, z: z + 0.5 };
          if (propHides(p, 0).some(([hx, hz]) => land.inside(hx, hz) && ctx.mustSee[land.idx(hx, hz)] === 1)) continue;
          stand(ctx, p, Use.Yard);
          taken.push([x, z]);
          done = true;
        }
      }
    }
  }
}

/** The planner every grown plan paints, graphs and lights with; each form's `plan` is its own. */
export function organicPlanner(plan: Planner["plan"]): Planner {
  return { plan, paint: paintOrganic, graph: graphOrganic, lights: lightsOrganic };
}

// --- Terraces ---------------------------------------------------------------------------------------------------------------

/**
 * The town's levels: each group (the centre, each lot with the way before it) one level, the rest of the town at the
 * land's own, eased (lowered from the low ground, raised from the high, as terrain.ts eases the country) until no two
 * neighbours of the town are more than a level apart. Groups keep their level; the caller keeps groups that touch within
 * a level of each other.
 */
export function terraces(g: Grid, mask: Uint8Array, height: (x: number, z: number) => number, groups: readonly { readonly tiles: readonly number[]; readonly level: number }[]): Int16Array {
  const level = new Int16Array(g.size);
  const fixed = new Uint8Array(g.size);
  for (let i = 0; i < g.size; i++) level[i] = Math.max(1, Math.round(height(g.x(i), g.z(i))));
  for (const grp of groups) for (const i of grp.tiles) {
    level[i] = grp.level;
    fixed[i] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    const order = Array.from({ length: g.size }, (_, i) => i).filter((i) => mask[i]).sort((a, b) => (pass === 0 ? level[a]! - level[b]! : level[b]! - level[a]!) || a - b);
    const queue = [...order];
    const inQueue = new Uint8Array(g.size);
    for (const i of order) inQueue[i] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      inQueue[i] = 0;
      const x = g.x(i);
      const z = g.z(i);
      for (const [dx, dz] of N4) {
        if (!g.inside(x + dx, z + dz)) continue;
        const n = g.idx(x + dx, z + dz);
        if (!mask[n] || fixed[n]) continue;
        const want = pass === 0 ? Math.min(level[n]!, level[i]! + 1) : Math.max(level[n]!, level[i]! - 1);
        if (want !== level[n]) {
          level[n] = want;
          if (!inQueue[n]) {
            inQueue[n] = 1;
            queue.push(n);
          }
        }
      }
    }
  }
  return level;
}

/** Whether the town's form is one a grown planner lays out. */
export const grownForm = (ctx: Ctx): boolean => ["elfhame", "clan", "village", "stilts"].includes(formOf(ctx.town));
