import * as C from "./colors";
import { crack, fbm, valueNoise } from "./paint";
import { Pixmap, type Rgb, hash2, seeded } from "./pixmap";
import { sprite } from "./sprite";

// The painted pictures of single things, fitted onto their faces (kit.ts): doors, windows, the shop's sign and display,
// banners, crates and barrels, the market's awning and produce, furniture, the hearth, the rug, and the crypt's stone.
// Each is painted at the scene's texel density (16 to a tile), so it sits beside the tiling surfaces at the same pixel
// size. Where a few texels have to be exactly right - a goblin's grin, a crest, a skull - they are drawn by hand
// (sprite.ts); the rest is painted by code.

const T = 0; // transparent: alpha 0

/** An arched oak door in a limestone surround, 20 by 32: planks, iron straps, a ring, a worn sill. */
export function door(seed = 1, leaf: readonly Rgb[] = C.WOOD): Pixmap {
  const p = new Pixmap(20, 32);
  const l = C.LIMESTONE;
  // The surround: blocks up each side and a round arch with a keystone.
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 20; x++) {
      const course = Math.floor(y / 5);
      const edge = y % 5 === 0;
      let c = l[4]!;
      if (edge) c = l[2]!;
      else if (y % 5 === 1) c = l[5]!;
      else if (y % 5 === 4) c = l[3]!;
      if ((x === 0 || x === 19) && !edge) c = course % 2 ? l[3]! : l[4]!;
      p.set(x, y, c);
    }
  }
  // The arch: the opening's top is a half circle from row 2.
  const inside = (x: number, y: number) => {
    if (x < 2 || x > 17) return false;
    if (y >= 9) return true;
    const dx = x - 9.5;
    const dy = y - 9;
    return dx * dx + dy * dy * 1.3 <= 64;
  };
  const ring = (x: number, y: number) => {
    const dx = x - 9.5;
    const dy = y - 9;
    const d = Math.sqrt(dx * dx + dy * dy * 1.3);
    return d > 8 && d <= 10.2 && y < 10;
  };
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 20; x++) {
      if (ring(x, y)) p.set(x, y, x === 9 || x === 10 ? l[5]! : (Math.atan2(y - 9, x - 9.5) * 4) % 1 > 0.85 ? l[2]! : l[4]!);
      if (!inside(x, y)) continue;
      // The leaf: four planks.
      const plank = Math.floor((x - 2) / 4);
      const px = (x - 2) % 4;
      let c = [leaf[4]!, leaf[3]!, leaf[4]!, leaf[5]!][plank] ?? leaf[4]!;
      if (px === 0) c = leaf[2]!;
      if (px === 1) c = plank === 3 ? leaf[6]! : leaf[5]!;
      if (hash2(x, y, seed) < 0.08) c = leaf[3]!;
      if (!inside(x, y - 1)) c = leaf[1]!;
      p.set(x, y, c);
    }
  }
  // Iron straps with nails, and the ring.
  const iron = C.IRON;
  for (const sy of [12, 25]) {
    for (let x = 2; x < 18; x++) {
      p.set(x, sy, iron[3]!);
      p.set(x, sy + 1, iron[2]!);
      if (x % 4 === 3) p.set(x, sy, iron[5]!);
    }
  }
  p.set(14, 18, iron[4]!);
  p.set(13, 19, iron[4]!);
  p.set(15, 19, iron[2]!);
  p.set(14, 20, iron[2]!);
  // A dark threshold.
  for (let x = 2; x < 18; x++) p.set(x, 31, leaf[0]!);
  return p;
}

/** A window in a limestone frame, 16 by 18: four panes of sky-tinted glass with glints, a sill below. */
export function windowPicture(lit = false): Pixmap {
  const p = new Pixmap(16, 18);
  const l = C.LIMESTONE;
  const w = C.WOOD;
  p.fill(l[4]!);
  // Lintel and sill.
  for (let x = 0; x < 16; x++) {
    p.set(x, 0, l[5]!);
    p.set(x, 1, l[4]!);
    p.set(x, 2, l[2]!);
    p.set(x, 15, l[6]!);
    p.set(x, 16, l[4]!);
    p.set(x, 17, l[2]!);
  }
  for (let y = 3; y < 15; y++) {
    p.set(0, y, l[5]!);
    p.set(15, y, l[3]!);
    for (let x = 1; x < 15; x++) {
      const frame = x === 1 || x === 14 || x === 7 || x === 8 || y === 3 || y === 14 || y === 8;
      if (frame) {
        p.set(x, y, x === 8 || x === 14 || y === 14 ? w[2]! : w[4]!);
        continue;
      }
      const glass = lit ? (y < 8 ? C.GOLD[4]! : C.GOLD[3]!) : y < 6 ? C.WATER[3]! : y < 11 ? C.WATER[2]! : C.WATER[1]!;
      p.set(x, y, glass);
    }
  }
  // Glints across each pane.
  const glint = lit ? C.GOLD[5]! : C.WATER[5]!;
  for (const [gx, gy] of [
    [3, 6],
    [10, 6],
    [3, 12],
    [10, 12],
  ] as const) {
    p.set(gx, gy, glint);
    p.set(gx + 1, gy - 1, glint);
    p.set(gx + 2, gy - 2, lit ? C.GOLD[4]! : C.WATER[4]!);
  }
  return p;
}

/** Shutters, 6 by 14: painted boards with a cross brace. */
export function shutter(ramp: readonly Rgb[] = C.TEAL): Pixmap {
  const p = new Pixmap(6, 14);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 6; x++) {
      let c = x % 2 === 0 ? ramp[3]! : ramp[2]!;
      if (y === 0 || y === 13 || y === 6 || y === 7) c = y === 7 || y === 13 ? ramp[1]! : ramp[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A goblin's face on a hanging signboard, 16 by 14, for Grizzlegom's Goblins. */
export function goblinSign(): Pixmap {
  const g = C.GOBLIN;
  const w = C.WOOD;
  const board = new Pixmap(16, 14);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 16; x++) {
      let c = y % 4 === 0 ? w[4]! : w[5]!;
      if (x === 0 || y === 0) c = w[6]!;
      if (x === 15 || y === 13) c = w[2]!;
      if (x === 1 || y === 1 || x === 14 || y === 12) c = x === 14 || y === 12 ? w[3]! : w[5]!;
      board.set(x, y, c);
    }
  }
  const face = sprite(
    [
      "a.........a",
      "ga.bbbbb.ag",
      ".gabcccbag.",
      "..bcwcwcb..",
      "..bcKcKcb..",
      "..bccdccb..",
      "...bWrWb...",
      "....bbb....",
    ],
    { a: g[4]!, g: g[3]!, b: g[2]!, c: g[4]!, w: 0xfff8d0, K: C.INK, d: g[2]!, W: 0xfff8e8, r: C.RED[2]! },
  );
  board.blit(face, 3, 3);
  return board;
}

/** The shop's display window, 32 by 24: a green-painted frame, and wares behind the glass. */
export function displayWindow(): Pixmap {
  const p = new Pixmap(32, 24);
  const f = C.GREEN;
  const g = C.GOLD;
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 32; x++) {
      const frame = x < 2 || x > 29 || y < 2 || y > 20 || x === 15 || x === 16;
      if (frame) {
        let c = f[2]!;
        if (x === 0 || y === 0 || x === 15) c = f[3]!;
        if (x === 31 || y === 23 || x === 16) c = f[1]!;
        if (y === 21) c = g[3]!;
        if (y === 22) c = g[2]!;
        p.set(x, y, c);
      } else {
        // The dim shop inside, warmer low down.
        p.set(x, y, y < 8 ? C.SLATE[1]! : y < 14 ? C.SLATE[2]! : C.DARKWOOD[2]!);
      }
    }
  }
  // A shelf across each half, and wares on it.
  for (let x = 2; x < 30; x++) {
    if (x === 15 || x === 16) continue;
    p.set(x, 14, C.WOOD[5]!);
    p.set(x, 15, C.WOOD[3]!);
  }
  const potion = (x: number, glass: readonly Rgb[]) => {
    p.set(x + 1, 8, C.WOOD[4]!);
    p.set(x + 1, 9, glass[4]!);
    for (let j = 10; j < 14; j++) for (let i = 0; i < 3; i++) p.set(x + i, j, i === 0 ? glass[4]! : i === 2 ? glass[2]! : glass[3]!);
    p.set(x, 10, 0xffffff);
  };
  potion(3, C.RED);
  potion(7, C.BLUE);
  potion(11, C.GREEN.concat([0x58c860]));
  // A helm and a dagger in the right half.
  const helm = sprite(
    [
      "..www..",
      ".wHHHh.",
      "wHHHHhh",
      "wHkkkhh",
      "wHHkHhh",
      ".hh.hh.",
    ],
    { w: C.IRON[6]!, H: C.IRON[4]!, h: C.IRON[3]!, k: C.INK },
  );
  p.blit(helm, 18, 8);
  const blade = sprite(["....W", "...Wb", "..Wb.", "gWb..", ".g...", "g.g.."], { W: C.IRON[6]!, b: C.IRON[4]!, g: C.GOLD[3]! });
  p.blit(blade, 25, 8);
  // Glints on the glass.
  for (const [x, y] of [
    [4, 4],
    [5, 3],
    [19, 4],
    [20, 3],
  ] as const)
    p.set(x, y, C.WATER[5]!);
  // Pennant bunting across the top.
  for (let x = 2; x < 30; x += 4) {
    const c = (x / 4) % 2 ? C.RED[3]! : g[4]!;
    p.set(x, 2, c);
    p.set(x + 1, 2, c);
    p.set(x + 2, 2, c);
    p.set(x + 1, 3, c);
  }
  return p;
}

const CREST = [
  "...g...",
  "..gGg..",
  ".gGWGg.",
  "gGWWWGg",
  ".gGWGg.",
  "..gGg..",
  "...g...",
];

/** A Benalish banner, 12 by 32: blue with gold edging and a gold crest, its foot cut in a swallowtail. */
export function banner(cloth: readonly Rgb[] = C.BLUE, trim: readonly Rgb[] = C.GOLD): Pixmap {
  const p = new Pixmap(12, 32);
  p.fill(0, 0);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 12; x++) {
      // The swallowtail: a notch up the middle of the last rows.
      const notch = 32 - y;
      if (notch <= 5 && Math.abs(x - 5.5) < 6 - notch) continue;
      let c = cloth[3]!;
      // Folds hanging down.
      if (x === 3 || x === 8) c = cloth[2]!;
      if (x === 4 || x === 9) c = cloth[4]!;
      if (x === 0 || x === 11) c = trim[3]!;
      if (x === 1 || x === 10) c = cloth[1]!;
      if (y < 2) c = trim[y === 0 ? 4 : 2]!;
      p.set(x, y, c);
    }
  }
  p.blit(sprite(CREST, { g: trim[2]!, G: trim[3]!, W: trim[5]! }), 2, 9);
  for (let x = 2; x < 10; x++) p.set(x, 20, trim[3]!);
  return p;
}

/** A crate's side, 16 by 16: a nailed frame round horizontal boards with a diagonal brace. */
export function crateSide(): Pixmap {
  const w = C.WOOD;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = y % 4 === 3 ? w[2]! : y % 4 === 0 ? w[5]! : w[4]!;
      const frame = x < 2 || x > 13 || y < 2 || y > 13;
      if (frame) c = x === 0 || y === 0 ? w[5]! : x === 15 || y === 15 ? w[1]! : w[3]!;
      if (!frame && Math.abs(x - y) <= 1) c = x - y === 1 ? w[2]! : w[3]!;
      p.set(x, y, c);
    }
  }
  for (const [x, y] of [
    [1, 1],
    [14, 1],
    [1, 14],
    [14, 14],
  ] as const)
    p.set(x, y, C.IRON[5]!);
  return p;
}

/** A barrel's staves once round, 32 by 16, with two iron hoops. */
export function barrelSide(): Pixmap {
  const w = C.WOOD;
  const p = new Pixmap(32, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const stave = Math.floor(x / 4);
      let c = stave % 2 ? w[4]! : w[3]!;
      if (x % 4 === 0) c = w[2]!;
      if (x % 4 === 1) c = stave % 2 ? w[5]! : w[4]!;
      if (y === 2 || y === 12) c = C.IRON[4]!;
      if (y === 3 || y === 13) c = C.IRON[2]!;
      if (y === 0) c = w[2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A barrel's lid, 16 by 16: boards in a ring. */
export function barrelTop(): Pixmap {
  const w = C.WOOD;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      let c = Math.floor(x / 4) % 2 ? w[5]! : w[4]!;
      if (x % 4 === 0) c = w[3]!;
      if (d > 6.2) c = C.IRON[3]!;
      if (d > 6.2 && y < 6) c = C.IRON[5]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A striped awning's cloth, 16 by 16 to tile along: red and cream stripes. */
export function awning(): Pixmap {
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const red = Math.floor(x / 4) % 2 === 0;
      let c = red ? C.RED[3]! : 0xfff4dc;
      if (x % 4 === 3) c = red ? C.RED[2]! : 0xe8d8c0;
      if (x % 4 === 0) c = red ? C.RED[4]! : 0xffffff;
      p.set(x, y, c);
    }
  }
  return p;
}

/** The awning's scalloped valance, 16 by 6, cut out below. */
export function valance(): Pixmap {
  const p = new Pixmap(16, 6);
  p.fill(0, 0);
  for (let x = 0; x < 16; x++) {
    const red = Math.floor(x / 4) % 2 === 0;
    const scallop = x % 4 === 0 || x % 4 === 3 ? 4 : 6;
    for (let y = 0; y < scallop; y++) {
      let c = red ? C.RED[3]! : 0xfff4dc;
      if (y === scallop - 1) c = red ? C.RED[1]! : 0xd8c8b0;
      if (y === 0) c = C.GOLD[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** Produce heaped in a crate, seen from above, 16 by 16: apples, cabbages, carrots or loaves. */
export function produce(kind: "apples" | "cabbages" | "carrots" | "bread" | "fish"): Pixmap {
  const p = new Pixmap(16, 16);
  const random = seeded(kind.length * 31);
  const base = { apples: C.RED, cabbages: C.GRASS, carrots: C.FIRE, bread: C.STRAW, fish: C.IRON }[kind];
  p.fill(C.WOOD[1]!);
  const r = kind === "carrots" || kind === "fish" ? 2 : 3;
  for (let k = 0; k < 40; k++) {
    const cx = 2 + Math.floor(random() * 12);
    const cy = 2 + Math.floor(random() * 12);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = kind === "carrots" || kind === "fish" ? Math.abs(x) * 0.6 + Math.abs(y) * 1.4 : Math.hypot(x, y);
        if (d > r + 0.2) continue;
        let c = base[3]!;
        if (x + y < -r * 0.6) c = base[4]!;
        if (x + y > r * 0.7) c = base[2]!;
        if (x === -1 && y === -1) c = base[Math.min(base.length - 1, 5)]!;
        p.put(cx + x, cy + y, c);
      }
    }
    if (kind === "apples") p.put(cx, cy - r, C.WOOD[2]!);
  }
  return p;
}

/** A gravestone's face, 12 by 16: a rounded top, a cross cut in it, lichen. */
export function gravestone(seed = 3): Pixmap {
  const l = C.COBBLE;
  const p = new Pixmap(12, 16);
  p.fill(0, 0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 12; x++) {
      const dx = x - 5.5;
      if (y < 5 && dx * dx + (y - 5) * (y - 5) * 1.2 > 36) continue;
      let c = l[4]!;
      if (x === 0 || (y < 5 && dx < 0 && dx * dx + (y - 5) * (y - 5) * 1.2 > 22)) c = l[5]!;
      if (x === 11) c = l[2]!;
      if (hash2(x, y, seed) < 0.12) c = C.MEADOW[2]!;
      p.set(x, y, c);
    }
  }
  for (let y = 4; y < 11; y++) p.set(5, y, l[2]!), p.set(6, y, l[1]!);
  for (let x = 3; x < 9; x++) p.set(x, 6, l[2]!);
  p.set(8, 6, l[1]!);
  return p;
}

/** An iron grille over darkness, 16 by 24: a crypt's gate. */
export function cryptGate(): Pixmap {
  const p = new Pixmap(16, 24);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 16; x++) {
      let c = y < 10 ? C.INK : C.DUNGEON[0]!;
      if (y > 18) c = C.DUNGEON[1]!;
      // Steps going down into the dark.
      if (y > 14 && (y - 15) % 3 === 0) c = C.DUNGEON[2]!;
      if (x % 4 === 1) c = C.IRON[3]!;
      if (x % 4 === 2) c = C.IRON[1]!;
      if (y === 3 || y === 20) c = x % 4 === 1 ? C.IRON[4]! : C.IRON[2]!;
      if (y === 0 && x % 4 === 1) c = C.GOLD[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

// --- Inside: the goblins' shop ---

/** A bookcase's front, 16 by 32: three shelves of spines in every color, a few leaning, a skull and a jar. */
export function bookshelf(seed = 5, goods = false): Pixmap {
  const d = C.DARKWOOD;
  const w = C.WOOD;
  const p = new Pixmap(16, 32);
  const random = seeded(seed);
  p.fill(d[1]!);
  const shelves = [2, 12, 22];
  const colors = [C.RED, C.BLUE, C.GREEN, C.PURPLE, C.TEAL, C.GOLD, C.WOOD];
  for (const top of shelves) {
    const bottom = top + 8;
    // The back of the shelf, in shadow.
    for (let y = top; y < bottom; y++) for (let x = 2; x < 14; x++) p.set(x, y, y < top + 2 ? d[0]! : d[1]!);
    let x = 2;
    while (x < 14) {
      if (goods) {
        // Jars and bottles.
        const kind = random();
        const glass = colors[Math.floor(random() * 5)]!;
        if (kind < 0.5 && x + 3 <= 14) {
          for (let j = bottom - 5; j < bottom; j++) for (let i = 0; i < 3; i++) p.set(x + i, j, i === 0 ? glass[4]! : i === 2 ? glass[2]! : glass[3]!);
          p.set(x + 1, bottom - 6, w[4]!);
          p.set(x, bottom - 4, 0xffffff);
          x += 4;
        } else if (x + 2 <= 14) {
          p.set(x, bottom - 7, w[3]!);
          for (let j = bottom - 6; j < bottom; j++) p.set(x, j, glass[3]!), p.set(x + 1, j, glass[2]!);
          p.set(x, bottom - 5, glass[5] ?? 0xffffff);
          x += 3;
        } else x++;
        continue;
      }
      const r = random();
      if (r < 0.06 && x + 4 <= 14) {
        // A skull.
        p.blit(sprite([".BB.", "BKBK", "BBBB", ".bb."], { B: C.BONE[4]!, K: C.INK, b: C.BONE[2]! }), x, bottom - 4);
        x += 5;
        continue;
      }
      const width = r < 0.5 ? 1 : 2;
      const height = 5 + Math.floor(random() * 3);
      const color = colors[Math.floor(random() * colors.length)]!;
      for (let j = bottom - height; j < bottom; j++) {
        for (let i = 0; i < width && x + i < 14; i++) {
          let c = i === 0 ? color[3]! : color[2]!;
          if (j === bottom - height) c = color[4] ?? color[3]!;
          if (j === bottom - height + 2) c = C.GOLD[4]!;
          p.set(x + i, j, c);
        }
      }
      x += width;
      if (random() < 0.12) x++;
    }
    // The shelf board.
    for (let x2 = 0; x2 < 16; x2++) {
      p.set(x2, bottom, w[5]!);
      p.set(x2, bottom + 1, w[3]!);
    }
  }
  // The case's sides and top.
  for (let y = 0; y < 32; y++) {
    p.set(0, y, w[5]!);
    p.set(1, y, w[3]!);
    p.set(14, y, w[3]!);
    p.set(15, y, w[2]!);
  }
  for (let x = 0; x < 16; x++) {
    p.set(x, 0, w[6]!);
    p.set(x, 1, w[4]!);
  }
  return p;
}

/** Wainscot: upright boards under a rail, 16 by 16 to tile along a wall's foot. */
export function wainscot(): Pixmap {
  const w = C.WOOD;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = x % 4 === 0 ? w[2]! : x % 4 === 1 ? w[5]! : w[4]!;
      if (y === 0) c = w[6]!;
      if (y === 1) c = w[5]!;
      if (y === 2) c = w[2]!;
      if (y === 15) c = w[1]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A counter's front: framed, sunken panels, 16 by 16 to tile. */
export function counterFront(): Pixmap {
  const w = C.WOOD;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = w[4]!;
      const inPanel = x >= 3 && x <= 12 && y >= 3 && y <= 12;
      if (inPanel) {
        c = w[3]!;
        if (x === 3 || y === 3) c = w[2]!;
        if (x === 12 || y === 12) c = w[5]!;
      }
      if (x === 0) c = w[5]!;
      if (x === 15) c = w[2]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** The hearth's stone front, 32 by 32: blocks round a sooty arch, logs on the fire-dogs. */
export function hearth(): Pixmap {
  const l = C.COBBLE;
  const p = new Pixmap(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const course = Math.floor(y / 5);
      const shift = course % 2 ? 4 : 0;
      let c = l[4]!;
      if (y % 5 === 0 || (x + shift) % 8 === 0) c = l[2]!;
      else if (y % 5 === 1) c = l[5]!;
      p.set(x, y, c);
    }
  }
  // The mantel.
  for (let x = 0; x < 32; x++) {
    p.set(x, 6, C.WOOD[6]!);
    p.set(x, 7, C.WOOD[4]!);
    p.set(x, 8, C.WOOD[4]!);
    p.set(x, 9, C.WOOD[2]!);
  }
  // The opening: an arch, black with soot at the top, glowing embers below.
  for (let y = 12; y < 32; y++) {
    for (let x = 6; x < 26; x++) {
      const dx = x - 15.5;
      if (y < 18 && dx * dx + (y - 18) * (y - 18) * 2.2 > 100) continue;
      let c = y < 20 ? C.INK : y < 26 ? 0x2a1418 : 0x3a1a14;
      if (y > 28) c = C.FIRE[0]!;
      p.set(x, y, c);
    }
  }
  // Logs.
  for (let x = 9; x < 23; x++) {
    p.set(x, 28, C.WOOD[3]!);
    p.set(x, 29, C.WOOD[1]!);
  }
  for (let x = 11; x < 21; x++) p.set(x, 27, C.WOOD[4]!);
  return p;
}

/** Flames, 16 by 16, cut out: one of three frames, stepped. */
export function flame(frame: number): Pixmap {
  const f = C.FIRE;
  const p = new Pixmap(16, 16);
  p.fill(0, 0);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 7.5;
      const t = y / 15;
      const sway = Math.sin(t * 6 + frame * 2.1) * 0.12 * (1 - t);
      const tongue = valueNoise(x * 2 + frame * 5, y * 0.6 - frame * 3, 3, 64, 9) * 0.5;
      const width = t * 0.9 + tongue * (1 - t) * 0.6;
      const d = Math.abs(dx - sway);
      if (d > width) continue;
      const heat = 1 - d / Math.max(width, 0.01);
      let c = f[1]!;
      if (heat > 0.35) c = f[2]!;
      if (heat > 0.6 && t > 0.4) c = f[3]!;
      if (heat > 0.82 && t > 0.6) c = f[4]!;
      p.set(x, y, c);
    }
  }
  return p;
}

/** A rug, 48 by 32: deep red with a blue and gold border, a medallion, fringed ends. */
export function rug(): Pixmap {
  const r = C.RED;
  const g = C.GOLD;
  const b = C.BLUE;
  const p = new Pixmap(48, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 48; x++) {
      let c = r[2]!;
      const edge = Math.min(x - 2, 45 - x, y, 31 - y);
      if (x < 2 || x > 45) {
        c = y % 2 ? 0xf4e8c8 : 0xd8c8a8;
      } else if (edge < 1) c = r[1]!;
      else if (edge < 2) c = g[3]!;
      else if (edge < 5) c = (x + y) % 4 < 2 ? b[2]! : b[3]!;
      else if (edge < 6) c = g[3]!;
      else {
        // The field: a diamond lattice and a medallion.
        const dx = Math.abs(x - 23.5);
        const dy = Math.abs(y - 15.5);
        const m = dx / 1.5 + dy;
        if (m < 4) c = g[4]!;
        else if (m < 5) c = r[4]!;
        else if (m < 7) c = b[3]!;
        else if (m < 8) c = g[3]!;
        else if ((x + y) % 6 === 0 || (x - y + 64) % 6 === 0) c = r[3]!;
      }
      p.set(x, y, c);
    }
  }
  return p;
}

/** A wanted poster, 10 by 12: parchment, a scrawled face and lines of writing. */
export function poster(seed = 2): Pixmap {
  const random = seeded(seed);
  const p = new Pixmap(10, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 10; x++) p.set(x, y, (x + y) % 7 === 0 ? 0xd8c090 : 0xf0dcaa);
  for (let x = 0; x < 10; x++) p.set(x, 11, 0xb89868);
  p.blit(sprite([".bbb.", "bwbwb", "bbbbb", ".bKb."], { b: C.GOBLIN[3]!, w: 0xffffff, K: C.INK }), 2, 2);
  for (const y of [8, 9]) for (let x = 1; x < 9; x++) if (random() < 0.7) p.set(x, y, C.WOOD[1]!);
  p.set(4, 0, C.RED[3]!);
  return p;
}

/** A sack of grain, cloth-colored, 16 by 16, tiled round its blob. */
export function sackcloth(): Pixmap {
  const s = C.STRAW;
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x + y * 2) % 5 === 0 ? s[1]! : (x * 3 + y) % 7 === 0 ? s[3]! : s[2]!);
  return p;
}

/** Clay: a pot's glazed body. */
export function clay(ramp: readonly Rgb[] = C.ROOF): Pixmap {
  const p = new Pixmap(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, y === 5 || y === 6 ? C.GOLD[2]! : hash2(x, y, 4) < 0.06 ? ramp[3]! : ramp[4]!);
  return p;
}

// --- The crypt ---

/** A sarcophagus's lid, 16 by 32: a knight carved in relief, hands on a sword. */
export function sarcophagusLid(): Pixmap {
  const s = C.DUNGEON;
  const p = new Pixmap(16, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) p.set(x, y, x === 0 || y === 0 ? s[6]! : x === 15 || y === 31 ? s[2]! : s[4]!);
  const effigy = sprite(
    [
      "....HHHH....",
      "...HhhhhH...",
      "...HhkkhH...",
      "...HhhhhH...",
      "....HhhH....",
      "..SSSSSSSS..",
      ".SsssssssssS",
      ".Sss.ii.sssS",
      ".Sss.ii.sssS",
      ".Ssss.ii.ssS",
      "..ss.HiiH.s.",
      "..ss.HiiH.s.",
      "..ss..ii..s.",
      "..ss..ii..s.",
      "..sss.ii.ss.",
      "...ss.ii.s..",
      "...ss.ii.s..",
      "...ss.ii.s..",
      "...ss..i.s..",
      "...ss....s..",
      "...sss..ss..",
      "...ss....s..",
      "...ss....s..",
      "..SSS....SS.",
    ],
    { H: s[6]!, h: s[5]!, k: s[3]!, S: s[6]!, s: s[5]!, i: C.BONE[4]! },
  );
  p.blit(effigy, 2, 4);
  // The carving's shadow edge, under and right of the relief.
  for (let y = 31; y > 0; y--) {
    for (let x = 15; x > 0; x--) {
      if (p.get(x, y) === s[4] && (p.get(x - 1, y) === s[5] || p.get(x, y - 1) === s[5])) p.set(x, y, s[3]!);
    }
  }
  return p;
}

/** A sarcophagus's side, 32 by 12: three sunken panels. */
export function sarcophagusSide(): Pixmap {
  const s = C.DUNGEON;
  const p = new Pixmap(32, 12);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 32; x++) {
      let c = s[4]!;
      if (y === 0) c = s[6]!;
      if (y === 11) c = s[2]!;
      const px = x % 11;
      if (px >= 2 && px <= 9 && y >= 3 && y <= 9) {
        c = s[3]!;
        if (y === 3 || px === 2) c = s[2]!;
        if (y === 9 || px === 9) c = s[5]!;
      }
      p.set(x, y, c);
    }
  }
  return p;
}

/** A cobweb, 16 by 16, cut out: threads from the top-left corner, crossed by sagging rings. */
export function cobweb(): Pixmap {
  const p = new Pixmap(16, 16);
  p.fill(0, 0);
  const thread = 0xd8dce8;
  for (let k = 0; k < 5; k++) {
    const a = (k / 4) * (Math.PI / 2);
    for (let t = 0; t < 16; t++) {
      const x = Math.round(Math.cos(a) * t);
      const y = Math.round(Math.sin(a) * t);
      p.put(x, y, thread, 200);
    }
  }
  for (const r of [4, 8, 12]) {
    for (let k = 0; k < 40; k++) {
      const a = (k / 39) * (Math.PI / 2);
      const sag = Math.sin(a * 4) * 0.9;
      p.put(Math.round(Math.cos(a) * (r - sag)), Math.round(Math.sin(a) * (r - sag)), r === 12 ? 0xa8acc0 : thread, 200);
    }
  }
  return p;
}

/** A skull, 5 by 5, cut out. */
export function skull(): Pixmap {
  const b = C.BONE;
  return sprite([".BBB.", "BWBBb", "BKBKb", "BBBBb", ".bTb."], { B: b[4]!, W: b[5]!, b: b[2]!, K: C.INK, T: b[3]! });
}

/** Bones strewn on a floor, 16 by 16, cut out. */
export function bones(seed = 1): Pixmap {
  const b = C.BONE;
  const p = new Pixmap(16, 16);
  p.fill(0, 0);
  const skull = sprite([".BBB.", "BBBBb", "BKBKb", "BBBBb", ".bTb."], { B: b[4]!, b: b[2]!, K: C.INK, T: b[3]! });
  p.blit(skull, 2 + (seed % 3), 3);
  const random = seeded(seed);
  for (let k = 0; k < 3; k++) {
    const x = 4 + Math.floor(random() * 8);
    const y = 8 + Math.floor(random() * 5);
    const len = 4 + Math.floor(random() * 3);
    for (let i = 0; i < len; i++) {
      p.put(x + i, y + (k === 1 ? Math.floor(i / 2) : 0), b[4]!);
      p.put(x + i, y + 1 + (k === 1 ? Math.floor(i / 2) : 0), b[2]!);
    }
    p.put(x - 1, y, b[5]!);
    p.put(x + len, y, b[5]!);
  }
  return p;
}

/** A tattered banner of the crypt's dead order, 12 by 28: violet, frayed and holed. */
export function tatteredBanner(): Pixmap {
  const p = banner(C.PURPLE, C.BONE);
  const random = seeded(9);
  for (let y = 18; y < 32; y++) for (let x = 0; x < 12; x++) if (random() < (y - 18) / 20) p.put(x, y, 0, 0);
  for (let k = 0; k < 3; k++) p.put(2 + Math.floor(random() * 8), 4 + Math.floor(random() * 20), 0, 0);
  return p;
}

/** Moss and grime: a dark patch, cut out, to break up the crypt's walls and floor. */
export function grime(seed = 4): Pixmap {
  const p = new Pixmap(32, 32);
  p.fill(0, 0);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5) / 16;
      const n = fbm(x, y, 8, 32, seed);
      if (n - d * 0.8 > 0.22) p.set(x, y, n > 0.6 ? C.GHOUL[2]! : C.GHOUL[1]!, 255);
    }
  }
  return p;
}

/** Stone steps' tread, 16 by 16: a worn edge lit along its front. */
export function stepTread(ramp: readonly Rgb[] = C.DUNGEON): Pixmap {
  const p = new Pixmap(16, 16);
  const random = seeded(3);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, y > 13 ? ramp[5]! : hash2(x, y, 2) < 0.08 ? ramp[3]! : ramp[4]!);
  crack(p, 3, 6, 5, ramp[2]!, random);
  return p;
}

export { T as TRANSPARENT };
