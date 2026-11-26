import { coneRoof, hipRoof } from "../buildings/kit";
import { copper, dome } from "../buildings/tolarian";
import { type Face, type Material, type MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material, stock } from "../paint/materials";
import { type Ramp, rampKey } from "../paint/palette";
import { Pixmap, type Rgb, hash2, seeded } from "../paint/pixmap";
import * as R from "../paint/ramps";
import * as G from "../paint/terrain";
import * as T from "../paint/textures";
import { bark, cutout, foliage, frustum, glowing, limb } from "./kit";
import { TAU, spike } from "./travelKit";

// The travel map's town icons (travel.ts registers `town-icon`): a town as a miniature of itself on a square of 3, 5 or
// 7 tiles, low and wide beside the player's figure - its streets crossing at a square and running out on all four sides,
// its houses in the quarters between them in its style's walls and roofs, its wall (if walled) with a gatehouse on each
// side, and in its middle the style's signature, the thing the town is known by from afar:
//
//   benalish   a white keep with red-roofed turrets and blue banners (a village: a chapel and its bell tower)
//   tolarian   the Academy: a marble drum under a copper dome, a slender tower beside it
//   urborg     a village: stilt houses over dark water on boardwalks, a lantern; a town or capital: the Vess manor
//   argive     the Vess manor: black stone, slate, spires
//   keldon     a clan hold: turf-roofed longhouses, a great hall with horned gables and a fire, a palisade
//   llanowar   an elfhame: giant trees with platforms, leaf-roofed huts at their feet, a living hedge for a wall
//   village    thatched cottages, a well, a windmill
//
// Everything is drawn about the origin (travel.ts places and scales it), the square from -n/2 to n/2.

export const TOWN_SIZES = { capital: 7, town: 5, village: 3 } as const;
export const TOWN_STYLES = ["benalish", "tolarian", "urborg", "keldon", "llanowar", "argive", "village"] as const;

// --- Materials, painted small -------------------------------------------------------------------------------------------

type WallKind = "plaster" | "stone" | "log" | "daub" | "tarred";

/**
 * A miniature's wall, 16 texels a tile as everything is: plaster with a stone footing, ashlar in small courses, logs,
 * daub between dark beams, tarred planks - and a row of one-texel windows at a storey's height (a second row higher up).
 */
function wallOf(kind: WallKind, ramp: Ramp, glass: Rgb = C.INK): Material {
  return material(`mini-wall-${kind}@${rampKey(ramp)}+${glass.toString(16)}`, () => {
    const p = new Pixmap(16, 16);
    const at = (i: number) => ramp[Math.max(0, Math.min(ramp.length - 1, i))]!;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let c: Rgb;
        switch (kind) {
          case "stone": {
            const course = Math.floor(y / 3);
            const off = course % 2 ? 2 : 0;
            c = y % 3 === 2 ? at(1) : (x + off) % 5 === 4 ? at(2) : hash2(Math.floor((x + off) / 5), course, 4) < 0.5 ? at(4) : at(5);
            break;
          }
          case "log":
            c = y % 2 === 0 ? at(4) : at(2);
            if (hash2(x, y, 5) < 0.1) c = at(3);
            break;
          case "daub":
            c = hash2(x, y, 3) < 0.12 ? at(4) : at(5);
            if (x % 8 === 0 || y === 7) c = C.DARKWOOD[2]!;
            break;
          case "tarred":
            c = x % 3 === 0 ? at(1) : hash2(x, y >> 2, 6) < 0.3 ? at(4) : at(3);
            break;
          default:
            c = hash2(x, y, 3) < 0.12 ? at(4) : at(5);
        }
        if (y >= 14) c = y === 14 ? at(2) : at(3);
        // Windows: a texel of glass a storey up (and another storey above), a lit sill under each.
        if (x % 5 === 2 && (y === 9 || y === 10 || y === 3 || y === 4)) c = glass;
        if (x % 5 === 2 && (y === 11 || y === 5)) c = at(6);
        p.set(x, y, c);
      }
    }
    return p;
  });
}

/** Thatch in rows, or turf over it (Keld's, a dusting of snow), painted small. */
function thatchOf(ramp: Ramp, snow = false): Material {
  return material(`mini-thatch@${rampKey(ramp)}${snow ? "+snow" : ""}`, () => {
    const p = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let c = y % 4 === 3 ? ramp[2]! : hash2(x, y, 8) < 0.3 ? ramp[3]! : ramp[4]!;
        if (y % 4 === 0 && hash2(x, y, 9) < 0.5) c = ramp[5]!;
        if (snow && hash2(x >> 1, y, 10) < 0.35) c = R.SNOW[5]!;
        p.set(x, y, c);
      }
    }
    return p;
  });
}

/** A ground of the town's, from a surface painter (tiled, flat: it is the ground). */
const groundOf = (name: string, paint: () => Pixmap): Material => material(`mini-ground-${name}`, paint, { flat: true });

/** A small banner: a ramp's cloth, a trim stripe at its foot, cut out, painted at the world's density. */
function pennant(cloth: Ramp, trim: Ramp): Material {
  return cutout(`mini-pennant@${rampKey(cloth)}+${rampKey(trim)}`, () => {
    const p = new Pixmap(3, 6);
    p.fill(0, 0);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 3; x++) if (y < 5 || x === 1) p.put(x, y, y === 4 ? trim[3]! : x === 0 ? cloth[4]! : cloth[3]!);
    return p;
  });
}

/** Pointed stakes along a palisade's top, cut out, tiled along it. */
const stakes = (ramp: Ramp) =>
  material(
    `mini-stakes@${rampKey(ramp)}`,
    () => {
      const p = new Pixmap(16, 4);
      p.fill(0, 0);
      for (let x = 0; x < 16; x++) {
        const h = x % 3 === 1 ? 4 : x % 3 === 0 ? 3 : 2;
        for (let y = 4 - h; y < 4; y++) p.set(x, y, x % 3 === 2 ? ramp[2]! : ramp[4]!);
      }
      return p;
    },
    { cutout: true, twoSided: true },
  );

/** Merlons along a stone wall's top, cut out, tiled along it: two texels up, two down. */
const crenels = (ramp: Ramp) =>
  material(
    `mini-crenels@${rampKey(ramp)}`,
    () => {
      const p = new Pixmap(16, 3);
      p.fill(0, 0);
      for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) if (x % 4 < 2) p.set(x, y, y === 0 ? ramp[5]! : x % 4 === 1 ? ramp[3]! : ramp[4]!);
      return p;
    },
    { cutout: true, twoSided: true },
  );

// --- The styles ------------------------------------------------------------------------------------------------------------

type RoofKind = "gable" | "steep" | "hip" | "hut" | "stilt";
type Rampart = "stone" | "palisade" | "hedge";

interface Look {
  /** The houses' walls (a few, picked by lot). */
  readonly walls: readonly Material[];
  readonly roof: Material;
  readonly roofKind: RoofKind;
  /** The ground inside the walls, if any is laid. */
  readonly ground?: Material;
  readonly street: Material;
  readonly rampart: Rampart;
  readonly rampartWall: Material;
  /** A stone wall's stone, for its merlons. */
  readonly rampartRamp?: Ramp;
  /** A tower's roof: a cone of it; none, a flat top. */
  readonly towerRoof?: Material;
  readonly banner?: Material;
  /** A garden's tree. */
  readonly leaves: Material;
  readonly signature: (b: MeshBuilder, k: number, n: number, random: () => number) => void;
  /** How much of the middle the signature takes (a half side, tiles). */
  readonly plaza: (n: number) => number;
}

function lookOf(style: string, n: number): Look {
  switch (style) {
    case "benalish":
      return {
        walls: [wallOf("plaster", C.PLASTER), wallOf("stone", C.LIMESTONE), wallOf("plaster", C.PLASTER)],
        roof: stock.roof(C.ROOF),
        roofKind: "gable",
        ground: groundOf("flagstones", () => T.flagstones(C.LIMESTONE, 3)),
        street: groundOf("setts", () => G.setts(C.COBBLE)),
        rampart: "stone",
        rampartWall: wallOf("stone", C.LIMESTONE, C.LIMESTONE[2]!),
        rampartRamp: C.LIMESTONE,
        towerRoof: stock.roof(C.ROOF),
        banner: pennant(C.BLUE, C.GOLD),
        leaves: foliage(C.LEAF),
        signature: n <= 3 ? chapel : keep,
        plaza: (m) => (m <= 3 ? 0 : m <= 5 ? 1.05 : 1.45),
      };
    case "tolarian":
      return {
        walls: [wallOf("stone", R.MARBLE, C.BLUE[1]!), wallOf("plaster", R.MARBLE, C.BLUE[1]!)],
        roof: copper(R.VERDIGRIS),
        roofKind: "hip",
        ground: groundOf("marble", () => G.marblePaving()),
        street: groundOf("marble", () => G.marblePaving()),
        rampart: "stone",
        rampartWall: wallOf("stone", R.MARBLE, R.MARBLE[3]!),
        rampartRamp: R.MARBLE,
        towerRoof: copper(R.VERDIGRIS),
        banner: pennant(R.TOLARIAN_CLOTH, C.GOLD),
        leaves: foliage(R.LUSH),
        signature: academy,
        plaza: (m) => (m <= 3 ? 0 : m <= 5 ? 1.05 : 1.45),
      };
    case "keldon":
      return {
        walls: [wallOf("log", R.LOG), wallOf("stone", R.KELD_STONE, R.LAVA[1]!)],
        roof: thatchOf(R.SOD, true),
        roofKind: "steep",
        ground: groundOf("snow-track", () => G.snowTrack()),
        street: groundOf("snow-track", () => G.snowTrack()),
        rampart: "palisade",
        rampartWall: wallOf("log", R.LOG, R.LOG[1]!),
        banner: pennant(R.KELD_RED, C.IRON),
        leaves: foliage(R.PINE),
        signature: greatHall,
        plaza: (m) => (m <= 3 ? 0 : m <= 5 ? 1.1 : 1.45),
      };
    case "llanowar":
      return {
        walls: [wallOf("log", R.ELFWOOD, R.ELFWOOD[0]!)],
        roof: foliage(R.ELF_LEAF),
        roofKind: "hut",
        ground: groundOf("elf-moss", () => G.moss(R.ELF_LEAF, 141)),
        street: groundOf("forest-floor", () => G.forestFloor()),
        rampart: "hedge",
        rampartWall: foliage(R.MOSS),
        banner: pennant(R.ELF_CLOTH, C.GOLD),
        leaves: foliage(R.ELF_LEAF),
        signature: elfhame,
        plaza: (m) => (m <= 3 ? 0 : m <= 5 ? 1.05 : 1.45),
      };
    case "urborg":
      if (n <= 3) {
        return {
          walls: [wallOf("tarred", R.TARRED, C.GOLD[4]!)],
          roof: thatchOf(R.MOSS_ROOF),
          roofKind: "stilt",
          ground: groundOf("bog-water", () => G.waterOf(R.BOG, 152, 64)),
          street: groundOf("boardwalk", () => G.boardwalk("z", R.WEATHERED)),
          rampart: "palisade",
          rampartWall: wallOf("tarred", R.TARRED, R.TARRED[1]!),
          leaves: foliage(R.CYPRESS),
          signature: stiltHall,
          plaza: () => 0,
        };
      }
      return manorLook();
    case "argive":
      return manorLook();
    default:
      return {
        walls: [wallOf("daub", R.DAUB), wallOf("plaster", C.PLASTER), wallOf("daub", R.DAUB)],
        roof: thatchOf(R.THATCH),
        roofKind: "gable",
        street: groundOf("cart-track", () => G.cartTrack()),
        rampart: "palisade",
        rampartWall: wallOf("log", C.WOOD, C.WOOD[1]!),
        banner: pennant(C.RED, C.GOLD),
        leaves: foliage(C.LEAF),
        signature: windmill,
        plaza: (m) => (m <= 3 ? 0 : 0.75),
      };
  }
}

/** The Vess manor's look: black stone, black slate, a dark lawn, an iron-spiked wall. */
function manorLook(): Look {
  return {
    walls: [wallOf("stone", R.VESS_STONE, C.GOLD[4]!), wallOf("plaster", C.CLOTH_WHITE, C.INK), wallOf("stone", C.COBBLE, C.GOLD[4]!)],
    roof: stock.slate(C.SLATE),
    roofKind: "steep",
    ground: groundOf("vess-lawn", () => G.pasture(R.MOSS)),
    street: groundOf("vess-setts", () => G.setts(R.VESS_STONE)),
    rampart: "stone",
    rampartWall: wallOf("stone", R.VESS_STONE, R.VESS_STONE[1]!),
    rampartRamp: R.VESS_STONE,
    towerRoof: stock.slate(R.VESS_SLATE),
    banner: pennant(C.PURPLE, C.GOLD),
    leaves: foliage(R.CYPRESS),
    signature: manor,
    plaza: (m) => (m <= 3 ? 0 : m <= 5 ? 1.1 : 1.5),
  };
}

// --- Houses -------------------------------------------------------------------------------------------------------------

/** A house: walls `h` high on w by d about (x, z), its roof of the style's kind, its ridge along x (else turned). */
function house(b: MeshBuilder, look: Look, x: number, z: number, w: number, d: number, h: number, alongX: boolean, wall: Material): void {
  if (look.roofKind === "hut") {
    const r = Math.min(w, d) * 0.42;
    b.cylinder(x, z, 0, h * 0.75, r, 6, tiled(wall));
    spike(b, x, z, h * 0.75 - 0.03, h * 0.75 + r * 1.3, r * 1.3, 6, look.roof, 0.3);
    return;
  }
  const draw = (cx: number, cz: number, W: number, D: number) => {
    const y0 = look.roofKind === "stilt" ? 0.22 : 0;
    if (y0 > 0) {
      const post = bark(R.DEADWOOD);
      for (const [sx, sz] of [
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ] as const)
        limb(b, [cx + sx * (W / 2 - 0.04), -0.1, cz + sz * (D / 2 - 0.04)], [cx + sx * (W / 2 - 0.04), y0, cz + sz * (D / 2 - 0.04)], 0.025, 0.025, post, 3);
    }
    const wf = tiled(wall);
    b.box(cx - W / 2, y0, cz - D / 2, cx + W / 2, y0 + h, cz + D / 2, { north: wf, south: wf, east: wf, west: wf });
    const eave = 0.05;
    if (look.roofKind === "hip") {
      hipRoof(b, cx - W / 2 - eave, cz - D / 2 - eave, cx + W / 2 + eave, cz + D / 2 + eave, y0 + h, Math.min(W, D) * 0.28, look.roof);
    } else {
      const rise = Math.min(W, D) * (look.roofKind === "gable" ? 0.5 : 0.78);
      b.gableRoof(cx - W / 2 - eave, cz - D / 2 - eave, cx + W / 2 + eave, cz + D / 2 + eave, y0 + h, rise, look.roof, wf);
    }
  };
  if (alongX) draw(x, z, w, d);
  else b.at(x, 0, z, Math.PI / 2, () => draw(0, 0, d, w));
}

/** A garden's tree: a trunk and a round crown. */
function gardenTree(b: MeshBuilder, x: number, z: number, s: number, leaves: Material, k: number): void {
  limb(b, [x, 0, z], [x, 0.4 * s, z], 0.04 * s, 0.03 * s, bark(C.WOOD), 3);
  b.blob(x, 0.55 * s, z, 0.24 * s, 0.22 * s, 0.22 * s, leaves, [k * 3, k], 0);
}

/** The lots of a town's quarters: a lattice over the square inside its wall, the streets and its middle left free. */
function lots(n: number, walled: boolean, plaza: number, random: () => number): { x: number; z: number; w: number; d: number; garden: boolean; alongX: boolean }[] {
  const inner = n / 2 - (walled ? 0.7 : 0.22);
  const cell = n <= 3 ? 0.9 : 0.92;
  const count = Math.max(1, Math.floor((2 * inner) / cell));
  const step = (2 * inner) / count;
  const out: { x: number; z: number; w: number; d: number; garden: boolean; alongX: boolean }[] = [];
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const cx = -inner + step * (i + 0.5);
      const cz = -inner + step * (j + 0.5);
      if (Math.abs(cx) < 0.42 || Math.abs(cz) < 0.42) continue;
      if (Math.abs(cx) < plaza && Math.abs(cz) < plaza) continue;
      const alongX = random() < 0.5;
      const w = step * (0.66 + random() * 0.16);
      const d = step * (0.56 + random() * 0.14);
      out.push({ x: cx + (random() - 0.5) * 0.08, z: cz + (random() - 0.5) * 0.08, w, d, garden: random() < 0.14, alongX });
    }
  }
  return out;
}

// --- Walls and gates ------------------------------------------------------------------------------------------------------

/** A round tower at (x, z): `r` across, `h` high, a cone of roof or a flat top, a pennant on some. */
function tower(b: MeshBuilder, look: Look, x: number, z: number, r: number, h: number, pennant: boolean): void {
  if (look.rampart === "hedge") {
    // The hedge's towers are trees grown into it.
    limb(b, [x, 0, z], [x, h + 0.1, z], r * 0.6, r * 0.45, bark(R.ELFWOOD, "smooth"), 4);
    b.blob(x, h + 0.3, z, r * 1.8, r * 1.3, r * 1.7, look.leaves, [x * 16, z * 16], 0);
    return;
  }
  const wf = tiled(look.rampartWall);
  b.cylinder(x, z, 0, h, r, 8, wf, wf);
  if (look.towerRoof) coneRoof(b, x, z, h, r * 1.25, r * 2.2, look.towerRoof, 8);
  else if (look.rampart === "palisade") spike(b, x, z, h, h + r * 1.6, r * 1.15, 6, look.roof);
  if (pennant && look.banner) {
    const top = h + (look.towerRoof ? r * 2.2 : r * 1.6);
    limb(b, [x, top - 0.05, z], [x, top + 0.22, z], 0.012, 0.012, bark(C.DARKWOOD), 3);
    b.card(fitted(look.banner), x, top + 0.02, x + 0.19, top + 0.22, z);
  }
}

/**
 * The wall round a town: four runs along the square `R` from its middle, each broken in its middle by a gate `g` wide
 * between two towers with a lintel over it, a tower at each corner.
 */
function rampart(b: MeshBuilder, look: Look, n: number): void {
  const Rr = n / 2 - 0.3;
  const h = n >= 7 ? 0.74 : 0.62;
  const t = n >= 7 ? 0.2 : 0.17;
  const g = 0.6;
  const tr = n >= 7 ? 0.27 : 0.23;
  const mat = look.rampartWall;
  const wf = tiled(mat);
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    if (look.rampart === "hedge") {
      // A living hedge: leafy, rounded off on top.
      b.box(x0, 0, z0, x1, h * 0.85, z1, sides(tiled(mat)));
      return;
    }
    b.box(x0, 0, z0, x1, h, z1, sides(wf));
    {
      // Stakes along a palisade's top, merlons along a stone wall's, on its middle line.
      const st = { mat: look.rampart === "palisade" ? stakes(R.LOG) : crenels(look.rampartRamp ?? C.LIMESTONE) } as Face;
      if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) b.card(st, x0, h, x1, h + 0.12, (z0 + z1) / 2);
      else b.at((x0 + x1) / 2, 0, 0, Math.PI / 2, () => b.card(st, -z1, h, -z0, h + 0.12, 0));
    }
  };
  for (const s of [-1, 1]) {
    // North and south runs, then west and east, each in two halves either side of its gate.
    run(-Rr, s * Rr - t / 2, -g / 2 - tr * 0.6, s * Rr + t / 2);
    run(g / 2 + tr * 0.6, s * Rr - t / 2, Rr, s * Rr + t / 2);
    run(s * Rr - t / 2, -Rr, s * Rr + t / 2, -g / 2 - tr * 0.6);
    run(s * Rr - t / 2, g / 2 + tr * 0.6, s * Rr + t / 2, Rr);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower(b, look, sx * Rr, sz * Rr, tr, h + 0.34, look.rampart === "stone" && sz < 0);
  // The gates: two towers and a lintel on each side.
  const gate = (ax: number, az: number, alongX: boolean) => {
    const off = g / 2 + tr * 0.55;
    const a: [number, number] = alongX ? [ax - off, az] : [ax, az - off];
    const c: [number, number] = alongX ? [ax + off, az] : [ax, az + off];
    tower(b, look, a[0], a[1], tr * 0.85, h + 0.22, false);
    tower(b, look, c[0], c[1], tr * 0.85, h + 0.22, false);
    if (look.rampart === "hedge") return;
    const lt = t * 0.75;
    if (alongX) b.box(ax - g / 2 - 0.05, h * 0.62, az - lt, ax + g / 2 + 0.05, h + 0.06, az + lt, sides(wf));
    else b.box(ax - lt, h * 0.62, az - g / 2 - 0.05, ax + lt, h + 0.06, az + g / 2 + 0.05, sides(wf));
  };
  gate(0, -Rr, true);
  gate(0, Rr, true);
  gate(-Rr, 0, false);
  gate(Rr, 0, false);
}

// --- Signatures ---------------------------------------------------------------------------------------------------------

/** Benalia's keep: a square white keep, red-roofed turrets at its corners, a tall tower in its middle, blue banners. */
function keep(b: MeshBuilder, k: number): void {
  const stone = wallOf("stone", C.LIMESTONE, C.INK);
  const sf = tiled(stone);
  const roof = stock.roof(C.ROOF);
  const s = 0.66 * k;
  b.box(-s, 0, -s, s, 1.1 * k, s, sides(sf));
  b.card({ mat: crenels(C.LIMESTONE) } as Face, -s, 1.1 * k, s, 1.1 * k + 0.09, s - 0.02);
  for (const x of [-s, s]) {
    for (const z of [-s, s]) {
      b.cylinder(x, z, 0, 1.45 * k, 0.21 * k, 8, sf, sf);
      coneRoof(b, x, z, 1.45 * k, 0.27 * k, 0.55 * k, roof, 8);
    }
  }
  const c = 0.3 * k;
  b.box(-c, 1.1 * k, -c - 0.05, c, 2.05 * k, c - 0.05, sides(sf));
  hipRoof(b, -c - 0.06, -c - 0.11, c + 0.06, c + 0.01, 2.05 * k, 0.6 * k, roof);
  // A flag over the tower, and banners down the keep's front.
  const flag = pennant(C.BLUE, C.GOLD);
  limb(b, [0, 2.6 * k, -0.05], [0, 2.95 * k, -0.05], 0.014, 0.014, bark(C.DARKWOOD), 3);
  b.card(fitted(flag), 0, 2.76 * k, 0.24 * k, 2.95 * k, -0.05);
  const hang = material("mini-keep-banner", () => {
    const p = new Pixmap(3, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 3; x++) p.set(x, y, y === 0 || y === 7 ? C.GOLD[3]! : x === 1 && (y === 3 || y === 4) ? C.GOLD[4]! : C.BLUE[3]!);
    return p;
  });
  for (const x of [-0.32 * k, 0.32 * k]) b.card(fitted(hang), x - 0.1 * k, 0.4 * k, x + 0.1 * k, 0.95 * k, s + 0.012);
  // A gate in the keep's front, dark.
  b.card(fitted(material("mini-dark", () => new Pixmap(2, 2, C.INK))), -0.12 * k, 0, 0.12 * k, 0.34 * k, s + 0.01);
}

/** A Benalish village's chapel: a white nave, a red roof, a bell tower with a spire. */
function chapel(b: MeshBuilder, k: number): void {
  const stone = tiled(wallOf("stone", C.LIMESTONE, C.BLUE[2]!));
  const roof = stock.roof(C.ROOF);
  b.box(-0.28, 0, -0.45, 0.28, 0.5, 0.3, sides(stone));
  b.at(0, 0, -0.08, Math.PI / 2, () => b.gableRoof(-0.42, -0.33, 0.42, 0.33, 0.5, 0.3, roof, stone));
  b.box(-0.16, 0, 0.18, 0.16, 0.95, 0.48, sides(stone));
  coneRoof(b, 0, 0.33, 0.95, 0.22, 0.5 * Math.max(1, k * 1.4), roof, 4);
}

/** The Academy: a marble drum under a copper dome with a lantern, a slender tower beside it, an orrery's ring. */
function academy(b: MeshBuilder, k: number, n: number): void {
  const marble = tiled(wallOf("stone", R.MARBLE, C.BLUE[1]!));
  const cu = copper(R.VERDIGRIS);
  const r = n >= 7 ? 0.62 : n >= 5 ? 0.55 : 0.4;
  b.box(-r - 0.1, 0, -r - 0.1, r + 0.1, 0.12, r + 0.1, sides(tiled(wallOf("plaster", R.MARBLE))));
  b.cylinder(0, 0, 0.12, 0.62 * k + 0.12, r, 12, marble, marble);
  dome(b, 0, 0, 0.62 * k + 0.12, r * 1.02, r * 0.85, cu, 12, 3);
  b.cylinder(0, 0, 0.62 * k + 0.1 + r * 0.85, 0.62 * k + 0.24 + r * 0.85, r * 0.16, 6, marble, marble);
  spike(b, 0, 0, 0.62 * k + 0.24 + r * 0.85, 0.62 * k + 0.4 + r * 0.85, r * 0.2, 6, material("mini-gold", () => new Pixmap(2, 2, C.GOLD[4]!)));
  if (n > 3) {
    // The mages' tower at its north-east, slender, blue-capped.
    const tx = r + 0.05;
    const tz = -r * 0.6;
    b.cylinder(tx, tz, 0, 1.7 * k, 0.14 * k, 8, marble, marble);
    spike(b, tx, tz, 1.7 * k, 2.15 * k, 0.19 * k, 8, cu);
    b.cylinder(tx, tz, 1.45 * k, 1.5 * k, 0.24 * k, 8, { mat: material("mini-gold", () => new Pixmap(2, 2, C.GOLD[4]!)) });
  }
}

/** A Keldon great hall: long and dark, a steep turf roof with horned gables, a fire before its door. */
function greatHall(b: MeshBuilder, k: number, n: number): void {
  const logs = tiled(wallOf("log", R.LOG, R.LOG[0]!));
  const roof = thatchOf(R.SOD, true);
  const L = n >= 7 ? 0.95 : n >= 5 ? 0.8 : 0.5;
  const W = n >= 7 ? 0.4 : 0.34;
  b.box(-L, 0, -W, L, 0.42 * k, W, sides(logs));
  b.gableRoof(-L - 0.06, -W - 0.08, L + 0.06, W + 0.08, 0.42 * k, 0.62 * k, roof, logs);
  // Crossed horns at each gable's peak.
  const horn = bark(R.LOG);
  for (const x of [-L - 0.06, L + 0.06]) {
    const y = 0.42 * k + 0.6 * k;
    limb(b, [x, y - 0.06, -0.05], [x + Math.sign(x) * 0.12, y + 0.22 * k, 0.12], 0.025, 0.008, horn, 3);
    limb(b, [x, y - 0.06, 0.05], [x + Math.sign(x) * 0.12, y + 0.22 * k, -0.12], 0.025, 0.008, horn, 3);
  }
  // The fire bowl before the hall, burning.
  const z = W + 0.32;
  b.cylinder(0, z, 0, 0.16, 0.11, 6, { mat: stock.cryptBrick(R.KELD_STONE) }, { mat: glowing(R.LAVA[4]!) });
  spike(b, 0, z, 0.16, 0.42, 0.08, 5, glowing(C.FIRE[3]!));
}

/** Llanowar's elfhame: giant trees, each a smooth trunk under a broad crown, platforms round them, a walk between. */
function elfhame(b: MeshBuilder, k: number, n: number): void {
  const bk = bark(R.ELFWOOD, "smooth");
  const leaf = foliage(R.ELF_LEAF);
  const spots: [number, number, number][] = n >= 7 ? [[-0.55, -0.35, 1.1], [0.6, -0.2, 1.0], [0.0, 0.55, 0.9]] : n >= 5 ? [[-0.42, -0.2, 1.0], [0.45, 0.15, 0.85]] : [[0, 0, 0.8]];
  const deck = material("mini-platform-deck", () => {
    const q = new Pixmap(8, 8);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) q.set(i, j, j % 3 === 0 ? C.WOOD[2]! : hash2(i, j, 3) < 0.15 ? C.WOOD[3]! : C.WOOD[4]!);
    return q;
  });
  spots.forEach(([x, z, s], i) => {
    const h = 2.4 * s;
    limb(b, [x, 0, z], [x, h, z], 0.22 * s, 0.13 * s, bk, 7);
    for (let r = 0; r < 4; r++) {
      const a = (r / 4) * TAU + i;
      limb(b, [x + Math.sin(a) * 0.12 * s, 0.35 * s, z + Math.cos(a) * 0.12 * s], [x + Math.sin(a) * 0.42 * s, 0, z + Math.cos(a) * 0.42 * s], 0.08 * s, 0.03 * s, bk, 3);
    }
    b.blob(x, h + 0.15, z, 0.85 * s, 0.4 * s, 0.8 * s, leaf, [i * 9, 1], 1);
    b.blob(x - 0.4 * s, h - 0.2, z + 0.15, 0.45 * s, 0.28 * s, 0.42 * s, leaf, [i * 9 + 4, 3], 0);
    b.blob(x + 0.42 * s, h - 0.12, z - 0.1, 0.42 * s, 0.26 * s, 0.4 * s, leaf, [i * 9 + 7, 5], 0);
    for (const [y, r] of [
      [0.9, 0.42],
      [1.55, 0.34],
    ] as const) {
      b.cylinder(x, z, y * s - 0.05, y * s, r * s, 8, { mat: bk }, fitted(deck));
    }
    // A lantern's glow on the lower platform.
    b.box(x + 0.3 * s, 0.9 * s, z + 0.12 * s, x + 0.36 * s, 0.98 * s, z + 0.18 * s, sides(fitted(glowing(C.GOLD[4]!))));
  });
}

/** The Vess manor: a black stone house of steep slate roofs, a tower at each end with a spire, lit windows, gold finials. */
function manor(b: MeshBuilder, k: number, n: number): void {
  const stone = tiled(wallOf("stone", R.VESS_STONE, C.GOLD[4]!));
  const slate = stock.slate(C.SLATE);
  k = n >= 7 ? 1.15 : n >= 5 ? 0.95 : 0.65;
  const L = n >= 7 ? 1.15 : n >= 5 ? 0.95 : 0.52;
  const W = n >= 5 ? 0.44 : 0.34;
  b.box(-L, 0, -W, L, 0.62 * k, W, sides(stone));
  b.gableRoof(-L - 0.05, -W - 0.06, L + 0.05, W + 0.06, 0.62 * k, 0.5 * k, slate, stone);
  // Its wings forward at each end, gabled to the front.
  for (const x of [-L + 0.2, L - 0.2]) {
    b.box(x - 0.2, 0, W - 0.05, x + 0.2, 0.55 * k, W + 0.34, sides(stone));
    b.at(x, 0, W + 0.15, Math.PI / 2, () => b.gableRoof(-0.25, -0.24, 0.25, 0.24, 0.55 * k, 0.4 * k, slate, stone));
  }
  // Towers with tall spires at the back corners, and one over the middle.
  for (const x of [-L, L]) {
    b.cylinder(x, -W, 0, 1.05 * k, 0.16 * k, 8, stone, stone);
    spike(b, x, -W, 1.05 * k, 1.85 * k, 0.21 * k, 8, slate);
  }
  spike(b, 0, 0, 0.62 * k + 0.4 * k, 1.75 * k, 0.12 * k, 6, slate);
  const gold = material("mini-gold", () => new Pixmap(2, 2, C.GOLD[4]!));
  for (const [x, y, z] of [
    [-L, 1.85 * k, -W],
    [L, 1.85 * k, -W],
    [0, 1.75 * k, 0],
  ] as const)
    b.box(x - 0.015, y, z - 0.015, x + 0.015, y + 0.08, z + 0.015, sides(fitted(gold)));
  // Dead trees on its lawn.
  const dead = bark(R.DEADWOOD);
  for (const [x, z] of [
    [-L - 0.3, W + 0.5],
    [L + 0.35, W + 0.45],
  ] as const) {
    limb(b, [x, 0, z], [x + 0.05, 0.6, z], 0.035, 0.01, dead, 3);
    limb(b, [x + 0.02, 0.3, z], [x + 0.2, 0.5, z - 0.05], 0.015, 0.005, dead, 3);
    limb(b, [x + 0.03, 0.42, z], [x - 0.15, 0.58, z + 0.04], 0.012, 0.004, dead, 3);
  }
}

/** A stilt village's hall: a bigger house on stilts, a lantern on a pole at its landing. */
function stiltHall(b: MeshBuilder, k: number): void {
  const wall = tiled(wallOf("tarred", R.TARRED, C.GOLD[4]!));
  const roof = thatchOf(R.MOSS_ROOF);
  const post = bark(R.DEADWOOD);
  for (const [x, z] of [
    [-0.28, -0.22],
    [0.28, -0.22],
    [-0.28, 0.22],
    [0.28, 0.22],
  ] as const)
    limb(b, [x, -0.1, z], [x, 0.26, z], 0.03, 0.03, post, 3);
  b.box(-0.32, 0.26, -0.26, 0.32, 0.66, 0.26, { north: wall, south: wall, east: wall, west: wall });
  b.gableRoof(-0.38, -0.32, 0.38, 0.32, 0.66, 0.42 * Math.max(1, k), roof, wall);
  // The lantern.
  limb(b, [0.45, 0, 0.42], [0.45, 0.7, 0.42], 0.015, 0.012, post, 3);
  b.box(0.42, 0.6, 0.39, 0.48, 0.68, 0.45, sides(fitted(glowing(0xc8e86a))));
}

/** A village's windmill: a round tower of daub, a thatched cap, four sails turned to the south. */
function windmill(b: MeshBuilder, _k: number, n: number): void {
  const s = n >= 5 ? 1.6 : 1.3;
  frustum(b, 0, 0, 0, 0.85 * s, 0.3 * s, 0.22 * s, 8, wallOf("plaster", C.PLASTER));
  spike(b, 0, 0, 0.83 * s, 1.2 * s, 0.3 * s, 8, thatchOf(R.THATCH));
  const sail = cutout("mini-sail", () => {
    const p = new Pixmap(4, 12);
    p.fill(0, 0);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 4; x++) p.put(x, y, x === 0 ? C.WOOD[2]! : y % 3 === 0 ? C.WOOD[4]! : x === 3 ? C.CLOTH_WHITE[3]! : C.CLOTH_WHITE[4]!);
    return p;
  });
  const hub: [number, number, number] = [0, 0.72 * s, 0.3 * s];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    b.at(hub[0], hub[1], hub[2], 0, () => {
      const len = 0.62 * s;
      const w = 0.17 * s;
      const ux = Math.sin(a);
      const uy = Math.cos(a);
      const px = Math.cos(a);
      const py = -Math.sin(a);
      b.polygon(sail, [
        [0, 0, 0],
        [ux * len, uy * len, 0],
        [ux * len + px * w, uy * len + py * w, 0],
        [px * w * 0.4, py * w * 0.4, 0],
      ], [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
      ]);
    });
  }
}


// --- The icon ------------------------------------------------------------------------------------------------------------

/** Draws a town icon about the origin: `n` tiles square in `style`, walled or not; `seed` its houses. */
export function townIcon(b: MeshBuilder, n: number, style: string, walled: boolean, seed: number): void {
  const look = lookOf(style, n);
  const random = seeded(seed * 977 + n * 13 + style.length);
  const k = n >= 7 ? 1 : n >= 5 ? 0.8 : 0.6;
  const half = n / 2;
  const inner = walled ? half - 0.3 : half;
  // The ground inside the wall (none out in the open: the land's own shows), then the streets out on all four sides.
  if (look.ground && (walled || look.roofKind === "stilt")) b.decal({ mat: look.ground }, -inner, -inner, inner, inner, 0.006);
  const sw = n >= 7 ? 0.22 : 0.18;
  b.decal({ mat: look.street }, -sw, -half, sw, half, 0.01);
  b.decal({ mat: look.street }, -half, -sw, half, sw, 0.011);
  const plaza = look.plaza(n);
  if (plaza > 0) b.decal({ mat: look.street }, -plaza + 0.12, -plaza + 0.12, plaza - 0.12, plaza - 0.12, 0.009);
  // The houses in their quarters.
  for (const lot of lots(n, walled, plaza, random)) {
    // A village's signature takes its north-east lot.
    if (n <= 3 && lot.x > 0 && lot.z < 0) continue;
    if (lot.garden && look.roofKind !== "stilt") {
      gardenTree(b, lot.x, lot.z, 0.9 + random() * 0.3, look.leaves, Math.round(lot.x * 16 + lot.z * 7));
      continue;
    }
    const tall = n >= 7 && random() < 0.35;
    const h = (tall ? 0.8 : 0.5) + random() * 0.1;
    const wall = look.walls[Math.floor(random() * look.walls.length)]!;
    house(b, look, lot.x, lot.z, lot.w, lot.d, look.roofKind === "stilt" ? h * 0.8 : h, lot.alongX, wall);
  }
  if (walled) rampart(b, look, n);
  // The signature: in the middle of a town, in a village's north-east quarter.
  if (n <= 3) b.at(0.78, 0, -0.72, 0, () => look.signature(b, k, n, random));
  else look.signature(b, k, n, random);
  // A village's well at its crossing.
  if (look.signature === windmill) b.cylinder(0.3, 0.3, 0, 0.12, 0.1, 6, tiled(wallOf("stone", C.COBBLE)), fitted(material("mini-dark", () => new Pixmap(2, 2, C.INK))));
}
