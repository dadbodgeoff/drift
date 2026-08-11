# Agent integration

Drift's differentiator is that an agent can **query** a repo's established patterns before
writing code, rather than having them audited afterwards. Three surfaces.

## MCP server

```bash
drift-mcp --db ~/.drift/repos/<repo_id>/drift.sqlite
```

Read-only: twelve tools, no mutation tools at all. An agent can read the contract, findings, repo
map and preflight context, and cannot accept a convention, suppress a finding, or change policy.
Those stay human-confirmed.

The most useful tool is `get_task_preflight`:

```json
{ "name": "get_task_preflight",
  "arguments": { "repo_id": "repo_…", "task": "add an endpoint that lists workspace invites" } }
```

It returns the files that already implement the pattern, the conventions in scope, required
checks, and what the agent is permitted to read.

**Protocol.** The server speaks revision `2024-11-05` and accepts clients declaring newer
revisions, replying with its own version — the spec-correct posture. Verified against a client
two revisions newer: full session, tools listed, calls served. See
[architecture/mcp-compatibility.md](./architecture/mcp-compatibility.md), including its stated
limits.

**Cost.** A preflight packet is roughly 20,000 tokens on a small repo. Most of that is real
content, but budget for it — an agent calling this on every turn will notice.

## Edit-time hooks

**Not shipped.** The design is a `PostToolUse` hook running `drift check` scoped to the edited
file, blocking with the finding as feedback.

It is not shipped because a single-file check currently takes ~3.9 seconds on a 4,000-file repo,
against a target of under one second. A guardrail that pauses four seconds on every edit gets
disabled, and a disabled guardrail enforces nothing — so the honest state is "correct but too
slow", not a shipped feature with a caveat. Detection itself is verified: a violating edit exits
`2` with one blocking finding, a clean edit exits `0`.

Tracked as T44, blocked on T45.

## CI

```yaml
- run: npx @drift/cli check --diff origin/main...HEAD --scope changed-hunks --json
```

Branch on the exit code: `0` pass, `2` the diff violates the contract, `3` Drift refused to
answer, `1` Drift broke. Treat `3` as a failure — it means no enforcement claim was made.

**Caveat that matters.** A committed contract cannot currently be imported by CI or by a
teammate. Repo identity is derived from the **absolute path**, so every checkout is a different
repo and `contract import` refuses with `repo_id_mismatch`. Until that changes, each environment
must onboard for itself. Tracked as T19b.

## What an agent should be told

Point the agent at the contract, not at Drift's opinions. The useful framing is "this repo routes
data access through services, here are three examples" — not "do not import prisma". The first
is a pattern to follow; the second is a rule to work around.

`prepare` and `get_task_preflight` both return that shape. Ranking is by task relevance: a file
whose path names what the task is about ranks far above one that merely sits in a convention's
scope. Measured with `pnpm eval:prepare` across three real repos.

## Sharing a contract: `drift.lock`

A contract can be committed and reviewed like a lockfile.

```bash
drift contract export --repo <repo_id> --output drift.lock --confirm
git add drift.lock && git commit -m "pin drift conventions"
```

A teammate, or CI, then adopts it:

```bash
drift contract import drift.lock --repo <repo_id> --confirm
```

The framing is the point. A lockfile name says *committed, diffable, changes on purpose* in a way
`contract.json` does not — a convention change shows up in review as a diff someone has to approve,
which is where a change to what the whole team is held to belongs.

**This only became possible in T120.** Repo identity used to be `hash(absolute path)`, so every
checkout was a different repository and `contract import` refused a committed contract with
`repo_id_mismatch` — correctly by its own logic, and uselessly. Identity is now derived from the git
remote and root commit, so two checkouts agree.

What still gets refused, and should be: a contract from a *different* repository fails on
`repo_fingerprint_mismatch`. Verified both directions on two checkouts of taxonomy plus a cal.com
contract.

Two things to know:

- `drift doctor` reports the identity source. If it says the identity is path-derived — no git
  history, or no remote and no `package.json` name — a contract exported there **will not** import
  elsewhere, and that is worth checking before relying on the flow.
- The importer re-keys the contract to the local repo id. That id names the local state directory
  and is not portable; the fingerprint is what establishes the contract belongs here.
