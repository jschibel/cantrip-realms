namespace Cantrip.Client.Web;

/// <summary>
/// The realm's <c>gear</c> screen (realms/docs/interfaces.md, "The card layer"; design.md A4): the character's loadout on a
/// paper doll - a card in each of its eight slots, or the slot's outline - beside the gear they own and do not wear, every
/// item drawn as the Vanguard-style oversized card it is in a duel (<see cref="CardFace.DrawGear"/>), and the stats the
/// loadout gives. A card is clicked to pick it: an owned item is worn in its slot (a ring on either hand), a worn one taken
/// off, each through <c>PUT /api/loadout</c>. Opened at an armorer (<c>args.armorer</c>), the armorer's stock is shown too,
/// to buy, and an owned item not worn can be sold to it.
/// </summary>
public sealed partial class MainPage
{
    /// <summary>A worn item on the doll, and an owned or a stocked one: each larger than a card at the table, as Vanguard cards are.</summary>
    private const float WornWidth = 80f * GearCardSpec.Oversize;
    private const float OwnedWidth = 107f * GearCardSpec.Oversize;

    /// <summary>The paper doll's slots, where each stands on its grid (row, column), and what its outline says.</summary>
    private static readonly (string Slot, int Row, int Column, string Says)[] DollSlots =
    [
        ("head", 0, 1, "Head"),
        ("ring1", 1, 0, "Right ring"),
        ("neck", 1, 1, "Neck"),
        ("ring2", 1, 2, "Left ring"),
        ("hands", 2, 0, "Hands"),
        ("body", 2, 1, "Body"),
        ("relic", 2, 2, "Relic"),
        ("feet", 3, 1, "Feet"),
    ];

    private RealmCharacter? _gearCharacter;
    private RealmArmorer? _armorer;
    private string? _armorerTown;
    private GearCardElement? _gearPicked;
    private bool _gearBusy;
    private StackPanel? _gearBody;
    private RealmCommand? _gearCommand;

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
        _gearBody = new StackPanel { Spacing = 8 };
        ShowRealmScreen(_armorerTown is null ? "Gear" : Describe(command.Args) is { Length: > 0 } named ? Capitalised(named) : "The armorer", RealmScroll(_gearBody));
        ShowGear();
    }

    private static string Capitalised(string text) => text.Length == 0 ? text : char.ToUpperInvariant(text[0]) + text[1..];

    private static GearCardSpec Spec(RealmGear gear) =>
        new(gear.Name, gear.Slot, gear.Rarity, gear.Stats.Life, gear.Stats.Hand, gear.Stats.MaxHand, gear.Text);

    /// <summary>The doll, the owned gear and the armorer's stock, laid out again from what the server last said.</summary>
    private void ShowGear()
    {
        if (_gearCharacter is not { } character || _gearBody is null)
        {
            return;
        }

        string? picked = _gearPicked is { } was ? $"{was.Place}|{was.Instance}|{was.Gear?.Name}" : null;
        _gearPicked = null;
        _realmGearCards.Clear();
        _gearBody.Children.Clear();

        var columns = new Grid { ColumnSpacing = 28 };
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // The paper doll: the loadout's eight slots about the figure.
        var doll = new Grid { RowSpacing = 10, ColumnSpacing = 10 };
        for (int i = 0; i < 3; i++) doll.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        for (int i = 0; i < 4; i++) doll.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        foreach ((string slot, int row, int column, string says) in DollSlots)
        {
            RealmGearInstance? worn = character.Loadout.GetValueOrDefault(slot);
            var card = new GearCardElement(worn is null ? null : Spec(worn.Gear), $"worn:{slot}", worn?.InstanceId ?? 0, WornWidth, says);
            Watch(card);
            Grid.SetRow(card, row);
            Grid.SetColumn(card, column);
            doll.Children.Add(card);
        }

        var left = new StackPanel { Spacing = 6, Children = { RealmHeading("Worn"), doll } };
        columns.Children.Add(left);

        var right = new StackPanel { Spacing = 6 };
        HashSet<long> wornIds = [.. character.Loadout.Values.OfType<RealmGearInstance>().Select(worn => worn.InstanceId)];
        List<RealmGearInstance> owned = [.. character.Gear.Where(item => !wornIds.Contains(item.InstanceId)).OrderBy(item => item.Gear.Slot, StringComparer.Ordinal).ThenBy(item => item.Gear.Name, StringComparer.Ordinal)];
        if (_armorer is { } armorer)
        {
            right.Children.Add(RealmHeading("For sale"));
            right.Children.Add(armorer.Stock.Count == 0
                ? new TextBlock { Text = "Nothing today.", FontSize = 13, Foreground = Theme.Brush(Theme.FgMuted) }
                : Flow(armorer.Stock.Select(item => new GearCardElement(Spec(item), "stock", 0, OwnedWidth) { Tag = item, Dimmed = item.Gold > character.Gold })));
        }

        right.Children.Add(RealmHeading("Your gear"));
        right.Children.Add(owned.Count == 0
            ? new TextBlock { Text = "Everything you own is worn.", FontSize = 13, Foreground = Theme.Brush(Theme.FgMuted) }
            : Flow(owned.Select(item => new GearCardElement(Spec(item.Gear), "owned", item.InstanceId, OwnedWidth))));

        Grid.SetColumn(right, 1);
        columns.Children.Add(right);
        _gearBody.Children.Add(columns);

        // What was picked before stays picked, if it is still there.
        if (picked is not null)
        {
            _gearPicked = _realmGearCards.FirstOrDefault(card => $"{card.Place}|{card.Instance}|{card.Gear?.Name}" == picked);
            if (_gearPicked is not null) _gearPicked.Selected = true;
        }

        ShowGearActions();
    }

    private FlowPanel Flow(IEnumerable<GearCardElement> cards)
    {
        var flow = new FlowPanel { HorizontalSpacing = 12, VerticalSpacing = 12 };
        foreach (GearCardElement card in cards)
        {
            Watch(card);
            flow.Children.Add(card);
        }

        return flow;
    }

    private void Watch(GearCardElement card)
    {
        _realmGearCards.Add(card);
        card.Clicked += PickGear;
    }

    private void PickGear(GearCardElement card)
    {
        if (_gearBusy)
        {
            return;
        }

        if (_gearPicked is { } before)
        {
            before.Selected = false;
        }

        _gearPicked = ReferenceEquals(_gearPicked, card) || (card.Gear is null && card.Place.StartsWith("worn:", StringComparison.Ordinal)) ? null : card;
        if (_gearPicked is not null)
        {
            _gearPicked.Selected = true;
        }

        SayRealm(_gearPicked?.Gear is { } gear ? $"{gear.Name}: {string.Join(" ", gear.StatLines().Append(gear.Text.Replace('\n', ' ')))}".Trim() : string.Empty);
        ShowGearActions();
    }

    /// <summary>The header's buttons for what is picked: wear it, take it off, buy it or sell it.</summary>
    private void ShowGearActions()
    {
        _realmActions.Children.Clear();
        if (_gearCharacter is not { } character)
        {
            return;
        }

        _realmFacts.Text = $"Life {character.Stats.Life}  ·  hand {character.Stats.Hand}  ·  maximum hand {character.Stats.MaxHand}  ·  {Gold(character.Gold)}";
        if (_gearPicked is { Gear: { } gear } picked)
        {
            if (picked.Place.StartsWith("worn:", StringComparison.Ordinal))
            {
                RealmAction("Take off", primary: true, () => _ = WearAsync(new Dictionary<string, long?> { [picked.Place["worn:".Length..]] = null }));
            }
            else if (picked.Place == "owned")
            {
                foreach (string slot in gear.Slot == "ring" ? ["ring1", "ring2"] : (string[])[gear.Slot])
                {
                    string caption = slot switch { "ring1" => "Wear on the right hand", "ring2" => "Wear on the left hand", _ => "Wear" };
                    RealmAction(caption, primary: true, () => _ = WearAsync(new Dictionary<string, long?> { [slot] = picked.Instance }));
                }

                if (_armorerTown is not null && picked.Tag is null)
                {
                    long pays = character.Gear.FirstOrDefault(item => item.InstanceId == picked.Instance)?.Gear.Gold / 2 ?? 0;
                    RealmAction("Sell", primary: false, () => _ = SellGearAsync(picked.Instance)).Caption = $"Sell for {Gold(pays)}";
                }
            }
            else if (picked.Place == "stock" && picked.Tag is RealmGear item)
            {
                RealmAction("Buy", primary: true, () => _ = BuyGearAsync(item)).Caption = $"Buy for {Gold(item.Gold)}";
            }
        }

        RealmAction("Done", primary: false, () => CloseRealmScreen("closed"));
    }

    private async Task WearAsync(Dictionary<string, long?> slots)
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
            _gearPicked = null;
            ShowGear();
            SayRealm("Your loadout is changed.");
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

    /// <summary>A trade with the armorer, then the character read again for their gold and gear.</summary>
    private async Task TradeGearAsync(Func<Task<RealmReply<RealmGearTrade>>> trade, string done)
    {
        RealmCommand? open = _gearCommand;
        _gearBusy = true;
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

        _gearPicked = null;
        ShowGear();
        SayRealm(traded.Ok ? done : traded.Words, trouble: !traded.Ok);
    }
}
