#!/bin/bash
T=/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/tscpu
cd $T
python3 -I bench2.py $T/run census > $T/run-census.log 2>&1
python3 -I bench2.py $T/run hook $(for r in $(ls ../dev-clones/ts); do echo ts/$r; done) py/netbox > $T/run-hook.log 2>&1
python3 -I bench2.py $T/run checkjson ts/twenty ts/cal.com ts/dub ts/nest py/netbox > $T/run-cj.log 2>&1
echo ALLDONE >> $T/run-cj.log
