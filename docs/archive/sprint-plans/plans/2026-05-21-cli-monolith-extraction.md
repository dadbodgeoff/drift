# Drift CLI Monolith Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `packages/cli/src/index.ts` into focused modules without changing CLI behavior, JSON contracts, command names, or storage semantics.

**Architecture:** Keep `runCli(argv)` as the public package API and move everything else behind focused internal modules. Extract by stable responsibility: app shell, argument/help plumbing, command families, domain services, engine integration, and text formatters. Each task must compile and pass tests before moving on.

**Tech Stack:** TypeScript ESM, Vitest, existing `@drift/core` and `@drift/storage` APIs, current CLI command contracts.

---

## Target Structure

Final intended tree:

```text
packages/cli/src/
  main.ts
  index.ts

  app/
    run-cli.ts
    router.ts
    command-types.ts
    errors.ts
    output.ts

  args/
    parse-args.ts
    flag-schema.ts
    flag-readers.ts
    command-shape.ts
    help.ts

  commands/
    doctor.ts
    init.ts
    scan.ts
    start.ts
    conventions.ts
    contract.ts
    findings.ts
    audit.ts
    backup.ts
    restore.ts
    policy.ts
    prepare.ts
    ask.ts
    repo-map.ts
    checks.ts

  domain/
    governance.ts
    identifiers.ts
    pagination.ts
    repo-paths.ts
    versions.ts
    contract-materialization.ts
    convention-candidates.ts
    findings.ts
    baselines.ts
    preflight.ts
    repo-map.ts
    policy-context.ts
    backup-artifacts.ts
    restore-review.ts
    audit-review.ts
    scan-status.ts

  engine/
    collect-scan-data.ts
    rust-engine.ts
    ts-fallback-scanner.ts
    fact-extraction.ts
    import-resolution.ts
    ignore.ts

  check/
    run-check.ts
    diff.ts
    finding-fingerprint.ts
    rule-evaluation.ts
    waivers.ts

  formatters/
    conventions.ts
    contract.ts
    findings.ts
    audit.ts
    backup.ts
    restore.ts
    scan-status.ts
    policy.ts
    preflight.ts
    repo-map.ts
    checks.ts
    doctor.ts

  io/
    git.ts
    json-file.ts
    file-hash.ts
```

## Boundary Rules

- `src/index.ts` only exports public API: `runCli`, `CliResult`.
- `src/main.ts` stays a thin binary entrypoint.
- `app/run-cli.ts` owns top-level error handling, storage open/migrate/close, and output formatting.
- `app/router.ts` routes to command modules. It must not contain command business logic.
- `commands/*` can coordinate storage calls and parse command-specific flags, but must delegate reusable logic to `domain/*`, `engine/*`, or `check/*`.
- `domain/*` must be pure or near-pure logic. It should not know about CLI argv.
- `formatters/*` must return human-readable text only. JSON payload shape stays in command modules or domain types.
- `engine/*` owns scan fact collection and Rust/TS fallback boundaries.
- `check/*` owns diff parsing and deterministic finding evaluation.
- No module should import from `packages/cli/src/index.ts`.
- Avoid barrel files until the end. Prefer explicit imports during extraction to prevent circular dependency hiding.

## Dependency Direction

The refactor must preserve a one-way dependency graph:

```text
main -> index -> app -> commands
commands -> args/domain/check/engine/formatters/io
check -> domain/io/core/storage types
engine -> domain/io/core types
domain -> core/storage types
formatters -> domain/core types
args -> app command types only
io -> node stdlib only unless a helper explicitly needs core types
```

Hard rules:

- `commands/*` must not import from other `commands/*` files.
- `formatters/*` must not import storage or filesystem helpers.
- `domain/*` must not import CLI parsing helpers.
- `engine/*` must not import command modules.
- `check/*` must not import command modules.
- `app/router.ts` can import command modules, but command modules cannot import `app/router.ts`.
- `main.ts` must never import command, domain, engine, check, or formatter files directly.

Add a cycle check after the extraction is complete. If adding a dependency is awkward, stop and move the shared function into `domain/*`, `check/*`, `engine/*`, or `io/*` instead of creating a sideways import.

## Command Context Pattern

As commands move out of `index.ts`, use a single context object for new command module entrypoints:

```ts
import type { ParsedArgs } from "../app/command-types.js";
import type { SqliteDriftStorage } from "@drift/storage";

export interface CommandContext {
  storage: SqliteDriftStorage;
  parsed: ParsedArgs;
  now: () => string;
}
```

Rules:

- Use `ctx.storage`, `ctx.parsed`, and `ctx.now()` inside command modules.
- Do not pass loose `storage, parsed, now` triples once a command has been extracted.
- Use `ctx.now()` for new timestamps so tests can eventually inject time cleanly.
- Do not change existing `--now` behavior during extraction.

The first extraction can use a local `CommandContext` in `app/command-types.ts`. If this becomes useful for MCP later, promote the shared shape only after the CLI split is stable.

## Payload Contract Pattern

Define named payload types for the commands agents and scripts depend on most:

```ts
export interface StartPayload {
  repo: unknown;
  scan: unknown;
  accepted_default: unknown;
  baseline: unknown;
  next_commands: string[];
}
```

Do this pragmatically:

- Start with `DoctorPayload`, `StartPayload`, `ScanStatusPayload`, `PreparePayload`, `CheckPayload`, `ContractShowPayload`, `FindingsListPayload`, and `BackupVerifyPayload`.
- Keep payload property names exactly as they are today.
- Do not rewrite every payload type in one pass.
- Payload types should live near command modules unless reused by MCP or core.
- If a payload is shared with MCP, move the reusable builder logic to `domain/*`, not to `commands/*`.

## Transaction Rule

Any command that writes more than one SQLite row must wrap the write group in `storage.transaction()`.

Examples that must remain transactional:

- accepting conventions
- editing/rejecting convention candidates when contract/audit state changes
- adding convention exceptions
- importing contracts
- adding/removing contract waivers
- creating/clearing baselines
- governance finding state changes if future changes touch multiple rows
- backup creation when manifest/audit/source-copy sequencing changes
- restore once post-copy state writes become more complex

No command should partially update governance state and then fail before audit or contract materialization catches up.

## Router Registry Target

The first pass can keep the current router shape. After command modules exist, replace the long conditional router with a small typed registry:

```ts
import type { CommandPayload, ParsedArgs } from "./command-types.js";
import type { SqliteDriftStorage } from "@drift/storage";

export interface CommandHandler {
  path: string[];
  run: (ctx: CommandContext) => CommandPayload | unknown;
}
```

Registry rules:

- Match exact command paths, e.g. `["scan", "status"]`, `["contract", "waiver", "add"]`.
- Keep dynamic ids as parsed positional values, not route path entries.
- Unknown command and command-shape errors must remain identical to current behavior.
- Do not introduce Commander, Yargs, or another CLI framework during this refactor.

## Testing Strategy

This refactor is only successful if it is boring from the outside.

Required after every task:

```bash
pnpm --filter @drift/cli typecheck
pnpm --filter @drift/cli test -- --runInBand
```

Required after engine/check tasks:

```bash
cargo test -p drift-engine
```

Required at the end:

```bash
pnpm verify:ci
```

Before the final cleanup, add or preserve command contract tests for these JSON surfaces:

- `drift start --accept-defaults --json`
- `drift scan status --json`
- `drift prepare "<task>" --json`
- `drift check --diff main...HEAD --scope changed-hunks --json`
- `drift contract show --json`
- `drift findings list --json`
- `drift backup verify <backup.sqlite> --json`
- MCP parity tests for any payload builder moved out of CLI

Human-readable text tests should assert important lines, not snapshot entire outputs. JSON tests should assert exact keys for stable contracts where practical.

## Static Quality Gates To Add Near The End

Add these only after the module split is mostly complete:

- import-cycle detection
- forbidden import direction check
- max-file-size warning for CLI modules
- command registry coverage check

Preferred implementation is a small repo-local script under `packages/cli/scripts/` or `scripts/`, not a heavy framework.

Example policy:

```text
Fail if:
- a file under commands imports another commands file
- a file under formatters imports @drift/storage
- a file under domain imports ../args
- a file under engine imports ../commands
- a file under check imports ../commands
- any cycle exists under packages/cli/src
```

## Growth Principles

- The CLI is the product control plane, not the parser engine.
- Parser expansion belongs under `engine/` and eventually Rust/core, not command modules.
- Graph expansion belongs in storage/core/domain services, not formatters.
- MCP and CLI should share domain builders wherever they return equivalent data.
- Every new command must have a command module, payload type when JSON-facing, help entry, parser validation, and test coverage.
- Every new governance mutation must have confirmation, audit, transaction boundary, and a test proving no-op behavior does not create audit noise.
- Every outward context surface must call central policy authorization before returning file/path context.

## Extraction Order

Do this in eight PR-sized passes. Each pass is behavior-preserving.

### Task 1: App Shell And Shared Types

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/app/command-types.ts`
- Create: `packages/cli/src/app/output.ts`
- Create: `packages/cli/src/app/run-cli.ts`

- [ ] Move `CliResult`, `ParsedArgs`, and `CommandPayload` into `app/command-types.ts`.
- [ ] Move `formatOutput`, `normalizeCommandResult`, and `isCommandPayload` into `app/output.ts`.
- [ ] Move top-level `runCli(argv)` into `app/run-cli.ts`.
- [ ] Leave `index.ts` as:

```ts
export { runCli } from "./app/run-cli.js";
export type { CliResult } from "./app/command-types.js";
```

- [ ] Run:

```bash
pnpm --filter @drift/cli typecheck
pnpm --filter @drift/cli test -- --runInBand
```

Expected: all CLI tests pass.

### Task 2: Argument Parsing, Flag Readers, And Help

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/args/parse-args.ts`
- Create: `packages/cli/src/args/flag-schema.ts`
- Create: `packages/cli/src/args/flag-readers.ts`
- Create: `packages/cli/src/args/command-shape.ts`
- Create: `packages/cli/src/args/help.ts`

- [ ] Move `parseArgs`, `VALUE_FLAGS`, `BOOLEAN_FLAGS`, and `validateParsedFlags` into `args/parse-args.ts` and `args/flag-schema.ts`.
- [ ] Move all `requiredFlag`, `optional*Flag`, `stringFlag`, `requiredValue`, `actorFlag`, and `rejectAmbiguousDryRunConfirm` helpers into `args/flag-readers.ts`.
- [ ] Move `unknownCommandError` and `validateCommandShape` into `args/command-shape.ts`.
- [ ] Move `isHelpRequest`, `isVersionRequest`, and `helpText` into `args/help.ts`.
- [ ] Keep exact help text stable except wording already intentionally changed around no-approval/read-only.
- [ ] Run:

```bash
pnpm --filter @drift/cli typecheck
pnpm --filter @drift/cli test -- --runInBand
```

Expected: all CLI tests pass.

### Task 3: Common Domain Utilities

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/domain/governance.ts`
- Create: `packages/cli/src/domain/identifiers.ts`
- Create: `packages/cli/src/domain/pagination.ts`
- Create: `packages/cli/src/domain/repo-paths.ts`
- Create: `packages/cli/src/domain/versions.ts`
- Create: `packages/cli/src/io/git.ts`
- Create: `packages/cli/src/io/json-file.ts`
- Create: `packages/cli/src/io/file-hash.ts`

- [ ] Move `preflightGovernance`, `mutationGovernance`, `doctorRuntime`, `doctorV1Scope`, `versionPayload`, `capabilitiesPayload`, and `formatCapabilitiesText` into `domain/versions.ts` and `domain/governance.ts`.
- [ ] Move `hashStable`, `repoIdForRoot`, `contractIdForRepo`, `conventionIdForCandidate`, `exceptionIdForConvention`, `contractWaiverId`, and `sanitizeAuditId` into `domain/identifiers.ts`.
- [ ] Move pagination/order helpers into `domain/pagination.ts`.
- [ ] Move repo path/database helpers into `domain/repo-paths.ts`.
- [ ] Move `gitOutput`, `parseJsonFile`, `parseContractFile`, and `fileContentHash` into `io/*`.
- [ ] Run:

```bash
pnpm --filter @drift/cli typecheck
pnpm --filter @drift/cli test -- --runInBand
```

Expected: all CLI tests pass.

### Task 4: Router And Command Family Shells

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/app/router.ts`
- Create every file under `packages/cli/src/commands/*.ts`

- [ ] Move `runCommand` into `app/router.ts`.
- [ ] Create one command module per command family with exported functions matching current command names.
- [ ] Initially move command functions only, leaving deeply shared helpers in `index.ts` if needed. This keeps the first command split mechanical.
- [ ] Command modules to create in this pass:

```text
doctor.ts
init.ts
scan.ts
start.ts
conventions.ts
contract.ts
findings.ts
audit.ts
backup.ts
restore.ts
policy.ts
prepare.ts
ask.ts
repo-map.ts
checks.ts
```

- [ ] Run:

```bash
pnpm --filter @drift/cli typecheck
pnpm --filter @drift/cli test -- --runInBand
```

Expected: all CLI tests pass.

### Task 5: Human Formatters

**Files:**
- Modify: command modules using text output
- Create every file under `packages/cli/src/formatters/*.ts`

- [ ] Move `formatConventionCandidatesText`, `formatConventionCandidateText`, and `evidenceLocationLines` into `formatters/conventions.ts`.
- [ ] Move contract formatter functions into `formatters/contract.ts`.
- [ ] Move findings formatter functions into `formatters/findings.ts`.
- [ ] Move audit formatter functions into `formatters/audit.ts`.
- [ ] Move backup formatter functions into `formatters/backup.ts`.
- [ ] Move restore formatter functions into `formatters/restore.ts`.
- [ ] Move scan status formatter into `formatters/scan-status.ts`.
- [ ] Move policy formatter functions into `formatters/policy.ts`.
- [ ] Move prepare/ask/repo-map/checks/doctor formatters into matching files.
- [ ] Run:

```bash
pnpm --filter @drift/cli typecheck
pnpm --filter @drift/cli test -- --runInBand
```

Expected: all CLI tests pass.

### Task 6: Scan And Engine Boundary

**Files:**
- Modify: `packages/cli/src/commands/scan.ts`
- Create: `packages/cli/src/engine/collect-scan-data.ts`
- Create: `packages/cli/src/engine/rust-engine.ts`
- Create: `packages/cli/src/engine/ts-fallback-scanner.ts`
- Create: `packages/cli/src/engine/fact-extraction.ts`
- Create: `packages/cli/src/engine/import-resolution.ts`
- Create: `packages/cli/src/engine/ignore.ts`

- [ ] Move `collectScanData`, `collectScanDataFromRust`, `runRustEngine`, and `findCargoWorkspaceRoot` into `engine/collect-scan-data.ts` and `engine/rust-engine.ts`.
- [ ] Move `walkIndexableFiles`, `shouldSkipPath`, `isTypescriptPath`, `extractFactsFromFile`, `factRecord`, and `fileSnapshotForFile` into `engine/ts-fallback-scanner.ts` and `engine/fact-extraction.ts`.
- [ ] Move import target resolution helpers into `engine/import-resolution.ts`.
- [ ] Keep the current TypeScript fallback behavior identical. Do not add new parser features in this pass.
- [ ] Run:

```bash
pnpm --filter @drift/cli typecheck
pnpm --filter @drift/cli test -- --runInBand
cargo test -p drift-engine
```

Expected: CLI and Rust engine tests pass.

### Task 7: Check, Diff, Baseline, And Rule Evaluation

**Files:**
- Modify: `packages/cli/src/commands/check.ts`
- Create: `packages/cli/src/check/run-check.ts`
- Create: `packages/cli/src/check/diff.ts`
- Create: `packages/cli/src/check/finding-fingerprint.ts`
- Create: `packages/cli/src/check/rule-evaluation.ts`
- Create: `packages/cli/src/check/waivers.ts`
- Create: `packages/cli/src/domain/baselines.ts`

- [ ] Move `runCheck`, `runFullRepoCheck`, and `expireFindingsForExpiredConventions` into `check/run-check.ts`.
- [ ] Move `loadDiff`, `parseUnifiedDiff`, `fullRepoDiff`, `diffStatusFor`, `normalizeDiffPath`, and `parseHunkStart` into `check/diff.ts`.
- [ ] Move `findingFingerprint`, `baselineScanManifest`, `baselineViolationKey`, and baseline helpers into `check/finding-fingerprint.ts` and `domain/baselines.ts`.
- [ ] Move rule helpers such as `isForbiddenImport`, `isApiRoutePath`, `isActiveConvention`, and `enforcementResultFor` into `check/rule-evaluation.ts`.
- [ ] Move convention exception and waiver helpers into `check/waivers.ts`.
- [ ] Run:

```bash
pnpm --filter @drift/cli typecheck
pnpm --filter @drift/cli test -- --runInBand
cargo test -p drift-engine
```

Expected: CLI and Rust engine tests pass.

### Task 8: Product Domain Modules And Final Cleanup

**Files:**
- Modify: command modules
- Create remaining `domain/*.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] Move contract materialization helpers into `domain/contract-materialization.ts`.
- [ ] Move convention candidate inference helpers into `domain/convention-candidates.ts`.
- [ ] Move preflight relevance helpers into `domain/preflight.ts`.
- [ ] Move repo map helpers into `domain/repo-map.ts`.
- [ ] Move policy context helpers into `domain/policy-context.ts`.
- [ ] Move backup artifact helpers into `domain/backup-artifacts.ts`.
- [ ] Move restore review helpers into `domain/restore-review.ts`.
- [ ] Move audit review helpers into `domain/audit-review.ts`.
- [ ] Move scan status helpers into `domain/scan-status.ts`.
- [ ] Confirm `packages/cli/src/index.ts` is under 10 lines and exports public API only.
- [ ] Run full verification:

```bash
pnpm verify:ci
```

Expected: typecheck, build, package tests, Rust tests, e2e tests, and `git diff --check` all pass.

## Acceptance Criteria

- `packages/cli/src/index.ts` is a public API shim only.
- `packages/cli/src/main.ts` remains the binary entrypoint only.
- No command behavior changes.
- No JSON shape changes.
- No help text changes except approved no-approval/read-only wording.
- All command families live under `commands/`.
- Shared pure logic lives under `domain/`, `engine/`, `check/`, `args/`, `formatters/`, or `io/`.
- `pnpm verify:ci` passes.
- Future parser and graph work can land under `engine/`, `check/`, and later `packages/core` without editing a 9k-line CLI file.

## What Not To Do In This Extraction

- Do not change parser behavior.
- Do not add graph tables.
- Do not rename CLI commands.
- Do not change JSON response contracts.
- Do not add dependency injection frameworks.
- Do not introduce a CLI framework such as Commander or Yargs yet.
- Do not move business logic into `main.ts` or `index.ts`.

## Agent Handoff Prompt

Use this prompt when handing the work to another agent:

```text
You are working in /Users/geoffreyfernald/Downloads/driftv3.

Your job is to refactor the Drift CLI monolith into the module structure described in docs/superpowers/plans/2026-05-21-cli-monolith-extraction.md.

This project matters. Treat it like production infrastructure for a product that must scale into a serious business. Your goal is not to make the file tree look nicer. Your goal is to create a maintainable command/control plane so Drift can grow parsers, graph intelligence, MCP, policy, backup/restore, and agent preflight without collapsing into a 20k-line CLI file.

Read these files first:
- AGENTS.md
- docs/superpowers/plans/2026-05-21-cli-monolith-extraction.md
- docs/architecture/plan-review-synthesis.md
- docs/architecture/engine-api-contract.md
- docs/architecture/agent-response-contract.md
- packages/cli/src/index.ts
- packages/cli/src/main.ts
- packages/cli/test/cli.test.ts
- test/e2e/golden.test.ts
- test/e2e/installed-flow.test.ts

Non-negotiable constraints:
- Preserve every CLI command name.
- Preserve JSON output shapes.
- Preserve existing help behavior except already-approved no-approval/read-only wording.
- Preserve local-first behavior.
- Do not add parser features.
- Do not add graph schema.
- Do not introduce Commander, Yargs, or a dependency-injection framework.
- Do not move business logic into main.ts or index.ts.
- Do not create sideways imports between command modules.
- Any multi-row governance mutation must stay wrapped in storage.transaction().
- No command module may import another command module.
- Formatters must not read storage, git, filesystem, or environment state.
- Domain modules must not import CLI parsing helpers.

Implementation approach:
1. Execute the plan task-by-task in order.
2. Keep each task behavior-preserving.
3. Prefer mechanical moves over clever rewrites.
4. After each task, run:
   pnpm --filter @drift/cli typecheck
   pnpm --filter @drift/cli test -- --runInBand
5. After engine/check tasks, also run:
   cargo test -p drift-engine
6. At the end, run:
   pnpm verify:ci

Refactor target:
- packages/cli/src/index.ts should become a public API shim only:
  export { runCli } from "./app/run-cli.js";
  export type { CliResult } from "./app/command-types.js";
- packages/cli/src/main.ts should remain the binary entrypoint only.
- Command coordination should live under packages/cli/src/commands/.
- App shell/router/output should live under packages/cli/src/app/.
- Argument parsing/help should live under packages/cli/src/args/.
- Product logic should live under packages/cli/src/domain/.
- Scan/Rust/TS fallback should live under packages/cli/src/engine/.
- Diff/check/rule evaluation should live under packages/cli/src/check/.
- Human output should live under packages/cli/src/formatters/.
- Git/json/file helpers should live under packages/cli/src/io/.

Quality bar:
- If a move causes circular imports, stop and fix the boundary instead of patching around it.
- If a command needs logic from another command, move that logic to domain/check/engine/io.
- If JSON shape changes, revert that part and preserve the existing contract.
- If a test fails, diagnose the actual behavior difference before editing tests.
- Do not update tests just to match a refactor unless the old test was checking private file layout.

Definition of done:
- packages/cli/src/index.ts is under 10 lines and exports only public API.
- Every command family has its own module.
- Shared logic is extracted into domain/check/engine/args/formatters/io.
- No command-to-command imports exist.
- No formatter imports storage or filesystem helpers.
- CLI typecheck passes.
- CLI test suite passes.
- Rust engine tests pass.
- E2E installed package tests pass.
- pnpm verify:ci passes.
- git diff --check passes.
- Final report lists files created, modules moved, any behavior intentionally left unchanged, and exact verification commands/results.
```
