import { MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import * as Pic from "../paint/pictures";
import { Pixmap, hash2 } from "../paint/pixmap";
import * as T from "../paint/textures";
import type { Frames } from "../recipe";
import * as RP from "../rooms/paint";
import * as D from "./draw";
import { PX, WOOD_PALETTE, spotOf, standing, wallPiece, woods } from "./kit";
import { drawn, num } from "./registry";

// A smithy's furniture: the forge against its back wall, its hood and chimney, the anvil, the quench, the grindstone,
// racks of what is made there and the armour stand. The forge's fire and its glow are the room's lights (layout.ts).

const iron = () => flat(C.IRON[2]!);
const ironDark = () => flat(C.IRON[1]!);
const steel = () => flat(C.IRON[5]!);

/** Three frames of a flame `n` texels high as upright cards, their foot's middle at x, y, z. */
export function flameCards(x: number, y: number, z: number, n: number, wide = 1): Frames {
  return {
    rate: 8,
    models: [0, 1, 2].map((f) => {
      const m = material(`flame-${f}-${n}`, () => Pic.flame(f, n), { glowing: true, cutout: true });
      const fb = new MeshBuilder();
      fb.card(fitted(m), x - (n / 32) * wide, y, x + (n / 32) * wide, y + n / 16, z);
      return fb.model();
    }),
  };
}

drawn("forge", "a forge against a wall (its face at z), its middle at x: a brick hearth of glowing coals under a hood and chimney args.h high (3.25)", (b, p) => {
  const h = num(p, "h", 3.25);
  const brick = tiled(material("forge-brick", () => T.ashlar([0x1a0c0c, 0x2e1412, 0x4a1e18, 0x6a2c20, 0x8a3c28, 0xa65034], 63, 5, 6, 10)));
  const mouth = fitted(material("forge-mouth", () => RP.forgeMouth(), { glow: 0.9 }));
  const coals = material("coals", () => coals16(), { glowing: true });
  wallPiece(b, p, () => {
    // The hearth: a brick block, its mouth glowing, coals heaped on its bed.
    b.box(-1.25, 0, 0, 1.25, 0.9, 1.25, { south: brick, east: brick, west: brick, top: brick });
    b.box(-0.75, 0.15, 1.249, 0.75, 0.8, 1.26, { south: mouth });
    b.box(-0.85, 0.9, 0.25, 0.85, 1.0, 1.05, { top: tiled(coals), south: tiled(coals), east: tiled(coals), west: tiled(coals) });
    b.box(-1.25, 0.9, 1.05, 1.25, 1.1, 1.25, sides(brick));
    // The hood narrowing to the chimney.
    b.box(-1.15, 1.9, 0, 1.15, 2.2, 1.15, sides(brick));
    b.box(-0.9, 2.2, 0, 0.9, 2.5, 0.85, sides(brick));
    b.box(-0.55, 2.5, 0, 0.55, h, 0.6, sides(brick));
    for (const x of [-1.15, 1.0]) b.box(x, 1.1, 1.0, x + 0.15, 1.9, 1.15, sides(iron()));
    // The bellows by its side.
    b.box(1.3, 0.5, 0.3, 1.9, 0.72, 0.9, sides(tiled(stock.darkTimber())));
    b.box(1.32, 0.72, 0.35, 1.88, 0.8, 0.85, sides(flat(C.DIRT[1]!)));
  });
  const [fx, fz] = spotOf(p, 0, 0.7);
  const [gx, gz] = spotOf(p, 0.45, 0.6);
  return { frames: [flameCards(fx, 0.95, fz, 12, 1.4), flameCards(gx, 0.95, gz, 8)] };
});

drawn("anvil", "an anvil on a stump, its middle at x, z, its horn to the east unless rot turns it", (b, p) => {
  standing(b, p, () => {
    b.cylinder(0, 0, 0, 0.45, 0.3, 8, { mat: stock.bark() }, fitted(material("stump-top", () => stumpTop())));
    b.box(-0.18, 0.45, -0.12, 0.18, 0.6, 0.12, sides(ironDark()));
    b.box(-0.1, 0.6, -0.08, 0.1, 0.72, 0.08, sides(iron()));
    b.box(-0.32, 0.72, -0.15, 0.3, 0.88, 0.15, sides(iron(), steel()));
    b.box(0.3, 0.76, -0.08, 0.5, 0.86, 0.08, sides(iron()));
    b.box(0.5, 0.79, -0.04, 0.6, 0.84, 0.04, sides(iron()));
    // A hammer left on it.
    b.box(-0.2, 0.88, 0.02, 0.1, 0.93, 0.07, sides(tiled(stock.timber())));
    b.box(-0.28, 0.88, -0.03, -0.18, 0.98, 0.12, sides(ironDark()));
  });
});

drawn("quench-trough", "a quenching trough of water, its middle at x, z (1.5 by 0.6) along x unless rot turns it", (b, p, pal) => {
  const { dark } = woods(pal);
  const water = D.pics.water();
  standing(b, p, () => {
    b.box(-0.75, 0, -0.3, 0.75, 0.55, 0.3, sides(dark));
    b.box(-0.68, 0.3, -0.23, 0.68, 0.5, 0.23, { top: fitted(water) });
    for (const x of [-0.6, 0.5]) b.box(x, 0, -0.32, x + 0.1, 0.58, 0.32, sides(iron()));
  });
}, WOOD_PALETTE);

drawn("grindstone", "a grindstone on its frame, its middle at x, z, its wheel turning along x unless rot turns it", (b, p, pal) => {
  const { timber } = woods(pal);
  const stone = stock.cobbleWall();
  standing(b, p, () => {
    for (const x of [-0.3, 0.22]) b.box(x, 0, -0.08, x + 0.08, 0.75, 0.08, sides(timber));
    b.box(-0.3, 0.6, -0.04, 0.3, 0.66, 0.04, sides(iron()));
    wheel(b, 0, 0.62, 0, 0.42, 0.14, stone);
    b.box(0.3, 0.6, -0.03, 0.55, 0.65, 0.03, sides(iron()));
    b.box(0.5, 0.45, -0.03, 0.55, 0.65, 0.03, sides(iron()));
  });
}, WOOD_PALETTE);

drawn("weapon-rack", "a rack of spears and swords, its middle at x, z (1.25 wide) along x unless rot turns it", (b, p, pal) => {
  const { dark } = woods(pal);
  standing(b, p, () => {
    b.box(-0.625, 0, -0.2, 0.625, 0.08, 0.2, sides(dark));
    for (const x of [-0.6, 0.52]) b.box(x, 0, -0.04, x + 0.08, 1.55, 0.04, sides(dark));
    b.box(-0.625, 1.2, -0.05, 0.625, 1.26, 0.05, sides(dark));
    b.box(-0.625, 0.5, -0.05, 0.625, 0.56, 0.05, sides(dark));
    for (let k = 0; k < 5; k++) {
      const x = -0.45 + k * 0.22;
      const spear = k % 2 === 0;
      b.box(x - 0.025, 0.08, -0.025, x + 0.025, spear ? 1.95 : 1.3, 0.025, sides(spear ? tiled(stock.timber()) : steel()));
      if (spear) b.box(x - 0.05, 1.95, -0.02, x + 0.05, 2.15, 0.02, sides(steel()));
      else b.box(x - 0.09, 1.0, -0.03, x + 0.09, 1.05, 0.03, sides(flat(C.GOLD[3]!)));
    }
  });
}, WOOD_PALETTE);

drawn("armor-stand", "a stand bearing a suit of plate and a helm, its middle at x, z, facing south unless rot turns it; its seed the metal", (b, p, pal) => {
  const { dark } = woods(pal);
  const metal = (p.seed ?? 0) % 2 ? flat(C.GOLD[3]!) : flat(C.IRON[4]!);
  const shine = (p.seed ?? 0) % 2 ? flat(C.GOLD[5]!) : flat(C.IRON[6]!);
  standing(b, p, () => {
    b.box(-0.25, 0, -0.25, 0.25, 0.08, 0.25, sides(dark));
    b.box(-0.04, 0.08, -0.04, 0.04, 1.3, 0.04, sides(dark));
    b.roundedBox(-0.28, 0.75, -0.16, 0.28, 1.35, 0.16, 2 * PX, sides(metal));
    b.box(-0.08, 0.9, 0.16, 0.08, 1.3, 0.18, sides(shine));
    b.roundedBox(-0.42, 1.2, -0.15, -0.24, 1.38, 0.15, 2 * PX, sides(metal));
    b.roundedBox(0.24, 1.2, -0.15, 0.42, 1.38, 0.15, 2 * PX, sides(metal));
    b.roundedBox(-0.15, 1.4, -0.15, 0.15, 1.72, 0.15, 3 * PX, sides(metal));
    b.box(-0.1, 1.52, 0.15, 0.1, 1.56, 0.17, sides(flat(C.INK)));
    b.box(-0.02, 1.72, -0.12, 0.02, 1.86, 0.1, sides(flat(C.RED[3]!)));
  });
}, WOOD_PALETTE);

drawn("tool-rack", "tongs and hammers hung on a wall (its face at z) from x (1.5 wide), at y (1.3)", (b, p, pal) => {
  const { dark } = woods(pal);
  const y = p.y ?? 1.3;
  wallPiece(b, p, () => {
    b.box(0, y + 0.6, 0, 1.5, y + 0.68, 0.1, sides(dark));
    for (let k = 0; k < 5; k++) {
      const x = 0.15 + k * 0.3;
      if (k % 2 === 0) {
        b.box(x - 0.02, y, 0.06, x + 0.02, y + 0.62, 0.09, sides(iron()));
        b.box(x + 0.04, y + 0.05, 0.06, x + 0.07, y + 0.6, 0.09, sides(iron()));
      } else {
        b.box(x - 0.025, y + 0.1, 0.06, x + 0.025, y + 0.62, 0.1, sides(tiled(stock.timber())));
        b.box(x - 0.08, y + 0.05, 0.05, x + 0.08, y + 0.15, 0.11, sides(ironDark()));
      }
    }
  });
}, WOOD_PALETTE);

drawn("coal-heap", "a heap of coal, its middle at x, z", (b, p) => {
  b.blob(p.x, 0.12, p.z, 0.45, 0.22, 0.38, material("coal", () => coal16()), [p.x * 16, p.z * 16]);
});

drawn("ingots", "a stack of iron ingots, its middle at x, z (at y)", (b, p) => {
  standing(b, p, () => {
    for (let row = 0; row < 3; row++) for (let k = 0; k < 3 - row; k++) {
      const x = -0.2 + k * 0.16 + row * 0.08;
      b.box(x, row * 0.07, -0.12, x + 0.14, row * 0.07 + 0.07, 0.12, sides(row === 2 ? steel() : iron()));
    }
  });
});

/** A wheel standing upright along x: its middle at x, y, z, radius r, thickness t, rimmed. */
function wheel(b: MeshBuilder, x: number, y: number, z: number, r: number, t: number, mat: ReturnType<typeof flat>): void {
  const n = 10;
  const at = (k: number, dz: number) => [x + Math.cos((k / n) * 2 * Math.PI) * r, y + Math.sin((k / n) * 2 * Math.PI) * r, z + dz] as const;
  const face = (dz: number, flip: boolean) => {
    const corners = Array.from({ length: n }, (_, k) => at(flip ? n - k : k, dz));
    b.polygon(mat, corners, corners.map((c) => [(c[0] - x) / r / 2 + 0.5, (c[1] - y) / r / 2 + 0.5] as const));
  };
  face(t / 2, false);
  face(-t / 2, true);
  for (let k = 0; k < n; k++) {
    const a = at(k, t / 2);
    const bb = at(k + 1, t / 2);
    const c = at(k + 1, -t / 2);
    const d = at(k, -t / 2);
    b.polygon(mat, [d, c, bb, a], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

function coals16(): Pixmap {
  const p = new Pixmap(16, 16, C.FIRE[0]!);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const h = hash2(x >> 1, y >> 1, 5);
    p.set(x, y, h < 0.3 ? 0x2a1010 : h < 0.55 ? C.FIRE[1]! : h < 0.85 ? C.FIRE[2]! : C.FIRE[3]!);
  }
  return p;
}

function coal16(): Pixmap {
  const p = new Pixmap(16, 16, 0x141418);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (hash2(x, y, 6) < 0.2) p.set(x, y, 0x3a3a46);
  return p;
}

function stumpTop(): Pixmap {
  const p = new Pixmap(8, 8, C.WOOD[4]!);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (Math.round(Math.hypot(x - 3.5, y - 3.5)) % 2 === 0) p.set(x, y, C.WOOD[3]!);
  return p;
}
