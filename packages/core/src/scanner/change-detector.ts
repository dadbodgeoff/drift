/**
 * Change Detector - File modification detection
 *
 * Detects file changes via mtime/hash comparison and tracks
 * file additions and deletions between scans.
 *
 * @requirements 2.2 - WHEN a file changes, THE Scanner SHALL perform incremental analysis only on affected files
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { FileInfo } from './types.js';

/**
 * Types of changes that can be detected
 */
export type ChangeType = 'added' | 'modified' | 'deleted' | 'unchanged';

/**
 * Stored state of a file for change detection
 */
export interface FileSnapshot {
  /** Relative path to the file from workspace root */
  path: string;

  /** Last modification time as ISO string */
  mtime: string;

  /** Content hash (SHA-256) for verification */
  hash: string;

  /** File size in bytes */
  size: number;
}

/**
 * Result of change detection between two scans
 */
export interface ChangeSet {
  /** Files that were added since the last scan */
  added: string[];

  /** Files that were modified since the last scan */
  modified: string[];

  /** Files that were deleted since the last scan */
  deleted: string[];

  /** Files that remain unchanged */
  unchanged: string[];

  /** Timestamp when the change detection was performed */
  timestamp: Date;

  /** Total number of files in the current scan */
  totalFiles: number;
}

/**
 * Detailed change information for a single file
 */
export interface FileChange {
  /** Relative path to the file */
  path: string;

  /** Type of change detected */
  type: ChangeType;

  /** Previous snapshot (if file existed before) */
  previousSnapshot?: FileSnapshot;

  /** Current snapshot (if file exists now) */
  currentSnapshot?: FileSnapshot;
}

/**
 * Options for change detection
 */
export interface ChangeDetectionOptions {
  /**
   * Whether to verify changes using content hash
   * When true, files with same mtime but different hash are marked as modified
   * @default false
   */
  verifyWithHash?: boolean;

  /**
   * Tolerance in milliseconds for mtime comparison
   * Files with mtime difference less than this are considered unchanged
   * Useful for file systems with low mtime precision
   * @default 0
   */
  mtimeTolerance?: number;
}

/**
 * Snapshot file format for persistence
 */
export interface SnapshotFile {
  /** Version of the snapshot format */
  version: string;

  /** Timestamp when the snapshot was created */
  createdAt: string;

  /** Root directory the snapshot was taken from */
  rootDir: string;

  /** Array of file snapshots */
  files: FileSnapshot[];
}

/**
 * Current snapshot file format version
 */
const SNAPSHOT_VERSION = '1.0.0';

/**
 * ChangeDetector class for tracking file changes between scans
 *
 * Provides functionality to:
 * - Detect modified files via mtime comparison and optional hash verification
 * - Track file additions (new files not in previous scan)
 * - Track file deletions (files in previous scan but not current)
 * - Save and load snapshots for persistence
 *
 * @requirements 2.2 - Incremental analysis on affected files
 */
export class ChangeDetector {
  /**
   * Detect changes between current files and a previous snapshot
   *
   * @param currentFiles - Array of FileInfo from the current scan
   * @param previousSnapshot - Array of FileSnapshot from the previous scan
   * @param options - Optional change detection options
   * @returns ChangeSet containing added, modified, deleted, and unchanged files
   */
  detectChanges(
    currentFiles: FileInfo[],
    previousSnapshot: FileSnapshot[],
    options: ChangeDetectionOptions = {}
  ): ChangeSet {
    const { verifyWithHash = false, mtimeTolerance = 0 } = options;

    // Create maps for efficient lookup
    const previousMap = new Map<string, FileSnapshot>();
    for (const snapshot of previousSnapshot) {
      previousMap.set(snapshot.path, snapshot);
    }

    const currentMap = new Map<string, FileInfo>();
    for (const file of currentFiles) {
      currentMap.set(file.relativePath, file);
    }

    const added: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];
    const deleted: string[] = [];

    // Check current files against previous snapshot
    for (const file of currentFiles) {
      const relativePath = file.relativePath;
      const previous = previousMap.get(relativePath);

      if (!previous) {
        // File is new
        added.push(relativePath);
      } else {
        // File existed before - check if modified
        const isModified = this.isFileModified(file, previous, {
          verifyWithHash,
          mtimeTolerance,
        });

        if (isModified) {
          modified.push(relativePath);
        } else {
          unchanged.push(relativePath);
        }
      }
    }

    // Check for deleted files (in previous but not in current)
    for (const snapshot of previousSnapshot) {
      if (!currentMap.has(snapshot.path)) {
        deleted.push(snapshot.path);
      }
    }

    return {
      added,
      modified,
      deleted,
      unchanged,
      timestamp: new Date(),
      totalFiles: currentFiles.length,
    };
  }

  /**
   * Get detailed change information for each file
   *
   * @param currentFiles - Array of FileInfo from the current scan
   * @param previousSnapshot - Array of FileSnapshot from the previous scan
   * @param options - Optional change detection options
   * @returns Array of FileChange with detailed information
   */
  getDetailedChanges(
    currentFiles: FileInfo[],
    previousSnapshot: FileSnapshot[],
    options: ChangeDetectionOptions = {}
  ): FileChange[] {
    const { verifyWithHash = false, mtimeTolerance = 0 } = options;
    const changes: FileChange[] = [];

    // Create maps for efficient lookup
    const previousMap = new Map<string, FileSnapshot>();
    for (const snapshot of previousSnapshot) {
      previousMap.set(snapshot.path, snapshot);
    }

    const currentMap = new Map<string, FileInfo>();
    for (const file of currentFiles) {
      currentMap.set(file.relativePath, file);
    }

    // Process current files
    for (const file of currentFiles) {
      const relativePath = file.relativePath;
      const previous = previousMap.get(relativePath);
      const currentSnapshot = this.fileInfoToSnapshot(file);

      if (!previous) {
        changes.push({
          path: relativePath,
          type: 'added',
          currentSnapshot,
        });
      } else {
        const isModified = this.isFileModified(file, previous, {
          verifyWithHash,
          mtimeTolerance,
        });

        changes.push({
          path: relativePath,
          type: isModified ? 'modified' : 'unchanged',
          previousSnapshot: previous,
          currentSnapshot,
        });
      }
    }

    // Process deleted files
    for (const snapshot of previousSnapshot) {
      if (!currentMap.has(snapshot.path)) {
        changes.push({
          path: snapshot.path,
          type: 'deleted',
          previousSnapshot: snapshot,
        });
      }
    }

    return changes;
  }

  /**
   * Create a snapshot from an array of FileInfo
   *
   * @param files - Array of FileInfo from a scan
   * @returns Array of FileSnapshot for persistence
   */
  createSnapshot(files: FileInfo[]): FileSnapshot[] {
    return files.map((file) => this.fileInfoToSnapshot(file));
  }

  /**
   * Save a snapshot to a file
   *
   * @param snapshot - Array of FileSnapshot to save
   * @param filePath - Path to save the snapshot file
   * @param rootDir - Root directory the snapshot was taken from
   */
  async saveSnapshot(
    snapshot: FileSnapshot[],
    filePath: string,
    rootDir: string
  ): Promise<void> {
    const snapshotFile: SnapshotFile = {
      version: SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      rootDir,
      files: snapshot,
    };

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write snapshot file
    const content = JSON.stringify(snapshotFile, null, 2);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Load a snapshot from a file
   *
   * @param filePath - Path to the snapshot file
   * @returns Array of FileSnapshot, or empty array if file doesn't exist
   */
  async loadSnapshot(filePath: string): Promise<FileSnapshot[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const snapshotFile: SnapshotFile = JSON.parse(content);

      // Validate version
      if (!snapshotFile.version) {
        throw new Error('Invalid snapshot file: missing version');
      }

      // For now, we only support version 1.0.0
      // Future versions may need migration logic
      if (!snapshotFile.version.startsWith('1.')) {
        throw new Error(`Unsupported snapshot version: ${snapshotFile.version}`);
      }

      return snapshotFile.files || [];
    } catch (error) {
      // If file doesn't exist, return empty snapshot
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Compute a content hash for a file
   *
   * @param filePath - Absolute path to the file
   * @returns SHA-256 hash as hex string
   */
  async computeFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check if a file has been modified based on mtime and optionally hash
   *
   * @param current - Current FileInfo
   * @param previous - Previous FileSnapshot
   * @param options - Change detection options
   * @returns True if the file has been modified
   */
  private isFileModified(
    current: FileInfo,
    previous: FileSnapshot,
    options: { verifyWithHash: boolean; mtimeTolerance: number }
  ): boolean {
    const { verifyWithHash, mtimeTolerance } = options;

    // Check size first (quick check)
    if (current.size !== previous.size) {
      return true;
    }

    // Check mtime
    const currentMtime = current.mtime.getTime();
    const previousMtime = new Date(previous.mtime).getTime();
    const mtimeDiff = Math.abs(currentMtime - previousMtime);

    if (mtimeDiff > mtimeTolerance) {
      // mtime differs - file is likely modified
      // If hash verification is enabled and we have hashes, double-check
      if (verifyWithHash && current.hash && previous.hash) {
        return current.hash !== previous.hash;
      }
      return true;
    }

    // mtime is within tolerance
    // If hash verification is enabled and we have hashes, verify
    if (verifyWithHash && current.hash && previous.hash) {
      return current.hash !== previous.hash;
    }

    // No modification detected
    return false;
  }

  /**
   * Convert a FileInfo to a FileSnapshot
   *
   * @param file - FileInfo from a scan
   * @returns FileSnapshot for storage
   */
  private fileInfoToSnapshot(file: FileInfo): FileSnapshot {
    return {
      path: file.relativePath,
      mtime: file.mtime.toISOString(),
      hash: file.hash || '',
      size: file.size,
    };
  }
}
