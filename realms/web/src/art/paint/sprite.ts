import { Pixmap, type Rgb } from "./pixmap";

// Hand-authored pixel art as text: each character of a row is a texel, its color looked up in a legend; a space or a
// dot is transparent. Small things - a face, an emblem, a skull - are drawn this way by hand, texel by texel.

export function sprite(rows: readonly string[], legend: Readonly<Record<string, Rgb>>): Pixmap {
  const width = Math.max(...rows.map((r) => r.length));
  const p = new Pixmap(width, rows.length);
  p.fill(0, 0);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === " " || ch === ".") continue;
      const color = legend[ch];
      if (color === undefined) throw new Error(`sprite: no color for "${ch}"`);
      p.put(x, y, color);
    }
  });
  return p;
}

/** Mirrors a picture left to right. */
export function mirror(p: Pixmap): Pixmap {
  const out = new Pixmap(p.width, p.height);
  out.fill(0, 0);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) out.put(p.width - 1 - x, y, p.get(x, y), p.alpha(x, y));
  return out;
}
