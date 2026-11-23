// Castle (plains and farmland: Benalia): a keep of halls on a grid, a courtyard open to the sky with its well and
// trees, corridors through doorways between the halls.

import { toWorld } from "../../hex";
import { type Carver, type FloorBuilder, type Look, type Room } from "../floor";
import { hexAt } from "./common";

export const CASTLE_LOOK: Look = { floor: "marble", wall: "stone", wallHeight: 2.4, decor: ["pillar", "statue", "banner", "crate"], lights: true };

export const carveCastle: Carver = (b: FloorBuilder) => {
  // A 3-by-3 grid of halls, 13 world units apart; one of them a courtyard.
  const cells: { at: ReturnType<typeof hexAt>; w: number; d: number }[] = [];
  for (let gx = -1; gx <= 1; gx++) {
    for (let gz = -1; gz <= 1; gz++) {
      cells.push({ at: hexAt(gx * 13, gz * 13), w: 6 + Math.floor(b.random() * 4), d: 6 + Math.floor(b.random() * 4) });
    }
  }
  const courtyard = [1, 3, 5, 7][Math.floor(b.random() * 4)]!;
  cells.forEach((c, i) => b.rect(c.at, c.w, c.d, i === courtyard ? "grass" : undefined));
  // Corridors: a spine through the middle hall, and most of the other neighbours joined, so there is a way round.
  for (const [i, j] of [[1, 4], [4, 7], [3, 4], [4, 5], [0, 1], [6, 7], [2, 5], [8, 7]] as const) b.corridor(cells[i]!.at, cells[j]!.at, 0, "stone");
  for (const [i, j] of [[0, 3], [1, 2], [3, 6], [5, 8]] as const) if (b.random() < 0.6) b.corridor(cells[i]!.at, cells[j]!.at, 0, "stone");
  const c = cells[courtyard]!;
  const centre = toWorld(c.at);
  b.put(hexAt(centre.x, centre.z), "well");
  for (const [dx, dz] of [[-2.5, -2.5], [2.5, 2.5], [-2.5, 2.5], [2.5, -2.5]] as const) b.put(hexAt(centre.x + dx, centre.z + dz), "tree");
  // From a corner hall across the keep to the far corner.
  return [0, 1, 3, 4, 2, 6, 5, 7, 8].map((i) => ({ at: cells[i]!.at, size: Math.floor(Math.min(cells[i]!.w, cells[i]!.d) / 3) }) as Room);
};
