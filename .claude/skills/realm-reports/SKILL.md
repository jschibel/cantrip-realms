---
name: realm-reports
description: Read, triage and investigate the playtest reports Cantrip Realms players file with F8 - bug reports, feedback and ideas, each a folder of realms/reports with a screenshot, the game's state and its logs - then fix what can be fixed and record the outcome in the report. Use when asked about playtest reports, bug reports or player feedback from the realm, to triage them, or to work through the open ones.
---

# Playtest reports

Players press F8 anywhere in Cantrip Realms to file a report. Each is a folder of `realms/reports/` (gitignored: the
folders exist only on the machine whose realm server took them). `realms/reports/README.md` says what every file
holds and what each status means; read it first.

## 1. See what is open

```
python tools/realms/reports.py list            # new, triaged, investigating - most severe first, then newest
python tools/realms/reports.py list --all      # everything
python tools/realms/reports.py show <id>       # a report's page and its files; any unique part of the id will do
```

Open `screenshot.png` with Read to see it, and `context.json` for the state.

## 2. Triage each new one

For each `new` report, read `report.md`, look at the screenshot, and skim `context.json`, `console.log` (errors first)
and the other logs. Then decide:

- Is it real, and what is it? A bug, feedback on design, or an idea. Check the severity against the README's meanings
  - players over- and under-rate; a crash or a stuck game is a `blocker` whatever they picked.
- Is it a duplicate of another report (same symptom, same place or code)? Mark it so, naming the other.
- Where is the cause likely to be? Name the module or file (realms/docs/tech.md's module layout helps).
- Feedback and ideas are not code work by default: triage them with a one-line summary for the owner, and leave design
  decisions to the owner (realms/docs/design.md is the design).

Record it - status, any corrected severity or area, and the finding as a dated note:

```
python tools/realms/reports.py set <id> status=triaged severity=major note="Cause: ... Next: ..."
python tools/realms/reports.py set <id> status=duplicate duplicate=<other id> note="Same jump at the bridge."
```

## 3. Investigate and fix

Take the most severe triaged bugs first. Set `status=investigating` while working on one.

- Reproduce it where it happened: `place` and `Page.game` give the space and tile; `?offline&at=world:<x>,<z>` (or
  `?at=<interior>:<x>,<z>`) opens the game there. `Page.page.url` is the exact page the player had, query included.
- Duels: `Page.cards.requests` has the duel as dealt and `Server.State.Duels` the server's spec. Force the position
  (a `.cantrip` scenario for the engine, `realmTest.forceDuel` or `POST /dev/duel` for the realm) - never sweep seeds.
- Movement and presence: `trace.log`, `Page.game.jumps`, `Page.game.refusedWalks`, `server.log`.
- `build` is the commit the page ran ("+changes": with uncommitted work); check whether the code has moved since.

Every fix follows CLAUDE.md as any change does - the rules bar, tests that would have caught it (the e2e suites and
unit tests of realms/web, the server's xUnit tests, scenarios for the engine), and its commits pushed. Then:

```
python tools/realms/reports.py set <id> status=fixed fixed=<commit> note="Cause: ... Test: e2e/sweep.spec.ts ..."
```

A report that cannot be reproduced after a real attempt is `cannot-reproduce`, with what was tried. One decided against
is `wontfix`, with who decided - never a rules deviation (CLAUDE.md: those are fixed or raised to a human).

## 4. Report back

Summarise for the user: how many reports were triaged, the bugs found and fixed (with commits), the ones still open by
severity, and the feedback and ideas that need the owner's decision.
