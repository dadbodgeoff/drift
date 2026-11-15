#!/bin/bash
# Re-stage this relabel on another main, in one command: build a verified release binary, census every dev repo one at
# a time, diff each card against its newest label, and stage what needs a fresh label (labels nothing).
#
#   SCRATCH=<your scratch folder> eval/study/runs/dev-v3-relabel3-2026-11-07/restage.sh <worktree> <run-name> [CGU]
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
HERE=eval/study/runs/dev-v3-relabel3-2026-11-07
RUN=eval/study/runs/$NAME
cd "$WT"
[ -f "$HERE/stage.mjs" ] || { echo "no $HERE/stage.mjs in $WT"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=all -- crates Cargo.toml Cargo.lock)" ] || { echo "$WT has uncommitted product changes"; exit 1; }
COMMIT=$(git rev-parse HEAD); SHORT=${COMMIT:0:7}
WORK=$SCRATCH/restage-$SHORT; mkdir -p "$WORK"
BIN=$WORK/drift-main-$SHORT

# 1. verified release binary (worktree-unique codegen-units; census --json commit checked against a fresh tag)
df -h / | tail -1
"$SHARED/build-verified.sh" "$CGU" "$WT" "$BIN" | tail -2
[ -x "$BIN" ] || { echo "build failed"; exit 1; }

# 2. census, one repo at a time: prepare.mjs --only <repo> (text census --all-outliers, pool, init) and census --json
mkdir -p "$RUN/census-json"
[ "$NAME" = dev-v3-relabel3-2026-11-07 ] || cp "$HERE/stage.mjs" "$RUN/stage.mjs"
names() { python3 -c "import json,sys;print(' '.join(r['name'] for r in json.load(open(sys.argv[1]))['repos'] if r['name'] not in ('polar','CTFd')))" "$1"; }
pin() { python3 -c "import json,sys;print([r['sha'] for r in json.load(open(sys.argv[1]))['repos'] if r['name']==sys.argv[2]][0])" "$1" "$2"; }
fetch() { rm -rf "${3:?}"; mkdir -p "$3"; git -C "$3" init -q; git -C "$3" fetch -q --depth 1 "file://$1" "$2"; git -C "$3" checkout -q --force "$2"; }
export DRIFT_CACHE_DIR=$WORK/driftcache
declare -A MAN=([ts]=eval/repos.json [py]=eval/repos-py.json [py2]=eval/repos-py-2.json)
for part in ts py py2; do
  for r in $(names "${MAN[$part]}"); do
    while [ "$(free -g | awk '/Mem:/{print $7}')" -lt 4 ]; do sleep 30; done
    co=$WORK/cache/repos/$r
    fetch "$DEV/$part/$r" "$(pin "${MAN[$part]}" "$r")" "$co"
    node eval/study/prepare.mjs --drift "$BIN" --drift-src . --manifest "${MAN[$part]}" --run "$RUN/$part" --cache "$WORK/cache" --only "$r" 2>&1 | { grep -v "queued from" || true; } | tail -2
    "$BIN" --root "$co" --no-cache census --json --max 15 > "$RUN/census-json/$r.json"
    [ -z "$(git -C "$co" status --porcelain --ignored --untracked-files=all)" ] || { echo "census wrote into $co"; exit 1; }
    rm -rf "${co:?}" "${DRIFT_CACHE_DIR:?}"
  done
done
rm -rf "${WORK:?}/cache"

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
