import re,sys
def get(txt,pat):
  for l in txt:
    if re.search(pat,l):
      return int(l.split()[0].replace(',',''))
  return 0
for repo in sys.argv[1:]:
  t=open(f'/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/r13h-agentproof/lat/cg-{repo}.txt').read().splitlines()
  tot=get(t,'PROGRAM TOTALS')
  ph={
   'policy load (open_for_agents)': get(t,r'Project>::open_for_agents \['),
   'file discovery (repo walk)': get(t,r'WalkParallel>::visit::\{closure#1\}::\{closure#0\}::\{closure#0\}, \(\)> \[')+get(t,r'drift_core::ingest::walk \['),
   'facts load: index': get(t,r'drift_ts::index::Index>::load \['),
   'facts load: cached facts of linked files': get(t,r'FactCache>::get::<drift_ts::lower::RawFile> \['),
   'scan edited file (parse+lower)': get(t,r'drift_ts::lower::lower_file \['),
   'index write-back': get(t,r'FileStamp as serde_core::ser::Serialize>::serialize')+get(t,r'drift_ts::index::Entry as serde_core::ser::Serialize>::serialize'),
   'check (needs_full_scan + check)': get(t,r'drift_mine::check::needs_full_scan \[')+get(t,r'drift_mine::check::check_gated \[')+get(t,r'drift_mine::check::Contexts>::new \['),
  }
  rest=tot-sum(ph.values())
  print(f"## {repo}: {tot/1e6:.0f} M instructions")
  for k,v in ph.items(): print(f"  {k:45s} {v/1e6:7.1f} M {100*v/tot:5.1f}%")
  print(f"  {'other (link, resolver setup, runtime, output)':45s} {rest/1e6:7.1f} M {100*rest/tot:5.1f}%")
