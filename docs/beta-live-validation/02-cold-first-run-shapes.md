# CHARTER 02 — Cold first run across repo shapes

**Depends on:** 01 · **Est. 3 h** · **Output:** `results/02-cold-first-run-shapes.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 02 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 02 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 02` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Walk a first-time user from `drift init` to a first true verdict on five structurally different
repositories, and find every point at which that walk dead-ends. The prior audit ran exactly this
across five shapes and found dead ends in at least two of them; this charter re-runs it against
current `main` and establishes whether those dead ends are still there.

## 2. The five shapes

| Shape | Repo | Why it is here |
|---|---|---|
| A | Stock `create-next-app` App Router, a couple of API routes that import a data module **directly** | The shape Drift is built for. Everything should work. |
| B | Correctly layered Next.js: routes call a service layer, the service calls the data module; **no route imports data directly** | §18a records a dead end here: nothing to propose except `api_route_requires_service_delegation`, which has no evaluator and cannot be accepted. |
| C | Express or Fastify API, no Next.js | Route recognition is Next.js-only by construction (§22 obs. 5). Does the user learn that, or get a silent empty result? |
| D | Monorepo — pnpm/turbo workspace where the Next.js app is at `apps/web`, and `drift init` is run **from the repo root** | Workspace detection looks only at the exact `--repo-root` and never upward (§22 obs. 3). There is no git-root discovery anywhere (§22 obs. 2). |
| E | A real repo from `$DRIFT_EVAL_REPOS` (pick the largest, e.g. calcom) | The honest case: a big unfamiliar codebase. |

Build A–D fresh and commit them so the runs are reproducible; record each one's tree.

## 3. Procedure — run identically on all five

Each shape gets its own `--state-root` under a temp dir. Record **verbatim stdout, stderr, and
exit code** at every step, in both text and `--json` where supported.

| Probe | Step |
|---|---|
| P-02-01 | `drift doctor` before anything. Note every `warn`/`fail` and whether the detail line tells the user what to do. |
| P-02-02 | `drift init` |
| P-02-03 | `drift scan`. Record files indexed, files skipped, `parser_gaps`, wall time. |
| P-02-04 | `drift scan status` |
| P-02-05 | `drift start` (init + scan + candidates + next-commands in one). Compare its output to what P-02-02..04 produced separately — do the two paths agree? |
| P-02-06 | `drift candidates` / `drift conventions list`. Record every candidate kind offered, with its evidence. |
| P-02-07 | Attempt to accept **each** offered candidate in turn, in a fresh state root per attempt. Record which accept and which refuse, and the exact refusal text and exit code. |
| P-02-08 | With whatever accepted successfully, `drift check`. Record verdict, exit code, and whether the text output's claims match the exit code. |
| P-02-09 | Introduce one true violation of an accepted convention. Re-run `drift check`. Does it block? Exit 2? |
| P-02-10 | Follow **every** `next_commands` string the tool printed, verbatim, from a shell with no `DRIFT_DB` exported and cwd outside the repo. Record which ones fail. (§18b: `audit`, `backup`, `repo map` are outside the auto-resolving set and will fail as printed.) |
| P-02-11 | For shapes B and C specifically: after the dead end, is there **any** path the printed output offers that leads to a working gate? Record the full text Drift shows. |

## 4. Benchmarks

Per shape: wall time for `init`, `scan`, `start`, `check`; files indexed; candidates proposed;
conventions acceptable; time from first command to first true verdict (or `∞` if unreachable).

The headline number of this charter is **time-to-first-true-verdict per shape**, and the count of
shapes where it is `∞`.

## 5. Oracles

- Every shape reaches either a working gate **or** an explicit, accurate statement of why it
  cannot — never silence, never a passing verdict that checked nothing.
- Every candidate offered is acceptable, or the refusal explains itself before the user tries.
- Every printed `next_commands` string works when pasted.
- `drift start` and the manual sequence produce the same state.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-02-1 | In a correctly-layered repo (shape B), the only candidate offered is `api_route_requires_service_delegation`, which throws at acceptance because it has no evaluator. | §18a, §9e, `convention-candidates.ts:51-55` | P-02-06, P-02-07 |
| S-02-2 | The refusal at acceptance throws a plain `Error`, not a `DriftError` — its numeric exit code was never traced. | §15, §18a — **CANNOT DETERMINE in source** | P-02-07: record the actual exit code. This charter closes it. |
| S-02-3 | Non-Next repos (shape C) get no `RouteDeclared` facts at all; whether their files are still indexed for imports/exports is undetermined. | §21 | P-02-03 + `drift repo map`: are shape C's files present with imports/exports but no route role? |
| S-02-4 | `Package manager: unknown` / `Workspace: unknown` WARNs were observed against a fixture with no lockfile and never retested with a real one. | §21 | Shape A and D have real lockfiles. Do the WARNs clear? |
| S-02-5 | Running from a monorepo root, workspace detection never looks upward or downward; the Next.js app at `apps/web` may not be recognized. | §22 obs. 2, 3 | Shape D, run from root **and** from `apps/web`. Compare. |
| S-02-6 | `drift start` text explains the scope limit in a full paragraph when the cause is framework-unrecognized, but a *different, undocumented* dead end occurs for a correctly-layered repo. | §18a | Compare C's output to B's output side by side. |

## 7. Failure protocol

A dead end **is the finding**, not a blocker. Record it fully, then continue to the next shape.
Do not "fix" a fixture repo to make Drift succeed — if a shape needs modification to get past a
step, that modification is itself a finding: record what had to change and why.

## 8. Deliverables

`results/02-cold-first-run-shapes.md`, one full transcript per shape under
`results/artifacts/02/shape-<X>/`, and the five fixture repos committed or archived.
