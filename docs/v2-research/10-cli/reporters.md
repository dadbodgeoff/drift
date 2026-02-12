# CLI Reporters

## Location
`packages/cli/src/reporters/`

## Purpose
Pluggable output formatters for violation reports. Used by `drift check`, `drift report`, and `drift gate`. Each reporter implements the `Reporter` interface and transforms `ReportData` into a formatted string.

## Files
- `types.ts` — `Reporter` interface, `ReportData`, `ViolationSummary`
- `text-reporter.ts` — `TextReporter`: human-readable colored terminal output
- `json-reporter.ts` — `JsonReporter`: machine-readable JSON
- `github-reporter.ts` — `GitHubReporter`: GitHub Actions annotations
- `gitlab-reporter.ts` — `GitLabReporter`: GitLab CI code quality format
- `index.ts` — Barrel exports

## Reporter Interface

```typescript
interface Reporter {
  generate(data: ReportData): string;
}

interface ReportData {
  violations: Violation[];
  summary: ViolationSummary;
  patterns: Pattern[];
  timestamp: string;
  rootDir: string;
}

interface ViolationSummary {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
}
```

## TextReporter

Human-readable output with chalk colors. Groups violations by file, sorts by line number.

**Output format**:
```
src/api/users.ts
  ✖ 42:5  error  Missing error handling in async route  (api-error-handling)
    Expected try-catch wrapper for Express route handlers
  ⚠ 67:3  warning  Raw SQL query detected  (sql-injection-risk)

src/auth/login.ts
  ✖ 15:1  error  Hardcoded secret detected  (hardcoded-secret)

──────────────────────────────────────────────────────
2 errors, 1 warning (3 total)
```

**Severity icons**: `✖` (error/red), `⚠` (warning/yellow), `ℹ` (info/blue), `○` (hint/gray)

## JsonReporter

Structured JSON output for CI/CD pipelines:

```json
{
  "violations": [...],
  "summary": { "total": 3, "errors": 2, "warnings": 1, "infos": 0, "hints": 0 },
  "timestamp": "2026-02-06T...",
  "patterns": [...]
}
```

## GitHubReporter

GitHub Actions workflow command annotations:

```
::error file=src/api/users.ts,line=42,col=5::Missing error handling in async route (api-error-handling)
::warning file=src/auth/login.ts,line=15,col=1::Hardcoded secret detected (hardcoded-secret)
```

These appear as inline annotations on pull request diffs.

## GitLabReporter

GitLab CI Code Quality report format (JSON):

```json
[
  {
    "description": "Missing error handling in async route",
    "fingerprint": "abc123...",
    "severity": "major",
    "location": {
      "path": "src/api/users.ts",
      "lines": { "begin": 42 }
    }
  }
]
```

## SarifReporter (in gate.ts)

SARIF (Static Analysis Results Interchange Format) for security tool integration. Used by `drift gate --format sarif`. Imported from `driftdetect-core` rather than the reporters directory.

## Selection Logic

Commands select reporters based on `--format` flag:

```typescript
function getReporter(format: string): Reporter {
  switch (format) {
    case 'json':   return new JsonReporter();
    case 'github': return new GitHubReporter();
    case 'gitlab': return new GitLabReporter();
    case 'text':
    default:       return new TextReporter();
  }
}
```

The `--ci` flag auto-selects JSON format. `drift gate` additionally supports SARIF.

## Rust Rebuild Considerations
- Reporters stay in TypeScript — they are pure presentation-layer formatting
- The `ReportData` input type will come from Rust NAPI (violations, patterns) but formatting stays in TS
- GitHub/GitLab annotation formats are CI-specific — no benefit from Rust
- SARIF generation could optionally move to Rust if used in high-throughput pipelines
- The `Reporter` interface is clean and doesn't need migration
