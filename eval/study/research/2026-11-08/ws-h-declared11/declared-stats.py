# usage: python3 declared-stats.py <dir of compact `drift scan --json` dumps, one <repo>.json each> [notes]
# A Python port of drift_core::declared::{pattern_out, set_apart}, for aggregate counts only (the census is the measurement).
import json,glob,os,re,sys,collections
def expand(g):
    i=g.find('{')
    if i<0: return [g]
    d=0
    for j in range(i,len(g)):
        if g[j]=='{': d+=1
        elif g[j]=='}':
            d-=1
            if d==0: break
    parts=[];cur='';d=0
    for c in g[i+1:j]:
        if c==',' and d==0: parts.append(cur);cur=''
        else:
            d+= c=='{'; d-= c=='}'; cur+=c
    parts.append(cur)
    return [x for p in parts for x in expand(g[:i]+p+g[j+1:])]
def seg(p,s):
    return re.fullmatch(re.escape(p).replace(r'\*','.*').replace(r'\?','.'),s) is not None
def segs(g,p):
    if not g: return not p
    if g[0]=='**': return any(segs(g[1:],p[i:]) for i in range(len(p)+1))
    return bool(p) and seg(g[0],p[0]) and segs(g[1:],p[1:])
def gm(g,path):
    p=[x for x in path.split('/') if x]
    return any(segs([x for x in e.split('/') if x and x!='.'],p) for e in expand(g))
def under(path,d): return d=='' or path==d or path.startswith(d+'/')
def gov(s,path,pkg):
    if not under(path,s['dir']) or path==s['dir']: return False
    if s['source']=='tsconfig': return under(s['dir'],pkg)
    if s['source'] in ('npm-files','python-packages'): return s['dir']==pkg
    return True
def takes(s,path):
    return path in s.get('files',[]) or (any(gm(g,path) for g in s.get('include',[])) and not any(gm(g,path) or gm(g+'/**',path) for g in s.get('exclude',[])))
def judges(s,path):
    ex=path.rsplit('/',1)[-1].rsplit('.',1); ex=ex[1] if len(ex)>1 else ''
    return not s.get('exts') or ex in s['exts']
def pout(scopes,path,pkg):
    for src in ['tsconfig','eslint','npm-files','python-packages']:
        c=[s for s in scopes if s['source']==src and gov(s,path,pkg)]
        if not c: continue
        m=max(len(s['dir']) for s in c); g=[s for s in c if len(s['dir'])==m]
        if all(not s.get('note') and judges(s,path) and not takes(s,path) for s in g): return src
    return None
tot=collections.Counter(); rows=[]
for f in sorted(glob.glob(sys.argv[1]+'/*.json')):
    r=os.path.basename(f)[:-5]; j=json.load(open(f)); sc=j['declared']
    out={x['path']:pout(sc,x['path'],x['package']) for x in j['files']}; out={k:v for k,v in out.items() if v}
    keep=set(j['entries'])|{x['path'] for x in j['files'] if x['ep']}
    ep=sum(1 for k in list(out) if k in keep); [out.pop(k) for k in list(out) if k in keep]
    by={x['path']:x for x in j['files']}; q=[x for x in j['files'] if x['path'] not in out]; reach=0
    while q and out:
        x=q.pop(); rs=x['imports']+x['reg']+[p for g in x['disc'] if ':' not in g for p in out if gm(g,p)]
        for p in rs:
            if p in out: out.pop(p); reach+=1; q.append(by[p])
    srcs=collections.Counter(s['source'] for s in sc); notes=collections.Counter(s['source'] for s in sc if s.get('note'))
    apart=collections.Counter(out.values())
    rows.append((r,len(j['files']),dict(srcs),dict(notes),dict(apart),ep,reach))
    for k,v in srcs.items(): tot['scopes '+k]+=v
    for k,v in notes.items(): tot['noted '+k]+=v
    for k,v in apart.items(): tot['apart '+k]+=v
    tot['files']+=len(j['files']); tot['kept entry']+=ep; tot['kept reached']+=reach; tot['repos with any apart']+= bool(out)
for row in rows: print(*row)
print(dict(tot))
if len(sys.argv)>2:
    notes=collections.Counter(re.sub(r'`[^`]*`','`…`',re.sub(r'^\S+ ','',s['note'])) for f in glob.glob(sys.argv[1]+'/*.json') for s in json.load(open(f))['declared'] if s.get('note'))
    for k,v in notes.most_common(): print(v,k)
