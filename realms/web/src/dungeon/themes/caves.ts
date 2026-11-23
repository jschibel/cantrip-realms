// Caves (mountains and hills: Keld, the Hurloon and Ironclaw Mountains): winding caverns grown by a cellular automaton,
// chambers joined by passages that wander, an underground lake, a chasm, stalagmites.

import { DIRECTIONS, distance, hex } from "../../hex";
import { type Carver, type FloorBuilder, type Look, REACH, type Room } from "../floor";
import { spread } from "./common";

export const CAVES_LOOK: Look = { floor: "dirt", wall: "rock", wallHeight: 2.4, decor: ["rock", "boulder", "crystal", "bones", "mushroom"], lights: false };

export const carveCaves: Carver = (b: FloorBuilder) => {
  const R = REACH - 3;
  const alive = new Map<string, boolean>();
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) if (distance(hex(q, r), hex(0, 0)) <= R) alive.set(`${q},${r}`, b.random() < 0.52);
  for (let round = 0; round < 4; round++) {
    const next = new Map<string, boolean>();
    for (const [k, on] of alive) {
      const [q, r] = k.split(",").map(Number);
      const n = DIRECTIONS.filter((d) => alive.get(`${q! + d.q},${r! + d.r}`)).length;
      next.set(k, on ? n >= 3 : n >= 4);
    }
    for (const [k, on] of next) alive.set(k, on);
  }
  for (const [k, on] of alive) {
    if (!on) continue;
    const [q, r] = k.split(",").map(Number);
    b.carve(hex(q!, r!));
  }
  // Chambers, spread out, joined one to the next by wandering passages, so the whole is one cave.
  const rooms: Room[] = spread(b, 7, 9, R - 3).map((at) => ({ at, size: 2 + Math.floor(b.random() * 2) }));
  for (const room of rooms) b.disc(room.at, room.size);
  for (let i = 1; i < rooms.length; i++) b.corridor(rooms[i - 1]!.at, rooms[i]!.at, 0, undefined, 0.35);
  // An underground lake at a chamber's side, and a chasm.
  const lake = rooms[Math.floor(rooms.length / 2)]!;
  const pool = hex(lake.at.q + 3, lake.at.r - 1);
  for (const d of [hex(0, 0), ...DIRECTIONS]) {
    const h = hex(pool.q + d.q, pool.r + d.r);
    if (b.open(h) && b.safe(h)) b.fill(h, "water", -0.1);
  }
  const chasm = rooms[rooms.length - 2] ?? lake;
  for (const d of [hex(-3, 2), hex(-3, 3), hex(-4, 3)]) {
    const gap = hex(chasm.at.q + d.q, chasm.at.r + d.r);
    if (b.open(gap) && b.safe(gap)) b.fill(gap, "deep-water", -0.6);
  }
  return rooms;
};
