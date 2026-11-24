using Microsoft.UI.Input;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Input;
using SkiaSharp;
using Windows.Foundation;

namespace Cantrip.Client.Web;

/// <summary>
/// The realm's <c>gear</c> screen (realms/docs/interfaces.md, "The card layer"; design.md A4): an equipment screen in three
/// columns.
/// <list type="bullet">
/// <item>The paper doll: the character as the overworld draws them, wearing what they wear (a portrait it renders on
/// request, <see cref="RealmBridge.AskPortrait"/>), between the eight slots - Head, Neck, Body and Hands on the left, the
/// two rings, Feet and the Relic on the right - each an opaque tile holding the worn item's sprite (<see cref="GearIcons"/>)
/// or the slot's silhouette; and under it what the loadout makes of the setup values, life, opening hand and maximum hand,
/// against their base and their allowed range.</item>
/// <item>The gear: every item the character owns (and at an armorer, the stock for sale), a row each - its sprite, its
/// name in its rarity's colour, its slot, rarity and points against its rarity's budget, its stat lines and its effects in
/// words - filtered by slot.</item>
/// <item>The item picked, as the Vanguard-style oversized card it is in a duel (<see cref="CardFace.DrawGear"/>), what wearing
/// it would make of the setup values, and what can be done with it: wear it (a ring on either hand), take it off, buy it or
/// sell it.</item>
/// </list>
/// An owned item is worn by dragging it onto its slot as well, and a worn one taken off by dragging it back to the list. Every
/// change is saved at once through <c>PUT /api/loadout</c>; buying and selling go through the armorer's calls.
/// </summary>
public sealed partial class MainPage
{
    /// <summary>The picked item's card: an oversized Vanguard card, large enough to read whole.</summary>
    private const float GearDetailWidth = 280f;

    private const double GearSlotSize = 84;

    /// <summary>The paper doll's slots: the column they stand in (0 left of the figure, 2 right), their row, and what they are called.</summary>
    private static readonly (string Slot, int Column, int Row, string Says)[] DollSlots =
    [
        ("head", 0, 0, "Head"),
        ("neck", 0, 1, "Neck"),
        ("body", 0, 2, "Body"),
        ("hands", 0, 3, "Hands"),
        ("ring1", 2, 0, "Right hand ring"),
        ("ring2", 2, 1, "Left hand ring"),
        ("feet", 2, 2, "Feet"),
        ("relic", 2, 3, "Relic"),
    ];

    /// <summary>The content slots in the doll's order, which the list is sorted and filtered by.</summary>
    private static readonly string[] GearSlotOrder = ["head", "neck", "body", "hands", "feet", "ring", "relic"];

    private static readonly string[] GearRarities = ["mythic", "rare", "uncommon", "common"];

    /// <summary>The base setup values and the ranges a loadout keeps them in (design.md A1; the server's loadout check).</summary>
    private static readonly (string Name, string Says, int Base, int Least, int Most)[] GearSetupValues =
    [
        ("life", "Starting life", 20, 10, 40),
        ("hand", "Opening hand", 7, 4, 9),
        ("maxHand", "Maximum hand", 7, 4, 10),
    ];

    /// <summary>What is picked on the gear screen: an item worn (<c>worn:head</c>), owned and not worn (<c>owned</c>), or for sale (<c>stock</c>).</summary>
    private sealed record GearPick(string Place, long Instance, string GearId);

    /// <summary>A row of the gear list and what it holds, for picking, dragging and the test state.</summary>
    private sealed record GearRow(Border Row, RealmGear Gear, string Place, long Instance);

    private RealmCharacter? _gearCharacter;
    private RealmArmorer? _armorer;
    private string? _armorerTown;
    private GearPick? _gearPicked;
    private string? _gearFilter;
    private bool _gearBusy;
    private RealmCommand? _gearCommand;

    private readonly List<GearSlotElement> _gearSlots = [];
    private readonly List<GearRow> _gearRows = [];
    private readonly GearPortraitElement _gearPortrait = new();
    private Canvas? _gearOverlay;
    private FrameworkElement? _gearListArea;

    /// <summary>The last portrait asked for, its number and the looks it was asked of: an answer to an older one is dropped.</summary>
    private int _gearPortraitAsked;
    private string _gearPortraitOf = string.Empty;

    // A drag under way: what is carried, from where, the pointer's start, and the sprite following the pointer.
    private (RealmGear Gear, string From, long Instance, Point Start, UIElement Source)? _gearPress;
    private GearIconElement? _gearGhost;

    private async Task OpenGearAsync(RealmCommand command)
    {
        _armorerTown = Arg(command.Args, "armorer");
        _gearCommand = command;
        ShowRealmLoading(_armorerTown is null ? "Gear" : "The armorer", "Laying out your gear...");
        RealmReply<RealmCharacter> me = await RealmApi.GetAsync("me", RealmJson.Default.RealmCharacter);
        RealmReply<RealmArmorer>? stock = _armorerTown is { } town
            ? await RealmApi.GetAsync($"armorer/{Uri.EscapeDataString(town)}", RealmJson.Default.RealmArmorer)
            : null;
        if (!StillOpen(command))
        {
            return;
        }

        if (!me.Ok || stock is { Ok: false })
        {
            ShowRealmProblem("Gear", me.Ok ? stock!.Words : me.Words, "closed");
            return;
        }

        _gearCharacter = me.Value;
        _armorer = stock?.Value;
        _gearPicked = null;
        _gearFilter = null;
        _gearPortraitOf = string.Empty;
        ShowRealmScreen(_armorerTown is null ? "Gear" : Describe(command.Args) is { Length: > 0 } named ? Capitalised(named) : "The armorer", new Grid());
        RealmAction("Done", primary: false, () => CloseRealmScreen("closed"));
        ShowGear();
    }

    private static string Capitalised(string text) => text.Length == 0 ? text : char.ToUpperInvariant(text[0]) + text[1..];

    private static GearCardSpec Spec(RealmGear gear) =>
        new(gear.Name, gear.Slot, gear.Rarity, gear.Stats.Life, gear.Stats.Hand, gear.Stats.MaxHand, gear.Text, gear.Look?.Mesh ?? string.Empty, gear.Look?.Palette);

    /// <summary>The worn item in a loadout slot, or null.</summary>
    private RealmGearInstance? WornIn(string slot) => _gearCharacter?.Loadout.GetValueOrDefault(slot);

    /// <summary>The loadout slot an owned item is worn in, or null when it is not worn.</summary>
    private string? SlotWearing(long instance) =>
        _gearCharacter?.Loadout.FirstOrDefault(worn => worn.Value?.InstanceId == instance).Key;

    /// <summary>The screen laid out again from what the server last said, keeping what was picked if it is still there.</summary>
    private void ShowGear()
    {
        if (_gearCharacter is not { } character || _gearCommand is null || !StillOpen(_gearCommand))
        {
            return;
        }

        _gearSlots.Clear();
        _gearRows.Clear();
        _realmGearCards.Clear();
        EndGearDrag();
        if (_gearPicked is { } picked && !PickStands(picked))
        {
            _gearPicked = null;
        }

        var columns = new Grid { ColumnSpacing = 22 };
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 300 });
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(GearDetailWidth + 12) });

        FrameworkElement doll = GearDoll(character);
        columns.Children.Add(RealmScroll(doll));

        FrameworkElement list = GearList(character);
        Grid.SetColumn(list, 1);
        columns.Children.Add(list);

        FrameworkElement detail = RealmScroll(GearDetail(character));
        Grid.SetColumn(detail, 2);
        columns.Children.Add(detail);

        _gearOverlay = new Canvas { IsHitTestVisible = false };
        Grid.SetColumnSpan(_gearOverlay, 3);
        columns.Children.Add(_gearOverlay);

        columns.PointerMoved += GearPointerMoved;
        columns.PointerReleased += GearPointerReleased;
        columns.PointerCaptureLost += (_, _) => EndGearDrag();
        _realmContent.Child = columns;
        _realmFacts.Text = Gold(character.Gold);
        AskGearPortrait(character);
    }

    /// <summary>Whether something picked is still on the screen: a worn slot still holding it, an owned item still owned and not worn, stock still stocked.</summary>
    private bool PickStands(GearPick pick) => pick.Place switch
    {
        _ when pick.Place.StartsWith("worn:", StringComparison.Ordinal) => WornIn(pick.Place["worn:".Length..])?.InstanceId == pick.Instance,
        "owned" => _gearCharacter!.Gear.Any(item => item.InstanceId == pick.Instance) && SlotWearing(pick.Instance) is null,
        "stock" => _armorer?.Stock.Any(item => item.Id == pick.GearId) == true,
        _ => false,
    };

    // --- The paper doll ------------------------------------------------------------------------------------------------

    private FrameworkElement GearDoll(RealmCharacter character)
    {
        var doll = new Grid { ColumnSpacing = 14, RowSpacing = 4 };
        doll.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(GearSlotSize + 20) });
        doll.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(200) });
        doll.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(GearSlotSize + 20) });
        for (int i = 0; i < 4; i++) doll.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        foreach ((string slot, int column, int row, string says) in DollSlots)
        {
            RealmGearInstance? worn = WornIn(slot);
            var tile = new GearSlotElement(slot, says, worn, GearSlotSize)
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                Selected = _gearPicked?.Place == $"worn:{slot}" || (_gearPicked is null && worn is null && _gearFilter == SlotKind(slot) && SlotKind(slot) != "ring"),
            };
            tile.PointerPressed += (_, e) => GearPressed(tile, e, worn?.Gear, $"worn:{slot}", worn?.InstanceId ?? 0);
            _gearSlots.Add(tile);

            var label = new StackPanel { Spacing = 1, Margin = new Thickness(0, 4, 0, 0) };
            label.Children.Add(new TextBlock { Text = says, FontSize = 12, Foreground = Theme.Brush(Theme.FgMuted), HorizontalAlignment = HorizontalAlignment.Center, TextAlignment = TextAlignment.Center });
            label.Children.Add(new TextBlock
            {
                Text = worn?.Gear.Name ?? "Empty",
                FontSize = 13,
                Foreground = new SolidColorBrush(worn is null ? Theme.FgMuted : GearLook.RarityText(worn.Gear.Rarity)),
                TextWrapping = TextWrapping.WrapWholeWords,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                MaxLines = 2,
                MaxWidth = GearSlotSize + 20,
                Height = 34,
            });
            var cell = new StackPanel { Children = { tile, label } };
            Grid.SetColumn(cell, column);
            Grid.SetRow(cell, row);
            doll.Children.Add(cell);
        }

        (_gearPortrait.Parent as Panel)?.Children.Remove(_gearPortrait);
        _gearPortrait.Width = 200;
        _gearPortrait.VerticalAlignment = VerticalAlignment.Stretch;
        Grid.SetColumn(_gearPortrait, 1);
        Grid.SetRowSpan(_gearPortrait, 4);
        doll.Children.Add(_gearPortrait);

        return new StackPanel
        {
            Spacing = 6,
            Children = { GearStats(character), doll },
        };
    }

    /// <summary>The content slot a loadout slot holds: a ring for either ring slot.</summary>
    private static string SlotKind(string slot) => slot is "ring1" or "ring2" ? "ring" : slot;

    /// <summary>The setup values the loadout makes: each against its base, with the range it is kept in.</summary>
    private static FrameworkElement GearStats(RealmCharacter character)
    {
        var stats = new Grid { ColumnSpacing = 8, Margin = new Thickness(0, 0, 0, 8) };
        int column = 0;
        foreach ((string name, string says, int baseValue, int least, int most) in GearSetupValues)
        {
            stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            int value = GearStat(character.Stats, name);
            int gear = value - baseValue;
            var tile = new Border
            {
                Background = Theme.Brush(Theme.Panel),
                BorderBrush = Theme.Brush(Theme.Line),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10, 6, 10, 6),
                Child = new StackPanel
                {
                    Spacing = 0,
                    Children =
                    {
                        new TextBlock { Text = says, FontSize = 12, Foreground = Theme.Brush(Theme.FgMuted) },
                        new StackPanel
                        {
                            Orientation = Orientation.Horizontal,
                            Spacing = 8,
                            Children =
                            {
                                new TextBlock { Text = value.ToString(System.Globalization.CultureInfo.InvariantCulture), FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Theme.Brush(gear > 0 ? Theme.Ready : gear < 0 ? Theme.Danger : Theme.Fg) },
                                new TextBlock { Text = gear == 0 ? "base" : $"gear {GearCardSpec.Signed(gear)}", FontSize = 12, Foreground = Theme.Brush(Theme.FgSoft), VerticalAlignment = VerticalAlignment.Center },
                            },
                        },
                        new TextBlock { Text = $"base {baseValue}, allowed {least}-{most}", FontSize = 11, Foreground = Theme.Brush(Theme.FgMuted) },
                    },
                },
            };
            AutomationProperties.SetName(tile, $"{says} {value}");
            Grid.SetColumn(tile, column++);
            stats.Children.Add(tile);
        }

        return stats;
    }

    private static int GearStat(RealmStats stats, string name) => name switch
    {
        "life" => stats.Life,
        "hand" => stats.Hand,
        _ => stats.MaxHand,
    };

    // --- The list -------------------------------------------------------------------------------------------------------

    private FrameworkElement GearList(RealmCharacter character)
    {
        var filters = new FlowPanel { HorizontalSpacing = 6, VerticalSpacing = 6 };
        IEnumerable<RealmGear> all = character.Gear.Select(item => item.Gear).Concat(_armorer?.Stock ?? []);
        foreach (string? kind in GearSlotOrder.Prepend(null))
        {
            int count = kind is null ? all.Count() : all.Count(gear => gear.Slot == kind);
            string caption = kind is null ? $"All {count}" : $"{GearSlotName(kind)} {count}";
            var chip = new DockButton(caption, primary: false, fontSize: 13) { On = _gearFilter == kind };
            AutomationProperties.SetName(chip, kind is null ? "All gear" : $"{GearSlotName(kind)} gear");
            string? filter = kind;
            chip.Clicked += () =>
            {
                _gearFilter = filter;
                ShowGear();
            };
            filters.Children.Add(chip);
        }

        var rows = new StackPanel { Spacing = 8 };
        bool Shown(RealmGear gear) => _gearFilter is null || gear.Slot == _gearFilter;
        if (_armorer is { } armorer)
        {
            rows.Children.Add(RealmHeading("For sale"));
            List<RealmGear> stock = [.. GearOrder(armorer.Stock.Where(Shown), gear => gear)];
            if (stock.Count == 0) rows.Children.Add(GearNote(armorer.Stock.Count == 0 ? "Nothing today." : "Nothing of that kind today."));
            foreach (RealmGear item in stock) rows.Children.Add(GearListRow(item, "stock", 0, character));
            rows.Children.Add(RealmHeading("Yours"));
        }

        List<RealmGearInstance> owned = [.. GearOrder(character.Gear.Where(item => Shown(item.Gear)), item => item.Gear)];
        if (owned.Count == 0)
        {
            rows.Children.Add(GearNote(character.Gear.Count == 0 ? "You own no gear yet. Gear drops from duels you win and from chests, and armorers sell it in towns."
                : $"You own no {GearSlotName(_gearFilter!).ToLowerInvariant()} gear."));
        }

        foreach (RealmGearInstance item in owned)
        {
            string place = SlotWearing(item.InstanceId) is { } slot ? $"wearing:{slot}" : "owned";
            rows.Children.Add(GearListRow(item.Gear, place, item.InstanceId, character));
        }

        var scroll = RealmScroll(rows);
        var hint = new TextBlock
        {
            Text = _armorer is null
                ? "Click an item to see it, drag it onto its slot to wear it, or drag a worn item back here to take it off."
                : "Click an item to see it: buy the armorer's, sell your own, or drag yours onto a slot to wear it.",
            FontSize = 12,
            Foreground = Theme.Brush(Theme.FgMuted),
            TextWrapping = TextWrapping.WrapWholeWords,
        };
        var list = new Grid { RowSpacing = 8 };
        list.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        list.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        list.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        list.Children.Add(filters);
        Grid.SetRow(hint, 1);
        list.Children.Add(hint);
        Grid.SetRow(scroll, 2);
        list.Children.Add(scroll);
        _gearListArea = scroll;
        return list;
    }

    /// <summary>Items in the doll's slot order, the rarest first, then by name.</summary>
    private static IEnumerable<T> GearOrder<T>(IEnumerable<T> items, Func<T, RealmGear> gear) =>
        items.OrderBy(item => Array.IndexOf(GearSlotOrder, gear(item).Slot))
            .ThenBy(item => Array.IndexOf(GearRarities, gear(item).Rarity))
            .ThenBy(item => gear(item).Name, StringComparer.Ordinal);

    private static string GearSlotName(string slot) => slot switch
    {
        "ring" => "Rings",
        _ => Capitalised(slot),
    };

    private static TextBlock GearNote(string text) => new()
    {
        Text = text,
        FontSize = 14,
        Foreground = Theme.Brush(Theme.FgMuted),
        TextWrapping = TextWrapping.WrapWholeWords,
        Margin = new Thickness(2, 0, 0, 6),
    };

    /// <summary>The item's stat lines, short: "Life +2 · Hand +1 · Max hand +1".</summary>
    private static string GearStatLine(RealmStats stats) => string.Join("  ·  ", new[]
    {
        stats.Life != 0 ? $"Life {GearCardSpec.Signed(stats.Life)}" : null,
        stats.Hand != 0 ? $"Opening hand {GearCardSpec.Signed(stats.Hand)}" : null,
        stats.MaxHand != 0 ? $"Max hand {GearCardSpec.Signed(stats.MaxHand)}" : null,
    }.OfType<string>());

    /// <summary>The item's effects in words: its text without the stat lines that open it.</summary>
    private static string GearEffects(RealmGear gear)
    {
        int statLines = (gear.Stats.Life != 0 ? 1 : 0) + (gear.Stats.Hand != 0 ? 1 : 0) + (gear.Stats.MaxHand != 0 ? 1 : 0);
        return string.Join("\n", gear.Text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Skip(statLines));
    }

    private static string RarityName(RealmGear gear) => gear.Unique ? "Unique" : Capitalised(gear.Rarity);

    private Border GearListRow(RealmGear gear, string place, long instance, RealmCharacter character)
    {
        bool selected = _gearPicked is { } pick && (instance != 0 ? pick.Instance == instance : pick.Place == "stock" && pick.GearId == gear.Id);
        bool affordable = place != "stock" || gear.Gold <= character.Gold;

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new TextBlock { Text = gear.Name, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(GearLook.RarityText(gear.Rarity)), TextWrapping = TextWrapping.WrapWholeWords });
        string points = gear.Budget > 0 ? $"  ·  {gear.Points} of {gear.Budget} points" : string.Empty;
        text.Children.Add(new TextBlock { Text = $"{(gear.Slot == "ring" ? "Ring" : Capitalised(gear.Slot))}  ·  {RarityName(gear)}{points}", FontSize = 12, Foreground = Theme.Brush(Theme.FgMuted) });
        if (GearStatLine(gear.Stats) is { Length: > 0 } statLine)
        {
            text.Children.Add(new TextBlock { Text = statLine, FontSize = 14, Foreground = Theme.Brush(Theme.Accent), TextWrapping = TextWrapping.WrapWholeWords });
        }

        if (GearEffects(gear) is { Length: > 0 } effects)
        {
            text.Children.Add(new TextBlock { Text = effects, FontSize = 14, Foreground = Theme.Brush(Theme.FgSoft), TextWrapping = TextWrapping.WrapWholeWords });
        }

        string badge = place switch
        {
            "stock" => Gold(gear.Gold),
            "owned" when _armorer is not null => $"sells for {Gold(gear.Gold / 2)}",
            _ when place.StartsWith("wearing:", StringComparison.Ordinal) => place switch
            {
                "wearing:ring1" => "Worn, right hand",
                "wearing:ring2" => "Worn, left hand",
                _ => "Worn",
            },
            _ => string.Empty,
        };

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(new GearIconElement(gear, 56) { VerticalAlignment = VerticalAlignment.Top });
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);
        if (badge.Length > 0)
        {
            var tag = new TextBlock
            {
                Text = badge,
                FontSize = 13,
                Foreground = Theme.Brush(place.StartsWith("wearing:", StringComparison.Ordinal) ? Theme.Ready : place == "stock" && !affordable ? Theme.Danger : Theme.Accent),
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 2, 0, 0),
            };
            Grid.SetColumn(tag, 2);
            grid.Children.Add(tag);
        }

        var row = new Border
        {
            Background = Theme.Brush(selected ? Theme.HalfActive : Theme.Panel),
            BorderBrush = Theme.Brush(selected ? Theme.Accent : Theme.Line),
            BorderThickness = new Thickness(selected ? 2 : 1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(10, 8, 12, 8),
            Opacity = affordable ? 1 : 0.6,
            Child = grid,
        };
        AutomationProperties.SetName(row, gear.Name);
        string from = place.StartsWith("wearing:", StringComparison.Ordinal) ? $"worn:{place["wearing:".Length..]}" : place;
        row.PointerPressed += (_, e) => GearPressed(row, e, gear, from, instance);
        _gearRows.Add(new GearRow(row, gear, place, instance));
        return row;
    }

    // --- The item picked ------------------------------------------------------------------------------------------------

    private StackPanel GearDetail(RealmCharacter character)
    {
        var detail = new StackPanel { Spacing = 10 };
        if (_gearPicked is not { } pick || PickedGear(pick) is not { } gear)
        {
            detail.Children.Add(RealmHeading("Pick an item"));
            detail.Children.Add(GearNote("Click a slot on the doll or an item in the list to see its card here."));
            return detail;
        }

        var card = new GearCardElement(Spec(gear), $"detail:{pick.Place}", pick.Instance, GearDetailWidth) { Tag = gear };
        _realmGearCards.Add(card);
        detail.Children.Add(card);

        string budget = gear.Budget > 0 ? $"{gear.Points} of {gear.Budget} points, the {(gear.Unique ? "unique" : gear.Rarity)} budget" : string.Empty;
        string worth = pick.Place == "stock" ? $"Costs {Gold(gear.Gold)}; you have {Gold(character.Gold)}." : $"Worth {Gold(gear.Gold)}: an armorer pays {Gold(gear.Gold / 2)}.";
        detail.Children.Add(new TextBlock { Text = string.Join("\n", new[] { budget, worth }.Where(line => line.Length > 0)), FontSize = 13, Foreground = Theme.Brush(Theme.FgSoft), TextWrapping = TextWrapping.WrapWholeWords });

        var buttons = new StackPanel { Spacing = 8 };
        if (pick.Place.StartsWith("worn:", StringComparison.Ordinal))
        {
            string slot = pick.Place["worn:".Length..];
            detail.Children.Add(GearChange(character, slot, null));
            buttons.Children.Add(GearButton("Take off", primary: true, () => _ = WearAsync(new Dictionary<string, long?> { [slot] = null }, null)));
        }
        else if (pick.Place == "owned")
        {
            string[] slots = gear.Slot == "ring" ? ["ring1", "ring2"] : [gear.Slot];
            // A ring says what it would do on each hand only where the hands differ (one already wears a ring).
            bool same = slots.Select(slot => WornIn(slot)?.InstanceId).Distinct().Count() == 1;
            foreach (string slot in slots)
            {
                string caption = slot switch { "ring1" => "Wear on the right hand", "ring2" => "Wear on the left hand", _ => "Wear" };
                if (!same || slot == slots[0]) detail.Children.Add(GearChange(character, slot, gear, same || gear.Slot != "ring" ? null : caption["Wear ".Length..]));
                buttons.Children.Add(GearButton(caption, primary: true, () => _ = WearAsync(new Dictionary<string, long?> { [slot] = pick.Instance }, slot)));
            }

            if (_armorerTown is not null)
            {
                buttons.Children.Add(GearButton($"Sell for {Gold(gear.Gold / 2)}", primary: false, () => _ = SellGearAsync(pick.Instance)));
            }
        }
        else if (pick.Place == "stock")
        {
            DockButton buy = GearButton($"Buy for {Gold(gear.Gold)}", primary: true, () => _ = BuyGearAsync(gear));
            buy.Enabled = gear.Gold <= character.Gold;
            buttons.Children.Add(buy);
            if (!buy.Enabled) detail.Children.Add(new TextBlock { Text = "You can't afford it.", FontSize = 13, Foreground = Theme.Brush(Theme.Danger) });
        }

        detail.Children.Add(buttons);
        return detail;
    }

    private DockButton GearButton(string caption, bool primary, Action clicked)
    {
        var button = new DockButton(caption, primary, fontSize: 14) { HorizontalAlignment = HorizontalAlignment.Stretch };
        AutomationProperties.SetName(button, caption);
        button.Clicked += () =>
        {
            if (!_gearBusy) clicked();
        };
        return button;
    }

    /// <summary>The item a pick names: the worn or owned copy's item, or the armorer's.</summary>
    private RealmGear? PickedGear(GearPick pick) => pick.Place == "stock"
        ? _armorer?.Stock.FirstOrDefault(item => item.Id == pick.GearId)
        : _gearCharacter?.Gear.FirstOrDefault(item => item.InstanceId == pick.Instance)?.Gear;

    /// <summary>
    /// What wearing <paramref name="gear"/> in <paramref name="slot"/> (or, with null, emptying it) would make of the setup
    /// values, against what they are: each one that changes, and a warning when one would leave its range, which the server
    /// refuses.
    /// </summary>
    private static TextBlock GearChange(RealmCharacter character, string slot, RealmGear? gear, string? where = null)
    {
        RealmStats now = character.Stats;
        RealmStats off = character.Loadout.GetValueOrDefault(slot)?.Gear.Stats ?? new RealmStats(0, 0, 0);
        RealmStats on = gear?.Stats ?? new RealmStats(0, 0, 0);
        var then = new RealmStats(now.Life - off.Life + on.Life, now.Hand - off.Hand + on.Hand, now.MaxHand - off.MaxHand + on.MaxHand);
        List<string> changes = [];
        bool outside = false;
        foreach ((string name, string says, _, int least, int most) in GearSetupValues)
        {
            int before = GearStat(now, name);
            int after = GearStat(then, name);
            if (before != after) changes.Add($"{says} {before} → {after}");
            outside |= after < least || after > most;
        }

        string replaces = gear is not null && character.Loadout.GetValueOrDefault(slot) is { } worn ? $" (in place of {worn.Gear.Name})" : string.Empty;
        string lead = gear is null ? "Taking it off" : $"Wearing it{(where is null ? string.Empty : $" {where}")}{replaces}";
        string said = changes.Count == 0 ? $"{lead} changes no setup value." : $"{lead}: {string.Join(", ", changes)}.";
        if (outside) said += " That is outside the allowed range: the realm won't take it.";
        return new TextBlock { Text = said, FontSize = 13, Foreground = Theme.Brush(outside ? Theme.Danger : Theme.Fg), TextWrapping = TextWrapping.WrapWholeWords };
    }

    // --- Picking and dragging -----------------------------------------------------------------------------------------

    private void PickGear(GearPick? pick, string? filter)
    {
        _gearPicked = pick;
        _gearFilter = filter;
        SayRealm(string.Empty);
        ShowGear();
    }

    /// <summary>A press on a slot or a row: the start of a click, or of a drag once the pointer moves on.</summary>
    private void GearPressed(UIElement source, PointerRoutedEventArgs e, RealmGear? gear, string from, long instance)
    {
        if (_gearBusy || _gearOverlay is null)
        {
            return;
        }

        e.Handled = true;
        Point at = e.GetCurrentPoint(_gearOverlay).Position;
        if (gear is null)
        {
            // An empty slot: the list shows what could be worn there.
            string slot = from["worn:".Length..];
            PickGear(null, SlotKind(slot));
            SayRealm($"Nothing is worn on the {DollSays(slot).ToLowerInvariant()}: pick an item to wear there, or drag one onto it.");
            return;
        }

        _gearPress = (gear, from, instance, at, source);
        source.CapturePointer(e.Pointer);
    }

    private static string DollSays(string slot) => DollSlots.First(each => each.Slot == slot).Says;

    private void GearPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (_gearPress is not { } press || _gearOverlay is null || press.From == "stock")
        {
            return;
        }

        Point at = e.GetCurrentPoint(_gearOverlay).Position;
        if (_gearGhost is null)
        {
            if (Math.Abs(at.X - press.Start.X) + Math.Abs(at.Y - press.Start.Y) < 8)
            {
                return;
            }

            _gearGhost = new GearIconElement(press.Gear, 64) { Opacity = 0.9 };
            _gearOverlay.Children.Add(_gearGhost);
        }

        Canvas.SetLeft(_gearGhost, at.X - 32);
        Canvas.SetTop(_gearGhost, at.Y - 32);
        GearSlotElement? over = SlotAt(at);
        foreach (GearSlotElement slot in _gearSlots)
        {
            slot.Hot = ReferenceEquals(slot, over) && slot.Fits == press.Gear.Slot && press.From != $"worn:{slot.Slot}";
        }
    }

    private void GearPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (_gearPress is not { } press || _gearOverlay is null)
        {
            return;
        }

        Point at = e.GetCurrentPoint(_gearOverlay).Position;
        bool dragged = _gearGhost is not null;
        press.Source.ReleasePointerCaptures();
        EndGearDrag();
        if (!dragged)
        {
            // A click: the item is picked, and a worn one's slot filters the list.
            PickGear(new GearPick(press.From, press.Instance, press.Gear.Id), press.From.StartsWith("worn:", StringComparison.Ordinal) ? press.Gear.Slot : _gearFilter);
            return;
        }

        if (SlotAt(at) is { } slot && slot.Fits == press.Gear.Slot && press.From != $"worn:{slot.Slot}")
        {
            // Onto a slot it fits: worn there (a ring moved from one hand to the other leaves the first).
            Dictionary<string, long?> change = new() { [slot.Slot] = press.Instance };
            if (press.From.StartsWith("worn:", StringComparison.Ordinal)) change[press.From["worn:".Length..]] = null;
            _ = WearAsync(change, slot.Slot);
        }
        else if (press.From.StartsWith("worn:", StringComparison.Ordinal) && _gearListArea is not null && Within(_gearListArea, at))
        {
            _ = WearAsync(new Dictionary<string, long?> { [press.From["worn:".Length..]] = null }, null);
        }
        else if (SlotAt(at) is { } wrong && wrong.Fits != press.Gear.Slot)
        {
            SayRealm($"{press.Gear.Name} is worn on the {(press.Gear.Slot == "ring" ? "hands, as a ring" : press.Gear.Slot)}, not the {wrong.Says.ToLowerInvariant()}.", trouble: true);
        }
    }

    private void EndGearDrag()
    {
        _gearPress = null;
        if (_gearGhost is not null)
        {
            _gearOverlay?.Children.Remove(_gearGhost);
            _gearGhost = null;
        }

        foreach (GearSlotElement slot in _gearSlots)
        {
            slot.Hot = false;
        }
    }

    private GearSlotElement? SlotAt(Point at) => _gearSlots.FirstOrDefault(slot => Within(slot, at));

    private bool Within(FrameworkElement element, Point at)
    {
        if (_gearOverlay is null || element.XamlRoot is null || element.ActualWidth <= 0)
        {
            return false;
        }

        Rect box = element.TransformToVisual(_gearOverlay).TransformBounds(new Rect(0, 0, element.ActualWidth, element.ActualHeight));
        return box.Contains(at);
    }

    /// <summary>Forgets the gear screen's slots and rows once it closes, so the test state no longer lists them.</summary>
    private void ClearGearScreen()
    {
        EndGearDrag();
        _gearSlots.Clear();
        _gearRows.Clear();
        _gearOverlay = null;
        _gearListArea = null;
        _inventoryGearRows.Clear();
    }

    // --- The portrait ---------------------------------------------------------------------------------------------------

    /// <summary>Asks the overworld for the character wearing what they wear, unless the picture shown is of that already.</summary>
    private void AskGearPortrait(RealmCharacter character)
    {
        List<(string Slot, RealmLook Look)> looks = [.. character.Loadout
            .Where(worn => worn.Value?.Gear.Look is not null)
            .OrderBy(worn => worn.Key, StringComparer.Ordinal)
            .Select(worn => (worn.Key, worn.Value!.Gear.Look!))];
        string of = string.Join(";", looks.Select(look => $"{look.Slot}={look.Look.Mesh}/{string.Join(",", look.Look.Palette)}"));
        if (of == _gearPortraitOf && _gearPortrait.Picture is not null)
        {
            return;
        }

        _gearPortraitOf = of;
        RealmBridge.AskPortrait(++_gearPortraitAsked, looks);
    }

    /// <summary>The overworld's answer to <see cref="AskGearPortrait"/>: a PNG as a data URL, shown if it answers the last asked.</summary>
    private void TakePortrait(RealmCommand command)
    {
        if (command.Id != _gearPortraitAsked || Arg(command.Args, "image") is not { } image)
        {
            return;
        }

        int comma = image.IndexOf(',', StringComparison.Ordinal);
        try
        {
            byte[] png = Convert.FromBase64String(comma >= 0 ? image[(comma + 1)..] : image);
            SKBitmap? decoded = SKBitmap.Decode(png);
            if (decoded is not null)
            {
                _gearPortrait.Picture?.Dispose();
                _gearPortrait.Picture = decoded;
            }
        }
        catch (FormatException)
        {
            // A picture that isn't one leaves the figure out.
        }
    }

    // --- Saving ---------------------------------------------------------------------------------------------------------

    /// <summary>Changes the loadout on the server; then shows it, with <paramref name="picks"/>'s slot picked when one is given.</summary>
    private async Task WearAsync(Dictionary<string, long?> slots, string? picks)
    {
        RealmCommand? open = _gearCommand;
        _gearBusy = true;
        RealmReply<RealmCharacter> worn = await RealmApi.CallAsync(HttpMethod.Put, "loadout", new RealmLoadoutChange(slots), RealmJson.Default.RealmLoadoutChange, RealmJson.Default.RealmCharacter);
        _gearBusy = false;
        if (open is null || !StillOpen(open))
        {
            return;
        }

        if (worn.Ok)
        {
            _gearCharacter = worn.Value;
            _gearPicked = picks is not null && WornIn(picks) is { } now ? new GearPick($"worn:{picks}", now.InstanceId, now.Gear.Id) : null;
            ShowGear();
            SayRealm(picks is not null && WornIn(picks) is { } on ? $"You wear {on.Gear.Name}." : "Taken off.");
        }
        else
        {
            SayRealm(worn.Words, trouble: true);
        }
    }

    private async Task BuyGearAsync(RealmGear item)
    {
        if (_armorerTown is not { } town)
        {
            return;
        }

        await TradeGearAsync(() => RealmApi.CallAsync(HttpMethod.Post, $"armorer/{Uri.EscapeDataString(town)}/buy", new RealmGearBuy(item.Id), RealmJson.Default.RealmGearBuy, RealmJson.Default.RealmGearTrade),
            $"You bought {item.Name} for {Gold(item.Gold)}.");
    }

    private async Task SellGearAsync(long instance)
    {
        if (_armorerTown is not { } town || _gearCharacter is not { } character)
        {
            return;
        }

        RealmGear? item = character.Gear.FirstOrDefault(owned => owned.InstanceId == instance)?.Gear;
        await TradeGearAsync(() => RealmApi.CallAsync(HttpMethod.Post, $"armorer/{Uri.EscapeDataString(town)}/sell", new RealmGearSell(instance), RealmJson.Default.RealmGearSell, RealmJson.Default.RealmGearTrade),
            $"You sold {item?.Name ?? "it"} for {Gold((item?.Gold ?? 0) / 2)}.");
    }

    /// <summary>A trade with the armorer, then the character read again for their gold and gear; a bought item is picked.</summary>
    private async Task TradeGearAsync(Func<Task<RealmReply<RealmGearTrade>>> trade, string done)
    {
        RealmCommand? open = _gearCommand;
        _gearBusy = true;
        HashSet<long> had = [.. _gearCharacter?.Gear.Select(item => item.InstanceId) ?? []];
        RealmReply<RealmGearTrade> traded = await trade();
        RealmReply<RealmCharacter> me = await RealmApi.GetAsync("me", RealmJson.Default.RealmCharacter);
        _gearBusy = false;
        if (open is null || !StillOpen(open))
        {
            return;
        }

        if (me.Ok)
        {
            _gearCharacter = me.Value;
        }

        RealmGearInstance? bought = traded.Ok ? _gearCharacter?.Gear.FirstOrDefault(item => !had.Contains(item.InstanceId)) : null;
        _gearPicked = bought is null ? null : new GearPick("owned", bought.InstanceId, bought.Gear.Id);
        ShowGear();
        SayRealm(traded.Ok ? done : traded.Words, trouble: !traded.Ok);
    }

    /// <summary>
    /// The gear screen as a test reads it, into <c>realm.gear</c>: every slot of the doll (<c>worn:head</c>, with what it
    /// holds), every row of the list (<c>owned</c>, <c>wearing:head</c>, <c>stock</c>) and the picked item's card
    /// (<c>detail:...</c>), each with its name, instance, whether it is picked and where it is on the page.
    /// </summary>
    private IEnumerable<(FrameworkElement Element, string Name, string Place, long Instance, bool Selected)> GearSpots()
    {
        foreach (GearSlotElement slot in _gearSlots)
        {
            yield return (slot, slot.Worn?.Gear.Name ?? string.Empty, $"worn:{slot.Slot}", slot.Worn?.InstanceId ?? 0, slot.Selected);
        }

        foreach (GearRow row in _gearRows)
        {
            bool selected = _gearPicked is { } pick && (row.Instance != 0 ? pick.Instance == row.Instance : pick.Place == "stock" && pick.GearId == row.Gear.Id);
            yield return (row.Row, row.Gear.Name, row.Place, row.Instance, selected);
        }

        foreach (GearCardElement card in _realmGearCards)
        {
            yield return (card, card.Gear?.Name ?? string.Empty, card.Place, card.Instance, card.Selected);
        }

        foreach ((Border row, string name, string place, long instance) in _inventoryGearRows)
        {
            yield return (row, name, place, instance, false);
        }
    }
}

