// How heavy the travel map's miniatures are: every peak and grove of the checked-in world built as the game builds it,
// their count and triangles (near; and far, where a prop has a far stand-in). `npx vite-node scripts/peak-triangles.ts`
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROPS } from "../src/art/props";
import type { ChunkData } from "../src/world/format";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "..", "content", "dominaria", "world", "chunks");
const props = readdirSync(dir).flatMap((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as ChunkData).props);
const triangles = (m: { parts: readonly { indices: ArrayLike<number> }[] }) => m.parts.reduce((n, p) => n + p.indices.length / 3, 0);
const cache = new Map<string, [number, number]>();
for (const id of ["peak", "grove"]) {
  let count = 0;
  let near = 0;
  let far = 0;
  const byW = new Map<number, number>();
  for (const p of props) {
    if (p.id !== id) continue;
    count++;
    if (id === "peak") byW.set(p.args?.w as number, (byW.get(p.args?.w as number) ?? 0) + 1);
    const key = JSON.stringify({ a: p.args, s: p.seed, sc: p.scale });
    let t = cache.get(key);
    if (!t) {
      const b = PROPS.build(id, { ...p, x: 0.5, z: 0.5 });
      t = [triangles(b.model), b.far ? triangles(b.far) : triangles(b.model)];
      cache.set(key, t);
    }
    near += t[0];
    far += t[1];
  }
  console.log(`${id}: ${count} (${[...byW].sort((a, b) => a[0] - b[0]).map(([w, n]) => `w${w} ${n}`).join(", ")}), ${near} triangles near, ${far} far`);
}
