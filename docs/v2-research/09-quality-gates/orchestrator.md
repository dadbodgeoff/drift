# Quality Gates — Orchestrator

## Location
`packages/core/src/quality-gates/orchestrator/`

## Components

### GateOrchestrator (`gate-orchestrator.ts`)
Main entry point. Coordinates the entire quality gate pipeline.

**Constructor:** Takes `projectRoot` string.

**Key Method: `run(options)`**
```typescript
interface QualityGateOptions {
  files?: string[];              // Specific files to check
  patterns?: string[];           // Glob patterns for files
  policy?: string | QualityPolicy; // Policy ID, inline object, or undefined for default
  format?: OutputFormat;         // json, text, sarif, github, gitlab
  outputPath?: string;           // Write report to file
  ci?: boolean;                  // CI mode (affects exit codes)
  branch?: string;               // Current branch
  commitSha?: string;            // Current commit
  baselineBranch?: string;       // Branch to compare against
  baselineCommit?: string;       // Commit to compare against
  verbose?: boolean;
}
```

**Pipeline Steps:**
1. `resolveFiles()` — Resolve file list from options (explicit files, glob patterns, or all)
2. `loadPolicy()` — Load policy via PolicyLoader
3. `determineGates()` — Filter gates based on policy (enabled, not skipped)
4. `buildContext()` — Load patterns, constraints, call graph, previous snapshot, custom rules
5. `executeGates()` — Run gates via ParallelExecutor
6. Evaluate via PolicyEvaluator
7. Aggregate via ResultAggregator
8. Save snapshot + run history

**Context Building:**
The orchestrator lazily loads only what gates need:
- Patterns: loaded if pattern-compliance or regression-detection is enabled
- Constraints: loaded if constraint-verification is enabled
- Call graph: loaded if impact-simulation or security-boundary is enabled
- Previous snapshot: loaded if regression-detection is enabled
- Custom rules: loaded if custom-rules is enabled

### GateRegistry (`gate-registry.ts`)
Manages gate registration and lazy instantiation.

**Built-in Gates (registered lazily via dynamic import):**
1. `pattern-compliance` → `PatternComplianceGate`
2. `constraint-verification` → `ConstraintVerificationGate`
3. `regression-detection` → `RegressionDetectionGate`
4. `impact-simulation` → `ImpactSimulationGate`
5. `security-boundary` → `SecurityBoundaryGate`
6. `custom-rules` → `CustomRulesGate`

**Singleton pattern:** `getGateRegistry()` returns global instance.

**Custom gate registration:**
```typescript
registry.register('my-gate', (context) => new MyGate(context));
```

### ParallelExecutor (`parallel-executor.ts`)
Executes gates concurrently where possible.

**Current behavior:** All gates run in a single parallel group (no dependencies).

**Future:** Dependency graph support planned:
- regression-detection might depend on pattern-compliance results
- security-boundary might depend on impact-simulation results

**Error handling:** If a gate fails to load or execute, returns an error result with `passed: true` (fail-safe — errors don't block).

### ResultAggregator (`result-aggregator.ts`)
Combines individual gate results into the final `QualityGateResult`.

**Aggregation:**
1. Collect all violations from all gates, sort by severity (errors first)
2. Collect all warnings
3. Determine gates run vs skipped
4. Set exit code: 0 (passed) or 1 (failed)

**Output:**
```typescript
interface QualityGateResult {
  passed: boolean;
  status: GateStatus;
  score: number;
  summary: string;
  gates: Record<GateId, GateResult>;
  violations: GateViolation[];
  warnings: string[];
  policy: { id: string; name: string };
  metadata: {
    executionTimeMs: number;
    filesChecked: number;
    gatesRun: GateId[];
    gatesSkipped: GateId[];
    timestamp: string;
    branch: string;
    commitSha?: string;
    ci: boolean;
  };
  exitCode: number;
}
```

## V2 Notes
- Orchestrator is pure coordination — stays TS
- ParallelExecutor should add dependency graph for gate ordering
- Context building could be optimized with Rust-backed data loading
- The lazy loading pattern for gates is good — prevents unused imports
