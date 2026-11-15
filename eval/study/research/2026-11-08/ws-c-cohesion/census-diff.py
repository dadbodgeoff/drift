"""usage: diff.py <before dir> <after dir> [--json out]
Every changed card id, with its tier, newest v3 label (relabel5 > ... > dev-v3) and its dev-v3 label."""
import json,glob,os,sys
RUNS='eval/study/runs'
ORDER=['dev-v3-2026-11-06','dev-v3-relabel-2026-11-06','dev-v3-relabel2-2026-11-07','dev-v3-relabel3-2026-11-07','dev-v3-relabel4-2026-11-07','dev-v3-relabel5-2026-11-07']
labels={}; v3={}
for run in ORDER:
    for p in ['ts','py','py2']:
        f=f'{RUNS}/{run}/{p}/final.jsonl'
        if os.path.exists(f):
            for l in open(f):
                r=json.loads(l); lab=(r['label'],r.get('wrong_because'),run.replace('dev-v3-','').replace('-2026-11-0','@'))
                labels[r['uid']]=lab
                if run=='dev-v3-2026-11-06': v3[r['uid']]=lab
def load(d):
    out={}
    for f in glob.glob(d+'/*.json'):
        n=os.path.basename(f)[:-5]; part,repo=n.split('-',1); out[repo]=(part,json.load(open(f)))
    return out
A=load(sys.argv[1]); B=load(sys.argv[2])
KEYS=['summary','evidence','outliers','tier','example','exempt']
def card(p): return json.dumps({k:p.get(k) for k in KEYS},sort_keys=True)
rows=[]
for repo in sorted(set(A)|set(B)):
    part=(A.get(repo) or B.get(repo))[0]
    pa={p['id']:p for p in A.get(repo,(0,{}))[1].get('proposals',[])}
    pb={p['id']:p for p in B.get(repo,(0,{}))[1].get('proposals',[])}
    for i in sorted(set(pa)|set(pb)):
        a,b=pa.get(i),pb.get(i)
        uid=f'{repo}/{i}'; lab=labels.get(uid,('-',None,'')); l3=v3.get(uid,('-',None,''))
        if a and b and card(a)==card(b): continue
        kind='GONE' if a and not b else 'NEW' if b and not a else 'CHG'
        p=b or a
        what=[k for k in KEYS if a and b and json.dumps(a.get(k),sort_keys=True)!=json.dumps(b.get(k),sort_keys=True)]
        rows.append(dict(kind=kind,part=part,repo=repo,id=i,tier_before=a and a['tier'],tier_after=b and b['tier'],label=lab[0],why=lab[1],label_run=lab[2],v3=l3[0],v3_why=l3[1],
            rule_kind=p['rule_kind'],role=p['role'],summary=p['summary'],what=what,
            ev_before=a and f"{a['evidence']['holders']}/{a['evidence']['total']}",ev_after=b and f"{b['evidence']['holders']}/{b['evidence']['total']}"))
for r in rows:
    t=r['tier_before'] if r['kind']=='GONE' else r['tier_after'] if r['kind']=='NEW' else f"{r['tier_before']}->{r['tier_after']}"
    print(f"{r['kind']:4} {r['repo']}/{r['id']} [{t}] {r['label']}/{r['why']} ({r['label_run']}) v3={r['v3']}/{r['v3_why']} :: {r['rule_kind']} :: {','.join(r['what'])} {r['ev_before']}->{r['ev_after']} :: {r['summary'][:110]}")
tot={}
for repo,(part,d) in A.items(): tot[repo]=len(d.get('proposals',[]))
print('changed',len(rows),'| proposals before',sum(tot.values()),'after',sum(len(d.get('proposals',[])) for _,(_,d) in B.items()))
if '--json' in sys.argv: json.dump(rows,open(sys.argv[sys.argv.index('--json')+1],'w'),indent=1)
