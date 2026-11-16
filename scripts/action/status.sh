#!/usr/bin/env bash
# A commit status or a check run named after the result, so branch protection can
# require it by name ("drift" unless `status-name` says otherwise).
#
#   DRIFT_STATUS        off | commit (needs `statuses: write`) | check (needs `checks: write`)
#   DRIFT_STATUS_NAME   the context (commit status) or name (check run)
#   DRIFT_EXIT_CODE     the gate's exit code: 0 success, 1 failure, anything else error;
#                       empty (the check never ran to the end) is an error too
#   DRIFT_BLOCK, DRIFT_ADVISE, DRIFT_SECURITY, DRIFT_UNCHECKED   the gate's counts
#   DRIFT_HEAD_SHA      the commit to put it on (the pull request's head, or github.sha)
#   DRIFT_REPORT, DRIFT_SECURITY_REPORT, DRIFT_BASE   optional (check runs): the
#                       reports the check run's summary lists, as the comment does
#   GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID, GH_TOKEN
#
# A status that could not be posted is a warning, not a failure of this step: a
# branch protection rule that requires it still waits for it, so nothing passes.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

warn() { annotate warning "drift action: $1"; exit 0; }

mode="${DRIFT_STATUS:-off}"
case "$mode" in
  off | false | "") exit 0 ;;
  commit | check) ;;
  *) warn "status '$mode' is not off, commit or check; no status posted" ;;
esac
repo="${GITHUB_REPOSITORY:-}"
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || warn "unexpected repository name; no status posted"
sha="${DRIFT_HEAD_SHA:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || warn "no commit to put the status on; no status posted"
name="${DRIFT_STATUS_NAME:-drift}"
run="$(run_url)"

code="${DRIFT_EXIT_CODE:-}"
num() { if [[ "${1:-}" =~ ^[0-9]+$ ]]; then echo "$1"; else echo "?"; fi; }
case "$code" in
  0) state=success conclusion=success ;;
  1) state=failure conclusion=failure ;;
  *) state=error conclusion=failure ;;
esac
if [[ "$code" =~ ^[01]$ ]]; then
  desc="$(num "${DRIFT_BLOCK:-}") block, $(num "${DRIFT_ADVISE:-}") advise, $(num "${DRIFT_SECURITY:-}") security"
  if [ "$(num "${DRIFT_UNCHECKED:-}")" != 0 ]; then desc="$desc; $(num "${DRIFT_UNCHECKED:-}") files not checked"; fi
  title="drift: $desc"
else
  desc="drift check could not run to the end (exit ${code:-none}); see the job log"
  title="drift: error"
fi

work="$(mktemp -d "$(scratch)/drift-status.XXXXXX")"
if [ "$mode" = commit ]; then
  jq -n --arg state "$state" --arg context "$name" --arg description "${desc:0:140}" --arg url "$run" \
    '{state: $state, context: $context, description: $description} + (if $url == "" then {} else {target_url: $url} end)' \
    >"$work/status.json"
  gh api --method POST "repos/$repo/statuses/$sha" --input "$work/status.json" >/dev/null ||
    warn "could not post the commit status (does the job have statuses: write?)"
  echo "drift action: commit status '$name' $state on $sha"
else
  summary="$desc"
  if [ -n "${DRIFT_REPORT:-}" ] && [ -f "$DRIFT_REPORT" ] &&
    render_comment "$DRIFT_REPORT" "${DRIFT_SECURITY_REPORT:-}" 20 "${DRIFT_BASE:-}" "$sha" "$run" "$work/summary.json"; then
    summary="$(jq -r '.body' "$work/summary.json")"
  fi
  jq -n --arg name "$name" --arg sha "$sha" --arg conclusion "$conclusion" --arg title "$title" \
    --arg summary "${summary:0:60000}" --arg url "$run" \
    '{name: $name, head_sha: $sha, status: "completed", conclusion: $conclusion,
      output: {title: $title, summary: $summary}} + (if $url == "" then {} else {details_url: $url} end)' \
    >"$work/check.json"
  gh api --method POST "repos/$repo/check-runs" --input "$work/check.json" >/dev/null ||
    warn "could not create the check run (does the job have checks: write?)"
  echo "drift action: check run '$name' $conclusion on $sha"
fi
