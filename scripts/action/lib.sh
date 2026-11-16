# Helpers shared by the Action's scripts (sourced, never run on its own).
#
# Every script reads its inputs from environment variables that action.yml sets
# from `inputs.*` and the `github` context, never from `${{ }}` text pasted into
# a shell line: a branch name or an input is data, not code.

# One `name=value` line for the step's outputs. Values are single-line by
# construction; a newline would start a second output, so it is cut there.
out() {
  local value="${2%%$'\n'*}"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$1" "$value" >>"$GITHUB_OUTPUT"
  fi
  printf 'drift action: %s=%s\n' "$1" "$value" >&2
}

# A workflow-command annotation. The message is escaped the way GitHub reads
# workflow commands (`%`, CR and LF), so text from a repository cannot start a
# command of its own.
annotate() {
  local level="$1" msg="$2"
  msg="${msg//'%'/'%25'}"
  msg="${msg//$'\r'/'%0D'}"
  msg="${msg//$'\n'/'%0A'}"
  printf '::%s::%s\n' "$level" "$msg"
}

die() {
  annotate error "drift action: $1"
  exit "${2:-1}"
}

# The directory of the Action's scripts and jq programs.
ACTION_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A scratch directory for this run: the runner's temp directory in a workflow
# (outside the checkout, so nothing written here is ever part of a diff).
scratch() {
  local base="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
  mkdir -p "$base"
  printf '%s' "$base"
}

# The comment's markdown, from a `drift check --format json` report ($1) and an
# optional `drift security --diff-base --json` report ($2, may be empty), into $7
# as {say, body}. $3 rows per section, $4 the base compared with, $5 the head
# commit, $6 the run's URL. GitHub refuses a comment or a check summary over
# 65,536 characters: fewer rows are listed until it fits.
render_comment() {
  local report="$1" sec="${2:-}" limit="$3" base="$4" sha="$5" run="$6" dest="$7"
  [ -n "$sec" ] && [ -f "$sec" ] || sec=/dev/null
  while :; do
    jq -f "$ACTION_SCRIPTS/comment.jq" --slurpfile sec "$sec" --argjson limit "$limit" \
      --arg marker "$DRIFT_COMMENT_MARKER" --arg base "$base" --arg sha "$sha" --arg run "$run" \
      "$report" >"$dest" || return 1
    if [ "$(jq -r '.body | length' "$dest")" -le 60000 ] || [ "$limit" -le 1 ]; then return 0; fi
    limit=$((limit / 2))
  done
}

# The hidden first line of the Action's pull request comment.
DRIFT_COMMENT_MARKER='<!-- drift-action:comment -->'

# The URL of this workflow run, or empty outside one.
run_url() {
  if [[ "${GITHUB_SERVER_URL:-}" =~ ^https://[A-Za-z0-9.-]+$ ]] && [[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] &&
    [[ "${GITHUB_REPOSITORY:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    printf '%s/%s/actions/runs/%s' "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID"
  fi
}
