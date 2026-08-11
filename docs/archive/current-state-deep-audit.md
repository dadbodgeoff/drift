# Drift V3 Deep Current-State Audit

Date: 2026-05-24
Audited path: `/Users/geoffreyfernald/Downloads/driftv3/drift v3`
Audit stance: live repo state and code/tests are source of truth. Existing docs are treated as claims unless code, tests, or generated output prove them.

## Bottom Line

Drift V3 is a local-first TypeScript/JavaScript repo-intelligence guardrail. Today it can scan a TS/JS repo with a Rust engine, persist facts and graph projections into SQLite, infer a narrow set of convention candidates, materialize human-approved repo contracts, run deterministic checks against accepted contracts, expose read-only CLI/MCP preflight context, and produce proof artifacts for the narrow beta wedge.

Historical audit note: before the hardening sprint, the credible wedge was TypeScript/JavaScript, SQLite local state, read-only MCP, human-confirmed governance, graph-backed route/service/data-access understanding, and deterministic enforcement for accepted `api_route_no_direct_data_access`. It was not a broad AI code reviewer, not a broad language system, not cloud sync, not desktop UI, not Python, and not incremental reuse. The follow-up sprint added limited unchanged-file fact reuse; the other blocked claims remain blocked.

## Live Repo State

Commands run:

```bash
git -C "/Users/geoffreyfernald/Downloads/driftv3/drift v3" status --short --branch
git -C "/Users/geoffreyfernald/Downloads/driftv3/drift v3" branch --show-current
git -C "/Users/geoffreyfernald/Downloads/driftv3/drift v3" rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git -C "/Users/geoffreyfernald/Downloads/driftv3/drift v3" rev-list --left-right --count @{upstream}...HEAD
git -C "/Users/geoffreyfernald/Downloads/driftv3/drift v3" rev-list --left-right --count origin/main...HEAD
git -C "/Users/geoffreyfernald/Downloads/driftv3/drift v3" log --oneline --decorate -12
gh -R dadbodgeoff/drift pr list --head codex/agent-contract-intelligence-tdd --state all --json number,title,state,url,baseRefName,headRefName,isDraft,mergeStateStatus,reviewDecision,updatedAt
```

Results:

```text
## codex/agent-contract-intelligence-tdd...origin/codex/agent-contract-intelligence-tdd
branch: codex/agent-contract-intelligence-tdd
upstream: origin/codex/agent-contract-intelligence-tdd
ahead/behind upstream: 0 0
origin/main...HEAD: 2 14
```

Recent commits:

```text
b6044686 (HEAD -> codex/agent-contract-intelligence-tdd, origin/codex/agent-contract-intelligence-tdd) Improve TS resolver dogfood parity
6fb6075c Derive backup schema expectations from migrations
3d66aae9 Gate product claims on runtime capabilities
1b056aa0 Add contract parity and repo topology proof
dee9153b Bind proof and audit contract state
bbe7600f Add task-aware preflight and context policy contracts
31c9f97b Add symbol identity and change impact contracts
812a968f Define adapter entrypoint and data operation contracts
5b376956 Add role ontology and layer architecture contracts
c646c454 Complete parser gap contract
4aba442b Implement fact quality contract
71fefbf3 Add codebase intelligence parity TDD
```

Open PR context:

```json
{
  "number": 76,
  "title": "Add agent contract intelligence enforcement",
  "state": "OPEN",
  "url": "https://github.com/dadbodgeoff/drift/pull/76",
  "baseRefName": "main",
  "headRefName": "codex/agent-contract-intelligence-tdd",
  "isDraft": false,
  "mergeStateStatus": "UNSTABLE",
  "reviewDecision": "",
  "updatedAt": "2026-05-24T20:00:15Z"
}
```

Interpretation: the worktree was clean at audit time and the branch was in sync with its upstream. The branch diverged from `origin/main` by 14 commits ahead and 2 commits behind. GitHub reports the PR merge state as `UNSTABLE`, so it is not production-ready merge evidence by itself.

## Package Gate

`package.json:9` defines the normal scripts. `verify:ci` is the main gate and expands to build, typecheck, Rust/package/e2e tests, Rust formatting, clippy, architecture boundaries, release-matrix validation, product-claim validation, beta proof, and `git diff --check` in `package.json:24`.

Command run:

```bash
pnpm verify:ci
```

Result: exit code 0.

Observed gate results:

- Workspace build passed for `@drift/adapters`, `@drift/core`, `@drift/factgraph`, `@drift/storage`, `@drift/engine-contract`, `@drift/query`, `@drift/cli`, and `@drift/mcp`.
- Workspace typecheck passed for the same packages.
- `cargo test -p drift-engine` passed all Rust tests: candidate inference 4, diff scope 4, direct data access 9, engine basics 3, graph-backed check 8, scale gates 3, stream graph 15, TypeScript facts 6.
- Package tests passed: adapters 10, core 34, factgraph 3, engine-contract 8, storage 21, query 20, MCP 38, CLI 338.
- E2E passed: 8 files, 49 tests.
- `cargo fmt --all -- --check` passed.
- `cargo clippy -p drift-engine --all-targets -- -D warnings` passed.
- `node packages/cli/scripts/check-boundaries.mjs` printed `Architecture boundaries OK`.
- `node scripts/validate-engine-release-matrix.mjs` printed `Validated 5 engine release targets for Drift 0.1.0.`
- `node scripts/validate-product-claims.mjs` validated `docs/architecture/beta-claims.json`.
- `node scripts/run-beta-proof.mjs` emitted `drift.beta.proof.v1` with `fallback_used: false`, `fresh_scan_verified: true`, `good_route_passed: true`, `bad_route_blocked: true`, `mcp_cli_parity_verified: true`, and `audit_verified: true`.

Unsupported-platform warnings appeared for non-current engine packages on macOS arm64. They did not fail the gate.

Targeted tests run after the full gate:

```bash
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
pnpm --filter @drift/storage test
pnpm --filter @drift/query test
cargo test -p drift-engine --test stream_graph -- --nocapture
```

Results:

- CLI: 3 files, 338 tests passed.
- MCP: 1 file, 38 tests passed.
- Storage: 1 file, 21 tests passed.
- Query: 1 file, 20 tests passed.
- Rust `stream_graph`: 15 tests passed.

One audit command was corrected: `cargo test -p drift-engine stream_graph -- --nocapture` selected 0 tests because `stream_graph` is an integration-test target name, not a test-name filter. The corrected target command above passed 15 tests.

## Rust Engine

Implemented:

- Engine commands are `scan-repo`, `check-repo`, and `infer-candidates` in `crates/drift-engine/src/main.rs:30`.
- Scan collects indexable files, builds resolver context, extracts facts, builds graph batches, emits diagnostics, and returns stats/completeness in `crates/drift-engine/src/main.rs:105`.
- Streaming scan emits JSONL graph/file/fact/evidence events before completion in `crates/drift-engine/src/main.rs:158`.
- Fact kinds include files, imports, re-exports, exports, symbol calls, data operations, route declarations, file roles, and tests in `crates/drift-engine/src/facts.rs:5`.
- The parser uses tree-sitter TypeScript/TSX grammar for `.ts`, `.tsx`, `.js`, and `.jsx` paths in `crates/drift-engine/src/facts.rs:53`.
- The AST walk extracts only `import_statement`, `call_expression`, and `export_statement` nodes in `crates/drift-engine/src/facts.rs:101`.
- Imports skip `import type` and capture default, named, namespace, and re-export value bindings in `crates/drift-engine/src/facts.rs:258`.
- Data-operation detection is heuristic: local names `db`, `prisma`, `database`, import paths containing DB/repository/data-access hints, and operation names like `findMany`, `create`, `update`, `delete` in `crates/drift-engine/src/facts.rs:422`.
- Role detection is path-based for API routes, service/data-access modules, CLI/core/query/factgraph/adapter/storage/engine-bridge/MCP modules, tests, and config files in `crates/drift-engine/src/facts.rs:531`.
- Graph construction creates file, file-version, module, role, import, export, route, callsite, and data-operation nodes/edges with evidence in `crates/drift-engine/src/main.rs:543`.

Verified by tests:

- `crates/drift-engine/tests/typescript_facts.rs` covers direct parser facts.
- `crates/drift-engine/tests/stream_graph.rs` covers stream batches, alias/workspace/index resolution, JS ESM specifiers to TS sources, endpoint shapes, service-boundary inference, ambiguous service diagnostics, extended tsconfig, jsconfig, package exports/imports, barrel re-exports, default exports, and namespace diagnostics.
- Targeted run: `cargo test -p drift-engine --test stream_graph -- --nocapture` passed 15 tests.

Hard limit: the parser is not a semantic TypeScript analyzer. It does not type-check, does not follow every dynamic import or computed route case, and data-access intent is mostly name/path/receiver-shape based.

## TypeScript Package Boundaries

Actual package surface:

- `@drift/core`: domain types, schemas, capabilities, contracts.
- `@drift/storage`: SQLite migrations and storage implementation.
- `@drift/factgraph`: graph schema, stable ids, graph artifacts.
- `@drift/engine-contract`: TS schema boundary for Rust engine I/O.
- `@drift/query`: repo map, topology, route flow, impact, symbol, finding, completeness read models.
- `@drift/cli`: CLI app, commands, engine bridge, checks, preflight, policy, proof command surfaces.
- `@drift/mcp`: read-only JSON-RPC/MCP server.
- `@drift/adapters`: manifest-style adapter registry.
- Platform engine packages package the Rust binary.

Boundary enforcement is code-backed:

- Package roots are enumerated in `packages/cli/scripts/check-boundaries.mjs:5`.
- CLI commands cannot import other command modules in `packages/cli/scripts/check-boundaries.mjs:67`.
- Non-storage packages cannot use raw SQLite in `packages/cli/scripts/check-boundaries.mjs:107`.
- Core, storage, engine-contract, adapters, and MCP import constraints are enforced in `packages/cli/scripts/check-boundaries.mjs:115`.
- MCP mutation-like tool names are forbidden in `packages/cli/scripts/check-boundaries.mjs:135`.
- Import cycles are detected in `packages/cli/scripts/check-boundaries.mjs:157`.

Verified result: `Architecture boundaries OK`.

## Storage

Implemented SQLite schema:

- `repos`, `scan_manifests`, `file_snapshots`, `findings`, `baseline_violations`, and `audit_events` begin in migration `001_initial_local_state` at `packages/storage/src/migrations.ts:6`.
- `facts` are persisted in migration `002_scan_facts` at `packages/storage/src/migrations.ts:112`.
- `convention_candidates`, `accepted_conventions`, and `repo_contracts` begin in migration `003_repo_contracts_and_conventions` at `packages/storage/src/migrations.ts:139`.
- Fact graph artifacts and graph node/edge tables begin in migration `006_fact_graph_artifacts` at `packages/storage/src/migrations.ts:244`.
- Graph evidence, diagnostics, completeness, symbol occurrences, resolver dependencies, and module dependents are added in migration `007_fact_graph_v2_projections` at `packages/storage/src/migrations.ts:292`.
- Scan file changes are added in migration `008_scan_file_changes` at `packages/storage/src/migrations.ts:409`.
- Check runs and finding context are added in migration `011_check_runs_and_finding_context` at `packages/storage/src/migrations.ts:444`.
- Repo identity metadata is added in migration `012_repo_identity` at `packages/storage/src/migrations.ts:478`.
- Required check executions are added in migration `013_required_check_executions` at `packages/storage/src/migrations.ts:488`.
- Fact quality fields, parser gaps, symbol identities, required-check state binding, and audit object hashes land in migrations `014` through `018` at `packages/storage/src/migrations.ts:523`.

Verified by `pnpm --filter @drift/storage test`: 21 tests passed.

## CLI and JSON Outputs

Implemented CLI routing is in `packages/cli/src/app/router.ts`. The help output lists `doctor`, `start`, `scan`, `scan status`, `ask`, `prepare`, `repo map`, `checks`, `policy`, `conventions`, `contract`, `findings`, `audit`, `backup`, `restore`, `check`, and `baseline`.

Important implemented builders:

- `runScanRepo` persists repo, scan, facts, graph, parser gaps, candidates, file changes, and audit events in `packages/cli/src/domain/scan-status.ts:40`.
- `collectScanData` prefers Rust, blocks silent fallback, and only enables the TypeScript fallback under `DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK=1` in `packages/cli/src/engine/collect-scan-data.ts:28`.
- `repoMapPayload` uses graph query/read-model data and policy metadata in `packages/cli/src/domain/repo-map.ts:65`.
- `prepareTask` returns scan status, graph context, parser gaps, context policy, relevant files, required checks, findings, and agent preflight packet in `packages/cli/src/commands/prepare.ts:26`.
- `runCheck` uses check-time scan data, blocks TypeScript fallback, runs engine-backed direct data-access checks, and persists check runs/findings in `packages/cli/src/check/run-check.ts:38`.

Live dogfood scan against Drift itself:

```bash
rm -rf /tmp/drift-v3-dogfood-audit
mkdir -p /tmp/drift-v3-dogfood-audit
node packages/cli/dist/main.js scan \
  --repo-root "/Users/geoffreyfernald/Downloads/driftv3/drift v3" \
  --state-root /tmp/drift-v3-dogfood-audit \
  --json
```

Result:

```json
{
  "repo_id": "repo_8e87fba3c58ea49b",
  "scan_id": "scan_92765c857e709530",
  "branch": "codex/agent-contract-intelligence-tdd",
  "commit": "b6044686c40ce12fe55665ed4e9d4e40ec8caa75",
  "dirty": false,
  "file_count": 163,
  "fact_count": 20440,
  "diagnostics_count": 46,
  "candidates_count": 0,
  "engine_source": "rust",
  "reuse_applied": false,
  "blocked_reasons": [
    "previous_scan_missing"
  ],
  "database_path": "/tmp/drift-v3-dogfood-audit/repo_8e87fba3c58ea49b/drift.sqlite"
}
```

Scan status:

```bash
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/repo_8e87fba3c58ea49b/drift.sqlite \
  scan status --repo repo_8e87fba3c58ea49b --json
```

Key result:

```json
{
  "indexed_file_count": 163,
  "source_change_count": 0,
  "stale": false,
  "parser_gaps": {
    "total_count": 45,
    "by_kind": {
      "unresolved_symbol": 33,
      "unsupported_framework_pattern": 12
    },
    "confidence_impact": {
      "lowers_flow": 33,
      "none": 12
    }
  },
  "summary": {
    "scan_count": 1,
    "indexed_file_count": 163,
    "audit_valid": true
  }
}
```

Repo map:

```bash
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/repo_8e87fba3c58ea49b/drift.sqlite \
  repo map --repo repo_8e87fba3c58ea49b --limit 5 --json
```

Key result:

```json
{
  "response_schema": "drift.repo.map.v1",
  "summary": {
    "indexed_file_count": 163,
    "filtered_file_count": 163,
    "listed_file_count": 5,
    "role_counts": {
      "adapter_module": 1,
      "test": 1
    },
    "import_count": 6,
    "export_count": 9,
    "call_count": 88
  },
  "topology_counts": {
    "areas": 19,
    "entrypoints": 5,
    "modules": 163,
    "tests": 18,
    "config": 0
  }
}
```

Prepare:

```bash
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/repo_8e87fba3c58ea49b/drift.sqlite \
  prepare "audit Drift parser and MCP parity" \
  --repo repo_8e87fba3c58ea49b \
  --path packages/cli/src/commands/prepare.ts \
  --json
```

Key result:

```json
{
  "response_schema": "drift.task.preflight.v1",
  "summary": {
    "convention_count": 0,
    "relevant_file_count": 25,
    "risky_area_count": 0,
    "finding_count": 0,
    "required_check_count": 0,
    "scan_stale": false,
    "contract_ready": false,
    "candidate_count": 0
  },
  "graph_context": {
    "available": true,
    "route_flows": 0,
    "reachable_data_access": 0,
    "affected_files": 10
  },
  "confidence": {
    "graph_confidence": 0.82,
    "reasons": [
      "parser_gaps_present"
    ]
  }
}
```

Audit verify:

```bash
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/repo_8e87fba3c58ea49b/drift.sqlite \
  audit verify --repo repo_8e87fba3c58ea49b --strict --json
```

Key result:

```json
{
  "valid": true,
  "event_count": 2,
  "verified_count": 2,
  "strict": true,
  "head_sequence": 2,
  "broken_at_event_id": null,
  "reason_count": 0
}
```

Findings list failed because the dogfood DB has no accepted repo contract:

```bash
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/repo_8e87fba3c58ea49b/drift.sqlite \
  findings list --repo repo_8e87fba3c58ea49b --json
```

Result:

```json
{
  "error": {
    "message": "No repo contract exists for repo_8e87fba3c58ea49b.",
    "type": "refusal",
    "code": "missing_contract"
  },
  "failure": {
    "code": "missing_contract",
    "surface": "cli",
    "severity": "error",
    "safe_to_retry": true,
    "user_action": "Accept or import a repo contract before running contract-backed enforcement."
  }
}
```

This failure is correct for no-contract dogfood state. It blocks contract-backed enforcement, not scan/status/repo-map/prepare/audit.

## MCP

Implemented MCP tools are read-only and declared in `packages/mcp/src/tools.ts:3`:

```text
get_runtime_info
get_capabilities
get_audit_status
get_scan_status
get_repo_contract
get_repo_map
get_task_preflight
get_conventions
get_findings
get_required_check_executions
get_allowed_context
```

The capabilities contract also declares these tools and no mutation tools in `packages/core/src/capabilities.ts:27` and `packages/core/src/capabilities.ts:95`.

MCP dogfood command:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_scan_status","arguments":{"repo_id":"repo_8e87fba3c58ea49b"}}}' \
| DRIFT_DB=/tmp/drift-v3-dogfood-audit/repo_8e87fba3c58ea49b/drift.sqlite \
  node packages/mcp/dist/bin.js
```

Key result:

```json
{
  "tools": [
    "get_runtime_info",
    "get_capabilities",
    "get_audit_status",
    "get_scan_status",
    "get_repo_contract",
    "get_repo_map",
    "get_task_preflight",
    "get_conventions",
    "get_findings",
    "get_required_check_executions",
    "get_allowed_context"
  ],
  "scan_status": {
    "response_schema": "drift.scan.status.v1",
    "indexed_file_count": 163,
    "parser_gaps": {
      "total_count": 45,
      "by_kind": {
        "unresolved_symbol": 33,
        "unsupported_framework_pattern": 12
      }
    }
  }
}
```

MCP `get_task_preflight` works in no-contract dogfood state and returned the same preflight summary shape as CLI. MCP `get_findings` failed with `No repo contract exists for repo_8e87fba3c58ea49b.`, matching the CLI refusal.

Beta proof verified full CLI/MCP parity on the fixture path, including `mcp_cli_parity_verified: true` and a schema-stable parity hash.

## Query and Read Models

Implemented:

- `GraphQueryService.repoMap` merges latest snapshots, graph nodes/edges/evidence, conventions, risky areas, findings, and parser gaps in `packages/query/src/index.ts:247`.
- `getRouteFlow` traces route/service/data-access flow and unresolved import diagnostics in `packages/query/src/index.ts:344`.
- `getReachableDataAccess`, `getAffectedFiles`, `getSymbolNeighborhood`, `getFindingEvidence`, and `getCompleteness` are implemented in `packages/query/src/index.ts:404`.
- Repo topology derives areas, layers, entrypoints, tests, config, risky files, external dependencies, and review targets in `packages/query/src/repo-topology.ts:17`.
- Change impact is heuristic and leaves `changed_symbols` empty in `packages/query/src/change-impact.ts:35`.

Verified by `pnpm --filter @drift/query test`: 20 tests passed.

## Fact Graph and Projections

Implemented:

- Graph node kinds, edge kinds, evidence, diagnostics, completeness, and artifact schema live in `packages/factgraph/src/index.ts`.
- Storage persists graph artifacts, graph nodes, graph edges, graph evidence, graph diagnostics, graph completeness, symbol occurrences, resolver dependencies, and module dependents in `packages/storage/src/migrations.ts:244` and `packages/storage/src/migrations.ts:292`.
- The CLI stores graph data during scan in `packages/cli/src/domain/scan-status.ts:118`.
- Query reads graph projections through the storage contract in `packages/query/src/index.ts:109`.

Verified by full gate, storage tests, query tests, CLI tests, MCP tests, e2e fixture matrix, and dogfood scan.

Fragile part: Drift-on-Drift preflight reported graph context available but completeness reasons included `resolver_dependencies_missing` in MCP output. Dogfood had 45 parser gaps. That should lower confidence for flow claims.

## Parser Capability Reality

Implemented and verified:

- TS/JS file discovery.
- Static value imports, default imports, named imports, namespace imports, re-exports.
- Exported function/class/default symbols.
- API route declarations for Next route files and `pages/api`.
- Callsite facts from identifier/member call expressions.
- Data-operation-shaped calls from DB-like receivers and paths.
- Path-based file roles.
- Import resolution for relative, alias, workspace, package imports/exports, index files, JS specifiers resolving to TS sources, and barrel re-exports.

Partial or heuristic:

- Service/data-access flow inference is graph/path/name based.
- Data operation classification is receiver/path/name based, not semantic.
- Route shape support covers common Next patterns, not arbitrary frameworks.
- Symbol identity exists as a persisted contract surface, but change impact still does not populate `changed_symbols`.
- Parser gaps are persisted and surfaced, but confidence handling is still coarse.

Missing for production-grade TS intelligence:

- Full TypeScript type graph.
- Dynamic import/require coverage.
- Decorator/framework-specific route systems outside the current wedge.
- Precise alias/member/namespace call resolution in every case.
- Monorepo package role ontology beyond path heuristics.
- Semantic data-flow and side-effect analysis.

Dogfood evidence: Drift itself scanned 163 files and 20,440 facts but had 45 parser gaps. That is useful beta evidence, not production-complete TypeScript understanding.

## Dogfood and Beta Proof

Existing dogfood doc `docs/dogfood/drift-on-drift.md` is stale relative to this run: it records commit `af3acb65e061366463d25f7c13974b58b3d522fa`, branch `codex/drift-sprints-15-25`, 144 indexed files, 15,945 facts, and 672 diagnostics in `docs/dogfood/drift-on-drift.md:3`. The live run on 2026-05-24 found commit `b6044686c40ce12fe55665ed4e9d4e40ec8caa75`, branch `codex/agent-contract-intelligence-tdd`, 163 indexed files, 20,440 facts, and 46 diagnostics.

Beta proof is implemented in `scripts/run-beta-proof.mjs`. It builds a fixture, runs scan, required checks, good/bad route checks, MCP/CLI parity, and audit verification. `pnpm verify:ci` includes `pnpm beta:proof` in `package.json:24`.

Live beta proof result inside `pnpm verify:ci`:

```json
{
  "schema_version": "drift.beta.proof.v1",
  "fallback_used": false,
  "fresh_scan_verified": true,
  "good_route_passed": true,
  "bad_route_blocked": true,
  "finding_evidence_complete": true,
  "required_check_execution_proof_verified": true,
  "contract_parity_verified": true,
  "mcp_cli_parity_verified": true,
  "audit_verified": true
}
```

What this proves: the narrow fixture route-layering product loop works.

What it does not prove: production-grade understanding of arbitrary TS repos, all frameworks, all repo architectures, or Drift's own repo as a contract-backed enforcement target.

## Verified vs Inferred

Verified:

- Clean branch relative to upstream, open PR #76, unstable merge state.
- `pnpm verify:ci` passes.
- Rust engine tests, package tests, e2e tests, clippy, formatting, boundary checks, release-matrix validation, product-claim validation, and beta proof pass.
- Dogfood scan against Drift itself works and persists graph/parser-gap metadata.
- CLI scan status, repo map, prepare, and audit verify work on the dogfood DB.
- CLI/MCP expose matching scan status and MCP tool list is read-only.
- No-contract findings/check surfaces refuse with stable `missing_contract` failure.

Inferred from code plus tests:

- Parser coverage is strongest for TS/JS static imports/exports/calls/routes and current Next-style route patterns.
- The read-model layer is useful but still heuristic in impact/test relevance.
- CLI/MCP parity is good for beta proof surfaces but still exposed to drift where logic is duplicated outside `@drift/query`.

Not verified in this audit:

- Release workflow artifact completeness in GitHub Actions after npm tarballs and engine checksums.
- Production behavior on large external monorepos.
- Windows/Linux packaged engine execution on native machines.
- Long-running multi-scan performance claims beyond unchanged-file fact reuse.

## Implemented vs Documented-Only

Implemented:

- Rust scanning and graph stream.
- SQLite persistence and migrations through schema version 18.
- Local CLI and read-only MCP.
- Human-confirmed convention/contract governance.
- Deterministic direct data-access route check for accepted contracts.
- Required check execution proof.
- Audit hash verification.
- Beta proof fixture loop.
- Product claims gating for the narrow wedge.

Documented-only or not production-grade:

- Broad "codebase intelligence" outside TS/JS route-layering.
- Incremental reuse.
- Desktop UI.
- Cloud sync.
- Python adapter.
- Mutation-capable MCP.
- General AI code review.
- Broad duplicate-helper detection.
- Full semantic TS symbol/change impact.

## Beta Grade vs Experimental

Beta-grade:

- Local-first CLI scan/status/repo-map/prepare/audit for TS/JS repos.
- Rust engine as primary scanner with fallback blocked for enforcement.
- Read-only MCP tool surface.
- SQLite-backed facts/graph/contracts/findings/audit.
- Direct data-access route contract loop when human-accepted.
- Beta fixture proof with good-pass/bad-block and CLI/MCP parity.

Experimental or limited:

- Drift-on-Drift no-contract dogfood as product proof.
- Parser confidence and parser gap handling.
- Change impact and test relevance.
- Symbol identity as a user-facing intelligence layer.
- Package/CLI-specific role ontology beyond path heuristics.
- No-contract findings/check behavior beyond refusal.

## Universal vs Drift-Specific

Generic/universal enough:

- TS/JS file scan and static fact extraction.
- SQLite local state.
- Graph artifact/projection model.
- CLI/MCP read-only governance.
- Contract/finding/baseline/waiver/audit shapes.
- Next API route direct data-access convention in repos that match the wedge.

Drift-repo-specific or strongly path-biased:

- Role detection for `packages/cli`, `packages/core`, `packages/query`, `packages/factgraph`, `packages/storage`, and `packages/mcp` is encoded as path heuristics in `crates/drift-engine/src/facts.rs:612`.
- Dogfood preflight is useful but mostly package/command topology, not a general architecture contract.
- Boundary checker enforces current package architecture through local regex/path rules in `packages/cli/scripts/check-boundaries.mjs`.

## Overbuilt, Underbuilt, Fragile, Missing

Overbuilt relative to current product proof:

- Many contract names are marked complete in the runtime contract parity ledger, but the strongest product proof is still a narrow route-layering fixture.
- Storage has rich graph/proof/audit tables before broad external-repo evidence exists.

Underbuilt:

- TypeScript semantic understanding.
- Framework adapters beyond current Next-style route patterns.
- Change impact symbol precision.
- Test relevance beyond path/slug heuristics.
- Dogfood proof with accepted contract enforcement against Drift itself.

Fragile:

- Parser confidence can fall quickly on unresolved symbols. Live dogfood had 33 `unresolved_symbol` gaps.
- CLI/MCP parity depends on tests and proof; some read-model assembly still exists in transport code.
- Role ontology is path-heavy and can misclassify non-standard repos.
- No-contract state is intentionally limited; enforcement surfaces refuse.

Missing:

- Incremental scan reuse.
- Broad language support.
- Cloud/desktop product surfaces.
- Production-scale external repo matrix.
- Native release proof in this local audit.

## Biggest Risks

1. Product overclaim risk: contract parity says many surfaces are complete, but the defensible market claim is still narrow.
2. Parser confidence risk: the engine is useful, but not semantic TypeScript. Dogfood parser gaps prove this is not production-complete.
3. PR readiness risk: PR #76 is open but `UNSTABLE`, and the branch is 2 commits behind `origin/main`.
4. Generalization risk: role detection and data-access inference are path/name heuristic heavy.
5. CLI/MCP drift risk: beta proof covers important surfaces, but duplicated transport logic can drift unless moved behind shared read-model builders.
6. Dogfood proof gap: Drift can scan itself, but it has no accepted contract in the dogfood DB, so findings/check enforcement is not proven on Drift itself.
