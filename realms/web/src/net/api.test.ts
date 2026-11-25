import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Character, HttpApi, identityOf, travelerIn } from "./api";
import { DUNGEONS, VENDORS, WORLD, innOf } from "../world/realm";
import { MockApi, travelersAt } from "./mockApi";
import { buyout } from "../hearts";

describe("HttpApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (status: number, body: unknown) =>
    vi.fn(async (_url: URL, _init: RequestInit) => new Response(body === undefined ? "" : JSON.stringify(body), { status }));

  it("calls the server's /api with the cookie and a JSON body", async () => {
    const fetch = reply(200, { Gold: 120 });
    vi.stubGlobal("fetch", fetch);
    const api = new HttpApi("https://realm.example/");
    expect(await api.openChest({ Space: "world", Chest: "10_10:c1" })).toEqual({ Gold: 120 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.toString()).toBe("https://realm.example/api/chest/open");
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ Space: "world", Chest: "10_10:c1" }) });
  });

  it("turns a refusal into an ApiError with the server's code and words", async () => {
    vi.stubGlobal("fetch", reply(409, { Error: "NotNear", Detail: "You are too far from that spawn." }));
    const refused = await new HttpApi("https://realm.example/").startEncounter({ Spawn: "s1", Mob: "x" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 409, code: "NotNear", detail: "You are too far from that spawn." });
  });

  it("reads the server's Character: its id, body name, hearts, identity letters and loadout of gear instances", async () => {
    // As Cantrip.Realms.Server's CharacterView serialises (interfaces.md, the Character bullet).
    const plate = { Id: "padded-jerkin", Name: "Padded Jerkin", Slot: "body", Rarity: "common", Gold: 300, Stats: { Life: 3, Hand: 0, MaxHand: 0 }, Effects: [], Text: "", Look: { Mesh: "armor", Palette: ["#8a6a43", "#5a4630"], Size: null }, Unique: false, Emblem: null };
    const sent = {
      Id: "dev-1", Name: "Ann", Body: "broad", Palette: 2, Identity: "WU", Gold: 2000, Hearts: 1, MaxHearts: 3, HeartPrice: 3000, Defeat: null, Space: "world", X: 311, Z: 325,
      Stats: { Life: 23, Hand: 7, MaxHand: 7 },
      Loadout: { head: null, neck: null, body: { InstanceId: 4, Gear: plate }, hands: null, feet: null, ring1: null, ring2: null, relic: null },
      Gear: [{ InstanceId: 4, Gear: plate }],
      Unlocked: ["U"],
    };
    vi.stubGlobal("fetch", reply(200, sent));
    const me: Character = (await new HttpApi("https://realm.example/").me())!;
    expect(me.Id).toBe("dev-1");
    expect(me.Body).toBe("broad");
    expect([me.Hearts, me.MaxHearts, me.HeartPrice]).toEqual([1, 3, 3000]);
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

  it("starts a character with the kit of design.md A1 outside the start town's inn", async () => {
    const me = (await make().me())!;
    const inn = innOf(WORLD.towns.find((t) => t.kind === "capital")!.id);
    expect(me).toMatchObject({ Name: "Tester", Identity: "B", Gold: 2000, Space: "world", X: inn.x, Z: inn.z });
    expect(Object.values(me.Loadout).filter((worn) => worn)).toHaveLength(3);
  });

  it("pays a win in gold alone, and costs a heart for a loss with the mob's buyout by the life it kept", async () => {
    const api = make();
    const start = await api.startEncounter({ Spawn: "s1", Mob: "bog-rats" });
    expect(start.Duel).toMatchObject({ Game: 1, FirstPlayer: null });
    api.settle(start.Token, "won");
    const won = await api.finishEncounter({ Token: start.Token, Log: [] });
    expect(won).toMatchObject({ Outcome: "won", Hearts: 2 });
    expect(won.Gold).toBeGreaterThan(0);

    const next = await api.startEncounter({ Spawn: "s2", Mob: "bog-rats" });
    const full = Number(next.Duel.Seats[1]!["StartingLife"]);
    api.settle(next.Token, "lost", 1);
    const lost = await api.finishEncounter({ Token: next.Token, Log: [] });
    expect(lost).toMatchObject({ Outcome: "lost", Gold: 0, Hearts: 1, Died: false });
    expect(lost.Defeat).toMatchObject({ Token: next.Token, Mob: "bog-rats", MobLife: 1, MobFullLife: full, Price: buyout(1, 1, full) });
    expect((await api.me())!.Defeat?.Token).toBe(next.Token);
    await expect(api.startEncounter({ Spawn: "s3", Mob: "bog-rats" })).rejects.toMatchObject({ code: "Defeated" });

    const gold = (await api.me())!.Gold;
    expect(await api.payEncounter({ Token: next.Token })).toEqual({ Gold: gold - lost.Defeat!.Price! });
    expect((await api.me())!.Defeat).toBeNull();
    await expect(api.payEncounter({ Token: next.Token })).rejects.toMatchObject({ code: "Finished" });
  });

  it("fights on with the mob at its carried life, and the last heart lost sends the character home", async () => {
    const api = make();
    await api.position({ Space: "world", X: 0, Z: 0 });
    const first = await api.startEncounter({ Spawn: "s1", Mob: "bog-rats" });
    api.settle(first.Token, "lost", 26);
    const defeat = (await api.finishEncounter({ Token: first.Token, Log: [] })).Defeat!;
    const again = await api.rematch({ Token: defeat.Token, Main: defeat.Main, Sideboard: defeat.Sideboard, PlayFirst: false });
    expect(again.Duel).toMatchObject({ Game: 2, FirstPlayer: 2 });
    expect(again.Duel.Seats[1]!["StartingLife"]).toBe(26);
    expect(again.Duel.Seats[0]!["StartingLife"]).toBe((await api.me())!.Stats.Life);
    api.settle(again.Token, "lost");
    const died = await api.finishEncounter({ Token: again.Token, Log: [] });
    expect(died).toMatchObject({ Died: true, Hearts: 2, Defeat: null });
    const inn = innOf(WORLD.towns.find((t) => t.kind === "capital")!.id);
    expect((await api.me())!).toMatchObject({ Space: "world", X: inn.x, Z: inn.z, Hearts: 2 });
  });

  it("counts a duel never finished as lost when the next starts", async () => {
    const api = make();
    await api.startEncounter({ Spawn: "s1", Mob: "bog-rats" });
    await expect(api.startEncounter({ Spawn: "s2", Mob: "bog-imp" })).rejects.toMatchObject({ code: "Unfinished" });
    expect((await api.me())!).toMatchObject({ Hearts: 1 });
  });

  it("fills the hearts in a town and sells one more at a temple", async () => {
    const api = make();
    const first = await api.startEncounter({ Spawn: "s1", Mob: "bog-rats" });
    api.settle(first.Token, "lost");
    await api.finishEncounter({ Token: first.Token, Log: [] });
    await api.payEncounter({ Token: first.Token });
    expect(await api.position({ Space: "world", X: 0, Z: 0 })).toEqual({ Hearts: 1 });
    const town = WORLD.towns.find((t) => t.kind === "capital")!;
    expect(await api.position({ Space: "world", X: town.center[0], Z: town.center[1] })).toEqual({ Hearts: 2 });
    await expect(api.buyHeart()).rejects.toMatchObject({ code: "NotNear" });
    await api.position({ Space: `${town.id}-temple`, X: 1, Z: 1 });
    expect(await api.buyHeart()).toMatchObject({ Hearts: 3, MaxHearts: 3, Price: 3000 });
  });

  it("opens a chest once", async () => {
    const api = make();
    expect((await api.openChest({ Space: "world", Chest: "10_10:c1" })).Gold).toBeGreaterThan(0);
    await expect(api.openChest({ Space: "world", Chest: "10_10:c1" })).rejects.toMatchObject({ code: "Empty" });
  });

  it("runs a dungeon as the server does: its floors, the warden before each stair, the boss's index past it", async () => {
    const api = make();
    const dungeon = [...DUNGEONS.values()].find((d) => !d.requires && d.floors[0] >= 2)!;
    await expect(api.enterDungeon({ Dungeon: dungeon.id })).rejects.toMatchObject({ code: "NotNear" });
    await api.position({ Space: "world", X: dungeon.entrance[0], Z: dungeon.entrance[1] });
    const run = await api.enterDungeon({ Dungeon: dungeon.id });
    expect(run.Floors.length).toBeGreaterThanOrEqual(dungeon.floors[0]);
    expect((await api.me())!).toMatchObject({ Space: `run:${run.Run}`, X: 0, Z: 0 });
    const first = run.Floors[0]!;
    expect(first.Warden).toBe(dungeon.warden);
    expect(run.Floors.at(-1)!.Boss).toBe(dungeon.boss);
    await expect(api.dungeonFloor({ Run: run.Run, Floor: 1 })).rejects.toMatchObject({ code: "WardenStands" });
    const warden = await api.startEncounter({ Run: run.Run, Floor: 0, Index: first.Encounters.length, Mob: first.Warden! });
    api.settle(warden.Token, "won");
    await api.finishEncounter({ Token: warden.Token, Log: [] });
    await api.dungeonFloor({ Run: run.Run, Floor: 1 });
    await api.leaveDungeon({ Run: run.Run });
    const out = (await api.me())!;
    expect(out.Space).toBe("world");
    expect(Math.max(Math.abs(out.X - dungeon.entrance[0]), Math.abs(out.Z - dungeon.entrance[1]))).toBeLessThanOrEqual(1);
  });

  it("attunes a mage tower when its mage is beaten, and travels between attuned waystones", async () => {
    const towers = [...DUNGEONS.values()].filter((d) => d.waystone && d.floors[1] === 1);
    const [tower, other] = [towers[0]!, [...DUNGEONS.values()].find((d) => d.waystone && d.id !== towers[0]!.id)!];
    const api = new MockApi(7, { name: "Tester", body: "lithe", palette: 0, color: "W" }, [other.id]);
    await api.position({ Space: "world", X: tower.entrance[0], Z: tower.entrance[1] });
    await expect(api.waystone({ Tower: other.id })).rejects.toMatchObject({ code: "NotAttuned" });
    const run = await api.enterDungeon({ Dungeon: tower.id });
    const top = run.Floors[0]!;
    const boss = await api.startEncounter({ Run: run.Run, Floor: 0, Index: top.Encounters.length + 1, Mob: tower.boss });
    api.settle(boss.Token, "won");
    await api.finishEncounter({ Token: boss.Token, Log: [] });
    expect((await api.me())!.Attuned).toEqual(expect.arrayContaining([tower.id, other.id]));
    await api.leaveDungeon({ Run: run.Run });
    const { Place } = await api.waystone({ Tower: other.id });
    expect(Place.Space).toBe("world");
    expect(Math.max(Math.abs(Place.X - other.entrance[0]), Math.abs(Place.Z - other.entrance[1]))).toBeLessThanOrEqual(1);
  });
});

describe("the traveling traders' schedule", () => {
  // 2025-11-23, a Unix day of 20415, at 07:00 and 12:00 UTC and 23:00.
  const day = 20415;
  const at = (hour: number) => (day * 24 + hour) * 3_600_000;

  it("is every trader of the vendor files, in id order, by the date alone, as the server keeps it", () => {
    const traders = [...VENDORS.values()].filter((v) => v.trader).map((v) => v.id).sort();
    expect(traders).toHaveLength(15);
    const seen = travelersAt(at(7));
    expect(seen.map((t) => t.Id)).toEqual(traders);
    for (const t of seen) {
      const round = VENDORS.get(t.Id)!.trader!;
      expect(t.Plane).toBe(round.plane);
      expect(t.PlaneName).not.toBe("");
      const town = round.towns[day % round.towns.length]!;
      if (round.hour <= 7 && 7 < round.hour + round.hours) expect(t.Visit).toEqual({ Town: town, From: new Date(at(round.hour)).toISOString(), Until: new Date(at(round.hour + round.hours)).toISOString() });
      else expect(t.Visit).toBeNull();
      expect(Date.parse(t.Next.From)).toBeGreaterThan(at(7));
    }
    // Late in the evening every caravan has gone, and the next visits are tomorrow's, each in its round's next town.
    for (const t of travelersAt(at(23))) {
      const round = VENDORS.get(t.Id)!.trader!;
      expect(t.Visit).toBeNull();
      expect(t.Next.Town).toBe(round.towns[(day + 1) % round.towns.length]);
    }
  });

  it("keeps one caravan at a time at each pitch's town, and only towns with a pitch", () => {
    const pitches = new Set(WORLD.pitches.map((p) => p.town));
    for (let hour = 0; hour < 48; hour++) {
      const now = at(hour) + 1_800_000;
      const visits = travelersAt(now).filter((t) => t.Visit).map((t) => t.Visit!.Town);
      expect(new Set(visits).size, `at ${hour}:30`).toBe(visits.length);
      for (const town of visits) expect(pitches.has(town), town).toBe(true);
      for (const town of visits) expect(travelerIn(travelersAt(now), town, now)).toBeDefined();
    }
  });

  it("is what the MockApi answers on its clock", async () => {
    const api = new MockApi();
    api.now = () => at(12) / 1000;
    expect((await api.travelers()).Travelers).toEqual(travelersAt(at(12)));
  });
});
