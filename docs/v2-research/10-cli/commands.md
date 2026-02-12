# CLI Commands — Complete Reference

## Location
`packages/cli/src/commands/` — 48 command files + `dna/` and `setup/` subdirectories

## Command Registration
All commands are exported from `commands/index.ts` and registered in `bin/drift.ts` via `program.addCommand()`. Some commands are pre-instantiated (`scanCommand`), others are factory functions (`createGateCommand()`).

## Core Workflow Commands

### `drift init` (`init.ts`)
Initialize Drift in a project.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--from-scaffold` | boolean | false | Load Cheatcode2026 enterprise presets |
| `-y, --yes` | boolean | false | Skip interactive prompts |
| `-v, --verbose` | boolean | false | Verbose output |

**What it does**:
1. Creates `.drift/` with 30+ subdirectories (patterns, history, cache, reports, lake, boundaries, contracts, constraints, etc.)
2. Generates `config.json` with project UUID, name, default ignore patterns, feature flags
3. Registers project in global registry (`~/.drift/registry.json`)
4. Prompts for telemetry opt-in
5. Optionally runs initial scan and auto-approve

### `drift scan` (`scan.ts`)
Full codebase scan to discover patterns.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--incremental` | boolean | false | Only scan changed files |
| `--force` | boolean | false | Ignore cache, rescan everything |
| `--critical` | boolean | false | Only run critical detectors |
| `--categories <list>` | string | all | Comma-separated category filter |
| `--manifest` | boolean | false | Generate semantic manifest |
| `--no-contracts` | boolean | false | Skip contract scanning |
| `--no-boundaries` | boolean | false | Skip boundary scanning |
| `--test-topology` | boolean | false | Include test topology |
| `--constants` | boolean | false | Include constant extraction |
| `--callgraph` | boolean | false | Include call graph build |
| `--project <name>` | string | — | Scan specific registered project |
| `--all-projects` | boolean | false | Scan all registered projects |
| `--timeout <seconds>` | number | 300 | Scan timeout |
| `--max-file-size <bytes>` | number | 1MB | Max file size to scan |
| `-v, --verbose` | boolean | false | Verbose output |

**Internals**: Uses `ScannerService` (see [services.md](./services.md)). Health monitoring via `ScanHealthMonitor` class that tracks elapsed time, warns after 30s, and enforces timeout. Progress updates every 10s for long scans.

### `drift check` (`check.ts`)
Check for violations against approved patterns.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--staged` | boolean | false | Only check staged files |
| `--ci` | boolean | auto | CI mode (JSON output, non-interactive) |
| `--format <fmt>` | string | text | Output: text, json, github, gitlab |
| `--fail-on <level>` | string | error | Exit code threshold: error, warning, none |
| `-v, --verbose` | boolean | false | Verbose output |

**Internals**: Uses `getStagedFiles()` from git module for `--staged`. Selects reporter based on `--format`. Exit code determined by violation severity vs `--fail-on` threshold.

### `drift status` (`status.ts`)
Show current drift status.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--detailed` | boolean | false | Full pattern listing |
| `--format <fmt>` | string | text | Output: text, json |
| `-v, --verbose` | boolean | false | Verbose output |

**Internals**: Uses `createCLIPatternStore()` which auto-detects SQLite vs JSON. Displays storage backend info. Shows `StatusSummary` and `CategoryBreakdown` via table formatters.

### `drift approve` (`approve.ts`)
Approve discovered patterns.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `<pattern-id>` | argument | — | Pattern ID (supports partial match) |
| `--category <cat>` | string | — | Approve all in category |
| `--auto` | boolean | false | Auto-approve ≥ threshold confidence |
| `--threshold <n>` | number | 0.90 | Confidence threshold for auto-approve |
| `--dry-run` | boolean | false | Preview without changes |
| `-y, --yes` | boolean | false | Skip confirmation |
| `--root <path>` | string | cwd | Project root directory |
| `-v, --verbose` | boolean | false | Verbose output |

**Internals**: Uses `createCLIPatternServiceAsync()`. Supports batch approval via `promptBatchPatternApproval()`. Records telemetry for each approval action.

### `drift ignore` (`ignore.ts`)
Ignore patterns to stop tracking.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `<pattern-id>` | argument | required | Pattern ID |
| `-y, --yes` | boolean | false | Skip confirmation |

### `drift watch` (`watch.ts`)
Real-time file watching with pattern detection.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--context <path>` | string | — | Auto-update AI context file |
| `--categories <list>` | string | all | Category filter |
| `--debounce <ms>` | string | 300 | Debounce interval |
| `--persist` | boolean | false | Persist patterns to store |
| `-v, --verbose` | boolean | false | Verbose output |

**Internals**: Uses `fs.watch()` with debouncing. Maintains a `FileMap` (file → hash + patterns) for incremental updates. File locking via `.drift/index/.lock` with 10s timeout and 100ms retry. Location deduplication via `locationKey()`.

## Reporting & Export Commands

### `drift report` (`report.ts`)
Generate reports.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format <fmt>` | string | text | Output: text, json, github, gitlab |
| `--category <cat>` | string | — | Filter by category |
| `--output <path>` | string | — | Write to file |

### `drift export` (`export.ts`)
Export data for external consumption.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format <fmt>` | string | json | json, ai-context, summary, markdown, db-json, db-sqlite |
| `--category <cat>` | string | — | Filter by category |
| `--status <s>` | string | — | Filter by status |
| `--min-confidence <n>` | number | — | Confidence threshold |
| `--snippets` | boolean | false | Include code snippets |
| `--output <path>` | string | — | Write to file |

### `drift trends` (`trends.ts`)
View pattern regressions over time.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--period <p>` | string | 7d | Time period: 7d, 30d, 90d |
| `--format <fmt>` | string | text | Output: text, json |

### `drift dashboard` (`dashboard.ts`)
Launch web UI.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--port <n>` | number | 3847 | Server port |

## Analysis Commands

### `drift callgraph` (`callgraph.ts`)
Call graph analysis with subcommands.

| Subcommand | Description |
|-----------|-------------|
| (default) | Status overview |
| `build` | Build call graph (native Rust or streaming TS) |
| `reach <file:line>` | Forward reachability — what data can this code reach? |
| `inverse <table>` | Inverse reachability — who can reach this data? |
| `impact <file:line>` | Impact analysis — blast radius of a change |
| `dead` | Dead code detection |
| `coverage` | Coverage analysis |

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format <fmt>` | string | text | Output: text, json |
| `--max-depth <n>` | number | — | Max traversal depth |
| `--security` | boolean | false | Security-prioritized view |
| `--force` | boolean | false | Rebuild from scratch |
| `-v, --verbose` | boolean | false | Verbose output |

**Internals**: Checks `isNativeAvailable()` first. Native path uses `nativeBuildCallGraph()` via NAPI. Fallback uses `createStreamingCallGraphBuilder()`. Also integrates `createSecurityPrioritizer()`, `createImpactAnalyzer()`, `createDeadCodeDetector()`, `createCoverageAnalyzer()`.

### `drift boundaries` (`boundaries.ts`)
Data access boundary analysis.

| Subcommand | Description |
|-----------|-------------|
| (default) | Overview |
| `tables` | List discovered tables |
| `sensitive` | Show sensitive fields |
| `access <table>` | Access points for table |
| `check` | Check for violations |
| `rules` | Show/generate rules |

### `drift env` (`env.ts`)
Environment variable tracking.

| Subcommand | Description |
|-----------|-------------|
| (default) | Overview |
| `scan` | Scan for env var access |
| `list` | List all discovered variables |
| `secrets` | Show secrets/credentials |
| `var <name>` | Details for specific variable |
| `required` | Variables without defaults |
| `file <pattern>` | What env vars a file accesses |

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format <fmt>` | string | text | Output: text, json |
| `--sensitivity <s>` | string | — | Filter: secret, credential, config |
| `-v, --verbose` | boolean | false | Verbose output |

### `drift constants` (`constants.ts`)
Constant and enum analysis.

| Subcommand | Description |
|-----------|-------------|
| (default) | Overview |
| `list` | List all constants |
| `get <name>` | Constant details |
| `secrets` | Hardcoded secrets |
| `inconsistent` | Inconsistent values |
| `dead` | Unused constants |
| `export <file>` | Export to file |

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format <fmt>` | string | text | Output: text, json, csv |
| `-c, --category <cat>` | string | — | Filter: config, api, status, error, etc. |
| `-l, --language <lang>` | string | — | Filter by language |
| `--file <path>` | string | — | Filter by file |
| `--search <query>` | string | — | Search by name |
| `--exported` | boolean | — | Only exported constants |
| `--severity <s>` | string | — | Min severity for secrets |
| `--limit <n>` | number | — | Limit results |

### `drift coupling` (`coupling.ts`)
Module dependency analysis.

| Subcommand | Description |
|-----------|-------------|
| (default) | Overview |
| `cycles` | Detect dependency cycles |
| `hotspots` | Highly coupled modules |
| `analyze <module>` | Analyze specific module |

### `drift error-handling` (`error-handling.ts`)
Error handling analysis.

| Subcommand | Description |
|-----------|-------------|
| (default) | Overview |
| `gaps` | Find error handling gaps |
| `unhandled` | Unhandled error paths |

### `drift test-topology` (`test-topology.ts`)
Test coverage mapping.

| Subcommand | Description |
|-----------|-------------|
| (default) | Overview |
| `coverage` | Coverage analysis |
| `uncovered` | Untested code |
| `affected` | Tests affected by changes |

### `drift constraints` (`constraints.ts`)
Architectural constraint enforcement.

| Subcommand | Description |
|-----------|-------------|
| (default) | Overview |
| `discover` | Discover constraints |
| `check` | Check violations |

### `drift wrappers` (`wrappers.ts`)
Framework wrapper detection.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | false | JSON output |
| `-v, --verbose` | boolean | false | Verbose output |

### `drift simulate` (`simulate.ts`)
Speculative execution engine.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `<description>` | argument | required | What to simulate (e.g. "add rate limiting") |
| `--json` | boolean | false | JSON output |
| `-v, --verbose` | boolean | false | Verbose output |

**Output**: Multiple implementation approaches with risk scores, complexity estimates, affected files, pattern alignment metrics. Uses `getMetricBar()` for visual bar charts.

## DNA Commands (`dna/`)

```
drift dna                   # Status (default action)
drift dna scan              # Analyze styling DNA
drift dna status            # Show DNA status
drift dna gene <id>         # Gene details
drift dna mutations         # Mutation detection
drift dna playbook          # Generate styling playbook
drift dna export            # Export DNA data
```

Implemented as a Commander subcommand group in `commands/dna/index.ts` with individual files: `scan.ts`, `status.ts`, `gene.ts`, `mutations.ts`, `playbook.ts`, `export.ts`.

## Memory Commands (`memory.ts`)

The memory command is the largest single command file (~2800 lines) with 20+ subcommands:

| Subcommand | Description |
|-----------|-------------|
| `init` | Initialize memory system |
| `status` | Memory system status |
| `add <type> <content>` | Add memory (tribal, procedural, agent, goal, incident, workflow, entity, environment) |
| `list` | List memories (filterable by type) |
| `show <id>` | Memory details with related memories |
| `search <query>` | Search memories |
| `update <id> <content>` | Update memory content |
| `delete <id>` | Delete memory |
| `learn -o <old> -f <fix>` | Learn from correction |
| `feedback <id> <action>` | Confirm/stale/contradict a memory |
| `validate` | Validate and heal memories |
| `consolidate` | Consolidate episodic memories |
| `warnings` | Show active warnings |
| `why <focus>` | Get context for a task |
| `export <file>` | Export memories |
| `import <file>` | Import memories |
| `health` | Health report |

**Internals**: Uses `getCortex()` helper that dynamically imports `driftdetect-cortex` and creates a `CortexV2` instance. Each subcommand has its own async action function.

## Language-Specific Commands

Each wraps language-specific detectors and analysis from core:

| Command | File | Language |
|---------|------|----------|
| `drift ts` | `ts.ts` | TypeScript/JavaScript |
| `drift py` | `py.ts` | Python |
| `drift java` | `java.ts` | Java |
| `drift php` | `php.ts` | PHP |
| `drift go` | `go.ts` | Go |
| `drift rust` | `rust.ts` | Rust |
| `drift cpp` | `cpp.ts` | C++ |
| `drift wpf` | `wpf.ts` | WPF/XAML |

## Project & Infrastructure Commands

### `drift projects` (`projects.ts`)
Multi-project management.

| Subcommand | Description |
|-----------|-------------|
| `list` | List registered projects |
| `switch <name>` | Switch active project |
| `add [path]` | Register a project |
| `remove <name>` | Unregister a project |
| `info` | Current project details |
| `cleanup` | Remove invalid projects |
| `rename <old> <new>` | Rename project |

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--all` | boolean | false | Include invalid projects |
| `--json` | boolean | false | JSON output |
| `--language <lang>` | string | — | Filter by language |
| `--framework <fw>` | string | — | Filter by framework |
| `--tag <tag>` | string | — | Filter by tag |

### `drift gate` (`gate.ts`)
Quality gate execution.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `[files...]` | argument | — | Specific files to check |
| `--policy <p>` | string | default | Policy: default, strict, custom |
| `--gates <list>` | string | — | Specific gates to run |
| `--format <fmt>` | string | text/json | text, json, sarif, github, gitlab |
| `--ci` | boolean | auto | CI mode |
| `--fail-on <level>` | string | error | Fail threshold |
| `--staged` | boolean | false | Only staged files |
| `--dry-run` | boolean | false | Preview without failing |
| `--output <path>` | string | — | Write to file |
| `--root <path>` | string | cwd | Project root |
| `-v, --verbose` | boolean | false | Verbose output |

**Internals**: Uses `GateOrchestrator` from core with 5 reporter implementations: `TextReporter`, `JsonReporter`, `GitHubReporter`, `GitLabReporter`, `SarifReporter`.

### `drift backup` (`backup.ts`)
Backup and restore.

| Subcommand | Description |
|-----------|-------------|
| (default) | List backups |
| `create` | Create backup |
| `restore [id]` | Restore from backup |
| `delete [id]` | Delete backup (requires typing DELETE) |
| `info [id]` | Backup details |

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--reason <text>` | string | — | Reason for backup |
| `--json` | boolean | false | JSON output |

### `drift context` (`context.ts`)
Monorepo AI context generation.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `<package>` | argument | — | Package name or path |
| `--list` | boolean | false | List all packages |
| `--format <fmt>` | string | markdown | markdown, ai, json |
| `--snippets` | boolean | false | Include code snippets |

### Memory Setup Command (`memory-setup.ts`)

Guided wizard for bootstrapping Cortex memory with project-specific knowledge. Separate from `drift memory init` — this is an interactive onboarding flow that populates memories.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-y, --yes` | boolean | false | Quick setup with defaults |
| `-v, --verbose` | boolean | false | Verbose output |

### 8 Setup Phases
1. **Core Identity** — Detects project language, framework, name; creates entity memories
2. **Tribal Knowledge** — Prompts for team conventions, coding standards
3. **Workflows** — Captures deployment, review, and release workflows
4. **Agent Spawns** — Configures AI agent spawn templates
5. **Entities** — Registers team members, services, external systems
6. **Skills** — Records team skills and expertise areas
7. **Environments** — Documents dev, staging, production environments
8. **Save to Memory** — Persists all collected data via `CortexV2`

### SetupState
```typescript
interface SetupState {
  projectName: string;
  language: string;
  framework: string;
  rootDir: string;
  tribalKnowledge: { conventions: string[]; warnings: string[] };
  workflows: { name: string; steps: string[] }[];
  agentSpawns: { name: string; config: any }[];
  entities: { name: string; type: string }[];
  skills: { name: string; level: string }[];
  environments: { name: string; url?: string }[];
}
```

**Internals**: Uses `getCortex()` helper (same as `memory.ts`) to dynamically import `driftdetect-cortex`. Auto-detects project info from `package.json`, `Cargo.toml`, `go.mod`, etc.

## Decision Mining Command (`decisions.ts`)

Git-based architectural decision mining. Analyzes commit history to extract implicit ADRs (Architecture Decision Records).

| Subcommand | Description |
|-----------|-------------|
| `mine` | Mine decisions from git history |
| `status` | Show mining status |
| `list` | List discovered decisions |
| `show <id>` | Decision details |
| `export` | Export as ADR markdown |
| `confirm <id>` | Confirm a mined decision |
| `for-file <path>` | Decisions affecting a file |
| `timeline` | Chronological decision timeline |

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | false | JSON output |
| `--category <cat>` | string | — | Filter by category |
| `--confidence <level>` | string | — | Filter by confidence |
| `-v, --verbose` | boolean | false | Verbose output |

**Internals**: Uses `DecisionMiner` from `driftdetect-core`. Stores results in `.drift/decisions/`. Generates ADR markdown via `generateADRMarkdown()`. Displays with category icons, confidence colors, and evidence type indicators.

### Decision Categories
Architecture, API, security, performance, testing, infrastructure, dependency, naming, error-handling, and more — each with a distinct icon.

### Evidence Types
Commit messages, code changes, config changes, dependency updates — each with visual indicators.

## Other Infrastructure Commands

| Command | File | Description |
|---------|------|-------------|
| `drift setup` | `setup.ts` → `setup/index.ts` | Guided setup wizard (see [setup-wizard.md](./setup-wizard.md)) |
| `drift memory-setup` | `memory-setup.ts` | Guided memory bootstrapping wizard |
| `drift migrate-storage` | `migrate-storage.ts` | Storage format migration (legacy → unified → SQLite) |
| `drift import` | `import.ts` | Database import from JSON/SQLite |
| `drift skills` | `skills.ts` | Agent skill management (list, install, uninstall, search) |
| `drift parser` | `parser.ts` | Parser capabilities and file testing |
| `drift license` | `license.ts` | License status display |
| `drift telemetry` | `telemetry.ts` | Telemetry enable/disable/setup |
| `drift audit` | `audit.ts` | Pattern audit system |
| `drift next-steps` | `next-steps.ts` | Personalized recommendations |
| `drift troubleshoot` | `troubleshoot.ts` | Diagnostic tool |
| `drift where` | `where.ts` | Find pattern locations |
| `drift files` | `files.ts` | Show patterns in file |

## Rust Rebuild Considerations
- Commands stay in TypeScript — they are presentation-layer wrappers
- The heavy lifting (scanning, call graph, analysis) already delegates to core/detectors/Rust
- Post-migration, commands like `scan`, `callgraph`, `boundaries` become thinner as Rust handles more
- `memory.ts` (2800 lines) could benefit from splitting into subcommand files (like `dna/`)
- Language-specific commands (`ts.ts`, `py.ts`, etc.) may merge into a single `drift analyze <lang>` once Rust handles all languages uniformly
- The `simulate` command's scoring logic could move to Rust for consistency with native analysis
- `decisions.ts` git mining is CPU-bound on large repos — good candidate for Rust acceleration
