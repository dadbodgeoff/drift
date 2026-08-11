# Dogfood Transcript: Drift On Drift

Date: 2026-05-25
Verified on: 2026-05-25
Source checkout: `/Users/geoffreyfernald/Downloads/driftv3/drift v3`
Proof checkout: `/tmp/drift-dogfood-clean/drift v3`
Commit: `bffbbd330516ee8ffedcfbbdc68a4d780a3bd8c1`
Source branch: `codex/agent-contract-intelligence-tdd`
Proof branch: detached HEAD, clean worktree
Drift version: `0.1.0`
State root: `/tmp/drift-v3-dogfood-clean-audit`
Database: `/tmp/drift-v3-dogfood-clean-audit/repo_a33af4e183033a7c/drift.sqlite`

## Purpose

This run checks Drift against its own repo using the graph-backed Rust engine and read-only CLI agent surfaces. The Drift repo still has no accepted Drift contract, so this proof is intentionally split:

- Metadata/preflight proof: scan, status, repo map, prepare, and audit verification work without inventing a contract.
- Enforcement proof: contract-backed commands refuse with `missing_contract` until a human accepts or imports a repo contract.

This clean-repo dogfood run does not claim accepted-contract enforcement against the full Drift repo. A separate deterministic Drift-shaped fixture now proves contract-backed enforcement for one real Drift package boundary: MCP modules must not import CLI.

## Commands Run

The proof used a detached clean worktree at the same commit because the source checkout had untracked audit docs.

```bash
rm -rf /tmp/drift-dogfood-clean /tmp/drift-v3-dogfood-clean-audit
git worktree add --detach /tmp/drift-dogfood-clean HEAD

DRIFT_ENGINE_BIN=/Users/geoffreyfernald/Downloads/driftv3/drift\ v3/target/debug/drift-engine \
  node /Users/geoffreyfernald/Downloads/driftv3/drift\ v3/packages/cli/dist/main.js \
  scan --repo-root /tmp/drift-dogfood-clean/drift\ v3 \
  --state-root /tmp/drift-v3-dogfood-clean-audit --json

node /Users/geoffreyfernald/Downloads/driftv3/drift\ v3/packages/cli/dist/main.js \
  --db /tmp/drift-v3-dogfood-clean-audit/repo_a33af4e183033a7c/drift.sqlite \
  scan status --repo repo_a33af4e183033a7c --json

node /Users/geoffreyfernald/Downloads/driftv3/drift\ v3/packages/cli/dist/main.js \
  --db /tmp/drift-v3-dogfood-clean-audit/repo_a33af4e183033a7c/drift.sqlite \
  repo map --repo repo_a33af4e183033a7c --limit 10 --json

node /Users/geoffreyfernald/Downloads/driftv3/drift\ v3/packages/cli/dist/main.js \
  --db /tmp/drift-v3-dogfood-clean-audit/repo_a33af4e183033a7c/drift.sqlite \
  prepare "dogfood current branch" --repo repo_a33af4e183033a7c --json

node /Users/geoffreyfernald/Downloads/driftv3/drift\ v3/packages/cli/dist/main.js \
  --db /tmp/drift-v3-dogfood-clean-audit/repo_a33af4e183033a7c/drift.sqlite \
  audit verify --repo repo_a33af4e183033a7c --strict --json

node /Users/geoffreyfernald/Downloads/driftv3/drift\ v3/packages/cli/dist/main.js \
  --db /tmp/drift-v3-dogfood-clean-audit/repo_a33af4e183033a7c/drift.sqlite \
  check --repo repo_a33af4e183033a7c --scope full --json
```

## Scan

```json
{
  "repo_id": "repo_a33af4e183033a7c",
  "scan_id": "scan_32f20b9f0faf371e",
  "commit": "bffbbd330516ee8ffedcfbbdc68a4d780a3bd8c1",
  "dirty": false,
  "files_indexed": 163,
  "facts_count": 20449,
  "diagnostics_count": 46,
  "candidates_count": 0,
  "engine_source": "rust",
  "reuse_applied": false,
  "blocked_reasons": [
    "previous_scan_missing"
  ]
}
```

Correct behavior: Drift did not infer a repo contract from its own packages and fixtures. This first scan has no previous scan to reuse; repeated scans may reuse unchanged file facts when resolver inputs match.

## Scan Status

```json
{
  "latest_scan_id": "scan_32f20b9f0faf371e",
  "scan_count": 1,
  "indexed_file_count": 163,
  "source_change_count": 0,
  "stale": false,
  "invalidation_count": 0,
  "audit_valid": true,
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
  }
}
```

## Repo Map

Repo map worked without an accepted contract through the default local-only policy.

```json
{
  "indexed_file_count": 163,
  "filtered_file_count": 163,
  "listed_file_count": 10,
  "role_counts": {
    "adapter_module": 1,
    "test": 1
  },
  "import_count": 45,
  "export_count": 50,
  "call_count": 196
}
```

Agent envelope result:

```json
{
  "action": "safe_to_edit",
  "read_only": true,
  "snippets_included": false,
  "source_content_included": false,
  "graph_context_included": true,
  "context_truncated": false
}
```

## Prepare

Prepare returned a no-contract local packet instead of inventing conventions.

```json
{
  "convention_count": 0,
  "relevant_file_count": 0,
  "finding_count": 0,
  "contract_ready": false,
  "candidate_count": 0,
  "graph_context": {
    "available": true,
    "complete": false,
    "reasons": [
      "resolver_dependencies_missing"
    ]
  },
  "confidence": {
    "graph_confidence": 0.82,
    "reasons": [
      "parser_gaps_present"
    ]
  }
}
```

## Audit

```json
{
  "valid": true,
  "strict": true,
  "event_count": 2,
  "verified_count": 2,
  "head_sequence": 2,
  "broken_at_event_id": null,
  "reason_count": 0
}
```

## Enforcement Refusal

`findings list`, `contract show`, and `check --scope full` all refused because no accepted repo contract exists.

```json
{
  "code": "missing_contract",
  "surface": "cli",
  "severity": "error",
  "safe_to_retry": true,
  "user_action": "Accept or import a repo contract before running contract-backed enforcement.",
  "agent_envelope": {
    "action": "blocked_by_policy",
    "read_only": true
  }
}
```

This is the expected boundary for the full Drift repo: dogfood proves local metadata, parser-gap visibility, preflight usefulness, audit integrity, and honest refusal when no accepted contract exists.

## Drift-Shaped Enforcement Proof

Accepted-contract enforcement is covered by `test/e2e/dogfood-enforcement-proof.test.ts` against `test/fixtures/drift-package-boundary`.

The fixture models one narrow Drift package rule:

```json
{
  "contract_id": "contract_drift_package_boundary",
  "agent_contract_id": "agent_contract_mcp_no_cli_imports",
  "kind": "import_boundary",
  "source_roles": ["mcp_module"],
  "forbidden_imports": ["@drift/cli"],
  "enforcement": "blocking"
}
```

Proof behavior:

- A good MCP change that imports from `@drift/query` passes.
- A bad MCP change that imports from `@drift/cli` fails.
- The blocking finding includes repo contract id, agent contract id, check id, evidence refs, file hash, graph path, and suggested fix.
- MCP read-only `get_repo_contract` and `get_findings` agree with the CLI check output.

## Product Notes

What this proves:

- Drift can scan its own repo with the Rust engine from a clean worktree.
- Drift persisted 163 files and 20,449 facts.
- Drift surfaces parser gaps honestly: 45 parser gaps, 33 of them lowering flow confidence.
- Drift builds repo map/topology and preflight context without source snippets.
- Drift verifies the local audit chain in strict mode.
- CLI contract-backed enforcement refuses without an accepted contract.
- Drift-shaped accepted-contract enforcement blocks a deterministic MCP-to-CLI package-boundary violation in the fixture proof.

What this does not prove:

- Accepted-contract enforcement against the full Drift repo.
- Broad parser completeness.
- Production-scale performance.
- Incremental reuse.
- Release artifact completeness.

The public claim should stay narrow: local TS/JS route-layering evidence, read-only agent context, honest no-contract refusal, and contract-backed enforcement only after human-confirmed or imported contracts.
