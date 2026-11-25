namespace Cantrip.Client.Web;

/// <summary>
/// The realm's <c>loot</c> screen (realms/docs/interfaces.md, "The card layer"; design.md A3): the gear item a won duel
/// dropped or a chest held (<c>gear</c>, MainPage.RealmDrop.cs), already the character's, with a button to wear it. A win
/// pays gold and gear alone, so there is nothing else to take; Done closes it.
/// </summary>
public sealed partial class MainPage
{
    private async Task OpenLootAsync(RealmCommand command)
    {
        ShowRealmLoading("Gear found", "Loading the gear...");
        await EnsureRealmCatalogAsync();
        if (!StillOpen(command))
        {
            return;
        }

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(GearDrop(command.Args) ?? new TextBlock
        {
            Text = $"{Arg(command.Args, "mob") ?? "It"} left nothing.",
            FontSize = 14,
            Foreground = Theme.Brush(Theme.FgSoft),
        });
        ShowRealmScreen("Gear found", RealmScroll(body));
        RealmAction("Done", primary: true, () => CloseRealmScreen("closed"));
    }
}
