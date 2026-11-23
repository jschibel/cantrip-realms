// Mage tower (coasts and islands: Tolaria; and the mage towers whose waystones carry travellers): a round floor, a
// ring corridor round the stair column, rooms off it - libraries of shelves and time-rift rooms of crystal - and on
// the top floor the mage's open hall.

import { distance, hex } from "../../hex";
import { type Carver, type FloorBuilder, type FloorRequest, type Look, type Room } from "../floor";
import { around } from "./common";

export const TOWER_LOOK: Look = { floor: "wood", wall: "stone", wallHeight: 2.2, decor: ["bookshelf", "crystal", "table"], lights: true };

const O = hex(0, 0);

export const carveTower: Carver = (b: FloorBuilder, request: FloorRequest) => {
  const R = 14;
  if (request.floor === request.floors - 1) {
    // The mage's hall: the whole floor open, pillars round it, crystal at its heart.
    b.disc(O, R - 1);
    for (let k = 0; k < 12; k++) b.put(around(O, R - 4, (k / 12) * Math.PI * 2), "pillar");
    b.disc(O, 2, "crystal");
    const start = b.random() * Math.PI * 2;
    return [
      { at: around(O, R - 3, start), size: 2 },
      { at: around(O, 8, start + 2.2), size: 2 },
      { at: around(O, 8, start - 2.2), size: 2 },
      { at: O, size: 3 },
    ];
  }
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      const d = distance(hex(q, r), O);
      if (d >= 7 && d <= 8) b.carve(hex(q, r), "stone");
    }
  }
  const rooms: Room[] = [];
  const start = b.random() * Math.PI * 2;
  for (let s = 0; s < 6; s++) {
    const a = start + ((s + 0.5) / 6) * Math.PI * 2;
    const centre = around(O, 11, a);
    const library = s % 2 === 0;
    b.disc(centre, 2, library ? "wood" : "crystal");
    b.corridor(around(O, 8, a), centre, 0);
    if (library) for (const side of [1, -1]) b.put(around(O, 11.5, a + side * 0.2), "bookshelf");
    else b.put(around(O, 12, a), "crystal");
    rooms.push({ at: centre, size: 2 });
  }
  // The study by the stair column, through one gap in its wall.
  b.disc(O, 3, "marble");
  b.corridor(O, around(O, 7, start), 0);
  rooms.splice(2, 0, { at: O, size: 3 });
  return rooms;
};
