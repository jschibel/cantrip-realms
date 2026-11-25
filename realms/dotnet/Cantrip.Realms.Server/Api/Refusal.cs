namespace Cantrip.Realms.Server;

/// <summary>A refused call's body (realms/docs/interfaces.md): a code, words, and for a deck or loadout what is wrong with it.</summary>
public sealed record ApiError(string Error, string Detail, IReadOnlyList<string>? Problems = null);

/// <summary>A call the realm refuses: its HTTP status, its code and why. The API answers it as an <see cref="ApiError"/>.</summary>
public sealed class Refusal(int status, string code, string detail, IReadOnlyList<string>? problems = null) : Exception(detail)
{
    public int Status { get; } = status;

    public string Code { get; } = code;

    public IReadOnlyList<string>? Problems { get; } = problems;

    public static Refusal NotFound(string code, string detail) => new(StatusCodes.Status404NotFound, code, detail);

    public static Refusal Conflict(string code, string detail) => new(StatusCodes.Status409Conflict, code, detail);

    public static Refusal Unprocessable(string code, string detail, IReadOnlyList<string>? problems = null) =>
        new(StatusCodes.Status422UnprocessableEntity, code, detail, problems);

    public static Refusal BadRequest(string detail) => new(StatusCodes.Status400BadRequest, "BadRequest", detail);
}

/// <summary>The codes a refusal names (realms/docs/interfaces.md).</summary>
public static class Codes
{
    public const string NoCharacter = "NoCharacter";
    public const string HasCharacter = "HasCharacter";
    public const string NotAtTable = "NotAtTable";
    public const string IllegalDeck = "IllegalDeck";
    public const string IllegalLoadout = "IllegalLoadout";
    public const string NoVendor = "NoVendor";
    public const string SoldOut = "SoldOut";
    public const string CannotAfford = "CannotAfford";
    public const string NotTheirTrade = "NotTheirTrade";
    public const string VendorCannotAfford = "VendorCannotAfford";
    public const string VendorFull = "VendorFull";
    public const string InDeck = "InDeck";
    public const string NotOwned = "NotOwned";
    public const string NoArmorer = "NoArmorer";
    public const string NotInStock = "NotInStock";
    public const string Worn = "Worn";
    public const string NotNear = "NotNear";
    public const string NotThere = "NotThere";
    public const string TooSoon = "TooSoon";
    public const string Unfinished = "Unfinished";
    public const string NoDuel = "NoDuel";
    public const string Finished = "Finished";
    public const string Defeated = "Defeated";
    public const string NoBuyout = "NoBuyout";
    public const string MostHearts = "MostHearts";
    public const string FullHearts = "FullHearts";
    public const string Empty = "Empty";
    public const string NoSuchPlace = "NoSuchPlace";
    public const string NotSignedIn = "NotSignedIn";
    public const string Relic = "Relic";
    public const string Locked = "Locked";
    public const string NoWay = "NoWay";
    public const string WardenStands = "WardenStands";
    public const string NotAttuned = "NotAttuned";
}
