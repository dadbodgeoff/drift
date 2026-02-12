# Simulation Engine (Speculative Execution) — Overview

## Location
`packages/core/src/simulation/` — 100% TypeScript (~15 source files)

## What It Is
Pre-flight simulation of code changes. Given a task description (e.g., "add rate limiting to the API"), the engine generates multiple implementation approaches, scores each across 4 dimensions (friction, impact, pattern alignment, security), ranks them, and recommends the best path — all before writing a single line of code.

This is an enterprise feature requiring a commercial license for production use.

## Core Design Principles
1. Simulate before generating — explore the solution space first
2. Multi-dimensional scoring — no single metric dominates
3. Language-aware strategies — each language/framework gets tailored templates
4. Call-graph-powered impact — real dependency analysis, not guesswork
5. Pattern-aligned — recommendations follow established codebase conventions
6. Graceful degradation — works without call graph (estimates instead)

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                   SimulationEngine                       │
│  (simulation-engine.ts — main orchestrator)              │
├──────────┬──────────────────────────────────────────────┤
│ Approach │              Scorers (4)                      │
│Generator │  Friction │ Impact │ Alignment │ Security     │
├──────────┴──────────────────────────────────────────────┤
│              Language Strategies (5)                      │
│  TypeScript │ Python │ Java │ C# │ PHP                   │
│  (per-framework templates for 13 task categories)        │
├─────────────────────────────────────────────────────────┤
│              External Dependencies                       │
│  CallGraph │ PatternService │ LanguageIntelligence       │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `simulation-engine.ts` — `SimulationEngine` class: main orchestrator
- `approach-generator.ts` — `ApproachGenerator` class: generates candidate approaches
- `index.ts` — Public exports

## Subsystem Directory Map

| File / Directory | Purpose | Doc |
|------------------|---------|-----|
| `simulation-engine.ts` | Main orchestrator: generate → score → rank → recommend | [engine.md](./simulation/engine.md) |
| `approach-generator.ts` | Generates candidate implementation approaches | [approach-generator.md](./simulation/approach-generator.md) |
| `scorers/` | 4 scoring dimensions | [scorers.md](./simulation/scorers.md) |
| `language-strategies/` | Per-language/framework strategy templates | [language-strategies.md](./simulation/language-strategies.md) |
| `types.ts` | All type definitions | [types.md](./simulation/types.md) |

## Simulation Pipeline

```
1. Parse task description → detect category + language + framework
2. Generate candidate approaches (up to maxApproaches, default 5)
3. Score each approach across 4 dimensions
4. Rank by composite weighted score
5. Generate tradeoff comparisons between top approaches
6. Select recommended approach
7. Return SimulationResult with confidence
```

## Scoring Dimensions

| Scorer | Weight | What It Measures |
|--------|--------|------------------|
| Friction | 30% | Code churn, pattern deviation, testing effort, refactoring, learning curve |
| Pattern Alignment | 30% | Aligned patterns, conflicting patterns, outlier risk |
| Impact | 25% | Files/functions/entry points affected, sensitive data paths, risk level |
| Security | 15% | Data access implications, auth implications, security warnings |

## Task Categories (13)

`rate-limiting`, `authentication`, `authorization`, `api-endpoint`, `data-access`, `error-handling`, `caching`, `logging`, `testing`, `validation`, `middleware`, `refactoring`, `generic`

Auto-detected from task description via keyword matching with weighted scores.

## Approach Strategies (15)

`middleware`, `decorator`, `wrapper`, `per-route`, `per-function`, `centralized`, `distributed`, `aspect`, `filter`, `interceptor`, `guard`, `policy`, `dependency`, `mixin`, `custom`

## Connections to Other Subsystems
- **Call Graph** — impact analysis uses real dependency data
- **Pattern Service** — alignment scoring checks against established patterns
- **Language Intelligence** — framework detection for approach generation
- **MCP Tools** — exposed via simulation-related drift tools

## v2 Migration Notes
- This is AI-heavy orchestration — stays in TypeScript
- Scorers could call Rust for pattern/impact analysis (hot paths)
- Language strategies are static config — could be Rust structs
- The approach generator's framework detection could leverage Rust parsers
