# MCP Tools — Complete Reference by Category

## Location
`packages/mcp/src/tools/` — 10 subdirectories, ~87 tool files

## Tool Registration
All tools are defined in category-specific `index.ts` files, aggregated in `tools/registry.ts`, and registered in `enterprise-server.ts`. Registration order matters for AI discovery (orchestration first, memory last).

---

## Orchestration (2 tools) — `tools/orchestration/`

The most important tools. Start here for any task.

| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_context` | `context.ts` | Curated context for any task (meta-tool) | ~1000-3000 |
| `drift_package_context` | `package-context.ts` | Monorepo package-specific context | ~1000-3000 |

`drift_context` is the "one call to rule them all" — it queries patterns, call graph, boundaries, DNA, and Cortex, then synthesizes a curated response for the given intent and focus area. One call replaces 3-5 discovery calls.

Parameters: `intent` (add_feature, fix_bug, refactor, security_audit, understand_code, add_test), `focus` (area of interest), `activeFile`, `maxTokens`.

---

## Discovery (3 tools) — `tools/discovery/`

Quick health checks and capability listing.

| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_status` | `status.ts` | Health snapshot (patterns, violations, storage) | ~200 |
| `drift_capabilities` | `capabilities.ts` | Full tool listing with descriptions | ~7000 |
| `drift_projects` | `projects.ts` | Multi-project management (list, switch, add, remove) | ~300 |

`drift_status` has dual-path: uses `IPatternService` if available, falls back to `PatternStore`.

---

## Setup (2 tools) — `tools/setup/`

Project initialization via MCP (alternative to CLI `drift setup`).

| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_setup` | `handler.ts` | Initialize Drift in a project | ~500-1000 |
| `drift_telemetry` | `telemetry-handler.ts` | Telemetry status/enable/disable | ~200 |

`drift_setup` has special project resolution: the `project` parameter is treated as a PATH (not a registry name), with path traversal security checks.

---

## Curation (1 tool) — `tools/curation/`

Pattern approval with anti-hallucination verification.

| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_curate` | `handler.ts` | Review, verify, approve, ignore, bulk-approve patterns | ~500-2000 |

### Subcommands (via `action` parameter)
- `review` — Get pattern details with evidence requirements
- `verify` — Verify AI-claimed evidence against actual code
- `approve` — Approve pattern (requires verification first)
- `ignore` — Ignore pattern
- `bulk_approve` — Approve multiple patterns at once
- `audit` — Run pattern audit

### Anti-Hallucination Verification (`verifier.ts`)
Before approving a pattern, the verifier:
1. Reads actual files claimed as evidence
2. Checks if pattern locations exist in those files
3. Verifies code snippets appear in the actual content
4. Calculates verification score (verified / total checks)
5. Requires minimum score (≥80% for "verified", ≥50% for "partial")

Evidence requirements scale with confidence:
- High confidence: 1 verified file, no snippet required
- Medium confidence: 2 verified files, snippets required
- Low/uncertain: 3+ verified files, snippets required, detailed reasoning

Supporting files: `types.ts` (CurationEvidence, VerificationResult), `audit-store.ts` (audit persistence).

---

## Surgical (12 tools) — `tools/surgical/`

Ultra-focused, minimal-token lookups for code generation. These are the most frequently called tools.

| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_signature` | `signature.ts` | Function/class signature lookup | ~100-300 |
| `drift_callers` | `callers.ts` | Who calls this function | ~200-500 |
| `drift_type` | `type.ts` | Type definition expansion | ~200-500 |
| `drift_imports` | `imports.ts` | Import resolution for a symbol | ~100-200 |
| `drift_prevalidate` | `prevalidate.ts` | Quick pre-write validation | ~300-800 |
| `drift_similar` | `similar.ts` | Find similar code patterns | ~500-1500 |
| `drift_recent` | `recent.ts` | Recent changes in an area | ~300-600 |
| `drift_dependencies` | `dependencies.ts` | Check installed packages | ~200-400 |
| `drift_test_template` | `test-template.ts` | Generate test template | ~500-1000 |
| `drift_middleware` | `middleware.ts` | Middleware chain analysis | ~300-600 |
| `drift_hooks` | `hooks.ts` | Hook/lifecycle detection | ~300-600 |
| `drift_errors` | `errors.ts` | Error pattern lookup | ~300-600 |

`drift_prevalidate` has dual-path (PatternService vs PatternStore).

---

## Exploration (5 tools) — `tools/exploration/`

Filtered browsing and listing with pagination.

| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_patterns_list` | `patterns-list.ts` | List patterns with filters | ~500-1500 |
| `drift_security_summary` | `security-summary.ts` | Security posture overview | ~800-2000 |
| `drift_contracts_list` | `contracts-list.ts` | API contracts listing | ~500-1500 |
| `drift_env` | `env.ts` | Environment variable analysis | ~500-1500 |
| `drift_trends` | `trends.ts` | Pattern trends over time | ~500-1500 |

All except `drift_trends` have dual-path (UnifiedStore/PatternService vs legacy stores).

---

## Detail (8 tools) — `tools/detail/`

Deep inspection of specific items. Higher token cost.

| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_pattern_get` | `pattern-get.ts` | Full pattern details | ~1000-3000 |
| `drift_code_examples` | `code-examples.ts` | Real code snippets from patterns | ~2000-5000 |
| `drift_files_list` | `files-list.ts` | List files with pattern info | ~500-1500 |
| `drift_file_patterns` | `file-patterns.ts` | All patterns in a specific file | ~1000-2500 |
| `drift_impact_analysis` | `impact-analysis.ts` | Change blast radius | ~1000-3000 |
| `drift_reachability` | `reachability.ts` | Data flow reachability | ~1000-3000 |
| `drift_dna_profile` | `dna-profile.ts` | Styling DNA profile | ~800-2000 |
| `drift_wrappers` | `wrappers.ts` | Framework wrapper detection | ~500-1500 |

`drift_pattern_get`, `drift_code_examples` have dual-path. `drift_dna_profile` prefers UnifiedStore.

---

## Analysis (18 tools) — `tools/analysis/`

Heavy analysis operations. Includes 8 language-specific tools.

### Core Analysis
| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_coupling` | `coupling.ts` | Module coupling analysis | ~1000-2500 |
| `drift_test_topology` | `test-topology.ts` | Test coverage analysis | ~1000-2500 |
| `drift_error_handling` | `error-handling.ts` | Error handling gaps | ~800-2000 |
| `drift_quality_gate` | `quality-gate.ts` | Quality gate checks | ~1500-4000 |
| `drift_constants` | `constants.ts` | Constants/secrets analysis | ~800-2000 |
| `drift_constraints` | `constraints.ts` | Constraint verification | ~800-2000 |
| `drift_audit` | `audit.ts` | Full pattern audit | ~1000-3000 |
| `drift_decisions` | `decisions.ts` | Decision mining | ~800-2000 |
| `drift_simulate` | `simulate.ts` | Speculative execution | ~2000-5000 |

`drift_constraints` has dual-path (UnifiedStore vs file-based).

### Language-Specific
| Tool | File | Language |
|------|------|----------|
| `drift_typescript` | `typescript.ts` | TypeScript/JavaScript |
| `drift_python` | `python.ts` | Python |
| `drift_java` | `java.ts` | Java |
| `drift_php` | `php.ts` | PHP |
| `drift_go` | `go.ts` | Go |
| `drift_rust` | `rust.ts` | Rust |
| `drift_cpp` | `cpp.ts` | C++ |
| `drift_wpf` | `wpf.ts` | WPF/XAML |

Language tools are only exposed if the language is detected in the project (via tool filter).

---

## Generation (3 tools) — `tools/generation/`

AI-powered code intelligence.

| Tool | File | Purpose | Token Cost |
|------|------|---------|------------|
| `drift_explain` | `explain.ts` | Comprehensive code explanation | ~2000-5000 |
| `drift_validate_change` | `validate-change.ts` | Validate code against patterns | ~1000-3000 |
| `drift_suggest_changes` | `suggest-changes.ts` | Suggest pattern-aligned changes | ~1000-3000 |

`drift_explain` receives pattern, manifest, boundary, and call graph stores for comprehensive analysis.

---

## Memory (33 tools) — `tools/memory/`

Full Cortex V2 memory system access. See [06-cortex/mcp-tools.md](../06-cortex/mcp-tools.md) for detailed documentation.

### Core Operations (7)
`drift_memory_status`, `drift_memory_add`, `drift_memory_get`, `drift_memory_update`, `drift_memory_delete`, `drift_memory_search`, `drift_memory_query`

### Context & Retrieval (3)
`drift_why`, `drift_memory_for_context`, `drift_memory_explain`

### Learning & Feedback (2)
`drift_memory_learn`, `drift_memory_feedback`

### Validation & Health (7)
`drift_memory_validate`, `drift_memory_consolidate`, `drift_memory_health`, `drift_memory_predict`, `drift_memory_conflicts`, `drift_memory_contradictions`, `drift_memory_warnings`, `drift_memory_suggest`

### Visualization (1)
`drift_memory_graph`

### Import/Export (2)
`drift_memory_export`, `drift_memory_import`

### Specialized Memory Types (11)
`drift_memory_agent_spawn`, `drift_memory_entity`, `drift_memory_goal`, `drift_memory_workflow`, `drift_memory_incident`, `drift_memory_meeting`, `drift_memory_skill`, `drift_memory_conversation`, `drift_memory_environment`

All memory tools use the `executeMemoryTool()` wrapper which handles Cortex initialization and error formatting.
