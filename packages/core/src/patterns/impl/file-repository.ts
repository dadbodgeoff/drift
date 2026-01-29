/**
 * File Pattern Repository (Legacy)
 *
 * @deprecated This repository uses the legacy status-based storage format.
 * Use `UnifiedFilePatternRepository` instead, which provides:
 * - Category-based storage (better performance for large codebases)
 * - Status tracked per-pattern (single source of truth)
 * - Auto-migration from legacy format
 *
 * Migration: Run `drift migrate-storage` to convert to the new format.
 *
 * Implementation of IPatternRepository that wraps the existing PatternStore.
 * Provides backward compatibility while exposing the new unified interface.
 *
 * Storage structure:
 * .drift/patterns/
 *   ├── discovered/
 *   │   ├── structural.json
 *   │   └── security.json
 *   ├── approved/
 *   └── ignored/
 *
 * @module patterns/impl/file-repository
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



// Re-export errors for convenience
export { PatternNotFoundError, InvalidStatusTransitionError, PatternAlreadyExistsError };

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const PATTERNS_DIR = 'patterns';
const PATTERN_FILE_VERSION = '1.0.0';

const STATUS_DIRS: Record<PatternStatus, string> = {
  discovered: 'discovered',
  approved: 'approved',
  ignored: 'ignored',
};

// ============================================================================
// File Types (for JSON serialization)
// ============================================================================

interface StoredPattern {
  id: string;
  subcategory: string;
  name: string;
  description: string;
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
  approvedAt?: string | undefined;
  approvedBy?: string | undefined;
  tags: string[];
  autoFixable: boolean;
  metadata: PatternMetadata;
}

interface PatternFile {
  version: string;
  category: PatternCategory;
  patterns: StoredPattern[];
  lastUpdated: string;
  checksum?: string;
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

function generateChecksum(patterns: StoredPattern[]): string {
  const content = JSON.stringify(patterns);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function patternToStored(pattern: Pattern): StoredPattern {
  return {
    id: pattern.id,
    subcategory: pattern.subcategory,
    name: pattern.name,
    description: pattern.description,
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
    approvedAt: pattern.approvedAt,
    approvedBy: pattern.approvedBy,
    tags: pattern.tags,
    autoFixable: pattern.autoFixable,
    metadata: pattern.metadata,
  };
}

function storedToPattern(
  stored: StoredPattern,
  category: PatternCategory,
  status: PatternStatus
): Pattern {
  return {
    ...stored,
    category,
    status,
    detectionMethod: stored.detectionMethod as Pattern['detectionMethod'],
  };
}

// ============================================================================
// File Pattern Repository
// ============================================================================

/**
 * File-based pattern repository implementation.
 *
 * Stores patterns in .drift/patterns/{status}/{category}.json files.
 * Maintains backward compatibility with the existing PatternStore format.
 */
export class FilePatternRepository extends EventEmitter implements IPatternRepository {
  private readonly config: Required<PatternRepositoryConfig>;
  private readonly patternsDir: string;
  private patterns: Map<string, Pattern> = new Map();
  private initialized: boolean = false;
  private dirty: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(config: Partial<PatternRepositoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_REPOSITORY_CONFIG, ...config };
    this.patternsDir = path.join(this.config.rootDir, DRIFT_DIR, PATTERNS_DIR);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    // Create directory structure
    for (const status of Object.values(STATUS_DIRS)) {
      await ensureDir(path.join(this.patternsDir, status));
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
  // Loading
  // ==========================================================================

  private async loadAll(): Promise<void> {
    this.patterns.clear();

    for (const status of Object.keys(STATUS_DIRS) as PatternStatus[]) {
      await this.loadByStatus(status);
    }
  }

  private async loadByStatus(status: PatternStatus): Promise<void> {
    const statusDir = path.join(this.patternsDir, STATUS_DIRS[status]);

    for (const category of PATTERN_CATEGORIES) {
      await this.loadCategoryFile(category, status, statusDir);
    }
  }

  private async loadCategoryFile(
    category: PatternCategory,
    status: PatternStatus,
    statusDir: string
  ): Promise<void> {
    const filePath = path.join(statusDir, `${category}.json`);

    if (!(await fileExists(filePath))) {
      return;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as PatternFile;

      for (const stored of data.patterns) {
        const pattern = storedToPattern(stored, category, status);
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
    const grouped = this.groupPatternsByStatusAndCategory();

    for (const [status, categories] of grouped.entries()) {
      for (const [category, patterns] of categories.entries()) {
        await this.saveCategoryFile(category, status, patterns);
      }
    }

    this.dirty = false;
    this.emit('patterns:saved', undefined, { count: this.patterns.size });
  }

  private groupPatternsByStatusAndCategory(): Map<PatternStatus, Map<PatternCategory, Pattern[]>> {
    const grouped = new Map<PatternStatus, Map<PatternCategory, Pattern[]>>();

    for (const status of Object.keys(STATUS_DIRS) as PatternStatus[]) {
      grouped.set(status, new Map());
      for (const category of PATTERN_CATEGORIES) {
        grouped.get(status)!.set(category, []);
      }
    }

    for (const pattern of this.patterns.values()) {
      grouped.get(pattern.status)!.get(pattern.category)!.push(pattern);
    }

    return grouped;
  }

  private async saveCategoryFile(
    category: PatternCategory,
    status: PatternStatus,
    patterns: Pattern[]
  ): Promise<void> {
    const filePath = path.join(this.patternsDir, STATUS_DIRS[status], `${category}.json`);

    if (patterns.length === 0) {
      // Remove empty files
      if (await fileExists(filePath)) {
        await fs.unlink(filePath);
      }
      return;
    }

    const storedPatterns = patterns.map(patternToStored);
    const patternFile: PatternFile = {
      version: PATTERN_FILE_VERSION,
      category,
      patterns: storedPatterns,
      lastUpdated: new Date().toISOString(),
      checksum: generateChecksum(storedPatterns),
    };

    await fs.writeFile(filePath, JSON.stringify(patternFile, null, 2), 'utf-8');
  }

  private scheduleSave(): void {
    if (!this.config.autoSave) {return;}

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveAll().catch(console.error);
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

    // Ensure confidence level is computed
    const patternWithLevel: Pattern = {
      ...pattern,
      confidenceLevel: computeConfidenceLevel(pattern.confidence),
    };

    this.patterns.set(pattern.id, patternWithLevel);
    this.dirty = true;
    this.scheduleSave();
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
      id: existing.id, // Prevent ID change
      lastSeen: new Date().toISOString(),
    };

    // Recompute confidence level if confidence changed
    if (updates.confidence !== undefined) {
      updated.confidenceLevel = computeConfidenceLevel(updates.confidence);
    }

    this.patterns.set(id, updated);
    this.dirty = true;
    this.scheduleSave();
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
    this.dirty = true;
    this.scheduleSave();
    this.emit('pattern:deleted', pattern);

    return true;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  async query(options: PatternQueryOptions): Promise<PatternQueryResult> {
    this.ensureInitialized();

    let patterns = Array.from(this.patterns.values());

    // Apply filters
    if (options.filter) {
      patterns = this.applyFilter(patterns, options.filter);
    }

    const total = patterns.length;

    // Apply sorting
    if (options.sort) {
      patterns = this.applySort(patterns, options.sort);
    }

    // Apply pagination
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
    const result = await this.query({
      filter: { categories: [category] },
    });
    return result.patterns;
  }

  async getByStatus(status: PatternStatus): Promise<Pattern[]> {
    const result = await this.query({
      filter: { statuses: [status] },
    });
    return result.patterns;
  }

  async getByFile(file: string): Promise<Pattern[]> {
    const result = await this.query({
      filter: { files: [file] },
    });
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

    const updated = await this.update(id, {
      status: 'ignored',
    });

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

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Repository not initialized. Call initialize() first.');
    }
  }
}
