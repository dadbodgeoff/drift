# Drift V1 Deterministic API Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Drift V1 as a CLI-first local guardrail for AI-generated TypeScript API/server-side diffs, focused on deterministic conventions around direct data-access imports and service-layer delegation.

**Architecture:** Use Rust for the bounded-memory scanner/checker engine and TypeScript for product surfaces. `crates/drift-engine` owns repo walking, ignore rules, hashing, TS/JS fact extraction, baseline matching, and deterministic checks; `packages/core`, `packages/cli`, and `packages/mcp` own schemas, command UX, and agent integration.

**Tech Stack:** Rust, Cargo workspace, TypeScript, Node.js, pnpm workspaces, SQLite, Zod, tree-sitter TypeScript/TSX parsing, Vitest, Git CLI integration, MCP TypeScript SDK.

---

## Revised V1 Sequence

1. Rust engine repo detection, ignore rules, and streaming fingerprints.
2. TypeScript contract schemas and stable IDs.
3. Rust TypeScript/JavaScript fact extraction for API/server-side layering.
4. Typed convention model, matchers, exceptions, findings, and baselines.
5. One deterministic convention family: API routes must not directly import data-access clients.
6. Candidate inference with explainable scoring.
7. SQLite storage, migrations, artifacts, and versioning.
8. Scriptable CLI convention review.
9. Baseline creation and status.
10. Diff parser and postflight checker in Rust.
11. Preflight packet generation in TS from contract/check outputs.
12. Read-only MCP surface.
13. Golden fixture and regression tests.

Local UI, Python, cloud sync, graph explorer, duplicate-helper detection, and generic utility search are deferred.

## File Structure

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
Cargo.toml

crates/drift-engine/
  Cargo.toml
  src/lib.rs
  src/ignore.rs
  src/fingerprint.rs
  src/facts.rs
  src/check.rs
  tests/engine_basics.rs

packages/core/
  src/domain.ts
  src/schemas.ts
  src/ids.ts
  src/rules.ts
  src/policy.ts
  src/preflight.ts
  src/postflight.ts
  src/index.ts
  test/domain.test.ts
  test/rules.test.ts
  test/policy.test.ts
  test/preflight.test.ts
  test/postflight.test.ts

packages/storage/
  src/storage.ts
  src/sqlite-storage.ts
  src/migrations.ts
  src/artifacts.ts
  src/index.ts
  test/sqlite-storage.test.ts
  test/migrations.test.ts

packages/scanner/
  Deferred; scanner starts in Rust.
  test/fixtures/next-api/
  test/fixtures/legacy-violations/
  test/fixtures/with-exceptions/
  test/typescript-facts.test.ts
  test/scan-service.test.ts

packages/cli/
  src/main.ts
  src/commands.ts
  test/cli-parse.test.ts

packages/mcp/
  src/server.ts
  test/mcp-server.test.ts

test/e2e/drift-v1.test.ts
```

## Task 1: Scaffold Monorepo And Rust Engine

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `Cargo.toml`
- Create: `crates/drift-engine/Cargo.toml`
- Create: `crates/drift-engine/src/lib.rs`
- Create: `crates/drift-engine/tests/engine_basics.rs`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/domain.test.ts`

- [ ] **Step 1: Create root package metadata**

```json
{
  "name": "drift",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test && pnpm test:engine",
    "test:engine": "cargo test -p drift-engine",
    "test:e2e": "vitest run test/e2e",
    "typecheck": "pnpm -r typecheck",
    "verify": "pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  },
  "packageManager": "pnpm@10.10.0"
}
```

- [ ] **Step 2: Create workspace and TypeScript config**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create core package**

- [ ] **Step 3: Create Rust workspace and engine scaffold**

Create root `Cargo.toml`:

```toml
[workspace]
members = ["crates/drift-engine"]
resolver = "3"

[workspace.package]
edition = "2024"
license = "UNLICENSED"
version = "0.1.0"
```

Create `crates/drift-engine/Cargo.toml`:

```toml
[package]
name = "drift-engine"
edition.workspace = true
license.workspace = true
version.workspace = true

[dependencies]
sha2 = "0.10.9"

[dev-dependencies]
tempfile = "3.14.0"
```

Create initial Rust tests before implementation. They should cover engine version, ignored paths, and streaming file fingerprints.

- [ ] **Step 4: Create core package**

Create `packages/core/package.json`:

```json
{
  "name": "@drift/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

Create `packages/core/src/index.ts`:

```ts
export const DRIFT_CORE_VERSION = "0.1.0";
```

- [ ] **Step 5: Add scaffold test**

Create `packages/core/test/domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DRIFT_CORE_VERSION } from "../src/index.js";

describe("core scaffold", () => {
  it("exports the core version", () => {
    expect(DRIFT_CORE_VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 6: Verify**

Run:

```bash
pnpm install
pnpm test
pnpm typecheck
```

Expected: all commands pass.

## Task 2: Core Domain, Schemas, And Stable IDs

**Files:**
- Create: `packages/core/src/domain.ts`
- Create: `packages/core/src/schemas.ts`
- Create: `packages/core/src/ids.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/domain.test.ts`

- [ ] **Step 1: Replace the core test**

```ts
import { describe, expect, it } from "vitest";
import {
  AcceptedConventionSchema,
  FindingSchema,
  RepoContractSchema,
  makeDriftId
} from "../src/index.js";

describe("core domain", () => {
  it("creates stable prefixed ids", () => {
    expect(makeDriftId("convention", "abc123")).toBe("convention_abc123");
  });

  it("validates accepted deterministic conventions", () => {
    const convention = AcceptedConventionSchema.parse({
      id: "convention_abc",
      contract_id: "contract_abc",
      kind: "api_route_no_direct_data_access",
      statement: "API routes must not import direct data-access clients.",
      scope: { path_globs: ["app/api/**/*.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_no_direct_data_access",
        forbidden_imports: ["@/db", "@/prisma", "prisma"],
        applies_to_file_roles: ["api_route"]
      },
      severity: "error",
      enforcement_mode: "block",
      enforcement_capability: "deterministic_check",
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });

    expect(convention.kind).toBe("api_route_no_direct_data_access");
  });

  it("validates repo contracts and findings", () => {
    expect(() => RepoContractSchema.parse({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
      conventions: [],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: [".env*", "**/*.pem"],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: []
    })).not.toThrow();

    expect(FindingSchema.parse({
      id: "finding_abc",
      repo_id: "repo_abc",
      convention_id: "convention_abc",
      fingerprint: "fp",
      title: "API route imports database client directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:00.000Z"
    }).diff_status).toBe("new_in_diff");
  });
});
```

- [ ] **Step 2: Add domain records**

Create `packages/core/src/domain.ts` with the exact types from `docs/drift-v1-product-technical-spec.md`: `ConventionKind`, `ConventionScope`, `ConventionMatcher`, `EnforcementCapability`, `ConventionScore`, `ConventionException`, `EvidenceRef`, `ConventionCandidate`, `AcceptedConvention`, `BaselineViolation`, `Finding`, `RiskArea`, `RepoContract`, and related union types.

- [ ] **Step 3: Add Zod schemas**

Create `packages/core/src/schemas.ts` mirroring every exported domain type. Use snake_case field names to match CLI JSON and exported contracts.

- [ ] **Step 4: Add ID helper**

Create `packages/core/src/ids.ts`:

```ts
export type DriftIdPrefix =
  | "repo"
  | "scan"
  | "fact"
  | "candidate"
  | "convention"
  | "contract"
  | "finding"
  | "baseline"
  | "policy"
  | "waiver"
  | "agent_session"
  | "policy_decision"
  | "audit_event"
  | "artifact";

export function makeDriftId(prefix: DriftIdPrefix, stablePart: string): string {
  if (!stablePart || /\s/.test(stablePart)) {
    throw new Error("stablePart must be non-empty and contain no whitespace");
  }
  return `${prefix}_${stablePart}`;
}
```

- [ ] **Step 5: Export core API and verify**

Replace `packages/core/src/index.ts`:

```ts
export * from "./domain.js";
export * from "./ids.js";
export * from "./schemas.js";
```

Run:

```bash
pnpm --filter @drift/core test
pnpm --filter @drift/core typecheck
```

Expected: PASS.

## Task 3: Storage, Migrations, And Versioning

**Files:**
- Create: `packages/storage/package.json`
- Create: `packages/storage/tsconfig.json`
- Create: `packages/storage/src/storage.ts`
- Create: `packages/storage/src/migrations.ts`
- Create: `packages/storage/src/sqlite-storage.ts`
- Create: `packages/storage/src/artifacts.ts`
- Create: `packages/storage/src/index.ts`
- Create: `packages/storage/test/sqlite-storage.test.ts`
- Create: `packages/storage/test/migrations.test.ts`

- [ ] **Step 1: Write migration/storage tests**

Tests must prove:

- `schema_migrations` records applied migrations.
- contracts save/load with `contract_schema_version`.
- audit events append and cannot update existing event IDs.
- baseline violations save/list by repo and convention.
- import compatibility rejects unsupported `contract_schema_version`.

- [ ] **Step 2: Implement migrations**

Create tables:

```sql
schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)
repos(id TEXT PRIMARY KEY, root_path TEXT NOT NULL, repo_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL)
scan_manifests(id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, git_commit TEXT, branch TEXT, dirty_state TEXT NOT NULL, scanner_version TEXT NOT NULL, adapter_version TEXT NOT NULL, rule_engine_version TEXT NOT NULL, created_at TEXT NOT NULL)
file_snapshots(id TEXT PRIMARY KEY, scan_id TEXT NOT NULL, file_path TEXT NOT NULL, file_hash TEXT NOT NULL, role TEXT)
facts(id TEXT PRIMARY KEY, scan_id TEXT NOT NULL, file_path TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, value_json TEXT NOT NULL)
convention_candidates(id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, scan_id TEXT NOT NULL, body_json TEXT NOT NULL, status TEXT NOT NULL)
contracts(id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, contract_schema_version INTEGER NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
baseline_violations(id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, convention_id TEXT NOT NULL, finding_fingerprint TEXT NOT NULL, file_path TEXT NOT NULL, first_seen_scan_id TEXT NOT NULL, first_seen_commit TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)
findings(id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, convention_id TEXT NOT NULL, fingerprint TEXT NOT NULL, body_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)
audit_events(id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, type TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)
```

- [ ] **Step 3: Implement storage interfaces**

Expose stores for repos, scans, facts, candidates, contracts, baselines, findings, and audit events. Every save method validates with `@drift/core` schemas before writing.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm install
pnpm --filter @drift/storage test
pnpm --filter @drift/storage typecheck
```

Expected: PASS.

## Task 4: Repo Detection, Ignore Rules, And TypeScript Facts

**Files:**
- Create: `packages/scanner/package.json`
- Create: `packages/scanner/tsconfig.json`
- Create: `packages/scanner/src/repo-detector.ts`
- Create: `packages/scanner/src/ignore-rules.ts`
- Create: `packages/scanner/src/file-snapshot.ts`
- Create: `packages/scanner/src/typescript-facts.ts`
- Create: `packages/scanner/src/scan-service.ts`
- Create: fixtures under `packages/scanner/test/fixtures/`
- Create: `packages/scanner/test/typescript-facts.test.ts`

- [ ] **Step 1: Create fixtures**

Create three fixture repos:

- `next-api`: one clean Next route delegating to service layer.
- `legacy-violations`: route with pre-existing direct DB import.
- `with-exceptions`: health route that legitimately bypasses service layer.

- [ ] **Step 2: Write fact extraction tests**

Tests must cover:

- path alias resolution from `tsconfig.json`
- direct imports: `@/lib/db`, `@/prisma`, `@repo/database`, `../../server/db`
- `api_route` role detection for `app/api/**/route.ts`
- exported symbols
- function calls
- test file detection
- generated/vendor/secret-like path exclusion

- [ ] **Step 3: Implement scanner**

Use deterministic parsing only. V1 convention inference must not call an LLM/model.

Extract facts:

- `file_detected`
- `import_used`
- `exported_symbol`
- `symbol_called`
- `route_declared`
- `file_role_detected`
- `test_declared`
- `package_script_declared`
- `dependency_declared`

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @drift/scanner test
pnpm --filter @drift/scanner typecheck
```

Expected: PASS.

## Task 5: Rules, Candidates, Exceptions, And Contract Materialization

**Files:**
- Create: `packages/core/src/rules.ts`
- Create: `packages/core/test/rules.test.ts`

- [ ] **Step 1: Write rule tests**

Tests must prove:

- direct data-access imports generate `api_route_no_direct_data_access` candidates.
- candidates include structured matcher config.
- scoring uses counts and `confidence_label`, not raw unexplained floats.
- health/debug counterexamples become proposed exceptions.
- accepted candidates materialize into `RepoContract`.
- scans never silently rewrite accepted contract state.

- [ ] **Step 2: Implement rules**

Implement only:

- candidate inference for `api_route_no_direct_data_access`
- optional candidate inference for `api_route_requires_service_delegation` when service imports are clear
- exception matching
- contract materialization from accepted state

Do not implement duplicate-helper detection, broad validation checks, component boundaries, or generic utility search.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @drift/core test -- rules
pnpm --filter @drift/core typecheck
```

Expected: PASS.

## Task 6: Policy Service

**Files:**
- Create: `packages/core/src/policy.ts`
- Create: `packages/core/test/policy.test.ts`

- [ ] **Step 1: Write policy tests**

Tests must cover:

- `.env*`, `*.pem`, `*.key`, cert, credential, and secret-like paths denied.
- snippet length capped.
- full file content denied by default.
- CLI, MCP, contract export, artifact, log, and UI surfaces all require policy metadata.
- redaction state is included in `EvidenceRef`.

- [ ] **Step 2: Implement `authorizeContextExport`**

Expose one central function:

```ts
authorizeContextExport(input: {
  surface: "cli-preflight" | "cli-check" | "mcp" | "contract-export" | "artifact" | "log" | "ui";
  path?: string;
  requested_snippet_chars?: number;
  contract: RepoContract;
}): PolicyDecision
```

Every outward command and MCP tool must call this service before returning repo-derived context.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @drift/core test -- policy
pnpm --filter @drift/core typecheck
```

Expected: PASS.

## Task 7: Baseline And Postflight Check

**Files:**
- Create: `packages/core/src/postflight.ts`
- Create: `packages/core/test/postflight.test.ts`

- [ ] **Step 1: Write baseline/postflight tests**

Tests must prove:

- baseline creation records existing violations.
- `changed-hunks` checks only changed hunks plus affected symbols.
- `changed-files` checks whole changed files.
- `full` checks full repo snapshot.
- baseline classifies `new_in_diff`, `touched_existing`, `outside_diff`, and resolved/fixed violations.
- only deterministic newly introduced blocking violations block by default.
- waivers/exceptions suppress expected findings without marking them false positive.

- [ ] **Step 2: Implement postflight**

Implement:

- git diff parsing
- finding fingerprint generation
- matcher evaluation for `api_route_no_direct_data_access`
- baseline lookup
- waiver/exception application
- JSON finding output

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @drift/core test -- postflight
pnpm --filter @drift/core typecheck
```

Expected: PASS.

## Task 8: Preflight

**Files:**
- Create: `packages/core/src/preflight.ts`
- Create: `packages/core/test/preflight.test.ts`

- [ ] **Step 1: Write preflight tests**

Tests must prove:

- task text matching finds relevant accepted conventions.
- risky areas are typed by `risk_kind`.
- required checks are recommended, not run.
- policy metadata appears on output.
- briefing-only conventions are included as context but never as blocking rules.

- [ ] **Step 2: Implement preflight**

Output:

```ts
type PreflightPacket = {
  task: string;
  applicable_conventions: AcceptedConvention[];
  risky_areas: RiskArea[];
  recommended_checks: RequiredCheck[];
  files_to_inspect: string[];
  policy: PolicyDecision[];
};
```

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @drift/core test -- preflight
pnpm --filter @drift/core typecheck
```

Expected: PASS.

## Task 9: CLI

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/main.ts`
- Create: `packages/cli/src/commands.ts`
- Create: `packages/cli/test/cli-parse.test.ts`

- [ ] **Step 1: Write CLI parse tests**

Cover:

```bash
drift init
drift scan
drift conventions list --status candidate --json
drift conventions show <id> --json
drift conventions accept <id> --severity warning --mode warn
drift conventions reject <id> --reason "not a real convention"
drift conventions edit <id> --statement "..." --scope-file scope.json
drift conventions exception add <id> --path "apps/web/app/api/health/**" --reason "health endpoint exception"
drift baseline create --from main --json
drift baseline status --json
drift prepare "<task>" --json
drift check --diff main...HEAD --scope changed-hunks --json
drift contract show --json
drift contract validate
drift contract export --format json
drift contract import <path> --dry-run
drift policy show --json
drift policy check-context --path <file> --surface cli-preflight --json
```

- [ ] **Step 2: Implement commands**

Implement scriptable commands before any local UI. Commands should call storage/core/scanner services, emit JSON with stable schemas, and record audit events for accept/reject/edit/exception/baseline/import/export/policy changes.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @drift/cli test
pnpm --filter @drift/cli typecheck
```

Expected: PASS.

## Task 10: Read-Only MCP

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/server.ts`
- Create: `packages/mcp/test/mcp-server.test.ts`

- [ ] **Step 1: Write MCP tests**

Expose read-only tools only:

- `get_scan_status`
- `get_repo_contract`
- `get_task_preflight`
- `get_conventions`
- `get_findings`
- `get_allowed_context`

Tests must prove MCP and CLI preflight return equivalent policy-filtered content for the same task.

- [ ] **Step 2: Implement MCP server**

Every MCP tool must call `authorizeContextExport` before returning repo-derived context.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @drift/mcp test
pnpm --filter @drift/mcp typecheck
```

Expected: PASS.

## Task 11: Golden Fixtures And E2E

**Files:**
- Create: `test/e2e/drift-v1.test.ts`
- Create: `test/golden/*.json`

- [ ] **Step 1: Add golden tests**

Create fixture snapshots for:

- clean Next.js API repo
- legacy repo with baseline violations
- repo with accepted health-route exception
- repo with path aliases for DB imports

Snapshot full JSON for:

- scan facts
- convention candidates
- contract
- baseline
- preflight
- postflight findings

- [ ] **Step 2: Add regression tests**

Tests must cover:

- noisy legacy repo does not block after baseline.
- newly introduced direct DB import blocks.
- touched existing violation warns but does not default-block.
- exception path suppresses expected finding.
- `.env` and secret-like paths are denied from all outward surfaces.
- same repo/commit/version produces stable IDs and finding fingerprints.
- migration test applies from empty DB to current schema.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: PASS.

## Explicit Deferrals

Do not implement in this V1 plan:

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
- broad validation/component/dependency convention enforcement
- review-comment-to-memory automation

## Self-Review Notes

- This revision incorporates the GPT Pro critique by narrowing V1 to one deterministic, machine-checkable convention family.
- The old broad plan is intentionally replaced. The implementation should not start with UI, broad convention inference, duplicate-helper detection, or multi-language support.
- The critical path is: facts -> typed candidate -> accepted convention -> baseline -> diff finding -> preflight/MCP.
