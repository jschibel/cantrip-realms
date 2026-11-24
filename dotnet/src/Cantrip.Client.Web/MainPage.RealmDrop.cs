using System.Text.Json;
using Microsoft.UI.Xaml.Automation;

namespace Cantrip.Client.Web;

/// <summary>
/// A gear item found (design.md A3, A4): what a won duel dropped, or a chest held, shown on the <c>loot</c> screen as the
/// Vanguard-style oversized card it is in a duel, beside what it is and a button to wear it at once. The item is the
/// character's already (the server added it when the duel was won or the chest opened); the loot screen's <c>gear</c>
/// argument is that <c>GearInstance</c>.
/// </summary>
public sealed partial class MainPage
{
    private const float GearDropWidth = 250f;

    /// <summary>The found item's panel for the loot screen, or null when nothing was found.</summary>
    private FrameworkElement? GearDrop(JsonElement args)
    {
        RealmGearInstance? found = null;
        try
        {
            if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("gear", out JsonElement gear) && gear.ValueKind == JsonValueKind.Object)
            {
                found = gear.Deserialize(RealmJson.Default.RealmGearInstance);
            }
        }
        catch (JsonException)
        {
        }

        if (found is null)
        {
            return null;
        }

        RealmGear item = found.Gear;
        var card = new GearCardElement(Spec(item), "drop", found.InstanceId, GearDropWidth);
        _realmGearCards.Add(card);

        bool chest = Arg(args, "source") == "chest";
        string from = chest ? "In the chest" : $"{Arg(args, "mob") ?? "The mob"} dropped";
        var words = new StackPanel { Spacing = 8, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 380 };
        words.Children.Add(new TextBlock { Text = "Gear found", FontSize = 13, Foreground = Theme.Brush(Theme.Accent), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        words.Children.Add(new TextBlock { Text = item.Name, FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(GearLook.RarityText(item.Rarity)), TextWrapping = TextWrapping.WrapWholeWords });
        words.Children.Add(new TextBlock
        {
            Text = $"{from} {Article(item)} {RarityName(item).ToLowerInvariant()} {(item.Slot == "ring" ? "ring" : $"{item.Slot} item")}. It is in your gear now.",
            FontSize = 14,
            Foreground = Theme.Brush(Theme.FgSoft),
            TextWrapping = TextWrapping.WrapWholeWords,
        });
        if (GearStatLine(item.Stats) is { Length: > 0 } stats)
        {
            words.Children.Add(new TextBlock { Text = stats, FontSize = 15, Foreground = Theme.Brush(Theme.Accent), TextWrapping = TextWrapping.WrapWholeWords });
        }

        if (GearEffects(item) is { Length: > 0 } effects)
        {
            words.Children.Add(new TextBlock { Text = effects, FontSize = 14, Foreground = Theme.Brush(Theme.Fg), TextWrapping = TextWrapping.WrapWholeWords });
        }

        var wear = new DockButton("Wear it now", primary: false, fontSize: 14) { HorizontalAlignment = HorizontalAlignment.Left };
        AutomationProperties.SetName(wear, "Wear it now");
        wear.Clicked += () => _ = WearFoundAsync(found, wear);
        words.Children.Add(wear);

        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 22, Children = { card, words } };
        return new Border
        {
            Background = Theme.Brush(Theme.Panel),
            BorderBrush = new SolidColorBrush(GearLook.RarityText(item.Rarity)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(16),
            Margin = new Thickness(0, 0, 0, 10),
            HorizontalAlignment = HorizontalAlignment.Left,
            Child = panel,
        };
    }

    private static string Article(RealmGear gear) => RarityName(gear).ToLowerInvariant()[0] is 'a' or 'e' or 'i' or 'o' or 'u' ? "an" : "a";

    /// <summary>Wears the item found in its slot (a ring on a free hand, else the right), through <c>PUT /api/loadout</c>.</summary>
    private async Task WearFoundAsync(RealmGearInstance found, DockButton button)
    {
        RealmCommand? open = _realmOpen;
        button.Enabled = false;
        RealmReply<RealmCharacter> me = await RealmApi.GetAsync("me", RealmJson.Default.RealmCharacter);
        string slot = found.Gear.Slot;
        if (slot == "ring")
        {
            slot = me.Value?.Loadout.GetValueOrDefault("ring1") is null ? "ring1" : me.Value?.Loadout.GetValueOrDefault("ring2") is null ? "ring2" : "ring1";
        }

        RealmReply<RealmCharacter> worn = await RealmApi.CallAsync(HttpMethod.Put, "loadout", new RealmLoadoutChange(new Dictionary<string, long?> { [slot] = found.InstanceId }), RealmJson.Default.RealmLoadoutChange, RealmJson.Default.RealmCharacter);
        if (open is null || !StillOpen(open))
        {
            return;
        }

        if (worn.Ok)
        {
            button.Caption = "Worn";
            SayRealm($"You wear {found.Gear.Name}.");
        }
        else
        {
            button.Enabled = true;
            SayRealm(worn.Words, trouble: true);
        }
    }
}
