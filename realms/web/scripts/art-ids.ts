// Prints the art library's ids as Markdown, for realms/docs/tech.md B5's "Art ids": every surface with its priority,
// every catalogued (outdoor) prop with its footprint and biomes, every building style's kinds and showcase sizes, and the
// named palettes. Run: npx vite-node scripts/art-ids.ts
import { BUILDINGS, SHOWCASE } from "../src/art/buildings";
import { PALETTES } from "../src/art/paint/palette";
import { PROP_CATALOGUE, PROPS, tilesOf } from "../src/art/props";
import { SURFACE_GROUPS, SURFACES } from "../src/art/surfaces";
import type { PropData } from "../src/world/format";

/** A prop's example at (10.5, 10.5), its args' `to` taken as an offset (as the gallery and the tests take it). */
function example(id: string): PropData {
  const s = PROP_CATALOGUE.get(id)!.sample;
  const to = s.args?.to as [number, number] | undefined;
  const gate = s.args?.gate as [number, number] | undefined;
  const args = s.args ? { ...s.args, ...(to ? { to: [10.5 + to[0], 10.5 + to[1]] } : {}), ...(gate ? { gate: [10.5 + gate[0], 10.5 + gate[1]] } : {}) } : undefined;
  return { ...s, id, x: 10.5, z: 10.5, ...(args ? { args } : {}) };
}

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
say("Far: triangles near / far (Built.far, the far zoom step's stand-in) for the dense vegetation.");
say();
say("Footprint: `WxD` tiles about the anchor (unturned; `rect` offsets where not centred), `line` (x, z to args.to, its width) or `area` (x, z to args.to); **B** blocks walking. `tilesOf(prop)` gives the tiles.");
say();
say("| Category | Id | Footprint | Biomes | Light | Far |");
say("| --- | --- | --- | --- | --- | --- |");
const cats = [...new Set([...PROP_CATALOGUE.values()].map((p) => p.category))].sort();
for (const cat of cats) {
  for (const p of [...PROP_CATALOGUE.values()].filter((q) => q.category === cat)) {
    const f = p.footprint;
    let fp: string;
    if ("rect" in f && f.scaleOf) {
      // A square sized by its args (the travel map's miniatures): its example's size.
      fp = `args square (${f.scaleOf(example(p.id))})`;
    } else if ("rect" in f) {
      const [x0, z0, x1, z1] = f.rect;
      const centred = Math.abs(x0 + x1) < 1e-9 && Math.abs(z0 + z1) < 1e-9;
      fp = centred ? `${+(x1 - x0).toFixed(2)}x${+(z1 - z0).toFixed(2)}` : `rect [${f.rect.join(", ")}]`;
    } else if ("line" in f) fp = `line ${f.line}`;
    else if ("sized" in f) {
      const t = tilesOf({ id: p.id, x: 0, z: 0 }).tiles;
      fp = `args.w x args.d from x, z (${Math.max(...t.map((q) => q[0])) + 1}x${Math.max(...t.map((q) => q[1])) + 1})`;
    } else fp = "area";
    const built = PROPS.build(p.id, example(p.id));
    const tris = (m: { parts: readonly { indices: readonly number[] }[] }) => m.parts.reduce((n, q) => n + q.indices.length / 3, 0);
    say(`| ${cat} | \`${p.id}\` | ${fp}${f.blocks ? " **B**" : ""} | ${p.biomes.join(", ")} | ${p.light ? `at [${p.light.at.join(", ")}]` : ""} | ${built.far ? `${tris(built.model)} / ${tris(built.far)}` : ""} |`);
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
