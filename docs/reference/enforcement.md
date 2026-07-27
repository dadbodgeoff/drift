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

## Three fields, three different questions

A single check payload carries all of these, and they are not interchangeable:

| Field | Question it answers |
|---|---|
| `check.status` | Did anything blocking happen? (`pass` / `fail`) |
| `finding.enforcement_result` | What would this convention do about this finding? (`block` / `warn` / `none`) |
| `summary.blocking_count` | How many findings actually block this diff? |

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
that could not be read, or no data-access convention could be inferred. `can_block` may still be
true: findings that were produced remain trustworthy. What a partial scan must never do is claim
it saw everything.
