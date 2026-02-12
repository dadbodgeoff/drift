# CLI Testing

## Location
Test files are co-located with source files throughout `packages/cli/src/`.

## Test Files
- `commands/check.test.ts` — Property-based tests for exit code consistency
- `commands/cli.test.ts` — CLI integration tests
- `git/git.test.ts` — Git integration tests
- `ui/ui.test.ts` — UI component tests

## Test Framework
- `vitest` — Test runner
- `fast-check` — Property-based testing (used in check.test.ts)

## Property-Based Tests (`check.test.ts`)

The most sophisticated test file. Uses `fast-check` to verify CLI exit code properties:

### Properties Verified
1. `failOn: 'none'` → always exit 0 (regardless of violations)
2. No violations → always exit 0 (regardless of threshold)
3. Error violations + `failOn: 'error'` → exit 1
4. Warning/error violations + `failOn: 'warning'` → exit 1
5. Only lower severity + `failOn: 'error'` → exit 0
6. Only info/hint + `failOn: 'warning'` → exit 0
7. Determinism — same input always produces same output
8. Binary — exit code is always 0 or 1
9. Severity ordering — higher severity always triggers if lower does
10. Monotonicity — adding violations never decreases exit code

### Severity Order
```typescript
const SEVERITY_ORDER: Record<Severity, number> = {
  error: 4,
  warning: 3,
  info: 2,
  hint: 1,
};
```

### Core Function Under Test
```typescript
function getExitCode(violations: Violation[], failOn: 'error' | 'warning' | 'none'): number
```

Exit code = 1 if any violation severity ≥ threshold severity. This is the contract that CI pipelines depend on.

## Test Coverage Gaps
- No tests for `ScannerService` (complex orchestration, hard to unit test)
- No tests for reporters (output formatting)
- No tests for setup wizard (interactive prompts)
- No tests for worker thread mode
- Git tests exist but scope is unknown without reading the file

## Requirements Traceability
- `check.test.ts` validates Requirements 29.9, 30.4 (CLI exit code consistency)
- `git.test.ts` validates Requirement 37.2 (staged file detection)

## Rust Rebuild Considerations
- Property-based tests for exit code logic should be replicated in Rust (`proptest` crate)
- The severity ordering and threshold comparison are core invariants — test in both languages
- Integration tests (CLI end-to-end) stay in TypeScript since the CLI presentation layer stays in TS
- Consider: Rust-side property tests for `ScannerService` equivalent once scanning moves to Rust
