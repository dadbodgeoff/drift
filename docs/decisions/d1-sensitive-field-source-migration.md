# D1 — the state-DB migration, considered and deferred

**Status: not shipped. Deliberately.** Recorded here so whoever authorizes it later does not
rediscover the two constraints below, and so nobody reads its absence as an oversight.

Governing document: `docs/tdd-ground-truth-remediation.md` §5.1, "Compat" and the paragraph
headed **RESOLVED — the state-DB migration is out of scope for this remediation**.

## What the migration would be

D1 fixed a P0: `api_route_forbids_sensitive_response_fields` could not fire on any repo, because
the candidate proposer hardcoded `"source": "candidate"` into every proposed field
(`crates/drift-engine/src/candidate_command.rs`) and the proof deliberately refuses to enforce on
`"candidate"` — an unreviewed name-heuristic guess
(`sensitive_field_source_is_trusted`, `crates/drift-engine/src/security_proof.rs`).

The fix corrects provenance **going forward**: newly proposed fields keep the `source` extraction
gave them, and `drift conventions accept` re-stamps a `"candidate"` field as
`"accepted_inference"` (`packages/cli/src/domain/convention-candidates.ts`).

Conventions accepted **before** the fix still carry `"candidate"` at rest and still enforce
nothing. `packages/storage/src/migrations.ts` exists with 26 id-keyed migrations and a
`schema_migrations` table, so a migration promoting those rows has an obvious home and a pattern
to follow. That is precisely why this note exists: the obvious remedy is the one being declined.

## Why it is not shipped

1. **It is the only irreversible act in the remediation.** It flattens provenance that cannot be
   recovered without re-scanning source for markers, and it silently converts previously-quiet
   checks into firing ones over state that Drift's owner never re-inspected.
2. **The non-destructive path covers the same users.** The dead-config diagnostic (§5.1.4, shipped
   with D1) tells anyone holding a pre-fix accepted convention that it has no enforceable fields
   and points them at re-accepting. That restores enforcement *by user action*, with provenance
   recorded correctly on the way through, rather than by a one-way rewrite of their database.
   See `sensitive_response_field_config_diagnostics` in
   `crates/drift-engine/src/check_command.rs`, surfaced as `summary.unenforceable_conventions` in
   `drift check --json`.
3. **Nothing downstream depends on it.** Every §7 gate row is met by the in-flight fix plus the
   diagnostic. The migration would only change how fast existing users get there.

## The two constraints, if it is ever authorized

Both are quoted from §5.1's compat block and must survive into any future implementation.

### Discriminator constraint

An unconditional "promote all accepted conventions" is **wrong**. A hand-authored config may say
`"candidate"` deliberately, meaning *not yet enforcing*, and the value alone cannot distinguish
that from a pre-fix Drift write. Use the **migration boundary** as the discriminator: promote only
rows that exist at migration time, and treat any later `"candidate"` as intentional.

### Lossiness constraint

Pre-fix, the proposer overwrote `"schema"` with `"candidate"` *before* persistence, so
marker-derived and heuristic-derived fields are **indistinguishable at rest**. Any migration
therefore promotes both to `"accepted_inference"`, understating the marker-derived ones.

This is harmless for enforcement — both clear the trust filter — but it means `"accepted_inference"`
on a pre-migration row reads as **"was `candidate` at rest"**, *not* **"was inferred"**. Nobody may
build trust-weighting or UI on that value for old rows.

## Tests

There is deliberately **no migration test, because no migration ships**. The user story is covered
non-destructively instead, by
`crates/drift-engine/tests/gt_sensitive_field_provenance.rs::check_reports_an_accepted_convention_with_nothing_left_to_enforce`,
which drives the real engine over an accepted convention whose fields are all `"candidate"` — the
exact state a pre-fix acceptance leaves behind — and asserts the diagnostic fires and the check
still does not enforce.
