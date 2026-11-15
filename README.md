# Drift

**The convention lockfile for AI agents: mined from your code, approved by you, checked in your agents and CI.**

Drift is a command-line tool that reads a repository and learns the conventions
the code already follows, such as the wrapper every API route uses, the guard
every server action calls or the layout every page renders. You confirm them;
Drift then tells coding agents about the ones you accepted (a suggestion also
needs `drift review --show-to-agents`) and reports new code that breaks them, and blocks only the ones you set to block. It ships no
predefined rules, runs no AI in the check path, and never sends your source
code anywhere: it reads the working tree and writes under `.drift/` and
`drift.lock`.

> **Status: beta.** Drift learns the conventions of TypeScript, JavaScript and
> Python code, shows them to you first, tells coding agents
> only about the ones you accept, and plugs into Claude Code, pre-commit, GitHub
> code scanning and any MCP client.
>
> - **Agents see only what a person accepted, and chose to show.** Default-tier
>   proposals are *block candidates*: they reach agents once you accept them
>   (decision D13). A suggestion (every Python convention is one) reaches agents
>   only after `drift review --show-to-agents <id>`, unless its rule family is
>   admitted (none is today).
> - **Nothing blocks** unless a person sets it to block.
> - **Mined Python proposals are on by default, as suggestions only**
>   (`proposals: {python: off}` turns them off). A blind check of 11 cards
>   decided the default; it is not a held-out result.
> - **Review every proposal.** On repositories Drift was not tuned on, about half
>   of the default-tier cards (7 of 15) and 6 of 7 shown suggestions were right:
>   small samples, and below the ≥ 95% release gate. See
>   [How accurate is it?](docs/ACCURACY.md) and
>   [Accuracy and limits](#accuracy-and-limits).
>
> [Beta release notes](docs/RELEASE-NOTES-beta.md) · [plan](docs/v2/PLAN.md)

**Documentation.** This page is the front door. The full guide is the wiki
pages under [`docs/wiki/`](docs/wiki/Home.md): start at [Home](docs/wiki/Home.md), or
go straight to [Getting started](docs/wiki/Getting-Started.md),
[Drift in CI](docs/wiki/Drift-in-CI.md), [Team rollout](docs/wiki/Team-Rollout.md),
the [command reference](docs/wiki/Command-Reference.md) or
[Troubleshooting](docs/wiki/Troubleshooting.md).

## Contents

- [What Drift does and how sure it is](#what-drift-does-and-how-sure-it-is)
- [Install](#install)
- [A five-minute first run](#a-five-minute-first-run)
- [Drift inside git](#drift-inside-git)
- [The commands at a glance](#the-commands-at-a-glance)
- [Configuration at a glance](#configuration-at-a-glance)
- [Using Drift with agents](#using-drift-with-agents)
- [Accuracy and limits](#accuracy-and-limits)
- [Drift Studio](#drift-studio)
- [Design and safety](#design-and-safety)
- [Contributing, support and license](#contributing-support-and-license)

## What Drift does and how sure it is

Drift does five things, all locally. It **mines** the conventions your code
follows and proposes them as rules for you to review (`drift init`,
`drift census`, `drift review`, `drift check`). It **maps** what the code does
per route for authentication, authorization, error handling, logging, validation
and more (`drift practices`). It **inventories** entry points with their guards
and where they are reachable from (`drift security`). It **gives agents** a
file's place and rules (`drift card`, `drift mcp`, the Claude Code hooks). And it
**asks** the few questions only a person can answer, such as whether a compose
file deploys anything (`drift setup`).

**How sure are the answers?** Not equally. Exposure (internet-facing, internal,
unknown) and error handling are in good shape. For authentication and
authorization, `known` is proven, but on code Drift was not tuned on a share of
`none` answers (and some `known`) are wrong: independent, unseen test suites
found 9% to 15% of soundness checks (about one in seven to one in eleven)
wrong on first contact. Read
`none` and `internal` as "nothing found in what Drift read": a finding to check,
not a fact. `unknown` means Drift could not tell and says why; it is common, and
it is the honest answer. Mined conventions are proposals, and about half of the
default-tier ones were wrong out of sample, which is why a person reviews every
one. Details: [Accuracy and limits](#accuracy-and-limits) and
[Accuracy and Limits](docs/wiki/Accuracy-and-Limits.md).

## Install

Nothing is published yet: there is no npm package and no release archive. Until
the first release, use one of the two paths below. Both end at `drift --version`.

**A binary a teammate gave you.** It must be built for your operating system and
CPU. Put it in a directory on your `PATH` and make it executable:

```sh
mkdir -p ~/.local/bin
```

```sh
cp ./drift ~/.local/bin/drift && chmod +x ~/.local/bin/drift
```

```sh
drift --version
```

If `drift` is not found, add `~/.local/bin` to your `PATH`. Install it as
`drift` on your `PATH`, not only in one directory: the Claude Code hooks and the
pre-commit hooks run `drift` from your `PATH`.

**Build from source.** From a checkout of this repository, with Rust 1.97
(`rust-toolchain.toml` pins it, and `rustup` fetches it the first time you run
cargo inside the checkout):

```sh
cargo install --locked --path crates/drift-cli     # a release build: several minutes
```

This installs the `drift` binary into `~/.cargo/bin`, which `rustup` puts on your
`PATH`.

```sh
drift --version
```

**After the first release.** Neither of these works today (the npm package
returns 404 and no archive exists):

```sh
npm install -g @dadbodgeoff/drift     # prebuilt binary, no install scripts
```

A beta (prerelease) version will be published under npm's `next` dist-tag, not
`latest`: `npm install -g @dadbodgeoff/drift@next`. For a one-off run without
installing, `npx @dadbodgeoff/drift census`. Plain `npx drift` runs a
project-local install only; without one, npm would fetch an unrelated package
named `drift`.

Each GitHub Release will have one archive per platform,
`drift-vX.Y.Z-<target>.tar.gz` (targets `x86_64-unknown-linux-musl`,
`aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, `aarch64-apple-darwin`,
`x86_64-pc-windows-msvc`), each holding the one `drift` (or `drift.exe`)
binary, plus `SHA256SUMS` and SLSA build provenance. Verify, then put it on
your `PATH`:

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify drift-vX.Y.Z-<target>.tar.gz --repo dadbodgeoff/drift
tar -xzf drift-vX.Y.Z-<target>.tar.gz && mv drift ~/.local/bin/    # any directory on PATH
```

The binaries are not code-signed or notarised; the checksums and provenance are
what you can verify. See [RELEASING.md](RELEASING.md).

## A five-minute first run

Run these in the repository you want Drift to learn, on a clean working tree.
Nothing leaves your machine, nothing reaches an agent until a person accepts it
(a suggestion needs one more step, below), and nothing blocks until you say so.

```sh
drift census     # preview: what Drift would propose; writes nothing
```

```sh
drift init       # write the proposals to .drift/conventions.yaml, baseline drift.lock
```

On a small synthetic Next.js-style repository with 40 route handlers, 38 of them
wrapped in `withAuth()` (the one `npm/dry-run.sh` builds), `drift init` prints:

```
Learned 1 conventions from 143 symbols (1 default tier, 0 suggestions).
1 default-tier proposal(s) are block candidates: not shown to agents until you accept them (`drift review --accept <id>`, or the Studio). People see them first.
Wrote .drift/conventions.yaml (all proposed: none is checked until you accept it with `drift review`; accepted conventions advise unless set to block)
Wrote drift.lock (2 legacy violations baselined)

Default tier: block candidates, each reaches agents once you accept it, and may block once accepted (`drift review`, b)

 1. [D-37416b] HTTP handlers in app/** (route files) are wrapped in withAuth()
    evidence: 38/40 (lower bound 0.83, lift 1.8)
    tier:     default
    agents:   not shown to agents (block candidate: reaches agents once you accept it)
    example:  app/api/r00/route.ts#GET
    outlier:  app/api/r38/route.ts:1 GET
    outlier:  app/api/r39/route.ts:1 GET

Next: `drift review` to accept or reject them.
Tip: add `drift.lock merge=union` to .gitattributes so branches never conflict on the lock.
```

Everything starts as a proposal, and a proposal is not checked at all. Read each
card's outliers: if they are mistakes, accept the convention; if they are a
legitimate, different kind of member (a test helper, a config file), reject it
or set those members apart. Small or uniform repositories often get no
proposals, and `drift init` then says why.

If `drift init` says it withheld cards, list them first (`drift review --hidden`; see **No proposals?** below): interactive review then says so and stops.

```sh
drift review     # interactive, needs a terminal: y accept (advise), b accept and block, a accept and show to agents, n reject, s skip, q quit
```

```sh
drift check      # new violations of accepted conventions; exit 1 only for those in block mode
```

With `D-37416b` accepted in advise mode, a new route without the wrapper is
reported and the exit code is 0:

```
drift: 1 new violation(s) (2 legacy, baselined)
[D-37416b] HTTP handlers in app/** (route files) are wrapped in withAuth() (38/40)
  at   app/api/new/route.ts:1 GET
  like app/api/r00/route.ts#GET
  mode advise
Advice: follow a convention where it fits the code; where it does not, no action is needed (no change, no comment). Wrong convention: `drift review --reject <id>`.
```

After `drift review --block D-37416b` the same check exits 1. For an
intentional exception, put `// drift-ignore D-37416b: <reason>` (`#` in Python)
directly above the declaration; a reason is required and suppressions are
counted so reviewers see them.

`drift review` with no flags needs a terminal: without one it prints
`drift review needs a terminal` and exits 2. In a script, pass ids:
`drift review --accept <id>` (`--list` prints the cards). Accepting a suggestion
does not show it to agents: run `drift review --show-to-agents <id>` for that.

**No proposals?** If `drift init` says `Learned 0 conventions` and names
withheld cards, the show policy held back every card it mined (on one
5,858-file monorepo, all 12). They are not conventions yet: nothing checks them
and no agent is told them. List them with their evidence, promote the ones that
are right, and show them to agents:

```sh
drift review --hidden
```

```sh
drift review --hidden --answer D-59eaf5=same
```

```sh
drift review --show-to-agents D-59eaf5
```

The answers are `ID=same` (accept), `ID=different --set-apart PATHS` (accept,
those files exempt as a different kind) and `ID=not-a-convention` (reject). See
[Getting started](docs/wiki/Getting-Started.md#if-drift-init-says-learned-0-conventions-but-also-names-withheld-cards).

On a repository of several thousand files each command reads the repository and
takes tens of seconds (5,858 files: `init` 24.7 s, `check` 8.7 s, `setup --list`
28.2 s, measured on one monorepo); interactive `drift setup` reads first and then
asks, so its first question comes after about 25 to 35 s.

Two more commands finish the first run. If `drift init` ends with "N questions
only you can answer would make these answers sharper", run `drift setup`: it asks
one question at a time, "skip" is always the default and writes nothing, and the
answers go to `.drift/config.yaml`. Then commit what Drift wrote (see the next
section for what to commit).

```sh
drift setup
```

Full walk-through: [Getting started](docs/wiki/Getting-Started.md),
[Conventions and review](docs/wiki/Conventions-and-Review.md) and
[Setup questions](docs/wiki/Setup-Questions.md).

### Investigate what Drift could not settle

`drift setup` asks a handful of questions. For every other route whose
authentication, authorization or reach Drift could not settle (`unknown`, or a
`none` or `internal` that is only "nothing found in what Drift read"),
`drift investigate` lists the route with the evidence to read, grouped by what
would settle it. It is meant for an agent to work through, with a person
confirming:

```sh
drift investigate                    # the open items; changes nothing
```

```sh
drift investigate --agent-brief      # the instructions an agent follows
```

```sh
drift investigate --record I-1a2b3c=not-a-check --reason "..." --evidence app/svc.py:40
```

An outcome follows the same rule as `drift setup`: one that only keeps or raises
Drift's caution takes effect (`not-a-guard`, `not-a-check`, `reachable`,
`skip`), and one that would make a fact (`guard:<file>#<symbol>`,
`check:<kind>:<file>#<symbol>`, `internal`) is a proposal that waits for a person
in `drift setup --review`. An unknown never becomes `none`. A real gap in the
code becomes a local finding in `.drift/findings/`, and a construct Drift does
not read becomes a local gap report in `.drift/gap-reports/`. Both directories
ignore themselves, and nothing is ever posted or sent. `drift findings` lists
them; on a person's request `drift findings --issue ID` prints an issue draft and
`drift findings --branch ID` makes a local branch with the agent's patch.
See [Using Drift with agents](docs/wiki/Using-Drift-with-Agents.md#investigating-open-routes).

## Drift inside git

Drift works on a git working tree and never changes git. This section says what
it reads, what it writes, what to commit, how branches and merges behave, and
how it fits pull requests, pre-commit, CI, monorepos and agent sessions. It was
checked against the code and run on a scratch repository.

### What Drift reads

- **The working tree, not history.** `drift init`, `census`, `check`,
  `security`, `practices`, `card` and `map` read the files as they are on disk,
  including uncommitted edits and untracked files. They do not read commits,
  other branches, the index or stashes.
- **`.gitignore` and `.ignore` are honoured**, in every directory. Global ignore
  rules and `.git/info/exclude` are not, so the result does not depend on the
  machine. Drift never enters `node_modules`, `.git`, `.next`, `.turbo`,
  `.drift`, `dist` or `build`, never follows symlinks out of the repository,
  skips files over 1 MB, and skips generated and minified code, including paths
  that `.gitattributes` marks `linguist-generated`. An ignore file that is a
  FIFO, a device or a link out of the repository makes Drift skip that directory
  with a warning.
- **Git itself is run in a few places, read-only.** `drift check --diff-base`
  and `drift security --diff-base` call `git diff`, `git merge-base` and
  `git rev-parse`, and, only when a new violation outside the diff would fail the
  check, `git read-tree` with `git checkout-index` into a temporary directory
  and a temporary index to scan the merge base (your working tree and index are
  never touched). The agent hooks ask which files changed since `HEAD` or are
  untracked. Drift runs `git ls-files` once to check that no one committed the
  fact cache. None of these fetches from a remote.
- **History is read in one case only:** the experimental wiring rules
  (`experimental: [wiring]` in `.drift/config.yaml`) read the newest commits of
  `HEAD` to learn which files change together. History is off by default, bounded
  in time and size, and never fetched; a shallow or partial clone gives no
  history rules and says why.
- **Drift does not commit, stage, stash, push or fetch, and it creates a branch
  only when a person asks.** It runs no `git` write command (`commit`, `add`,
  `checkout`, `reset`, `stash`, `push`, `fetch`) on your working tree or index. A
  hook, `drift review` or `drift init` changes files in the working tree and
  nothing else; what to commit is your decision. The one exception is
  `drift findings --branch ID`, which a person runs to turn an agent's patch into
  a local branch `drift/<id>`: it builds the commit through a throwaway index, so
  `HEAD`, your index and your working tree stay as they are, and it never pushes.

### What Drift writes, and what to commit

| Path | Written by | Commit it? |
| --- | --- | --- |
| `.drift/conventions.yaml` | `drift init`, `drift review` | **Yes.** The policy: proposals, decisions, modes, exceptions. CI, the Action, pre-commit and your teammates' hooks all read it. |
| `drift.lock` | `drift init`; `drift review` when it promotes a withheld card | **Yes.** Legacy violations that never block, one `<id> <path>#<symbol>` per line. Fix the code to shrink it. |
| `.drift/config.yaml` | you, `drift setup` | **Yes**, so teammates and CI get the same answers (compose files that deploy nothing, Terraform ties, declared practices). |
| `.drift/cache/` | every command | **No.** The fact cache and the agent session state (`.drift/cache/sessions/`). Drift writes a `.gitignore` of `*` there; a cache that git tracks is not used. |
| `.drift/review-log/` | `drift review --set-log on` (opt-in) | **No.** Local only; holds its own `.gitignore` of `*`. |
| `.drift/findings/` | `drift investigate` (a finding) | **No.** What an agent found: local only. Holds its own `.gitignore` of `*`; nothing posts or shares it. |
| `.drift/gap-reports/` | `drift investigate` (a gap report) | **No.** A minimal example of a construct Drift does not read, with the repository's names replaced. Holds its own `.gitignore` of `*`; nothing sends it. |
| `.drift/verify-cache.json` | the experimental agent verifier (`agents.verify: on` in `.drift/conventions.yaml`) | **No.** Verdicts an agent on that machine returned; Drift reads it whether or not git tracks it and gives it no `.gitignore`, so ignore it yourself. |
| `.gitattributes` line `drift.lock merge=union` | you | **Yes**, see below. |

A suggested `.gitignore` block. The cache, the review log, the findings and the
gap reports are already covered by the `.gitignore` Drift writes inside those
directories, so listing them only makes it explicit. `.drift/verify-cache.json`
exists only if you turn on the experimental agent verifier, and Drift does not
ignore it for you:

```gitignore
# Drift: local state. Commit .drift/conventions.yaml, .drift/config.yaml and drift.lock.
.drift/cache/
.drift/review-log/
.drift/verify-cache.json
.drift/findings/
.drift/gap-reports/
```

Do not ignore `.drift/` as a whole: that would drop the policy that teammates
and CI need. Commit after `drift review`; the Action checks the committed
policy, and pre-commit stashes unstaged changes before it checks, so a
`drift review` you have not staged does not count there:

```sh
git add .gitattributes .drift/conventions.yaml .drift/config.yaml drift.lock && git commit -m "Accept Drift conventions"
```

Agents cannot edit `.drift/` or `drift.lock`: the Claude Code hook denies those
edits and, best effort, shell commands that write there. Policy is changed by
people.

### Branches and merges

- **`drift.lock` is one sorted entry per line**, so add `drift.lock merge=union`
  to `.gitattributes` (`drift init` suggests it) and parallel branches never
  conflict on it:

  ```sh
  echo "drift.lock merge=union" >> .gitattributes
  ```

- **`.drift/conventions.yaml` is YAML and conflicts like any YAML file.** Resolve
  the markers by hand, keep both sides' decisions, then run `drift review --list`
  or `drift check`. A file left with conflict markers does not parse, and
  `drift check` stops with exit code 2 and the parse error: it is never a pass.
  Convention ids are stable (they do not change when the code moves), so two
  branches that each accepted a different proposal merge cleanly by keeping both.
- **Re-running `drift init` after a merge is safe:** it keeps every decision and
  id and adds only new proposals.
- **A change that edits the policy** (`.drift/conventions.yaml` or `drift.lock`)
  makes `drift check --diff-base` report every new violation, because dropping a
  lock entry turns that legacy violation into a new one.
- **Different branches give different answers** because Drift reads the working
  tree: switch branches and the next run reads the new files. The cache is keyed
  by content, so switching is cheap.

### Checking only what a change introduces

`drift check --diff-base <ref>` reports only violations introduced since the
merge base of `<ref>` and `HEAD`, in changed lines and added files. It is the one
flag for this: there is no `--base`, `--since` or `--diff`.

```sh
drift check --diff-base origin/main
```

A violation counts as introduced when its file was added, when a changed line
falls inside the declaration it sits on (editing a body counts), when it is
file-level and the file changed, when a renamed file did not have it before, or
when a change elsewhere caused it (a deleted wrapper). Legacy violations in
`drift.lock` and `drift-ignore` suppressions stay what they are. The exit code is
the usual one for what is reported. A base ref that does not resolve, a missing
merge base, or no git at all is exit 2, never a pass; a shallow clone says
`fetch-depth: 0 needed`. `drift security --diff-base <ref>` does the same for
the security inventory and always exits 0. `drift check --diff-base` works with
every `--format`; `--format github` prints one annotation per violation. Details:
[Drift in CI](docs/wiki/Drift-in-CI.md).

Exit codes of `drift check`: 0 with nothing to fail on, 1 when a reported new
violation is in block mode (any reported new violation with `--strict`), 2 on an
error.

### Pre-commit and CI

Pre-commit (needs `drift` on your `PATH`). The hook checks the whole working
tree when a commit stages TypeScript, JavaScript or Python files; a commit that
changes only `.drift/conventions.yaml` or `drift.lock` is not checked
(`pre-commit run drift-check --all-files` checks it by hand):

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/dadbodgeoff/drift
    rev: main                       # pin a tag or commit
    hooks:
      - id: drift-check             # or drift-check-strict
```

GitHub Actions. The Action builds Drift from source with `cargo`, so the first
run takes several minutes and later runs use the cache. On `pull_request` events
it runs `drift check --format github --diff-base origin/<base branch>` and
reports only what the pull request introduces, as annotations (`::error` for
block mode, `::warning` for advice, `::notice` for suggestions) and a job
summary. Every other event, `push` included, runs the full check. The job fails
on new violations of conventions in block mode (`args: --strict` fails on advise
mode too), and SARIF goes to code scanning. Forks get no `security-events:
write`, so turn the upload off for them.

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
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0           # optional: saves the Action deepening a shallow clone
      - uses: dadbodgeoff/drift@main   # pin a tag or commit
        with:
          drift-ref: main          # the Drift version to build: pin the same ref
          # pr-mode: "false"       # check the whole repository on pull requests too
          # upload-sarif: "false"  # private repos without GitHub Advanced Security, or PRs from forks
```

### Pull-request annotations

Today, a pull request gets the annotations and job summary above. With the
Action input `security: "true"` (off by default, until the shared-guard
precision is measured) it also runs `drift security --diff-base`, as notices that
never fail the job, and `security-comment: "true"` (needs
`pull-requests: write`) posts the same text as one comment when the pull request
introduces anything.

`drift security --diff-base` and `drift check --diff-base` also annotate every
http, server action, GraphQL or RPC entry point the change adds where Drift found
no guard in what it read, or cannot tell its guard, whatever its siblings do.
These are notices; they never fail the check.

### Monorepos

Run `drift init` once, at the repository root. Drift finds the packages
(`package.json`, `pyproject.toml`, `setup.cfg`, `setup.py` or `requirements*.txt`
directories, declared by a workspace manifest or nested) and mines each in its
own scope, but writes one `.drift/` at the root. `drift check`, pull-request
mode, the hooks and MCP find the package of a touched file from any directory,
so one policy covers every package and one `.gitattributes` line covers the lock.
`drift census` lists each package with its cards, or why it is silent. To
override what counts as a package:

```yaml
# .drift/config.yaml
packages:
  roots: [frontend, backend/services/*]   # explicit package roots (replaces discovery)
  exclude: [backend/services/legacy]      # not mined or checked
```

### During an agent's session

With the Claude Code plugin, hooks run `drift` while the agent works: at session
start (a brief and the baseline of current violations), before a write (the
accepted rules for what the file declares), after an edit (new violations in that
file, as facts), and at the end of the turn (blocking only on new violations of
conventions in block mode). Hooks tell new violations from the ones that were
there at session start, keep that baseline in `.drift/cache/sessions/`
(git-ignored), and never commit anything. If a session's state is missing, the
baseline is the violations in files unchanged since `HEAD`, so changed and
untracked files still count. Every hook
exits 0 with JSON, so a Drift failure never blocks the agent. See
[Using Drift with agents](docs/wiki/Using-Drift-with-Agents.md) and the
[hooks reference](docs/wiki/Hooks-Reference.md).

More: [Files Drift writes](docs/wiki/Files-Drift-Writes.md),
[Team rollout](docs/wiki/Team-Rollout.md),
[Security and privacy](docs/wiki/Security-and-Privacy.md).

## The commands at a glance

Each command's `--help` has examples. The full list of flags, outputs and exit
codes is in the [command reference](docs/wiki/Command-Reference.md).

| Command | What it does | Writes |
| --- | --- | --- |
| `drift census` | Previews the conventions Drift would propose, with evidence; `--coverage` says how much of the repository Drift maps | nothing |
| `drift init` | Learns conventions, writes them as proposals, baselines legacy violations | `.drift/conventions.yaml`, `drift.lock` |
| `drift review` | Accepts, blocks, sets to advise, rejects or marks exceptions; interactive without flags | `.drift/conventions.yaml` |
| `drift check` | New violations of accepted conventions; `--strict`, `--diff-base`, `--format text\|json\|sarif\|github` | nothing |
| `drift example FILE` | The existing file to copy from when writing new code like `FILE` | nothing |
| `drift card PATH` | One file's place: entry points, guards, exposure, siblings, rules, what is not known | nothing |
| `drift practices` | What the code does per concern (authn, authz, errors, logging, API, validation, config, data access, testing); `--hints` | nothing |
| `drift security` | Entry points, guards, exposure, risky operations, client leaks, env reads; `--diff-base` for a change | nothing |
| `drift map` | Packages, layers, dependency graph, entry points, roles | nothing |
| `drift setup` | The few questions only a person can answer; `--list`, `--json`, `--agent-brief` for agents | `.drift/config.yaml` |
| `drift investigate` | Every route Drift could not settle, with the evidence; records an agent's or a person's outcome; `--json`, `--record`, `--agent-brief` | `.drift/config.yaml`; local findings and gap reports (only when recording) |
| `drift findings` | What an agent found, local only; `--issue ID` an issue draft, `--branch ID` a local branch with the patch | nothing (`--write FILE`; a local branch on request) |
| `drift export agents-md` / `claude-settings` | A rules block for AGENTS.md or CLAUDE.md; permission entries for read-only lookups | only with `--write` |
| `drift mcp` | Serves 12 MCP tools over stdio: ten that only read, and `drift_setup_answer` and `drift_investigate_record`, which write ([MCP reference](docs/wiki/MCP-Reference.md)) | `.drift/config.yaml`, findings and gap reports, only through the two writing tools |
| `drift hook claude EVENT` | The Claude Code hook handler ([hooks reference](docs/wiki/Hooks-Reference.md)) | cache and session state |
| `drift scan`, `drift facts` | The fact index of the repository, or of one file | cache |

Every command takes `--root <ROOT>` (default `.`) and `--no-cache`. The JSON
outputs are documented in the
[output reference](docs/wiki/Output-and-JSON-Reference.md). In JSON, an
internet-facing entry point has `exposure` `public`; `internal` and `unknown`
are written as they are.

**What blocks and what only advises.**

| | Proposed | Accepted (advise) | Accepted (block) |
| --- | --- | --- | --- |
| `drift check` | not checked | listed, exit 0 | listed, **exit 1** |
| `drift check --strict` | not checked | **exit 1** | **exit 1** |
| Claude Code, before writing and after an edit | nothing (block candidates included) | advice | advice, marked `(blocks)` |
| Claude Code, end of turn | nothing | nothing | **blocks** (steps aside after 3 blocks or no progress) |
| GitHub Action | nothing | code scanning warning (note for suggestions) | code scanning error, **job fails** |
| pre-commit `drift-check` | nothing | nothing | **commit fails** |

Only a person puts a convention in block mode. Default-tier conventions can
block once a person sets them to; suggestions only advise unless forced
(`drift review --block <id> --force`); a role of fewer than 15 members never
blocks. The tiers and the release gate are explained in
[Conventions and review](docs/wiki/Conventions-and-Review.md).

## Configuration at a glance

Settings live in `.drift/config.yaml` (commit it). Drift reads it with defaults,
so a missing file is fine. The full key list, with types, defaults and examples,
is in the [configuration reference](docs/wiki/Configuration-Reference.md).

| Key | Effect |
| --- | --- |
| `proposals: {python: off}` | Do not make Python proposals (on by default, as suggestions only) |
| `packages: {roots, exclude, include}` | Override which directories are packages |
| `security: {internal, public, not_deployed, terraform}` | Say what is internal or public, which deployment files deploy nothing, and which Terraform target group forwards to which code |
| `practices: {authn: {...}, authz: {...}}` | Declare an instrument Drift cannot classify alone (`drift practices --hints` prints the lines) |
| `setup:` | Where `drift setup` and `drift investigate` record answers and outcomes (written by the commands; do not hand-edit) |
| `experimental: [...]` | Opt-in features: `wiring`, `intra_package_layering`, `test_roles`, `kind_roles` |
| `agents: {brief: off}` | Turn off the session-start brief |

`.drift/conventions.yaml` holds the policy; its top-level keys include
`suggestion_cap: <N|all>` (how many suggestions are listed), `agents:` and
`review_log:`. The environment variables Drift reads, including `DRIFT_CACHE_DIR`
(move the cache) and `DRIFT_HOOK_TRACE=<file>` (append one JSON line per hook with
its path and timing), are in the configuration reference.

## Using Drift with agents

With `drift` on your `PATH`, install the Claude Code plugin and the MCP server:

```sh
claude plugin marketplace add dadbodgeoff/drift
claude plugin install drift@drift
```

In a repository with `.drift/conventions.yaml`, the agent is told the accepted
rules before it writes a new file, is advised after each edit that breaks one,
and is stopped at the end of its turn only by conventions in block mode. **Only
accepted conventions reach the agent, and an accepted suggestion only after
`drift review --show-to-agents <id>`** (or when its rule family is admitted). Without the plugin, register the MCP server
yourself and allow the read-only lookups:

```sh
claude mcp add drift -- drift mcp
```

```sh
drift export claude-settings --write .claude/settings.json
```

```sh
drift export agents-md --write AGENTS.md
```

The last one keeps a short generated block of accepted conventions in AGENTS.md
or CLAUDE.md, ending with one rule: run `drift card <target file>` before
searching for how the codebase handles auth, validation, errors, routes or data
access. Agents should treat `unknown` as "Drift could not tell" and `none` as
"nothing found in what Drift read", and grep for what Drift reports as not
known. An agent can also go through the `drift setup` questions for you
(`drift setup --agent-brief`); an answer that would make Drift say more waits as
a proposal until a person confirms it. `drift investigate --agent-brief` does the
same for every other open route (see "Investigate" above); the MCP tools
`drift_investigate_items` (reads) and `drift_investigate_record` (writes) are its
agent interface. More: [Using Drift with agents](docs/wiki/Using-Drift-with-Agents.md),
[Setup questions](docs/wiki/Setup-Questions.md),
[Hooks reference](docs/wiki/Hooks-Reference.md) and
[MCP reference](docs/wiki/MCP-Reference.md).

## Accuracy and limits

The full figures, each marked in-sample or out-of-sample with its source, are in
[How accurate is it?](docs/ACCURACY.md). In short:

| | In-sample (the dev repos the fixes were built on) | Out-of-sample (blind and held-out pools) |
| --- | --- | --- |
| TypeScript/JavaScript default tier, accepted | 100% (30/30) | **46.7% (7/15)**, Wilson 24.8–69.9% |
| TypeScript/JavaScript suggestions after the show policy, accepted | – | **85.7% (6/7)**, 4 repos |
| Python, everything shown, accepted (round 10) | 100% (12/12) | **50.0% (1/2)** |
| Python, everything shown, accepted (the dev5-py-check) | 83.3% (25/30) | **90.9% (10/11)**, Wilson 62.3–98.4%, a blind dev pool |
| Accepted cards per TypeScript/JavaScript repo | 2.69 | **0.58** (median 0) |

Every label comes from blind labelling agents under rubric v3, not from real
maintainers. Sources: [`eval/study/PLAN-R11.md`](eval/study/PLAN-R11.md) §1–§3,
[`eval/study/runs/dev3-ts-2026-11-08/dev3-check.md`](eval/study/runs/dev3-ts-2026-11-08/dev3-check.md)
and [`eval/study/runs/dev5-py/dev5-check.md`](eval/study/runs/dev5-py/dev5-check.md).

- **The default tier has not passed the release gate** (≥ 95% accepted on a
  held-out set). No language has met it, so `drift init` proposes everything in
  advise mode and nothing blocks unless a person sets it to block. Review every
  proposal; do not accept them in bulk.
- **The in-sample figures are optimistic.** Out of sample, the wrong
  default-tier cards were mostly scope errors: the role also holds a recurring,
  different kind of member that the rule should not cover. They show in the
  card's outliers, which is why `drift review` lists them.
- **Expect few proposals:** about 1 card shown and 0.6 accepted per
  TypeScript/JavaScript repository out of sample; most repositories get none.
- **Python proposals are suggestions only, and their evidence is small.** No
  Python accuracy claim is made, and no Python convention blocks unless a person
  forces it.
- **Conventions only.** Drift checks what your code already does; it is not a
  linter, a type checker or a security scanner. It is a guardrail, not a
  security control.
- **The practice map says `known` for authorization only on proof, so most
  routes read `unknown`.** On a 3,200-file monorepo, 19 of 137 authorization
  units are known and 116 unknown, 64 of them with a check that was found and is
  not proven; authentication reads 150 known, 20 none and 8 unknown of 178. An
  earlier build read 74 of the authorization units known; that included answers
  that were not proven, and an independent review found about 14 of 31 sampled to
  be false. A check Drift found but could not prove is reported as `unknown` with
  the reason, never as proven.
- **`drift security` says `internal` only as "internal in what Drift read", on
  what it could read.** With a second compose
  stack, or Terraform or Kubernetes that Drift does not read, routes that are
  internal in production read internet-facing or unknown until
  `security.not_deployed` names what deploys nothing and `security.terraform`
  ties the code to its target group.
- **Frameworks and constructs that are not listed or read** are in
  [Languages and frameworks](docs/wiki/Languages-and-Frameworks.md); a route
  Drift cannot list is not in the inventory, and every report ends with what it
  does not cover.

More: [Accuracy and Limits](docs/wiki/Accuracy-and-Limits.md),
[How Drift works](docs/wiki/How-Drift-Works.md) and the
[Glossary](docs/wiki/Glossary.md).

## Drift Studio

The Studio is a desktop app over the same CLI: it lists the proposals (block
candidates first, with their outliers), lets you accept, block or reject them
through `drift review`, and shows violations, agent sessions, the codebase's
shape and its security inventory. It is not packaged yet: run it from a checkout
of this repository, with `drift` on your `PATH` (or chosen in its Settings):

```sh
npm ci
```

```sh
npm run start -w drift-studio          # build and open the desktop app
```

```sh
npm run dev -w drift-studio            # the renderer in a browser, on fixtures
```

Nothing is sent anywhere. Details: [apps/studio/README.md](apps/studio/README.md).

## Design and safety

```
files -> ingest -> language parser (oxc, ruff) -> facts -> mining -> conventions
      -> review -> conventions.yaml + drift.lock -> check -> CLI / hooks / CI
```

| Crate | Role |
| --- | --- |
| `drift-core` | Language-neutral fact model, safe ingest, content-addressed fact cache |
| `drift-ts` | TypeScript/JavaScript parser on oxc, module resolution, framework adapters |
| `drift-py` | Python parser on ruff, import resolution, framework adapters ([details](docs/v2/PYTHON.md)) |
| `drift-mine` | Roles, convention mining, policy, lock and check (language-neutral) |
| `drift-cli` | The `drift` binary |

- **Deterministic.** Output is byte-identical across runs, thread counts,
  operating systems and checkout paths, and this is tested.
- **Safe on hostile repos.** Drift never follows symlinks out of the repo, never
  runs repo scripts, skips files over 1 MB, and skips generated and minified
  code. It writes nothing through a symbolic link that leaves the repo: such a
  link at `.drift/conventions.yaml`, `drift.lock` or an export target is refused
  (exit 2), and a fact cache with a link in it is not used. A fact cache that git
  tracks is not used either, so committed facts cannot hide a violation; the
  GitHub Action also uses a fresh cache outside the checkout.
- **Bounded memory.** Each file is parsed in its own arena and freed once it is
  turned into facts. Facts are cached by content hash.
- **No network, no telemetry.** Drift makes no network call and has no
  telemetry. See [Security and privacy](docs/wiki/Security-and-Privacy.md) and
  [SECURITY.md](SECURITY.md).

The pipeline, the cache and what "proven" means are in
[How Drift works](docs/wiki/How-Drift-Works.md).

## Contributing, support and license

- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) lists the gates CI runs
  (`scripts/gates.sh` runs them locally). Releases are made only in CI:
  [RELEASING.md](RELEASING.md).
- **Support:** open an issue on the GitHub repository. Report a vulnerability
  privately through the repository's Security tab, as [SECURITY.md](SECURITY.md)
  says; do not open a public issue.
- **Upgrading and compatibility:**
  [Versioning and upgrades](docs/wiki/Versioning-and-Upgrades.md) and the
  [beta release notes](docs/RELEASE-NOTES-beta.md).
- **License:** [Apache-2.0](LICENSE).
