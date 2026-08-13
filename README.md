# Archived — Drift v1 (the original Rust-core wedge)

This branch is a historical snapshot, not an active line of development. **Do not open PRs against it.**

Drift has been rebuilt three times. This is the first: the original Rust-engine-owns-truth
architecture that proved the core loop — scan a repo, infer conventions, let a human review them,
materialize a contract, then check diffs against it.

For the current, actively developed version of Drift, see [`main`](https://github.com/dadbodgeoff/drift/tree/main)
and [`docs/HISTORY.md`](https://github.com/dadbodgeoff/drift/blob/main/docs/HISTORY.md) for the full
story of how it evolved into v3.