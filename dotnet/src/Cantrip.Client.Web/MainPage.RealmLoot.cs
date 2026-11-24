using System.Text.Json;
using Cantrip.Protocol;

namespace Cantrip.Client.Web;

/// <summary>
/// The realm's <c>loot</c> screen (realms/docs/interfaces.md, "The card layer"; design.md A3): the cards a win offers, each
/// with its list price, and the prize cap their total must fit under. A card is clicked to take it or put it back; one that
/// would take the total over the cap can't be taken, and is drawn dimmed. It closes with the names taken
/// (<c>result.picks</c>), which the overworld claims with <c>/api/encounter/loot</c>.
/// </summary>
public sealed partial class MainPage
{
    private const float LootWidth = 230f;

    private List<RealmOffered> _lootOffer = [];
    private long _lootCap;
    private readonly HashSet<int> _lootPicked = [];
    private CardBoardElement? _lootBoard;
    private DockButton? _lootTake;

    private async Task OpenLootAsync(RealmCommand command)
    {
        List<RealmOffered> offer = [];
        long cap = 0;
        try
        {
            if (command.Args.TryGetProperty("offer", out JsonElement offered))
            {
                offer = offered.Deserialize(RealmJson.Default.ListRealmOffered) ?? [];
            }

            if (command.Args.TryGetProperty("cap", out JsonElement capped) && capped.ValueKind == JsonValueKind.Number)
            {
                cap = capped.GetInt64();
            }
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
        }

        ShowRealmLoading("Loot", "Loading the cards...");
        await EnsureRealmCatalogAsync();
        if (!StillOpen(command))
        {
            return;
        }

        _lootOffer = offer;
        _lootCap = cap;
        _lootPicked.Clear();
        string mob = Arg(command.Args, "mob") ?? "the mob";

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(new TextBlock
        {
            Text = offer.Count == 0
                ? $"{mob} left nothing you can take."
                : $"{mob} left these. Take any of them whose prices together fit under the prize cap: click a card to take it, again to put it back.",
            FontSize = 14,
            Foreground = Theme.Brush(Theme.FgSoft),
            TextWrapping = TextWrapping.Wrap,
        });
        // A gear item found with the cards (MainPage.RealmDrop.cs) leads the screen; with no cards, it is all there is.
        if (GearDrop(command.Args) is { } drop)
        {
            if (offer.Count == 0) body.Children.Clear();
            body.Children.Insert(0, drop);
        }

        _lootBoard = RealmBoard("loot", LootWidth, ClickLoot);
        body.Children.Add(_lootBoard);
        ShowRealmScreen("Loot", RealmScroll(body));
        _lootTake = RealmAction("Take", primary: true, () => CloseRealmScreen("closed", PicksResult([.. _lootPicked.Order().Select(i => _lootOffer[i].Name)])));
        RealmAction("Leave them", primary: false, () => CloseRealmScreen("closed", PicksResult([])));
        LayOutLoot();
    }

    private void ClickLoot(ViewHandle handle)
    {
        int i = handle.Value - RealmHandleBase;
        if (i < 0 || i >= _lootOffer.Count)
        {
            return;
        }

        if (!_lootPicked.Remove(i))
        {
            if (LootTaken() + _lootOffer[i].Gold > _lootCap)
            {
                SayRealm($"{_lootOffer[i].Name} ({Gold(_lootOffer[i].Gold)}) would take you over the cap.", trouble: true);
                return;
            }

            _lootPicked.Add(i);
        }

        SayRealm(string.Empty);
        LayOutLoot();
    }

    private long LootTaken() => _lootPicked.Sum(i => _lootOffer[i].Gold);

    private void LayOutLoot()
    {
        if (_lootBoard is null || _realmOpen?.Screen != "loot")
        {
            return;
        }

        long taken = LootTaken();
        List<CardBoardElement.BoardCell> cells = [.. _lootOffer.Select((card, i) =>
        {
            bool picked = _lootPicked.Contains(i);
            bool fits = picked || taken + card.Gold <= _lootCap;
            return new CardBoardElement.BoardCell(RealmFace(card.Name, RealmHandleBase + i), 0, 0, Tapped: false,
                Dimmed: !fits, Selected: picked, Clickable: true, Annotation: picked ? $"Taken · {Gold(card.Gold)}" : Gold(card.Gold));
        })];
        LayRealmRow(_lootBoard, LootWidth, _realmContent.ActualWidth, cells);
        _realmFacts.Text = $"Prize cap {Gold(_lootCap)}  ·  taken {Gold(taken)}";
        if (_lootTake is not null)
        {
            _lootTake.Caption = _lootPicked.Count == 0 ? "Take nothing" : $"Take {_lootPicked.Count} card{(_lootPicked.Count == 1 ? string.Empty : "s")}";
        }
    }

    private static Action<Utf8JsonWriter> PicksResult(IReadOnlyList<string> picks) => writer =>
    {
        writer.WriteStartArray("picks");
        foreach (string pick in picks)
        {
            writer.WriteStringValue(pick);
        }

        writer.WriteEndArray();
    };

    /// <summary>The loot as a test reads it, under <c>realm.loot</c>: the cap, and the names taken so far.</summary>
    private void WriteRealmLoot(Utf8JsonWriter json)
    {
        if (_realmOpen?.Screen != "loot")
        {
            return;
        }

        json.WriteStartObject("loot");
        json.WriteNumber("cap", _lootCap);
        json.WriteNumber("taken", LootTaken());
        json.WriteStartArray("picked");
        foreach (int i in _lootPicked.Order())
        {
            json.WriteStringValue(_lootOffer[i].Name);
        }

        json.WriteEndArray();
        json.WriteEndObject();
    }
}
