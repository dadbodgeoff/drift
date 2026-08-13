# Beta Intelligence Gate

This gate defines what Drift must prove before it is positioned as a beta-ready
repo intelligence product. It is intentionally stricter than "the CLI runs"
because Drift is selling trust to humans and agents.

## Current Beta Claim

Drift can claim this today:

> Drift is a local-first TypeScript/JavaScript repo intelligence guardrail for
> API and server-side layering conventions. It scans a repo, stores local state,
> builds graph-backed evidence, exposes read-only agent context, and checks
> accepted deterministic conventions with baseline and policy controls.

Drift must not yet claim:

- Broad language intelligence.
- General duplicate-code detection.
- Cloud sync.
- Full desktop workflow.
- Complete semantic understanding of arbitrary JavaScript or TypeScript.
- Source-code mutation.

## Required Gate Before Public Beta

Every beta candidate must pass these checks from the repository root:

```bash
pnpm verify:ci
```

The gate includes:

- TypeScript package builds.
- TypeScript type checks.
- Unit tests.
- End-to-end fixture tests.
- Rust formatting check.
- Rust clippy with warnings denied.
- Architectural boundary checks.
- Git whitespace checks.

The beta candidate must also have a fresh dogfood transcript:

```bash
docs/dogfood/drift-on-drift.md
```

The transcript must include scan, repo map, prepare, ask, check, MCP, audit, and
backup results against Drift itself.

## Intelligence Requirements

Before public beta, Drift must prove the V1 wedge end to end:

- API route direct data-access violations are detected with graph-backed
  evidence.
- Route -> service -> data-access flow is represented without being treated as
  a route-level direct data-access violation.
- Relative imports, path aliases, index files, workspace package imports,
  re-exports, default exports, namespace imports, and mixed JS/TS files are
  covered by fixtures.
- Findings include stable fingerprints.
- Baseline violations do not block unless they are new or touched.
- Exceptions can target paths, imports, resolved modules, resolved symbols,
  endpoints, methods, data stores, and operation kinds.
- Candidate inference is capability-gated and does not overstate confidence.
- Blocking enforcement is allowed only when parser completeness permits it.

## Agent Context Requirements

Every agent-facing response must include an `agent_envelope` or equivalent
policy metadata that lets an agent decide whether it can proceed.

Required states:

- `safe_to_edit`
- `run_scan_first`
- `blocked_by_policy`
- `blocked_by_stale_graph`
- `context_truncated`

Agent-facing surfaces must remain read-only for V1:

- CLI `prepare`
- CLI `ask`
- CLI `repo map`
- CLI `findings`
- MCP `get_task_preflight`
- MCP `get_repo_map`
- MCP `get_findings`

MCP must not accept, reject, edit, suppress, import, export, or otherwise mutate
governance state in V1.

## Policy And Egress Requirements

Public beta must fail closed on context export:

- No source snippets are emitted by default.
- Secret-like paths and denied globs are excluded.
- Long context is truncated with visible metadata.
- CLI and MCP policy behavior stay equivalent for matching surfaces.
- Export-like commands require explicit human intent.

Every outward surface must make it clear whether graph context was included,
whether source content was included, and whether context was truncated.

## Storage And Governance Requirements

Drift state must remain local-first:

- SQLite stores scan, fact, graph, convention, finding, baseline, audit, and
  backup metadata.
- Graph output is stored as versioned artifacts plus query projections.
- Backups include Drift state, not source code.
- Restore validates repo identity and marks graph/index state stale when source
  files differ.
- Audit events are append-only for governance actions.

## Performance Requirements

Before public beta, Drift must demonstrate bounded behavior:

- Large synthetic repo fixture stays within the CI scan budget.
- File and fact limits are visible in scan stats.
- Truncation is explicit, not silent.
- Generated, vendored, binary, secret-like, and ignored files are skipped with
  diagnostics.
- Rust owns parser and deterministic rule authority.

## Blocking Gaps

These gaps should be closed before opening a broad beta:

- MCP `get_task_preflight` should match CLI `prepare` behavior when no contract
  exists, or the difference must be documented as intentional.
- Dogfood diagnostics need grouping so noisy unresolved imports are actionable.
- Repo/package role detection needs stronger coverage for Drift's own CLI,
  storage, MCP, core, query, and engine packages.
- Installed package release needs the full platform engine binary publishing
  flow exercised from CI artifacts before npm beta.

## Deferred After Beta

These are valuable but should not block the V1 beta wedge:

- Python and additional language adapters.
- Desktop review UI.
- Cloud or team sync.
- Duplicate-helper detection.
- Source mutation.
- Write-capable MCP tools.
- Broad semantic retrieval beyond deterministic graph context.

## Go/No-Go Checklist

Use this checklist before every beta tag:

- [ ] `pnpm verify:ci` passes locally.
- [ ] CI passes `pnpm verify:ci`.
- [ ] `docs/dogfood/drift-on-drift.md` is fresh for the release commit.
- [ ] `drift capabilities --json` matches documented V1 surfaces.
- [ ] Engine package install smoke passes without `DRIFT_ENGINE_BIN` on the
      target platform.
- [ ] Policy redaction tests cover CLI and MCP agent surfaces.
- [ ] Fixture matrix covers the V1 import-resolution and route-flow wedge:
      direct route-to-data-access, clean service delegation, no-Prisma
      fetch/service shape, non-Next graceful scan, and adapter manifest fixture
      IDs resolving to committed fixtures.
- [ ] Parser-gap quality is visible in CLI/MCP scan status, preflight, repo map,
      and beta proof as `parser_gap_quality_verified`.
- [ ] Large synthetic repo scale gate passes.
- [ ] No read-only MCP tool mutates governance state.
- [ ] Known blockers above are either fixed or explicitly called out in release
      notes.
