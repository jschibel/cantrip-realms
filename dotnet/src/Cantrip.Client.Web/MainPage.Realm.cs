using System.Text.Json;
using Microsoft.UI.Xaml.Automation;

namespace Cantrip.Client.Web;

/// <summary>
/// Cantrip Realms' card layer (<c>?realm</c>): this page framed over the realm's overworld, joining no table of its own.
/// The overworld asks for a card screen through <see cref="RealmBridge"/> and this page shows it over everything, then
/// says how it closed and what it hands back (realms/docs/interfaces.md, "The card layer"):
/// <list type="bullet">
/// <item><c>duel</c>: the duel played on the rules engine in the page (MainPage.RealmDuel.cs);</item>
/// <item><c>sideboard</c>: the deck swapped with its sideboard between the games of a rematch (MainPage.RealmTable.cs);</item>
/// <item><c>loot</c>: the gear item a win dropped or a chest held (MainPage.RealmLoot.cs);</item>
/// <item><c>spell-table</c>: the deck editor on the character's collection, with the sideboard (MainPage.RealmTable.cs);</item>
/// <item><c>vendor</c>: a vendor's stock and what of the character's it buys (MainPage.RealmVendor.cs);</item>
/// <item><c>gear</c>: the loadout on a paper doll and the gear owned, and an armorer's stock (MainPage.RealmGear.cs);</item>
/// <item><c>inventory</c>: everything the character owns, cards and gear (MainPage.RealmInventory.cs).</item>
/// </list>
/// Every screen but the duel and the spell table is drawn in this one panel: a header saying what it is, the character's
/// gold and how the last thing asked went, and the screen's own body under it. What the screens call is the realm
/// server's API (<see cref="RealmApi"/>).
/// </summary>
public sealed partial class MainPage
{
    private readonly Grid _realmPanel = new()
    {
        Background = Theme.Brush(Theme.Window),
        Visibility = Visibility.Collapsed,
    };

    private readonly DispatcherTimer _realmTicker = new() { Interval = TimeSpan.FromMilliseconds(50) };

    // What the panel shows with no screen open, or while one loads: a card in the middle.
    private readonly Border _realmIdle = new();
    private readonly TextBlock _realmTitle = new() { FontSize = 22, Foreground = Theme.Brush(Theme.Accent), TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _realmBody = new() { FontSize = 14, Foreground = Theme.Brush(Theme.FgSoft), TextWrapping = TextWrapping.Wrap };
    private readonly StackPanel _realmButtons = new() { Orientation = Orientation.Horizontal, Spacing = 8 };

    // A screen: its header, and its body.
    private readonly Grid _realmScreen = new() { Padding = new Thickness(18, 14, 18, 14), RowSpacing = 10, Visibility = Visibility.Collapsed };
    private readonly TextBlock _realmScreenTitle = new() { FontSize = 20, Foreground = Theme.Brush(Theme.Fg), VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _realmFacts = new() { FontSize = 13, Foreground = Theme.Brush(Theme.FgSoft), VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _realmStatus = new() { FontSize = 13, Foreground = Theme.Brush(Theme.FgSoft), TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _realmActions = new() { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _realmContent = new();

    /// <summary>The request whose screen is open, or null with none open.</summary>
    private RealmCommand? _realmOpen;

    /// <summary>What a screen being loaded is still waiting on, in words; empty once it is up.</summary>
    private string _realmLoading = string.Empty;

    /// <summary>Whether the realm's panel is what the page shows, idle or with a screen in it, and not loading one.</summary>
    private bool RealmShown => _realmPanel.Visibility == Visibility.Visible && _realmLoading.Length == 0;

    private void BuildRealmLayer()
    {
        _realmIdle.Background = Theme.Brush(Theme.Panel);
        _realmIdle.BorderBrush = Theme.Brush(Theme.Line);
        _realmIdle.BorderThickness = new Thickness(1);
        _realmIdle.CornerRadius = new CornerRadius(8);
        _realmIdle.Padding = new Thickness(24, 20, 24, 20);
        _realmIdle.MaxWidth = 520;
        _realmIdle.HorizontalAlignment = HorizontalAlignment.Center;
        _realmIdle.VerticalAlignment = VerticalAlignment.Center;
        _realmIdle.Child = new StackPanel { Spacing = 14, Children = { _realmTitle, _realmBody, _realmButtons } };
        _realmPanel.Children.Add(_realmIdle);

        _realmScreen.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _realmScreen.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var header = new Grid { ColumnSpacing = 16 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _realmScreenTitle.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        header.Children.Add(_realmScreenTitle);
        Grid.SetColumn(_realmFacts, 1);
        header.Children.Add(_realmFacts);
        Grid.SetColumn(_realmStatus, 2);
        header.Children.Add(_realmStatus);
        Grid.SetColumn(_realmActions, 3);
        header.Children.Add(_realmActions);
        _realmScreen.Children.Add(header);
        Grid.SetRow(_realmContent, 1);
        _realmScreen.Children.Add(_realmContent);
        _realmContent.SizeChanged += (_, _) => LayOutRealm();
        _realmPanel.Children.Add(_realmScreen);

        Grid.SetRowSpan(_realmPanel, 3);
        Grid.SetColumnSpan(_realmPanel, 2);
        Root.Children.Add(_realmPanel);

        // The spell table is the deck editor, which this page builds as ?decks does, over the table like the panel.
        BuildDeckEditor();
        Grid.SetRowSpan(_deckPanel, 3);
        Grid.SetColumnSpan(_deckPanel, 2);
        Root.Children.Add(_deckPanel);
        BuildRealmTable();

        // The duel's own bar over the table, and what it says when the game is over; and the gear worn in it.
        BuildRealmDuel();
        BuildDuelGear();
    }

    private Task StartRealmAsync()
    {
        BrowserTitle.Show("Cantrip Realms");
        _realmPanel.Visibility = Visibility.Visible;
        ShowRealmIdle();
        _realmTicker.Tick += (_, _) => TakeRealmCommands();
        _realmTicker.Start();
        RealmBridge.Ready();
        return Task.CompletedTask;
    }

    private void TakeRealmCommands()
    {
        foreach (RealmCommand command in RealmBridge.Take())
        {
            switch (command.Op)
            {
                case "open":
                    // A screen asked for over one still open closes that one first, so every request is answered.
                    CloseRealmScreen("replaced");
                    OpenRealmScreen(command);
                    break;
                case "close":
                    CloseRealmScreen("dismissed");
                    break;
                case "portrait":
                    TakePortrait(command);
                    break;
            }
        }
    }

    private void OpenRealmScreen(RealmCommand command)
    {
        _realmOpen = command;
        switch (command.Screen)
        {
            case "duel":
                _ = OpenDuelAsync(command);
                break;
            case "loot":
                _ = OpenLootAsync(command);
                break;
            case "sideboard":
                _ = OpenSideboardAsync(command);
                break;
            case "spell-table":
                _ = OpenSpellTableAsync(command);
                break;
            case "vendor":
                _ = OpenVendorAsync(command);
                break;
            case "gear":
                _ = OpenGearAsync(command);
                break;
            case "inventory":
                _ = OpenInventoryAsync(command);
                break;
            default:
                ShowRealmProblem(command.Screen, $"There is no '{command.Screen}' screen.", "closed");
                break;
        }
    }

    /// <summary>The rows of cards of the screen open laid out again across the room it has.</summary>
    private void LayOutRealm()
    {
        switch (_realmOpen?.Screen)
        {
            case "vendor":
                LayOutVendor();
                break;
            case "inventory":
                LayOutInventory();
                break;
        }
    }

    /// <summary>Whether a screen opened with <paramref name="command"/> is still the one open: a load that finishes after another was asked for does nothing.</summary>
    private bool StillOpen(RealmCommand command) => ReferenceEquals(_realmOpen, command);

    /// <summary>
    /// Closes the screen open, if any, telling the overworld how and handing back what <paramref name="result"/> writes
    /// (a duel's log, a sideboarding's deck); with no result given, what the screen open hands back when cut short.
    /// </summary>
    private void CloseRealmScreen(string outcome, Action<Utf8JsonWriter>? result = null)
    {
        if (_realmOpen is not { } open)
        {
            return;
        }

        result ??= CutShort(open);
        _realmOpen = null;
        LeaveDuel();
        LeaveSpellTable();
        _realmContent.Child = null;
        _realmBoards.Clear();
        _realmGearCards.Clear();
        ClearGearScreen();
        ShowRealmIdle();
        RealmBridge.Closed(open.Id, open.Screen, outcome, result);
    }

    /// <summary>What a screen hands back when it is closed before it was done with: a duel its log so far.</summary>
    private Action<Utf8JsonWriter>? CutShort(RealmCommand open) => open.Screen switch
    {
        "duel" => DuelLogResult(),
        _ => null,
    };

    private void ShowRealmIdle()
    {
        ShowRealmCard("Cantrip Realms", "Waiting for the overworld.");
    }

    /// <summary>The panel saying what a screen is waiting on, while it loads.</summary>
    private void ShowRealmLoading(string title, string waiting)
    {
        ShowRealmCard(title, waiting);
        _realmLoading = waiting;
    }

    /// <summary>A screen that cannot be shown, saying why, with a button that closes it as <paramref name="outcome"/>.</summary>
    private void ShowRealmProblem(string title, string problem, string outcome, Action<Utf8JsonWriter>? result = null)
    {
        ShowRealmCard(title, problem);
        var back = new DockButton("Back", primary: true, fontSize: 14);
        AutomationProperties.SetName(back, "Back");
        back.Clicked += () => CloseRealmScreen(outcome, result);
        _realmButtons.Children.Add(back);
    }

    private void ShowRealmCard(string title, string body)
    {
        _realmLoading = string.Empty;
        _realmPanel.Visibility = Visibility.Visible;
        _realmIdle.Visibility = Visibility.Visible;
        _realmScreen.Visibility = Visibility.Collapsed;
        _realmTitle.Text = title;
        _realmBody.Text = body;
        _realmButtons.Children.Clear();
    }

    /// <summary>A screen drawn in the panel: its title, and its body under the header.</summary>
    private void ShowRealmScreen(string title, FrameworkElement body)
    {
        _realmLoading = string.Empty;
        _realmPanel.Visibility = Visibility.Visible;
        _realmIdle.Visibility = Visibility.Collapsed;
        _realmScreen.Visibility = Visibility.Visible;
        _realmScreenTitle.Text = title;
        _realmContent.Child = body;
        _realmActions.Children.Clear();
        _realmFacts.Text = string.Empty;
        SayRealm(string.Empty);
    }

    /// <summary>A button in the screen's header, by what it says.</summary>
    private DockButton RealmAction(string caption, bool primary, Action clicked)
    {
        var button = new DockButton(caption, primary, fontSize: 14);
        AutomationProperties.SetName(button, caption);
        button.Clicked += clicked;
        _realmActions.Children.Add(button);
        return button;
    }

    /// <summary>How the last thing asked went, in the header: a refusal in the danger colour, anything else softly.</summary>
    private void SayRealm(string words, bool trouble = false)
    {
        _realmStatus.Text = words;
        _realmStatus.Foreground = Theme.Brush(trouble ? Theme.Danger : Theme.FgSoft);
    }

    /// <summary>Gold as the realm writes it: "1,200 gold".</summary>
    private static string Gold(long gold) => $"{gold.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)} gold";

    /// <summary>A string argument of a screen's, or null.</summary>
    private static string? Arg(JsonElement args, string name) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>What a screen was opened on, in words: its <c>name</c>, or failing that nothing.</summary>
    private static string Describe(JsonElement args) => Arg(args, "name") ?? string.Empty;
}
