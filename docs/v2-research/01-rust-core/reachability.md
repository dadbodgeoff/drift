# Rust Reachability Analysis

> **Canonical documentation**: See [04-call-graph/reachability.md](../04-call-graph/reachability.md) for the comprehensive reachability documentation covering both Rust and TS implementations, and [04-call-graph/overview.md](../04-call-graph/overview.md) for the full call graph system overview.

## Location
`crates/drift-core/src/reachability/`

## Files
- `engine.rs` — Forward/inverse reachability engine (in-memory call graph)
- `sqlite_engine.rs` — SQLite-backed reachability (for large codebases)
- `types.rs` — `ReachabilityResult`, `InverseReachabilityResult`, `CodeLocation`, `CallPathNode`, etc.
- `mod.rs` — Module exports

## What It Does
- Forward reachability: "From function X, what data can it access?"
- Inverse reachability: "What functions can reach sensitive data Y?"
- Traces call paths through the call graph
- Identifies sensitive field access along paths
- SQLite variant handles codebases too large for in-memory analysis

## NAPI Exposure
- `analyze_reachability(options) -> JsReachabilityResult`
- `analyze_inverse_reachability(options) -> JsInverseReachabilityResult`
- `analyze_reachability_sqlite(options) -> JsReachabilityResult`
- `analyze_inverse_reachability_sqlite(options) -> JsInverseReachabilityResult`

## v2 Notes
- This is one of the most powerful features. Already well-implemented in Rust.
- Needs: taint analysis, more granular data flow tracking, cross-service reachability.
