# Pattern System — Overview

## Location
`packages/core/src/matcher/` — Confidence scoring, pattern matching, outlier detection
`packages/detectors/` — Pattern discovery (350+ detector files)
`packages/core/src/rules/` — Violation generation from patterns
`packages/core/src/storage/` — Pattern persistence (SQLite + JSON shards)

## What It Is
The pattern system is Drift's core intelligence. It scans codebases to discover conventions, scores them statistically, identifies deviations (outliers), and generates violations. Unlike linters that enforce prescribed rules, Drift learns what your codebase already does and flags inconsistencies.

## Core Design Principles
1. Learn from the codebase, don't enforce arbitrary rules
2. Confidence is statistical — based on frequency, consistency, age, and spread
3. Outliers (deviations from dominant patterns) become violations
4. Each pattern category has up to 3 detection strategies: regex (fast), learning (adaptive), semantic (deep)
5. Patterns have a lifecycle: discovered → approved/ignored
6. Everything is scored — no binary pass/fail

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    Rules Engine                          │
│  (evaluator.ts — violation generation from patterns)     │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Pattern  │Confidence│ Outlier  │   Variant               │
│ Matcher  │ Scorer   │ Detector │   Manager               │
├──────────┴──────────┴──────────┴────────────────────────┤
│                  Detector System                         │
│  Registry │ Loader │ 16 Categories │ 350+ Detectors      │
├─────────────────────────────────────────────────────────┤
│                  Detection Strategies                    │
│  Regex │ AST │ Semantic │ Structural │ Learning │ Unified│
├─────────────────────────────────────────────────────────┤
│                  Storage Layer                           │
│  SQLite (patterns, pattern_locations, pattern_variants)  │
│  JSON shards (.drift/patterns/*.json)                    │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `packages/core/src/matcher/pattern-matcher.ts` — `PatternMatcher`: multi-strategy matching engine
- `packages/core/src/matcher/confidence-scorer.ts` — `ConfidenceScorer`: weighted scoring
- `packages/core/src/matcher/outlier-detector.ts` — `OutlierDetector`: statistical deviation detection
- `packages/core/src/rules/evaluator.ts` — `Evaluator`: violation generation pipeline
- `packages/detectors/src/registry/detector-registry.ts` — `DetectorRegistry`: detector management

## Subsystem Directory Map

| Directory | Purpose | Doc |
|-----------|---------|-----|
| `matcher/` | Matching, scoring, outlier detection | [confidence-scoring.md](./confidence-scoring.md) |
| `matcher/` | Multi-strategy pattern matching | [pattern-matching.md](./pattern-matching.md) |
| `matcher/` | Statistical outlier detection | [outlier-detection.md](./outlier-detection.md) |
| `rules/` | Violation generation, severity, variants | [rules-engine.md](./rules-engine.md) |
| `storage/` | Pattern persistence and indexing | [storage.md](./storage.md) |
| — | Pattern data model and JSON schema | [data-model.md](./data-model.md) |
| — | Full detection pipeline end-to-end | [pipeline.md](./pipeline.md) |

## Detection Pipeline (end-to-end)

```
1. File Scanning     → Walk project, filter by .driftignore, collect files
2. Parsing           → Parse AST (tree-sitter), extract imports/exports
3. Detection         → Run enabled detectors against each file
4. Aggregation       → Merge PatternMatch results across files
5. Confidence Scoring → Calculate weighted composite score per pattern
6. Outlier Detection → Statistical analysis (Z-score or IQR)
7. Storage           → Persist to SQLite + JSON shards
8. Violation Gen     → Rules engine evaluates patterns → violations
```

## Pattern Lifecycle

```
Discovered → [User Review] → Approved / Ignored
                                ↓
                          Enforced (violations generated)
```

1. Pattern auto-discovered during `drift scan`
2. Initial status: `discovered` (informational only)
3. User can approve (enforced) or ignore (suppressed)
4. Approved patterns generate violations for outlier locations
5. Patterns track `firstSeen`, `lastSeen`, `source`

## Pattern Categories (16)

| Category | Subcategories | What It Detects |
|----------|--------------|-----------------|
| security | sql-injection, csrf, csp, xss, rate-limiting, secrets, sanitization | Security practice patterns |
| auth | token-handling, permission-checks, rbac, middleware, audit, ownership | Authentication/authorization patterns |
| errors | async-errors, circuit-breaker, error-codes, logging, propagation, hierarchy, try-catch | Error handling patterns |
| api | (structural) | API design patterns |
| components | structure, composition, duplicates, props, refs, state, modals | UI component patterns |
| config | validation, constants, defaults, env-naming, feature-flags, environment | Configuration patterns |
| contracts | backend-endpoints, frontend-types, schema-parsing | BE↔FE contract matching |
| data-access | connection-pooling, DTOs, n+1, queries, repository, transactions, validation | Data layer patterns |
| documentation | deprecation, examples, jsdoc, readme, todos | Documentation patterns |
| logging | context-fields, correlation-ids, health-checks, log-levels, metrics, pii, structured | Logging patterns |
| performance | bundle-size, caching, code-splitting, debounce, lazy-loading, memoization | Performance patterns |
| structural | barrel-exports, circular-deps, co-location, directory, file-naming, imports, boundaries | Code organization patterns |
| styling | class-naming, colors, design-tokens, responsive, spacing, tailwind, typography, z-index | Styling patterns |
| testing | co-location, describe-naming, file-naming, fixtures, mocks, setup-teardown, structure | Testing patterns |
| types | any-usage, file-location, generics, interface-vs-type, naming, assertions, utility | Type system patterns |
| accessibility | (accessibility patterns) | A11y patterns |

## MCP Integration
Pattern data is exposed via MCP tools in `packages/mcp/src/tools/`:
- `drift_patterns_list` — List patterns with filters
- `drift_pattern_get` — Get full pattern details
- `drift_file_patterns` — All patterns in a file
- `drift_code_examples` — Real code snippets from patterns
- `drift_validate_change` — Validate code against patterns
- `drift_prevalidate` — Quick pre-write validation

## V1 → V2 Changes
- V1: JSON shards as primary storage, SQLite as secondary
- V2: SQLite as single source of truth, JSON shards for backup/export only
- V2: Rust-owned writes, TypeScript reads via NAPI
- V2: Pattern matching moves to tree-sitter queries in Rust
- V2: Confidence weights preserved exactly (0.35/0.25/0.15/0.25 in gap analysis, 0.4/0.3/0.15/0.15 in code)
