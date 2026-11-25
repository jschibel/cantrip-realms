using Cantrip.Decks;
using Cantrip.Protocol;
using Microsoft.UI.Xaml.Automation;

namespace Cantrip.Client.Web;

/// <summary>
/// The realm's <c>inventory</c> screen (realms/docs/interfaces.md, "The card layer"): everything the character owns, opened
/// from the HUD anywhere. Two tabs:
/// <list type="bullet">
/// <item><b>Cards</b>: the collection as the table draws cards, each with how many are owned, its list price and how many
/// copies the deck and the sideboard use (<c>/api/inventory</c>); searched by name, type or rules text, sorted by name, price,
/// count or color, and narrowed to the cards in the deck, in the sideboard, or spare.</item>
/// <item><b>Gear</b>: every item owned, as the gear screen lists them, with what is worn where.</item>
/// </list>
/// It changes nothing: the deck and sideboard are changed at a spell table, the loadout on the gear screen.
/// </summary>
public sealed partial class MainPage
{
    private const float InventoryWidth = 168f;

    private RealmInventory? _inventory;
    private RealmCharacter? _inventoryCharacter;
    private string _inventoryTab = "cards";
    private string _inventorySort = "name";
    private string _inventoryShow = "all";
    private string _inventorySearch = string.Empty;
    private CardBoardElement? _inventoryBoard;
    private TextBlock? _inventoryCount;
    private List<RealmInventoryCard> _inventoryShown = [];
    private RealmCommand? _inventoryCommand;

    private async Task OpenInventoryAsync(RealmCommand command)
    {
        _inventoryCommand = command;
        ShowRealmLoading("Inventory", "Counting what you own...");
        Task<bool> cards = EnsureRealmCatalogAsync();
        RealmReply<RealmInventory> inventory = await RealmApi.GetAsync("inventory", RealmJson.Default.RealmInventory);
        RealmReply<RealmCharacter> me = await RealmApi.GetAsync("me", RealmJson.Default.RealmCharacter);
        await cards;
        if (!StillOpen(command))
        {
            return;
        }

        if (!inventory.Ok || !me.Ok)
        {
            ShowRealmProblem("Inventory", inventory.Ok ? me.Words : inventory.Words, "closed");
            return;
        }

        _inventory = inventory.Value;
        _inventoryCharacter = me.Value;
        _inventorySearch = string.Empty;
        ShowRealmScreen("Inventory", new Grid());
        RealmAction("Done", primary: false, () => CloseRealmScreen("closed"));
        ShowInventory();
    }

    private void ShowInventory()
    {
        if (_inventory is not { } inventory || _inventoryCharacter is not { } character || _inventoryCommand is null || !StillOpen(_inventoryCommand))
        {
            return;
        }

        _realmBoards.Clear();
        _inventoryGearRows.Clear();
        _inventoryBoard = null;
        int copies = inventory.Cards.Sum(card => card.Count);
        _realmFacts.Text = $"{copies} cards, worth {Gold(inventory.Value)}  ·  {character.Gear.Count} gear  ·  {Gold(character.Gold)}";

        var tabs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach ((string tab, string caption) in new[] { ("cards", $"Cards {inventory.Cards.Count}"), ("gear", $"Gear {character.Gear.Count}") })
        {
            var button = new DockButton(caption, primary: false, fontSize: 14) { On = _inventoryTab == tab };
            AutomationProperties.SetName(button, tab == "cards" ? "Cards" : "Gear");
            button.Clicked += () =>
            {
                _inventoryTab = tab;
                ShowInventory();
            };
            tabs.Children.Add(button);
        }

        var page = new Grid { RowSpacing = 10 };
        page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        page.Children.Add(tabs);
        if (_inventoryTab == "gear")
        {
            var note = new TextBlock { Text = "Wear and take off gear on the Gear screen: the Gear button beside this one.", FontSize = 13, Foreground = Theme.Brush(Theme.FgMuted) };
            Grid.SetRow(note, 1);
            page.Children.Add(note);
            var rows = new StackPanel { Spacing = 8 };
            if (character.Gear.Count == 0) rows.Children.Add(GearNote("You own no gear yet. Gear drops from duels you win and from chests, and armorers sell it in towns."));
            foreach (RealmGearInstance item in GearOrder(character.Gear, item => item.Gear))
            {
                rows.Children.Add(InventoryGearRow(character, item));
            }

            FrameworkElement scroll = RealmScroll(rows);
            Grid.SetRow(scroll, 2);
            page.Children.Add(scroll);
        }
        else
        {
            FrameworkElement tools = InventoryTools();
            Grid.SetRow(tools, 1);
            page.Children.Add(tools);
            _inventoryBoard = RealmBoard("inventory", InventoryWidth, _ => { });
            var body = new StackPanel { Spacing = 6, Children = { _inventoryBoard } };
            FrameworkElement scroll = RealmScroll(body);
            Grid.SetRow(scroll, 2);
            page.Children.Add(scroll);
        }

        _realmContent.Child = page;
        LayOutInventory();
    }

    /// <summary>The cards tab's search box, sorts and filters, and how many cards they show.</summary>
    private FrameworkElement InventoryTools()
    {
        var search = new TextBox { PlaceholderText = "Search: name, type or rules text", Width = 300, FontSize = 14, Text = _inventorySearch, VerticalAlignment = VerticalAlignment.Center, RequestedTheme = ElementTheme.Dark };
        search.TextChanged += (_, _) =>
        {
            _inventorySearch = search.Text ?? string.Empty;
            LayOutInventory();
        };

        var tools = new FlowPanel { HorizontalSpacing = 6, VerticalSpacing = 6 };
        tools.Children.Add(search);
        tools.Children.Add(new TextBlock { Text = "Sort", FontSize = 13, Foreground = Theme.Brush(Theme.FgMuted), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) });
        foreach ((string sort, string caption) in new[] { ("name", "Name"), ("price", "Price"), ("count", "Count"), ("color", "Color") })
        {
            tools.Children.Add(InventoryChip(caption, $"Sort by {caption.ToLowerInvariant()}", _inventorySort == sort, () => _inventorySort = sort));
        }

        tools.Children.Add(new TextBlock { Text = "Show", FontSize = 13, Foreground = Theme.Brush(Theme.FgMuted), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) });
        foreach ((string show, string caption) in new[] { ("all", "All"), ("deck", "In the deck"), ("sideboard", "In the sideboard"), ("spare", "Spare") })
        {
            tools.Children.Add(InventoryChip(caption, caption, _inventoryShow == show, () => _inventoryShow = show));
        }

        _inventoryCount = new TextBlock { FontSize = 13, Foreground = Theme.Brush(Theme.FgSoft), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
        tools.Children.Add(_inventoryCount);
        return tools;
    }

    private DockButton InventoryChip(string caption, string name, bool on, Action choose)
    {
        var chip = new DockButton(caption, primary: false, fontSize: 13) { On = on };
        AutomationProperties.SetName(chip, name);
        chip.Clicked += () =>
        {
            choose();
            ShowInventory();
        };
        return chip;
    }

    /// <summary>The cards the search, the filter and the sort leave, laid out across the room the screen has.</summary>
    private void LayOutInventory()
    {
        if (_inventory is not { } inventory || _inventoryBoard is null || _realmOpen?.Screen != "inventory")
        {
            return;
        }

        string search = _inventorySearch.Trim();
        IEnumerable<RealmInventoryCard> shown = inventory.Cards.Where(card => _inventoryShow switch
        {
            "deck" => card.Deck > 0,
            "sideboard" => card.Sideboard > 0,
            "spare" => card.Count > card.Deck + card.Sideboard,
            _ => true,
        });
        if (search.Length > 0)
        {
            shown = shown.Where(card => InventoryMatches(card.Name, search));
        }

        shown = _inventorySort switch
        {
            "price" => shown.OrderByDescending(card => card.Gold).ThenBy(card => card.Name, StringComparer.Ordinal),
            "count" => shown.OrderByDescending(card => card.Count).ThenBy(card => card.Name, StringComparer.Ordinal),
            "color" => shown.OrderBy(card => ColorKey(card.Name)).ThenBy(card => card.Name, StringComparer.Ordinal),
            _ => shown.OrderBy(card => card.Name, StringComparer.Ordinal),
        };
        _inventoryShown = [.. shown];

        List<CardBoardElement.BoardCell> cells = [.. _inventoryShown.Select((card, i) =>
            new CardBoardElement.BoardCell(RealmFace(card.Name, RealmHandleBase + i), 0, 0, Tapped: false, Annotation: InventoryNote(card)))];
        LayRealmRow(_inventoryBoard, InventoryWidth, Math.Max(InventoryWidth, _realmContent.ActualWidth - 24), cells);
        if (_inventoryCount is not null)
        {
            _inventoryCount.Text = _inventoryShown.Count == inventory.Cards.Count ? $"{inventory.Cards.Count} different cards" : $"{_inventoryShown.Count} of {inventory.Cards.Count} cards";
        }
    }

    /// <summary>What a card's annotation says: how many, its price, and the copies the deck and the sideboard use.</summary>
    private static string InventoryNote(RealmInventoryCard card)
    {
        List<string> parts = [$"×{card.Count}", card.Gold > 0 ? Gold(card.Gold) : "no price"];
        if (card.Deck > 0) parts.Add($"{card.Deck} in deck");
        if (card.Sideboard > 0) parts.Add($"{card.Sideboard} sideboard");
        if (card.Relic) parts.Add("relic");
        return string.Join(" · ", parts);
    }

    /// <summary>Whether a card's name, type line or rules text holds the search, ignoring case.</summary>
    private bool InventoryMatches(string name, string search)
    {
        if (name.Contains(search, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!_catalogByName.TryGetValue(name, out CatalogCard? card))
        {
            return false;
        }

        ObjectView face = card.Card;
        return face.OracleText.Contains(search, StringComparison.OrdinalIgnoreCase)
            || face.Subtypes.Any(subtype => subtype.Contains(search, StringComparison.OrdinalIgnoreCase))
            || face.CardTypes.Any(type => type.ToString().Contains(search, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>A card's place in color order: by its color identity, white to green, multicolored after, colorless last.</summary>
    private string ColorKey(string name)
    {
        if (!_catalogByName.TryGetValue(name, out CatalogCard? card) || card.Identity.Count == 0)
        {
            return "9";
        }

        return card.Identity.Count > 1 ? $"5{string.Concat(card.Identity.Order().Select(color => (int)color))}" : ((int)card.Identity[0]).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    private Border InventoryGearRow(RealmCharacter character, RealmGearInstance item)
    {
        RealmGear gear = item.Gear;
        string? slot = character.Loadout.FirstOrDefault(worn => worn.Value?.InstanceId == item.InstanceId).Key;
        var text = new StackPanel { Spacing = 2 };
        text.Children.Add(new TextBlock { Text = gear.Name, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(GearLook.RarityText(gear.Rarity)) });
        string points = gear.Budget > 0 ? $"  ·  {gear.Points} of {gear.Budget} points" : string.Empty;
        text.Children.Add(new TextBlock { Text = $"{(gear.Slot == "ring" ? "Ring" : Capitalised(gear.Slot))}  ·  {RarityName(gear)}{points}  ·  worth {Gold(gear.Gold)}", FontSize = 12, Foreground = Theme.Brush(Theme.FgMuted) });
        if (GearStatLine(gear.Stats) is { Length: > 0 } stats) text.Children.Add(new TextBlock { Text = stats, FontSize = 14, Foreground = Theme.Brush(Theme.Accent) });
        if (GearEffects(gear) is { Length: > 0 } effects) text.Children.Add(new TextBlock { Text = effects, FontSize = 14, Foreground = Theme.Brush(Theme.FgSoft), TextWrapping = TextWrapping.WrapWholeWords });

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(new GearIconElement(gear, 56) { VerticalAlignment = VerticalAlignment.Top });
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);
        if (slot is not null)
        {
            var worn = new TextBlock { Text = slot switch { "ring1" => "Worn, right hand", "ring2" => "Worn, left hand", _ => "Worn" }, FontSize = 13, Foreground = Theme.Brush(Theme.Ready) };
            Grid.SetColumn(worn, 2);
            grid.Children.Add(worn);
        }

        var row = new Border
        {
            Background = Theme.Brush(Theme.Panel),
            BorderBrush = Theme.Brush(Theme.Line),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(10, 8, 12, 8),
            Child = grid,
        };
        AutomationProperties.SetName(row, gear.Name);
        _inventoryGearRows.Add((row, gear.Name, slot is null ? "owned" : $"wearing:{slot}", item.InstanceId));
        return row;
    }

    private readonly List<(Border Row, string Name, string Place, long Instance)> _inventoryGearRows = [];

    /// <summary>The inventory as a test reads it, under <c>realm.inventory</c>: the tab, the cards shown in order, and the gear rows.</summary>
    private void WriteRealmInventory(System.Text.Json.Utf8JsonWriter json)
    {
        if (_realmOpen?.Screen != "inventory" || _inventory is null)
        {
            return;
        }

        json.WriteStartObject("inventory");
        json.WriteString("tab", _inventoryTab);
        json.WriteString("sort", _inventorySort);
        json.WriteString("show", _inventoryShow);
        json.WriteNumber("value", _inventory.Value);
        json.WriteStartArray("cards");
        foreach (RealmInventoryCard card in _inventoryTab == "cards" ? _inventoryShown : [])
        {
            json.WriteStartObject();
            json.WriteString("name", card.Name);
            json.WriteNumber("count", card.Count);
            json.WriteNumber("gold", card.Gold);
            json.WriteNumber("deck", card.Deck);
            json.WriteNumber("sideboard", card.Sideboard);
            json.WriteEndObject();
        }

        json.WriteEndArray();
        json.WriteEndObject();
    }
}
