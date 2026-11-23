// The kinds of place the generator draws: the world map, towns and villages, wilderness, dungeon floors and the
// small maps a travel encounter is fought on. Each takes what is particular to the place (its name, region, links and
// mobs) and draws the rest from the place's seed, so a map comes out the same every run; set pieces - a town's
// square, a boss's hall - are placed by hand in the code.

import type { Hex } from "../../src/hex";
import type { MapData, NpcData, PropKind, Region, Terrain } from "../../src/maps/schema";
import { MapBuilder, STEP, distance, hex, key, line, neighbors, noise, ring, spiral, toward } from "./builder";
import { STYLES, type Style, type StyleName } from "./styles";

/** A way out of a map: where it leads, and which way it lies (radians, as `toward` takes them). */
export interface Link {
  readonly to: string;
  readonly angle: number;
}

const styleOf = (region: Region | undefined): Style => STYLES[region ?? "hub"];

/** The edge hex in a direction: where an exit that way goes. */
function edge(b: MapBuilder, angle: number, inset = 0): Hex {
  for (let steps = b.radius - inset; steps > 0; steps--) {
    const h = toward(angle, steps);
    if (distance(h, hex(0, 0)) <= b.radius - inset) return h;
  }
  return hex(0, 0);
}

/** Natural ground: hills from one noise, terrain from another, water in the low wet places, scenery scattered. */
function landscape(b: MapBuilder, style: Style, options: { water?: number; flatten?: number } = {}): void {
  const seed = b.random() * 1e9;
  const high = noise(seed, 7);
  const fine = noise(seed + 1, 2.5);
  const wet = noise(seed + 2, 9);
  for (const cell of b.all) {
    if (cell.fixed) continue;
    const e = high(cell.hex) * 0.8 + fine(cell.hex) * 0.2;
    const m = wet(cell.hex);
    cell.height = Math.max(0, Math.round((e - 0.3) * style.hills * 1.6)) * STEP;
    if (options.flatten && distance(cell.hex, hex(0, 0)) <= options.flatten) cell.height = Math.min(cell.height, STEP);
    cell.terrain = style.ground[Math.min(style.ground.length - 1, Math.floor(m * style.ground.length))]!;
    if (style.water && m > 1 - (options.water ?? 0.12) && e < 0.55) {
      cell.terrain = style.water;
      cell.height = -0.1;
      cell.blocked = true;
    }
  }
  // Water gets a shore.
  if (style.water) {
    for (const cell of b.all) {
      if (cell.fixed || cell.blocked) continue;
      if (neighbors(cell.hex).some((n) => b.cell(n)?.terrain === style.water)) cell.terrain = style.shore;
    }
  }
}

function dress(b: MapBuilder, style: Style, density = 1): void {
  const awayFromThings = (cell: { hex: Hex }) => !b.taken(cell.hex) && !neighbors(cell.hex).some((n) => b.taken(n));
  b.scatter(style.trees, style.treeShare * density, (c) => c.terrain !== style.shore && awayFromThings(c));
  b.scatter(style.rocks, style.rockShare * density, awayFromThings);
  b.scatter(style.extras, style.extraShare * density, awayFromThings);
}

/** A road from an exit toward the middle, bending a little so it doesn't look ruled. */
function pathTo(b: MapBuilder, from: Hex, to: Hex, terrain: Terrain, width = 0): void {
  const mid = hex(Math.round((from.q + to.q) / 2 + (b.random() - 0.5) * 4), Math.round((from.r + to.r) / 2 + (b.random() - 0.5) * 4));
  b.road([from, b.has(mid) ? mid : to, to], terrain, width);
}

/** Spread points: `count` spots at least `apart` from each other and from `avoid`, open, on the map. */
function spots(b: MapBuilder, count: number, apart: number, avoid: readonly Hex[], within = b.radius - 2): Hex[] {
  const found: Hex[] = [];
  for (let tries = 0; tries < 400 && found.length < count; tries++) {
    const h = toward(b.random() * Math.PI * 2, 2 + Math.floor(b.random() * (within - 2)));
    if (!b.has(h)) continue;
    const near = [...found, ...avoid].some((o) => distance(o, h) < apart);
    if (!near) found.push(h);
  }
  return found;
}

export interface WildSpec {
  readonly id: string;
  readonly name: string;
  readonly region: Region;
  readonly radius?: number;
  readonly links: readonly Link[];
  /** Each spawn point's mob list. */
  readonly spawns: readonly (readonly string[])[];
  readonly chests?: number;
  readonly feature?: "lake" | "river" | "ruins" | "grove" | "crater" | "coast";
  /** NPCs that stand out here: a lone spell table at a waystation. */
  readonly spellTable?: boolean;
}

export function wilderness(spec: WildSpec): MapData {
  const b = new MapBuilder(spec.id, spec.name, "wilderness", spec.radius ?? 16, spec.region);
  const style = styleOf(spec.region);
  landscape(b, style);

  const exits = spec.links.map((link) => ({ link, at: edge(b, link.angle) }));
  // A clearing in the middle that the roads meet at.
  const centre = hex(0, 0);
  for (const h of spiral(centre, 2)) b.set(h, { terrain: style.road === "mud" ? "moss" : style.ground[0]!, blocked: false, height: STEP });
  switch (spec.feature) {
    case "lake":
    case "crater": {
      const at = toward(b.random() * Math.PI * 2, Math.floor(b.radius / 2));
      const pool: Terrain = spec.feature === "crater" ? "lava" : style.water ?? "water";
      for (const h of spiral(at, 3)) {
        const d = distance(h, at);
        if (d <= 2) b.set(h, { terrain: pool, height: -0.1, blocked: true, fixed: true });
        else b.set(h, { terrain: spec.feature === "crater" ? "ash" : style.shore, height: 0, blocked: false, fixed: true });
      }
      break;
    }
    case "river": {
      const a = b.random() * Math.PI;
      const from = edge(b, a);
      const to = edge(b, a + Math.PI);
      for (const h of line(from, to)) {
        for (const w of spiral(h, 1)) b.set(w, { terrain: style.water === "lava" ? "lava" : "water", height: -0.1, blocked: true });
      }
      break;
    }
    case "coast": {
      // The sea lies away from the ways out, so the roads come in over land.
      const x = spec.links.reduce((sum, l) => sum + Math.cos(l.angle), 0);
      const z = spec.links.reduce((sum, l) => sum + Math.sin(l.angle), 0);
      const a = Math.atan2(-z, -x) + (b.random() - 0.5) * 0.6;
      for (const cell of b.all) {
        const along = Math.cos(a) * (1.5 * cell.hex.q) + Math.sin(a) * (Math.sqrt(3) * (cell.hex.r + cell.hex.q / 2));
        if (along > b.radius * 0.95) Object.assign(cell, { terrain: "deep-water", height: -0.2, blocked: true });
        else if (along > b.radius * 0.7) Object.assign(cell, { terrain: "water", height: -0.1, blocked: true });
        else if (along > b.radius * 0.55) Object.assign(cell, { terrain: "sand", height: 0, blocked: false });
      }
      break;
    }
    case "ruins": {
      const at = toward(b.random() * Math.PI * 2, Math.floor(b.radius / 2));
      b.disc(at, 3, style.paving, STEP);
      for (const h of ring(at, 3)) if (b.random() < 0.55) b.prop(h, b.random() < 0.5 ? "ruin" : "pillar");
      b.prop(at, "statue");
      break;
    }
    case "grove": {
      const at = toward(b.random() * Math.PI * 2, Math.floor(b.radius / 2));
      b.disc(at, 2, "meadow", STEP);
      for (const h of ring(at, 3)) if (b.random() < 0.7) b.prop(h, "tree");
      b.prop(at, "mushroom");
      break;
    }
    default:
      break;
  }

  for (const { link, at } of exits) {
    pathTo(b, at, centre, style.road);
    b.exit(at, link.to);
    // A signpost beside the way out.
    const beside = neighbors(at).find((n) => b.has(n) && !b.taken(n) && distance(n, hex(0, 0)) >= distance(at, hex(0, 0)) - 1 && b.cell(n)?.terrain !== style.road);
    if (beside) b.prop(beside, "signpost");
  }

  const avoid = [...exits.map((e) => e.at), centre];
  const spawnAt = spots(b, spec.spawns.length, 6, avoid);
  spec.spawns.forEach((mobs, i) => {
    const h = b.nearestOpen(spawnAt[i] ?? toward(i, 8), (c) => c.terrain !== style.water);
    b.spawn(h, `s${i + 1}`, mobs, 4, 600);
  });

  const chestAt = spots(b, spec.chests ?? 1, 5, [...avoid, ...b.spawns.map((s) => hex(s.q, s.r))]);
  chestAt.forEach((h, i) => b.chest(b.nearestOpen(h), `c${i + 1}`, [50, 200 + 50 * i], 86400));

  if (spec.spellTable) b.npc(hex(1, -2), { id: "spell-table", kind: "spell-table" });
  dress(b, style);
  return b.build();
}

export interface SettlementSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: "town" | "village";
  readonly region?: Region;
  readonly radius?: number;
  readonly links: readonly Link[];
  readonly vendors: readonly { readonly id: string; readonly name: string }[];
  readonly inn: string;
  readonly innkeeper: readonly string[];
  readonly board?: readonly string[];
  readonly folk?: readonly { readonly name: string; readonly text: readonly string[] }[];
  /** The square's centrepiece. */
  readonly centrepiece?: PropKind;
  readonly walls?: boolean;
}

/**
 * A town or village: a paved square with its centrepiece, roads out to the exits, the inn, the spell table, vendors'
 * stalls, the armorer and the quest board around the square, and houses along the roads.
 */
export function settlement(spec: SettlementSpec): MapData {
  const town = spec.kind === "town";
  const b = new MapBuilder(spec.id, spec.name, spec.kind, spec.radius ?? (town ? 15 : 11), spec.region);
  const style = styleOf(spec.region);
  landscape(b, style, { water: 0.06, flatten: b.radius });
  const square = town ? 4 : 3;
  b.disc(hex(0, 0), square, style.paving, STEP);
  b.prop(hex(0, 0), spec.centrepiece ?? (town ? "fountain" : "well"));

  // Roads out to every exit, paved, wide in a town.
  const exits = spec.links.map((link) => ({ link, at: edge(b, link.angle) }));
  for (const { at } of exits) b.road([hex(0, 0), at], town ? style.paving : style.road, town ? 1 : 0, STEP);
  b.disc(hex(0, 0), square, style.paving, STEP);
  b.prop(hex(0, 0), spec.centrepiece ?? (town ? "fountain" : "well"));
  for (const { link, at } of exits) b.exit(at, link.to);

  // Around the square, at its edge, facing in: the inn first, then the spell table, the vendors, the armorer and the
  // board, evenly spaced, skipping the roads.
  const roadHexes = new Set(b.all.filter((c) => c.terrain === (town ? style.paving : style.road) && distance(c.hex, hex(0, 0)) > square).map((c) => key(c.hex)));
  const rim = ring(hex(0, 0), square + 1).filter((h) => !roadHexes.has(key(h)) && !neighbors(h).some((n) => roadHexes.has(key(n)) && distance(n, hex(0, 0)) > square + 1));
  const people: { npc: Omit<NpcData, "q" | "r">; prop?: PropKind }[] = [
    { npc: { id: "inn", kind: "inn", name: spec.inn, text: spec.innkeeper } },
    { npc: { id: "spell-table", kind: "spell-table", name: "Spell table" } },
    ...spec.vendors.map((v) => ({ npc: { id: v.id, kind: "vendor", vendor: v.id, name: v.name } })),
  ];
  if (town) {
    people.push({ npc: { id: "armorer", kind: "armorer", name: "Armorer" } });
    people.push({ npc: { id: "quest-board", kind: "quest-board", name: "Quest board", text: spec.board ?? [] } });
  } else if (spec.board) {
    people.push({ npc: { id: "quest-board", kind: "quest-board", name: "Notice board", text: spec.board } });
  }
  const slots = rim.length;
  const taken: Hex[] = [];
  people.forEach((p, i) => {
    let at = rim[Math.floor((i * slots) / people.length)]!;
    if (taken.some((t) => distance(t, at) < 1)) at = rim.find((h) => !taken.some((t) => distance(t, h) < 2)) ?? at;
    taken.push(at);
    b.npc(at, p.npc, p.prop);
    if (p.npc.kind === "inn") {
      // The inn building behind its keeper, and the hex in front where beaten players wake.
      const behind = neighbors(at).filter((n) => distance(n, hex(0, 0)) > distance(at, hex(0, 0)) && !roadHexes.has(key(n)));
      for (const h of behind) b.prop(h, "house");
      const front = neighbors(at).filter((n) => distance(n, hex(0, 0)) < distance(at, hex(0, 0)));
      b.inn = front[0] ?? hex(0, 1);
    }
    if (p.npc.kind === "armorer") {
      const beside = neighbors(at).find((n) => distance(n, hex(0, 0)) === distance(at, hex(0, 0)) && !b.taken(n) && !roadHexes.has(key(n)));
      if (beside) b.prop(beside, "anvil");
    }
    if (p.npc.kind === "vendor") {
      const behind = neighbors(at).find((n) => distance(n, hex(0, 0)) > distance(at, hex(0, 0)) && !b.taken(n) && !roadHexes.has(key(n)));
      if (behind) b.prop(behind, "stall");
    }
  });

  // Townsfolk on the roads, the arena out past the square, banners and braziers at the square's corners.
  (spec.folk ?? []).forEach((folk, i) => {
    const at = b.nearestOpen(toward(i * 2.4 + 0.7, square + 3), (c) => !roadHexes.has(key(c.hex)));
    b.npc(at, { id: `folk-${i + 1}`, kind: "townsfolk", name: folk.name, text: folk.text });
  });
  if (town) {
    const arena = b.nearestOpen(toward(Math.PI * 0.25 + (exits[0]?.link.angle ?? 0), b.radius - 4), (c) => !roadHexes.has(key(c.hex)));
    b.npc(arena, { id: "arena", kind: "arena", name: "The arena", text: ["The arena is closed. A sign reads: coming soon."] });
    for (const h of ring(arena, 1)) if (!b.taken(h) && !roadHexes.has(key(h)) && b.random() < 0.6) b.prop(h, "pillar");
  }
  for (const h of ring(hex(0, 0), square)) {
    if (distance(h, hex(0, 0)) === square && b.random() < 0.12 && !roadHexes.has(key(h)) && !b.taken(h)) b.prop(h, b.random() < 0.5 ? "banner" : "brazier");
  }

  // Houses in rows along the roads, with gaps.
  for (const cell of b.all) {
    const d = distance(cell.hex, hex(0, 0));
    if (cell.fixed || cell.blocked || d <= square + 1 || d >= b.radius - 1) continue;
    const byRoad = neighbors(cell.hex).some((n) => roadHexes.has(key(n)));
    if (byRoad && !roadHexes.has(key(cell.hex)) && b.random() < (town ? 0.5 : 0.3)) {
      b.prop(cell.hex, b.random() < 0.12 ? "tower" : "house");
    }
  }
  // A town wall with gates where the roads go through.
  if (spec.walls) {
    for (const h of ring(hex(0, 0), b.radius - 2)) {
      if (roadHexes.has(key(h)) || b.taken(h) || neighbors(h).some((n) => b.taken(n))) continue;
      b.prop(h, b.random() < 0.08 ? "tower" : "wall");
    }
  }
  // Crates and barrels by the stalls, and the countryside outside.
  b.scatter(["crate", "barrel"], 0.04, (c) => distance(c.hex, hex(0, 0)) <= square + 3 && !b.taken(c.hex) && !neighbors(c.hex).some((n) => b.taken(n)) && !roadHexes.has(key(c.hex)));
  b.scatter(style.trees, style.treeShare, (c) => distance(c.hex, hex(0, 0)) >= b.radius - 3 && !neighbors(c.hex).some((n) => b.taken(n)));
  return b.build();
}

export interface DungeonSpec {
  readonly id: string;
  readonly name: string;
  /** The region's color; none for the Phyrexian Portal, which is no region's. */
  readonly region?: Region;
  /** How it looks, when not its region's. */
  readonly style?: StyleName;
  /** The colors a character must have to go in (schema.ts's `requires`). */
  readonly requires?: string;
  readonly floor: number;
  readonly floors: number;
  /** Where the stairs up lead: the floor above, or "world" from the entrance. */
  readonly up: string;
  /** Where the stairs down lead; none on the last floor. */
  readonly down?: string;
  readonly mobs: readonly string[];
  /** The floor's mini-boss, by the stairs down. */
  readonly keeper: string;
  /** The dungeon's boss, on the last floor. */
  readonly boss?: string;
}

/**
 * A dungeon floor: rock everywhere, rooms carved out and joined by corridors, from the stairs up on one side to the
 * stairs down (or the boss's hall) on the other. The entrance floor has an antechamber with a spell table.
 */
export function dungeon(spec: DungeonSpec): MapData {
  const b = new MapBuilder(spec.id, spec.name, "dungeon", 13, spec.region, spec.floor);
  const style = spec.style ? STYLES[spec.style] : styleOf(spec.region);
  for (const cell of b.all) Object.assign(cell, { terrain: style.dungeonWall, height: 1, blocked: true });

  const enter = b.random() * Math.PI * 2;
  const leave = enter + Math.PI + (b.random() - 0.5) * 0.8;
  const start = toward(enter, 10);
  const end = spec.boss ? toward(leave, 7) : toward(leave, 10);

  // Rooms: the entrance, a chain of rooms between, side rooms off it, and the last room.
  const rooms: { at: Hex; size: number }[] = [{ at: start, size: 2 }];
  const between = 3 + Math.floor(b.random() * 2);
  for (let i = 1; i <= between; i++) {
    const t = i / (between + 1);
    const swing = (b.random() - 0.5) * 9;
    const across = enter + Math.PI / 2;
    const base = hex(Math.round(start.q + (end.q - start.q) * t), Math.round(start.r + (end.r - start.r) * t));
    const at = toward(across, Math.round(swing), base);
    rooms.push({ at: b.has(at) && distance(at, hex(0, 0)) <= 10 ? at : base, size: 2 + Math.floor(b.random() * 2) });
  }
  rooms.push({ at: end, size: spec.boss ? 4 : 2 });
  for (let i = 1; i < rooms.length; i++) b.road([rooms[i - 1]!.at, rooms[i]!.at], style.dungeonFloor, 0, 0);
  for (const room of rooms) b.disc(room.at, room.size, style.dungeonFloor, 0);
  // Side rooms: dead ends with chests.
  const sides: Hex[] = [];
  for (let i = 0; i < 2; i++) {
    const from = rooms[1 + Math.floor(b.random() * (rooms.length - 2))]!.at;
    const at = toward(b.random() * Math.PI * 2, 4, from);
    if (!b.has(at) || distance(at, hex(0, 0)) > 11) continue;
    b.road([from, at], style.dungeonFloor, 0, 0);
    b.disc(at, 1, style.dungeonFloor, 0);
    sides.push(at);
  }
  // A hazard pool in a middle room, never on the way through.
  if (style.dungeonPool) {
    const room = rooms[Math.floor(rooms.length / 2)]!;
    if (room.size >= 3) {
      const at = toward(b.random() * Math.PI * 2, 2, room.at);
      b.set(at, { terrain: style.dungeonPool, height: -0.1, blocked: true, fixed: true });
    }
  }

  // The stairs.
  const upAt = start;
  b.exit(upAt, spec.up);
  b.set(upAt, { prop: "stairs-up" });
  if (spec.down) {
    const downAt = toward(leave, 2, end);
    const at = b.has(downAt) && b.cell(downAt)?.blocked === false ? downAt : end;
    b.exit(at, spec.down);
    b.set(at, { prop: "stairs-down" });
  }

  // Who is here: the floor's mobs in the rooms between, its keeper in the last room, the boss in its hall.
  rooms.slice(1, -1).forEach((room, i) => {
    b.spawn(b.nearestOpen(room.at), `s${i + 1}`, spec.mobs, 2, 3600);
  });
  const last = rooms[rooms.length - 1]!;
  if (spec.boss) {
    // The boss's hall: pillars round it, braziers, a throne behind the boss.
    for (const h of ring(last.at, 3)) if ((h.q + h.r) % 2 === 0 && !b.taken(h)) b.prop(h, "pillar");
    const behind = toward(leave, 2, last.at);
    if (!b.taken(behind)) b.prop(behind, "throne");
    for (const n of neighbors(behind)) if (!b.taken(n) && distance(n, last.at) === 2) b.prop(n, "brazier");
    b.spawn(toward(leave, 1, last.at), "boss", [spec.boss], 0, 604800);
    b.spawn(toward(leave + Math.PI, 2, last.at), "keeper", [spec.keeper], 1, 86400);
  } else {
    b.spawn(b.nearestOpen(last.at), "keeper", [spec.keeper], 1, 86400);
  }
  sides.forEach((side, i) => {
    const at = spiral(side, 1).find((h) => b.cell(h)?.blocked === false && !b.taken(h) && !neighbors(h).some((n) => b.taken(n)));
    if (at) b.chest(at, `c${i + 1}`, [100 + 50 * spec.floor, 300 + 50 * spec.floor], 86400);
  });

  if (spec.floor === 1) {
    // The antechamber: a spell table by the entrance (design.md, A6).
    const table = neighbors(upAt).find((n) => b.cell(n)?.blocked === false && !b.taken(n) && neighbors(n).filter((m) => b.cell(m)?.blocked === false).length >= 3);
    if (table) b.npc(table, { id: "spell-table", kind: "spell-table", name: "Spell table" });
    const brazier = toward(enter + 0.6, 1, upAt);
    if (!b.taken(brazier) && b.cell(brazier)?.blocked === false) b.prop(brazier, spec.requires ? "portal" : "brazier");
  }
  // Scenery against the walls of the rooms.
  b.scatter(style.dungeonProps, 0.08, (c) => !b.taken(c.hex) && !neighbors(c.hex).some((n) => b.taken(n)) && neighbors(c.hex).filter((n) => b.cell(n)?.blocked).length >= 2);
  b.scatter(["bones"], 0.03, (c) => !b.taken(c.hex) && !neighbors(c.hex).some((n) => b.taken(n)));
  const built = b.build();
  return spec.requires ? { ...built, requires: spec.requires } : built;
}

export interface EncounterSpec {
  readonly id: string;
  readonly name: string;
  readonly region: Region;
  readonly mobs: readonly string[];
}

/** The small map a travel encounter drops you on: the mob in the middle, the way back to the world map all round. */
export function encounter(spec: EncounterSpec): MapData {
  const b = new MapBuilder(spec.id, spec.name, "wilderness", 7, spec.region);
  const style = styleOf(spec.region);
  landscape(b, style, { water: 0.08 });
  for (const angle of [0.5, 2.6, 4.7]) b.exit(edge(b, angle), "world");
  b.spawn(hex(0, 0), "s1", spec.mobs, 2, 60);
  dress(b, style, 1.2);
  return b.build();
}

export interface Place {
  readonly id: string;
  readonly at: Hex;
}

export interface WorldSpec {
  readonly radius: number;
  /** Each region's direction from the hub, and its encounter map. */
  readonly regions: readonly { readonly region: Region; readonly angle: number; readonly encounter: string }[];
  readonly places: readonly Place[];
  /** Roads, as lists of place ids. */
  readonly roads: readonly (readonly string[])[];
}

const REGION_GROUND: Record<Region, readonly Terrain[]> = {
  W: ["grass", "grass", "meadow", "hills"],
  U: ["sand", "grass", "water", "water"],
  B: ["swamp", "swamp", "mud", "moss"],
  R: ["mountain", "hills", "ash", "rock"],
  G: ["forest", "forest", "grass", "forest"],
};

/** Dominaria from above: the five regions round the hub in wheel order, the sea beyond, roads between the places. */
export function world(spec: WorldSpec): MapData {
  const b = new MapBuilder("world", "Dominaria", "world", spec.radius);
  const texture = noise(77, 5);
  const coast = noise(78, 6);
  for (const cell of b.all) {
    const { q, r } = cell.hex;
    const x = 1.5 * q;
    const z = Math.sqrt(3) * (r + q / 2);
    const angle = Math.atan2(z, x);
    const d = distance(cell.hex, hex(0, 0));
    // The region whose direction is nearest.
    let best = spec.regions[0]!;
    let bestGap = Infinity;
    for (const region of spec.regions) {
      const gap = Math.abs(Math.atan2(Math.sin(angle - region.angle), Math.cos(angle - region.angle)));
      if (gap < bestGap) {
        bestGap = gap;
        best = region;
      }
    }
    const ground = REGION_GROUND[best.region];
    let terrain: Terrain = ground[Math.min(ground.length - 1, Math.floor(texture(cell.hex) * ground.length))]!;
    if (d <= 4) terrain = "grass";
    const shore = spec.radius - 3 + coast(cell.hex) * 3;
    if (d > shore) terrain = "deep-water";
    else if (d > shore - 1) terrain = "sand";
    const blocked = terrain === "deep-water" || terrain === "mountain" || terrain === "water";
    Object.assign(cell, { terrain, height: 0, blocked });
  }
  const at = new Map(spec.places.map((p) => [p.id, p.at]));
  for (const road of spec.roads) {
    const points = road.map((id) => at.get(id)!);
    for (let i = 1; i < points.length; i++) {
      for (const h of line(points[i - 1]!, points[i]!)) b.set(h, { terrain: "road", blocked: false });
    }
  }
  for (const place of spec.places) {
    b.set(place.at, { blocked: false, terrain: b.cell(place.at)?.terrain === "road" ? "road" : "grass" });
    b.exits.push({ q: place.at.q, r: place.at.r, to: place.id });
  }
  b.encounters = spec.regions.map((region) => {
    const centre = toward(region.angle, 14);
    return { q: centre.q, r: centre.r, radius: 11, map: region.encounter, chance: 0.06 };
  });
  return b.build();
}
