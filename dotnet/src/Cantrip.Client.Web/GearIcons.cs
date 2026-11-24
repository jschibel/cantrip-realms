using SkiaSharp;

namespace Cantrip.Client.Web;

/// <summary>
/// Gear items' icons for the realm's screens (design.md A4): each gear mesh the figures wear (realms/web's
/// art/figures/gear.ts) drawn as a sixteen-texel pixel sprite in the item's own palette - its first color the stuff, its
/// second the trim or the stone, each made a ramp of three steps as the figures' ramps are - under a dark outline, scaled
/// by whole texels so every size stays crisp. An empty slot shows its slot's sprite as a flat silhouette.
/// </summary>
public static class GearIcons
{
    /// <summary>The sprite of each gear mesh: <c>k</c> the outline, <c>1</c>-<c>3</c> the stuff dark to light, <c>4</c>-<c>6</c> the trim, <c>7</c> a glow.</summary>
    private static readonly Dictionary<string, string[]> Sprites = new(StringComparer.Ordinal)
    {
        ["circlet"] =
        [
            "................",
            "................",
            "................",
            "................",
            ".....kkkkkk.....",
            "...kk333322kk...",
            "..k33kkkkkk21k..",
            ".k32k......k21k.",
            ".k32k......k11k.",
            "..k22kkkkkk11k..",
            "...kk22k66k1kk..",
            ".....kkk57kkk...",
            "........kk......",
            "................",
            "................",
            "................",
        ],
        ["crown"] =
        [
            "................",
            "................",
            "................",
            ".k.....k.....k..",
            "k3k...k6k...k3k.",
            "k32k.k676k.k32k.",
            "k322k36763k223k.",
            "k322233533322kk.",
            "k3k66k3k3k66k2k.",
            "k2k45k2k2k45k1k.",
            "k22222222222211k",
            ".kkkkkkkkkkkkkk.",
            "................",
            "................",
            "................",
            "................",
        ],
        ["helm"] =
        [
            ".........6......",
            "........675.....",
            "........k64k....",
            ".......k3k4k....",
            ".....kkk3kkkk...",
            "....k3333332kk..",
            "...k333333222k..",
            "..k33322222211k.",
            "..k3k55555544kk.",
            "..k3k3kk2kk1k1k.",
            "..k3k3k.k.k1k1k.",
            "..k32k2k.k.k11k.",
            "..k22kk2k.kk11k.",
            "...kk.k1k..kkk..",
            ".......k........",
            "................",
        ],
        ["hood"] =
        [
            "................",
            "......kkk.......",
            ".....k333k......",
            "....k33322k.....",
            "...k332222kk....",
            "..k3322kkk21k...",
            "..k322kkkkk21k..",
            ".k322kkkkkkk1k..",
            ".k32kkkkkkkk1k..",
            ".k32kkkkkkkk1k..",
            ".k322kkkkkk11k..",
            ".k5555kkkk5544k.",
            "..k55544444444k.",
            "...kkkkkkkkkkk..",
            "................",
            "................",
        ],
        ["hat"] =
        [
            "...........k....",
            "..........k3k...",
            ".........k32k...",
            "........k322k...",
            ".......k3221k...",
            ".......k3221k...",
            "......k32221k...",
            "......k32211k...",
            ".....k322211k...",
            "....k66555444k..",
            "....k55444444k..",
            ".kkk3222222211kk",
            "k33322222222111k",
            ".kkkkkkkkkkkkkk.",
            "................",
            "................",
        ],
        ["amulet"] =
        [
            ".k3k........k3k.",
            "..k3k......k3k..",
            "...k2k....k2k...",
            "....k3k..k3k....",
            ".....k2kk2k.....",
            "......k33k......",
            "......k22k......",
            ".....kk66kk.....",
            "....k567765k....",
            "...k56777654k...",
            "...k56676654k...",
            "....k456654k....",
            ".....k4554k.....",
            "......k44k......",
            ".......kk.......",
            "................",
        ],
        ["armor"] =
        [
            "................",
            ".kkkk......kkkk.",
            "k3335k....k5221k",
            "k3355kkkkkk5521k",
            ".kk5k333222k5kk.",
            "...k33332222k...",
            "...k33322221k...",
            "...k33322221k...",
            "...k3332k221k...",
            "...k5555k444k...",
            "...k3332k221k...",
            "....k332k21k....",
            ".....kkkkkk.....",
            "................",
            "................",
            "................",
        ],
        ["robe"] =
        [
            "................",
            ".....kk..kk.....",
            "....k35kk53k....",
            "...k3365563k....",
            "..k3322562221k..",
            "..k3k225522k1k..",
            "..kkk225522kkk..",
            "....k225522k....",
            "....k325522k....",
            "....k325521k....",
            "...k3225522k1k..",
            "...k32255221k...",
            "..k322255222k1k.",
            "..k66555555444k.",
            "..kkkkkkkkkkkkk.",
            "................",
        ],
        ["cloak"] =
        [
            "................",
            ".....kkkkkk.....",
            "....k665544k....",
            "....k5k44k4k....",
            "...k333k3221k...",
            "...k332k2221k...",
            "..k3332k22211k..",
            "..k3322k22211k..",
            "..k3322k22111k..",
            ".k33322k221111k.",
            ".k33222k221111k.",
            ".k3322kk2k2111k.",
            "k33222k.k22111k.",
            "kkkkkk...kkkkkk.",
            "................",
            "................",
        ],
        ["gloves"] =
        [
            "................",
            ".....k.k.k......",
            "....k3k3k3k.....",
            "....k3k3k3k.k...",
            "....k3k3k2kk3k..",
            "....k3k2k2k32k..",
            "....k32222232k..",
            "....k3222222k...",
            "....k322222k....",
            "....k322221k....",
            "....k666554k....",
            "....k555444k....",
            "....kkkkkkkk....",
            "................",
            "................",
            "................",
        ],
        ["gauntlets"] =
        [
            "................",
            "....kk.kk.kk....",
            "...k33k33k33k...",
            "...k32k32k32kk..",
            "...k32k32k32k3k.",
            "...k32222222k2k.",
            "...k3222222221k.",
            "...k666655444k..",
            "...k33332222k...",
            "...k3k3k2k1k1k..",
            "...k33332222k...",
            "...k3322221k....",
            "...kkkkkkkkk....",
            "................",
            "................",
            "................",
        ],
        ["boots"] =
        [
            "................",
            "....kkkkkk......",
            "....k66544k.....",
            "....k55444k.....",
            ".....k3221k.....",
            ".....k3221k.....",
            ".....k3221k.....",
            ".....k3221k.....",
            ".....k32211k....",
            ".....k322111kk..",
            "....k3222221111k",
            "....k3222222111k",
            "....k4444444444k",
            ".....kkkkkkkkkk.",
            "................",
            "................",
        ],
        ["greaves"] =
        [
            "................",
            "....kkkkkkk.....",
            "...k3336544k....",
            "...k3322211k....",
            "...k5k5k4k4k....",
            "...k3322211k....",
            "...k3322221k....",
            "...k6655444k....",
            "...k33222211kk..",
            "...k332222211kk.",
            "...k3322222111kk",
            "..k33322222221kk",
            "..k55555544444k.",
            "...kkkkkkkkkkk..",
            "................",
            "................",
        ],
        ["ring"] =
        [
            "................",
            "................",
            "......kkkk......",
            ".....k6776k.....",
            ".....k5665k.....",
            "......k44k......",
            "....kk3kk2kk....",
            "...k33k..k21k...",
            "...k3k....k1k...",
            "...k3k....k1k...",
            "...k32k..k11k...",
            "....k22kk11k....",
            ".....kkkkkk.....",
            "................",
            "................",
            "................",
        ],
        ["relic"] =
        [
            ".......kk.......",
            "......k33k......",
            "......k2.k......",
            "......kkkk......",
            ".....k3333k.....",
            "....k335532k....",
            "...k3356652k1k..",
            "...k3567765k1k..",
            "...k3567765k1k..",
            "...k3356652k1k..",
            "....k335532k....",
            ".....k3221k.....",
            "......k21k......",
            ".......kk.......",
            "................",
            "................",
        ],
        ["orb"] =
        [
            ".......kk.......",
            "......k33k......",
            ".....kkkkkk.....",
            "....k3k66k1k....",
            "...k3k6777k1k...",
            "...k3k6777k1k...",
            "..k3k567776k1k..",
            "..kkkkkkkkkkkk..",
            "..k3k566765k1k..",
            "...k3k5665k1k...",
            "...k3k4554k1k...",
            "....k3k44k1k....",
            ".....kkkkkk.....",
            "......k21k......",
            ".......kk.......",
            "................",
        ],
    };

    /// <summary>The mesh an empty slot's silhouette is drawn with, and the one an item of an unknown mesh is.</summary>
    public static string SlotMesh(string slot) => slot switch
    {
        "head" => "helm",
        "neck" => "amulet",
        "body" => "armor",
        "hands" => "gloves",
        "feet" => "boots",
        "ring" or "ring1" or "ring2" => "ring",
        "relic" => "relic",
        _ => "relic",
    };

    /// <summary>Whether there is a sprite for a mesh.</summary>
    public static bool Has(string mesh) => Sprites.ContainsKey(mesh);

    /// <summary>
    /// The item's sprite, as large as whole texels allow within <paramref name="box"/> and centred on what it paints;
    /// <paramref name="palette"/> its colors as <c>#rrggbb</c> (a mesh's own when it names none).
    /// </summary>
    public static void Draw(SKCanvas canvas, string mesh, IReadOnlyList<string>? palette, SKRect box, float alpha = 1f)
    {
        ArgumentNullException.ThrowIfNull(canvas);
        string[] sprite = Sprites.GetValueOrDefault(mesh) ?? Sprites["relic"];
        SKColor stuff = Parse(palette, 0, SKColor.Parse("9aa0aa"));
        SKColor trim = Parse(palette, 1, stuff);
        SKColor[] stuffRamp = Ramp(stuff);
        SKColor[] trimRamp = Ramp(trim);
        SKColor glow = Mix(trimRamp[1], SKColors.White, 0.65f);
        SKColor outline = new((byte)(stuffRamp[0].Red * 0.22f), (byte)(stuffRamp[0].Green * 0.22f), (byte)(stuffRamp[0].Blue * 0.22f));
        Paint(canvas, sprite, box, alpha, texel => texel switch
        {
            'k' => outline,
            '1' => stuffRamp[0],
            '2' => stuffRamp[1],
            '3' => stuffRamp[2],
            '4' => trimRamp[0],
            '5' => trimRamp[1],
            '6' => trimRamp[2],
            '7' => glow,
            _ => null,
        });
    }

    /// <summary>A slot's sprite as one flat color: what an empty slot shows of what it holds.</summary>
    public static void DrawSilhouette(SKCanvas canvas, string slot, SKRect box, SKColor color)
    {
        ArgumentNullException.ThrowIfNull(canvas);
        Paint(canvas, Sprites[SlotMesh(slot)], box, 1f, texel => texel == '.' ? null : color);
    }

    private static void Paint(SKCanvas canvas, string[] sprite, SKRect box, float alpha, Func<char, SKColor?> colorOf)
    {
        // What the sprite paints, so it is centred on that rather than on its sixteen texels.
        int left = 16, top = 16, right = -1, bottom = -1;
        for (int y = 0; y < sprite.Length; y++)
        {
            for (int x = 0; x < sprite[y].Length; x++)
            {
                if (sprite[y][x] == '.') continue;
                left = Math.Min(left, x);
                right = Math.Max(right, x);
                top = Math.Min(top, y);
                bottom = Math.Max(bottom, y);
            }
        }

        if (right < 0) return;
        int wide = right - left + 1;
        int tall = bottom - top + 1;
        float texel = MathF.Max(1f, MathF.Floor(MathF.Min(box.Width / 16f, box.Height / 16f)));
        if (box.Width < 16f || box.Height < 16f) texel = MathF.Min(box.Width / 16f, box.Height / 16f);
        float x0 = MathF.Round(box.MidX - (wide * texel / 2f));
        float y0 = MathF.Round(box.MidY - (tall * texel / 2f));
        using var paint = new SKPaint { IsAntialias = false, Style = SKPaintStyle.Fill };
        for (int y = top; y <= bottom; y++)
        {
            for (int x = left; x <= right; x++)
            {
                if (colorOf(sprite[y][x]) is not { } color) continue;
                paint.Color = color.WithAlpha((byte)(color.Alpha * Math.Clamp(alpha, 0f, 1f)));
                canvas.DrawRect(x0 + ((x - left) * texel), y0 + ((y - top) * texel), texel, texel, paint);
            }
        }
    }

    private static SKColor Parse(IReadOnlyList<string>? palette, int index, SKColor otherwise) =>
        palette is not null && palette.Count > index && SKColor.TryParse(palette[index], out SKColor color) ? color : otherwise;

    /// <summary>A color's three steps: darker and cooler, itself, lighter and warmer.</summary>
    private static SKColor[] Ramp(SKColor color) =>
    [
        Mix(color, new SKColor(10, 12, 30), 0.42f),
        color,
        Mix(color, new SKColor(255, 250, 230), 0.38f),
    ];

    private static SKColor Mix(SKColor a, SKColor b, float f) => new(
        (byte)MathF.Round(a.Red + ((b.Red - a.Red) * f)),
        (byte)MathF.Round(a.Green + ((b.Green - a.Green) * f)),
        (byte)MathF.Round(a.Blue + ((b.Blue - a.Blue) * f)));
}
