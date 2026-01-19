/**
 * History Store - Pattern change tracking and approval history
 *
 * Tracks pattern changes over time and stores approval history.
 * History entries are stored in .drift/history/ directory.
 *
 * @requirements 4.4 - THE Pattern_Store SHALL maintain history of pattern changes in .drift/history/
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

import type {
  PatternCategory,
  PatternHistoryEvent,
  PatternHistory,
  HistoryFile,
  HistoryEventType,
  Pattern,
} from './types.js';

import { HISTORY_FILE_VERSION } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Directory name for history */
const HISTORY_DIR = 'history';

/** Main history file name */
const HISTORY_FILE = 'patterns.json';

/** Default maximum history entries per pattern */
const DEFAULT_MAX_ENTRIES_PER_PATTERN = 100;

/** Default maximum age for history entries in days */
const DEFAULT_MAX_AGE_DAYS = 365;

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when a history operation fails
 */
export class HistoryStoreError extends Error {
  public readonly errorCause: Error | undefined;

  constructor(message: string, errorCause?: Error) {
    super(message);
    this.name = 'HistoryStoreError';
    this.errorCause = errorCause;
  }
}

/**
 * Error thrown when a pattern history is not found
 */
export class PatternHistoryNotFoundError extends Error {
  constructor(public readonly patternId: string) {
    super(`Pattern history not found: ${patternId}`);
    this.name = 'PatternHistoryNotFoundError';
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for the history store
 */
export interface HistoryStoreConfig {
  /** Root directory for .drift folder (defaults to project root) */
  rootDir: string;

  /** Maximum number of history entries per pattern */
  maxEntriesPerPattern: number;

  /** Maximum age for history entries in days */
  maxAgeDays: number;

  /** Whether to auto-save changes */
  autoSave: boolean;

  /** Debounce time for auto-save in milliseconds */
  autoSaveDebounce: number;
}

/**
 * Default history store configuration
 */
export const DEFAULT_HISTORY_STORE_CONFIG: HistoryStoreConfig = {
  rootDir: '.',
  maxEntriesPerPattern: DEFAULT_MAX_ENTRIES_PER_PATTERN,
  maxAgeDays: DEFAULT_MAX_AGE_DAYS,
  autoSave: false,
  autoSaveDebounce: 1000,
};

/**
 * Query options for filtering history events
 */
export interface HistoryQuery {
  /** Filter by pattern ID */
  patternId?: string;

  /** Filter by pattern IDs */
  patternIds?: string[];

  /** Filter by event type */
  eventType?: HistoryEventType | HistoryEventType[];

  /** Filter by category */
  category?: PatternCategory | PatternCategory[];

  /** Filter by user */
  user?: string;

  /** Filter events after this date (ISO string) */
  after?: string;

  /** Filter events before this date (ISO string) */
  before?: string;

  /** Maximum number of results */
  limit?: number;

  /** Number of results to skip */
  offset?: number;
}

/**
 * Result of a history query
 */
export interface HistoryQueryResult {
  /** Matching history events */
  events: PatternHistoryEvent[];

  /** Total count (before pagination) */
  total: number;

  /** Whether there are more results */
  hasMore: boolean;

  /** Query execution time in milliseconds */
  executionTime: number;
}

/**
 * Events emitted by the history store
 */
export type HistoryStoreEventType =
  | 'event:recorded'
  | 'history:pruned'
  | 'file:loaded'
  | 'file:saved'
  | 'error';

/**
 * Event payload for history store events
 */
export interface HistoryStoreEvent {
  /** Event type */
  type: HistoryStoreEventType;

  /** Pattern ID (if applicable) */
  patternId?: string;

  /** Additional event data */
  data?: Record<string, unknown>;

  /** ISO timestamp of the event */
  timestamp: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

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
// History Store Class
// ============================================================================

/**
 * History Store - Manages pattern change history
 *
 * Tracks all pattern changes including:
 * - Pattern created
 * - Pattern updated
 * - Pattern approved
 * - Pattern ignored
 * - Pattern deleted
 * - Confidence changed
 * - Locations changed
 * - Severity changed
 *
 * History is stored in .drift/history/patterns.json
 *
 * @requirements 4.4 - Pattern history tracked in .drift/history/
 */
export class HistoryStore extends EventEmitter {
  private readonly config: HistoryStoreConfig;
  private readonly historyDir: string;
  private readonly historyFilePath: string;
  private histories: Map<string, PatternHistory> = new Map();
  private loaded: boolean = false;
  private dirty: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(config: Partial<HistoryStoreConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HISTORY_STORE_CONFIG, ...config };
    this.historyDir = path.join(this.config.rootDir, DRIFT_DIR, HISTORY_DIR);
    this.historyFilePath = path.join(this.historyDir, HISTORY_FILE);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the history store
   *
   * Creates necessary directories and loads existing history.
   */
  async initialize(): Promise<void> {
    // Create directory structure
    await ensureDir(this.historyDir);

    // Load existing history
    await this.load();

    this.loaded = true;
  }

  // ==========================================================================
  // Loading
  // ==========================================================================

  /**
   * Load history from disk
   *
   * @requirements 4.4 - Load history from .drift/history/
   */
  async load(): Promise<void> {
    this.histories.clear();

    if (!(await fileExists(this.historyFilePath))) {
      this.emitEvent('file:loaded', undefined, { count: 0 });
      return;
    }

    try {
      const content = await fs.readFile(this.historyFilePath, 'utf-8');
      const data = JSON.parse(content) as HistoryFile;

      // Load pattern histories into map
      for (const history of data.patterns) {
        this.histories.set(history.patternId, history);
      }

      this.emitEvent('file:loaded', undefined, { count: this.histories.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // File doesn't exist, skip
      }
      throw new HistoryStoreError(
        `Failed to load history file: ${this.historyFilePath}`,
        error as Error
      );
    }
  }

  // ==========================================================================
  // Saving
  // ==========================================================================

  /**
   * Save history to disk
   *
   * @requirements 4.4 - Persist history in .drift/history/
   */
  async save(): Promise<void> {
    const historyFile: HistoryFile = {
      version: HISTORY_FILE_VERSION,
      patterns: Array.from(this.histories.values()),
      lastUpdated: new Date().toISOString(),
    };

    // Ensure directory exists
    await ensureDir(this.historyDir);

    // Write file
    await fs.writeFile(this.historyFilePath, JSON.stringify(historyFile, null, 2));

    this.dirty = false;
    this.emitEvent('file:saved', undefined, { count: this.histories.size });
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
        await this.save();
      }
    }, this.config.autoSaveDebounce);
  }

  // ==========================================================================
  // Recording Events
  // ==========================================================================

  /**
   * Record a history event for a pattern
   *
   * @param patternId - Pattern ID
   * @param category - Pattern category
   * @param eventType - Type of event
   * @param options - Additional event options
   */
  recordEvent(
    patternId: string,
    category: PatternCategory,
    eventType: HistoryEventType,
    options: {
      user?: string;
      previousValue?: unknown;
      newValue?: unknown;
      details?: Record<string, unknown>;
    } = {}
  ): PatternHistoryEvent {
    const now = new Date().toISOString();

    // Create the event
    const event: PatternHistoryEvent = {
      timestamp: now,
      type: eventType,
      patternId,
      ...(options.user && { user: options.user }),
      ...(options.previousValue !== undefined && { previousValue: options.previousValue }),
      ...(options.newValue !== undefined && { newValue: options.newValue }),
      ...(options.details && { details: options.details }),
    };

    // Get or create pattern history
    let history = this.histories.get(patternId);
    if (!history) {
      history = {
        patternId,
        category,
        events: [],
        createdAt: now,
        lastModified: now,
      };
      this.histories.set(patternId, history);
    }

    // Add event to history
    history.events.push(event);
    history.lastModified = now;

    // Prune if needed
    this.prunePatternHistory(patternId);

    this.dirty = true;
    this.emitEvent('event:recorded', patternId, { eventType });
    this.scheduleAutoSave();

    return event;
  }

  /**
   * Record a pattern creation event
   */
  recordCreated(pattern: Pattern, user?: string): PatternHistoryEvent {
    const options: {
      user?: string;
      newValue?: unknown;
    } = {
      newValue: {
        name: pattern.name,
        description: pattern.description,
        confidence: pattern.confidence.score,
        severity: pattern.severity,
      },
    };
    if (user !== undefined) {
      options.user = user;
    }
    return this.recordEvent(pattern.id, pattern.category, 'created', options);
  }

  /**
   * Record a pattern update event
   */
  recordUpdated(
    pattern: Pattern,
    previousPattern: Pattern,
    user?: string
  ): PatternHistoryEvent {
    const options: {
      user?: string;
      previousValue?: unknown;
      newValue?: unknown;
    } = {
      previousValue: {
        name: previousPattern.name,
        description: previousPattern.description,
      },
      newValue: {
        name: pattern.name,
        description: pattern.description,
      },
    };
    if (user !== undefined) {
      options.user = user;
    }
    return this.recordEvent(pattern.id, pattern.category, 'updated', options);
  }

  /**
   * Record a pattern approval event
   */
  recordApproved(pattern: Pattern, user?: string): PatternHistoryEvent {
    const options: {
      user?: string;
      details?: Record<string, unknown>;
    } = {
      details: {
        confidence: pattern.confidence.score,
        severity: pattern.severity,
      },
    };
    if (user !== undefined) {
      options.user = user;
    }
    return this.recordEvent(pattern.id, pattern.category, 'approved', options);
  }

  /**
   * Record a pattern ignore event
   */
  recordIgnored(pattern: Pattern, user?: string): PatternHistoryEvent {
    const options: { user?: string } = {};
    if (user !== undefined) {
      options.user = user;
    }
    return this.recordEvent(pattern.id, pattern.category, 'ignored', options);
  }

  /**
   * Record a pattern deletion event
   */
  recordDeleted(pattern: Pattern, user?: string): PatternHistoryEvent {
    const options: {
      user?: string;
      previousValue?: unknown;
    } = {
      previousValue: {
        name: pattern.name,
        status: pattern.status,
      },
    };
    if (user !== undefined) {
      options.user = user;
    }
    return this.recordEvent(pattern.id, pattern.category, 'deleted', options);
  }

  /**
   * Record a confidence change event
   */
  recordConfidenceChanged(
    pattern: Pattern,
    previousScore: number,
    user?: string
  ): PatternHistoryEvent {
    const options: {
      user?: string;
      previousValue?: unknown;
      newValue?: unknown;
    } = {
      previousValue: previousScore,
      newValue: pattern.confidence.score,
    };
    if (user !== undefined) {
      options.user = user;
    }
    return this.recordEvent(pattern.id, pattern.category, 'confidence_changed', options);
  }

  /**
   * Record a locations change event
   */
  recordLocationsChanged(
    pattern: Pattern,
    previousCount: number,
    user?: string
  ): PatternHistoryEvent {
    const options: {
      user?: string;
      previousValue?: unknown;
      newValue?: unknown;
      details?: Record<string, unknown>;
    } = {
      previousValue: previousCount,
      newValue: pattern.locations.length,
      details: {
        added: Math.max(0, pattern.locations.length - previousCount),
        removed: Math.max(0, previousCount - pattern.locations.length),
      },
    };
    if (user !== undefined) {
      options.user = user;
    }
    return this.recordEvent(pattern.id, pattern.category, 'locations_changed', options);
  }

  /**
   * Record a severity change event
   */
  recordSeverityChanged(
    pattern: Pattern,
    previousSeverity: string,
    user?: string
  ): PatternHistoryEvent {
    const options: {
      user?: string;
      previousValue?: unknown;
      newValue?: unknown;
    } = {
      previousValue: previousSeverity,
      newValue: pattern.severity,
    };
    if (user !== undefined) {
      options.user = user;
    }
    return this.recordEvent(pattern.id, pattern.category, 'severity_changed', options);
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  /**
   * Get history for a specific pattern
   *
   * @param patternId - Pattern ID
   * @returns Pattern history or undefined if not found
   */
  getPatternHistory(patternId: string): PatternHistory | undefined {
    return this.histories.get(patternId);
  }

  /**
   * Get history for a specific pattern, throwing if not found
   *
   * @param patternId - Pattern ID
   * @returns Pattern history
   * @throws PatternHistoryNotFoundError if not found
   */
  getPatternHistoryOrThrow(patternId: string): PatternHistory {
    const history = this.histories.get(patternId);
    if (!history) {
      throw new PatternHistoryNotFoundError(patternId);
    }
    return history;
  }

  /**
   * Check if history exists for a pattern
   *
   * @param patternId - Pattern ID
   * @returns True if history exists
   */
  hasPatternHistory(patternId: string): boolean {
    return this.histories.has(patternId);
  }

  /**
   * Query history events with filtering and pagination
   *
   * @param query - Query options
   * @returns Query result with matching events
   */
  query(query: HistoryQuery = {}): HistoryQueryResult {
    const startTime = Date.now();

    // Collect all events from relevant histories
    let events: PatternHistoryEvent[] = [];

    // Filter by pattern ID(s)
    if (query.patternId) {
      const history = this.histories.get(query.patternId);
      if (history) {
        events = [...history.events];
      }
    } else if (query.patternIds && query.patternIds.length > 0) {
      for (const patternId of query.patternIds) {
        const history = this.histories.get(patternId);
        if (history) {
          events.push(...history.events);
        }
      }
    } else {
      // Get all events
      for (const history of this.histories.values()) {
        events.push(...history.events);
      }
    }

    // Apply filters
    events = this.applyFilters(events, query);

    // Sort by timestamp descending (most recent first)
    events.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Get total before pagination
    const total = events.length;

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? events.length;
    const hasMore = offset + limit < total;
    events = events.slice(offset, offset + limit);

    return {
      events,
      total,
      hasMore,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Apply filters to events
   */
  private applyFilters(
    events: PatternHistoryEvent[],
    query: HistoryQuery
  ): PatternHistoryEvent[] {
    return events.filter((event) => {
      // Filter by event type
      if (query.eventType) {
        const types = Array.isArray(query.eventType)
          ? query.eventType
          : [query.eventType];
        if (!types.includes(event.type)) {
          return false;
        }
      }

      // Filter by category
      if (query.category) {
        const categories = Array.isArray(query.category)
          ? query.category
          : [query.category];
        const history = this.histories.get(event.patternId);
        if (!history || !categories.includes(history.category)) {
          return false;
        }
      }

      // Filter by user
      if (query.user && event.user !== query.user) {
        return false;
      }

      // Filter by date range
      if (query.after) {
        const eventTime = new Date(event.timestamp).getTime();
        const afterTime = new Date(query.after).getTime();
        if (eventTime < afterTime) {
          return false;
        }
      }

      if (query.before) {
        const eventTime = new Date(event.timestamp).getTime();
        const beforeTime = new Date(query.before).getTime();
        if (eventTime > beforeTime) {
          return false;
        }
      }

      return true;
    });
  }

  // ==========================================================================
  // Convenience Query Methods
  // ==========================================================================

  /**
   * Get all history events
   */
  getAllEvents(): PatternHistoryEvent[] {
    return this.query().events;
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType: HistoryEventType): PatternHistoryEvent[] {
    return this.query({ eventType }).events;
  }

  /**
   * Get events by category
   */
  getEventsByCategory(category: PatternCategory): PatternHistoryEvent[] {
    return this.query({ category }).events;
  }

  /**
   * Get events in date range
   */
  getEventsInDateRange(after: string, before: string): PatternHistoryEvent[] {
    return this.query({ after, before }).events;
  }

  /**
   * Get recent events
   *
   * @param limit - Maximum number of events to return
   */
  getRecentEvents(limit: number = 50): PatternHistoryEvent[] {
    return this.query({ limit }).events;
  }

  /**
   * Get approval history
   */
  getApprovalHistory(): PatternHistoryEvent[] {
    return this.getEventsByType('approved');
  }

  /**
   * Get events by user
   */
  getEventsByUser(user: string): PatternHistoryEvent[] {
    return this.query({ user }).events;
  }

  // ==========================================================================
  // Pruning
  // ==========================================================================

  /**
   * Prune history for a specific pattern
   *
   * Removes old entries based on maxEntriesPerPattern and maxAgeDays config.
   *
   * @param patternId - Pattern ID to prune
   */
  private prunePatternHistory(patternId: string): void {
    const history = this.histories.get(patternId);
    if (!history) {
      return;
    }

    const now = Date.now();
    const maxAgeMs = this.config.maxAgeDays * 24 * 60 * 60 * 1000;

    // Filter out old events
    history.events = history.events.filter((event) => {
      const eventTime = new Date(event.timestamp).getTime();
      return now - eventTime < maxAgeMs;
    });

    // Limit number of entries
    if (history.events.length > this.config.maxEntriesPerPattern) {
      // Keep most recent events
      history.events = history.events
        .sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
        .slice(0, this.config.maxEntriesPerPattern);
    }
  }

  /**
   * Prune all history
   *
   * Removes old entries based on maxEntriesPerPattern and maxAgeDays config.
   */
  prune(): void {
    for (const patternId of this.histories.keys()) {
      this.prunePatternHistory(patternId);
    }

    // Remove empty histories
    for (const [patternId, history] of this.histories.entries()) {
      if (history.events.length === 0) {
        this.histories.delete(patternId);
      }
    }

    this.dirty = true;
    this.emitEvent('history:pruned', undefined, { count: this.histories.size });
    this.scheduleAutoSave();
  }

  /**
   * Delete history for a specific pattern
   *
   * @param patternId - Pattern ID
   * @returns True if history was deleted
   */
  deletePatternHistory(patternId: string): boolean {
    const deleted = this.histories.delete(patternId);
    if (deleted) {
      this.dirty = true;
      this.scheduleAutoSave();
    }
    return deleted;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get statistics about the history store
   */
  getStats(): {
    totalPatterns: number;
    totalEvents: number;
    eventsByType: Record<HistoryEventType, number>;
    oldestEvent: string | null;
    newestEvent: string | null;
  } {
    const eventsByType: Record<HistoryEventType, number> = {
      created: 0,
      approved: 0,
      ignored: 0,
      updated: 0,
      deleted: 0,
      confidence_changed: 0,
      locations_changed: 0,
      severity_changed: 0,
    };

    let totalEvents = 0;
    let oldestEvent: string | null = null;
    let newestEvent: string | null = null;

    for (const history of this.histories.values()) {
      for (const event of history.events) {
        totalEvents++;
        eventsByType[event.type]++;

        if (!oldestEvent || event.timestamp < oldestEvent) {
          oldestEvent = event.timestamp;
        }
        if (!newestEvent || event.timestamp > newestEvent) {
          newestEvent = event.timestamp;
        }
      }
    }

    return {
      totalPatterns: this.histories.size,
      totalEvents,
      eventsByType,
      oldestEvent,
      newestEvent,
    };
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Emit a history store event
   */
  private emitEvent(
    type: HistoryStoreEventType,
    patternId?: string,
    data?: Record<string, unknown>
  ): void {
    const event: HistoryStoreEvent = {
      type,
      timestamp: new Date().toISOString(),
    };

    if (patternId !== undefined) {
      event.patternId = patternId;
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
   * Get the number of patterns with history
   */
  get size(): number {
    return this.histories.size;
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
   * Get the history directory path
   */
  get path(): string {
    return this.historyDir;
  }

  /**
   * Clear all history from memory (does not affect disk)
   */
  clear(): void {
    this.histories.clear();
    this.dirty = true;
  }

  /**
   * Dispose of the history store
   */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.removeAllListeners();
  }
}
