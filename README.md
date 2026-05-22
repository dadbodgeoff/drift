# Drift

Drift is a local-first repo intelligence guardrail for AI-assisted code changes.

V1 focuses on one deterministic wedge: TypeScript/JavaScript API route layering. Drift scans a repo, stores facts in SQLite, lets a human approve inferred conventions, baselines legacy violations, and gives agents a compact preflight packet before they write code.

## First Five Minutes

From the repo you want Drift to inspect:

```bash
drift doctor --repo-root .
drift start --repo-root . --accept-defaults
drift doctor --repo-root .
```

The first `doctor` run is a zero-write readiness check. After `start`, run it again as the ongoing local health gate: it validates SQLite migration compatibility, repo registration, contract compatibility, scan freshness, audit-chain integrity, and tracked backup artifacts, then prints the next upkeep commands.

`start --accept-defaults` is explicit onboarding confirmation. It accepts the deterministic default convention, materializes the repo contract, and baselines existing findings so legacy drift does not block the first check. Omit `--accept-defaults` when you want to review every candidate manually first.

`drift start` prints the local SQLite path:

```bash
export DRIFT_DB=/path/to/drift.sqlite
```

Then use the printed repo id with the review loop:

```bash
drift baseline status --repo <repo_id>
drift version --json
drift capabilities --json
drift conventions list --repo <repo_id> --status candidate --kind api_route_no_direct_data_access --capability deterministic_check --limit 20 --offset 0 --json
drift conventions show <candidate_id> --repo <repo_id> --json
drift ask "what should I know before changing this route?" --repo <repo_id> --path apps/web/app/api/users/route.ts --json
drift prepare "add user search endpoint" --repo <repo_id> --path apps/web/app/api/users/route.ts --json
drift repo map --repo <repo_id> --role api_route --json
drift repo map --repo <repo_id> --limit 50 --offset 0 --json
drift prepare "add user search endpoint" --repo <repo_id> --require-fresh --json
drift checks list --repo <repo_id> --limit 20 --offset 0 --json
drift policy check-context --repo <repo_id> --path apps/web/app/api/users/route.ts --surface cli-preflight --require-fresh --json
drift check --diff main...HEAD --repo <repo_id> --scope changed-hunks
drift findings list --repo <repo_id>
drift findings list --repo <repo_id> --convention <convention_id> --json
drift findings list --repo <repo_id> --path apps/web/app/api/users/route.ts --require-fresh --json
drift findings list --repo <repo_id> --limit 25 --offset 0 --json
drift findings show <finding_id> --repo <repo_id> --require-fresh --json
drift backup create --repo <repo_id> --confirm
drift backup list --repo <repo_id> --json
drift backup list --repo <repo_id> --limit 20 --offset 0 --json
drift backup list --repo <repo_id> --artifact-status missing --json
drift audit list --repo <repo_id>
drift audit verify --repo <repo_id> --json
drift audit list --repo <repo_id> --target-id <repo_id> --limit 20 --offset 0 --json
drift audit list --repo <repo_id> --since 2026-05-10T00:00:00.000Z --until 2026-05-11T00:00:00.000Z
```

Backup output prints the verify and restore dry-run commands. Backup list, verify, and restore JSON also include compact summaries so setup scripts can see artifact health, checksum status, restore intent, and rescan requirements without parsing prose:

```bash
drift backup verify <backup.sqlite> --repo <repo_id> --checksum <sha256>
drift backup verify <backup.sqlite> --repo <repo_id> --checksum <sha256> --require-checksum
drift --db <target.sqlite> restore <backup.sqlite> --repo <repo_id> --checksum <sha256> --dry-run
drift --db <target.sqlite> restore <backup.sqlite> --repo <repo_id> --checksum <sha256> --require-checksum --dry-run
```

For stricter restore identity checks, pass the expected repo fingerprint:

```bash
drift backup verify <backup.sqlite> --repo <repo_id> --expect-repo-fingerprint <fingerprint>
drift --db <target.sqlite> restore <backup.sqlite> --repo <repo_id> --expect-repo-fingerprint <fingerprint> --dry-run
```

Contract exports can stay on stdout or be written to one approved artifact:

```bash
drift contract export --repo <repo_id> --format json --output ./repo-contract.json --confirm
drift contract import ./repo-contract.json --dry-run
drift contract import ./repo-contract.json --checksum <sha256> --dry-run
drift contract import ./repo-contract.json --checksum <sha256> --require-checksum --dry-run
```

`contract show`, `contract validate`, `contract export`, `contract import --dry-run`, and MCP `get_repo_contract` expose a stable `contract_fingerprint` for compatibility checks. The fingerprint is computed from canonical contract content, so unordered governance lists do not create false drift.

`scan status`, `prepare`, MCP `get_scan_status`, and MCP `get_task_preflight` expose a stable `scan_fingerprint` for the indexed graph plus no-approval governance metadata, summary counts, `indexed_file_count`, `source_change_count`, audit integrity, and next commands. Agents can compare the fingerprint before acting and after rescans without reading source code.

`ask`, `prepare`, and MCP `get_task_preflight` can target a specific repo-relative `--path`, which pins that file into the preflight packet with a `requested path` reason. Agent-facing context commands also support `--require-fresh` / `require_fresh`; when set, Drift refuses stale scan context and tells the agent which `drift scan` command to run. `repo map` and MCP `get_repo_map` include per-file impact annotations for matching conventions, risky areas, and open findings, plus an `impact_summary`.

`policy check-context` and MCP `get_allowed_context` are the path-level gate for agent context access. They return the policy decision, no-approval governance metadata, summary counts, next commands, freshness requirement, scan status, redaction caps, and indexed file impact metadata without reading or emitting source snippets.

`findings list --path`, `findings list --convention`, `findings list --limit --offset`, `findings show`, and MCP `get_findings({ path, convention_id, limit, offset })` give agents and humans bounded review queues plus a drill-down view for one finding. Add `--require-fresh` / `require_fresh` when stale findings should be refused before an agent acts.

`conventions list --kind --capability --limit --offset` keeps the human approval queue bounded and machine-checkable. Use it to separate deterministic blocking candidates from heuristic briefing candidates before accepting anything into the repo contract.

`ask`, `repo map`, and MCP `get_repo_map` are deterministic local context surfaces. They answer from approved contracts, findings, file roles, imports, exports, calls, scan metadata, and policy state; they do not call an LLM, do not mutate Drift state, and do not include source snippets. `repo map` and MCP `get_repo_map` support limit/offset pagination so large repo maps stay scriptable.

`audit verify --json` and MCP `get_audit_status` check the local audit hash chain and report summary counts, next commands, and the current head hash. Backup verification and restore dry-runs also validate the audit chain and expose summary fields for schema support, checksum checks, artifact size, write intent, and stale-graph rescan guidance.

`audit list --target-id --limit --offset` keeps governance timelines scriptable as local state grows. Audit events are returned in deterministic created-time order, with total, filtered, returned, and next-offset metadata.

`doctor --json` includes the same production-state signals in one automation-friendly payload: applied migrations, unsupported/missing migrations, contract schema/fingerprint, scan staleness, audit integrity, backup count, backup artifact problems, and `next_commands` for initialized repos.

## State Model

Drift stores product state in SQLite, not a folder full of JSON files.

The database owns:

- repo identity
- scan manifests
- file snapshots and hashes
- extracted facts
- convention candidates and accepted conventions
- repo contracts
- findings
- baselines
- policies
- audit events
- backup manifests

JSON is only an interface format for CLI automation, MCP responses, contract import/export, and tests.

## What Requires Approval

Commands that do not require governance approval:

```bash
drift doctor
drift scan
drift scan status
drift prepare
drift check
drift findings list
drift audit list
```

Some of these commands write local Drift state, such as `scan`, `start`, and `check`. The important boundary is that they do not mutate source code or approve governance decisions.

Governance changes require explicit human intent:

```bash
drift conventions accept <candidate_id> --confirm
drift conventions reject <candidate_id> --reason "..." --confirm
drift conventions edit <candidate_id> --statement "..." --confirm
drift conventions exception add <convention_id> --path <glob> --reason "..." --confirm
drift findings mark-fixed <finding_id> --evidence <file:line> --confirm
drift findings mark-needs-review <finding_id> --reason "..." --confirm
drift findings suppress <finding_id> --reason "..." --confirm
drift findings accept-drift <finding_id> --reason "..." --confirm
drift findings mark-false-positive <finding_id> --reason "..." --confirm
drift baseline create --from main --confirm
drift baseline clear --convention <convention_id> --confirm
drift policy set-egress ... --confirm
drift policy agent grant ... --confirm
drift policy agent revoke ... --confirm
drift contract export ... --confirm
drift contract import <path> --confirm
drift contract waiver add ... --confirm
drift contract waiver remove ... --confirm
drift backup create --confirm
drift restore <backup.sqlite> --confirm
```

## Architecture

Rust owns the bounded-memory scanning and rule-critical engine pieces.

TypeScript owns the CLI, MCP server, SQLite storage boundary, policy enforcement, onboarding, and packaging.

The product boundary is intentionally CLI-first. The desktop UI comes after the CLI review loop is stable.

## V1 Support Matrix

| Surface | V1 status |
| --- | --- |
| TypeScript/JavaScript API route layering | Supported |
| Local SQLite state | Supported |
| CLI review loop | Supported |
| Read-only MCP context | Supported |
| Backup/restore of Drift state | Supported |
| Python adapter | Deferred |
| Desktop UI | Deferred |
| Cloud sync | Deferred |
| Duplicate helper detection | Deferred |

Drift V1 does not mutate source code. It stores repo intelligence locally, guides humans and agents with evidence, and requires explicit human confirmation for governance changes.

Use `drift capabilities --json` or MCP `get_capabilities` to discover the supported V1 command surface, no-approval agent tools, human-confirmed governance mutations, and deferred surfaces.

## Package Smoke

The e2e suite packs and installs the workspace packages into a clean consumer project, then runs:

- installed `drift doctor`
- installed `drift scan`
- installed `drift conventions list --kind --capability --limit --offset`
- installed `drift start --accept-defaults`
- installed `drift scan status`
- installed `drift ask`
- installed `drift prepare`
- installed `drift repo map`
- installed `drift repo map --limit --offset`
- installed `drift checks list --limit --offset`
- installed `drift baseline status`
- installed `drift contract show`
- installed `drift check`
- installed `drift findings list`
- installed `drift findings list --convention`
- installed `drift findings list --limit --offset`
- installed `drift findings list --path --require-fresh`
- installed `drift findings show`
- installed `drift findings mark-needs-review --confirm`
- installed `drift findings mark-fixed --confirm`
- installed `drift audit list`
- installed `drift audit list --target-id --limit --offset`
- installed `drift audit verify`
- installed `drift backup create --confirm`
- installed `drift backup list`
- installed `drift backup list --artifact-status --limit --offset`
- installed `drift backup verify`
- installed `drift restore --dry-run`
- installed `drift restore --confirm`
- installed `drift version --json`
- installed `drift capabilities --json`
- installed MCP `get_runtime_info`
- installed MCP `get_capabilities`
- installed MCP `get_audit_status`
- installed MCP `get_scan_status`
- installed MCP `get_repo_contract`
- installed MCP `get_repo_map`
- installed MCP `get_task_preflight`
- installed MCP `get_conventions`
- installed MCP `get_findings`
- installed MCP `get_allowed_context`
- installed `drift-mcp`

Run the full gate:

```bash
pnpm verify:ci
```
