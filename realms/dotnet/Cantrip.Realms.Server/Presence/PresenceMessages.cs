using MessagePack;

namespace Cantrip.Realms.Server.Presence;

// The presence protocol (realms/docs/interfaces.md, "Presence"): MessagePack, one message a WebSocket frame. Each frame is a
// union, [key, {Field: value, ...}] - the fields by name, as the overworld reads them - with the keys below. A hex is
// [q, r]; a time is Unix milliseconds on the server's clock.

/// <summary>What a client sends.</summary>
[Union(0, typeof(EnterMessage))]
[Union(1, typeof(MoveMessage))]
[Union(2, typeof(LookMessage))]
[Union(3, typeof(EmoteMessage))]
public abstract class PresenceClientMessage;

/// <summary>Enters a space - the world or an interior - the character's own, where they last reported standing (<c>/api/position</c>).</summary>
[MessagePackObject(true)]
public sealed class EnterMessage : PresenceClientMessage
{
    public string Space { get; set; } = string.Empty;
}

/// <summary>Walks a path: from a hex, through each hex of the path in turn, at a speed in hexes a second.</summary>
[MessagePackObject(true)]
public sealed class MoveMessage : PresenceClientMessage
{
    public int[] From { get; set; } = [];

    public int[][] Path { get; set; } = [];

    public double Speed { get; set; }
}

/// <summary>
/// How the character looks: a body (<c>lithe</c>, <c>broad</c>, <c>tall</c> or <c>stocky</c>), a skin and hair palette, and for
/// any of the loadout's slots the worn item's look - its gear mesh and its colors.
/// </summary>
[MessagePackObject(true)]
public sealed class LookMessage : PresenceClientMessage
{
    public string Body { get; set; } = string.Empty;

    public int Palette { get; set; }

    public Dictionary<string, SlotLook> Slots { get; set; } = [];
}

/// <summary>A worn item's look in one slot: its gear mesh and its palette (<c>"#rrggbb"</c> colors).</summary>
[MessagePackObject(true)]
public sealed class SlotLook
{
    public string Mesh { get; set; } = string.Empty;

    public List<string> Palette { get; set; } = [];
}

[MessagePackObject(true)]
public sealed class EmoteMessage : PresenceClientMessage
{
    public string Emote { get; set; } = string.Empty;
}

/// <summary>A look as others see it: as <see cref="LookMessage"/> has it.</summary>
[MessagePackObject(true)]
public sealed class LookView
{
    public string Body { get; set; } = string.Empty;

    public int Palette { get; set; }

    public Dictionary<string, SlotLook> Slots { get; set; } = [];
}

/// <summary>What the server sends.</summary>
[Union(0, typeof(WelcomeMessage))]
[Union(1, typeof(OtherMessage))]
[Union(2, typeof(MovedMessage))]
[Union(3, typeof(LookedMessage))]
[Union(4, typeof(EmotedMessage))]
[Union(5, typeof(LeftMessage))]
[Union(6, typeof(RefusedMessage))]
public abstract class PresenceServerMessage;

/// <summary>Entered: the layer of the world or the instance of the interior, and everyone else the player sees there.</summary>
[MessagePackObject(true)]
public sealed class WelcomeMessage : PresenceServerMessage
{
    public int Instance { get; set; }

    /// <summary>This connection's own number among the players (<see cref="OtherMessage.Player"/>).</summary>
    public int Player { get; set; }

    public List<OtherMessage> Others { get; set; } = [];
}

/// <summary>
/// Another player the player sees (in the world, of their layer within two chunks; in an interior, of their instance): a number for this connection (never their account), their name, identity and look, and
/// their walk - from <see cref="At"/> along <see cref="Path"/> at <see cref="Speed"/>, begun at <see cref="Since"/>.
/// </summary>
[MessagePackObject(true)]
public sealed class OtherMessage : PresenceServerMessage
{
    public int Player { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Identity { get; set; } = string.Empty;

    public LookView Look { get; set; } = new();

    public int[] At { get; set; } = [];

    public int[][] Path { get; set; } = [];

    public double Speed { get; set; }

    public long Since { get; set; }
}

[MessagePackObject(true)]
public sealed class MovedMessage : PresenceServerMessage
{
    public int Player { get; set; }

    public int[] From { get; set; } = [];

    public int[][] Path { get; set; } = [];

    public double Speed { get; set; }

    public long Since { get; set; }
}

[MessagePackObject(true)]
public sealed class LookedMessage : PresenceServerMessage
{
    public int Player { get; set; }

    public LookView Look { get; set; } = new();
}

[MessagePackObject(true)]
public sealed class EmotedMessage : PresenceServerMessage
{
    public int Player { get; set; }

    public string Emote { get; set; } = string.Empty;
}

[MessagePackObject(true)]
public sealed class LeftMessage : PresenceServerMessage
{
    public int Player { get; set; }
}

/// <summary>A message refused, why, and where the player truly is: a refused walk leaves them there.</summary>
[MessagePackObject(true)]
public sealed class RefusedMessage : PresenceServerMessage
{
    public string Reason { get; set; } = string.Empty;

    public int[] At { get; set; } = [];
}
