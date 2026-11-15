#!/bin/bash
# Re-stage this relabel on another main, in one command: build a verified release binary, census every dev repo one at
# a time, diff each card against its newest label, and stage what needs a fresh label (labels nothing).
#
#   SCRATCH=<your scratch folder> eval/study/runs/dev-v3-relabel4-2026-11-07/restage.sh <worktree> <run-name> [CGU]
#
# relabel5 (2026-11-07, main de57356): relabel4's restage.sh with three changes:
#   - it runs THIS run's stage.mjs (relabel4's with the stricter carry rule: a changed lift relabels [STRICT]);
#   - PREBUILT=<binary> skips the build (the binary must come from build-verified.sh at this worktree's HEAD; its
#     census `commit` tag is checked to name HEAD);
#   - the verifier (D10.3 first check): in each census checkout, after the census, `drift init --max 15`, accept every
#     shown suggestion-tier card (`drift review --accept`), set `agents.verify: on`, and ask the product's own MCP
#     server (`drift mcp`, tool drift_verify_card with only `id`) for each card's payload. The payloads quote the
#     repository, so they are written to $SCRATCH/verifier/payloads/<repo>.json, outside the repository; the run
#     records only ids, content hashes and members (verifier/payloads.jsonl, by verifier.mjs).
#
# relabel4: a copy of dev-v3-relabel3-2026-11-07/restage.sh (it still runs that run's stage.mjs, copied into the
# new run) with two changes, both for disk: before each repo's census it prints `df -h /` and waits while under 1.5 GB
# is free, and each census checkout borrows the dev clone's objects (alternates, read-only) instead of fetching a pack.
#
#   <worktree>  a clean Drift worktree checked out at the main to measure (the run is written into it, under
#               eval/study/runs/<run-name>/); it must contain this script's run directory (for stage.mjs)
#   <run-name>  a NEW run directory name, e.g. dev-v3-relabel4-2026-11-08. A run is one frozen product
#               (prepare.mjs refuses another binary in an existing run, stage.mjs refuses to restage once prompts exist)
#   CGU         codegen-units for build-verified.sh (default 29, relabel3prep's)
#
# Label sources: stage.mjs's defaults (relabel2, relabel, dev-v3). Once a newer round is labelled (e.g. this run's
# <part>/final.jsonl after `stage.mjs final`), list it first in <worktree>/eval/study/runs/<run-name>/sources.json
# before running, e.g. {"ts": ["dev-v3-relabel3-2026-11-07/ts", "dev-v3-relabel2-2026-11-07/ts", ...], ...}.
#
# Rules kept (BRIEF): one drift process at a time; waits while free memory is under 4 GB; a private DRIFT_CACHE_DIR,
# deleted after each repo; the dev clones are only read. Checkouts are `git fetch --depth 1 file://<clone>` into fresh
# repositories (their own inodes, never `cp -al`), so nothing here can write into a dev clone; each is deleted after its
# census. A part whose dev clones are not all clean (e.g. a stray ignored __pycache__) gets private clean checkouts for
# the labellers, kept in <scratchpad>/co-<random>/<part> (only the repos with cards to label are kept); the outboxes are
# in <scratchpad>/lbx-<random>/outbox. Neither path names the run, the stage or the labeller.
set -euo pipefail
: "${SCRATCH:?set SCRATCH to your scratch folder}"
WT=$(cd "$1" && pwd); NAME=$2; CGU=${3:-29}
SHARED=$(dirname "$SCRATCH")/shared; DEV=$(dirname "$SCRATCH")/dev-clones
# Paths the labellers see (outboxes, private checkouts) are neutral: beside the dev clones, named by a random tag.
TAG=$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n'); NEUTRAL=$(dirname "$SCRATCH")
HERE=eval/study/runs/$NAME
RUN=eval/study/runs/$NAME
cd "$WT"
[ -f "$HERE/stage.mjs" ] || { echo "no $HERE/stage.mjs in $WT"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=all -- crates Cargo.toml Cargo.lock)" ] || { echo "$WT has uncommitted product changes"; exit 1; }
COMMIT=$(git rev-parse HEAD); SHORT=${COMMIT:0:7}
WORK=$SCRATCH/restage-$SHORT; mkdir -p "$WORK"
BIN=$WORK/drift-main-$SHORT

# 1. verified release binary (worktree-unique codegen-units; census --json commit checked against a fresh tag)
df -h / | tail -1
if [ -n "${PREBUILT:-}" ]; then
  cp "$PREBUILT" "$BIN"
  tag=$(DRIFT_CACHE_DIR=$(mktemp -d) "$BIN" --root "$SHARED/tiny" census --json --max 1 | python3 -c "import json,sys;print(json.load(sys.stdin)['commit'])")
  case $tag in cgu$CGU-$SHORT-*) echo "prebuilt $tag";; *) echo "prebuilt binary is $tag, not cgu$CGU-$SHORT"; exit 1;; esac
else
  "$SHARED/build-verified.sh" "$CGU" "$WT" "$BIN" | tail -2
fi
[ -x "$BIN" ] || { echo "build failed"; exit 1; }
PAY=$SCRATCH/verifier/payloads; mkdir -p "$PAY"

# 2. census, one repo at a time: prepare.mjs --only <repo> (text census --all-outliers, pool, init) and census --json
mkdir -p "$RUN/census-json"
names() { python3 -c "import json,sys;print(' '.join(r['name'] for r in json.load(open(sys.argv[1]))['repos'] if r['name'] not in ('polar','CTFd')))" "$1"; }
pin() { python3 -c "import json,sys;print([r['sha'] for r in json.load(open(sys.argv[1]))['repos'] if r['name']==sys.argv[2]][0])" "$1" "$2"; }
fetch() { rm -rf "${3:?}"; mkdir -p "$3"; git -C "$3" init -q; git -C "$3" fetch -q --depth 1 "file://$1" "$2"; git -C "$3" checkout -q --force "$2"; }
# relabel4 (disk): the census checkouts borrow the dev clone's objects read-only through objects/info/alternates instead
# of copying a pack (infisical's alone is ~1 GB); git never writes into an alternate. Same tree at the pin, own inodes.
share() { rm -rf "${3:?}"; mkdir -p "$3"; git -C "$3" init -q; echo "$1/.git/objects" > "$3/.git/objects/info/alternates"; if [ -f "$1/.git/shallow" ]; then cp "$1/.git/shallow" "$3/.git/shallow"; fi; git -C "$3" checkout -q --force "$2"; [ "$(git -C "$3" rev-parse HEAD)" = "$2" ]; }
export DRIFT_CACHE_DIR=$WORK/driftcache
declare -A MAN=([ts]=eval/repos.json [py]=eval/repos-py.json [py2]=eval/repos-py-2.json)
for part in ts py py2; do
  for r in $(names "${MAN[$part]}"); do
    while [ "$(free -g | awk '/Mem:/{print $7}')" -lt 4 ]; do sleep 30; done
    # disk (relabel4): report free space before each repo, and wait while under 1.5 GB
    df -h / | tail -1
    while [ "$(df --output=avail -k / | tail -1)" -lt 1572864 ]; do sleep 60; done
    co=$WORK/cache/repos/$r
    # resume (relabel5): a repo whose census and payloads are done is not run again
    if [ -f "$RUN/census-json/$r.json" ] && { [ -f "$PAY/$r.json" ] || ! python3 -c "import json,sys;sys.exit(0 if any(p['tier']=='suggestion' for p in json.load(open(sys.argv[1]))['proposals']) else 1)" "$RUN/census-json/$r.json"; }; then echo "$r: done"; continue; fi
    share "$DEV/$part/$r" "$(pin "${MAN[$part]}" "$r")" "$co"
    node eval/study/prepare.mjs --drift "$BIN" --drift-src . --manifest "${MAN[$part]}" --run "$RUN/$part" --cache "$WORK/cache" --only "$r" 2>&1 | { grep -v "queued from" || true; } | tail -2
    "$BIN" --root "$co" --no-cache census --json --max 15 > "$RUN/census-json/$r.json"
    [ -z "$(git -C "$co" status --porcelain --ignored --untracked-files=all)" ] || { echo "census wrote into $co"; exit 1; }
    # verifier payloads (relabel5): the shown suggestion-tier cards, accepted in this scratch checkout only
    ids=$(python3 -c "import json,sys;print(','.join(p['id'] for p in json.load(open(sys.argv[1]))['proposals'] if p['tier']=='suggestion'))" "$RUN/census-json/$r.json")
    if [ -n "$ids" ]; then
      # init at the census's --max (15, also init's default): at --max 200 the policy can hold a merged card instead of
      # the unmerged one census --max 15 shows (documenso D-a10f62; D's sibling merging sees more candidates)
      "$BIN" --root "$co" init --max 15 > /dev/null
      "$BIN" --root "$co" review --accept "$ids" | tail -1
      f=$co/.drift/conventions.yaml; { cat "$f"; printf 'agents:\n  verify: on\n'; } > "$f.tmp" && mv "$f.tmp" "$f"
      python3 -I "$SCRATCH/scripts/mcp_payloads.py" "$BIN" "$co" "$PAY/$r.json" ${ids//,/ }
    fi
    rm -rf "${co:?}" "${DRIFT_CACHE_DIR:?}"
  done
done
rm -rf "${WORK:?}/cache"
echo "census and payloads done for every repo"

# 3. checkouts the labellers open: the dev clones, or private clean copies for a part with an unclean clone
declare -A CO
for part in ts py py2; do
  CO[$part]=$DEV/$part
  for r in $(names "${MAN[$part]}"); do
    if [ -n "$(GIT_OPTIONAL_LOCKS=0 git -C "$DEV/$part/$r" status --porcelain --ignored --untracked-files=all)" ]; then CO[$part]=$NEUTRAL/co-$TAG/$part; fi
  done
  if [ "${CO[$part]}" != "$DEV/$part" ]; then
    echo "$part: a dev clone is not clean; private checkouts in ${CO[$part]}"
    for r in $(names "${MAN[$part]}"); do fetch "$DEV/$part/$r" "$(pin "${MAN[$part]}" "$r")" "${CO[$part]}/$r"; done
  fi
done

# 4. diff against the newest labels, carry or relabel, the D7 view; A prompts; batches; carried-only metrics
node "$RUN/stage.mjs" stage --checkouts-ts "${CO[ts]}" --checkouts-py "${CO[py]}" --checkouts-py2 "${CO[py2]}" --cache "$NEUTRAL/lbx-$TAG"
for part in ts py py2; do
  if [ "${CO[$part]}" != "$DEV/$part" ]; then  # keep only the private checkouts the labellers need
    keep=$( [ -f "$RUN/$part/relabel/run.json" ] && python3 -c "import json,sys;print(' '.join(r['name'] for r in json.load(open(sys.argv[1]))['repos']))" "$RUN/$part/relabel/run.json" || true)
    for d in "${CO[$part]}"/*; do case " $keep " in *" $(basename "$d") "*) ;; *) rm -rf "${d:?}" ;; esac; done
  fi
  [ -f "$RUN/$part/relabel/run.json" ] && node eval/study/prompt.mjs label --run "$RUN/$part/relabel" --labeller A --rubric v3 | tail -1
  # metrics.mjs refuses a view whose relabel/ is not labelled yet unless --allow-incomplete says why (recorded)
  inc=(); [ -f "$RUN/$part/relabel/run.json" ] && inc=(--allow-incomplete "carried labels only, before the relabel is labelled: the cards to label count as WRONG")
  node eval/study/metrics.mjs --run "$RUN/$part/views/d7" --labels "$RUN/$part/carried.jsonl" "${inc[@]}" --json "$RUN/$part/views/d7/metrics-carried-only.json" > "$RUN/$part/views/d7/metrics-carried-only.md"
done
node "$RUN/stage.mjs" batches > /dev/null
rm -rf "${DRIFT_CACHE_DIR:?}"

# 5. the dev clones were only read
for part in ts py py2; do for r in $(names "${MAN[$part]}"); do
  [ "$(git -C "$DEV/$part/$r" rev-parse HEAD)" = "$(pin "${MAN[$part]}" "$r")" ] || echo "WARNING: $part/$r is not at its pin"
done; done
echo "staged $RUN at $SHORT (binary $(sha256sum "$BIN" | cut -c1-12)); delete $BIN when done"
