using Microsoft.UI.Xaml.Automation;
using SkiaSharp;
using Uno.WinUI.Graphics2DSK;
using Windows.Foundation;

namespace Cantrip.Client.Web;

/// <summary>
/// One gear item drawn as its card (<see cref="CardFace.DrawGear"/>), or a paper doll's empty slot, clicked to pick it: the
/// realm's gear screen lays its loadout and its owned gear out in these (MainPage.RealmGear.cs).
/// </summary>
public sealed class GearCardElement : SKCanvasElement
{
    private bool _selected;
    private bool _dimmed;

    /// <param name="gear">The item, or null for an empty slot.</param>
    /// <param name="place">Where it is, for the test state: <c>worn:head</c>, <c>owned</c>, <c>stock</c>.</param>
    /// <param name="instance">The owned copy's instance id, or 0 for an armorer's item or an empty slot.</param>
    /// <param name="empty">What an empty slot says.</param>
    public GearCardElement(GearCardSpec? gear, string place, long instance, float width, string empty = "")
    {
        Gear = gear;
        Place = place;
        Instance = instance;
        Empty = empty;
        Width = width;
        Height = MathF.Round(width * 88f / 63f);
        ProtectedCursor = Microsoft.UI.Input.InputSystemCursor.Create(Microsoft.UI.Input.InputSystemCursorShape.Hand);
        AutomationProperties.SetName(this, gear?.Name ?? empty);
        Tapped += (_, e) =>
        {
            e.Handled = true;
            Clicked?.Invoke(this);
        };
    }

    public GearCardSpec? Gear { get; }

    public string Place { get; }

    public long Instance { get; }

    public string Empty { get; }

    public event Action<GearCardElement>? Clicked;

    public bool Selected
    {
        get => _selected;
        set
        {
            if (_selected != value)
            {
                _selected = value;
                Invalidate();
            }
        }
    }

    public bool Dimmed
    {
        get => _dimmed;
        set
        {
            if (_dimmed != value)
            {
                _dimmed = value;
                Invalidate();
            }
        }
    }

    protected override void RenderOverride(SKCanvas canvas, Size area)
    {
        canvas.Clear(SKColors.Transparent);
        float width = (float)area.Width;
        float height = (float)area.Height;
        if (Gear is { } gear)
        {
            CardFace.DrawGear(canvas, gear, width, height, _dimmed, _selected);
        }
        else
        {
            CardFace.DrawEmptySlot(canvas, Empty, width, height, _selected);
        }
    }
}
