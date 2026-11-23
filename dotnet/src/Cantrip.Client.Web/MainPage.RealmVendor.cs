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
    private const float VendorWidth = 120f;

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
        SayRealm(string.Empty);
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
            SayRealm(buy ? $"You bought {name} for {Gold(gold)}." : $"You sold {name} for {Gold(gold)}.");
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
            Annotation: item.Count > 1 ? $"{Gold(item.Gold)} · {item.Count} left" : Gold(item.Gold)))];
        LayRealmRow(_vendorStock, VendorWidth, _realmContent.ActualWidth - 24, stock);

        List<CardBoardElement.BoardCell> own = [.. vendor.Buying.Select((item, i) => new CardBoardElement.BoardCell(
            RealmFace(item.Name, VendorOwnBase + i), 0, 0, Tapped: false,
            Dimmed: item.Spare == 0, Selected: _vendorPicked == (true, i), Clickable: true,
            Annotation: $"Pays {item.Gold} · {item.Spare}/{item.Owned} spare"))];
        LayRealmRow(_vendorOwn, VendorWidth, _realmContent.ActualWidth - 24, own);
        _vendorOwn.Visibility = own.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
        if (_vendorOwnNone is not null)
        {
            _vendorOwnNone.Visibility = own.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        _realmFacts.Text = $"Your gold {Gold(vendor.Gold)}  ·  their purse {Gold(vendor.Purse)}";
        if (_vendorBuy is not null && _vendorSell is not null)
        {
            (bool Own, int Place)? picked = _vendorPicked;
            _vendorBuy.Caption = picked is { Own: false } shelf ? $"Buy {vendor.Stock[shelf.Place].Name} for {Gold(vendor.Stock[shelf.Place].Gold)}" : "Buy";
            _vendorBuy.Enabled = !_vendorBusy && picked is { Own: false };
            _vendorSell.Caption = picked is { Own: true } mine ? $"Sell {vendor.Buying[mine.Place].Name} for {Gold(vendor.Buying[mine.Place].Gold)}" : "Sell";
            _vendorSell.Enabled = !_vendorBusy && picked is { Own: true };
        }
    }
}
