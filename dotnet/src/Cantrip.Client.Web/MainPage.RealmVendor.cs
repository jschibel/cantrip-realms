using Cantrip.Protocol;

namespace Cantrip.Client.Web;

/// <summary>
/// The realm's <c>vendor</c> screen (realms/docs/interfaces.md, "The card layer"; design.md A5): a vendor's shelves, each
/// card at its list price with how many are left, and the character's own cards of its trade, at what it pays and with
/// how many are spare (in neither the deck nor the ante). A card is clicked to pick it, and the header's button buys or
/// sells it through the API; the character's gold and the vendor's purse are shown, and a refusal is said in words.
/// </summary>
public sealed partial class MainPage
{
    private const float VendorWidth = 150f;

    /// <summary>Where the character's own cards' handles start, past the shelves'.</summary>
    private const int VendorOwnBase = RealmHandleBase + 100_000;

    private string _vendorId = string.Empty;
    private RealmVendor? _vendor;
    private CardBoardElement? _vendorStock;
    private CardBoardElement? _vendorOwn;
    private TextBlock? _vendorOwnNone;

    /// <summary>The card picked: a shelf's (by its place in the stock) or the character's (by its place in what the vendor buys).</summary>
    private (bool Own, int Place)? _vendorPicked;
    private DockButton? _vendorBuy;
    private DockButton? _vendorSell;
    private bool _vendorBusy;
    private TextBlock? _vendorTrade;

    /// <summary>What a vendor deals in, in words, and how it trades: "Deals in Goblins. Sells at list price, buys at half from its purse."</summary>
    private static string TradeWords(RealmVendor vendor)
    {
        RealmVendorInfo info = vendor.Vendor;
        string what = info.Kind switch
        {
            "exotic" => "cards from beyond Dominaria",
            "trader" => info.Plane is { Length: > 0 } plane ? $"cards from {char.ToUpperInvariant(plane[0])}{plane[1..]}" : "cards from another plane",
            _ => Specialty(info.Specialty),
        };
        return $"Deals in {what}, and nothing else. Sells at list price; buys at half the list price, paid from its purse, a copy at a time. A card in your deck or ante isn't for sale.";
    }

    /// <summary>A specialty in words: "white cards", "Goblins", "artifacts", "rare and mythic cards", "a chosen few cards".</summary>
    private static string Specialty(RealmSpecialty? specialty)
    {
        if (specialty is null)
        {
            return "cards";
        }

        List<string> parts = [];
        if (specialty.Subtypes is { Count: > 0 } subtypes)
        {
            parts.Add(Joined(subtypes.Select(type => type.EndsWith('f') ? type[..^1] + "ves" : type + "s")));
        }

        if (specialty.Types is { Count: > 0 } types)
        {
            parts.Add(Joined(types.Select(type => type.ToLowerInvariant() switch
            {
                "sorcery" => "sorceries",
                var plain => plain + "s",
            })));
        }

        if (specialty.Rarities is { Count: > 0 } rarities)
        {
            parts.Add($"{Joined(rarities.Select(rarity => rarity.ToLowerInvariant()))} cards");
        }

        if (specialty.Names is { Count: > 0 })
        {
            parts.Add("a chosen few cards");
        }

        string colors = specialty.Colors is { Length: > 0 } letters
            ? Joined(letters.Select(letter => letter switch
            {
                'W' => "white",
                'U' => "blue",
                'B' => "black",
                'R' => "red",
                'G' => "green",
                _ => letter.ToString(),
            }))
            : string.Empty;
        string kinds = parts.Count > 0 ? string.Join(", ", parts) : "cards";
        return colors.Length > 0 ? $"{colors} {kinds} (and colorless ones)" : kinds;
    }

    private static string Joined(IEnumerable<string> words)
    {
        List<string> list = [.. words];
        return list.Count switch
        {
            0 => string.Empty,
            1 => list[0],
            _ => $"{string.Join(", ", list.Take(list.Count - 1))} and {list[^1]}",
        };
    }

    /// <summary>When a card leaves the shelf, as the stock's line says it: "leaves in 5 h", or nothing for a card a player sold.</summary>
    private static string Leaves(DateTimeOffset? until)
    {
        if (until is not { } when)
        {
            return string.Empty;
        }

        TimeSpan left = when - DateTimeOffset.UtcNow;
        return left <= TimeSpan.Zero ? " · leaving" : left.TotalHours >= 1 ? $" · {(int)left.TotalHours} h left" : $" · {Math.Max(1, (int)left.TotalMinutes)} min left";
    }

    private async Task OpenVendorAsync(RealmCommand command)
    {
        _vendorId = Arg(command.Args, "id") ?? string.Empty;
        ShowRealmLoading(Describe(command.Args) is { Length: > 0 } named ? named : "Vendor", "Opening the stall...");
        Task<bool> cards = EnsureRealmCatalogAsync();
        RealmReply<RealmVendor> visit = await RealmApi.GetAsync($"vendor/{Uri.EscapeDataString(_vendorId)}", RealmJson.Default.RealmVendor);
        await cards;
        if (!StillOpen(command))
        {
            return;
        }

        if (!visit.Ok)
        {
            ShowRealmProblem(Describe(command.Args) is { Length: > 0 } title ? title : "Vendor", visit.Words, "closed");
            return;
        }

        _vendor = visit.Value;
        _vendorPicked = null;
        var body = new StackPanel { Spacing = 6 };
        _vendorTrade = new TextBlock { FontSize = 13, Foreground = Theme.Brush(Theme.FgSoft), TextWrapping = TextWrapping.Wrap, Text = TradeWords(_vendor!) };
        body.Children.Add(_vendorTrade);
        body.Children.Add(RealmHeading("For sale"));
        _vendorStock = RealmBoard("stock", VendorWidth, handle => PickVendorCard(own: false, handle.Value - RealmHandleBase));
        body.Children.Add(_vendorStock);
        body.Children.Add(RealmHeading("Yours they would buy"));
        _vendorOwnNone = new TextBlock { FontSize = 13, Foreground = Theme.Brush(Theme.FgMuted), Text = "You have nothing of their trade." };
        body.Children.Add(_vendorOwnNone);
        _vendorOwn = RealmBoard("buying", VendorWidth, handle => PickVendorCard(own: true, handle.Value - VendorOwnBase));
        body.Children.Add(_vendorOwn);
        ShowRealmScreen(_vendor!.Vendor.Name, RealmScroll(body));
        _vendorBuy = RealmAction("Buy", primary: true, () => _ = TradeAsync(buy: true));
        _vendorSell = RealmAction("Sell", primary: false, () => _ = TradeAsync(buy: false));
        RealmAction("Done", primary: false, () => CloseRealmScreen("closed"));
        LayOutVendor();
    }

    private void PickVendorCard(bool own, int place)
    {
        if (_vendor is not { } vendor || place < 0 || place >= (own ? vendor.Buying.Count : vendor.Stock.Count))
        {
            return;
        }

        _vendorPicked = _vendorPicked == (own, place) ? null : (own, place);
        SayRealm(_vendorPicked is null ? string.Empty
            : !own && vendor.Stock[place].Gold > vendor.Gold ? $"{vendor.Stock[place].Name} costs {Gold(vendor.Stock[place].Gold)}; you have {Gold(vendor.Gold)}."
            : own && vendor.Buying[place].Spare == 0 ? $"Every {vendor.Buying[place].Name} you own is in your deck or ante: change them at a spell table to sell one."
            : own && vendor.Buying[place].Gold > vendor.Purse ? $"Their purse holds {Gold(vendor.Purse)}: too little for your {vendor.Buying[place].Name}."
            : string.Empty, trouble: true);
        LayOutVendor();
    }

    private async Task TradeAsync(bool buy)
    {
        if (_vendor is not { } vendor || _vendorPicked is not { } picked || picked.Own == buy || _vendorBusy)
        {
            return;
        }

        string name = buy ? vendor.Stock[picked.Place].Name : vendor.Buying[picked.Place].Name;
        long gold = buy ? vendor.Stock[picked.Place].Gold : vendor.Buying[picked.Place].Gold;
        RealmCommand? open = _realmOpen;
        _vendorBusy = true;
        LayOutVendor();
        RealmReply<RealmTrade> traded = await RealmApi.CallAsync(
            HttpMethod.Post,
            $"vendor/{Uri.EscapeDataString(_vendorId)}/{(buy ? "buy" : "sell")}",
            new RealmCardTrade(name),
            RealmJson.Default.RealmCardTrade,
            RealmJson.Default.RealmTrade);
        RealmReply<RealmVendor> again = await RealmApi.GetAsync($"vendor/{Uri.EscapeDataString(_vendorId)}", RealmJson.Default.RealmVendor);
        _vendorBusy = false;
        if (open is null || !StillOpen(open))
        {
            return;
        }

        if (again.Ok)
        {
            _vendor = again.Value;
            _vendorPicked = null;
        }

        if (traded.Ok)
        {
            int now = traded.Value!.Collection.Cards.GetValueOrDefault(name);
            SayRealm(buy
                ? $"You bought {name} for {Gold(gold)}: you own {now}, at the spell table now."
                : $"You sold {name} for {Gold(gold)}: you own {now}. It is on their shelf for anyone.");
        }
        else
        {
            SayRealm(traded.Words, trouble: true);
        }

        LayOutVendor();
    }

    private void LayOutVendor()
    {
        if (_vendor is not { } vendor || _vendorStock is null || _vendorOwn is null || _realmOpen?.Screen != "vendor")
        {
            return;
        }

        List<CardBoardElement.BoardCell> stock = [.. vendor.Stock.Select((item, i) => new CardBoardElement.BoardCell(
            RealmFace(item.Name, RealmHandleBase + i), 0, 0, Tapped: false,
            Dimmed: item.Gold > vendor.Gold, Selected: _vendorPicked == (false, i), Clickable: true,
            Annotation: $"{Gold(item.Gold)}{(item.Count > 1 ? $" · {item.Count} copies" : string.Empty)}{Leaves(item.Until)}"))];
        LayRealmRow(_vendorStock, VendorWidth, _realmContent.ActualWidth - 24, stock);

        List<CardBoardElement.BoardCell> own = [.. vendor.Buying.Select((item, i) => new CardBoardElement.BoardCell(
            RealmFace(item.Name, VendorOwnBase + i), 0, 0, Tapped: false,
            Dimmed: item.Spare == 0, Selected: _vendorPicked == (true, i), Clickable: true,
            Annotation: item.Spare == 0
                ? $"Pays {item.Gold} g · all {item.Owned} in deck/ante"
                : $"Pays {item.Gold} g · {item.Spare} of {item.Owned} spare"))];
        LayRealmRow(_vendorOwn, VendorWidth, _realmContent.ActualWidth - 24, own);
        _vendorOwn.Visibility = own.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
        if (_vendorOwnNone is not null)
        {
            _vendorOwnNone.Visibility = own.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        _realmFacts.Text = $"Your gold {Gold(vendor.Gold)}  ·  their purse {Gold(vendor.Purse)}";
        if (_vendorTrade is not null)
        {
            _vendorTrade.Text = TradeWords(vendor);
        }
        if (_vendorBuy is not null && _vendorSell is not null)
        {
            (bool Own, int Place)? picked = _vendorPicked;
            _vendorBuy.Caption = picked is { Own: false } shelf ? $"Buy {vendor.Stock[shelf.Place].Name} for {Gold(vendor.Stock[shelf.Place].Gold)}" : "Buy";
            _vendorBuy.Enabled = !_vendorBusy && picked is { Own: false } buying && vendor.Stock[buying.Place].Gold <= vendor.Gold;
            _vendorSell.Caption = picked is { Own: true } mine ? $"Sell {vendor.Buying[mine.Place].Name} for {Gold(vendor.Buying[mine.Place].Gold)}" : "Sell";
            _vendorSell.Enabled = !_vendorBusy && picked is { Own: true } selling && vendor.Buying[selling.Place].Spare > 0 && vendor.Buying[selling.Place].Gold <= vendor.Purse;
        }
    }
}
