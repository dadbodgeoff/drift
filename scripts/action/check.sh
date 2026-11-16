#!/usr/bin/env bash
# The Action's checks, run in the repository under review (the working directory):
#
#   check.sh sarif      `drift check --format sarif` over the whole repository
#   check.sh gate       `drift check --format github` (annotations, job summary), in
#                       PR mode on pull requests; then the same check as JSON, from
#                       which the step's outputs are counted. Never fails itself: the
#                       exit code is an output, and `finish` exits with it
#   check.sh security   `drift security --diff-base --github`, and its JSON for the comment
#   check.sh finish     exits with the gate's exit code (DRIFT_EXIT_CODE)
#
# Environment:
#   DRIFT_BIN        the Drift binary (default: `drift` on PATH)
#   DRIFT_ARGS       the `args` input: extra arguments for `drift check`
#   DRIFT_PR_MODE    the `pr-mode` input
#   DRIFT_EVENT      `github.event_name`
#   DRIFT_BASE_REF   `github.base_ref`
#   DRIFT_SARIF      "false" skips the sarif step
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DRIFT="${DRIFT_BIN:-drift}"
# Split like a shell word list, without globbing: `--strict`, `--root pkg`. The
# `${a[@]+...}` form keeps an empty list empty under `set -u` in bash 3.2 (macOS).
read -r -a EXTRA <<<"${DRIFT_ARGS:-}"

# The base ref of a pull request in PR mode, or empty for a whole-repository check.
pr_base() {
  if [ "${DRIFT_EVENT:-}" = pull_request ] && [ "${DRIFT_PR_MODE:-true}" != false ] && [ -n "${DRIFT_BASE_REF:-}" ]; then
    printf 'origin/%s' "$DRIFT_BASE_REF"
  fi
}

# A shallow checkout is deepened until the merge base with the base branch is
# there: the last 100 commits of the base branch, then 100 more at a time up to
# 1,000, and the full history only as a last resort. `fetch-depth: 0` avoids it.
fetch_base() {
  local base="$1" refspec tries=1
  [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = true ] || return 0
  refspec="+refs/heads/$DRIFT_BASE_REF:refs/remotes/origin/$DRIFT_BASE_REF"
  git fetch --no-tags --quiet --depth=100 origin "$refspec" || true
  until git merge-base "$base" HEAD >/dev/null 2>&1 || [ "$tries" -ge 10 ]; do
    git fetch --no-tags --quiet --deepen=100 origin "$refspec" || break
    tries=$((tries + 1))
  done
  if ! git merge-base "$base" HEAD >/dev/null 2>&1; then
    echo "drift: no merge base with $base within $((tries * 100)) commits; fetching the full history (git fetch --unshallow)"
    git fetch --no-tags --quiet --unshallow origin "$refspec" || true
  fi
}

# Code scanning gets the whole repository's new violations: it tracks alerts
# across branches itself and shows a pull request only the alerts it adds. Exit 1
# (violations found) is expected; any other failure stops the job.
sarif() {
  local file status=0
  file="$(scratch)/drift.sarif"
  "$DRIFT" check --format sarif ${EXTRA[@]+"${EXTRA[@]}"} >"$file" || status=$?
  if [ "$status" -gt 1 ]; then exit "$status"; fi
  out sarif "$file"
}

gate() {
  local base diff_args=() code=0 json_code=0 report counts
  base="$(pr_base)"
  if [ -n "$base" ]; then
    fetch_base "$base"
    diff_args=(--diff-base "$base")
  fi
  "$DRIFT" check --format github ${diff_args[@]+"${diff_args[@]}"} ${EXTRA[@]+"${EXTRA[@]}"} || code=$?
  # The same check as JSON, for the outputs and the comment. The fact cache makes
  # it cheap. Drift decides its exit code before any output, so the two agree;
  # where they do not, the worse one stands.
  report="$(scratch)/drift-check.json"
  (env -u GITHUB_STEP_SUMMARY "$DRIFT" check --format json ${diff_args[@]+"${diff_args[@]}"} ${EXTRA[@]+"${EXTRA[@]}"} >"$report") || json_code=$?
  if [ "$json_code" -gt "$code" ]; then code="$json_code"; fi
  out exit-code "$code"
  out base "$base"
  if [ "$json_code" -gt 1 ] || ! counts="$(jq -r -f "$ACTION_SCRIPTS/counts.jq" "$report" 2>/dev/null)"; then
    # Nothing counted is not zero: the outputs stay empty, and the exit code fails.
    annotate error "drift action: the JSON report could not be read (drift check exited $json_code); outputs are empty"
    [ "$code" -gt 1 ] || out exit-code 2
    return 0
  fi
  out report "$report"
  local name value
  while IFS='=' read -r name value; do out "$name" "$value"; done <<<"$counts"
}

security() {
  local base report
  base="$(pr_base)"
  [ -n "$base" ] || return 0
  if ! git merge-base "$base" HEAD >/dev/null 2>&1; then
    echo "drift security: no merge base with $base; skipped"
    return 0
  fi
  # Facts for a reviewer: never fails the job.
  "$DRIFT" security --diff-base "$base" --github || true
  report="$(scratch)/drift-security.json"
  if (env -u GITHUB_STEP_SUMMARY "$DRIFT" security --diff-base "$base" --json >"$report"); then
    out security-report "$report"
  fi
}

finish() {
  local code="${DRIFT_EXIT_CODE:-}"
  [[ "$code" =~ ^[0-9]+$ ]] || die "drift check did not report an exit code; failing closed"
  exit "$code"
}

case "${1:-}" in
  sarif) sarif ;;
  gate) gate ;;
  security) security ;;
  finish) finish ;;
  *)
    echo "usage: check.sh sarif|gate|security|finish" >&2
    exit 2
    ;;
esac
