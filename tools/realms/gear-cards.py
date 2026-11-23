"""Cantrip Realms' gear in the engine (realms/docs/gear.md): every gear item's emblem, written as a card file of the card
crate, from the item's content file.

    python tools/realms/gear-cards.py            # write everything below from realms/content/gear/*.json
    python tools/realms/gear-cards.py --check    # write nothing; exit 1 if any of it is out of date or an item is invalid
    python tools/realms/gear-cards.py --smoke-cases DIR   # the smoke scenario of each FAMILY_CASES emblem, into DIR, to run
                                                          # with corpus --file: every family's template tried, worn or not

Writes:
    crates/cantrip-cards/src/cards/realm_gear_<item>.rs    one per item with effects: its emblem, "<name> (gear)", typeless,
                                                           its abilities its effect families' in the file's order
    crates/cantrip-cards/src/cards/realm_gear_families.rs  the emblems the families' own scenarios deal: each family over
                                                           its parameter range (FAMILY_CASES below)
    scenarios/realm-gear-item-<item>.cantrip                one per item with effects: deals its emblem and sees its first
                                                           effect act
and rewrites each item's `text` (its stat lines, then its effects' texts) where it differs.

The families themselves are `crates/cantrip-cards/src/cards/realm_gear.rs`; this file knows each one's text, parameters,
slots and points (gear.md's table) and how to call it. An item is refused - the run fails and writes nothing - if an
effect names no family, a parameter is out of its range, a family is not one its slot may carry, or its points (stats and
effects, refunds subtracted) are over its rarity's budget.

The card crate's build script (upstream) takes every file in its `src/cards`; these are new files only, so a merge from
upstream never meets them.
"""

import glob
import json
import math
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
GEAR = os.path.join(ROOT, "realms", "content", "gear")
CARDS = os.path.join(ROOT, "crates", "cantrip-cards", "src", "cards")
SCENARIOS = os.path.join(ROOT, "scenarios")

ORDINALS = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth"}
WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six"}
BUDGETS = {"common": 3, "uncommon": 5, "rare": 8, "mythic": 12}
UNIQUE_BUDGET = 14

# The tokens token-on-turn may make: realm_gear.rs's TOKENS index, the shared definition, its text, its points and the
# name the engine gives it (CR 111.4).
TOKENS = {
    "soldier": (0, "SOLDIER", "a 1/1 white Soldier creature token", 2, "Soldier Token"),
    "goblin": (1, "GOBLIN", "a 1/1 red Goblin creature token", 2, "Goblin Token"),
    "elf-warrior": (2, "ELF_WARRIOR", "a 1/1 green Elf Warrior creature token", 2, "Elf Warrior Token"),
    "spirit": (3, "WHITE_FLYING_SPIRIT", "a 1/1 white Spirit creature token with flying", 3, "Spirit Token"),
    "thopter": (4, "THOPTER", "a 1/1 colorless Thopter artifact creature token with flying", 3, "Thopter Token"),
}
# mana-on-turn's M: realm_gear.rs's Mana::ALL index and amount.
MANA = {"{W}": (0, 1), "{U}": (1, 1), "{B}": (2, 1), "{R}": (3, 1), "{G}": (4, 1), "{C}": (5, 1), "{C}{C}": (5, 2)}


class Invalid(Exception):
    pass


def number(effect, key, low, high):
    value = effect.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise Invalid(f"{effect['family']}: '{key}' is a whole number from {low} to {high}, not {value!r}")
    return value


def cards(n):
    return "a card" if n == 1 else f"{WORDS[n]} cards"


def counters(n):
    return "a +1/+1 counter" if n == 1 else f"{WORDS[n]} +1/+1 counters"


def upkeep(n):
    return f"At the beginning of your upkeep, if it's your {ORDINALS[n]} turn, "


def opponents_upkeep(n):
    return f"At the beginning of each opponent's upkeep, if it's that player's {ORDINALS[n]} turn, "


FIRST_CREATURE = "Whenever a creature you control enters, if it's the first creature to enter the battlefield under your control this game, "


def family(effect):
    """An effect line as the engine has it: (its text, its points, the Rust that makes it, the slots it may be in, what its
    item's emblem lists besides it, and its parameters for the smoke scenario)."""
    name = effect.get("family")
    if name == "draw-on-turn":
        n, k = number(effect, "turn", 2, 6), number(effect, "count", 1, 2)
        return (f"At the beginning of your draw step, if it's your {ORDINALS[n]} turn, draw {cards(k)}.", 3 * k + (1 if n <= 3 else 0),
                f"gear::draw_on_turn::<{n}, {k}>", {"head"}, {}, (n, k))
    if name in ("scry-on-turn", "surveil-on-turn"):
        n, k = number(effect, "turn", 1, 6), number(effect, "count", 1, 3)
        verb = name.split("-")[0]
        return (f"{upkeep(n)}{verb} {k}.", math.ceil(k / 2), f"gear::{verb}_on_turn::<{n}, {k}>", {"head"}, {}, (n, k))
    if name == "mana-on-turn":
        n = number(effect, "turn", 1, 4)
        mana = effect.get("mana")
        if mana not in MANA:
            raise Invalid(f"mana-on-turn: 'mana' is one of {', '.join(MANA)}, not {mana!r}")
        index, amount = MANA[mana]
        return (f"At the beginning of your precombat main phase, if it's your {ORDINALS[n]} turn, add {mana}.", 3 * amount + (1 if n == 1 else 0),
                f"gear::mana_on_turn::<{n}, {index}, {amount}>", {"neck", "ring"}, {}, (n, mana))
    if name == "extra-land-on-turn":
        n = number(effect, "turn", 1, 3)
        return (f"{upkeep(n)}you may play an additional land this turn.", 3, f"gear::extra_land_on_turn::<{n}>", {"feet"}, {}, (n,))
    if name == "first-creature-haste":
        return (f"{FIRST_CREATURE}it gains haste until end of turn.", 3, "gear::first_creature_haste", {"feet"}, {}, ())
    if name == "counters-first-creature":
        k = number(effect, "count", 1, 2)
        return (f"{FIRST_CREATURE}put {counters(k)} on it.", 2 * k, f"gear::counters_first_creature::<{k}>", {"hands"}, {}, (k,))
    if name == "token-on-turn":
        n = number(effect, "turn", 1, 4)
        token = effect.get("token")
        if token not in TOKENS:
            raise Invalid(f"token-on-turn: 'token' is one of {', '.join(TOKENS)}, not {token!r}")
        index, static, text, points, _ = TOKENS[token]
        return (f"{upkeep(n)}create {text}.", points, f"gear::token_on_turn::<{n}, {index}>", {"hands", "relic"},
                {"extra": f"&tokens::{static}"}, (n, token))
    if name == "gain-life-on-turn":
        n, k = number(effect, "turn", 2, 6), number(effect, "count", 2, 5)
        return (f"{upkeep(n)}you gain {k} life.", math.ceil(k / 2), f"gear::gain_life_on_turn::<{n}, {k}>", {"body"}, {}, (n, k))
    if name == "prevent-damage-on-turn":
        n = number(effect, "turn", 1, 3)
        return (f"{upkeep(n)}prevent all damage that would be dealt to you this turn.", 3, f"gear::prevent_damage_on_turn::<{n}>", {"body"},
                {"prevention": True}, (n,))
    if name == "opponent-discards-on-turn":
        n = number(effect, "turn", 2, 4)
        return (f"{opponents_upkeep(n)}that player discards a card.", 4, f"gear::opponent_discards_on_turn::<{n}>", {"ring", "relic"}, {}, (n,))
    if name == "opponent-mills-on-turn":
        n, k = number(effect, "turn", 1, 4), number(effect, "count", 2, 4)
        return (f"{opponents_upkeep(n)}that player mills {cards(k)}.", math.ceil(k / 2), f"gear::opponent_mills_on_turn::<{n}, {k}>", {"ring"},
                {}, (n, k))
    raise Invalid(f"'{name}' is no effect family the engine has (realms/docs/gear.md)")


def stat_lines(stats):
    """The stat lines' text and points (gear.md, "Stats"): starting life, starting hand size, maximum hand size."""
    lines, points = [], 0
    life, hand, maximum = stats.get("life", 0), stats.get("hand", 0), stats.get("maxHand", 0)
    if life:
        lines.append(f"You start the game with {abs(life)} {'additional' if life > 0 else 'less'} life.")
        points += life
    if hand:
        many = abs(hand)
        what = ("an additional card" if many == 1 else f"{WORDS[many]} additional cards") if hand > 0 else ("one fewer card" if many == 1 else f"{WORDS[many]} fewer cards")
        lines.append(f"You draw {what} for your opening hand.")
        points += 6 * hand
    if maximum:
        lines.append(f"Your maximum hand size is {'increased' if maximum > 0 else 'reduced'} by {WORDS[abs(maximum)]}.")
        points += 2 * maximum
    return lines, points


def rust_string(text):
    return json.dumps(text, ensure_ascii=False)


def emblem_file(source, name, effects):
    """A card file holding one emblem, `name`, with an ability per effect."""
    abilities = "".join(f"\n        {make}({rust_string(text)})," for text, _, make, _, _, _ in effects)
    extras = sorted({e[4]["extra"] for e in effects if "extra" in e[4]})
    prevention = any(e[4].get("prevention") for e in effects)
    uses = ["use cantrip_api::*;"]
    if extras:
        uses.append("use cantrip_mechanics::tokens;")
    uses.append("use crate::realm_gear as gear;")
    body = [
        f"//! Generated by tools/realms/gear-cards.py from {source}: never edited by hand. Cantrip Realms' gear (realms/docs/gear.md).",
        "",
        *uses,
        "",
        "static EMBLEM: CardDef = CardDef {",
        f"    name: {rust_string(name)},",
        "    has_cost: false,",
        f"    abilities: &[{abilities}\n    ],",
    ]
    if prevention:
        body.append("    granted_preventions: &[gear::PREVENTION],")
    body += [
        f"    text: {rust_string(chr(10).join(e[0] for e in effects))},",
        "    ..CardDef::BLANK",
        "};",
        "",
        f"pub static EXTRA: &[&CardDef] = &[&EMBLEM{''.join(', ' + x for x in extras)}];",
        "",
    ]
    return "\n".join(body)


# The emblems the families' scenarios deal (scenarios/realm-gear-<family>-*.cantrip): each family at the ends of its
# parameter ranges and between, named for what they are.
FAMILY_CASES = [
    {"family": "draw-on-turn", "turn": 2, "count": 1},
    {"family": "draw-on-turn", "turn": 6, "count": 2},
    {"family": "scry-on-turn", "turn": 1, "count": 3},
    {"family": "scry-on-turn", "turn": 6, "count": 1},
    {"family": "scry-on-turn", "turn": 2, "count": 2},
    {"family": "surveil-on-turn", "turn": 1, "count": 1},
    {"family": "surveil-on-turn", "turn": 6, "count": 3},
    {"family": "mana-on-turn", "turn": 1, "mana": "{W}"},
    {"family": "mana-on-turn", "turn": 2, "mana": "{U}"},
    {"family": "mana-on-turn", "turn": 3, "mana": "{B}"},
    {"family": "mana-on-turn", "turn": 4, "mana": "{R}"},
    {"family": "mana-on-turn", "turn": 1, "mana": "{G}"},
    {"family": "mana-on-turn", "turn": 2, "mana": "{C}"},
    {"family": "mana-on-turn", "turn": 3, "mana": "{C}{C}"},
    {"family": "extra-land-on-turn", "turn": 1},
    {"family": "extra-land-on-turn", "turn": 3},
    {"family": "first-creature-haste"},
    {"family": "counters-first-creature", "count": 1},
    {"family": "counters-first-creature", "count": 2},
    {"family": "token-on-turn", "turn": 1, "token": "soldier"},
    {"family": "token-on-turn", "turn": 2, "token": "goblin"},
    {"family": "token-on-turn", "turn": 3, "token": "elf-warrior"},
    {"family": "token-on-turn", "turn": 4, "token": "spirit"},
    {"family": "token-on-turn", "turn": 1, "token": "thopter"},
    {"family": "gain-life-on-turn", "turn": 2, "count": 2},
    {"family": "gain-life-on-turn", "turn": 6, "count": 5},
    {"family": "prevent-damage-on-turn", "turn": 1},
    {"family": "prevent-damage-on-turn", "turn": 3},
    {"family": "opponent-discards-on-turn", "turn": 2},
    {"family": "opponent-discards-on-turn", "turn": 4},
    {"family": "opponent-mills-on-turn", "turn": 1, "count": 2},
    {"family": "opponent-mills-on-turn", "turn": 4, "count": 4},
]


def case_name(case):
    parts = [f"{k} {v}" for k, v in case.items() if k != "family"]
    return f"Gear test: {', '.join([case['family'], *parts])}"


def families_file():
    entries = []
    names = []
    for i, case in enumerate(FAMILY_CASES):
        effect = family(case)
        name = case_name(case)
        names.append(f"&E{i}")
        extra = "\n    granted_preventions: &[gear::PREVENTION]," if effect[4].get("prevention") else ""
        entries.append(
            f"static E{i}: CardDef = CardDef {{\n    name: {rust_string(name)},\n    has_cost: false,\n"
            f"    abilities: &[{effect[2]}({rust_string(effect[0])})],{extra}\n    text: {rust_string(effect[0])},\n    ..CardDef::BLANK\n}};\n"
        )
    tokens = sorted({f"&tokens::{t[1]}" for t in TOKENS.values()})
    return "\n".join([
        "//! Generated by tools/realms/gear-cards.py (FAMILY_CASES): never edited by hand. The emblems the gear families' own",
        "//! scenarios deal (scenarios/realm-gear-*.cantrip), each family of crates/cantrip-cards/src/cards/realm_gear.rs over its",
        "//! parameter range, named for what each is. No item wears them: a realm duel deals only its seats' worn items' emblems.",
        "",
        "use cantrip_api::*;",
        "use cantrip_mechanics::tokens;",
        "use crate::realm_gear as gear;",
        "",
        *entries,
        f"pub static EXTRA: &[&CardDef] = &[{', '.join(names + tokens)}];",
        "",
    ])


def smoke_scenario(item, name, effect):
    """A scenario that deals the item's emblem, with its stat lines, to Bot1 and sees its first effect act."""
    stats = item["stats"]
    life, hand, maximum = 20 + stats.get("life", 0), 7 + stats.get("hand", 0), 7 + stats.get("maxHand", 0)
    fam = item["effects"][0]["family"]
    params = effect[5]
    bot1, bot2 = ["Forest x40"], ["Island x40"]
    actions, expect = [f"? Bot1.Emblems = {name}"], [f"Bot1.Emblems = {name}"]

    def hand_at(n):
        # Bot1's hand in the main phase of its nth turn: it plays first, so draws from its second turn on, and discards
        # to its maximum hand size in each cleanup step (the runner's default answers play nothing).
        h = hand
        for turn in range(1, n + 1):
            if turn >= 2:
                h += 1
            if turn < n:
                h = min(h, maximum)
        return h

    if fam == "draw-on-turn":
        n, k = params
        actions += [f"[T{2 * n - 3} Bot1.Main1]", f"? Bot1.Hand.Count = {hand_at(n - 1)}", f"[T{2 * n - 1} Bot1.Main1]", f"? Bot1.Hand.Count = {hand_at(n) + k}"]
        what = f"at the beginning of Bot1's draw step on its {ORDINALS[n]} turn it draws {cards(k)} more"
    elif fam in ("scry-on-turn", "surveil-on-turn"):
        n, k = params
        before = hand + max(0, n - 2)
        bot1 = [f"Forest x{before}", f"Island x{k}", "Forest x30"]
        islands = "; ".join(["Island"] * k)
        if fam == "scry-on-turn":
            actions += [f"[T{2 * n - 1} Bot1.Upkeep]", f"Bot1.Arrange(| {islands})", f"[T{2 * n - 1} Bot1.Main1]"]
            what = f"at the beginning of Bot1's upkeep on its {ORDINALS[n]} turn it scries {k}, the Islands put on the bottom"
        else:
            actions += [f"[T{2 * n - 1} Bot1.Upkeep]", f"Bot1.Arrange(| {islands})", f"[T{2 * n - 1} Bot1.Main1]", f"? Bot1.Surveilled = {k} requested, {k} looked"]
            what = f"at the beginning of Bot1's upkeep on its {ORDINALS[n]} turn it surveils {k}, the Islands put into its graveyard"
        # The card drawn after the upkeep, if any, is a Forest from under the Islands moved away.
        expect.append(f"Bot1.Hand = {'; '.join(['Forest'] * hand_at(n))}")
    elif fam == "mana-on-turn":
        n, mana = params
        actions += [f"[T{2 * n - 1} Bot1.Main1]", f"? Stack = {name}", "Bot1.Pass", "Bot2.Pass", f"? Bot1.Mana = {mana}"]
        what = f"at the beginning of Bot1's precombat main phase on its {ORDINALS[n]} turn it adds {mana}"
    elif fam == "extra-land-on-turn":
        (n,) = params
        actions += [f"[T{2 * n - 1} Bot1.Main1]", "Bot1.Hand.Forest.Play", "Bot1.Hand.Forest.Play", "! Bot1.Hand.Forest.Play"]
        expect.append("Bot1.LandsPlayed = 2")
        what = f"on its {ORDINALS[n]} turn Bot1 plays two lands, and no third"
    elif fam in ("first-creature-haste", "counters-first-creature"):
        bot1 = ["Forest", "Llanowar Elves", "Forest x38"]
        actions += ["Bot1.Hand.Forest.Play", "Bot1.Hand.Llanowar Elves.Cast", "Bot1.Battlefield.Forest.Activate"]
        if fam == "first-creature-haste":
            actions += ["Bot1.Attack(Llanowar Elves > Bot2)", "[T1 Bot1.Main2]"]
            expect.append("Bot2.Life = 19")
            what = "Bot1's first creature, Llanowar Elves cast on turn one, gains haste and attacks"
        else:
            (k,) = params
            actions += ["[T1 Bot1.Main2]"]
            expect.append(f"Bot1.Battlefield.Llanowar Elves.Counters.PlusOnePlusOne = {k}")
            what = f"Bot1's first creature, Llanowar Elves, gets {counters(k)}"
    elif fam == "token-on-turn":
        n, token = params
        actions += [f"[T{2 * n - 1} Bot1.Main1]"]
        expect.append(f"Bot1.Battlefield = {TOKENS[token][4]}")
        what = f"at the beginning of Bot1's upkeep on its {ORDINALS[n]} turn it creates {TOKENS[token][2]}"
    elif fam == "gain-life-on-turn":
        n, k = params
        actions += [f"[T{2 * n - 1} Bot1.Main1]"]
        expect.append(f"Bot1.Life = {life + k}")
        what = f"at the beginning of Bot1's upkeep on its {ORDINALS[n]} turn it gains {k} life"
    elif fam == "prevent-damage-on-turn":
        (n,) = params
        bot1 = ["Mountain", "Lightning Bolt", "Mountain x38"]
        actions += [f"[T{2 * n - 1} Bot1.Main1]", "Bot1.Hand.Mountain.Play", "Bot1.Hand.Lightning Bolt.Cast(Bot1)", "Bot1.Battlefield.Mountain.Activate"]
        expect += [f"Bot1.Life = {life}", "Prevented.Count = 1"]
        what = f"on its {ORDINALS[n]} turn Bot1's own Lightning Bolt at it is prevented"
    elif fam == "opponent-discards-on-turn":
        (n,) = params
        actions += [f"[T{2 * n} Bot2.Main1]"]
        expect += ["Bot2.Graveyard = Island", f"Bot2.Hand.Count = {7 + n - 1}"]
        what = f"at the beginning of Bot2's upkeep on its {ORDINALS[n]} turn it discards a card"
    elif fam == "opponent-mills-on-turn":
        n, k = params
        actions += [f"[T{2 * n} Bot2.Main1]"]
        expect += [f"Bot2.Graveyard.Count = {k}", f"Bot2.Library.Count = {40 - 7 - n - k}"]
        what = f"at the beginning of Bot2's upkeep on its {ORDINALS[n]} turn it mills {cards(k)}"
    else:  # pragma: no cover - family() refused it already
        raise Invalid(fam)
    variant = f"Bot1: life {life}; hand {hand}; maximum {maximum}; emblem {name}"
    return "\n".join([
        f"# Generated by tools/realms/gear-cards.py from realms/content/gear/{item['id']}.json: never edited by hand.",
        f"# {item['name']} (realms/docs/gear.md): Bot1 wears it, beginning the game with its stat lines' start and its emblem",
        "# in its command zone (CR 902.3, 114.4), and its first effect acts:",
        f"# {what}.",
        "# Bot2's maximum hand size is out of the way of its counts.",
        "",
        "[Bot1 Deck]", *bot1, "", "[Bot2 Deck]", *bot2, "",
        "[Variant]", variant, "Bot2: maximum 20", "",
        "[Actions]", *actions, "", "[Expect]", *expect, "",
    ])


def build():
    """Every file this writes, by path, and the items whose `text` changes; raises Invalid on a bad item."""
    out, texts, problems, emblems = {}, {}, [], set()
    for path in sorted(glob.glob(os.path.join(GEAR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            item = json.load(f)
        source = f"realms/content/gear/{os.path.basename(path)}"
        try:
            effects = [family(effect) for effect in item.get("effects", [])]
            for effect, line in zip(effects, item.get("effects", [])):
                if item["slot"] not in effect[3]:
                    raise Invalid(f"{line['family']} is not for a {item['slot']} item (it fits {', '.join(sorted(effect[3]))})")
            lines, points = stat_lines(item.get("stats", {}))
            points += sum(e[1] for e in effects)
            if item.get("unique"):
                budget = UNIQUE_BUDGET
                # gear.md: "a negative stat, or an opponent-favoring effect" - no family favors an opponent yet.
                if not any(v < 0 for v in item.get("stats", {}).values()):
                    raise Invalid("a unique item carries a drawback line (a negative stat)")
            else:
                budget = BUDGETS.get(item["rarity"])
                if budget is None:
                    raise Invalid(f"rarity '{item['rarity']}' has no budget")
            if points > budget:
                raise Invalid(f"{points} points is over the {item['rarity']}{' unique' if item.get('unique') else ''} budget of {budget}")
        except Invalid as problem:
            problems.append(f"{source}: {problem}")
            continue
        text = "\n".join(lines + [e[0] for e in effects])
        if item.get("text") != text:
            texts[path] = text
        if effects:
            name = f"{item['name']} (gear)"
            emblems.add(name)
            stem = item["id"].replace("-", "_")
            out[os.path.join(CARDS, f"realm_gear_{stem}.rs")] = emblem_file(source, name, effects)
            out[os.path.join(SCENARIOS, f"realm-gear-item-{item['id']}.cantrip")] = smoke_scenario(item, name, effects[0])
    if problems:
        raise Invalid("\n".join(problems))
    out[os.path.join(CARDS, "realm_gear_families.rs")] = families_file()
    stale = [p for p in glob.glob(os.path.join(CARDS, "realm_gear_*.rs")) + glob.glob(os.path.join(SCENARIOS, "realm-gear-item-*.cantrip")) if p not in out]
    return out, texts, stale


def smoke_cases(folder):
    """An item's smoke scenario for each of the families' test emblems, as though an item wore it alone."""
    os.makedirs(folder, exist_ok=True)
    for i, case in enumerate(FAMILY_CASES):
        name = case_name(case)
        item = {"id": f"case-{i}", "name": name, "stats": {}, "effects": [case]}
        with open(os.path.join(folder, f"realm-gear-case-{i:02}.cantrip"), "w", encoding="utf-8", newline="\n") as f:
            f.write(smoke_scenario(item, name, family(case)))


def main():
    if "--smoke-cases" in sys.argv[1:]:
        smoke_cases(sys.argv[sys.argv.index("--smoke-cases") + 1])
        return 0
    check = "--check" in sys.argv[1:]
    try:
        out, texts, stale = build()
    except Invalid as problem:
        print(f"gear-cards: {problem}", file=sys.stderr)
        return 1
    changed = []
    for path, content in out.items():
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old != content:
            changed.append(path)
            if not check:
                with open(path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(content)
    for path, text in texts.items():
        changed.append(path)
        if not check:
            with open(path, encoding="utf-8") as f:
                item = json.load(f)
            item["text"] = text
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(json.dumps(item, indent=2, ensure_ascii=False) + "\n")
    for path in stale:
        changed.append(path)
        if not check:
            os.remove(path)
    for path in changed:
        print(("out of date: " if check else "wrote: ") + os.path.relpath(path, ROOT))
    return 1 if check and changed else 0


if __name__ == "__main__":
    sys.exit(main())
