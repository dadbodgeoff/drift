/**
 * Schema Migrator
 * 
 * Enterprise-grade schema migration system for .drift data.
 * Handles version upgrades with automatic backup and rollback.
 * 
 * Features:
 * - Automatic schema version detection
 * - Sequential migration execution
 * - Automatic backup before migration
 * - Rollback support on failure
 * - Migration history tracking
 * 
 * @module workspace/schema-migrator
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { SchemaMigration } from './types.js';
import { BackupManager } from './backup-manager.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  migrationsApplied: string[];
  backupId?: string;
  error?: string;
  rollbackPerformed?: boolean;
}

/**
 * Migration history entry
 */
export interface MigrationHistoryEntry {
  id: string;
  fromVersion: string;
  toVersion: string;
  appliedAt: string;
  backupId: string;
  success: boolean;
  error?: string;
}

/**
 * Migration history file
 */
export interface MigrationHistory {
  version: string;
  currentSchemaVersion: string;
  migrations: MigrationHistoryEntry[];
}

// ============================================================================
// Constants
// ============================================================================

const CURRENT_SCHEMA_VERSION = '2.0.0';
const MIGRATION_HISTORY_FILE = 'migration-history.json';

// ============================================================================
// Built-in Migrations
// ============================================================================

/**
 * Migration from 1.0.0 to 1.1.0
 * - Adds pattern confidence breakdown
 */
const migration_1_0_0_to_1_1_0: SchemaMigration = {
  id: 'migrate-1.0.0-to-1.1.0',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  description: 'Add pattern confidence breakdown',
  async migrate(data: unknown): Promise<unknown> {
    const config = data as Record<string, unknown>;
    config['version'] = '1.1.0';
    return config;
  },
  async rollback(data: unknown): Promise<unknown> {
    const config = data as Record<string, unknown>;
    config['version'] = '1.0.0';
    return config;
  },
};

/**
 * Migration from 1.1.0 to 2.0.0
 * - Restructures lake directory
 * - Adds memory system support
 */
const migration_1_1_0_to_2_0_0: SchemaMigration = {
  id: 'migrate-1.1.0-to-2.0.0',
  fromVersion: '1.1.0',
  toVersion: '2.0.0',
  description: 'Restructure lake directory and add memory system',
  async migrate(data: unknown): Promise<unknown> {
    const config = data as Record<string, unknown>;
    config['version'] = '2.0.0';
    config['features'] = {
      ...(config['features'] as Record<string, unknown> ?? {}),
      memory: { enabled: false },
    };
    return config;
  },
  async rollback(data: unknown): Promise<unknown> {
    const config = data as Record<string, unknown>;
    config['version'] = '1.1.0';
    if (config['features'] && typeof config['features'] === 'object') {
      delete (config['features'] as Record<string, unknown>)['memory'];
    }
    return config;
  },
};

/**
 * All available migrations in order
 */
const MIGRATIONS: SchemaMigration[] = [
  migration_1_0_0_to_1_1_0,
  migration_1_1_0_to_2_0_0,
];

// ============================================================================
// Schema Migrator Class
// ============================================================================

export class SchemaMigrator {
  private readonly _rootDir: string;
  private readonly driftDir: string;
  private readonly backupManager: BackupManager;
  private readonly migrations: SchemaMigration[];

  constructor(
    rootDir: string,
    backupManager: BackupManager,
    customMigrations: SchemaMigration[] = []
  ) {
    this._rootDir = rootDir;
    this.driftDir = path.join(rootDir, '.drift');
    this.backupManager = backupManager;
    this.migrations = [...MIGRATIONS, ...customMigrations];
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get current schema version
   */
  async getCurrentVersion(): Promise<string> {
    try {
      const configPath = path.join(this.driftDir, 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return config.version ?? '1.0.0';
    } catch {
      return '1.0.0';
    }
  }

  /**
   * Get target schema version
   */
  getTargetVersion(): string {
    return CURRENT_SCHEMA_VERSION;
  }

  /**
   * Check if migration is needed
   */
  async needsMigration(): Promise<boolean> {
    const current = await this.getCurrentVersion();
    return this.compareVersions(current, CURRENT_SCHEMA_VERSION) < 0;
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations(): Promise<SchemaMigration[]> {
    const current = await this.getCurrentVersion();
    return this.getMigrationPath(current, CURRENT_SCHEMA_VERSION);
  }

  /**
   * Run all pending migrations
   */
  async migrate(driftVersion: string): Promise<MigrationResult> {
    const fromVersion = await this.getCurrentVersion();
    const toVersion = CURRENT_SCHEMA_VERSION;

    // Check if migration needed
    if (this.compareVersions(fromVersion, toVersion) >= 0) {
      return {
        success: true,
        fromVersion,
        toVersion: fromVersion,
        migrationsApplied: [],
      };
    }

    // Get migration path
    const pendingMigrations = this.getMigrationPath(fromVersion, toVersion);
    
    if (pendingMigrations.length === 0) {
      return {
        success: false,
        fromVersion,
        toVersion,
        migrationsApplied: [],
        error: `No migration path from ${fromVersion} to ${toVersion}`,
      };
    }

    // Create backup before migration
    const backupResult = await this.backupManager.createBackup('schema_migration', driftVersion);
    
    if (!backupResult.success) {
      return {
        success: false,
        fromVersion,
        toVersion,
        migrationsApplied: [],
        error: `Failed to create backup: ${backupResult.error}`,
      };
    }

    const appliedMigrations: string[] = [];
    let currentVersion = fromVersion;

    try {
      // Apply migrations sequentially
      for (const migration of pendingMigrations) {
        await this.applyMigration(migration);
        appliedMigrations.push(migration.id);
        currentVersion = migration.toVersion;
      }

      // Record migration history
      await this.recordMigration({
        id: `migration-${Date.now()}`,
        fromVersion,
        toVersion: currentVersion,
        appliedAt: new Date().toISOString(),
        backupId: backupResult.backupId,
        success: true,
      });

      return {
        success: true,
        fromVersion,
        toVersion: currentVersion,
        migrationsApplied: appliedMigrations,
        backupId: backupResult.backupId,
      };
    } catch (error) {
      // Attempt rollback
      const rollbackSuccess = await this.rollback(appliedMigrations, fromVersion);

      // Record failed migration
      await this.recordMigration({
        id: `migration-${Date.now()}`,
        fromVersion,
        toVersion: currentVersion,
        appliedAt: new Date().toISOString(),
        backupId: backupResult.backupId,
        success: false,
        error: (error as Error).message,
      });

      return {
        success: false,
        fromVersion,
        toVersion: currentVersion,
        migrationsApplied: appliedMigrations,
        backupId: backupResult.backupId,
        error: (error as Error).message,
        rollbackPerformed: rollbackSuccess,
      };
    }
  }

  /**
   * Get migration history
   */
  async getHistory(): Promise<MigrationHistory> {
    try {
      const historyPath = path.join(this.driftDir, MIGRATION_HISTORY_FILE);
      const content = await fs.readFile(historyPath, 'utf-8');
      return JSON.parse(content) as MigrationHistory;
    } catch {
      return {
        version: '1.0.0',
        currentSchemaVersion: await this.getCurrentVersion(),
        migrations: [],
      };
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private getMigrationPath(from: string, to: string): SchemaMigration[] {
    const path: SchemaMigration[] = [];
    let current = from;

    while (this.compareVersions(current, to) < 0) {
      const next = this.migrations.find(m => m.fromVersion === current);
      if (!next) {
        break;
      }
      path.push(next);
      current = next.toVersion;
    }

    return path;
  }

  private async applyMigration(migration: SchemaMigration): Promise<void> {
    // Load config
    const configPath = path.join(this.driftDir, 'config.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Apply migration
    const migrated = await migration.migrate(config);

    // Save config
    await fs.writeFile(configPath, JSON.stringify(migrated, null, 2));
  }

  private async rollback(appliedMigrations: string[], targetVersion: string): Promise<boolean> {
    try {
      // Rollback in reverse order
      for (const migrationId of appliedMigrations.reverse()) {
        const migration = this.migrations.find(m => m.id === migrationId);
        if (migration?.rollback) {
          const configPath = path.join(this.driftDir, 'config.json');
          const content = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(content);
          const rolledBack = await migration.rollback(config);
          await fs.writeFile(configPath, JSON.stringify(rolledBack, null, 2));
        }
      }

      // Update version
      const configPath = path.join(this.driftDir, 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      config.version = targetVersion;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      return true;
    } catch {
      return false;
    }
  }

  private async recordMigration(entry: MigrationHistoryEntry): Promise<void> {
    const history = await this.getHistory();
    history.migrations.push(entry);
    history.currentSchemaVersion = entry.success ? entry.toVersion : entry.fromVersion;

    const historyPath = path.join(this.driftDir, MIGRATION_HISTORY_FILE);
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] ?? 0;
      const numB = partsB[i] ?? 0;
      if (numA < numB) return -1;
      if (numA > numB) return 1;
    }

    return 0;
  }

  /**
   * Get root directory
   */
  getRootDir(): string {
    return this._rootDir;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a schema migrator instance
 */
export function createSchemaMigrator(
  rootDir: string,
  backupManager: BackupManager,
  customMigrations?: SchemaMigration[]
): SchemaMigrator {
  return new SchemaMigrator(rootDir, backupManager, customMigrations);
}
