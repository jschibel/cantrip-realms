// The eight town forms (layout.ts, `Form`) as the generator builds them: their sizes, their streets' and rows' measures,
// their enclosure, their ground, and the styles and footprints of what they build.

import { S } from "../ids";
import type { Form, TownLayout } from "../layout";

export type Enclosure = "wall" | "palisade" | "hedge" | "none";

/** How a form lays out its streets and rows (plan.ts). Tiles throughout. */
export interface FormSpec {
  readonly enclosure: Enclosure;
  /** An east-west street's width (the stages), and a north-south connector's. */
  readonly street: number;
  readonly lane: number;
  /** A row's depth from the street behind it to the street before it: its yards and its buildings. Least, wanted, most. */
  readonly row: readonly [number, number, number];
  /** The north row's depth, when it is not a row's least: nothing stands north of it but the wall, so it may be shallow. */
  readonly row0?: number;
  /** A block's length along its street, least and most. */
  readonly block: readonly [number, number];
  /** The square: tiles across, and the depth of its row (the square is that row and the streets either side of it). */
  readonly square: readonly [number, number];
  readonly round: boolean;
  /** Gardens between the southmost street and the south wall. */
  readonly southBand: number;
  /** How yards are kept: hedged gardens (closed), open ground (walked), or bog under stilts. */
  readonly yards: "hedged" | "open" | "bog";
  readonly guards: boolean;
  /** Whether a northern shore gets a quay behind the north row (a town's), or the gardens run down to the water. */
  readonly northQuay?: boolean;
}

/** Tiles inside the walls (or the edge), x by z, by kind. */
export const TOWN_SIZE: Readonly<Record<TownLayout["kind"], readonly [number, number]>> = {
  capital: [108, 88],
  town: [72, 60],
  village: [44, 30],
};

const FORMS: Record<Form, FormSpec> = {
  capital: { enclosure: "wall", street: 4, lane: 3, row: [10, 11, 15], block: [12, 34], square: [28, 9], round: false, southBand: 4, yards: "hedged", guards: true },
  city: { enclosure: "wall", street: 3, lane: 3, row: [9, 10, 14], block: [11, 30], square: [22, 9], round: false, southBand: 3, yards: "hedged", guards: true },
  village: { enclosure: "hedge", street: 3, lane: 3, row: [7, 10, 14], block: [10, 26], square: [12, 9], round: false, southBand: 2, yards: "hedged", guards: false },
  elfhame: { enclosure: "none", street: 3, lane: 3, row: [13, 16, 19], row0: 10, block: [12, 32], square: [20, 10], round: true, southBand: 4, yards: "open", guards: false },
  stilts: { enclosure: "none", street: 3, lane: 3, row: [8, 10, 13], block: [10, 26], square: [12, 7], round: false, southBand: 3, yards: "bog", guards: false },
  clan: { enclosure: "palisade", street: 3, lane: 3, row: [9, 11, 14], block: [11, 30], square: [22, 9], round: false, southBand: 3, yards: "hedged", guards: true },
  campus: { enclosure: "none", street: 3, lane: 3, row: [9, 11, 14], block: [11, 30], square: [22, 9], round: false, southBand: 4, yards: "open", guards: false },
  estate: { enclosure: "wall", street: 3, lane: 3, row: [9, 11, 14], block: [11, 30], square: [18, 9], round: false, southBand: 3, yards: "hedged", guards: true },
};

/** A small town's measures: a village's rows and square, whatever its form. */
const SMALL: Partial<Record<Form, Partial<FormSpec>>> = {
  elfhame: { row: [10, 12, 16], row0: 9, square: [14, 9], southBand: 2 },
  clan: { row: [7, 10, 14], square: [14, 9], southBand: 3, guards: false },
  campus: { row: [7, 10, 14], square: [14, 9], southBand: 3 },
  village: { row: [7, 10, 14] },
  stilts: { row: [7, 10, 14] },
};

export const formOf = (plan: TownLayout): Form => plan.form ?? (plan.kind === "capital" ? "capital" : plan.kind === "village" ? "village" : "city");

export function formSpec(plan: TownLayout): FormSpec {
  const form = formOf(plan);
  const base = FORMS[form];
  return plan.kind === "village" ? { ...base, ...(SMALL[form] ?? {}), northQuay: false } : base;
}

/** The ground of a town's streets, squares, yards and lots, by its style and form. */
export interface Grounds {
  readonly street: number;
  readonly square: number;
  readonly yard: number;
  readonly path: number;
}

export function groundsOf(plan: TownLayout): Grounds {
  const form = formOf(plan);
  if (form === "stilts") return { street: S.planks, square: S.planks, yard: S.bog, path: S.planks };
  if (form === "village") return { street: S.cobbles, square: S.grass, yard: S.grass, path: S.dirt };
  switch (plan.style) {
    case "llanowar":
      return { street: S.dirt, square: S.moss, yard: S["forest-floor"], path: S.dirt };
    case "keldon":
      return { street: S.dirt, square: S.flagstones, yard: S.tundra, path: S.dirt };
    case "urborg":
      return { street: S.cobbles, square: S.flagstones, yard: S.moss, path: S.mud };
    case "tolarian":
      return { street: S.flagstones, square: S.grass, yard: S.grass, path: S.flagstones };
    default:
      return { street: S.cobbles, square: S.flagstones, yard: S.grass, path: S.dirt };
  }
}

/** What a building does in its town: a place with a door (`interior`), or one of the town's ordinary buildings. */
export type Role =
  | "inn"
  | "shop"
  | "exotic"
  | "guildhall"
  | "temple"
  | "shrine"
  | "library"
  | "tower"
  | "smithy"
  | "home"
  | "house"
  | "cottage"
  | "tenement"
  | "warehouse"
  | "barn"
  | "manor"
  | "hall";

/** A family of building styles' sizes (tiles across the front, deep), by role: the first fits best, the rest if it must. */
type Sizes = Partial<Record<Role, readonly (readonly [number, number])[]>>;

const BENALISH: Sizes = {
  inn: [[10, 7], [9, 7]],
  shop: [[7, 5], [6, 5]],
  exotic: [[8, 6], [7, 5]],
  guildhall: [[11, 8], [10, 7]],
  temple: [[9, 10], [8, 10], [8, 9]],
  library: [[9, 7], [8, 6]],
  tower: [[6, 6], [5, 5]],
  smithy: [[7, 6], [7, 5]],
  home: [[7, 6], [6, 6], [6, 5]],
  house: [[7, 6], [6, 6], [8, 6], [6, 5]],
  cottage: [[5, 5], [5, 4]],
  tenement: [[5, 6], [6, 6], [5, 5]],
  warehouse: [[9, 7], [8, 6]],
  barn: [[8, 6], [7, 5]],
  manor: [[12, 8], [11, 8]],
  hall: [[12, 8], [11, 7]],
};
const VILLAGE: Sizes = {
  inn: [[8, 6], [7, 5]],
  shop: [[6, 5], [5, 4]],
  shrine: [[5, 7], [5, 6]],
  temple: [[6, 8]],
  smithy: [[6, 5]],
  home: [[6, 5], [5, 4]],
  house: [[6, 4], [5, 4], [6, 5]],
  cottage: [[5, 4], [4, 4]],
  barn: [[7, 5]],
  warehouse: [[7, 5]],
};
const KELDON: Sizes = {
  inn: [[10, 7], [9, 6]],
  shop: [[7, 5], [6, 5]],
  temple: [[12, 10], [11, 9]],
  shrine: [[7, 6], [6, 6]],
  guildhall: [[10, 7], [10, 6]],
  library: [[8, 6], [7, 5]],
  smithy: [[7, 5], [6, 5]],
  home: [[8, 5], [7, 5]],
  house: [[8, 5], [7, 4], [9, 5]],
  cottage: [[6, 4], [5, 4]],
  warehouse: [[6, 5], [5, 5]],
  barn: [[6, 5]],
  hall: [[10, 6]],
};
const LLANOWAR: Sizes = {
  inn: [[7, 7], [6, 6]],
  shop: [[6, 5], [5, 5]],
  temple: [[9, 9], [8, 8]],
  shrine: [[6, 6], [5, 5]],
  guildhall: [[9, 7], [8, 6]],
  library: [[7, 7], [6, 6]],
  smithy: [[7, 5], [6, 5]],
  home: [[5, 5], [4, 4]],
  house: [[5, 5], [6, 6], [4, 4]],
  cottage: [[4, 4]],
  warehouse: [[6, 5]],
};
const MORASS: Sizes = {
  inn: [[8, 7], [7, 6]],
  shop: [[6, 5], [5, 5]],
  temple: [[7, 9], [7, 8]],
  shrine: [[6, 6], [5, 5]],
  guildhall: [[9, 7], [8, 6]],
  library: [[7, 7], [6, 6]],
  smithy: [[7, 5], [6, 5]],
  home: [[6, 5], [5, 5]],
  house: [[5, 5], [6, 5], [4, 4]],
  cottage: [[4, 4]],
  tenement: [[4, 5]],
  warehouse: [[8, 6]],
};
const TOLARIAN: Sizes = {
  inn: [[9, 7], [8, 6]],
  shop: [[7, 5], [6, 4]],
  temple: [[9, 10], [8, 9]],
  shrine: [[6, 6], [5, 5]],
  guildhall: [[12, 8], [10, 7]],
  library: [[10, 10], [9, 9]],
  tower: [[6, 6], [5, 5]],
  smithy: [[7, 6], [6, 5]],
  home: [[6, 5], [6, 6]],
  house: [[6, 5], [5, 5], [4, 4]],
  cottage: [[4, 4]],
  warehouse: [[8, 5]],
  hall: [[10, 8]],
};
const VESS: Sizes = {
  manor: [[20, 12], [18, 11]],
  temple: [[7, 11], [6, 10]],
  library: [[8, 6]],
  guildhall: [[8, 6]],
};

/** The building style a role is drawn in, in a town. */
export function styleFor(plan: TownLayout, role: Role): string {
  const form = formOf(plan);
  if (form === "estate" && (role === "manor" || role === "temple" || role === "library" || role === "guildhall")) return "vess";
  if (plan.style === "benalish" && form === "village") return "village";
  if (plan.style === "argive") return "benalish";
  return plan.style;
}

const FAMILY: Readonly<Record<string, Sizes>> = { benalish: BENALISH, village: VILLAGE, keldon: KELDON, llanowar: LLANOWAR, urborg: MORASS, morass: MORASS, tolarian: TOLARIAN, vess: VESS };

/** The footprints a role may take in a style, best first. */
export function sizesFor(style: string, role: Role, capital = false): readonly (readonly [number, number])[] {
  if (capital && style === "benalish") {
    if (role === "temple") return [[13, 17], [12, 16]];
    if (role === "inn") return [[10, 7], [9, 7]];
    if (role === "guildhall") return [[11, 8], [10, 7]];
    if (role === "manor") return [[10, 6], [9, 6]];
    if (role === "home") return [[6, 5], [7, 5]];
    if (role === "shop") return [[6, 5], [7, 5]];
  }
  const own = FAMILY[style]?.[role];
  if (own) return own;
  const fallback = role === "home" || role === "cottage" || role === "tenement" ? "house" : role === "shrine" ? "temple" : role === "barn" || role === "hall" ? "warehouse" : role;
  return FAMILY[style]?.[fallback] ?? BENALISH[role] ?? BENALISH[fallback as Role] ?? [[6, 5]];
}

/** The building kind a role is drawn as. */
export function kindFor(style: string, role: Role): string {
  switch (role) {
    case "exotic":
      return "shop";
    case "shrine":
      return "temple";
    case "home":
    case "cottage":
    case "manor":
      return style === "vess" && role === "manor" ? "manor" : "house";
    case "hall":
      return "guildhall";
    case "barn":
      return "warehouse";
    case "tenement":
      return style === "llanowar" || style === "keldon" || style === "vess" ? "house" : "tenement";
    default:
      return role;
  }
}
