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
  }
];
