# CI integration — status: UNVERIFIED

`.github/workflows/drift-check.example.yml` is a reference workflow. It is named `.example.yml` so
it does not run, and **no line of it has been executed on a Linux runner.**

## Requirement 1: `fetch-depth: 0`

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0   # REQUIRED - Drift refuses shallow clones
```

`actions/checkout` clones depth-1 by default, and a shallow clone's root commit is the fetch
graft, not the repository's real first commit — an identity derived from it would silently
disagree with every developer's checkout, so the committed `drift.lock` could never import.
Drift therefore **refuses to derive identity in a shallow clone**: every identity-deriving
command (`start`, `scan`, `init`) exits **3** with this remediation before writing any state.
Set `fetch-depth: 0`, or run `git fetch --unshallow` before invoking Drift.

Partial clones (`--filter=blob:none`) are fine — they have the full commit graph and are not
shallow. `drift doctor` reports the repo's shallow status, identity source, and fingerprint
under the `repo_identity` check.

## What is verified, and where

| | |
|---|---|
| Check semantics and exit codes (0 / 2 / 3 / 1) | verified, macOS arm64 |
| A committed `drift.lock` imports into a second checkout at a different path | verified, macOS arm64 (T120/T122) |
| A contract from a different repository is refused | verified, macOS arm64 |
| Drift running on Linux at all | **unverified** |
| This workflow file | **unverified** |

## Why it builds the engine from source

There is no Linux engine binary. `tree-sitter` ships C build scripts, so cross-compiling to Linux
needs a C toolchain for the target, and that build has been deferred (see
[architecture/engine-release.md](./architecture/engine-release.md) — the release matrix reports
1 verified, 1 built-but-unexecuted, 3 missing).

So `npm install` would resolve `@drift/engine-linux-x64-gnu` to a package containing no binary, and
the CLI would refuse to run rather than fall back to the weaker TypeScript path. Publishing an Action
that depends on an empty package is exactly the failure the release-matrix validator was fixed to
catch, so this does not do it. Building with cargo on the runner costs a few minutes and is honest.

When Linux binaries are published, the two build steps collapse to `npm i -g @drift/cli`.

## Two details that are easy to get wrong

**`fetch-depth: 0`.** See Requirement 1 above. Beyond identity, the check compares against the
merge base, and a shallow clone has none — a `--diff` range that crosses the shallow boundary
fails, and the error names the boundary and the same remediation.

**Exit 3 must fail the job.** It means Drift declined to answer — stale scan, missing contract,
unavailable engine — and treating a refusal as a pass reintroduces the failure the exit codes exist
to prevent. The example maps it to failure explicitly.

## Before relying on this

1. Run it once on a real Linux runner and record the result here.
2. Confirm `drift doctor` reports `repo_identity` with `shallow: false` and source `git_remote`
   in CI. If it reports `absolute_path`, the committed contract will not import and the check
   will run against a freshly inferred contract instead — which is not the same thing and will
   not be obvious. If it reports `shallow: true`, every scan will refuse with exit 3 until the
   checkout fetches full history.
