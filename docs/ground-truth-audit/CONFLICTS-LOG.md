# Prompt-vs-spec conflicts encountered, and how each was resolved

The launcher prompt governs wherever it and the TDD conflict. Every conflict is recorded here
rather than silently routed around. Entries are appended as the run proceeds.

---

## 1. Pre-resolved by the prompt: the state-DB migration is void

**Spec:** §5.1's compat paragraph calls a migration "the obvious remedy" before forbidding it;
§1.1 notes 26 id-keyed migrations "to follow"; §8 lists it as deliberately withheld.
**Resolution:** any text instructing a state-DB migration is void (prompt rule 5). It is the
only irreversible act in the plan and needs a human signature. The §5.1.4 dead-config
diagnostic covers the same users non-destructively. Carried into Track A's brief as an
explicit prohibition, with the "expect the spec to tempt you here" warning attached.

## 2. Pre-resolved by the prompt: red-at-baseline means post-0a, not `255f2208`

**Spec:** §9.4.6's bullet once said `255f2208`; §9.4.3 step 2 says the integration branch at
the 0a commit and explains why. The two disagree inside the document.
**Resolution:** the baseline is the post-0a, pre-fix commit — here `ea9e774c` (prompt rule 2).
At the raw SHA the `test/fixtures/gt-*` directories do not exist, so a red test dies as a
setup failure, which proves nothing.

## 3. Where 0a's red assertions live — spec is genuinely ambiguous

**Spec:** §4.1 says 0a's expected values are "written to post-fix ground truth, so at baseline
the suite is red exactly where the audit said it would be", implying 0a lands failing
assertions. But §9.4.3 step 2 has the lead verify red-at-baseline by applying **only the new
test** in a throwaway worktree at the post-0a commit — which presumes the red tests are not
already in 0a.
**Resolution:** **0a lands green.** It carries the harness, the six fixtures, and a control
that pins existing true-positive behaviour. Defect-specific red tests land on their own
track branches, in their own files. Rationale: tracks A, B, and C fork from the integration
branch and run in parallel, so if 0a were red every track's T2 (`pnpm verify`) would fail for
reasons unrelated to that track, and a genuine regression would be indistinguishable from
inherited noise. This also gives §9.4.3 step 2 something to do — with the red tests already
in 0a, "apply only the new test" is meaningless.
**Consequence:** zero file overlap between tracks is preserved; each track owns its own test
file and none may edit `test/e2e/gt-golden.test.ts`.

## 4. Recorded audit state is too large to commit — spec assumes otherwise

**Spec / prompt:** "the raw JSON and recorded state go to `docs/ground-truth-audit/`".
**Reality:** the recorded state is 220 MB, of which the papermark SQLite DB alone is 189 MB.
**Resolution:** all JSON/text evidence committed (1.5 MB — this is the substrate the audit's
numbers were actually measured from); binary SQLite state and the 5 MB mutated-repo copy
recorded in `RECORDED-STATE-MANIFEST.md` with size and sha256, and preserved in the durable
backup at `~/drift-falsification/gt-audit-backup-2026-08-16/`. A 189 MB blob is permanent
history bloat for an artifact regenerable by re-running the workflow.

## 5. `eval:external` is RED at baseline — §6 and §9.4.6 assume it is green

**Spec:** §0.2 states the baseline is pre-verified; §6 makes "confirm `eval:determinism` /
`eval:external` green at baseline" an 0a exit criterion; §9.4.6 makes `pnpm verify:evals`
green a merge-gate condition.
**Reality:** at `255f2208`, `eval:external` fails on 5/7 repos, every one on
`packet_within_envelope_budget` (`scripts/external-eval.mjs:452`). The baseline JSON was last
blessed at `d2517b96` (2026-08-13); `255f2208` landed 2026-08-15. §0.2's pre-verification
covered `build:engine` and `test:engine` only — both genuinely green.
**Resolution:** not routed around and not blessed. Under investigation for full root cause;
disposition recorded in `ENVELOPE-BUDGET-INVESTIGATION.md`. Blessing it to go green is
refused on the same grounds as any other baseline bless (§9.4.4). The merge gate is
evaluated against *this remediation's* deltas, with the pre-existing failure named
explicitly rather than absorbed.

## 6. `eval:determinism` in §5.2's S2 experiment vs. §9.4.5's subagent ban

**Spec:** §5.2 step 1 makes the S2 branch decision depend on running `pnpm eval:external`
without `--update`. §9.4.5 forbids subagents from running any eval suite.
**Resolution:** split the experiment. Track B runs the `cargo test` half and reports it; the
lead runs `eval:external` at the T3 #1 boundary and makes the branch call. Recorded in Track
B's brief so the agent does not run it and does not treat its absence as a blocker.

## 7. §10 attributes an "8 → 6" fact count to one fixture; it spans two

**Spec:** §10's traceability row reads `test/fixtures/gt-fact-extraction` facts golden (8→6).
**Measured at the 0a commit through the real CLI:** `gt-fact-extraction` emits **6**
`exported_symbol` facts and `gt-fact-extraction2` emits **2**. The 8 is the total across both
fixtures; post-D2 it is 4 + 2 = 6, and post-D3 4 + 3 = 7.
**Resolution:** not a defect in the fix design — §7's precision (75% = 6 correct of 8) and
recall (85.7% = 6 of 7) arithmetic both hold on the combined figure. Track B's brief carries
the corrected reading so it does not hunt for eight facts inside one fixture.

## 8. Determinism "flap" that was self-inflicted

Not a spec conflict, recorded because it nearly became a false finding. A first run reported
`dub` and `calcom` flapping across 3 runs. `eval:determinism` and `eval:external` had been
launched concurrently, and the determinism harness explicitly refuses to measure a worktree
another process has touched. Re-run serially and alone: **7/7 deterministic.** This is the
concrete reason the "all tracks quiescent during T3" rule exists.
