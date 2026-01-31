/**
 * Workspace Management Module
 * 
 * Enterprise-grade workspace management for drift projects.
 * 
 * Components:
 * - BackupManager: Backup/restore with checksums and retention
 * - ContextLoader: Pre-load lake data for fast access
 * - ProjectSwitcher: Multi-project management with indicators
 * - SchemaMigrator: Version upgrades with rollback support
 * - WorkspaceManager: Unified orchestrator
 * 
 * @module workspace
 */

// Types
export type {
  // Backup types
  BackupMetadata,
  BackupReason,
  BackupResult,
  RestoreResult,
  SchemaMigration,
  
  // Context types
  WorkspaceContext,
  ProjectContext,
  LakeContext,
  AnalysisContext,
  PatternSummary,
  CallGraphSummary,
  BoundarySummary,
  
  // Project types
  ActiveProjectIndicator,
  ProjectSwitchRequest,
  ProjectSwitchResult,
  
  // Config types
  WorkspaceManagerConfig,
} from './types.js';

export { DEFAULT_WORKSPACE_CONFIG } from './types.js';

// Backup Manager
export {
  BackupManager,
  createBackupManager,
} from './backup-manager.js';

// Context Loader
export {
  ContextLoader,
  createContextLoader,
} from './context-loader.js';

// Project Switcher
export type {
  ProjectRegistryLike,
  AgentProjectContext,
} from './project-switcher.js';

export {
  ProjectSwitcher,
  createProjectSwitcher,
} from './project-switcher.js';

// Schema Migrator
export type {
  MigrationResult,
  MigrationHistoryEntry,
  MigrationHistory,
} from './schema-migrator.js';

export {
  SchemaMigrator,
  createSchemaMigrator,
} from './schema-migrator.js';

// Workspace Manager
export type {
  WorkspaceInitOptions,
  WorkspaceStatus,
  DestructiveOperationRequest,
} from './workspace-manager.js';

export {
  WorkspaceManager,
  createWorkspaceManager,
  getWorkspaceManager,
  resetGlobalWorkspaceManager,
} from './workspace-manager.js';
