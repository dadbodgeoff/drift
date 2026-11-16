# Drift in CI

This page explains how to run Drift in continuous integration and in pre-commit: the exit codes of `drift check`, the output formats (GitHub notices and SARIF), what can fail a build and what never does, how pull-request mode decides what a change introduced, and how caching and monorepos behave. It is for the engineers and platform owners who add Drift to a pipeline.

The short version: CI checks the committed policy (`.drift/conventions.yaml` and `drift.lock`), fails only on new violations of conventions a person set to block, and reports everything else as annotations.

## Exit codes

| Command | Exit | Meaning |
| --- | --- | --- |
| `drift check` | 0 | no new violation, or only new violations of conventions in advise mode |
| `drift check` | 1 | a new violation of a convention in block mode, or a security finding not in the committed security baseline, of a kind the baseline sets to fail |
| `drift check --strict` | 1 | any new violation, advise mode included, or a file that could not be checked (not parsed for lack of stack, in the tree or at the merge base); without `--strict` that fails open, with the files named |
| any command | 2 | an error: no `.drift/conventions.yaml` (`run drift init first`), a policy file that does not parse, an unknown convention id, a symbolic link at a write target, a base ref that does not resolve, no git at all with `--diff-base` |
| `drift security`, `drift practices`, `drift card`, `drift map` | 0 | read-only facts; they report and never fail on findings (an error is still 2) |
| `drift security --ratchet`, or `--diff-base` with `--fail-on` | 1 | a finding not in the security baseline, of a kind that fails; or, with `--diff-base --fail-on`, the change introduces a kind named |
| `drift hook ...` | 0 | always; the answer is JSON on stdout |

An unknown flag is also an error (exit 2, from the argument parser). In pull-request mode, "no merge base" is an error, never a pass: a shallow clone says `fetch-depth: 0 needed`.

Violations of conventions that are only *proposed*, legacy violations in `drift.lock`, and violations suppressed with `drift-ignore` or marked fine never fail. The practice departures that `drift check` also prints are facts, computed after the exit code is decided; they never change it.

A practice a person promoted from the practice map is a convention, not a departure: its new violations are reported and fail exactly as any other convention's do, by its mode. Its two extra lines, a promoted practice that has gone stale and the units of its place that were not checked because the map cannot tell what they do, never fail a check. See [Practices Map](Practices-Map#promoting-a-practice-to-a-convention).

An accepted mined rule has the same two kinds of line. A member Drift could not read the rule for (a wrapper that does not resolve, a call that unpacks its arguments, and so on) is **not checked**: never reported, never failing, and its `drift.lock` line stays. A mined rule whose role has shrunk under 8 members, or which fewer than 75% of the members Drift can tell now follow, is **stale** and advises until a person looks, even when set to block. Each says so on a line of its own, and `--format json` carries them in `standing`. See [Conventions and Review](Conventions-and-Review#what-drift-check-could-not-tell).

## What blocks and what never blocks

| Thing | Can it fail the build? |
| --- | --- |
| A new violation of an accepted convention in block mode | Yes, exit 1 |
| A new violation of an accepted convention in advise mode | Only with `--strict` |
| A proposed or rejected convention | Never; not checked |
| A legacy violation in `drift.lock` | Never |
| Practice departures (`drift check`'s second section) | Never |
| A new violation of a promoted practice | As any convention: exit 1 in block mode, otherwise only with `--strict` |
| A stale promoted practice, or units of a promoted practice not checked | Never |
| A stale accepted mined rule, or members of a mined rule not checked | Never; a stale rule advises |
| A promoted practice forced below the 80% share (`--force`) | Never; it advises only |
| `drift security` and `drift security --diff-base` | Never without `--fail-on`; exit 0 |
| A security finding not in `.drift/security.lock` | Yes, in `drift check`, for a kind the baseline sets to fail; `unscoped-key` advises until a person sets it to fail |
| Security advice with no baseline (`drift check --diff-base`) | Never |
| Suggestions | Only if a person forced one to block (`drift review --block --force`) |
| Wiring rules (experimental) | Never, even with `--strict` |
| A convention set to block whose role had under 15 members when it was mined | Never; treated as advise |

Only a person puts a convention in block mode, so a fresh `drift init` cannot break your CI.

## The security baseline in CI

Where the repository commits `.drift/security.lock` (`drift security --write-baseline`), `drift check` over the whole tree or a diff also reads the security inventory and reports each finding not in the baseline: a `Security baseline` section in text, `security` in JSON, one `::error` annotation each with `--format github`, and a SARIF result each under a rule `drift-security/<kind>`. Each finding fails the check when the baseline's `# fail:` line names its kind; the others advise. A baseline written by `--write-baseline` sets every kind to fail but `unscoped-key`; `drift security --write-baseline --fail-on unscoped-key` sets that one too. A check of named files reads no inventory.

A finding of a kind newer than the Drift that wrote the baseline is listed apart, as new in this version of Drift, and fails nothing until the baseline is written again. With `--diff-base`, an entry point lacking a shared guard in a file the change did not touch (because other entry points gained the guard) is listed apart too, and fails nothing.

In pull-request mode (`--diff-base`), a finding the change adds to the code and also writes into `.drift/security.lock` itself is listed as a notice, in every format (text, `security.baselined_by_change` in JSON, a `::notice` annotation, a SARIF result at level `note`): it is in the baseline, so it fails nothing, and a reviewer accepts it by approving the lock's diff. A lock written again for code that was there, or lines that only moved, are not listed.

To fail on it instead, write the baseline once with `drift security --write-baseline --fail-on self-baselined` (or `--fail-on self-baselined:<kind>`): the header gains `# fail self-baselined: ...`, and `drift check --diff-base` then exits 1 on such a finding (`security.self_baselined` in JSON, an `::error` annotation, a SARIF `error`), saying how it is accepted: fix the code, or merge the finding's lock line in a change of `.drift/security.lock` alone before the code. A pull request that removes the line still gets the base's reading. This needs pull-request mode: a whole-tree `drift check` has no change to compare and prints one line saying the opt-in is not checked there.

`drift security --format sarif` writes the same results without a check: every finding of the inventory, or with `--diff-base` each one the change adds, or with `--ratchet` each one not in the baseline, under the same rules `drift-security/<kind>` and locations as `drift check --format sarif`.

With no baseline, `drift check --diff-base` lists what the change adds that a baseline would hold, under `Security advice: what this change adds (no security baseline; this does not fail the check)` (JSON `security_advice`). See [Security Inventory](Security-Inventory#the-baseline-what-is-there-is-accepted-what-is-added-is-seen).

Upgrade the Drift that CI runs before anyone promotes a practice: a Drift from before promotion cannot read a `.drift/conventions.yaml` that holds one, and stops with exit 2 (see [Versioning and Upgrades](Versioning-and-Upgrades#promoted-practices-and-older-drift)).

## The GitHub Action

```yaml
# .github/workflows/drift.yml
name: Drift
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  security-events: write          # only for the code scanning upload
  # pull-requests: write          # only with comment: "true"
  # statuses: write               # only with status: commit
  # checks: write                 # only with status: check
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0           # optional: saves the Action deepening a shallow clone
      - uses: dadbodgeoff/drift@v0.1.0   # a release tag or a full commit SHA (until 0.1.0 is released, a SHA): the Drift it runs
        id: drift
        with:
          # pr-mode: "false"       # check the whole repository on pull requests too
          # upload-sarif: "false"  # private repos without GitHub Advanced Security, or PRs from forks
          # comment: "true"        # one pull request comment, kept up to date
          # status: commit         # a commit status named "drift" for branch protection
```

Inputs, from `action.yml`:

| Input | Default | What it does |
| --- | --- | --- |
| `args` | empty | extra arguments for `drift check`, for example `--strict` |
| `working-directory` | `.` | the directory to check (for a repository checked out with `path:`) |
| `upload-sarif` | `"true"` | upload results to GitHub code scanning (needs `security-events: write`); `"file"` writes the SARIF file (the `sarif` output) without uploading it |
| `drift-ref` | empty | the Drift to run: empty runs the Drift of the Action's own ref; or a release tag, a branch or a full commit SHA |
| `pr-mode` | `"true"` | on `pull_request` events, report and fail only on what the pull request introduces |
| `security` | `"false"` | on pull requests in PR mode, also run `drift security --diff-base ... --github` (notices and a job summary; never fails the job) |
| `comment` | `"false"` | on pull requests, keep one comment up to date with the new violations and security findings (needs `pull-requests: write`) |
| `security-comment` | `"false"` | the earlier name of `comment`: `"true"` turns `comment` on |
| `comment-limit` | `"20"` | rows the comment lists per section; the rest are counted |
| `status` | `"off"` | `commit` posts a commit status (needs `statuses: write`), `check` a check run (needs `checks: write`) |
| `status-name` | `"drift"` | the name of the commit status or check run |
| `install-only` | `"false"` | `"true"` installs Drift (on `PATH` for later steps) and checks nothing |

What the Action does:

1. Resolves the Drift to run to one commit: `drift-ref` when set, else the Action's own ref (`uses: dadbodgeoff/drift@<ref>`; a local `uses: ./` is its checkout's commit). There is no floating default.
2. Installs it. When that commit is a release (a tag `vX.Y.Z`, or a commit SHA such a tag points at) and the runner is one a release ships a binary for (Linux x64 and arm64, macOS x64 and arm64, Windows x64), it downloads `drift-<tag>-<target>.tar.gz` and `SHA256SUMS` from the GitHub release, checks the archive against `SHA256SUMS` and the binary's `drift --version` against the tag, and stops the job if either does not match. Otherwise it builds Drift from source with `cargo build --release --locked` (from the Action's own files when they are that commit, else a shallow fetch of it), caching the cargo registry and the build output by commit, so later runs of the same commit reuse the binary and other commits rebuild only Drift's own crates. A binary is used only for the commit it was installed for.
3. Uses a fresh fact cache outside the checkout (`DRIFT_CACHE_DIR`), so pull-request code cannot supply cached facts.
4. When `upload-sarif` is on, runs `drift check --format sarif` over the whole repository and uploads it to code scanning. Code scanning tracks alerts across branches itself and shows a pull request only the alerts it adds. Exit 1 here is expected and tolerated; any other failure stops the job. Forks get no `security-events: write`, so turn the upload off for them.
5. Runs `drift check --format github`, with `--diff-base origin/<base branch>` on `pull_request` events unless `pr-mode` is `"false"`, then the same check as `--format json`, from which the outputs are counted. Every other event (`push`, and also `pull_request_target` and `merge_group`, whose checkouts are not the pull request's merge commit) falls back to the full check.
6. With a shallow checkout (the `actions/checkout` default), fetches the last 100 commits of the base branch and deepens 100 at a time (up to 1,000 commits) until the merge base is there, fetching the full history only as a last resort, and says so in the log. `fetch-depth: 0` makes that unnecessary.
7. Posts the comment and the status when asked, then fails the job with `drift check`'s exit code.

The job fails on new violations of conventions in block mode (`args: --strict` fails on advise mode too), on a security finding the committed baseline sets to fail, and on an error.

The Action's logic is in `scripts/action/` (`install.sh`, `check.sh`, `comment.sh`, `status.sh`), which `action.yml` calls; `bash scripts/action/test.sh` tests it with a fake `gh`, `curl`, `cargo` and `drift`, and the `action` job of Drift's own CI runs `uses: ./` on a fixture repository. The Action names the repository `dadbodgeoff/drift`.

**Pin the Action.** The Drift it runs is the Action's own ref, so `uses: dadbodgeoff/drift@main` runs whatever `main` is on the day of the run: a new Drift version can change what your CI reports without any change to your repository. Pin a release tag or a full 40-character commit SHA you have reviewed, and the pre-commit `rev:` to the same ref, so that the Action, the hooks and the developers' installs agree. Set `drift-ref` only to run another Drift than the Action's. See [Versioning and Upgrades](Versioning-and-Upgrades).

### Outputs

Read with `steps.<id>.outputs.<name>` (give the step an `id`). The counts come from the `drift check --format json` report of the check that gates the job, so in PR mode they count what the pull request introduces.

| Output | What it is |
| --- | --- |
| `exit-code` | `drift check`'s exit code: 0 nothing fails, 1 something fails, 2 an error; empty when the check did not run |
| `block` | new violations of accepted conventions in block mode |
| `advise` | new violations of accepted conventions in advise mode |
| `security-findings` | security findings not in `.drift/security.lock`, of a kind it sets to fail (0 without a baseline) |
| `security-advice` | security findings that advise: of a kind the baseline does not set to fail, or, with no baseline, what the pull request adds that a baseline would hold |
| `unchecked` | files Drift could not read, here or at the merge base: their violations are unknown, not absent |
| `report` | the path of the JSON report |
| `sarif` | the path of the SARIF file, when `upload-sarif` is not `"false"` |
| `drift-path`, `drift-commit` | the Drift binary the Action ran, and its commit |
| `installed-from` | `release`, `build` or `cached` |

A "new" violation is one Drift's own exit code counts: not in `drift.lock`, not suppressed with `drift-ignore`, not unsure because a file it depends on was not parsed, and not held back by the neighbour gate. When the JSON report cannot be read, the counts stay empty (never 0) and `exit-code` is 2, so the job fails.

### The pull request comment

With `comment: "true"`, on `pull_request` events, the Action keeps one comment on the pull request. Its body starts with a hidden marker (`<!-- drift-action:comment -->`), by which the next run finds it: the first run that has something to say creates it, and every later push edits it in place. When there is nothing left to say, the comment is edited to say so and that what it listed is resolved; a pull request that never had anything to report gets no comment. A comment the Action posted before it kept one up to date (marked `<!-- drift-security -->`) is adopted and edited the same way; other copies of it stay as they are.

The comment lists, each with its file and line:

- the new violations of accepted conventions, block mode first, with the rule and its id;
- the security findings: those not in the committed security baseline (marked "fails" when the baseline sets their kind to fail), the advice `drift check --diff-base` gives with no baseline, and, with `security: "true"`, what `drift security --diff-base` reports (one row per place);
- the files Drift could not read.

Each section lists at most `comment-limit` rows and counts the rest; the job's log and summary list every one. Everything the comment shows from the repository (paths, symbols, rule text, keys, the base branch name) is shown as code, with every punctuation character written as a character reference, so a file path or rule text cannot add markdown, HTML, a link or an @mention to the comment. Failing to post the comment (a missing permission, a fork's read-only token) is a warning; the check's result does not depend on it.

### The status

With `status: commit` the Action posts a commit status, and with `status: check` a check run, named `drift` (or `status-name`), on the pull request's head commit (on other events, the commit the run is for): success for exit code 0, failure for 1, error for anything else, including a check that never ran to the end. Its description gives the counts (`1 block, 0 advise, 0 security`); a check run's summary is the comment's text. Branch protection can then require `drift` by name, whatever the job is called. Name the job something other than the status, or a rule that requires `drift` may match the job's own check too. A status that cannot be posted is a warning: a rule that requires it keeps waiting, so nothing passes by it.

### Permissions

| Input | Permission the job needs |
| --- | --- |
| (always) | `contents: read` |
| `upload-sarif: "true"` (the default) | `security-events: write` |
| `comment: "true"` | `pull-requests: write` |
| `status: commit` | `statuses: write` |
| `status: check` | `checks: write` |

All of them use `github.token`. A pull request from a fork gets a read-only token: there the upload, the comment and the status fail (as warnings for the comment and the status), so turn them off for forks or run them from a workflow that has the permissions.

## Output formats

`drift check --format <text|json|sarif|github>`:

| Format | What it is |
| --- | --- |
| `text` | the default; advice-style text for people and agents (violations of accepted conventions agents are not shown are listed and marked `not shown to agents`) |
| `json` | everything: `violations`, `fixed`, `diff`, `conventions`, `practices` |
| `sarif` | SARIF 2.1.0 for code scanning and IDEs; new violations only; blocking rules at level `error`, other advice at `warning`, suggestions at `note`; practice departures as run notifications, not results |
| `github` | one workflow command per new violation: `::error` for block mode, `::warning` for advice, `::notice` for suggestions, titled `drift D-xxxxxx`, with the rule, its evidence, an example to copy and the `drift-ignore` comment; and, when `GITHUB_STEP_SUMMARY` is set, a job summary with counts by tier and mode, the top 10 violations and how to fix or suppress them |

An example annotation:

```
::error file=app/api/pay/route.ts,line=1,title=drift D-37416b::HTTP handlers in app/** (route files) are wrapped in withAuth() (38/42): POST does not follow it.%0ACopy app/api/r00/route.ts#GET.%0ABlock mode: this fails the check.%0AIf intentional, add `// drift-ignore D-37416b: <reason>` directly above the declaration (shown to reviewers).
```

GitHub shows only a limited number of annotations per step; the log and the summary have the rest. Repository text in annotations is sanitised and escaped by GitHub's workflow-command rules. File paths are counted from the git top level, so annotations land on the right file when `--root` is a subdirectory.

## Pull-request mode: what counts as introduced

```bash
drift check --diff-base origin/main
```

compares the working tree with the merge base of the ref and `HEAD` (`git diff --unified=0 --find-renames <merge-base>`, which in CI is `<ref>...HEAD`, plus untracked files) and reports only what the change introduces. The merge base must be in the local history. A new violation is reported when:

- its file was added by the change;
- it is on a declaration (a handler, component, class or model) and a line inside that declaration was added, changed or deleted. Drift records where a declaration starts, so a declaration runs to the line before the next one in the same file, and takes in the decorators and comments directly above it (up to a blank line). Editing a body counts: removing `requireUser()` from an existing handler is reported even though the first line did not change, and so does changing a class's decorator;
- it is file-level (a file rule, a package manifest, top-level statements) and the change touched that file;
- its file was renamed and it was not there before under the old path (in `drift.lock`, or at the merge base when that is checked): moving a handler into a route directory is reported even if its lines did not change, while moving a file keeps its legacy violations quiet. A plain `drift check` keeps them quiet too where `drift.lock` has fingerprint lines and the moved code is unchanged; with a lock written before fingerprints it reports them, since they no longer match their `drift.lock` key;
- a change elsewhere caused it (deleting a wrapper, changing a re-export). When a new violation outside the diff would fail the check, Drift also checks the merge base, with the current policy and lock and a throwaway fact cache, in a temporary directory built from git objects with a temporary index, then removed; your working tree and index are never touched, and no worktree is registered;
- the change edits the policy (`.drift/conventions.yaml` or `drift.lock`): then every new violation is reported, as by a plain `drift check`, since dropping a lock entry makes that legacy violation new.

Legacy violations in `drift.lock` and `drift-ignore` suppressions stay what they are: they never fail, and suppressions the change adds are listed in the summary for reviewers; the legacy count is the repository's, as in a plain `drift check`. Deleted files have nothing left to report. New violations outside the diff are not reported but counted ("1 new violation(s) outside the diff not shown"), and `drift check` without `--diff-base` lists them. The result depends only on the commits, so a rerun gives the same annotations. `--format json` adds a `diff` object (`base`, `merge_base`, file counts, `base_checked`, `policy_changed`, `new_outside_diff`).

Reproduce a CI result locally before you push:

```bash
drift check --diff-base origin/main
```

The flag is `--diff-base`; there is no `--base` or `--since`. Drift reads git for this (it runs `git diff`, `git merge-base` and read-only plumbing commands), and never commits, fetches or pushes. The Action does the fetching.

## Pre-commit

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/dadbodgeoff/drift
    rev: main                       # pin a tag or commit
    hooks:
      - id: drift-check             # or drift-check-strict
```

```bash
pre-commit install
```

The hook runs `drift check` (or `drift check --strict`) with `language: system`, so `drift` must be on your `PATH`. It runs when a commit stages TypeScript, JavaScript or Python files; a commit that changes only `.drift/conventions.yaml` or `drift.lock` is not checked (`pre-commit run drift-check --all-files` checks it by hand). pre-commit stashes unstaged changes before it checks, so a `drift review` you have not staged does not count there: stage the policy files.

## Caching

- The Action caches a binary it built (with the cargo registry and the build output) by Drift commit, never facts; a released binary is downloaded and checked each run.
- For your own CI, `.drift/cache/` is local and git-ignored by itself. If you restore it between runs, do it from your pipeline's own cache store and not from files the pull request brought: Drift ignores a cache that git tracks and one containing a symbolic link, and a cache file that does not read back as written is replaced, but the Action's design (a fresh cache outside the checkout) is the safe default.
- `--no-cache` on any command keeps nothing on disk; `DRIFT_CACHE_DIR=<dir>` puts the cache elsewhere.
- A first run on a large repository is slower than later ones; see [How Drift Works](How-Drift-Works).

## Monorepos

Run `drift init` once at the repository root, commit one `.drift/`, and run `drift check` from the root. Drift finds the packages and checks a touched file in its package. `check`, `review`, `example` and `export` run without `--root` from a subdirectory use the nearest `.drift/conventions.yaml` above it. If you run Drift from a package directory with `--root`, annotation paths still name files from the git top level. Override package discovery with `packages: {roots: [...], exclude: [...]}` in `.drift/config.yaml`; see [Configuration Reference](Configuration-Reference).

## Security notices on pull requests

With `security: "true"` the Action runs `drift security --diff-base origin/<base> --github`: notice annotations and a job summary for what the pull request introduces (an entry point lacking a guard most of its siblings have, an unguarded entry point reaching a risky operation, a risky operation or client leak added, an entry point made internet-facing). It never fails the job. It is off by default until the shared-guard precision is measured. With `comment: "true"` the [pull request comment](#the-pull-request-comment) lists them too. See [Security Inventory](Security-Inventory).

`drift security --diff-base` and `drift check --diff-base` also annotate every http, server action, GraphQL or RPC entry point the change adds where Drift found no guard in what it read, or cannot tell its guard, whatever its siblings do. These are notices; they never fail the check.

Not built yet: answers in `.drift/config.yaml` that go stale, with a report that says which, when the evidence they rested on changes. Today a person's answer whose evidence changed is asked again by `drift setup` but keeps applying until you answer it, and nothing in CI reports it; an agent's cautious answer is judged again on every read (see [Setup Questions](Setup-Questions#what-the-questions-rest-on)). Run `drift investigate` on the branch to list every route Drift could not settle.

See also: [Getting Started](Getting-Started), [Conventions and Review](Conventions-and-Review), [Team Rollout](Team-Rollout), [Command Reference](Command-Reference), [Output and JSON Reference](Output-and-JSON-Reference), [Files Drift Writes](Files-Drift-Writes).
