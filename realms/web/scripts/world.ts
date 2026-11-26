// Writes Dominaria (design.md A6): `npm run world` runs the seeded world generator (worldgen/generate.ts) on the plane's
// geography (realms/content/dominaria/geography.json: the travel map's sketch) and layout (layout.json: its towns' and
// dungeons' definitions) and writes realms/content/dominaria/world/ (world.json and a chunk for every chunk of ground),
// interiors/ and dungeons/ in the version-2 format
// (realms/docs/interfaces.md, "Version 2 of the world data"), removing files of those directories it no longer writes. Each file is checked as the
// loader checks it (world/lint.ts) before anything is written. The same layout, seed and mob roster give the same files;
// after the roster changes (realms/content/dominaria/mobs/*.json), a rerun is all it takes for the spawns to name its mobs.

import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChunkKey } from "../src/world/format";
import { checkChunk, checkInterior, checkWorld } from "../src/world/lint";
import { type Vendor, generate } from "./worldgen/generate";
import { readLayout } from "./worldgen/layout";
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
const result = generate(readLayout(), roster, vendors, (text) => console.log(`  ${text} (${Math.round(performance.now() - started)} ms)`));

let bad = 0;
for (const [path, text] of result.files) {
  const data: unknown = JSON.parse(text);
  const name = path.slice(path.lastIndexOf("/") + 1, -".json".length);
  const at = parseChunkKey(name);
  const problems = path.startsWith("world/chunks/") && at ? checkChunk(data, at.cx, at.cz) : path.startsWith("interiors/") ? checkInterior(data, name) : path === "world/world.json" ? checkWorld(data) : [];
  if (problems.length > 0) {
    bad++;
    console.error(`${path}:\n  ${problems.slice(0, 12).join("\n  ")}`);
  }
}
if (bad) {
  console.error(`${bad} files with problems; nothing written`);
  process.exit(1);
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
// The towns' settings, as this world laid them, beside the town generator (its tests and preview build on them).
{
  const file = join(here, "worldgen", "town", "settings.json");
  const text = `${JSON.stringify(result.settings, null, 2)}\n`;
  let old: string | null = null;
  try {
    old = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    old = null;
  }
  if (old !== text) {
    writeFileSync(file, text);
    console.log("world.ts: the towns' settings changed (scripts/worldgen/town/settings.json)");
  }
}
console.log(`world.ts: ${result.files.size} files (${written} changed) in ${Math.round(performance.now() - started)} ms`);
console.log(`  ${Object.entries(result.stats).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`  mobs: ${result.mobs.length}`);
for (const note of result.notes) console.log(`  note: ${note}`);
