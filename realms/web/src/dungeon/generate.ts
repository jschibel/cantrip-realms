// Dungeon floors generated in the browser from the run (interfaces.md, "Dungeons"; tech.md B5): one generator per
// theme carves the floor, and the floor builder places exactly what the run's floor holds. Single-player and never
// replicated: the server hands out the seed and the encounters, and checks each duel against them.

import type { Theme } from "../world/schema";
import { type Carver, type Floor, FloorBuilder, type FloorRequest, type Look, finish } from "./floor";
import { CASTLE_LOOK, carveCastle } from "./themes/castle";
import { CAVES_LOOK, carveCaves } from "./themes/caves";
import { CRYPT_LOOK, carveCrypt } from "./themes/crypt";
import { FOUNDRY_LOOK, carveFoundry } from "./themes/foundry";
import { HOLLOW_LOOK, carveHollow } from "./themes/hollow";
import { PORTAL_LOOK, carvePortal } from "./themes/portal";
import { TOWER_LOOK, carveTower } from "./themes/tower";

export const GENERATORS: Record<Theme, { readonly look: Look; readonly carve: Carver }> = {
  caves: { look: CAVES_LOOK, carve: carveCaves },
  castle: { look: CASTLE_LOOK, carve: carveCastle },
  tower: { look: TOWER_LOOK, carve: carveTower },
  crypt: { look: CRYPT_LOOK, carve: carveCrypt },
  hollow: { look: HOLLOW_LOOK, carve: carveHollow },
  foundry: { look: FOUNDRY_LOOK, carve: carveFoundry },
  portal: { look: PORTAL_LOOK, carve: carvePortal },
};

/** A floor of a run: the same request gives the same floor. */
export function generateFloor(request: FloorRequest): Floor {
  const { look, carve } = GENERATORS[request.theme];
  const b = new FloorBuilder(`${request.theme}:${request.seed}:${request.floor}`, look);
  const rooms = carve(b, request);
  if (rooms.length === 0) throw new Error(`${request.theme}: no rooms`);
  return finish(b, rooms, request);
}

export type { Floor, FloorRequest, RunFloor, Spot } from "./floor";
export { BOSS_INDEX, WARDEN_INDEX } from "./floor";
