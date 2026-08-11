# Production Gap Plan

Date: 2026-05-24
Position: hard-truth plan based on live repo audit. This is not an implementation plan for this commit; it lists what has to change before credible beta/production claims.

## Current Credible Claim

Credible today: Drift is a local-first TS/JS repo guardrail for a narrow route-layering wedge. It can scan, persist facts/graph, surface read-only CLI/MCP context, require human-confirmed contracts, block accepted direct data-access route violations, and produce a beta fixture proof.

Historical pre-sprint note: broad code intelligence, broad AI code review, broad language support, semantic TypeScript analysis, cloud sync, desktop UI, mutation-capable MCP, and Python support were not credible. Incremental reuse was also blocked at the time of this audit, but the follow-up sprint added limited unchanged-file fact reuse with graph rebuild.

## Before Credible Beta

Minimum beta bar:

- `pnpm verify:ci` must pass on a clean branch.
- PR must not be `UNSTABLE`.
- Branch must be reconciled with current `origin/main`.
- Beta proof must remain generated, not hand-written.
- Drift-on-Drift dogfood should be updated from live current output and should not rely on stale docs.
- Public docs must stay inside the runtime capability wedge.

Current status:

- `pnpm verify:ci` passed.
- PR #76 is open and ready, but GitHub reports `mergeStateStatus: UNSTABLE`.
- Branch is synced with upstream but diverged from `origin/main` by `2 14` from `origin/main...HEAD`.
- Live dogfood scan worked, but the dogfood DB had no accepted contract and enforcement/findings refused with `missing_contract`.

## Before Production

Production bar:

- Parser confidence must become a first-class gate across every flow/check/preflight output.
- External-repo fixture matrix needs to cover real repo shapes, not only generated fixtures.
- CLI/MCP parity must be shared by construction, not just tested after duplication.
- Release proof must be verified in CI with packaged artifacts and platform engines.
- Drift must keep claims machine-gated and docs-gated.
- Support/backup/audit behavior needs production-grade failure/recovery documentation and tests on upgraded databases.

## P0 Blockers

### P0.1 PR is not merge-stable

Impact: Cannot call the branch beta-ready while GitHub reports the PR as `UNSTABLE`.

Evidence:

- Live PR #76: `mergeStateStatus: "UNSTABLE"`.
- Branch vs `origin/main`: `2 14`, meaning it is 2 commits behind and 14 ahead.

Smallest practical fix:

- Fetch/rebase or merge current `origin/main`.
- Re-run full gate.
- Confirm PR merge state after push.

Likely files to change:

- Unknown until conflict/rebase; do not change docs/code blindly.

Test strategy:

- `pnpm verify:ci`
- `gh -R dadbodgeoff/drift pr view 76 --json mergeStateStatus,reviewDecision,statusCheckRollup`

Verification command:

```bash
git fetch --all --prune
git rev-list --left-right --count origin/main...HEAD
pnpm verify:ci
gh -R dadbodgeoff/drift pr view 76 --json mergeStateStatus,reviewDecision,statusCheckRollup
```

### P0.2 Dogfood docs are stale

Impact: Dogfood proof can mislead reviewers. The existing dogfood transcript is from branch `codex/drift-sprints-15-25`, commit `af3acb65e061366463d25f7c13974b58b3d522fa`, and reports 144 files/15,945 facts/672 diagnostics. The live run on this branch found 163 files/20,440 facts/46 diagnostics.

Evidence:

- Stale doc metadata in `docs/dogfood/drift-on-drift.md:3`.
- Live dogfood scan result from this audit: repo `repo_8e87fba3c58ea49b`, scan `scan_92765c857e709530`, 163 files, 20,440 facts, 46 diagnostics, 45 parser gaps.

Smallest practical fix:

- Replace or append the dogfood transcript with the current branch run.
- Include no-contract refusal as intentional behavior.
- Include parser gap breakdown.

Likely files to change:

- `docs/dogfood/drift-on-drift.md`
- Optional generated artifacts under an ignored dogfood output path.

Test strategy:

- Re-run dogfood scan from a clean branch.
- Verify scan status, repo map, prepare, audit verify, and no-contract findings refusal.

Verification command:

```bash
rm -rf /tmp/drift-v3-dogfood-audit
node packages/cli/dist/main.js scan --repo-root . --state-root /tmp/drift-v3-dogfood-audit --json
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/<repo_id>/drift.sqlite scan status --repo <repo_id> --json
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/<repo_id>/drift.sqlite repo map --repo <repo_id> --limit 10 --json
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/<repo_id>/drift.sqlite prepare "dogfood current branch" --repo <repo_id> --json
node packages/cli/dist/main.js --db /tmp/drift-v3-dogfood-audit/<repo_id>/drift.sqlite audit verify --repo <repo_id> --strict --json
```

### P0.3 Dogfood does not prove contract-backed enforcement on Drift itself

Impact: Drift can scan itself, but the dogfood DB has no accepted contract. Findings/checks correctly refuse with `missing_contract`, so dogfood proves metadata/preflight usefulness, not enforcement against Drift.

Evidence:

- Dogfood scan emitted `candidates_count: 0`.
- `findings list` returned `code: "missing_contract"` and `user_action: "Accept or import a repo contract before running contract-backed enforcement."`
- Existing dogfood doc already states no accepted Drift contract in `docs/dogfood/drift-on-drift.md:13`.

Smallest practical fix:

- Add a separate dogfood fixture or imported contract for one real Drift package boundary that is deterministic and safe.
- Keep no-contract dogfood as a separate proof of honest metadata/refusal behavior.

Likely files to change:

- `docs/dogfood/drift-on-drift.md`
- `test/fixtures/*` or a generated proof script if product wants an automated dogfood enforcement proof.
- Possibly `scripts/run-beta-proof.mjs` only if Drift-on-Drift becomes part of beta proof.

Test strategy:

- Scan Drift.
- Import/accept a deterministic contract.
- Run a good/bad synthetic change or fixture against Drift-style package boundary.
- Verify findings, waivers/baselines, CLI/MCP parity.

Verification command:

```bash
pnpm beta:proof
node packages/cli/dist/main.js --db <db> contract show --repo <repo_id> --json
node packages/cli/dist/main.js --db <db> check --repo <repo_id> --scope full --json
```

### P0.4 Parser gaps must gate confidence consistently

Impact: Live dogfood had 45 parser gaps. If prepare/check/repo-map claims do not carry this confidence consistently, agents can overtrust incomplete flow context.

Current beta status: `drift.parser_gap_quality.v1` is now a query-owned derived
read model surfaced through scan status, prepare/preflight, repo map, MCP parity,
and beta proof. Readiness is still scan-level; path-scoped parser-gap readiness
is not implemented in this slice.

Evidence:

- Dogfood scan status: 33 `unresolved_symbol`, 12 `unsupported_framework_pattern`.
- `prepare` confidence returned `graph_confidence: 0.82` with reason `parser_gaps_present`.
- MCP preflight showed completeness false with reason `resolver_dependencies_missing`.
- Parser gaps are persisted in `packages/storage/src/migrations.ts:540`.

Smallest practical fix:

- Create one shared confidence/readiness object in `@drift/query`.
- Use it in scan status, repo map, prepare, allowed context, MCP tools, and check output.
- Make blocking checks require relevant completeness, not only local code paths.

Likely files to change:

- `packages/query/src/index.ts`
- `packages/cli/src/domain/scan-status.ts`
- `packages/cli/src/commands/prepare.ts`
- `packages/cli/src/check/run-check.ts`
- `packages/mcp/src/index.ts`
- `packages/query/test/query.test.ts`
- `packages/cli/test/cli.test.ts`
- `packages/mcp/test/mcp.test.ts`

Test strategy:

- Fixture with unresolved import lowering flow confidence.
- Fixture where complete graph allows blocking.
- Fixture where missing capability produces advisory/refusal, not false blocking.

Verification command:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
pnpm verify:ci
```

## P1 Production Hardening

### P1.1 Move CLI/MCP parity from tested duplication to shared builders

Impact: Beta proof catches drift after the fact, but production should reduce duplicate read-model assembly. Transport code should wrap shared query/core builders.

Evidence:

- Boundary rules say MCP must not import CLI in `packages/cli/scripts/check-boundaries.mjs:131`.
- MCP tools are implemented in `packages/mcp/src/index.ts`; CLI has separate command builders.
- Canonical docs already say MCP logic should live in shared query/domain code in `docs/architecture/canonical-contracts.md:57`.

Smallest practical fix:

- Extract shared response builders for scan status, repo map, preflight, findings, contract, audit, and allowed context into `@drift/query` or `@drift/core` domain modules.
- CLI and MCP should only parse args/JSON-RPC and call those builders.

Likely files to change:

- `packages/query/src/*`
- `packages/core/src/*`
- `packages/cli/src/commands/*`
- `packages/mcp/src/index.ts`
- parity tests in `packages/cli/test` and `packages/mcp/test`

Test strategy:

- Snapshot or structural parity tests for CLI/MCP surfaces.
- Boundary check must still pass.
- Beta proof parity hash must remain stable or intentionally versioned.

Verification command:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
pnpm check:boundaries
pnpm beta:proof
```

### P1.2 Improve TS parser semantic coverage without overclaiming

Impact: Static syntax extraction is useful but brittle for real TS repos. Data access, callsites, and route flows need better resolution before production.

Evidence:

- AST walk only handles `import_statement`, `call_expression`, and `export_statement` in `crates/drift-engine/src/facts.rs:101`.
- Data access is receiver/path/name heuristic in `crates/drift-engine/src/facts.rs:422`.
- Live dogfood has unresolved symbol gaps.

Smallest practical fix:

- Add parser fixtures for dynamic import, require, namespace member calls, re-export chains, computed routes, server actions, and common ORM clients.
- Add explicit unsupported diagnostics where support is not intended.
- Improve namespace/member resolution before claiming broad call graph support.

Likely files to change:

- `crates/drift-engine/src/facts.rs`
- `crates/drift-engine/src/main.rs`
- `crates/drift-engine/tests/typescript_facts.rs`
- `crates/drift-engine/tests/stream_graph.rs`
- `test/e2e/fixture-matrix.test.ts`

Test strategy:

- Test each supported TS construct as a fixture.
- Add negative tests that emit parser gaps instead of false confidence.

Verification command:

```bash
cargo test -p drift-engine --test typescript_facts -- --nocapture
cargo test -p drift-engine --test stream_graph -- --nocapture
pnpm test:e2e
```

### P1.3 Make change impact real enough for production decisions

Impact: Current change impact is advisory. It cannot support strong claims about affected symbols or tests.

Evidence:

- `changed_symbols` is always `[]` in `packages/query/src/change-impact.ts:40`.
- Affected tests are path/slug based in `packages/query/src/change-impact.ts:31`.

Smallest practical fix:

- Populate changed symbols from symbol identities and graph evidence.
- Use resolver dependencies and module dependents for direct/transitive impact.
- Attach parser-gap/completeness confidence to each affected item.

Likely files to change:

- `packages/query/src/change-impact.ts`
- `packages/query/src/index.ts`
- `packages/storage/src/sqlite-storage.ts`
- `packages/query/test/query.test.ts`
- `packages/cli/test/cli.test.ts`

Test strategy:

- Fixture: changed exported helper affects importing route/service/test.
- Fixture: unresolved import lowers confidence.
- Fixture: changed test is recognized separately from changed production file.

Verification command:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/cli test -- --runInBand
```

### P1.4 Expand external repo fixture matrix

Impact: Generated beta fixture proves the narrow loop, but production needs external shape confidence.

Evidence:

- Beta proof fixture is generated by `scripts/run-beta-proof.mjs`.
- Existing e2e fixture matrix covers useful cases, but dogfood still has parser gaps and no accepted contract.

Smallest practical fix:

- Add durable fixture repos for Next app router, Next pages router, package workspace, pure library, mixed JS/TS, no API route, and non-standard aliases.
- Record expected facts, graph counts, parser gaps, and check behavior.

Likely files to change:

- `test/fixtures/*`
- `test/e2e/fixture-matrix.test.ts`
- `scripts/run-beta-proof.mjs` if fixtures become proof inputs.

Test strategy:

- Golden fixture outputs for scan status, repo map, route flow, parser gaps, check pass/fail.

Verification command:

```bash
pnpm test:e2e
pnpm beta:proof
```

### P1.5 Strengthen product-claim validation across docs

Impact: `validate:claims` validates known claims, but docs can still drift into broader language unless the scan is comprehensive.

Evidence:

- Runtime blocked claims are explicit in `packages/core/src/capabilities.ts:122`.
- Machine-readable claims are in `docs/architecture/beta-claims.json:12`.
- `validate:claims` passed, but the audit still found stale dogfood docs.

Smallest practical fix:

- Extend claims validation to all architecture, dogfood, README, specs, and release docs.
- Fail on stale dogfood branch/commit metadata unless explicitly marked historical.
- Add "verified on" metadata to dogfood docs.

Likely files to change:

- `scripts/validate-product-claims.mjs`
- `docs/architecture/beta-claims.json`
- docs under `docs/architecture` and `docs/dogfood`

Test strategy:

- Unit fixtures for allowed/blocked doc phrases.
- CI validation over all docs.

Verification command:

```bash
pnpm validate:claims
pnpm verify:ci
```

### P1.6 Prove packaged engine release on real platform artifacts

Impact: Local `verify:ci` validates release matrix and package pack tests, but production release needs artifact completeness from release workflow.

Evidence:

- Local gate printed `Validated 5 engine release targets for Drift 0.1.0.`
- E2E package-pack tests passed.
- Canonical docs state final release proof after tarballs/checksums in `docs/architecture/canonical-contracts.md:31`.

Smallest practical fix:

- Keep release proof as final CI job after npm tarballs and engine checksum artifacts exist.
- Publish proof artifact with engine package names, checksums, platform matrix, and beta proof reference.

Likely files to change:

- `.github/workflows/*`
- `scripts/generate-release-proof.mjs`
- `scripts/validate-engine-release-matrix.mjs`
- package metadata under `packages/engine-*`

Test strategy:

- Local release proof with fixture beta proof.
- CI release proof on all platform packages.

Verification command:

```bash
pnpm validate:release-matrix
pnpm release:proof -- --beta-proof-file <generated-beta-proof.json> --require-beta-proof
```

## P2 Scale and Generalization

### P2.1 Configurable role ontology

Impact: Current role detection works for common and Drift-specific paths, but production users need repo-specific layers without code changes.

Evidence:

- Role detection is hard-coded in `crates/drift-engine/src/facts.rs:531`.
- Drift-specific roles include CLI/core/query/factgraph/storage/MCP paths in `crates/drift-engine/src/facts.rs:612`.

Smallest practical fix:

- Add repo-contract role rules with evidence source metadata.
- Keep built-in defaults, but let user-defined roles override/extend.

Likely files to change:

- `packages/core/src/domain.ts`
- `crates/drift-engine/src/facts.rs` or query-side role derivation
- `packages/cli/src/commands/contract.ts`
- `packages/query/src/repo-topology.ts`

Test strategy:

- Fixture with custom paths.
- Contract import validation for role rules.
- Repo map shows role source.

Verification command:

```bash
pnpm --filter @drift/core test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
```

### P2.2 Incremental scan reuse

Impact: Large repos will pay full-scan cost until reuse is real.

Evidence:

- Historical dogfood scan reported `reuse_applied: false` because it had no previous scan.
- Follow-up implementation reuses unchanged file facts when resolver/package inputs match and still rebuilds graph projections for the current scan.
- Runtime claims now allow only this limited incremental reuse shape.

Smallest practical fix:

- Reuse unchanged file facts/graph projections by content hash and resolver input fingerprint.
- Invalidate dependents on resolver/package config changes.
- Keep full-scan fallback.

Likely files to change:

- `packages/cli/src/domain/scan-status.ts`
- `packages/storage/src/sqlite-storage.ts`
- `crates/drift-engine/src/main.rs`
- storage migrations if reuse metadata needs new tables

Test strategy:

- Two-scan fixture with unchanged files reused.
- Resolver input change invalidates reuse.
- Deleted/renamed file behavior.

Verification command:

```bash
pnpm --filter @drift/storage test
pnpm --filter @drift/cli test
pnpm test:e2e
```

### P2.3 Broader framework adapters

Impact: Current route intelligence is mostly Next-style. Production adoption needs adapters for Express/Fastify/Nest/Remix/etc. only when proven.

Evidence:

- Runtime supported wedge is TypeScript/JavaScript route layering, not broad framework support.
- Parser gaps include unsupported framework patterns in dogfood.

Smallest practical fix:

- Add adapter contract for framework-specific entrypoint extraction.
- Add one framework at a time with tests and capability flags.

Likely files to change:

- `crates/drift-engine/src/facts.rs`
- `packages/adapters/src/*`
- `packages/core/src/capabilities.ts`
- `test/fixtures/*`

Test strategy:

- One fixture per framework.
- Capability output only claims supported adapters after proof.

Verification command:

```bash
cargo test -p drift-engine
pnpm test:e2e
pnpm validate:claims
```

### P2.4 Production support surfaces

Impact: Users will need clear recovery and support paths for local SQLite state, backups, restore, and audit failures.

Evidence:

- Audit/backup/restore are implemented and tested, but support bundle is not the core beta proof.
- Local DB/backups contain sensitive repo metadata.

Smallest practical fix:

- Add support-bundle redaction tests for facts/graph/audit.
- Add upgrade/restore failure runbook.
- Add doctor checks for stale proofs, broken audit chain, missing engine package, unsupported schema.

Likely files to change:

- `packages/cli/src/commands/doctor.ts`
- `packages/cli/src/commands/support.ts`
- `packages/storage/src/sqlite-storage.ts`
- docs under `docs/architecture`

Test strategy:

- Broken DB/audit/backup fixtures.
- Redaction snapshots.

Verification command:

```bash
pnpm --filter @drift/cli test
pnpm verify:ci
```

## Deferred / Non-Goals

These remain out of current beta and should stay blocked in claims until implemented and proven:

- Cloud sync.
- Desktop UI.
- Python adapter.
- Broad language support.
- Mutation-capable MCP.
- General AI code review.
- Broad fuzzy duplicate-helper detection.
- Full semantic TypeScript type analysis.
- Remote audit notarization.
- Org-level policy management.

## Where Docs Overclaim or Can Drift

Current docs are mostly disciplined, but risk remains:

- `docs/dogfood/drift-on-drift.md` is historical and stale unless labeled as such.
- Contract parity ledger reports many complete contracts, but public product language must still stay tied to the narrow runtime `supported_wedge`.
- Any phrase implying broad codebase intelligence should be tied to TypeScript/JavaScript route-layering evidence or removed.
- Any phrase implying incremental scanning should say "incremental change reporting" unless reuse is implemented.

Verification command:

```bash
pnpm validate:claims
rg -n "broad|general|all TypeScript|incremental|cloud|desktop|Python|AI code review|semantic" docs README.md packages
```

## Where Dogfood Proves the Product

Dogfood proves:

- Drift can scan its own repo with the Rust engine.
- It can persist 163 files and 20,440 facts.
- It surfaces parser gaps honestly, with derived parser-gap quality/user action on beta surfaces.
- It builds repo map/topology.
- It prepares a no-contract local packet.
- It verifies audit integrity.
- CLI/MCP read-only scan status works.

Dogfood does not prove:

- Accepted-contract enforcement against Drift itself.
- Broad parser completeness.
- Production-scale performance.
- Full package architecture understanding.
- Release artifact completeness.

## Final Hard Truth

The engineering spine is real: Rust engine, SQLite state, graph projections, query read models, CLI/MCP surfaces, governance, checks, audit, and beta proof all exist and pass the current gate.

The product must stay narrow. The current defensible beta is not "Drift understands your codebase." It is "Drift can locally scan a TS/JS repo, build enough graph-backed evidence for a narrow route-layering contract, brief agents read-only, and block accepted direct-data-access drift with proof."
