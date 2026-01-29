# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.31] - 2026-01-28

### 🦀 Rust Native Module Production Release

All Rust native modules are now production-ready with clean builds and comprehensive test coverage.

### Fixed

- **Clean Rust build**: Removed all compiler warnings (unused imports, dead code, unused variables)
- **Version sync**: All packages now at 0.9.31 (including @drift/ai which was at 0.9.28)

### Verified

- **70 Rust unit tests passing**
- **3,118 TypeScript tests passing** (including 51 E2E regression tests)
- **All 10 native modules wired and functional**:
  - `scan`, `parse`, `buildCallGraph` (SQLite storage - 8x faster)
  - `scanBoundaries`, `analyzeCoupling`, `analyzeTestTopology`
  - `analyzeErrorHandling`, `analyzeConstants`, `analyzeEnvironment`
  - `analyzeWrappers`, `analyzeReachabilitySqlite`, `analyzeInverseReachabilitySqlite`

## [0.9.30] - 2026-01-28

### 🧪 CIBench v2: Frontier Codebase Intelligence Benchmark

Introduces CIBench v2, a novel benchmark for measuring how well tools **understand** codebases, not just navigate them. Unlike existing benchmarks that test pattern matching, CIBench tests actual understanding through counterfactual reasoning, calibrated confidence, and generative probes.

### Added

- **Four-Level Evaluation Framework**:
  - Level 1: Perception (30%) - Pattern detection, call graphs, data flow
  - Level 2: Understanding (35%) - Architectural intent, causal reasoning, uncertainty quantification
  - Level 3: Application (25%) - Token efficiency, compositional reasoning, iterative refinement
  - Level 4: Validation (10%) - Human correlation

- **Novel Evaluation Methodology**:
  - **Counterfactual Evaluation**: "What would happen if X changed?" - tests causal understanding
  - **Calibration Measurement**: ECE/MCE metrics for confidence calibration
  - **Generative Probes**: Tools must generate explanations, not just match patterns
  - **Adversarial Robustness**: Probes designed to expose weaknesses
  - **Negative Knowledge**: Tests knowing what NOT to do

- **v2 Schema** (`drift/packages/cibench/src/schema/v2/`):
  - `manifest.ts` - Corpus metadata, evaluation config
  - `perception.ts` - Patterns, call graph, data flow ground truth
  - `understanding.ts` - Intent, causality, uncertainty ground truth
  - `application.ts` - Efficiency, composition, refinement ground truth
  - `probes.ts` - Generative probes for testing understanding

- **v2 Evaluator** (`drift/packages/cibench/src/evaluator/v2/`):
  - `calibration.ts` - ECE/MCE calculation, reliability diagrams
  - `perception-scorer.ts` - Pattern and call graph scoring
  - `understanding-scorer.ts` - Intent, causal, uncertainty scoring
  - `application-scorer.ts` - Efficiency, composition, refinement scoring
  - `probe-evaluator.ts` - Generative probe evaluation

### Changed

- Updated `drift/packages/cibench/README.md` with v2 framework documentation
- Updated `drift/docs/designs/CIBENCH-SPEC.md` with v2 specification

## [0.9.29] - 2026-01-28

### 🚀 Enterprise Codebase Performance Fix

### Fixed

- **OOM Prevention in Call Graph Builder**: Fixed heap exhaustion when building call graphs for large codebases (1600+ files). The resolution pass now uses a disk-backed function index (NDJSON format) instead of keeping all function mappings in memory. This allows processing codebases of any size without hitting the 4GB heap limit.

### Technical Details

The previous implementation built two unbounded in-memory Maps during `runResolutionPass()`:
- `functionIndex: Map<string, string[]>` - name → [function IDs]
- `functionFiles: Map<string, string>` - functionId → file

For a codebase with ~50K functions, these maps could consume 500MB+ of memory, causing OOM at ~776/1607 files.

The fix:
1. **Phase 1**: Stream function metadata to disk as NDJSON (`.drift/lake/callgraph/resolution-index.ndjson`)
2. **Phase 2**: Load the lightweight index back into memory (only name, id, file - not full function bodies)
3. **Phase 3**: Resolve calls in batches with cache invalidation
4. **Cleanup**: Remove temporary index file after completion

Memory comparison for 50K functions:
- Full shards in memory: ~500MB+ (causes OOM)
- Index only: ~5-10MB (fits easily)

Addresses timeout issues for large enterprise codebases (979+ files) by expanding default ignores, adding missing language extensions, and providing better pre-scan feedback.

### Added

- **`--max-file-size <bytes>` CLI flag**: Skip files larger than threshold (default: 1MB)
  - Prevents giant generated files (migrations, bundles) from choking the scanner
- **Pre-scan estimation**: Warns users about expected scan duration for large codebases
  - Shows estimated time for 500+ files
  - Suggests `--timeout` increase or subdirectory scan for 2000+ files
- **Blazor/Razor support**: Added `.razor` and `.cshtml` to scannable extensions

### Fixed

- **Missing file extensions in `isScannableFile`**:
  - Added: `.go`, `.rs`, `.c`, `.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`, `.h++`, `.h`, `.mts`, `.cts`, `.razor`, `.cshtml`
  - Now aligned with `file-walker.ts` EXTENSION_LANGUAGE_MAP

- **Ecosystem-aware default ignores** - dramatically reduces file count for enterprise projects:
  - **.NET/C#/MAUI/Blazor**: `bin/`, `obj/`, `packages/`, `.vs/`, `*.dll`, `*.exe`, `*.pdb`, `*.nupkg`, `wwwroot/lib/`
  - **Java/Spring/Gradle/Maven**: `target/`, `.gradle/`, `.m2/`, `*.class`, `*.jar`, `*.war`
  - **Go**: `vendor/`
  - **C++/CMake**: `cmake-build-*/`, `out/`, `*.o`, `*.obj`, `*.a`, `*.lib`, `*.so`, `*.dylib`
  - **Python**: `.eggs/`, `*.egg-info/`, `.tox/`, `.mypy_cache/`, `.pytest_cache/`
  - **Node extras**: `.npm/`, `.yarn/`, `.pnpm-store/`, `.next/`, `.nuxt/`
  - **Archives**: `*.zip`, `*.rar`, `*.7z`, `*.tar`, `*.gz`
  - **IDE**: `.idea/`, `.vscode/`, `*.swp`, `*.swo`
  - **Logs**: `*.log`, `logs/`

### Changed

- Improved timeout error message with ecosystem-specific `.driftignore` examples
- `maxFileSize` now wired through from CLI to FileWalker (was defined but not exposed)

## [0.9.28] - 2026-01-28

### 🎉 Major Release: All 6 Critical Gaps Resolved

This release completes a comprehensive quality-of-life overhaul addressing 6 critical gaps in the Drift analysis pipeline. Pattern metadata, outlier detection, backend DNA analysis, test topology, call graph resolution, and boundary field extraction now work end-to-end.

### Added

#### Gap 6: Multi-Framework Boundary Field Extraction
- **New field extractor framework** with pluggable ORM-specific extractors
- **7 framework extractors**: Supabase, Prisma, Django, SQLAlchemy, GORM (Go), Diesel (Rust), Raw SQL
- **Added missing language support**: Go, Rust, C++ now included in boundary scanning
- **Rich field metadata**: confidence scores, field sources (query/model/filter/insert/update), relationship detection
- **Model definition parsing**: Extracts fields from ORM model/entity definitions

#### Gap 4: Test Topology Integration
- **`--test-topology` flag** on `drift scan` command
- Builds test topology during scan instead of requiring separate command
- Shows coverage stats and warnings for low coverage

#### Gap 3: Backend DNA Analysis
- **4 new backend gene extractors**: API Response Format, Error Response Format, Logging Format, Configuration Pattern
- **`--mode backend`** option for `drift dna scan`
- **Backend framework detection**: FastAPI, Flask, Django, Express, NestJS, Spring, Laravel, Gin, Actix

### Fixed

#### Gap 1: Worker Bridge Metadata Preservation
- Pattern locations now preserve `isOutlier`, `outlierReason`, `matchedText`, `confidence`
- Metadata flows through entire pipeline from detectors to storage

#### Gap 2: Statistical Outlier Detection During Scan
- Outliers now detected during scan (not just after approval)
- Uses z-score and IQR methods for statistical outlier detection
- `totalOutliers` tracked in manifest, visible in status views

#### Gap 5: Call Graph Resolution Stats Persistence
- Resolution stats (`resolvedCalls`, `unresolvedCalls`, `resolutionRate`) now persisted
- Two-pass streaming build: extract → resolve → persist
- Stats visible in `drift callgraph build` and `drift callgraph status` output

### Production Test Results
- **Gap 1**: ✅ Pattern metadata preserved (isOutlier, confidence in all locations)
- **Gap 2**: ✅ 128 outliers detected during scan
- **Gap 3**: ✅ Backend framework (FastAPI) and 4 genes detected
- **Gap 4**: ✅ Test topology built during scan
- **Gap 5**: ✅ 14,818/68,101 (22%) calls resolved, stats persisted
- **Gap 6**: ✅ 228 tables, 4,118 access points, fields extracted

## [0.9.27] - 2026-01-27

### Fixed

#### npm Install Compatibility
- Fixed `workspace:*` dependencies not being resolved during npm publish
- Changed internal dependencies to explicit `^0.9.26` versions for npm compatibility

## [0.9.26] - 2026-01-27

### Fixed

#### drift_capabilities Documentation Completeness
- Added missing Surgical layer (12 tools) to `drift_capabilities` output
- Added missing `drift_env` to Exploration layer
- Tool count now correctly shows 49 tools (was showing 36)

## [0.9.25] - 2026-01-27

### Added

#### Intelligent MCP Tool Filtering
- Auto-detects project languages and only exposes relevant MCP tools
- Reduces tool count from 49 to ~42 for single-language projects
- Zero config: works out of the box with smart defaults
- Override via `.drift/config.json` `mcp.tools` section

## [0.9.24] - 2026-01-27

### Fixed

#### Documentation Sync & .gitignore Guidance
- Fixed `drift security-summary` documented in README but doesn't exist (changed to `drift boundaries sensitive`)
- Removed `drift decisions` from CLI-Reference.md (MCP-only feature)
- Added documentation validation script (`pnpm validate-docs`) to prevent future drift
- Added CI step to validate documentation on every PR

#### Improved .gitignore Guidance
- Updated FAQ with simpler, explicit .gitignore pattern (no complex negations)
- Added `.drift/**/.backups/` to recommended ignore list (fixes .backups files appearing in git status)
- `drift init` now displays recommended .gitignore additions

### Changed

#### Package Version Sync
- Synchronized all package versions to 0.9.24
- Changed internal dependencies to use `workspace:*` protocol for consistency

## [0.9.12] - 2026-01-27

### Fixed

#### drift_env Tool Error When No Data Exists
- Fixed `drift_env` returning "Response data is required" error when no environment variable data exists
- Now returns a proper empty response with helpful guidance to run `drift env scan` first

## [0.9.11] - 2026-01-26

### Fixed

#### Package Dependencies for npm Publishing
- Fixed `workspace:*` dependencies in `driftdetect-mcp` package.json
- Changed to explicit `^0.9.9` versions for npm compatibility

## [0.9.10] - 2026-01-26

### Fixed

#### Missing Surgical Tool Handlers in MCP Server
- Fixed `drift_callers`, `drift_signature`, `drift_imports`, `drift_prevalidate`, `drift_similar`, `drift_type`, `drift_recent`, `drift_test_template`, `drift_dependencies`, `drift_middleware`, `drift_hooks`, and `drift_errors` returning "Unknown tool" error
- These tools were registered in the tool list but missing from the routing logic in `enterprise-server.ts`
- All 12 surgical tools now properly route to their handlers

## [0.9.9] - 2026-01-26

### Fixed

#### Package Version Consistency
- Synchronized all package versions to 0.9.9
- Fixed `driftdetect-dashboard` having outdated dependencies (`driftdetect-core: ^0.8.2` and `driftdetect-galaxy: ^0.8.2`)
- Fixed `driftdetect-vscode` having outdated dependency (`driftdetect-lsp: ^0.8.1`)
- All packages now use consistent `^0.9.9` dependencies
- This eliminates npm deduplication issues where multiple versions of core packages were installed

## [0.9.7] - 2026-01-26

### Fixed

#### Impact Analysis Bug with Sharded Call Graph
- Fixed `drift_impact_analysis` crashing with "call.resolvedCandidates is not iterable" error
- The sharded call graph format was missing `resolvedCandidates` array when loading calls
- Added defensive handling in `ImpactAnalyzer` to handle both `calleeId` and `resolvedCandidates`

#### Call Graph Store Missing Fields
- Added missing `resolvedCandidates`, `argumentCount`, and `file` fields when loading from sharded format
- Ensures full compatibility between legacy and sharded call graph storage

### Added

#### Dynamic Project Resolution for MCP
- MCP tools now support a `project` parameter to query different registered projects
- Example: `drift_status` with `project="my-other-project"` will analyze that project
- Stores are dynamically initialized for the requested project
- Falls back to the default project if not specified

#### New Infrastructure Function
- Added `getActiveProjectRoot()` function to resolve the active project from the registry
- Enables future improvements for automatic project switching

## [0.9.6] - 2026-01-26

### Fixed

#### Pattern Storage Dual-Write Issue
- **CRITICAL FIX**: Removed dual pattern storage that was causing patterns to be written to both `.drift/patterns/` and `.drift/lake/patterns/`
- Patterns are now only written to `.drift/patterns/{status}/{category}.json` (single source of truth)
- Removed `dataLake.patternShards.saveAll()` call from scan command
- This eliminates potential data divergence between the two storage locations
- Views and indexes in `.drift/views/` and `.drift/indexes/` continue to be materialized correctly

### Changed
- `PatternShardStore` is now deprecated - use `PatternStore` for pattern persistence
- `.drift/lake/patterns/` directory may contain stale data from previous versions and can be safely deleted

## [0.9.5] - 2026-01-26

### Added

#### Docker Deployment Support
Containerized deployment for the MCP server (thanks [@Ntrakiyski](https://github.com/Ntrakiyski) for the contribution!):

- **HTTP Server**: New `drift-mcp-http` binary exposing MCP over HTTP/SSE transport
  - `GET /health` - Health check endpoint
  - `GET /sse` - SSE endpoint for MCP communication
  - `POST /message` - Send messages to MCP server
- **Dockerfile**: Multi-stage build for optimized production images
  - Non-root user for security
  - Health checks built-in
- **docker-compose.yml**: Ready-to-use configuration
  - Volume mounts for project analysis
  - Environment variable configuration
  - Resource limits (4GB memory)
- **.env.example**: Template for environment configuration

Usage:
```bash
PROJECT_PATH=/path/to/your/project docker compose up -d
curl http://localhost:3000/health
```

### Fixed

#### Pattern Approval Persistence
- Fixed patterns not persisting to disk after approval/ignore operations
- `PatternStoreAdapter.approve()` and `ignore()` now call `saveAll()` immediately
- Previously, patterns were only updated in memory but not written to `.drift/patterns/`

## [0.9.4] - 2026-01-26

### Fixed

#### Call Graph Persistence
- Fixed call graph data not persisting after build
- `CallGraphStore` now loads from lake storage (`.drift/lake/callgraph/`) in addition to legacy path
- `callGraphExists()` check updated to look in correct location
- Dashboard `loadCallGraph()` updated to support both storage formats
- All call graph commands (`status`, `reach`, `inverse`, etc.) now work correctly after build

### Added

#### User Guidance Commands
New commands to help users get started and troubleshoot issues:

- **`drift next-steps`** - Personalized recommendations based on project state
  - Analyzes project type, languages, frameworks
  - Recommends high-priority actions (init, scan, review patterns)
  - Suggests language-specific commands
  - Shows analysis data status (call graph, test topology, coupling)

- **`drift troubleshoot`** - Diagnose common issues with targeted fixes
  - Checks initialization, configuration, patterns
  - Detects .driftignore problems
  - Finds large directories slowing scans
  - Validates Node.js version compatibility
  - Checks MCP configuration

#### Enhanced MCP Capabilities Tool
- `drift_capabilities` now documents all 45+ tools with:
  - Token cost estimates (low/medium/high)
  - Use case guides (code generation, security audit, refactoring)
  - Common workflows with tool sequences
  - Layer organization (orchestration, discovery, exploration, detail, analysis, language-specific, generation, enterprise)

#### Language CLI & MCP Tool Parity
Complete CLI commands and MCP tools for all 8 supported languages:

- **TypeScript/JavaScript** (`drift ts`, `drift_typescript`)
  - Actions: status, routes, components, hooks, errors, data-access, decorators
  - Frameworks: Express, NestJS, Next.js, Fastify
  - Data access: Prisma, TypeORM, Drizzle, Sequelize, Mongoose

- **Python** (`drift py`, `drift_python`)
  - Actions: status, routes, errors, data-access, decorators, async
  - Frameworks: Flask, FastAPI, Django, Starlette
  - Data access: Django ORM, SQLAlchemy, Tortoise, Peewee

- **Java** (`drift java`, `drift_java`)
  - Actions: status, routes, errors, data-access, annotations
  - Frameworks: Spring MVC, JAX-RS, Micronaut, Quarkus
  - Data access: Spring Data JPA, Hibernate, JDBC, MyBatis

- **PHP** (`drift php`, `drift_php`)
  - Actions: status, routes, errors, data-access, traits
  - Frameworks: Laravel, Symfony, Slim, Lumen
  - Data access: Eloquent, Doctrine, PDO

#### New Core Analyzers
- `packages/core/src/typescript/typescript-analyzer.ts` - Full TypeScript/JS analysis
- `packages/core/src/python/python-analyzer.ts` - Full Python analysis
- `packages/core/src/java/java-analyzer.ts` - Full Java analysis
- `packages/core/src/php/php-analyzer.ts` - Full PHP analysis

### Fixed

- **Dashboard build cache**: Fixed stale tsbuildinfo causing dashboard server JS files to not emit

## [0.8.1] - 2026-01-26

### Fixed

- **Internal dependency versions**: Fixed CLI and dashboard packages to correctly depend on 0.8.x versions of internal packages (was incorrectly pointing to 0.7.1)

## [0.8.0] - 2026-01-26

### 🚀 Major Release: 8 Languages, 45+ MCP Tools, Comprehensive Documentation

This release marks a significant milestone with full support for 8 programming languages, a complete MCP tool suite, and enterprise-grade documentation.

---

### ⭐ Headline Features

#### 🦀 Rust Language Support
Complete Rust language support with Tree-sitter parsing:

- **Framework Detection**: Actix-web, Axum, Rocket, Warp
- **Data Access**: Diesel, SQLx, SeaORM pattern detection
- **Error Handling**: Result/Option patterns, `?` operator tracking, custom error types
- **Safety Analysis**: `unsafe` block detection and tracking
- **Trait Analysis**: Trait implementations and bounds
- **CLI Command**: `drift rust` with status, unsafe, errors, traits actions
- **MCP Tool**: `drift_rust` for AI agent integration

#### ⚙️ C++ Language Support
Complete C++ language support with Tree-sitter parsing:

- **Framework Detection**: Qt, Boost.Beast, Crow, custom frameworks
- **Memory Analysis**: Smart pointer usage, raw pointer tracking, RAII patterns
- **Polymorphism**: Virtual function detection, inheritance hierarchies
- **Template Analysis**: Template instantiation tracking
- **Data Access**: Database library pattern detection
- **CLI Command**: `drift cpp` with status, memory, templates, virtual actions
- **MCP Tool**: `drift_cpp` for AI agent integration

#### 🐹 Go Language Support (Enhanced)
Improved Go support with additional analysis:

- **Goroutine Tracking**: Concurrent code pattern detection
- **Interface Analysis**: Implementation tracking
- **Error Handling**: Go-style error patterns

#### 📚 Comprehensive Wiki Documentation
22 wiki pages covering every aspect of Drift:

- **Getting Started**: Quick start, MCP setup, configuration
- **MCP Server**: Tools reference (45+ tools), architecture (7-layer design)
- **Deep Dives**: Call graph, security, test topology, coupling analysis
- **CI/CD**: Quality gates, CI integration, Git hooks, incremental scans
- **Community**: Contributing guide, 50+ FAQ, troubleshooting

#### 🏗️ MCP Architecture — The Gold Standard
Documented 7-layer MCP architecture:

1. **Orchestration**: Intent-aware context (`drift_context`)
2. **Discovery**: Quick health checks (`drift_status`, `drift_capabilities`)
3. **Surgical**: Ultra-focused lookups (12 tools, 200-500 tokens each)
4. **Exploration**: Paginated browsing with filters
5. **Detail**: Deep dives into specific items
6. **Analysis**: Complex computation (coupling, test topology, error handling)
7. **Generation**: AI-assisted code generation and validation

---

### Added

#### Rust Support (`packages/core/src/rust/`)
- `rust-analyzer.ts` - Main Rust analysis orchestrator
- `index.ts` - Public exports

#### Rust Extractors (`packages/core/src/call-graph/extractors/`)
- `rust-extractor.ts` - Tree-sitter based Rust extraction
- `rust-hybrid-extractor.ts` - Hybrid extractor with regex fallback
- `rust-data-access-extractor.ts` - Diesel, SQLx, SeaORM detection
- `regex/rust-regex.ts` - Regex fallback patterns

#### Rust Parsers (`packages/core/src/parsers/tree-sitter/`)
- `tree-sitter-rust-parser.ts` - Rust-specific tree-sitter parser

#### Rust Detectors (`packages/detectors/src/`)
- `api/rust/actix-detector.ts` - Actix-web framework detection
- `api/rust/axum-detector.ts` - Axum framework detection
- `auth/rust/middleware-detector.ts` - Auth middleware detection
- `errors/rust/error-handling-detector.ts` - Rust error patterns

#### C++ Support (`packages/core/src/cpp/`)
- `cpp-analyzer.ts` - Main C++ analysis orchestrator
- `index.ts` - Public exports

#### C++ Extractors (`packages/core/src/call-graph/extractors/`)
- `cpp-extractor.ts` - Tree-sitter based C++ extraction
- `cpp-hybrid-extractor.ts` - Hybrid extractor with regex fallback
- `cpp-data-access-extractor.ts` - Database library detection
- `regex/cpp-regex.ts` - Regex fallback patterns

#### C++ Parsers (`packages/core/src/parsers/tree-sitter/`)
- `tree-sitter-cpp-parser.ts` - C++-specific tree-sitter parser

#### C++ Detectors (`packages/detectors/src/`)
- `api/cpp/boost-beast-detector.ts` - Boost.Beast detection
- `api/cpp/crow-detector.ts` - Crow framework detection
- `api/cpp/qt-detector.ts` - Qt framework detection
- `auth/cpp/middleware-detector.ts` - Auth middleware detection
- `errors/cpp/error-handling-detector.ts` - C++ error patterns

#### CLI Commands
- `drift rust` - Rust language analysis (status, unsafe, errors, traits)
- `drift cpp` - C++ language analysis (status, memory, templates, virtual)

#### MCP Tools
- `drift_rust` - Rust analysis for AI agents (4 actions)
- `drift_cpp` - C++ analysis for AI agents (4 actions)

#### Demo Projects
- `demo/rust-backend/` - Rust Actix-web API example
- Enhanced C++ examples

#### Wiki Documentation (22 pages)
- `Home.md` - Hero page with value proposition
- `Getting-Started.md` - Expanded quick start
- `MCP-Setup.md` - Setup for Claude, Cursor, Windsurf, Kiro, VS Code
- `MCP-Tools-Reference.md` - Complete 45+ tool documentation
- `MCP-Architecture.md` - Gold standard MCP design philosophy
- `Architecture.md` - How Drift works under the hood
- `Language-Support.md` - All 8 languages with frameworks
- `Call-Graph-Analysis.md` - Data flow deep dive
- `Security-Analysis.md` - Sensitive data tracking
- `Test-Topology.md` - Test-to-code mapping
- `Coupling-Analysis.md` - Dependency analysis
- `Quality-Gates.md` - 6 gates, policies, configuration
- `CI-Integration.md` - GitHub Actions, GitLab CI, Azure DevOps, CircleCI
- `Git-Hooks.md` - Husky, Lefthook, lint-staged
- `Incremental-Scans.md` - Performance optimization
- `CLI-Reference.md` - All 35+ commands
- `Pattern-Categories.md` - 14 pattern categories
- `Configuration.md` - Config options
- `Contributing.md` - How to help Drift learn
- `FAQ.md` - 50+ questions answered
- `Troubleshooting.md` - Common issues
- `_Sidebar.md` - Navigation

---

### Changed

- **Language Support**: Now 8 languages (TypeScript/JS, Python, Java, C#, PHP, Go, Rust, C++)
- **MCP Tools**: Now 45+ tools organized in 7-layer architecture
- **CLI Commands**: Now 35+ commands
- **README**: Complete revamp with visual flow diagrams
- **Root Directory**: Cleaned up (moved community files to `.github/`, `licenses/`, `docs/`)

---

## [0.7.1] - 2026-01-25

### Fixed

- **ConstraintStore initialization bug** - Fixed race condition where `rebuildIndex()` called methods requiring initialization before the `initialized` flag was set
- **CLI spinner not stopping on error** - Fixed `drift constraints extract` leaving spinner running after errors, requiring Ctrl+C to exit

## [0.7.0] - 2026-01-25

### Added

#### Complete Constant & Enum Extraction System
Enterprise-grade constant and enum tracking across all 7 supported languages:

- **Core Types & Store** (`packages/core/src/constants/`)
  - `types.ts` - Comprehensive type definitions for constants, enums, references
  - `store/constant-store.ts` - Persistent storage with category indexing
  - `analysis/categorizer.ts` - Auto-categorization into 10 categories (api, config, feature_flag, etc.)

- **Language Extractors** (regex-based with tree-sitter fallback ready)
  - TypeScript/JavaScript: const exports, enums, readonly properties
  - Python: module-level constants, Enum classes, Final annotations
  - Java: static final fields, enum declarations
  - C#: const/readonly fields, enum declarations
  - PHP: const/define, class constants, enums (PHP 8.1+)
  - Go: const blocks, iota patterns, type aliases

- **Analysis Engine**
  - `reference-finder.ts` - Track constant usage across codebase
  - `magic-detector.ts` - Find magic numbers/strings that should be constants
  - `dead-constant-detector.ts` - Identify unused constants
  - `consistency-analyzer.ts` - Detect naming inconsistencies
  - `security-scanner.ts` - Find hardcoded secrets (API keys, passwords, tokens)

- **MCP Tool: `drift_constants`** with 8 actions:
  - `status` - Overview of constants in codebase
  - `list` - List constants with filtering by category/language
  - `get` - Get detailed info about a specific constant
  - `usages` - Find all references to a constant
  - `magic` - Detect magic numbers/strings
  - `dead` - Find unused constants
  - `secrets` - Scan for hardcoded secrets
  - `inconsistent` - Find naming inconsistencies

- **CLI Command: `drift constants`**
  - Full subcommand support matching MCP actions
  - Table and JSON output formats
  - Category and language filtering

- **VSCode Integration**
  - `constants-tree-provider.ts` - Tree view with 3 modes (by category, by file, issues)
  - Command handlers for constant operations

- **Pattern Detector**
  - `constants-detector.ts` - Unified detector for constant-related patterns

- **Dashboard Tab**
  - `ConstantsTab.tsx` - Full dashboard with stats, filtering, and issue highlighting

- **310 passing tests** covering all extractors and analysis engines

### Documentation
- Updated `wiki/MCP-Tools-Reference.md` with `drift_constants` documentation
- Updated `wiki/CLI-Reference.md` with `drift constants` command documentation

## [Unreleased]

### Added

#### Surgical Tools for AI Code Generation (`packages/mcp/src/tools/surgical/`)
New ultra-focused, minimal-token tools designed specifically for AI coding assistants:

- **`drift_signature`** - Get function/class signatures without reading entire files
  - Returns signature, parameters, return type, and location
  - Token budget: 200-500 tokens (vs 2000+ for reading full files)
  
- **`drift_callers`** - Lightweight "who calls this function" lookup
  - Direct callers with optional transitive caller traversal
  - Much faster than full impact analysis
  - Includes public API detection and usage stats
  
- **`drift_imports`** - Resolve correct import statements
  - Learns codebase conventions (barrel vs deep, alias vs relative)
  - Returns ready-to-use import statements
  - Detects path aliases (@/, ~/)
  
- **`drift_prevalidate`** - Validate proposed code BEFORE writing
  - Catches pattern violations before they happen
  - Returns score, violations, and suggestions
  - Checks error handling, data access, typing, and config patterns

- **`drift_similar`** - Find semantically similar code
  - Matches by intent (api_endpoint, service, component, hook, utility, test, middleware)
  - Returns relevant examples with patterns and conventions
  - Analyzes naming, error handling, and import conventions from matches

- **`drift_type`** - Expand type definitions
  - Finds interface/type/class/enum definitions by name
  - Returns full shape with all fields and types
  - Shows related types (extends, contains, parameter, return)

- **`drift_recent`** - Show recent changes in area
  - Git-based change detection for specific directories/files
  - Identifies pattern changes and new conventions
  - Recommends recently-updated files as current examples

- **`drift_test_template`** - Generate test scaffolding
  - Detects test framework (vitest, jest, mocha)
  - Generates describe/it structure matching codebase conventions
  - Includes mock patterns and assertion styles from existing tests

- **`drift_dependencies`** - Multi-language package dependency lookup
  - Supports JS/TS (package.json), Python (requirements.txt, pyproject.toml), 
    Java (pom.xml, build.gradle), PHP (composer.json), C# (*.csproj), Go (go.mod)
  - Categorizes packages (framework, testing, database, utility, ui)
  - Filter by type (prod/dev/peer), category, or language

- **`drift_middleware`** - Middleware pattern lookup
  - Finds auth, logging, validation, and error handling middleware
  - Detects framework (Express, NestJS, Laravel, Spring, Go)
  - Returns usage counts and parameter signatures

- **`drift_hooks`** - React/Vue hooks lookup
  - Finds custom hooks by category (state, fetch, effect, form, auth)
  - Shows dependencies and usage patterns
  - Helps avoid duplicate hook creation

- **`drift_errors`** - Error types and handling gaps
  - action="types": Find custom error classes
  - action="gaps": Find missing error handling (swallowed errors, unhandled async)
  - action="boundaries": Find error boundaries and their coverage
  - Learns mocking style, assertion style, file patterns
  - Generates ready-to-use test template matching codebase conventions

All surgical tools follow enterprise patterns:
- ResponseBuilder with consistent envelope format
- Structured errors with recovery hints
- Metrics collection for observability
- Token budget awareness

## [0.6.1] - 2026-01-24

### Fixed
- Fixed internal package dependencies that were still referencing 0.5.0 instead of 0.6.0
- CLI, dashboard, detectors, and vscode packages now correctly depend on 0.6.x versions

## [0.6.0] - 2026-01-24

### 🚀 New Language & Framework Support

#### Go Language Support
Complete Go language support with hybrid extraction (tree-sitter + regex fallback):

- **Framework Detectors**: Gin, Echo, Fiber, Chi, net/http - covers ~95% of Go web projects
- **Data Access Matchers**: GORM, sqlx, database/sql pattern detection
- **Concurrency Analysis**: Goroutine spawning and channel usage tracking
- **Interface Detection**: Tracks which structs implement which interfaces
- **Test Topology**: Go testing package extraction with table-driven test support
- **CLI Command**: `drift go` with subcommands: status, routes, errors, interfaces, data-access, goroutines
- **MCP Tool**: `drift_go` with 6 actions for AI agent integration

#### WPF Framework Support
MVVM-aware analysis for Windows Presentation Foundation:

- **XAML Binding Extraction**: Parses all `{Binding Path}` expressions and maps to ViewModel properties
- **ViewModel Detection**: INotifyPropertyChanged, ObservableObject, RelayCommand patterns
- **DataContext Resolution**: Automatically links Views to ViewModels via DataContext
- **Binding Error Detection**: Finds missing properties, type mismatches before runtime
- **Resource Dictionary Parsing**: Extracts styles, templates, merged dictionaries
- **DependencyProperty Extraction**: Tracks custom dependency properties
- **IValueConverter Analysis**: Detects converter usage and implementations
- **Call Graph Integration**: MVVM data flow tracing through bindings
- **CLI Command**: `drift wpf` with subcommands: status, bindings, viewmodels, resources, errors
- **MCP Tool**: `drift_wpf` with 5 actions

### Added

#### Go Support (`packages/core/src/go/`)
- `go-analyzer.ts` - Main Go analysis orchestrator
- `index.ts` - Public exports

#### Go Extractors (`packages/core/src/call-graph/extractors/`)
- `go-extractor.ts` - Tree-sitter based Go function/call extraction
- `go-hybrid-extractor.ts` - Hybrid extractor with regex fallback
- `go-data-access-extractor.ts` - GORM, sqlx, database/sql detection
- `regex/go-regex.ts` - Regex fallback patterns for Go

#### Go Parsers (`packages/core/src/parsers/tree-sitter/`)
- `go-loader.ts` - Tree-sitter Go grammar loader
- `tree-sitter-go-parser.ts` - Go-specific tree-sitter parser

#### Go Test Topology (`packages/core/src/test-topology/extractors/`)
- `go-test-extractor.ts` - Go test file extraction
- `regex/go-test-regex.ts` - Regex fallback for Go tests

#### Go Unified Provider (`packages/core/src/unified-provider/`)
- `normalization/go-normalizer.ts` - Go AST normalization
- `matching/gorm-matcher.ts` - GORM pattern matching
- `matching/sqlx-matcher.ts` - sqlx pattern matching
- `matching/database-sql-matcher.ts` - database/sql pattern matching

#### Go Detectors (`packages/detectors/src/`)
- `api/go/gin-detector.ts` - Gin framework detection
- `api/go/echo-detector.ts` - Echo framework detection
- `api/go/fiber-detector.ts` - Fiber framework detection
- `api/go/chi-detector.ts` - Chi router detection
- `api/go/net-http-detector.ts` - net/http detection
- `auth/go/middleware-detector.ts` - Auth middleware detection
- `errors/go/error-handling-detector.ts` - Go error handling patterns

#### WPF Support (`packages/core/src/wpf/`)
- `types.ts` - WPF-specific type definitions
- `wpf-analyzer.ts` - Main WPF analysis orchestrator
- `extractors/xaml-hybrid-extractor.ts` - XAML parsing with regex fallback
- `extractors/viewmodel-hybrid-extractor.ts` - ViewModel extraction
- `extractors/regex/xaml-regex.ts` - XAML regex patterns
- `extractors/regex/viewmodel-regex.ts` - ViewModel regex patterns
- `extractors/binding-error-detector.ts` - Binding validation
- `extractors/dependency-property-extractor.ts` - DependencyProperty detection
- `extractors/value-converter-extractor.ts` - IValueConverter detection
- `extractors/resource-dictionary-parser.ts` - ResourceDictionary parsing
- `linkers/datacontext-resolver.ts` - View-ViewModel linking
- `linkers/viewmodel-linker.ts` - ViewModel relationship mapping
- `integration/wpf-callgraph-adapter.ts` - Call graph integration
- `integration/wpf-data-flow-tracer.ts` - MVVM data flow tracing

#### CLI Commands
- `drift go` - Go language analysis (status, routes, errors, interfaces, data-access, goroutines)
- `drift wpf` - WPF framework analysis (status, bindings, viewmodels, resources, errors)

#### MCP Tools
- `drift_go` - Go analysis for AI agents (6 actions)
- `drift_wpf` - WPF analysis for AI agents (5 actions)

#### Demo Projects
- `demo/go-backend/` - Go Gin API example with GORM
- `demo/wpf-sample/` - WPF MVVM example

### Changed
- **Package Versions**: All packages bumped to 0.6.0
- **Language Support**: Now supports TypeScript, Python, Java, C#, PHP, and Go
- **Framework Support**: Added WPF to existing React, Angular, Vue, Laravel, Spring Boot support

## [0.5.1] - 2026-01-24

### 🐛 Bug Fixes

#### MCP Server File Tools
- **Fixed `drift_files_list`**: Now correctly uses `IndexStore` instead of deprecated `ManifestStore` for file-to-pattern mapping
- **Fixed `drift_file_patterns`**: Now correctly uses `IndexStore` and `PatternStore` APIs for retrieving file patterns
- Both tools now properly read from `.drift/indexes/by-file.json` which contains the actual file-to-pattern mappings

## [0.5.0] - 2026-01-24

### 🚀 Major Release: Unified Language Provider, Framework-Aware Extraction & Enterprise Features

This release brings significant improvements to multi-language support, framework detection, and enterprise-grade analysis capabilities.

---

### ⭐ Headline Features

#### 🔧 Unified Language Provider System
A complete rewrite of the language intelligence layer:

- **Unified Normalization**: Consistent AST normalization across TypeScript, Python, Java, C#, and PHP
- **Framework-Aware Matchers**: Specialized matchers for Eloquent, Mongoose, TypeORM, and more
- **Cross-Language Compatibility**: Same analysis patterns work across all supported languages
- **Extensible Architecture**: Easy to add new language support

#### 🧪 Test Topology Analysis
New system for understanding test coverage and structure:

- **Test Extractor Framework**: Language-specific test extractors for all supported languages
- **Regex Fallback Extractors**: Reliable extraction when tree-sitter isn't available
- **Test-to-Code Mapping**: Understand which tests cover which code paths
- **Coverage Gap Detection**: Find untested critical paths

#### 🔗 Module Coupling Analysis
Understand dependencies between modules:

- **Coupling Analyzer**: Detect tight coupling between modules
- **Dependency Graphs**: Visualize module relationships
- **Refactoring Suggestions**: Identify candidates for decoupling

#### ⚠️ Error Handling Analysis
Comprehensive error handling pattern detection:

- **Error Flow Tracking**: Follow error propagation through code
- **Missing Handler Detection**: Find unhandled error cases
- **Best Practice Validation**: Ensure consistent error handling patterns

#### 🎁 Framework Wrapper Detection
Intelligent detection of framework abstractions:

- **Wrapper Clustering**: Group related wrapper functions
- **Pattern Adaptation**: Connect wrappers to underlying patterns
- **Export Analysis**: Understand wrapper exposure and usage

#### 🔄 Hybrid Extractors with Regex Fallback
Enterprise-grade extraction reliability:

- **Tree-Sitter Primary**: Fast, accurate AST-based extraction
- **Regex Fallback**: Reliable extraction when parsing fails
- **Graceful Degradation**: Never lose data due to parse errors

### Added

#### Unified Provider System (`packages/core/src/unified-provider/`)
- `types.ts` - Unified type definitions for cross-language analysis
- `provider/unified-language-provider.ts` - Main provider orchestration
- `normalization/base-normalizer.ts` - Base class for language normalizers
- `normalization/typescript-normalizer.ts` - TypeScript/JavaScript normalization
- `normalization/python-normalizer.ts` - Python normalization
- `normalization/java-normalizer.ts` - Java normalization
- `normalization/csharp-normalizer.ts` - C# normalization
- `normalization/php-normalizer.ts` - PHP normalization
- `matching/eloquent-matcher.ts` - Laravel Eloquent pattern matching
- `matching/mongoose-matcher.ts` - Mongoose ODM pattern matching
- `matching/typeorm-matcher.ts` - TypeORM pattern matching
- `integration/unified-scanner.ts` - Unified scanning interface
- `integration/unified-data-access-adapter.ts` - Data access layer adapter

#### Test Topology (`packages/core/src/test-topology/`)
- `types.ts` - Test topology type definitions
- `test-topology-analyzer.ts` - Main analysis engine
- `extractors/typescript-test-extractor.ts` - TypeScript test extraction
- `extractors/python-test-extractor.ts` - Python test extraction
- `extractors/csharp-test-extractor.ts` - C# test extraction
- `extractors/php-test-extractor.ts` - PHP test extraction
- `extractors/regex/typescript-test-regex.ts` - TS regex fallback
- `extractors/regex/python-test-regex.ts` - Python regex fallback
- `extractors/regex/java-test-regex.ts` - Java regex fallback
- `extractors/regex/csharp-test-regex.ts` - C# regex fallback
- `extractors/regex/php-test-regex.ts` - PHP regex fallback

#### Module Coupling (`packages/core/src/module-coupling/`)
- `types.ts` - Coupling analysis types
- `coupling-analyzer.ts` - Module coupling detection

#### Error Handling (`packages/core/src/error-handling/`)
- `types.ts` - Error handling types
- `error-handling-analyzer.ts` - Error pattern analysis

#### Wrapper Detection (`packages/core/src/wrappers/`)
- `primitives/discovery.ts` - Wrapper discovery primitives
- `clustering/clusterer.ts` - Wrapper clustering algorithm
- `clustering/exclusions.ts` - Exclusion patterns
- `integration/scanner.ts` - Wrapper scanning integration
- `integration/pattern-adapter.ts` - Pattern system adapter
- `export/json.ts` - JSON export for wrappers

#### Hybrid Extractors (`packages/core/src/call-graph/extractors/`)
- `hybrid-extractor-base.ts` - Base class for hybrid extraction
- `typescript-hybrid-extractor.ts` - TS hybrid extractor
- `python-hybrid-extractor.ts` - Python hybrid extractor
- `java-hybrid-extractor.ts` - Java hybrid extractor
- `php-hybrid-extractor.ts` - PHP hybrid extractor
- `regex/base-regex-extractor.ts` - Base regex extractor
- `regex/typescript-regex.ts` - TS regex patterns
- `regex/python-regex.ts` - Python regex patterns
- `regex/java-regex.ts` - Java regex patterns
- `regex/csharp-regex.ts` - C# regex patterns
- `regex/php-regex.ts` - PHP regex patterns

#### CLI Commands
- `drift test-topology` - Analyze test structure and coverage
- `drift coupling` - Analyze module coupling
- `drift error-handling` - Analyze error handling patterns
- `drift wrappers` - Detect and analyze framework wrappers

#### MCP Tools
- `drift_test_topology` - Query test topology data
- `drift_coupling` - Query coupling analysis
- `drift_error_handling` - Query error handling patterns
- `drift_wrappers` - Query wrapper detection results

#### Skills Library
- 70+ new skill definitions for common patterns
- Comprehensive coverage of auth, data, API, and infrastructure patterns

### Changed

- **Worker Threads parallelization**: New `ThreadedWorkerPool` using Piscina for true multi-threaded file processing
  - **~40% faster scans** on multi-core machines (9.6s vs 17.3s on 389 files)
  - Worker warmup phase preloads detectors in parallel
  - Near-linear scaling with CPU cores for large repositories
- **Package Versions**: All packages bumped to 0.5.0
- **Unified Detector Base**: New `UnifiedDetector` base class for cross-language detectors
- **Pattern Repository**: Consolidated pattern storage with `UnifiedFileRepository`

### Fixed

- CLI version mismatch: `drift -v` now correctly reports installed version
- Include allowlist config for simpler project configuration

---

## [0.4.4] - 2026-01-22

### Fixed
- **CLI version mismatch**: `drift -v` now correctly reports the installed version instead of hardcoded `0.1.0` (thanks [@Carter003](https://github.com/Carter003) for the bug report!)
- Version now dynamically read from `package.json` in both CLI and VS Code extension

### Added
- **Include allowlist config**: New `include` option in `.drift/config.json` to specify directories to scan (thanks [@Carter003](https://github.com/Carter003) for the feature request!)
  - When set, only matching paths are scanned - much simpler than maintaining long ignore lists
  - Perfect for AI-heavy projects with many generated folders
  - Example: `"include": ["frontend/**", "backend/**"]`

## [0.4.0] - 2026-01-21

### 🚀 Major Release: Call Graph Analysis, Galaxy Visualization & Enterprise Architecture

This release transforms Drift from a pattern detection tool into a comprehensive **security-aware code intelligence platform**. With 104 files changed across 8 packages, this is our largest release yet.

---

### ⭐ Headline Features

#### 🌌 Galaxy Visualization (`driftdetect-galaxy`)
A stunning 3D visualization of your database access patterns, built with React Three Fiber:

- **Tables as Planets**: Database tables rendered as planets, sized by row count and colored by sensitivity
- **Fields as Moons**: Sensitive fields orbit their parent tables with visual indicators
- **Entry Points as Space Stations**: API endpoints shown as stations with auth level indicators
- **Data Paths as Hyperspace Lanes**: Animated connections showing data flow from APIs to tables
- **Security Tiers (P0-P4)**: Visual priority classification for security-critical paths
- **Interactive Controls**: Zoom, pan, filter by sensitivity, search, and click-to-inspect
- **Sound Effects**: Optional audio feedback for interactions (jsfxr-based)
- **Real-time Access Stream**: Watch data access events flow through the galaxy

#### 📊 Call Graph Analysis Engine
Complete static analysis of function calls and data flow:

- **Multi-Language Extractors**: Python, TypeScript/JS, C#, Java, PHP
- **Data Access Detection**: Automatically finds database queries across ORMs
  - SQLAlchemy, Django ORM, Prisma, TypeORM, Sequelize
  - Entity Framework Core, Dapper
  - Spring Data JPA, JDBC
  - Eloquent, Laravel Query Builder
- **Reachability Analysis**: "What data can this line of code access?"
- **Inverse Reachability**: "Who can reach this sensitive data?"
- **Impact Analysis**: "What breaks if I change this function?"
- **Dead Code Detection**: Find functions that are never called
- **Sensitive Data Coverage**: Which access paths to PII/credentials are tested?

#### 🔒 Security Enrichment Engine
Enterprise-grade security finding enrichment:

- **Data Impact Scoring**: Connect vulnerabilities to actual data exposure
- **Blast Radius Analysis**: Understand the full scope of a security issue
- **Priority Tiers (P0-P4)**: Automatic prioritization based on data sensitivity
- **Remediation Guidance**: Step-by-step fix instructions with code examples
- **Regulatory Mapping**: GDPR, HIPAA, PCI-DSS, SOX implications
- **Sensitivity Classification**: Credentials, Financial, Health, PII detection

#### 🏢 Enterprise MCP Server v2.0
Complete rewrite with layered architecture:

- **Discovery Layer**: `drift_status`, `drift_capabilities` - lightweight health checks
- **Exploration Layer**: `drift_patterns_list`, `drift_security_summary`, `drift_trends` - paginated listings
- **Detail Layer**: `drift_pattern_get`, `drift_code_examples`, `drift_reachability`, `drift_impact_analysis`
- **Orchestration Layer**: `drift_context` - smart context assembly for AI agents
- **Infrastructure**: Rate limiting, caching, metrics, cursor-based pagination
- **Token Budget Awareness**: Responses sized for AI context windows

#### 🗄️ Data Lake Architecture
Optimized storage for instant queries:

- **Manifest Store**: Single-file index for instant `drift_status`
- **Materialized Views**: Pre-computed responses for common queries
- **Sharded Storage**: Patterns, security data, call graphs partitioned by category
- **Index Store**: Fast lookups by file, category, table, entry point
- **Query Engine**: Unified interface for all data access
- **Incremental Updates**: Only rebuild what changed

---

### Added

#### Call Graph System (`packages/core/src/call-graph/`)
- `types.ts` - Core types: FunctionNode, CallSite, CallGraph, ReachabilityResult
- `analysis/graph-builder.ts` - Build call graphs from extracted functions
- `analysis/reachability.ts` - Forward reachability from code to data
- `analysis/path-finder.ts` - Find all paths between functions
- `analysis/impact-analyzer.ts` - Analyze change impact
- `analysis/dead-code-detector.ts` - Find unreachable functions
- `analysis/coverage-analyzer.ts` - Sensitive data test coverage
- `extractors/python-extractor.ts` - Python function/call extraction
- `extractors/typescript-extractor.ts` - TS/JS function/call extraction
- `extractors/csharp-extractor.ts` - C# function/call extraction
- `extractors/java-extractor.ts` - Java function/call extraction
- `extractors/php-extractor.ts` - PHP function/call extraction
- `extractors/*-data-access-extractor.ts` - ORM query detection per language
- `extractors/semantic-data-access-scanner.ts` - Cross-language data access
- `enrichment/enrichment-engine.ts` - Security finding enrichment
- `enrichment/impact-scorer.ts` - Data impact scoring (0-100)
- `enrichment/sensitivity-classifier.ts` - PII/credential detection
- `enrichment/remediation-generator.ts` - Fix guidance generation
- `store/call-graph-store.ts` - Persistent call graph storage

#### Galaxy Visualization (`packages/galaxy/`)
- `components/canvas/GalaxyCanvas.tsx` - Main 3D canvas with React Three Fiber
- `components/nodes/TablePlanet.tsx` - Database table visualization
- `components/nodes/FieldMoon.tsx` - Field visualization orbiting tables
- `components/nodes/EntryPointStation.tsx` - API endpoint visualization
- `components/connections/DataPath.tsx` - Animated data flow lines
- `components/ui/ControlsPanel.tsx` - View mode and filter controls
- `components/ui/SecurityPanel.tsx` - Security tier breakdown
- `components/ui/DetailsPanel.tsx` - Selected item details
- `components/ui/SearchOverlay.tsx` - Galaxy search interface
- `store/galaxy-store.ts` - Zustand state management
- `utils/layout-engine.ts` - Force-directed 3D layout
- `utils/color-utils.ts` - Sensitivity-based coloring
- `utils/geometry-utils.ts` - 3D math utilities
- `audio/sound-effects.ts` - jsfxr sound generation
- `hooks/useGalaxyData.ts` - Data fetching hook
- `hooks/useAccessStream.ts` - Real-time event stream

#### Data Lake (`packages/core/src/lake/`)
- `types.ts` - Manifest, View, Index, Shard type definitions
- `manifest-store.ts` - Quick-load project manifest
- `view-store.ts` - Pre-computed view storage
- `view-materializer.ts` - View generation and refresh
- `index-store.ts` - Fast lookup indexes
- `pattern-shard-store.ts` - Sharded pattern storage
- `security-shard-store.ts` - Sharded security data
- `callgraph-shard-store.ts` - Sharded call graph data
- `examples-store.ts` - Code example storage
- `query-engine.ts` - Unified query interface

#### Enterprise MCP Server (`packages/mcp/`)
- `enterprise-server.ts` - New layered server architecture
- `infrastructure/cache.ts` - Response caching
- `infrastructure/rate-limiter.ts` - Request rate limiting
- `infrastructure/metrics.ts` - Usage metrics collection
- `infrastructure/error-handler.ts` - Structured error responses
- `infrastructure/cursor-manager.ts` - Pagination cursors
- `infrastructure/response-builder.ts` - Token-aware responses
- `tools/discovery/status.ts` - Health check tool
- `tools/discovery/capabilities.ts` - Tool discovery
- `tools/exploration/patterns-list.ts` - Paginated pattern listing
- `tools/exploration/security-summary.ts` - Security overview
- `tools/exploration/trends.ts` - Pattern trend analysis
- `tools/detail/pattern-get.ts` - Single pattern details
- `tools/detail/code-examples.ts` - Real code examples
- `tools/detail/reachability.ts` - Data reachability queries
- `tools/detail/impact-analysis.ts` - Change impact analysis
- `tools/orchestration/context.ts` - Smart context assembly

#### VS Code Extension Rewrite (`packages/vscode/`)
- `activation/activation-controller.ts` - Lazy activation management
- `client/connection-manager.ts` - LSP connection handling
- `client/request-middleware.ts` - Request/response middleware
- `commands/command-definitions.ts` - Declarative command registry
- `commands/handlers/pattern-handlers.ts` - Pattern command handlers
- `commands/handlers/ui-handlers.ts` - UI command handlers
- `state/selectors.ts` - State selectors for UI
- `ui/decorations/decoration-controller.ts` - Code decorations
- `ui/status-bar/status-bar-controller.ts` - Status bar management
- `views/patterns-tree-provider.ts` - Pattern explorer tree
- `views/violations-tree-provider.ts` - Violations tree
- `webview/webview-manager.ts` - Webview lifecycle management

#### CLI Commands
- `drift callgraph` - Build and query call graphs
- `drift callgraph build` - Build call graph for project
- `drift callgraph reach <location>` - Query data reachability
- `drift callgraph inverse <table>` - Find who accesses data
- `drift callgraph impact <file>` - Analyze change impact
- `drift callgraph dead` - Find dead code
- `drift callgraph coverage` - Sensitive data test coverage
- `drift projects` - Multi-project management
- `drift projects list` - List registered projects
- `drift projects add <path>` - Register a project
- `drift projects remove <name>` - Unregister a project
- `drift projects switch <name>` - Switch active project

#### Tree-Sitter Parsers
- Full Java tree-sitter support with Spring Boot annotations
- Full PHP tree-sitter support with Laravel patterns
- TypeScript loader for tree-sitter-typescript

#### Dashboard Enhancements
- `GalaxyTab.tsx` - Galaxy visualization tab
- `ProjectSwitcher.tsx` - Multi-project dropdown
- `galaxy-data-transformer.ts` - Transform call graph to galaxy format

#### Design Documents
- `DATA-ARCHITECTURE.md` - Data lake architecture design
- `DATA-STORAGE-OPTIMIZATION.md` - Storage optimization strategies
- `ENTERPRISE-DATA-STORAGE.md` - Enterprise storage patterns
- `ENTERPRISE-MCP-SERVER.md` - MCP server v2 design
- `ENTERPRISE-VSCODE-EXTENSION.md` - VS Code extension architecture
- `SEMANTIC-DATA-ACCESS-ROADMAP.md` - Data access detection roadmap

---

### Changed

- **Package Versions**: All packages bumped to 0.4.0
- **MCP Server**: Complete rewrite with layered architecture
- **VS Code Extension**: Modular architecture with lazy activation
- **Dashboard**: Added Galaxy tab and project switcher
- **Core Exports**: Added call-graph, lake, and boundary modules

### Fixed

- Laravel auth detector constructor initialization
- Design-tokens regex matching CSS `color:` property incorrectly
- History-store test alignment with implementation API
- Various detector test improvements

### Breaking Changes

- MCP tool names changed (prefixed with `drift_`)
- VS Code extension internal architecture (no user-facing changes)

---

## [0.3.0] - 2026-01-21

### Added

#### Multi-Language Support
- **C# / ASP.NET Core** - Full pattern detection for .NET ecosystem
  - Auth: `[Authorize]` attributes, JWT, Identity, resource-based authorization
  - Data Access: Entity Framework Core, repository pattern, DbContext
  - Security: Input validation, SQL injection prevention
  - Errors: Exception patterns, `Result<T>` pattern
  - Logging: ILogger patterns, structured logging
  - Testing: xUnit patterns, test fixtures

- **PHP / Laravel** - Comprehensive Laravel framework support
  - Auth: Policies, Gates, middleware, Sanctum/Passport
  - Data Access: Eloquent ORM, relationships, query scopes
  - Security: Form Requests, CSRF, mass assignment protection
  - API: Resource controllers, API resources
  - Errors: Exception handlers, custom exceptions
  - Logging: Laravel logging channels

- **Java / Spring Boot** - Spring ecosystem pattern detection
  - Auth: Spring Security, `@PreAuthorize`, SecurityConfig
  - Data Access: Spring Data JPA, repositories, `@Transactional`
  - Security: Bean Validation (`@NotBlank`, `@Email`, `@Size`)
  - API: `@RestController`, `@RequestMapping` patterns
  - Errors: `@ControllerAdvice`, exception handlers

#### Data Boundaries System
- Track which code accesses which database tables/fields
- Detect sensitive field access patterns (passwords, tokens, PII)
- Boundary violation detection and reporting
- New CLI command: `drift boundaries`
- Dashboard visualization for data access patterns

#### Demo Repositories
- `demo/csharp-backend` - ASP.NET Core Web API example
- `demo/laravel-backend` - Laravel API example
- `demo/spring-backend` - Spring Boot example
- All demos validated with scanner for accuracy testing

### Fixed
- Symlink resolution on macOS (`/var` -> `/private/var` causing workspace detection failures)
- Design-tokens regex incorrectly matching CSS `color:` property
- History-store tests aligned with actual implementation API
- Laravel security detector constructor initialization

### Changed
- Detector count increased from 101 to 150+
- Improved tree-sitter parser support for Java

## [0.2.2] - 2025-01-20

### Added
- **Semantic Detectors**: New category of detectors that understand code meaning, not just syntax
- **MCP Server** (`driftdetect-mcp`): Model Context Protocol server for AI agent integration
  - `drift_status` - Pattern health overview
  - `drift_patterns` - Query patterns by category
  - `drift_files` - Patterns in specific files
  - `drift_where` - Find pattern usage locations
  - `drift_contracts` - FE/BE API contract mismatches
  - `drift_examples` - Real code examples from codebase
  - `drift_pack` - Pre-built pattern bundles
  - `drift_export` - AI-optimized pattern export
  - `drift_feedback` - Rate examples to improve suggestions
- **Contract Detection**: Automatic detection of frontend/backend API mismatches
  - Missing fields
  - Type mismatches
  - Nullability differences
- **Pattern Packs**: Pre-built bundles for common tasks
  - `backend_route` - API endpoint patterns
  - `react_component` - React component patterns
  - `data_layer` - Database access patterns
  - `testing` - Test structure patterns
  - `security_audit` - Security review patterns
- **Context-aware filtering**: Examples exclude deprecated code, config files, and docs

### Changed
- All 101 detectors transformed to learning-based architecture
- Improved confidence scoring algorithm
- Better outlier detection for pattern violations

### Fixed
- Dashboard pattern filtering performance
- Contract detection for nested response types

## [0.1.8] - 2025-01-15

### Added
- Initial public release
- 101 pattern detectors across 15 categories
- CLI with `init`, `scan`, `status`, `check`, `dashboard` commands
- Web dashboard for pattern management
- VS Code extension (beta)
- LSP server for editor integration

### Categories
- api, auth, security, errors, logging
- data-access, config, testing, performance
- components, styling, structural, types
- accessibility, documentation

---

## Version History

- **0.5.x** - Unified Language Provider, Framework-Aware Extraction, Test Topology, Module Coupling
- **0.4.x** - Call graph analysis, Galaxy visualization, Enterprise MCP v2, Data Lake
- **0.3.x** - Multi-language support (C#, PHP/Laravel, Java/Spring), data boundaries
- **0.2.x** - MCP integration, semantic detectors, contract detection
- **0.1.x** - Initial release, core functionality

[Unreleased]: https://github.com/dadbodgeoff/drift/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/dadbodgeoff/drift/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/dadbodgeoff/drift/compare/v0.4.0...v0.4.4
[0.4.0]: https://github.com/dadbodgeoff/drift/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/dadbodgeoff/drift/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/dadbodgeoff/drift/compare/v0.1.8...v0.2.2
[0.1.8]: https://github.com/dadbodgeoff/drift/releases/tag/v0.1.8
