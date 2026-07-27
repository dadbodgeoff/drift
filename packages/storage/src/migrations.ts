export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "001_initial_local_state",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scan_manifests (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
        previous_scan_id TEXT,
        scanner_version TEXT NOT NULL,
        adapter_versions_json TEXT NOT NULL,
        rule_engine_version TEXT NOT NULL,
        status TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        fact_count INTEGER NOT NULL,
        finding_count INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_scan_manifests_repo_id
        ON scan_manifests(repo_id);

      CREATE TABLE IF NOT EXISTS file_snapshots (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        indexed INTEGER NOT NULL CHECK (indexed IN (0, 1)),
        PRIMARY KEY (repo_id, scan_id, file_path),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        convention_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL,
        enforcement_result TEXT NOT NULL,
        status TEXT NOT NULL,
        diff_status TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(repo_id, fingerprint),
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_findings_repo_id
        ON findings(repo_id);

      CREATE TABLE IF NOT EXISTS baseline_violations (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        convention_id TEXT NOT NULL,
        finding_fingerprint TEXT NOT NULL,
        file_path TEXT NOT NULL,
        first_seen_scan_id TEXT NOT NULL,
        first_seen_commit TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(repo_id, convention_id, finding_fingerprint),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (first_seen_scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_baseline_violations_repo_id
        ON baseline_violations(repo_id);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_repo_id_created_at
        ON audit_events(repo_id, created_at);
    `
  },
  {
    id: "002_scan_facts",
    sql: `
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_facts_scan_id
        ON facts(scan_id);

      CREATE INDEX IF NOT EXISTS idx_facts_scan_kind
        ON facts(scan_id, kind);

      CREATE INDEX IF NOT EXISTS idx_facts_scan_file
        ON facts(scan_id, file_path);
    `
  },
  {
    id: "003_repo_contracts_and_conventions",
    sql: `
      CREATE TABLE IF NOT EXISTS convention_candidates (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        statement TEXT NOT NULL,
        rationale TEXT,
        scope_json TEXT NOT NULL,
        matcher_json TEXT NOT NULL,
        suggested_severity TEXT NOT NULL,
        suggested_enforcement_mode TEXT NOT NULL,
        enforcement_capability TEXT NOT NULL,
        confidence_label TEXT NOT NULL,
        scoring_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        counterexample_refs_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_convention_candidates_repo_status
        ON convention_candidates(repo_id, status);

      CREATE TABLE IF NOT EXISTS accepted_conventions (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        statement TEXT NOT NULL,
        rationale TEXT,
        scope_json TEXT NOT NULL,
        matcher_json TEXT NOT NULL,
        severity TEXT NOT NULL,
        enforcement_mode TEXT NOT NULL,
        enforcement_capability TEXT NOT NULL,
        exceptions_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        counterexample_refs_json TEXT NOT NULL,
        accepted_by TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_accepted_conventions_repo_id
        ON accepted_conventions(repo_id);

      CREATE TABLE IF NOT EXISTS repo_contracts (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL UNIQUE,
        contract_schema_version INTEGER NOT NULL,
        repo_fingerprint TEXT NOT NULL,
        contract_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );
    `
  },
  {
    id: "004_backup_manifests",
    sql: `
      CREATE TABLE IF NOT EXISTS backup_manifests (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        repo_fingerprint TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        source_database_path TEXT NOT NULL,
        backup_path TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_backup_manifests_repo_created_at
        ON backup_manifests(repo_id, created_at);
    `
  },
  {
    id: "005_audit_integrity",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      ALTER TABLE audit_events ADD COLUMN previous_event_hash TEXT;
      ALTER TABLE audit_events ADD COLUMN event_hash TEXT;

      CREATE INDEX IF NOT EXISTS idx_audit_events_repo_id_rowid
        ON audit_events(repo_id);
    `
  },
  {
    id: "006_fact_graph_artifacts",
    sql: `
      CREATE TABLE IF NOT EXISTS fact_graph_artifacts (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        graph_hash TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        edge_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(repo_id, scan_id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS graph_nodes (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS graph_edges (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_graph_nodes_scan_kind
        ON graph_nodes(repo_id, scan_id, kind);

      CREATE INDEX IF NOT EXISTS idx_graph_edges_scan_kind
        ON graph_edges(repo_id, scan_id, kind);
    `
  },
  {
    id: "007_fact_graph_v2_projections",
    sql: `
      ALTER TABLE fact_graph_artifacts ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE fact_graph_artifacts ADD COLUMN diagnostic_count INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE graph_nodes ADD COLUMN stable INTEGER NOT NULL DEFAULT 1 CHECK (stable IN (0, 1));
      ALTER TABLE graph_nodes ADD COLUMN evidence_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE graph_nodes ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

      ALTER TABLE graph_edges ADD COLUMN evidence_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE graph_edges ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS graph_evidence (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        start_column INTEGER,
        end_column INTEGER,
        adapter_id TEXT NOT NULL,
        adapter_version TEXT NOT NULL,
        fact_ids_json TEXT NOT NULL,
        redaction_state TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS graph_diagnostics (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        severity TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        file_path TEXT,
        evidence_ids_json TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS graph_completeness (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        scope TEXT NOT NULL,
        rule_id TEXT,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        required_capabilities_json TEXT NOT NULL,
        missing_capabilities_json TEXT NOT NULL,
        truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
        can_block INTEGER NOT NULL CHECK (can_block IN (0, 1)),
        reasons_json TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS symbol_occurrences (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        symbol_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        evidence_id TEXT,
        PRIMARY KEY (repo_id, scan_id, id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS resolver_dependencies (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        dependency_path TEXT NOT NULL,
        dependency_kind TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS module_dependents (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        dependent_module_id TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, module_id, dependent_module_id, edge_id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_graph_evidence_scan_file
        ON graph_evidence(repo_id, scan_id, file_path);

      CREATE INDEX IF NOT EXISTS idx_graph_completeness_scan_scope
        ON graph_completeness(repo_id, scan_id, scope);

      CREATE INDEX IF NOT EXISTS idx_symbol_occurrences_scan_symbol
        ON symbol_occurrences(repo_id, scan_id, symbol_id);

      CREATE INDEX IF NOT EXISTS idx_resolver_dependencies_source
        ON resolver_dependencies(repo_id, scan_id, source_path);

      CREATE INDEX IF NOT EXISTS idx_module_dependents_module
        ON module_dependents(repo_id, scan_id, module_id);
    `
  },
  {
    id: "008_scan_file_changes",
    sql: `
      CREATE TABLE IF NOT EXISTS scan_file_changes (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        change_kind TEXT NOT NULL CHECK (change_kind IN ('added', 'modified', 'deleted', 'unchanged')),
        previous_hash TEXT,
        current_hash TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, file_path),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_scan_file_changes_scan_kind
        ON scan_file_changes(repo_id, scan_id, change_kind);
    `
  },
  {
    id: "009_symbol_occurrence_kind",
    sql: `
      ALTER TABLE symbol_occurrences
        ADD COLUMN occurrence_kind TEXT NOT NULL DEFAULT 'reference'
        CHECK (occurrence_kind IN ('declaration', 'reference'));
    `
  },
  {
    id: "010_audit_sequence",
    sql: `
      -- Applied by SqliteDriftStorage.applyAuditSequenceMigration so existing
      -- databases can be backfilled idempotently before the unique index lands.
    `
  },
  {
    id: "011_check_runs_and_finding_context",
    sql: `
      CREATE TABLE IF NOT EXISTS check_runs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        repo_contract_id TEXT NOT NULL,
        contract_fingerprint TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'blocked')),
        scope TEXT NOT NULL CHECK (scope IN ('changed-hunks', 'changed-files', 'full')),
        engine_source TEXT NOT NULL CHECK (engine_source IN ('rust', 'typescript')),
        fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
        stale_scan INTEGER NOT NULL CHECK (stale_scan IN (0, 1)),
        capability_complete INTEGER NOT NULL CHECK (capability_complete IN (0, 1)),
        findings_count INTEGER NOT NULL,
        blocking_count INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_check_runs_repo_completed
        ON check_runs(repo_id, completed_at);

      ALTER TABLE findings ADD COLUMN check_id TEXT;
      ALTER TABLE findings ADD COLUMN repo_contract_id TEXT;
      ALTER TABLE findings ADD COLUMN expected_layer TEXT;
      ALTER TABLE findings ADD COLUMN actual_layer TEXT;
      ALTER TABLE findings ADD COLUMN graph_path_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE findings ADD COLUMN suggested_fix TEXT;
      ALTER TABLE findings ADD COLUMN related_node_ids_json TEXT NOT NULL DEFAULT '[]';
    `
  },
  {
    id: "012_repo_identity",
    sql: `
      ALTER TABLE repos ADD COLUMN vcs_provider TEXT;
      ALTER TABLE repos ADD COLUMN remote_url_hash TEXT;
      ALTER TABLE repos ADD COLUMN package_manager TEXT;
      ALTER TABLE repos ADD COLUMN lockfile_hashes_json TEXT;
      ALTER TABLE repos ADD COLUMN resolver_input_hash TEXT;
    `
  },
  {
    id: "013_required_check_executions",
    sql: `
      CREATE TABLE IF NOT EXISTS required_check_executions (
        execution_id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        repo_commit TEXT NOT NULL,
        worktree_dirty INTEGER NOT NULL CHECK (worktree_dirty IN (0, 1)),
        scan_id TEXT,
        repo_contract_id TEXT NOT NULL,
        agent_contract_id TEXT NOT NULL,
        command TEXT NOT NULL,
        argv_json TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        cwd TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        timeout_ms INTEGER NOT NULL,
        exit_code INTEGER,
        status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'timed_out', 'blocked')),
        stdout_hash TEXT NOT NULL,
        stderr_hash TEXT NOT NULL,
        stdout_preview TEXT NOT NULL,
        stderr_preview TEXT NOT NULL,
        audit_event_id TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_required_check_executions_repo_command
        ON required_check_executions(repo_id, command_hash, completed_at);

      CREATE INDEX IF NOT EXISTS idx_required_check_executions_repo_contract
        ON required_check_executions(repo_id, repo_contract_id, scan_id);
    `
  },
  {
    id: "014_fact_quality",
    sql: `
      ALTER TABLE facts ADD COLUMN source_span_json TEXT NOT NULL DEFAULT '{"start_line":1,"start_column":1,"end_line":1,"end_column":1}';
      ALTER TABLE facts ADD COLUMN ast_node_kind TEXT;
      ALTER TABLE facts ADD COLUMN extraction_method TEXT NOT NULL DEFAULT 'legacy_parser';
      ALTER TABLE facts ADD COLUMN extractor_version TEXT NOT NULL DEFAULT '0.1.0';
      ALTER TABLE facts ADD COLUMN parser_version TEXT NOT NULL DEFAULT '0.1.0';
      ALTER TABLE facts ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;
      ALTER TABLE facts ADD COLUMN confidence_label TEXT NOT NULL DEFAULT 'certain';
      ALTER TABLE facts ADD COLUMN evidence_level TEXT NOT NULL DEFAULT 'text';
      ALTER TABLE facts ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'resolved';
      ALTER TABLE facts ADD COLUMN staleness_status TEXT NOT NULL DEFAULT 'fresh';
      ALTER TABLE facts ADD COLUMN last_seen_scan_id TEXT;
      UPDATE facts SET last_seen_scan_id = scan_id WHERE last_seen_scan_id IS NULL;
    `
  },
  {
    id: "015_parser_gaps",
    sql: `
      CREATE TABLE IF NOT EXISTS parser_gaps (
        gap_id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        confidence_impact TEXT NOT NULL,
        message TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_parser_gaps_repo_scan
        ON parser_gaps(repo_id, scan_id);

      CREATE INDEX IF NOT EXISTS idx_parser_gaps_repo_kind
        ON parser_gaps(repo_id, kind);
    `
  },
  {
    id: "016_symbol_identities",
    sql: `
      CREATE TABLE IF NOT EXISTS symbol_identities (
        symbol_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        declared_in TEXT NOT NULL,
        exported_from_json TEXT NOT NULL,
        imported_as_json TEXT NOT NULL,
        re_export_chain_json TEXT NOT NULL,
        canonical_definition TEXT NOT NULL,
        call_sites_json TEXT NOT NULL,
        references_json TEXT NOT NULL,
        visibility TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, symbol_id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_symbol_identities_repo_scan
        ON symbol_identities(repo_id, scan_id);

      CREATE INDEX IF NOT EXISTS idx_symbol_identities_repo_name
        ON symbol_identities(repo_id, symbol_name);
    `
  },
  {
    id: "017_required_check_state_binding",
    sql: `
      ALTER TABLE required_check_executions ADD COLUMN git_branch TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE required_check_executions ADD COLUMN git_commit_sha TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE required_check_executions ADD COLUMN untracked_files_present INTEGER NOT NULL DEFAULT 0 CHECK (untracked_files_present IN (0, 1));
      ALTER TABLE required_check_executions ADD COLUMN contract_fingerprint TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE required_check_executions ADD COLUMN repo_contract_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE required_check_executions ADD COLUMN diff_hash TEXT NOT NULL DEFAULT 'no_diff';
      ALTER TABLE required_check_executions ADD COLUMN lockfile_hash TEXT;
      ALTER TABLE required_check_executions ADD COLUMN package_manager TEXT;

      CREATE INDEX IF NOT EXISTS idx_required_check_executions_state_binding
        ON required_check_executions(repo_id, repo_contract_id, contract_fingerprint, diff_hash, completed_at);
    `
  },
  {
    id: "018_audit_object_hashes",
    sql: `
      ALTER TABLE audit_events ADD COLUMN before_hash TEXT;
      ALTER TABLE audit_events ADD COLUMN after_hash TEXT;
      ALTER TABLE audit_events ADD COLUMN object_schema_version TEXT;
    `
  },
  {
    id: "019_scan_capability_reports",
    sql: `
      CREATE TABLE IF NOT EXISTS scan_capability_reports (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        engine_source TEXT NOT NULL CHECK (engine_source IN ('rust', 'typescript')),
        engine_version TEXT,
        scanner_version TEXT NOT NULL,
        adapter_versions_json TEXT NOT NULL,
        certified_capabilities_json TEXT NOT NULL,
        required_capabilities_json TEXT NOT NULL,
        missing_capabilities_json TEXT NOT NULL,
        completeness_json TEXT NOT NULL,
        parser_gap_count INTEGER NOT NULL,
        parser_gap_kinds_json TEXT NOT NULL,
        fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
        enforcement_degraded INTEGER NOT NULL CHECK (enforcement_degraded IN (0, 1)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_scan_capability_reports_repo_scan
        ON scan_capability_reports(repo_id, scan_id);
    `
  },
  {
    id: "020_machine_contract_versions",
    sql: `
      ALTER TABLE check_runs ADD COLUMN machine_contract_versions_json TEXT;

      ALTER TABLE findings ADD COLUMN created_by_engine_version TEXT;
      ALTER TABLE findings ADD COLUMN created_by_rule_engine_version TEXT;
      ALTER TABLE findings ADD COLUMN contract_schema_version INTEGER;
    `
  },
  {
    id: "021_graph_evidence_confidence",
    sql: `
      ALTER TABLE graph_evidence ADD COLUMN confidence_kind TEXT NOT NULL DEFAULT 'deterministic'
        CHECK (confidence_kind IN ('deterministic', 'heuristic', 'unresolved'));
      ALTER TABLE graph_evidence ADD COLUMN extractor TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE graph_evidence ADD COLUMN snippet_hash TEXT;
    `
  },
  {
    id: "022_fact_imported_name",
    sql: `
      ALTER TABLE facts ADD COLUMN imported_name TEXT;
    `
  },
  {
    id: "023_security_boundary_proofs",
    sql: `
      CREATE TABLE IF NOT EXISTS security_boundary_proofs (
        proof_id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        route_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        contract_kinds_json TEXT NOT NULL,
        proof_status TEXT NOT NULL,
        enforcement_result TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_security_boundary_proofs_repo_scan
        ON security_boundary_proofs(repo_id, scan_id);

      CREATE INDEX IF NOT EXISTS idx_security_boundary_proofs_repo_route
        ON security_boundary_proofs(repo_id, route_id);
    `
  },
  {
    id: "024_phase7_candidate_election_metadata",
    sql: `
      ALTER TABLE convention_candidates ADD COLUMN requires_json TEXT;
      ALTER TABLE convention_candidates ADD COLUMN matcher_fingerprint TEXT;
      ALTER TABLE convention_candidates ADD COLUMN scope_fingerprint TEXT;
      ALTER TABLE convention_candidates ADD COLUMN graph_fingerprint TEXT;
      ALTER TABLE convention_candidates ADD COLUMN evidence_fingerprint TEXT;
      ALTER TABLE convention_candidates ADD COLUMN required_capabilities_json TEXT;
      ALTER TABLE convention_candidates ADD COLUMN reason_not_blocking TEXT;

      ALTER TABLE accepted_conventions ADD COLUMN requires_json TEXT;
    `
  },
  {
    id: "025_security_boundary_proof_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS security_boundary_proof_runs (
        storage_id TEXT PRIMARY KEY,
        proof_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        check_id TEXT NOT NULL,
        route_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        contract_kinds_json TEXT NOT NULL,
        capability_names_json TEXT NOT NULL,
        proof_status TEXT NOT NULL,
        enforcement_result TEXT NOT NULL,
        parser_gap_count INTEGER NOT NULL,
        missing_proof_count INTEGER NOT NULL,
        affected_files_json TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_security_boundary_proof_runs_unique
        ON security_boundary_proof_runs(check_id, proof_id);

      CREATE INDEX IF NOT EXISTS idx_security_boundary_proof_runs_repo_scan
        ON security_boundary_proof_runs(repo_id, scan_id);

      CREATE INDEX IF NOT EXISTS idx_security_boundary_proof_runs_repo_check
        ON security_boundary_proof_runs(repo_id, check_id);

      CREATE INDEX IF NOT EXISTS idx_security_boundary_proof_runs_repo_route
        ON security_boundary_proof_runs(repo_id, route_id);
    `
  },
  {
    id: "026_framework_entrypoints",
    sql: `
      CREATE TABLE IF NOT EXISTS framework_adapters (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        framework TEXT NOT NULL,
        adapter_json TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, adapter_id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS normalized_entrypoints (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        entrypoint_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        framework TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        route_pattern TEXT,
        method TEXT,
        entrypoint_json TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, entrypoint_id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS framework_parser_gaps (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        parser_gap_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        framework TEXT,
        file_path TEXT NOT NULL,
        code TEXT NOT NULL,
        blocks_enforcement INTEGER NOT NULL CHECK (blocks_enforcement IN (0, 1)),
        parser_gap_json TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, parser_gap_id),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE TABLE IF NOT EXISTS framework_capabilities (
        repo_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        framework TEXT NOT NULL,
        capability TEXT NOT NULL,
        status TEXT NOT NULL,
        can_block INTEGER NOT NULL CHECK (can_block IN (0, 1)),
        capability_json TEXT NOT NULL,
        PRIMARY KEY (repo_id, scan_id, adapter_id, capability),
        FOREIGN KEY (repo_id) REFERENCES repos(id),
        FOREIGN KEY (scan_id) REFERENCES scan_manifests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_normalized_entrypoints_repo_scan_framework
        ON normalized_entrypoints(repo_id, scan_id, framework);

      CREATE INDEX IF NOT EXISTS idx_normalized_entrypoints_repo_scan_file
        ON normalized_entrypoints(repo_id, scan_id, file_path);
    `
  },
  {
    id: "027_parser_gap_v2_metadata",
    sql: `
      ALTER TABLE parser_gaps ADD COLUMN source_text_hash TEXT;
      ALTER TABLE parser_gaps ADD COLUMN affected_capabilities_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE parser_gaps ADD COLUMN affected_contract_kinds_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE parser_gaps ADD COLUMN suggested_action TEXT;

      CREATE INDEX IF NOT EXISTS idx_parser_gaps_repo_capability
        ON parser_gaps(repo_id, scan_id);
    `
  }
];
