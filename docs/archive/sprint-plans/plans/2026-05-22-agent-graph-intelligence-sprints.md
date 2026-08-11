# Agent Graph Intelligence Sprint Plan

> **For agentic workers:** keep Drift local-first, deterministic, graph-backed, and policy-governed. Do not add remote inference, fuzzy blocking rules, or UI work in this sprint batch.

**Goal:** deepen Drift's agent-facing intelligence without expanding product surface area. The CLI/MCP shell is already broad enough; this batch improves first-run guidance, graph-backed preflight, role detection, resolver coverage, and incremental scan state.

**Architecture:** TypeScript owns CLI orchestration, persistence, policy, and display. Rust owns parsing, resolver facts, graph evidence, and deterministic scan output. SQLite remains the source of truth for saved state; no loose JSON-file state.

**Tech Stack:** Rust tree-sitter engine, TypeScript CLI packages, SQLite storage package, FactGraph projection package, query package, pnpm/vitest, cargo tests.

## Sprint 1: No-Contract Agent UX

Problem: `drift prepare` and `drift ask` currently require a materialized repo contract. That is safe, but hostile during hello-world setup after `start` or `scan` but before accepted conventions.

Build:
- Let `prepare` and `ask` run with the default local-only policy when no contract exists.
- Return explicit `contract.ready = false` metadata.
- Return candidate counts, scan status, safe next commands, and relevant file hints.
- Never invent accepted conventions from candidates.
- Keep governance read-only and policy-authorized.

Tests:
- Fresh repo with scan but no contract: `prepare --json` exits 0 and returns no accepted conventions.
- Fresh repo with scan but no contract: `ask --json` exits 0 and points user to convention review.
- Existing contract-backed outputs stay compatible.

## Sprint 2: Graph-Backed Prepare Context

Problem: preflight currently relies mostly on contract scopes and path token matching. Agents need graph evidence for route/service/data-access work.

Build:
- Add a CLI domain helper that queries the latest scan graph.
- Include route flow for API route target paths.
- Include reachable data-access modules for route targets.
- Include affected files for target paths and relevant files.
- Include graph completeness/diagnostics so agents know when graph context is partial.
- Keep snippets out of preflight; metadata only.

Tests:
- `prepare --path app/api/users/route.ts --json` includes route flow and reachable data-access modules when graph projections exist.
- No graph artifact returns an explicit unavailable/diagnostic object, not a crash.

## Sprint 3: Package And Module Role Detection

Problem: Drift detects API/service/data-access roles, but not Drift-scale package roles. Repo maps and preflight are less useful on real tool repos.

Build:
- Extend typed file roles for CLI command modules, storage modules, engine bridge modules, MCP modules, tests, config, docs, and package manifests.
- Emit role facts from Rust where paths are scanned.
- Keep role detection path-based and explainable.
- Do not use natural-language inference.

Tests:
- Rust fact extraction emits expected roles for CLI, storage, engine bridge, MCP, tests, config-like paths where supported.
- FactGraph maps roles into `FILE_HAS_ROLE` edges.
- TypeScript schemas accept the new role values.

## Sprint 4: Import Resolution Phase 2

Problem: resolver quality gates the whole product. Missing tsconfig inheritance and harder workspace/export patterns create false negatives.

Build:
- Support `tsconfig.json` / `jsconfig.json` `extends` chains for baseUrl and paths.
- Preserve child config overrides over parent config.
- Keep package export map handling deterministic, including object/condition targets.
- Add diagnostics for unresolved local aliases and workspace imports.
- Keep resolver dependencies explainable.

Tests:
- Alias from extended config resolves.
- Child `paths` override parent paths.
- Workspace package export target resolves through package exports.
- Unresolved local alias emits diagnostic instead of silently disappearing.

## Sprint 5: Incremental Scan Foundation

Problem: large-repo credibility requires persisted change tracking before full incremental reuse. Scan status needs durable changed-file state, not only live comparison.

Build:
- Add SQLite migration for scan file changes.
- Persist added/modified/deleted/unchanged summaries per scan by comparing the previous scan snapshots.
- Expose changed-file counts in scan output/status.
- Record invalidation reasons for scanner/adapter/rule/resolver version changes.
- Do not skip parsing yet unless correctness is proven; this sprint stores the foundation.

Tests:
- First scan records files as added.
- Second unchanged scan records unchanged files.
- Modified/deleted files are classified correctly.
- Migration test covers the new table.

## Verification

Required commands before completion:

```bash
pnpm --filter @drift/cli test -- --runInBand
pnpm --filter @drift/query test
pnpm --filter @drift/storage test
cargo test -p drift-engine
pnpm verify:ci
```

Completion standard:
- All sprint tests pass.
- `pnpm verify:ci` passes.
- Outputs remain local-first and policy-filtered.
- No MCP mutation surface is added.
- No UI or cloud work is added.
