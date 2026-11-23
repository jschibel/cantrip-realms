// Prints the art library's ids as Markdown, for realms/docs/conversion.md's "Art ids": every surface with its priority,
// every catalogued (outdoor) prop with its footprint and biomes, every building style's kinds and showcase sizes, and the
// named palettes. Run: npx vite-node scripts/art-ids.ts
import { BUILDINGS, SHOWCASE } from "../src/art/buildings";
import { PALETTES } from "../src/art/paint/palette";
import { PROP_CATALOGUE } from "../src/art/props";
import { SURFACE_GROUPS, SURFACES } from "../src/art/surfaces";

const lines: string[] = [];
const say = (s = "") => lines.push(s);

say("#### Surfaces");
say();
say("| Group | Id (priority; hole; tufts) |");
say("| --- | --- |");
const grouped = new Set<string>();
for (const [group, ids] of Object.entries(SURFACE_GROUPS)) {
  say(`| ${group} | ${ids.map((id) => {
    grouped.add(id);
    const l = SURFACES.look(id);
    return `\`${id}\` (${l.priority}${l.hole ? "; hole" : ""}${l.tufts ? `; tufts ${l.tufts}` : ""})`;
  }).join(", ")} |`);
}
const rest = SURFACES.ids().filter((id) => !grouped.has(id));
if (rest.length) say(`| indoors | ${rest.map((id) => `\`${id}\` (${SURFACES.look(id).priority})`).join(", ")} |`);
say();

say("#### Props (outdoors)");
say();
say("Footprint: `WxD` tiles about the anchor (unturned; `rect` offsets where not centred), `line` (x, z to args.to, its width) or `area` (x, z to args.to); **B** blocks walking. `tilesOf(prop)` gives the tiles.");
say();
say("| Category | Id | Footprint | Biomes | Light |");
say("| --- | --- | --- | --- | --- |");
const cats = [...new Set([...PROP_CATALOGUE.values()].map((p) => p.category))].sort();
for (const cat of cats) {
  for (const p of [...PROP_CATALOGUE.values()].filter((q) => q.category === cat)) {
    const f = p.footprint;
    let fp: string;
    if ("rect" in f) {
      const [x0, z0, x1, z1] = f.rect;
      const centred = Math.abs(x0 + x1) < 1e-9 && Math.abs(z0 + z1) < 1e-9;
      fp = centred ? `${+(x1 - x0).toFixed(2)}x${+(z1 - z0).toFixed(2)}` : `rect [${f.rect.join(", ")}]`;
    } else if ("line" in f) fp = `line ${f.line}`;
    else fp = "area";
    say(`| ${cat} | \`${p.id}\` | ${fp}${f.blocks ? " **B**" : ""} | ${p.biomes.join(", ")} | ${p.light ? `at [${p.light.at.join(", ")}]` : ""} |`);
  }
}
say();

say("#### Building styles");
say();
say("| Style | Kinds at their showcase footprints (w x d tiles, facing south) |");
say("| --- | --- |");
for (const s of BUILDINGS.ids()) {
  const show = SHOWCASE[s] ?? [];
  say(`| \`${s}\` | ${show.map((k) => `${k.kind}${k.label ? ` (${k.label})` : ""} ${k.w}x${k.d}`).join(", ")} |`);
}
say();

say("#### Named palettes");
say();
say([...PALETTES.keys()].map((k) => `\`${k}\``).join(", "));

console.log(lines.join("\n"));
