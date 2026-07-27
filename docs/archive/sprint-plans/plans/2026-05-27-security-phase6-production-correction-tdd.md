# Drift V3 Security Boundary Phase 6 Production Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current incomplete Phase 6 implementation with production-ready, engine-owned enforcement for SSRF, raw SQL, CORS, CSRF, and rate limits.

**Architecture:** Rust owns Phase 6 deterministic facts, proof construction, parser gaps, missing proof, waivers, and blocking. TypeScript only validates engine payload schemas, persists/loads trusted Rust proof, and formats sanitized CLI/MCP/query output. Phase 6 must use the same accepted-contract, route-bound, method-bound, file-role-bound, diff-scoped, waiver-aware lifecycle already used by Phase 1 auth and Phase 3 request validation.

**Tech Stack:** Rust `drift-engine`, Tree-sitter TypeScript facts, Vitest package tests, CLI/MCP/query TypeScript schemas and read models, existing Drift check/e2e harnesses.

---

## Current State To Treat As Failed

The existing Phase 6 branch is not production safe. Do not add small patches around the current ad hoc path. The correction must remove or replace these weak points:

- `packages/cli/src/check/run-check.ts` filters engine-owned security checks to auth/request-validation only.
- `crates/drift-engine/src/check_command.rs` routes Phase 6 contracts to ad hoc `security_phase6_findings` instead of typed proof/evaluator lifecycle.
- `csrf_guard_called` and `rate_limit_guard_called` are schema/enum surface only; no accepted-helper extractor emits them.
- Unknown SSRF wrappers/dynamic URL builders silently pass.
- TypeScript proof schemas contain no Phase 6 proof model and can accept impossible proven/pass states.
- Fixtures exist but are not wired into CLI/e2e proof.

## Production Contract

Phase 6 is complete only when:

- `drift check` enforces all five Phase 6 accepted contract kinds through the Rust engine path.
- Every Phase 6 finding has a trusted Rust `SecurityBoundaryProof`.
- Unsupported dynamic URL, SQL, CORS, CSRF, rate-limit, callback, branch, and control-flow cases produce blocking parser-gap-backed missing proof under blocking contracts.
- Accepted helper proof requires exact import identity, route binding, method binding, file role binding, and dominance before the protected sink.
- Candidate or heuristic evidence never blocks and never proves safety.
- Waivers apply on the engine-owned finding path before CI fails.
- Query/MCP/CLI read trusted proof only; no TypeScript synthesis from raw facts.
- Output does not include source snippets, raw URLs with sensitive data, request payloads, header values, cookie values, raw SQL strings, SQL literal values, secrets, env values, tokens, user IDs, tenant IDs, or full source content.

---

## File Responsibility Map

**Rust engine facts**
- Modify `crates/drift-engine/src/facts.rs`: enum names only.
- Modify `crates/drift-engine/src/security_facts.rs`: deterministic AST-backed Phase 6 fact extraction only.
- Create `crates/drift-engine/src/security_phase6.rs`: Phase 6 proof structs, typed contracts, evaluator functions, parser-gap/missing-proof codes, helper identity normalization.
- Modify `crates/drift-engine/src/security_control_flow.rs`: shared dominance helpers over Phase 6 sinks.
- Modify `crates/drift-engine/src/security_proof.rs`: integrate Phase 6 proof sections into `SecurityBoundaryProof` without weakening auth/request-validation.
- Modify `crates/drift-engine/src/security_rules.rs`: export or delegate Phase 6 evaluators; avoid adding another monolith.
- Modify `crates/drift-engine/src/check_command.rs`: build typed Phase 6 contracts from accepted contract JSON, call Rust proof/evaluator lifecycle, emit proofs/findings, apply diff/baseline/waiver lifecycle.
- Modify `crates/drift-engine/src/main.rs`: fact string mapping only.
- Modify `crates/drift-engine/src/lib.rs`: exports only.

**Rust tests**
- Replace `crates/drift-engine/tests/security_phase6.rs` with focused unit tests for fact extraction, proof construction, parser gaps, accepted helper identity, and rule evaluation.
- Add `crates/drift-engine/tests/security_check_repo_phase6.rs` for `check_repo` and JSON proof/finding behavior.

**TypeScript schemas/read models**
- Modify `packages/core/src/security.ts`: Phase 6 proof schemas and super-refine impossible states.
- Modify `packages/core/src/domain.ts` and `packages/core/src/schemas.ts`: Phase 6 fact/kind types.
- Modify `packages/engine-contract/src/index.ts`: engine payload schema parity.
- Modify `packages/query/src/security-boundary-proof.ts`: summarize Phase 6 trusted proof only.
- Modify `packages/mcp/src/security-context.ts`: return Phase 6 proof summaries from trusted proof/read model only.
- Modify `packages/cli/src/check/run-check.ts`: pass Phase 6 accepted conventions into engine-owned security check path.
- Modify `packages/cli/src/check/security-check.ts`: include Phase 6 proof/finding counts without source reconstruction.
- Modify `packages/cli/src/args/flag-readers.ts` and `packages/mcp/src/index.ts` only if accepted contract kind filters reject Phase 6.

**Fixtures/e2e**
- Keep and wire:
  - `test/fixtures/security-ssrf`
  - `test/fixtures/security-ssrf-allowlist-pass`
  - `test/fixtures/security-raw-sql`
  - `test/fixtures/security-raw-sql-parameterized-pass`
  - `test/fixtures/security-csrf-missing`
  - `test/fixtures/security-rate-limit-missing`
  - `test/fixtures/security-cors-policy-violation`
- Add missing fixtures for dynamic/unknown cases:
  - `test/fixtures/security-ssrf-unknown-wrapper`
  - `test/fixtures/security-ssrf-wrong-import`
  - `test/fixtures/security-raw-sql-concat`
  - `test/fixtures/security-raw-sql-unknown-wrapper`
  - `test/fixtures/security-cors-dynamic-callback`
  - `test/fixtures/security-csrf-helper-after-sink`
  - `test/fixtures/security-rate-limit-helper-after-sink`
  - `test/fixtures/security-phase6-matcher-mismatch`
- Add `test/e2e/security-phase6.test.ts`.

---

## Task 0: Freeze Current Failure As Regression Target

**Files:**
- Read: `docs/architecture/security-boundary-enforcement-100-tdd.md`
- Read: current changed files from `git status --short --branch`
- Create: no files

- [ ] **Step 1: Record live starting state**

Run:

```bash
git status --short --branch
git diff --stat
rg -n "## Phase 6:|api_route_forbids_untrusted_ssrf|api_route_forbids_raw_sql_without_params|api_route_cors_must_match_policy|api_route_requires_csrf_for_mutation|api_route_requires_rate_limit|## Phase 7:" docs/architecture/security-boundary-enforcement-100-tdd.md
```

Expected: branch is `codex/security-phase6-boundary`, dirty with the failed Phase 6 slice, and Phase 6 spec is present in the 100-TDD doc.

- [ ] **Step 2: Mark current weak tests as insufficient**

Run:

```bash
cargo test -p drift-engine security_
cargo test -p drift-engine --test security_phase6
```

Expected: `security_` filter does not run the Phase 6 test names, while `--test security_phase6` passes. This proves the existing filtered gate is not enough.

---

## Task 1: RED - `drift check` Must Enforce Phase 6 Contracts

**Files:**
- Modify: `packages/cli/test/security-check.test.ts`
- Modify: `crates/drift-engine/tests/security_check_repo_phase6.rs`
- Test fixtures: `test/fixtures/security-ssrf/app/api/proxy/route.ts`

- [ ] **Step 1: Add CLI failing test for SSRF contract**

Add a Vitest case in `packages/cli/test/security-check.test.ts`:

```ts
it("blocks Phase 6 SSRF contracts through drift check JSON output", async () => {
  const repoRoot = await copyFixtureToTempRepo("security-ssrf");
  const contract = phase6Contract({
    id: "security_api_no_ssrf",
    kind: "api_route_forbids_untrusted_ssrf",
    requires: {
      outbound_url_allowlist_helpers: [{
        helper_id: "outbound_allowlist",
        module: "@/security/outbound",
        symbol: "requireAllowedOutboundUrl"
      }]
    }
  });
  const result = await runDriftCheckJson(repoRoot, contract, [
    "diff --git a/app/api/proxy/route.ts b/app/api/proxy/route.ts",
    "--- a/app/api/proxy/route.ts",
    "+++ b/app/api/proxy/route.ts",
    "@@ -1,0 +1,5 @@",
    "+export async function GET(request: Request) {",
    "+  const target = request.nextUrl.searchParams.get(\"target\");",
    "+  await fetch(target);",
    "+  return Response.json({ ok: true });",
    "+}"
  ].join("\n"));

  expect(result.security_boundary_proofs).toHaveLength(1);
  expect(result.security_boundary_proofs[0]).toMatchObject({
    contracts: [expect.objectContaining({ kind: "api_route_forbids_untrusted_ssrf", matched: true })],
    ssrf: {
      required: true,
      proven: false,
      outbound_requests: [expect.objectContaining({ url_source: "request_input" })],
      allowlist_proofs: [],
      missing_proof: [expect.objectContaining({ code: "request_controlled_url" })]
    },
    result: expect.objectContaining({ proof_status: "missing_proof", enforcement_result: "block" })
  });
  expect(result.findings).toContainEqual(expect.objectContaining({
    rule_id: "api_route_forbids_untrusted_ssrf",
    enforcement_result: "block"
  }));
});
```

- [ ] **Step 2: Add Rust failing test for `check_repo` Phase 6**

Create `crates/drift-engine/tests/security_check_repo_phase6.rs` with a test that builds a `CheckRequest` for the same SSRF fixture and asserts:

```rust
assert_eq!(result.findings[0].rule_id, "api_route_forbids_untrusted_ssrf");
assert_eq!(result.findings[0].enforcement_result, "block");
assert_eq!(
    result.security_boundary_proofs[0]["ssrf"]["required"],
    serde_json::json!(true)
);
```

- [ ] **Step 3: Run RED commands**

Run:

```bash
pnpm --filter @drift/cli test -- security-check
cargo test -p drift-engine --test security_check_repo_phase6
```

Expected:
- CLI test FAILS because `packages/cli/src/check/run-check.ts` filters out Phase 6 contracts.
- Rust test FAILS because `check_command.rs` either does not emit Phase 6 proof or uses ad hoc findings without proof.

---

## Task 2: GREEN - Route Phase 6 Through Engine-Owned Check Lifecycle

**Files:**
- Modify: `packages/cli/src/check/run-check.ts`
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/src/lib.rs`
- Modify: `crates/drift-engine/src/security_rules.rs`
- Create: `crates/drift-engine/src/security_phase6.rs`

- [ ] **Step 1: Extend CLI engine-owned security filter**

In `packages/cli/src/check/run-check.ts`, replace the two-kind security filter with:

```ts
const ENGINE_OWNED_SECURITY_CONTRACTS = new Set([
  "api_route_requires_auth_helper",
  "api_route_requires_request_validation",
  "api_route_forbids_untrusted_ssrf",
  "api_route_forbids_raw_sql_without_params",
  "api_route_cors_must_match_policy",
  "api_route_requires_csrf_for_mutation",
  "api_route_requires_rate_limit"
]);
```

Use it where the existing code filters around lines `1923-1925`:

```ts
if (!ENGINE_OWNED_SECURITY_CONTRACTS.has(convention.kind)) {
  continue;
}
```

- [ ] **Step 2: Remove ad hoc Phase 6 check path**

In `crates/drift-engine/src/check_command.rs`, delete or stop using `security_phase6_findings`. Replace it with a function that:

```rust
let phase6_result = security_phase6_findings_and_proofs(
    &facts,
    repo_root.as_deref(),
    &parsed_diff,
    diff_scope,
    &convention,
    severity,
    enforcement_mode,
);
security_boundary_proofs.extend(phase6_result.proofs);
phase6_result.findings
```

- [ ] **Step 3: Build typed Phase 6 contracts from accepted contract JSON**

Create typed parsing in Rust from `CheckConvention.requires`, `forbids`, and `matcher`:

```rust
pub enum Phase6SecurityContract {
    Ssrf(SecuritySsrfContract),
    RawSql(SecurityRawSqlContract),
    Cors(SecurityCorsContract),
    Csrf(SecurityCsrfContract),
    RateLimit(SecurityRateLimitContract),
}
```

Every parsed contract must carry:

```rust
pub struct Phase6Matcher {
    pub file_roles: Vec<String>,
    pub path_globs: Vec<String>,
    pub route_paths: Vec<String>,
    pub methods: Vec<String>,
}
```

- [ ] **Step 4: Run GREEN commands**

Run:

```bash
cargo test -p drift-engine --test security_check_repo_phase6
pnpm --filter @drift/cli test -- security-check
```

Expected: both tests PASS and proof/finding path is engine-owned.

---

## Task 3: RED - Accepted Helper Identity And Dominance

**Files:**
- Modify: `crates/drift-engine/tests/security_phase6.rs`
- Modify: `crates/drift-engine/tests/security_check_repo_phase6.rs`

- [ ] **Step 1: Add wrong-import SSRF test**

Add:

```rust
#[test]
fn ssrf_wrong_import_path_with_matching_local_name_does_not_prove_safety() {
    let source = r#"
import { requireAllowedOutboundUrl } from "@/local/fake-outbound";

export async function GET(request: Request) {
  const target = request.nextUrl.searchParams.get("target");
  const safeTarget = requireAllowedOutboundUrl(target);
  await fetch(safeTarget);
  return Response.json({ ok: true });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/proxy/route.ts",
        source,
        &phase6_ssrf_contract_with_helper("@/security/outbound", "requireAllowedOutboundUrl")
    ).expect("proof");

    assert!(!proof.ssrf.proven);
    assert_eq!(proof.result.proof_status, SecurityProofStatus::MissingProof);
    assert_eq!(proof.ssrf.missing_proof[0].code, "request_controlled_url");
}
```

- [ ] **Step 2: Add helper-after-sink CSRF/rate-limit tests**

Add:

```rust
#[test]
fn csrf_helper_after_mutation_sink_does_not_prove_safety() {
    let source = r#"
import { requireCsrf } from "@/security/csrf";

export async function POST(request: Request) {
  await db.settings.update({ data: await request.json() });
  await requireCsrf(request);
  return Response.json({ ok: true });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/settings/route.ts",
        source,
        &phase6_csrf_contract_with_helper("@/security/csrf", "requireCsrf")
    ).expect("proof");

    assert!(!proof.csrf.proven);
    assert_eq!(proof.csrf.missing_proof[0].code, "csrf_guard_not_dominating_sink");
}
```

Repeat with `requireRateLimit` and expected code `rate_limit_guard_not_dominating_sink`.

- [ ] **Step 3: Run RED command**

Run:

```bash
cargo test -p drift-engine --test security_phase6 wrong_import helper_after
```

Expected: FAIL because existing accepted-helper checks are import-plus-call anywhere in the file or missing entirely.

---

## Task 4: GREEN - Implement Accepted Helper Facts With Route/Method Dominance

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`

- [ ] **Step 1: Extract accepted helper calls only from accepted imports**

In Rust, model:

```rust
pub struct AcceptedPhase6Helper {
    pub helper_id: String,
    pub module: String,
    pub symbol: String,
    pub protection_kind: Phase6ProtectionKind,
}
```

Emit `csrf_guard_called` and `rate_limit_guard_called` only when:

```rust
fact.kind == FactKind::ImportUsed
    && fact.value.as_deref() == Some(helper.module.as_str())
    && fact.imported_name.as_deref() == Some(helper.symbol.as_str())
```

and the matching `SymbolCalled` fact is inside the same route range.

- [ ] **Step 2: Add dominance over protected sinks**

For CSRF and rate-limit:

```rust
guard.start_line < first_mutation_or_response_or_data_sink.start_line
```

must be true, and callback/branch/dynamic-control-flow cases must become parser gaps, not proof.

- [ ] **Step 3: Keep helper proof route-bound**

Every helper proof must include:

```rust
route_id
method
file_path
helper_id
fact_id
edge_id
start_line
end_line
```

- [ ] **Step 4: Run GREEN command**

Run:

```bash
cargo test -p drift-engine --test security_phase6 wrong_import helper_after
```

Expected: PASS.

---

## Task 5: RED - Unknown And Dynamic SSRF Must Become Parser Gaps

**Files:**
- Modify: `crates/drift-engine/tests/security_phase6.rs`
- Fixture: `test/fixtures/security-ssrf-unknown-wrapper/app/api/proxy/route.ts`

- [ ] **Step 1: Add unknown sanitizer test**

Add:

```rust
#[test]
fn unknown_ssrf_sanitizer_emits_blocking_parser_gap() {
    let source = r#"
export async function GET(request: Request) {
  const target = request.nextUrl.searchParams.get("target");
  const safeTarget = sanitizeUrl(target);
  await fetch(safeTarget);
  return Response.json({ ok: true });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/proxy/route.ts",
        source,
        &phase6_ssrf_contract()
    ).expect("proof");

    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
    assert_eq!(proof.parser_gaps[0].code, "unsupported_dynamic_outbound_url");
    assert!(proof.parser_gaps[0].blocks_enforcement);
    assert_eq!(proof.ssrf.missing_proof[0].code, "request_controlled_url");
}
```

- [ ] **Step 2: Add inline request input test**

Add:

```rust
#[test]
fn inline_request_input_reaching_fetch_blocks() {
    let source = r#"
export async function GET(request: Request) {
  await fetch(request.nextUrl.searchParams.get("target"));
  return Response.json({ ok: true });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/proxy/route.ts",
        source,
        &phase6_ssrf_contract()
    ).expect("proof");

    assert!(!proof.ssrf.proven);
    assert_eq!(proof.ssrf.outbound_requests[0].url_source, "request_input");
}
```

- [ ] **Step 3: Run RED command**

Run:

```bash
cargo test -p drift-engine --test security_phase6 ssrf
```

Expected: FAIL on unknown sanitizer/parser-gap and inline request input.

---

## Task 6: GREEN - AST-Backed SSRF Taint And Parser Gaps

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`

- [ ] **Step 1: Support inline request input**

For outbound sink arguments, classify as `request_input` when argument text contains:

```text
request.nextUrl.searchParams.get(
new URL(request.url).searchParams.get(
request.headers.get(
cookies().get(
params.
context.params.
```

Do not store the raw argument. Store:

```json
{
  "url_source": "request_input",
  "url_var": null,
  "source_kind": "query"
}
```

- [ ] **Step 2: Track one-hop variable aliases**

Support:

```ts
const target = request.nextUrl.searchParams.get("target");
const safeTarget = target;
await fetch(safeTarget);
```

as request-controlled unless an accepted allowlist helper proves the alias.

- [ ] **Step 3: Emit parser gap for unknown wrapper**

If an outbound URL argument is a variable assigned from a non-accepted function call that used request input, emit:

```rust
SecurityParserGap {
  code: "unsupported_dynamic_outbound_url",
  blocks_enforcement: true,
}
```

- [ ] **Step 4: Run GREEN command**

Run:

```bash
cargo test -p drift-engine --test security_phase6 ssrf
```

Expected: PASS.

---

## Task 7: RED - Raw SQL Coverage Must Catch Common Unsafe Shapes

**Files:**
- Modify: `crates/drift-engine/tests/security_phase6.rs`
- Fixture: `test/fixtures/security-raw-sql-concat/app/api/users/route.ts`
- Fixture: `test/fixtures/security-raw-sql-unknown-wrapper/app/api/users/route.ts`

- [ ] **Step 1: Add unsafe `pool.query` template test**

Add:

```rust
#[test]
fn pool_query_template_with_request_input_blocks_as_raw_sql() {
    let source = r#"
export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  await pool.query(`select * from users where id = ${id}`);
  return Response.json({ ok: true });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/users/route.ts",
        source,
        &phase6_raw_sql_contract()
    ).expect("proof");

    assert!(!proof.raw_sql.proven);
    assert_eq!(proof.raw_sql.raw_sql_calls[0].query_shape, "template");
    assert_eq!(proof.raw_sql.missing_proof[0].code, "raw_sql_unparameterized");
}
```

- [ ] **Step 2: Add unsafe concat test**

Add:

```rust
#[test]
fn raw_sql_concat_with_request_input_blocks() {
    let source = r#"
export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  await db.query("select * from users where id = " + id);
  return Response.json({ ok: true });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/users/route.ts",
        source,
        &phase6_raw_sql_contract()
    ).expect("proof");

    assert_eq!(proof.raw_sql.missing_proof[0].code, "raw_sql_unparameterized");
}
```

- [ ] **Step 3: Add safe placeholder array test**

Add:

```rust
#[test]
fn sql_placeholder_array_passes_when_sink_id_matches() {
    let source = r#"
export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  const rows = await pool.query("select * from users where id = $1", [id]);
  return Response.json({ count: rows.length });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/users/route.ts",
        source,
        &phase6_raw_sql_contract()
    ).expect("proof");

    assert!(proof.raw_sql.proven);
}
```

- [ ] **Step 4: Run RED command**

Run:

```bash
cargo test -p drift-engine --test security_phase6 raw_sql
```

Expected: FAIL until raw SQL detection ties parameterization to exact sink ids and handles common unsafe shapes.

---

## Task 8: GREEN - Raw SQL Proof By Sink Identity

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`

- [ ] **Step 1: Classify raw SQL sinks**

Emit `raw_sql_called` for:

```text
$queryRawUnsafe
$executeRawUnsafe
pool.query
client.query
db.query
connection.query
sequelize.query
```

when query shape is:

```text
template with interpolation
string concat
unknown variable query string
unsafe raw API
```

- [ ] **Step 2: Emit parameterized proof only for same sink**

Emit `parameterized_sql_used` with the same `sink_id` only when:

```text
placeholder array: query("... $1 ...", [value])
prepared statement object with values array
safe tagged template accepted by contract
accepted safe wrapper exact import identity
```

- [ ] **Step 3: Do not store SQL strings**

Fact/proof metadata may include:

```json
{
  "query_shape": "template",
  "uses_untrusted_input": true,
  "parameterization": "placeholder_array"
}
```

It must not include the query text or SQL literal values.

- [ ] **Step 4: Run GREEN command**

Run:

```bash
cargo test -p drift-engine --test security_phase6 raw_sql
```

Expected: PASS.

---

## Task 9: RED - CORS Dynamic And Policy Mismatch Must Not Silently Pass

**Files:**
- Modify: `crates/drift-engine/tests/security_phase6.rs`
- Fixture: `test/fixtures/security-cors-dynamic-callback/app/api/public/route.ts`

- [ ] **Step 1: Add dynamic callback parser-gap test**

Add:

```rust
#[test]
fn dynamic_cors_origin_callback_emits_blocking_parser_gap() {
    let source = r#"
export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  return Response.json({ ok: true }, {
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true"
    }
  });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/public/route.ts",
        source,
        &phase6_cors_contract(["https://app.example.com"], true)
    ).expect("proof");

    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
    assert_eq!(proof.parser_gaps[0].code, "unsupported_dynamic_cors_origin");
}
```

- [ ] **Step 2: Add disallowed static origin test**

Add:

```rust
#[test]
fn disallowed_static_cors_origin_blocks() {
    let source = r#"
export async function GET() {
  return Response.json({ ok: true }, {
    headers: { "Access-Control-Allow-Origin": "https://evil.example.com" }
  });
}
"#;
    let proof = build_phase6_security_proof(
        "app/api/public/route.ts",
        source,
        &phase6_cors_contract(["https://app.example.com"], false)
    ).expect("proof");

    assert_eq!(proof.cors.missing_proof[0].code, "disallowed_origin");
}
```

- [ ] **Step 3: Run RED command**

Run:

```bash
cargo test -p drift-engine --test security_phase6 cors
```

Expected: FAIL until CORS policy proof supports static policies and parser gaps for dynamic policies.

---

## Task 10: GREEN - CORS Proof Model

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`

- [ ] **Step 1: Extract static CORS declarations**

Support safe static forms:

```ts
headers: { "Access-Control-Allow-Origin": "https://app.example.com" }
const headers = new Headers({ "Access-Control-Allow-Origin": "https://app.example.com" });
headers.set("Access-Control-Allow-Origin", "https://app.example.com");
```

Store only origin/method/header policy values, not request header values.

- [ ] **Step 2: Emit parser gap for dynamic origin**

Any origin value from request input, callback, variable with unknown source, or reflection must emit:

```rust
code: "unsupported_dynamic_cors_origin"
blocks_enforcement: true
```

- [ ] **Step 3: Enforce contract fields**

Compare against accepted contract:

```rust
allowed_origins
allowed_methods
allowed_headers
allow_credentials
```

- [ ] **Step 4: Run GREEN command**

Run:

```bash
cargo test -p drift-engine --test security_phase6 cors
```

Expected: PASS.

---

## Task 11: RED - TypeScript Schemas Must Reject Impossible Phase 6 Proofs

**Files:**
- Modify: `packages/core/test/security.test.ts`
- Modify: `packages/engine-contract/test/security-contract.test.ts`

- [ ] **Step 1: Add impossible proven SSRF proof rejection**

Add a core schema test:

```ts
expect(() => SecurityBoundaryProofSchema.parse({
  proof_id: "proof:route:proxy:ssrf",
  proof_version: "security-boundary-proof/v1",
  route: { route_id: "route:app/api/proxy/route.ts:GET", file_path: "app/api/proxy/route.ts", file_role: "api_route" },
  contracts: [{ contract_id: "security_api_no_ssrf", kind: "api_route_forbids_untrusted_ssrf", enforcement_mode: "block", capability: "deterministic_check", matched: true }],
  capability_status: [{ name: "outbound_request_facts", status: "complete", can_block: true, parser_gap_ids: [], missing_proof_ids: [] }],
  auth: { required: false, proven: false, proof_kind: "none", trusted_guard_calls: [], dominated_sinks: [], undominated_sinks: [] },
  ssrf: { required: true, proven: true, outbound_requests: [{ fact_id: "fact_fetch", url_source: "request_input", sink_id: "sink_fetch" }], allowlist_proofs: [], missing_proof: [] },
  missing_proof: [],
  parser_gaps: [],
  result: { proof_status: "proven", enforcement_result: "pass", can_block: true, finding_ids: [] }
})).toThrow(/ssrf proven proof requires accepted allowlist proof/);
```

- [ ] **Step 2: Add impossible raw SQL proof rejection**

Add equivalent test where `raw_sql.required=true`, `proven=true`, `raw_sql_calls` has an unsafe call, and `parameterized_sql=[]`.

- [ ] **Step 3: Run RED commands**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected: FAIL because Phase 6 proof sections do not exist or are not refined.

---

## Task 12: GREEN - Phase 6 Proof Schemas And Read Models

**Files:**
- Modify: `packages/core/src/security.ts`
- Modify: `packages/engine-contract/src/index.ts`
- Modify: `packages/query/src/security-boundary-proof.ts`
- Modify: `packages/mcp/src/security-context.ts`
- Modify: `packages/cli/src/check/security-check.ts`

- [ ] **Step 1: Add Phase 6 proof sections**

Add optional defaulted proof sections:

```ts
ssrf: {
  required: boolean;
  proven: boolean;
  outbound_requests: Array<{ fact_id: string; sink_id: string; api: string; url_source: "constant" | "request_input" | "validated_input" | "allowlisted" | "unknown"; }>;
  allowlist_proofs: Array<{ fact_id: string; helper_id: string; edge_id: string; }>;
  missing_proof: Array<{ code: "request_controlled_url" | "unsupported_dynamic_outbound_url"; fact_ids: string[]; }>;
}
```

Repeat for:

```ts
raw_sql
cors
csrf
rate_limit
```

- [ ] **Step 2: Add superRefine impossible-state checks**

Reject:

```text
ssrf.proven with request_input outbound and no allowlist proof
raw_sql.proven with unsafe raw_sql_calls and no matching parameterized_sql
cors.proven with wildcard credentials, disallowed origin, or parser gaps
csrf.proven with no dominating accepted guard/middleware proof
rate_limit.proven with no dominating accepted guard/middleware proof
result.proof_status == "proven" while any Phase 6 missing_proof/parser_gap exists
```

- [ ] **Step 3: Query/MCP read model from trusted proof only**

Expose summaries:

```ts
phase6: {
  ssrf: { required, proven, proof_status, missing_proof_codes, parser_gap_codes },
  raw_sql: { required, proven, proof_status, missing_proof_codes, parser_gap_codes },
  cors: { required, proven, proof_status, missing_proof_codes, parser_gap_codes },
  csrf: { required, proven, proof_status, missing_proof_codes, parser_gap_codes },
  rate_limit: { required, proven, proof_status, missing_proof_codes, parser_gap_codes }
}
```

Do not derive these from raw facts.

- [ ] **Step 4: Run GREEN commands**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/mcp test -- mcp
```

Expected: PASS.

---

## Task 13: RED - Fixture/E2E Phase 6 Matrix

**Files:**
- Create: `test/e2e/security-phase6.test.ts`
- Modify/add: `test/fixtures/security-*`

- [ ] **Step 1: Add e2e fixture matrix**

Create `test/e2e/security-phase6.test.ts` asserting:

```ts
const cases = [
  ["security-ssrf", "api_route_forbids_untrusted_ssrf", "block"],
  ["security-ssrf-allowlist-pass", "api_route_forbids_untrusted_ssrf", "pass"],
  ["security-ssrf-unknown-wrapper", "api_route_forbids_untrusted_ssrf", "block"],
  ["security-raw-sql", "api_route_forbids_raw_sql_without_params", "block"],
  ["security-raw-sql-parameterized-pass", "api_route_forbids_raw_sql_without_params", "pass"],
  ["security-raw-sql-concat", "api_route_forbids_raw_sql_without_params", "block"],
  ["security-cors-policy-violation", "api_route_cors_must_match_policy", "block"],
  ["security-cors-dynamic-callback", "api_route_cors_must_match_policy", "block"],
  ["security-csrf-missing", "api_route_requires_csrf_for_mutation", "block"],
  ["security-csrf-helper-after-sink", "api_route_requires_csrf_for_mutation", "block"],
  ["security-rate-limit-missing", "api_route_requires_rate_limit", "block"],
  ["security-rate-limit-helper-after-sink", "api_route_requires_rate_limit", "block"],
  ["security-phase6-matcher-mismatch", "api_route_requires_rate_limit", "pass"]
];
```

Each case must run compiled/local `drift check --json`, assert findings, assert proof sections, and assert `JSON.stringify(output)` does not contain:

```text
select *
Access-Control-Allow-Credentials": "true"
request.nextUrl
headers.get
cookies
target=
token
secret
```

- [ ] **Step 2: Run RED command**

Run:

```bash
pnpm test:e2e -- security-phase6
```

Expected: FAIL until CLI/check/proof path and fixtures are complete.

---

## Task 14: GREEN - Complete E2E Phase 6

**Files:**
- Modify implementation files from prior tasks only as needed.
- Modify `test/e2e/security-phase6.test.ts`

- [ ] **Step 1: Make all fixture cases pass**

Do not loosen assertions. Fix Rust proof/facts/check lifecycle if a case fails.

- [ ] **Step 2: Verify sanitized output**

Run:

```bash
pnpm test:e2e -- security-phase6
```

Expected: PASS and no forbidden snippets/values in output.

---

## Task 15: Remove Current Underdeveloped Code

**Files:**
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/src/security_rules.rs`
- Modify: `crates/drift-engine/src/security_facts.rs`

- [ ] **Step 1: Delete ad hoc code paths**

Remove:

```rust
security_phase6_findings
metadata_string
metadata_bool
```

from `check_command.rs` if replaced by typed proof lifecycle.

- [ ] **Step 2: Remove permissive helper proof**

Remove file-global accepted-helper logic like:

```rust
imported && called
```

unless it is route-bound and dominance-checked.

- [ ] **Step 3: Run regression command**

Run:

```bash
cargo test -p drift-engine --test security_phase6
cargo test -p drift-engine --test security_check_repo_phase6
pnpm test:e2e -- security-phase6
```

Expected: PASS.

---

## Final Gates

Run exactly:

```bash
cargo test -p drift-engine security_
cargo test -p drift-engine --test security_phase6
cargo test -p drift-engine --test security_check_repo_phase6
cargo test -p drift-engine
pnpm --filter @drift/core test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/storage test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
pnpm test:e2e
pnpm typecheck
cargo fmt --all -- --check
cargo clippy -p drift-engine --all-targets -- -D warnings
git diff --check
```

Expected: all PASS.

## Completion Checklist

- [ ] `drift check` enforces all five Phase 6 accepted contracts.
- [ ] Rust emits Phase 6 trusted proofs for all findings.
- [ ] Phase 6 proof is route-bound, method-bound, file-role-bound, and edge-bound.
- [ ] Accepted helper proof requires exact import path and local symbol identity.
- [ ] CSRF/rate-limit helpers must dominate sinks and cannot pass from dead code, callbacks, wrong branches, or after-sink calls.
- [ ] Unknown SSRF wrappers and dynamic URL builders produce parser gaps under blocking contracts.
- [ ] Raw SQL parameterization is sink-id matched.
- [ ] CORS dynamic origin produces parser gap; static policy enforces accepted origins/methods/headers/credentials.
- [ ] TypeScript schemas reject impossible Phase 6 proven/pass states.
- [ ] Query/MCP/CLI consume trusted Rust proof only.
- [ ] Waivers apply before CI failure on Phase 6 engine findings.
- [ ] No output includes raw URLs, source snippets, request payloads, headers, cookies, SQL strings/literals, secrets, env values, tokens, user IDs, tenant IDs, or full source content.
- [ ] Phase 7 and Phase 8 are untouched.
- [ ] Phase 1-5 tests still pass.
