#!/usr/bin/env bash
# Arm "plain": a plain generated instructions file, supplied as an input
# (BENCH_PLAIN_SOURCE), made once per task at its base commit before any run by
# the procedure PREREG-DRAFT.md names. It is appended to the instructions file
# between neutral markers (the file is created if the repository has none), the
# same place arm "agents-md" writes Drift's block. No Drift.
. "$(dirname "$0")/common.sh"
if [ -z "${BENCH_PLAIN_SOURCE:-}" ] || [ ! -f "$BENCH_PLAIN_SOURCE" ]; then
  log "plain arm: BENCH_PLAIN_SOURCE missing"; exit 3
fi
log "+ append $BENCH_PLAIN_SOURCE to $BENCH_INSTRUCTIONS_FILE"
{
  if [ -s "$BENCH_INSTRUCTIONS_FILE" ]; then printf '\n'; fi
  printf '<!-- generated:start -->\n'
  cat "$BENCH_PLAIN_SOURCE"
  printf '\n<!-- generated:end -->\n'
} >> "$BENCH_INSTRUCTIONS_FILE"
