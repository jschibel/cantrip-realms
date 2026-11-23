// Writes Dominaria (design.md A6): `npm run world` runs the seeded world generator (worldgen/generate.ts) and writes
// realms/content/dominaria/world/ (world.json and every chunk), interiors/ and dungeons/, removing files of those
// directories it no longer writes. The same seed and mob roster give the same files; after the roster changes
// (realms/content/dominaria/mobs/*.json), a rerun is all it takes for the spawns to name its mobs.

import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateChunk, validateDungeon, validateInterior } from "../src/world/schema";
import { type Vendor, generate } from "./worldgen/generate";
import type { MobFile } from "./worldgen/wilds";

const here = dirname(fileURLToPath(import.meta.url));
const plane = join(here, "..", "..", "content", "dominaria");

const readAll = <T>(dir: string): T[] =>
  readdirSync(join(plane, dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(plane, dir, f), "utf8")) as T);

const started = performance.now();
const roster = readAll<MobFile>("mobs");
const vendors = readAll<Vendor>("vendors");
const result = generate(roster, vendors, undefined, (text) => console.log(`  ${text} (${Math.round(performance.now() - started)} ms)`));

let bad = 0;
for (const [path, text] of result.files) {
  const data: unknown = JSON.parse(text);
  const problems = path.startsWith("world/chunks/") ? validateChunk(data) : path.startsWith("interiors/") ? validateInterior(data) : path.startsWith("dungeons/") ? validateDungeon(data) : [];
  if (problems.length > 0) {
    bad++;
    console.error(`${path}:\n  ${problems.slice(0, 12).join("\n  ")}`);
  }
}

for (const dir of ["world/chunks", "world", "interiors", "dungeons"]) {
  mkdirSync(join(plane, dir), { recursive: true });
  for (const file of readdirSync(join(plane, dir))) {
    if (file.endsWith(".json") && !result.files.has(`${dir}/${file}`)) unlinkSync(join(plane, dir, file));
  }
}
let written = 0;
for (const [path, text] of result.files) {
  const file = join(plane, path);
  let old: string | null = null;
  try {
    old = readFileSync(file, "utf8");
  } catch {
    old = null;
  }
  if (old !== text) {
    writeFileSync(file, text);
    written++;
  }
}
console.log(`world.ts: ${result.files.size} files (${written} changed) in ${Math.round(performance.now() - started)} ms`);
console.log(`  ${Object.entries(result.stats).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`  mobs: ${result.mobs.join(", ")}`);
if (bad) {
  console.error(`${bad} files with problems`);
  process.exitCode = 1;
}
