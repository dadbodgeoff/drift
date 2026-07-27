# Engine binary release

`@drift/cli` ships the Rust engine as five optional platform packages. The CLI refuses to run
without one — it will not silently fall back to the weaker TypeScript path.

| Package | Target | Buildable on macOS arm64 |
|---|---|---|
| `@drift/engine-darwin-arm64` | `aarch64-apple-darwin` | native — **verified** |
| `@drift/engine-darwin-x64` | `x86_64-apple-darwin` | cross — built, **not executed** |
| `@drift/engine-linux-x64-gnu` | `x86_64-unknown-linux-gnu` | no |
| `@drift/engine-linux-arm64-gnu` | `aarch64-unknown-linux-gnu` | no |
| `@drift/engine-win32-x64` | `x86_64-pc-windows-msvc` | no |

The three Linux/Windows targets fail on `tree-sitter`'s C build scripts, which need a C toolchain
for the target. They must be built in CI on their own platform.

## Build

```bash
node scripts/build-engine-artifacts.mjs
```

Writes `packages/engine-<platform>/bin/drift-engine` and an `engine-manifest.json` with the target
triple, SHA-256, byte size, the host that built it, and `verified`.

## built ≠ verified

The distinction is the point of this pipeline. A cross-compiled binary that links has never run.
Treating "it built" as "it works" is how a release ships an artifact nobody executed, so only the
host platform can set `verified: true` — and it earns that by **scanning a real fixture** and
parsing the output, not by printing a version string. A binary that prints its version has proven
only that it starts.

## Validate

```bash
node scripts/validate-engine-release-matrix.mjs                     # report
node scripts/validate-engine-release-matrix.mjs --require-artifacts # release job
```

Reports per target: verified / unverified / missing / checksum mismatch.

**A checksum mismatch is always fatal**, with or without the flag: a binary that does not match
its recorded hash is not the artifact that was built, and that is worth stopping for. Missing
artifacts are fatal only under `--require-artifacts`, because a developer machine legitimately
cannot build most targets.

This check was previously declaration-only. It validated `bin` paths and `files` lists in
package.json and reported "Validated 5 engine release targets" while **four of the five packages
contained no binary at all** — a check that passed without checking the thing it named, which is
precisely the failure this product exists to catch.

## Release

1. CI builds each target on its own platform, running the same script.
2. Each job commits its `bin/drift-engine` and `engine-manifest.json`.
3. The release job runs `--require-artifacts`, so a missing or mismatched artifact stops it.
4. Publishing is human-approved (T84).
