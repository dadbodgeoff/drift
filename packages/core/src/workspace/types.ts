/**
 * Workspace Management Types
 * 
 * Enterprise-grade types for workspace context, backup management,
 * and multi-project orchestration.
 * 
 * @module workspace/types
 */

// ============================================================================
// Backup & Migration Types
// ============================================================================

/**
 * Backup metadata stored with each backup
 */
export interface BackupMetadata {
  /** Unique backup identifier */
  id: string;
  /** Drift version that created the backup */
  driftVersion: string;
  /** Schema version of the .drift data */
  schemaVersion: string;
  /** When the backup was created */
  createdAt: string;
  /** Reason for the backup */
  reason: BackupReason;
  /** Size of the backup in bytes */
  sizeBytes: number;
  /** Checksum for integrity verification */
  checksum: string;
  /** Original .drift path */
  originalPath: string;
  /** Project name */
  projectName: string;
  /** Whether backup is compressed */
  compressed: boolean;
  /** Files included in backup */
  files: string[];
}

/**
 * Reasons for creating a backup
 */
export type BackupReason =
  | 'version_upgrade'
  | 'schema_migration'
  | 'user_requested'
  | 'pre_destructive_operation'
  | 'scheduled'
  | 'auto_save';

/**
 * Backup operation result
 */
export interface BackupResult {
  success: boolean;
  backupId: string;
  backupPath: string;
  metadata: BackupMetadata;
  error?: string;
}

/**
 * Restore operation result
 */
export interface RestoreResult {
  success: boolean;
  restoredFrom: string;
  restoredTo: string;
  filesRestored: number;
  error?: string;
}

/**
 * Schema migration definition
 */
export interface SchemaMigration {
  /** Migration identifier */
  id: string;
  /** Source schema version */
  fromVersion: string;
  /** Target schema version */
  toVersion: string;
  /** Migration description */
  description: string;
  /** Migration function */
  migrate: (data: unknown) => Promise<unknown>;
  /** Rollback function */
  rollback?: (data: unknown) => Promise<unknown>;
}

// ============================================================================
// Workspace Context Types
// ============================================================================

/**
 * Complete workspace context loaded at startup
 */
export interface WorkspaceContext {
  /** Project metadata */
  project: ProjectContext;
  /** Pre-loaded lake data */
  lake: LakeContext;
  /** Analysis state */
  analysis: AnalysisContext;
  /** When context was loaded */
  loadedAt: string;
  /** Context validity (stale after certain time) */
  validUntil: string;
}

/**
 * Project-level context
 */
export interface ProjectContext {
  /** Project ID */
  id: string;
  /** Project name */
  name: string;
  /** Project root path */
  rootPath: string;
  /** Drift directory path */
  driftPath: string;
  /** Schema version */
  schemaVersion: string;
  /** Drift version used */
  driftVersion: string;
  /** Last scan timestamp */
  lastScanAt?: string;
  /** Project health score */
  healthScore?: number;
  /** Detected languages */
  languages: string[];
  /** Detected frameworks */
  frameworks: string[];
}

/**
 * Pattern summary for quick access
 */
export interface PatternSummary {
  total: number;
  byStatus: {
    discovered: number;
    approved: number;
    ignored: number;
  };
  byCategory: Record<string, number>;
  byConfidence: {
    high: number;
    medium: number;
    low: number;
    uncertain: number;
  };
}

/**
 * Call graph summary
 */
export interface CallGraphSummary {
  functions: number;
  callSites: number;
  entryPoints: number;
  dataAccessors: number;
  builtAt?: string | undefined;
}

/**
 * Boundary summary
 */
export interface BoundarySummary {
  tables: number;
  accessPoints: number;
  sensitiveFields: number;
}

/**
 * Pre-loaded lake data for fast access
 */
export interface LakeContext {
  /** Whether lake data is available */
  available: boolean;
  /** Pattern summary (not full patterns) */
  patternSummary: PatternSummary;
  /** Call graph summary */
  callGraphSummary?: CallGraphSummary | undefined;
  /** Boundary summary */
  boundarySummary?: BoundarySummary | undefined;
  /** Last lake update */
  lastUpdatedAt?: string | undefined;
}

/**
 * Analysis state context
 */
export interface AnalysisContext {
  /** Whether call graph is built */
  callGraphBuilt: boolean;
  /** Whether test topology is built */
  testTopologyBuilt: boolean;
  /** Whether coupling analysis is built */
  couplingBuilt: boolean;
  /** Whether DNA profile exists */
  dnaProfileExists: boolean;
  /** Whether memory system is initialized */
  memoryInitialized: boolean;
  /** Whether constants are extracted */
  constantsExtracted: boolean;
}

// ============================================================================
// Multi-Project Types
// ============================================================================

/**
 * Active project indicator shown in CLI/MCP output
 */
export interface ActiveProjectIndicator {
  /** Project name */
  name: string;
  /** Short path (last 2 segments) */
  shortPath: string;
  /** Full path */
  fullPath: string;
  /** Health indicator */
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
  /** Last accessed */
  lastAccessed: string;
  /** Whether this is auto-detected or explicitly set */
  source: 'explicit' | 'auto_detected' | 'cwd';
}

/**
 * Project switch request
 */
export interface ProjectSwitchRequest {
  /** Target project (name, path, or ID) */
  target: string;
  /** Whether to validate project exists */
  validate?: boolean;
  /** Whether to load context after switch */
  loadContext?: boolean;
}

/**
 * Project switch result
 */
export interface ProjectSwitchResult {
  success: boolean;
  previousProject?: ActiveProjectIndicator | undefined;
  currentProject: ActiveProjectIndicator;
  contextLoaded: boolean;
  error?: string | undefined;
}

// ============================================================================
// Workspace Manager Configuration
// ============================================================================

/**
 * Workspace manager configuration
 */
export interface WorkspaceManagerConfig {
  /** Enable automatic backups */
  autoBackup: boolean;
  /** Backup retention days */
  backupRetentionDays: number;
  /** Maximum backups to keep */
  maxBackups: number;
  /** Enable context caching */
  enableContextCache: boolean;
  /** Context cache TTL in seconds */
  contextCacheTTL: number;
  /** Show project indicator in output */
  showProjectIndicator: boolean;
  /** Auto-detect project from cwd */
  autoDetectProject: boolean;
}

/**
 * Default workspace manager configuration
 */
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceManagerConfig = {
  autoBackup: true,
  backupRetentionDays: 30,
  maxBackups: 10,
  enableContextCache: true,
  contextCacheTTL: 300, // 5 minutes
  showProjectIndicator: true,
  autoDetectProject: true,
};
