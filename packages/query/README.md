# @drift/query

Shared graph query boundary for Drift.

This package owns reusable read models over persisted FactGraph projections. CLI,
MCP, and future UI surfaces should ask this package for graph-backed repo
intelligence instead of rebuilding traversal logic from raw facts.

V1 keeps the query layer local-first and SQLite-backed. It depends on storage
interfaces and FactGraph contracts, not scanner internals.
