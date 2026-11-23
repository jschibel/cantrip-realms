import { SURFACES } from "./art/surfaces";

// The color a surface reads as from far above - the maps' (hud.ts): its picture's average, or the water's own for a
// hole (whose picture is only its edge).

const WATER: Readonly<Record<string, string>> = {
  sea: "#22557c",
  shallows: "#3d7bb0",
  stream: "#3d6fb8",
  river: "#3d6fb8",
  lake: "#33689f",
  bog: "#2f3b2c",
  lava: "#d2521e",
  oil: "#1c1622",
};

const known = new Map<string, string>();

export function surfaceColor(id: string): string {
  let c = known.get(id);
  if (c) return c;
  c = WATER[id];
  if (!c) {
    try {
      const p = SURFACES.look(id).picture;
      let r = 0;
      let g = 0;
      let b = 0;
      const n = p.width * p.height;
      for (let i = 0; i < n; i++) {
        r += p.data[i * 4]!;
        g += p.data[i * 4 + 1]!;
        b += p.data[i * 4 + 2]!;
      }
      const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
      c = `#${hex(r)}${hex(g)}${hex(b)}`;
    } catch {
      c = "#5a6a50";
    }
  }
  known.set(id, c);
  return c;
}
