/**
 * Index Store
 *
 * Manages pre-built indexes for fast lookups.
 * Indexes map common query dimensions to IDs for O(1) access.
 *
 * Key indexes:
 * - by-file: file path → pattern/function/access IDs
 * - by-category: category → pattern IDs
 * - by-table: table name → access point/function IDs
 * - by-entry-point: entry point → reachable function IDs
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  LAKE_DIRS,
  INDEX_FILES,
  DEFAULT_DATA_LAKE_CONFIG,
} from './types.js';

import type {
  FileIndex,
  CategoryIndex,
  TableIndex,
  EntryPointIndex,
  DataLakeConfig,
  IndexType,
} from './types.js';
import type { Pattern, PatternCategory } from '../store/types.js';

// ============================================================================
// Helper Functions
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// ============================================================================
// Index Store Class
// ============================================================================

export class IndexStore extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly indexesDir: string;

  // In-memory cache
  private fileIndexCache: FileIndex | null = null;
  private categoryIndexCache: CategoryIndex | null = null;
  private tableIndexCache: TableIndex | null = null;
  private entryPointIndexCache: EntryPointIndex | null = null;

  constructor(config: Partial<DataLakeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.indexesDir = path.join(
      this.config.rootDir,
      LAKE_DIRS.root,
      LAKE_DIRS.indexes
    );
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await ensureDir(this.indexesDir);
  }

  // ==========================================================================
  // File Index
  // ==========================================================================

  async getFileIndex(): Promise<FileIndex | null> {
    if (this.fileIndexCache) {
      return this.fileIndexCache;
    }

    const filePath = path.join(this.indexesDir, INDEX_FILES.byFile);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.fileIndexCache = JSON.parse(content) as FileIndex;
      return this.fileIndexCache;
    } catch {
      return null;
    }
  }

  async saveFileIndex(index: FileIndex): Promise<void> {
    await ensureDir(this.indexesDir);
    const filePath = path.join(this.indexesDir, INDEX_FILES.byFile);
    await fs.writeFile(filePath, JSON.stringify(index, null, 2));
    this.fileIndexCache = index;
    this.emit('index:saved', 'byFile', index);
  }

  /**
   * Build file index from patterns
   */
  buildFileIndex(patterns: Pattern[]): FileIndex {
    const patternsByFile: Record<string, string[]> = {};

    for (const pattern of patterns) {
      for (const location of pattern.locations) {
        if (!patternsByFile[location.file]) {
          patternsByFile[location.file] = [];
        }
        const filePatterns = patternsByFile[location.file];
        if (filePatterns && !filePatterns.includes(pattern.id)) {
          filePatterns.push(pattern.id);
        }
      }
      for (const outlier of pattern.outliers) {
        if (!patternsByFile[outlier.file]) {
          patternsByFile[outlier.file] = [];
        }
        const filePatterns = patternsByFile[outlier.file];
        if (filePatterns && !filePatterns.includes(pattern.id)) {
          filePatterns.push(pattern.id);
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      patterns: patternsByFile,
      accessPoints: {}, // Populated by boundary scanner
      functions: {}, // Populated by call graph builder
    };
  }

  /**
   * Get pattern IDs for a specific file
   */
  async getPatternIdsForFile(file: string): Promise<string[]> {
    const index = await this.getFileIndex();
    return index?.patterns[file] ?? [];
  }

  /**
   * Update file index for specific files (incremental)
   */
  async updateFileIndex(
    file: string,
    patternIds: string[],
    accessPointIds?: string[],
    functionIds?: string[]
  ): Promise<void> {
    let index = await this.getFileIndex();
    if (!index) {
      index = {
        generatedAt: new Date().toISOString(),
        patterns: {},
        accessPoints: {},
        functions: {},
      };
    }

    index.patterns[file] = patternIds;
    if (accessPointIds) {
      index.accessPoints[file] = accessPointIds;
    }
    if (functionIds) {
      index.functions[file] = functionIds;
    }
    index.generatedAt = new Date().toISOString();

    await this.saveFileIndex(index);
  }

  // ==========================================================================
  // Category Index
  // ==========================================================================

  async getCategoryIndex(): Promise<CategoryIndex | null> {
    if (this.categoryIndexCache) {
      return this.categoryIndexCache;
    }

    const filePath = path.join(this.indexesDir, INDEX_FILES.byCategory);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.categoryIndexCache = JSON.parse(content) as CategoryIndex;
      return this.categoryIndexCache;
    } catch {
      return null;
    }
  }

  async saveCategoryIndex(index: CategoryIndex): Promise<void> {
    await ensureDir(this.indexesDir);
    const filePath = path.join(this.indexesDir, INDEX_FILES.byCategory);
    await fs.writeFile(filePath, JSON.stringify(index, null, 2));
    this.categoryIndexCache = index;
    this.emit('index:saved', 'byCategory', index);
  }

  /**
   * Build category index from patterns
   */
  buildCategoryIndex(patterns: Pattern[]): CategoryIndex {
    const patternsByCategory: Record<PatternCategory, string[]> = {} as Record<PatternCategory, string[]>;
    const counts: Record<PatternCategory, number> = {} as Record<PatternCategory, number>;

    for (const pattern of patterns) {
      if (!patternsByCategory[pattern.category]) {
        patternsByCategory[pattern.category] = [];
        counts[pattern.category] = 0;
      }
      patternsByCategory[pattern.category].push(pattern.id);
      counts[pattern.category]++;
    }

    return {
      generatedAt: new Date().toISOString(),
      patterns: patternsByCategory,
      counts,
    };
  }

  /**
   * Get pattern IDs for a specific category
   */
  async getPatternIdsForCategory(category: PatternCategory): Promise<string[]> {
    const index = await this.getCategoryIndex();
    return index?.patterns[category] ?? [];
  }

  // ==========================================================================
  // Table Index
  // ==========================================================================

  async getTableIndex(): Promise<TableIndex | null> {
    if (this.tableIndexCache) {
      return this.tableIndexCache;
    }

    const filePath = path.join(this.indexesDir, INDEX_FILES.byTable);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.tableIndexCache = JSON.parse(content) as TableIndex;
      return this.tableIndexCache;
    } catch {
      return null;
    }
  }

  async saveTableIndex(index: TableIndex): Promise<void> {
    await ensureDir(this.indexesDir);
    const filePath = path.join(this.indexesDir, INDEX_FILES.byTable);
    await fs.writeFile(filePath, JSON.stringify(index, null, 2));
    this.tableIndexCache = index;
    this.emit('index:saved', 'byTable', index);
  }

  /**
   * Get access point IDs for a specific table
   */
  async getAccessPointIdsForTable(table: string): Promise<string[]> {
    const index = await this.getTableIndex();
    return index?.accessPoints[table] ?? [];
  }

  /**
   * Get function IDs that access a specific table
   */
  async getAccessorIdsForTable(table: string): Promise<string[]> {
    const index = await this.getTableIndex();
    return index?.accessors[table] ?? [];
  }

  // ==========================================================================
  // Entry Point Index
  // ==========================================================================

  async getEntryPointIndex(): Promise<EntryPointIndex | null> {
    if (this.entryPointIndexCache) {
      return this.entryPointIndexCache;
    }

    const filePath = path.join(this.indexesDir, INDEX_FILES.byEntryPoint);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.entryPointIndexCache = JSON.parse(content) as EntryPointIndex;
      return this.entryPointIndexCache;
    } catch {
      return null;
    }
  }

  async saveEntryPointIndex(index: EntryPointIndex): Promise<void> {
    await ensureDir(this.indexesDir);
    const filePath = path.join(this.indexesDir, INDEX_FILES.byEntryPoint);
    await fs.writeFile(filePath, JSON.stringify(index, null, 2));
    this.entryPointIndexCache = index;
    this.emit('index:saved', 'byEntryPoint', index);
  }

  /**
   * Get reachable function IDs from an entry point
   */
  async getReachableFunctions(entryPointId: string): Promise<string[]> {
    const index = await this.getEntryPointIndex();
    return index?.reachable[entryPointId] ?? [];
  }

  /**
   * Get tables reachable from an entry point
   */
  async getReachableTables(entryPointId: string): Promise<string[]> {
    const index = await this.getEntryPointIndex();
    return index?.tables[entryPointId] ?? [];
  }

  /**
   * Get sensitive data reachable from an entry point
   */
  async getReachableSensitiveData(entryPointId: string): Promise<string[]> {
    const index = await this.getEntryPointIndex();
    return index?.sensitiveData[entryPointId] ?? [];
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  invalidateCache(index?: IndexType): void {
    if (!index) {
      this.fileIndexCache = null;
      this.categoryIndexCache = null;
      this.tableIndexCache = null;
      this.entryPointIndexCache = null;
      return;
    }

    switch (index) {
      case 'byFile':
        this.fileIndexCache = null;
        break;
      case 'byCategory':
        this.categoryIndexCache = null;
        break;
      case 'byTable':
        this.tableIndexCache = null;
        break;
      case 'byEntryPoint':
        this.entryPointIndexCache = null;
        break;
    }
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  async hasIndex(index: IndexType): Promise<boolean> {
    const files: Record<IndexType, string> = {
      byFile: INDEX_FILES.byFile,
      byCategory: INDEX_FILES.byCategory,
      byTable: INDEX_FILES.byTable,
      byEntryPoint: INDEX_FILES.byEntryPoint,
    };

    const filePath = path.join(this.indexesDir, files[index]);
    return fileExists(filePath);
  }

  async deleteIndex(index: IndexType): Promise<void> {
    const files: Record<IndexType, string> = {
      byFile: INDEX_FILES.byFile,
      byCategory: INDEX_FILES.byCategory,
      byTable: INDEX_FILES.byTable,
      byEntryPoint: INDEX_FILES.byEntryPoint,
    };

    const filePath = path.join(this.indexesDir, files[index]);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if doesn't exist
    }
    this.invalidateCache(index);
  }

  /**
   * Rebuild all indexes from patterns
   */
  async rebuildAllIndexes(patterns: Pattern[]): Promise<void> {
    const fileIndex = this.buildFileIndex(patterns);
    const categoryIndex = this.buildCategoryIndex(patterns);

    await Promise.all([
      this.saveFileIndex(fileIndex),
      this.saveCategoryIndex(categoryIndex),
    ]);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createIndexStore(config: Partial<DataLakeConfig> = {}): IndexStore {
  return new IndexStore(config);
}
