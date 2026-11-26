// The towns of layout.json at walking scale before the travel map exists (`npx vite-node
// scripts/worldgen/town-preview.ts [town-id ...] [--no-world]`): each built by the town generator (town/) in a pocket of
// its own on a setting made up from the canon (town/preview.ts, `TOWN_SETTINGS`), checked (town/check.ts throws on a rule
// broken), drawn from above into e2e/screenshots/world2/town-<id>.png, and written as a standalone version-2 world -
// world.json, the chunks where there is ground, the interiors - into realms/web/town-preview/ (gitignored), which the
// game opens with `?world=towns&at=<town-id>`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll, drawBuildings, picture, writeWorld } from "./town/preview";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const t0 = performance.now();
const { land, towns, size } = buildAll(ids, undefined, process.argv.includes("--lenient"));
console.log(`built ${towns.length} towns in ${Math.round(performance.now() - t0)} ms`);
const shots = join(web, "e2e", "screenshots", "world2");
mkdirSync(shots, { recursive: true });
for (const t of towns) {
  // The walked ground and a little of the apron round it.
  const xs = t.data.ways.flatMap((w) => w.exit.map(([x]) => x));
  const zs = t.data.ways.flatMap((w) => w.exit.map(([, z]) => z));
  const [gx0, gz0, gx1, gz1] = t.data.grounds;
  const c = t.data.center;
  const reach = t.data.radius + 24;
  const crop = [Math.max(gx0, Math.min(c[0] - reach, ...xs) - 4), Math.max(gz0, Math.min(c[1] - reach, ...zs) - 4), Math.min(gx1, Math.max(c[0] + reach, ...xs) + 5), Math.min(gz1, Math.max(c[1] + reach, ...zs) + 5)] as const;
  const scale = t.data.kind === "capital" ? 5 : t.data.kind === "town" ? 6 : 8;
  const p = picture(land, t, scale, crop);
  drawBuildings(p, t, crop[0], crop[1], scale, t.npcs);
  writeFileSync(join(shots, `town-${t.data.id}.png`), p.png());
  const r = t.report;
  console.log(`${t.data.id.padEnd(18)} walled ${r.walled.join("x")} grounds ${r.grounds.join("x")} buildings ${r.buildings} interiors ${r.interiors} gate->square ${r.gateToSquare} square->place ${r.squareToPlace}${r.notes.length ? `\n    ${r.notes.join("\n    ")}` : ""}`);
}
if (!process.argv.includes("--no-world")) writeWorld(join(web, "town-preview"), land, towns, size);
