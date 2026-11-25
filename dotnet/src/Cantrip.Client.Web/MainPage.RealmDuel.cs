using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using Cantrip.Client;
using Cantrip.Client.Presentation;
using Cantrip.Protocol;
using Cantrip.Realms;
using Cantrip.Server.Rules;
using Microsoft.UI.Xaml.Automation;

namespace Cantrip.Client.Web;

/// <summary>
/// The realm's <c>duel</c> screen (realms/docs/interfaces.md, "The card layer"): the <see cref="Duel"/> the encounter
/// started, dealt on the rules engine in this page (<see cref="BrowserEngine"/>) on the table the realm server's replay
/// deals it on (<see cref="DuelTable"/>). Seat 1 is this page's table, played as any game is; seat 2 the mob,
/// <see cref="RealmBot"/> on the duel's seed, settled before each of seat 1's messages reaches the table and between this
/// page's ticks. What seat 1 sent is the duel's log, handed back when the duel closes - <c>won</c> when seat 1 alone won,
/// else <c>lost</c> - with each seat's life as the game ended (<c>life: {player, mob}</c>; the server reads the mob's from
/// its own replay, and the offline overworld takes this one). Conceding ends the game the same way, through the table, so a
/// concession is a log too.
/// <para>
/// The game has no clocks, as the replay has none: nothing but seat 1's messages and the mob's answers moves it.
/// </para>
/// </summary>
public sealed partial class MainPage
{
    private readonly DispatcherTimer _duelTicker = new() { Interval = TimeSpan.FromMilliseconds(30) };
    private DuelTable? _duel;
    private Duel? _duelDealt;

    /// <summary>Whether this page's table is pumped: started once, by the first duel, as a server's table is by its connection.</summary>
    private bool _duelPumping;

    /// <summary>Whether the game is over and said to be, and whether it ended by this page's concession.</summary>
    private bool _duelEnded;
    private bool _duelConceded;

    private Border _duelBar = null!;
    private TextBlock _duelBarText = null!;
    private DockButton _duelConcede = null!;
    private Grid _duelEnd = null!;
    private TextBlock _duelEndTitle = null!;
    private TextBlock _duelEndDetail = null!;
    private StackPanel _duelEndButtons = null!;

    private bool DuelShown => _duel is not null;

    private void BuildRealmDuel()
    {
        _duelBarText = new TextBlock { FontSize = 13, Foreground = Theme.Brush(Theme.FgSoft), VerticalAlignment = VerticalAlignment.Center };
        _duelConcede = new DockButton("Concede", primary: false, fontSize: 13);
        AutomationProperties.SetName(_duelConcede, "Concede");
        _duelConcede.Clicked += AskConcede;
        _duelBar = new Border
        {
            Background = Theme.Brush(Theme.Bar),
            BorderBrush = Theme.Brush(Theme.Line),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(0, 0, 0, 8),
            Padding = new Thickness(14, 6, 8, 6),
            // In the table's top right corner, clear of the opponent's rail and of the middle, where their cards are laid.
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Visibility = Visibility.Collapsed,
            Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Children = { _duelBarText, _duelConcede } },
        };
        Root.Children.Add(_duelBar);

        _duelEndTitle = new TextBlock { FontSize = 30, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, TextAlignment = TextAlignment.Center };
        _duelEndDetail = new TextBlock
        {
            FontSize = 14,
            Foreground = Theme.Brush(Theme.FgSoft),
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.WrapWholeWords,
            MaxWidth = 420,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        _duelEndButtons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center };
        _duelEnd = new Grid
        {
            Visibility = Visibility.Collapsed,
            Children =
            {
                new Border
                {
                    MinWidth = 440,
                    Background = Theme.Brush(Theme.Panel),
                    BorderBrush = Theme.Brush(Theme.Line),
                    BorderThickness = new Thickness(2),
                    CornerRadius = new CornerRadius(12),
                    Padding = new Thickness(32, 24, 32, 24),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    Child = new StackPanel { Spacing = 14, Children = { _duelEndTitle, _duelEndDetail, _duelEndButtons } },
                },
            },
        };
        Grid.SetRowSpan(_duelEnd, 3);
        Grid.SetColumnSpan(_duelEnd, 2);
        Root.Children.Add(_duelEnd);

        _duelTicker.Tick += (_, _) => StepDuel();
    }

    private async Task OpenDuelAsync(RealmCommand command)
    {
        Duel? duel = null;
        try
        {
            if (command.Args.ValueKind == JsonValueKind.Object && command.Args.TryGetProperty("duel", out JsonElement dealt))
            {
                duel = dealt.Deserialize(RealmJson.Default.Duel);
            }
        }
        catch (JsonException)
        {
        }

        if (duel is not { Seats.Count: 2 })
        {
            ShowRealmProblem("Duel", "The duel could not be read from the encounter.", "lost", LogResult([]));
            return;
        }

        // The engine loads behind the splash, which waits only on the cards' faces.
        Task engine = LoadEngineAsync();
        ShowRealmLoading($"Duel against {duel.Mob.Name}", "The duel is beginning...");
        await EnsureRealmCatalogAsync();
        if (!StillOpen(command))
        {
            return;
        }

        ShowDuelSplash(command, duel, engine);
    }

    /// <summary>The rules engine, loaded once for every duel; a load that failed is tried again by the next.</summary>
    private Task? _engineLoad;

    private Task LoadEngineAsync()
    {
        if (_engineLoad is null || _engineLoad.IsFaulted || _engineLoad.IsCanceled)
        {
            _engineLoad = BrowserEngine.LoadAsync(ClientConfig.Engine);
        }

        return _engineLoad;
    }

    /// <summary>
    /// The encounter's splash (design.md A3): who the mob is - its tier, its life and hand, its gear's traits - and what the
    /// duel is for - the gold it carries, and the heart a loss costs, with the player's hearts. A
    /// game after the first says which it is and that the mob begins it at the life it kept. The duel is dealt when the
    /// player goes on (Fight).
    /// </summary>
    private void ShowDuelSplash(RealmCommand command, Duel duel, Task engine)
    {
        DuelSeat mob = duel.Seats[1];
        DuelSeat me = duel.Seats[0];

        var body = new StackPanel { Spacing = 10, MaxWidth = 900, HorizontalAlignment = HorizontalAlignment.Left };
        body.Children.Add(new TextBlock
        {
            Text = $"{mob.StartingLife} life  ·  a hand of {mob.StartingHandSize}  ·  {mob.Deck.Count} cards",
            FontSize = 15,
            Foreground = Theme.Brush(Theme.Fg),
        });
        string traits = mob.Emblems.Count == 0 ? "No gear of note." : $"Wears {string.Join(", ", mob.Emblems.Select(GearName))}.";
        body.Children.Add(new TextBlock { Text = traits, FontSize = 13, Foreground = Theme.Brush(Theme.FgSoft), TextWrapping = TextWrapping.Wrap });
        body.Children.Add(RealmHeading("At stake"));
        string gold = GoldRange(command.Args) is { } range ? $"It carries {Gold(range.Low)} to {Gold(range.High)}" : "It carries some gold";
        (int have, int hold) = Hearts(command.Args);
        body.Children.Add(new TextBlock
        {
            Text = $"{gold}, and perhaps gear: a win pays them. A loss pays nothing and costs a heart - you have {have} of {hold} {HeartsText(have, hold)}. Lose the last, and you wake at home.",
            FontSize = 13,
            Foreground = Theme.Brush(Theme.FgSoft),
            TextWrapping = TextWrapping.Wrap,
        });
        if (duel.Game > 1)
        {
            body.Children.Insert(0, new TextBlock
            {
                Text = $"Game {duel.Game}: it has not healed, and begins at {mob.StartingLife} life. You begin at your full {me.StartingLife}, {(duel.FirstPlayer == Duel.PlayerSeat ? "playing first" : "drawing first")}.",
                FontSize = 15,
                Foreground = Theme.Brush(Theme.Accent),
                TextWrapping = TextWrapping.Wrap,
            });
        }
        body.Children.Add(new TextBlock
        {
            Text = $"You: {me.StartingLife} life, a hand of {me.StartingHandSize}{(me.Emblems.Count > 0 ? $", {string.Join(", ", me.Emblems.Select(GearName))}" : string.Empty)}.",
            FontSize = 13,
            Foreground = Theme.Brush(Theme.FgSoft),
            TextWrapping = TextWrapping.Wrap,
        });

        ShowRealmScreen($"{duel.Mob.Name} attacks!", RealmScroll(body));
        _realmFacts.Text = $"{(duel.Mob.Tier == 0 ? "boss" : $"tier {duel.Mob.Tier}")}  ·  game {duel.Game}  ·  hearts {have} of {hold}";
        DockButton? fight = null;
        fight = RealmAction("Fight", primary: true, () =>
        {
            if (fight is null || !fight.Enabled)
            {
                return;
            }

            fight.Enabled = false;
            fight.Caption = "Dealing...";
            _ = DealDuelAsync(command, duel, engine);
        });
    }

    /// <summary>The player's hearts, as the overworld sent them (<c>hearts: {have, hold}</c>); two of two when it did not.</summary>
    private static (int Have, int Hold) Hearts(JsonElement args) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty("hearts", out JsonElement hearts) && hearts.ValueKind == JsonValueKind.Object
        && hearts.TryGetProperty("have", out JsonElement have) && have.TryGetInt32(out int h)
        && hearts.TryGetProperty("hold", out JsonElement hold) && hold.TryGetInt32(out int m)
            ? (h, m)
            : (2, 2);

    /// <summary>A row of hearts in text: filled for those had, empty for the rest held.</summary>
    private static string HeartsText(int have, int hold) => new string('♥', Math.Max(0, have)) + new string('♡', Math.Max(0, hold - have));

    /// <summary>The mob's gold range, as the overworld sent it (<c>mob.goldRange</c>), or null.</summary>
    private static (long Low, long High)? GoldRange(JsonElement args) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty("mob", out JsonElement mob) && mob.ValueKind == JsonValueKind.Object
        && mob.TryGetProperty("goldRange", out JsonElement range) && range.ValueKind == JsonValueKind.Array && range.GetArrayLength() == 2
        && range[0].TryGetInt64(out long low) && range[1].TryGetInt64(out long high)
            ? (low, high)
            : null;

    /// <summary>Deals the duel once the engine is in, and opens the table over the splash.</summary>
    private async Task DealDuelAsync(RealmCommand command, Duel duel, Task engine)
    {
        try
        {
            await engine;
        }
        catch (JSException error)
        {
            if (StillOpen(command))
            {
                ShowRealmProblem("Duel", $"The rules engine could not be loaded: {error.Message}", "lost", LogResult([]));
            }

            return;
        }

        if (!StillOpen(command))
        {
            return;
        }

        DuelTable table;
        try
        {
            table = DuelTable.Open(duel, new BrowserEngineTransport());
        }
        catch (Exception error) when (error is RulesRejectedException or JSException or InvalidOperationException)
        {
            ShowRealmProblem("Duel", $"The duel could not be dealt: {(error is RulesRejectedException refused ? refused.Detail : error.Message)}", "lost", LogResult([]));
            return;
        }

        _duel = table;
        _duelDealt = duel;
        _duelEnded = false;
        _duelConceded = false;
        _realmContent.Child = null;
        _realmBoards.Clear();
        ClearTable();
        _gameClient = new GameClient(table.Player);

        _realmLoading = string.Empty;
        _realmPanel.Visibility = Visibility.Collapsed;
        _duelBarText.Text = DuelLine(duel, Hearts(command.Args));
        _duelBar.Visibility = Visibility.Visible;
        _duelConcede.Visibility = Visibility.Visible;
        _duelEnd.Visibility = Visibility.Collapsed;
        if (!_duelPumping)
        {
            _duelPumping = true;
            StartPumping();
        }

        _duelTicker.Start();
    }

    /// <summary>"Phyrexian Scout · tier 1 · game 2 · ♥♡".</summary>
    private static string DuelLine(Duel duel, (int Have, int Hold) hearts) =>
        $"{duel.Mob.Name}  ·  {(duel.Mob.Tier == 0 ? "boss" : $"tier {duel.Mob.Tier}")}  ·  game {duel.Game}  ·  {HeartsText(hearts.Have, hearts.Hold)}";

    /// <summary>The table as a new game finds it: what the last game left in the log, the journal and half-made choices let go.</summary>
    private void ClearTable()
    {
        _menu.Close();
        _journal = new GameJournal();
        _abilitiesTriggered.Clear();
        _landingTriggers = null;
        _outcomeDismissed = false;
        _log.Clear();
        _selection.Clear();
        _lastPromptId = -1;
        _flights.Settle();
        _needsRedraw = true;
    }

    /// <summary>The mob answers what it is asked, between this page's own messages as well as before each; then the end is said.</summary>
    private void StepDuel()
    {
        if (_duel is not { } table)
        {
            return;
        }

        try
        {
            table.Settle();
        }
        catch (Exception error)
        {
            // The replay plays the mob with the same code, so a seat that faults here faults there: the duel can't go on.
            Console.Error.WriteLine($"The mob's seat faulted: {error}");
            EndDuel(table, $"The mob's seat stopped answering: {error.Message}");
            return;
        }

        if (table.IsOver && !_duelEnded)
        {
            EndDuel(table, null);
        }
    }

    /// <summary>The game is over: a concession closes at once; otherwise the result is said over the board until the player goes back.</summary>
    private void EndDuel(DuelTable table, string? fault)
    {
        _duelEnded = true;
        _duelTicker.Stop();
        string outcome = table.PlayerWon ? "won" : "lost";
        if (_duelConceded && fault is null)
        {
            CloseRealmScreen(outcome, DuelLogResult());
            return;
        }

        // The table's own outcome panel gives way to the realm's, which says what the duel was for.
        _outcomeDismissed = true;
        _needsRedraw = true;
        _duelConcede.Visibility = Visibility.Collapsed;
        bool draw = table.IsOver && table.Winners.Count == 0;
        _duelEndTitle.Text = fault is not null ? "The duel stopped" : table.PlayerWon ? "Victory" : draw ? "A draw" : "Defeat";
        _duelEndTitle.Foreground = Theme.Brush(table.PlayerWon ? Theme.Mine : draw ? Theme.FgSoft : Theme.Danger);
        string mob = _duelDealt?.Mob.Name ?? "the mob";
        string why = _gameClient is { } client ? WhyItEnded(client) : string.Empty;
        _duelEndDetail.Text = fault ?? (table.PlayerWon
            ? $"You defeated {mob}. {why}".Trim()
            : $"{(draw ? $"Your duel with {mob} is drawn, which counts as a loss." : $"{mob} defeated you.")} It costs you a heart. {why}".Trim());
        ShowDuelEndButtons(("Return to the world", true, () => CloseRealmScreen(outcome, DuelLogResult())));
    }

    private void AskConcede()
    {
        if (_gameClient is null || _duelEnded)
        {
            return;
        }

        _duelEndTitle.Text = "Concede the duel?";
        _duelEndTitle.Foreground = Theme.Brush(Theme.Fg);
        _duelEndDetail.Text = "Conceding is a loss: it costs you a heart.";
        ShowDuelEndButtons(
            ("Concede", true, () =>
            {
                _duelEnd.Visibility = Visibility.Collapsed;
                _duelConceded = true;
                _gameClient?.Concede();
            }),
            ("Play on", false, () => _duelEnd.Visibility = Visibility.Collapsed));
    }

    private void ShowDuelEndButtons(params (string Caption, bool Primary, Action Then)[] buttons)
    {
        _duelEndButtons.Children.Clear();
        foreach ((string caption, bool primary, Action then) in buttons)
        {
            var button = new DockButton(caption, primary, fontSize: 14);
            AutomationProperties.SetName(button, caption);
            button.Clicked += then;
            _duelEndButtons.Children.Add(button);
        }

        _duelEnd.Visibility = Visibility.Visible;
    }

    /// <summary>
    /// The duel's result as it hands it back, taken now: what seat 1 has sent the table, and each seat's life as the game
    /// stands (as it ended, for a game over).
    /// </summary>
    private Action<Utf8JsonWriter> DuelLogResult()
    {
        Action<Utf8JsonWriter> log = LogResult([.. _duel?.Log ?? []]);
        if (_duel is not { } table)
        {
            return log;
        }

        (int player, int mob) = (table.Life(Duel.PlayerSeat), table.Life(Duel.MobSeat));
        return writer =>
        {
            log(writer);
            writer.WriteStartObject("life");
            writer.WriteNumber("player", player);
            writer.WriteNumber("mob", mob);
            writer.WriteEndObject();
        };
    }

    private static Action<Utf8JsonWriter> LogResult(IReadOnlyList<string> log) => writer =>
    {
        writer.WriteStartArray("log");
        foreach (string line in log)
        {
            writer.WriteStringValue(line);
        }

        writer.WriteEndArray();
    };

    /// <summary>The duel's table let go, as its screen closes.</summary>
    private void LeaveDuel()
    {
        _duelTicker.Stop();
        _duelBar.Visibility = Visibility.Collapsed;
        _duelEnd.Visibility = Visibility.Collapsed;
        if (_duel is { } table)
        {
            _gameClient = null;
            _duel = null;
            _duelDealt = null;
            table.Dispose();
        }
    }

    /// <summary>The duel as a test reads it, under <c>realm.duel</c>: whether it is over, how, and the log's length.</summary>
    private void WriteRealmDuel(Utf8JsonWriter json)
    {
        if (_duel is not { } table)
        {
            return;
        }

        json.WriteStartObject("duel");
        json.WriteString("mob", _duelDealt?.Mob.Name ?? string.Empty);
        json.WriteBoolean("over", table.IsOver);
        json.WriteBoolean("won", table.PlayerWon);
        json.WriteBoolean("settled", table.Settled);
        json.WriteNumber("log", table.Log.Count);
        json.WriteBoolean("ended", _duelEnded);
        json.WriteNumber("game", _duelDealt?.Game ?? 0);
        json.WriteNumber("mobLife", table.Life(Duel.MobSeat));
        json.WriteNumber("playerLife", table.Life(Duel.PlayerSeat));
        json.WriteString("end", _duelEnd.Visibility == Visibility.Visible ? _duelEndTitle.Text : string.Empty);
        json.WriteEndObject();
    }

}
