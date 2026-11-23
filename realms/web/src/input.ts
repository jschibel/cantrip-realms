import type { Overworld } from "./game";

// The mouse on the world, in the style of Fallout's: the hex under the pointer is marked in the color of what a click
// would do there - walk, attack, talk, open, leave - and the cursor changes to match; a click does it.

export function bindInput(game: Overworld): void {
  const canvas = game.canvas;
  const under = (e: PointerEvent) => {
    const ray = game.pixels.rayAt(e.clientX, e.clientY);
    const mob = game.mobUnder(ray);
    return { mob, hex: mob ? mob.walker.hex : game.world.pick(ray) };
  };
  canvas.addEventListener("pointermove", (e) => {
    if (!game.world || game.screen !== "world") return;
    const { mob, hex } = under(e);
    game.hoverAt(hex, mob);
    canvas.dataset.cursor = game.hoverIntent;
  });
  canvas.addEventListener("pointerleave", () => {
    game.world?.mark(null);
    canvas.dataset.cursor = "none";
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !game.world || game.screen !== "world") return;
    const { mob, hex } = under(e);
    game.click(hex, mob);
  });
}
