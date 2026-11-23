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
/// page's ticks. What seat 1 sent is the duel's log, handed back when the duel closes: <c>won</c> when seat 1 alone won,
/// else <c>lost</c>. Conceding ends the game the same way, through the table, so a concession is a log too.
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
            CornerRadius = new CornerRadius(0, 0, 8, 8),
            Padding = new Thickness(14, 6, 8, 6),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
            Visibility = Visibility.Collapsed,
            Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Children = { _duelBarText, _duelConcede } },
        };
        Grid.SetColumnSpan(_duelBar, 2);
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

        ShowRealmLoading($"Duel against {duel.Mob.Name}", "Loading the rules engine...");
        try
        {
            await BrowserEngine.LoadAsync(ClientConfig.Engine);
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
        ClearTable();
        _gameClient = new GameClient(table.Player);

        _realmLoading = string.Empty;
        _realmPanel.Visibility = Visibility.Collapsed;
        _duelBarText.Text = DuelLine(duel);
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

    /// <summary>"Phyrexian Scout · tier 1 · ante 120 gold · prize cap 100 gold".</summary>
    private static string DuelLine(Duel duel) =>
        $"{duel.Mob.Name}  ·  {(duel.Mob.Tier == 0 ? "boss" : $"tier {duel.Mob.Tier}")}  ·  ante {Gold(duel.AnteValue)}  ·  prize cap {Gold(duel.Cap)}";

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
            : $"{(draw ? $"Your duel with {mob} is drawn, which counts as a loss." : $"{mob} defeated you.")} {(_duelDealt?.AnteValue > 0 ? "A card of your ante is lost, and you" : "You")} wake at the inn. {why}".Trim());
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
        _duelEndDetail.Text = _duelDealt?.AnteValue > 0
            ? "Conceding is a loss: a card of your ante is lost, and you wake at the inn."
            : "Conceding is a loss: you wake at the inn.";
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

    /// <summary>The duel's log as the result hands it back, taken now: what seat 1 has sent the table.</summary>
    private Action<Utf8JsonWriter> DuelLogResult() => LogResult([.. _duel?.Log ?? []]);

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
        json.WriteString("end", _duelEnd.Visibility == Visibility.Visible ? _duelEndTitle.Text : string.Empty);
        json.WriteEndObject();
    }

}
