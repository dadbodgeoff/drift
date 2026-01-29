/**
 * In-Memory Pattern Repository
 *
 * Implementation of IPatternRepository that stores patterns in memory.
 * Useful for testing and temporary storage.
 *
 * @module patterns/impl/memory-repository
 */

import { EventEmitter } from 'node:events';

import {
  PatternNotFoundError,
  InvalidStatusTransitionError,
  PatternAlreadyExistsError,
} from '../errors.js';
import {
  VALID_STATUS_TRANSITIONS,
  computeConfidenceLevel,
  toPatternSummary,
} from '../types.js';

import type {
  IPatternRepository,
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
} from '../types.js';

// Re-export errors for convenience
export { PatternNotFoundError, InvalidStatusTransitionError, PatternAlreadyExistsError };

// ============================================================================
// In-Memory Pattern Repository
// ============================================================================

/**
 * In-memory pattern repository implementation.
 *
 * Stores patterns in a Map for fast access. No persistence.
 * Ideal for testing and temporary storage scenarios.
 */
export class InMemoryPatternRepository extends EventEmitter implements IPatternRepository {
  private patterns: Map<string, Pattern> = new Map();
  private initialized: boolean = false;

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    this.initialized = true;
    this.emit('patterns:loaded', undefined, { count: this.patterns.size });
  }

  async close(): Promise<void> {
    this.patterns.clear();
    this.initialized = false;
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
    this.emit('pattern:deleted', pattern);

    return true;
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

  async saveAll(): Promise<void> {
    // No-op for in-memory repository
    this.emit('patterns:saved', undefined, { count: this.patterns.size });
  }

  async clear(): Promise<void> {
    this.ensureInitialized();
    this.patterns.clear();
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

  // ==========================================================================
  // Testing Utilities
  // ==========================================================================

  /**
   * Seed the repository with patterns (for testing).
   */
  async seed(patterns: Pattern[]): Promise<void> {
    for (const pattern of patterns) {
      this.patterns.set(pattern.id, {
        ...pattern,
        confidenceLevel: computeConfidenceLevel(pattern.confidence),
      });
    }
  }

  /**
   * Get the internal patterns map (for testing).
   */
  getInternalMap(): Map<string, Pattern> {
    return this.patterns;
  }
}
