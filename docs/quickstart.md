# Quickstart

Drift learns one convention from your repository, records the code that already violates it, and
reports new violations in changed code — blocking them once the convention is in block mode, which
[most repos have to opt into](#why-your-repo-might-only-warn). It runs entirely on your machine.

## Install

**Nothing is published to npm yet.** `npm install -g @drift/cli` fails with `E404`, and the
`driftdetect` package on npm is an unrelated v1 from January. Until a release exists, the install
is a build from source, which needs a Rust toolchain ([rustup](https://rustup.rs)) because the scan
engine is Rust.

```bash
git clone https://github.com/dadbodgeoff/drift.git && cd drift
pnpm install --frozen-lockfile
pnpm build && pnpm build:engine

# There is no `drift` binary yet; the entry point is the built CLI.
alias drift="node $PWD/packages/cli/dist/main.js"
```

## Onboard

```bash
cd your-repo
drift doctor --repo-root .
```

`doctor` reports what Drift will and will not be able to do here — TypeScript files found, API
routes detected, disk space and heap headroom for the scan. Fix anything it marks `fail` first;
those are the conditions that make a scan produce results you should not trust.

```bash
drift start --repo-root . --accept-defaults
```

On a 5,000-file monorepo this takes around 35 seconds. It scans, infers a candidate convention,
accepts the strongest one, and baselines every existing violation.

The output tells you what was decided, in the mode it was decided in:

```
Stored 107276 facts.
Found 21 convention candidates.

Accepted "api_route_no_direct_data_access" in WARN mode (417 existing violations baselined —
new violations will be reported but will NOT block).
To make this a gate: drift conventions accept convention_… --repo repo_… --severity error --mode block --confirm
```

**417 baselined violations is not a backlog.** It is the code Drift will *not* complain about.
New code is held to the convention; existing code is grandfathered until you choose otherwise.

**Read the mode word.** In `WARN` mode nothing blocks: a new violation is reported and `drift
check` still exits `0`. Onboarding says so rather than announcing readiness, because the two are
different states and only one of them stops an agent. Why your repo probably lands in warn mode is
[below](#why-your-repo-might-only-warn).

## Check a change

```bash
drift check --diff main...HEAD --scope changed-hunks
```

| Exit | Meaning |
|---|---|
| `0` | nothing blocking |
| `2` | a new violation in changed code |
| `3` | Drift declined to answer — see below |
| `1` | Drift itself failed |

`3` is a refusal, not a pass: the scan was stale, no contract exists, the engine was unavailable,
or there was not enough disk. Drift will not tell you a diff is clean when it could not check.

## Why your repo might only warn

If `drift check` reports findings but exits `0`, the convention is in **warn** mode. That is
deliberate, and the reason is worth understanding.

Drift infers the convention *from the violations themselves*. A repo where every route touches
the database directly produces the same statement as one where a single route does. Enforcing
both identically would reject new code written exactly like its neighbours — which is the
opposite of holding code to the repo's established patterns.

So the mode follows the evidence: **a minority violating** means the convention is real and new
violations block; **a majority violating** means it is a refactor goal, and Drift warns until a
human decides. Measured across the evaluation repos, formbricks (1 route of 83) blocks and dub
(~323 of 494) warns.

To override:

```bash
drift conventions accept <candidate_id> --severity error --mode block --confirm
```

## Give an agent context

```bash
drift prepare "add an endpoint that lists workspace invites" --json
```

Returns the files that already implement this pattern, the conventions in scope, and the required
checks — so an agent can follow your repo's conventions rather than infer them from a sample.

See [agent-integration.md](./agent-integration.md) for MCP and hooks.

## When something goes wrong

Every failure carries a code, a cause, and a next action. `drift doctor --json` is the first
thing to run. [reference/errors.md](./reference/errors.md) lists every code.

## What Drift does not do

It enforces **one** convention kind well — API routes not importing data-access clients directly,
in TypeScript and JavaScript. It does not review code generally, support other languages, or
modify your source.

**Routes mean Next.js routes.** Route detection recognises app-router
`**/app/**/route.{ts,tsx,js,jsx}` and pages-router `**/pages/api/**`, and nothing else. On an
Express, Fastify, NestJS or SvelteKit repo the scan still indexes files and stores facts, but no
file is recognised as a route, so onboarding proposes zero candidates and there is nothing to
accept. `drift start` says so; rescanning does not change it.

The security heuristics are behind `--experimental-security` and are not
proofs; see [architecture/security-heuristic-audit.md](../internal/architecture/security-heuristic-audit.md).

`drift conventions list` also hides candidates below a coverage floor by default. It reports how
many it withheld and prints the command that shows them — `--include-low-confidence` for the
floor, `--experimental-security` for the quarantined security kinds.
