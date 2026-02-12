# SQLite Database Schema

## Core Schema (packages/core/src/storage/schema.sql)

Version: 1.0.0. Replaces 50+ JSON files with unified SQLite.

### Pragmas
```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

### Tables (26 total)

#### Project Metadata
- `project` — id, name, root_path, drift_version, schema_version
- `config` — key-value store (JSON blobs)
- `feature_flags` — feature, enabled, config

#### Patterns (core data)
- `patterns` — id, name, description, category, subcategory, status (discovered/approved/ignored), confidence (score/level/frequency/consistency/age/spread), detector info, severity, auto_fixable, timestamps, counts
- `pattern_locations` — pattern_id, file, line, column, is_outlier, outlier_reason, deviation_score, confidence, snippet
- `pattern_variants` — id, pattern_id, name, scope (global/directory/file), scope_value, reason, active, expires_at
- `pattern_examples` — pattern_id, file, line, code, context, quality, is_outlier

#### Contracts (API BE↔FE)
- `contracts` — id, method, endpoint, normalized_endpoint, status (discovered/verified/mismatch/ignored), backend info, confidence, mismatches
- `contract_frontends` — contract_id, method, path, file, line, library, response_fields

#### Constraints
- `constraints` — id, name, category, status, language, invariant (JSON), scope (JSON), enforcement_level, confidence

#### Boundaries (Data Access)
- `data_models` — name, table_name, file, framework, fields (JSON)
- `sensitive_fields` — table_name, field_name, sensitivity (pii/financial/auth/health/custom)
- `data_access_points` — table_name, operation (read/write/delete), file, line, fields (JSON), is_raw_sql, function_id

#### Environment
- `env_variables` — name, sensitivity (secret/credential/config/unknown), has_default, is_required
- `env_access_points` — var_name, method, file, line, language, confidence

#### Call Graph
- `functions` — id, name, qualified_name, file, start_line, end_line, language, is_exported, is_entry_point, is_data_accessor, is_async, decorators (JSON), parameters (JSON), signature
- `function_calls` — caller_id, callee_id, callee_name, line, resolved, confidence, argument_count
- `function_data_access` — function_id, table_name, operation, fields (JSON), line

#### Audit & History
- `audit_snapshots` — date, health_score, total_patterns, avg_confidence, summary (JSON)
- `pattern_history` — date, pattern_id, action (created/approved/ignored/updated/deleted), previous_status, new_status
- `health_trends` — date, health_score, avg_confidence, total_patterns
- `scan_history` — scan_id, started_at, completed_at, duration_ms, files_scanned, patterns_found, status

#### DNA
- `dna_profile` — singleton, version, health_score, genetic_diversity, summary (JSON)
- `dna_genes` — id, name, dominant_variant, frequency, confidence, variants (JSON)
- `dna_mutations` — gene_id, file, line, expected, actual, impact

#### Other
- `test_files`, `test_coverage` — Test topology
- `constants`, `constant_usages` — Constants analysis
- `decisions` — Decision mining results
- `module_coupling`, `coupling_cycles` — Coupling analysis
- `error_boundaries`, `error_handling_gaps` — Error handling
- `wrappers`, `wrapper_clusters` — Wrapper detection
- `quality_gate_runs`, `quality_gate_snapshots` — Quality gates
- `learned_patterns` — Learning data
- `sync_log` — Cloud sync tracking

### Indexes (50+)
Every common query pattern has an index. See schema.sql for full list.

### Triggers
- Auto-update pattern location/outlier counts on insert/update/delete
- Sync log triggers on patterns, constraints, contracts for cloud sync

### Views (5)
- `v_status` — Overall status summary
- `v_pattern_index` — Pattern listing
- `v_category_counts` — Category breakdown
- `v_file_patterns` — Patterns by file
- `v_security_summary` — Security posture

## Cortex Schema (packages/cortex/src/storage/sqlite/schema.ts)

Version: 5. Separate database for AI memory.

### Tables
- `memories` — id, type (9 types), content (JSON), summary, bitemporal (recorded_at, valid_from, valid_until), confidence, importance, access tracking, archival, validation
- `memory_relationships` — source_id, target_id, relationship (supersedes/supports/contradicts/related/derived_from), strength
- `memory_patterns` — memory_id → pattern_id link
- `memory_constraints` — memory_id → constraint_id link
- `memory_files` — memory_id → file_path link (with content_hash for drift detection)
- `memory_functions` — memory_id → function_id link
- `consolidation_runs` — Consolidation history
- `validation_runs` — Validation history
- `memory_embedding_link` — memory_id → embedding_rowid

### Vector Table (sqlite-vec)
```sql
CREATE VIRTUAL TABLE memory_embeddings USING vec0(
  embedding float[384]  -- 384-dim for all-MiniLM-L6-v2
);
```
