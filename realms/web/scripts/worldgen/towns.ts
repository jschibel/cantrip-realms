// Towns (design.md A6): a walled hexagon with a gate toward every road that leaves it, streets from the gates to the
// square, ring streets and lanes, districts round them - the square's inn, shops, temple and guildhall, the smithy by
// a gate, houses and tenements beyond, warehouses and a pier where there is water - each building a box facing its
// street, its door between it and the street. A building with a door gets an interior (interiors.ts).

import { DIRECTIONS, type Hex, hex, toWorld } from "../../src/hex";
import type { BuildingUse, Front, InteriorKind, NpcData, Region, TownData, TownStyle } from "../../src/world/schema";
import { Grid, STEP, T, Use, angleGap, angleOf, around, disc, hexDistance, hexOf, idx, inside, line, qOf, randomFor, rOf, ringOf, safeToBlock, shuffle } from "./grid";
import type { TownLayout as TownPlan } from "./layout";

export interface Building {
  readonly use: BuildingUse;
  readonly anchor: number;
  readonly front: Front;
  /** Size along x and z, world units. */
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly footprint: readonly number[];
  readonly door: number | null;
  /** The street hex in front of the door. */
  readonly exit: number;
}

export interface InteriorSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: InteriorKind;
  readonly town: string;
  readonly style: TownStyle;
  readonly exit: Hex;
  readonly door: Hex;
  readonly vendor?: { readonly id: string; readonly name: string };
  readonly armorer?: boolean;
  readonly innkeeper?: { readonly name: string; readonly text: readonly string[] };
  readonly spellTable?: boolean;
  readonly resident?: { readonly name: string; readonly text: readonly string[] };
  /** An exotic wares shop's: dressed in curios from other planes. */
  readonly exotic?: boolean;
}

export interface BuiltTown {
  readonly data: TownData;
  readonly buildings: Building[];
  readonly interiors: InteriorSpec[];
  readonly doors: { q: number; r: number; interior: string }[];
  readonly npcs: NpcData[];
  /** Outside each gate, by the target it was made for. */
  readonly gates: Map<string, number>;
  readonly inn: { q: number; r: number; interior: string };
  /** Where traveling vendors' caravans pitch, if the town has one. */
  readonly pitch: { q: number; r: number } | null;
}

interface Ground {
  readonly lot: keyof typeof T;
  readonly street: keyof typeof T;
  readonly square: keyof typeof T;
}

const GROUNDS: Record<TownStyle, Ground> = {
  argive: { lot: "grass", street: "cobble", square: "marble" },
  benalish: { lot: "meadow", street: "cobble", square: "marble" },
  tolarian: { lot: "sand", street: "stone", square: "crystal" },
  urborg: { lot: "mud", street: "wood", square: "stone" },
  keldon: { lot: "dirt", street: "stone", square: "rock" },
  llanowar: { lot: "moss", street: "dirt", square: "meadow" },
};

/** Footprints, world units: across the front, then deep; and how tall. */
const SIZES: Record<BuildingUse, readonly (readonly [number, number, number])[]> = {
  house: [[3, 3, 2], [3.2, 3.6, 2.2], [4.2, 3, 2]],
  tenement: [[3.2, 4.6, 3.6], [4.6, 3.2, 3.2]],
  shop: [[4.4, 3.6, 2.6], [4.8, 4, 2.8]],
  inn: [[6.2, 4.8, 3.4], [5.6, 5, 3.2]],
  temple: [[6, 7.4, 4.6], [5.6, 6.6, 4.2]],
  guildhall: [[7.2, 5.6, 4], [6.4, 5.6, 3.8]],
  smithy: [[4.6, 4.4, 2.4], [4.2, 4.2, 2.4]],
  library: [[6, 5.6, 4], [5.6, 5.2, 3.8]],
  "mage-tower": [[4, 4, 8], [3.6, 3.6, 7]],
  warehouse: [[7.4, 4.6, 3], [6.2, 4.6, 3.2]],
};

const INTERIOR_OF: Partial<Record<BuildingUse, InteriorKind>> = {
  house: "house",
  shop: "shop",
  inn: "inn",
  temple: "temple",
  guildhall: "guildhall",
  smithy: "smithy",
  library: "library",
  "mage-tower": "tower",
};

const NORMALS: Record<Front, { x: number; z: number }> = { "x+": { x: 1, z: 0 }, "x-": { x: -1, z: 0 }, "z+": { x: 0, z: 1 }, "z-": { x: 0, z: -1 } };
const FRONT_LIST: readonly Front[] = ["x+", "x-", "z+", "z-"];

const worldOf = (i: number) => toWorld(hexOf(i));

/** The hex nearest a point of the ground plane. */
function hexAtPoint(x: number, z: number): Hex {
  const q = (2 / 3) * x;
  const r = (-1 / 3) * x + (Math.sqrt(3) / 3) * z;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  if (Math.abs(rq - q) > Math.abs(rr - r) && Math.abs(rq - q) > Math.abs(rs - s)) rq = -rr - rs;
  else if (Math.abs(rr - r) > Math.abs(rs - s)) rr = -rq - rs;
  return hex(rq + 0, rr + 0);
}

/** The hexes a box of `w` by `d` round a hex covers: those whose centres it all but reaches. */
export function footprintOf(anchor: Hex, w: number, d: number): number[] {
  const { x, z } = toWorld(anchor);
  const found: number[] = [];
  const reach = Math.ceil(Math.max(w, d) / 1.5) + 1;
  for (const i of disc(anchor, reach)) {
    const p = worldOf(i);
    if (Math.abs(p.x - x) <= w / 2 + 0.3 && Math.abs(p.z - z) <= d / 2 + 0.3) found.push(i);
  }
  return found;
}

interface Site {
  readonly street: number;
  readonly door: number;
  readonly front: Front;
}

export function buildTown(grid: Grid, plan: TownPlan, color: Region | null, index: number, centre: Hex, targets: readonly { id: string; at: Hex }[], seed: number, vendors: readonly { id: string; name: string }[]): BuiltTown {
  const random = randomFor(seed, `town:${plan.id}`);
  const R = plan.radius;
  const ground = GROUNDS[plan.style];
  const C = idx(centre.q, centre.r);
  const tag = index + 1;
  const distC = (i: number) => hexDistance(qOf(i), rOf(i), centre.q, centre.r);
  const level = STEP;

  // Water near the walls makes a harbour: the direction with the most of it.
  let harbour: number | null = null;
  {
    let most = 0;
    for (let a = 0; a < 360; a += 15) {
      let water = 0;
      for (let s = R + 3; s <= R + 16; s++) {
        const h = atAngleFrom(centre, a, s);
        if (inside(h.q, h.r) && grid.isWater(idx(h.q, h.r)) && grid.terrain[idx(h.q, h.r)] !== T.lava) water++;
      }
      if (water > most) {
        most = water;
        harbour = a;
      }
    }
    if (most < 6) harbour = null;
  }

  // The ground: levelled and cleared inside, an apron cleared outside.
  for (const i of disc(centre, R + 6)) {
    const d = distC(i);
    if (d <= R + 2) {
      if (d > R && grid.isWater(i)) continue;
      grid.props.delete(i);
      grid.blocked[i] = 0;
      grid.terrain[i] = d <= R ? T[ground.lot] : grid.isWater(i) ? T.grass : grid.terrain[i]!;
      grid.height[i] = level;
      grid.use[i] = d <= R ? Use.Lot : Use.Kept;
      grid.town[i] = tag;
    } else if (!grid.isWater(i)) {
      grid.height[i] = Math.min(grid.height[i]!, STEP * 2);
      if (grid.terrain[i] === T.mountain) {
        grid.terrain[i] = T.rock;
        grid.blocked[i] = 0;
      }
    }
  }

  const street = (i: number, terrain: keyof typeof T = ground.street) => {
    if (grid.use[i] === Use.Wall) return;
    grid.use[i] = Use.Street;
    grid.terrain[i] = T[terrain];
    grid.blocked[i] = 0;
    grid.props.delete(i);
  };
  const kept = (i: number, terrain: keyof typeof T) => {
    grid.use[i] = Use.Kept;
    grid.terrain[i] = T[terrain];
    grid.blocked[i] = 0;
    grid.props.delete(i);
  };

  // The walls and their corner towers.
  const ring = ringOf(centre, R);
  for (const h of ring) {
    const i = idx(h.q, h.r);
    grid.use[i] = Use.Wall;
    grid.terrain[i] = T[ground.street === "wood" ? "wood" : "stone"];
    grid.prop(i, { kind: "wall", style: plan.style });
  }
  for (let side = 0; side < 6; side++) {
    const corner = hex(centre.q + DIRECTIONS[(side + 4) % 6]!.q * R, centre.r + DIRECTIONS[(side + 4) % 6]!.r * R);
    grid.prop(idx(corner.q, corner.r), { kind: "tower", style: plan.style });
  }

  // Gates toward the roads (and the harbour), kept apart and off the corners.
  const gates = new Map<string, number>();
  const gateHexes: Hex[] = [];
  const outside = (g: Hex) => {
    const gi = idx(g.q, g.r);
    return around(gi).filter((n) => distC(n) === R + 1).sort((a, b) => a - b)[0] ?? gi;
  };
  const wantGate = (id: string, angle: number) => {
    // A road that leaves near an existing gate shares it.
    const shared = gateHexes.find((g) => angleGap(angleOf(centre, g), angle) < 32);
    if (shared) {
      gates.set(id, outside(shared));
      return;
    }
    let best: Hex | null = null;
    let bestGap = Infinity;
    for (const h of ring) {
      const corner = (Math.abs(h.q - centre.q) === R || Math.abs(h.r - centre.r) === R || Math.abs(h.q + h.r - centre.q - centre.r) === R)
        && [Math.abs(h.q - centre.q), Math.abs(h.r - centre.r), Math.abs(h.q + h.r - centre.q - centre.r)].filter((v) => v === R).length >= 2;
      if (corner) continue;
      if (gateHexes.some((g) => hexDistance(g.q, g.r, h.q, h.r) < Math.max(5, R / 3))) continue;
      const gap = angleGap(angleOf(centre, h), angle);
      if (gap < bestGap) {
        bestGap = gap;
        best = h;
      }
    }
    if (!best) throw new Error(`${plan.id}: no room for a gate toward ${id}`);
    gateHexes.push(best);
    gates.set(id, outside(best));
  };
  for (const t of targets) wantGate(t.id, angleOf(centre, t.at));
  if (harbour !== null) wantGate("harbour", harbour);
  for (const g of gateHexes) {
    const gi = idx(g.q, g.r);
    const width = plan.kind === "village" ? [gi] : [gi, ...around(gi).filter((n) => grid.use[n] === Use.Wall)];
    for (const w of width) {
      grid.props.delete(w);
      grid.blocked[w] = 0;
      grid.use[w] = Use.Street;
      grid.terrain[w] = T[ground.street];
    }
    const angle = angleOf(centre, g);
    grid.prop(gi, { kind: "gate", style: plan.style, front: frontToward(angle) }, false);
    for (const w of around(gi)) if (grid.use[w] === Use.Wall && !width.includes(w)) grid.prop(w, { kind: "tower", style: plan.style });
    for (const n of around(gi)) if (distC(n) === R + 1) street(n);
  }

  // Streets: the lane inside the walls, the square, streets from the square to the gates, rings and spokes.
  for (const h of ringOf(centre, R - 1)) street(idx(h.q, h.r));
  const S = plan.kind === "capital" ? 9 : plan.kind === "town" ? 6 : 3;
  for (const i of disc(centre, S)) kept(i, ground.square);
  const wide = plan.kind === "village" ? 0 : 1;
  const road = (a: Hex, b: Hex, width: number) => {
    for (const h of line(a, b)) for (const w of width ? disc(h, width) : [idx(h.q, h.r)]) if (grid.use[w] !== Use.Kept && distC(w) < R) street(w);
  };
  for (const g of gateHexes) road(centre, g, wide);
  if (plan.kind === "capital") {
    for (const f of [0.38, 0.7]) for (const h of ringOf(centre, Math.round(R * f))) street(idx(h.q, h.r));
    for (let side = 0; side < 6; side++) road(centre, hex(centre.q + DIRECTIONS[side]!.q * (R - 1), centre.r + DIRECTIONS[side]!.r * (R - 1)), 0);
    for (let side = 0; side < 6; side++) {
      // Lanes between the spokes, from the inner ring to the lane.
      const a = 30 + side * 60;
      road(atAngleFrom(centre, a + 15, Math.round(R * 0.38)), atAngleFrom(centre, a + 15, R - 1), 0);
    }
  } else if (plan.kind === "town") {
    for (const h of ringOf(centre, Math.round(R * 0.55))) street(idx(h.q, h.r));
    for (let side = 0; side < 6; side += 2) road(centre, hex(centre.q + DIRECTIONS[side]!.q * (R - 1), centre.r + DIRECTIONS[side]!.r * (R - 1)), 0);
  }

  // The centrepiece, plazas: the arena's, and the capital's market.
  grid.prop(C, { kind: plan.centrepiece });
  const npcs: NpcData[] = [];
  const plaza = (at: Hex, radius: number, terrain: keyof typeof T) => {
    for (const i of disc(at, radius)) if (distC(i) < R - 1) kept(i, terrain);
  };
  if (plan.kind !== "village") {
    const at = atAngleFrom(centre, (harbour ?? 0) + 150, Math.round(R * (plan.kind === "capital" ? 0.55 : 0.75)));
    plaza(at, 3, ground.square);
    const ai = idx(at.q, at.r);
    grid.blocked[ai] = 1;
    npcs.push({ id: `${plan.id}-arena`, q: at.q, r: at.r, kind: "arena", name: "The arena", text: ["The arena is closed. A sign reads: coming soon."] });
    for (const h of ringOf(at, 3)) if ((h.q + h.r) % 2 === 0) grid.prop(idx(h.q, h.r), { kind: "pillar", style: plan.style });
  }
  let market: Hex | null = null;
  if (plan.kind === "capital") {
    market = atAngleFrom(centre, 300, Math.round(R * 0.55));
    plaza(market, 5, ground.square);
    for (const h of ringOf(market, 3)) if (random() < 0.4) grid.prop(idx(h.q, h.r), { kind: "stall", style: plan.style });
    grid.prop(idx(market.q, market.r), { kind: "well", style: plan.style });
  }

  // The harbour's pier, out from its gate into the water.
  if (harbour !== null && gates.has("harbour")) {
    const from = hexOf(gates.get("harbour")!);
    for (let s = 1; s <= 22; s++) {
      const h = atAngleFrom(from, harbour, s);
      if (!inside(h.q, h.r)) break;
      const i = idx(h.q, h.r);
      const wet = grid.isWater(i);
      grid.terrain[i] = T.wood;
      grid.blocked[i] = 0;
      grid.props.delete(i);
      grid.use[i] = Use.Kept;
      grid.height[i] = STEP;
      if (wet) {
        for (const n of around(i)) if (grid.isWater(n) && random() < 0.25) grid.prop(n, { kind: "dock" });
      }
      if (wet && s > 10 && !around(i).some((n) => grid.isWater(n) === false && grid.use[n] !== Use.Kept)) break;
    }
  }

  // Building sites: every way a building can face a street, its door between them.
  const sites: Site[] = [];
  for (const i of disc(centre, R - 1)) {
    if ((grid.use[i] !== Use.Street && grid.use[i] !== Use.Kept) || grid.blocked[i]) continue;
    const p = worldOf(i);
    for (const front of FRONT_LIST) {
      const n = NORMALS[front];
      let door = -1;
      let best = 0.55;
      for (const j of around(i)) {
        const q = worldOf(j);
        const dot = ((q.x - p.x) * -n.x + (q.z - p.z) * -n.z) / Math.sqrt(3);
        if (dot > best) {
          best = dot;
          door = j;
        }
      }
      if (door >= 0 && grid.use[door] === Use.Lot) sites.push({ street: i, door, front });
    }
  }

  const buildings: Building[] = [];
  const doorHexes = new Set<number>();
  const fits = (site: Site, size: readonly [number, number, number], withDoor: boolean): Building | null => {
    const [across, deep, tall] = size;
    const n = NORMALS[site.front];
    const along = n.x !== 0;
    const w = along ? deep : across;
    const d = along ? across : deep;
    const dp = worldOf(site.door);
    const extent = (along ? w : d) / 2;
    const anchor = hexAtPoint(dp.x - n.x * (extent + 0.55), dp.z - n.z * (extent + 0.55));
    if (!inside(anchor.q, anchor.r)) return null;
    const footprint = footprintOf(anchor, w, d);
    if (footprint.includes(site.door) || footprint.includes(site.street)) return null;
    if (!around(site.door).some((j) => footprint.includes(j))) return null;
    for (const f of footprint) {
      if (grid.use[f] !== Use.Lot || distC(f) > R - 2) return null;
      if (around(f).some((j) => doorHexes.has(j))) return null;
    }
    if (withDoor && around(site.door).some((j) => doorHexes.has(j))) return null;
    const anchorIndex = idx(anchor.q, anchor.r);
    return { use: "house", anchor: anchorIndex, front: site.front, w, d, h: tall, footprint, door: withDoor ? site.door : null, exit: site.street };
  };
  const place = (b: Building, use: BuildingUse, h: number): Building => {
    const placed = { ...b, use, h };
    for (const f of b.footprint) {
      grid.use[f] = Use.Building;
      grid.blocked[f] = 1;
      grid.props.delete(f);
    }
    if (b.door !== null) {
      grid.use[b.door] = Use.Door;
      doorHexes.add(b.door);
      grid.terrain[b.door] = T[ground.street];
    }
    grid.prop(b.anchor, { kind: "building", use, style: plan.style, w: round(b.w), d: round(b.d), h: round(h), front: b.front });
    buildings.push(placed);
    return placed;
  };
  /** The best site for a building near a point (and far from others of its kind). */
  const site = (use: BuildingUse, near: Hex, spread = 6): Building | null => {
    let best: { b: Building; score: number; size: readonly [number, number, number] } | null = null;
    for (const s of sites) {
      if (grid.use[s.door] !== Use.Lot) continue;
      const sp = hexOf(s.street);
      // Fronts toward the camera (+x, +z) are preferred, so a door and whoever stands at it are not hidden behind the building.
      const score = hexDistance(sp.q, sp.r, near.q, near.r) + random() * spread + (s.front === "x-" || s.front === "z-" ? 8 : 0);
      if (best && score >= best.score) continue;
      for (const size of SIZES[use]) {
        const b = fits(s, size, true);
        if (b) {
          best = { b, score, size };
          break;
        }
      }
    }
    return best ? place(best.b, use, best.size[2] + random() * 0.4) : null;
  };

  // What the town needs, in order: its inn and shops by the square, the guild and temple, the library, the smithy by
  // a gate, houses with doors; then the rest filled in.
  const interiors: InteriorSpec[] = [];
  const doors: BuiltTown["doors"] = [];
  const name = (b: Building, id: string, title: string, kind: InteriorKind, extra: Partial<InteriorSpec> = {}) => {
    const exit = hexOf(b.exit);
    const door = hexOf(b.door!);
    interiors.push({ id, name: title, kind, town: plan.id, style: plan.style, exit, door, ...extra });
    doors.push({ q: door.q, r: door.r, interior: id });
  };
  const inn = site("inn", centre, 2);
  if (!inn) throw new Error(`${plan.id}: no room for the inn`);
  name(inn, `${plan.id}-inn`, plan.inn, "inn", { innkeeper: { name: `The keeper of ${plan.inn}`, text: plan.innkeeper }, spellTable: true });
  vendors.forEach((v, k) => {
    const b = site("shop", market && k % 2 === 1 ? market : centre, 4);
    if (!b) throw new Error(`${plan.id}: no room for ${v.id}'s shop`);
    name(b, `${v.id}-shop`, v.name, "shop", { vendor: v });
  });
  if (plan.exotic) {
    const b = site("shop", market ?? centre, 4);
    if (!b) throw new Error(`${plan.id}: no room for the exotic wares shop`);
    name(b, `${plan.exotic}-shop`, "Wares from Beyond", "shop", { vendor: { id: plan.exotic, name: "Wares from Beyond" }, exotic: true });
  }
  if (plan.kind !== "village") {
    const guild = site("guildhall", atAngleFrom(centre, 60, Math.round(R * 0.3)), 6);
    if (guild) name(guild, `${plan.id}-guildhall`, plan.guild, "guildhall", { spellTable: true, resident: { name: "Guild master", text: ["Our tables are open to any mage. Build your deck in peace."] } });
    const temple = site("temple", atAngleFrom(centre, 200, Math.round(R * 0.32)), 6);
    if (temple) name(temple, `${plan.id}-temple`, plan.temple, "temple", { resident: { name: "Priest", text: ["Rest a while. The wells of Dominaria remember the faithful."] } });
    const library = site(plan.style === "tolarian" ? "mage-tower" : "library", atAngleFrom(centre, 120, Math.round(R * 0.45)), 8);
    if (library) {
      const tower = plan.style === "tolarian";
      name(library, `${plan.id}-${tower ? "tower" : "library"}`, tower ? `The ${plan.name} Mage's Tower` : `The ${plan.name} Library`, tower ? "tower" : "library", { resident: { name: tower ? "Archmage" : "Librarian", text: ["Every card ever printed is written down somewhere. Most of them here."] } });
    }
    const gate = gateHexes[0] ?? centre;
    const smithy = site("smithy", gate, 6);
    if (smithy) name(smithy, `${plan.id}-smithy`, `The ${plan.name} Smithy`, "smithy", { armorer: true });
  } else {
    const shrine = site("house", centre, 6);
    if (shrine) name(shrine, `${plan.id}-shrine`, `The ${plan.name} Shrine`, "temple", { resident: { name: "Hermit", text: ["The road is long. Sit, and let it wait for you."] } });
  }
  const houses = plan.kind === "capital" ? 10 : plan.kind === "town" ? 6 : 3;
  for (let n = 1; n <= houses; n++) {
    const b = site("house", atAngleFrom(centre, random() * 360, Math.round(R * (0.3 + random() * 0.55))), 12);
    if (!b) break;
    const folk = plan.folk[(n - 1) % plan.folk.length]!;
    name(b, `${plan.id}-house-${n}`, `A house in ${plan.name}`, "house", n <= plan.folk.length ? { resident: folk } : {});
  }
  if (harbour !== null && gates.has("harbour")) {
    const at = hexOf(gates.get("harbour")!);
    for (let n = 0; n < (plan.kind === "village" ? 1 : 3); n++) {
      for (const s of shuffle(sites.slice(), random)) {
        if (grid.use[s.door] !== Use.Lot) continue;
        const sp = hexOf(s.street);
        if (hexDistance(sp.q, sp.r, at.q, at.r) > R * 0.35) continue;
        const b = fits(s, SIZES.warehouse[0]!, false);
        if (b) {
          place(b, "warehouse", 3);
          break;
        }
      }
    }
  }
  // The rest: rows of houses, tenements toward the middle of a big town, a warehouse now and then.
  for (const s of shuffle(sites.slice(), random)) {
    if (grid.use[s.door] !== Use.Lot || random() < 0.12) continue;
    const near = distC(s.street) / R;
    const use: BuildingUse = plan.kind !== "village" && near < 0.65 && random() < 0.5 ? "tenement" : plan.kind === "capital" && random() < 0.06 ? "warehouse" : "house";
    const sizes = SIZES[use];
    const size = sizes[Math.floor(random() * sizes.length)]!;
    const b = fits(s, size, false);
    if (b) place(b, use, size[2] + random() * 0.6);
  }

  // People outdoors: the quest board by the inn's door, guards in the gates, townsfolk on the streets.
  const besideStreet = (near: number, avoid: Set<number>): number | null => {
    const nearH = hexOf(near);
    let best: number | null = null;
    let bestD = Infinity;
    for (const i of disc(nearH, 6)) {
      if (grid.use[i] !== Use.Lot || grid.blocked[i] || avoid.has(i)) continue;
      if (around(i).some((j) => doorHexes.has(j))) continue;
      const openSides = around(i).filter((j) => grid.blocked[j] === 0 && grid.use[j] !== Use.Door);
      if (!openSides.some((j) => grid.use[j] === Use.Street || grid.use[j] === Use.Kept)) continue;
      // Never the only way between two open hexes.
      if (openSides.length < 3 || !safeToBlock((q, r) => inside(q, r) && grid.blocked[idx(q, r)] === 0, qOf(i), rOf(i))) continue;
      const d = hexDistance(qOf(i), rOf(i), nearH.q, nearH.r);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const used = new Set<number>();
  const person = (i: number | null, npc: Omit<NpcData, "q" | "r">) => {
    if (i === null) return false;
    grid.blocked[i] = 1;
    grid.use[i] = Use.Kept;
    used.add(i);
    npcs.push({ ...npc, q: qOf(i), r: rOf(i) });
    return true;
  };
  if (!person(besideStreet(inn.exit, used), { id: `${plan.id}-quest-board`, kind: "quest-board", name: plan.kind === "village" ? "Notice board" : "Quest board", text: plan.board })) {
    throw new Error(`${plan.id}: no room for the quest board`);
  }
  gateHexes.forEach((g, k) => {
    const inward = idx(g.q, g.r);
    person(besideStreet(inward, used), { id: `${plan.id}-guard-${k + 1}`, kind: "guard", name: `${plan.name} guard`, text: ["Keep to the roads. The waymarkers say how bad it gets past them."] });
  });
  plan.folk.forEach((folk, k) => {
    const at = atAngleFrom(centre, k * 97 + 40, S + 2 + Math.floor(random() * Math.max(1, R * 0.3)));
    person(besideStreet(idx(at.q, at.r), used), { id: `${plan.id}-folk-${k + 1}`, kind: "townsfolk", name: folk.name, text: folk.text });
  });

  // The caravan pitch: open paving at the edge of the market (or the square), with room all round for the wagon.
  let pitch: { q: number; r: number } | null = null;
  if (plan.caravan) {
    const square = market ?? centre;
    const reach = market ? 4 : S - 1;
    const spot = disc(square, reach)
      .filter((i) => grid.use[i] === Use.Kept && grid.blocked[i] === 0 && hexDistance(qOf(i), rOf(i), square.q, square.r) === reach && around(i).every((j) => grid.blocked[j] === 0))
      .sort((a, b) => a - b)[0];
    if (spot === undefined) throw new Error(`${plan.id}: no room for the caravan pitch`);
    pitch = { q: qOf(spot), r: rOf(spot) };
  }

  // Gardens and lamps: trees in yards away from the streets, lamps along them, banners round the square.
  for (const i of disc(centre, R - 2)) {
    if (grid.use[i] !== Use.Lot || grid.blocked[i]) continue;
    const sides = around(i);
    if (sides.some((j) => doorHexes.has(j))) continue;
    const byStreet = sides.some((j) => grid.use[j] === Use.Street);
    const allLot = sides.every((j) => grid.use[j] === Use.Lot || grid.use[j] === Use.Building);
    if (allLot && random() < 0.35) grid.prop(i, { kind: plan.style === "urborg" ? "dead-tree" : plan.style === "keldon" ? "boulder" : random() < 0.5 ? "tree" : "bush" });
    else if (byStreet && sides.filter((j) => grid.blocked[j] === 0).length >= 4 && random() < 0.05) grid.prop(i, { kind: "lamp", style: plan.style });
  }
  for (const h of ringOf(centre, S + 1)) {
    const i = idx(h.q, h.r);
    if (grid.use[i] === Use.Lot && !grid.blocked[i] && !around(i).some((j) => doorHexes.has(j)) && random() < 0.3) grid.prop(i, { kind: "banner", style: plan.style });
  }

  return {
    data: {
      id: plan.id,
      name: plan.name,
      kind: plan.kind,
      center: [centre.q, centre.r],
      radius: R,
      style: plan.style,
      ...(color ? { region: color } : {}),
      start: plan.start,
      ...(plan.home ? { home: plan.home } : {}),
    },
    buildings,
    interiors,
    doors,
    npcs,
    gates,
    inn: { q: qOf(inn.exit), r: rOf(inn.exit), interior: `${plan.id}-inn` },
    pitch,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The building side that faces a screen angle (degrees clockwise from up). */
export function frontToward(angle: number): Front {
  const a = (angle * Math.PI) / 180;
  const x = Math.cos(a) * -Math.SQRT1_2 + Math.sin(a) * Math.SQRT1_2;
  const z = Math.cos(a) * -Math.SQRT1_2 + Math.sin(a) * -Math.SQRT1_2;
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? "x+" : "x-") : z > 0 ? "z+" : "z-";
}

function atAngleFrom(from: Hex, angle: number, steps: number): Hex {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a) * -Math.SQRT1_2 + Math.sin(a) * Math.SQRT1_2;
  const dz = Math.cos(a) * -Math.SQRT1_2 + Math.sin(a) * -Math.SQRT1_2;
  const { x, z } = toWorld(from);
  return hexAtPoint(x + dx * steps * Math.sqrt(3), z + dz * steps * Math.sqrt(3));
}
