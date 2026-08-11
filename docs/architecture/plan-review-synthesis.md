# Architecture Plan Review Synthesis

Date: 2026-05-21

## Review Method

Six focused subagent reviews critiqued the current architecture docs from different angles:

- security and hostile repo inputs
- FactGraph model and graph query API
- Rust engine ownership and performance
- tests, fixtures, determinism, and release quality
- product loop, MCP, and agent governance
- multi-language/OCR adapter extensibility

The reviews agreed the direction is strong: local-first product shell, Rust engine plus TypeScript product plane, evidence graph, human-governed contracts, read-only MCP, and delayed language expansion.

The main issue is that some planning docs were still concept-level where implementation requires sharper contracts.

## Final Decisions

### 1. Add A Hard Engine API Contract Before Engine-Owned Checks

Before moving checks into Rust, define:

- `EngineScanRequest`
- `EngineScanResult`
- `EngineCheckRequest`
- `EngineCheckResult`
- diagnostics
- scan/check limits
- graph completeness metadata
- JSON schema or generated TypeScript validation
- golden request/result fixtures

The CLI may persist and format engine output. It must not independently re-decide rule truth once engine-owned checks become default.

### 2. No Silent Fallback For Enforcement

Silent fallback from Rust to TypeScript is acceptable only during bootstrap and diagnostics.

For deterministic blocking checks:

- engine unavailable should fail closed
- fallback requires explicit mode/flag
- fallback output must carry diagnostics
- parity mode may run both paths, but only for validation

### 3. Certify Adapter Capabilities, Not Whole Adapters

One adapter can be deterministic for syntax facts and heuristic for call graph. Certification must attach to capabilities.

Adapter manifests should declare:

- runtime type
- SDK protocol version
- capability declarations
- evidence class per capability
- blocking eligibility
- resource limits
- filesystem/network/env permissions
- provenance/license
- determinism guarantee

### 4. Separate Stable Entities From Versioned Occurrences

FactGraph IDs must distinguish:

- stable logical entities: file, module, symbol, package, route
- scan-versioned observations: file versions, import declarations, callsites, evidence spans

Content hashes belong on versioned artifacts, not stable file IDs.

### 5. Add Graph Completeness Semantics

Blocking rules need a machine-readable answer to:

```text
Do we have complete enough evidence for this rule in this scope?
```

Completeness must include:

- required node kinds
- required edge kinds
- required adapter capabilities
- evidence class/confidence
- incomplete behavior
- whether incomplete results may block

### 6. Make Agent Responses Action-Oriented

CLI JSON and MCP responses should not leave agents guessing.

Agent-facing responses should include a common envelope and an explicit action:

- `safe_to_edit`
- `run_scan_first`
- `blocked_by_policy`
- `blocked_by_stale_graph`
- `blocked_by_open_findings`
- `needs_human_governance`
- `unsupported_repo`
- `context_truncated`

### 7. Strengthen Security Before External Adapters

Do not execute `local_external_binary`, `third_party_adapter`, or `model_assisted` adapters until sandboxing and egress contracts exist.

Do not implement import resolution by executing repo code or loading repo config as code.

Do not persist raw snippets or full file content in graph artifacts unless redaction-before-storage rules exist.

### 8. Add Fixture Reality And Determinism Gates

The fixture matrix is currently a plan, not reality. The docs must say that clearly.

Before graph/engine expansion, add:

- fixture implementation table
- determinism contract
- repeated-run tests
- exact normalized IDs/fingerprints where stable
- negative compatibility fixtures

### 9. OSS Release Readiness Is A Separate Workstream

The release policy is directionally right but public OSS polish is not done.

Missing before serious public release:

- license
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- issue templates
- PR template
- package metadata
- declared public API
- Node/Rust/OS support matrix

## Docs Added From This Review

- `docs/architecture/engine-api-contract.md`
- `docs/architecture/adapter-sdk-protocol.md`
- `docs/architecture/agent-response-contract.md`
- this synthesis doc

## Roadmap Adjustment

Updated sequence:

```text
CLI modularization
-> security and compatibility guardrails
-> engine API contract
-> adapter SDK protocol
-> fixture matrix and determinism gates
-> FactGraph V1
-> graph query API
-> import resolution
-> incremental invalidation
-> engine-owned checks
-> scale gates
-> dogfood Drift on Drift
```

## Red Flags That Should Block Implementation

- external adapters before sandbox/process policy
- engine-owned checks before request/result schemas and parity fixtures
- FactGraph V1 before entity-vs-occurrence ID policy
- blocking rules before graph completeness semantics
- MCP expansion before common policy-gated response envelope
- public OSS release before license/security/contributing/release metadata
