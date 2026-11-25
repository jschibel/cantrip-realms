import type { Tile } from "../world/grid";
import type { Point } from "./motion";
import type { Stage, StageDoor } from "./stage";

// Holding the button: walking after the cursor.
//
// A press is a click as it always was. Held, it becomes a drag once the pointer leaves the tile pressed or has been down
// HOLD_AFTER seconds. From then no path is found: every frame the player is steered straight at the point on the ground
// under the cursor (Actor.steer), so it walks wherever the cursor is now, at every heading and while the camera turns,
// follows or zooms; what is in the way it slides along, and it stops only where nothing is left to go (render/motion.ts).
// A drag goes through a door (a building's, a dungeon's way in, a room's way out) as walking into it would: standing on
// the door's tile (or in its doorway) steered into the doorway - the cursor past the tile's middle by INTO the way the
// door goes, the walk heading within THROUGH of that way. Sweeping along a street of shops, or past a doorway at a slant,
// never pulls you inside. A press on the door, or holding still on it, keeps the click's walk to it and through while the
// cursor stays there; holding still on whatever else the press used (a person, a chest) keeps that walk too. Letting go
// of a drag (or the cursor leaving the window, or the window losing focus) stops the player where it stands.

export const HOLD_AFTER = 0.3;
/** How far past the middle of a door's tile, the way the door goes, a drag's cursor goes through it, tiles: into the doorway. */
export const INTO = 0.5;
/** How near the way a door goes a drag must head to go through it: the cosine of the most it may turn from it (55 degrees). */
export const THROUGH = Math.cos((55 * Math.PI) / 180);

interface Hold {
  x: number;
  y: number;
  /** The floor tile pressed, as "x,z". */
  tile: string;
  /** The tile the press used (a door, a person, a chest): held still on it, the click's walk goes on. */
  used: Tile | null;
  since: number;
  dragging: boolean;
}

const tileKey = (t: Tile | null) => (t ? `${t.x},${t.z}` : "");
const same = (a: Tile | null | undefined, b: Tile | null | undefined) => !!a && !!b && a.x === b.x && a.z === b.z;

export class WalkInput {
  private hold: Hold | null = null;
  /** Whether a press may start a walk now (the page's world screen is up). */
  enabled: () => boolean = () => true;

  constructor(
    private readonly stage: Stage,
    canvas: HTMLCanvasElement,
  ) {
    window.addEventListener("pointermove", (e) => {
      const hold = this.hold;
      if (!hold) return;
      // A release missed outside the window ends the hold all the same.
      if ((e.buttons & 1) === 0) return this.release();
      hold.x = e.clientX;
      hold.y = e.clientY;
      if (!hold.dragging && tileKey(stage.floorTileAt(e.clientX, e.clientY)) !== hold.tile) hold.dragging = true;
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button === 0) this.release();
    });
    window.addEventListener("blur", () => this.release());
    document.documentElement.addEventListener("pointerleave", () => this.release());
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.enabled()) return;
      // A doorway seen past the corner of a wall (the camera swung round) still takes you through it.
      const floor = stage.floorTileAt(e.clientX, e.clientY);
      const tile = stage.doorAt(floor) ? floor : stage.pick(e.clientX, e.clientY);
      const used = tile ? stage.clickTile(tile) : false;
      this.hold = { x: e.clientX, y: e.clientY, tile: tileKey(floor), used: used ? tile : null, since: stage.time, dragging: false };
    });
    stage.beforeTick = () => this.step();
  }

  /** Whether the button is held down walking the player after the cursor. */
  get dragging(): boolean {
    return this.hold?.dragging ?? false;
  }

  /** Going through a door ends a hold: in the next place the button must be pressed again. */
  cancel(): void {
    this.hold = null;
    this.stage.player.steer(null);
  }

  /** A frame of a drag: the player steered at the cursor's point on the ground, unless held still on what was clicked. */
  private steer(): void {
    const hold = this.hold!;
    const stage = this.stage;
    if (hold.used) {
      const floor = stage.floorTileAt(hold.x, hold.y);
      const pointed = stage.doorAt(floor) ? floor : stage.pick(hold.x, hold.y);
      const door = stage.doorAt(pointed);
      if (same(pointed, hold.used) || (door && door === stage.doorAt(hold.used))) return;
      hold.used = null;
    }
    stage.pendingDoor = null;
    const point = stage.floorPointAt(hold.x, hold.y);
    if (!point) return;
    const door = this.doorAhead(point);
    if (door) {
      this.hold = null;
      stage.startDoor(door);
      return;
    }
    stage.player.steer(point);
  }

  /** The door a drag steered at a point walks through: one whose tile or doorway the player is on, steered into the doorway. */
  private doorAhead(point: Point): StageDoor | undefined {
    const player = this.stage.player;
    const door = this.stage.doorAt(player.tile);
    if (!door) return undefined;
    const [sx, sz] = door.step;
    const n = Math.hypot(sx, sz);
    if (n === 0) return undefined;
    const ux = sx / n;
    const uz = sz / n;
    const past = (point.x - (door.tile.x + 0.5)) * ux + (point.z - (door.tile.z + 0.5)) * uz;
    const dx = point.x - player.position.x;
    const dz = point.z - player.position.z;
    const d = Math.hypot(dx, dz);
    return past >= INTO && d > 1e-6 && (dx * ux + dz * uz) / d >= THROUGH ? door : undefined;
  }

  private release(): void {
    const hold = this.hold;
    if (!hold) return;
    if (this.stage.player.steering) this.stage.player.steer(null);
    this.hold = null;
  }

  private step(): void {
    const hold = this.hold;
    if (!hold) return;
    if (this.stage.transition) {
      this.hold = null;
      return;
    }
    if (!hold.dragging && this.stage.time - hold.since >= HOLD_AFTER) hold.dragging = true;
    if (hold.dragging && !this.stage.paused && this.enabled()) this.steer();
  }
}
