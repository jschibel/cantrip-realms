using System.Text.Json;
using Cantrip.Decks;
using Cantrip.Protocol;
using Windows.Foundation;

namespace Cantrip.Client.Web;

/// <summary>
/// What the realm's screens draw cards with: the realm server's catalog of faces (<c>/api/catalog</c>, which the deck
/// editor's search reads too), rows of cards as the table draws them (<see cref="CardBoardElement"/>), each named for the
/// test state, and gear as oversized cards (<see cref="GearCardElement"/>). And what a test reads of every realm screen,
/// under <c>realm</c> (<see cref="WriteRealm"/>).
/// </summary>
public sealed partial class MainPage
{
    /// <summary>Where the realm screens' card handles start: past the deck editor's search results.</summary>
    private const int RealmHandleBase = 5_000_000;

    /// <summary>The rows of cards the realm screen open shows, each with its name for the test state.</summary>
    private readonly List<(CardBoardElement Board, string Row)> _realmBoards = [];

    /// <summary>The gear cards the realm screen open shows, each with where it is (<c>worn:head</c>, <c>owned</c>, <c>stock</c>).</summary>
    private readonly List<GearCardElement> _realmGearCards = [];

    private Task<bool>? _realmCatalog;

    /// <summary>The catalog, fetched once it is first wanted and again after a fetch that failed; whether it is here.</summary>
    private Task<bool> EnsureRealmCatalogAsync()
    {
        if (_catalog is not null)
        {
            return Task.FromResult(true);
        }

        if (_realmCatalog is null || _realmCatalog.IsCompleted)
        {
            _realmCatalog = LoadRealmCatalogAsync();
        }

        return _realmCatalog;
    }

    private async Task<bool> LoadRealmCatalogAsync()
    {
        await LoadCatalogAsync();
        return _catalog is not null;
    }

    /// <summary>
    /// Where the deck editor's catalog comes from: the bot's site for <c>?decks</c>, the realm server for the card layer, on
    /// the signed-in cookie.
    /// </summary>
    private static Task<HttpResponseMessage> CatalogRequestAsync() =>
        ClientConfig.Realm ? RealmApi.SendAsync(HttpMethod.Get, "catalog") : DeckHttp.GetAsync(DeckApi("catalog"));

    /// <summary>A card's face by name as printed, given its own handle: the catalog's, or a face with its name alone.</summary>
    private ObjectView RealmFace(string name, int handle)
    {
        ObjectView printed = _catalogByName.TryGetValue(name, out CatalogCard? card)
            ? card.Card
            : new ObjectView { Known = true, CardId = name, Name = name, Kind = ObjectKindView.Card };
        return Handled(printed, handle);
    }

    /// <summary>A row of cards for a realm screen, as the deck editor's search is, its cards clicked one at a time.</summary>
    private CardBoardElement RealmBoard(string row, float width, Action<ViewHandle> clicked)
    {
        var board = new CardBoardElement(width, Tall(width))
        {
            FliesAlong = false,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        };
        board.CardClicked += clicked;
        _realmBoards.Add((board, row));
        return board;
    }

    /// <summary>Lays cards out in rows across <paramref name="room"/>, and sizes the board to them.</summary>
    private static void LayRealmRow(CardBoardElement board, float width, double room, IReadOnlyList<CardBoardElement.BoardCell> cells)
    {
        float height = Tall(width);
        const float gap = 12f;
        int across = Math.Max(1, (int)((Math.Max(width, room) + gap) / (width + gap)));
        List<CardBoardElement.BoardCell> placed = [.. cells.Select((cell, i) => cell with { Left = (i % across) * (width + gap), Top = (i / across) * (height + gap) })];
        int rows = Math.Max(1, (cells.Count + across - 1) / across);
        board.SetCellSize(width, height);
        board.Width = Math.Max(width, Math.Min(cells.Count, across) * (width + gap));
        board.Height = (rows * (height + gap)) - gap;
        board.SetCells(placed);
    }

    /// <summary>A heading over a part of a screen.</summary>
    private static TextBlock RealmHeading(string text) => new()
    {
        Text = text,
        FontSize = 15,
        FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        Foreground = Theme.Brush(Theme.Fg),
        Margin = new Thickness(0, 4, 0, 6),
    };

    /// <summary>A screen's body that scrolls when it is taller than the page.</summary>
    private static ScrollViewer RealmScroll(UIElement content) => new()
    {
        HorizontalScrollMode = ScrollMode.Disabled,
        HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        VerticalScrollMode = ScrollMode.Auto,
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        Content = content,
    };

    /// <summary>The realm's rows among every row of cards on the page (<see cref="CardBoards"/>).</summary>
    private IEnumerable<(CardBoardElement Board, Func<ViewHandle, CardLook?> Look)> RealmBoards() =>
        _realmBoards.Select(row => (row.Board, (Func<ViewHandle, CardLook?>)(_ => null)));

    /// <summary>What the test state calls a realm row of cards, or nothing for any other.</summary>
    private string RealmRow(CardBoardElement board) =>
        _realmBoards.FirstOrDefault(row => ReferenceEquals(row.Board, board)).Row ?? string.Empty;

    /// <summary>
    /// The realm screen open, as a test reads it (<c>realm</c>): which screen, what it is waiting on, what its header says,
    /// the duel's state, and every gear card with where it is on the page.
    /// </summary>
    private void WriteRealm(Utf8JsonWriter json)
    {
        if (!ClientConfig.Realm)
        {
            return;
        }

        json.WriteStartObject("realm");
        json.WriteString("screen", _realmOpen?.Screen ?? string.Empty);
        json.WriteString("loading", _realmLoading);
        json.WriteString("title", _realmScreen.Visibility == Visibility.Visible ? _realmScreenTitle.Text : _realmTitle.Text);
        json.WriteString("body", _realmIdle.Visibility == Visibility.Visible ? _realmBody.Text : string.Empty);
        json.WriteString("facts", _realmFacts.Text);
        json.WriteString("status", _realmStatus.Text);
        WriteRealmDuel(json);
        WriteRealmLoot(json);
        WriteRealmInventory(json);
        WriteRealmDuelGear(json);
        json.WriteStartArray("gear");
        foreach ((FrameworkElement card, string name, string place, long instance, bool selected) in GearSpots())
        {
            if (card.XamlRoot is null || card.ActualWidth <= 0 || !IsShown(card))
            {
                continue;
            }

            json.WriteStartObject();
            json.WriteString("name", name);
            json.WriteString("place", place);
            json.WriteNumber("instance", instance);
            json.WriteBoolean("selected", selected);
            Rect box = card.TransformToVisual(Root).TransformBounds(new Rect(0, 0, card.ActualWidth, card.ActualHeight));
            WriteBox(json, box);
            json.WriteEndObject();
        }

        json.WriteEndArray();
        json.WriteEndObject();
    }
}
