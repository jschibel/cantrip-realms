// The large world's mesas (source.ts), apart from it so the end-to-end tests can find them without reading the world.

/** The mesas' surfaces, in order: north-west, north-east, south-west, south-east. */
export const MESAS = ["snow", "sand", "rock", "tundra"] as const;
/** A mesa's north-west corner (16 tiles wide, 14 deep). */
export const mesaAt = (i: number): { x: number; z: number } => ({ x: 184 + (i % 2) * 35 + 8, z: 134 + Math.floor(i / 2) * 26 + 5 });
/** A mesa's level at a tile of it: the west half 2, the east 1, its north-east corner notched out. */
export const mesaLevel = (k: number, j: number): number => (k < 0 || j < 0 || k >= 16 || j >= 14 || (k >= 11 && j < 5) ? 0 : k < 6 ? 2 : 1);
