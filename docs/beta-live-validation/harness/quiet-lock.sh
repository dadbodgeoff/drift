#!/usr/bin/env bash
# Exclusive whole-machine lock. Charters 15 and 16 measure timing and determinism; anything else
# running concurrently invalidates them.
#
#   quiet-lock.sh acquire 16 [timeout_s] ; quiet-lock.sh release 16
set -euo pipefail
: "${DRIFT_BETA_LOCKS:?source env.sh first}"
LOCK="$DRIFT_BETA_LOCKS/machine.lock"

case "$1" in
  acquire)
    deadline=$(( $(date +%s) + ${3:-3600} ))
    until mkdir "$LOCK" 2>/dev/null; do
      [ "$(date +%s)" -ge "$deadline" ] && { echo "lock held by $(cat "$LOCK/owner" 2>/dev/null)" >&2; exit 1; }
      sleep 5
    done
    echo "$2 pid=$$" > "$LOCK/owner"; echo "acquired by $2" ;;
  release)
    [ -d "$LOCK" ] && rm -rf "$LOCK"; echo "released" ;;
  status)
    [ -d "$LOCK" ] && cat "$LOCK/owner" || echo "free" ;;
esac
