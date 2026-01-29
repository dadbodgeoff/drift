/**
 * Pattern Store Adapter
 *
 * Adapts the existing PatternStore to the new IPatternRepository interface.
 * This enables gradual migration of consumers to the new pattern system
 * while maintaining backward compatibility.
 *
 * @module patterns/adapters/pattern-store-adapter
 */

import { EventEmitter } from 'node:events';

import {
  PatternNotFoundError,
  InvalidStatusTransitionError,
  PatternAlreadyExistsError,
} from '../errors.js';
import { computeConfidenceLevel, toPatternSummary } from '../types.js';


// Import the existing PatternStore and Pattern types
import type { PatternStore } from '../../store/pattern-store.js';
import type { Pattern as LegacyPattern, PatternLocation as LegacyPatternLocation, OutlierLocation as LegacyOutlierLocation } from '../../store/types.js';
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
  Pattern as UnifiedPattern,
  PatternCategory,
  PatternStatus,
  PatternSummary,
  ConfidenceLevel,
  Severity,
  DetectionMethod,
} from '../types.js';

// ============================================================================
// Type Conversion Helpers
// ============================================================================

/**
 * Convert a legacy Pattern to the unified Pattern type
 */
function legacyToUnified(legacy: LegacyPattern): UnifiedPattern {
  return {
    id: legacy.id,
    category: legacy.category as PatternCategory,
    subcategory: legacy.subcategory,
    name: legacy.name,
    description: legacy.description,
    detectorId: (legacy.detector?.config?.['detectorId'] as string) ?? 'unknown',
    detectorName: legacy.name,
    detectionMethod: (legacy.detector?.type ?? 'ast') as DetectionMethod,
    detector: {
      type: (legacy.detector?.type ?? 'ast') as DetectionMethod,
      config: legacy.detector?.config ?? {},
    },
    confidence: legacy.confidence.score,
    confidenceLevel: legacy.confidence.level as ConfidenceLevel,
    locations: legacy.locations.map((loc: LegacyPatternLocation) => ({
      file: loc.file,
      line: loc.line,
      column: loc.column,
      endLine: loc.endLine,
      endColumn: loc.endColumn,
    })),
    outliers: legacy.outliers.map((out: LegacyOutlierLocation) => ({
      file: out.file,
      line: out.line,
      column: out.column,
      endLine: out.endLine,
      endColumn: out.endColumn,
      reason: out.reason,
      deviationScore: out.deviationScore,
    })),
    status: legacy.status as PatternStatus,
    severity: legacy.severity as Severity,
    firstSeen: legacy.metadata.firstSeen,
    lastSeen: legacy.metadata.lastSeen,
    approvedAt: legacy.metadata.approvedAt,
    approvedBy: legacy.metadata.approvedBy,
    tags: legacy.metadata.tags ?? [],
    autoFixable: legacy.autoFixable,
    metadata: {
      firstSeen: legacy.metadata.firstSeen,
      lastSeen: legacy.metadata.lastSeen,
      approvedAt: legacy.metadata.approvedAt,
      approvedBy: legacy.metadata.approvedBy,
      version: legacy.metadata.version,
      tags: legacy.metadata.tags,
      relatedPatterns: legacy.metadata.relatedPatterns,
      source: legacy.metadata.source,
      custom: legacy.metadata.custom,
    },
  };
}

/**
 * Convert a unified Pattern to the legacy Pattern type
 */
function unifiedToLegacy(unified: UnifiedPattern): LegacyPattern {
  return {
    id: unified.id,
    category: unified.category,
    subcategory: unified.subcategory,
    name: unified.name,
    description: unified.description,
    detector: {
      type: unified.detectionMethod,
      config: {
        ...unified.detector.config,
        detectorId: unified.detectorId,
      },
    },
    confidence: {
      score: unified.confidence,
      level: unified.confidenceLevel,
      frequency: unified.confidence,
      consistency: 1,
      age: 0,
      spread: unified.locations.length,
    },
    locations: unified.locations.map((loc) => ({
      file: loc.file,
      line: loc.line,
      column: loc.column,
      endLine: loc.endLine,
      endColumn: loc.endColumn,
    })),
    outliers: unified.outliers.map((out) => ({
      file: out.file,
      line: out.line,
      column: out.column,
      endLine: out.endLine,
      endColumn: out.endColumn,
      reason: out.reason,
      deviationScore: out.deviationScore,
    })),
    status: unified.status,
    severity: unified.severity,
    autoFixable: unified.autoFixable,
    metadata: {
      firstSeen: unified.firstSeen,
      lastSeen: unified.lastSeen,
      approvedAt: unified.approvedAt,
      approvedBy: unified.approvedBy,
      version: unified.metadata.version,
      tags: unified.tags,
      relatedPatterns: unified.metadata.relatedPatterns,
      source: unified.metadata.source,
      custom: unified.metadata.custom,
    },
  } as LegacyPattern;
}

// ============================================================================
// Pattern Store Adapter
// ============================================================================

/**
 * Adapter that wraps the existing PatternStore and exposes it
 * through the IPatternRepository interface.
 *
 * This enables gradual migration of consumers to the new pattern system.
 */
export class PatternStoreAdapter extends EventEmitter implements IPatternRepository {
  private readonly store: PatternStore;
  private initialized: boolean = false;

  constructor(store: PatternStore) {
    super();
    this.store = store;

    // Forward events from the underlying store
    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    // Map legacy events to new event types
    // Note: The store emits PatternStoreEvent objects, not Pattern objects
    // We need to fetch the pattern from the store when handling events
    
    this.store.on('pattern:created', (event: { patternId?: string }) => {
      if (event.patternId) {
        const pattern = this.store.get(event.patternId);
        if (pattern) {
          this.emit('pattern:added', legacyToUnified(pattern));
        }
      }
    });

    this.store.on('pattern:updated', (event: { patternId?: string }) => {
      if (event.patternId) {
        const pattern = this.store.get(event.patternId);
        if (pattern) {
          this.emit('pattern:updated', legacyToUnified(pattern));
        }
      }
    });

    this.store.on('pattern:deleted', (event: { patternId?: string; category?: string }) => {
      // Pattern is already deleted, emit with minimal info
      if (event.patternId) {
        this.emit('pattern:deleted', { id: event.patternId, category: event.category });
      }
    });

    this.store.on('pattern:approved', (event: { patternId?: string }) => {
      if (event.patternId) {
        const pattern = this.store.get(event.patternId);
        if (pattern) {
          this.emit('pattern:approved', legacyToUnified(pattern));
        }
      }
    });

    this.store.on('pattern:ignored', (event: { patternId?: string }) => {
      if (event.patternId) {
        const pattern = this.store.get(event.patternId);
        if (pattern) {
          this.emit('pattern:ignored', legacyToUnified(pattern));
        }
      }
    });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) {return;}
    await this.store.initialize();
    this.initialized = true;
    this.emit('patterns:loaded', undefined, { count: this.store.getAll().length });
  }

  async close(): Promise<void> {
    // PatternStore doesn't have a close method, but we can save
    await this.store.saveAll();
    this.initialized = false;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  async add(pattern: UnifiedPattern): Promise<void> {
    this.ensureInitialized();

    if (this.store.get(pattern.id)) {
      throw new PatternAlreadyExistsError(pattern.id);
    }

    const legacy = unifiedToLegacy(pattern);
    this.store.add(legacy);
  }

  async addMany(patterns: UnifiedPattern[]): Promise<void> {
    for (const pattern of patterns) {
      await this.add(pattern);
    }
  }

  async get(id: string): Promise<UnifiedPattern | null> {
    this.ensureInitialized();

    const legacy = this.store.get(id);
    if (!legacy) {return null;}

    return legacyToUnified(legacy);
  }

  async update(id: string, updates: Partial<UnifiedPattern>): Promise<UnifiedPattern> {
    this.ensureInitialized();

    const existing = this.store.get(id);
    if (!existing) {
      throw new PatternNotFoundError(id);
    }

    // Convert updates to legacy format and apply
    const unified = legacyToUnified(existing);
    const updated: UnifiedPattern = {
      ...unified,
      ...updates,
      id: unified.id, // Prevent ID change
      lastSeen: new Date().toISOString(),
    };

    // Recompute confidence level if confidence changed
    if (updates.confidence !== undefined) {
      updated.confidenceLevel = computeConfidenceLevel(updates.confidence);
    }

    const legacy = unifiedToLegacy(updated);
    this.store.update(id, legacy);

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const existing = this.store.get(id);
    if (!existing) {return false;}

    this.store.delete(id);
    return true;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  async query(options: PatternQueryOptions): Promise<PatternQueryResult> {
    this.ensureInitialized();

    let patterns = this.store.getAll().map(legacyToUnified);

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

  private applyFilter(patterns: UnifiedPattern[], filter: PatternFilter): UnifiedPattern[] {
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

  private applySort(patterns: UnifiedPattern[], sort: PatternSort): UnifiedPattern[] {
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

  async getByCategory(category: PatternCategory): Promise<UnifiedPattern[]> {
    const result = await this.query({
      filter: { categories: [category] },
    });
    return result.patterns;
  }

  async getByStatus(status: PatternStatus): Promise<UnifiedPattern[]> {
    const result = await this.query({
      filter: { statuses: [status] },
    });
    return result.patterns;
  }

  async getByFile(file: string): Promise<UnifiedPattern[]> {
    const result = await this.query({
      filter: { files: [file] },
    });
    return result.patterns;
  }

  async getAll(): Promise<UnifiedPattern[]> {
    this.ensureInitialized();
    return this.store.getAll().map(legacyToUnified);
  }

  async count(filter?: PatternFilter): Promise<number> {
    if (!filter) {
      return this.store.getAll().length;
    }

    const result = await this.query({ filter });
    return result.total;
  }

  // ==========================================================================
  // Status Transitions
  // ==========================================================================

  async approve(id: string, approvedBy?: string): Promise<UnifiedPattern> {
    this.ensureInitialized();

    const existing = this.store.get(id);
    if (!existing) {
      throw new PatternNotFoundError(id);
    }

    try {
      this.store.approve(id, approvedBy);
    } catch (error) {
      if ((error as Error).name === 'InvalidStateTransitionError') {
        throw new InvalidStatusTransitionError(id, existing.status as PatternStatus, 'approved');
      }
      throw error;
    }

    // Persist the change to disk immediately
    await this.store.saveAll();

    const updated = this.store.get(id);
    return legacyToUnified(updated!);
  }

  async ignore(id: string): Promise<UnifiedPattern> {
    this.ensureInitialized();

    const existing = this.store.get(id);
    if (!existing) {
      throw new PatternNotFoundError(id);
    }

    try {
      this.store.ignore(id);
    } catch (error) {
      if ((error as Error).name === 'InvalidStateTransitionError') {
        throw new InvalidStatusTransitionError(id, existing.status as PatternStatus, 'ignored');
      }
      throw error;
    }

    // Persist the change to disk immediately
    await this.store.saveAll();

    const updated = this.store.get(id);
    return legacyToUnified(updated!);
  }

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  async saveAll(): Promise<void> {
    await this.store.saveAll();
    this.emit('patterns:saved', undefined, { count: this.store.getAll().length });
  }

  async clear(): Promise<void> {
    this.ensureInitialized();
    // PatternStore doesn't have a clear method, so we delete all patterns
    const patterns = this.store.getAll();
    for (const pattern of patterns) {
      this.store.delete(pattern.id);
    }
    await this.store.saveAll();
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
    return this.store.get(id) !== undefined;
  }

  async getSummaries(options?: PatternQueryOptions): Promise<PatternSummary[]> {
    const result = await this.query(options ?? {});
    return result.patterns.map(toPatternSummary);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Adapter not initialized. Call initialize() first.');
    }
  }

  // ==========================================================================
  // Legacy Access
  // ==========================================================================

  /**
   * Get the underlying PatternStore for legacy code that needs direct access.
   * @deprecated Use the IPatternRepository interface instead.
   */
  getLegacyStore(): PatternStore {
    return this.store;
  }
}

/**
 * Create a PatternStoreAdapter from an existing PatternStore
 */
export function createPatternStoreAdapter(store: PatternStore): PatternStoreAdapter {
  return new PatternStoreAdapter(store);
}
