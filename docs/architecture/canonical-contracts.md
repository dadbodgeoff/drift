# Drift V3 Canonical Contracts

Date: 2026-05-22

This document defines the canonical Drift contract surfaces against the current repo state. It is not a product manifesto. A contract here means a versioned or otherwise testable boundary with fields, invariants, failure behavior, and proof obligations.

The short version:

- The product direction is coherent: local-first repo facts become human-accepted conventions, then `check` blocks drift with evidence.
- The type/schema/storage spine is real.
- The beta proof loop is now executable through `pnpm beta:proof` and is part of `pnpm verify:ci`.
- Several GPT Pro-suggested fields are good requirements but are not implemented today. They are marked as gaps, not described as current behavior.

## Verification Boundary

Commands run or used as current evidence:

```bash
git -C "drift v3" status --short --branch
node packages/cli/dist/main.js capabilities --json
pnpm beta:proof
DRIFT_VERIFY_CI_STATUS=passed node scripts/run-beta-proof.mjs --output /tmp/drift-beta-proof.json
DRIFT_VERIFY_CI_STATUS=passed node scripts/generate-release-proof.mjs --beta-proof-file /tmp/drift-beta-proof.json --require-beta-proof
```

Known gate result from the current assessment packet:

- `pnpm verify:ci` exists in `package.json` and includes `pnpm beta:proof`.
- `pnpm beta:proof` generates `drift.beta.proof.v1`.
- `scripts/generate-release-proof.mjs --beta-proof-file` generates `drift.release.proof.v1` and enforces `--require-beta-proof` only from a `drift.beta.proof.v1` artifact, not hand-authored env fields.
- The release workflow has a final release-proof job after engine checksums and npm tarballs exist; that job uses `--require-complete`.
- Full `pnpm verify:ci` must still be rerun after every doc/code change before claiming branch completion.

Current beta proof state:

- Beta proof uses a generated fixture derived from `test/fixtures/next-api-direct-db`, then adds one service-delegated good route and one direct-data-access bad route.
- Proof fields include repo id, scan id, repo contract id, check id, Rust/fresh scan proof, graph counts, good-route pass, bad-route block, finding evidence completeness, full schema-stable MCP/CLI parity hash, audit head hash, and audit verification.
- Source defines 11 migrations in `packages/storage/src/migrations.ts:6`, with `011_check_runs_and_finding_context` adding persisted check runs and finding evidence context.

## Status Labels

- `canonical-beta`: must be true for a credible beta proof.
- `canonical-defined`: implemented or defined enough to keep as a durable contract, but not the narrow beta blocker.
- `partial`: real code exists, but the contract is missing important fields, enforcement, parity, or release proof.
- `experimental`: useful work in progress, allowed to change.
- `deferred`: explicitly outside beta scope.
- `speculative`: proposed field or behavior not supported by current repo evidence.

## Cross-Cutting Rules

1. Do not claim a contract exists unless it has source evidence: type/schema, storage, command, test, or generated output.
2. Only accepted deterministic conventions may block.
3. Candidate inference may propose governance; it must not create governance by itself.
4. No blocking finding should ship without contract id, file/range, evidence, and an understandable fix direction.
5. Fallback scanner output cannot be production-equivalent.
6. Incremental reuse is limited to unchanged file facts when resolver inputs match; graph projections are rebuilt for the new scan.
7. MCP is a read-only transport. Product logic should live in shared query/domain code.
8. A beta demo from dirty state is not beta-grade.
9. Scanner skip rules, context egress denied globs, and support/export redaction are separate controls. Rust skip behavior is the production scanner guarantee; policy denied globs are output controls; TypeScript fallback is degraded and cannot be claimed equivalent for secret-like handling.
10. The SQLite DB, backups, audit output, repo map metadata, and support/debug artifacts are sensitive local repo metadata even when they do not contain source text.
11. CLI `--json` and MCP results expose top-level versioned `response_schema` names on beta-used surfaces; `start` and `doctor` now have typed beta response schemas, while the remaining production boundary is typed schemas for every public CLI/MCP result.
12. Every production refusal or failure needs a stable code, surface, severity, retry guidance, user action, and recovery command.
13. Public beta/release claims require a generated proof artifact, not a hand-written checklist.

## Canonical Flow

```mermaid
flowchart LR
  Repo["Repo state"] --> Scan["Rust scan"]
  Scan --> Facts["Facts"]
  Scan --> Graph["Fact graph"]
  Facts --> Candidates["Convention candidates"]
  Graph --> Candidates
  Candidates --> Approval["Human accept/import"]
  Approval --> Contract["Repo contract"]
  Contract --> Check["Check"]
  Graph --> Check
  Facts --> Check
  Check --> Findings["Findings"]
  Findings --> Preflight["CLI/MCP preflight"]
  Contract --> Preflight
  Graph --> RepoMap["Repo map"]
  Findings --> Audit["Audit hash chain"]
  Approval --> Audit
```

Current mismatch:

- The source now has an executable beta proof loop in `scripts/run-beta-proof.mjs`.
- The beta proof uses a generated fixture state, not dogfood DB state.
- `pnpm verify:ci` includes `pnpm beta:proof`.
- Release proof can consume the generated beta proof through `scripts/generate-release-proof.mjs --beta-proof-file`.

## Contract Index

| Contract | Status | Current evidence | Main gap |
| --- | --- | --- | --- |
| Product/Capability | canonical-beta | `packages/core/src/capabilities.ts`, `packages/cli/src/domain/versions.ts`, CLI `capabilities --json` | Needs release gate that prevents broad claims beyond the narrow wedge. |
| Repo Identity | canonical-beta | `RepoRecord`, `ScanManifest`, `repoIdForRoot`, `repoRecordForRoot`, migration `012_repo_identity` | Clean-commit enforcement remains a release/beta proof gate rather than a mutable repo row. |
| Scan/Freshness | canonical-beta | `ScanManifest`, `ScanFileChange`, `scanStatusPayload`, resolver-input fingerprint, beta proof fresh scan check | Incremental reuse is not implemented; `check` uses check-time collection and reports that status explicitly. |
| Parser Gap Quality | canonical-beta | `drift.parser_gap_quality.v1`, `packages/query/src/parser-gap-quality.ts`, CLI/MCP scan status, preflight, repo map, beta proof `parser_gap_quality_verified` | Derived read model only; not persisted and not a claim that all TypeScript semantics are production-complete. |
| Engine Boundary | canonical-beta | `@drift/engine-contract` schemas, Rust bridge, stream parsing tests, fallback-used check blocking | TypeScript fallback remains dev-only and must stay visibly degraded. |
| Fact | canonical-defined | `FactRecord`, `FactKind`, `facts` table | Facts lack confidence, extractor id, resolved target, and provenance beyond file/range/fact ids. |
| Graph | canonical-beta | `@drift/factgraph`, graph migrations/projections, query package | Graph coverage must stay capability-gated; not every check output persists graph path. |
| Candidate Convention | canonical-beta | `ConventionCandidate`, inference, accept flow, beta fixture candidate acceptance | Candidate inference alone is not enough for beta; enforcement still requires acceptance. |
| Accepted Convention | canonical-beta | `AcceptedConvention`, `accepted_conventions`, `--confirm` accept/import | No explicit `source` field and no proposed/disabled status vocabulary. |
| Repo Contract | canonical-beta | `RepoContract`, `repo_contracts`, canonical contract JSON/fingerprint | No separate `policy_mode`; fingerprint is computed, not stored as a first-class column. |
| Finding | canonical-beta | `Finding`, `findings`, engine finding schema, persisted check/contract/layer/graph/fix context, beta proof evidence completeness | Typed public response schemas are not first-class yet. |
| Check | canonical-beta | `runCheck`, engine check request/result schemas, `CheckRun`, `check_runs`, beta proof good-pass/bad-block loop | `check` uses check-time collection instead of requiring the stored scan to be fresh. |
| Agent Envelope | canonical-defined | `AgentEnvelopeV2`, CLI/MCP envelope helpers | Envelope is intentionally minimal; it is not the full repo/context packet. |
| MCP | canonical-beta | 11 read-only MCP tools, argument validation, tests, beta proof full CLI/MCP schema-stable parity hash | Transport boundary still has duplicated read-model assembly outside `@drift/query`. |
| Storage/Migrations | canonical-beta | migrations 001-013 in source, SQLite storage tests, `check_runs`, required-check execution proof, repo identity columns | Backup/restore is release-supported but not part of the narrow beta proof loop. |
| Governance/Audit | canonical-beta | mutation governance, `--confirm`, audit hash chain | Audit events do not carry explicit before/after object hashes. |
| Backup/Restore | canonical-defined | backup manifests, create/verify/restore commands/tests | Beta only needs this if included in the demo/release claim. |
| Release/Beta | canonical-beta | `verify:ci`, `beta:proof`, generated beta fixture proof, strict release proof beta input | Final release readiness is proven after packaged npm tarballs and engine checksums exist. |
| Agent-Facing Response Schema | canonical-beta | Beta-used CLI/MCP outputs expose `response_schema`; `start`/`doctor` use typed beta schemas; beta proof verifies full schema-stable parity | CLI payloads and MCP tool returns are still typed loosely as `unknown` outside locked beta surfaces. |
| Transport Boundary | canonical-defined | CLI router, MCP JSON-RPC handlers, shared `@drift/query` graph read models, full beta CLI/MCP parity hash | MCP still has refactor debt, but beta-used transport outputs are schema-tagged and parity-gated. |
| Release Proof Artifact | canonical-beta | `scripts/generate-release-proof.mjs`, `scripts/run-beta-proof.mjs`, strict beta proof file ingestion, final workflow `--require-complete` proof | Full release readiness is proven in the release workflow after tarballs and engine checksum artifacts exist. |
| CI/Gate | canonical-beta | `pnpm verify:ci`, `pnpm beta:proof`, CI workflow, engine release workflow | Release artifact completeness is proven in release workflow, not normal PR CI. |
| Packaged Engine/Installer | canonical-defined | engine resolver, optional packages, checksum validation, `doctor --json`/`version --json` engine object | More production polish can still improve provenance wording and support bundles. |
| Update/Compatibility | canonical-defined | release compatibility policy, schema versions, migration checks | Compatibility policy is split across docs and not summarized in canonical contracts. |
| Operational Failure Modes | canonical-defined | CLI refusal envelope, canonical recovery fields, beta refusal list | MCP JSON-RPC still returns protocol errors, but CLI beta refusals now use stable operational codes. |
| Local State Sensitivity | canonical-defined | SQLite paths/facts/graph/audit/backup schema, security docs | Sensitivity rules are not first-class in storage/backup/audit contracts. |
| Support/Debuggability | canonical-defined | `doctor --json`, backup verify, audit verify, `support bundle --dry-run` | Support bundle is manifest-only in V1; export/send flows remain out of scope. |
| Production Scope/Claims | canonical-beta | capabilities output, doctor V1 scope, `beta-claims.json`, `validate:claims` | Claims gate is intentionally narrow and blocks only explicit overclaims. |

## Contract Definitions

### 1. Product/Capability Contract

Purpose: define what Drift is allowed to claim.

Current implementation:

- `DriftCapabilities` defines CLI, MCP, supported wedge, and deferred surfaces in `packages/core/src/capabilities.ts:1`.
- Default MCP read-only tools are listed in `packages/core/src/capabilities.ts:17`.
- Supported wedge is TypeScript/JavaScript, deterministic `api_route_no_direct_data_access`, heuristic `api_route_requires_service_delegation`, SQLite storage, and no source mutation in `packages/core/src/capabilities.ts:84`.
- CLI version/capability payload is built in `packages/cli/src/domain/versions.ts:41`.
- `doctorV1Scope` reports `local_first_cli`, `typescript_api_route_layering`, human-confirmed governance, no source mutation, and deferred desktop/cloud/Python/duplicate-helper work in `packages/cli/src/domain/versions.ts:70`.
- Live `capabilities --json` matched that scope.

Required invariants:

- Beta claim is local-first TypeScript API route layering, not general repo governance.
- Only deterministic `api_route_no_direct_data_access` can block in beta.
- Service delegation remains heuristic until capability-gated as deterministic.
- Deferred capabilities must not show up as beta promises.

Implemented production boundary:

- `docs/architecture/beta-claims.json` is the machine-readable claims manifest.
- `scripts/validate-product-claims.mjs` validates allowed and blocked claims and is part of `pnpm verify:ci`.

Beta status: `canonical-beta`.

### 2. Repo Identity Contract

Purpose: bind scans, contracts, and findings to a repo and state.

Current implementation:

- `RepoRecord` has `id`, `root_path`, `fingerprint`, `vcs_provider`, `remote_url_hash`, `package_manager`, `lockfile_hashes`, `resolver_input_hash`, `created_at`, and `updated_at` in `packages/core/src/domain.ts:92`.
- `ScanManifest` carries `repo_id`, `branch`, `commit`, and `dirty` in `packages/core/src/domain.ts:100`.
- `repoIdForRoot` hashes the resolved repo root in `packages/cli/src/domain/identifiers.ts:5`.
- `repoRecordForRoot` uses root path as repo fingerprint and computes repo identity metadata in `packages/cli/src/domain/repo-paths.ts:118`.
- Scan captures branch, commit, dirty state, scanner versions, resolver version, and resolver input fingerprint in `packages/cli/src/domain/scan-status.ts:96`.

Required invariants:

- No beta demo from dirty/uncommitted state.
- Scan output must expose branch, commit, and dirty state.
- Contract import must reject repo id or fingerprint mismatch.

Implemented identity fields:

- `vcs_provider`, `remote_url_hash`, `package_manager`, `lockfile_hashes`, and `resolver_input_hash` are persisted on `repos` by migration `012_repo_identity`.
- Resolver input fingerprint covers `package.json`, `jsconfig.json`, and `tsconfig*.json`; lockfile hashes are stored separately on repo identity.
- Clean-worktree gating is a beta/release requirement, not a persisted contract invariant today.

Beta status: `canonical-beta`.

### 3. Scan And Freshness Contract

Purpose: define how Drift turns repo state into stored scan output and stale/fresh status.

Current implementation:

- `ScanManifest`, `FileSnapshot`, `ScanFileChange`, and `ResolverDependency` are typed in `packages/core/src/domain.ts:100`, `packages/core/src/domain.ts:119`, `packages/core/src/domain.ts:130`, and `packages/core/src/domain.ts:140`.
- `scan_manifests`, `file_snapshots`, `scan_file_changes`, and resolver/module projection tables are created in `packages/storage/src/migrations.ts:23`, `packages/storage/src/migrations.ts:46`, `packages/storage/src/migrations.ts:369`, and `packages/storage/src/migrations.ts:411`.
- `runScanRepo` stores manifest, snapshots, file changes, facts, graph artifact, candidates, and scan audit events in `packages/cli/src/domain/scan-status.ts:40`.
- `incrementalScanPlan` is explicit: it reports `execution_mode: "incremental_reuse"` only when the Rust engine reused unchanged file facts, and falls back to `full_scan` when there is no previous scan, no reusable files, or resolver/scanner inputs changed.
- `scanStatusPayload` detects source changes, branch drift, version drift, resolver input drift, and audit validity in `packages/cli/src/domain/scan-status.ts:372`.
- Resolver input drift is tested in `packages/cli/test/cli.test.ts:1435`.

Required invariants:

- Full scan must say full scan.
- Reuse must not be claimed unless the engine reports reused files for the current scan.
- Resolver/package input changes must block fact reuse and force fresh extraction.
- Stale scan status must be visible to CLI/MCP/preflight.
- A beta release script should require fresh scan before demo.
- Freshness is one shared read model with one invalidation enum. CLI, MCP, prepare, repo map, findings, allowed context, and check should expose the same `stale`, `invalidation_reasons`, and `freshness_requirement`.
- If `check` uses check-time collection instead of stored scan state, the output must say that explicitly and still report engine/fallback/freshness status.

Gaps:

- Incremental scan state is status/explanation only; no invalidation-safe reuse path exists.
- `runCheck` does not call `scanStatusPayload` or require a fresh stored scan. It collects current scan data with a `scan_check_...` id in `packages/cli/src/check/run-check.ts:53`.
- MCP scan status duplicates CLI logic and currently omits resolver-input fingerprint invalidation; compare CLI `scanInvalidationReasons` in `packages/cli/src/domain/scan-status.ts:594` with MCP duplicate in `packages/mcp/src/index.ts:1399`.

Beta status: `canonical-beta`.

### 4. Engine Boundary Contract

Purpose: keep Rust engine results schema-checked at the TypeScript boundary.

Current implementation:

- Engine schema versions are declared in `packages/engine-contract/src/index.ts:8`.
- Scan request/result schemas cover limits, repo context, file snapshots, facts, diagnostics, stats, completeness, and optional graph in `packages/engine-contract/src/index.ts:19` and `packages/engine-contract/src/index.ts:124`.
- Check request/result schemas carry repo, graph, scan, contract, baseline, diff, limits, findings, diagnostics, stats, and completeness in `packages/engine-contract/src/index.ts:163` and `packages/engine-contract/src/index.ts:277`.
- Blocking check results require complete capability coverage in `packages/engine-contract/src/index.ts:290`.
- Stream events include file snapshot, fact, graph node, graph edge, graph evidence, diagnostic, stats, and completion events in `packages/engine-contract/src/index.ts:327`.
- Boundary tests validate scan, stream, graph stream, check, and missing-capability rejection in `packages/engine-contract/test/engine-contract.test.ts:13`.

Packaged engine resolution:

- The resolver supports `env_override`, `workspace_cargo`, and `packaged_optional_dependency` sources in `packages/cli/src/engine/rust-engine.ts:10`.
- The packaged path is resolved from the optional engine package manifest in `packages/cli/src/engine/rust-engine.ts:154`.
- Packaged binaries are checked for platform/arch match, package-owned path, executable bit, and SHA-256 match before spawn in `packages/cli/src/engine/rust-engine.ts:167`.
- `DRIFT_ENGINE_BIN` is allowed as an explicit override and is hashed in `packages/cli/src/engine/rust-engine.ts:195`.

Fallback behavior:

- Rust is attempted first in `packages/cli/src/engine/collect-scan-data.ts:28`.
- TypeScript fallback only runs if `DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK=1` in `packages/cli/src/engine/collect-scan-data.ts:31`.
- Fallback returns `engineSource: "typescript"` with `fallback_used: true`, degraded capability metadata, empty graph nodes, empty graph edges, and empty graph evidence in `packages/cli/src/engine/collect-scan-data.ts`.
- `check` blocks TypeScript fallback with `typescript_fallback_used` instead of producing beta-grade findings.
- Tests verify no silent fallback when Rust is unavailable in `packages/cli/test/engine-bridge.test.ts:17`.

Required invariants:

- Beta uses Rust engine path only.
- Fallback must be visibly degraded or blocked in beta release scripts.
- Blocking findings require complete capability coverage.
- Installed production mode should use a package-owned binary path unless `DRIFT_ENGINE_BIN` is explicitly set by the user.
- Packaged binary checksum mismatch, platform mismatch, non-executable binary, or package path escape must fail closed.
- JSON surfaces should expose `fallback_status`: `engine_source`, `fallback_used`, `fallback_reason`, `degraded_capabilities`, and `enforcement_degraded`.
- Packaged Rust support claims must stay tied to `doctor --json` and `version --json` engine provenance: `engine.source`, package metadata, checksum status, override status, and engine availability.

Gaps:

- No persisted `fallback_used` field exists in `ScanManifest`.
- Fallback graph output is intentionally empty and cannot support beta blocking claims.
- Runtime provenance exists, but support/debug bundles still need a concise installed-engine proof packet.

Beta status: `canonical-beta`.

### 5. Fact Contract

Purpose: define atomic extracted facts before graph/query/check surfaces use them.

Current implementation:

- `FactKind` includes file, import, re-export, exported symbol, symbol call, data operation, route, file role, and test facts in `packages/core/src/domain.ts:181`.
- `FactRecord` stores id, repo id, scan id, kind, file path, name/value, and line range in `packages/core/src/domain.ts:192`.
- `FactRecordSchema` validates the same shape in `packages/core/src/schemas.ts:205`.
- SQLite `facts` table exists in migration `002_scan_facts` in `packages/storage/src/migrations.ts:114`.
- Storage writes/reads facts through `upsertFacts` and `listFacts` in `packages/storage/src/sqlite-storage.ts:312`.

Required invariants:

- Every fact binds to repo id and scan id.
- Every fact has a file path and line range.
- Facts are queryable independently of agent prompts.

Gaps:

- No `extractor`, `confidence`, `resolved_target`, or uncertainty field exists.
- Resolved import evidence is represented in graph nodes/edges, not in `FactRecord`.

Beta status: `canonical-defined`.

### 6. Graph Contract

Purpose: represent repo structure as nodes, edges, evidence, diagnostics, and completeness.

Current implementation:

- Fact graph schema version is `factgraph.v2` in `packages/factgraph/src/index.ts:6`.
- Node kinds include repo/package/artifact/file/module/symbol/import/call/data/endpoint/route/file_role/diagnostic/finding in `packages/factgraph/src/index.ts:9`.
- Edge kinds include file/module/import/export/call/data/finding evidence relationships in `packages/factgraph/src/index.ts:30`.
- Graph evidence stores repo id, scan id, artifact id, file path/hash, range, adapter id/version, fact ids, and redaction state in `packages/factgraph/src/index.ts:54`.
- Fact graph artifact stores repo, adapters, artifacts, nodes, edges, evidence, diagnostics, completeness, and stats in `packages/factgraph/src/index.ts:116`.
- SQLite graph projections are created in migrations `006_fact_graph_artifacts` and `007_fact_graph_v2_projections` in `packages/storage/src/migrations.ts:244` and `packages/storage/src/migrations.ts:292`.
- Storage persists graph artifacts and projections in `packages/storage/src/sqlite-storage.ts:350`.
- Query repo map reads graph nodes/edges/evidence via `@drift/query` in `packages/query/src/index.ts:183`.
- Fixture matrix tests cover graph-resolved service flow, aliases, barrel re-exports, namespace imports, dynamic routes, write data operations, and mixed JS/TS in `test/e2e/fixture-matrix.test.ts:34`.

Required invariants:

- Graph output binds to repo id and scan id.
- Blocking graph-backed checks must carry evidence or capability completeness.
- Repo map surfaces must not include source snippets.
- `redaction_state: "none"` means evidence location/hash metadata was not reduced; it does not imply source text is present. Source text may only appear in an explicit snippet/source field with policy proof and size caps.

Gaps:

- Current persisted `Finding` does not preserve `related_node_ids` from engine findings.
- Graph evidence is beta-complete for the direct-data-access check, but broader graph relationships remain capability-gated.

Beta status: `canonical-beta`.

### 7. Candidate Convention Contract

Purpose: represent inferred conventions before human approval.

Current implementation:

- `ConventionCandidate` includes id, repo id, scan id, kind, statement, rationale, scope, matcher, suggested severity/mode, enforcement capability, confidence, scoring, evidence refs, counterexamples, status, and timestamp in `packages/core/src/domain.ts:282`.
- Candidate schema mirrors this in `packages/core/src/schemas.ts:298`.
- `convention_candidates` table exists in `packages/storage/src/migrations.ts:141`.
- Candidate acceptance requires `--confirm`; see `acceptConventionCandidate` in `packages/cli/src/domain/convention-candidates.ts:12`.
- Candidate inference can produce deterministic `api_route_no_direct_data_access` and heuristic `api_route_requires_service_delegation` candidates in `packages/cli/src/domain/convention-candidates.ts:259`.

Required invariants:

- Candidate state cannot block.
- Human approval is required before governance.
- Only deterministic candidates may be accepted with `--mode block`.

Gaps:

- Dogfood state is not the beta proof anchor; `scripts/run-beta-proof.mjs` creates fixture candidates and accepts the deterministic convention.
- Status vocabulary is `candidate | accepted | rejected | archived | expired`; GPT Pro's `proposed` and `disabled` are not implemented.

Beta status: `canonical-beta`.

### 8. Accepted Convention Contract

Purpose: represent a human-approved convention that can be included in a repo contract.

Current implementation:

- `AcceptedConvention` includes contract id, kind, statement, scope, matcher, severity, enforcement mode, enforcement capability, exceptions, evidence, counterexamples, accepted by/at, updated at, and optional expiry in `packages/core/src/domain.ts:302`.
- `accepted_conventions` table exists in `packages/storage/src/migrations.ts:165`.
- Storage writes accepted conventions in `packages/storage/src/sqlite-storage.ts:751`.
- `acceptConventionCandidate` validates deterministic blocking and requires confirmation in `packages/cli/src/domain/convention-candidates.ts:42` and `packages/cli/src/domain/convention-candidates.ts:45`.

Required invariants:

- Only accepted conventions can block.
- Blocking requires deterministic capability.
- Expired conventions are not checked.

Gaps:

- No explicit `source: inferred | imported | hand_authored` field exists.
- Accepted convention immutability is not strict; upserts can update existing rows.

Beta status: `canonical-beta`.

### 9. Repo Contract Contract

Purpose: define the active enforceable contract bundle for a repo.

Current implementation:

- `RepoContract` includes id, repo id, schema version, repo fingerprint, conventions, rejected inferences, waivers, risky areas, safe commands, required checks, context egress, and agent permissions in `packages/core/src/domain.ts:412`.
- `RepoContractSchema` validates it in `packages/core/src/schemas.ts:435`.
- `repo_contracts` table stores one contract JSON per repo in `packages/storage/src/migrations.ts:190`.
- Storage upserts and reads the contract in `packages/storage/src/sqlite-storage.ts:811`.
- Canonical JSON/fingerprint helpers exist in `packages/core/src/contracts.ts:3` and `packages/cli/src/domain/identifiers.ts:13`.
- `contract show`, `validate`, `export`, `import`, and waiver commands are implemented in `packages/cli/src/commands/contract.ts:16`.

Required invariants:

- `check` must require a repo contract.
- Import must validate schema, repo id, repo fingerprint, convention contract ids, uniqueness, and checksum when requested.
- Mutating contract actions require `--confirm`.

Gaps:

- No separate `policy_mode: advisory | blocking` field exists.
- No stored `hash` column exists; fingerprint is computed at command time.
- Dogfood state is not the beta proof anchor; fixture proof materializes a repo contract.

Beta status: `canonical-beta`.

### 10. Finding Contract

Purpose: define evidence-backed drift output.

Current implementation:

- `Finding` stores id, repo id, convention id, fingerprint, title, message, severity, enforcement result, status, diff status, evidence refs, and created at in `packages/core/src/domain.ts:356`.
- `FindingSchema` validates this in `packages/core/src/schemas.ts:374`.
- `findings` table exists in `packages/storage/src/migrations.ts:58`.
- Storage upserts/list findings in `packages/storage/src/sqlite-storage.ts:629`.
- Engine finding schema includes rule id, status hint, evidence, and `related_node_ids` in `packages/engine-contract/src/index.ts:262`.
- CLI check maps engine findings into stored Drift findings in `packages/cli/src/check/run-check.ts:305`.
- CLI tests verify blocking findings include evidence file, line, import, symbol, scan id, and hash in `packages/cli/test/cli.test.ts:2604`.

Required invariants:

- A blocking finding must name the accepted convention.
- It must include file/range and evidence.
- It must distinguish new, pre-existing, fixed, false-positive, accepted drift, suppressed, and expired states.

Gaps:

- The beta proof validates finding evidence completeness and demo response schema versions.
- Production response compatibility still needs typed schemas beyond top-level `response_schema` strings.

Beta status: `canonical-beta`.

### 11. Check Contract

Purpose: evaluate current repo data against accepted repo contracts.

Current implementation:

- `runCheck` requires repo and repo contract before evaluating in `packages/cli/src/check/run-check.ts:24`.
- It denies output if policy denies `cli-check` in `packages/cli/src/check/run-check.ts:34`.
- It accepts scopes `changed-hunks`, `changed-files`, and `full` in `packages/cli/src/check/run-check.ts:39`.
- It collects current scan data through the Rust bridge in `packages/cli/src/check/run-check.ts:53`.
- Engine-owned direct-data-access check filters active deterministic `api_route_no_direct_data_access` conventions in `packages/cli/src/check/run-check.ts:211`.
- Engine check request includes scan facts, graph, contract, baseline, and diff in `packages/cli/src/engine/engine-check.ts:31`.
- Blocking count drives exit code in `packages/cli/src/check/run-check.ts:175`.
- Check parity tests exist in `packages/cli/test/check-parity.test.ts:14`.
- CLI test proves accepted deterministic convention blocks changed hunk and stores finding in `packages/cli/test/cli.test.ts:2604`.

Required invariants:

- No contract means blocked/refused, not pass.
- Blocking findings require deterministic convention and complete capability coverage.
- Good route should pass; bad route should block.
- Output must explain what failed.
- Check JSON should include `check_id`, `contract_status`, `contract_id`, `contract_fingerprint`, `scan_status`, `engine_source`, `fallback_status`, and `capability_completeness`.
- `check_id` must be persisted and referenced by findings.

Gaps:

- `runCheck` does not require the stored scan status to be fresh; it runs a check-time collection.
- The release proof uses fixture state rather than dogfood state.
- Production response compatibility still needs typed schemas beyond top-level `response_schema` strings.

Beta status: `canonical-beta`.

### 12. Agent Envelope Contract

Purpose: provide a small, read-only state envelope for CLI/MCP outputs.

Current implementation:

- `AgentEnvelopeV2` has schema version, action, surface, read-only flag, policy, scan stale/latest scan state, redaction state, and diagnostics in `packages/core/src/agent-envelope.ts:10`.
- CLI envelope helper is in `packages/cli/src/domain/agent-envelope.ts:4`.
- MCP duplicates a similar helper in `packages/mcp/src/index.ts:1904`.
- `prepare` includes the envelope in `packages/cli/src/commands/prepare.ts:95`.

Required invariants:

- Agent envelope is read-only.
- It reports stale/missing scan state.
- It reports redaction/source snippet state.

Gaps:

- It is not a full agent packet. It does not itself carry repo map, active contracts, or findings.
- CLI/MCP envelope helper duplication is minor but still a drift point.

Beta status: `canonical-defined`.

### 13. MCP Contract

Purpose: expose read-only repo truth to agent/tooling surfaces.

Current implementation:

- `DRIFT_READ_ONLY_MCP_TOOLS` defines 11 tools in `packages/mcp/src/tools.ts:3`.
- Tool list: `get_runtime_info`, `get_capabilities`, `get_audit_status`, `get_scan_status`, `get_repo_contract`, `get_repo_map`, `get_task_preflight`, `get_conventions`, `get_findings`, `get_required_check_executions`, `get_allowed_context`.
- MCP handlers are created by `createReadOnlyMcpHandlers` in `packages/mcp/src/index.ts:67`.
- JSON-RPC rejects unknown non-read-only tools in `packages/mcp/src/index.ts:380`.
- Argument validation rejects missing, extra, blank, unsafe, and wrong-typed args in `packages/mcp/src/index.ts:647`.
- Tests verify tool list and read-only tool names in `packages/mcp/test/mcp.test.ts:1989`.

Required invariants:

- No MCP mutation tools in beta.
- MCP truth should match CLI truth.
- MCP should stay transport/validation over shared query builders.
- CLI and MCP must call the same exported read-model builders for scan status, repo map, task preflight, findings, contract status, and allowed context.
- MCP is read-only but not public. Treat `drift-mcp --db <path>` as a local bearer capability to sensitive Drift metadata. Do not expose it over network transports in V1; clients should be local, user-invoked, and scoped to the selected DB.

Gaps:

- `get_repo_map` uses `@drift/query`, but MCP still duplicates repo-map assembly in `packages/mcp/src/index.ts:1124` instead of using CLI `repoMapPayload`.
- MCP scan status duplicates CLI scan status, but now includes resolver-input invalidation and is covered by full beta proof parity.
- MCP task preflight duplicates CLI prepare assembly in `packages/mcp/src/index.ts:127`.
- `pnpm beta:proof` compares full schema-stable CLI/MCP payloads for scan status, repo map, preflight, contract, accepted conventions, findings, audit, and allowed context.
- Snapshot parity is proof, not the final architecture boundary.

Beta status: `canonical-beta`.

### 14. Storage/Migration Contract

Purpose: durable local SQLite state.

Current implementation:

- 13 migrations exist in source in `packages/storage/src/migrations.ts:6`; `013_required_check_executions` persists external required-check execution proof.
- Tables cover repos, scan manifests, file snapshots, findings, baselines, audit events, facts, convention candidates, accepted conventions, repo contracts, backup manifests, fact graph artifacts, graph projections, scan file changes, symbol occurrence kind, and required-check executions.
- Source tests expect `supported_sqlite_schema_version: 13` in CLI and installed-flow coverage.
- Storage test persists repo, scan, findings, baselines, facts, and more in `packages/storage/test/sqlite-storage.test.ts:165`.
- Release proof checks source and built schema versions so stale generated artifacts do not pass as release truth.

Required invariants:

- Migrations must be ordered and reproducible.
- Stored objects validate against schemas at read/write boundaries.
- Audit verification must be possible from storage alone.
- Source migration count, built CLI `supported_sqlite_schema_version`, installed CLI version output, and release proof schema fields must agree.
- Drift SQLite DBs are sensitive local repo metadata. They are not expected to contain source text, but absolute paths, symbols/imports, graph metadata, hashes, audit metadata, contract JSON, and backup manifests can reveal proprietary structure.
- No cloud sync or support upload should be default for local state.

Gaps:

- No first-class local-state sensitivity contract exists outside this doc.

Beta status: `canonical-beta`.

### 15. Governance/Audit Contract

Purpose: make human-approved mutations explicit and auditable.

Current implementation:

- `AuditEvent` includes repo id, actor, action, target type/id, metadata, timestamp, previous hash, and event hash in `packages/core/src/domain.ts:242`.
- Audit schema includes supported action vocabulary in `packages/core/src/schemas.ts:256`.
- Hash-chain functions are in `packages/core/src/audit.ts:19`.
- Audit columns are added in migration `005_audit_integrity` in `packages/storage/src/migrations.ts:223`.
- Storage appends audit events and verifies hash chain in `packages/storage/src/sqlite-storage.ts:851` and `packages/storage/src/sqlite-storage.ts:890`.
- Governance metadata lists read-only agent actions and human-approved mutations in `packages/cli/src/domain/governance.ts:4`.

Required invariants:

- Mutating governance actions require `--confirm`.
- Audit chain must verify for beta/release proof.
- Agent/MCP cannot mutate repo contract state.
- Audit list/export output is sensitive local governance metadata. It may expose absolute paths, repo fingerprints, governance reasons, symbols, imports, backup locations, and contract paths.
- Support bundles must redact or omit audit metadata unless the user explicitly approves each included class.

Gaps:

- No explicit before/after object hash fields.
- Some action names still use early vocabulary like `election_accepted`.

Beta status: `canonical-beta`.

### 16. Backup/Restore Contract

Purpose: prove local state can be exported, verified, and restored.

Current implementation:

- `BackupManifest` is typed in `packages/core/src/domain.ts:169`.
- `backup_manifests` table exists in `packages/storage/src/migrations.ts:205`.
- Storage persists backup manifests in `packages/storage/src/sqlite-storage.ts:285`.
- Storage test covers backup manifest persistence in `packages/storage/test/sqlite-storage.test.ts:128`.
- Golden e2e lifecycle includes backup create, restore, and audit list in `test/e2e/golden.test.ts:133`.

Required invariants:

- Backup create/restore is a human-confirmed mutation.
- Backup verification should be part of release proof if backup/restore is demoed.
- Backup manifests and verification output are sensitive local artifacts. They include database paths, backup paths, repo fingerprints, migration ids, checksums, and audit-integrity status.
- Support/debug exports must not include SQLite DBs or backup files by default.

Gaps:

- Backup/restore is not required for the narrow beta if the demo is only scan/contract/check/MCP.
- Backup/audit sensitivity is not yet enforced by a support-bundle contract because no support bundle command exists.

Beta status: `canonical-defined`.

### 17. Release/Beta Contract

Purpose: define what must be true before calling this beta.

Required beta proof:

1. Clean checkout at a named commit.
2. `pnpm verify:ci` passes end to end.
3. Rust engine path is used; fallback is not used.
4. Fresh scan exists for the demo repo.
5. Accepted `api_route_no_direct_data_access` repo contract exists.
6. Good route delegates through service and passes.
7. Bad route directly imports/touches data access and blocks.
8. Finding output includes convention id, file/range, evidence, and fix direction.
9. Audit hash chain verifies.
10. MCP reports same scan/contract/preflight/repo-map truth as CLI.
11. Incremental reuse claims must stay limited to tested unchanged-file fact reuse with graph rebuild.

Current evidence:

- `verify:ci` script exists in `package.json`.
- Source `verify:ci` includes release matrix validation and `pnpm beta:proof` in `package.json`.
- `scripts/run-beta-proof.mjs` generates a fixture proof with repo id, scan id, repo contract id, good-route pass, bad-route block, finding evidence completeness, CLI/MCP parity hash, and audit head hash.
- `scripts/run-beta-proof.mjs` also proves `start --json` and `doctor --json` expose stable schemas, machine contract versions, engine provenance, and V1 scope.
- The beta proof includes `test/fixtures/next-real-repo-chadlike`, which guards the real-repo direct-data signal: auth/session/payment wrappers and Prisma runtime error imports must not become forbidden direct-data imports; the accepted convention must forbid only `~/lib/server/db`; all baseline finding evidence must retain `fact_ids`.
- The beta proof also scans static realistic Next/Node fixtures for clean service delegation, no false Prisma semantics from fetch usage, and graceful non-Next indexing.
- `scripts/generate-release-proof.mjs --beta-proof-file <path> --require-beta-proof` consumes the beta proof artifact.
- Test fixture matrix exists in current working tree under `test/fixtures/*` and `test/e2e/fixture-matrix.test.ts:34`.
- Golden lifecycle exists in `test/e2e/golden.test.ts:23`.
- Installed-flow tests include packaged CLI/MCP assertions in `test/e2e/installed-flow.test.ts:200`.

Remaining production gaps:

- Dogfood state is no longer the beta proof anchor; it can still be refreshed after the fixture loop stays green.
- MCP/CLI response builders still duplicate some logic, but `pnpm beta:proof` now compares full schema-stable CLI/MCP payloads for scan status, repo map, preflight, contract, conventions, findings, audit, and allowed context.
- Public CLI/MCP response schemas have top-level version strings; `start` and `doctor` now have typed beta schemas, while full typed schemas for every CLI/MCP result remain production work.
- Release tarballs and engine checksum artifacts are proven by the release workflow's final proof job, not by normal local PR CI.

Beta status: `canonical-beta`.

## Production Readiness Contracts

These contracts are the extra layer needed before Drift can move from credible beta demo to production-grade distribution. They do not expand product scope. They make the narrow scope shippable, supportable, and hard to misrepresent.

### 18. Agent-Facing Response Schema Contract

Purpose: make every CLI JSON and MCP response stable enough for agents, tests, and compatibility policy.

Current evidence:

- CLI output normalizes `unknown | CommandPayload` in `packages/cli/src/app/output.ts:13`.
- `CommandPayload.payload` is `unknown` in `packages/cli/src/app/command-types.ts:14`.
- `packages/core/src/beta-surfaces.ts` defines typed beta schemas for `drift.start.result.v1` and `drift.doctor.result.v1`.
- `packages/cli/src/domain/beta-surfaces.ts` validates `start --json` and `doctor --json` before output.
- MCP handler return values are typed as `unknown` in `packages/mcp/src/types.ts:16`.
- MCP tools define argument schemas in `packages/mcp/src/tools.ts:3`, but response schemas are not first-class.

Beta-used CLI surfaces expose stable response schemas:

- `drift.start.result.v1`
- `drift.doctor.result.v1`
- `drift.scan.status.v1`
- `drift.task.preflight.v1`
- `drift.repo.map.v1`
- `drift.check.result.v1`

`start` and `doctor` also include `machine_contract_versions`, engine provenance, and `v1_scope`.

Required invariants:

- Every demo-used CLI `--json` payload and MCP tool result has a `response_schema` name/version string.
- Top-level response fields are stable across CLI and MCP where the concept is shared: `response_schema`, `surface`, `repo_id` when repo-scoped, `status`, `policy`, `freshness_requirement`, `contract_status`, `diagnostics`, and command/tool-specific body.
- Error/refusal envelopes are typed, not prose-only.
- Schema snapshots are compatibility proof; shared builders are the implementation boundary.

Gaps:

- Agent-facing payloads outside the locked beta surfaces are still too loosely typed to support a broad public API promise.
- There is no generated response-schema index for CLI/MCP parity.

Status: `canonical-beta`.

### 19. Transport Boundary Contract

Purpose: prevent CLI and MCP from becoming separate product implementations.

Required invariants:

- CLI and MCP transport layers may parse flags/arguments, validate schemas, call shared read-model services, and serialize typed results.
- Transport layers must not perform repo walking, git probing, graph composition, freshness calculation, policy assembly, fallback decisions, or finding shaping inline.
- Shared read-model services should own scan status, repo map, task preflight, findings, contract status, allowed context, and audit/backup status summaries.

Current evidence:

- CLI has a shared repo-map builder in `packages/cli/src/domain/repo-map.ts:51`.
- CLI and MCP both use `@drift/query` graph read models for graph-backed repo map evidence.
- `scripts/run-beta-proof.mjs` computes a full schema-stable CLI/MCP parity hash across beta-used read surfaces.
- MCP remains read-only and exposes no mutation tools.

Remaining refactor debt:

- MCP still contains transport-adjacent assembly code. This is now guarded by parity proof, but shared read-model extraction should continue.

Status: `canonical-defined`.

### 20. Release Proof Artifact Contract

Purpose: turn beta/release readiness into an inspectable artifact.

Required fields:

- `release_version`
- `git_ref`
- `git_sha`
- `workflow_run_id`
- `dirty_state: false`
- `verify_ci_status`
- `node_version`
- `pnpm_version`
- `cargo_version`
- `package_versions`
- `source_schema_version`
- `built_schema_version`
- `engine_targets`
- `engine_artifact_sha256`
- `npm_tarballs`
- `installed_cli_smoke_results`
- `installed_mcp_smoke_results`
- `fallback_used: false`
- `fresh_scan_verified: true`
- `response_schemas_verified: true`
- `dogfood_or_fixture_repo_id`
- `scan_id`
- `repo_contract_id`
- `check_id`
- `good_route_passed: true`
- `bad_route_blocked: true`
- `finding_evidence_complete: true`
- `mcp_cli_parity_hash`
- `mcp_cli_parity_verified: true`
- `audit_head_hash`
- `audit_verified: true`
- `created_at`

Required invariants:

- No public beta/release claim without a generated proof artifact attached to the workflow run, release, or internal release packet.
- The artifact must prove source and built artifacts agree on package versions, migration count, schema versions, engine binary target matrix, and checksums.
- The artifact must show a clean accepted-contract proof: good case passes, bad case blocks, audit verifies, and MCP reports the same state as CLI.

Current evidence:

- `pnpm verify:ci` is the repo gate in `package.json`.
- `pnpm beta:proof` runs `scripts/run-beta-proof.mjs`.
- `scripts/generate-release-proof.mjs` writes `drift.release.proof.v1`.
- `scripts/run-beta-proof.mjs` writes `drift.beta.proof.v1`.
- The release proof generator accepts `--beta-proof-file` and enforces `--require-beta-proof` only from a `drift.beta.proof.v1` artifact.
- The root-visible engine release workflow runs `pnpm verify:ci` and engine binary packaging steps in `../.github/workflows/engine-binary-release.yml`.
- The engine release workflow generates beta preflight proof, then generates a final `drift.release.proof.v1` with `--require-complete` after checksums and npm tarballs exist.
- Installed-flow tests already cover packaged CLI/MCP assertions in `test/e2e/installed-flow.test.ts:200`.

Gaps:

- Local PR CI does not produce release-time npm tarballs or engine checksum artifacts; the final release workflow proof does.
- The proof artifact currently records package/runtime facts and beta loop facts, but not a full support-bundle sensitivity manifest.

Status: `canonical-beta`, production-hardening ongoing.

### 21. CI/Gate Contract

Purpose: define what “green” means for PR, beta, and release.

Required invariants:

- PR gate: `pnpm verify:ci` on Ubuntu/Node 22, with no ignored failures.
- Release gate: PR gate plus engine target matrix, packaged engine checksum validation, packed package smoke, installed CLI smoke, installed MCP smoke, migration compatibility, and version alignment.
- Local-only generated artifacts cannot make a gate green.
- Gate output must show every stage ran; stopping early means later stages are unverified.

Current evidence:

- `verify:ci` currently runs `pnpm verify`, Rust format check, Rust clippy, package boundary check, release matrix validation, `pnpm beta:proof`, and `git diff --check` in `package.json`.
- The root-visible CI workflow invokes `pnpm verify:ci` in `../.github/workflows/ci.yml`.

Gaps:

- Release artifact completeness still happens in the engine release workflow because PR CI does not build all platform engine artifacts.

Status: `canonical-beta`.

### 22. Packaged Engine/Installer Contract

Purpose: make installed Rust engine behavior trustworthy.

Required invariants:

- Allowed engine sources are `packaged_optional_dependency`, `env_override`, `workspace_cargo`, or missing.
- Installed production mode must prefer package-owned optional dependency binaries.
- Packaged binaries must validate manifest platform/arch, package-owned path, executable bit, and SHA-256 before spawn.
- `DRIFT_ENGINE_BIN` is allowed, but JSON diagnostics must mark `override_active: true`.
- Beta/release proof fails if the blocking check path uses TypeScript fallback.
- `doctor --json`, `version --json`, scan status, and check output should expose engine provenance and fallback status.

Current evidence:

- Resolver source types are defined in `packages/cli/src/engine/rust-engine.ts:10`.
- Packaged binary validation happens in `packages/cli/src/engine/rust-engine.ts:167`.
- Optional engine packages are referenced from `packages/cli/package.json:37`.

Gaps:

- Version and doctor payloads expose the installed engine object; support bundles still need a concise engine-proof manifest.
- Fallback status is summary-level, not a durable read-model field.

Status: `canonical-defined`.

### 23. Update And Compatibility Contract

Purpose: define what can change without breaking existing users, agents, and local state.

Public compatibility surfaces:

- CLI commands and JSON payloads.
- MCP tool names, argument schemas, and response schemas.
- Repo contract import/export JSON.
- SQLite migrations and schema compatibility checks.
- FactGraph artifact schema.
- Engine request/result/stream schemas.
- Backup manifests.
- Finding fingerprints and baseline semantics.
- Release proof artifact schema.

Required invariants:

- Additive JSON fields are allowed.
- Removals, renames, type changes, required-field changes, fingerprint changes, and behavior changes require a schema/version bump and compatibility note.
- Older DBs must either migrate forward or fail with a clear unsupported-database refusal.
- Future/unknown migrations must fail closed rather than silently reading incompatible state.

Current evidence:

- `release-compatibility-policy.md` defines a compatibility policy, but this canonical doc only partially summarized it.
- CLI version logic derives `supported_sqlite_schema_version` from `MIGRATIONS.length` in `packages/cli/src/domain/versions.ts:5`.

Gaps:

- Compatibility is split across docs and tests rather than represented as one canonical contract.
- Source/build schema drift must become a release-blocking compatibility failure.

Status: `canonical-defined`.

### 24. Operational Failure Mode Contract

Purpose: make failures explainable and recoverable across CLI, MCP, release, and installed runtime.

Required response fields:

- `code`
- `surface`
- `severity`
- `safe_to_retry`
- `user_action`
- `recovery_commands`
- `diagnostics`

Required codes:

- `missing_engine`
- `engine_checksum_mismatch`
- `unsupported_platform`
- `typescript_fallback_used`
- `stale_scan`
- `missing_contract`
- `unsupported_database`
- `audit_chain_broken`
- `source_build_schema_mismatch`
- `partial_publish`
- `mcp_cli_parity_mismatch`

Current evidence:

- Engine runtime failures are mapped into CLI operational codes in `packages/cli/src/app/run-cli.ts`.
- JSON CLI errors include `code`, `surface`, `severity`, `safe_to_retry`, `user_action`, `recovery_commands`, and `diagnostics`.
- Tests cover `stale_scan` and `missing_contract` recovery envelopes.
- The beta refusal list names the release-blocking failure classes.

Remaining refactor debt:

- MCP protocol errors still use JSON-RPC `code/message`; a future MCP compatibility pass should add the same recovery envelope under JSON-RPC `error.data`.

Status: `canonical-defined`.

### 25. Local State Sensitivity Contract

Purpose: define what local Drift state may reveal and how it must be handled.

Sensitive local artifacts:

- SQLite DBs.
- Backup manifests and backup files.
- Audit events.
- Repo map metadata.
- Fact and graph artifacts.
- Contract JSON.
- Finding evidence.
- Support/debug output.

Required invariants:

- Drift state is local-first and source-adjacent. It may not contain source text, but it can expose absolute paths, symbols, import names, graph structure, hashes, repo fingerprints, governance decisions, and backup paths.
- No cloud sync, telemetry upload, or support upload by default.
- Any export/support flow must show what classes of data are included before writing or sending them.
- Redaction vocabulary must distinguish metadata redaction from source snippet inclusion.

Current evidence:

- `repos.root_path` is stored in `packages/storage/src/migrations.ts:15`.
- Facts store file paths, names, values, and ranges in `packages/storage/src/migrations.ts:114`.
- Graph artifacts store full graph JSON in `packages/storage/src/migrations.ts:246`.
- Backup manifests store source database and backup paths in `packages/storage/src/migrations.ts:210`.

Implemented boundary:

- `support bundle --dry-run` emits a manifest-only support payload and explicitly reports excluded data classes.
- Support/debug output excludes source text, SQLite DBs, backup files, environment variables, contract JSON, and finding evidence by default.

Status: `canonical-defined`.

### 26. Support And Debuggability Contract

Purpose: define what support/debug payloads may contain.

Current support payloads:

- `doctor --json` is the current operational support surface.
- Backup verify and audit verify provide additional local health checks.
- `support bundle --dry-run --json` emits `drift.support.bundle.v1`.

Support bundle rules:

- The default bundle is manifest-only: versions, OS/runtime, engine provenance, migration ids/counts, integrity booleans, non-reversible hashes, backup health, and redacted diagnostics.
- It must exclude SQLite DBs, backups, source snippets, absolute paths, audit metadata, contract JSON, findings evidence, environment variables, tokens, and repo dumps unless each class is explicitly approved.
- Support artifacts are local-only unless the user exports them.

Remaining limitations:

- V1 supports dry-run manifest output only; writing/exporting a support bundle remains out of scope.

Status: `canonical-defined`.

### 27. Production Scope/Claims Contract

Purpose: prevent beta/release claims from outrunning implemented behavior.

Required invariants:

- Public docs, demo scripts, release notes, and product copy must be checked against capabilities output.
- Claims about broad language support, desktop UI, cloud sync, Python adapter, duplicate helper detection, or mutation-capable MCP are blocked until capabilities output and release proof support them.
- If TypeScript fallback is used, outputs must say enforcement is degraded and cannot support blocking beta claims.

Current evidence:

- Capabilities output is real and narrow.
- `docs/architecture/beta-claims.json` is the machine-readable production claims manifest.
- `scripts/validate-product-claims.mjs` blocks explicit overclaims for cloud sync, mutation-capable MCP, broad language support, and unsupported incremental scan performance claims.
- `pnpm verify:ci` runs `pnpm validate:claims`.

Status: `canonical-beta`.

## GPT Pro Proposal Classification

Accepted as current or mostly current:

- Local-first CLI product scope.
- Human-confirmed governance.
- Read-only MCP.
- SQLite storage and migrations.
- Rust/TypeScript boundary with schema-checked engine contract.
- Facts, graph projections, graph-backed repo map, audit verification.
- Candidate to accepted convention to repo contract path.
- `api_route_no_direct_data_access` as deterministic beta convention.

Accepted as requirement, not fully implemented:

- Packaged engine provenance in `doctor --json` and `version --json`.
- Versioned response schemas for CLI JSON and MCP results.
- Sensitive local-state and support-bundle boundaries.
- Cross-surface operational failure code taxonomy.

Speculative or not currently implemented:

- `vcs_provider`, `remote_url_hash`, `lockfile_hashes`, and package-manager identity as persisted repo identity fields.
- Repo contract `policy_mode`.
- Stored contract hash column.
- Audit `before_hash` and `after_hash`.
- Convention statuses `proposed` and `disabled`.
- `drift support bundle`.
- Machine-readable beta claims manifest.

## Next Build Slices

1. Collapse remaining CLI/MCP read builders.
   - Move scan status, repo map, preflight, and findings response construction into shared query/domain code.
   - Leave MCP as JSON-RPC, argument validation, and handler wiring.

2. Harden incremental messaging.
   - Keep incremental scan described as full-scan status until reuse exists.

3. Expand response schemas beyond beta-used surfaces.
   - Keep the top-level `response_schema` strings.
   - Add typed schema definitions for all CLI JSON and MCP result bodies.
   - Normalize success/refusal envelopes across surfaces.

4. Lock production support boundaries.
   - Treat SQLite state, backups, audit events, graph/fact metadata, contract JSON, and findings evidence as sensitive local metadata.
   - Keep `doctor --json` as the current support payload.
   - Do not add a support bundle until manifest-only defaults and explicit include approvals are designed.

5. Canonicalize failure modes.
   - Add stable codes for missing engine, checksum mismatch, unsupported platform, stale scan, missing contract, fallback used, unsupported DB, audit break, source/build schema mismatch, partial publish, and MCP/CLI parity mismatch.
   - Include retry/user-action/recovery fields in CLI/MCP failures.

## Beta Refusal List

Refuse beta if any of these are true:

- `pnpm verify:ci` does not pass end to end.
- A generated beta proof or final release proof artifact is missing.
- The demo depends on dirty or uncommitted state.
- The demo cannot show accepted contract causing a bad route to block.
- Good route pass is not shown.
- Source migrations, built CLI schema version, installed CLI schema version, and release proof schema fields disagree.
- Packaged engine provenance is missing or checksum validation is not visible for installed mode.
- Fallback scanner output can appear production-equivalent.
- MCP and CLI disagree on scan, contract, preflight, repo map, or findings.
- Incremental reuse is claimed before reuse is implemented.
- Check failure is not explainable from contract, file, evidence, expected/actual boundary, and suggested fix.
- Dogfood or fixture state has no accepted contract.
- Audit verification fails.
- CLI/MCP JSON responses lack `response_schema` for the surfaces used in the demo.
- Support/debug artifacts would expose SQLite DBs, backups, source snippets, absolute paths, audit metadata, contract JSON, findings evidence, environment variables, tokens, or repo dumps by default.
