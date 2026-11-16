#!/bin/bash
# Poor man's profiler: backtraces of one hook run, sampled with gdb.
# usage: sample.sh WORKDIR EVENT JSON OUT
W=$1; EV=$2; JSON=$3; OUT=$4
E=${DRIFT_EXE:?the drift release binary to sample}
cd "$W" || exit 2
: > "$OUT"
echo "$JSON" | env -u CLAUDECODE $E hook claude "$EV" > /dev/null &
pid=$!
while kill -0 $pid 2>/dev/null; do
  gdb -p $pid -batch -ex "set pagination off" -ex "thread apply all bt 40" 2>/dev/null | grep -E "^(#|Thread )" >> "$OUT"
  echo "----" >> "$OUT"
done
wait $pid
grep -c -- '----' "$OUT"
