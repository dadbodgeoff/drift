# Drift V1 Product + Technical Spec

## Summary

Drift V1 is a local-first convention intelligence layer for AI-assisted TypeScript repositories. It turns a repo's unwritten engineering conventions into a durable `RepoContract`, briefs agents before they write code, and checks diffs after they write code.

The V1 wedge is **Drift Guard for AI-generated TypeScript API/server-side diffs**.

V1 uses a split runtime:

- Rust owns the bounded-memory engine: repo walking, ignore rules, hashing, TypeScript/JavaScript parsing, fact extraction, baseline matching, and deterministic checks. V1 uses tree-sitter TypeScript/TSX parsing in `crates/drift-engine`.
- TypeScript owns product surfaces: contract schemas, CLI wrappers, MCP, local UI later, onboarding, and agent-facing JSON.

V1 must prove one loop:

1. Deterministically scan a TypeScript/JavaScript repo through the Rust engine.
2. Infer machine-checkable convention candidates for API/server-side layering.
3. Let a human approve, reject, edit, or add exceptions through scriptable CLI commands.
4. Materialize approved state into a `RepoContract`.
5. Create a baseline so legacy violations do not create noisy failures.
6. Brief an agent with `drift prepare "<task>" --json`.
7. Check a diff with `drift check --diff main...HEAD --scope changed-hunks --json`.
8. Expose the same read-only context through MCP.

V1 does not mutate user source code. It scans, stores evidence, produces contracts, governs context egress, and reports findings. Full desktop UI, cloud sync, Python, graph explorer, duplicate-helper detection, and broad convention categories are deferred.

## Positioning

Drift turns your repo's unwritten engineering conventions into an enforceable, local-first contract that AI coding agents use before they act and that PRs are checked against after they change code.

Drift is not generic code review, repo chat, a static analyzer, or a graph explorer. V1 is an agent guardrail for one painful, provable problem: AI-generated TypeScript server/API code bypassing the repo's established service/data-access boundaries.

## V1 Enforceable Convention Family

V1 implements one deterministic convention family first:

```ts
type ConventionKind =
  | "api_route_no_direct_data_access"
  | "api_route_requires_service_delegation"
  | "api_route_requires_auth_helper"
  | "test_expected_for_changed_module"
  | "custom_briefing";
```

Only these are in V1 enforcement scope:

- `api_route_no_direct_data_access`
- `api_route_requires_service_delegation` only when reliably inferable for the target repo

Everything else is briefing-only or deferred.

## Core Records

### RepoContract

`RepoContract` is user-approved source-of-truth state, not raw scan output. Scans produce facts and candidates; accepted candidates, policy, waivers, baseline references, required checks, and safe commands materialize into the contract.

Required fields:

```ts
type RepoContract = {
  id: string;
  repo_id: string;
  contract_schema_version: number;
  repo_fingerprint: string;
  created_at: string;
  updated_at: string;
  conventions: AcceptedConvention[];
  rejected_inferences: RejectedInference[];
  waivers: ConventionException[];
  risky_areas: RiskArea[];
  safe_commands: SafeCommand[];
  required_checks: RequiredCheck[];
  context_egress: ContextEgressPolicy;
  agent_permissions: AgentPermission[];
};
```

### ConventionCandidate

Candidates must be machine-checkable, not prose-only.

```ts
type ConventionCandidate = {
  id: string;
  repo_id: string;
  scan_id: string;
  kind: ConventionKind;
  statement: string;
  rationale?: string;
  scope: ConventionScope;
  matcher: ConventionMatcher;
  suggested_severity: "info" | "warning" | "error";
  suggested_enforcement_mode: "off" | "brief" | "warn" | "block";
  enforcement_capability: EnforcementCapability;
  confidence_label: "low" | "medium" | "high";
  scoring: ConventionScore;
  evidence_refs: EvidenceRef[];
  counterexample_refs: EvidenceRef[];
  status: "candidate" | "accepted" | "rejected" | "archived" | "expired";
  created_at: string;
};
```

### AcceptedConvention

```ts
type AcceptedConvention = {
  id: string;
  contract_id: string;
  kind: ConventionKind;
  statement: string;
  rationale?: string;
  scope: ConventionScope;
  matcher: ConventionMatcher;
  severity: "info" | "warning" | "error";
  enforcement_mode: "off" | "brief" | "warn" | "block";
  enforcement_capability: EnforcementCapability;
  exceptions: ConventionException[];
  evidence_refs: EvidenceRef[];
  counterexample_refs: EvidenceRef[];
  accepted_by: string;
  accepted_at: string;
  updated_at: string;
  expires_at?: string;
};
```

Only `enforcement_capability: "deterministic_check"` can block by default.

### ConventionScope

```ts
type ConventionScope = {
  path_globs: string[];
  package_names?: string[];
  file_roles?: Array<
    | "api_route"
    | "server_module"
    | "service_module"
    | "data_access_module"
    | "component"
    | "test"
    | "config"
  >;
  include_symbols?: string[];
  exclude_path_globs?: string[];
};
```

### ConventionMatcher

```ts
type ConventionMatcher = {
  kind: ConventionKind;
  forbidden_imports?: string[];
  required_calls?: string[];
  allowed_delegate_imports?: string[];
  applies_to_file_roles?: string[];
};
```

Example:

```json
{
  "kind": "api_route_no_direct_data_access",
  "forbidden_imports": ["@/db", "@/prisma", "prisma", "@repo/db"],
  "applies_to_file_roles": ["api_route"]
}
```

### EnforcementCapability

```ts
type EnforcementCapability =
  | "briefing_only"
  | "heuristic_check"
  | "deterministic_check";
```

### ConventionScore

Do not expose fake precision like `0.89` without explanation.

```ts
type ConventionScore = {
  supporting_examples_count: number;
  counterexamples_count: number;
  scope_files_count: number;
  coverage_ratio: number;
  heuristic_id: string;
};
```

### ConventionException

Exceptions are first-class. They are not false positives.

```ts
type ConventionException = {
  id: string;
  reason: string;
  path_globs?: string[];
  symbols?: string[];
  imports?: string[];
  expires_at?: string;
  created_by: string;
  created_at: string;
};
```

### EvidenceRef

```ts
type EvidenceRef = {
  id: string;
  kind: "supporting" | "counterexample" | "violation" | "baseline";
  file_path: string;
  start_line?: number;
  end_line?: number;
  symbol?: string;
  import_source?: string;
  fact_ids: string[];
  scan_id: string;
  file_hash: string;
  artifact_hash?: string;
  redaction_state: "none" | "redacted" | "snippet_limited";
};
```

### BaselineViolation

Existing repos already violate their own conventions. Baselines prevent noisy failures.

```ts
type BaselineViolation = {
  id: string;
  repo_id: string;
  convention_id: string;
  finding_fingerprint: string;
  file_path: string;
  first_seen_scan_id: string;
  first_seen_commit: string;
  status: "active" | "resolved";
  created_at: string;
};
```

Default CI behavior only fails newly introduced deterministic violations.

### Finding

```ts
type Finding = {
  id: string;
  repo_id: string;
  convention_id: string;
  fingerprint: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  enforcement_result: "none" | "warn" | "block";
  status:
    | "new"
    | "pre_existing"
    | "needs_review"
    | "fixed"
    | "false_positive"
    | "accepted_drift"
    | "suppressed";
  diff_status: "new_in_diff" | "touched_existing" | "outside_diff";
  evidence_refs: EvidenceRef[];
  created_at: string;
};
```

`false_positive` means Drift was wrong. `accepted_drift` means Drift was right but the team allows that exception.

### RiskArea

```ts
type RiskArea = {
  id: string;
  path_globs: string[];
  risk_kind:
    | "auth"
    | "billing"
    | "data_access"
    | "migration"
    | "secrets"
    | "external_api"
    | "generated_code";
  reason: string;
};
```

### Contract Support Types

```ts
type RejectedInference = {
  candidate_id: string;
  reason: string;
  rejected_by: string;
  rejected_at: string;
};

type SafeCommand = {
  command: string;
  reason: string;
  requires_explicit_run: true;
};

type RequiredCheck = {
  command: string;
  applies_to: ConventionScope;
  reason: string;
};

type ContextEgressPolicy = {
  default_mode: "local_only" | "redacted" | "approval_required";
  denied_globs: string[];
  max_snippet_chars: number;
  allow_full_file_content: boolean;
};

type AgentPermission = {
  agent: string;
  permissions: Array<"read_context" | "request_preflight" | "propose_resolution">;
};

type PolicyDecision = {
  allowed: boolean;
  surface: "cli-preflight" | "cli-check" | "mcp" | "contract-export" | "artifact" | "log" | "ui";
  mode: "local_only" | "redacted" | "approval_required" | "denied";
  reason: string;
  max_snippet_chars: number;
};
```

## CLI Surface

### Init And Scan

```bash
drift init
drift scan
drift scan status --json
```

### Convention Review

```bash
drift conventions list --status candidate --json
drift conventions show <id> --json
drift conventions accept <id> --severity warning --mode warn
drift conventions reject <id> --reason "not a real convention"
drift conventions edit <id> --statement "..." --scope-file scope.json
drift conventions exception add <id> --path "apps/web/app/api/health/**" --reason "health endpoint exception"
```

### Baseline

```bash
drift baseline create --from main --json
drift baseline status --json
drift baseline clear --convention <id>
```

### Preflight

```bash
drift prepare "add workspace invite API route" --json
```

Preflight returns applicable conventions, enforcement capability, risky areas, recommended checks, files to inspect, and policy metadata. It recommends commands but does not run them.

### Postflight

```bash
drift check --diff main...HEAD --scope changed-hunks --json
drift check --diff main...HEAD --scope changed-files --json
drift check --diff main...HEAD --scope full --json
```

Default scope is `changed-hunks`. The checker reports whether each finding is `new_in_diff`, `touched_existing`, or `outside_diff`.

### Contract And Policy

```bash
drift contract show --json
drift contract validate
drift contract export --format json
drift contract import <path> --dry-run
drift policy show --json
drift policy check-context --path <file> --surface cli-preflight --json
```

Prefer `drift contract export` over `drift export contract`.

## MCP Surface

V1 MCP is read-only.

Keep:

- `get_scan_status`
- `get_repo_contract`
- `get_task_preflight`
- `get_conventions`
- `get_findings`
- `get_allowed_context`

Defer mutation-like MCP tools. If `propose_review_resolution` returns later, it must produce a proposal only and never mutate Drift state.

## Architecture

Start with fewer packages to avoid platform scaffolding before the loop works:

```text
crates/drift-engine
  Rust bounded-memory scanner/checker: ignore rules, hashing, TS/JS facts, baselines, deterministic checks.

packages/core
  TypeScript contract schemas and agent-facing types.

packages/storage
  TypeScript storage interfaces and local SQLite adapters where needed by CLI/MCP.

packages/scanner
  Deferred as a TS package. The first scanner lives in crates/drift-engine.

packages/cli
  Scriptable user commands that call the Rust engine and validate JSON with packages/core.

packages/mcp
  Read-only MCP tools.

apps/local-ui
  Deferred until CLI review, baseline, and findings lifecycle are stable.
```

The Rust engine emits JSON/JSONL records conforming to the TypeScript schemas. Do not build a parallel TypeScript parser/indexer in V1.

Split `adapter-typescript`, `conventions`, `policy`, `preflight`, and `postflight` into separate TypeScript packages later only when seams prove real.

## Rust Engine Requirements

The Rust engine exists to prevent Node heap pressure on large repositories. It must:

- stream file reads instead of loading repositories into memory
- skip generated, vendored, binary, build, secret-like, and oversized files
- process files in bounded batches
- emit facts incrementally as JSONL or persist them through SQLite/artifacts
- avoid building a giant in-memory graph in V1
- expose stable command/JSON boundaries for TS callers
- keep deterministic IDs and fingerprints stable for the same repo, commit, and engine version

## Storage And Versioning

SQLite state must include:

- `schema_migrations`
- repo identity and fingerprints
- scan manifests
- file snapshots and file hashes
- facts
- convention candidates
- accepted conventions
- rejected inferences
- exceptions/waivers
- baseline violations
- findings
- policies
- policy decisions
- agent sessions
- audit events

Every scan/contract/check must record:

- `contract_schema_version`
- `scanner_version`
- `adapter_version`
- `rule_engine_version`
- repo commit/branch/dirty state

Import/export must run compatibility checks before applying state.

## Context Egress Governance

Local scanning is allowed without approval. Every outward surface must call one central policy service before returning repo-derived context:

- CLI JSON
- MCP tools
- preflight packets
- exported contracts
- artifact files
- logs
- future UI responses

Default policy:

- deny `.env*`, key files, cert files, credential files, and secret-like paths
- cap snippets by `max_snippet_chars`
- disable full-file export by default
- mark policy metadata on every agent-facing response
- require explicit approval before cloud sync or remote export

Convention inference is deterministic and local in V1. Any future LLM/model-based inference must go through egress policy and be visibly marked as remote/exported context.

## TypeScript/JavaScript Fact Extraction V1

The Rust engine must extract:

- files
- imports
- exported symbols
- function calls
- route/module role detection
- test file detection
- package/dependency/script facts
- path alias resolution from `tsconfig.json`

Direct data-access detection must handle common aliases:

```ts
import { db } from "@/lib/db";
import { prisma } from "@repo/database";
import { client } from "../../server/db";
```

## Deferred From V1

Defer:

- local review UI
- Python adapter
- cloud sync
- graph explorer
- generic repo chatbot
- full desktop app polish
- enterprise audit console
- source mutation/autofix
- duplicate-helper detection
- generic existing-utility search
- broad validation library preference checks
- component import boundary checks
- dependency duplication risks
- review-comment-to-memory automation

## Acceptance Criteria

V1 is working when:

1. `drift init` detects a TypeScript repo, package manager, workspace shape, framework hints, test commands, and ignored paths.
2. `drift scan` extracts deterministic facts and convention candidates for API/server-side layering.
3. Candidates include `ConventionKind`, structured scope, matcher config, enforcement capability, explainable scoring, evidence, and counterexamples.
4. CLI commands can list, show, accept, reject, edit, and add exceptions for candidates.
5. `RepoContract` materializes from accepted state and is not silently rewritten by scans.
6. `drift baseline create --from main --json` stores existing violations.
7. `drift check --diff main...HEAD --scope changed-hunks --json` classifies findings as new, touched-existing, pre-existing, or fixed.
8. Only deterministic newly introduced blocking violations block by default.
9. `drift prepare "<task>" --json` returns policy-filtered agent context.
10. MCP exposes equivalent read-only context.
11. Policy metadata appears on every outward response.
12. Tests cover golden fixtures, noisy legacy repos, exceptions, redaction, diff parsing, path aliases, determinism, migrations, MCP/CLI parity, and audit events.
