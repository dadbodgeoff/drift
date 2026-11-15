#!/bin/bash
# usage: cgrun.sh BIN TAG repo...   warm census under callgrind (cache warmed natively first)
T=/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tscpu; DC=/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/dev-clones
BIN=$1; TAG=$2; shift 2
for r in "$@"; do
  while [ "$(free -g | awk '/Mem:/{print $7}')" -lt 4 ]; do sleep 30; done
  C=$T/cache/$TAG-$r; rm -rf $C; mkdir -p $C
  DRIFT_CACHE_DIR=$C $BIN --root $DC/ts/$r census --json --max 15 > /dev/null
  DRIFT_CACHE_DIR=$C timeout 3600 valgrind --tool=callgrind --callgrind-out-file=$T/cg/$r.$TAG.cg $BIN --root $DC/ts/$r census --json --max 15 > /dev/null 2> $T/cg/$r.$TAG.log
  grep refs $T/cg/$r.$TAG.log; rm -rf $C
done
