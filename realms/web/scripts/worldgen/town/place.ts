// What a town is for, and where each thing goes. The places a player uses - the inn, the shops, the exotic wares, the
// temple or shrine, the guild, the library or mage's tower, the smithy, the houses with a door, the arena - are a list a
// small solver lands on the rows' frontages (planner.ts; rows.ts): every candidate spot along every block's front scored for what
// that place wants (the shops on the square or a block off it, the inn by the main gate, the temple commanding the
// square from its north, the smithy by a side gate or the water, the houses spread through the quiet rows), each place
// taken in turn from the hardest to land, the best spot kept and the next tried when a later place finds no room
// (greedy with backtracking). Every building faces south onto its street, and is made no taller than its yard lets it be:
// what it hides (view.ts) must fall on no street. Then the districts grow from seeds - the market at the square, the
// temple's close, the keep, the nobles' houses, the artisans by the smithy, the harbour, homes - each block taking the
// nearest by weighted distance, and fill the rest of the frontages their own way: terraced houses by the square, houses
// with gardens in the quiet rows, warehouses on the quay, a garden left open here and there.

import { fnv1a32, mulberry32 } from "../../../src/random";
import type { BuildingData, InteriorKind, PlaceKind, XZ } from "../../../src/world/format";
import type { TownLayout } from "../layout";
import { type Footprint, makeBuilding, southFacing } from "./buildings";
import { type FormSpec, type Role, formOf, kindFor, sizesFor, styleFor } from "./forms";
import type { Block, Plan, SiteRequest } from "./planner";
import type { InteriorSpec, TownVendor } from "./types";
import { buildingHides } from "./view";

/** A place the town must have. */
export interface Need {
  readonly id: string;
  readonly role: Role | "arena";
  readonly title: string;
  readonly room?: InteriorKind;
  readonly place?: PlaceKind;
  readonly extra?: Partial<InteriorSpec>;
}

/** The town's program: what it must hold, the landmarks' ground first. */
export function programOf(plan: TownLayout, vendors: readonly TownVendor[], exotic: TownVendor | null): { needs: Need[]; sites: SiteRequest[] } {
  const form = formOf(plan);
  const village = plan.kind === "village";
  const the = plan.name.startsWith("The ") ? plan.name : `The ${plan.name}`;
  const needs: Need[] = [];
  const sites: SiteRequest[] = [];
  // A great church commands the square from its north, its churchyard behind it, across two rows; then the keep or the
  // manor at the town's north edge.
  if (form === "capital") sites.push({ id: `${plan.id}-temple`, w: 21, rows: 2, where: "square" });
  else if (form === "elfhame" && !village) {
    // Llanowar's Grove of Gaea stands high among its trees: it takes the ground of two rows, its grove behind it.
    const [w, d] = sizesFor(styleFor(plan, "temple"), "temple")[0]!;
    sites.push({ id: `${plan.id}-temple`, w: w + 4, rows: 2, where: "square", d });
  }
  if (form === "capital") sites.push({ id: `${plan.id}-citadel`, w: 26, rows: 2, where: "north" });
  if (form === "city") sites.push({ id: `${plan.id}-keep`, w: 22, rows: 1, where: "north" });
  if (form === "estate") sites.push({ id: `${plan.id}-manor`, w: 34, rows: 2, where: "north" });
  needs.push({ id: `${plan.id}-temple`, role: village ? "shrine" : "temple", title: village ? `${the} Shrine` : plan.temple, room: "temple", place: village ? "shrine" : "temple", extra: { resident: village ? { name: "Hermit", text: ["The road is long. Sit, and let it wait for you."] } : { name: "Priest", text: ["Rest a while. The wells of Dominaria remember the faithful."] } } });
  if (village) {
    // A village's shrine keeps its own id.
    needs[needs.length - 1] = { ...needs[needs.length - 1]!, id: `${plan.id}-shrine` };
  }
  needs.push({ id: `${plan.id}-inn`, role: "inn", title: plan.inn, room: "inn", place: "inn", extra: { innkeeper: { name: `The keeper of ${plan.inn}`, text: plan.innkeeper }, spellTable: true } });
  if (!village) {
    needs.push({ id: `${plan.id}-guildhall`, role: "guildhall", title: plan.guild, room: "guildhall", place: "guildhall", extra: { spellTable: true, resident: { name: "Guild master", text: ["Our tables are open to any mage. Build your deck in peace."] } } });
    const tower = plan.style === "tolarian";
    needs.push({
      id: `${plan.id}-${tower ? "tower" : "library"}`,
      role: tower ? "tower" : "library",
      title: tower ? `${the} Mage's Tower` : `${the} Library`,
      room: tower ? "tower" : "library",
      place: tower ? "tower" : "library",
      extra: { resident: { name: tower ? "Archmage" : "Librarian", text: ["Every card ever printed is written down somewhere. Most of them here."] } },
    });
    needs.push({ id: `${plan.id}-smithy`, role: "smithy", title: `${the} Smithy`, room: "smithy", place: "smithy", extra: { armorer: true } });
  }
  if (exotic) needs.push({ id: `${exotic.id}-shop`, role: "exotic", title: exotic.name, room: "exotic-wares", place: "exotic-wares", extra: { vendor: exotic } });
  for (const v of vendors) needs.push({ id: `${v.id}-shop`, role: "shop", title: v.name, room: "shop", place: "shop", extra: { vendor: v } });
  if (!village) needs.push({ id: `${plan.id}-arena`, role: "arena", title: "The arena", place: "arena" });
  const homes = form === "capital" ? 10 : village ? 3 : 6;
  for (let n = 1; n <= homes; n++) {
    const folk = plan.folk[(n - 1) % Math.max(1, plan.folk.length)];
    needs.push({ id: `${plan.id}-house-${n}`, role: "home", title: `A house in ${plan.name}`, room: "house", extra: n <= plan.folk.length && folk ? { resident: folk } : {} });
  }
  if (form === "capital") for (let n = 1; n <= 7; n++) needs.push({ id: `${plan.id}-manor-${n}`, role: "manor", title: `A manor of the Seven Houses` });
  return { needs, sites };
}

/**
 * What the row fronting the square from the north must hold: the deepest of the town's great places (its temple, inn,
 * guild, library or tower - those without ground of their own), and that depth with the ground it hides behind it.
 */
export function civicDepth(plan: TownLayout, needs: readonly Need[], sites: readonly SiteRequest[]): [number, number] {
  let depth = 0;
  let behind = 0;
  for (const need of needs) {
    if (!["temple", "shrine", "inn", "guildhall", "library", "tower"].includes(need.role) || sites.some((s) => s.id === need.id)) continue;
    const role = need.role as Role;
    const style = styleFor(plan, role);
    const [w, d] = sizesFor(style, role, formOf(plan) === "capital")[0]!;
    const b = makeBuilding("measure", style, kindFor(style, role), { x: 0, z: 0, w, d, rot: 0, door: [Math.floor(w / 2), d] }, () => 0.5, { storeys: 2, params: role === "tower" ? { floors: 3 } : {} });
    const hides = Math.max(0, ...buildingHides(b, 0).map(([, z]) => -z));
    depth = Math.max(depth, d);
    behind = Math.max(behind, d + hides);
  }
  return [depth, behind];
}

/** A building placed, and what it is for. */
export interface Placed {
  readonly need?: Need;
  readonly role: Role | "arena";
  readonly f: Footprint;
  readonly b: BuildingData | null;
  readonly block: Block;
  /** The quest board's tile beside the inn, the arena's gate. */
  readonly spot?: XZ;
}

export interface PlaceContext {
  readonly plan: Plan;
  readonly town: TownLayout;
  readonly F: FormSpec;
  readonly random: () => number;
  /** Whether a tile must stay in sight: a street, a square, a door. */
  readonly mustSee: (x: number, z: number) => boolean;
  /** The main gate's junction inside. */
  readonly main: XZ;
  /** The walk along the streets from the main gate, and from the square, to a street tile (Infinity off the streets). */
  readonly walkMain: (x: number, z: number) => number;
  readonly walkSquare: (x: number, z: number) => number;
  /** The walk from the main gate to the square's nearest tile. */
  readonly mainToSquare: number;
  /** Other gates' junctions, and the water's edge (the quay), for the artisans. */
  readonly sideGates: readonly XZ[];
}

/** The front street tile row of a block: its south edge's street. */
const frontZ = (b: Block) => b.z1;

/** The walk from a tile to the square along the streets, near enough: across, then along. */
function toSquare(plan: Plan, x: number, z: number): number {
  const s = plan.square;
  const dx = x < s.x0 ? s.x0 - x : x >= s.x1 ? x - s.x1 + 1 : 0;
  const dz = z < s.z0 ? s.z0 - z : z >= s.z1 ? z - s.z1 + 1 : 0;
  return dx + dz;
}

const manhattan = (a: XZ, b: XZ) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** A candidate spot: a footprint on a block's front, scored. */
interface Spot {
  readonly f: Footprint;
  readonly block: Block;
  readonly score: number;
  readonly storeys: 1 | 2;
  readonly spot?: XZ;
}

export class Placer {
  readonly placed: Placed[] = [];
  /** Tiles taken along each block's front, by block: [x0, x1) intervals, buildings and their gaps. */
  private readonly taken = new Map<Block, [number, number][]>();
  private count = 0;

  constructor(readonly c: PlaceContext) {}

  private free(block: Block, x0: number, x1: number, gap: number): boolean {
    if (x0 < block.x0 || x1 > block.x1) return false;
    for (const [a, b] of this.taken.get(block) ?? []) if (x0 < b + gap && x1 + gap > a) return false;
    return true;
  }

  private take(block: Block, x0: number, x1: number): void {
    let list = this.taken.get(block);
    if (!list) this.taken.set(block, (list = []));
    list.push([x0, x1]);
  }

  /** Keeps the columns of a block that a way crosses (a footpath through its yards) from being built on. */
  reserve(isWay: (x: number, z: number) => boolean): void {
    for (const block of this.c.plan.blocks) {
      for (let x = block.x0; x < block.x1; x++) {
        let crossed = false;
        for (let z = block.z0; z < block.z1 && !crossed; z++) crossed = isWay(x, z);
        if (crossed) this.take(block, x, x + 1);
      }
    }
  }

  /** The frontages still free along a block, as [x0, x1) runs. */
  freeRuns(block: Block): [number, number][] {
    const list = [...(this.taken.get(block) ?? [])].sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let at = block.x0;
    for (const [a, b] of list) {
      if (a > at) out.push([at, a]);
      at = Math.max(at, b);
    }
    if (at < block.x1) out.push([at, block.x1]);
    return out;
  }

  /** Whether a building stands where it hides no street, square or door from the camera looking north. */
  private seen(b: BuildingData): boolean {
    for (const [x, z] of buildingHides(b, 0)) if (this.c.mustSee(x, z)) return false;
    return true;
  }

  /** The style and kind a role is built in here. */
  styleKind(role: Role): { style: string; kind: string } {
    const style = styleFor(this.c.town, role);
    return { style, kind: kindFor(style, role) };
  }

  /**
   * The building a role would be on a footprint: what is measured for the camera is what is built. Its choices (roof,
   * chimney, heights) come from a random of its own id and footprint, so trying it costs the town's random nothing.
   */
  private trial(id: string, role: Role, f: Footprint, storeys: 1 | 2, need?: Need): BuildingData {
    const { style, kind } = this.styleKind(role);
    const random = mulberry32(fnv1a32(`${this.c.town.id}:${id}:${f.x},${f.z},${f.w},${f.d}`));
    return makeBuilding(id, style, kind, f, random, {
      storeys,
      params: this.extraParams(role),
      ...(need?.room ? { interior: need.id, sign: need.title } : {}),
      ...(role === "manor" ? { grand: true } : {}),
    });
  }

  extraParams(role: Role | "arena"): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (this.c.F.yards === "bog") out.stilts = 1.2;
    if (role === "tower") out.floors = 3;
    return out;
  }

  /** Every spot a need could take along the blocks' fronts, scored for what it wants. */
  private spots(need: Need): Spot[] {
    const { plan } = this.c;
    const out: Spot[] = [];
    const role = need.role;
    const capital = formOf(this.c.town) === "capital";
    const sizes: readonly (readonly [number, number])[] = role === "arena" ? [[12, 8], [11, 7], [10, 7]] : sizesFor(this.styleKind(role).style, role, capital);
    // A landmark's ground made for this need is its own block; nobody else's.
    const own = plan.sites.filter((s) => s.id === need.id).map((s): Block => ({ k: s.k1, x0: s.box.x0, x1: s.box.x1, z0: s.box.z0, z1: s.box.z1, west: "street", east: "street" }));
    for (const block of own.length > 0 ? own : plan.blocks) {
      const depth = block.z1 - block.z0;
      const fz = frontZ(block);
      for (let si = 0; si < sizes.length; si++) {
        const [w, d] = sizes[si]!;
        if (d > depth - 1) continue;
        // The inn keeps two tiles beside it for the quest board.
        const side = role === "inn" ? 2 : 0;
        // Shops stand shoulder to shoulder, as a market's do; the rest a garden's width apart.
        const gap = role === "shop" || role === "exotic" ? 0 : 1;
        for (let x = block.x0; x + w + side <= block.x1; x++) {
          if (!this.free(block, x, x + w + side, gap)) continue;
          const door: XZ = [x + Math.floor(w / 2), fz];
          const f = southFacing(door, w, d);
          const score = this.score(need, block, f, si);
          if (score === null) continue;
          out.push({ f, block, score, storeys: 2, ...(role === "inn" ? { spot: [x + w, fz - 1] as XZ } : role === "arena" ? { spot: [door[0], fz - 1] as XZ } : {}) });
        }
      }
    }
    out.sort((p, q) => p.score - q.score || p.f.x - q.f.x || p.f.z - q.f.z);
    return out;
  }

  /** How well a spot suits a need (lower better), or null where it may not stand. */
  private score(need: Need, block: Block, f: Footprint, sizeIndex: number): number | null {
    const { plan } = this.c;
    const door = f.door;
    const onSquare = toSquare(plan, door[0], door[1]) === 0;
    const sq = this.c.walkSquare(door[0], door[1]);
    if (!Number.isFinite(sq)) return null;
    const centreX = (plan.square.x0 + plan.square.x1) / 2;
    const northness = block.k;
    // A door near the end of its block is near a way round it: walks between the town's places stay short.
    const toEnd = Math.min(door[0] - block.x0, block.x1 - 1 - door[0]);
    let s = sizeIndex * 3 + (need.role === "home" || need.role === "manor" ? 0 : toEnd * 0.25);
    // A grown town's lot was laid for one of its needs: another may take it, but dearly.
    const meant = (block as { meant?: string }).meant;
    if (meant && meant !== need.id) s += 25;
    // How far from the square a place may be at the most (check.ts holds every place to it); each role's own reach is
    // what it wants, and past it a spot is dearer.
    const most = this.c.town.kind === "capital" ? 46 : this.c.town.kind === "town" ? 34 : 21;
    const within = (want: number): boolean => {
      if (sq > most) return false;
      s += Math.max(0, sq - want) * 4;
      return true;
    };
    switch (need.role) {
      case "temple":
        // On the square or by it; further only where the square's north is a landmark's (the estate's manor).
        s += sq * 2 + Math.max(0, sq - 14) * 8 + Math.abs(door[0] - centreX) * 0.6 + northness * 2 + (onSquare ? 0 : 10);
        break;
      case "shrine":
        s += sq * 1.5 + Math.abs(door[0] - centreX) * 0.5 + (onSquare ? 0 : 6);
        break;
      case "guildhall":
        if (!within(24)) return null;
        s += sq * 1.6 + (onSquare ? 0 : 4);
        break;
      case "inn":
        if (!within(30)) return null;
        // By the way in: no further from the main gate than a little past the square (check.ts holds it to that).
        s += this.c.walkMain(door[0], door[1]) * 1.4 + Math.max(0, this.c.walkMain(door[0], door[1]) - this.c.mainToSquare - 12) * 20 + sq * 0.8 + (onSquare ? -4 : 0);
        break;
      case "shop":
      case "exotic":
        if (!within(28)) return null;
        s += sq * 2 + (onSquare ? -6 : 0) + Math.abs(door[0] - centreX) * 0.1;
        break;
      case "library":
      case "tower":
        if (!within(32)) return null;
        s += sq * 1.2 + northness * 3;
        break;
      case "smithy": {
        if (!within(36)) return null;
        const side = Math.min(...this.c.sideGates.map((g) => manhattan(g, door)), 80);
        s += side * 0.8 + sq * 0.6 + (onSquare ? 8 : 0);
        break;
      }
      case "arena":
        if (sq > 70) return null;
        s += Math.max(0, sq - 40) * 3;
        s += sq * 0.7 + (onSquare ? 30 : 0) + Math.min(...this.placed.filter((p) => p.role === "inn").map((p) => Math.abs(p.f.door[0] - door[0]) + Math.abs(p.f.door[1] - door[1])), 40) * 0.3;
        break;
      case "home": {
        // In the quiet rows, a walk from the square, apart from each other (on a village's green if it must).
        if (onSquare && this.c.town.kind !== "village") return null;
        if (sq > 90) return null;
        if (onSquare) s += 15;
        const near = this.placed.filter((p) => p.role === "home").map((p) => manhattan(p.f.door, door));
        s += Math.abs(sq - 22) * 0.4 + near.reduce((t, d) => t + Math.max(0, 24 - d) * 1.5, 0) + this.c.random() * 4;
        break;
      }
      case "manor": {
        if (onSquare) return null;
        const keep = plan.sites[0];
        const at: XZ = keep ? [(keep.box.x0 + keep.box.x1) / 2, keep.box.z1] : [centreX, plan.box.z0];
        const near = this.placed.filter((p) => p.role === "manor").map((p) => manhattan(p.f.door, door));
        s += manhattan(at, door) * 0.5 + northness * 4 + near.reduce((t, d) => t + Math.max(0, 16 - d), 0);
        break;
      }
      default:
        s += sq;
    }
    return s;
  }

  /** Lands every need, hardest first, keeping the best spot and backtracking when a later one finds none. */
  solve(needs: readonly Need[], lenient = false): string[] {
    const rank = (n: Need) => (n.role === "temple" || n.role === "shrine" ? 0 : n.role === "inn" ? 1 : n.role === "guildhall" ? 2 : n.role === "library" || n.role === "tower" ? 3 : n.role === "exotic" ? 4 : n.role === "shop" ? 5 : n.role === "smithy" ? 6 : n.role === "arena" ? 7 : n.role === "home" ? 8 : 9);
    const order = [...needs].sort((a, b) => rank(a) - rank(b));
    const tried = new Map<number, number>();
    let i = 0;
    let budget = 3000;
    const stack: Placed[] = [];
    if (lenient) {
      // Each need where it best fits, or nowhere (said so): for looking at a town that does not fit yet.
      const missing: string[] = [];
      for (const need of order) {
        const found = this.firstFitting(need, 0);
        if (found) this.commit(need, found.spot, found.b);
        else missing.push(`no room for ${need.id} (${this.why(need)})`);
      }
      return missing;
    }
    const fails = new Map<number, number>();
    const hardest = () => {
      const k = [...fails].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0]?.[0] ?? i;
      return `${order[k]!.id} (${this.why(order[k]!)})`;
    };
    while (i < order.length) {
      if (--budget < 0) throw new Error(`${this.c.town.id}: no room for ${hardest()}`);
      const need = order[i]!;
      const skip = tried.get(i) ?? 0;
      const found = this.firstFitting(need, skip);
      if (found) {
        tried.set(i, found.index + 1);
        stack.push(this.commit(need, found.spot, found.b));
        i++;
        continue;
      }
      // None: back up a step, and try the one before at its next spot.
      fails.set(i, (fails.get(i) ?? 0) + 1);
      tried.delete(i);
      if (i === 0) throw new Error(`${this.c.town.id}: no room for ${hardest()}`);
      i--;
      this.undo(stack.pop()!);
    }
    return [];
  }

  /** Why a need finds no spot: how many there were, and what the best of them hides. */
  private why(need: Need): string {
    const spots = this.spots(need);
    const { plan } = this.c;
    const rows = plan.blocks.map((b) => `${b.x0},${b.z0}-${b.x1},${b.z1}`).join(" ");
    const sites = plan.sites.map((s) => `${s.id} ${s.box.x0},${s.box.z0}-${s.box.x1},${s.box.z1}`).join("; ");
    if (spots.length === 0) return `no spot at all; blocks ${rows}; sites ${sites}`;
    const s = spots[0]!;
    const hidden = buildingHides(this.trial(need.id, need.role as Role, s.f, 1, need), 0).filter(([x, z]) => this.c.mustSee(x, z));
    return `${spots.length} spots, the best at ${s.f.x},${s.f.z} ${s.f.w}x${s.f.d} hides ${hidden.length} street tiles (${hidden.slice(0, 3).join(" ")}); blocks ${rows}; sites ${sites}`;
  }

  /** The best spot after the first `skip` that takes the building without hiding a street, at the most storeys it can. */
  private firstFitting(need: Need, skip: number): { spot: Spot; index: number; b: BuildingData | null } | null {
    const spots = this.spots(need);
    for (let k = skip; k < spots.length && k < skip + 400; k++) {
      const s = spots[k]!;
      if (need.role === "arena") return { spot: s, index: k, b: null };
      for (const storeys of [2, 1] as const) {
        const b = this.trial(need.id, need.role, s.f, storeys, need);
        if (this.seen(b)) return { spot: s, index: k, b };
      }
    }
    return null;
  }

  private commit(need: Need, s: Spot, b: BuildingData | null): Placed {
    const role = need.role;
    const side = role === "inn" ? 2 : 0;
    this.take(s.block, s.f.x, s.f.x + s.f.w + side);
    const p: Placed = { need, role, f: s.f, b, block: s.block, ...(s.spot ? { spot: s.spot } : {}) };
    this.placed.push(p);
    return p;
  }

  private undo(p: Placed): void {
    this.placed.splice(this.placed.indexOf(p), 1);
    const list = this.taken.get(p.block)!;
    const side = p.role === "inn" ? 2 : 0;
    const at = list.findIndex(([a, b]) => a === p.f.x && b === p.f.x + p.f.w + side);
    list.splice(at, 1);
  }

  /**
   * The rest of each block's front, built its district's way: runs of houses with a gap or a garden between, as tall as
   * their yards let them be, a garden left open now and then.
   */
  fill(districtOf: (block: Block, x: number) => District): void {
    const { random } = this.c;
    for (const block of this.c.plan.blocks) {
      const depth = block.z1 - block.z0;
      if ((block as { one?: boolean }).one) {
        // A grown town's lot: one building, its district's, as wide as the lot lets it, in the middle of it.
        if (this.placed.some((p) => p.block === block)) continue;
        const district = districtOf(block, (block.x0 + block.x1) / 2);
        const roles = [weighted(FILL[district].roles, random), "house", "cottage"] as Role[];
        found: for (const role of roles) {
          const { style } = this.styleKind(role);
          const options = [...sizesFor(style, role)].filter(([w, d]) => d <= depth - 1 && w <= block.x1 - block.x0).sort((p, q) => q[0] - p[0]);
          for (const [w, d] of options) {
            const x = block.x0 + Math.floor((block.x1 - block.x0 - w) / 2);
            const f = southFacing([x + Math.floor(w / 2), block.z1], w, d);
            if (!this.c.mustSee(f.door[0], f.door[1]) || !this.free(block, f.x, f.x + f.w, 0)) continue;
            for (const storeys of random() < FILL[district].tall ? ([2, 1] as const) : ([1] as const)) {
              const b = this.trial(`${this.c.town.id}-b${this.count + 1}`, role, f, storeys);
              if (!this.seen(b)) continue;
              this.count++;
              this.take(block, f.x, f.x + f.w);
              this.placed.push({ role, f, b, block });
              break found;
            }
          }
        }
        continue;
      }
      // A block beside the square closes the square's side: a building flush with its end there first.
      for (const end of ["west", "east"] as const) {
        if (block[end] !== "square") continue;
        const runs = this.freeRuns(block);
        const run = end === "west" ? runs.find(([a]) => a === block.x0) : runs.find(([, b]) => b === block.x1);
        if (!run) continue;
        const role: Role = "tenement";
        const { style } = this.styleKind(role);
        for (const [w, d] of [...sizesFor(style, "house"), ...sizesFor(style, role)].filter(([ww, dd]) => dd <= depth - 2 && ww <= run[1] - run[0] - 1)) {
          const x = end === "west" ? run[0] : run[1] - w;
          const f = southFacing([x + Math.floor(w / 2), block.z1], w, d);
          const b = [2, 1].map((s) => this.trial(`${this.c.town.id}-b${this.count + 1}`, role, f, s as 1 | 2)).find((t) => this.seen(t));
          if (!b) continue;
          this.count++;
          this.take(block, f.x, f.x + f.w);
          this.placed.push({ role, f, b, block });
          break;
        }
      }
      for (const [r0, r1] of this.freeRuns(block)) {
        let x = r0;
        // A gap after what stands west of this run.
        if (x > block.x0) x += 1;
        while (x < r1) {
          const district = districtOf(block, x);
          const plan = FILL[district];
          if (random() < plan.garden) {
            x += 4 + Math.floor(random() * 4);
            continue;
          }
          const role = weighted(plan.roles, random);
          const { style } = this.styleKind(role);
          const options = sizesFor(style, role).filter(([, d]) => d <= depth - 2);
          let done = false;
          for (const [w, d] of options) {
            if (x + w > r1) continue;
            const f = southFacing([x + Math.floor(w / 2), block.z1], w, d);
            for (const storeys of random() < plan.tall ? ([2, 1] as const) : ([1] as const)) {
              const b = this.trial(`${this.c.town.id}-b${this.count + 1}`, role, f, storeys);
              if (!this.seen(b)) continue;
              this.count++;
              this.take(block, f.x, f.x + f.w);
              this.placed.push({ role, f, b, block });
              done = true;
              break;
            }
            if (done) {
              x += w + plan.gap[0] + Math.floor(random() * (plan.gap[1] - plan.gap[0] + 1));
              break;
            }
          }
          if (!done) x += 3;
        }
      }
    }
  }
}

export type District = "market" | "temple" | "keep" | "noble" | "artisan" | "harbour" | "residential" | "gardens";

/** How a district builds along its frontages. */
const FILL: Readonly<Record<District, { roles: readonly (readonly [Role, number])[]; gap: readonly [number, number]; garden: number; tall: number }>> = {
  market: { roles: [["tenement", 3], ["house", 2]], gap: [0, 1], garden: 0.03, tall: 0.9 },
  temple: { roles: [["house", 3], ["cottage", 1]], gap: [1, 2], garden: 0.15, tall: 0.6 },
  keep: { roles: [["hall", 1], ["barn", 1]], gap: [1, 2], garden: 0.15, tall: 0.4 },
  noble: { roles: [["house", 1]], gap: [2, 3], garden: 0.2, tall: 0.9 },
  artisan: { roles: [["house", 2], ["warehouse", 1], ["barn", 1]], gap: [1, 1], garden: 0.06, tall: 0.5 },
  harbour: { roles: [["warehouse", 3], ["house", 1]], gap: [1, 1], garden: 0.05, tall: 0.3 },
  residential: { roles: [["house", 4], ["cottage", 2], ["tenement", 1]], gap: [1, 2], garden: 0.1, tall: 0.7 },
  gardens: { roles: [["cottage", 2], ["barn", 1]], gap: [2, 3], garden: 0.35, tall: 0.2 },
};

function weighted<T>(items: readonly (readonly [T, number])[], random: () => number): T {
  const total = items.reduce((n, [, w]) => n + w, 0);
  let roll = random() * total;
  for (const [item, w] of items) if ((roll -= w) < 0) return item;
  return items[0]![0];
}

/**
 * The districts: seeds where the town's places landed - the market at the square, the temple, the keep, the nobles'
 * manors, the artisans by the smithy, the harbour on the quay - and homes and gardens spread between; each block's
 * stretch takes the seed nearest by weighted distance (a Voronoi of the town).
 */
export function districts(plan: Plan, placed: readonly Placed[], random: () => number): (block: Block, x: number) => District {
  const seeds: { kind: District; x: number; z: number; w: number }[] = [];
  const sq = plan.square;
  seeds.push({ kind: "market", x: (sq.x0 + sq.x1) / 2, z: (sq.z0 + sq.z1) / 2, w: 1.3 });
  for (const p of placed) {
    const at = { x: p.f.x + p.f.w / 2, z: p.f.z + p.f.d / 2 };
    if (p.role === "temple") seeds.push({ kind: "temple", ...at, w: 0.8 });
    if (p.role === "smithy") seeds.push({ kind: "artisan", ...at, w: 0.9 });
    if (p.role === "manor") seeds.push({ kind: "noble", ...at, w: 0.7 });
  }
  for (const s of plan.sites) seeds.push({ kind: s.id.endsWith("-manor") ? "noble" : "keep", x: (s.box.x0 + s.box.x1) / 2, z: (s.box.z0 + s.box.z1) / 2, w: 0.9 });
  if (plan.sea.size > 0 || plan.river) {
    const z = plan.river ? plan.river.z0 : plan.sea.has("south") ? plan.south.z0 : plan.sea.has("north") ? plan.box.z0 : (plan.box.z0 + plan.box.z1) / 2;
    const x = plan.sea.has("west") ? plan.box.x0 : plan.sea.has("east") ? plan.box.x1 : (plan.box.x0 + plan.box.x1) / 2;
    seeds.push({ kind: "harbour", x, z, w: 0.7 });
  }
  // Homes spread through the rest, and gardens toward the south edge.
  for (let n = 0; n < 5; n++) seeds.push({ kind: "residential", x: plan.box.x0 + (plan.box.x1 - plan.box.x0) * (0.15 + random() * 0.7), z: plan.box.z0 + (plan.box.z1 - plan.box.z0) * (0.15 + random() * 0.7), w: 1.1 });
  seeds.push({ kind: "gardens", x: plan.box.x0 + 4, z: plan.box.z1 - 4, w: 0.6 }, { kind: "gardens", x: plan.box.x1 - 4, z: plan.box.z1 - 4, w: 0.6 });
  return (block, x) => {
    const z = (block.z0 + block.z1) / 2;
    let best: District = "residential";
    let bestD = Infinity;
    for (const s of seeds) {
      const d = Math.hypot(x - s.x, z - s.z) / s.w;
      if (d < bestD) {
        bestD = d;
        best = s.kind;
      }
    }
    return best;
  };
}
