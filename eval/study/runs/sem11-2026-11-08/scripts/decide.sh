#!/bin/bash
# usage: payloads.sh BIN PART REPO RUNPART_DIR -> $W/payloads/<repo>.json ; never writes into the dev clone
set -euo pipefail
W=/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/sem11
S=/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad
BIN=$1; PART=$2; REPO=$3; RD=$4
SRC=$S/dev-clones/$PART/$REPO; CO=$W/co/$REPO
while [ "$(free -g | awk '/Mem/{print $7}')" -lt 4 ]; do sleep 30; done
rm -rf "$CO"; cp -al "$SRC" "$CO"
[ ! -e "$CO/.drift" ] && [ ! -e "$CO/drift.lock" ]
mkdir "$CO/.drift"; printf 'proposals:\n  python: on\n' > "$CO/.drift/config.yaml"
python3 -I $W/mkpolicy.py "$RD" "$REPO" "$CO/.drift/conventions.yaml" $W/ids.json
export DRIFT_CACHE_DIR=$W/dcache; rm -rf $DRIFT_CACHE_DIR
"$BIN" --root "$CO" --no-cache init --max 15 --all > $W/outcomes/$REPO.init.txt 2>&1
grep -qE '^  semantic: "?on"?' "$CO/.drift/conventions.yaml" || { echo "semantic setting lost"; exit 4; }
python3 -I $W/mkreplies.py $W/ids.json $REPO $W/srun/raw $W/payloads/$REPO.json > $W/req.json
python3 -I $W/mcp_call.py "$BIN" "$CO" $W/outcomes/$REPO.json $W/req.json
rm -rf "$CO" $DRIFT_CACHE_DIR
st=$(git -C "$SRC" status --short | head -3); [ -z "$st" ] || { echo "SOURCE DIRTY: $SRC $st"; exit 3; }
