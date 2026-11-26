// Where each town's grounds lie: a pocket of its own east of the travel map (interfaces.md, "Two scales"), whole
// chunks, at least POCKET_GAP empty chunks from the travel map and from every other pocket. Packed in columns, tallest
// first: each column as tall as the travel map (or the tallest pocket), a new column when the next will not fit.

import { CHUNK, type Rect } from "../../src/world/format";
import { POCKET_GAP } from "../../src/world/lint";

/** Each pocket's rectangle, by id, and the world's size that holds the travel map and them all. */
export function packPockets(travel: Rect, sizes: readonly { readonly id: string; readonly size: readonly [number, number] }[]): { rects: Map<string, Rect>; size: [number, number] } {
  const gap = POCKET_GAP * CHUNK;
  const order = [...sizes].sort((a, b) => b.size[1] - a.size[1] || b.size[0] - a.size[0] || a.id.localeCompare(b.id));
  const limit = Math.max(travel[3] - travel[1], ...sizes.map((s) => s.size[1]));
  const rects = new Map<string, Rect>();
  let x = Math.ceil((travel[2] + gap) / CHUNK) * CHUNK;
  let z = travel[1];
  let width = 0;
  for (const { id, size } of order) {
    const [w, h] = size;
    if (w % CHUNK || h % CHUNK) throw new Error(`${id}: grounds ${w} by ${h} are not whole chunks`);
    if (z > travel[1] && z + h > travel[1] + limit) {
      x += width + gap;
      z = travel[1];
      width = 0;
    }
    rects.set(id, [x, z, x + w, z + h]);
    z += h + gap;
    width = Math.max(width, w);
  }
  let W = travel[2];
  let H = travel[3];
  for (const r of rects.values()) {
    W = Math.max(W, r[2]);
    H = Math.max(H, r[3]);
  }
  return { rects, size: [W, H] };
}
