# Security Boundary P1-P8 System Hierarchy

This is the implemented stack from lowest-level proof authority to user-facing output.

```text
Drift Security Boundary System
|
|-- 1. Rust proof engine
|   |
|   |-- File and route facts
|   |   |-- route_declared
|   |   |-- file_role_detected
|   |   |-- import_used
|   |   |-- data_operation_detected
|   |   |-- route_returns_response
|   |   |-- request_input_read
|   |   |-- request_validation_called
|   |   |-- validated_input_used
|   |   |-- session_read
|   |   |-- authorization_guard_called
|   |   |-- tenant_source
|   |   |-- tenant_guard_called
|   |   |-- outbound_request_called
|   |   |-- raw_sql_called
|   |   |-- cors_policy_declared
|   |   |-- csrf_guard_called
|   |   |-- rate_limit_guard_called
|   |   |-- response_emits_field
|   |   |-- sensitive_field_declared
|   |   |-- serializer_called
|   |   `-- secret_read
|   |
|   |-- Proof families
|   |   |-- P1 auth dominance
|   |   |-- P2 middleware route coverage
|   |   |-- P3 request validation before sink
|   |   |-- P4 session trust, authorization, tenant scope
|   |   |-- P5 sensitive response and secret exposure
|   |   `-- P6 SSRF, raw SQL, CORS, CSRF, rate limit
|   |
|   |-- Proof result states
|   |   |-- proven
|   |   |-- missing_proof
|   |   |-- parser_gap
|   |   |-- violated
|   |   `-- advisory_only
|   |
|   `-- Blocking rule
|       `-- Only deterministic accepted contracts can block.
|
|-- 2. Contract and candidate layer
|   |
|   |-- Accepted contracts
|   |   |-- Human-approved
|   |   |-- Stored in repo contract state
|   |   |-- Passed into Rust check
|   |   `-- Can block only when deterministic
|   |
|   `-- Candidates
|       |-- Proposed from scan/candidate inference
|       |-- Stored as convention_candidates
|       |-- Carry reason_not_blocking
|       |-- Require accept/reject/edit
|       `-- Cannot block before acceptance
|
|-- 3. Storage layer
|   |
|   |-- security_boundary_proof_runs
|   |   |-- check_id
|   |   |-- proof_id
|   |   |-- repo_id
|   |   |-- scan_id
|   |   |-- route_id
|   |   |-- proof_status
|   |   |-- enforcement_result
|   |   |-- parser_gap_count
|   |   |-- missing_proof_count
|   |   `-- proof_json
|   |
|   |-- security_boundary_proofs
|   |   `-- older scan-scoped proof rows
|   |
|   |-- findings
|   |   `-- persisted violation lifecycle
|   |
|   `-- scan_capability_reports
|       `-- diagnostics, not proof truth
|
|-- 4. Query/read-model layer
|   |
|   |-- buildSecurityPhase8ReadModel
|   |   |-- routes[].security
|   |   |-- repo_security_contracts
|   |   |-- changed_route_security
|   |   |-- required_proofs
|   |   |-- current_proof_status
|   |   |-- missing_proof_summaries
|   |   |-- parser_gap_summaries
|   |   `-- security_capabilities[]
|   |
|   `-- Safety rule
|       `-- Read models summarize proof; they do not create proof.
|
|-- 5. CLI surfaces
|   |
|   |-- drift check --json
|   |   `-- full check result plus security_boundary_proofs
|   |
|   |-- drift check
|   |   `-- human proof blocks
|   |
|   |-- drift scan status --json
|   |   `-- security_capabilities[] from proof runs
|   |
|   |-- drift repo map --json
|   |   `-- proof-backed routes[].security
|   |
|   `-- drift candidates
|       `-- alias over convention candidate review
|
`-- 6. MCP surfaces
    |
    |-- get_security_context
    |   `-- drift.security.context.v2
    |
    |-- get_repo_map
    |   `-- CLI parity for proof-backed routes
    |
    |-- get_scan_status
    |   `-- scan status with Phase 8 capability summaries
    |
    `-- get_findings
        `-- sanitized finding DTOs only
```

## Layer Ownership

| Layer | Can decide block/pass? | Can expose to agent? |
| --- | --- | --- |
| Rust proof engine | Yes | Through sanitized proof payload only |
| Accepted contracts | Yes, by telling Rust what to prove | Yes, without personal actor fields |
| Candidates | No | Yes, as candidate/election data |
| Storage | No | Yes, after schema validation |
| Query read model | No | Yes, proof summaries only |
| CLI/MCP | No | Yes, sanitized summaries only |

## One-Line Mental Model

```text
Accepted contract + Rust proof = enforceable security truth.
Everything else is context.
```
