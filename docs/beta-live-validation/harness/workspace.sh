#!/usr/bin/env bash
# Hand a probe an isolated, disposable workspace cloned from the frozen reference.
#
#   eval "$(workspace.sh <charter> <probe-id> [<fixture-name>|--corpus <repo>|--empty])"
#
# Exports WS, WS_REPO, WS_STATE, WS_DB. On APFS, `cp -c` is a copy-on-write clone: copying a
# 20,000-file repo or a pre-scanned state root costs almost nothing and no bytes on disk.
set -euo pipefail
: "${DRIFT_BETA_REF:?source env.sh first}"

CHARTER="$1"; PROBE="$2"; shift 2
WS="$(mktemp -d "/tmp/drift-beta.$CHARTER.$PROBE.XXXXXX")"

clone() { cp -c -R "$1" "$2" 2>/dev/null || cp -R "$1" "$2"; chmod -R u+w "$2"; }

case "${1:---empty}" in
  --empty)  mkdir -p "$WS/repo" ;;
  --corpus) clone "$DRIFT_BETA_REF/eval-repos/$2" "$WS/repo" ;;
  --golden) clone "$DRIFT_BETA_REF/golden/$2/repo"  "$WS/repo"
            clone "$DRIFT_BETA_REF/golden/$2/state" "$WS/state" ;;
  *)        clone "$DRIFT_BETA_REF/fixtures/$1" "$WS/repo" ;;
esac
mkdir -p "$WS/state"

echo "export WS='$WS'"
echo "export WS_REPO='$WS/repo'"
echo "export WS_STATE='$WS/state'"
echo "export WS_DB='$WS/state/drift.db'"
