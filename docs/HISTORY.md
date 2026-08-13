# History

Drift has been rebuilt three times. Each rewrite is preserved as a read-only branch rather than
deleted, so the reasoning behind the current architecture is checkable, not just asserted.

## v1 — the original Rust-core wedge

**[`archive/v1`](https://github.com/dadbodgeoff/drift/tree/archive/v1)**

The first version proved the core loop: a Rust engine deterministically scans a TypeScript/
JavaScript repo, infers convention candidates, a human reviews and approves them into a
`RepoContract`, and diffs are checked against that contract. Rust owns parsing and fact extraction;
TypeScript owns the CLI, storage, and policy surface. That split held up — it's still the
architecture today.

## v2 — the cloud/Supabase rewrite

**[`archive/v2`](https://github.com/dadbodgeoff/drift/tree/archive/v2)** ·
**[`archive/v2-full-experiment`](https://github.com/dadbodgeoff/drift/tree/archive/v2-full-experiment)**

v2 moved Drift's state to Supabase/Postgres and grew a `bridge/`, `docker/`, and `supabase/`
migration layer around the core engine. `archive/v2-full-experiment` is how far that direction
went before it stopped: a demo app, infrastructure manifests, a wiki, Turbo/Vitest tooling — the
surface area of a hosted product, not a local CLI tool.

The cloud dependency didn't earn its cost. A tool whose job is to guard AI-generated diffs against
a repo's own conventions doesn't need a server; it needs to be fast, local, and trustworthy without
asking anyone to authenticate to anything. That's the walk-back v3 is.

## v3 — local-first, current

**[`main`](https://github.com/dadbodgeoff/drift/tree/main)**

Back to the v1 split (Rust engine, TypeScript surface), but with the scope and rigor v2's detour
paid for: SQLite instead of Postgres, no server, no demo app, a narrower and more deliberately
scoped convention family, and an MCP surface built for agents rather than bolted on. `docs/archive/`
and `docs/internal/` hold the point-in-time record of how this scope narrowed and hardened over
time, for anyone who wants the detail rather than the summary above.

## Why this is public

The three branches above are frozen, protected, and not part of `main`'s history — they cost
nothing to keep and they're the honest answer to "why does this look the way it does." Anyone
forking `archive/v2` for the Supabase direction is welcome to; it just isn't what ships here.
