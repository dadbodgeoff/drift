# Call Graph — Enrichment Pipeline

## Location
`packages/core/src/call-graph/enrichment/`

## Purpose
The enrichment pipeline adds security, impact, and remediation metadata to the raw call graph. It transforms a structural graph into an actionable security analysis tool. This is a TS-only layer that runs after graph construction.

## Components

### Enrichment Engine (`enrichment-engine.ts`)
Orchestrates the enrichment pipeline:
```
1. Classify sensitivity of all data access points
2. Score impact of each function (centrality, data sensitivity)
3. Generate remediation suggestions for identified issues
```

### Sensitivity Classifier (`sensitivity-classifier.ts`)
Classifies data access points by sensitivity level:

| Level | Examples |
|-------|---------|
| Critical | Credentials (password_hash, api_key), financial data (credit_card, bank_account) |
| High | PII (SSN, date_of_birth, full_name) |
| Medium | Contact info (email, phone, address) |
| Low | General data (non-sensitive fields) |

Uses pattern matching on field names and table names, with context-aware scoring. This is the TS counterpart to the Rust `SensitiveFieldDetector` in `crates/drift-core/src/boundaries/sensitive.rs`.

### Impact Scorer (`impact-scorer.ts`)
Scores the impact of each function based on:
- Number of callers (centrality in the graph)
- Whether it's an entry point (API surface)
- Whether it accesses sensitive data
- Depth in call chain from entry points
- Number of data access points reachable

Produces a numeric impact score used for prioritization in quality gates and MCP tools.

### Remediation Generator (`remediation-generator.ts`)
Generates actionable remediation suggestions:
- Missing authentication on data access paths
- Missing input validation before data writes
- Missing error handling around data operations
- Missing logging for sensitive data access
- Missing rate limiting on entry points

### Types (`types.ts`)
Enrichment-specific types for classified access points, impact scores, and remediation items.

## V2 Notes
- Sensitivity classification is pattern matching — move to Rust (partially already there)
- Impact scoring is graph computation — move to Rust
- Remediation generation involves heuristics and could be AI-assisted — stays TS
- The enrichment pipeline should run as a post-processing step after Rust builds the graph
