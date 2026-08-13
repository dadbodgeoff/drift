# Engine Binary Install Test Plan

Date: 2026-05-22
Status: test design only

## Goal

Prove a user can install Drift and run:

```bash
drift scan --repo-root <repo> --state-root <state> --json
```

without setting `DRIFT_ENGINE_BIN`.

This document only defines the test plan. Do not edit tests or production code as part of this doc change.

## Current Test Baseline

Current coverage is close but does not prove the install promise.

- `test/e2e/installed-flow.test.ts` packs all workspace packages, installs them into a clean consumer project, and runs installed `drift scan`, but its installed CLI helper always injects `DRIFT_ENGINE_BIN=target/debug/drift-engine`.
- `test/e2e/package-pack.test.ts` proves packages are dist-only and that `@drift/cli` exposes `drift` from `dist/main.js`, but it does not prove the Rust engine binary or engine manifest is included in the packed package.
- `packages/cli/test/engine-bridge.test.ts` already proves two important defaults: no silent TypeScript scanner fallback when no Rust engine is available, and a configured bad `DRIFT_ENGINE_BIN` fails closed.

The missing proof is: a fresh installed package must resolve and run its packaged Rust engine binary by default.

## Target Engine Resolution Contract

For any command path that requires the Rust engine, resolution must be deterministic:

1. If `DRIFT_ENGINE_BIN` is set, use exactly that path.
2. Otherwise, use the packaged engine binary matching `process.platform` and `process.arch`.
3. Verify the packaged binary before spawn:
   - manifest entry exists for the current platform and architecture
   - binary file exists
   - binary platform and architecture match the manifest
   - POSIX binary is executable
   - SHA-256 checksum matches the manifest
4. If running from the local Drift workspace and no packaged binary is available, use the Cargo fallback: `cargo run --quiet -p drift-engine --`.
5. Outside the Drift workspace, never use Cargo fallback.
6. Do not silently fall back to the TypeScript scanner. `DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK=1` remains development compatibility only and must not be present in installed-package smoke tests.

## Expected Output Contract

All e2e scan tests should run with `--json` so stdout is machine-checkable.

Failure output stays plain stderr for now because `runCli` currently catches errors and returns `stdout: ""`, `stderr: "<message>\n"`, `exitCode: 1`.

| Scenario | Exit code | Stdout | Stderr |
| --- | ---: | --- | --- |
| Installed package smoke, no `DRIFT_ENGINE_BIN` | `0` | JSON scan payload | empty string |
| Missing packaged binary | `1` | empty string | one line matching `Drift Rust engine is unavailable: no packaged engine binary found for <platform>-<arch>. Reinstall @drift/cli or set DRIFT_ENGINE_BIN to a trusted drift-engine binary.` |
| Wrong-platform packaged binary | `1` | empty string | one line matching `Drift Rust engine platform mismatch: packaged binary is <binary-platform>-<binary-arch>, current runtime is <platform>-<arch>.` |
| Non-executable packaged binary | `1` | empty string | one line matching `Drift Rust engine is not executable: <path>. Reinstall @drift/cli or fix executable permissions.` |
| Corrupted packaged binary or checksum mismatch | `1` | empty string | one line matching `Drift Rust engine checksum mismatch: expected <sha256>, got <sha256> for <path>. Reinstall @drift/cli.` |
| `DRIFT_ENGINE_BIN` valid override | `0` | JSON scan payload | empty string |
| `DRIFT_ENGINE_BIN` invalid override | `1` | empty string | one line matching `DRIFT_ENGINE_BIN is invalid: <reason>.` |
| Offline install smoke | `0` | JSON scan payload | empty string |
| Local workspace Cargo fallback | `0` | JSON scan payload | empty string |

Successful scan payload assertions:

```ts
expect(result.stderr).toBe("");
expect(result.exitCode).toBe(0);
expect(payload.summary).toMatchObject({
  files_indexed: 1,
  files_skipped: 0,
  engine_source: "rust"
});
expect(payload.scan.status).toBe("completed");
expect(payload.candidates.map((candidate) => candidate.kind))
  .toContain("api_route_no_direct_data_access");
expect(payload.database_path).toBe(expectedDatabasePath(repoRoot, stateRoot));
```

Failure assertions should not snapshot temp paths. Match the stable prefix, platform tuple, checksum shape, and remediation text.

## Test Placement

### `test/e2e/package-pack.test.ts`

Purpose: prove the install artifact contains everything needed to run on the current platform without a workspace.

Add package assertions for `@drift/cli`:

- packed files include `dist/main.js`
- packed files include the engine manifest, for example `dist/engines/manifest.json`
- packed files include the current platform engine binary, for example `dist/engines/<platform>-<arch>/drift-engine`
- manifest contains exactly one current-platform entry, unless the release strategy intentionally ships multiple platforms
- manifest entry includes:
  - `platform`
  - `arch`
  - relative binary path
  - `sha256`
  - engine version
- manifest checksum equals the actual packed binary checksum
- POSIX packed binary has at least one executable bit
- packed package still excludes `src/`, `test/`, and `tsconfig.json`
- no workspace protocol dependencies remain in the packed manifest

This test should fail if a package can install the CLI JavaScript but not the engine.

### `test/e2e/installed-flow.test.ts`

Purpose: prove user-visible install behavior.

Keep the existing installed flow that uses `DRIFT_ENGINE_BIN` as an override smoke, but add a separate default-installed scan smoke that deletes both:

- `DRIFT_ENGINE_BIN`
- `DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK`

The default-installed scan test should:

1. Pack `@drift/core`, `@drift/engine-contract`, `@drift/storage`, `@drift/cli`, and `@drift/mcp`.
2. Install those tarballs into a clean temp consumer.
3. Copy `test/fixtures/next-api-direct-db` into the temp area.
4. Run installed `node_modules/.bin/drift scan --repo-root <fixture> --state-root <state> --now 2026-05-10T00:00:00.000Z --json`.
5. Assert the success output contract above.
6. Assert the process did not need `cargo` by running with a restricted `PATH` that keeps Node/npm available but excludes Cargo.

Add a separate override test:

1. Delete or hide the packaged engine binary in the installed package.
2. Build the workspace engine with `cargo build -p drift-engine`.
3. Run installed `drift scan` with `DRIFT_ENGINE_BIN=<workspace>/target/debug/drift-engine`.
4. Assert success output and `engine_source: "rust"`.

Add an offline install smoke:

1. Prime an npm cache for external runtime dependencies such as `better-sqlite3` and `zod`.
2. Pack local Drift tarballs.
3. Install from local tarballs with npm offline mode and with `DRIFT_ENGINE_BIN` unset.
4. Run installed `drift scan`.
5. Assert success output.

This proves the engine binary is shipped as a package artifact, not fetched through a postinstall download or borrowed from the developer workspace.

### `packages/cli/test/engine-bridge.test.ts`

Purpose: prove resolver and bridge failure behavior in small, controlled fixtures.

Add resolver-level unit tests for:

- missing packaged binary outside a Drift workspace returns or throws the stable unavailable error
- wrong-platform manifest entry is rejected before spawn
- non-executable packaged binary is rejected before spawn on POSIX
- checksum mismatch is rejected before spawn
- valid `DRIFT_ENGINE_BIN` wins over packaged binary
- invalid `DRIFT_ENGINE_BIN` fails closed and does not fall back to packaged binary
- local Drift workspace without packaged binary resolves to `cargo run --quiet -p drift-engine --`
- non-workspace installed consumer with its own unrelated `Cargo.toml` does not get Cargo fallback

Keep the existing tests that prove:

- no silent TypeScript scanner fallback
- configured bad engine path fails closed
- malformed engine stream output is rejected
- incomplete engine streams are rejected

## Scenario Details

### Installed Package Smoke Behavior

Test name:

```ts
it("runs installed drift scan without DRIFT_ENGINE_BIN")
```

Environment:

```ts
env: {
  ...process.env,
  DRIFT_ENGINE_BIN: undefined,
  DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK: undefined
}
```

Expected:

- exit code `0`
- stderr `""`
- stdout JSON payload with `summary.engine_source === "rust"`
- fixture finding kind includes `api_route_no_direct_data_access`
- no Cargo dependency in `PATH`

### Missing Binary Error Behavior

Setup:

- install the package
- remove the packaged engine binary or remove the current-platform manifest entry
- keep `DRIFT_ENGINE_BIN` unset
- run outside the Drift workspace

Expected:

- exit code `1`
- stdout `""`
- stderr matches the missing binary row in the output table
- no TypeScript fallback scan result is produced
- if scan state is written before failure, latest scan status is `failed` with the same error message

### Wrong-Platform Binary Behavior

Setup:

- create a temp packaged-engine manifest that points to a binary marked for a different `platform` or `arch`
- keep `DRIFT_ENGINE_BIN` unset
- run resolver or installed scan from outside the Drift workspace

Expected:

- exit code `1` for CLI e2e, or thrown resolver error for unit test
- stdout `""`
- stderr names both the binary platform tuple and the current runtime tuple
- error happens before spawning the binary

### Non-Executable Binary Behavior

Setup:

- POSIX only: install the package, then `chmod 0644` the packaged engine binary
- keep checksum otherwise valid if the test mutates only mode
- keep `DRIFT_ENGINE_BIN` unset

Expected:

- exit code `1`
- stdout `""`
- stderr matches the non-executable row in the output table
- skip this e2e on Windows, or cover Windows through resolver unit tests that simulate metadata

### Corrupted Binary And Checksum Behavior

Setup:

- install the package
- mutate the packaged engine binary after install, for example append bytes
- keep `DRIFT_ENGINE_BIN` unset

Expected:

- exit code `1`
- stdout `""`
- stderr matches the checksum mismatch row in the output table
- error happens before spawning the binary

This test is stronger than a fake binary that exits nonzero. It proves Drift detects tampering before execution.

### `DRIFT_ENGINE_BIN` Override Behavior

Valid override setup:

- install the package
- hide or corrupt the packaged engine binary
- set `DRIFT_ENGINE_BIN` to `target/debug/drift-engine`
- run installed `drift scan`

Expected:

- exit code `0`
- stderr `""`
- stdout JSON payload with `summary.engine_source === "rust"`

Invalid override setup:

- set `DRIFT_ENGINE_BIN` to a missing file, non-executable file, or wrong binary
- leave a valid packaged engine in place

Expected:

- exit code `1`
- stdout `""`
- stderr starts with `DRIFT_ENGINE_BIN is invalid:`
- packaged engine is not used as fallback because an explicit override should be authoritative

### Offline Install Behavior

Setup:

- pack all Drift workspace packages into tarballs
- prime npm cache for non-Drift runtime dependencies
- install using local tarballs and npm offline mode
- unset `DRIFT_ENGINE_BIN`
- exclude Cargo from `PATH`

Expected:

- install succeeds without network access
- `drift scan` exits `0`
- stderr `""`
- stdout JSON payload proves Rust engine execution
- no postinstall engine download is required

### Local Workspace Cargo Fallback Behavior

Setup:

- run from the Drift source workspace after `pnpm build`
- ensure no packaged engine binary is available in `packages/cli/dist`
- unset `DRIFT_ENGINE_BIN`
- run `node packages/cli/dist/main.js scan --repo-root <fixture> --state-root <state> --json`

Expected:

- resolver returns:

```ts
{
  command: "cargo",
  args: ["run", "--quiet", "-p", "drift-engine", "--"],
  cwd: "<workspace-root>"
}
```

- scan exits `0`
- stderr `""`
- stdout JSON payload has `summary.engine_source === "rust"`

Negative fallback test:

- create an installed consumer fixture that has its own unrelated `Cargo.toml`
- keep `DRIFT_ENGINE_BIN` unset
- remove packaged engine binary

Expected:

- no Cargo fallback
- missing packaged binary error

## Required Verification Commands After Tests Are Implemented

Run targeted tests first:

```bash
pnpm vitest run packages/cli/test/engine-bridge.test.ts
pnpm vitest run test/e2e/package-pack.test.ts --no-file-parallelism --maxWorkers=1
pnpm vitest run test/e2e/installed-flow.test.ts --no-file-parallelism --maxWorkers=1
```

Then run the release gate:

```bash
pnpm verify:ci
```

## Acceptance Criteria

The test work is complete when:

- installed `drift scan` succeeds without `DRIFT_ENGINE_BIN`
- installed `drift scan` succeeds without Cargo on `PATH`
- packaged binary presence, manifest, executable bit, and checksum are tested
- missing, wrong-platform, non-executable, and checksum mismatch failures are stable and actionable
- explicit `DRIFT_ENGINE_BIN` override still works
- invalid `DRIFT_ENGINE_BIN` fails closed and does not fall back
- offline install works from local package artifacts
- local source workspace still supports Cargo fallback for development
- installed consumers never accidentally use Cargo fallback
- all successful scan tests report `summary.engine_source: "rust"`
