"""Which lines of Cantrip Realms' gear code the gear scenarios never execute: tools/maintenance/card-coverage.py for the
gear, whose emblems no deck holds (they are dealt by a scenario's [Variant] section), so `corpus --card` finds none of
their scenarios.

    python tools/realms/gear-coverage.py

Runs every gear scenario (`corpus --scenario realm-gear`: the families' scenarios/realm-gear-*.cantrip and the items'
generated realm-gear-item-*.cantrip) under cargo-llvm-cov, then reads the line coverage of the gear's files in
crates/cantrip-cards/src/cards: realm_gear.rs (the families) and the generated realm_gear_*.rs. Prints each line that never
ran, with its text, and exits 1 if there is one, 0 when every line ran. `const fn` lines run at compile time and are left
out, as card-coverage.py leaves them out. Needs cargo-llvm-cov, as card-coverage.py does.
"""

import glob
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CARDS = os.path.join(ROOT, "crates", "cantrip-cards", "src", "cards")

_spec = importlib.util.spec_from_file_location("card_coverage", os.path.join(ROOT, "tools", "maintenance", "card-coverage.py"))
card_coverage = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(card_coverage)


def run(args, **kw):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


def main():
    files = sorted(glob.glob(os.path.join(CARDS, "realm_gear*.rs")))
    metadata = run(["cargo", "metadata", "--no-deps", "--format-version", "1"])
    if metadata.returncode != 0:
        sys.exit("gear-coverage: cargo metadata failed\n" + metadata.stderr[-4000:])
    coverage_dir = os.path.join(json.loads(metadata.stdout)["target_directory"], "llvm-cov-target")
    if run(["cargo", "llvm-cov", "clean", "--workspace"]).returncode != 0:
        sys.exit("gear-coverage: could not clear previous coverage profiles")
    corpus = run(["cargo", "llvm-cov", "run", "--profile", "cards", "--dep-coverage", "cantrip-cards", "-p", "cantrip-script", "--bin", "corpus",
                  "--no-report", "--", "--scenario", "realm-gear"])
    summary = [l for l in corpus.stdout.splitlines() if "scenarios:" in l]
    if corpus.returncode != 0:
        sys.stdout.write(corpus.stdout[-4000:] + corpus.stderr[-4000:])
        sys.exit("gear-coverage: the gear scenarios failed under coverage")
    host = run(["rustc", "-vV"]).stdout
    triple = next((line.removeprefix("host: ") for line in host.splitlines() if line.startswith("host: ")), "")
    tools = os.path.join(run(["rustc", "--print", "sysroot"]).stdout.strip(), "lib", "rustlib", triple, "bin")
    extension = ".exe" if os.name == "nt" else ""
    raw = glob.glob(os.path.join(coverage_dir, "*.profraw"))
    profile = os.path.join(coverage_dir, "gear-coverage.profdata")
    binary = os.path.join(coverage_dir, "cards", "corpus" + extension)
    if not raw or not os.path.isfile(binary):
        sys.exit("gear-coverage: the instrumented corpus or its profile is missing (is llvm-tools-preview installed?)")
    if run([os.path.join(tools, "llvm-profdata" + extension), "merge", "-sparse", *raw, "-o", profile]).returncode != 0:
        sys.exit("gear-coverage: llvm-profdata merge failed")
    lcov = os.path.join(tempfile.mkdtemp(prefix="gear-coverage-"), "gear.lcov")
    with open(lcov, "w", encoding="utf-8") as output:
        export = subprocess.run([os.path.join(tools, "llvm-cov" + extension), "export", "-format=lcov", f"-instr-profile={profile}", binary],
                                cwd=ROOT, stdout=output, stderr=subprocess.PIPE, text=True)
    if export.returncode != 0:
        sys.exit("gear-coverage: llvm-cov export failed\n" + export.stderr[-4000:])
    targets = {os.path.normcase(os.path.abspath(f)): f for f in files}
    hits, current = {f: {} for f in files}, None
    for line in open(lcov, encoding="utf-8"):
        if line.startswith("SF:"):
            named = line[3:].strip()
            if named.startswith("\\\\?\\"):
                named = named[4:]
            current = targets.get(os.path.normcase(os.path.abspath(named)))
        elif current and line.startswith("DA:"):
            number, count = line[3:].strip().split(",")[:2]
            hits[current][int(number)] = hits[current].get(int(number), 0) + int(count)
    if summary:
        print(summary[-1].strip())
    missed_any = False
    for path in files:
        source = open(path, encoding="utf-8").read().splitlines()
        exempt = card_coverage.const_fn_lines(source)
        lines = {n: c for n, c in hits[path].items() if n not in exempt}
        missed = sorted(n for n, c in lines.items() if c == 0)
        rel = os.path.relpath(path, ROOT)
        if not lines:
            print(f"{rel}: no instrumented lines (statics and const fns only)")
        elif not missed:
            print(f"{rel}: every line ran ({len(lines)} instrumented lines).")
        else:
            missed_any = True
            print(f"{rel}: {len(missed)} of {len(lines)} instrumented lines never ran:")
            for n in missed:
                print(f"  {n:4}  {source[n - 1].rstrip()}")
    return 1 if missed_any else 0


if __name__ == "__main__":
    sys.exit(main())
