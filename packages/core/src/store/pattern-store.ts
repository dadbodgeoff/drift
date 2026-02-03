/**
 * Pattern Store - Pattern persistence and querying
 *
 * @deprecated This class uses the legacy JSON-based storage format.
 * Use `HybridPatternStore` from `@drift/core/storage` instead,
 * which provides SQLite-backed storage with better performance.
 *
 * For new code, use the factory function:
 * ```typescript
 * import { createPatternStore } from '@drift/core/storage';
 * const store = await createPatternStore({ rootDir: '/path/to/project' });
 * ```
 *
 * Migration: Run `drift migrate-storage` to convert to SQLite format.
 *
 * Loads and saves patterns to .drift/patterns/ directory.
 * Supports querying by category, confidence, and status.
 * Handles pattern state transitions (discovered → approved/ignored).
 *
 * @requirements 4.1 - THE Pattern_Store SHALL persist patterns as JSON in .drift/patterns/ directory
 * @requirements 4.3 - WHEN a pattern is approved, THE Pattern_Store SHALL move it from discovered/ to approved/
 * @requirements 4.6 - THE Pattern_Store SHALL support querying patterns by category, confidence, and status
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  validatePatternFile,
  validateSinglePattern,
  SchemaValidationError,
} from './schema-validator.js';
import {
  PATTERN_CATEGORIES,
  PATTERN_FILE_VERSION,
  DEFAULT_PATTERN_STORE_CONFIG,
} from './types.js';

import type {
  Pattern,
  PatternFile,
  StoredPattern,
  PatternCategory,
  PatternStatus,
  PatternQuery,
  PatternQueryOptions,
  PatternQueryResult,
  PatternSortOptions,
  PatternStoreConfig,
  PatternStoreEvent,
  PatternStoreEventType,
  PatternStoreStats,
  ConfidenceLevel,
  Severity,
} from './types.js';



// ============================================================================
// Constants
// ============================================================================

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Directory name for patterns */
const PATTERNS_DIR = 'patterns';

/** Status subdirectories */
const STATUS_DIRS: Record<PatternStatus, string> = {
  discovered: 'discovered',
  approved: 'approved',
  ignored: 'ignored',
};

/** Valid state transitions for patterns */
const VALID_TRANSITIONS: Record<PatternStatus, PatternStatus[]> = {
  discovered: ['approved', 'ignored'],
  approved: ['ignored'],
  ignored: ['approved'],
};

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when a pattern is not found
 */
export class PatternNotFoundError extends Error {
  constructor(
    public readonly patternId: string,
    public readonly category?: PatternCategory
  ) {
    super(`Pattern not found: ${patternId}${category ? ` in category ${category}` : ''}`);
    this.name = 'PatternNotFoundError';
  }
}

/**
 * Error thrown when an invalid state transition is attempted
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly patternId: string,
    public readonly fromStatus: PatternStatus,
    public readonly toStatus: PatternStatus
  ) {
    super(`Invalid state transition for pattern ${patternId}: ${fromStatus} → ${toStatus}`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Error thrown when a pattern store operation fails
 */
export class PatternStoreError extends Error {
  public readonly errorCause: Error | undefined;
  
  constructor(
    message: string,
    errorCause?: Error
  ) {
    super(message);
    this.name = 'PatternStoreError';
    this.errorCause = errorCause;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a Pattern to StoredPattern (removes category and status)
 */
function patternToStored(pattern: Pattern): StoredPattern {
  const { category, status, ...stored } = pattern;
  return stored;
}

/**
 * Convert a StoredPattern to Pattern (adds category and status)
 */
function storedToPattern(
  stored: StoredPattern,
  category: PatternCategory,
  status: PatternStatus
): Pattern {
  return {
    ...stored,
    category,
    status,
  };
}

/**
 * Generate a checksum for a pattern file
 */
function generateChecksum(patterns: StoredPattern[]): string {
  const content = JSON.stringify(patterns);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// ============================================================================
// Pattern Store Class
// ============================================================================

/**
 * Pattern Store - Manages pattern persistence and querying
 *
 * Patterns are stored in .drift/patterns/ directory organized by status:
 * - .drift/patterns/discovered/ - Patterns found but not yet reviewed
 * - .drift/patterns/approved/ - User-approved patterns (enforced)
 * - .drift/patterns/ignored/ - Patterns explicitly ignored by user
 *
 * Each status directory contains JSON files named by category (e.g., structural.json).
 *
 * @requirements 4.1 - Patterns persisted as JSON in .drift/patterns/
 * @requirements 4.3 - Patterns move between status directories on approval/ignore
 * @requirements 4.6 - Patterns queryable by category, confidence, status
 */
export class PatternStore extends EventEmitter {
  private readonly config: PatternStoreConfig;
  private readonly patternsDir: string;
  private patterns: Map<string, Pattern> = new Map();
  private loaded: boolean = false;
  private dirty: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(config: Partial<PatternStoreConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PATTERN_STORE_CONFIG, ...config };
    this.patternsDir = path.join(this.config.rootDir, DRIFT_DIR, PATTERNS_DIR);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the pattern store
   *
   * Creates necessary directories and loads existing patterns.
   */
  async initialize(): Promise<void> {
    // Create directory structure
    await this.ensureDirectoryStructure();

    // Load all patterns
    await this.loadAll();

    this.loaded = true;
  }

  /**
   * Ensure the directory structure exists
   */
  private async ensureDirectoryStructure(): Promise<void> {
    for (const status of Object.values(STATUS_DIRS)) {
      await ensureDir(path.join(this.patternsDir, status));
    }
  }

  // ==========================================================================
  // Loading
  // ==========================================================================

  /**
   * Load all patterns from disk
   *
   * @requirements 4.1 - Load patterns from .drift/patterns/
   */
  async loadAll(): Promise<void> {
    this.patterns.clear();

    for (const status of Object.keys(STATUS_DIRS) as PatternStatus[]) {
      await this.loadByStatus(status);
    }

    this.emitEvent('file:loaded', undefined, undefined, { count: this.patterns.size });
  }

  /**
   * Load patterns for a specific status
   */
  private async loadByStatus(status: PatternStatus): Promise<void> {
    const statusDir = path.join(this.patternsDir, STATUS_DIRS[status]);

    for (const category of PATTERN_CATEGORIES) {
      await this.loadCategoryFile(category, status, statusDir);
    }
  }

  /**
   * Load a single category file
   */
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
      const data = JSON.parse(content);

      // Validate if enabled
      if (this.config.validateSchema) {
        const result = validatePatternFile(data);
        if (!result.valid) {
          throw new SchemaValidationError(
            `Invalid pattern file: ${filePath}`,
            result.errors!,
            'PatternFile'
          );
        }
      }

      const patternFile = data as PatternFile;

      // Convert stored patterns to full patterns and add to map
      for (const stored of patternFile.patterns) {
        const pattern = storedToPattern(stored, category, status);
        this.patterns.set(pattern.id, pattern);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // File doesn't exist, skip
      }
      throw new PatternStoreError(
        `Failed to load pattern file: ${filePath}`,
        error as Error
      );
    }
  }

  // ==========================================================================
  // Saving
  // ==========================================================================

  /**
   * Save all patterns to disk
   *
   * @requirements 4.1 - Persist patterns as JSON in .drift/patterns/
   */
  async saveAll(): Promise<void> {
    // Group patterns by status and category
    const grouped = this.groupPatternsByStatusAndCategory();

    for (const [status, categories] of Array.from(grouped.entries())) {
      for (const [category, patterns] of Array.from(categories.entries())) {
        await this.saveCategoryFile(category, status, patterns);
      }
    }

    this.dirty = false;
    this.emitEvent('file:saved', undefined, undefined, { count: this.patterns.size });
  }

  /**
   * Group patterns by status and category
   */
  private groupPatternsByStatusAndCategory(): Map<PatternStatus, Map<PatternCategory, Pattern[]>> {
    const grouped = new Map<PatternStatus, Map<PatternCategory, Pattern[]>>();

    for (const status of Object.keys(STATUS_DIRS) as PatternStatus[]) {
      grouped.set(status, new Map());
      for (const category of PATTERN_CATEGORIES) {
        grouped.get(status)!.set(category, []);
      }
    }

    for (const pattern of Array.from(this.patterns.values())) {
      grouped.get(pattern.status)!.get(pattern.category)!.push(pattern);
    }

    return grouped;
  }

  /**
   * Save a single category file
   */
  private async saveCategoryFile(
    category: PatternCategory,
    status: PatternStatus,
    patterns: Pattern[]
  ): Promise<void> {
    const statusDir = path.join(this.patternsDir, STATUS_DIRS[status]);
    const filePath = path.join(statusDir, `${category}.json`);

    // If no patterns, remove the file if it exists
    if (patterns.length === 0) {
      if (await fileExists(filePath)) {
        await fs.unlink(filePath);
      }
      return;
    }

    // Convert to stored patterns
    const storedPatterns = patterns.map(patternToStored);

    // Create pattern file
    const patternFile: PatternFile = {
      version: PATTERN_FILE_VERSION,
      category,
      patterns: storedPatterns,
      lastUpdated: new Date().toISOString(),
      checksum: generateChecksum(storedPatterns),
    };

    // Validate if enabled
    if (this.config.validateSchema) {
      const result = validatePatternFile(patternFile);
      if (!result.valid) {
        throw new SchemaValidationError(
          `Invalid pattern file before save: ${filePath}`,
          result.errors!,
          'PatternFile'
        );
      }
    }

    // Create backup if enabled
    if (this.config.createBackup && (await fileExists(filePath))) {
      await this.createBackup(filePath);
    }

    // Ensure directory exists
    await ensureDir(statusDir);

    // Write file
    await fs.writeFile(filePath, JSON.stringify(patternFile, null, 2));
  }

  /**
   * Create a backup of a file
   */
  private async createBackup(filePath: string): Promise<void> {
    const backupDir = path.join(path.dirname(filePath), '.backups');
    await ensureDir(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      backupDir,
      `${path.basename(filePath, '.json')}-${timestamp}.json`
    );

    await fs.copyFile(filePath, backupPath);

    // Clean up old backups
    await this.cleanupBackups(backupDir, path.basename(filePath, '.json'));
  }

  /**
   * Clean up old backups, keeping only the most recent ones
   */
  private async cleanupBackups(backupDir: string, prefix: string): Promise<void> {
    try {
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .reverse();

      // Remove old backups beyond maxBackups
      for (const backup of backups.slice(this.config.maxBackups)) {
        await fs.unlink(path.join(backupDir, backup));
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Schedule an auto-save if enabled
   */
  private scheduleAutoSave(): void {
    if (!this.config.autoSave) {
      return;
    }

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      if (this.dirty) {
        await this.saveAll();
      }
    }, this.config.autoSaveDebounce);
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Get a pattern by ID
   *
   * @param id - Pattern ID
   * @returns The pattern or undefined if not found
   */
  get(id: string): Pattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * Get a pattern by ID, throwing if not found
   *
   * @param id - Pattern ID
   * @returns The pattern
   * @throws PatternNotFoundError if pattern not found
   */
  getOrThrow(id: string): Pattern {
    const pattern = this.patterns.get(id);
    if (!pattern) {
      throw new PatternNotFoundError(id);
    }
    return pattern;
  }

  /**
   * Check if a pattern exists
   *
   * @param id - Pattern ID
   * @returns True if pattern exists
   */
  has(id: string): boolean {
    return this.patterns.has(id);
  }

  /**
   * Add a new pattern
   *
   * @param pattern - Pattern to add
   * @throws Error if pattern with same ID already exists
   */
  add(pattern: Pattern): void {
    if (this.patterns.has(pattern.id)) {
      throw new PatternStoreError(`Pattern already exists: ${pattern.id}`);
    }

    // Validate if enabled
    if (this.config.validateSchema) {
      const result = validateSinglePattern(pattern);
      if (!result.valid) {
        throw new SchemaValidationError(
          `Invalid pattern: ${pattern.id}`,
          result.errors!,
          'Pattern'
        );
      }
    }

    this.patterns.set(pattern.id, pattern);
    this.dirty = true;
    this.emitEvent('pattern:created', pattern.id, pattern.category);
    this.scheduleAutoSave();
  }

  /**
   * Update an existing pattern
   *
   * @param id - Pattern ID
   * @param updates - Partial pattern updates
   * @returns The updated pattern
   * @throws PatternNotFoundError if pattern not found
   */
  update(id: string, updates: Partial<Omit<Pattern, 'id'>>): Pattern {
    const existing = this.getOrThrow(id);

    const updated: Pattern = {
      ...existing,
      ...updates,
      id, // Ensure ID cannot be changed
    };

    // Validate if enabled
    if (this.config.validateSchema) {
      const result = validateSinglePattern(updated);
      if (!result.valid) {
        throw new SchemaValidationError(
          `Invalid pattern update: ${id}`,
          result.errors!,
          'Pattern'
        );
      }
    }

    this.patterns.set(id, updated);
    this.dirty = true;
    this.emitEvent('pattern:updated', id, updated.category);
    this.scheduleAutoSave();

    return updated;
  }

  /**
   * Delete a pattern
   *
   * @param id - Pattern ID
   * @returns True if pattern was deleted
   */
  delete(id: string): boolean {
    const pattern = this.patterns.get(id);
    if (!pattern) {
      return false;
    }

    this.patterns.delete(id);
    this.dirty = true;
    this.emitEvent('pattern:deleted', id, pattern.category);
    this.scheduleAutoSave();

    return true;
  }

  // ==========================================================================
  // Status Transitions
  // ==========================================================================

  /**
   * Approve a pattern (move from discovered to approved)
   *
   * @requirements 4.3 - Move pattern from discovered/ to approved/
   *
   * @param id - Pattern ID
   * @param approvedBy - User who approved the pattern
   * @returns The updated pattern
   * @throws PatternNotFoundError if pattern not found
   * @throws InvalidStateTransitionError if transition is invalid
   */
  approve(id: string, approvedBy?: string): Pattern {
    return this.transitionStatus(id, 'approved', approvedBy);
  }

  /**
   * Ignore a pattern (move to ignored)
   *
   * @param id - Pattern ID
   * @returns The updated pattern
   * @throws PatternNotFoundError if pattern not found
   * @throws InvalidStateTransitionError if transition is invalid
   */
  ignore(id: string): Pattern {
    return this.transitionStatus(id, 'ignored');
  }

  /**
   * Transition a pattern to a new status
   *
   * @requirements 4.3 - Move patterns between status directories
   *
   * @param id - Pattern ID
   * @param newStatus - Target status
   * @param user - User performing the transition
   * @returns The updated pattern
   */
  private transitionStatus(
    id: string,
    newStatus: PatternStatus,
    user?: string
  ): Pattern {
    const pattern = this.getOrThrow(id);
    const currentStatus = pattern.status;

    // Validate transition
    if (!VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
      throw new InvalidStateTransitionError(id, currentStatus, newStatus);
    }

    // Update pattern
    const now = new Date().toISOString();
    const updatedMetadata = {
      ...pattern.metadata,
      lastSeen: now,
    };
    
    if (newStatus === 'approved') {
      updatedMetadata.approvedAt = now;
      if (user) {
        updatedMetadata.approvedBy = user;
      }
    }
    
    const updated: Pattern = {
      ...pattern,
      status: newStatus,
      metadata: updatedMetadata,
    };

    this.patterns.set(id, updated);
    this.dirty = true;

    // Emit appropriate event
    if (newStatus === 'approved') {
      this.emitEvent('pattern:approved', id, pattern.category);
    } else if (newStatus === 'ignored') {
      this.emitEvent('pattern:ignored', id, pattern.category);
    }

    this.scheduleAutoSave();

    return updated;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  /**
   * Query patterns with filtering, sorting, and pagination
   *
   * @requirements 4.6 - Support querying by category, confidence, status
   *
   * @param options - Query options
   * @returns Query result with matching patterns
   */
  query(options: PatternQueryOptions = {}): PatternQueryResult {
    const startTime = Date.now();
    const { filter, sort, pagination } = options;

    // Start with all patterns
    let results = Array.from(this.patterns.values());

    // Apply filters
    if (filter) {
      results = this.applyFilters(results, filter);
    }

    // Get total before pagination
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

  /**
   * Apply filters to patterns
   */
  private applyFilters(patterns: Pattern[], filter: PatternQuery): Pattern[] {
    return patterns.filter((pattern) => {
      // Filter by IDs
      if (filter.ids && !filter.ids.includes(pattern.id)) {
        return false;
      }

      // Filter by category
      if (filter.category) {
        const categories = Array.isArray(filter.category) ? filter.category : [filter.category];
        if (!categories.includes(pattern.category)) {
          return false;
        }
      }

      // Filter by subcategory
      if (filter.subcategory) {
        const subcategories = Array.isArray(filter.subcategory)
          ? filter.subcategory
          : [filter.subcategory];
        if (!subcategories.includes(pattern.subcategory)) {
          return false;
        }
      }

      // Filter by status
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(pattern.status)) {
          return false;
        }
      }

      // Filter by confidence score range
      if (filter.minConfidence !== undefined && pattern.confidence.score < filter.minConfidence) {
        return false;
      }
      if (filter.maxConfidence !== undefined && pattern.confidence.score > filter.maxConfidence) {
        return false;
      }

      // Filter by confidence level
      if (filter.confidenceLevel) {
        const levels = Array.isArray(filter.confidenceLevel)
          ? filter.confidenceLevel
          : [filter.confidenceLevel];
        if (!levels.includes(pattern.confidence.level)) {
          return false;
        }
      }

      // Filter by severity
      if (filter.severity) {
        const severities = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
        if (!severities.includes(pattern.severity)) {
          return false;
        }
      }

      // Filter by auto-fixable
      if (filter.autoFixable !== undefined && pattern.autoFixable !== filter.autoFixable) {
        return false;
      }

      // Filter by file
      if (filter.file) {
        const hasFile = pattern.locations.some((loc) => loc.file === filter.file);
        if (!hasFile) {
          return false;
        }
      }

      // Filter by files
      if (filter.files && filter.files.length > 0) {
        const hasAnyFile = pattern.locations.some((loc) => filter.files!.includes(loc.file));
        if (!hasAnyFile) {
          return false;
        }
      }

      // Filter by outliers
      if (filter.hasOutliers !== undefined) {
        const hasOutliers = pattern.outliers.length > 0;
        if (filter.hasOutliers !== hasOutliers) {
          return false;
        }
      }

      // Filter by minimum outlier count
      if (filter.minOutliers !== undefined && pattern.outliers.length < filter.minOutliers) {
        return false;
      }

      // Filter by tags
      if (filter.tags && filter.tags.length > 0) {
        const patternTags = pattern.metadata.tags ?? [];
        const hasAllTags = filter.tags.every((tag) => patternTags.includes(tag));
        if (!hasAllTags) {
          return false;
        }
      }

      // Filter by source
      if (filter.source && pattern.metadata.source !== filter.source) {
        return false;
      }

      // Search in name and description
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const nameMatch = pattern.name.toLowerCase().includes(searchLower);
        const descMatch = pattern.description.toLowerCase().includes(searchLower);
        if (!nameMatch && !descMatch) {
          return false;
        }
      }

      // Filter by date ranges
      if (filter.createdAfter) {
        const firstSeen = new Date(pattern.metadata.firstSeen);
        const after = new Date(filter.createdAfter);
        if (firstSeen < after) {
          return false;
        }
      }

      if (filter.createdBefore) {
        const firstSeen = new Date(pattern.metadata.firstSeen);
        const before = new Date(filter.createdBefore);
        if (firstSeen > before) {
          return false;
        }
      }

      if (filter.seenAfter) {
        const lastSeen = new Date(pattern.metadata.lastSeen);
        const after = new Date(filter.seenAfter);
        if (lastSeen < after) {
          return false;
        }
      }

      if (filter.seenBefore) {
        const lastSeen = new Date(pattern.metadata.lastSeen);
        const before = new Date(filter.seenBefore);
        if (lastSeen > before) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Apply sorting to patterns
   */
  private applySorting(patterns: Pattern[], sort: PatternSortOptions): Pattern[] {
    const { field, direction } = sort;
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...patterns].sort((a, b) => {
      let comparison = 0;

      switch (field) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'confidence':
          comparison = a.confidence.score - b.confidence.score;
          break;
        case 'severity':
          const severityOrder: Record<Severity, number> = {
            error: 4,
            warning: 3,
            info: 2,
            hint: 1,
          };
          comparison = severityOrder[a.severity] - severityOrder[b.severity];
          break;
        case 'firstSeen':
          comparison =
            new Date(a.metadata.firstSeen).getTime() -
            new Date(b.metadata.firstSeen).getTime();
          break;
        case 'lastSeen':
          comparison =
            new Date(a.metadata.lastSeen).getTime() -
            new Date(b.metadata.lastSeen).getTime();
          break;
        case 'outlierCount':
          comparison = a.outliers.length - b.outliers.length;
          break;
        case 'locationCount':
          comparison = a.locations.length - b.locations.length;
          break;
      }

      return comparison * multiplier;
    });
  }

  // ==========================================================================
  // Convenience Query Methods
  // ==========================================================================

  /**
   * Get all patterns
   */
  getAll(): Pattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get patterns by category
   *
   * @requirements 4.6 - Query by category
   */
  getByCategory(category: PatternCategory): Pattern[] {
    return this.query({ filter: { category } }).patterns;
  }

  /**
   * Get patterns by status
   *
   * @requirements 4.6 - Query by status
   */
  getByStatus(status: PatternStatus): Pattern[] {
    return this.query({ filter: { status } }).patterns;
  }

  /**
   * Get patterns by confidence level
   *
   * @requirements 4.6 - Query by confidence
   */
  getByConfidenceLevel(level: ConfidenceLevel): Pattern[] {
    return this.query({ filter: { confidenceLevel: level } }).patterns;
  }

  /**
   * Get patterns with minimum confidence score
   *
   * @requirements 4.6 - Query by confidence
   */
  getByMinConfidence(minScore: number): Pattern[] {
    return this.query({ filter: { minConfidence: minScore } }).patterns;
  }

  /**
   * Get approved patterns
   */
  getApproved(): Pattern[] {
    return this.getByStatus('approved');
  }

  /**
   * Get discovered patterns
   */
  getDiscovered(): Pattern[] {
    return this.getByStatus('discovered');
  }

  /**
   * Get ignored patterns
   */
  getIgnored(): Pattern[] {
    return this.getByStatus('ignored');
  }

  /**
   * Get patterns that have locations in a specific file
   */
  getByFile(file: string): Pattern[] {
    return this.query({ filter: { file } }).patterns;
  }

  /**
   * Get patterns with outliers
   */
  getWithOutliers(): Pattern[] {
    return this.query({ filter: { hasOutliers: true } }).patterns;
  }

  /**
   * Get high confidence patterns
   */
  getHighConfidence(): Pattern[] {
    return this.getByConfidenceLevel('high');
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get statistics about the pattern store
   */
  getStats(): PatternStoreStats {
    const patterns = Array.from(this.patterns.values());

    const byStatus: Record<PatternStatus, number> = {
      discovered: 0,
      approved: 0,
      ignored: 0,
    };

    const byCategory: Record<PatternCategory, number> = {} as Record<PatternCategory, number>;
    for (const category of PATTERN_CATEGORIES) {
      byCategory[category] = 0;
    }

    const byConfidenceLevel: Record<ConfidenceLevel, number> = {
      high: 0,
      medium: 0,
      low: 0,
      uncertain: 0,
    };

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
      totalVariants: 0, // Variants are managed separately
      lastUpdated: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Emit a pattern store event
   */
  private emitEvent(
    type: PatternStoreEventType,
    patternId?: string,
    category?: PatternCategory,
    data?: Record<string, unknown>
  ): void {
    const event: PatternStoreEvent = {
      type,
      timestamp: new Date().toISOString(),
    };
    
    if (patternId !== undefined) {
      event.patternId = patternId;
    }
    if (category !== undefined) {
      event.category = category;
    }
    if (data !== undefined) {
      event.data = data;
    }

    this.emit(type, event);
    this.emit('*', event); // Wildcard for all events
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get the number of patterns in the store
   */
  get size(): number {
    return this.patterns.size;
  }

  /**
   * Check if the store has been loaded
   */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Check if there are unsaved changes
   */
  get isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Get the patterns directory path
   */
  get path(): string {
    return this.patternsDir;
  }

  /**
   * Clear all patterns from memory (does not affect disk)
   */
  clear(): void {
    this.patterns.clear();
    this.dirty = true;
  }

  /**
   * Dispose of the pattern store
   */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.removeAllListeners();
  }
}
