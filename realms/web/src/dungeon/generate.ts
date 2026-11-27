// A run's floor, generated in the browser from the run's seed (interfaces.md, "Dungeons"): one arena room in the theme's
// look - a round of the tournament, or the boss's hall on the last floor - its size by the dice, carved by the theme,
// the run's contract placed on it (finish.ts), and dressed by the theme. The same request gives the same floor, on every
// machine.

import { fnv1a32, mulberry32 } from "../random";
import type { Theme } from "../world/format";
import { type Arena, type ThemeDef, finish } from "./finish";
import { Plan, VOID } from "./plan";
import { CASTLE } from "./themes/castle";
import { CAVES } from "./themes/caves";
import { CRYPT } from "./themes/crypt";
import { FOUNDRY } from "./themes/foundry";
import { HOLLOW } from "./themes/hollow";
import { PORTAL } from "./themes/portal";
import { TOWER } from "./themes/tower";
import type { DungeonFloor, FloorRequest } from "./types";

export const THEME_DEFS: Record<Theme, ThemeDef> = {
  caves: CAVES,
  castle: CASTLE,
  tower: TOWER,
  crypt: CRYPT,
  hollow: HOLLOW,
  foundry: FOUNDRY,
  portal: PORTAL,
};

export function generateDungeonFloor(request: FloorRequest): DungeonFloor {
  const theme = THEME_DEFS[request.theme];
  const key = `${request.theme}:${request.seed}:${request.floor}`;
  const hall = request.floor === request.floors - 1;
  const [iw, id] = theme.size(hall, mulberry32(fnv1a32(`${key}:size`)));
  // The arena's floor inside a ring of wall, a row more at the south: the notch the way back climbs out through.
  const plan = new Plan(iw + 2, id + 3, key, theme.floor);
  // The portal's island hangs in the void; everything else is dug out of rock.
  if (request.theme === "portal") plan.cells.fill(VOID);
  const arena: Arena = { x0: 1, z0: 1, x1: iw, z1: id, cx: 1 + Math.floor((iw - 1) / 2), hall };
  theme.carve(plan, arena, request);
  return finish(plan, arena, request, theme);
}
