// What the themes' generators share.

import { type Hex, distance, hex } from "../../hex";
import type { FloorBuilder } from "../floor";

/** The hex nearest a point of the ground plane, in world units. */
export function hexAt(x: number, z: number): Hex {
  const q = (2 / 3) * x;
  const r = (-1 / 3) * x + (Math.sqrt(3) / 3) * z;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  if (Math.abs(rq - q) > Math.abs(rr - r) && Math.abs(rq - q) > Math.abs(rs - s)) rq = -rr - rs;
  else if (Math.abs(rr - r) > Math.abs(rs - s)) rr = -rq - rs;
  return hex(rq + 0, rr + 0);
}

/** The hex `radius` hexes from `centre` at an angle (radians) of the ground plane. */
export function around(centre: Hex, radius: number, angle: number): Hex {
  const q = centre.q * 1.5;
  const z = Math.sqrt(3) * (centre.r + centre.q / 2);
  return hexAt(q + Math.cos(angle) * radius * Math.sqrt(3), z + Math.sin(angle) * radius * Math.sqrt(3));
}

/**
 * `count` hexes within `within` of the middle, at least `apart` from each other, chained from the one farthest to a
 * side, each next the nearest not yet taken: rooms in a winding order.
 */
export function spread(b: FloorBuilder, count: number, apart: number, within: number): Hex[] {
  const found: Hex[] = [];
  for (let tries = 0; tries < 800 && found.length < count; tries++) {
    const h = around(hex(0, 0), b.random() * within, b.random() * Math.PI * 2);
    if (distance(h, hex(0, 0)) > within) continue;
    if (found.some((f) => distance(f, h) < apart)) continue;
    found.push(h);
  }
  const start = found.sort((p, q) => p.q - q.q || p.r - q.r)[0];
  if (!start) return [];
  const chain = [start];
  const left = found.slice(1);
  while (left.length > 0) {
    const last = chain.at(-1)!;
    left.sort((p, q) => distance(p, last) - distance(q, last) || p.q - q.q || p.r - q.r);
    chain.push(left.shift()!);
  }
  return chain;
}
