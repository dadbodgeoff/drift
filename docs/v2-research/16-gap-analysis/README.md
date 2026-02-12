# Gap Analysis: What's Missing from v2-Research Docs

Systematic audit of the Drift codebase vs the 49 existing v2-research documents.
Organized by severity: what matters most for a faithful v2 recreation.

## Detailed Documentation (P0 gaps fully documented)

- [licensing-system.md](./licensing-system.md) — Full licensing & feature gating system
- [workspace-management.md](./workspace-management.md) — Full workspace lifecycle management
- [confidence-and-matching.md](./confidence-and-matching.md) — Confidence scoring algorithm & pattern matcher
- [audit-system.md](./audit-system.md) — Audit engine, health scoring, degradation tracking
- [context-generation.md](./context-generation.md) — Context generation & 11-language package detection

---

## CRITICAL GAPS (Will break v2 if missed)

### 1. Licensing & Feature Gating System — COMPLETELY UNDOCUMENTED
`packages/core/src/licensing/`

This is a **business-critical system** that gates enterprise features at runtime.

- `license-manager.ts` — License loading, validation, caching
- `license-validator.ts` — JWT/key validation, expiration checks
- `feature-guard.ts` — Runtime feature gating (checks tier before allowing feature use)
- `types.ts` — 3 tiers (community/team/enterprise), 16 enterprise features

**Tier structure:**
- Community (free): All scanning, detection, analysis, CI, MCP, VSCode
- Team: Policy engine, regression detection, custom rules, trends, exports
- Enterprise: Multi-repo governance, impact simulation, security boundaries, audit trails, Jira/Slack/webhooks, self-hosted models, custom detectors, REST API

**License sources:** env var (`DRIFT_LICENSE_KEY`), file (`.drift/license.key`), config

**Why this matters for v2:** The entire monetization model is encoded here. Every gated feature in quality-gates, dashboard, and integrations checks this system. If you rebuild without it, you lose the open-core boundary.

### 2. Workspace Management System — UNDOCUMENTED
`packages/core/src/workspace/`

This is the **project lifecycle orchestrator** — the thing that ties everything together.

- `workspace-manager.ts` — Top-level workspace initialization and management
- `project-switcher.ts` — Multi-project switching (invalidates caches, reloads stores)
- `context-loader.ts` — Loads all context for a project (patterns, contracts, boundaries, etc.)
- `backup-manager.ts` — Backup creation and restoration
- `schema-migrator.ts` — Database schema migrations across versions
- `source-of-truth.ts` — Source of truth management (which store is authoritative)

**Why this matters for v2:** This is the glue. Without understanding how projects are initialized, switched, backed up, and migrated, v2 won't have a coherent lifecycle.

### 3. Audit System — UNDOCUMENTED
`packages/core/src/audit/`

- `audit-engine.ts` — Pattern validation, health scoring, degradation detection
- `audit-store.ts` — Audit snapshot persistence
- `types.ts` — Audit types (snapshots, health scores, degradation metrics)

**Why this matters for v2:** The audit system is what tells users "your codebase is drifting." It's the core value proposition feedback loop.

### 4. Pattern Matcher & Confidence Scorer — UNDER-DOCUMENTED
`packages/core/src/matcher/`

The docs mention `outlier-detector.ts` and `types.ts` but miss:
- `confidence-scorer.ts` — The confidence scoring algorithm (frequency, consistency, age, spread)
- `pattern-matcher.ts` — The core pattern matching engine that evaluates patterns against files

**Why this matters for v2:** Confidence scoring is the heart of Drift's learning system. Without the exact algorithm, v2 patterns won't score the same way.

### 5. Context Generation System — ✅ NOW DOCUMENTED
`packages/core/src/context/`

- `context-generator.ts` — Generates AI-ready context from drift data
- `package-detector.ts` — Detects monorepo package boundaries
- `types.ts` — Context types

**Why this matters for v2:** This powers `drift_context` and `drift_package_context` MCP tools — the most important tools in the MCP server per the steering file.

**Documentation:** See `22-context-generation/` (overview, types, package-detector, token-management).


### 6. Telemetry System — UNDOCUMENTED
Two components:

**Client** (`packages/core/src/telemetry/`):
- `telemetry-client.ts` — Opt-in telemetry collection, event batching, privacy controls
- `types.ts` — Event types, configuration

**Server** (`infrastructure/telemetry-worker/`):
- Cloudflare Worker (D1 database)
- Endpoints: `POST /v1/events`, `GET /v1/health`, `GET /v1/stats`
- Tracks: event types, language usage, category usage, unique installations
- Daily aggregate stats with 30-day rolling window

**Why this matters for v2:** Telemetry informs product decisions. The client-side privacy controls and opt-in model need to be preserved.

---

## HIGH-PRIORITY GAPS (Important for feature parity)

### 7. Skills Library — 73 Architectural Templates — UNDOCUMENTED
`skills/` directory with 73 skill templates, each containing a `SKILL.md`:

Categories include: AI coaching, API patterns, caching strategies, circuit breakers, database migrations, distributed locks, error handling, feature flags, health checks, idempotency, JWT auth, leader election, logging/observability, metrics collection, multi-tenancy, OAuth, pagination, rate limiting, retry/fallback, row-level security, SSE streaming, Stripe integration, Supabase auth, webhook security, websocket management, worker orchestration, and many more.

**Why this matters for v2:** These are the "knowledge base" that Drift uses for code generation guidance. They represent significant domain expertise.

### 8. Wiki — 58 User Documentation Pages — UNDOCUMENTED
`wiki/` directory with comprehensive user-facing documentation:

Key pages: Architecture, Audit System, Call Graph Analysis, CI Integration, CLI Reference, Configuration, Cortex (7 pages covering causal graphs, code generation, learning, memory setup, predictive retrieval, token efficiency, universal memory types), Dashboard, Data Boundaries, Decision Mining, Detectors Deep Dive, FAQ, Getting Started, Git Hooks, Impact Analysis, Incremental Scans, Language Support, MCP (3 pages), Memory CLI, Monorepo Support, Pattern Categories, Quality Gates, Security Analysis, Skills, Speculative Execution, Styling DNA, Troubleshooting, Watch Mode, Wrappers Detection.

**Why this matters for v2:** This is the user-facing documentation. It contains usage patterns, examples, and explanations that reveal intended behavior not captured in code-level docs.

### 9. Demo Applications — 8 Reference Implementations — UNDOCUMENTED
`demo/` directory:
- `backend/` — Node.js/TypeScript backend
- `csharp-backend/` — C# backend
- `spring-backend/` — Spring Boot backend
- `laravel-backend/` — Laravel backend
- `go-backend/` — Go backend
- `rust-backend/` — Rust backend
- `wpf-sample/` — WPF/XAML sample
- `frontend/` — React frontend

**Why this matters for v2:** These are the test fixtures that validate Drift works across all supported languages/frameworks. They're the integration test suite.

### 10. GitHub Action — CI/CD Integration — UNDER-DOCUMENTED
`actions/drift-action/action.yml`:
- Composite action that installs `driftdetect-ci@latest`
- Inputs: github-token, fail-on-violation, post-comment, create-check, pattern-check, impact-analysis, constraint-verification, security-boundaries, memory-enabled
- Outputs: status, summary, violations-count, drift-score, result-json
- Runs `drift-ci analyze --pr <number>` with configurable options

### 11. Services Layer — ✅ DOCUMENTED (see `25-services-layer/overview.md`)
`packages/core/src/services/`
- `scanner-service.ts` — Scanning orchestration (coordinates native scanner, detectors, storage)
- `detector-worker.ts` — Worker thread for detector execution
- `index.ts` — Service exports

**Why this matters for v2:** This is the orchestration layer between CLI/MCP and the core engine.

### 12. Learning System — UNDER-DOCUMENTED
`packages/core/src/learning/`
- `learning-store.ts` — Persistence for learned patterns
- `types.ts` — Learning types

The docs mention learning in the context of detectors but don't document the standalone learning store that persists learned conventions across sessions.

---

## MEDIUM-PRIORITY GAPS (Behavioral details)

### 13. Unified Provider Internal Details — UNDER-DOCUMENTED
The docs describe the architecture but miss internal files:
- `parsing/parser-registry.ts` — Parser selection and registration
- `compat/legacy-extractors.ts` — Backward compatibility layer
- `compat/legacy-scanner.ts` — Legacy scanner wrapper
- `integration/unified-scanner.ts` — Drop-in replacement scanner
- `integration/unified-data-access-adapter.ts` — Bridge to existing format
- `docs/MIGRATION.md` — Internal migration guide

### 14. Speculative Execution — Split Across Two Directories
The docs cover `packages/core/src/simulation/` but miss:
- `packages/core/src/speculative/approach-generator.ts` — Separate approach generator
- `packages/core/src/speculative/templates/types.ts` — Template type definitions

These appear to be an older or parallel implementation.

### 15. Dual Licensing Model — UNDOCUMENTED
`licenses/` directory:
- `Apache-2.0.txt` — Open source license
- `BSL-1.1.txt` — Business Source License for enterprise features
- `LICENSING.md` — Comprehensive licensing FAQ and tier explanation

Each source file has a license header (`@license Apache-2.0` or `@license BSL-1.1`). The BSL code converts to Apache 2.0 after 4 years.

### 16. MCP Feedback System — UNDOCUMENTED
`packages/mcp/src/feedback.ts`

A full example quality feedback system that tracks user ratings on pattern examples:
- `FeedbackManager` class with file/directory-level scoring
- Rating system: good (+0.1 boost), bad (-0.15 penalty), irrelevant (-0.05)
- Directory-level score propagation (30% of file-level delta)
- File exclusion when confidence > 0.5 and boost < -0.5
- Persists to `.drift/feedback/examples.json` and `.drift/feedback/scores.json`
- Keeps last 5000 feedback entries

This is a reinforcement learning loop for example quality — completely undocumented.

### 17. MCP Pack Manager — UNDER-DOCUMENTED
`packages/mcp/src/packs.ts`

Much more than "tool subsets" — it's a full pack management system:
- `PackManager` class with custom pack creation, staleness detection, usage tracking
- Pack suggestion engine that infers packs from project structure
- Custom packs stored in `.drift/packs/`
- Pack content generation with pattern filtering, scoring, and caching
- Usage analytics tracking per pack

### 18. Storage Backend Auto-Detection — UNDOCUMENTED
`packages/core/src/storage/store-factory.ts`

The store factory automatically detects whether to use SQLite or JSON:
- `detectStorageBackend()` checks for `drift.db` (SQLite) vs `.drift/patterns/` (JSON)
- `hasSqliteDatabase()` and `hasJsonPatterns()` detection functions
- `getStorageInfo()` returns current backend, file counts, database size
- Transparent switching between backends based on what exists on disk

### 19. JSON↔SQLite Sync Service — UNDER-DOCUMENTED
`packages/core/src/storage/sync-service.ts`

A comprehensive bidirectional sync service with 11 sync methods:
- `syncAll()` — Full sync of all data types
- Individual syncs: boundaries, environment, call graph, audit, DNA, test topology, contracts, constraints, history, coupling, error handling
- Each sync method reads from JSON files and writes to SQLite repositories

### 20. Docker Deployment — UNDOCUMENTED
Multi-stage Docker build for the MCP HTTP server:
- Builder stage: Node 20, pnpm, native module compilation (tree-sitter)
- Production stage: Non-root user, 4GB memory limit, health checks
- Docker Compose: SSE endpoint at `/sse`, message endpoint at `/message`
- Volume mounting for project analysis and `.drift` cache persistence
- Environment: `NODE_OPTIONS=--max-old-space-size=4096`

### 21. Husky Git Hooks — UNDOCUMENTED
The root `package.json` includes `"prepare": "husky install"`, indicating pre-commit hooks are configured.

### 22. Build Scripts — UNDER-DOCUMENTED
`scripts/` directory:
- `generate-large-codebase.ts` — Generates synthetic codebases for benchmarking
- `publish.sh` — Package publishing workflow
- `transform-detector.ts` — Utility for transforming detector implementations
- `validate-docs.sh` / `validate-docs.ts` — Documentation validation

### 23. Turborepo Pipeline — UNDOCUMENTED
`turbo.json` defines the build pipeline:
- `build` → `typecheck` → `lint` → `test` dependency chain
- `^build` dependencies (build deps first)
- Caching enabled for build, typecheck, lint, test
- `test:watch` and `dev` marked as persistent (no cache)
- Coverage output tracking

### 24. Pattern System Consolidation (New Abstraction Layer) — ✅ DOCUMENTED
`packages/core/src/patterns/`

**Documentation:** See `23-pattern-repository/` — overview, interfaces, implementations, adapters, types (5 docs).

A complete new pattern data access layer:
- `repository.ts` — `IPatternRepository` interface with full CRUD, querying, filtering, sorting, pagination, events
- `service.ts` — `IPatternService` interface — the recommended consumer API for MCP/CLI/Dashboard
- `adapters/pattern-store-adapter.ts` — Bridges old `PatternStore` to new `IPatternRepository`
- `adapters/service-factory.ts` — Creates service instances
- `impl/file-repository.ts` — File-based implementation
- `impl/memory-repository.ts` — In-memory implementation
- `impl/cached-repository.ts` — Caching decorator
- `impl/unified-file-repository.ts` — Unified file repository
- `impl/pattern-service.ts` — Service implementation
- `impl/repository-factory.ts` — Repository factory

This is a full Repository + Service pattern with event-driven architecture. The MCP server already uses `IPatternService` when available (dual-path). This is the future of pattern storage in v2.

### 25. Pervasive EventEmitter Architecture — UNDOCUMENTED
Nearly every store and manager in the codebase extends `EventEmitter`:
- PatternStore, ContractStore, HistoryStore, ConstraintStore
- HybridPatternStore, HybridContractStore
- All Data Lake stores (IndexStore, QueryEngine, ViewStore, ViewMaterializer, PatternShardStore, CallGraphShardStore, SecurityShardStore, ExamplesStore, ManifestStore)
- WorkerPool, ThreadedWorkerPool
- ProjectRegistry, VariantManager
- PackageDetector, PackageContextGenerator
- CachedPatternRepository, PatternStoreAdapter

This means the entire system is event-driven with pub/sub patterns. Events like `pattern:added`, `pattern:approved`, `patterns:loaded` propagate through the system. This architecture must be preserved in v2.

---

## DEEP ALGORITHM GAPS (Exact values needed for v2 recreation)

### Confidence Scoring Algorithm
**Weights** (must sum to 1.0):
- Frequency: 0.40 (occurrences / totalLocations)
- Consistency: 0.30 (1 - variance)
- Age: 0.15 (linear scale, 0→30 days maps to minAgeFactor→1.0, minAgeFactor=0.1)
- Spread: 0.15 (fileCount / totalFiles)

**Thresholds:**
- High: score >= 0.85
- Medium: score >= 0.70
- Low: score >= 0.50
- Uncertain: score < 0.50

### Health Score Algorithm
**Weights** (must sum to 1.0):
- Average Confidence: 0.30
- Approval Ratio: 0.20
- Compliance Rate: 0.20 (locations / (locations + outliers))
- Cross-Validation Rate: 0.15
- Duplicate-Free Rate: 0.15

Score = weighted sum × 100, clamped to [0, 100]

### Audit Recommendation Thresholds
- Auto-approve: confidence >= 0.90, outlierRatio <= 0.50, locations >= 3, no error-severity issues
- Review: confidence >= 0.70
- Likely false positive: confidence < 0.70

### Learning System Defaults
- Min occurrences: 3
- Dominance threshold: 0.60 (60% must use same convention)
- Min files: 2
- Max files to analyze: 1000
- Learned patterns expire after 24 hours (re-learn on next scan)
- Stored in `.drift/learned/{detector-id}.json`

### Feedback Scoring
- Good example: +0.1 boost
- Bad example: -0.15 penalty
- Irrelevant: -0.05 penalty
- Directory propagation: 30% of file delta
- Exclusion threshold: boost < -0.5 AND confidence > 0.5
- Score → multiplier: `1 + (boost × 0.7)` (range: 0.3 to 1.7)

### Duplicate Detection
- Jaccard similarity on location sets (file:line pairs)
- Threshold: 0.85 similarity
- Only compares within same category
- Recommendation: merge if > 0.9, review if > 0.85

---

## CORRECTIONS TO EXISTING DOCS

### CLI Command Count
- Documented: "~45 commands"
- Actual: The `commands/index.ts` exports 48 named commands, plus `dna/` has subcommands, plus `setup/` has 13 runners. Real count is closer to 65+.

### MCP Tool Count
- Documented: "90+ tools"
- Actual: 56 unique tool names in the `routeToolCall()` switch statements (not counting memory tools that share the `executeMemoryTool` wrapper). With 17 memory tools routed there + the 33 memory tool files, total is ~56 routed tools.

### Matcher Directory
- Documented as containing: `types.ts`, `outlier-detector.ts`
- Actually contains: `types.ts`, `outlier-detector.ts`, `confidence-scorer.ts`, `pattern-matcher.ts`, `index.ts` + 3 test files

### .drift/ Directory Structure
The configuration doc lists the `.drift/` structure but misses:
- `.drift/learned/` — Learned pattern conventions (per-detector JSON files)
- `.drift/feedback/` — Example quality feedback (examples.json, scores.json)
- `.drift/packs/` — Custom MCP tool packs
- `.drift/license.key` — License key file
- `.drift/backups/` — Backup storage with retention policy

### Package Detector Scope
The context generation system supports monorepo detection for:
- npm workspaces, pnpm workspaces, yarn workspaces
- Python packages (pyproject.toml, setup.py, setup.cfg)
- Go modules (go.mod, go.work)
- Maven modules (pom.xml)
- Gradle modules (settings.gradle)
- Composer packages (composer.json)
- .NET projects (.csproj, .sln)
- Cargo workspaces (Cargo.toml)

This is far more comprehensive than documented.

### MCP Server Dual-Path Architecture
The enterprise server has a dual-path architecture not documented:
- Legacy path: Uses `PatternStore` (JSON-based) directly
- New path: Uses `IPatternService` (SQLite-backed) when available
- Tools like `drift_status`, `drift_patterns_list`, `drift_pattern_get`, `drift_code_examples`, `drift_prevalidate` all have dual implementations
- Similarly, `drift_security_summary`, `drift_contracts_list`, `drift_env`, `drift_dna_profile`, `drift_constraints` prefer SQLite (`UnifiedStore`) when available

---

## SUMMARY: Priority Order for v2 Recreation

| Priority | Gap | Impact |
|----------|-----|--------|
| P0 | Licensing/Feature Gating | Business model — 3 tiers, 16 features, JWT + simple keys |
| P0 | Workspace Management | Project lifecycle — init, switch, backup, migrate, source-of-truth |
| P0 | Confidence Scorer + Pattern Matcher | Core algorithm — exact weights and thresholds above |
| P0 | Context Generation | ✅ DOCUMENTED — see `22-context-generation/` |
| P0 | Audit System | Health scoring — exact weights above |
| P0 | Storage Backend Auto-Detection | Transparent JSON↔SQLite switching |
| ~~P1~~ | ~~Services Layer (ScannerService)~~ | ✅ Documented in `25-services-layer/overview.md` |
| P1 | Skills Library (73 templates) | Knowledge base for code generation |
| P1 | Telemetry System | Client + Cloudflare Worker backend |
| P1 | Learning Store + Types | Convention persistence — `.drift/learned/` |
| P1 | MCP Feedback System | Reinforcement learning for example quality |
| P1 | MCP Pack Manager | Custom packs, suggestion engine, usage tracking |
| P1 | JSON↔SQLite Sync Service | 11 sync methods for migration |
| P1 | MCP Dual-Path Architecture | Legacy JSON vs new SQLite tool implementations |
| P2 | Wiki (58 pages) | User documentation |
| P2 | Demo Apps (8 apps) | Integration test fixtures |
| P2 | GitHub Action | CI/CD — composite action with 8 inputs, 5 outputs |
| P2 | Docker Deployment | Multi-stage build, SSE/message endpoints |
| P2 | Dual Licensing (Apache 2.0 + BSL 1.1) | Legal/compliance |
| P2 | Turborepo Pipeline | Build dependency chain |
| P3 | Build scripts | Developer tooling |
| P3 | Husky hooks | Dev workflow |
| P3 | Speculative split | Code organization quirk |
