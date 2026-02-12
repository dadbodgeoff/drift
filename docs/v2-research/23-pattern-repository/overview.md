# Pattern Repository — Overview

## Location
`packages/core/src/patterns/` — 100% TypeScript (~13 source files)

## What It Is
A complete Repository + Service data access layer that abstracts all pattern storage from consumers. Implements the classic Repository pattern with event-driven architecture, caching decorators, and a migration path from the legacy `PatternStore` (JSON files) to the new unified system. This is the **future of pattern storage** — the MCP server already uses `IPatternService` when available (dual-path architecture).

## Core Design Principles
1. Storage is swappable — file, sharded, in-memory, cached, all behind one interface
2. Consumers use `IPatternService` (high-level), never touch `IPatternRepository` directly
3. Event-driven — all mutations emit events for downstream reactivity
4. Status transitions are validated (discovered → approved/ignored)
5. Legacy `PatternStore` bridged via adapter, enabling gradual migration

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│              Consumers (MCP, CLI, Dashboard)             │
├─────────────────────────────────────────────────────────┤
│              IPatternService (service.ts)                │
│  Discovery │ Exploration │ Detail │ Actions │ Search     │
├─────────────────────────────────────────────────────────┤
│              IPatternRepository (repository.ts)          │
│  CRUD │ Query │ Status Transitions │ Events │ Summaries  │
├─────────────────────────────────────────────────────────┤
│              Implementations                             │
│  UnifiedFile │ LegacyFile │ InMemory │ Cached │ Adapter  │
├─────────────────────────────────────────────────────────┤
│              Storage Backends                            │
│  .drift/patterns/*.json │ .drift/patterns/{status}/ │ ∅  │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `service.ts` — `IPatternService` interface: consumer-facing API
- `repository.ts` — `IPatternRepository` interface: storage abstraction
- `impl/repository-factory.ts` — `createPatternRepository()`: auto-detects format
- `adapters/service-factory.ts` — `createPatternServiceFromStore()`: bridges legacy

## Subsystem Directory Map

| File/Directory | Purpose | Doc |
|----------------|---------|-----|
| `types.ts` | Unified Pattern type, categories, status, confidence, severity | [types.md](./types.md) |
| `repository.ts` | `IPatternRepository` interface, query/filter/sort/pagination | [repository.md](./repository.md) |
| `service.ts` | `IPatternService` interface, status/category/example types | [service.md](./service.md) |
| `errors.ts` | Error classes for the pattern system | [errors.md](./errors.md) |
| `impl/` | 5 repository implementations + service | [implementations.md](./implementations.md) |
| `adapters/` | Legacy PatternStore bridge + factory | [adapters.md](./adapters.md) |

## Pattern Lifecycle

```
Detect → Create → Store → Query → Approve/Ignore → Enrich → Serve
```

1. Detectors find patterns during scan
2. Pattern created with unified type (confidence, locations, metadata)
3. Stored via `IPatternRepository.add()`
4. Queried with filters, sorting, pagination
5. User approves or ignores (status transition with validation)
6. Service enriches with code examples, related patterns
7. Served to MCP tools, CLI commands, Dashboard

## MCP Integration
The MCP server checks for `IPatternService` availability and uses it when present (dual-path). Tools like `drift_status`, `drift_patterns_list`, `drift_pattern_get`, `drift_code_examples`, `drift_prevalidate` all have dual implementations — legacy `PatternStore` path and new `IPatternService` path.

## V2 Implications
- `IPatternRepository` interface stays, implementations change
- File-based repositories → `SqlitePatternRepository` backed by Rust NAPI
- `InMemoryPatternRepository` stays for testing
- `CachedPatternRepository` stays as decorator
- `PatternStoreAdapter` removed (no legacy store in v2)
- `IPatternService` and `PatternService` are v2-ready as-is
