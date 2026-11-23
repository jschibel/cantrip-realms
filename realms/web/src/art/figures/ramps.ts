import * as C from "../paint/colors";
import type { Ramp } from "../paint/palette";
import { type Rgb, rgb } from "../paint/pixmap";

// Ramps for figures from the content's colors. A gear item's `look.palette` and a mob's `model.palette` are plain colors
// (`#rrggbb`); a figure paints from ramps, dark to light with the hue shifting as it goes - shadows to violet and blue,
// lights to yellow - as the slice's own ramps (paint/colors.ts) do. `rampOf` makes one about a color; the player's
// skin, hair and identity ramps are here too, so a character is drawn in the same kind of colors as everything else.

/** Every ramp a figure paints from has seven steps: 0 darkest, 3 the color itself, 6 its highlight. */
export const STEPS = 7;

function hsl(c: Rgb): [number, number, number] {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (to(f(0)) << 16) | (to(f(8)) << 8) | to(f(4));
}

/** Turns a hue towards another by up to `by` degrees, the short way round. */
function toward(h: number, target: number, by: number): number {
  let d = target - h;
  d = ((d + 540) % 360) - 180;
  const step = Math.sign(d) * Math.min(Math.abs(d), by);
  return (h + step + 360) % 360;
}

/**
 * A seven-step ramp about a color (`at` is the step that is the color itself): darker steps cooler and richer,
 * lighter ones warmer and paler, as a 16-bit artist ramps a color.
 */
export function rampOf(color: string | Rgb, at = 3): Rgb[] {
  const c = typeof color === "string" ? rgb(color) : color;
  const [h, s, l] = hsl(c);
  const out: Rgb[] = [];
  const room = Math.max(0.04, 0.97 - l);
  for (let i = 0; i < STEPS; i++) {
    const d = i - at;
    if (d === 0) {
      out.push(c);
      continue;
    }
    if (d < 0) {
      const n = -d;
      const li = Math.max(0.04, l - n * Math.min(0.12, (l - 0.03) / (at + 0.5)));
      // A grey stays grey into its shadows: black is black, never violet.
      const si = s < 0.08 ? s : Math.min(1, Math.max(s * (1 + 0.1 * n), 0.06 * n));
      const hi = s < 0.08 ? 250 : toward(h, 255, 9 * n);
      out.push(fromHsl(hi, si, li));
    } else {
      const li = Math.min(0.98, l + d * Math.min(0.09, room / (STEPS - 1 - at)));
      const si = Math.max(0, s * (1 - 0.12 * d));
      const hi = s < 0.08 ? h : toward(h, 52, 7 * d);
      out.push(fromHsl(hi, si, li));
    }
  }
  return out;
}

/** A ramp made safe to index at any step to seven: every step where it was, its lightest repeated past its end. */
export function full(ramp: Ramp): Ramp {
  if (ramp.length >= STEPS) return ramp;
  const out: Rgb[] = [...ramp];
  while (out.length < STEPS) out.push(ramp[ramp.length - 1]!);
  return out;
}

/** The step of a ramp, clamped: `at(r, 9)` is its lightest. */
export const at = (r: Ramp, i: number): Rgb => r[Math.max(0, Math.min(r.length - 1, i))]!;

/** A color lightened (t > 0) or darkened (t < 0) along its own ramp, by steps. */
export function shade(c: Rgb, steps: number): Rgb {
  return at(rampOf(c), 3 + steps);
}

// --- The player's colors (design.md A1) -----------------------------------------------------------------------------

/** A skin ramp: its face at step 4, as the slice's SKIN. */
function skinRamp(hex: string): Rgb[] {
  return rampOf(hex, 4);
}

/**
 * The six skin-and-hair palettes a character is made with, in order (the presence `Look`'s `Palette` 0-5): the first two
 * are the slice's own skin, with its hero's brown and red hair.
 */
export const SKINS: readonly { readonly name: string; readonly skin: Ramp; readonly hair: Ramp }[] = [
  { name: "Fair, brown hair", skin: full(C.SKIN), hair: full(C.HAIR_BROWN) },
  { name: "Fair, red hair", skin: full(C.SKIN), hair: full(C.HAIR_RED) },
  { name: "Olive, black hair", skin: skinRamp("#e0aa7a"), hair: rampOf("#2a2a3a") },
  { name: "Bronze, black hair", skin: skinRamp("#c28252"), hair: rampOf("#3a2418") },
  { name: "Umber, dark hair", skin: skinRamp("#9a5c38"), hair: rampOf("#262232") },
  { name: "Deep, silver hair", skin: skinRamp("#6e3e2a"), hair: rampOf("#c4c8d4") },
];

export type ManaColor = "W" | "U" | "B" | "R" | "G";
export const MANA: readonly ManaColor[] = ["W", "U", "B", "R", "G"];

/**
 * Each color's cloth: saturated, in hues the land does not use (no grass green, no earth brown), so a character stands
 * out from wherever they stand. White is cream and gold; black is black, trimmed silver; green is an emerald far bluer
 * and brighter than grass.
 */
export const IDENTITY: Readonly<Record<ManaColor, Ramp>> = {
  W: rampOf("#f2ead0"),
  U: full(C.BLUE),
  B: rampOf("#2a2a2d"),
  R: full(C.RED),
  G: rampOf("#1ed27a"),
};

/** The trim beside each color: gold on white, and a deeper step of the color itself otherwise. */
export const IDENTITY_TRIM: Readonly<Record<ManaColor, Ramp>> = {
  W: full(C.GOLD),
  U: rampOf("#f4d04c"),
  B: rampOf("#b8bcc4"),
  R: full(C.GOLD),
  G: rampOf("#e8f4a0"),
};

/** The colorless character's grey. */
export const COLORLESS: Ramp = rampOf("#9aa0b4");

/** The cloth and trim of a color identity (letters in WUBRG order): the first color's cloth, the second's as trim. */
export function identityRamps(identity: string): { cloth: Ramp; trim: Ramp } {
  const colors = [...identity.toUpperCase()].filter((c): c is ManaColor => (MANA as readonly string[]).includes(c));
  const first = colors[0];
  const second = colors[1];
  if (!first) return { cloth: COLORLESS, trim: rampOf("#5a5e70") };
  return { cloth: IDENTITY[first], trim: second ? IDENTITY[second] : IDENTITY_TRIM[first] };
}

/** A content palette (`#rrggbb` strings) as ramps; a color past those given is the last given (interfaces.md `$n`). */
export function rampsOf(palette: readonly string[], count: number, fallback: readonly string[]): Ramp[] {
  const colors = palette.length > 0 ? palette : fallback;
  const out: Ramp[] = [];
  for (let i = 0; i < count; i++) out.push(rampOf(colors[Math.min(i, colors.length - 1)] ?? fallback[Math.min(i, fallback.length - 1)]!));
  return out;
}

/** A stable hash of a string, for seeding a figure's choices from an id. */
export function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
