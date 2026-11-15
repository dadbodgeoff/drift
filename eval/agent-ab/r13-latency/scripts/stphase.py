import re,sys
from collections import OrderedDict
lines=open(sys.argv[1]).read().splitlines()
main=lines[0].split()[0]
t0=float(lines[0].split()[1])
ev=[]
for l in lines:
  p=l.split(None,2)
  if len(p)<3: continue
  pid,ts,rest=p
  try: ts=float(ts)
  except: continue
  m=re.match(r'openat\(AT_FDCWD, "([^"]+)"',rest) or re.match(r'openat\(\d+, "([^"]+)"',rest)
  if pid!=main: kind='child'
  elif rest.startswith('write(1'): kind='stdout'
  elif rest.startswith('exit_group'): kind='exit'
  elif m:
    f=m.group(1)
    if 'conventions.yaml' in f or f.endswith('drift.lock'): kind='policy'
    elif '/.drift/cache/' in f and 'sessions' not in f: kind='cache'
    elif 'sessions' in f: kind='session'
    elif f.startswith('/etc') or f.startswith('/lib') or f.startswith('/proc') or f.startswith('/sys') or '/nix/' in f: kind='sys'
    else: kind='repo'
  else: kind='other'
  ev.append((ts-t0,kind,rest[:110]))
# contiguous runs
runs=[]
for t,k,r in ev:
  if runs and runs[-1][0]==k: runs[-1][2]=t; runs[-1][3]+=1
  else: runs.append([k,t,t,1,r])
for k,a,b,n,r in runs:
  if n>=1: print(f"{a*1000:8.1f} -> {b*1000:8.1f} ms  {k:8s} x{n:<5d} {r[:90]}")
print("total", ev[-1][0]*1000)
