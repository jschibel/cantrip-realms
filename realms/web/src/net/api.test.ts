import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Character, HttpApi, identityOf } from "./api";
import { MockApi } from "./mockApi";

describe("HttpApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (status: number, body: unknown) =>
    vi.fn(async (_url: URL, _init: RequestInit) => new Response(body === undefined ? "" : JSON.stringify(body), { status }));

  it("calls the server's /api with the cookie and a JSON body", async () => {
    const fetch = reply(200, { Gold: 120 });
    vi.stubGlobal("fetch", fetch);
    const api = new HttpApi("https://realm.example/");
    expect(await api.openChest({ Map: "benalish-meadow", Chest: "c1" })).toEqual({ Gold: 120 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.toString()).toBe("https://realm.example/api/chest/open");
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ Map: "benalish-meadow", Chest: "c1" }) });
  });

  it("turns a refusal into an ApiError with the server's code and words", async () => {
    vi.stubGlobal("fetch", reply(409, { Error: "NotNear", Detail: "You are too far from that spawn." }));
    const refused = await new HttpApi("https://realm.example/").startEncounter({ Map: "m", Spawn: "s1", Mob: "x" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 409, code: "NotNear", detail: "You are too far from that spawn." });
  });

  it("reads the server's Character: its id, body name, ante value, identity letters and loadout of gear instances", async () => {
    // As Cantrip.Realms.Server's CharacterView serialises (interfaces.md, the Character bullet).
    const plate = { Id: "padded-jerkin", Name: "Padded Jerkin", Slot: "body", Rarity: "common", Gold: 300, Stats: { Life: 3, Hand: 0, MaxHand: 0 }, Effects: [], Text: "", Look: { Mesh: "armor", Palette: ["#8a6a43", "#5a4630"], Size: null }, Unique: false, Emblem: null };
    const sent = {
      Id: "dev-1", Name: "Ann", Body: "broad", Palette: 2, Identity: "WU", Gold: 2000, AnteValue: 150, Map: "new-argive", Q: 1, R: -2,
      Stats: { Life: 23, Hand: 7, MaxHand: 7 },
      Loadout: { head: null, neck: null, body: { InstanceId: 4, Gear: plate }, hands: null, feet: null, ring1: null, ring2: null, relic: null },
      Gear: [{ InstanceId: 4, Gear: plate }],
      Unlocked: ["U"],
    };
    vi.stubGlobal("fetch", reply(200, sent));
    const me: Character = (await new HttpApi("https://realm.example/").me())!;
    expect(me.Id).toBe("dev-1");
    expect(me.Body).toBe("broad");
    expect(identityOf(me)).toEqual(["W", "U"]);
    expect(me.Loadout.body?.Gear.Look.Mesh).toBe("armor");
    expect(me.Loadout.head).toBeNull();
  });

  it("sends a loadout by gear instance ids", async () => {
    const fetch = reply(200, {});
    vi.stubGlobal("fetch", fetch);
    await new HttpApi("https://realm.example/").saveLoadout({ head: 4, ring1: null });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "PUT", body: JSON.stringify({ Slots: { head: 4, ring1: null } }) });
  });

  it("reads no character as null", async () => {
    vi.stubGlobal("fetch", reply(404, { Error: "NoCharacter", Detail: "" }));
    expect(await new HttpApi("https://realm.example/").me()).toBeNull();
  });
});

describe("MockApi", () => {
  const make = () => new MockApi(7, { name: "Tester", body: "lithe", palette: 0, color: "B" });

  it("starts a character with the kit of design.md A1 in its home town", async () => {
    const me = (await make().me())!;
    expect(me).toMatchObject({ Name: "Tester", Identity: "B", Gold: 2000, Map: "urborg" });
    expect(Object.values(me.Loadout).filter((worn) => worn)).toHaveLength(3);
  });

  it("caps the loot at the ante and refuses picks over it", async () => {
    const api = make();
    const start = await api.startEncounter({ Map: "urborg-mire", Spawn: "s1", Mob: "urborg-ghoul" });
    expect(start.Duel.Cap).toBe(Math.min(start.Duel.AnteValue, start.Duel.Mob.Prize));
    api.settle(start.Token, "won");
    const result = await api.finishEncounter({ Token: start.Token, Log: [] });
    expect(result.Outcome).toBe("won");
    expect(result.Offer.some((card) => card.Gold <= result.Cap)).toBe(true);
    const all = result.Offer.map((c) => c.Name);
    const total = result.Offer.reduce((sum, c) => sum + c.Gold, 0);
    if (total > result.Cap) await expect(api.takeLoot({ Token: start.Token, Picks: all })).rejects.toMatchObject({ code: "OverCap" });
    const fits = result.Offer.find((c) => c.Gold <= result.Cap)!;
    await expect(api.takeLoot({ Token: start.Token, Picks: [fits.Name] })).resolves.toBeDefined();
  });

  it("loses an ante card on a loss, and counts a duel never finished as lost", async () => {
    const api = make();
    const before = (await api.me())!.AnteValue;
    const first = await api.startEncounter({ Map: "urborg-mire", Spawn: "s1", Mob: "urborg-ghoul" });
    await api.startEncounter({ Map: "urborg-mire", Spawn: "s2", Mob: "cabal-initiate" });
    expect((await api.finishEncounter({ Token: first.Token, Log: [] })).Outcome).toBe("lost");
    expect((await api.me())!.AnteValue).toBeLessThan(before);
  });

  it("opens a chest once", async () => {
    const api = make();
    expect((await api.openChest({ Map: "urborg-mire", Chest: "c1" })).Gold).toBeGreaterThan(0);
    await expect(api.openChest({ Map: "urborg-mire", Chest: "c1" })).rejects.toMatchObject({ code: "Empty" });
  });
});
