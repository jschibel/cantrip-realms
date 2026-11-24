import { describe, expect, it } from "vitest";
import { MockApi } from "./mockApi";
import { mobSeat, parseDeckList, starterDeck } from "./mockDuel";

const MOB_FILES = import.meta.glob<{ id: string; name: string }>("../../../content/*/mobs/*.json", { eager: true, import: "default" });

describe("offline duels", () => {
  it("reads a decklist's counts and names, leaving out comments and blank lines", () => {
    expect(parseDeckList("# a comment\n\n2 Benalish Hero\r\n17 Plains\n")).toEqual([
      { Name: "Benalish Hero", Count: 2 },
      { Name: "Plains", Count: 17 },
    ]);
  });

  it("deals each color's starter deck, forty cards", () => {
    for (const color of ["W", "U", "B", "R", "G"] as const) {
      expect(starterDeck(color).reduce((n, c) => n + c.Count, 0), color).toBe(40);
    }
  });

  it("deals every mob its themed deck, at least forty cards, with its stats", async () => {
    for (const mob of Object.values(MOB_FILES)) {
      const seat = await mobSeat(mob.id);
      expect(seat, mob.id).not.toBeNull();
      expect((seat!.Deck as string[]).length, mob.id).toBeGreaterThanOrEqual(40);
      expect(seat!.Name).toBe(mob.name);
      expect(seat!.StartingLife as number).toBeGreaterThan(0);
    }
  });

  it("starts an encounter with both seats dealt as the server deals them", async () => {
    const api = new MockApi(1, { name: "Tester", body: "lithe", palette: 0, color: "W" });
    const me = (await api.me())!;
    const start = await api.startEncounter({ Spawn: "any", Mob: "benalish-hero" });
    const [player, mob] = start.Duel.Seats;
    expect(player).toMatchObject({ Name: "Tester", StartingLife: me.Stats.Life, StartingHandSize: me.Stats.Hand, MaximumHandSize: me.Stats.MaxHand, Sideboard: [], Commanders: [] });
    expect((player!.Deck as string[]).length).toBe(40);
    expect((player!.Deck as string[]).filter((c) => c === "Plains").length).toBe(17);
    expect(mob).toMatchObject({ Name: "Benalish Hero", StartingLife: 20 });
    expect(mob!.Deck as string[]).toContain("Benalish Hero");
    expect(start.Duel.MinimumDeckSize).toBe(40);
  });
});
