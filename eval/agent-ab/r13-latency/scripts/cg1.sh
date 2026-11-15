#!/bin/bash
# cg1.sh repo relfile : one PostToolUse (after a comment-line edit) under callgrind, main binary.
set -e
ME=/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/r13h-agentproof
W=$ME/lat/work-main/$1; F=$2
printf '{"session_id":"cg-%s","cwd":"%s","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"%s/%s","old_string":"x","new_string":"y"},"tool_response":{"success":true}}' "$(date +%s%N)" "$W" "$W" "$F" > $ME/lat/in-cg.json
cp "$W/$F" $ME/lat/keep.cg; (cat $ME/lat/keep.cg; echo "// cg $(date +%s%N)") > "$W/$F.tmp" && mv "$W/$F.tmp" "$W/$F"
valgrind --tool=callgrind --callgrind-out-file=$ME/lat/cg-$1.out /home/user/drift-bin/sec167/drift hook claude PostToolUse < $ME/lat/in-cg.json > /dev/null 2>$ME/lat/cg-$1.err
cp $ME/lat/keep.cg "$W/$F.tmp" && mv "$W/$F.tmp" "$W/$F"
callgrind_annotate --inclusive=yes --threshold=100 $ME/lat/cg-$1.out > $ME/lat/cg-$1.txt 2>/dev/null
