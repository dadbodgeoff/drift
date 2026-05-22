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
  }
];
