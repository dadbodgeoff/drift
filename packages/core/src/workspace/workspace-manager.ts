/**
 * Workspace Manager
 * 
 * Enterprise-grade orchestrator that ties together all workspace
 * management components: backup, context loading, project switching,
 * and schema migration.
 * 
 * This is the main entry point for workspace operations.
 * 
 * Features:
 * - Unified API for all workspace operations
 * - Automatic backup before destructive operations
 * - Context pre-loading for fast CLI/MCP access
 * - Multi-project management with clear indicators
 * - Schema migration with rollback support
 * 
 * @module workspace/workspace-manager
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  WorkspaceContext,
  WorkspaceManagerConfig,
  BackupResult,
  RestoreResult,
  BackupMetadata,
  ActiveProjectIndicator,
  ProjectSwitchRequest,
  ProjectSwitchResult,
} from './types.js';
import { DEFAULT_WORKSPACE_CONFIG } from './types.js';
import { BackupManager } from './backup-manager.js';
import { ContextLoader } from './context-loader.js';
import { ProjectSwitcher, type ProjectRegistryLike, type AgentProjectContext } from './project-switcher.js';
import { SchemaMigrator, type MigrationResult } from './schema-migrator.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Workspace initialization options
 */
export interface WorkspaceInitOptions {
  /** Project registry instance */
  registry?: ProjectRegistryLike;
  /** Drift version for backups */
  driftVersion?: string;
  /** Skip migration check */
  skipMigration?: boolean;
}

/**
 * Workspace status
 */
export interface WorkspaceStatus {
  /** Whether workspace is initialized */
  initialized: boolean;
  /** Active project indicator */
  activeProject: ActiveProjectIndicator | null;
  /** Whether context is loaded */
  contextLoaded: boolean;
  /** Whether migration is needed */
  migrationNeeded: boolean;
  /** Current schema version */
  schemaVersion: string;
  /** Number of available backups */
  backupCount: number;
  /** Last backup date */
  lastBackup?: string | undefined;
}

/**
 * Destructive operation confirmation
 */
export interface DestructiveOperationRequest {
  /** Operation name */
  operation: string;
  /** Confirmation token (must be "DELETE" for deletion) */
  confirmationToken?: string;
  /** Skip backup */
  skipBackup?: boolean;
}

// ============================================================================
// Workspace Manager Class
// ============================================================================

export class WorkspaceManager {
  private readonly _rootDir: string;
  private readonly driftDir: string;
  private readonly config: WorkspaceManagerConfig;
  private readonly backupManager: BackupManager;
  private readonly contextLoader: ContextLoader;
  private readonly projectSwitcher: ProjectSwitcher;
  private schemaMigrator: SchemaMigrator;
  private driftVersion: string = 'unknown';
  private _initialized: boolean = false;

  constructor(
    rootDir: string,
    config: Partial<WorkspaceManagerConfig> = {}
  ) {
    this._rootDir = rootDir;
    this.driftDir = path.join(rootDir, '.drift');
    this.config = { ...DEFAULT_WORKSPACE_CONFIG, ...config };

    // Initialize components
    this.backupManager = new BackupManager(rootDir, this.config);
    this.contextLoader = new ContextLoader(rootDir, this.config);
    this.projectSwitcher = new ProjectSwitcher(this.config);
    this.schemaMigrator = new SchemaMigrator(rootDir, this.backupManager);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the workspace manager
   */
  async initialize(options: WorkspaceInitOptions = {}): Promise<void> {
    if (options.driftVersion) {
      this.driftVersion = options.driftVersion;
    }

    if (options.registry) {
      this.projectSwitcher.setRegistry(options.registry);
    }

    // Check for migration
    if (!options.skipMigration) {
      const needsMigration = await this.schemaMigrator.needsMigration();
      if (needsMigration) {
        // Auto-migrate with backup
        await this.schemaMigrator.migrate(this.driftVersion);
      }
    }

    this._initialized = true;
  }

  /**
   * Check if workspace is initialized
   */
  async isInitialized(): Promise<boolean> {
    return this.contextLoader.isInitialized();
  }

  // ==========================================================================
  // Status & Context
  // ==========================================================================

  /**
   * Get workspace status
   */
  async getStatus(): Promise<WorkspaceStatus> {
    const initialized = await this.isInitialized();
    const activeProject = await this.projectSwitcher.getActiveIndicator();
    const backups = await this.backupManager.listBackups();
    const migrationNeeded = initialized ? await this.schemaMigrator.needsMigration() : false;
    const schemaVersion = initialized ? await this.schemaMigrator.getCurrentVersion() : '0.0.0';

    let contextLoaded = false;
    if (initialized) {
      try {
        await this.contextLoader.loadContext();
        contextLoaded = true;
      } catch {
        // Context not loaded
      }
    }

    return {
      initialized,
      activeProject,
      contextLoaded,
      migrationNeeded,
      schemaVersion,
      backupCount: backups.length,
      lastBackup: backups[0]?.createdAt,
    };
  }

  /**
   * Get workspace context (pre-loaded for fast access)
   */
  async getContext(forceRefresh = false): Promise<WorkspaceContext> {
    return this.contextLoader.loadContext(forceRefresh);
  }

  /**
   * Get agent-friendly project context
   */
  async getAgentContext(): Promise<AgentProjectContext> {
    return this.projectSwitcher.getAgentContext();
  }

  /**
   * Invalidate context cache
   */
  invalidateCache(): void {
    this.contextLoader.invalidateCache();
    this.projectSwitcher.clearCache();
  }

  // ==========================================================================
  // Project Management
  // ==========================================================================

  /**
   * Get active project indicator
   */
  async getActiveProject(): Promise<ActiveProjectIndicator | null> {
    return this.projectSwitcher.getActiveIndicator();
  }

  /**
   * Switch to a different project
   */
  async switchProject(request: ProjectSwitchRequest): Promise<ProjectSwitchResult> {
    const result = await this.projectSwitcher.switchProject(request);
    
    if (result.success) {
      // Invalidate cache for new project
      this.invalidateCache();
    }

    return result;
  }

  /**
   * Format project indicator for CLI output
   */
  formatProjectIndicator(): string {
    const indicator = this.projectSwitcher['currentIndicator'];
    if (!indicator) {
      return '';
    }
    return this.projectSwitcher.formatIndicator(indicator);
  }

  /**
   * Format project header for CLI output
   */
  formatProjectHeader(): string {
    const indicator = this.projectSwitcher['currentIndicator'];
    if (!indicator) {
      return '';
    }
    return this.projectSwitcher.formatHeader(indicator);
  }

  // ==========================================================================
  // Backup & Restore
  // ==========================================================================

  /**
   * Create a backup
   */
  async createBackup(reason: 'user_requested' | 'pre_destructive_operation' | 'scheduled' = 'user_requested'): Promise<BackupResult> {
    return this.backupManager.createBackup(reason, this.driftVersion);
  }

  /**
   * Restore from a backup
   */
  async restore(backupId: string): Promise<RestoreResult> {
    const result = await this.backupManager.restore(backupId);
    
    if (result.success) {
      // Invalidate cache after restore
      this.invalidateCache();
    }

    return result;
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    return this.backupManager.listBackups();
  }

  /**
   * Delete a backup (requires explicit "DELETE" confirmation)
   */
  async deleteBackup(backupId: string, confirmationToken: string): Promise<boolean> {
    return this.backupManager.deleteBackup(backupId, confirmationToken);
  }

  // ==========================================================================
  // Schema Migration
  // ==========================================================================

  /**
   * Check if migration is needed
   */
  async needsMigration(): Promise<boolean> {
    return this.schemaMigrator.needsMigration();
  }

  /**
   * Run pending migrations
   */
  async migrate(): Promise<MigrationResult> {
    return this.schemaMigrator.migrate(this.driftVersion);
  }

  /**
   * Get current schema version
   */
  async getSchemaVersion(): Promise<string> {
    return this.schemaMigrator.getCurrentVersion();
  }

  // ==========================================================================
  // Destructive Operations
  // ==========================================================================

  /**
   * Perform a destructive operation with safety checks
   */
  async performDestructiveOperation(
    request: DestructiveOperationRequest,
    operation: () => Promise<void>
  ): Promise<{ success: boolean; backupId?: string | undefined; error?: string | undefined }> {
    // Check if backup is needed
    const shouldBackup = !request.skipBackup && 
      await this.backupManager.shouldBackup(request.operation);

    let backupId: string | undefined;

    // Create backup if needed
    if (shouldBackup) {
      const backupResult = await this.backupManager.createBackup(
        'pre_destructive_operation',
        this.driftVersion
      );

      if (!backupResult.success) {
        return {
          success: false,
          error: `Failed to create backup: ${backupResult.error}`,
        };
      }

      backupId = backupResult.backupId;
    }

    // Perform operation
    try {
      await operation();
      
      // Invalidate cache after destructive operation
      this.invalidateCache();

      return { success: true, backupId };
    } catch (error) {
      return {
        success: false,
        backupId,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Delete .drift folder (requires explicit "DELETE" confirmation)
   */
  async deleteDriftFolder(confirmationToken: string): Promise<{ success: boolean; backupId?: string | undefined; error?: string | undefined }> {
    if (confirmationToken !== 'DELETE') {
      return {
        success: false,
        error: 'Deletion requires explicit confirmation token "DELETE"',
      };
    }

    return this.performDestructiveOperation(
      { operation: 'delete', confirmationToken },
      async () => {
        await fs.rm(this.driftDir, { recursive: true, force: true });
      }
    );
  }

  /**
   * Reset workspace (delete and reinitialize)
   */
  async reset(confirmationToken: string): Promise<{ success: boolean; backupId?: string | undefined; error?: string | undefined }> {
    if (confirmationToken !== 'DELETE') {
      return {
        success: false,
        error: 'Reset requires explicit confirmation token "DELETE"',
      };
    }

    return this.performDestructiveOperation(
      { operation: 'reset', confirmationToken },
      async () => {
        // Delete everything except backups
        const entries = await fs.readdir(this.driftDir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.name === '.drift-backups') continue;
          
          const fullPath = path.join(this.driftDir, entry.name);
          await fs.rm(fullPath, { recursive: true, force: true });
        }
      }
    );
  }

  // ==========================================================================
  // Getters for Components
  // ==========================================================================

  /**
   * Get backup manager instance
   */
  getBackupManager(): BackupManager {
    return this.backupManager;
  }

  /**
   * Get context loader instance
   */
  getContextLoader(): ContextLoader {
    return this.contextLoader;
  }

  /**
   * Get project switcher instance
   */
  getProjectSwitcher(): ProjectSwitcher {
    return this.projectSwitcher;
  }

  /**
   * Get schema migrator instance
   */
  getSchemaMigrator(): SchemaMigrator {
    return this.schemaMigrator;
  }

  /**
   * Get root directory
   */
  getRootDir(): string {
    return this._rootDir;
  }

  /**
   * Check if manager is initialized
   */
  isManagerInitialized(): boolean {
    return this._initialized;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a workspace manager instance
 */
export function createWorkspaceManager(
  rootDir: string,
  config?: Partial<WorkspaceManagerConfig>
): WorkspaceManager {
  return new WorkspaceManager(rootDir, config);
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalWorkspaceManager: WorkspaceManager | null = null;

/**
 * Get or create the global workspace manager
 */
export async function getWorkspaceManager(
  rootDir?: string,
  options?: WorkspaceInitOptions
): Promise<WorkspaceManager> {
  if (!globalWorkspaceManager && rootDir) {
    globalWorkspaceManager = new WorkspaceManager(rootDir);
    await globalWorkspaceManager.initialize(options);
  }

  if (!globalWorkspaceManager) {
    throw new Error('Workspace manager not initialized. Provide rootDir on first call.');
  }

  return globalWorkspaceManager;
}

/**
 * Reset the global workspace manager (for testing)
 */
export function resetGlobalWorkspaceManager(): void {
  globalWorkspaceManager = null;
}
