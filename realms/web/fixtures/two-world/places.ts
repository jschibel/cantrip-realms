import type { Rect, XZ } from "../../src/world/format";

// Where things are in the two-scale fixture (source.ts), apart from it so the end-to-end suites can read them without
// the art the fixture's props are checked by.

/** The travel map, and Twoford's grounds (chunks 6 to 8 across: three empty chunks, 3 to 5, between them). */
export const TRAVEL: Rect = [0, 0, 96, 96];
export const GROUNDS: Rect = [192, 0, 288, 96];
/** The walked ground of the grounds: the basin within the bank. */
export const BASIN: Rect = [200, 8, 280, 88];
/** The town's icon on the travel map (a town's: 5 by 5), and its middle in its grounds. */
export const SITE: XZ = [48, 40];
export const CENTER: XZ = [240, 44];
/** Twoford's ways: west (out along the road to the west), and south toward the caves. */
export const WEST = { side: "west", outside: [45, 40], inside: [203, 44], exit: [[196, 43], [196, 44], [196, 45]] } as const;
export const SOUTH = { side: "south", outside: [48, 43], inside: [240, 83], exit: [[239, 91], [240, 91], [241, 91]], to: "two-caves" } as const;
/** The dungeon's way in, on the travel map; a tile of the wood; the inn's door. */
export const ENTRANCE: XZ = [20, 70];
export const WOOD: XZ = [10, 58];
export const INN_DOOR: XZ = [228, 42];

