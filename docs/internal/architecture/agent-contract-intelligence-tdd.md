# Agent Contract Intelligence TDD

## Purpose

This document defines the test-driven implementation plan for the next Drift intelligence milestone:

> Prevent AI agents from writing boilerplate or parallel architecture because they did not understand the repo's existing conventions, helper locations, module placement rules, flow shape, and required checks.

This is not a plan to make Drift understand all TypeScript. The target is a narrow, verifiable agent guardrail:

```text
scan repo facts
  -> build graph evidence
  -> select relevant accepted contracts for a task/change
  -> brief the agent before edit
  -> check the change after edit
  -> explain findings with contract/evidence/fix
```

The work must be test-first. No contract kind is considered supported until it has:

- Core domain type and schema.
- Engine or query evidence model.
- SQLite persistence or deterministic derivation.
- CLI JSON output.
- MCP read-only output.
- Fixture tests.
- End-to-end proof.
- Documentation that distinguishes supported behavior from inferred or future behavior.

## Terminology

Use these terms consistently:

- **Contract**: A versioned machine-readable rule or agreement that can be selected, surfaced, and optionally enforced.
- **Convention**: A human-accepted repo rule that may become part of a repo contract.
- **Selection**: The process that chooses which contracts are relevant to a task or changed file set.
- **Exception**: A scoped exclusion on an accepted convention.
- **Waiver**: A scoped exclusion on the materialized repo contract.
- **Evidence**: Facts, graph nodes, graph edges, or diagnostics that support a selection or finding.
- **Finding**: A deterministic check result tied to a contract and evidence.
- **Agent packet**: The read-only preflight payload sent to an AI agent before it writes code.

## Current Baseline

Current supported surface:

- TypeScript and JavaScript file scanning.
- Syntax facts: files, imports, exports, calls, data-operation-shaped calls, file roles.
- Graph stream and graph projections.
- Import resolution for relative imports, aliases, workspace/package paths, package imports, index files, default exports, namespace diagnostics, and barrel re-exports.
- Path-based roles including `api_route`, `service_module`, `data_access_module`, CLI/core/query/storage/MCP/test/config roles.
- Deterministic `api_route_no_direct_data_access`.
- Heuristic `api_route_requires_service_delegation`.
- Accepted conventions, repo contracts, exceptions, waivers, required checks, safe commands.
- CLI and MCP read-only agent context.
- Agent contract schemas for file roles, module placement, import boundaries, entrypoint flow, canonical helper reuse, and required change checks.
- Shared agent contract selection and preflight packet output in CLI `prepare` and MCP `get_task_preflight`.
- Deterministic `check` findings for exact configured agent-contract violations:
  - forbidden imports on file-role contracts;
  - modules placed outside configured role paths;
  - forbidden imports across configured role boundaries;
  - missing required entrypoint calls/imports;
  - exact duplicate exported symbols listed in `avoid_new_symbols_matching`.
- Required checks contributed by `required_change_checks` agent contracts in preflight and `checks list`.
- Contract import/show/validate visibility for `agent_contracts`, including duplicate agent contract ID rejection.

Remaining production hardening:

- Standalone fixture directories under `test/fixtures/agent-contract-intelligence` are still recommended; the current proof uses generated temp fixtures in CLI/core/MCP tests.
- Helper reuse enforcement is exact-symbol/configured-pattern only. Broad fuzzy duplicate-helper detection is still deferred.
- Entrypoint flow enforcement currently covers configured required calls/imports. Deeper graph proof for service delegation and all forbidden steps should remain a later slice.
- Required checks are selected and surfaced; Drift does not yet prove that an external command was actually run.
- Missing-evidence diagnostics should be expanded for every agent-contract kind before wider production claims.

## 100 Percent Definition

This milestone is done when all target contracts below are defined and verified through the same proof ladder.

For each contract kind:

1. Core schema exists in `@drift/core`.
2. Contract import/validation rejects invalid shape.
3. Engine/query emits enough evidence to support selection and checks.
4. Storage persists or can deterministically derive the required state.
5. CLI exposes the contract in `prepare`, `check`, `contract show`, and relevant list/show commands.
6. MCP exposes the same read-only truth.
7. Fixture coverage proves pass, fail, missing evidence, exception, waiver, and unsupported states. Initial implementation may use generated temp fixtures; production hardening should add durable fixture directories.
8. Findings name contract ID, file, evidence, expected behavior, actual behavior, and suggested fix.
9. Capabilities output only claims the contract after all above are true.

## Target Contract Index

The target set is:

1. File Role Contract
2. Module Placement Contract
3. Import Boundary Contract
4. Entrypoint Flow Contract
5. Canonical Helper Reuse Contract
6. Required Change Checks Contract
7. Exception and Waiver Contract
8. Agent Contract Selection Contract
9. Agent Preflight Packet Contract
10. Finding Evidence Contract

## TDD Rules

- Write failing tests before implementation.
- Keep the first fixture tiny.
- Every contract must prove both "good passes" and "bad fails."
- Missing evidence must not become a confident finding.
- Candidate or inferred conventions must not block. Only accepted conventions block.
- MCP must not contain a second implementation of product logic.
- CLI and MCP outputs must share builders or parity tests.
- Capability claims must lag implementation, not lead it.

## Contract 1: File Role Contract

### Purpose

Classify files into repo roles so Drift can decide which conventions apply.

### Contract Shape

```ts
type FileRoleContract = {
  kind: "file_role";
  id: string;
  version: 1;
  roles: Array<{
    role:
      | "api_route"
      | "service_module"
      | "data_access_module"
      | "ui_component"
      | "hook_module"
      | "schema_module"
      | "test"
      | "config"
      | "cli_command_module"
      | "storage_module"
      | "query_module"
      | "mcp_module"
      | "custom";
    path_globs: string[];
    required_exports?: string[];
    forbidden_imports?: string[];
    confidence: "deterministic" | "heuristic";
  }>;
};
```

### Selection Rules

Select file role contracts when:

- A task references a path.
- A changed file matches a role glob.
- A graph node is reachable from a selected path.
- A contract applies to a role used by another selected contract.

### Tests First

- Core schema accepts valid roles and rejects unknown role strings.
- Engine fixture labels route/service/data access files.
- Query fixture returns role counts and per-file roles.
- CLI `repo map --json` includes role evidence.
- MCP `get_repo_map` matches CLI role output.
- Unknown role state is allowed as `custom` only when explicitly defined.

### Implementation Slices

- Extend `FileRole` domain type.
- Add user-defined role config to repo contract.
- Keep path-based defaults for current roles.
- Add role source metadata: `default_path_rule`, `contract_path_rule`, `engine_fact`.

### Done

Drift can answer:

```text
This file is an API route because it matches app/api/**/route.ts.
These contracts apply because they target api_route.
```

## Contract 2: Module Placement Contract

### Purpose

Tell an agent where new code belongs and detect when code is created in the wrong layer.

### Contract Shape

```ts
type ModulePlacementContract = {
  kind: "module_placement";
  id: string;
  version: 1;
  statement: string;
  target_role: FileRole;
  allowed_paths: string[];
  forbidden_paths?: string[];
  required_parent_roles?: FileRole[];
  forbidden_contained_roles?: FileRole[];
  examples?: {
    good: string[];
    bad: string[];
  };
};
```

### Selections

Select when:

- Task asks to add a route, service, helper, schema, repository, or component.
- Changed files include new files.
- New files contain role evidence that conflicts with path evidence.

### Conventions

Initial conventions:

- API route code belongs under `app/api/**/route.ts` or `pages/api/**`.
- Services belong under `services`, `domain`, or `*.service.ts`.
- Data access belongs under `db`, `database`, `repositories`, `repository`, or configured repo paths.
- Shared helpers belong under configured utility/helper modules, not inline inside routes.

### Tests First

- Fixture: new service in approved service path passes.
- Fixture: data access code inside route fails.
- Fixture: helper added inline in route warns or fails when canonical helper exists.
- Fixture: configured custom path passes.
- Fixture: missing role evidence produces "not enough evidence", not a confident failure.

### Implementation Slices

- Add `module_placement` schema.
- Add new-file detection from scan state and diff scope.
- Add check engine rule using path role plus contained role facts.
- Add `prepare` suggestions for target paths.

### Done

Drift can tell an agent:

```text
Create the new data-access function under src/repositories.
Do not put database access in app/api/users/route.ts.
```

## Contract 3: Import Boundary Contract

### Purpose

Prevent AI from bypassing existing layers through bad imports.

### Contract Shape

```ts
type ImportBoundaryContract = {
  kind: "import_boundary";
  id: string;
  version: 1;
  source_roles: FileRole[];
  forbidden_imports?: string[];
  forbidden_target_roles?: FileRole[];
  allowed_imports?: string[];
  allowed_delegate_imports?: string[];
  enforcement: "blocking" | "advisory";
};
```

### Current Mapping

Existing `api_route_no_direct_data_access` becomes a specific import boundary:

```text
source role: api_route
forbidden target role: data_access_module
forbidden imports: configured db/prisma/database modules
```

### Tests First

- Existing direct DB route still fails.
- Route importing service passes.
- Route importing data access through alias fails.
- Route importing data access through barrel fails.
- Type-only imports do not fail.
- Exception/waiver suppresses correctly.

### Implementation Slices

- Preserve current rule behavior.
- Add generic `import_boundary` contract while keeping old convention kind as compatibility alias.
- Route checks through engine-owned graph check.
- Surface target role evidence in findings.

### Done

Drift can say:

```text
API routes cannot import @/lib/prisma.
This import resolves to src/lib/db.ts, role data_access_module.
Use a service module instead.
```

## Contract 4: Entrypoint Flow Contract

### Purpose

Define required flow for entrypoint files so agents do not invent mini architectures.

### Contract Shape

```ts
type EntrypointFlowContract = {
  kind: "entrypoint_flow";
  id: string;
  version: 1;
  entry_roles: FileRole[];
  required_steps: Array<
    | { kind: "auth_helper"; imports?: string[]; calls?: string[] }
    | { kind: "validation_helper"; imports?: string[]; calls?: string[] }
    | { kind: "service_delegation"; target_roles?: FileRole[]; imports?: string[] }
    | { kind: "response_boundary"; calls?: string[] }
  >;
  forbidden_steps?: Array<
    | { kind: "direct_data_access" }
    | { kind: "inline_business_logic" }
  >;
  enforcement: "blocking" | "advisory";
};
```

### Initial Supported Flow

```text
api_route
  -> optional auth helper
  -> optional validation helper
  -> required service delegation
  -> no direct data access
```

### Tests First

- Good route with auth, validation, service delegation passes.
- Route missing required auth fails.
- Route missing service delegation fails when contract is blocking.
- Route directly using DB fails through import boundary.
- Route with waiver passes and reports waived finding.
- Route with unresolved imports downgrades to advisory or blocked-by-evidence, not a false finding.

### Implementation Slices

- Add graph edge kinds:
  - `entrypoint_calls_auth_helper`
  - `entrypoint_calls_validation_helper`
  - `entrypoint_delegates_to_service`
  - `entrypoint_reaches_data_access`
- Add engine diagnostics for ambiguous service boundary.
- Add configured helper imports/calls in contract matcher.
- Make `api_route_requires_service_delegation` deterministic only after graph proof exists.

### Done

Drift can brief:

```text
This route must call requireUser and delegate business logic to a service.
Do not inline data access or business orchestration in the route.
```

## Contract 5: Canonical Helper Reuse Contract

### Purpose

Stop AI from creating a new helper when the repo already has one.

### Contract Shape

```ts
type CanonicalHelperReuseContract = {
  kind: "canonical_helper_reuse";
  id: string;
  version: 1;
  canonical_helpers: Array<{
    helper_id: string;
    symbol: string;
    module: string;
    roles?: FileRole[];
    applies_to_roles?: FileRole[];
    purpose_tags: string[];
    avoid_new_symbols_matching?: string[];
    avoid_new_files_matching?: string[];
    suggested_import: string;
  }>;
  enforcement: "blocking" | "advisory";
};
```

### Selections

Select helper contracts when:

- Task text matches helper purpose tags.
- Changed file role matches `applies_to_roles`.
- New export name is similar to a canonical helper.
- New file path matches helper-ish patterns.
- A route/service uses inline logic that should call the helper.

### Conventions

Initial helper categories:

- auth helpers
- validation/schema helpers
- response helpers
- data access/repository helpers
- route/service orchestration helpers

### Tests First

- Existing canonical helper is indexed as exported symbol.
- Agent packet lists helper when task asks for auth.
- New duplicate helper `getCurrentUser` fails or warns when `requireUser` is canonical.
- New duplicate validation function fails or warns when schema helper exists.
- New unrelated helper does not false-positive.
- Finding includes canonical module and suggested import.

### Implementation Slices

- Emit exported symbol graph nodes for helper modules.
- Add simple similarity scoring:
  - token overlap
  - purpose tag match
  - role match
  - import dependency overlap
  - call shape overlap
- Keep enforcement advisory first.
- Promote to blocking only for exact configured `avoid_new_symbols_matching`.

### Done

Drift can say:

```text
Do not create getCurrentUser here.
Use requireUser from @/server/auth/require-user.
```

## Contract 6: Required Change Checks Contract

### Purpose

Tell agents and humans which commands prove a change.

### Contract Shape

```ts
type RequiredChangeChecksContract = {
  kind: "required_change_checks";
  id: string;
  version: 1;
  rules: Array<{
    applies_to: {
      path_globs?: string[];
      file_roles?: FileRole[];
      convention_kinds?: string[];
    };
    required_checks: Array<{
      command: string;
      reason: string;
      required_for_release?: boolean;
    }>;
  }>;
};
```

### Selections

Select when:

- Changed file path matches path globs.
- Changed file role matches file roles.
- A selected convention kind requires a check.
- The change touches a contract's evidence source.

### Tests First

- Route change selects `drift check`.
- Storage change selects storage tests.
- Engine change selects Rust tests.
- CLI change selects CLI tests.
- Required checks appear in CLI `prepare`.
- MCP `get_task_preflight` returns same required checks.
- Duplicate commands are deduped deterministically.

### Implementation Slices

- Normalize existing `required_checks` into this contract kind.
- Add role/path based selection.
- Add check evidence intake later; do not fake command execution proof.

### Done

Drift can tell an agent:

```text
Because you touched storage_module, run pnpm --filter @drift/storage test.
Because you touched api_route, run drift check --scope changed-files.
```

## Contract 7: Exception and Waiver Contract

### Purpose

Preserve intentional deviations so Drift does not fight the repo.

### Contract Shape

Existing exception/waiver shape remains, but must be supported for all new contract kinds:

```ts
type ContractSelector = {
  path_globs?: string[];
  symbols?: string[];
  imports?: string[];
  endpoint_paths?: string[];
  methods?: string[];
  resolved_modules?: string[];
  resolved_symbols?: string[];
  data_stores?: string[];
  operation_kinds?: string[];
  file_roles?: FileRole[];
  contract_kinds?: string[];
  expires_at?: string;
  reason: string;
};
```

### Tests First

- Exception suppresses helper finding by symbol.
- Waiver suppresses placement finding by path.
- Expired waiver does not suppress.
- Duplicate selectors are rejected.
- Exception/waiver changes write audit events.
- MCP reports active waiver context.

### Implementation Slices

- Add selectors for `file_roles` and `contract_kinds`.
- Keep all mutation paths confirmation-gated.
- Keep audit hash-chain verification.

### Done

Drift can distinguish:

```text
This file violates the normal placement rule, but an active waiver allows it until 2026-06-01.
```

## Contract 8: Agent Contract Selection Contract

### Purpose

Define exactly how Drift selects relevant contracts for an agent task or changed file set.

### Contract Shape

```ts
type AgentContractSelection = {
  schema_version: "drift.agent.contract_selection.v1";
  repo_id: string;
  scan_id: string;
  selected_contract_ids: string[];
  selected_convention_ids: string[];
  selected_helper_ids: string[];
  selected_required_checks: string[];
  selection_inputs: {
    task_text?: string;
    explicit_paths: string[];
    changed_paths: string[];
    file_roles: FileRole[];
    graph_node_ids: string[];
  };
  reasons: Array<{
    target_id: string;
    reason:
      | "path_match"
      | "role_match"
      | "task_text_match"
      | "graph_reachable"
      | "contract_dependency"
      | "active_waiver";
    evidence_refs: string[];
  }>;
};
```

### Selection Order

Selection must be deterministic:

1. Explicit path selection.
2. Changed path selection.
3. File role expansion.
4. Graph neighborhood expansion.
5. Task text helper tags.
6. Contract dependency expansion.
7. Waiver/exception overlay.

### Tests First

- Same inputs return same selection order.
- Explicit path selects role contracts and helper contracts.
- Task text "add auth to users route" selects auth helper contract.
- Changed route selects import boundary, entrypoint flow, required checks.
- Waiver appears in selected context but does not erase the underlying contract from the packet.

### Implementation Slices

- Build shared selector in `@drift/query` or equivalent shared domain package.
- CLI and MCP must call the same selector.
- Add parity tests between CLI `prepare --json` and MCP `get_task_preflight`.

### Done

Drift can explain:

```text
I selected this contract because the task references app/api/users/route.ts, which has role api_route.
```

## Contract 9: Agent Preflight Packet Contract

### Purpose

Define the exact read-only context an AI agent receives before editing.

### Contract Shape

```ts
type AgentPreflightPacket = {
  schema_version: "drift.agent.preflight.v3";
  repo_id: string;
  scan_id: string | null;
  stale: boolean;
  task: string;
  selected_contracts: unknown[];
  selected_conventions: unknown[];
  selected_helpers: Array<{
    symbol: string;
    module: string;
    suggested_import: string;
    purpose_tags: string[];
  }>;
  placement_guidance: Array<{
    role: FileRole;
    allowed_paths: string[];
    forbidden_paths: string[];
  }>;
  import_boundaries: unknown[];
  required_flows: unknown[];
  required_checks: Array<{
    command: string;
    reason: string;
  }>;
  active_exceptions: unknown[];
  active_waivers: unknown[];
  agent_instructions: string[];
  diagnostics: string[];
};
```

### Tests First

- Packet contains no source snippets by default.
- Packet includes canonical helper import guidance.
- Packet includes placement guidance.
- Packet includes required checks.
- Packet includes active waivers.
- Packet reports stale scan when applicable.
- CLI and MCP payloads are equivalent.

### Implementation Slices

- Move packet builder to shared query/domain module.
- Keep MCP as transport and argument validation.
- Add `response_schema` to packet.
- Add compact human text formatter for CLI only.

### Done

Drift can brief an AI agent:

```text
For this task, edit app/api/users/route.ts only as an entrypoint.
Use requireUser from @/server/auth/require-user.
Delegate business logic to @/services/users.
Do not import @/lib/prisma.
Run drift check and pnpm test:api.
```

## Contract 10: Finding Evidence Contract

### Purpose

Every failure must be explainable.

### Contract Shape

```ts
type ContractFinding = {
  schema_version: "drift.finding.v2";
  finding_id: string;
  contract_id: string;
  convention_id?: string;
  kind: string;
  severity: "info" | "warning" | "error";
  status: "blocking" | "advisory" | "waived" | "blocked_by_missing_evidence";
  file_path: string;
  range?: {
    start_line: number;
    end_line: number;
  };
  expected: string;
  actual: string;
  evidence_refs: string[];
  graph_path?: string[];
  suggested_fix: string;
  diagnostics: string[];
};
```

### Tests First

- Every blocking finding has evidence refs.
- Missing evidence returns `blocked_by_missing_evidence`.
- Helper duplicate finding includes canonical helper module.
- Placement finding includes expected role/path and actual role/path.
- Flow finding includes missing required step.
- Required check finding includes missing command.

### Implementation Slices

- Add v2 finding schema while preserving compatibility where needed.
- Add finding builders per contract kind.
- Add CLI/MCP parity tests.

### Done

No finding should force a human to ask "why did Drift say that?"

## Fixture Matrix

Add fixtures under `test/fixtures/agent-contract-intelligence`.

Required cases:

```text
good-route-service-db/
bad-route-direct-db/
bad-route-missing-auth/
bad-route-missing-service-delegation/
bad-duplicate-auth-helper/
bad-helper-in-wrong-module/
good-helper-reuse/
good-custom-placement/
good-active-waiver/
bad-expired-waiver/
bad-missing-required-check/
```

Each fixture must include:

- source files
- accepted contract JSON or setup script
- expected `prepare --json`
- expected `check --json`
- expected MCP parity payload if applicable

## Implementation Milestones

### Milestone 1: Schemas and Validation

Tests:

- Core schema tests for all contract kinds.
- Contract import validation tests.
- Capability output must not claim enforcement yet.

Implementation:

- Add domain types.
- Add Zod/schema validation.
- Add canonical JSON ordering.
- Add docs.

Exit:

- Contracts can be imported, shown, exported, validated, and rejected when malformed.

### Milestone 2: Selection Engine

Tests:

- Selection by path.
- Selection by file role.
- Selection by task text.
- Selection by changed files.
- Deterministic ordering.

Implementation:

- Shared selector module.
- CLI `prepare` integration.
- MCP `get_task_preflight` integration.

Exit:

- Drift selects the right contract set before enforcement is complete.

### Milestone 3: Canonical Helper Index

Tests:

- Exported helpers indexed.
- Helper selected by task tag.
- Duplicate exact symbol warning.
- Suggested import included.

Implementation:

- Helper graph projection.
- Helper registry in contract.
- Preflight helper suggestions.

Exit:

- Agent packet prevents obvious helper duplication.

### Milestone 4: Module Placement

Tests:

- Correct placement passes.
- Wrong role in wrong path fails.
- Custom configured path passes.
- Missing evidence does not false-positive.

Implementation:

- Placement matcher.
- Check implementation.
- Finding evidence.

Exit:

- Drift can say where new code belongs.

### Milestone 5: Entrypoint Flow

Tests:

- Auth helper required.
- Validation helper required.
- Service delegation required.
- Direct data access forbidden.
- Waiver works.

Implementation:

- Required flow contract.
- Graph edge checks.
- Deterministic service delegation enforcement when evidence is sufficient.

Exit:

- Drift can enforce route flow instead of only import boundaries.

### Milestone 6: Required Checks

Tests:

- Role to check mapping.
- Path to check mapping.
- Deduped command selection.
- CLI/MCP parity.

Implementation:

- Selection of `required_checks`.
- Packet and formatter updates.
- Optional check proof model as future work.

Exit:

- Agent knows what to run for the kind of change it is making.

### Milestone 7: End-to-End Agent Proof

Tests:

- Full fixture: task preflight tells agent where to edit, which helper to use, which import to avoid, and which checks to run.
- Bad AI-style change produces multiple explainable findings.
- Good change passes.
- MCP and CLI agree.

Exit:

- `pnpm verify:ci` includes the fixture matrix.
- `beta:proof` or a new `agent:proof` proves this full loop.

## Agent Implementation Prompt

Use this prompt when assigning implementation to an agent:

```text
You are implementing Drift agent contract intelligence test-first.

Do not broaden the product. The goal is to stop AI-generated boilerplate and parallel architecture in TypeScript repos by adding contract-backed preflight and check behavior for:

- file roles
- module placement
- import boundaries
- entrypoint flow
- canonical helper reuse
- required change checks
- exceptions and waivers
- deterministic contract selection
- evidence-complete findings

Rules:

1. Add failing tests before implementation.
2. Do not claim a capability until CLI, MCP, fixtures, and docs prove it.
3. Do not add MCP mutation tools.
4. Keep shared selection and packet logic outside MCP transport code.
5. Only accepted conventions/contracts can block.
6. Missing graph evidence must not become a confident finding.
7. Every blocking finding must include contract ID, file, evidence, expected behavior, actual behavior, and suggested fix.
8. Run targeted tests first, then pnpm verify:ci before reporting completion.

Start with schemas and selection. Then helper reuse. Then module placement. Then entrypoint flow. Then required checks. Finish with full fixture proof.
```

## Verification Commands

Expected commands as the work grows:

```bash
pnpm --filter @drift/core test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
cargo test -p drift-engine
pnpm vitest run test/e2e --no-file-parallelism --maxWorkers=1
pnpm verify:ci
```

Add targeted commands per milestone before broad verification.

## Release Claim Gate

Do not add public claims until this matrix is true:

| Claim | Required Proof |
| --- | --- |
| Drift understands where code belongs | Module placement fixture pass/fail plus agent packet guidance |
| Drift prevents duplicate helper boilerplate | Canonical helper fixture pass/fail plus suggested import |
| Drift understands route flow | Entrypoint flow fixture with auth/service/data evidence |
| Drift tells agents what checks to run | Required checks selected by changed files and roles |
| Drift can brief AI agents safely | CLI/MCP preflight parity and no source snippets by default |

Until then, capabilities should say these are experimental or unsupported.
