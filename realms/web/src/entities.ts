import * as THREE from "three";
import { mobFigure } from "./art/figures";
import type { MobInfo } from "./mobs";
import { Actor } from "./render/actor";
import type { SpawnData } from "./world/format";
import type { Grid, Tile } from "./world/grid";

// What walks the world besides the townsfolk (render/spots.ts stands those): the mobs of the spawn points and the
// other players in the same place, each an Actor on the place's grid (render/actor.ts: squares, eight ways, never a cut
// corner). Every fight is the player's choice (design.md A3): a mob wanders near its spawn and, when a player comes
// near, stops and watches them, waiting to be challenged - a click on it - but never comes after anyone; a dungeon's
// challengers stand on their circles and watch the player from the moment they arrive. Other players
// walk the paths the relay sends. A mob hops a ledge a level high as its file says (MobInfo `hops`).

/** Tiles a second: at most 5, the fastest walk the server takes. */
export const PLAYER_SPEED = 4.2;
/** How near a player comes before a wanderer stops and watches them. */
export const NOTICE_RANGE = 5;
const WANDER_SPEED = 1.4;

/** Tiles apart, as the server measures nearness: the most of the two axes (a diagonal step is one). */
export const chebyshev = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** A spawn point's mob, walking the world. */
export class Mob {
  /** Seconds until it next picks somewhere to wander. */
  rest = 3 + Math.random() * 2;
  engaged = false;

  constructor(
    readonly actor: Actor,
    readonly info: MobInfo,
    readonly spawn: SpawnData,
    readonly epoch: number,
    /** A dungeon run's encounter: the floor and its index (the boss's is past the encounters). */
    readonly run?: { readonly floor: number; readonly index: number; readonly role: string },
  ) {}

  static make(info: MobInfo, spawn: SpawnData, epoch: number, grid: Grid, floor: ((x: number, z: number) => number) | null, run?: Mob["run"]): Mob {
    const actor = new Actor(mobFigure(info.model, info.id, info.creature), { x: spawn.x, z: spawn.z }, grid, {}, info.name);
    actor.floor = floor;
    actor.hops = info.hops;
    actor.place({ x: spawn.x, z: spawn.z });
    actor.speed = WANDER_SPEED;
    // A wanderer carries its tier over its head, so the player sees which fights are theirs to pick before choosing one
    // (a dungeon's challengers stand on their circles instead).
    if (!run) actor.figure.root.add(tierMarker(spawn.tier || info.tier, actor.figure.root));
    return new Mob(actor, info, spawn, epoch, run);
  }

  get home(): Tile {
    return { x: this.spawn.x, z: this.spawn.z };
  }

  /**
   * One frame of thought: wandering near its spawn, or - the player within `NOTICE_RANGE` - standing to watch them. A
   * dungeon's challenger (and its boss) never wanders: it stands on its circle and watches the player across the arena.
   * `free(t)` is whether a tile can be stood on (open, nobody else there). `wander` false keeps it where it stands.
   */
  think(seconds: number, player: Actor, free: (t: Tile) => boolean, wander: boolean): void {
    if (this.engaged) return;
    this.rest -= seconds;
    if (this.run || chebyshev(this.actor.tile, player.tile) <= NOTICE_RANGE) {
      if (this.actor.moving) this.actor.stopWalking();
      const p = player.position;
      const at = this.actor.position;
      this.actor.figure.face(p.x - at.x, p.z - at.z);
      this.rest = Math.max(this.rest, 1.5);
      return;
    }
    this.actor.speed = WANDER_SPEED;
    if (wander && !this.actor.moving && this.rest <= 0) {
      const r = this.spawn.radius;
      for (let tries = 0; tries < 8; tries++) {
        const t = { x: this.home.x + Math.round((Math.random() * 2 - 1) * r), z: this.home.z + Math.round((Math.random() * 2 - 1) * r) };
        if (free(t) && this.actor.goTo(t)) break;
      }
      this.rest = 2 + Math.random() * 3;
    }
  }
}

/** The tiers' colors (worldMap.ts TIER_COLORS, the regional map's legend): 1 green, 2 gold, 3 orange, 4 red. */
const TIER_GEMS: readonly number[] = [0x979cab, 0x1fbf62, 0xffc94a, 0xf58a3a, 0xe02a3a];

/** A small gem of a tier's color floating a little over a figure's head, unlit so it reads at any hour. */
export function tierMarker(tier: number, figure: THREE.Object3D): THREE.Object3D {
  // In the figure's own frame, whatever its size: placed by its height in the world, the same size over any creature.
  figure.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(figure);
  const s = figure.scale;
  const top = Number.isFinite(box.max.y) ? box.max.y - figure.position.y : 1.6;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), new THREE.MeshBasicMaterial({ color: TIER_GEMS[Math.max(0, Math.min(4, tier))]! }));
  gem.scale.set(1 / s.x, 1.5 / s.y, 1 / s.z);
  gem.position.set(0, (top + 0.35) / s.y, 0);
  gem.name = "tier-marker";
  gem.userData.tier = tier;
  return gem;
}

/** Another player in this place, as the relay tells it. */
export interface Visitor {
  /** The connection's number on the relay. */
  readonly player: number;
  name: string;
  /** Their colors, as letters in WUBRG order. */
  identity: string;
  readonly actor: Actor;
}
