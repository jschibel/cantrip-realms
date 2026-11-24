import type { Tile } from "../world/grid";
import type { Stage } from "./stage";

// Holding the button: walking after the cursor.
//
// A press is a click as it always was. Held, it becomes a drag once the pointer leaves the tile pressed or has been down
// HOLD_AFTER seconds. From then no path is found: every frame the player is steered straight at the point on the ground
// under the cursor (Actor.steer), so it walks wherever the cursor is now, at every heading and while the camera turns,
// follows or zooms; what is in the way it slides along, and it stops only where nothing is left to go (render/motion.ts).
// A drag goes up to a door but never through it. Only a click goes in: a press on the door, or holding still on it,
// keeps the click's walk to it while the cursor stays there. Holding still on whatever else the press used (a person, a
// chest) keeps that walk too. Sweeping past a shop never pulls you inside. Letting go of a drag (or the cursor leaving
// the window, or the window losing focus) stops the player where it stands.

export const HOLD_AFTER = 0.3;

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
    if (point) stage.player.steer(point);
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
