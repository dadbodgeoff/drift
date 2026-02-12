# Call Graph System — Overview

## Location
- `packages/core/src/call-graph/` — TypeScript (~35 source files)
- `crates/drift-core/src/call_graph/` — Rust (6 files)
- `crates/drift-core/src/reachability/` — Rust (4 files, reachability engine)

## What It Is
The Call Graph is the backbone of Drift's analysis. It maps every function call relationship in the codebase, enabling reachability analysis ("what data can this code access?"), impact analysis ("what breaks if I change this?"), dead code detection, and test coverage mapping. It supports 9 languages with hybrid extraction (tree-sitter + regex fallback) and dual storage (in-memory + SQLite).

## Core Design Principles
1. Hybrid extraction: tree-sitter primary, regex fallback for robustness
2. Per-language extractors with data access awareness (8 languages × 3 variants)
3. Call resolution with 6 strategies (local, method, DI, import, export, fuzzy)
4. Dual storage: in-memory graph (fast) and SQLite shards (scalable)
5. Streaming construction for large codebases (parallel in Rust via rayon)
6. Enrichment pipeline adds sensitivity, impact, and remediation metadata
7. Reachability engine exists in both in-memory and SQLite-backed variants

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│              Unified Provider                            │
│  (unified-provider.ts — auto-detects storage backend)   │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Analysis │ Enrichmt │ Extractrs│   Storage              │
│ Layer    │ Pipeline │ (8 lang) │   Layer                │
├──────────┴──────────┴──────────┴────────────────────────┤
│              Analysis Engines                            │
│  GraphBuilder │ Reachability │ Impact │ DeadCode │ Path │
├─────────────────────────────────────────────────────────┤
│              Per-Language Extractors (TS)                │
│  TS │ Python │ Java │ C# │ PHP │ Go │ Rust │ C++       │
│  + Hybrid variants │ + Data access extractors            │
├─────────────────────────────────────────────────────────┤
│              Rust Core                                   │
│  call_graph/                │  reachability/             │
│  StreamingBuilder           │  ReachabilityEngine        │
│  UniversalExtractor         │  SqliteReachabilityEngine  │
│  CallGraphDb (SQLite)       │  BFS + CTE traversal       │
│  ParallelWriter (rayon)     │                            │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `unified-provider.ts` — `UnifiedCallGraphProvider`: auto-detects storage, unified query API
- `streaming-builder.ts` — `StreamingCallGraphBuilder`: incremental TS-side construction
- `types.ts` — All call graph types (~300 lines)
- `index.ts` — Public exports

## Subsystem Directory Map

| Directory / File | Purpose | Doc |
|------------------|---------|-----|
| `extractors/` | Per-language function/call extraction (8 languages × 3 variants) | [extractors.md](./extractors.md) |
| `analysis/` | Graph building, reachability, impact, dead code, path finding, coverage | [analysis.md](./analysis.md) |
| `enrichment/` | Sensitivity classification, impact scoring, remediation | [enrichment.md](./enrichment.md) |
| `store/` | TS-side call graph persistence (JSON + SQLite loading) | [storage.md](./storage.md) |
| `streaming-builder.ts` | TS streaming construction with resolution pass | [storage.md](./storage.md) |
| `unified-provider.ts` | Unified access across storage backends with LRU cache | [storage.md](./storage.md) |
| `types.ts` | Core types: FunctionNode, CallSite, CallGraph, Reachability | [types.md](./types.md) |

### Rust Modules

| Module | Purpose | Doc |
|--------|---------|-----|
| `crates/drift-core/src/call_graph/` | Parallel builder, universal extractor, SQLite storage | [rust-core.md](./rust-core.md) |
| `crates/drift-core/src/reachability/` | In-memory + SQLite reachability engines | [reachability.md](./reachability.md) |

## Supported Languages

| Language | Standard Extractor | Hybrid Extractor | Data Access Extractor |
|----------|-------------------|-------------------|----------------------|
| TypeScript/JS | ✓ | ✓ | ✓ |
| Python | ✓ | ✓ | ✓ |
| Java | ✓ | ✓ | ✓ |
| C# | ✓ | ✓ | ✓ |
| PHP | ✓ | ✓ | ✓ |
| Go | ✓ | ✓ | ✓ |
| Rust | ✓ | ✓ | ✓ |
| C++ | — | ✓ | ✓ |

## Build Pipelines

### TypeScript Pipeline
```
1. Per-language hybrid extractor (tree-sitter + regex fallback)
2. Per-language data access extractor (ORM-aware)
3. GraphBuilder constructs in-memory graph
4. Resolution pass: resolve call targets (local → method → DI → import → export → fuzzy)
5. Enrichment: sensitivity classification, impact scoring, remediation
6. Storage: legacy JSON or sharded SQLite
```

### Rust Pipeline
```
1. Scanner walks filesystem (parallel via rayon)
2. Parser parses each file (tree-sitter, 11 languages)
3. UniversalExtractor extracts functions + calls + class methods
4. StreamingBuilder writes FunctionBatch shards to SQLite via ParallelWriter
5. Resolution pass: resolve call targets (local → import → export)
6. Index building for fast queries (callers, entry points, data accessors)
```

## Call Resolution
Maps `callee_name` → `function_id` using multiple strategies:

| Strategy | Confidence | Description |
|----------|-----------|-------------|
| Same-file | High | Function defined in same file |
| Method call | High | Resolved via class/receiver type |
| DI injection | Medium-High | FastAPI Depends, Spring @Autowired (TS only) |
| Import-based | Medium | Follow import chains |
| Export-based | Medium | Match exported names |
| Fuzzy | Low | Name similarity for dynamic calls |

Resolution rate: typically 60-85% depending on language and codebase.

## Key Capabilities

| Capability | TS | Rust | Description |
|-----------|-----|------|-------------|
| Forward reachability | ✓ | ✓ | "What data can this code access?" |
| Inverse reachability | ✓ | ✓ | "Who can access this data?" |
| SQLite reachability | ✓ | ✓ | Recursive CTEs for large codebases |
| Impact analysis | ✓ | — | "What breaks if I change this?" |
| Dead code detection | ✓ | — | Functions never called |
| Coverage analysis | ✓ | — | Test coverage of data paths |
| Path finding | ✓ | ✓ | Call paths between two functions |
| Sensitivity classification | ✓ | ✓ | PII/credentials/financial/health |
| Remediation generation | ✓ | — | Actionable fix suggestions |

## NAPI Bridge (Rust → TS)
```
build_call_graph(config) → JsBuildResult
is_call_graph_available(root_dir) → bool
get_call_graph_stats(root_dir) → JsCallGraphStats
get_call_graph_entry_points(root_dir) → Vec<JsEntryPointInfo>
get_call_graph_data_accessors(root_dir) → Vec<JsDataAccessorInfo>
get_call_graph_callers(root_dir, target) → Vec<JsCallerInfo>
get_call_graph_file_callers(root_dir, file_path) → Vec<JsCallerInfo>
analyze_reachability(options) → JsReachabilityResult
analyze_inverse_reachability(options) → JsInverseReachabilityResult
analyze_reachability_sqlite(options) → JsReachabilityResult
analyze_inverse_reachability_sqlite(options) → JsInverseReachabilityResult
```

## MCP Integration
- `drift_callers` — Who calls this function (uses native SQLite when available)
- `drift_signature` — Function signature lookup
- `drift_impact_analysis` — Change blast radius
- `drift_reachability` — Forward/inverse data reachability via UnifiedCallGraphProvider

## Consumers
The call graph is consumed by nearly every other subsystem:
- **Test Topology**: transitive coverage via call graph traversal
- **Error Handling**: error propagation chains via caller lookup
- **Constraints**: invariant detection from call graph patterns
- **Quality Gates**: impact simulation + security boundary gates
- **Module Coupling**: import/call dependency analysis
- **Security**: reachability from entry points to sensitive data

## V2 Notes
- Hybrid extractor pattern is excellent — replicate per-language in Rust
- Rust currently has only UniversalExtractor — needs per-language hybrid extractors
- Impact analysis, dead code, coverage analysis need Rust implementations
- Enrichment can stay hybrid (some AI-assisted)
- Resolution algorithm should be unified between TS and Rust
- SQLite sharded storage is the future — deprecate JSON
- The UnifiedCallGraphProvider pattern is good — keep for migration
