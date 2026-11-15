#!/bin/bash
# relabel5: re-run restage.sh's step 4 only (diff against the newest labels, carry or relabel, D7 view, A prompts,
# batches, carried-only metrics) on the census already in this run, with a fresh neutral outbox root. Used once, after
# the first A prompts were withdrawn unlaunched because they showed the census `agents:` line (README, Deviations).
#   SCRATCH=<scratch> eval/study/runs/dev-v3-relabel5-2026-11-07/restage-stage.sh <worktree> <py2 private checkouts>
set -euo pipefail
: "${SCRATCH:?}"
WT=$(cd "$1" && pwd); CO_PY2=$2
DEV=$(dirname "$SCRATCH")/dev-clones; NEUTRAL=$(dirname "$SCRATCH")
TAG=$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')
RUN=eval/study/runs/dev-v3-relabel5-2026-11-07
cd "$WT"
for part in ts py py2; do rm -rf "${RUN:?}/$part/relabel"; done
node "$RUN/stage.mjs" stage --checkouts-ts "$DEV/ts" --checkouts-py "$DEV/py" --checkouts-py2 "$CO_PY2" --cache "$NEUTRAL/lbx-$TAG"
for part in ts py py2; do
  [ -f "$RUN/$part/relabel/run.json" ] && node eval/study/prompt.mjs label --run "$RUN/$part/relabel" --labeller A --rubric v3 | tail -1
  inc=(); [ -f "$RUN/$part/relabel/run.json" ] && inc=(--allow-incomplete "carried labels only, before the relabel is labelled: the cards to label count as WRONG")
  node eval/study/metrics.mjs --run "$RUN/$part/views/d7" --labels "$RUN/$part/carried.jsonl" "${inc[@]}" --json "$RUN/$part/views/d7/metrics-carried-only.json" > "$RUN/$part/views/d7/metrics-carried-only.md"
done
node "$RUN/stage.mjs" batches > /dev/null
echo "restaged at lbx-$TAG"
