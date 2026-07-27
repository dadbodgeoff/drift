# Drift V3 Visual System Map

Date: 2026-05-24
Scope: diagrams reflect current code and live command behavior, not aspirational README text.

## 1. Full System Architecture

```mermaid
flowchart TB
  Repo["Target TS/JS repo"] --> CLI["packages/cli\nlocal Drift CLI"]
  CLI --> EngineBridge["CLI engine bridge\ncollect-scan-data"]
  EngineBridge --> Rust["crates/drift-engine\nRust scanner/checker"]
  Rust --> EngineContract["@drift/engine-contract\nschema boundary"]
  EngineContract --> CLI

  Rust --> Facts["Parsed facts\nfiles/imports/exports/calls/routes/roles/data ops"]
  Rust --> GraphStream["Graph batches\nnodes/edges/evidence/diagnostics"]

  CLI --> Storage["@drift/storage\nSQLite storage"]
  Facts --> Storage
  GraphStream --> Storage

  Storage --> SQLite[("SQLite DB\nrepos/scans/facts/graph/contracts/findings/audit")]
  SQLite --> Query["@drift/query\nread models"]
  SQLite --> FactGraph["@drift/factgraph\nschema + stable IDs"]

  Query --> RepoMap["Repo map"]
  Query --> RouteFlow["Route/service/data-access flow"]
  Query --> Impact["Change impact + test relevance"]
  Query --> Completeness["Completeness + parser gaps"]

  RepoMap --> CLI
  RouteFlow --> CLI
  Impact --> CLI
  Completeness --> CLI

  CLI --> Contracts["Conventions + repo contracts\nhuman confirmed"]
  Contracts --> Storage
  CLI --> Checks["Check runner\nengine-owned + contract checks"]
  Checks --> Findings["Findings + check runs"]
  Findings --> Storage

  CLI --> Audit["Audit + backup/restore"]
  Audit --> Storage

  MCP["packages/mcp\nread-only MCP server"] --> Storage
  MCP --> Query
  MCP --> Tools["MCP tools\nscan status/repo map/preflight/findings/contract/audit/context"]

  Core["@drift/core\nschemas/capabilities/contracts"] --> CLI
  Core --> MCP
  Core --> Storage
  Core --> Query

  Boundaries["check-boundaries.mjs\npackage architecture gate"] --> CLI
  Boundaries --> Core
  Boundaries --> Storage
  Boundaries --> MCP
```

Key boundary facts:

- Rust commands are `scan-repo`, `check-repo`, and `infer-candidates`.
- MCP exposes read-only tools only.
- Raw SQLite is restricted to `@drift/storage`.
- CLI/MCP are transport surfaces; shared truth should live in core/query/storage.

## 2. Runtime Product Loop

```mermaid
flowchart LR
  Start["User runs scan/start"] --> Scan["Scan repo\nRust engine"]
  Scan --> Parse["Parse TS/JS facts"]
  Parse --> Graph["Build fact graph\nnodes/edges/evidence"]
  Graph --> Persist["Persist SQLite\nfacts + graph projections"]
  Persist --> Gaps["Persist parser gaps\nconfidence impact"]

  Persist --> Infer["Infer convention candidates"]
  Infer --> Review["Human reviews candidates"]
  Review -->|accept/import| Contract["Materialize repo contract"]
  Review -->|reject/no signal| NoContract["No contract\nmetadata only"]

  Contract --> Baseline["Baseline existing violations"]
  Contract --> Prepare["Prepare/agent preflight"]
  NoContract --> Prepare

  Prepare --> ContextPolicy["Apply context policy\nredactions/read-only"]
  ContextPolicy --> Agent["Agent gets repo map,\nrelevant files, checks, findings"]

  Agent --> Change["Human/agent changes code"]
  Change --> Check["drift check\nchanged hunks/files/full"]
  Check --> EngineCheck["Engine-backed checks\nno direct data access"]
  Check --> ContractChecks["Agent contract checks\nroles/imports/entrypoint/checks"]
  EngineCheck --> Findings["Findings\nblocking/advisory/waived"]
  ContractChecks --> Findings

  Findings --> RequiredChecks["Required check executions"]
  RequiredChecks --> Audit["Audit hash chain"]
  Findings --> Audit
  Contract --> Audit
  Baseline --> Audit

  Audit --> Backup["Backup/restore support"]
  Audit --> Proof["Beta/release proof artifacts"]
```

Reality check:

- Candidate inference alone does not create governance.
- Only accepted deterministic conventions can block.
- No-contract repos still support scan/status/repo-map/prepare, but contract-backed findings/checks refuse.
- Incremental reuse is not implemented; full scan says reuse was blocked.

## 3. TS Parsing Capability Flow

```mermaid
flowchart TB
  Files["File discovery\n.ts .tsx .js .jsx"] --> Ignore["Ignore matcher\nno symlink traversal"]
  Ignore --> Parser["tree-sitter TypeScript/TSX parser"]

  Parser --> AST["AST walk\nimport_statement\nexport_statement\ncall_expression"]

  AST --> Imports["Import facts\nvalue imports only\nnamed/default/namespace/re-export"]
  AST --> Exports["Export facts\nfunction/class/default/re-export"]
  AST --> Calls["Callsite facts\nidentifier/member calls"]
  AST --> Routes["Route facts\nNext app route + pages/api"]
  AST --> Roles["Path role facts\napi/service/data/cli/core/query/storage/mcp/test/config"]

  Calls --> DataOps["Data operation facts\nDB-like receiver/path/name heuristic"]
  Imports --> Resolver["Import resolver\nrelative/alias/workspace/package/index/exports/imports"]
  Exports --> Resolver

  Resolver --> Resolved["Resolved module edges"]
  Resolver --> Unresolved["Unresolved symbol/import gaps"]

  Roles --> Graph["Graph projection"]
  Routes --> Graph
  Calls --> Graph
  DataOps --> Graph
  Resolved --> Graph
  Unresolved --> Gaps["Parser gaps\nconfidence impact"]

  Graph --> Flow["Route/service/data-access flow"]
  Graph --> Impact["Affected files/change impact"]
  Graph --> RepoMap["Repo map/topology"]
  Gaps --> Confidence["Confidence gating\ncomplete/can_block/reasons"]
```

Production caveat:

- This is static syntax plus resolver and path heuristics. It is not full TypeScript semantic analysis.
- Live Drift-on-Drift scan found 45 parser gaps: 33 unresolved symbols and 12 unsupported framework patterns.

## 4. CLI/MCP Parity Map

```mermaid
flowchart LR
  Storage[("SQLite DB")] --> SharedQuery["@drift/query\nshared read models"]
  Storage --> Core["@drift/core\nschemas/capabilities/policy"]

  SharedQuery --> CLI["CLI commands"]
  SharedQuery --> MCP["MCP tools"]
  Core --> CLI
  Core --> MCP

  CLI --> CLIStatus["scan status"]
  MCP --> MCPStatus["get_scan_status"]
  CLIStatus <-->|beta proof parity| MCPStatus

  CLI --> CLIMap["repo map"]
  MCP --> MCPMap["get_repo_map"]
  CLIMap <-->|beta proof parity| MCPMap

  CLI --> CLIPreflight["prepare/task preflight"]
  MCP --> MCPPreflight["get_task_preflight"]
  CLIPreflight <-->|beta proof parity| MCPPreflight

  CLI --> CLIContext["policy check-context\nallowed context"]
  MCP --> MCPContext["get_allowed_context"]
  CLIContext <-->|beta proof parity| MCPContext

  CLI --> CLIFindings["findings list/show"]
  MCP --> MCPFindings["get_findings"]
  CLIFindings <-->|beta proof parity on fixture| MCPFindings

  CLI --> CLIContract["contract show"]
  MCP --> MCPContract["get_repo_contract"]
  CLIContract <-->|beta proof parity on fixture| MCPContract

  CLI --> CLIAudit["audit verify/status"]
  MCP --> MCPAudit["get_audit_status"]
  CLIAudit <-->|beta proof parity| MCPAudit

  CLI --> CLIChecks["checks list/run"]
  MCP --> MCPChecks["get_required_check_executions"]
  CLIChecks -->|run is CLI/human confirmed| Storage
  MCPChecks -->|read only| Storage
```

Live parity notes:

- MCP tool list contains 11 read-only tools.
- Dogfood CLI and MCP both reported `drift.scan.status.v1`, 163 indexed files, and 45 parser gaps.
- Dogfood CLI and MCP both refused findings on no-contract state.
- Beta proof verified full fixture parity with `mcp_cli_parity_verified: true`.

## 5. Storage Schema Map

```mermaid
erDiagram
  repos ||--o{ scan_manifests : has
  scan_manifests ||--o{ file_snapshots : snapshots
  scan_manifests ||--o{ facts : emits
  scan_manifests ||--o{ scan_file_changes : tracks
  scan_manifests ||--o{ parser_gaps : records

  repos ||--o{ convention_candidates : proposes
  repos ||--o{ accepted_conventions : accepts
  repos ||--o{ repo_contracts : materializes

  scan_manifests ||--o{ fact_graph_artifacts : builds
  fact_graph_artifacts ||--o{ graph_nodes : contains
  fact_graph_artifacts ||--o{ graph_edges : contains
  fact_graph_artifacts ||--o{ graph_evidence : supports
  fact_graph_artifacts ||--o{ graph_diagnostics : reports
  fact_graph_artifacts ||--o{ graph_completeness : gates

  scan_manifests ||--o{ symbol_occurrences : indexes
  scan_manifests ||--o{ symbol_identities : derives
  scan_manifests ||--o{ resolver_dependencies : projects
  scan_manifests ||--o{ module_dependents : projects

  repo_contracts ||--o{ check_runs : checks
  check_runs ||--o{ findings : creates
  repo_contracts ||--o{ baseline_violations : baselines
  repo_contracts ||--o{ required_check_executions : proves

  repos ||--o{ audit_events : records
  repos ||--o{ backup_manifests : backs_up

  repos {
    text id
    text root_path
    text fingerprint
    text vcs_provider
    text remote_url_hash
    text package_manager
    text resolver_input_hash
  }

  scan_manifests {
    text id
    text repo_id
    text branch
    text commit_hash
    integer dirty
    text status
    integer file_count
    integer fact_count
  }

  facts {
    text id
    text kind
    text file_path
    text name
    text value
    real confidence
    text resolution_status
  }

  parser_gaps {
    text gap_id
    text kind
    text file_path
    text confidence_impact
    text message
  }

  fact_graph_artifacts {
    text id
    text schema_version
    text graph_hash
    integer node_count
    integer edge_count
    integer evidence_count
  }

  graph_completeness {
    text id
    text scope
    integer complete
    integer can_block
    text reasons_json
  }

  repo_contracts {
    text id
    text repo_id
    text schema_version
    text contract_json
    text fingerprint
  }

  findings {
    text id
    text convention_id
    text fingerprint
    text status
    text diff_status
    text graph_path_json
    text suggested_fix
  }

  required_check_executions {
    text execution_id
    text command
    text status
    text git_branch
    text git_commit_sha
    text diff_hash
  }

  audit_events {
    text id
    text actor
    text action
    text target_type
    text target_id
    text before_hash
    text after_hash
  }
```

Schema evidence:

- Base local state starts in `packages/storage/src/migrations.ts:6`.
- Graph storage starts in `packages/storage/src/migrations.ts:244`.
- Graph v2 projections start in `packages/storage/src/migrations.ts:292`.
- Required check executions start in `packages/storage/src/migrations.ts:488`.
- Parser gaps start in `packages/storage/src/migrations.ts:540`.
- Symbol identities start in `packages/storage/src/migrations.ts:568`.
- Audit object hashes start in `packages/storage/src/migrations.ts:613`.
