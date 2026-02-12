# MCP Tools Inventory

## Location
`packages/mcp/src/tools/` — 10 subdirectories, ~87 tool files

## Quick Reference

For the complete tool reference with files, handlers, token costs, and dual-path details, see [tools-by-category.md](./tools-by-category.md).

## Tool Count by Category

| Category | Directory | Tools | Key Tools |
|----------|-----------|-------|-----------|
| Orchestration | `orchestration/` | 2 | `drift_context`, `drift_package_context` |
| Discovery | `discovery/` | 3 | `drift_status`, `drift_capabilities`, `drift_projects` |
| Setup | `setup/` | 2 | `drift_setup`, `drift_telemetry` |
| Curation | `curation/` | 1 | `drift_curate` (6 actions) |
| Surgical | `surgical/` | 12 | `drift_callers`, `drift_signature`, `drift_type`, `drift_imports`, ... |
| Exploration | `exploration/` | 5 | `drift_patterns_list`, `drift_security_summary`, `drift_contracts_list`, ... |
| Detail | `detail/` | 8 | `drift_pattern_get`, `drift_code_examples`, `drift_impact_analysis`, ... |
| Analysis | `analysis/` | 18 | `drift_coupling`, `drift_test_topology`, `drift_quality_gate`, + 8 language tools |
| Generation | `generation/` | 3 | `drift_explain`, `drift_validate_change`, `drift_suggest_changes` |
| Memory | `memory/` | 33 | `drift_why`, `drift_memory_add`, `drift_memory_search`, ... |

**Total: ~87 tools** (some tools like `drift_curate` have multiple actions via parameters)

## Tool Registration Order
Registration order in `tools/registry.ts` matters for AI discovery:
1. Orchestration (recommended starting point)
2. Discovery (quick health checks)
3. Setup (project initialization)
4. Curation (pattern approval with verification)
5. Surgical (ultra-focused lookups)
6. Exploration (browsing/listing)
7. Detail (deep inspection)
8. Analysis (heavy analysis)
9. Generation (AI-powered)
10. Memory (Cortex V2)

## File Map

### `tools/orchestration/`
- `context.ts` — `drift_context` handler
- `package-context.ts` — `drift_package_context` handler
- `index.ts` — Tool definitions + exports

### `tools/discovery/`
- `status.ts` — `drift_status` + `handleStatusWithService` (dual-path)
- `capabilities.ts` — `drift_capabilities` handler
- `projects.ts` — `drift_projects` handler
- `index.ts` — Tool definitions + exports

### `tools/setup/`
- `handler.ts` — `drift_setup` handler
- `telemetry-handler.ts` — `drift_telemetry` handler
- `index.ts` — Tool definitions + exports

### `tools/curation/`
- `handler.ts` — `handleCurate()` with 6 actions
- `verifier.ts` — Anti-hallucination evidence verification
- `types.ts` — CurationEvidence, VerificationResult
- `audit-store.ts` — Audit persistence
- `index.ts` — Tool definition + exports

### `tools/surgical/`
- `callers.ts`, `signature.ts`, `type.ts`, `imports.ts` — Call graph lookups
- `prevalidate.ts` — Pre-write validation (dual-path)
- `similar.ts` — Similar code finder
- `recent.ts` — Recent changes
- `dependencies.ts` — Package dependency check
- `test-template.ts` — Test template generation
- `middleware.ts`, `hooks.ts`, `errors.ts` — Framework pattern lookups
- `index.ts` — Tool definitions + exports

### `tools/exploration/`
- `patterns-list.ts` — Pattern listing (dual-path)
- `security-summary.ts` — Security overview (dual-path)
- `contracts-list.ts` — Contract listing (dual-path)
- `env.ts` — Environment variables (dual-path)
- `trends.ts` — Pattern trends
- `index.ts` — Tool definitions + exports

### `tools/detail/`
- `pattern-get.ts` — Full pattern details (dual-path)
- `code-examples.ts` — Code snippets (dual-path)
- `files-list.ts` — File listing
- `file-patterns.ts` — Patterns in a file
- `impact-analysis.ts` — Change blast radius
- `reachability.ts` — Data flow reachability
- `dna-profile.ts` — Styling DNA (dual-path)
- `wrappers.ts` — Wrapper detection
- `index.ts` — Tool definitions + exports

### `tools/analysis/`
- `coupling.ts`, `test-topology.ts`, `error-handling.ts` — Core analysis
- `quality-gate.ts` — Quality gate execution
- `constants.ts`, `constraints.ts` — Data analysis (constraints has dual-path)
- `audit.ts`, `decisions.ts`, `simulate.ts` — Advanced analysis
- `typescript.ts`, `python.ts`, `java.ts`, `php.ts`, `go.ts`, `rust.ts`, `cpp.ts`, `wpf.ts` — Language-specific
- `index.ts` — Tool definitions + exports

### `tools/generation/`
- `explain.ts` — Comprehensive code explanation
- `validate-change.ts` — Change validation
- `suggest-changes.ts` — Change suggestions
- `index.ts` — Tool definitions + exports
- `__tests__/` — Generation tool tests

### `tools/memory/` (33 files)
- `status.ts`, `add.ts`, `get.ts`, `update.ts`, `delete.ts`, `search.ts`, `query.ts` — Core CRUD
- `why.ts`, `for-context.ts`, `explain.ts` — Context & retrieval
- `learn.ts`, `feedback.ts` — Learning
- `validate.ts`, `consolidate.ts`, `health.ts`, `predict.ts`, `conflicts.ts`, `contradictions.ts`, `warnings.ts`, `suggest.ts` — Validation & health
- `graph.ts` — Visualization
- `export.ts`, `import.ts` — Import/export
- `agent-spawn.ts`, `entity.ts`, `goal.ts`, `workflow.ts`, `incident.ts`, `meeting.ts`, `skill.ts`, `conversation.ts`, `environment.ts` — Specialized memory types
- `index.ts` — Tool definitions + exports

### Supporting Files
- `tools/registry.ts` — `ALL_TOOLS`, `TOOL_CATEGORIES`, `getTool()`, `hasTool()`
- `tools/index.ts` — Barrel exports

## Dual-Path Tools Summary

Tools with both legacy (JSON) and new (SQLite) implementations:

| Tool | Legacy Store | New Store |
|------|-------------|-----------|
| `drift_status` | PatternStore | IPatternService |
| `drift_patterns_list` | PatternStore | IPatternService |
| `drift_pattern_get` | PatternStore | IPatternService |
| `drift_code_examples` | PatternStore | IPatternService |
| `drift_prevalidate` | PatternStore | IPatternService |
| `drift_security_summary` | BoundaryStore | UnifiedStore |
| `drift_contracts_list` | ContractStore | UnifiedStore |
| `drift_env` | EnvStore | UnifiedStore |
| `drift_dna_profile` | DNAStore | UnifiedStore |
| `drift_constraints` | File-based | UnifiedStore |

In v2, the legacy path is removed — all tools use SQLite via Rust NAPI.
