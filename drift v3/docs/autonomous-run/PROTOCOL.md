# Autonomous run protocol

**Supersedes Phase 0 of AUTONOMOUS_PLAN.md.** Written for a single long unattended run, not a
supervised session. The governing rule: **never halt on a single task. Triage it, log it, continue.**

---

## 1. Per-task lifecycle

```
for each task in plan order:
  if task.id in run log with status DONE      -> skip (resume safety)
  if task.dependency is BLOCKED               -> log SKIPPED_DEPENDENCY, continue
  if task is human-gated                      -> log DEFERRED_HUMAN, continue

  attempt task
  run verification tier for task

  if DoD met:
     commit (one commit, task id in subject)
     append DONE to run log, commit log
  else:
     git reset --hard <last green commit>     # never leave a broken tree
     git clean -fd
     append BLOCKED to run log with full detail, commit log
     continue to next task
```

**The tree is always green between tasks.** A failed task is reverted, not left half-applied. Git
makes this cheap and it means task N+1 never inherits task N's mess.

## 2. Log format

Source of truth is append-only JSONL at `docs/autonomous-run/log.jsonl`, committed after **every**
task so an interruption loses at most one task. A rendered `SUMMARY.md` is regenerated from it.

```json
{
  "task": "T13",
  "title": "Reduce whitelist over-matching",
  "status": "BLOCKED",
  "blocked_reason": "verification_failed",
  "started": "<iso>",
  "ended": "<iso>",
  "attempted": "Excluded /enums,/types,/schema,/constants from is_data_access_source and gated the /client match on a structural signal.",
  "evidence": "pnpm eval:external: calcom forbidden_imports lost @calcom/prisma entirely (expected to keep it, drop only the 4 wrong entries). openstatus dropped @openstatus/db.",
  "diagnosis": "The /schema exclusion also matches @openstatus/db/src/schema, which IS the real Drizzle data layer for that repo. The exclusion list conflates 'type-level subpath' with 'schema module used at runtime'.",
  "needs": "A decision: is a Drizzle schema module data access? It is imported at runtime and passed to queries. Recommend treating it as data access and excluding only /enums,/types,/constants.",
  "blocks": ["T14"],
  "reverted_to": "<sha>",
  "files_touched": ["crates/drift-engine/src/candidate_command.rs"]
}
```

### Status values

| Status | Meaning |
|---|---|
| `DONE` | DoD met, verified, committed |
| `DONE_PARTIAL` | A separable sub-goal met and committed; the rest logged as a new task |
| `BLOCKED` | Attempted, reverted, needs discussion |
| `SKIPPED_DEPENDENCY` | A prerequisite task is BLOCKED |
| `DEFERRED_HUMAN` | Human-gated by design (publish/push/post) — never attempted |
| `PREMISE_FALSE` | The task's stated problem does not exist. **This is a success.** |
| `DISCOVERY` | A new finding surfaced while doing other work (how F9 was found) |
| `BASELINE_CHANGE` | A deliberate external-suite baseline update, with rationale |

### `blocked_reason` values

`verification_failed` · `needs_human_decision` · `needs_external_resource` (network, credentials, a
platform runner) · `needs_new_dependency` (not pre-authorised) · `scope_too_large` (task should be
split — propose the split) · `upstream_defect` (a bug outside Drift) · `context_exhausted`

## 2b. Size tasks to the remaining budget

Context is a budget, not a cliff. As it depletes, stop taking tasks in plan order and take them in
size order instead. Halting with 60 open items because the *next* one is large wastes the rest of
the window - there is almost always a contained task that fits.

Rough sizes, smallest first: doc corrections and prose deliverables (T30, T70, T72, T73) < harness
assertions (T14) < single-file code changes (T11b, T11c, T63) < multi-file refactors (T23, T51) <
new subsystems and parser work (T12, T22, T44, T52).

Only halt when even the smallest remaining task will not fit, and say in HALT.md which tasks were
skipped for size rather than for a blocker.

## 3. Prefer DONE_PARTIAL over BLOCKED

If a task has separable value, land what works and log the remainder as a **new task appended to the
plan**. Example: T24 (error-message quality) covers many codes; if three are fixed and one needs a
product decision, commit the three, log `DONE_PARTIAL`, and file `T24b` for the fourth. This keeps
progress additive instead of all-or-nothing.

## 4. Genuine halt conditions (only these)

Each must attempt self-remediation first.

| Condition | Remediate | If remediation fails |
|---|---|---|
| Disk free < 5 GB | `rm -rf ~/.drift`, `cargo clean` on debug artifacts, clear `/tmp/drift-*` | **HALT** — low disk produces false failures, so further results are untrustworthy |
| Cannot restore a green tree | `git reset --hard` to last green, `git clean -fd` | **HALT** — everything downstream is unreliable |
| Oracle is lying: `pnpm eval:external` fails on the last known-green commit | re-run once; rebuild engine + TS | **HALT** — verification is meaningless, so no task can be validated |
| 5 consecutive BLOCKED tasks | none | **HALT** — likely systemic, not per-task |
| Context exhausted | **first: switch to small tasks.** Re-sort the remaining plan by size and take contained ones (single-file edits, harness assertions, doc corrections, prose deliverables). Only halt when even a small task will not fit. | **HALT cleanly** with the log committed |

On HALT: commit the log, write `docs/autonomous-run/HALT.md` explaining the condition and the exact
resume command, and stop. Never push, never publish.

## 5. Never attempt unattended, regardless of status

- `npm publish`, `git push`, `gh pr create`, any post or message
- Anything that sends content off the machine
- Adding a runtime dependency not pre-authorised in the plan (`ignore` is authorised; the MCP SDK is
  authorised only after 2026-07-28)
- Editing anything under `$DRIFT_EVAL_REPOS` beyond what the harness does, or committing into them
- Deleting user data outside `~/.drift`, `/tmp/drift-*`, and the workspace

## 6. Baseline discipline

`pnpm eval:external --update` is only run when a behaviour change is **intended**. Every update logs
`BASELINE_CHANGE` naming each field that moved and why. An unexplained baseline move is treated as a
regression: revert and log BLOCKED.

## 7. End-of-run report

Regenerate `docs/autonomous-run/SUMMARY.md` with: tasks done, partial, blocked (grouped by reason),
premise-false, discoveries, baseline changes, gate status, and a **ranked discussion agenda** — the
blocked items that need a decision, most consequential first, each with the recommendation I'd make.

---

## 8. Tacit knowledge — things that cost me time this session

**Paths and tooling**
- The working directory contains a space: `~/drift-falsification/drift/drift v3`. Quote every path.
  T82 promotes it to the repo root and removes this friction.
- Shell state does not persist between tool calls. Re-source `~/drift-falsification/env.sh` (sets
  `DRIFT_ENGINE_BIN`, defines `drift()`, `dset <repo_id>`) in every call that needs it.
- `packages/core/src/policy.ts` contained a literal NUL byte inside a string literal. The Edit tool
  refuses strings containing control characters — use a Python script for such edits.
- Registering a CLI flag requires adding it to `BOOLEAN_FLAGS` or `VALUE_FLAGS` in
  `packages/cli/src/args/flag-schema.ts`, or argument parsing rejects it with no obvious clue.

**Testing**
- `pnpm -r test` needs `--workspace-concurrency=1` or the cli and check-parity suites fail on
  resource contention (not path collision — temp dirs are already unique). T64 revisits this.
- Integration tests under `crates/drift-engine/tests/` can only reach the **lib** crate
  (`drift_engine`). Modules under `src/` belonging to the binary crate (`candidate_command`,
  `protocol`, `facts`) need in-file `#[cfg(test)] mod`.
- `packages/cli/test/cli.test.ts` is ~15.8k lines. Use `pnpm vitest run test/cli.test.ts -t "<name>"`
  to run one case. It contains 198 `exitCode).toBe(1)` assertions; only a subset relate to blocked
  checks, so never blanket-replace them — map each to its test name first.
- `pnpm build` after **every** source edit before running the CLI. I once verified a fix against a
  stale `dist/` and got a misleading result.

**The eval harness**
- Hermetic: temp `HOME` per repo, hard-resets the repo, creates no commits. Manual `drift` runs are
  *not* hermetic and accumulate in `~/.drift`.
- `git clean` does **not** remove staged files. The harness originally cleaned without resetting the
  index, which leaked injected routes between runs and made a *detected* injection look undetected —
  a false negative, not an error. `resetTree` now hard-resets. Preserve that.
- State is large: ~1 GB for cal.com, ~3.9 GB across six repos. Check free space before long runs.
  T40/T41 address this.

**Behaviour a fresh reader will find surprising**
- `drift check` exiting **2** is correct (blocked), not a crash. 3 is a fail-closed refusal.
- The same injected violation **blocks** on formbricks/cal.com/openstatus and only **warns** on
  taxonomy/dub/papermark. That is the A5 coverage-direction gate working: a convention violated by
  most of the repo is an aspiration, not a rule. Not a bug.
- `drift conventions list` hides sub-20%-coverage candidates by default (A7). `low_confidence.hidden_count`
  reports how many; `--include-low-confidence` reveals them.

**Audit provenance — do not treat these as equally true**
| Source item | Status |
|---|---|
| F1–F9 (falsification test) | Verified by me, with repros |
| A4 (audit) | Verified real, fixed |
| **B2 (audit)** | **Premise FALSE** — waivers/exceptions are enforced CLI-side. Do not "fix". |
| B1, B4, B5 (audit) | **Unverified.** Phase 2 checks them before scoping. |
| Line references in A4/B1 | From the audit, not independently re-derived |
