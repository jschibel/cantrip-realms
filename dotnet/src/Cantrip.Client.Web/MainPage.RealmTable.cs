using System.Text.Json;
using Cantrip.Decks;
using Cantrip.Protocol;
using Microsoft.UI.Xaml.Automation;

namespace Cantrip.Client.Web;

/// <summary>
/// The realm's <c>spell-table</c> screen (realms/docs/interfaces.md, "The card layer"; design.md A2): the deck editor of
/// <c>?decks</c> in a realm mode. The search runs over the character's collection, each card saying how many copies are
/// left once the deck and the ante have theirs; the basic lands of the character's colors (and Wastes) are free and
/// unlimited; a card outside the character's color identity is shown dimmed, for the ante only. The sideboard is the ante,
/// 0 to 10 cards beside the deck, never a copy the deck holds. Whether the pair is legal is the realm server's word
/// (<c>/api/deck/check</c>, as it checks a deck it is asked to save), and Save keeps them (<c>PUT /api/deck</c>), which the
/// server takes only at a spell table.
/// </summary>
public sealed partial class MainPage
{
    /// <summary>The most cards an ante holds (design.md A2): the server's word, shown beside the ante's count.</summary>
    private const int RealmMostAnte = 10;

    /// <summary>Whether the deck editor is the realm's spell table rather than the constructed deck editor.</summary>
    private bool _realmDeck;

    private RealmCommand? _tableCommand;
    private Dictionary<string, int> _realmOwned = new(StringComparer.Ordinal);

    /// <summary>Each owned card's list price in gold (the collection's <c>Prices</c>); an unpriced card is missing.</summary>
    private Dictionary<string, long> _realmPrices = new(StringComparer.Ordinal);

    /// <summary>The owned cards that are relics (the collection's <c>Relics</c>), which no ante may hold (design.md A3a).</summary>
    private HashSet<string> _realmRelics = new(StringComparer.Ordinal);
    private HashSet<ColorView> _realmIdentity = [];

    /// <summary>What the search shows of the collection, and the realm's orders (the editor's two, then price, copies left and color).</summary>
    private static readonly string[] RealmShowNames = ["All owned", "Deck-legal", "Copies left", "Ante only"];
    private static readonly string[] RealmSortNames = ["Name", "Mana value", "Price", "Copies left", "Color"];
    private ChoiceDropdown _realmShow = null!;

    /// <summary>The free basic lands of the character's colors, each with a way to add or take out one, and the deck's count.</summary>
    private readonly StackPanel _realmBasics = new() { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };

    /// <summary>The deck's mana curve and its colors, drawn beside its summary.</summary>
    private readonly StackPanel _realmCurve = new() { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _realmColors = new() { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };

    /// <summary>The deck's curve and colors in words, as the test state reads them: "0:1 1:4 2:8 ...", "W 18 · colorless 2".</summary>
    private string _realmCurveText = string.Empty;
    private string _realmColorsText = string.Empty;
    private long _realmAnteValue;
    private TextBlock _realmAnteText = null!;
    private DockButton _realmDone = null!;

    /// <summary>The realm server's last word on the deck, and the deck (its snapshot) it was for.</summary>
    private string _realmCheckAsked = string.Empty;
    private string _realmCheckJudged = string.Empty;
    private IReadOnlyList<string> _realmChecked = [];

    /// <summary>The deck editor's header made the spell table's: no deck list, name, format or import; the ante's worth and Done instead.</summary>
    private void BuildRealmTable()
    {
        _realmDeck = true;
        _editingFormat = DeckFormat.Find(DeckFormat.VintageKey) ?? DeckFormat.All[0];
        _deckListOpen = false;
        _deckListColumn.Visibility = Visibility.Collapsed;
        _poolHint.Text = "Double-click: ante";
        _poolSlider.Width = 110;
        ToolTipService.SetToolTip(_poolHint, "Drag cards from your collection into the deck, or into the ante on the left  ·  double-click a card: to or from the ante, a basic land out of the deck  ·  drag a card back onto the search to take it out");

        // The search's own filters for the realm: what of the collection it shows, and the realm's orders in place of the editor's.
        if (_searchText.Parent is StackPanel filters)
        {
            int at = filters.Children.IndexOf(_sortChoice);
            _sortChoice = new ChoiceDropdown("Sort", "The order the cards are shown in", RealmSortNames) { Changed = _ => SearchChanged() };
            _realmShow = new ChoiceDropdown("Show", "Which of your cards the search shows", RealmShowNames) { Changed = _ => SearchChanged() };
            filters.Children.RemoveAt(at);
            filters.Children.Insert(at, _sortChoice);
            filters.Children.Insert(at, _realmShow);
            _searchText.PlaceholderText = "Search your cards: name, type or rules text";
        }

        // Beside the deck's summary: its curve and colors, and the free basic lands.
        if (_poolLabel.Parent is StackPanel heading)
        {
            int at = heading.Children.IndexOf(_poolLabel) + 1;
            heading.Children.Insert(at, _realmBasics);
            heading.Children.Insert(at, _realmColors);
            heading.Children.Insert(at, _realmCurve);
        }

        if (_deckPanel.Children.OfType<Grid>().FirstOrDefault() is { } header)
        {
            foreach (FrameworkElement part in header.Children.OfType<FrameworkElement>())
            {
                switch (Grid.GetColumn(part))
                {
                    case 0 or 2 or 3 or 5 or 6 or 8:
                        part.Visibility = Visibility.Collapsed;
                        break;
                    case 1 when part is TextBlock title:
                        title.Text = "Spell table";
                        break;
                }
            }

            _realmAnteText = EventText(string.Empty, 13, Theme.FgSoft, semibold: true);
            _realmAnteText.VerticalAlignment = VerticalAlignment.Center;
            ToolTipService.SetToolTip(_realmAnteText, "The ante: up to 10 of your cards beside the deck. A win's prize cap is the lesser of its worth and the mob's prize; with no ante a win pays gold but no cards. Losing a duel costs one ante card, at random.");
            Grid.SetColumn(_realmAnteText, 2);
            header.Children.Add(_realmAnteText);

            _realmDone = new DockButton("Done", primary: false) { VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetName(_realmDone, "Done");
            _realmDone.Clicked += LeaveTableAsked;
            Grid.SetColumn(_realmDone, 8);
            header.Children.Add(_realmDone);
        }
    }

    private async Task OpenSpellTableAsync(RealmCommand command)
    {
        _tableCommand = command;
        ShowRealmLoading("Spell table", "Opening your spellbook...");
        Task<bool> cards = EnsureRealmCatalogAsync();
        Task<RealmReply<RealmCharacter>> me = RealmApi.GetAsync("me", RealmJson.Default.RealmCharacter);
        Task<RealmReply<RealmCollection>> collection = RealmApi.GetAsync("collection", RealmJson.Default.RealmCollection);
        Task<RealmReply<RealmDeck>> deck = RealmApi.GetAsync("deck", RealmJson.Default.RealmDeck);
        await Task.WhenAll(cards, me, collection, deck);
        if (!StillOpen(command))
        {
            return;
        }

        RealmReply<RealmCharacter> character = await me;
        RealmReply<RealmCollection> owned = await collection;
        RealmReply<RealmDeck> saved = await deck;
        if (!await cards || !character.Ok || !owned.Ok || !saved.Ok)
        {
            string why = !character.Ok ? character.Words : !owned.Ok ? owned.Words : !saved.Ok ? saved.Words : _catalogFailure ?? "The cards could not be loaded.";
            ShowRealmProblem("Spell table", why, "closed");
            return;
        }

        _realmOwned = new Dictionary<string, int>(owned.Value!.Cards, StringComparer.Ordinal);
        _realmPrices = new Dictionary<string, long>(owned.Value.Prices ?? new Dictionary<string, long>(), StringComparer.Ordinal);
        _realmRelics = new HashSet<string>(owned.Value.Relics ?? [], StringComparer.Ordinal);
        _realmIdentity = [.. character.Value!.Identity.Select(letter => letter switch
        {
            'W' => ColorView.White,
            'U' => ColorView.Blue,
            'B' => ColorView.Black,
            'R' => ColorView.Red,
            _ => ColorView.Green,
        })];
        _realmAnteValue = saved.Value!.AnteValue;
        _realmCheckAsked = _realmCheckJudged = string.Empty;
        _realmChecked = [];

        _realmLoading = string.Empty;
        _realmPanel.Visibility = Visibility.Collapsed;
        _deckPanel.Visibility = Visibility.Visible;
        OpenDeck(new SavedDeck
        {
            Id = "realm",
            Name = character.Value.Name,
            Format = _editingFormat.Key,
            Main = [.. saved.Value.Main.Select(card => new DeckEntry(card.Name, card.Count))],
            Side = [.. saved.Value.Ante.Select(card => new DeckEntry(card.Name, card.Count))],
        });
        _searchText.Text = string.Empty;
        // The ante is half of what the table is for: its column is pulled out from the start.
        _poolSideOpen = true;
        BuildRealmBasics();
        SearchChanged();
    }

    /// <summary>The spell table put away as its screen closes.</summary>
    private void LeaveSpellTable()
    {
        if (_realmDeck)
        {
            _askOverlay.Visibility = Visibility.Collapsed;
            _deckPanel.Visibility = Visibility.Collapsed;
            _tableCommand = null;
        }
    }

    /// <summary>Done: closes the table, once the changes are saved or let go if there are any.</summary>
    private void LeaveTableAsked()
    {
        if (!DeckUnsaved())
        {
            CloseRealmScreen("closed");
            return;
        }

        Ask("Save your deck?", "The deck and the ante have changes that aren't saved.",
            ("Save", true, async () =>
            {
                if (await SaveRealmDeckAsync())
                {
                    CloseRealmScreen("closed");
                }
            }),
            ("Discard", false, () =>
            {
                CloseRealmScreen("closed");
                return Task.CompletedTask;
            }),
            ("Cancel", false, null));
    }

    private static bool IsBasicLand(CatalogCard card) =>
        card.Card.Supertypes.Contains(SupertypeView.Basic) && card.Card.CardTypes.Contains(CardTypeView.Land);

    /// <summary>
    /// Whether a card's color identity is within the character's, as the realm server judges it: a basic land by its land
    /// types too (CR 903.4), the snow-covered ones included, which the legality data misses.
    /// </summary>
    private bool RealmWithin(CatalogCard card) =>
        DeckRules.Within(card, _realmIdentity)
        && (!IsBasicLand(card) || card.Card.Subtypes.All(type => type switch
        {
            "Plains" => _realmIdentity.Contains(ColorView.White),
            "Island" => _realmIdentity.Contains(ColorView.Blue),
            "Swamp" => _realmIdentity.Contains(ColorView.Black),
            "Mountain" => _realmIdentity.Contains(ColorView.Red),
            "Forest" => _realmIdentity.Contains(ColorView.Green),
            _ => true,
        }));

    /// <summary>Copies of a card the deck and the ante hold now.</summary>
    private int RealmUsed(string name) =>
        _arrangement is not { } arrangement ? 0
        : arrangement.Columns.SelectMany(column => column).Concat(arrangement.Side).Count(place => _editorCards[place].Name == name);

    /// <summary>
    /// Whether the search shows a card: one the character owns, or a basic land of their colors (and Wastes), free. A card
    /// outside their identity is shown too, dimmed, for the ante.
    /// </summary>
    private bool RealmFits(CatalogCard card) =>
        (IsBasicLand(card) ? RealmWithin(card) : _realmOwned.GetValueOrDefault(card.Name) > 0)
        && _realmShow.Selected switch
        {
            1 => RealmWithin(card),
            2 => RealmCanAdd(card),
            3 => !RealmWithin(card),
            _ => true,
        };

    /// <summary>
    /// The search's cards in the realm's order: the free basic lands first, then by name, mana value, price (dearest
    /// first), copies left (most first) or color (white, blue, black, red, green, then multicolored, then colorless).
    /// </summary>
    private List<CatalogCard> RealmSorted(IEnumerable<CatalogCard> found)
    {
        IOrderedEnumerable<CatalogCard> basicsFirst = found.OrderBy(card => IsBasicLand(card) ? 0 : 1);
        IOrderedEnumerable<CatalogCard> sorted = _sortChoice.Selected switch
        {
            1 => basicsFirst.ThenBy(card => card.Card.ManaValue),
            2 => basicsFirst.ThenByDescending(card => _realmPrices.GetValueOrDefault(card.Name)),
            3 => basicsFirst.ThenByDescending(card => _realmOwned.GetValueOrDefault(card.Name) - RealmUsed(card.Name)),
            4 => basicsFirst.ThenBy(card => ColorOrder(card.Card)).ThenBy(card => card.Card.ManaValue),
            _ => basicsFirst,
        };
        return [.. sorted.ThenBy(card => card.Name, StringComparer.OrdinalIgnoreCase)];
    }

    private static int ColorOrder(ObjectView card) => card.Colors.Count switch
    {
        0 => 7,
        1 => card.Colors[0] switch
        {
            ColorView.White => 0,
            ColorView.Blue => 1,
            ColorView.Black => 2,
            ColorView.Red => 3,
            _ => 4,
        },
        _ => 5,
    };

    /// <summary>Whether another copy may come out of the collection: a free basic always, else while one is left.</summary>
    private bool RealmCanAdd(CatalogCard card) =>
        (IsBasicLand(card) && RealmWithin(card)) || RealmUsed(card.Name) < _realmOwned.GetValueOrDefault(card.Name);

    /// <summary>
    /// What a card of the search says over its art: free, or how many of the copies owned are left, its price, and whether
    /// only the ante can hold it - or, for a relic, that no ante can.
    /// </summary>
    private string RealmNote(CatalogCard card)
    {
        if (IsBasicLand(card))
        {
            return "Free";
        }

        int owned = _realmOwned.GetValueOrDefault(card.Name);
        string left = $"{Math.Max(0, owned - RealmUsed(card.Name))} of {owned} left";
        string price = RealmPrice(card.Name) is { } gold ? $" · {gold}" : string.Empty;
        return _realmRelics.Contains(card.Name) ? $"Relic, never anted · {left}"
            : RealmWithin(card) ? left + price
            : $"{left} · ante only{price}";
    }

    /// <summary>A card's list price as the table says it ("1,250 g"), or null for one with none.</summary>
    private string? RealmPrice(string name) =>
        _realmPrices.TryGetValue(name, out long gold) ? $"{gold.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)} g" : null;

    /// <summary>
    /// What a card of the ante column says, under its name where the column's stack shows it: its price - the ante's worth
    /// is theirs added up - or, for a relic, that it can't be anted, which saving would refuse.
    /// </summary>
    private string? RealmAnteNote(string name) =>
        _realmRelics.Contains(name) ? "Relic: can't be anted" : RealmPrice(name) ?? "No price";

    /// <summary>Whether the ante column draws a card dimmed: a relic, which saving refuses there.</summary>
    private bool RealmAnteDimmed(string name) => _realmRelics.Contains(name);

    /// <summary>Whether a double-click on a card of the deck is the spell table's: a basic land leaves the deck (it can't be anted).</summary>
    private bool RealmTakesOut(PoolArrangement arrangement, int place)
    {
        if (!_realmDeck || arrangement.InSide(place) || place >= _editorCards.Count
            || !_catalogByName.TryGetValue(_editorCards[place].Name, out CatalogCard? card) || !IsBasicLand(card))
        {
            return false;
        }

        arrangement.Remove(place);
        return true;
    }

    /// <summary>The basic lands of the character's colors (and Wastes), each with a button that adds one to the deck and one that takes one out.</summary>
    private void BuildRealmBasics()
    {
        _realmBasics.Children.Clear();
        (ColorView? Color, string Name)[] basics = [(ColorView.White, "Plains"), (ColorView.Blue, "Island"), (ColorView.Black, "Swamp"), (ColorView.Red, "Mountain"), (ColorView.Green, "Forest"), (null, "Wastes")];
        var caption = EventText("Free lands", 12, Theme.FgSoft, semibold: true);
        caption.VerticalAlignment = VerticalAlignment.Center;
        _realmBasics.Children.Add(caption);
        foreach ((ColorView? color, string name) in basics)
        {
            if ((color is { } hue && !_realmIdentity.Contains(hue)) || !_catalogByName.TryGetValue(name, out CatalogCard? land))
            {
                continue;
            }

            var less = new DockButton("−", primary: false, fontSize: 12) { Tooltip = $"Take a {name} out of the deck" };
            AutomationProperties.SetName(less, $"Remove {name}");
            less.Clicked += () => ChangeRealmBasic(land, -1);
            var more = new DockButton("+", primary: false, fontSize: 12) { Tooltip = $"Add a {name} to the deck: basic lands of your colors are free" };
            AutomationProperties.SetName(more, $"Add {name}");
            more.Clicked += () => ChangeRealmBasic(land, +1);
            var count = EventText(string.Empty, 12, Theme.Fg, semibold: true);
            count.VerticalAlignment = VerticalAlignment.Center;
            count.MinWidth = 62;
            count.TextAlignment = TextAlignment.Center;
            count.Tag = name;
            _realmBasics.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center, Children = { less, count, more } });
        }
    }

    /// <summary>One more or one fewer of a free basic land in the deck: added to its column, or the last one of the deck taken out.</summary>
    private void ChangeRealmBasic(CatalogCard land, int change)
    {
        if (_arrangement is not { } arrangement)
        {
            return;
        }

        if (change > 0)
        {
            _editorCards.Add(land.Card);
            arrangement.Columns[DefaultColumn(land.Card)].Add(_editorCards.Count - 1);
        }
        else
        {
            int[] copies = [.. arrangement.Columns.SelectMany(column => column).Where(place => _editorCards[place].Name == land.Name)];
            if (copies.Length == 0)
            {
                return;
            }

            arrangement.Remove(copies[^1]);
        }

        DeckEdited();
    }

    /// <summary>
    /// The deck's mana curve (its nonland cards by mana value, 0 to 7 and more) as bars, and its colors as pips with how many
    /// cards of each; and the basic lands' counts beside their buttons.
    /// </summary>
    private void ShowRealmCurve()
    {
        if (_arrangement is not { } arrangement)
        {
            return;
        }

        List<ObjectView> deck = [.. arrangement.Columns.SelectMany(column => column).Select(place => _editorCards[place])];
        List<ObjectView> spells = [.. deck.Where(card => !card.CardTypes.Contains(CardTypeView.Land))];
        int[] curve = new int[8];
        foreach (ObjectView card in spells)
        {
            curve[Math.Clamp(card.ManaValue, 0, 7)]++;
        }

        int tallest = Math.Max(1, curve.Max());
        _realmCurve.Children.Clear();
        for (int value = 0; value < curve.Length; value++)
        {
            var bar = new Border
            {
                Width = 12,
                Height = Math.Max(2, 20.0 * curve[value] / tallest),
                Background = Theme.Brush(curve[value] == 0 ? Theme.Line : Theme.Accent),
                CornerRadius = new CornerRadius(2, 2, 0, 0),
                VerticalAlignment = VerticalAlignment.Bottom,
            };
            var column = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Bottom };
            column.Children.Add(EventText(curve[value] == 0 ? " " : curve[value].ToString(System.Globalization.CultureInfo.InvariantCulture), 9, Theme.FgSoft, centred: true));
            column.Children.Add(new Grid { Height = 20, Children = { bar } });
            column.Children.Add(EventText(value == 7 ? "7+" : value.ToString(System.Globalization.CultureInfo.InvariantCulture), 9, Theme.FgMuted, centred: true));
            _realmCurve.Children.Add(column);
        }

        ToolTipService.SetToolTip(_realmCurve, $"Mana curve: {spells.Count} nonland card{(spells.Count == 1 ? string.Empty : "s")} by mana value");
        _realmCurveText = string.Join(" ", curve.Select((count, value) => $"{(value == 7 ? "7+" : value.ToString(System.Globalization.CultureInfo.InvariantCulture))}:{count}"));

        // Colors: how many nonland cards of the deck are of each (a card of two counts for both), and the colorless ones.
        (ColorView Color, string Letter, string Hex)[] hues = [(ColorView.White, "W", "#f3ecd0"), (ColorView.Blue, "U", "#4a90d9"), (ColorView.Black, "B", "#9a8aa8"), (ColorView.Red, "R", "#e0573f"), (ColorView.Green, "G", "#4caf6a")];
        _realmColors.Children.Clear();
        List<string> words = [];
        foreach ((ColorView color, string letter, string hex) in hues)
        {
            int cards = spells.Count(card => card.Colors.Contains(color));
            if (cards == 0)
            {
                continue;
            }

            words.Add($"{letter} {cards}");
            _realmColors.Children.Add(RealmPip(hex, cards, $"{cards} {color.ToString().ToLowerInvariant()} card{(cards == 1 ? string.Empty : "s")}"));
        }

        int colorless = spells.Count(card => card.Colors.Count == 0);
        if (colorless > 0)
        {
            words.Add($"colorless {colorless}");
            _realmColors.Children.Add(RealmPip("#b8bcc4", colorless, $"{colorless} colorless card{(colorless == 1 ? string.Empty : "s")}"));
        }

        _realmColorsText = string.Join(" · ", words);

        foreach (TextBlock count in _realmBasics.Children.OfType<StackPanel>().SelectMany(group => group.Children.OfType<TextBlock>()))
        {
            if (count.Tag is string name)
            {
                int copies = deck.Count(card => card.Name == name);
                count.Text = $"{copies} {name}";
                count.Foreground = Theme.Brush(copies == 0 ? Theme.FgMuted : Theme.Fg);
            }
        }
    }

    /// <summary>A color's pip and how many cards of the deck are of it.</summary>
    private static StackPanel RealmPip(string hex, int cards, string tooltip)
    {
        var pip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        pip.Children.Add(new Border { Width = 11, Height = 11, CornerRadius = new CornerRadius(6), Background = Theme.Brush(Theme.FromHex(hex)), BorderBrush = Theme.Brush(Theme.Line), BorderThickness = new Thickness(1), VerticalAlignment = VerticalAlignment.Center });
        var count = EventText(cards.ToString(System.Globalization.CultureInfo.InvariantCulture), 12, Theme.FgSoft, semibold: true);
        count.VerticalAlignment = VerticalAlignment.Center;
        pip.Children.Add(count);
        ToolTipService.SetToolTip(pip, tooltip);
        return pip;
    }

    /// <summary>Whether the search draws a card dimmed: one outside the character's color identity, which only the ante can hold.</summary>
    private bool RealmDimmed(CatalogCard card) => !RealmWithin(card);

    /// <summary>The deck and the ante as the API takes them.</summary>
    private static RealmDeckChange RealmChange(SavedDeck deck) =>
        new([.. deck.Main.Select(entry => new RealmCardCount(entry.Card, entry.Count))], [.. deck.Side.Select(entry => new RealmCardCount(entry.Card, entry.Count))]);

    /// <summary>
    /// What is wrong with the deck and the ante: the realm server's word once it has answered for them as they are now,
    /// and until then its word on the last it judged; it is asked again whenever they change.
    /// </summary>
    private IReadOnlyList<string> RealmProblems(SavedDeck deck)
    {
        string snapshot = Snapshot(deck);
        if (snapshot != _realmCheckAsked)
        {
            _realmCheckAsked = snapshot;
            _ = CheckRealmDeckAsync(deck, snapshot);
        }

        ShowRealmAnte();
        ShowRealmCurve();
        return _realmChecked;
    }

    private async Task CheckRealmDeckAsync(SavedDeck deck, string snapshot)
    {
        RealmReply<RealmDeckCheck> check = await RealmApi.CallAsync(HttpMethod.Post, "deck/check", RealmChange(deck), RealmJson.Default.RealmDeckChange, RealmJson.Default.RealmDeckCheck);
        if (snapshot != _realmCheckAsked || !check.Ok)
        {
            return;
        }

        _realmChecked = check.Value!.Problems;
        _realmAnteValue = check.Value.AnteValue;
        _realmCheckJudged = snapshot;
        DeckEdited();
    }

    /// <summary>Whether the realm has judged the deck as it stands now.</summary>
    private bool RealmJudged => _realmCheckJudged.Length > 0 && _realmCheckJudged == _realmCheckAsked;

    private void ShowRealmAnte()
    {
        int anted = _arrangement?.Side.Count ?? 0;
        _realmAnteText.Text = anted == 0
            ? "Ante: none  ·  a win pays gold, no cards"
            : $"Ante: {anted} of {RealmMostAnte} cards, worth {Gold(_realmAnteValue)}";
        _realmAnteText.Foreground = Theme.Brush(anted > RealmMostAnte ? Theme.Danger : anted == 0 ? Theme.FgMuted : Theme.Accent);
    }

    /// <summary>
    /// The spell table as a test reads it (<c>realm.table</c>): what the header says of the ante, the deck's curve and colors,
    /// and what each search result laid out says over its art (copies left, price, ante only).
    /// </summary>
    private void WriteRealmTable(Utf8JsonWriter json)
    {
        if (!_realmDeck || _realmOpen?.Screen != "spell-table")
        {
            return;
        }

        json.WriteStartObject("table");
        json.WriteString("ante", _realmAnteText.Text);
        json.WriteNumber("anteValue", _realmAnteValue);
        json.WriteString("curve", _realmCurveText);
        json.WriteString("colors", _realmColorsText);
        json.WriteStartObject("notes");
        for (int i = _searchWindow.First; i < _searchWindow.End && i < _searchFound.Count; i++)
        {
            json.WriteString(_searchFound[i].Name, RealmNote(_searchFound[i]));
        }

        json.WriteEndObject();
        json.WriteStartArray("anteNotes");
        foreach (int place in _arrangement?.Side ?? [])
        {
            json.WriteStartObject();
            json.WriteString("name", _editorCards[place].Name);
            json.WriteString("note", RealmAnteNote(_editorCards[place].Name));
            json.WriteBoolean("relic", _realmRelics.Contains(_editorCards[place].Name));
            json.WriteEndObject();
        }

        json.WriteEndArray();
        json.WriteEndObject();
    }

    /// <summary>Saves the deck and the ante with the realm server, which keeps them only if they are legal and the character is at a spell table.</summary>
    private async Task<bool> SaveRealmDeckAsync()
    {
        if (_arrangement is null)
        {
            return false;
        }

        SavedDeck deck = CurrentDeck();
        _saveButton.Enabled = false;
        RealmReply<RealmDeck> saved = await RealmApi.CallAsync(HttpMethod.Put, "deck", RealmChange(deck), RealmJson.Default.RealmDeckChange, RealmJson.Default.RealmDeck);
        _saveButton.Enabled = true;
        if (!saved.Ok)
        {
            _editorStatus.Text = saved.Words;
            _editorStatus.Foreground = Theme.Brush(Theme.Danger);
            return false;
        }

        _realmAnteValue = saved.Value!.AnteValue;
        _editingId = "realm";
        _savedSnapshot = Snapshot(CurrentDeck());
        DeckEdited();
        _editorStatus.Text = $"Saved  ·  {_editorStatus.Text}";
        return true;
    }
}
