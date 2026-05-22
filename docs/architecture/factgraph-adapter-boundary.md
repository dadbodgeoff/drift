# FactGraph And Adapter Boundary

Date: 2026-05-21

## Purpose

Drift should grow into an evidence graph platform, not a TypeScript scanner with extra languages bolted on.

The core boundary is:

```text
input adapters -> normalized facts -> evidence graph -> conventions/rules/preflight/checks
```

Adapters can read code, config, docs, API specs, OCR outputs, or future runtime traces. They all emit the same classes of records: facts, evidence, graph nodes, graph edges, diagnostics, and capability metadata.

## Problems This Solves

### Multi-language scale

Drift should support TypeScript, Python, Ruby, Go, Java, SQL, Terraform, OpenAPI, OCR, and other inputs without rewriting the product core for each one.

### Evidence trust

Every answer must point back to evidence: path, line, span, source hash, adapter version, and redaction state. If Drift cannot explain where an assertion came from, that assertion should not be used for blocking enforcement.

### Adapter drift

Each adapter must declare what it can produce. Rules and product surfaces should know whether they are using exact AST facts, heuristic static facts, probabilistic OCR facts, or external-tool facts.

### Stable graph history

Findings, baselines, contracts, and preflight packets need stable IDs that survive rescans. The graph model must define IDs for files, artifacts, modules, symbols, imports, calls, routes, packages, and evidence.

## Ownership Boundary

Rust should own deterministic engine work:

- file walking and bounded-memory scan behavior
- ignore rules, size limits, binary/secret skips
- adapter execution where performance or memory matter
- TypeScript/JS parsing and import resolution
- fact extraction
- graph construction
- diff classification
- deterministic rule evaluation

TypeScript should own product workflow:

- CLI command routing and output contracts
- MCP server surfaces
- SQLite persistence orchestration
- governance approvals
- policy and egress enforcement
- audit, backup, restore
- package distribution

The CLI can request engine work, persist engine output, and format results. It should not independently decide rule-critical truth once engine-owned checks are in place.

## Adapter Classes

Adapters are not only programming languages.

| Adapter class | Examples | Emits |
| --- | --- | --- |
| Code | TypeScript, Python, Ruby, Go, Java | files, modules, symbols, imports, calls, routes |
| Config | package.json, tsconfig, pyproject, Gemfile, Terraform | dependencies, scripts, aliases, config keys |
| API spec | OpenAPI, GraphQL schema, protobuf | routes, schemas, services, operations |
| Document | Markdown, docs, ADRs | sections, references, declared conventions |
| OCR | screenshots, PDFs, image-derived text | OCR tokens, blocks, confidence, spatial spans |
| Runtime | traces, logs, coverage | observed calls, endpoints, tests, coverage edges |

All adapter outputs must flow into the same graph model.

## Adapter Manifest

Each adapter declares its capabilities before it emits data.

```ts
type AdapterManifest = {
  id: string;
  version: string;
  input_kinds: Array<"code" | "config" | "api_spec" | "document" | "ocr" | "runtime">;
  languages?: string[];
  artifact_globs: string[];
  emits_fact_kinds: string[];
  emits_node_kinds: string[];
  emits_edge_kinds: string[];
  capabilities: AdapterCapability[];
  execution: {
    deterministic: boolean;
    requires_network: false;
    max_file_bytes_default: number;
  };
};

type AdapterCapability =
  | "file_discovery"
  | "syntax_facts"
  | "import_resolution"
  | "symbol_linking"
  | "call_graph"
  | "route_detection"
  | "dependency_detection"
  | "test_detection"
  | "ocr_tokens"
  | "doc_sections";
```

Rules should declare required capabilities. Example:

```ts
type RuleCapabilityRequirement = {
  rule_id: "api_route_no_direct_data_access";
  required: Array<"file_discovery" | "syntax_facts" | "route_detection">;
  preferred: Array<"import_resolution" | "symbol_linking">;
};
```

## FactGraph V1

The first graph contract should be JSON-first with SQLite projections.

```ts
type FactGraph = {
  schema_version: "factgraph.v1";
  repo: {
    repo_id: string;
    scan_id: string;
    root_hash: string;
    branch: string;
    commit: string;
    dirty: boolean;
  };
  adapters: AdapterManifest[];
  artifacts: GraphArtifact[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: GraphEvidence[];
  diagnostics: GraphDiagnostic[];
  stats: GraphStats;
};
```

## Entity, Version, And Occurrence Model

Do not collapse stable domain entities, file versions, and syntax occurrences into one ID.

The graph needs separate identifiers:

```ts
type GraphIdentityClasses = {
  file_id: "stable repo-relative path identity";
  file_version_id: "file_id plus content hash";
  module_id: "stable module identity";
  symbol_id: "best-effort stable symbol identity";
  occurrence_id: "specific syntax occurrence in a file version";
  evidence_id: "specific proof span or artifact region";
};
```

Rules:

- `file_id` is path-based and should not include a content hash.
- `file_version_id` includes the content hash.
- `symbol_id` should prefer module path, exported/local name, and symbol kind. Declaration spans can be fallback disambiguators, not the primary identity.
- `occurrence_id` can include file version and span because it is meant to change when source changes.
- Findings and baselines should prefer stable entity IDs plus rule-specific fingerprints, then attach occurrence/evidence IDs for proof.

This avoids one common failure mode: every small edit turning the graph into a brand-new universe.

## Core Node Kinds

```ts
type GraphNodeKind =
  | "repo"
  | "package"
  | "artifact"
  | "file"
  | "module"
  | "namespace"
  | "symbol"
  | "reference"
  | "import"
  | "import_decl"
  | "export"
  | "export_decl"
  | "call"
  | "callsite"
  | "route"
  | "endpoint"
  | "service"
  | "data_store"
  | "data_operation"
  | "file_role"
  | "dependency"
  | "test"
  | "config_key"
  | "schema_type"
  | "document"
  | "document_section"
  | "page"
  | "ocr_token"
  | "text_block"
  | "table"
  | "image_region"
  | "assertion"
  | "finding";
```

`import`, `export`, and `call` are semantic concepts. `import_decl`, `export_decl`, and `callsite` are occurrences in a specific source version. Keep both where Drift needs stable reasoning and line-level evidence.

## Core Edge Kinds

```ts
type GraphEdgeKind =
  | "REPO_HAS_PACKAGE"
  | "PACKAGE_CONTAINS_FILE"
  | "FILE_DEFINES_MODULE"
  | "FILE_HAS_ROLE"
  | "FILE_HAS_VERSION"
  | "MODULE_IMPORTS_MODULE"
  | "IMPORT_DECL_REFERENCES_MODULE"
  | "IMPORT_RESOLVES_TO_MODULE"
  | "IMPORT_RESOLVES_TO_SYMBOL"
  | "MODULE_EXPORTS_SYMBOL"
  | "EXPORT_DECL_REFERENCES_SYMBOL"
  | "FILE_CONTAINS_SYMBOL"
  | "REFERENCE_RESOLVES_TO_SYMBOL"
  | "SYMBOL_CALLS_SYMBOL"
  | "CALLSITE_RESOLVES_TO_SYMBOL"
  | "ROUTE_DECLARED_IN_FILE"
  | "ROUTE_HANDLED_BY_SYMBOL"
  | "ENDPOINT_ACCESSES_DATA_STORE"
  | "TEST_COVERS_SYMBOL"
  | "DOCUMENT_REFERENCES_SYMBOL"
  | "ASSERTION_SUPPORTED_BY_EVIDENCE"
  | "FINDING_HAS_EVIDENCE";
```

## Stable IDs

Stable IDs must be deterministic and versioned by entity shape.

Examples:

```text
file:<repo-relative-path>
file_version:<repo-relative-path>:<content-hash-prefix>
module:<repo-relative-path>
package:<package-name>
symbol:<repo-relative-path>:<symbol-kind>:<export-name-or-local-name>
occurrence:<repo-relative-path>:<content-hash-prefix>:<span>
import_decl:<repo-relative-path>:<content-hash-prefix>:<source>:<local-name>:<span>
route:<method>:<normalized-route-path>:<repo-relative-path>
```

Rules:

- File IDs are stable path identities; file version IDs include content hashes.
- Module IDs are path-based for local modules and package-name-based for external modules.
- Symbol IDs should survive small body changes when the module, declaration kind, and name remain stable.
- Finding fingerprints should prefer graph node IDs over raw line numbers.
- If an ID format changes, bump the graph schema or ID version.

## Evidence

```ts
type GraphEvidence = {
  id: string;
  artifact_id: string;
  file_path?: string;
  start_line?: number;
  start_column?: number;
  end_line?: number;
  end_column?: number;
  byte_start?: number;
  byte_end?: number;
  source_hash: string;
  adapter_id: string;
  adapter_version: string;
  adapter_capability: string;
  sensitivity: "public" | "internal" | "secret_like" | "denied";
  taint: Array<"repo_text" | "generated" | "model_output" | "external_tool" | "ocr">;
  extraction_kind:
    | "deterministic_ast"
    | "heuristic_static"
    | "probabilistic_ocr"
    | "external_tool"
    | "model_assisted";
  confidence: "exact" | "high" | "medium" | "low" | "unknown";
  redaction_state: "none" | "redacted" | "snippet_limited";
  page_number?: number;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
    coordinate_system: "pixels" | "points" | "normalized";
  };
};
```

Blocking rules should use `deterministic_ast` or equivalent exact evidence by default.

By default, graph evidence stores proof references and hashes, not raw source snippets. Snippets are an output-time policy decision.

## Graph Completeness

Each rule needs to know whether the graph is complete enough for enforcement.

```ts
type GraphCompleteness = {
  rule_id: string;
  scope: "changed-hunks" | "changed-files" | "full";
  required_capabilities: string[];
  available_capabilities: string[];
  unresolved_imports: number;
  skipped_files: number;
  truncated: boolean;
  enforcement_safe: boolean;
  reasons: string[];
};
```

If `enforcement_safe=false`, Drift may brief or warn, but it should not block by default.

## Storage Strategy

Decision: use Option B as the product path. Drift stores normalized graph projections in SQLite so query surfaces do not have to load giant JSON blobs. Keep an immutable graph artifact as a replay/debug/export record, but treat tables as the queryable source for CLI/MCP/UI.

```text
graph_artifacts
  id
  repo_id
  scan_id
  schema_version
  graph_hash
  graph_json
  created_at

graph_nodes
  id
  repo_id
  scan_id
  kind
  stable_key
  label
  data_json

graph_edges
  id
  repo_id
  scan_id
  kind
  from_node_id
  to_node_id
  confidence
  evidence_ids_json
  data_json

graph_evidence
  id
  repo_id
  scan_id
  artifact_id
  node_id
  occurrence_id
  source_hash
  sensitivity
  taint_json
  location_json
  data_json
```

Do not create a graph database dependency in V1. SQLite tables are enough if the schema is explicit and indexed around current product questions.

Minimum indexes:

- `graph_nodes(repo_id, scan_id, kind)`
- `graph_nodes(repo_id, scan_id, stable_key)`
- `graph_edges(repo_id, scan_id, kind)`
- `graph_edges(repo_id, scan_id, from_node_id)`
- `graph_edges(repo_id, scan_id, to_node_id)`
- `graph_evidence(repo_id, scan_id, artifact_id)`
- `graph_evidence(repo_id, scan_id, node_id)`

The full artifact exists to verify compatibility, rebuild projections, and debug engine output. It should not be the normal query path.

## V1 Query Needs

The first graph projection must support:

- repo map by file/role/path
- preflight by task and touched paths
- direct data-access check evidence
- import resolution from API route to DB/client module
- service delegation path detection
- findings linked to graph evidence
- MCP `get_repo_map` and `get_task_preflight` parity

## Non-Goals

- no graph database dependency in V1
- no semantic embeddings required for graph construction
- no model calls for deterministic fact extraction
- no broad multi-language parser promise until adapter contract is proven
- no UI graph explorer before CLI/MCP graph queries are useful

## Acceptance Criteria

- A TypeScript/Next.js scan can emit a `factgraph.v1` artifact.
- Graph artifact has stable file, module, import, symbol, route, and evidence IDs.
- SQLite stores the graph artifact and projected nodes/edges.
- `repo map`, `prepare`, MCP repo map, and check evidence can read from the same graph projection.
- Direct data-access rule can explain violations through graph evidence.
- If an adapter cannot resolve an import, the graph contains an unresolved diagnostic instead of silently dropping it.
