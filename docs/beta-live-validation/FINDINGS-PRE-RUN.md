# Findings produced while building the harness

None of these came from running the 23 charters. They fell out of building and validating the
instruments, before the program has been run at all. They are recorded here because several change
what the charters should look for — and two of them close open questions the forensics report left
as **CANNOT DETERMINE**.

Subject: `origin/main` at **`a0517f3e`** (frozen at `/tmp/drift-beta-freeze`, engine sha256 `7b91451e…`) unless stated. F-1 to F-7 were established at `699af646` and re-verified at `a0517f3e`. Every claim below has a command behind it.

---

## F-1. Charter 08's headline suspect is REFUTED on current main — and was real before

**S-08-1: "a route group appearing before `/api/` escapes convention scope while still being a real
route."**

The scope globs are read from `packages/core/src/next-routes.ts` (`API_ROUTE_SCOPE_GLOBS`). They now
read `**/app/**/route.ts`. They previously read `**/app/api/**/route.ts` — the file's own comment
says *"see that file for why `app/api` widened to `app`"*.

| path | previous globs | current globs |
|---|---|---|
| `app/(marketing)/api/leads/route.ts` | **out of scope** | in scope |
| `app/api/(admin)/users/route.ts` | in scope | in scope |
| `app/route.ts` | **out of scope** | in scope |
| `app/dashboard/route.ts` | out of scope | in scope |

**Disposition: REFUTED at `699af646`. CONFIRMED as having been real at the audited commit.**

## F-2. The magnitude of what F-1 used to be, measured

Applying both glob generations to every real route in the eval corpus (routes from `route-oracle`,
matching from `scope-oracle`):

| repo | current globs | previous globs |
|---|---|---|
| dub | 497/497 | **145/497 (29%)** |
| papermark | 283/283 | 253/283 (89%) |
| formbricks | 92/92 | 83/92 (90%) |
| calcom, midday, openstatus, taxonomy | 100% | 100% |

**1,027/1,027 routes are in scope today.** Under the previous globs, **352 of dub's 497 API routes
were not** — 349 of them behind a single route group, `(ee)`.

Verified individually, not inferred: `apps/web/app/(ee)/api/admin/ban/route.ts` exists, imports
`prisma` directly, imports `withAdmin` from `@/lib/auth`, and exports `POST`. **192 of the 348
routes behind `(ee)/` export a mutating handler.**

The audit found this defect in its narrow form (route groups) and did not find that the same glob
was excluding 70% of a real repo's API surface. §22 obs. 21 anticipated exactly this — "at least
one class of the audit's observations would already read differently if the audit were re-run
today" — and this quantifies it.

## F-3. The glob-parity canary does not cover the shape (closes a §21 unknown)

§21 recorded: *"whether `test/canary/glob-parity.json` exercises a Next.js
route-group-ahead-of-`/api/` shape is undetermined from this pass alone."*

**It does not.** Its 22-file list contains `app/api/(admin)/users/route.ts` — a group *after*
`/api/` — and no case with a group *before* it. The canary's `globs` field also still pins the
**old** narrow patterns, so it never exercised the widening at all.

`scope-oracle selftest` agrees with that canary on **33/33** cases (22 file selections + 11 pattern
semantics), which is what makes the F-1/F-2 numbers trustworthy: the third glob implementation
matches both of Drift's on every case they pin.

## F-4. Route discovery is sound — verified twice, independently

`route-oracle` re-implements Next's routing conventions with no reference to Drift's code.

- Against Drift's own `detection-breadth-baseline.json`: **7/7 repos agree exactly, 1,027 routes.**
- Against a **real `next build`** on a purpose-built app carrying every tricky segment rule:
  **exact agreement, including URL derivation** — route groups collapsing, nested groups, private
  `_folders` excluded (Next excludes them too), root-level `app/route.ts` → `/`, dynamic segments
  preserved, pages-router API routes.

So charter 08's remaining question is scope, not discovery — and F-1/F-2 answer that too.

## F-5. Every corpus repo is a monorepo, and five have no app at their root

`calcom`, `dub`, `openstatus`, `midday`, `formbricks` have no `app/` or `pages/` at their root; the
Next app lives under `apps/web/` or similar. Drift detects workspaces only at the exact
`--repo-root` and never looks upward or downward (§22 obs. 2–3).

`corpus classify` also found the eval corpus **has no pages-router-only repo**, so every
pages-router claim rests on repos that also have an app router, and the size strata have n=1 at
both ends — "scales to large repos" currently rests on calcom alone.

## F-6. `presence-precision-recall` is ratcheted tighter than its sample supports

Precision `0.96` over `n=50` fixtures can only distinguish a fall to **0.865** at the conventional
95%/80% thresholds. The gate fails on *any* change. It will therefore alarm on noise, and a gate
that cries wolf is how the `verify:evals` pinned-string drift survived for weeks.

Baseline comparisons are also **paired** (same fixtures, two versions), so McNemar is the correct
test; an unpaired two-proportion test understates significance.

## F-7. dub uses eight auth wrappers, not one

`gt-propose --discover`: `withWorkspace` (253), `withCron` (60), `withPartnerProfile` (59),
`withAdmin` (39), `withSession` (21), `withReferralsEmbedToken` (14), `withPublishableKey` (2),
plus `withAxiom`/`withAxiomBodyLog` (logging, not auth). **112 handlers export with no wrapper at
all.**

This matters for every `api_route_requires_auth_helper` measurement: a convention accepted against
one helper mislabels every route using another. It is also the reason the labeling proposer refuses
to infer `violating` from absence.

---

## F-8. Sprints S4 and S6 merged; S5 did not — but S4 did S5's work

Main advanced 17 commits: **S4 (#134)** and **S6 (#135)**. There is no `s5` branch and no S5 merge
commit.

`a88d2d54` — *"a helper's module is a place, not a spelling"* — replaced the single string
comparison in `helper_import_matches` with `helper_module_matches`, which dispatches on a resolution
mode: exact specifier equality, or `RepoResolved` where the spelling must resolve to one of the
contract's actual files, and `_ => false` otherwise. A helper imported from a different module no
longer satisfies the contract.

**One residual, unpinned.** `helper_import_matches` returns `true` when the contract carries no
`import_source`. No test covers the decoy-module case — grep for `decoy|attacker|wrong_module|
different_module` across `security_patterns.rs` and `security_rules.rs` returns nothing. Charter 07
P-07-03 is now the sharpest remaining question in S5's territory.

Also moved: **storage schema 34 → 36** (`035_secret_source_read_fact_kind`,
`036_sink_candidate_fact_kind`), engine tests 34 → 37. Router arms (50), e2e tests (35) and the
ledger's 18 cells (11 firing / 2 quarantined / 5 needs-review) are unchanged.

## F-9. Mutation score 8/8 — S4's fix is pinned

Eight faults injected into `a0517f3e`, each anchored by the sha256 of the text it replaces, run
against `cargo test -p drift-engine` on a verified-green baseline. **All eight killed**, tree clean
afterward.

The load-bearing one is `helper-module-any`, which re-injects exactly the defect S4 fixed. It dies,
so S4's fix will not silently regress.

Honest bound: 8/8 is 100% with a **95% CI of [68%, 100%]**. It means "no fault I thought to write
survived", not "the suite is complete". The repo's own `eb5bbc5f` makes the point independently —
five self-authored mutations all died and were treated as coverage; a reviewer's six found four
survivors.

The mutant pin also proved itself on a real change: `helper_import_matches`'s signature changed in
S4, its anchor hash stopped matching, and `mutate check` reported STALE rather than silently
patching the wrong code.

## F-10. `eval:breadth` reports a detection regression on all 7 corpus repos

Run against the frozen subject with a clean corpus (all 7 repos at a known sha, zero dirty files):

| repo | baseline | now | delta |
|---|---:|---:|---:|
| papermark | 2,805 | 2,215 | **−21.0%** |
| taxonomy | 311 | 282 | −9.3% |
| dub | 6,187 | 5,659 | −8.5% |
| calcom | 7,315 | 6,960 | −4.9% |
| openstatus | 4,382 | 4,221 | −3.7% |
| midday | 4,246 | 4,131 | −2.7% |
| formbricks | 5,409 | 5,385 | −0.4% |
| **total** | **30,655** | **28,853** | **−5.9%** |

`detection-breadth-predicate.mjs` treats a falling `exported_symbols` as a detection regression, and
the gate fails on all seven.

**Route counts did not move** — dub 497, calcom 86, papermark 283, exactly matching the independent
`route-oracle` (F-4). So route discovery held and exported-symbol extraction fell.

Cause not established. Ruled out so far: the corpus is clean and unmodified; `ExportedSymbol`
emission sites in `facts.rs` are unchanged (4 before, 4 after). `591d4709` moved
`sink_candidate_called` out of the base walk, which explains a change in *total* fact volume but not
in this specific kind. This is what `bisect-metric` exists for and has not yet been run.

## F-11. The breadth baseline cannot tell a code regression from corpus drift

`detection-breadth-baseline.json` records `repo`, `route_files`, `exported_symbols` and similar —
and **no commit sha for the repo it measured**. Nothing in the file states which version of calcom
produced 7,315 exported symbols.

The corpus happens to be clean right now, which is why F-10 can be attributed to code. That was
luck, not design: `evasion-matrix.mjs` writes route files into these same repos, so a run that dies
midway leaves the corpus altered and the next baseline comparison silently measures a different
subject. [00-PREFLIGHT.md §4](00-PREFLIGHT.md) already requires recording corpus shas; the repo's
own baseline should carry them too.

---

## F-12. `verify:evals` run in full: two red, three green — and I predicted it wrong

Run against the frozen subject, clean corpus, each eval separately so one failure could not mask
the next.

| gate | predicted | actual | wall |
|---|---|---|---|
| `eval:bench` | FAIL | **PASS** | 8m30 |
| `eval:presence` | FAIL | **PASS** | 8m39 |
| `eval:determinism` | FAIL | **PASS** once run against the original corpus path (see F-13) | 4m10 |
| `eval:evasion` | — | PASS (91 shape cells) | 8m11 |
| `eval:breadth` | — | **FAIL** (F-10) | 35s |

I predicted bench and presence would fail on the assumption that S4/S6 removed findings. They did
not: `bench` reports 0/56 ordinary-edit refusals and no repo below its findings floor, and
`presence` reports "no change vs baseline". The reasoning was wrong, not just the conclusion — see
F-14.

**Final tally, all five run against the original corpus path: four green, one red.** The single
failure is `eval:breadth` (F-10), which reproduces identically on both paths and is therefore not a
path artifact.

## F-13. **CORRECTED** — fingerprints depend on the repo's absolute path

**What I first reported here was wrong, and the error is worth stating plainly.** I ran the eval
suite against a *clone* of the corpus at `/tmp/eval-run/repos` rather than the original
`~/drift-falsification/repos`, saw all 651 fingerprints churn with every finding count unchanged,
and concluded the fingerprint scheme had changed and would orphan every user's triage on upgrade.

It had not. Re-run against the original path, at the same commit `a0517f3e` with the same engine
(`7b91451e`), `eval:determinism` **passes**: *"7/7 repo(s) deterministic over 3 runs · digest
baseline ok - 7 repo(s) match"*.

The real finding is different, smaller in blast radius, and still real:

**The same code, over byte-identical content, produces different fingerprints depending on where
the repository sits on disk.**

Three copies of `taxonomy`, verified identical by `diff -rq`, at three paths:

| corpus path | digest |
|---|---|
| `~/drift-falsification/repos` | `c02409588c77b997` ← matches the committed baseline |
| `/tmp/eval-run/repos` | `950fe8cce4e193ed` |
| `/tmp/corpus-c` | `711aea35850c1064` |

This is consistent with §22 obs. 1 — repo identity is **path-derived**, with no canonicalization —
and it means:

- A baseline or suppression set recorded on a developer's laptop does not match the same repo
  checked out by CI at a different path.
- Two developers whose checkouts live at different paths compute different fingerprints for the
  same violation.
- Because §18a records that orphaned baseline rows produce no message and an unchanged exit code,
  the mismatch is silent on every surface.

Not yet established: which component of the fingerprint carries the path, and whether `--repo-root`
normalization would remove it. Charter 14's P-14-06…P-14-10 and charter 05's S-05-4 (two identity
values, nothing reconciling them) are where that gets settled.

**How the mistake happened, since the harness is supposed to prevent exactly this.**
[00-PREFLIGHT.md §5.5](00-PREFLIGHT.md) requires state isolation per probe, and I extended that
instinct to the corpus — cloning it so the eval run could not mutate the original. That was right
for `evasion-matrix`, which injects route files, and wrong for everything that fingerprints. The
harness records `corpus-shas.txt` but **not the corpus path**, so nothing flagged that two runs
measured the same content in two places. `run-probe` logs the command; it does not log the
environment the command read. That gap is now itself a finding — see F-15.

## F-15. The harness records what was run, not what it read

`run-probe`'s ledger row carries the command, exit code, timing, output hashes and
`sha_under_test`. It does not carry `DRIFT_EVAL_REPOS`, `DRIFT_DB`, `DRIFT_STATE_ROOT` or the
working directory.

F-13 is the cost: two runs of the identical command against the identical subject produced different
results for eight hours before the cause was found, and no ledger row distinguished them. A probe
log that cannot answer "what did this command read" cannot support the cross-charter contradiction
sweep it was built for — `ledger-sweep` would have flagged the exit-code divergence and offered no
way to explain it.

**Fix before the charters run:** `run-probe` should record the values of the `DRIFT_*` environment
and the cwd on every row, and `ledger-sweep` should treat a divergence in those as the first
explanation it offers rather than reporting a bare contradiction.

## F-14. The eval suite could not have seen whether S4 helped

`eval:presence` reports `precision=1.0, recall=1.0` on every cell it measures. Two facts about
what it measures:

- **`auth` is `NO_CONVENTION` on 5 of 7 repos**; `rate-limit` on 5 of 7. **Ten cells total.**
- Every cell is scored against **synthetic 50/50 injected fixtures** ("50 ok / 50 bad"), not real
  routes.

So the entirety of S4's helper-identity rewrite — the sprint's whole subject — is measured by
**one cell**, `dub/auth`, on fixtures whose answer is known by construction. It scored 1.0/1.0
before the sprint and 1.0/1.0 after.

The suite did not pass because the change was safe. It passed because it was not looking. This is
the concrete cost of the empty ground-truth corpus (§EVAL-QUALITY 1), and it is a stronger argument
for working the `gt-propose` queue than any abstract one.

---

## What these change about the charter set

- **Charter 08** should expect S-08-1 **REFUTED** and spend its effort on F-2's magnitude question
  and on the `app/dashboard/route.ts` case — the widening pulled non-API app routes into the scope
  of conventions named "api_route_…". Whether that is intended is a real question.
- **Charter 10 / 11** should use `--discover` before measuring any per-kind precision, or they will
  reproduce F-7's error at scale.
- **Charter 15 / 16** should read F-6 first: several existing ratchets are tighter than their
  samples support, so a "regression" may be noise.
- **Charter 22** should note that `glob-parity.json` pins the superseded globs (F-3) — a canary that
  no longer describes the code it guards.
- **Charter 06** now has a concrete target: F-10's 5.9% drop in exported-symbol extraction, with
  route discovery unaffected. Its probe set already covers export forms (P-06-12 … P-06-16); those
  probes should be run against both commits rather than only the current one.
- **Charter 07** should treat F-8's `import_source`-absent residual as its primary target, since
  the resolution path itself is now demonstrably test-pinned (F-9).
- **Charter 14** should start from F-13's corrected form: fingerprints move when the repo moves, so
  P-14-06…P-14-10 gain a probe — record a baseline, relocate the checkout, re-check — and charter
  05's S-05-4 (two identity values, nothing reconciling them) is the likely mechanism.
- **Charter 10** should not trust `eval:presence`'s 1.0/1.0 as evidence of anything (F-14). Ten
  synthetic cells is the measurement, not the product.
