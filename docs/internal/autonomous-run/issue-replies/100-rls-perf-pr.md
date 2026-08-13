# Reply draft — PR #100 "perf(rls): wrap current_setting()/auth.uid() in (select …)"

The change itself is correct and well-argued. Wrapping a bare `current_setting()` or `auth.uid()`
in a scalar subquery turns a per-row re-evaluation into an InitPlan the planner evaluates once per
statement, and it is predicate-equivalent, so row visibility is unchanged. It is the standard
Postgres/Supabase pattern and the description explains why accurately.

**It cannot be merged as-is, and that is our doing rather than yours.**

The PR touches `drift v2/supabase/migrations/`. The repository has just been restructured: `drift
v3` is now the repo root, and the v1 and v2 trees were removed from the working tree and preserved
on the `archive/v1-v2-trees` branch. So this PR now targets a path that does not exist on the
default branch.

Two things need deciding before this can go anywhere, and both are ours to answer:

**Is v2 still maintained?** If it is, it should not have been archived without saying so, and this
PR should be retargeted at the archive branch. If it is not, the honest answer is that this change
has nowhere to land here, and we should say that rather than leave it open.

**Does v3 need the same fix?** v3 is local-first and uses SQLite — no Postgres, no RLS, no
`auth.uid()`. So there is no equivalent change to port. Worth stating explicitly so the work is not
assumed to carry over.

Apologies for the restructure landing under an open PR. Whichever way the v2 question is answered,
this should not sit here unacknowledged — the analysis in it is good, and the 86-policy migration
is real work.
