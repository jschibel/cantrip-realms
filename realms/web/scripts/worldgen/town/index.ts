// A town and its grounds at walking scale (design.md A6 "Towns"; tech.md B5 "Dominaria as generated": Towns): one call
// lays a town's whole pocket into the Land - its terrain, the town within its walls, the country round it that is
// walked, and the apron of scenery past that - and says what it built. The integrator places the pocket (`origin`) and
// fills what lies on the travel map (the town's `site`, each way's `outside`).
//
// The steps, each its own module: the site's fields (site.ts: the land's height, the sea, the river); the plan, by the
// planner of the town's form (planner.ts, the seam: rows.ts's rows facing south onto their streets for the capital, the
// cities, the campus and the estate); the program and its solver (place.ts: every place the town needs landed where it
// serves best, no building hiding a street from the camera); the country (roads out from the gates by weighted A*,
// fields, farms, woods, the walked ground's closed edge and the apron); the dressing (dress.ts: walls, gardens, the
// square's furniture, lights, the harbour, and the people); the terraces and their ramps; and the checks (check.ts),
// which fail the town when a rule of its design breaks.

import type { BuildingData, NpcData, PropData, TownPlace, TownPlan, XZ } from "../../../src/world/format";
import { BARE, BLOCKED } from "../../../src/world/format";
import { Land, Use, noise, randomFor } from "../land";
import type { Form, TownLayout } from "../layout";
import { check, closeOnlyWhatIsDrawn, fillPockets } from "./check";
import { dress } from "./dress";
import { type FormSpec, TOWN_SIZE, formOf, formSpec } from "./forms";
import { civicDepth, districts, Placer, programOf } from "./place";
import type { Box, ExtraWay, Plan, Planner } from "./planner";
import { ROWS } from "./rows";
import { grown } from "./amphitheatre";
import { country } from "./country";
import { normalize, passages } from "./passages";
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

/** The planner of each form (planner.ts). */
export const PLANNERS: Readonly<Record<Form, Planner>> = {
  capital: grown("capital"),
  city: grown("city"),
  campus: grown("campus"),
  estate: grown("estate"),
  village: grown("village"),
  elfhame: grown("elfhame"),
  clan: grown("clan"),
  stilts: grown("stilts"),
};

/** Everything the steps share. */
export interface Ctx {
  readonly spec: TownSpec;
  readonly town: TownLayout;
  readonly F: FormSpec;
  readonly land: Land;
  readonly planner: Planner;
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
  /** The town's tiles: within its outline (1), and the ring its wall or edge stands on (2). */
  readonly inTown: Uint8Array;
  /** The country walked round it (country.ts fills it). */
  readonly walked: Uint8Array;
  readonly ways: TownWay[];
  /** Extra ways of the street plan (a harbour's quay, the gates' roads), for the graph. */
  readonly extraWays: ExtraWay[];
  readonly notes: string[];
  readonly random: (part: string) => () => number;
}

/** Lays the whole grounds (its terrain, the town, the country round it, the apron) into the Land at `origin`. */
export function buildTown(target: Land, spec: TownSpec, seed: number, options: { readonly lenient?: boolean } = {}): BuiltTown {
  validate(spec);
  // The town's shape as designed first; where its places will not all fit or a rule breaks, the same town drawn fuller
  // (its rows pulled in less), then with rows as deep as its great buildings need - a fixed sequence, the same every
  // time, never a search over seeds - and last with a bigger built area, as far as its grounds allow.
  const attempts: { scale: number; deep: boolean; grow?: number }[] = [
    { scale: 1, deep: false },
    { scale: 0.6, deep: false },
    { scale: 0.3, deep: false },
    { scale: 0, deep: false },
    { scale: 1, deep: true },
    { scale: 0.3, deep: true },
    { scale: 0, deep: true },
    { scale: 0, deep: true, grow: 6 },
    { scale: 0, deep: true, grow: 12 },
    { scale: 0.3, deep: false, grow: 6 },
    { scale: 0, deep: false, grow: 12 },
  ];
  const errors: string[] = [];
  for (let k = Number(process.env.TOWN_ATTEMPT ?? 0); ; k++) {
    try {
      return buildOnce(target, spec, seed, options, attempts[k]!.scale, attempts[k]!.deep, attempts[k]!.grow ?? 0);
    } catch (e) {
      if (options.lenient) throw e;
      errors.push((e as Error).message);
      if (k === attempts.length - 1) throw new Error(`${spec.plan.id} cannot be laid out on ${JSON.stringify(spec.setting)}; the first and the last tries broke on:\n${errors[0]}\n${errors[errors.length - 1]}`);
    }
  }
}

/** A setting the town generator cannot honour: no way, a way out over the sea, a river past a side that is sea. */
function validate(spec: TownSpec): void {
  const s = spec.setting;
  const id = spec.plan.id;
  if (s.ways.length === 0) throw new Error(`${id}: a setting with no way out (TownSetting.ways is empty)`);
  for (const w of s.ways) if (s.sea.includes(w.side)) throw new Error(`${id}: a way out on its ${w.side} side, which is sea`);
  if (s.river && s.river !== "through" && s.sea.includes(s.river)) throw new Error(`${id}: a river past its ${s.river} side, which is sea`);
  if (s.sea.length >= 4) throw new Error(`${id}: the sea on every side`);
  if (!(s.relief >= 0 && s.relief <= 1)) throw new Error(`${id}: relief ${s.relief}, not 0 to 1`);
}

function buildOnce(target: Land, spec: TownSpec, seed: number, options: { readonly lenient?: boolean }, scale: number, deep: boolean, grow: number): BuiltTown {
  const town = spec.plan;
  const F = formSpec(town);
  const [GW, GD] = groundsSize(town);
  // The box it grows in: its kind's, or bigger by `grow` each way, leaving the walked country and the apron room.
  const [GW0, GD0] = groundsSize(town);
  const most = (g: number, t: number) => Math.min(t + 2 * grow, g - 2 * (APRON + 10));
  // A grown town (planner.ts: an elfhame, a clan hold, a village, the stilts) grows from its centre over more of its
  // grounds than a town of rows fills: what it does not build on is its woods and yards.
  const grownBox = PLANNERS[formOf(town)] !== ROWS ? (town.kind === "village" ? (formOf(town) === "clan" ? 16 : 10) : 12) : 0;
  const TW = most(GW0, TOWN_SIZE[town.kind][0] + grownBox);
  const TD = most(GD0, TOWN_SIZE[town.kind][1] + grownBox);
  const land = new Land(GW, GD);
  const tag = `${seed}:town:${town.id}`;
  const random = (part: string) => randomFor(seed, `town:${town.id}:${part}`);
  const box: Box = { x0: Math.floor((GW - TW) / 2), z0: Math.floor((GD - TD) / 2), x1: Math.floor((GW - TW) / 2) + TW, z1: Math.floor((GD - TD) / 2) + TD };
  const rise = town.kind === "capital" ? 3 : town.kind === "town" ? 2.4 : 1.6;
  const fields = fieldsOf(GW, GD, box, spec.setting, tag, rise);
  const { needs, sites } = programOf(town, spec.vendors, spec.exotic);
  const planner = PLANNERS[formOf(town)];
  const plan = planner.plan({
    box,
    F,
    ways: spec.setting.ways,
    sea: new Set(spec.setting.sea),
    river: spec.setting.river,
    height: fields.height,
    sites,
    civic: civicDepth(town, needs, sites),
    shape: { profile: F.shape[0], most: F.shape[1], scale, noise: noise(`:shape`, 1.3) },
    random: random("plan"),
    gateWidth: F.street,
    id: town.id,
    town,
    needs,
    setting: spec.setting,
    fields,
    tag,
    deep,
  });
  const ctx: Ctx = {
    spec,
    town,
    F,
    land,
    planner,
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
    river: plan.water ? new Set(plan.water) : riverTiles(fields, plan, tag),
    inTown: new Uint8Array(land.size),
    walked: new Uint8Array(land.size),
    ways: [],
    extraWays: [],
    notes: [],
    random,
  };

  if (scale < 1) ctx.notes.push(`its shape drawn at ${scale} of its pull, to find room for its places`);
  if (deep) ctx.notes.push("its rows as deep as its great buildings, to find room for its places");
  if (grow > 0) ctx.notes.push(`its built area ${TW} by ${TD}, to find room for its places`);
  // --- The ground: the country, the sea and the river, then the town over it ----------------------------------------
  country(ctx, fields, "ground");
  planner.paint(ctx);

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
    mainToSquare: Math.min(...squareTiles.map((i) => fromMain[i]!)),
    main: main.inner,
    sideGates: [...plan.gates.filter((g) => g !== main).map((g) => g.inner), ...(plan.river ? [[(plan.box.x0 + plan.box.x1) / 2, plan.river.z0] as XZ] : [])],
  });
  for (const m of placer.solve(needs, options.lenient ?? false)) ctx.notes.push(`BROKEN: ${m}`);
  // Footpaths through the yards where a walk between the places (or from a gate) is the long way round; kept clear of
  // what the rest of the rows build.
  const points = [
    ...plan.gates.map((g) => ({ at: [Math.floor((g.passage.x0 + g.passage.x1 - 1) / 2), Math.floor((g.passage.z0 + g.passage.z1 - 1) / 2)] as XZ, gate: true })),
    ...placer.placed.flatMap((p) => [...(p.need?.room ? [{ at: p.f.door, gate: false }] : []), ...(p.spot ? [{ at: p.spot, gate: false }] : [])]),
  ];
  const cut = passages(ctx, placer.placed, points);
  if (cut > 0) placer.reserve((x, z) => land.inside(x, z) && ctx.mustSee[land.idx(x, z)] === 1);
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
  closeOnlyWhatIsDrawn(ctx, land.idx(main.node[0], main.node[1]));

  // --- The plan as the world keeps it, the checks ------------------------------------------------------------------------
  const graph = normalize(planner.graph(plan, ctx.extraWays), ctx.extraWays.flatMap((e) => [e.a, e.b]));
  // The outline its wall (or edge) runs along: traced round the ring it stands on.
  const outline = traceOutline((x, z) => land.inside(x, z) && ctx.inTown[land.idx(x, z)] !== 0, { x0: box.x0 - 1, z0: box.z0 - 1, x1: box.x1 + 1, z1: box.z1 + 1 });
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

/**
 * The outline of a region of tiles, traced: its boundary's corners in order round it (tile corners, clockwise from its
 * north-west), each straight run between two corners along x or z.
 */
export function traceOutline(inside: (x: number, z: number) => boolean, box: Box): XZ[] {
  const next = new Map<string, XZ[]>();
  const add = (a: XZ, b: XZ) => {
    const k = `${a[0]},${a[1]}`;
    const list = next.get(k);
    if (list) list.push(b);
    else next.set(k, [b]);
  };
  let start: XZ | null = null;
  for (let z = box.z0; z < box.z1; z++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (!inside(x, z)) continue;
      start ??= [x, z];
      if (!inside(x, z - 1)) add([x, z], [x + 1, z]);
      if (!inside(x + 1, z)) add([x + 1, z], [x + 1, z + 1]);
      if (!inside(x, z + 1)) add([x + 1, z + 1], [x, z + 1]);
      if (!inside(x - 1, z)) add([x, z + 1], [x, z]);
    }
  }
  if (!start) return [];
  const pts: XZ[] = [start];
  let at: XZ = start;
  let dir: XZ = [1, 0];
  for (let guard = 0; guard < 100000; guard++) {
    const options = next.get(`${at[0]},${at[1]}`) ?? [];
    // At a pinch, the sharpest right turn first, so the trace keeps to one loop.
    const turn = (b: XZ) => {
      const d: XZ = [b[0] - at[0], b[1] - at[1]];
      const cross = dir[0] * d[1] - dir[1] * d[0];
      return cross > 0 ? 0 : cross === 0 ? 1 : 2;
    };
    const b = [...options].sort((p, q) => turn(p) - turn(q))[0];
    if (!b) break;
    options.splice(options.indexOf(b), 1);
    dir = [b[0] - at[0], b[1] - at[1]];
    at = b;
    if (at[0] === start[0] && at[1] === start[1]) break;
    pts.push(at);
  }
  // Only the corners.
  return pts.filter((p, k) => {
    const a = pts[(k + pts.length - 1) % pts.length]!;
    const c = pts[(k + 1) % pts.length]!;
    return !((a[0] === p[0] && p[0] === c[0]) || (a[1] === p[1] && p[1] === c[1]));
  });
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
