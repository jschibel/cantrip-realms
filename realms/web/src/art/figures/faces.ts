import type { Pixmap, Rgb } from "../paint/pixmap";
import { sprite } from "../paint/sprite";
import type { Paint } from "./rig";

// Painting a figure's faces: each part's face is a small picture painted by these - cloth in a ramp with a shaded hem,
// rows and stamps of hand-drawn texels, hair with a ragged edge, spikes cut out of a top edge - layered one over another.

/** Fills a face in a ramp's color with a lit top-left edge and a shadowed bottom-right one. */
export function cloth(ramp: readonly Rgb[], at: number, edges = true): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        let c = ramp[at]!;
        if (edges && y === p.height - 1) c = ramp[Math.max(0, at - 1)]!;
        p.set(x, y, c);
      }
    }
  };
}

export const layer =
  (...paints: (Paint | undefined)[]): Paint =>
  (p) => {
    for (const paint of paints) paint?.(p);
  };

export const rows =
  (y0: number, y1: number, color: Rgb): Paint =>
  (p) => {
    for (let y = y0; y <= y1; y++) for (let x = 0; x < p.width; x++) p.put(x, y, color);
  };

export const stamp =
  (art: readonly string[], legend: Record<string, Rgb>, x: number, y: number): Paint =>
  (p) =>
    p.blit(sprite(art, legend), x, y);

/** Hair across a face's top rows, with a ragged lower edge (cut out where `cut`). */
export function hairRows(ramp: readonly Rgb[], depth: (x: number) => number, cutAbove = -1): Paint {
  return (p) => {
    for (let x = 0; x < p.width; x++) {
      const d = depth(x);
      for (let y = 0; y < d; y++) {
        let c = ramp[3]!;
        if (y === d - 1) c = ramp[1]!;
        else if ((x + y) % 5 === 0) c = ramp[4]!;
        else if ((x * 3 + y) % 7 === 0) c = ramp[2]!;
        p.put(x, y, c);
      }
      for (let y = 0; y < cutAbove; y++) p.put(x, y, 0, 0);
    }
  };
}

/** A whole face of hair, streaked. */
export function hairAll(ramp: readonly Rgb[]): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        // Locks of hair: strands running down in a darker tone, parted into clumps.
        let c = ramp[3]!;
        if ((x + Math.floor(y / 2)) % 4 === 0) c = ramp[2]!;
        if (x % 4 === 1 && y % 3 === 0) c = ramp[4]!;
        p.set(x, y, c);
      }
    }
  };
}

/**
 * Hair seen from above, as 16-bit sprites paint it: clumps with dark parting lines, and a band of shine across the
 * crown (rows from the back of the head, at the top of the picture, to the front, at the bottom).
 */
export function hairCrown(ramp: readonly Rgb[]): Paint {
  return (p) => {
    const shine = Math.floor(p.height * 0.55);
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        let c = ramp[3]!;
        if ((x + Math.floor(y / 2)) % 4 === 0) c = ramp[2]!;
        if ((y === shine || y === shine + 1) && x % 4 !== 0 && x > 0 && x < p.width - 1) c = ramp[y === shine ? 4 : 5] ?? ramp[4]!;
        if (y === p.height - 1) c = ramp[2]!;
        p.set(x, y, c);
      }
    }
  };
}

/** Spikes along a face's top edge: cut out between them. */
export function spikes(period: number, height: number): Paint {
  return (p) => {
    for (let x = 0; x < p.width; x++) {
      const phase = x % period;
      const h = Math.round(height * (1 - Math.abs(phase - (period - 1) / 2) / ((period - 1) / 2 + 0.5)));
      for (let y = 0; y < height - h; y++) p.put(x, y, 0, 0);
    }
  };
}

