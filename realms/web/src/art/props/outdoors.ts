import { MeshBuilder } from "../paint/builder";
import * as C from "../paint/colors";
import * as D from "./draw";
import { bool, drawn, needs, num, point, str } from "./registry";

// Scenery out of doors, by id: the street's furniture and the open country's. Anchors are as each says; `args.to` is a
// line's far end or a rectangle's far corner, world units.

type Goods = "apples" | "cabbages" | "carrots" | "bread" | "fish";

// --- Goods and furniture of the street -------------------------------------------------------------------------------

drawn("barrel", "a barrel, its middle at x, z; args.h its height (0.8)", (b, p) => D.barrel(b, p.x, p.z, num(p, "h", 0.8)));
drawn(
  "crate",
  "a crate, its middle at x, z, standing at y, turned by turn; args.size its side (0.75), args.goods what is heaped in it (apples, cabbages, carrots, bread, fish) or its lid on",
  (b, p) => D.crate(b, p.x, p.z, num(p, "size", 0.75), str<Goods>(p, "goods"), p.y ?? 0, p.turn ?? 0),
);
drawn("sack", "a sack of grain at x, z", (b, p) => D.sack(b, p.x, p.z));
drawn("pot", "a clay pot at x, z, standing at y; args.r its radius (0.2)", (b, p) => D.pot(b, p.x, p.z, p.y ?? 0, num(p, "r", 0.2)));
drawn("lamp-post", "a street lamp at x, z", (b, p) => D.lampPost(b, p.x, p.z));
drawn("bench", "a bench of planks on stone feet, its middle at x, z; args.width (1.6)", (b, p) => D.bench(b, p.x, p.z, num(p, "width", 1.6)));
drawn("market-stall", "a market stall from x along args.width, its counter's line at z", (b, p) => D.stall(b, p.x, p.z, num(p, "width", 3.4)), {}, needs({ width: "number" }));
drawn(
  "fountain",
  "a tiered fountain, its middle at x, z (its water slides)",
  (b, p) => {
    D.fountain(b, p.x, p.z);
  },
);
drawn("gravestone", "a gravestone at x, z, leaning by turn", (b, p) => D.gravestone(b, p.x, p.z, p.turn ?? 0));
drawn("railings", "iron railings from x, z to args.to", (b, p) => {
  const [x1, z1] = point(p, "to");
  D.railings(b, p.x, p.z, x1, z1);
}, {}, needs({ to: "point" }));
drawn(
  "hedge-wall",
  "a low fieldstone wall with a hedge along its top, from x to args.to's x along z",
  (b, p, pal) => D.hedgeWall(b, p.x, point(p, "to")[0], p.z, pal.leaves),
  { leaves: C.LEAF },
  needs({ to: "point" }),
);

// --- Trees, hedges and stone -----------------------------------------------------------------------------------------

drawn(
  "tree",
  "a broadleaf tree at x, z, its size scale (1), its crown's shape seed; args.fine draws its crown as the slice did (three times the triangles)",
  (b, p, pal) => D.tree(b, p.x, p.z, p.scale ?? 1, p.seed ?? 0, pal.leaves, bool(p, "fine") ? 2 : 1),
  { leaves: C.LEAF },
  undefined,
  (b, p, pal) => D.tree(b, p.x, p.z, p.scale ?? 1, p.seed ?? 0, pal.leaves, 0),
);
drawn(
  "bush",
  "a round bush at x, z; args.r its radius (0.45), args.flowering",
  (b, p, pal) => D.bush(b, p.x, p.z, num(p, "r", 0.45), bool(p, "flowering"), pal.leaves, bool(p, "fine") ? 2 : 1),
  { leaves: C.LEAF },
);
drawn(
  "hedgerow",
  "a hedgerow from x, z to args.to, its wobble seed",
  (b, p, pal) => {
    const [x1, z1] = point(p, "to");
    D.hedgeRow(b, p.x, p.z, x1, z1, p.seed ?? 0, pal.leaves, bool(p, "fine") ? 2 : 1);
  },
  { leaves: C.LEAF },
  needs({ to: "point" }),
  (b, p, pal) => {
    const [x1, z1] = point(p, "to");
    D.hedgeRow(b, p.x, p.z, x1, z1, p.seed ?? 0, pal.leaves, 0);
  },
);
drawn("boulder", "a boulder at x, z; args.r its radius (0.5), its shape seed", (b, p) => D.boulder(b, p.x, p.z, num(p, "r", 0.5), p.seed ?? 0));
drawn("stepping-stone", "a flat stone in a stream at x, z", (b, p) => D.steppingStone(b, p.x, p.z));

// --- The open country's set pieces ------------------------------------------------------------------------------------

drawn(
  "town-wall",
  "a town wall running south from x, z to args.to's z, its outer face west, a gate over the road between args.gate's two z's: its south tower and lintel are cut down while the player is in the gateway",
  (b, p) => {
    const [g0, g1] = point(p, "gate");
    const full = new MeshBuilder();
    const low = new MeshBuilder();
    D.townWall(b, p.x, p.z, point(p, "to")[1], g0, g1, full, low);
    // In or about the gateway the tower south of it would stand in front of the player: it is cut down.
    return { cutaways: [{ full: full.model(), low: low.model(), when: { player: [p.x - 4, g0 - 2, p.x + 2.5, g1 + 0.5] } }] };
  },
  {},
  needs({ to: "point", gate: "point" }),
);
drawn(
  "bridge",
  "a stone bridge from x, z to args.to, its deck at args.y",
  (b, p) => {
    const [x1, z1] = point(p, "to");
    D.bridge(b, p.x, x1, p.z, z1, num(p, "y", 0.25));
  },
  {},
  needs({ to: "point" }),
);
drawn(
  "terrace",
  "a raised terrace of turf from x, z to args.to, args.y high, its banks of rock",
  (b, p) => {
    const [x1, z1] = point(p, "to");
    D.terrace(b, p.x, p.z, x1, z1, num(p, "y", 0.75));
  },
  {},
  needs({ to: "point", y: "number" }),
);
drawn(
  "ruined-tower",
  "a ruined round tower at x, z standing at y; args.r its radius, args.low and args.high its broken top's heights",
  (b, p) => D.ruinedTower(b, p.x, p.z, p.y ?? 0, num(p, "r", 2.4), num(p, "low", 1.6), num(p, "high", 5.5)),
);
