# `request_validation_called` — making the presence facts obtainable

Branch `remediation/presence-facts`, forked from `main` at `4a20a8bc`.

Target: `api_route_requires_request_validation :: presence_findings`, the ledger cell whose
`missing_evidence` said no fixture could ever lift it. That was correct, and it was a code gap.

---

## 1. What was actually broken

The chain, each link verified in source:

1. `request_validation_called` is emitted only for a call matching an entry in `accepted_validators`
   (`security_facts.rs`, the `accepted_request_validator_for_call` branch).
2. The scan path — the **only** place the scanner extracts security facts — called the 3-arg
   `extract_security_facts`, whose wrapper hard-codes `&[]` for the validators when it delegates.
   (The `&[]` visible at the call site is `accepted_auth_helpers`; the validator slice is hidden one
   frame down. Both are empty.)
3. So the kind had **zero instances in every repo Drift had ever scanned**.
4. `FAMILY_SPECS`' request-validation entry sources that kind and nothing else — `symbol_called` is
   deliberately excluded there, because admitting it produced an 89-member family on dub.
5. So the family could never form → no candidate of this kind ever carried
   `enforcement_semantics: "presence"` → `check_command.rs`'s arm 3 was unreachable for this kind.

The enforcement path was **complete and unreachable**: `presence_missing_code`,
`presence_finding_title` and `presence_noun` all already carry an
`api_route_requires_request_validation` arm. Nothing could route into them.

This is also why it was the only one of the acceptance-gated kinds that mattered: every sibling
family has a `symbol_called` fallback source (the rate-limit family literally lists one beside its
dead `rate_limit_guard_called` source). Request validation had none.

## 2. Design chosen, and the one that does not work

**Chosen: scan-time validator recognition.** `scan_time_request_validators` (`security_facts.rs`)
derives a per-file registry from the file's own `symbol_called` facts and passes it in at the scan
call site (`main.rs`). Cost is one pass over a vector already in hand — no second parse.

**Why not "plumb the accepted helpers into scan", the obvious reading of the task.** It cannot work,
and the reason is structural rather than fiddly: **at first scan nothing is accepted yet.** The
family's job is to *propose what to accept*; gating its input on acceptance makes the output of the
pipeline a precondition of its input. A rescan-on-accept step does technically terminate — accept
the per-symbol candidate, rescan, then the family forms — but it makes the family a strictly
downstream artifact of a convention the user already accepted, adds a step to the documented
workflow, and needs a protocol change to carry accepted conventions into `scan`. It is bigger and
it buys a worse thing.

**Why recognised shape is the honest gate.** Acceptance is not removed, it is left where it always
bound — at check time. `build_request_validation_proof_with_scope` (`security_proof.rs`) re-extracts
from source with the convention's real `accepted_validators` and **never reads a scanned fact**, so
nothing here can satisfy a proof. The presence path reads `symbol_called`, not this kind. Scan-time
`request_validation_called` is consumed by exactly two things: the proposer, which is *supposed* to
see unaccepted code, and the `security-architecture-audit` view.

This is precisely how the sibling auth family already works — `symbol_called` is unfiltered by
acceptance at scan, the proposer nominates, a human accepts, the check enforces. Request validation
was the one family sourced from an acceptance-gated kind. That was the bug.

**Two narrowings, both load-bearing:**

- *Shape.* The family's nominator is `always_candidate_symbol`, so every symbol carrying this kind
  joins. Emitting for every call would rebuild the 89-member dub family. The predicate is
  deliberately the same table as the proposer's `is_validation_candidate_symbol` (`validate*`,
  `*validator*`, `safeParse`, minus `revalidate*` / `*permission*` / `*role*`).
- *Import.* `family_member_inputs` drops any symbol whose `dominant_import_source` is `None`, so an
  unimported symbol can never be a member. It is not inert either — a second, older per-symbol loop
  over `request_validation_called` emits a candidate the live `symbol_called` path already emits
  under the same id — so registering an unimportable symbol buys one duplicate candidate and no
  family member. `safeParse` is exactly that case: always written `Schema.safeParse(body)`, never
  imported, and it is the sibling *proof* cell's symbol, which re-extracts with the accepted schema
  at check time and never wanted a scanned fact.

`behavior` is recorded as `unknown`, not guessed. A recognised shape says a validation call
happened; it says nothing about throws / returns-parsed / boolean. Acceptance pins that down later.

## 3. Fact-kind table

Measured, not inferred: the whole 92-fixture corpus was scanned through the real CLI and the
distinct fact kinds collected, once with the fix and once with the `&[]` restored.

**The fix adds exactly two kinds and moves no other count.**

The acceptance-gated set at scan time — every kind whose emission is gated on one of the empty
accepted-inputs (`accepted_auth_helpers` / `accepted_validators` / `phase4_policy` /
`accepted_phase5: None`):

| fact kind | gate at scan | before | after |
|---|---|---|---|
| `request_validation_called` | `accepted_validators` empty | dead | **obtainable** |
| `validated_input_used` | derived from `request_validation_called` | dead | **obtainable** |
| `auth_guard_called` | `phase4_policy` / `accepted_auth_helpers` empty | dead | still dead |
| `callback_boundary_detected` | nested inside the `auth_guard_called` branch | dead | still dead |
| `authorization_guard_called` | `phase4_policy.authorization_helpers` empty | dead | still dead |
| `tenant_source` | `for key in &phase4_policy.tenant_keys` — empty, body never runs | dead | still dead |
| `tenant_guard_called` | same empty `tenant_keys` loop | dead | still dead |
| `serializer_called` | `accepted_phase5` is `None` | dead | still dead |
| `secret_read` | `accepted_phase5` is `None` (early return) | dead | still dead |

That is **nine**, where the brief said seven. The reconciliation: two of the nine are second-order —
`validated_input_used` is derived from `request_validation_called` rather than separately gated, and
`secret_read` is gated by the same phase-5 contract as `serializer_called`. The seven
primary-gated kinds are the rest. Nothing here contradicts the brief; the count just depends on
whether the derived pair is counted.

**Why the seven stay dead, and why that is the right outcome for this change.** Each has a
`symbol_called` fallback in the proposer, so none of them blocks a family the way request validation
did. Reviving them means deciding what "recognised shape" means for auth wrappers, authorization
guards, tenant keys and phase-5 contracts — four separate judgement calls, each with its own
over-aggregation risk, and none of them is this cell. They are listed here as the worklist, not
silently left out.

**Two other classes found while measuring, neither one this change's:**

- **Declared but emitted nowhere.** `csrf_guard_called`, `rate_limit_guard_called` and
  `test_declared` appear only in `vocabulary.rs` — no extractor produces them, in any configuration.
  `rate_limit_guard_called` is a `FAMILY_SPECS` source; that family survives only because it lists a
  `symbol_called` source beside it.
- **Corpus gap, not code gap.** `data_model_declared`, `data_model_field_declared`,
  `data_model_relation_declared` never appear because the corpus contains **zero** `.prisma` files.
  The extractor exists and is reachable.

## 4. Mutation matrix

| mutation | expected | observed |
|---|---|---|
| `&[]` restored at the scan call site | canary dies | **both halves fail**: proposer emits **zero** presence families, so `acceptOnly` selects nothing. Exactly the structural unreachability. |
| `&[]` restored — corpus census | two kinds disappear | `request_validation_called` and `validated_input_used` gone; every other count identical |
| `&[]` restored — Rust suite | still green | still green, correctly: those tests call the extractor directly and pin its contract, not the wiring. **The wiring is covered only by the e2e canary** — noted, not hidden. |
| fix in place — sibling proof cell | unchanged | `request-validation safeParse proof path fires` passes; `safeParse` is not registered (no import), so `gt-request-validation` scans exactly as before |

## 5. Evidence

- `cargo test -p drift-engine` — green (incl. the 5 new tests in `tests/scan_time_validators.rs`).
- `pnpm verify:ci` — green.
- `test/e2e/gt-canary.test.ts` — 16/16, including the new
  `request-validation presence family fires per handler`.
- Ledger cell moved `needs-review` → `firing` with its evidence; `DRIFT_LEDGER_ENFORCE=1
  node scripts/convention-cell-ledger.mjs` passes (11 firing, 6 needs-review, 18 declared).

The canary drives the documented workflow end to end — `scan → start → conventions accept
--mode block --severity error → check --scope changed-hunks --diff-file` — and never touches
`upsertAcceptedConvention` or hand-writes a `requires` block. Result: 3 presence findings, one per
unvalidated handler, each at its own handler's line, `blocking_count` 3, **exit 2**; and 0 on the
inverse fixture, **exit 0**.

Fixture (`gt-presence-request-validation`) carries the negative controls the §4.3 bar asks for:

- an unvalidated route calling `revalidateTag` and `hasPermission` — the two excluded shapes — which
  must not join the family and must still be flagged;
- a two-handler file where `POST` validates and `PUT` does not, flagged once, on `PUT`, which is
  what stops a file-wide answer from excusing "validate the read, forget the write";
- a `webhooks` route, equally unvalidated, which must stay **silent** because the family is
  api-route-conditioned — proving the flavour scoping is real rather than incidental.

## 6. Handoffs

1. **`candidate_command.rs` proposes one candidate twice.** Two paths emit the per-symbol
   request-validation candidate — `push_request_validation_candidates` from `symbol_called`, and an
   older inline loop over `request_validation_called`. With the scan fact now obtainable, an
   *imported* validator helper triggers both, and they are byte-identical including the id. One
   should dedupe or go. Not fixed here: that file is owned elsewhere this wave. The import narrowing
   in §2 keeps it away from the existing corpus, so nothing is red — but the redundancy is real and
   will surface on any repo with imported `validate*` helpers in ≥2 routes.
2. **The shape table is duplicated.** `is_recognized_validator_symbol` (`security_facts.rs`) mirrors
   the private `is_validation_candidate_symbol` (`candidate_command.rs`). They are asserted equal
   case-by-case by `scan_time_validator_shapes_match_the_proposer_table`, but a single shared
   predicate is better; it needs an export from the owned file.
3. **The wiring has no Rust-level guard.** Restoring the `&[]` in `main.rs` leaves
   `cargo test -p drift-engine` green — `main.rs` is the binary and the scan path is not reachable
   from an integration test. Only the e2e canary catches it.
4. **`rate_limit_guard_called` and `csrf_guard_called` are emitted by nothing.** See §3.
5. **The corpus has no `.prisma` file**, so three declared fact kinds are never exercised end to
   end. Cheap to close with one fixture.

## 7. Pre-existing failure repaired (not part of this change)

`main` at `4a20a8bc` was **already red**: `pnpm test:e2e` failed on
`request-validation safeParse proof path fires`, which asserted `checkExitCode === 0` for its
full-scope run. #121 (`remediation/check-pipeline-honesty`) had turned that silence into a
first-class refusal — a block-mode convention that cannot block now reports `full_scope_cannot_block`
and exits 3 — and left this assertion stale.

Repaired here, because it blocked the green bar this branch is held to. The replacement is the
stronger claim: it pins the refusal code, `check.status === "refused"`, and the `blocked_reasons`
entry, where the old assertion said only "nothing blocked". Flagged separately so it is not read as
part of the presence work.

One harness addition supports the canary: `WorkflowOptions.acceptOnly`, which narrows `acceptKinds`
to the candidates a run is about. It is not an injection back door — the candidate still comes from
the proposer and still goes through the real `conventions accept`; it only chooses which of the
proposer's own candidates a human accepts. It is needed because accepting *all* candidates of this
kind stacks two per-symbol conventions that each demand their own single validator on every route,
so a route validated by the other member is flagged and no repo of that shape can ever be clean —
the over-narrowness families exist to fix, and not this cell.
