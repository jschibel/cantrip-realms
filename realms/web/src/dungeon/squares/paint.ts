// The dungeons' own colors and pictures: their floors (64 by 64, seamless, seeded, as every surface), their walls'
// faces, and the pictures their props wear. Painted from ramps dark to light, as the slice paints.

import * as C from "../../art/paint/colors";
import { crack, fbm, valueNoise } from "../../art/paint/procedural";
import { Pixmap, type Rgb, hash2, rgb, seeded } from "../../art/paint/pixmap";
import * as T from "../../art/paint/textures";

const ramp = (...hex: string[]): Rgb[] => hex.map(rgb);

/** Cave rock: cold grey-brown. */
export const CAVE = ramp("#16131c", "#26212c", "#3a323c", "#52484e", "#6c6060", "#887a72", "#a89884");
/** A cave's floor: packed earth and grit. */
export const CAVE_EARTH = ramp("#1e1612", "#30241c", "#463424", "#5c462e", "#745a38", "#8e7046");
/** Castle stone: warm limestone gone grey in the dark. */
export const KEEP = ramp("#1e1a24", "#322c36", "#4a4248", "#665c5c", "#847870", "#a49684", "#c4b49c");
/** Marble: pale, with violet veins. */
export const MARBLE = ramp("#2a2838", "#4a4658", "#706c7c", "#9894a0", "#bcb8c0", "#dcd8dc", "#f4f0f0");
/** The tower's blue-grey stone (Tolarian). */
export const TOWER = ramp("#141626", "#20243a", "#30364e", "#444c66", "#5c6680", "#7a849c", "#9ca6ba");
/** Living wood and root. */
export const ROOT = ramp("#140c0c", "#24160f", "#382214", "#4e3218", "#68441e", "#845a28", "#a47438");
/** Moss and the hollow's leaf-litter. */
export const MOSS = ramp("#0a160e", "#122416", "#1a361c", "#264a22", "#38622a", "#4e7c32", "#6c9a3c");
/** Foundry stone, soot-black, warmed by the lava. */
export const SOOT = ramp("#0e0a0c", "#1a1214", "#2a1c1c", "#3c2824", "#50362c", "#684636", "#865a42");
/** Lava: dark crust to white heat. */
export const LAVA_RAMP = ramp("#3a0a08", "#7a1810", "#c03a14", "#f07a20", "#ffb838", "#fff08a", "#ffffe0");
/** Phyrexian plating: oily blue-black steel. */
export const PLATE = ramp("#0e0e16", "#1a1a26", "#282838", "#3a3c50", "#50566c", "#6c748a", "#96a0b6");
/** Phyrexian sinew and oil: sick violet and red. */
export const SINEW = ramp("#1a0812", "#30101e", "#4a182a", "#682438", "#883448", "#a84a5a", "#c86a70");
/** Portal glow: Phyrexian green. */
export const ICHOR = ramp("#06180e", "#0c2c18", "#145022", "#20782c", "#38a038", "#68cc4c", "#b0f080");
/** Crystal, cold blue to white. */
export const CRYSTAL = ramp("#101838", "#18285c", "#22408c", "#3466c0", "#4e94e0", "#82c4f4", "#d0f0ff");

// --- Floors ----------------------------------------------------------------------------------------------------------

/** Mottled ground in bands of a ramp: earth, moss, ash. */
function mottled(r: readonly Rgb[], seed: number, cell = 12): Pixmap {
  const p = new Pixmap(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const n = fbm(x, y, cell, 64, seed);
      let c = n < 0.3 ? r[1]! : n < 0.5 ? r[2]! : n < 0.72 ? r[3]! : r[4]!;
      if (hash2(x, y, seed) < 0.05) c = r[Math.max(0, r.indexOf(c) - 1)]!;
      if (hash2(x, y, seed + 9) < 0.02) c = r[Math.min(r.length - 1, r.indexOf(c) + 1)]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A cave's floor: packed earth in soft patches, flat stones bedded in it, a little grit. */
export function caveFloor(seed = 41): Pixmap {
  const p = new Pixmap(64, 64);
  const e = CAVE_EARTH;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const n = fbm(x, y, 16, 64, seed);
      let c = n < 0.38 ? e[2]! : n < 0.62 ? e[3]! : e[4]!;
      if (hash2(x, y, seed) < 0.035) c = e[1]!;
      else if (hash2(x, y, seed + 3) < 0.02) c = e[5]!;
      p.set(x, y, c);
    }
  }
  // Flat stones: rounded slabs, lit on top, a shadow under.
  const random = seeded(seed);
  for (let k = 0; k < 9; k++) {
    const cx = Math.floor(random() * 64);
    const cy = Math.floor(random() * 64);
    const rx = 3 + random() * 3;
    const ry = 2 + random() * 2;
    for (let dy = -4; dy <= 5; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const d = (dx / rx) ** 2 + (dy / ry) ** 2;
        if (d <= 1) p.set(cx + dx, cy + dy, dy < -ry * 0.5 ? CAVE[5]! : d > 0.7 && dx > 0 ? CAVE[3]! : CAVE[4]!);
        else if (d <= 1.5 && dy > 0) p.set(cx + dx, cy + dy, e[1]!);
      }
    }
  }
  return p;
}

/** Polished marble squares with veins, a dark joint between them. */
export function marble(seed = 42, r: readonly Rgb[] = MARBLE): Pixmap {
  const p = new Pixmap(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const tile = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
      const n = valueNoise(x + y * 0.6, y, 9, 64, seed + tile);
      let c = tile ? r[4]! : r[3]!;
      if (Math.abs(n - 0.5) < 0.035) c = tile ? r[2]! : r[1]!;
      else if (n > 0.78) c = tile ? r[5]! : r[4]!;
      if (x % 16 === 0 || y % 16 === 0) c = r[1]!;
      else if (x % 16 === 1 || y % 16 === 1) c = tile ? r[5]! : r[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** The hollow's floor: moss over leaf-litter, roots crossing it. */
export function mossFloor(seed = 43): Pixmap {
  const p = mottled(MOSS, seed, 10);
  const random = seeded(seed);
  for (let k = 0; k < 5; k++) {
    let x = Math.floor(random() * 64);
    let y = Math.floor(random() * 64);
    for (let s = 0; s < 22; s++) {
      p.set(x, y, ROOT[3]!);
      p.set(x, y + 1, ROOT[1]!);
      x += 1;
      if (random() < 0.3) y += random() < 0.5 ? 1 : -1;
    }
  }
  for (let k = 0; k < 30; k++) {
    const x = Math.floor(random() * 64);
    const y = Math.floor(random() * 64);
    p.set(x, y, random() < 0.5 ? C.GOLD[2]! : ROOT[5]!);
  }
  return p;
}

/** Soot-black flags, embers dying in the joints: the foundry's floor. */
export function ashFloor(seed = 44): Pixmap {
  const p = T.flagstones(ASH, seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (p.get(x, y) === ASH[0] && hash2(x, y, seed) < 0.12) p.set(x, y, hash2(x, y, seed + 1) < 0.3 ? LAVA_RAMP[3]! : LAVA_RAMP[1]!);
  return p;
}

/** The foundry's floor stone: cold iron-grey under the soot. */
export const ASH = ramp("#0a090c", "#16141a", "#221f26", "#2e2a32", "#3a353e", "#48424a", "#58515a");

/** An iron grating: the foundry's gantries over the lava. */
export function grating(): Pixmap {
  const p = new Pixmap(64, 64);
  const iron = C.IRON;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      let c = (x + y) % 4 < 2 ? iron[2]! : iron[1]!;
      if (x % 8 === 0) c = iron[4]!;
      else if (x % 8 === 1) c = iron[3]!;
      else if (x % 8 === 7) c = iron[0]!;
      if (y % 16 === 0) c = iron[5]!;
      if (y % 16 === 15) c = iron[1]!;
      if (y % 16 === 2 && x % 8 === 4) c = iron[6]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Phyrexian plates: oily steel in hexagonal-ish panels, seams of sinew, rivets. */
export function plates(seed = 45): Pixmap {
  const p = new Pixmap(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const row = Math.floor(y / 16);
      const sx = (x + (row % 2) * 8) % 16;
      const sy = y % 16;
      const n = fbm(x, y, 8, 64, seed);
      let c = n > 0.62 ? PLATE[4]! : n > 0.36 ? PLATE[3]! : PLATE[2]!;
      // A sheen across each plate.
      if (sx + sy === 6 || sx + sy === 7) c = PLATE[5]!;
      if (sx === 0 || sy === 0) c = SINEW[2]!;
      else if (sx === 1 || sy === 1) c = PLATE[5]!;
      else if (sx === 15 || sy === 15) c = PLATE[1]!;
      if ((sx === 3 || sx === 12) && (sy === 3 || sy === 12)) c = PLATE[6]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Crystal tiles, faceted and pale: the portal's bridges, the tower's rift floors. */
export function crystalFloor(seed = 46, r: readonly Rgb[] = CRYSTAL): Pixmap {
  const p = new Pixmap(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const sx = x % 16;
      const sy = y % 16;
      let c = sx > sy ? r[3]! : r[2]!;
      if (sx + sy === 15 || sx === sy) c = r[4]!;
      if (sx === 0 || sy === 0) c = r[1]!;
      if (hash2(x, y, seed) < 0.03) c = r[5]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** The time-rift's floor: dark tiles torn by glowing cracks. */
export function riftFloor(seed = 47): Pixmap {
  const p = marble(seed, TOWER);
  const random = seeded(seed);
  for (let k = 0; k < 9; k++) crack(p, Math.floor(random() * 64), Math.floor(random() * 64), 6 + Math.floor(random() * 8), CRYSTAL[5]!, random, CRYSTAL[3]!);
  return p;
}

/** Lava: the crust's dark plates over glowing seams, scrolled a texel at a time. */
export function lava(seed = 48): Pixmap {
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = fbm(x, y, 8, 32, seed);
      const m = fbm(x, y, 4, 32, seed + 5);
      let c = n < 0.38 ? LAVA_RAMP[1]! : n < 0.5 ? LAVA_RAMP[2]! : n < 0.66 ? LAVA_RAMP[3]! : LAVA_RAMP[4]!;
      if (m > 0.7 && n < 0.5) c = LAVA_RAMP[0]!;
      if (n > 0.8) c = LAVA_RAMP[5]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Still black water with a cold glint: a flooded tomb, an underground lake. */
export function darkWater(seed = 49): Pixmap {
  const w = C.WATER;
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = fbm(x, y * 2, 8, 32, seed);
      p.set(x, y, n < 0.42 ? w[1]! : n < 0.66 ? w[2]! : w[3]!);
    }
  }
  // Ripples: lit dashes with a pale crest, and glints.
  const random = seeded(seed);
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(random() * 32);
    const y = Math.floor(random() * 32);
    const len = 3 + Math.floor(random() * 4);
    for (let i = 0; i < len; i++) p.set(x + i, y, w[4]!);
    for (let i = 1; i < len - 1; i++) p.set(x + i, y - 1, w[5]!);
    p.set(x + len, y + 1, w[2]!);
    if (random() < 0.45) p.set(x + 1, y - 2, w[6]!);
  }
  return p;
}

/** Plain black: under a stairwell's hole. */
export const black = (): Pixmap => new Pixmap(4, 4, 0x050408);

// --- Walls -----------------------------------------------------------------------------------------------------------

/** Cave rock seen face on: strata and cracks, 32 by 32. */
export function caveRock(seed = 51): Pixmap {
  const p = new Pixmap(32, 32);
  const random = seeded(seed);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      // Lumps of rock: lit on their upper left, shadowed under, in no courses.
      const n = fbm(x, y, 6, 32, seed);
      const up = fbm(x - 1, y - 1, 6, 32, seed);
      let c = n < 0.32 ? CAVE[2]! : n < 0.55 ? CAVE[3]! : n < 0.75 ? CAVE[4]! : CAVE[5]!;
      if (up > n + 0.05) c = CAVE[1]!;
      else if (n > up + 0.05) c = CAVE[Math.min(6, CAVE.indexOf(c) + 1)]!;
      if (hash2(x, y, seed) < 0.04) c = CAVE[1]!;
      p.set(x, y, c);
    }
  }
  for (let k = 0; k < 9; k++) crack(p, Math.floor(random() * 32), Math.floor(random() * 32), 3 + Math.floor(random() * 5), CAVE[0]!, random, CAVE[5]!);
  return p;
}

/** The tops of cave walls: rough rock, darker in its hollows, lit on its crests. */
export function caveTop(seed = 57): Pixmap {
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = fbm(x, y, 8, 32, seed);
      const m = fbm(x + 1, y + 1, 8, 32, seed);
      let c = n < 0.4 ? CAVE[0]! : n < 0.62 ? CAVE[1]! : CAVE[2]!;
      if (n > m + 0.03) c = CAVE[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Living roots woven into a wall: twisting trunks side by side, dark between, 32 by 32. */
export function rootWall(seed = 52): Pixmap {
  const p = new Pixmap(32, 32, ROOT[0]!);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const sway = Math.round(Math.sin((y / 32) * Math.PI * 2 + (Math.floor(x / 8) * 1.7)) * 1.5);
      const sx = (x + sway + 32) % 8;
      let c: Rgb = ROOT[0]!;
      if (sx >= 1 && sx <= 6) c = sx === 1 ? ROOT[5]! : sx === 2 ? ROOT[4]! : sx >= 5 ? ROOT[2]! : ROOT[3]!;
      if (sx >= 2 && sx <= 5 && valueNoise(x, y * 2, 4, 32, seed) > 0.72) c = ROOT[2]!;
      if (hash2(x, y, seed) < 0.025) c = MOSS[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Riveted iron plates over soot-black stone: the foundry's wall band. */
export function ironBand(): Pixmap {
  const p = new Pixmap(16, 16, C.IRON[2]!);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = y < 2 ? C.IRON[4]! : y > 13 ? C.IRON[1]! : C.IRON[2]!;
      if (x === 0) c = C.IRON[1]!;
      if (x === 1) c = C.IRON[3]!;
      if ((x === 4 || x === 12) && (y === 4 || y === 11)) c = C.IRON[5]!;
      if (hash2(x, y, 3) < 0.05) c = SOOT[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Phyrexian wall plating: tall ribbed panels, sinew between. */
export function ribs(seed = 53): Pixmap {
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const sx = x % 8;
      let c = sx < 2 ? PLATE[4]! : sx < 5 ? PLATE[3]! : PLATE[2]!;
      if (sx === 7) c = SINEW[2]!;
      if (y % 16 === 0) c = PLATE[1]!;
      if (y % 16 === 1) c = PLATE[5]!;
      if (hash2(x, y, seed) < 0.03) c = SINEW[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

// --- Pictures ----------------------------------------------------------------------------------------------------------

/** A stair's dark way up: an arch of dressed stone round darkness, steps going up into it, 16 by 24. */
export function archway(stone: readonly Rgb[]): Pixmap {
  const p = new Pixmap(16, 24);
  p.fill(0, 0);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const inside = y > 7 ? Math.abs(dx) < 6 : dx * dx + (y - 8) * (y - 8) < 36;
      const frame = y > 5 ? Math.abs(dx) < 8 : dx * dx + (y - 8) * (y - 8) < 64;
      if (inside) p.set(x, y, y > 16 ? (y % 3 === 0 ? stone[3]! : stone[1]!) : 0x07060c);
      else if (frame) p.set(x, y, (x + y) % 4 === 0 ? stone[3]! : stone[4]!);
    }
  }
  return p;
}

/** A heraldic banner in the keep's colors: red with a gold sun. */
export function keepBanner(): Pixmap {
  const p = new Pixmap(12, 28);
  p.fill(0, 0);
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 12; x++) {
      if (y > 23 && Math.abs(x - 5.5) < y - 23) continue;
      let c = x === 0 || x === 11 ? C.GOLD[3]! : x === 3 || x === 8 ? C.RED[2]! : C.RED[3]!;
      if (y < 2) c = C.GOLD[y === 0 ? 4 : 2]!;
      p.set(x, y, c);
    }
  }
  for (const [x, y] of [[5, 9], [6, 9], [4, 10], [7, 10], [4, 11], [7, 11], [5, 12], [6, 12], [5, 7], [6, 14], [2, 10], [9, 11]] as const) p.set(x, y, C.GOLD[4]!);
  return p;
}

/** A glowing rift in time: a tear of blue-white light with shards round it, 16 by 24, cut out. */
export function rift(frame: number): Pixmap {
  const p = new Pixmap(16, 24);
  p.fill(0, 0);
  const random = seeded(7 + frame);
  for (let y = 0; y < 24; y++) {
    const half = Math.sin((y / 23) * Math.PI) * (3 + frame * 0.5);
    const mid = 7.5 + Math.sin(y * 0.7 + frame) * 1.2;
    for (let x = 0; x < 16; x++) {
      const d = Math.abs(x - mid);
      if (d < half * 0.35) p.set(x, y, CRYSTAL[6]!);
      else if (d < half * 0.7) p.set(x, y, CRYSTAL[5]!);
      else if (d < half) p.set(x, y, CRYSTAL[4]!);
    }
  }
  for (let k = 0; k < 6; k++) p.set(Math.floor(random() * 16), Math.floor(random() * 24), CRYSTAL[5]!);
  return p;
}

/** A crystal's face: pale facets, 8 by 16. */
export function crystalFace(r: readonly Rgb[]): Pixmap {
  const p = new Pixmap(8, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) p.set(x, y, x < 3 ? r[5]! : x < 5 ? r[4]! : r[3]!);
  for (let y = 0; y < 16; y += 5) p.set(1, y, r[6]!);
  return p;
}

/** A glowing mushroom cap's top, 8 by 8. */
export function capTop(r: readonly Rgb[]): Pixmap {
  const p = new Pixmap(8, 8, r[4]!);
  for (const [x, y] of [[2, 2], [5, 3], [3, 5], [6, 6], [1, 5]] as const) p.set(x, y, r[6]!);
  return p;
}

/** The praetor's sigil inlaid in the floor: a ring and the Phyrexian mark, 32 by 32, cut out. */
export function sigil(): Pixmap {
  const p = new Pixmap(32, 32);
  p.fill(0, 0);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = Math.hypot(x - 15.5, y - 15.5);
      if (r > 13 && r < 15) p.set(x, y, ICHOR[4]!);
      else if (Math.abs(x - 15.5) < 1 && y > 4 && y < 27) p.set(x, y, ICHOR[5]!);
      else if (Math.abs(r - 8) < 0.8 && y < 16) p.set(x, y, ICHOR[4]!);
    }
  }
  return p;
}
