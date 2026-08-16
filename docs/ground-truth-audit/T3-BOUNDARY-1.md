# T3 #1 — after Tracks A and B merged

Tree: `1b440ac4`. All tracks quiescent; every eval run **serially, one at a time**.

**Regression criterion** (from `ENVELOPE-BUDGET-INVESTIGATION.md`, since `eval:external` is red at
baseline for a pre-existing reason): a regression is *a new line under `changed vs baseline`, or a
new name in `failed_assertions` beyond `packet_within_envelope_budget`*. Exit codes are not the
signal — `external-eval.mjs:681` exits 1 on either a changed diff or a failing verdict.

## Results

| Eval | Exit | Result |
|---|---|---|
| `eval:external` | 1 | **No regression.** Failing repos 5 → 3. No new `failed_assertions` name. |
| `eval:evasion` | 0 | **No change vs baseline** — 91 shape cells across 7 repos |
| `eval:bench` | 0 | **Ratchet ok, no repo regressed.** 0/56 ordinary-edit refusals |
| `eval:determinism` | 0 | **7/7 deterministic** over 3 runs |
| `eval:presence` | 0 | **No change vs baseline** — 9 kind/repo cells |

## `eval:external` in detail

Unchanged on all seven repos: `findings_count`, `baselined` (except openstatus, see below),
`blocking_count`, `exemplars_emitted`, `exemplar_violators`, `forbidden_imports`,
`check_exit_code`, `check_status`. Every repo still reports `injected=y evidence=y cleanFP=no
neg=ok subpath=y exemplars=6/6`.

**Track A's predicted delta for the globstar fix is CONFIRMED.** It predicted *exactly zero* on
every metric across all seven repos, derived from: `path_glob_matches` has two callers reaching
five kinds; four are in `EXPERIMENTAL_SECURITY_CONVENTION_KINDS` and so are filtered by
`--accept-defaults`, which is all the harness uses; the fifth,
`api_route_forbids_secret_exposure`, is never proposed (0 occurrences in `candidate_command.rs`,
verified). Observed: no finding count moved on any repo. The prediction was falsifiable and was
not falsified.

**`eval:bench` is the load-bearing result for D2.** §5.2's stated risk was that removing the
second `exported_symbol` fact would reintroduce the EW-4 over-refusal regression. The ratchet
measures exactly that: **0/56 ordinary edits refused, no repo regressed.**

### Movements, and what explains each

| Movement | Explanation |
|---|---|
| taxonomy `guidance_bytes` 3242 → 3202 | The only repo whose guidance moved. Taxonomy is the repo Track B's corpus sweep predicted D2/D3 would touch (20 default-exported declarations, 4 local export statements). |
| formbricks + papermark: `packet_within_envelope_budget` false → **true** | An improvement on a pre-existing failure. Measured directly afterwards: papermark's `prepare` envelope is now **437,050 bytes**, 63 KB under the 500 KB budget, with `graph_context` at 50,090 among its top three sections. D2 removes one `exported_symbol` fact per default-exported declaration, and symbol nodes are inserted only from those facts, so `graph_context` shrinks; in a Next.js app where nearly every route is `export default function handler` that is a large reduction. **Direction confirmed by measurement; exact magnitude not independently baselined**, since that would need a rebuilt worktree at `255f2208`. |
| openstatus `baselined` 30 → 31 | **Pre-existing, and not ours.** Present identically in the baseline run before any code changed. Root-caused as far as evidence allowed in `ENVELOPE-BUDGET-INVESTIGATION.md`: extraction is byte-identical (`files=2185, facts=90385`), so it originates in the baseline-seeding layer, not this work. |
| dub / calcom still failing `packet_within_envelope_budget` | Pre-existing. Both carry the largest parser-gap counts (calcom 1237, dub 631). Unfixed here by decision, not oversight — see the investigation note. |

## Nothing was blessed

`scripts/external-eval-baseline.json` is untouched. `updateGate` independently refuses `--update`
while any verdict is FAIL, and that protection was not worked around. The two repos that now pass
are recorded here rather than pinned, because pinning them would bake in a number produced while
the envelope defect is still live on the other three.

## Disk exhaustion invalidated a first attempt

The first T3 #1 run died on `No space left on device` (1.8 GB free; `eval:evasion` refuses under
5 GB). `eval:external` produced no output, `eval:evasion` refused, `eval:bench` crashed mid-run.
Those results were discarded, not interpreted. Removing the four merged//completed worktrees
freed ~4.7 GB (branches are preserved — a worktree is not the branch) and every eval was re-run
from scratch. `eval:determinism` and `eval:presence` from the first attempt were retained only
because they ran after the crash freed space and completed cleanly; both were consistent with the
re-run.
