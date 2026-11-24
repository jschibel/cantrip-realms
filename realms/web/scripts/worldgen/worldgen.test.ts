import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../../src/art/buildings";
import { BLOCKED, type BuildingData, type ChunkData, type DungeonData, type InteriorData, type TileData, type TownData, type WorldData, frontStep, isBlocked } from "../../src/world/format";
import { TOWN_LIMITS, lintRealm, lintTown } from "../../src/world/lint";
import { inSquare, wayTiles } from "../../src/world/streets";
import { type Footprint, alongFront, building, frontTile } from "./buildings";
import { S } from "./ids";
import { Land, Use, randomFor } from "./land";
import { checkLayout, readLayout } from "./layout";
import { Roads } from "./roads";
import { buildInterior, roomProblems } from "./rooms";
import type { Form } from "./layout";
import { type BuiltTown, type TownSpec, buildTown, safeToBlock } from "./towns";
import { tierOfDistance } from "./zones";

// The world generator's parts on small grounds of their own: buildings' fronts and doors, a town laid out on open land
// and one of each street plan (a grid, rings, a ladder), roads, the tiers, the rooms; and the realm lint catching each
// kind of fault in the generated Dominaria, its towns' streets too.

/** Open grass, `w` by `d`. */
function meadow(w: number, d: number): Land {
  const land = new Land(w, d);
  land.surface.fill(S.grass);
  land.height.fill(4);
  return land;
}

describe("a building's front", () => {
  it("puts the door tile before the front wall, at the same place along it the style draws it, whichever way it faces", () => {
    for (const rot of [0, 1, 2, 3]) {
      const f: Omit<Footprint, "door"> = { x: 10, z: 20, w: rot % 2 ? 6 : 8, d: rot % 2 ? 8 : 6, rot };
      for (let at = 0.5; at < 8; at++) {
        const tile = frontTile(f, at);
        const [sx, sz] = frontStep(rot);
        const inside = [tile[0] - sx, tile[1] - sz];
        expect(inside[0]! >= f.x && inside[0]! < f.x + f.w && inside[1]! >= f.z && inside[1]! < f.z + f.d, `rot ${rot} at ${at}`).toBe(true);
        expect(alongFront({ ...f, door: tile }, tile)).toBe(at);
      }
    }
  });

  it("is where Benalia's style draws its door, turned any way the world turns it", () => {
    const random = randomFor(1, "test");
    for (const rot of [0, 1, 3]) {
      const f0: Omit<Footprint, "door"> = { x: 4, z: 6, w: rot % 2 ? 6 : 8, d: rot % 2 ? 8 : 6, rot };
      const door = frontTile(f0, 2.5);
      const data: BuildingData = building("b", "benalish", "house", { ...f0, door }, random, { interior: "room" });
      const [dx, , dz] = BUILDINGS.build("benalish", data).doorway!;
      // The doorway's point lies on the door tile's edge with the building.
      expect(Math.abs(dx - (door[0] + 0.5)) <= 0.51 && Math.abs(dz - (door[1] + 0.5)) <= 0.51, `rot ${rot}: ${dx},${dz} by ${door.join(",")}`).toBe(true);
    }
  });
});

describe("a town", () => {
  const land = meadow(160, 160);
  const town = buildTown(
    land,
    {
      plan: {
        id: "testholm",
        name: "Testholm",
        kind: "town",
        region: "benalia",
        style: "benalish",
        at: [80, 80],
        radius: 50,
        inn: "The Test",
        innkeeper: ["Hello."],
        board: ["Wanted."],
        folk: [{ name: "Ada", text: ["Hi."] }],
        centrepiece: "fountain",
        start: true,
        temple: "The Temple",
        guild: "The Guild",
        caravan: true,
      },
      index: 0,
      color: "W",
      targets: [
        { id: "north", at: [80, 0] },
        { id: "east", at: [159, 85] },
      ],
      vendors: [
        { id: "a-vendor", name: "A's Wares" },
        { id: "b-vendor", name: "B's Wares" },
      ],
      exotic: null,
    },
    7,
  );

  it("has its walls with a gate toward each road, its own buildings with interiors, and its people", () => {
    expect(town.gates.size).toBe(2);
    for (const g of town.gates.values()) expect(land.open(g) && land.town[g] === 0).toBe(true);
    // One gate faces north, toward its road, the other east.
    const toward = [...town.gates.values()].map((g) => Math.atan2(land.zOf(g) - 80, land.xOf(g) - 80));
    expect(toward.some((a) => Math.abs(a + Math.PI / 2) < 0.8) && toward.some((a) => Math.abs(a) < 0.8)).toBe(true);
    expect(town.interiors.map((r) => r.kind).sort()).toEqual(expect.arrayContaining(["inn", "shop", "shop", "guildhall", "temple", "library", "smithy", "house"]));
    expect(town.npcs.map((n) => n.kind)).toEqual(expect.arrayContaining(["quest-board", "guard", "townsfolk", "arena"]));
    expect(town.pitch).not.toBeNull();
    let wall = 0;
    for (let i = 0; i < land.size; i++) if (land.use[i] === Use.Wall) wall++;
    expect(wall).toBeGreaterThan(200);
  });

  it("stands every building on its own ground, every door on the street before its front, never facing north", () => {
    const taken = new Map<number, string>();
    for (const b of town.buildings) {
      for (let z = b.z; z < b.z + b.d; z++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          expect(taken.get(land.idx(x, z)), `${b.id} on ${taken.get(land.idx(x, z))}`).toBeUndefined();
          taken.set(land.idx(x, z), b.id);
          expect(land.open(land.idx(x, z))).toBe(false);
        }
      }
      if (!b.door) continue;
      expect(b.rot).not.toBe(2);
      expect(land.open(land.idx(b.door[0], b.door[1]))).toBe(true);
    }
  });

  it("can be walked from its inn to every door and gate", () => {
    const { label } = land.pieces(land.idx(town.inn.x, town.inn.z));
    for (const r of town.interiors) expect(label[land.idx(r.exit[0], r.exit[1])], r.id).toBe(0);
    for (const g of town.gates.values()) expect(label[g]).toBe(0);
  });

  it("furnishes every room it opens with its people where they can be reached", () => {
    for (const spec of town.interiors) {
      const room = buildInterior(spec);
      expect(roomProblems(room), spec.id).toEqual([]);
      if (spec.vendor) expect(room.npcs.some((n) => n.kind === "vendor" && n.vendor === spec.vendor!.id)).toBe(true);
      if (spec.kind === "inn") expect(room.npcs.map((n) => n.kind)).toEqual(expect.arrayContaining(["innkeeper", "spell-table"]));
      if (spec.armorer) expect(room.npcs.some((n) => n.kind === "armorer")).toBe(true);
    }
  });
});

/** A town of a form on open grass of its own, with roads arriving from the north and the east. */
function townOf(form: Form, kind: "capital" | "town" | "village", radius: number): { land: Land; town: BuiltTown } {
  const size = radius * 2 + 60;
  const land = meadow(size, size);
  const c = size / 2;
  const spec: TownSpec = {
    plan: {
      id: `test-${form}`,
      name: `Test ${form}`,
      kind,
      form,
      region: "benalia",
      style: form === "elfhame" ? "llanowar" : form === "clan" ? "keldon" : "benalish",
      at: [c, c],
      radius,
      inn: "The Test",
      innkeeper: ["Hello."],
      board: ["Wanted."],
      folk: [{ name: "Ada", text: ["Hi."] }],
      centrepiece: "well",
      start: false,
      temple: "The Temple",
      guild: "The Guild",
    },
    index: 0,
    color: "W",
    targets: [
      { id: "north", at: [c + 6, 0] },
      { id: "east", at: [size - 1, c - 4] },
    ],
    vendors: [{ id: "a-vendor", name: "A's Wares" }],
    exotic: null,
  };
  return { land, town: buildTown(land, spec, 11) };
}

describe("a town's streets", () => {
  const cases: [Form, "capital" | "town" | "village", number, string][] = [
    ["city", "town", 50, "a grid"],
    ["clan", "town", 50, "rings"],
    ["elfhame", "village", 24, "a small ring"],
    ["village", "village", 24, "a ladder"],
  ];
  for (const [form, kind, radius, what] of cases) {
    it(`are planned whole and lint clean: ${what} (${form})`, () => {
      const { land, town } = townOf(form, kind, radius);
      const plan = town.data.plan!;
      expect(lintTown(town.data, (x, z) => land.inside(x, z) && land.open(land.idx(x, z)), town.buildings)).toEqual([]);
      // Every way paved; no way ends but at a gate (the road goes on) or in a square.
      const ends = new Map<number, number>();
      for (const w of plan.ways) {
        for (const n of [w.a, w.b]) ends.set(n, (ends.get(n) ?? 0) + 1);
        for (const [x, z] of wayTiles(plan, w)) if (land.town[land.idx(x, z)] !== 0 && land.use[land.idx(x, z)] !== Use.Wall) expect([Use.Street, Use.Kept, Use.Door]).toContain(land.use[land.idx(x, z)]);
      }
      for (const [n, count] of ends) {
        const [x, z] = plan.nodes[n]!;
        if (count === 1) expect(plan.gates.includes(n) || plan.squares.some((s) => inSquare(s, x, z)), `the way ending at ${x},${z}`).toBe(true);
      }
      // A gate toward each road, the road's end the plan's gate.
      expect(plan.gates.length).toBe(town.gates.size);
      for (const g of town.gates.values()) expect(plan.gates.some((n) => land.idx(plan.nodes[n]![0], plan.nodes[n]![1]) === g)).toBe(true);
      // The town's own places named: its inn, its shop and its quest board among them, the inn at its door.
      expect(plan.places.map((p) => p.kind)).toEqual(expect.arrayContaining(["inn", "shop", "quest-board"]));
      const inn = plan.places.find((p) => p.kind === "inn")!;
      expect([inn.x, inn.z]).toEqual([town.inn.x, town.inn.z]);
    });
  }

  it("lays a grid's streets straight across the town, each gate's way in straight through the wall", () => {
    const { land, town } = townOf("city", "town", 50);
    const plan = town.data.plan!;
    const straight = plan.ways.filter((w) => !w.via && (plan.nodes[w.a]![0] === plan.nodes[w.b]![0] || plan.nodes[w.a]![1] === plan.nodes[w.b]![1]));
    expect(straight.length / plan.ways.length).toBeGreaterThan(0.6);
    for (const n of plan.gates) {
      const way = plan.ways.find((w) => w.a === n || w.b === n)!;
      const [ax, az] = plan.nodes[way.a]!;
      const [bx, bz] = plan.nodes[way.b]!;
      expect(ax === bx || az === bz, `the way in from ${plan.nodes[n]!.join(",")}`).toBe(true);
    }
    expect(land.fixtures.filter((p) => p.id === "gatehouse")).toHaveLength(plan.gates.length);
  });

  it("puts the inn and the shops on the main streets and the square", () => {
    const { town } = townOf("city", "town", 50);
    const plan = town.data.plan!;
    const main = new Set<string>();
    for (const w of plan.ways) if (w.main) for (const [x, z] of wayTiles(plan, w)) main.add(`${x},${z}`);
    const onMain = (x: number, z: number) => main.has(`${x},${z}`) || plan.squares.some((s) => inSquare(s, x, z));
    const shops = plan.places.filter((p) => p.kind === "shop" || p.kind === "inn");
    expect(shops.filter((p) => !onMain(p.x, p.z))).toEqual([]);
  });
});

describe("roads", () => {
  it("join edge to edge, bridge a river and keep it flowing beside the bridge", () => {
    const land = meadow(60, 30);
    for (let z = 0; z < 30; z++) for (const x of [29, 30, 31]) {
      land.surface[land.idx(x, z)] = S.stream;
      land.flags[land.idx(x, z)] = BLOCKED;
    }
    const roads = new Roads(land);
    expect(roads.lay("a", "b", [land.idx(5, 15)], [land.idx(55, 15)], true)).toBe(true);
    const tiles = roads.laid[0]!.tiles;
    for (let k = 1; k < tiles.length; k++) expect(Math.abs(land.xOf(tiles[k]!) - land.xOf(tiles[k - 1]!)) + Math.abs(land.zOf(tiles[k]!) - land.zOf(tiles[k - 1]!))).toBe(1);
    for (const i of tiles) expect(land.open(i)).toBe(true);
    expect(land.fixtures.filter((p) => p.id === "bridge")).toHaveLength(1);
    expect(land.open(land.idx(30, 2))).toBe(false);
  });
});

describe("blocking a tile", () => {
  it("is safe only where the way round it stays open", () => {
    const land = meadow(5, 5);
    expect(safeToBlock(land, land.idx(2, 2))).toBe(true);
    // A corridor one tile wide, east to west: its middle is the only way.
    for (let x = 0; x < 5; x++) for (const z of [1, 3]) land.block(land.idx(x, z));
    expect(safeToBlock(land, land.idx(2, 2))).toBe(false);
  });
});

describe("the tiers", () => {
  it("rise with distance from the starting areas", () => {
    expect([0, 70, 71, 140, 141, 220, 221, 900].map(tierOfDistance)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("the layout", () => {
  it("is good as checked in, and names what is wrong with a bad one", () => {
    const layout = readLayout();
    expect(checkLayout(layout)).toEqual([]);
    const towns = layout.towns.map((t, k) => (k === 1 ? { ...t, at: layout.towns[0]!.at } : t));
    expect(checkLayout({ ...layout, towns }).join("\n")).toMatch(/stand -\d+ tiles apart/);
    expect(checkLayout({ ...layout, size: [1000, 1216] }).join("\n")).toMatch(/whole chunks/);
  });
});

describe("the realm lint, on Dominaria made wrong on purpose", () => {
  const plane = join(__dirname, "..", "..", "..", "content", "dominaria");
  const read = <T>(dir: string): T[] => readdirSync(join(plane, dir)).map((f) => JSON.parse(readFileSync(join(plane, dir, f), "utf8")) as T);
  const world = JSON.parse(readFileSync(join(plane, "world", "world.json"), "utf8")) as WorldData;
  const chunks = read<ChunkData>("world/chunks");
  const interiors = read<InteriorData>("interiors");
  const dungeons = read<DungeonData>("dungeons");
  const lint = (w: WorldData, c: ChunkData[], d: DungeonData[] = dungeons, r: InteriorData[] = interiors) => lintRealm(w, c, r, d).join("\n");
  const withChunk = (pick: (c: ChunkData) => boolean, change: (c: ChunkData) => ChunkData) => chunks.map((c) => (pick(c) ? change(c) : c));

  it("passes it as it is", () => {
    expect(lint(world, chunks)).toBe("");
  });

  it("catches a spawn of the wrong tier, a waymarker away from any rise, a pocket nobody can walk to", () => {
    const withSpawn = chunks.find((c) => c.spawns.length > 0)!;
    expect(lint(world, withChunk((c) => c === withSpawn, (c) => ({ ...c, spawns: c.spawns.map((s, k) => (k === 0 ? { ...s, tier: s.tier === 4 ? 3 : s.tier + 1 } : s)) })))).toMatch(/but its zone's is/);
    const withMarker = chunks.find((c) => c.waymarkers.length > 0)!;
    const m = withMarker.waymarkers[0]!;
    expect(lint(world, withChunk((c) => c === withMarker, (c) => ({ ...c, waymarkers: [{ ...m, tier: m.tier + 1 }] })))).toMatch(/waymarker at .* tier/);
    // A ring of blocked tiles round an open one in the sea's middle... an open tile walled in on land instead.
    const sea = chunks.find((c) => c.tiles.every((t) => t[1] === "sea"))!;
    const pocket = { ...sea, tiles: sea.tiles.map((t, k) => (k === 16 * 32 + 16 ? ([0, "sand", 0] as const) : t)) };
    expect(lint(world, chunks.map((c) => (c === sea ? pocket : c)))).toMatch(/1 open tiles are not walked to/);
  });

  it("catches an entrance into no dungeon, a dungeon placed where its entrance is not, a ferry lane that jumps", () => {
    const withEntrance = chunks.find((c) => c.entrances.length > 0)!;
    expect(lint(world, withChunk((c) => c === withEntrance, (c) => ({ ...c, entrances: c.entrances.map((e) => ({ ...e, dungeon: "nowhere" })) })))).toMatch(/no dungeon nowhere/);
    const moved = dungeons.map((d, k) => (k === 0 ? { ...d, entrance: [d.entrance[0] + 1, d.entrance[1]] as const } : d));
    expect(lint(world, chunks, moved)).toMatch(/not where world.json places it/);
    const ferry = world.ferries[0]!;
    const jumping = { ...world, ferries: [{ ...ferry, lane: [ferry.lane[0]!, ...ferry.lane.slice(3)] }, ...world.ferries.slice(1)] };
    expect(lint(jumping, chunks)).toMatch(/no step of a walk/);
  });

  it("catches a street ending nowhere, a door off the streets or cut off from them, a long way round between places", () => {
    const k = world.towns.findIndex((t) => t.id === "capashen-hold");
    const town = world.towns[k]!;
    const plan = town.plan!;
    const withTown = (changed: TownData) => ({ ...world, towns: world.towns.map((t, i) => (i === k ? changed : t)) });
    // A lane run out from a junction into the yards, 15 tiles, to no door.
    const from = plan.ways.find((w) => !w.main && !w.via)!.a;
    const [fx, fz] = plan.nodes[from]!;
    const spur = { ...plan, nodes: [...plan.nodes, [fx, fz + 15] as const], ways: [...plan.ways, { a: from, b: plan.nodes.length, width: 2 }] };
    expect(lint(withTown({ ...town, plan: spur }), chunks)).toMatch(/a street ends at .*, at no door, 15 tiles past its last junction/);
    // A door moved off its street, and a door walled in.
    const open = new Set<string>();
    for (const c of chunks) c.tiles.forEach((t, i) => !isBlocked(t) && open.add(`${c.cx * 32 + (i % 32)},${c.cz * 32 + Math.floor(i / 32)}`));
    const isOpen = (x: number, z: number) => open.has(`${x},${z}`);
    const buildings = chunks.flatMap((c) => c.buildings);
    const house = (b: { interior?: string }) => b.interior === "capashen-hold-house-1";
    const moved = buildings.map((b) => (house(b) ? { ...b, door: [b.x + 1, b.z + 1] as const } : b));
    expect(lintTown(town, isOpen, moved).join("\n")).toMatch(/town capashen-hold: the door of capashen-hold-.* opens onto no street/);
    const [hx, hz] = buildings.find(house)!.door!;
    const walled = chunks.map((c) => ({
      ...c,
      tiles: c.tiles.map((t, i): TileData => (Math.max(Math.abs(c.cx * 32 + (i % 32) - hx), Math.abs(c.cz * 32 + Math.floor(i / 32) - hz)) === 1 ? [t[0], t[1], 1] : t)),
    }));
    expect(lint(world, walled)).toMatch(/the door of capashen-hold-.* is not walked to along the streets from the gate/);
    // A tighter limit on the way round than the town keeps.
    expect(lintTown(town, isOpen, buildings, { ...TOWN_LIMITS, detour: 1.1 }).join("\n")).toMatch(/times the \d+ between them/);
  });

  it("catches a pitch outside its town, an interior of the wrong town, a spell-table prop with no NPC", () => {
    const pitch = world.pitches[0]!;
    expect(lint({ ...world, pitches: [{ ...pitch, x: 5, z: 5 }, ...world.pitches.slice(1)] }, chunks)).toMatch(/not in its town/);
    const room = interiors.find((r) => r.kind === "house")!;
    expect(lint(world, chunks, dungeons, interiors.map((r) => (r === room ? { ...r, town: "keld" } : r)))).toMatch(/its town is keld/);
    const withTable = chunks.find((c) => c.props.some((p) => p.id === "spell-table"))!;
    expect(lint(world, withChunk((c) => c === withTable, (c) => ({ ...c, npcs: c.npcs.filter((n) => n.kind !== "spell-table") })))).toMatch(/is no spell-table NPC/);
  });
});
