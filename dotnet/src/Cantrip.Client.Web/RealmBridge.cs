using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json;

namespace Cantrip.Client.Web;

/// <summary>
/// A request from Cantrip Realms' overworld: <c>open</c> a card screen, or <c>close</c> the one open; or its answer to this
/// page's own question, a <c>portrait</c> (<see cref="RealmBridge.AskPortrait"/>).
/// </summary>
/// <param name="Op">What is asked: <c>open</c> or <c>close</c>; or <c>portrait</c>, answered.</param>
/// <param name="Id">The overworld's number for the request, echoed in the answer when the screen closes.</param>
/// <param name="Screen">The screen to open: <c>duel</c>, <c>spell-table</c>, <c>vendor</c>, <c>loot</c>, <c>gear</c>.</param>
/// <param name="Args">What the screen is opened on, as the overworld sent it.</param>
public sealed record RealmCommand(string Op, int Id, string Screen, JsonElement Args);

/// <summary>
/// The realm page's side of Realm.js: what the overworld that framed this page asked for since the last read, and the
/// answers sent back to it. Read on a timer, as <see cref="KeyboardBridge"/> is, rather than called from JavaScript.
/// </summary>
public static partial class RealmBridge
{
    [JSImport("globalThis.cantripRealmTake")]
    private static partial string TakeMessages();

    [JSImport("globalThis.cantripRealmPost")]
    private static partial void PostMessage(string json);

    /// <summary>Every request heard since the last call, oldest first; a malformed one is left out.</summary>
    public static IEnumerable<RealmCommand> Take()
    {
        string taken;
        try
        {
            taken = TakeMessages();
        }
        catch (JSException)
        {
            yield break;
        }

        foreach (string line in taken.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            RealmCommand? command;
            try
            {
                using JsonDocument document = JsonDocument.Parse(line);
                JsonElement root = document.RootElement;
                command = new RealmCommand(
                    root.TryGetProperty("op", out JsonElement op) ? op.GetString() ?? string.Empty : string.Empty,
                    root.TryGetProperty("id", out JsonElement id) && id.TryGetInt32(out int number) ? number : 0,
                    root.TryGetProperty("screen", out JsonElement screen) ? screen.GetString() ?? string.Empty : string.Empty,
                    root.TryGetProperty("args", out JsonElement args) ? args.Clone() : default);
            }
            catch (JsonException)
            {
                command = null;
            }

            if (command is not null)
            {
                yield return command;
            }
        }
    }

    /// <summary>Tells the overworld this page is up and listening.</summary>
    public static void Ready() => Post(writer => writer.WriteString("op", "ready"));

    /// <summary>
    /// Tells the overworld the screen it opened with request <paramref name="id"/> has closed, and how; with what the screen
    /// hands back as <c>result</c> when <paramref name="result"/> writes it (its properties, into the result's object).
    /// </summary>
    public static void Closed(int id, string screen, string outcome, Action<Utf8JsonWriter>? result = null) => Post(writer =>
    {
        writer.WriteString("op", "closed");
        writer.WriteNumber("id", id);
        writer.WriteString("screen", screen);
        writer.WriteString("outcome", outcome);
        if (result is not null)
        {
            writer.WriteStartObject("result");
            result(writer);
            writer.WriteEndObject();
        }
    });

    /// <summary>
    /// Asks the overworld for a picture of the character wearing <paramref name="slots"/> (each worn slot's look): it answers
    /// <c>{op: "portrait", id, args: {image}}</c>, a PNG data URL, which <see cref="Take"/> hands on like any request.
    /// </summary>
    public static void AskPortrait(int id, IEnumerable<(string Slot, RealmLook Look)> slots) => Post(writer =>
    {
        writer.WriteString("op", "portrait");
        writer.WriteNumber("id", id);
        writer.WriteStartObject("slots");
        foreach ((string slot, RealmLook look) in slots)
        {
            writer.WriteStartObject(slot);
            writer.WriteString("mesh", look.Mesh);
            writer.WriteStartArray("palette");
            foreach (string color in look.Palette)
            {
                writer.WriteStringValue(color);
            }

            writer.WriteEndArray();
            writer.WriteEndObject();
        }

        writer.WriteEndObject();
    });

    private static void Post(Action<Utf8JsonWriter> write)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            write(writer);
            writer.WriteEndObject();
        }

        try
        {
            PostMessage(Encoding.UTF8.GetString(buffer.ToArray()));
        }
        catch (JSException)
        {
            // A page not framed by the overworld has no one to tell.
        }
    }
}
