import Database from "better-sqlite3";
import type {
  AuditEvent,
  BaselineViolation,
  FileSnapshot,
  Finding,
  RepoRecord,
  ScanManifest
} from "@drift/core";
import {
  AuditEventSchema,
  BaselineViolationSchema,
  FileSnapshotSchema,
  FindingSchema,
  RepoRecordSchema,
  ScanManifestSchema
} from "@drift/core";
import { MIGRATIONS } from "./migrations.js";

export interface DriftStorageOptions {
  databasePath: string;
}

type DatabaseHandle = Database.Database;

export class SqliteDriftStorage {
  private readonly db: DatabaseHandle;

  constructor(options: DriftStorageOptions) {
    this.db = new Database(options.databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(this.getAppliedMigrations());
    const applyMigration = this.db.prepare(
      "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)"
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) {
        continue;
      }

      const transaction = this.db.transaction(() => {
        this.db.exec(migration.sql);
        applyMigration.run(migration.id, new Date().toISOString());
      });
      transaction();
    }
  }

  getAppliedMigrations(): string[] {
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    if (!table) {
      return [];
    }

    return this.db
      .prepare("SELECT id FROM schema_migrations ORDER BY id")
      .all()
      .map((row) => rowValue<string>(row, "id"));
  }

  upsertRepo(repo: RepoRecord): void {
    const parsed = RepoRecordSchema.parse(repo);
    this.db
      .prepare(`
        INSERT INTO repos (id, root_path, fingerprint, created_at, updated_at)
        VALUES (@id, @root_path, @fingerprint, @created_at, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          root_path = excluded.root_path,
          fingerprint = excluded.fingerprint,
          updated_at = excluded.updated_at
      `)
      .run(parsed);
  }

  getRepo(id: string): RepoRecord | undefined {
    const row = this.db.prepare("SELECT * FROM repos WHERE id = ?").get(id);
    return row ? RepoRecordSchema.parse(row) : undefined;
  }

  upsertScanManifest(manifest: ScanManifest): void {
    const parsed = ScanManifestSchema.parse(manifest);
    this.db
      .prepare(`
        INSERT INTO scan_manifests (
          id, repo_id, branch, commit_hash, dirty, previous_scan_id, scanner_version,
          adapter_versions_json, rule_engine_version, status, file_count, fact_count,
          finding_count, started_at, completed_at, error_message
        )
        VALUES (
          @id, @repo_id, @branch, @commit_hash, @dirty, @previous_scan_id,
          @scanner_version, @adapter_versions_json, @rule_engine_version, @status,
          @file_count, @fact_count, @finding_count, @started_at, @completed_at, @error_message
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          file_count = excluded.file_count,
          fact_count = excluded.fact_count,
          finding_count = excluded.finding_count,
          completed_at = excluded.completed_at,
          error_message = excluded.error_message
      `)
      .run({
        ...parsed,
        commit_hash: parsed.commit,
        dirty: parsed.dirty ? 1 : 0,
        adapter_versions_json: stringifyJson(parsed.adapter_versions),
        previous_scan_id: parsed.previous_scan_id ?? null,
        completed_at: parsed.completed_at ?? null,
        error_message: parsed.error_message ?? null
      });
  }

  getScanManifest(id: string): ScanManifest | undefined {
    const row = this.db.prepare("SELECT * FROM scan_manifests WHERE id = ?").get(id);
    return row ? scanManifestFromRow(row) : undefined;
  }

  upsertFileSnapshot(snapshot: FileSnapshot): void {
    const parsed = FileSnapshotSchema.parse(snapshot);
    this.db
      .prepare(`
        INSERT INTO file_snapshots (
          repo_id, scan_id, file_path, content_hash, byte_size, indexed
        )
        VALUES (@repo_id, @scan_id, @file_path, @content_hash, @byte_size, @indexed)
        ON CONFLICT(repo_id, scan_id, file_path) DO UPDATE SET
          content_hash = excluded.content_hash,
          byte_size = excluded.byte_size,
          indexed = excluded.indexed
      `)
      .run({ ...parsed, indexed: parsed.indexed ? 1 : 0 });
  }

  upsertFinding(finding: Finding): void {
    const parsed = FindingSchema.parse(finding);
    this.db
      .prepare(`
        INSERT INTO findings (
          id, repo_id, convention_id, fingerprint, title, message, severity,
          enforcement_result, status, diff_status, evidence_refs_json, created_at
        )
        VALUES (
          @id, @repo_id, @convention_id, @fingerprint, @title, @message, @severity,
          @enforcement_result, @status, @diff_status, @evidence_refs_json, @created_at
        )
        ON CONFLICT(repo_id, fingerprint) DO UPDATE SET
          title = excluded.title,
          message = excluded.message,
          severity = excluded.severity,
          enforcement_result = excluded.enforcement_result,
          status = excluded.status,
          diff_status = excluded.diff_status,
          evidence_refs_json = excluded.evidence_refs_json
      `)
      .run({
        ...parsed,
        evidence_refs_json: stringifyJson(parsed.evidence_refs)
      });
  }

  listFindings(repoId: string): Finding[] {
    return this.db
      .prepare("SELECT * FROM findings WHERE repo_id = ? ORDER BY created_at, id")
      .all(repoId)
      .map(findingFromRow);
  }

  upsertBaselineViolation(violation: BaselineViolation): void {
    const parsed = BaselineViolationSchema.parse(violation);
    this.db
      .prepare(`
        INSERT INTO baseline_violations (
          id, repo_id, convention_id, finding_fingerprint, file_path,
          first_seen_scan_id, first_seen_commit, status, created_at
        )
        VALUES (
          @id, @repo_id, @convention_id, @finding_fingerprint, @file_path,
          @first_seen_scan_id, @first_seen_commit, @status, @created_at
        )
        ON CONFLICT(repo_id, convention_id, finding_fingerprint) DO UPDATE SET
          status = excluded.status
      `)
      .run(parsed);
  }

  listBaselineViolations(repoId: string): BaselineViolation[] {
    return this.db
      .prepare("SELECT * FROM baseline_violations WHERE repo_id = ? ORDER BY created_at, id")
      .all(repoId)
      .map((row) => BaselineViolationSchema.parse(row));
  }

  appendAuditEvent(event: AuditEvent): void {
    const parsed = AuditEventSchema.parse(event);
    try {
      this.db
        .prepare(`
          INSERT INTO audit_events (
            id, repo_id, actor, action, target_type, target_id, metadata_json, created_at
          )
          VALUES (
            @id, @repo_id, @actor, @action, @target_type, @target_id, @metadata_json, @created_at
          )
        `)
        .run({
          ...parsed,
          metadata_json: stringifyJson(parsed.metadata)
        });
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        throw new Error(`Audit log is append-only; event ${parsed.id} already exists.`);
      }
      throw error;
    }
  }

  listAuditEvents(repoId: string): AuditEvent[] {
    return this.db
      .prepare("SELECT * FROM audit_events WHERE repo_id = ? ORDER BY created_at, id")
      .all(repoId)
      .map(auditEventFromRow);
  }

  close(): void {
    this.db.close();
  }
}

export function openDriftStorage(options: DriftStorageOptions): SqliteDriftStorage {
  return new SqliteDriftStorage(options);
}

function scanManifestFromRow(row: unknown): ScanManifest {
  const record = row as Record<string, unknown>;
  return ScanManifestSchema.parse({
    id: record.id,
    repo_id: record.repo_id,
    branch: record.branch,
    commit: record.commit_hash,
    dirty: record.dirty === 1,
    previous_scan_id: record.previous_scan_id ?? undefined,
    scanner_version: record.scanner_version,
    adapter_versions: parseJsonObject(record.adapter_versions_json),
    rule_engine_version: record.rule_engine_version,
    status: record.status,
    file_count: record.file_count,
    fact_count: record.fact_count,
    finding_count: record.finding_count,
    started_at: record.started_at,
    completed_at: record.completed_at ?? undefined,
    error_message: record.error_message ?? undefined
  });
}

function findingFromRow(row: unknown): Finding {
  const record = row as Record<string, unknown>;
  return FindingSchema.parse({
    ...record,
    evidence_refs: parseJsonArray(record.evidence_refs_json)
  });
}

function auditEventFromRow(row: unknown): AuditEvent {
  const record = row as Record<string, unknown>;
  return AuditEventSchema.parse({
    ...record,
    metadata: parseJsonObject(record.metadata_json)
  });
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = JSON.parse(String(value));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object from SQLite row.");
  }
  return parsed as Record<string, unknown>;
}

function parseJsonArray(value: unknown): unknown[] {
  const parsed = JSON.parse(String(value));
  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array from SQLite row.");
  }
  return parsed;
}

function rowValue<T>(row: unknown, key: string): T {
  return (row as Record<string, T>)[key];
}

function isSqliteConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
