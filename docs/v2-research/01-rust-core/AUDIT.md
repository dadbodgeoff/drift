# Rust Core Documentation Audit

Comprehensive audit of `crates/drift-core/` and `crates/drift-napi/` documentation
against actual source code. Measured against the Cortex documentation standard
(25 files, per-subsystem depth, algorithm specifics, type definitions, flow diagrams).

## Executive Summary

**Current state:** 10 docs covering 12 modules (61 source files) + 8 comprehensive call graph docs in `04-call-graph/`
**Cortex standard:** 25 docs covering ~150 source files (1 doc per subsystem)
**Coverage grade: A-** — All P0 items complete. Call graph, reachability, unified analysis, and NAPI bridge are at Cortex-level depth. Remaining gaps are P1/P2 (secondary types in data-models.md, benchmarks, flow diagrams).

**Can you recreate v2 from these docs alone?** Yes, for all major subsystems. You'd get the right architecture, module boundaries, algorithm details, type definitions, regex patterns, confidence scores, and the complete Rust↔TypeScript API contract.

---

## Module-by-Module Audit

### 1. Scanner (`scanner/`) — ✅ ADEQUATE
**Doc:** `scanner.md` | **Source files:** 4 (mod.rs, walker.rs, ignores.rs, types.rs)

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| File structure | ✅ | All 4 files listed |
| Purpose | ✅ | Clear description |
| NAPI exposure | ✅ | `scan()` documented |
| Dependencies | ✅ | walkdir, ignore, globset, rayon |
| TS counterpart | ✅ | Good comparison |
| v2 gaps | ✅ | Incremental scanning, dep graph |

**Missing details (minor):**
- Language detection covers 30+ extensions (not just the 10 parsed languages) — includes Ruby, Swift, Kotlin, Scala, HTML, CSS, Vue, JSON, YAML, TOML, SQL, Shell, PowerShell, Markdown
- xxHash (xxh3_64) used for file hashing — not mentioned
- Thread pool configuration via `rayon::ThreadPoolBuilder` — not mentioned
- `ScanConfig.compute_hashes` flag — not in data models doc
- Walk strategy: single-threaded directory walk → parallel file processing (not fully parallel walk)

**Verdict:** Good enough for recreation. Minor gaps only.

---

### 2. Parsers (`parsers/`) — ✅ ADEQUATE
**Doc:** `parsers.md` | **Source files:** 12 (mod.rs, manager.rs, 9 language parsers, types.rs)

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| File structure | ✅ | All 12 files listed |
| Language coverage | ✅ | 10 languages (TS/JS share parser) |
| NAPI exposure | ✅ | `parse()`, `supported_languages()` |
| Dependencies | ✅ | All tree-sitter grammars v0.23 |
| Data model | ✅ | In `data-models.md` |

**Missing details (moderate):**
- `ParserManager` lazy initialization pattern — parsers created as `Option<T>`, gracefully handle unavailable parsers
- `parse_file()` vs `parse()` — two entry points (path-based vs language-explicit)
- `parse_batch()` — batch parsing API exists but undocumented
- TypeScript parser handles both TS and JS via boolean flag (`is_typescript: bool`)
- Per-language parser struct names: `TypeScriptParser`, `PythonParser`, `JavaParser`, `CSharpParser`, `PhpParser`, `GoParser`, `RustParser`, `CppParser`, `CParser`
- `Language::from_path()` — path-based language detection (separate from extension-based)
- `StructTag` type in NAPI — Go struct tags, not documented in data models

**Verdict:** Good for recreation. The per-language parser internals (tree-sitter queries, extraction logic) are not documented but follow a consistent pattern.

---

### 3. Call Graph (`call_graph/`) — ✅ COMPREHENSIVE (consolidated into 04-call-graph/)
**Docs:** `../04-call-graph/` (8 files) | **Source files:** 6 (mod.rs, builder.rs, extractor.rs, universal_extractor.rs, storage.rs, types.rs)

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| File structure | ✅ | All 6 files listed |
| Purpose | ✅ | Streaming architecture described |
| NAPI exposure | ✅ | 8 functions listed |
| TS counterpart | ✅ | Good comparison |

**Previously missing details — ✅ NOW DOCUMENTED in `04-call-graph/`:**
- SQLite schema (3 tables + indexes + metadata) → `04-call-graph/rust-core.md`, `04-call-graph/storage.md`
- Resolution algorithm → `04-call-graph/rust-core.md`, `04-call-graph/analysis.md`
- ParallelWriter architecture → `04-call-graph/rust-core.md`, `04-call-graph/storage.md`
- CallGraphExtractor trait + UniversalExtractor → `04-call-graph/extractors.md`, `04-call-graph/rust-core.md`
- Two build modes (SQLite vs legacy) → `04-call-graph/storage.md`
- Disk-backed resolution index → `04-call-graph/rust-core.md`

**Verdict:** ✅ Fully documented across 8 comprehensive files in `04-call-graph/`. All previously missing details (SQLite schema, resolution algorithm, parallel writer, extractor trait) are now covered.

---

### 4. Boundaries (`boundaries/`) — ✅ ADEQUATE
**Doc:** `boundaries.md` | **Source files:** 4 (mod.rs, detector.rs, sensitive.rs, types.rs)

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| File structure | ✅ | All 4 files listed |
| Purpose | ✅ | Clear |
| NAPI exposure | ✅ | Both functions |
| Data model | ✅ | In `data-models.md` |

**Missing details (minor):**
- `DataAccessDetector` is ~1840 lines — the doc doesn't convey the scale
- `detect_from_ast()` — AST-first detection from ParseResult
- `detect_from_call_site()` — Per-call-site detection
- `detect_sql_in_source()` — Regex fallback for SQL in strings
- `detect()` — Combined detection (AST + regex)
- The detector recognizes ORM patterns for: Prisma, Django, SQLAlchemy, Entity Framework, Sequelize, TypeORM, Mongoose, GORM, Diesel, ActiveRecord, Eloquent, and raw SQL

**Verdict:** Good enough. The ORM pattern list is the main gap.

---

### 5. Coupling (`coupling/`) — ⚠️ THIN
**Doc:** `coupling.md` | **Source files:** 3 (mod.rs, analyzer.rs, types.rs)

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| File structure | ✅ | All 3 files listed |
| Purpose | ⚠️ | One-liner only |
| NAPI exposure | ✅ | Listed |

**Missing details (significant):**
- No description of the coupling analysis algorithm
- No description of cycle detection logic
- No description of hotspot identification criteria
- `ModuleMetrics` fields not documented
- `DependencyCycle` severity classification not documented
- `CouplingHotspot` scoring not documented
- `UnusedExport` detection logic not documented

**Verdict:** Too thin for recreation. Needs algorithm documentation.

---

### 6. Reachability (`reachability/`) — ✅ COMPREHENSIVE (consolidated into 04-call-graph/)
**Docs:** `../04-call-graph/reachability.md` | **Source files:** 4 (mod.rs, engine.rs, sqlite_engine.rs, types.rs)

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| File structure | ✅ | All 4 files listed |
| Purpose | ✅ | Forward + inverse well explained |
| NAPI exposure | ✅ | All 4 functions |
| Dual engine | ✅ | In-memory + SQLite mentioned |

**Missing details (moderate):**
- **BFS algorithm** — Both engines use `find_paths_bfs()` with visited set and max depth
- **Sensitivity classification** — `classify_sensitivity()` uses field name heuristics:
  - PII: password, email, ssn, phone, address, name, dob
  - Financial: credit_card, account, balance, payment
  - Auth: token, session, api_key, secret
  - Health: diagnosis, prescription, medical
- **`ReachabilityEngine` API:**
  - `get_reachable_data(file, line)` — From code location
  - `get_reachable_data_from_function(function_id)` — From function
  - `get_call_path(from, to)` — Path between two functions
  - `get_code_paths_to_data(table, field?)` — Inverse: who reaches this data
- **`SqliteReachabilityEngine`** — Opens call graph DB, mirrors in-memory API
  - `from_project_root()` — Auto-discovers `.drift/call-graph/call-graph.db`
  - `is_available()` — Checks if DB exists and has data

**Verdict:** ✅ Comprehensive. BFS algorithm, sensitivity classification, dual engine architecture, all types, and NAPI exposure are now fully documented in `04-call-graph/reachability.md`.

---

### 7. Unified Analysis (`unified/`) — ✅ COMPREHENSIVE
**Doc:** `unified-analysis.md` | **Source files:** 7 (mod.rs, analyzer.rs, ast_patterns.rs, string_analyzer.rs, interner.rs, index.rs, types.rs)

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| File structure | ✅ | All 7 files listed with line counts |
| Purpose | ✅ | Combined AST + string |
| NAPI exposure | ✅ | `analyze_unified()` |
| 4-phase pipeline | ✅ | Full architecture diagram |
| AST queries per language | ✅ | All 9 languages with pattern types, categories, confidence scores |
| Regex patterns | ✅ | All 5 RegexSets with exact patterns and confidence scores |
| StringContext enum | ✅ | All 7 variants with parent node mappings |
| String interning | ✅ | Symbol, PathInterner, FunctionInterner, InternerStats |
| Resolution algorithm | ✅ | Same-file preference → exported preference → ambiguous |
| All type definitions | ✅ | DetectedPattern, UnifiedOptions, UnifiedResult, FilePatterns, etc. |
| Parallel execution | ✅ | rayon par_iter with Arc<RwLock<ResolutionIndex>> |

**Verdict:** ✅ Fully documented. All previously missing details (regex patterns, confidence scores, interner details, resolution algorithm, per-language query inventory) are now covered.

---

### 8. Other Analyzers — ✅ NOW SPLIT INTO INDIVIDUAL DOCS
**Doc:** `other-analyzers.md` (legacy summary) + 5 individual docs | **Source files:** 15 across 5 modules

The `other-analyzers.md` summary remains for quick reference, but each module now has its own dedicated doc:
- `test-topology.md` — Framework detection, test case extraction, mock detection, coverage mapping
- `error-handling.md` — Boundary types, gap types, severity classification
- `constants.md` — All 21 secret patterns, magic numbers, inconsistency detection, confidence scoring
- `environment.md` — Env var extraction, sensitivity classification
- `wrappers.md` — Primitive registry, confidence scoring, category detection

Additionally, the TS-side analysis is now documented in `05-analyzers/`:
- `module-coupling.md` — Full coupling analysis with cycle detection, refactor impact
- `wrappers-analysis.md` — TS orchestration layer
- `constants-analysis.md` — TS orchestration layer
- `environment-analysis.md` — TS orchestration layer

---

### 9. NAPI Bridge (`drift-napi/`) — ✅ COMPREHENSIVE
**Doc:** `napi-bridge.md` | **Source files:** 1 main (lib.rs ~2200 lines)

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| Function list | ✅ | All 27 functions with signatures |
| Platform support | ✅ | 7 platforms |
| Dependencies | ✅ | napi v2 |
| Complete Js* structs | ✅ | All 62 structs with full field definitions |
| Error handling pattern | ✅ | napi::Result<T>, .map_err() |
| Serde conversion | ✅ | Manual field mapping (not automatic serde) |
| Type conversion table | ✅ | Rust → JS type mappings |
| Thread safety | ✅ | thread_local! for parse, rayon for build |
| Native adapter | ✅ | Module loading, fallback, debug logging |

**Verdict:** ✅ Fully documented. All 62 Js* struct definitions (the actual API contract between Rust and TypeScript) are now included with field types and string enum values.

---

### 10. Data Models (`data-models.md`) — ✅ GOOD
**Doc:** `data-models.md` | Covers types across all modules

| Aspect | Documented? | Notes |
|--------|-------------|-------|
| ParseResult | ✅ | Full struct with fields |
| Call Graph types | ✅ | FunctionEntry, CallEntry, etc. |
| Unified types | ✅ | DetectedPattern, FilePatterns |
| Boundaries types | ✅ | DataAccessPoint, SensitiveField |
| Key enums | ✅ | Language, PatternCategory, etc. |
| Performance deps | ✅ | tree-sitter, rayon, rusqlite, xxhash |

**Missing types:**
- `CallGraphIndex`, `CallGraphSummary`, `FileIndexEntry`, `EntryPointSummary`, `DataAccessorSummary` — call graph index types
- `ResolutionEntry` — disk-backed resolution
- `StringLiteral`, `StringContext` — unified analyzer string types
- `Symbol`, `InternerStats` — interner types
- `FunctionId`, `Resolution`, `ResolvedFunction`, `IndexStats` — resolution index types
- `SecretCandidate`, `SecretSeverity`, `MagicNumber`, `InconsistentValue`, `ValueLocation` — constants types
- `WrapperInfo`, `WrapperCluster`, `WrapperCategory`, `WrappersStats` — wrapper types
- `EnvAccess`, `EnvVariable`, `EnvAccessLocation`, `EnvSensitivity`, `EnvironmentStats` — environment types
- `ExtractionResult`, `ExtractedFunction`, `ExtractedCall` — call graph extractor types
- `CompiledQuery` — AST pattern query type
- `FunctionBatch`, `DbStats` — call graph storage types

**Verdict:** Core types are documented. Secondary types (especially constants, wrappers, environment) are missing.

---

## Cargo.toml Dependencies — ✅ DOCUMENTED (in data-models.md)

| Dependency | Version | Purpose | Documented? |
|-----------|---------|---------|-------------|
| tree-sitter | 0.23 | AST parsing | ✅ |
| tree-sitter-* (10) | 0.23 | Language grammars | ✅ |
| walkdir | 2 | Directory traversal | ✅ |
| ignore | 0.4 | Gitignore patterns | ✅ |
| globset | 0.4 | Glob matching | ✅ |
| rayon | 1.10 | Parallelism | ✅ |
| rusqlite | 0.31 (bundled) | SQLite storage | ✅ |
| xxhash-rust | 0.8 (xxh3) | Fast hashing | ✅ |
| regex | 1 | Pattern matching | ⚠️ Implicit |
| once_cell | 1 | Lazy statics | ❌ |
| rustc-hash | 2 | Fast hash maps | ✅ |
| smallvec | 1.13 | Small vec optimization | ✅ |
| serde + serde_json | 1 | Serialization | ⚠️ Implicit |
| thiserror | 1 | Error types | ❌ |
| anyhow | 1 | Error handling | ❌ |

---

## Benchmarks — ⚠️ PARTIALLY DOCUMENTED

The README has performance numbers but the benchmark code reveals more:

**Documented:**
- Parse TypeScript: ~234 µs
- Parse Python: ~237 µs
- Boundary scan (4 files): ~74 ms
- Coupling analysis (4 files): ~70 ms

**Undocumented:**
- Full pipeline benchmark exists (`full_pipeline.rs`) covering: scan → parse → boundaries → coupling → test topology → error handling
- Benchmark uses realistic project structure (TypeScript service with tests)
- No benchmark for: unified analysis, constants, environment, wrappers, call graph building, reachability

---

## Comparison to Cortex Documentation Standard

| Dimension | Cortex | Rust Core | Gap |
|-----------|--------|-----------|-----|
| Docs per module | 1 per subsystem (25 total) | 1 per module + 2 shared (10) + 8 call graph docs | Need 5 more individual docs (other-analyzers split) |
| Algorithm detail | Exact weights, thresholds, formulas | ✅ Call graph + reachability at depth; others architecture only | Need algorithm docs for unified, constants, wrappers |
| Type definitions | Full interfaces with field descriptions | ✅ Call graph types comprehensive; others partial | Need secondary types for non-call-graph modules |
| Flow diagrams | ASCII art pipelines | ✅ Call graph has architecture diagram | Need flow diagrams for other modules |
| Config/options | All options documented | ✅ BuilderConfig documented; others partial | Need UnifiedOptions, etc. |
| Test coverage | Testing strategies documented | Not mentioned | Need test approach |
| Rust migration notes | Dedicated migration doc | v2 notes per doc | Adequate |
| Internal APIs | Method signatures documented | ✅ Call graph internal APIs documented; others NAPI only | Need internal APIs for other modules |

---

## Recommended Actions (Priority Order)

### P0 — Required for faithful v2 recreation

1. ~~**Split `other-analyzers.md` into 5 individual docs**~~ — ✅ DONE: Created `test-topology.md`, `error-handling.md`, `constants.md`, `environment.md`, `wrappers.md`

2. ~~**Enrich `call-graph.md`**~~ — ✅ DONE: Consolidated into `04-call-graph/` (8 comprehensive docs covering SQLite schema, resolution algorithm, ParallelWriter, CallGraphExtractor trait, UniversalExtractor, both build modes, reachability engines, enrichment pipeline, and all types)

3. ~~**Enrich `unified-analysis.md`**~~ — ✅ DONE: Fully rewritten with 4-phase pipeline, all per-language AST query inventories with confidence scores, all 5 regex pattern sets with exact patterns, StringContext enum, StringInterner/PathInterner/FunctionInterner details, ResolutionIndex algorithm, and complete type definitions.

4. ~~**Enrich `napi-bridge.md`**~~ — ✅ DONE: Fully rewritten with all 27 exported functions, complete inventory of 62 Js* struct definitions with field types and string enum values, type conversion table, error handling pattern, serde conversion approach, and thread safety notes.

### P1 — Important for completeness

5. ~~**Enrich `coupling.md`**~~ — ✅ DONE: Created `05-analyzers/module-coupling.md` with full TS-side algorithm (cycle detection, metrics, refactor impact, unused exports). Rust-side `01-rust-core/coupling.md` still thin but TS doc covers the algorithms.

6. **Enrich `data-models.md` with:**
   - All secondary types (constants, wrappers, environment, interner, resolution)
   - Call graph index types
   - Extractor types

7. **Add `benchmarks.md`:**
   - Full benchmark inventory
   - Test project structure used in benchmarks
   - Performance characteristics per module

### P2 — Nice to have

8. **Add flow diagrams** for:
   - Unified analysis pipeline
   - Call graph build + resolution
   - Reachability BFS traversal

9. **Document build configuration:**
   - `Cargo.toml` profile settings (LTO, codegen-units=1, opt-level=3)
   - Crate type: `["cdylib", "rlib"]`
   - Dev dependencies (tempfile, criterion)

---

## Corrections to Existing Docs

1. **`parsers.md`** says "11 languages" but there are 10 (TS and JS share the TypeScript parser, C is the 10th). The scanner detects 30+ languages for classification but only 10 are parsed.

2. ~~**`napi-bridge.md`** says "~25 functions" — actual count is 27 exported `#[napi]` functions.~~ — ✅ FIXED: Now documents all 27 functions.

3. **`data-models.md`** lists `Language` as "10 variants: TypeScript..C" — correct, but the scanner's `detect_language()` recognizes 30+ extensions including Ruby, Swift, Kotlin, Scala, etc. (for classification, not parsing).

4. ~~**`call-graph.md`** doesn't mention the `CallGraphExtractor` trait or `UniversalExtractor`~~ — ✅ FIXED: Now documented in `04-call-graph/extractors.md` and `04-call-graph/rust-core.md`.

5. ~~**`unified-analysis.md`** says "basic patterns" — the AST detector has per-language query builders for all 9 languages (not just basic).~~ — ✅ FIXED: Now documents all per-language queries with confidence scores.

---

## Bottom Line

The Rust core docs give you the **right architecture** and now have **comprehensive implementation detail** for the call graph and reachability subsystems (8 docs in `04-call-graph/`). The remaining modules still need deeper documentation to match the Cortex standard.

The biggest remaining gaps are:
1. ~~**Constants/secrets module** — 21 detection patterns completely undocumented~~ — Documented in `01-rust-core/constants.md`
2. ~~**Call graph SQLite schema + resolution algorithm**~~ — ✅ DONE (consolidated into `04-call-graph/`)
3. ~~**Unified analyzer regex patterns + confidence scores** — The detection engine's brain~~ — ✅ DONE (enriched `unified-analysis.md`)
4. ~~**Wrappers primitive registry + confidence scoring** — The detection heuristics~~ — Documented in `01-rust-core/wrappers.md`
5. ~~**NAPI struct definitions** — The actual API contract between Rust and TypeScript~~ — ✅ DONE (enriched `napi-bridge.md` with all 62 structs)

**All P0 items are now complete.** Remaining work is P1 (data-models.md secondary types, benchmarks.md) and P2 (flow diagrams, build configuration).
