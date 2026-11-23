import * as C from "../paint/colors";
import type { Ramp } from "../paint/palette";
import { Pixmap, type Rgb, hash2 } from "../paint/pixmap";
import { cloth, layer } from "./faces";
import { at } from "./ramps";
import type { Paint, PartFaces, PartSpec } from "./rig";

// More face painters for the figures beyond the slice's cast (faces.ts holds the slice's own): textures - fur, scales,
// feathers, bark, stone, plates - and the helpers every builder shares, a part from its numbers and a face mirrored for
// the far side. Everything is painted texel by texel from ramps, seeded by position so it is the same on every load.

export type V3 = readonly [number, number, number];

/** A part: its name, size, pivot (on its parent), where its box sits on the pivot, faces and fill, and anything more. */
export function part(name: string, size: V3, at3: V3, box: V3, faces: PartFaces, fill: Rgb, more: Partial<PartSpec> = {}): PartSpec {
  return { name, size, at: at3, box, faces, fill, ...more };
}

/** A face painted mirrored, left for right: a side face authored with its back at x = 0 serves the figure's left side. */
export function flipX(paint: Paint): Paint {
  return (p) => {
    const tmp = new Pixmap(p.width, p.height);
    tmp.copy(p, 0, 0, p.width, p.height, 0, 0);
    paint(tmp);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) p.set(p.width - 1 - x, y, tmp.get(x, y), tmp.alpha(x, y));
  };
}

/** Faces for a part of one stuff: `front`, sides a step darker, top a step lighter. */
export function solid(ramp: Ramp, step = 3, paint?: Paint): PartFaces {
  return {
    front: layer(cloth(ramp, step), paint),
    back: layer(cloth(ramp, step - 1), paint),
    left: layer(cloth(ramp, step), paint),
    top: cloth(ramp, Math.min(step + 1, ramp.length - 1), false),
    bottom: cloth(ramp, Math.max(0, step - 2), false),
  };
}

/** The same paint on every side, a lighter top. */
export function allSides(paint: Paint, top?: Paint): PartFaces {
  return { front: paint, back: paint, left: paint, right: paint, top: top ?? paint, bottom: paint };
}

/** Speckles of other steps over a face: fur, stone, moss. `density` of texels changed, `seed` for the pattern. */
export function speckle(ramp: Ramp, steps: readonly number[], density: number, seed = 1): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const h = hash2(x, y, seed);
        if (h < density) p.put(x, y, at(ramp, steps[Math.floor((h / density) * steps.length) % steps.length]!));
      }
    }
  };
}

/** Fur: short strokes downward, light tips. */
export function fur(ramp: Ramp, base = 3, seed = 3): Paint {
  return layer(cloth(ramp, base), (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const h = hash2(x, Math.floor(y / 2), seed);
        if (h < 0.22) p.put(x, y, at(ramp, base - 1));
        else if (h > 0.86 && y % 2 === 0) p.put(x, y, at(ramp, base + 1));
      }
    }
  });
}

/** Scales: rows of little arcs, offset each row, a light edge on each. */
export function scales(ramp: Ramp, base = 3): Paint {
  return layer(cloth(ramp, base), (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const row = Math.floor(y / 2);
        const cx = (x + (row % 2) * 2) % 4;
        if (y % 2 === 1 && cx !== 0) p.put(x, y, at(ramp, base - 1));
        else if (y % 2 === 0 && cx === 2) p.put(x, y, at(ramp, base + 1));
      }
    }
  });
}

/** Feathers: rows of long feathers pointing down, each with a dark edge and a light quill; the bottom edge scalloped. */
export function feathers(ramp: Ramp, base = 3, cut = true): Paint {
  return layer(cloth(ramp, base), (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const band = Math.floor(y / 3);
        const fx = (x + band) % 3;
        if (fx === 0) p.put(x, y, at(ramp, base - 1));
        else if (fx === 1 && y % 3 === 0) p.put(x, y, at(ramp, base + 1));
      }
    }
    if (cut) for (let x = 0; x < p.width; x++) if (x % 3 === 0) p.put(x, p.height - 1, 0, 0);
  });
}

/** Bark: vertical grain, knots, a few deep cracks. */
export function bark(ramp: Ramp, base = 3, seed = 5): Paint {
  return layer(cloth(ramp, base), (p) => {
    for (let x = 0; x < p.width; x++) {
      const groove = hash2(x, 0, seed) < 0.35;
      for (let y = 0; y < p.height; y++) {
        if (groove && hash2(x, Math.floor(y / 3), seed + 1) < 0.8) p.put(x, y, at(ramp, base - 2));
        else if (hash2(x, y, seed + 2) < 0.1) p.put(x, y, at(ramp, base + 1));
      }
    }
  });
}

/** Stone: blocks of two tones with dark seams. */
export function stone(ramp: Ramp, base = 3, seed = 7): Paint {
  return layer(cloth(ramp, base), (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const bx = Math.floor((x + (Math.floor(y / 4) % 2) * 2) / 4);
        const by = Math.floor(y / 4);
        if (y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 2) % 4 === 3) p.put(x, y, at(ramp, base - 2));
        else if (hash2(bx, by, seed) < 0.4) p.put(x, y, at(ramp, base - 1));
        else if (hash2(x, y, seed + 9) < 0.08) p.put(x, y, at(ramp, base + 1));
      }
    }
  });
}

/** Plates of armor: bands across with a lit upper edge and a dark lower one, rivets at the ends. */
export function plates(ramp: Ramp, band = 3, base = 4): Paint {
  return layer(cloth(ramp, base), (p) => {
    for (let y = 0; y < p.height; y++) {
      const k = y % band;
      for (let x = 0; x < p.width; x++) {
        if (k === 0) p.put(x, y, at(ramp, base + 1));
        else if (k === band - 1) p.put(x, y, at(ramp, base - 2));
      }
      if (k === 1 && p.width > 3) {
        p.put(0, y, at(ramp, base + 2));
        p.put(p.width - 1, y, at(ramp, base + 2));
      }
    }
  });
}

/** Mail: a checker of rings, a lit row at the shoulders. */
export function mail(ramp: Ramp): Paint {
  return layer(cloth(ramp, 3), (p) => {
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y) % 2 === 0) p.set(x, y, at(ramp, 2));
  });
}

/** A ragged lower edge: cut out every `period`th texel of the last `depth` rows, deeper in places. */
export function ragged(period = 3, depth = 1, seed = 11): Paint {
  return (p) => {
    for (let x = 0; x < p.width; x++) {
      const d = x % period === 1 ? depth + (hash2(x, 0, seed) < 0.4 ? 1 : 0) : hash2(x, 1, seed) < 0.25 ? 1 : 0;
      for (let y = p.height - d; y < p.height; y++) p.put(x, y, 0, 0);
    }
  };
}

/** A whole face of light: for glowing parts, a bright middle and a paler rim. */
export function glowing(ramp: Ramp): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const edge = x === 0 || y === 0 || x === p.width - 1 || y === p.height - 1;
        p.set(x, y, at(ramp, edge ? 4 : 6));
      }
    }
  };
}

/** A shape cut out of a face: texels where `inside(x, y, w, h)` is false are made clear. */
export function cutTo(inside: (x: number, y: number, w: number, h: number) => boolean): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (!inside(x, y, p.width, p.height)) p.put(x, y, 0, 0);
  };
}

/** A tapering point at a face's top: cut away the corners above a triangle (a hat's cone, a horn's tip, an ear). */
export const pointUp = cutTo((x, y, w, h) => Math.abs(x - (w - 1) / 2) <= ((y + 1) / h) * (w / 2) + 0.01);

/** Two eyes on a face of width `w` with the eyes' lower row at `row`: glint and pupil, or a glow. */
export function eyes(w: number, row: number, style: { color?: Rgb; glint?: boolean; size?: 1 | 2; apart?: number } = {}): Paint {
  return (p) => {
    const apart = style.apart ?? 0;
    const lx = Math.round(w / 2) - 4 - apart;
    const rx = w - lx - 2;
    const color = style.color ?? C.INK;
    const size = style.size ?? 2;
    for (const ex of [lx, rx]) {
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < 2; dx++) p.put(ex + dx, row - dy, color);
      if (style.glint ?? !style.color) p.put(ex === lx ? ex : ex + 1, row - size + 1, 0xffffff);
    }
  };
}
