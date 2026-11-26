// What a building of a town says to its style's recipe (art/buildings): its kind, its footprint and turn, its door, and
// its `params` - storeys, roof, walls and the openings along its front - as Benalia's style reads them (benalish.ts:
// ground, upper, roof tile|slate, rise, chimney, wall limestone|plaster, openings [{at, kind}]); every style is given the
// same, and reads what it can (floors, stilts). The storeys are the caller's to choose: a building is made lower where
// a taller one would hide a street (view.ts).

import type { BuildingData } from "../../../src/world/format";
import { texel } from "../land";

export interface Footprint {
  /** The tile of its north-west corner, and its size in tiles along x and z. */
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  /** Its front: 0 south, 1 west, 3 east (never 2, north: the camera never sees it). */
  readonly rot: number;
  /** The door's tile, in front of the front wall, walkable. */
  readonly door: readonly [number, number];
}

/** Tiles across a building's front. */
export const across = (f: Pick<Footprint, "w" | "d" | "rot">): number => (f.rot % 2 === 0 ? f.w : f.d);

/** How far along the front, from its left end as the style draws it (facing south, its west end), a tile's middle is. */
export function alongFront(f: Footprint, tile: readonly [number, number]): number {
  switch (f.rot) {
    case 0:
      return tile[0] + 0.5 - f.x;
    case 2:
      return f.x + f.w - tile[0] - 0.5;
    case 1:
      return tile[1] + 0.5 - f.z;
    default:
      return f.z + f.d - tile[1] - 0.5;
  }
}

/** The footprint of a building facing south whose door, `k` tiles from its west end, is the street tile `door`. */
export function southFacing(door: readonly [number, number], w: number, d: number, k = Math.floor(w / 2)): Footprint {
  return { x: door[0] - k, z: door[1] - d, w, d, rot: 0, door };
}

interface Look {
  readonly ground: readonly number[];
  readonly upper: readonly number[];
  readonly rise: readonly number[];
  readonly door: "door" | "shopDoor";
  readonly windows: "window" | "display";
  readonly sign?: boolean;
  readonly banners?: boolean;
  readonly lamp?: boolean;
  readonly chimney: number;
  readonly wall?: "limestone" | "plaster";
}

const LOOKS: Readonly<Record<string, Look>> = {
  house: { ground: [2.375, 2.5], upper: [1.625, 1.75], rise: [1.5, 1.75], door: "door", windows: "window", chimney: 0.6 },
  tenement: { ground: [2.5], upper: [1.75, 1.875], rise: [1.625, 1.875], door: "door", windows: "window", chimney: 0.8 },
  shop: { ground: [2.625, 2.75], upper: [1.5, 1.625], rise: [1.5, 1.625], door: "shopDoor", windows: "display", sign: true, chimney: 0.4 },
  inn: { ground: [2.75, 2.875], upper: [1.75, 1.875], rise: [1.875, 2], door: "door", windows: "window", sign: true, lamp: true, chimney: 1 },
  temple: { ground: [3.625, 3.75], upper: [0], rise: [2.5, 2.75], door: "door", windows: "window", banners: true, chimney: 0, wall: "limestone" },
  guildhall: { ground: [3, 3.125], upper: [1.75, 1.875], rise: [2, 2.125], door: "door", windows: "window", banners: true, sign: true, chimney: 0.5, wall: "limestone" },
  smithy: { ground: [2.5, 2.625], upper: [0], rise: [1.625, 1.75], door: "door", windows: "window", sign: true, chimney: 1 },
  library: { ground: [3, 3.125], upper: [1.75, 1.875], rise: [1.875, 2], door: "door", windows: "window", sign: true, chimney: 0.3, wall: "limestone" },
  tower: { ground: [3.25], upper: [2.5], rise: [2.75], door: "door", windows: "window", sign: true, chimney: 0, wall: "limestone" },
  warehouse: { ground: [3, 3.25], upper: [0], rise: [1.875, 2], door: "door", windows: "window", chimney: 0, wall: "plaster" },
  manor: { ground: [3, 3.125], upper: [2, 2.125], rise: [2.25, 2.5], door: "door", windows: "window", banners: true, lamp: true, chimney: 1, wall: "limestone" },
};

type Opening = { at: number; kind: string };

export interface BuildingOptions {
  readonly interior?: string;
  readonly sign?: string;
  /** One storey or two (where the style reads it). */
  readonly storeys: 1 | 2;
  /** What else its style reads: stilts, floors, a palette. */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly palette?: string;
  /** Banners and a lamp, as a manor has them. */
  readonly grand?: boolean;
}

/**
 * A building's entry: its footprint, kind and style, its door into `interior` if it has one (a door without one is only
 * painted, and not given), its sign, and the params its front is drawn from.
 */
export function makeBuilding(id: string, style: string, kind: string, f: Footprint, random: () => number, o: BuildingOptions): BuildingData {
  const look = LOOKS[o.grand ? "manor" : kind] ?? LOOKS.house!;
  const pick = (list: readonly number[]) => list[Math.floor(random() * list.length)]!;
  const width = across(f);
  const doorAt = alongFront(f, f.door);
  const openings: Opening[] = [{ at: doorAt, kind: look.door }];
  const windows: number[] = [];
  for (let at = 1.25; at <= width - 1.25; at += 2) if (Math.abs(at - doorAt) >= 1.4) windows.push(texel(at));
  for (const at of windows) openings.push({ at, kind: look.windows });
  const upper = o.storeys === 2 ? pick(look.upper) : 0;
  if (upper > 0) for (const at of [doorAt, ...windows]) openings.push({ at: texel(at), kind: "windowUp" });
  if (look.sign && o.sign) openings.push({ at: doorAt, kind: "sign" });
  if (look.banners) for (const at of [0.55, width - 0.55]) openings.push({ at: texel(at), kind: upper > 0 ? "bannerUp" : "banner" });
  if (look.lamp) openings.push({ at: texel(Math.min(width - 0.6, doorAt + 1.1)), kind: "lamp" });
  const chimney = random() < look.chimney ? { chimney: texel(0.8 + Math.floor(random() * Math.max(1, width - 1.6) * 2) / 2) } : {};
  const params: Record<string, unknown> = {
    ground: pick(look.ground),
    upper,
    roof: random() < 0.7 ? "tile" : "slate",
    rise: pick(look.rise),
    ...chimney,
    wall: look.wall ?? (random() < 0.5 ? "limestone" : "plaster"),
    floors: o.storeys,
    openings: openings.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind)),
    ...(o.params ?? {}),
  };
  return {
    id,
    style,
    kind,
    x: f.x,
    z: f.z,
    w: f.w,
    d: f.d,
    rot: f.rot,
    ...(o.interior ? { door: f.door, interior: o.interior } : {}),
    ...(o.sign ? { sign: o.sign } : {}),
    ...(o.palette ? { palette: o.palette } : {}),
    params,
  };
}
