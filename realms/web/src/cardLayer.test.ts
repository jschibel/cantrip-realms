import { describe, expect, it } from "vitest";
import { type CardLayer, type CardScreens, type Closed, OfflineCardLayer, type Screen } from "./cardLayer";

/** A card layer that records what it is asked and closes each screen at once. */
function fake(isReady = true): CardScreens & { asked: Screen[] } {
  const asked: Screen[] = [];
  return {
    asked,
    isReady,
    openScreen: null,
    requests: [],
    onChange: () => {},
    open: (screen: Screen) => {
      asked.push(screen);
      return Promise.resolve<Closed>({ screen, outcome: "closed" });
    },
  };
}

describe("offline card screens", () => {
  it("play duels and loot in the real card layer, and the screens that need the server on the stand-in", async () => {
    const real = fake();
    const stub = fake();
    const layer = new OfflineCardLayer(real as unknown as CardLayer, stub);
    for (const screen of ["duel", "loot", "spell-table", "vendor", "gear"] as const) await layer.open(screen, { name: screen });
    expect(real.asked).toEqual(["duel", "loot"]);
    expect(stub.asked).toEqual(["spell-table", "vendor", "gear"]);
    expect(layer.requests.map((r) => r.screen)).toEqual(["duel", "loot", "spell-table", "vendor", "gear"]);
  });

  it("is ready when the real card layer is, and tells of either's changes", () => {
    const real = fake(false);
    const stub = fake();
    const layer = new OfflineCardLayer(real as unknown as CardLayer, stub);
    expect(layer.isReady).toBe(false);
    let changes = 0;
    layer.onChange = () => changes++;
    real.onChange();
    stub.onChange();
    expect(changes).toBe(2);
  });
});
