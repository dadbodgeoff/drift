#!/usr/bin/env -S python3 -I
"""Stand-in for the agent in `harness.py --dry-run`: a trivial, deterministic edit.

    fake_agent.py --workdir DIR --prompt-file FILE --transcript FILE [--usage FILE]
    fake_agent.py --version

It appends one function to the first Python or TypeScript file it finds
(sorted), writes a short JSON-lines transcript, and, where it finds a Drift
policy or the hook wiring, writes into the transcript the kinds of lines that
grade.py must strip (a hook message, an instructions-file mention) and adds a
`drift-ignore` comment, so the blinding is exercised. Words in the prompt drive
the failure cases the tests need: DRYRUN-SLEEP sleeps past any timeout,
DRYRUN-FAIL exits 1, DRYRUN-BUDGET exits 75 (the example config's budget code).
"""
import argparse
import json
import os
import sys
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", action="store_true")
    ap.add_argument("--workdir")
    ap.add_argument("--prompt-file")
    ap.add_argument("--transcript")
    ap.add_argument("--usage")
    a = ap.parse_args()
    if a.version:
        print("fake-agent 0.0.0-dryrun")
        return 0
    prompt = open(a.prompt_file, encoding="utf-8").read()
    events = [{"role": "user", "text": prompt}]
    if "DRYRUN-SLEEP" in prompt:
        time.sleep(3600)
    os.chdir(a.workdir)
    has_drift = os.path.isdir(".drift")
    target = None
    for root, dirs, files in os.walk("."):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for f in sorted(files):
            if f.endswith((".py", ".ts")) and not f.startswith("test"):
                target = os.path.join(root, f)
                break
        if target:
            break
    if has_drift:
        events.append({"role": "tool", "name": "hook", "text": "drift: 1 new violation (advises). [D-000001] handlers return dicts"})
        events.append({"role": "assistant", "text": "I read AGENTS.md and ran drift card %s." % target})
    with open(target, "a", encoding="utf-8") as f:
        if has_drift:
            f.write("\n# drift-ignore D-000001: dry-run suppression\n")
        f.write("\n\ndef dry_run_added():\n    return {\"ok\": True}\n")
    events.append({"role": "assistant", "text": "Edited %s in %s." % (target, os.getcwd())})
    with open(a.transcript, "w", encoding="utf-8") as f:
        for e in events:
            f.write(json.dumps(e, sort_keys=True) + "\n")
    if a.usage:
        with open(a.usage, "w") as f:
            json.dump({"cost": 0.0, "turns": 1}, f)
    if "DRYRUN-FAIL" in prompt:
        return 1
    if "DRYRUN-BUDGET" in prompt:
        return 75
    return 0


if __name__ == "__main__":
    sys.exit(main())
