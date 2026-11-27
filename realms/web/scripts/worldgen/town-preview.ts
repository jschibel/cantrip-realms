// The towns of layout.json at walking scale before the travel map exists (`npx vite-node
// scripts/worldgen/town-preview.ts [town-id ...] [--no-world]`): each built by the town generator (town/) in a pocket of
// its own on the setting the travel map gives it (town/preview.ts, `TOWN_SETTINGS`), drawn from above into e2e/screenshots/world2/town-<id>.png, and written as a standalone version-2 world -
// world.json, the chunks where there is ground, the interiors - into realms/web/town-preview/ (gitignored), which the
// game opens with `?world=towns&at=<town-id>`.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INVENTED_SETTINGS, TOWN_SETTINGS, buildAll, buildOn, drawBuildings, picture, readVendors, settingsMatrix, writeWorld } from "./town/preview";
import { generate } from "./generate";
import { Picture } from "./picture";
import { readLayout } from "./layout";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
if (process.argv.includes("--settings")) {
  // The travel map's settings, as the world generator derives them, into town/settings.json (what the preview and the
  // town tests build on); worldgen.test.ts holds the file to what the generator derives.
  const roster = readdirSync(join(web, "..", "content", "dominaria", "mobs")).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(web, "..", "content", "dominaria", "mobs", f), "utf8")));
  generate(readLayout(), roster, readVendors(), () => {}, undefined, {
    onSettings: (s) => {
      writeFileSync(join(web, "scripts", "worldgen", "town", "settings.json"), `${JSON.stringify(s, null, 2)}\n`);
      console.log(`wrote the settings of ${Object.keys(s).length} towns`);
      process.exit(0);
    },
  });
}
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--matrix")) {
  // Every town named (all by default) on its real setting, its invented one and each of the settings matrix's, strictly:
  // what breaks, one line each.
  const all = ids.length > 0 ? ids : readLayout().towns.map((t) => t.id);
  let broken = 0;
  let count = 0;
  let rowsFallback = 0;
  for (const id of all) {
    const cases = [{ name: "real", setting: TOWN_SETTINGS[id]! }, { name: "invented", setting: INVENTED_SETTINGS[id]! }, ...settingsMatrix()];
    const only = process.argv.find((a) => a.startsWith("--case="))?.slice(7);
    for (const c of cases) {
      if (only && !c.name.includes(only)) continue;
      count++;
      try {
        const { town: t } = buildOn(id, c.setting);
        if (t.report.notes.some((n) => n.startsWith("laid out in rows"))) {
          rowsFallback++;
          console.log(`${id} [${c.name}]: laid out in rows`);
        }
      } catch (e) {
        if (process.argv.includes("--draw")) {
          // The broken town drawn as far as it goes, to look at.
          try {
            const { town, land } = buildOn(id, c.setting, undefined, true);
            const p = picture(land, town, 5);
            drawBuildings(p, town, 0, 0, 5, town.npcs);
            mkdirSync(join(web, "test-results", "matrix"), { recursive: true });
            writeFileSync(join(web, "test-results", "matrix", `${id}-${c.name.replace(/[^a-z0-9]+/gi, "-")}.png`), p.png());
          } catch (e2) {
            console.log(`  (not drawn: ${(e2 as Error).message.slice(0, 200)})`);
          }
        }
        broken++;
        console.log(`${id} [${c.name}]: ${(e as Error).message.split("\n").slice(0, 3).join(" | ").slice(0, 300)}`);
      }
    }
  }
  console.log(`${broken} of ${count} broken, ${rowsFallback} laid out in rows`);
  process.exit(broken > 0 ? 1 : 0);
}
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
{
  // A contact sheet: the towns named (all by default) side by side, each its walked ground from above at 3 pixels a tile.
  const S = 3;
  const cell = 200;
  const cols = 4;
  const sheet = new Picture(cols * cell * S, Math.ceil(towns.length / cols) * cell * S);
  towns.forEach((t, k) => {
    const [gx0, gz0, gx1, gz1] = t.data.grounds;
    const cx = Math.floor((gx0 + gx1) / 2);
    const cz = Math.floor((gz0 + gz1) / 2);
    const crop = [cx - cell / 2, cz - cell / 2, cx + cell / 2, cz + cell / 2] as const;
    const clipped = [Math.max(gx0, crop[0]), Math.max(gz0, crop[1]), Math.min(gx1, crop[2]), Math.min(gz1, crop[3])] as const;
    const p = picture(land, t, S, clipped);
    drawBuildings(p, t, clipped[0], clipped[1], S, []);
    const ox = (k % cols) * cell * S + (clipped[0] - crop[0]) * S;
    const oy = Math.floor(k / cols) * cell * S + (clipped[1] - crop[1]) * S;
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      const o = (y * p.width + x) * 3;
      sheet.set(ox + x, oy + y, [p.pixels[o]!, p.pixels[o + 1]!, p.pixels[o + 2]!]);
    }
  });
  writeFileSync(join(shots, ids.length > 0 ? "towns-sheet-some.png" : "towns-sheet.png"), sheet.png());
}
if (!process.argv.includes("--no-world")) writeWorld(join(web, "town-preview"), land, towns, size);
