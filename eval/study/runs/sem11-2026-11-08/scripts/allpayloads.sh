#!/bin/bash
while read part repo rd; do echo "== $part $repo $(date +%T)"; /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/sem11/payloads.sh /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/sem11/bin/drift $part $repo $rd 2>&1 | tail -2; done < /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/sem11/jobs.txt
echo ALLDONE
