# Quickstart

Drift learns one convention from your repository, records the code that already violates it, and
blocks new violations in changed code. It runs entirely on your machine.

## Install and onboard

```bash
npm install -g @drift/cli
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

The output tells you three things worth reading:

```
Stored 107276 facts.
Accepted default convention.
Baselined 417 existing violations.
```

**417 baselined violations is not a backlog.** It is the code Drift will *not* complain about.
New code is held to the convention; existing code is grandfathered until you choose otherwise.

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
modify your source. The security heuristics are behind `--experimental-security` and are not
proofs; see [architecture/security-heuristic-audit.md](./architecture/security-heuristic-audit.md).
