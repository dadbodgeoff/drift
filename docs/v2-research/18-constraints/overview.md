# Constraints System — Overview

## Location
`packages/core/src/constraints/` — TypeScript (~8 source files)

## What It Is
The Constraints system discovers and enforces architectural invariants learned from the codebase. Unlike patterns (which describe what IS), constraints enforce what MUST BE. They're derived from patterns, call graphs, boundaries, test topology, and error handling — then verified against code changes.

## Core Design Principles
1. Constraints are learned, not hardcoded — mined from your actual codebase
2. Invariants are detected from multiple Drift data sources (patterns, call graph, boundaries, tests, errors)
3. Constraints have lifecycle: discovered → approved → enforced (or ignored)
4. Verification runs against file changes and produces violation reports
5. Confidence-based auto-approval reduces manual review burden

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                  Constraint Pipeline                     │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Invariant│ Constraint│Constraint│   Constraint           │
│ Detector │ Synth.   │ Store    │   Verifier             │
├──────────┴──────────┴──────────┴────────────────────────┤
│                  Data Sources                            │
│  Patterns │ Call Graph │ Boundaries │ Tests │ Errors     │
├─────────────────────────────────────────────────────────┤
│                  Quality Gates Integration               │
│  constraint-verification gate uses verifier              │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `types.ts` — All constraint type definitions
- `extraction/invariant-detector.ts` — `InvariantDetector`: mines invariants from Drift data
- `extraction/constraint-synthesizer.ts` — `ConstraintSynthesizer`: converts invariants to constraints
- `store/constraint-store.ts` — `ConstraintStore`: persistence and querying
- `verification/constraint-verifier.ts` — `ConstraintVerifier`: validates code against constraints
- `index.ts` — Public exports

## Subsystem Directory Map

| Directory / File | Purpose | Doc |
|------------------|---------|-----|
| `types.ts` | Core types: Constraint, categories, predicates, scopes | [types.md](./types.md) |
| `extraction/invariant-detector.ts` | Mines invariants from patterns, call graph, boundaries, tests, errors | [detection.md](./detection.md) |
| `extraction/constraint-synthesizer.ts` | Converts invariants to constraints, deduplication, merging | [detection.md](./detection.md) |
| `store/constraint-store.ts` | File-based persistence, querying, lifecycle management | [store.md](./store.md) |
| `verification/constraint-verifier.ts` | Verifies code against constraints, produces violations | [verification.md](./verification.md) |

## Constraint Categories

| Category | What It Enforces |
|----------|-----------------|
| `api` | API endpoint conventions (auth, validation, response format) |
| `auth` | Authentication/authorization patterns |
| `data` | Data access layer invariants |
| `error` | Error handling requirements |
| `test` | Test coverage requirements |
| `security` | Security patterns (input validation, sanitization) |
| `structural` | Module/file structure rules |
| `performance` | Performance patterns |
| `logging` | Logging requirements |
| `validation` | Input validation patterns |

## Constraint Lifecycle

```
Detect → Synthesize → Store → [Review] → Enforce → Verify
```

1. **Detect**: InvariantDetector analyzes patterns, call graph, boundaries, test topology, error handling
2. **Synthesize**: ConstraintSynthesizer converts invariants to Constraint objects with IDs, confidence, evidence
3. **Store**: Persisted to `.drift/constraints/` as JSON files, indexed by category
4. **Review**: Constraints start as `discovered`, can be `approved` or `ignored`
5. **Enforce**: Approved constraints (or auto-approved above confidence threshold) are actively enforced
6. **Verify**: ConstraintVerifier checks code changes against applicable constraints

## Invariant Types

| Type | Example |
|------|---------|
| `must_have` | "API endpoints must have authentication" |
| `must_not_have` | "Controllers must not have direct DB access" |
| `must_precede` | "Validation must precede data write" |
| `must_follow` | "Logging must follow error catch" |
| `must_colocate` | "Tests must be colocated with source" |
| `must_separate` | "Business logic must be separate from presentation" |
| `must_wrap` | "DB calls must be wrapped in try/catch" |
| `must_propagate` | "Errors must propagate to boundary" |
| `cardinality` | "Each controller must have exactly one service" |
| `data_flow` | "PII must not flow to logging" |
| `naming` | "Services must end with 'Service'" |
| `structure` | "Each module must have an index.ts" |

## Integration Points
- **Quality Gates**: `constraint-verification` gate uses the verifier
- **MCP Tools**: `drift_validate_change` and `drift_prevalidate` use constraint verification
- **CLI**: `drift constraints list/approve/ignore` commands

## V2 Notes
- Invariant detection should move to Rust for performance on large codebases
- Constraint verification (predicate evaluation) is ideal for Rust
- Store can stay TS (file I/O, not performance-critical)
- The synthesis/merging logic is complex but not hot-path — can stay TS
