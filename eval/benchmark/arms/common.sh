# Shared by the arm scripts. Sourced, not run.
#
# Every arm script is called as   arms/<arm>.sh WORKDIR RUNDIR
# from harness.py, with the working copy already at the task's base commit.
# It may change WORKDIR only; it logs every command and its output to
# RUNDIR/arm.log. A non-zero exit is a harness error for that run.
#
# Environment set by harness.py (never passed on to the agent):
#   BENCH_DRIFT              path of the drift binary (in --dry-run: dryrun/fake_drift.py)
#   BENCH_PYTHON             python3 used for the helper below
#   BENCH_ARMS_DIR           this directory
#   BENCH_INSTRUCTIONS_FILE  instructions file name in the repository root (for example AGENTS.md)
#   BENCH_PLAIN_SOURCE       plain arm: the instructions file supplied as input
#   BENCH_ACCEPT_RULE        none | default-tier | list (which proposals a person "accepts")
#   BENCH_ACCEPT_LIST        with list: a file of convention ids, one per line
#   BENCH_ACCEPT_MODE        advise | block (mode the accepted conventions get)
#   BENCH_HOOK_FILES         hooks arm: lines "SOURCE=>DEST", DEST relative to WORKDIR
#   BENCH_HOOKS_WITH_AGENTS_MD  hooks arm: 1 to also write the AGENTS.md block (default 1)

set -eu
WORK=$1
RUN=$2
cd "$WORK"

log() { printf '%s\n' "$*" >> "$RUN/arm.log"; }
run() { log "+ $*"; "$@" >> "$RUN/arm.log" 2>&1; }

# drift init, then accept proposals by the pre-registered rule.
drift_setup() {
  run "$BENCH_DRIFT" init
  log "+ $BENCH_DRIFT census --json > RUNDIR/census.json"
  "$BENCH_DRIFT" census --json > "$RUN/census.json" 2>> "$RUN/arm.log"
  ids=$("$BENCH_PYTHON" -I "$BENCH_ARMS_DIR/accept_ids.py" "$RUN/census.json" "${BENCH_ACCEPT_RULE:-default-tier}" "${BENCH_ACCEPT_LIST:-}")
  log "accept rule ${BENCH_ACCEPT_RULE:-default-tier}: ${ids:-(none)}"
  if [ -n "$ids" ]; then
    if [ "${BENCH_ACCEPT_MODE:-advise}" = block ]; then
      run "$BENCH_DRIFT" review --block "$ids"
    else
      run "$BENCH_DRIFT" review --accept "$ids"
    fi
  fi
}

drift_export_agents_md() {
  run "$BENCH_DRIFT" export agents-md --write "$BENCH_INSTRUCTIONS_FILE"
}
