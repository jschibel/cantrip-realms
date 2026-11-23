// The world's built things, in boxes like the rest of the scenery (props.ts): buildings in each region's style
// (Benalish stone and banners, Tolarian domes, Urborg's stilt-houses, Keldon longhouses, Llanowar's tree-houses, the
// capital's brick and tile), town walls, gates and lamps, the waymarkers of the tier zones, dungeons' ways in by
// theme, and the furniture of interiors. `buildStructure` draws one prop, standing on the point `boxes` is placed at.

import type { PropData } from "../world/schema";
import { Boxes, type PropTint, buildProp } from "./props";
import type { PropKind } from "../world/schema";

interface Look {
  readonly wall: string;
  readonly wall2: string;
  readonly roof: string;
  readonly roof2: string;
  readonly trim: string;
  readonly banner: string;
  readonly stone: string;
}

const LOOKS: Record<string, Look> = {
  argive: { wall: "#bcbfc9", wall2: "#979cab", roof: "#85382c", roof2: "#5a2420", trim: "#73472b", banner: "#ffc94a", stone: "#757b8c" },
  benalish: { wall: "#e0e0e3", wall2: "#bcbfc9", roof: "#85382c", roof2: "#5a2420", trim: "#979cab", banner: "#fff8de", stone: "#979cab" },
  tolarian: { wall: "#bcbfc9", wall2: "#84bfd3", roof: "#33739a", roof2: "#22557c", trim: "#e0e0e3", banner: "#3f62e8", stone: "#757b8c" },
  urborg: { wall: "#4d2f1f", wall2: "#3e4252", roof: "#2e3140", roof2: "#1b1d26", trim: "#575c6e", banner: "#7a32b0", stone: "#3e4252" },
  keldon: { wall: "#73472b", wall2: "#4d2f1f", roof: "#4d2f1f", roof2: "#2e1c14", trim: "#ad5238", banner: "#e02a3a", stone: "#575c6e" },
  llanowar: { wall: "#c08b55", wall2: "#9a663c", roof: "#285a3a", roof2: "#3b7a45", trim: "#4d2f1f", banner: "#1fbf62", stone: "#757b8c" },
};

/** The colors of the tiers, on waymarkers, the regional map and the HUD: 1 green to 4 red. */
export const TIER_COLORS: readonly string[] = ["#979cab", "#1fbf62", "#ffc94a", "#f58a3a", "#e02a3a"];

const lookOf = (style: string | undefined): Look => LOOKS[style ?? "argive"] ?? LOOKS.argive!;

/** The unit vector a front faces, and the axis across it. */
function axes(front: string | undefined): { nx: number; nz: number; ax: number; az: number } {
  switch (front) {
    case "x+":
      return { nx: 1, nz: 0, ax: 0, az: 1 };
    case "x-":
      return { nx: -1, nz: 0, ax: 0, az: 1 };
    case "z-":
      return { nx: 0, nz: -1, ax: 1, az: 0 };
    default:
      return { nx: 0, nz: 1, ax: 1, az: 0 };
  }
}

/** Draws one prop; the kinds the old scenery knows are drawn by it, tinted for the region. */
export function buildStructure(b: Boxes, prop: PropData, tint: PropTint, random: () => number): void {
  switch (prop.kind) {
    case "building":
      return building(b, prop, random);
    case "entrance":
      return entrance(b, prop);
    case "gate":
      return gate(b, prop);
    case "waymarker":
      return waymarker(b, prop.tier ?? 1, prop.style === "banner");
    case "wall":
      return prop.h !== undefined ? innerWall(b, prop) : prop.style ? townWall(b, lookOf(prop.style)) : buildProp(b, "wall", tint, random);
    case "tower":
      return prop.style ? townTower(b, lookOf(prop.style)) : buildProp(b, "tower", tint, random);
    case "lamp": {
      b.box(0.1, 1.5, 0.1, "#2e3140", 0, 0.75, 0);
      b.box(0.3, 0.3, 0.3, "#ffc94a", 0, 1.6, 0, { glow: true });
      b.box(0.36, 0.06, 0.36, "#2e3140", 0, 1.78, 0);
      return;
    }
    case "dock":
      b.box(0.22, 1.2, 0.22, "#73472b", 0, 0.1, 0);
      b.box(0.3, 0.08, 0.3, "#4d2f1f", 0, 0.72, 0);
      return;
    case "counter":
      b.box(1.5, 0.75, 0.8, "#73472b", 0, 0.38, 0);
      b.box(1.6, 0.08, 0.9, "#9a663c", 0, 0.78, 0);
      b.box(0.25, 0.15, 0.25, "#ffc94a", 0.3, 0.9, 0, { glow: random() < 0.3 });
      return;
    case "shelf":
      b.box(1.5, 1.6, 0.5, "#4d2f1f", 0, 0.8, 0);
      for (const y of [0.45, 0.9, 1.35]) {
        b.box(0.3, 0.25, 0.3, ["#ad5238", "#5296b5", "#ffc94a", "#1fbf62"][Math.floor(random() * 4)]!, -0.4, y, 0.1);
        b.box(0.35, 0.2, 0.3, ["#bcbfc9", "#8e82c8", "#9a663c"][Math.floor(random() * 3)]!, 0.35, y, 0.1);
      }
      return;
    case "bookshelf":
      b.box(1.5, 2.0, 0.5, "#4d2f1f", 0, 1.0, 0);
      for (const y of [0.35, 0.8, 1.25, 1.7]) for (let x = -0.55; x <= 0.56; x += 0.22) b.box(0.18, 0.32, 0.36, ["#85382c", "#173a5c", "#43722c", "#73472b", "#5e5294"][Math.floor(random() * 5)]!, x, y, 0.05);
      return;
    case "bed":
      b.box(1.0, 0.4, 1.6, "#73472b", 0, 0.2, 0);
      b.box(0.9, 0.12, 1.4, "#e0e0e3", 0, 0.46, 0.05);
      b.box(0.9, 0.14, 0.4, "#f2f7f8", 0, 0.5, -0.55);
      b.box(0.9, 0.1, 0.9, "#85382c", 0, 0.54, 0.25);
      return;
    case "table":
      b.box(1.1, 0.08, 1.1, "#9a663c", 0, 0.7, 0);
      b.box(0.15, 0.7, 0.15, "#4d2f1f", 0, 0.35, 0);
      b.box(0.15, 0.2, 0.15, "#ffc94a", 0.2, 0.84, 0.1, { glow: true });
      for (const [x, z] of [[0.7, 0], [-0.7, 0]] as const) b.box(0.35, 0.45, 0.35, "#73472b", x, 0.22, z);
      return;
    case "hearth":
      b.box(1.6, 1.4, 0.7, "#757b8c", 0, 0.7, 0);
      b.box(0.9, 0.6, 0.2, "#1b1d26", 0, 0.35, 0.3);
      b.box(0.6, 0.35, 0.15, "#f58a3a", 0, 0.25, 0.35, { glow: true });
      b.box(0.5, 1.6, 0.5, "#575c6e", 0, 2.0, -0.1);
      return;
    case "pew":
      b.box(1.5, 0.45, 0.45, "#73472b", 0, 0.23, 0);
      b.box(1.5, 0.5, 0.1, "#4d2f1f", 0, 0.65, -0.2);
      return;
    case "forge":
      b.box(1.4, 0.9, 1.2, "#2e3140", 0, 0.45, 0);
      b.box(1.0, 0.25, 0.8, "#f58a3a", 0, 0.95, 0, { glow: true });
      b.box(0.6, 2.0, 0.6, "#575c6e", 0, 2.0, -0.3);
      b.box(0.3, 0.3, 0.3, "#ffc94a", 0, 1.15, 0.1, { glow: true });
      return;
    default:
      return buildProp(b, prop.kind as Parameters<typeof buildProp>[1], tint, random);
  }
}

/** A building: walls and windows in its town's style, a roof for its region, and what marks its use. */
function building(b: Boxes, p: PropData, random: () => number): void {
  const look = lookOf(p.style);
  const w = p.w ?? 3;
  const d = p.d ?? 3;
  const h = p.h ?? 2;
  const { nx, nz, ax, az } = axes(p.front);
  const extentFront = Math.abs(nx) > 0 ? w / 2 : d / 2;
  const extentAcross = Math.abs(nx) > 0 ? d / 2 : w / 2;
  const onFront = (across: number, y: number, sw: number, sh: number, color: string, glow = false, out = 0.06) =>
    b.box(Math.abs(ax) > 0 ? sw : 0.08, sh, Math.abs(az) > 0 ? sw : 0.08, color, nx * (extentFront + out) + ax * across, y, nz * (extentFront + out) + az * across, { glow });
  const windows = (y: number, lit: number) => {
    for (let a = -extentAcross + 0.8; a <= extentAcross - 0.8; a += 1.2) if (Math.abs(a) > 0.6) onFront(a, y, 0.4, 0.45, random() < lit ? "#ffc94a" : "#1b1d26", false);
  };
  if (p.use === "mage-tower") {
    // A tall stack, narrowing, a pointed roof, windows glowing up it.
    const r = Math.min(w, d);
    b.box(r, h * 0.55, r, look.wall, 0, h * 0.275, 0);
    b.box(r * 0.85, h * 0.3, r * 0.85, look.wall2, 0, h * 0.7, 0);
    for (let k = 0; k < 4; k++) b.box(r * (0.95 - k * 0.22), 0.5, r * (0.95 - k * 0.22), k % 2 ? look.roof2 : look.roof, 0, h * 0.85 + k * 0.45, 0);
    for (let y = 1; y < h * 0.8; y += 1.4) onFront(0, y, 0.35, 0.6, "#8e82c8", true);
    return;
  }
  switch (p.style) {
    case "urborg": {
      // On stilts above the mud.
      const lift = 0.8;
      for (const [x, z] of [[-w / 2 + 0.2, -d / 2 + 0.2], [w / 2 - 0.2, -d / 2 + 0.2], [-w / 2 + 0.2, d / 2 - 0.2], [w / 2 - 0.2, d / 2 - 0.2]] as const) b.box(0.22, lift, 0.22, "#2e1c14", x, lift / 2, z);
      b.box(w + 0.2, 0.15, d + 0.2, look.trim, 0, lift, 0);
      b.box(w * 0.92, h * 0.6, d * 0.92, look.wall, 0, lift + h * 0.3, 0);
      b.box(w, 0.3, d, look.roof, 0, lift + h * 0.6 + 0.1, 0);
      b.box(w * 0.6, 0.35, d * 0.6, look.roof2, 0, lift + h * 0.6 + 0.4, 0);
      onFront(0, lift + 0.5, 0.5, 0.35, random() < 0.4 ? "#8e82c8" : "#1b1d26", true, 0.0);
      break;
    }
    case "keldon": {
      // A longhouse: low timber walls under a steep roof along its length.
      const long = w >= d ? "x" : "z";
      b.box(w, h * 0.45, d, look.wall, 0, h * 0.225, 0);
      for (let k = 0; k < 4; k++) {
        const f = 1 - k * 0.24;
        b.box(long === "x" ? w + 0.2 : w * f, h * 0.18, long === "z" ? d + 0.2 : d * f, k === 3 ? look.trim : k % 2 ? look.roof2 : look.roof, 0, h * 0.45 + k * h * 0.17, 0);
      }
      windows(h * 0.25, 0.35);
      break;
    }
    case "llanowar": {
      // A tree-house: the trunk, the house up in the boughs, the canopy over it.
      const lift = 1.4;
      b.box(0.8, lift + h * 0.4, 0.8, "#4d2f1f", 0, (lift + h * 0.4) / 2, 0);
      b.box(w * 0.85, 0.15, d * 0.85, look.trim, 0, lift, 0);
      b.box(w * 0.7, h * 0.5, d * 0.7, look.wall, 0, lift + h * 0.25, 0);
      b.box(w * 1.05, 0.6, d * 1.05, look.roof, 0, lift + h * 0.5 + 0.3, 0);
      b.box(w * 0.75, 0.55, d * 0.75, look.roof2, 0, lift + h * 0.5 + 0.8, 0);
      b.box(w * 0.4, 0.4, d * 0.4, look.roof, 0, lift + h * 0.5 + 1.2, 0);
      onFront(0, lift + h * 0.25, 0.5, 0.4, random() < 0.5 ? "#ffc94a" : "#1b1d26", true, -w * 0.15);
      break;
    }
    case "tolarian": {
      b.box(w, h * 0.6, d, look.wall, 0, h * 0.3, 0);
      b.box(w + 0.1, 0.15, d + 0.1, look.trim, 0, h * 0.6, 0);
      const r = Math.min(w, d);
      for (let k = 0; k < 4; k++) b.box(r * (0.9 - k * 0.2), h * 0.12, r * (0.9 - k * 0.2), k % 2 ? look.roof2 : look.roof, 0, h * 0.66 + k * h * 0.11, 0);
      b.box(0.12, 0.6, 0.12, look.trim, 0, h * 1.15, 0);
      windows(h * 0.32, 0.4);
      break;
    }
    default: {
      // Stone (Benalia) or the capital's plastered brick: walls, a stepped gable roof.
      const flat = p.use === "warehouse";
      b.box(w, h * (flat ? 0.85 : 0.62), d, look.wall, 0, h * (flat ? 0.425 : 0.31), 0);
      b.box(w + 0.12, 0.12, d + 0.12, look.trim, 0, 0.06, 0);
      if (flat) {
        b.box(w + 0.1, 0.25, d + 0.1, look.wall2, 0, h * 0.85 + 0.1, 0);
      } else {
        const long = w >= d ? "x" : "z";
        for (let k = 0; k < 3; k++) {
          const f = 1 - k * 0.3;
          b.box(long === "x" ? w + 0.2 : w * f + 0.2, h * 0.14, long === "z" ? d + 0.2 : d * f + 0.2, k % 2 ? look.roof2 : look.roof, 0, h * 0.62 + k * h * 0.13 + 0.07, 0);
        }
      }
      windows(h * 0.35, 0.35);
      if ((p.use === "tenement" || p.use === "guildhall") && h > 3) windows(h * 0.65 - 0.2, 0.25);
      if (p.style === "benalish") onFront(extentAcross - 0.4, h * 0.45, 0.35, 0.9, look.banner);
      break;
    }
  }
  switch (p.use) {
    case "temple": {
      // A spire at the back.
      const bx = -nx * (extentFront - 1);
      const bz = -nz * (extentFront - 1);
      b.box(1.4, h * 1.4, 1.4, look.wall2, bx, h * 0.7, bz);
      for (let k = 0; k < 3; k++) b.box(1.3 - k * 0.4, 0.5, 1.3 - k * 0.4, look.roof, bx, h * 1.4 + k * 0.45, bz);
      b.box(0.2, 0.5, 0.2, "#ffc94a", bx, h * 1.4 + 1.5, bz, { glow: true });
      break;
    }
    case "inn":
      // A hanging sign by the door.
      onFront(extentAcross * 0.6, h * 0.55, 0.7, 0.45, "#9a663c", false, 0.4);
      onFront(extentAcross * 0.6, h * 0.55, 0.4, 0.2, "#ffc94a", true, 0.46);
      break;
    case "smithy": {
      const cx = -ax * (extentAcross - 0.6);
      const cz = -az * (extentAcross - 0.6);
      b.box(0.7, h * 1.5, 0.7, look.stone, cx, h * 0.75, cz);
      b.box(0.4, 0.25, 0.4, "#f58a3a", cx, h * 1.5 + 0.1, cz, { glow: true });
      break;
    }
    case "shop":
      // An awning in the shop's color over the front.
      b.box(Math.abs(ax) > 0 ? extentAcross * 1.6 : 0.9, 0.1, Math.abs(az) > 0 ? extentAcross * 1.6 : 0.9, look.banner, nx * (extentFront + 0.4), h * 0.5, nz * (extentFront + 0.4));
      break;
    case "guildhall":
      onFront(-extentAcross + 0.5, h * 0.55, 0.4, 1.2, look.banner);
      onFront(extentAcross - 0.5, h * 0.55, 0.4, 1.2, look.banner);
      break;
    case "library":
      for (let a = -extentAcross + 1; a <= extentAcross - 1; a += 1.4) onFront(a, h * 0.4, 0.3, 1.1, "#5296b5", true, 0.05);
      break;
    default:
      break;
  }
}

/** A dungeon's way in, by its theme. */
function entrance(b: Boxes, p: PropData): void {
  const w = p.w ?? 4;
  const d = p.d ?? 4;
  const h = p.h ?? 3;
  const { nx, nz, ax, az } = axes(p.front);
  const extentFront = Math.abs(nx) > 0 ? w / 2 : d / 2;
  const mouth = (sw: number, sh: number, color: string, glow = false) =>
    b.box(Math.abs(ax) > 0 ? sw : 0.1, sh, Math.abs(az) > 0 ? sw : 0.1, color, nx * (extentFront + 0.04), sh / 2, nz * (extentFront + 0.04), { glow });
  switch (p.style) {
    case "caves":
      b.box(w, h * 0.7, d, "#575c6e", 0, h * 0.35, 0);
      b.box(w * 0.7, h * 0.4, d * 0.7, "#575c6e", -0.3, h * 0.85, 0.2);
      b.box(w * 0.4, h * 0.3, d * 0.4, "#757b8c", 0.4, h * 1.1, -0.3);
      mouth(1.4, 1.5, "#0b0c10");
      break;
    case "castle":
      b.box(w * 0.8, h * 0.7, d * 0.8, "#bcbfc9", 0, h * 0.35, 0);
      for (const [x, z] of [[-w / 2 + 0.6, -d / 2 + 0.6], [w / 2 - 0.6, -d / 2 + 0.6], [-w / 2 + 0.6, d / 2 - 0.6], [w / 2 - 0.6, d / 2 - 0.6]] as const) {
        b.box(1.2, h, 1.2, "#e0e0e3", x, h / 2, z);
        b.box(1.4, 0.3, 1.4, "#979cab", x, h + 0.15, z);
      }
      for (let k = -2; k <= 2; k++) b.box(0.35, 0.35, 0.35, "#e0e0e3", ax * k * 0.8 + nx * (extentFront - 0.6), h * 0.7 + 0.17, az * k * 0.8 + nz * (extentFront - 0.6));
      mouth(1.4, 1.9, "#1b1d26");
      b.box(0.5, 0.8, 0.05, "#fff8de", ax * 1.4 + nx * (extentFront + 0.1), h * 0.5, az * 1.4 + nz * (extentFront + 0.1));
      break;
    case "tower": {
      const r = Math.min(w, d);
      b.box(r, h * 0.7, r, "#979cab", 0, h * 0.35, 0);
      b.box(r * 0.85, h * 0.25, r * 0.85, "#bcbfc9", 0, h * 0.82, 0);
      for (let k = 0; k < 4; k++) b.box(r * (0.95 - k * 0.22), 0.55, r * (0.95 - k * 0.22), k % 2 ? "#22557c" : "#5e5294", 0, h * 0.95 + k * 0.5, 0);
      b.box(0.3, 0.3, 0.3, "#8e82c8", 0, h * 0.95 + 2.2, 0, { glow: true });
      for (let y = 2; y < h * 0.8; y += 1.6) b.box(Math.abs(ax) > 0 ? 0.35 : 0.08, 0.6, Math.abs(az) > 0 ? 0.35 : 0.08, "#8e82c8", nx * (r / 2 + 0.05), y, nz * (r / 2 + 0.05), { glow: true });
      mouth(1.0, 1.6, "#1b1d26");
      break;
    }
    case "crypt":
      b.box(w, h * 0.65, d, "#575c6e", 0, h * 0.33, 0);
      for (let k = 0; k < 3; k++) b.box(w * (1 - k * 0.3), 0.3, d * (1 - k * 0.3), "#2e3140", 0, h * 0.65 + k * 0.3, 0);
      for (const s of [-1, 1]) b.box(0.4, h * 0.65, 0.4, "#757b8c", ax * s * 0.9 + nx * (extentFront + 0.2), h * 0.33, az * s * 0.9 + nz * (extentFront + 0.2));
      mouth(1.1, 1.5, "#0b0c10");
      b.box(0.3, 0.3, 0.3, "#8e82c8", nx * (extentFront + 0.3), h * 0.75, nz * (extentFront + 0.3), { glow: true });
      break;
    case "hollow":
      for (const s of [-1, 1]) {
        b.box(1.0, h * 0.8, 1.0, "#4d2f1f", ax * s * 1.2, h * 0.4, az * s * 1.2);
        b.box(0.6, 0.6, 1.6, "#4d2f1f", ax * s * 1.7, 0.3, az * s * 1.7);
      }
      b.box(w, h * 0.3, d, "#2f5424", 0, h * 0.95, 0);
      b.box(w * 0.7, h * 0.3, d * 0.7, "#43722c", 0, h * 1.2, 0);
      b.box(1.8, 0.6, 1.2, "#4d2f1f", 0, h * 0.75, 0);
      mouth(1.4, 1.6, "#0b0c10");
      break;
    case "foundry":
      b.box(w, h * 0.75, d, "#2e3140", 0, h * 0.38, 0);
      b.box(w + 0.1, 0.2, d + 0.1, "#ad5238", 0, h * 0.75, 0);
      for (const s of [-1, 1]) {
        b.box(0.8, h * 1.4, 0.8, "#575c6e", ax * s * (w / 4) - nx * 0.8, h * 0.7, az * s * (d / 4) - nz * 0.8);
        b.box(0.5, 0.3, 0.5, "#f58a3a", ax * s * (w / 4) - nx * 0.8, h * 1.45, az * s * (d / 4) - nz * 0.8, { glow: true });
      }
      mouth(1.6, 1.6, "#f58a3a", true);
      break;
    case "portal":
      for (const s of [-1, 1]) {
        b.box(0.7, h, 0.7, "#2e3140", ax * s * (w / 2 - 0.4), h / 2, az * s * (w / 2 - 0.4));
        b.box(0.3, 1.2, 0.3, "#bcbfc9", ax * s * (w / 2 - 0.4), h + 0.6, az * s * (w / 2 - 0.4));
      }
      b.box(Math.abs(ax) > 0 ? w : 0.7, 0.6, Math.abs(az) > 0 ? w : 0.7, "#2e3140", 0, h, 0);
      b.box(Math.abs(ax) > 0 ? w - 1.4 : 0.15, h - 0.4, Math.abs(az) > 0 ? w - 1.4 : 0.15, "#8e82c8", 0, (h - 0.4) / 2, 0, { glow: true });
      b.box(w * 0.5, 0.3, d * 0.5, "#85382c", -nx * 1, 0.15, -nz * 1);
      break;
    default:
      b.box(w, h, d, "#757b8c", 0, h / 2, 0);
      mouth(1.2, 1.6, "#0b0c10");
  }
}

function gate(b: Boxes, p: PropData): void {
  const look = lookOf(p.style);
  const { ax, az } = axes(p.front);
  for (const s of [-1, 1]) b.box(0.6, 2.4, 0.6, look.stone, ax * s * 1.4, 1.2, az * s * 1.4);
  b.box(Math.abs(ax) > 0 ? 3.4 : 0.7, 0.5, Math.abs(az) > 0 ? 3.4 : 0.7, look.stone, 0, 2.5, 0);
  b.box(Math.abs(ax) > 0 ? 0.8 : 0.1, 0.6, Math.abs(az) > 0 ? 0.8 : 0.1, look.banner, 0, 2.1, 0);
}

function townWall(b: Boxes, look: Look): void {
  b.box(1.75, 1.7, 1.75, look.stone, 0, 0.85, 0);
  b.box(0.5, 0.35, 0.5, look.wall2, -0.55, 1.88, -0.55);
  b.box(0.5, 0.35, 0.5, look.wall2, 0.55, 1.88, 0.55);
}

function townTower(b: Boxes, look: Look): void {
  b.box(1.8, 3, 1.8, look.stone, 0, 1.5, 0);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) b.box(0.4, 0.4, 0.4, look.wall2, x, 3.2, z);
  b.box(0.8, 1.0, 0.05, look.banner, 0, 2.2, 0.93);
}

function innerWall(b: Boxes, p: PropData): void {
  const look = lookOf(p.style);
  const h = p.h ?? 2.4;
  b.box(1.76, h, 1.76, look.wall, 0, h / 2, 0);
  if (h > 1) b.box(1.78, 0.2, 1.78, look.trim, 0, h - 0.1, 0);
}

/** A tier's boundary: a stone (or a banner by a road) in the tier's color, its number in glowing pips up its face. */
export function waymarker(b: Boxes, tier: number, banner: boolean): void {
  const color = TIER_COLORS[tier] ?? TIER_COLORS[0]!;
  if (banner) {
    b.box(0.12, 2.4, 0.12, "#4d2f1f", 0, 1.2, 0);
    b.box(0.9, 1.1, 0.06, color, 0.48, 1.75, 0);
    for (let k = 0; k < tier; k++) b.box(0.14, 0.14, 0.08, "#f2f7f8", 0.25 + k * 0.17, 1.7, 0.04, { glow: true });
    b.box(1.0, 0.1, 0.1, "#ffc94a", 0.5, 2.32, 0);
  } else {
    b.box(0.7, 1.5, 0.5, "#979cab", 0, 0.75, 0);
    b.box(0.74, 0.3, 0.54, color, 0, 1.45, 0);
    for (let k = 0; k < tier; k++) b.box(0.14, 0.14, 0.06, color, 0, 0.3 + k * 0.25, 0.27, { glow: true });
  }
}
