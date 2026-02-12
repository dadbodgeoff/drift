# v1 → v2 Migration Strategy

## Core Principle
All parsing, pattern detection, and analysis moves to Rust. TypeScript becomes a thin orchestration/presentation layer.

## What Moves to Rust (Priority Order)

### Phase 1: Parser Enrichment (Foundation)
Bring Rust parsers to feature parity with TS parsers.
- Add: decorator/annotation extraction
- Add: generic type parameters
- Add: inheritance chains, access modifiers
- Add: namespace/package info
- Add: framework-specific constructs
- Deprecate: `packages/core/src/parsers/tree-sitter/` (TS tree-sitter loaders)

### Phase 2: Detector Engine
Port the detector framework and all 22 categories to Rust.
- Create Rust trait-based detector system (base → learning → semantic)
- Port all regex patterns (these are data, not logic)
- Port AST pattern matching
- Port structural detection
- Create Rust detector registry
- Deprecate: `packages/detectors/` entirely

### Phase 3: Call Graph Enrichment
Bring Rust call graph to feature parity.
- Add per-language hybrid extractors
- Add per-language data access extractors
- Add impact analysis, dead code detection, coverage analysis
- Add enrichment pipeline
- Deprecate: `packages/core/src/call-graph/extractors/`

### Phase 4: Core Analyzers
Port core analysis engines.
- AST analyzer, type analyzer, semantic analyzer, flow analyzer
- Language intelligence (normalizers, framework patterns)
- Pattern matching and confidence scoring
- Deprecate: `packages/core/src/analyzers/`, `packages/core/src/matcher/`

### Phase 5: Storage Unification
Single Rust-managed SQLite database.
- Unified schema for all data types
- Pattern, contract, boundary, call graph, DNA, constraint, test topology repositories
- Data lake with materialized views
- Deprecate: `packages/core/src/storage/`, `packages/core/src/store/`, `packages/core/src/lake/`

### Phase 6: Per-Language Analyzers
Port all language-specific analyzers.
- TypeScript, Python, Java, C#, PHP, Go, Rust, C++, WPF
- Framework-specific analysis (Spring, Laravel, Django, ASP.NET, NestJS, FastAPI)
- Deprecate: `packages/core/src/{language}/`

### Phase 7: Advanced Analysis
Port remaining analysis systems.
- DNA system (gene extraction, mutation detection)
- Constraint detection and verification
- Module coupling (richer than current Rust version)
- Error handling (richer than current Rust version)
- Test topology (richer than current Rust version)

## What Stays in TypeScript

| System | Reason |
|--------|--------|
| MCP Server | Orchestration layer, MCP SDK is JS |
| CLI | Presentation layer (or consider Rust CLI with clap) |
| VSCode Extension | VSCode API is JS-only |
| LSP Server | Protocol layer (or consider tower-lsp in Rust) |
| Dashboard | React web app |
| Galaxy | React visualization |
| AI Package | API calls to AI providers |
| Cortex (partial) | AI orchestration, learning, consolidation |
| Simulation Engine | AI-heavy approach generation |
| Decision Mining (partial) | ADR synthesis is AI-assisted |
| Quality Gates (orchestration) | Policy evaluation, reporting |

## NAPI Bridge Evolution

v1 bridge: ~25 functions, raw analysis results only.

v2 bridge should expose:
- All analysis functions (current + new)
- Pattern detection and matching
- Storage CRUD operations
- Language intelligence queries
- Detector execution
- Configuration management

Consider: Should v2 use a Rust binary with JSON IPC instead of NAPI? Pros: no Node.js dependency for core operations. Cons: serialization overhead.

## Estimated Scope
- ~500 TS files to port to Rust
- ~65 existing Rust files to enrich
- Result: ~200-300 Rust files (more consolidated than TS)
- Timeline: This is a major rewrite. Phased approach over months.
