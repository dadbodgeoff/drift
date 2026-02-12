# Quality Gates — Reporters

## Location
`packages/core/src/quality-gates/reporters/`

## Purpose
Transform `QualityGateResult` into various output formats for CI systems, IDEs, and human consumption.

## Reporter Interface
```typescript
interface Reporter {
  readonly id: string;
  readonly format: OutputFormat;
  generate(result: QualityGateResult, options?: ReporterOptions): string;
  write(report: string, options?: ReporterOptions): Promise<void>;
}
```

`BaseReporter` provides default `write()` that outputs to file (if `outputPath` specified) or stdout.

## Available Reporters

| Reporter | Format | Use Case |
|----------|--------|----------|
| `text-reporter.ts` | `text` | Human-readable terminal output |
| `json-reporter.ts` | `json` | Machine-readable, API consumption |
| `sarif-reporter.ts` | `sarif` | Static Analysis Results Interchange Format (GitHub Code Scanning) |
| `github-reporter.ts` | `github` | GitHub PR comments with markdown |
| `gitlab-reporter.ts` | `gitlab` | GitLab MR comments with markdown |

## Reporter Options
```typescript
interface ReporterOptions {
  outputPath?: string;           // Write to file
  verbose?: boolean;             // Include detailed violation info
  includeDetails?: boolean;      // Include gate-specific details
  maxViolations?: number;        // Cap violations in output
}
```

## Output Formats

### Text
Terminal-friendly output with:
- Overall pass/fail status with score
- Per-gate summary (status, score, violation count)
- Top violations with file, line, message
- Execution time

### JSON
Full `QualityGateResult` serialized as JSON. Used for:
- CI pipeline integration
- Dashboard consumption
- Programmatic analysis

### SARIF
[Static Analysis Results Interchange Format](https://sarifweb.azurewebsites.net/) for:
- GitHub Code Scanning integration
- IDE integration (VS Code SARIF Viewer)
- Compliance reporting

Maps gate violations to SARIF `results` with:
- `ruleId` from gate + rule
- `level` from severity (error → error, warning → warning, info → note)
- `locations` with file path and line number
- `message` with violation description

### GitHub
Markdown-formatted PR comment with:
- Status badge (✅ / ❌)
- Score and summary
- Per-gate results table
- Expandable violation details
- Execution metadata

### GitLab
Similar to GitHub but formatted for GitLab MR comments.

## V2 Notes
- Reporters are pure formatting — stay TS
- SARIF support is valuable for enterprise compliance
- Consider adding: JUnit XML reporter for CI systems that expect it
- Consider adding: HTML reporter for standalone reports
