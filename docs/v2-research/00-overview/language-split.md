# Language Split: Rust vs TypeScript

## Already in Rust (drift-core)

| Module | Files | What It Does |
|--------|-------|-------------|
| `scanner/` | walker.rs, ignores.rs, types.rs | Parallel file walking with ignore patterns (rayon) |
| `parsers/` | 12 files (per-language + manager) | Tree-sitter parsing for 11 languages |
| `call_graph/` | builder.rs, extractor.rs, storage.rs, universal_extractor.rs, types.rs | Function extraction, call resolution, SQLite storage |
| `boundaries/` | detector.rs, sensitive.rs, types.rs | Data access detection, ORM models, sensitive fields |
| `coupling/` | analyzer.rs, types.rs | Module dependency analysis, cycle detection |
| `test_topology/` | analyzer.rs, types.rs | Test-to-code mapping |
| `error_handling/` | analyzer.rs, types.rs | Error boundary and gap detection |
| `reachability/` | engine.rs, sqlite_engine.rs, types.rs | Forward/inverse data flow analysis |
| `unified/` | analyzer.rs, ast_patterns.rs, string_analyzer.rs, interner.rs, index.rs, types.rs | Combined pattern detection |
| `constants/` | analyzer.rs, extractor.rs, secrets.rs, types.rs | Hardcoded values, magic numbers, secrets |
| `environment/` | analyzer.rs, extractor.rs, types.rs | Environment variable analysis |
| `wrappers/` | analyzer.rs, clusterer.rs, detector.rs, types.rs | Framework wrapper detection |

Total Rust files: ~65 source files

## Still in TypeScript (needs migration to Rust for v2)

| Module | Approx Files | Priority |
|--------|-------------|----------|
| `detectors/` (entire package) | ~300 files | HIGH — core pattern detection |
| `parsers/` (TS-side tree-sitter loaders) | ~25 files | HIGH — duplicate of Rust parsers |
| `call-graph/extractors/` | ~30 files | HIGH — per-language extraction |
| `analyzers/` | ~5 files | HIGH — AST/type/semantic/flow |
| `matcher/` | ~10 files | HIGH — pattern matching engine |
| `boundaries/field-extractors/` | ~9 files | MEDIUM — ORM-specific extractors |
| `language-intelligence/` | ~15 files | MEDIUM — cross-language normalization |
| `module-coupling/` | ~5 files | MEDIUM — already partially in Rust |
| `error-handling/` | ~5 files | MEDIUM — already partially in Rust |
| `test-topology/` | ~15 files | MEDIUM — already partially in Rust |
| `dna/` | ~15 files | MEDIUM — styling DNA analysis |
| `constraints/` | ~7 files | MEDIUM — invariant detection |
| `rules/` | ~5 files | MEDIUM — violation evaluation |
| `storage/` | ~15 files | MEDIUM — SQLite repositories |
| `patterns/` | ~12 files | MEDIUM — pattern repository |
| Per-language analyzers (ts/, py/, java/, php/, go/, rust/, cpp/, wpf/) | ~40 files | MEDIUM |
| `simulation/` | ~15 files | LOW — AI-heavy, keep in TS |
| `decisions/` | ~12 files | LOW — git-based, hybrid |
| `quality-gates/` | ~25 files | LOW — orchestration, keep hybrid |
| `lake/` | ~11 files | LOW — data lake queries |

Total TS files needing migration: ~500+ source files
