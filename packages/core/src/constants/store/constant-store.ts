/**
 * Constant Store
 *
 * Persistence layer for constants and enums with sharded storage
 * and fast indexing.
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

import type {
  ConstantFileShard,
  ConstantIndex,
  ConstantStats,
  ConstantExtraction,
  EnumExtraction,
  FileConstantResult,
  ConstantCategory,
  ConstantLanguage,
  ConstantKind,
} from '../types.js';

/**
 * Store configuration
 */
export interface ConstantStoreConfig {
  /** Root directory for .drift folder */
  rootDir: string;
}

/**
 * Constant store for persistence
 */
export class ConstantStore {
  private readonly rootDir: string;
  private readonly constantsDir: string;
  private readonly filesDir: string;
  private readonly indexPath: string;

  /** In-memory index cache */
  private indexCache: ConstantIndex | null = null;

  /** In-memory shard cache */
  private shardCache: Map<string, ConstantFileShard> = new Map();

  constructor(config: ConstantStoreConfig) {
    this.rootDir = config.rootDir;
    this.constantsDir = path.join(config.rootDir, '.drift', 'lake', 'constants');
    this.filesDir = path.join(this.constantsDir, 'files');
    this.indexPath = path.join(this.constantsDir, 'index.json');
  }

  /**
   * Initialize the store (create directories)
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.filesDir, { recursive: true });
  }

  /**
   * Save extraction result for a file
   */
  async saveFileResult(result: FileConstantResult, contentHash?: string): Promise<void> {
    const shard = this.createShard(result, contentHash);
    const shardPath = this.getShardPath(result.file);

    await fs.mkdir(path.dirname(shardPath), { recursive: true });
    await fs.writeFile(shardPath, JSON.stringify(shard, null, 2));

    // Update cache
    this.shardCache.set(result.file, shard);

    // Invalidate index cache
    this.indexCache = null;
  }

  /**
   * Get extraction result for a file
   */
  async getFileResult(filePath: string): Promise<ConstantFileShard | null> {
    // Check cache first
    if (this.shardCache.has(filePath)) {
      return this.shardCache.get(filePath)!;
    }

    const shardPath = this.getShardPath(filePath);

    try {
      const content = await fs.readFile(shardPath, 'utf-8');
      const shard = JSON.parse(content) as ConstantFileShard;
      this.shardCache.set(filePath, shard);
      return shard;
    } catch {
      return null;
    }
  }

  /**
   * Check if a file needs re-extraction
   */
  async needsExtraction(filePath: string, contentHash: string): Promise<boolean> {
    const shard = await this.getFileResult(filePath);
    if (!shard) {
      return true;
    }
    return shard.contentHash !== contentHash;
  }

  /**
   * Delete extraction result for a file
   */
  async deleteFileResult(filePath: string): Promise<void> {
    const shardPath = this.getShardPath(filePath);

    try {
      await fs.unlink(shardPath);
    } catch {
      // File doesn't exist, that's fine
    }

    this.shardCache.delete(filePath);
    this.indexCache = null;
  }

  /**
   * Get all constants
   */
  async getAllConstants(): Promise<ConstantExtraction[]> {
    const shards = await this.getAllShards();
    return shards.flatMap((s) => s.constants);
  }

  /**
   * Get all enums
   */
  async getAllEnums(): Promise<EnumExtraction[]> {
    const shards = await this.getAllShards();
    return shards.flatMap((s) => s.enums);
  }

  /**
   * Get constants by category
   */
  async getConstantsByCategory(category: ConstantCategory): Promise<ConstantExtraction[]> {
    const constants = await this.getAllConstants();
    return constants.filter((c) => c.category === category);
  }

  /**
   * Get constants by file
   */
  async getConstantsByFile(filePath: string): Promise<ConstantExtraction[]> {
    const shard = await this.getFileResult(filePath);
    return shard?.constants ?? [];
  }

  /**
   * Get constant by ID
   */
  async getConstantById(id: string): Promise<ConstantExtraction | null> {
    const constants = await this.getAllConstants();
    return constants.find((c) => c.id === id) ?? null;
  }

  /**
   * Get enum by ID
   */
  async getEnumById(id: string): Promise<EnumExtraction | null> {
    const enums = await this.getAllEnums();
    return enums.find((e) => e.id === id) ?? null;
  }

  /**
   * Search constants by name
   */
  async searchByName(query: string): Promise<ConstantExtraction[]> {
    const constants = await this.getAllConstants();
    const lowerQuery = query.toLowerCase();
    return constants.filter(
      (c) =>
        c.name.toLowerCase().includes(lowerQuery) ||
        c.qualifiedName.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get or rebuild the index
   */
  async getIndex(): Promise<ConstantIndex> {
    if (this.indexCache) {
      return this.indexCache;
    }

    // Try to load from disk
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      this.indexCache = JSON.parse(content) as ConstantIndex;
      return this.indexCache;
    } catch {
      // Rebuild index
      return this.rebuildIndex();
    }
  }

  /**
   * Rebuild the index from all shards
   */
  async rebuildIndex(): Promise<ConstantIndex> {
    const shards = await this.getAllShards();

    const byCategory: Record<ConstantCategory, string[]> = {
      config: [],
      api: [],
      status: [],
      error: [],
      feature_flag: [],
      limit: [],
      regex: [],
      path: [],
      env: [],
      security: [],
      uncategorized: [],
    };

    const byFile: Record<string, string[]> = {};
    const byName: Record<string, string[]> = {};
    const enumsByFile: Record<string, string[]> = {};

    const stats: ConstantStats = {
      totalConstants: 0,
      totalEnums: 0,
      totalEnumMembers: 0,
      byLanguage: {} as Record<ConstantLanguage, number>,
      byCategory: {} as Record<ConstantCategory, number>,
      byKind: {} as Record<ConstantKind, number>,
      issues: {
        magicValues: 0,
        deadConstants: 0,
        potentialSecrets: 0,
        inconsistentValues: 0,
      },
    };

    for (const shard of shards) {
      // Index constants
      for (const constant of shard.constants) {
        stats.totalConstants++;

        // By category
        byCategory[constant.category].push(constant.id);
        stats.byCategory[constant.category] = (stats.byCategory[constant.category] ?? 0) + 1;

        // By file
        if (!byFile[constant.file]) {
          byFile[constant.file] = [];
        }
        byFile[constant.file]!.push(constant.id);

        // By name
        if (!byName[constant.name]) {
          byName[constant.name] = [];
        }
        byName[constant.name]!.push(constant.id);

        // By language
        stats.byLanguage[constant.language] = (stats.byLanguage[constant.language] ?? 0) + 1;

        // By kind
        stats.byKind[constant.kind] = (stats.byKind[constant.kind] ?? 0) + 1;

        // Count security issues
        if (constant.category === 'security') {
          stats.issues.potentialSecrets++;
        }
      }

      // Index enums
      for (const enumDef of shard.enums) {
        stats.totalEnums++;
        stats.totalEnumMembers += enumDef.members.length;

        if (!enumsByFile[enumDef.file]) {
          enumsByFile[enumDef.file] = [];
        }
        enumsByFile[enumDef.file]!.push(enumDef.id);
      }
    }

    // Check for inconsistent values (same name, different values)
    for (const [_name, ids] of Object.entries(byName)) {
      if (ids.length > 1) {
        const values = new Set<string>();
        for (const id of ids) {
          const constant = shards
            .flatMap((s) => s.constants)
            .find((c) => c.id === id);
          if (constant?.value !== undefined) {
            values.add(String(constant.value));
          }
        }
        if (values.size > 1) {
          stats.issues.inconsistentValues++;
        }
      }
    }

    const index: ConstantIndex = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      projectRoot: this.rootDir,
      byCategory,
      byFile,
      byName,
      enumsByFile,
      stats,
    };

    // Ensure directory exists before saving
    await fs.mkdir(this.constantsDir, { recursive: true });
    
    // Save index
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
    this.indexCache = index;

    return index;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<ConstantStats> {
    const index = await this.getIndex();
    return index.stats;
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    try {
      await fs.rm(this.constantsDir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist
    }
    this.indexCache = null;
    this.shardCache.clear();
    await this.initialize();
  }

  /**
   * Get all shards
   */
  private async getAllShards(): Promise<ConstantFileShard[]> {
    const shards: ConstantFileShard[] = [];

    try {
      const files = await this.walkDirectory(this.filesDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            const shard = JSON.parse(content) as ConstantFileShard;
            shards.push(shard);
          } catch {
            // Skip invalid files
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return shards;
  }

  /**
   * Walk directory recursively
   */
  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await this.walkDirectory(fullPath)));
        } else {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return files;
  }

  /**
   * Get shard path for a file
   */
  private getShardPath(filePath: string): string {
    const hash = this.hashFilePath(filePath);
    return path.join(this.filesDir, `${hash}.json`);
  }

  /**
   * Hash a file path for shard naming
   */
  private hashFilePath(filePath: string): string {
    return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
  }

  /**
   * Create a shard from extraction result
   */
  private createShard(result: FileConstantResult, contentHash?: string): ConstantFileShard {
    return {
      version: '1.0',
      file: result.file,
      contentHash: contentHash ?? this.hashContent(JSON.stringify(result)),
      extractedAt: new Date().toISOString(),
      constants: result.constants,
      enums: result.enums,
      references: result.references,
      quality: result.quality,
    };
  }

  /**
   * Hash content for change detection
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
