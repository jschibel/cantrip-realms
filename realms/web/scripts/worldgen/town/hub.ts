// A town at walking scale, laid out from one template (design.md A6 "Towns"): every town of Dominaria is the same plan
// in its own region's style, so whoever has learned one knows them all. The camera looks north and never turns, so
// everything faces south and the plan is rows, north to south:
//
//         ===================== wall =====================
//         [home] [Guild hall]  [ Temple ]  [Library] [home]     row A: the head - the town's great buildings
//         ------------------- the walk -------------------
//            [Exotic wares] [Inn]  ||  [Smithy] [Arena]        row B: what a player uses most, by the way in
//         ================== THE MARKET ==================
//              [stall][stall][stall] || [stall][stall]         the card vendors at their stalls
//              quest board      fountain       the pitch
//         ===================== wall ==[gate]=============
//                                     ||
//                       the road out, onto the travel map
//
// One gate, in the south wall: walking through it from the travel map stands the player in the market, every shop in
// sight; walking out through it puts them back beside the town's icon. The avenue runs from the gate through the market
// and a gap in row B to the temple's door. Nothing is on terraces, nothing needs finding: the town is a hub, its light
// exploration the houses at the head's ends and the people about the market. Outside the wall lies scenery only - the
// country of the town's biome, the sea where it has a shore - which the camera shows and nobody walks.
//
// With one heading what stands up hides only the ground straight north of it, in its own columns (view.ts at heading
// 0): so the walk between the rows is kept deeper than what row B hides behind it, and the stalls stand far enough from
// row B that its doors are seen over them.

import { tilesOf } from "../../../src/art/props";
import type { BuildingData, InteriorKind, NpcData, PlaceKind, PropData, StreetWay, TownPlace, TownPlan, TownSquare, XZ } from "../../../src/world/format";
import { BARE, BLOCKED } from "../../../src/world/format";
import { S } from "../ids";
import { Land, Use, fbm, randomFor } from "../land";
import type { TownLayout } from "../layout";
import { REGION_OF_STYLE } from "../rooms";
import { type Footprint, makeBuilding } from "./buildings";
import { type Role, formSpec, groundsOf, kindFor, sizesFor, styleFor } from "./forms";
import { countryOf, treeProp } from "./country";
import type { BuiltTown, InteriorSpec, TownSpec, TownWay } from "./types";
import { buildingHides } from "./view";

/** The street lights of each style (none among Llanowar's trees: their lanterns hang in the trees). */
const STREET_LIGHT: Readonly<Record<string, string | null>> = { benalish: "lamp-post", tolarian: "lamp-post", keldon: "torch-post", urborg: "lantern-post", llanowar: null, argive: "lamp-post" };
/** The named palette a town's banners fly, by its style. */
const BANNER: Readonly<Record<string, string>> = { benalish: "benalish", argive: "benalish", llanowar: "llanowar", urborg: "morass", keldon: "keldon", tolarian: "tolarian" };

/** The grounds of each kind of town, whole chunks: the town and the scenery round it the camera may show. */
export const HUB_GROUNDS: Readonly<Record<TownLayout["kind"], readonly [number, number]>> = {
  capital: [128, 96],
  town: [96, 96],
  village: [96, 64],
};

/** The grounds a town needs, tiles x by z (whole chunks). */
export function hubGrounds(plan: TownLayout): readonly [number, number] {
  return HUB_GROUNDS[plan.kind];
}

/** What a place of the town is, and the room behind its door. */
interface Need {
  readonly id: string;
  readonly role: Role | "arena";
  readonly title: string;
  readonly room?: InteriorKind;
  readonly place?: PlaceKind;
  readonly extra?: Partial<InteriorSpec>;
}

/** A building of the plan, sized, before it is placed. */
interface Slot {
  readonly need: Need;
  readonly style: string;
  readonly kind: string;
  readonly w: number;
  readonly d: number;
  readonly storeys: 1 | 2;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** A building placed: its footprint and its entry. */
interface Built {
  readonly slot: Slot;
  readonly f: Footprint;
  readonly b: BuildingData | null;
}

/** The town's program: its great buildings (row A), the ones by the way in (row B), and the vendors at stalls. */
function program(town: TownLayout, spec: TownSpec): { head: Need[]; near: { west: Need[]; east: Need[] }; homes: Need[] } {
  const village = town.kind === "village";
  const the = town.name.startsWith("The ") ? town.name : `The ${town.name}`;
  const temple: Need = village
    ? { id: `${town.id}-shrine`, role: "shrine", title: `${the} Shrine`, room: "temple", place: "shrine", extra: { resident: { name: "Hermit", text: ["The road is long. Sit, and let it wait for you."] } } }
    : { id: `${town.id}-temple`, role: "temple", title: town.temple, room: "temple", place: "temple", extra: { resident: { name: "Priest", text: ["Rest a while. The wells of Dominaria remember the faithful."] } } };
  const inn: Need = { id: `${town.id}-inn`, role: "inn", title: town.inn, room: "inn", place: "inn", extra: { innkeeper: { name: `The keeper of ${town.inn}`, text: town.innkeeper }, spellTable: true } };
  // A house for each of the town's folk past the first two (who are about the market), at most two: a door to knock on.
  const homes: Need[] = town.folk.slice(village ? 1 : 2, village ? 2 : 4).map((folk, n) => ({ id: `${town.id}-house-${n + 1}`, role: "home", title: `A house in ${town.name}`, room: "house", extra: { resident: folk } }));
  if (village) return { head: [temple], near: { west: [inn], east: [] }, homes };
  const tower = town.style === "tolarian";
  const guild: Need = { id: `${town.id}-guildhall`, role: "guildhall", title: town.guild, room: "guildhall", place: "guildhall", extra: { spellTable: true, resident: { name: "Guild master", text: ["Our tables are open to any mage. Build your deck in peace."] } } };
  const lore: Need = {
    id: `${town.id}-${tower ? "tower" : "library"}`,
    role: tower ? "tower" : "library",
    title: tower ? `${the} Mage's Tower` : `${the} Library`,
    room: tower ? "tower" : "library",
    place: tower ? "tower" : "library",
    extra: { resident: { name: tower ? "Archmage" : "Librarian", text: ["Every card ever printed is written down somewhere. Most of them here."] } },
  };
  const smithy: Need = { id: `${town.id}-smithy`, role: "smithy", title: `${the} Smithy`, room: "smithy", place: "smithy", extra: { armorer: true } };
  const exotic: Need[] = spec.exotic ? [{ id: `${spec.exotic.id}-shop`, role: "exotic", title: spec.exotic.name, room: "exotic-wares", place: "exotic-wares", extra: { vendor: spec.exotic } }] : [];
  const arena: Need = { id: `${town.id}-arena`, role: "arena", title: "The arena", place: "arena" };
  return { head: [guild, temple, lore], near: { west: [...exotic, inn], east: [smithy, arena] }, homes };
}

/** A need sized in the town's style: its footprint's first fit, its storeys. */
function sized(town: TownLayout, need: Need): Slot {
  if (need.role === "arena") return { need, style: town.style, kind: "arena", w: 11, d: 7, storeys: 1 };
  const role = need.role as Role;
  const style = styleFor(town, role);
  const [w, d] = sizesFor(style, role, town.kind === "capital")[0]!;
  // Row B is kept low (one storey) so the walk behind it is seen; the head stands as tall as it likes.
  const low = role === "inn" || role === "smithy" || role === "exotic";
  return { need, style, kind: kindFor(style, role), w, d, storeys: low || role === "home" ? 1 : 2, ...(role === "tower" ? { params: { floors: 3 } } : {}) };
}

/** Lays a whole town's grounds - the town within its wall, the scenery outside it - and says what it built. */
export function buildHub(target: Land, spec: TownSpec, seed: number): BuiltTown {
  const town = spec.plan;
  const F = formSpec(town);
  const random = (part: string) => randomFor(seed, `town:${town.id}:${part}`);
  const [GW, GD] = hubGrounds(town);
  const land = new Land(GW, GD);
  const I = land.idx;
  const ground = groundsOf(town);
  const country = countryOf(spec.setting.biome);
  const prog = program(town, spec);
  const capital = town.kind === "capital";
  const village = town.kind === "village";

  // --- The rows, sized ----------------------------------------------------------------------------------------------------
  const head = prog.head.map((n) => sized(town, n));
  const homes = prog.homes.map((n) => sized(town, n));
  const west = prog.near.west.map((n) => sized(town, n));
  const east = prog.near.east.map((n) => sized(town, n));
  // A village's houses stand in row B beside the inn; a town's at the head's ends.
  if (village) east.push(...homes.splice(0));
  const GAP = 2;
  const avenue = village ? 3 : 4;
  const span = (row: readonly Slot[]) => row.reduce((s, b) => s + b.w, 0) + GAP * Math.max(0, row.length - 1);
  const headSpan = span(head) + homes.reduce((s, b) => s + b.w + GAP, 0);
  const halfB = Math.max(span(west), span(east)) + 1;
  // The market's stalls: the vendors split either side of the avenue, a stall 3 wide and a tile between.
  const vendors = spec.vendors;
  const perSide = Math.ceil(vendors.length / 2);
  const stallSide = perSide * 4;
  const margin = 4;
  const TW = Math.max(headSpan, 2 * Math.max(halfB, stallSide + 2) + avenue, village ? 26 : 40) + 2 * margin;
  // The ordinary houses that fill each row's ends (painted doors, no rooms): a town's houses, a village's cottages.
  const houseRole: Role = village ? "cottage" : "house";
  const houseStyle = styleFor(town, houseRole);
  const houseSizes = sizesFor(houseStyle, houseRole, capital);
  const houseRandom = random("houses");
  let houses = 0;
  const house = (most: number): Slot | null => {
    const fits = houseSizes.filter(([, d]) => d <= most);
    if (fits.length === 0) return null;
    const [w, d] = fits[Math.floor(houseRandom() * fits.length)]!;
    return { need: { id: `${town.id}-house-${String.fromCharCode(97 + houses++)}`, role: houseRole, title: `A house in ${town.name}` }, style: houseStyle, kind: kindFor(houseStyle, houseRole), w, d, storeys: 1 };
  };
  // The walk between the rows: deeper by two than the most row B hides behind it, so its doors' row is always seen.
  const hidesBehind = (s: Slot): number => {
    const f: Footprint = { x: 0, z: 0, w: s.w, d: s.d, rot: 0, door: [Math.floor(s.w / 2), s.d] };
    const b = makeBuilding("measure", s.style, s.kind, f, () => 0.5, { storeys: s.storeys, ...(s.params ? { params: s.params } : {}) });
    return Math.max(0, ...buildingHides(b, 0).map(([, z]) => -z));
  };
  const rowB = [...west, ...east];
  const sample = house(9);
  const walk = Math.max(5, Math.min(9, Math.max(0, ...[...rowB, ...(sample ? [sample] : [])].filter((s) => s.kind !== "arena").map(hidesBehind)) + 2));
  houses = 0;
  const dA = Math.max(...head.map((s) => s.d), ...homes.map((s) => s.d));
  const dB = Math.max(...rowB.map((s) => s.d));
  const market = capital ? 18 : village ? 12 : 15;
  const NORTH = 2;
  const TD = NORTH + dA + walk + dB + market;
  // Centred across the grounds, its south wall far enough up that the road out shows below it.
  const x0 = Math.floor((GW - TW) / 2);
  const z0 = Math.max(6, Math.floor((GD - TD) / 2) - 3);
  if (x0 < 6 || z0 + TD + 10 > GD) throw new Error(`${town.id}: a town ${TW} by ${TD} does not fit its grounds ${GW} by ${GD}`);
  const x1 = x0 + TW;
  const zA = z0 + NORTH + dA; // row A's doors (the walk's first row)
  const zB = zA + walk + dB; // row B's doors (the market's first row)
  const zS = z0 + TD; // the south wall's row
  const cx = x0 + Math.floor(TW / 2); // the avenue's middle tile
  const ax0 = cx - Math.floor(avenue / 2);
  const ax1 = ax0 + avenue;

  // --- The ground: scenery everywhere, then the town within its wall ---------------------------------------------------
  const sea = new Set(spec.setting.sea);
  const shore = fbm(`${seed}:${town.id}:shore`, 9, 2);
  const isSea = (x: number, z: number): boolean => {
    for (const s of sea) {
      const off = 4 + Math.round(shore(s === "north" || s === "south" ? x : z, s.length * 5) * 5);
      if (s === "west" && x < x0 - off) return true;
      if (s === "east" && x >= x1 + off) return true;
      if (s === "north" && z < z0 - off) return true;
      // The south is where the road leaves: its shore keeps clear of the gate's road.
      if (s === "south" && z >= zS + off + 3 && Math.abs(x - cx) > 3) return true;
    }
    return false;
  };
  for (let z = 0; z < GD; z++) for (let x = 0; x < GW; x++) {
    const i = I(x, z);
    land.flags[i] = BLOCKED;
    land.use[i] = Use.Wild;
    if (isSea(x, z)) {
      land.surface[i] = S.sea;
      land.height[i] = 0;
    } else {
      land.surface[i] = country.ground;
      land.height[i] = 12;
    }
  }
  const inTown = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < zS;
  const set = (x: number, z: number, surface: number, use: Use, open = true) => {
    const i = I(x, z);
    land.surface[i] = surface;
    land.use[i] = use;
    land.flags[i] = open ? 0 : BLOCKED;
    land.height[i] = 12;
    land.town[i] = 1;
  };
  // The yards inside the wall: grass, walked (the stilts' bog is not: what is walked there is planks).
  const bog = ground.yard === S.bog;
  for (let z = z0; z < zS; z++) for (let x = x0; x < x1; x++) set(x, z, ground.yard, Use.Yard, !bog);
  // The walk, the avenue, the market.
  for (let z = zA; z < zA + walk; z++) for (let x = x0 + 1; x < x1 - 1; x++) set(x, z, ground.street, Use.Street);
  for (let z = zA + walk; z < zB; z++) for (let x = ax0; x < ax1; x++) set(x, z, ground.street, Use.Street);
  for (let z = zB; z < zS; z++) for (let x = x0 + 1; x < x1 - 1; x++) set(x, z, ground.square, Use.Kept);
  // The ring the wall stands on, closed, and the gate's passage through it.
  for (let x = x0 - 1; x <= x1; x++) for (const z of [z0 - 1, zS]) set(x, z, ground.yard, Use.Wall, false);
  for (let z = z0 - 1; z <= zS; z++) for (const x of [x0 - 1, x1]) set(x, z, ground.yard, Use.Wall, false);
  const gate: XZ[] = [];
  for (let x = cx - 1; x <= cx + 1; x++) {
    set(x, zS, ground.street, Use.Street);
    gate.push([x, zS]);
  }
  // Outside the gate: the road, and the exit just past the gate - walking onto it leaves the town.
  const exitZ = F.enclosure === "wall" || F.enclosure === "palisade" ? zS + 2 : zS + 1;
  for (let z = zS + 1; z <= exitZ; z++) for (let x = cx - 1; x <= cx + 1; x++) set(x, z, ground.street, Use.Road);
  const exit: XZ[] = [-1, 0, 1].map((d) => [cx + d, exitZ] as XZ);
  for (const [x, z] of exit) land.town[I(x, z)] = 0;
  for (let z = exitZ + 1; z < GD; z++) for (let x = cx - 1; x <= cx + 1; x++) {
    const i = I(x, z);
    if (land.surface[i] === S.sea) continue;
    land.surface[i] = country.track;
    land.use[i] = Use.Road;
  }

  // --- The buildings ------------------------------------------------------------------------------------------------------
  const builtB: Built[] = [];
  const buildingRandom = random("buildings");
  const stand = (s: Slot, fx: number, frontZ: number): Built => {
    const door: XZ = [fx + Math.floor(s.w / 2), frontZ];
    const f: Footprint = { x: fx, z: frontZ - s.d, w: s.w, d: s.d, rot: 0, door };
    for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) {
      const i = I(x, z);
      land.use[i] = s.kind === "arena" ? Use.Yard : Use.Building;
      land.flags[i] = BLOCKED | BARE;
      if (s.kind === "arena") land.surface[i] = S.sand;
    }
    if (s.kind === "arena") {
      const built: Built = { slot: s, f, b: null };
      builtB.push(built);
      return built;
    }
    const room = s.need.room;
    if (room) {
      const di = I(door[0], door[1]);
      land.use[di] = Use.Door;
      land.flags[di] = 0;
    }
    const b = makeBuilding(s.need.id, s.style, s.kind, f, buildingRandom, {
      storeys: s.storeys,
      ...(room ? { interior: s.need.id } : {}),
      ...(s.need.place ? { sign: s.need.title } : {}),
      ...(s.params ? { params: s.params } : {}),
    });
    const built: Built = { slot: s, f, b };
    builtB.push(built);
    return built;
  };
  // Row A: the temple on the avenue's axis, the guild west of it, the library or tower east, a house at either end.
  const temple = head.find((s) => s.need.role === "temple" || s.need.role === "shrine")!;
  const tx = cx - Math.floor(temple.w / 2);
  stand(temple, tx, zA);
  let wx = tx - GAP;
  let ex = tx + temple.w + GAP;
  const headWest = head.filter((s) => s !== temple).slice(0, 1);
  const headEast = head.filter((s) => s !== temple).slice(1);
  for (const s of headWest) {
    stand(s, wx - s.w, zA);
    wx -= s.w + GAP;
  }
  for (const s of headEast) {
    stand(s, ex, zA);
    ex += s.w + GAP;
  }
  homes.forEach((s, k) => {
    if (k % 2 === 0) {
      stand(s, wx - s.w, zA);
      wx -= s.w + GAP;
    } else {
      stand(s, ex, zA);
      ex += s.w + GAP;
    }
  });
  if (wx + GAP < x0 + 1 || ex - GAP > x1 - 1) throw new Error(`${town.id}: its head (${headSpan} tiles) does not fit within its wall (${TW})`);
  // Row B: west of the avenue from it outward, east likewise.
  let bw = ax0 - 1;
  for (const s of [...west].reverse()) {
    stand(s, bw - s.w, zB);
    bw -= s.w + GAP;
  }
  let be = ax1 + 1;
  for (const s of east) {
    stand(s, be, zB);
    be += s.w + GAP;
  }
  // Each row's ends filled with houses as far as the wall lets them stand (a strip by the wall kept for its garden).
  const fill = (from: number, toward: -1 | 1, frontZ: number, depth: number): void => {
    let at = from;
    for (let guard = 0; guard < 8; guard++) {
      const s = house(depth);
      if (!s) return;
      const fx = toward < 0 ? at - s.w : at;
      if (fx < x0 + 3 || fx + s.w > x1 - 3) {
        houses--;
        return;
      }
      stand(s, fx, frontZ);
      at = toward < 0 ? fx - GAP : fx + s.w + GAP;
    }
  };
  fill(wx, -1, zA, dA);
  fill(ex, 1, zA, dA);
  fill(bw, -1, zB, dB);
  fill(be, 1, zB, dB);
  // Every gap through row B is a passage from the walk to the market (the lanes by the side walls too): nobody walks
  // round to the avenue to get from a guild to a stall.
  const rowBAt = (x: number) => builtB.some((p) => p.f.door[1] === zB && x >= p.f.x && x < p.f.x + p.f.w);
  const passages: { x0: number; x1: number }[] = [];
  for (let x = x0 + 1; x < x1 - 1; x++) {
    if (rowBAt(x) || (x >= ax0 && x < ax1)) continue;
    const last = passages[passages.length - 1];
    if (last && last.x1 === x) passages[passages.length - 1] = { x0: last.x0, x1: x + 1 };
    else passages.push({ x0: x, x1: x + 1 });
  }
  for (const p of passages) for (let z = zA + walk; z < zB; z++) for (let x = p.x0; x < p.x1; x++) set(x, z, ground.path, Use.Street);

  // --- What stands about ----------------------------------------------------------------------------------------------------
  const props: PropData[] = land.fixtures;
  const npcs: NpcData[] = [];
  const places: TownPlace[] = [];
  const interiors: InteriorSpec[] = [];
  const style = town.style === "argive" ? "benalish" : town.style;
  const fixture = (p: PropData, use = Use.Kept) => {
    const { tiles, blocks } = tilesOf(p);
    if (blocks) for (const [x, z] of tiles) if (land.inside(x, z)) {
      const i = I(x, z);
      land.flags[i] = BLOCKED | BARE;
      if (land.use[i] !== Use.Wall) land.use[i] = use;
    }
    props.push(p);
  };
  const free = (x: number, z: number) => land.inside(x, z) && inTown(x, z) && land.flags[I(x, z)] === 0 && land.use[I(x, z)] !== Use.Door;
  const nearDoor = (x: number, z: number) => builtB.some((p) => p.b?.door && Math.max(Math.abs(p.f.door[0] - x), Math.abs(p.f.door[1] - z)) <= 1);
  for (const p of builtB) {
    const need = p.slot.need;
    if (p.b && need.room) {
      interiors.push({ id: need.id, name: need.title, kind: need.room, town: town.id, style: town.style, exit: p.f.door, building: { w: p.f.w, d: p.f.d }, ...(need.extra ?? {}) });
      if (need.place) places.push({ kind: need.place, name: need.title, x: p.f.door[0], z: p.f.door[1] });
    }
  }
  // The arena: a ring of wall round its sand, its barred gate in the middle of its front.
  for (const p of builtB.filter((q) => q.slot.kind === "arena")) {
    const f = p.f;
    const g: XZ = [f.x + Math.floor(f.w / 2), f.z + f.d - 1];
    const wallId = style === "keldon" ? "palisade" : "stone-wall";
    const line = (ax: number, az: number, bx2: number, bz: number) => props.push({ id: wallId, x: ax + 0.5, z: az + 0.5, args: { to: [bx2 + 0.5, bz + 0.5], h: 1 } });
    line(f.x, f.z, f.x + f.w - 1, f.z);
    line(f.x, f.z + 1, f.x, f.z + f.d - 1);
    line(f.x + f.w - 1, f.z + 1, f.x + f.w - 1, f.z + f.d - 1);
    line(f.x + 1, f.z + f.d - 1, g[0] - 2, f.z + f.d - 1);
    line(g[0] + 2, f.z + f.d - 1, f.x + f.w - 2, f.z + f.d - 1);
    props.push({ id: "arena-gate", x: g[0] + 0.5, z: g[1] + 0.5, rot: 0 });
    for (const [x, z] of [[f.x + 2, f.z + 2], [f.x + f.w - 3, f.z + 2]] as const) props.push({ id: "banner-pole", x: x + 0.5, z: z + 0.5, tint: BANNER[town.style] ?? "benalish" });
    npcs.push({ id: `${town.id}-arena`, x: g[0], z: g[1], kind: "arena", name: "The arena", text: ["The arena is closed. A sign reads: coming soon."], stand: [g[0] + 0.5, 0, g[1] + 0.5] });
    places.push({ kind: "arena", name: "The arena", x: g[0], z: g[1] });
  }

  // The market, north to south: a lane before row B's doors (the quest board on it), the stalls in a row either side of
  // the avenue (what a stall hides falls on that lane's far rows, never on a door), the vendors before their stalls, the
  // middle with its centrepiece, and a lane along the south wall where one arrives through the gate.
  const stallZ = zB + 5;
  const vendorZ = stallZ + 2;
  const stallRandom = random("stalls");
  const westVendors = vendors.slice(0, perSide);
  const eastVendors = vendors.slice(perSide);
  // Each vendor stands at the front of its stall, facing the market (under the canopy the camera would not see them).
  const stall = (v: (typeof vendors)[number], sx: number, k: number) => {
    fixture({ id: "canopy-stall", x: sx, z: stallZ + 0.8, args: { width: 3, goods: "cards" }, tint: ["red-cloth", "teal-cloth", "purple-cloth", "green-cloth"][k % 4]! });
    const at: XZ = [sx + 1, vendorZ];
    npcs.push({ id: v.id, x: at[0], z: at[1], kind: "vendor", vendor: v.id, name: v.name, figure: "shopkeeper", seed: Math.floor(stallRandom() * 997), behaviour: { rest: [0, 1], watch: 4 } });
    places.push({ kind: "shop", name: v.name, x: at[0], z: at[1] });
  };
  westVendors.forEach((v, k) => stall(v, ax0 - 2 - (k + 1) * 4 + 1, k));
  eastVendors.forEach((v, k) => stall(v, ax1 + 1 + k * 4 + 1, k + westVendors.length));
  // The centrepiece: on the avenue's axis between the vendors and the south lane where there is room for it (a free row
  // either side), else beside the avenue in line with the stalls, on the side with fewer of them.
  const kindOf = capital ? "fountain" : town.centrepiece;
  const half = kindOf === "fountain" || kindOf === "tree" ? 2 : 1;
  const onAxis = vendorZ + 2 + half <= zS - 5 - half;
  const midZ = onAxis ? vendorZ + 2 + half : stallZ;
  const pieceX = onAxis ? cx : westVendors.length > eastVendors.length ? ax1 + 2 + eastVendors.length * 4 + half + 2 : ax0 - 3 - westVendors.length * 4 - half - 2;
  const pieces: Record<string, PropData> = {
    statue: { id: "statue", x: pieceX + 0.5, z: midZ + 0.5, args: { size: 2 } },
    fountain: { id: "fountain", x: pieceX + 0.5, z: midZ + 0.5 },
    well: { id: "well", x: pieceX + 0.5, z: midZ + 0.5 },
    crystal: { id: "crystal", x: pieceX + 0.5, z: midZ + 0.5, args: { h: 2.2 } },
    tree: { id: "giant-tree", x: pieceX + 0.5, z: midZ + 0.5, args: { size: 3 } },
    brazier: { id: "fire-bowl", x: pieceX + 0.5, z: midZ + 0.5 },
  };
  fixture(pieces[kindOf] ?? pieces.well!);
  // The quest board by the inn's door, on the market.
  const inn = builtB.find((p) => p.slot.need.role === "inn")!;
  const board: XZ = [inn.f.door[0] - 3, zB + 1];
  fixture({ id: "quest-board", x: board[0] + 0.5, z: board[1] + 0.5, rot: 0 });
  const boardName = village ? "Notice board" : "Quest board";
  npcs.push({ id: `${town.id}-quest-board`, x: board[0], z: board[1], kind: "quest-board", name: boardName, text: town.board, stand: [board[0] + 0.5, 0, board[1] + 0.5] });
  places.push({ kind: "quest-board", name: boardName, x: board[0], z: board[1] });
  // The caravans' pitch: open paving east of the middle, open all round.
  let pitch: XZ | null = null;
  if (town.caravan) {
    pitch = [cx + 10, zS - 4];
    places.push({ kind: "pitch", name: "The caravans' pitch", x: pitch[0], z: pitch[1] });
  }
  const kept = new Set<number>();
  if (pitch) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) kept.add(I(pitch[0] + dx, pitch[1] + dz));
  // Lamps along the walk and at the market's corners; benches facing the middle; a few produce stalls in a market town.
  const light = STREET_LIGHT[town.style] ?? null;
  const ok = (x: number, z: number) => free(x, z) && !nearDoor(x, z) && !kept.has(I(x, z)) && (x < ax0 - 1 || x > ax1);
  if (light) {
    for (let x = x0 + 3; x < x1 - 3; x += 8) if (ok(x, zA + walk - 1)) fixture({ id: light, x: x + 0.5, z: zA + walk - 1 + 0.5 });
    for (const [x, z] of [[x0 + 2, zB + 1], [x1 - 3, zB + 1], [x0 + 2, zS - 2], [x1 - 3, zS - 2]] as const) if (ok(x, z)) fixture({ id: light, x: x + 0.5, z: z + 0.5 });
  }
  for (const dx of [-half - 3, half + 3]) {
    const x = pieceX + dx;
    if (ok(x, midZ)) fixture({ id: "bench", x: x + 0.5, z: midZ + 0.5, rot: 1, args: { width: 1.2 } });
  }
  if (!village) {
    const goods = ["apples", "cabbages", "carrots", "bread", "fish"];
    const tints = ["red-cloth", "teal-cloth"];
    for (const sx of [x0 + 3, x1 - 6]) {
      const zz = zS - 7;
      const tiles = [0, 1, 2].flatMap((k) => [-1, 0, 1].map((d) => [sx + k, zz + d] as const));
      if (!tiles.every(([x, z]) => ok(x, z))) continue;
      fixture({ id: "canopy-stall", x: sx, z: zz + 0.8, args: { width: 3, goods: goods[Math.floor(stallRandom() * goods.length)]! }, tint: tints[Math.floor(stallRandom() * 2)]! });
    }
  }
  // Gardens: flower beds and trees in the yards between the head's buildings and along the walls' inner side, where
  // they hide nothing that must be seen (the yards north of the head, the strips by the side walls).
  const yardRandom = random("yards");
  const trees = country.trees.filter((t) => t !== "great-tree");
  for (let z = z0; z < zS; z++) for (let x = x0; x < x1; x++) {
    const i = I(x, z);
    if (land.use[i] !== Use.Yard || land.flags[i] !== 0) continue;
    const northYard = z < zA - 1;
    const sideStrip = x === x0 || x === x1 - 1;
    if (!northYard && !sideStrip) continue;
    const r = yardRandom();
    if (northYard && z < z0 + 1 && r < 0.45 && trees.length > 0) {
      land.put(i, treeProp(trees[Math.floor(yardRandom() * trees.length)]!, x, z, yardRandom, 0.8), true);
      land.flags[i] = BLOCKED | BARE;
    } else if (r < 0.08) {
      land.put(i, { id: "flower-bed", x: x + 0.5, z: z + 0.5, seed: Math.floor(yardRandom() * 8) }, false);
    }
  }

  // --- The wall, and the gate ------------------------------------------------------------------------------------------------
  const kind = F.enclosure === "none" ? "hedge" : F.enclosure;
  const run = (ax: number, az: number, bx2: number, bz: number, face: string) => {
    if (kind === "hedge") props.push({ id: "hedgerow", x: ax + 0.5, z: az + 0.5, seed: Math.floor(yardRandom() * 16), args: { to: [bx2 + 0.5, bz + 0.5] } });
    else props.push({ id: "wall-run", x: ax + 0.5, z: az + 0.5, args: { to: [bx2 + 0.5, bz + 0.5], face, style, kind, size: town.kind } });
  };
  // Runs of at most 16 tiles, cut at the chunks' edges so each lies in one chunk's file.
  const cut = (a: number, b: number, at: (from: number, to: number) => void) => {
    let s = a;
    while (s <= b) {
      const e = Math.min(b, s + 15, Math.floor(s / 32) * 32 + 31);
      at(s, e);
      s = e + 1;
    }
  };
  // The wall stops at the gate's gap (a hedge's) or at the gatehouse's towers (two tiles either side of the passage).
  const gapW = cx - 1 - (kind === "hedge" ? 0 : 2);
  const gapE = cx + 1 + (kind === "hedge" ? 0 : 2);
  cut(x0 - 1, x1, (a, b) => run(a, z0 - 1, b, z0 - 1, "n"));
  cut(x0 - 1, gapW - 1, (a, b) => run(a, zS, b, zS, "s"));
  cut(gapE + 1, x1, (a, b) => run(a, zS, b, zS, "s"));
  cut(z0, zS - 1, (a, b) => run(x0 - 1, a, x0 - 1, b, "w"));
  cut(z0, zS - 1, (a, b) => run(x1, a, x1, b, "e"));
  if (kind !== "hedge") {
    for (const [x, z] of [[x0 - 1, z0 - 1], [x1, z0 - 1], [x0 - 1, zS], [x1, zS]] as const) props.push({ id: "wall-tower", x: x + 0.5, z: z + 0.5, args: { style, kind, size: town.kind } });
    const gh: PropData = { id: "gatehouse", x: cx + 0.5, z: zS + 0.5, rot: 0, args: { width: 3, style, kind, size: town.kind } };
    fixture(gh, Use.Wall);
    // The gatehouse's towers stand on the wall's ring and a row either side of it; its passage stays open.
    for (const [x, z] of tilesOf(gh).tiles) {
      const i = I(x, z);
      land.flags[i] = BLOCKED | BARE;
      land.use[i] = Use.Wall;
    }
    for (let z = zS - 1; z <= zS + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) land.flags[I(x, z)] = 0;
  } else {
    // A hedge's gap: a post either side of it.
    for (const x of [cx - 2, cx + 2]) props.push({ id: "banner-pole", x: x + 0.5, z: zS + 0.5, tint: BANNER[town.style] ?? "benalish" });
  }

  // --- The scenery outside: the country of its biome, never walked -----------------------------------------------------
  const sceneryRandom = random("scenery");
  const woods = fbm(`${seed}:${town.id}:woods`, 14, 2);
  const farming = country.fields.some((s) => s === S.wheat || s === S.furrows || s === S.straw);
  for (let z = 0; z < GD; z++) for (let x = 0; x < GW; x++) {
    const i = I(x, z);
    if (land.use[i] !== Use.Wild || land.surface[i] === S.sea) continue;
    const away = Math.max(x0 - 1 - x, x - x1, z0 - 1 - z, z - zS, 0);
    if (away < 2) continue;
    if (Math.abs(x - cx) <= 2 && z > zS) continue;
    const d = woods(x, z);
    if (farming && d < 0.45 && away > 4) {
      // Fields in strips, a crop to each band of rows.
      const band = Math.floor((z + Math.floor(x / 12) * 3) / 6);
      land.surface[i] = country.fields[band % country.fields.length]!;
      continue;
    }
    const density = 0.12 + country.wood * 0.6 + (d - 0.5) * 0.5;
    if (sceneryRandom() < density) {
      const id = sceneryRandom() < 0.85 ? country.trees[Math.floor(sceneryRandom() * country.trees.length)]! : country.undergrowth[Math.floor(sceneryRandom() * country.undergrowth.length)]!;
      land.put(i, treeProp(id, x, z, sceneryRandom, id === "great-tree" ? 0.6 : 1), true);
    }
  }
  // Nothing grows on the road out.
  for (let z = zS + 1; z < GD; z++) for (let x = cx - 1; x <= cx + 1; x++) land.decor.delete(I(x, z));

  // --- The people ------------------------------------------------------------------------------------------------------------
  const region = REGION_OF_STYLE[town.style] ?? "benalia";
  const openAt = (x: number, z: number) => free(x, z) && land.use[I(x, z)] === Use.Kept && !nearDoor(x, z);
  const near = (want: XZ): XZ | null => {
    for (let r = 0; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (openAt(want[0] + dx, want[1] + dz)) return [want[0] + dx, want[1] + dz];
    return null;
  };
  const folkHere = town.folk.slice(0, village ? 1 : 2);
  const spots: XZ[] = [[cx - 8, zS - 4], [cx + 6, vendorZ + 1], [cx - 3, zB + 2], [cx + 12, zB + 2]];
  folkHere.forEach((folk, n) => {
    const at = near(spots[n % spots.length]!);
    if (!at) return;
    npcs.push({ id: `${town.id}-folk-${n + 1}`, x: at[0], z: at[1], kind: "townsfolk", name: folk.name, text: folk.text, figure: `townsfolk-${region}`, speed: 1.6, seed: n + 1, behaviour: { wander: { home: at, reach: 4, pause: [2, 6] }, watch: 3 } });
  });
  if (F.guards && !village) {
    const a = near([cx - 3, zS - 3]);
    const b = near([cx - 3, zB + 3]);
    if (a && b) npcs.push({ id: `${town.id}-guard-1`, x: a[0], z: a[1], kind: "guard", name: `${town.name} guard`, text: ["Keep to the roads. The waymarkers say how bad it gets past them."], figure: `guard-${region}`, seed: 1, speed: 2.2, behaviour: { beat: { stops: [a, b], pause: 3.5 }, watch: 4 } });
  }

  // --- The plan as the world keeps it --------------------------------------------------------------------------------------
  const nodes: XZ[] = [
    [cx, exitZ], // 0: the gate's way out, where the road arrives
    [cx, zB], // 1: the avenue at the market's head
    [cx, zA + 1], // 2: the avenue on the walk
  ];
  const ways: StreetWay[] = [
    { a: 0, b: 1, width: 3, main: true },
    { a: 1, b: 2, width: avenue, main: true },
  ];
  for (const p of passages) {
    // A passage's middle line, from the walk's last row to the market's first, its brush covering its width.
    const w = Math.min(6, p.x1 - p.x0);
    const mid = p.x0 + Math.floor((w - 1) / 2);
    nodes.push([mid, zA + walk - 1], [mid, zB]);
    ways.push({ a: nodes.length - 2, b: nodes.length - 1, width: w });
  }
  const squares: TownSquare[] = [
    { x: x0 + 1, z: zA, w: TW - 2, d: walk, name: "The walk" },
    { x: x0 + 1, z: zB, w: TW - 2, d: zS - zB, name: "The market" },
  ];
  const outline: XZ[] = [[x0 - 1, z0 - 1], [x1 + 1, z0 - 1], [x1 + 1, zS + 1], [x0 - 1, zS + 1]];
  const plan: TownPlan = { outline, enclosure: F.enclosure, nodes, ways, squares, gates: [0], places };
  const inside: XZ = [cx, zS - 3];
  const townWays: TownWay[] = spec.setting.ways.map((w) => ({ side: w.side, inside, exit, to: w.to }));
  const radius = Math.ceil(Math.max(TW, TD) / 2) + 1;
  const centre: XZ = [cx, Math.floor((z0 + zS) / 2)];
  const data = {
    id: town.id,
    name: town.name,
    kind: town.kind,
    center: centre,
    radius,
    style: town.style,
    ...(spec.color ? { region: spec.color } : {}),
    start: town.start,
    ...(town.home ? { home: town.home } : {}),
    plan,
    grounds: [0, 0, GW, GD] as [number, number, number, number],
    ways: townWays,
  };
  const report = {
    walled: [TW, TD] as [number, number],
    grounds: [GW, GD] as [number, number],
    buildings: builtB.filter((p) => p.b).length,
    interiors: interiors.length,
    gateToSquare: 0,
    squareToPlace: zS - zA,
    notes: [],
  };
  return shift(target, land, spec, data, {
    buildings: builtB.flatMap((p) => (p.b ? [p.b] : [])),
    interiors,
    npcs,
    inn: { x: inn.f.door[0], z: inn.f.door[1], interior: `${town.id}-inn` },
    pitch,
    report,
    gate: nodes[0]!,
  });
}

/** Moves everything built into the world at the grounds' origin and writes the grounds into the world's Land. */
function shift(
  target: Land,
  land: Land,
  spec: TownSpec,
  data: BuiltTown["data"],
  built: { buildings: BuildingData[]; interiors: InteriorSpec[]; npcs: NpcData[]; inn: { x: number; z: number; interior: string }; pitch: XZ | null; report: BuiltTown["report"]; gate: XZ },
): BuiltTown {
  const [ox, oz] = spec.origin;
  if (!target.inside(ox, oz) || !target.inside(ox + land.width - 1, oz + land.depth - 1)) throw new Error(`${spec.plan.id}: its grounds at ${ox},${oz} reach past the world`);
  const tagN = spec.index + 1;
  for (let z = 0; z < land.depth; z++) for (let x = 0; x < land.width; x++) {
    const i = land.idx(x, z);
    const j = target.idx(ox + x, oz + z);
    target.height[j] = land.height[i]!;
    target.surface[j] = land.surface[i]!;
    target.flags[j] = land.flags[i]!;
    target.use[j] = land.use[i]!;
    target.town[j] = land.town[i] ? tagN : 0;
    target.townArea[j] = 1;
    target.decor.delete(j);
  }
  const sxz = (p: XZ): XZ => [p[0] + ox, p[1] + oz];
  const shiftProp = (p: PropData): PropData => {
    const to = p.args?.to;
    const args = Array.isArray(to) ? { ...p.args, to: [(to[0] as number) + ox, (to[1] as number) + oz] } : p.args;
    return { ...p, x: p.x + ox, z: p.z + oz, ...(args ? { args } : {}) };
  };
  for (const [i, p] of land.decor) target.decor.set(target.idx(ox + land.xOf(i), oz + land.zOf(i)), shiftProp(p));
  for (const p of land.fixtures) target.fixtures.push(shiftProp(p));
  const npcs = built.npcs.map((n) => {
    const b = n.behaviour;
    const behaviour = b ? { ...b, ...(b.wander ? { wander: { ...b.wander, home: sxz(b.wander.home) } } : {}), ...(b.beat ? { beat: { ...b.beat, stops: b.beat.stops.map(sxz) } } : {}) } : undefined;
    return { ...n, x: n.x + ox, z: n.z + oz, ...(n.stand ? { stand: [n.stand[0] + ox, n.stand[1], n.stand[2] + oz] as const } : {}), ...(behaviour ? { behaviour } : {}) };
  });
  const p = data.plan!;
  const plan: TownPlan = {
    outline: p.outline.map(sxz),
    enclosure: p.enclosure,
    nodes: p.nodes.map(sxz),
    ways: p.ways.map((w) => ({ ...w, ...(w.via ? { via: w.via.map(sxz) } : {}) })),
    squares: p.squares.map((s) => ({ ...s, x: s.x + ox, z: s.z + oz })),
    gates: p.gates,
    places: p.places.map((q) => ({ ...q, x: q.x + ox, z: q.z + oz })),
  };
  const gates = new Map<string, number>([["gate-1", target.idx(built.gate[0] + ox, built.gate[1] + oz)]]);
  return {
    data: { ...data, center: sxz(data.center), plan, grounds: [ox, oz, ox + land.width, oz + land.depth], ways: data.ways.map((w) => ({ ...w, inside: sxz(w.inside), exit: w.exit.map(sxz) })) },
    buildings: built.buildings.map((b) => ({ ...b, x: b.x + ox, z: b.z + oz, ...(b.door ? { door: sxz(b.door) } : {}) })),
    interiors: built.interiors.map((r) => ({ ...r, exit: sxz(r.exit) as [number, number] })),
    npcs,
    gates,
    inn: { x: built.inn.x + ox, z: built.inn.z + oz, interior: built.inn.interior },
    pitch: built.pitch ? { x: built.pitch[0] + ox, z: built.pitch[1] + oz } : null,
    report: built.report,
  };
}

