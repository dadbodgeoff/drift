# TDD — BB audit fixes (BB-8 … BB-11)

**Base:** `30e2e036` (post BB-1…BB-7). **Written:** 2026-08-04, from the independent verification
of the BB sprint. Every seam below was confirmed at that sha; every defect was reproduced live
before being written down (BB-10's flake reproduced once in three runs — its item says so).

**Context.** The BB sprint verification passed every behavioral probe. These four items are what
the verifier found that the sprint's own gates did not. BB-8 is required before the branch is
called done; BB-9 is a fast-follow in the same class as BB-1; BB-10/BB-11 are small hardening.

**Red-first throughout. The implementer of these items must not be their verifier.**

---

## BB-8 · The `baselined` eval cell is dead, and the ratchet was updated to the corpse `[REQUIRED]`

**What happened.** `scripts/external-eval.mjs:267` reads the baselined count by regexing `start`'s
human output: `/Baselined (\d+) existing violation/`. BB-3 rewrote that sentence — the words now
appear as "…existing violations **baselined** — …" (reversed order), so the regex matches nothing,
the harness records `baselined: 0` on every repo, and `external-eval-baseline.json` was updated
`397→0` (dub), `8→0` (formbricks), `4→0` etc. under the "intended new fields" rationale. Verified
live: the product baselines correctly (the finding message says "397 existing violations are
baselined"); only the measurement is dead. **A baselining regression — the decision-C behavior
T121 protects — is currently invisible to `eval:external`.**

**The durable fix is to stop regexing human prose.** BB-3 added `acceptance.baselined_count` to
`start --json`. The harness should read that. Sentences are UX and will change again; the JSON
surface is schema-locked.

**Red.**
1. Harness unit test: a captured real `start --json` payload yields the correct
   `baselined` count. A payload with the acceptance block absent (no `--accept-defaults`) yields
   an explicit `null`, never a silent 0.
2. **The cell-liveness assertion, so this class of death can't recur:** the harness fails loudly
   if `baselined === 0` while the same run's `findings` count for that repo is > 0 — a repo with
   open findings and zero baselined is either a product regression or a dead cell, and both must
   stop the suite. (Generalize if cheap: any count cell parsed from output that reads 0 while a
   sibling machine-JSON field is nonzero.)
3. Re-run `pnpm eval:external`: baseline restored to the true per-repo counts (dub 397,
   formbricks 8, …) by measurement, not by hand-typing the old numbers. The ratchet re-tightens
   on those values.

**DoD.** Baseline shows nonzero `baselined` for every repo that has baselined violations. The
liveness assertion is itself red-checked (temporarily re-break the parser, watch it fail, restore).

---

## BB-9 · A diff naming files absent from the working tree must not claim complete coverage

**What happened (reproduced live at `30e2e036`).** A `--diff-file` patch naming a file that does
not exist in the working tree produces `changed_file_count: 1`,
`partial_coverage: {complete: true}`, zero findings, exit 0 — and the output never mentions the
file. This is BB-1's bug one level up: the scope is non-empty, nothing in it was examinable, and
completeness is claimed anyway. Real-world shape: CI applying a patch to the wrong checkout; a
hook racing a branch switch; a stale patch file.

**Seam.** `packages/cli/src/check/run-check.ts`, where the parsed diff's `files` are reconciled
against the working tree / scanned file set (the deleted-files skip already lives in this
neighborhood and is the pattern to mirror). `diff.ts` needs no change — the diff parse is correct;
the reconciliation is what's missing.

**Design, so the tests are unambiguous (mirrors BB-1's philosophy):**
- **Some** named files absent → check proceeds on the present ones, but
  `partial_coverage.complete: false` with reason `changed_file_missing_from_worktree` naming each
  missing path, and the human output says `Checked N files (M missing from working tree)`.
- **All** named files absent → refusal, exit 3, code `stale_diff_scope`, remediation naming the
  likely causes (stale patch; wrong checkout; file since deleted — regenerate the diff).

**Red — negative controls first:**
1. Diff naming only present files → behavior byte-identical to today (pin a passing and a
   blocking case).
2. Deletion-only diff → still passes via the existing skip path — the new reconciliation must not
   double-count deleted files as "missing." This is the trap; write it first.
3. Rename-only diff (BB-1b) → still passes; renamed-away old paths are not "missing."
4. Mixed diff (one present violating file + one absent file) → the violation still fires (exit 2
   in block mode), `complete: false`, missing file named. Enforcement must not weaken because
   coverage degraded — findings on examined files stay findings.
5. All-absent diff → exit 3 `stale_diff_scope`, and the empty-scope refusal (`empty_diff_scope`)
   is NOT the code emitted — the two causes need distinct names or the remediation misleads.
6. This touches the enforcement path: re-run `eval:external`, `eval:evasion`, `eval:bench`
   (ordinary-edit refusal rate is the metric BB-1b regressed — watch it specifically), and
   `eval:determinism`.

**DoD.** The live repro flips from silent-pass to refused (all-absent) / honestly-partial (mixed).
Bench refusal ratchet unchanged at 0/56.

---

## BB-10 · The BB test files flake when run together

**What happened.** `empty-diff-scope-bb1` + `contract-liveness-bb4` + `conforming-exemplars-bb5` +
`guidance-view-bb6` run as one vitest invocation: 2 of 38 failed on the first run, then 38/38 on
two immediate re-runs. Each file passes alone. Unreproduced since; treat as an isolation defect
with one observation, not a diagnosed bug — the item is time-boxed accordingly.

**Red.**
1. Reproduce attempt: run the four files together 10× (`--sequence.shuffle` on, then off). If it
   reproduces, capture which assertions fail and fix the shared state (the usual suspects: shared
   tmp paths, shared sqlite files, `process.chdir`, env mutation without restore).
2. Whether or not it reproduces, apply the cheap hardening: every BB test file creates its
   fixtures under `mkdtempSync` (unique per file), never a fixed path; any env var set is
   restored in `afterEach`. Grep the four files for fixed tmp paths and shared DB filenames —
   remove all of them.
3. Time-box: half a day. If it never reproduces, land the hardening, log the observation in
   `docs/beta-run/log.jsonl` as UNREPRODUCED, and stop.

**DoD.** 10 consecutive combined runs green post-hardening.

---

## BB-11 · Retire the last non-shared scope predicate

**What happened.** BB-6 correctly moved scope membership into `@drift/core`, but
`packages/mcp/src/index.ts:2160` (policy check-context surface, pre-sprint code from May) still
does its own glob matching via `apiCompatibleGlobs` + `matchesPolicyGlob`. Post-extraction it is
the only scope decision in the product not using the shared predicate — exactly the F3-class
divergence (two glob engines disagreeing about `**/app/api/**`) the extraction exists to prevent.

**Red.**
1. Differential test FIRST, against the current duplicate: run both predicates over the known
   tricky path shapes (root-level `app/api/x/route.ts`, nested `apps/web/app/api/...`,
   `pages/api/...`, bracket segments `[idOrSlug]`, `route.tsx`). If they disagree on any input,
   **stop and report before changing behavior** — the divergence is then a live policy bug and
   which side is correct is a product decision, not a refactor.
2. If they agree everywhere: replace the local logic with the core predicate, delete
   `matchesPolicyGlob`'s scope-membership use (leave unrelated uses), and pin the tricky-path
   table as a regression test on the shared predicate.
3. MCP parity suite green.

**DoD.** `grep` finds no scope-membership glob matching outside `@drift/core`. The differential
table is a committed test.

---

## Order

```
BB-8                 first — it re-arms the gate the other items are verified against
BB-9                 second — enforcement path, full gate battery after
BB-10, BB-11         parallel, any time
```

## Standing rule added by this audit

- **When a baseline cell changes sign or drops to zero, the update must explain the mechanism,
  not just the intent.** "Intended new fields" justified 62 added lines and hid a dead cell in
  the 20 changed ones. The diff line `"baselined": 397 → 0` was the tell, in plain sight.
- Carried from the sprint: capture the exit code of the process you tested; never measure through
  the engine fallback; a fixture change that alters what a cell measures is a behavior change —
  BB-8 is what that rule looks like when it's violated politely.
