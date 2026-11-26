# Playtest reports

Every bug report and piece of playtest feedback filed from the game lands here, one folder each. A player presses **F8**
anywhere in Cantrip Realms - walking the world, in a dialog, making a character, in a duel or any other card screen - and
the game takes a screenshot and its state at that moment, then opens a box asking for the kind of report, its severity,
the part of the game, a title and details. Sent, the realm server (`POST /api/reports`; offline play's dev server,
with the server's own writer) writes it here.

The folders are local to the machine the server runs on and are not committed (`.gitignore`): they hold screenshots and
players' own words. Only this README is in git. A server elsewhere writes where `REALMS_REPORTS` says.

`tools/realms/reports.py` lists, shows and updates them (`list`, `show <id>`, `set <id> status=<status> note="..."`);
the `realm-reports` skill is the whole triage loop for an agent.

## A report's folder

`<yyyyMMdd-HHmmss>-<kind>-<title slug>/`, filed in UTC:

| File | What it holds |
| --- | --- |
| `report.md` | Read first. Front matter (below), the player's title and words, a summary of the moment it was filed (place, character, camera, page, build, how many console errors), the list of files, and a `## Triage` section for findings. |
| `screenshot.png` | The screen when F8 was pressed: the world's frame, and over it the card layer's own picture when a card screen was open (`context.json` `Page.cards.pictured` says whether it was read). The HUD is not in the pixels; its words are in `context.json` (`Page.hud`). Left out if the player unticked it. |
| `context.json` | `Page`: everything the overworld knew - `page` (URL with its query, viewport, build, offline or not), `cards` (the card screen open and the last few requests made of the card layer, with what each was opened on: a duel's seats, decks and seed), `hud`, `game` (screen, space, exact position and tile, area and tier, camera, dungeon run, relay, the mobs and players within 24 tiles, the debug overlay's lines, jumps and refused walks) and `character`. `Server`: the player id, the character as stored (`State.Character`), where presence has them, their last three duels (each with its dealt `Spec`), the server's version and when it was received. Without logs ticked, only `Page.page`. |
| `console.log` | The overworld page's console lately (the last 600 lines): logs, warnings, errors, uncaught errors and rejections. |
| `cards.log` | The card layer's console lately (its own page: the duel, the spell table, vendors). |
| `network.log` | The page's last 200 calls to the realm server: method, path, status, milliseconds, a refusal's code. |
| `trace.log` | What passed between the page and the presence relay: walks told, refusals, reconnections, figures stood. |
| `server.log` | The server's own log over the 15 minutes before: the realm's lines from Information up, everyone else's from Warning. Not in offline reports. |

A file with nothing to say is left out.

### Front matter

```yaml
---
id: 20261126-153012-bug-the-goblin-walked-through-the-wall
kind: bug            # bug | feedback | idea
severity: major      # blocker | major | minor | trivial
area: walking        # walking, duels, decks, gear, shops, towns, dungeons, map, visuals, interface, performance, balance, other
status: new          # see below
title: "The goblin walked through the wall"
filed: 2026-11-26T15:30:12Z
player: "dev-1"      # the player id (offline: "offline-<name>")
character: "Ann"
place: "world 412,388"   # the space and tile: world, an interior's id, run:<id>
screen: "world"      # world, a card screen (duel, sideboard, spell-table, vendor, loot, gear, inventory), dialog, report...
build: "1f244b20d"   # the overworld's commit; "+changes" when the tree had uncommitted changes
server: "1.0.0+<commit>"
---
```

Severity is the player's word. For a `bug`: `blocker` - the game cannot go on (a crash, stuck, progress lost); `major` -
something important is wrong; `minor` - wrong but playable; `trivial` - cosmetic. For feedback and ideas it says how
much it matters to them.

## Status

| Status | Means |
| --- | --- |
| `new` | Filed, nobody has looked. |
| `triaged` | Read and understood: the severity and area checked (corrected if the player's were off), the cause guessed, a next step written under `## Triage`. |
| `investigating` | Someone is on it now. |
| `fixed` | Fixed: the commit named under `## Triage`, and the test that shows it. |
| `duplicate` | The same as another report, named. |
| `wontfix` | Working as designed, or decided against - who decided, and why. A rules deviation is never `wontfix` (CLAUDE.md). |
| `cannot-reproduce` | Tried and not seen again: what was tried. |

Change the status in the front matter only, and say why under `## Triage`, newest last, each note dated:

```markdown
## Triage

- 2026-11-27 triaged: walking/major. The goblin's path crossed a closed tile at 412,387 - Actor.walkTo skips canStep
  on the last leg? Next: a sweep test at the smithy.
- 2026-11-27 fixed in abc1234 (render/actor.ts), e2e/sweep.spec.ts walks it.
```

## Investigating

- **Where:** `place` and `Page.game` say where the player stood; `?at=<space>:<x>,<z>` (offline: `?offline&at=world:412,388`)
  opens the game there (realms/docs/tech.md, "Without a server").
- **What they saw:** the screenshot, `Page.hud`, `Page.game.debug` (the debug overlay, F3), and `Page.cards` for a card screen.
- **A duel:** `Page.cards.requests` holds the duel as it was dealt (seats, decks, seed) and `Server.State.Duels` its spec
  as the server stored it. Force the position, never a seed (CLAUDE.md, "Scenarios, never seeds"): a scenario for the
  engine, `realmTest.forceDuel` / `POST /dev/duel` for the realm.
- **Movement:** `trace.log`, `Page.game.jumps` and `refusedWalks`, and `server.log`'s presence lines.
- **Which code:** `build` is the commit the page ran; `+changes` means it had uncommitted work beside it.
- A fix comes with the test that would have caught it, as any fix here does.
