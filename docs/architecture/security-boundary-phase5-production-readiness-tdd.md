# Security Boundary Phase 5 Production Readiness TDD

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not stage, commit, or push unless explicitly asked.

**Goal:** Close the Phase 5 false-pass, incomplete-proof, redaction, and MCP read-model gaps found by audit so sensitive response and secret exposure enforcement is production-ready.

**Architecture:** Rust remains the owner of deterministic facts, local flow summaries, proofs, parser gaps, missing proof, and blocking rules. TypeScript only validates contracts/proof schemas, transports Rust engine payloads, persists/loads proof, and renders sanitized read models. Phase 5 enforcement must be scoped per route/method/file-role and must never accept candidate facts, helper names, or raw facts as proof.

**Tech Stack:** Rust `drift-engine`, TypeScript packages `@drift/core`, `@drift/engine-contract`, `@drift/cli`, `@drift/query`, `@drift/mcp`, SQLite storage, Vitest, Cargo tests.

---

## Source Of Truth

Primary spec:
- `docs/architecture/security-boundary-enforcement-100-tdd.md`
- Focus only on `## Phase 5: Sensitive Response And Secrets Exposure`

Related definitions:
- `sensitive_field_declared`
- `response_emits_field`
- `serializer_called`
- `secret_read`
- `api_route_forbids_sensitive_response_fields`
- `api_route_forbids_secret_exposure`
- `SecurityBoundaryProof.response_shape`
- `SecurityBoundaryProof.sinks.secrets`
- Missing-proof codes:
  - `sensitive_response_field_unfiltered`
  - `dynamic_response_shape_missing_proof`
  - `secret_exposure_not_excluded`

Audit blockers to close:
- File-global serializer proof can suppress unrelated raw response leaks.
- Response object spread via variable silently passes.
- Secret exposure misses one-hop object aliases.
- Secret helper parser gaps miss arrow/async/imported/unknown helper forms.
- `matcher.methods` is file-level, not route-level.
- MCP Phase 5 context is raw-fact-based and never consumes trusted proof.

Audit high-risk issues to close:
- Phase 5 schemas use `.passthrough()` and only scan `requires` for unsafe value keys.
- Phase 5 proof schemas default `response_shape` / `sinks` for matched blocking contracts.
- `secret_read` emits unknown/non-secret config/env keys.
- `SecretRead.name` may leak env-key-shaped local variable names.

## Hard Constraints

- Do not implement Phase 6 SSRF, raw SQL, CORS, CSRF, or rate limits.
- Do not rework Phase 1 auth, Phase 2 middleware, Phase 3 validation, or Phase 4 tenant/session except for regression breakage caused by Phase 5 wiring.
- Rust owns deterministic proof and blocking.
- TypeScript must not synthesize trusted proof from raw facts.
- Candidate/heuristic sensitive evidence must never block.
- Accepted contract identity is source of truth. Name-only helpers do not satisfy proof.
- Wrong import path for a matching serializer name must not satisfy proof.
- Parser gaps and missing proof are different. Unsupported dynamic cases must not silently pass.
- Outputs/storage/MCP/CLI must never include source snippets, concrete secret values, env values, tokens, cookie/header values, request payloads, raw SQL values, user IDs, tenant IDs, or full source content.

## Baseline And Branch Hygiene

- [ ] **Step 1: Confirm worktree**

Run:

```bash
cd "/Users/geoffreyfernald/Downloads/driftv3-phase5-sensitive-response/drift v3"
git status --short --branch
```

Expected:
- Branch is `codex/security-phase5-sensitive-response`.
- Dirty files are Phase 5 implementation/test/doc files only.
- No unrelated untracked files.

- [ ] **Step 2: Run current gates before editing**

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

Expected:
- All pass before new RED tests are added.
- If anything fails, stop and report the exact failing command and failure before editing.

---

## File Responsibility Map

Rust:
- `crates/drift-engine/src/security_facts.rs`: extraction only. May add safe shape metadata needed for Phase 5 facts, but no rule decisions.
- `crates/drift-engine/src/security_patterns.rs`: accepted serializer/sensitive-field/secret-source normalization only.
- `crates/drift-engine/src/security_control_flow.rs`: local source-to-sink summaries only, including one-hop alias/object payload and unsupported helper summaries.
- `crates/drift-engine/src/security_proof.rs`: response-shape and secret-exposure proof, parser-gap, and missing-proof construction only.
- `crates/drift-engine/src/security_rules.rs`: deterministic accepted-contract rule evaluation only.
- `crates/drift-engine/src/check_command.rs`: engine request/response/rule wiring and route-scope filtering only.
- `crates/drift-engine/src/protocol.rs`: engine protocol types only if proof persistence/transport requires schema changes.
- `crates/drift-engine/src/security_capabilities.rs`: capability truth only.

TypeScript:
- `packages/core/src/security.ts`: contract/proof schemas only.
- `packages/core/src/domain.ts`, `packages/core/src/schemas.ts`: domain/schema enums and storage-facing types only.
- `packages/engine-contract/src/index.ts`: TypeScript-to-Rust request/response schema validation only.
- `packages/storage/src/migrations.ts`, `packages/storage/src/sqlite-storage.ts`: persist/load trusted Rust proof blobs.
- `packages/cli/src/check/run-check.ts`: CLI orchestration, engine payload storage, waiver lifecycle. No deterministic proof logic.
- `packages/cli/src/check/security-check.ts`: output mapping only.
- `packages/query/src/security-boundary-proof.ts`: proof-derived read model only.
- `packages/mcp/src/security-context.ts`: MCP read model from stored proof/query model only.

Tests:
- `crates/drift-engine/tests/security_facts.rs`
- `crates/drift-engine/tests/security_rules.rs`
- `crates/drift-engine/tests/security_check_repo_phase5.rs`
- `packages/core/test/security.test.ts`
- `packages/engine-contract/test/security-contract.test.ts`
- `packages/storage/test/sqlite-storage.test.ts`
- `packages/cli/test/security-check.test.ts`
- `packages/query/test/security-boundary-proof.test.ts`
- `packages/mcp/test/mcp.test.ts`
- `test/e2e/security-sensitive.test.ts`
- `test/fixtures/security-*`

---

## Task 1: Bind Serializer Proof To Actual Response Value

**Risk Closed:** Any accepted serializer call in the file can currently make a later raw response pass.

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`
- Test: `crates/drift-engine/tests/security_facts.rs`

- [ ] **Step 1: RED test for unused serializer call**

Add to `crates/drift-engine/tests/security_rules.rs`:

```rust
#[test]
fn security_phase5_serializer_call_must_feed_emitted_response_value() {
    let source = r#"
import { serializePublicUser } from "@/lib/serializers/user";
export async function GET() {
  const user = { email: "redacted@example.test" };
  const safe = serializePublicUser(user);
  void safe;
  return Response.json({ user: { email: user.email } });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "user.email".to_string(),
            classification: "pii".to_string(),
            source: "contract".to_string(),
        }],
        response_serializers: vec![AcceptedResponseSerializer {
            serializer_id: "serializePublicUser".to_string(),
            import_source: "@/lib/serializers/user".to_string(),
            imported_name: "serializePublicUser".to_string(),
            local_name: None,
            policy: ResponseSerializerPolicy::Denylist,
            filtered_fields: vec!["user.email".to_string()],
        }],
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };

    let proof = build_response_shape_proof("app/api/users/route.ts", source, &phase5)
        .expect("response proof");
    assert_eq!(proof.response_shape.sensitive_leaks.len(), 1, "{proof:#?}");
    assert_eq!(
        proof.response_shape.sensitive_leaks[0].reason,
        "sensitive_field_without_serializer"
    );
}
```

- [ ] **Step 2: RED test for serializer output pass**

Add to the same file:

```rust
#[test]
fn security_phase5_serializer_output_used_in_response_proves_safe() {
    let source = r#"
import { serializePublicUser } from "@/lib/serializers/user";
export async function GET() {
  const user = { email: "redacted@example.test" };
  const safe = serializePublicUser(user);
  return Response.json({ user: { email: safe.email } });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "user.email".to_string(),
            classification: "pii".to_string(),
            source: "contract".to_string(),
        }],
        response_serializers: vec![AcceptedResponseSerializer {
            serializer_id: "serializePublicUser".to_string(),
            import_source: "@/lib/serializers/user".to_string(),
            imported_name: "serializePublicUser".to_string(),
            local_name: None,
            policy: ResponseSerializerPolicy::Denylist,
            filtered_fields: vec!["user.email".to_string()],
        }],
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };

    let proof = build_response_shape_proof("app/api/users/route.ts", source, &phase5)
        .expect("response proof");
    assert!(proof.response_shape.sensitive_leaks.is_empty(), "{proof:#?}");
}
```

- [ ] **Step 3: Run RED**

Run:

```bash
cargo test -p drift-engine security_phase5_serializer_ -- --nocapture
```

Expected:
- `security_phase5_serializer_call_must_feed_emitted_response_value` fails because file-global serializer proof suppresses the raw leak.

- [ ] **Step 4: GREEN implementation**

Implement minimal Rust changes:
- Add `source_expr` or `source_var` to `response_emits_field` fact values when static object values are member expressions like `safe.email` or `user.email`.
- Preserve existing fact shape fields and add only optional fields:

```json
{
  "route_id": "route:app/api/users/route.ts:GET",
  "response_id": "response:app/api/users/route.ts:5",
  "field_path": "user.email",
  "source_var": "safe",
  "source_expr": "safe.email",
  "classification": "unknown"
}
```

- In `security_proof.rs`, replace file-global serializer suppression with a check that:
  - `serializer_called.route_id == response_emits_field.route_id`
  - serializer `output_var` exists
  - response emitted field source is derived from that `output_var`
  - serializer filtered fields contain the sensitive field path
  - serializer policy is accepted `allowlist` or `denylist`

Do not accept:
- Serializer in same file but unused.
- Serializer output assigned in one route and response emitted in another route.
- Serializer whose `output_var` is absent unless response directly calls the accepted serializer and the response fact can represent that call.

- [ ] **Step 5: Run GREEN**

Run:

```bash
cargo test -p drift-engine security_phase5_serializer_ -- --nocapture
cargo test -p drift-engine security_phase5_response_shape_proof -- --nocapture
```

Expected:
- Both pass.

---

## Task 2: Response Variable Spread Must Emit Parser Gap

**Risk Closed:** `const payload = { ...user }; return Response.json(payload);` silently passes because spread is dropped during variable field extraction.

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Test: `crates/drift-engine/tests/security_facts.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`

- [ ] **Step 1: RED fact/proof test for variable spread**

Add to `crates/drift-engine/tests/security_rules.rs`:

```rust
#[test]
fn security_phase5_response_variable_spread_blocks_with_parser_gap() {
    let source = r#"
export async function GET() {
  const user = { email: "redacted@example.test" };
  const payload = { ...user };
  return Response.json(payload);
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "user.email".to_string(),
            classification: "pii".to_string(),
            source: "contract".to_string(),
        }],
        response_serializers: Vec::new(),
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };

    let proof = build_response_shape_proof("app/api/users/route.ts", source, &phase5)
        .expect("response proof");
    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap, "{proof:#?}");
    assert!(
        proof.parser_gaps.iter().any(|gap| gap.code == "unsupported_destructuring_or_spread"),
        "{proof:#?}"
    );
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
cargo test -p drift-engine security_phase5_response_variable_spread -- --nocapture
```

Expected:
- Fails because parser gaps only inspect spread directly in `Response.json(...)`.

- [ ] **Step 3: GREEN implementation**

Implement in Rust:
- Track response variables created from object literals with spread as unknown response shape.
- Add local summary in `security_facts.rs` or `security_control_flow.rs`:
  - variable name
  - declaration line
  - route id if available
  - reason `unsupported_destructuring_or_spread`
- In `build_response_shape_proof`, when `Response.json(payload)` uses a known spread-bearing variable, emit a blocking `SecurityParserGap` with code `unsupported_destructuring_or_spread`.

Do not:
- Emit known-safe `response_emits_field` for spread-bearing variables.
- Treat spread as no fields and pass.

- [ ] **Step 4: Run GREEN**

Run:

```bash
cargo test -p drift-engine security_phase5_response_variable_spread -- --nocapture
cargo test -p drift-engine security_phase5_response_shape_facts -- --nocapture
cargo test -p drift-engine security_phase5_response_shape_proof -- --nocapture
```

Expected:
- All pass.

---

## Task 3: Secret Exposure Must Track One-Hop Object Aliases And Inline Reads

**Risk Closed:** `const payload = { apiKey }; return Response.json(payload);` and inline `Response.json({ apiKey: process.env.API_KEY })` can pass.

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`
- Test: `crates/drift-engine/tests/security_facts.rs`

- [ ] **Step 1: RED test for object alias**

Add to `crates/drift-engine/tests/security_rules.rs`:

```rust
#[test]
fn security_phase5_secret_object_alias_reaches_response_sink() {
    let source = r#"
export async function GET() {
  const apiKey = process.env.API_KEY;
  const payload = { apiKey };
  return Response.json(payload);
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: vec!["console.error".to_string()],
    };

    let proof = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    assert_eq!(proof.secret_exposure.exposed_secrets.len(), 1, "{proof:#?}");
    assert_eq!(proof.secret_exposure.exposed_secrets[0].sink_kind, "response");
}
```

- [ ] **Step 2: RED test for inline env read**

Add:

```rust
#[test]
fn security_phase5_inline_secret_read_in_response_blocks() {
    let source = r#"
export async function GET() {
  return Response.json({ apiKey: process.env.API_KEY });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: vec!["console.error".to_string()],
    };

    let proof = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    assert_eq!(proof.secret_exposure.exposed_secrets.len(), 1, "{proof:#?}");
}
```

- [ ] **Step 3: Run RED**

Run:

```bash
cargo test -p drift-engine security_phase5_secret_object_alias -- --nocapture
cargo test -p drift-engine security_phase5_inline_secret_read -- --nocapture
```

Expected:
- Both fail because only direct identifier use at sink is currently detected.

- [ ] **Step 4: GREEN implementation**

Implement local-only taint summary:
- Secret source variables from `secret_read` facts are tainted.
- One-hop aliases are tainted:
  - `const payload = apiKey;`
  - `const payload = { apiKey };`
  - `const payload = { key: apiKey };`
- Response/log sink is exposed if it uses a tainted variable or contains an inline accepted secret read.

Keep scope deliberately local:
- No broad interprocedural taint.
- No object spread as safe; object spread with a tainted value should either block if directly known or parser-gap if unknown.

- [ ] **Step 5: Run GREEN**

Run:

```bash
cargo test -p drift-engine security_phase5_secret_object_alias -- --nocapture
cargo test -p drift-engine security_phase5_inline_secret_read -- --nocapture
cargo test -p drift-engine security_phase5_secret_exposure_proof -- --nocapture
```

Expected:
- All pass.

---

## Task 4: Unsupported Secret Helper Forms Must Emit Parser Gaps

**Risk Closed:** Arrow/async/imported/unknown helper secret flows can silently pass.

**Files:**
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`

- [ ] **Step 1: RED tests for helper forms**

Add to `crates/drift-engine/tests/security_rules.rs`:

```rust
#[test]
fn security_phase5_arrow_secret_helper_emits_parser_gap() {
    let source = r#"
const readSecret = () => process.env.API_KEY;
export async function GET() {
  const apiKey = readSecret();
  return Response.json({ apiKey });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: Vec::new(),
    };
    let proof = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap, "{proof:#?}");
}

#[test]
fn security_phase5_imported_unknown_secret_helper_emits_parser_gap() {
    let source = r#"
import { readSecret } from "@/server/secrets";
export async function GET() {
  const apiKey = readSecret();
  return Response.json({ apiKey });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string(), "secret_manager".to_string()],
        log_sinks: Vec::new(),
    };
    let proof = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap, "{proof:#?}");
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
cargo test -p drift-engine security_phase5_arrow_secret_helper -- --nocapture
cargo test -p drift-engine security_phase5_imported_unknown_secret_helper -- --nocapture
```

Expected:
- Both fail because only `function name() { return process.env... }` is recognized.

- [ ] **Step 3: GREEN implementation**

Implement parser-gap detection for:
- `const readSecret = () => process.env.API_KEY`
- `const readSecret = async () => process.env.API_KEY`
- `const readSecret = () => secretManager.get(...)`
- imported helper call whose local name matches secret-like naming and whose result reaches response/log:
  - `readSecret`
  - `getSecret`
  - `loadSecret`
  - `readApiKey`
  - `getToken`

Parser gap:
- `code`: `unsupported_dynamic_control_flow`
- `blocks_enforcement`: `true`
- no raw import path, source snippet, env key, or secret value in reason.

- [ ] **Step 4: Run GREEN**

Run:

```bash
cargo test -p drift-engine security_phase5_arrow_secret_helper -- --nocapture
cargo test -p drift-engine security_phase5_imported_unknown_secret_helper -- --nocapture
cargo test -p drift-engine security_phase5_secret_exposure_proof -- --nocapture
```

Expected:
- All pass.

---

## Task 5: Evaluate Phase 5 Per Route Method Range

**Risk Closed:** `matcher.methods` is file-level; a `GET` contract can block on a `POST` leak in the same `route.ts`.

**Files:**
- Modify: `crates/drift-engine/src/security_proof.rs`
- Modify: `crates/drift-engine/src/security_rules.rs`
- Modify: `crates/drift-engine/src/check_command.rs`
- Test: `crates/drift-engine/tests/security_check_repo_phase5.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`

- [ ] **Step 1: RED check-repo test for mixed method file**

Add to `crates/drift-engine/tests/security_check_repo_phase5.rs`:

```rust
#[test]
fn security_phase5_get_contract_does_not_block_post_leak_in_same_route_file() {
    let repo_root = temp_repo("phase5_mixed_methods");
    write_route(
        &repo_root,
        "app/api/users/route.ts",
        "export async function GET() {\n  return Response.json({ ok: true });\n}\nexport async function POST() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\n",
    );

    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase5_methods", "repo_root": repo_root.to_string_lossy() },
        "scan": {
            "scan_id": "scan_phase5_methods",
            "facts": [
                fact_for_path("app/api/users/route.ts", "file_role_detected", "api_route", 1, 6, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "GET", 1, 3, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "POST", 4, 6, None, None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 2, 2, Some("Response"), None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 6, 6, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase5_methods",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_sensitive_response",
                "kind": "api_route_forbids_sensitive_response_fields",
                "matcher": { "methods": ["GET"], "applies_to_file_roles": ["api_route"] },
                "scope": { "path_globs": ["/api/users/*"] },
                "requires": {
                    "sensitive_response_fields": [{
                        "field_path": "user.email",
                        "classification": "pii",
                        "source": "contract"
                    }]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    assert!(payload["findings"].as_array().expect("findings").is_empty(), "{payload:#?}");
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
cargo test -p drift-engine security_phase5_get_contract_does_not_block_post_leak -- --nocapture
```

Expected:
- Fails because proof/rule considers all file response facts for a method-scoped contract.

- [ ] **Step 3: GREEN implementation**

Implement route-range proof building:
- Add `Phase5ProofScope { route_id, method, start_line, end_line }`.
- Filter response fields, serializer calls, secret reads, and sink checks to the selected route range.
- In `check_command.rs`, iterate `route_declared` facts and build/evaluate proof per matched route method.
- `matcher.methods` must match the route method, not the file.
- `path_globs` still match route path/file path.

- [ ] **Step 4: Run GREEN**

Run:

```bash
cargo test -p drift-engine security_phase5_get_contract_does_not_block_post_leak -- --nocapture
cargo test -p drift-engine security_phase5_scope_filtering -- --nocapture
cargo test -p drift-engine security_phase5_rules -- --nocapture
```

Expected:
- All pass.

---

## Task 6: Make Phase 5 Schemas Strict And Reject Unsafe Values Everywhere

**Risk Closed:** Phase 5 `.passthrough()` accepts unknown fields; unsafe source/secret value keys are only scanned inside `requires`.

**Files:**
- Modify: `packages/core/src/security.ts`
- Modify: `packages/engine-contract/src/index.ts`
- Test: `packages/core/test/security.test.ts`
- Test: `packages/engine-contract/test/security-contract.test.ts`

- [ ] **Step 1: RED schema tests**

Add tests asserting these payloads fail:

```ts
expect(() => AcceptedConventionSchema.parse({
  ...phase5SensitiveConvention,
  requires: {
    ...phase5SensitiveConvention.requires,
    unexpected_phase5_field: true
  }
})).toThrow();

expect(() => AcceptedConventionSchema.parse({
  ...phase5SensitiveConvention,
  matcher: {
    ...phase5SensitiveConvention.matcher,
    source_value: "SECRET_VALUE_SHOULD_NOT_LEAK"
  }
})).toThrow();

expect(() => EngineCheckRequestSchema.parse({
  ...request,
  contract: {
    ...request.contract,
    conventions: [{
      ...request.contract.conventions[0],
      scope: {
        path_globs: ["app/api/**/route.ts"],
        secret_value: "sk_live_should_not_leak"
      }
    }]
  }
})).toThrow();
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected:
- Fails because unknown keys are accepted or unsafe keys outside `requires` are not rejected.

- [ ] **Step 3: GREEN implementation**

Implement:
- Replace Phase 5 `requires` `.passthrough()` with `.strict()`.
- Validate Phase 5 convention payload recursively for disallowed key names:
  - `source_value`
  - `secret_value`
  - `env_value`
  - `token_value`
  - `cookie_value`
  - `header_value`
  - `request_payload`
  - `raw_source`
  - `source_snippet`
  - `full_source`
- Keep allowed `source: "contract" | "schema" | "candidate"` field; do not reject it by substring.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
pnpm typecheck
```

Expected:
- All pass.

---

## Task 7: Require Phase 5 Proof Sections For Matched Phase 5 Contracts

**Risk Closed:** TS defaults `response_shape` / `sinks` to empty, so Phase 5 proof objects can validate without the expected Phase 5 evidence sections.

**Files:**
- Modify: `packages/core/src/security.ts`
- Modify: `packages/engine-contract/src/index.ts`
- Test: `packages/core/test/security.test.ts`
- Test: `packages/engine-contract/test/security-contract.test.ts`

- [ ] **Step 1: RED proof schema tests**

Add:

```ts
const phase5ProofWithoutResponseShape = {
  ...baseProof,
  contracts: [{
    contract_id: "security_api_sensitive_response",
    kind: "api_route_forbids_sensitive_response_fields",
    enforcement_mode: "block",
    capability: "deterministic_check",
    matched: true
  }],
  response_shape: undefined
};

expect(() => SecurityBoundaryProofSchema.parse(phase5ProofWithoutResponseShape)).toThrow();

const phase5SecretProofWithoutSinks = {
  ...baseProof,
  contracts: [{
    contract_id: "security_api_secret_exposure",
    kind: "api_route_forbids_secret_exposure",
    enforcement_mode: "block",
    capability: "deterministic_check",
    matched: true
  }],
  sinks: undefined
};

expect(() => SecurityBoundaryProofSchema.parse(phase5SecretProofWithoutSinks)).toThrow();
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected:
- Fails because schemas default missing Phase 5 sections.

- [ ] **Step 3: GREEN implementation**

Implement schema refinement:
- For matched `api_route_forbids_sensitive_response_fields`, `response_shape` must be present.
- For matched `api_route_forbids_secret_exposure`, `sinks.secrets` must be present.
- Existing non-Phase-5 proofs may continue to omit those sections.
- Do not use defaults for matched Phase 5 blocking contracts.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
pnpm --filter @drift/cli test -- security-check
```

Expected:
- All pass.

---

## Task 8: Tighten `secret_read` Extraction And Redaction

**Risk Closed:** Unknown env/config reads produce secret facts; env-key-shaped local variable names can leak via `Fact.name`.

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Test: `crates/drift-engine/tests/security_facts.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`

- [ ] **Step 1: RED test for unknown public config**

Add:

```rust
#[test]
fn security_phase5_secret_read_ignores_unknown_public_config_unless_explicitly_accepted() {
    let source = r#"
export async function GET() {
  const publicName = config.publicName;
  return Response.json({ ok: true });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["config".to_string()],
        log_sinks: Vec::new(),
    };
    let facts = extract_security_facts_with_phase5(
        "app/api/config/route.ts",
        source,
        &[],
        &[],
        Some(&phase5),
    )
    .expect("facts");
    assert!(
        facts.iter().all(|fact| fact.kind != FactKind::SecretRead),
        "{facts:#?}"
    );
}
```

- [ ] **Step 2: RED test for env-shaped local variable name redaction**

Add:

```rust
#[test]
fn security_phase5_secret_read_fact_name_does_not_leak_env_key_shaped_variable() {
    let source = r#"
export async function GET() {
  const API_KEY = process.env.API_KEY;
  return Response.json({ ok: true });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: Vec::new(),
    };
    let facts = extract_security_facts_with_phase5(
        "app/api/config/route.ts",
        source,
        &[],
        &[],
        Some(&phase5),
    )
    .expect("facts");
    let serialized = format!("{facts:#?}");
    assert!(!serialized.contains("API_KEY"), "{serialized}");
}
```

- [ ] **Step 3: Run RED**

Run:

```bash
cargo test -p drift-engine security_phase5_secret_read_ -- --nocapture
```

Expected:
- Fails because unknown config is emitted or fact name includes `API_KEY`.

- [ ] **Step 4: GREEN implementation**

Implement:
- Only emit `secret_read` when classification is not `unknown`, unless the accepted contract explicitly identifies that exact secret class/source without raw values.
- Replace `Fact.name` for secret reads with a generated safe id such as `secret_read:<file_path>:<line>`.
- Carry local variable in redacted proof-only memory if needed for flow analysis, not in persisted fact JSON/name.
- If local variable is needed across functions, store a hashed or internal-only mapping that is not emitted in facts/proof/output.

- [ ] **Step 5: Run GREEN**

Run:

```bash
cargo test -p drift-engine security_phase5_secret_read_ -- --nocapture
cargo test -p drift-engine security_phase5_secret_exposure_proof -- --nocapture
cargo test -p drift-engine security_phase5_no_sensitive_output -- --nocapture
```

Expected:
- All pass.

---

## Task 9: Persist Trusted Security Boundary Proofs

**Risk Closed:** MCP cannot consume trusted Phase 5 proof because proofs are currently output-only.

**Files:**
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/cli/src/check/run-check.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`
- Test: `packages/cli/test/security-check.test.ts`

- [ ] **Step 1: RED storage test**

Add a storage test:

```ts
it("persists security boundary proofs by check and repo without source content", () => {
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  storage.upsertSecurityBoundaryProofs([{
    repo_id: "repo_abc",
    check_id: "check_abc",
    scan_id: "scan_abc",
    proof_id: "proof_route_users_phase5",
    route_id: "route:app/api/users/route.ts:GET",
    file_path: "app/api/users/route.ts",
    proof_json: phase5Proof,
    created_at: "2026-05-27T00:00:00.000Z"
  }]);

  const proofs = storage.listSecurityBoundaryProofs("repo_abc", { checkId: "check_abc" });
  expect(proofs).toHaveLength(1);
  expect(JSON.stringify(proofs)).not.toContain("SECRET_VALUE_SHOULD_NOT_LEAK");
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @drift/storage test
```

Expected:
- Fails because proof persistence APIs/table do not exist.

- [ ] **Step 3: GREEN implementation**

Add migration:
- `security_boundary_proofs`
- Columns:
  - `repo_id TEXT NOT NULL`
  - `check_id TEXT NOT NULL`
  - `scan_id TEXT NOT NULL`
  - `proof_id TEXT NOT NULL`
  - `route_id TEXT NOT NULL`
  - `file_path TEXT NOT NULL`
  - `proof_json TEXT NOT NULL`
  - `created_at TEXT NOT NULL`
  - primary key `(repo_id, check_id, proof_id)`
- Indexes:
  - `(repo_id, check_id)`
  - `(repo_id, scan_id)`
  - `(repo_id, file_path)`

Add typed APIs:
- `upsertSecurityBoundaryProofs(rows)`
- `listSecurityBoundaryProofs(repoId, { checkId?, scanId?, filePath? })`

Validate `proof_json` with `SecurityBoundaryProofSchema`.

Update `run-check.ts`:
- After engine-owned checks, persist `securityBoundaryProofs`.
- Do not persist source snippets or raw facts as proof.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @drift/storage test
pnpm --filter @drift/cli test -- security-check
pnpm typecheck
```

Expected:
- All pass.

---

## Task 10: Make MCP Phase 5 Read Model Proof-Derived

**Risk Closed:** MCP Phase 5 context is raw-fact-based and returns only `not_evaluated`.

**Files:**
- Modify: `packages/query/src/security-boundary-proof.ts`
- Modify: `packages/mcp/src/security-context.ts`
- Modify: `packages/mcp/src/index.ts` only if handler wiring needs latest check id.
- Test: `packages/query/test/security-boundary-proof.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: RED query test**

Add:

```ts
it("reports Phase 5 sensitive leaks and secret exposure from Rust proof only", () => {
  const model = buildSecurityBoundaryProofReadModel({
    proofs: [phase5SensitiveProof, phase5SecretProof],
    findings: []
  });

  expect(model.routes).toContainEqual(expect.objectContaining({
    response_shape_required: true,
    response_shape_proven: false,
    sensitive_response_leak_reasons: ["sensitive_field_without_serializer"]
  }));
  expect(model.routes).toContainEqual(expect.objectContaining({
    secret_exposure_count: 1,
    secret_exposure_sink_kinds: ["response"]
  }));
  expect(JSON.stringify(model)).not.toContain("API_KEY");
});
```

- [ ] **Step 2: RED MCP test**

Add:

```ts
it("returns Phase 5 MCP context from stored trusted proofs, not raw facts", async () => {
  const databasePath = await seedMcpDatabase();
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  storage.upsertSecurityBoundaryProofs([storedPhase5SensitiveProof, storedPhase5SecretProof]);
  storage.upsertFacts([rawSensitiveFieldFact, rawSecretReadFact]);
  storage.close();

  const securityContext = createReadOnlyMcpHandlers({ databasePath }).get_security_context({
    repo_id: "repo_abc"
  } as never);

  expect(securityContext.sensitive_response.routes[0]).toMatchObject({
    proof_status: "missing_proof",
    proven: false
  });
  expect(securityContext.secret_exposure.routes[0]).toMatchObject({
    exposed_secret_count: 1
  });
  expect(JSON.stringify(securityContext)).not.toContain("API_KEY");
  expect(JSON.stringify(securityContext)).not.toContain("SECRET_VALUE_SHOULD_NOT_LEAK");
});
```

- [ ] **Step 3: RED raw-facts-only MCP test**

Add:

```ts
it("does not promote raw Phase 5 facts to trusted MCP proof", async () => {
  const databasePath = await seedMcpDatabase();
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  storage.upsertFacts([rawSensitiveFieldFact, rawSecretReadFact]);
  storage.close();

  const securityContext = createReadOnlyMcpHandlers({ databasePath }).get_security_context({
    repo_id: "repo_abc"
  } as never);

  expect(securityContext.sensitive_response.proof_status).toBe("not_evaluated");
  expect(securityContext.secret_exposure.proof_status).toBe("not_evaluated");
});
```

- [ ] **Step 4: Run RED**

Run:

```bash
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/mcp test
```

Expected:
- MCP test fails until stored proofs are read and query read model is used.

- [ ] **Step 5: GREEN implementation**

Implement:
- Query read model reports Phase 5 trusted fields from `SecurityBoundaryProof.response_shape` and `sinks.secrets`.
- MCP loads latest stored `security_boundary_proofs` for the repo/check/scan and calls query read model.
- Raw facts may appear only as advisory counts or `not_evaluated`; they cannot set `proven`, `missing_proof`, or blocking state.

- [ ] **Step 6: Run GREEN**

Run:

```bash
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/mcp test
pnpm typecheck
```

Expected:
- All pass.

---

## Task 11: Waiver Lifecycle Regression For Phase 5

**Risk Closed:** Phase 5 findings must be waived on the engine-owned path before CI/check failure and must not be stored as active.

**Files:**
- Modify: `packages/cli/src/check/run-check.ts`
- Test: `packages/cli/test/security-check.test.ts`
- Test: `test/e2e/security-sensitive.test.ts`

- [ ] **Step 1: RED CLI test**

Add a CLI test:

```ts
it("honors active Phase 5 path waivers before storing active findings", async () => {
  const resultWithoutWaiver = await runPhase5SensitiveCheck({ waiver: false });
  expect(resultWithoutWaiver.exitCode).toBe(1);
  expect(JSON.parse(resultWithoutWaiver.stdout).summary.blocking_count).toBe(1);

  const resultWithWaiver = await runPhase5SensitiveCheck({ waiver: true });
  const payload = JSON.parse(resultWithWaiver.stdout);
  expect(resultWithWaiver.exitCode).toBe(0);
  expect(payload.summary).toMatchObject({
    findings_count: 0,
    blocking_count: 0,
    waived_findings_count: 1
  });

  const stored = storage.listFindings(repoId);
  expect(stored.some((finding) =>
    finding.convention_id === "security_api_sensitive_response" &&
    finding.status === "new"
  )).toBe(false);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected:
- Fails if Phase 5 waiver is applied after storage or not counted.

- [ ] **Step 3: GREEN implementation**

Implement:
- Apply active path waivers to Phase 5 engine-owned findings before `storage.upsertFinding`.
- Preserve stale-waiver behavior when `requires_reapproval_on_change` is true.
- Include `waived_findings_count` and sanitized `waived_findings` in JSON output.
- Do not include source, secret, env key, token, cookie, header, request payload, user ID, tenant ID.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @drift/cli test -- security-check
pnpm test:e2e -- security-sensitive
```

Expected:
- All pass.

---

## Task 12: Expand E2E Production Matrix

**Risk Closed:** Green unit tests do not cover the false-pass paths found by audit.

**Files:**
- Modify: `test/e2e/security-sensitive.test.ts`
- Create/Modify fixtures under:
  - `test/fixtures/security-sensitive-unused-serializer`
  - `test/fixtures/security-sensitive-response-var-spread`
  - `test/fixtures/security-secret-object-alias`
  - `test/fixtures/security-secret-inline-response`
  - `test/fixtures/security-secret-arrow-helper-gap`
  - `test/fixtures/security-sensitive-mixed-methods`
  - `test/fixtures/security-sensitive-candidate-only`

- [ ] **Step 1: RED e2e fixtures**

Create fixtures:
- `security-sensitive-unused-serializer`: accepted serializer called but raw response still emitted. Must block.
- `security-sensitive-response-var-spread`: spread assigned to payload then returned. Must parser-gap block.
- `security-secret-object-alias`: env read assigned into object payload then returned. Must block.
- `security-secret-inline-response`: inline `process.env.API_KEY` inside response object. Must block.
- `security-secret-arrow-helper-gap`: arrow helper returns env secret and response uses helper result. Must parser-gap block.
- `security-sensitive-mixed-methods`: GET safe, POST leaks; GET contract must pass.
- `security-sensitive-candidate-only`: candidate sensitive field emitted; must pass.

- [ ] **Step 2: RED e2e assertions**

Extend `test/e2e/security-sensitive.test.ts` with cases:

```ts
{
  name: "security-sensitive-unused-serializer",
  exitCode: 1,
  proofStatus: "missing_proof",
  actualLayer: "sensitive_response_field_unfiltered"
},
{
  name: "security-sensitive-response-var-spread",
  exitCode: 1,
  proofStatus: "parser_gap",
  actualLayer: "dynamic_response_shape_missing_proof"
},
{
  name: "security-secret-object-alias",
  exitCode: 1,
  proofStatus: "missing_proof",
  actualLayer: "secret_exposure_not_excluded"
},
{
  name: "security-secret-inline-response",
  exitCode: 1,
  proofStatus: "missing_proof",
  actualLayer: "secret_exposure_not_excluded"
},
{
  name: "security-secret-arrow-helper-gap",
  exitCode: 1,
  proofStatus: "parser_gap",
  actualLayer: "secret_exposure_not_excluded"
},
{
  name: "security-sensitive-mixed-methods",
  exitCode: 0,
  proofStatus: "proven"
},
{
  name: "security-sensitive-candidate-only",
  exitCode: 0,
  proofStatus: "proven"
}
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm test:e2e -- security-sensitive
```

Expected:
- Fails until Tasks 1-11 are implemented.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm test:e2e -- security-sensitive
```

Expected:
- Passes.

---

## Task 13: Final Sensitive Output Audit

**Risk Closed:** New proof persistence/read models may reintroduce canary leakage.

**Files:**
- Modify: `crates/drift-engine/tests/security_rules.rs`
- Modify: `packages/cli/test/security-check.test.ts`
- Modify: `packages/query/test/security-boundary-proof.test.ts`
- Modify: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: RED/guard canary test matrix**

Assert these canaries are absent from:
- Rust proof debug/JSON.
- CLI JSON.
- Stored proof rows.
- Query read model.
- MCP response.

Canaries:

```text
SECRET_VALUE_SHOULD_NOT_LEAK
sk_live_should_not_leak
tenant-should-not-leak
cookie-should-not-leak
Authorization: Bearer should-not-leak
request payload canary
API_KEY
TOKEN
```

- [ ] **Step 2: Run audit commands**

Run:

```bash
cargo test -p drift-engine security_phase5_no_sensitive_output -- --nocapture
pnpm --filter @drift/cli test -- security-check
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/mcp test
```

Expected:
- All pass. Any canary leak is a blocker.

---

## Final Gates

Run every command after all tasks are green:

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

Expected:
- All pass.
- `git status --short --branch` shows only intended Phase 5 production-readiness files.

## Done Criteria

- Serializer proof is tied to the emitted response value and route.
- Response variable spreads cannot silently pass.
- One-hop secret object aliases and inline secret reads block.
- Unsupported secret helper forms emit blocking parser gaps.
- Phase 5 rules evaluate per route method, not whole file.
- Phase 5 schemas are strict and reject unsafe payload keys anywhere in the convention payload.
- Matched Phase 5 proof schemas require the relevant proof sections.
- `secret_read` does not emit unknown public config/env reads and does not leak env-key-shaped local variable names.
- Trusted Rust proofs are persisted and loaded.
- MCP Phase 5 read model is proof-derived, not raw-fact-derived.
- Waived Phase 5 findings do not fail checks and are not stored as active.
- E2E matrix covers all audit false-pass paths.
- No Phase 6 work is implemented.
