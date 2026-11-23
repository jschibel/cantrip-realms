import { it } from "vitest";
import { PROP_CATALOGUE, PROPS } from "../art/props";
const tri = (m: { parts: readonly { indices: readonly number[] }[] }) => m.parts.reduce((n, p) => n + p.indices.length / 3, 0);
it("tris", () => {
  const out: string[] = [];
  for (const [id, info] of PROP_CATALOGUE) {
    if (!["tree", "plant"].includes(info.category)) continue;
    const b = PROPS.build(id, { ...info.sample, id, x: 5.5, z: 5.5 });
    out.push(`T ${id} ${tri(b.model)} ${b.far ? tri(b.far) : "-"}`);
  }
  console.log(out.join("\n"));
});
