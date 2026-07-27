# Security Boundary Enforcement 100% TDD

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for every implementation step. Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this plan task-by-task. No production code may be written before a failing test proves the behavior being implemented.

**Goal:** Build Drift from current route/import/data-access convention enforcement into deterministic, contract-driven security boundary enforcement for auth, authorization, tenant scope, middleware coverage, validation, sensitive data, SSRF, SQL injection, CORS, CSRF, rate limits, and secret exposure.

**Architecture:** Rust remains the deterministic authority for parsing, proof construction, parser gaps, and blocking rule evaluation. TypeScript remains the product/control plane for schemas, storage, read models, CLI/MCP envelopes, governance, waivers, baselines, and output formatting. Every security claim must be evidence-backed, capability-scoped, and honest about deterministic proof versus heuristic inference.

**Tech Stack:** Rust tree-sitter engine, TypeScript workspace packages, SQLite projections, `@drift/core`, `@drift/factgraph`, `@drift/query`, `@drift/storage`, `@drift/engine-contract`, CLI/MCP packages, pnpm/vitest, cargo tests, fixture-driven e2e.

---

## Non-Negotiable Rules

- No production code before a failing test.
- Every behavior follows RED -> GREEN -> REFACTOR.
- Rust owns deterministic parser, graph/proof, parser-gap, and rule authority.
- TypeScript must not reimplement deterministic security truth.
- Blocking requires an accepted convention or accepted agent contract.
- Heuristic evidence may create candidates, briefings, or warnings. It must not create deterministic blocking findings.
- Missing proof is a first-class result. Parser gaps are first-class results. Neither may silently pass.
- No source snippets, request payloads, secret values, cookies, tokens, env values, raw SQL text containing values, or full file content may be emitted in CLI/MCP/storage outputs.
- Evidence must use fact IDs, graph node/edge IDs, line ranges, stable hashes, classifications, and normalized metadata.
- Existing Drift semantics for waivers, baselines, expired conventions, diff status, check runs, audit events, and policy egress must continue to work.
- Existing `api_route_no_direct_data_access` and `api_route_requires_service_delegation` behavior must not regress.
- TypeScript fallback is degraded and cannot satisfy deterministic security enforcement.
- If a rule cannot prove a property deterministically, it must emit `missing_proof` or `parser_gap` with the blocking decision dictated by the accepted contract.

## Current Baseline

Current supported Drift V3 surface:

- TypeScript/JavaScript scanning through the Rust engine.
- Syntax facts:
  - `file_detected`
  - `import_used`
  - `re_export_used`
  - `exported_symbol`
  - `symbol_called`
  - `data_operation_detected`
  - `route_declared`
  - `file_role_detected`
  - `test_declared`
- File roles:
  - `api_route`
  - `server_module`
  - `service_module`
  - `data_access_module`
  - `component`
  - `ui_component`
  - `hook_module`
  - `schema_module`
  - `test`
  - `config`
  - `cli_command_module`
  - `core_module`
  - `query_module`
  - `factgraph_module`
  - `adapter_module`
  - `storage_module`
  - `engine_bridge_module`
  - `mcp_module`
  - `docs`
  - `package_manifest`
  - `custom`
- Canonical roles already include `auth`, `validation`, `middleware`, `route`, `service`, and `data_access`.
- Enforcement capabilities:
  - `briefing_only`
  - `heuristic_check`
  - `deterministic_check`
- Enforcement modes:
  - `off`
  - `brief`
  - `warn`
  - `block`
- Check scopes:
  - `changed-hunks`
  - `changed-files`
  - `full`
- Finding lifecycle:
  - `new`
  - `pre_existing`
  - `needs_review`
  - `fixed`
  - `false_positive`
  - `accepted_drift`
  - `suppressed`
  - `expired`
- Engine-owned deterministic enforcement currently covers direct data-access import behavior and graph-backed route/data-access checks.
- `api_route_requires_auth_helper` exists in the domain surface but does not yet have complete deterministic enforcement.
- `entrypoint_flow` exists but currently proves configured call/import presence, not guard dominance across every route path.

## 100 Percent Definition

This security milestone is done only when every target contract below has the full proof ladder:

1. Core type and schema exist in `@drift/core`.
2. Engine contract validation exists in `@drift/engine-contract`.
3. Rust extracts the required facts or emits parser gaps.
4. Rust constructs deterministic proof or emits missing proof.
5. Rust evaluates blocking rules for deterministic contracts.
6. Fact graph carries evidence-backed nodes/edges, or the proof references raw facts directly when graph projection is not yet required.
7. SQLite persists enough state for findings, check runs, parser gaps, capability reports, and proof summaries when the proof shape is stable.
8. Query package exposes read models used by CLI and MCP.
9. CLI `check --json`, human check output, `scan status`, `repo map`, `contract validate`, and `candidates` expose the truth without snippets.
10. MCP exposes the same read-only truth without duplicating product logic.
11. Fixtures prove pass, fail, missing proof, parser gap, exception, waiver, baseline, and unsupported states.
12. Findings name contract ID, route/file, evidence, expected behavior, actual behavior, suggested fix, capability, proof status, and lifecycle state.
13. Capability output only claims support after the above are true.
14. `pnpm verify:ci`, Rust tests, package tests, and e2e fixtures pass.

## Information Flow To Preserve

```text
Rust extractor
  -> engine stream/protocol
  -> TypeScript scan collection
  -> fact graph / graph evidence
  -> SQLite evidence and lifecycle state
  -> query/read models
  -> contract/check enforcement
  -> CLI/MCP output
```

Required ownership:

- `crates/drift-engine/src/facts.rs`: base deterministic syntax fact extraction.
- `crates/drift-engine/src/security_facts.rs`: security fact extraction.
- `crates/drift-engine/src/security_control_flow.rs`: file-local control-flow summaries and guard dominance.
- `crates/drift-engine/src/security_proof.rs`: route-level proof construction and missing-proof generation.
- `crates/drift-engine/src/security_rules.rs`: deterministic security rule evaluation.
- `crates/drift-engine/src/security_capabilities.rs`: security capability completeness and parser-gap accounting.
- `crates/drift-engine/src/protocol.rs`: engine input/output contracts.
- `crates/drift-engine/src/check_command.rs`: engine-owned check dispatch.
- `packages/core/src/security.ts`: security domain types.
- `packages/core/src/schemas.ts`: Zod schemas.
- `packages/engine-contract/src/index.ts`: engine protocol validation.
- `packages/factgraph/src/security-graph.ts`: security graph projection when needed.
- `packages/storage/src/migrations.ts`: additive SQLite schema.
- `packages/storage/src/sqlite-storage.ts`: persistence methods.
- `packages/query/src/security-boundary-proof.ts`: read model for route-level security proof.
- `packages/cli/src/check/security-check.ts`: CLI orchestration and finding mapping, no deterministic rule authority.
- `packages/cli/src/domain/convention-candidates.ts`: candidate inference.
- `packages/mcp/src/security-context.ts`: read-only MCP summaries.

## Upstream And Downstream Product Integration Contract

No security addition is complete when it only exists as parser code or a Rust rule. Every feature must be wired through the product path below.

```text
Upstream product inputs
  -> candidate inference
  -> election / accepted convention or agent contract
  -> contract validation
  -> engine contract payload
  -> Rust extraction/proof/rule
  -> engine stream/check result
  -> TypeScript scan/check collection
  -> graph projection when needed
  -> SQLite state and lifecycle
  -> query/read model
  -> CLI human and JSON output
  -> MCP read-only context
  -> capability and support reporting
```

Required integration checklist for every new security contract:

- Upstream candidate:
  - `packages/cli/src/domain/convention-candidates.ts` can propose the contract from evidence.
  - Candidate output includes confidence, evidence refs, counterexamples, suggested mode, and reason it cannot block before acceptance.
- Election/contract:
  - `packages/core/src/domain.ts` and `packages/core/src/security.ts` define the contract.
  - `packages/core/src/schemas.ts` validates the contract and rejects invalid blocking heuristic contracts.
  - `contract import`, `contract show`, `contract validate`, and export/import preserve the contract.
- Engine contract:
  - `packages/engine-contract/src/index.ts` validates the engine payload.
  - `crates/drift-engine/src/protocol.rs` accepts the payload without losing schema/version information.
  - Accepted helpers, sensitive fields, serializers, sinks, policies, and exceptions reach Rust as explicit contract input.
- Rust authority:
  - Rust emits facts, proof, missing proof, parser gaps, and deterministic findings.
  - Rust does not use helper names or heuristics as blocking truth unless accepted by contract input.
- TypeScript bridge:
  - `packages/cli/src/engine/collect-scan-data.ts` parses new stream/check fields.
  - Degraded TypeScript fallback cannot satisfy deterministic security enforcement.
- Graph/evidence:
  - `packages/factgraph/src/security-graph.ts` projects graph evidence when a rule/read model needs graph traversal.
  - Graph evidence references fact IDs and line ranges, not snippets.
- Storage/lifecycle:
  - `packages/storage/src/migrations.ts` adds only additive schema after proof shape stabilizes.
  - `packages/storage/src/sqlite-storage.ts` round-trips proof summaries, parser gaps, capability reports, and finding metadata for every security contract that emits persisted check output.
  - Findings respect existing waiver, baseline, expired convention, accepted drift, suppression, diff status, and check-run behavior.
- Query/read model:
  - `packages/query/src/security-boundary-proof.ts` is the shared source for CLI/MCP proof summaries.
  - Query output is policy-safe and snippet-free.
- CLI:
  - `drift check --json` includes proof/finding/capability truth.
  - Human check output includes contract, route/file, reason, evidence lines, lifecycle, capability, and next command.
  - `drift scan status`, `drift repo map`, `drift contract validate`, and `drift candidates` expose the new security state.
- MCP:
  - MCP surfaces accepted security contracts, required proof obligations, current proof status, and missing-proof/parser-gap summaries.
  - MCP does not duplicate rule logic or expose source snippets/secrets.
- Capability/support:
  - Capability claims are updated only after tests prove the full path.
  - Unsupported framework/control-flow cases are represented as `unsupported`, `parser_gap`, or `missing_proof`.

Product integration tests required for every contract:

- Candidate-only path does not block.
- Accepted contract reaches Rust engine input.
- Rust result reaches `drift check --json`.
- Finding persists with lifecycle metadata.
- Waiver suppresses eligible finding.
- Baseline marks existing finding `pre_existing`.
- `scan status` reports capability status.
- `repo map` reports route security summary when applicable.
- MCP output matches CLI/query truth.
- Policy egress test proves no snippets or secrets are emitted.

## Engine Protocol Security Event Shapes

Security engine output must be versioned and normalized before TypeScript storage/query code consumes it. If the existing stream envelope can carry these records directly, reuse that envelope. If not, add a versioned union equivalent to:

```ts
type SecurityEngineEvent =
  | {
      event: "SecurityFact";
      schema_version: "engine.security.fact/v1";
      facts: SecurityFactRecord[];
    }
  | {
      event: "SecurityProof";
      schema_version: "engine.security.proof/v1";
      proofs: SecurityBoundaryProof[];
    }
  | {
      event: "SecurityFinding";
      schema_version: "engine.security.finding/v1";
      findings: SecurityFinding[];
    }
  | {
      event: "SecurityCapabilityReport";
      schema_version: "engine.security.capability-report/v1";
      capabilities: SecurityScanCapability[];
    }
  | {
      event: "SecurityParserGap";
      schema_version: "engine.security.parser-gap/v1";
      parser_gaps: SecurityParserGap[];
    };
```

Protocol requirements:

- `packages/cli/src/engine/collect-scan-data.ts` must reject unknown security schema versions unless a compatibility path is tested.
- Security protocol events must carry IDs, line ranges, normalized metadata, parser-gap IDs, missing-proof IDs, graph edge IDs, and contract IDs.
- Security protocol events must not carry source snippets, secret values, request payloads, cookie/header values, or raw SQL strings containing values.
- Rust protocol tests must prove the event schema is stable.
- TypeScript collection tests must prove every event reaches scan data without losing schema version, proof status, or enforcement metadata.

## Directory Structure And Single Responsibility

This implementation must keep files small and owned by one responsibility. Large orchestrators are allowed only when they delegate to focused modules and do not own parser/rule truth themselves.

```text
crates/drift-engine/src/
  security_facts.rs
    Extracts security-specific facts from AST nodes. No rule decisions.
  security_patterns.rs
    Normalizes accepted helper, sink, serializer, policy, and framework patterns from contract input. No AST walking.
  security_control_flow.rs
    Builds file-local route-handler control-flow summaries and guard dominance results. No contract lifecycle logic.
  security_proof.rs
    Builds SecurityBoundaryProof and missing-proof records from facts/control-flow/graph data. No CLI formatting.
  security_rules.rs
    Evaluates accepted deterministic security contracts and emits engine findings. No parsing.
  security_capabilities.rs
    Computes capability completeness, parser-gap counts, and block eligibility. No rule findings.
  facts.rs
    Existing general TypeScript syntax facts. May call security_facts but must not grow into a security monolith.
  main.rs
    Engine command/stream orchestration and graph stream assembly only.
  check_command.rs
    Check orchestration and dispatch to rule modules. It may route security checks but must not inline security rules.
  protocol.rs
    Engine request/response structs and versioned protocol fields only.

crates/drift-engine/tests/
  security_facts.rs
    Extractor tests.
  security_control_flow.rs
    Guard-before-sink and branch/callback tests.
  security_proof.rs
    Proof-shape and missing-proof tests.
  security_rules.rs
    Contract enforcement tests.

packages/core/src/
  security.ts
    Security domain types and shared string unions.
  domain.ts
    Existing cross-domain types. Only add references needed by the existing domain model.
  schemas.ts
    Zod schemas and validation. No business logic.

packages/engine-contract/src/
  index.ts
    Validates engine protocol and security contract payloads. No Drift rule decisions.

packages/factgraph/src/
  security-graph.ts
    Projects security facts/proofs into graph nodes/edges. No rule decisions.
  index.ts
    Existing graph entrypoint. May export security graph helpers but must not absorb their implementation.

packages/storage/src/
  migrations.ts
    Additive SQLite schema only.
  sqlite-storage.ts
    Persistence and retrieval methods only.

packages/query/src/
  security-boundary-proof.ts
    Read model combining stored proof, findings, parser gaps, baselines, waivers, and policy-safe output.
  index.ts
    Exports query APIs. No duplicated proof logic.

packages/cli/src/check/
  security-check.ts
    Maps engine security results into Drift findings and CLI envelopes. No deterministic proof/rule authority.
  run-check.ts
    Existing check orchestrator. Delegates to security-check.

packages/cli/src/domain/
  convention-candidates.ts
    Candidate/election suggestions. No blocking.

packages/mcp/src/
  security-context.ts
    MCP-safe security summaries from query package.
  tools.ts
    Tool registration and transport only.
```

Monolith guardrails:

- No new security file may own extraction, proof, rule evaluation, storage, and formatting together.
- `run-check.ts`, `main.rs`, and `check_command.rs` are orchestrators. They may dispatch, not implement all security logic inline.
- If any new file exceeds roughly one clear responsibility, split it before adding the next phase.
- If a later phase needs a broad helper, create a focused helper module next to the owner, not a shared dumping ground.

## Security Capability Index

Every capability has a deterministic/heuristic boundary, required evidence, block eligibility, and parser-gap/missing-proof behavior.

| Capability | Owner | Blocking Eligibility | Required Evidence | Missing-Proof / Parser-Gap Rule |
| --- | --- | --- | --- | --- |
| `security_facts` | Rust | Never directly blocks | AST facts, route facts, call/import facts, sink facts | Parser gap when source/framework cannot be parsed enough for downstream checks |
| `auth_boundary_facts` | Rust + accepted contracts | Blocks only through accepted auth contracts | trusted helper declarations, auth calls, route facts, sink facts | Missing proof when no accepted auth proof dominates protected sinks |
| `middleware_coverage` | Rust | Blocks only through accepted middleware contracts | middleware declaration, static matcher, route endpoint | Parser gap for dynamic matcher; missing proof for unmatched route |
| `request_validation_facts` | Rust | Blocks through accepted validation contracts | request input reads, validation calls, validated variable use | Missing proof when validation result cannot be tied to sink input |
| `response_shape_facts` | Rust | Blocks through accepted sensitive response contracts | response fields, serializers, sensitive field declarations | Missing proof for dynamic spread/unknown response shape |
| `sensitive_data_flow` | Rust v1 local only | Blocks direct local secret/sensitive flows | secret reads, response/log sinks, serializers | Missing proof for indirect/helper flow |
| `tenant_authorization_proof` | Rust v1 local only | Blocks through accepted tenant/role contracts | trusted subject, tenant source, guard/predicate, data operation | Missing proof when tenant identity does not bind to data predicate |
| `control_flow_guard_dominance` | Rust | Blocks all guard-before-sink contracts | guard facts, sink facts, branch scope, callback boundaries | Missing proof for unsupported dominance; parser gap for unsupported syntax |
| `csrf_rate_limit_cors_policy` | Rust + accepted config | Blocks through accepted policy contracts | CSRF/rate-limit calls or middleware, CORS declarations | Missing proof for assumed framework defaults |
| `ssrf_sink_detection` | Rust | Blocks direct untrusted URL to outbound request | request input, URL builder, outbound sink, allowlist/sanitizer | Parser gap for unresolved URL builder; missing proof for unknown sanitizer |
| `sql_injection_sink_detection` | Rust | Blocks raw SQL with untrusted input and no parameter proof | raw SQL call, input source, parameterization fact | Missing proof for unknown wrapper; parser gap for dynamic SQL shape |
| `secret_exposure_detection` | Rust | Blocks direct secret-to-response/log | secret read, response/log sink, local flow | Missing proof for indirect object spread/helper return |

Capability object shape:

```ts
type SecurityScanCapability = {
  name:
    | "security_facts"
    | "auth_boundary_facts"
    | "middleware_coverage"
    | "request_validation_facts"
    | "response_shape_facts"
    | "sensitive_data_flow"
    | "tenant_authorization_proof"
    | "control_flow_guard_dominance"
    | "csrf_rate_limit_cors_policy"
    | "ssrf_sink_detection"
    | "sql_injection_sink_detection"
    | "secret_exposure_detection";
  capability: "deterministic_check" | "heuristic_check" | "briefing_only";
  status: "complete" | "partial" | "unsupported" | "failed";
  applies_to: Array<"api_route" | "middleware" | "service_module" | "data_access_module">;
  evidence_fact_kinds: string[];
  graph_edge_kinds: string[];
  parser_gaps: Array<{ parser_gap_id: string; file_path: string; reason: string }>;
  missing_proof: Array<{ missing_proof_id: string; file_path: string; code: string }>;
  can_block: boolean;
  block_requires_accepted_convention: true;
};
```

## New Fact Kind Index

All new facts must fit the current fact record pattern:

```ts
type SecurityFactRecord = {
  kind: string;
  file_path: string;
  name: string;
  value?: string;
  imported_name?: string;
  start_line?: number;
  end_line?: number;
};
```

`value` may contain compact JSON metadata. It must not contain source snippets or secret values.

Line ranges are required for AST-derived source facts when the parser can provide them. Line ranges are optional for contract-derived, schema-derived, imported-contract, or graph/proof-derived facts. Implementations must not invent synthetic line numbers.

| Fact Kind | Owner | Blocking Confidence | Purpose |
| --- | --- | --- | --- |
| `auth_guard_declared` | TS contract normalization + Rust contract input | Deterministic only when accepted | Declares trusted auth helper symbols and behavior |
| `auth_guard_called` | Rust | Deterministic when call resolves to accepted helper | Route handler calls trusted auth helper |
| `authorization_guard_called` | Rust | Deterministic when helper accepted | Role/permission guard is called |
| `tenant_guard_called` | Rust | Deterministic when helper/predicate accepted | Tenant guard or predicate is applied |
| `middleware_declared` | Rust | Deterministic for supported frameworks | Middleware file/export exists |
| `middleware_matcher_declared` | Rust | Deterministic for static matchers | Middleware path/method matcher is known |
| `middleware_protects_route` | Rust proof | Deterministic when matcher covers endpoint | Middleware coverage protects route |
| `session_read` | Rust | Deterministic read, trust unknown until proof | Session/user/token object read |
| `session_trust_boundary` | Rust proof | Deterministic when derived from accepted guard/middleware | Session object is trusted/untrusted |
| `request_input_read` | Rust | Deterministic | Request body/query/params/headers/cookies/formData read |
| `request_validation_called` | Rust | Deterministic when helper/schema accepted | Request input validation called |
| `validated_input_used` | Rust proof | Deterministic for local flow | Validated result reaches sink |
| `csrf_guard_called` | Rust | Deterministic when helper accepted | CSRF protection invoked |
| `rate_limit_guard_called` | Rust | Deterministic when helper accepted | Rate limiter invoked |
| `cors_policy_declared` | Rust | Deterministic for static config | Route/middleware CORS policy |
| `outbound_request_called` | Rust | Deterministic for known APIs | `fetch`, `axios`, `http`, `https`, or configured outbound sink |
| `raw_sql_called` | Rust | Deterministic for known APIs | Raw SQL sink call |
| `parameterized_sql_used` | Rust | Deterministic for known safe APIs | Prepared/parameterized SQL proof |
| `secret_read` | Rust | Deterministic, redacted | Secret-like env/config/secret manager read |
| `response_emits_field` | Rust | Deterministic for static response shapes | Response field is emitted |
| `sensitive_field_declared` | TS contract + Rust schema extraction | Deterministic only when accepted | Field classified sensitive |
| `serializer_called` | Rust | Deterministic when serializer accepted | Response serializer/filter called |
| `route_returns_response` | Rust | Deterministic | Route returns/sends response |
| `branch_guard_scope` | Rust control-flow | Deterministic for supported branches | Guard/sink locations across branch scopes |
| `callback_boundary_detected` | Rust | Deterministic | Guard/sink is inside callback/closure boundary |
| `unsupported_dynamic_control_flow` | Rust | Deterministic parser gap fact | Dynamic flow blocks proof |

### Fact Value Shape Registry

Each fact `value` is compact JSON. Values must not include source snippets, secret values, request payloads, cookie/header values, or raw SQL strings containing values.

| Fact Kind | Evidence Level | Required `value` shape |
| --- | --- | --- |
| `auth_guard_declared` | `symbol_reference` | `{ "guard_id": string, "canonical_role": "auth", "source": "accepted_convention" \| "agent_contract" \| "candidate", "returns": "session" \| "user" \| "throws" \| "boolean" \| "unknown" }` |
| `auth_guard_called` | `symbol_reference` | `{ "guard_id": string, "route_id": string, "handler_symbol": string, "call_result_var"?: string, "behavior": "throws" \| "returns_user" \| "returns_session" \| "boolean" \| "unknown" }` |
| `authorization_guard_called` | `symbol_reference` | `{ "policy_id": string, "route_id": string, "roles"?: string[], "permissions"?: string[], "resource_var"?: string, "subject_var"?: string }` |
| `tenant_guard_called` | `data_flow_local` | `{ "route_id": string, "tenant_source": "session" \| "path_param" \| "header" \| "body" \| "query", "tenant_key": string, "data_subject"?: string, "predicate_var"?: string }` |
| `middleware_declared` | `route_binding` | `{ "framework": string, "export_kind": string, "methods"?: string[], "protects": "auth" \| "csrf" \| "rate_limit" \| "cors" \| "unknown" }` |
| `middleware_matcher_declared` | `route_binding` | `{ "framework": string, "path_patterns": string[], "methods"?: string[], "excludes"?: string[], "dynamic": boolean }` |
| `middleware_protects_route` | `graph_proof` | `{ "middleware_id": string, "route_id": string, "route_path"?: string, "method"?: string, "protection_kind": "auth" \| "csrf" \| "rate_limit" \| "cors" \| "unknown", "matcher_evidence_fact_ids": string[] }` |
| `session_read` | `line_range` | `{ "route_id": string, "source": "cookies" \| "headers" \| "request" \| "locals" \| "framework_session" \| "auth_result", "property_path"?: string, "trust": "unknown" \| "trusted" \| "untrusted" }` |
| `session_trust_boundary` | `graph_proof` | `{ "route_id": string, "session_var": string, "trust": "trusted" \| "untrusted", "derived_from": "auth_guard" \| "middleware" \| "request" \| "unknown", "guard_id"?: string, "middleware_id"?: string }` |
| `request_input_read` | `line_range` | `{ "route_id": string, "source": "body" \| "query" \| "params" \| "headers" \| "cookies" \| "formData", "key"?: string, "taint": "untrusted" }` |
| `request_validation_called` | `symbol_reference` | `{ "route_id": string, "validator_symbol": string, "schema_symbol"?: string, "input_var"?: string, "result_var"?: string, "behavior": "throws" \| "returns_parsed" \| "boolean" \| "unknown" }` |
| `validated_input_used` | `data_flow_local` | `{ "route_id": string, "source_input_var": string, "validated_var": string, "sink_kind": "data_operation" \| "response" \| "outbound_request" \| "raw_sql", "sink_fact_id": string }` |
| `csrf_guard_called` | `symbol_reference` | `{ "route_id": string, "method": string, "guard_id": string, "protection_kind": "csrf" }` |
| `rate_limit_guard_called` | `symbol_reference` | `{ "route_id": string, "limiter_id": string, "key_source": "ip" \| "user" \| "tenant" \| "route" \| "unknown", "scope": "ip" \| "user" \| "tenant" \| "route" }` |
| `cors_policy_declared` | `line_range` | `{ "route_id"?: string, "origins": string[] \| "dynamic", "methods"?: string[], "credentials"?: boolean, "headers"?: string[], "source": "middleware" \| "route" \| "config" }` |
| `outbound_request_called` | `line_range` | `{ "route_id": string, "api": "fetch" \| "axios" \| "http" \| "https" \| "request" \| "accepted_wrapper", "url_var"?: string, "url_source": "constant" \| "request_input" \| "validated_input" \| "unknown" }` |
| `raw_sql_called` | `line_range` | `{ "route_id"?: string, "sink_id": string, "query_shape": "raw_string" \| "template" \| "concat" \| "query_builder" \| "unknown", "uses_untrusted_input": boolean }` |
| `parameterized_sql_used` | `symbol_reference` | `{ "route_id"?: string, "sink_id": string, "parameterization": "placeholder_array" \| "tagged_template_safe" \| "prepared_statement" \| "query_builder" \| "accepted_safe_wrapper", "input_vars": string[] }` |
| `secret_read` | `line_range` | `{ "secret_class": "api_key" \| "token" \| "password" \| "private_key" \| "unknown", "env_key_hash"?: string, "source": "env" \| "config" \| "secret_manager" }` |
| `response_emits_field` | `line_range` | `{ "route_id": string, "response_id": string, "field_path": string, "source_var"?: string, "classification": "unknown" \| "sensitive" \| "public" }` |
| `sensitive_field_declared` | `symbol_reference` | `{ "field_path": string, "classification": "pii" \| "credential" \| "token" \| "tenant_secret" \| "internal", "source": "contract" \| "schema" \| "candidate" }` |
| `serializer_called` | `symbol_reference` | `{ "route_id": string, "serializer_id": string, "input_var"?: string, "output_var"?: string, "policy": "allowlist" \| "denylist" \| "unknown", "filtered_fields": string[] }` |
| `route_returns_response` | `line_range` | `{ "route_id": string, "handler_symbol"?: string, "response_id": string, "status"?: number, "response_kind": "json" \| "redirect" \| "stream" \| "text" \| "unknown", "source_var"?: string }` |
| `branch_guard_scope` | `control_flow` | `{ "route_id": string, "scope_id": string, "parent_scope_id"?: string, "branch_kind": "if" \| "else" \| "switch" \| "try" \| "catch" \| "finally" \| "loop", "guard_fact_ids": string[], "sink_fact_ids": string[], "exits": string[] }` |
| `callback_boundary_detected` | `control_flow` | `{ "route_id": string, "boundary_kind": "callback" \| "closure" \| "promise_then" \| "event_handler" \| "iterator", "contains_guard": boolean, "contains_sink": boolean }` |
| `unsupported_dynamic_control_flow` | `control_flow` | `{ "route_id": string, "reason": string, "affected_capabilities": string[], "blocks_enforcement": boolean }` |

## Fact Detection Contracts

These rules are binding. If the extractor cannot satisfy the "should detect" side deterministically, it must emit a parser gap or leave the fact absent. It must not create a blocking proof from the "must not claim" side.

| Fact Kind | Should Detect | Must Not Claim |
| --- | --- | --- |
| `auth_guard_declared` | Helper symbols explicitly accepted in repo contract, agent contract, or imported contract artifact | A function merely named `auth`, `session`, `user`, `protect`, or `guard` |
| `auth_guard_called` | Route handler calls an accepted helper symbol, including import alias when resolved | A call to an unaccepted helper; a helper call in an unreachable/dynamic callback as route-level proof |
| `authorization_guard_called` | Accepted role, permission, policy, or resource guard called with subject/resource evidence | String comparison or `if (user.role)` unless the repo contract accepts that shape |
| `tenant_guard_called` | Accepted tenant helper or explicit tenant equality predicate tied to trusted tenant source and data operation | A bare `tenantId` variable read without predicate or data binding |
| `middleware_declared` | Supported framework middleware file/export shape | Any function named middleware outside supported route/middleware framework shape |
| `middleware_matcher_declared` | Static path/method matcher or supported config matcher | Matcher built from runtime variables unless fully resolved |
| `middleware_protects_route` | Static middleware matcher covers route path/method and protection kind is accepted | Middleware file exists but route is excluded, method mismatched, or protection kind unknown |
| `session_read` | Reads from cookies, headers, request/session APIs, auth result variables, or framework session APIs | Trustworthiness; trust requires `session_trust_boundary` |
| `session_trust_boundary` | Session/user object derived from accepted auth helper or accepted middleware proof | Session/user from body/header/cookie as trusted without guard proof |
| `request_input_read` | Reads from body, query, params, headers, cookies, formData, text, json, search params | Constants, config, validated result variables, or auth-derived values |
| `request_validation_called` | Accepted validator/schema helper called on request input | Helper named `validate` but not accepted; validation result ignored as validated use |
| `validated_input_used` | Validated/parsed result variable reaches a sink instead of raw input | Raw input used after validation call but not from validation result |
| `csrf_guard_called` | Accepted CSRF helper or middleware coverage for mutation route | Auth helper, CORS config, or same-site assumption as CSRF proof |
| `rate_limit_guard_called` | Accepted limiter helper/middleware with route/user/IP/tenant key evidence | Metrics/logging counters or package import without call/coverage |
| `cors_policy_declared` | Static CORS policy origins/methods/headers/credentials in route/middleware/config | Dynamic callback origin policy as deterministic unless supported |
| `outbound_request_called` | Known outbound sink such as `fetch`, `axios`, `http`, `https`, or accepted wrapper | Internal function call that may or may not perform network I/O |
| `raw_sql_called` | Known raw query API, unsafe template SQL, concatenated SQL, or accepted raw wrapper | ORM query builder or parameterized API as raw SQL violation without unsafe shape |
| `parameterized_sql_used` | Placeholder array, prepared statement, known safe tagged template, accepted safe wrapper | String interpolation inside raw SQL |
| `secret_read` | Secret-like env/config/secret-manager read; store class/hash only | Actual secret value, full env key value, or non-sensitive config unless classified |
| `response_emits_field` | Static JSON/object response field, response variable field assignment, supported serializer output field | Dynamic spread fields as known-safe fields |
| `sensitive_field_declared` | Accepted sensitive field list, schema metadata, or accepted field classification | Heuristic sensitive candidate as blocking classification |
| `serializer_called` | Accepted serializer/filter helper called on response object before emission | Arbitrary mapper/transformer with unknown filtering semantics |
| `route_returns_response` | `return Response.json`, `NextResponse.json`, `res.json`, `res.send`, redirects, streams, text responses | Object creation not returned/sent |
| `branch_guard_scope` | Guard/sink positions in supported if/else/switch/try/catch/finally/return/throw shapes | General proof for loops/dynamic dispatch when not modeled |
| `callback_boundary_detected` | Guard/sink inside callback, closure, `.then`, `.catch`, iterator, event handler | Callback guard as dominating outer sink |
| `unsupported_dynamic_control_flow` | Dynamic import, computed handler export, unknown dispatch, unsupported loop/control shape affecting proof | Silent pass or confident violation without parser-gap evidence |

## Graph Model

Prefer extending existing graph kind strings conservatively. Current graph kinds are lowercase strings. Do not introduce PascalCase graph kind style.

New node kinds:

- `endpoint`
- `route_handler`
- `security_guard`
- `middleware`
- `request_input`
- `validated_input`
- `session_object`
- `response_sink`
- `response_field`
- `serializer`
- `outbound_request`
- `sql_sink`
- `secret`
- `cors_policy`
- `rate_limit_policy`
- `csrf_policy`
- `tenant_predicate`
- `parser_gap`

New edge kinds:

- `ROUTE_HAS_ENDPOINT`
- `ROUTE_HANDLED_BY_SYMBOL`
- `MIDDLEWARE_MATCHES_ENDPOINT`
- `MIDDLEWARE_PROTECTS_ENDPOINT`
- `ROUTE_REQUIRES_AUTH_GUARD`
- `HANDLER_CALLS_AUTH_GUARD`
- `AUTH_GUARD_DOMINATES_SINK`
- `HANDLER_READS_SESSION`
- `SESSION_OBJECT_DERIVED_FROM_TRUSTED_GUARD`
- `HANDLER_READS_REQUEST_INPUT`
- `INPUT_VALIDATED_BY_SCHEMA`
- `VALIDATED_INPUT_FLOWS_TO_DATA_OPERATION`
- `ROUTE_TOUCHES_DATA_STORE`
- `ROUTE_EMITS_RESPONSE_FIELD`
- `RESPONSE_FIELD_CLASSIFIED_SENSITIVE`
- `SERIALIZER_FILTERS_RESPONSE_FIELD`
- `OUTBOUND_REQUEST_USES_UNTRUSTED_URL`
- `RAW_SQL_USES_UNTRUSTED_INPUT`
- `SECRET_FLOWS_TO_RESPONSE_OR_LOG`

Graph rules:

- `AUTH_GUARD_DOMINATES_SINK` may only be emitted by Rust after control-flow proof.
- `MIDDLEWARE_PROTECTS_ENDPOINT` requires static matcher coverage and protection-kind evidence.
- `SESSION_OBJECT_DERIVED_FROM_TRUSTED_GUARD` requires accepted guard/middleware proof.
- Direct sink edges may be deterministic only for local, supported source-to-sink flows.
- Heuristic graph edges may exist for candidate generation, but blocking rules must ignore them unless the contract explicitly says the rule is advisory.

Route binding graph requirements:

Security graph projection must either reuse existing route/endpoint/handler graph nodes or emit the lower-case node kinds `endpoint` and `route_handler`.

`ROUTE_HAS_ENDPOINT` and `ROUTE_HANDLED_BY_SYMBOL` are required before any route-level security proof may be considered complete.

Rules:

- Node kinds are lower-case. Security proof edge kinds remain uppercase.
- `ROUTE_HAS_ENDPOINT` binds a stable `route_id` to normalized `{ path, method, framework }`.
- `ROUTE_HANDLED_BY_SYMBOL` binds a stable `route_id` to the handler symbol or export that Rust analyzed.
- Security proofs must reference the same `route_id` used by these edges.
- If either binding cannot be built for a matched route, emit parser gap `route_binding_unresolved` or `handler_unresolved` and do not emit route-level deterministic security proof.

## Security Contract Index

All contracts must preserve accepted-convention/election semantics. Candidate inference proposes contracts. Enforcement starts only after acceptance.

### Canonical Security Convention Shape

All new security contracts must use this shape. Legacy fields may be accepted only through explicit normalization tests.

```ts
type SecurityConvention = {
  contract_id: string;
  kind:
    | "api_route_requires_auth_helper"
    | "api_route_requires_authorization"
    | "api_route_requires_tenant_scope"
    | "api_route_requires_request_validation"
    | "api_route_requires_csrf_for_mutation"
    | "api_route_requires_rate_limit"
    | "api_route_cors_must_match_policy"
    | "api_route_forbids_sensitive_response_fields"
    | "api_route_forbids_untrusted_ssrf"
    | "api_route_forbids_raw_sql_without_params"
    | "api_route_forbids_secret_exposure"
    | "middleware_must_cover_routes"
    | "session_object_must_come_from_trusted_helper";

  capability: "deterministic_check" | "heuristic_check" | "briefing_only";
  enforcement_mode: "off" | "brief" | "warn" | "block";

  matcher: SecurityMatcher;
  scope: SecurityScope;

  requires?: Record<string, unknown>;
  forbids?: Record<string, unknown>;
  exceptions?: SecurityException[];

  governance?: {
    accepted_by?: string;
    accepted_at?: string;
    updated_at?: string;
    expires_at?: string;
    rationale?: string;
    evidence_refs?: string[];
    counterexample_refs?: string[];
  };
};
```

New security contracts must not use `severity`, `enforcement_capability`, `required_calls`, or `applies_to_file_roles`. If those legacy fields are supported, they must be covered by explicit compatibility tests that normalize them into `capability`, `requires.auth_helpers`, and `matcher.file_roles`.

Common matcher:

```ts
type SecurityMatcher = {
  file_roles?: Array<"api_route" | "server_module" | "service_module" | "data_access_module">;
  path_globs?: string[];
  route_paths?: string[];
  route_path_patterns?: string[];
  methods?: Array<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD">;
  frameworks?: string[];
  package_names?: string[];
  tags?: string[];
};
```

Common scope:

```ts
type SecurityScope = {
  check_scope: "changed-hunks" | "changed-files" | "full";
  diff_status?: Array<"added" | "modified" | "renamed">;
  applies_to: "route" | "handler" | "middleware" | "data_operation" | "response";
  include_pre_existing?: boolean;
};
```

Common exception:

```ts
type SecurityException = {
  reason:
    | "public_route"
    | "healthcheck"
    | "webhook_verified_elsewhere"
    | "framework_default_protection"
    | "accepted_drift"
    | "temporary_waiver"
    | "generated_code"
    | "test_fixture";
  route_paths?: string[];
  methods?: string[];
  file_path_globs?: string[];
  helper_symbols?: string[];
  middleware_symbols?: string[];
  requires_waiver_id?: string;
  expires_at?: string;
  evidence?: {
    fact_ids?: string[];
    graph_edge_ids?: string[];
    proof_ids?: string[];
  };
};
```

### Contract: `api_route_requires_auth_helper`

Purpose: Protected API routes must call an accepted auth helper or be protected by accepted middleware before data/response sinks.

Matcher:

```json
{
  "file_roles": ["api_route"],
  "path_globs": ["**/app/api/**/route.ts", "**/pages/api/**/*.ts"]
}
```

Requires:

```json
{
  "auth_helpers": ["requireUser", "requireSession"],
  "dominates": ["data_operation", "response"]
}
```

Blocks when:

- Matched route has no trusted auth proof.
- Auth guard is after a protected sink.
- Auth guard exists in one branch but another branch reaches a protected sink.
- Auth guard is inside callback/closure and does not dominate outer sink.
- Parser gap prevents proof and the accepted contract is blocking.

Advisory only when:

- Helper is inferred by name but not accepted.
- Framework default auth is assumed but not declared.

### Contract: `api_route_requires_authorization`

Purpose: Authenticated route must also enforce accepted role/permission policy for protected resource access.

Blocks when:

- Protected resource/data operation exists and no accepted authorization guard dominates it.
- Session/user used for role proof is not trusted.

### Contract: `api_route_requires_tenant_scope`

Purpose: Tenant identity must bind to data predicate for tenant-scoped data operations.

Blocks when:

- Tenant-scoped route touches datastore and no tenant predicate/guard reaches the data operation.
- Tenant param/session tenant is read but not used in data predicate.
- Tenant source is untrusted.

### Contract: `api_route_requires_request_validation`

Purpose: Request input must be validated before reaching sinks.

Blocks when:

- Body/query/params/header/cookie/form input reaches data operation, outbound request, raw SQL, or response without accepted validation.
- Validation is called but raw input is still used.

### Contract: `api_route_requires_csrf_for_mutation`

Purpose: Mutation routes require accepted CSRF proof when the contract says they are browser-exposed or cookie-authenticated.

Blocks when:

- `POST`, `PUT`, `PATCH`, or `DELETE` route lacks accepted CSRF guard or middleware proof.

### Contract: `api_route_requires_rate_limit`

Purpose: High-abuse routes require rate limiting.

Blocks when:

- Matched login/signup/password-reset/public-expensive route lacks accepted rate-limit guard or middleware proof.

### Contract: `api_route_cors_must_match_policy`

Purpose: CORS declarations must match accepted origin/method/credentials policy.

Blocks when:

- Static CORS policy violates accepted origin, method, header, or credentials rules.
- Credentials are enabled with wildcard origin.

### Contract: `api_route_forbids_sensitive_response_fields`

Purpose: Accepted sensitive fields must not be emitted raw.

Blocks when:

- Response emits an accepted sensitive field and no accepted serializer/filter proof applies.
- Dynamic spread hides response shape under a blocking contract, producing missing proof.

### Contract: `api_route_forbids_untrusted_ssrf`

Purpose: Untrusted request input must not control outbound URLs.

Blocks when:

- Request input reaches outbound URL without accepted allowlist/sanitizer proof.

### Contract: `api_route_forbids_raw_sql_without_params`

Purpose: Raw SQL must use parameterization or accepted safe wrapper.

Blocks when:

- Untrusted input reaches raw SQL and no parameterization proof exists.

### Contract: `api_route_forbids_secret_exposure`

Purpose: Secrets must not flow to response or logs.

Blocks when:

- Direct local proof shows secret read reaches response/log sink.

### Contract: `middleware_must_cover_routes`

Purpose: Required middleware must statically cover selected route paths/methods.

Blocks when:

- Required middleware matcher does not cover route.
- Middleware exists but matcher excludes route.

### Contract: `session_object_must_come_from_trusted_helper`

Purpose: Session/user objects used for authz/tenant decisions must derive from accepted guard/middleware, not request-controlled data.

Blocks when:

- Session/user object is used for role/tenant/data access and no trusted derivation proof exists.

## Contract Registry Matrix

Every contract below must ship with schema, contract validation, pass/fail fixtures, missing-proof behavior, parser-gap behavior where applicable, CLI output, MCP output, and lifecycle tests.

| Contract | Phase | Required Facts | Deterministic Pass | Deterministic Violation | Advisory Only |
| --- | --- | --- | --- | --- | --- |
| `api_route_requires_auth_helper` | 1 | `auth_guard_declared`, `auth_guard_called`, `route_returns_response`, `branch_guard_scope`, existing data ops | Accepted auth helper or accepted middleware dominates all protected sinks | No guard, guard after sink, one branch bypasses guard, callback-only guard, parser gap under blocking contract | Auth-like helper name without accepted contract |
| `middleware_must_cover_routes` | 2 | `middleware_declared`, `middleware_matcher_declared`, `middleware_protects_route`, `route_declared` | Static matcher covers route path/method and protection kind | Matcher misses path/method or middleware lacks accepted protection kind | Dynamic matcher candidate |
| `api_route_requires_request_validation` | 3 | `request_input_read`, `request_validation_called`, `validated_input_used` | Validated result reaches sink | Raw request input reaches sink, validation result ignored | Unaccepted validation-looking helper |
| `session_object_must_come_from_trusted_helper` | 4 | `session_read`, `session_trust_boundary`, auth/middleware proof | Session/user derives from accepted guard or middleware | Session/user from request/header/cookie is used for authz/tenant/data | Unknown framework session helper |
| `api_route_requires_authorization` | 4 | `authorization_guard_called`, trusted session proof, sink facts | Accepted role/policy guard dominates protected resource sink | Protected resource touched without accepted authorization guard | Inline role string comparison not accepted |
| `api_route_requires_tenant_scope` | 4 | `tenant_guard_called`, trusted tenant source, data operation facts | Tenant predicate/helper binds trusted tenant to data operation | Tenant route touches datastore without tenant predicate or uses untrusted tenant | Tenant variable present but query helper unresolved |
| `api_route_forbids_sensitive_response_fields` | 5 | `sensitive_field_declared`, `response_emits_field`, `serializer_called` | Accepted serializer filters accepted sensitive fields | Accepted sensitive field emitted without serializer/filter | Sensitive-looking field candidate only |
| `api_route_forbids_secret_exposure` | 5 | `secret_read`, response/log sink facts | No direct secret-to-response/log local flow | Secret read reaches response/log | Indirect helper return unresolved |
| `api_route_forbids_untrusted_ssrf` | 6 | `outbound_request_called`, `request_input_read`, validation/allowlist proof | Constant or accepted allowlisted/sanitized URL | Request-controlled URL reaches outbound sink | Unknown sanitizer/wrapper |
| `api_route_forbids_raw_sql_without_params` | 6 | `raw_sql_called`, `parameterized_sql_used`, request input facts | Prepared/parameterized query or accepted safe wrapper | Untrusted input reaches raw SQL without parameterization | Unknown data access wrapper |
| `api_route_cors_must_match_policy` | 6 | `cors_policy_declared` | Static policy matches accepted origins/methods/credentials | Wildcard credentials or disallowed origin/method/header | Dynamic origin callback |
| `api_route_requires_csrf_for_mutation` | 6 | `csrf_guard_called`, middleware proof | Mutation route has accepted CSRF guard/middleware | Mutation route lacks CSRF proof under contract | Framework default assumption |
| `api_route_requires_rate_limit` | 6 | `rate_limit_guard_called`, middleware proof | Matched route has accepted limiter guard/middleware | Matched route lacks rate limit proof | Package import without limiter call |

## Security Boundary Proof Shape

The proof is route-level and must be safe for CLI/MCP.

```ts
type SecurityBoundaryProof = {
  proof_id: string;
  proof_version: "security-boundary-proof/v1";
  route: {
    route_id: string;
    file_path: string;
    file_role: "api_route";
    endpoint?: { path?: string; method?: string; framework?: string };
    handler_symbol?: string;
    start_line?: number;
    end_line?: number;
    diff_status?: "unchanged" | "added" | "modified" | "deleted" | "renamed";
  };
  contracts: Array<{
    contract_id: string;
    kind: string;
    enforcement_mode: "off" | "brief" | "warn" | "block";
    capability: "briefing_only" | "heuristic_check" | "deterministic_check";
    matched: boolean;
    exception_applied?: { reason: string; waiver_id?: string; baseline_id?: string };
  }>;
  capability_status: Array<{
    name: string;
    status: "complete" | "partial" | "unsupported" | "failed";
    can_block: boolean;
    parser_gap_ids: string[];
    missing_proof_ids: string[];
  }>;
  public_or_protected: {
    status: "public" | "protected" | "unknown";
    decided_by: "contract_exception" | "auth_proof" | "middleware_proof" | "missing_proof" | "parser_gap";
    evidence_fact_ids: string[];
    graph_edge_ids: string[];
  };
  auth: {
    required: boolean;
    proven: boolean;
    proof_kind: "handler_guard" | "middleware_guard" | "both" | "none";
    trusted_guard_calls: Array<{
      fact_id: string;
      guard_id: string;
      symbol: string;
      start_line?: number;
      end_line?: number;
      result_var?: string;
    }>;
    dominated_sinks: Array<{
      sink_id: string;
      sink_kind: "data_operation" | "response" | "outbound_request" | "raw_sql" | "secret_log";
      edge_id: string;
    }>;
    undominated_sinks: Array<{
      sink_id: string;
      sink_kind: string;
      reason:
        | "guard_after_sink"
        | "guard_only_in_one_branch"
        | "callback_boundary"
        | "unsupported_dynamic_control_flow"
        | "no_guard_call";
      fact_ids: string[];
    }>;
  };
  middleware: {
    required: boolean;
    proven: boolean;
    matched_middleware: Array<{
      middleware_id: string;
      matcher_fact_id: string;
      protects_route_edge_id: string;
      protection_kind: "auth" | "csrf" | "rate_limit" | "cors" | "unknown";
    }>;
    mismatches: Array<{
      middleware_id?: string;
      reason: "path_not_matched" | "method_not_matched" | "dynamic_matcher" | "unknown_framework";
      parser_gap_id?: string;
    }>;
  };
  session_trust: {
    reads: Array<{ fact_id: string; var_name: string; source: string; trust: "trusted" | "untrusted" | "unknown" }>;
    trusted_derivations: Array<{ session_fact_id: string; guard_fact_id: string; edge_id: string }>;
    missing_trust: Array<{ session_fact_id: string; reason: "derived_from_request" | "unknown_helper" | "missing_auth_guard" | "parser_gap" }>;
  };
  request_validation: {
    required: boolean;
    proven: boolean;
    input_reads: Array<{ fact_id: string; source: "body" | "query" | "params" | "headers" | "cookies" | "formData"; key?: string }>;
    validations: Array<{ fact_id: string; schema_symbol?: string; validator_symbol: string; input_var?: string; result_var?: string }>;
    unvalidated_uses: Array<{
      input_fact_id: string;
      sink_fact_id: string;
      sink_kind: "data_operation" | "response" | "outbound_request" | "raw_sql";
      reason: "used_before_validation" | "validation_result_not_used" | "unknown_validator";
    }>;
  };
  authorization: {
    required: boolean;
    proven: boolean;
    role_or_policy_guards: Array<{ fact_id: string; policy_id?: string; roles?: string[]; permissions?: string[]; resource_var?: string }>;
    missing: Array<{ reason: "no_authorization_guard" | "guard_not_dominating_sink" | "unknown_policy_helper"; sink_fact_id?: string }>;
  };
  tenant: {
    required: boolean;
    proven: boolean;
    tenant_sources: Array<{ fact_id: string; source: "session" | "path_param" | "header" | "body" | "query"; key?: string; trusted: boolean }>;
    predicates: Array<{ fact_id: string; data_operation_fact_id: string; tenant_key: string; predicate_kind: "equality" | "scoped_helper" | "policy_helper" }>;
    missing: Array<{ data_operation_fact_id: string; reason: "no_tenant_predicate" | "untrusted_tenant_source" | "predicate_not_bound_to_query" | "parser_gap" }>;
  };
  response_shape: {
    responses: Array<{
      response_fact_id: string;
      response_kind: "json" | "redirect" | "stream" | "text" | "unknown";
      fields: Array<{ field_fact_id: string; field_path: string; classification: "public" | "sensitive" | "unknown" }>;
    }>;
    serializers: Array<{ serializer_fact_id: string; filters_sensitive_fields: boolean; edge_ids: string[] }>;
    sensitive_leaks: Array<{ field_fact_id: string; reason: "sensitive_field_without_serializer" | "secret_to_response" | "dynamic_spread_missing_proof" }>;
  };
  sinks: {
    data_operations: string[];
    response_sinks: string[];
    outbound_requests: Array<{ fact_id: string; url_source: "constant" | "request_input" | "validated_input" | "unknown"; ssrf_safe: boolean | "unknown" }>;
    raw_sql: Array<{ fact_id: string; parameterized: boolean | "unknown"; uses_untrusted_input: boolean }>;
    secrets: Array<{ fact_id: string; secret_class: string; exposed_to_response_or_log: boolean | "unknown" }>;
  };
  csrf_rate_limit_cors: {
    csrf: { required: boolean; proven: boolean; guard_fact_ids: string[] };
    rate_limit: { required: boolean; proven: boolean; guard_fact_ids: string[] };
    cors: {
      required: boolean;
      proven: boolean;
      policy_fact_ids: string[];
      violations: Array<{ fact_id: string; reason: "origin_not_allowed" | "credentials_not_allowed" | "method_not_allowed" | "dynamic_policy" }>;
    };
  };
  missing_proof: Array<{
    id: string;
    capability: string;
    code:
      | "missing_auth_guard"
      | "auth_guard_not_dominating_sink"
      | "authorization_guard_missing"
      | "authorization_guard_not_dominating_sink"
      | "middleware_not_covering_route"
      | "middleware_dynamic_matcher"
      | "session_not_trusted"
      | "request_input_not_validated"
      | "validation_result_not_used"
      | "tenant_predicate_missing"
      | "tenant_source_untrusted"
      | "tenant_predicate_not_bound_to_query"
      | "sensitive_response_field_unfiltered"
      | "dynamic_response_shape_missing_proof"
      | "untrusted_url_to_outbound_request"
      | "unknown_url_sanitizer"
      | "raw_sql_not_parameterized"
      | "unknown_sql_wrapper"
      | "secret_exposure_not_excluded"
      | "csrf_guard_missing"
      | "rate_limit_guard_missing"
      | "cors_policy_violation"
      | "dynamic_cors_policy"
      | "unsupported_callback_boundary"
      | "route_binding_unresolved"
      | "handler_unresolved";
    blocks_enforcement: boolean;
    fact_ids: string[];
    graph_edge_ids: string[];
  }>;
  parser_gaps: Array<{
    parser_gap_id: string;
    capability: string;
    code:
      | "route_binding_unresolved"
      | "handler_unresolved"
      | "unsupported_framework"
      | "unsupported_dynamic_control_flow"
      | "dynamic_import"
      | "computed_handler_export"
      | "dynamic_middleware_matcher"
      | "dynamic_response_shape"
      | "dynamic_sql_shape"
      | "unresolved_url_builder"
      | "unsupported_callback_boundary"
      | "unsupported_destructuring_or_spread"
      | "unknown_policy_engine";
    file_path: string;
    start_line?: number;
    end_line?: number;
    reason: string;
    affected_contract_kinds: string[];
    affected_route_ids: string[];
    missing_proof_ids: string[];
    blocks_enforcement: boolean;
  }>;
  result: {
    proof_status: "proven" | "violated" | "missing_proof" | "parser_gap" | "advisory_only";
    enforcement_result: "pass" | "brief" | "warn" | "block";
    can_block: boolean;
    finding_ids: string[];
  };
};
```

## Control-Flow Proof Strategy

Do not build a general compiler. Build conservative file-local route-handler dominance.

Supported v1 control-flow nodes:

- `entry`
- `statement`
- `if`
- `else`
- `switch`
- `try`
- `catch`
- `finally`
- `return`
- `throw`
- `loop`
- `callback_boundary`
- `unsupported`

Dominance rule:

```text
For every path from route handler entry to each protected sink,
a trusted guard must execute before the sink.
```

Protected sinks:

- `data_operation_detected`
- `route_returns_response`
- `outbound_request_called`
- `raw_sql_called`
- `secret_read` flowing to response/log
- any sink required by a matched accepted contract

Rules:

- Guard before `if` dominates both branches.
- Guard in every branch dominates subsequent sinks only if every non-terminating branch contains the guard.
- Guard in one branch does not dominate the other branch.
- Guard after sink is a violation.
- Guard inside callback does not dominate outer sink.
- Sink inside callback requires its own proof or missing proof.
- Guard inside `try` does not dominate `catch` or `finally`.
- Guard before `try` dominates `try`, `catch`, and `finally`.
- Early unauthenticated return is allowed only when the accepted contract lists allowed pre-auth response shapes.
- Unsupported dynamic flow emits `unsupported_dynamic_control_flow` and parser gap.

### Helper Call Expansion Limits

Slice 1 must not implement broad interprocedural analysis.

Allowed in v1:

- An accepted auth helper call counts as a guard without expanding the helper body.
- Import aliases may resolve to accepted helper symbols.
- A same-file wrapper may count only when all are true:
  - the wrapper is not exported as dynamic dispatch,
  - the wrapper body is simple and file-local,
  - the wrapper unconditionally calls an accepted auth helper,
  - the route handler calls the wrapper before the protected sink,
  - no callback boundary or unsupported control flow exists between wrapper entry and helper call.

Not allowed in v1:

- Inter-file helper expansion.
- Dynamic dispatch.
- Runtime-computed helper names.
- Callback-contained helper calls as dominance for outer sinks.
- Multi-hop alias chains beyond import alias plus one same-file simple alias.

If a route delegates to a security-looking helper that is not accepted or not v1-expandable, emit `missing_proof` with `code: "missing_auth_guard"` or `code: "auth_guard_not_dominating_sink"` as appropriate. Do not guess.

## Phase Gates

Every phase must complete this exact loop:

1. Write failing Rust test or fixture.
2. Run focused Rust test and verify expected failure.
3. Implement minimal Rust code.
4. Run focused Rust test and verify pass.
5. Write failing TypeScript schema/query/storage/CLI test.
6. Run focused TypeScript test and verify expected failure.
7. Implement minimal TypeScript code.
8. Run focused TypeScript test and verify pass.
9. Run fixture e2e for the phase.
10. Run package-level tests touched by the phase.
11. Run `pnpm verify:ci`.
12. Commit only the phase work.

If any step reveals broader architecture work, stop scope expansion and represent the unhandled case as `missing_proof`, `parser_gap`, `unsupported`, or future work.

## Production-Grade Acceptance Bar

This plan is not complete because code compiles. Each phase is production-grade only when all of these are true:

- The supported behavior is named in core/domain schema, engine contract schema, CLI output, MCP output, and capability reports.
- The unsupported behavior is also named and returns `missing_proof`, `parser_gap`, `unsupported`, or advisory output.
- Blocking behavior is impossible without accepted contract input.
- Heuristic candidate behavior is impossible to confuse with deterministic enforcement.
- Failing tests were observed before implementation.
- Focused tests and full verification pass after implementation.
- Existing direct data-access, service delegation, waiver, baseline, diff status, policy egress, check-run, backup/restore, and MCP read-only behavior remain intact.
- New outputs contain line ranges and IDs, not source snippets or secret values.
- Every new finding has stable fingerprint inputs that avoid raw line-number-only churn.
- Every new migration is additive, tested from empty DB and existing DB, and does not rewrite existing findings or check runs.
- Every new file has one owner and does not become a parser/rule/storage/formatting monolith.
- Every phase updates capability truth after implementation, not before.

## Autonomous Task Ledger

The autonomous worker must execute this ledger in order. A task is not complete until the RED command failed for the expected reason, the GREEN command passed, and the phase verification command passed.

### Phase 0 Task Ledger: Baseline Lock

- [ ] **Task 0.1: Record current branch and dirty state**

  Run:

  ```bash
  git status --short --branch
  ```

  Expected: command succeeds. Dirty files may exist, but the worker must not revert unrelated user work.

- [ ] **Task 0.2: Run existing Rust engine tests**

  Run:

  ```bash
  cargo test -p drift-engine
  ```

  Expected: pass. If it fails, fix current-regression behavior before adding security work.

- [ ] **Task 0.3: Run existing package tests for check/query/storage/CLI**

  Run:

  ```bash
  pnpm --filter @drift/cli test
  pnpm --filter @drift/query test
  pnpm --filter @drift/storage test
  ```

  Expected: pass.

- [ ] **Task 0.4: Run full repo gate**

  Run:

  ```bash
  pnpm verify:ci
  ```

  Expected: pass before Phase 1 starts.

### Phase 1 Task Ledger: Auth Helper Dominance

- [ ] **Task 1.1: RED Rust fact extraction for accepted auth call**

  Add a focused test in `crates/drift-engine/tests/security_facts.rs` proving an API route that imports and calls `requireUser` emits `auth_guard_called`.

  Run:

  ```bash
  cargo test -p drift-engine extracts_auth_guard_called_fact -- --nocapture
  ```

  Expected RED: fails because `security_facts.rs` or `auth_guard_called` does not exist.

- [ ] **Task 1.2: GREEN minimal `security_facts.rs`**

  Implement only enough Rust extraction to emit `auth_guard_called` when the called symbol is present in accepted helper contract input.

  Run:

  ```bash
  cargo test -p drift-engine extracts_auth_guard_called_fact -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 1.3: RED Rust response sink extraction**

  Add a test proving `return Response.json(...)`, `NextResponse.json(...)`, and `res.json(...)` emit `route_returns_response`.

  Run:

  ```bash
  cargo test -p drift-engine extracts_route_returns_response_fact -- --nocapture
  ```

  Expected RED: fails because response sink extraction is missing.

- [ ] **Task 1.4: GREEN response sink extraction**

  Implement minimal response sink detection. Do not infer response fields yet.

  Run:

  ```bash
  cargo test -p drift-engine extracts_route_returns_response_fact -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 1.5: RED control-flow guard-before-sink pass**

  Add `crates/drift-engine/tests/security_control_flow.rs` test where `requireUser()` appears before a data operation and response. The proof must mark auth proven.

  Run:

  ```bash
  cargo test -p drift-engine auth_guard_before_all_sinks_passes -- --nocapture
  ```

  Expected RED: fails because control-flow proof is missing.

- [ ] **Task 1.6: GREEN file-local dominance proof**

  Implement `security_control_flow.rs` and `security_proof.rs` with straight-line guard-before-sink support.

  Run:

  ```bash
  cargo test -p drift-engine auth_guard_before_all_sinks_passes -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 1.7: RED auth-after-data violation**

  Add test where data operation occurs before `requireUser()`.

  Run:

  ```bash
  cargo test -p drift-engine auth_after_data_operation_blocks -- --nocapture
  ```

  Expected RED: fails because `guard_after_sink` is not emitted.

- [ ] **Task 1.8: GREEN auth-after-data violation**

  Emit missing proof/finding reason `guard_after_sink`.

  Run:

  ```bash
  cargo test -p drift-engine auth_after_data_operation_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 1.9: RED branch bypass violation**

  Add test where one branch calls `requireUser()` and the other branch reaches a sink.

  Run:

  ```bash
  cargo test -p drift-engine auth_in_one_branch_does_not_dominate_other_branch -- --nocapture
  ```

  Expected RED: fails because branch dominance is not implemented.

- [ ] **Task 1.10: GREEN branch bypass violation**

  Implement if/else path summaries and reason `guard_only_in_one_branch`.

  Run:

  ```bash
  cargo test -p drift-engine auth_in_one_branch_does_not_dominate_other_branch -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 1.11: RED callback boundary missing proof**

  Add test where auth happens inside callback/closure and an outer sink is reachable.

  Run:

  ```bash
  cargo test -p drift-engine callback_auth_does_not_dominate_outer_sink -- --nocapture
  ```

  Expected RED: fails because callback boundary is not detected.

- [ ] **Task 1.12: GREEN callback boundary missing proof**

  Emit `callback_boundary_detected` and missing proof reason `callback_boundary`.

  Run:

  ```bash
  cargo test -p drift-engine callback_auth_does_not_dominate_outer_sink -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 1.13: RED accepted contract enforcement**

  Add Rust rule test where accepted `api_route_requires_auth_helper` with `enforcement_mode=block` blocks missing auth.

  Run:

  ```bash
  cargo test -p drift-engine accepted_auth_helper_contract_blocks_missing_auth -- --nocapture
  ```

  Expected RED: fails because `security_rules.rs` is not wired.

- [ ] **Task 1.14: GREEN accepted contract enforcement**

  Implement `security_rules.rs` and wire through `check_command.rs`. Do not add TypeScript fallback rule logic.

  Run:

  ```bash
  cargo test -p drift-engine accepted_auth_helper_contract_blocks_missing_auth -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 1.15: RED no accepted contract means no block**

  Add Rust rule test where an auth-looking helper exists but no accepted contract exists. It must not block.

  Run:

  ```bash
  cargo test -p drift-engine auth_like_helper_without_accepted_contract_does_not_block -- --nocapture
  ```

  Expected RED: fails if implementation blocks by helper name.

- [ ] **Task 1.16: GREEN no accepted contract means no block**

  Ensure blocking requires accepted convention/agent contract.

  Run:

  ```bash
  cargo test -p drift-engine auth_like_helper_without_accepted_contract_does_not_block -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 1.17: RED TypeScript schemas**

  Add `packages/core/test/security.test.ts` and `packages/engine-contract/test/security-contract.test.ts` for `SecurityBoundaryProof`, auth contract schema, and missing-proof code.

  Run:

  ```bash
  pnpm --filter @drift/core test -- security
  pnpm --filter @drift/engine-contract test -- security
  ```

  Expected RED: fail because schemas/types do not exist.

- [ ] **Task 1.18: GREEN TypeScript schemas**

  Add `packages/core/src/security.ts`, schema exports, and engine contract validation.

  Run:

  ```bash
  pnpm --filter @drift/core test -- security
  pnpm --filter @drift/engine-contract test -- security
  ```

  Expected GREEN: pass.

- [ ] **Task 1.19: RED query read model**

  Add `packages/query/test/security-boundary-proof.test.ts` proving proof + findings + parser gaps are rendered without snippets.

  Run:

  ```bash
  pnpm --filter @drift/query test -- security-boundary-proof
  ```

  Expected RED: fail because read model does not exist.

- [ ] **Task 1.20: GREEN query read model**

  Implement `packages/query/src/security-boundary-proof.ts`.

  Run:

  ```bash
  pnpm --filter @drift/query test -- security-boundary-proof
  ```

  Expected GREEN: pass.

- [ ] **Task 1.21: RED CLI check integration**

  Add `packages/cli/test/security-check.test.ts` proving `drift check --json` includes security proof and blocks only new changed-scope findings.

  Run:

  ```bash
  pnpm --filter @drift/cli test -- security-check
  ```

  Expected RED: fail because CLI bridge is missing.

- [ ] **Task 1.22: GREEN CLI check integration**

  Implement `packages/cli/src/check/security-check.ts` and delegate from `run-check.ts`.

  Run:

  ```bash
  pnpm --filter @drift/cli test -- security-check
  ```

  Expected GREEN: pass.

- [ ] **Task 1.23: RED e2e fixtures**

  Add fixtures for missing auth, auth-before-sink, auth-after-data, branch bypass, callback bypass, and dynamic control-flow parser gap.

  Run:

  ```bash
  pnpm test:e2e -- security-auth
  ```

  Expected RED: fail until fixtures and CLI path are wired.

- [ ] **Task 1.24: GREEN e2e fixtures**

  Wire fixtures and expected outputs.

  Run:

  ```bash
  pnpm test:e2e -- security-auth
  ```

  Expected GREEN: pass.

- [ ] **Task 1.25: Phase 1 full gate**

  Run:

  ```bash
  cargo test -p drift-engine security_
  pnpm --filter @drift/core test
  pnpm --filter @drift/engine-contract test
  pnpm --filter @drift/query test
  pnpm --filter @drift/cli test
  pnpm test:e2e
  pnpm verify:ci
  ```

  Expected: all pass.

### Phase 2 Through Phase 8 Task Pattern

For each later phase, repeat the same ledger shape:

- [ ] **RED extractor/proof test for the new facts**
- [ ] **GREEN minimal Rust extraction/proof**
- [ ] **RED deterministic rule test for accepted blocking contract**
- [ ] **GREEN Rust rule implementation**
- [ ] **RED no accepted contract / candidate-only test**
- [ ] **GREEN election boundary**
- [ ] **RED TypeScript schema test**
- [ ] **GREEN TypeScript schema**
- [ ] **RED query/storage/CLI/MCP test for output**
- [ ] **GREEN query/storage/CLI/MCP implementation**
- [ ] **RED e2e fixture test**
- [ ] **GREEN e2e fixture**
- [ ] **Full phase gate with `pnpm verify:ci`**

The phase-specific facts, contracts, fixtures, and RED behaviors are listed in each phase below. The worker must not skip any ledger category.

Before an autonomous worker starts any phase after Phase 1, that phase must be expanded into the same task granularity as Phase 1:

- exact test file
- exact test name
- exact focused command
- expected RED failure reason
- exact implementation files
- expected GREEN command
- fixture names
- fixture command
- full phase gate

The generic Phase 2 through Phase 8 pattern is a planning template, not an executable no-human-check-in ledger.

## Phase 0: Baseline Lock

Purpose: prove existing behavior before security expansion.

Files:

- Test: `crates/drift-engine/tests/graph_backed_check.rs`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`

Tests first:

- Existing direct data access violation still blocks.
- Existing service delegation behavior is unchanged.
- TS fallback does not satisfy deterministic enforcement.
- Waivers still suppress eligible findings.
- Baselines still mark findings `pre_existing`.
- Diff status still limits blocking to new changed scope.

Commands:

```bash
cargo test -p drift-engine
pnpm --filter @drift/cli test
pnpm --filter @drift/query test
pnpm --filter @drift/storage test
pnpm verify:ci
```

Done when:

- Current tests pass before new security work starts.
- Any existing failure is documented and fixed before Phase 1.

## Phase 1: Deterministic Auth Helper Enforcement

Purpose: make `api_route_requires_auth_helper` real.

Create:

- `crates/drift-engine/src/security_facts.rs`
- `crates/drift-engine/src/security_patterns.rs`
- `crates/drift-engine/src/security_control_flow.rs`
- `crates/drift-engine/src/security_proof.rs`
- `crates/drift-engine/src/security_rules.rs`
- `crates/drift-engine/src/security_capabilities.rs`
- `crates/drift-engine/tests/security_facts.rs`
- `crates/drift-engine/tests/security_control_flow.rs`
- `crates/drift-engine/tests/security_rules.rs`
- `packages/core/src/security.ts`
- `packages/query/src/security-boundary-proof.ts`
- `packages/cli/src/check/security-check.ts`
- `packages/cli/test/security-check.test.ts`
- `packages/query/test/security-boundary-proof.test.ts`
- `test/fixtures/security-auth-missing/package.json`
- `test/fixtures/security-auth-before-sink/package.json`
- `test/fixtures/security-auth-after-data/package.json`
- `test/fixtures/security-auth-branch-bypass/package.json`
- `test/fixtures/security-auth-callback-bypass/package.json`
- `test/fixtures/security-dynamic-control-flow/package.json`

Modify:

- `crates/drift-engine/src/lib.rs`
- `crates/drift-engine/src/facts.rs`
- `crates/drift-engine/src/main.rs`
- `crates/drift-engine/src/protocol.rs`
- `crates/drift-engine/src/check_command.rs`
- `packages/core/src/domain.ts`
- `packages/core/src/schemas.ts`
- `packages/engine-contract/src/index.ts`
- `packages/cli/src/check/run-check.ts`
- `packages/cli/src/engine/collect-scan-data.ts`
- `packages/storage/src/migrations.ts` only after proof shape is stable
- `packages/storage/src/sqlite-storage.ts` only after proof shape is stable

Initial fact set:

- `auth_guard_declared`
- `auth_guard_called`
- `route_returns_response`
- `branch_guard_scope`
- `callback_boundary_detected`
- `unsupported_dynamic_control_flow`

Reuse:

- `route_declared`
- `file_role_detected`
- `symbol_called`
- `data_operation_detected`
- `import_used`

Required RED tests:

- Missing accepted auth helper blocks protected route.
- Accepted auth helper before all sinks passes.
- Auth helper after data operation blocks.
- Auth helper in one branch but sink in bypass branch blocks.
- Auth helper inside callback does not dominate outer sink.
- Unsupported dynamic control flow emits parser gap and blocks under accepted blocking contract.
- Auth-looking helper name without accepted contract does not block and may create candidate/warning only.

Minimum accepted contract:

```json
{
  "contract_id": "security_api_auth_require_user",
  "kind": "api_route_requires_auth_helper",
  "capability": "deterministic_check",
  "enforcement_mode": "block",
  "matcher": {
    "file_roles": ["api_route"],
    "path_globs": ["**/app/api/**/route.ts", "**/pages/api/**/*.ts"],
    "methods": ["GET", "POST", "PUT", "PATCH", "DELETE"]
  },
  "scope": {
    "check_scope": "changed-files",
    "applies_to": "route",
    "diff_status": ["added", "modified", "renamed"],
    "include_pre_existing": false
  },
  "requires": {
    "auth_helpers": ["requireUser"],
    "dominates": ["data_operation", "response"],
    "allow_pre_auth_returns": [
      { "status": 400, "response_shape": "no_sensitive_fields" },
      { "status": 404, "response_shape": "no_sensitive_fields" },
      { "status": 405, "response_shape": "no_sensitive_fields" }
    ]
  },
  "exceptions": [],
  "governance": {
    "accepted_by": "test",
    "accepted_at": "2026-05-25T00:00:00.000Z",
    "rationale": "API routes require accepted auth helper dominance"
  }
}
```

Expected finding:

```json
{
  "title": "API route missing required auth proof",
  "expected_layer": "auth_guard",
  "actual_layer": "missing_auth_guard",
  "enforcement_result": "block",
  "drift_category": "missing_proof",
  "confidence_label": "certain"
}
```

Done when:

- Phase 1 tests pass.
- Existing direct-data-access tests pass.
- `api_route_requires_auth_helper` cannot block without accepted contract.
- `SecurityBoundaryProof.auth` is present in `drift check --json`.
- `security_capabilities.rs` reports at least `security_facts`, `auth_boundary_facts`, and `control_flow_guard_dominance` with honest `complete`, `partial`, or `unsupported` status for Phase 1 fixtures.
- No source snippets appear in proof output.

## Phase 2: Middleware Coverage

Purpose: prove middleware protects selected routes.

Add facts:

- `middleware_declared`
- `middleware_matcher_declared`
- `middleware_protects_route`

Add contracts:

- `middleware_must_cover_routes`
- `api_route_requires_auth_helper` may accept middleware proof only through `middleware_protects_route`

Create fixtures:

- `test/fixtures/security-middleware-covered`
- `test/fixtures/security-middleware-mismatch`
- `test/fixtures/security-middleware-method-mismatch`
- `test/fixtures/security-middleware-dynamic-parser-gap`

Required RED tests:

- Static matcher covers route and passes.
- Path mismatch blocks.
- Method mismatch blocks.
- Middleware file exists but matcher excludes route blocks.
- Dynamic matcher emits parser gap.

### Phase 2 Executable Task Ledger

Execute these tasks in order. For every RED task, run the focused command and
record the expected failure before editing implementation files.

- [ ] **Task 2.1: RED middleware fact extraction**

  Test file: `crates/drift-engine/tests/security_facts.rs`

  Test name: `extracts_static_middleware_matcher_fact`

  Add a fixture source containing a Next middleware file with a static
  `config.matcher` and an accepted auth helper call.

  Run:

  ```bash
  cargo test -p drift-engine extracts_static_middleware_matcher_fact -- --nocapture
  ```

  Expected RED: fail because Rust does not emit `middleware_declared` or
  `middleware_matcher_declared`.

- [ ] **Task 2.2: GREEN middleware fact extraction**

  Implementation files:

  - `crates/drift-engine/src/security_facts.rs`
  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/facts.rs`
  - `crates/drift-engine/src/main.rs`

  Implement only static middleware declaration and matcher extraction.

  Run:

  ```bash
  cargo test -p drift-engine extracts_static_middleware_matcher_fact -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 2.3: RED middleware coverage proof for matching route**

  Test file: `crates/drift-engine/tests/security_control_flow.rs`

  Test name: `static_middleware_matcher_protects_route`

  Run:

  ```bash
  cargo test -p drift-engine static_middleware_matcher_protects_route -- --nocapture
  ```

  Expected RED: fail because no file-local or repo-local proof creates
  `middleware_protects_route`.

- [ ] **Task 2.4: GREEN middleware coverage proof**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`

  Implement deterministic static matcher coverage only. Do not infer coverage
  from middleware existence.

  Run:

  ```bash
  cargo test -p drift-engine static_middleware_matcher_protects_route -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 2.5: RED path mismatch blocks**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `middleware_path_mismatch_blocks_covered_route_contract`

  Run:

  ```bash
  cargo test -p drift-engine middleware_path_mismatch_blocks_covered_route_contract -- --nocapture
  ```

  Expected RED: fail because `middleware_must_cover_routes` is not evaluated.

- [ ] **Task 2.6: GREEN path mismatch rule**

  Implementation files:

  - `crates/drift-engine/src/security_rules.rs`
  - `crates/drift-engine/src/check_command.rs`

  Implement deterministic blocking only for accepted
  `middleware_must_cover_routes` contracts.

  Run:

  ```bash
  cargo test -p drift-engine middleware_path_mismatch_blocks_covered_route_contract -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 2.7: RED method mismatch blocks**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `middleware_method_mismatch_blocks_when_contract_requires_method`

  Run:

  ```bash
  cargo test -p drift-engine middleware_method_mismatch_blocks_when_contract_requires_method -- --nocapture
  ```

  Expected RED: fail because middleware method constraints are not normalized
  or enforced.

- [ ] **Task 2.8: GREEN method mismatch rule**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_rules.rs`
  - `crates/drift-engine/src/check_command.rs`

  Normalize static method constraints and block only when the accepted contract
  requires method-aware coverage.

  Run:

  ```bash
  cargo test -p drift-engine middleware_method_mismatch_blocks_when_contract_requires_method -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 2.9: RED excluded route blocks**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `middleware_excludes_matched_route_blocks`

  Run:

  ```bash
  cargo test -p drift-engine middleware_excludes_matched_route_blocks -- --nocapture
  ```

  Expected RED: fail because excluded matcher branches are not represented as
  missing proof.

- [ ] **Task 2.10: GREEN excluded route rule**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Represent excluded route coverage as `missing_proof`; do not silently pass.

  Run:

  ```bash
  cargo test -p drift-engine middleware_excludes_matched_route_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 2.11: RED dynamic matcher parser gap**

  Test file: `crates/drift-engine/tests/security_control_flow.rs`

  Test name: `dynamic_middleware_matcher_emits_parser_gap_and_blocks`

  Run:

  ```bash
  cargo test -p drift-engine dynamic_middleware_matcher_emits_parser_gap_and_blocks -- --nocapture
  ```

  Expected RED: fail because unsupported dynamic middleware matcher evidence
  is not emitted as a parser gap.

- [ ] **Task 2.12: GREEN dynamic matcher parser gap**

  Implementation files:

  - `crates/drift-engine/src/security_facts.rs`
  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_capabilities.rs`

  Emit parser gap `unsupported_dynamic_middleware_matcher` and block only
  under an accepted blocking contract.

  Run:

  ```bash
  cargo test -p drift-engine dynamic_middleware_matcher_emits_parser_gap_and_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 2.13: RED auth contract accepts middleware proof only when proven**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `auth_contract_accepts_static_middleware_proof_but_not_middleware_existence`

  Run:

  ```bash
  cargo test -p drift-engine auth_contract_accepts_static_middleware_proof_but_not_middleware_existence -- --nocapture
  ```

  Expected RED: fail because `api_route_requires_auth_helper` does not yet
  consume `middleware_protects_route` proof.

- [ ] **Task 2.14: GREEN auth plus middleware proof**

  Implementation files:

  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`
  - `crates/drift-engine/src/check_command.rs`

  Allow middleware proof to satisfy auth only when coverage is deterministic
  and accepted by contract input.

  Run:

  ```bash
  cargo test -p drift-engine auth_contract_accepts_static_middleware_proof_but_not_middleware_existence -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 2.15: RED candidate-only middleware cannot block**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `candidate_only_middleware_evidence_does_not_block`

  Run:

  ```bash
  cargo test -p drift-engine candidate_only_middleware_evidence_does_not_block -- --nocapture
  ```

  Expected RED: fail because candidate-only middleware evidence is not
  separated from accepted deterministic contracts.

- [ ] **Task 2.16: GREEN candidate-only middleware boundary**

  Implementation files:

  - `crates/drift-engine/src/security_rules.rs`
  - `packages/cli/src/domain/convention-candidates.ts`

  Ensure inferred middleware evidence can propose candidates but cannot produce
  blocking findings without an accepted deterministic contract.

  Run:

  ```bash
  cargo test -p drift-engine candidate_only_middleware_evidence_does_not_block -- --nocapture
  pnpm --filter @drift/cli test -- convention-candidates
  ```

  Expected GREEN: pass.

- [ ] **Task 2.17: RED TypeScript schemas and engine contract**

  Test files:

  - `packages/core/test/security.test.ts`
  - `packages/engine-contract/test/security-contract.test.ts`

  Test names:

  - `validates middleware_must_cover_routes contracts and parser gaps`
  - `validates middleware SecurityBoundaryProof fields from engine output`

  Run:

  ```bash
  pnpm --filter @drift/core test -- security
  pnpm --filter @drift/engine-contract test -- security-contract
  ```

  Expected RED: fail because middleware contract kinds, proof fields, fact
  kinds, and parser-gap codes are not in TypeScript schemas.

- [ ] **Task 2.18: GREEN TypeScript schemas and engine contract**

  Implementation files:

  - `packages/core/src/security.ts`
  - `packages/core/src/domain.ts`
  - `packages/core/src/schemas.ts`
  - `packages/engine-contract/src/index.ts`
  - `crates/drift-engine/src/protocol.rs`

  Add only normalized middleware contract/proof/event fields. Do not add rule
  evaluation logic in TypeScript.

  Run:

  ```bash
  pnpm --filter @drift/core test -- security
  pnpm --filter @drift/engine-contract test -- security-contract
  ```

  Expected GREEN: pass.

- [ ] **Task 2.19: RED query, scan status, and repo map output**

  Test files:

  - `packages/query/test/security-boundary-proof.test.ts`
  - `packages/cli/test/security-check.test.ts`
  - `packages/cli/test/cli.test.ts`

  Test names:

  - `summarizes middleware coverage proof without snippets`
  - `returns middleware coverage proof in drift check JSON output`
  - `scan status reports middleware_coverage capability`
  - `repo map reports route middleware coverage summary`

  Run:

  ```bash
  pnpm --filter @drift/query test -- security-boundary-proof
  pnpm --filter @drift/cli test -- security-check
  pnpm --filter @drift/cli test -- "scan status reports middleware_coverage"
  pnpm --filter @drift/cli test -- "repo map reports route middleware coverage"
  ```

  Expected RED: fail because query/read models and CLI output do not expose
  middleware coverage truth.

- [ ] **Task 2.20: GREEN query, scan status, and repo map output**

  Implementation files:

  - `packages/query/src/security-boundary-proof.ts`
  - `packages/cli/src/check/security-check.ts`
  - `packages/cli/src/check/run-check.ts`
  - `packages/cli/src/domain/scan-status.ts`
  - `packages/cli/src/commands/scan.ts`
  - `packages/cli/src/commands/repo-map.ts`

  Wire read models and output formatting only. Do not duplicate deterministic
  middleware coverage logic in TypeScript.

  Run:

  ```bash
  pnpm --filter @drift/query test -- security-boundary-proof
  pnpm --filter @drift/cli test -- security-check
  pnpm --filter @drift/cli test -- "scan status reports middleware_coverage"
  pnpm --filter @drift/cli test -- "repo map reports route middleware coverage"
  ```

  Expected GREEN: pass.

- [ ] **Task 2.21: RED MCP middleware coverage output**

  Test file: `packages/mcp/test/mcp.test.ts`

  Test name: `exposes middleware coverage proof summaries without snippets`

  Run:

  ```bash
  pnpm --filter @drift/mcp test -- middleware
  ```

  Expected RED: fail because MCP read-only context does not include middleware
  proof summaries.

- [ ] **Task 2.22: GREEN MCP middleware coverage output**

  Implementation files:

  - `packages/mcp/src/security-context.ts`
  - `packages/mcp/src/index.ts`
  - `packages/query/src/security-boundary-proof.ts`

  Expose accepted contracts, proof status, missing proof, and parser gaps
  without snippets or duplicated rule logic.

  Run:

  ```bash
  pnpm --filter @drift/mcp test -- middleware
  ```

  Expected GREEN: pass.

- [ ] **Task 2.23: RED e2e middleware fixture matrix**

  Fixture names:

  - `test/fixtures/security-middleware-covered`
  - `test/fixtures/security-middleware-mismatch`
  - `test/fixtures/security-middleware-method-mismatch`
  - `test/fixtures/security-middleware-dynamic-parser-gap`

  Test file: `test/e2e/security-middleware.test.ts`

  Test name: `security middleware fixture matrix proves coverage and gaps`

  Run:

  ```bash
  pnpm test:e2e -- security-middleware
  ```

  Expected RED: fail because fixtures and end-to-end middleware expectations
  do not exist.

- [ ] **Task 2.24: GREEN e2e middleware fixture matrix**

  Implementation files:

  - `test/e2e/security-middleware.test.ts`
  - `test/fixtures/security-middleware-covered/package.json`
  - `test/fixtures/security-middleware-covered/middleware.ts`
  - `test/fixtures/security-middleware-covered/app/api/projects/route.ts`
  - `test/fixtures/security-middleware-mismatch/package.json`
  - `test/fixtures/security-middleware-mismatch/middleware.ts`
  - `test/fixtures/security-middleware-mismatch/app/api/projects/route.ts`
  - `test/fixtures/security-middleware-method-mismatch/package.json`
  - `test/fixtures/security-middleware-method-mismatch/middleware.ts`
  - `test/fixtures/security-middleware-method-mismatch/app/api/projects/route.ts`
  - `test/fixtures/security-middleware-dynamic-parser-gap/package.json`
  - `test/fixtures/security-middleware-dynamic-parser-gap/middleware.ts`
  - `test/fixtures/security-middleware-dynamic-parser-gap/app/api/projects/route.ts`

  Run:

  ```bash
  pnpm test:e2e -- security-middleware
  ```

  Expected GREEN: pass.

- [ ] **Task 2.25: Phase 2 full gate**

  Run:

  ```bash
  cargo test -p drift-engine security_
  cargo test -p drift-engine
  pnpm --filter @drift/core test
  pnpm --filter @drift/engine-contract test
  pnpm --filter @drift/query test
  pnpm --filter @drift/cli test
  pnpm --filter @drift/mcp test
  pnpm test:e2e
  pnpm verify:ci
  ```

  Expected: all pass.

Done when:

- Middleware coverage is deterministic only for supported static matcher formats.
- Middleware existence alone cannot satisfy auth.
- `drift scan status --json` reports `middleware_coverage`.

## Phase 3: Request Validation Before Sink

Purpose: prove request input is validated before use.

Add facts:

- `request_input_read`
- `request_validation_called`
- `validated_input_used`

Add contract:

- `api_route_requires_request_validation`

Create fixtures:

- `test/fixtures/security-validation-missing`
- `test/fixtures/security-validation-result-unused`
- `test/fixtures/security-validation-before-data`
- `test/fixtures/security-validation-dynamic-body-parser-gap`

Required RED tests:

- Request body/query/params reaches data operation without validation and blocks.
- Validator called but raw input used and blocks.
- Validated parsed result used and passes.
- Unknown validator is missing proof.
- Unsupported destructuring/spread emits parser gap or missing proof.

### Phase 3 Non-Negotiable Scope

Phase 3 implements request-input validation only. Do not implement or change:

- SSRF enforcement.
- SQL injection enforcement.
- Tenant, role, IDOR, or session trust enforcement.
- Sensitive response or secret exposure enforcement.
- CORS, CSRF, or rate limit enforcement.
- Candidate election UX beyond preventing validation candidates from blocking.

The only accepted contract kind added in this phase is:

- `api_route_requires_request_validation`

The only new facts added in this phase are:

- `request_input_read`
- `request_validation_called`
- `validated_input_used`

The only new proof section added in this phase is:

- `SecurityBoundaryProof.request_validation`

Do not add monolithic validation files. Keep responsibilities split:

- `security_facts.rs`: extract request-input reads, validation calls, and validated-result use facts only.
- `security_patterns.rs`: accepted validator/schema/helper normalization only.
- `security_control_flow.rs`: local variable/source-to-sink summaries only.
- `security_proof.rs`: validation proof, parser-gap, and missing-proof construction only.
- `security_rules.rs`: deterministic accepted-contract evaluation only.
- `security_capabilities.rs`: capability truth only.
- `check_command.rs`: engine request/response wiring only.
- `security-check.ts`: CLI orchestration/output mapping only, no deterministic validation logic.
- `security-boundary-proof.ts`: query/read model only.
- `security-context.ts`: MCP read model only.

### Phase 3 Deterministic Model

Supported request input reads:

- `await request.json()`
- `await request.formData()`
- `await request.text()`
- `request.nextUrl.searchParams.get("key")`
- `new URL(request.url).searchParams.get("key")`
- `request.headers.get("key")`
- `cookies().get("key")`
- Next route context params through `params.id`, `context.params.id`, or destructured `{ params }`.

Supported accepted validators:

- Accepted schema methods: `schema.parse(input)`, `schema.safeParse(input)`.
- Accepted helper calls configured by contract: `validateProjectInput(input)`.
- Accepted imported aliases of configured validators or schemas.

Supported validated result use:

- Throwing validators: the original input variable is considered validated after an accepted throwing parse/helper dominates the sink.
- Parsed-result validators: only the returned parsed variable is trusted.
- `safeParse`: only the `.data` value is trusted after a local `success` guard dominates the sink.

Unsupported shapes must not silently pass:

- Object spread from raw request input into sink payload.
- Dynamic property access on request input, for example `body[field]`.
- Aliasing through arrays/maps/callbacks before validation.
- Validation inside a callback when the outer sink uses request input.
- Unknown validation helpers or helpers accepted only as candidates.

Unsupported deterministic shapes must emit `parser_gaps` or `missing_proof` evidence. They must never satisfy validation.

### Phase 3 Accepted Contract Shape

Minimum accepted deterministic contract:

```json
{
  "contract_id": "security_api_request_validation",
  "kind": "api_route_requires_request_validation",
  "capability": "deterministic_check",
  "enforcement_mode": "block",
  "matcher": {
    "file_roles": ["api_route"],
    "path_globs": ["**/app/api/**/route.ts", "**/pages/api/**/*.ts"],
    "methods": ["POST", "PUT", "PATCH", "DELETE"]
  },
  "requires": {
    "input_sources": ["body", "query", "params", "headers", "cookies", "formData"],
    "sinks": ["data_operation", "response"],
    "validators": ["validateProjectInput"],
    "schemas": ["ProjectInputSchema"],
    "allow_throwing_parse": true,
    "allow_safe_parse_success_guard": true
  },
  "exceptions": [],
  "governance": {
    "accepted_by": "test",
    "accepted_at": "2026-05-25T00:00:00.000Z",
    "rationale": "API request input must be validated before reaching protected sinks"
  }
}
```

Accepted contract behavior:

- Blocking is allowed only when `enforcement_capability` is `deterministic_check`.
- `enforcement_mode="off"` produces no findings.
- Candidate-only validators cannot block.
- A helper named `validate*` cannot satisfy proof unless it is accepted by contract.
- A schema named `*Schema` cannot satisfy proof unless it is accepted by contract.
- A validation call does not pass unless the validated variable or dominated original input reaches the sink.

Expected blocking finding:

```json
{
  "title": "API route uses unvalidated request input",
  "expected_layer": "request_validation",
  "actual_layer": "request_input_not_validated",
  "enforcement_result": "block",
  "drift_category": "missing_proof",
  "confidence_label": "certain"
}
```

Expected ignored/candidate-only behavior:

```json
{
  "security_findings": [],
  "summary": {
    "security_blocking_count": 0
  }
}
```

Expected proof shape:

```json
{
  "request_validation": {
    "required": true,
    "proven": false,
    "input_reads": [
      {
        "fact_id": "fact:app/api/projects/route.ts:request_input_read:3",
        "source": "body",
        "variable": "body",
        "key": null
      }
    ],
    "validations": [],
    "validated_uses": [],
    "unvalidated_uses": [
      {
        "sink_id": "sink:app/api/projects/route.ts:6:db.project.create",
        "input_fact_id": "fact:app/api/projects/route.ts:request_input_read:3",
        "reason": "request_input_not_validated"
      }
    ]
  },
  "missing_proof": [
    {
      "code": "request_input_not_validated",
      "blocks_enforcement": true
    }
  ],
  "parser_gaps": []
}
```

### Phase 3 Executable Task Ledger

Execute these tasks in order. For every RED task, add only the failing test first,
run the focused command, and record the exact expected failure before editing
implementation files.

- [ ] **Task 3.1: RED request input fact extraction**

  Test file: `crates/drift-engine/tests/security_facts.rs`

  Test name: `extracts_request_input_read_facts`

  Add source fixtures covering `await request.json()`,
  `request.nextUrl.searchParams.get("projectId")`, and `params.projectId`.

  Run:

  ```bash
  cargo test -p drift-engine extracts_request_input_read_facts -- --nocapture
  ```

  Expected RED: fail because Rust does not emit `request_input_read`.

- [ ] **Task 3.2: GREEN request input fact extraction**

  Implementation files:

  - `crates/drift-engine/src/facts.rs`
  - `crates/drift-engine/src/security_facts.rs`
  - `crates/drift-engine/src/main.rs`

  Implement extraction only. Do not evaluate validation rules.

  Run:

  ```bash
  cargo test -p drift-engine extracts_request_input_read_facts -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.3: RED accepted validator call facts**

  Test file: `crates/drift-engine/tests/security_facts.rs`

  Test name: `extracts_request_validation_called_for_accepted_schema_and_helper`

  Add source fixtures for:

  - `ProjectInputSchema.parse(body)`
  - `ProjectInputSchema.safeParse(body)`
  - `validateProjectInput(body)`
  - imported alias of `validateProjectInput`

  Run:

  ```bash
  cargo test -p drift-engine extracts_request_validation_called_for_accepted_schema_and_helper -- --nocapture
  ```

  Expected RED: fail because accepted validation helpers/schemas are not
  normalized and no `request_validation_called` fact is emitted.

- [ ] **Task 3.4: GREEN accepted validator call facts**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_facts.rs`

  Add accepted validator/schema normalization. Emit facts only for accepted
  validators supplied by test/contract input.

  Run:

  ```bash
  cargo test -p drift-engine extracts_request_validation_called_for_accepted_schema_and_helper -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.5: RED validated result use facts**

  Test file: `crates/drift-engine/tests/security_facts.rs`

  Test name: `extracts_validated_input_used_when_parsed_result_reaches_sink`

  Add fixtures where:

  - `const input = ProjectInputSchema.parse(body);`
  - `await db.project.create({ data: input });`
  - raw `body` is not used at the sink.

  Run:

  ```bash
  cargo test -p drift-engine extracts_validated_input_used_when_parsed_result_reaches_sink -- --nocapture
  ```

  Expected RED: fail because Rust does not emit `validated_input_used`.

- [ ] **Task 3.6: GREEN validated result use facts**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_facts.rs`

  Implement simple local variable tracking from accepted validation result to
  data operation or response sink.

  Run:

  ```bash
  cargo test -p drift-engine extracts_validated_input_used_when_parsed_result_reaches_sink -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.7: RED missing validation blocks**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `request_body_reaches_data_operation_without_validation_blocks`

  Run:

  ```bash
  cargo test -p drift-engine request_body_reaches_data_operation_without_validation_blocks -- --nocapture
  ```

  Expected RED: fail because `api_route_requires_request_validation` is not
  evaluated.

- [ ] **Task 3.8: GREEN missing validation rule**

  Implementation files:

  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`
  - `crates/drift-engine/src/check_command.rs`

  Build validation proof and emit blocking finding only for accepted
  deterministic contracts.

  Run:

  ```bash
  cargo test -p drift-engine request_body_reaches_data_operation_without_validation_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.9: RED validator called but raw input used blocks**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `validator_called_but_raw_input_used_blocks`

  Fixture shape:

  ```ts
  const body = await request.json();
  const parsed = ProjectInputSchema.parse(body);
  await db.project.create({ data: body });
  ```

  Run:

  ```bash
  cargo test -p drift-engine validator_called_but_raw_input_used_blocks -- --nocapture
  ```

  Expected RED: fail because validation call existence is treated as enough or
  raw/validated variable identity is not tracked.

- [ ] **Task 3.10: GREEN raw input still blocks**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Require sink use to come from the validated variable, not the raw input
  variable, unless the accepted validator is a throwing validator that dominates
  the sink.

  Run:

  ```bash
  cargo test -p drift-engine validator_called_but_raw_input_used_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.11: RED parsed result passes**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `validated_parsed_result_reaches_data_operation_passes`

  Run:

  ```bash
  cargo test -p drift-engine validated_parsed_result_reaches_data_operation_passes -- --nocapture
  ```

  Expected RED: fail because validated result use is not accepted as proof.

- [ ] **Task 3.12: GREEN parsed result proof**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Mark proof as `proven` only when accepted parsed result reaches the protected
  sink.

  Run:

  ```bash
  cargo test -p drift-engine validated_parsed_result_reaches_data_operation_passes -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.13: RED safeParse success guard**

  Test file: `crates/drift-engine/tests/security_control_flow.rs`

  Test name: `safe_parse_data_is_validated_only_after_success_guard`

  Run:

  ```bash
  cargo test -p drift-engine safe_parse_data_is_validated_only_after_success_guard -- --nocapture
  ```

  Expected RED: fail because `safeParse` `.data` is not tied to a dominating
  `success` guard.

- [ ] **Task 3.14: GREEN safeParse success guard**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`

  Accept `result.data` only when a local `if (!result.success) return/throw`
  or `if (result.success) { sink(result.data) }` dominates the sink.

  Run:

  ```bash
  cargo test -p drift-engine safe_parse_data_is_validated_only_after_success_guard -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.15: RED unknown validator is missing proof**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `unknown_validator_name_does_not_satisfy_request_validation`

  Run:

  ```bash
  cargo test -p drift-engine unknown_validator_name_does_not_satisfy_request_validation -- --nocapture
  ```

  Expected RED: fail because a name-shaped validator such as `validateInput`
  is accepted without contract evidence.

- [ ] **Task 3.16: GREEN unknown validator missing proof**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Emit missing proof code `unknown_validator` or
  `validation_result_not_used`; do not pass.

  Run:

  ```bash
  cargo test -p drift-engine unknown_validator_name_does_not_satisfy_request_validation -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.17: RED spread/destructuring parser gap**

  Test file: `crates/drift-engine/tests/security_control_flow.rs`

  Test name: `request_input_spread_emits_parser_gap_and_blocks`

  Fixture shape:

  ```ts
  const body = await request.json();
  await db.project.create({ data: { ...body, ownerId } });
  ```

  Run:

  ```bash
  cargo test -p drift-engine request_input_spread_emits_parser_gap_and_blocks -- --nocapture
  ```

  Expected RED: fail because unsupported spread/destructuring is not emitted
  as parser-gap-backed proof evidence.

- [ ] **Task 3.18: GREEN spread/destructuring parser gap**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_capabilities.rs`

  Emit parser gap `unsupported_request_input_spread` with
  `blocks_enforcement=true`.

  Run:

  ```bash
  cargo test -p drift-engine request_input_spread_emits_parser_gap_and_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 3.19: RED candidate-only validation cannot block**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `candidate_only_validation_evidence_does_not_block`

  Run:

  ```bash
  cargo test -p drift-engine candidate_only_validation_evidence_does_not_block -- --nocapture
  ```

  Expected RED: fail because validation-looking candidate evidence is not
  separated from accepted deterministic contracts.

- [ ] **Task 3.20: GREEN candidate-only validation boundary**

  Implementation files:

  - `crates/drift-engine/src/security_rules.rs`
  - `packages/cli/src/domain/convention-candidates.ts`

  Allow candidate generation, but never blocking findings, from candidate-only
  validator evidence.

  Run:

  ```bash
  cargo test -p drift-engine candidate_only_validation_evidence_does_not_block -- --nocapture
  pnpm --filter @drift/cli test -- convention-candidates
  ```

  Expected GREEN: pass.

- [ ] **Task 3.21: RED TypeScript schemas and engine contract**

  Test files:

  - `packages/core/test/security.test.ts`
  - `packages/engine-contract/test/security-contract.test.ts`

  Test names:

  - `validates api_route_requires_request_validation contracts and proof fields`
  - `validates request validation parser gaps from engine output`

  Run:

  ```bash
  pnpm --filter @drift/core test -- security
  pnpm --filter @drift/engine-contract test -- security-contract
  ```

  Expected RED: fail because validation contract kind, fact kinds, proof
  fields, and parser-gap/missing-proof codes are not in TypeScript schemas.

- [ ] **Task 3.22: GREEN TypeScript schemas and engine contract**

  Implementation files:

  - `packages/core/src/security.ts`
  - `packages/core/src/domain.ts`
  - `packages/core/src/schemas.ts`
  - `packages/engine-contract/src/index.ts`
  - `crates/drift-engine/src/protocol.rs`

  Add only normalized validation contract/proof/event fields. Do not add rule
  evaluation logic in TypeScript.

  Run:

  ```bash
  pnpm --filter @drift/core test -- security
  pnpm --filter @drift/engine-contract test -- security-contract
  ```

  Expected GREEN: pass.

- [ ] **Task 3.23: RED query, CLI, scan status, and repo map output**

  Test files:

  - `packages/query/test/security-boundary-proof.test.ts`
  - `packages/cli/test/security-check.test.ts`
  - `packages/cli/test/cli.test.ts`

  Test names:

  - `summarizes request validation proof without snippets`
  - `returns request validation proof in drift check JSON output`
  - `scan status reports request_validation capability`
  - `repo map reports route request validation summary`

  Run:

  ```bash
  pnpm --filter @drift/query test -- security-boundary-proof
  pnpm --filter @drift/cli test -- security-check
  pnpm --filter @drift/cli test -- "scan status reports request_validation"
  pnpm --filter @drift/cli test -- "repo map reports route request validation summary"
  ```

  Expected RED: fail because query/read models and CLI output do not expose
  request-validation proof truth.

- [ ] **Task 3.24: GREEN query, CLI, scan status, and repo map output**

  Implementation files:

  - `packages/query/src/security-boundary-proof.ts`
  - `packages/query/src/index.ts`
  - `packages/cli/src/check/security-check.ts`
  - `packages/cli/src/check/run-check.ts`
  - `packages/cli/src/domain/scan-status.ts`
  - `packages/cli/src/commands/scan.ts`
  - `packages/cli/src/commands/repo-map.ts`

  Wire read models and output formatting only. Do not duplicate deterministic
  request-validation logic in TypeScript.

  Run:

  ```bash
  pnpm --filter @drift/query test -- security-boundary-proof
  pnpm --filter @drift/cli test -- security-check
  pnpm --filter @drift/cli test -- "scan status reports request_validation"
  pnpm --filter @drift/cli test -- "repo map reports route request validation summary"
  ```

  Expected GREEN: pass.

- [ ] **Task 3.25: RED MCP request validation output**

  Test file: `packages/mcp/test/mcp.test.ts`

  Test name: `exposes request validation proof summaries without snippets`

  Run:

  ```bash
  pnpm --filter @drift/mcp test -- "request validation"
  ```

  Expected RED: fail because MCP read-only security context does not include
  request-validation proof summaries.

- [ ] **Task 3.26: GREEN MCP request validation output**

  Implementation files:

  - `packages/mcp/src/security-context.ts`
  - `packages/mcp/src/index.ts`
  - `packages/mcp/src/tools.ts`
  - `packages/query/src/security-boundary-proof.ts`

  Expose accepted contracts, proof status, missing proof, and parser gaps
  without snippets or duplicated rule logic.

  Run:

  ```bash
  pnpm --filter @drift/mcp test -- "request validation"
  ```

  Expected GREEN: pass.

- [ ] **Task 3.27: RED e2e validation fixture matrix**

  Fixture names:

  - `test/fixtures/security-validation-missing`
  - `test/fixtures/security-validation-result-unused`
  - `test/fixtures/security-validation-before-data`
  - `test/fixtures/security-validation-dynamic-body-parser-gap`

  Test file: `test/e2e/security-validation.test.ts`

  Test name: `security validation fixture matrix proves request input validation and gaps`

  Run:

  ```bash
  pnpm test:e2e -- security-validation
  ```

  Expected RED: fail because fixtures and end-to-end validation expectations
  do not exist.

- [ ] **Task 3.28: GREEN e2e validation fixture matrix**

  Implementation files:

  - `test/e2e/security-validation.test.ts`
  - `test/fixtures/security-validation-missing/package.json`
  - `test/fixtures/security-validation-missing/app/api/projects/route.ts`
  - `test/fixtures/security-validation-result-unused/package.json`
  - `test/fixtures/security-validation-result-unused/app/api/projects/route.ts`
  - `test/fixtures/security-validation-before-data/package.json`
  - `test/fixtures/security-validation-before-data/app/api/projects/route.ts`
  - `test/fixtures/security-validation-dynamic-body-parser-gap/package.json`
  - `test/fixtures/security-validation-dynamic-body-parser-gap/app/api/projects/route.ts`

  Fixture expectations:

  - Missing validation blocks.
  - Validation result unused blocks.
  - Validated parsed result before data operation passes.
  - Dynamic body/spread/destructuring emits parser-gap-backed evidence.
  - No fixture includes source snippets, secret values, tokens, cookies, or raw
    request payload values in expected outputs.

  Run:

  ```bash
  pnpm test:e2e -- security-validation
  ```

  Expected GREEN: pass.

- [ ] **Task 3.29: Phase 3 full gate**

  Run:

  ```bash
  cargo test -p drift-engine security_
  cargo test -p drift-engine
  pnpm --filter @drift/core test
  pnpm --filter @drift/engine-contract test
  pnpm --filter @drift/query test
  pnpm --filter @drift/cli test
  pnpm --filter @drift/mcp test
  pnpm test:e2e
  pnpm typecheck
  cargo fmt --all -- --check
  cargo clippy -p drift-engine --all-targets -- -D warnings
  git diff --check
  ```

  Expected: all pass.

Done when:

- Validation proof ties input variable to validated variable to sink.
- Name-only `validate*` helpers cannot satisfy deterministic proof unless accepted.
- `drift scan status --json` reports `request_validation`.
- `drift check --json` exposes `SecurityBoundaryProof.request_validation`.
- MCP `get_security_context` exposes request-validation summaries without snippets.
- Candidate-only validation evidence never blocks.
- Dynamic or unsupported request-input shapes produce parser-gap-backed proof
  evidence and do not silently pass.

## Phase 4: Tenant, Role, IDOR, And Session Trust

Purpose: prove trusted subject, role/permission checks, and tenant binding.

Scope:

- Implement only:
  - `session_object_must_come_from_trusted_helper`
  - `api_route_requires_authorization`
  - `api_route_requires_tenant_scope`
- Do not implement Phase 5 sensitive response/secrets work.
- Do not implement Phase 6 SSRF, SQL, CORS, CSRF, or rate-limit work.
- Rust is the deterministic authority for session trust, tenant predicate proof,
  authorization guard proof, parser gaps, missing proof, and blocking rule
  evaluation.
- TypeScript is product/control plane only: schemas, engine-contract validation,
  storage/query/read models, CLI/MCP envelopes, governance, candidates, and
  output formatting.
- TypeScript must not synthesize trusted session, tenant, role, permission, or
  IDOR proof from raw facts.
- Blocking findings require accepted deterministic contracts.
- Candidate-only and heuristic role/tenant evidence must never block.
- Name-only helpers such as `requireRole`, `canAccess`, `scopeTenant`, or
  `getSession` must not satisfy proof unless accepted.
- Inline role comparisons such as `user.role === "admin"` must not satisfy proof
  unless the accepted contract explicitly allows that policy shape.
- Tenant-looking variable names such as `tenantId`, `orgId`, or `accountId` must
  not satisfy proof unless the value is tied to a trusted source and bound to
  the protected data predicate.
- Session/user objects from request body, query, headers, cookies, params, or
  unaccepted framework helpers are untrusted until Rust proves trusted derivation
  from an accepted auth helper or accepted middleware proof.
- A trusted session alone must not satisfy tenant proof. Tenant proof must bind
  the trusted tenant source to the protected data operation predicate or accepted
  scoped data helper.
- A trusted session alone must not satisfy authorization proof. Authorization
  proof must show an accepted role, permission, policy, or resource guard
  dominates the protected sink.
- Unsupported destructuring, dynamic property access, dynamic query helpers,
  unknown ORM wrappers, unresolved aliases, and branch/control-flow ambiguity
  must emit parser-gap-backed evidence and must not silently pass.
- Outputs, storage, MCP, and CLI must never include source snippets, session
  values, user IDs, tenant IDs, header/cookie/request values, tokens, secrets,
  raw SQL values, or request payloads.
- Preserve existing waiver, baseline, lifecycle, diff-scope, check-run, audit,
  policy egress, direct-data-access, service-delegation, Phase 1 auth, Phase 2
  middleware, and Phase 3 request-validation behavior.

Add facts:

- `authorization_guard_called`
- `tenant_guard_called`
- `session_read`
- `session_trust_boundary`

Add contracts:

- `api_route_requires_authorization`
- `api_route_requires_tenant_scope`
- `session_object_must_come_from_trusted_helper`

Accepted contract input shape:

```json
{
  "kind": "security_boundary",
  "id": "accepted_security_phase4",
  "rule": "api_route_requires_tenant_scope",
  "mode": "block",
  "scope": {
    "path_globs": ["app/api/**/route.ts"],
    "file_roles": ["api_route"]
  },
  "matcher": {
    "methods": ["GET", "POST", "PUT", "PATCH", "DELETE"]
  },
  "requires": {
    "auth_helpers": [
      {
        "symbol": "requireUser",
        "import": "@/server/auth",
        "returns": "session"
      }
    ],
    "authorization_helpers": [
      {
        "symbol": "requireRole",
        "import": "@/server/authz",
        "roles": ["admin"],
        "behavior": "throws"
      },
      {
        "symbol": "canAccessProject",
        "import": "@/server/authz",
        "permissions": ["project:read"],
        "behavior": "boolean"
      }
    ],
    "tenant_helpers": [
      {
        "symbol": "scopeProjectToTenant",
        "import": "@/server/tenant",
        "tenant_arg": "tenantId",
        "data_operation_arg": "query"
      }
    ],
    "tenant_keys": ["tenantId", "orgId"],
    "tenant_sources": ["session", "path_param"],
    "data_operations": ["db.project.findMany", "db.project.findUnique", "db.project.update", "db.project.delete"]
  }
}
```

Rust must normalize accepted symbols and imports from `requires.*`. It must not
use `matcher.required_calls`, helper names, or candidate evidence as deterministic
truth for Phase 4 proof.

Create fixtures:

- `test/fixtures/security-tenant-missing`
- `test/fixtures/security-tenant-param-unused`
- `test/fixtures/security-tenant-bound-to-query`
- `test/fixtures/security-role-missing`
- `test/fixtures/security-role-guard-present`
- `test/fixtures/security-session-from-request-untrusted`
- `test/fixtures/security-tenant-untrusted-source`
- `test/fixtures/security-tenant-parser-gap`
- `test/fixtures/security-role-branch-bypass`
- `test/fixtures/security-session-trusted-helper`

Required RED tests:

- Tenant route touches datastore without tenant predicate and blocks.
- Tenant param is read but not used in data predicate and blocks.
- Accepted tenant helper/predicate reaches data operation and passes.
- Role-required route without role guard blocks.
- Session object from request/header is untrusted.
- Role/tenant proof cannot use untrusted session.
- Accepted auth helper can establish trusted session derivation.
- Accepted authorization helper must dominate the protected sink.
- Authorization guard after sink blocks.
- Authorization guard in only one branch blocks.
- Accepted tenant predicate must bind the trusted tenant source to the data
  operation predicate.
- Unknown tenant helper emits missing proof, not pass.
- Dynamic tenant predicate emits parser gap, not pass.
- Candidate-only tenant or role evidence does not block.

Done when:

- Tenant proof connects trusted tenant source to data predicate.
- Role/permission proof requires accepted helper or accepted policy shape.
- Session proof distinguishes trusted, untrusted, and unknown session sources.
- `SecurityBoundaryProof.session_trust`, `SecurityBoundaryProof.authorization`,
  and `SecurityBoundaryProof.tenant` are populated by Rust only.
- Parser gaps and missing proof are surfaced through CLI, query, MCP, storage,
  scan status, and repo map without snippets or sensitive values.
- Phase 4 capability output is only marked deterministic after the full path is
  tested.
- Candidate-only Phase 4 evidence remains advisory.

### Phase 4 Executable Task Ledger

Execute these tasks in order. For every RED task, add only the failing test
first, run the focused command, and record the exact expected failure before
editing implementation files. For every GREEN task, edit only the listed
implementation files and run the listed command.

- [ ] **Task 4.1: RED session read fact extraction**

  Test file: `crates/drift-engine/tests/security_facts.rs`

  Test name: `extracts_session_read_facts_from_trusted_and_untrusted_sources`

  Add source fixtures covering:

  - `const session = await requireUser(request);`
  - `const session = await getServerSession(authOptions);`
  - `const user = request.headers.get("x-user");`
  - `const session = await request.json();`
  - `const token = request.cookies.get("session");`

  Assert facts:

  - `session_read` from accepted auth result starts as `source="auth_result"` and
    `trust="unknown"` until proof construction.
  - Header, body, and cookie-derived session/user reads are emitted as
    `trust="untrusted"`.
  - No fact value contains header names, cookie values, token values, user IDs,
    tenant IDs, request payload values, or source snippets.

  Run:

  ```bash
  cargo test -p drift-engine extracts_session_read_facts_from_trusted_and_untrusted_sources -- --nocapture
  ```

  Expected RED: fail because Rust does not emit Phase 4 `session_read` facts.

- [ ] **Task 4.2: GREEN session read fact extraction**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_facts.rs`

  Implement extraction only:

  - Normalize accepted auth/session helper imports from `requires.auth_helpers`.
  - Emit `session_read` for accepted auth-helper result variables with
    `source="auth_result"` and `trust="unknown"`.
  - Emit `session_read` for request-derived session/user/token reads with
    `trust="untrusted"`.
  - Keep secret/session/request values out of fact metadata.

  Run:

  ```bash
  cargo test -p drift-engine extracts_session_read_facts_from_trusted_and_untrusted_sources -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.3: RED session trust proof construction**

  Test file: `crates/drift-engine/tests/security_control_flow.rs`

  Test name: `trusted_session_derives_only_from_accepted_auth_helper_or_middleware`

  Fixture shapes:

  ```ts
  import { requireUser } from "@/server/auth";

  export async function GET(request: Request) {
    const session = await requireUser(request);
    await db.project.findMany({ where: { tenantId: session.user.tenantId } });
    return Response.json({});
  }
  ```

  ```ts
  export async function GET(request: Request) {
    const session = await request.json();
    await db.project.findMany({ where: { tenantId: session.user.tenantId } });
    return Response.json({});
  }
  ```

  Assert:

  - Accepted auth helper creates a `session_trust_boundary` proof record with
    `trust="trusted"` and `derived_from="auth_guard"`.
  - Request-derived session creates missing trust with
    `reason="derived_from_request"`.

  Run:

  ```bash
  cargo test -p drift-engine trusted_session_derives_only_from_accepted_auth_helper_or_middleware -- --nocapture
  ```

  Expected RED: fail because Rust does not construct `session_trust_boundary`
  proof.

- [ ] **Task 4.4: GREEN session trust proof construction**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`

  Implement proof only:

  - Connect accepted auth-helper calls from Phase 1 proof to session variables.
  - Accept middleware-derived trusted session only when Phase 2 middleware proof
    has accepted protection kind `auth`.
  - Mark request/header/cookie/body-derived session values as untrusted.
  - Emit missing proof code `session_not_trusted` when a session/user object is
    used for tenant or authorization proof without trusted derivation.

  Run:

  ```bash
  cargo test -p drift-engine trusted_session_derives_only_from_accepted_auth_helper_or_middleware -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.5: RED tenant source extraction**

  Test file: `crates/drift-engine/tests/security_facts.rs`

  Test name: `extracts_tenant_sources_from_session_params_and_query`

  Add fixtures for:

  - `session.user.tenantId`
  - `params.tenantId`
  - `request.nextUrl.searchParams.get("tenantId")`
  - `const { tenantId } = params`
  - `const tenantId = body.tenantId`

  Assert:

  - Session tenant source references the trusted session fact when available.
  - Path param source is `source="path_param"` and `trusted=false` until a
    contract accepts path params as a tenant source.
  - Query/body tenant source is emitted but `trusted=false`.
  - Destructured path params are either extracted or parser-gapped; they are not
    silently omitted.

  Run:

  ```bash
  cargo test -p drift-engine extracts_tenant_sources_from_session_params_and_query -- --nocapture
  ```

  Expected RED: fail because Rust does not extract tenant source evidence.

- [ ] **Task 4.6: GREEN tenant source extraction**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_facts.rs`
  - `crates/drift-engine/src/security_control_flow.rs`

  Implement source extraction:

  - Normalize accepted tenant keys from `requires.tenant_keys`.
  - Track session property paths for accepted tenant keys.
  - Track path params and query/body/header tenant-looking reads as sources,
    while preserving trusted/untrusted status.
  - Emit parser gap `unsupported_tenant_source_destructure` for destructuring
    forms that cannot be resolved deterministically.

  Run:

  ```bash
  cargo test -p drift-engine extracts_tenant_sources_from_session_params_and_query -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.7: RED tenant predicate and tenant helper extraction**

  Test file: `crates/drift-engine/tests/security_facts.rs`

  Test name: `extracts_tenant_predicates_and_accepted_tenant_helpers`

  Add fixtures for:

  ```ts
  const session = await requireUser(request);
  await db.project.findMany({ where: { tenantId: session.user.tenantId } });
  ```

  ```ts
  const session = await requireUser(request);
  await db.project.findUnique({ where: { id: params.projectId, tenantId: session.user.tenantId } });
  ```

  ```ts
  const session = await requireUser(request);
  await scopeProjectToTenant(db.project, session.user.tenantId).findMany();
  ```

  Assert:

  - Equality predicates produce `tenant_guard_called` with
    `predicate_kind="equality"`.
  - Accepted scoped helper produces `tenant_guard_called` with
    `predicate_kind="scoped_helper"`.
  - Unknown helper names are not emitted as accepted tenant guard facts.

  Run:

  ```bash
  cargo test -p drift-engine extracts_tenant_predicates_and_accepted_tenant_helpers -- --nocapture
  ```

  Expected RED: fail because tenant predicate/helper facts are not emitted.

- [ ] **Task 4.8: GREEN tenant predicate and tenant helper extraction**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_facts.rs`
  - `crates/drift-engine/src/security_control_flow.rs`

  Implement extraction:

  - Normalize accepted tenant helper symbols and imports from
    `requires.tenant_helpers`.
  - Recognize simple ORM `where` equality predicates for accepted tenant keys.
  - Recognize accepted scoped helpers only when symbol and import match the
    contract.
  - Emit unknown helper evidence as candidate/missing proof, not as accepted
    `tenant_guard_called`.

  Run:

  ```bash
  cargo test -p drift-engine extracts_tenant_predicates_and_accepted_tenant_helpers -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.9: RED authorization guard extraction**

  Test file: `crates/drift-engine/tests/security_facts.rs`

  Test name: `extracts_authorization_guard_called_for_accepted_role_and_policy_helpers`

  Add fixtures for:

  ```ts
  const session = await requireUser(request);
  requireRole(session.user, "admin");
  await db.project.findMany();
  ```

  ```ts
  const session = await requireUser(request);
  if (!canAccessProject(session.user, params.projectId, "project:read")) {
    return new Response("forbidden", { status: 403 });
  }
  await db.project.findUnique({ where: { id: params.projectId } });
  ```

  Assert:

  - Accepted throwing role helper emits `authorization_guard_called`.
  - Accepted boolean policy helper emits `authorization_guard_called` only when
    the failing branch exits before the protected sink.
  - `if (session.user.role === "admin")` does not emit accepted authorization
    proof unless an accepted policy shape explicitly allows inline role checks.

  Run:

  ```bash
  cargo test -p drift-engine extracts_authorization_guard_called_for_accepted_role_and_policy_helpers -- --nocapture
  ```

  Expected RED: fail because accepted authorization guard facts are not emitted.

- [ ] **Task 4.10: GREEN authorization guard extraction**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_facts.rs`
  - `crates/drift-engine/src/security_control_flow.rs`

  Implement extraction:

  - Normalize accepted authorization helpers from
    `requires.authorization_helpers`.
  - Track accepted role, permission, policy, resource variable, and subject
    variable metadata without storing user IDs or tenant IDs.
  - Record boolean helper dominance only when the non-authorized branch returns
    or throws before the protected sink.

  Run:

  ```bash
  cargo test -p drift-engine extracts_authorization_guard_called_for_accepted_role_and_policy_helpers -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.11: RED untrusted session cannot satisfy tenant or authorization proof**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `untrusted_session_cannot_satisfy_tenant_or_authorization_proof`

  Fixture shape:

  ```ts
  export async function GET(request: Request) {
    const session = await request.json();
    requireRole(session.user, "admin");
    await db.project.findMany({ where: { tenantId: session.user.tenantId } });
    return Response.json({});
  }
  ```

  Assert:

  - `session_trust.proven` is false.
  - `authorization.proven` is false with `session_not_trusted`.
  - `tenant.proven` is false with `tenant_source_untrusted`.
  - Blocking findings are emitted only when accepted Phase 4 contracts are in
    `mode="block"`.

  Run:

  ```bash
  cargo test -p drift-engine untrusted_session_cannot_satisfy_tenant_or_authorization_proof -- --nocapture
  ```

  Expected RED: fail because role/tenant proof does not reject untrusted session
  sources.

- [ ] **Task 4.12: GREEN untrusted session rejection**

  Implementation files:

  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Implement rule/proof behavior:

  - Require trusted session derivation before session-derived role or tenant
    facts can satisfy Phase 4 proof.
  - Emit `session_not_trusted`, `tenant_source_untrusted`, and
    `authorization_guard_missing` as distinct missing-proof codes.
  - Do not block candidate-only evidence.

  Run:

  ```bash
  cargo test -p drift-engine untrusted_session_cannot_satisfy_tenant_or_authorization_proof -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.13: RED tenant route without predicate blocks**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `tenant_scoped_route_without_tenant_predicate_blocks`

  Fixture shape:

  ```ts
  export async function GET(request: Request) {
    const session = await requireUser(request);
    await db.project.findMany();
    return Response.json({});
  }
  ```

  Run:

  ```bash
  cargo test -p drift-engine tenant_scoped_route_without_tenant_predicate_blocks -- --nocapture
  ```

  Expected RED: fail because `api_route_requires_tenant_scope` is not evaluated
  as a blocking deterministic rule.

- [ ] **Task 4.14: GREEN tenant missing-predicate rule**

  Implementation files:

  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`
  - `crates/drift-engine/src/check_command.rs`

  Implement rule behavior:

  - Apply only to accepted `api_route_requires_tenant_scope` contracts.
  - Require at least one protected data operation in scope.
  - Emit missing proof code `tenant_predicate_missing` when a protected data
    operation has no accepted tenant predicate or scoped helper.
  - Do not emit a tenant finding for routes with no protected data operation.

  Run:

  ```bash
  cargo test -p drift-engine tenant_scoped_route_without_tenant_predicate_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.15: RED tenant param read but unused blocks**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `tenant_param_read_but_not_bound_to_data_operation_blocks`

  Fixture shape:

  ```ts
  export async function GET(request: Request, { params }: { params: { tenantId: string } }) {
    const tenantId = params.tenantId;
    await db.project.findMany({ where: { archived: false } });
    return Response.json({});
  }
  ```

  Run:

  ```bash
  cargo test -p drift-engine tenant_param_read_but_not_bound_to_data_operation_blocks -- --nocapture
  ```

  Expected RED: fail because the engine does not distinguish tenant source
  existence from tenant predicate binding.

- [ ] **Task 4.16: GREEN tenant predicate binding rule**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Implement binding:

  - Tenant source presence is insufficient.
  - Tenant predicate must reference the trusted/accepted tenant source and the
    protected data operation.
  - Emit missing proof code `tenant_predicate_not_bound_to_query` when the tenant
    source is read but not used in the data predicate.

  Run:

  ```bash
  cargo test -p drift-engine tenant_param_read_but_not_bound_to_data_operation_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.17: RED accepted tenant predicate passes**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `trusted_tenant_source_bound_to_data_predicate_passes`

  Fixture shape:

  ```ts
  export async function GET(request: Request) {
    const session = await requireUser(request);
    const projects = await db.project.findMany({
      where: { tenantId: session.user.tenantId }
    });
    return Response.json(projects);
  }
  ```

  Run:

  ```bash
  cargo test -p drift-engine trusted_tenant_source_bound_to_data_predicate_passes -- --nocapture
  ```

  Expected RED: fail because accepted tenant predicate proof is not marked
  `proven`.

- [ ] **Task 4.18: GREEN accepted tenant predicate proof**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Implement pass proof:

  - Mark `tenant.required=true`.
  - Mark `tenant.proven=true` only when every protected data operation in scope
    has accepted tenant predicate/helper proof.
  - Keep individual predicate fact IDs and data-operation fact IDs in proof.

  Run:

  ```bash
  cargo test -p drift-engine trusted_tenant_source_bound_to_data_predicate_passes -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.19: RED accepted tenant helper passes**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `accepted_tenant_scope_helper_bound_to_data_operation_passes`

  Fixture shape:

  ```ts
  export async function GET(request: Request) {
    const session = await requireUser(request);
    const projects = await scopeProjectToTenant(db.project, session.user.tenantId).findMany();
    return Response.json(projects);
  }
  ```

  Run:

  ```bash
  cargo test -p drift-engine accepted_tenant_scope_helper_bound_to_data_operation_passes -- --nocapture
  ```

  Expected RED: fail because accepted tenant scoped helper proof is not
  recognized.

- [ ] **Task 4.20: GREEN accepted tenant helper proof**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Implement helper proof:

  - Accept only helpers normalized from `requires.tenant_helpers`.
  - Bind helper receiver/argument to the protected data operation.
  - Bind helper tenant argument to a trusted or accepted tenant source.
  - Unknown helper names remain missing proof.

  Run:

  ```bash
  cargo test -p drift-engine accepted_tenant_scope_helper_bound_to_data_operation_passes -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.21: RED authorization-required route without guard blocks**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `authorization_required_route_without_guard_blocks`

  Fixture shape:

  ```ts
  export async function DELETE(request: Request, { params }: { params: { projectId: string } }) {
    const session = await requireUser(request);
    await db.project.delete({ where: { id: params.projectId, tenantId: session.user.tenantId } });
    return Response.json({});
  }
  ```

  Run:

  ```bash
  cargo test -p drift-engine authorization_required_route_without_guard_blocks -- --nocapture
  ```

  Expected RED: fail because `api_route_requires_authorization` is not evaluated.

- [ ] **Task 4.22: GREEN missing authorization rule**

  Implementation files:

  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`
  - `crates/drift-engine/src/check_command.rs`

  Implement rule behavior:

  - Apply only to accepted `api_route_requires_authorization` contracts.
  - Require protected data operation/resource sink in scope.
  - Emit missing proof code `authorization_guard_missing` when no accepted
    authorization guard dominates the protected sink.
  - Do not treat Phase 1 auth helper or Phase 4 tenant predicate as
    authorization proof.

  Run:

  ```bash
  cargo test -p drift-engine authorization_required_route_without_guard_blocks -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.23: RED accepted authorization guard passes**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `accepted_authorization_guard_with_trusted_session_passes`

  Fixture shape:

  ```ts
  export async function DELETE(request: Request, { params }: { params: { projectId: string } }) {
    const session = await requireUser(request);
    requireRole(session.user, "admin");
    await db.project.delete({ where: { id: params.projectId, tenantId: session.user.tenantId } });
    return Response.json({});
  }
  ```

  Run:

  ```bash
  cargo test -p drift-engine accepted_authorization_guard_with_trusted_session_passes -- --nocapture
  ```

  Expected RED: fail because accepted authorization guard proof is not marked
  `proven`.

- [ ] **Task 4.24: GREEN accepted authorization guard proof**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Implement pass proof:

  - Mark `authorization.required=true`.
  - Mark `authorization.proven=true` only when every protected sink in scope has
    accepted authorization guard proof.
  - Require trusted session/user subject when the authorization helper uses a
    subject variable.
  - Preserve roles, permissions, policy ID, subject variable, and resource
    variable classifications without storing concrete values.

  Run:

  ```bash
  cargo test -p drift-engine accepted_authorization_guard_with_trusted_session_passes -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.25: RED authorization guard must dominate sink**

  Test file: `crates/drift-engine/tests/security_control_flow.rs`

  Test name: `authorization_guard_after_sink_or_in_one_branch_does_not_dominate`

  Fixture shapes:

  ```ts
  export async function DELETE(request: Request) {
    const session = await requireUser(request);
    await db.project.delete({ where: { tenantId: session.user.tenantId } });
    requireRole(session.user, "admin");
    return Response.json({});
  }
  ```

  ```ts
  export async function DELETE(request: Request) {
    const session = await requireUser(request);
    if (new URL(request.url).searchParams.get("preview")) {
      requireRole(session.user, "admin");
    }
    await db.project.delete({ where: { tenantId: session.user.tenantId } });
    return Response.json({});
  }
  ```

  Run:

  ```bash
  cargo test -p drift-engine authorization_guard_after_sink_or_in_one_branch_does_not_dominate -- --nocapture
  ```

  Expected RED: fail because guard existence is treated as proof without
  dominance over the protected sink.

- [ ] **Task 4.26: GREEN authorization dominance**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_rules.rs`

  Implement dominance:

  - Throwing authorization helpers dominate only subsequent protected sinks in
    the same route execution path.
  - Boolean authorization helpers dominate only when the failure branch exits
    before the sink.
  - Guard-after-sink emits `authorization_guard_not_dominating_sink`.
  - One-branch-only guard emits `authorization_guard_not_dominating_sink`.

  Run:

  ```bash
  cargo test -p drift-engine authorization_guard_after_sink_or_in_one_branch_does_not_dominate -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.27: RED candidate-only role and tenant evidence cannot block**

  Test file: `crates/drift-engine/tests/security_rules.rs`

  Test name: `candidate_only_role_and_tenant_evidence_does_not_block`

  Fixture shape:

  ```ts
  export async function GET(request: Request) {
    const session = await getSession(request);
    if (session.user.role === "admin") {
      await db.project.findMany({ where: { tenantId: session.user.tenantId } });
    }
    return Response.json({});
  }
  ```

  Run:

  ```bash
  cargo test -p drift-engine candidate_only_role_and_tenant_evidence_does_not_block -- --nocapture
  ```

  Expected RED: fail if heuristic helper names or inline checks create blocking
  Phase 4 proof.

- [ ] **Task 4.28: GREEN candidate-only Phase 4 boundary**

  Implementation files:

  - `crates/drift-engine/src/security_patterns.rs`
  - `crates/drift-engine/src/security_rules.rs`
  - `packages/cli/src/domain/convention-candidates.ts`

  Implement boundary:

  - Candidate inference may propose tenant helpers, authorization helpers, and
    trusted session helpers.
  - Candidate-only evidence must not produce blocking findings.
  - Rust blocking proof uses only accepted contract input.
  - Candidate output contains evidence refs and confidence, not snippets.

  Run:

  ```bash
  cargo test -p drift-engine candidate_only_role_and_tenant_evidence_does_not_block -- --nocapture
  pnpm --filter @drift/cli test -- convention-candidates
  ```

  Expected GREEN: pass.

- [ ] **Task 4.29: RED Phase 4 parser gaps**

  Test file: `crates/drift-engine/tests/security_control_flow.rs`

  Test name: `tenant_authorization_dynamic_shapes_emit_parser_gaps`

  Fixture shapes:

  ```ts
  const key = "tenantId";
  await db.project.findMany({ where: { [key]: session.user.tenantId } });
  ```

  ```ts
  const args = { where: { tenantId: session.user.tenantId } };
  await db.project.findMany(args);
  ```

  ```ts
  const { user: { tenantId } } = session;
  await db.project.findMany({ where: { tenantId } });
  ```

  Run:

  ```bash
  cargo test -p drift-engine tenant_authorization_dynamic_shapes_emit_parser_gaps -- --nocapture
  ```

  Expected RED: fail because unsupported dynamic tenant/query shapes are
  silently omitted or treated as proof.

- [ ] **Task 4.30: GREEN Phase 4 parser gaps**

  Implementation files:

  - `crates/drift-engine/src/security_control_flow.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `crates/drift-engine/src/security_capabilities.rs`

  Implement parser gaps:

  - Emit `unsupported_tenant_dynamic_property`.
  - Emit `unsupported_tenant_query_object_alias`.
  - Emit `unsupported_session_nested_destructure`.
  - Parser gaps under blocking accepted Phase 4 contracts set
    `blocks_enforcement=true`.
  - Capability report marks the affected Phase 4 proof sub-capability
    `partial` or `unsupported` for the file/route.

  Run:

  ```bash
  cargo test -p drift-engine tenant_authorization_dynamic_shapes_emit_parser_gaps -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.31: RED TypeScript schemas and engine contract**

  Test files:

  - `packages/core/test/security.test.ts`
  - `packages/engine-contract/test/security-contract.test.ts`

  Test names:

  - `validates phase4 tenant authorization and session trust contracts`
  - `rejects impossible phase4 proof states`
  - `validates phase4 parser gaps from engine output`

  Required schema assertions:

  - `session_trust.proven=true` is invalid when `missing_trust` is non-empty.
  - `authorization.proven=true` is invalid when `missing` is non-empty.
  - `tenant.proven=true` is invalid when `missing` is non-empty.
  - `authorization.proven=true` is invalid when any referenced session source is
    untrusted.
  - `tenant.proven=true` is invalid when every tenant source is untrusted.
  - Parser gaps use normalized codes and carry no snippets or sensitive values.

  Run:

  ```bash
  pnpm --filter @drift/core test -- security
  pnpm --filter @drift/engine-contract test -- security-contract
  ```

  Expected RED: fail because Phase 4 contract, proof, missing-proof, and
  parser-gap fields are not fully validated.

- [ ] **Task 4.32: GREEN TypeScript schemas and engine contract**

  Implementation files:

  - `packages/core/src/security.ts`
  - `packages/core/src/domain.ts`
  - `packages/core/src/schemas.ts`
  - `packages/engine-contract/src/index.ts`
  - `crates/drift-engine/src/protocol.rs`

  Implement schemas only:

  - Add Phase 4 proof/event fields and parser-gap codes.
  - Validate impossible proof states.
  - Validate accepted contract fields under `requires.auth_helpers`,
    `requires.authorization_helpers`, `requires.tenant_helpers`,
    `requires.tenant_keys`, `requires.tenant_sources`, and
    `requires.data_operations`.
  - Do not add deterministic Phase 4 proof logic in TypeScript.

  Run:

  ```bash
  pnpm --filter @drift/core test -- security
  pnpm --filter @drift/engine-contract test -- security-contract
  ```

  Expected GREEN: pass.

- [ ] **Task 4.33: RED engine request path carries accepted Phase 4 contracts to Rust**

  Test files:

  - `packages/cli/test/security-check.test.ts`
  - `crates/drift-engine/tests/security_check_repo_phase4.rs`

  Test names:

  - `passes accepted phase4 requires fields to rust engine`
  - `engine blocks tenant missing predicate from accepted phase4 contract`

  Run:

  ```bash
  pnpm --filter @drift/cli test -- security-check
  cargo test -p drift-engine engine_blocks_tenant_missing_predicate_from_accepted_phase4_contract -- --nocapture
  ```

  Expected RED: fail because accepted Phase 4 contract fields are not wired from
  TypeScript check orchestration into Rust check evaluation.

- [ ] **Task 4.34: GREEN engine request path**

  Implementation files:

  - `packages/cli/src/engine/engine-check.ts`
  - `crates/drift-engine/src/protocol.rs`
  - `crates/drift-engine/src/check_command.rs`

  Implement wiring only:

  - Preserve accepted Phase 4 `requires.*` fields in the engine request.
  - Preserve matcher path/method/file-role scope.
  - Reject legacy `matcher.required_calls` as Phase 4 proof truth.
  - Keep candidate evidence out of deterministic rule inputs.

  Run:

  ```bash
  pnpm --filter @drift/cli test -- security-check
  cargo test -p drift-engine engine_blocks_tenant_missing_predicate_from_accepted_phase4_contract -- --nocapture
  ```

  Expected GREEN: pass.

- [ ] **Task 4.35: RED query, CLI, scan status, and repo map output**

  Test files:

  - `packages/query/test/security-boundary-proof.test.ts`
  - `packages/cli/test/security-check.test.ts`
  - `packages/cli/test/cli.test.ts`

  Test names:

  - `summarizes phase4 proof without synthesizing trust from raw facts`
  - `returns phase4 proof in drift check json output`
  - `scan status reports tenant authorization and session trust capabilities`
  - `repo map reports route tenant authorization and session summaries`

  Run:

  ```bash
  pnpm --filter @drift/query test -- security-boundary-proof
  pnpm --filter @drift/cli test -- security-check
  pnpm --filter @drift/cli test -- "scan status reports tenant authorization and session trust capabilities"
  pnpm --filter @drift/cli test -- "repo map reports route tenant authorization and session summaries"
  ```

  Expected RED: fail because read models and CLI output do not expose Phase 4
  Rust-owned proof truth.

- [ ] **Task 4.36: GREEN query, CLI, scan status, and repo map output**

  Implementation files:

  - `packages/query/src/security-boundary-proof.ts`
  - `packages/query/src/index.ts`
  - `packages/cli/src/check/security-check.ts`
  - `packages/cli/src/check/run-check.ts`
  - `packages/cli/src/domain/scan-status.ts`
  - `packages/cli/src/commands/scan.ts`
  - `packages/cli/src/commands/repo-map.ts`

  Implement read/output wiring only:

  - Query consumes Rust proof and parser gaps; it does not infer proof from raw
    facts.
  - CLI JSON includes `session_trust`, `authorization`, and `tenant` proof
    summaries.
  - Human CLI output names contract, route/file, line ranges, proof status,
    missing-proof code, capability, and lifecycle.
  - Output contains no snippets or sensitive values.

  Run:

  ```bash
  pnpm --filter @drift/query test -- security-boundary-proof
  pnpm --filter @drift/cli test -- security-check
  pnpm --filter @drift/cli test -- "scan status reports tenant authorization and session trust capabilities"
  pnpm --filter @drift/cli test -- "repo map reports route tenant authorization and session summaries"
  ```

  Expected GREEN: pass.

- [ ] **Task 4.37: RED MCP Phase 4 read model**

  Test file: `packages/mcp/test/mcp.test.ts`

  Test name: `exposes phase4 security proof summaries without snippets`

  Run:

  ```bash
  pnpm --filter @drift/mcp test -- "phase4 security proof"
  ```

  Expected RED: fail because MCP read-only context does not expose Phase 4 proof
  summaries from query output.

- [ ] **Task 4.38: GREEN MCP Phase 4 read model**

  Implementation files:

  - `packages/mcp/src/security-context.ts`
  - `packages/mcp/src/index.ts`
  - `packages/mcp/src/tools.ts`
  - `packages/query/src/security-boundary-proof.ts`

  Implement read model only:

  - MCP surfaces accepted Phase 4 contracts, route proof status, missing proof,
    parser gaps, and capabilities.
  - MCP does not duplicate rule logic.
  - MCP output does not include snippets, session values, tenant values, user
    values, headers, cookies, request payloads, tokens, or secrets.

  Run:

  ```bash
  pnpm --filter @drift/mcp test -- "phase4 security proof"
  ```

  Expected GREEN: pass.

- [ ] **Task 4.39: RED lifecycle, waiver, baseline, and diff-scope preservation**

  Test files:

  - `packages/cli/test/security-check.test.ts`
  - `test/e2e/security-validation.test.ts`

  Test names:

  - `phase4 findings respect waivers baselines and lifecycle`
  - `phase4 findings respect changed hunk scope`

  Run:

  ```bash
  pnpm --filter @drift/cli test -- security-check
  pnpm test:e2e -- security-validation
  ```

  Expected RED: fail if Phase 4 findings bypass existing waiver, baseline,
  lifecycle, check-run, or diff-scope behavior.

- [ ] **Task 4.40: GREEN lifecycle, waiver, baseline, and diff-scope preservation**

  Implementation files:

  - `packages/cli/src/check/run-check.ts`
  - `packages/cli/src/check/security-check.ts`
  - `packages/query/src/security-boundary-proof.ts`
  - `packages/storage/src/sqlite-storage.ts`

  Implement preservation:

  - Reuse existing finding fingerprint and lifecycle machinery.
  - Include stable Phase 4 finding metadata: contract ID, route ID, file path,
    fact IDs, missing-proof code, parser-gap ID, capability, and proof status.
  - Do not persist snippets or sensitive values.

  Run:

  ```bash
  pnpm --filter @drift/cli test -- security-check
  pnpm test:e2e -- security-validation
  ```

  Expected GREEN: pass.

- [ ] **Task 4.41: RED Phase 4 e2e fixture matrix**

  Fixture names:

  - `test/fixtures/security-tenant-missing`
  - `test/fixtures/security-tenant-param-unused`
  - `test/fixtures/security-tenant-bound-to-query`
  - `test/fixtures/security-tenant-untrusted-source`
  - `test/fixtures/security-tenant-parser-gap`
  - `test/fixtures/security-role-missing`
  - `test/fixtures/security-role-guard-present`
  - `test/fixtures/security-role-branch-bypass`
  - `test/fixtures/security-session-from-request-untrusted`
  - `test/fixtures/security-session-trusted-helper`

  Test file: `test/e2e/security-tenant-authorization.test.ts`

  Test name:
  `security tenant authorization fixture matrix proves phase4 trust and gaps`

  Run:

  ```bash
  pnpm test:e2e -- security-tenant-authorization
  ```

  Expected RED: fail because Phase 4 fixtures and end-to-end assertions do not
  exist.

- [ ] **Task 4.42: GREEN Phase 4 e2e fixture matrix**

  Implementation files:

  - `test/e2e/security-tenant-authorization.test.ts`
  - `test/fixtures/security-tenant-missing/package.json`
  - `test/fixtures/security-tenant-missing/app/api/projects/route.ts`
  - `test/fixtures/security-tenant-param-unused/package.json`
  - `test/fixtures/security-tenant-param-unused/app/api/projects/route.ts`
  - `test/fixtures/security-tenant-bound-to-query/package.json`
  - `test/fixtures/security-tenant-bound-to-query/app/api/projects/route.ts`
  - `test/fixtures/security-tenant-untrusted-source/package.json`
  - `test/fixtures/security-tenant-untrusted-source/app/api/projects/route.ts`
  - `test/fixtures/security-tenant-parser-gap/package.json`
  - `test/fixtures/security-tenant-parser-gap/app/api/projects/route.ts`
  - `test/fixtures/security-role-missing/package.json`
  - `test/fixtures/security-role-missing/app/api/projects/route.ts`
  - `test/fixtures/security-role-guard-present/package.json`
  - `test/fixtures/security-role-guard-present/app/api/projects/route.ts`
  - `test/fixtures/security-role-branch-bypass/package.json`
  - `test/fixtures/security-role-branch-bypass/app/api/projects/route.ts`
  - `test/fixtures/security-session-from-request-untrusted/package.json`
  - `test/fixtures/security-session-from-request-untrusted/app/api/projects/route.ts`
  - `test/fixtures/security-session-trusted-helper/package.json`
  - `test/fixtures/security-session-trusted-helper/app/api/projects/route.ts`

  Fixture expectations:

  - Tenant missing predicate blocks.
  - Tenant param read but unused blocks.
  - Trusted session tenant bound to data predicate passes.
  - Untrusted request-derived tenant source blocks.
  - Dynamic tenant predicate emits parser-gap-backed evidence.
  - Role-required route without accepted authorization guard blocks.
  - Accepted role guard with trusted session passes.
  - Role guard in only one branch blocks.
  - Session object from request is untrusted.
  - Accepted auth helper creates trusted session proof.
  - No fixture expected output includes snippets, session values, tenant values,
    user values, headers, cookies, request payloads, tokens, secrets, or raw SQL
    values.

  Run:

  ```bash
  pnpm test:e2e -- security-tenant-authorization
  ```

  Expected GREEN: pass.

- [ ] **Task 4.43: RED capability truth for Phase 4**

  Test file: `crates/drift-engine/tests/security_capabilities.rs`

  Test name: `phase4_capabilities_reflect_supported_parser_gaps_and_contracts`

  Run:

  ```bash
  cargo test -p drift-engine phase4_capabilities_reflect_supported_parser_gaps_and_contracts -- --nocapture
  ```

  Expected RED: fail because capability reporting does not account for Phase 4
  supported, partial, parser-gap, and unsupported states.

- [ ] **Task 4.44: GREEN capability truth for Phase 4**

  Implementation files:

  - `crates/drift-engine/src/security_capabilities.rs`
  - `crates/drift-engine/src/security_proof.rs`
  - `packages/cli/src/domain/scan-status.ts`

  Implement capability truth:

  - Report `session_trust`, `authorization`, and `tenant_scope` separately.
  - Mark deterministic support only when accepted contract input, proof
    construction, parser-gap reporting, and rule evaluation are wired.
  - Mark partial/unsupported for dynamic tenant shapes and unresolved wrappers.
  - Do not mark candidate-only evidence as deterministic support.

  Run:

  ```bash
  cargo test -p drift-engine phase4_capabilities_reflect_supported_parser_gaps_and_contracts -- --nocapture
  pnpm --filter @drift/cli test -- "scan status reports tenant authorization and session trust capabilities"
  ```

  Expected GREEN: pass.

- [ ] **Task 4.45: Phase 4 full gate**

  Run all commands, no shortcuts:

  ```bash
  cargo test -p drift-engine security_
  cargo test -p drift-engine
  pnpm --filter @drift/core test
  pnpm --filter @drift/engine-contract test
  pnpm --filter @drift/query test
  pnpm --filter @drift/cli test
  pnpm --filter @drift/mcp test
  pnpm test:e2e
  pnpm typecheck
  cargo fmt --all -- --check
  cargo clippy -p drift-engine --all-targets -- -D warnings
  git diff --check
  ```

  Expected: all pass.

  Required completion notes:

  - Phase 4 tasks completed.
  - Files changed.
  - Exact RED/GREEN commands run and pass/fail status.
  - Exact final gates run and pass/fail status.
  - Any baseline failures or blockers with exact command output summary.
  - Any intentional snapshot/output changes.
  - Confirmation that Phase 5+ was not implemented.

## Phase 5: Sensitive Response And Secrets Exposure

Purpose: prevent accepted sensitive fields and secrets from reaching response/log sinks.

Add facts:

- `sensitive_field_declared`
- `response_emits_field`
- `serializer_called`
- `secret_read`

Add contracts:

- `api_route_forbids_sensitive_response_fields`
- `api_route_forbids_secret_exposure`

Create fixtures:

- `test/fixtures/security-sensitive-leak`
- `test/fixtures/security-sensitive-serializer-pass`
- `test/fixtures/security-secret-leak`
- `test/fixtures/security-response-spread-missing-proof`

Required RED tests:

- Accepted sensitive field emitted without serializer blocks.
- Accepted serializer filtering sensitive field passes.
- Secret read flows directly to response/log and blocks.
- Object spread over response shape emits missing proof under blocking contract.
- Candidate sensitive field does not block until accepted.

Done when:

- Secret values are never stored or emitted.
- Sensitive-field blocking requires accepted field classification or accepted schema metadata.

## Phase 6: SSRF, Raw SQL, CORS, CSRF, And Rate Limits

Purpose: enforce high-value sink policies.

Add facts:

- `outbound_request_called`
- `raw_sql_called`
- `parameterized_sql_used`
- `cors_policy_declared`
- `csrf_guard_called`
- `rate_limit_guard_called`

Add contracts:

- `api_route_forbids_untrusted_ssrf`
- `api_route_forbids_raw_sql_without_params`
- `api_route_cors_must_match_policy`
- `api_route_requires_csrf_for_mutation`
- `api_route_requires_rate_limit`

Create fixtures:

- `test/fixtures/security-ssrf`
- `test/fixtures/security-ssrf-allowlist-pass`
- `test/fixtures/security-raw-sql`
- `test/fixtures/security-raw-sql-parameterized-pass`
- `test/fixtures/security-csrf-missing`
- `test/fixtures/security-rate-limit-missing`
- `test/fixtures/security-cors-policy-violation`

Required RED tests:

- Request-controlled URL reaches outbound request and blocks.
- Constant or accepted allowlisted URL passes.
- Raw SQL interpolation with untrusted input blocks.
- Parameterized SQL passes.
- Mutation route without accepted CSRF proof blocks when required.
- Login/public route without accepted rate limit proof blocks when required.
- CORS wildcard with credentials blocks.

Done when:

- Unknown sanitizer/wrapper is missing proof, not pass.
- CORS/CSRF/rate-limit default framework behavior is advisory unless accepted.

## Phase 7: Candidate Inference And Elections

Purpose: make security convention discovery useful without auto-enforcement.

Modify:

- `packages/cli/src/domain/convention-candidates.ts`
- `crates/drift-engine/src/candidate_command.rs`
- `packages/cli/src/commands/contract.ts`
- `packages/cli/src/commands/support.ts`

Candidate types:

- auth helper candidate
- middleware protection candidate
- validation helper candidate
- tenant helper candidate
- serializer candidate
- sensitive field candidate
- SQL safe wrapper candidate
- SSRF allowlist/sanitizer candidate
- CSRF helper candidate
- rate-limit helper candidate
- CORS policy candidate

Required RED tests:

- Candidate is generated from repeated auth helper usage but defaults to `warn` or `brief`.
- Candidate cannot produce blocking finding until accepted.
- Accepted candidate becomes contract input for Rust proof.
- Rejected candidate is not re-proposed without new evidence.

Done when:

- Elections remain the path from inference to enforcement.
- Candidate output includes evidence counts, confidence, suggested contract, suggested mode, and reason it is not auto-blocking.

## Election And Governance Model

Security enforcement must follow this lifecycle:

```text
scan facts
  -> infer candidate
  -> user/agent accepts candidate into repo contract
  -> contract validation confirms deterministic capability if enforcement_mode=block
  -> check maps accepted contract into Rust engine contract input
  -> Rust emits proof/finding/missing-proof/parser-gap
  -> CLI/storage applies diff status, baseline, waiver, exception, and lifecycle state
```

Election rules:

- Candidates never block.
- Candidate default mode must be `brief` or `warn` unless the user explicitly accepts `block`.
- A candidate cannot become `deterministic_check` unless the required fact/proof/capability is complete.
- A rejected candidate must not be re-proposed unless the evidence fingerprint changes.
- Accepted contracts must preserve `accepted_by`, `accepted_at`, `updated_at`, optional `expires_at`, evidence refs, and counterexample refs.
- Contract validation must reject `enforcement_mode="block"` when the contract kind is statically defined as `heuristic_check`, `briefing_only`, or unsupported for the declared framework/scope.
- Runtime capability status such as `partial` is evaluated during `drift check`: matched routes with blocking contracts and route-specific parser gaps must fail closed with parser-gap-backed findings, while routes with complete deterministic proof may pass.
- Exceptions are part of accepted contract shape. Waivers are materialized governance state. They are not interchangeable.
- Waivers that require reapproval must bind to file hashes and become stale when content changes.
- Baselines mark existing violations as `pre_existing`; they must not hide new changed-scope violations.
- Expired conventions must stop enforcing and expire related findings through existing lifecycle behavior.

Candidate output must include:

```json
{
  "candidate_id": "candidate_security_auth_helper_requireUser",
  "kind": "api_route_requires_auth_helper",
  "confidence_label": "high",
  "suggested_enforcement_mode": "warn",
  "capability": "deterministic_check",
  "supporting_examples_count": 12,
  "counterexamples_count": 1,
  "evidence_refs": ["evidence_..."],
  "reason_not_blocking": "candidate_not_accepted"
}
```

## Phase 8: CLI And MCP UX

Purpose: expose proof truth safely to humans and agents.

Modify:

- `packages/cli/src/commands/scan-status.ts`
- `packages/cli/src/commands/repo-map.ts`
- `packages/cli/src/check/security-check.ts`
- `packages/cli/src/formatters/checks.ts`
- `packages/mcp/src/security-context.ts`
- `packages/mcp/src/tools.ts`

CLI output requirements:

- `drift scan status --json` includes `security_capabilities`.
- `drift check --json` includes `security_boundary_proofs`.
- Human check output names route, contract, reason, evidence lines, capability, lifecycle, and next command.
- `drift repo map --json` includes route security summaries.
- `drift contract validate --json` validates security contracts and rejects invalid blocking heuristic contracts.
- `drift candidates --json` includes security convention candidates.

MCP output requirements:

- Agents receive accepted security contracts relevant to changed files.
- Agents receive missing proof summaries, not source snippets.
- Agents receive required proof obligations before editing.
- MCP uses query/read-model functions, not duplicate security logic.

Required `drift scan status --json` addition:

```json
{
  "security_capabilities": [
    {
      "name": "control_flow_guard_dominance",
      "capability": "deterministic_check",
      "status": "partial",
      "can_block": true,
      "parser_gap_count": 1,
      "missing_proof_count": 2,
      "affected_files": ["app/api/users/route.ts"]
    }
  ]
}
```

Required `drift check --json` addition:

```json
{
  "security_boundary_proofs": [
    {
      "proof_id": "proof_route_users_get",
      "route": {
        "route_id": "route_users_get",
        "file_path": "app/api/users/route.ts"
      },
      "auth": {
        "required": true,
        "proven": false,
        "undominated_sinks": [
          {
            "sink_kind": "data_operation",
            "reason": "guard_after_sink"
          }
        ]
      },
      "result": {
        "proof_status": "violated",
        "enforcement_result": "block"
      }
    }
  ]
}
```

Required human check output shape:

```text
BLOCK api_route_requires_auth_helper
  Route: GET /api/users
  File: app/api/users/route.ts
  Reason: auth guard does not dominate data operation
  Evidence: auth_guard_called line 18; data_operation_detected line 12
  Capability: control_flow_guard_dominance deterministic_check
  Lifecycle: new, changed-files
  Next: drift repo map --repo <repo_id> --path app/api/users/route.ts --json
```

Required `drift repo map --json` route security shape:

```json
{
  "routes": [
    {
      "route_id": "route_users_get",
      "path": "/api/users",
      "method": "GET",
      "file_path": "app/api/users/route.ts",
      "security": {
        "public_or_protected": "protected",
        "auth_proven": true,
        "middleware_proven": false,
        "tenant_scope": "missing_proof",
        "request_validation": "not_required",
        "sensitive_response": "unknown"
      }
    }
  ]
}
```

Required MCP security context shape:

```json
{
  "repo_security_contracts": [
    {
      "kind": "api_route_requires_auth_helper",
      "enforcement_mode": "block",
      "matcher_summary": "API routes under /api/**",
      "trusted_helpers": ["requireUser"]
    }
  ],
  "changed_route_security": [
    {
      "route_id": "route_users_get",
      "file_path": "app/api/users/route.ts",
      "required_proofs": [
        "auth guard must dominate data and response sinks"
      ],
      "current_proof_status": "missing_proof"
    }
  ],
  "do_not_include": [
    "source snippets",
    "secret values",
    "raw request payload examples"
  ]
}
```

Done when:

- CLI/MCP parity tests pass.
- No output includes source snippets or secrets.

## Migration And Compatibility Plan

Rules:

- Migrations are additive and nullable.
- Existing DBs and contracts keep working.
- Existing findings are not rewritten.
- Existing check runs do not require security proof rows.
- Existing contract kinds remain valid.
- Security finding fingerprints use contract kind, route ID, missing-proof code, sink stable key, and helper/sink symbol. They must not rely on raw line number alone.

Production readiness requirements:

- Every migration must apply to an empty DB and an existing migrated DB.
- Every migration must be covered by a storage round-trip test.
- Existing backups/restores must still validate.
- Existing contract export/import must preserve unknown future security fields only where schema explicitly allows forward compatibility.
- `contract validate` must reject invalid security contracts before they can reach a check run.
- Every check run must record machine contract versions, engine/rule versions, fallback status, capability completeness, and audit integrity as current Drift does.

Contract schema versioning:

```json
{
  "schema_version": "drift.repo-contract/v3",
  "security": {
    "contracts": []
  }
}
```

Engine contract versioning:

```json
{
  "engine_contract_version": "drift.engine-contract/security-v1",
  "trusted_auth_helpers": [],
  "trusted_authorization_helpers": [],
  "trusted_tenant_helpers": [],
  "trusted_validation_helpers": [],
  "trusted_serializers": [],
  "security_sink_profiles": [],
  "framework_security_profiles": []
}
```

Compatibility rules:

- Existing contracts with no `security` section behave exactly as before.
- Existing non-security rules continue to run even when security engine-contract input is unsupported.
- Blocking security checks must not run without a compatible security engine contract; they must report unsupported capability truth instead.
- Unknown new security contract kinds fail validation in strict mode.

Add only when proof shape stabilizes:

- `security_proofs`
- `security_missing_proofs`
- `security_parser_gaps`
- `scan_security_capabilities`
- optional `security_graph_edges` if current graph projections cannot represent evidence cleanly

`security_parser_gaps` is required unless an existing generic parser-gap table already supports `check_run_id`, `capability`, `affected_contract_kinds`, `affected_route_ids`, `missing_proof_ids`, and `blocks_enforcement`. If reusing an existing parser-gap table, add a storage test proving security parser gaps round-trip with those fields.

Required logical parser-gap shape:

```ts
type StoredSecurityParserGap = {
  parser_gap_id: string;
  check_run_id: string;
  capability: string;
  code: string;
  file_path: string;
  start_line?: number;
  end_line?: number;
  reason: string;
  affected_contract_kinds: string[];
  affected_route_ids: string[];
  missing_proof_ids: string[];
  blocks_enforcement: boolean;
  metadata_json: string;
};
```

Every security finding must persist metadata equivalent to:

```json
{
  "security_proof_id": "proof_...",
  "security_capability": "control_flow_guard_dominance",
  "security_contract_kind": "api_route_requires_auth_helper",
  "contract_id": "security_api_auth_require_user",
  "route_id": "route_users_get",
  "missing_proof_code": "auth_guard_not_dominating_sink",
  "parser_gap_ids": [],
  "graph_edge_ids": [],
  "evidence_fact_ids": [],
  "sink_stable_key": "route_users_get:data_operation:users_read"
}
```

Security finding fingerprints must include `contract_id`, `security_contract_kind`, `route_id`, `missing_proof_code`, `sink_stable_key`, and relevant helper/sink symbol. They must not rely on raw line number alone.

Do not add a migration with a stale number. Use the next number after the current `packages/storage/src/migrations.ts` tail.

## Fixture Matrix

Required durable fixtures:

- `security-auth-missing`
- `security-auth-before-sink`
- `security-auth-after-data`
- `security-auth-branch-bypass`
- `security-auth-callback-bypass`
- `security-dynamic-control-flow`
- `security-dynamic-import-parser-gap`
- `security-middleware-covered`
- `security-middleware-mismatch`
- `security-middleware-method-mismatch`
- `security-middleware-dynamic-parser-gap`
- `security-validation-missing`
- `security-validation-result-unused`
- `security-validation-before-data`
- `security-validation-dynamic-body-parser-gap`
- `security-tenant-missing`
- `security-tenant-param-unused`
- `security-tenant-bound-to-query`
- `security-role-missing`
- `security-role-guard-present`
- `security-session-from-request-untrusted`
- `security-sensitive-leak`
- `security-sensitive-serializer-pass`
- `security-secret-leak`
- `security-response-spread-missing-proof`
- `security-ssrf`
- `security-ssrf-allowlist-pass`
- `security-raw-sql`
- `security-raw-sql-parameterized-pass`
- `security-csrf-missing`
- `security-rate-limit-missing`
- `security-cors-policy-violation`
- `security-public-route-exception`
- `security-waived-finding`
- `security-baseline-pre-existing`

Across each phase's fixture family, the fixtures must prove:

- pass case
- fail case
- missing proof or parser gap when applicable
- accepted contract behavior
- candidate-only behavior where applicable
- diff-scoped blocking behavior
- waiver or baseline behavior when applicable
- Dynamic import or computed handler export that affects a matched blocking route emits parser gap `dynamic_import` or `computed_handler_export`, creates matching `missing_proof`, and blocks only in changed diff scope.

## Verification Commands

Focused Rust:

```bash
cargo test -p drift-engine security_facts
cargo test -p drift-engine security_control_flow
cargo test -p drift-engine security_rules
cargo test -p drift-engine security_proof
```

Focused TypeScript:

```bash
pnpm --filter @drift/core test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/factgraph test
pnpm --filter @drift/storage test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
```

E2E:

```bash
pnpm test:e2e
```

Golden tests:

- `SecurityBoundaryProof` JSON golden.
- `drift check --json` security finding golden.
- `drift scan status --json` security capability golden.
- `drift repo map --json` route security summary golden.
- `drift candidates --json` security candidate golden.
- Human check output golden.

Regression tests:

- Auth-like helper name without accepted contract never blocks.
- Middleware file exists but matcher excludes route does not satisfy auth.
- Session read from request header is not trusted.
- Validator called but raw request input used still blocks.
- Sensitive field behind object spread emits missing proof under blocking sensitive-response contract.
- Raw SQL placeholder/parameterized query passes.
- Raw SQL string concat or interpolation with untrusted input blocks.
- Parser gap never silently passes for a matched blocking contract.

Final:

```bash
pnpm verify:ci
```

## GPT Pro Coverage Matrix

This matrix is the self-check that the implementation brief is fully represented.

| GPT Pro Requested Section | Covered Here |
| --- | --- |
| Current model summary | `Current Baseline`, `Information Flow To Preserve` |
| Security capability model | `Security Capability Index` |
| New fact kinds | `New Fact Kind Index`, `Fact Detection Contracts` |
| Graph model | `Graph Model` |
| Contract design | `Security Contract Index`, `Contract Registry Matrix` |
| Proof model | `Security Boundary Proof Shape` |
| Control-flow strategy | `Control-Flow Proof Strategy` |
| Implementation directory/file plan | `Directory Structure And Single Responsibility`, phase file lists |
| Incremental build slices | `Phase 0` through `Phase 8` |
| Test plan | `Phase Gates`, phase RED tests, `Fixture Matrix`, `Verification Commands` |
| Migration/compatibility plan | `Migration And Compatibility Plan` |
| CLI and MCP UX | `Phase 8: CLI And MCP UX` |
| Risk register | `Risk Register` |
| Final recommendation | `First PR Recommendation` |

## Risk Register

| Risk | Failure Mode | Required Mitigation |
| --- | --- | --- |
| Helper name false confidence | `auth()` name does not enforce auth | Blocking only after accepted helper contract |
| Framework middleware differences | Matcher proof wrong | Static supported patterns only; dynamic matcher parser gap |
| Dynamic control flow | Runtime bypass missed | Emit `unsupported_dynamic_control_flow`; fail closed for blocking contracts |
| Callback bypass | Guard in callback treated as guard for outer path | Callback boundary fact; no dominance unless explicitly modeled |
| Tenant proof complexity | IDOR rules overclaim | Start with explicit accepted tenant helpers and simple predicates |
| Sensitive field false positives | Benign field blocks work | Candidate-only until field classification accepted |
| Secret egress | Tool leaks secret value | Store secret class/hash only, never value |
| Performance | Route proof slows checks | Scope to changed routes/files; cache by file hash |
| Overblocking parser gaps | Users blocked by unsupported syntax | Only fail closed for accepted blocking contracts in changed scope; exact next command |
| Fingerprint churn | Findings unstable across line changes | Fingerprint route/contract/missing-proof/sink keys, not only line |

## Autonomous Worker Stop Conditions

The worker must stop and report instead of guessing when:

- A deterministic proof would require executing repo code.
- A framework pattern is not statically modeled.
- A helper appears security-related but is not accepted.
- A sink/source flow crosses unsupported dynamic dispatch.
- A parser gap affects a blocking accepted contract.
- Existing non-security behavior regresses.
- A migration would rewrite existing findings or check runs.
- CLI/MCP output would require source snippets to explain the issue.

These stop conditions apply to implementation work. Runtime Drift behavior must not abort solely because a parser gap exists. At runtime, parser gaps are emitted as evidence, attached to proofs/findings, and enforced according to the matched accepted contract, diff scope, baseline, waiver, and lifecycle state.

## First PR Recommendation

The first implementation PR must be Phase 1 only.

Do not start with SSRF, tenant, SQL injection, CORS, CSRF, rate limits, or sensitive data. Those depend on the same proof machinery. The first PR proves the machinery with the already-named repo gap: real deterministic `api_route_requires_auth_helper` enforcement.

First PR deliverables:

- Minimal security facts.
- File-local control-flow dominance.
- Deterministic auth proof.
- `api_route_requires_auth_helper` Rust rule.
- CLI JSON/human output.
- Query read model.
- Durable fixtures.
- No snippets/secrets.
- Existing Drift checks unchanged.

First PR is complete only when:

```bash
cargo test -p drift-engine security_
pnpm --filter @drift/core test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm test:e2e
pnpm verify:ci
```

all pass.
