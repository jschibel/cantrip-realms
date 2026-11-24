import type { BuildingData, PlaceKind, RoadData, TownData, TownPlan, XZ } from "./world/format";
import { inPolygon, streetTiles, wayMiddle } from "./world/streets";

// A town's map (tech.md B5, the HUD), drawn from its street plan (world/format.ts, `TownPlan`) north up: the ground
// within its outline, the roads arriving, its streets and squares paved light with dark kerbs so they read apart from
// the ground, its buildings as blocks (those with a door in brighter), its wall, its gates, and its key places as
// icons. The minimap draws it small round the player; the whole map draws it big, with the places and the gates named.
// DOM-free but for the canvas it draws on.

/** How each kind of place is marked: its icon's letter and color, and what the legend calls it. */
export const PLACE_LOOK: Readonly<Record<PlaceKind, { readonly glyph: string; readonly color: string; readonly label: string }>> = {
  inn: { glyph: "I", color: "#ffc94a", label: "inn, spell table" },
  shop: { glyph: "$", color: "#5fd07a", label: "shop" },
  "exotic-wares": { glyph: "$", color: "#c69cff", label: "exotic wares" },
  guildhall: { glyph: "G", color: "#7fb8ff", label: "mages' guild, spell table" },
  temple: { glyph: "T", color: "#f2f2f6", label: "temple" },
  shrine: { glyph: "T", color: "#f2f2f6", label: "shrine" },
  library: { glyph: "L", color: "#d9a066", label: "library" },
  tower: { glyph: "L", color: "#7fe7ff", label: "mage's tower" },
  smithy: { glyph: "A", color: "#a9b4c2", label: "smithy, armorer" },
  "quest-board": { glyph: "!", color: "#ff8fc8", label: "quest board" },
  arena: { glyph: "X", color: "#e05a5a", label: "arena (closed)" },
  pitch: { glyph: "C", color: "#ffa040", label: "caravans" },
};

/** The ground within a town and its roofs, by style. */
const GROUND: Readonly<Record<string, string>> = { benalish: "#56703f", argive: "#56703f", llanowar: "#3d5832", urborg: "#3a3b30", keldon: "#6b7364", tolarian: "#5c7a4a" };
const ROOF: Readonly<Record<string, string>> = { benalish: "#a8503c", argive: "#a8503c", llanowar: "#6f8f3c", urborg: "#5a4866", keldon: "#86603e", tolarian: "#5c7cc0" };
const WALL: Readonly<Record<TownPlan["enclosure"], string | null>> = { wall: "#2c2c33", palisade: "#4f3620", hedge: "#22401c", none: null };

/** Each gate of a plan: its node (where the road arrives) and the tile where its way in crosses the outline. */
export function gatesOf(plan: TownPlan): { node: XZ; wall: XZ }[] {
  return plan.gates.map((g) => {
    const node = plan.nodes[g]!;
    const way = plan.ways.find((w) => w.a === g || w.b === g);
    if (!way) return { node, wall: node };
    const middle = wayMiddle(plan, way);
    if (way.b === g) middle.reverse();
    const wall = middle.find(([x, z]) => inPolygon(plan.outline, x, z)) ?? node;
    return { node, wall };
  });
}

/** A town drawn from its plan at `scale` pixels a tile, over the tiles within `radius + 10` of its centre. */
export class TownPicture {
  readonly canvas: HTMLCanvasElement;
  /** Its first tile, and how many tiles it covers along x and z. */
  readonly x0: number;
  readonly z0: number;
  readonly span: number;

  constructor(
    readonly town: TownData,
    readonly scale: number,
    buildings: readonly BuildingData[],
    roads: readonly RoadData[],
  ) {
    const plan = town.plan!;
    const reach = town.radius + 10;
    this.x0 = town.center[0] - reach;
    this.z0 = town.center[1] - reach;
    this.span = reach * 2 + 1;
    const s = scale;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.span * s;
    this.canvas.height = this.span * s;
    const g = this.canvas.getContext("2d")!;
    const px = (x: number) => (x - this.x0) * s;
    const pz = (z: number) => (z - this.z0) * s;
    g.fillStyle = "#1d241b";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // The roads arriving, three tiles across.
    g.fillStyle = "#86704c";
    for (const r of roads) for (const [x, z] of r.tiles) if (x >= this.x0 - 1 && z >= this.z0 - 1 && x <= this.x0 + this.span && z <= this.z0 + this.span) g.fillRect(px(x - 1), pz(z - 1), s * 3, s * 3);
    // The ground within the outline.
    g.beginPath();
    plan.outline.forEach(([x, z], k) => (k === 0 ? g.moveTo(px(x + 0.5), pz(z + 0.5)) : g.lineTo(px(x + 0.5), pz(z + 0.5))));
    g.closePath();
    g.fillStyle = GROUND[town.style] ?? GROUND.benalish!;
    g.fill();
    // The streets and squares: a dark kerb round them, then their paving.
    const tiles = [...streetTiles(plan)].map((k) => k.split(",").map(Number) as [number, number]);
    const kerb = Math.max(1, Math.round(s / 3));
    g.fillStyle = "#2a2419";
    for (const [x, z] of tiles) g.fillRect(px(x) - kerb, pz(z) - kerb, s + kerb * 2, s + kerb * 2);
    for (const [x, z] of tiles) {
      g.fillStyle = plan.squares.some((q) => x >= q.x && z >= q.z && x < q.x + q.w && z < q.z + q.d) ? "#ece2c4" : "#d6c9a8";
      g.fillRect(px(x), pz(z), s, s);
    }
    // The buildings: blocks in the style's roof, those with a door brighter, each edged dark.
    const roof = ROOF[town.style] ?? ROOF.benalish!;
    for (const b of buildings) {
      g.fillStyle = "#17130f";
      g.fillRect(px(b.x) - 1, pz(b.z) - 1, b.w * s + 2, b.d * s + 2);
      g.fillStyle = b.interior ? roof : shade(roof, 0.62);
      g.fillRect(px(b.x), pz(b.z), b.w * s, b.d * s);
    }
    // The wall along the outline, and its gates.
    const wall = WALL[plan.enclosure];
    if (wall) {
      g.beginPath();
      plan.outline.forEach(([x, z], k) => (k === 0 ? g.moveTo(px(x + 0.5), pz(z + 0.5)) : g.lineTo(px(x + 0.5), pz(z + 0.5))));
      g.closePath();
      g.lineWidth = Math.max(2, s * 0.9);
      g.strokeStyle = wall;
      g.stroke();
    }
    for (const { wall: [x, z] } of gatesOf(plan)) {
      g.fillStyle = "#0b0c10";
      g.fillRect(px(x - 1) - 1, pz(z - 1) - 1, s * 3 + 2, s * 3 + 2);
      g.fillStyle = "#e8c860";
      g.fillRect(px(x - 1), pz(z - 1), s * 3, s * 3);
    }
  }

  /** Where a tile's middle is on the picture, pixels. */
  at(x: number, z: number): { x: number; y: number } {
    return { x: (x - this.x0 + 0.5) * this.scale, y: (z - this.z0 + 0.5) * this.scale };
  }
}

/** A place's icon at (x, y): a disc of its color, edged dark, its letter on it, `r` pixels across the middle. */
export function drawPlace(g: CanvasRenderingContext2D, kind: PlaceKind, x: number, y: number, r: number): void {
  const look = PLACE_LOOK[kind];
  g.beginPath();
  g.arc(x, y, r + 1, 0, Math.PI * 2);
  g.fillStyle = "#0b0c10";
  g.fill();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = look.color;
  g.fill();
  g.fillStyle = "#0b0c10";
  g.font = `bold ${Math.max(7, Math.round(r * 1.5))}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(look.glyph, x, y + 0.5);
  g.textAlign = "start";
  g.textBaseline = "alphabetic";
}

const shade = (hex: string, k: number): string => {
  const v = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k));
  return `#${v.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};
