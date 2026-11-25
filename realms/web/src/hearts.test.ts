import { describe, expect, it } from "vitest";
import { BUYOUT_BASE, HEART_PRICES, MOST_HEARTS, buyout, defeatLine, heartPriceAfter, isNarrated, marginOf } from "./hearts";
import { mobInfo } from "./mobs";

// The numbers of hearts and buyouts (design.md A3, A3b), as the server's Encounters.Buyout and Hearts.Prices have them:
// the same cases its HeartsTests check.
describe("a buyout", () => {
  it("is the tier's base in the share of life the mob kept, capped at the whole, at least 1 gold", () => {
    expect(buyout(4, 20, 20)).toBe(BUYOUT_BASE[4]);
    expect(buyout(4, 1, 20)).toBe(60);
    expect(buyout(4, 31, 20)).toBe(BUYOUT_BASE[4]);
    expect(buyout(2, 10, 20)).toBe(BUYOUT_BASE[2]! / 2);
    expect(buyout(1, 1, 20)).toBe(2);
    expect(buyout(1, 0, 20)).toBe(1);
    expect(buyout(1, -3, 20)).toBe(1);
  });
});

describe("hearts at a healer", () => {
  it("cost more for each, to five", () => {
    expect(heartPriceAfter(2)).toBe(HEART_PRICES[3]);
    expect(HEART_PRICES[3]! < HEART_PRICES[4]! && HEART_PRICES[4]! < HEART_PRICES[5]!).toBe(true);
    expect(heartPriceAfter(MOST_HEARTS)).toBeNull();
  });
});

describe("what a mob says over the player it beat", () => {
  it("is flawless with no life lost, close at a quarter or less, solid between", () => {
    expect(marginOf(20, 20)).toBe("flawless");
    expect(marginOf(25, 20)).toBe("flawless");
    expect(marginOf(19, 20)).toBe("solid");
    expect(marginOf(5, 20)).toBe("close");
    expect(marginOf(0, 20)).toBe("close");
  });

  it("is one of its own lines for the margin, or a generic one", () => {
    const own = mobInfo("llanowar-elves").lines?.close ?? [];
    expect(own.length).toBeGreaterThan(0);
    expect(own).toContain(defeatLine("llanowar-elves", "close", () => 0.99));
    expect(defeatLine("no-such-mob", "flawless", () => 0)).toMatch(/\w/);
  });

  it("knows a beast's narrated action by its asterisks", () => {
    expect(isNarrated("*The wurm settles back into the moss.*")).toBe(true);
    expect(isNarrated("Such is Llanowar!")).toBe(false);
  });
});
