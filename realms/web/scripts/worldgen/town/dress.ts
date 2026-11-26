// What stands about a town besides its buildings: its wall (runs along its outline, towers at the corners and beside
// the gates, a gatehouse in each), its gardens behind hedges (or open ground among trees in an elfhame, bog under the
// stilts), the gardens and orchards inside its south wall, its landmarks (a citadel's bailey and keep, a hold's keep, a
// manor and its grounds), its square's furniture (the centrepiece, benches, lamps, stalls, the caravans' pitch), lights
// along its stages, the quest board by the inn, the arena, the harbour's piers and boats and the bridges over a river -
// and its people: guards pacing in from the gates, townsfolk about the square. Anything tall is stood only where what it
// hides from the camera falls on no street or door (view.ts), scattered by Poisson-disc sampling where it is scattered.

import type { NpcData, PropData, XZ } from "../../../src/world/format";
import { BARE, BLOCKED } from "../../../src/world/format";
import { tilesOf } from "../../../src/art/props";
import { S } from "../ids";
import { Use, texel } from "../land";
import { REGION_OF_STYLE } from "../rooms";
import { makeBuilding } from "./buildings";
import { poisson } from "./country";
import { formOf, groundsOf, sizesFor } from "./forms";
import type { Ctx } from "./index";
import type { Placed } from "./place";
import { propHides } from "./view";

/** The named palette a town's banners fly, by its style. */
const PALETTE_OF_STYLE: Readonly<Record<string, string>> = { benalish: "benalish", argive: "benalish", llanowar: "llanowar", urborg: "morass", keldon: "keldon", tolarian: "tolarian" };

const STREET_LIGHT: Readonly<Record<string, string | null>> ={ benalish: "lamp-post", tolarian: "lamp-post", keldon: "torch-post", urborg: "lantern-post", llanowar: null, argive: "lamp-post" };

export function dress(ctx: Ctx, placed: readonly Placed[]): void {
  sites(ctx);
  arena(ctx, placed);
  board(ctx, placed);
  square(ctx);
  lights(ctx, placed);
  yards(ctx);
  walls(ctx);
  water(ctx);
  people(ctx, placed);
}

// --- Helpers ---------------------------------------------------------------------------------------------------------

/** Whether a prop standing there hides no street, square or door from the camera looking north. */
function inSight(ctx: Ctx, p: PropData): boolean {
  for (const [x, z] of propHides(p, 0)) if (ctx.land.inside(x, z) && ctx.mustSee[ctx.land.idx(x, z)] === 1) return false;
  return true;
}

/** Stands a fixture, blocking (and closing) the tiles the catalogue says it covers. */
function stand(ctx: Ctx, p: PropData, use = Use.Kept): void {
  const { tiles, blocks } = tilesOf(p);
  for (const [x, z] of tiles) {
    if (!ctx.land.inside(x, z)) continue;
    const i = ctx.land.idx(x, z);
    if (blocks) {
      ctx.land.flags[i] = BLOCKED | BARE;
      ctx.land.use[i] = use;
      ctx.mustSee[i] = 0;
    }
  }
  ctx.land.fixtures.push(p);
}

/** Straight runs of a line prop along rows (then columns) over a set of tiles, cut at chunk edges. */
function runs(tiles: Iterable<number>, width: number, max = 12): [number, number, number, number][] {
  const set = new Set(tiles);
  const done = new Set<number>();
  const out: [number, number, number, number][] = [];
  const ordered = [...set].sort((a, b) => a - b);
  const xOf = (i: number) => i % width;
  const zOf = (i: number) => Math.floor(i / width);
  for (const [dx, dz] of [
    [1, 0],
    [0, 1],
  ] as const) {
    for (const i of ordered) {
      if (done.has(i)) continue;
      const x = xOf(i);
      const z = zOf(i);
      const prev = (z - dz) * width + (x - dx);
      if (set.has(prev) && !done.has(prev) && Math.floor((x - dx) / 32) === Math.floor(x / 32) && Math.floor((z - dz) / 32) === Math.floor(z / 32)) continue;
      let n = 1;
      while (n < max) {
        const nx = x + dx * n;
        const nz = z + dz * n;
        const j = nz * width + nx;
        if (!set.has(j) || done.has(j) || Math.floor(nx / 32) !== Math.floor(x / 32) || Math.floor(nz / 32) !== Math.floor(z / 32)) break;
        n++;
      }
      if (n < 2 && dx === 1) continue;
      for (let k = 0; k < n; k++) done.add((z + dz * k) * width + (x + dx * k));
      out.push([x, z, x + dx * (n - 1), z + dz * (n - 1)]);
    }
  }
  return out;
}

const walkable = (u: number) => u === Use.Street || u === Use.Kept || u === Use.Road || u === Use.Door || u === Use.Dock;

// --- Landmarks ------------------------------------------------------------------------------------------------------

function sites(ctx: Ctx): void {
  const { land, plan, town } = ctx;
  const random = ctx.random("sites");
  const style = town.style === "argive" ? "benalish" : town.style;
  for (const site of plan.sites) {
    // A temple's ground is its own lot: the temple stands on it like any building, its churchyard behind (yards).
    if (site.id.endsWith("-temple")) continue;
    const b = site.box;
    const fz = b.z1;
    const mid = Math.floor((b.x0 + b.x1) / 2);
    const bailey = site.id.endsWith("-citadel") || site.id.endsWith("-manor");
    const wallStyle = site.id.endsWith("-manor") ? "vess" : style;
    const yard = site.id.endsWith("-manor") ? S.grass : S.flagstones;
    for (let z = b.z0; z < b.z1; z++) for (let x = b.x0; x < b.x1; x++) {
      const i = land.idx(x, z);
      land.surface[i] = yard;
      land.use[i] = Use.Kept;
      land.flags[i] = 0;
    }
    const put = (id: string, kind: string, s: string, x: number, z: number, w: number, d: number, params: Record<string, unknown> = {}) => {
      const bd = makeBuilding(id, s, kind, { x, z, w, d, rot: 0, door: [x + Math.floor(w / 2), z + d] }, random, { storeys: 2, params, grand: kind === "house" });
      ctx.buildings.push(bd);
      for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
        const i = land.idx(xx, zz);
        land.use[i] = Use.Building;
        land.flags[i] = BLOCKED | BARE;
      }
    };
    if (bailey) {
      // The curtain wall round its ground, a gatehouse onto the street before it.
      const x0 = b.x0;
      const x1 = b.x1 - 1;
      const z0 = b.z0;
      const z1 = b.z1 - 1;
      const gw = 3;
      const g0 = mid - 1;
      const ring: number[] = [];
      for (let x = x0; x <= x1; x++) ring.push(land.idx(x, z0), ...(x < g0 || x >= g0 + gw ? [land.idx(x, z1)] : []));
      for (let z = z0 + 1; z < z1; z++) ring.push(land.idx(x0, z), land.idx(x1, z));
      for (const i of ring) {
        land.use[i] = Use.Wall;
        land.flags[i] = BLOCKED | BARE;
      }
      for (const [ax, az, bx, bz] of runs(ring, land.width)) land.fixtures.push({ id: "wall-run", x: ax + 0.5, z: az + 0.5, args: { to: [bx + 0.5, bz + 0.5], face: az === bz ? (az === z0 ? "n" : "s") : ax === x0 ? "w" : "e", style: wallStyle, kind: "wall", size: town.kind } });
      for (const [cx, cz] of [
        [x0, z0],
        [x1 + 1, z0],
        [x0, z1 + 1],
        [x1 + 1, z1 + 1],
      ] as const) stand(ctx, { id: "wall-tower", x: cx, z: cz, args: { style: wallStyle, kind: "wall", size: town.kind } }, Use.Wall);
      stand(ctx, { id: "gatehouse", x: g0 + gw / 2, z: z1 + 1, rot: 0, args: { width: gw, style: wallStyle, kind: "wall", size: town.kind } }, Use.Wall);
      for (let x = g0; x < g0 + gw; x++) {
        const i = land.idx(x, z1);
        land.flags[i] = 0;
        land.use[i] = Use.Kept;
        land.surface[i] = S.flagstones;
      }
    }
    if (site.id.endsWith("-citadel")) {
      // The keep at the north of the bailey, its hall beside it, a drill yard before them.
      const kw = 9;
      put(site.id, "tower", "benalish", mid - Math.floor(kw / 2), b.z0 + 2, kw, kw, { floors: 4 });
      put(`${town.id}-citadel-hall`, "guildhall", "benalish", mid + Math.ceil(kw / 2) + 2, b.z0 + 3, Math.min(12, b.x1 - 3 - (mid + Math.ceil(kw / 2) + 2)), 7);
      put(`${town.id}-citadel-barracks`, "warehouse", "benalish", b.x0 + 3, b.z0 + 3, Math.min(10, mid - Math.floor(kw / 2) - 2 - (b.x0 + 3)), 6);
      for (const [x, z] of [
        [b.x0 + 4, fz - 4],
        [b.x1 - 5, fz - 4],
      ] as const) stand(ctx, { id: "banner-pole", x: x + 0.5, z: z + 0.5, tint: "benalish" });
      stand(ctx, { id: "well", x: mid + 6, z: fz - 5 });
      stand(ctx, { id: "crate-stack", x: b.x0 + 6.5, z: fz - 5, seed: 2 });
    } else if (site.id.endsWith("-keep")) {
      // The hold's keep on its rise at the town's north, its hall beside it, facing the street.
      const kw = 8;
      put(site.id, "tower", "benalish", mid - Math.floor(kw / 2), fz - kw, kw, kw, { floors: 4 });
      const hx = mid + Math.ceil(kw / 2) + 1;
      if (b.x1 - hx >= 8) put(`${town.id}-keep-hall`, "guildhall", "benalish", hx, fz - 7, Math.min(11, b.x1 - hx), 7);
      for (let z = b.z0; z < fz - 8; z++) for (let x = b.x0; x < b.x1; x++) {
        const i = land.idx(x, z);
        if (land.use[i] !== Use.Kept) continue;
        land.flags[i] = BLOCKED;
        land.use[i] = Use.Yard;
        land.surface[i] = S.grass;
      }
      // Its forecourt: open paving before it.
      for (let z = fz - 8; z < fz; z++) for (let x = b.x0; x < b.x1; x++) if (land.use[land.idx(x, z)] === Use.Kept) ctx.mustSee[land.idx(x, z)] = 0;
    } else if (site.id.endsWith("-manor")) {
      // The manor at the north of its grounds, a drive up to it, its family's crypt and graves among the hedges.
      const [mw, md] = sizesFor("vess", "manor")[0]!;
      const w = Math.min(mw, b.x1 - b.x0 - 6);
      put(site.id, "manor", "vess", mid - Math.floor(w / 2), b.z0 + 2, w, md);
      put(`${town.id}-mausoleum`, "mausoleum", "vess", b.x0 + 3, b.z0 + 4, 4, 5);
      for (const [x, z] of poisson(b.x0 + 2, b.z0 + md + 4, b.x1 - 2, fz - 3, 2.2, random, (x, z) => land.use[land.idx(x, z)] === Use.Kept && Math.abs(x - mid) > 3)) {
        const i = land.idx(Math.floor(x), Math.floor(z));
        if (random() < 0.55) land.put(i, { id: "gravestone", x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5, turn: texel((random() - 0.5) * 0.4) });
        else land.put(i, { id: random() < 0.5 ? "dead-tree" : "mossy-dead-tree", x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5, seed: Math.floor(random() * 16) });
      }
      for (let z = b.z0 + md + 2; z < fz; z++) for (const x of [mid - 1, mid, mid + 1]) {
        const i = land.idx(x, z);
        if (land.use[i] === Use.Kept) {
          land.surface[i] = S.mud;
          land.decor.delete(i);
          land.flags[i] = 0;
        }
      }
    }
  }
}

// --- The arena, the quest board -----------------------------------------------------------------------------------------

function arena(ctx: Ctx, placed: readonly Placed[]): void {
  const { land, town } = ctx;
  const a = placed.find((p) => p.role === "arena");
  if (!a) return;
  const f = a.f;
  for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) {
    const i = land.idx(x, z);
    land.surface[i] = S.sand;
    land.flags[i] = BLOCKED;
    land.use[i] = Use.Yard;
  }
  const gate: XZ = a.spot!;
  const ring: number[] = [];
  for (let x = f.x; x < f.x + f.w; x++) {
    ring.push(land.idx(x, f.z));
    if (Math.abs(x - gate[0]) > 1) ring.push(land.idx(x, f.z + f.d - 1));
  }
  for (let z = f.z + 1; z < f.z + f.d - 1; z++) ring.push(land.idx(f.x, z), land.idx(f.x + f.w - 1, z));
  for (const [ax, az, bx, bz] of runs(ring, land.width)) land.fixtures.push({ id: "stone-wall", x: ax + 0.5, z: az + 0.5, args: { to: [bx + 0.5, bz + 0.5], h: 1 } });
  land.fixtures.push({ id: "arena-gate", x: gate[0] + 0.5, z: gate[1] + 0.5, rot: 0 });
  for (const [x, z] of [
    [f.x + 2, f.z + 2],
    [f.x + f.w - 3, f.z + 2],
  ] as const) land.fixtures.push({ id: "banner-pole", x: x + 0.5, z: z + 0.5, tint: PALETTE_OF_STYLE[town.style] ?? "benalish" });
  ctx.npcs.push({ id: `${town.id}-arena`, x: gate[0], z: gate[1], kind: "arena", name: "The arena", text: ["The arena is closed. A sign reads: coming soon."], stand: [gate[0] + 0.5, 0, gate[1] + 0.5] });
  ctx.places.push({ kind: "arena", name: "The arena", x: gate[0], z: gate[1] });
}

function board(ctx: Ctx, placed: readonly Placed[]): void {
  const { land, town } = ctx;
  const inn = placed.find((p) => p.need?.id === `${town.id}-inn`);
  if (!inn) return;
  const [x, z] = inn.spot!;
  const i = land.idx(x, z);
  land.flags[i] = BLOCKED | BARE;
  land.use[i] = Use.Kept;
  land.fixtures.push({ id: "quest-board", x: x + 0.5, z: z + 0.5, rot: 0 });
  const name = town.kind === "village" ? "Notice board" : "Quest board";
  ctx.npcs.push({ id: `${town.id}-quest-board`, x, z, kind: "quest-board", name, text: town.board, stand: [x + 0.5, 0, z + 0.5] });
  ctx.places.push({ kind: "quest-board", name, x, z });
}

// --- The square -----------------------------------------------------------------------------------------------------

function square(ctx: Ctx): void {
  const { land, plan, town } = ctx;
  const random = ctx.random("square");
  const sq = plan.square;
  const cx = (sq.x0 + sq.x1) / 2;
  const form = formOf(town);
  const used = new Set<number>();
  const clear = (x: number, z: number) => land.inside(x, z) && land.use[land.idx(x, z)] === Use.Kept && land.open(land.idx(x, z)) && !used.has(land.idx(x, z));
  // Nothing within a tile of a door, a gate's way, the arteries' lines through the square.
  const doorNear = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (land.inside(x + dx, z + dz) && land.use[land.idx(x + dx, z + dz)] === Use.Door) return true;
    return false;
  };
  const artery = (x: number) => plan.connectors.some((c) => c.kind === "artery" && x >= c.x - 1 && x < c.x + c.w + 1);
  // The centrepiece: on the square's axis, as far north as it can stand without hiding a door.
  const pieces: Record<string, PropData> = {
    statue: { id: "statue", x: 0, z: 0, args: { size: 2 } },
    fountain: { id: "fountain", x: 0, z: 0 },
    well: { id: "well", x: 0, z: 0 },
    crystal: { id: "crystal", x: 0, z: 0, args: { h: 2.2 } },
    tree: { id: "giant-tree", x: 0, z: 0, args: { size: 3 } },
    brazier: { id: "fire-bowl", x: 0, z: 0 },
  };
  const piece = pieces[town.centrepiece] ?? pieces.well!;
  const doorsSeen = (p: PropData) => {
    for (const h of [-1, 0, 1] as const) for (const [x, z] of propHides(p, h)) if (land.inside(x, z) && land.use[land.idx(x, z)] === Use.Door) return false;
    return true;
  };
  // On the square's axis where the way through it allows, else beside the way.
  placing: for (const dx of [0, -4, 4, -6, 6, -2, 2, -3, 3, -5, 5]) {
    for (let z = Math.floor((sq.z0 + sq.z1) / 2) - 2; z < sq.z1 - 1; z++) {
      const p = { ...piece, x: Math.floor(cx) + dx + (piece.id === "fountain" || piece.id === "giant-tree" ? 0 : 0.5), z: z + 0.5 };
      const tiles = tilesOf(p).tiles;
      if (!tiles.every(([x, zz]) => clear(x, zz) && !doorNear(x, zz) && !artery(x))) continue;
      if (!doorsSeen(p)) continue;
      stand(ctx, p);
      for (const [x, zz] of tiles) used.add(land.idx(x, zz));
      break placing;
    }
  }
  // The caravans' pitch: open paving, open all round, toward the square's east.
  if (town.caravan) {
    let pitch: XZ | null = null;
    for (let x = sq.x1 - 3; x > sq.x0 + 2 && !pitch; x--) {
      for (let z = sq.z0 + 4; z < sq.z1 - 3 && !pitch; z++) {
        let ok = !artery(x);
        for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) ok = clear(x + dx, z + dz) && !doorNear(x + dx, z + dz);
        if (ok) pitch = [x, z];
      }
    }
    if (!pitch) throw new Error(`${town.id}: no room on the square for the caravans' pitch`);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (land.inside(pitch[0] + dx, pitch[1] + dz)) used.add(land.idx(pitch[0] + dx, pitch[1] + dz));
    ctx.places.push({ kind: "pitch", name: "The caravans' pitch", x: pitch[0], z: pitch[1] });
  }
  // Benches along the square's east and west, lamps at its corners, stalls along its south edge (a market's).
  const light = STREET_LIGHT[town.style] ?? null;
  for (const [x, z] of [
    [sq.x0 + 1, sq.z0 + 1],
    [sq.x1 - 2, sq.z0 + 1],
    [sq.x0 + 1, sq.z1 - 2],
    [sq.x1 - 2, sq.z1 - 2],
  ] as const) {
    if (!light || !clear(x, z) || doorNear(x, z) || artery(x)) continue;
    const p = { id: light, x: x + 0.5, z: z + 0.5 };
    if (!doorsSeen(p)) continue;
    stand(ctx, p);
    used.add(land.idx(x, z));
  }
  for (const x of [sq.x0 + 2, sq.x1 - 3]) {
    for (let z = sq.z0 + 5; z < sq.z1 - 4; z += 4) {
      if (!clear(x, z) || doorNear(x, z) || artery(x)) continue;
      stand(ctx, { id: "bench", x: x + 0.5, z: z + 0.5, rot: 1, args: { width: 1.2 } });
      used.add(land.idx(x, z));
    }
  }
  if (form === "capital" || form === "city" || form === "clan" || form === "estate") {
    const goods = ["apples", "cabbages", "carrots", "bread", "fish"];
    for (let x = sq.x0 + 3; x + 3 < sq.x1 - 2; x += 5) {
      const z = sq.z1 - 3;
      const tiles = [0, 1, 2].map((k) => [x + k, z] as const);
      if (!tiles.every(([tx, tz]) => clear(tx, tz) && !doorNear(tx, tz) && !artery(tx))) continue;
      const p: PropData = { id: "canopy-stall", x, z: z + 0.8, args: { width: 3, goods: goods[Math.floor(random() * goods.length)] }, tint: random() < 0.5 ? "red-cloth" : "teal-cloth" };
      if (!doorsSeen(p)) continue;
      stand(ctx, p);
      for (const [tx, tz] of tiles) used.add(land.idx(tx, tz));
    }
  }
}

// --- Lights along the stages ---------------------------------------------------------------------------------------------

function lights(ctx: Ctx, placed: readonly Placed[]): void {
  const { land, town, plan } = ctx;
  const id = STREET_LIGHT[town.style] ?? null;
  if (!id) return;
  // In the gaps between buildings along the main streets' north sides, every ten tiles or so.
  const taken = new Set<number>();
  for (const s of plan.streets) {
    if (!s.main && formOf(town) !== "capital") continue;
    let last = -100;
    for (const [x0, x1] of s.runs) {
      for (let x = x0 + 2; x < x1 - 2; x++) {
        const z = s.z - 1;
        const i = land.idx(x, z);
        if (land.use[i] !== Use.Lot || x - last < 9) continue;
        if (land.use[land.idx(x - 1, z)] !== Use.Building && land.use[land.idx(x + 1, z)] !== Use.Building) continue;
        const p = { id, x: x + 0.5, z: z + 0.5 };
        stand(ctx, p, Use.Yard);
        taken.add(i);
        last = x;
      }
    }
  }
  void placed;
}

// --- Yards, gardens and the south band --------------------------------------------------------------------------------------

function yards(ctx: Ctx): void {
  const { land, F, town, plan } = ctx;
  const random = ctx.random("yards");
  const g = groundsOf(town);
  const lots: number[] = [];
  for (let i = 0; i < land.size; i++) if (land.use[i] === Use.Lot) lots.push(i);
  const lotSet = new Set(lots);
  const I = (x: number, z: number) => land.idx(x, z);
  const nearWay = (i: number) => land.n4(i).some((j) => walkable(land.use[j]!) && land.open(j));
  if (F.yards === "bog") {
    for (const i of lots) {
      land.surface[i] = S.bog;
      land.flags[i] = BLOCKED;
      land.use[i] = Use.Yard;
      ctx.mustSee[i] = 0;
      const x = land.xOf(i);
      const z = land.zOf(i);
      const roll = random();
      if (roll < 0.06) land.put(i, { id: "reeds", x: x + 0.5, z: z + 0.5 }, false);
      else if (roll < 0.09) land.put(i, { id: "lily-pads", x: x + 0.5, z: z + 0.5, y: -0.1 }, false);
      else if (roll < 0.11 && !nearWay(i)) {
        const p = { id: random() < 0.5 ? "mossy-dead-tree" : "swamp-tree", x: x + 0.5, z: z + 0.5, seed: Math.floor(random() * 16), scale: 0.8 };
        if (inSight(ctx, p)) land.put(i, p);
      }
      land.flags[i] = BLOCKED;
    }
    return;
  }
  if (F.yards === "open") {
    // Open ground among trees, walked: a tree's shadow falls on no path or door.
    for (const i of lots) {
      land.use[i] = Use.Yard;
      land.surface[i] = g.yard;
    }
    const trees = town.style === "llanowar" ? ["great-tree", "elf-tree", "elf-tree"] : ["oak", "tree", "birch"];
    for (const [px, pz] of poisson(plan.box.x0, plan.box.z0, plan.box.x1, plan.box.z1, 2.6, random, (x, z) => lotSet.has(I(x, z)))) {
      const x = Math.floor(px);
      const z = Math.floor(pz);
      const i = I(x, z);
      if (nearWay(i) || land.n8(i).some((j) => land.use[j] === Use.Door || land.use[j] === Use.Building)) continue;
      const roll = random();
      const id = roll < 0.6 ? trees[Math.floor(random() * trees.length)]! : town.style === "llanowar" ? (roll < 0.75 ? "giant-mushroom" : roll < 0.9 ? "undergrowth" : "fern") : roll < 0.8 ? "bush" : "flower-bed";
      const p: PropData = { id, x: texel(x + 0.5), z: texel(z + 0.5), seed: Math.floor(random() * 16), ...(id === "great-tree" ? { scale: 0.55 } : id === "giant-mushroom" ? { args: { kind: "elf" } } : {}) };
      if (!inSight(ctx, p)) continue;
      land.put(i, p);
      if (id === "great-tree" && random() < 0.35) {
        const plat = { id: "tree-platform", x: p.x, z: p.z, args: { height: texel(2.5 + random()) } };
        if (inSight(ctx, plat)) land.fixtures.push(plat);
      }
    }
    return;
  }
  hedgedYards(ctx, lots, nearWay, random);
}

/** What a yard behind a row is for. */
type YardUse = "garden" | "kitchen" | "orchard" | "paddock" | "timber" | "green" | "churchyard" | "drying";

/**
 * The yards behind the rows, each piece of them something: a kitchen garden in beds, an orchard in rows, a paddock with
 * its hay, a timber yard, a bleaching green with its lines of washing posts, a flower garden, a churchyard by a temple,
 * or now and then a small green open to the street with a bench and a well, walked through. Each piece is the yards of a
 * block (the yard tiles joined edge to edge); its use is weighted by where it lies - kitchen gardens and drying greens
 * by the houses, timber and paddocks toward the edges and gates, orchards inside the south wall. The street side of a
 * closed yard is fenced by what suits its use: a hedge, a wattle fence, a post-and-rail, a garden wall, a palisade.
 */
function hedgedYards(ctx: Ctx, lots: number[], nearWay: (i: number) => boolean, random: () => number): void {
  const { land, plan, town } = ctx;
  const I = (x: number, z: number) => land.idx(x, z);
  const lotSet = new Set(lots);
  const seen = new Set<number>();
  const pieces: number[][] = [];
  for (const i of lots) {
    if (seen.has(i)) continue;
    const piece = [i];
    seen.add(i);
    for (let h = 0; h < piece.length; h++) for (const j of land.n4(piece[h]!)) if (lotSet.has(j) && !seen.has(j)) {
      seen.add(j);
      piece.push(j);
    }
    pieces.push(piece);
  }
  const keldon = town.style === "keldon";
  const usesMade = new Map<YardUse, number>();
  for (const piece of pieces) {
    const xs = piece.map((i) => land.xOf(i));
    const zs = piece.map((i) => land.zOf(i));
    const cx = xs.reduce((a, b) => a + b, 0) / piece.length;
    const cz = zs.reduce((a, b) => a + b, 0) / piece.length;
    const churchyard = plan.sites.some((s) => s.id.endsWith("-temple") && cx >= s.box.x0 && cx < s.box.x1 && cz >= s.box.z0 && cz < s.box.z1);
    const south = cz >= plan.south.z0;
    const edgeOfTown = Math.min(cx - plan.box.x0, plan.box.x1 - cx) < 14;
    let use: YardUse;
    if (churchyard) use = "churchyard";
    else if (south) use = random() < 0.7 ? "orchard" : "kitchen";
    else {
      const options: [YardUse, number][] = [
        ["garden", 3],
        ["kitchen", 3],
        ["orchard", 2],
        ["drying", 1.5],
        ["timber", edgeOfTown ? 2 : 0.6],
        ["paddock", edgeOfTown ? 2 : 0.4],
        ["green", piece.length >= 24 && (usesMade.get("green") ?? 0) < 2 + Math.floor(pieces.length / 12) ? 1.6 : 0],
      ];
      const total = options.reduce((s, [, w]) => s + w, 0);
      let roll = random() * total;
      use = options.find(([, w]) => (roll -= w) < 0)?.[0] ?? "garden";
    }
    usesMade.set(use, (usesMade.get(use) ?? 0) + 1);
    const edge = piece.filter(nearWay);
    const edgeSet = new Set(edge);
    if (use === "green") {
      // Open to the street: grass walked over, a bench, a well, a tree that hides no street.
      for (const i of piece) {
        land.use[i] = Use.Kept;
        land.flags[i] = 0;
        land.surface[i] = S.grass;
      }
      const inner = piece.filter((i) => !edgeSet.has(i) && land.n8(i).every((j) => land.use[j] !== Use.Door));
      const well = inner[Math.floor(inner.length / 2)];
      if (well !== undefined) stand(ctx, { id: "well", x: land.xOf(well) + 0.5, z: land.zOf(well) + 0.5 });
      const bench = inner.find((i) => i !== well && land.open(i) && land.n8(i).every((j) => land.open(j) || j === well));
      if (bench !== undefined) stand(ctx, { id: "bench", x: land.xOf(bench) + 0.5, z: land.zOf(bench) + 0.5, args: { width: 1.2 } });
      continue;
    }
    const fence = keldon ? "palisade" : use === "paddock" || use === "timber" ? "fence" : use === "kitchen" ? "wattle-fence" : use === "churchyard" ? "stone-wall" : town.style === "urborg" || town.style === "tolarian" ? "railings" : random() < 0.6 ? "hedge" : "stone-wall";
    for (const [ax, az, bx, bz] of runs(edge, land.width)) land.fixtures.push({ id: fence, x: ax + 0.5, z: az + 0.5, args: { to: [bx + 0.5, bz + 0.5], ...(fence === "palisade" ? { h: 1.4 } : fence === "hedge" ? { h: 0.9 } : {}) } });
    const surface = use === "kitchen" ? S.furrows : use === "paddock" ? S.straw : use === "timber" ? S.dirt : use === "drying" ? S.meadow : land.surface[piece[0]!]!;
    for (const i of piece) {
      land.use[i] = Use.Yard;
      land.flags[i] = edgeSet.has(i) ? BLOCKED | BARE : BLOCKED;
      ctx.mustSee[i] = 0;
      if (!edgeSet.has(i)) land.surface[i] = surface;
    }
    // What stands in it.
    for (const i of piece) {
      if (edgeSet.has(i)) continue;
      const x = land.xOf(i);
      const z = land.zOf(i);
      const r = random();
      let id = "";
      switch (use) {
        case "orchard":
          id = (x % 3 === 0 && z % 3 === 1) ? "fruit-tree" : "";
          break;
        case "kitchen":
          id = z % 2 === 0 ? (r < 0.5 ? "flower-bed" : "") : r < 0.06 ? "barrel" : "";
          if (z % 2 === 1) land.surface[i] = S.grass;
          break;
        case "paddock":
          id = r < 0.06 ? "hay-bale" : r < 0.08 ? "trough" : "";
          break;
        case "timber":
          id = r < 0.12 ? (keldon ? "woodpile" : "wood-pile") : r < 0.17 ? "log" : r < 0.2 ? "crate-stack" : "";
          break;
        case "drying":
          id = x % 4 === 0 && z % 2 === 0 ? "fence-run" : "";
          break;
        case "churchyard":
          id = r < 0.4 ? "gravestone" : r < 0.48 ? "cypress" : "";
          break;
        default:
          id = r < 0.12 ? "fruit-tree" : r < 0.34 ? "bush" : r < 0.55 ? "flower-bed" : r < 0.6 ? "wood-pile" : "";
      }
      if (!id) continue;
      const p: PropData =
        id === "fence-run"
          ? { id, x: x + 0.15, z: z + 0.5, args: { to: [x + 0.85, z + 0.5] } }
          : { id, x: texel(x + 0.5), z: texel(z + 0.5), seed: Math.floor(random() * 16), ...(id === "fruit-tree" || id === "cypress" ? { scale: 0.7 } : id === "gravestone" ? { turn: texel((random() - 0.5) * 0.3) } : id === "bush" && random() < 0.4 ? { args: { flowering: true } } : {}) };
      if ((id === "fruit-tree" || id === "bush" || id === "cypress") && !inSight(ctx, p)) continue;
      if (id === "fence-run" || id === "log" || id === "trough" || id === "crate-stack") {
        if (!tilesOf(p).tiles.every(([tx, tz]) => lotSet.has(I(tx, tz)) && !edgeSet.has(I(tx, tz)))) continue;
        land.fixtures.push(p);
        continue;
      }
      land.put(i, p, true);
      land.flags[i] = BLOCKED | (id === "flower-bed" ? 0 : BARE);
    }
  }
}

// --- The wall -----------------------------------------------------------------------------------------------------------

function walls(ctx: Ctx): void {
  const { land, plan, F, town } = ctx;
  if (F.enclosure === "none") return;
  const style = town.style === "argive" ? "benalish" : town.style;
  const box = plan.box;
  const ring: number[] = [];
  for (let i = 0; i < land.size; i++) if (land.use[i] === Use.Wall && land.xOf(i) >= box.x0 && land.xOf(i) < box.x1 && land.zOf(i) >= box.z0 && land.zOf(i) < box.z1) ring.push(i);
  const random = ctx.random("walls");
  const town1 = (x: number, z: number) => land.inside(x, z) && ctx.inTown[land.idx(x, z)] === 1;
  // A run's outer face: away from the town beside it.
  const faceOf = (ax: number, az: number, bx: number, bz: number) => (az === bz ? (town1(ax, az + 1) || town1(bx, bz + 1) ? "n" : "s") : town1(ax + 1, az) || town1(bx + 1, bz) ? "w" : "e");
  for (const [ax, az, bx, bz] of runs(ring, land.width, 16)) {
    if (F.enclosure === "hedge") land.fixtures.push({ id: "hedgerow", x: ax + 0.5, z: az + 0.5, seed: Math.floor(random() * 16), args: { to: [bx + 0.5, bz + 0.5] } });
    else land.fixtures.push({ id: "wall-run", x: ax + 0.5, z: az + 0.5, args: { to: [bx + 0.5, bz + 0.5], face: faceOf(ax, az, bx, bz), style, kind: F.enclosure, size: town.kind } });
  }
  if (F.enclosure === "hedge") return;
  // Towers at the corners (on the land side), and a gatehouse in each gate with a tower either side.
  // Towers at the outline's outer corners (on the land side of the ring), and a gatehouse in each gate.
  const wall = (x: number, z: number) => land.inside(x, z) && land.use[land.idx(x, z)] === Use.Wall;
  const nearGate = (x: number, z: number) => plan.gates.some((g) => x >= g.passage.x0 - 4 && x < g.passage.x1 + 4 && z >= g.passage.z0 - 4 && z < g.passage.z1 + 4);
  for (const i of ring) {
    const x = land.xOf(i);
    const z = land.zOf(i);
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      if (!town1(x + dx, z + dz) || !wall(x + dx, z) || !wall(x, z + dz) || town1(x - dx, z) || town1(x, z - dz) || town1(x + dx, z - dz) || town1(x - dx, z + dz)) continue;
      if (nearGate(x, z)) continue;
      stand(ctx, { id: "wall-tower", x: dx > 0 ? x : x + 1, z: dz > 0 ? z : z + 1, args: { style, kind: F.enclosure, size: town.kind } }, Use.Wall);
    }
  }
  for (const gate of plan.gates) {
    const p = gate.passage;
    const rot = gate.side === "south" ? 0 : gate.side === "west" ? 1 : gate.side === "north" ? 2 : 3;
    const x = gate.side === "west" ? p.x0 : gate.side === "east" ? p.x1 : (p.x0 + p.x1) / 2;
    const z = gate.side === "north" ? p.z0 : gate.side === "south" ? p.z1 : (p.z0 + p.z1) / 2;
    const gh: PropData = { id: "gatehouse", x, z, rot, args: { width: gate.width, style, kind: F.enclosure, size: town.kind } };
    stand(ctx, gh, Use.Wall);
    for (const [tx, tz] of tilesOf(gh).tiles) ctx.mustSee[land.idx(tx, tz)] = 0;
  }
}

// --- Water: the harbour's piers and boats, the river's bridges ---------------------------------------------------------------

function water(ctx: Ctx): void {
  const { land, plan } = ctx;
  const random = ctx.random("water");
  const box = plan.box;
  // Piers out from the quay on each sea side, boats moored beside them.
  for (const side of plan.sea) {
    const along = side === "north" || side === "south";
    const [lo, hi] = along ? [box.x0 + 6, box.x1 - 6] : [box.z0 + 6, box.z1 - 6];
    for (let t = lo; t < hi; t += 16 + Math.floor(random() * 6)) {
      // From the quay's edge out over the water, three wide and eight long.
      const len = 8;
      const [x0, z0, x1, z1] =
        side === "south" ? [t, box.z1, t + 3, box.z1 + len] : side === "north" ? [t, box.z0 - len, t + 3, box.z0] : side === "west" ? [box.x0 - len, t, box.x0, t + 3] : [box.x1, t, box.x1 + len, t + 3];
      let ok = true;
      for (let z = z0; z < z1 && ok; z++) for (let x = x0; x < x1 && ok; x++) ok = land.inside(x, z);
      if (!ok) continue;
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
        const i = land.idx(x, z);
        land.flags[i] = 0;
        land.use[i] = Use.Dock;
        if (!land.isWater(i)) land.surface[i] = S.planks;
        land.decor.delete(i);
      }
      land.fixtures.push({ id: "pier", x: x0, z: z0, args: { to: [x1, z1], y: 0.3 } });
      const bx = along ? x1 + 1.5 : (x0 + x1) / 2;
      const bz = along ? (z0 + z1) / 2 + 1 : z1 + 1.5;
      if (land.inside(Math.floor(bx), Math.floor(bz)) && land.isSea(land.idx(Math.floor(bx), Math.floor(bz)))) land.fixtures.push({ id: random() < 0.4 ? "sailboat" : "rowboat", x: bx, z: bz, y: -0.1, rot: along ? 0 : 1, args: { sail: "furled" } });
      // Crates and barrels on the quay by it.
      const qx = side === "south" ? t + 4 : side === "north" ? t + 4 : side === "west" ? box.x0 + 1 : box.x1 - 2;
      const qz = side === "south" ? box.z1 - 2 : side === "north" ? box.z0 + 1 : t + 4;
      const qi = land.idx(qx, qz);
      if (land.inside(qx, qz) && land.open(qi) && land.use[qi] === Use.Street && land.n8(qi).every((j) => land.use[j] !== Use.Door)) {
        stand(ctx, { id: random() < 0.5 ? "crate-stack" : "barrel", x: qx + 0.5, z: qz + 0.5, seed: Math.floor(random() * 8) });
      }
    }
  }
  // Bridges where the town's ways cross its river.
  if (plan.river) {
    for (const c of plan.connectors) {
      if (c.z0 > plan.river.z0 || c.z1 < plan.river.z1) continue;
      land.fixtures.push({ id: "bridge", x: c.x, z: plan.river.z0 - 1, args: { to: [c.x + c.w, plan.river.z1 + 1], y: 0 } });
    }
  }
}

// --- People --------------------------------------------------------------------------------------------------------------

function people(ctx: Ctx, placed: readonly Placed[]): void {
  const { land, plan, town, F } = ctx;
  const region = REGION_OF_STYLE[town.style] ?? "benalia";
  const doors = placed.filter((p) => p.need?.room).map((p) => p.f.door);
  const busy = (x: number, z: number) => ctx.places.some((p) => Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= 3) || doors.some((d) => Math.max(Math.abs(d[0] - x), Math.abs(d[1] - z)) <= 3);
  const open = (x: number, z: number) => land.inside(x, z) && land.open(land.idx(x, z)) && walkable(land.use[land.idx(x, z)]!);
  if (F.guards && town.kind !== "village") {
    let k = 0;
    for (const g of plan.gates) {
      const [ix, iz] = [(g.passage.x0 + g.passage.x1 - 1) / 2, (g.passage.z0 + g.passage.z1 - 1) / 2].map(Math.floor) as [number, number];
      const [dx, dz] = g.side === "south" ? [0, -1] : g.side === "north" ? [0, 1] : g.side === "west" ? [1, 0] : [-1, 0];
      const stops: XZ[] = [];
      for (const [from, to] of [
        [2, 5],
        [9, 16],
      ] as const) {
        for (let s = from; s <= to; s++) {
          const x = ix + dx * s + (dx === 0 ? 1 : 0);
          const z = iz + dz * s + (dz === 0 ? 1 : 0);
          if (open(x, z) && !busy(x, z)) {
            stops.push([x, z]);
            break;
          }
        }
      }
      if (stops.length < 2) continue;
      ctx.npcs.push({ id: `${town.id}-guard-${++k}`, x: stops[0]![0], z: stops[0]![1], kind: "guard", name: `${town.name} guard`, text: ["Keep to the roads. The waymarkers say how bad it gets past them."], figure: `guard-${region}`, seed: k, speed: 2.2, behaviour: { beat: { stops, pause: 3.5 }, watch: 4 } });
    }
  }
  const sq = plan.square;
  // About the square, spread through it: each at its own share across and up and down it.
  const spread = [
    [0.22, 0.55],
    [0.75, 0.4],
    [0.45, 0.75],
    [0.3, 0.3],
    [0.62, 0.65],
  ];
  town.folk.forEach((folk, n) => {
    const [fx, fz] = spread[n % spread.length]!;
    const want: XZ = [Math.round(sq.x0 + (sq.x1 - sq.x0) * fx!), Math.round(sq.z0 + (sq.z1 - sq.z0) * fz!)];
    let at: XZ | null = null;
    for (let r = 0; r < 8 && !at; r++) for (let dz = -r; dz <= r && !at; dz++) for (let dx = -r; dx <= r && !at; dx++) if (open(want[0] + dx, want[1] + dz) && land.use[land.idx(want[0] + dx, want[1] + dz)] === Use.Kept) at = [want[0] + dx, want[1] + dz];
    if (!at) return;
    const npc: NpcData = { id: `${town.id}-folk-${n + 1}`, x: at[0], z: at[1], kind: "townsfolk", name: folk.name, text: folk.text, figure: `townsfolk-${region}`, speed: 1.6, seed: n + 1, behaviour: { wander: { home: at, reach: 4, pause: [2, 6] }, watch: 3 } };
    ctx.npcs.push(npc);
  });
}
