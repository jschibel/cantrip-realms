using Cantrip.Client;
using Cantrip.Protocol;
using Cantrip.Realms;
using Microsoft.UI.Xaml.Automation;

namespace Cantrip.Client.Web;

/// <summary>
/// Worn gear in a realm duel (design.md A4; realms/docs/gear.md): each worn item with effects is an emblem in its wearer's
/// command zone from the start of the game, and its stat lines are the seat's setup values. The table itself shows no
/// emblems, so the duel shows them here: a strip under the duel's bar naming each seat's gear - the emblems the engine has
/// in that seat's command zone, read from the game - and the setup values the gear gave it; clicked, a panel with every
/// emblem drawn as the Vanguard-style oversized card it is, its abilities in full.
/// </summary>
public sealed partial class MainPage
{
    private const float DuelGearCardWidth = 230f;

    private Border _duelGearStrip = null!;
    private TextBlock _duelGearLine = null!;
    private DockButton _duelGearShow = null!;
    private Grid _duelGearPanel = null!;
    private StackPanel _duelGearCards = null!;

    /// <summary>The duel the strip was made for, and the emblems it showed of each seat, so it is made again only when they change.</summary>
    private object? _duelGearFor;
    private string _duelGearSeen = string.Empty;

    /// <summary>The character's loadout as the duel began (<c>/api/me</c>), for each emblem's item: its slot, rarity, stats and look.</summary>
    private IReadOnlyDictionary<string, RealmGearInstance?>? _duelLoadout;

    /// <summary>The cards the panel shows, by seat and name, for the test state.</summary>
    private readonly List<(GearCardElement Card, string Seat)> _duelGearShown = [];

    private void BuildDuelGear()
    {
        _duelGearLine = new TextBlock { FontSize = 13, Foreground = Theme.Brush(Theme.FgSoft), VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.NoWrap };
        _duelGearShow = new DockButton("Gear", primary: false, fontSize: 13);
        AutomationProperties.SetName(_duelGearShow, "Gear in play");
        _duelGearShow.Clicked += () => _duelGearPanel.Visibility = _duelGearPanel.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        _duelGearStrip = new Border
        {
            Background = Theme.Brush(Theme.Bar),
            BorderBrush = Theme.Brush(Theme.Line),
            BorderThickness = new Thickness(1, 0, 1, 1),
            CornerRadius = new CornerRadius(0, 0, 8, 8),
            Padding = new Thickness(12, 4, 6, 4),
            Margin = new Thickness(0, 44, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
            Visibility = Visibility.Collapsed,
            Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { _duelGearLine, _duelGearShow } },
        };
        Grid.SetColumnSpan(_duelGearStrip, 2);
        Root.Children.Add(_duelGearStrip);

        _duelGearCards = new StackPanel { Spacing = 14 };
        var close = new DockButton("Close", primary: true, fontSize: 14) { HorizontalAlignment = HorizontalAlignment.Right };
        AutomationProperties.SetName(close, "Close gear");
        close.Clicked += () => _duelGearPanel.Visibility = Visibility.Collapsed;
        _duelGearPanel = new Grid
        {
            Background = Theme.Brush(Theme.WithAlpha(Theme.Window, 0.72)),
            Visibility = Visibility.Collapsed,
            Children =
            {
                new Border
                {
                    Background = Theme.Brush(Theme.Panel),
                    BorderBrush = Theme.Brush(Theme.Line),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(10),
                    Padding = new Thickness(22, 16, 22, 16),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    MaxHeight = 760,
                    Child = new ScrollViewer
                    {
                        HorizontalScrollMode = ScrollMode.Auto,
                        HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                        Content = new StackPanel { Spacing = 12, Children = { _duelGearCards, close } },
                    },
                },
            },
        };
        _duelGearPanel.Tapped += (_, e) =>
        {
            if (ReferenceEquals(e.OriginalSource, _duelGearPanel)) _duelGearPanel.Visibility = Visibility.Collapsed;
        };
        Grid.SetRowSpan(_duelGearPanel, 3);
        Grid.SetColumnSpan(_duelGearPanel, 2);
        Root.Children.Add(_duelGearPanel);
        _realmTicker.Tick += (_, _) => SyncDuelGear();
    }

    /// <summary>Keeps the strip to the duel open: shown with it, made again when a seat's emblems change, gone with it.</summary>
    private void SyncDuelGear()
    {
        if (_duel is null || _duelDealt is not { } duel || _gameClient is not { View: not null } client)
        {
            if (_duelGearFor is not null)
            {
                _duelGearFor = null;
                _duelLoadout = null;
                _duelGearSeen = string.Empty;
                _duelGearShown.Clear();
                _duelGearStrip.Visibility = Visibility.Collapsed;
                _duelGearPanel.Visibility = Visibility.Collapsed;
            }

            return;
        }

        if (!ReferenceEquals(_duelGearFor, duel))
        {
            _duelGearFor = duel;
            _duelLoadout = null;
            _duelGearSeen = string.Empty;
            _ = ReadDuelLoadoutAsync(duel);
        }

        int mine = client.Seat;
        int theirs = client.Opponents.FirstOrDefault()?.Seat ?? 0;
        List<ObjectView> myEmblems = Emblems(client, mine);
        List<ObjectView> theirEmblems = theirs == 0 ? [] : Emblems(client, theirs);
        string seen = $"{string.Join("|", myEmblems.Select(e => e.Name))}#{string.Join("|", theirEmblems.Select(e => e.Name))}#{_duelLoadout?.Count ?? -1}";
        if (seen == _duelGearSeen)
        {
            return;
        }

        _duelGearSeen = seen;
        DuelSeat me = duel.Seats[0];
        DuelSeat mob = duel.Seats[1];
        List<RealmGearInstance> worn = [.. (_duelLoadout?.Values ?? []).OfType<RealmGearInstance>()];
        string MyGear() => worn.Count > 0 ? string.Join(", ", worn.Select(item => item.Gear.Name)) : myEmblems.Count > 0 ? string.Join(", ", myEmblems.Select(e => GearName(e.Name))) : "no gear";
        _duelGearLine.Text = $"You: {MyGear()}  (life {me.StartingLife}, hand {me.StartingHandSize}, max {me.MaximumHandSize})"
            + $"   ·   {mob.Name}: {(theirEmblems.Count > 0 ? string.Join(", ", theirEmblems.Select(e => GearName(e.Name))) : "no gear effects")}  (life {mob.StartingLife}, hand {mob.StartingHandSize}, max {mob.MaximumHandSize})";
        _duelGearStrip.Visibility = Visibility.Visible;

        _duelGearShown.Clear();
        _duelGearCards.Children.Clear();
        _duelGearCards.Children.Add(DuelGearRow($"Your gear: life {me.StartingLife}, opening hand {me.StartingHandSize}, maximum hand {me.MaximumHandSize}", "you", myEmblems, worn));
        _duelGearCards.Children.Add(DuelGearRow($"{mob.Name}'s gear: life {mob.StartingLife}, opening hand {mob.StartingHandSize}, maximum hand {mob.MaximumHandSize}", "mob", theirEmblems, []));
    }

    /// <summary>The emblems of gear in a seat's command zone, as the game shows them.</summary>
    private static List<ObjectView> Emblems(GameClient client, int seat) =>
        [.. client.Zone(ZoneKindView.Command, seat).Where(card => card.Kind == ObjectKindView.Emblem && card.Name.EndsWith(" (gear)", StringComparison.Ordinal))];

    private static string GearName(string emblem) => emblem.EndsWith(" (gear)", StringComparison.Ordinal) ? emblem[..^" (gear)".Length] : emblem;

    private async Task ReadDuelLoadoutAsync(Duel duel)
    {
        RealmReply<RealmCharacter> me = await RealmApi.GetAsync("me", RealmJson.Default.RealmCharacter);
        if (me.Ok && ReferenceEquals(_duelGearFor, duel))
        {
            _duelLoadout = me.Value!.Loadout;
        }
    }

    /// <summary>
    /// A seat's gear as cards: each emblem in its command zone, drawn from the worn item it is (its stats, slot and look)
    /// where the character's loadout names it, else from the emblem alone; and the worn items with stat lines only, which
    /// have no emblem but count in the setup values.
    /// </summary>
    private StackPanel DuelGearRow(string heading, string seat, List<ObjectView> emblems, List<RealmGearInstance> worn)
    {
        var row = new StackPanel { Spacing = 8 };
        row.Children.Add(new TextBlock { Text = heading, FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Theme.Brush(Theme.Fg) });
        var cards = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        HashSet<string> drawn = new(StringComparer.Ordinal);
        foreach (ObjectView emblem in emblems)
        {
            string name = GearName(emblem.Name);
            RealmGear? item = worn.FirstOrDefault(each => each.Gear.Name == name)?.Gear;
            GearCardSpec spec = item is not null ? Spec(item) : new GearCardSpec(name, string.Empty, string.Empty, 0, 0, 0, emblem.OracleText);
            drawn.Add(name);
            AddDuelGearCard(cards, spec, seat);
        }

        foreach (RealmGearInstance item in worn.Where(each => !drawn.Contains(each.Gear.Name)))
        {
            AddDuelGearCard(cards, Spec(item.Gear), seat);
        }

        if (cards.Children.Count == 0)
        {
            row.Children.Add(new TextBlock { Text = "Nothing worn.", FontSize = 13, Foreground = Theme.Brush(Theme.FgMuted) });
        }
        else
        {
            row.Children.Add(cards);
        }

        return row;
    }

    private void AddDuelGearCard(StackPanel cards, GearCardSpec spec, string seat)
    {
        var card = new GearCardElement(spec, $"duel:{seat}", 0, DuelGearCardWidth) { IsHitTestVisible = false };
        _duelGearShown.Add((card, seat));
        cards.Children.Add(card);
    }

    /// <summary>The duel's gear as a test reads it, under <c>realm.duelGear</c>: the strip's line, whether the panel is open, and the cards it shows by seat.</summary>
    private void WriteRealmDuelGear(System.Text.Json.Utf8JsonWriter json)
    {
        if (_duelGearFor is null)
        {
            return;
        }

        json.WriteStartObject("duelGear");
        json.WriteString("line", _duelGearLine.Text);
        json.WriteBoolean("open", _duelGearPanel.Visibility == Visibility.Visible);
        json.WriteStartArray("cards");
        foreach ((GearCardElement card, string seat) in _duelGearShown)
        {
            json.WriteStartObject();
            json.WriteString("seat", seat);
            json.WriteString("name", card.Gear?.Name ?? string.Empty);
            json.WriteEndObject();
        }

        json.WriteEndArray();
        json.WriteStartArray("emblems");
        if (_gameClient is { } client)
        {
            foreach (ObjectView emblem in Emblems(client, client.Seat))
            {
                json.WriteStringValue(emblem.Name);
            }
        }

        json.WriteEndArray();
        json.WriteStartArray("mobEmblems");
        if (_gameClient is { } game && game.Opponents.FirstOrDefault() is { } mob)
        {
            foreach (ObjectView emblem in Emblems(game, mob.Seat))
            {
                json.WriteStringValue(emblem.Name);
            }
        }

        json.WriteEndArray();
        json.WriteNumber("life", _gameClient?.Me?.Life ?? 0);
        json.WriteEndObject();
    }
}
