# Phase 3 Request Validation Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Phase 3 request-validation enforcement to production-grade by closing the review findings without expanding into Phase 4+.

**Architecture:** Rust remains the deterministic authority for request-input parsing, accepted validator normalization, source-to-sink proof, parser gaps, missing proof, and blocking rule evaluation. TypeScript remains schemas, engine-contract validation, storage/query/read models, CLI/MCP envelopes, governance, candidates, and formatting only. Raw scan facts are evidence, not proof.

**Tech Stack:** Rust `drift-engine`, TypeScript packages under `packages/*`, Vitest, pnpm, cargo test/fmt/clippy.

---

## Preconditions

- Base this corrective slice on `codex/security-request-validation-phase3`.
- Keep the PR base as `codex/security-middleware-phase2`.
- Do not touch unrelated untracked files:
  - `docs/superpowers/plans/2026-05-25-security-boundary-p1-corrective-plan.md`
  - `docs/superpowers/plans/2026-05-25-security-middleware-phase2-correction-plan.md`
  - `../drift v3 phase2 corrections/`
- Do not implement Phase 4+.
- No production code before a failing test.

Initial verification:

```bash
git fetch --all --prune
git switch codex/security-request-validation-phase3
git rev-list --left-right --count origin/codex/security-middleware-phase2...HEAD
```

Expected:

```text
0 1
```

## Files And Responsibilities

- `crates/drift-engine/src/security_patterns.rs`: accepted helper/schema/validator normalization only.
- `crates/drift-engine/src/security_facts.rs`: fact extraction only.
- `crates/drift-engine/src/security_control_flow.rs`: request-input and validated-variable source-to-sink summaries only.
- `crates/drift-engine/src/security_proof.rs`: proof, parser-gap, missing-proof construction only.
- `crates/drift-engine/src/security_rules.rs`: deterministic accepted-contract rule evaluation only.
- `crates/drift-engine/src/check_command.rs`: engine request/response wiring only.
- `crates/drift-engine/src/protocol.rs`: engine protocol shape only.
- `packages/cli/src/engine/engine-check.ts`: convert accepted contract payload into engine request shape only.
- `packages/cli/src/check/run-check.ts`: CLI finding mapping only.
- `packages/core/src/security.ts`: core security proof schema validation.
- `packages/engine-contract/src/index.ts`: engine contract schema validation.
- `packages/query/src/index.ts`: repo-map read model, no deterministic proof synthesis.
- `packages/mcp/src/security-context.ts`: MCP read model, no deterministic proof synthesis.
- `test/e2e/security-validation.test.ts`: e2e proof/assertion matrix.

---

## Task 1: Remove `matcher.required_calls` As Request-Validation Truth

**Risk addressed:** A convention with only `matcher.required_calls: ["validateInput"]` can currently make `validateInput(body)` prove request validation. Phase 3 accepted validators must come from `requires.validators` and `requires.schemas`.

**Files:**
- Modify: `packages/cli/test/security-check.test.ts`
- Modify: `packages/cli/src/engine/engine-check.ts`
- Create: `crates/drift-engine/tests/security_check_repo_request_validation.rs`
- Modify: `crates/drift-engine/src/check_command.rs`

- [ ] **Step 1: RED TypeScript request mapping test**

Add this test to `packages/cli/test/security-check.test.ts` near the existing engine request mapping tests:

```ts
it("does not convert matcher.required_calls into request validation requires", () => {
  const request = engineCheckRequest({
    repoId: "repo_abc",
    repoRoot: "/tmp/repo",
    scanId: "scan_abc",
    snapshots: [],
    facts: [],
    conventions: [{
      id: "security_api_request_validation",
      repo_id: "repo_abc",
      contract_id: "contract_abc",
      kind: "api_route_requires_request_validation",
      statement: "API request input must be validated.",
      scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_requires_request_validation",
        required_calls: ["validateInput"],
        applies_to_file_roles: ["api_route"]
      },
      severity: "error",
      enforcement_mode: "block",
      enforcement_capability: "deterministic_check",
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "test",
      accepted_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z"
    }],
    baseline: [],
    diff: { files: [], deletedFiles: [] },
    scope: "full"
  });

  expect(request.contract.conventions[0]?.requires).toBeUndefined();
});
```

- [ ] **Step 2: Run RED TypeScript command**

Run:

```bash
pnpm --filter @drift/cli test -- "does not convert matcher.required_calls into request validation requires"
```

Expected RED: fail because `engine-check.ts` maps `matcher.required_calls` into `requires.validators`.

- [ ] **Step 3: GREEN TypeScript mapping**

In `packages/cli/src/engine/engine-check.ts`, change `securityRequires` so `api_route_requires_request_validation` only returns `requires` when the accepted convention already has a real `requires` object. Do not synthesize validators from `matcher.required_calls`.

Implementation rule:

```ts
if (convention.kind === "api_route_requires_request_validation") {
  return undefined;
}
```

This branch must come after the existing explicit `requires` pass-through.

- [ ] **Step 4: Run GREEN TypeScript command**

Run:

```bash
pnpm --filter @drift/cli test -- "does not convert matcher.required_calls into request validation requires"
```

Expected GREEN: pass.

- [ ] **Step 5: RED Rust engine check test**

Create `crates/drift-engine/tests/security_check_repo_request_validation.rs` with a helper-shaped contract using only `matcher.required_calls`.

Test name:

```rust
#[test]
fn check_repo_does_not_accept_matcher_required_calls_as_request_validators()
```

Core fixture:

```rust
let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const input = validateInput(body);
  await db.project.create({ data: input });
  return Response.json({ ok: true });
}
"#;
```

Build a `CheckRequest` with:

```json
{
  "kind": "api_route_requires_request_validation",
  "matcher": {
    "required_calls": ["validateInput"],
    "applies_to_file_roles": ["api_route"]
  },
  "requires": null,
  "enforcement_capability": "deterministic_check",
  "enforcement_mode": "block"
}
```

Assert:

```rust
assert!(result.findings.is_empty());
assert!(result.security_boundary_proofs.is_empty());
```

- [ ] **Step 6: Run RED Rust command**

Run:

```bash
cargo test -p drift-engine check_repo_does_not_accept_matcher_required_calls_as_request_validators -- --nocapture
```

Expected RED: fail because `check_command.rs` currently treats `matcher.required_calls` as accepted request validators.

- [ ] **Step 7: GREEN Rust check wiring**

In `crates/drift-engine/src/check_command.rs`, remove the `matcher.required_calls` branch from `accepted_request_validators_for_convention`. Only parse:

- `requires.validators`
- `requires.schemas`

Do not add compatibility fallback for request validation.

- [ ] **Step 8: Run GREEN Rust command**

Run:

```bash
cargo test -p drift-engine check_repo_does_not_accept_matcher_required_calls_as_request_validators -- --nocapture
```

Expected GREEN: pass.

---

## Task 2: No-Request-Input Routes Must Not Block

**Risk addressed:** Routes with no request input reads currently become missing-proof findings because the proof is not proven.

**Files:**
- Modify: `crates/drift-engine/tests/security_rules.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Modify: `crates/drift-engine/src/check_command.rs`

- [ ] **Step 1: RED proof test**

Add to `crates/drift-engine/tests/security_rules.rs`:

```rust
#[test]
fn route_without_request_input_does_not_require_request_validation() {
    let source = r#"
const db = { project: { findMany: async () => [] } };
export async function GET() {
  const projects = await db.project.findMany();
  return Response.json(projects);
}
"#;
    let findings = evaluate_api_route_requires_request_validation(
        "app/api/projects/route.ts",
        source,
        &SecurityRequestValidationContract {
            contract_id: "security_api_request_validation".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_validators: vec![AcceptedRequestValidator {
                validator_id: "schema_project_input".to_string(),
                symbol: "ProjectInputSchema".to_string(),
                kind: RequestValidatorKind::Schema,
                behavior: RequestValidatorBehavior::ReturnsParsed,
            }],
        },
    )
    .expect("request validation findings");

    assert!(findings.is_empty(), "no request input should not block: {findings:#?}");
}
```

- [ ] **Step 2: Run RED command**

Run:

```bash
cargo test -p drift-engine route_without_request_input_does_not_require_request_validation -- --nocapture
```

Expected RED: fail because a missing proof is emitted for a route that does not read request input.

- [ ] **Step 3: GREEN proof semantics**

In `crates/drift-engine/src/security_proof.rs`, make `build_request_validation_proof` return a non-blocking proof when `input_reads.is_empty()`:

- `request_validation.required = false`
- `request_validation.proven = false`
- `result.proof_status = SecurityProofStatus::Proven`
- no missing proof
- no parser gap

This means: no request input means no request-validation obligation for this phase.

- [ ] **Step 4: GREEN check wiring**

In `crates/drift-engine/src/check_command.rs`, keep proof emission optional. If proof has `request_validation.required == false`, do not emit a finding. It is acceptable to omit the proof from `security_boundary_proofs` for no-input routes.

- [ ] **Step 5: Run GREEN command**

Run:

```bash
cargo test -p drift-engine route_without_request_input_does_not_require_request_validation -- --nocapture
```

Expected GREEN: pass.

---

## Task 3: Tighten `safeParse` Proof Semantics

**Risk addressed:** `safeParse` currently accepts bare result use and can be fooled by a string containing `return`.

**Files:**
- Modify: `crates/drift-engine/tests/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`

- [ ] **Step 1: RED bare-result test**

Add to `crates/drift-engine/tests/security_control_flow.rs`:

```rust
#[test]
fn safe_parse_bare_result_is_not_validated_input() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const result = ProjectInputSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ ok: false }, { status: 400 });
  }
  await db.project.create({ data: result });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(!proof.request_validation.proven, "bare safeParse result must not prove validation");
    assert!(proof.request_validation.unvalidated_uses.iter().any(|use_proof|
        use_proof.reason == "validation_result_not_used"
            || use_proof.reason == "request_input_not_validated"
    ));
}
```

- [ ] **Step 2: RED fake-guard test**

Add:

```rust
#[test]
fn safe_parse_guard_must_exit_not_contain_return_string() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const result = ProjectInputSchema.safeParse(body);
  if (!result.success) {
    console.log("return later");
  }
  await db.project.create({ data: result.data });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(!proof.request_validation.proven, "fake success guard must not prove validation");
}
```

- [ ] **Step 3: RED `.data` alias pass test**

Add:

```rust
#[test]
fn safe_parse_data_alias_after_exit_guard_is_validated_input() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const result = ProjectInputSchema.safeParse(body);
  if (!result.success) {
    throw new Error("bad input");
  }
  const input = result.data;
  await db.project.create({ data: input });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(proof.request_validation.proven, "guarded safeParse .data alias should prove validation");
}
```

- [ ] **Step 4: Run RED command**

Run:

```bash
cargo test -p drift-engine safe_parse_ -- --nocapture
```

Expected RED: the bare-result and fake-guard tests fail, and `.data` aliasing fails if not tracked.

- [ ] **Step 5: GREEN safeParse control flow**

In `crates/drift-engine/src/security_control_flow.rs`:

- Accept `result.data` only after a real local exit guard.
- A real exit guard is one of:
  - `if (!result.success) return ...`
  - `if (!result.success) { return ... }`
  - `if (!result.success) throw ...`
  - `if (!result.success) { throw ... }`
  - `if (result.success) { sink(result.data) }`
- Strip string literals and line comments before searching for `return` or `throw`.
- Do not treat bare `result` as validated input.
- Track `const input = result.data;` after a valid guard as a validated variable alias.

- [ ] **Step 6: Run GREEN command**

Run:

```bash
cargo test -p drift-engine safe_parse_ -- --nocapture
```

Expected GREEN: all safeParse tests pass.

---

## Task 4: Inspect Full Sink Spans, Not Only Sink Start Lines

**Risk addressed:** A multi-line sink can use validated input on the first line and raw request input on later lines, passing incorrectly.

**Files:**
- Modify: `crates/drift-engine/tests/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`

- [ ] **Step 1: RED multi-line raw-mixed sink test**

Add:

```rust
#[test]
fn multiline_sink_with_validated_and_raw_values_blocks() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const input = ProjectInputSchema.parse(body);
  await db.project.create({
    data: input,
    audit: body
  });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(!proof.request_validation.proven, "raw body in multi-line sink must block");
    assert!(proof.request_validation.unvalidated_uses.iter().any(|use_proof|
        use_proof.reason == "request_input_not_validated"
    ));
}
```

- [ ] **Step 2: Run RED command**

Run:

```bash
cargo test -p drift-engine multiline_sink_with_validated_and_raw_values_blocks -- --nocapture
```

Expected RED: fail because only the sink start line is inspected.

- [ ] **Step 3: GREEN full-span sink inspection**

In `crates/drift-engine/src/security_control_flow.rs` and `crates/drift-engine/src/security_proof.rs`:

- Add a helper that reads all source lines from `sink.start_line..=sink.end_line`.
- Use that full text for:
  - raw input use detection
  - validated variable use detection
  - safeParse `.data` and alias checks
- Keep line numbers from the sink fact for evidence.

- [ ] **Step 4: Run GREEN command**

Run:

```bash
cargo test -p drift-engine multiline_sink_with_validated_and_raw_values_blocks -- --nocapture
```

Expected GREEN: pass.

---

## Task 5: Stop Query And MCP From Synthesizing Proof From Raw Facts

**Risk addressed:** TypeScript read models currently infer `proven` from raw facts, violating Rust proof ownership. Parser-gap cases can be reported as proven.

**Files:**
- Modify: `packages/query/test/security-boundary-proof.test.ts`
- Modify: `packages/query/src/index.ts`
- Modify: `packages/mcp/test/mcp.test.ts`
- Modify: `packages/mcp/src/security-context.ts`

- [ ] **Step 1: RED query repo-map test**

Add a test to `packages/query/test/security-boundary-proof.test.ts` or the repo-map query test file:

```ts
it("does not report request validation proven from raw scan facts", () => {
  const routeSecurity = routeSecurityFromFacts([
    {
      id: "fact_request_body",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "request_input_read",
      file_path: "app/api/projects/route.ts",
      name: "body",
      value: JSON.stringify({ route_id: "route:app/api/projects/route.ts:POST", source: "body", variable: "body" }),
      start_line: 3,
      end_line: 3
    },
    {
      id: "fact_validated_use",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "validated_input_used",
      file_path: "app/api/projects/route.ts",
      name: "input",
      value: JSON.stringify({ route_id: "route:app/api/projects/route.ts:POST", sink_kind: "data_operation" }),
      start_line: 5,
      end_line: 5
    }
  ] as never);

  expect(routeSecurity.request_validation.status).not.toBe("proven");
  expect(routeSecurity.request_validation.status).toBe("not_evaluated");
});
```

- [ ] **Step 2: RED MCP security-context test**

In `packages/mcp/test/mcp.test.ts`, change or add the request-validation security-context test so raw facts alone produce:

```ts
expect(securityContext.request_validation.routes[0]).toMatchObject({
  proof_status: "not_evaluated",
  proven: false
});
```

If parser gaps are present:

```ts
expect(securityContext.request_validation.routes[0].proof_status).not.toBe("proven");
```

- [ ] **Step 3: Run RED commands**

Run:

```bash
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/mcp test -- "request validation"
```

Expected RED: fail because query/MCP currently synthesize proof from facts.

- [ ] **Step 4: GREEN read model semantics**

In `packages/query/src/index.ts` and `packages/mcp/src/security-context.ts`:

- Raw facts may expose evidence summaries:
  - input sources
  - validated sink kinds
  - parser gaps
- Raw facts must not produce:
  - `status: "proven"`
  - `proof_status: "proven"`
  - `proven: true`
- Use `not_evaluated` for scan-only read models unless a Rust check proof is explicitly provided by the caller.

- [ ] **Step 5: Run GREEN commands**

Run:

```bash
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/mcp test -- "request validation"
```

Expected GREEN: pass.

---

## Task 6: Reject Impossible Request-Validation Proof States In Schemas

**Risk addressed:** TypeScript schemas accept impossible states, such as `proven: true` with `unvalidated_uses`.

**Files:**
- Modify: `packages/core/test/security.test.ts`
- Modify: `packages/core/src/security.ts`
- Modify: `packages/engine-contract/test/security-contract.test.ts`
- Modify: `packages/engine-contract/src/index.ts`

- [ ] **Step 1: RED core schema tests**

Add to `packages/core/test/security.test.ts`:

```ts
it("rejects impossible request validation proof states", () => {
  const proof = validSecurityBoundaryProof({
    request_validation: {
      required: true,
      proven: true,
      input_reads: [{ fact_id: "fact_body", source: "body", variable: "body" }],
      validations: [],
      validated_uses: [],
      unvalidated_uses: [{
        input_fact_id: "fact_body",
        sink_fact_id: "fact_sink",
        sink_kind: "data_operation",
        reason: "request_input_not_validated"
      }]
    },
    result: {
      proof_status: "proven",
      enforcement_result: "pass",
      can_block: false,
      finding_ids: []
    }
  });

  expect(() => SecurityBoundaryProofSchema.parse(proof)).toThrow(/request validation/i);
});
```

If no `validSecurityBoundaryProof` helper exists, create a local helper in the test file that returns the current minimal valid proof object used by existing tests.

- [ ] **Step 2: RED engine-contract schema test**

Mirror the same impossible proof in `packages/engine-contract/test/security-contract.test.ts` and assert `EngineSecurityProofEventSchema.safeParse(event).success === false`.

- [ ] **Step 3: Run RED commands**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected RED: schemas accept impossible proof states.

- [ ] **Step 4: GREEN schema refinements**

In both `packages/core/src/security.ts` and `packages/engine-contract/src/index.ts`, add schema-level refinement:

- If `request_validation.required && request_validation.proven`, then:
  - `unvalidated_uses.length === 0`
  - no request-validation `missing_proof` entries
  - no request-validation parser gaps with `blocks_enforcement === true`
  - `validated_uses.length > 0`
  - `result.proof_status === "proven"`
  - `result.enforcement_result === "pass"`

- If `request_validation.unvalidated_uses.length > 0`, then:
  - `request_validation.proven === false`
  - `result.proof_status !== "proven"`

- [ ] **Step 5: Run GREEN commands**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected GREEN: pass.

---

## Task 7: Preserve Specific Missing-Proof And Parser-Gap Reasons In CLI Findings

**Risk addressed:** CLI findings flatten request-validation reasons to `request_input_not_validated`, losing actionable information for parser gaps and unknown validators.

**Files:**
- Modify: `packages/cli/test/security-check.test.ts`
- Modify: `packages/cli/src/check/run-check.ts`

- [ ] **Step 1: RED CLI reason mapping test**

Add to `packages/cli/test/security-check.test.ts`:

```ts
it("maps request validation parser gap reason into finding actual_layer", async () => {
  const result = await runEngineCheck(/* fixture where body spread emits unsupported_request_input_spread */);
  const finding = result.findings.find((entry) =>
    entry.rule_id === "api_route_requires_request_validation"
  );

  expect(finding?.rule_id).toBe("api_route_requires_request_validation");
  expect(finding?.message).toContain("Accepted request validation");
});
```

Then add a `runCheck` JSON assertion against the stored CLI finding:

```ts
expect(payload.findings[0]).toMatchObject({
  expected_layer: "request_validation",
  actual_layer: "unsupported_request_input_spread"
});
```

- [ ] **Step 2: Run RED command**

Run:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED: actual layer is always `request_input_not_validated`.

- [ ] **Step 3: GREEN CLI mapping**

In `packages/cli/src/check/run-check.ts`, derive `actual_layer` from engine output:

Priority:

1. first parser gap code from `proof.parser_gaps`
2. first missing proof code from `proof.missing_proof`
3. first unvalidated use reason from `proof.request_validation.unvalidated_uses`
4. fallback `request_input_not_validated`

Do not parse source text.

- [ ] **Step 4: Run GREEN command**

Run:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected GREEN: pass.

---

## Task 8: Enforce Method, Input Source, And Sink Scope In Engine Path

**Risk addressed:** Contract method/input/sink scope is not represented or enforced in the engine request path.

**Files:**
- Modify: `packages/core/test/security.test.ts`
- Modify: `packages/core/src/security.ts`
- Modify: `packages/engine-contract/test/engine-contract.test.ts`
- Modify: `packages/engine-contract/src/index.ts`
- Modify: `crates/drift-engine/src/protocol.rs`
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Modify: `crates/drift-engine/tests/security_rules.rs`

- [ ] **Step 1: RED schema test for accepted contract scope**

In `packages/core/test/security.test.ts`, assert this contract is valid:

```ts
const contract = SecurityConventionSchema.parse({
  contract_id: "security_api_request_validation",
  kind: "api_route_requires_request_validation",
  capability: "deterministic_check",
  enforcement_mode: "block",
  matcher: {
    file_roles: ["api_route"],
    methods: ["POST"]
  },
  scope: {
    check_scope: "changed-hunks",
    applies_to: "route"
  },
  requires: {
    input_sources: ["body"],
    sinks: ["data_operation"],
    schemas: ["ProjectInputSchema"]
  }
});

expect(contract.requires?.input_sources).toEqual(["body"]);
```

- [ ] **Step 2: RED engine protocol test**

In `packages/engine-contract/test/engine-contract.test.ts`, assert `EngineCheckRequestSchema` accepts a request-validation convention with:

```json
"matcher": { "methods": ["POST"], "applies_to_file_roles": ["api_route"] },
"requires": {
  "input_sources": ["body"],
  "sinks": ["data_operation"],
  "schemas": ["ProjectInputSchema"]
}
```

- [ ] **Step 3: RED Rust method filtering test**

Add to `crates/drift-engine/tests/security_rules.rs`:

```rust
#[test]
fn request_validation_contract_applies_only_to_configured_methods() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function GET(request: Request) {
  const body = await request.json();
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
"#;
    // Contract requires POST only.
    // Expected: no finding for GET.
}
```

- [ ] **Step 4: Run RED commands**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- engine-contract
cargo test -p drift-engine request_validation_contract_applies_only_to_configured_methods -- --nocapture
```

Expected RED: method/input/sink scope is not enforced.

- [ ] **Step 5: GREEN protocol and rule wiring**

Implement:

- `CheckMatcher.methods: Option<Vec<String>>`
- request-validation requires parsing for:
  - `input_sources`
  - `sinks`
  - `validators`
  - `schemas`
- Route method filtering in `check_command.rs` before building proof.
- Input-source filtering in `security_proof.rs` before unvalidated-use evaluation.
- Sink-kind filtering in `security_proof.rs` before unvalidated-use evaluation.

- [ ] **Step 6: Run GREEN commands**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- engine-contract
cargo test -p drift-engine request_validation_contract_applies_only_to_configured_methods -- --nocapture
```

Expected GREEN: pass.

---

## Task 9: Support Throwing Validators Without Accepting Raw Input Incorrectly

**Risk addressed:** Throwing validators cannot prove original input despite Phase 3 requirements.

**Files:**
- Modify: `crates/drift-engine/tests/security_rules.rs`
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`

- [ ] **Step 1: RED throwing validator dominance pass test**

Add:

```rust
#[test]
fn throwing_validator_dominating_sink_allows_original_input_use() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  assertProjectInput(body);
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "assert_project_input".to_string(),
        symbol: "assertProjectInput".to_string(),
        kind: RequestValidatorKind::Helper,
        behavior: RequestValidatorBehavior::Throws,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(proof.request_validation.proven, "throwing validator before sink should prove original input");
}
```

- [ ] **Step 2: RED non-throwing raw input still blocks**

Add:

```rust
#[test]
fn returns_parsed_validator_does_not_allow_raw_input_use() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  validateProjectInput(body);
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "validate_project_input".to_string(),
        symbol: "validateProjectInput".to_string(),
        kind: RequestValidatorKind::Helper,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(!proof.request_validation.proven, "returns-parsed validator must not bless raw input");
}
```

- [ ] **Step 3: Run RED command**

Run:

```bash
cargo test -p drift-engine validator_dominating_sink -- --nocapture
```

Expected RED: throwing validator dominance is not supported.

- [ ] **Step 4: GREEN throwing validator source-to-sink rule**

In Rust:

- For accepted validators with `behavior == Throws`, treat original `input_var` as validated only if the validator call line dominates the sink line.
- Do not apply this to `ReturnsParsed`, `Boolean`, or `Unknown`.
- Do not accept throwing validators inside only one branch unless existing dominance logic can prove the sink is protected.

- [ ] **Step 5: Run GREEN command**

Run:

```bash
cargo test -p drift-engine validator_dominating_sink -- --nocapture
```

Expected GREEN: pass.

---

## Task 10: Namespace Imports And Destructured Request Inputs

**Risk addressed:** Namespace-imported validators are missed; destructured params/request-derived values are silently omitted instead of extracted or parser-gapped.

**Files:**
- Modify: `crates/drift-engine/tests/security_facts.rs`
- Modify: `crates/drift-engine/tests/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_patterns.rs`
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`

- [ ] **Step 1: RED namespace schema import test**

Add to `crates/drift-engine/tests/security_facts.rs`:

```rust
#[test]
fn extracts_request_validation_called_for_namespace_imported_schema() {
    let source = r#"
import * as validation from "@/server/validation";
export async function POST(request: Request) {
  const body = await request.json();
  const input = validation.ProjectInputSchema.parse(body);
  return Response.json(input);
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let facts = extract_security_facts_with_validation(
        "app/api/projects/route.ts",
        source,
        &[],
        &validators,
    )
    .expect("security facts");

    assert!(facts.iter().any(|fact| fact.kind == FactKind::RequestValidationCalled));
}
```

- [ ] **Step 2: RED destructured params extraction test**

Add:

```rust
#[test]
fn extracts_destructured_params_as_request_input_read() {
    let source = r#"
export async function GET(_request: Request, { params }: { params: { projectId: string } }) {
  const { projectId } = params;
  return Response.json({ projectId });
}
"#;
    let facts = extract_security_facts("app/api/projects/route.ts", source, &[])
        .expect("security facts");

    assert!(facts.iter().any(|fact|
        fact.kind == FactKind::RequestInputRead
            && fact.name == "projectId"
            && fact.value.as_deref().is_some_and(|value| value.contains("\"source\":\"params\""))
    ));
}
```

- [ ] **Step 3: RED body destructuring parser gap test**

Add to `crates/drift-engine/tests/security_control_flow.rs`:

```rust
#[test]
fn destructured_body_input_emits_parser_gap() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const { name } = body;
  await db.project.create({ data: { name } });
  return Response.json({ ok: true });
}
"#;
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &[])
        .expect("request validation proof");

    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
    assert!(proof.parser_gaps.iter().any(|gap|
        gap.code == "unsupported_request_input_destructure" && gap.blocks_enforcement
    ));
}
```

- [ ] **Step 4: Run RED command**

Run:

```bash
cargo test -p drift-engine namespace_imported_schema destructured -- --nocapture
```

Expected RED: namespace import and destructured request inputs are missed.

- [ ] **Step 5: GREEN extraction and parser gaps**

Implement:

- Namespace import recognition in `security_patterns.rs` for `validation.ProjectInputSchema.parse(body)` when `ProjectInputSchema` is accepted.
- Destructured `params` extraction in `security_facts.rs`.
- Parser gap `unsupported_request_input_destructure` for destructuring from body/query/header/cookie variables when deterministic propagation is not implemented.
- Add the parser gap code to Rust/TS schemas in Task 6 if not already done there.

- [ ] **Step 6: Run GREEN command**

Run:

```bash
cargo test -p drift-engine namespace_imported_schema destructured -- --nocapture
```

Expected GREEN: pass.

---

## Task 11: Strengthen E2E Assertions

**Risk addressed:** E2E assertions can pass for weak reasons and leak checks are partly tautological.

**Files:**
- Modify: `test/e2e/security-validation.test.ts`
- Modify: `test/fixtures/security-validation-*`

- [ ] **Step 1: RED e2e assertions**

Update each e2e case to assert all of:

- `payload.check.status === "fail"` for blocking cases.
- `payload.summary.blocking_count === 1` for blocking cases.
- `payload.findings[0].expected_layer === "request_validation"`.
- `payload.findings[0].actual_layer` equals the exact expected reason.
- `payload.security_boundary_proofs[0].result.proof_status` equals:
  - `missing_proof`
  - `parser_gap`
  - `proven`
- parser-gap case includes `unsupported_request_input_spread`.
- pass case has `payload.summary.findings_count === 0`.

Add explicit canary strings to fixtures:

```ts
const secretCanary = "SECRET_VALUE_SHOULD_NOT_LEAK";
const cookieCanary = request.headers.get("cookie");
```

Then assert:

```ts
expect(JSON.stringify(payload)).not.toContain("SECRET_VALUE_SHOULD_NOT_LEAK");
expect(JSON.stringify(payload)).not.toContain("session=");
expect(JSON.stringify(payload)).not.toContain("request.json()");
```

- [ ] **Step 2: Run RED command**

Run:

```bash
pnpm exec vitest run test/e2e/security-validation.test.ts --no-file-parallelism --maxWorkers=1
```

Expected RED: fail where current behavior reports pass/non-blocking or weak reason values.

- [ ] **Step 3: GREEN e2e plus implementation fixes**

Apply only the implementation fixes from Tasks 1-10 required to satisfy the stronger e2e assertions. Do not weaken the assertions.

- [ ] **Step 4: Run GREEN command**

Run:

```bash
pnpm exec vitest run test/e2e/security-validation.test.ts --no-file-parallelism --maxWorkers=1
```

Expected GREEN: pass.

---

## Task 12: Final Production-Grade Gate

**Files:** no production files unless prior tasks require final formatting.

- [ ] **Step 1: Rebuild local package dist for package-pack/e2e truth**

Run:

```bash
pnpm --filter @drift/core build
pnpm --filter @drift/engine-contract build
pnpm --filter @drift/query build
pnpm --filter @drift/cli build
pnpm --filter @drift/mcp build
```

Expected: all pass. Generated `dist` output should remain untracked unless the repo policy changes.

- [ ] **Step 2: Run final gates**

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

- [ ] **Step 3: Confirm branch hygiene**

Run:

```bash
git status --short --branch
git diff --stat origin/codex/security-request-validation-phase3...HEAD
git diff --name-only origin/codex/security-request-validation-phase3...HEAD
```

Expected:

- Only corrective Phase 3 hardening files are changed.
- No unrelated untracked files are staged.
- No Phase 4+ files or concepts are implemented.

- [ ] **Step 4: Commit**

Commit message:

```bash
git add <only Phase 3 hardening files>
git commit -m "Harden Phase 3 request validation enforcement"
```

Expected: one corrective commit on top of `codex/security-request-validation-phase3`.

---

## Completion Criteria

Phase 3 is production-ready only when:

- `matcher.required_calls` cannot accept request validators.
- `requires.validators` and `requires.schemas` are the only accepted request-validation contract truth.
- `safeParse` proof requires real success guard semantics and `.data` use, including aliases.
- Multi-line sinks cannot hide raw request input.
- No-request-input routes do not block.
- Query/MCP read models never synthesize proof from raw facts.
- TS schemas reject impossible request-validation proof states.
- CLI findings preserve exact request-validation missing-proof/parser-gap reasons.
- Method/input-source/sink scope is represented and enforced.
- Throwing validators prove original input only when accepted and dominant.
- Namespace imports and destructured request input are handled or parser-gapped.
- E2E tests assert real blocking/proof behavior, not just proof shape.
- Phase 4+ remains untouched.
