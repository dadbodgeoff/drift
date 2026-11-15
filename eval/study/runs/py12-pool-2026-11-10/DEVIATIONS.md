# Deviations of this labelling round

1. **Outlier paths with spaces (2026-11-10).** `lib.mjs` `parseCensus` cut an outlier path at its first space, so
   four cards (L04/D-c481ac, L10/D-646cc1, L11/D-a0db39, L13/D-9229df) had `outlier_files` no labeller could list.
   `collect.mjs` rejected the first labeller's outputs for L04, L10 and L11 for that reason alone. The parser was
   fixed (with a test in `tier.test.mjs`), `outlier_files` of those four cards was recomputed from this run's saved
   raw census text (`proposals/`, `pool/`), and the same outputs were collected again. No output was edited and no
   agent was relaunched. The queue before the change is kept beside the run (`queue*.before-outlier-fix.json`).
   The labellers' prompts were not affected: they show the census text, which had the full paths.

2. **Seven second-labeller outputs failed `collect.mjs` (2026-11-10).** L04, L08, L09, L12, L13, L15 and L16: one or
   more records listed fewer than two other member files in `checked` (config files and files outside the role do not
   count); L16 also had a `confidence` that was neither "high" nor "low". As in `dev-v3-relabel3-2026-11-07`, each
   invalid output was moved aside unread (`../../rejected/B/<repo>-1.jsonl`, outside the outbox root) and B was rerun
   as a fresh agent on the same rendered prompt, with one added sentence restating rubric "What to open" rule 3 and
   the two allowed `confidence` values.

3. **Four reruns failed the same check on single records (2026-11-10).** L04/D-c481ac, L08/D-c55373, L13/D-9229df,
   L13/D-5ff563 and L15/D-ddff9e again listed fewer than two other member files. As in `dev-v3-relabel3-2026-11-07`
   (cal.com, D-bcef5c), each record went back to the same B agent with the collector's message and the role named;
   the agent was told to open more members, add them to `checked`, and keep or change its label only by what it read.
   The lead did not read these outputs' labels or reasons and named no label to the agent.
