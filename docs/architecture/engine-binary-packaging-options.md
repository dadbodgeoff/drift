# Engine Binary Packaging Options

Date: 2026-05-21

## Goal

Ship the Rust `drift-engine` with the npm-distributed `@drift/cli` so normal users do not need `DRIFT_ENGINE_BIN`.

The CLI should still keep `DRIFT_ENGINE_BIN` as an explicit override for development, emergency patching, and enterprise-managed binaries. It should not be the default install path.

## Recommendation

V1 should use npm optional platform packages:

- `@drift/cli`
- `@drift/engine-darwin-arm64`
- `@drift/engine-darwin-x64`
- `@drift/engine-linux-x64-gnu`
- `@drift/engine-linux-arm64-gnu`
- `@drift/engine-win32-x64`

Add `linux-*-musl`, Windows arm64, and more targets only when CI builds and smoke tests them.

The CLI resolver should use this order:

1. `DRIFT_ENGINE_BIN`, if set.
2. The matching `@drift/engine-*` package for `process.platform`, `process.arch`, and Linux libc.
3. Workspace `cargo run -p drift-engine -- ...` only in a source checkout.
4. Fail closed with a specific install/target error.

Do not add a default postinstall network download for V1. Do not build from source for normal users.

## Pattern Comparison

| Pattern | Examples | Strengths | Weaknesses | Drift fit |
| --- | --- | --- | --- | --- |
| Single package with postinstall download | Prisma engines; older ripgrep wrappers; esbuild uses postinstall as validation/fallback | Small npm package, one public package name, can fetch exact artifact by platform | Runs install-time code, breaks with `--ignore-scripts`, fragile offline, must implement proxy/mirror/checksum behavior, harder for enterprise review | Avoid as default |
| Optional platform packages | esbuild, SWC, Biome, Rollup-style native packages, newer ripgrep wrapper direction | npm-native, no runtime network, works with npm proxies and internal registries, lockfile captures exact versions, users get only their platform binary in normal installs | More packages to publish, package-manager optional-dependency bugs exist, `--omit=optional` breaks install unless override is provided | Best V1 default |
| Bundle all binaries inside `@drift/cli` | Some CLI wrappers and standalone binary distributions | Simplest resolution, best air-gapped behavior once tarball is present, no optional dependency edge cases | Root package grows by every target binary, every user downloads every OS/CPU, painful upgrades, worse registry/cache footprint | Not V1 unless engine remains tiny and target count is very small |
| Build from source fallback | native addon/source fallback patterns; `cargo install` style | Covers unsupported platforms when toolchain is present | Requires Rust toolchain, C linker, OpenSSL/libc details, slow CI, frequent Windows/Linux support problems, bad first-run UX | Developer fallback only |
| GitHub release artifact download | Biome standalone binaries, ripgrep-prebuilt, Prisma mirrorable engines | Good for standalone installer, can attach checksums, signatures, SBOMs, and attestations | Not npm-native, blocked by many enterprises, GitHub rate limits, offline install fails unless separately mirrored | Later secondary channel |

## Source Notes

- esbuild publishes platform packages as optional dependencies and documents that `--ignore-scripts` and `--no-optional` affect native binary installation. Its package also has a postinstall script for validation/optimization and fallback behavior.
- SWC's `@swc/core` package uses optional native packages such as `@swc/core-linux-x64-gnu` and a postinstall script.
- Biome's `@biomejs/biome` package uses optional platform packages such as `@biomejs/cli-darwin-arm64` and publishes standalone release binaries for manual install.
- Prisma's `@prisma/engines` package downloads engines in postinstall. Prisma also documents proxy variables, `PRISMA_ENGINES_MIRROR`, custom engine locations, and checksum behavior.
- `@vscode/ripgrep` has used both binary download and npm-packaged binary strategies over time. Its current registry metadata is useful as a ripgrep-wrapper example, but Drift should not copy the postinstall-download shape for V1.

Registry size samples checked with `npm view` on 2026-05-21:

| Package | Unpacked size |
| --- | ---: |
| `esbuild` root | 146 KB |
| `@esbuild/linux-x64` | 11.4 MB |
| `@swc/core` root | 124 KB |
| `@swc/core-linux-x64-gnu` | 27.8 MB |
| `@biomejs/biome` root | 705 KB |
| `@biomejs/cli-linux-x64` | 56.0 MB |
| `@vscode/ripgrep` root | 4 KB |
| `@vscode/ripgrep-linux-x64` | 5.7 MB |
| `@prisma/engines` root before downloaded engines | 88 KB |

The important point is not the exact number. The platform-package pattern keeps the root package small and shifts binary weight to the one package the user actually needs.

## V1 Package Contract

`@drift/cli` should list every supported engine target as an exact-version optional dependency. Example shape, not an implementation change:

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

Each engine package should contain:

- one executable binary
- `package.json` with `os`, `cpu`, and Linux `libc` metadata where supported by the package manager
- `engine-manifest.json` with target triple, Drift version, engine protocol version, source commit, build workflow id, and binary SHA-256
- `LICENSE` and third-party notices if needed

The CLI should validate that the resolved engine reports the expected protocol version. A mismatched binary should fail closed instead of silently falling back to TypeScript.

## Security And Trust

Optional platform packages reduce install-time code execution. That matters because postinstall scripts run during dependency installation, often in CI contexts with credentials and broad filesystem access.

The trust model becomes:

- npm registry tarball integrity from the lockfile
- package provenance for `@drift/cli` and every `@drift/engine-*` package
- exact version matching between CLI and engine packages
- runtime protocol/version check
- optional binary SHA-256 check through `drift doctor` or first engine resolution

The risk is more package names. Keep all packages under the `@drift` scope, publish from CI only, use npm trusted publishing, restrict token publishing, and stage or dry-run all packages before promotion.

## Offline And Enterprise Behavior

Optional packages are the best npm-native fit for enterprise installs:

- works through npm, pnpm, Yarn, Verdaccio, Artifactory, and npm registry mirrors
- no GitHub or custom CDN access during install
- no lifecycle script required for the happy path
- lockfile and registry allowlist can include exact package names

Known failure modes:

- `npm install --omit=optional` or equivalent leaves no binary package installed
- package managers may need explicit multi-platform settings when generating lockfiles for another OS
- Linux libc detection must distinguish glibc and musl once Drift claims Alpine support

The error message should say exactly which package is missing and how to fix it, for example:

```text
Drift Rust engine package @drift/engine-linux-x64-gnu is not installed.
Reinstall without omitting optional dependencies, or set DRIFT_ENGINE_BIN to an approved engine binary.
```

## Checksums, Signing, And Provenance

V1 minimum:

- npm trusted publishing for every package
- npm provenance enabled
- exact CLI-to-engine package versions
- `engine-manifest.json` SHA-256 included in every engine package
- CI smoke test that installs `@drift/cli` from packed tarballs and runs `drift --version` plus one engine-backed command

Later enterprise-grade:

- GitHub release artifacts for every engine target
- `SHA256SUMS` and signed `SHA256SUMS`
- GitHub artifact attestations for binaries and SBOMs
- npm package provenance for the platform packages
- `drift engine verify` command that checks binary digest, protocol version, package version, and optional attestation metadata
- documented `DRIFT_ENGINE_MIRROR` or equivalent for enterprises that want to host approved binaries internally

## Release Complexity

Optional platform packages add release work, but it is the right work:

1. Build engine matrix.
2. Run target-local smoke tests.
3. Generate binary manifest and SHA-256.
4. Pack each `@drift/engine-*` package.
5. Install the packed `@drift/cli` with the target package and run an engine command.
6. Publish engine packages.
7. Publish `@drift/cli` pinned to the same version.

The release must fail if any claimed target cannot execute the engine. Do not publish metadata for untested targets.

## Final Strategy

V1: use optional npm platform packages, no default postinstall downloader, no normal-user source build. This gives Drift the best balance of user install UX, enterprise compatibility, offline behavior through npm mirrors, and manageable release complexity.

Later enterprise-grade: keep optional platform packages as the npm path, then add a signed GitHub release channel, binary attestations, SBOMs, checksum verification, and mirror support. That gives security teams a full provenance story without making every npm install depend on GitHub or a custom downloader.

## References

- [esbuild getting started: npm flags and optional platform binaries](https://esbuild.github.io/getting-started/)
- [esbuild package metadata](https://app.unpkg.com/esbuild@0.25.8/files/package.json)
- [SWC package metadata](https://app.unpkg.com/%40swc/core%401.15.0/files/package.json)
- [Biome package metadata](https://app.unpkg.com/%40biomejs/biome%402.3.3/files/package.json)
- [Biome manual binary installation](https://biomejs.dev/guides/manual-installation/)
- [Prisma engines documentation](https://docs.prisma.io/docs/v6/orm/more/internals/engines)
- [Prisma environment variables](https://docs.prisma.io/docs/v6/orm/reference/environment-variables-reference)
- [npm optionalDependencies documentation](https://docs.npmjs.com/cli/v9/configuring-npm/package-json/?v=true#optionaldependencies)
- [npm provenance documentation](https://docs.npmjs.com/generating-provenance-statements/)
- [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
- [GitHub artifact attestation documentation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [microsoft/ripgrep-prebuilt](https://github.com/microsoft/ripgrep-prebuilt)
