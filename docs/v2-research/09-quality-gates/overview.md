# Quality Gates System — Overview

## Location
`packages/core/src/quality-gates/` — TypeScript (~30 source files across 6 subdirectories)

## What It Is
Quality Gates is Drift's CI/CD enforcement layer. It runs 6 specialized gates against code changes, evaluates results against configurable policies, and produces reports in 6 output formats. It's the system that turns Drift's analysis into actionable pass/fail decisions for pull requests and deployments.

## Core Design Principles
1. Gates are independent, parallel-executable analysis units
2. Policies control which gates run, their thresholds, and blocking behavior
3. Policies are scope-aware — different rules for main vs feature branches
4. Aggregation modes determine how gate results combine into a final verdict
5. Fail-safe: errored gates don't block by default
6. Snapshot-based regression detection compares against previous runs

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                  GateOrchestrator                        │
│  (gate-orchestrator.ts — main execution pipeline)       │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Policy   │ Gate     │ Parallel │   Result               │
│ Loader   │ Registry │ Executor │   Aggregator           │
├──────────┴──────────┴──────────┴────────────────────────┤
│                  6 Quality Gates                         │
│  Pattern    │ Constraint │ Regression │ Impact           │
│  Compliance │ Verify     │ Detection  │ Simulation       │
│             │            │            │                  │
│  Security   │ Custom                                     │
│  Boundary   │ Rules                                      │
├─────────────────────────────────────────────────────────┤
│                  Policy Engine                           │
│  4 built-in policies │ Custom policies │ Scope matching  │
├─────────────────────────────────────────────────────────┤
│                  Reporters                               │
│  GitHub │ GitLab │ SARIF │ JSON │ Text │ (extensible)   │
├─────────────────────────────────────────────────────────┤
│                  Persistence                             │
│  SnapshotStore (branch-based) │ GateRunStore (history)  │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `orchestrator/gate-orchestrator.ts` — `GateOrchestrator`: main execution pipeline
- `orchestrator/gate-registry.ts` — `GateRegistry`: gate registration and instantiation
- `types.ts` — All quality gate types (~1300 lines)
- `index.ts` — Public exports

## Subsystem Directory Map

| Directory / File | Purpose | Doc |
|------------------|---------|-----|
| `orchestrator/` | Execution pipeline, registry, parallel executor, result aggregation | [orchestrator.md](./orchestrator.md) |
| `gates/` | 6 gate implementations + abstract base | [gates.md](./gates.md) |
| `policy/` | Policy loading, evaluation, defaults | [policy.md](./policy.md) |
| `reporters/` | 6 output format reporters | [reporters.md](./reporters.md) |
| `store/` | Snapshot persistence, run history | [store.md](./store.md) |
| `types.ts` | Complete type system (~1300 lines, 40+ interfaces) | [types.md](./types.md) |

## Execution Pipeline

```
1. Resolve files to check (changed files, glob patterns, or all)
2. Load policy (by ID, inline object, or context-based matching)
3. Determine which gates to run (policy enables/disables/skips)
4. Build gate context (load patterns, constraints, call graph, snapshots)
5. Execute gates in parallel (via ParallelExecutor)
6. Evaluate results against policy (via PolicyEvaluator)
7. Aggregate into final QualityGateResult (via ResultAggregator)
8. Save snapshot + run history
9. Generate report (via selected Reporter)
```

## The 6 Quality Gates

| Gate | ID | What It Checks | Default |
|------|----|---------------|---------|
| Pattern Compliance | `pattern-compliance` | Are approved patterns being followed? New outliers? | Blocking |
| Constraint Verification | `constraint-verification` | Do code changes satisfy architectural constraints? | Blocking |
| Regression Detection | `regression-detection` | Has pattern confidence/compliance dropped vs baseline? | Warning |
| Impact Simulation | `impact-simulation` | How many files/functions/entry points are affected? | Warning |
| Security Boundary | `security-boundary` | Is sensitive data accessed without auth? New access paths? | Blocking |
| Custom Rules | `custom-rules` | User-defined rules (file patterns, content, naming, structure) | Disabled |

## Built-in Policies

| Policy | Scope | Description |
|--------|-------|-------------|
| `default` | All branches | Balanced — compliance + constraints block, rest warns |
| `strict` | main, master, release/* | Everything blocks, tighter thresholds |
| `relaxed` | feature/*, fix/*, chore/* | Looser thresholds, regression skipped |
| `ci-fast` | Any | Only pattern compliance, everything else skipped |

## Aggregation Modes

| Mode | Logic |
|------|-------|
| `any` | Any blocking gate failure = overall failure |
| `all` | All gates must fail for overall failure |
| `weighted` | Weighted average of gate scores vs minimum threshold |
| `threshold` | Overall score must meet minimum threshold |

Required gates (specified in policy) always block regardless of aggregation mode.

## Scoring System
Each gate produces a score (0-100) calculated from violations:
- Error violations: 10 penalty points
- Warning violations: 3 penalty points
- Info violations: 1 penalty point
- Score = max(0, 100 - (penalty / maxPenalty) × 100)

## License Gating
Some gates are enterprise-only:
- `gate:policy-engine` (Team tier) — Multiple custom policies, branch/path scoping
- `gate:regression-detection` (Team tier) — Regression detection across time
- `gate:custom-rules` (Team tier) — Custom rules engine
- `gate:impact-simulation` (Enterprise tier) — Impact simulation
- `gate:security-boundary` (Enterprise tier) — Security boundary enforcement

## MCP Integration
Exposed via `drift_quality_gate` MCP tool for AI-assisted quality checks.

## CLI Integration
`drift gate run` command with options for policy, format, output, CI mode, branch, commit SHA.

## V2 Notes
- The orchestrator is pure orchestration — stays TS
- Individual gates that do heavy analysis (pattern compliance, security boundary) should call Rust
- Policy engine is configuration logic — stays TS
- Reporters are output formatting — stays TS
- Snapshot/run stores are file I/O — stays TS
- The parallel executor currently runs all gates in one group — future: dependency graph
