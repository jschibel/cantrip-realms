// Foundry (volcanic land: Shiv): halls of forges and anvils in a winding row, lava channels running across them,
// gantries over the lava.

import { type Hex, hex, toWorld } from "../../hex";
import { type Carver, type FloorBuilder, type Look, type Room } from "../floor";
import { hexAt } from "./common";

export const FOUNDRY_LOOK: Look = { floor: "ash", wall: "rock", wallHeight: 2.0, decor: ["anvil", "crate", "barrel", "forge"], lights: true };

export const carveFoundry: Carver = (b: FloorBuilder) => {
  const rooms: Room[] = [];
  const halls: { at: Hex; w: number; d: number }[] = [];
  for (let k = 0; k < 5; k++) {
    const x = -24 + k * 12;
    const z = (k % 2 === 0 ? -6 : 6) + (b.random() - 0.5) * 4;
    halls.push({ at: hexAt(x, z), w: 8 + Math.floor(b.random() * 3), d: 7 + Math.floor(b.random() * 3) });
  }
  halls.forEach((h, k) => {
    b.rect(h.at, h.w, h.d, k % 2 === 0 ? "ash" : "stone");
    rooms.push({ at: h.at, size: 3 });
    if (k > 0) b.corridor(halls[k - 1]!.at, h.at, 1, "stone");
  });
  // A lava channel across each middle hall, along z, with a gantry where the way through crosses it.
  for (const h of halls.slice(1, -1)) {
    const c = toWorld(h.at);
    for (let dz = -h.d / 2; dz <= h.d / 2; dz += 0.8) {
      const cell = hexAt(c.x + 2.2, c.z + dz);
      if (!b.open(cell)) continue;
      if (Math.abs(dz) < 1.2) b.carve(cell, "wood");
      else b.fill(cell, "lava", -0.2);
    }
  }
  for (const h of halls) b.put(hex(h.at.q - 2, h.at.r - 1), "forge");
  return rooms;
};
