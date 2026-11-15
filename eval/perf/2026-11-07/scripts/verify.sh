#!/bin/bash
# verify.sh A B outdir: census --json of binaries A and B on all 34 dev clones, compared without `commit`.
P=/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/perf
A=$1; B=$2; O=$3; mkdir -p $O
same=0; diff=0
for r in $P/../dev-clones/*/*; do
  n=$(basename $(dirname $r))-$(basename $r)
  for x in A B; do
    while [ "$(free -g | awk '/Mem:/{print $7}')" -lt 4 ]; do sleep 30; done
    exe=${!x}; C=$P/vcache; rm -rf "$C"; mkdir -p "$C"
    DRIFT_CACHE_DIR=$C $exe --root $r census --json --max 15 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); d.pop('commit',None); print(json.dumps(d,indent=1,sort_keys=False))" > $O/$n.$x.json
  done
  if cmp -s $O/$n.A.json $O/$n.B.json; then same=$((same+1)); else diff=$((diff+1)); echo "DIFF $n"; fi
done
rm -rf $P/vcache
echo "identical=$same differ=$diff"
