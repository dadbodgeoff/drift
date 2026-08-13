# Archived — Drift v2 (cloud/Supabase rewrite)

This branch is a historical snapshot, not an active line of development. **Do not open PRs against it.**

v2 moved Drift's state to Supabase/Postgres and grew a `bridge/`, `docker/`, and `supabase/`
migration layer around the core engine. That cloud dependency was later walked back — v3 (current
`main`) is local-first again, backed by SQLite, with no server component.

See [`archive/v2-full-experiment`](https://github.com/dadbodgeoff/drift/tree/archive/v2-full-experiment)
for the later, heavier iteration of this same direction (demo app, infra manifests, wiki), and
[`main`](https://github.com/dadbodgeoff/drift/tree/main) plus
[`docs/HISTORY.md`](https://github.com/dadbodgeoff/drift/blob/main/docs/HISTORY.md) for what shipped
instead.