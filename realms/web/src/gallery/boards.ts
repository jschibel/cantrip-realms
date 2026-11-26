import { BUILDINGS, SHOWCASE } from "../art/buildings";
import { PROP_CATALOGUE, PROPS, TRAVEL_ENTRANCES, tilesOf } from "../art/props";
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
  /** Figures standing on it for scale (a figure id, where, which way it faces). */
  readonly figures?: readonly { readonly id: string; readonly x: number; readonly z: number; readonly face?: readonly [number, number] }[];
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
  surfaceBoard("surfaces-travel", "The travel map's open country: desert, badlands, highland, jungle", [...SURFACE_GROUPS.desert!, ...SURFACE_GROUPS.upland!, ...SURFACE_GROUPS.jungle!], "plains"),
  bands("meet-coast", "Where biomes meet: the coast", ["sea", "wet-sand", "sand", "shingle", "plains", "meadow", "grass"]),
  bands("meet-cold", "Where biomes meet: the cold north", ["ice", "snow", "tundra", "scree", "bedrock", "needles", "grass"], 18, (x, z) => (z === 9 || z === 10 ? "snow-track" : undefined)),
  bands("meet-swamp", "Where biomes meet: the Morass", ["bog", "mire", "swamp-mud", "marsh", "forest-floor", "leaf-litter", "grass"], 18, (x, z) => (z === 8 || z === 9 ? (x < 10 ? "boardwalk" : "mud-track") : undefined)),
  bands("meet-fire", "Where biomes meet: the waste and the Portal", ["lava", "basalt", "ash", "waste", "salt-flat", "phyrexian-ground", "plating"], 18, (x, z) => (x > 21 && x < 26 && z > 4 && z < 8 ? "oil" : undefined)),
  bands("meet-farm", "Where biomes meet: Benalia's farms", ["river", "meadow", "pasture", "wheat", "furrows", "crop-rows", "stubble"], 18, (x, z) => (x > 2 && (z === 6 || z === 7) ? "cart-track" : undefined)),
  bands("meet-forest", "Where biomes meet: into Llanowar", ["grass", "moss", "forest-floor", "leaf-litter", "elf-moss", "needles", "ford"], 18, (x, z) => (z === 11 ? "dirt" : undefined)),
  bands("meet-desert", "Where biomes meet: the desert, the badlands and the uplands", ["sand", "dunes", "badlands", "cracked-earth", "scree", "highland", "plains"], 18, (x, z) => (z === 9 ? "road" : undefined)),
  bands("meet-jungle", "Where biomes meet: the coast into the jungle", ["wet-sand", "sand", "grass", "jungle-floor", "marsh", "mud", "highland"], 18, (x, z) => (z === 9 ? "dirt" : undefined)),
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

// --- The travel map ---------------------------------------------------------------------------------------------------------

const HERO = (x: number, z: number) => ({ id: "hero", x, z });

/** Every kind of peak at every width, then ranges of them overlapping as the generator lays them, a figure for scale. */
function travelPeaks(): Board {
  const kinds = ["rock", "snow", "ice", "ash", "sandstone", "redrock"] as const;
  const props: PropData[] = [];
  const labels: Label[] = [];
  // A row per width: each kind once.
  let z = 4;
  for (const w of [1, 3, 5]) {
    kinds.forEach((kind, i) => {
      const x = 3.5 + i * 7;
      props.push({ id: "peak", x, z: z + 0.5, seed: i + w * 7, args: { w, kind } });
      labels.push({ text: `${kind} w${w}`, x, z: z + 0.5 + w / 2 + 0.9 });
    });
    z += w + 4;
  }
  // Ranges: peaks of mixed widths and seeds, their squares overlapping at the edges, a pass between two of them.
  const range = (kind: string, z0: number, seed: number) => {
    const run: [number, number, number][] = [[2.5, 0, 3], [5.5, 1, 5], [9.5, -1, 3], [12.5, 0, 3], [15.5, 1, 1], [21.5, 0, 5], [25.5, -1, 3], [28.5, 1, 3], [31.5, 0, 1], [37.5, 0, 5]];
    run.forEach(([x, dz, w], i) => props.push({ id: "peak", x, z: z0 + dz + 0.5, seed: seed + i * 3, args: { w, kind } }));
    labels.push({ text: `${kind} range`, x: 20, z: z0 + 4.5 });
  };
  range("snow", z + 3, 11);
  range("rock", z + 12, 23);
  range("redrock", z + 21, 37);
  const d = z + 27;
  return {
    id: "travel-peaks",
    title: "The travel map: peaks of every kind and width, and ranges of them",
    w: 42,
    d,
    ground: (x, zz) => (zz >= z + 19 ? "badlands" : zz >= z ? "scree" : "tundra"),
    bare: () => false,
    props,
    buildings: [],
    labels,
    figures: [HERO(4.5, 7.5), HERO(21, z + 6.5)],
    views: [[21, 8], [21, z - 6], [21, z + 4], [21, z + 13], [21, z + 22]],
  };
}

/** Every kind of grove, each a wood of them (to see them as one canopy) and one alone, a figure beside each. */
function travelGroves(): Board {
  const kinds = ["broadleaf", "pine", "snowpine", "swamp", "dead", "palm", "jungle", "elfwood"] as const;
  const floor: Record<string, string> = { broadleaf: "forest-floor", pine: "needles", snowpine: "snow", swamp: "mud", dead: "ash", palm: "sand", jungle: "jungle-floor", elfwood: "elf-moss" };
  const props: PropData[] = [];
  const labels: Label[] = [];
  const figures: { id: string; x: number; z: number }[] = [];
  const cells: [number, number, number, number, string][] = [];
  kinds.forEach((kind, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x0 = 1 + col * 10;
    const z0 = 2 + row * 10;
    // A wood: tiles of a ragged blob, each a grove.
    for (let dz = 0; dz < 5; dz++) {
      for (let dx = 0; dx < 5; dx++) {
        const edge = (dx === 0 || dx === 4) && (dz === 0 || dz === 4);
        if (edge || hash2(dx + i * 7, dz, 3) < 0.12) continue;
        props.push({ id: "grove", x: x0 + dx + 0.5, z: z0 + dz + 0.5, seed: i * 31 + dz * 5 + dx, args: { kind } });
      }
    }
    props.push({ id: "grove", x: x0 + 7.5, z: z0 + 2.5, seed: i + 3, args: { kind } });
    figures.push({ id: "hero", x: x0 + 6.5, z: z0 + 3.6 });
    labels.push({ text: kind, x: x0 + 4, z: z0 + 6.4 });
    cells.push([x0 - 1, z0 - 1, x0 + 9, z0 + 6, floor[kind]!]);
  });
  return {
    id: "travel-groves",
    title: "The travel map: groves of every kind, a wood of each and one alone",
    w: 41,
    d: 23,
    ground: (x, z) => cells.find(([a, b, c, d]) => x >= a && x < c && z >= b && z < d)?.[4] ?? "grass",
    bare: (x, z) => props.some((p) => Math.floor(p.x) === x && Math.floor(p.z) === z),
    props,
    buildings: [],
    labels,
    figures,
    views: [[20, 5], [20, 15]],
  };
}

/** Every style's town icon: a row each, capital walled, town walled, town open and village. */
function travelTowns(): Board {
  const styles = ["benalish", "tolarian", "urborg", "keldon", "llanowar", "argive", "village"] as const;
  const props: PropData[] = [];
  const labels: Label[] = [];
  const figures: { id: string; x: number; z: number }[] = [];
  const views: [number, number][] = [];
  const roads: [number, number, number, number][] = [];
  const ground: Record<string, string> = { benalish: "grass", tolarian: "meadow", urborg: "mud", keldon: "tundra", llanowar: "moss", argive: "grass", village: "pasture" };
  const rows: [number, number, string][] = [];
  let z = 1;
  for (const style of styles) {
    const sizes: [string, boolean, number][] = [["capital", true, 7], ["town", true, 5], ["town", false, 5], ["village", false, 3]];
    let x = 1;
    for (const [size, walled, n] of sizes) {
      const cx = x + n / 2;
      const cz = z + 3.5;
      props.push({ id: "town-icon", x: cx, z: cz, seed: x + z, args: { size, style, walled } });
      labels.push({ text: `${style} ${size}${walled ? " walled" : ""}`, x: cx, z: cz + n / 2 + 0.6 });
      // Its roads out, on all four sides, a tile long.
      roads.push([Math.floor(cx) - 0, z + 3.5 - n / 2 - 1, Math.floor(cx) + 1, z + 3.5 + n / 2 + 1]);
      roads.push([x - 1, Math.floor(cz), x + n + 1, Math.floor(cz) + 1]);
      x += n + 3;
    }
    figures.push({ id: "hero", x: 8.5 + 0.5, z: z + 3.5 + 0.5 });
    rows.push([z, z + 9, ground[style]!]);
    views.push([16, z + 3.5]);
    z += 9;
  }
  return {
    id: "travel-towns",
    title: "The travel map: town icons of every style, capital, town (walled and open) and village",
    w: 33,
    d: z + 1,
    ground: (xx, zz) => (roads.some(([a, b, c, d]) => xx >= a && xx < c && zz >= b && zz < d) ? "road" : rows.find(([a, b]) => zz >= a && zz < b)?.[2] ?? "grass"),
    bare: () => true,
    props,
    buildings: [],
    labels,
    figures,
    views,
  };
}

/** Every landmark, a figure beside each. */
function travelLandmarks(): Board {
  const kinds = ["cathedral", "great-oak", "floating-towers", "ruin", "obelisk", "arena", "lighthouse"] as const;
  const props: PropData[] = [];
  const labels: Label[] = [];
  const figures: { id: string; x: number; z: number }[] = [];
  kinds.forEach((kind, i) => {
    const x = 3.5 + (i % 4) * 7;
    const z = 4.5 + Math.floor(i / 4) * 8;
    props.push({ id: "landmark", x, z, seed: i + 1, args: { kind } });
    labels.push({ text: kind, x, z: z + 2.3 });
    figures.push({ id: "hero", x: x + 2.5, z: z + 1 });
  });
  // The dungeons' entrances at travel scale: each over the footprint the generator should give it there (TRAVEL_ENTRANCES).
  Object.entries(TRAVEL_ENTRANCES).forEach(([id, [w, d]], i) => {
    const x = 1 + i * 4;
    const z = 20;
    props.push({ id, x, z, rot: 0, seed: i, args: { w, d, ...(id === "phyrexian-portal" ? { open: true } : {}) } });
    labels.push({ text: `${id} ${w}x${d}`, x: x + w / 2, z: z + d + 0.6 });
    figures.push({ id: "hero", x: x + w / 2, z: z + d + 0.5 });
  });
  return {
    id: "travel-landmarks",
    title: "The travel map: its wonders, and the dungeons' entrances at travel scale",
    w: 29,
    d: 25,
    ground: (x, z) => (x >= 20 && z >= 9 ? "sand" : "meadow"),
    bare: () => true,
    props,
    buildings: [],
    labels,
    figures,
    lights: [{ kind: "point", color: [1.0, 0.82, 0.5], intensity: 1.6, reach: 7, at: [24.5, 2.85, 12.5] }],
    views: [[14, 5], [14, 13], [14, 21]],
  };
}

/**
 * A stretch of travel map laid by hand, 24 tiles square, as the generator would lay one: a snowy range across the north
 * with a pass, the road down through it to a crossroads and a signpost, east to a walled town and west over a river by a
 * bridge to a mage tower, a wood along the river, a figure on the road.
 */
function travelScene(): Board {
  const props: PropData[] = [];
  const W = 24;
  const D = 24;
  const blocked = new Set<string>();
  const block = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = Math.floor(z0); z < Math.ceil(z1); z++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) blocked.add(`${x},${z}`);
  };
  // The range, west and east of the pass at x 11-13.
  const peaks: [number, number, number, string][] = [
    [2.5, 2.5, 5, "snow"],
    [6.5, 1.5, 3, "snow"],
    [8.5, 4.5, 3, "snow"],
    [4.5, 6.5, 1, "rock"],
    [0.5, 6.5, 3, "rock"],
    [16.5, 3.5, 3, "snow"],
    [19.5, 1.5, 5, "snow"],
    [22.5, 4.5, 3, "snow"],
    [17.5, 6.5, 1, "rock"],
    [23.5, 7.5, 1, "rock"],
  ];
  peaks.forEach(([x, z, w, kind], i) => {
    props.push({ id: "peak", x, z, seed: 40 + i * 3, args: { w, kind } });
    block(x - w / 2, z - w / 2, x + w / 2, z + w / 2);
  });
  // The river, from the range's foot down the west, and the road.
  const river = (x: number, z: number) => z >= 8 && x >= 6 + Math.round(Math.sin(z / 3) * 0.7) && x <= 7 + Math.round(Math.sin(z / 3) * 0.7);
  const road = (x: number, z: number) => (x === 12 && z < 14) || (z === 14 && x >= 2 && x <= 19) || (x === 19 && z >= 14 && z < 16);
  // The town, east of the crossroads; the tower west of the river.
  props.push({ id: "town-icon", x: 19.5, z: 18.5, seed: 5, args: { size: "town", style: "benalish", walled: true } });
  block(17, 16, 22, 21);
  props.push({ id: "mage-tower", x: 1, z: 15, rot: 0, seed: 2, args: { w: 2, d: 2 } });
  block(1, 15, 3, 17);
  props.push({ id: "bridge", x: 5, z: 13.6, args: { to: [9, 15.4], y: 0.12 } });
  props.push({ id: "signpost", x: 13.5, z: 13.5, args: { arrows: 3, text: "Benalia" } });
  block(13, 13, 14, 14);
  props.push({ id: "waymarker", x: 13.5, z: 8.5, seed: 3, args: { tier: 2 } });
  block(13, 8, 14, 9);
  // A wood: broadleaf groves along the river's east bank and south, pines up under the range.
  const wood = (x: number, z: number) => {
    if (blocked.has(`${x},${z}`) || river(x, z) || road(x, z)) return false;
    if (z >= 8 && z <= 12 && x >= 8 && x <= 10 && hash2(x, z, 4) < 0.7) return "pine";
    if (z >= 16 && x >= 7 && x <= 14 && hash2(x, z, 5) < 0.75 - (x - 7) * 0.06) return "broadleaf";
    if (z >= 17 && x <= 4 && hash2(x, z, 6) < 0.6) return "broadleaf";
    if (z >= 7 && z <= 9 && (x <= 3 || (x >= 15 && x <= 21)) && hash2(x, z, 7) < 0.5) return "pine";
    return false;
  };
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const kind = wood(x, z);
      if (!kind) continue;
      props.push({ id: "grove", x: x + 0.5, z: z + 0.5, seed: x * 7 + z * 13, args: { kind } });
      blocked.add(`${x},${z}`);
    }
  }
  // Boulders and bushes by the road.
  for (const [id, x, z] of [
    ["boulder", 10.5, 11.5],
    ["bush", 15.5, 12.5],
    ["boulder", 16.5, 15.5],
    ["bush", 4.5, 12.5],
  ] as const) {
    props.push({ id, x, z, seed: Math.round(x + z) });
    blocked.add(`${Math.floor(x)},${Math.floor(z)}`);
  }
  const ground = (x: number, z: number): string => {
    if (river(x, z)) return "river";
    if (road(x, z) || (x === 12 && z <= 8)) return "road";
    if (blocked.has(`${x},${z}`) && z <= 8) return z <= 5 ? "rock" : "scree";
    if (z <= 7) return hash2(x, z, 9) < 0.3 ? "scree" : "highland";
    if (z <= 9) return "highland";
    if (wood(x, z) || (blocked.has(`${x},${z}`) && z >= 10 && z <= 22 && x <= 15)) return "forest-floor";
    return hash2(x >> 1, z >> 1, 3) < 0.25 ? "meadow" : "grass";
  };
  return {
    id: "travel-scene",
    title: "The travel map: a stretch of it laid by hand - a range and its pass, a wood, a river and its bridge, a town, a tower",
    w: W,
    d: D,
    ground,
    bare: (x, z) => blocked.has(`${x},${z}`),
    props,
    buildings: [],
    labels: [],
    figures: [HERO(12.5, 11.5)],
    focus: [12, 12],
    views: [[12, 12], [12, 6], [12, 17]],
  };
}

/** The travel map's boards. */
const travelBoards = (): Board[] => [travelPeaks(), travelGroves(), travelTowns(), travelLandmarks(), travelScene()];

// --- All of them -------------------------------------------------------------------------------------------------------

let cache: Board[] | null = null;

/** Every board: the surfaces, where biomes meet, the props by kind, and each building style. */
export function boards(): Board[] {
  if (!cache) cache = [...surfaceBoards, ...propBoards(), ...BUILDINGS.ids().filter((s) => SHOWCASE[s]).map(styleBoard), ...travelBoards()];
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
