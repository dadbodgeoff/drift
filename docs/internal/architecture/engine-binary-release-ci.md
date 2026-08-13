# Engine Binary Release CI

Date: 2026-05-22

## Purpose

Drift's npm CLI must install with a Rust engine binary that works without a local Rust toolchain. The release path should build deterministic `drift-engine` binaries, publish one platform package per supported target, then publish `@drift/cli` with exact optional dependencies on those platform packages.

This document defines the required CI/release shape. It does not implement runtime code.

## Distribution Model

Use platform-specific npm packages instead of a postinstall download.

`@drift/cli` should publish JavaScript only and declare exact-version `optionalDependencies` for the binary packages. Each binary package contains one executable and platform metadata:

- `@drift/engine-darwin-arm64`
- `@drift/engine-darwin-x64`
- `@drift/engine-linux-x64-gnu`
- `@drift/engine-linux-arm64-gnu`
- `@drift/engine-win32-x64`

The CLI engine resolver should use this order:

1. `DRIFT_ENGINE_BIN`, for explicit local override and emergency operator override.
2. Installed matching `@drift/engine-*` optional dependency.
3. Source checkout fallback through `cargo run -p drift-engine`, only when a Cargo workspace is found.

Installed npm packages must not rely on network downloads, postinstall compilation, or a local Cargo workspace. If the binary package is absent, the CLI should fail with a direct remediation message instead of silently using the TypeScript fallback.

## Target Matrix

| Platform | Rust target triple | GitHub runner | npm package | Release asset |
| --- | --- | --- | --- | --- |
| macOS arm64 | `aarch64-apple-darwin` | `macos-15` | `@drift/engine-darwin-arm64` | `drift-engine-v${VERSION}-aarch64-apple-darwin.tar.gz` |
| macOS x64 | `x86_64-apple-darwin` | `macos-15-intel` | `@drift/engine-darwin-x64` | `drift-engine-v${VERSION}-x86_64-apple-darwin.tar.gz` |
| Linux x64 glibc | `x86_64-unknown-linux-gnu` | `ubuntu-24.04` | `@drift/engine-linux-x64-gnu` | `drift-engine-v${VERSION}-x86_64-unknown-linux-gnu.tar.gz` |
| Linux arm64 glibc | `aarch64-unknown-linux-gnu` | `ubuntu-24.04-arm` | `@drift/engine-linux-arm64-gnu` | `drift-engine-v${VERSION}-aarch64-unknown-linux-gnu.tar.gz` |
| Windows x64 | `x86_64-pc-windows-msvc` | `windows-2025` | `@drift/engine-win32-x64` | `drift-engine-v${VERSION}-x86_64-pc-windows-msvc.zip` |

Linux artifacts are `gnu` artifacts. Do not imply Alpine or musl support until a `*-unknown-linux-musl` build is added and smoke-tested separately.

Each npm binary package should contain:

```text
package.json
README.md
bin/drift-engine
```

Windows uses:

```text
package.json
README.md
bin/drift-engine.exe
```

The package metadata should include the matching `os`, `cpu`, and Linux `libc` fields:

| npm package | `os` | `cpu` | `libc` |
| --- | --- | --- | --- |
| `@drift/engine-darwin-arm64` | `["darwin"]` | `["arm64"]` | none |
| `@drift/engine-darwin-x64` | `["darwin"]` | `["x64"]` | none |
| `@drift/engine-linux-x64-gnu` | `["linux"]` | `["x64"]` | `["glibc"]` |
| `@drift/engine-linux-arm64-gnu` | `["linux"]` | `["arm64"]` | `["glibc"]` |
| `@drift/engine-win32-x64` | `["win32"]` | `["x64"]` | none |

## GitHub Actions Workflow

Create a dedicated release workflow, separate from normal CI:

```yaml
name: engine-binary-release

on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      version:
        required: true
        type: string
      dry_run:
        required: true
        type: boolean
        default: true

permissions:
  contents: write
  id-token: write

concurrency:
  group: engine-binary-release-${{ github.ref }}
  cancel-in-progress: false
```

Workflow jobs:

1. `preflight`
   - Check out the exact tag.
   - Install Node 22, pnpm 10.28.0, and stable Rust.
   - Run `pnpm install --frozen-lockfile`.
   - Run `pnpm verify:ci`.
   - Assert the tag version matches every publishable package and `cargo metadata` for `drift-engine`.
   - Refuse dirty generated files after build.

2. `build-engine`
   - Matrix over the five target triples.
   - Run `rustup target add ${{ matrix.target }}`.
   - Run `cargo build --locked --release -p drift-engine --target ${{ matrix.target }}`.
   - Run the built binary on the native runner with `--help` and a small fixture scan.
   - Package the executable into the exact release asset name.
   - Generate a per-asset SHA-256 file.
   - Upload the release asset, checksum, and npm package staging directory as workflow artifacts.

3. `assemble-checksums`
   - Download all binary assets.
   - Recompute SHA-256 checksums from the downloaded assets.
   - Write canonical `SHA256SUMS`.
   - Verify every per-asset checksum matches `SHA256SUMS`.

4. `pack-binary-npm-packages`
   - Download the binary package staging directories.
   - Write or verify package manifests for the five `@drift/engine-*` packages.
   - Assert the package version equals `${VERSION}`.
   - Assert the embedded binary's checksum equals the release asset checksum.
   - Run `npm pack --json` for each binary package.

5. `pack-cli`
   - Build `@drift/cli`.
   - Verify its `optionalDependencies` point to the exact `${VERSION}` of every `@drift/engine-*` package.
   - Pack `@drift/cli`.

6. `registry-smoke`
   - Publish the packed packages to a local registry such as Verdaccio.
   - Install `@drift/cli@${VERSION}` into a clean temp project from that registry.
   - Leave `DRIFT_ENGINE_BIN` unset.
   - Run smoke tests on the installed CLI.
   - Verify the resolved engine source is the bundled optional dependency, not Cargo and not an env override.

7. `publish`
   - Publish binary packages first.
   - Publish `@drift/cli` last.
   - Use npm provenance.
   - Publish under a staging dist-tag first, for example `next` or `rc`.
   - Promote all packages to `latest` only after post-publish install smoke passes from the real npm registry.

8. `github-release`
   - Create the GitHub release after npm smoke passes.
   - Attach all five binary assets, five `.sha256` files, and `SHA256SUMS`.

The matrix should be explicit:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - os: macos-15
        target: aarch64-apple-darwin
        npm_package: "@drift/engine-darwin-arm64"
        binary_name: drift-engine
        archive_ext: tar.gz
      - os: macos-15-intel
        target: x86_64-apple-darwin
        npm_package: "@drift/engine-darwin-x64"
        binary_name: drift-engine
        archive_ext: tar.gz
      - os: ubuntu-24.04
        target: x86_64-unknown-linux-gnu
        npm_package: "@drift/engine-linux-x64-gnu"
        binary_name: drift-engine
        archive_ext: tar.gz
      - os: ubuntu-24.04-arm
        target: aarch64-unknown-linux-gnu
        npm_package: "@drift/engine-linux-arm64-gnu"
        binary_name: drift-engine
        archive_ext: tar.gz
      - os: windows-2025
        target: x86_64-pc-windows-msvc
        npm_package: "@drift/engine-win32-x64"
        binary_name: drift-engine.exe
        archive_ext: zip
```

Pin runner labels. Do not use `*-latest` labels in release workflows.

## Artifact Names

Workflow artifact names:

```text
drift-engine-aarch64-apple-darwin
drift-engine-x86_64-apple-darwin
drift-engine-x86_64-unknown-linux-gnu
drift-engine-aarch64-unknown-linux-gnu
drift-engine-x86_64-pc-windows-msvc
```

GitHub release assets:

```text
drift-engine-v${VERSION}-aarch64-apple-darwin.tar.gz
drift-engine-v${VERSION}-aarch64-apple-darwin.tar.gz.sha256
drift-engine-v${VERSION}-x86_64-apple-darwin.tar.gz
drift-engine-v${VERSION}-x86_64-apple-darwin.tar.gz.sha256
drift-engine-v${VERSION}-x86_64-unknown-linux-gnu.tar.gz
drift-engine-v${VERSION}-x86_64-unknown-linux-gnu.tar.gz.sha256
drift-engine-v${VERSION}-aarch64-unknown-linux-gnu.tar.gz
drift-engine-v${VERSION}-aarch64-unknown-linux-gnu.tar.gz.sha256
drift-engine-v${VERSION}-x86_64-pc-windows-msvc.zip
drift-engine-v${VERSION}-x86_64-pc-windows-msvc.zip.sha256
SHA256SUMS
```

npm tarball names produced by `npm pack`:

```text
drift-engine-darwin-arm64-${VERSION}.tgz
drift-engine-darwin-x64-${VERSION}.tgz
drift-engine-linux-x64-gnu-${VERSION}.tgz
drift-engine-linux-arm64-gnu-${VERSION}.tgz
drift-engine-win32-x64-${VERSION}.tgz
drift-cli-${VERSION}.tgz
```

## Checksum Generation

Each build job should generate a checksum for the final compressed release asset, not just the raw executable.

Unix:

```bash
shasum -a 256 "drift-engine-v${VERSION}-${TARGET}.tar.gz" > "drift-engine-v${VERSION}-${TARGET}.tar.gz.sha256"
```

Linux may use `sha256sum`; macOS may use `shasum -a 256`. The canonical `SHA256SUMS` file should be generated in one assemble job after downloading every final asset, so the release has one complete manifest.

Windows:

```powershell
$hash = (Get-FileHash "drift-engine-v$env:VERSION-$env:TARGET.zip" -Algorithm SHA256).Hash.ToLower()
"$hash  drift-engine-v$env:VERSION-$env:TARGET.zip" | Out-File -Encoding ascii "drift-engine-v$env:VERSION-$env:TARGET.zip.sha256"
```

The publish job must verify:

- every release asset appears in `SHA256SUMS`
- every per-asset `.sha256` file matches `SHA256SUMS`
- every npm binary package embeds the same executable bytes used to produce the release asset
- no checksum is generated before compression and then reused for a compressed asset

## Version Alignment

Use one release version. The tag should be `v${VERSION}` and `${VERSION}` should match:

- root `package.json`
- `packages/cli/package.json`
- every public workspace package published with the CLI
- every `@drift/engine-*` package
- Cargo workspace package version for `drift-engine`
- the engine binary version reported by `drift-engine --version` or `drift-engine version --json`
- `drift version --json` runtime metadata

`@drift/cli` must depend on binary packages with exact versions:

```json
{
  "optionalDependencies": {
    "@drift/engine-darwin-arm64": "0.1.0",
    "@drift/engine-darwin-x64": "0.1.0",
    "@drift/engine-linux-x64-gnu": "0.1.0",
    "@drift/engine-linux-arm64-gnu": "0.1.0",
    "@drift/engine-win32-x64": "0.1.0"
  }
}
```

Do not use `^`, `~`, `workspace:*`, or `latest` for published binary package references.

The engine version should come from Cargo package metadata at build time. If a hard-coded Rust constant remains, CI must assert it equals the Cargo package version before building release assets.

## Installed Package Smoke Tests

Installed-package smoke must prove bundled engine resolution, not just command success.

Required conditions:

- install into a temp project outside the repository
- unset `DRIFT_ENGINE_BIN`
- run without a Cargo workspace above the temp project
- do not allow the TypeScript fallback unless the test explicitly covers fallback behavior
- run through `node_modules/.bin/drift`, not source files
- assert `drift version --json` reports the CLI version and resolved engine metadata
- assert `drift scan --json` reports `engine_source: "rust"`
- assert the resolved engine path lives under the installed `@drift/engine-*` package

The smoke should fail if:

- `DRIFT_ENGINE_BIN` is required for installed package tests
- the CLI falls back to `cargo run`
- the installed package omits the platform binary package
- npm installed the wrong platform package
- the binary lacks executable permissions on Unix
- the engine binary version differs from `@drift/cli`

Expected engine resolution metadata:

```json
{
  "engine": {
    "source": "bundled_optional_dependency",
    "package": "@drift/engine-darwin-arm64",
    "target": "aarch64-apple-darwin",
    "version": "0.1.0",
    "path": "/tmp/.../node_modules/@drift/engine-darwin-arm64/bin/drift-engine"
  }
}
```

## Failure Modes

| Failure | CI behavior | User-facing behavior |
| --- | --- | --- |
| Version skew between npm and Cargo | fail in `preflight` | no release |
| Missing target support or runner unavailable | fail target job | no release for that version |
| Binary builds but does not execute | fail matrix smoke | no release |
| Wrong binary package installed | fail installed smoke | no release |
| Optional dependencies omitted by installer | installed smoke covers default path; runtime error must explain `npm install` without `--omit=optional` or use `DRIFT_ENGINE_BIN` |
| Unsupported OS/CPU/libc | runtime error names supported packages and override path |
| Checksum mismatch | fail `assemble-checksums` or publish verification | no release |
| Unix executable bit missing | fail installed smoke | no release |
| Windows archive uses wrong executable name | fail Windows smoke | no release |
| Linux glibc too new for supported distro | fail distro compatibility smoke when added; otherwise mark the distro unsupported |
| Partial npm publish | do not promote `latest`; deprecate bad package versions if already published |
| GitHub release created before npm failure | keep release draft until npm smoke passes |
| Binary package published but CLI not published | keep binary packages on staging tag; publish fixed CLI or deprecate binaries |

## Rollback Plan

Use dist-tags as the rollback boundary.

1. Publish all packages with a staging tag such as `next`.
2. Install from the real npm registry using the staging tag.
3. Run installed-package smoke.
4. Promote every package to `latest` only after smoke passes.

If failure happens before `latest` promotion:

- leave the GitHub release as draft or delete the draft
- keep the failed npm versions off `latest`
- deprecate failed npm versions with a clear reason if they were published
- rerun with a patch version

If failure happens after `latest` promotion:

```bash
npm dist-tag add @drift/cli@${PREVIOUS_VERSION} latest
npm dist-tag add @drift/engine-darwin-arm64@${PREVIOUS_VERSION} latest
npm dist-tag add @drift/engine-darwin-x64@${PREVIOUS_VERSION} latest
npm dist-tag add @drift/engine-linux-x64-gnu@${PREVIOUS_VERSION} latest
npm dist-tag add @drift/engine-linux-arm64-gnu@${PREVIOUS_VERSION} latest
npm dist-tag add @drift/engine-win32-x64@${PREVIOUS_VERSION} latest
```

Then:

- mark the GitHub release as withdrawn or prerelease
- publish a patch version with the fix
- avoid unpublish except for a narrow registry emergency
- keep `@drift/cli` and all engine packages in lockstep versions

Do not publish a fixed engine under the same version. npm package contents are immutable after publish, and checksum history must stay truthful.

## Local Developer Workflow

Normal local development:

```bash
cargo build -p drift-engine
DRIFT_ENGINE_BIN="$PWD/target/debug/drift-engine" pnpm --filter @drift/cli test
pnpm verify:ci
```

Current-platform binary package rehearsal:

```bash
cargo build --release -p drift-engine
node scripts/package-current-engine.mjs --version 0.1.0 --out .release/engine
npm pack .release/engine/@drift/engine-<platform>
pnpm --filter @drift/cli pack --pack-destination .release
node scripts/smoke-installed-cli.mjs --registry local --version 0.1.0
```

The script names above are proposed release tooling. They should be implemented only when the binary package work starts.

Manual sanity checks before requesting a release:

```bash
git status --short
pnpm install --frozen-lockfile
pnpm verify:ci
cargo build --locked --release -p drift-engine
target/release/drift-engine --help
```

Do not run a release from a dirty worktree. Do not edit package versions by hand after tagging.

## Proposed Acceptance Tests

Do not implement these as part of this doc-only change. They are the acceptance suite for the future implementation.

1. `test/e2e/engine-version-alignment.test.ts`
   - Reads root `package.json`, `packages/cli/package.json`, all public package manifests, `Cargo.toml`, and `crates/drift-engine/Cargo.toml`.
   - Asserts every release version equals `0.1.0` or the injected test version.
   - Builds the engine and asserts `drift-engine --version --json` reports the same version.
   - Fails if published package manifests contain `workspace:*`, `^`, `~`, or `latest` for Drift packages.

2. `test/e2e/engine-binary-package-pack.test.ts`
   - Packs each `@drift/engine-*` package.
   - Extracts each tarball.
   - Asserts only `package.json`, `README.md`, and `bin/drift-engine` or `bin/drift-engine.exe` are included.
   - Asserts `os`, `cpu`, and Linux `libc` metadata match the target table.
   - Asserts Unix binaries are executable.

3. `test/e2e/cli-bundled-engine-resolution.test.ts`
   - Creates a temp consumer project outside the repo.
   - Installs `@drift/cli` and the current platform `@drift/engine-*` tarball.
   - Unsets `DRIFT_ENGINE_BIN`.
   - Runs `node_modules/.bin/drift version --json`.
   - Asserts `engine.source === "bundled_optional_dependency"`.
   - Asserts `engine.path` is under `node_modules/@drift/engine-*`.
   - Asserts no Cargo workspace fallback was used.

4. `test/e2e/installed-flow.test.ts` extension
   - Removes the current test dependency on `DRIFT_ENGINE_BIN` for the default installed flow.
   - Runs installed `drift doctor`, `drift scan`, `drift check`, and `drift version --json`.
   - Asserts scan/check payloads report `engine_source: "rust"`.
   - Keeps one separate test for explicit `DRIFT_ENGINE_BIN` override.

5. `test/e2e/engine-resolution-failure.test.ts`
   - Installs `@drift/cli` without optional dependencies.
   - Runs `drift scan --json`.
   - Asserts the command fails closed with a message naming the missing `@drift/engine-*` package and `DRIFT_ENGINE_BIN`.
   - Asserts it does not fall back to TypeScript by default.

6. `test/e2e/engine-checksum-release.test.ts`
   - Builds a current-platform release asset.
   - Generates `.sha256` and `SHA256SUMS`.
   - Recomputes hashes from disk.
   - Asserts the package manifest's embedded checksum equals the final release asset checksum.

7. `test/e2e/engine-release-workflow-hygiene.test.ts`
   - Reads the root-visible workflow at `../.github/workflows/engine-binary-release.yml`.
   - Asserts the five target triples are present.
   - Asserts `permissions` are explicit.
   - Asserts `id-token: write` is present for npm provenance.
   - Asserts no release job uses `macos-latest`, `ubuntu-latest`, or `windows-latest`.
   - Asserts a checksum assembly job exists before publish.
   - Asserts publish runs after registry smoke.

8. `test/e2e/local-registry-release-smoke.test.ts`
   - Starts a local registry.
   - Publishes the packed current-platform engine package and `@drift/cli`.
   - Installs `@drift/cli@${VERSION}` into a clean temp project from that registry.
   - Runs `drift scan --repo-root <fixture> --state-root <tmp> --json`.
   - Asserts the installed CLI resolves the bundled engine and produces the expected deterministic finding.

Required command before enabling publish:

```bash
pnpm verify:ci
pnpm vitest run test/e2e/engine-version-alignment.test.ts test/e2e/engine-binary-package-pack.test.ts test/e2e/cli-bundled-engine-resolution.test.ts test/e2e/engine-resolution-failure.test.ts test/e2e/engine-checksum-release.test.ts test/e2e/engine-release-workflow-hygiene.test.ts test/e2e/local-registry-release-smoke.test.ts --no-file-parallelism --maxWorkers=1
```

The release workflow should run the same acceptance set before real npm publish.
