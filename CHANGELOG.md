# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
