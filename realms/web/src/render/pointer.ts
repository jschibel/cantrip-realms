import type { Tile } from "../world/grid";
import type { Stage } from "./stage";

// Holding the button: walking after the cursor.
//
// A press is a click as it always was. Held, it becomes a drag once the pointer reaches another tile or has been down
// HOLD_AFTER seconds. From then the player is re-aimed at the tile under the cursor the moment that tile is more than
// REPATH_DISTANCE tiles from where the current path goes - measured from that path-to tile, not from the player - so a
// fast sweep is answered at once, on the very event that crosses the distance; and every RETARGET_EVERY seconds besides,
// for a cursor drifting slowly (or the view moving under a still one). So the walk always heads where the cursor is now,
// at every heading and while the camera turns, follows or zooms. Re-aiming keeps the step being walked (Actor.retarget):
// no snap, no restarted stride. A cursor over something blocked walks to the open tile nearest it. A held walk goes up
// to a door but never through it - only a click goes in (a press on the door, or holding still on it) - so sweeping past
// a shop never pulls you inside. Letting go of a drag (or the cursor leaving the window, or the window losing focus)
// finishes the step under way and stops there.

export const HOLD_AFTER = 0.3;
export const RETARGET_EVERY = 0.1;
export const REPATH_DISTANCE = 1.25;

interface Hold {
  x: number;
  y: number;
  tile: string;
  since: number;
  last: number;
  dragging: boolean;
  /** Where the current path goes: the tile the last re-aim chose. */
  target: Tile | null;
}

const tileKey = (t: Tile | null) => (t ? `${t.x},${t.z}` : "");

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
      const under = stage.floorTileAt(e.clientX, e.clientY);
      if (!hold.dragging && tileKey(under) !== hold.tile) hold.dragging = true;
      if (!hold.dragging || !under) return;
      const from = hold.target;
      if (!from || Math.hypot(under.x - from.x, under.z - from.z) > REPATH_DISTANCE) this.holdStep();
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
      if (tile) stage.clickTile(tile);
      this.hold = { x: e.clientX, y: e.clientY, tile: tileKey(floor), since: stage.time, last: stage.time, dragging: false, target: tile };
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
  }

  private holdStep(): void {
    const hold = this.hold;
    const stage = this.stage;
    if (!hold || stage.transition || stage.paused) return;
    hold.last = stage.time;
    const pointed = stage.pick(hold.x, hold.y);
    if (!pointed) return;
    // Holding still on the door clicked keeps going in; anywhere else, the held walk only walks.
    if (stage.pendingDoor && stage.doorAt(pointed)) return;
    stage.pendingDoor = null;
    const to = stage.reachableNear(pointed, 4);
    if (to) {
      stage.player.retarget(to);
      hold.target = to;
    }
  }

  private release(): void {
    const hold = this.hold;
    if (!hold) return;
    if (hold.dragging && !this.stage.transition && !this.stage.pendingDoor) this.stage.player.stopAfterStep();
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
    if (hold.dragging && this.stage.time - hold.last >= RETARGET_EVERY) this.holdStep();
  }
}
