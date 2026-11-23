// The Phyrexian Portal (the capstone): the praetor's realm - plated islands hanging over a void, joined by narrow
// bridges, altars and portals; on the last floor the praetor's hall.

import { distance } from "../../hex";
import { type Carver, type FloorBuilder, type FloorRequest, type Look, type Room } from "../floor";
import { around, spread } from "./common";

export const PORTAL_LOOK: Look = { floor: "floor", wall: "deep-water", wallHeight: -0.8, decor: ["altar", "bones", "pillar", "portal"], lights: true };

export const carvePortal: Carver = (b: FloorBuilder, request: FloorRequest) => {
  const last = request.floor === request.floors - 1;
  const islands: Room[] = spread(b, last ? 5 : 7, 10, 18).map((at, i, all) => ({ at, size: last && i === all.length - 1 ? 5 : 2 + Math.floor(b.random() * 2) }));
  for (const island of islands) b.disc(island.at, island.size, "floor");
  // Bridges of crystal over the void, each island to the next.
  for (let i = 1; i < islands.length; i++) b.corridor(islands[i - 1]!.at, islands[i]!.at, 0, "crystal");
  if (last) {
    const hall = islands.at(-1)!;
    for (let k = 0; k < 8; k++) {
      const h = around(hall.at, hall.size - 1, (k / 8) * Math.PI * 2);
      if (distance(h, hall.at) >= 3) b.put(h, k % 2 ? "pillar" : "brazier");
    }
  }
  return islands;
};
