# Engine Binary Current State

Last inspected: 2026-05-22

This documents the current engine execution path after the hardening and first packaged-binary pass. It is descriptive only.

## Current execution path

### `drift scan`

1. CLI routing reaches `packages/cli/src/commands/scan.ts`, which calls `runScanRepo`.
2. `runScanRepo` in `packages/cli/src/domain/scan-status.ts` creates a scan id, writes a `scan_started` audit event, and calls `collectScanData`.
3. `collectScanData` in `packages/cli/src/engine/collect-scan-data.ts` tries Rust first through `collectScanDataFromRust`.
4. `collectScanDataFromRust` calls `streamRustEngineLines` with:

   ```text
   scan-repo <repoRoot> --format jsonl --repo-id <repoId> --scan-id <scanId>
   ```

5. `streamRustEngineLines` resolves the binary, spawns it, streams stdout line by line, collects stderr, and rejects on start failure or non-zero exit.
6. Rust `crates/drift-engine/src/main.rs` handles `scan-repo`, walks indexable TS/JS files, emits JSONL stream events, and finishes with `scan_completed`.
7. TypeScript validates each event through `@drift/engine-contract`, requires a completed stream, maps file snapshots/facts/diagnostics/stats into Drift storage objects, then persists snapshots, facts, a fact graph artifact, candidate conventions, and audit completion metadata.

### `drift check`

1. CLI routing reaches `packages/cli/src/check/run-check.ts`.
2. `runCheck` resolves repo, contract, policy, scope, diff, baseline, and existing findings.
3. It calls `collectScanData` again for fresh facts. That scan uses the same Rust-first scan path above.
4. `runEngineOwnedDirectDataAccessCheck` filters active `api_route_no_direct_data_access` deterministic conventions, applies TypeScript-side waivers/exceptions, then calls `runEngineCheck`.
5. `runEngineCheck` builds an `engine.check.request.v1` payload and calls:

   ```text
   check-repo
   ```

   with the JSON request on stdin.

6. Rust `check-repo` reads stdin, deserializes `CheckRequest`, runs `check_command::check_repo`, serializes an `engine.check.result.v1` JSON object, and exits.
7. TypeScript validates the result through `parseEngineCheckResult`, maps engine findings back into Drift findings, preserves governance status where applicable, persists findings, then returns exit code `1` only when a new finding is both `new_in_diff` and `block`.

The TypeScript rule-evaluation block still exists in `run-check.ts`, but the current helper returns an object, so the engine-owned path is effectively the path for matching deterministic direct-data-access conventions.

## Engine resolution today

Resolution is centralized in `packages/cli/src/engine/rust-engine.ts`.

Order:

1. If `DRIFT_ENGINE_BIN` is set, validate that path and use it as an explicit override.
2. Otherwise, try to resolve the matching installed `@drift/engine-*` optional package.
3. If a package is found, read `engine-manifest.json`, validate platform/architecture, validate that the binary is package-owned, executable, and SHA-256 matched, then spawn that absolute path.
4. Otherwise, search upward from `dirname(fileURLToPath(import.meta.url))`.
5. The search succeeds only at a directory containing both `Cargo.toml` and `crates/drift-engine`.
6. If found, run:

   ```text
   cargo run --quiet -p drift-engine --
   ```

   with `cwd` set to the discovered workspace root.

7. If none resolve, return `undefined`; callers fail before running a scan/check.

Important detail: packaged optional dependency resolution now happens before the Cargo fallback. That makes normal npm installs work when the platform package is present, while keeping Cargo fallback useful only in source/dev checkout layouts.

## Fail-closed behavior that exists

- Missing engine resolution fails before scan/check execution with a clear Rust-engine-unavailable error.
- A configured but missing `DRIFT_ENGINE_BIN` fails because process spawn fails.
- A Rust process that exits non-zero rejects and includes the last stderr lines.
- `collectScanData` rethrows Rust scan failure unless `DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK=1` is explicitly set.
- `runScanRepo` records a failed scan manifest and `scan_failed` audit event, then rethrows.
- Stream parsing rejects malformed JSON or schema-invalid stream events.
- Stream collection rejects if no `scan_completed` event appears.
- Check output is parsed through the engine contract before use.
- Rust command parsing fails on missing repo root, invalid `--format`, unknown scan options, invalid JSON stdin, and unknown top-level command.
- The bridge test explicitly covers that the CLI does not silently resolve a TypeScript scanner fallback when no Cargo workspace exists, and that a missing configured engine fails without the fallback env.

## Fail-open or soft spots still present

- `DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK=1` allows scan data collection to fall back to the TypeScript walker/extractor after Rust scan failure. This is dev compatibility, not production hardening.
- That fallback only covers scan collection. `check-repo` still needs the Rust engine for the engine-owned check path.
- `DRIFT_ENGINE_BIN` is prevalidated for existence, regular-file shape, executable bit on POSIX, and hashability before spawn.
- Rust `check_command` drops unknown fact kinds and unknown baseline statuses with `filter_map`.
- Rust `check_command` treats unknown diff modes as `changed-hunks`.
- Rust `check_command` treats unknown enforcement modes as `off`.
- Rust scan skips files over `MAX_FILE_BYTES` with diagnostics instead of failing the scan. That is probably intentional bounded behavior, but it is not fail-closed blocking behavior.

## Where `DRIFT_ENGINE_BIN` is required

`DRIFT_ENGINE_BIN` is required today only when neither a matching packaged engine optional dependency nor the monorepo Cargo workspace can be found.

That means:

- normal packaged npm installs should not need it when the matching `@drift/engine-*` package is installed;
- installed e2e tests no longer inject it for the default flow;
- consumers who install with optional dependencies omitted still need either a reinstall with optional dependencies or a trusted `DRIFT_ENGINE_BIN` override.

`test/e2e/installed-flow.test.ts` now proves the env-free packaged path for the current platform. It installs the current platform engine tarball alongside `@drift/cli`, unsets `DRIFT_ENGINE_BIN`, and runs installed `drift scan`.

## Where cargo workspace fallback is used

Cargo fallback is used only when `DRIFT_ENGINE_BIN` is absent and `findCargoWorkspaceRoot` can walk from the CLI module path to a directory with:

```text
Cargo.toml
crates/drift-engine
```

In this checkout, source/dev execution can use:

```text
cargo run --quiet -p drift-engine -- <engine args>
```

This is a development fallback. It assumes Cargo is installed, the Rust source exists, and the CLI package lives under the repository tree. It is not a packaged production binary strategy.

## Rust command behavior

`crates/drift-engine/src/main.rs` exposes two command families:

- `scan-repo <repo-root> [--format json|jsonl] [--repo-id <id>] [--scan-id <id>]`
- `check-repo`

`scan-repo`:

- defaults to pretty JSON unless `--format jsonl` is passed;
- walks recursively with `should_index_path`;
- indexes `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs`;
- skips files above `MAX_FILE_BYTES` from `protocol.rs`;
- hashes file contents in chunks;
- extracts TypeScript/JavaScript facts;
- emits `scan_started`, `diagnostic_batch`, `file_snapshot_batch`, `fact_batch`, and `scan_completed`.

`check-repo`:

- reads the full JSON request from stdin;
- currently consumes scan facts, conventions, baseline, and diff files;
- only executes `api_route_no_direct_data_access` conventions with `enforcement_capability: "deterministic_check"` and enforcement mode not `off`;
- materializes direct-data-access findings;
- classifies them against baseline and diff scope;
- emits `engine.check.result.v1`.

## Missing for full packaged production installs

The current repo now has the first packaged-binary path for macOS arm64, but not the full release matrix.

Missing pieces:

- CI-built binary packages for every declared target;
- release workflow that builds/checksums/publishes every `@drift/engine-*` package;
- binary version/contract handshake exposed in `doctor` / `version`;
- release hygiene check that every declared platform package has a release-produced artifact;
- production answer for Linux/Windows targets before those packages are published as real artifacts.

Current production truth: the macOS arm64 packaged smoke can run without `DRIFT_ENGINE_BIN`; the full multi-platform production release story is still pending CI/release automation.

## Files likely needing changes for production packaging

Likely code/config changes:

- `packages/cli/src/engine/rust-engine.ts`: add bundled/platform binary resolution before or after `DRIFT_ENGINE_BIN`, add explicit executable validation, and keep cargo fallback as dev-only.
- `packages/cli/package.json`: include binary assets or add optional platform package dependencies/scripts; update `files` beyond `dist` if bundling inside the CLI package.
- `package.json`: add release/build scripts for Rust engine artifacts if packaging remains monorepo-driven.
- `crates/drift-engine/Cargo.toml`: ensure binary metadata/release naming is stable for packaged artifact builds.
- `crates/drift-engine/src/main.rs`: likely add a cheap `--version` or health/handshake command for resolver validation.
- `crates/drift-engine/src/protocol.rs` and `packages/engine-contract/src/index.ts`: update only if the startup handshake or binary compatibility protocol becomes versioned.
- `test/e2e/installed-flow.test.ts`: remove the mandatory `DRIFT_ENGINE_BIN` injection for the production install case and assert env-free scan/check execution.
- `test/e2e/package-pack.test.ts`: assert packed output includes the engine artifact or platform resolver package metadata.
- `test/e2e/release-hygiene.test.ts`: assert production packaging cannot pass without an engine distribution path.

Likely docs changes after implementation:

- `docs/architecture/engine-api-contract.md`
- `docs/architecture/release-compatibility-policy.md`
- package READMEs for install/runtime requirements

## Current bottom line

The hardened bridge now fails closed by default when Rust is unavailable, validates streamed scan events and check results, and makes the Rust path authoritative for scan collection and direct-data-access checks.

It is still a dev/workspace binary story, not a production packaged binary story. Outside the monorepo, `DRIFT_ENGINE_BIN` is the current runtime contract.
