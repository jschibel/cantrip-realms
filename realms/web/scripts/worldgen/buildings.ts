// What a building of the world says to its style's recipe (art/buildings): its kind, its footprint and turn, its door,
// and its `params` - storeys, roof, walls and the openings along its front - as Benalia's style reads them
// (art/buildings/benalish.ts: ground, upper, roof tile|slate, rise, chimney, wall limestone|plaster, openings [{at,
// kind}]). Every style is given the same params; a style reads what it can use of them.

import type { BuildingData } from "../../src/world/format";
import type { BuildingKind } from "./ids";
import { texel } from "./land";

export interface Footprint {
  /** The tile of its north-west corner, and its size in tiles along x and z. */
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  /** Its front: 0 south, 1 west, 2 north, 3 east (quarter turns clockwise from south). */
  readonly rot: number;
  /** The door's tile, in front of the front wall, walkable. */
  readonly door: readonly [number, number];
}

/** Tiles across a building's front. */
export const across = (f: Pick<Footprint, "w" | "d" | "rot">): number => (f.rot % 2 === 0 ? f.w : f.d);

/**
 * How far along the front, from the left end as the style draws it (facing south, its west end), a world tile's middle
 * lies: the `at` of an opening in front of that tile. placeBuilding turns the drawing about the footprint's middle.
 */
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

/** The tile in front of the front wall at a distance `at` along it (the inverse of alongFront). */
export function frontTile(f: Omit<Footprint, "door">, at: number): [number, number] {
  switch (f.rot) {
    case 0:
      return [Math.floor(f.x + at), f.z + f.d];
    case 2:
      return [Math.floor(f.x + f.w - at), f.z - 1];
    case 1:
      return [f.x - 1, Math.floor(f.z + at)];
    default:
      return [f.x + f.w, Math.floor(f.z + f.d - at)];
  }
}

type Opening = { at: number; kind: string };

interface Look {
  readonly ground: readonly [number, number];
  /** The chance of an upper storey, and its height. */
  readonly upper: readonly [number, number, number];
  readonly rise: readonly [number, number];
  readonly door: "door" | "shopDoor";
  readonly windows: "window" | "display";
  readonly sign?: boolean;
  readonly banners?: boolean;
  readonly lamp?: boolean;
  readonly chimney: number;
  readonly wall?: "limestone" | "plaster";
}

const LOOKS: Record<BuildingKind, Look> = {
  house: { ground: [2.3, 2.6], upper: [0.6, 1.6, 1.8], rise: [1.5, 1.8], door: "door", windows: "window", chimney: 0.6 },
  tenement: { ground: [2.4, 2.6], upper: [1, 1.7, 1.9], rise: [1.6, 1.9], door: "door", windows: "window", chimney: 0.8 },
  shop: { ground: [2.6, 2.8], upper: [0.8, 1.5, 1.7], rise: [1.5, 1.7], door: "shopDoor", windows: "display", sign: true, chimney: 0.4 },
  inn: { ground: [2.7, 2.9], upper: [1, 1.8, 1.9], rise: [1.8, 2.1], door: "door", windows: "window", sign: true, lamp: true, chimney: 1 },
  temple: { ground: [3.6, 3.9], upper: [0, 0, 0], rise: [2.4, 2.8], door: "door", windows: "window", banners: true, chimney: 0, wall: "limestone" },
  guildhall: { ground: [3, 3.2], upper: [1, 1.8, 2], rise: [2, 2.2], door: "door", windows: "window", banners: true, sign: true, chimney: 0.5, wall: "limestone" },
  smithy: { ground: [2.5, 2.7], upper: [0, 0, 0], rise: [1.6, 1.8], door: "door", windows: "window", sign: true, chimney: 1 },
  library: { ground: [3, 3.2], upper: [1, 1.8, 2], rise: [1.9, 2.1], door: "door", windows: "window", sign: true, chimney: 0.3, wall: "limestone" },
  tower: { ground: [3.2, 3.4], upper: [1, 2.4, 2.6], rise: [2.6, 3], door: "door", windows: "window", sign: true, chimney: 0, wall: "limestone" },
  warehouse: { ground: [3, 3.3], upper: [0, 0, 0], rise: [1.8, 2], door: "door", windows: "window", chimney: 0, wall: "plaster" },
  barn: { ground: [2.5, 2.8], upper: [0, 0, 0], rise: [2, 2.3], door: "door", windows: "window", chimney: 0, wall: "plaster" },
};

const range = (random: () => number, [low, high]: readonly [number, number]) => texel(low + random() * (high - low));

/**
 * A building's entry: its footprint, kind and style, its door into `interior` if it has one (a door without one is only
 * painted, and not given), its sign, and the params its front is drawn from.
 */
export function building(
  id: string,
  style: string,
  kind: BuildingKind,
  f: Footprint,
  random: () => number,
  extra: { interior?: string; sign?: string } = {},
): BuildingData {
  const look = LOOKS[kind];
  const width = across(f);
  const doorAt = alongFront(f, f.door);
  const openings: Opening[] = [{ at: doorAt, kind: look.door }];
  // Windows every two tiles or so, clear of the door.
  const windows: number[] = [];
  for (let at = 1.25; at <= width - 1.25; at += 2) if (Math.abs(at - doorAt) >= 1.4) windows.push(texel(at));
  for (const at of windows) openings.push({ at, kind: look.windows });
  const twoStoreys = random() < look.upper[0];
  const upper = twoStoreys ? range(random, [look.upper[1], look.upper[2]]) : 0;
  if (upper > 0) for (const at of [doorAt, ...windows]) openings.push({ at: texel(at), kind: "windowUp" });
  if (look.sign && extra.sign) openings.push({ at: doorAt, kind: "sign" });
  if (look.banners) for (const at of [0.55, width - 0.55]) openings.push({ at: texel(at), kind: upper > 0 ? "bannerUp" : "banner" });
  if (look.lamp) openings.push({ at: texel(Math.min(width - 0.6, doorAt + 1.1)), kind: "lamp" });
  const params: Record<string, unknown> = {
    ground: range(random, look.ground),
    upper,
    roof: random() < 0.7 ? "tile" : "slate",
    rise: range(random, look.rise),
    ...(random() < look.chimney ? { chimney: texel(0.8 + random() * (width - 1.6)) } : {}),
    wall: look.wall ?? (random() < 0.5 ? "limestone" : "plaster"),
    openings: openings.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind)),
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
    ...(extra.interior ? { door: f.door, interior: extra.interior } : {}),
    ...(extra.sign ? { sign: extra.sign } : {}),
    params,
  };
}
