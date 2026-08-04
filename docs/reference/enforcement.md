# Enforcement reference

What `drift check` returns, and why the same violation blocks in one repo and only warns in
another. This is the surface CI and agents branch on, so it is specified rather than described.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | **pass** — no blocking violation in scope |
| `2` | **blocked** — a new violation in a changed hunk, under a block-mode convention |
| `3` | **refused** — fail-closed: enforcement could not be performed, so nothing is claimed |
| `1` | **error** — an operational failure inside Drift itself |

`2` is deliberately distinct from `1`. CI needs to tell "this diff violates the contract" from
"Drift broke", and a crash must never be readable as a clean run.

`3` is returned when Drift declines to answer rather than answering wrongly: the Rust engine is
unavailable and the TypeScript fallback would be used, the stored scan is stale, no contract
exists, or there is not enough disk for local state. A refusal is not a pass.

### `empty_diff_scope`

A refusal with its own cause code, because it is the one a CI pipeline reaches by accident. When the
diff spec resolves to **no examinable files at all**, Drift refuses rather than reporting a pass:

```
$ drift check --diff HEAD --repo <id>     # on a clean tree
exit 3  error.code = empty_diff_scope
```

Nothing was examined, so there is no verdict — and "nothing violated" and "nothing examined" must
not share an exit code, or a hook wired with a wrong range is green forever.

A diff containing **only deletions** is *not* this case. Deleting code is a legitimate change whose
check scope is legitimately empty, so it passes with `0` and says so: `Checked 0 files (1 deleted
file skipped)`. Every check prints `Checked N files`, whatever N is.

`--scope full` is exempt: a repo with no indexable files is a different statement, and `drift doctor`
is the surface that reports it.

`2` outranks `3`. A check that established one violation and could not judge another returns `2`:
a refusal must never mask a violation Drift did manage to prove.

## Partial coverage

Coverage and enforcement are separate questions, and the exit code can only carry one of them.

Drift withholds enforcement from a finding when the finding's **own** dependency chain is
uncertain — the specifier it rests on did not resolve, so Drift cannot show it reaches the module
the contract forbids rather than a lookalike. Uncertainty *elsewhere* does not withhold anything.
An unresolved import in a sibling line, or in another file, is a gap in what Drift saw; it is not
grounds to discard evidence that is complete. (This was once check-wide: one import written before
its file existed suppressed every violation in the diff, which is ordinary mid-refactor editing.)

That leaves a state the exit code cannot express — enforced some findings, failed to see part of
the diff — so it is reported as a field rather than a code:

| Field | Question it answers |
|---|---|
| `summary.partial_coverage.complete` | Did Drift resolve everything in this diff? |
| `summary.partial_coverage.reasons` | Which files it could not fully resolve, as `unresolved_route_import:<path>` |
| `summary.blocked_reasons` | Why enforcement was *withheld* — empty when nothing was withheld |

The two are independent. `partial_coverage.complete: false` with `blocked_reasons: []` is the
normal shape for "the violation blocks, and there is also something Drift did not see."

`check.capability_completeness.can_block` remains the whole-run verdict and is `false` whenever
coverage was partial, even when individual findings were enforced. It answers "could this run have
judged everything?", not "did it enforce what it judged."

**Reading this in CI.** Branch on the exit code. Treat `partial_coverage.complete: false` as a
signal to look at the named files — usually an import written ahead of its file — not as a failure.

## Coverage, as a number

`partial_coverage` answers yes-or-no. `summary.import_coverage` answers how much, and it travels with
every verdict so a clean check is never mistaken for full coverage:

| Field | Meaning |
|---|---|
| `local_import_resolution_rate` | resolved ÷ (resolved + unresolved) for imports Drift classified as should-be-local. `null` when the repo has none — 0/0 is not 100% |
| `resolved_local_imports` / `unresolved_local_imports` | the two sides of that ratio |
| `parser_gap_count` | diagnostics that became `parser_gap` rows |
| `reconciles` | whether the breakdown sums to `parser_gap_count`. A breakdown that does not add up is worse than none, so this is stated rather than assumed |
| `by_code[]` | per diagnostic code: count, the top-level directories it falls in, the top offending specifiers, and a named `limitation` with remediation when the code is a shape Drift knowingly does not resolve |

Third-party packages are excluded from both sides of the ratio. `next/server` resolves to no file in
your repo and never should, so counting it as unresolved would report a coverage failure for correct
behaviour.

`drift doctor` reports the same numbers for the last real scan, and names each known limitation with
what to do about it — which is the difference between "Drift is broken on my repo" and "Drift does
not resolve this one construct."

## Three fields, three different questions

A single check payload carries all of these, and they are not interchangeable:

| Field | Question it answers |
|---|---|
| `check.status` | Did anything blocking happen? (`pass` / `fail`) |
| `finding.enforcement_result` | What would this convention do about this finding? (`block` / `warn` / `none`) |
| `summary.blocking_count` | How many findings actually block this diff? |
| `summary.partial_coverage.complete` | Did Drift resolve everything in scope? (independent of all three above) |

A finding can carry `enforcement_result: "block"` while `status` stays `pass`. That is not a
contradiction: the convention *would* block, but this particular finding is not new code — see
diff status below. Only findings that are simultaneously `status: "new"`,
`diff_status: "new_in_diff"` and `enforcement_result: "block"` count toward `blocking_count`.

## Diff status

| Value | Meaning |
|---|---|
| `new_in_diff` | The finding's line is new code in this diff. Blocks, in block mode. |
| `touched_existing` | The file changed but this line did not. Pre-existing debt; warns. |
| `outside_diff` | Not in scope for this check. |

Every line of an **added** file is `new_in_diff`, in every scope mode. Before this was fixed,
brand-new violating routes inherited the baseline's legacy-code exemption and passed.

A **renamed** file is not an addition. Moving a pre-existing violation keeps it
`touched_existing`, so a refactor is not punished for relocating old debt — while a violation
written into a changed line of a moved file still blocks.

## Why the same violation blocks in one repo and warns in another

This is the most surprising behaviour in Drift, so it is worth stating plainly.

The data-access convention is inferred **from violations**: Drift notices routes importing a
data client and proposes that they should not. That means a repo where direct data access is
universal produces the same statement as a repo where it happens once. Enforcing both identically
would reject new routes written exactly like their neighbours — which is the opposite of holding
code to the repo's established patterns, and precisely the code an agent following local
convention would write.

So the enforcement mode follows the *direction* of the evidence:

- **A minority of in-scope files violate** → the convention is real, the violations are outliers,
  and new ones **block**.
- **A majority violate** → the statement is a refactor goal, not an established rule. It is still
  materialized with full evidence, but only **warns** until a human decides otherwise.

Measured on the evaluation repos:

| Repo | Routes violating | Mode |
|---|---|---|
| formbricks | 1 of 83 | block |
| cal.com | minority | block |
| openstatus | minority | block |
| taxonomy | 4 of 7 | warn |
| dub | ~323 of 494 | warn |
| papermark | majority | warn |

To override, accept the convention explicitly with a chosen mode:

```bash
drift conventions accept <candidate_id> --repo <repo_id> --severity error --mode block --confirm
```

## Baseline

`drift start --accept-defaults` records existing violations as a baseline. Baselined findings do
not block; they are the repo's pre-existing debt. The baseline is what makes it safe to enforce
on a codebase that already violates the convention hundreds of times — new code is held to the
rule, existing code is not, and neither is silently rewritten.

Removing a violation retires its finding. Deleting the file records it in
`summary.skipped_deleted_files` and leaves nothing orphaned.

## Completeness

`capability_completeness` and the scan's `completeness` report what Drift actually inspected.
`complete: false` with `missing_capabilities` means coverage was partial — for example a file
that could not be read, or no data-access convention could be inferred. A *scan's* `can_block` may
still be true: findings that were produced remain trustworthy. What a partial scan must never do
is claim it saw everything.

A **check's** `capability_completeness.can_block` is stricter: see Partial coverage above. It is
`false` whenever the run left something unresolved, because a run cannot vouch for what it did not
read — regardless of how much it did enforce.
