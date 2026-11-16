# Contributing to Drift

Thanks for helping. A few rules keep the project predictable.

## Before you open a pull request

These are the commands CI runs. CI also builds with `RUSTFLAGS=-D warnings`
and `INSTA_UPDATE=no`. The same tests run on macOS on `main`, nightly, on demand
and on pull requests that change the Rust build (output must be identical across
operating systems); macOS does not gate pull requests, and a macOS failure on
`main` is fixed there:

```sh
cargo fmt --all --check
cargo clippy --all-targets --locked -- -D warnings
RUSTFLAGS="-D warnings" INSTA_UPDATE=no cargo test --all --locked
cargo deny check
```

### All local gates in one command

`scripts/gates.sh` (POSIX sh) runs the local gates in order and ends with one
PASS/FAIL line per gate, with counts. It exits non-zero if any gate fails:

1. `cargo fmt --all --check`
2. `cargo clippy --all-targets --locked -- -D warnings`
3. `RUSTFLAGS="-D warnings" INSTA_UPDATE=no cargo test --all --locked`
4. `node --test eval/study/*.test.mjs`

```sh
scripts/gates.sh            # gates 1 to 4
scripts/gates.sh --fast     # skip clippy
scripts/gates.sh --studio   # also, in apps/studio: npm ci --ignore-scripts,
                            # typecheck, lint, vitest and build
```

Every gate runs even after an earlier one fails, so one run shows every
failure. With `--studio`, the Studio steps after a failed `npm ci` are reported
as SKIP and count as failures. `--fast` is for iterating; run without it before
you push. Run `--studio` whenever you change the Studio or any JSON shape it
reads.

The script honours `CARGO_TARGET_DIR` and defaults to a lean dev profile,
`CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_INCREMENTAL=0` (set either to override
it). Any `RUSTFLAGS` you set are kept, with `-D warnings` appended for the test
gate. `cargo deny check` is not part of it; run it separately.

- **Determinism is a feature.** Output must be byte-identical across runs,
  thread counts, operating systems and checkout paths. Use ordered maps and
  sorted collections in anything that reaches output.
- **Snapshot changes need a reason.** If an `insta` snapshot changes, say why in
  the pull request. Review it with `cargo insta review`.
- **No conventions in code.** Drift learns conventions from each repository.
  Framework adapters may describe how code runs (routes, entry points), never
  what a team's conventions are.
- **No AI in the check path.**

### Public snapshots

`scripts/snapshot.sh OUTDIR` exports the tracked tree at one commit, with no history, for a public copy. It fails, writing nothing, if a name in the private `scripts/snapshot-deny.txt` appears in a file (binary files included), a file or directory name or a link target, or if a string shaped like a secret remains outside the files listed in `scripts/snapshot-fake-secrets.txt` (exact paths); `scripts/snapshot-exclude.txt` takes shell globs. A deny list with no names fails. After changing `scripts/snapshot.sh`, run `scripts/snapshot-test.sh`.

### Drift on its own repository

Drift checks this repository like any other. The policy is committed:
`.drift/conventions.yaml` and `drift.lock`, as `drift init` wrote them, and
`drift.lock merge=union` in `.gitattributes`. `.drift/cache/` and the other
local directories are ignored (see the wiki's Files Drift Writes). Every
proposal is left undecided: accepting one, setting one to block and writing the
security baseline (`drift security --write-baseline`) are the maintainers'
decisions, made with `drift review`, never in a pull request that does
something else. Until one is accepted, `drift check` cannot fail here; once one
is in block mode, a pull request that newly breaks it fails the `oracle` job.

The root `.ignore` leaves out of the scan what is test data, not product code:
the fixture repositories under `crates/*/tests/fixtures/` and
`apps/studio/fixtures/`, the planted vulnerable code in `eval/security/planted/`
and held-out evaluation data (by name). Drift reads `.ignore` like `.gitignore`;
so does ripgrep, so `rg` skips those paths too unless given `--no-ignore-dot` or
the directory itself. Do not add real source there to quiet a finding. A run
whose root is one of those directories (as the tests and fixture scripts do) is
not affected.

Run it as CI does, with the cache outside the checkout:

```sh
cargo build --locked -p drift-cli
export DRIFT_CACHE_DIR="$(mktemp -d)"
target/debug/drift check --diff-base origin/main --format github   # a branch
target/debug/drift check --format github                           # the whole repository
```

`drift census`, `drift security` and `drift practices` show what Drift reads
of this code; `drift init` again after a change merges new proposals and keeps
every decision.

### Every CI job, command by command

These are the commands of `.github/workflows/ci.yml`, job by job, as CI runs
them. Every job runs with `RUSTFLAGS=-D warnings` set. The Node jobs use Node 22.
Where CI writes to `$RUNNER_TEMP`, set it to a scratch directory first:

```sh
export RUSTFLAGS="-D warnings"
export RUNNER_TEMP="$(mktemp -d)"
```

`lint`:

```sh
cargo fmt --all --check
cargo clippy --all-targets --locked -- -D warnings
```

`test` (and `test-macos`, the same on macOS, on `main`, nightly, on demand and,
non-blocking, on pull requests that change the Rust build; `test-windows` also
runs `cargo build --release --locked -p drift-cli` first and never fails the
run):

```sh
INSTA_UPDATE=no cargo test --all --locked
```

`stack-bound` (the parse stack of the release profile):

```sh
cargo test --release --locked -p drift-ts -p drift-py --test stack_bound
```

`deny` (CI runs it through `cargo-deny-action`):

```sh
cargo deny check advisories bans licenses sources
```

`study` (needs full git history: CI checks out with `fetch-depth: 0`):

```sh
for f in eval/study/*.test.mjs; do node --test "$f" || exit 1; done
```

`oracle`:

```sh
cargo build --locked -p drift-cli
npm install --prefix "$RUNNER_TEMP/ts" --no-save --no-audit --no-fund --ignore-scripts typescript@5.9.3
TS_PATH="$RUNNER_TEMP/ts/node_modules/typescript" node eval/oracle/fixtures.mjs --drift target/debug/drift
# Drift on this repository (needs full history on a pull request: fetch-depth: 0)
export DRIFT_CACHE_DIR="$(mktemp -d "$RUNNER_TEMP/drift-cache.XXXXXX")"
target/debug/drift check --diff-base <pull request base commit> --format github  # pull requests
target/debug/drift check --format github                                         # other events
```

`harness` (python3 from the runner, standard library only):

```sh
(cd eval/scoreboard && python3 -I -m unittest discover -s tests)
(cd eval/benchmark && python3 -I -m unittest discover -s tests)
sh scripts/snapshot-test.sh
```

`scripts/gates.sh` is not run in CI: each of its gates is already a CI job
(`fmt` and `clippy` in `lint`, `test` in `test`, `study` in `study`, the
`--studio` gates in `studio`). `scripts/snapshot.sh` is not run either: it
needs the private deny and fake-secret lists, and without the second it fails on
the known fake secrets of the redaction test data.

`packaging`:

```sh
npm install --prefix "$RUNNER_TEMP/yaml" --no-save --no-audit --no-fund --ignore-scripts yaml@2.9.1
node npm/ci-check.mjs "$RUNNER_TEMP/yaml"
node --test npm/set-version.test.mjs
```

`release-rehearsal` (pull requests that touch `release.yml`, `npm/`, `Cargo.toml`,
`Cargo.lock` or the plugin manifests; nightly; on demand):

```sh
sudo apt-get install -y musl-tools && rustup target add x86_64-unknown-linux-musl
npm/dry-run.sh
```

`studio`:

```sh
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
npm ci --ignore-scripts
npm run typecheck --workspaces
npx eslint .
npm test --workspaces
npm run build -w drift-studio
npm run build:fixture -w drift-studio
npx playwright install --with-deps chromium
node apps/studio/tests/e2e/run.mjs
```

## Changelog

A pull request that changes what a user sees (a command, a flag, an output, a
file Drift writes, or how Drift behaves for an existing user) adds one line
under `Unreleased` in [CHANGELOG.md](CHANGELOG.md), in the same pull request.
Before 1.0, a breaking change starts with **Breaking:** and says what to do.
The rule is stated at the top of the changelog.

## Studio

Drift Studio (`apps/studio`) must stay up to date with every addition to Drift.
**Every user-visible addition ships with Studio support, or with a linked paired
Studio PR.** User-visible means a new subcommand or flag, a new or changed field in
any `--json` output, a new rule kind, skip reason or tier, a new hook message, or new
study output under `eval/study/runs/`.

- **Paired PRs.** When the Studio side is built separately, its PR is based on main,
  merges the feature branch, and names the feature PR in its body; the feature PR
  links back. The two merge together: a feature does not merge without its Studio
  support.
- **JSON only.** The Studio reads Drift through its JSON outputs and the files Drift
  writes, never through human text. If the Studio needs a field that is not in
  `--json`, add it to the CLI, additively, keeping existing fields byte-compatible,
  with a test.
- **The ledger.** [`apps/studio/docs/SYNC.md`](apps/studio/docs/SYNC.md) lists each
  feature, its JSON surface, the Studio surface and its status. Update it in the
  same PR.
- **CI.** `apps/studio/tests/unit/coverage.test.ts` (run by the `studio` job) reads
  Drift's sources and fails when a top-level subcommand, a rule kind, a skip reason
  or a hook message the Sessions view recognises is not handled by the Studio or
  allowlisted with a reason in `apps/studio/src/shared/contract/coverage.ts`.
- **Fixtures.** Regenerate them with `apps/studio/scripts/make-fixtures.mjs` and
  `make-study-fixtures.mjs` (dev repositories and synthetic data only; never a
  held-out repository).

## How changes land

Every change, including changes written by AI agents, goes through a pull
request and a review on GitHub:

1. **Author** works on a branch. Local gates pass (above), plus the gates the
   change touches: the TypeScript oracle (`eval/run.mjs`, 0 disagreements and
   0 gaps) for parser changes, and the labelled precision numbers
   (`eval/study/`) for mining changes.
2. **Draft PR** with the template filled in: what changed, why, how it was
   verified, and what was not done.
3. **Independent review.** A reviewer who did not write the change reads the
   diff and posts inline comments, each starting with **[blocking]** or
   **[nit]**. Reviewer instructions: [`.github/REVIEWING.md`](.github/REVIEWING.md).
4. **Author replies to every comment on the PR:** fixes it and pushes, or
   explains why not. The author never resolves a reviewer's thread.
5. **Re-review** of the new commits. The reviewer who opened a thread resolves
   it when it is addressed, or replies saying why it is still open. Repeat until
   no blocking comment is open.
6. **Merge** only when CI is green, every thread is resolved and no comment is
   unanswered. Squash or rebase; keep the history linear.

Comments posted by agents end with the Claude Code footer, so it is always
clear which comments came from an agent.

## Conduct

This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
Report conduct issues privately to the maintainers through GitHub.
