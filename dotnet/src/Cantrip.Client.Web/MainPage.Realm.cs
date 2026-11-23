using System.Text.Json;

namespace Cantrip.Client.Web;

/// <summary>
/// Cantrip Realms' card layer (<c>?realm</c>): this page framed over the realm's overworld, joining no table of its own.
/// The overworld asks for a card screen through <see cref="RealmBridge"/> and this page shows it over everything, then
/// says how it closed. Each screen is filled in by its own milestone (realms/docs/tech.md); until then a screen is a
/// panel that names what it was opened on and closes with each outcome the overworld must handle.
/// </summary>
public sealed partial class MainPage
{
    private readonly Grid _realmPanel = new()
    {
        Background = Theme.Brush(Theme.Window),
        Visibility = Visibility.Collapsed,
    };

    private readonly DispatcherTimer _realmTicker = new() { Interval = TimeSpan.FromMilliseconds(50) };
    private readonly TextBlock _realmTitle = new() { FontSize = 22, Foreground = Theme.Brush(Theme.Accent), TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _realmBody = new() { FontSize = 14, Foreground = Theme.Brush(Theme.FgSoft), TextWrapping = TextWrapping.Wrap };
    private readonly StackPanel _realmButtons = new() { Orientation = Orientation.Horizontal, Spacing = 8 };

    /// <summary>The request whose screen is open, or null with none open.</summary>
    private RealmCommand? _realmOpen;

    private void BuildRealmLayer()
    {
        var card = new Border
        {
            Background = Theme.Brush(Theme.Panel),
            BorderBrush = Theme.Brush(Theme.Line),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(24, 20, 24, 20),
            MaxWidth = 520,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new StackPanel { Spacing = 14, Children = { _realmTitle, _realmBody, _realmButtons } },
        };

        _realmPanel.Children.Add(card);
        Grid.SetRowSpan(_realmPanel, 3);
        Grid.SetColumnSpan(_realmPanel, 2);
        Root.Children.Add(_realmPanel);
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
            }
        }
    }

    private void OpenRealmScreen(RealmCommand command)
    {
        _realmOpen = command;
        _realmButtons.Children.Clear();
        string on = Describe(command.Args);
        switch (command.Screen)
        {
            case "duel":
                _realmTitle.Text = "Duel";
                _realmBody.Text = $"A duel against {on}.";
                AddRealmButton("Win", primary: true, "won");
                AddRealmButton("Lose", primary: false, "lost");
                break;
            default:
                _realmTitle.Text = command.Screen switch
                {
                    "spell-table" => "Spell table",
                    "vendor" => "Vendor",
                    "loot" => "Loot",
                    "gear" => "Gear",
                    _ => command.Screen,
                };
                _realmBody.Text = on.Length > 0 ? on : "Opened from the overworld.";
                AddRealmButton("Close", primary: true, "closed");
                break;
        }
    }

    private void AddRealmButton(string caption, bool primary, string outcome)
    {
        var button = new DockButton(caption, primary, fontSize: 14);
        button.Clicked += () => CloseRealmScreen(outcome);
        _realmButtons.Children.Add(button);
    }

    private void CloseRealmScreen(string outcome)
    {
        if (_realmOpen is not { } open)
        {
            return;
        }

        _realmOpen = null;
        ShowRealmIdle();
        RealmBridge.Closed(open.Id, open.Screen, outcome);
    }

    private void ShowRealmIdle()
    {
        _realmTitle.Text = "Cantrip Realms";
        _realmBody.Text = "Waiting for the overworld.";
        _realmButtons.Children.Clear();
    }

    /// <summary>What a screen was opened on, in words: its <c>name</c>, or failing that nothing.</summary>
    private static string Describe(JsonElement args) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty("name", out JsonElement name) && name.ValueKind == JsonValueKind.String
            ? name.GetString() ?? string.Empty
            : string.Empty;
}
