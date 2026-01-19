/**
 * Unit tests for ChangeDetector
 *
 * Tests file modification detection, addition/deletion tracking,
 * and snapshot management.
 *
 * @requirements 2.2 - WHEN a file changes, THE Scanner SHALL perform incremental analysis only on affected files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ChangeDetector, type FileSnapshot, type SnapshotFile } from './change-detector.js';
import type { FileInfo } from './types.js';

describe('ChangeDetector', () => {
  let detector: ChangeDetector;
  let testDir: string;

  beforeEach(async () => {
    detector = new ChangeDetector();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-change-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a FileInfo object
   */
  function createFileInfo(
    relativePath: string,
    options: {
      size?: number;
      mtime?: Date;
      hash?: string;
    } = {}
  ): FileInfo {
    const { size = 100, mtime = new Date(), hash } = options;
    return {
      path: path.join(testDir, relativePath),
      relativePath,
      name: path.basename(relativePath),
      extension: path.extname(relativePath),
      size,
      mtime,
      isSymlink: false,
      ...(hash && { hash }),
    };
  }

  /**
   * Helper to create a FileSnapshot object
   */
  function createSnapshot(
    relativePath: string,
    options: {
      size?: number;
      mtime?: Date;
      hash?: string;
    } = {}
  ): FileSnapshot {
    const { size = 100, mtime = new Date(), hash = '' } = options;
    return {
      path: relativePath,
      size,
      mtime: mtime.toISOString(),
      hash,
    };
  }

  describe('detectChanges', () => {
    it('should detect no changes when files are identical', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const currentFiles = [
        createFileInfo('file1.ts', { size: 100, mtime }),
        createFileInfo('file2.ts', { size: 200, mtime }),
      ];
      const previousSnapshot = [
        createSnapshot('file1.ts', { size: 100, mtime }),
        createSnapshot('file2.ts', { size: 200, mtime }),
      ];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.added).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
      expect(result.unchanged).toHaveLength(2);
      expect(result.unchanged.sort()).toEqual(['file1.ts', 'file2.ts']);
    });

    it('should detect added files', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const currentFiles = [
        createFileInfo('existing.ts', { size: 100, mtime }),
        createFileInfo('new-file.ts', { size: 150, mtime }),
      ];
      const previousSnapshot = [createSnapshot('existing.ts', { size: 100, mtime })];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.added).toEqual(['new-file.ts']);
      expect(result.modified).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
      expect(result.unchanged).toEqual(['existing.ts']);
    });

    it('should detect deleted files', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const currentFiles = [createFileInfo('remaining.ts', { size: 100, mtime })];
      const previousSnapshot = [
        createSnapshot('remaining.ts', { size: 100, mtime }),
        createSnapshot('deleted.ts', { size: 200, mtime }),
      ];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.added).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.deleted).toEqual(['deleted.ts']);
      expect(result.unchanged).toEqual(['remaining.ts']);
    });

    it('should detect modified files by mtime change', () => {
      const oldMtime = new Date('2024-01-01T00:00:00Z');
      const newMtime = new Date('2024-01-02T00:00:00Z');
      const currentFiles = [createFileInfo('file.ts', { size: 100, mtime: newMtime })];
      const previousSnapshot = [createSnapshot('file.ts', { size: 100, mtime: oldMtime })];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.added).toHaveLength(0);
      expect(result.modified).toEqual(['file.ts']);
      expect(result.deleted).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });

    it('should detect modified files by size change', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const currentFiles = [createFileInfo('file.ts', { size: 200, mtime })];
      const previousSnapshot = [createSnapshot('file.ts', { size: 100, mtime })];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.modified).toEqual(['file.ts']);
      expect(result.unchanged).toHaveLength(0);
    });

    it('should handle empty current files (all deleted)', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const currentFiles: FileInfo[] = [];
      const previousSnapshot = [
        createSnapshot('file1.ts', { size: 100, mtime }),
        createSnapshot('file2.ts', { size: 200, mtime }),
      ];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.added).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.deleted).toHaveLength(2);
      expect(result.deleted.sort()).toEqual(['file1.ts', 'file2.ts']);
      expect(result.unchanged).toHaveLength(0);
    });

    it('should handle empty previous snapshot (all added)', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const currentFiles = [
        createFileInfo('file1.ts', { size: 100, mtime }),
        createFileInfo('file2.ts', { size: 200, mtime }),
      ];
      const previousSnapshot: FileSnapshot[] = [];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.added).toHaveLength(2);
      expect(result.added.sort()).toEqual(['file1.ts', 'file2.ts']);
      expect(result.modified).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });

    it('should handle mixed changes', () => {
      const oldMtime = new Date('2024-01-01T00:00:00Z');
      const newMtime = new Date('2024-01-02T00:00:00Z');
      const currentFiles = [
        createFileInfo('unchanged.ts', { size: 100, mtime: oldMtime }),
        createFileInfo('modified.ts', { size: 200, mtime: newMtime }),
        createFileInfo('added.ts', { size: 150, mtime: newMtime }),
      ];
      const previousSnapshot = [
        createSnapshot('unchanged.ts', { size: 100, mtime: oldMtime }),
        createSnapshot('modified.ts', { size: 100, mtime: oldMtime }),
        createSnapshot('deleted.ts', { size: 300, mtime: oldMtime }),
      ];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.added).toEqual(['added.ts']);
      expect(result.modified).toEqual(['modified.ts']);
      expect(result.deleted).toEqual(['deleted.ts']);
      expect(result.unchanged).toEqual(['unchanged.ts']);
      expect(result.totalFiles).toBe(3);
    });

    it('should include timestamp in result', () => {
      const before = new Date();
      const result = detector.detectChanges([], []);
      const after = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('detectChanges with hash verification', () => {
    it('should use hash to verify changes when enabled', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const currentFiles = [
        createFileInfo('file.ts', {
          size: 100,
          mtime,
          hash: 'abc123',
        }),
      ];
      const previousSnapshot = [
        createSnapshot('file.ts', {
          size: 100,
          mtime,
          hash: 'abc123',
        }),
      ];

      const result = detector.detectChanges(currentFiles, previousSnapshot, {
        verifyWithHash: true,
      });

      expect(result.unchanged).toEqual(['file.ts']);
      expect(result.modified).toHaveLength(0);
    });

    it('should detect modification when hash differs', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const newMtime = new Date('2024-01-02T00:00:00Z');
      const currentFiles = [
        createFileInfo('file.ts', {
          size: 100,
          mtime: newMtime,
          hash: 'newhash',
        }),
      ];
      const previousSnapshot = [
        createSnapshot('file.ts', {
          size: 100,
          mtime,
          hash: 'oldhash',
        }),
      ];

      const result = detector.detectChanges(currentFiles, previousSnapshot, {
        verifyWithHash: true,
      });

      expect(result.modified).toEqual(['file.ts']);
    });

    it('should not mark as modified when mtime differs but hash is same', () => {
      const oldMtime = new Date('2024-01-01T00:00:00Z');
      const newMtime = new Date('2024-01-02T00:00:00Z');
      const currentFiles = [
        createFileInfo('file.ts', {
          size: 100,
          mtime: newMtime,
          hash: 'samehash',
        }),
      ];
      const previousSnapshot = [
        createSnapshot('file.ts', {
          size: 100,
          mtime: oldMtime,
          hash: 'samehash',
        }),
      ];

      const result = detector.detectChanges(currentFiles, previousSnapshot, {
        verifyWithHash: true,
      });

      expect(result.unchanged).toEqual(['file.ts']);
      expect(result.modified).toHaveLength(0);
    });
  });

  describe('detectChanges with mtime tolerance', () => {
    it('should ignore mtime differences within tolerance', () => {
      const mtime1 = new Date('2024-01-01T00:00:00.000Z');
      const mtime2 = new Date('2024-01-01T00:00:00.500Z'); // 500ms later
      const currentFiles = [createFileInfo('file.ts', { size: 100, mtime: mtime2 })];
      const previousSnapshot = [createSnapshot('file.ts', { size: 100, mtime: mtime1 })];

      const result = detector.detectChanges(currentFiles, previousSnapshot, {
        mtimeTolerance: 1000, // 1 second tolerance
      });

      expect(result.unchanged).toEqual(['file.ts']);
      expect(result.modified).toHaveLength(0);
    });

    it('should detect changes when mtime difference exceeds tolerance', () => {
      const mtime1 = new Date('2024-01-01T00:00:00.000Z');
      const mtime2 = new Date('2024-01-01T00:00:02.000Z'); // 2 seconds later
      const currentFiles = [createFileInfo('file.ts', { size: 100, mtime: mtime2 })];
      const previousSnapshot = [createSnapshot('file.ts', { size: 100, mtime: mtime1 })];

      const result = detector.detectChanges(currentFiles, previousSnapshot, {
        mtimeTolerance: 1000, // 1 second tolerance
      });

      expect(result.modified).toEqual(['file.ts']);
      expect(result.unchanged).toHaveLength(0);
    });
  });

  describe('getDetailedChanges', () => {
    it('should return detailed change information', () => {
      const oldMtime = new Date('2024-01-01T00:00:00Z');
      const newMtime = new Date('2024-01-02T00:00:00Z');
      const currentFiles = [
        createFileInfo('unchanged.ts', { size: 100, mtime: oldMtime }),
        createFileInfo('modified.ts', { size: 200, mtime: newMtime }),
        createFileInfo('added.ts', { size: 150, mtime: newMtime }),
      ];
      const previousSnapshot = [
        createSnapshot('unchanged.ts', { size: 100, mtime: oldMtime }),
        createSnapshot('modified.ts', { size: 100, mtime: oldMtime }),
        createSnapshot('deleted.ts', { size: 300, mtime: oldMtime }),
      ];

      const changes = detector.getDetailedChanges(currentFiles, previousSnapshot);

      expect(changes).toHaveLength(4);

      const unchangedChange = changes.find((c) => c.path === 'unchanged.ts');
      expect(unchangedChange?.type).toBe('unchanged');
      expect(unchangedChange?.previousSnapshot).toBeDefined();
      expect(unchangedChange?.currentSnapshot).toBeDefined();

      const modifiedChange = changes.find((c) => c.path === 'modified.ts');
      expect(modifiedChange?.type).toBe('modified');
      expect(modifiedChange?.previousSnapshot?.size).toBe(100);
      expect(modifiedChange?.currentSnapshot?.size).toBe(200);

      const addedChange = changes.find((c) => c.path === 'added.ts');
      expect(addedChange?.type).toBe('added');
      expect(addedChange?.previousSnapshot).toBeUndefined();
      expect(addedChange?.currentSnapshot).toBeDefined();

      const deletedChange = changes.find((c) => c.path === 'deleted.ts');
      expect(deletedChange?.type).toBe('deleted');
      expect(deletedChange?.previousSnapshot).toBeDefined();
      expect(deletedChange?.currentSnapshot).toBeUndefined();
    });
  });

  describe('createSnapshot', () => {
    it('should create snapshots from FileInfo array', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const files = [
        createFileInfo('file1.ts', { size: 100, mtime, hash: 'hash1' }),
        createFileInfo('file2.ts', { size: 200, mtime, hash: 'hash2' }),
      ];

      const snapshots = detector.createSnapshot(files);

      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]).toEqual({
        path: 'file1.ts',
        size: 100,
        mtime: mtime.toISOString(),
        hash: 'hash1',
      });
      expect(snapshots[1]).toEqual({
        path: 'file2.ts',
        size: 200,
        mtime: mtime.toISOString(),
        hash: 'hash2',
      });
    });

    it('should handle files without hash', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const files = [createFileInfo('file.ts', { size: 100, mtime })];

      const snapshots = detector.createSnapshot(files);

      expect(snapshots[0].hash).toBe('');
    });
  });

  describe('saveSnapshot and loadSnapshot', () => {
    it('should save and load snapshot correctly', async () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const snapshots = [
        createSnapshot('file1.ts', { size: 100, mtime, hash: 'hash1' }),
        createSnapshot('file2.ts', { size: 200, mtime, hash: 'hash2' }),
      ];
      const snapshotPath = path.join(testDir, '.drift', 'cache', 'snapshot.json');

      await detector.saveSnapshot(snapshots, snapshotPath, testDir);
      const loaded = await detector.loadSnapshot(snapshotPath);

      expect(loaded).toEqual(snapshots);
    });

    it('should create directory structure when saving', async () => {
      const snapshotPath = path.join(testDir, 'deep', 'nested', 'snapshot.json');

      await detector.saveSnapshot([], snapshotPath, testDir);

      const exists = await fs
        .access(snapshotPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should return empty array when loading non-existent file', async () => {
      const snapshotPath = path.join(testDir, 'non-existent.json');

      const loaded = await detector.loadSnapshot(snapshotPath);

      expect(loaded).toEqual([]);
    });

    it('should save snapshot with correct format', async () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const snapshots = [createSnapshot('file.ts', { size: 100, mtime })];
      const snapshotPath = path.join(testDir, 'snapshot.json');

      await detector.saveSnapshot(snapshots, snapshotPath, testDir);

      const content = await fs.readFile(snapshotPath, 'utf-8');
      const parsed: SnapshotFile = JSON.parse(content);

      expect(parsed.version).toBe('1.0.0');
      expect(parsed.rootDir).toBe(testDir);
      expect(parsed.createdAt).toBeDefined();
      expect(parsed.files).toEqual(snapshots);
    });

    it('should throw error for invalid snapshot version', async () => {
      const snapshotPath = path.join(testDir, 'snapshot.json');
      const invalidSnapshot = {
        version: '2.0.0',
        createdAt: new Date().toISOString(),
        rootDir: testDir,
        files: [],
      };
      await fs.writeFile(snapshotPath, JSON.stringify(invalidSnapshot));

      await expect(detector.loadSnapshot(snapshotPath)).rejects.toThrow(
        'Unsupported snapshot version'
      );
    });

    it('should throw error for missing version', async () => {
      const snapshotPath = path.join(testDir, 'snapshot.json');
      const invalidSnapshot = {
        createdAt: new Date().toISOString(),
        rootDir: testDir,
        files: [],
      };
      await fs.writeFile(snapshotPath, JSON.stringify(invalidSnapshot));

      await expect(detector.loadSnapshot(snapshotPath)).rejects.toThrow(
        'Invalid snapshot file: missing version'
      );
    });
  });

  describe('computeFileHash', () => {
    it('should compute SHA-256 hash of file content', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'hello world');

      const hash = await detector.computeFileHash(filePath);

      // SHA-256 of "hello world"
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('should produce different hashes for different content', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      const file2 = path.join(testDir, 'file2.txt');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      const hash1 = await detector.computeFileHash(file1);
      const hash2 = await detector.computeFileHash(file2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash for same content', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      const file2 = path.join(testDir, 'file2.txt');
      await fs.writeFile(file1, 'same content');
      await fs.writeFile(file2, 'same content');

      const hash1 = await detector.computeFileHash(file1);
      const hash2 = await detector.computeFileHash(file2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('edge cases', () => {
    it('should handle files with special characters in path', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const currentFiles = [createFileInfo('path/with spaces/file.ts', { size: 100, mtime })];
      const previousSnapshot: FileSnapshot[] = [];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.added).toEqual(['path/with spaces/file.ts']);
    });

    it('should handle deeply nested paths', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/file.ts';
      const currentFiles = [createFileInfo(deepPath, { size: 100, mtime })];
      const previousSnapshot = [createSnapshot(deepPath, { size: 100, mtime })];

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.unchanged).toEqual([deepPath]);
    });

    it('should handle large number of files', () => {
      const mtime = new Date('2024-01-01T00:00:00Z');
      const fileCount = 1000;
      const currentFiles = Array.from({ length: fileCount }, (_, i) =>
        createFileInfo(`file${i}.ts`, { size: 100, mtime })
      );
      const previousSnapshot = Array.from({ length: fileCount }, (_, i) =>
        createSnapshot(`file${i}.ts`, { size: 100, mtime })
      );

      const result = detector.detectChanges(currentFiles, previousSnapshot);

      expect(result.unchanged).toHaveLength(fileCount);
      expect(result.totalFiles).toBe(fileCount);
    });
  });
});
