namespace Cantrip.Realms.Server.Content;

/// <summary>
/// A square tile of a space (realms/docs/conversion.md, "The world data, version 2"): <see cref="X"/> east and
/// <see cref="Z"/> south, in whole tiles, named by the space's own coordinates (the world's may be negative). Tile (x, z)
/// covers the world units [x, x + 1) by [z, z + 1).
/// </summary>
public readonly record struct Tile(int X, int Z)
{
    /// <summary>
    /// The eight steps to a neighbour, the four straight ones first: south (toward the camera), east, west, north, then the
    /// diagonals south-east, south-west, north-east, north-west. Where the server picks a neighbour (coming out of a
    /// dungeon), it takes the first that serves in this order.
    /// </summary>
    public static IReadOnlyList<Tile> Steps { get; } =
        [new(0, 1), new(1, 0), new(-1, 0), new(0, -1), new(1, 1), new(-1, 1), new(1, -1), new(-1, -1)];

    /// <summary>
    /// How many tiles apart two tiles are, the Chebyshev distance: the most of the two axes' differences, so the eight
    /// tiles round one are all 1 from it. "Within N tiles" is this distance at most N (interfaces.md, "Places").
    /// </summary>
    public static int Distance(Tile a, Tile b) => Math.Max(Math.Abs(a.X - b.X), Math.Abs(a.Z - b.Z));

    public int DistanceTo(Tile other) => Distance(this, other);

    /// <summary>The tile a step away.</summary>
    public Tile Plus(Tile step) => new(X + step.X, Z + step.Z);

    /// <summary>Whether a step to another tile is diagonal: both coordinates change.</summary>
    public bool IsDiagonalTo(Tile other) => X != other.X && Z != other.Z;

    /// <summary>The length of a step to a neighbour in tiles: 1 straight, the square root of 2 diagonally.</summary>
    public double StepLength(Tile to) => IsDiagonalTo(to) ? Math.Sqrt(2) : 1;

    public override string ToString() => $"({X}, {Z})";
}
