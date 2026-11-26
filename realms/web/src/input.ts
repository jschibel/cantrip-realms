import type { Overworld } from "./game";
import { ZOOM_EASE } from "./render/camera";
import { WalkInput } from "./render/pointer";

// The mouse and keys on the world. A click walks there, or walks up to what was clicked and uses it (a person, a mob,
// a chest, a door); held, the walk follows the cursor (render/pointer.ts). What the pointer is over is named beside it
// - a wanderer's name and tier, a door's room - and the cursor shows what a click would do. Q and E turn the camera a
// heading; the wheel, + and - step the outdoor zoom; M opens the whole map (hud.ts), whose keys they are while it is open.

export function bindInput(game: Overworld): WalkInput {
  const canvas = game.canvas;
  const stage = game.stage;
  const input = new WalkInput(stage, canvas);
  input.enabled = () => game.screen === "world" && !game.paused && !game.ferrying;
  const arrived = stage.onArrive;
  stage.onArrive = (spot) => {
    input.cancel();
    arrived(spot);
  };
  canvas.addEventListener("pointermove", (e) => {
    if (game.screen !== "world") {
      game.hud.showTooltip(null);
      canvas.dataset.cursor = "none";
      return;
    }
    const floor = stage.floorTileAt(e.clientX, e.clientY);
    const tile = stage.doorAt(floor) ? floor : stage.pick(e.clientX, e.clientY);
    game.hoverIntent = game.paused ? "none" : game.intentAt(tile);
    canvas.dataset.cursor = game.hoverIntent;
    game.hud.showTooltip(game.describe(tile), e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", () => {
    canvas.dataset.cursor = "none";
    game.hud.showTooltip(null);
  });
  window.addEventListener("keydown", (e) => {
    if (e.repeat || game.screen !== "world" || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
    // The whole map takes the keys while it is open (M or Escape closes it, + and - zoom it); M opens it.
    if (game.hud.mapKey(e.key)) return;
    if (e.key === "m" || e.key === "M") return game.hud.openMap();
    if (e.key === "q" || e.key === "Q") game.turn(-1);
    if (e.key === "e" || e.key === "E") game.turn(1);
    if (e.key === "+" || e.key === "=") game.zoomBy(-1);
    if (e.key === "-" || e.key === "_") game.zoomBy(1);
  });
  // The wheel: a notch a step, and no faster than a step per easing.
  let wheelAt = -Infinity;
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 1 || stage.time - wheelAt < ZOOM_EASE * 0.6) return;
      wheelAt = stage.time;
      game.zoomBy(e.deltaY > 0 ? 1 : -1);
    },
    { passive: false },
  );
  return input;
}
