# CHARTER 03 — CLI command surface

**Depends on:** 00 · **Est. 4 h** · **Output:** `results/03-cli-command-surface.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 03 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 03 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 03` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Execute **every** command path Drift exposes, in every mode it supports, and record what each one
actually does. This is the inventory charter: it establishes the true surface, not the documented
one. Charter 04 then compares the documentation to what this charter found.

## 2. The surface

Two dispatch sites:

- `packages/cli/src/app/run-cli.ts:46-82` — four paths handled **before the database opens**:
  `capabilities`, `doctor`, `restore`, `backup verify`.
- `packages/cli/src/app/router.ts` — **50** `if (group === ...)` arms.
- `router.ts` final line — unknown-command fallback: `Unknown command: ... Run drift --help.`
- `run-cli.ts:27-35` — `version` / `--version`; `args/help.ts` — `help` / `--help` / no args.

Derive the exact list yourself rather than trusting this file:

```bash
grep -nE '^\s+if \(group === ' packages/cli/src/app/router.ts
grep -nE 'positional\[0\] === ' packages/cli/src/app/run-cli.ts
```

Note the `candidates` group (`candidates`, `candidates show`, `candidates accept`,
`candidates reject`) — present on current `main` and **absent from the forensics report's §20f
inventory**. Treat any other such delta as a finding for §6 of the results file.

## 3. Procedure

Build one repo with real state (a scanned shape-A repo from charter 02, or equivalent) so that
read commands have something to read. Then, for **every** command path:

| Probe class | What to record |
|---|---|
| P-03-a | Invoke with correct arguments. Exit code, stdout, stderr. |
| P-03-b | Invoke with `--json`. Does it emit valid JSON on stdout with nothing else interleaved? Parse it. |
| P-03-c | Compare text and JSON for **content parity** — every fact in one present in the other. `doctor` is the known exception (§20h: two independently-authored renderers); find out whether it is the only one. |
| P-03-d | Invoke with a required argument missing. Stated error or stack trace? Exit code? |
| P-03-e | Invoke with an unknown flag. Ignored silently, or rejected? |
| P-03-f | Invoke with **no** `--db`, no `DRIFT_DB`, no `--repo-root`, no `--state-root`, from a cwd outside the repo. Record which commands auto-resolve and which throw `Missing --db <path> or DRIFT_DB.` |
| P-03-g | Capture every `next_commands` string the command emits, then **execute each one verbatim** in the P-03-f environment. Record pass/fail per suggestion. |
| P-03-h | Where the command mutates state, confirm it wrote an `audit_events` row (`drift audit list`) — and where it does not, record that. |

Mutating commands (`init`, `scan`, `start`, `conventions accept/reject/edit/exception add`,
`candidates accept/reject`, `contract import`, `findings *`, `baseline create/clear`,
`policy set-egress`, `policy agent grant/revoke`, `backup create`, `restore`) each get a fresh
`--state-root`.

## 4. The `--db` resolution matrix — the core deliverable

`resolveDatabasePath` (`packages/cli/src/args/repo-flags.ts:26-62`) auto-resolves only when:

1. `--db` or `DRIFT_DB` is set, or
2. `positional[0]` ∈ {`init`, `scan`, `start`} — and because the check is on `positional[0]`
   alone, `scan status` qualifies too and **creates the state directory as a side effect of a
   read-only status check**, or
3. `--repo-root` or `--state-root` is passed on any command, or
4. `positional[0]` ∈ {`check`, `prepare`} **and** the default DB already exists.

Produce a table of all ~54 paths × {auto-resolves, requires `--db`, `--db`-free by construction}
built from **observed behavior**, not from reading the source. `backup verify` is documented as
`--db`-free (`commands/backup.ts:122`); confirm it.

## 5. Benchmarks

| Metric | n |
|---|---|
| Per-command wall time, warm state, text mode | 10 each |
| Per-command wall time, `--json` | 10 each |
| Slowest 5 commands, ranked | — |

Flag any command whose median exceeds 2 s on a small repo; charter 16 takes those to scale.

## 6. Oracles

- Every path in the surface is reachable and terminates.
- No path emits a raw stack trace. Every failure is a stated reason with a documented exit code
  from the `FAILURE_CONTRACT` vocabulary (charter 13 owns that contract in full).
- `--json` output is parseable JSON, alone on stdout.
- Every emitted `next_commands` string executes successfully as printed.

## 7. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-03-1 | `doctor`'s printed next steps include `drift audit verify …`, `drift backup list …`, `drift backup create …`, none of which auto-resolve `--db` — so doctor's own advice fails when pasted. | §18b, `args/doctor-commands.ts:48-72` | P-03-g on `doctor` |
| S-03-2 | `scan status`'s next steps include `drift repo map …` and `drift audit verify …`, both outside the auto-resolve set. | §18b, `domain/scan-status.ts:1113-1123` | P-03-g on `scan status` |
| S-03-3 | `scan status` creates the state directory despite being a read-only status check. | §18b, `repo-flags.ts:50-52` | P-03-f: run `scan status` in a temp dir with no state; check the filesystem after. |
| S-03-4 | `next_commands` are generated by 24+ independent hand-written builders with no shared builder; of 148 template lines only 3 carry `--db`. | §22 obs. 18 | Aggregate every emitted suggestion across all commands; count how many carry `--db` and how many need it. |
| S-03-5 | The `candidates` group exists on `main` but is absent from the audit's command inventory. | this charter's §2 | Enumerate and diff. |
| S-03-6 | `doctor`'s text and JSON are independently authored string-building blocks, unlike every other multi-surface command. | §22 obs. 20 | P-03-c across all commands; is doctor the only divergence? |

## 8. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). A command that hangs gets a 120 s timeout, is recorded
as a hang with its state, and the charter continues.

## 9. Deliverables

`results/03-cli-command-surface.md` including the full command × mode matrix and the `--db`
resolution matrix; raw transcripts under `results/artifacts/03/`.
