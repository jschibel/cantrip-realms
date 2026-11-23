// Root hollow (forests: Llanowar, Yavimaya): organic tunnels through living roots, worn by wandering, opening into
// glades under the canopy; mushrooms and moss.

import { DIRECTIONS, distance, hex } from "../../hex";
import { type Carver, type FloorBuilder, type Look, REACH, type Room } from "../floor";
import { spread } from "./common";

export const HOLLOW_LOOK: Look = { floor: "moss", wall: "forest", wallHeight: 1.8, decor: ["mushroom", "bush", "reeds", "mushroom"], lights: false };

export const carveHollow: Carver = (b: FloorBuilder) => {
  const glades: Room[] = spread(b, 6, 9, REACH - 6).map((at) => ({ at, size: 3 }));
  for (const g of glades) {
    b.disc(g.at, g.size, "meadow");
    for (const d of DIRECTIONS) if (b.random() < 0.5) b.carve(hex(g.at.q + d.q * (g.size + 1), g.at.r + d.r * (g.size + 1)), "moss");
  }
  // Wandering tunnels between the glades, a hex or three wide.
  for (let i = 1; i < glades.length; i++) b.corridor(glades[i - 1]!.at, glades[i]!.at, b.random() < 0.5 ? 1 : 0, "moss", 0.45);
  // Side roots: dead ends worn by something.
  for (let k = 0; k < 6; k++) {
    let at = glades[Math.floor(b.random() * glades.length)]!.at;
    for (let s = 0; s < 8; s++) {
      const d = DIRECTIONS[Math.floor(b.random() * 6)]!;
      at = hex(at.q + d.q, at.r + d.r);
      if (distance(at, hex(0, 0)) >= REACH - 2) break;
      b.carve(at, "moss");
    }
  }
  for (const g of glades) b.put(hex(g.at.q + 2, g.at.r - 1), "tree");
  return glades;
};
