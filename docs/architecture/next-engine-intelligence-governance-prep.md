# Next Engine Intelligence Governance Prep

Date: 2026-05-22

## Purpose

This document prepares the next five Drift engineering sprints and audits the contract, convention, and election surfaces they must preserve.

The next sprint batch is deeper intelligence, not new product surface:

1. Import resolution hardening.
2. Route-to-service flow graph.
3. Graph query contract.
4. Engine-owned candidate inference.
5. Dogfood Drift on Drift with real output.

The implementation rule is simple: improve code understanding without weakening Drift's governance model. Every new parser, resolver, graph, rule, query, and agent surface must account for accepted conventions, rejected inferences, exceptions, waivers, baselines, findings, policy, audit, and CLI/MCP parity.

## Current Product Contract

Drift already has the core governance loop:

```text
scan
-> convention candidates
-> human election: accept / reject / edit
-> accepted RepoContract
-> baseline legacy findings
-> prepare / ask / repo map / MCP
-> check
-> findings lifecycle
-> audit
-> backup / restore
```

The next work must not bypass that loop.

### Source Of Truth Surfaces

Current source-truth files and packages:

- `packages/core/src/domain.ts`: canonical domain types for conventions, candidates, findings, contracts, waivers, policies, scans, facts, and audit events.
- `packages/core/src/schemas.ts`: Zod validation for exported/imported/local domain records.
- `packages/engine-contract/src/index.ts`: versioned engine scan/check/stream schemas.
- `packages/factgraph/src/index.ts`: graph schema, stable ID helpers, evidence records, and graph artifact builders.
- `packages/storage/src/sqlite-storage.ts`: SQLite persistence for scans, facts, contracts, findings, graph projections, audit events, baselines, and backups.
- `packages/query/src/index.ts`: shared graph-backed query layer for repo maps and future CLI/MCP/UI graph queries.
- `packages/cli/src/check/run-check.ts`: current CLI orchestration and governance filtering before engine check execution.
- `crates/drift-engine/src/check_command.rs`: Rust-owned check result generation for deterministic direct data-access checks.
- `packages/mcp/src/index.ts`: read-only MCP transport over local state and query surfaces.

### Active Convention Kinds

Current `ConventionKind` values:

```text
api_route_no_direct_data_access
api_route_requires_service_delegation
api_route_requires_auth_helper
test_expected_for_changed_module
custom_briefing
```

Implementation constraint:

- Only `api_route_no_direct_data_access` is currently deterministic and engine-backed.
- `api_route_requires_service_delegation` may become deterministic only after route-flow graph evidence exists.
- `api_route_requires_auth_helper`, `test_expected_for_changed_module`, and `custom_briefing` stay briefing or heuristic until they have typed matchers, capability requirements, fixtures, and evidence contracts.

### Election Model

In Drift, "election" means a human-governed decision about inferred repo conventions or governance state.

Election records today:

- `ConventionCandidate`: scan-derived proposal with structured matcher, evidence, counterexamples, scoring, capability, and status.
- `AcceptedConvention`: human-approved convention materialized into `RepoContract.conventions`.
- `RejectedInference`: memory that a candidate was rejected so it should not be repeatedly re-proposed.
- `ConventionException`: scoped exception on an accepted convention.
- `RepoContract.waivers`: contract-level governance overrides.
- `Finding.status`: human review state such as `fixed`, `false_positive`, `accepted_drift`, `suppressed`, and `needs_review`.
- `AuditEvent`: append-only evidence of election/governance mutations.

Implementation constraint:

- Engine work can propose candidates and findings.
- TypeScript product plane remains the authority for human elections, accepted contracts, rejected inference memory, policy, audit, backup, restore, and governance lifecycle.
- MCP remains read-only in V1.

## Non-Negotiable Governance Invariants

These invariants apply to all five sprints.

1. **No parser result bypasses contract governance.**
   Engine facts and graph edges are evidence. They do not become accepted conventions without human election through CLI governance commands.

2. **Only deterministic conventions can block.**
   `enforcement_capability: "deterministic_check"` plus `enforcement_mode: "block"` is required before CI-blocking behavior is allowed.

3. **Exceptions and waivers must be applied before blocking.**
   Convention exceptions and active contract waivers must suppress or downgrade applicable engine findings before a blocking result is exposed.

4. **Baseline semantics must stay intact.**
   Existing violations are `pre_existing`. New or touched violations are classified separately. Legacy drift cannot become a new blocker because graph intelligence improved.

5. **Rejected inference memory must prevent repeat noise.**
   Candidate inference must compare matcher/scope/rule fingerprints against `RepoContract.rejected_inferences` before proposing "new" candidates.

6. **Policy guards every outward surface.**
   `prepare`, `ask`, `repo map`, `findings`, `contract export`, artifacts, logs, and MCP tools must route through centralized context-export authorization before exposing repo intelligence.

7. **CLI and MCP must agree.**
   Agent-facing CLI JSON and MCP responses must use shared query/preflight builders where practical. MCP should not implement its own graph or governance truth.

8. **Incomplete graph intelligence cannot block.**
   If scan/check output is truncated, stale, missing required capabilities, or over configured limits, deterministic checks can warn but must not block.

9. **Evidence is required.**
   Findings and candidates must carry file/line evidence, fact IDs or graph evidence IDs, scan ID, file hash, and redaction state.

10. **No remote/model dependency for deterministic inference.**
    V1 inference and checks remain local, static, and deterministic. Any future model-assisted inference must be policy-gated and visibly marked as exported context.

## Contract Gap Audit

### Existing Strengths

- `RepoContract` separates accepted conventions, rejected inferences, risky areas, safe commands, required checks, egress policy, waivers, and agent permissions.
- `ConventionCandidate` separates candidate lifecycle from accepted contract state.
- `Finding` separates status, diff status, and enforcement result.
- Engine check results now include limits, diagnostics, stats, completeness, and related graph node IDs.
- FactGraph stores graph artifacts plus SQLite projections, matching the Option B architecture decision.
- MCP repo map now reads through the shared graph query path instead of owning a separate map truth.

### Gaps To Address During This Sprint Batch

1. **Matcher contract is still too loose.**
   `ConventionMatcher` has arrays for forbidden imports, required calls, and allowed delegate imports. Route-flow and import-resolution checks need versioned matcher schemas with rule IDs, rule versions, matcher fingerprints, and required capabilities.

2. **Candidate lineage is not frontier-grade yet.**
   Current candidates lack explicit candidate version, rule version, matcher schema version, matcher fingerprint, scope fingerprint, graph fingerprint, and supersession fields.

3. **Accepted conventions lack version lineage.**
   Accepted conventions have stable IDs but no incrementing convention version or accepted candidate lineage.

4. **Engine check contract handles one deterministic rule.**
   `api_route_no_direct_data_access` is active. Service delegation needs a route-flow graph and capability-gated rule manifest before it can block.

5. **Query API is narrow.**
   `GraphQueryService.repoMap()` exists. The planned query contract still needs affected files, reachable data access, route flow, symbol neighborhood, and finding evidence APIs.

6. **Engine-owned candidate inference does not exist yet.**
   Candidate inference still lives in TypeScript/product logic. Moving it engine-side requires a candidate result schema and governance adapter, not direct contract mutation.

7. **Dogfood transcript is a template, not proof.**
   The `docs/dogfood/drift-on-drift.md` artifact needs real outputs against this repo after the graph/import/route-flow work lands.

## Sprint 1 Prep: Import Resolution Hardening

### Goal

Make TypeScript/JavaScript import resolution credible enough for architectural graph checks.

### Required Contract Accounting

Import resolution must update evidence and graph state only. It must not create accepted conventions directly.

Resolver output must support:

- relative imports
- extension substitution
- `index.ts`, `index.tsx`, `index.js`, `index.jsx`
- `tsconfig.json` and `jsconfig.json` `paths`
- `baseUrl`
- workspace package imports
- package `exports`
- package `imports`
- barrel re-exports
- default, named, namespace, side-effect, and type-only imports
- unresolved diagnostics

### Convention/Election Impact

- Accepted `api_route_no_direct_data_access` conventions may match resolved module paths in addition to raw import specifiers.
- Existing waivers and exceptions must match both raw import specifiers and resolved modules.
- Rejected inferences must not be invalidated merely because resolution became deeper.
- Baseline fingerprints must remain stable for equivalent violations; if a fingerprint migration is unavoidable, it needs an explicit compatibility plan.

### Required Engine/Graph Output

Add or preserve graph metadata for import declarations:

```text
import source
local name
imported name
import kind
resolution status: resolved | unresolved | external | type-only
resolved file/module/package id
resolver diagnostic ids
```

### Tests

Add fixture coverage for:

- relative import to DB module
- alias import to DB module
- package workspace import to DB module
- package export import to DB module
- barrel re-export to DB module
- type-only import that must not create value-access findings
- unresolved import diagnostic that does not silently pass as "safe"

Verification commands:

```bash
cargo test -p drift-engine
pnpm --filter @drift/factgraph test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test -- --runInBand -t "import|resolved|alias|waiver|direct data"
pnpm verify:ci
```

## Sprint 2 Prep: Route-To-Service Flow Graph

### Goal

Represent route-to-service-to-data-access paths so Drift can distinguish allowed delegation from route-level direct data access.

### Required Contract Accounting

This sprint is where `api_route_requires_service_delegation` can move from heuristic toward deterministic, but only if evidence is complete.

Do not make it blocking until:

- route handler nodes exist
- service module role detection is deterministic enough
- imports/calls can connect route handlers to service symbols
- data-access module role detection is deterministic enough
- graph completeness says route-flow evidence can block

### Convention/Election Impact

New candidate family:

```text
kind: api_route_requires_service_delegation
capability: heuristic_check first, deterministic_check only after fixture proof
default enforcement: warn
```

Accepted direct-data-access conventions still apply independently. Service delegation should not suppress direct DB findings unless the graph proves the route does not directly import/call data access.

Exceptions must support common legitimate cases:

- health routes
- webhooks
- static config routes
- internal debug routes
- generated route handlers

### Required Graph Edges

Add or use graph edges for:

```text
ROUTE_DECLARED_IN_FILE
ROUTE_HANDLED_BY_SYMBOL
FILE_CONTAINS_SYMBOL
MODULE_IMPORTS_MODULE
IMPORT_RESOLVES_TO_MODULE
CALLSITE_REFERENCES_SYMBOL
```

Route-flow query should produce:

```text
route file -> route handler symbol -> imported service symbol -> service module -> data-access import/module
```

If any link is unresolved, emit a diagnostic and mark route-flow completeness as non-blocking.

### Tests

Add fixtures:

- clean route delegates to service, service imports DB
- route directly imports DB and calls it
- route imports both service and DB, still violation
- route delegates through barrel export
- route calls service via alias
- route with health-route exception

Verification commands:

```bash
cargo test -p drift-engine route
pnpm --filter @drift/query test
pnpm --filter @drift/cli test -- --runInBand -t "service delegation|route flow|direct data"
pnpm verify:ci
```

## Sprint 3 Prep: Graph Query Contract

### Goal

Make graph queries stable API contracts, not ad hoc helpers.

### Required Contract Accounting

Queries must accept a context carrying repo, scan/freshness, policy surface, actor, limits, and diagnostics.

Minimum query context:

```ts
type GraphQueryContext = {
  repo_id: string;
  scan_id?: string;
  graph_id?: string;
  require_fresh?: boolean;
  policy_surface: "cli-preflight" | "cli-check" | "mcp" | "contract-export" | "artifact" | "log" | "ui";
  actor?: string;
  limit?: number;
};
```

### Required Query APIs

Add stable methods to `@drift/query`:

```text
getRepoMap
getTaskContext
getFileImpact
getRouteFlow
getReachableDataAccess
getAffectedFiles
getSymbolNeighborhood
getFindingEvidence
getCompleteness
```

The first implementation can be minimal, but it must define typed inputs/outputs and tests.

### Convention/Election Impact

The query package must decorate graph results with:

- matching accepted convention IDs
- risky area IDs
- open finding IDs
- active waiver IDs where applicable
- exception coverage where applicable
- policy/freshness metadata

Queries must not mutate:

- candidate status
- accepted conventions
- rejected inferences
- waivers
- findings
- policies
- audit state

### CLI/MCP Parity

Product surfaces that ask the same question must call the same query builder:

```text
drift repo map <-> MCP get_repo_map
drift prepare <-> MCP get_task_preflight
drift findings show <-> MCP get_findings
drift policy check-context <-> MCP get_allowed_context
```

### Tests

Add parity tests:

- CLI repo map and MCP repo map agree on file roles/imports/calls.
- CLI prepare and MCP preflight agree on conventions/findings/risky areas.
- Stale graph produces the same refusal/freshness metadata.
- Policy-denied path is denied in both CLI and MCP.

Verification commands:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/mcp test
pnpm --filter @drift/cli test -- --runInBand -t "repo map|prepare|MCP|policy"
pnpm verify:ci
```

## Sprint 4 Prep: Engine-Owned Candidate Inference

### Goal

Move deterministic/graph-backed candidate inference closer to the engine while keeping TypeScript as governance orchestrator.

### Required Contract Accounting

The engine may emit candidate proposals. It must never mutate:

- `ConventionCandidate.status`
- `AcceptedConvention`
- `RepoContract`
- `RejectedInference`
- `AuditEvent`

TypeScript persists candidate proposals only after:

- validating schema
- applying rejected-inference memory
- deduplicating by matcher/scope/rule fingerprint
- attaching scan ID and graph fingerprint
- policy-checking outward output

### Required Candidate Result Schema

Add an engine candidate result contract before implementation:

```text
schema_version: engine.candidates.result.v1
repo_id
scan_id
graph_id
engine_version
rule_engine_version
adapter_versions
candidates[]
diagnostics[]
stats
completeness[]
```

Candidate fields must include:

```text
candidate_id
candidate_version
kind
rule_id
rule_version
matcher_schema_version
matcher_fingerprint
scope_fingerprint
graph_fingerprint
statement
rationale
scope
matcher
suggested_severity
suggested_enforcement_mode
enforcement_capability
confidence_label
scoring
required_capabilities
evidence_refs
counterexample_refs
supersedes_candidate_id
created_at
expires_at
```

### Convention/Election Impact

Candidate IDs must be deterministic across identical repo/scan/graph/rule/matcher inputs.

Rejected candidates must suppress future proposals when:

- rule ID matches
- matcher fingerprint matches
- scope fingerprint matches
- rejection has not expired

Accepted conventions must preserve lineage:

- accepted candidate ID
- accepted rule version
- accepted matcher fingerprint
- accepted scope fingerprint
- accepted graph fingerprint

If existing schemas cannot hold those fields without a contract bump, add them deliberately and update import/export compatibility tests.

### Tests

Add candidate inference tests:

- engine proposes direct data-access candidate from consistent examples
- rejected candidate is not re-proposed as new
- accepted candidate materializes unchanged contract matcher
- candidate IDs are deterministic across repeated scans
- candidates with incomplete graph evidence are `heuristic_check` or `briefing_only`, not blocking

Verification commands:

```bash
cargo test -p drift-engine candidate
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/core test
pnpm --filter @drift/storage test
pnpm --filter @drift/cli test -- --runInBand -t "candidate|convention|reject|accept|contract"
pnpm verify:ci
```

## Sprint 5 Prep: Dogfood Drift On Drift

### Goal

Produce a real evidence transcript of Drift analyzing Drift, not a template.

### Required Contract Accounting

Dogfood must prove the governance loop still works after the deeper intelligence changes:

```text
doctor
start
scan
conventions list/show
contract show/validate
repo map
prepare
check
findings list/show
MCP read-only calls
audit verify
backup create/verify
```

Dogfood output should record:

- repo ID
- scan ID
- contract fingerprint
- scan fingerprint
- accepted conventions
- rejected candidates
- active waivers/exceptions
- baseline counts
- finding counts by status
- graph node/edge/evidence counts
- unresolved import diagnostics
- policy metadata on agent-facing surfaces
- stale/truncated/completeness status

### Product Evaluation Questions

Answer these honestly in `docs/dogfood/drift-on-drift.md`:

- Did import resolution find useful real Drift relationships?
- Did route-flow graph distinguish service delegation from direct access?
- Did prepare give an agent enough context to edit safely?
- Did check produce stable, explainable findings?
- Did MCP match CLI outputs?
- Did policy metadata appear on every agent-facing response?
- Were any candidates noisy, overbroad, or under-evidenced?
- What still feels like scanner output instead of product intelligence?

### Tests

Dogfood itself is not the only test. Add automated checks that prevent the transcript from drifting away from real behavior:

- smoke script or test command that regenerates key JSON snippets
- schema validation for captured JSON where practical
- link transcript commands to current CLI names
- fail if dogfood references unsupported commands

Verification commands:

```bash
pnpm verify:ci
pnpm exec drift doctor --repo-root . --json
pnpm exec drift scan --repo-root . --json
pnpm exec drift repo map --repo <repo_id> --json
pnpm exec drift prepare "add graph query route flow" --repo <repo_id> --json
pnpm exec drift audit verify --repo <repo_id> --json
```

## Implementation Order And Cut Lines

The next five sprints should run in this order:

1. Import resolution.
2. Route-flow graph.
3. Query contract expansion.
4. Engine-owned candidate inference.
5. Dogfood.

Do not invert Sprints 3 and 4. Candidate inference needs a stable query/graph contract to avoid embedding product-query logic inside the engine result adapter.

If time runs short, cut scope in this order:

1. Defer `getSymbolNeighborhood`.
2. Defer package `imports`.
3. Keep service delegation as `heuristic_check`.
4. Defer candidate lineage schema migration, but document it as a blocker before beta.
5. Keep dogfood as a transcript plus command validation, not a polished report.

Do not cut:

- waiver/exception handling
- baseline behavior
- policy gates
- rejected inference memory
- CLI/MCP parity tests
- deterministic IDs/fingerprints
- incomplete graph non-blocking behavior

## Review Checklist For Implementation Agents

Before any PR for these sprints is considered ready:

- [ ] New engine output is validated by `@drift/engine-contract`.
- [ ] New graph records are represented in `@drift/factgraph`.
- [ ] New query behavior lives in `@drift/query`, not duplicated in CLI and MCP.
- [ ] New outward JSON or MCP output includes policy/freshness/diagnostics metadata or a documented reason it cannot yet.
- [ ] New deterministic checks respect exceptions, waivers, baselines, and stale/incomplete graph completeness.
- [ ] New candidate inference does not mutate accepted contracts.
- [ ] Rejected candidates are not re-proposed without changed matcher/scope/rule fingerprints.
- [ ] Existing accepted conventions do not silently change behavior without tests and a compatibility note.
- [ ] Findings preserve governed statuses on repeated checks.
- [ ] Fixture matrix covers clean, violating, legacy-baselined, aliased, re-exported, and no-TS cases.
- [ ] `pnpm verify:ci` passes.

## Agent Prompt For This Sprint Batch

Use this prompt for a new implementation context:

```text
You are working in /Users/geoffreyfernald/Downloads/driftv3 on Drift, a local-first repo intelligence guardrail.

Before editing, read:
- docs/architecture/next-engine-intelligence-governance-prep.md
- docs/architecture/frontier-engineering-requirements.md
- docs/architecture/factgraph-adapter-boundary.md
- docs/architecture/graph-query-api.md
- docs/architecture/engine-owned-checks.md
- packages/core/src/domain.ts
- packages/engine-contract/src/index.ts
- packages/factgraph/src/index.ts
- packages/query/src/index.ts

Your task is to implement the next five intelligence sprints without drifting from Drift governance:
1. Import resolution hardening.
2. Route-to-service flow graph.
3. Graph query contract.
4. Engine-owned candidate inference.
5. Dogfood Drift on Drift.

Non-negotiables:
- Do not bypass RepoContract elections.
- Do not make heuristic conventions block.
- Preserve exceptions, waivers, baselines, governed finding statuses, policy gates, audit behavior, and CLI/MCP parity.
- Engine can emit evidence, findings, and candidate proposals; TypeScript product plane owns human elections, accepted contracts, rejected inferences, policy, audit, backup, and restore.
- MCP remains read-only.
- Incomplete, stale, truncated, or over-limit graph intelligence cannot block.

Work test-first. Add fixtures before broadening parser behavior. Use shared query APIs rather than duplicating CLI/MCP logic. Keep deterministic IDs and fingerprints stable. Run `pnpm verify:ci` before claiming completion.
```
