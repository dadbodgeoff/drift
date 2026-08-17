# Measurement hardening — handoff

Branch `remediation/measurement-hardening`, worktree `~/drift-falsification/wt-measurement-hardening`.
Four items closing zero-findings blind spots in the eval layer. Nothing pushed, nothing merged.

Two things need a human decision. Both are below, ahead of the summary, because neither is mine to
make.

---

## 1. `main` was already red when this branch was cut

Found while taking the baseline measurement, and unrelated to anything on this branch.
`pnpm verify:ci` on `main@4a20a8bc` fails:

```
FAIL test/e2e/gt-canary.test.ts > cell canaries — firing > request-validation safeParse proof path fires
AssertionError: expected 3 to be +0
  at test/e2e/gt-canary.test.ts:903
```

Reproduced three times: in this worktree, and twice in the pristine `~/drift-falsification/drift`
checkout at `main`. It is not contention and not a stale build.

**Cause.** PR #121 (`fix(cli/check): the check pipeline cannot report a pass it did not earn`,
merged as 4a20a8bc) rewrote 413 lines of `packages/cli/src/check/run-check.ts` and updated the
assertions it broke in `packages/cli/test/**` — four files. It did not touch
`test/e2e/gt-canary.test.ts`, whose pin reads:

> The full-scope run exits 0, and that is NOT this cell's doing … Pinned so that if full-scope
> blocking is ever fixed, this says so.

The pin is doing exactly what it was written to do. Full-scope now refuses (3) where it used to pass
(0), and this is the assertion saying so.

**Not fixed here, deliberately.** Resolving it means deciding whether exit 3 is the intended
post-#121 behaviour for a full-scope run on a fixture with no diff. If it is, the pin and its
comment get updated; if it is not, the fix is in `packages/cli/src/check/**`. Both are outside this
branch's ownership, and the second is explicitly out of scope. Changing the assertion to match
observed behaviour without that decision would be weakening a test that is currently working.

**Recommendation:** treat this as a #121 follow-up, owned by whoever merged it.

## 2. `contract import` orphans the baseline — pinned, not fixed (item 4)

Confirmed against current code, then mutation-proofed. New test:
`test/e2e/contract-import-baseline.test.ts`.

**Measured**, on a two-checkout fixture in the documented CI order (`start` → `contract import` →
`check`):

| | baseline rows | orphaned | findings |
|---|---|---|---|
| after `start` | 2 active | 0 | 2 × `pre_existing`, `non_blocking_reasons: [{pre_existing_baseline, 2}]` |
| after `contract import` | 2 active | **2** | 2 × `new`, no `pre_existing_baseline` reason |

The import exits 0 and reports `compatible: true`, `repo_fingerprint_matches: true`,
`repo_id_matches: false`, `removed_convention_count: 1`, `added_convention_count: 1`. The check's
exit code is **identical either side of the import**, so nothing a CI job branches on distinguishes
the two states. What moves is the classification: inherited debt is re-reported as work introduced by
the change under review. On a PR touching a baselined file under `--scope changed-hunks`, that is a
spurious block.

**Two corrections to the audit's stated mechanism**, both found by mutating the source and watching
the assertions *not* move:

- **The operative call is not `deleteAcceptedConventionsExcept`.** Removing it changes nothing.
  `check` reads its conventions from the repo contract (`storage.getRepoContract(repoId).conventions`,
  `run-check.ts:379`), not from `accepted_conventions`. The driver is
  `storage.upsertRepoContract({ ...contract, repo_id: expectedRepoId })` a few lines below — the
  import installs the foreign contract wholesale. The delete is a companion effect on a second table.
- **The baseline is dead on both of its keys.** `findingFingerprint()` hashes the convention id into
  the fingerprint (`check/finding-fingerprint.ts:35-43`), so a re-key moves the fingerprint too.
  Relaxing `isBaselinedFinding` to ignore `convention_id` rescues zero rows — measured directly.

Why it happens at all: a convention id is `hash(repo_id : kind : evidence)` and `repo_id` is
`repo_${hash(absolute path)}` (`domain/identifiers.ts`). T120 made the *portability check*
path-independent by moving it to the git remote and root commit. It did not make the storage key
path-independent, and convention ids are still derived from the storage key — so two checkouts of one
repository always disagree about them, which is the condition the whole scenario needs.

**Recommendation.** The fingerprint finding rules out the cheap fix, so pick between:

1. **Re-derive the baseline during the import.** Most correct, most work: after installing the
   contract, re-run inference over the baselined files and rewrite `baseline_violations` against the
   imported convention ids. Preserves intent (this debt was grandfathered) across a re-key.
2. **Key baseline rows on something that survives a re-key** — convention `kind` plus file path,
   rather than convention id plus fingerprint. Cheaper, and weaker: two conventions of one kind
   would collide.
3. **Refuse the import while it would orphan an active baseline**, with remediation naming
   `drift baseline create` after import. Cheapest and honest; makes the user do the work, and fits
   the existing refusal posture (X-1, shallow clones).

I'd take (1), with (3) shipped first as the fail-closed stopgap if (1) is not immediate. What is not
acceptable is the current state, where the failure is invisible in the exit code.

When any of these lands, the two assertions marked `EXPECTED-TO-CHANGE` in the test fail. That is
intended: the fix cannot land silently either.

**Also worth deciding, separately:** `docs/agent-integration.md` says CI should *not* onboard
("Import, do not re-onboard") and shows only `contract import` + `check`. But `contract import
--repo "$DRIFT_REPO_ID"` requires the repo row to exist, which only `start` or `scan` creates. The
documented snippet is not runnable on a fresh CI checkout as written.

## 3. Discovered while re-baselining: cal.com lost coverage, and no ratchet term can see it

Item 2 needed `findings_count` recorded in `beta-bench-baseline.json`, so the corpus was
re-measured. `pnpm eval:bench:update` would have written far more than the new field:

| repo | parser gaps | facts | `coverage_complete` |
|---|---|---|---|
| taxonomy | 15 → 7 | 1,643 → 1,834 | — |
| dub | 639 → 631 | 106,626 → 108,220 | — |
| formbricks | 999 → 217 | 158,174 → 159,260 | — |
| calcom | 1,505 → 1,237 | 171,915 → 173,984 | **true → false on 5 of 8 edits** |
| papermark | 493 → 350 | 51,558 → 52,940 | — |
| midday | 581 → 475 | 85,869 → 86,141 | — |
| openstatus | 740 → 657 | 90,348 → 90,538 | — |

The parser-gap falls and fact-count rises are drift on `main` that the ratchet permits by design
(a fall is the work succeeding). **The cal.com line is not.** `coverage_complete` went `true` →
`false` on E2, E3, E4, E7 and E8 — five ordinary edits on which the check no longer has complete
coverage — and **no ratchet term reads `coverage_complete` at all**. It is measured, recorded in
the baseline, and compared by nothing. That is the same shape as the three items above: a number
the harness collects and then declines to assert on.

**So the bench baseline was updated surgically, not regenerated.** The committed rows were kept
verbatim and only `findings_count` was added — the diff is exactly seven insertions. Running
`--update` would have absorbed the cal.com coverage regression into the baseline as though it had
always been so, which is the one thing a baseline must not be able to do. The ratchet was then
verified against the real measured rows offline: it passes, and a one-finding drop on the same data
(`dub` 349 → 348) is caught.

**Recommendation, not done here** (it is outside item 2's stated scope, which was the findings
floor): add a `coverage_complete` term to `ratchetRegressions` — a per-edit `true` → `false`
transition should fail the same way a refusal rise does. Then decide whether cal.com's five edits
are a genuine regression to fix or a coverage change to record.

---

## Summary of changes

| Item | Change | Verified by |
|---|---|---|
| 1 | `determinism.mjs` writes/compares `determinism-baseline.json`; drops and rises both fail, rises demand `pnpm eval:determinism:update`, never auto-updates | `scripts/determinism-predicate.test.mjs`, 10 cases, 3 mutations |
| 2 | `beta-bench` records the onboarding full-scope `findings_count`; the ratchet floors it | `scripts/beta-bench-ratchet.test.mjs`, 5 new cases, 1 mutation |
| 3 | `eval:presence` added to `verify:evals`; `presence-precision-recall.mjs` passes `--data-modules` | midday's data-access cell moves `NO_CONVENTION` → measured |
| 4 | `test/e2e/contract-import-baseline.test.ts` pins the orphaning | 4 cases, 1 mutation flipping both pins |

All three corpus-dependent generations were produced on this machine, so nothing is left pending:

- `scripts/determinism-baseline.json` — new, 7/7 repos deterministic over 3 runs, 651 fingerprints
  (taxonomy 4, dub 349, formbricks 11, calcom 28, papermark 237, midday 5, openstatus 17).
- `scripts/beta-bench-baseline.json` — surgical, seven `findings_count` insertions only.
- `scripts/presence-precision-recall-baseline.json` — one cell changed, `midday/data-access`
  `NO_CONVENTION` → `MEASURED` at precision 1.000 / recall 1.000 over 50 compliant and 50
  violating fixtures. 9 measured cells → 10.

The two harnesses agree independently on the per-repo findings counts: `determinism.mjs` and
`beta-bench.mjs` reach the same seven numbers by different routes. That was not arranged, and it is
the first cross-check the eval layer has had on that number.
