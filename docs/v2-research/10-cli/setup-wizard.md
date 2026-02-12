# CLI Setup Wizard

## Location
`packages/cli/src/commands/setup/`

## Purpose
Guided onboarding wizard that runs all Drift features in sequence. Creates a "Source of Truth" document that records the baseline state of the project. Supports both interactive mode and quick mode (`-y`).

## Files
- `index.ts` — `setupAction()`: main wizard orchestrator with 8 phases
- `types.ts` — `SetupState`, `SetupChoices`, `SourceOfTruth`, `FeatureResult`, `FeatureConfig`
- `ui.ts` — Console output helpers (welcome banner, phase headers, feature descriptions, summary)
- `utils.ts` — Setup utilities
- `runners/` — 13 modular feature runners

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-y, --yes` | boolean | false | Quick setup with defaults (skip prompts) |
| `-v, --verbose` | boolean | false | Verbose output |
| `--resume` | boolean | false | Resume interrupted setup |

## The 8 Phases

### Phase 1: Prerequisites Check (`phaseCheckPrerequisites`)
- Checks if patterns already exist
- Counts patterns by category
- Decides whether to continue or skip to approval

### Phase 2: Init (`phaseInit`)
- Creates `.drift/` directory if needed
- Runs `drift init` logic
- Returns project root path

### Phase 3: Pattern Approval (`phaseApproval`)
- Interactive batch approval of discovered patterns
- Pre-selects high-confidence patterns (≥85%)
- Uses `promptBatchPatternApproval()` from UI prompts
- In `-y` mode, auto-approves patterns above threshold

### Phase 4: Core Features (`phaseCoreFeatures`)
- Runs core scan runners: boundaries, contracts, environment, constants
- Each runner is optional (prompted in interactive mode, all enabled in `-y` mode)

### Phase 5: Deep Analysis (`phaseDeepAnalysis`)
- Runs analysis runners: callgraph, test-topology, coupling, DNA, error-handling
- These are heavier operations, each prompted individually

### Phase 6: Derived Features (`phaseDerived`)
- Runs derived runners: constraints, audit
- These depend on data from phases 4-5

### Phase 7: Memory (`phaseMemory`)
- Optionally initializes Cortex memory system
- Prompted in interactive mode, enabled in `-y` mode

### Phase 8: Finalize (`phaseFinalize`)
- Runs SQLite sync runner (syncs all JSON data to drift.db)
- Generates `source-of-truth.json` with baseline checksums
- Prints final summary with stats and next steps

## SetupState

Tracks wizard progress for resume capability:

```typescript
interface SetupState {
  phase: number;           // Current phase (1-8)
  completed: string[];     // Completed phase names
  choices: SetupChoices;   // User's feature selections
  startedAt: string;       // ISO timestamp
}
```

## SetupChoices

```typescript
interface SetupChoices {
  runCoreScan: boolean;
  scanBoundaries: boolean;
  scanContracts: boolean;
  scanEnvironment: boolean;
  scanConstants: boolean;
  autoApprove: boolean;
  approveThreshold: number;
  buildCallGraph: boolean;
  buildTestTopology: boolean;
  buildCoupling: boolean;
  scanDna: boolean;
  analyzeErrorHandling: boolean;
  initMemory: boolean;
}
```

## SourceOfTruth

Generated at the end of setup, saved to `.drift/source-of-truth.json`:

```typescript
interface SourceOfTruth {
  version: string;
  schemaVersion: string;       // "2.0.0"
  createdAt: string;
  updatedAt: string;
  project: { id, name, rootPath };
  baseline: {
    scanId: string;
    scannedAt: string;
    fileCount: number;
    patternCount: number;
    approvedCount: number;
    categories: Record<string, number>;
    checksum: string;          // SHA-256 of baseline data
  };
  features: {
    boundaries: FeatureConfig;
    contracts: FeatureConfig;
    environment: FeatureConfig;
    constants: FeatureConfig;
    callGraph: FeatureConfig;
    testTopology: FeatureConfig;
    coupling: FeatureConfig;
    dna: FeatureConfig;
    errorHandling: FeatureConfig;
    constraints: FeatureConfig;
    audit: FeatureConfig;
    memory: FeatureConfig;
    sqliteSync: FeatureConfig;
  };
  settings: {
    autoApproveThreshold: number;
    autoApproveEnabled: boolean;
  };
  history: HistoryEntry[];
}
```

## Runners

Each runner extends `BaseRunner` and implements:

```typescript
abstract class BaseRunner {
  abstract get name(): string;        // "Call Graph"
  abstract get icon(): string;        // "📞"
  abstract get description(): string; // "Build function call graph..."
  abstract get benefit(): string;     // "Enables reachability analysis"
  abstract get manualCommand(): string; // "drift callgraph build"
  abstract run(): Promise<FeatureResult>;
}
```

### Runner Inventory

| Runner | File | What It Does |
|--------|------|-------------|
| `BoundariesRunner` | `boundaries.ts` | Scans for data access patterns, sensitive fields |
| `ContractsRunner` | `contracts.ts` | Scans for frontend↔backend API contracts |
| `EnvironmentRunner` | `environment.ts` | Scans for environment variable access |
| `ConstantsRunner` | `constants.ts` | Extracts constants, enums, magic numbers |
| `CallGraphRunner` | `callgraph.ts` | Builds function call graph (native Rust or streaming TS) |
| `TestTopologyRunner` | `test-topology.ts` | Maps test files to source files |
| `CouplingRunner` | `coupling.ts` | Analyzes module dependencies and cycles |
| `DNARunner` | `dna.ts` | Analyzes styling DNA (genes, mutations) |
| `ErrorHandlingRunner` | `error-handling.ts` | Finds error handling gaps |
| `ConstraintsRunner` | `constraints.ts` | Discovers architectural constraints |
| `AuditRunner` | `audit.ts` | Runs pattern audit |
| `MemoryRunner` | `memory.ts` | Initializes Cortex memory system |
| `SqliteSyncRunner` | `sqlite-sync.ts` | Syncs all JSON data to drift.db |

### FeatureResult

```typescript
interface FeatureResult {
  enabled: boolean;
  success: boolean;
  timestamp?: string;
  stats?: Record<string, number>;  // e.g. { functions: 1234, entryPoints: 56 }
  error?: string;
}
```

## UI Helpers (`ui.ts`)

```typescript
printWelcome()                    // ASCII art banner
printPhase(num, title, desc)      // "━━━ Phase 3: Pattern Approval ━━━"
printFeature(runner)              // Icon + name + description + benefit
printSuccess(message)             // "✓ message"
printSkip(message)                // "○ message"
printInfo(message)                // Gray info text
printSummary(sot)                 // Final summary with stats and next steps
formatFeatureResult(name, result) // "Call Graph: 1234 functions, 56 entryPoints"
```

## Directory Structure Created

The setup wizard creates 30+ subdirectories under `.drift/`:

```
.drift/
├── patterns/{discovered,approved,ignored,variants}/
├── history/snapshots/
├── cache/
├── reports/
├── lake/{callgraph,patterns,security,examples}/
├── boundaries/
├── test-topology/
├── module-coupling/
├── error-handling/
├── constraints/{discovered,approved,ignored,custom,history}/
├── contracts/{discovered,verified,mismatch,ignored}/
├── indexes/
├── views/
├── dna/
├── environment/
├── memory/
├── audit/snapshots/
├── config.json
└── source-of-truth.json
```

## Rust Rebuild Considerations
- The setup wizard stays in TypeScript — it's interactive UI orchestration
- Individual runners that call core analysis (callgraph, boundaries, contracts) will call Rust NAPI instead of TS core
- `SqliteSyncRunner` may become unnecessary if Rust writes directly to SQLite during scan
- `SourceOfTruth` generation (checksums, baseline) could be computed in Rust for speed on large codebases
- The `BaseRunner` pattern is clean and doesn't need migration
- Resume capability (`SetupState` persistence) stays in TS
