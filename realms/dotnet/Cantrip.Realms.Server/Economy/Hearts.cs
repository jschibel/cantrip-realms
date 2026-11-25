using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// A character's hearts (design.md A3b): how many duels they may lose before they die. A lost game takes one
/// (<see cref="Encounters"/>); the last one lost sends them home. They fill again to the character's capacity in a town -
/// the server sees them come into one in what they report of where they stand (<see cref="Characters.Position"/>) - and
/// when they wake at home. The capacity is 2 to start and is raised a heart at a time, to 5, at a healer: the priest of a
/// town's temple or the keeper of a village's shrine (an interior with a <c>healer</c> NPC), for gold.
/// </summary>
public sealed class Hearts(RealmDb db, RealmContent content)
{
    /// <summary>The hearts a new character has, and holds.</summary>
    public const int Starting = 2;

    /// <summary>The most hearts a character can hold.</summary>
    public const int Most = 5;

    /// <summary>The NPC kind that sells hearts.</summary>
    public const string Healer = "healer";

    /// <summary>What the heart that brings a character's capacity to each number costs, in gold (design.md A5).</summary>
    public static IReadOnlyDictionary<int, long> Prices { get; } = new Dictionary<int, long> { [3] = 1_000, [4] = 3_000, [5] = 8_000 };

    /// <summary>What a character who holds <paramref name="capacity"/> hearts pays for one more; null at the most.</summary>
    public static long? PriceAfter(int capacity) => Prices.TryGetValue(capacity + 1, out long gold) ? gold : null;

    /// <summary>Whether a place is in a town, where hearts fill: the world within a town's walls, or a building of a town.</summary>
    public bool InTown(string space, Tile at) =>
        space == RealmContent.WorldSpace ? content.TownAt(at) is not null : content.Interiors.GetValueOrDefault(space)?.Town is not null;

    /// <summary>Fills a character's hearts to their capacity: in a town, and on waking at home.</summary>
    public Task Refill(string player) =>
        db.Players.Where(row => row.Id == player && row.Hearts < row.MaxHearts)
            .ExecuteUpdateAsync(set => set.SetProperty(row => row.Hearts, row => row.MaxHearts));

    /// <summary>
    /// Gives a character back one heart, up to their capacity: what a heart found in the world or a dungeon's shrine gives.
    /// Whether one was given (none is, to a character whose hearts are full).
    /// </summary>
    public async Task<bool> Grant(string player) =>
        await db.Players.Where(row => row.Id == player && row.Hearts < row.MaxHearts)
            .ExecuteUpdateAsync(set => set.SetProperty(row => row.Hearts, row => row.Hearts + 1)).ConfigureAwait(false) == 1;

    /// <summary>
    /// Buys one more heart's capacity at a healer (<c>POST /api/hearts/buy</c>), which fills that heart too: inside a
    /// temple or shrine with a healer; 409 <c>MostHearts</c> at the most, <c>CannotAfford</c>, <c>NotNear</c> elsewhere.
    /// </summary>
    public async Task<HeartsView> Buy(string player)
    {
        PlayerRow row = await db.Players.AsNoTracking().SingleOrDefaultAsync(stored => stored.Id == player).ConfigureAwait(false)
            ?? throw Refusal.NotFound(Codes.NoCharacter, "You have no character yet.");
        if (content.Interiors.GetValueOrDefault(row.Space) is not { } room || !room.Npcs.Any(npc => npc.Kind == Healer))
        {
            throw Refusal.Conflict(Codes.NotNear, "Hearts are blessed by a healer, at a temple or a shrine.");
        }

        if (PriceAfter(row.MaxHearts) is not { } price) throw Refusal.Conflict(Codes.MostHearts, $"You hold {Most} hearts, the most anyone can.");
        int capacity = row.MaxHearts;
        if (await db.Players.Where(stored => stored.Id == player && stored.MaxHearts == capacity && stored.Gold >= price)
            .ExecuteUpdateAsync(set => set
                .SetProperty(stored => stored.Gold, stored => stored.Gold - price)
                .SetProperty(stored => stored.MaxHearts, stored => stored.MaxHearts + 1)
                .SetProperty(stored => stored.Hearts, stored => stored.Hearts + 1)).ConfigureAwait(false) != 1)
        {
            throw Refusal.Conflict(Codes.CannotAfford, $"A heart's blessing is {price} gold.");
        }

        PlayerRow now = await db.Players.AsNoTracking().SingleAsync(stored => stored.Id == player).ConfigureAwait(false);
        return new HeartsView(now.Gold, now.Hearts, now.MaxHearts, PriceAfter(now.MaxHearts));
    }
}
