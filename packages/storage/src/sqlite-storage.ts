import Database from "better-sqlite3";
import type {
  AuditChainVerification,
  AuditEvent,
  AcceptedConvention,
  BackupManifest,
  BaselineViolation,
  ConventionCandidate,
  ConventionStatus,
  FactKind,
  FactRecord,
  FileSnapshot,
  Finding,
  ModuleDependent,
  RepoContract,
  RepoRecord,
  ResolverDependency,
  ScanFileChange,
  ScanManifest,
  SymbolOccurrence
} from "@drift/core";
import {
  AuditEventSchema,
  AcceptedConventionSchema,
  BackupManifestSchema,
  BaselineViolationSchema,
  ConventionCandidateSchema,
  FactRecordSchema,
  FileSnapshotSchema,
  FindingSchema,
  ModuleDependentSchema,
  RepoContractSchema,
  RepoRecordSchema,
  ResolverDependencySchema,
  ScanFileChangeSchema,
  ScanManifestSchema,
  SymbolOccurrenceSchema,
  auditEventHash
} from "@drift/core";
import type {
  FactGraphArtifact,
  GraphCompleteness,
  GraphDiagnostic,
  GraphEdge,
  GraphEvidence,
  GraphNode
} from "@drift/factgraph";
import {
  FactGraphArtifactSchema,
  GraphCompletenessSchema,
  GraphDiagnosticSchema,
  GraphEdgeSchema,
  GraphEvidenceSchema,
  GraphNodeSchema
} from "@drift/factgraph";
import { MIGRATIONS, type Migration } from "./migrations.js";

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
        this.applyMigration(migration);
        applyMigration.run(migration.id, new Date().toISOString());
      });
      transaction();
    }
  }

  transaction<T>(work: () => T): T {
    if (this.db.inTransaction) {
      return work();
    }
    return this.db.transaction(work)();
  }

  private applyMigration(migration: Migration): void {
    if (migration.id === "005_audit_integrity") {
      this.applyAuditIntegrityMigration();
      return;
    }

    this.db.exec(migration.sql);
  }

  private applyAuditIntegrityMigration(): void {
    this.db.exec(`
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
    `);

    if (!this.auditEventsColumnExists("previous_event_hash")) {
      this.db.exec("ALTER TABLE audit_events ADD COLUMN previous_event_hash TEXT;");
    }
    if (!this.auditEventsColumnExists("event_hash")) {
      this.db.exec("ALTER TABLE audit_events ADD COLUMN event_hash TEXT;");
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_events_repo_id_rowid
        ON audit_events(repo_id);
    `);
  }

  private auditEventsColumnExists(columnName: string): boolean {
    return this.db
      .prepare("PRAGMA table_info(audit_events)")
      .all()
      .some((row) => rowValue<string>(row, "name") === columnName);
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

  listScanManifests(repoId: string): ScanManifest[] {
    return this.db
      .prepare("SELECT * FROM scan_manifests WHERE repo_id = ? ORDER BY started_at DESC, id DESC")
      .all(repoId)
      .map(scanManifestFromRow);
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

  listFileSnapshots(repoId: string, scanId: string): FileSnapshot[] {
    return this.db
      .prepare("SELECT * FROM file_snapshots WHERE repo_id = ? AND scan_id = ? ORDER BY file_path")
      .all(repoId, scanId)
      .map(fileSnapshotFromRow);
  }

  upsertScanFileChanges(changes: ScanFileChange[]): void {
    const parsedChanges = changes.map((change) => ScanFileChangeSchema.parse(change));
    const insert = this.db.prepare(`
      INSERT INTO scan_file_changes (
        repo_id, scan_id, file_path, change_kind, previous_hash, current_hash, created_at
      )
      VALUES (
        @repo_id, @scan_id, @file_path, @change_kind, @previous_hash, @current_hash, @created_at
      )
      ON CONFLICT(repo_id, scan_id, file_path) DO UPDATE SET
        change_kind = excluded.change_kind,
        previous_hash = excluded.previous_hash,
        current_hash = excluded.current_hash,
        created_at = excluded.created_at
    `);

    const transaction = this.db.transaction(() => {
      for (const change of parsedChanges) {
        insert.run({
          ...change,
          previous_hash: change.previous_hash ?? null,
          current_hash: change.current_hash ?? null
        });
      }
    });
    transaction();
  }

  listScanFileChanges(repoId: string, scanId: string): ScanFileChange[] {
    return this.db
      .prepare("SELECT * FROM scan_file_changes WHERE repo_id = ? AND scan_id = ? ORDER BY file_path")
      .all(repoId, scanId)
      .map(scanFileChangeFromRow);
  }

  upsertBackupManifest(manifest: BackupManifest): void {
    const parsed = BackupManifestSchema.parse(manifest);
    this.db
      .prepare(`
        INSERT INTO backup_manifests (
          id, repo_id, repo_fingerprint, schema_version, source_database_path,
          backup_path, checksum_sha256, size_bytes, created_at
        )
        VALUES (
          @id, @repo_id, @repo_fingerprint, @schema_version, @source_database_path,
          @backup_path, @checksum_sha256, @size_bytes, @created_at
        )
        ON CONFLICT(id) DO UPDATE SET
          backup_path = excluded.backup_path,
          checksum_sha256 = excluded.checksum_sha256,
          size_bytes = excluded.size_bytes
      `)
      .run(parsed);
  }

  listBackupManifests(repoId: string): BackupManifest[] {
    return this.db
      .prepare("SELECT * FROM backup_manifests WHERE repo_id = ? ORDER BY created_at DESC, id DESC")
      .all(repoId)
      .map((row) => BackupManifestSchema.parse(row));
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

  upsertFactGraphArtifact(artifact: FactGraphArtifact): void {
    const parsed = FactGraphArtifactSchema.parse(artifact);
    const graphNodes = Array.isArray(parsed.graph.nodes)
      ? mergeGraphNodesById(parsed.graph.nodes.map((node) => GraphNodeSchema.parse(node)))
      : [];
    const graphEdges = Array.isArray(parsed.graph.edges)
      ? mergeGraphEdgesById(parsed.graph.edges.map((edge) => GraphEdgeSchema.parse(edge)))
      : [];
    const graphEvidence = Array.isArray(parsed.graph.evidence)
      ? mergeGraphEvidenceById(parsed.graph.evidence.map((evidence) => GraphEvidenceSchema.parse(evidence)))
      : [];
    const graphDiagnostics = Array.isArray(parsed.graph.diagnostics)
      ? mergeGraphDiagnosticsById(parsed.graph.diagnostics.map((diagnostic) => GraphDiagnosticSchema.parse(diagnostic)))
      : [];
    const graphCompleteness = Array.isArray(parsed.graph.completeness)
      ? parsed.graph.completeness.map((completeness) => GraphCompletenessSchema.parse(completeness))
      : [];
    const symbolOccurrences = symbolOccurrencesFromGraph(
      parsed.repo_id,
      parsed.scan_id,
      graphNodes,
      graphEdges,
      graphEvidence
    );
    const upsertArtifact = this.db.prepare(`
      INSERT INTO fact_graph_artifacts (
        id, repo_id, scan_id, schema_version, graph_hash, graph_json,
        node_count, edge_count, evidence_count, diagnostic_count, created_at
      )
      VALUES (
        @id, @repo_id, @scan_id, @schema_version, @graph_hash, @graph_json,
        @node_count, @edge_count, @evidence_count, @diagnostic_count, @created_at
      )
      ON CONFLICT(repo_id, scan_id) DO UPDATE SET
        id = excluded.id,
        schema_version = excluded.schema_version,
        graph_hash = excluded.graph_hash,
        graph_json = excluded.graph_json,
        node_count = excluded.node_count,
        edge_count = excluded.edge_count,
        evidence_count = excluded.evidence_count,
        diagnostic_count = excluded.diagnostic_count,
        created_at = excluded.created_at
    `);
    const deleteNodes = this.db.prepare("DELETE FROM graph_nodes WHERE repo_id = ? AND scan_id = ?");
    const deleteEdges = this.db.prepare("DELETE FROM graph_edges WHERE repo_id = ? AND scan_id = ?");
    const deleteEvidence = this.db.prepare("DELETE FROM graph_evidence WHERE repo_id = ? AND scan_id = ?");
    const deleteDiagnostics = this.db.prepare("DELETE FROM graph_diagnostics WHERE repo_id = ? AND scan_id = ?");
    const deleteCompleteness = this.db.prepare("DELETE FROM graph_completeness WHERE repo_id = ? AND scan_id = ?");
    const deleteSymbolOccurrences = this.db.prepare("DELETE FROM symbol_occurrences WHERE repo_id = ? AND scan_id = ?");
    const deleteModuleDependents = this.db.prepare("DELETE FROM module_dependents WHERE repo_id = ? AND scan_id = ?");
    const deleteResolverDependencies = this.db.prepare("DELETE FROM resolver_dependencies WHERE repo_id = ? AND scan_id = ?");
    const insertNode = this.db.prepare(`
      INSERT INTO graph_nodes (
        repo_id, scan_id, id, kind, label, stable, evidence_ids_json, metadata_json
      )
      VALUES (
        @repo_id, @scan_id, @id, @kind, @label, @stable, @evidence_ids_json, @metadata_json
      )
    `);
    const insertEdge = this.db.prepare(`
      INSERT INTO graph_edges (
        repo_id, scan_id, id, kind, from_node, to_node, evidence_ids_json, metadata_json
      )
      VALUES (
        @repo_id, @scan_id, @id, @kind, @from_node, @to_node, @evidence_ids_json, @metadata_json
      )
    `);
    const insertEvidence = this.db.prepare(`
      INSERT INTO graph_evidence (
        repo_id, scan_id, id, artifact_id, file_path, file_hash, start_line, end_line,
        start_column, end_column, adapter_id, adapter_version, fact_ids_json, redaction_state
      )
      VALUES (
        @repo_id, @scan_id, @id, @artifact_id, @file_path, @file_hash, @start_line, @end_line,
        @start_column, @end_column, @adapter_id, @adapter_version, @fact_ids_json, @redaction_state
      )
    `);
    const insertDiagnostic = this.db.prepare(`
      INSERT INTO graph_diagnostics (
        repo_id, scan_id, id, severity, code, message, file_path, evidence_ids_json
      )
      VALUES (
        @repo_id, @scan_id, @id, @severity, @code, @message, @file_path, @evidence_ids_json
      )
    `);
    const insertCompleteness = this.db.prepare(`
      INSERT INTO graph_completeness (
        repo_id, scan_id, id, scope, rule_id, complete, required_capabilities_json,
        missing_capabilities_json, truncated, can_block, reasons_json
      )
      VALUES (
        @repo_id, @scan_id, @id, @scope, @rule_id, @complete, @required_capabilities_json,
        @missing_capabilities_json, @truncated, @can_block, @reasons_json
      )
    `);
    const insertSymbolOccurrence = this.db.prepare(`
      INSERT INTO symbol_occurrences (
        repo_id, scan_id, id, symbol_id, occurrence_kind, file_path, start_line, end_line, evidence_id
      )
      VALUES (
        @repo_id, @scan_id, @id, @symbol_id, @occurrence_kind, @file_path, @start_line, @end_line, @evidence_id
      )
    `);
    const insertModuleDependent = this.db.prepare(`
      INSERT INTO module_dependents (
        repo_id, scan_id, module_id, dependent_module_id, edge_id
      )
      VALUES (
        @repo_id, @scan_id, @module_id, @dependent_module_id, @edge_id
      )
    `);
    const insertResolverDependency = this.db.prepare(`
      INSERT OR REPLACE INTO resolver_dependencies (
        repo_id, scan_id, id, source_path, dependency_path, dependency_kind
      )
      VALUES (
        @repo_id, @scan_id, @id, @source_path, @dependency_path, @dependency_kind
      )
    `);
    const graphNodesById = new Map(graphNodes.map((node) => [node.id, node]));

    this.db.transaction(() => {
      upsertArtifact.run({
        ...parsed,
        graph_json: stringifyJson(parsed.graph)
      });
      deleteNodes.run(parsed.repo_id, parsed.scan_id);
      deleteEdges.run(parsed.repo_id, parsed.scan_id);
      deleteEvidence.run(parsed.repo_id, parsed.scan_id);
      deleteDiagnostics.run(parsed.repo_id, parsed.scan_id);
      deleteCompleteness.run(parsed.repo_id, parsed.scan_id);
      deleteSymbolOccurrences.run(parsed.repo_id, parsed.scan_id);
      deleteModuleDependents.run(parsed.repo_id, parsed.scan_id);
      deleteResolverDependencies.run(parsed.repo_id, parsed.scan_id);
      for (const node of graphNodes) {
        insertNode.run({
          repo_id: parsed.repo_id,
          scan_id: parsed.scan_id,
          ...node,
          stable: node.stable ? 1 : 0,
          evidence_ids_json: stringifyJson(node.evidence_ids),
          metadata_json: stringifyJson(node.metadata)
        });
      }
      for (const edge of graphEdges) {
        insertEdge.run({
          repo_id: parsed.repo_id,
          scan_id: parsed.scan_id,
          id: edge.id,
          kind: edge.kind,
          from_node: edge.from,
          to_node: edge.to,
          evidence_ids_json: stringifyJson(edge.evidence_ids),
          metadata_json: stringifyJson(edge.metadata)
        });
        if (edge.kind === "MODULE_IMPORTS_MODULE") {
          insertModuleDependent.run({
            repo_id: parsed.repo_id,
            scan_id: parsed.scan_id,
            module_id: edge.to,
            dependent_module_id: edge.from,
            edge_id: edge.id
          });
        }
        const resolverDependency = resolverDependencyFromEdge(
          parsed.repo_id,
          parsed.scan_id,
          edge,
          graphNodesById
        );
        if (resolverDependency) {
          insertResolverDependency.run(resolverDependency);
        }
      }
      for (const evidence of graphEvidence) {
        insertEvidence.run({
          ...evidence,
          start_column: evidence.start_column ?? null,
          end_column: evidence.end_column ?? null,
          fact_ids_json: stringifyJson(evidence.fact_ids)
        });
      }
      for (const diagnostic of graphDiagnostics) {
        insertDiagnostic.run({
          repo_id: parsed.repo_id,
          scan_id: parsed.scan_id,
          ...diagnostic,
          file_path: diagnostic.file_path ?? null,
          evidence_ids_json: stringifyJson(diagnostic.evidence_ids)
        });
      }
      for (const [index, completeness] of graphCompleteness.entries()) {
        insertCompleteness.run({
          repo_id: parsed.repo_id,
          scan_id: parsed.scan_id,
          id: `completeness:${completeness.scope}:${completeness.rule_id ?? "all"}:${index}`,
          scope: completeness.scope,
          rule_id: completeness.rule_id ?? null,
          complete: completeness.complete ? 1 : 0,
          required_capabilities_json: stringifyJson(completeness.required_capabilities),
          missing_capabilities_json: stringifyJson(completeness.missing_capabilities),
          truncated: completeness.truncated ? 1 : 0,
          can_block: completeness.can_block ? 1 : 0,
          reasons_json: stringifyJson(completeness.reasons)
        });
      }
      for (const occurrence of symbolOccurrences) {
        insertSymbolOccurrence.run({
          ...occurrence,
          evidence_id: occurrence.evidence_id ?? null
        });
      }
    })();
  }

  getFactGraphArtifact(repoId: string, scanId: string): FactGraphArtifact | undefined {
    const row = this.db
      .prepare("SELECT * FROM fact_graph_artifacts WHERE repo_id = ? AND scan_id = ?")
      .get(repoId, scanId);
    return row ? factGraphArtifactFromRow(row) : undefined;
  }

  listGraphNodes(repoId: string, scanId: string): GraphNode[] {
    return this.db
      .prepare("SELECT * FROM graph_nodes WHERE repo_id = ? AND scan_id = ? ORDER BY kind, id")
      .all(repoId, scanId)
      .map(graphNodeFromRow);
  }

  listGraphEdges(repoId: string, scanId: string): GraphEdge[] {
    return this.db
      .prepare("SELECT * FROM graph_edges WHERE repo_id = ? AND scan_id = ? ORDER BY kind, id")
      .all(repoId, scanId)
      .map(graphEdgeFromRow);
  }

  listGraphEvidence(repoId: string, scanId: string): GraphEvidence[] {
    return this.db
      .prepare("SELECT * FROM graph_evidence WHERE repo_id = ? AND scan_id = ? ORDER BY file_path, start_line, id")
      .all(repoId, scanId)
      .map(graphEvidenceFromRow);
  }

  listGraphDiagnostics(repoId: string, scanId: string): GraphDiagnostic[] {
    return this.db
      .prepare("SELECT * FROM graph_diagnostics WHERE repo_id = ? AND scan_id = ? ORDER BY severity, id")
      .all(repoId, scanId)
      .map(graphDiagnosticFromRow);
  }

  listGraphCompleteness(repoId: string, scanId: string): GraphCompleteness[] {
    return this.db
      .prepare("SELECT * FROM graph_completeness WHERE repo_id = ? AND scan_id = ? ORDER BY scope, rule_id, id")
      .all(repoId, scanId)
      .map(graphCompletenessFromRow);
  }

  listResolverDependencies(repoId: string, scanId: string): ResolverDependency[] {
    return this.db
      .prepare("SELECT * FROM resolver_dependencies WHERE repo_id = ? AND scan_id = ? ORDER BY source_path, dependency_path, dependency_kind, id")
      .all(repoId, scanId)
      .map(resolverDependencyFromRow);
  }

  listModuleDependents(repoId: string, scanId: string): ModuleDependent[] {
    return this.db
      .prepare("SELECT * FROM module_dependents WHERE repo_id = ? AND scan_id = ? ORDER BY module_id, dependent_module_id, edge_id")
      .all(repoId, scanId)
      .map(moduleDependentFromRow);
  }

  listSymbolOccurrences(repoId: string, scanId: string): SymbolOccurrence[] {
    return this.db
      .prepare("SELECT * FROM symbol_occurrences WHERE repo_id = ? AND scan_id = ? ORDER BY file_path, start_line, symbol_id, occurrence_kind, id")
      .all(repoId, scanId)
      .map(symbolOccurrenceFromRow);
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

  deleteAcceptedConventionsExcept(repoId: string, conventionIds: string[]): number {
    const placeholders = conventionIds.map(() => "?").join(", ");
    const sql = conventionIds.length > 0
      ? `DELETE FROM accepted_conventions WHERE repo_id = ? AND id NOT IN (${placeholders})`
      : "DELETE FROM accepted_conventions WHERE repo_id = ?";
    const result = this.db.prepare(sql).run(repoId, ...conventionIds);
    return result.changes;
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
    const previousEventHash = this.latestAuditEventHash(parsed.repo_id);
    const eventWithHash: AuditEvent = {
      ...parsed,
      previous_event_hash: previousEventHash,
      event_hash: auditEventHash(parsed, previousEventHash)
    };
    try {
      this.db
        .prepare(`
          INSERT INTO audit_events (
            id, repo_id, actor, action, target_type, target_id, metadata_json,
            created_at, previous_event_hash, event_hash
          )
          VALUES (
            @id, @repo_id, @actor, @action, @target_type, @target_id, @metadata_json,
            @created_at, @previous_event_hash, @event_hash
          )
        `)
        .run({
          ...eventWithHash,
          metadata_json: stringifyJson(eventWithHash.metadata)
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
      .prepare("SELECT * FROM audit_events WHERE repo_id = ? ORDER BY created_at, rowid")
      .all(repoId)
      .map(auditEventFromRow);
  }

  verifyAuditChain(repoId: string): AuditChainVerification {
    const events = this.db
      .prepare("SELECT * FROM audit_events WHERE repo_id = ? ORDER BY rowid")
      .all(repoId)
      .map(auditEventFromRow);
    let previousEventHash: string | null = null;
    let verifiedCount = 0;

    for (const event of events) {
      if ((event.previous_event_hash ?? null) !== previousEventHash) {
        return {
          repo_id: repoId,
          valid: false,
          event_count: events.length,
          verified_count: verifiedCount,
          head_event_hash: previousEventHash,
          broken_at_event_id: event.id,
          reasons: ["previous_event_hash_mismatch"]
        };
      }

      if (!event.event_hash) {
        return {
          repo_id: repoId,
          valid: false,
          event_count: events.length,
          verified_count: verifiedCount,
          head_event_hash: previousEventHash,
          broken_at_event_id: event.id,
          reasons: ["event_hash_missing"]
        };
      }

      const expectedHash = auditEventHash(event, previousEventHash);
      if (event.event_hash !== expectedHash) {
        return {
          repo_id: repoId,
          valid: false,
          event_count: events.length,
          verified_count: verifiedCount,
          head_event_hash: previousEventHash,
          broken_at_event_id: event.id,
          reasons: ["event_hash_mismatch"]
        };
      }

      verifiedCount += 1;
      previousEventHash = event.event_hash;
    }

    return {
      repo_id: repoId,
      valid: true,
      event_count: events.length,
      verified_count: verifiedCount,
      head_event_hash: previousEventHash,
      broken_at_event_id: null,
      reasons: []
    };
  }

  private latestAuditEventHash(repoId: string): string | null {
    const row = this.db
      .prepare("SELECT event_hash FROM audit_events WHERE repo_id = ? ORDER BY rowid DESC LIMIT 1")
      .get(repoId);
    if (!row) {
      return null;
    }
    return rowValue<string | null>(row, "event_hash") ?? null;
  }

  checkpoint(): void {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
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

function fileSnapshotFromRow(row: unknown): FileSnapshot {
  const record = row as Record<string, unknown>;
  return FileSnapshotSchema.parse({
    ...record,
    indexed: record.indexed === 1
  });
}

function scanFileChangeFromRow(row: unknown): ScanFileChange {
  const record = row as Record<string, unknown>;
  return ScanFileChangeSchema.parse({
    ...record,
    previous_hash: record.previous_hash ?? undefined,
    current_hash: record.current_hash ?? undefined
  });
}

function factGraphArtifactFromRow(row: unknown): FactGraphArtifact {
  const record = row as Record<string, unknown>;
  return FactGraphArtifactSchema.parse({
    ...record,
    graph: parseJsonObject(record.graph_json)
  });
}

function graphNodeFromRow(row: unknown): GraphNode {
  const record = row as Record<string, unknown>;
  return GraphNodeSchema.parse({
    id: record.id,
    kind: record.kind,
    label: record.label,
    stable: record.stable === 1,
    evidence_ids: parseJsonArray(record.evidence_ids_json),
    metadata: parseJsonObject(record.metadata_json)
  });
}

function graphEdgeFromRow(row: unknown): GraphEdge {
  const record = row as Record<string, unknown>;
  return GraphEdgeSchema.parse({
    id: record.id,
    kind: record.kind,
    from: record.from_node,
    to: record.to_node,
    evidence_ids: parseJsonArray(record.evidence_ids_json),
    metadata: parseJsonObject(record.metadata_json)
  });
}

function graphEvidenceFromRow(row: unknown): GraphEvidence {
  const record = row as Record<string, unknown>;
  return GraphEvidenceSchema.parse({
    ...record,
    start_column: record.start_column ?? undefined,
    end_column: record.end_column ?? undefined,
    fact_ids: parseJsonArray(record.fact_ids_json)
  });
}

function graphDiagnosticFromRow(row: unknown): GraphDiagnostic {
  const record = row as Record<string, unknown>;
  return GraphDiagnosticSchema.parse({
    ...record,
    file_path: record.file_path ?? undefined,
    evidence_ids: parseJsonArray(record.evidence_ids_json)
  });
}

function graphCompletenessFromRow(row: unknown): GraphCompleteness {
  const record = row as Record<string, unknown>;
  return GraphCompletenessSchema.parse({
    scope: record.scope,
    rule_id: record.rule_id ?? undefined,
    complete: record.complete === 1,
    required_capabilities: parseJsonArray(record.required_capabilities_json),
    missing_capabilities: parseJsonArray(record.missing_capabilities_json),
    truncated: record.truncated === 1,
    can_block: record.can_block === 1,
    reasons: parseJsonArray(record.reasons_json)
  });
}

function resolverDependencyFromRow(row: unknown): ResolverDependency {
  return ResolverDependencySchema.parse(row);
}

function moduleDependentFromRow(row: unknown): ModuleDependent {
  return ModuleDependentSchema.parse(row);
}

function symbolOccurrenceFromRow(row: unknown): SymbolOccurrence {
  const record = row as Record<string, unknown>;
  return SymbolOccurrenceSchema.parse({
    ...record,
    evidence_id: record.evidence_id ?? undefined
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

function uniqueById<T extends { id: string }>(records: T[]): T[] {
  return [...new Map(records.map((record) => [record.id, record])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
}

function mergeGraphNodesById(records: GraphNode[]): GraphNode[] {
  const merged = new Map<string, GraphNode>();
  for (const record of records) {
    const existing = merged.get(record.id);
    merged.set(record.id, existing
      ? {
        ...existing,
        ...record,
        evidence_ids: sortedUnique([...existing.evidence_ids, ...record.evidence_ids]),
        metadata: { ...existing.metadata, ...record.metadata }
      }
      : record);
  }
  return uniqueById([...merged.values()]);
}

function mergeGraphEdgesById(records: GraphEdge[]): GraphEdge[] {
  const merged = new Map<string, GraphEdge>();
  for (const record of records) {
    const existing = merged.get(record.id);
    merged.set(record.id, existing
      ? {
        ...existing,
        ...record,
        evidence_ids: sortedUnique([...existing.evidence_ids, ...record.evidence_ids]),
        metadata: { ...existing.metadata, ...record.metadata }
      }
      : record);
  }
  return uniqueById([...merged.values()]);
}

function mergeGraphEvidenceById(records: GraphEvidence[]): GraphEvidence[] {
  const merged = new Map<string, GraphEvidence>();
  for (const record of records) {
    const existing = merged.get(record.id);
    merged.set(record.id, existing
      ? {
        ...existing,
        ...record,
        fact_ids: sortedUnique([...existing.fact_ids, ...record.fact_ids])
      }
      : record);
  }
  return uniqueById([...merged.values()]);
}

function mergeGraphDiagnosticsById(records: GraphDiagnostic[]): GraphDiagnostic[] {
  const merged = new Map<string, GraphDiagnostic>();
  for (const record of records) {
    const existing = merged.get(record.id);
    merged.set(record.id, existing
      ? {
        ...existing,
        ...record,
        evidence_ids: sortedUnique([...existing.evidence_ids, ...record.evidence_ids])
      }
      : record);
  }
  return uniqueById([...merged.values()]);
}

function symbolOccurrencesFromGraph(
  repoId: string,
  scanId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  evidence: GraphEvidence[]
): SymbolOccurrence[] {
  const occurrences = new Map<string, SymbolOccurrence>();
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const addOccurrence = (occurrence: SymbolOccurrence): void => {
    occurrences.set(occurrence.id, SymbolOccurrenceSchema.parse(occurrence));
  };

  for (const node of nodes) {
    if (node.kind !== "symbol") {
      continue;
    }
    for (const evidenceId of node.evidence_ids) {
      const evidenceItem = evidenceById.get(evidenceId);
      if (!evidenceItem) {
        continue;
      }
      addOccurrence({
        repo_id: repoId,
        scan_id: scanId,
        id: `symbol_occurrence:${node.id}:declaration:${evidenceId}`,
        symbol_id: node.id,
        occurrence_kind: "declaration",
        file_path: evidenceItem.file_path,
        start_line: evidenceItem.start_line,
        end_line: evidenceItem.end_line,
        evidence_id: evidenceId
      });
    }
  }

  for (const edge of edges) {
    if (edge.kind !== "IMPORT_RESOLVES_TO_SYMBOL") {
      continue;
    }
    const symbol = nodeById.get(edge.to);
    if (symbol?.kind !== "symbol") {
      continue;
    }
    for (const evidenceId of edge.evidence_ids) {
      const evidenceItem = evidenceById.get(evidenceId);
      if (!evidenceItem) {
        continue;
      }
      addOccurrence({
        repo_id: repoId,
        scan_id: scanId,
        id: `symbol_occurrence:${edge.to}:reference:${edge.id}:${evidenceId}`,
        symbol_id: edge.to,
        occurrence_kind: "reference",
        file_path: evidenceItem.file_path,
        start_line: evidenceItem.start_line,
        end_line: evidenceItem.end_line,
        evidence_id: evidenceId
      });
    }
  }

  const symbolByImport = new Map(
    edges
      .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_SYMBOL")
      .map((edge) => [edge.from, edge.to])
  );
  for (const edge of edges) {
    if (edge.kind !== "CALLSITE_REFERENCES_SYMBOL") {
      continue;
    }
    const symbolId = symbolByImport.get(edge.to) ?? (nodeById.get(edge.to)?.kind === "symbol" ? edge.to : undefined);
    if (!symbolId) {
      continue;
    }
    for (const evidenceId of edge.evidence_ids) {
      const evidenceItem = evidenceById.get(evidenceId);
      if (!evidenceItem) {
        continue;
      }
      addOccurrence({
        repo_id: repoId,
        scan_id: scanId,
        id: `symbol_occurrence:${symbolId}:reference:${edge.id}:${evidenceId}`,
        symbol_id: symbolId,
        occurrence_kind: "reference",
        file_path: evidenceItem.file_path,
        start_line: evidenceItem.start_line,
        end_line: evidenceItem.end_line,
        evidence_id: evidenceId
      });
    }
  }

  return [...occurrences.values()].sort((left, right) =>
    left.file_path.localeCompare(right.file_path) ||
    left.start_line - right.start_line ||
    left.symbol_id.localeCompare(right.symbol_id) ||
    left.occurrence_kind.localeCompare(right.occurrence_kind) ||
    left.id.localeCompare(right.id)
  );
}

function resolverDependencyFromEdge(
  repoId: string,
  scanId: string,
  edge: GraphEdge,
  nodesById: Map<string, GraphNode>
): ResolverDependency | undefined {
  if (edge.kind !== "IMPORT_RESOLVES_TO_MODULE") {
    return undefined;
  }
  const importNode = nodesById.get(edge.from);
  const targetNode = nodesById.get(edge.to);
  const sourcePath = stringMetadata(importNode, "file_path") ??
    stringMetadataValue(edge.metadata, "source_path");
  const dependencyPath = stringMetadataValue(edge.metadata, "resolved_file_path") ??
    stringMetadata(importNode, "resolved_file_path") ??
    stringMetadata(targetNode, "file_path");
  if (!sourcePath || !dependencyPath) {
    return undefined;
  }
  const dependencyKind = stringMetadataValue(edge.metadata, "dependency_kind") ?? "resolved_module";
  return ResolverDependencySchema.parse({
    repo_id: repoId,
    scan_id: scanId,
    id: `resolver_dependency:${sourcePath}:${dependencyPath}:${dependencyKind}`,
    source_path: sourcePath,
    dependency_path: dependencyPath,
    dependency_kind: dependencyKind
  });
}

function stringMetadata(node: GraphNode | undefined, key: string): string | undefined {
  return node ? stringMetadataValue(node.metadata, key) : undefined;
}

function stringMetadataValue(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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
