// Writes the two-scale fixture (fixtures/two-world/source.ts) as a world's files, for the realm server's tests to read:
// fixtures/two-world/files/{world/world.json, world/chunks/<cx>_<cz>.json, interiors/<id>.json, dungeons/<id>.json}.
//
//     npm run two-world
//
// src/world/scales.test.ts checks the files are what the source makes (the props aside, which the art decides).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { twoFiles } from "../fixtures/two-world/source";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "two-world", "files");
rmSync(out, { recursive: true, force: true });
const files = twoFiles();
for (const [path, data] of files) {
  const file = join(out, ...path.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data)}\n`);
}
console.log(`two-world: ${files.size} files in ${out}`);
