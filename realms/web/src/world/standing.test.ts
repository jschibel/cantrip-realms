import { describe, expect, it } from "vitest";
import { DUNGEONS } from "./realm";
import { dealtBy, standingOf, startingColor, tableOf, tierFor } from "./standing";
import { mobInfo } from "../mobs";

const white = { Identity: "W", Unlocked: [] };

describe("a color dungeon's standing", () => {
  it("is own for a held color, else ally or enemy by the starting color", () => {
    expect(["W", "U", "B", "R", "G"].map((r) => standingOf(r, white))).toEqual(["own", "ally", "enemy", "enemy", "ally"]);
    const grown = { Identity: "WBG", Unlocked: ["B", "G"] };
    expect(startingColor(grown)).toBe("W");
    expect(["U", "B", "R"].map((r) => standingOf(r, grown))).toEqual(["ally", "own", "enemy"]);
    expect(standingOf(null, white)).toBeNull();
  });

  it("deals the five color dungeons as the server does: an ally's tier 3 of T2-T3 mobs, an enemy's tier 4 of T3-T4", () => {
    const tier = (m: string) => mobInfo(m).tier;
    for (const id of ["benalish-keep", "academy-tower", "vess-crypts", "keldon-fortress", "elfhame-hollow"]) {
      const d = DUNGEONS.get(id)!;
      const ally = { Identity: "WUBRG"[("WUBRG".indexOf(d.region!) + 1) % 5]!, Unlocked: [] };
      const enemy = { Identity: "WUBRG"[("WUBRG".indexOf(d.region!) + 2) % 5]!, Unlocked: [] };
      expect([tierFor(d, ally), tierFor(d, enemy), tierFor(d, { Identity: d.region!, Unlocked: [] })]).toEqual([3, 4, d.tier]);
      for (const floor of [0, 1, 2]) {
        const a = tableOf(d, floor, dealtBy(d, ally), tier);
        const e = tableOf(d, floor, dealtBy(d, enemy), tier);
        expect(a.length).toBeGreaterThan(0);
        expect(e.length).toBeGreaterThan(0);
        expect(a.every((m) => tier(m) >= 2 && tier(m) <= 3)).toBe(true);
        expect(e.every((m) => tier(m) >= 3 && tier(m) <= 4)).toBe(true);
      }
      expect(dealtBy(d, enemy)!.bossStats!.life).toBeGreaterThan(0);
    }
  });
});
