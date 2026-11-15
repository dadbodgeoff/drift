import json,math,sys
from collections import defaultdict
rows=[json.loads(l) for l in open(sys.argv[1])]
agg=defaultdict(list); ident={}
for r in rows:
    if r['metric']=='identical': ident[(r['set'],r['repo'])]=r['value']; continue
    agg[(r['set'],r['repo'],r['bin'],r['metric'])].append(r)
keys=sorted({(k[0],k[1]) for k in agg}, key=lambda k:(['ts','py','py2'].index(k[0]),k[1]))
print("| repo | warm s | warm CPU s | warm MB | cold s | cold CPU s |")
print("|---|---|---|---|---|---|")
rat=defaultdict(list)
for k in keys:
    cells=[]
    for m,f,n in (('census_warm',lambda x:x['wall'],'wall'),('census_warm',lambda x:x['user']+x['sys'],'cpu'),('census_warm',lambda x:x['rss_kb']/1024,'rss'),('census_cold',lambda x:x['wall'],'wall'),('census_cold',lambda x:x['user']+x['sys'],'cpu')):
        a=min(map(f,agg[(k[0],k[1],'main',m)])); b=min(map(f,agg[(k[0],k[1],'head',m)]))
        rt=b/a if a>0 else 1
        rat[(k[0]=='ts',m,n)].append(rt)
        cells.append(f"{a:.0f} → {b:.0f} ({rt:.2f}×)" if n=='rss' else f"{a:.2f} → {b:.2f} ({rt:.2f}×)")
    print(f"| {k[0]}/{k[1]} | "+" | ".join(cells)+" |")
print()
for k,v in sorted(rat.items()):
    print(('TS' if k[0] else 'Py'), k[1], k[2], f"gmean {math.exp(sum(map(math.log,v))/len(v)):.3f} min {min(v):.2f} max {max(v):.2f}")
print("identical", sum(ident.values()), "of", len(ident))
