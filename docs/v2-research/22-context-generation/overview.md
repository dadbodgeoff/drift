# Context Generation System

> `packages/core/src/context/` — 4 files, ~900 lines
> Powers `drift_context` and `drift_package_context` — the most important MCP tools.
> Flagged P0 in gap analysis. Previously documented only in `16-gap-analysis/context-generation.md`.

## What It Does

Generates AI-optimized, token-budgeted context for specific packages in a monorepo. Instead of dumping raw pattern data at an AI agent, this system curates exactly what the agent needs: relevant patterns, constraints, entry points, data accessors, key files, and guidance — all scoped to a single package and trimmed to fit a token budget.

This is the engine behind Drift's two most important MCP tools:
- `drift_context` — intent-aware context synthesis (the "meta-tool")
- `drift_package_context` — package-scoped context for monorepos

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Server                            │
│  ┌──────────────┐  ┌────────────────────┐               │
│  │drift_context  │  │drift_package_context│              │
│  └──────┬───────┘  └────────┬───────────┘               │
│         │                    │                           │
│         │    ┌───────────────▼──────────────┐            │
│         │    │  PackageContextGenerator     │            │
│         │    │  (context-generator.ts)      │            │
│         │    │                              │            │
│         │    │  Pipeline:                   │            │
│         │    │  1. Detect package           │            │
│         │    │  2. Load patterns            │            │
│         │    │  3. Load constraints         │            │
│         │    │  4. Extract entry points     │            │
│         │    │  5. Extract data accessors   │            │
│         │    │  6. Find key files           │            │
│         │    │  7. Generate guidance        │            │
│         │    │  8. Load dependency patterns │            │
│         │    │  9. Estimate & trim tokens   │            │
│         │    └──────────┬───────────────────┘            │
│         │               │                                │
│         │    ┌──────────▼───────────────┐                │
│         │    │    PackageDetector       │                │
│         │    │  (package-detector.ts)   │                │
│         │    │  11 package managers     │                │
│         │    └─────────────────────────┘                 │
│         │                                                │
│         ▼                                                │
│  ┌──────────────────────────────────────┐                │
│  │  drift_context handler              │                │
│  │  (orchestration/context.ts)         │                │
│  │  Intent-aware: add_feature,         │                │
│  │  fix_bug, understand, refactor,     │                │
│  │  security_review, etc.              │                │
│  └──────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

## File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `context-generator.ts` | ~280 | Main generator — pipeline, token management, AI formatting |
| `package-detector.ts` | ~530 | Monorepo package detection across 11 package managers |
| `types.ts` | ~230 | All type definitions for the context system |
| `index.ts` | ~35 | Public API barrel export |

## Key Classes

### PackageContextGenerator

The main orchestrator. Extends `EventEmitter` for lifecycle events.

**Constructor:** Takes `rootDir` (project root path). Creates an internal `PackageDetector`.

**Primary methods:**
- `generate(options)` → `PackageContextResult` — Full pipeline, returns structured context
- `generateAIContext(options)` → `AIContextFormat` — Convenience wrapper that formats for AI consumption
- `formatForAI(context)` → `AIContextFormat` — Converts structured context to AI-ready sections

**Pipeline (9 steps):**

1. **Detect package** — Uses `PackageDetector.getPackage()` to resolve package by name or path
2. **Load patterns** — Reads `.drift/patterns/{approved,discovered}/*.json`, filters by package scope, category, and confidence
3. **Load constraints** — Reads `.drift/constraints/{approved,discovered}/*.json`, filters by package scope
4. **Extract entry points** — Reads `.drift/lake/callgraph/files/*.json`, extracts API endpoints, event handlers, CLI commands (max 50)
5. **Extract data accessors** — Reads `.drift/lake/security/tables/*.json`, extracts database access points (max 30)
6. **Find key files** — Scores files by `confidence × occurrences` across patterns, returns top 10
7. **Generate guidance** — Synthesizes key insights, common patterns, and warnings from the data
8. **Load dependency patterns** — Optionally loads patterns from internal dependencies (cross-package)
9. **Estimate & trim tokens** — Estimates token count, trims to budget if over limit

### PackageDetector

Detects packages across 11 package managers in monorepos. Extends `EventEmitter`. Results are cached after first detection.

**Primary methods:**
- `detect()` → `MonorepoStructure` — Full monorepo detection (cached)
- `getPackage(nameOrPath)` → `DetectedPackage | null` — Find by name, path, or partial match
- `clearCache()` — Invalidate cached detection results

**Detection order** (first match wins):
1. npm workspaces (`package.json` → `workspaces`)
2. pnpm workspaces (`pnpm-workspace.yaml`)
3. yarn workspaces (`package.json` + `yarn.lock`)
4. Python (`pyproject.toml` / `setup.py` / `src/*/`)
5. Go (`go.mod` + `internal/`, `pkg/`, `cmd/`)
6. Maven (`pom.xml` → `<modules>`)
7. Gradle (`settings.gradle` → `include`)
8. Composer (`composer.json`)
9. .NET (`.sln` → Project references)
10. Cargo (`Cargo.toml` → `[workspace]`)
11. Root package fallback (single-package project)

## v2 Notes

- This is the most important MCP feature — it's what makes `drift_context` work
- The PackageDetector's 11-language support is impressive and must be preserved
- Token budgeting and trimming logic is critical for AI agent efficiency
- The guidance generation (insights, common patterns, warnings) adds significant value
- Consider: Should context generation be partially in Rust for speed on large monorepos?
