# Adapter Certification

Date: 2026-05-21

## Purpose

Drift will eventually support many languages and artifact types. That only works if adapter capabilities are certified by evidence quality, security tier, and test coverage.

No adapter should become a special product path.

Certification is capability-level, not adapter-level. A Python adapter might be certified for imports and symbols while still experimental for call graph. Rules can only rely on the certified capabilities they declare.

## Adapter Contract

Every adapter must provide:

- manifest
- adapter protocol version
- supported input globs
- capability declarations
- emitted fact/node/edge kinds
- evidence quality level
- security tier
- deterministic behavior statement
- conformance tests
- resource limits
- permissions requested
- sandbox profile

## Certification Levels

| Level | Meaning | Can Block By Default |
| --- | --- | --- |
| `certified_deterministic` | Built-in or audited adapter with stable deterministic evidence | Yes, if rule is deterministic |
| `certified_heuristic` | Good static signal but not exact enough for blocking | No |
| `experimental` | Useful but incomplete or changing | No |
| `external_untrusted` | Third-party or local binary adapter | No |
| `model_assisted` | Uses model/remote inference | No |

## Capability Certification

```ts
type CapabilityCertification = {
  capability: string;
  level:
    | "certified_deterministic"
    | "certified_heuristic"
    | "experimental"
    | "external_untrusted"
    | "model_assisted";
  evidence_classes: string[];
  fixture_suite: string;
  deterministic: boolean;
  can_block_by_default: boolean;
};
```

Blocking rules must require certified deterministic capabilities, not just a certified adapter name.

## Evidence Classes

| Evidence class | Examples | Blocking use |
| --- | --- | --- |
| `deterministic_ast` | tree-sitter AST import/function/route facts | Allowed |
| `heuristic_static` | regex role detection, weak service inference | Warn/brief only |
| `probabilistic_ocr` | OCR tokens and layout boxes | Brief/review only |
| `external_tool` | language server or external CLI output | Depends on adapter certification |
| `model_assisted` | LLM-inferred convention/fact | Never block by default |

## Required Adapter Tests

Each adapter needs:

- manifest schema test
- fixture scan test
- deterministic output test
- stable ID test
- evidence span test
- malformed input test
- oversized input test
- skip/ignore test
- capability declaration test
- graph node/edge conformance test
- capability-level conformance test
- resource-limit test
- sandbox/permission declaration test

Language adapters also need:

- imports
- exports
- local symbols
- calls
- package/module resolution where claimed
- test file detection where claimed

OCR/document adapters also need:

- source artifact hash
- bounding boxes or page spans
- confidence values
- text normalization rules
- truth fixture certification separate from parser score

## Adapter Manifest Shape

```ts
type CertifiedAdapterManifest = {
  id: string;
  version: string;
  adapter_protocol_version: "adapter.v1";
  certification: "certified_deterministic" | "certified_heuristic" | "experimental" | "external_untrusted" | "model_assisted";
  security_tier: "builtin_trusted" | "local_external_binary" | "third_party_adapter" | "model_assisted";
  runtime: "builtin_rust" | "wasm" | "local_process" | "node" | "python" | "external";
  entrypoint?: string;
  input_kinds: string[];
  languages?: string[];
  artifact_globs: string[];
  capabilities: CapabilityCertification[];
  emits_fact_kinds: string[];
  emits_node_kinds: string[];
  emits_edge_kinds: string[];
  evidence_classes: string[];
  requires_network: false;
  permissions: {
    read_repo_files: boolean;
    read_outside_repo: false;
    write_repo_files: false;
    network: false;
    execute_repo_code: false;
  };
  resources: {
    max_file_bytes: number;
    max_batch_files: number;
    max_memory_bytes?: number;
    timeout_ms?: number;
  };
};
```

For V1, built-in adapters should use host-owned file access: Drift reads bytes, applies policy/limits, then passes bounded input to the adapter. Adapters should not walk the repo themselves.

## Adapter SDK Lifecycle

All future non-built-in adapters should fit this lifecycle:

```ts
type AdapterLifecycle = {
  describe(): CertifiedAdapterManifest;
  initialize(request: AdapterInitializeRequest): AdapterInitializeResult;
  scanBatch(request: AdapterScanBatchRequest): AdapterScanBatchResult;
  validateOutput(result: AdapterScanBatchResult): AdapterValidationResult;
  shutdown(): void;
};
```

The Drift host owns:

- repo walking
- ignore rules
- file size limits
- secret-like skip rules
- path canonicalization
- policy decisions
- output schema validation
- persistence

The adapter owns only extraction for declared capabilities.

## Promotion Rules

An adapter can move from `experimental` to `certified_heuristic` when:

- fixtures cover common repo layouts
- output is deterministic across repeated runs
- diagnostics are clear for unsupported input
- evidence refs are complete

An adapter can move to `certified_deterministic` when:

- facts are AST/parser-backed or equivalent
- stable IDs are proven
- malformed inputs are safe
- scale gates pass
- at least one rule uses the adapter in parity tests

## Security Rules

- third-party adapters disabled by default
- model-assisted adapters disabled by default
- external binaries must be explicitly enabled
- no adapter may execute repo code unless a future explicit execution policy allows it
- adapter output must validate before persistence
- adapters must declare network use; V1 built-in adapters require `requires_network=false`
- permission broadening requires explicit user approval and compatibility notes
- external adapters must run in a constrained process or sandbox before they can be considered for default installation

## Acceptance Criteria

- Adapter certification is referenced by FactGraph and engine-owned check docs.
- Rule manifests can require certified capabilities.
- Blocking checks only use deterministic certified evidence by default.
- OCR/document outputs cannot silently become blocking rule evidence.
- Adding Python/Ruby/Go later means adding certified adapters, not product-specific logic.
