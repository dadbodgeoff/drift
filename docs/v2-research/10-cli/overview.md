# CLI Package — Overview

## Location
`packages/cli/` — 100% TypeScript (~50 command files, ~5 services, ~10 UI/reporter modules)

## What It Is
The CLI is the primary user-facing interface for Drift. It provides 50+ commands for scanning codebases, managing patterns, running analysis, enforcing quality gates, and managing the Cortex memory system. It's a presentation layer — all heavy lifting is delegated to `driftdetect-core`, `driftdetect-detectors`, and the Rust native bindings.

## Core Design Principles
1. Commands are thin wrappers — business logic lives in services and core
2. Every command supports `--format json` for machine consumption
3. Native Rust is tried first, TypeScript is the fallback
4. Interactive prompts are skippable with `-y` for CI
5. The setup wizard orchestrates all features through modular runners
6. Reporters are pluggable (text, JSON, GitHub, GitLab, SARIF)

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    bin/drift.ts                          │
│  (Commander.js program — registers all 50+ commands)    │
├──────────┬──────────┬──────────┬────────────────────────┤
│  Core    │ Analysis │ Language │  Infrastructure         │
│ Commands │ Commands │ Commands │  Commands               │
│ (scan,   │ (call-   │ (ts, py,│  (projects, backup,     │
│  check,  │  graph,  │  java,  │   setup, memory,        │
│  approve)│  env,    │  go...) │   gate, telemetry)      │
│          │  dna...) │         │                          │
├──────────┴──────────┴──────────┴────────────────────────┤
│                    Services Layer                        │
│  ScannerService │ PatternServiceFactory │ BackupService  │
│  BoundaryScanner│ ContractScanner                        │
├─────────────────────────────────────────────────────────┤
│                    UI Layer                              │
│  Spinner │ Table │ Prompts │ Progress │ ProjectIndicator │
├─────────────────────────────────────────────────────────┤
│                    Reporters                             │
│  Text │ JSON │ GitHub │ GitLab │ SARIF                   │
├─────────────────────────────────────────────────────────┤
│                    Workers                               │
│  detector-worker.ts (Piscina thread pool)               │
├─────────────────────────────────────────────────────────┤
│                    Git Integration                       │
│  staged-files.ts (git diff --cached)                    │
├─────────────────────────────────────────────────────────┤
│                    Core / Detectors / Native             │
│  driftdetect-core │ driftdetect-detectors │ Rust NAPI   │
└─────────────────────────────────────────────────────────┘
```

## Entry Point
`src/bin/drift.ts` — Creates a `Commander.js` program, registers all commands via `program.addCommand()`, adds help text with usage examples, and calls `program.parseAsync(process.argv)`.

## Subsystem Directory Map

| Directory | Purpose | Doc |
|-----------|---------|-----|
| `commands/` | 48 command files + 2 subdirectories | [commands.md](./commands.md) |
| `commands/setup/` | Setup wizard with modular runners | [setup-wizard.md](./setup-wizard.md) |
| `commands/dna/` | DNA subcommands (scan, status, gene, mutations, playbook, export) | [commands.md](./commands.md) |
| `services/` | Business logic layer (scanning, pattern store, backup) | [services.md](./services.md) |
| `reporters/` | Output formatters (text, JSON, GitHub, GitLab, SARIF) | [reporters.md](./reporters.md) |
| `ui/` | Shared UI components (spinner, table, prompts, progress) | [ui.md](./ui.md) |
| `git/` | Git integration (staged files, hooks, repo detection) | [git.md](./git.md) |
| `workers/` | Worker threads for parallel detection | [services.md](./services.md) |
| `types/` | Shared CLI type definitions | [types.md](./types.md) |
| `*.test.ts` | Property-based and integration tests | [testing.md](./testing.md) |

## Command Lifecycle

```
User types "drift scan --incremental"
  → Commander.js parses args
  → scanCommand.action(options) called
  → Resolves project root (walk up from cwd looking for .drift/)
  → Creates ScannerService (loads detectors, optionally spawns worker pool)
  → FileWalker discovers source files (respects ignore patterns)
  → ScannerService.scanFiles() runs detectors against each file
  → Patterns aggregated, deduplicated, scored
  → PatternStore persists results (auto-detects SQLite vs JSON)
  → Data lake views materialized
  → History snapshot created
  → Telemetry recorded (if enabled)
  → Results displayed via UI components (spinner, table)
```

## Global Options
```
--verbose       Enable verbose output
--no-color      Disable colored output
-v, --version   Output the current version
```

## Dependencies
- `commander` — Command framework
- `chalk` — Terminal colors
- `ora` — Spinners
- `cli-table3` — Table formatting
- `@inquirer/prompts` — Interactive prompts (confirm, select, input, checkbox)
- `piscina` — Worker thread pool (optional, for parallel detection)
- `driftdetect-core` — Core analysis engine
- `driftdetect-detectors` — Pattern detectors
- Rust NAPI bindings (optional, for native performance)

## Public API (`index.ts`)
The package exports a subset of commands and UI components for programmatic use:
- `VERSION` — Read from `package.json` at runtime via `createRequire`
- Core commands: `initCommand`, `scanCommand`, `checkCommand`, `statusCommand`, `approveCommand`, `ignoreCommand`, `reportCommand`
- All types from `types/index.ts`
- All UI components from `ui/index.ts`

## Rust Rebuild Considerations
The CLI is a presentation layer — it stays in TypeScript. The migration strategy is:

1. **Commands stay in TS** — Commander.js, arg parsing, output formatting are all presentation concerns
2. **Services thin out** — `ScannerService` becomes a thin wrapper around Rust NAPI calls. Worker threads become unnecessary as Rust handles parallelism natively via Rayon
3. **Reporters stay in TS** — Output formatting is presentation-layer
4. **UI stays in TS** — Terminal interaction (spinners, tables, prompts) is presentation-layer
5. **Git integration stays in TS** — Shells out to `git` CLI, no performance concern
6. **Worker threads eliminated** — Rust's native parallelism replaces Piscina thread pool entirely

The key interface boundary is `ScannerService` → Rust NAPI. Today it loads TS detectors and optionally spawns workers. Post-migration, it calls `nativeScan()` which handles file walking, parsing, detection, and aggregation in Rust, returning `ScanResults` via NAPI.

Setup wizard, memory commands, and project management remain pure TypeScript orchestration.
