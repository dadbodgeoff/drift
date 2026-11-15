#!/bin/bash
# The verifier's decision, by the product: for each repo with collected replies (<private>/verdicts/<repo>.json,
# verifier.mjs collect), rebuild the census checkout at the pin exactly as restage.sh did (alternates, read-only),
# `drift init --max 15`, accept the same shown suggestion-tier cards, set `agents.verify: on`, and send each card's
# 3 replies to `drift mcp` (drift_verify_card with id, content_hash, verdicts). The product checks the content hash
# (the payload is rebuilt: a changed card would be refused), parses each reply (Sample::parse), decides (decide: 2 of 3)
# and caches; the verdict is read back from .drift/verify-cache.json into verifier/outcomes.jsonl.
#
#   SCRATCH=<scratch> eval/study/runs/dev-v3-relabel5-2026-11-07/decide.sh <worktree> <binary> <private>
set -euo pipefail
: "${SCRATCH:?}"
WT=$(cd "$1" && pwd); BIN=$2; PRIV=$3
DEV=$(dirname "$SCRATCH")/dev-clones
RUN=$WT/eval/study/runs/dev-v3-relabel5-2026-11-07
OUT=$RUN/verifier/outcomes.jsonl; : > "$OUT"
WORK=$SCRATCH/decide; mkdir -p "$WORK"; export DRIFT_CACHE_DIR=$WORK/driftcache
declare -A MAN=([ts]=eval/repos.json [py]=eval/repos-py.json [py2]=eval/repos-py-2.json)
pin() { python3 -c "import json,sys;print([r['sha'] for r in json.load(open(sys.argv[1]))['repos'] if r['name']==sys.argv[2]][0])" "$1" "$2"; }
share() { rm -rf "${3:?}"; mkdir -p "$3"; git -C "$3" init -q; echo "$1/.git/objects" > "$3/.git/objects/info/alternates"; if [ -f "$1/.git/shallow" ]; then cp "$1/.git/shallow" "$3/.git/shallow"; fi; git -C "$3" checkout -q --force "$2"; [ "$(git -C "$3" rev-parse HEAD)" = "$2" ]; }
cd "$WT"
for vf in "$PRIV"/verdicts/*.json; do
  r=$(basename "$vf" .json)
  part=$(python3 -c "import json,sys;print([p for p in ('ts','py','py2') if any(x['name']==sys.argv[1] for x in json.load(open(sys.argv[2]+'/'+p+'/run.json'))['repos'])][0])" "$r" "$RUN")
  while [ "$(free -g | awk '/Mem:/{print $7}')" -lt 4 ]; do sleep 30; done
  while [ "$(df --output=avail -k / | tail -1)" -lt 1572864 ]; do sleep 60; done
  co=$WORK/repos/$r
  share "$DEV/$part/$r" "$(pin "${MAN[$part]}" "$r")" "$co"
  ids=$(python3 -c "import json,sys;print(','.join(p['id'] for p in json.load(open(sys.argv[1]))['proposals'] if p['tier']=='suggestion'))" "$RUN/census-json/$r.json")
  "$BIN" --root "$co" init --max 15 > /dev/null
  "$BIN" --root "$co" review --accept "$ids" | tail -1
  f=$co/.drift/conventions.yaml; { cat "$f"; printf 'agents:\n  verify: on\n'; } > "$f.tmp" && mv "$f.tmp" "$f"
  python3 -I "$RUN/mcp_decide.py" "$BIN" "$co" "$vf" "$OUT" "$r"
  rm -rf "${co:?}" "${DRIFT_CACHE_DIR:?}"
done
rm -rf "${WORK:?}"
echo "outcomes: $(wc -l < "$OUT") cards -> $OUT"
