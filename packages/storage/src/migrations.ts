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
  }
];
