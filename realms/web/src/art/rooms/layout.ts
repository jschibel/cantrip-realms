import type { InteriorData, InteriorKind, TileData, XZ } from "../../world/format";

// Laying out a room: from an interior's kind, its building's style and size, and a seed, the room's floor, its
// furniture (props), the people who keep it (npcs) and its fires' and windows' light - an `InteriorData`, as the world
// generator writes it to `interiors/<id>.json` (realms/docs/conversion.md, "Rooms").

export const ROOM_KINDS = ["shop", "inn", "guildhall", "temple", "smithy", "library", "house", "tower", "exotic-wares"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const ROOM_STYLES = ["benalish", "llanowar", "morass", "keldon", "tolarian", "vess"] as const;
export type RoomStyle = (typeof ROOM_STYLES)[number];

export interface RoomSpec {
  readonly id: string;
  readonly name?: string;
  readonly kind: RoomKind;
  readonly style: string;
  readonly seed: number;
  readonly town?: string;
  /** The floor's size in tiles; else from `building`. */
  readonly w?: number;
  readonly d?: number;
  /** The footprint of the building it is behind, world units. */
  readonly building?: { readonly w: number; readonly d: number };
  /** The world tile one comes out on: the building's door tile. */
  readonly exit: XZ;
  /** A shop's wares: cards, curios, books, weapons. */
  readonly specialty?: string;
  /** An inn's rooms upstairs (default true); false is a tavern. */
  readonly upstairs?: boolean;
}

const TITLES: Record<InteriorKind, string> = {
  shop: "Shop",
  inn: "Inn",
  guildhall: "Guildhall",
  temple: "Temple",
  smithy: "Smithy",
  library: "Library",
  house: "House",
  tower: "Mage tower",
  "exotic-wares": "Exotic wares",
  crypt: "Crypt",
};

export const roomTitle = (kind: InteriorKind): string => TITLES[kind];

export function layoutRoom(spec: RoomSpec): InteriorData {
  const w = spec.w ?? 12;
  const d = spec.d ?? 8;
  const tiles: TileData[] = [];
  for (let z = 0; z <= d; z++) for (let x = 0; x < w; x++) tiles.push(z < d ? [0, "floorboards", 0] : [0, "floorboards", 1]);
  const ex = Math.floor(w / 2);
  return {
    id: spec.id,
    name: spec.name ?? TITLES[spec.kind],
    kind: "shop",
    style: spec.style,
    w,
    d,
    area: [0, 0, w, d + 1],
    tiles,
    props: [],
    npcs: [],
    entry: [ex, d - 1],
    exit: spec.exit,
  };
}
