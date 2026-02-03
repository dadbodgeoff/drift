/**
 * Hybrid Pattern Store
 *
 * A pattern store that bridges the legacy JSON storage with the new SQLite storage.
 * During the transition period, this store:
 * - Reads from SQLite (fast, indexed)
 * - Writes to both SQLite and JSON (backward compatibility)
 *
 * Once migration is complete, set `sqliteOnly: true` to disable JSON writes.
 *
 * @module storage/hybrid-pattern-store
 */

import { EventEmitter } from 'node:events';

import { UnifiedStore } from './unified-store.js';
import type {
  DbPattern,
  DbPatternLocation,
} from './types.js';
import type {
  Pattern,
  PatternCategory,
  PatternStatus,
  PatternQuery,
  PatternQueryOptions,
  PatternQueryResult,
  PatternStoreStats,
  ConfidenceLevel,
} from '../store/types.js';
import { PATTERN_CATEGORIES } from '../store/types.js';

// ============================================================================
// Configuration
// ============================================================================

export interface HybridPatternStoreConfig {
  /** Root directory of the project */
  rootDir: string;
  /** Use SQLite only (no JSON writes) - set true after migration complete */
  sqliteOnly?: boolean;
  /** Fall back to JSON if SQLite fails */
  fallbackToJson?: boolean;
}

const DEFAULT_HYBRID_CONFIG: Required<HybridPatternStoreConfig> = {
  rootDir: '.',
  sqliteOnly: false,
  fallbackToJson: true,
};

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Convert a DbPattern to the legacy Pattern format
 */
function dbPatternToPattern(db: DbPattern, locations: DbPatternLocation[]): Pattern {
  const regularLocations = locations.filter(l => !l.is_outlier);
  const outliers = locations.filter(l => l.is_outlier);

  const patternLocations: import('../store/types.js').PatternLocation[] = regularLocations.map(l => {
    const loc: import('../store/types.js').PatternLocation = {
      file: l.file,
      line: l.line,
      column: l.column_num,
    };
    if (l.end_line !== null) loc.endLine = l.end_line;
    if (l.end_column !== null) loc.endColumn = l.end_column;
    return loc;
  });

  const outlierLocations: import('../store/types.js').OutlierLocation[] = outliers.map(l => {
    const loc: import('../store/types.js').OutlierLocation = {
      file: l.file,
      line: l.line,
      column: l.column_num,
      reason: l.outlier_reason ?? 'Unknown',
    };
    if (l.end_line !== null) loc.endLine = l.end_line;
    if (l.end_column !== null) loc.endColumn = l.end_column;
    if (l.deviation_score !== null) loc.deviationScore = l.deviation_score;
    return loc;
  });

  const metadata: import('../store/types.js').PatternMetadata = {
    firstSeen: db.first_seen,
    lastSeen: db.last_seen,
  };
  if (db.approved_at !== null) metadata.approvedAt = db.approved_at;
  if (db.approved_by !== null) metadata.approvedBy = db.approved_by;
  if (db.tags !== null) metadata.tags = JSON.parse(db.tags);
  if (db.source !== null) metadata.source = db.source;

  const confidence: import('../store/types.js').ConfidenceInfo = {
    score: db.confidence_score,
    level: db.confidence_level,
    frequency: db.confidence_frequency ?? 0,
    consistency: db.confidence_consistency ?? 0,
    age: db.confidence_age ?? 0,
    spread: db.confidence_spread ?? 0,
  };

  const detector: import('../store/types.js').DetectorConfig = {
    type: (db.detector_type as import('../store/types.js').DetectorType) ?? 'ast',
    config: db.detector_config ? JSON.parse(db.detector_config) : {},
  };

  return {
    id: db.id,
    name: db.name,
    description: db.description ?? '',
    category: db.category,
    subcategory: db.subcategory ?? '',
    status: db.status,
    confidence,
    detector,
    severity: db.severity,
    autoFixable: db.auto_fixable === 1,
    locations: patternLocations,
    outliers: outlierLocations,
    metadata,
  };
}

/**
 * Convert a Pattern to DbPattern format
 */
function patternToDbPattern(pattern: Pattern): DbPattern {
  return {
    id: pattern.id,
    name: pattern.name,
    description: pattern.description || null,
    category: pattern.category,
    subcategory: pattern.subcategory ?? null,
    status: pattern.status,
    confidence_score: pattern.confidence.score,
    confidence_level: pattern.confidence.level,
    confidence_frequency: pattern.confidence.frequency ?? null,
    confidence_consistency: pattern.confidence.consistency ?? null,
    confidence_age: pattern.confidence.age ?? null,
    confidence_spread: pattern.confidence.spread ?? null,
    detector_type: pattern.detector?.type ?? null,
    detector_config: pattern.detector?.config ? JSON.stringify(pattern.detector.config) : null,
    severity: pattern.severity,
    auto_fixable: pattern.autoFixable ? 1 : 0,
    first_seen: pattern.metadata.firstSeen,
    last_seen: pattern.metadata.lastSeen,
    approved_at: pattern.metadata.approvedAt ?? null,
    approved_by: pattern.metadata.approvedBy ?? null,
    tags: pattern.metadata.tags ? JSON.stringify(pattern.metadata.tags) : null,
    source: pattern.metadata.source ?? null,
    location_count: pattern.locations.length,
    outlier_count: pattern.outliers.length,
  };
}

/**
 * Convert Pattern locations to DbPatternLocation format
 */
function patternLocationsToDb(patternId: string, pattern: Pattern): DbPatternLocation[] {
  const locations: DbPatternLocation[] = [];

  for (const loc of pattern.locations) {
    locations.push({
      pattern_id: patternId,
      file: loc.file,
      line: loc.line,
      column_num: loc.column ?? 0,
      end_line: loc.endLine ?? null,
      end_column: loc.endColumn ?? null,
      is_outlier: 0,
      outlier_reason: null,
      deviation_score: null,
      confidence: 1.0,
      snippet: null,
    });
  }

  for (const outlier of pattern.outliers) {
    locations.push({
      pattern_id: patternId,
      file: outlier.file,
      line: outlier.line,
      column_num: outlier.column ?? 0,
      end_line: outlier.endLine ?? null,
      end_column: outlier.endColumn ?? null,
      is_outlier: 1,
      outlier_reason: outlier.reason,
      deviation_score: outlier.deviationScore ?? null,
      confidence: 1.0,
      snippet: null,
    });
  }

  return locations;
}

// ============================================================================
// Hybrid Pattern Store
// ============================================================================

/**
 * HybridPatternStore - Bridges legacy JSON and new SQLite storage
 *
 * This class provides the same interface as PatternStore but uses SQLite
 * for reads and optionally writes to both SQLite and JSON for compatibility.
 */
export class HybridPatternStore extends EventEmitter {
  private readonly config: HybridPatternStoreConfig;
  private store: UnifiedStore | null = null;
  private initialized = false;
  private patternCache: Map<string, Pattern> = new Map();

  constructor(config: Partial<HybridPatternStoreConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the hybrid store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize SQLite store
    this.store = new UnifiedStore({ rootDir: this.config.rootDir });
    await this.store.initialize();

    // Load all patterns into cache for fast access
    await this.loadAllToCache();

    this.initialized = true;
  }

  /**
   * Load all patterns from SQLite into memory cache
   */
  private async loadAllToCache(): Promise<void> {
    if (!this.store) return;

    this.patternCache.clear();
    const dbPatterns = await this.store.patterns.search({});

    for (const dbPattern of dbPatterns) {
      const locations = await this.store.patterns.getLocations(dbPattern.id);
      const outliers = await this.store.patterns.getOutliers(dbPattern.id);
      const allLocations = [...locations, ...outliers];
      const pattern = dbPatternToPattern(dbPattern, allLocations);
      this.patternCache.set(pattern.id, pattern);
    }
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (this.store) {
      await this.store.close();
      this.store = null;
    }
    this.patternCache.clear();
    this.initialized = false;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Get a pattern by ID
   */
  get(id: string): Pattern | undefined {
    return this.patternCache.get(id);
  }

  /**
   * Get a pattern by ID, throwing if not found
   */
  getOrThrow(id: string): Pattern {
    const pattern = this.patternCache.get(id);
    if (!pattern) {
      throw new Error(`Pattern not found: ${id}`);
    }
    return pattern;
  }

  /**
   * Check if a pattern exists
   */
  has(id: string): boolean {
    return this.patternCache.has(id);
  }

  /**
   * Add a new pattern
   */
  async add(pattern: Pattern): Promise<void> {
    if (!this.store) throw new Error('Store not initialized');
    if (this.patternCache.has(pattern.id)) {
      throw new Error(`Pattern already exists: ${pattern.id}`);
    }

    // Write to SQLite
    const dbPattern = patternToDbPattern(pattern);
    await this.store.patterns.create(dbPattern);

    // Add locations
    const locations = patternLocationsToDb(pattern.id, pattern);
    for (const loc of locations) {
      await this.store.patterns.addLocation(pattern.id, loc);
    }

    // Update cache
    this.patternCache.set(pattern.id, pattern);

    this.emit('pattern:created', pattern.id, pattern.category);
  }

  /**
   * Update an existing pattern
   */
  async update(id: string, updates: Partial<Omit<Pattern, 'id'>>): Promise<Pattern> {
    if (!this.store) throw new Error('Store not initialized');

    const existing = this.getOrThrow(id);
    const updated: Pattern = { ...existing, ...updates, id };

    // Update in SQLite
    const dbUpdates = patternToDbPattern(updated);
    await this.store.patterns.update(id, dbUpdates);

    // Update cache
    this.patternCache.set(id, updated);

    this.emit('pattern:updated', id, updated.category);
    return updated;
  }

  /**
   * Delete a pattern
   */
  async delete(id: string): Promise<boolean> {
    if (!this.store) throw new Error('Store not initialized');

    const pattern = this.patternCache.get(id);
    if (!pattern) return false;

    // Delete from SQLite
    await this.store.patterns.delete(id);

    // Update cache
    this.patternCache.delete(id);

    this.emit('pattern:deleted', id, pattern.category);
    return true;
  }

  // ==========================================================================
  // Status Transitions
  // ==========================================================================

  /**
   * Approve a pattern
   */
  async approve(id: string, approvedBy?: string): Promise<Pattern> {
    if (!this.store) throw new Error('Store not initialized');

    const pattern = this.getOrThrow(id);
    
    // Update in SQLite
    await this.store.patterns.approve(id, approvedBy);

    // Update cache
    const now = new Date().toISOString();
    const updated: Pattern = {
      ...pattern,
      status: 'approved',
      metadata: {
        ...pattern.metadata,
        lastSeen: now,
        approvedAt: now,
        ...(approvedBy ? { approvedBy } : {}),
      },
    };
    this.patternCache.set(id, updated);

    this.emit('pattern:approved', id, pattern.category);
    return updated;
  }

  /**
   * Ignore a pattern
   */
  async ignore(id: string): Promise<Pattern> {
    if (!this.store) throw new Error('Store not initialized');

    const pattern = this.getOrThrow(id);

    // Update in SQLite
    await this.store.patterns.ignore(id);

    // Update cache
    const updated: Pattern = {
      ...pattern,
      status: 'ignored',
      metadata: {
        ...pattern.metadata,
        lastSeen: new Date().toISOString(),
      },
    };
    this.patternCache.set(id, updated);

    this.emit('pattern:ignored', id, pattern.category);
    return updated;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  /**
   * Query patterns with filtering, sorting, and pagination
   */
  query(options: PatternQueryOptions = {}): PatternQueryResult {
    const startTime = Date.now();
    const { filter, sort, pagination } = options;

    let results = Array.from(this.patternCache.values());

    // Apply filters
    if (filter) {
      results = this.applyFilters(results, filter);
    }

    const total = results.length;

    // Apply sorting
    if (sort) {
      results = this.applySorting(results, sort);
    }

    // Apply pagination
    const offset = pagination?.offset ?? 0;
    const limit = pagination?.limit ?? results.length;
    const hasMore = offset + limit < total;
    results = results.slice(offset, offset + limit);

    return {
      patterns: results,
      total,
      hasMore,
      executionTime: Date.now() - startTime,
    };
  }

  private applyFilters(patterns: Pattern[], filter: PatternQuery): Pattern[] {
    return patterns.filter((pattern) => {
      if (filter.ids && !filter.ids.includes(pattern.id)) return false;
      if (filter.category) {
        const categories = Array.isArray(filter.category) ? filter.category : [filter.category];
        if (!categories.includes(pattern.category)) return false;
      }
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(pattern.status)) return false;
      }
      if (filter.minConfidence !== undefined && pattern.confidence.score < filter.minConfidence) return false;
      if (filter.maxConfidence !== undefined && pattern.confidence.score > filter.maxConfidence) return false;
      if (filter.file) {
        const hasFile = pattern.locations.some((loc) => loc.file === filter.file);
        if (!hasFile) return false;
      }
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const nameMatch = pattern.name.toLowerCase().includes(searchLower);
        const descMatch = pattern.description.toLowerCase().includes(searchLower);
        if (!nameMatch && !descMatch) return false;
      }
      return true;
    });
  }

  private applySorting(patterns: Pattern[], sort: { field: string; direction: 'asc' | 'desc' }): Pattern[] {
    const multiplier = sort.direction === 'asc' ? 1 : -1;
    return [...patterns].sort((a, b) => {
      switch (sort.field) {
        case 'name': return a.name.localeCompare(b.name) * multiplier;
        case 'confidence': return (a.confidence.score - b.confidence.score) * multiplier;
        case 'firstSeen': return (new Date(a.metadata.firstSeen).getTime() - new Date(b.metadata.firstSeen).getTime()) * multiplier;
        case 'lastSeen': return (new Date(a.metadata.lastSeen).getTime() - new Date(b.metadata.lastSeen).getTime()) * multiplier;
        default: return 0;
      }
    });
  }

  // ==========================================================================
  // Convenience Methods
  // ==========================================================================

  getAll(): Pattern[] {
    return Array.from(this.patternCache.values());
  }

  getByCategory(category: PatternCategory): Pattern[] {
    return this.query({ filter: { category } }).patterns;
  }

  getByStatus(status: PatternStatus): Pattern[] {
    return this.query({ filter: { status } }).patterns;
  }

  getByConfidenceLevel(level: ConfidenceLevel): Pattern[] {
    return this.query({ filter: { confidenceLevel: level } }).patterns;
  }

  getByMinConfidence(minScore: number): Pattern[] {
    return this.query({ filter: { minConfidence: minScore } }).patterns;
  }

  getApproved(): Pattern[] {
    return this.getByStatus('approved');
  }

  getDiscovered(): Pattern[] {
    return this.getByStatus('discovered');
  }

  getIgnored(): Pattern[] {
    return this.getByStatus('ignored');
  }

  getByFile(file: string): Pattern[] {
    return this.query({ filter: { file } }).patterns;
  }

  getWithOutliers(): Pattern[] {
    return this.query({ filter: { hasOutliers: true } }).patterns;
  }

  getHighConfidence(): Pattern[] {
    return this.getByConfidenceLevel('high');
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getStats(): PatternStoreStats {
    const patterns = Array.from(this.patternCache.values());

    const byStatus: Record<PatternStatus, number> = { discovered: 0, approved: 0, ignored: 0 };
    const byCategory: Record<PatternCategory, number> = {} as Record<PatternCategory, number>;
    for (const category of PATTERN_CATEGORIES) {
      byCategory[category] = 0;
    }
    const byConfidenceLevel: Record<ConfidenceLevel, number> = { high: 0, medium: 0, low: 0, uncertain: 0 };

    let totalLocations = 0;
    let totalOutliers = 0;

    for (const pattern of patterns) {
      byStatus[pattern.status]++;
      byCategory[pattern.category]++;
      byConfidenceLevel[pattern.confidence.level]++;
      totalLocations += pattern.locations.length;
      totalOutliers += pattern.outliers.length;
    }

    return {
      totalPatterns: patterns.length,
      byStatus,
      byCategory,
      byConfidenceLevel,
      totalLocations,
      totalOutliers,
      totalVariants: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Save all patterns (no-op for SQLite, patterns are saved immediately)
   */
  async saveAll(): Promise<void> {
    // SQLite saves are immediate, but we can checkpoint WAL
    if (this.store) {
      await this.store.checkpoint();
    }
  }

  /**
   * Reload patterns from SQLite
   */
  async loadAll(): Promise<void> {
    await this.loadAllToCache();
  }
}
