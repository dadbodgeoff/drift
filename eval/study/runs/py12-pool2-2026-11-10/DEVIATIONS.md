# Deviations of this labelling round

1. **The second labeller's wrapper restates one rubric rule from the first launch (2026-11-10).** In `run-base`, 7 of
   17 B outputs failed `collect.mjs` on "What to open" rule 3 and were rerun with one added sentence restating that
   rule and the two allowed `confidence` values. Here the six B agents get that sentence at their first launch. The
   first labeller's wrapper has no such sentence. The sentence names no label and no proposal.

2. **One B output failed the same check on five records (2026-11-10).** L21: five records listed one other member
   file where two are needed (`pyproject.toml` and `.flake8` are config files). As in `run-base` deviation 3, the
   records went back to the same B agent with the collector's message and each role named; no label was named.
