# The Drift beta: what it is and what it is not

This page is for a team deciding whether to try Drift during the beta. It says
what Drift does on the first day, what it will not do, what has been measured
and what has not, what we ask of a beta team, how to report a wrong result and
how to remove Drift completely.

The beta is private: a few teams the project's owner talks to, with a mix of
TypeScript and Python and at least one monorepo. No version has been published
yet; see [Install](../README.md#install) for the two ways to get a binary today.

## What Drift does on the first day

Run in your repository, on a clean working tree:

```sh
drift census     # what Drift would propose; writes nothing
```

```sh
drift init       # writes .drift/conventions.yaml and drift.lock
```

`drift init` prints, on one screen:

- **What the code does**, read from the code: the main kinds of entry point
  (HTTP routes, server actions and so on), and for each how it signs a caller
  in, checks permissions, handles errors and answers. These are facts, not
  rules: nothing checks them.
- **A few findings worth a look first**, such as routes where Drift found no
  sign-in check in what it read.
- **The conventions it proposes**, each with its evidence and its outliers.
  A proposal is not checked at all until a person accepts it.
- **The security baseline it would write**, if you ask it to. It writes none
  on its own.

Then a person reviews the proposals (`drift review`) and `drift check` reports
new code that breaks an accepted one. Coding agents are told only about
conventions a person accepted (a suggestion needs one more step:
`drift review --show-to-agents <id>`). In a repository nobody has reviewed,
agents are told no convention at all.

The full first run is in [Getting started](wiki/Getting-Started.md).

## Everything advises; nothing blocks a build

In the beta, run Drift in advise mode only:

- An accepted convention advises unless a person sets it to block. Advice is
  listed and the exit code of `drift check` stays 0. **Do not** use
  `drift review --block`, `drift practices promote --block`, `--strict` or the
  `drift-check-strict` pre-commit hook during the beta.
- **Do not write a security baseline during the beta**
  (`drift security --write-baseline`). Once `.drift/security.lock` is
  committed, `drift check` exits 1 when a new finding of most kinds appears.
  Without it, `drift check --diff-base` lists what a change adds of a few of
  those kinds (new entry points where no guard was found, those that reach an
  operation fed by the request, those that take a tenant or owner key nothing
  checks) as advice that never changes the exit code.
- The GitHub Action runs `drift check`, so it fails a job only where that
  would: a convention in block mode, or a committed security baseline. Its
  security notices (input `security: "true"`, off by default) never fail it.
- The Claude Code hooks block the end of an agent's turn only for a convention
  in block mode. Every hook exits 0, so a Drift failure never stops the agent.

If anything Drift reports fails a build or stops an agent while everything is
in advise mode, that is a bug that stops the beta: report it at once.

## What has been measured, and what has not

These are the README's own figures
([Accuracy and limits](../README.md#accuracy-and-limits),
[How accurate is it?](ACCURACY.md)). Every label comes from blind labelling
agents under rubric v3, not from real maintainers.

| | In-sample (the dev repos the fixes were built on) | Out-of-sample (blind and held-out pools) |
| --- | --- | --- |
| TypeScript/JavaScript default tier, accepted | 100% (30/30) | **46.7% (7/15)**, Wilson 24.8–69.9% |
| TypeScript/JavaScript suggestions after the show policy, accepted | – | **85.7% (6/7)**, 4 repos |
| Python, everything shown, accepted (round 10) | 100% (12/12) | **50.0% (1/2)** |
| Python, everything shown, accepted (the dev5-py-check) | 83.3% (25/30) | **90.9% (10/11)**, Wilson 62.3–98.4%, a blind dev pool |
| Accepted cards per TypeScript/JavaScript repo | 2.69 | **0.58** (median 0) |

What this means for a beta team:

- **About half of the default-tier proposals were wrong out of sample.** Review
  every proposal; do not accept them in bulk. The release gate (at least 95%
  accepted on a held-out set) has not passed for any language.
- **Expect few proposals.** Most repositories get none.
- **Authentication and authorization answers can be wrong.** On code Drift was
  not tuned on, independent, unseen test suites found 9% to 15% of soundness
  checks (about one in seven to one in eleven) wrong on first contact. Read
  `none` and `internal` as "nothing found in what Drift read", and `unknown` as
  "Drift could not tell".
- **Rules made from the map are new, and their accuracy is not measured.** A
  practice promoted with `drift practices promote`, and any rule Drift proposes
  from its maps rather than mines, has no accuracy figure yet. None of the
  numbers above is about them.
- **The changes in the [changelog](../CHANGELOG.md) under `Unreleased` have not
  been built or measured as a whole yet.** The figures above are from before
  them.

## Drift sends nothing anywhere

The `drift` binary makes no network connection and has no telemetry. It reads
your working tree and writes only the files listed under
[Removing Drift](#removing-drift-completely). Nothing it writes is posted or
uploaded.

One thing does leave your machine if you connect an agent: what the hooks and
the MCP server print is read by the agent, and so by the model provider behind
it. See [Security and privacy](wiki/Security-and-Privacy.md).

## What we ask of a beta team

1. Install Drift and run `drift init` on your repository.
2. Accept or decline each proposal in `drift review`. Read each card's
   outliers before you decide.
3. Leave the Claude Code hooks on for a week, in advise mode.
4. Mark each report Drift makes as true or wrong, and send us the wrong ones
   (below).

What we measure from this: how many proposals people who did not build Drift
accept, how many reports are true, whether the hooks are still on after seven
days, and how long it takes from install to the first accepted rule.

The beta stops at once on any of these: a report that fails a build or stops an
agent while everything is in advise mode, a crash that stops an agent, or a file
Drift writes that is not on the list below.

## Reporting a wrong result

A command is being written that records, in a local file, a report you mark as
wrong or a proposal you decline, for you to share by hand; it sends nothing
(`drift feedback`: command name to confirm).

Until then, open an issue with the **Wrong result** template: what Drift said,
what the truth is, the command and the Drift version. **Do not paste private
code.** Replace names, and cut the example down to the few lines that show the
problem. For a crash, use the **Crash** template. Report a security problem
privately, as [SECURITY.md](../SECURITY.md) says, not in an issue.

## Platforms

The release workflow builds five targets: `x86_64-unknown-linux-musl`,
`aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, `aarch64-apple-darwin` and
`x86_64-pc-windows-msvc`. Not all of them are tested:

| Target | Built by the release | Test suite run in CI |
| --- | --- | --- |
| Linux x86_64 | yes (musl) | yes, on every pull request and push to `main` (on `ubuntu-latest`, built for its default glibc target, not the musl binary the release ships); the release runs `drift --version` on the musl binary |
| Linux arm64 | yes (musl) | no |
| macOS on Apple silicon (arm64) | yes | yes, on `macos-latest`, on pushes to `main`, nightly and on demand; **not** on pull requests |
| macOS on Intel (x86_64) | yes (cross-compiled on Apple silicon) | no |
| Windows x86_64 | yes | yes, on `windows-latest`, on pull requests that change the Rust build, pushes to `main`, nightly and on demand; it never fails the run and is not yet green |

The project's roadmap records the macOS test job as failing on `main` at the
time of writing. The plan for the first version supports Windows through WSL
only. The binaries are not code-signed or notarised; each release carries
`SHA256SUMS` and build provenance to verify ([RELEASING.md](../RELEASING.md)).

## Removing Drift completely

Drift changes no source file and never commits. Everything it writes is below;
remove what applies, then commit the removal.

**In the repository:**

```sh
rm -rf .drift drift.lock
```

That removes the policy (`.drift/conventions.yaml`), the answers
(`.drift/config.yaml`), the security baseline (`.drift/security.lock`), the
cache (`.drift/cache/`), and the local review log, findings, gap reports and
verifier cache (`.drift/review-log/`, `.drift/findings/`,
`.drift/gap-reports/`, `.drift/verify-cache.json`). If you set
`DRIFT_CACHE_DIR`, the cache is in that directory instead: delete it too.

Drift writes the following only when a person asks for them; undo what you did:

- **`AGENTS.md` or `CLAUDE.md`** (`drift export agents-md --write`): delete
  the block from `<!-- drift:start ...` to `<!-- drift:end -->`.
- **`.claude/settings.json`** (`drift export claude-settings --write`): remove
  the `permissions.allow` entries that start with `Bash(drift ` or
  `mcp__drift__`, and the `permissions.deny` entry
  `Bash(drift practices promote:*)`.
- **Files you named** with `--write`, `--out` or `--export-log` (for example
  `drift findings --issue <id> --write FILE`, `drift scan --out FILE`).
- **Local branches** made by `drift findings --branch`: `drift/<id>`. Delete
  them with `git branch -D`.
- **Lines you added yourself**: `drift.lock merge=union` in `.gitattributes`,
  any Drift block in `.gitignore`, the `drift-check` hook in
  `.pre-commit-config.yaml`, and a workflow that uses the Drift Action.

**On each machine:**

- Claude Code: uninstall the `drift` plugin (the `/plugin` menu) and, if you
  registered the MCP server by hand, run `claude mcp remove drift`.
- The binary: delete the `drift` you copied onto your `PATH`, or, if you built
  it from source, run `cargo uninstall drift-cli`.

See [Files Drift writes](wiki/Files-Drift-Writes.md) for each file in detail.
