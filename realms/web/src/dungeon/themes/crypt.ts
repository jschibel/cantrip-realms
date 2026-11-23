// Crypt (swamps and dark realms: the Caligo Morass, Amjad): catacombs dug as a maze of narrow ways, ossuaries where
// they meet, flooded tombs, coffins and bones along the walls.

import { type Hex, hex } from "../../hex";
import { type Carver, type FloorBuilder, type Look, type Room } from "../floor";
import { hexAt } from "./common";

export const CRYPT_LOOK: Look = { floor: "stone", wall: "ash", wallHeight: 2.4, decor: ["coffin", "bones", "coffin", "pillar"], lights: true };

export const carveCrypt: Carver = (b: FloorBuilder) => {
  // A maze on a coarse grid of cells 11 world units apart, dug by a walk that turns back when stuck.
  const N = 5;
  const cellAt = (i: number, j: number): Hex => hexAt((i - (N - 1) / 2) * 11, (j - (N - 1) / 2) * 11);
  const seen = new Set<string>(["0,0"]);
  const stack: [number, number][] = [[0, 0]];
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (stack.length > 0) {
    const [i, j] = stack.at(-1)!;
    const next = steps.map(([di, dj]) => [i + di, j + dj] as const).filter(([a, c]) => a >= 0 && c >= 0 && a < N && c < N && !seen.has(`${a},${c}`));
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const [a, c] = next[Math.floor(b.random() * next.length)]!;
    seen.add(`${a},${c}`);
    b.corridor(cellAt(i, j), cellAt(a, c), 0);
    stack.push([a, c]);
  }
  // A few loops, so it is not all dead ends.
  for (let k = 0; k < 4; k++) {
    const i = Math.floor(b.random() * (N - 1));
    const j = Math.floor(b.random() * N);
    b.corridor(cellAt(i, j), cellAt(i + 1, j), 0);
  }
  // Ossuaries at the corners and some crossings; a flooded tomb or two.
  const rooms: Room[] = [];
  const order: [number, number][] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) order.push([i, j]);
  order.sort((x, y) => x[0] + x[1] - (y[0] + y[1]) || x[0] - y[0]);
  for (const [i, j] of order) {
    const corner = (i === 0 && j === 0) || (i === N - 1 && j === N - 1);
    if (!corner && b.random() > 0.45) continue;
    const at = cellAt(i, j);
    b.disc(at, corner ? 2 : 1 + Math.floor(b.random() * 2));
    rooms.push({ at, size: 2 });
    if (!corner && b.random() < 0.35) {
      const pool = hex(at.q + 1, at.r);
      if (b.open(pool) && b.safe(pool)) b.fill(pool, "swamp", -0.1);
    }
  }
  return rooms;
};
