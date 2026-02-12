# CLI UI Components

## Location
`packages/cli/src/ui/`

## Purpose
Shared UI primitives used across all commands for consistent terminal output. Wraps `ora` (spinners), `cli-table3` (tables), and `@inquirer/prompts` (interactive prompts).

## Files
- `spinner.ts` — `Spinner` class + `createSpinner()` factory + `status` helpers + `withSpinner()` utility
- `table.ts` — Table factories for patterns, violations, status, categories + color formatters
- `prompts.ts` — Interactive prompts (confirm, select, input, checkbox, batch approval)
- `progress.ts` — Progress bar for long-running operations
- `project-indicator.ts` — Active project display for multi-project workflows
- `index.ts` — Barrel exports

## Spinner (`spinner.ts`)

### Spinner Class

Wraps `ora` with a fluent API:

```typescript
class Spinner {
  start(text?: string): this
  succeed(text?: string): this
  fail(text?: string): this
  warn(text?: string): this
  info(text?: string): this
  stop(): this
  text(text: string): this
  color(color: SpinnerColor): this
  get isSpinning(): boolean
}
```

Auto-disables in CI environments (`process.env.CI`).

### Factory

```typescript
createSpinner('Loading patterns...')
createSpinner({ text: 'Scanning...', color: 'cyan' })
```

### withSpinner Utility

Wraps an async operation with automatic succeed/fail:

```typescript
const result = await withSpinner(
  'Analyzing patterns...',
  () => analyzePatterns(),
  {
    successText: (r) => `Found ${r.count} patterns`,
    failText: (e) => `Analysis failed: ${e.message}`,
  }
);
```

### Pre-configured Spinners

```typescript
spinners.scanning('Scanning codebase...')   // cyan
spinners.analyzing('Analyzing patterns...') // blue
spinners.loading('Loading...')              // yellow
spinners.saving('Saving...')                // green
spinners.checking('Checking violations...') // magenta
```

### Status Indicators

One-shot status messages (no animation):

```typescript
status.success('Patterns saved')    // ✔ Patterns saved (green)
status.error('Not initialized')     // ✖ Not initialized (red)
status.warning('No patterns found') // ⚠ No patterns found (yellow)
status.info('Using SQLite backend') // ℹ Using SQLite backend (blue)
status.pending('Waiting...')        // ○ Waiting... (gray)
```

## Table (`table.ts`)

### Style Presets

| Style | Padding | Borders | Use Case |
|-------|---------|---------|----------|
| `default` | 1 | gray | Standard tables |
| `compact` | 0 | gray | Dense data |
| `borderless` | 1 | none | Inline summaries |
| `minimal` | 1 | gray, white headers | Status tables |

### Pre-built Table Factories

```typescript
// Pattern listing
createPatternsTable(rows: PatternRow[]): string
// Columns: ID, Name, Category, Confidence, Locations, Outliers

// Violation listing
createViolationsTable(rows: ViolationRow[]): string
// Columns: Severity, File, Line, Message, Pattern

// Status summary
createStatusTable(summary: StatusSummary): string
// Rows: Total Patterns, Approved, Discovered, Ignored, Violations, Errors, Warnings

// Category breakdown
createCategoryTable(categories: CategoryBreakdown[]): string
// Columns: Category, Patterns, Violations, Coverage

// Generic key-value
createSummaryTable(rows: SummaryRow[]): string
// Columns: Label, Value (borderless style)
```

### Color Formatters

```typescript
formatSeverity(severity)     // error=red, warning=yellow, info=blue, hint=gray
formatConfidence(confidence)  // ≥85%=green, ≥65%=yellow, ≥45%=red, <45%=gray
formatCount(count, threshold) // >threshold=red, else=green
formatPath(path, maxLength)   // Truncates with "..." in middle if too long
```

## Prompts (`prompts.ts`)

Wraps `@inquirer/prompts` with typed helpers.

### Basic Prompts

```typescript
confirmPrompt(message, defaultValue?)     // Yes/No → boolean
inputPrompt(message, defaultValue?)       // Free text → string
selectPrompt(message, choices)            // Single select → T
multiSelectPrompt(message, choices)       // Multi select → T[]
```

### Domain-Specific Prompts

```typescript
// Pattern approval action
promptPatternAction(pattern: PatternChoice): Promise<'approve' | 'ignore' | 'variant' | 'skip'>

// Batch pattern approval (checkbox with pre-selected high-confidence)
promptBatchPatternApproval(patterns: PatternChoice[]): Promise<string[]>

// Severity selection
promptSeverity(message?): Promise<Severity>

// Variant configuration
promptVariantReason(): Promise<string>
promptVariantScope(): Promise<'global' | 'directory' | 'file'>

// Init wizard
promptInitOptions(): Promise<{ scanNow: boolean; autoApprove: boolean }>

// Ignore reason
promptIgnoreReason(): Promise<string>

// Report format
promptReportFormat(): Promise<'text' | 'json' | 'github' | 'gitlab'>

// Category selection (checkbox)
promptCategorySelection(categories: string[]): Promise<string[]>
```

### PatternChoice Type

```typescript
interface PatternChoice {
  id: string;
  name: string;
  category: string;
  confidence: number;
}
```

Batch approval pre-selects patterns with confidence ≥ 0.85.

## Git Integration (`git/staged-files.ts`)

```typescript
getStagedFiles(rootDir): Promise<string[]>
// git diff --cached --name-only --diff-filter=ACMR

getChangedFiles(rootDir): Promise<string[]>
// git diff --name-only --diff-filter=ACMR HEAD

getUntrackedFiles(rootDir): Promise<string[]>
// git ls-files --others --exclude-standard

isGitRepository(dirPath): Promise<boolean>
// git rev-parse --git-dir

getGitRoot(dirPath): Promise<string>
// git rev-parse --show-toplevel
```

All use `child_process.exec` with `promisify`. Error handling distinguishes between "git not installed" (`ENOENT`) and other failures.

## Testing
- `ui/ui.test.ts` — Tests for UI components (spinner, table, prompts)
- `git/git.test.ts` — Tests for git integration functions

## Rust Rebuild Considerations
- UI components stay in TypeScript — they are terminal presentation concerns
- `chalk`, `ora`, `cli-table3`, `@inquirer/prompts` are Node.js ecosystem libraries with no Rust equivalents needed
- Git integration shells out to `git` CLI — stays in TS, no performance concern
- The `withSpinner` pattern (wrapping async ops) is idiomatic TS and stays as-is
- Color formatters and table factories are pure functions — no migration value
