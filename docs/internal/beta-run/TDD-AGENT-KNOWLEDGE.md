# TDD — the agent knowledge surface

**Base:** `7123160b` (post EW-1…EW-10). **Written:** 2026-08-03 after a source-level audit of every
seam named below. Every file:line reference was read at that sha; every number was measured on this
checkout against `~/drift-falsification/repos`.

**Goal.** Drift becomes the thing an agent calls to learn what a repo's conventions *are*, instead of
grepping and auditing to reconstruct them — so it writes conforming code the first time, in a codebase
that was not vibe-coded.

**Red-first throughout.** Write the failing test, watch it fail *for the stated reason*, then
implement. For the inference items the **negative controls come before the recall tests**, without
exception: an over-inferring convention oracle is worse than a silent one, because an agent acts on it.

**Non-goals, stated so they are not mistaken for oversights**

- **Multi-language.** Deferred by decision until TypeScript/JavaScript + Next.js is properly solid.
  Not a gap in this document; a sequencing choice.
- **The 15 unsupported security convention kinds.** They stay out of the knowledge tier until they are
  rebuilt on AST analysis. Their own audit
  (`docs/architecture/security-heuristic-audit.md`) found guard dominance is a line-number comparison
  and branch detection is `line.contains("if")`. Promoting them would repeat the overclaim EW-10 exists
  to prevent, except now an agent acts on it.
- **Source mutation.** Unchanged. Drift never writes the user's code.

---

## 0. The premise, and why it reframes the work

Drift is built as an **enforcement engine**. This goal needs a **knowledge engine**. They optimise for
opposite things, and the difference is not a matter of degree:

| | enforcement | knowledge |
|---|---|---|
| worst failure | a false block | a **missing** convention |
| on uncertainty | refuse (fail closed) | label the confidence and answer |
| population | provable, human-accepted | broad: inferred *and* stated |
| verdict | blocks / warns | never blocks |

Every design pressure so far has pushed toward the first, correctly. That is *why*
`createDriftCapabilities()` (`packages/core/src/capabilities.ts:97`) ships exactly one deterministic
convention kind. But it means: **a tool that only tells an agent what it can prove tells it almost
nothing.** Measured — `drift prepare` on a route file returns 30 top-level keys containing one
prohibition, `selected_contracts: []`, and `test_intelligence: []`.

The resolution is not to lower the enforcement bar. It is two tiers under one ledger discipline:
enforcement stays narrow, provable and blocking; knowledge is broad, confidence-labelled, never
blocking, and **explicit about what it does not know**. Every knowledge class declares its derivation,
its confidence basis, and its false-positive behaviour in the claims ledger, exactly as EW-10 now
requires of every product claim.

### The audit's central finding

**All six agent-contract kinds are already fully enforced. Nothing infers any of them.**

| kind | enforced at | inferred by |
|---|---|---|
| `canonical_helper_reuse` | `run-check.ts:1088` | nothing |
| `module_placement` | `run-check.ts:1285` | nothing |
| `import_boundary` | `run-check.ts:1369` | nothing |
| `file_role` | `run-check.ts:1458` | nothing |
| `entrypoint_flow` | `run-check.ts:1567` | nothing |
| `required_change_checks` | `run-check.ts:1731` | nothing |

They can only reach a contract by being hand-authored and imported. That is why
`selected_contracts` is empty on every repo. So this sprint is not "build a knowledge engine" — it is
**the inference half of one that already has its enforcement half**, which changes the cost of AK-4,
AK-5 and AK-6 by a large factor and is the reason they are worth doing now.

---

## Preconditions (not tasks)

Measured at `7123160b`, on this checkout. Confirm before relying on them.

- **`prepare` latency is the binding constraint, and it is worse than previously assumed.** 0.35s on a
  small fixture; **12.1s and 16.1s on two consecutive cal.com runs.** Earlier planning quoted 8.5s for
  `check` and assumed the packet was cheaper. It is not. AK-9 exists because of this number, and it
  gates whether any of the rest is usable in an agent's loop.
- **No git history reader exists.** `packages/cli/src/io/git.ts` exports exactly `gitOutput` and
  `workingTreeChangedFiles`. AK-4 needs a new one; nothing can be reused.
- **Nearest-neighbour machinery already exists.** `packages/query/src/test-intelligence.ts` picks
  closest tests, and `scoreHelperSimilarity` is already exported from `@drift/query` and consumed by
  `run-check`. AK-5 extends this rather than starting from nothing.
- **`semantic_coverage` already ships in the packet** (`prepare.ts`) and is the natural vehicle for
  AK-2 rather than a new field.
- **The 7 eval repos are non-shallow and clean.** AK-1 and AK-4 both read history; confirm
  `git rev-parse --is-shallow-repository` = `false` before measuring.

---

## AK-1 · A conformance eval `[the instrument — do this first]`

**Why.** There is no way to tell whether Drift is getting better at this. Every existing eval asks
"did it catch an injected violation": recall on one rule. None asks "would following this packet have
produced the code a human actually wrote." Until that exists, every item below is unfalsifiable —
precisely the state EW-7 found the determinism claim in.

**The design decision that keeps it honest: no LLM in the measurement loop.** Scoring an agent's
output would be expensive and non-deterministic, and this codebase's whole discipline is
reproducibility. Instead, score the **packet against the human's real diff**:

1. Pick N commits per repo from history (excluding merges, formatting sweeps and vendored churn).
2. Check out the parent. Run `prepare <commit subject> --path <primary changed file>`.
3. **Conformance:** for every claim the packet made, did the human's diff uphold it? A packet that
   contradicts what the repo's own maintainer did is wrong.
4. **Opinion coverage:** enumerate the decision classes the human's diff exercised — file placement,
   naming, test added, error class, import boundary, co-changed companion — and score the fraction the
   packet spoke to *at all*. This is the number that matters and the one nothing currently measures.

**Seam.** New `scripts/conformance-eval.mjs` beside `external-eval.mjs`, reusing `EVAL_REPOS`,
`contaminationRefusal`, and the committed-baseline + ratchet pattern.

**Red.**
1. Per-repo conformance rate and opinion-coverage rate, both written to
   `scripts/conformance-baseline.json`.
2. **The vacuous-packet control, which is the whole point:** a packet asserting nothing must score
   **0% opinion coverage**, not 100% conformance. Asserting nothing conforms trivially, and a metric
   that rewards silence would actively steer the product the wrong way.
3. The harness refuses on a contaminated worktree, and on a shallow clone (it needs history).
4. Ratchet: both rates may rise freely; a fall fails and names the delta.

**DoD.** Baseline committed for 7/7 repos. The vacuous control scores 0 coverage. Opinion coverage is
published as a number in the ledger — it is the honest headline for this whole direction, and it will
start low.

---

## AK-2 · The packet states what it does not know, and fits a budget

**Why.** Silence reads as endorsement. EW-3 made `check` report what it could not see; `prepare` never
got the same treatment. An agent that asks "what applies here" and receives one convention concludes
there is one convention. A human knows to stay suspicious of a quiet tool; an agent does not.

**Seam.** `packages/cli/src/commands/prepare.ts` (payload assembly, `:150-260`), extending the
existing `semantic_coverage` block rather than adding a rival field. MCP parity:
`packages/mcp/src/index.ts` `get_task_preflight` — the `beta:proof` parity gate will fail otherwise,
as it correctly did for `stored_fact_count` during EW-6.

**Red.**
1. The packet carries a `convention_coverage` block naming, for every knowledge class Drift can in
   principle speak to, whether it has an opinion here and — when it does not — which of
   `no_contract_accepted` / `unsupported_kind` / `insufficient_evidence` / `parser_gap` applies.
2. **Exhaustiveness:** assert the class list against the kind enums, so a class Drift knows about but
   omits from the report fails. A coverage report that is itself incomplete is the EW-3 reconciliation
   failure in a new place.
3. Empty is never bare: `selected_contracts: []` and `test_intelligence: []` must each carry a reason.
4. A ranked, capped `guidance` view, **asserted on serialised bytes, not entry count** — the EW-8
   lesson, where the only assertion that forced a real fix was the one on file size. The full envelope
   stays reachable for audit.
5. Regression: CLI/MCP parity holds.

**DoD.** An agent reading only `guidance` + `convention_coverage` can state what Drift knows and what
it does not. Budget asserted in bytes. `pnpm beta:proof` green.

---

## AK-3 · Agent-contract candidate inference `[the missing half]`

**Why.** Six kinds are enforced and none are inferred (§0). The enforcement handlers are written,
tested and reachable; contracts simply never arrive. This item builds the path, once, so AK-4/5/6 are
each a deriver rather than a subsystem.

**Seam.** Mirror the existing convention flow: inference produces a **candidate**, a human accepts it,
acceptance writes the contract. `packages/cli/src/domain/convention-candidates.ts` and
`crates/drift-engine/src/candidate_command.rs` are the shape to follow. Governance already forbids
auto-acceptance (`human_approval_required_for` includes `accept_convention`) — do not weaken it.

**Red.**
1. A repo containing an obvious instance of a kind yields a **candidate**, never an accepted contract.
2. The candidate carries a confidence tier and its derivation, and the claims ledger has an entry for
   the class with an evidencing test — EW-10's validator must fail if it does not.
3. **Negative control:** a repo with no such pattern yields no candidate.
4. End to end: an accepted candidate appears in `selected_contracts` and is enforced by the *existing*
   handler, with no change to it — proving inference was the only missing half.
5. Auto-acceptance is impossible by any path, asserted.

**DoD.** One kind end to end. `selected_contracts` non-empty on a repo where the pattern exists. No
handler modified.

---

## AK-4 · `required_change_checks` from co-change `[highest value, easiest to get wrong]`

**Why.** The single most expensive class of convention to discover by hand, and the one agents break
most — they edit one file and stop. Measured on *this* repo during the EW sprint: learning that a
storage migration requires bumping a pinned list in `sqlite-storage.test.ts` and
`supported_sqlite_schema_version` across ~21 sites in 5 files took **three separate rounds of failing
tests**. No grep would have surfaced it. Drift said nothing.

**Seam.** A new history reader in `packages/cli/src/io/git.ts` (nothing to reuse — see Preconditions),
feeding a deriver that emits `required_change_checks` candidates through AK-3.

**Red — negative controls first, and they are not optional.** Co-change frequency is statistically
seductive and trivially wrong:
1. A commit touching 500 files (a formatting sweep, a lockfile bump, a vendored update) produces **no**
   pairs. The size cap is a recorded number with its rationale, not a magic constant.
2. Renames produce no pairs — git rename detection, not path equality.
3. Merge commits are excluded.
4. A pair co-changing by coincidence, below a stated confidence floor, is not reported. The floor is
   recorded and justified.
5. **Direction is preserved:** X⇒Y is not Y⇒X. Assert asymmetry where the history is asymmetric —
   a migration implies a version bump; a version bump does not imply a migration.

**Then, and only then, recall.**
6. On this repo, the derived pairs include `packages/storage/src/migrations.ts` ⇒
   `packages/storage/test/sqlite-storage.test.ts`, with a confidence and the commit count behind it.

**DoD.** All five negative controls green before any recall claim. The migration pair derived on this
repo. **False-pair rate measured and recorded per eval repo** — a deriver whose precision is unmeasured
is a heuristic wearing a contract's clothes.

---

## AK-5 · `canonical_helper_reuse` → exemplars, not just prohibitions

**Why.** Drift says "do not import the data client." An agent writing a new route needs "here is what a
route in this repo looks like." Drift already knows every route file, its imports and its role — it has
the facts and does not serve them.

**Seam.** `packages/query/src/test-intelligence.ts` already implements closest-neighbour selection;
`scoreHelperSimilarity` is already exported from `@drift/query`. Extend, do not rebuild.

**Red.**
1. For a target path, the packet names the N nearest conforming siblings **and why they are
   comparable** — same file role, same framework entrypoint kind, comparable directory depth.
2. **An exemplar never has an open finding against it.** Offering an agent a file that violates the
   contract as a model is the worst available failure, and it is easy to write by accident.
3. **Negative control:** a path with no comparable sibling returns none and says so, rather than
   reaching for a distant file to fill the slot.

**DoD.** Exemplars on 7/7 repos for an API route; the no-sibling control silent; AK-1 opinion coverage
rises, measured.

---

## AK-6 · `module_placement` → where a new file goes and what it is called

**Why.** Agents get this wrong constantly, and it is derivable from path structure and sibling names.

**Red.**
1. Given an intent and a role, the packet proposes a directory and a filename pattern, with the
   evidence count behind each.
2. **Negative control:** a repo with genuinely inconsistent placement reports low confidence rather
   than picking one arbitrarily. Confident wrong advice is worse than none — an agent will follow it.
3. Drift's own repo is a good adversarial case: tests live in four different places by area
   (`packages/*/test`, `test/e2e`, `crates/drift-engine/tests`, `scripts/*.test.mjs`). The right answer
   is role-conditioned, not one global rule.

**DoD.** Proposals on 7/7 with confidence; the inconsistent-placement control degrades rather than
guesses.

---

## AK-7 · Stated-but-unverified conventions

**Why.** Drift ignores the repo telling it the answer. cal.com ships a `CLAUDE.md` and ~25 files under
`agents/rules/` — every one a real convention, written down, none read. For the agent use case that is
a strange omission: much of what an engineer follows is documented somewhere, just not
machine-checkably.

**Seam.** New reader over a **closed, stated list** — `CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
`docs/**/rules/*.md`. Not a glob over all markdown: ingesting arbitrary prose is how a knowledge tier
fills with noise.

**Red.**
1. Rules become `stated_not_verified` entries carrying source file and line. **Never enforceable,
   never in `convention_kinds`, never blocking.**
2. The claims ledger gains the class; `enforcement_posture` classes it advisory. EW-10's validator
   fails if either is missing.
3. **Negative control: no path promotes prose to enforcement.** Assert it directly.
4. Scale: cal.com's rule files yield entries, and AK-2's byte budget still holds.

**DoD.** Measured on cal.com: packet goes from 1 convention to 1 verified + N stated, each labelled and
attributed. Opinion coverage in AK-1 rises, and the rise is attributed to the *stated* tier so nobody
later mistakes it for verified coverage.

---

## AK-8 · Rationale, and a path to an exception

**Why.** Today's rationale is provenance: *"Detected API route imports that look like
database/data-access clients."* That tells the agent how Drift found the rule. An engineer needs why it
exists and when it does not apply, or they contort the code instead of asking.

**Red.**
1. Rationale distinguishes **derivation** (how Drift concluded this) from **reason** (why the repo holds
   it), with derivation never presented as reason.
2. The packet names the exact waiver command for this convention and this path.
3. An agent-authored exception request is recorded as a **candidate** waiver requiring human approval —
   never auto-granted. The governance invariant already exists; this must not weaken it.

**DoD.** Both fields present; the auto-grant impossibility asserted.

---

## AK-9 · Packet latency at agent scale `[gates everything above]`

**Why, with the measurement.** `prepare` is 0.35s on a small fixture and **12.1s / 16.1s on two
consecutive cal.com runs**. An agent consulting Drift before each edit cannot pay that. This reverses a
prior decision: `P-1` (delta payload) was deferred on the assumption that beta ships as a CI gate plus
advisory local checks. If the knowledge packet becomes the primary surface, **P-1 stops being
deferrable** — it is what makes tier two usable at all.

**Red.**
1. **Profile before optimising.** The first deliverable is where the 12–16s goes, published. No
   optimisation lands before that, or the sprint will optimise the wrong thing.
2. A `prepare` latency cell in `beta-bench.mjs`, per repo, ratcheted like the gap counts.
3. A stated budget, met on the largest eval repo. Pick the number deliberately and defend it in the
   commit; do not fit it to whatever the measurement happens to be.

**DoD.** Budget met on 7/7, or the budget is renegotiated **with the measurement published** — the
pre-registered fallback, so this cannot quietly become "fast enough".

---

## AK-10 · Independent ground truth for the knowledge tier

**Why.** papermark's evasion fixture injected `import { prisma } from "@/lib/prisma"` against a module
that only default-exports — code that would not compile in the repo under test. It stayed green for as
long as it did **because** the extractor's default-export blind spot made the module appear to export
nothing, so symbol resolution was skipped and nothing objected. A harness cell was green on the
strength of a product bug, and only removing the bug (EW-4) surfaced it.

For an enforcement tier that is embarrassing. For a knowledge tier it is disqualifying: Drift would be
asserting conventions about a repo with nothing independently checking they are true *of that repo*.

**Red.**
1. Every injected fixture and shape is validated **independently of Drift** — at minimum, that the
   injected code resolves under `tsc --noEmit` or an equivalent third-party resolver.
2. A fixture that cannot compile in its target repo fails the harness, naming the file.
3. Retro-active: run it across the existing fixtures and shapes; record what it finds, including
   nothing.

**DoD.** No fixture can be green because Drift shares its blind spot. Applied to the existing suite,
not only to new work.

---

## Order

```
AK-1 ────────────────────────> everything            the instrument; nothing is measurable before it
AK-2                                                 independent, cheapest, makes tier two safe to ship
AK-3 ──> AK-4                                        co-change: the highest-value kind
     ├─> AK-5                                        exemplars
     └─> AK-6                                        placement
AK-7                                                 independent of AK-3 (stated tier, not inferred)
AK-8                                                 independent
AK-9                                                 gates whether any of it is usable in the loop
AK-10                                                independent, and retro-active
```

**Parallelisable immediately:** AK-1, AK-2, AK-7, AK-9 (profile), AK-10.
**AK-4 is the long pole** and the only one that should be time-boxed. Its negative controls are the
deliverable; if the box expires with the controls green and recall thin, that is a success — ship the
controls and publish the precision number.

---

## Deferred, and the decision that changes it

`entrypoint_flow` and `file_role` inference are deferred: both are enforced already, but their value to
an agent is lower than AK-4/5/6 and their derivation overlaps the security layer's shaky ground. They
move up if AK-1's opinion-coverage measurement shows an agent's decisions concentrating there — which
is exactly the question AK-1 exists to answer, so do not pre-judge it.

---

## Standing rules

Carried from the EW sprint, plus what that sprint cost us:

- Foreground every suite. Backgrounded evals stalled three agents in run 3.
- `pnpm eval:external` after every task, **never batched** for matcher, resolver, enforcement-mode or
  exit-code changes. Re-run `eval:evasion`, `eval:bench` and `eval:determinism` as DoD proof for
  anything touching inference or the packet.
- Rebuild `target/release` before any measurement; confirm eval repos are non-shallow and clean.
- The implementer never verifies its own task; the verifier gets the DoD and the sha, not the reasoning.
- **Assert that a scripted edit landed.** In the EW sprint a patch script printed "ok" without checking
  its match, the contamination guard's call shipped without its import, `node --check` passed because
  an undefined reference is a runtime error, and `eval:external` was broken at commit time while being
  reported as green.
- **A fixture change that alters what a cell measures is a behaviour change.** Re-run the matrix before
  believing it. A "fix" to the papermark barrels silently turned three catch cells into evasions.
- **Every knowledge class needs a ledger entry and an evidencing test before it ships.** EW-10's
  discipline extends to tier two; that is the only thing standing between this and the security layer.
- **Attribute every measurement to the sha that contains it.** Two corrections were needed in the EW
  sprint for numbers recorded against the wrong tree.
