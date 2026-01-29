/**
 * Unified File Pattern Repository
 *
 * Phase 3 implementation that consolidates the two storage systems:
 * - PatternStore (status-based directories)
 * - PatternShardStore (category-based shards)
 *
 * New unified storage structure:
 * .drift/patterns/
 *   ├── api.json           # All API patterns (with status field)
 *   ├── auth.json          # All auth patterns
 *   ├── security.json      # All security patterns
 *   └── ...
 *
 * Benefits:
 * - Single source of truth (no sync issues)
 * - Category-based sharding (load only what you need)
 * - Status tracked per-pattern (not per-directory)
 * - Backward compatible migration from old format
 *
 * @module patterns/impl/unified-file-repository
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  PatternNotFoundError,
  InvalidStatusTransitionError,
  PatternAlreadyExistsError,
} from '../errors.js';
import { DEFAULT_REPOSITORY_CONFIG } from '../repository.js';
import {
  PATTERN_CATEGORIES,
  VALID_STATUS_TRANSITIONS,
  computeConfidenceLevel,
  toPatternSummary,
} from '../types.js';

import type {
  IPatternRepository,
  PatternRepositoryConfig,
  PatternRepositoryEventType,
  PatternRepositoryEventHandler,
  PatternQueryOptions,
  PatternQueryResult,
  PatternFilter,
  PatternSort,
} from '../repository.js';
import type {
  Pattern,
  PatternCategory,
  PatternStatus,
  PatternSummary,
  PatternLocation,
  OutlierLocation,
  PatternMetadata,
  DetectorConfig,
  Severity,
  ConfidenceLevel,
} from '../types.js';



// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const PATTERNS_DIR = 'patterns';
const UNIFIED_FILE_VERSION = '2.0.0';

// Legacy directories for migration
const LEGACY_STATUS_DIRS: Record<PatternStatus, string> = {
  discovered: 'discovered',
  approved: 'approved',
  ignored: 'ignored',
};

// ============================================================================
// File Types (for JSON serialization)
// ============================================================================

interface UnifiedPatternEntry {
  id: string;
  subcategory: string;
  name: string;
  description: string;
  status: PatternStatus;
  detectorId: string;
  detectorName: string;
  detectionMethod: string;
  detector: DetectorConfig;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  locations: PatternLocation[];
  outliers: OutlierLocation[];
  severity: Severity;
  firstSeen: string;
  lastSeen: string;
  approvedAt?: string;
  approvedBy?: string;
  tags: string[];
  autoFixable: boolean;
  metadata: PatternMetadata;
}

interface UnifiedPatternFile {
  version: string;
  category: PatternCategory;
  patterns: UnifiedPatternEntry[];
  lastUpdated: string;
  checksum: string;
  patternCount: number;
  statusCounts: Record<PatternStatus, number>;
}

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

function generateChecksum(patterns: UnifiedPatternEntry[]): string {
  const content = JSON.stringify(patterns.map(p => p.id).sort());
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function patternToEntry(pattern: Pattern): UnifiedPatternEntry {
  const entry: UnifiedPatternEntry = {
    id: pattern.id,
    subcategory: pattern.subcategory,
    name: pattern.name,
    description: pattern.description,
    status: pattern.status,
    detectorId: pattern.detectorId,
    detectorName: pattern.detectorName,
    detectionMethod: pattern.detectionMethod,
    detector: pattern.detector,
    confidence: pattern.confidence,
    confidenceLevel: pattern.confidenceLevel,
    locations: pattern.locations,
    outliers: pattern.outliers,
    severity: pattern.severity,
    firstSeen: pattern.firstSeen,
    lastSeen: pattern.lastSeen,
    tags: pattern.tags,
    autoFixable: pattern.autoFixable,
    metadata: pattern.metadata,
  };
  
  // Only include optional fields if they have values
  if (pattern.approvedAt !== undefined) {
    entry.approvedAt = pattern.approvedAt;
  }
  if (pattern.approvedBy !== undefined) {
    entry.approvedBy = pattern.approvedBy;
  }
  
  return entry;
}

function entryToPattern(entry: UnifiedPatternEntry, category: PatternCategory): Pattern {
  return {
    ...entry,
    category,
    detectionMethod: entry.detectionMethod as Pattern['detectionMethod'],
  };
}

function computeStatusCounts(patterns: UnifiedPatternEntry[]): Record<PatternStatus, number> {
  const counts: Record<PatternStatus, number> = {
    discovered: 0,
    approved: 0,
    ignored: 0,
  };
  for (const p of patterns) {
    counts[p.status]++;
  }
  return counts;
}

// ============================================================================
// Unified File Pattern Repository
// ============================================================================

export interface UnifiedRepositoryConfig extends PatternRepositoryConfig {
  /** Auto-migrate from legacy format on initialize */
  autoMigrate?: boolean;
  /** Keep legacy files after migration (for rollback) */
  keepLegacyFiles?: boolean;
}

const DEFAULT_UNIFIED_CONFIG: Required<UnifiedRepositoryConfig> = {
  ...DEFAULT_REPOSITORY_CONFIG,
  autoMigrate: true,
  keepLegacyFiles: true,
};

/**
 * Unified file-based pattern repository.
 *
 * Stores patterns in .drift/patterns/{category}.json files.
 * Each file contains all patterns for that category with their status.
 */
export class UnifiedFilePatternRepository extends EventEmitter implements IPatternRepository {
  private readonly config: Required<UnifiedRepositoryConfig>;
  private readonly patternsDir: string;
  private patterns: Map<string, Pattern> = new Map();
  private initialized: boolean = false;
  private dirty: boolean = false;
  private dirtyCategories: Set<PatternCategory> = new Set();
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(config: Partial<UnifiedRepositoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_UNIFIED_CONFIG, ...config };
    this.patternsDir = path.join(this.config.rootDir, DRIFT_DIR, PATTERNS_DIR);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    await ensureDir(this.patternsDir);

    // Check if we need to migrate from legacy format
    if (this.config.autoMigrate && (await this.hasLegacyFormat())) {
      await this.migrateFromLegacy();
    }

    // Load all patterns
    await this.loadAll();
    this.initialized = true;
    this.emit('patterns:loaded', undefined, { count: this.patterns.size });
  }

  async close(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    if (this.dirty) {
      await this.saveAll();
    }

    this.patterns.clear();
    this.initialized = false;
  }

  // ==========================================================================
  // Migration from Legacy Format
  // ==========================================================================

  /**
   * Check if legacy format exists (status-based directories)
   */
  private async hasLegacyFormat(): Promise<boolean> {
    for (const status of Object.values(LEGACY_STATUS_DIRS)) {
      const statusDir = path.join(this.patternsDir, status);
      if (await fileExists(statusDir)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if unified format exists (public for migration tools)
   */
  async hasUnifiedFormat(): Promise<boolean> {
    for (const category of PATTERN_CATEGORIES) {
      const filePath = path.join(this.patternsDir, `${category}.json`);
      if (await fileExists(filePath)) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          if (data.version?.startsWith('2.')) {
            return true;
          }
        } catch {
          // Not valid unified format
        }
      }
    }
    return false;
  }

  /**
   * Migrate from legacy status-based format to unified category-based format
   */
  async migrateFromLegacy(): Promise<{ migrated: number; categories: PatternCategory[] }> {
    console.log('[UnifiedFilePatternRepository] Migrating from legacy format...');

    const migratedPatterns: Pattern[] = [];
    const migratedCategories = new Set<PatternCategory>();

    // Load patterns from all legacy status directories
    for (const status of Object.keys(LEGACY_STATUS_DIRS) as PatternStatus[]) {
      const statusDir = path.join(this.patternsDir, LEGACY_STATUS_DIRS[status]);

      if (!(await fileExists(statusDir))) {continue;}

      for (const category of PATTERN_CATEGORIES) {
        const filePath = path.join(statusDir, `${category}.json`);

        if (!(await fileExists(filePath))) {continue;}

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);

          // Handle legacy format (patterns without status field)
          for (const stored of data.patterns || []) {
            const pattern: Pattern = {
              ...stored,
              category,
              status,
              detectionMethod: stored.detectionMethod || 'ast',
              confidenceLevel: stored.confidenceLevel || computeConfidenceLevel(stored.confidence || 0.5),
            };
            migratedPatterns.push(pattern);
            migratedCategories.add(category);
          }
        } catch (error) {
          console.warn(`[UnifiedFilePatternRepository] Failed to read legacy file ${filePath}:`, error);
        }
      }
    }

    // Store migrated patterns in memory
    for (const pattern of migratedPatterns) {
      this.patterns.set(pattern.id, pattern);
    }

    // Save in new unified format
    if (migratedPatterns.length > 0) {
      this.dirty = true;
      for (const category of migratedCategories) {
        this.dirtyCategories.add(category);
      }
      await this.saveAll();
    }

    // Optionally remove legacy directories
    if (!this.config.keepLegacyFiles) {
      await this.removeLegacyFiles();
    }

    console.log(`[UnifiedFilePatternRepository] Migrated ${migratedPatterns.length} patterns from ${migratedCategories.size} categories`);

    return {
      migrated: migratedPatterns.length,
      categories: Array.from(migratedCategories),
    };
  }

  /**
   * Remove legacy status-based directories
   */
  private async removeLegacyFiles(): Promise<void> {
    for (const status of Object.values(LEGACY_STATUS_DIRS)) {
      const statusDir = path.join(this.patternsDir, status);
      if (await fileExists(statusDir)) {
        await fs.rm(statusDir, { recursive: true, force: true });
      }
    }
  }

  // ==========================================================================
  // Loading
  // ==========================================================================

  private async loadAll(): Promise<void> {
    this.patterns.clear();

    for (const category of PATTERN_CATEGORIES) {
      await this.loadCategory(category);
    }
  }

  private async loadCategory(category: PatternCategory): Promise<void> {
    const filePath = path.join(this.patternsDir, `${category}.json`);

    if (!(await fileExists(filePath))) {
      return;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as UnifiedPatternFile;

      for (const entry of data.patterns) {
        const pattern = entryToPattern(entry, category);
        this.patterns.set(pattern.id, pattern);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  // ==========================================================================
  // Saving
  // ==========================================================================

  async saveAll(): Promise<void> {
    const grouped = this.groupPatternsByCategory();

    for (const [category, patterns] of grouped.entries()) {
      await this.saveCategoryFile(category, patterns);
    }

    this.dirty = false;
    this.dirtyCategories.clear();
    this.emit('patterns:saved', undefined, { count: this.patterns.size });
  }

  /**
   * Save only dirty categories (incremental save)
   */
  async saveIncremental(): Promise<void> {
    if (this.dirtyCategories.size === 0) {return;}

    const grouped = this.groupPatternsByCategory();

    for (const category of this.dirtyCategories) {
      const patterns = grouped.get(category) || [];
      await this.saveCategoryFile(category, patterns);
    }

    this.dirty = false;
    this.dirtyCategories.clear();
  }

  private groupPatternsByCategory(): Map<PatternCategory, Pattern[]> {
    const grouped = new Map<PatternCategory, Pattern[]>();

    for (const category of PATTERN_CATEGORIES) {
      grouped.set(category, []);
    }

    for (const pattern of this.patterns.values()) {
      grouped.get(pattern.category)!.push(pattern);
    }

    return grouped;
  }

  private async saveCategoryFile(category: PatternCategory, patterns: Pattern[]): Promise<void> {
    const filePath = path.join(this.patternsDir, `${category}.json`);

    if (patterns.length === 0) {
      // Remove empty files
      if (await fileExists(filePath)) {
        await fs.unlink(filePath);
      }
      return;
    }

    const entries = patterns.map(patternToEntry);
    const patternFile: UnifiedPatternFile = {
      version: UNIFIED_FILE_VERSION,
      category,
      patterns: entries,
      lastUpdated: new Date().toISOString(),
      checksum: generateChecksum(entries),
      patternCount: entries.length,
      statusCounts: computeStatusCounts(entries),
    };

    await fs.writeFile(filePath, JSON.stringify(patternFile, null, 2), 'utf-8');
  }

  private scheduleSave(): void {
    if (!this.config.autoSave) {return;}

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveIncremental().catch(console.error);
    }, this.config.autoSaveDelayMs);
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  async add(pattern: Pattern): Promise<void> {
    this.ensureInitialized();

    if (this.patterns.has(pattern.id)) {
      throw new PatternAlreadyExistsError(pattern.id);
    }

    const patternWithLevel: Pattern = {
      ...pattern,
      confidenceLevel: computeConfidenceLevel(pattern.confidence),
    };

    this.patterns.set(pattern.id, patternWithLevel);
    this.markDirty(pattern.category);
    this.emit('pattern:added', patternWithLevel);
  }

  async addMany(patterns: Pattern[]): Promise<void> {
    for (const pattern of patterns) {
      await this.add(pattern);
    }
  }

  async get(id: string): Promise<Pattern | null> {
    this.ensureInitialized();
    return this.patterns.get(id) ?? null;
  }

  async update(id: string, updates: Partial<Pattern>): Promise<Pattern> {
    this.ensureInitialized();

    const existing = this.patterns.get(id);
    if (!existing) {
      throw new PatternNotFoundError(id);
    }

    const updated: Pattern = {
      ...existing,
      ...updates,
      id: existing.id,
      lastSeen: new Date().toISOString(),
    };

    if (updates.confidence !== undefined) {
      updated.confidenceLevel = computeConfidenceLevel(updates.confidence);
    }

    this.patterns.set(id, updated);
    this.markDirty(updated.category);

    // If category changed, mark old category dirty too
    if (updates.category && updates.category !== existing.category) {
      this.markDirty(existing.category);
    }

    this.emit('pattern:updated', updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const pattern = this.patterns.get(id);
    if (!pattern) {
      return false;
    }

    this.patterns.delete(id);
    this.markDirty(pattern.category);
    this.emit('pattern:deleted', pattern);

    return true;
  }

  private markDirty(category: PatternCategory): void {
    this.dirty = true;
    this.dirtyCategories.add(category);
    this.scheduleSave();
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  async query(options: PatternQueryOptions): Promise<PatternQueryResult> {
    this.ensureInitialized();

    let patterns = Array.from(this.patterns.values());

    if (options.filter) {
      patterns = this.applyFilter(patterns, options.filter);
    }

    const total = patterns.length;

    if (options.sort) {
      patterns = this.applySort(patterns, options.sort);
    }

    if (options.pagination) {
      const { offset, limit } = options.pagination;
      patterns = patterns.slice(offset, offset + limit);
    }

    return {
      patterns,
      total,
      hasMore: options.pagination
        ? options.pagination.offset + patterns.length < total
        : false,
    };
  }

  private applyFilter(patterns: Pattern[], filter: PatternFilter): Pattern[] {
    return patterns.filter((p) => {
      if (filter.ids && !filter.ids.includes(p.id)) {return false;}
      if (filter.categories && !filter.categories.includes(p.category)) {return false;}
      if (filter.statuses && !filter.statuses.includes(p.status)) {return false;}
      if (filter.minConfidence !== undefined && p.confidence < filter.minConfidence) {return false;}
      if (filter.maxConfidence !== undefined && p.confidence > filter.maxConfidence) {return false;}
      if (filter.confidenceLevels && !filter.confidenceLevels.includes(p.confidenceLevel)) {return false;}
      if (filter.severities && !filter.severities.includes(p.severity)) {return false;}
      if (filter.files) {
        const hasFile = p.locations.some((loc) => filter.files!.includes(loc.file));
        if (!hasFile) {return false;}
      }
      if (filter.hasOutliers !== undefined) {
        const hasOutliers = p.outliers.length > 0;
        if (filter.hasOutliers !== hasOutliers) {return false;}
      }
      if (filter.tags) {
        const hasTags = filter.tags.some((tag) => p.tags.includes(tag));
        if (!hasTags) {return false;}
      }
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const matches =
          p.name.toLowerCase().includes(searchLower) ||
          p.description.toLowerCase().includes(searchLower);
        if (!matches) {return false;}
      }
      if (filter.createdAfter) {
        const firstSeen = new Date(p.firstSeen);
        if (firstSeen < filter.createdAfter) {return false;}
      }
      if (filter.createdBefore) {
        const firstSeen = new Date(p.firstSeen);
        if (firstSeen > filter.createdBefore) {return false;}
      }

      return true;
    });
  }

  private applySort(patterns: Pattern[], sort: PatternSort): Pattern[] {
    const sorted = [...patterns];
    const direction = sort.direction === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sort.field) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'confidence':
          comparison = a.confidence - b.confidence;
          break;
        case 'severity':
          const severityOrder = { error: 4, warning: 3, info: 2, hint: 1 };
          comparison = severityOrder[a.severity] - severityOrder[b.severity];
          break;
        case 'firstSeen':
          comparison = new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime();
          break;
        case 'lastSeen':
          comparison = new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
          break;
        case 'locationCount':
          comparison = a.locations.length - b.locations.length;
          break;
      }

      return comparison * direction;
    });

    return sorted;
  }

  async getByCategory(category: PatternCategory): Promise<Pattern[]> {
    const result = await this.query({ filter: { categories: [category] } });
    return result.patterns;
  }

  async getByStatus(status: PatternStatus): Promise<Pattern[]> {
    const result = await this.query({ filter: { statuses: [status] } });
    return result.patterns;
  }

  async getByFile(file: string): Promise<Pattern[]> {
    const result = await this.query({ filter: { files: [file] } });
    return result.patterns;
  }

  async getAll(): Promise<Pattern[]> {
    this.ensureInitialized();
    return Array.from(this.patterns.values());
  }

  async count(filter?: PatternFilter): Promise<number> {
    if (!filter) {
      return this.patterns.size;
    }
    const result = await this.query({ filter });
    return result.total;
  }

  // ==========================================================================
  // Status Transitions
  // ==========================================================================

  async approve(id: string, approvedBy?: string): Promise<Pattern> {
    this.ensureInitialized();

    const pattern = this.patterns.get(id);
    if (!pattern) {
      throw new PatternNotFoundError(id);
    }

    if (!VALID_STATUS_TRANSITIONS[pattern.status].includes('approved')) {
      throw new InvalidStatusTransitionError(id, pattern.status, 'approved');
    }

    const now = new Date().toISOString();
    const updated = await this.update(id, {
      status: 'approved',
      approvedAt: now,
      approvedBy,
      metadata: {
        ...pattern.metadata,
        approvedAt: now,
        approvedBy,
      },
    });

    this.emit('pattern:approved', updated);
    return updated;
  }

  async ignore(id: string): Promise<Pattern> {
    this.ensureInitialized();

    const pattern = this.patterns.get(id);
    if (!pattern) {
      throw new PatternNotFoundError(id);
    }

    if (!VALID_STATUS_TRANSITIONS[pattern.status].includes('ignored')) {
      throw new InvalidStatusTransitionError(id, pattern.status, 'ignored');
    }

    const updated = await this.update(id, { status: 'ignored' });
    this.emit('pattern:ignored', updated);
    return updated;
  }

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  async clear(): Promise<void> {
    this.ensureInitialized();
    this.patterns.clear();
    this.dirty = true;
    for (const category of PATTERN_CATEGORIES) {
      this.dirtyCategories.add(category);
    }
    await this.saveAll();
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  override on(event: PatternRepositoryEventType, handler: PatternRepositoryEventHandler): this {
    return super.on(event, handler);
  }

  override off(event: PatternRepositoryEventType, handler: PatternRepositoryEventHandler): this {
    return super.off(event, handler);
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  async exists(id: string): Promise<boolean> {
    this.ensureInitialized();
    return this.patterns.has(id);
  }

  async getSummaries(options?: PatternQueryOptions): Promise<PatternSummary[]> {
    const result = await this.query(options ?? {});
    return result.patterns.map(toPatternSummary);
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalPatterns: number;
    byCategory: Record<PatternCategory, number>;
    byStatus: Record<PatternStatus, number>;
    fileCount: number;
  }> {
    this.ensureInitialized();

    const byCategory: Record<string, number> = {};
    const byStatus: Record<PatternStatus, number> = {
      discovered: 0,
      approved: 0,
      ignored: 0,
    };

    for (const category of PATTERN_CATEGORIES) {
      byCategory[category] = 0;
    }

    for (const pattern of this.patterns.values()) {
      const catCount = byCategory[pattern.category];
      if (catCount !== undefined) {
        byCategory[pattern.category] = catCount + 1;
      }
      const statusCount = byStatus[pattern.status];
      if (statusCount !== undefined) {
        byStatus[pattern.status] = statusCount + 1;
      }
    }

    // Count non-empty category files
    let fileCount = 0;
    for (const category of PATTERN_CATEGORIES) {
      const count = byCategory[category];
      if (count !== undefined && count > 0) {fileCount++;}
    }

    return {
      totalPatterns: this.patterns.size,
      byCategory: byCategory as Record<PatternCategory, number>,
      byStatus,
      fileCount,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Repository not initialized. Call initialize() first.');
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createUnifiedFilePatternRepository(
  config: Partial<UnifiedRepositoryConfig> = {}
): UnifiedFilePatternRepository {
  return new UnifiedFilePatternRepository(config);
}
