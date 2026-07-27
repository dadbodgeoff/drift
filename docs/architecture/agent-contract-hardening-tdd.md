# Agent Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Implementation status as of 2026-05-24:** implemented and verified in source. Rust fact emission was satisfied by existing `import_used`, `symbol_called`, `data_operation_detected`, `route_declared`, and `file_role_detected` facts; no Rust production change was required for this slice. Broad duplicate-helper detection remains deferred as a product claim, but accepted canonical helper contracts now produce advisory fuzzy duplicate findings.

**Goal:** Harden Agent Contract Intelligence from exact configured enforcement into production-grade proof for fuzzy duplicate-helper detection, graph-backed flow proof, and verified required-check execution.

**Architecture:** Keep fuzzy and probabilistic signals out of silent blocking paths. The scanner/graph should emit evidence, query code should score and explain it, CLI should enforce only accepted contracts with evidence, MCP should expose read-only proof, and release proof should fail closed when required external checks have not actually run.

**Tech Stack:** Rust engine facts and graph edges, TypeScript core schemas, SQLite storage migrations, CLI commands, read-only MCP handlers, Vitest, Rust integration tests, beta proof scripts.

---

## Current Baseline

This plan starts after `agent-contract-intelligence-tdd.md` is implemented.

Current verified behavior:

- Agent contracts exist for `canonical_helper_reuse`, `entrypoint_flow`, and `required_change_checks`.
- `canonical_helper_reuse` blocks only exact configured exported symbols in `avoid_new_symbols_matching`.
- `entrypoint_flow` checks configured missing calls/imports on entrypoint files.
- `required_change_checks` contributes checks to preflight and `checks list`.
- CLI and MCP can expose read-only agent contract packets.

Current production gaps:

- Drift cannot yet detect a helper that is renamed but behaviorally redundant.
- Drift cannot yet prove full flow shape across graph paths such as route -> auth -> validation -> service -> data access -> response boundary.
- Drift cannot yet prove that required external commands were executed against a specific repo state.

## Hard Rules

- Fuzzy similarity cannot silently become a blocking finding.
- A fuzzy duplicate may block only when the repo contract explicitly enables blocking for a deterministic evidence threshold.
- Missing graph evidence must produce `blocked_by_missing_evidence`, not a confident violation.
- Required external checks must be shell-free by default, time-bounded, tied to repo identity, and audit logged.
- MCP remains read-only for this slice. It can report check execution proof, but it must not run commands.
- Capabilities must keep `duplicate_helper_detection` deferred until the full proof ladder passes.

## Completion Gate

The slice is complete when all of these pass:

```bash
pnpm --filter @drift/core test
pnpm --filter @drift/query test
pnpm --filter @drift/storage test
pnpm --filter @drift/cli test -- test/cli.test.ts
pnpm --filter @drift/mcp test
cargo test -p drift-engine
pnpm test:e2e
pnpm validate:claims
pnpm beta:proof
pnpm verify:ci
```

The release proof must include:

- one renamed duplicate helper detected with evidence;
- one good entrypoint flow passing;
- one bad entrypoint flow failing with graph path evidence;
- one required external check execution tied to repo identity and command hash;
- CLI/MCP parity for read-only proof.

## New Contract Surfaces

### 1. Helper Similarity Evidence

Purpose: represent why Drift believes two helper symbols are duplicates.

Required fields:

```ts
type HelperSimilarityEvidence = {
  schema_version: "drift.helper_similarity.v1";
  candidate_symbol: string;
  candidate_file_path: string;
  canonical_symbol: string;
  canonical_module: string;
  score: number;
  score_band: "low" | "medium" | "high" | "deterministic";
  matched_features: Array<
    | "name_tokens"
    | "purpose_tags"
    | "parameter_shape"
    | "return_shape"
    | "call_dependencies"
    | "import_dependencies"
    | "body_operation_kinds"
  >;
  missing_features: string[];
  evidence_refs: string[];
  blocking_allowed: boolean;
};
```

Invariants:

- `score` is stable and deterministic for the same scan.
- `blocking_allowed` is false unless the accepted contract explicitly allows blocking for the score band.
- Evidence never includes raw source snippets.

### 2. Flow Proof

Purpose: prove an accepted entrypoint flow from graph evidence instead of only checking local calls/imports.

Required fields:

```ts
type EntrypointFlowProof = {
  schema_version: "drift.entrypoint_flow_proof.v1";
  entry_file_path: string;
  contract_id: string;
  required_steps: Array<{
    step_kind: "auth_helper" | "validation_helper" | "service_delegation" | "response_boundary";
    satisfied: boolean;
    evidence_refs: string[];
    graph_path: string[];
  }>;
  forbidden_steps: Array<{
    step_kind: "direct_data_access" | "inline_business_logic";
    present: boolean;
    evidence_refs: string[];
    graph_path: string[];
  }>;
  missing_evidence: string[];
};
```

Invariants:

- A flow violation must include the graph edge or fact that proves the violation.
- A missing required step without enough evidence produces `blocked_by_missing_evidence` unless the contract marks the step as local-only.
- Direct data access remains deterministic and blocking when graph evidence exists.

### 3. Required Check Execution Proof

Purpose: prove that a required command ran against the repo state it claims to validate.

Required fields:

```ts
type RequiredCheckExecution = {
  schema_version: "drift.required_check_execution.v1";
  execution_id: string;
  repo_id: string;
  repo_root: string;
  repo_commit: string;
  worktree_dirty: boolean;
  scan_id: string | null;
  repo_contract_id: string;
  agent_contract_id: string;
  command: string;
  argv: string[];
  command_hash: string;
  cwd: string;
  started_at: string;
  completed_at: string;
  timeout_ms: number;
  exit_code: number | null;
  status: "passed" | "failed" | "timed_out" | "blocked";
  stdout_hash: string;
  stderr_hash: string;
  stdout_preview: string;
  stderr_preview: string;
  audit_event_id: string;
};
```

Invariants:

- Command execution uses `spawn`/`execFile` with `shell: false`.
- Command must match a required check from the active repo contract.
- Command must also match a human-approved safe command entry.
- Dirty worktree is allowed for local dev but reported in proof.
- Release proof requires clean worktree unless explicitly running fixture state.
- MCP can read this proof but cannot create it.

## File Map

Core schemas and domain:

- Modify `packages/core/src/domain.ts`
- Modify `packages/core/src/schemas.ts`
- Modify `packages/core/src/contracts.ts`
- Modify `packages/core/src/agent-contracts.ts`
- Test `packages/core/test/domain.test.ts`

Engine facts and graph:

- Modify `crates/drift-engine/src/*`
- Test `crates/drift-engine/tests/typescript_facts.rs`
- Test `crates/drift-engine/tests/stream_graph.rs`
- Test `crates/drift-engine/tests/graph_backed_check.rs`

Query layer:

- Create `packages/query/src/helper-similarity.ts`
- Create `packages/query/src/flow-proof.ts`
- Modify `packages/query/src/index.ts`
- Test `packages/query/test/query.test.ts`

Storage:

- Add migration entry `013_required_check_executions` in `packages/storage/src/migrations.ts`
- Modify `packages/storage/src/sqlite-storage.ts`
- Test `packages/storage/test/sqlite-storage.test.ts`

CLI:

- Create `packages/cli/src/check/helper-similarity.ts`
- Create `packages/cli/src/check/flow-proof.ts`
- Create `packages/cli/src/commands/checks-run.ts`
- Modify `packages/cli/src/app/router.ts`
- Modify `packages/cli/src/args/help.ts`
- Modify `packages/cli/src/commands/checks.ts`
- Modify `packages/cli/src/check/run-check.ts`
- Test `packages/cli/test/cli.test.ts`

MCP:

- Modify `packages/mcp/src/index.ts`
- Test `packages/mcp/test/mcp.test.ts`

Release proof:

- Modify `scripts/run-beta-proof.mjs`
- Modify `scripts/validate-product-claims.mjs` only when claims are promoted
- Test `test/e2e/release-hygiene.test.ts`

Docs:

- Update `docs/architecture/agent-contract-intelligence-tdd.md`
- Update `docs/architecture/canonical-contracts.md`
- Update `docs/architecture/beta-claims.json` only when the completion gate passes

## Task 1: Core Proof Schemas

**Files:**

- Modify `packages/core/src/domain.ts`
- Modify `packages/core/src/schemas.ts`
- Modify `packages/core/src/index.ts`
- Test `packages/core/test/domain.test.ts`

- [x] **Step 1: Write failing core schema tests**

Add tests that parse valid proof objects and reject invalid confidence/command states:

```ts
it("validates helper similarity evidence without source snippets", () => {
  const parsed = HelperSimilarityEvidenceSchema.parse({
    schema_version: "drift.helper_similarity.v1",
    candidate_symbol: "getCurrentUser",
    candidate_file_path: "apps/web/lib/get-current-user.ts",
    canonical_symbol: "requireUser",
    canonical_module: "@/lib/auth/require-user",
    score: 0.91,
    score_band: "high",
    matched_features: ["purpose_tags", "parameter_shape", "call_dependencies"],
    missing_features: ["return_shape"],
    evidence_refs: ["fact_candidate_export", "fact_canonical_export"],
    blocking_allowed: false
  });

  expect(parsed.blocking_allowed).toBe(false);
});

it("rejects required check execution without argv proof", () => {
  expect(() => RequiredCheckExecutionSchema.parse({
    schema_version: "drift.required_check_execution.v1",
    execution_id: "exec_1",
    repo_id: "repo_1",
    repo_root: "/repo",
    repo_commit: "abc",
    worktree_dirty: false,
    scan_id: "scan_1",
    repo_contract_id: "contract_1",
    agent_contract_id: "agent_contract_checks",
    command: "pnpm test",
    command_hash: "hash",
    cwd: "/repo",
    started_at: "2026-05-24T00:00:00.000Z",
    completed_at: "2026-05-24T00:00:01.000Z",
    timeout_ms: 30000,
    exit_code: 0,
    status: "passed",
    stdout_hash: "stdout",
    stderr_hash: "stderr",
    stdout_preview: "",
    stderr_preview: "",
    audit_event_id: "audit_1"
  })).toThrow();
});
```

- [x] **Step 2: Run the red test**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "helper similarity evidence|required check execution"
```

Expected: fail because schemas are not exported yet.

- [x] **Step 3: Add minimal domain types and Zod schemas**

Add the three proof types from this document and export:

```ts
export {
  HelperSimilarityEvidenceSchema,
  EntrypointFlowProofSchema,
  RequiredCheckExecutionSchema
} from "./schemas.js";
```

- [x] **Step 4: Run the green test**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "helper similarity evidence|required check execution"
```

Expected: pass.

## Task 2: Engine Helper Signature Facts

**Files:**

- Modify `crates/drift-engine/src/*`
- Test `crates/drift-engine/tests/typescript_facts.rs`
- Test `crates/drift-engine/tests/stream_graph.rs`

- [x] **Step 1: Write failing Rust facts test**

Add a fixture test that scans:

```ts
export async function requireUser(request: Request) {
  const session = await getSession(request);
  if (!session?.user) throw new Error("unauthorized");
  return session.user;
}
```

Expected scan facts:

- exported symbol `requireUser`;
- helper signature fact with one parameter of request-like shape;
- call dependency `getSession`;
- body operation kind `auth_guard`;
- no raw source snippet.

- [x] **Step 2: Run the red test**

```bash
cargo test -p drift-engine extracts_helper_signature_facts -- --nocapture
```

Expected: fail because helper signature facts do not exist.

- [x] **Step 3: Emit minimal helper facts**

Emit facts that are sufficient for scoring:

- symbol name;
- file path;
- exported status;
- parameter count and coarse parameter names;
- call names;
- import sources;
- operation kind tags.

Do not add semantic embeddings, remote models, or source snippets.

- [x] **Step 4: Run Rust fact tests**

```bash
cargo test -p drift-engine extracts_helper_signature_facts -- --nocapture
cargo test -p drift-engine scan_stream_resolves_imports_to_exported_symbols -- --nocapture
```

Expected: pass.

## Task 3: Deterministic Helper Similarity Scorer

**Files:**

- Create `packages/query/src/helper-similarity.ts`
- Modify `packages/query/src/index.ts`
- Test `packages/query/test/query.test.ts`

- [x] **Step 1: Write failing scorer tests**

Add tests for high, medium, and low similarity:

```ts
it("scores renamed auth helper as high similarity to canonical helper", () => {
  const result = scoreHelperSimilarity({
    candidate: {
      symbol: "getCurrentUser",
      file_path: "apps/web/lib/get-current-user.ts",
      purpose_tags: ["auth", "user"],
      parameter_shape: ["request"],
      return_shape: "user",
      call_dependencies: ["getSession"],
      import_dependencies: ["next/server"],
      body_operation_kinds: ["auth_guard"]
    },
    canonical: {
      symbol: "requireUser",
      module: "@/lib/auth/require-user",
      purpose_tags: ["auth", "user"],
      parameter_shape: ["request"],
      return_shape: "user",
      call_dependencies: ["getSession"],
      import_dependencies: ["next/server"],
      body_operation_kinds: ["auth_guard"]
    }
  });

  expect(result.score_band).toBe("high");
  expect(result.matched_features).toContain("purpose_tags");
  expect(result.matched_features).toContain("call_dependencies");
});
```

- [x] **Step 2: Run the red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "scores renamed auth helper"
```

Expected: fail because `scoreHelperSimilarity` does not exist.

- [x] **Step 3: Implement simple weighted scoring**

Use deterministic weights:

- purpose tags: 0.25
- parameter shape: 0.15
- return shape: 0.15
- call dependencies: 0.20
- import dependencies: 0.10
- body operation kinds: 0.15

Score bands:

- `deterministic`: exact symbol or exact configured match
- `high`: score >= 0.85
- `medium`: score >= 0.65
- `low`: score < 0.65

- [x] **Step 4: Run query tests**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "helper"
```

Expected: pass.

## Task 4: Fuzzy Duplicate Helper Findings

**Files:**

- Create `packages/cli/src/check/helper-similarity.ts`
- Modify `packages/cli/src/check/run-check.ts`
- Modify `packages/cli/src/check/finding-fingerprint.ts`
- Test `packages/cli/test/cli.test.ts`

- [x] **Step 1: Write failing CLI check test**

Add a generated repo fixture with canonical `requireUser` and a new exported `getCurrentUser` that has the same auth shape.

Expected check result:

- one finding;
- title `Possible duplicate canonical helper introduced`;
- `expected_layer: "canonical_helper"`;
- `actual_layer: "possible_duplicate_helper"`;
- evidence includes helper similarity proof;
- enforcement result is `warn` unless contract has explicit blocking threshold.

- [x] **Step 2: Run the red test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "possible duplicate canonical helper"
```

Expected: fail because fuzzy helper detection is not wired into `check`.

- [x] **Step 3: Implement advisory fuzzy findings**

Rules:

- exact configured `avoid_new_symbols_matching` behavior remains unchanged;
- high similarity produces advisory finding by default;
- blocking is allowed only when contract includes an explicit deterministic or high-threshold blocking policy;
- medium similarity appears in preflight diagnostics, not blocking findings;
- low similarity is ignored.

- [x] **Step 4: Run focused CLI tests**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "canonical helper|possible duplicate canonical helper"
```

Expected: pass.

## Task 5: Graph-Backed Entrypoint Flow Proof

**Files:**

- Create `packages/query/src/flow-proof.ts`
- Modify `packages/query/src/index.ts`
- Modify `packages/cli/src/check/flow-proof.ts`
- Modify `packages/cli/src/check/run-check.ts`
- Test `packages/query/test/query.test.ts`
- Test `packages/cli/test/cli.test.ts`

- [x] **Step 1: Write failing flow proof query test**

Fixture graph:

```text
apps/web/app/api/accounts/route.ts
  -> "@/lib/auth/require-user"
  -> "@/lib/validation/account-schema"
  -> "@/server/services/accounts-service"
  -> "@/server/data/accounts-repo"
```

Expected proof:

- auth step satisfied;
- validation step satisfied;
- service delegation satisfied;
- direct data access forbidden step absent;
- graph paths are populated.

- [x] **Step 2: Run the red query test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "entrypoint flow proof"
```

Expected: fail because `buildEntrypointFlowProof` does not exist.

- [x] **Step 3: Implement graph proof builder**

Inputs:

- scan facts;
- graph nodes;
- graph edges;
- entrypoint flow contract;
- entry file path.

Output:

- `EntrypointFlowProof`;
- no source snippets;
- missing evidence listed explicitly.

- [x] **Step 4: Write failing CLI bad-flow test**

Bad route:

```ts
import { prisma } from "@/lib/prisma";

export async function POST() {
  return Response.json(await prisma.account.findMany());
}
```

Expected:

- status `fail`;
- finding includes `forbidden_steps[direct_data_access].present: true`;
- graph path includes route file and data-access target;
- suggested fix says to delegate through service.

- [x] **Step 5: Run the red CLI test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "entrypoint flow graph proof"
```

Expected: fail until CLI consumes the proof builder.

- [x] **Step 6: Wire flow proof into check**

Use graph-backed proof before local call/import fallback. If graph evidence is unavailable, emit `blocked_by_missing_evidence` diagnostics for blocking contracts instead of pretending the flow is valid.

- [x] **Step 7: Run flow tests**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "entrypoint flow proof"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "entrypoint flow"
```

Expected: pass.

## Task 6: Required Check Execution Storage

**Files:**

- Add migration entry `013_required_check_executions` in `packages/storage/src/migrations.ts`
- Modify `packages/storage/src/sqlite-storage.ts`
- Test `packages/storage/test/sqlite-storage.test.ts`

- [x] **Step 1: Write failing storage test**

Test stores and reads:

- execution id;
- repo id;
- scan id;
- repo contract id;
- agent contract id;
- command hash;
- argv;
- status;
- exit code;
- stdout/stderr hashes;
- audit event id.

- [x] **Step 2: Run the red storage test**

```bash
pnpm --filter @drift/storage test -- test/sqlite-storage.test.ts -t "required check execution"
```

Expected: fail because the table and methods do not exist.

- [x] **Step 3: Add migration and storage methods**

Methods:

```ts
recordRequiredCheckExecution(execution: RequiredCheckExecution): void;
listRequiredCheckExecutions(repoId: string, filters?: {
  command?: string;
  scan_id?: string;
  repo_contract_id?: string;
}): RequiredCheckExecution[];
latestRequiredCheckExecution(repoId: string, command: string): RequiredCheckExecution | null;
```

- [x] **Step 4: Run storage tests**

```bash
pnpm --filter @drift/storage test -- test/sqlite-storage.test.ts -t "required check execution|migration"
```

Expected: pass.

## Task 7: CLI `checks run`

**Files:**

- Create `packages/cli/src/commands/checks-run.ts`
- Modify `packages/cli/src/app/router.ts`
- Modify `packages/cli/src/args/help.ts`
- Modify `packages/cli/src/commands/checks.ts`
- Test `packages/cli/test/cli.test.ts`

- [x] **Step 1: Write failing CLI command test**

Expected command:

```bash
drift checks run --repo repo_1 --command "pnpm test -- --runInBand" --json
```

Expected behavior:

- rejects command if it is not required by active repo contract;
- rejects command if it is not in `safe_commands`;
- runs command with `shell: false`;
- records execution proof;
- writes audit event;
- returns JSON with execution id and status.

- [x] **Step 2: Run the red test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "checks run records execution proof"
```

Expected: fail because `checks run` does not exist.

- [x] **Step 3: Implement command runner**

Rules:

- Parse command into argv without shell expansion.
- CWD must be repo root unless the contract specifies a subdirectory.
- Default timeout is 120000 ms.
- Capture stdout/stderr previews with a 4000 character cap.
- Store hashes for full stdout/stderr.
- Record nonzero exit codes as `failed`, not as command infrastructure errors.
- Infrastructure errors return CLI failure and a `blocked` proof when enough metadata exists.

- [x] **Step 4: Run focused CLI tests**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "checks run|checks list"
```

Expected: pass.

## Task 8: `check` Requires Fresh Execution Proof

**Files:**

- Modify `packages/cli/src/check/run-check.ts`
- Test `packages/cli/test/cli.test.ts`

- [x] **Step 1: Write failing enforcement test**

Scenario:

- repo contract requires `pnpm test`;
- no execution proof exists for the current repo contract and scan;
- `drift check --json` should return blocked status or a finding with `actual_layer: "required_check_not_run"`.

- [x] **Step 2: Run the red test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "required check not run"
```

Expected: fail because `check` currently only lists required checks.

- [x] **Step 3: Enforce proof freshness**

Freshness rule:

- execution command hash matches required command;
- execution repo contract id matches active contract;
- execution scan id matches current scan when scan exists;
- execution status is `passed`;
- execution completed after the relevant scan.

- [x] **Step 4: Run check enforcement tests**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "required check not run|required check execution proof"
```

Expected: pass.

## Task 9: MCP Read-Only Proof Parity

**Files:**

- Modify `packages/mcp/src/index.ts`
- Test `packages/mcp/test/mcp.test.ts`

- [x] **Step 1: Write failing MCP parity test**

Expected MCP surface:

- `get_required_check_executions`;
- returns same execution proof shape as CLI;
- no MCP tool can run a command.

- [x] **Step 2: Run the red test**

```bash
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "required check execution proof"
```

Expected: fail because MCP does not expose execution proof.

- [x] **Step 3: Add read-only handler**

Handler rules:

- validate repo id;
- read storage only;
- return latest executions and stale/missing proof diagnostics;
- include governance read-only envelope.

- [x] **Step 4: Run MCP tests**

```bash
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "required check execution proof|read-only MCP"
```

Expected: pass.

## Task 10: Release Proof and Claims Gate

**Files:**

- Modify `scripts/run-beta-proof.mjs`
- Modify `test/e2e/release-hygiene.test.ts`
- Modify `docs/architecture/beta-claims.json` only after the proof passes

- [x] **Step 1: Write failing e2e proof test**

The beta proof must generate:

```json
{
  "fuzzy_duplicate_helper_detected": true,
  "entrypoint_flow_graph_proof_verified": true,
  "required_check_execution_verified": true,
  "mcp_cli_required_check_parity_verified": true
}
```

- [x] **Step 2: Run the red e2e test**

```bash
pnpm vitest run test/e2e/release-hygiene.test.ts -t "hardening proof" --no-file-parallelism --maxWorkers=1
```

Expected: fail because the proof fields do not exist.

- [x] **Step 3: Extend beta proof fixture**

Fixture must include:

- canonical auth helper;
- renamed duplicate auth helper;
- good route with auth, validation, service, response;
- bad route with direct data access;
- required command that can pass deterministically, such as `node ./scripts/smoke-check.mjs`;
- read-only MCP proof parity.

- [x] **Step 4: Promote claims only after proof passes**

Rules:

- Keep broad `duplicate_helper_detection` deferred until fuzzy proof passes.
- Claim only `deterministic_helper_similarity_detection` if blocking is still gated.
- Claim `required_check_execution_proof` only after storage, CLI, MCP, and release proof pass.

- [x] **Step 5: Run full gate**

```bash
pnpm verify:ci
```

Expected: pass end to end.

## Production Readiness Bar

This hardening work is production-grade only when these are true:

- Fuzzy helper findings are explainable and reproducible from stored facts.
- High-similarity helper findings do not block unless the accepted contract explicitly allows it.
- Entrypoint flow proof shows graph paths for each satisfied and violated step.
- Required checks cannot be marked satisfied by merely listing them in a contract.
- Required check execution proof is tied to repo identity, scan id, contract id, command hash, and audit event.
- MCP reports the same proof as CLI and remains read-only.
- `pnpm verify:ci` passes from a clean commit.

## Explicit Non-Goals

- No embeddings.
- No remote model scoring.
- No broad clone detection across whole repositories.
- No MCP command execution.
- No shell-based arbitrary command execution.
- No source snippets in proof payloads.
- No production claim promotion before release proof passes.
