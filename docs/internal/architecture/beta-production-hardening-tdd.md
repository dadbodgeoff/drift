# Beta Production Hardening TDD

Date: 2026-05-25
Status: implementation-driving TDD
Scope: P0.3, P0.4, P1, and P2 production gaps after PR #76 became merge-clean.

## Purpose

This document turns the remaining production gaps into a test-first implementation contract. It is not a marketing plan and not a broad-code-intelligence claim.

The target beta claim remains narrow:

```text
Drift can locally scan a TS/JS repo, build graph-backed evidence for a narrow route-layering contract, brief agents read-only, and block accepted direct-data-access drift with proof.
```

Everything below exists to make that claim harder to misunderstand, harder to overclaim, and easier to prove.

## Audit Baseline

Live repo state checked before writing this TDD:

- Branch: `codex/agent-contract-intelligence-tdd`.
- PR #76: merge state was cleaned in the prior slice and GitHub `Verify` passed.
- Current dirty state: four user-owned untracked audit docs remain outside this TDD.
- Current dogfood doc: `docs/dogfood/drift-on-drift.md` now records a clean detached worktree scan at commit `bffbbd330516ee8ffedcfbbdc68a4d780a3bd8c1`.
- Current dogfood proof: 163 files, 20,449 facts, 46 diagnostics, 45 parser gaps, no accepted Drift contract, and expected `missing_contract` refusal for contract-backed enforcement.
- Current beta proof: `scripts/run-beta-proof.mjs` proves accepted-contract blocking on a generated fixture, not on Drift itself.

Source surfaces audited:

- Domain contracts: `packages/core/src/domain.ts`
- Agent contract selection/preflight: `packages/core/src/agent-contracts.ts`
- Contract schemas/canonicalization: `packages/core/src/schemas.ts`, `packages/core/src/contracts.ts`
- Candidate/election acceptance: `packages/cli/src/domain/convention-candidates.ts`
- Contract materialization/import: `packages/cli/src/domain/contract-materialization.ts`, `packages/cli/src/commands/contract.ts`
- Scan status/parser gaps: `packages/cli/src/domain/scan-status.ts`; parser-gap quality is derived in `packages/query/src/parser-gap-quality.ts`
- Graph readiness/preflight: `packages/cli/src/domain/graph-preflight.ts`
- CLI prepare: `packages/cli/src/commands/prepare.ts`
- CLI check: `packages/cli/src/check/run-check.ts`
- Query read models: `packages/query/src/index.ts`, `packages/query/src/change-impact.ts`
- MCP read-only transport: `packages/mcp/src/index.ts`
- Storage migrations: `packages/storage/src/migrations.ts`
- Rust parser/checker: `crates/drift-engine/src/facts.rs`, `crates/drift-engine/src/check_command.rs`
- Fixture matrix: `test/e2e/fixture-matrix.test.ts`, `test/fixtures/*`
- Claims/release proof: `scripts/validate-product-claims.mjs`, `scripts/run-beta-proof.mjs`, `scripts/generate-release-proof.mjs`, `.github/workflows/*`
- Architecture boundary gate: `packages/cli/scripts/check-boundaries.mjs`

Current truth:

- `RepoContract`, `ConventionCandidate`, `AcceptedConvention`, `AgentContract`, findings, waivers, baselines, check runs, parser gaps, graph diagnostics, graph completeness, and release proof artifacts exist.
- Convention election exists as behavior, not as a first-class contract. Acceptance currently means candidate validation, human confirmation, accepted convention write, repo contract materialization, and audit event `election_accepted`.
- Parser gaps are persisted and surfaced in scan status/preflight, but readiness/confidence is not one shared object across query, CLI, MCP, repo map, allowed context, and check.
- CLI/MCP parity is proven by tests and beta proof, but substantial response construction is duplicated in `packages/mcp/src/index.ts` and CLI command modules.
- Change impact still has placeholder parts: `changed_symbols` is always empty, and affected tests/importers are mostly path/slug based.
- External fixture coverage is useful but still fixture-shaped around generated and small test repos, not durable production repo archetypes.
- Claims validation is real but only scans a small doc set and narrow phrase list.
- Release proof exists and is wired into release workflow, but production release readiness depends on final packaged artifacts and engine checksum outputs.

## Terms

Use these terms exactly during implementation.

- Contract: a versioned machine-readable rule or proof boundary. A contract can be imported, shown, selected, checked, surfaced through CLI/MCP, and audited.
- Convention: a human-accepted repo rule. A convention can be inferred as a candidate, accepted by a human, rejected, edited, excepted, or materialized into a repo contract.
- Election: the governed lifecycle that turns evidence into a convention decision. Election states are candidate, dry-run, accepted, rejected, edited, archived, expired. Election mutations require human confirmation and audit events.
- Readiness: shared machine-readable confidence for a surface. Readiness must say whether graph/parser evidence is complete enough for blocking, advisory, or refusal.
- Proof: generated machine output that demonstrates a claim. Hand-written docs can reference proof but cannot replace it.

## TDD Rules

No production code for these gaps without a failing test first.

Every slice follows this loop:

1. RED: add the smallest failing test that proves the missing contract behavior.
2. Confirm failure for the right reason.
3. GREEN: implement the smallest code change.
4. Run the focused test.
5. Run the package gate.
6. Update docs only after the behavior exists.

Tests must cover:

- Happy path.
- Refusal or advisory path.
- Missing evidence path.
- CLI/MCP parity when the surface is agent-facing.
- Capability/claim gate when the behavior affects public claims.

Do not promote capabilities in `packages/core/src/capabilities.ts` or `docs/architecture/beta-claims.json` until the generated proof and claims validation pass.

## Contract Stack

These contracts are the implementation spine.

### Contract: Convention Election

Current state:

- `ConventionCandidate` and `AcceptedConvention` exist.
- `acceptConventionCandidate` rejects non-deterministic block mode, requires `--confirm` or `--dry-run`, writes accepted conventions, materializes `RepoContract`, and appends `election_accepted`.
- Rejection/edit flows exist in CLI commands, but the election lifecycle is not a named schema/proof artifact.

Target contract:

```ts
type ConventionElectionContract = {
  schema_version: "drift.convention_election.v1";
  election_id: string;
  repo_id: string;
  candidate_id: string;
  candidate_scan_id: string;
  decision: "dry_run" | "accepted" | "rejected" | "edited" | "archived" | "expired";
  human_actor: string;
  decided_at: string;
  accepted_convention_id?: string;
  repo_contract_id?: string;
  contract_fingerprint_before?: string;
  contract_fingerprint_after?: string;
  evidence_refs: string[];
  audit_event_id: string;
  can_block: boolean;
  blocked_reason?: string;
};
```

Implementation rule:

- Election proof is written for every mutating convention decision.
- Candidate inference alone must never create enforcement.
- `can_block` can only be true when the accepted convention is deterministic and mode is `block`.

### Contract: Readiness

Current state:

- Graph completeness exists in storage and query.
- Parser gaps exist in storage and scan status.
- Prepare computes `graph_confidence` locally.
- Check has capability completeness from check-time scan data.
- MCP duplicates similar logic.

Target contract:

```ts
type DriftReadiness = {
  schema_version: "drift.readiness.v1";
  repo_id: string;
  scan_id: string | null;
  surface:
    | "scan_status"
    | "repo_map"
    | "prepare"
    | "allowed_context"
    | "check"
    | "mcp";
  graph_available: boolean;
  graph_complete: boolean;
  parser_gap_count: number;
  parser_gaps_by_kind: Record<string, number>;
  confidence: number;
  decision: "blocking_allowed" | "advisory_only" | "refuse";
  reasons: string[];
  required_capabilities: string[];
  missing_capabilities: string[];
};
```

Implementation rule:

- The builder lives in `@drift/query`.
- CLI and MCP only call the shared builder.
- Blocking findings require `decision === "blocking_allowed"` for the relevant scope.
- Missing parser evidence must become advisory/refusal, not a false block.

### Contract: Shared Response Builders

Current state:

- `@drift/query` has graph/read-model helpers.
- CLI and MCP still assemble several full payloads separately.
- Beta proof catches parity drift after the fact.

Target contract:

```ts
type DriftReadModelBuilder<T> = {
  response_schema: string;
  build(input: {
    storage: SqliteDriftStorage;
    repo_id: string;
    surface: "cli" | "mcp";
    now?: string;
    filters?: Record<string, unknown>;
  }): T;
};
```

Implementation rule:

- Shared builders cover scan status, repo map, preflight, findings, contract, audit, and allowed context.
- CLI parses flags and formats text.
- MCP validates JSON-RPC args and returns the shared object.
- Boundary rule remains: MCP must not import CLI.

### Contract: Drift-On-Drift Enforcement Proof

Current state:

- Dogfood proves scan/preflight/refusal.
- Beta proof proves enforcement on generated fixture.

Target contract:

- Add a deterministic Drift-style accepted contract proof against a real Drift package boundary or durable Drift-shaped fixture.
- Keep no-contract dogfood as a separate honesty proof.
- Do not import a broad architecture contract for Drift itself until it has narrow, deterministic evidence.

Minimum acceptable proof:

- Scan a Drift-shaped package boundary.
- Import or accept one deterministic contract.
- Run a good change and a bad change.
- Bad change produces a blocking finding tied to repo contract id, convention id, check id, evidence, graph path, and suggested fix.
- CLI/MCP read-only surfaces agree.

## Implementation Slices

### P0.3 Drift-On-Drift Accepted-Contract Proof

Goal:

Prove contract-backed enforcement on Drift-shaped code without pretending Drift has a broad accepted repo contract.

RED tests:

- Add `test/e2e/dogfood-enforcement-proof.test.ts`.
- It should create a temp fixture from a small Drift package shape, for example:
  - `packages/mcp/src/index.ts`
  - `packages/query/src/index.ts`
  - `packages/storage/src/sqlite-storage.ts`
  - one forbidden direct package edge such as MCP importing `@drift/cli`
- It should import or materialize a deterministic `import_boundary` or accepted convention.
- It should assert:
  - no-contract `check` refuses with `missing_contract`;
  - accepted contract good diff passes;
  - accepted contract bad diff blocks;
  - finding includes `repo_contract_id`, `convention_id`, `check_id`, evidence range, and suggested fix.

Expected initial failure:

- No durable Drift-shaped dogfood enforcement proof exists.
- Depending on chosen contract kind, `check` may not enforce that boundary yet or proof script does not emit the artifact.

GREEN implementation:

- Prefer a durable fixture under `test/fixtures/drift-package-boundary`.
- If the existing `import_boundary` agent contract enforcement already covers the case, use it; otherwise add the smallest enforcement path in `packages/cli/src/check/run-check.ts`.
- Add a generated proof section to `scripts/run-beta-proof.mjs` only if this becomes beta proof, not if it remains dogfood-only.
- Update `docs/dogfood/drift-on-drift.md` with a separate "Accepted-contract dogfood fixture" section.

Focused commands:

```bash
pnpm test:e2e -- dogfood-enforcement-proof
pnpm beta:proof
pnpm verify:ci
```

Done:

- Dogfood has two honest lanes: no-contract Drift repo refusal and accepted-contract Drift-shaped enforcement proof.

### P0.4 Shared Readiness Gate

Goal:

Make parser confidence/readiness one shared object across query, CLI, MCP, prepare, repo map, allowed context, and check.

RED tests:

- `packages/query/test/query.test.ts`
  - `buildReadiness` returns `advisory_only` when parser gaps lower flow confidence.
  - `buildReadiness` returns `blocking_allowed` when graph completeness and relevant parser evidence are complete.
  - `buildReadiness` returns `refuse` when graph is missing for a blocking-required surface.
- `packages/cli/test/cli.test.ts`
  - `scan status --json`, `repo map --json`, `prepare --json`, and `check --json` all include `readiness`.
  - blocking check downgrades or refuses when relevant parser gaps exist.
- `packages/mcp/test/mcp.test.ts`
  - MCP scan status, repo map, preflight, and allowed context include the same readiness object as CLI.

Expected initial failure:

- No `drift.readiness.v1` shared object exists.
- Prepare/MCP compute confidence locally.
- Check completeness is not the same shape as scan/repo-map/preflight.

GREEN implementation:

- Add `packages/query/src/readiness.ts`.
- Export `buildReadiness`.
- Feed it from graph completeness, graph diagnostics, parser gaps, fallback status, and surface.
- Replace local `graphConfidence` helpers in CLI/MCP.
- Add `readiness` to beta-used JSON response schemas without removing current fields in the first slice.

Focused commands:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/cli test -- --runInBand
pnpm --filter @drift/mcp test
pnpm verify:ci
```

Done:

- Agents can see whether a payload is complete enough for blocking, advisory only, or refusal.

### P1.1 Shared CLI/MCP Builders

Goal:

Move parity from "tested after duplication" to "shared by construction."

RED tests:

- Add or extend parity tests so each shared builder is called directly and through CLI/MCP.
- Add a boundary test that fails if MCP recreates scan status/preflight/repo map fields that should come from `@drift/query`.

Expected initial failure:

- MCP currently builds scan/preflight/allowed-context payloads in `packages/mcp/src/index.ts`.
- CLI builds parallel payloads in command modules.

GREEN implementation:

- Add shared builders under `packages/query/src/read-models/*` or focused exports from `packages/query/src/index.ts`.
- Move one surface at a time:
  1. scan status
  2. repo map
  3. preflight
  4. allowed context
  5. findings
  6. contract
  7. audit
- Keep text formatting in CLI only.
- Keep JSON-RPC validation in MCP only.

Focused commands:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
pnpm check:boundaries
pnpm beta:proof
```

Done:

- Beta proof parity hash becomes a regression check, not the only thing preventing drift.

### P1.2 Parser Semantic Coverage

Goal:

Improve TS/JS parser coverage without claiming full semantic TypeScript.

RED tests:

- `crates/drift-engine/tests/typescript_facts.rs`
  - dynamic import support or explicit unsupported diagnostic;
  - CommonJS `require` support or explicit unsupported diagnostic;
  - namespace member calls with conservative diagnostics;
  - re-export chain resolution;
  - computed route/static endpoint diagnostics;
  - server action unsupported diagnostic if not supported.
- `crates/drift-engine/tests/stream_graph.rs`
  - import graph edges for supported constructs;
  - parser gaps for unsupported constructs.

Expected initial failure:

- Current extractor handles a narrow AST set and emits parser gaps for unresolved/unsupported symbols.

GREEN implementation:

- Add one construct at a time.
- If support is not implemented, emit a stable parser gap instead of silent confidence.
- Update capabilities only after fixtures pass.

Focused commands:

```bash
cargo test -p drift-engine --test typescript_facts -- --nocapture
cargo test -p drift-engine --test stream_graph -- --nocapture
pnpm test:e2e
```

Done:

- Parser gap count drops only where support is real; unsupported cases stay visible.

### P1.3 Real Change Impact

Goal:

Make change impact useful enough for production decisions.

RED tests:

- `packages/query/test/query.test.ts`
  - changed exported helper populates `changed_symbols`;
  - importing route/service/test appears in affected importers/callers;
  - unresolved dependency lowers readiness on affected items;
  - changed test is recognized separately from production change.
- `packages/cli/test/cli.test.ts`
  - `prepare --json` includes symbol-backed change impact for a targeted file.

Expected initial failure:

- `changed_symbols` is always `[]`.
- affected tests/importers are mostly slug/path based.

GREEN implementation:

- Use `symbol_occurrences`, `resolver_dependencies`, and `module_dependents`.
- Attach readiness/confidence to affected items.
- Keep path fallback explicit as `confidence_label: "low"` or diagnostics.

Focused commands:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/cli test -- --runInBand
```

Done:

- Change impact names real symbols and dependency-backed affected files.

### P1.4 External Fixture Matrix

Goal:

Cover real repo shapes before expanding claims.

RED tests:

- Extend `test/e2e/fixture-matrix.test.ts` with durable fixture dirs:
  - Next app router
  - Next pages router
  - package workspace
  - pure library
  - mixed JS/TS
  - no API route
  - non-standard aliases
  - unsupported framework pattern
- Each fixture asserts expected facts, graph edge minimums, parser gaps, and check behavior.

Expected initial failure:

- Some shapes are missing or only covered by generated beta fixture.

GREEN implementation:

- Add fixture directories under `test/fixtures/*`.
- Keep counts stable but avoid brittle full snapshots unless the fixture is tiny.
- Any unsupported construct must assert a parser gap.

Focused commands:

```bash
pnpm test:e2e -- fixture-matrix
pnpm beta:proof
```

Done:

- Claims can point to durable fixture coverage, not only generated proof.

### P1.5 Claims Validation Across Docs

Goal:

Make docs-gated claims hard to drift.

RED tests:

- `test/e2e/release-hygiene.test.ts`
  - `validate:claims` scans README, architecture docs, dogfood docs, release docs, and specs.
  - stale dogfood branch/commit metadata fails unless marked historical.
  - blocked phrases fail when present in any public doc.

Expected initial failure:

- `scripts/validate-product-claims.mjs` currently scans only README and canonical contracts plus a narrow phrase list.

GREEN implementation:

- Expand doc discovery.
- Add allowed historical markers.
- Add blocked phrase fixtures.
- Keep false positives explicit and reviewed.

Focused commands:

```bash
pnpm validate:claims
pnpm test:e2e -- release-hygiene
pnpm verify:ci
```

Done:

- Public docs stay inside runtime capabilities.

### P1.6 Release Proof On Packaged Artifacts

Goal:

Prove release readiness from actual tarballs and platform engine artifacts.

RED tests:

- `test/e2e/release-hygiene.test.ts`
  - final release proof fails without tarballs;
  - final release proof fails without all engine checksums;
  - final release proof consumes generated beta proof artifact;
  - proof names package versions, engine targets, checksums, and smoke results.

Expected initial failure:

- Local release proof can run without final release artifacts unless strict flags are used.

GREEN implementation:

- Keep strict proof in final release workflow.
- Add a local fixture path for proof validation without publishing.
- Do not weaken `--require-complete`.

Focused commands:

```bash
pnpm validate:release-matrix
pnpm release:proof -- --beta-proof-file /tmp/drift-beta-proof.json --require-beta-proof
pnpm test:e2e -- release-hygiene
```

Done:

- Release proof cannot be hand-authored or artifact-light.

### P2.1 Configurable Role Ontology

Goal:

Let repo contracts define roles without changing Rust path rules.

RED tests:

- Core schema accepts role rules with source metadata.
- Contract import validates role rule shape.
- Repo map shows `role_source`.
- Custom role paths override or extend defaults.

Expected initial failure:

- Role detection is mostly hard-coded/default-derived.

GREEN implementation:

- Add role rules to `RepoContract` or `FileRoleAgentContract`.
- Keep built-in defaults.
- Derive role source in query/repo-map.

Focused commands:

```bash
pnpm --filter @drift/core test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
```

Done:

- Production users can encode repo-specific layers as contracts.

### P2.2 Incremental Scan Reuse

Goal:

Reuse unchanged file facts safely, with full-scan fallback.

RED tests:

- Two-scan fixture reuses unchanged files.
- Resolver input change invalidates reuse.
- Deleted/renamed files remove stale facts/graph projections.
- Reuse status appears in scan status and proof.

Expected initial failure:

- `reuse_applied: false` and `engine_reuse_not_enabled` are hard-coded behavior.

GREEN implementation:

- Add an engine reuse manifest keyed by content hash and previous scan facts.
- Reuse unchanged file facts only when resolver/package inputs match.
- Rebuild graph projections for the current scan from the combined reused and freshly parsed facts.
- Fall back to full scan when there is no previous scan, no reusable files, or resolver/scanner inputs changed.

Focused commands:

```bash
pnpm --filter @drift/storage test
pnpm --filter @drift/cli test
pnpm test:e2e
```

Done:

- Incremental reuse can move from blocked claim to supported only after proof and docs gate update.

### P2.3 Broader Framework Adapters

Goal:

Add frameworks one at a time with capability flags.

RED tests:

- Adapter contract requires explicit framework id, entrypoint extraction, route method/path extraction, and unsupported diagnostics.
- One fixture per framework.
- Capabilities only list proven adapters.

Expected initial failure:

- Supported wedge is mostly Next-style TS/JS route layering.

GREEN implementation:

- Add adapter registry surface.
- Implement one framework at a time.
- Do not claim "broad framework support."

Focused commands:

```bash
cargo test -p drift-engine
pnpm test:e2e
pnpm validate:claims
```

Done:

- Framework support expands by proof, not by wording.

### P2.4 Production Support Surfaces

Goal:

Make local SQLite, backups, restore, audit, and support behavior operationally clear and testable.

RED tests:

- Broken DB fixture yields stable doctor code and recovery command.
- Broken audit chain yields stable doctor code.
- Unsupported schema yields stable doctor code.
- Support bundle redacts sensitive facts/graph/audit metadata.
- Restore failure runbook is linked from command output.

Expected initial failure:

- Support/doctor/backup are real but not yet a production-grade failure matrix.

GREEN implementation:

- Add stable failure codes and recovery commands.
- Add support-bundle redaction snapshots.
- Add docs under `docs/architecture`.

Focused commands:

```bash
pnpm --filter @drift/cli test
pnpm verify:ci
```

Done:

- Users can recover or escalate local-state failures without source leakage or vague errors.

## Execution Order

Implement in this order:

1. P0.4 shared readiness gate.
2. P0.3 Drift-shaped accepted-contract enforcement proof.
3. P1.1 shared CLI/MCP builders.
4. P1.3 real change impact.
5. P1.4 external fixture matrix.
6. P1.5 docs claims validation.
7. P1.2 parser semantic coverage.
8. P1.6 release artifact proof hardening.
9. P2.1 configurable role ontology.
10. P2.4 support surfaces.
11. P2.2 incremental reuse.
12. P2.3 broader framework adapters.

Reasoning:

- Readiness must land before more outputs use incomplete graph/parser evidence.
- Enforcement proof should land before beta wording expands.
- Shared builders reduce duplication before larger surface additions.
- Incremental reuse and broader frameworks are last because they change product claims and have larger blast radius.

## Non-Goals Until Proven

Keep these blocked in capabilities and docs:

- Cloud sync.
- Desktop UI.
- Python adapter.
- Broad language support.
- Mutation-capable MCP.
- General AI code review.
- Broad fuzzy duplicate-helper detection.
- Full semantic TypeScript type analysis.
- Remote audit notarization.
- Org-level policy management.

## Completion Gate

A slice is not done until:

```bash
pnpm verify:ci
gh -R dadbodgeoff/drift pr view <pr> --json mergeStateStatus,statusCheckRollup
```

For release-affecting slices, also run:

```bash
pnpm beta:proof
pnpm validate:claims
pnpm validate:release-matrix
```

For any capability promotion:

- Update `packages/core/src/capabilities.ts`.
- Update `docs/architecture/beta-claims.json`.
- Add or update generated proof.
- Run `pnpm validate:claims`.
- Keep docs wording narrower than runtime proof.
