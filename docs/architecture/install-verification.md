# Install verification status

What is actually proven about installing Drift, per platform. Stated plainly because "it should
work on Linux" is not a verification.

| Platform | Engine binary | Install verified | How |
|---|---|---|---|
| macOS arm64 | built **and executed** | **yes** | `test/e2e/installed-flow.test.ts` |
| macOS x64 | cross-built, never executed | no | needs an x64 runner |
| Linux x64 / arm64 | **not built** | no | needs CI on Linux |
| Windows x64 | **not built** | no | needs CI on Windows |

## What is verified on macOS arm64

`installed-flow.test.ts` is a genuine packed-artifact install, not a workspace run. It packs every
workspace package, installs the tarballs into a clean consumer directory, strips
`DRIFT_ENGINE_BIN` and `DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK` from the environment, and asserts
the engine resolves from the packaged optional dependency. It then runs `doctor`, `scan`, `start`,
`prepare`, `check`, `findings` and MCP status against a fixture repo.

That covers the DoD's macOS half. Reproducing it by hand in a scratch directory adds nothing —
attempted, and it fails at `npm install` with a 404 on `@drift/core`, because the CLI depends on
workspace packages that are not published. Any real fresh-install test therefore has to pack the
whole workspace, which is what that test does.

## Why Linux cannot be verified from this machine

Two independent blockers, either of which is sufficient:

1. **No Linux engine binary exists.** `tree-sitter` ships C build scripts, so cross-compiling to
   Linux needs a C toolchain for the target (see `engine-release.md`). Without the binary there is
   nothing for a container to install.
2. No container runtime is running here.

Fixing (2) would not help while (1) holds. Linux verification belongs in CI, on a Linux runner,
where the engine is built natively and the same install test runs against it.

## Windows

Unverified. No binary, no runner. Stated rather than implied — the platform package exists and is
declared in `optionalDependencies`, which is not the same as knowing it works.

## What a release must not claim

Until CI runs this on each platform, the honest claim is **"verified on macOS arm64; other
platforms build in CI and are unverified"**. The engine manifest carries a `verified` field per
artifact for exactly this reason, and `validate-engine-release-matrix.mjs` reports it.
