// A dungeon floor on squares, as the browser generates it for a run (realms/docs/tech.md B5, "Dungeons on
// squares"): the floor's own tiles `w` by `d` from (0, 0), in version 2's tile format, the props and lights that
// furnish and light it, the spell table's NPC on the first floor, and where the run's way up, way down, way out and
// encounters stand. The same request always gives the same floor.

import type { RunFloor } from "../net/api";
import type { LightData, NpcData, PropData, Theme, TileData, XZ } from "../world/format";

/** What the run's floor holds: one of `POST /api/dungeon/enter`'s `Floors`. */
export type { RunFloor };

export interface FloorRequest {
  readonly theme: Theme;
  readonly seed: number;
  /** From 0 at the entrance. */
  readonly floor: number;
  readonly floors: number;
  readonly run: RunFloor;
}

export type Role = "encounter" | "warden" | "boss";

/** Where one of the run's fights stands: its `Index` and mob as the run names them, on a tile. */
export interface Spot {
  readonly index: number;
  readonly mob: string;
  readonly role: Role;
  readonly x: number;
  readonly z: number;
}

export interface DungeonFloor {
  readonly theme: Theme;
  /** From 0 at the entrance. */
  readonly floor: number;
  readonly last: boolean;
  /** The floor's tiles: x 0..w, z 0..d. */
  readonly w: number;
  readonly d: number;
  /**
   * The plan, a row of characters per z: `#` solid wall, `.` floor, `~` water, `=` lava, ` ` nothing (a chasm, the
   * void round the portal's islands). What the walls are drawn from; the tiles say what is walked.
   */
  readonly cells: readonly string[];
  /** Version 2's tiles, row by row (z then x), `w * d` of them. */
  readonly tiles: readonly TileData[];
  readonly props: readonly PropData[];
  readonly npcs: readonly NpcData[];
  /** The floor's own fires, glows and lamps. */
  readonly lights: readonly LightData[];
  /** Where a player stands on arriving. */
  readonly arrive: XZ;
  /** The way up: out of the dungeon (it ends the run). */
  readonly up: XZ;
  /** The stairs down, on every floor but the last. */
  readonly down: XZ | null;
  /** Beside the boss: the way out once it is beaten. */
  readonly wayOut: XZ | null;
  readonly spots: readonly Spot[];
}
