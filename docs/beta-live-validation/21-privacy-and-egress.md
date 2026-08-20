# CHARTER 21 — Privacy and egress

**Depends on:** 09 · **Est. 2 h** · **Output:** `results/21-privacy-and-egress.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 21 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 21 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 21` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Drift describes itself as "local-first repo intelligence." This charter tests that claim by
observation rather than by reading the code: watch the network, read every artifact the tool
produces, and determine whether any source content leaves the machine or lands somewhere the user
did not choose.

## 2. Mechanism under test

- `packages/cli/src/commands/policy.ts` — `show` `:13`, `check-context` `:34`, `set-egress` `:99`,
  `agent grant` `:203`, `agent revoke` `:283`. `domain/policy-context.ts`.
- `packages/cli/src/commands/support.ts:9` (`supportBundle`) — the artifact most likely to carry
  source content off the machine, because its whole purpose is to be sent to someone.
- `drift ask` / `drift prepare` redactions: `snippets_included: false`,
  `source_content_included: false` (`ask.ts:116-117`), matching the help text's claims
  (`args/help.ts:111,126`).
- MCP `get_security_context` / `get_allowed_context` (charter 19 P-19-13).
- Engine ↔ CLI is a subprocess boundary, not a network one — confirm that.

## 3. Procedure

### Observed egress

| Probe | What to do |
|---|---|
| P-21-01 | Run a **full** lifecycle — `init`, `scan`, `start`, `candidates`, `conventions accept`, `check`, `prepare`, `ask`, `repo map`, `security audit`, `doctor`, `support bundle`, `backup create` — with the network monitored end to end. Use a packet capture or an outbound-deny firewall with logging; do not rely on the absence of an HTTP client in the source. Record **every** outbound connection attempt, including DNS. |
| P-21-02 | Repeat with **no network at all** (interface down). Every command must still work. Anything that degrades, hangs, or times out reveals a dependency. |
| P-21-03 | Confirm the engine subprocess makes no network calls of its own — monitor the child process specifically, not just the parent. |
| P-21-04 | Telemetry, analytics, crash reporting, update checks: grep the packed artifact (charter 01) for endpoints, then confirm behaviorally with P-21-01. |

### Written artifacts

| Probe | What to do |
|---|---|
| P-21-05 | Enumerate **every** path Drift writes to during P-21-01: state root, temp files, caches, lock files, logs, anything in `$HOME`. Use filesystem-level tracing (`fs_usage`/`strace`), not inference. |
| P-21-06 | For each written file: does it contain source content? Search each artifact for distinctive strings planted in the fixture repo. |
| P-21-07 | Permissions on every written file and directory. Is state world-readable? |
| P-21-08 | Temp files: are they cleaned up? Do they survive a crash? Are they in a shared `/tmp` where another user could read them? |

### Payload redaction

| Probe | What to do |
|---|---|
| P-21-09 | Plant unique sentinel strings in the fixture repo: in a source line that violates a convention, in a comment, in a string literal, in a filename, in an env-var-looking assignment, in a `.env` file. Then run `prepare`, `ask`, `check --json`, `repo map --json`, `security audit --json`, and every MCP tool. **Grep every payload for every sentinel.** Report exactly which sentinels appear in which payloads. |
| P-21-10 | Findings carry file paths and line numbers by design. Confirm they do **not** carry the line's content, and record whether evidence records do — `graph_evidence` ties nodes back to source spans; establish whether a span is a location or a copy. |
| P-21-11 | `support bundle` — the highest-risk artifact. Enumerate its full contents. Does it include source? Absolute paths revealing directory structure? Environment variables? The SQLite database, which contains facts derived from source? Is the user shown what it contains **before** it is written? |
| P-21-12 | `contract export` — does the exported contract carry source content, or only structure? It is designed to be shared between repos and checked into version control. |
| P-21-13 | `backup create` (charter 18) — the artifact contains the whole database. Confirm the user understands that, and check permissions on it. |
| P-21-14 | Secret-adjacent content: a repo containing a real-looking API key. Does it appear in any payload, any log, any error message, or any finding's evidence? The `api_route_forbids_secret_exposure` convention is *about* secrets — confirm that detecting a secret never means echoing it. |

### Policy surface

| Probe | What to do |
|---|---|
| P-21-15 | `policy show`, `policy check-context`. What is the default egress policy, and is it default-deny? |
| P-21-16 | `policy set-egress` — set a restrictive policy, then confirm it is actually enforced by attempting whatever it forbids. A policy command that records a preference nothing consults is decorative; establish which this is. |
| P-21-17 | `policy agent grant` / `revoke` — what does a grant permit, and what does a revoke stop? Verify behaviorally through the MCP surface (charter 19). |
| P-21-18 | Does any policy state survive `backup`/`restore`, and does restoring an old backup silently re-grant a revoked agent? |

## 4. Benchmarks

Counted, not timed:

- outbound connection attempts during a full lifecycle (expected: 0)
- sentinel strings found in payloads, by sentinel class and payload
- files written outside the declared state root
- world-readable artifacts containing repo-derived data

## 5. Oracles

- Zero outbound network activity from any command, including DNS.
- Every command works with the network down.
- No source content in any payload, log, or artifact except where the user explicitly asked for it.
- `support bundle` discloses its contents before writing.
- A revoked grant stays revoked.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-21-1 | `ask` and `prepare` payloads declare `snippets_included: false, source_content_included: false`, matching the help text. | §20g, `ask.ts:116-117` | P-21-09 tests the reality, not the declaration |
| S-21-2 | Evidence records tie graph nodes and edges back to **source spans** — establish whether a span carries content or only coordinates. | §19e, `graph_evidence` | P-21-10 |
| S-21-3 | The engine is a subprocess, and the CLI↔engine boundary is local IPC with no network component. | §3.1 | P-21-03 |
| S-21-4 | A support bundle exists and is intended to be sent to a third party. | §20f, `commands/support.ts:9` | P-21-11 |
| S-21-5 | The egress policy surface exists; whether it is enforced or advisory is not established anywhere in the audit material. | §20f | P-21-16 |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). Any sentinel found in any payload gets its own `F-21-n`
block naming the sentinel class, the payload, and the code path that placed it there — and is
repeated in §1.

## 8. Deliverables

`results/21-privacy-and-egress.md` with the sentinel × payload matrix, the written-path inventory,
and the network capture summary; captures and artifact listings under `results/artifacts/21/`.
