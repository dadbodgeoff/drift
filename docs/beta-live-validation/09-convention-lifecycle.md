# CHARTER 09 — Convention lifecycle

**Depends on:** 05 · **Est. 4 h** · **Output:** `results/09-convention-lifecycle.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 09 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 09 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 09` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Drive every convention kind through its full lifecycle — proposed, reviewed, accepted, edited,
excepted, rejected, exported, imported, waived — and find every kind that cannot complete it.
There are **23** kinds. Four have no evaluator. Two more are declared proposable with no proposer
code. This charter establishes exactly which of the 23 a real user can actually turn into a gate.

## 2. The vocabulary

23 `ConventionKind` variants (`crates/drift-engine/src/vocabulary.rs:722-746`, mirrored in
`packages/vocabulary/src/index.ts:208-232`, generated from `vocabulary/vocabulary.json`).

Derive the current table yourself — the source of truth is generated:

```bash
node -e "const v=require('./vocabulary/vocabulary.json');console.log(JSON.stringify(v,null,1))" | head -80
pnpm check:vocabulary
```

Known shape at the time of writing:

- **13** carry `security_contract: true` (`packages/vocabulary/src/index.ts:295-309`).
- **4** are in `UNEVALUATED_CONVENTION_KINDS` / `UNIMPLEMENTED_CONVENTION_KINDS`
  (`capabilities.ts:237`): `api_route_requires_service_delegation`, `middleware_must_cover_routes`,
  `test_expected_for_changed_module`, `custom_briefing`.
- **4** are declared `proposable: true` with **zero proposer code** in `candidate_command.rs`:
  `api_route_forbids_secret_exposure`, `session_object_must_come_from_trusted_helper`,
  `test_expected_for_changed_module`, `custom_briefing` (§22 obs. 10).
- **6** dispatch to `cli` rather than the engine: `file_role`, `module_placement`,
  `import_boundary`, `entrypoint_flow`, `canonical_helper_reuse`, `required_change_checks`.

## 3. Procedure

### Per-kind lifecycle matrix — the core deliverable

For **each of the 23 kinds**, in its own fresh state root, against a fixture that should provoke
it:

| Step | Record |
|---|---|
| L1 | Is a candidate **proposed**? (`drift candidates`, `drift conventions list`) |
| L2 | Does `drift candidates show` / `conventions show` render its evidence? |
| L3 | Does `drift conventions accept` **succeed**? If it refuses, the exact text and **exit code**. |
| L4 | Does it appear in `drift conventions accepted` and in `drift contract show`? |
| L5 | Does `drift check` produce a **receipt** for it, with `reached` and `inputs_considered`? |
| L6 | Can it **block**? (`--mode block --confirm`, then a real violation → exit 2) |
| L7 | `drift conventions edit` — does the edit persist and change enforcement? |
| L8 | `drift conventions exception add` — does the exception actually exempt? |
| L9 | `drift conventions reject` **after** acceptance — does the `accepted_conventions` row get withdrawn? (§3.5 documents this as a deliberate fix, D-CL1.) |
| L10 | Does each mutating step write an `audit_events` row? |

Output: a **23 × 10** matrix. Every `no` is a finding.

### The gated and the unproposable

| Probe | What to do |
|---|---|
| P-09-01 | `--experimental-security`: run the full accept flow for all 13 security kinds **with and without** the flag. `EXPERIMENTAL_SECURITY_CONVENTION_KINDS` is now derived from `SECURITY_CONTRACT_CONVENTION_KINDS` (`capabilities.ts:200`) — confirm all 13 are gated, including `api_route_forbids_secret_exposure`, whose omission was the original bug. |
| P-09-02 | For the 4 kinds with no evaluator: attempt acceptance and record the **exact numeric exit code** of the plain `Error` thrown at `convention-candidates.ts:51-55`. §15/§18a record this as **CANNOT DETERMINE** from source. This charter closes it. |
| P-09-03 | For the 4 declared-proposable-with-no-proposer kinds: confirm no candidate is ever proposed, then attempt to introduce one another way — hand-authored contract, `contract import`, `conventions edit` — and record whether the declared-but-unreachable state is escapable. |
| P-09-04 | Cross-check `CANDIDATE_CONVENTION_KINDS` (17 entries) against what the proposer actually emits across all 7 corpus repos. Report the delta. |

### Contract storage, transport, waivers

| Probe | What to do |
|---|---|
| P-09-05 | `contract export` → `contract import` round trip into a **fresh** state root. Byte-compare the re-exported contract. |
| P-09-06 | `contract validate` on: a valid contract, a hand-corrupted one, one referencing an unknown kind, one from a different schema version, one from a different repo. |
| P-09-07 | Import a contract naming a convention id that does not exist locally, then run `baseline status` and `check`. (§18a: this orphans baseline rows with **no message**; charter 14 owns the consequence, this probe only establishes the import succeeds.) |
| P-09-08 | `contract waiver add` / `waiver show` / `waivers list` / `waiver remove`. Does a waiver actually suppress enforcement, and does it expire? |
| P-09-09 | An **empty** contract: `drift check` must refuse with `empty_contract`, exit 3 (`repo-paths.ts:327-332`). |
| P-09-10 | The `session_not_trusted` schema mismatch: **the engine emits a literal string into a proof field whose TypeScript schema — in two independently maintained copies — excludes that exact string, enforced by a throwing parse** (§22 obs. 11). Reachable from **any** accepted security convention whose build function is one of the 5 that call the emitting function, not just session-trust. Drive each of those 5 to the throw. Charter 11 owns the mechanism; this probe establishes reachability from the *lifecycle*. |
| P-09-11 | Accept the **same** convention twice; accept two conventions with colliding ids; accept a convention whose globs match nothing. |
| P-09-12 | Rejecting an already-rejected convention; editing a rejected one; adding an exception to a nonexistent one. |

## 4. Benchmarks

| Metric | How |
|---|---|
| Candidates proposed per corpus repo, by kind | 7 repos |
| Proposal → acceptance latency | 10 trials |
| Contract export/import round-trip time | 10 trials |
| Contract size vs. accepted-convention count | 1, 10, 50, 100 |
| `drift check` cost vs. accepted-convention count | 1, 10, 50, 100 — does it scale linearly in conventions? |

## 5. Oracles

- Every kind a user is **offered** can be accepted, or refuses with a stated reason and a
  documented exit code **before** the user invests in it.
- A contract survives export/import byte-identically.
- Every mutating lifecycle step writes an audit event.
- Rejecting an accepted convention withdraws it completely.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-09-1 | Four kinds are declared `proposable: true` with zero proposer code; three of the four are additionally in the 17-entry `CANDIDATE_CONVENTION_KINDS` schema array. | §22 obs. 10, §9a | P-09-03, P-09-04 |
| S-09-2 | The no-evaluator acceptance refusal throws a plain `Error`, not a `DriftError` — its exit code was never traced. | §15, §18a | P-09-02 |
| S-09-3 | The `--experimental-security` gate omitted `api_route_forbids_secret_exposure` at some prior commit and is now unified; the fix's own comment documents the bug. | §9b, `capabilities.ts:190-199` | P-09-01 |
| S-09-4 | A proposal-time allowlist for the data-access convention (excluding `/enums`, `/zod-utils`, `/types`, `/constants`, with a comment citing a real prior false-positive incident) is **not consulted by the separately-implemented enforcement-time matcher for the same convention**. | §22 obs. 9, `data_access.rs:8-16` | Propose against a repo containing those paths, accept, then check: does enforcement flag what proposal excluded? |
| S-09-5 | `review_items` is not an engine-side field; it is a CLI-side concept. | §21, §3.4 | Inspect the candidate JSON from both surfaces. |
| S-09-6 | The 6 `cli`-dispatch kinds (`file_role` … `required_change_checks`) are `proposable: false` — establish whether a user can reach them at all. | §9a | L1–L6 for those six |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). A kind that cannot complete its lifecycle is recorded
with the step it died at and the cause; the charter proceeds to the next kind.

## 8. Deliverables

`results/09-convention-lifecycle.md` with the 23 × 10 lifecycle matrix; contracts and transcripts
under `results/artifacts/09/`.
