using System.Text.Json;
using Cantrip.Realms.Server.Content;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// Walking on squares (interfaces.md, "Places"), over no ledge: the golden vectors of <c>realms/content/walk-vectors.json</c>
/// (<c>tools/realms/walk-vectors.ts</c>), which the overworld's tests check too
/// (<c>realms/web/src/world/walk-vectors.test.ts</c>). The server takes every path the overworld's A* finds, refuses every
/// walk that is none, and reaches what the A* reaches.
/// </summary>
public sealed class WalkTests
{
    public static TheoryData<string> Grids()
    {
        TheoryData<string> names = [];
        foreach (JsonElement grid in Vectors.RootElement.GetProperty("grids").EnumerateArray()) names.Add(grid.GetProperty("name").GetString()!);
        return names;
    }

    private static readonly JsonDocument Vectors = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RealmApp.Root, "realms", "content", "walk-vectors.json")));

    private static JsonElement Grid(string name) => Vectors.RootElement.GetProperty("grids").EnumerateArray().Single(grid => grid.GetProperty("name").GetString() == name);

    private static Tile TileOf(JsonElement xz) => new(xz[0].GetInt32(), xz[1].GetInt32());

    /// <summary>
    /// A grid of the vectors as a space of the server's: an interior whose tiles are its rows, from (x0, z0), at the
    /// heights its <c>heights</c> give (texels) and ramps where its <c>ramps</c> say <c>r</c>.
    /// </summary>
    private static RealmInterior SpaceOf(JsonElement grid)
    {
        int x0 = grid.GetProperty("x0").GetInt32();
        int z0 = grid.GetProperty("z0").GetInt32();
        string[] rows = [.. grid.GetProperty("rows").EnumerateArray().Select(row => row.GetString()!)];
        int[][] heights = grid.TryGetProperty("heights", out JsonElement h)
            ? [.. h.EnumerateArray().Select(row => row.EnumerateArray().Select(v => v.GetInt32()).ToArray())]
            : [];
        string[] ramps = grid.TryGetProperty("ramps", out JsonElement r) ? [.. r.EnumerateArray().Select(row => row.GetString()!)] : [];
        string TileText(int x, int z) =>
            $"[{(z < heights.Length ? heights[z][x] : 0)},\"grass\",{(rows[z][x] == '.' ? 0 : 1) | (z < ramps.Length && ramps[z][x] == 'r' ? 4 : 0)}]";
        string tiles = string.Join(",", rows.SelectMany((row, z) => row.Select((_, x) => TileText(x, z))));
        using JsonDocument document = JsonDocument.Parse($"[{tiles}]");
        var file = new InteriorFile
        {
            Id = "grid",
            W = rows[0].Length,
            D = rows.Length,
            Area = [x0, z0, x0 + rows[0].Length, z0 + rows.Length],
            Tiles = [.. document.RootElement.EnumerateArray().Select(tile => tile.Clone())],
        };
        List<string> problems = [];
        var space = new RealmInterior(file, "dominaria", "grid", problems);
        Assert.Empty(problems);
        return space;
    }

    [Fact]
    public void There_are_vectors_both_ways()
    {
        List<JsonElement> walks = [.. Vectors.RootElement.GetProperty("grids").EnumerateArray().SelectMany(grid => grid.GetProperty("walks").EnumerateArray())];
        Assert.Contains(walks, walk => walk.GetProperty("ok").GetBoolean());
        Assert.Contains(walks, walk => !walk.GetProperty("ok").GetBoolean());
        Assert.Contains(Vectors.RootElement.GetProperty("grids").EnumerateArray(), grid => grid.GetProperty("x0").GetInt32() < 0 && grid.GetProperty("z0").GetInt32() < 0);
        Assert.Contains(Vectors.RootElement.GetProperty("grids").EnumerateArray(), grid => grid.TryGetProperty("heights", out _) && grid.TryGetProperty("ramps", out _));
    }

    [Theory]
    [MemberData(nameof(Grids))]
    public void Every_path_the_overworld_finds_is_a_walk_and_every_walk_is_judged_as_the_vectors_say(string name)
    {
        JsonElement grid = Grid(name);
        RealmInterior space = SpaceOf(grid);
        foreach (JsonElement path in grid.GetProperty("paths").EnumerateArray())
        {
            Tile from = TileOf(path.GetProperty("from"));
            Tile to = TileOf(path.GetProperty("to"));
            if (path.GetProperty("path").ValueKind == JsonValueKind.Null)
            {
                // No way there, nor for the server's rule.
                Assert.False(Reaches(space, from, to), $"{name}: {from} to {to}");
                continue;
            }

            List<Tile> tiles = [.. path.GetProperty("path").EnumerateArray().Select(TileOf)];
            Assert.Equal((from, to), (tiles[0], tiles[^1]));
            Assert.True(space.Walkable(from) && space.IsWalk(from, tiles.Skip(1)), $"{name}: the path from {from} to {to}");
            Assert.True(Reaches(space, from, to));
        }

        foreach (JsonElement walk in grid.GetProperty("walks").EnumerateArray())
        {
            List<Tile> tiles = [.. walk.GetProperty("walk").EnumerateArray().Select(TileOf)];
            bool ok = space.Walkable(tiles[0]) && space.IsWalk(tiles[0], tiles.Skip(1));
            Assert.True(ok == walk.GetProperty("ok").GetBoolean(), $"{name}: {walk.GetProperty("walk").GetRawText()}");
        }
    }

    /// <summary>Whether the server's steps lead from one tile to another, by a search of its own.</summary>
    private static bool Reaches(RealmSpace space, Tile from, Tile to)
    {
        if (!space.Walkable(from) || !space.Walkable(to)) return false;
        HashSet<Tile> seen = [from];
        Queue<Tile> open = new([from]);
        while (open.TryDequeue(out Tile at))
        {
            if (at == to) return true;
            foreach (Tile next in Tile.Steps.Select(at.Plus).Where(next => space.CanStep(at, next) && seen.Add(next))) open.Enqueue(next);
        }

        return false;
    }

    [Fact]
    public void Tiles_apart_are_the_most_of_the_two_axes_and_a_diagonal_step_is_longer()
    {
        Assert.Equal(1, new Tile(0, 0).DistanceTo(new Tile(1, 1)));
        Assert.Equal(5, new Tile(-2, 3).DistanceTo(new Tile(3, 1)));
        Assert.Equal(0, new Tile(4, 4).DistanceTo(new Tile(4, 4)));
        Assert.Equal(1, new Tile(0, 0).StepLength(new Tile(0, 1)));
        Assert.Equal(Math.Sqrt(2), new Tile(0, 0).StepLength(new Tile(-1, 1)));
        Assert.Equal(8, Tile.Steps.Distinct().Count());
        Assert.All(Tile.Steps, step => Assert.Equal(1, step.DistanceTo(new Tile(0, 0))));
        Assert.Equal(new Tile(0, 1), Tile.Steps[0]);
    }
}
