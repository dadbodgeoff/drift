#!/usr/bin/env bash
# Tests of the Action's scripts, with fake `gh`, `curl`, `cargo` and `drift` on
# PATH and recorded `drift check --format json` / `drift security --json` output
# (testdata/, recorded from a fixture repository). Nothing reaches the network.
#
#   bash scripts/action/test.sh
#
# Needs bash, git, jq, tar and sha256sum or shasum. Run by CI through
# crates/drift-cli/tests/gap_action_scripts.rs (the `test` job), which also
# feeds the scripts the JSON of the Drift it builds.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="$here/testdata"
root="$(mktemp -d "${TMPDIR:-/tmp}/drift-action-test.XXXXXX")"
trap 'rm -rf "$root"' EXIT
fakes="$root/fakes"
mkdir -p "$fakes"
real_git="$(command -v git)"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
bad() {
  fail=$((fail + 1))
  printf 'FAIL %s: %s\n' "$current" "$1" >&2
}
expect_eq() { if [ "$1" = "$2" ]; then ok; else bad "${3:-}: expected '$2', got '$1'"; fi; }
expect_has() { if grep -qF -- "$2" "$1"; then ok; else bad "${3:-} '$2' not in $1:\n$(cat "$1")"; fi; }
expect_not() { if grep -qF -- "$2" "$1"; then bad "${3:-} '$2' found in $1"; else ok; fi; }
# The value of an output a step wrote to its GITHUB_OUTPUT file (the last one wins).
output() { awk -F= -v k="$2" '$1 == k { v = substr($0, length(k) + 2) } END { print v }' "$1"; }

# --- fakes -----------------------------------------------------------------

# gh: logs each call (and the JSON of --input) to $FAKE_LOG; `gh api` GETs answer
# with $FAKE_GH_COMMENTS through --jq as gh does; $FAKE_GH_FAIL fails every call.
cat >"$fakes/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh $*" >>"$FAKE_LOG"
[ -z "${FAKE_GH_FAIL:-}" ] || exit 1
jqf="" input="" method=GET
while [ $# -gt 0 ]; do
  case "$1" in
    --jq) jqf="$2"; shift ;;
    --input) input="$2"; shift ;;
    --method | -X) method="$2"; shift ;;
  esac
  shift
done
if [ -n "$input" ]; then echo "INPUT $(jq -c . "$input")" >>"$FAKE_LOG"; fi
if [ "$method" = GET ]; then
  if [ -n "$jqf" ]; then jq -r "$jqf" "${FAKE_GH_COMMENTS:-/dev/null}"; else cat "${FAKE_GH_COMMENTS:-/dev/null}"; fi
else
  echo '{"id": 1}'
fi
EOF

# curl: `-o FILE URL` copies $FAKE_RELEASES/<last path part of URL>, or fails as a 404 does.
cat >"$fakes/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >>"$FAKE_LOG"
out="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
src="${FAKE_RELEASES:-/nonexistent}/${url##*/}"
[ -f "$src" ] || exit 22
cp "$src" "$out"
EOF

# git: `ls-remote` answers with $FAKE_LS_REMOTE; everything else is the real git.
cat >"$fakes/git" <<EOF
#!/usr/bin/env bash
if [ "\$1" = ls-remote ]; then
  echo "git \$*" >>"\$FAKE_LOG"
  [ -f "\${FAKE_LS_REMOTE:-}" ] || exit 128
  cat "\$FAKE_LS_REMOTE"
  exit 0
fi
exec "$real_git" "\$@"
EOF

# cargo: a build writes a stub binary into CARGO_TARGET_DIR.
cat >"$fakes/cargo" <<'EOF'
#!/usr/bin/env bash
echo "cargo $* in $PWD" >>"$FAKE_LOG"
mkdir -p "$CARGO_TARGET_DIR/release/deps"
printf '#!/bin/sh\necho "drift 0.0.0-built"\n' >"$CARGO_TARGET_DIR/release/drift"
chmod +x "$CARGO_TARGET_DIR/release/drift"
touch "$CARGO_TARGET_DIR/release/deps/libdep.rlib" "$CARGO_TARGET_DIR/release/deps/libdrift_mine.rlib"
EOF

# drift: `check --format F` prints $FAKE_DRIFT_<F> (a file) and exits $FAKE_DRIFT_<F>_EXIT.
cat >"$fakes/drift" <<'EOF'
#!/usr/bin/env bash
echo "drift $*" >>"$FAKE_LOG"
fmt=""
prev=""
for a in "$@"; do
  if [ "$prev" = --format ]; then fmt="$a"; fi
  if [ "$a" = --json ]; then fmt=securityjson; fi
  if [ "$a" = --github ]; then fmt=securitygithub; fi
  prev="$a"
done
var="FAKE_DRIFT_$fmt"
exitvar="FAKE_DRIFT_${fmt}_EXIT"
if [ -n "${!var:-}" ]; then cat "${!var}"; else echo "drift-fake $fmt"; fi
exit "${!exitvar:-0}"
EOF
chmod +x "$fakes"/*
export PATH="$fakes:$PATH"

# A fresh environment for one case: its own log, outputs, temp and home.
begin() {
  current="$1"
  case_dir="$root/case-$((pass + fail))-$RANDOM"
  mkdir -p "$case_dir/tmp" "$case_dir/home"
  export FAKE_LOG="$case_dir/log" GITHUB_OUTPUT="$case_dir/out" RUNNER_TEMP="$case_dir/tmp" DRIFT_HOME="$case_dir/home"
  : >"$FAKE_LOG"
  : >"$GITHUB_OUTPUT"
  unset FAKE_GH_FAIL FAKE_GH_COMMENTS FAKE_RELEASES FAKE_LS_REMOTE GITHUB_ENV DRIFT_REF DRIFT_ACTION_REF DRIFT_ACTION_PATH \
    DRIFT_SHA DRIFT_TAG DRIFT_SOURCE DRIFT_ARGS DRIFT_EVENT DRIFT_BASE_REF DRIFT_PR_MODE DRIFT_EXIT_CODE \
    DRIFT_REPORT DRIFT_SECURITY_REPORT DRIFT_BASE DRIFT_HEAD_SHA DRIFT_STATUS DRIFT_STATUS_NAME PR_NUMBER \
    DRIFT_BLOCK DRIFT_ADVISE DRIFT_SECURITY DRIFT_UNCHECKED DRIFT_COMMENT_LIMIT \
    FAKE_DRIFT_github FAKE_DRIFT_github_EXIT FAKE_DRIFT_json FAKE_DRIFT_json_EXIT FAKE_DRIFT_sarif FAKE_DRIFT_sarif_EXIT \
    FAKE_DRIFT_securityjson FAKE_DRIFT_securityjson_EXIT || true
  export RUNNER_OS=Linux RUNNER_ARCH=X64 GITHUB_REPOSITORY=acme/app GITHUB_SERVER_URL=https://github.com GITHUB_RUN_ID=42
}

SHA_TAG=1111111111111111111111111111111111111111
SHA_TAG_OBJ=2222222222222222222222222222222222222222
SHA_MAIN=3333333333333333333333333333333333333333
HEAD_SHA=4444444444444444444444444444444444444444
ls_remote="$root/ls-remote"
cat >"$ls_remote" <<EOF
$SHA_MAIN	refs/heads/main
$SHA_TAG_OBJ	refs/tags/v1.2.3
$SHA_TAG	refs/tags/v1.2.3^{}
$SHA_MAIN	refs/heads/archive/v1.2.3
EOF

# A release of v1.2.3 for every target, as release.yml's "Archive and checksum"
# step lays it out: drift-<tag>-<target>.tar.gz holding the binary at the top,
# and SHA256SUMS in `sha256sum` format.
releases="$root/releases"
mkdir -p "$releases/stage"
printf '#!/bin/sh\necho "drift 1.2.3"\n' >"$releases/stage/drift"
chmod +x "$releases/stage/drift"
for t in x86_64-unknown-linux-musl aarch64-unknown-linux-musl x86_64-apple-darwin aarch64-apple-darwin; do
  tar -C "$releases/stage" -czf "$releases/drift-v1.2.3-$t.tar.gz" drift
done
(
  cd "$releases"
  if command -v sha256sum >/dev/null; then sha256sum ./*.tar.gz; else shasum -a 256 ./*.tar.gz; fi | sed 's# \./# #' >SHA256SUMS
)

install() { bash "$here/install.sh" "$@"; }
check() { bash "$here/check.sh" "$@"; }

# --- install: which Drift --------------------------------------------------

begin "a tag resolves to the commit it points at, and is a release"
export FAKE_LS_REMOTE="$ls_remote" DRIFT_REF=v1.2.3
install resolve 2>/dev/null
expect_eq "$(output "$GITHUB_OUTPUT" sha)" "$SHA_TAG" sha
expect_eq "$(output "$GITHUB_OUTPUT" tag)" v1.2.3 tag
expect_eq "$(output "$GITHUB_OUTPUT" target)" x86_64-unknown-linux-musl target

begin "no drift-ref: the Action's own ref, built from the Action's own files"
src="$case_dir/action"
mkdir -p "$src/crates/drift-cli"
touch "$src/crates/drift-cli/Cargo.toml"
export FAKE_LS_REMOTE="$ls_remote" DRIFT_ACTION_REF=v1.2.3 DRIFT_ACTION_PATH="$src"
install resolve 2>/dev/null
expect_eq "$(output "$GITHUB_OUTPUT" sha)" "$SHA_TAG" sha
expect_eq "$(output "$GITHUB_OUTPUT" tag)" v1.2.3 tag
expect_eq "$(output "$GITHUB_OUTPUT" source)" "$src" source

begin "a local uses: ./ is the checkout's own commit, never main"
src="$case_dir/action"
mkdir -p "$src/crates/drift-cli"
touch "$src/crates/drift-cli/Cargo.toml"
git -C "$src" init -q
git -C "$src" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m one
export FAKE_LS_REMOTE="$ls_remote" DRIFT_ACTION_PATH="$src"
install resolve 2>/dev/null
expect_eq "$(output "$GITHUB_OUTPUT" sha)" "$(git -C "$src" rev-parse HEAD)" sha
expect_eq "$(output "$GITHUB_OUTPUT" tag)" "" tag
expect_not "$FAKE_LOG" "refs/heads/main" "no branch asked for"

begin "a commit SHA that a release tag points at is that release"
export FAKE_LS_REMOTE="$ls_remote" DRIFT_REF="$SHA_TAG"
install resolve 2>/dev/null
expect_eq "$(output "$GITHUB_OUTPUT" sha)" "$SHA_TAG" sha
expect_eq "$(output "$GITHUB_OUTPUT" tag)" v1.2.3 tag

begin "a branch is no release, and archive/v1.2.3 does not match v1.2.3"
export FAKE_LS_REMOTE="$ls_remote" DRIFT_REF=main
install resolve 2>/dev/null
expect_eq "$(output "$GITHUB_OUTPUT" sha)" "$SHA_MAIN" sha
expect_eq "$(output "$GITHUB_OUTPUT" tag)" "" tag

begin "an unknown ref stops the job"
export FAKE_LS_REMOTE="$ls_remote" DRIFT_REF=v9.9.9
if install resolve >"$case_dir/said" 2>&1; then bad "resolved"; else ok; fi
expect_has "$case_dir/said" "::error::" "an error annotation"

begin "a GITHUB_ENV gets a fresh fact cache outside the checkout"
export FAKE_LS_REMOTE="$ls_remote" DRIFT_REF=v1.2.3 GITHUB_ENV="$case_dir/env"
install resolve 2>/dev/null
expect_has "$GITHUB_ENV" "DRIFT_CACHE_DIR=$RUNNER_TEMP/drift-cache." "cache dir"

# --- install: the released binary -----------------------------------------

begin "the release binary is installed after its checksum is verified"
export FAKE_RELEASES="$releases" DRIFT_SHA="$SHA_TAG" DRIFT_TAG=v1.2.3
install release 2>/dev/null >"$case_dir/said"
expect_eq "$(output "$GITHUB_OUTPUT" installed)" true installed
expect_eq "$(output "$GITHUB_OUTPUT" how)" release how
expect_eq "$("$DRIFT_HOME/bin/drift" --version)" "drift 1.2.3" version
expect_eq "$(cat "$DRIFT_HOME/bin/drift.commit")" "$SHA_TAG" stamp
expect_has "$FAKE_LOG" "releases/download/v1.2.3/drift-v1.2.3-x86_64-unknown-linux-musl.tar.gz" "archive name"
expect_has "$FAKE_LOG" "releases/download/v1.2.3/SHA256SUMS" "checksums"

begin "the ARM64 Linux runner takes the aarch64 musl archive"
export FAKE_RELEASES="$releases" DRIFT_SHA="$SHA_TAG" DRIFT_TAG=v1.2.3 RUNNER_ARCH=ARM64
install release >/dev/null 2>&1
expect_has "$FAKE_LOG" "drift-v1.2.3-aarch64-unknown-linux-musl.tar.gz" "archive name"

begin "a checksum that does not match stops the job and installs nothing"
bad_rel="$case_dir/rel"
cp -r "$releases" "$bad_rel"
printf 'tampered' >>"$bad_rel/drift-v1.2.3-x86_64-unknown-linux-musl.tar.gz"
export FAKE_RELEASES="$bad_rel" DRIFT_SHA="$SHA_TAG" DRIFT_TAG=v1.2.3
if install release >"$case_dir/said" 2>&1; then bad "installed"; else ok; fi
expect_has "$case_dir/said" "does not match the release's SHA256SUMS" "said why"
[ ! -e "$DRIFT_HOME/bin/drift" ] && ok || bad "a binary was installed"

begin "a binary that reports another version is not installed"
other="$case_dir/rel"
mkdir -p "$other/stage"
printf '#!/bin/sh\necho "drift 9.9.9"\n' >"$other/stage/drift"
chmod +x "$other/stage/drift"
tar -C "$other/stage" -czf "$other/drift-v1.2.3-x86_64-unknown-linux-musl.tar.gz" drift
(cd "$other" && if command -v sha256sum >/dev/null; then sha256sum ./*.tar.gz; else shasum -a 256 ./*.tar.gz; fi | sed 's# \./# #' >SHA256SUMS)
export FAKE_RELEASES="$other" DRIFT_SHA="$SHA_TAG" DRIFT_TAG=v1.2.3
if install release >"$case_dir/said" 2>&1; then bad "installed"; else ok; fi
expect_has "$case_dir/said" "says 'drift 9.9.9'" "said why"

begin "no release for the tag: build from source"
export FAKE_RELEASES="$case_dir/none" DRIFT_SHA="$SHA_TAG" DRIFT_TAG=v1.2.3
install release >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" installed)" false installed

begin "no binary released for Windows on ARM: build from source"
export FAKE_RELEASES="$releases" DRIFT_SHA="$SHA_TAG" DRIFT_TAG=v1.2.3 RUNNER_OS=Windows RUNNER_ARCH=ARM64
install release >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" installed)" false installed
expect_not "$FAKE_LOG" "curl" "nothing downloaded"

begin "a release with no archive for this target: build from source"
partial="$case_dir/rel"
mkdir -p "$partial"
grep -v x86_64-unknown-linux-musl "$releases/SHA256SUMS" >"$partial/SHA256SUMS"
export FAKE_RELEASES="$partial" DRIFT_SHA="$SHA_TAG" DRIFT_TAG=v1.2.3
install release >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" installed)" false installed

# --- install: built from source ---------------------------------------------

begin "built from the Action's files, kept by commit, rebuilt for another"
src="$case_dir/action"
mkdir -p "$src"
export DRIFT_SHA="$SHA_MAIN" DRIFT_SOURCE="$src"
install build >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" how)" build how
expect_has "$FAKE_LOG" "cargo build --release --locked -p drift-cli in $src" "cargo in the source"
expect_eq "$("$DRIFT_HOME/bin/drift" --version)" "drift 0.0.0-built" built
[ -e "$DRIFT_HOME/target/release/deps/libdep.rlib" ] && ok || bad "dependencies not kept for the cache"
[ ! -e "$DRIFT_HOME/target/release/deps/libdrift_mine.rlib" ] && ok || bad "Drift's own crates kept"
: >"$GITHUB_OUTPUT"
install build >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" how)" cached "the same commit again"
: >"$GITHUB_OUTPUT"
DRIFT_SHA="$SHA_TAG" install build >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" how)" build "another commit (a cache restored by prefix)"

begin "built from a fetch of the commit when the Action's files are not it"
upstream="$case_dir/upstream"
git init -q "$upstream"
git -C "$upstream" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m one
want="$(git -C "$upstream" rev-parse HEAD)"
git -C "$upstream" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m two
git -C "$upstream" config uploadpack.allowAnySHA1InWant true
export DRIFT_SHA="$want" DRIFT_REPO_URL="$upstream"
install build >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" how)" build how
expect_has "$FAKE_LOG" "cargo build --release --locked -p drift-cli in $RUNNER_TEMP/drift-src." "cargo in the fetched source"
unset DRIFT_REPO_URL

# --- check: the gate and its outputs ----------------------------------------

begin "a push checks the whole repository; outputs come from the JSON"
export FAKE_DRIFT_github_EXIT=1 FAKE_DRIFT_json="$data/check-pr.json" FAKE_DRIFT_json_EXIT=1 DRIFT_EVENT=push DRIFT_ARGS="--strict"
check gate >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" exit-code)" 1 exit-code
expect_eq "$(output "$GITHUB_OUTPUT" block)" 1 block
expect_eq "$(output "$GITHUB_OUTPUT" advise)" 0 advise
expect_eq "$(output "$GITHUB_OUTPUT" security-findings)" 0 security-findings
expect_eq "$(output "$GITHUB_OUTPUT" security-advice)" 1 security-advice
expect_eq "$(output "$GITHUB_OUTPUT" unchecked)" 0 unchecked
expect_eq "$(output "$GITHUB_OUTPUT" base)" "" base
expect_eq "$(output "$GITHUB_OUTPUT" report)" "$RUNNER_TEMP/drift-check.json" report
expect_has "$FAKE_LOG" "drift check --format github --strict" "args passed"
expect_has "$FAKE_LOG" "drift check --format json --strict" "the same check as JSON"
expect_not "$FAKE_LOG" "--diff-base" "no diff on a push"

begin "a pull request checks what it introduces"
repo="$case_dir/repo"
git init -q "$repo"
git -C "$repo" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m one
git -C "$repo" update-ref refs/remotes/origin/main HEAD
export FAKE_DRIFT_json="$data/check-pr-baseline.json" FAKE_DRIFT_json_EXIT=1 FAKE_DRIFT_github_EXIT=1 \
  DRIFT_EVENT=pull_request DRIFT_BASE_REF=main
(cd "$repo" && check gate >/dev/null 2>&1)
expect_has "$FAKE_LOG" "drift check --format github --diff-base origin/main" "PR mode"
expect_eq "$(output "$GITHUB_OUTPUT" base)" origin/main base
expect_eq "$(output "$GITHUB_OUTPUT" security-findings)" 1 "a finding not in the baseline"
expect_eq "$(output "$GITHUB_OUTPUT" security-advice)" 0 security-advice

begin "pr-mode false checks the whole repository on a pull request"
export FAKE_DRIFT_json="$data/check-clean.json" DRIFT_EVENT=pull_request DRIFT_BASE_REF=main DRIFT_PR_MODE=false
check gate >/dev/null 2>&1
expect_not "$FAKE_LOG" "--diff-base" "no diff"
expect_eq "$(output "$GITHUB_OUTPUT" exit-code)" 0 exit-code
expect_eq "$(output "$GITHUB_OUTPUT" block)" 0 block

begin "files not checked are counted"
export FAKE_DRIFT_json="$data/check-hostile.json" DRIFT_EVENT=push
check gate >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" unchecked)" 1 unchecked
expect_eq "$(output "$GITHUB_OUTPUT" block)" 1 block
expect_eq "$(output "$GITHUB_OUTPUT" advise)" 1 advise

begin "an error of the check is exit 2 and no counts"
export FAKE_DRIFT_github_EXIT=2 FAKE_DRIFT_json_EXIT=2 DRIFT_EVENT=push
check gate >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" exit-code)" 2 exit-code
expect_eq "$(output "$GITHUB_OUTPUT" block)" "" "no count"

begin "a JSON report that does not read fails closed"
garbage="$case_dir/garbage"
echo "not json" >"$garbage"
export FAKE_DRIFT_json="$garbage" DRIFT_EVENT=push
check gate >"$case_dir/said" 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" exit-code)" 2 "exit-code fails"
expect_eq "$(output "$GITHUB_OUTPUT" block)" "" "no count"
expect_has "$case_dir/said" "::error::" "said"

begin "the worse of the two runs stands"
export FAKE_DRIFT_github_EXIT=0 FAKE_DRIFT_json="$data/check-pr.json" FAKE_DRIFT_json_EXIT=1 DRIFT_EVENT=push
check gate >/dev/null 2>&1
expect_eq "$(output "$GITHUB_OUTPUT" exit-code)" 1 exit-code

begin "finish exits with the gate's code, and fails without one"
DRIFT_EXIT_CODE=0 check finish && ok || bad "0 failed"
if DRIFT_EXIT_CODE=1 check finish 2>/dev/null; then bad "1 passed"; else ok; fi
if DRIFT_EXIT_CODE= check finish >/dev/null 2>&1; then bad "no code passed"; else ok; fi

begin "SARIF: exit 1 is expected, an error stops the job"
export FAKE_DRIFT_sarif_EXIT=1
check sarif >/dev/null 2>&1 && ok || bad "exit 1 failed the step"
expect_eq "$(output "$GITHUB_OUTPUT" sarif)" "$RUNNER_TEMP/drift.sarif" sarif
export FAKE_DRIFT_sarif_EXIT=2
if check sarif >/dev/null 2>&1; then bad "exit 2 passed"; else ok; fi

begin "security: the notices, then the JSON for the comment"
repo="$case_dir/repo"
git init -q "$repo"
git -C "$repo" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m one
git -C "$repo" update-ref refs/remotes/origin/main HEAD
export FAKE_DRIFT_securityjson="$data/security-pr.json" DRIFT_EVENT=pull_request DRIFT_BASE_REF=main
(cd "$repo" && check security >/dev/null 2>&1)
expect_has "$FAKE_LOG" "drift security --diff-base origin/main --github" "notices"
expect_eq "$(output "$GITHUB_OUTPUT" security-report)" "$RUNNER_TEMP/drift-security.json" report

# --- the comment -----------------------------------------------------------

comment() { bash "$here/comment.sh" >"$case_dir/said" 2>&1; }
# The JSON body the fake gh was given last.
sent() { grep '^INPUT ' "$FAKE_LOG" | tail -n 1 | cut -c7- | jq -r .body; }
# The pull request's comments the fake gh lists (from stdin; not in a pipeline,
# whose subshell would lose the export).
comments() {
  cat >"$case_dir/comments.json"
  export FAKE_GH_COMMENTS="$case_dir/comments.json"
}

begin "the first comment is created, with its marker, conventions and security"
comments <<<'[{"id": 7, "body": "LGTM", "user": {"type": "User"}}]'
export DRIFT_REPORT="$data/check-pr.json" DRIFT_SECURITY_REPORT="$data/security-pr.json" DRIFT_BASE=origin/main \
  DRIFT_HEAD_SHA="$HEAD_SHA" PR_NUMBER=12
comment
expect_has "$FAKE_LOG" "gh api --method POST repos/acme/app/issues/12/comments" "created"
sent >"$case_dir/body"
expect_eq "$(head -n 1 "$case_dir/body")" "<!-- drift-action:comment -->" "marker first"
expect_has "$case_dir/body" "**Conventions: 1 new violation**: 1 in block mode" "conventions"
expect_has "$case_dir/body" "<code>app&#47;api&#47;new&#47;route&#46;ts&#58;1</code>" "file and line"
expect_has "$case_dir/body" "**Security: 1 finding**" "security, the same place once"
expect_has "$case_dir/body" "https://github.com/acme/app/actions/runs/42" "run link"
expect_has "$case_dir/body" "444444444444" "commit"

begin "a later push edits the comment the Action wrote, not a person's"
comments <<'EOF'
[{"id": 5, "body": "<!-- drift-action:comment -->\nquoted by a person", "user": {"type": "User"}},
 {"id": 9, "body": "<!-- drift-action:comment -->\n### Drift\nold", "user": {"type": "Bot"}}]
EOF
export DRIFT_REPORT="$data/check-pr.json" DRIFT_HEAD_SHA="$HEAD_SHA" PR_NUMBER=12
comment
expect_has "$FAKE_LOG" "gh api --method PATCH repos/acme/app/issues/comments/9" "edited in place"
expect_not "$FAKE_LOG" "--method POST" "no second comment"

begin "the comment of the earlier Action is adopted"
comments <<<'[{"id": 3, "body": "<!-- drift-security -->\n```\nold\n```", "user": {"type": "Bot"}}]'
export DRIFT_REPORT="$data/check-pr.json" PR_NUMBER=12
comment
expect_has "$FAKE_LOG" "gh api --method PATCH repos/acme/app/issues/comments/3" "edited in place"

begin "nothing to say: an existing comment is marked resolved"
comments <<<'[{"id": 9, "body": "<!-- drift-action:comment -->\nold", "user": {"type": "Bot"}}]'
export DRIFT_REPORT="$data/check-clean.json" DRIFT_HEAD_SHA="$HEAD_SHA" PR_NUMBER=12
comment
expect_has "$FAKE_LOG" "gh api --method PATCH repos/acme/app/issues/comments/9" "edited"
sent >"$case_dir/body"
expect_has "$case_dir/body" "Nothing to report" "resolved"
expect_has "$case_dir/body" "<!-- drift-action:comment -->" "keeps its marker"

begin "nothing to say and no comment: nothing is posted"
comments <<<'[]'
export DRIFT_REPORT="$data/check-clean.json" PR_NUMBER=12
comment
expect_not "$FAKE_LOG" "--method" "no write"

begin "text from the repository is data: no HTML, markdown, mention or table break"
comments <<<'[]'
export DRIFT_REPORT="$data/check-hostile.json" PR_NUMBER=12
comment
sent >"$case_dir/body"
# (`&#124;` holds "#1", and the run link is the Action's own "](": the raw forms
# are matched with what surrounds them in the fixture.)
for raw in "<img" "<b>" "@octocat" "@admin" " #1 " "[link](" "**bold**" '`code`' "javascript:" ":smile:" "www.example" "<script>" $'‮'; do
  expect_not "$case_dir/body" "$raw" "raw text"
done
expect_has "$case_dir/body" "&#60;img src&#61;x onerror&#61;alert&#40;1&#41;&#62; &#64;octocat" "escaped"
expect_has "$case_dir/body" "second line" "the newline is a space, the row stays one line"
# Every table row keeps its own four cell separators (three columns), and the
# security table its five.
awk '/^\| (\*\*block\*\*|advise) \|/ { n = gsub(/\|/, "|"); if (n != 4) bad++ } END { exit bad }' "$case_dir/body" && ok || bad "a convention row has a cell too many"
awk '/^\| (\*\*fails\*\*|advice|review) \|/ { n = gsub(/\|/, "|"); if (n != 5) bad++ } END { exit bad }' "$case_dir/body" && ok || bad "a security row has a cell too many"
expect_has "$case_dir/body" "**Not checked: 1 file.**" "unchecked said"
expect_has "$case_dir/body" "1 in block mode (these fail the check), 1 in advise mode" "counts"

begin "a long list is capped, with the rest counted"
comments <<<'[]'
export DRIFT_REPORT="$data/check-many.json" PR_NUMBER=12 DRIFT_COMMENT_LIMIT=20
comment
sent >"$case_dir/body"
expect_eq "$(grep -c '^| \*\*block\*\* |' "$case_dir/body")" 20 "rows listed"
expect_has "$case_dir/body" "…and 5 more violations not listed here" "the rest counted"
expect_has "$case_dir/body" "**Conventions: 25 new violations**" "the total"

begin "not a pull request: no comment, no failure"
export DRIFT_REPORT="$data/check-pr.json"
comment && ok || bad "failed"
expect_not "$FAKE_LOG" "gh" "no call"

begin "a comment that cannot be posted is a warning, not a failure"
export DRIFT_REPORT="$data/check-pr.json" PR_NUMBER=12 FAKE_GH_FAIL=1
comment && ok || bad "failed"
expect_has "$case_dir/said" "::warning::" "warned"

begin "no report (the check did not finish): no comment"
export DRIFT_REPORT="" PR_NUMBER=12
comment && ok || bad "failed"
expect_not "$FAKE_LOG" "gh" "no call"

# --- the status ------------------------------------------------------------

status() { bash "$here/status.sh" >"$case_dir/said" 2>&1; }

begin "a commit status named drift, failing on a block violation"
export DRIFT_STATUS=commit DRIFT_EXIT_CODE=1 DRIFT_BLOCK=1 DRIFT_ADVISE=0 DRIFT_SECURITY=0 DRIFT_UNCHECKED=0 DRIFT_HEAD_SHA="$HEAD_SHA"
status
expect_has "$FAKE_LOG" "gh api --method POST repos/acme/app/statuses/$HEAD_SHA" "posted on the head"
expect_has "$FAKE_LOG" '"state":"failure","context":"drift","description":"1 block, 0 advise, 0 security","target_url":"https://github.com/acme/app/actions/runs/42"' "body"

begin "a check run, passing, with the comment as its summary"
export DRIFT_STATUS=check DRIFT_STATUS_NAME=drift DRIFT_EXIT_CODE=0 DRIFT_BLOCK=0 DRIFT_ADVISE=1 DRIFT_SECURITY=0 DRIFT_UNCHECKED=2 \
  DRIFT_HEAD_SHA="$HEAD_SHA" DRIFT_REPORT="$data/check-hostile.json"
status
expect_has "$FAKE_LOG" "gh api --method POST repos/acme/app/check-runs" "created"
grep '^INPUT ' "$FAKE_LOG" | cut -c7- >"$case_dir/run.json"
expect_eq "$(jq -r '.name, .conclusion, .status, .head_sha' "$case_dir/run.json" | paste -sd' ' -)" "drift success completed $HEAD_SHA" "run"
expect_eq "$(jq -r .output.title "$case_dir/run.json")" "drift: 0 block, 1 advise, 0 security; 2 files not checked" title
jq -r .output.summary "$case_dir/run.json" >"$case_dir/summary"
expect_has "$case_dir/summary" "**Conventions:" "summary"
expect_not "$case_dir/summary" "<img" "escaped"

begin "no exit code (the check never finished) is an error"
export DRIFT_STATUS=commit DRIFT_EXIT_CODE= DRIFT_HEAD_SHA="$HEAD_SHA"
status
expect_has "$FAKE_LOG" '"state":"error"' "error"

begin "off by default: nothing posted"
export DRIFT_EXIT_CODE=1 DRIFT_HEAD_SHA="$HEAD_SHA"
status
expect_eq "$(wc -c <"$FAKE_LOG" | tr -d ' ')" 0 "no call"

begin "a status that cannot be posted is a warning"
export DRIFT_STATUS=commit DRIFT_EXIT_CODE=1 DRIFT_HEAD_SHA="$HEAD_SHA" FAKE_GH_FAIL=1
status && ok || bad "failed"
expect_has "$case_dir/said" "statuses: write" "says which permission"

# --- action.yml calls what is here -----------------------------------------

begin "every script action.yml calls exists, with that subcommand"
action="$here/../../action.yml"
grep -oE 'scripts/action/[a-z]+\.sh( [a-z]+)?$' "$action" | sort -u >"$case_dir/calls"
expect_eq "$(wc -l <"$case_dir/calls" | tr -d ' ')" 9 "script calls"
while read -r script sub; do
  f="$here/../../$script"
  [ -f "$f" ] && ok || bad "$script is missing"
  if [ -n "$sub" ]; then grep -qE "^  $sub\)" "$f" && ok || bad "$script has no '$sub'"; fi
done <"$case_dir/calls"
expect_not "$action" "cargo install" "no cargo install"
expect_not "$action" 'default: "main"' "no floating default"

begin "the Action downloads what release.yml publishes, from the repository npm names"
release_yml="$here/../../.github/workflows/release.yml"
# The archive and checksum names this script expects, as release.yml writes them.
expect_has "$release_yml" 'out/drift-${GITHUB_REF_NAME}-${target}.tar.gz' "archive name in release.yml"
expect_has "$release_yml" 'sha256sum *.tar.gz > SHA256SUMS' "checksums in release.yml"
expect_has "$release_yml" 'tags: ["v*.*.*"]' "release tags"
for t in x86_64-unknown-linux-musl aarch64-unknown-linux-musl x86_64-apple-darwin aarch64-apple-darwin x86_64-pc-windows-msvc; do
  expect_has "$release_yml" "target: $t," "release.yml builds $t"
  expect_has "$here/install.sh" "echo $t ;;" "install.sh maps a runner to $t"
done
repo_url="$(jq -r .repository "$here/../../npm/config.json")"
expect_has "$here/install.sh" "REPO_URL=\"\${DRIFT_REPO_URL:-$repo_url}\"" "the repository"

printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
