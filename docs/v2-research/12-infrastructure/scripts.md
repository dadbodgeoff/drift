# Scripts & Automation

## Location
`scripts/`

## File Map

| Script | Purpose |
|--------|---------|
| `publish.sh` | Dependency-ordered npm publishing |
| `validate-docs.sh` | Validates CLI commands in documentation |
| `validate-docs.ts` | TypeScript version of doc validation |
| `generate-large-codebase.ts` | Generates synthetic test codebases |
| `transform-detector.ts` | Detector transformation utilities |

## publish.sh
Publishes all packages in dependency order:
1. Build all packages (`pnpm run build`)
2. Publish `driftdetect-core`
3. Publish `driftdetect-detectors`
4. Publish `driftdetect-galaxy`
5. Publish `driftdetect-dashboard`
6. Publish `driftdetect` (CLI)
7. Publish `driftdetect-mcp`

Uses `--access public --no-git-checks` for all publishes.

## validate-docs.sh
CI-ready documentation validator that catches "documentation drift":
1. Extracts valid commands from `driftdetect --help`
2. Extracts subcommands for known parent commands
3. Scans wiki + README markdown files
4. Finds `drift <cmd>` references in backticks and `$` prompts
5. Validates each against the known command list
6. Reports invalid commands with file:line references

### Known Parent Commands
```
callgraph boundaries test-topology coupling error-handling
constraints skills projects dna env constants gate context
telemetry ts py java php go rust cpp wpf
```

### Exit Codes
- 0: All commands valid
- 1: Invalid commands found

## v2 Considerations
- `publish.sh` needs updating for Rust crate publishing (`cargo publish`)
- `validate-docs.sh` needs updating for v2 CLI command changes
- Consider adding `scripts/build-native.sh` for local Rust builds
- Consider adding `scripts/benchmark.sh` for running CIBench
