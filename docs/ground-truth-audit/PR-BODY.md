# PR body — `remediation/ground-truth-audit` → `main`

The exact body to post. The PR was not opened because `git push` was denied by this session's
permission policy; the branch is complete and local. **Do not merge on sight** — the §9.4.6 gate
does not pass, and the blockers are listed below.

Command to open it, once a push is permitted:

```bash
git push -u origin remediation/ground-truth-audit && gh pr create --base main --head remediation/ground-truth-audit --title "Ground-truth audit remediation: D1-D5, plus two defects the audit did not name" --body-file docs/ground-truth-audit/PR-BODY.md
```

---

## Ground-truth audit remediation: D1–D5, plus two defects the audit did not name

**Repo:** `/Users/geoffreyfernald/drift-falsification/drift` · **Baseline:** `255f2208` · `main` never moved.

**⚠️ This PR is deliberately not merged.** The §9.4.6 merge gate does not pass. Two of the three
blockers are pre-existing failures at `255f2208` that this work declined to absorb, and the third
is an unpredicted delta magnitude that wants a human eye. A merged-but-broken `main` costs far
more than a PR awaiting review.

### What shipped

All five audited defects, each proven by a test verified red at the pre-fix commit for an
**assertion** reason (not a setup reason) and green after:

- **D1 (P0)** — the sensitive-response-fields check could not fire. Both halves: `candidate_command.rs:642` stops destroying provenance, *and* the CLI accept path stamps `accepted_inference`, *and* `security_patterns.rs:266` admits that value. Fixing only the accept path would have left provenance destruction in place.
- **D2** — one declaration, one `exported_symbol` fact named `default`. S2 branch resolved: the pinned assertion was incidental.
- **D3** — a local `export { name }` is an exported symbol, following EW-4's `name`/`imported_name` convention (not `value`).
- **D4** — data-layer name tokens match at segment boundaries, covering `data-access` as well as `db`.
- **D5.1 / D5.2** — findings grouped per import statement; flagged only on invocation evidence.

Plus the regression infrastructure: a workflow-level e2e harness that obtains its convention from
the proposer and **never injects one**, and an 18-cell (kind × enforcement path) canary ledger with
CI enforcement.

### Two defects the audit does not name

D1 could not fire after fixing exactly what the spec specified, because of these:

1. **`path_glob_matches` never implemented `**/` as zero-or-more segments**, so phase-5 rejected every file of every proposer-produced convention. Already known and deferred in-tree — the comment above `presence_file_in_scope` records it as "F3's exact shape, still live in this matcher". This is the fix that comment deferred.
2. **`call_argument_text` truncated response literals at the first comma**, so `res.json({ id, email, password })` emitted a fact for `id` alone.

### The regression this PR's own process caught

D5.2 merged with a green local suite and then broke enforcement on every held-out repo —
`eval:evasion` 39 failing shapes, `eval:presence` `false_negatives 0 → 50`. Cause: the
`unary_expression` and comparison arms returned a hardcoded `Inert`, discarding `is_member_read`,
so a bare datastore handle was treated like a member read of an enum. Fixed; T3 #3 confirms
`eval:evasion` and `eval:presence` back to "no change vs baseline".

No `--update`, `vitest -u`, or `*-baseline.json` edit was made by any subagent at any point. Had
one been, that 50-false-negative hole would have been baselined as expected behaviour.

### Why it is not merged

| Gate condition | |
|---|---|
| `pnpm verify:ci` green | ❌ `release-hygiene > runs an executable beta proof` — **reproduces on a clean checkout of `255f2208`**; belongs to the in-flight W7 parser-gap work |
| `pnpm verify:evals` green, deltas predicted and named | ❌ `eval:external` red at baseline (5/7 repos before this work; **3/7 after**), and D5.2's `baselined` reductions were named but not predicted in magnitude |
| every §7 row met with evidence | ✅ |
| no track blocked | ✅ |

The `eval:external` failure is root-caused in `docs/ground-truth-audit/ENVELOPE-BUDGET-INVESTIGATION.md`:
`f3f81257` added itemized parser-gap records to the `scan status` payload, which `prepare --json`
embeds wholesale — 50.4% of a 714 KB envelope on openstatus. A fix already exists in flight on
`remediation/w7-detection`; this branch does not cherry-pick it, because pulling another branch's
unmerged commits in to make a gate go green is the same act as blessing a baseline.

### What needs a human

1. **`openstatus baselined 30 → 15`** — half its findings. Detection is proven intact by two independent oracles (`eval:evasion` 91 cells no change; `eval:presence` fp=0 fn=0), so this is the intended direction of a precision fix — but the magnitude was never predicted, and §9.4.4 says an unpredicted delta is a stop, not a bless. Nothing was pinned.
2. **The state-DB migration** — deliberately not written. It is the only irreversible act in the plan. `docs/decisions/d1-sensitive-field-source-migration.md` records it as considered-and-deferred with its two constraints.
3. **`api_route_requires_service_delegation` × graph** — the most D1-shaped thing found. Candidate proposes and accepts cleanly, yet produced zero findings on all ten fixtures probed, including violation-shaped ones. No quarantine citation exists. Left `needs-review` and reported rather than declared a P0.

### Full report

`docs/remediation-report.md` — §7 table with evidence, the six TDD contradictions found, ledger
counts with each `needs-review` cell's missing evidence, every blessed delta with its prediction
beside its observation, and before/after eval numbers.
