#!/usr/bin/env bash
# One pull request comment, kept up to date: created the first time there is
# something to say, edited in place on every later push, and marked resolved
# (not deleted, so the thread keeps its history) once there is nothing to say.
# A comment is found by the hidden marker its body starts with.
#
# Never fails the job: the comment is for reviewers, the check's exit code and
# status are the gate. A failure to post is a warning.
#
# Environment:
#   DRIFT_REPORT            `drift check --format json` of the gate (check.sh gate)
#   DRIFT_SECURITY_REPORT   `drift security --diff-base --json`, when the `security` input is on
#   DRIFT_BASE              the ref the check compared with (empty: the whole repository)
#   DRIFT_HEAD_SHA          the pull request's head commit
#   DRIFT_COMMENT_LIMIT     rows listed per section (default 20); the rest are counted
#   PR_NUMBER, GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID, GH_TOKEN
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# The comment the Action posted before it kept one up to date: adopted, so a pull
# request that had one gets it edited rather than a second.
LEGACY='<!-- drift-security -->'

warn() { annotate warning "drift action: $1"; exit 0; }

report="${DRIFT_REPORT:-}"
[ -n "$report" ] && [ -f "$report" ] || warn "no drift check report to comment on; no comment posted"
[[ "${PR_NUMBER:-}" =~ ^[0-9]+$ ]] || warn "not a pull request; no comment posted"
repo="${GITHUB_REPOSITORY:-}"
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || warn "unexpected repository name; no comment posted"
sha="${DRIFT_HEAD_SHA:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || sha=""
limit="${DRIFT_COMMENT_LIMIT:-20}"
[[ "$limit" =~ ^[0-9]+$ ]] && [ "$limit" -gt 0 ] || limit=20

work="$(mktemp -d "$(scratch)/drift-comment.XXXXXX")"
render_comment "$report" "${DRIFT_SECURITY_REPORT:-}" "$limit" "${DRIFT_BASE:-}" "$sha" "$(run_url)" "$work/comment.json" ||
  warn "the drift check report could not be read; no comment posted"
say="$(jq -r '.say' "$work/comment.json")"
jq '{body: .body}' "$work/comment.json" >"$work/body.json"

# The comment to keep: the first one whose body starts with the marker, one a bot
# wrote (the Action's token) before one a person wrote.
gh api --paginate "repos/$repo/issues/$PR_NUMBER/comments" \
  --jq ".[] | select((.body // \"\") | startswith(\"$DRIFT_COMMENT_MARKER\") or startswith(\"$LEGACY\")) | \"\\(.id) \\(.user.type)\"" \
  >"$work/found" || warn "could not list the pull request's comments (does the job have pull-requests: write?)"
id="$(awk '$2 == "Bot" { print $1; exit }' "$work/found")"
[ -n "$id" ] || id="$(awk 'NR == 1 { print $1 }' "$work/found")"

if [ -n "$id" ]; then
  [[ "$id" =~ ^[0-9]+$ ]] || warn "unexpected comment id; no comment posted"
  gh api --method PATCH "repos/$repo/issues/comments/$id" --input "$work/body.json" >/dev/null ||
    warn "could not update comment $id"
  if [ "$say" = true ]; then
    echo "drift action: updated comment $id"
  else
    echo "drift action: comment $id marked resolved"
  fi
elif [ "$say" = true ]; then
  gh api --method POST "repos/$repo/issues/$PR_NUMBER/comments" --input "$work/body.json" >/dev/null ||
    warn "could not post a comment (does the job have pull-requests: write?)"
  echo "drift action: posted a comment"
else
  echo "drift action: nothing to report; no comment posted"
fi
