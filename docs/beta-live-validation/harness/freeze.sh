#!/usr/bin/env bash
# Freeze one commit of Drift as the immutable subject of the whole validation program.
#
# Why a standalone clone and NOT a git worktree: this repo currently has ten worktrees sharing one
# object store, several of them active sprint branches (S4, S6). A worktree would put the audit
# subject inside a .git that other agents are writing to. A clone gives the program a subject
# nobody else can move.
#
#   ./freeze.sh [<sha>]        # default: origin/main as of now
#
# Emits $FREEZE_ROOT/env.sh. Every agent sources it and nothing else.
set -euo pipefail

# Resolved BEFORE any cd. `$(dirname "$0")` is relative, and this script cd's into the freeze to
# build - so every later use of it silently pointed at the wrong directory and the harness copy
# failed after a ten-minute build had already succeeded.
HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"

SRC_REPO="${SRC_REPO:-$(git rev-parse --show-toplevel)}"
FREEZE_ROOT="${FREEZE_ROOT:-$HOME/drift-beta-freeze}"
EVAL_REPOS="${DRIFT_EVAL_REPOS:-$HOME/drift-falsification/repos}"

# Disk check first. A freeze that dies halfway leaves a half-built subject that looks whole.
# Measured, not guessed: the object store clone, ~100MB of node_modules, and a ~2.5GB cargo
# release target. 4GB is the floor with headroom; the first threshold here was 8GB, picked by
# feel, and it refused a freeze that would have fit comfortably.
NEED_GB="${FREEZE_MIN_GB:-4}"
FREE_GB=$(df -g "$(dirname "$FREEZE_ROOT")" | tail -1 | awk '{print $4}')
if [ "${FREE_GB:-0}" -lt "$NEED_GB" ]; then
  echo "only ${FREE_GB}GB free; a freeze needs ~${NEED_GB}GB (clone + release build + tarballs)." >&2
  echo "Free space, set FREEZE_MIN_GB, or point FREEZE_ROOT at another volume." >&2
  exit 1
fi
echo "==> ${FREE_GB}GB free (need ~${NEED_GB}GB)"

cd "$SRC_REPO"
git fetch origin main --quiet
SHA="${1:-$(git rev-parse origin/main)}"
SHA="$(git rev-parse "$SHA")"

if [ -e "$FREEZE_ROOT" ]; then
  echo "FREEZE_ROOT exists: $FREEZE_ROOT" >&2
  echo "Refusing to overwrite a frozen subject. Move it aside or set FREEZE_ROOT." >&2
  exit 1
fi

echo "==> freezing $SHA into $FREEZE_ROOT"
mkdir -p "$FREEZE_ROOT"
git clone --quiet --no-checkout "$SRC_REPO" "$FREEZE_ROOT/src"
git -C "$FREEZE_ROOT/src" checkout --quiet --detach "$SHA"
git -C "$FREEZE_ROOT/src" remote set-url origin "$(git remote get-url origin)"

# One build. Everything downstream consumes it; nobody rebuilds.
cd "$FREEZE_ROOT/src"
echo "==> pnpm install"; pnpm install --frozen-lockfile
echo "==> build:engine";  pnpm build:engine
echo "==> build";         pnpm build

ENGINE="$FREEZE_ROOT/src/target/release/drift-engine"
[ -x "$ENGINE" ] || { echo "engine binary missing at $ENGINE" >&2; exit 1; }
if [ -n "$(find crates -name '*.rs' -newer "$ENGINE" 2>/dev/null)" ]; then
  echo "engine binary is older than a .rs file - build is stale" >&2; exit 1
fi

# Tarballs, so charter 01 installs the real artifact and never rebuilds from source.
echo "==> packing"
mkdir -p "$FREEZE_ROOT/tarballs"
( cd packages/cli && pnpm pack --pack-destination "$FREEZE_ROOT/tarballs" >/dev/null )
( cd packages/mcp && pnpm pack --pack-destination "$FREEZE_ROOT/tarballs" >/dev/null )

# Reference copies nobody may mutate. Agents clone from these, never read them in place.
echo "==> reference corpora"
mkdir -p "$FREEZE_ROOT/ref"
# `cp -c` is an APFS copy-on-write clone: the 1GB corpus costs ~0 bytes and ~0 seconds until
# something writes to it. Falls back to a real copy on any filesystem without clonefile.
clone_tree() { cp -c -R "$1" "$2" 2>/dev/null || cp -R "$1" "$2"; }

clone_tree "$FREEZE_ROOT/src/test/fixtures" "$FREEZE_ROOT/ref/fixtures"
if [ -d "$EVAL_REPOS" ]; then
  clone_tree "$EVAL_REPOS" "$FREEZE_ROOT/ref/eval-repos"
  for r in "$FREEZE_ROOT/ref/eval-repos"/*/; do
    [ -d "$r/.git" ] && echo "$(basename "$r") $(git -C "$r" rev-parse HEAD)"
  done > "$FREEZE_ROOT/corpus-shas.txt"
else
  echo "WARNING: no eval corpus at $EVAL_REPOS - charters 10/15/16 will be limited" >&2
  : > "$FREEZE_ROOT/corpus-shas.txt"
fi

mkdir -p "$FREEZE_ROOT/artifacts" "$FREEZE_ROOT/ledger" "$FREEZE_ROOT/locks" "$FREEZE_ROOT/facts"

cat > "$FREEZE_ROOT/env.sh" <<ENVEOF
# Source this. Do not set any of these by hand.
export DRIFT_BETA_FREEZE="$FREEZE_ROOT"
export DRIFT_BETA_SHA="$SHA"
export DRIFT_BETA_SRC="$FREEZE_ROOT/src"
export DRIFT_ENGINE_BIN="$ENGINE"
export DRIFT_BETA_TARBALLS="$FREEZE_ROOT/tarballs"
export DRIFT_BETA_REF="$FREEZE_ROOT/ref"
export DRIFT_EVAL_REPOS="$FREEZE_ROOT/ref/eval-repos"
export DRIFT_BETA_ARTIFACTS="$FREEZE_ROOT/artifacts"
export DRIFT_BETA_LEDGER="$FREEZE_ROOT/ledger"
export DRIFT_BETA_LOCKS="$FREEZE_ROOT/locks"
export PATH="$FREEZE_ROOT/harness:\$PATH"
ENVEOF

mkdir -p "$FREEZE_ROOT/harness"
cp "$HARNESS_DIR"/* "$FREEZE_ROOT/harness/" 2>/dev/null || true
chmod +x "$FREEZE_ROOT/harness/"* 2>/dev/null || true

# Integrity manifest. `assert-env` checks this before every charter, so an agent cannot silently
# test a different build than the one that was frozen - including one someone re-froze underneath it.
echo "==> manifest"
python3 - "$FREEZE_ROOT" "$SHA" "$ENGINE" <<'MANIFEST'
import hashlib, json, os, subprocess, sys
root, sha, engine = sys.argv[1:4]
def h(p):
    d = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""): d.update(c)
    return d.hexdigest()
m = {"sha": sha, "engine_sha256": h(engine), "frozen_at": subprocess.run(
        ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip(),
     "tarballs": {}, "dist": {}}
tb = os.path.join(root, "tarballs")
for f in sorted(os.listdir(tb)): m["tarballs"][f] = h(os.path.join(tb, f))
for pkg in sorted(os.listdir(os.path.join(root, "src", "packages"))):
    d = os.path.join(root, "src", "packages", pkg, "dist")
    if os.path.isdir(d):
        acc = hashlib.sha256()
        for dp, _, fns in sorted(os.walk(d)):
            for fn in sorted(fns): acc.update(h(os.path.join(dp, fn)).encode())
        m["dist"][pkg] = acc.hexdigest()
json.dump(m, open(os.path.join(root, "manifest.json"), "w"), indent=1)
print(f"   engine {m['engine_sha256'][:16]} · {len(m['tarballs'])} tarballs · {len(m['dist'])} dist bundles")
MANIFEST

# Freeze it. Read-only is the enforcement, not a convention.
chmod -R a-w "$FREEZE_ROOT/src" "$FREEZE_ROOT/ref" "$FREEZE_ROOT/tarballs"

echo
echo "frozen: $SHA   (verify any time with: assert-env)"
echo "source $FREEZE_ROOT/env.sh"
