# CI/CD Workflows

## Location
`.github/workflows/`

## Workflow Inventory

| File | Trigger | Purpose |
|------|---------|---------|
| `ci.yml` | push/PR to main | Build, test, publish check |
| `native-build.yml` | push/PR (crates/**), manual | Cross-platform Rust compilation |
| `release.yml` | manual dispatch | Version bump + npm publish |
| `drift-check.yml.template` | (template for users) | Pattern checking in user repos |

---

## ci.yml — Main CI Pipeline

### Trigger
- Push to `main`
- Pull requests to `main`

### Jobs

#### `build` (matrix: Node 18, 20, 22)
1. Checkout
2. Install pnpm 8
3. Setup Node.js (matrix version)
4. `pnpm install --frozen-lockfile`
5. `pnpm build` (excludes: cibench, galaxy, lsp, vscode — non-core)
6. `pnpm test` (filters: core, detectors, mcp only)

Note: Build and test both use `continue-on-error: true`. Lint is disabled (debt).

#### `publish-check` (main branch only)
- Runs after `build`
- Prints current versions of cli, core, detectors, mcp
- Gate for release readiness

---

## native-build.yml — Cross-Platform Rust Compilation

### Trigger
- Push to `main` (paths: `crates/**`)
- PR to `main` (paths: `crates/**`)
- Manual dispatch with optional publish version

### Build Matrix (5 targets)

| Host | Target | npm Directory |
|------|--------|---------------|
| macOS | `x86_64-apple-darwin` | `darwin-x64` |
| macOS | `aarch64-apple-darwin` | `darwin-arm64` |
| Windows | `x86_64-pc-windows-msvc` | `win32-x64-msvc` |
| Ubuntu | `x86_64-unknown-linux-gnu` | `linux-x64-gnu` |
| Ubuntu | `aarch64-unknown-linux-gnu` | `linux-arm64-gnu` |

### Build Steps
1. Checkout
2. Setup Node.js 20
3. Install Rust stable (with target)
4. `npm install` in `crates/drift-napi`
5. Run NAPI-RS build (with `--use-napi-cross` for Linux)
6. Move `.node` artifact to platform npm directory
7. Upload artifact

### Test Matrix (3 targets)
Tests on macOS arm64, Linux x64, Windows x64:
1. Download build artifact
2. Copy `.node` to root
3. Verify: `version()` and `supportedLanguages()` calls

### Publish Job (manual only)
1. Download all 5 artifacts
2. Update versions in all `package.json` files
3. Publish platform packages (`npm/darwin-x64/`, etc.)
4. Publish main `drift-native` package (with `--ignore-scripts`)

---

## release.yml — Package Release

### Trigger
Manual dispatch with inputs:
- `package`: cli | core | detectors | mcp | dashboard | all
- `version_bump`: patch | minor | major

### Steps
1. Checkout (full history)
2. Install pnpm 8 + Node 20
3. `pnpm install --frozen-lockfile`
4. `pnpm build`
5. `pnpm test`
6. Configure git (bot user)
7. Publish selected package(s) with npm provenance

### Publish Order (when "all")
1. `driftdetect-core`
2. `driftdetect-detectors`
3. `driftdetect-dashboard`
4. `driftdetect-mcp`
5. `driftdetect` (CLI)

---

## drift-check.yml.template — User Template

Template for users to add Drift pattern checking to their repos.

### Features
- `.drift` directory caching (hash-based)
- Full scan on push, incremental on PRs
- `drift gate --ci --format github` for quality gates
- Artifact upload of `.drift/` analysis data

---

## v2 Considerations
- `native-build.yml` is the template for v2 cross-compilation
- CI matrix should add Rust toolchain testing
- Release workflow needs to handle both npm + cargo publish
- Consider adding `cargo clippy` and `cargo fmt` checks
- Linux cross-compilation uses `napi-cross` Docker images — keep this pattern
