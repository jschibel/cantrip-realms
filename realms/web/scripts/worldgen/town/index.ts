// A town and its grounds at walking scale (design.md A6 "Towns"; tech.md B5 "Dominaria as generated": Towns): one call
// lays a town's whole pocket into the Land - its terrain, the town within its walls, the country round it that is
// walked, and the apron of scenery past that - and says what it built. The integrator places the pocket (`origin`) and
// fills what lies on the travel map (the town's `site`, each way's `outside`).
//
// The steps, each its own module: the site's fields (site.ts: the land's height, the sea, the river); the street plan
// (plan.ts: rows facing south onto their streets, the square where the walks to the gates are shortest, arteries to the
// gates, landmarks' ground, connectors splitting the rows into blocks); the program and its solver (place.ts: every place
// the town needs landed where it serves best, no building hiding a street from the camera); the country (roads out from
// the gates by weighted A*, fields, farms, woods, the walked ground's closed edge and the apron); the dressing (dress.ts:
// walls, gardens, the square's furniture, lights, the harbour, and the people); the terraces and their ramps; and the
// checks (check.ts), which fail the town when a rule of its design breaks.

import type { BuildingData, NpcData, PropData, TownPlace, TownPlan, XZ } from "../../../src/world/format";
import { BARE, BLOCKED } from "../../../src/world/format";
import { S } from "../ids";
import { Land, Use, randomFor } from "../land";
import type { TownLayout } from "../layout";
import { check, fillPockets } from "./check";
import { dress } from "./dress";
import { type FormSpec, TOWN_SIZE, formOf, formSpec, groundsOf } from "./forms";
import { civicDepth, districts, Placer, programOf } from "./place";
import { type Box, type Plan, planGraph, planTown } from "./plan";
import { country } from "./country";
import { fieldsOf, riverTiles } from "./site";
import { levelGrounds } from "./terrain";
import type { BuiltTown, InteriorSpec, Side, TownSpec, TownWay } from "./types";

export type { BuiltTown, InteriorSpec, TownSetting, TownSpec, TownWay, Side } from "./types";

/** The apron of scenery round the walked country: seen, never walked. */
export const APRON = 26;

/** The size of the grounds a town needs, whole chunks (multiples of 32) each way. */
export function groundsSize(plan: TownLayout): readonly [number, number] {
  const [w, d] = TOWN_SIZE[plan.kind];
  const margin = 16 + APRON;
  return [Math.ceil((w + 2 * margin) / 32) * 32, Math.ceil((d + 2 * margin) / 32) * 32];
}

/** Everything the steps share. */
export interface Ctx {
  readonly spec: TownSpec;
  readonly town: TownLayout;
  readonly F: FormSpec;
  readonly land: Land;
  readonly plan: Plan;
  readonly seed: number;
  readonly tag: string;
  /** Level (whole terraces) of every tile. */
  readonly level: Int16Array;
  /** Tiles that must stay in sight from the camera: streets, squares, doors, the roads near the town. */
  readonly mustSee: Uint8Array;
  readonly props: PropData[];
  readonly buildings: BuildingData[];
  readonly npcs: NpcData[];
  readonly places: TownPlace[];
  readonly interiors: InteriorSpec[];
  readonly river: Set<number>;
  readonly ways: TownWay[];
  /** Extra ways of the street plan (a harbour's quay, the gates' roads), for the graph. */
  readonly extraWays: { a: XZ; b: XZ; width: number; main?: boolean }[];
  readonly notes: string[];
  readonly random: (part: string) => () => number;
}

/** Lays the whole grounds (its terrain, the town, the country round it, the apron) into the Land at `origin`. */
export function buildTown(target: Land, spec: TownSpec, seed: number, options: { readonly lenient?: boolean } = {}): BuiltTown {
  const town = spec.plan;
  const F = formSpec(town);
  const [GW, GD] = groundsSize(town);
  const [TW, TD] = TOWN_SIZE[town.kind];
  const land = new Land(GW, GD);
  const tag = `${seed}:town:${town.id}`;
  const random = (part: string) => randomFor(seed, `town:${town.id}:${part}`);
  const box: Box = { x0: Math.floor((GW - TW) / 2), z0: Math.floor((GD - TD) / 2), x1: Math.floor((GW - TW) / 2) + TW, z1: Math.floor((GD - TD) / 2) + TD };
  const rise = town.kind === "capital" ? 3 : town.kind === "town" ? 2.4 : 1.6;
  const fields = fieldsOf(GW, GD, box, spec.setting, tag, rise);
  const { needs, sites } = programOf(town, spec.vendors, spec.exotic);
  const plan = planTown({
    box,
    F,
    ways: spec.setting.ways,
    sea: new Set(spec.setting.sea),
    river: spec.setting.river,
    height: fields.height,
    sites,
    civic: civicDepth(town, needs, sites),
    random: random("plan"),
    gateWidth: F.street,
    id: town.id,
  });
  const ctx: Ctx = {
    spec,
    town,
    F,
    land,
    plan,
    seed,
    tag,
    level: new Int16Array(land.size),
    mustSee: new Uint8Array(land.size),
    props: land.fixtures,
    buildings: [],
    npcs: [],
    places: [],
    interiors: [],
    river: riverTiles(fields, plan, tag),
    ways: [],
    extraWays: [],
    notes: [],
    random,
  };

  // --- The ground: the country, the sea and the river, then the town over it ----------------------------------------
  country(ctx, fields, "ground");
  paintTown(ctx);

  // --- The places, the districts, the rest of the rows ------------------------------------------------------------------
  const main = plan.gates.find((g) => g.main) ?? plan.gates[0]!;
  // Walks along the streets (as the plan paves them), from the main gate's passage and from the square.
  const walk = (from: Iterable<number>): Float32Array => {
    const d = new Float32Array(land.size).fill(Infinity);
    const queue: number[] = [];
    for (const i of from) {
      d[i] = 0;
      queue.push(i);
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      for (const j of land.n4(i)) {
        if (ctx.mustSee[j] !== 1 || d[j]! <= d[i]! + 1) continue;
        d[j] = d[i]! + 1;
        queue.push(j);
      }
    }
    return d;
  };
  const passage: number[] = [];
  for (let z = main.passage.z0; z < main.passage.z1; z++) for (let x = main.passage.x0; x < main.passage.x1; x++) passage.push(land.idx(x, z));
  const squareTiles: number[] = [];
  for (let z = plan.square.z0; z < plan.square.z1; z++) for (let x = plan.square.x0; x < plan.square.x1; x++) if (ctx.mustSee[land.idx(x, z)]) squareTiles.push(land.idx(x, z));
  const fromMain = walk(passage);
  const fromSquare = walk(squareTiles);
  const at = (d: Float32Array) => (x: number, z: number) => (land.inside(x, z) ? d[land.idx(x, z)]! : Infinity);
  const placer = new Placer({
    plan,
    town,
    F,
    random: random("place"),
    mustSee: (x, z) => land.inside(x, z) && ctx.mustSee[land.idx(x, z)] === 1,
    walkMain: at(fromMain),
    walkSquare: at(fromSquare),
    main: main.inner,
    sideGates: [...plan.gates.filter((g) => g !== main).map((g) => g.inner), ...(plan.river ? [[(plan.box.x0 + plan.box.x1) / 2, plan.river.z0] as XZ] : [])],
  });
  for (const m of placer.solve(needs, options.lenient ?? false)) ctx.notes.push(`BROKEN: ${m}`);
  placer.fill(districts(plan, placer.placed, random("districts")));
  for (const p of placer.placed) {
    if (!p.b) continue;
    ctx.buildings.push(p.b);
    for (let z = p.f.z; z < p.f.z + p.f.d; z++) {
      for (let x = p.f.x; x < p.f.x + p.f.w; x++) {
        const i = land.idx(x, z);
        land.use[i] = Use.Building;
        land.flags[i] = BLOCKED | BARE;
      }
    }
    const need = p.need;
    if (need?.room) {
      const di = land.idx(p.f.door[0], p.f.door[1]);
      land.use[di] = Use.Door;
      ctx.interiors.push({ id: need.id, name: need.title, kind: need.room, town: town.id, style: town.style, exit: p.f.door, building: { w: p.f.w, d: p.f.d }, ...(need.extra ?? {}) });
      if (need.place) ctx.places.push({ kind: need.place, name: need.title, x: p.f.door[0], z: p.f.door[1] });
    }
  }

  // --- The country round it, and everything that stands about ------------------------------------------------------------
  country(ctx, fields, "roads");
  dress(ctx, placer.placed);
  country(ctx, fields, "scenery");
  levelGrounds(ctx);
  fillPockets(ctx, land.idx(main.node[0], main.node[1]));

  // --- The plan as the world keeps it, the checks ------------------------------------------------------------------------
  const graph = planGraph(plan, ctx.extraWays);
  const outline: XZ[] = [
    [box.x0, box.z0],
    [box.x1 - 1, box.z0],
    [box.x1 - 1, box.z1 - 1],
    [box.x0, box.z1 - 1],
  ];
  const squares = graph.squares;
  const townPlan: TownPlan = { outline, enclosure: F.enclosure, nodes: graph.nodes, ways: graph.ways, squares, gates: graph.gates, places: ctx.places };
  const inn = placer.placed.find((p) => p.need?.id === `${town.id}-inn`);
  const pitchPlace = ctx.places.find((p) => p.kind === "pitch");
  const centre: XZ = [Math.floor((box.x0 + box.x1 - 1) / 2), Math.floor((box.z0 + box.z1 - 1) / 2)];
  const radius = Math.ceil(Math.max(TW, TD) / 2);
  const data = {
    id: town.id,
    name: town.name,
    kind: town.kind,
    center: centre,
    radius,
    style: town.style,
    ...(spec.color ? { region: spec.color } : {}),
    start: town.start,
    ...(town.home ? { home: town.home } : {}),
    plan: townPlan,
    grounds: [0, 0, GW, GD] as [number, number, number, number],
    ways: ctx.ways,
  };
  // A broken rule fails the town; a lenient build (the preview's, for looking at what broke) says so in its notes.
  const report = check(ctx, data, graph.gates.map((g) => graph.nodes[g]!), options.lenient ?? false);

  // --- Into the world, at the grounds' place ------------------------------------------------------------------------------
  return place(target, land, ctx, data, spec.origin, inn?.f.door ?? main.inner, pitchPlace ? [pitchPlace.x, pitchPlace.z] : null, report, graph.gates.map((g) => graph.nodes[g]!));
}

/** Lays the town's ground: its lots, its streets and square, its wall's ring, its quays, the river through it. */
function paintTown(ctx: Ctx): void {
  const { land, plan, F, town } = ctx;
  const g = groundsOf(town);
  const { box } = plan;
  const tagN = ctx.spec.index + 1;
  const I = (x: number, z: number) => land.idx(x, z);
  const levelAt = (z: number): number => {
    // The row a tile's z lies in (its band or the street after it), by the levels north to south.
    for (let k = 0; k < plan.bands.length; k++) {
      const s = plan.streets[k]!;
      if (z < s.z + s.w) return plan.levels[k]!;
    }
    return plan.levels[plan.levels.length - 1]!;
  };
  for (let z = box.z0; z < box.z1; z++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = I(x, z);
      land.town[i] = tagN;
      land.decor.delete(i);
      land.flags[i] = 0;
      land.surface[i] = g.yard;
      land.use[i] = Use.Lot;
      ctx.level[i] = levelAt(z);
    }
  }
  // The ring: a wall (or hedge, or palisade) where the form has one and the sea does not take the side.
  const sideOf = (x: number, z: number): Side | null => (z === box.z0 ? "north" : z === box.z1 - 1 ? "south" : x === box.x0 ? "west" : x === box.x1 - 1 ? "east" : null);
  for (let z = box.z0; z < box.z1; z++) {
    for (let x = box.x0; x < box.x1; x++) {
      const side = sideOf(x, z);
      if (!side) continue;
      const i = I(x, z);
      if (plan.sea.has(side) || F.enclosure === "none") {
        // No wall: the town's edge is open ground (a quay's edge on the sea).
        land.surface[i] = plan.sea.has(side) ? g.street : land.surface[i]!;
        land.use[i] = plan.sea.has(side) ? Use.Street : Use.Lot;
        continue;
      }
      land.use[i] = Use.Wall;
      land.flags[i] = BLOCKED | BARE;
    }
  }
  const pave = (x: number, z: number, surface: number, use = Use.Street) => {
    if (!land.inside(x, z)) return;
    const i = I(x, z);
    land.flags[i] = 0;
    land.surface[i] = surface;
    land.use[i] = use;
    land.decor.delete(i);
    ctx.mustSee[i] = 1;
  };
  // The south band: gardens, or the quay on the sea; the north quay.
  if (plan.sea.has("south")) for (let z = plan.south.z0; z < box.z1; z++) for (let x = box.x0; x < box.x1; x++) pave(x, z, S.planks === g.street ? g.street : S.flagstones);
  if (plan.northQuay) for (let z = box.z0; z < plan.northQuay.z1; z++) for (let x = box.x0; x < box.x1; x++) pave(x, z, S.flagstones);
  for (const s of plan.streets) for (const [x0, x1] of s.runs) for (let z = s.z; z < s.z + s.w; z++) for (let x = x0; x < x1; x++) pave(x, z, s.quay ? S.flagstones : g.street);
  for (const c of plan.connectors) {
    for (let z = c.z0; z < c.z1; z++) {
      for (let x = c.x; x < c.x + c.w; x++) {
        if (!land.inside(x, z)) continue;
        // Sea-side lanes are quays.
        const quay = (plan.sea.has("west") && c.x === plan.inner.x0) || (plan.sea.has("east") && c.x + c.w === plan.inner.x1);
        pave(x, z, quay ? S.flagstones : c.kind === "artery" ? g.street : F.yards === "open" ? g.path : g.street);
      }
    }
  }
  const sq = plan.square;
  for (let z = sq.z0; z < sq.z1; z++) {
    for (let x = sq.x0; x < sq.x1; x++) {
      if (F.round && Math.hypot((x + 0.5 - (sq.x0 + sq.x1) / 2) / ((sq.x1 - sq.x0) / 2), (z + 0.5 - (sq.z0 + sq.z1) / 2) / ((sq.z1 - sq.z0) / 2)) > 1.05) {
        // Outside the round clearing's ellipse: still its streets where they run.
        if (land.use[I(x, z)] === Use.Street) continue;
      }
      pave(x, z, g.square, Use.Kept);
    }
  }
  // The street along its open south side, in front of it, paved as it is.
  const south = plan.streets[sq.a]!;
  for (let z = south.z; z < south.z + south.w; z++) for (let x = sq.x0; x < sq.x1; x++) if (land.use[I(x, z)] === Use.Street) land.surface[I(x, z)] = g.square;
  // The gates' passages: through the ring, paved.
  for (const gate of plan.gates) for (let z = gate.passage.z0; z < gate.passage.z1; z++) for (let x = gate.passage.x0; x < gate.passage.x1; x++) pave(x, z, g.street);
  // A river through the town: water under the quay, bridges where the connectors cross it.
  if (plan.river) {
    for (let z = plan.river.z0; z < plan.river.z1; z++) {
      for (let x = box.x0; x < box.x1; x++) {
        const i = I(x, z);
        const bridge = land.use[i] === Use.Street;
        land.surface[i] = S.stream;
        land.flags[i] = bridge ? 0 : BLOCKED;
        if (!bridge) {
          land.use[i] = Use.Wild;
          ctx.mustSee[i] = 0;
        }
      }
    }
  }
}

/** Shifts everything into the world at the grounds' origin and writes the grounds into the Land. */
function place(target: Land, land: Land, ctx: Ctx, data: BuiltTown["data"], origin: XZ, innDoor: XZ, pitch: XZ | null, report: BuiltTown["report"], gateNodes: XZ[]): BuiltTown {
  const [ox, oz] = origin;
  if (!target.inside(ox, oz) || !target.inside(ox + land.width - 1, oz + land.depth - 1)) throw new Error(`${ctx.town.id}: its grounds at ${ox},${oz} reach past the world`);
  const tagN = ctx.spec.index + 1;
  for (let z = 0; z < land.depth; z++) {
    for (let x = 0; x < land.width; x++) {
      const i = land.idx(x, z);
      const j = target.idx(ox + x, oz + z);
      target.height[j] = land.height[i]!;
      target.surface[j] = land.surface[i]!;
      target.flags[j] = land.flags[i]!;
      target.use[j] = land.use[i]!;
      target.town[j] = land.town[i] ? tagN : 0;
      target.townArea[j] = 1;
      target.region[j] = target.region[j]!;
      target.decor.delete(j);
    }
  }
  const shiftProp = (p: PropData): PropData => {
    const to = p.args?.to;
    const args = Array.isArray(to) ? { ...p.args, to: [(to[0] as number) + ox, (to[1] as number) + oz] } : p.args;
    return { ...p, x: p.x + ox, z: p.z + oz, ...(args ? { args } : {}) };
  };
  for (const [i, p] of land.decor) target.decor.set(target.idx(ox + land.xOf(i), oz + land.zOf(i)), shiftProp(p));
  for (const p of land.fixtures) target.fixtures.push(shiftProp(p));
  if (land.levelled) target.levelled = true;
  const sxz = (p: XZ): XZ => [p[0] + ox, p[1] + oz];
  const buildings = ctx.buildings.map((b) => ({ ...b, x: b.x + ox, z: b.z + oz, ...(b.door ? { door: sxz(b.door) } : {}) }));
  const interiors = ctx.interiors.map((r) => ({ ...r, exit: sxz(r.exit) as [number, number] }));
  const npcs = ctx.npcs.map((n) => {
    const b = n.behaviour;
    const behaviour = b ? { ...b, ...(b.wander ? { wander: { ...b.wander, home: sxz(b.wander.home) } } : {}), ...(b.beat ? { beat: { ...b.beat, stops: b.beat.stops.map(sxz) } } : {}) } : undefined;
    return { ...n, x: n.x + ox, z: n.z + oz, ...(n.stand ? { stand: [n.stand[0] + ox, n.stand[1], n.stand[2] + oz] as const } : {}), ...(behaviour ? { behaviour } : {}) };
  });
  const p = data.plan!;
  const plan: TownPlan = {
    outline: p.outline.map(sxz),
    enclosure: p.enclosure,
    nodes: p.nodes.map(sxz),
    ways: p.ways.map((w) => ({ ...w, ...(w.via ? { via: w.via.map(sxz) } : {}) })),
    squares: p.squares.map((s) => ({ ...s, x: s.x + ox, z: s.z + oz })),
    gates: p.gates,
    places: p.places.map((q) => ({ ...q, x: q.x + ox, z: q.z + oz })),
  };
  const ways = data.ways.map((w) => ({ ...w, inside: sxz(w.inside), exit: w.exit.map(sxz) }));
  const gates = new Map<string, number>();
  gateNodes.forEach((g, k) => gates.set(`gate-${k + 1}`, target.idx(g[0] + ox, g[1] + oz)));
  return {
    data: { ...data, center: sxz(data.center), plan, grounds: [ox, oz, ox + land.width, oz + land.depth], ways },
    buildings,
    interiors,
    npcs,
    gates,
    inn: { x: innDoor[0] + ox, z: innDoor[1] + oz, interior: `${ctx.town.id}-inn` },
    pitch: pitch ? { x: pitch[0] + ox, z: pitch[1] + oz } : null,
    report,
  };
}

export { formOf };
