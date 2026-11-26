// The town generator's interface (the world revamp's contract, "The town generator's interface"): what the travel map
// says about where a town stands (`TownSetting`), what the integrator hands the generator (`TownSpec`), and what comes
// back (`BuiltTown`): the town's world.json entry with its grounds and its ways, its buildings, the rooms behind its
// doors, its people outdoors, its inn and its caravans' pitch.

import type { BuildingData, InteriorKind, NpcData, Region, TownData, XZ } from "../../../src/world/format";
import type { Biome, TownLayout } from "../layout";

/** A side of a town, or of its grounds. */
export type Side = "north" | "east" | "south" | "west";
export const SIDES: readonly Side[] = ["north", "east", "south", "west"];

/** The biomes a town can stand in: layout.ts's, and the travel map's new ones. */
export type TownBiome = Biome | "desert" | "badlands" | "highlands" | "jungle";

/** What the travel map says about where a town stands. */
export interface TownSetting {
  readonly biome: TownBiome;
  /** Sides of the town the sea lies on (a harbour town). */
  readonly sea: readonly Side[];
  /** A river past one side of the town, or through it. */
  readonly river?: Side | "through";
  /** How hilly its ground is, 0 (flat) to 1 (terraced hillside). */
  readonly relief: number;
  /** The roads that leave it on the travel map: the side, and the id of where each leads. At least one. */
  readonly ways: readonly { readonly side: Side; readonly to: string }[];
}

/** A vendor of the town: its id and name (a vendor file's). */
export interface TownVendor {
  readonly id: string;
  readonly name: string;
}

export interface TownSpec {
  readonly plan: TownLayout;
  readonly index: number;
  readonly color: Region | null;
  readonly vendors: readonly TownVendor[];
  readonly exotic: TownVendor | null;
  readonly setting: TownSetting;
  /** The north-west corner of its grounds in the Land. */
  readonly origin: XZ;
}

/** A way between a town's grounds and the travel map (format.ts's `TownWay`, the integrator filling `outside`). */
export interface TownWay {
  readonly side: Side;
  /** On the travel map: the open tile beside the icon on that side. The integrator's to fill. */
  readonly outside?: XZ;
  /** Where one arrives, on the road 3 tiles in from the exit. */
  readonly inside: XZ;
  /** The open tiles across the road at the edge of the walked ground: walking onto one leaves. */
  readonly exit: readonly XZ[];
  /** Where the road leads. */
  readonly to?: string;
}

/** A town's world.json entry, with its grounds and its ways (format.ts adds `grounds` and `ways` to `TownData`). */
export type TownGroundsData = Omit<TownData, "grounds" | "ways" | "site"> & {
  /** Its grounds at walking scale: the rectangle of tiles drawn for it, `[x0, z0, x1, z1]`, x1 and z1 excluded. */
  readonly grounds: readonly [number, number, number, number];
  readonly ways: readonly TownWay[];
};

/** A room behind a town's door, for rooms.ts. */
export interface InteriorSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: InteriorKind;
  readonly town: string;
  readonly style: string;
  /** The door's tile in the world: where one comes out. */
  readonly exit: readonly [number, number];
  readonly vendor?: { readonly id: string; readonly name: string };
  readonly armorer?: boolean;
  readonly innkeeper?: { readonly name: string; readonly text: readonly string[] };
  readonly spellTable?: boolean;
  readonly resident?: { readonly name: string; readonly text: readonly string[] };
  /** The footprint of the building it is behind, world units across its front and deep (the room is sized from it). */
  readonly building?: { readonly w: number; readonly d: number };
}

/** What a town's checks measured: its size, what it holds, how far its walks are. */
export interface TownReport {
  /** Tiles within its walls (or its edge), x by z. */
  readonly walled: readonly [number, number];
  readonly grounds: readonly [number, number];
  readonly buildings: number;
  readonly interiors: number;
  /** The longest walk along the streets from a gate to the square, tiles. */
  readonly gateToSquare: number;
  /** The longest walk along the streets from the square to a key place's door, tiles. */
  readonly squareToPlace: number;
  /** Rules the checks hold the town to that it keeps only near enough, said plainly (none when it keeps them all). */
  readonly notes: readonly string[];
}

export interface BuiltTown {
  readonly data: TownGroundsData;
  readonly buildings: BuildingData[];
  readonly interiors: InteriorSpec[];
  readonly npcs: NpcData[];
  /** Each gate's road end just outside it, by name (a land index): where a road on this scale would arrive. */
  readonly gates: Map<string, number>;
  /** The inn's door tile, outside. */
  readonly inn: { readonly x: number; readonly z: number; readonly interior: string };
  /** Where traveling vendors' caravans pitch, if the town has one. */
  readonly pitch: { readonly x: number; readonly z: number } | null;
  readonly report: TownReport;
}
