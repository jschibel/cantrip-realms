// The voxel model format (realms/content/models/<id>.vox.json; realms/docs/interfaces.md, "Models"). Characters, mobs
// and gear are cut into parts - a head, a torso, arms and legs, or a wurm's segments - each a small grid of
// palette-indexed voxels, so they read as pixel art at the overworld's scale (one voxel is about one scene pixel). A
// part turns about its pivot when it is animated; gear hangs on a body's attachment points.

/** Where a gear piece hangs on a body. */
export const ATTACH_POINTS = [
  "head-top",
  "brow",
  "neck",
  "torso",
  "back",
  "arm-left",
  "arm-right",
  "hand-left",
  "hand-right",
  "leg-left",
  "leg-right",
  "foot-left",
  "foot-right",
  "orbit",
] as const;
export type AttachPoint = (typeof ATTACH_POINTS)[number];

/** How a part moves when its model walks or stands: limbs swing, wings beat, a body bobs. */
export const MOTIONS = [
  "none",
  "bob",
  "float",
  "leg-left",
  "leg-right",
  "arm-left",
  "arm-right",
  "wing-left",
  "wing-right",
  "tail",
  "segment",
] as const;
export type Motion = (typeof MOTIONS)[number];

export type Vec3 = readonly [number, number, number];

export interface VoxPart {
  /** Unique within the model: `head`, `torso`, `arm-left`, `segment-3`... */
  readonly name: string;
  /** The part it hangs from, which it moves with; none for a part on the model's root. */
  readonly parent?: string;
  /** For a gear piece: the body's attachment point it hangs on (instead of `parent`). */
  readonly mount?: AttachPoint;
  /**
   * Where the part turns: for a child part, a point in its parent's grid (in the parent's voxels, as `origin` is in
   * this part's); for a root part, a point in the model's space, whose 0,0,0 is the ground under the model's centre; for
   * a gear piece, an offset in voxels from the attachment point it hangs on.
   */
  readonly pivot: Vec3;
  /** The pivot's position in this part's own grid, in voxels (fractions allowed: 1.5 is between voxels 1 and 2). */
  readonly origin: Vec3;
  readonly motion?: Motion;
  /** Grid size in voxels: width (x), height (y), depth (z). */
  readonly size: Vec3;
  /**
   * The voxels, bottom layer first: `layers[y][z]` is a row of `size[0]` characters along x, "." for empty and
   * otherwise the palette index in base 36 ("0"-"9", "a"-"z").
   */
  readonly layers: readonly (readonly string[])[];
  /** Drawn unlit, at full brightness: a ring's glow, a spirit's eyes. */
  readonly glow?: boolean;
  /**
   * For a gear piece: the size, in voxels, of the body region it was made to fit (the `size` of the attachment point
   * it hangs on). On a body whose region is another size the piece is stretched to fit along each axis whose `fit` is
   * not 0, so one armour fits every body.
   */
  readonly fit?: Vec3;
}

export interface VoxModel {
  /** The file's name without `.vox.json`: what a mob's or a gear item's `look.mesh` names. */
  readonly id: string;
  readonly kind: "body" | "mob" | "gear";
  /** World units per voxel edge. 1/16 is one scene pixel (render.ts). */
  readonly voxel: number;
  /**
   * The colors a voxel's index picks: "#rrggbb", or "$n" for the n-th color of the palette the model is drawn with -
   * a body's skin, hair and cloth, a mob's or a gear item's `look.palette` (interfaces.md). A "$n" past the end of the
   * palette it is given falls back to the last one given.
   */
  readonly palette: readonly string[];
  readonly parts: readonly VoxPart[];
  /**
   * A body's attachment points: the part each is on, where in it (in that part's voxels), and the size of the region
   * there a gear piece covers (a torso's width, height and depth; a hand's), which gear `fit`s are stretched to.
   */
  readonly attach?: Partial<Record<AttachPoint, { readonly part: string; readonly at: Vec3; readonly size?: Vec3 }>>;
}
