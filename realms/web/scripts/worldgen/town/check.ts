// The town's design as checks, run on every town as it is made: a rule broken fails the town (an Error naming every
// break), so a town that is made is one that keeps them. What is held:
// - the street plan (lint.ts `lintTown`): every door, place and way's end walked to from every gate along the streets, no
//   street running on to nothing, no long way round between key places;
// - every building faces its street: none faces north, every place with a door or a sign faces south;
// - the camera: no door hidden at any heading, and no street or square hidden at the front heading, by any building or
//   anything tall that stands (view.ts, the art measured) - the gates' own arches aside;
// - the square is a room: fronts along its north side, buildings on its east and west, its south side open;
// - everything a player uses is a short walk from the square, the inn the nearest of them to the main gate;
// - every way at least three tiles wide; open neighbours a level apart at most (a hop), ways climbing by ramps;
// - the grounds: every open tile walked to from the main gate (pockets the woods closed off are filled first), the walked
//   ground's edge closed but at the exits, each exit walked to and its `inside` on its road;
// - the town holds every place it must: its vendors' shops, its houses, its temple or shrine, its guild, library or tower
//   and smithy, its quest board, its arena, its caravans' pitch;
// - every thing used from beside it stands on a closed tile with a street beside it.

import { BUILDINGS } from "../../../src/art/buildings";
import { PALETTES } from "../../../src/art/paint/palette";
import { PROPS } from "../../../src/art/props/registry";
import type { BuildingData, PropData, TownData, XZ } from "../../../src/world/format";
import { BLOCKED, OBJECT_KINDS, RAMP } from "../../../src/world/format";
import { TOWN_LIMITS, lintTown } from "../../../src/world/lint";
import { inSquare, streetTiles } from "../../../src/world/streets";
import { Use } from "../land";
import { formOf } from "./forms";
import type { Ctx } from "./index";
import { HEADINGS, buildingHides, propHides } from "./view";
import type { TownGroundsData, TownReport } from "./types";
import { TOWN_SIZE } from "./forms";
import { STEP } from "./terrain";
import { FOOTPATH } from "./passages";
import { isOrganic } from "./organic";
import { S } from "../ids";

/** What stands tall enough to hide anything: measured for the camera. */
const TALL = new Set([
  "tree",
  "oak",
  "birch",
  "pine",
  "elf-tree",
  "great-tree",
  "giant-tree",
  "fruit-tree",
  "snowy-fir",
  "dead-tree",
  "mossy-dead-tree",
  "swamp-tree",
  "cypress",
  "palm",
  "lush-tree",
  "statue",
  "fountain",
  "well",
  "lamp-post",
  "torch-post",
  "lantern-post",
  "banner-pole",
  "canopy-stall",
  "market-stall",
  "tree-platform",
  "wall-run",
  "wall-tower",
  "quest-board",
  "arena-gate",
  "crystal",
  "giant-mushroom",
  "palisade",
]);

/** Whether a walker steps from one tile to a side-by-side one: no more than a hop between them, or both ramps. */
function passes(ctx: Ctx, i: number, j: number): boolean {
  const { land } = ctx;
  return (land.flags[i]! & land.flags[j]! & RAMP) !== 0 || Math.abs(land.height[i]! - land.height[j]!) <= STEP;
}

/** The tiles walked to from a tile: eight ways, never cutting a closed corner, a hop straight across only. */
export function walkedFrom(ctx: Ctx, from: number): Uint8Array {
  const { land } = ctx;
  const seen = new Uint8Array(land.size);
  const queue = new Int32Array(land.size);
  let head = 0;
  let tail = 0;
  seen[from] = 1;
  queue[tail++] = from;
  const W = land.width;
  const level = (i: number, j: number) => Math.abs(land.height[i]! - land.height[j]!) <= 4 || (land.flags[i]! & land.flags[j]! & RAMP) !== 0;
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % W;
    const z = (i - x) / W;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (!land.inside(x + dx, z + dz)) continue;
        const j = i + dz * W + dx;
        if (seen[j] || !land.open(j)) continue;
        if (!dx || !dz) {
          if (!passes(ctx, i, j)) continue;
        } else {
          const a = i + dx;
          const b = i + dz * W;
          if (!land.open(a) || !land.open(b) || !level(i, a) || !level(a, j) || !level(i, b) || !level(b, j)) continue;
        }
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return seen;
}

/** Fills the country's pockets the woods closed off: open tiles nobody walks to get undergrowth. */
export function fillPockets(ctx: Ctx, from: number): number {
  const { land, plan } = ctx;
  const seen = walkedFrom(ctx, from);
  let filled = 0;
  for (let i = 0; i < land.size; i++) {
    if (seen[i] || !land.open(i)) continue;
    const x = land.xOf(i);
    const z = land.zOf(i);
    // The town's ways and open ground are walked to or the checks say; anything else nobody reaches is overgrown.
    const u = land.use[i];
    if (u === Use.Road || u === Use.Dock || u === Use.Street || u === Use.Kept || u === Use.Door) continue;
    void plan;
    land.put(i, { id: land.isWater(i) ? "reeds" : "undergrowth", x: x + 0.5, z: z + 0.5, seed: i % 16 }, true);
    land.flags[i] = BLOCKED | 2;
    filled++;
  }
  return filled;
}

export function check(ctx: Ctx, data: TownGroundsData, gateNodes: readonly XZ[], lenient = false): TownReport {
  const { land, plan, town } = ctx;
  const problems: string[] = [];
  const notes = ctx.notes;
  const I = (x: number, z: number) => land.idx(x, z);
  const inside = (x: number, z: number) => land.inside(x, z);
  const box = plan.box;
  const inBox = (x: number, z: number) => x >= box.x0 && x < box.x1 && z >= box.z0 && z < box.z1;
  const townBuildings = ctx.buildings.filter((b) => inBox(b.x, b.z));

  // The plan.
  const open = (x: number, z: number) => inside(x, z) && land.open(I(x, z));
  const asTown = data as unknown as TownData;
  for (const p of lintTown(asTown, open, ctx.buildings, TOWN_LIMITS)) problems.push(p);
  const tiles = streetTiles(data.plan!);
  const isStreet = (x: number, z: number) => tiles.has(`${x},${z}`);
  // Streets three tiles wide at the least; a footpath through the yards (passages.ts) two.
  for (const w of data.plan!.ways) if (w.width < (w.main ? 3 : FOOTPATH)) problems.push(`a way ${w.width} tiles wide (${w.main ? 3 : FOOTPATH} at the least)`);

  // Fronts.
  for (const b of ctx.buildings) {
    if (b.rot === 2) problems.push(`${b.id} faces north, away from the camera`);
    if ((b.interior || b.sign) && b.rot !== 0) problems.push(`${b.id} has a door that matters and does not face south`);
  }
  // Every building in the town has its door on a street: the tile before its front's middle.
  for (const b of townBuildings) {
    if (b.id.includes("citadel") || b.id.includes("keep") || b.id.endsWith("-manor") || b.id.includes("mausoleum")) continue;
    const door: XZ = b.door ?? [b.x + Math.floor(b.w / 2), b.z + b.d];
    if (!isStreet(door[0], door[1])) problems.push(`${b.id}'s door at ${door.join(",")} opens onto no street`);
  }

  // The camera: what hides doors and streets.
  const doors = new Map<number, string>();
  for (const b of ctx.buildings) if (b.door) doors.set(I(b.door[0], b.door[1]), b.id);
  const exempt = new Uint8Array(land.size);
  for (const g of plan.gates) {
    const [dx, dz] = g.side === "south" ? [0, -1] : g.side === "north" ? [0, 1] : g.side === "west" ? [1, 0] : [-1, 0];
    for (let s = -4; s <= 5; s++) for (let z = g.passage.z0 - 2; z < g.passage.z1 + 2; z++) for (let x = g.passage.x0 - 2; x < g.passage.x1 + 2; x++) if (inside(x + dx * s, z + dz * s)) exempt[I(x + dx * s, z + dz * s)] = 1;
  }
  const hiddenStreet = new Map<number, string>();
  const doorHidden: string[] = [];
  const occlude = (what: string, hides: (h: (typeof HEADINGS)[number]) => [number, number][], own?: number, doorsOnly = false) => {
    for (const h of HEADINGS) {
      for (const [x, z] of hides(h)) {
        if (!inside(x, z)) continue;
        const i = I(x, z);
        if (doors.has(i) && i !== own) {
          const msg = `the door of ${doors.get(i)} is hidden by ${what} from the ${h === 0 ? "front" : h < 0 ? "left" : "right"}`;
          if (h === 0) problems.push(msg);
          else doorHidden.push(msg);
        }
        if (!doorsOnly && h === 0 && inBox(x, z) && isStreet(x, z) && !exempt[i] && !hiddenStreet.has(i)) hiddenStreet.set(i, what);
      }
    }
  };
  for (const b of ctx.buildings) {
    if (!inBox(b.x, b.z) && !inBox(b.x + b.w - 1, b.z + b.d - 1)) continue;
    occlude(b.id, (h) => buildingHides(b, h), b.door ? I(b.door[0], b.door[1]) : undefined);
  }
  const standing: PropData[] = [...land.fixtures, ...land.decor.values()].filter((p) => TALL.has(p.id) && inBox(Math.floor(p.x), Math.floor(p.z)));
  for (const p of standing) {
    if (p.id === "wall-run" || p.id === "wall-tower" || p.id === "palisade") {
      // A wall hides its own side of the town only where it runs: its corner towers and runs are set pieces, whose
      // shadow over the lane beside them is counted but never fails.
      continue;
    }
    // The square's own furniture (its centrepiece, lamps, stalls) stands in it: what it hides of the square is the
    // square's; only a door it hid would count.
    const sq0 = plan.square;
    const furniture = p.x >= sq0.x0 && p.x < sq0.x1 && p.z >= sq0.z0 && p.z < sq0.z1;
    occlude(p.id, (h) => propHides(p, h), undefined, furniture);
  }
  let streetCount = 0;
  for (let z = box.z0; z < box.z1; z++) for (let x = box.x0; x < box.x1; x++) if (isStreet(x, z) && land.open(I(x, z))) streetCount++;
  if (hiddenStreet.size > 0) {
    const by = new Map<string, number>();
    for (const w of hiddenStreet.values()) by.set(w, (by.get(w) ?? 0) + 1);
    const worst = [...by].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w, n]) => `${w} (${n})`).join(", ");
    const share = hiddenStreet.size / Math.max(1, streetCount);
    const msg = `${hiddenStreet.size} street tiles of ${streetCount} hidden from the front: ${worst}`;
    if (share > 0.01) problems.push(msg);
    else notes.push(msg);
  }
  if (doorHidden.length > 0) notes.push(`${doorHidden.length} doors hidden at a turned heading (${doorHidden.slice(0, 2).join("; ")})`);

  // The square: a room with three walls, open to the south.
  const sq = plan.square;
  // Each column's north edge of the square (a round one's ellipse): a front there - a building facing south whose front
  // stands on it, or no more than a path's width north of it where the square is round (a glade's, a green's), or the
  // wall of a landmark's ground (a keep's, a manor's) - is its north side.
  const square = data.plan!.squares[0]!;
  const topOf = (x: number) => {
    for (let z = sq.z0; z < sq.z1; z++) if (inSquare(square, x, z)) return z;
    return null;
  };
  let north = 0;
  let columns = 0;
  // A round centre's north side is the top of its curve: its middle three fifths across (its ends run down its east and west).
  const side0 = square.round ? sq.x0 + Math.floor((sq.x1 - sq.x0) * 0.2) : sq.x0;
  const side1 = square.round ? sq.x1 - Math.floor((sq.x1 - sq.x0) * 0.2) : sq.x1;
  for (let x = side0; x < side1; x++) {
    const top = topOf(x);
    if (top === null) continue;
    columns++;
    const reach = square.round ? 3 : 0;
    const fronted = townBuildings.some((b) => b.rot === 0 && b.z + b.d <= top && b.z + b.d >= top - reach && x >= b.x && x < b.x + b.w) || plan.sites.some((s) => !s.id.endsWith("-temple") && !s.id.endsWith("-shrine") && s.box.z1 === top && x >= s.box.x0 && x < s.box.x1);
    if (fronted) north++;
  }
  const sideFilled = (x0: number, x1: number) => {
    let n = 0;
    for (let z = sq.z0; z < sq.z1; z++) if (townBuildings.some((b) => b.x < x1 && b.x + b.w > x0 && z >= b.z && z < b.z + b.d)) n++;
    return n / (sq.z1 - sq.z0);
  };
  const northShare = north / Math.max(1, columns);
  if (northShare < 0.4) problems.push(`the square's north side is ${Math.round(northShare * 100)}% fronts`);
  const west = sideFilled(sq.x0 - 8, sq.x0);
  const east = sideFilled(sq.x1, sq.x1 + 8);
  if (west < 0.25 || east < 0.25) notes.push(`the square's sides are ${Math.round(west * 100)}% and ${Math.round(east * 100)}% built`);
  for (const b of townBuildings) if (b.x < sq.x1 && b.x + b.w > sq.x0 && b.z >= sq.z1 && b.z < sq.z1 + 3) problems.push(`${b.id} closes the square's south side`);
  const PIECES = new Set(["statue", "fountain", "well", "crystal", "giant-tree", "fire-bowl"]);
  if (!land.fixtures.some((p) => PIECES.has(p.id) && p.x >= sq.x0 && p.x < sq.x1 && p.z >= sq.z0 && p.z < sq.z1 + 1)) problems.push(`its square has no ${town.centrepiece}`);

  // Walks: from the gates to the square, from the square to every key place; the inn nearest the main gate.
  const walk = (from: readonly XZ[]): Map<number, number> => {
    const dist = new Map<number, number>();
    const heap: [number, number][] = [];
    const push = (d: number, i: number) => {
      heap.push([d, i]);
      for (let k = heap.length - 1; k > 0; ) {
        const p = (k - 1) >> 1;
        if (heap[p]![0] <= heap[k]![0]) break;
        [heap[p], heap[k]] = [heap[k]!, heap[p]!];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let k = 0; ; ) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k]!, heap[m]!];
          k = m;
        }
      }
      return top;
    };
    const ok = (x: number, z: number) => isStreet(x, z) && open(x, z);
    for (const [x, z] of from) if (ok(x, z)) {
      dist.set(I(x, z), 0);
      push(0, I(x, z));
    }
    while (heap.length > 0) {
      const [d, i] = pop();
      if (d > dist.get(i)!) continue;
      const x = land.xOf(i);
      const z = land.zOf(i);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || !ok(x + dx, z + dz)) continue;
        if (dx && dz && !(ok(x + dx, z) && ok(x, z + dz))) continue;
        const j = I(x + dx, z + dz);
        const nd = d + (dx && dz ? Math.SQRT2 : 1);
        if (nd < (dist.get(j) ?? Infinity)) {
          dist.set(j, nd);
          push(nd, j);
        }
      }
    }
    return dist;
  };
  const squareTiles: XZ[] = [];
  for (let z = sq.z0; z < sq.z1; z++) for (let x = sq.x0; x < sq.x1; x++) squareTiles.push([x, z]);
  const fromSquare = walk(squareTiles);
  const near = (p: XZ) => {
    let best = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (inside(p[0] + dx, p[1] + dz)) best = Math.min(best, fromSquare.get(I(p[0] + dx, p[1] + dz)) ?? Infinity);
    return best;
  };
  let gateToSquare = 0;
  for (const g of gateNodes) gateToSquare = Math.max(gateToSquare, near(g));
  const limit = town.kind === "capital" ? 48 : town.kind === "town" ? 36 : 22;
  let squareToPlace = 0;
  for (const p of data.plan!.places) {
    const d = near([p.x, p.z]);
    if (p.kind !== "arena") squareToPlace = Math.max(squareToPlace, d);
    if (d > limit && p.kind !== "arena") problems.push(`${p.name} is ${Math.round(d)} tiles' walk from the square (${limit} at the most)`);
  }
  // Places close by (under `apart`, which lintTown leaves): no walk between them longer than the way round a block.
  {
    const keyPlaces = data.plan!.places.filter((p) => p.kind !== "pitch");
    for (let i = 0; i < keyPlaces.length; i++) {
      const p = keyPlaces[i]!;
      const from = walk([[p.x, p.z], ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [p.x + dx!, p.z + dz!] as XZ)]);
      for (const q of keyPlaces.slice(i + 1)) {
        const straight = Math.hypot(p.x - q.x, p.z - q.z);
        if (straight >= TOWN_LIMITS.apart || straight < 6) continue;
        let walked = Infinity;
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) walked = Math.min(walked, from.get(I(q.x + dx!, q.z + dz!)) ?? Infinity);
        if (walked > straight + 30) problems.push(`from ${p.name} to ${q.name} is ${Math.round(walked)} tiles along the streets for ${Math.round(straight)} between them`);
      }
    }
  }
  const mainGate = plan.gates.find((g) => g.main) ?? plan.gates[0]!;
  const fromMain = walk([mainGate.node]);
  const walkTo = (p: XZ) => {
    let best = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (inside(p[0] + dx, p[1] + dz)) best = Math.min(best, fromMain.get(I(p[0] + dx, p[1] + dz)) ?? Infinity);
    return best;
  };
  const innPlace = data.plan!.places.find((p) => p.kind === "inn");
  const toInn = innPlace ? walkTo([innPlace.x, innPlace.z]) : Infinity;
  const toSquare = Math.min(...squareTiles.map(([x, z]) => fromMain.get(I(x, z)) ?? Infinity));
  // The inn by the main arrival: no further than a block past where the square begins, or than the square's far side
  // (the inn fronting the square across from the way in, seen as one comes in).
  // The square's far side from the way in: its north edge for a gate in the south, its south edge for one in the north,
  // the edge across from an east or west gate.
  const far = mainGate.side === "south" ? ([, z]: XZ) => z === sq.z0 : mainGate.side === "north" ? ([, z]: XZ) => z === sq.z1 - 1 : mainGate.side === "east" ? ([x]: XZ) => x === sq.x0 : ([x]: XZ) => x === sq.x1 - 1;
  const farSide = Math.min(...squareTiles.filter(far).map(([x, z]) => fromMain.get(I(x, z)) ?? Infinity));
  if (innPlace && toInn > Math.max(toSquare + 20, farSide + 8)) problems.push(`the inn is ${Math.round(toInn)} tiles from the main gate, the square ${Math.round(toSquare)}`);

  // Terraces: a hop at most between open neighbours; nothing walled in a pocket.
  let cliffs = 0;
  let cliffAt = "";
  for (let i = 0; i < land.size; i++) {
    if (!land.open(i)) continue;
    const x = land.xOf(i);
    const z = land.zOf(i);
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
    ] as const) {
      if (!inside(x + dx, z + dz)) continue;
      const j = I(x + dx, z + dz);
      if (land.open(j) && !passes(ctx, i, j)) {
        cliffs++;
        cliffAt ||= `${x},${z} (${land.height[i]}) to ${x + dx},${z + dz} (${land.height[j]})`;
      }
    }
  }
  if (cliffs > 0) problems.push(`${cliffs} edges between open tiles climb more than a hop (one from ${cliffAt})`);
  const start = I(mainGate.node[0], mainGate.node[1]);
  const seen = walkedFrom(ctx, start);
  let stranded = 0;
  let at = "";
  for (let i = 0; i < land.size; i++) {
    if (!land.open(i) || seen[i]) continue;
    stranded++;
    at ||= `${land.xOf(i)},${land.zOf(i)}`;
  }
  if (stranded > 0) problems.push(`${stranded} open tiles nobody walks to (one at ${at})`);
  // The walked ground's edge: only the exits open, each walked to, its inside on its road.
  for (const w of ctx.ways) {
    for (const [x, z] of w.exit) if (!seen[I(x, z)]) problems.push(`the ${w.side} exit at ${x},${z} is not walked to`);
    if (!seen[I(w.inside[0], w.inside[1])] || land.use[I(w.inside[0], w.inside[1])] !== Use.Road) problems.push(`the ${w.side} way's inside at ${w.inside.join(",")} is not on its road`);
  }
  if (ctx.ways.length !== ctx.spec.setting.ways.length) problems.push(`${ctx.ways.length} ways for the setting's ${ctx.spec.setting.ways.length}`);

  // The places a town must hold.
  const count = (kind: string) => data.plan!.places.filter((p) => p.kind === kind).length;
  const village = town.kind === "village";
  const want: [string, number][] = [
    ["inn", 1],
    ["shop", ctx.spec.vendors.length],
    ["exotic-wares", ctx.spec.exotic ? 1 : 0],
    [village ? "shrine" : "temple", 1],
    ["guildhall", village ? 0 : 1],
    [town.style === "tolarian" ? "tower" : "library", village ? 0 : 1],
    ["smithy", village ? 0 : 1],
    ["quest-board", 1],
    ["arena", village ? 0 : 1],
    ["pitch", town.caravan ? 1 : 0],
  ];
  for (const [kind, n] of want) if (count(kind) !== n) problems.push(`${count(kind)} ${kind} for ${n}`);
  const homes = ctx.interiors.filter((r) => r.kind === "house").length;
  const wantHomes = formOf(town) === "capital" ? 10 : village ? 3 : 6;
  if (homes !== wantHomes) problems.push(`${homes} houses with a door for ${wantHomes}`);

  // A grown town (amphitheatre.ts): its form's signature, fronts that step, and no long way round between neighbours.
  if (isOrganic(plan)) {
    const form = formOf(town);
    const centre = data.plan!.squares[0]!;
    const facing = townBuildings.filter((b) => b.rot === 0);
    // The head of the centre: the temple, the shrine, the great hall - its door on the centre's north edge, on its axis.
    const head = ctx.buildings.find((b) => b.interior === `${town.id}-temple` || b.interior === `${town.id}-shrine`);
    const axis = centre.x + centre.w / 2;
    if (!head || !head.door || Math.abs(head.door[0] - axis) > centre.w / 2 || head.door[1] > centre.z + 3 || head.door[1] < centre.z - 3) problems.push(`its ${form === "clan" ? "great hall" : form === "elfhame" ? "Grove" : "shrine or temple"} does not stand at the head of its ${centre.name ?? "centre"}`);
    // An arc round the centre's north, east and west: fronts north of its middle on both sides of its axis, stepping.
    const arc = facing.filter((b) => b.z + b.d <= centre.z + centre.d / 2 + 2 && Math.abs(b.x + b.w / 2 - axis) <= centre.w / 2 + 16);
    if (!arc.some((b) => b.x + b.w / 2 < axis - 2) || !arc.some((b) => b.x + b.w / 2 > axis + 2)) problems.push(`no arc of fronts round its ${centre.name ?? "centre"} on both sides`);
    // Fronts off any common line: no one row holds the fronts of most of its buildings.
    const rows = new Map<number, number>();
    for (const b of facing) rows.set(b.z + b.d, (rows.get(b.z + b.d) ?? 0) + 1);
    const most = Math.max(0, ...rows.values());
    if (facing.length >= 5 && most > Math.max(2, facing.length * 0.4)) problems.push(`${most} of its ${facing.length} fronts on one line (row ${[...rows].find(([, n]) => n === most)![0]})`);
    if (form === "elfhame") {
      if (!centre.round) problems.push("its glade is not round");
      if (ctx.F.enclosure !== "none" || ctx.props.some((p) => p.id === "wall-run")) problems.push("an elfhame with a wall");
      const trees = [...land.decor.values()].filter((p) => (p.id === "great-tree" || p.id === "elf-tree") && inBox(Math.floor(p.x), Math.floor(p.z))).length;
      if (trees < 12) problems.push(`only ${trees} great trees about its glade`);
    }
    if (form === "clan") {
      if (ctx.F.enclosure !== "palisade") problems.push("a clan hold with no palisade");
      // An oval: its outline turns often, no straight side longer than half its width.
      const o = data.plan!.outline;
      let longest = 0;
      for (let k = 0; k < o.length; k++) longest = Math.max(longest, Math.abs(o[k]![0] - o[(k + 1) % o.length]![0]) + Math.abs(o[k]![1] - o[(k + 1) % o.length]![1]));
      const xs = o.map(([x]) => x);
      if (longest > (Math.max(...xs) - Math.min(...xs)) * 0.6) problems.push(`its palisade runs ${longest} tiles straight: no oval`);
    }
    if (form === "stilts") {
      // No ground street: every way is boardwalk, everything else bog or water.
      let ground = 0;
      for (const k of tiles) {
        const [x, z] = k.split(",").map(Number) as [number, number];
        if (!inside(x, z) || ctx.inTown[I(x, z)] !== 1) continue;
        if (land.surface[I(x, z)] !== S.planks && !land.isWater(I(x, z))) ground++;
      }
      if (ground > 0) problems.push(`${ground} tiles of its ways on solid ground, not boardwalk`);
    }
    if (form === "village" && !(centre.round && land.surface[I(centre.x + Math.floor(centre.w / 2), centre.z + Math.floor(centre.d / 2))] === S.grass)) problems.push("no green");
    // Neighbours: from every door to the nearest other, no long way round.
    const doorsAll = ctx.buildings.filter((b) => b.door && inBox(b.door[0], b.door[1])).map((b) => b.door!);
    for (const d of doorsAll) {
      const others = doorsAll.filter((e) => e !== d).map((e) => ({ e, s: Math.hypot(e[0] - d[0], e[1] - d[1]) })).filter((o) => o.s >= 4).sort((p, q) => p.s - q.s);
      const n = others[0];
      if (!n) continue;
      const from = walk([d]);
      const walked = from.get(I(n.e[0], n.e[1])) ?? Infinity;
      if (walked > n.s * 2 + 8) problems.push(`from the door at ${d.join(",")} to its nearest neighbour's at ${n.e.join(",")} is ${Math.round(walked)} tiles for ${Math.round(n.s)}: no path through the yards`);
    }
  }

  // What is used from beside it.
  for (const n of ctx.npcs) {
    if (!OBJECT_KINDS.has(n.kind)) {
      if (!open(n.x, n.z)) problems.push(`${n.id} stands on a closed tile`);
      continue;
    }
    if (open(n.x, n.z)) problems.push(`${n.id} stands on an open tile`);
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isStreet(n.x + dx!, n.z + dz!) && open(n.x + dx!, n.z + dz!))) problems.push(`${n.id} has no street beside it`);
  }
  // Everything names art there is: every prop's id and palette, every building's style and palette.
  for (const p of [...land.fixtures, ...land.decor.values()]) {
    if (!PROPS.has(p.id)) problems.push(`a prop ${p.id} the art does not have`);
    if (p.tint && !PALETTES.has(p.tint)) problems.push(`${p.id} tinted ${p.tint}, no palette of the art's`);
  }
  for (const b of ctx.buildings) {
    if (!BUILDINGS.has(b.style)) problems.push(`${b.id} in a style ${b.style} the art does not have`);
    if (b.palette && !PALETTES.has(b.palette)) problems.push(`${b.id} in a palette ${b.palette} the art does not have`);
  }
  // Buildings apart.
  const owner = new Map<number, string>();
  for (const b of ctx.buildings) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = I(x, z);
    if (owner.has(i)) problems.push(`${b.id} stands on ${owner.get(i)}`);
    owner.set(i, b.id);
  }
  if (problems.length > 0) {
    const text = `${town.id}: the town breaks its rules:\n  ${[...new Set(problems)].slice(0, 30).join("\n  ")}`;
    if (!lenient) throw new Error(text);
    notes.push(`BROKEN: ${text}`);
  }
  const [TW, TD] = TOWN_SIZE[town.kind];
  return { walled: [TW, TD], grounds: [land.width, land.depth], buildings: townBuildings.length, interiors: ctx.interiors.length, gateToSquare: Math.round(gateToSquare), squareToPlace: Math.round(squareToPlace), notes: [...notes] };
}

export type { BuildingData };
