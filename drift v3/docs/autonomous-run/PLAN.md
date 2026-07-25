# Drift v3 — Autonomous Execution Plan to Production Soft Beta

**Written:** 2026-07-25
**Base:** branch `fix/phase-a-correctness`, 8 commits past `11b6743`
**Inputs:** original four-subsystem audit + production readiness plan, 6-repo falsification test
(F1–F9), and the implementation session that closed A1–A7, B3, C1-harness, C3.

**Purpose:** a plan that can be executed by an autonomous agent across many sessions without
check-ins. Every task carries a verifiable definition of done and a command that proves it. Where
a judgement call exists, the default is pre-registered here so no task blocks on a decision.

---

## Phase 0 — Session protocol

**Superseded by PROTOCOL.md in this directory.** That document defines the triage-and-continue
lifecycle for unattended runs: a task that cannot be completed is reverted, logged, and skipped
rather than halting the run. Read it first. The verification tiers and pre-registered decisions
below still apply.

### Original Phase 0 (verification tiers and pre-registered decisions still current)

### 0.1 Verification tiers

The external harness made full verification cheap (~100s, one command). Use these tiers:

| Tier | When | Command | Cost |
|---|---|---|---|
| T0 | after every edit | `pnpm build` + touched package's vitest file | ~40s |
| T1 | before every commit | `pnpm test:engine && pnpm -r --workspace-concurrency=1 test` | ~3min |
| T2 | after every task | `pnpm eval:external` | ~100s |
| T3 | after every phase | `pnpm verify:ci` + `node scripts/validate-product-claims.mjs` | ~6min |

**Never batch T2 for tasks touching:** enforcement mode, exit codes, inference, candidate
promotion, import parsing, glob semantics, or `is_forbidden_import`. Those change behaviour on all
six repos at once.

### 0.2 Commit discipline

- One commit per task, prefixed with the task ID (`fix(T14): ...`).
- Every fix ships with the repro that found it converted to a permanent test. No exceptions.
- If a task's T2 run changes the baseline, the commit body must state which fields moved and why.
- Never `--update` the baseline in the same commit as a behaviour change without explaining the delta.

### 0.3 Stop conditions — halt and report rather than improvise

1. A task's premise turns out to be false (as B2's did). Record the finding, do not "fix" it.
2. T2 shows a regression that is not explained by the current task.
3. A task requires a new runtime dependency not pre-authorised in this document.
4. A task requires publishing, pushing, or any outward-facing action.
5. Disk free space drops below 5 GB (this filled a 228 GB machine mid-session — see T40).
6. Two consecutive tasks fail their DoD for unrelated reasons — the tree may be inconsistent.

### 0.4 Pre-registered decisions (do not stop to ask)

- Coverage-direction threshold stays at **>50% violating → warn** (`CONVENTION_MAJORITY_VIOLATION_THRESHOLD`).
- Candidate noise floor stays at **20% coverage**, coverage-only (no absolute-count clause).
- Exit codes are fixed: **0 pass / 2 blocked / 3 refused / 1 error**.
- FP metric: **type-only imports count as false positives; runtime-non-data imports (e.g. the
  `Prisma` error namespace) do not**, and must be documented as policy. See T30.
- New dependencies authorised: `ignore` (Rust, T22), `picomatch` **not** needed (T-none — we have
  our own glob). Everything else requires a stop.
- `@modelcontextprotocol/sdk` is authorised **only after 2026-07-28** (T52).

### 0.5 Environment invariants

- `DRIFT_ENGINE_BIN` exported; `DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK` never set.
- Every scan/check must report `engine_source: "rust"`, `fallback_used: false`.
- Eval repos live at `$DRIFT_EVAL_REPOS`; the harness hard-resets them. Never commit into them.
- Clean `~/.drift` between long runs; per-repo state reaches ~1 GB (T40).

---

## Phase 1 — Gate integrity (do first; everything downstream trusts this)

The oracle must be able to fail before it is worth trusting. Right now it cannot detect F4.

### T01 — Add a 7th eval repo whose data layer defeats the substring whitelist
**Why:** all six current data layers contain `prisma`/`db`/`database`, so the suite passes whether
or not F4 exists. Recorded as a known gap in `scripts/external-eval-repos.md`.
**Do:** screen candidate OSS Next.js repos for: `app/api` or `pages/api` routes, a real data layer,
and an import specifier containing none of `prisma|database|db|data-access`. Supabase-backed apps
are the likeliest source. Add to `REPOS` in `scripts/external-eval.mjs` with
`whitelistIndependent: true`.
**DoD:** repo onboards; with no `--data-modules` it reports zero inferred data-access candidates
*and* names the module via A6 discovery; with `--data-modules` it materialises a contract and
catches injection. Both states asserted.
**Verify:** `pnpm eval:external --only <name>`
**Risk:** low. **Blocks:** T02, and the credibility of every later T2 run.

### T02 — Assert the F4 path in the harness, not just observe it
**Why:** a repo can be in the suite and still not test what it was added for.
**Do:** extend the harness result shape with `inferred_without_declaration` and
`discovery_named_data_layer`; assert that whitelist-independent repos have
`inferred_without_declaration === false` and `discovery_named_data_layer === true` until T35 lands,
then flip the expectation.
**DoD:** deliberately breaking `discoverDataLayer` makes the suite fail.
**Verify:** temporarily stub discovery to return empty → `pnpm eval:external` exits 1.

### T03 — Add negative controls to the harness
**Why:** the suite proves detection but never proves restraint. A rule that flags everything passes
every current assertion.
**Do:** per repo, inject three additional routes that must **not** be flagged: a type-only import of
the data module (`import type { X } from "<dataModule>"`), an import of a *similarly named* module
(`<dataModule>-legacy`), and a service-layer import. Assert zero findings on all three.
**DoD:** three new `false_positive_*` fields per repo, all false in the baseline.
**Verify:** `pnpm eval:external`
**Note:** this locks in A3 (type-only) and B3 (segment boundaries) against real repos, not fixtures.

### T04 — Assert performance envelopes in the harness
**Why:** scan times are recorded but excluded from comparison, so a 10× regression is invisible.
**Do:** add a per-repo `max_onboard_seconds` (3× the recorded baseline, floor 30s) and fail when
exceeded. Keep counts volatile; make time a soft assertion with a generous ceiling so upstream
growth does not cause flakes.
**DoD:** artificially sleeping in the scan path fails the suite.
**Verify:** `pnpm eval:external`

### T05 — Record the harness's own failure modes as tests
**Why:** the harness produced a false negative once already (staged files leaked between runs,
making a detected injection look undetected).
**Do:** unit-test `resetTree` semantics and the diff-shape assumptions in a `scripts/` test file:
staged-file removal, added-file detection, and that no commit is created in an eval repo.
**DoD:** a test fails if `resetTree` reverts to clean-without-reset.
**Verify:** new vitest file passes; `git -C <eval repo> log` unchanged after a full run.

### T06 — Make the harness runnable against an arbitrary repo path
**Why:** needed for triaging user reports without adding them to the suite.
**Do:** `node scripts/external-eval.mjs --repo-path <path> --data-module <spec> --route-dir <dir>`
for one-off evaluation, printing the same result row.
**DoD:** works on a fresh clone not listed in `REPOS`.
**Verify:** run against the A6 Supabase fixture.

---

## Phase 2 — Premise verification (cheap; prevents wasted weeks)

B2's premise was false. Two other audit-derived items carry 1.5 weeks of scope on the same
unverified basis. Verify before scoping, and treat "premise false" as a successful outcome.

### T07 — Verify B1's security-layer claims individually
**Why:** the claim is ~7k LOC of line-heuristic "proof" modules (guard dominance by line ordering,
`line.contains("if")`). If true, gating is right. If the heuristics are sounder than described,
gating removes working capability.
**Do:** for each of the five specific claims — line-ordering dominance, `line.contains("if")`,
and the magic literals `"computed_handler"`, `parseRequestBody(`, `driftSensitive`,
`tenantId`/`.user.` — write a minimal fixture that would expose the weakness, and record
pass/fail per claim in `docs/architecture/security-heuristic-audit.md`.
**DoD:** a table of claim → verified/refuted → fixture path. No code change in this task.
**Verify:** each fixture runs and its recorded outcome reproduces.
**Then:** scope T08–T11 from the verified subset only.

### T08 — Verify B4's gitignore claims
**Why:** "nested `.gitignore` and `!` negations are dropped, root-only" is testable in ten minutes.
**Do:** fixture with a nested `.gitignore`, a `!` negation, and a root ignore; assert which files
the engine indexes.
**DoD:** recorded actual behaviour; T22 scoped to the real gap or cancelled.
**Verify:** `drift doctor --repo-root <fixture> --json` file counts.

### T09 — Verify B5's typed-error claim
**Why:** `message.startsWith("Scan is stale")` at `run-cli.ts:104` is real, but the question is
how many such string matches exist and whether any are user-facing failure paths.
**Do:** grep and enumerate every error-message string match in the CLI; classify each as
user-facing vs internal.
**DoD:** a list; T23 scoped to user-facing ones only.
**Verify:** the grep is recorded in the task's commit body.

### T10 — Verify the remaining A4 sweep items
**Why:** two of four A4 sub-items are done. The others (`check_command.rs:655-665` silent
`continue`, `:1865` zero security findings when `repo_root` is absent) are unverified.
**Do:** fixtures for each; confirm the fail-open exists before changing it.
**DoD:** verified or refuted, recorded.
**Verify:** fixture output.

### T11 — Audit for other unconditional capability assertions
**Why:** `repo_completeness()` hardcoded `complete: true` (fixed in A4) and `filesForConvention`
silently dropped every file (F3). Both are the same bug class: asserting coverage without
computing it. There are likely more.
**Do:** grep for literal `true` assigned to `complete`, `can_block`, `covered`, `verified`,
`enforced`, `proven` across Rust and TS. Classify each as computed or asserted.
**DoD:** a list with a verdict per site; genuinely-unconditional ones filed as follow-up tasks.
**Verify:** recorded grep + classification table.
**Note:** this is the highest-yield audit in the plan — it is the shape of both worst findings.

---

## Phase 3 — Correctness completion

### T12 — Symbol-level type classification (closes the residual FP class)
**Why:** the remaining 8.5% FP on dub is `import { Domain } from "@prisma/client"` — value syntax,
used only in type positions. A3 fixed syntactic type-only imports; this needs usage analysis.
**Do:** in the engine, when a named import's every binding appears only in type positions
(type annotations, `Pick<>`/generics, `satisfies`, `extends`), emit the fact with
`type_only_usage: true`. Exclude those from data-access findings.
**DoD:** dub's FP count drops from 39 to ≤5; `type_import_fp_check.py` logic becomes a harness
assertion.
**Verify:** `pnpm eval:external` + the FP classifier on dub.
**Risk:** medium — tree-sitter type-position detection. Guard with fixtures for `Pick<>`, generic
constraints, and re-exported types.

### T13 — Reduce whitelist over-matching
**Why:** cal.com's learned contract has 4 of 6 forbidden imports wrong: `@calcom/lib/isPrismaObj`
(a type guard), `@calcom/features/conferencing/lib/videoClient` (video conferencing),
`@calcom/prisma/enums` and `/zod-utils` (type-level). openstatus similarly picked up
`@openstatus/db/src/schema` and `/schema/constants`.
**Do:** exclude from `is_data_access_source`: modules whose imports are exclusively type-only
(after T12), specifiers ending in `/enums`, `/types`, `/schema`, `/constants`, `/zod-utils`, and
`imports_data_access_as_data_client`'s `/client` match when the module does not itself import a
declared data dependency (reuse T35's structural signal).
**DoD:** cal.com forbidden_imports contains `@calcom/prisma` and drops the four wrong entries;
harness asserts exact lists per repo.
**Verify:** `pnpm eval:external` — expect a deliberate baseline change, documented.

### T14 — Make `forbidden_imports` exactness an assertion, not an observation
**Why:** T13 has no regression guard unless the expected list is pinned.
**Do:** add `expectForbiddenExact` per repo in the harness; compare as a set.
**DoD:** adding a spurious specifier fails the suite.
**Verify:** `pnpm eval:external`

### T15 — Incremental-scan correctness after the parser changes
**Why:** A2/A3 changed which facts are emitted. The reuse manifest keys on file hash, so stale
facts could survive for unchanged files whose *interpretation* changed.
**Do:** verify that an engine-version change invalidates reuse. If it does not, add
`engine_version`/`rule_engine_version` to the reuse key.
**DoD:** scanning with a bumped engine version re-parses rather than reusing.
**Verify:** two scans across a version bump; `files_reused` drops to 0.
**Risk:** silent staleness is exactly the class this project exists to prevent.

### T16 — Storage schema migration path for existing users
**Why:** `storage_schema_version` is 27 and 0.9.x is published with real installs. My changes added
no migration, but T12/T13 add fact fields.
**Do:** confirm `migrate()` is forward-only and idempotent from every prior version present in
0.9.x; add a test that opens a v0.9-era DB and migrates.
**DoD:** an old fixture DB migrates without data loss; a downgrade is refused with a clear message.
**Verify:** new storage test.

### T17 — Concurrency: hook + CLI + MCP against one SQLite file
**Why:** E1 adds an edit-time hook running `drift check` while a developer may run the CLI and an
agent may hold the MCP server open. SQLite under three writers needs verification.
**Do:** test concurrent `check` + `scan` + MCP read; confirm WAL mode or appropriate busy-timeout;
assert no `SQLITE_BUSY` surfaces as a user-facing crash.
**DoD:** 20 concurrent operations, zero failures, no corruption.
**Verify:** new test harness; then `drift audit verify`.
**Blocks:** T44 (hooks) should not ship before this.

### T18 — Baseline drift semantics when a baselined file changes
**Why:** baseline shields legacy code. If a baselined file is edited, does the shield persist? A5
made new violations block, so this boundary now has teeth.
**Do:** matrix test: baselined violation untouched / file edited elsewhere / violating line edited /
violation removed then reintroduced.
**DoD:** all four documented and asserted; reintroduction after removal must block.
**Verify:** new e2e matrix.

### T19 — Contract portability across machines
**Why:** `contract export`/`import` exists and D3 pitches `drift.lock` as PR-reviewable. Repo
fingerprint mismatch behaviour is unverified.
**Do:** export on one path, import at a different path/clone, confirm the failure or success mode is
deliberate and legible.
**DoD:** documented; a mismatched fingerprint refuses with a specific code, not a generic error.
**Verify:** e2e test.

### T20 — Deleted-file handling in check
**Why:** `skipped_deleted_files` exists in the summary but is untested against a diff that deletes a
route with a baselined finding.
**Do:** delete a violating route; confirm the finding is retired, not orphaned or re-reported.
**DoD:** asserted; `drift findings list` shows no dangling finding.
**Verify:** e2e test.

### T21 — Renamed/moved route handling
**Why:** a git rename presents as delete+add. With A5's block-new, moving a legacy violating route
could newly block it — punishing a refactor.
**Do:** decide and implement: a pure rename carrying an existing baselined violation stays warn.
Detect via content hash equality.
**DoD:** moving a baselined violating file does not block; adding a new violation in the moved file
does.
**Verify:** e2e test.
**Pre-registered decision:** pure rename preserves baseline.

### T22 — Gitignore correctness (scope from T08)
**Do:** adopt the `ignore` crate for nested `.gitignore` and `!` negations, if T08 confirms the gap.
**DoD:** T08's fixture indexes exactly the expected set.
**Verify:** `drift doctor` file counts + `pnpm eval:external` (file counts are volatile, so assert
the fixture instead).

### T23 — Typed errors for user-facing failures (scope from T09)
**Do:** replace string-matched error handling with typed classes carrying failure codes, for the
user-facing paths T09 identified.
**DoD:** no `message.startsWith(` / `message.includes(` on control-flow paths in the CLI.
**Verify:** grep is empty; `pnpm -r test`.

### T24 — Error-message quality pass
**Why:** I hit a raw `database or disk is full` with no guidance. A local-first tool's errors are its
support channel.
**Do:** audit every error surfaced by `run-cli.ts`; ensure each has a code, a cause, and a next
action. Disk-full, permission-denied, corrupt DB, missing engine binary, and stale scan at minimum.
**DoD:** a table of code → message → recovery command in `docs/reference/errors.md`; each reachable
in a test.
**Verify:** new tests per code.

---

## Phase 4 — Honesty and claims

### T25 — Security layer gating (scope strictly from T07)
**Do:** for claims T07 *confirmed*, gate those conventions behind `--experimental-security`, strip
"proof"/"dominance" vocabulary from user-facing output, and mark experimental in
`beta-claims.json`. Leave refuted claims alone.
**DoD:** security conventions do not appear without the flag; claims validation passes.
**Verify:** `node scripts/validate-product-claims.mjs`; `pnpm eval:external` (expect no change —
security conventions are not in the data-access assertions).

### T26 — Remove test-tailored literals from production paths
**Why:** production behaviour must never key on fixture strings. Named in the audit:
`"computed_handler"`, `parseRequestBody(`, `driftSensitive`, the `tenantId`/`.user.` pattern, and
`"withworkspace"` in `candidate_command.rs`.
**Do:** for each, either derive it from the contract or delete the behaviour. Verify against T07.
**DoD:** grep for each literal returns only test files.
**Verify:** grep + `pnpm -r test` + `pnpm eval:external`.
**Note:** `"withworkspace"` is especially suspect — dub's real auth wrapper is `withWorkspace`,
which means an inference heuristic may be tuned to one repo in the suite.

### T27 — Contract strictness (revised from B2 — premise was false)
**Why:** B2 claimed waivers/exceptions/governance are accepted and ignored. **They are enforced
CLI-side**; the engine binding them to `_` is layering. No fail-closed rejection is warranted.
**Do instead:** add a test asserting each engine-ignored contract field *is* enforced somewhere,
so the layering is pinned rather than assumed. Document the division in
`docs/concepts/enforcement-layers.md`.
**DoD:** a test per field (waivers, exceptions, governance, scope) proving CLI enforcement.
**Verify:** `pnpm -r test`.

### T28 — Reject contract fields that genuinely are unenforced
**Why:** T27 covers the four known-enforced fields. Any *other* schema field with no enforcement
path is a real overclaim.
**Do:** enumerate every field in `RepoContract`/matcher schemas; map each to its enforcement site;
reject-on-import any field with none.
**DoD:** a field→enforcement-site table; unmapped fields rejected with a naming error.
**Verify:** importing a contract with an unenforced field fails with a specific code.

### T29 — Verify secret redaction actually applies
**Why:** F9 fixed the deny list, but the deny list is only half the mechanism. `redaction_state`,
`max_snippet_chars` and `snippets_included` are asserted in payloads — are they applied?
**Do:** put a real secret-shaped file in a fixture, request context that would include it, and
confirm it is denied/redacted in CLI *and* MCP output.
**DoD:** secret content never appears in any payload; test covers both surfaces.
**Verify:** new test greps every payload for the canary string.
**Risk:** this is the highest-severity untested claim in the product.

### T30 — Define the FP metric in the DoD
**Why:** dub is at 8.5% or ~17% depending on whether the 38 `Prisma` error-namespace imports count.
The gate says <10%. This will be litigated under launch pressure.
**Do:** write the definition into the release gate: type-only usage = FP (removed by T12);
runtime-non-data imports = documented policy, not FP, with rationale. Add the classifier to the
harness so the number is computed, not argued.
**DoD:** `pnpm eval:external` prints an FP rate per repo against a pinned definition.
**Verify:** harness output.

### T31 — Claims ↔ behaviour reconciliation sweep
**Why:** A5 changed exit codes and default enforcement; A6 demoted inference; A7 hides candidates.
Every claim, README line, and doc describing old behaviour is now wrong.
**Do:** enumerate claims in `beta-claims.json` and assert each has a test proving it; remove or
demote any without one.
**DoD:** every allowed claim maps to a passing test.
**Verify:** `node scripts/validate-product-claims.mjs` extended to require test coverage per claim.

---

## Phase 5 — Resource and scale behaviour (unplanned; found in session)

### T40 — Investigate and reduce per-repo state size
**Why:** cal.com's state reached **~1.0 GB**; six repos filled a 228 GB machine and produced a raw
`database or disk is full`. For a tool whose pitch is local-first, this is an adoption blocker.
**Do:** profile what dominates (fact rows, snapshots, graph edges, evidence, per-scan retention).
Likely: every scan retained in full. Implement scan retention (keep N most recent), `VACUUM` on
demand, and a `drift state size` command.
**DoD:** cal.com state under 250 MB after onboarding; retention documented and configurable.
**Verify:** `du -sh` after onboarding each eval repo; add size to harness output.

### T41 — Disk-space preflight and graceful degradation
**Why:** the failure mode was a raw SQLite string mid-scan, leaving unclear state.
**Do:** `drift doctor` reports free space vs an estimate from repo size; `drift start` refuses
up front with a specific code rather than failing mid-write.
**DoD:** simulated low-disk produces exit 3 with a clear message and no partial DB.
**Verify:** test with a constrained temp filesystem or an injected estimate.

### T42 — Large-repo scaling probe
**Why:** cal.com at 5,063 files takes ~34s. Issue #99 reports query timeouts. The next order of
magnitude is unmeasured.
**Do:** synthesise or find a ~20k-file repo; measure scan, check, `repo map`, and `ask`. Profile the
slowest query and add indices where warranted.
**DoD:** documented envelope; no operation over 5 min; issue #99 reproduced or refuted.
**Verify:** timing table in `docs/reference/performance.md`.

### T43 — Memory ceiling
**Why:** cal.com's scan JSON alone is 43 MB; the CLI holds facts in memory (110k–172k facts).
**Do:** measure peak RSS during onboarding of the largest eval repo; add a documented ceiling and
stream where a single allocation dominates.
**DoD:** peak RSS recorded per eval repo; no OOM at 20k files (T42).
**Verify:** `/usr/bin/time -l` during onboarding.

---

## Phase 6 — Agent surfaces

### T44 — Hooks pack (E1, the launch headline) — after T17
**Do:** Claude Code `PreToolUse`/`PostToolUse` hook that runs `drift check` scoped to the edited
file and blocks with the finding as feedback. Plus `lefthook`/`husky` pre-commit recipes and
Cursor/Codex equivalents.
**DoD:** editing a route to import the data layer is blocked at edit time in under 1s; a clean edit
is not. Documented install in `docs/agent-integration.md`.
**Verify:** scripted hook invocation against the taxonomy and formbricks fixtures (warn vs block
repos behave differently — assert both).
**Note:** this is the one item that makes Drift agent-native rather than another linter. It is also
where A5's block/warn split becomes visible to users, so the messaging must explain why a given
repo warns.

### T45 — Incremental single-file check performance
**Why:** T44's sub-second budget depends on it. Today's `check` re-collects scan data.
**Do:** measure `check --scope changed-files` on one file in cal.com; if over 1s, add a
single-file fast path reusing stored facts.
**DoD:** under 1s on the largest eval repo.
**Verify:** timing assertion in the harness.

### T46 — `drift prepare` quality eval (the context claim)
**Why:** the differentiated value is querying established patterns instead of auditing for them, and
it ships completely untested. `withWorkspace` at 253/494 was the most useful output in six repos and
never left `candidate`.
**Do:** add a harness stage asserting that `drift prepare "add an endpoint that lists workspace
invites" --repo dub` surfaces `withWorkspace` and the prisma constraint; equivalents for two other
repos.
**DoD:** three assertions on real repos.
**Verify:** `pnpm eval:external`.
**Note:** promote high-coverage non-enforceable observations into `prepare` output even when they
stay candidates — that is where their value is.

### T47 — MCP protocol revision risk assessment (launch-blocking)
**Why:** the hand-rolled server is pinned to **2024-11-05**. The **2026-07-28** revision removes the
`initialize` handshake and `Mcp-Session-Id`, moves version/capabilities into `_meta` per request, and
replaces SSE round-trips with `InputRequiredResult`. Shipping a beta whose agent surface speaks a
retired revision undermines the differentiator.
**Do:** determine empirically which revisions current clients still accept; document the
compatibility window; decide whether beta ships MCP as-is, gated experimental, or held for T52.
**DoD:** a written compatibility finding with evidence, and a go/no-go for the MCP surface at beta.
**Verify:** connect at least two real MCP clients to the current server and record the result.
**Stop condition:** if current clients reject 2024-11-05, escalate — this changes the launch scope.

### T48 — Trim the MCP preflight packet
**Why:** 32 top-level keys; agents parse this and bloat is a real token cost.
**Do:** collapse to one `policy` block plus data, preserving `policy_proof` semantics.
**DoD:** top-level keys ≤ 12; parity tests updated; no field silently dropped (removals listed in
the commit).
**Verify:** `pnpm -r test`; byte-size comparison recorded.

### T49 — `drift.lock` framing (E3)
**Do:** `contract export` writes a canonical, diffable, PR-reviewable lockfile; `check` verifies
against it. Mostly packaging — the fingerprinted contract exists.
**DoD:** round-trip is byte-stable; a hand-edit that changes semantics is detected.
**Verify:** export → modify → check refuses with a specific code.

### T50 — GitHub Action (E4)
**Do:** `drift-action` running `check --diff` on PRs with inline annotations, failing per A5 exit
codes.
**DoD:** exit 2 fails the check; exit 3 fails distinctly; exit 0 passes.
**Verify:** action tested locally via `act` or an equivalent harness.
**Note:** user deprioritised CI, so this is code-complete-but-unshipped until they say otherwise.

### T51 — CLI/MCP payload deduplication (C4)
**Do:** extract shared payload builders into `@drift/query`; delete the parity tests that police the
duplication.
**DoD:** no duplicated assembly; parity tests removed with their rationale in the commit.
**Verify:** `pnpm -r test`; `pnpm check:boundaries`.

### T52 — MCP SDK migration — **not before 2026-07-28**
**Why:** the SDK has **zero runtime dependencies** and `packages/cli` does not depend on
`packages/mcp`, so this does not touch the offline scan path or the `local_first_cli` claim.
But migrating now means migrating twice through a breaking revision.
**Do:** after the 2026-07-28 spec and Tier-1 TS SDK land, migrate straight to stateless.
**DoD:** server speaks the current revision; two real clients connect.
**Verify:** client handshake logs; `pnpm -r test`.

### T53 — Enforce the CLI/MCP dependency boundary
**Why:** the offline claim currently rests on a fact, not an invariant.
**Do:** extend `scripts/check-boundaries.mjs` to fail if `packages/cli` gains any transitive path to
`packages/mcp` or to any non-workspace runtime dependency.
**DoD:** adding a dep to `packages/cli` fails `pnpm check:boundaries`.
**Verify:** `pnpm check:boundaries` after a deliberate violation.
**Do this before T52** so the SDK addition is provably contained.

---

## Phase 7 — Quality infrastructure

### T60 — Convert remaining repros to fixtures (C2)
**Do:** the falsification artifacts not yet permanent: root-layout injection e2e, binary-file scan
(T-A4 fixture exists ad hoc), the naming experiment as a parametrised eval, entrypoint-dup and
type-modifier fixtures promoted into `test/fixtures/`.
**DoD:** every `_experiments/` artifact has a permanent home; the ad-hoc `/tmp` fixtures are gone.
**Verify:** `pnpm -r test` covers each; `pnpm test:e2e`.

### T61 — Split `cli.test.ts` (15.8k lines) as files are touched
**Do:** policy, not big bang: extract the suite for any area a task modifies. Start with check,
conventions, contract, backup.
**DoD:** no single test file over 4k lines by the end of the plan.
**Verify:** `wc -l packages/cli/test/*.ts`.

### T62 — Lint and formatting (C6)
**Do:** ESLint + prettier across packages, matching existing style (note the codebase's
`import {a,b}` no-space convention — configure, do not reformat wholesale).
**DoD:** `pnpm lint` clean; wired into `verify:ci`.
**Verify:** `pnpm lint`.

### T63 — Single-source the version constant
**Do:** one version of record; `DRIFT_CORE_VERSION`, engine version, and package versions derive
from it.
**DoD:** bumping one file changes all reported versions; `scripts/assert-release-versions.mjs` passes.
**Verify:** `node scripts/assert-release-versions.mjs`.

### T64 — Test-isolation hardening
**Why:** T-C3 serialised package test runs to hide contention rather than fixing it. That trades CI
time for determinism and should be revisited once suites are split.
**Do:** identify the actual contention (likely engine-binary invocation and large fixtures); restore
parallelism where safe.
**DoD:** `pnpm -r test` green with default concurrency.
**Verify:** three consecutive green runs at default concurrency.

### T65 — Mutation-style check on the enforcement core
**Why:** the enforcement predicate is small and load-bearing. T03's negative controls prove it does
not over-fire; nothing proves the tests would catch under-firing.
**Do:** deliberately break each of five core behaviours (glob match, role detection, forbidden
match, diff status, enforcement mode) and confirm at least one test fails for each.
**DoD:** a table of mutation → failing test. Any mutation with no failing test gets a new test.
**Verify:** documented in the commit.

---

## Phase 8 — Documentation truth-up

### T70 — Docs audit against this session's behaviour changes
**Why:** A5 changed exit codes and default enforcement; A6 changed the zero-candidate message and
added `--data-modules`; A7 hides candidates. Any doc describing the old behaviour is now wrong.
**Do:** grep docs and README for exit codes, "warn", "candidates", "inference"; correct each.
**DoD:** no doc states exit 1 for a blocked check; `--data-modules` and
`--include-low-confidence` documented.
**Verify:** grep; manual read of the four target docs.

### T71 — Prune docs to four documents (D3)
**Do:** quickstart, concepts (facts → contract → baseline → check), agent integration
(MCP + hooks + CI), reference (CLI/JSON contracts). Sprint archaeology to an archive branch.
**DoD:** `docs/` contains four documents plus `architecture/`.
**Verify:** `ls docs/`.

### T72 — Document the enforcement model honestly
**Why:** the block/warn split by coverage direction is subtle and users will hit it. On dub Drift
warns; on formbricks it blocks. Without explanation that reads as inconsistency.
**Do:** a concepts section explaining that a convention violated by most of the repo is an
aspiration, not a rule, and how to override.
**DoD:** written, with the real numbers from both repos.
**Verify:** doc review.

### T73 — Write the exit-code and JSON contract reference
**Do:** document 0/2/3/1, `status` vs `enforcement_result` vs `blocking_count`, and the diff-status
semantics including added files.
**DoD:** `docs/reference/` covers every field an agent or CI would branch on.
**Verify:** cross-check against `run-check.ts` payload construction.

### T74 — README rewrite (D5)
**Do:** one-sentence pitch, 60-second GIF (start → inject → blocked with evidence), honest scope
banner (TS/JS · Next.js routes · one convention family · beta), link to the claims table.
**DoD:** first screen answers what/for-whom/limits.
**Verify:** human review — flag for the user, do not self-approve.

### T75 — Publish the failure catalog as launch content (F2)
**Do:** the F1–F9 catalog with fixes as a post: "I ran my AI-code guardrail against 6 real repos. It
failed 4. Here's every bug."
**DoD:** drafted in-repo. **Not published** — outward-facing, needs explicit approval.

---

## Phase 9 — Release engineering (build only; no publishing)

### T80 — Engine binary pipeline (D1)
**Do:** build `drift-engine` for the five platform packages; SHA-256 checksums; wire
`validate:release-matrix`.
**DoD:** all five artifacts produced with checksums; matrix validation passes.
**Verify:** `node scripts/validate-engine-release-matrix.mjs`.
**Limit:** only darwin-arm64 can be executed locally. Cross-built artifacts must be marked
unverified until run on their platform — do not claim otherwise.

### T81 — Packed-artifact smoke test (D2)
**Do:** `pnpm pack` → install the tarball in a clean container → `drift doctor && start && check`
on a fixture.
**DoD:** passes from the packed artifact, not the workspace.
**Verify:** the job's own output.

### T82 — Repo surgery (D3)
**Do:** promote `drift v3` to the repo root (note: the space in the directory name has been a
recurring friction); archive v1/v2 to branches.
**DoD:** clean root; history preserved; all scripts and CI paths updated.
**Verify:** `pnpm verify:ci` from the new root.
**Risk:** touches every path in the repo. Do it in one commit, alone, with T2 before and after.

### T83 — Fresh-machine install test
**Do:** clean VM/container per OS: install, `doctor`, `start`, `check`.
**DoD:** passes on macOS and Linux.
**Verify:** container logs.
**Limit:** Windows unverified unless a runner exists — state that plainly.

### T84 — npm publish (D4) — **requires explicit human approval**
Outward-facing. Prepare manifests and dist-tags; do not run `npm publish`.

---

## Phase 10 — Pre-launch validation

### T90 — Full gate run
**DoD:** 7/7 external repos (T01) pass all assertions including negative controls (T03) and FP rate
(T30); `pnpm verify:ci` green; fresh-machine install green.
**Verify:** one command each; results recorded.

### T91 — Triage open issues
**Do:** #97 (built-in evals — largely delivered by the harness; reply with it), #99 (query
timeouts — reproduce via T42), the July 3 PR.
**DoD:** every open item has a substantive reply drafted.
**Note:** replies are outward-facing — draft, do not send.

### T92 — Dogfood on Drift itself
**Why:** Drift produced 0 candidates on its own codebase, which the naming whitelist explains. With
A6 it should now name its own data layer or say why not.
**DoD:** `drift start` on Drift reports something actionable; result recorded.
**Verify:** run it.

### T93 — Adversarial self-review of the enforcement claim
**Do:** attempt to construct a repo where Drift reports `pass` while a real direct-data-access
violation exists in a changed hunk. Every success is a finding.
**DoD:** documented attempts; any success filed as a blocking task.
**Verify:** recorded fixtures.
**Note:** this is the F3 class. It found the worst bug in the report and deserves a standing task.

### T94 — Update the falsification report with post-fix numbers
**Do:** re-run the original protocol; publish before/after per finding.
**DoD:** `REPORT.md` gains a verified "after" column.
**Verify:** `pnpm eval:external` + the FP classifier.

---

## Phase 11 — Launch (human-gated, not autonomous)

T95 GitHub release · T96 pinned status issue · T97 Reddit/HN sequence · T98 registries and
awesome-lists · T99 weekly changelog cadence (8 weeks) · T100 issue templates for false positives
and parser gaps.

All outward-facing. Prepare artifacts; publish nothing without explicit approval.

---

## Execution order

```
Phase 1 (T01–T06)      gate integrity          ~2 days   ← everything trusts this
Phase 2 (T07–T11)      premise verification    ~1 day    ← prevents wasted weeks
Phase 3 (T12–T24)      correctness             ~5 days
Phase 5 (T40–T43)      resource behaviour      ~2 days   ← promoted; blocks adoption
Phase 4 (T25–T31)      honesty and claims      ~3 days
Phase 6 (T44–T53)      agent surfaces          ~4 days   ← T44 is the headline
Phase 7 (T60–T65)      quality infra           ~3 days
Phase 8 (T70–T75)      docs truth-up           ~2 days
Phase 9 (T80–T83)      release engineering     ~2 days
Phase 10 (T90–T94)     pre-launch validation   ~1 day
Phase 11 (T95–T100)    launch                  human-gated
```

Phases 1 and 2 are strictly ordered first. Phase 5 is promoted above Phase 4 because a 1 GB
footprint will lose users faster than an overclaimed capability will. Everything else can reorder as
findings dictate.

## Task-count summary

| Phase | Tasks | Human-gated |
|---|---|---|
| 1 gate integrity | 6 | — |
| 2 premise verification | 5 | — |
| 3 correctness | 13 | — |
| 4 honesty | 7 | — |
| 5 resource | 4 | — |
| 6 agent surfaces | 10 | T52 timing |
| 7 quality infra | 6 | — |
| 8 docs | 6 | T74, T75 |
| 9 release | 5 | T84 |
| 10 validation | 5 | T91 replies |
| 11 launch | 6 | all |
| **total** | **73** | **9** |

64 tasks are autonomously executable. The 9 gated ones are every action that leaves the machine.
