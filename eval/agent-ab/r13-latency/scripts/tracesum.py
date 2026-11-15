import json,sys,glob,os
from collections import defaultdict,Counter
D=sys.argv[1]
def q(v,p):
  v=sorted(v); return v[min(len(v)-1,int(round(p*(len(v)-1))))] if v else None
rows=[]
for f in sorted(glob.glob(f"{D}/*-*.jsonl")):
  repo,pol=os.path.basename(f)[:-6].split('-',1)
  for l in open(f):
    r=json.loads(l); r['repo']=repo; r['policy']=pol
    k=r['event']
    if k=='PostToolUse': k='PostToolUse:'+('non-source' if r.get('reason')=='not_source' else 'source')
    if k=='Stop': k='Stop:'+('scan' if r.get('scanned') else 'no-scan')
    r['kind']=k; rows.append(r)
PH=['total','stdin','policy_root','policy','cache_dir','walk','index_read','pool','classify','index_write','link','needs_full_scan','full_scan','check','state','output']
print("### Phase p50 / p95 (ms) per hook kind, policy and repo\n")
print("| repo | policy | hook | n | "+" | ".join(PH)+" |"); print("|"+"---|"*(4+len(PH)))
g=defaultdict(list)
for r in rows: g[(r['repo'],r['policy'],r['kind'])].append(r)
for k in sorted(g):
  rs=g[k]; cells=[]
  for ph in PH:
    v=[r['ms'].get(ph) for r in rs if r['ms'].get(ph) is not None]
    cells.append(f"{q(v,.5):.1f} / {q(v,.95):.1f}" if v else "–")
  print(f"| {k[0]} | {k[1]} | {k[2]} | {len(rs)} | "+" | ".join(cells)+" |")
print("\n### Path taken (PostToolUse on source files, and Stop)\n")
print("| repo | policy | hook | n | paths (path_r14: count) |"); print("|---|---|---|---|---|")
for k in sorted(g):
  if not (k[2].startswith('PostToolUse:source') or k[2].startswith('Stop') or k[2]=='SessionStart'): continue
  c=Counter(r['path_r14'] for r in g[k])
  print(f"| {k[0]} | {k[1]} | {k[2]} | {len(g[k])} | "+", ".join(f"{a}: {b}" for a,b in c.most_common())+" |")
post=[r for r in rows if r['kind']=='PostToolUse:source']
fb=[r for r in post if r['path']!='fast']
print(f"\nPostToolUse on source files: {len(post)} hooks, {len(fb)} took a full scan ({100*len(fb)/max(1,len(post)):.1f}%); reasons {dict(Counter(r.get('reason') for r in fb))}")
for pol in ('all','all-block','accept-only'):
  v=[r['ms']['total'] for r in post if r['policy']==pol]
  print(f"  {pol}: PostToolUse source p50 {q(v,.5):.1f} ms p95 {q(v,.95):.1f} ms (n={len(v)})")
cnt=Counter()
for r in post: 
  for k,v in r['counts'].items(): cnt[k]+=v
print("counts per PostToolUse (mean):", {k: round(v/len(post),2) for k,v in cnt.items()})
# trace vs main wall overhead
w=[json.loads(l) for l in open(f"{D}/wall.jsonl")]
from statistics import median
for repo in sorted({x['repo'] for x in w}):
  a=[x['wall'] for x in w if x['repo']==repo and x['bin']=='trace' and x['rep']==0]; b=[x['wall'] for x in w if x['repo']==repo and x['bin']=='main']
  print(f"overhead {repo}: trace p50 {1000*median(a):.1f} ms vs main p50 {1000*median(b):.1f} ms (rep 0, same files)")
