/**
 * Backup Manager
 * 
 * Enterprise-grade backup and restore system for .drift data.
 * Ensures data safety during version upgrades and migrations.
 * 
 * Features:
 * - Automatic backups before destructive operations
 * - Version-aware backup naming
 * - Integrity verification via checksums
 * - Retention policy enforcement
 * - Compressed backups for storage efficiency
 * 
 * @module workspace/backup-manager
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

import type {
  BackupMetadata,
  BackupReason,
  BackupResult,
  RestoreResult,
  WorkspaceManagerConfig,
} from './types.js';
import { DEFAULT_WORKSPACE_CONFIG } from './types.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ============================================================================
// Constants
// ============================================================================

const BACKUP_DIR = '.drift-backups';
const BACKUP_MANIFEST = 'backup-manifest.json';
const CURRENT_SCHEMA_VERSION = '2.0.0';

/**
 * Files/directories to skip (can be regenerated)
 */
const SKIP_PATHS = [
  'cache',
  'history/snapshots',
  '.backups',
];

// ============================================================================
// Backup Manager Class
// ============================================================================

export class BackupManager {
  private readonly rootDir: string;
  private readonly driftDir: string;
  private readonly backupDir: string;
  private readonly config: WorkspaceManagerConfig;

  constructor(
    rootDir: string,
    config: Partial<WorkspaceManagerConfig> = {}
  ) {
    this.rootDir = rootDir;
    this.driftDir = path.join(rootDir, '.drift');
    this.backupDir = path.join(rootDir, BACKUP_DIR);
    this.config = { ...DEFAULT_WORKSPACE_CONFIG, ...config };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Create a backup of the .drift directory
   */
  async createBackup(
    reason: BackupReason,
    driftVersion: string
  ): Promise<BackupResult> {
    const backupId = this.generateBackupId();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup-${timestamp}-${reason}`;
    const backupPath = path.join(this.backupDir, backupName);

    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });

      // Collect files to backup
      const files = await this.collectBackupFiles();
      
      if (files.length === 0) {
        return {
          success: false,
          backupId,
          backupPath,
          metadata: this.createEmptyMetadata(backupId, reason, driftVersion),
          error: 'No files to backup',
        };
      }

      // Create backup directory
      await fs.mkdir(backupPath, { recursive: true });

      // Copy files
      let totalSize = 0;
      const backedUpFiles: string[] = [];

      for (const file of files) {
        const sourcePath = path.join(this.driftDir, file);
        const destPath = path.join(backupPath, file);
        
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        
        const content = await fs.readFile(sourcePath);
        
        if (this.config.autoBackup && file.endsWith('.json')) {
          // Compress JSON files
          const compressed = await gzip(content);
          await fs.writeFile(destPath + '.gz', compressed);
          totalSize += compressed.length;
        } else {
          await fs.copyFile(sourcePath, destPath);
          totalSize += content.length;
        }
        
        backedUpFiles.push(file);
      }

      // Calculate checksum
      const checksum = await this.calculateDirectoryChecksum(backupPath);

      // Create metadata
      const metadata: BackupMetadata = {
        id: backupId,
        driftVersion,
        schemaVersion: await this.detectSchemaVersion(),
        createdAt: new Date().toISOString(),
        reason,
        sizeBytes: totalSize,
        checksum,
        originalPath: this.driftDir,
        projectName: path.basename(this.rootDir),
        compressed: this.config.autoBackup,
        files: backedUpFiles,
      };

      // Save metadata
      await fs.writeFile(
        path.join(backupPath, BACKUP_MANIFEST),
        JSON.stringify(metadata, null, 2)
      );

      // Update backup index
      await this.updateBackupIndex(metadata);

      // Enforce retention policy
      await this.enforceRetentionPolicy();

      return {
        success: true,
        backupId,
        backupPath,
        metadata,
      };
    } catch (error) {
      return {
        success: false,
        backupId,
        backupPath,
        metadata: this.createEmptyMetadata(backupId, reason, driftVersion),
        error: (error as Error).message,
      };
    }
  }

  /**
   * Restore from a backup
   */
  async restore(backupId: string): Promise<RestoreResult> {
    try {
      const backup = await this.findBackup(backupId);
      
      if (!backup) {
        return {
          success: false,
          restoredFrom: '',
          restoredTo: this.driftDir,
          filesRestored: 0,
          error: `Backup not found: ${backupId}`,
        };
      }

      // Verify checksum
      const currentChecksum = await this.calculateDirectoryChecksum(backup.path);
      if (currentChecksum !== backup.metadata.checksum) {
        return {
          success: false,
          restoredFrom: backup.path,
          restoredTo: this.driftDir,
          filesRestored: 0,
          error: 'Backup integrity check failed',
        };
      }

      // Create backup of current state before restore
      await this.createBackup('pre_destructive_operation', backup.metadata.driftVersion);

      // Restore files
      let filesRestored = 0;
      
      for (const file of backup.metadata.files) {
        const sourcePath = path.join(backup.path, file);
        const destPath = path.join(this.driftDir, file);
        
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        
        // Check for compressed version
        try {
          const compressedPath = sourcePath + '.gz';
          await fs.access(compressedPath);
          const compressed = await fs.readFile(compressedPath);
          const decompressed = await gunzip(compressed);
          await fs.writeFile(destPath, decompressed);
        } catch {
          // Not compressed, copy directly
          await fs.copyFile(sourcePath, destPath);
        }
        
        filesRestored++;
      }

      return {
        success: true,
        restoredFrom: backup.path,
        restoredTo: this.driftDir,
        filesRestored,
      };
    } catch (error) {
      return {
        success: false,
        restoredFrom: '',
        restoredTo: this.driftDir,
        filesRestored: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      const indexPath = path.join(this.backupDir, 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content) as { backups: BackupMetadata[] };
      return index.backups.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch {
      return [];
    }
  }

  /**
   * Delete a specific backup (requires explicit confirmation)
   */
  async deleteBackup(backupId: string, confirmationToken: string): Promise<boolean> {
    // Require explicit "DELETE" token to prevent accidental deletion
    if (confirmationToken !== 'DELETE') {
      throw new Error('Deletion requires explicit confirmation token "DELETE"');
    }

    const backup = await this.findBackup(backupId);
    if (!backup) {
      return false;
    }

    await fs.rm(backup.path, { recursive: true, force: true });
    await this.removeFromIndex(backupId);
    
    return true;
  }

  /**
   * Check if backup is needed before operation
   */
  async shouldBackup(operation: string): Promise<boolean> {
    const destructiveOperations = [
      'upgrade',
      'migrate',
      'reset',
      'clean',
      'delete',
    ];

    if (!this.config.autoBackup) {
      return false;
    }

    return destructiveOperations.some(op => operation.toLowerCase().includes(op));
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private generateBackupId(): string {
    return crypto.randomUUID().slice(0, 8);
  }

  private async collectBackupFiles(): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string, base: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const relativePath = path.join(base, entry.name);
          
          // Skip excluded paths
          if (SKIP_PATHS.some(skip => relativePath.startsWith(skip))) {
            continue;
          }

          if (entry.isDirectory()) {
            await walk(path.join(dir, entry.name), relativePath);
          } else {
            files.push(relativePath);
          }
        }
      } catch {
        // Directory doesn't exist or not readable
      }
    }

    await walk(this.driftDir, '');
    return files;
  }

  private async calculateDirectoryChecksum(dir: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    
    async function processDir(currentDir: string): Promise<void> {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.name === BACKUP_MANIFEST) continue;
          
          if (entry.isDirectory()) {
            await processDir(fullPath);
          } else {
            const content = await fs.readFile(fullPath);
            hash.update(entry.name);
            hash.update(content);
          }
        }
      } catch {
        // Skip unreadable
      }
    }

    await processDir(dir);
    return hash.digest('hex');
  }

  private async detectSchemaVersion(): Promise<string> {
    try {
      const configPath = path.join(this.driftDir, 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return config.version ?? CURRENT_SCHEMA_VERSION;
    } catch {
      return CURRENT_SCHEMA_VERSION;
    }
  }

  private createEmptyMetadata(
    id: string,
    reason: BackupReason,
    driftVersion: string
  ): BackupMetadata {
    return {
      id,
      driftVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      reason,
      sizeBytes: 0,
      checksum: '',
      originalPath: this.driftDir,
      projectName: path.basename(this.rootDir),
      compressed: false,
      files: [],
    };
  }

  private async findBackup(
    backupId: string
  ): Promise<{ path: string; metadata: BackupMetadata } | null> {
    const backups = await this.listBackups();
    const metadata = backups.find(b => b.id === backupId);
    
    if (!metadata) return null;

    // Find backup directory
    try {
      const entries = await fs.readdir(this.backupDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const manifestPath = path.join(this.backupDir, entry.name, BACKUP_MANIFEST);
        try {
          const content = await fs.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(content) as BackupMetadata;
          if (manifest.id === backupId) {
            return {
              path: path.join(this.backupDir, entry.name),
              metadata: manifest,
            };
          }
        } catch {
          continue;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private async updateBackupIndex(metadata: BackupMetadata): Promise<void> {
    const indexPath = path.join(this.backupDir, 'index.json');
    
    let index: { backups: BackupMetadata[] } = { backups: [] };
    
    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      index = JSON.parse(content);
    } catch {
      // Index doesn't exist yet
    }

    index.backups.push(metadata);
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  }

  private async removeFromIndex(backupId: string): Promise<void> {
    const indexPath = path.join(this.backupDir, 'index.json');
    
    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content) as { backups: BackupMetadata[] };
      index.backups = index.backups.filter(b => b.id !== backupId);
      await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    } catch {
      // Index doesn't exist
    }
  }

  private async enforceRetentionPolicy(): Promise<void> {
    const backups = await this.listBackups();
    
    if (backups.length <= this.config.maxBackups) {
      return;
    }

    // Sort by date, oldest first
    const sorted = backups.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // Remove oldest backups exceeding limit
    const toRemove = sorted.slice(0, backups.length - this.config.maxBackups);
    
    for (const backup of toRemove) {
      const found = await this.findBackup(backup.id);
      if (found) {
        await fs.rm(found.path, { recursive: true, force: true });
        await this.removeFromIndex(backup.id);
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a backup manager instance
 */
export function createBackupManager(
  rootDir: string,
  config?: Partial<WorkspaceManagerConfig>
): BackupManager {
  return new BackupManager(rootDir, config);
}
