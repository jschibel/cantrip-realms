import { BUILDINGS, SHOWCASE } from "../art/buildings";
import { PROP_CATALOGUE, PROPS, tilesOf } from "../art/props";
import { SURFACES, SURFACE_GROUPS } from "../art/surfaces";
import { hash2 } from "../art/paint/pixmap";
import { fbm } from "../art/paint/procedural";
import type { BuildingData, LightData, PropData } from "../world/format";

// The art gallery's boards (gallery.html): small places laid out from the registries themselves, so every surface,
// prop and building style the art library has is shown, and anything added appears without touching this file. A board
// is three-free data - its tiles' surfaces, its props and buildings, labels - which the page draws (main.ts) and the
// tests check (every id on a board builds).

export interface Label {
  readonly text: string;
  readonly x: number;
  readonly z: number;
  readonly y?: number;
}

export interface Board {
  readonly id: string;
  readonly title: string;
  /** Tiles across and deep, from (0, 0). */
  readonly w: number;
  readonly d: number;
  /** A tile's surface. */
  readonly ground: (x: number, z: number) => string;
  /** Tiles nothing grows up from (under trees and buildings). */
  readonly bare?: (x: number, z: number) => boolean;
  /** Blocks of ground drawn apart (a block holds at most 16 surfaces and one hole): [x0, z0, x1, z1]. Default: one. */
  readonly blocks?: readonly (readonly [number, number, number, number])[];
  readonly props: readonly PropData[];
  readonly buildings: readonly BuildingData[];
  readonly labels: readonly Label[];
  readonly lights?: readonly LightData[];
  /** Where the camera looks first (tiles); the board's middle by default. */
  readonly focus?: readonly [number, number];
  /** Banks to show, each a surface's `cliff` standing three quarters of a tile high along x0..x1 at z, facing south. */
  readonly banks?: readonly { readonly surface: string; readonly x0: number; readonly x1: number; readonly z: number }[];
  /** The places worth a picture each (a style's rows of buildings), for the screenshots; the focus by default. */
  readonly views?: readonly (readonly [number, number])[];
}

const WIDTH = 26;

// --- Surfaces ----------------------------------------------------------------------------------------------------------

/** A surface board: each surface of a group as a patch on a backdrop, so each also shows how it meets the backdrop. */
function surfaceBoard(id: string, title: string, ids: readonly string[], backdrop: string): Board {
  const pw = 6;
  const pd = 5;
  const perRow = 4;
  const rows = Math.ceil(ids.length / perRow);
  const w = perRow * (pw + 1) + 1;
  const d = rows * (pd + 2) + 1;
  const patch = (x: number, z: number): string | undefined => {
    const col = Math.floor((x - 1) / (pw + 1));
    const row = Math.floor((z - 1) / (pd + 2));
    const fx = (x - 1) % (pw + 1);
    const fz = (z - 1) % (pd + 2);
    if (x < 1 || z < 1 || col >= perRow || fx >= pw || fz >= pd) return undefined;
    return ids[row * perRow + col];
  };
  const labels = ids.map((s, i) => ({ text: s, x: 1 + (i % perRow) * (pw + 1) + pw / 2, z: 1 + Math.floor(i / perRow) * (pd + 2) + pd + 0.6 }));
  // Each patch's bank along its back edge, as the renderer draws it where the ground steps down.
  const banks = ids.map((s, i) => ({ surface: s, x0: 1 + (i % perRow) * (pw + 1) + 0.5, x1: 1 + (i % perRow) * (pw + 1) + pw - 0.5, z: 1 + Math.floor(i / perRow) * (pd + 2) + 1.5 }));
  const holes = ids.filter((s) => SURFACES.look(s).hole);
  // Each hole surface in a block of its own (render/ground.ts discards one hole a block).
  const blocks: [number, number, number, number][] = [];
  if (holes.length > 1) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < perRow; col++) {
        const x0 = col * (pw + 1);
        blocks.push([x0 + (col === 0 ? 0 : 1), row * (pd + 2), col === perRow - 1 ? w : x0 + pw + 1, (row + 1) * (pd + 2) + (row === rows - 1 ? 1 : 0)]);
      }
    }
  }
  return {
    id,
    title,
    w,
    d,
    ground: (x, z) => patch(x, z) ?? backdrop,
    blocks: blocks.length ? blocks : undefined,
    banks,
    props: [],
    buildings: [],
    labels,
  };
}

/** Bands of surfaces from west to east with ragged, noisy borders: how biomes meet in the world. */
function bands(id: string, title: string, order: readonly string[], d = 18, extra: (x: number, z: number) => string | undefined = () => undefined, seed = 3): Board {
  const bw = 4;
  const w = order.length * bw + 2;
  const ground = (x: number, z: number) => {
    const e = extra(x, z);
    if (e) return e;
    const wobble = (fbm(x * 4, z * 4, 16, 1024, seed) - 0.5) * 5 + (hash2(x, z, seed) - 0.5) * 0.8;
    const k = Math.max(0, Math.min(order.length - 1, Math.floor((x - 1 + wobble) / bw)));
    return order[k]!;
  };
  const labels = order.map((s, i) => ({ text: s, x: 1 + i * bw + bw / 2, z: d - 0.4 }));
  return { id, title, w, d, ground, props: [], buildings: [], labels };
}

const surfaceBoards: Board[] = [
  surfaceBoard("surfaces-green", "Grass, meadow and farmland", [...SURFACE_GROUPS.grassland!, ...SURFACE_GROUPS.farmland!], "dirt"),
  surfaceBoard("surfaces-forest-swamp", "The forest floor and the swamp", [...SURFACE_GROUPS.forest!, ...SURFACE_GROUPS.swamp!], "grass"),
  surfaceBoard("surfaces-cold-stone", "Tundra, snow, ice and mountain stone", [...SURFACE_GROUPS.cold!, ...SURFACE_GROUPS.mountain!], "tundra"),
  surfaceBoard("surfaces-coast-fire", "The coast, fire and ash", [...SURFACE_GROUPS.coast!.filter((s) => s !== "sea"), ...SURFACE_GROUPS.fire!], "plains"),
  surfaceBoard("surfaces-waste", "The waste and Phyrexia", [...SURFACE_GROUPS.waste!, ...SURFACE_GROUPS.phyrexian!], "ash"),
  surfaceBoard("surfaces-roads", "Roads", SURFACE_GROUPS.roads!, "grass"),
  surfaceBoard("surfaces-waters", "Waters (each a hole, its liquid below the banks)", SURFACE_GROUPS.waters!.filter((s) => s !== "ford"), "grass"),
  bands("meet-coast", "Where biomes meet: the coast", ["sea", "wet-sand", "sand", "shingle", "plains", "meadow", "grass"]),
  bands("meet-cold", "Where biomes meet: the cold north", ["ice", "snow", "tundra", "scree", "bedrock", "needles", "grass"], 18, (x, z) => (z === 9 || z === 10 ? "snow-track" : undefined)),
  bands("meet-swamp", "Where biomes meet: the Morass", ["bog", "mire", "swamp-mud", "marsh", "forest-floor", "leaf-litter", "grass"], 18, (x, z) => (z === 8 || z === 9 ? (x < 10 ? "boardwalk" : "mud-track") : undefined)),
  bands("meet-fire", "Where biomes meet: the waste and the Portal", ["lava", "basalt", "ash", "waste", "salt-flat", "phyrexian-ground", "plating"], 18, (x, z) => (x > 21 && x < 26 && z > 4 && z < 8 ? "oil" : undefined)),
  bands("meet-farm", "Where biomes meet: Benalia's farms", ["river", "meadow", "pasture", "wheat", "furrows", "crop-rows", "stubble"], 18, (x, z) => (x > 2 && (z === 6 || z === 7) ? "cart-track" : undefined)),
  bands("meet-forest", "Where biomes meet: into Llanowar", ["grass", "moss", "forest-floor", "leaf-litter", "elf-moss", "needles", "ford"], 18, (x, z) => (z === 11 ? "dirt" : undefined)),
];

// --- Props ---------------------------------------------------------------------------------------------------------------

/** Props laid out in rows on a ground, each with its id under it; line and area props' `args.to` are taken as offsets. */
function propBoard(id: string, title: string, ids: readonly string[], ground: string): Board {
  const props: PropData[] = [];
  const labels: Label[] = [];
  let x = 1;
  let z = 3;
  let rowDepth = 0;
  for (const pid of ids) {
    const info = PROP_CATALOGUE.get(pid)!;
    const fp = info.footprint;
    const to = info.sample.args?.to as [number, number] | undefined;
    const sized = "sized" in fp ? extent(pid) : undefined;
    const [fw, fd] = "rect" in fp ? [fp.rect[2] - fp.rect[0], fp.rect[3] - fp.rect[1]] : sized ? sized : to ? [Math.abs(to[0]) + 1, Math.abs(to[1]) + 1] : [1, 1];
    const cw = Math.max(3, Math.ceil(fw) + 2);
    const cd = Math.max(4, Math.ceil(fd) + 3);
    if (x + cw > WIDTH) {
      x = 1;
      z += rowDepth;
      rowDepth = 0;
    }
    const line = !("rect" in fp) && !sized;
    const ax = sized ? x + 1 : line ? x + 1 : x + cw / 2;
    const az = sized ? z + 0.5 : line ? z + 0.5 : "rect" in fp ? z + 0.5 - fp.rect[1] : z + 1.5;
    const gate = info.sample.args?.gate as [number, number] | undefined;
    const args = to ? { ...info.sample.args, to: [ax + to[0], az + to[1]], ...(gate ? { gate: [az + gate[0], az + gate[1]] } : {}) } : info.sample.args;
    props.push({ ...info.sample, id: pid, x: ax, z: az, ...(args ? { args } : {}) });
    labels.push({ text: pid, x: sized ? ax + fw / 2 : line ? ax + (to ? to[0] / 2 : 0) : ax, z: sized ? az + fd + 0.6 : line ? az + (to ? Math.max(0, to[1]) : 0) + 0.9 : az + ("rect" in fp ? fp.rect[3] : 0) + 0.6 });
    x += cw;
    rowDepth = Math.max(rowDepth, cd);
  }
  const d = z + rowDepth + 1;
  return { id, title, w: WIDTH, d, ground: () => ground, props, buildings: [], labels };
}

/** A sized prop's footprint at its defaults (a dungeon entrance's), across and deep. */
function extent(id: string): [number, number] {
  const { tiles } = tilesOf({ id, x: 0, z: 0 });
  return [Math.max(...tiles.map(([x]) => x)) + 1, Math.max(...tiles.map(([, z]) => z)) + 1];
}

const byCategory = (...cats: string[]) => [...PROP_CATALOGUE.values()].filter((p) => cats.includes(p.category)).map((p) => p.id);

/** The prop boards: by category, a ground under each that suits it. Props not catalogued are left out (indoors). */
function propBoards(): Board[] {
  const boards: [string, string, string[], string][] = [
    ["props-trees", "Trees of every region", byCategory("tree"), "grass"],
    ["props-plants", "Undergrowth, plants, stumps and logs", byCategory("plant"), "forest-floor"],
    ["props-stone", "Rocks, crags, cliffs and mountains", byCategory("rock", "mountain"), "tundra"],
    ["props-country", "Fences, walls, hedges and ruins", byCategory("fence", "ruin"), "plains"],
    ["props-road", "Lamps, signs, waymarkers and banners", byCategory("light", "sign"), "cobbles"],
    ["props-goods", "Wells, carts, goods, stalls and camps", byCategory("goods", "travel", "street"), "dirt"],
    ["props-water", "Bridges, fords, docks and boats", byCategory("water"), "sand"],
    ["props-phyrexian", "Phyrexian wreckage", byCategory("phyrexian"), "phyrexian-ground"],
    ["props-entrances", "Dungeon entrances", byCategory("entrance"), "bedrock"],
  ];
  return boards.filter(([, , ids]) => ids.length > 0).map(([id, title, ids, ground]) => propBoard(id, title, ids, ground));
}

// --- Buildings ------------------------------------------------------------------------------------------------------------

/** The street between rows of buildings: wide enough that a tall one does not stand over the row behind's labels. */
const STREET = 5;

/** A style's buildings in a street: every kind it shows (art/buildings, SHOWCASE), fronts to the street. */
function styleBoard(style: string): Board {
  const show = SHOWCASE[style] ?? [];
  const buildings: BuildingData[] = [];
  const labels: Label[] = [];
  const props: PropData[] = [];
  let x = 1;
  let z = 2;
  let rowDepth = 0;
  const street: [number, number][] = [];
  show.forEach((s, i) => {
    if (x + s.w > WIDTH + 6) {
      street.push([z + rowDepth, z + rowDepth + STREET]);
      x = 1;
      z += rowDepth + STREET + 1;
      rowDepth = 0;
    }
    const doorAt = Math.floor(x + s.w / 2);
    buildings.push({ id: `${style}-${i}`, style, kind: s.kind, x, z, w: s.w, d: s.d, rot: 0, door: [doorAt, z + s.d], palette: s.palette, params: s.params, sign: s.sign });
    labels.push({ text: `${s.kind}${s.label ? ` (${s.label})` : ""} ${s.w}x${s.d}`, x: x + s.w / 2, z: z + s.d + 0.9 });
    x += s.w + 2;
    rowDepth = Math.max(rowDepth, s.d);
  });
  street.push([z + rowDepth, z + rowDepth + STREET]);
  const d = z + rowDepth + STREET + 1;
  const w = WIDTH + 6;
  // A picture of each row of buildings, looking at its fronts.
  const views = street.map(([a]) => [w / 2, a - 2] as const);
  const look = STYLE_GROUND[style] ?? ["grass", "cobbles"];
  const onStreet = (zz: number) => street.some(([a, b]) => zz >= a && zz < b);
  const inBuilding = (xx: number, zz: number) => buildings.some((b) => xx >= b.x && xx < b.x + b.w && zz >= b.z && zz < b.z + b.d);
  return {
    id: `style-${style}`,
    title: `${style} buildings, every kind`,
    w,
    d,
    ground: (xx, zz) => (onStreet(zz) ? look[1] : look[0]),
    bare: inBuilding,
    props,
    buildings,
    labels,
    views,
  };
}

/** The ground a style's town stands on and its streets. */
const STYLE_GROUND: Readonly<Record<string, readonly [string, string]>> = {
  benalish: ["grass", "cobbles"],
  llanowar: ["elf-moss", "forest-floor"],
  morass: ["mire", "boardwalk"],
  keldon: ["snow", "snow-track"],
  tolarian: ["meadow", "marble-paving"],
  vess: ["swamp-mud", "setts"],
  village: ["pasture", "cart-track"],
  phyrexian: ["phyrexian-ground", "plating"],
};

// --- All of them -------------------------------------------------------------------------------------------------------

let cache: Board[] | null = null;

/** Every board: the surfaces, where biomes meet, the props by kind, and each building style. */
export function boards(): Board[] {
  if (!cache) cache = [...surfaceBoards, ...propBoards(), ...BUILDINGS.ids().filter((s) => SHOWCASE[s]).map(styleBoard)];
  return cache;
}

export function boardById(id: string | null): Board {
  const all = boards();
  return all.find((b) => b.id === id) ?? all[0]!;
}

/** What a board names that the registries lack (none, if the library is whole): for the tests. */
export function missing(board: Board): string[] {
  const out: string[] = [];
  for (let z = 0; z < board.d; z++) for (let x = 0; x < board.w; x++) if (!SURFACES.has(board.ground(x, z))) out.push(`surface ${board.ground(x, z)}`);
  for (const p of board.props) if (!PROPS.has(p.id)) out.push(`prop ${p.id}`);
  for (const b of board.buildings) if (!BUILDINGS.has(b.style)) out.push(`style ${b.style}`);
  return [...new Set(out)];
}
