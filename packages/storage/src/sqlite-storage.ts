import Database from "better-sqlite3";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AuditChainVerification,
  AuditEvent,
  AcceptedConvention,
  BackupManifest,
  BaselineViolation,
  CheckRun,
  ConventionCandidate,
  ConventionStatus,
  FactKind,
  FactRecord,
  FileSnapshot,
  Finding,
  FrameworkAdapter,
  FrameworkCapability,
  FrameworkParserGap,
  ModuleDependent,
  NormalizedEntrypointFact,
  ParserGap,
  ParserGapV2,
  RepoContract,
  RepoRecord,
  RequiredCheckExecution,
  ResolverDependency,
  SecurityBoundaryProof,
  ScanCapabilityReport,
  ScanFileChange,
  ScanManifest,
  SymbolIdentity,
  SymbolOccurrence
} from "@drift/core";
import {
  AuditEventSchema,
  AcceptedConventionSchema,
  BackupManifestSchema,
  BaselineViolationSchema,
  CheckRunSchema,
  ConventionCandidateSchema,
  FactRecordSchema,
  FileSnapshotSchema,
  FindingSchema,
  FrameworkAdapterSchema,
  FrameworkCapabilitySchema,
  FrameworkParserGapSchema,
  ModuleDependentSchema,
  NormalizedEntrypointFactSchema,
  ParserGapSchema,
  ParserGapV2Schema,
  RepoContractSchema,
  RepoRecordSchema,
  RequiredCheckExecutionSchema,
  ResolverDependencySchema,
  SecurityBoundaryProofSchema,
  ScanCapabilityReportSchema,
  ScanFileChangeSchema,
  ScanManifestSchema,
  SymbolIdentitySchema,
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
import { DatabaseIntegrityError, StoredBlobCorruptionError } from "./corruption.js";
import { MIGRATIONS, type Migration } from "./migrations.js";

export interface DriftStorageOptions {
  databasePath: string;
  /**
   * Run `PRAGMA quick_check` before serving from this database and fail closed with a
   * corrupt-database error if it reports damage (F-3a).
   *
   * Verification is cached per process: an unchanged file (same size/mtime for the db and its
   * -wal) is not re-scanned, and a changed file is re-verified at most once per
   * {@link INTEGRITY_REVERIFY_INTERVAL_MS} so a busy writer cannot turn every open into a full
   * b-tree walk (measured 2.2s on a 489MB indexed database). Default off: the CLI's single-file
   * check has a <1s hot-path budget (G3) that an unconditional walk would blow; the MCP serve
   * path - where R-3 verified incomplete data being served as success - enables it.
   */
  integrityGuard?: boolean;
}

/** A non-fatal condition observed while opening the database. */
export interface StorageOpenDiagnostic {
  code: "wal_recovery_discarded_commits";
  severity: "warning";
  message: string;
}

export interface StoredSecurityBoundaryProofRun {
  storage_id: string;
  proof_id: string;
  repo_id: string;
  scan_id: string;
  check_id: string;
  route_id: string;
  file_path: string;
  contract_kinds: string[];
  capability_names: string[];
  proof_status: "proven" | "violated" | "missing_proof" | "parser_gap" | "advisory_only";
  enforcement_result: "pass" | "brief" | "warn" | "block";
  parser_gap_count: number;
  missing_proof_count: number;
  affected_files: string[];
  proof: SecurityBoundaryProof;
  created_at: string;
}

type DatabaseHandle = Database.Database;

export class SqliteDriftStorage {
  private readonly db: DatabaseHandle;

  /**
   * The database's `auto_vacuum` mode as observed at open: 0 NONE, 1 FULL, 2 INCREMENTAL.
   * Recorded because it decides whether pruning can return pages by itself (INCREMENTAL) or needs
   * the one-time `reclaimDiskSpace()` migration first (NONE, every pre-EW-8 database).
   */
  private readonly autoVacuumMode: number;

  /**
   * Non-fatal conditions observed while opening. Currently only WAL-recovery data loss (F-3b):
   * SQLite recovers a write-ahead log by replaying frames until the first invalid one and says
   * nothing about what it left behind, so committed transactions can vanish with exit 0
   * everywhere. Callers surface these as warnings.
   */
  readonly openDiagnostics: readonly StorageOpenDiagnostic[];

  constructor(options: DriftStorageOptions) {
    // Snapshot the WAL's frame headers BEFORE SQLite opens (and thereby recovers) the log, so
    // recovery's discards are observable afterwards. Byte reads of frame headers only - no
    // checksum math, no page images.
    const walScan = scanWalFrameHeaders(options.databasePath);
    this.db = new Database(options.databasePath);
    // EW-8: incremental auto-vacuum, so freed pages can be returned to the OS.
    //
    // Pruning bounds growth by reusing freed pages, which meets the stated goal - but the file
    // never shrinks, so a user sees a 1.5 GB directory after Drift has finished with the data. For
    // a local-first tool, disk returned is the user-visible property, and 59% of free pages were
    // measured never going back.
    //
    // This MUST precede `journal_mode`. `auto_vacuum` lives in the database header and can only be
    // changed while the header is still unwritten; setting the journal mode writes it, after which
    // the pragma is silently accepted and silently ignored - measured directly: WAL first leaves
    // auto_vacuum at 0 with no error, auto_vacuum first leaves it at 2. A silently ignored pragma
    // is the worst shape available here, because every later `incremental_vacuum` would also
    // succeed and reclaim nothing.
    //
    // It is also a no-op on a database that already has tables, which is every pre-EW-8 database.
    // Those take the explicit `reclaimDiskSpace()` path, opt-in because it needs a full VACUUM.
    this.autoVacuumMode = enableIncrementalAutoVacuum(this.db);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // Three processes can legitimately hold this database at once: an edit-time hook running
    // `drift check`, a developer running the CLI, and an agent holding the MCP server open. WAL
    // keeps readers from blocking the writer, but two writers still collide - and without a
    // busy timeout SQLite fails immediately with SQLITE_BUSY, which would surface to the user
    // as a crash rather than a brief wait. Five seconds comfortably covers a single-file check.
    this.db.pragma("busy_timeout = 5000");
    this.openDiagnostics = walRecoveryDiagnostics(this.db, options.databasePath, walScan);
    if (options.integrityGuard) {
      runIntegrityGuard(this.db, options.databasePath);
    }
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(this.getAppliedMigrations());

    // Refuse a database written by a newer Drift.
    //
    // Migrations are tracked by id and applied forward-only, which handles upgrades correctly.
    // The reverse was unguarded: an older build opening a newer database sees only ids it does
    // not recognise, finds all of *its* migrations already applied, applies nothing, and then
    // operates against a schema containing tables and columns it knows nothing about. That is a
    // silent wrong answer rather than a failure, so it fails closed instead.
    const known = new Set(MIGRATIONS.map((migration) => migration.id));
    const unknown = [...applied].filter((id) => !known.has(id)).sort();
    if (unknown.length > 0) {
      throw new Error(
        `Unsupported local state schema: this database was written by a newer version of Drift ` +
          `(unrecognised migrations: ${unknown.slice(0, 3).join(", ")}` +
          `${unknown.length > 3 ? `, +${unknown.length - 3} more` : ""}). ` +
          `Upgrade Drift, or point --db at a different path.`
      );
    }

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
    if (migration.id === "010_audit_sequence") {
      this.applyAuditSequenceMigration();
      return;
    }
    if (migration.id === "023_parser_gap_v2_metadata") {
      this.applyParserGapV2Migration();
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

  private applyAuditSequenceMigration(): void {
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

    if (!this.auditEventsColumnExists("sequence")) {
      this.db.exec("ALTER TABLE audit_events ADD COLUMN sequence INTEGER;");
    }

    const repoRows = this.db
      .prepare("SELECT DISTINCT repo_id FROM audit_events ORDER BY repo_id")
      .all();
    for (const repoRow of repoRows) {
      const repoId = rowValue<string>(repoRow, "repo_id");
      const eventRows = this.db
        .prepare("SELECT rowid FROM audit_events WHERE repo_id = ? ORDER BY rowid")
        .all(repoId);
      let sequence = 1;
      for (const eventRow of eventRows) {
        this.db
          .prepare("UPDATE audit_events SET sequence = ? WHERE rowid = ? AND sequence IS NULL")
          .run(sequence, rowValue<number>(eventRow, "rowid"));
        sequence += 1;
      }
    }

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_repo_sequence
        ON audit_events(repo_id, sequence)
        WHERE sequence IS NOT NULL;
    `);
  }

  private auditEventsColumnExists(columnName: string): boolean {
    return this.db
      .prepare("PRAGMA table_info(audit_events)")
      .all()
      .some((row) => rowValue<string>(row, "name") === columnName);
  }

  private applyParserGapV2Migration(): void {
    this.db.exec(`
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
    `);
    for (const [column, definition] of [
      ["source_text_hash", "TEXT"],
      ["affected_capabilities_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["affected_contract_kinds_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["suggested_action", "TEXT"]
    ] as const) {
      if (!this.parserGapsColumnExists(column)) {
        this.db.exec(`ALTER TABLE parser_gaps ADD COLUMN ${column} ${definition};`);
      }
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_parser_gaps_repo_capability
        ON parser_gaps(repo_id, scan_id);
    `);
  }

  private parserGapsColumnExists(columnName: string): boolean {
    return this.db
      .prepare("PRAGMA table_info(parser_gaps)")
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
        INSERT INTO repos (
          id, root_path, fingerprint, vcs_provider, remote_url_hash, package_manager,
          lockfile_hashes_json, resolver_input_hash, created_at, updated_at
        )
        VALUES (
          @id, @root_path, @fingerprint, @vcs_provider, @remote_url_hash, @package_manager,
          @lockfile_hashes_json, @resolver_input_hash, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          root_path = excluded.root_path,
          fingerprint = excluded.fingerprint,
          vcs_provider = excluded.vcs_provider,
          remote_url_hash = excluded.remote_url_hash,
          package_manager = excluded.package_manager,
          lockfile_hashes_json = excluded.lockfile_hashes_json,
          resolver_input_hash = excluded.resolver_input_hash,
          updated_at = excluded.updated_at
      `)
      .run({
        ...parsed,
        vcs_provider: parsed.vcs_provider ?? null,
        remote_url_hash: parsed.remote_url_hash ?? null,
        package_manager: parsed.package_manager ?? null,
        lockfile_hashes_json: stringifyJson(parsed.lockfile_hashes ?? {}),
        resolver_input_hash: parsed.resolver_input_hash ?? null
      });
  }

  getRepo(id: string): RepoRecord | undefined {
    const row = this.db.prepare("SELECT * FROM repos WHERE id = ?").get(id);
    return row ? repoRecordFromRow(row) : undefined;
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

  /**
   * Delete scans that nothing needs any more.
   *
   * Every `drift start` appends a complete fact set and graph artifact and nothing ever removed
   * them: five consecutive runs on dub produced a 1,963 MB database - 393 MB per run, linear. A
   * beta user re-scanning daily reaches multi-gigabyte state inside a week, which is an adoption
   * problem for a tool whose pitch is that it lives on your machine.
   *
   * Retention is deliberately conservative, because deleting a scan someone still needs is far
   * worse than keeping one nobody does:
   *
   *   - the newest `keep` scans, always
   *   - any scan referenced by a finding, a baseline entry, or a check run
   *   - any scan another retained scan names as its `previous_scan_id`, so the reuse chain the
   *     incremental path walks is never broken mid-way
   *
   * Measured separately and worth recording: stored scan count does **not** affect check latency
   * (2.7s on dub at both 2 and 10 scans). This is a footprint fix, not a speed one - so it does
   * not need to be aggressive to be worth doing.
   */
  pruneSupersededScans(
    repoId: string,
    options: {
      keep?: number;
      /**
       * EW-8: free space on the volume, when the caller knows it.
       *
       * Supplied, a pre-EW-8 database (`auto_vacuum = NONE`) is upgraded to incremental mode on the
       * spot - but only when there is room for the full VACUUM that requires *and* the scan floor
       * left over afterwards. Omitted, no upgrade is attempted and the database keeps its old
       * behaviour of bounded-but-never-shrinking growth.
       *
       * This is the "existing databases upgrade or decline" half of EW-8. It is conditional rather
       * than unconditional because a full VACUUM wants roughly twice the database's size in scratch
       * space, and doing that unasked on a machine near the disk floor is the hazard, not the fix.
       */
      availableBytes?: number;
    } = {}
  ): {
    deleted: string[];
    kept: number;
    /** EW-8: bytes handed back to the OS. */
    reclaimed_bytes: number;
    /** EW-8: what the reclaim did - `none` when a pre-EW-8 database had no room to upgrade. */
    reclaim_performed: "none" | "incremental" | "full_vacuum";
    /** EW-8: why no disk came back, when none did. Null when there was nothing to explain. */
    reclaim_declined_reason: string | null;
  } {
    const keep = Math.max(1, options.keep ?? 2);
    const scans = this.listScanManifests(repoId);
    if (scans.length <= keep) {
      return {
        deleted: [],
        kept: scans.length,
        reclaimed_bytes: 0,
        reclaim_performed: "none",
        reclaim_declined_reason: null
      };
    }

    const ordered = [...scans].sort((a, b) =>
      (b.completed_at ?? b.started_at ?? "").localeCompare(a.completed_at ?? a.started_at ?? "")
    );
    const retained = new Set(ordered.slice(0, keep).map((scan) => scan.id));

    const referenced = (table: string, column = "scan_id") => {
      try {
        for (const row of this.db
          .prepare(`SELECT DISTINCT ${column} AS id FROM ${table} WHERE repo_id = ?`)
          .all(repoId) as Array<{ id: string | null }>) {
          if (row.id) {
            retained.add(row.id);
          }
        }
      } catch {
        /* table absent in this schema version */
      }
    };
    // Anything a human or a governance decision points at must survive.
    referenced("findings");
    referenced("baseline_violations", "first_seen_scan_id");
    referenced("check_runs");

    // Keep the newest scan's immediate predecessor, and only that.
    //
    // Walking the chain transitively retains the entire history - every scan names the last one,
    // so following the links from all retained scans keeps everything and prunes nothing. Reuse
    // needs one step back from the newest scan, which is what this preserves.
    const newestPredecessor = ordered[0]?.previous_scan_id;
    if (newestPredecessor) {
      retained.add(newestPredecessor);
    }

    const doomed = ordered.filter((scan) => !retained.has(scan.id)).map((scan) => scan.id);
    if (doomed.length === 0) {
      // Nothing deleted, but pages freed by an earlier run may still be sitting in the file - a
      // scan that overwrites a row frees its old page whether or not any scan was pruned.
      const idle = this.reclaimAfterPrune(options.availableBytes);
      return { deleted: [], kept: retained.size, ...idle };
    }

    const scanTables = this.tablesWithScanId().filter((table) => table !== "scan_manifests");
    const placeholders = doomed.map(() => "?").join(", ");
    this.db.transaction(() => {
      for (const table of scanTables) {
        this.db
          .prepare(`DELETE FROM ${table} WHERE repo_id = ? AND scan_id IN (${placeholders})`)
          .run(repoId, ...doomed);
      }
      this.db
        .prepare(`DELETE FROM scan_manifests WHERE repo_id = ? AND id IN (${placeholders})`)
        .run(repoId, ...doomed);
    })();

    // The predecessor is kept only so incremental reuse has its facts. The reuse manifest carries
    // facts and file snapshots and nothing else (see createScanReuseManifest), so that scan's
    // graph - nodes, edges, evidence, which is the bulk of it - serves no purpose. Dropping it
    // keeps reuse working while roughly halving what a retained predecessor costs.
    const predecessorOnly = newestPredecessor && retained.has(newestPredecessor)
      ? [newestPredecessor]
      : [];
    if (predecessorOnly.length > 0 && ordered[0]?.id !== newestPredecessor) {
      const graphOnlyTables = [
        "graph_nodes",
        "graph_edges",
        "graph_evidence",
        "graph_completeness",
        "fact_graph_artifacts",
        "symbol_occurrences"
      ];
      this.db.transaction(() => {
        for (const table of graphOnlyTables) {
          try {
            this.db
              .prepare(`DELETE FROM ${table} WHERE repo_id = ? AND scan_id = ?`)
              .run(repoId, newestPredecessor);
          } catch {
            /* table absent in this schema version */
          }
        }
      })();
    }

    // EW-8: return the freed pages to the OS, incrementally.
    //
    // Still deliberately not a full VACUUM. That rewrites the whole database and needs roughly
    // twice its size in free space; on a 786 MB database that is 1.5 GB of headroom demanded
    // during a scan, and it failed here with a disk I/O error on the third consecutive run -
    // turning housekeeping into the very disk-exhaustion failure T41 exists to prevent.
    //
    // `incremental_vacuum` is the version that fits the constraint: it moves free pages to the end
    // of the file and truncates, page by page, needing no scratch copy. It is also why the
    // previous reasoning was not quite enough - "freed pages are reused, so growth is bounded" is
    // true and answers a different question than "does the user get their disk back".
    const reclaim = this.reclaimAfterPrune(options.availableBytes);

    return { deleted: doomed, kept: retained.size, ...reclaim };
  }

  /**
   * Return disk after a prune, upgrading a pre-EW-8 database first when there is provably room.
   *
   * The upgrade is a full VACUUM, so it happens only with `availableBytes` in hand and only when that
   * covers the rewrite *and* leaves the scan floor free. Otherwise it declines and says why, which is
   * the message a user needs to understand why their state directory is not shrinking.
   */
  private reclaimAfterPrune(availableBytes?: number): {
    reclaimed_bytes: number;
    reclaim_performed: "none" | "incremental" | "full_vacuum";
    reclaim_declined_reason: string | null;
  } {
    if (this.autoVacuumMode === AUTO_VACUUM_INCREMENTAL) {
      return {
        reclaimed_bytes: this.reclaimFreePages(),
        reclaim_performed: "incremental",
        reclaim_declined_reason: null
      };
    }
    if (availableBytes === undefined) {
      return {
        reclaimed_bytes: 0,
        reclaim_performed: "none",
        reclaim_declined_reason:
          "this database predates incremental vacuum and free space was not measured, so no " +
          "one-time upgrade was attempted; growth stays bounded but the file will not shrink"
      };
    }
    const result = this.reclaimDiskSpace({
      availableBytes,
      // Leave the scan floor free afterwards. Finishing with a smaller database and no room to scan
      // it is not an improvement.
      minimumFreeBytes: RECLAIM_HEADROOM_BYTES
    });
    return {
      reclaimed_bytes: result.reclaimed_bytes,
      reclaim_performed: result.performed,
      reclaim_declined_reason: result.refused_reason
    };
  }

  /**
   * Return free pages to the OS without a full rewrite. Returns bytes reclaimed.
   *
   * A no-op returning 0 on a database whose `auto_vacuum` is NONE - which is every database
   * created before EW-8. Those need `reclaimDiskSpace()` once; there is deliberately no automatic
   * upgrade, because the upgrade requires a full VACUUM and doing that unbidden inside a scan is
   * exactly the hazard this design avoids.
   */
  private reclaimFreePages(): number {
    if (this.autoVacuumMode !== AUTO_VACUUM_INCREMENTAL) {
      return 0;
    }
    const before = this.databaseFileBytes();
    try {
      // Checkpoint first: pages freed inside the WAL are not free in the main database until the
      // WAL is folded back into it, so vacuuming before this reclaims almost nothing.
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      this.db.pragma("incremental_vacuum");
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // Housekeeping must never fail a scan that succeeded. A database that could not be shrunk
      // is a larger file, which the next scan will try again.
      return 0;
    }
    return Math.max(0, before - this.databaseFileBytes());
  }

  /** On-disk size of the database and its WAL - the number a user sees in a file listing. */
  private databaseFileBytes(): number {
    const path = this.db.name;
    let total = 0;
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      try {
        total += statSync(candidate).size;
      } catch {
        /* absent */
      }
    }
    return total;
  }

  /**
   * The one-time opt-in reclaim for a database created before EW-8.
   *
   * Enabling `auto_vacuum=INCREMENTAL` on an existing database is not a pragma change: SQLite only
   * applies it during a full VACUUM, so the upgrade *is* a full VACUUM. That needs roughly twice
   * the database's size in temporary space, which is why it is opt-in and why it checks free space
   * first and refuses rather than attempting it - a reclaim that fills the disk is worse than a
   * large file, and "ran out of space during cleanup" is the failure mode T41 exists to prevent.
   */
  reclaimDiskSpace(options: { availableBytes?: number; minimumFreeBytes?: number } = {}): {
    reclaimed_bytes: number;
    performed: "none" | "incremental" | "full_vacuum";
    refused_reason: string | null;
    required_bytes: number;
  } {
    const before = this.databaseFileBytes();
    if (this.autoVacuumMode === AUTO_VACUUM_INCREMENTAL) {
      // Already incremental: nothing to migrate, and the cheap reclaim is always available.
      return {
        reclaimed_bytes: this.reclaimFreePages(),
        performed: "incremental",
        refused_reason: null,
        required_bytes: 0
      };
    }

    // A full VACUUM writes a complete second copy before swapping, so the requirement is the
    // database's size again - plus whatever floor the caller insists on keeping free afterwards.
    const minimumFree = options.minimumFreeBytes ?? 0;
    const requiredBytes = before + minimumFree;
    const availableBytes = options.availableBytes ?? Number.POSITIVE_INFINITY;
    if (availableBytes < requiredBytes) {
      return {
        reclaimed_bytes: 0,
        performed: "none",
        refused_reason:
          `a full VACUUM needs about ${formatBytes(requiredBytes)} free ` +
          `(${formatBytes(before)} to copy the database, plus ${formatBytes(minimumFree)} kept free) ` +
          `and only ${formatBytes(availableBytes)} is available`,
        required_bytes: requiredBytes
      };
    }

    this.db.pragma(`auto_vacuum = ${AUTO_VACUUM_INCREMENTAL}`);
    this.db.exec("VACUUM");
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    return {
      reclaimed_bytes: Math.max(0, before - this.databaseFileBytes()),
      performed: "full_vacuum",
      refused_reason: null,
      required_bytes: requiredBytes
    };
  }

  /** Tables keyed by scan_id, read from the live schema rather than hardcoded. */
  private tablesWithScanId(): string[] {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    return tables
      .map((row) => row.name)
      .filter((name) => {
        const columns = this.db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
          name: string;
        }>;
        const names = new Set(columns.map((column) => column.name));
        return names.has("scan_id") && names.has("repo_id");
      });
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
        id, repo_id, scan_id, kind, file_path, name, value, imported_name, runtime_use,
        start_line, end_line,
        source_span_json, ast_node_kind, extraction_method, extractor_version, parser_version,
        confidence, confidence_label, evidence_level, resolution_status, staleness_status,
        last_seen_scan_id
      )
      VALUES (
        @id, @repo_id, @scan_id, @kind, @file_path, @name, @value, @imported_name, @runtime_use,
        @start_line, @end_line,
        @source_span_json, @ast_node_kind, @extraction_method, @extractor_version, @parser_version,
        @confidence, @confidence_label, @evidence_level, @resolution_status, @staleness_status,
        @last_seen_scan_id
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        file_path = excluded.file_path,
        name = excluded.name,
        value = excluded.value,
        imported_name = excluded.imported_name,
        runtime_use = excluded.runtime_use,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        source_span_json = excluded.source_span_json,
        ast_node_kind = excluded.ast_node_kind,
        extraction_method = excluded.extraction_method,
        extractor_version = excluded.extractor_version,
        parser_version = excluded.parser_version,
        confidence = excluded.confidence,
        confidence_label = excluded.confidence_label,
        evidence_level = excluded.evidence_level,
        resolution_status = excluded.resolution_status,
        staleness_status = excluded.staleness_status,
        last_seen_scan_id = excluded.last_seen_scan_id
    `);

    const transaction = this.db.transaction(() => {
      for (const fact of parsedFacts) {
        insert.run({
          ...fact,
          value: fact.value ?? null,
          imported_name: fact.imported_name ?? null,
          runtime_use: fact.runtime_use ?? null,
          ast_node_kind: fact.ast_node_kind ?? null,
          source_span_json: JSON.stringify(fact.source_span)
        });
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

  upsertFrameworkScanData(input: {
    repoId: string;
    scanId: string;
    adapters: FrameworkAdapter[];
    entrypoints: NormalizedEntrypointFact[];
    parserGaps: FrameworkParserGap[];
    capabilities: FrameworkCapability[];
  }): void {
    const adapters = input.adapters.map((adapter) => FrameworkAdapterSchema.parse(adapter));
    const entrypoints = input.entrypoints.map((entrypoint) => NormalizedEntrypointFactSchema.parse(entrypoint));
    const parserGaps = input.parserGaps.map((gap) => FrameworkParserGapSchema.parse(gap));
    const capabilities = input.capabilities.map((capability) => FrameworkCapabilitySchema.parse(capability));
    const deleteAdapters = this.db.prepare("DELETE FROM framework_adapters WHERE repo_id = ? AND scan_id = ?");
    const deleteEntrypoints = this.db.prepare("DELETE FROM normalized_entrypoints WHERE repo_id = ? AND scan_id = ?");
    const deleteParserGaps = this.db.prepare("DELETE FROM framework_parser_gaps WHERE repo_id = ? AND scan_id = ?");
    const deleteCapabilities = this.db.prepare("DELETE FROM framework_capabilities WHERE repo_id = ? AND scan_id = ?");
    const insertAdapter = this.db.prepare(`
      INSERT INTO framework_adapters (
        repo_id, scan_id, adapter_id, framework, adapter_json
      )
      VALUES (
        @repo_id, @scan_id, @adapter_id, @framework, @adapter_json
      )
    `);
    // Duplicate entrypoint ids must never abort onboarding. The engine dedupes at
    // emission (crates/drift-engine/src/frameworks/mod.rs); this is the second layer
    // so that any future producer bug degrades to a no-op write instead of a
    // `UNIQUE constraint failed` that leaves the repo with no database at all.
    const insertEntrypoint = this.db.prepare(`
      INSERT INTO normalized_entrypoints (
        repo_id, scan_id, entrypoint_id, adapter_id, framework, kind, file_path,
        route_pattern, method, entrypoint_json
      )
      VALUES (
        @repo_id, @scan_id, @entrypoint_id, @adapter_id, @framework, @kind, @file_path,
        @route_pattern, @method, @entrypoint_json
      )
      ON CONFLICT (repo_id, scan_id, entrypoint_id) DO NOTHING
    `);
    const insertParserGap = this.db.prepare(`
      INSERT INTO framework_parser_gaps (
        repo_id, scan_id, parser_gap_id, adapter_id, framework, file_path, code,
        blocks_enforcement, parser_gap_json
      )
      VALUES (
        @repo_id, @scan_id, @parser_gap_id, @adapter_id, @framework, @file_path, @code,
        @blocks_enforcement, @parser_gap_json
      )
    `);
    const insertCapability = this.db.prepare(`
      INSERT INTO framework_capabilities (
        repo_id, scan_id, adapter_id, framework, capability, status, can_block, capability_json
      )
      VALUES (
        @repo_id, @scan_id, @adapter_id, @framework, @capability, @status, @can_block, @capability_json
      )
    `);

    this.db.transaction(() => {
      deleteAdapters.run(input.repoId, input.scanId);
      deleteEntrypoints.run(input.repoId, input.scanId);
      deleteParserGaps.run(input.repoId, input.scanId);
      deleteCapabilities.run(input.repoId, input.scanId);
      for (const adapter of adapters) {
        insertAdapter.run({
          repo_id: input.repoId,
          scan_id: input.scanId,
          adapter_id: adapter.adapter_id,
          framework: adapter.framework,
          adapter_json: stringifyJson(adapter)
        });
      }
      for (const entrypoint of entrypoints) {
        insertEntrypoint.run({
          repo_id: entrypoint.repo_id,
          scan_id: entrypoint.scan_id,
          entrypoint_id: entrypoint.entrypoint_id,
          adapter_id: entrypoint.adapter_id,
          framework: entrypoint.framework,
          kind: entrypoint.kind,
          file_path: entrypoint.file_path,
          route_pattern: entrypoint.route_pattern ?? null,
          method: entrypoint.method ?? null,
          entrypoint_json: stringifyJson(entrypoint)
        });
      }
      for (const gap of parserGaps) {
        insertParserGap.run({
          repo_id: gap.repo_id,
          scan_id: gap.scan_id,
          parser_gap_id: gap.parser_gap_id,
          adapter_id: gap.adapter_id,
          framework: gap.framework ?? null,
          file_path: gap.file_path,
          code: gap.code,
          blocks_enforcement: gap.blocks_enforcement ? 1 : 0,
          parser_gap_json: stringifyJson(gap)
        });
      }
      for (const capability of capabilities) {
        insertCapability.run({
          repo_id: input.repoId,
          scan_id: input.scanId,
          adapter_id: capability.adapter_id,
          framework: capability.framework,
          capability: capability.capability,
          status: capability.status,
          can_block: capability.can_block ? 1 : 0,
          capability_json: stringifyJson(capability)
        });
      }
    })();
  }

  listFrameworkAdapters(repoId: string, scanId: string): FrameworkAdapter[] {
    return this.db
      .prepare("SELECT adapter_json FROM framework_adapters WHERE repo_id = ? AND scan_id = ? ORDER BY framework, adapter_id")
      .all(repoId, scanId)
      .map(frameworkAdapterFromRow);
  }

  listNormalizedEntrypoints(repoId: string, scanId: string): NormalizedEntrypointFact[] {
    return this.db
      .prepare("SELECT entrypoint_json FROM normalized_entrypoints WHERE repo_id = ? AND scan_id = ? ORDER BY framework, file_path, entrypoint_id")
      .all(repoId, scanId)
      .map(normalizedEntrypointFromRow);
  }

  listFrameworkParserGaps(repoId: string, scanId: string): FrameworkParserGap[] {
    return this.db
      .prepare("SELECT parser_gap_json FROM framework_parser_gaps WHERE repo_id = ? AND scan_id = ? ORDER BY file_path, parser_gap_id")
      .all(repoId, scanId)
      .map(frameworkParserGapFromRow);
  }

  listFrameworkCapabilities(repoId: string, scanId: string): FrameworkCapability[] {
    return this.db
      .prepare("SELECT capability_json FROM framework_capabilities WHERE repo_id = ? AND scan_id = ? ORDER BY framework, capability, adapter_id")
      .all(repoId, scanId)
      .map(frameworkCapabilityFromRow);
  }

  upsertParserGaps(gaps: ParserGap[]): void {
    const parsedGaps = deduplicateParserGaps(gaps.map((gap) => ParserGapSchema.parse(gap)));
    const insert = this.db.prepare(`
      INSERT INTO parser_gaps (
        gap_id, schema_version, repo_id, scan_id, kind, file_path, start_line, end_line,
        confidence_impact, message, evidence_refs_json, created_at
      )
      VALUES (
        @gap_id, @schema_version, @repo_id, @scan_id, @kind, @file_path, @start_line, @end_line,
        @confidence_impact, @message, @evidence_refs_json, @created_at
      )
      ON CONFLICT(gap_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        repo_id = excluded.repo_id,
        scan_id = excluded.scan_id,
        kind = excluded.kind,
        file_path = excluded.file_path,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        confidence_impact = excluded.confidence_impact,
        message = excluded.message,
        evidence_refs_json = excluded.evidence_refs_json,
        created_at = excluded.created_at
    `);

    const transaction = this.db.transaction(() => {
      for (const gap of parsedGaps) {
        insert.run({
          ...gap,
          evidence_refs_json: JSON.stringify(gap.evidence_refs)
        });
      }
    });
    transaction();
  }

  upsertParserGapV2(gaps: ParserGapV2[]): void {
    const parsedGaps = gaps.map((gap) => ParserGapV2Schema.parse(gap));
    const insert = this.db.prepare(`
      INSERT INTO parser_gaps (
        gap_id, schema_version, repo_id, scan_id, kind, file_path, start_line, end_line,
        confidence_impact, message, evidence_refs_json, created_at, source_text_hash,
        affected_capabilities_json, affected_contract_kinds_json, suggested_action
      )
      VALUES (
        @gap_id, @schema_version, @repo_id, @scan_id, @kind, @file_path, @start_line, @end_line,
        @confidence_impact, @message, @evidence_refs_json, @created_at, @source_text_hash,
        @affected_capabilities_json, @affected_contract_kinds_json, @suggested_action
      )
      ON CONFLICT(gap_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        repo_id = excluded.repo_id,
        scan_id = excluded.scan_id,
        kind = excluded.kind,
        file_path = excluded.file_path,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        confidence_impact = excluded.confidence_impact,
        message = excluded.message,
        evidence_refs_json = excluded.evidence_refs_json,
        source_text_hash = excluded.source_text_hash,
        affected_capabilities_json = excluded.affected_capabilities_json,
        affected_contract_kinds_json = excluded.affected_contract_kinds_json,
        suggested_action = excluded.suggested_action
    `);

    const transaction = this.db.transaction(() => {
      for (const gap of parsedGaps) {
        insert.run({
          ...gap,
          gap_id: gap.parser_gap_id,
          created_at: new Date(0).toISOString(),
          source_text_hash: gap.source_text_hash ?? null,
          evidence_refs_json: JSON.stringify(gap.evidence_refs),
          affected_capabilities_json: JSON.stringify(gap.affected_capabilities),
          affected_contract_kinds_json: JSON.stringify(gap.affected_contract_kinds)
        });
      }
    });
    transaction();
  }

  listParserGaps(repoId: string, scanId?: string): ParserGap[] {
    const rows = scanId
      ? this.db
          .prepare("SELECT * FROM parser_gaps WHERE repo_id = ? AND scan_id = ? AND schema_version = 'drift.parser_gap.v1' ORDER BY file_path, start_line, gap_id")
          .all(repoId, scanId)
      : this.db
          .prepare("SELECT * FROM parser_gaps WHERE repo_id = ? AND schema_version = 'drift.parser_gap.v1' ORDER BY scan_id, file_path, start_line, gap_id")
          .all(repoId);

    return rows.map(parserGapFromRow);
  }

  listParserGapV2(repoId: string, scanId?: string): ParserGapV2[] {
    const rows = scanId
      ? this.db
          .prepare("SELECT * FROM parser_gaps WHERE repo_id = ? AND scan_id = ? AND schema_version = 'drift.parser_gap.v2' ORDER BY file_path, start_line, gap_id")
          .all(repoId, scanId)
      : this.db
          .prepare("SELECT * FROM parser_gaps WHERE repo_id = ? AND schema_version = 'drift.parser_gap.v2' ORDER BY scan_id, file_path, start_line, gap_id")
          .all(repoId);

    return rows.map(parserGapV2FromRow);
  }

  upsertScanCapabilityReport(report: ScanCapabilityReport): void {
    const parsed = ScanCapabilityReportSchema.parse(report);
    this.db
      .prepare(`
        INSERT INTO scan_capability_reports (
          repo_id, scan_id, schema_version, engine_source, engine_version, scanner_version,
          adapter_versions_json, certified_capabilities_json, required_capabilities_json,
          missing_capabilities_json, completeness_json, parser_gap_count, parser_gap_kinds_json,
          fallback_used, enforcement_degraded, engine_resolution, engine_build_profile, created_at
        )
        VALUES (
          @repo_id, @scan_id, @schema_version, @engine_source, @engine_version, @scanner_version,
          @adapter_versions_json, @certified_capabilities_json, @required_capabilities_json,
          @missing_capabilities_json, @completeness_json, @parser_gap_count, @parser_gap_kinds_json,
          @fallback_used, @enforcement_degraded, @engine_resolution, @engine_build_profile, @created_at
        )
        ON CONFLICT(repo_id, scan_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          engine_source = excluded.engine_source,
          engine_version = excluded.engine_version,
          scanner_version = excluded.scanner_version,
          adapter_versions_json = excluded.adapter_versions_json,
          certified_capabilities_json = excluded.certified_capabilities_json,
          required_capabilities_json = excluded.required_capabilities_json,
          missing_capabilities_json = excluded.missing_capabilities_json,
          completeness_json = excluded.completeness_json,
          parser_gap_count = excluded.parser_gap_count,
          parser_gap_kinds_json = excluded.parser_gap_kinds_json,
          fallback_used = excluded.fallback_used,
          enforcement_degraded = excluded.enforcement_degraded,
          engine_resolution = excluded.engine_resolution,
          engine_build_profile = excluded.engine_build_profile,
          created_at = excluded.created_at
      `)
      .run({
        ...parsed,
        engine_version: parsed.engine_version ?? null,
        engine_resolution: parsed.engine_resolution ?? null,
        engine_build_profile: parsed.engine_build_profile ?? null,
        adapter_versions_json: stringifyJson(parsed.adapter_versions),
        certified_capabilities_json: stringifyJson(parsed.certified_capabilities),
        required_capabilities_json: stringifyJson(parsed.required_capabilities),
        missing_capabilities_json: stringifyJson(parsed.missing_capabilities),
        completeness_json: stringifyJson(parsed.completeness),
        parser_gap_kinds_json: stringifyJson(parsed.parser_gap_kinds),
        fallback_used: parsed.fallback_used ? 1 : 0,
        enforcement_degraded: parsed.enforcement_degraded ? 1 : 0
      });
  }

  getScanCapabilityReport(repoId: string, scanId: string): ScanCapabilityReport | undefined {
    const row = this.db
      .prepare("SELECT * FROM scan_capability_reports WHERE repo_id = ? AND scan_id = ?")
      .get(repoId, scanId);
    return row ? scanCapabilityReportFromRow(row) : undefined;
  }

  upsertSecurityBoundaryProofs(input: {
    repo_id: string;
    scan_id: string;
    proofs: SecurityBoundaryProof[];
    created_at: string;
  }): void {
    const proofs = input.proofs.map((proof) => SecurityBoundaryProofSchema.parse(proof));
    const insert = this.db.prepare(`
      INSERT INTO security_boundary_proofs (
        proof_id, repo_id, scan_id, route_id, file_path, contract_kinds_json,
        proof_status, enforcement_result, proof_json, created_at
      )
      VALUES (
        @proof_id, @repo_id, @scan_id, @route_id, @file_path, @contract_kinds_json,
        @proof_status, @enforcement_result, @proof_json, @created_at
      )
      ON CONFLICT(proof_id) DO UPDATE SET
        repo_id = excluded.repo_id,
        scan_id = excluded.scan_id,
        route_id = excluded.route_id,
        file_path = excluded.file_path,
        contract_kinds_json = excluded.contract_kinds_json,
        proof_status = excluded.proof_status,
        enforcement_result = excluded.enforcement_result,
        proof_json = excluded.proof_json,
        created_at = excluded.created_at
    `);
    const transaction = this.db.transaction(() => {
      for (const proof of proofs) {
        insert.run({
          proof_id: proof.proof_id,
          repo_id: input.repo_id,
          scan_id: input.scan_id,
          route_id: proof.route.route_id,
          file_path: proof.route.file_path,
          contract_kinds_json: stringifyJson(proof.contracts.map((contract) => contract.kind)),
          proof_status: proof.result.proof_status,
          enforcement_result: proof.result.enforcement_result,
          proof_json: stringifyJson(proof),
          created_at: input.created_at
        });
      }
    });
    transaction();
  }

  listSecurityBoundaryProofs(repoId: string, scanId?: string): SecurityBoundaryProof[] {
    const rows = scanId
      ? this.db
          .prepare("SELECT proof_json FROM security_boundary_proofs WHERE repo_id = ? AND scan_id = ? ORDER BY route_id, proof_id")
          .all(repoId, scanId)
      : this.db
          .prepare("SELECT proof_json FROM security_boundary_proofs WHERE repo_id = ? ORDER BY scan_id, route_id, proof_id")
          .all(repoId);

    return rows.map((row) =>
      SecurityBoundaryProofSchema.parse(
        parseStoredJson(rowValue<string>(row, "proof_json"), "security_boundary_proofs.proof_json")
      )
    );
  }

  upsertSecurityBoundaryProofRuns(input: {
    repo_id: string;
    scan_id: string;
    check_id: string;
    proofs: SecurityBoundaryProof[];
    created_at: string;
  }): void {
    const proofs = input.proofs.map((proof) => SecurityBoundaryProofSchema.parse(proof));
    const insert = this.db.prepare(`
      INSERT INTO security_boundary_proof_runs (
        storage_id, proof_id, repo_id, scan_id, check_id, route_id, file_path,
        contract_kinds_json, capability_names_json, proof_status, enforcement_result,
        parser_gap_count, missing_proof_count, affected_files_json, proof_json, created_at
      )
      VALUES (
        @storage_id, @proof_id, @repo_id, @scan_id, @check_id, @route_id, @file_path,
        @contract_kinds_json, @capability_names_json, @proof_status, @enforcement_result,
        @parser_gap_count, @missing_proof_count, @affected_files_json, @proof_json, @created_at
      )
      ON CONFLICT(check_id, proof_id) DO UPDATE SET
        route_id = excluded.route_id,
        file_path = excluded.file_path,
        contract_kinds_json = excluded.contract_kinds_json,
        capability_names_json = excluded.capability_names_json,
        proof_status = excluded.proof_status,
        enforcement_result = excluded.enforcement_result,
        parser_gap_count = excluded.parser_gap_count,
        missing_proof_count = excluded.missing_proof_count,
        affected_files_json = excluded.affected_files_json,
        proof_json = excluded.proof_json,
        created_at = excluded.created_at
    `);
    const transaction = this.db.transaction(() => {
      for (const proof of proofs) {
        const affectedFiles = [...new Set([
          proof.route.file_path,
          ...proof.parser_gaps.map((gap) => gap.file_path)
        ])].sort();
        insert.run({
          storage_id: `${input.check_id}:${proof.proof_id}`,
          proof_id: proof.proof_id,
          repo_id: input.repo_id,
          scan_id: input.scan_id,
          check_id: input.check_id,
          route_id: proof.route.route_id,
          file_path: proof.route.file_path,
          contract_kinds_json: stringifyJson(proof.contracts.map((contract) => contract.kind)),
          capability_names_json: stringifyJson(proof.capability_status.map((status) => status.name)),
          proof_status: proof.result.proof_status,
          enforcement_result: proof.result.enforcement_result,
          parser_gap_count: proof.parser_gaps.length,
          missing_proof_count: proof.missing_proof.length,
          affected_files_json: stringifyJson(affectedFiles),
          proof_json: stringifyJson(proof),
          created_at: input.created_at
        });
      }
    });
    transaction();
  }

  listSecurityBoundaryProofRuns(input: {
    repo_id: string;
    scan_id?: string;
    check_id?: string;
    file_path?: string;
    route_id?: string;
    contract_kind?: string;
    latest_only?: boolean;
  }): StoredSecurityBoundaryProofRun[] {
    const clauses = ["repo_id = ?"];
    const params: unknown[] = [input.repo_id];
    if (input.scan_id) {
      clauses.push("scan_id = ?");
      params.push(input.scan_id);
    }
    if (input.check_id) {
      clauses.push("check_id = ?");
      params.push(input.check_id);
    }
    if (input.file_path) {
      clauses.push("file_path = ?");
      params.push(input.file_path);
    }
    if (input.route_id) {
      clauses.push("route_id = ?");
      params.push(input.route_id);
    }
    const rows = this.db
      .prepare(`
        SELECT * FROM security_boundary_proof_runs
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC, route_id, proof_id
      `)
      .all(...params)
      .map(securityBoundaryProofRunFromRow);
    const filtered = input.contract_kind
      ? rows.filter((row) => row.contract_kinds.includes(input.contract_kind as string))
      : rows;
    if (!input.latest_only) {
      return filtered;
    }
    const latestCheckId = filtered[0]?.check_id;
    return latestCheckId ? filtered.filter((row) => row.check_id === latestCheckId) : [];
  }

  listLatestSecurityBoundaryProofRunsForRepo(input: {
    repo_id: string;
    file_path?: string;
    check_id?: string;
  }): StoredSecurityBoundaryProofRun[] {
    const clauses = ["repo_id = ?"];
    const params: unknown[] = [input.repo_id];
    if (input.check_id) {
      clauses.push("check_id = ?");
      params.push(input.check_id);
    }
    if (input.file_path) {
      clauses.push("file_path = ?");
      params.push(input.file_path);
    }
    const rows = this.db
      .prepare(`
        SELECT * FROM security_boundary_proof_runs
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC, check_id DESC, proof_id ASC
      `)
      .all(...params)
      .map(securityBoundaryProofRunFromRow);
    const latestCheckId = rows[0]?.check_id;
    return latestCheckId ? rows.filter((row) => row.check_id === latestCheckId) : [];
  }

  upsertSymbolIdentities(identities: SymbolIdentity[]): void {
    const parsedIdentities = identities.map((identity) => SymbolIdentitySchema.parse(identity));
    const insert = this.db.prepare(`
      INSERT INTO symbol_identities (
        symbol_id, schema_version, repo_id, scan_id, symbol_name, kind, declared_in,
        exported_from_json, imported_as_json, re_export_chain_json, canonical_definition,
        call_sites_json, references_json, visibility
      )
      VALUES (
        @symbol_id, @schema_version, @repo_id, @scan_id, @symbol_name, @kind, @declared_in,
        @exported_from_json, @imported_as_json, @re_export_chain_json, @canonical_definition,
        @call_sites_json, @references_json, @visibility
      )
      ON CONFLICT(repo_id, scan_id, symbol_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        symbol_name = excluded.symbol_name,
        kind = excluded.kind,
        declared_in = excluded.declared_in,
        exported_from_json = excluded.exported_from_json,
        imported_as_json = excluded.imported_as_json,
        re_export_chain_json = excluded.re_export_chain_json,
        canonical_definition = excluded.canonical_definition,
        call_sites_json = excluded.call_sites_json,
        references_json = excluded.references_json,
        visibility = excluded.visibility
    `);

    const transaction = this.db.transaction(() => {
      for (const identity of parsedIdentities) {
        insert.run({
          ...identity,
          exported_from_json: JSON.stringify(identity.exported_from),
          imported_as_json: JSON.stringify(identity.imported_as),
          re_export_chain_json: JSON.stringify(identity.re_export_chain),
          call_sites_json: JSON.stringify(identity.call_sites),
          references_json: JSON.stringify(identity.references)
        });
      }
    });
    transaction();
  }

  listSymbolIdentities(repoId: string, scanId?: string): SymbolIdentity[] {
    const rows = scanId
      ? this.db
          .prepare("SELECT * FROM symbol_identities WHERE repo_id = ? AND scan_id = ? ORDER BY declared_in, symbol_name, symbol_id")
          .all(repoId, scanId)
      : this.db
          .prepare("SELECT * FROM symbol_identities WHERE repo_id = ? ORDER BY scan_id, declared_in, symbol_name, symbol_id")
          .all(repoId);

    return rows.map(symbolIdentityFromRow);
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
        start_column, end_column, adapter_id, adapter_version, fact_ids_json, confidence_kind,
        extractor, snippet_hash, redaction_state
      )
      VALUES (
        @repo_id, @scan_id, @id, @artifact_id, @file_path, @file_hash, @start_line, @end_line,
        @start_column, @end_column, @adapter_id, @adapter_version, @fact_ids_json, @confidence_kind,
        @extractor, @snippet_hash, @redaction_state
      )
    `);
    const insertDiagnostic = this.db.prepare(`
      INSERT INTO graph_diagnostics (
        repo_id, scan_id, id, severity, code, message, file_path, import_source, evidence_ids_json
      )
      VALUES (
        @repo_id, @scan_id, @id, @severity, @code, @message, @file_path, @import_source, @evidence_ids_json
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
        // Store the graph *without* its bulk collections. nodes, edges and evidence are
        // already written to graph_nodes/graph_edges/graph_evidence immediately below, and
        // keeping a second serialized copy dominated local state: on dub, graph_json was
        // 206 MB of a 599 MB database while the normalized tables held the same data in
        // 201 MB. getFactGraphArtifact rehydrates them from those tables, so the artifact
        // consumers receive is unchanged.
        graph_json: stringifyJson(graphWithoutBulkCollections(parsed.graph))
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
          fact_ids_json: stringifyJson(evidence.fact_ids),
          confidence_kind: evidence.confidence_kind ?? "deterministic",
          extractor: evidence.extractor ?? "unknown",
          snippet_hash: evidence.snippet_hash ?? null
        });
      }
      for (const diagnostic of graphDiagnostics) {
        insertDiagnostic.run({
          repo_id: parsed.repo_id,
          scan_id: parsed.scan_id,
          ...diagnostic,
          file_path: diagnostic.file_path ?? null,
          import_source: diagnostic.import_source ?? null,
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
    if (!row) {
      return undefined;
    }
    // Rehydrate the bulk collections *lazily*. They are deliberately not stored in graph_json
    // (see upsertFactGraphArtifact), so callers still see a complete artifact - but eager
    // hydration meant every getFactGraphArtifact() call ran three full table scans over the
    // graph, and `drift prepare` calls it several times. On a 20k-file repository that was the
    // dominant cost of the query surfaces: ~31s for prepare, most of it in listGraphNodes /
    // listGraphEdges / listGraphEvidence plus the resulting GC.
    //
    // Every current consumer reads only `.graph.completeness` and `.graph.adapters`, so in
    // practice these getters are never invoked - but a future one that needs the collections
    // still gets them, and pays only then.
    return factGraphArtifactFromRow(row, {
      nodes: () => this.listGraphNodes(repoId, scanId),
      edges: () => this.listGraphEdges(repoId, scanId),
      evidence: () => this.listGraphEvidence(repoId, scanId)
    });
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

  upsertCheckRun(checkRun: CheckRun): void {
    const parsed = CheckRunSchema.parse(checkRun);
    this.db
      .prepare(`
        INSERT INTO check_runs (
          id, repo_id, repo_contract_id, contract_fingerprint, scan_id, status, scope,
          engine_source, fallback_used, stale_scan, capability_complete, findings_count,
          blocking_count, machine_contract_versions_json, started_at, completed_at
        )
        VALUES (
          @id, @repo_id, @repo_contract_id, @contract_fingerprint, @scan_id, @status, @scope,
          @engine_source, @fallback_used, @stale_scan, @capability_complete, @findings_count,
          @blocking_count, @machine_contract_versions_json, @started_at, @completed_at
        )
        ON CONFLICT(id) DO UPDATE SET
          repo_contract_id = excluded.repo_contract_id,
          contract_fingerprint = excluded.contract_fingerprint,
          scan_id = excluded.scan_id,
          status = excluded.status,
          scope = excluded.scope,
          engine_source = excluded.engine_source,
          fallback_used = excluded.fallback_used,
          stale_scan = excluded.stale_scan,
          capability_complete = excluded.capability_complete,
          findings_count = excluded.findings_count,
          blocking_count = excluded.blocking_count,
          machine_contract_versions_json = excluded.machine_contract_versions_json,
          completed_at = excluded.completed_at
      `)
      .run({
        ...parsed,
        fallback_used: parsed.fallback_used ? 1 : 0,
        stale_scan: parsed.stale_scan ? 1 : 0,
        capability_complete: parsed.capability_complete ? 1 : 0,
        machine_contract_versions_json: parsed.machine_contract_versions
          ? stringifyJson(parsed.machine_contract_versions)
          : null
      });
  }

  listCheckRuns(repoId: string): CheckRun[] {
    return this.db
      .prepare("SELECT * FROM check_runs WHERE repo_id = ? ORDER BY completed_at, id")
      .all(repoId)
      .map(checkRunFromRow);
  }

  upsertFinding(finding: Finding): void {
    const parsed = FindingSchema.parse(finding);
    this.db
      .prepare(`
        INSERT INTO findings (
          id, repo_id, convention_id, fingerprint, title, message, severity,
          enforcement_result, status, diff_status, evidence_refs_json, check_id,
          repo_contract_id, expected_layer, actual_layer, graph_path_json,
          suggested_fix, related_node_ids_json, conforming_examples_json,
          created_by_engine_version,
          created_by_rule_engine_version, contract_schema_version, created_at
        )
        VALUES (
          @id, @repo_id, @convention_id, @fingerprint, @title, @message, @severity,
          @enforcement_result, @status, @diff_status, @evidence_refs_json, @check_id,
          @repo_contract_id, @expected_layer, @actual_layer, @graph_path_json,
          @suggested_fix, @related_node_ids_json, @conforming_examples_json,
          @created_by_engine_version,
          @created_by_rule_engine_version, @contract_schema_version, @created_at
        )
        ON CONFLICT(repo_id, fingerprint) DO UPDATE SET
          title = excluded.title,
          message = excluded.message,
          severity = excluded.severity,
          enforcement_result = excluded.enforcement_result,
          status = excluded.status,
          diff_status = excluded.diff_status,
          evidence_refs_json = excluded.evidence_refs_json,
          check_id = excluded.check_id,
          repo_contract_id = excluded.repo_contract_id,
          expected_layer = excluded.expected_layer,
          actual_layer = excluded.actual_layer,
          graph_path_json = excluded.graph_path_json,
          suggested_fix = excluded.suggested_fix,
          related_node_ids_json = excluded.related_node_ids_json,
          conforming_examples_json = excluded.conforming_examples_json,
          created_by_engine_version = excluded.created_by_engine_version,
          created_by_rule_engine_version = excluded.created_by_rule_engine_version,
          contract_schema_version = excluded.contract_schema_version
      `)
      .run({
        ...parsed,
        check_id: parsed.check_id ?? null,
        repo_contract_id: parsed.repo_contract_id ?? null,
        evidence_refs_json: stringifyJson(parsed.evidence_refs),
        expected_layer: parsed.expected_layer ?? null,
        actual_layer: parsed.actual_layer ?? null,
        graph_path_json: stringifyJson(parsed.graph_path ?? []),
        suggested_fix: parsed.suggested_fix ?? null,
        conforming_examples_json: stringifyJson(parsed.conforming_examples ?? []),
        related_node_ids_json: stringifyJson(parsed.related_node_ids ?? []),
        created_by_engine_version: parsed.created_by_engine_version ?? null,
        created_by_rule_engine_version: parsed.created_by_rule_engine_version ?? null,
        contract_schema_version: parsed.contract_schema_version ?? null
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
          requires_json, matcher_fingerprint, scope_fingerprint, graph_fingerprint,
          evidence_fingerprint, required_capabilities_json, reason_not_blocking,
          suggested_severity, suggested_enforcement_mode, enforcement_capability,
          confidence_label, scoring_json, evidence_refs_json, counterexample_refs_json,
          status, created_at
        )
        VALUES (
          @id, @repo_id, @scan_id, @kind, @statement, @rationale, @scope_json, @matcher_json,
          @requires_json, @matcher_fingerprint, @scope_fingerprint, @graph_fingerprint,
          @evidence_fingerprint, @required_capabilities_json, @reason_not_blocking,
          @suggested_severity, @suggested_enforcement_mode, @enforcement_capability,
          @confidence_label, @scoring_json, @evidence_refs_json, @counterexample_refs_json,
          @status, @created_at
        )
        ON CONFLICT(id) DO UPDATE SET
          statement = excluded.statement,
          rationale = excluded.rationale,
          scope_json = excluded.scope_json,
          matcher_json = excluded.matcher_json,
          requires_json = excluded.requires_json,
          matcher_fingerprint = excluded.matcher_fingerprint,
          scope_fingerprint = excluded.scope_fingerprint,
          graph_fingerprint = excluded.graph_fingerprint,
          evidence_fingerprint = excluded.evidence_fingerprint,
          required_capabilities_json = excluded.required_capabilities_json,
          reason_not_blocking = excluded.reason_not_blocking,
          suggested_severity = excluded.suggested_severity,
          suggested_enforcement_mode = excluded.suggested_enforcement_mode,
          enforcement_capability = excluded.enforcement_capability,
          confidence_label = excluded.confidence_label,
          scoring_json = excluded.scoring_json,
          evidence_refs_json = excluded.evidence_refs_json,
          counterexample_refs_json = excluded.counterexample_refs_json,
          status = CASE
            WHEN convention_candidates.status = 'rejected'
              AND COALESCE(convention_candidates.evidence_fingerprint, '') = COALESCE(excluded.evidence_fingerprint, '')
            THEN convention_candidates.status
            ELSE excluded.status
          END
      `)
      .run({
        ...parsed,
        rationale: parsed.rationale ?? null,
        scope_json: stringifyJson(parsed.scope),
        matcher_json: stringifyJson(parsed.matcher),
        requires_json: parsed.requires ? stringifyJson(parsed.requires) : null,
        matcher_fingerprint: parsed.matcher_fingerprint ?? null,
        scope_fingerprint: parsed.scope_fingerprint ?? null,
        graph_fingerprint: parsed.graph_fingerprint ?? null,
        evidence_fingerprint: parsed.evidence_fingerprint ?? null,
        required_capabilities_json: parsed.required_capabilities
          ? stringifyJson(parsed.required_capabilities)
          : null,
        reason_not_blocking: parsed.reason_not_blocking ?? null,
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
          requires_json, severity, enforcement_mode, enforcement_capability, exceptions_json,
          evidence_refs_json, counterexample_refs_json, accepted_by, accepted_at,
          updated_at, expires_at
        )
        VALUES (
          @id, @repo_id, @contract_id, @kind, @statement, @rationale, @scope_json, @matcher_json,
          @requires_json, @severity, @enforcement_mode, @enforcement_capability, @exceptions_json,
          @evidence_refs_json, @counterexample_refs_json, @accepted_by, @accepted_at,
          @updated_at, @expires_at
        )
        ON CONFLICT(id) DO UPDATE SET
          contract_id = excluded.contract_id,
          statement = excluded.statement,
          rationale = excluded.rationale,
          scope_json = excluded.scope_json,
          matcher_json = excluded.matcher_json,
          requires_json = excluded.requires_json,
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
        requires_json: parsed.requires ? stringifyJson(parsed.requires) : null,
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
    return RepoContractSchema.parse(
      parseStoredJson(rowValue<string>(row, "contract_json"), "repo_contracts.contract_json")
    );
  }

  recordRequiredCheckExecution(execution: RequiredCheckExecution): void {
    const parsed = RequiredCheckExecutionSchema.parse(execution);
    this.db
      .prepare(`
        INSERT INTO required_check_executions (
          execution_id, repo_id, repo_root, repo_commit, git_branch, git_commit_sha,
          worktree_dirty, untracked_files_present, scan_id, repo_contract_id, agent_contract_id,
          contract_fingerprint, repo_contract_version, command, argv_json, command_hash,
          diff_hash, lockfile_hash, package_manager, cwd,
          started_at, completed_at, timeout_ms, exit_code, status, stdout_hash,
          stderr_hash, stdout_preview, stderr_preview, audit_event_id
        )
        VALUES (
          @execution_id, @repo_id, @repo_root, @repo_commit, @git_branch, @git_commit_sha,
          @worktree_dirty, @untracked_files_present, @scan_id, @repo_contract_id, @agent_contract_id,
          @contract_fingerprint, @repo_contract_version, @command, @argv_json, @command_hash,
          @diff_hash, @lockfile_hash, @package_manager, @cwd,
          @started_at, @completed_at, @timeout_ms, @exit_code, @status, @stdout_hash,
          @stderr_hash, @stdout_preview, @stderr_preview, @audit_event_id
        )
        ON CONFLICT(execution_id) DO UPDATE SET
          status = excluded.status,
          completed_at = excluded.completed_at,
          exit_code = excluded.exit_code,
          stdout_hash = excluded.stdout_hash,
          stderr_hash = excluded.stderr_hash,
          stdout_preview = excluded.stdout_preview,
          stderr_preview = excluded.stderr_preview,
          git_branch = excluded.git_branch,
          git_commit_sha = excluded.git_commit_sha,
          worktree_dirty = excluded.worktree_dirty,
          untracked_files_present = excluded.untracked_files_present,
          contract_fingerprint = excluded.contract_fingerprint,
          repo_contract_version = excluded.repo_contract_version,
          diff_hash = excluded.diff_hash,
          lockfile_hash = excluded.lockfile_hash,
          package_manager = excluded.package_manager
      `)
      .run({
        ...parsed,
        worktree_dirty: parsed.worktree_dirty ? 1 : 0,
        untracked_files_present: parsed.untracked_files_present ? 1 : 0,
        scan_id: parsed.scan_id ?? null,
        argv_json: stringifyJson(parsed.argv),
        lockfile_hash: parsed.lockfile_hash ?? null,
        package_manager: parsed.package_manager ?? null,
        exit_code: parsed.exit_code ?? null
      });
  }

  listRequiredCheckExecutions(
    repoId: string,
    filters: { command?: string; scan_id?: string; repo_contract_id?: string } = {}
  ): RequiredCheckExecution[] {
    const conditions = ["repo_id = ?"];
    const values: unknown[] = [repoId];
    if (filters.command) {
      conditions.push("command = ?");
      values.push(filters.command);
    }
    if (filters.scan_id) {
      conditions.push("scan_id = ?");
      values.push(filters.scan_id);
    }
    if (filters.repo_contract_id) {
      conditions.push("repo_contract_id = ?");
      values.push(filters.repo_contract_id);
    }
    return this.db
      .prepare(`
        SELECT * FROM required_check_executions
        WHERE ${conditions.join(" AND ")}
        ORDER BY completed_at DESC, execution_id DESC
      `)
      .all(...values)
      .map(requiredCheckExecutionFromRow);
  }

  latestRequiredCheckExecution(repoId: string, command: string): RequiredCheckExecution | null {
    const row = this.db
      .prepare(`
        SELECT * FROM required_check_executions
        WHERE repo_id = ? AND command = ?
        ORDER BY completed_at DESC, execution_id DESC
        LIMIT 1
      `)
      .get(repoId, command);
    return row ? requiredCheckExecutionFromRow(row) : null;
  }

  appendAuditEvent(event: AuditEvent): void {
    const parsed = AuditEventSchema.parse(event);
    const previousEventHash = this.latestAuditEventHash(parsed.repo_id);
    const sequence = this.nextAuditSequence(parsed.repo_id);
    const eventWithHash: AuditEvent = {
      ...parsed,
      sequence,
      previous_event_hash: previousEventHash,
      event_hash: auditEventHash(parsed, previousEventHash)
    };
    try {
      this.db
        .prepare(`
          INSERT INTO audit_events (
            id, repo_id, actor, action, target_type, target_id, metadata_json,
            before_hash, after_hash, object_schema_version, created_at, sequence, previous_event_hash, event_hash
          )
          VALUES (
            @id, @repo_id, @actor, @action, @target_type, @target_id, @metadata_json,
            @before_hash, @after_hash, @object_schema_version, @created_at, @sequence, @previous_event_hash, @event_hash
          )
        `)
        .run({
          ...eventWithHash,
          before_hash: eventWithHash.before_hash ?? null,
          after_hash: eventWithHash.after_hash ?? null,
          object_schema_version: eventWithHash.object_schema_version ?? null,
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
      .prepare("SELECT * FROM audit_events WHERE repo_id = ? ORDER BY sequence, created_at, rowid")
      .all(repoId)
      .map(auditEventFromRow);
  }

  verifyAuditChain(repoId: string, options: { strict?: boolean } = {}): AuditChainVerification {
    const events = this.db
      .prepare("SELECT * FROM audit_events WHERE repo_id = ? ORDER BY rowid")
      .all(repoId)
      .map(auditEventFromRow);
    let previousEventHash: string | null = null;
    let verifiedCount = 0;
    let expectedSequence = 1;
    let headSequence: number | null = null;

    for (const event of events) {
      if (options.strict && typeof event.sequence !== "number") {
        return {
          repo_id: repoId,
          valid: false,
          strict: true,
          event_count: events.length,
          verified_count: verifiedCount,
          head_sequence: headSequence,
          head_event_hash: previousEventHash,
          broken_at_event_id: event.id,
          reasons: ["sequence_missing"]
        };
      }
      if (options.strict && event.sequence !== expectedSequence) {
        return {
          repo_id: repoId,
          valid: false,
          strict: true,
          event_count: events.length,
          verified_count: verifiedCount,
          head_sequence: headSequence,
          head_event_hash: previousEventHash,
          broken_at_event_id: event.id,
          reasons: ["sequence_gap"]
        };
      }

      if ((event.previous_event_hash ?? null) !== previousEventHash) {
        return {
          repo_id: repoId,
          valid: false,
          strict: options.strict ? true : undefined,
          event_count: events.length,
          verified_count: verifiedCount,
          head_sequence: options.strict ? headSequence : undefined,
          head_event_hash: previousEventHash,
          broken_at_event_id: event.id,
          reasons: ["previous_event_hash_mismatch"]
        };
      }

      if (!event.event_hash) {
        return {
          repo_id: repoId,
          valid: false,
          strict: options.strict ? true : undefined,
          event_count: events.length,
          verified_count: verifiedCount,
          head_sequence: options.strict ? headSequence : undefined,
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
          strict: options.strict ? true : undefined,
          event_count: events.length,
          verified_count: verifiedCount,
          head_sequence: options.strict ? headSequence : undefined,
          head_event_hash: previousEventHash,
          broken_at_event_id: event.id,
          reasons: ["event_hash_mismatch"]
        };
      }

      verifiedCount += 1;
      previousEventHash = event.event_hash;
      if (options.strict) {
        headSequence = event.sequence ?? null;
        expectedSequence += 1;
      }
    }

    return {
      repo_id: repoId,
      valid: true,
      strict: options.strict ? true : undefined,
      event_count: events.length,
      verified_count: verifiedCount,
      head_sequence: options.strict ? headSequence : undefined,
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

  private nextAuditSequence(repoId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM audit_events WHERE repo_id = ?")
      .get(repoId);
    return rowValue<number>(row, "next_sequence");
  }

  checkpoint(): void {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// F-3a: open-time integrity guard.
// ---------------------------------------------------------------------------

/**
 * How long a changed database may be served before quick_check re-verifies it. Bounds the
 * guard's cost under active writing: without this, every open during a write burst re-walks
 * the full b-tree (~2.2s measured on a 489MB indexed database).
 */
const INTEGRITY_REVERIFY_INTERVAL_MS = 30_000;

interface FileIdentity {
  size: number;
  mtimeMs: number;
  walSize: number;
  walMtimeMs: number;
}

interface IntegrityCacheEntry {
  identity: FileIdentity;
  verifiedAt: number;
  ok: boolean;
  detail: string;
}

const integrityCache = new Map<string, IntegrityCacheEntry>();

function fileIdentityFor(databasePath: string): FileIdentity {
  const db = safeStat(databasePath);
  const wal = safeStat(`${databasePath}-wal`);
  return {
    size: db?.size ?? 0,
    mtimeMs: db?.mtimeMs ?? 0,
    walSize: wal?.size ?? 0,
    walMtimeMs: wal?.mtimeMs ?? 0
  };
}

function safeStat(path: string): { size: number; mtimeMs: number } | undefined {
  try {
    const stats = statSync(path);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}

function identityEquals(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.walSize === right.walSize &&
    left.walMtimeMs === right.walMtimeMs
  );
}

function runIntegrityGuard(db: DatabaseHandle, databasePath: string): void {
  const key = resolve(databasePath);
  const identity = fileIdentityFor(databasePath);
  const cached = integrityCache.get(key);
  if (cached) {
    const unchanged = identityEquals(cached.identity, identity);
    const recentEnough = Date.now() - cached.verifiedAt < INTEGRITY_REVERIFY_INTERVAL_MS;
    // A corrupt verdict is never aged out by the interval: the file cannot heal itself, so
    // re-serving after 30s would reintroduce the silent mode this guard exists to close.
    if (unchanged && !cached.ok) {
      throw new DatabaseIntegrityError(databasePath, cached.detail);
    }
    if (cached.ok && (unchanged || recentEnough)) {
      return;
    }
  }
  let detail = "";
  try {
    const rows = db.pragma("quick_check(1)") as Array<{ quick_check: string }>;
    const verdict = rows[0]?.quick_check ?? "no quick_check result";
    if (rows.length === 1 && verdict === "ok") {
      integrityCache.set(key, { identity, verifiedAt: Date.now(), ok: true, detail: "" });
      return;
    }
    detail = verdict;
  } catch (error) {
    // Hard corruption can make quick_check itself throw (SQLITE_CORRUPT/SQLITE_NOTADB).
    detail = error instanceof Error ? error.message : String(error);
  }
  integrityCache.set(key, { identity, verifiedAt: Date.now(), ok: false, detail });
  throw new DatabaseIntegrityError(databasePath, detail);
}

// ---------------------------------------------------------------------------
// F-3b: WAL-recovery observability.
//
// SQLite recovers a WAL by replaying frames until the first invalid checksum and silently
// discards the rest. It cannot distinguish a torn write (normal crash, correct to discard)
// from post-commit corruption, and neither can we - but "recovery discarded current-generation
// frames that include a commit record" IS observable, and that is precisely the case where a
// transaction someone was told committed may be gone. Detection: snapshot the WAL's frame
// headers before open, compare the frame count SQLite accepted (wal_checkpoint's `log` field,
// i.e. mxFrame) with salt-matched frames present in the file beyond that point. Stale frames
// from an earlier checkpoint generation carry different salts and are excluded, so a normally
// recycled WAL does not warn.
// ---------------------------------------------------------------------------

const WAL_HEADER_SIZE = 32;
const WAL_FRAME_HEADER_SIZE = 24;
/** Soft cap: a WAL beyond ~1M frames (4GB at 4k pages) is not scanned frame-by-frame. */
const WAL_MAX_SCANNED_FRAMES = 1_000_000;

interface WalFrameScan {
  frameCount: number;
  /** 1-based frame numbers whose salts match the current WAL generation. */
  currentGeneration: Set<number>;
  /** Subset of currentGeneration carrying a commit record (non-zero dbsize field). */
  commitFrames: Set<number>;
}

function scanWalFrameHeaders(databasePath: string): WalFrameScan | undefined {
  const walPath = `${databasePath}-wal`;
  let fd: number | undefined;
  try {
    fd = openSync(walPath, "r");
    const stats = statSync(walPath);
    if (stats.size < WAL_HEADER_SIZE) {
      return undefined;
    }
    const header = Buffer.alloc(WAL_HEADER_SIZE);
    if (readSync(fd, header, 0, WAL_HEADER_SIZE, 0) !== WAL_HEADER_SIZE) {
      return undefined;
    }
    const magic = header.readUInt32BE(0);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) {
      return undefined;
    }
    const pageSize = header.readUInt32BE(8);
    if (!Number.isInteger(pageSize) || pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) {
      return undefined;
    }
    const headerSalt = header.subarray(16, 24);
    const frameSize = WAL_FRAME_HEADER_SIZE + pageSize;
    const frameCount = Math.min(
      Math.floor((stats.size - WAL_HEADER_SIZE) / frameSize),
      WAL_MAX_SCANNED_FRAMES
    );
    const scan: WalFrameScan = {
      frameCount,
      currentGeneration: new Set(),
      commitFrames: new Set()
    };
    const frameHeader = Buffer.alloc(WAL_FRAME_HEADER_SIZE);
    for (let frame = 1; frame <= frameCount; frame++) {
      const offset = WAL_HEADER_SIZE + (frame - 1) * frameSize;
      if (readSync(fd, frameHeader, 0, WAL_FRAME_HEADER_SIZE, offset) !== WAL_FRAME_HEADER_SIZE) {
        break;
      }
      if (frameHeader.subarray(8, 16).equals(headerSalt)) {
        scan.currentGeneration.add(frame);
        if (frameHeader.readUInt32BE(4) !== 0) {
          scan.commitFrames.add(frame);
        }
      }
    }
    return scan;
  } catch {
    // No WAL file, or it is unreadable: nothing to observe.
    return undefined;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

function walRecoveryDiagnostics(
  db: DatabaseHandle,
  databasePath: string,
  walScan: WalFrameScan | undefined
): StorageOpenDiagnostic[] {
  if (!walScan || walScan.frameCount === 0 || walScan.commitFrames.size === 0) {
    return [];
  }
  let accepted: number;
  try {
    // PASSIVE never blocks and triggers recovery if it has not happened yet; `log` is mxFrame,
    // the number of frames SQLite accepted as valid.
    const rows = db.pragma("wal_checkpoint(PASSIVE)") as Array<{ busy: number; log: number; checkpointed: number }>;
    accepted = rows[0]?.log ?? -1;
  } catch {
    // Readonly filesystem or corrupt DB: the checkpoint cannot run, so recovery loss is not
    // observable here. The integrity guard (if enabled) still covers the corrupt case.
    return [];
  }
  if (accepted < 0 || accepted >= walScan.frameCount) {
    // A concurrent writer may legitimately have appended past our snapshot.
    return [];
  }
  const discardedCurrent = [...walScan.currentGeneration].filter((frame) => frame > accepted);
  const discardedCommits = [...walScan.commitFrames].filter((frame) => frame > accepted);
  if (discardedCommits.length === 0) {
    // Only torn, uncommitted, or stale frames beyond the recovery point: normal after an
    // interrupted write, nothing durable was lost.
    return [];
  }
  return [
    {
      code: "wal_recovery_discarded_commits",
      severity: "warning",
      message:
        `SQLite recovered the write-ahead log of ${databasePath} and discarded ` +
        `${discardedCurrent.length} unreplayable frame(s), including ${discardedCommits.length} ` +
        `commit record(s). This can follow an interrupted write, but committed transactions may ` +
        `have been lost - verify recent changes are present (drift audit verify, drift scan status) ` +
        `and rescan if anything is missing.`
    }
  ];
}

/** SQLite's `auto_vacuum` mode values: 0 NONE, 1 FULL, 2 INCREMENTAL. */
const AUTO_VACUUM_INCREMENTAL = 2;

/**
 * Free space to leave after a one-time reclaim, matching the scan floor in
 * packages/cli/src/domain/disk-space.ts. A reclaim that leaves no room to scan has moved the problem
 * rather than solved it.
 */
const RECLAIM_HEADROOM_BYTES = 512 * 1024 * 1024;

/**
 * Put a *new* database into incremental auto-vacuum mode, and report the mode in force.
 *
 * `auto_vacuum` is stored in the database header and SQLite only honours a change to it while the
 * database has no tables (or during a full VACUUM). So this succeeds exactly once, on creation,
 * and is a no-op on every database that already has a schema - which is the correct behaviour: the
 * upgrade path for those is the explicit, space-checked `reclaimDiskSpace()`.
 */
function enableIncrementalAutoVacuum(db: DatabaseHandle): number {
  const currentMode = () => {
    const rows = db.pragma("auto_vacuum") as Array<{ auto_vacuum: number }>;
    return rows[0]?.auto_vacuum ?? 0;
  };
  if (currentMode() === AUTO_VACUUM_INCREMENTAL) {
    return AUTO_VACUUM_INCREMENTAL;
  }
  const tableCount = (
    db
      .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'")
      .get() as { count: number }
  ).count;
  if (tableCount > 0) {
    return currentMode();
  }
  try {
    db.pragma(`auto_vacuum = ${AUTO_VACUUM_INCREMENTAL}`);
  } catch {
    /* leave the mode as it is; pruning simply will not reclaim */
  }
  return currentMode();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return "an unmeasurable amount";
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function openDriftStorage(options: DriftStorageOptions): SqliteDriftStorage {
  return new SqliteDriftStorage(options);
}

function repoRecordFromRow(row: unknown): RepoRecord {
  const record = row as Record<string, unknown>;
  return RepoRecordSchema.parse({
    id: record.id,
    root_path: record.root_path,
    fingerprint: record.fingerprint,
    vcs_provider: record.vcs_provider ?? undefined,
    remote_url_hash: record.remote_url_hash ?? null,
    package_manager: record.package_manager ?? undefined,
    lockfile_hashes: record.lockfile_hashes_json ? parseJsonObject(record.lockfile_hashes_json) : undefined,
    resolver_input_hash: record.resolver_input_hash ?? undefined,
    created_at: record.created_at,
    updated_at: record.updated_at
  });
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
    check_id: record.check_id ?? undefined,
    repo_contract_id: record.repo_contract_id ?? undefined,
    evidence_refs: parseJsonArray(record.evidence_refs_json),
    expected_layer: record.expected_layer ?? undefined,
    actual_layer: record.actual_layer ?? undefined,
    graph_path: parseJsonArray(record.graph_path_json ?? "[]"),
    suggested_fix: record.suggested_fix ?? undefined,
    related_node_ids: parseJsonArray(record.related_node_ids_json ?? "[]"),
    // BB-5: an absent column reads as "this finding kind carries none", not as an empty set that
    // was deliberately computed - which is why the field is optional rather than defaulted to [].
    conforming_examples: record.conforming_examples_json
      ? parseJsonArray(record.conforming_examples_json)
      : undefined,
    created_by_engine_version: record.created_by_engine_version ?? undefined,
    created_by_rule_engine_version: record.created_by_rule_engine_version ?? undefined,
    contract_schema_version: record.contract_schema_version ?? undefined
  });
}

function checkRunFromRow(row: unknown): CheckRun {
  const record = row as Record<string, unknown>;
  return CheckRunSchema.parse({
    ...record,
    fallback_used: record.fallback_used === 1,
    stale_scan: record.stale_scan === 1,
    capability_complete: record.capability_complete === 1,
    machine_contract_versions: typeof record.machine_contract_versions_json === "string"
      ? parseJsonObject(record.machine_contract_versions_json)
      : undefined
  });
}

function factFromRow(row: unknown): FactRecord {
  const record = row as Record<string, unknown>;
  return FactRecordSchema.parse({
    ...record,
    value: record.value ?? undefined,
    imported_name: record.imported_name ?? undefined,
    runtime_use: record.runtime_use ?? undefined,
    ast_node_kind: record.ast_node_kind ?? null,
    source_span: typeof record.source_span_json === "string"
      ? parseStoredJson(record.source_span_json, "facts.source_span_json")
      : record.source_span,
    last_seen_scan_id: record.last_seen_scan_id ?? record.scan_id
  });
}

function parserGapFromRow(row: unknown): ParserGap {
  const record = row as Record<string, unknown>;
  return ParserGapSchema.parse({
    ...record,
    evidence_refs: typeof record.evidence_refs_json === "string"
      ? parseStoredJson(record.evidence_refs_json, "parser_gaps.evidence_refs_json")
      : []
  });
}

function parserGapV2FromRow(row: unknown): ParserGapV2 {
  const record = row as Record<string, unknown>;
  return ParserGapV2Schema.parse({
    ...record,
    parser_gap_id: record.gap_id,
    source_text_hash: record.source_text_hash ?? undefined,
    affected_capabilities: parseJsonArray(record.affected_capabilities_json),
    affected_contract_kinds: parseJsonArray(record.affected_contract_kinds_json),
    suggested_action: record.suggested_action,
    evidence_refs: typeof record.evidence_refs_json === "string"
      ? parseStoredJson(record.evidence_refs_json, "parser_gaps_v2.evidence_refs_json")
      : []
  });
}

function frameworkAdapterFromRow(row: unknown): FrameworkAdapter {
  const record = row as Record<string, unknown>;
  return FrameworkAdapterSchema.parse(parseJsonObject(record.adapter_json));
}

function normalizedEntrypointFromRow(row: unknown): NormalizedEntrypointFact {
  const record = row as Record<string, unknown>;
  return NormalizedEntrypointFactSchema.parse(parseJsonObject(record.entrypoint_json));
}

function frameworkParserGapFromRow(row: unknown): FrameworkParserGap {
  const record = row as Record<string, unknown>;
  return FrameworkParserGapSchema.parse(parseJsonObject(record.parser_gap_json));
}

function frameworkCapabilityFromRow(row: unknown): FrameworkCapability {
  const record = row as Record<string, unknown>;
  return FrameworkCapabilitySchema.parse(parseJsonObject(record.capability_json));
}

function scanCapabilityReportFromRow(row: unknown): ScanCapabilityReport {
  const record = row as Record<string, unknown>;
  return ScanCapabilityReportSchema.parse({
    ...record,
    engine_version: record.engine_version ?? null,
    adapter_versions: parseJsonObject(record.adapter_versions_json),
    certified_capabilities: parseJsonArray(record.certified_capabilities_json),
    required_capabilities: parseJsonArray(record.required_capabilities_json),
    missing_capabilities: parseJsonArray(record.missing_capabilities_json),
    completeness: parseJsonArray(record.completeness_json),
    parser_gap_kinds: parseJsonObject(record.parser_gap_kinds_json),
    fallback_used: record.fallback_used === 1,
    enforcement_degraded: record.enforcement_degraded === 1,
    engine_resolution: record.engine_resolution ?? null,
    engine_build_profile: record.engine_build_profile ?? null
  });
}

function securityBoundaryProofRunFromRow(row: unknown): StoredSecurityBoundaryProofRun {
  const record = row as Record<string, unknown>;
  return {
    storage_id: rowValue<string>(row, "storage_id"),
    proof_id: rowValue<string>(row, "proof_id"),
    repo_id: rowValue<string>(row, "repo_id"),
    scan_id: rowValue<string>(row, "scan_id"),
    check_id: rowValue<string>(row, "check_id"),
    route_id: rowValue<string>(row, "route_id"),
    file_path: rowValue<string>(row, "file_path"),
    contract_kinds: parseJsonArray(record.contract_kinds_json).filter((value): value is string =>
      typeof value === "string"
    ),
    capability_names: parseJsonArray(record.capability_names_json).filter((value): value is string =>
      typeof value === "string"
    ),
    proof_status: rowValue<StoredSecurityBoundaryProofRun["proof_status"]>(row, "proof_status"),
    enforcement_result: rowValue<StoredSecurityBoundaryProofRun["enforcement_result"]>(row, "enforcement_result"),
    parser_gap_count: rowValue<number>(row, "parser_gap_count"),
    missing_proof_count: rowValue<number>(row, "missing_proof_count"),
    affected_files: parseJsonArray(record.affected_files_json).filter((value): value is string =>
      typeof value === "string"
    ),
    proof: SecurityBoundaryProofSchema.parse(
      parseStoredJson(rowValue<string>(row, "proof_json"), "security_boundary_proof_runs.proof_json")
    ),
    created_at: rowValue<string>(row, "created_at")
  };
}

function deduplicateParserGaps(gaps: ParserGap[]): ParserGap[] {
  const bySemanticKey = new Map<string, ParserGap>();
  for (const gap of gaps) {
    const key = [
      gap.repo_id,
      gap.scan_id,
      gap.kind,
      gap.file_path,
      gap.start_line,
      gap.end_line,
      gap.message
    ].join("\0");
    const existing = bySemanticKey.get(key);
    if (!existing) {
      bySemanticKey.set(key, gap);
      continue;
    }
    bySemanticKey.set(key, {
      ...existing,
      evidence_refs: sortedUnique([...existing.evidence_refs, ...gap.evidence_refs])
    });
  }
  return [...bySemanticKey.values()];
}

function symbolIdentityFromRow(row: unknown): SymbolIdentity {
  const record = row as Record<string, unknown>;
  return SymbolIdentitySchema.parse({
    ...record,
    exported_from: parseJsonArray(record.exported_from_json),
    imported_as: parseJsonArray(record.imported_as_json),
    re_export_chain: parseJsonArray(record.re_export_chain_json),
    call_sites: parseJsonArray(record.call_sites_json),
    references: parseJsonArray(record.references_json)
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

function factGraphArtifactFromRow(
  row: unknown,
  hydrate?: {
    nodes: () => unknown[];
    edges: () => unknown[];
    evidence: () => unknown[];
  }
): FactGraphArtifact {
  const record = row as Record<string, unknown>;
  const graph = parseJsonObject(record.graph_json) as Record<string, unknown>;
  if (!hydrate) {
    return FactGraphArtifactSchema.parse({ ...record, graph });
  }

  // Schema validation would force the collections to materialize, so validate the metadata and
  // attach the collections behind memoized getters afterwards.
  const parsed = FactGraphArtifactSchema.parse({
    ...record,
    graph: { ...graph, nodes: [], edges: [], evidence: [] }
  });
  const cache = new Map<string, unknown[]>();
  const lazily = (key: "nodes" | "edges" | "evidence", load: () => unknown[]) => {
    Object.defineProperty(parsed.graph, key, {
      configurable: true,
      enumerable: true,
      get() {
        if (!cache.has(key)) {
          cache.set(key, load());
        }
        return cache.get(key);
      }
    });
  };
  lazily("nodes", hydrate.nodes);
  lazily("edges", hydrate.edges);
  lazily("evidence", hydrate.evidence);
  return parsed;
}

/**
 * The graph minus the collections that are stored relationally.
 *
 * Keeping nodes, edges and evidence in graph_json as well as in their own tables doubled the
 * cost of the largest thing Drift stores. Everything else in the graph - adapters, artifacts,
 * completeness, diagnostics, stats - is small and is read directly from the blob.
 */
function graphWithoutBulkCollections(graph: Record<string, unknown>): Record<string, unknown> {
  return { ...graph, nodes: [], edges: [], evidence: [] };
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
    snippet_hash: record.snippet_hash ?? undefined,
    fact_ids: parseJsonArray(record.fact_ids_json)
  });
}

function graphDiagnosticFromRow(row: unknown): GraphDiagnostic {
  const record = row as Record<string, unknown>;
  return GraphDiagnosticSchema.parse({
    ...record,
    file_path: record.file_path ?? undefined,
    import_source: record.import_source ?? undefined,
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
    requires: record.requires_json ? parseJsonObject(record.requires_json) : undefined,
    scoring: parseJsonObject(record.scoring_json),
    evidence_refs: parseJsonArray(record.evidence_refs_json),
    counterexample_refs: parseJsonArray(record.counterexample_refs_json),
    matcher_fingerprint: record.matcher_fingerprint ?? undefined,
    scope_fingerprint: record.scope_fingerprint ?? undefined,
    graph_fingerprint: record.graph_fingerprint ?? undefined,
    evidence_fingerprint: record.evidence_fingerprint ?? undefined,
    required_capabilities: record.required_capabilities_json
      ? parseJsonArray(record.required_capabilities_json)
      : undefined,
    reason_not_blocking: record.reason_not_blocking ?? undefined
  });
}

function acceptedConventionFromRow(row: unknown): AcceptedConvention {
  const record = row as Record<string, unknown>;
  return AcceptedConventionSchema.parse({
    ...record,
    rationale: record.rationale ?? undefined,
    scope: parseJsonObject(record.scope_json),
    matcher: parseJsonObject(record.matcher_json),
    requires: record.requires_json ? parseJsonObject(record.requires_json) : undefined,
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
    sequence: typeof record.sequence === "number" ? record.sequence : undefined,
    before_hash: record.before_hash ?? null,
    after_hash: record.after_hash ?? null,
    object_schema_version: record.object_schema_version ?? null,
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

function requiredCheckExecutionFromRow(row: unknown): RequiredCheckExecution {
  return RequiredCheckExecutionSchema.parse({
    schema_version: "drift.required_check_execution.v1",
    execution_id: rowValue<string>(row, "execution_id"),
    repo_id: rowValue<string>(row, "repo_id"),
    repo_root: rowValue<string>(row, "repo_root"),
    repo_commit: rowValue<string>(row, "repo_commit"),
    git_branch: rowValue<string>(row, "git_branch"),
    git_commit_sha: rowValue<string>(row, "git_commit_sha"),
    worktree_dirty: rowValue<number>(row, "worktree_dirty") === 1,
    untracked_files_present: rowValue<number>(row, "untracked_files_present") === 1,
    scan_id: rowValue<string | null>(row, "scan_id"),
    repo_contract_id: rowValue<string>(row, "repo_contract_id"),
    agent_contract_id: rowValue<string>(row, "agent_contract_id"),
    contract_fingerprint: rowValue<string>(row, "contract_fingerprint"),
    repo_contract_version: rowValue<number>(row, "repo_contract_version"),
    command: rowValue<string>(row, "command"),
    argv: parseJsonArray(rowValue<string>(row, "argv_json")).map(String),
    command_hash: rowValue<string>(row, "command_hash"),
    diff_hash: rowValue<string>(row, "diff_hash"),
    lockfile_hash: rowValue<string | null>(row, "lockfile_hash"),
    package_manager: rowValue<string | null>(row, "package_manager"),
    cwd: rowValue<string>(row, "cwd"),
    started_at: rowValue<string>(row, "started_at"),
    completed_at: rowValue<string>(row, "completed_at"),
    timeout_ms: rowValue<number>(row, "timeout_ms"),
    exit_code: rowValue<number | null>(row, "exit_code"),
    status: rowValue<string>(row, "status"),
    stdout_hash: rowValue<string>(row, "stdout_hash"),
    stderr_hash: rowValue<string>(row, "stderr_hash"),
    stdout_preview: rowValue<string>(row, "stdout_preview"),
    stderr_preview: rowValue<string>(row, "stderr_preview"),
    audit_event_id: rowValue<string>(row, "audit_event_id")
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

/**
 * Parse a JSON blob read back from a database row.
 *
 * These bytes were written by Drift as valid JSON, so a parse failure here means SQLite handed
 * back damaged content (a corrupted page that still passed the b-tree walk). Marking that at the
 * throw site is what lets the CLI and MCP classifiers tell "corrupt local state" apart from
 * "malformed user input" - both otherwise surface as the same SyntaxError.
 */
function parseStoredJson(value: unknown, context: string): unknown {
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new StoredBlobCorruptionError(context, error);
  }
}

function parseJsonObject(value: unknown, context = "a stored JSON object column"): Record<string, unknown> {
  const parsed = parseStoredJson(value, context);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object from SQLite row.");
  }
  return parsed as Record<string, unknown>;
}

function parseJsonArray(value: unknown, context = "a stored JSON array column"): unknown[] {
  const parsed = parseStoredJson(value, context);
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
