import json,statistics as st,sys
from collections import defaultdict
b=defaultdict(list)
for l in open(sys.argv[1]):
  r=json.loads(l)
  if 'wall' in r: b[(r['repo'],r['bin'],r['metric'])].append(r)
print("| repo | binary | metric | n | p50 wall s | p90 | max | p50 CPU s | p50 RSS MB |")
print("|---|---|---|---|---|---|---|---|---|")
for k,v in sorted(b.items()):
  w=sorted(x['wall'] for x in v); c=sorted(x['user']+x['sys'] for x in v); m=sorted(x['rss_kb']/1024 for x in v)
  print(f"| {k[0]} | {k[1]} | {k[2]} | {len(v)} | {st.median(w):.3f} | {w[int(.9*(len(w)-1))]:.3f} | {w[-1]:.3f} | {st.median(c):.3f} | {st.median(m):.0f} |")
for binname in ('pilot','main'):
  for met in ('pre','post'):
    w=[x['wall'] for k,v in b.items() if k[1]==binname and k[2]==met for x in v]
    print(binname,met,'pooled n',len(w),'p50 %.3f'%st.median(w),'p90 %.3f'%sorted(w)[int(.9*(len(w)-1))])
