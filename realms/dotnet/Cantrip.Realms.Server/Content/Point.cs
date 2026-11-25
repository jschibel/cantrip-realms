namespace Cantrip.Realms.Server.Content;

/// <summary>
/// A point of a space in world units (realms/docs/interfaces.md, "Presence"): <see cref="X"/> east and <see cref="Z"/>
/// south, the tile (x, z) covering [x, x + 1) by [z, z + 1), so a tile's middle is (x + 0.5, z + 0.5). Where a player
/// stands as the relay knows it: they walk at any angle, not tile to tile.
/// </summary>
public readonly record struct Point(double X, double Z)
{
    /// <summary>A tile's middle.</summary>
    public static Point Middle(Tile tile) => new(tile.X + 0.5, tile.Z + 0.5);

    /// <summary>The tile the point is on.</summary>
    public Tile Tile => new((int)Math.Floor(X), (int)Math.Floor(Z));

    /// <summary>How far apart two points are, in a straight line.</summary>
    public double DistanceTo(Point other) => Math.Sqrt(((X - other.X) * (X - other.X)) + ((Z - other.Z) * (Z - other.Z)));

    /// <summary>The point a fraction of the way to another.</summary>
    public Point Toward(Point other, double fraction) => new(X + ((other.X - X) * fraction), Z + ((other.Z - Z) * fraction));

    public override string ToString() => FormattableString.Invariant($"({X:0.###}, {Z:0.###})");
}
