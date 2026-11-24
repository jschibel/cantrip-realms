using Microsoft.UI.Xaml.Automation;
using SkiaSharp;
using Uno.WinUI.Graphics2DSK;
using Windows.Foundation;

namespace Cantrip.Client.Web;

/// <summary>
/// One slot of the realm's paper doll (MainPage.RealmGear.cs): an opaque tile holding the worn item's sprite in its own
/// colors (<see cref="GearIcons"/>), framed in its rarity's colour, or the slot's silhouette when it is empty; lit when
/// picked, and when an item dragged over it fits it.
/// </summary>
public sealed class GearSlotElement : SKCanvasElement
{
    private bool _selected;
    private bool _hot;

    public GearSlotElement(string slot, string says, RealmGearInstance? worn, double size)
    {
        Slot = slot;
        Says = says;
        Worn = worn;
        Width = size;
        Height = size;
        ProtectedCursor = Microsoft.UI.Input.InputSystemCursor.Create(Microsoft.UI.Input.InputSystemCursorShape.Hand);
        AutomationProperties.SetName(this, worn is null ? says : $"{says}: {worn.Gear.Name}");
    }

    /// <summary>The loadout slot: <c>head</c>, <c>neck</c>, <c>body</c>, <c>hands</c>, <c>feet</c>, <c>ring1</c>, <c>ring2</c>, <c>relic</c>.</summary>
    public string Slot { get; }

    /// <summary>What the slot is called on the doll: "Head", "Right hand ring".</summary>
    public string Says { get; }

    public RealmGearInstance? Worn { get; }

    /// <summary>The content slot an item must be to be worn here: a ring for either ring slot.</summary>
    public string Fits => Slot is "ring1" or "ring2" ? "ring" : Slot;

    public bool Selected
    {
        get => _selected;
        set
        {
            if (_selected == value) return;
            _selected = value;
            Invalidate();
        }
    }

    /// <summary>Lit as a drop target: an item dragged over the slot fits it.</summary>
    public bool Hot
    {
        get => _hot;
        set
        {
            if (_hot == value) return;
            _hot = value;
            Invalidate();
        }
    }

    protected override void RenderOverride(SKCanvas canvas, Size area)
    {
        // Never cleared: a clear would punch through to whatever is under the page (the world, under the card layer).
        var box = SKRect.Create((float)area.Width, (float)area.Height);
        float radius = 8f;
        SKColor edge = Worn is { } worn ? GearLook.RarityColor(worn.Gear.Rarity) : SKColor.Parse("3a4250");
        using (var fill = new SKPaint { IsAntialias = true })
        {
            fill.Shader = SKShader.CreateLinearGradient(new SKPoint(0, 0), new SKPoint(0, box.Height),
                [Worn is null ? SKColor.Parse("191c22") : SKColor.Parse("232831"), SKColor.Parse("14161b")], SKShaderTileMode.Clamp);
            canvas.DrawRoundRect(box, radius, radius, fill);
        }

        SKRect inner = SKRect.Inflate(box, -box.Width * 0.14f, -box.Height * 0.14f);
        if (Worn is { } item)
        {
            GearIcons.Draw(canvas, item.Gear.Look?.Mesh ?? GearIcons.SlotMesh(Slot), item.Gear.Look?.Palette, inner);
        }
        else
        {
            GearIcons.DrawSilhouette(canvas, Slot, inner, SKColor.Parse("2a2f38"));
        }

        float stroke = _selected || _hot ? 3f : (Worn is null ? 1.5f : 2f);
        SKColor line = _hot ? SKColor.Parse("8ec9ff") : _selected ? SKColor.Parse("f1b44c") : edge;
        using var border = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = stroke, Color = line };
        if (Worn is null && !_selected && !_hot) border.PathEffect = SKPathEffect.CreateDash([5f, 4f], 0f);
        canvas.DrawRoundRect(SKRect.Inflate(box, -stroke / 2f, -stroke / 2f), radius, radius, border);
    }
}

/// <summary>A gear item's sprite at a size: in a row of the gear list, the inventory, or carried in a drag.</summary>
public sealed class GearIconElement : SKCanvasElement
{
    public GearIconElement(RealmGear gear, double size)
    {
        Gear = gear;
        Width = size;
        Height = size;
        IsHitTestVisible = false;
    }

    public RealmGear Gear { get; }

    protected override void RenderOverride(SKCanvas canvas, Size area)
    {
        var box = SKRect.Create((float)area.Width, (float)area.Height);
        using (var fill = new SKPaint { IsAntialias = true })
        {
            SKColor rarity = GearLook.RarityColor(Gear.Rarity);
            fill.Shader = SKShader.CreateRadialGradient(new SKPoint(box.MidX, box.MidY), box.Width * 0.7f,
                [GearLook.Mix(SKColor.Parse("1b1e25"), Gear.Rarity == "common" ? SKColor.Parse("5a606c") : rarity, 0.35f), SKColor.Parse("14161b")], SKShaderTileMode.Clamp);
            canvas.DrawRoundRect(box, 6f, 6f, fill);
        }

        GearIcons.Draw(canvas, Gear.Look?.Mesh ?? GearIcons.SlotMesh(Gear.Slot), Gear.Look?.Palette, SKRect.Inflate(box, -box.Width * 0.1f, -box.Height * 0.1f));
    }
}

/// <summary>
/// The character on the paper doll, as the overworld draws them wearing what they wear (its portrait, a picture it renders
/// of the figure and hands back), magnified by whole pixels on a lit floor; empty until the picture comes.
/// </summary>
public sealed class GearPortraitElement : SKCanvasElement
{
    private SKBitmap? _picture;

    public GearPortraitElement() => IsHitTestVisible = false;

    public SKBitmap? Picture
    {
        get => _picture;
        set
        {
            _picture = value;
            Invalidate();
        }
    }

    protected override void RenderOverride(SKCanvas canvas, Size area)
    {
        var box = SKRect.Create((float)area.Width, (float)area.Height);
        using (var ground = new SKPaint { IsAntialias = true })
        {
            ground.Shader = SKShader.CreateRadialGradient(new SKPoint(box.MidX, box.Height * 0.42f), box.Height * 0.62f,
                [SKColor.Parse("2a303a"), SKColor.Parse("15181d")], SKShaderTileMode.Clamp);
            canvas.DrawRoundRect(box, 10f, 10f, ground);
        }

        using (var shadow = new SKPaint { IsAntialias = true, Color = new SKColor(0, 0, 0, 90) })
        {
            canvas.DrawOval(new SKPoint(box.MidX, box.Height * 0.86f), new SKSize(box.Width * 0.26f, box.Height * 0.035f), shadow);
        }

        if (_picture is { } picture && picture.Width > 0 && picture.Height > 0)
        {
            float scale = MathF.Max(1f, MathF.Floor(MathF.Min(box.Width * 0.92f / picture.Width, box.Height * 0.9f / picture.Height)));
            float w = picture.Width * scale;
            float h = picture.Height * scale;
            var at = SKRect.Create(MathF.Round(box.MidX - (w / 2f)), MathF.Round((box.Height * 0.88f) - h), w, h);
            using var image = SKImage.FromBitmap(picture);
            canvas.DrawImage(image, at, new SKSamplingOptions(SKFilterMode.Nearest, SKMipmapMode.None));
        }

        using var edge = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 1f, Color = SKColor.Parse("2c313a") };
        canvas.DrawRoundRect(SKRect.Inflate(box, -0.5f, -0.5f), 10f, 10f, edge);
    }
}

/// <summary>What the gear screens share of how an item looks: its rarity's colour.</summary>
public static class GearLook
{
    /// <summary>Each rarity's colour, as a set symbol's: grey, silver, gold and orange.</summary>
    public static SKColor RarityColor(string rarity) => rarity switch
    {
        "uncommon" => SKColor.Parse("a7b4c2"),
        "rare" => SKColor.Parse("d9b45a"),
        "mythic" => SKColor.Parse("e0702f"),
        _ => SKColor.Parse("6c7482"),
    };

    /// <summary>The same as a XAML colour, for a row's name.</summary>
    public static Windows.UI.Color RarityText(string rarity) => rarity switch
    {
        "uncommon" => Theme.FromHex("#c3ccd6"),
        "rare" => Theme.FromHex("#e8c56a"),
        "mythic" => Theme.FromHex("#f08a4a"),
        _ => Theme.Fg,
    };

    public static SKColor Mix(SKColor a, SKColor b, float f) => new(
        (byte)MathF.Round(a.Red + ((b.Red - a.Red) * f)),
        (byte)MathF.Round(a.Green + ((b.Green - a.Green) * f)),
        (byte)MathF.Round(a.Blue + ((b.Blue - a.Blue) * f)));
}
