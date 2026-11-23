namespace Cantrip.Realms.Server.Content;

/// <summary>
/// A hex of a map in axial coordinates (realms/web/src/hex.ts): flat-topped, q along world x, r down and to the right.
/// </summary>
public readonly record struct Hex(int Q, int R)
{
    /// <summary>The six steps to a neighbour, in hex.ts's order.</summary>
    public static IReadOnlyList<Hex> Directions { get; } = [new(1, 0), new(1, -1), new(0, -1), new(-1, 0), new(-1, 1), new(0, 1)];

    /// <summary>Steps between two hexes, walking hex to hex.</summary>
    public static int Distance(Hex a, Hex b)
    {
        int dq = a.Q - b.Q;
        int dr = a.R - b.R;
        return (Math.Abs(dq) + Math.Abs(dr) + Math.Abs(dq + dr)) / 2;
    }

    public int DistanceTo(Hex other) => Distance(this, other);

    public override string ToString() => $"({Q}, {R})";
}
