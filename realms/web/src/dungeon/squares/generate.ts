// A run's floor, generated in the browser from the run's seed (interfaces.md, "Dungeons"): the theme's carver opens
// the floor, the run's contract is placed on it (finish.ts), and the theme dresses it. The same request gives the same
// floor, on every machine.

import type { Theme } from "../../world/format";
import { type ThemeDef, finish } from "./finish";
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
  const [w, d] = theme.size(request);
  const plan = new Plan(w, d, `${request.theme}:${request.seed}:${request.floor}`, theme.floor);
  // The portal's islands hang in the void; everything else is dug out of rock.
  if (request.theme === "portal") plan.cells.fill(VOID);
  const rooms = theme.carve(plan, request);
  if (rooms.length === 0) throw new Error(`${request.theme}: no rooms`);
  return finish(plan, rooms, request, theme);
}
