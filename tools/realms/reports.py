"""Playtest reports (realms/reports/README.md): list them, show one, change its status.

  python tools/realms/reports.py list [--status new,triaged] [--kind bug] [--area walking] [--all]
  python tools/realms/reports.py show <id>
  python tools/realms/reports.py set <id> status=<status> [severity=<s>] [area=<a>] [note="..."]

`list` shows the open ones (new, triaged, investigating) unless --status or --all says otherwise, most severe first and
then newest first. An id may be cut short to any unique part of it. `set` changes front matter fields and adds a dated
note under the report's ## Triage. REALMS_REPORTS names another reports folder than realms/reports.
"""

import argparse
import datetime
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORTS = Path(os.environ.get("REALMS_REPORTS") or ROOT / "realms" / "reports")

STATUSES = ["new", "triaged", "investigating", "fixed", "duplicate", "wontfix", "cannot-reproduce"]
OPEN = {"new", "triaged", "investigating"}
SEVERITIES = ["blocker", "major", "minor", "trivial"]
KINDS = ["bug", "feedback", "idea"]


def front(text):
    """The front matter's fields, as written: quoted values unquoted."""
    match = re.match(r"---\n(.*?)\n---\n", text, re.S)
    fields = {}
    if not match:
        return fields
    for line in match.group(1).splitlines():
        key, _, value = line.partition(":")
        value = value.strip()
        if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
            value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        fields[key.strip()] = value
    return fields


def reports():
    if not REPORTS.is_dir():
        return []
    found = []
    for folder in REPORTS.iterdir():
        md = folder / "report.md"
        if md.is_file():
            found.append((folder, front(md.read_text(encoding="utf-8"))))
    return found


def find(part):
    matches = [r for r in reports() if part in r[0].name]
    exact = [r for r in matches if r[0].name == part]
    if exact:
        return exact[0]
    if len(matches) != 1:
        sys.exit(f"{len(matches)} reports match '{part}'" + (": " + ", ".join(m[0].name for m in matches) if matches else "."))
    return matches[0]


def rank(fields):
    severity = fields.get("severity", "trivial")
    return SEVERITIES.index(severity) if severity in SEVERITIES else len(SEVERITIES)


def listing(args):
    statuses = None if args.all else set((args.status or ",".join(OPEN)).split(","))
    rows = [
        (folder, f)
        for folder, f in reports()
        if (statuses is None or f.get("status") in statuses)
        and (not args.kind or f.get("kind") == args.kind)
        and (not args.area or f.get("area") == args.area)
    ]
    rows.sort(key=lambda r: r[1].get("filed", ""), reverse=True)
    rows.sort(key=lambda r: rank(r[1]))
    if not rows:
        print(f"No reports{'' if args.all else ' open'} in {REPORTS}.")
        return
    for folder, f in rows:
        print(f"{f.get('severity', '?'):8} {f.get('kind', '?'):8} {f.get('status', '?'):16} {f.get('area', '?'):12} {folder.name}")
        print(f"{'':8} {f.get('title', '')}  [{f.get('place', '')}, {f.get('player', '')}]")


def show(args):
    folder, _ = find(args.id)
    print(folder)
    print((folder / "report.md").read_text(encoding="utf-8"))
    for item in sorted(folder.iterdir()):
        if item.name != "report.md":
            print(f"  {item.name:16} {item.stat().st_size:>9} bytes")


def quoted(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def update(args):
    folder, fields = find(args.id)
    md = folder / "report.md"
    text = md.read_text(encoding="utf-8")
    note = None
    changes = {}
    for pair in args.changes:
        key, sep, value = pair.partition("=")
        if not sep:
            sys.exit(f"'{pair}' is not key=value.")
        if key == "note":
            note = value
            continue
        allowed = {"status": STATUSES, "severity": SEVERITIES, "kind": KINDS}.get(key)
        if allowed is not None and value not in allowed:
            sys.exit(f"{key} is one of {', '.join(allowed)}.")
        if key not in ("status", "severity", "area", "kind", "duplicate", "fixed"):
            sys.exit(f"'{key}' is not a field set here (status, severity, area, kind, duplicate, fixed, note).")
        changes[key] = value
    head, sep, body = text[4:].partition("\n---\n")
    lines = head.splitlines()
    for key, value in changes.items():
        written = value if key in ("status", "severity", "area", "kind") else quoted(value)
        for i, line in enumerate(lines):
            if line.startswith(f"{key}:"):
                lines[i] = f"{key}: {written}"
                break
        else:
            lines.insert(next((i + 1 for i, l in enumerate(lines) if l.startswith("status:")), len(lines)), f"{key}: {written}")
    text = "---\n" + "\n".join(lines) + "\n---\n" + body
    if note or changes:
        today = datetime.date.today().isoformat()
        said = ", ".join(f"{k} {v}" for k, v in changes.items())
        entry = f"- {today} {said}{': ' if said and note else ''}{note or ''}\n"
        text = text.replace("<!-- Findings, the cause, the fix's commit: realms/reports/README.md says how. -->\n", "")
        text = text.rstrip("\n") + "\n" + ("\n" if text.rstrip("\n").endswith("## Triage") else "") + entry
    md.write_text(text, encoding="utf-8")
    print(f"{folder.name}: {', '.join(f'{k}={v}' for k, v in changes.items()) or 'noted'}")


def main():
    # Players' titles are any language; a Windows console's code page is not.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    listed = commands.add_parser("list", help="the open reports, most severe first")
    listed.add_argument("--status", help="statuses, comma-separated")
    listed.add_argument("--kind", choices=KINDS)
    listed.add_argument("--area")
    listed.add_argument("--all", action="store_true", help="every report, whatever its status")
    listed.set_defaults(run=listing)
    shown = commands.add_parser("show", help="a report's page and its files")
    shown.add_argument("id")
    shown.set_defaults(run=show)
    changed = commands.add_parser("set", help="change a report's status (and more), with a note under ## Triage")
    changed.add_argument("id")
    changed.add_argument("changes", nargs="+", metavar="key=value")
    changed.set_defaults(run=update)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
