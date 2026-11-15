#!/bin/bash
# usage: census.sh <binary> <outdir> [--imports]
set -u
B=$1; OUT=$2; IMP=${3:-}
C=<scratch>/dev-clones
mkdir -p "$OUT/census-json" "$OUT/all-json" "$OUT/imports"
export DRIFT_CACHE_DIR="$OUT/.cache"
for part in ts py py2 dev3; do
  for r in "$C/$part"/*; do
    n=$(basename "$r")
    [ -s "$OUT/census-json/$n.json" ] && continue
    while [ "$(free -g | awk '/Mem:/{print $7}')" -lt 4 ]; do sleep 30; done
    "$B" --root "$r" census --json --max 15 --python-proposals > "$OUT/census-json/$n.json.tmp" 2>>"$OUT/err.log" && mv "$OUT/census-json/$n.json.tmp" "$OUT/census-json/$n.json"
    if [ -n "$IMP" ]; then
      "$B" --root "$r" census --json --max 200 --tier all --python-proposals --suggestions 200 > "$OUT/all-json/$n.json" 2>>"$OUT/err.log"
      "$B" --root "$r" debug imports > "$OUT/imports/$n.jsonl" 2>>"$OUT/err.log"
    fi
    rm -rf "$OUT/.cache"
    echo "$n done $(date +%T)" >> "$OUT/progress.log"
  done
done
echo ALLDONE >> "$OUT/progress.log"
