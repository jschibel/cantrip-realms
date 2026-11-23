import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, HttpApi } from "./api";
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

  it("reads no character as null", async () => {
    vi.stubGlobal("fetch", reply(404, { Error: "NoCharacter", Detail: "" }));
    expect(await new HttpApi("https://realm.example/").me()).toBeNull();
  });
});

describe("MockApi", () => {
  const make = () => new MockApi(7, { name: "Tester", body: "lithe", palette: 0, color: "B" });

  it("starts a character with the kit of design.md A1 in its home town", async () => {
    const me = (await make().me())!;
    expect(me).toMatchObject({ Name: "Tester", Identity: ["B"], Gold: 2000, Map: "urborg" });
    expect(Object.keys(me.Loadout)).toHaveLength(3);
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
