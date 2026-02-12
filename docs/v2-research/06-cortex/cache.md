# Cortex Caching System

## Location
`packages/cortex/src/cache/`

## Purpose
Multi-tier caching for fast memory and embedding retrieval.

## Files
- `l1-memory.ts` — In-process memory cache (fastest, volatile)
- `l2-index.ts` — SQLite index cache (persistent, fast)
- `l3-shard.ts` — Precomputed shard cache (pre-generated, zero-latency)
- `preloader.ts` — Cache preloading on startup
- `index.ts` — Exports

## Cache Tiers

### L1: Memory Cache
- In-process `Map`
- LRU eviction
- Lost on restart
- ~microsecond access

### L2: Index Cache
- SQLite-backed
- Survives restarts
- Indexed for fast lookup
- ~millisecond access

### L3: Shard Cache
- Pre-generated embedding shards
- Loaded at startup
- Zero computation at query time
- Used for frequently-accessed content

## Lookup Chain
```
Query → L1 (memory) → L2 (SQLite) → L3 (precomputed) → Compute
```
Write-through: new values written to all levels.

## Rust Rebuild Considerations
- L1: Rust `HashMap` or `DashMap` (concurrent)
- L2: `rusqlite` — direct port
- L3: Memory-mapped files (`mmap`) for zero-copy access
- Consider `moka` crate for production-grade LRU cache with TTL
