import type { Overworld } from "./game";

// The mouse on the world, in the style of Fallout's: the hex under the pointer is marked in the color of what a click
// would do there - walk, attack, talk, open, go through - and the cursor changes to match; what it is over (a
// wanderer's name and tier, a waymarker's tier, a door's building) is shown beside it; a click does it.

export function bindInput(game: Overworld): void {
  const canvas = game.canvas;
  const under = (e: PointerEvent) => {
    const ray = game.pixels.rayAt(e.clientX, e.clientY);
    const mob = game.mobUnder(ray);
    return { mob, hex: mob ? mob.walker.hex : game.scene.pick(ray) };
  };
  canvas.addEventListener("pointermove", (e) => {
    if (!game.scene || game.screen !== "world") {
      game.hud.showTooltip(null);
      return;
    }
    const { mob, hex } = under(e);
    game.hoverAt(hex, mob);
    canvas.dataset.cursor = game.hoverIntent;
    game.hud.showTooltip(game.describe(hex, mob), e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", () => {
    game.scene?.mark(null);
    canvas.dataset.cursor = "none";
    game.hud.showTooltip(null);
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !game.scene || game.screen !== "world") return;
    const { mob, hex } = under(e);
    game.hud.showTooltip(null);
    game.click(hex, mob);
  });
}
