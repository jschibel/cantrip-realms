// The eight town forms (layout.ts, `Form`) as the town template builds them (hub.ts): what each is kept in, its ground,
// and the styles and footprints of what it builds.

import { S } from "../ids";
import type { Form, TownLayout } from "../layout";

export type Enclosure = "wall" | "palisade" | "hedge" | "none";

/** What a form's town is kept in, and whether guards walk its gate. */
export interface FormSpec {
  readonly enclosure: Enclosure;
  readonly guards: boolean;
}

const FORMS: Record<Form, FormSpec> = {
  capital: { enclosure: "wall", guards: true },
  city: { enclosure: "wall", guards: true },
  village: { enclosure: "hedge", guards: false },
  elfhame: { enclosure: "none", guards: false },
  stilts: { enclosure: "none", guards: false },
  clan: { enclosure: "palisade", guards: true },
  campus: { enclosure: "none", guards: false },
  estate: { enclosure: "wall", guards: true },
};

export const formOf = (plan: TownLayout): Form => plan.form ?? (plan.kind === "capital" ? "capital" : plan.kind === "village" ? "village" : "city");

export function formSpec(plan: TownLayout): FormSpec {
  const base = FORMS[formOf(plan)];
  return plan.kind === "village" ? { ...base, guards: false } : base;
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
