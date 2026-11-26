// The seam between a town's form and everything else the town generator does (index.ts): a planner, chosen by the town's
// form (layout.ts `Form`), lays out the town's plan; the steps after it - the program and its solver (place.ts), the
// buildings, the dressing (dress.ts), the country (country.ts), the terraces (terrain.ts), what the camera sees
// (view.ts) and the checks (check.ts) - are the same for every form and read only what this file defines.
//
// A planner is three things and a hook:
//
// - `plan(input)`: the town's layout, decided whole before anything is built (`Plan`):
//   - `box` the tiles it may grow in (index.ts centres it in the grounds; TOWN_SIZE is its size), `inner` within its edge;
//   - `square`: the centre - a square, a green, a glade, a yard, a platform - a rectangle (or the ellipse in it, `round`)
//     whose north side the town's best fronts face, open to the south. Every place is walked to from it (check.ts);
//   - `gates`: one for each way of the setting (`input.ways`, by index), on its side: where its road leaves the town's
//     edge (`passage`, the edge tiles it crosses), the road's end just outside (`node`, where country.ts starts the
//     road out), and the junction inside;
//   - `blocks`: the frontages, every one facing south: a rectangle of ground x0..x1, z0..z1 whose buildings stand along
//     its south edge, each with its door on the street tile in front of it (row z1), so every door is seen from the
//     camera; `k` says how far north it lies (0 the northmost), which the solver reads as how quiet and how high it is.
//     A row of a street is one long block; a lot on an arc is a short one;
//   - `sites`: ground set aside for one need or landmark (its id), across what would be blocks: the solver lands that
//     need there and nowhere else (`<town>-temple` is the temple's), dress.ts builds the landmarks (`-citadel`, `-keep`,
//     `-manor`);
//   - `south` (gardens and orchards from z0 down), `river` (a band of water through the town, or null), `sea`,
//     `through` (stretches of way across the square its furniture keeps off) and `bridges` (where its ways cross water);
//   - `water`: the tiles of the river or stream in the grounds when the planner lays its own course (else site.ts's).
// - `paint(ctx)`: lays the plan's ground into the grounds after the country's (country.ts "ground"): `ctx.inTown` (1
//   within the town's outline, 2 the ring its wall, hedge or edge stands on), every tile of the town's surface and use
//   (`Use.Lot` for ground the dressing makes yards of, `Use.Street` and `Use.Kept` for its ways and its centre, the
//   wall's ring `Use.Wall` and blocked), `ctx.mustSee` (1 on every way, square and door the camera must see) and
//   `ctx.level` (whole terraces) for every tile of the town.
// - `graph(plan, extra)`: its streets as the world keeps them (format.ts `TownPlan`): junctions and ends joined by ways,
//   each way's tiles its middle line through its `via` corners widened by its width (streets.ts `wayTiles`), and its
//   squares - every tile `paint` made a way or a centre is a tile of one of them, and every door opens onto one. `extra`
//   are the ways the other steps add (a harbour's quay).
// - `lights(ctx)`: stands the town's lights along its ways once its buildings and its square's furniture are placed.
//
// Planners are deterministic: whatever they choose comes from `input.random` (or noise seeded by `input.tag`), never
// from trying seeds. One that cannot lay the town out throws; buildTown then tries again at a smaller `shape.scale`.

import type { StreetWay, TownSquare, XZ } from "../../../src/world/format";
import type { TownLayout } from "../layout";
import type { FormSpec } from "./forms";
import type { Ctx } from "./index";
import type { Need } from "./place";
import type { Fields } from "./site";
import type { Side, TownSetting } from "./types";

/** A rectangle of tiles, x0..x1 and z0..z1, the ends excluded. */
export interface Box {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

export interface Gate {
  readonly side: Side;
  /** The way of the setting it serves (its index), or -1. */
  readonly way: number;
  readonly main: boolean;
  /** Its passage through the outline: the tiles of the outline it crosses. */
  readonly passage: Box;
  /** The road's end just outside it: the plan's gate node, where the walk in starts. */
  readonly node: XZ;
  /** Where its way meets the streets inside: a junction of the plan. */
  readonly inner: XZ;
  readonly width: number;
}

/** A band of rows: z0..z1. */
export interface Band {
  readonly k: number;
  readonly z0: number;
  readonly z1: number;
}

/** A block: ground between streets, built along its south edge (the street at z1). */
export interface Block {
  /** How far north it lies: 0 the northmost (a row's index, in a town of rows). */
  readonly k: number;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** Which of its ends lie on a north-south way (it may front onto them too) or the square. */
  readonly west: "lane" | "street" | "square" | "wall" | "site";
  readonly east: "lane" | "street" | "square" | "wall" | "site";
}

/** Ground a landmark takes across rows: from the north of row k0 to the street before row k1. */
export interface Site {
  readonly id: string;
  readonly box: Box;
  readonly k0: number;
  readonly k1: number;
}

/** What the plan asks a landmark's ground to be. */
export interface SiteRequest {
  readonly id: string;
  /** Tiles across, and rows deep (the rows it spans, ending at the row before a street). */
  readonly w: number;
  readonly rows: number;
  /** Where it belongs: the town's north edge on the square's axis, or beside the square to the north. */
  readonly where: "north" | "square";
  /** The depth of what stands on it, when one row must hold it. */
  readonly d?: number;
}

/** A town's layout, as every step after the planner reads it (see the top of this file). */
export interface Plan {
  readonly box: Box;
  /** The interior: inside the walls. */
  readonly inner: Box;
  /** The centre: its rectangle (the ellipse in it when `round`). */
  readonly square: Box & { readonly round?: boolean };
  readonly gates: readonly Gate[];
  readonly sites: readonly Site[];
  readonly blocks: readonly Block[];
  /** The gardens inside the south wall (or the quay on the sea), z0..z1. */
  readonly south: Band;
  /** A river through the town: its band, or none. */
  readonly river: Band | null;
  /** Sides that are sea: no wall, a quay. */
  readonly sea: ReadonlySet<Side>;
  /** Ways across the square its furniture keeps off (a gate's artery through it). */
  readonly through: readonly Box[];
  /** Where its ways cross water: a bridge over each rectangle. */
  readonly bridges: readonly Box[];
  /** The river's or stream's tiles in the grounds, when the planner lays its course (index.ts then takes these). */
  readonly water?: ReadonlySet<number>;
}

/** The inputs a plan is made from. */
export interface PlanInput {
  readonly box: Box;
  readonly F: FormSpec;
  readonly ways: readonly { readonly side: Side; readonly to: string }[];
  readonly sea: ReadonlySet<Side>;
  readonly river: Side | "through" | undefined;
  /** The land's height, in levels (fractional), at a tile. */
  readonly height: (x: number, z: number) => number;
  readonly sites: readonly SiteRequest[];
  /** The town's shape: its rows' profile, how far an end may be pulled in, the noise that pulls it, a scale (1 as
   * designed; less where the town must find more room). */
  readonly shape: { readonly profile: "oval" | "lozenge" | "blob" | "flat"; readonly most: number; readonly scale: number; readonly noise: (u: number, v: number) => number };
  /**
   * What the row fronting the square from the north must hold: its great buildings' depth, and their depth and the
   * ground they hide behind them.
   */
  readonly civic: readonly [number, number];
  readonly random: () => number;
  readonly gateWidth: number;
  /** A tag for errors. */
  readonly id: string;
  /** The town, its program and where it stands: what a planner that sizes its lots to their buildings reads. */
  readonly town: TownLayout;
  readonly needs: readonly Need[];
  readonly setting: TownSetting;
  readonly fields: Fields;
  /** The seed's tag, for noise of the planner's own. */
  readonly tag: string;
}

/** A way another step adds to the plan's graph. */
export interface ExtraWay {
  readonly a: XZ;
  readonly b: XZ;
  readonly width: number;
  readonly main?: boolean;
}

/** The plan's streets as the world keeps them (format.ts, `TownPlan`). */
export interface Graph {
  readonly nodes: XZ[];
  readonly ways: StreetWay[];
  readonly gates: number[];
  readonly squares: TownSquare[];
}

/** A planner (the top of this file); index.ts `PLANNERS` says which form each lays out. */
export interface Planner {
  plan(input: PlanInput): Plan;
  paint(ctx: Ctx): void;
  graph(plan: Plan, extra: readonly ExtraWay[]): Graph;
  lights(ctx: Ctx): void;
}
