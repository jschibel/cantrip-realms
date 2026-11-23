import type { BuildingData, XYZ } from "../../world/format";
import { MeshBuilder } from "../paint/builder";
import { type Built, Registry } from "../recipe";

// The buildings registry, by style: each region's style is one entry (benalish.ts is Benalia's), drawing a building
// of any `kind` it knows from a `BuildingData` and a palette. A style lays its building out facing south on its
// footprint; `placeBuilding` turns it to the building's `rot`.

export const BUILDINGS = new Registry<BuildingData>("building style");

/** One building a style shows in the gallery and recommends to the world's layout: a kind at a footprint, with its params. */
export interface Showcase {
  readonly kind: string;
  /** Footprint, world units (tiles), facing south. */
  readonly w: number;
  readonly d: number;
  /** A size or variant's name: small, large, two-storey... */
  readonly label?: string;
  readonly palette?: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly sign?: string;
}

const showcases: Record<string, Showcase[]> = {};

/** Each style's kinds and sizes as it shows them (the gallery's street, and the sizes the world's towns use). */
export const SHOWCASE: Readonly<Record<string, readonly Showcase[]>> = showcases;

/** Records the kinds and sizes a style shows. */
export function showcase(style: string, items: readonly Showcase[]): void {
  (showcases[style] ??= []).push(...items);
}

/**
 * Draws a building on its footprint, turned to face its `rot`. `draw` lays it out facing south (+z) between x0..x1 and
 * z0..z1 and returns where its door is, if it has one. Facing south it is drawn where it stands, in world coordinates;
 * turned, it is drawn about its footprint's middle and turned there (tiled faces still follow the world's grid).
 */
export function placeBuilding(building: BuildingData, draw: (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined): Built {
  const b = new MeshBuilder();
  const rot = ((building.rot % 4) + 4) % 4;
  const { x, z, w, d } = building;
  if (rot === 0) {
    const doorway = draw(b, x, z, x + w, z + d);
    return { model: b.model(), doorway };
  }
  // Its own width runs along its front: across the world's z when it faces east or west.
  const across = rot % 2 === 0 ? w : d;
  const deep = rot % 2 === 0 ? d : w;
  const cx = x + w / 2;
  const cz = z + d / 2;
  const turn = (-rot * Math.PI) / 2;
  let local: XYZ | undefined;
  b.at(cx, 0, cz, turn, () => {
    local = draw(b, -across / 2, -deep / 2, across / 2, deep / 2);
  });
  let doorway: XYZ | undefined;
  if (local) {
    const [lx, ly, lz] = local;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    doorway = [cx + lx * c + lz * s, ly, cz - lx * s + lz * c];
  }
  return { model: b.model(), doorway };
}
