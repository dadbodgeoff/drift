/**
 * Pattern Shard Store
 *
 * @deprecated This class is part of the legacy data lake storage system.
 * Use `UnifiedFilePatternRepository` from `@drift/core/patterns` instead,
 * which provides unified storage with both category-based sharding AND status tracking.
 *
 * Migration: Run `drift migrate-storage` to convert to the new format.
 *
 * Manages sharded pattern storage - one file per category.
 * This allows loading only the patterns you need instead of all patterns.
 *
 * Storage structure:
 * .drift/lake/patterns/
 *   ├── api.json
 *   ├── auth.json
 *   ├── security.json
 *   └── ...
 *
 * Key features:
 * - Load patterns by category (not all at once)
 * - Incremental updates per category
 * - Category-level checksums for cache invalidation
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  LAKE_DIRS,
  DEFAULT_DATA_LAKE_CONFIG,
} from './types.js';

import type {
  PatternShard,
  PatternShardEntry,
  PatternLocation,
  PatternMetadata,
  DataLakeConfig,
} from './types.js';
import type { Pattern, PatternCategory } from '../store/types.js';

// ============================================================================
// Constants
// ============================================================================

const PATTERNS_SHARD_DIR = 'patterns';
const SHARD_VERSION = '1.0.0';

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

function generateChecksum(data: unknown): string {
  const content = JSON.stringify(data);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ============================================================================
// Pattern Shard Store Class
// ============================================================================

export class PatternShardStore extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly shardsDir: string;

  // In-memory cache of loaded shards
  private shardCache: Map<PatternCategory, PatternShard> = new Map();
  private shardChecksums: Map<PatternCategory, string> = new Map();

  constructor(config: Partial<DataLakeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.shardsDir = path.join(
      this.config.rootDir,
      LAKE_DIRS.root,
      LAKE_DIRS.lake,
      PATTERNS_SHARD_DIR
    );
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await ensureDir(this.shardsDir);
  }

  // ==========================================================================
  // Reading Shards
  // ==========================================================================

  /**
   * Get patterns for a specific category (loads shard if needed)
   */
  async getByCategory(category: PatternCategory): Promise<PatternShardEntry[]> {
    const shard = await this.loadShard(category);
    return shard?.patterns ?? [];
  }

  /**
   * Get patterns for multiple categories
   */
  async getByCategories(categories: PatternCategory[]): Promise<PatternShardEntry[]> {
    const results: PatternShardEntry[] = [];
    
    // Load shards in parallel
    const shards = await Promise.all(
      categories.map(cat => this.loadShard(cat))
    );
    
    for (const shard of shards) {
      if (shard) {
        results.push(...shard.patterns);
      }
    }
    
    return results;
  }

  /**
   * Get a single pattern by ID (searches all shards or specific category)
   */
  async getById(id: string, category?: PatternCategory): Promise<PatternShardEntry | null> {
    if (category) {
      const patterns = await this.getByCategory(category);
      return patterns.find(p => p.id === id) ?? null;
    }
    
    // Search all cached shards first
    for (const shard of this.shardCache.values()) {
      const pattern = shard.patterns.find(p => p.id === id);
      if (pattern) {return pattern;}
    }
    
    // Load all shards and search
    const categories = await this.listCategories();
    for (const cat of categories) {
      const patterns = await this.getByCategory(cat);
      const pattern = patterns.find(p => p.id === id);
      if (pattern) {return pattern;}
    }
    
    return null;
  }

  /**
   * Get all patterns (loads all shards)
   */
  async getAll(): Promise<PatternShardEntry[]> {
    const categories = await this.listCategories();
    return this.getByCategories(categories);
  }

  /**
   * List available categories (based on shard files)
   */
  async listCategories(): Promise<PatternCategory[]> {
    if (!(await fileExists(this.shardsDir))) {
      return [];
    }
    
    const files = await fs.readdir(this.shardsDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', '') as PatternCategory);
  }

  /**
   * Get pattern count by category (without loading full patterns)
   */
  async getCategoryCounts(): Promise<Record<PatternCategory, number>> {
    const counts: Record<string, number> = {};
    const categories = await this.listCategories();
    
    for (const category of categories) {
      const shard = await this.loadShard(category);
      counts[category] = shard?.patterns.length ?? 0;
    }
    
    return counts as Record<PatternCategory, number>;
  }

  // ==========================================================================
  // Writing Shards
  // ==========================================================================

  /**
   * Save patterns for a category (creates/updates shard)
   */
  async saveShard(category: PatternCategory, patterns: PatternShardEntry[]): Promise<void> {
    await ensureDir(this.shardsDir);
    
    const shard: PatternShard = {
      category,
      patterns,
    };
    
    const filePath = path.join(this.shardsDir, `${category}.json`);
    const checksum = generateChecksum(patterns);
    
    const shardFile = {
      version: SHARD_VERSION,
      generatedAt: new Date().toISOString(),
      checksum,
      ...shard,
    };
    
    await fs.writeFile(filePath, JSON.stringify(shardFile, null, 2));
    
    // Update cache
    this.shardCache.set(category, shard);
    this.shardChecksums.set(category, checksum);
    
    this.emit('shard:saved', category, patterns.length);
  }

  /**
   * Save all patterns (shards by category)
   */
  async saveAll(patterns: Pattern[]): Promise<void> {
    // Group patterns by category
    const byCategory = new Map<PatternCategory, PatternShardEntry[]>();
    
    for (const pattern of patterns) {
      if (!byCategory.has(pattern.category)) {
        byCategory.set(pattern.category, []);
      }
      byCategory.get(pattern.category)!.push(this.patternToShardEntry(pattern));
    }
    
    // Save each category shard
    const savePromises: Promise<void>[] = [];
    for (const [category, categoryPatterns] of byCategory) {
      savePromises.push(this.saveShard(category, categoryPatterns));
    }
    
    await Promise.all(savePromises);
    this.emit('shards:saved', byCategory.size);
  }

  /**
   * Delete a category shard
   */
  async deleteShard(category: PatternCategory): Promise<void> {
    const filePath = path.join(this.shardsDir, `${category}.json`);
    
    try {
      await fs.unlink(filePath);
      this.shardCache.delete(category);
      this.shardChecksums.delete(category);
      this.emit('shard:deleted', category);
    } catch {
      // Ignore if doesn't exist
    }
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Check if a shard has changed (by checksum)
   */
  async hasShardChanged(category: PatternCategory, newChecksum: string): Promise<boolean> {
    const currentChecksum = this.shardChecksums.get(category);
    if (!currentChecksum) {
      // Load from disk to get checksum
      await this.loadShard(category);
      return this.shardChecksums.get(category) !== newChecksum;
    }
    return currentChecksum !== newChecksum;
  }

  /**
   * Invalidate cache for a category
   */
  invalidateCache(category?: PatternCategory): void {
    if (category) {
      this.shardCache.delete(category);
      this.shardChecksums.delete(category);
    } else {
      this.shardCache.clear();
      this.shardChecksums.clear();
    }
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { cachedCategories: number; totalPatterns: number } {
    let totalPatterns = 0;
    for (const shard of this.shardCache.values()) {
      totalPatterns += shard.patterns.length;
    }
    return {
      cachedCategories: this.shardCache.size,
      totalPatterns,
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async loadShard(category: PatternCategory): Promise<PatternShard | null> {
    // Check cache first
    const cached = this.shardCache.get(category);
    if (cached) {
      return cached;
    }
    
    const filePath = path.join(this.shardsDir, `${category}.json`);
    
    if (!(await fileExists(filePath))) {
      return null;
    }
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      const shard: PatternShard = {
        category: data.category,
        patterns: data.patterns,
      };
      
      // Cache it
      this.shardCache.set(category, shard);
      if (data.checksum) {
        this.shardChecksums.set(category, data.checksum);
      }
      
      return shard;
    } catch {
      return null;
    }
  }

  /**
   * Convert a full Pattern to a PatternShardEntry
   */
  private patternToShardEntry(pattern: Pattern): PatternShardEntry {
    // Build metadata object, only including defined optional properties
    const metadata: PatternMetadata = {
      firstSeen: pattern.metadata.firstSeen,
      lastSeen: pattern.metadata.lastSeen,
    };
    if (pattern.metadata.approvedAt !== undefined) {
      metadata.approvedAt = pattern.metadata.approvedAt;
    }
    if (pattern.metadata.approvedBy !== undefined) {
      metadata.approvedBy = pattern.metadata.approvedBy;
    }
    if (pattern.metadata.tags !== undefined) {
      metadata.tags = pattern.metadata.tags;
    }

    return {
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      category: pattern.category,
      subcategory: pattern.subcategory,
      status: pattern.status,
      confidence: {
        score: pattern.confidence.score,
        level: pattern.confidence.level,
      },
      severity: pattern.severity,
      locations: pattern.locations.map(loc => {
        const result: PatternLocation = {
          file: loc.file,
          line: loc.line,
          column: loc.column,
        };
        if (loc.endLine !== undefined) {
          result.endLine = loc.endLine;
        }
        if (loc.endColumn !== undefined) {
          result.endColumn = loc.endColumn;
        }
        return result;
      }),
      outliers: pattern.outliers.map(out => {
        const result: PatternLocation = {
          file: out.file,
          line: out.line,
          column: out.column,
        };
        if (out.endLine !== undefined) {
          result.endLine = out.endLine;
        }
        if (out.endColumn !== undefined) {
          result.endColumn = out.endColumn;
        }
        return result;
      }),
      metadata,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createPatternShardStore(config: Partial<DataLakeConfig> = {}): PatternShardStore {
  return new PatternShardStore(config);
}
