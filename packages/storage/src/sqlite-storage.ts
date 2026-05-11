import Database from "better-sqlite3";
import type {
  AuditEvent,
  AcceptedConvention,
  BaselineViolation,
  ConventionCandidate,
  ConventionStatus,
  FactKind,
  FactRecord,
  FileSnapshot,
  Finding,
  RepoContract,
  RepoRecord,
  ScanManifest
} from "@drift/core";
import {
  AuditEventSchema,
  AcceptedConventionSchema,
  BaselineViolationSchema,
  ConventionCandidateSchema,
  FactRecordSchema,
  FileSnapshotSchema,
  FindingSchema,
  RepoContractSchema,
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

  upsertFacts(facts: FactRecord[]): void {
    const parsedFacts = facts.map((fact) => FactRecordSchema.parse(fact));
    const insert = this.db.prepare(`
      INSERT INTO facts (
        id, repo_id, scan_id, kind, file_path, name, value, start_line, end_line
      )
      VALUES (
        @id, @repo_id, @scan_id, @kind, @file_path, @name, @value, @start_line, @end_line
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        file_path = excluded.file_path,
        name = excluded.name,
        value = excluded.value,
        start_line = excluded.start_line,
        end_line = excluded.end_line
    `);

    const transaction = this.db.transaction(() => {
      for (const fact of parsedFacts) {
        insert.run({ ...fact, value: fact.value ?? null });
      }
    });
    transaction();
  }

  listFacts(scanId: string, filter: { kind?: FactKind } = {}): FactRecord[] {
    const rows = filter.kind
      ? this.db
          .prepare("SELECT * FROM facts WHERE scan_id = ? AND kind = ? ORDER BY file_path, start_line, id")
          .all(scanId, filter.kind)
      : this.db
          .prepare("SELECT * FROM facts WHERE scan_id = ? ORDER BY file_path, start_line, id")
          .all(scanId);

    return rows.map(factFromRow);
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

  upsertConventionCandidate(candidate: ConventionCandidate): void {
    const parsed = ConventionCandidateSchema.parse(candidate);
    this.db
      .prepare(`
        INSERT INTO convention_candidates (
          id, repo_id, scan_id, kind, statement, rationale, scope_json, matcher_json,
          suggested_severity, suggested_enforcement_mode, enforcement_capability,
          confidence_label, scoring_json, evidence_refs_json, counterexample_refs_json,
          status, created_at
        )
        VALUES (
          @id, @repo_id, @scan_id, @kind, @statement, @rationale, @scope_json, @matcher_json,
          @suggested_severity, @suggested_enforcement_mode, @enforcement_capability,
          @confidence_label, @scoring_json, @evidence_refs_json, @counterexample_refs_json,
          @status, @created_at
        )
        ON CONFLICT(id) DO UPDATE SET
          statement = excluded.statement,
          rationale = excluded.rationale,
          scope_json = excluded.scope_json,
          matcher_json = excluded.matcher_json,
          suggested_severity = excluded.suggested_severity,
          suggested_enforcement_mode = excluded.suggested_enforcement_mode,
          enforcement_capability = excluded.enforcement_capability,
          confidence_label = excluded.confidence_label,
          scoring_json = excluded.scoring_json,
          evidence_refs_json = excluded.evidence_refs_json,
          counterexample_refs_json = excluded.counterexample_refs_json,
          status = excluded.status
      `)
      .run({
        ...parsed,
        rationale: parsed.rationale ?? null,
        scope_json: stringifyJson(parsed.scope),
        matcher_json: stringifyJson(parsed.matcher),
        scoring_json: stringifyJson(parsed.scoring),
        evidence_refs_json: stringifyJson(parsed.evidence_refs),
        counterexample_refs_json: stringifyJson(parsed.counterexample_refs)
      });
  }

  listConventionCandidates(
    repoId: string,
    filter: { status?: ConventionStatus } = {}
  ): ConventionCandidate[] {
    const rows = filter.status
      ? this.db
          .prepare("SELECT * FROM convention_candidates WHERE repo_id = ? AND status = ? ORDER BY created_at, id")
          .all(repoId, filter.status)
      : this.db
          .prepare("SELECT * FROM convention_candidates WHERE repo_id = ? ORDER BY created_at, id")
          .all(repoId);

    return rows.map(conventionCandidateFromRow);
  }

  getConventionCandidate(id: string): ConventionCandidate | undefined {
    const row = this.db
      .prepare("SELECT * FROM convention_candidates WHERE id = ?")
      .get(id);
    return row ? conventionCandidateFromRow(row) : undefined;
  }

  upsertAcceptedConvention(repoId: string, convention: AcceptedConvention): void {
    const parsed = AcceptedConventionSchema.parse(convention);
    this.db
      .prepare(`
        INSERT INTO accepted_conventions (
          id, repo_id, contract_id, kind, statement, rationale, scope_json, matcher_json,
          severity, enforcement_mode, enforcement_capability, exceptions_json,
          evidence_refs_json, counterexample_refs_json, accepted_by, accepted_at,
          updated_at, expires_at
        )
        VALUES (
          @id, @repo_id, @contract_id, @kind, @statement, @rationale, @scope_json, @matcher_json,
          @severity, @enforcement_mode, @enforcement_capability, @exceptions_json,
          @evidence_refs_json, @counterexample_refs_json, @accepted_by, @accepted_at,
          @updated_at, @expires_at
        )
        ON CONFLICT(id) DO UPDATE SET
          contract_id = excluded.contract_id,
          statement = excluded.statement,
          rationale = excluded.rationale,
          scope_json = excluded.scope_json,
          matcher_json = excluded.matcher_json,
          severity = excluded.severity,
          enforcement_mode = excluded.enforcement_mode,
          enforcement_capability = excluded.enforcement_capability,
          exceptions_json = excluded.exceptions_json,
          evidence_refs_json = excluded.evidence_refs_json,
          counterexample_refs_json = excluded.counterexample_refs_json,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at
      `)
      .run({
        ...parsed,
        repo_id: repoId,
        rationale: parsed.rationale ?? null,
        scope_json: stringifyJson(parsed.scope),
        matcher_json: stringifyJson(parsed.matcher),
        exceptions_json: stringifyJson(parsed.exceptions),
        evidence_refs_json: stringifyJson(parsed.evidence_refs),
        counterexample_refs_json: stringifyJson(parsed.counterexample_refs),
        expires_at: parsed.expires_at ?? null
      });
  }

  listAcceptedConventions(repoId: string): AcceptedConvention[] {
    return this.db
      .prepare("SELECT * FROM accepted_conventions WHERE repo_id = ? ORDER BY accepted_at, id")
      .all(repoId)
      .map(acceptedConventionFromRow);
  }

  upsertRepoContract(contract: RepoContract): void {
    const parsed = RepoContractSchema.parse(contract);
    this.db
      .prepare(`
        INSERT INTO repo_contracts (
          id, repo_id, contract_schema_version, repo_fingerprint,
          contract_json, created_at, updated_at
        )
        VALUES (
          @id, @repo_id, @contract_schema_version, @repo_fingerprint,
          @contract_json, @created_at, @updated_at
        )
        ON CONFLICT(repo_id) DO UPDATE SET
          id = excluded.id,
          contract_schema_version = excluded.contract_schema_version,
          repo_fingerprint = excluded.repo_fingerprint,
          contract_json = excluded.contract_json,
          updated_at = excluded.updated_at
      `)
      .run({
        id: parsed.id,
        repo_id: parsed.repo_id,
        contract_schema_version: parsed.contract_schema_version,
        repo_fingerprint: parsed.repo_fingerprint,
        contract_json: stringifyJson(parsed),
        created_at: parsed.created_at,
        updated_at: parsed.updated_at
      });
  }

  getRepoContract(repoId: string): RepoContract | undefined {
    const row = this.db
      .prepare("SELECT contract_json FROM repo_contracts WHERE repo_id = ?")
      .get(repoId);
    if (!row) {
      return undefined;
    }
    return RepoContractSchema.parse(JSON.parse(rowValue<string>(row, "contract_json")));
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

function factFromRow(row: unknown): FactRecord {
  const record = row as Record<string, unknown>;
  return FactRecordSchema.parse({
    ...record,
    value: record.value ?? undefined
  });
}

function conventionCandidateFromRow(row: unknown): ConventionCandidate {
  const record = row as Record<string, unknown>;
  return ConventionCandidateSchema.parse({
    ...record,
    rationale: record.rationale ?? undefined,
    scope: parseJsonObject(record.scope_json),
    matcher: parseJsonObject(record.matcher_json),
    scoring: parseJsonObject(record.scoring_json),
    evidence_refs: parseJsonArray(record.evidence_refs_json),
    counterexample_refs: parseJsonArray(record.counterexample_refs_json)
  });
}

function acceptedConventionFromRow(row: unknown): AcceptedConvention {
  const record = row as Record<string, unknown>;
  return AcceptedConventionSchema.parse({
    ...record,
    rationale: record.rationale ?? undefined,
    scope: parseJsonObject(record.scope_json),
    matcher: parseJsonObject(record.matcher_json),
    exceptions: parseJsonArray(record.exceptions_json),
    evidence_refs: parseJsonArray(record.evidence_refs_json),
    counterexample_refs: parseJsonArray(record.counterexample_refs_json),
    expires_at: record.expires_at ?? undefined
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
