import * as C from "../paint/colors";
import type { Ramp } from "../paint/palette";
import type { Rgb } from "../paint/pixmap";
import { cloth, layer, rows } from "./faces";
import { type V3, cutTo, glowing, part, solid } from "./paints";
import { at, full } from "./ramps";
import type { PartSpec } from "./rig";

// What a figure holds: a spear, a staff with its head, a sword, an axe, a bow, a shield, a book, a lantern, a ferryman's
// pole, a trident, a club, a hammer, a wrench, a torch. Each is parts on a hand - the bottom of an arm - built for that
// arm's size, so one item fits every body and every creature that has hands.

export type StaffHead = "orb" | "crystal" | "skull" | "leaves" | "sun" | "crook" | "hourglass" | "flame" | "moon";

export type Held =
  | { readonly kind: "spear"; readonly shaft?: Ramp; readonly head?: Ramp; readonly length?: number; readonly pennant?: Ramp }
  | { readonly kind: "staff"; readonly shaft?: Ramp; readonly top: StaffHead; readonly glow?: Ramp; readonly length?: number }
  | { readonly kind: "sword"; readonly blade?: Ramp; readonly hilt?: Ramp; readonly length?: number; readonly flame?: boolean }
  | { readonly kind: "axe"; readonly blade?: Ramp; readonly haft?: Ramp; readonly big?: boolean }
  | { readonly kind: "bow"; readonly wood?: Ramp }
  | { readonly kind: "shield"; readonly face: Ramp; readonly trim?: Ramp; readonly emblem?: Ramp; readonly round?: boolean }
  | { readonly kind: "book"; readonly cover: Ramp }
  | { readonly kind: "lantern"; readonly light?: Ramp }
  | { readonly kind: "pole" }
  | { readonly kind: "trident"; readonly metal?: Ramp }
  | { readonly kind: "club"; readonly wood?: Ramp; readonly size?: number }
  | { readonly kind: "hammer"; readonly head?: Ramp }
  | { readonly kind: "wrench"; readonly metal?: Ramp }
  | { readonly kind: "torch" }
  | { readonly kind: "dagger"; readonly blade?: Ramp }
  | { readonly kind: "scythe"; readonly blade?: Ramp };

const WOOD = full(C.WOOD);
const IRON = full(C.IRON);
const GOLD = full(C.GOLD);
const FIRE = full(C.FIRE);

/**
 * The parts of an item held in the hand of `arm` ("arm.l" or "arm.r"), an arm `size` texels: its pivot at the hand,
 * reaching up (and out to the figure's own side, `side` 1 left and -1 right, for blades that show their face).
 */
export function heldParts(item: Held, arm: string, size: V3, side: 1 | -1): PartSpec[] {
  // Every item hangs from the hand: its first part on the arm, the rest on that.
  return itemParts(item, arm, size, side).map((p) => (p.parent ? p : { ...p, parent: arm }));
}

function itemParts(item: Held, arm: string, size: V3, side: 1 | -1): PartSpec[] {
  const [, ah, ad] = size;
  const hand: V3 = [0, -ah + 2, ad / 2];
  const n = `${arm}.${item.kind}`;
  switch (item.kind) {
    case "spear": {
      const shaft = item.shaft ?? WOOD;
      const head = item.head ?? IRON;
      const len = item.length ?? 30;
      const out = [
        part(n, [1, len, 1], hand, [-0.5, -6, -0.5], { front: layer(cloth(shaft, 4), rows(0, 3, at(head, 5)), rows(0, 0, at(head, 6))), left: layer(cloth(shaft, 3), rows(0, 3, at(head, 4))), top: cloth(head, 6, false) }, at(shaft, 4)),
      ];
      if (item.pennant) out.push(part(`${n}.pennant`, [1, 4, 5], [0, len - 10, 0], [0, -4, -5], { left: layer(cloth(item.pennant, 3), cutTo((x, y, w, h) => y < h - Math.floor((x / w) * 2) || x < 2)), right: cloth(item.pennant, 2) }, at(item.pennant, 3), { parent: n, motion: { kind: "tail", delay: 0, amount: 0.3, axis: "y", rate: 4 } }));
      return out;
    }
    case "staff": {
      const shaft = item.shaft ?? WOOD;
      const len = item.length ?? 24;
      const glow = item.glow ?? full(C.WATER);
      const staff = part(n, [1, len, 1], hand, [-0.5, -5, -0.5], { front: layer(cloth(shaft, 4), (p) => p.put(0, Math.floor(p.height * 0.6), at(shaft, 2))), left: cloth(shaft, 3), top: cloth(shaft, 5, false) }, at(shaft, 4));
      const tip: V3 = [0, len - 5, 0];
      const top = ((): PartSpec[] => {
        switch (item.top) {
          case "orb":
            return [part(`${n}.orb`, [3, 3, 3], tip, [-1.5, 0, -1.5], { front: glowing(glow), left: glowing(glow), top: glowing(glow) }, at(glow, 5), { parent: n, glow: true, round: 1 })];
          case "crystal":
            return [
              part(`${n}.claw`, [3, 2, 3], tip, [-1.5, 0, -1.5], solid(GOLD, 3), at(GOLD, 3), { parent: n }),
              part(`${n}.crystal`, [2, 4, 2], [0, len - 3, 0], [-1, 0, -1], { front: layer(glowing(glow), cutTo((x, y, w, h) => y > 0 || x === 0)), left: glowing(glow), top: glowing(glow) }, at(glow, 5), { parent: n, glow: true, round: 0 }),
            ];
          case "skull":
            return [part(`${n}.skull`, [3, 3, 3], tip, [-1.5, 0, -1.5], { front: layer(cloth(C.BONE, 4), (p) => { p.put(0, 1, 0xff4a3a); p.put(2, 1, 0xff4a3a); p.put(1, 2, C.INK); }), left: cloth(C.BONE, 3), top: cloth(C.BONE, 5, false) }, at(C.BONE, 4), { parent: n, round: 1 })];
          case "leaves": {
            const leaf = full(C.LEAF);
            return [part(`${n}.leaves`, [5, 4, 5], tip, [-2.5, 0, -2.5], { front: layer(cloth(leaf, 4), (p) => { p.put(1, 1, at(leaf, 6)); p.put(3, 2, 0xd23a4a); p.put(0, 3, 0, 0); p.put(4, 3, 0, 0); }), left: cloth(leaf, 3), top: layer(cloth(leaf, 5, false), (p) => p.put(2, 2, 0xd23a4a)) }, at(leaf, 4), { parent: n, round: 1.5 })];
          }
          case "sun":
            return [part(`${n}.sun`, [5, 5, 1], [0, len - 4, 0], [-2.5, 0, -0.5], { front: layer(glowing(GOLD), cutTo((x, y) => (x + y) % 2 === 0 || (x > 0 && x < 4 && y > 0 && y < 4))), back: cloth(GOLD, 3) }, at(GOLD, 5), { parent: n, glow: true })];
          case "moon":
            return [part(`${n}.moon`, [4, 5, 1], [0, len - 4, 0], [-2, 0, -0.5], { front: layer(glowing(glow), cutTo((x, y, w, h) => { const dx = x - 1.5; const dy = y - 2; const r = dx * dx + dy * dy; const ex = x - 2.6; return r <= 5 && ex * ex + dy * dy > 2.2; })), back: cloth(glow, 3) }, at(glow, 5), { parent: n, glow: true })];
          case "crook":
            return [
              part(`${n}.crook`, [1, 1, 4], [0, len - 5, 0], [-0.5, 0, -0.5], solid(shaft, 4), at(shaft, 4), { parent: n }),
              part(`${n}.crook2`, [1, 3, 1], [0, len - 5, 3], [-0.5, -3, 0], solid(shaft, 4), at(shaft, 4), { parent: n }),
            ];
          case "hourglass":
            return [
              part(`${n}.frame`, [3, 5, 3], tip, [-1.5, 0, -1.5], { front: layer(cloth(GOLD, 3), (p) => { for (let y = 1; y < 4; y++) p.put(1, y, at(glow, y === 2 ? 4 : 6)); }), left: layer(cloth(GOLD, 3), (p) => p.put(1, 2, at(glow, 5))), top: cloth(GOLD, 5, false) }, at(GOLD, 3), { parent: n }),
              part(`${n}.spark`, [1, 1, 1], [0, len + 1, 0], [-0.5, 0, -0.5], { front: glowing(glow) }, at(glow, 6), { parent: n, glow: true, motion: { kind: "orbit", radius: 3, rate: 3 } }),
            ];
          case "flame":
            return [
              part(`${n}.bowl`, [3, 2, 3], tip, [-1.5, 0, -1.5], solid(IRON, 3), at(IRON, 3), { parent: n }),
              part(`${n}.flame`, [2, 3, 2], [0, len - 3, 0], [-1, 0, -1], { front: layer(glowing(FIRE), (p) => p.put(0, 0, 0, 0)), left: glowing(FIRE), top: glowing(FIRE) }, at(FIRE, 4), { parent: n, glow: true, motion: { kind: "bob", amount: 0.4, rate: 9 } }),
            ];
        }
      })();
      return [staff, ...top];
    }
    case "sword": {
      const blade = item.blade ?? IRON;
      const hilt = item.hilt ?? GOLD;
      const len = item.length ?? 11;
      const bladeFaces = item.flame
        ? { front: layer(glowing(FIRE), rows(0, 0, at(FIRE, 6))), left: glowing(FIRE), top: glowing(FIRE) }
        : { front: layer(cloth(blade, 5), (p) => p.vline(0, 0, p.height, at(blade, 6)), rows(0, 0, at(blade, 6))), left: layer(cloth(blade, 4), (p) => p.vline(0, 0, p.height, at(blade, 6))), top: cloth(blade, 6, false) };
      return [
        part(n, [1, 4, 1], hand, [-0.5, -2, -0.5], solid(full(C.DARKWOOD), 3), at(C.WOOD, 2), { tilt: [0.5, 0] }),
        part(`${n}.guard`, [4, 1, 2], [0, 2, 0], [-2, 0, -1], solid(hilt, 3), at(hilt, 3), { parent: n }),
        part(`${n}.blade`, [1, len, 2], [0, 3, 0], [-0.5, 0, -1], bladeFaces, at(blade, 5), { parent: n, glow: item.flame === true }),
      ];
    }
    case "axe": {
      const blade = item.blade ?? IRON;
      const haft = item.haft ?? WOOD;
      const big = item.big ?? false;
      const hl = big ? 18 : 13;
      const bw = big ? 7 : 5;
      return [
        part(n, [1, hl, 1], hand, [-0.5, -3, -0.5], solid(haft, 4), at(haft, 4)),
        part(`${n}.head`, [bw, bw, 1], [0, hl - 6, 0], side > 0 ? [0.5, 0, -0.5] : [-bw - 0.5, 0, -0.5], {
          front: layer(cloth(blade, 4), cutTo((x, y, w, h) => { const fx = side > 0 ? x : w - 1 - x; return fx < 2 ? y > 0 && y < h - 1 : true; }), (p) => { const ex = side > 0 ? p.width - 1 : 0; p.vline(ex, 0, p.height, at(blade, 6)); }),
          back: cloth(blade, 3),
          top: cloth(blade, 5, false),
        }, at(blade, 4), { parent: n }),
        ...(big ? [part(`${n}.back`, [bw - 2, bw - 2, 1], [0, hl - 5, 0], side > 0 ? [-bw + 1.5, 0, -0.5] : [0.5, 0, -0.5], { front: cloth(blade, 3) }, at(blade, 3), { parent: n })] : []),
      ];
    }
    case "bow": {
      const wood = item.wood ?? WOOD;
      return [
        part(n, [5, 17, 1], hand, side > 0 ? [-0.5, -8, -0.5] : [-4.5, -8, -0.5], {
          front: (p) => {
            p.fill(0, 0);
            const string = side > 0 ? 0 : 4;
            for (let y = 0; y < p.height; y++) {
              const t = (y - 8) / 8;
              const bend = Math.round(3.6 * (1 - t * t));
              const x = side > 0 ? bend : 4 - bend;
              p.put(x, y, at(wood, 4));
              if (y === 8) p.put(x, y, at(C.WOOD, 2));
              p.put(string, y, 0xe8e4d0);
            }
          },
          left: cloth(wood, 3),
          top: cloth(wood, 4, false),
        }, at(wood, 4), { round: 0 }),
      ];
    }
    case "shield": {
      const face = item.face;
      const trim = item.trim ?? GOLD;
      const emblem = item.emblem ?? GOLD;
      const shape = item.round
        ? (x: number, y: number, w: number, h: number) => (x - (w - 1) / 2) ** 2 + (y - (h - 1) / 2) ** 2 <= (w / 2) ** 2
        : (x: number, y: number, w: number, h: number) => Math.abs(x - (w - 1) / 2) <= Math.min(w / 2, (h - y) * 0.75);
      const outer = side > 0 ? 2 : -2;
      return [
        part(n, [1, 10, 8], [outer, -ah + 5, 0], [side > 0 ? 0 : -1, -5, -4], {
          [side > 0 ? "left" : "right"]: layer(cloth(face, 3), (p) => {
            for (let y = 0; y < p.height; y++) {
              for (let x = 0; x < p.width; x++) {
                if (!shape(x, y, p.width, p.height)) p.put(x, y, 0, 0);
                else if (x === 0 || y === 0 || x === p.width - 1 || !shape(x - 1, y, p.width, p.height) || !shape(x + 1, y, p.width, p.height) || !shape(x, y + 1, p.width, p.height)) p.put(x, y, at(trim, 3));
              }
            }
            p.put(3, 3, at(emblem, 4));
            p.put(4, 3, at(emblem, 3));
            p.put(3, 4, at(emblem, 3));
            p.put(4, 4, at(emblem, 2));
            p.put(3, 2, at(emblem, 5));
            p.put(4, 5, at(emblem, 2));
          }),
          [side > 0 ? "right" : "left"]: cloth(WOOD, 3),
          front: cloth(trim, 3),
          top: cloth(trim, 4, false),
        }, at(trim, 3)),
      ];
    }
    case "book":
      return [part(n, [4, 5, 2], [0, -ah + 3, ad / 2], [-2, -2.5, 0], { front: layer(cloth(item.cover, 3), rows(0, 0, at(item.cover, 5)), (p) => { p.put(1, 2, at(GOLD, 4)); p.put(2, 2, at(GOLD, 4)); }), left: layer(cloth(C.CLOTH_WHITE, 4), rows(0, 0, at(item.cover, 3))), top: cloth(C.CLOTH_WHITE, 4, false) }, at(item.cover, 3), { tilt: [-0.3, 0] })];
    case "lantern": {
      const light = item.light ?? FIRE;
      return [
        part(n, [1, 2, 1], [0, -ah + 1, 1], [-0.5, -2, -0.5], solid(IRON, 2), at(IRON, 2)),
        part(`${n}.light`, [3, 4, 3], [0, -2, 0], [-1.5, -4, -1.5], { front: layer(glowing(light), rows(0, 0, at(IRON, 2)), rows(3, 3, at(IRON, 2))), left: layer(glowing(light), rows(0, 0, at(IRON, 2))), top: cloth(IRON, 3, false) }, at(light, 5), { parent: n, glow: true, motion: { kind: "tail", delay: 0.5, amount: 0.15, axis: "x", rate: 3 } }),
      ];
    }
    case "pole":
      return [part(n, [1, 36, 1], hand, [-0.5, -14, -0.5], { front: layer(cloth(WOOD, 4), rows(0, 1, at(C.WOOD, 2))), left: cloth(WOOD, 3) }, at(WOOD, 4), { tilt: [0.25, 0] })];
    case "trident": {
      const metal = item.metal ?? full(C.GOLD);
      return [
        part(n, [1, 26, 1], hand, [-0.5, -6, -0.5], solid(full(C.TEAL), 3), at(C.TEAL, 3)),
        part(`${n}.prongs`, [5, 4, 1], [0, 20, 0], [-2.5, 0, -0.5], { front: layer(cloth(metal, 4), cutTo((x, y) => y === 3 || x % 2 === 0), (p) => { p.put(0, 0, at(metal, 6)); p.put(4, 0, at(metal, 6)); p.put(2, 0, at(metal, 6)); }), back: layer(cloth(metal, 3), cutTo((x, y) => y === 3 || x % 2 === 0)) }, at(metal, 4), { parent: n }),
      ];
    }
    case "club": {
      const wood = item.wood ?? WOOD;
      const s = item.size ?? 1;
      const l = Math.round(13 * s);
      return [part(n, [Math.round(3 * s), l, Math.round(3 * s)], hand, [-1.5 * s, -2, -1.5 * s], { front: layer(cloth(wood, 4), (p) => { for (let y = 2; y < p.height; y += 3) p.put((y * 7) % p.width, y, at(wood, 2)); }, rows(0, 0, at(wood, 5))), left: cloth(wood, 3), top: cloth(wood, 5, false) }, at(wood, 4), { tilt: [0.45, 0], round: 1 })];
    }
    case "hammer": {
      const head = item.head ?? IRON;
      return [
        part(n, [1, 10, 1], hand, [-0.5, -2, -0.5], solid(WOOD, 4), at(WOOD, 4)),
        part(`${n}.head`, [5, 3, 3], [0, 7, 0], [-2.5, 0, -1.5], solid(head, 4, rows(0, 0, at(head, 6))), at(head, 4), { parent: n }),
      ];
    }
    case "wrench": {
      const metal = item.metal ?? IRON;
      return [
        part(n, [1, 7, 1], hand, [-0.5, -1, -0.5], solid(metal, 4), at(metal, 4)),
        part(`${n}.jaw`, [3, 2, 1], [0, 6, 0], [-1.5, 0, -0.5], { front: layer(cloth(metal, 5), (p) => p.put(1, 1, 0, 0)) }, at(metal, 4), { parent: n }),
      ];
    }
    case "torch":
      return [
        part(n, [1, 7, 1], hand, [-0.5, -1, -0.5], solid(WOOD, 3), at(WOOD, 3)),
        part(`${n}.flame`, [2, 3, 2], [0, 6, 0], [-1, 0, -1], { front: layer(glowing(FIRE), (p) => p.put(1, 0, 0, 0)), left: glowing(FIRE), top: glowing(FIRE) }, at(FIRE, 4), { parent: n, glow: true, motion: { kind: "bob", amount: 0.4, rate: 11 } }),
      ];
    case "dagger": {
      const blade = item.blade ?? IRON;
      return [part(n, [1, 6, 1], hand, [-0.5, -1, -0.5], { front: layer(cloth(blade, 5), rows(4, 5, at(C.WOOD, 2))), left: cloth(blade, 4) }, at(blade, 5), { tilt: [0.6, 0] })];
    }
    case "scythe": {
      const blade = item.blade ?? IRON;
      return [
        part(n, [1, 26, 1], hand, [-0.5, -6, -0.5], solid(full(C.DARKWOOD), 4), at(C.DARKWOOD, 4)),
        part(`${n}.blade`, [8, 2, 1], [0, 19, 0], side > 0 ? [0, 0, -0.5] : [-8, 0, -0.5], { front: layer(cloth(blade, 5), rows(0, 0, at(blade, 6)), cutTo((x, y, w) => (side > 0 ? x < w - 1 || y === 1 : x > 0 || y === 1))), back: cloth(blade, 3) }, at(blade, 4), { parent: n, tilt: [0, side > 0 ? -0.3 : 0.3] }),
      ];
    }
  }
}

/** The light a figure casts with when it raises its hands: a spinning spark over its head, in its color. */
export function sparkPart(color: Ramp, torsoHeight: number, headHeight: number): PartSpec {
  return part("spark", [3, 3, 3], [0, torsoHeight + headHeight + 6, 3], [-1.5, -1.5, -1.5], { front: glowing(color), back: glowing(color), left: glowing(color), top: glowing(color), bottom: glowing(color) }, at(color, 6), { parent: "torso", glow: true, motion: { kind: "spark" }, round: 1 });
}

export type { Rgb };
