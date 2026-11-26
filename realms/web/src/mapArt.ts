import { type WorldData, travelRect } from "./world/format";
import { type DecodedOverview, type OverviewPeak, decodeOverview } from "./world/overview";

// The regional map's land (tech.md B5, "The tier zones are shown"): the travel map drawn as an atlas from the world's
// overview (world/overview.ts) - the coast smoothed and outlined over shallows and the sea's depth lines, the land by
// biome in the map's own palette with the relief shaded from the levels (a light from the north-west), the woods as
// miniature trees, the ranges as rows of peaks (snow-capped where the range is), the rivers and lakes, the roads (main
// ones bolder) and the ferries' lanes dashed over the sea; each tier's zone bordered where the tier changes, washed
// faintly or, with `tiers`, strongly. Drawn at any scale, `k` pixels a tile, in squares of `TILE` pixels kept once drawn,
// so a view of it is a few images copied (`draw`). DOM canvases, no three.

/** The side of a square of the map drawn and kept, pixels. */
const TILE = 256;
/** How many squares are kept, every scale together. */
const KEPT = 160;

type RGB = readonly [number, number, number];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** The ground's kinds as the map paints them: an atlas's, not the surfaces' own. */
const enum Ground {
  Grass,
  Meadow,
  Fields,
  Forest,
  Jungle,
  Swamp,
  Bog,
  Highland,
  Tundra,
  Snow,
  Ice,
  Rock,
  Scree,
  Sand,
  Desert,
  DryEarth,
  Badlands,
  Ash,
  Blight,
  Lava,
  Dirt,
  Town,
  Water,
}

const GROUND_COLORS: readonly RGB[] = [
  "#8aa35a", // grass: plains
  "#9fb565", // meadow
  "#c4ad68", // fields: wheat, straw, furrows
  "#5c7d3c", // forest floor
  "#4a7436", // jungle floor
  "#6c7349", // swamp: moss, mud
  "#46594b", // bog: the swamp's water
  "#9e9667", // highland
  "#b1b59d", // tundra
  "#e8ecf0", // snow
  "#cde1ec", // ice: glaciers
  "#958c80", // rock
  "#a89f90", // scree
  "#dfcd99", // sand: beaches
  "#dbb874", // desert: dunes
  "#bea179", // dry earth: cracked earth
  "#b26a47", // badlands
  "#6e6a72", // ash: wastes
  "#4b3b54", // blight: Phyrexian ground
  "#d2521e", // lava
  "#a88b5d", // dirt
  "#b7ad9b", // town: paving
  "#24507a", // water (unused: the sea is painted by depth)
].map(hex);

/** Each surface (and the first version's letters) as the map's ground. */
const GROUND_OF: Readonly<Record<string, Ground>> = {
  grass: Ground.Grass,
  meadow: Ground.Meadow,
  wheat: Ground.Fields,
  straw: Ground.Fields,
  furrows: Ground.Fields,
  "forest-floor": Ground.Forest,
  "jungle-floor": Ground.Jungle,
  moss: Ground.Swamp,
  mud: Ground.Swamp,
  bog: Ground.Bog,
  highland: Ground.Highland,
  tundra: Ground.Tundra,
  snow: Ground.Snow,
  ice: Ground.Ice,
  rock: Ground.Rock,
  scree: Ground.Scree,
  sand: Ground.Sand,
  dunes: Ground.Desert,
  "cracked-earth": Ground.DryEarth,
  badlands: Ground.Badlands,
  ash: Ground.Ash,
  "phyrexian-ground": Ground.Blight,
  lava: Ground.Lava,
  dirt: Ground.Dirt,
  road: Ground.Dirt,
  cobbles: Ground.Town,
  flagstones: Ground.Town,
  planks: Ground.Town,
  floorboards: Ground.Town,
  hearthstone: Ground.Town,
  town: Ground.Town,
  peaks: Ground.Rock,
  woods: Ground.Forest,
  stream: Ground.Grass,
};

/** The groves' kinds (the `grove` prop's), and how each one's miniature trees look from above: canopy lit and in shade. */
const GROVES = ["broadleaf", "pine", "snowpine", "swamp", "dead", "palm", "jungle", "elfwood"] as const;
const GROVE_COLORS: readonly (readonly [RGB, RGB])[] = [
  ["#4f8034", "#2a4d21"],
  ["#3e6a3a", "#1d3b25"],
  ["#4d6e5c", "#243a31"],
  ["#5a6439", "#313920"],
  ["#7d6a52", "#4a3d30"],
  ["#71a03c", "#3e6424"],
  ["#3f7c30", "#1b461b"],
  ["#63a03c", "#2d5a21"],
].map(([a, b]) => [hex(a!), hex(b!)] as const);
/** Grove kinds drawn as a pine's cone, not a round canopy. */
const CONIFER = new Set([1, 2]);
/** The ground under a grove when no neighbour says (the grove's own kind's). */
const GROVE_GROUND: readonly Ground[] = [Ground.Forest, Ground.Forest, Ground.Snow, Ground.Swamp, Ground.Ash, Ground.Sand, Ground.Jungle, Ground.Forest];

/** The peaks' kinds: their stone lit and in shade, and whether they are capped with snow. */
const PEAK_LOOK: Readonly<Record<string, { lit: string; shade: string; cap: boolean }>> = {
  rock: { lit: "#cbc1b0", shade: "#675e54", cap: false },
  snow: { lit: "#c4bcb0", shade: "#655f58", cap: true },
  ice: { lit: "#d8ecf4", shade: "#8fb2c4", cap: true },
  ash: { lit: "#7a7480", shade: "#3c3842", cap: false },
  sandstone: { lit: "#dab47c", shade: "#9a7248", cap: false },
  redrock: { lit: "#c86e4a", shade: "#7c3a26", cap: false },
};

const SEA_DEEP = hex("#18344f");
const SEA_MID = hex("#1f4569");
const SEA_SHALLOW = hex("#2d6890");
const LAKE = hex("#3c79a8");
const FOAM = hex("#7fb2cf");
const OUTLINE = hex("#2a241a");
const RIVER = "#3f86c0";
/** The tiers' colors, 0 (none) to 4 (hud.ts's TIER_COLORS). */
const TIER_RGB = ["#979cab", "#1fbf62", "#ffc94a", "#f58a3a", "#e02a3a"].map(hex);

/** A road as the map draws it: its line, smoothed, and whether it is a main road (between towns, docks included). */
interface MapRoad {
  readonly points: readonly (readonly [number, number])[];
  readonly main: boolean;
  readonly box: readonly [number, number, number, number];
}

/** A number for a tile, the same each time: the map's mottling and its trees' places. */
function hash(x: number, z: number, salt = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(salt, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Chamfer distances (1, 1.4) from every tile to the nearest `seed` tile: two passes. */
function distances(w: number, h: number, seed: (i: number) => boolean): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = seed(i) ? 0 : 1e6;
  const D = 1.41421;
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 1);
      if (z > 0) {
        v = Math.min(v, d[i - w]! + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + D);
      }
      d[i] = v;
    }
  for (let z = h - 1; z >= 0; z--)
    for (let x = w - 1; x >= 0; x--) {
      const i = z * w + x;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + 1);
      if (z < h - 1) {
        v = Math.min(v, d[i + w]! + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + D);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + D);
      }
      d[i] = v;
    }
  return d;
}

/** A box blur of a field, `r` tiles each way, along x then z. */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let z = 0; z < h; z++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[z * w + Math.max(0, Math.min(w - 1, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[z * w + x] = sum / (2 * r + 1);
      sum += src[z * w + Math.min(w - 1, x + r + 1)]! - src[z * w + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let z = -r; z <= r; z++) sum += tmp[Math.max(0, Math.min(h - 1, z)) * w + x]!;
    for (let z = 0; z < h; z++) {
      out[z * w + x] = sum / (2 * r + 1);
      sum += tmp[Math.min(h - 1, z + r + 1) * w + x]! - tmp[Math.max(0, z - r) * w + x]!;
    }
  }
  return out;
}

/** A line smoothed: each point the mean of those `r` either side of it along the line, the ends kept. */
function smooth(points: readonly (readonly [number, number])[], r: number): [number, number][] {
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return [p[0], p[1]];
    const a = Math.max(0, i - r);
    const b = Math.min(points.length - 1, i + r);
    let x = 0;
    let z = 0;
    for (let j = a; j <= b; j++) {
      x += points[j]![0];
      z += points[j]![1];
    }
    return [x / (b - a + 1), z / (b - a + 1)];
  });
}

const boxOf = (points: readonly (readonly [number, number])[]): [number, number, number, number] => {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of points) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
};

/** A zone of one tier, as the map numbers it: its tier, how many zone cells it spans, and the tile it is numbered at. */
export interface ZoneBadge {
  readonly tier: number;
  readonly cells: number;
  readonly x: number;
  readonly z: number;
  readonly name: string;
}

export class MapArt {
  /** The travel map's size and its north-west tile in the world. */
  readonly width: number;
  readonly depth: number;
  readonly x0: number;
  readonly z0: number;
  /** Tiles of land of each tier drawn (0 to 4). */
  readonly drawn = [0, 0, 0, 0, 0];
  /** The land's bounds, tiles from the map's corner. */
  readonly landBox: readonly [number, number, number, number];
  /** Each zone of one tier, numbered on the map. */
  readonly badges: readonly ZoneBadge[];
  private readonly ground: Uint8Array;
  private readonly grove: Uint8Array;
  /** 1 on a river's tile. */
  private readonly river: Uint8Array;
  /** Tiles from the coast: + on land (to the nearest water), - on water (to the nearest land). */
  private readonly sdf: Float32Array;
  /** 1 where the water is a lake (cut off from the map's edge). */
  private readonly lake: Uint8Array;
  private readonly shade: Float32Array;
  private readonly height: Float32Array;
  private readonly tier: Int8Array;
  private readonly zoneTier: Int8Array;
  private readonly zoneCols: number;
  private readonly zoneRows: number;
  private readonly zoneCell: number;
  private readonly peaks: readonly OverviewPeak[];
  private readonly roads: readonly MapRoad[];
  private readonly lanes: readonly MapRoad[];
  private readonly rivers: readonly (readonly [number, number, number, number])[];
  private readonly kept = new Map<string, HTMLCanvasElement>();

  constructor(readonly world: WorldData) {
    const travel = travelRect(world);
    const [ox, oz] = world.origin ?? [0, 0];
    this.x0 = travel[0];
    this.z0 = travel[1];
    const W = (this.width = travel[2] - travel[0]);
    const H = (this.depth = travel[3] - travel[1]);
    const n = W * H;
    const view: DecodedOverview = decodeOverview(world.overview);
    // The overview starts at the world's origin; the travel map does too in a world of two scales.
    const sx = this.x0 - ox;
    const sz = this.z0 - oz;
    const codeAt = (x: number, z: number): number => {
      const c = Math.floor((x + sx) / view.cell);
      const r = Math.floor((z + sz) / view.cell);
      return c < 0 || r < 0 || c >= view.cols || r >= view.rows ? 255 : view.ground[r * view.cols + c]!;
    };
    const kinds = view.values.map((v) => {
      if (v === "sea" || v === "shallows") return { ground: Ground.Water, grove: 0, river: false };
      if (v === "woods") return { ground: Ground.Forest, grove: 1, river: false };
      if (v.startsWith("woods:")) {
        const g = GROVES.indexOf(v.slice(6) as (typeof GROVES)[number]);
        return { ground: 255 as Ground, grove: (g < 0 ? 0 : g) + 1, river: false };
      }
      return { ground: GROUND_OF[v] ?? Ground.Grass, grove: 0, river: v === "stream" };
    });
    this.ground = new Uint8Array(n);
    this.grove = new Uint8Array(n);
    const water = new Uint8Array(n);
    const river = (this.river = new Uint8Array(n));
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        const code = codeAt(x, z);
        const kind = kinds[code];
        if (!kind) {
          this.ground[i] = Ground.Water;
          water[i] = 1;
          continue;
        }
        this.ground[i] = kind.ground;
        this.grove[i] = kind.grove;
        if (kind.ground === Ground.Water) water[i] = 1;
        if (kind.river) river[i] = 1;
      }
    // A grove's ground: its neighbours' commonest, else its kind's.
    for (let i = 0; i < n; i++) {
      if (this.ground[i] !== 255) continue;
      const count = new Map<number, number>();
      const x = i % W;
      const z = (i - x) / W;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || z + dz < 0 || x + dx >= W || z + dz >= H) continue;
          const g = this.ground[i + dz * W + dx]!;
          if (g !== 255 && g !== Ground.Water) count.set(g, (count.get(g) ?? 0) + 1);
        }
      const best = [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      this.ground[i] = best ? best[0] : GROVE_GROUND[this.grove[i]! - 1]!;
    }
    // The coast as a field of distances, signed, and the lakes: water not joined to the map's edge.
    const toWater = distances(W, H, (i) => water[i] === 1);
    const toLand = distances(W, H, (i) => water[i] === 0);
    this.sdf = new Float32Array(n);
    for (let i = 0; i < n; i++) this.sdf[i] = water[i] ? -toLand[i]! : toWater[i]!;
    this.lake = new Uint8Array(n).fill(1);
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = i % W;
      const z = (i - x) / W;
      if (water[i] && (x === 0 || z === 0 || x === W - 1 || z === H - 1)) {
        this.lake[i] = 0;
        queue.push(i);
      }
    }
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= n || !water[j] || !this.lake[j]) continue;
        this.lake[j] = 0;
        queue.push(j);
      }
    }
    for (let i = 0; i < n; i++) if (!water[i]) this.lake[i] = 0;
    // The relief: the levels blurred, lit from the north-west.
    const level = new Float32Array(n);
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const c = Math.floor((x + sx) / view.cell);
        const r = Math.floor((z + sz) / view.cell);
        level[z * W + x] = view.levels && c < view.cols && r < view.rows ? view.levels[r * view.cols + c]! : 0;
      }
    this.height = blur(blur(level, W, H, 2), W, H, 1);
    this.shade = new Float32Array(n);
    const lx = -0.55;
    const lz = -0.55;
    const ly = 0.63;
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        const gx = (this.height[z * W + Math.min(W - 1, x + 1)]! - this.height[z * W + Math.max(0, x - 1)]!) * 0.9;
        const gz = (this.height[Math.min(H - 1, z + 1) * W + x]! - this.height[Math.max(0, z - 1) * W + x]!) * 0.9;
        const len = Math.hypot(gx, gz, 1);
        this.shade[i] = ((-gx * lx - gz * lz + ly) / len - ly) / 0.6;
      }
    // The tier zones, tile by tile (tierAt), and by zone cell for the borders.
    const zones = world.zones;
    this.zoneCell = zones.cell;
    this.zoneCols = zones.cols;
    this.zoneRows = zones.rows;
    this.zoneTier = new Int8Array(zones.cols * zones.rows);
    for (let r = 0; r < zones.rows; r++) for (let c = 0; c < zones.cols; c++) this.zoneTier[r * zones.cols + c] = zones.areas[zones.grid[r]?.[c] ?? -1]?.tier ?? 0;
    this.tier = new Int8Array(n);
    let bx0 = W;
    let bz0 = H;
    let bx1 = 0;
    let bz1 = 0;
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        const t = this.zoneTierAt(x, z);
        this.tier[i] = t;
        if (water[i]) continue;
        if (t > 0) this.drawn[t]!++;
        bx0 = Math.min(bx0, x);
        bz0 = Math.min(bz0, z);
        bx1 = Math.max(bx1, x + 1);
        bz1 = Math.max(bz1, z + 1);
      }
    this.landBox = bx0 < bx1 ? [bx0, bz0, bx1, bz1] : [0, 0, W, H];
    this.badges = this.findBadges(water);
    this.peaks = view.peaks.map(([x, z, w, k]) => [x - this.x0, z - this.z0, w, k] as const).sort((a, b) => a[1] + a[2] / 2 - (b[1] + b[2] / 2) || a[0] - b[0]);
    // The roads: a main road joins towns (a dock's road leads on to one); the rest go to dungeons and towers.
    const towns = new Set(world.towns.map((t) => t.id));
    const placeish = (id: string) => towns.has(id) || id.startsWith("ferry:");
    this.roads = world.roads
      .filter((r) => r.tiles.length > 1)
      .map((r) => {
        const points = smooth(
          r.tiles.map(([x, z]) => [x - this.x0 + 0.5, z - this.z0 + 0.5] as const),
          2,
        );
        return { points, main: placeish(r.from) && placeish(r.to), box: boxOf(points) };
      });
    this.lanes = world.ferries.map((f) => {
      const points = smooth(
        f.lane.map(([x, z]) => [x - this.x0 + 0.5, z - this.z0 + 0.5] as const),
        3,
      );
      return { points, main: false, box: boxOf(points) };
    });
    // The rivers: a stroke from each river tile to each river or water tile beside it (a diagonal only where no
    // straight neighbour joins the two already).
    const rivers: [number, number, number, number][] = [];
    const wet = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && (river[z * W + x] === 1 || water[z * W + x] === 1);
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        if (!river[z * W + x]) continue;
        for (const [dx, dz] of [
          [1, 0],
          [0, 1],
          [1, 1],
          [-1, 1],
          [-1, 0],
          [0, -1],
          [1, -1],
          [-1, -1],
        ] as const) {
          if (!wet(x + dx, z + dz)) continue;
          const other = river[(z + dz) * W + x + dx] === 1;
          // Between two river tiles, each stroke once (from the one first in reading order).
          if (other && (dz < 0 || (dz === 0 && dx < 0))) continue;
          if (dx !== 0 && dz !== 0 && (wet(x + dx, z) || wet(x, z + dz))) continue;
          rivers.push([x + 0.5, z + 0.5, x + dx + 0.5, z + dz + 0.5]);
        }
      }
    this.rivers = rivers;
  }

  /** The tier of a zone cell's tile, by the travel map's tile. */
  private zoneTierAt(x: number, z: number): number {
    const [ox, oz] = this.world.origin ?? [0, 0];
    const c = Math.floor((x + this.x0 - ox) / this.zoneCell);
    const r = Math.floor((z + this.z0 - oz) / this.zoneCell);
    return c < 0 || r < 0 || c >= this.zoneCols || r >= this.zoneRows ? 0 : this.zoneTier[r * this.zoneCols + c]!;
  }

  /**
   * Each zone of one area as cells joined side to side that hold land, numbered at its cell deepest inside it (on
   * land), with the cells it spans: the map numbers the big ones from afar and the rest closer in.
   */
  private findBadges(water: Uint8Array): ZoneBadge[] {
    const zones = this.world.zones;
    const C = zones.cols;
    const R = zones.rows;
    const cell = zones.cell;
    const [ox, oz] = this.world.origin ?? [0, 0];
    const area = (c: number, r: number) => zones.grid[r]?.[c] ?? -1;
    const landIn = (c: number, r: number) => {
      let count = 0;
      for (let z = r * cell + oz - this.z0; z < (r + 1) * cell + oz - this.z0; z++)
        for (let x = c * cell + ox - this.x0; x < (c + 1) * cell + ox - this.x0; x++) if (x >= 0 && z >= 0 && x < this.width && z < this.depth && !water[z * this.width + x]) count++;
      return count;
    };
    const land = new Int32Array(C * R);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) land[r * C + c] = landIn(c, r);
    const seen = new Uint8Array(C * R);
    const out: ZoneBadge[] = [];
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        const a = area(c, r);
        const t = zones.areas[a]?.tier ?? 0;
        if (seen[r * C + c] || t <= 0 || land[r * C + c]! < cell * 2) continue;
        // The zone: the cells of the same area joined to this one that have land.
        const cells: number[] = [];
        const stack = [r * C + c];
        seen[r * C + c] = 1;
        while (stack.length) {
          const k = stack.pop()!;
          cells.push(k);
          const kc = k % C;
          const kr = (k - kc) / C;
          for (const [dc, dr] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const nc = kc + dc;
            const nr = kr + dr;
            if (nc < 0 || nr < 0 || nc >= C || nr >= R) continue;
            const j = nr * C + nc;
            if (seen[j] || area(nc, nr) !== a || land[j]! < cell * 2) continue;
            seen[j] = 1;
            stack.push(j);
          }
        }
        // Its deepest cell: the furthest (in cells) from any cell outside it, the most land breaking ties.
        const inside = new Set(cells);
        let best = cells[0]!;
        let bestScore = -1;
        for (const k of cells) {
          const kc = k % C;
          const kr = (k - kc) / C;
          let depth = 0;
          for (let d = 1; d < 8; d++) {
            let all = true;
            for (let dr = -d; dr <= d && all; dr++) for (let dc = -d; dc <= d && all; dc++) if (Math.max(Math.abs(dc), Math.abs(dr)) === d && !inside.has((kr + dr) * C + kc + dc)) all = false;
            if (!all) break;
            depth = d;
          }
          const score = depth * 1000 + land[k]!;
          if (score > bestScore) {
            bestScore = score;
            best = k;
          }
        }
        const bc = best % C;
        const br = (best - bc) / C;
        out.push({ tier: t, cells: cells.length, x: bc * cell + ox + cell / 2, z: br * cell + oz + cell / 2, name: zones.areas[a]!.name });
      }
    return out;
  }

  /** The tier the map shows at a world tile (0 off the travel map, or in a zone of none). */
  tierAt(x: number, z: number): number {
    const tx = Math.floor(x) - this.x0;
    const tz = Math.floor(z) - this.z0;
    return tx < 0 || tz < 0 || tx >= this.width || tz >= this.depth ? 0 : this.tier[tz * this.width + tx]!;
  }

  /** Whether a world tile is land on the map. */
  isLand(x: number, z: number): boolean {
    const tx = Math.floor(x) - this.x0;
    const tz = Math.floor(z) - this.z0;
    return tx >= 0 && tz >= 0 && tx < this.width && tz < this.depth && this.sdf[tz * this.width + tx]! > 0;
  }

  /**
   * Copies the land at `k` pixels a tile onto `g`: the map's pixels from (`left`, `top`), `w` by `h`, at (`dx`, `dy`).
   * Squares not drawn yet are drawn while `budget` milliseconds last, the rest stood in for by the map at a pixel a tile;
   * false when any was.
   */
  draw(g: CanvasRenderingContext2D, k: number, tiers: boolean, left: number, top: number, w: number, h: number, dx = 0, dy = 0, budget = Infinity): boolean {
    const started = performance.now();
    let whole = true;
    g.imageSmoothingEnabled = false;
    const tx0 = Math.floor(left / TILE);
    const ty0 = Math.floor(top / TILE);
    const tx1 = Math.floor((left + w - 1) / TILE);
    const ty1 = Math.floor((top + h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${k.toFixed(4)}|${tiers ? 1 : 0}|${tx}|${ty}`;
        let square = this.kept.get(key);
        if (!square && performance.now() - started < budget) square = this.render(k, tiers, tx * TILE, ty * TILE, key);
        if (square) {
          g.drawImage(square, dx + tx * TILE - left, dy + ty * TILE - top);
          continue;
        }
        whole = false;
        // The map at a pixel a tile, scaled, while this square waits.
        const small = this.small(tiers);
        const sx = (tx * TILE) / k;
        const sy = (ty * TILE) / k;
        g.drawImage(small, sx, sy, TILE / k, TILE / k, dx + tx * TILE - left, dy + ty * TILE - top, TILE, TILE);
      }
    return whole;
  }

  /** The whole map at a pixel a tile: what a square not yet drawn shows meanwhile. */
  private small(tiers: boolean): HTMLCanvasElement {
    const key = `small|${tiers ? 1 : 0}`;
    let c = this.kept.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.depth;
    const g = c.getContext("2d")!;
    for (let y = 0; y < this.depth; y += TILE) for (let x = 0; x < this.width; x += TILE) g.drawImage(this.paint(1, tiers, x, y, Math.min(TILE, this.width - x), Math.min(TILE, this.depth - y)), x, y);
    this.kept.set(key, c);
    return c;
  }

  private render(k: number, tiers: boolean, left: number, top: number, key: string): HTMLCanvasElement {
    const c = this.paint(k, tiers, left, top, TILE, TILE);
    this.kept.set(key, c);
    if (this.kept.size > KEPT) {
      for (const old of this.kept.keys()) {
        if (old.startsWith("small|")) continue;
        this.kept.delete(old);
        break;
      }
    }
    return c;
  }

  /** The map's pixels from (`left`, `top`), `w` by `h`, at `k` pixels a tile: the land, then the lines and the peaks. */
  paint(k: number, tiers: boolean, left: number, top: number, w: number, h: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d")!;
    const image = g.createImageData(w, h);
    this.paintLand(image.data, k, tiers, left, top, w, h);
    g.putImageData(image, 0, 0);
    if (k >= 3) this.paintTrees(g, k, left, top, w, h);
    this.paintLines(g, k, left, top, w, h);
    this.paintPeaks(g, k, left, top, w, h);
    return canvas;
  }

  /**
   * The tree on a tile, if any, as a grove kind + 1: a grove's own; most of a forest's or a jungle's tiles and some of a
   * swamp's have one too, so a wood reads as a wood.
   */
  private treeAt(i: number, x: number, z: number): number {
    const g = this.grove[i]!;
    if (g) return g;
    if (this.sdf[i]! <= 0) return 0;
    const n = this.ground[i]!;
    const h = hash(x, z, 13);
    return n === Ground.Forest && h < 0.55 ? 1 : n === Ground.Jungle && h < 0.6 ? 7 : n === Ground.Swamp && h < 0.18 ? 4 : 0;
  }

  private readonly sprites = new Map<string, HTMLCanvasElement>();

  /**
   * A tree as a sprite `d` pixels across, pixel by pixel: a round canopy (a cone for the pines) lit to the north-west,
   * dark to the south-east with a dark rim there, and its shadow cast a pixel south-east.
   */
  private treeSprite(kind: number, d: number): HTMLCanvasElement {
    const key = `${kind}:${d}`;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = d + 2;
    c.height = d + 2;
    const g = c.getContext("2d")!;
    const image = g.createImageData(d + 2, d + 2);
    const [lit, dark] = GROVE_COLORS[kind - 1]!;
    const hi: RGB = [Math.min(255, lit[0] * 1.18), Math.min(255, lit[1] * 1.18), Math.min(255, lit[2] * 1.12)];
    const rim: RGB = [dark[0] * 0.6, dark[1] * 0.6, dark[2] * 0.6];
    const conifer = CONIFER.has(kind - 1);
    const r = d / 2;
    const inside = (i: number, j: number) => {
      if (i < 0 || j < 0 || i >= d || j >= d) return false;
      const x = i + 0.5 - r;
      const y = j + 0.5 - r;
      return conifer ? Math.abs(x) <= ((j + 1) / d) * r + 0.01 : x * x + y * y <= r * r + 0.3;
    };
    const set = (i: number, j: number, col: RGB, a = 255) => {
      const o = (j * (d + 2) + i) * 4;
      image.data[o] = col[0];
      image.data[o + 1] = col[1];
      image.data[o + 2] = col[2];
      image.data[o + 3] = a;
    };
    // The shadow first, under the tree.
    for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) if (inside(i, j)) set(i + 1, j + 1, [12, 18, 10], 90);
    for (let j = 0; j < d; j++)
      for (let i = 0; i < d; i++) {
        if (!inside(i, j)) continue;
        const x = i + 0.5 - r;
        const y = j + 0.5 - r;
        let col: RGB = conifer ? (x < 0 ? lit : dark) : x + y < -r * 0.5 ? hi : x + y < r * 0.2 ? lit : dark;
        if (!inside(i + 1, j) || !inside(i, j + 1)) col = conifer && x < 0 ? dark : rim;
        // Snow on a snow pine's tip.
        if (kind === 3 && j < Math.max(1, Math.round(d * 0.3))) col = x < 0 ? [236, 240, 242] : [190, 204, 212];
        set(i, j, col);
      }
    g.putImageData(image, 0, 0);
    this.sprites.set(key, c);
    return c;
  }

  /** Whether a tile lies on a zone's edge where the tier changes: kept clear of trees, so the border shows. */
  private onBorder(x: number, z: number): boolean {
    const t = this.tier[z * this.width + x]!;
    if (t <= 0) return false;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= this.width || nz >= this.depth) continue;
      const o = this.tier[nz * this.width + nx]!;
      if (o > 0 && o !== t) return true;
    }
    return false;
  }

  /** The woods close in: a tree sprite on each tree's tile, a little off its middle, the north's first. */
  private paintTrees(g: CanvasRenderingContext2D, k: number, left: number, top: number, w: number, h: number): void {
    const W = this.width;
    const d = Math.round(Math.min(10, Math.max(4, 1.05 * k)));
    const x0 = Math.max(0, Math.floor(left / k) - 2);
    const z0 = Math.max(0, Math.floor(top / k) - 2);
    const x1 = Math.min(W - 1, Math.ceil((left + w) / k) + 1);
    const z1 = Math.min(this.depth - 1, Math.ceil((top + h) / k) + 1);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const kind = this.treeAt(z * W + x, x, z);
        if (!kind || this.onBorder(x, z)) continue;
        const size = kind === 8 ? d + 2 : d;
        const jx = (hash(x, z, 3) - 0.5) * 0.3;
        const jz = (hash(x, z, 5) - 0.5) * 0.3;
        const px = Math.round((x + 0.5 + jx) * k - size / 2) - left;
        const py = Math.round((z + 0.5 + jz) * k - size / 2) - top;
        g.drawImage(this.treeSprite(kind, size), px, py);
      }
  }

  private paintLand(out: Uint8ClampedArray, k: number, tiers: boolean, left: number, top: number, w: number, h: number): void {
    const W = this.width;
    const H = this.depth;
    const sdf = this.sdf;
    const shade = this.shade;
    const height = this.height;
    const ground = this.ground;
    const tier = this.tier;
    const cell = this.zoneCell;
    const [ox, oz] = this.world.origin ?? [0, 0];
    const zx = this.x0 - ox;
    const zz = this.z0 - oz;
    // A pixel's worth of tiles: the outlines' and the depth lines' width.
    const px = 1 / k;
    const wash = tiers ? 0.42 : 0.03;
    const border = (k < 1.5 ? 1.3 : k < 3 ? 1.6 : 2) / k;
    const trees = k >= 3;
    const fine = k >= 4;
    const C = this.zoneCols;
    const Rr = this.zoneRows;
    const zt = this.zoneTier;
    const zoneAt = (c: number, r: number) => (c < 0 || r < 0 || c >= C || r >= Rr ? 0 : zt[r * C + c]!);
    for (let y = 0; y < h; y++) {
      const v = (top + y + 0.5) / k;
      const fv = v - 0.5;
      const j0r = Math.floor(fv);
      const ty = fv - j0r;
      const j0 = Math.max(0, Math.min(H - 1, j0r));
      const j1 = Math.max(0, Math.min(H - 1, j0r + 1));
      const jn = Math.max(0, Math.min(H - 1, Math.floor(v)));
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        out[o + 3] = 255;
        const u = (left + x + 0.5) / k;
        if (u >= W || v >= H || u < 0 || v < 0) {
          out[o] = SEA_DEEP[0];
          out[o + 1] = SEA_DEEP[1];
          out[o + 2] = SEA_DEEP[2];
          continue;
        }
        const fu = u - 0.5;
        const i0r = Math.floor(fu);
        const tx = fu - i0r;
        const i0 = Math.max(0, Math.min(W - 1, i0r));
        const i1 = Math.max(0, Math.min(W - 1, i0r + 1));
        const a = j0 * W + i0;
        const b = j0 * W + i1;
        const c = j1 * W + i0;
        const d = j1 * W + i1;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        const s = sdf[a]! * w00 + sdf[b]! * w10 + sdf[c]! * w01 + sdf[d]! * w11;
        const ni = jn * W + Math.max(0, Math.min(W - 1, Math.floor(u)));
        let r: number;
        let gr: number;
        let bl: number;
        if (s <= 0) {
          // Water: shallows by the coast darkening to the deep, a pale line at the shore, lines of depth off it.
          const depth = -s;
          if (this.lake[ni] === 1) {
            const t = Math.min(1, depth / 4);
            r = LAKE[0] * (1 - 0.25 * t);
            gr = LAKE[1] * (1 - 0.25 * t);
            bl = LAKE[2] * (1 - 0.18 * t);
          } else {
            const t1 = Math.min(1, depth / 2.2);
            const t2 = Math.min(1, Math.max(0, (depth - 3) / 12));
            r = SEA_SHALLOW[0] + (SEA_MID[0] - SEA_SHALLOW[0]) * t1 + (SEA_DEEP[0] - SEA_MID[0]) * t2;
            gr = SEA_SHALLOW[1] + (SEA_MID[1] - SEA_SHALLOW[1]) * t1 + (SEA_DEEP[1] - SEA_MID[1]) * t2;
            bl = SEA_SHALLOW[2] + (SEA_MID[2] - SEA_SHALLOW[2]) * t1 + (SEA_DEEP[2] - SEA_MID[2]) * t2;
            // The depth lines round the coasts.
            if (Math.abs(depth - 3.2) < px * 0.6 || Math.abs(depth - 6.4) < px * 0.6) {
              r += 9;
              gr += 14;
              bl += 17;
            }
          }
          if (depth < px * 0.9) {
            r = r * 0.45 + FOAM[0] * 0.55;
            gr = gr * 0.45 + FOAM[1] * 0.55;
            bl = bl * 0.45 + FOAM[2] * 0.55;
          }
        } else {
          // Land: its ground among the four tiles round the pixel, by weight (land only), so every edge is smooth.
          let g0 = ground[a]!;
          if (k > 1.5) {
            const ga = ground[a]!;
            const gb = ground[b]!;
            const gc = ground[c]!;
            const gd = ground[d]!;
            const wa = ga === Ground.Water ? 0 : w00;
            const wb = gb === Ground.Water ? 0 : w10;
            const wc = gc === Ground.Water ? 0 : w01;
            const wd = gd === Ground.Water ? 0 : w11;
            const sa = ga === Ground.Water ? -1 : wa + (gb === ga ? wb : 0) + (gc === ga ? wc : 0) + (gd === ga ? wd : 0);
            const sb = gb === Ground.Water ? -1 : wb + (gc === gb ? wc : 0) + (gd === gb ? wd : 0) + (ga === gb ? wa : 0);
            const sc = gc === Ground.Water ? -1 : wc + (gd === gc ? wd : 0) + (ga === gc ? wa : 0) + (gb === gc ? wb : 0);
            const sd = gd === Ground.Water ? -1 : wd + (ga === gd ? wa : 0) + (gb === gd ? wb : 0) + (gc === gd ? wc : 0);
            let best = sa;
            g0 = ga;
            if (sb > best) {
              best = sb;
              g0 = gb;
            }
            if (sc > best) {
              best = sc;
              g0 = gc;
            }
            if (sd > best) g0 = gd;
          } else g0 = ground[ni]!;
          if (g0 === Ground.Water) g0 = Ground.Sand;
          const base = GROUND_COLORS[g0]!;
          // The relief: lit from the north-west, and a touch lighter the higher it stands.
          const sh = shade[a]! * w00 + shade[b]! * w10 + shade[c]! * w01 + shade[d]! * w11;
          const ht = height[a]! * w00 + height[b]! * w10 + height[c]! * w01 + height[d]! * w11;
          const tileX = Math.floor(u);
          const tileZ = Math.floor(v);
          let f = 1 + Math.max(-0.5, Math.min(0.45, sh * 0.5)) + Math.min(0.12, ht * 0.012) + (hash(tileX, tileZ) - 0.5) * 0.07;
          if (fine) f += (hash(Math.floor(u * 4), Math.floor(v * 4), 7) - 0.5) * 0.05;
          r = base[0] * f;
          gr = base[1] * f;
          bl = base[2] * f;
          // The woods: a miniature tree on each grove's tile - and on most of a forest's or a jungle's, some of a
          // swamp's - lit to the north-west, its shadow to the south-east.
          // Far out, a tree is a fleck of its canopy's color on its tile; closer in, a sprite each (paintTrees).
          const gv = trees ? 0 : this.treeAt(ni, tileX, tileZ);
          if (gv) {
            const [lit, dark] = GROVE_COLORS[gv - 1]!;
            const t = 0.75;
            r = r * (1 - t) + (lit[0] * 0.55 + dark[0] * 0.45) * t;
            gr = gr * (1 - t) + (lit[1] * 0.55 + dark[1] * 0.45) * t;
            bl = bl * (1 - t) + (lit[2] * 0.55 + dark[2] * 0.45) * t;
          }
          // A river's tile: its water, under the river's line.
          if (this.river[ni] === 1) {
            r = 63;
            gr = 134;
            bl = 192;
          }
          // The tier: a wash of its color, and a border of it where the next zone's tier differs.
          const t = tier[ni]!;
          if (t > 0) {
            const tc = TIER_RGB[t]!;
            r = r * (1 - wash) + tc[0] * wash;
            gr = gr * (1 - wash) + tc[1] * wash;
            bl = bl * (1 - wash) + tc[2] * wash;
            const zu = (u + zx) / cell;
            const zv = (v + zz) / cell;
            const zc = Math.floor(zu);
            const zr = Math.floor(zv);
            const lu = (zu - zc) * cell;
            const lv = (zv - zr) * cell;
            const differs = (c2: number, r2: number) => {
              const o2 = zoneAt(c2, r2);
              return o2 > 0 && o2 !== t;
            };
            if ((lu < border && differs(zc - 1, zr)) || (cell - lu < border && differs(zc + 1, zr)) || (lv < border && differs(zc, zr - 1)) || (cell - lv < border && differs(zc, zr + 1))) {
              r = tc[0] * 0.85 + r * 0.15;
              gr = tc[1] * 0.85 + gr * 0.15;
              bl = tc[2] * 0.85 + bl * 0.15;
            }
          }
          // The coast's outline.
          if (s < px * 0.95) {
            r = r * 0.4 + OUTLINE[0] * 0.6;
            gr = gr * 0.4 + OUTLINE[1] * 0.6;
            bl = bl * 0.4 + OUTLINE[2] * 0.6;
          }
        }
        out[o] = r;
        out[o + 1] = gr;
        out[o + 2] = bl;
      }
    }
  }

  /** The rivers, the ferries' lanes and the roads, over the land. */
  private paintLines(g: CanvasRenderingContext2D, k: number, left: number, top: number, w: number, h: number): void {
    const x0 = left / k - 2;
    const z0 = top / k - 2;
    const x1 = (left + w) / k + 2;
    const z1 = (top + h) / k + 2;
    const over = (b: readonly [number, number, number, number]) => b[2] >= x0 && b[0] <= x1 && b[3] >= z0 && b[1] <= z1;
    g.save();
    g.translate(-left, -top);
    g.lineCap = "round";
    g.lineJoin = "round";
    // Rivers: a line the width of most of a tile, never thinner than a pixel.
    g.strokeStyle = RIVER;
    g.lineWidth = Math.max(1, 0.7 * k);
    g.beginPath();
    for (const [ax, az, bx, bz] of this.rivers) {
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) continue;
      g.moveTo(ax * k, az * k);
      g.lineTo(bx * k, bz * k);
    }
    g.stroke();
    const path = (points: readonly (readonly [number, number])[]) => {
      g.beginPath();
      points.forEach(([x, z], i) => (i === 0 ? g.moveTo(x * k, z * k) : g.lineTo(x * k, z * k)));
    };
    // The ferries' lanes: dashed over the sea.
    g.setLineDash([Math.max(3, 1.2 * k), Math.max(3, 1.2 * k)]);
    for (const lane of this.lanes) {
      if (!over(lane.box)) continue;
      path(lane.points);
      g.strokeStyle = "#0e223588";
      g.lineWidth = Math.max(2, 0.45 * k) + 1;
      g.stroke();
      g.strokeStyle = "#d8eef8";
      g.lineWidth = Math.max(1, 0.3 * k);
      g.stroke();
    }
    g.setLineDash([]);
    // The roads: the lesser ones a thin pale line, the main ones bolder with a dark edge.
    for (const road of this.roads) {
      if (road.main || !over(road.box)) continue;
      path(road.points);
      g.strokeStyle = "#2b221988";
      g.lineWidth = Math.max(1, 0.3 * k) + (k >= 2 ? 1.5 : 1);
      g.stroke();
      g.setLineDash(k >= 3 ? [1.6 * k, 0.9 * k] : []);
      g.strokeStyle = "#e3cf9c";
      g.lineWidth = Math.max(0.8, 0.3 * k);
      g.stroke();
      g.setLineDash([]);
    }
    for (const road of this.roads) {
      if (!road.main || !over(road.box)) continue;
      path(road.points);
      g.strokeStyle = "#2b2219";
      g.lineWidth = Math.max(1.3, 0.55 * k) + (k >= 2 ? 2 : 1.4);
      g.stroke();
      g.strokeStyle = "#f2dca4";
      g.lineWidth = Math.max(1.3, 0.55 * k);
      g.stroke();
    }
    g.restore();
  }

  /** The peak glyph's width at a scale, pixels. */
  private static glyphWidth(size: number, k: number): number {
    return Math.round(Math.max(size * k * 1.1, size >= 5 ? 9 : size >= 3 ? 7 : 5));
  }

  private readonly thinned = new Map<number, (readonly [number, number, number, string])[]>();

  /**
   * The peaks drawn at a scale: where two glyphs would stand nearly on each other, only the first (the bigger, or the
   * northern) - so each one of a range reads as a mountain, not a smear. The same at a scale whichever square is drawn.
   */
  private peaksAt(k: number): readonly (readonly [number, number, number, string])[] {
    const known = this.thinned.get(k);
    if (known) return known;
    const kept: (readonly [number, number, number, string])[] = [];
    const cell = new Map<string, (readonly [number, number, number])[]>();
    const bySize = [...this.peaks].sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
    for (const p of bySize) {
      const gw = MapArt.glyphWidth(p[2], k);
      const ax = (p[0] + 0.5) * k;
      const ay = (p[1] + 0.5 + p[2] / 2) * k;
      const reach = gw * 0.7;
      const cx = Math.floor(ax / 32);
      const cy = Math.floor(ay / 32);
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1 && !near; dx++)
          for (const [x, y, r] of cell.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(x - ax, y - ay) < Math.max(r, reach)) near = true;
      if (near) continue;
      kept.push(p);
      const key = `${cx},${cy}`;
      if (!cell.has(key)) cell.set(key, []);
      cell.get(key)!.push([ax, ay, reach]);
    }
    kept.sort((a, b) => a[1] + a[2] / 2 - (b[1] + b[2] / 2) || a[0] - b[0]);
    this.thinned.set(k, kept);
    return kept;
  }

  /** The ranges' peaks: a miniature mountain each, the south's over the north's, lit from the west. */
  private paintPeaks(g: CanvasRenderingContext2D, k: number, left: number, top: number, w: number, h: number): void {
    for (const [x, z, size, kind] of this.peaksAt(k)) {
      const gw = MapArt.glyphWidth(size, k);
      const gh = Math.round(gw * 0.8);
      const cx = Math.round((x + 0.5) * k) - left;
      const base = Math.round((z + 0.5 + size / 2) * k) - top;
      if (cx + gw < 0 || cx - gw > w || base < 0 || base - gh > h) continue;
      const look = PEAK_LOOK[kind] ?? PEAK_LOOK.rock!;
      const half = gw / 2;
      // A slight lean to each one, so a range is not a row of the same triangle.
      const lean = Math.round((hash(x, z, 11) - 0.5) * gw * 0.3);
      const ax = cx + lean;
      const ay = base - gh;
      // Its shadow on the ground to the south-east.
      g.fillStyle = "#0c0a0838";
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(cx + half + Math.round(gw * 0.25), base);
      g.lineTo(cx, base);
      g.closePath();
      g.fill();
      g.fillStyle = look.lit;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(cx - half, base);
      g.lineTo(cx + Math.round(gw * 0.08), base);
      g.closePath();
      g.fill();
      g.fillStyle = look.shade;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(cx + Math.round(gw * 0.08), base);
      g.lineTo(cx + half, base);
      g.closePath();
      g.fill();
      if (look.cap) {
        // The cap: the top two fifths, white in the light and pale blue-grey in the shade.
        const t = 0.36;
        const lx = ax + (cx - half - ax) * t;
        const rx = ax + (cx + half - ax) * t;
        const mx = ax + (cx + gw * 0.08 - ax) * t;
        const y = ay + gh * t;
        g.fillStyle = "#f4f6f8";
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(lx, y);
        g.lineTo(lx + (mx - lx) * 0.5, y - 1);
        g.lineTo(mx, y + 1);
        g.closePath();
        g.fill();
        g.fillStyle = "#b9c6d2";
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(mx, y + 1);
        g.lineTo(rx, y);
        g.closePath();
        g.fill();
      }
      if (k >= 1.4) {
        g.strokeStyle = "#221c16d0";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx - half + 0.5, base + 0.5);
        g.lineTo(ax + 0.5, ay + 0.5);
        g.lineTo(cx + half + 0.5, base + 0.5);
        g.stroke();
      }
    }
  }
}
