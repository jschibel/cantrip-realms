using System.Globalization;
using Cantrip.Protocol;
using SkiaSharp;

namespace Cantrip.Client.Web;

/// <summary>
/// A gear item as a card (Cantrip Realms, design.md A4): what a worn item is in the game - a Vanguard-style object in its
/// wearer's command zone - drawn as one, oversized as a Vanguard card is, on the same template and in the same hand as
/// every face (<see cref="CardFace.Draw"/>): its name, "Gear - Head" and its rarity on the type line, its stat lines and
/// text in the rules box, and at its foot the Vanguard card's modifiers, the hand on the left and life on the right.
/// </summary>
/// <param name="Name">The item's name.</param>
/// <param name="Slot">Where it is worn: <c>head</c>, <c>neck</c>, <c>body</c>, <c>hands</c>, <c>feet</c>, <c>ring</c>, <c>relic</c>.</param>
/// <param name="Rarity"><c>common</c>, <c>uncommon</c>, <c>rare</c> or <c>mythic</c>.</param>
/// <param name="Life">What it adds to starting life (CR 103.4), negative for less.</param>
/// <param name="Hand">What it adds to the starting hand size (CR 103.5).</param>
/// <param name="MaxHand">What it adds to the maximum hand size (CR 402.2).</param>
/// <param name="Text">Its abilities, one a line, as its content file words them.</param>
public sealed record GearCardSpec(string Name, string Slot, string Rarity, int Life, int Hand, int MaxHand, string Text)
{
    /// <summary>A Vanguard card stands as a card does, a size larger: 3.5 by 5 inches to a card's 2.5 by 3.5.</summary>
    public const float Oversize = 1.4f;

    /// <summary>The stat lines, as its rules box opens with them: "Starting life +2.", "Maximum hand size +1."</summary>
    public IEnumerable<string> StatLines()
    {
        if (Life != 0) yield return $"Starting life {Signed(Life)}.";
        if (Hand != 0) yield return $"Starting hand size {Signed(Hand)}.";
        if (MaxHand != 0) yield return $"Maximum hand size {Signed(MaxHand)}.";
    }

    public static string Signed(int value) => value.ToString("+0;-0;+0", CultureInfo.InvariantCulture);

    /// <summary>The slot as the type line says it.</summary>
    public string SlotName => Slot.Length == 0 ? "Gear" : char.ToUpperInvariant(Slot[0]) + Slot[1..];
}

public static partial class CardFace
{
    /// <summary>Each rarity's colour, as a set symbol's: black, silver, gold and orange.</summary>
    private static SKColor RarityColor(string rarity) => rarity switch
    {
        "uncommon" => SKColor.Parse("a7b4c2"),
        "rare" => SKColor.Parse("d9b45a"),
        "mythic" => SKColor.Parse("e0702f"),
        _ => SKColor.Parse("1c1c1c"),
    };

    /// <summary>
    /// A gear item's face, <paramref name="width"/> by <paramref name="height"/>: drawn as a colorless artifact's face is, its
    /// art box holding its slot, and lit at the edge when <paramref name="selected"/>.
    /// </summary>
    public static void DrawGear(SKCanvas canvas, GearCardSpec gear, float width, float height, bool dimmed, bool selected)
    {
        ArgumentNullException.ThrowIfNull(canvas);
        ArgumentNullException.ThrowIfNull(gear);
        var face = SKRect.Create(width, height);
        string rules = string.Join('\n', gear.StatLines().Concat(gear.Text.Split('\n', StringSplitOptions.RemoveEmptyEntries)));
        var card = new ObjectView
        {
            Known = true,
            Name = gear.Name,
            CardTypes = [CardTypeView.Artifact],
            OracleText = rules,
            Kind = ObjectKindView.Emblem,
            Zone = ZoneKindView.Command,
        };

        var layout = new Layout(width, height);
        SKColor frame = FrameColor(card);
        if (dimmed)
        {
            frame = Lerp(frame, DimmedFrame, 0.55f);
        }

        SKColor ink = Ink(dimmed);
        SKColor outerText = SKColor.Parse(CardAssets.Template.TextStyle.OuterTextColor);
        SKColor outerShadow = ParseAlpha(CardAssets.Template.TextStyle.OuterTextShadowColor);

        // The art box holds what the item is worn on, in its rarity's colour: gear has no illustration.
        SKRect art = layout.Art;
        Fill(canvas, SKRect.Inflate(art, 1f, 1f), Lerp(frame, InkColor, 0.35f));
        int slotSize = Math.Max(8, (int)MathF.Round(art.Height * 0.24f));
        string slot = gear.SlotName.ToUpperInvariant();
        int fitted = FittedSize(CardAssets.Title, slot, slotSize, Math.Max(6, slotSize / 2), art.Width * 0.8f);
        SKColor gem = RarityColor(gear.Rarity);
        DrawString(canvas, CardAssets.Title, slot, Aligned(CardAssets.Title, slot, fitted, art, "center"), CapBaseline(CardAssets.Title, art, fitted), fitted, Lerp(gem, Parchment, gear.Rarity == "common" ? 0.75f : 0.1f));
        Stroke(canvas, art, Lerp(frame, InkColor, 0.72f), MathF.Max(1f, width / StandardWidth));

        using (var framePaint = new SKPaint { IsAntialias = true })
        {
            if (dimmed)
            {
                framePaint.ColorFilter = SKColorFilter.CreateBlendMode(new SKColor(158, 158, 158), SKBlendMode.Modulate);
            }

            DrawFrame(canvas, card, face, framePaint, layout.Cut);
        }

        float nameX = layout.Title.Left + layout.TextInset;
        float titleRoom = Room(layout, nameX, layout.Title);
        int nameSize = FittedSize(CardAssets.Title, gear.Name, layout.TitleFontSize, layout.MinimumTitleFontSize, titleRoom);
        DrawFrameString(canvas, nameX, CapBaseline(CardAssets.Title, layout.Title, nameSize) - layout.TitleLift, Fit(CardAssets.Title, gear.Name, nameSize, titleRoom), nameSize, outerText, outerShadow, layout.OuterTextShadowOffset);

        // "Gear - Head" on the left of the type line, and the rarity where a set symbol stands, on the right in its colour.
        string type = $"Gear - {gear.SlotName}";
        string rarity = gear.Rarity.Length == 0 ? string.Empty : char.ToUpperInvariant(gear.Rarity[0]) + gear.Rarity[1..];
        float typeX = layout.Type.Left + layout.TextInset;
        int rarityWidth = 0;
        if (rarity.Length > 0)
        {
            using var font = new SKFont(CardAssets.Title, layout.TypeFontSize);
            rarityWidth = (int)MathF.Ceiling(font.MeasureText(rarity));
            float rarityX = layout.Type.Right - layout.TextInset - rarityWidth;
            float baseline = CapBaseline(CardAssets.Title, layout.Type, layout.TypeFontSize) - layout.TypeLift;
            DrawFrameString(canvas, rarityX, baseline, rarity, layout.TypeFontSize, gem, outerShadow, layout.OuterTextShadowOffset);
        }

        float typeRoom = Room(layout, typeX, layout.Type) - rarityWidth - layout.TextInset;
        int typeSize = FittedSize(CardAssets.Title, type, layout.TypeFontSize, layout.MinimumTypeFontSize, typeRoom);
        DrawFrameString(canvas, typeX, CapBaseline(CardAssets.Title, layout.Type, typeSize) - layout.TypeLift, Fit(CardAssets.Title, type, typeSize, typeRoom), typeSize, outerText, outerShadow, layout.OuterTextShadowOffset);

        DrawOracle(canvas, card, ink, layout);

        // A Vanguard card's modifiers: its hand on the left of its foot, its life on the right.
        string hand = $"Hand {GearCardSpec.Signed(gear.Hand)}" + (gear.MaxHand != 0 ? $" / max {GearCardSpec.Signed(gear.MaxHand)}" : string.Empty);
        string life = $"Life {GearCardSpec.Signed(gear.Life)}";
        SKRect foot = layout.Artist;
        int footSize = layout.ArtistFontSize;
        DrawFrameString(canvas, foot.Left + layout.TextInset, CapBaseline(CardAssets.Title, foot, footSize), Fit(CardAssets.Title, hand, footSize, foot.Width * 0.6f), footSize, outerText, outerShadow, layout.OuterTextShadowOffset);
        SKRect body = layout.Body;
        RoundedBox(canvas, body, Parchment, Lerp(frame, InkColor, 0.4f), 1, 5);
        int lifeSize = FittedSize(CardAssets.Title, life, layout.BodyFontSize, Math.Max(5, layout.BodyFontSize / 2), body.Width - (2 * layout.TextInset));
        DrawString(canvas, CardAssets.Title, life, Aligned(CardAssets.Title, life, lifeSize, body, "center"), CapBaseline(CardAssets.Title, body, lifeSize), lifeSize, InkColor);

        if (selected)
        {
            using var lit = new SKPaint
            {
                IsAntialias = true,
                Style = SKPaintStyle.Stroke,
                StrokeWidth = MathF.Max(2f, width * 0.018f),
                Color = SKColor.Parse("f1b44c"),
            };
            float inset = lit.StrokeWidth / 2f;
            canvas.DrawRoundRect(SKRect.Inflate(face, -inset, -inset), width * 0.045f, width * 0.045f, lit);
        }
    }

    /// <summary>An empty slot of a paper doll: the card's outline, and the slot's name in it.</summary>
    public static void DrawEmptySlot(SKCanvas canvas, string slot, float width, float height, bool selected)
    {
        ArgumentNullException.ThrowIfNull(canvas);
        ArgumentNullException.ThrowIfNull(slot);
        var face = SKRect.Create(width, height);
        float radius = width * 0.045f;
        using (var fill = new SKPaint { IsAntialias = true, Color = new SKColor(255, 255, 255, 14) })
        {
            canvas.DrawRoundRect(face, radius, radius, fill);
        }

        using (var edge = new SKPaint
        {
            IsAntialias = true,
            Style = SKPaintStyle.Stroke,
            StrokeWidth = selected ? MathF.Max(2f, width * 0.018f) : 1.5f,
            Color = selected ? SKColor.Parse("f1b44c") : new SKColor(255, 255, 255, 70),
            PathEffect = selected ? null : SKPathEffect.CreateDash([6f, 5f], 0f),
        })
        {
            float inset = edge.StrokeWidth / 2f;
            canvas.DrawRoundRect(SKRect.Inflate(face, -inset, -inset), radius, radius, edge);
        }

        int size = Math.Max(8, (int)MathF.Round(width * 0.11f));
        int fitted = FittedSize(CardAssets.Title, slot, size, 6, width * 0.85f);
        DrawString(canvas, CardAssets.Title, slot, Aligned(CardAssets.Title, slot, fitted, face, "center"), CapBaseline(CardAssets.Title, face, fitted), fitted, new SKColor(255, 255, 255, 120));
    }
}
