# Adapter SDK Protocol

Date: 2026-05-21

## Purpose

The adapter manifest says what an adapter claims. The adapter SDK defines how Drift calls adapters, negotiates capabilities, limits resource use, validates output, and keeps untrusted inputs contained.

This protocol must exist before adding Python, Ruby, Go, OCR, third-party adapters, or model-assisted adapters.

## Host-Owned Execution

Drift is the host.

Adapters should not freely walk the filesystem or choose arbitrary output locations. The host provides:

- repo-relative file access
- canonical paths
- ignore policy
- denied-glob policy
- file byte limits
- cancellation
- diagnostics sink
- output validation
- resource limits

## Lifecycle

```ts
interface DriftAdapter {
  describe(): AdapterManifest;
  initialize(request: AdapterInitializeRequest): AdapterInitializeResult;
  scan(request: AdapterScanRequest): AsyncIterable<AdapterOutputBatch>;
  shutdown(): void;
}
```

Rust built-in adapters can implement the same logical lifecycle without dynamic dispatch across process boundaries.

## Capability Declaration

Certify capabilities, not whole adapters.

```ts
type CapabilityDeclaration = {
  id: string;
  version: string;
  input_kinds: string[];
  languages?: string[];
  emits_fact_kinds: string[];
  emits_node_kinds: string[];
  emits_edge_kinds: string[];
  evidence_class:
    | "deterministic_ast"
    | "heuristic_static"
    | "probabilistic_ocr"
    | "external_tool"
    | "model_assisted";
  confidence_floor: "exact" | "high" | "medium" | "low" | "unknown";
  blocking_eligible: boolean;
  partial_modes: string[];
};
```

## Adapter Manifest

```ts
type AdapterManifest = {
  id: string;
  version: string;
  sdk_protocol_version: "adapter.sdk.v1";
  adapter_runtime: "builtin_rust" | "wasm" | "local_process" | "model_assisted";
  entrypoint?: string;
  capabilities: CapabilityDeclaration[];
  resource_limits: {
    max_file_bytes: number;
    max_output_bytes: number;
    timeout_ms: number;
  };
  security_permissions: {
    filesystem_access: "host_provided_only" | "read_repo" | "none";
    allowed_read_roots: string[];
    allowed_write_roots: string[];
    env_policy: "empty" | "allowlisted";
    network_policy: "none" | "policy_gated";
  };
  provenance: {
    source: "builtin" | "first_party" | "third_party";
    license?: string;
    executable_hash?: string;
  };
  determinism_guarantee: "deterministic" | "best_effort" | "non_deterministic";
};
```

## Capability Negotiation

The host asks for capabilities required by the scan/rule.

```ts
type AdapterInitializeRequest = {
  requested_capabilities: string[];
  preferred_capabilities: string[];
  limits: EngineLimits;
};

type AdapterInitializeResult = {
  accepted_capabilities: string[];
  degraded_capabilities: Array<{ capability: string; reason: string }>;
  unsupported_capabilities: Array<{ capability: string; reason: string }>;
};
```

Rules should read negotiated capabilities, not adapter claims.

## Output Batches

```ts
type AdapterOutputBatch = {
  adapter_id: string;
  adapter_version: string;
  sequence: number;
  facts: EngineFact[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: GraphEvidence[];
  diagnostics: EngineDiagnostic[];
  stats_delta: Partial<EngineStats>;
};
```

Every batch must validate before persistence.

## Runtime Policy

V1 allowed runtime:

- `builtin_rust`

Deferred runtimes:

- `wasm`
- `local_process`
- `model_assisted`

Do not enable deferred runtimes until sandbox/process policy exists.

## OCR And Document Requirements

OCR/document adapters need additional primitives:

- source artifact id
- page id
- page dimensions
- coordinate system
- rotation
- DPI/source dimensions
- text blocks
- tables
- reading order
- token confidence
- normalization provenance
- truth fixture certification separate from parser score

OCR evidence is not blocking-eligible by default.

## Conformance Harness

Every adapter must pass:

- manifest schema validation
- capability negotiation tests
- deterministic repeatability tests
- malformed input tests
- oversized input tests
- unsupported file diagnostics
- stable ID tests
- graph schema validation
- evidence completeness tests
- resource limit and cancellation tests
- no network/no execution enforcement
- version bump/invalidation tests
- cross-platform path normalization tests

Negative fixtures must include adapters that:

- overclaim capabilities
- emit invalid graph nodes
- omit evidence
- produce nondeterministic IDs
- attempt network access
- silently drop unresolved imports

## First Non-TypeScript Adapter

When ready, add Python before OCR.

Scope:

- syntax facts
- imports and local module resolution
- package/dependency detection from `pyproject.toml`, `requirements.txt`, and `setup.cfg`
- function/class symbols
- deterministic API role detection where practical
- one architecture rule equivalent to direct data access

Python stresses the adapter boundary without adding OCR uncertainty too early.
