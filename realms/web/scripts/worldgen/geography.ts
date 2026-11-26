// The travel map's geography as data (realms/content/<plane>/geography.json): the sketch the world generator grows the
// travel map from - authored feature curves (coasts, lakes, rivers, ridges, areas of land) with the places on them, for
// procedural detail to be laid on top. Dominaria's is the Domains traced from the reference maps (realms/docs/ref):
// the coast from domains2.jpg by color, everything else placed by hand from all five references.
//
// Units and conventions, for everything below:
// - Coordinates are travel-map tiles: x east, z south, (0, 0) the north-west corner of the map; the map is `size` tiles.
//   Tile [x, z] is the square from (x, z) to (x + 1, z + 1); its middle is (x + 0.5, z + 0.5).
// - Polygons are lists of points [x, z] in continuous tile coordinates, implicitly closed (the last point joins the
//   first; it is not repeated), simple (no edge crosses another) and ordered clockwise as seen on the map (with x east
//   and z south, the shoelace sum is positive). A tile is inside a polygon when its middle is.
// - Polylines (rivers, ridges) are lists of points [x, z] in the same coordinates, in the order the doc says.
// - Places (towns, dungeons, landmarks, ferry docks, passes, region seeds) are whole tiles [x, z].
// - Ids are kebab-case and unique within their list. Names are display names; "" is a feature the sources leave unnamed.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Region, STYLES, type Style } from "../../src/world/format";
import { BIOMES, type Layout, readLayout } from "./layout";

export type XZ = readonly [number, number];
export type Side = "north" | "east" | "south" | "west";
export const SIDES: readonly Side[] = ["north", "east", "south", "west"];

/** layout.ts's biomes and the travel map's new ones (the towns' generator takes the same list). */
export const GEO_BIOMES = [...BIOMES, "desert", "badlands", "highlands", "jungle"] as const;
export type GeoBiome = (typeof GEO_BIOMES)[number];

/** The kinds of a range's miniature peaks (the travel art's `peak` prop, `args.kind`). */
export const PEAK_KINDS = ["rock", "snow", "ice", "ash", "sandstone", "redrock"] as const;
export type PeakKind = (typeof PEAK_KINDS)[number];

/** The kinds of a landmark (the travel art's `landmark` prop, `args.kind`; a 3x3 footprint, blocked). */
export const LANDMARK_KINDS = ["cathedral", "great-oak", "floating-towers", "ruin", "obelisk", "arena", "lighthouse"] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

/** An island or continent: the land within its coast. Landmasses never overlap or touch. */
export interface GeoLandmass {
  readonly id: string;
  readonly name: string;
  /** The coast, a polygon. Every point is at least `margin` tiles from the map's edge. */
  readonly points: readonly XZ[];
}

/** A lake (open water) or a mere of the swamp (`swamp`: shallow, reedy water), cut out of one landmass's land. */
export interface GeoLake {
  readonly id: string;
  readonly name: string;
  readonly kind: "water" | "swamp";
  /** Its shore, a polygon wholly inside one landmass. */
  readonly points: readonly XZ[];
}

/** A river: a polyline from its source (on land) to its mouth: the sea, a lake, or a point on another river. */
export interface GeoRiver {
  readonly id: string;
  readonly name: string;
  /** Tiles across, 1 to 3. */
  readonly width: number;
  /** Source first. The first point is on land; the last is in the sea (off every landmass), inside a lake, or within
   * 1.5 tiles of another river's line (a tributary joining it). */
  readonly points: readonly XZ[];
}

/** A mountain range, drawn as a ridge line with a band of peaks along it. */
export interface GeoRange {
  readonly id: string;
  readonly name: string;
  /** The crest, a polyline end to end; every point on land. */
  readonly points: readonly XZ[];
  /** Tiles across the band of peaks (centred on the crest). */
  readonly width: number;
  /** How high and impassable: 1 hills, crossed where one likes; 2 mountains, crossed at gaps; 3 the great ranges, a
   * wall crossed only at its passes. */
  readonly height: 1 | 2 | 3;
  readonly kind: PeakKind;
}

/** A gap in a range where a road crosses it: the generator keeps a way open through the peaks here. */
export interface GeoPass {
  readonly name: string;
  /** The range's id. */
  readonly range: string;
  /** On the crest (within half the range's width of it), on land. */
  readonly at: XZ;
}

/** A stretch of land of one biome: painted over the land in order (later entries over earlier), clipped to the land. */
export interface GeoArea {
  readonly id: string;
  readonly name: string;
  readonly biome: GeoBiome;
  /** When given, it paints only this landmass's land (so a loose polygon cannot spill onto the land across a strait). */
  readonly landmass?: string;
  /** A polygon; it may run out over the sea (only its land counts), but stays within the map. */
  readonly points: readonly XZ[];
}

/**
 * A region of the game (layout.json's, carried over, and the travel map's new ones): its land is every land tile whose
 * nearest seed (distance divided by `weight`) is one of its seeds - among the seeds on the tile's own landmass, or among
 * every seed when that landmass has none (`regionAt`). The generator may wave the borders with noise.
 */
export interface GeoRegion {
  readonly id: string;
  readonly name: string;
  readonly color: Region | null;
  readonly biome: GeoBiome;
  readonly style: Style;
  /** The names of its bands of tier, 1 to 4. */
  readonly areas: readonly [string, string, string, string];
  /** How far its land reaches against its neighbours' (1 by default). */
  readonly weight?: number;
  /** The least tier of its wilds. */
  readonly minTier?: number;
  /** Each on land. */
  readonly seeds: readonly XZ[];
}

/** Where a town stands on the travel map, and what of its setting its grounds should show (towns.ts TownSetting). */
export interface GeoTown {
  /** The middle tile of its icon (7x7 capital, 5x5 town, 3x3 village by layout.json's `kind`); the icon and a ring of
   * one tile round it are open land, off every ridge, lake and river (unless the river runs `through`). */
  readonly at: XZ;
  /** The landmass and region it is meant to stand in (checked). */
  readonly landmass: string;
  readonly region: string;
  /** The sides of the town the sea lies on, within 12 tiles of its icon. */
  readonly sea?: readonly Side[];
  /** A river past it on that side (within 10 tiles), or through it. */
  readonly river?: Side | "through";
  /** How hilly its ground is, 0 flat to 1 a terraced hillside. */
  readonly relief?: number;
}

/** A dungeon's or mage tower's entrance on the travel map: a 5x5 square of open land round it, off the ridges. */
export interface GeoDungeon {
  readonly at: XZ;
  readonly landmass: string;
  readonly region: string;
}

/** A ferry over the sea: a dock at each end, the lane between them straight and over water. */
export interface GeoFerry {
  readonly id: string;
  readonly name: string;
  /** Each a tile on land within 3 tiles of the shore it docks at. */
  readonly from: XZ;
  readonly to: XZ;
}

/** A road between two places on the same landmass: town ids, dungeon ids, or a ferry's dock `ferry:<id>:from|to`. */
export interface GeoRoad {
  readonly from: string;
  readonly to: string;
  /** A trunk road (wider, the way to the far places). */
  readonly main?: boolean;
  /** The passes it goes through, in order from `from`, by name. */
  readonly via?: readonly string[];
}

export interface GeoLandmark {
  readonly id: string;
  readonly name: string;
  readonly kind: LandmarkKind;
  /** The middle of its 3x3 footprint, open land with a ring of one tile round it. */
  readonly at: XZ;
  readonly region: string;
}

/** A name written over the map (format.ts WorldData labels). */
export interface GeoLabel {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly kind: "land" | "region" | "feature" | "sea";
}

export interface Geography {
  readonly plane: string;
  /** The travel map's tiles, x by z: [512, 768]. */
  readonly size: XZ;
  /** The least sea between any land and the map's edge, tiles. */
  readonly margin: number;
  /** The biome of land no area covers. */
  readonly base: GeoBiome;
  /** The map the coast was traced from: tile = pixel * scale + offset (for the preview's side-by-side). */
  readonly reference?: { readonly image: string; readonly scale: number; readonly offset: XZ; readonly note?: string };
  readonly landmasses: readonly GeoLandmass[];
  readonly lakes: readonly GeoLake[];
  readonly rivers: readonly GeoRiver[];
  readonly mountains: readonly GeoRange[];
  readonly passes: readonly GeoPass[];
  readonly areas: readonly GeoArea[];
  readonly regions: readonly GeoRegion[];
  /** Every town of layout.json, by id. */
  readonly towns: Readonly<Record<string, GeoTown>>;
  /** Every dungeon and mage tower of layout.json, by id. */
  readonly dungeons: Readonly<Record<string, GeoDungeon>>;
  readonly ferries: readonly GeoFerry[];
  readonly roads: readonly GeoRoad[];
  readonly landmarks: readonly GeoLandmark[];
  readonly labels: readonly GeoLabel[];
}

/** The regions the travel map adds to layout.json's, on purpose: canon lands the game had no region for. */
export const ADDED_REGIONS = ["whispering-woods", "smoke-mountains", "wrenna", "kbriann", "kush", "tonga"] as const;
/** The ferries the travel map adds to layout.json's four. */
export const ADDED_FERRIES = ["avenant-ferry", "foriys-ferry", "orvada-ferry", "denawa-ferry"] as const;

const here = dirname(fileURLToPath(import.meta.url));

/** The plane's geography file, unchecked (`checkGeography` says what is wrong with it). */
export function readGeography(plane = "dominaria"): Geography {
  return JSON.parse(readFileSync(join(here, "..", "..", "..", "content", plane, "geography.json"), "utf8")) as Geography;
}

// ---------------------------------------------------------------------------------------------------------- geometry

/** The list's `i`th item, which the caller knows is there. */
function nth<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new RangeError(`no item ${i} of ${xs.length}`);
  return v;
}

/** Whether the point is inside the polygon (even-odd). */
export function inPolygon(points: readonly XZ[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = nth(points, i);
    const [xj, zj] = nth(points, j);
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The distance from the point to the polyline (or to a polygon's outline, `closed`). */
export function distanceToLine(points: readonly XZ[], x: number, z: number, closed = false): number {
  let best = Infinity;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, az] = nth(points, i);
    const [bx, bz] = nth(points, (i + 1) % points.length);
    const dx = bx - ax;
    const dz = bz - az;
    const len = dx * dx + dz * dz;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  if (points.length === 1) best = Math.hypot(x - nth(points, 0)[0], z - nth(points, 0)[1]);
  return best;
}

/** Twice the polygon's signed area: positive when its points run clockwise on the map (x east, z south). */
export function signedArea2(points: readonly XZ[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = nth(points, i);
    const [bx, bz] = nth(points, (i + 1) % points.length);
    s += ax * bz - bx * az;
  }
  return s;
}

function cross(o: XZ, a: XZ, b: XZ): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Whether segments ab and cd cross or touch. */
function segmentsMeet(a: XZ, b: XZ, c: XZ, d: XZ): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: XZ, q: XZ, r: XZ) => cross(p, q, r) === 0 && Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return on(c, d, a) || on(c, d, b) || on(a, b, c) || on(a, b, d);
}

/** The first two edges of the polygon that cross (or meet other than at their shared corner), if any. */
export function selfCrossing(points: readonly XZ[]): [number, number] | null {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a corner
      if (segmentsMeet(nth(points, i), nth(points, (i + 1) % n), nth(points, j), nth(points, (j + 1) % n))) return [i, j];
    }
  }
  return null;
}

function bounds(points: readonly XZ[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of points) {
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
}

// ------------------------------------------------------------------------------------------------------ the queries

/** The landmass the point is on, or undefined at sea. A point in a lake is still on its landmass. */
export function landmassAt(geo: Geography, x: number, z: number): GeoLandmass | undefined {
  return geo.landmasses.find((l) => inPolygon(l.points, x, z));
}

/** Whether the point is dry land: on a landmass and in no lake. */
export function onLand(geo: Geography, x: number, z: number): boolean {
  return landmassAt(geo, x, z) !== undefined && !geo.lakes.some((l) => inPolygon(l.points, x, z));
}

/** Whether tile [x, z] is dry land (its middle is). */
export function tileOnLand(geo: Geography, x: number, z: number): boolean {
  return onLand(geo, x + 0.5, z + 0.5);
}

/** The region the point belongs to (the nearest seed on its landmass, distance over weight; any seed when its landmass
 * has none), or undefined at sea. */
export function regionAt(geo: Geography, x: number, z: number): GeoRegion | undefined {
  const land = landmassAt(geo, x, z);
  if (land === undefined) return undefined;
  const seedsOn = (r: GeoRegion) => r.seeds.filter((s) => inPolygon(land.points, s[0] + 0.5, s[1] + 0.5));
  const local = geo.regions.some((r) => seedsOn(r).length > 0);
  let best: GeoRegion | undefined;
  let bestD = Infinity;
  for (const r of geo.regions) {
    for (const s of local ? seedsOn(r) : r.seeds) {
      const d = Math.hypot(x - (s[0] + 0.5), z - (s[1] + 0.5)) / (r.weight ?? 1);
      if (d < bestD) { bestD = d; best = r; }
    }
  }
  return best;
}

/** The biome of the land at the point: the last area over it (on its landmass, when the area names one), else `base`;
 * undefined at sea. */
export function biomeAt(geo: Geography, x: number, z: number): GeoBiome | undefined {
  const land = landmassAt(geo, x, z);
  if (land === undefined) return undefined;
  for (let i = geo.areas.length - 1; i >= 0; i--) {
    const a = nth(geo.areas, i);
    if ((a.landmass === undefined || a.landmass === land.id) && inPolygon(a.points, x, z)) return a.biome;
  }
  return geo.base;
}

/** The tile a road end names (a town's or dungeon's tile, or a ferry's dock). */
export function placeOf(geo: Geography, end: string): XZ | undefined {
  const dock = /^ferry:(.+):(from|to)$/.exec(end);
  if (dock) {
    const f = geo.ferries.find((g) => g.id === dock[1]);
    return f === undefined ? undefined : dock[2] === "from" ? f.from : f.to;
  }
  return geo.towns[end]?.at ?? geo.dungeons[end]?.at;
}

/** The tiles inside a polygon (their middles inside, even-odd), as 1s in a `w` by `h` grid indexed `z * w + x`. */
export function fillPolygon(points: readonly XZ[], w: number, h: number, into = new Uint8Array(w * h), value = 1): Uint8Array {
  for (let z = 0; z < h; z++) {
    const y = z + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, zi] = nth(points, i);
      const [xj, zj] = nth(points, j);
      if (zi > y !== zj > y) xs.push(((xj - xi) * (y - zi)) / (zj - zi) + xi);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // tiles whose middle x + 0.5 lies in [xs[k], xs[k + 1])
      for (let x = Math.max(0, Math.ceil(nth(xs, k) - 0.5)); x < Math.min(w, Math.ceil(nth(xs, k + 1) - 0.5)); x++) into[z * w + x] = value;
    }
  }
  return into;
}

/** Every tile of the map: the index (in `landmasses`) of the landmass it is on, or -1 at sea; and 1 where a lake is. */
export function landGrid(geo: Geography): { readonly land: Int16Array; readonly lake: Uint8Array } {
  const [W, H] = geo.size;
  const land = new Int16Array(W * H).fill(-1);
  geo.landmasses.forEach((l, i) => {
    const one = fillPolygon(l.points, W, H);
    for (let k = 0; k < one.length; k++) if (one[k]) land[k] = i;
  });
  const lake = new Uint8Array(W * H);
  for (const l of geo.lakes) fillPolygon(l.points, W, H, lake);
  return { land, lake };
}

/**
 * The tiles a walker on dry land reaches from `from` (4-neighbour steps), where the great ranges (height 3) are walls:
 * every tile within half a range's width of its crest is shut - but, when `passes` is true, those within half the
 * width and a tile and a half of one of the range's passes (the way the generator keeps open through it). A grid
 * indexed `z * W + x`, 1 where reached.
 */
export function reachable(geo: Geography, from: XZ, passes: boolean): Uint8Array {
  const [W, H] = geo.size;
  const { land, lake } = landGrid(geo);
  const shut = new Uint8Array(W * H);
  for (const m of geo.mountains) {
    if (m.height !== 3) continue;
    const [x0, z0, x1, z1] = bounds(m.points);
    const r = m.width / 2;
    const open = passes ? geo.passes.filter((p) => p.range === m.id) : [];
    for (let z = Math.max(0, Math.floor(z0 - r)); z < Math.min(H, Math.ceil(z1 + r)); z++) {
      for (let x = Math.max(0, Math.floor(x0 - r)); x < Math.min(W, Math.ceil(x1 + r)); x++) {
        if (distanceToLine(m.points, x + 0.5, z + 0.5) >= r) continue;
        if (open.some((p) => Math.hypot(x - p.at[0], z - p.at[1]) < r + 1.5)) continue;
        shut[z * W + x] = 1;
      }
    }
  }
  const seen = new Uint8Array(W * H);
  const walk = (k: number) => (land[k] ?? -1) >= 0 && !lake[k] && !shut[k];
  const start = from[1] * W + from[0];
  if (!walk(start)) return seen;
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const k = queue.pop() ?? 0;
    const x = k % W;
    for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W]) {
      if (n >= 0 && n < W * H && !seen[n] && walk(n)) { seen[n] = 1; queue.push(n); }
    }
  }
  return seen;
}

/** Tiles across a town's icon, by its kind in layout.json. */
export function iconSize(kind: "capital" | "town" | "village"): number {
  return kind === "capital" ? 7 : kind === "town" ? 5 : 3;
}

// ------------------------------------------------------------------------------------------------------- the check

const STEP: Record<Side, XZ> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/**
 * What is wrong with a geography, as against today's layout: everything the generator relies on. Polygons closed,
 * simple, clockwise and inside the frame with the sea margin, landmasses apart; lakes inside their landmass; rivers
 * from land to the sea, a lake or another river; ridges on land and passes on their ridges; regions carried over from
 * the layout (plus ADDED_REGIONS) with their seeds on land; the towns and dungeons exactly the layout's, each on open
 * land in the landmass and region it names, with the sea and river it says; landmarks likewise; ferry docks on land by
 * a shore with open water between them; roads between places on one landmass through passes that exist, connecting
 * every town to New Benalia over the roads and ferries; labels in the frame; ids unique.
 */
export function checkGeography(geo: Geography, layout: Layout = readLayout(geo.plane)): string[] {
  const problems: string[] = [];
  const [W, H] = geo.size;
  const M = geo.margin;
  if (W !== 512 || H !== 768) problems.push(`size ${String(geo.size)} should be [512, 768]`);
  if (!(M >= 12)) problems.push(`margin ${M} should be 12 tiles or more`);
  if (!(GEO_BIOMES as readonly string[]).includes(geo.base)) problems.push(`base biome ${geo.base} is unknown`);

  const unique = (what: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`two ${what} share the id ${id}`);
      seen.add(id);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) problems.push(`${what} id ${id} is not kebab-case`);
    }
  };
  unique("landmasses", geo.landmasses.map((l) => l.id));
  unique("lakes", geo.lakes.map((l) => l.id));
  unique("rivers", geo.rivers.map((r) => r.id));
  unique("ranges", geo.mountains.map((m) => m.id));
  unique("areas", geo.areas.map((a) => a.id));
  unique("regions", geo.regions.map((r) => r.id));
  unique("ferries", geo.ferries.map((f) => f.id));
  unique("landmarks", geo.landmarks.map((l) => l.id));
  if (new Set(geo.passes.map((p) => p.name)).size !== geo.passes.length) problems.push("two passes share a name");

  const polygon = (what: string, points: readonly XZ[], frame: number) => {
    if (points.length < 3) { problems.push(`${what}: fewer than 3 points`); return; }
    const [a, b] = [nth(points, 0), nth(points, points.length - 1)];
    if (a[0] === b[0] && a[1] === b[1]) problems.push(`${what}: the last point repeats the first (polygons close themselves)`);
    if (!(signedArea2(points) > 0)) problems.push(`${what}: not clockwise on the map`);
    const crossing = selfCrossing(points);
    if (crossing) problems.push(`${what}: edges ${crossing[0]} and ${crossing[1]} cross`);
    for (const [x, z] of points) {
      if (!(x >= frame && z >= frame && x <= W - frame && z <= H - frame)) { problems.push(`${what}: point [${x}, ${z}] is within ${frame} tiles of the map's edge`); break; }
    }
  };

  // Land and water.
  for (const l of geo.landmasses) polygon(`landmass ${l.id}`, l.points, M);
  const boxes = geo.landmasses.map((l) => bounds(l.points));
  for (let i = 0; i < geo.landmasses.length; i++) {
    for (let j = i + 1; j < geo.landmasses.length; j++) {
      const [a, b] = [nth(boxes, i), nth(boxes, j)];
      if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
      const [p, q] = [nth(geo.landmasses, i), nth(geo.landmasses, j)];
      const meet = p.points.some((_, k) => q.points.some((__, m) => segmentsMeet(nth(p.points, k), nth(p.points, (k + 1) % p.points.length), nth(q.points, m), nth(q.points, (m + 1) % q.points.length))));
      if (meet || inPolygon(q.points, nth(p.points, 0)[0], nth(p.points, 0)[1]) || inPolygon(p.points, nth(q.points, 0)[0], nth(q.points, 0)[1])) problems.push(`landmasses ${p.id} and ${q.id} overlap or touch`);
    }
  }
  for (const l of geo.lakes) {
    polygon(`lake ${l.id}`, l.points, M);
    if (l.kind !== "water" && l.kind !== "swamp") problems.push(`lake ${l.id}: kind ${String(l.kind)} is unknown`);
    const land = landmassAt(geo, nth(l.points, 0)[0], nth(l.points, 0)[1]);
    if (land === undefined || l.points.some(([x, z]) => !inPolygon(land.points, x, z) || distanceToLine(land.points, x, z, true) < 1)) problems.push(`lake ${l.id} is not wholly inside one landmass, a tile from its coast`);
  }
  const inLake = (x: number, z: number) => geo.lakes.some((l) => inPolygon(l.points, x, z));
  for (const r of geo.rivers) {
    if (r.points.length < 2) { problems.push(`river ${r.id}: fewer than 2 points`); continue; }
    if (!(r.width >= 1 && r.width <= 3)) problems.push(`river ${r.id}: width ${r.width} should be 1 to 3`);
    const [sx, sz] = nth(r.points, 0);
    if (!onLand(geo, sx, sz)) problems.push(`river ${r.id} rises off the land, at [${sx}, ${sz}]`);
    const [mx, mz] = nth(r.points, r.points.length - 1);
    const joins = geo.rivers.some((o) => o !== r && distanceToLine(o.points, mx, mz) <= 1.5);
    if (landmassAt(geo, mx, mz) !== undefined && !inLake(mx, mz) && !joins) problems.push(`river ${r.id} ends on land at [${mx}, ${mz}], not in the sea, a lake or another river`);
    for (const [x, z] of r.points.slice(1, -1)) if (landmassAt(geo, x, z) === undefined) problems.push(`river ${r.id} runs out to sea at [${x}, ${z}] before its mouth`);
  }

  // Relief.
  const ranges = new Map(geo.mountains.map((m) => [m.id, m]));
  for (const m of geo.mountains) {
    if (m.points.length < 2) problems.push(`range ${m.id}: fewer than 2 points`);
    if (!(m.width >= 1)) problems.push(`range ${m.id}: width ${m.width}`);
    if (![1, 2, 3].includes(m.height)) problems.push(`range ${m.id}: height ${m.height} should be 1, 2 or 3`);
    if (!(PEAK_KINDS as readonly string[]).includes(m.kind)) problems.push(`range ${m.id}: kind ${m.kind} is unknown`);
    for (const [x, z] of m.points) if (!onLand(geo, x, z)) problems.push(`range ${m.id}: its crest leaves the land at [${x}, ${z}]`);
  }
  for (const p of geo.passes) {
    const m = ranges.get(p.range);
    if (m === undefined) { problems.push(`pass ${p.name}: no range ${p.range}`); continue; }
    if (distanceToLine(m.points, p.at[0] + 0.5, p.at[1] + 0.5) > m.width / 2) problems.push(`pass ${p.name} is not on the crest of ${p.range}`);
    if (!tileOnLand(geo, p.at[0], p.at[1])) problems.push(`pass ${p.name} is off the land`);
  }
  const onRidge = (x: number, z: number, room: number) => geo.mountains.find((m) => distanceToLine(m.points, x, z) < m.width / 2 + room);

  // Areas and regions.
  for (const a of geo.areas) {
    polygon(`area ${a.id}`, a.points, 0);
    if (!(GEO_BIOMES as readonly string[]).includes(a.biome)) problems.push(`area ${a.id}: biome ${a.biome} is unknown`);
    if (a.landmass !== undefined && !geo.landmasses.some((l) => l.id === a.landmass)) problems.push(`area ${a.id}: no landmass ${a.landmass}`);
  }
  const regions = new Map(geo.regions.map((r) => [r.id, r]));
  for (const r of geo.regions) {
    if (!(GEO_BIOMES as readonly string[]).includes(r.biome)) problems.push(`region ${r.id}: biome ${r.biome} is unknown`);
    if (!(STYLES as readonly string[]).includes(r.style)) problems.push(`region ${r.id}: style ${r.style} is unknown`);
    if (r.areas?.length !== 4) problems.push(`region ${r.id}: should name four bands of tier`);
    if (r.seeds.length === 0) problems.push(`region ${r.id}: no seeds`);
    for (const [x, z] of r.seeds) if (!tileOnLand(geo, x, z)) problems.push(`region ${r.id}: seed [${x}, ${z}] is off the land`);
  }
  // The regions are the geography's alone (layout.json once had them): a dungeon's mobs are drawn by one of them.
  for (const d of layout.dungeons) if (d.region !== undefined && !regions.has(d.region)) problems.push(`dungeon ${d.id} of layout.json: its mobs' region ${d.region} is none of the geography's`);

  // Places.
  const square = (at: XZ, half: number) => {
    const out: XZ[] = [];
    for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) out.push([at[0] + dx, at[1] + dz]);
    return out;
  };
  const where = (what: string, at: XZ, half: number, landmass: string | undefined, region: string | undefined) => {
    if (!at.every(Number.isInteger)) problems.push(`${what}: [${at.join(", ")}] is not a whole tile`);
    const [cx, cz] = [at[0] + 0.5, at[1] + 0.5];
    if (square(at, half).some(([x, z]) => !tileOnLand(geo, x, z))) problems.push(`${what}: its ${2 * half + 1}x${2 * half + 1} square at [${at.join(", ")}] is not all dry land`);
    const ridge = onRidge(cx, cz, half - 1);
    if (ridge) problems.push(`${what} stands in the peaks of ${ridge.id}`);
    const land = landmassAt(geo, cx, cz);
    if (landmass !== undefined && land?.id !== landmass) problems.push(`${what} is on ${land?.id ?? "the sea"}, not ${landmass}`);
    const reg = regionAt(geo, cx, cz);
    if (region !== undefined && reg?.id !== region) problems.push(`${what} is in ${reg?.id ?? "no region"}, not ${region}`);
    if (region !== undefined && !regions.has(region)) problems.push(`${what}: no region ${region}`);
  };
  const towns = new Map(layout.towns.map((t) => [t.id, t]));
  for (const id of towns.keys()) if (geo.towns[id] === undefined) problems.push(`town ${id} of layout.json has no place`);
  for (const [id, t] of Object.entries(geo.towns)) {
    const lt = towns.get(id);
    if (lt === undefined) { problems.push(`town ${id} is not layout.json's`); continue; }
    const half = (iconSize(lt.kind) - 1) / 2;
    where(`town ${id}`, t.at, half + 1, t.landmass, t.region);
    const [cx, cz] = [t.at[0] + 0.5, t.at[1] + 0.5];
    for (const side of t.sea ?? []) {
      if (!SIDES.includes(side)) { problems.push(`town ${id}: sea side ${side} is unknown`); continue; }
      const [dx, dz] = STEP[side];
      let found = false;
      for (let k = half + 1; k <= half + 12 && !found; k++) found = [-half, 0, half].some((o) => landmassAt(geo, cx + dx * k + dz * o, cz + dz * k + dx * o) === undefined);
      if (!found) problems.push(`town ${id}: no sea within 12 tiles to the ${side}`);
    }
    const riverNear = (d: number) => geo.rivers.find((r) => distanceToLine(r.points, cx, cz) <= d);
    if (t.river === "through") {
      if (!riverNear(half + 0.5)) problems.push(`town ${id}: no river runs through it`);
    } else {
      const through = geo.rivers.find((r) => distanceToLine(r.points, cx, cz) < half + 1.5 + r.width / 2);
      if (through) problems.push(`town ${id}: river ${through.id} runs through its icon`);
      if (t.river !== undefined) {
        const [dx, dz] = STEP[t.river];
        const side = geo.rivers.some((r) => distanceToLine(r.points, cx, cz) <= half + 10 && r.points.some((_, k) => {
          const [px, pz] = nth(r.points, k);
          return (px - cx) * dx + (pz - cz) * dz > 0;
        }));
        if (!side) problems.push(`town ${id}: no river within 10 tiles to the ${t.river}`);
      }
    }
    if (t.relief !== undefined && !(t.relief >= 0 && t.relief <= 1)) problems.push(`town ${id}: relief ${t.relief} should be 0 to 1`);
  }
  const dungeonIds = new Set(layout.dungeons.map((d) => d.id));
  for (const id of dungeonIds) if (geo.dungeons[id] === undefined) problems.push(`dungeon ${id} of layout.json has no place`);
  for (const [id, d] of Object.entries(geo.dungeons)) {
    if (!dungeonIds.has(id)) { problems.push(`dungeon ${id} is not layout.json's`); continue; }
    where(`dungeon ${id}`, d.at, 2, d.landmass, d.region);
  }
  for (const l of geo.landmarks) {
    if (!(LANDMARK_KINDS as readonly string[]).includes(l.kind)) problems.push(`landmark ${l.id}: kind ${l.kind} is unknown`);
    where(`landmark ${l.id}`, l.at, 2, undefined, l.region);
  }
  // Nothing stands on anything else: icons, entrances and landmarks a tile apart at least.
  const spots: [string, XZ, number][] = [
    ...Object.entries(geo.towns).map(([id, t]): [string, XZ, number] => [`town ${id}`, t.at, (iconSize(towns.get(id)?.kind ?? "village") - 1) / 2]),
    ...Object.entries(geo.dungeons).map(([id, d]): [string, XZ, number] => [`dungeon ${id}`, d.at, 2]),
    ...geo.landmarks.map((l): [string, XZ, number] => [`landmark ${l.id}`, l.at, 1]),
  ];
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const [a, pa, ha] = nth(spots, i);
      const [b, pb, hb] = nth(spots, j);
      if (Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1])) <= ha + hb + 1) problems.push(`${a} and ${b} stand on each other`);
    }
  }

  // Ferries.
  for (const id of ["keldon-ferry", "verdura-ferry", "shanodin-ferry", "stahaan-ferry"]) if (!geo.ferries.some((f) => f.id === id)) problems.push(`ferry ${id} of layout.json is missing`);
  for (const f of geo.ferries) {
    for (const end of [f.from, f.to]) {
      if (!tileOnLand(geo, end[0], end[1])) problems.push(`ferry ${f.id}: its dock [${end.join(", ")}] is not on land`);
      const land = landmassAt(geo, end[0] + 0.5, end[1] + 0.5);
      if (land && distanceToLine(land.points, end[0] + 0.5, end[1] + 0.5, true) > 3) problems.push(`ferry ${f.id}: its dock [${end.join(", ")}] is more than 3 tiles from the shore`);
    }
    const [ax, az] = [f.from[0] + 0.5, f.from[1] + 0.5];
    const [bx, bz] = [f.to[0] + 0.5, f.to[1] + 0.5];
    const len = Math.hypot(bx - ax, bz - az);
    for (let s = 4; s <= len - 4; s += 0.5) {
      const [x, z] = [ax + ((bx - ax) * s) / len, az + ((bz - az) * s) / len];
      if (landmassAt(geo, x, z) !== undefined) { problems.push(`ferry ${f.id}: its lane crosses land at [${x.toFixed(1)}, ${z.toFixed(1)}]`); break; }
    }
  }

  // Roads.
  const passes = new Map(geo.passes.map((p) => [p.name, p]));
  const links = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };
  for (const r of geo.roads) {
    const a = placeOf(geo, r.from);
    const b = placeOf(geo, r.to);
    if (a === undefined) problems.push(`a road joins nothing called ${r.from}`);
    if (b === undefined) problems.push(`a road joins nothing called ${r.to}`);
    for (const v of r.via ?? []) if (!passes.has(v)) problems.push(`road ${r.from} - ${r.to}: no pass ${v}`);
    if (a && b) {
      const la = landmassAt(geo, a[0] + 0.5, a[1] + 0.5)?.id;
      const lb = landmassAt(geo, b[0] + 0.5, b[1] + 0.5)?.id;
      if (la !== lb) problems.push(`road ${r.from} - ${r.to} joins two landmasses (${la} and ${lb}): that is a ferry's work`);
      link(r.from, r.to);
    }
  }
  for (const f of geo.ferries) link(`ferry:${f.id}:from`, `ferry:${f.id}:to`);
  const reached = new Set(["new-benalia"]);
  const queue = ["new-benalia"];
  while (queue.length > 0) for (const next of links.get(queue.pop() ?? "") ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  for (const id of Object.keys(geo.towns)) if (!reached.has(id)) problems.push(`no road or ferry reaches town ${id} from new-benalia`);
  for (const end of links.keys()) if (!reached.has(end)) problems.push(`${end} is on a road that does not reach new-benalia`);
  for (const f of geo.ferries) for (const side of ["from", "to"]) if (!links.has(`ferry:${f.id}:${side}`) || links.get(`ferry:${f.id}:${side}`)?.length === 1) problems.push(`ferry ${f.id}'s ${side} dock has no road`);
  // A place off the roads is walked to over the land: it must be on a landmass the roads and ferries reach.
  const served = new Set<string | undefined>([...reached].map((end) => {
    const at = placeOf(geo, end);
    return at && landmassAt(geo, at[0] + 0.5, at[1] + 0.5)?.id;
  }));
  for (const [id, d] of Object.entries(geo.dungeons)) if (!served.has(d.landmass)) problems.push(`dungeon ${id} is on ${d.landmass}, which no road or ferry reaches`);
  for (const l of geo.landmarks) if (!served.has(landmassAt(geo, l.at[0] + 0.5, l.at[1] + 0.5)?.id)) problems.push(`landmark ${l.id} is on a landmass no road or ferry reaches`);

  // Labels.
  for (const l of geo.labels) {
    if (!["land", "region", "feature", "sea"].includes(l.kind)) problems.push(`label ${l.name}: kind ${l.kind} is unknown`);
    if (!(l.x >= 0 && l.z >= 0 && l.x <= W && l.z <= H)) problems.push(`label ${l.name} is off the map`);
  }
  return problems;
}
