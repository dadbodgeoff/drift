#!/usr/bin/env bash
# Build the pre-scanned state roots most charters start from, once, and freeze them.
#
# Charters 03, 09, 12, 13, 14, 18, 19, 20, 21 all open with "a scanned repo with accepted
# conventions and some findings." Built per-agent that is ~10 commands each, every one producing
# output the agent must read and reason about. Built once here, each agent clones it for free.
set -euo pipefail
: "${DRIFT_BETA_REF:?source env.sh first}"
: "${DRIFT_ENGINE_BIN:?source env.sh first}"

DRIFT="${DRIFT:-node $DRIFT_BETA_SRC/packages/cli/dist/main.js}"
GOLDEN="$DRIFT_BETA_REF/golden"
chmod -R u+w "$DRIFT_BETA_REF" 2>/dev/null || true
mkdir -p "$GOLDEN"

# Name -> source. Extend deliberately; every entry costs a scan.
build() {
  local name="$1" src="$2"
  echo "==> golden: $name"
  rm -rf "$GOLDEN/$name"; mkdir -p "$GOLDEN/$name"
  cp -c -R "$src" "$GOLDEN/$name/repo" 2>/dev/null || cp -R "$src" "$GOLDEN/$name/repo"
  chmod -R u+w "$GOLDEN/$name/repo"
  local st="$GOLDEN/$name/state"; mkdir -p "$st"
  $DRIFT init  --repo-root "$GOLDEN/$name/repo" --state-root "$st" >/dev/null
  $DRIFT scan  --repo-root "$GOLDEN/$name/repo" --state-root "$st" >/dev/null
  $DRIFT start --repo-root "$GOLDEN/$name/repo" --state-root "$st" --json \
    > "$GOLDEN/$name/start.json" 2>/dev/null || true
  echo "    $(du -sh "$st" | cut -f1) state"
}

for r in "$DRIFT_BETA_REF"/eval-repos/*/; do
  [ -d "$r" ] && build "corpus-$(basename "$r")" "$r"
done
build "fixture-gt-data-access" "$DRIFT_BETA_REF/fixtures/gt-data-access"

chmod -R a-w "$GOLDEN"
echo "golden state roots frozen at $GOLDEN"
