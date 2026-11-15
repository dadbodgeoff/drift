import sys,re,subprocess
def load(f):
    out=subprocess.run(['callgrind_annotate','--inclusive=yes','--threshold=99.9',f],capture_output=True,text=True).stdout
    d={}
    for l in out.split('\n'):
        m=re.match(r'^\s*([\d,]+) \(\s*[\d.]+%\)\s+(.*?)(?: \[.*)?$',l)
        if m: d[m.group(2)]=d.get(m.group(2),0)+int(m.group(1).replace(',',''))
    return d
a=load(sys.argv[1]);b=load(sys.argv[2]);flt=sys.argv[3] if len(sys.argv)>3 else 'drift'
ks=[k for k in set(a)|set(b) if re.search(flt,k)]
for k in sorted(ks,key=lambda k:-abs(b.get(k,0)-a.get(k,0)))[:int(sys.argv[4]) if len(sys.argv)>4 else 40]:
    print(f"{a.get(k,0)/1e6:9.1f} {b.get(k,0)/1e6:9.1f} {k[:160]}")
