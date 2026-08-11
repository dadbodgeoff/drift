# Fixture Matrix And Scale Gates

Date: 2026-05-21

## Purpose

Drift should not overfit to one clean Next.js fixture.

The fixture matrix proves the intelligence loop across repo shapes, legacy violations, import resolution paths, and large-repo limits. Scale gates prove Drift fails safely and honestly when a repo is too large or partially unsupported.

## Fixture Principles

- Fixtures are product contracts, not parser demos.
- Every fixture should test at least one user-facing surface.
- Golden JSON should cover stable machine outputs.
- Human text tests should assert key lines, not snapshot entire prose.
- Fixtures should include counterexamples and no-violation repos.
- Legacy violations must be separated from new drift.
- Unresolved or partial intelligence must be visible through diagnostics.

## Current Fixture Reality

As of this planning pass, the repo should treat the existing fixture coverage as early wedge proof, not a mature matrix. The known current fixture emphasis is the direct TypeScript/Next.js API data-access case.

Before deeper parser and graph work, add the matrix below so import-resolution, baseline, no-violation, and scale behavior cannot regress silently.

## Required Fixture Matrix

### `next-api-direct-db`

Purpose: known direct data-access violation.

Shape:

```text
app/api/users/route.ts
src/lib/db.ts
```

Expected:

- route role detected
- DB/client import detected
- import resolves to local DB module when graph exists
- direct-data-access finding emitted
- evidence points to import or call line
- `check --scope changed-hunks` blocks only when new in diff

Surfaces:

- `scan`
- `conventions list`
- `contract show`
- `check`
- `findings list`
- MCP `get_findings`

### `next-api-clean`

Purpose: no false positives.

Shape:

```text
app/api/users/route.ts -> src/services/users.ts -> src/lib/db.ts
```

Expected:

- route role detected
- service module detected or inferable
- route delegates to service
- DB access exists outside route
- no route-level direct-data-access finding

Surfaces:

- `scan`
- `repo map`
- `prepare`
- MCP `get_repo_map`

### `next-api-service-delegated`

Purpose: prove layered architecture understanding.

Shape:

```text
route imports getUsers from service
service imports prisma/db
```

Expected:

- route-to-service edge exists
- service-to-db edge exists
- no direct route-to-db finding
- preflight mentions service delegation convention when accepted

Surfaces:

- `scan`
- `prepare`
- `repo map`
- `check`

### `monorepo-alias-db`

Purpose: test workspace and alias resolution.

Shape:

```text
apps/web/app/api/users/route.ts
packages/db/src/client.ts
tsconfig paths
package.json workspaces
import { db } from "@acme/db"
```

Expected:

- package/workspace detected
- import resolves across package boundary
- package graph edges emitted
- direct-data-access rule can use resolved import evidence

Surfaces:

- `scan`
- `repo map`
- `check`

### `re-exported-db-client`

Purpose: catch DB access hidden behind re-exports.

Shape:

```text
src/lib/index.ts exports { db } from "./db"
app/api/users/route.ts imports { db } from "@/lib"
```

Expected:

- import resolves to barrel module
- re-export edge resolves to DB module where possible
- diagnostic emitted if re-export cannot be resolved
- finding uses best available evidence

Surfaces:

- `scan`
- `check`
- graph diagnostics

### `legacy-baselined-violations`

Purpose: protect adoption semantics.

Shape:

```text
existing route violation on main
new route violation in diff
one touched existing violation
```

Expected:

- baseline create stores existing violations
- pre-existing violation does not block
- newly introduced violation blocks when enforcement mode is block
- touched existing is visible but not classified as new
- fixed violation can be marked resolved

Surfaces:

- `baseline create`
- `baseline status`
- `check`
- `findings list`

### `mixed-js-ts-next-repo`

Purpose: ensure `.js`, `.jsx`, `.ts`, and `.tsx` behavior is explicit.

Expected:

- supported extensions are parsed
- unsupported syntax produces diagnostics, not crashes
- route detection works across supported route files

### `no-ts-repo`

Purpose: graceful unsupported repo behavior.

Expected:

- scan succeeds
- no bogus candidates
- capability/diagnostic explains no TypeScript/JS files found
- doctor remains useful

### `large-synthetic-repo`

Purpose: scale gate.

Shape:

```text
10,000 files total
1,000 parseable TypeScript files
generated/vendor/binary/secret-like files mixed in
```

Expected:

- bounded-memory behavior
- skip diagnostics/counts
- scan stats include files seen/skipped/parsed
- no runaway fact emission
- truncation is explicit if limits are hit

## Fixture Implementation Table

| Fixture | First test to write | Blocks which work |
| --- | --- | --- |
| `next-api-direct-db` | direct DB import emits stable finding | engine-owned check parity |
| `next-api-clean` | service delegation produces no route finding | false-positive control |
| `next-api-service-delegated` | route-to-service-to-db path exists | graph query API |
| `monorepo-alias-db` | workspace import resolves | import resolver |
| `re-exported-db-client` | barrel re-export resolves or diagnoses | resolver completeness |
| `legacy-baselined-violations` | old violation does not block, new one blocks | baseline semantics |
| `mixed-js-ts-next-repo` | extension support is explicit | parser coverage |
| `no-ts-repo` | graceful unsupported repo output | onboarding/doctor truth |
| `large-synthetic-repo` | scan stats and limits are stable | scale gates |

## Golden Outputs

Each core fixture should have golden JSON for:

- scan summary
- convention candidates
- contract
- repo map
- prepare
- check
- findings list
- MCP equivalent where applicable

Do not snapshot unstable fields directly. Normalize:

- timestamps
- temp paths
- absolute paths
- machine-specific state roots
- elapsed duration

## Determinism Contract

Same repo, same commit, same Drift version, same adapter versions, and same rule versions must produce stable:

- graph IDs
- candidate convention IDs
- finding fingerprints
- baseline violation fingerprints
- contract output ordering
- scan/check JSON after normalizing timestamps and durations

Determinism tests should run the same fixture twice from a clean state and compare normalized output. Non-deterministic ordering is a release blocker for machine consumers.

## Scale Gate Policy

Initial limits should be explicit and configurable.

```ts
type ScanLimits = {
  max_files_seen: number;
  max_files_parsed: number;
  max_file_bytes: number;
  max_facts: number;
  max_graph_nodes: number;
  max_graph_edges: number;
  follow_symlinks: false;
};
```

Suggested starting defaults:

```json
{
  "max_files_seen": 50000,
  "max_files_parsed": 10000,
  "max_file_bytes": 1000000,
  "max_facts": 250000,
  "max_graph_nodes": 250000,
  "max_graph_edges": 500000,
  "follow_symlinks": false
}
```

These are not product promises. They are safety rails. Tune them with real beta repos.

## Scan Stats

Scan/check output should include:

```ts
type ScanStats = {
  files_seen: number;
  files_skipped: number;
  files_parsed: number;
  files_too_large: number;
  binary_files_skipped: number;
  generated_files_skipped: number;
  vendor_files_skipped: number;
  gitignored_files_skipped: number;
  secret_like_files_skipped: number;
  facts_emitted: number;
  graph_nodes: number;
  graph_edges: number;
  diagnostics_count: number;
  truncated: boolean;
  truncation_reason?: string;
  duration_ms: number;
  peak_rss_bytes?: number;
  batch_count?: number;
  spill_artifacts_written?: number;
};
```

Silent partial scans are not allowed. If Drift truncates or skips important input, the user and agent must see it.

## CI Budgets

Initial budgets should be explicit even if they are conservative:

```text
large-synthetic-repo:
  files_seen: 10000
  ts_files_parsed: 1000
  max_duration_ms: define per CI machine after first benchmark
  max_peak_rss_bytes: define per CI machine after first benchmark
  max_facts: 250000
  max_graph_nodes: 250000
  max_graph_edges: 500000
```

If CI cannot measure peak RSS portably on every OS, run the memory assertion on the primary release OS and keep duration/stats assertions cross-platform.

## Required Skip Semantics

Drift should skip or cap:

- `.git`
- `node_modules`
- vendored directories
- generated/build outputs
- binary files
- lockfiles for parser facts, while still reading package-manager metadata where needed
- `.env*`
- private key/cert files
- files above max size
- symlinks unless explicitly enabled later

Skip decisions should produce counts, and important skip categories should produce diagnostics.

## Acceptance Criteria

- Fixture matrix covers violation, no-violation, monorepo, baseline, unsupported repo, and large repo cases.
- Golden JSON covers scan, contract, prepare, check, findings, and MCP where relevant.
- Import-resolution fixtures fail before resolver work and pass after it.
- Large synthetic repo runs under CI budget.
- Determinism tests prove stable IDs and fingerprints across repeated runs.
- Truncated scans are visible in JSON output.
- `.gitignore`, generated/vendor, secret-like, binary, oversized, and symlink behavior is tested.
- `pnpm verify:ci` remains the release gate.

## Non-Goals

- no broad language expansion until FactGraph V1 is stable
- no UI fixture viewer
- no fuzzy duplicate-helper detection
- no cloud sync
- no model-assisted fixture generation as source of truth
