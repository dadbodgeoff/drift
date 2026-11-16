#!/usr/bin/env -S python3 -I
"""Stand-in for the drift binary in `harness.py --dry-run`. It runs no analysis.

It answers the commands the arm scripts call (--version, init, census --json,
review --accept/--block, export agents-md --write FILE, hook ...) with fixed,
small outputs, and writes files where the real commands write them (.drift/,
drift.lock, the instructions file's drift block), so the harness and the
blinding in grade.py can be tested end to end.
"""
import json
import os
import sys

POLICY = ".drift/conventions.yaml"


def main(argv):
    if not argv or argv[0] in ("--version", "-V"):
        print("drift 0.0.0-dryrun")
        return 0
    cmd = argv[0]
    if cmd == "init":
        os.makedirs(".drift/cache", exist_ok=True)
        with open(".drift/cache/.gitignore", "w") as f:
            f.write("*\n")
        with open(POLICY, "w") as f:
            f.write("# dry-run policy\nconventions:\n- id: D-000001\n  status: proposed\n- id: D-000002\n  status: proposed\n")
        with open("drift.lock", "w") as f:
            f.write("D-000001 src/legacy.py#old\n")
        print("Wrote .drift/conventions.yaml and drift.lock (1 existing violations recorded)")
        return 0
    if cmd == "census":
        print(json.dumps({"proposals": [{"id": "D-000001", "tier": "default"}, {"id": "D-000002", "tier": "suggestion"}]}))
        return 0
    if cmd == "review":
        ids = argv[argv.index("--accept") + 1] if "--accept" in argv else argv[argv.index("--block") + 1]
        with open(POLICY, "a") as f:
            f.write("# accepted: %s\n" % ids)
        print("%d accepted (0 block), 1 proposed, 0 rejected" % len(ids.split(",")))
        return 0
    if cmd == "export" and argv[1] == "agents-md":
        block = "<!-- drift:start -->\n## Conventions (dry run)\n- [D-000001] handlers return dicts\n<!-- drift:end -->\n"
        if "--write" in argv:
            path = argv[argv.index("--write") + 1]
            old = open(path).read() if os.path.exists(path) else ""
            with open(path, "w") as f:
                f.write(old + ("\n" if old else "") + block)
        else:
            sys.stdout.write(block)
        return 0
    if cmd == "hook":
        print(json.dumps({"continue": True}))
        return 0
    print("fake_drift: unsupported command %r" % argv, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
