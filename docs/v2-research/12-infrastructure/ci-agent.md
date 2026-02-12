# CI Agent Package

## Location
`packages/ci/` — TypeScript, published as `driftdetect-ci`

## What It Is
An autonomous CI agent that analyzes pull requests for pattern violations, constraint breaches, security issues, and architectural drift. Integrates with GitHub and GitLab. Produces comments, check runs, SARIF output, and JSON reports.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              drift-ci CLI (bin/)                  │
├─────────────────────────────────────────────────┤
│              PRAnalyzer (agent/)                  │
│  Orchestrates 9 analysis passes per PR           │
├──────────┬──────────┬───────────────────────────┤
│ Providers│ Adapters │ Reporters                   │
│ GitHub   │ Drift    │ GitHub Comment              │
│ GitLab   │ Heuristic│ SARIF                       │
├──────────┴──────────┴───────────────────────────┤
│         Drift Core + Cortex + Detectors          │
└─────────────────────────────────────────────────┘
```

## File Map

| File | Purpose |
|------|---------|
| `src/bin/drift-ci.ts` | CLI entry point (commander) |
| `src/agent/pr-analyzer.ts` | Core analysis orchestrator (~1150 lines) |
| `src/integration/drift-adapter.ts` | Bridges Drift core to CI interfaces |
| `src/providers/github.ts` | GitHub API (Octokit) — PR fetch, comments, check runs |
| `src/providers/gitlab.ts` | GitLab API — MR fetch, comments |
| `src/reporters/github-comment.ts` | Formats analysis as GitHub PR comment |
| `src/reporters/sarif.ts` | SARIF 2.1.0 output for IDE integration |
| `src/types.ts` | 65+ interfaces for all analysis types |
| `src/index.ts` | Public exports |

## PRAnalyzer — Core Engine

### Dependencies Interface
The analyzer depends on 12 pluggable interfaces:

| Interface | Purpose |
|-----------|---------|
| `IPatternMatcher` | Match patterns against changed files |
| `IConstraintVerifier` | Verify architectural constraints |
| `IImpactAnalyzer` | Calculate change blast radius |
| `IBoundaryScanner` | Detect data boundary violations |
| `ITestTopology` | Analyze test coverage gaps |
| `IModuleCoupling` | Detect coupling issues and cycles |
| `IErrorHandling` | Find error handling gaps |
| `IContractChecker` | Check BE/FE API mismatches |
| `IConstantsAnalyzer` | Find magic values and secrets |
| `IQualityGates` | Run quality gate policies |
| `ITrendAnalyzer` | Analyze pattern trends over time |
| `ICortex` | Memory context for files + learning |

### Analysis Pipeline
```
1. Get PR context (files, branches, author)
2. Get memory context from Cortex (if enabled)
3. Run 9 analysis passes in parallel:
   ├── Pattern matching
   ├── Constraint verification
   ├── Impact analysis
   ├── Security boundary scan
   ├── Test coverage analysis
   ├── Module coupling analysis
   ├── Error handling analysis
   ├── Contract checking
   └── Constants analysis
4. Run quality gates (if enabled)
5. Calculate overall score (0-100)
6. Determine status (pass/warn/fail)
7. Generate suggestions
8. Extract learnings for Cortex
9. Return AnalysisResult
```

### Scoring Algorithm
```typescript
overallScore = weighted average of:
  - patternScore (30%)     // Based on drift score
  - constraintScore (25%)  // Based on violation count
  - securityScore (20%)    // Based on boundary violations
  - testScore (15%)        // Based on coverage
  - couplingScore (10%)    // Based on cycle count
```

### Heuristic Fallbacks
When Drift core isn't initialized, the adapter falls back to heuristic analysis:
- `heuristicPatternMatch` — Regex-based pattern detection
- `heuristicConstraintVerify` — File-based constraint checking
- `heuristicImpactAnalysis` — Import graph traversal
- `heuristicBoundaryScan` — Keyword-based boundary detection
- `heuristicTestCoverage` — Test file co-location checking
- `heuristicCouplingAnalysis` — Import counting
- `heuristicErrorHandling` — Try/catch pattern detection
- `heuristicConstantsAnalysis` — Magic number regex

## AnalysisResult Type
```typescript
interface AnalysisResult {
  status: 'pass' | 'warn' | 'fail';
  summary: string;
  score: number;                    // 0-100
  patterns: PatternAnalysis;
  constraints: ConstraintAnalysis;
  impact: ImpactAnalysis;
  security: SecurityAnalysis;
  tests: TestAnalysis;
  coupling: CouplingAnalysis;
  errors: ErrorAnalysis;
  contracts: ContractAnalysis;
  constants: ConstantsAnalysis;
  qualityGates: QualityGateResult;
  suggestions: Suggestion[];
  learnings: Learning[];
  metadata: AnalysisMetadata;
}
```

## GitHub Provider
Full GitHub API integration via Octokit:
- `getPRContext()` — Fetch PR metadata + changed files
- `postComment()` / `updateComment()` — PR comments
- `createCheckRun()` — Check runs with annotations
- `postReviewComments()` — Inline review comments
- `getPRDiff()` — Raw diff content
- `setCommitStatus()` — Commit status (pending/success/failure)

## SARIF Reporter
Generates SARIF 2.1.0 output with:
- Pattern violations as results
- Constraint violations as results
- Security issues (boundaries, exposures, secrets, env vars)
- Error handling gaps
- Test coverage gaps
- Coupling issues
- Suggestions as informational results
- Severity mapping: critical/high → error, medium → warning, low → note

## Dependencies
- `@octokit/rest` ^20.0.0 — GitHub API
- `@octokit/webhooks` ^12.0.0 — Webhook types
- `commander` ^11.0.0 — CLI framework
- `simple-git` ^3.30.0 — Git operations
- `driftdetect-core`, `driftdetect-cortex`, `driftdetect-detectors`

## v2 Considerations
- CI package stays TypeScript — it's an orchestration layer
- Analysis calls should route through NAPI to Rust core
- Heuristic fallbacks become less important as Rust core matures
- Consider adding `cargo test` integration for Rust projects
- SARIF output is language-agnostic — no changes needed
