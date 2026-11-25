using SkiaSharp;

namespace Cantrip.Client.Web;

/// <summary>
/// What a card's note looks like in the realm's card layer (<c>?realm</c>, Cantrip Realms): every card of its spell table,
/// inventory and sideboard carries one - copies left, its price, "relic" - so the note is a band across the top of the art,
/// under the name, rather than a veil over the whole picture as a table's one-off note is (<see cref="CardFace.Draw"/>'s
/// annotation). Under the name it also shows on a card of a stacked column, where only the top of each card is seen.
/// </summary>
public static partial class CardFace
{
    /// <summary>Draws <paramref name="note"/> as the realm's band and says so; false outside the realm, to draw it as ever.</summary>
    private static bool DrawRealmNote(SKCanvas canvas, string note, Layout layout, float cardWidth)
    {
        if (!ClientConfig.Realm)
        {
            return false;
        }

        SKRect art = layout.Art;
        int size = Scaled(9, cardWidth);
        float step = LineHeight(CardAssets.Title, size);
        List<string> lines = [.. WrapWords(CardAssets.Title, note, size, art.Width - 6).Take(2)];
        var band = SKRect.Create(art.Left, art.Top, art.Width, Math.Min(art.Height, (lines.Count * step) + 3));
        Fill(canvas, band, new SKColor(20, 20, 26, 214));

        float baseline = art.Top + size + 1;
        foreach (string line in lines)
        {
            DrawString(canvas, CardAssets.Title, line, Aligned(CardAssets.Title, line, size, art, "center"), baseline, size, SKColor.Parse("ffd479"));
            baseline += step;
        }

        return true;
    }
}
