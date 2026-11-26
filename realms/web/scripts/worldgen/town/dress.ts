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
import { isOrganic } from "./organic";
import { propHides } from "./view";

/** The named palette a town's banners fly, by its style. */
const PALETTE_OF_STYLE: Readonly<Record<string, string>> = { benalish: "benalish", argive: "benalish", llanowar: "llanowar", urborg: "morass", keldon: "keldon", tolarian: "tolarian" };

export const STREET_LIGHT: Readonly<Record<string, string | null>> = { benalish: "lamp-post", tolarian: "lamp-post", keldon: "torch-post", urborg: "lantern-post", llanowar: null, argive: "lamp-post" };

export function dress(ctx: Ctx, placed: readonly Placed[]): void {
  sites(ctx);
  arena(ctx, placed);
  board(ctx, placed);
  square(ctx);
  quarters(ctx);
  ctx.planner.lights(ctx);
  gardens(ctx, placed);
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
export function stand(ctx: Ctx, p: PropData, use = Use.Kept): void {
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
    if (site.id.endsWith("-temple") || site.id.endsWith("-shrine")) continue;
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
        // The keep's lawn behind it: open ground (nothing drawn there closes it).
        land.flags[i] = 0;
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
      // The formal garden: clipped hedges along the avenue either side, a gap every so often onto the graves.
      for (const x of [mid - 2, mid + 2]) {
        const hedge: number[] = [];
        for (let z = b.z0 + md + 3; z < fz - 3; z++) {
          if ((z - (b.z0 + md + 3)) % 8 >= 6) continue;
          const i = land.idx(x, z);
          if (land.use[i] !== Use.Kept || !land.open(i)) continue;
          hedge.push(i);
        }
        for (const [ax, az, bx, bz] of runs(hedge, land.width)) {
          land.fixtures.push({ id: "hedge-wall", x: ax + 0.5, z: az + 0.5, args: { to: [bx + 0.5, bz + 0.5] } });
          for (let z = az; z <= bz; z++) {
            const i = land.idx(ax, z);
            land.flags[i] = BLOCKED | BARE;
            land.use[i] = Use.Yard;
            ctx.mustSee[i] = 0;
          }
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
  // In a grown town ways come into the centre from every side: nothing stands where one meets it.
  const grownWay = (x: number, z: number) => isOrganic(plan) && land.n8(land.idx(x, z)).some((j) => land.use[j] === Use.Street);
  const clear = (x: number, z: number) => land.inside(x, z) && land.use[land.idx(x, z)] === Use.Kept && land.open(land.idx(x, z)) && !used.has(land.idx(x, z)) && !grownWay(x, z);
  // Nothing within a tile of a door, a gate's way, the arteries' lines through the square.
  const doorNear = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (land.inside(x + dx, z + dz) && land.use[land.idx(x + dx, z + dz)] === Use.Door) return true;
    return false;
  };
  const artery = (x: number) => plan.through.some((c) => x >= c.x0 - 1 && x < c.x1 + 1);
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

// --- The quarters' squares -----------------------------------------------------------------------------------------------------

/**
 * What stands on a grown town's lesser centres, each its kind's: the park's trees round its edge, benches and a fountain;
 * the smiths' yard's anvil, wood, cart and barrels; the druids' circle of standing stones about a fire; the Houses' close
 * its statue; a lesser square its fountain and benches; a quad its tree and benches; a deck its railings where no
 * boardwalk comes onto it. Nothing where a way meets it, by a door, or hiding a way or a door.
 */
function quarters(ctx: Ctx): void {
  const { land, plan, town } = ctx;
  if (!isOrganic(plan)) return;
  const random = ctx.random("quarters");
  const style = town.style === "argive" ? "benalish" : town.style;
  const at = (x: number, z: number) => land.idx(x, z);
  const nearWay = (x: number, z: number) => land.n8(at(x, z)).some((j) => land.use[j] === Use.Street);
  const nearDoor = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (land.inside(x + dx, z + dz) && land.use[at(x + dx, z + dz)] === Use.Door) return true;
    return false;
  };
  const free = (x: number, z: number) => land.inside(x, z) && land.use[at(x, z)] === Use.Kept && land.open(at(x, z)) && !nearWay(x, z) && !nearDoor(x, z);
  const doorsSeen = (p: PropData) => {
    for (const h of [-1, 0, 1] as const) for (const [x, z] of propHides(p, h)) if (land.inside(x, z) && land.use[at(x, z)] === Use.Door) return false;
    return true;
  };
  const put = (p: PropData): boolean => {
    const { tiles } = tilesOf(p);
    if (!tiles.every(([x, z]) => free(x, z)) || !inSight(ctx, p) || !doorsSeen(p)) return false;
    stand(ctx, p);
    return true;
  };
  plan.platforms.forEach((sq, k) => {
    const kind = plan.quarters[k];
    const cx = Math.floor(sq.x + sq.w / 2);
    const cz = Math.floor(sq.z + sq.d / 2);
    const edge: XZ[] = [];
    for (let x = sq.x; x < sq.x + sq.w; x++) edge.push([x, sq.z], [x, sq.z + sq.d - 1]);
    for (let z = sq.z + 1; z < sq.z + sq.d - 1; z++) edge.push([sq.x, z], [sq.x + sq.w - 1, z]);
    switch (kind) {
      case "park": {
        // Trees round its edge, a fountain in it, benches between.
        edge.forEach(([x, z], n) => {
          if (n % 3 === 0) put({ id: random() < 0.5 ? "oak" : "birch", x: x + 0.5, z: z + 0.5, seed: Math.floor(random() * 16), scale: 0.8 });
        });
        put({ id: "fountain", x: cx, z: cz });
        for (const [x, z] of [[sq.x + 2, cz], [sq.x + sq.w - 3, cz]] as const) put({ id: "bench", x: x + 0.5, z: z + 0.5, rot: 1, args: { width: 1.2 } });
        break;
      }
      case "yard": {
        // The smiths' yard: an anvil, wood stacked, a cart, barrels about its edge.
        put({ id: "anvil", x: cx + 0.5, z: cz + 0.5 });
        put({ id: "wood-pile", x: sq.x + 1.5, z: sq.z + 1.5, seed: 3 });
        put({ id: "cart", x: sq.x + sq.w - 2, z: sq.z + 1.5, rot: 1 });
        for (const [x, z] of edge.filter((_, n) => n % 5 === 2)) put({ id: random() < 0.5 ? "barrel" : "crate-stack", x: x + 0.5, z: z + 0.5, seed: Math.floor(random() * 8) });
        break;
      }
      case "circle": {
        // The druids' circle: standing stones on a ring about a fire.
        const n = 9;
        for (let s = 0; s < n; s++) {
          const a = (s / n) * Math.PI * 2;
          const x = Math.floor(cx + Math.cos(a) * (sq.w / 2 - 1.2));
          const z = Math.floor(cz + Math.sin(a) * (sq.d / 2 - 1));
          put({ id: "standing-stone", x: x + 0.5, z: z + 0.5, seed: s, args: { h: 1.6 + random() * 0.6 } });
        }
        put({ id: "fire-bowl", x: cx + 0.5, z: cz + 0.5 });
        break;
      }
      case "close":
        put({ id: "statue", x: cx + 0.5, z: cz + 0.5, args: { size: 2 } }) || put({ id: "statue", x: cx + 0.5, z: cz + 0.5 });
        for (const [x, z] of [[sq.x + 1, sq.z + 1], [sq.x + sq.w - 2, sq.z + 1]] as const) put({ id: STREET_LIGHT[style] ?? "lamp-post", x: x + 0.5, z: z + 0.5 });
        break;
      case "square":
        put({ id: "fountain", x: cx, z: cz });
        for (const [x, z] of [[sq.x + 2, cz], [sq.x + sq.w - 3, cz]] as const) put({ id: "bench", x: x + 0.5, z: z + 0.5, rot: 1, args: { width: 1.2 } });
        break;
      case "quad":
        put({ id: "tree", x: cx + 0.5, z: cz + 0.5, seed: k, scale: 0.9 });
        for (const [x, z] of [[sq.x + 1, sq.z + 1], [sq.x + sq.w - 2, sq.z + 1]] as const) put({ id: "bench", x: x + 0.5, z: z + 0.5, args: { width: 1.2 } });
        break;
      case "deck": {
        // Railings round the deck's edge where no boardwalk comes onto it: the deck set apart from the walks.
        const rail: number[] = [];
        for (const [x, z] of edge) {
          if (!land.inside(x, z)) continue;
          const i = at(x, z);
          if (land.use[i] !== Use.Kept || !land.open(i) || nearDoor(x, z)) continue;
          if (land.n4(i).some((j) => land.use[j] === Use.Street)) continue;
          rail.push(i);
        }
        for (const [ax, az, bx, bz] of runs(rail, land.width)) {
          land.fixtures.push({ id: "railings", x: ax + 0.5, z: az + 0.5, args: { to: [bx + 0.5, bz + 0.5] } });
          for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
            const i = at(x, z);
            land.flags[i] = BLOCKED | BARE;
            land.use[i] = Use.Yard;
            ctx.mustSee[i] = 0;
          }
        }
        break;
      }
    }
  });
}

// --- Walled gardens ------------------------------------------------------------------------------------------------------------

/**
 * Walled gardens: each manor of the Seven Houses in its own - its lot walled round, a gate onto the way beside the house,
 * the garden behind walked among its beds, a fruit tree in its back corners - and a physic garden's lot (beds of herbs
 * in rows, its gate in the middle of its front). check.ts holds every manor of the capital to its walled plot.
 */
function gardens(ctx: Ctx, placed: readonly Placed[]): void {
  const { land, plan, town } = ctx;
  if (!isOrganic(plan)) return;
  const random = ctx.random("gardens");
  const at = (x: number, z: number) => land.idx(x, z);
  const plots: { id: string; block: { x0: number; z0: number; x1: number; z1: number }; house: { x: number; z: number; w: number; d: number } | null }[] = [];
  for (const p of placed) if (p.role === "manor" && p.b) plots.push({ id: p.b.id, block: p.block, house: p.f });
  for (const b of plan.blocks) if ((b as { garden?: string }).garden) plots.push({ id: `${town.id}-physic-garden`, block: b, house: null });
  for (const plot of plots) {
    const { x0, z0, x1, z1 } = plot.block;
    const f = plot.house;
    const fr = z1 - 1;
    const inHouse = (x: number, z: number) => f !== null && x >= f.x && x < f.x + f.w && z >= f.z && z < f.z + f.d;
    // The gate: on the front beside the house, the wider side; in the middle of the front where there is no house.
    const west = f ? f.x - x0 : 0;
    const east = f ? x1 - (f.x + f.w) : 0;
    const gx = !f ? Math.floor((x0 + x1) / 2) : west >= east ? (west >= 2 ? x0 + 1 : -1) : east >= 2 ? x1 - 2 : -1;
    if (gx < 0 || x1 - x0 < 5 || z1 - z0 < 5) continue;
    const wall: number[] = [];
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      if (inHouse(x, z)) continue;
      const i = at(x, z);
      const rim = x === x0 || x === x1 - 1 || z === z0 || z === fr;
      if (rim && !(x === gx && z === fr)) {
        wall.push(i);
        land.use[i] = Use.Yard;
        land.flags[i] = BLOCKED | BARE;
        land.surface[i] = land.surface[i]!;
      } else {
        // The garden: open grass, walked from its gate.
        land.use[i] = Use.Kept;
        land.flags[i] = 0;
        land.surface[i] = S.grass;
      }
      land.decor.delete(i);
      ctx.mustSee[i] = 0;
    }
    for (const [ax, az, bx, bz] of runs(wall, land.width)) land.fixtures.push({ id: "stone-wall", x: ax + 0.5, z: az + 0.5, args: { to: [bx + 0.5, bz + 0.5] } });
    land.fixtures.push({ id: "fence-gate", x: gx + 0.5, z: fr + 0.5 });
    // Beds in rows across it, the gate's column kept clear (the way in and through it); fruit trees in the back corners.
    for (let z = z0 + 2; z < fr - 1; z += 2) for (let x = x0 + 1; x < x1 - 1; x++) {
      if (x === gx || inHouse(x, z) || inHouse(x, z + 1) || inHouse(x, z - 1)) continue;
      const i = at(x, z);
      if (land.use[i] !== Use.Kept || random() < 0.25) continue;
      land.put(i, { id: "flower-bed", x: x + 0.5, z: z + 0.5, seed: Math.floor(random() * 16) }, true);
      land.flags[i] = BLOCKED;
      land.use[i] = Use.Yard;
    }
    if (f) {
      for (const x of [x0 + 1, x1 - 2]) {
        if (x === gx) continue;
        const p: PropData = { id: "fruit-tree", x: x + 0.5, z: z0 + 1.5, seed: Math.floor(random() * 16), scale: 0.7 };
        const i = at(x, z0 + 1);
        if (land.use[i] !== Use.Kept || !inSight(ctx, p)) continue;
        land.put(i, p, true);
        land.flags[i] = BLOCKED | BARE;
        land.use[i] = Use.Yard;
      }
    }
    ctx.walledPlots.push({ id: plot.id, box: { x0, z0, x1, z1 }, gate: [gx, fr] });
  }
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
      if (id === "great-tree" && random() < (town.kind === "village" ? 0.35 : 0.55)) {
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
        ["drying", keldon ? 5 : 1.5],
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
  const towers: XZ[] = [];
  if (isOrganic(plan) && plan.designed) {
    // A designed wall: a tower at every bend of it, out or in, on the outer side of the bend.
    for (const i of ring) {
      const x = land.xOf(i);
      const z = land.zOf(i);
      const h = (wall(x - 1, z) ? 1 : 0) + (wall(x + 1, z) ? 1 : 0);
      const v = (wall(x, z - 1) ? 1 : 0) + (wall(x, z + 1) ? 1 : 0);
      if (h !== 1 || v !== 1 || nearGate(x, z)) continue;
      // The outer diagonal: the side of the bend away from the town.
      let placedTower = false;
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        if (placedTower || town1(x + dx, z + dz) || town1(x + dx, z) || town1(x, z + dz) || wall(x + dx, z + dz)) continue;
        const ax = dx > 0 ? x + 1 : x;
        const az = dz > 0 ? z + 1 : z;
        const p: PropData = { id: "wall-tower", x: ax, z: az, args: { style, kind: F.enclosure, size: town.kind } };
        // On ground of its own: nothing walked of the town's or the country's under it.
        if (tilesOf(p).tiles.some(([tx, tz]) => !land.inside(tx, tz) || walkable(land.use[land.idx(tx, tz)]!) || land.isSea(land.idx(tx, tz)))) continue;
        stand(ctx, p, Use.Wall);
        towers.push([x, z]);
        placedTower = true;
      }
    }
  }
  for (const i of isOrganic(plan) && plan.designed ? [] : ring) {
    const x = land.xOf(i);
    const z = land.zOf(i);
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      if (!town1(x + dx, z + dz) || !wall(x + dx, z) || !wall(x, z + dz) || town1(x - dx, z) || town1(x, z - dz) || town1(x + dx, z - dz) || town1(x - dx, z + dz)) continue;
      if (nearGate(x, z)) continue;
      // A grown town's outline turns at every step of its curve: a tower only every so often along it.
      if (isOrganic(plan) && towers.some(([tx, tz]) => Math.abs(tx - x) + Math.abs(tz - z) < 16)) continue;
      towers.push([x, z]);
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
  // A grown town's piers: off its shore where it meets the sea, as its plan lays them.
  if (isOrganic(plan)) {
    for (const p of plan.piers) {
      for (let z = p.box.z0; z < p.box.z1; z++) for (let x = p.box.x0; x < p.box.x1; x++) {
        const i = land.idx(x, z);
        land.flags[i] = 0;
        land.use[i] = Use.Dock;
        land.surface[i] = S.planks;
        land.decor.delete(i);
      }
      land.fixtures.push({ id: "pier", x: p.box.x0, z: p.box.z0, args: { to: [p.box.x1, p.box.z1], y: 0.3 } });
      const [bx, bz] = p.boat;
      // A slip: its boat drawn up on it, out of the water.
      if (p.slip) {
        const boat: PropData = { id: "rowboat", x: bx, z: bz, y: 0.3, rot: p.along ? 1 : 0 };
        stand(ctx, boat, Use.Dock);
        // What of the slip the boat cuts off from the shore is the boat's: closed under it.
        const deck = new Set<number>();
        for (let z = p.box.z0; z < p.box.z1; z++) for (let x = p.box.x0; x < p.box.x1; x++) deck.add(land.idx(x, z));
        const reached = new Set<number>();
        const queue = [...deck].filter((i) => land.open(i) && land.n4(i).some((j) => !deck.has(j) && land.open(j) && !land.isSea(j)));
        for (const i of queue) reached.add(i);
        for (let h = 0; h < queue.length; h++) for (const j of land.n4(queue[h]!)) if (deck.has(j) && land.open(j) && !reached.has(j)) {
          reached.add(j);
          queue.push(j);
        }
        for (const i of deck) if (!reached.has(i) && land.open(i)) land.flags[i] = BLOCKED | BARE;
      }
      else if (land.inside(Math.floor(bx), Math.floor(bz)) && land.isSea(land.idx(Math.floor(bx), Math.floor(bz)))) land.fixtures.push({ id: random() < 0.4 ? "sailboat" : "rowboat", x: bx, z: bz, y: -0.1, rot: p.along ? 0 : 1, args: { sail: "furled" } });
    }
  }
  // Piers out from the quay on each sea side, boats moored beside them.
  for (const side of isOrganic(plan) ? [] : plan.sea) {
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
        // Its deck is what is walked: planks, over the water too (no open tile of the sea is walked).
        land.surface[i] = S.planks;
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
  // Bridges where the town's ways cross its water.
  for (const b of plan.bridges) land.fixtures.push({ id: "bridge", x: b.x0, z: b.z0, args: { to: [b.x1, b.z1], y: 0 } });
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
