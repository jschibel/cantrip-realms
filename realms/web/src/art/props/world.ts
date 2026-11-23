import type { BuildingData, PropData, Rect } from "../../world/format";
import { BUILDINGS } from "../buildings";
import { type Model, fitted, mergeModels, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import { namedPalette } from "../paint/palette";
import { Pixmap, hash2, seeded } from "../paint/pixmap";
import * as R from "../paint/ramps";
import { sprite } from "../paint/sprite";
import type { Built } from "../recipe";
import { along, centred, describe, over, prop } from "./catalogue";
import * as D from "./draw";
import { bark, cloth, cutout, glowing, limb, lump, rock, snowCover, wood } from "./kit";
import { PROPS, needs, num, point, str, turnOf } from "./registry";

// The props the world generator names (realms/web/scripts/worldgen/ids.ts) that the library had under other names or
// not at all: a town's walls, towers and gates in its region's style, the giant fungi, ice and crystal, the spell table,
// the arena's gate, a ferry's post, a pier, flower beds, and the generator's names for things defined elsewhere (a
// fence run, a wood pile). Each is catalogued with the footprint the generator gives it.

const STYLES = new Set(["benalish", "llanowar", "urborg", "morass", "keldon", "tolarian", "vess", "village", "phyrexian"]);
/** The building style a prop names in `args.style`, or Benalia's. */
const styleOf = (p: PropData): string => {
  const s = str<string>(p, "style", "benalish");
  return STYLES.has(s) && BUILDINGS.has(s) ? s : "benalish";
};

/** Everything a built thing is - its still model and its cut-aways' whole models - as one model, moved up by `dy`. */
function whole(built: Built, dy = 0): Model {
  const m = mergeModels([built.model, ...(built.cutaways ?? []).map((c) => c.full)]);
  if (dy === 0) return m;
  return { parts: m.parts.map((part) => ({ ...part, positions: part.positions.map((v, i) => (i % 3 === 1 ? v + dy : v)) })) };
}

/** A building of a style as a prop's: built on the footprint (x0, z0)-(x1, z1), its own cut-aways kept. */
function building(style: string, kind: string, x0: number, z0: number, x1: number, z1: number, p: PropData): Built {
  const bd: BuildingData = { id: `${p.id}@${p.x},${p.z}`, style, kind, x: x0, z: z0, w: x1 - x0, d: z1 - z0, rot: 0 };
  return BUILDINGS.build(style, bd, p.tint ? namedPalette(p.tint) : undefined);
}

/** Several Built as one: their models merged, their cut-aways and flames kept. */
function together(parts: readonly Built[]): Built {
  return {
    model: mergeModels(parts.map((b) => b.model)),
    cutaways: parts.flatMap((b) => b.cutaways ?? []),
    frames: parts.flatMap((b) => b.frames ?? []),
  };
}

// --- A town's walls, in its style ----------------------------------------------------------------------------------------

PROPS.define(
  "wall-run",
  "a town wall from x, z to args.to (tile middles, one straight run, a tile thick), in args.style's wall (benalish, llanowar, urborg, keldon, tolarian, vess, village, phyrexian); args.kind palisade|hedge draws those instead; args.face its outer side (n, e, s, w)",
  (p) => {
    const [x1, z1] = point(p, "to");
    const kind = str<string>(p, "kind", "wall");
    if (kind === "palisade" || kind === "hedge") return PROPS.build(kind, { ...p, id: kind });
    const [xa, xb] = [Math.min(p.x, x1) - 0.5, Math.max(p.x, x1) + 0.5];
    const [za, zb] = [Math.min(p.z, z1) - 0.5, Math.max(p.z, z1) + 0.5];
    return building(styleOf(p), "wall", xa, za, xb, zb, p);
  },
  {},
  needs({ to: "point" }),
);
describe("wall-run", { category: "fence", biomes: ["town"], footprint: along(1), sample: { args: { to: [8, 0], style: "benalish", face: "s" } } });

PROPS.define(
  "wall-tower",
  "a tower of a town wall at x, z (a corner, or beside a gate: the tile's middle), two tiles square, in args.style's",
  (p) => building(styleOf(p), "wall-tower", p.x - 1, p.z - 1, p.x + 1, p.z + 1, p),
);
describe("wall-tower", { category: "fence", biomes: ["town"], footprint: centred(2, 2), sample: { args: { style: "keldon" } } });

PROPS.define(
  "gatehouse",
  "a town gate at x, z (the gap's middle), facing rot (out of the town), args.width tiles wide (3): a tower of args.style's each side of the gap and its wall carried over it on an arch; what spans the gap is cut away while the player is under it",
  (p) => {
    const width = num(p, "width", 3);
    const rot = (((p.rot ?? 0) % 4) + 4) % 4;
    const style = styleOf(p);
    const h = width / 2;
    // The gap runs across the facing: along x facing north or south, along z facing east or west.
    const alongX = rot % 2 === 0;
    const tower = (c: number) => (alongX ? building(style, "wall-tower", c - 1, p.z - 1, c + 1, p.z + 1, p) : building(style, "wall-tower", p.x - 1, c - 1, p.x + 1, c + 1, p));
    const towers = alongX ? [tower(p.x - h - 1), tower(p.x + h + 1)] : [tower(p.z - h - 1), tower(p.z + h + 1)];
    // The arch: the style's wall over the gap, lifted clear of a rider's head.
    const span = alongX ? building(style, "wall", p.x - h, p.z - 0.5, p.x + h, p.z + 0.5, p) : building(style, "wall", p.x - 0.5, p.z - h, p.x + 0.5, p.z + h, p);
    const lintel = whole(span, 2.6);
    const gap: Rect = alongX ? [p.x - h, p.z - 2.5, p.x + h, p.z + 1.5] : [p.x - 2.5, p.z - h, p.x + 1.5, p.z + h];
    const t = together(towers);
    return { ...t, cutaways: [...(t.cutaways ?? []), { full: lintel, low: { parts: [] }, when: { player: gap } }] };
  },
);
describe("gatehouse", {
  category: "fence",
  biomes: ["town"],
  // Two towers 2 tiles square either side of the gap, its passage (args.width tiles, front to back) left walkable.
  footprint: {
    rect: [-3.5, -1, 3.5, 1],
    blocks: true,
    gateway: (p) => {
      const h = num(p, "width", 3) / 2;
      const { x, z } = p;
      return (((p.rot ?? 0) % 4) + 4) % 2 === 0
        ? { solid: [[x - h - 2, z - 1, x - h, z + 1], [x + h, z - 1, x + h + 2, z + 1]], open: [x - h, z - 1, x + h, z + 1] }
        : { solid: [[x - 1, z - h - 2, x + 1, z - h], [x - 1, z + h, x + 1, z + h + 2]], open: [x - 1, z - h, x + 1, z + h] };
    },
  },
  sample: { args: { width: 3, style: "tolarian" } },
});

// --- Growing and standing things ----------------------------------------------------------------------------------------

prop(
  "mushroom",
  "a giant fungus at x, z, scale (1), its seed which: Llanowar's green and gold, red, brown, or the Morass's glowing violet",
  { category: "plant", biomes: ["morass", "forest", "llanowar"], footprint: centred(1, 1), sample: { seed: 3 } },
  (b, p) => {
    const kinds = ["elf", "red", "brown", "glow"] as const;
    const built = PROPS.build("giant-mushroom", { ...p, id: "giant-mushroom", args: { kind: kinds[(p.seed ?? 0) % kinds.length] } });
    b.add(built.model);
  },
);

prop(
  "ice-rock",
  "a block of blue ice at x, z, snow on its top; args.r its size (0.7), seed its shape (Parma, Keld's shores)",
  { category: "rock", biomes: ["tundra", "keld", "coast"], footprint: centred(1.4, 1.4), sample: { seed: 2 } },
  (b, p) => {
    const r = num(p, "r", 0.7);
    const ice = material("ice-block", () => {
      const q = new Pixmap(32, 32);
      const k = R.ICE;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) q.set(x, y, (x + y * 2) % 11 === 0 ? k[6]! : hash2(x, y, 4) < 0.1 ? k[2]! : y % 9 < 4 ? k[4]! : k[3]!);
      return q;
    }, { smooth: true, glow: 0.12 });
    lump(b, p.x, p.z, 0, [[r, 0], [r * 0.95, r * 0.7], [r * 0.7, r * 1.3], [r * 0.35, r * 1.5]], 6, ice, p.seed ?? 0, 0.2);
    lump(b, p.x + r * 0.9, p.z + r * 0.4, 0, [[r * 0.45, 0], [r * 0.35, r * 0.5], [0, r * 0.7]], 5, ice, (p.seed ?? 0) + 3, 0.2);
    lump(b, p.x, p.z, r * 1.38, [[r * 0.45, 0], [r * 0.25, r * 0.15], [0, r * 0.2]], 6, snowCover(), (p.seed ?? 0) + 7, 0.15);
  },
);

prop(
  "crystal",
  "a growth of blue crystal at x, z, faintly glowing; args.h its tallest point (1.6), seed its make-up (Orvada's isles, Tolarian squares)",
  { category: "rock", biomes: ["coast", "town", "mountain"], footprint: centred(1.2, 1.2), sample: { seed: 1 }, light: { kind: "point", color: [0.45, 0.65, 1.0], intensity: 0.7, reach: 3, at: [0, 1, 0] } },
  (b, p) => {
    const h = num(p, "h", 1.6);
    const glass = material("crystal", () => {
      const q = new Pixmap(16, 16);
      const k = C.BLUE;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) q.set(x, y, x % 4 === 0 ? k[5]! : (x + y) % 7 === 0 ? 0xe8f4ff : y < 8 ? k[4]! : k[3]!);
      return q;
    }, { glow: 0.35 });
    const random = seeded((p.seed ?? 0) + 17);
    lump(b, p.x, p.z, 0, [[0.5, 0], [0.4, 0.15], [0, 0.22]], 6, rock(R.GRANITE, null), p.seed ?? 0, 0.2);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + random();
      const d = i === 0 ? 0 : 0.22 + random() * 0.15;
      const t = h * (i === 0 ? 1 : 0.4 + random() * 0.4);
      const r = i === 0 ? 0.16 : 0.08 + random() * 0.05;
      const x = p.x + Math.sin(a) * d;
      const z = p.z + Math.cos(a) * d;
      // A leaning six-sided prism, pointed: a limb for the shaft, a lump for the point.
      const lean = i === 0 ? 0 : 0.25;
      const top: [number, number, number] = [x + Math.sin(a) * lean * t, 0.15 + t * 0.8, z + Math.cos(a) * lean * t];
      limb(b, [x, 0.1, z], top, r, r, glass, 6);
      limb(b, top, [top[0] + Math.sin(a) * lean * t * 0.25, top[1] + t * 0.22, top[2] + Math.cos(a) * lean * t * 0.25], r, 0.005, glass, 6);
    }
  },
);

prop(
  "flower-bed",
  "a bed of flowers filling the tile at x, z (gardens): a kerb of stones round dark earth, flowers in clumps",
  { category: "plant", biomes: ["town", "plains"], footprint: centred(1, 1, false), sample: { seed: 2 } },
  (b, p) => {
    const kerb = tiled(stock.cobbleWall());
    const x0 = p.x - 0.5;
    const z0 = p.z - 0.5;
    b.box(x0, 0, z0, x0 + 1, 0.12, z0 + 0.08, sides(kerb));
    b.box(x0, 0, z0 + 0.92, x0 + 1, 0.12, z0 + 1, sides(kerb));
    b.box(x0, 0, z0 + 0.08, x0 + 0.08, 0.12, z0 + 0.92, sides(kerb));
    b.box(x0 + 0.92, 0, z0 + 0.08, x0 + 1, 0.12, z0 + 0.92, sides(kerb));
    b.decal(fitted(material("bed-earth", () => new Pixmap(4, 4, C.DIRT[1]!))), x0 + 0.08, z0 + 0.08, x0 + 0.92, z0 + 0.92, 0.06);
    const random = seeded((p.seed ?? 0) + 5);
    for (let i = 0; i < 4; i++) {
      b.blob(x0 + 0.27 + (i % 2) * 0.46, 0.18, z0 + 0.27 + Math.floor(i / 2) * 0.46, 0.22, 0.15, 0.2, D.pics.flowers(), [i * 5 + Math.floor(random() * 9), i], 1);
    }
  },
);

// --- Things players use -------------------------------------------------------------------------------------------------

/** Cards laid out on a table, 16 by 12: a deck, a hand spread, a card turned up, mana symbols on their backs. */
function cardsPicture(): Pixmap {
  const p = new Pixmap(16, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x + y) % 5 === 0 ? C.GREEN[1]! : C.GREEN[2]!);
  const card = (x: number, y: number, face: boolean) => {
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) p.set(x + i, y + j, face ? (j === 0 ? C.GOLD[4]! : j < 3 ? C.BLUE[4]! : C.CLOTH_WHITE[3]!) : j === 2 && i === 1 ? C.GOLD[4]! : C.WOOD[2]!);
  };
  card(1, 1, false);
  card(2, 2, false);
  for (let k = 0; k < 4; k++) card(6 + k * 2, 6 - (k === 1 || k === 2 ? 1 : 0), true);
  card(10, 1, true);
  return p;
}

prop(
  "spell-table",
  "a spell table at x, z: a slab of stone on a carved foot, a deck and a hand laid out on its baize, runes glowing round its rim - where a deck is built",
  { category: "street", biomes: ["town", "any"], footprint: centred(1, 1), light: { kind: "point", color: [0.6, 0.55, 1.0], intensity: 0.6, reach: 3, at: [0, 1.1, 0] } },
  (b, p) => {
    const stone = tiled(stock.cryptStone(C.DUNGEON));
    lump(b, p.x, p.z, 0, [[0.28, 0], [0.18, 0.3], [0.2, 0.7], [0.32, 0.8]], 6, stock.cryptStone(C.DUNGEON), 1, 0.05);
    b.box(p.x - 0.48, 0.8, p.z - 0.4, p.x + 0.48, 0.92, p.z + 0.4, sides(stone, fitted(material("spell-table-top", () => cardsPicture()))));
    const rune = glowing(C.PURPLE[4]!);
    for (const [dx, dz] of [
      [-0.45, -0.37],
      [0.45, -0.37],
      [-0.45, 0.37],
      [0.45, 0.37],
    ] as const)
      b.box(p.x + dx - 0.03, 0.84, p.z + dz - 0.03, p.x + dx + 0.03, 0.9, p.z + dz + 0.03, sides(fitted(rune)));
  },
);

/** A sign saying the arena opens soon, 24 by 12: lettering scrawled, an hourglass. */
function comingSoon(): Pixmap {
  const p = new Pixmap(24, 12);
  const w = C.WOOD;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) p.set(x, y, x === 0 || y === 0 ? w[6]! : x === 23 || y === 11 ? w[2]! : w[4]!);
  for (let x = 3; x < 15; x++) if (hash2(x, 3, 1) < 0.6) p.set(x, 3, w[1]!);
  for (let x = 3; x < 13; x++) if (hash2(x, 7, 2) < 0.6) p.set(x, 7, w[1]!);
  p.blit(sprite(["ggggg", ".bbb.", "..b..", ".bWb.", "bWWWb", "ggggg"], { g: C.GOLD[3]!, b: C.IRON[4]!, W: C.STRAW[4]! }), 17, 3);
  return p;
}

prop(
  "arena-gate",
  "the closed gate of a town's arena at x, z, facing rot: a stone arch, its gate barred and chained, a 'coming soon' board nailed on it; 3 wide",
  { category: "street", biomes: ["town"], footprint: { rect: [-1.5, -0.5, 1.5, 0.5], blocks: true } },
  (b, p) => {
    const lime = tiled(stock.limestone());
    b.at(p.x, 0, p.z, turnOf(p), () => {
      for (const x of [-1.5, 0.9]) b.box(x, 0, -0.45, x + 0.6, 3.0, 0.45, sides(lime, tiled(stock.flagstone())));
      b.box(-1.5, 2.4, -0.45, 1.5, 3.2, 0.45, sides(lime, tiled(stock.flagstone())));
      for (let x = -0.8; x <= 0.81; x += 0.2) b.box(x - 0.03, 0, -0.03, x + 0.03, 2.4, 0.03, sides(D.iron()));
      for (const y of [0.5, 1.4, 2.2]) b.box(-0.9, y, -0.04, 0.9, y + 0.07, 0.04, sides(D.iron()));
      limb(b, [-0.5, 1.6, 0.06], [0.5, 1.0, 0.06], 0.03, 0.03, flat(C.IRON[4]!), 4);
      b.box(-0.75, 1.15, 0.05, 0.75, 1.9, 0.09, { south: fitted(material("coming-soon", () => comingSoon())), north: tiled(wood()), east: tiled(wood()), west: tiled(wood()), top: tiled(wood()) });
      D.bannerAt(b, -1.2, 2.9, 0.45);
      D.bannerAt(b, 1.2, 2.9, 0.45);
    });
  },
);

prop(
  "ferry-post",
  "a ferry's mooring post at x, z: a thick weathered post, rope coiled round it, a bell on a bracket to call the ferryman",
  { category: "water", biomes: ["coast", "swamp"], footprint: centred(0.6, 0.6) },
  (b, p) => {
    const post = bark(R.WEATHERED, "furrowed");
    b.cylinder(p.x, p.z, 0, 1.6, 0.18, 7, { mat: post }, fitted(material("post-top", () => new Pixmap(4, 4, R.WEATHERED[4]!))));
    const rope = material("rope-coil", () => {
      const q = new Pixmap(16, 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) q.set(x, y, (x + y) % 3 === 0 ? C.STRAW[1]! : C.STRAW[3]!);
      return q;
    }, { smooth: true });
    b.cylinder(p.x, p.z, 0.5, 0.75, 0.22, 8, { mat: rope });
    limb(b, [p.x, 1.45, p.z], [p.x + 0.5, 1.6, p.z], 0.04, 0.04, flat(C.IRON[2]!), 4);
    b.cylinder(p.x + 0.45, p.z, 1.2, 1.5, 0.12, 8, { mat: flat(C.GOLD[3]!, { smooth: true }) }, undefined, -0.25);
    b.box(p.x + 0.44, 1.5, p.z - 0.01, p.x + 0.46, 1.6, p.z + 0.01, sides(D.iron()));
  },
);

PROPS.define(
  "pier",
  "a wooden pier of planks on piles over the rectangle from x, z to args.to, its deck at args.y (0.3): the dock under the world's name",
  (p, pal) => PROPS.build("dock", { ...p, id: "dock" }, pal),
  {},
  needs({ to: "point" }),
);
describe("pier", { category: "water", biomes: ["coast", "swamp", "town"], footprint: over(false), sample: { args: { to: [3, 6], y: 0.3 } } });

// --- The generator's names for things the library has -----------------------------------------------------------------------

/** A prop under a second name: drawn by the first, with the first's footprint and example. */
function alias(id: string, of: string, about: string): void {
  PROPS.define(id, `${about} (as ${of})`, (p, pal) => PROPS.build(of, { ...p, id: of }, pal), {}, (p) => PROPS.problems(of, { ...p, id: of }));
}

alias("fence-run", "fence", "a low fence from x, z to args.to (yards and fields)");
alias("wood-pile", "woodpile", "a pile of logs at x, z");
describe("fence-run", { category: "fence", biomes: ["farmland", "town", "plains"], footprint: along(0.3), sample: { args: { to: [5, 0] } } });
describe("wood-pile", { category: "goods", biomes: ["forest", "keld", "town", "farmland"], footprint: { rect: [-0.9, -0.45, 0.9, 0.45], blocks: true } });

