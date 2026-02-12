# CLI Types

## Location
`packages/cli/src/types/`

## Purpose
Shared type definitions for CLI commands. Currently minimal — most types are defined inline in command files or imported from `driftdetect-core`.

## Files
- `index.ts` — `CLIOptions`, `CheckResult`

## Types

### CLIOptions
Common options shared across commands:

```typescript
interface CLIOptions {
  verbose?: boolean;
  format?: 'text' | 'json' | 'github' | 'gitlab';
  ci?: boolean;
  staged?: boolean;
}
```

### CheckResult
Return type for the check command:

```typescript
interface CheckResult {
  violationCount: number;
  errorCount: number;
  warningCount: number;
  exitCode: number;  // 0 = pass, 1 = violations above threshold
}
```

## Type Distribution
Most CLI types live closer to their usage rather than in this central module:

| Type | Location | Used By |
|------|----------|---------|
| `CLIOptions` | `types/index.ts` | Multiple commands |
| `CheckResult` | `types/index.ts` | `check.ts` |
| `SetupState`, `SetupChoices`, `SourceOfTruth` | `commands/setup/types.ts` | Setup wizard |
| `Reporter`, `ReportData`, `ViolationSummary` | `reporters/types.ts` | All reporters |
| `ScannerServiceConfig`, `ScanResults` | `services/scanner-service.ts` | Scan command |
| `DetectorWorkerTask`, `DetectorWorkerResult` | `workers/detector-worker.ts` | Worker threads |
| `HookType`, `HookInstallResult` | `git/hooks.ts` | Git integration |
| `PatternChoice` | `ui/prompts.ts` | Approval prompts |

## Rust Rebuild Considerations
- CLI types are presentation-layer — they stay in TypeScript
- Core domain types (`Pattern`, `Violation`, `Severity`) come from `driftdetect-core` and will migrate to Rust
- The CLI will consume Rust types via NAPI bindings, converting to these presentation types for display
- `CheckResult.exitCode` logic is pure — could be computed in Rust for consistency with native gate checks
