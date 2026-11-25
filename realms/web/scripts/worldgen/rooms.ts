// The interiors behind the towns' doors (interfaces.md, "Interiors"): each building's room, laid out by the room recipes'
// `layoutRoom` (art/rooms/layout.ts) from its kind, its town's style, its building's footprint and a seed of its id - its
// floor, its furniture, its fires' and windows' light, and the people who keep it - with the town's own people laid over
// the recipe's keepers: the vendor behind the shop's counter (by the vendor's id), the innkeeper behind the bar, the
// armorer at the forge, the priest or the shrine's keeper - a healer, who sells hearts (design.md A3b) -, the librarian, the
// guild's master; the spell tables named for their town; a resident at home. The file holds what the recipe chose.

import { layoutRoom, type RoomKind } from "../../src/art/rooms/layout";
import { fnv1a32 } from "../../src/random";
import type { InteriorData, NpcData } from "../../src/world/format";
import { BLOCKED } from "../../src/world/format";
import type { InteriorSpec } from "./towns";

/** The art's region of a town's style: its people dress as the region does (art/figures/npcs.ts). */
export const REGION_OF_STYLE: Readonly<Record<string, string>> = { benalish: "benalia", llanowar: "llanowar", urborg: "caligo", keldon: "keld", tolarian: "orvada", argive: "benalia" };

/** The townsfolk figure of a style. */
export const townsfolkOf = (style: string): string => `townsfolk-${REGION_OF_STYLE[style] ?? "benalia"}`;

/** The figure and look of the keeper the recipe stands in each kind of room. */
function keeperOf(spec: InteriorSpec): Partial<NpcData> {
  const seed = fnv1a32(`keeper:${spec.id}`) % 997;
  const folk = { figure: townsfolkOf(spec.style), seed };
  switch (spec.kind) {
    case "shop":
    case "exotic-wares": {
      const v = spec.vendor!;
      return { id: v.id, kind: "vendor", vendor: v.id, name: v.name, figure: spec.kind === "exotic-wares" ? "planar-trader" : "shopkeeper", seed };
    }
    case "inn":
      return { id: `${spec.town}-innkeeper`, name: spec.innkeeper!.name, text: spec.innkeeper!.text, figure: "innkeeper", seed };
    case "smithy":
      return spec.armorer
        ? { id: `${spec.town}-armorer`, kind: "armorer", name: "Armorer", ...folk }
        : { id: `${spec.id}-smith`, kind: "townsfolk", name: "Smith", text: ["Nothing for sale here. Try the town's armorer."], ...folk };
    case "temple":
      // A temple's priest or a shrine's keeper heals: they sell hearts.
      return { id: `${spec.id}-keeper`, kind: "healer", name: spec.resident?.name ?? "Priest", text: spec.resident?.text ?? [], ...folk };
    default:
      return spec.resident ? { id: `${spec.id}-${spec.kind === "guildhall" ? "master" : "keeper"}`, name: spec.resident.name, text: spec.resident.text, ...folk } : folk;
  }
}

/** A room behind a town's door. */
export function buildInterior(spec: InteriorSpec): InteriorData {
  const room = layoutRoom({
    id: spec.id,
    name: spec.name,
    town: spec.town,
    kind: spec.kind as RoomKind,
    style: spec.style,
    seed: fnv1a32(`interior:${spec.id}`),
    ...(spec.building ? { building: spec.building } : {}),
    exit: spec.exit,
    keeper: keeperOf(spec),
  });
  // The spell tables keep the ids players and the server know them by: the inn's and the guild's, named for their town.
  const tables = room.npcs.filter((n) => n.kind === "spell-table");
  const tableId = spec.kind === "inn" ? `${spec.town}-inn-spell-table` : spec.kind === "guildhall" ? `${spec.town}-guild-spell-table` : null;
  const npcs: NpcData[] = room.npcs.map((n) => (n.kind === "spell-table" && tableId && n === tables[0] ? { ...n, id: tableId } : n));
  if (spec.spellTable && tables.length === 0) throw new Error(`${spec.id}: its ${spec.kind} has no spell table`);
  // A house's resident, at home: wandering the open floor nearest its middle.
  if (spec.kind === "house" && spec.resident) {
    const home = nearestOpen(room, Math.floor(room.w / 2), Math.floor(room.d / 2) - 1, npcs);
    if (home) {
      npcs.push({
        id: `${spec.id}-resident`,
        x: home[0],
        z: home[1],
        kind: "townsfolk",
        name: spec.resident.name,
        text: spec.resident.text,
        figure: townsfolkOf(spec.style),
        speed: 1.2,
        seed: fnv1a32(`resident:${spec.id}`) % 997,
        behaviour: { wander: { home: [home[0], home[1]], reach: 2, pause: [3, 8] }, watch: 3 },
      });
    }
  }
  const out: InteriorData = { ...room, npcs };
  const problems = roomProblems(out);
  if (problems.length > 0) throw new Error(`${spec.id}: ${problems.join("; ")}`);
  return out;
}

/** The open tile nearest a point that nobody stands on, short of the door's row. */
function nearestOpen(room: InteriorData, x0: number, z0: number, npcs: readonly NpcData[]): [number, number] | null {
  let best: [number, number, number] | null = null;
  for (let z = 1; z < room.d - 1; z++) {
    for (let x = 0; x < room.w; x++) {
      const t = room.tiles[z * room.w + x]!;
      if (t[1] === "" || (t[2] & BLOCKED) !== 0 || npcs.some((n) => n.x === x && n.z === z)) continue;
      const d = Math.hypot(x - x0, z - z0);
      if (!best || d < best[2]) best = [x, z, d];
    }
  }
  return best ? [best[0], best[1]] : null;
}

/**
 * What would leave a room unusable: its way in blocked, a stretch of its floor cut off from the door that is not behind
 * a counter, someone nobody can reach to speak to (within two tiles, across a counter).
 */
export function roomProblems(room: InteriorData): string[] {
  const problems: string[] = [];
  const W = room.w;
  const open = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < room.d && (room.tiles[z * W + x]![2] & BLOCKED) === 0 && room.tiles[z * W + x]![1] !== "";
  const [ex, ez] = room.entry;
  if (!open(ex, ez) || !open(ex, ez - 1)) return [`its way in at ${ex},${ez} is not open`];
  const seen = new Set<number>([ez * W + ex]);
  const queue = [[ex, ez] as const];
  while (queue.length > 0) {
    const [x, z] = queue.shift()!;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if ((!dx && !dz) || !open(nx, nz) || seen.has(nz * W + nx)) continue;
        if (dx && dz && !(open(x + dx, z) && open(x, z + dz))) continue;
        seen.add(nz * W + nx);
        queue.push([nx, nz]);
      }
    }
  }
  for (const n of room.npcs) {
    const reach = n.kind === "spell-table" ? 1 : 2;
    let ok = false;
    for (let dz = -reach; dz <= reach && !ok; dz++) for (let dx = -reach; dx <= reach && !ok; dx++) ok = seen.has((n.z + dz) * W + (n.x + dx)) && n.x + dx >= 0 && n.x + dx < W;
    if (!ok) problems.push(`nobody can reach ${n.id} at ${n.x},${n.z}`);
  }
  let walked = 0;
  for (let z = 0; z < room.d; z++) for (let x = 0; x < W; x++) if (open(x, z)) walked++;
  if (seen.size < walked * 0.8) problems.push(`only ${seen.size} of its ${walked} open tiles are reached from the door`);
  return problems;
}
