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
    /// <summary>Whether the deck editor is the realm's spell table rather than the constructed deck editor.</summary>
    private bool _realmDeck;

    private RealmCommand? _tableCommand;
    private Dictionary<string, int> _realmOwned = new(StringComparer.Ordinal);
    private HashSet<ColorView> _realmIdentity = [];
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
        _poolHint.Text = "Drag cards from your collection into the deck, or into the ante on the left  ·  double-click: to or from the ante  ·  drag back onto the search to take out";

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
        IsBasicLand(card) ? RealmWithin(card) : _realmOwned.GetValueOrDefault(card.Name) > 0;

    /// <summary>Whether another copy may come out of the collection: a free basic always, else while one is left.</summary>
    private bool RealmCanAdd(CatalogCard card) =>
        (IsBasicLand(card) && RealmWithin(card)) || RealmUsed(card.Name) < _realmOwned.GetValueOrDefault(card.Name);

    /// <summary>What a card of the search says over its art: free, or how many of the copies owned are left.</summary>
    private string RealmNote(CatalogCard card)
    {
        if (IsBasicLand(card))
        {
            return "Free";
        }

        int owned = _realmOwned.GetValueOrDefault(card.Name);
        string left = $"{Math.Max(0, owned - RealmUsed(card.Name))} of {owned} left";
        return RealmWithin(card) ? left : $"{left} · ante only";
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
        _realmAnteText.Text = $"Ante: {anted} card{(anted == 1 ? string.Empty : "s")}, {Gold(_realmAnteValue)}";
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
